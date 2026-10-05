// @editedBy SherrySherry 2026-09-24
/**
 * FileAdapter — 파일 시스템 저장 어댑터 (StorageAdapter 구현체).
 *
 * 사람이 파인더에서 직접 열어 보고 고칠 수 있는 저장소:
 * - 새 구조: {storageRoot}/🧠장기기억저장소_feat.해마🧠/🪣쩜통🪣/{jjumName}.jj
 * - 기존 구조 호환: {storageRoot}/{ownerId}/{jjumName}.jj
 * - 인덱스: {storageRoot}/🧠장기기억저장소_feat.해마🧠/🪣쩜통🪣/_index.jj
 *
 * 내성 정책:
 * - 손으로 고친 파일도 스키마 v4 검증(validateJJum) 후 로드. 깨진 파일은 건너뛰고
 *   getLoadErrors()에 리포트 — 전체는 계속 동작한다.
 * - 인덱스가 유실·불일치하면 파일 스캔으로 찾아내고 인덱스를 자가 복구한다.
 *
 * 동시성: 단일 프로세스(로컬 콘솔·테스트) 사용 전제. 파일 잠금은 두지 않는다.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { JJum, JJumId, JJumStatus } from '../types/jjum.ts';
import { validateJJum } from '../types/validateJJum.ts';
import type { JJumQuery, JJumSortKey, StorageAdapter } from './storageAdapter.ts';

const LONG_TERM_FOLDER = '🧠장기기억저장소_feat.해마🧠';
const JJUM_BUCKET_FOLDER = '🪣쩜통🪣';

export interface FileAdapterOptions {
  /** 장기기억저장소 폴더 자체. 접미사가 붙은 선택 폴더도 그대로 사용한다. */
  memoryRoot?: string;
  /** 저장 루트. 기본값: <cwd>/local-server/haema */
  storageRoot?: string;
  /** 구 호출자의 저장 루트 별칭 */
  baseDir?: string;
  /** 기존 구조 사용 여부 (하위 호환성용) */
  useLegacyStructure?: boolean;
}

export interface LoadError {
  file: string;
  reason: string;
}

interface OwnerIndex {
  /** 정규화된 이름/별칭 → jjumId 목록 */
  names: Record<string, JJumId[]>;
  /** jjumId → 파일명 */
  files: Record<JJumId, string>;
}

interface IndexFile {
  version: 1;
  owners: Record<string, OwnerIndex>;
}

const normName = (s: string): string => s.trim().toLowerCase();

/** 파일명에 못 쓰는 문자·공백만 치환 — 한글 등은 그대로 살려 사람이 읽게 한다 */
const sanitize = (s: string): string =>
  (s.trim().replace(/[/\\:*?"<>|\u0000-\u001f\s]/g, '_') || 'jjum').slice(0, 80);

function atomicWrite(filePath: string, content: string): void {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, filePath);
}

const SORT_KEYS: JJumSortKey[] = ['mentionCount', 'lastMentioned', 'firstSeen', 'recallCount'];

export class FileAdapter implements StorageAdapter {
  readonly storageRoot: string;
  readonly memoryRoot?: string;
  readonly useLegacyStructure: boolean;
  private loadErrors: LoadError[] = [];

  constructor(options?: FileAdapterOptions) {
    this.storageRoot = options?.storageRoot ?? options?.baseDir ?? path.join(process.cwd(), 'local-server', 'haema');
    this.memoryRoot = options?.memoryRoot;
    this.useLegacyStructure = options?.useLegacyStructure ?? false;
  }

  /** 기존 구조 호환성을 위한 baseDir getter */
  get baseDir(): string {
    if (this.useLegacyStructure) {
      return this.storageRoot;
    }
    // 새 구조: {storageRoot}/🧠장기기억저장소_feat.해마🧠/🪣쩜통🪣
    return path.join(this.memoryRoot ?? path.join(this.storageRoot, LONG_TERM_FOLDER), JJUM_BUCKET_FOLDER);
  }

  /** 마지막 스캔에서 건너뛴 파일들 — 콘솔 reindex 리포트용 */
  getLoadErrors(): LoadError[] {
    return [...this.loadErrors];
  }

  /** 점이 실제로 저장된 파일 경로 (인덱스 기준). 없으면 null */
  getFilePath(ownerId: string, jjumId: JJumId): string | null {
    return this.jjumPath(ownerId, jjumId);
  }

  // ── 경로 ──────────────────────────────────────────────

  private ownerDir(ownerId: string): string {
    if (this.useLegacyStructure) {
      return path.join(this.baseDir, sanitize(ownerId));
    }
    // 새 구조: ownerId 폴더 없이 🪣쩜통🪣에 직접 저장
    return this.baseDir;
  }

  private jjumPath(ownerId: string, jjumId: JJumId): string | null {
    const index = this.loadIndex();
    const filename = index.owners[ownerId]?.files[jjumId];
    if (typeof filename === 'string' && path.basename(filename) === filename && filename.endsWith('.jj') && !filename.startsWith('_')) {
      const candidate = path.join(this.ownerDir(ownerId), filename);
      const { jjum } = this.readJJumFile(candidate);
      if (jjum?.ownerId === ownerId && jjum.jjumId === jjumId) return candidate;
    }
    // 인덱스에 없으면 스캔으로 찾기 (fallback)
    const { files } = this.scanOwner(ownerId);
    const fileName = files[jjumId];
    if (fileName) {
      return path.join(this.ownerDir(ownerId), fileName);
    }
    return null;
  }

  private indexPath(): string {
    return path.join(this.baseDir, '_index.jj');
  }

  // ── 인덱스 ────────────────────────────────────────────

  private loadIndex(): IndexFile {
    try {
      const raw = fs.readFileSync(this.indexPath(), 'utf-8');
      const parsed = JSON.parse(raw) as Partial<IndexFile>;
      if (parsed && typeof parsed.owners === 'object' && parsed.owners !== null && !Array.isArray(parsed.owners)) {
        const owners: Record<string, OwnerIndex> = Object.create(null);
        for (const [ownerId, value] of Object.entries(parsed.owners)) {
          if (!value || typeof value !== 'object') continue;
          const names: Record<string, JJumId[]> = Object.create(null);
          const files: Record<JJumId, string> = Object.create(null);
          if (value.names && typeof value.names === 'object') {
            for (const [name, ids] of Object.entries(value.names)) {
              if (Array.isArray(ids)) names[name] = ids.filter((id): id is string => typeof id === 'string');
            }
          }
          if (value.files && typeof value.files === 'object') {
            for (const [id, filename] of Object.entries(value.files)) {
              if (typeof filename === 'string') files[id] = filename;
            }
          }
          owners[ownerId] = { names, files };
        }
        return { version: 1, owners };
      }
    } catch {
      // 없거나 깨짐 — 빈 인덱스에서 시작, 조회 시 스캔으로 자가 복구
    }
    return { version: 1, owners: Object.create(null) };
  }

  private saveIndex(index: IndexFile): void {
    fs.mkdirSync(this.baseDir, { recursive: true });
    atomicWrite(this.indexPath(), JSON.stringify(index, null, 2));
  }

  private ownerIndex(index: IndexFile, ownerId: string): OwnerIndex {
    if (!index.owners[ownerId]) index.owners[ownerId] = { names: Object.create(null), files: Object.create(null) };
    return index.owners[ownerId];
  }

  /** 인덱스에서 이 점의 이름 항목을 지우고 다시 등록한다 */
  private registerInIndex(index: IndexFile, jjum: JJum, filename: string): void {
    const oi = this.ownerIndex(index, jjum.ownerId);
    for (const key of Object.keys(oi.names)) {
      oi.names[key] = oi.names[key].filter((id) => id !== jjum.jjumId);
      if (oi.names[key].length === 0) delete oi.names[key];
    }
    for (const name of [jjum.jjumName, ...jjum.aliases]) {
      const key = normName(name);
      if (!key) continue;
      if (!oi.names[key]) oi.names[key] = [];
      if (!oi.names[key].includes(jjum.jjumId)) oi.names[key].push(jjum.jjumId);
    }
    oi.files[jjum.jjumId] = filename;
  }

  private removeFromIndex(index: IndexFile, ownerId: string, jjumId: JJumId): void {
    const oi = index.owners[ownerId];
    if (!oi) return;
    for (const key of Object.keys(oi.names)) {
      oi.names[key] = oi.names[key].filter((id) => id !== jjumId);
      if (oi.names[key].length === 0) delete oi.names[key];
    }
    delete oi.files[jjumId];
  }

  // ── 파일 입출력 ────────────────────────────────────────

  private readJJumFile(filePath: string): { jjum?: JJum; error?: string } {
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'utf-8');
    } catch (e) {
      return { error: `읽기 실패: ${(e as Error).message}` };
    }
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return { error: `JSON 파싱 실패: ${(e as Error).message}` };
    }
    const result = validateJJum(data);
    if (!result.ok || !result.jjum) {
      return { error: `스키마 검증 실패: ${result.errors.join(' / ')}` };
    }
    return { jjum: result.jjum };
  }

  /** jjumName 기반 파일명 결정 — 다른 점과 충돌하면 jjumId 앞 8자리를 붙인다 */
  private filenameFor(jjum: JJum, oldFilename?: string): string {
    const base = `${sanitize(jjum.jjumName)}.jj`;
    const dir = this.ownerDir(jjum.ownerId);
    const available = (filename: string): boolean => {
      if (filename === oldFilename) return true;
      const target = path.join(dir, filename);
      if (!fs.existsSync(target)) return true;
      const { jjum: stored } = this.readJJumFile(target);
      return stored?.ownerId === jjum.ownerId && stored.jjumId === jjum.jjumId;
    };
    if (available(base)) return base;
    const prefix = `${sanitize(jjum.jjumName)}_${sanitize(jjum.jjumId.slice(0, 8))}`;
    let filename = `${prefix}.jj`;
    for (let suffix = 2; !available(filename); suffix++) filename = `${prefix}_${suffix}.jj`;
    return filename;
  }

  /** 소유자 폴더 전체 스캔 — 인덱스 자가 복구의 원천 */
  private scanOwner(ownerId: string): { jjums: JJum[]; files: Record<JJumId, string> } {
    this.loadErrors = [];
    const dir = this.ownerDir(ownerId);
    const jjums: JJum[] = [];
    const files: Record<JJumId, string> = Object.create(null);
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return { jjums, files };
    }
    for (const entry of entries) {
      if (!entry.endsWith('.jj') || entry.startsWith('_')) continue;
      const { jjum, error } = this.readJJumFile(path.join(dir, entry));
      if (error) {
        this.loadErrors.push({ file: path.join(dir, entry), reason: error });
        continue;
      }
      if (jjum) {
        if (jjum.ownerId !== ownerId) continue;
        jjums.push(jjum);
        files[jjum.jjumId] = entry;
      }
    }
    return { jjums, files };
  }

  /** 손으로 고친 파일 반영 — 소유자 폴더를 스캔해 인덱스를 재구축한다 */
  reindex(ownerId: string): { count: number; errors: LoadError[] } {
    const { jjums, files } = this.scanOwner(ownerId);
    const index = this.loadIndex();
    index.owners[ownerId] = { names: Object.create(null), files: Object.create(null) };
    for (const jjum of jjums) {
      this.registerInIndex(index, jjum, files[jjum.jjumId]);
    }
    this.saveIndex(index);
    return { count: jjums.length, errors: this.getLoadErrors() };
  }

  /** 실제 유효한 쩜 파일에서 소유자를 찾는다. 낡은 인덱스의 소유자는 노출하지 않는다. */
  async listOwnerIds(): Promise<string[]> {
    const owners = new Set<string>();
    if (this.useLegacyStructure) {
      if (!fs.existsSync(this.baseDir)) return [];
      for (const entry of fs.readdirSync(this.baseDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        for (const filename of fs.readdirSync(path.join(this.baseDir, entry.name))) {
          if (!filename.endsWith('.jj') || filename.startsWith('_')) continue;
          const { jjum } = this.readJJumFile(path.join(this.baseDir, entry.name, filename));
          if (jjum) owners.add(jjum.ownerId);
        }
      }
    } else if (fs.existsSync(this.baseDir)) {
      for (const filename of fs.readdirSync(this.baseDir)) {
        if (!filename.endsWith('.jj') || filename.startsWith('_')) continue;
        const { jjum } = this.readJJumFile(path.join(this.baseDir, filename));
        if (jjum) owners.add(jjum.ownerId);
      }
    }
    return [...owners].sort();
  }

  // ── StorageAdapter 구현 ────────────────────────────────

  async getJJum(ownerId: string, jjumId: JJumId): Promise<JJum | null> {
    const index = this.loadIndex();
    const filename = index.owners[ownerId]?.files[jjumId];
    if (typeof filename === 'string' && path.basename(filename) === filename && filename.endsWith('.jj') && !filename.startsWith('_')) {
      const { jjum } = this.readJJumFile(path.join(this.ownerDir(ownerId), filename));
      if (jjum && jjum.jjumId === jjumId && jjum.ownerId === ownerId) return jjum;
    }
    // 인덱스 불일치 — 스캔으로 찾고 자가 복구
    const { jjums, files } = this.scanOwner(ownerId);
    const found = jjums.find((n) => n.jjumId === jjumId) ?? null;
    if (found) {
      this.registerInIndex(index, found, files[found.jjumId]);
      this.saveIndex(index);
    }
    return found;
  }

  async putJJum(ownerId: string, jjum: JJum): Promise<void> {
    const stored: JJum = { ...jjum, ownerId };
    const index = this.loadIndex();
    const dir = this.ownerDir(ownerId);
    fs.mkdirSync(dir, { recursive: true });

    const oldFilename = this.jjumPath(ownerId, stored.jjumId);
    const newFilename = this.filenameFor(stored, oldFilename ? path.basename(oldFilename) : undefined);
    atomicWrite(path.join(dir, newFilename), JSON.stringify(stored, null, 2));
    if (oldFilename && path.basename(oldFilename) !== newFilename) {
      // jjumName이 바뀌면 파일명도 따라간다
      try {
        fs.unlinkSync(oldFilename);
      } catch {
        /* 이미 없으면 무시 */
      }
    }
    this.registerInIndex(index, stored, newFilename);
    this.saveIndex(index);
  }

  async putJJums(ownerId: string, jjums: JJum[]): Promise<void> {
    // 파일 단위 원자 쓰기(tmp→rename)의 순차 적용 — 단일 프로세스 전제의 최선
    for (const jjum of jjums) {
      await this.putJJum(ownerId, jjum);
    }
  }

  async patchJJum(ownerId: string, jjumId: JJumId, partial: Partial<JJum>): Promise<void> {
    const existing = await this.getJJum(ownerId, jjumId);
    if (!existing) throw new Error(`patchJJum: 쩜 없음 — ${ownerId}/${jjumId}`);
    await this.putJJum(ownerId, { ...existing, ...partial, jjumId: existing.jjumId, ownerId });
  }

  async deleteJJum(ownerId: string, jjumId: JJumId): Promise<void> {
    const index = this.loadIndex();
    const filename = this.jjumPath(ownerId, jjumId);
    if (filename) fs.unlinkSync(filename);
    this.removeFromIndex(index, ownerId, jjumId);
    this.saveIndex(index);
  }

  async listJJums(ownerId: string, query?: JJumQuery): Promise<JJum[]> {
    let { jjums } = this.scanOwner(ownerId);

    if (query?.status !== undefined) {
      const statuses: JJumStatus[] = Array.isArray(query.status) ? query.status : [query.status];
      jjums = jjums.filter((n) => statuses.includes(n.status));
    }
    if (query?.type !== undefined) jjums = jjums.filter((n) => n.type === query.type);
    if (query?.tag !== undefined) jjums = jjums.filter((n) => n.jjtags.includes(query.tag as string));
    if (query?.pinned !== undefined) jjums = jjums.filter((n) => n.pinned === query.pinned);

    if (query?.sortBy && SORT_KEYS.includes(query.sortBy)) {
      const key = query.sortBy;
      const dir = query.direction === 'asc' ? 1 : -1;
      jjums.sort((a, b) => (a[key] - b[key]) * dir);
    }
    if (query?.limit !== undefined && query.limit >= 0) jjums = jjums.slice(0, query.limit);
    return jjums;
  }

  async findByName(ownerId: string, name: string): Promise<JJum[]> {
    const key = normName(name);
    if (!key) return [];
    // 손으로 고친 파일이 기존 이름에 추가로 매칭될 수도 있으므로 전체 스캔한다.
    const { jjums, files } = this.scanOwner(ownerId);
    const found = jjums.filter((n) => [n.jjumName, ...n.aliases].some((x) => normName(x) === key));
    if (found.length > 0) {
      const index = this.loadIndex();
      for (const jjum of found) this.registerInIndex(index, jjum, files[jjum.jjumId]);
      this.saveIndex(index);
    }
    return found;
  }

  async countJJums(ownerId: string, status?: JJumStatus): Promise<number> {
    const { jjums } = this.scanOwner(ownerId);
    if (status === undefined) return jjums.length;
    return jjums.filter((n) => n.status === status).length;
  }

  /**
   * 쩜 언급(touch) — mentionCount 증가, lastMentioned 갱신.
   * 쩜선도 함께 갱신: 관련 쩜선의 weight 상승 + lastActivated 갱신.
   * M2: 파일 어댑터에서 쩜/쩜선 무게 실시간 감쇠/상승 확인을 위한 핵심 함수.
   */
  async touchJJum(
    ownerId: string,
    jjumId: JJumId,
    options?: { seons?: { targetId: JJumId; weight?: number; label?: string }[] },
  ): Promise<JJum | null> {
    const filePath = this.jjumPath(ownerId, jjumId);
    if (!filePath) return null;

    const raw = fs.readFileSync(filePath, 'utf-8');
    const result = validateJJum(JSON.parse(raw), Date.now());
    if (!result?.jjum || result.jjum.ownerId !== ownerId || result.jjum.jjumId !== jjumId) return null;

    const jjum = result.jjum;
    const now = Date.now();

    // 쩜 자체 언급 카운트/시각 갱신
    const updated: JJum = {
      ...jjum,
      mentionCount: (jjum.mentionCount ?? 0) + 1,
      lastMentioned: now,
    };

    // 쩜선 갱신: 기존 선은 weight 상승 + lastActivated 갱신, 새 선은 추가
    if (options?.seons && options.seons.length > 0) {
      for (const input of options.seons) {
        const existing = updated.seons.find((seon) =>
          seon.targetId === input.targetId && (seon.label ?? '') === (input.label ?? ''),
        );
        if (existing) {
          existing.weight = Math.min(1, existing.weight + (input.weight ?? 0.1));
          existing.lastActivated = now;
        } else {
          updated.seons.push({
            targetId: input.targetId,
            weight: Math.min(1, input.weight ?? 0.1),
            ...(input.label ? { label: input.label } : {}),
            lastActivated: now,
          });
        }
      }
    }

    atomicWrite(filePath, JSON.stringify(updated, null, 2));
    return updated;
  }

  /**
   * 시간 기반 weight 감쇠 적용.
   * M2: 오래 언급되지 않은 쩜선의 weight를 서서히 감소.
   * - 기본 감쇠율: 하루(86400000ms)당 0.01
   * - 최소 weight: 0.1 (완전 소멸 방지)
   * - lastMentioned가 없으면 감쇠하지 않음 (신규 쩜 보호)
   */
  async decayWeights(ownerId: string, options?: { decayRate?: number; minWeight?: number; since?: number }): Promise<{ decayed: number; errors: string[] }> {
    const decayRate = options?.decayRate ?? 0.01; // 하루당 감쇠량
    const minWeight = options?.minWeight ?? 0.1;
    const since = options?.since ?? Date.now();
    const msPerDay = 86400000;
    const errors: string[] = [];

    const { jjums } = this.scanOwner(ownerId);
    let decayed = 0;

    for (const jjum of jjums) {
      try {
        const filePath = this.jjumPath(ownerId, jjum.jjumId);
        if (!filePath) continue;

        const raw = fs.readFileSync(filePath, 'utf-8');
        const result = validateJJum(JSON.parse(raw), Date.now());
        if (!result?.jjum) continue;

        const current = result.jjum;
        const lastMentioned = current.lastMentioned ?? current.firstSeen;
        if (!lastMentioned) continue;

        // 경과 일수 계산
        const daysSince = (since - lastMentioned) / msPerDay;
        if (daysSince <= 0.001) continue; // 0.001일(약 86초) 미만은 감쇠하지 않음

        // 쩜선 weight만 감쇠 (쩜 자체에는 weight 필드가 없음)
        const newSeons = (current.seons ?? []).map(function(seon) {
          const seonLastActivated = seon.lastActivated ?? lastMentioned;
          const seonDays = (since - seonLastActivated) / msPerDay;
          if (seonDays <= 0) return seon;
          const newSeonWeight = Math.max(minWeight, (seon.weight ?? 0.5) - decayRate * seonDays);
          return { ...seon, weight: newSeonWeight };
        });

        const updated: JJum = {
          ...current,
          seons: newSeons,
        };

        atomicWrite(filePath, JSON.stringify(updated, null, 2));

        // 인덱스 업데이트 — 파일명은 그대로, jjumId 등록 확인
        const index = this.loadIndex();
        if (!index.owners[ownerId]) {
          index.owners[ownerId] = { names: Object.create(null), files: Object.create(null) };
        }
        const oi = index.owners[ownerId];
        if (!oi.files[jjum.jjumId]) {
          // 인덱스에 없는 jjumId 등록 (파일명 기준)
          const fileName = path.basename(filePath);
          oi.files[jjum.jjumId] = fileName;
          // 이름 인덱스도 업데이트
          const norm = normName(updated.jjumName);
          if (norm && !oi.names[norm]) {
            oi.names[norm] = [];
          }
          if (norm && !oi.names[norm].includes(jjum.jjumId)) {
            oi.names[norm].push(jjum.jjumId);
          }
          this.saveIndex(index);
        }
        decayed++;
      } catch (e) {
        errors.push(`${jjum.jjumId}: ${String(e)}`);
      }
    }

    return { decayed, errors };
  }
}

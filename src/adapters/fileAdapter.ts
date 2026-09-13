// @editedBy SherrySherry 2026-09-12
/**
 * FileAdapter — 파일 시스템 저장 어댑터 (StorageAdapter 구현체).
 *
 * 사람이 파인더에서 직접 열어 보고 고칠 수 있는 저장소:
 * - local-server/haema/{ownerId}/{canonicalName}.jj — 점 1개 = .jj 파일 1개 (2칸 들여쓰기)
 * - local-server/haema/_index.jj — 이름·별칭 → jjumId 조회 인덱스
 *
 * 내성 정책:
 * - 손으로 고친 파일도 스키마 v3 검증(validateJJum) 후 로드. 깨진 파일은 건너뛰고
 *   getLoadErrors()에 리포트 — 전체는 계속 동작한다.
 * - 인덱스가 유실·불일치하면 파일 스캔으로 찾아내고 인덱스를 자가 복구한다.
 *
 * 동시성: 단일 프로세스(로컬 콘솔·테스트) 사용 전제. 파일 잠금은 두지 않는다.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { JJum, JJumId, JjumStatus } from '../types/jjum.ts';
import { validateJJum } from '../types/validateJJum.ts';
import type { CellQuery, CellSortKey, StorageAdapter } from './storageAdapter.ts';

export interface FileAdapterOptions {
  /** 저장 루트. 기본값: <cwd>/local-server/haema */
  baseDir?: string;
}

export interface LoadError {
  file: string;
  reason: string;
}

interface OwnerIndex {
  /** 정규화된 이름/별칭 → jjumId 목록 */
  names: Record<string, CellId[]>;
  /** jjumId → 파일명 */
  files: Record<CellId, string>;
}

interface IndexFile {
  version: 1;
  owners: Record<string, OwnerIndex>;
}

const normName = (s: string): string => s.trim().toLowerCase();

/** 파일명에 못 쓰는 문자·공백만 치환 — 한글 등은 그대로 살려 사람이 읽게 한다 */
const sanitize = (s: string): string =>
  (s.trim().replace(/[/\\:*?"<>|\u0000-\u001f\s]/g, '_') || 'cell').slice(0, 80);

function atomicWrite(filePath: string, content: string): void {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, filePath);
}

const SORT_KEYS: CellSortKey[] = ['mentionCount', 'lastMentioned', 'firstSeen', 'recallCount'];

export class FileAdapter implements StorageAdapter {
  readonly baseDir: string;
  private loadErrors: LoadError[] = [];

  constructor(options?: FileAdapterOptions) {
    this.baseDir = options?.baseDir ?? path.join(process.cwd(), 'local-server', 'haema');
  }

  /** 마지막 스캔에서 건너뛴 파일들 — 콘솔 reindex 리포트용 */
  getLoadErrors(): LoadError[] {
    return [...this.loadErrors];
  }

  /** 점이 실제로 저장된 파일 경로 (인덱스 기준). 없으면 null */
  getFilePath(ownerId: string, cellId: CellId): string | null {
    const filename = this.loadIndex().owners[ownerId]?.files[cellId];
    return filename ? path.join(this.ownerDir(ownerId), filename) : null;
  }

  // ── 경로 ──────────────────────────────────────────────

  private ownerDir(ownerId: string): string {
    return path.join(this.baseDir, sanitize(ownerId));
  }

  private indexPath(): string {
    return path.join(this.baseDir, '_index.jj');
  }

  // ── 인덱스 ────────────────────────────────────────────

  private loadIndex(): IndexFile {
    try {
      const raw = fs.readFileSync(this.indexPath(), 'utf-8');
      const parsed = JSON.parse(raw) as IndexFile;
      if (parsed && typeof parsed === 'object' && parsed.owners) return parsed;
    } catch {
      // 없거나 깨짐 — 빈 인덱스에서 시작, 조회 시 스캔으로 자가 복구
    }
    return { version: 1, owners: {} };
  }

  private saveIndex(index: IndexFile): void {
    fs.mkdirSync(this.baseDir, { recursive: true });
    atomicWrite(this.indexPath(), JSON.stringify(index, null, 2));
  }

  private ownerIndex(index: IndexFile, ownerId: string): OwnerIndex {
    if (!index.owners[ownerId]) index.owners[ownerId] = { names: {}, files: {} };
    return index.owners[ownerId];
  }

  /** 인덱스에서 이 점의 이름 항목을 지우고 다시 등록한다 */
  private registerInIndex(index: IndexFile, cell: JJum, filename: string): void {
    const oi = this.ownerIndex(index, cell.ownerId);
    for (const key of Object.keys(oi.names)) {
      oi.names[key] = oi.names[key].filter((id) => id !== cell.cellId);
      if (oi.names[key].length === 0) delete oi.names[key];
    }
    for (const name of [cell.canonicalName, ...cell.aliases]) {
      const key = normName(name);
      if (!key) continue;
      if (!oi.names[key]) oi.names[key] = [];
      if (!oi.names[key].includes(cell.cellId)) oi.names[key].push(cell.cellId);
    }
    oi.files[cell.cellId] = filename;
  }

  private removeFromIndex(index: IndexFile, ownerId: string, cellId: CellId): void {
    const oi = index.owners[ownerId];
    if (!oi) return;
    for (const key of Object.keys(oi.names)) {
      oi.names[key] = oi.names[key].filter((id) => id !== cellId);
      if (oi.names[key].length === 0) delete oi.names[key];
    }
    delete oi.files[cellId];
  }

  // ── 파일 입출력 ────────────────────────────────────────

  private readCellFile(filePath: string): { cell?: JJum; error?: string } {
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
    if (!result.ok || !result.cell) {
      return { error: `스키마 검증 실패: ${result.errors.join(' / ')}` };
    }
    return { cell: result.cell };
  }

  /** canonicalName 기반 파일명 결정 — 다른 점과 충돌하면 jjumId 앞 8자리를 붙인다 */
  private filenameFor(cell: JJum, oi: OwnerIndex): string {
    const base = `${sanitize(cell.canonicalName)}.jj`;
    const takenBy = Object.entries(oi.files).find(([id, f]) => f === base && id !== cell.jjumId);
    if (!takenBy) return base;
    return `${sanitize(cell.canonicalName)}_${cell.jjumId.slice(0, 8)}.jj`;
  }

  /** 소유자 폴더 전체 스캔 — 인덱스 자가 복구의 원천 */
  private scanOwner(ownerId: string): { cells: JJum[]; files: Record<CellId, string> } {
    this.loadErrors = [];
    const dir = this.ownerDir(ownerId);
    const cells: JJum[] = [];
    const files: Record<CellId, string> = {};
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return { cells, files };
    }
    for (const entry of entries) {
      if (!entry.endsWith('.jj') || entry.startsWith('_')) continue;
      const { cell, error } = this.readCellFile(path.join(dir, entry));
      if (error) {
        this.loadErrors.push({ file: path.join(dir, entry), reason: error });
        continue;
      }
      if (cell) {
        if (cell.ownerId !== ownerId) {
          // 폴더 위치가 소유자의 진실 — 손으로 옮긴 파일은 폴더 기준으로 교정
          cell.ownerId = ownerId;
        }
        cells.push(cell);
        files[cell.jjumId] = entry;
      }
    }
    return { cells, files };
  }

  /** 손으로 고친 파일 반영 — 소유자 폴더를 스캔해 인덱스를 재구축한다 */
  reindex(ownerId: string): { count: number; errors: LoadError[] } {
    const { cells, files } = this.scanOwner(ownerId);
    const index = this.loadIndex();
    index.owners[ownerId] = { names: {}, files: {} };
    for (const cell of cells) {
      this.registerInIndex(index, cell, files[cell.jjumId]);
    }
    this.saveIndex(index);
    return { count: cells.length, errors: this.getLoadErrors() };
  }

  // ── StorageAdapter 구현 ────────────────────────────────

  async getCell(ownerId: string, cellId: CellId): Promise<JJum | null> {
    const index = this.loadIndex();
    const filename = index.owners[ownerId]?.files[cellId];
    if (filename) {
      const { cell } = this.readCellFile(path.join(this.ownerDir(ownerId), filename));
      if (cell && cell.jjumId === cellId) return cell;
    }
    // 인덱스 불일치 — 스캔으로 찾고 자가 복구
    const { cells, files } = this.scanOwner(ownerId);
    const found = cells.find((n) => n.jjumId === cellId) ?? null;
    if (found) {
      this.registerInIndex(index, found, files[found.jjumId]);
      this.saveIndex(index);
    }
    return found;
  }

  async putCell(ownerId: string, cell: JJum): Promise<void> {
    const stored: JJum = { ...cell, ownerId };
    const index = this.loadIndex();
    const oi = this.ownerIndex(index, ownerId);
    const dir = this.ownerDir(ownerId);
    fs.mkdirSync(dir, { recursive: true });

    const oldFilename = oi.files[stored.jjumId];
    const newFilename = this.filenameFor(stored, oi);
    atomicWrite(path.join(dir, newFilename), JSON.stringify(stored, null, 2));
    if (oldFilename && oldFilename !== newFilename) {
      // canonicalName이 바뀌면 파일명도 따라간다
      try {
        fs.unlinkSync(path.join(dir, oldFilename));
      } catch {
        /* 이미 없으면 무시 */
      }
    }
    this.registerInIndex(index, stored, newFilename);
    this.saveIndex(index);
  }

  async putCells(ownerId: string, cells: JJum[]): Promise<void> {
    // 파일 단위 원자 쓰기(tmp→rename)의 순차 적용 — 단일 프로세스 전제의 최선
    for (const cell of cells) {
      await this.putCell(ownerId, cell);
    }
  }

  async patchCell(ownerId: string, cellId: CellId, partial: Partial<JJum>): Promise<void> {
    const existing = await this.getCell(ownerId, cellId);
    if (!existing) throw new Error(`patchCell: 점 없음 — ${ownerId}/${cellId}`);
    await this.putCell(ownerId, { ...existing, ...partial, jjumId: existing.jjumId, ownerId });
  }

  async deleteCell(ownerId: string, cellId: CellId): Promise<void> {
    const index = this.loadIndex();
    const filename = index.owners[ownerId]?.files[cellId];
    if (filename) {
      try {
        fs.unlinkSync(path.join(this.ownerDir(ownerId), filename));
      } catch {
        /* 이미 없으면 무시 */
      }
    } else {
      const { files } = this.scanOwner(ownerId);
      if (files[cellId]) fs.unlinkSync(path.join(this.ownerDir(ownerId), files[cellId]));
    }
    this.removeFromIndex(index, ownerId, cellId);
    this.saveIndex(index);
  }

  async listCells(ownerId: string, query?: CellQuery): Promise<JJum[]> {
    let { cells } = this.scanOwner(ownerId);

    if (query?.status !== undefined) {
      const statuses: CellStatus[] = Array.isArray(query.status) ? query.status : [query.status];
      cells = cells.filter((n) => statuses.includes(n.status));
    }
    if (query?.type !== undefined) cells = cells.filter((n) => n.type === query.type);
    if (query?.tag !== undefined) cells = cells.filter((n) => n.tags.includes(query.tag as string));
    if (query?.pinned !== undefined) cells = cells.filter((n) => n.pinned === query.pinned);

    if (query?.sortBy && SORT_KEYS.includes(query.sortBy)) {
      const key = query.sortBy;
      const dir = query.direction === 'asc' ? 1 : -1;
      cells.sort((a, b) => (a[key] - b[key]) * dir);
    }
    if (query?.limit !== undefined && query.limit >= 0) cells = cells.slice(0, query.limit);
    return cells;
  }

  async findByName(ownerId: string, name: string): Promise<JJum[]> {
    const key = normName(name);
    if (!key) return [];
    const index = this.loadIndex();
    const ids = index.owners[ownerId]?.names[key] ?? [];
    const viaIndex: JJum[] = [];
    for (const id of ids) {
      const cell = await this.getCell(ownerId, id);
      if (cell && [cell.canonicalName, ...cell.aliases].some((n) => normName(n) === key)) {
        viaIndex.push(cell);
      }
    }
    if (viaIndex.length > 0) return viaIndex;

    // 인덱스 미스 — 손으로 고친 파일 대비 스캔 폴백 + 자가 복구
    const { cells, files } = this.scanOwner(ownerId);
    const found = cells.filter((n) => [n.canonicalName, ...n.aliases].some((x) => normName(x) === key));
    if (found.length > 0) {
      for (const cell of found) this.registerInIndex(index, cell, files[cell.jjumId]);
      this.saveIndex(index);
    }
    return found;
  }

  async countCells(ownerId: string, status?: CellStatus): Promise<number> {
    const { cells } = this.scanOwner(ownerId);
    if (status === undefined) return cells.length;
    return cells.filter((n) => n.status === status).length;
  }
}

// @editedBy SherrySherry 2026-10-30
/** v5 전용 파일 저장. 기존 v4 원문을 변환하거나 덮어쓰지 않는다. */
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { JJumV5, TypeRequirementCatalogV5 } from '../types/jjumV5.ts';
import { preserveOmittedJJumV5Optionals, validateJJumV5, type JJumV5Issue } from '../types/validateJJumV5.ts';
import { FileAdapter } from './fileAdapter.ts';

export interface FileJJumV5Record { jjum: JJumV5; etag: string }
export interface FileJJumV5StoreOptions {
  memoryRoot: string;
  typeRequirements?: TypeRequirementCatalogV5;
  maskedName?: (jjum: JJumV5) => string;
}
export interface SaveJJumV5Options {
  expectedEtag?: string;
  createOnly?: boolean;
  maskedName?: string;
}
export class FileJJumV5StoreError extends Error {
  readonly code: 'invalid' | 'policy_pending' | 'conflict' | 'locked' | 'corrupt' | 'unsupported_version' | 'unavailable';
  readonly issues: JJumV5Issue[];
  constructor(code: FileJJumV5StoreError['code'], message: string, issues: JJumV5Issue[] = [], options?: ErrorOptions) {
    super(message, options);
    this.name = 'FileJJumV5StoreError';
    this.code = code;
    this.issues = issues;
  }
}

interface DiskRecord { filename: string; raw: Record<string, unknown>; etag: string }
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const codeOf = (value: unknown) => value && typeof value === 'object' && 'code' in value ? String(value.code) : undefined;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exists = (filename: string): boolean => {
  try { fs.lstatSync(filename); return true; }
  catch (cause) { if (codeOf(cause) === 'ENOENT') return false; throw cause; }
};

function identity(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > 512
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) {
    throw new FileJJumV5StoreError('invalid', 'A non-empty scoped identifier is required');
  }
}

/** 잠금에 참여하는 저장끼리 CAS를 보호한다. 외부 직접 파일 쓰기와 다중 파일 트랜잭션은 별도다. */
export class FileJJumV5Store {
  readonly memoryRoot: string;
  private readonly bucket: string;
  private readonly typeRequirements?: TypeRequirementCatalogV5;
  private readonly maskedName?: (jjum: JJumV5) => string;
  private readonly coordinator: FileAdapter;

  constructor(options: FileJJumV5StoreOptions) {
    try {
      const stat = fs.lstatSync(options.memoryRoot);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Memory root is not a regular directory');
      this.memoryRoot = fs.realpathSync(options.memoryRoot);
    } catch (cause) {
      throw new FileJJumV5StoreError('unavailable', 'The memory root is unavailable or symbolic', [], { cause });
    }
    this.bucket = path.join(this.memoryRoot, '🪣쩜통🪣');
    this.typeRequirements = options.typeRequirements;
    this.maskedName = options.maskedName;
    this.coordinator = new FileAdapter({ memoryRoot: this.memoryRoot });
  }

  get coordinationScope(): object { return this.coordinator.coordinationScope; }

  /** 필요할 때 호출부가 전체 작업을 감싼다. save 안에서는 이 잠금을 다시 잡지 않는다. */
  withOwnerLock<T>(ownerId: string, run: () => Promise<T>): Promise<T> {
    identity(ownerId);
    return this.coordinator.withOwnerLock(ownerId, run);
  }

  private directory(directory: string, create: boolean): boolean {
    let stat: fs.Stats;
    try { stat = fs.lstatSync(directory); }
    catch (cause) {
      if (codeOf(cause) !== 'ENOENT') throw cause;
      if (!create) return false;
      try { fs.mkdirSync(directory, { mode: 0o700 }); }
      catch (error) { if (codeOf(error) !== 'EEXIST') throw error; }
      stat = fs.lstatSync(directory);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new FileJJumV5StoreError('unavailable', 'Storage directories must not be symbolic');
    }
    return true;
  }

  private ensureBucket(create: boolean): boolean {
    this.directory(this.memoryRoot, false);
    return this.directory(this.bucket, create);
  }

  private readFile(filename: string, scopedOwnerId?: string): DiskRecord {
    let fd: number | undefined;
    try {
      fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      if (!fs.fstatSync(fd).isFile()) throw new FileJJumV5StoreError('corrupt', 'A JJum record must be a regular file');
      const bytes = fs.readFileSync(fd);
      const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!object(raw) || typeof raw.ownerId !== 'string' || !raw.ownerId.trim()) {
        throw new FileJJumV5StoreError('corrupt', 'A stored JJum has no valid identity');
      }
      // 소유자가 식별된 다른 사용자의 손상 자료는 현재 사용자의 처리를 막지 않는다.
      if ((scopedOwnerId === undefined || raw.ownerId === scopedOwnerId)
        && (typeof raw.jjumId !== 'string' || !raw.jjumId.trim())) {
        throw new FileJJumV5StoreError('corrupt', 'A stored JJum has no valid identity');
      }
      return { filename, raw, etag: hash(bytes) };
    } catch (cause) {
      if (cause instanceof FileJJumV5StoreError) throw cause;
      throw new FileJJumV5StoreError('corrupt', 'A JJum record cannot be read safely; original contents were preserved', [], { cause });
    } finally { if (fd !== undefined) fs.closeSync(fd); }
  }

  private scan(ownerId: string): DiskRecord[] {
    if (!this.ensureBucket(false)) return [];
    const records: DiskRecord[] = [];
    const seen = new Set<string>();
    for (const entry of fs.readdirSync(this.bucket, { withFileTypes: true })) {
      if (!entry.name.endsWith('.jj') || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new FileJJumV5StoreError('corrupt', 'JJum paths must be regular files');
      }
      const record = this.readFile(path.join(this.bucket, entry.name), ownerId);
      if (record.raw.ownerId !== ownerId) continue;
      const id = record.raw.jjumId as string;
      if (seen.has(id)) throw new FileJJumV5StoreError('corrupt', 'Duplicate stored JJum identity requires review');
      seen.add(id);
      records.push(record);
    }
    return records;
  }

  private checked(record: DiskRecord): FileJJumV5Record {
    if (record.raw.schemaVersion !== 5) {
      throw new FileJJumV5StoreError('unsupported_version', 'This storage path only updates schema version 5');
    }
    const result = validateJJumV5(record.raw, { requireTypePolicies: false });
    if (!result.ok || !result.jjum) {
      throw new FileJJumV5StoreError('corrupt', 'The stored v5 JJum failed structural validation', result.issues);
    }
    return { jjum: result.jjum, etag: record.etag };
  }

  async read(ownerId: string, jjumId: string): Promise<FileJJumV5Record | null> {
    identity(ownerId); identity(jjumId);
    const record = this.scan(ownerId).find(item => item.raw.jjumId === jjumId);
    return record ? this.checked(record) : null;
  }

  async list(ownerId: string): Promise<FileJJumV5Record[]> {
    identity(ownerId);
    return this.scan(ownerId).filter(record => {
      const version = record.raw.schemaVersion;
      // 기존 버전과 버전 없는 자료는 이 경로의 대상이 아니다. 문자열 등 손상된 버전은 추정하지 않는다.
      return version !== undefined && !(Number.isInteger(version) && (version as number) <= 4);
    }).map(record => this.checked(record));
  }

  private preserveExisting(previous: JJumV5, next: JJumV5): void {
    const fail = (field: string) => {
      throw new FileJJumV5StoreError('conflict', `The existing ${field} must be preserved; record corrections as new evidence`);
    };
    for (const field of ['ownerId', 'jjumId', 'hostChatbotId', 'sourceService', 'firstSeen'] as const) {
      if (previous[field] !== next[field]) fail(field);
    }
    const prefix = (before: unknown[] | undefined, after: unknown[] | undefined, field: string) => {
      if (before && (!after || after.length < before.length || !isDeepStrictEqual(before, after.slice(0, before.length)))) fail(field);
    };
    for (const field of ['mentionHistory', 'editHistory', 'powerHistory', 'mannerHistory',
      'recallHistory', 'hostProactiveMentionHistory'] as const) prefix(previous[field], next[field], field);
    if (previous.mentionHistoryChunks) {
      if (!next.mentionHistoryChunks || next.mentionHistoryChunks.length < previous.mentionHistoryChunks.length) fail('mentionHistoryChunks');
      previous.mentionHistoryChunks.forEach((chunk, index) => {
        const added = next.mentionHistoryChunks![index];
        if (chunk.sequence !== added.sequence) fail('mentionHistoryChunks.sequence');
        prefix(chunk.entries, added.entries, `mentionHistoryChunks[${index}].entries`);
      });
    }
    for (const field of ['mentionCount', 'recallCount'] as const) if (next[field] < previous[field]) fail(field);
    const newEdits = (next.editHistory?.length ?? 0) - (previous.editHistory?.length ?? 0);
    for (const field of ['jjumName', 'summary', 'type'] as const) {
      if (!isDeepStrictEqual(previous[field], next[field]) && newEdits < 1) fail(`${field} edit history`);
    }
    for (const field of ['facts', 'events'] as const) {
      if (previous[field] && !isDeepStrictEqual(previous[field], next[field])) {
        if (!next[field] || newEdits < 1) fail(field);
      }
    }
    const addedPowerHistory = next.powerHistory?.slice(previous.powerHistory?.length ?? 0) ?? [];
    const powerChanged = previous.jjumPower !== next.jjumPower
      || !isDeepStrictEqual(previous.powerCalculation, next.powerCalculation);
    if (powerChanged && addedPowerHistory.length === 0) fail('power change history');
    let power = previous.jjumPower;
    let calculation = previous.powerCalculation;
    for (const entry of addedPowerHistory) {
      if (entry.previousPower !== power || !isDeepStrictEqual(entry.previousCalculation, calculation)) fail('power history before-state');
      prefix(calculation?.evidence, entry.calculation.evidence, 'power evidence');
      power = entry.power;
      calculation = entry.calculation;
    }
    prefix(previous.powerCalculation?.evidence, next.powerCalculation?.evidence, 'power evidence');
    if (addedPowerHistory.length > 0
      && (power !== next.jjumPower || !isDeepStrictEqual(calculation, next.powerCalculation))) fail('power history after-state');
    const addedMannerHistory = next.mannerHistory?.slice(previous.mannerHistory?.length ?? 0) ?? [];
    if (previous.mentionSuitability !== next.mentionSuitability && addedMannerHistory.length === 0) fail('manner change history');
    let manner = previous.mentionSuitability;
    for (const entry of addedMannerHistory) {
      if (entry.previousValue !== manner) fail('manner history before-state');
      manner = entry.value;
    }
    if (addedMannerHistory.length > 0 && manner !== next.mentionSuitability) fail('manner history after-state');
    this.checkHistoryChain(next, 'conflict');
  }

  private checkHistoryChain(jjum: JJumV5, code: 'invalid' | 'conflict'): void {
    const fail = (field: string) => {
      throw new FileJJumV5StoreError(code, `The ${field} must form an unbroken chain to the current value`);
    };
    const powerHistory = jjum.powerHistory ?? [];
    for (let i = 1; i < powerHistory.length; i++) {
      const prior = powerHistory[i - 1], current = powerHistory[i];
      if (current.previousPower !== prior.power || !isDeepStrictEqual(current.previousCalculation, prior.calculation)) fail('power history');
      if (current.calculation.evidence.length < prior.calculation.evidence.length
        || !isDeepStrictEqual(prior.calculation.evidence, current.calculation.evidence.slice(0, prior.calculation.evidence.length))) fail('power evidence history');
    }
    const lastPower = powerHistory.at(-1);
    if (lastPower && (lastPower.power !== jjum.jjumPower || !isDeepStrictEqual(lastPower.calculation, jjum.powerCalculation))) fail('power history');
    const mannerHistory = jjum.mannerHistory ?? [];
    for (let i = 1; i < mannerHistory.length; i++) {
      if (mannerHistory[i].previousValue !== mannerHistory[i - 1].value) fail('manner history');
    }
    if (mannerHistory.length > 0 && mannerHistory.at(-1)!.value !== jjum.mentionSuitability) fail('manner history');
  }

  private newFilename(jjum: JJumV5, options: SaveJJumV5Options): string {
    const name = options.maskedName ?? this.maskedName?.(structuredClone(jjum));
    if (typeof name !== 'string' || !name.trim()) {
      throw new FileJJumV5StoreError('invalid', 'New v5 records require an explicitly supplied masked filename');
    }
    const sanitized = name.trim().replace(/[/\\:*?"<>|\u0000-\u001f\u007f-\u009f\s]/gu, '_');
    const stem = Array.from(sanitized).slice(0, 40).join('') || 'jjum';
    const safeStem = /^[_.]/u.test(stem) ? `jjum${stem}` : stem;
    return path.join(this.bucket, `${safeStem}-${hash(JSON.stringify([jjum.ownerId, jjum.jjumId]))}.jj`);
  }

  private validateForSave(jjum: unknown): JJumV5 {
    const validation = validateJJumV5(jjum, { typeRequirements: this.typeRequirements });
    if (!validation.ok || !validation.jjum) {
      const pending = validation.validStructure && validation.policyPending.length > 0;
      throw new FileJJumV5StoreError(pending ? 'policy_pending' : 'invalid',
        pending ? 'Type requirements are not ready for persistence' : 'The v5 JJum failed storage validation', validation.issues);
    }
    return validation.jjum;
  }

  async save(jjum: JJumV5, options: SaveJJumV5Options = {}): Promise<FileJJumV5Record> {
    if (!object(jjum) || jjum.schemaVersion !== 5) {
      throw new FileJJumV5StoreError('invalid', 'This save requires an explicit v5 record');
    }
    identity(jjum.ownerId); identity(jjum.jjumId);
    if (options.expectedEtag !== undefined && !/^[a-f0-9]{64}$/u.test(options.expectedEtag)
      || options.createOnly !== undefined && typeof options.createOnly !== 'boolean'
      || options.createOnly === true && options.expectedEtag !== undefined) {
      throw new FileJJumV5StoreError('invalid', 'Choose createOnly or a valid expectedEtag for an update');
    }
    // 신규 자료는 디렉터리를 만들기 전에 검사한다. 갱신은 CAS가 확인된 원본을 보존한 뒤 검사한다.
    const created = options.createOnly === true ? this.validateForSave(jjum) : undefined;
    let lock: string | undefined;
    let temporary: string | undefined;
    let committed = false;
    try {
      this.ensureBucket(true);
      const locks = path.join(this.bucket, '.v5-write-locks');
      this.directory(locks, true);
      const candidate = path.join(locks, `${hash(JSON.stringify([jjum.ownerId, jjum.jjumId]))}.lock`);
      try { fs.mkdirSync(candidate, { mode: 0o700 }); lock = candidate; }
      catch (cause) {
        if (codeOf(cause) === 'EEXIST') throw new FileJJumV5StoreError('locked', 'Another writer or an unresolved lock is present');
        throw cause;
      }
      const existing = this.scan(jjum.ownerId).find(item => item.raw.jjumId === jjum.jjumId);
      let snapshot: JJumV5;
      if (existing) {
        const previous = this.checked(existing).jjum;
        if (options.createOnly || !options.expectedEtag || options.expectedEtag !== existing.etag) {
          throw new FileJJumV5StoreError('conflict', 'The existing v5 JJum requires its current expectedEtag');
        }
        snapshot = this.validateForSave(preserveOmittedJJumV5Optionals(jjum, previous));
        this.preserveExisting(previous, snapshot);
      } else {
        if (!created) throw new FileJJumV5StoreError('conflict', 'Missing records require explicit createOnly');
        snapshot = created;
      }
      if (!existing) this.checkHistoryChain(snapshot, 'invalid');
      const filename = existing?.filename ?? this.newFilename(snapshot, options);
      if (!existing && exists(filename)) {
        throw new FileJJumV5StoreError('conflict', 'The proposed filename is already occupied');
      }
      const bytes = `${JSON.stringify(snapshot, null, 2)}\n`;
      temporary = path.join(this.bucket, `.${randomUUID()}.v5.tmp`);
      const fd = fs.openSync(temporary, 'wx', 0o600);
      try { fs.writeFileSync(fd, bytes, 'utf8'); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
      this.ensureBucket(false);
      if (existing) {
        const latest = this.readFile(filename);
        if (latest.etag !== existing.etag) throw new FileJJumV5StoreError('conflict', 'The JJum changed while preparing its update');
      } else if (exists(filename)) {
        throw new FileJJumV5StoreError('conflict', 'The new filename became occupied');
      }
      fs.renameSync(temporary, filename);
      temporary = undefined;
      committed = true;
      return { jjum: snapshot, etag: hash(bytes) };
    } catch (cause) {
      if (cause instanceof FileJJumV5StoreError) throw cause;
      throw new FileJJumV5StoreError('unavailable', 'The v5 JJum could not be saved', [], { cause });
    } finally {
      if (temporary) { try { fs.unlinkSync(temporary); } catch { /* 미완료 임시 자료는 읽기 대상이 아니다. */ } }
      if (lock) {
        try { fs.rmdirSync(lock); }
        catch (cause) {
          if (!committed) throw new FileJJumV5StoreError('unavailable', 'The writer lock could not be released', [], { cause });
        }
      }
    }
  }
}

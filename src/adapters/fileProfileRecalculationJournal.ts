// @editedBy SherrySherry 2026-10-30
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  ProfileRecalculationJournal, RecalculationJournalRecord, RecalculationTargetIdentity,
} from '../profileRecalculation.ts';

const MAX_JOURNAL_BYTES = 64 * 1024 * 1024;
const ENTRY_STATUSES = new Set(['updated', 'unchanged', 'pending', 'conflict', 'failed']);

export class ProfileRecalculationJournalError extends Error {
  readonly code: 'invalid' | 'unavailable' | 'corrupt' | 'conflict' | 'locked';
  constructor(code: ProfileRecalculationJournalError['code'], message: string, options?: ErrorOptions) {
    super(message, options); this.name = 'ProfileRecalculationJournalError'; this.code = code;
  }
}

function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function code(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
}
function object(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some(key => !keys.includes(key))) throw new Error('Unsupported journal fields');
}
function text(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096 || /[\u0000-\u001f]/.test(value)) {
    throw new Error('Invalid journal identifier or reason');
  }
}
function time(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0
      || !Number.isFinite(new Date(value).getTime())) throw new Error('Invalid journal timestamp');
}
function target(value: unknown, profileId: string): asserts value is RecalculationTargetIdentity {
  object(value, ['profileId', 'profileVersion', 'coefficientDigest', 'packageVersion', 'seonRuleVersion', 'seonRuleDigest']);
  for (const key of ['profileId', 'profileVersion', 'coefficientDigest', 'seonRuleVersion', 'seonRuleDigest']) text(value[key]);
  if (value.packageVersion !== undefined) text(value.packageVersion);
  if (value.profileId !== profileId) throw new Error('Target profile scope differs');
}
function targetKey(value: RecalculationTargetIdentity): string {
  return JSON.stringify([value.profileId, value.profileVersion, value.coefficientDigest,
    value.packageVersion ?? null, value.seonRuleVersion, value.seonRuleDigest]);
}
function validate(value: unknown, ownerId: string, profileId: string): asserts value is RecalculationJournalRecord {
  object(value, ['schemaVersion', 'ownerId', 'profileId', 'revision', 'activeProfile', 'operations']);
  text(value.ownerId); text(value.profileId);
  if (value.schemaVersion !== 1 || value.ownerId !== ownerId || value.profileId !== profileId
      || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1 || !Array.isArray(value.operations)) {
    throw new Error('Invalid journal version, scope, revision, or operations');
  }
  const ids = new Set<string>();
  for (const operation of value.operations) {
    object(operation, ['operationId', 'targetIdentity', 'status', 'startedAt', 'updatedAt', 'completedAt', 'entries']);
    text(operation.operationId); target(operation.targetIdentity, profileId);
    if (ids.has(operation.operationId)) throw new Error('Duplicate operation ID');
    ids.add(operation.operationId);
    if (!['running', 'pending', 'complete'].includes(String(operation.status)) || !Array.isArray(operation.entries)) {
      throw new Error('Invalid operation state');
    }
    time(operation.startedAt); time(operation.updatedAt);
    if (operation.updatedAt < operation.startedAt) throw new Error('Operation time moved backwards');
    if (operation.completedAt !== undefined) {
      time(operation.completedAt);
      if (operation.completedAt < operation.startedAt || operation.completedAt > operation.updatedAt) {
        throw new Error('Invalid operation completion time');
      }
    } else if (operation.status === 'complete') throw new Error('Completed operation has no completion time');
    const entries = new Set<string>();
    for (const entry of operation.entries) {
      object(entry, ['jjumId', 'status', 'updatedAt', 'reasons']);
      text(entry.jjumId); time(entry.updatedAt);
      if (entries.has(entry.jjumId) || !ENTRY_STATUSES.has(String(entry.status))) throw new Error('Invalid or duplicate entry');
      entries.add(entry.jjumId);
      if (entry.reasons !== undefined) {
        if (!Array.isArray(entry.reasons)) throw new Error('Invalid entry reasons');
        entry.reasons.forEach(text);
      }
      if (operation.status === 'complete' && !['updated', 'unchanged'].includes(String(entry.status))) {
        throw new Error('Incomplete entries cannot be marked complete');
      }
    }
  }
  if (value.activeProfile !== undefined) {
    target(value.activeProfile, profileId);
    const activeKey = targetKey(value.activeProfile);
    if (!value.operations.some(operation => operation.completedAt !== undefined
      && targetKey(operation.targetIdentity) === activeKey)) throw new Error('Active target has no completed operation');
  }
}

/** 소유자·프로필별 재개 기록을 원자 교체한다. 쩜 전체의 일괄 원자 갱신을 뜻하지 않는다. */
export class FileProfileRecalculationJournal implements ProfileRecalculationJournal {
  private readonly root: string;
  private readonly storageId: string;
  private readonly rootIdentity: { dev: number; ino: number };

  constructor(options: { root: string }) {
    try {
      if (fs.lstatSync(options.root).isSymbolicLink()) throw new Error('Journal root cannot be a symbolic link');
      this.root = fs.realpathSync(options.root);
      const stat = fs.lstatSync(this.root);
      if (!stat.isDirectory()) throw new Error('Journal root must already be a directory');
      this.rootIdentity = { dev: stat.dev, ino: stat.ino };
      this.storageId = `profile-journal:${hash(this.root)}`;
      this.directory(false);
    } catch (cause) {
      throw new ProfileRecalculationJournalError('unavailable', 'Profile journal root is unavailable', { cause });
    }
  }

  private directory(create: boolean): string | null {
    // Canonical ancestors are checked again on every access; replacement roots are not accepted.
    const ancestors: string[] = [];
    for (let cursor = this.root; ; cursor = path.dirname(cursor)) {
      ancestors.unshift(cursor);
      if (cursor === path.dirname(cursor)) break;
    }
    for (const ancestor of ancestors) {
      const stat = fs.lstatSync(ancestor);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Journal ancestors must be regular directories');
      if (ancestor === this.root && (stat.dev !== this.rootIdentity.dev || stat.ino !== this.rootIdentity.ino)) {
        throw new Error('Journal root changed');
      }
    }
    const directory = path.join(this.root, 'profile-recalculation');
    let stat: fs.Stats;
    try { stat = fs.lstatSync(directory); }
    catch (cause) {
      if (code(cause) !== 'ENOENT') throw cause;
      if (!create) return null;
      try { fs.mkdirSync(directory, { mode: 0o700 }); }
      catch (error) { if (code(error) !== 'EEXIST') throw error; }
      stat = fs.lstatSync(directory);
      this.flushDirectory(this.root);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Journal directory must be regular');
    return directory;
  }

  private location(ownerId: string, profileId: string, create: boolean): string | null {
    try { text(ownerId); text(profileId); }
    catch (cause) { throw new ProfileRecalculationJournalError('invalid', 'Journal scope is invalid', { cause }); }
    const directory = this.directory(create);
    return directory ? path.join(directory, `${hash(JSON.stringify([ownerId, profileId]))}.json`) : null;
  }

  private flushDirectory(directory: string): void {
    const fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }

  private lock(file: string, kind: 'run' | 'write'): () => void {
    const lock = `${file}.${kind}.lock`;
    try { fs.mkdirSync(lock, { mode: 0o700 }); }
    catch (cause) {
      throw new ProfileRecalculationJournalError(code(cause) === 'EEXIST' ? 'locked' : 'unavailable',
        'Profile journal is locked or unavailable; existing lock was preserved', { cause });
    }
    const identity = fs.lstatSync(lock);
    return () => {
      // Never remove a lock replaced by another process or a leftover lock we did not acquire.
      try {
        this.directory(false);
        const current = fs.lstatSync(lock);
        if (!current.isSymbolicLink() && current.isDirectory()
            && current.dev === identity.dev && current.ino === identity.ino) fs.rmdirSync(lock);
      } catch { /* A retained lock requires an explicit recovery decision. */ }
    };
  }

  async withRun<T>(ownerId: string, profileId: string, run: () => Promise<T>): Promise<T> {
    let release: (() => void) | undefined;
    try {
      release = this.lock(this.location(ownerId, profileId, true)!, 'run');
      return await run();
    } catch (cause) {
      if (release || cause instanceof ProfileRecalculationJournalError) throw cause;
      throw new ProfileRecalculationJournalError('unavailable', 'Profile journal run cannot start', { cause });
    } finally { release?.(); }
  }

  read(ownerId: string, profileId: string): RecalculationJournalRecord | null {
    let fd: number | undefined;
    let contents: string;
    try {
      const file = this.location(ownerId, profileId, false);
      if (!file) return null;
      try { fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); }
      catch (cause) { if (code(cause) === 'ENOENT') return null; throw cause; }
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > MAX_JOURNAL_BYTES) throw new Error('Unsupported journal file');
      contents = fs.readFileSync(fd, 'utf8');
    } catch (cause) {
      if (cause instanceof ProfileRecalculationJournalError) throw cause;
      throw new ProfileRecalculationJournalError('unavailable', 'Profile journal cannot be read', { cause });
    } finally { if (fd !== undefined) fs.closeSync(fd); }
    try {
      const stored = JSON.parse(contents);
      object(stored, ['storageId', 'record']);
      if (stored.storageId !== this.storageId) throw new Error('Journal storage scope differs');
      validate(stored.record, ownerId, profileId);
      return stored.record;
    } catch (cause) {
      throw new ProfileRecalculationJournalError('corrupt', 'Invalid profile journal was preserved', { cause });
    }
  }

  write(record: RecalculationJournalRecord, expectedRevision: number | null): void {
    try {
      validate(record, record.ownerId, record.profileId);
      if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)) throw new Error('Invalid expected revision');
      if (record.revision !== (expectedRevision ?? 0) + 1) throw new Error('Journal revision must increase by one');
    } catch (cause) {
      throw new ProfileRecalculationJournalError('invalid', 'Journal update is invalid', { cause });
    }
    let release: (() => void) | undefined;
    let temporary: string | undefined;
    try {
      const file = this.location(record.ownerId, record.profileId, true)!;
      release = this.lock(file, 'write');
      const previous = this.read(record.ownerId, record.profileId);
      if ((previous?.revision ?? null) !== expectedRevision) {
        throw new ProfileRecalculationJournalError('conflict', 'Profile journal revision changed');
      }
      const nextOperations = new Map(record.operations.map(operation => [operation.operationId, operation]));
      const previousOperations = new Map(previous?.operations.map(operation => [operation.operationId, operation]));
      for (const next of record.operations) {
        const prior = previousOperations.get(next.operationId);
        if (next.completedAt !== undefined && prior?.completedAt === undefined && next.status !== 'complete') {
          throw new ProfileRecalculationJournalError('conflict', 'First completion can only be recorded for a completed operation');
        }
      }
      for (const prior of previous?.operations ?? []) {
        const next = nextOperations.get(prior.operationId);
        const nextEntries = new Set(next?.entries.map(entry => entry.jjumId));
        if (!next || targetKey(next.targetIdentity) !== targetKey(prior.targetIdentity)
            || next.startedAt !== prior.startedAt
            || (prior.completedAt !== undefined && next.completedAt !== prior.completedAt)
            || prior.entries.some(entry => !nextEntries.has(entry.jjumId))) {
          throw new ProfileRecalculationJournalError('conflict', 'Prior operation identity or entries cannot be removed or replaced');
        }
      }
      const bytes = `${JSON.stringify({ storageId: this.storageId, record })}\n`;
      if (Buffer.byteLength(bytes) > MAX_JOURNAL_BYTES) throw new ProfileRecalculationJournalError('invalid', 'Profile journal is too large');
      temporary = `${file}.${randomUUID()}.tmp`;
      const fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
      try { fs.writeFileSync(fd, bytes, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      this.directory(false);
      fs.renameSync(temporary, file);
      temporary = undefined;
      this.flushDirectory(path.dirname(file));
    } catch (cause) {
      if (cause instanceof ProfileRecalculationJournalError) throw cause;
      throw new ProfileRecalculationJournalError('unavailable', 'Profile journal write failed; reread before retrying', { cause });
    } finally {
      if (temporary) {
        try { this.directory(false); fs.unlinkSync(temporary); } catch { /* Preserve anything whose identity is uncertain. */ }
      }
      release?.();
    }
  }
}

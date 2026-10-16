// @editedBy SherrySherry 2026-10-16
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  reconcileTokenUsageReport,
  summarizeConversationTokenUsage,
  validateTokenUsageReport,
  type TokenUsageReport,
} from '../tokenUsage.ts';

type ConversationSummary = ReturnType<typeof summarizeConversationTokenUsage>;

export type TokenUsageConversation = ConversationSummary & {
  schemaVersion: 2;
  scope: 'haema';
  unit: 'tokens';
  ownerId: string;
  storageId: string;
  conversationId: string;
  revision: number;
  /** false means no ledger exists; it does not establish historical consumption as zero. */
  found: boolean;
  reports: TokenUsageReport[];
};

interface StoredConversation {
  schemaVersion: 2;
  scope: 'haema';
  unit: 'tokens';
  ownerId: string;
  storageId: string;
  conversationId: string;
  revision: number;
  reports: TokenUsageReport[];
}

export class TokenUsageStoreError extends Error {
  readonly code: 'unavailable' | 'corrupt' | 'conflict' | 'locked';

  constructor(code: TokenUsageStoreError['code'], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TokenUsageStoreError';
    this.code = code;
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function errorCode(error: unknown): string | undefined {
  return error !== null && typeof error === 'object' && 'code' in error
    ? String(error.code) : undefined;
}

function identifier(value: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('Token usage scope identifiers must be non-empty strings');
  }
}

/** Synchronous, atomic ledgers; process contention fails rather than dropping an update. */
export class FileTokenUsageStore {
  readonly storageId: string;
  private readonly root: string;

  constructor(memoryRoot: string) {
    try {
      this.root = fs.realpathSync(memoryRoot);
      if (!fs.statSync(this.root).isDirectory()) throw new Error('Storage root is not a directory');
      this.storageId = `file:${hash(this.root)}`;
    } catch (cause) {
      throw new TokenUsageStoreError('unavailable', 'Token usage storage root is unavailable', { cause });
    }
  }

  private location(ownerId: string, conversationId: string): { directories: string[]; file: string } {
    identifier(ownerId);
    identifier(conversationId);
    const system = path.join(this.root, '.🫀해마_심층_중추신경계🫀');
    const usage = path.join(system, 'token-usage');
    const owner = path.join(usage, hash(ownerId));
    return { directories: [system, usage, owner], file: path.join(owner, `${hash(conversationId)}.json`) };
  }

  private directories(directories: string[], create: boolean): boolean {
    for (const directory of directories) {
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(directory);
      } catch (cause) {
        if (errorCode(cause) !== 'ENOENT') throw cause;
        if (!create) return false;
        try { fs.mkdirSync(directory, { mode: 0o700 }); }
        catch (error) { if (errorCode(error) !== 'EEXIST') throw error; }
        stat = fs.lstatSync(directory);
      }
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new TokenUsageStoreError('unavailable', 'Token usage path must contain regular directories');
      }
    }
    return true;
  }

  private readStored(ownerId: string, conversationId: string): StoredConversation | null {
    const { directories, file } = this.location(ownerId, conversationId);
    let text: string;
    try {
      if (!this.directories(directories, false)) return null;
      let stat: fs.Stats;
      try { stat = fs.lstatSync(file); }
      catch (cause) { if (errorCode(cause) === 'ENOENT') return null; throw cause; }
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new TokenUsageStoreError('unavailable', 'Token usage ledger must be a regular file');
      }
      text = fs.readFileSync(file, 'utf8');
    } catch (cause) {
      if (cause instanceof TokenUsageStoreError) throw cause;
      throw new TokenUsageStoreError('unavailable', 'Token usage ledger cannot be read', { cause });
    }

    try {
      const stored = JSON.parse(text) as StoredConversation;
      if (stored === null || typeof stored !== 'object' || Array.isArray(stored)
          || stored.schemaVersion !== 2 || stored.scope !== 'haema' || stored.unit !== 'tokens'
          || stored.ownerId !== ownerId || stored.storageId !== this.storageId
          || stored.conversationId !== conversationId
          || !Number.isSafeInteger(stored.revision) || stored.revision < 1 || !Array.isArray(stored.reports)) {
        throw new TypeError('Invalid token usage ledger metadata');
      }
      const reports = stored.reports.map((report) => validateTokenUsageReport(report));
      if (new Set(reports.map((report) => report.usageId)).size !== reports.length) {
        throw new TypeError('Duplicate usageId in persisted token usage ledger');
      }
      summarizeConversationTokenUsage(reports, { ownerId, storageId: this.storageId, conversationId });
      return {
        schemaVersion: 2, scope: 'haema', unit: 'tokens', ownerId, storageId: this.storageId,
        conversationId, revision: stored.revision, reports,
      };
    } catch (cause) {
      throw new TokenUsageStoreError('corrupt', 'Token usage ledger is invalid; original file was preserved', { cause });
    }
  }

  read(ownerId: string, conversationId: string): TokenUsageConversation {
    const stored = this.readStored(ownerId, conversationId);
    const reports = stored?.reports ?? [];
    return {
      ...summarizeConversationTokenUsage(reports, { ownerId, storageId: this.storageId, conversationId }),
      schemaVersion: 2, scope: 'haema', unit: 'tokens', ownerId, storageId: this.storageId,
      conversationId, revision: stored?.revision ?? 0, found: stored !== null, reports,
    };
  }

  save(report: TokenUsageReport): void {
    const incoming = validateTokenUsageReport(report);
    if (incoming.storageId !== this.storageId) {
      throw new TokenUsageStoreError('conflict', 'Token usage report belongs to another storage root');
    }
    const { ownerId, conversationId } = incoming;
    const { directories, file } = this.location(ownerId, conversationId);
    const lock = `${file}.lock`;
    let acquired = false;
    let temporary: string | null = null;
    try {
      this.directories(directories, true);
      try { fs.mkdirSync(lock, { mode: 0o700 }); acquired = true; }
      catch (cause) {
        if (errorCode(cause) === 'EEXIST') {
          throw new TokenUsageStoreError('locked', 'Token usage ledger has another writer or an unresolved lock');
        }
        throw cause;
      }
      const previous = this.readStored(ownerId, conversationId);
      const reports = previous?.reports ?? [];
      const index = reports.findIndex((entry) => entry.usageId === incoming.usageId);
      let canonical: TokenUsageReport;
      try {
        canonical = index < 0 ? incoming : reconcileTokenUsageReport(reports[index], incoming);
        if (index >= 0 && JSON.stringify(reports[index]) === JSON.stringify(canonical)) return;
        if (index < 0) reports.push(canonical);
        else reports[index] = canonical;
        // This also rejects reusing one actual call under different usage IDs.
        summarizeConversationTokenUsage(reports, { ownerId, storageId: this.storageId, conversationId });
      } catch (cause) {
        throw new TokenUsageStoreError('conflict', 'Token usage report conflicts with persisted usage', { cause });
      }
      const revision = (previous?.revision ?? 0) + 1;
      if (!Number.isSafeInteger(revision)) {
        throw new TokenUsageStoreError('unavailable', 'Token usage ledger revision exceeds the supported range');
      }
      const stored: StoredConversation = {
        schemaVersion: 2, scope: 'haema', unit: 'tokens', ownerId, storageId: this.storageId,
        conversationId, revision, reports,
      };
      temporary = `${file}.${randomUUID()}.tmp`;
      const descriptor = fs.openSync(temporary, 'wx', 0o600);
      try {
        fs.writeFileSync(descriptor, `${JSON.stringify(stored)}\n`, 'utf8');
        fs.fsyncSync(descriptor);
      } finally { fs.closeSync(descriptor); }
      fs.renameSync(temporary, file);
      temporary = null;
    } catch (cause) {
      if (cause instanceof TokenUsageStoreError) throw cause;
      throw new TokenUsageStoreError('unavailable', 'Token usage ledger cannot be saved', { cause });
    } finally {
      if (temporary !== null) {
        try { fs.unlinkSync(temporary); } catch { /* A failed temporary file is never read as a ledger. */ }
      }
      if (acquired) {
        try { fs.rmdirSync(lock); }
        catch (cause) {
          throw new TokenUsageStoreError('unavailable', 'Token usage writer lock could not be released', { cause });
        }
      }
    }
  }
}

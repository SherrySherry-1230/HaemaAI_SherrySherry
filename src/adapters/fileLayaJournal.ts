// @editedBy SherrySherry 2026-10-31
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { LayaJournalError, layaDigest, validateLayaScope, type LayaJournal, type LayaJournalEntry, type LayaScope } from '../layaJournal.ts';

/** 단일 파일을 원자 교체한다. 실패·잠금 잔존은 원본을 보존하며 빈 이력으로 덮어쓰지 않는다. */
export class FileLayaJournal implements LayaJournal {
  private readonly root: string;
  private readonly maxBytes: number;
  private readonly maxEntries: number;
  constructor(options: { root: string; maxBytes?: number; maxEntries?: number }) {
    const stat = fs.lstatSync(options.root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new LayaJournalError('unavailable', 'Journal root must be a regular directory');
    this.root = fs.realpathSync(options.root);
    this.maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
    this.maxEntries = options.maxEntries ?? 20_000;
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes < 1024 || !Number.isSafeInteger(this.maxEntries) || this.maxEntries < 1) {
      throw new LayaJournalError('invalid', 'Invalid journal capacity');
    }
  }
  private directory(): string {
    const directory = path.join(this.root, '.laya-journal');
    try { fs.mkdirSync(directory, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new LayaJournalError('unavailable', 'Journal directory is not regular');
    return directory;
  }
  private load(scope: LayaScope, filename: string): LayaJournalEntry[] {
    let fd: number;
    try { fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw new LayaJournalError('unavailable', 'Journal cannot be opened'); }
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > this.maxBytes) throw new Error('invalid');
      const decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(fd)));
      if (decoded.schemaVersion !== 1 || layaDigest(decoded.scope) !== layaDigest(scope) || !Array.isArray(decoded.entries)
        || decoded.entries.length > this.maxEntries) throw new Error('invalid');
      const keys = new Set<string>();
      for (const entry of decoded.entries) {
        if (!entry || typeof entry.kind !== 'string' || typeof entry.key !== 'string' || typeof entry.createdAt !== 'string'
          || !Number.isFinite(Date.parse(entry.createdAt)) || !Number.isFinite(Date.parse(entry.updatedAt))
          || !entry.data || typeof entry.data !== 'object' || Array.isArray(entry.data)) throw new Error('invalid');
        const key = JSON.stringify([entry.kind, entry.key]); if (keys.has(key)) throw new Error('duplicate'); keys.add(key);
      }
      return decoded.entries;
    } catch { throw new LayaJournalError('corrupt', 'Journal validation failed; the original was preserved'); }
    finally { fs.closeSync(fd); }
  }
  async read(scope: LayaScope): Promise<LayaJournalEntry[]> {
    validateLayaScope(scope);
    return structuredClone(this.load(scope, path.join(this.directory(), `${layaDigest(scope)}.json`)));
  }
  async transaction<T>(scope: LayaScope, mutate: (entries: LayaJournalEntry[]) => T): Promise<T> {
    validateLayaScope(scope);
    const directory = this.directory(), filename = path.join(directory, `${layaDigest(scope)}.json`), lock = `${filename}.lock`;
    let acquired = false, temporary: string | undefined, mutationFailed = false;
    try {
      try { fs.mkdirSync(lock, { mode: 0o700 }); acquired = true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new LayaJournalError('locked', 'Journal is busy or an interrupted writer needs recovery'); throw error; }
      const entries = this.load(scope, filename);
      let result: T;
      try { result = mutate(entries); } catch (error) { mutationFailed = true; throw error; }
      if (result && typeof result === 'object' && 'then' in result) throw new LayaJournalError('invalid', 'Journal mutations must be synchronous');
      const detachedResult = structuredClone(result);
      if (entries.length > this.maxEntries) throw new LayaJournalError('capacity', 'Journal retention capacity reached');
      // JSON 적합성을 검사하여 호출자의 미정 값을 조용히 버리지 않는다.
      layaDigest(entries);
      const data = JSON.stringify({ schemaVersion: 1, scope, entries });
      if (Buffer.byteLength(data) > this.maxBytes) throw new LayaJournalError('capacity', 'Journal byte capacity reached');
      temporary = path.join(directory, `.${randomUUID()}.tmp`);
      const fd = fs.openSync(temporary, 'wx', 0o600);
      try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temporary, filename); temporary = undefined;
      return detachedResult;
    } catch (error) {
      if (mutationFailed || error instanceof LayaJournalError) throw error;
      throw new LayaJournalError('unavailable', 'Journal transaction failed; the original was preserved');
    } finally {
      if (temporary) { try { fs.unlinkSync(temporary); } catch { /* 미완료 임시 파일은 읽지 않는다. */ } }
      if (acquired) fs.rmdirSync(lock);
    }
  }
}

// @editedBy SherrySherry 2026-10-20
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  emptyIntroduction,
  IntroductionStoreError,
  MAX_INTRODUCTION_TEXT_BYTES,
  validateDisplayName,
  validateIntroductionOwnerId,
  validateIntroductionRevision,
  validateIntroductionText,
  type Introduction,
} from '../introduction.ts';

export { IntroductionStoreError, type Introduction } from '../introduction.ts';

const RELATION_FOLDER = '☺️♥️🤖엔드유저와의 관계를 위하여🤖♥️☺️';

interface StoredIntroduction {
  schemaVersion: 1;
  storageId: string;
  ownerId: string;
  introduction: Introduction;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function errorCode(error: unknown): string | undefined {
  return error !== null && typeof error === 'object' && 'code' in error
    ? String(error.code) : undefined;
}

/** 파일별 잠금과 revision 비교 후 임시 파일을 원자 교체한다. */
export class FileIntroductionStore {
  readonly storageId: string;
  private readonly root: string;

  constructor(memoryRoot: string) {
    try {
      this.root = fs.realpathSync(memoryRoot);
      if (!fs.statSync(this.root).isDirectory()) throw new Error('Storage root is not a directory');
      this.storageId = `file:${hash(this.root)}`;
    } catch (cause) {
      throw new IntroductionStoreError('unavailable', 'Introduction storage root is unavailable', { cause });
    }
  }

  private location(ownerId: string): { directories: string[]; file: string } {
    validateIntroductionOwnerId(ownerId);
    const relation = path.join(this.root, RELATION_FOLDER);
    const introductions = path.join(relation, 'introductions');
    return { directories: [relation, introductions], file: path.join(introductions, `${hash(ownerId)}.json`) };
  }

  private directories(directories: string[], create: boolean): boolean {
    const root = fs.lstatSync(this.root);
    if (root.isSymbolicLink() || !root.isDirectory()) {
      throw new IntroductionStoreError('unavailable', 'Introduction storage root must be a regular directory');
    }
    for (const directory of directories) {
      let stat: fs.Stats;
      try { stat = fs.lstatSync(directory); }
      catch (cause) {
        if (errorCode(cause) !== 'ENOENT') throw cause;
        if (!create) return false;
        try { fs.mkdirSync(directory, { mode: 0o700 }); }
        catch (error) { if (errorCode(error) !== 'EEXIST') throw error; }
        stat = fs.lstatSync(directory);
      }
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new IntroductionStoreError('unavailable', 'Introduction storage path must contain regular directories');
      }
    }
    return true;
  }

  private readStored(ownerId: string): Introduction | null {
    const { directories, file } = this.location(ownerId);
    let text: string;
    let descriptor: number | undefined;
    try {
      if (!this.directories(directories, false)) return null;
      try { descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); }
      catch (cause) { if (errorCode(cause) === 'ENOENT') return null; throw cause; }
      const stat = fs.fstatSync(descriptor);
      if (!stat.isFile() || stat.size > MAX_INTRODUCTION_TEXT_BYTES * 6 + 16_384) {
        throw new IntroductionStoreError('corrupt', 'Introduction file is not a supported regular record');
      }
      text = fs.readFileSync(descriptor, 'utf8');
    } catch (cause) {
      if (cause instanceof IntroductionStoreError) throw cause;
      throw new IntroductionStoreError('unavailable', 'Introduction cannot be read', { cause });
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }

    try {
      const stored = JSON.parse(text) as StoredIntroduction;
      if (stored === null || typeof stored !== 'object' || Array.isArray(stored)
          || stored.schemaVersion !== 1 || stored.ownerId !== ownerId || stored.storageId !== this.storageId) {
        throw new Error('Introduction scope does not match the record');
      }
      const value = stored.introduction;
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Missing introduction');
      validateIntroductionText(value.text);
      validateDisplayName(value.displayName);
      validateIntroductionRevision(value.revision);
      if (value.revision < 1 || typeof value.updatedAt !== 'string'
          || !Number.isFinite(Date.parse(value.updatedAt))
          || new Date(value.updatedAt).toISOString() !== value.updatedAt) throw new Error('Invalid persisted revision or time');
      return { text: value.text, displayName: value.displayName, revision: value.revision, updatedAt: value.updatedAt };
    } catch (cause) {
      throw new IntroductionStoreError('corrupt', 'Introduction is invalid; original file was preserved', { cause });
    }
  }

  read(ownerId: string): Introduction {
    return this.readStored(ownerId) ?? emptyIntroduction();
  }

  save(ownerId: string, value: { text: string; displayName: string }, expectedRevision: number,
    beforeCommit?: () => void): Introduction {
    validateIntroductionOwnerId(ownerId);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new IntroductionStoreError('invalid', 'Introduction save requires text and displayName');
    }
    validateIntroductionText(value.text);
    validateDisplayName(value.displayName);
    validateIntroductionRevision(expectedRevision);
    const { directories, file } = this.location(ownerId);
    const lock = `${file}.lock`;
    let acquired = false;
    let committed = false;
    let temporary: string | null = null;
    try {
      this.directories(directories, true);
      try { fs.mkdirSync(lock, { mode: 0o700 }); acquired = true; }
      catch (cause) {
        if (errorCode(cause) === 'EEXIST') {
          throw new IntroductionStoreError('locked', 'Introduction has another writer or an unresolved lock');
        }
        throw cause;
      }
      const previous = this.readStored(ownerId);
      if ((previous?.revision ?? 0) !== expectedRevision) {
        throw new IntroductionStoreError('conflict', 'Introduction was changed; reload before saving');
      }
      const revision = expectedRevision + 1;
      if (!Number.isSafeInteger(revision)) {
        throw new IntroductionStoreError('unavailable', 'Introduction revision exceeds the supported range');
      }
      const introduction: Introduction = {
        text: value.text, displayName: value.displayName, revision, updatedAt: new Date().toISOString(),
      };
      const stored: StoredIntroduction = { schemaVersion: 1, storageId: this.storageId, ownerId, introduction };
      temporary = `${file}.${randomUUID()}.tmp`;
      const descriptor = fs.openSync(temporary, 'wx', 0o600);
      try {
        fs.writeFileSync(descriptor, `${JSON.stringify(stored)}\n`, 'utf8');
        fs.fsyncSync(descriptor);
      } finally { fs.closeSync(descriptor); }
      // AI 선정 등 비동기 준비 이후에도 실제 연결을 마지막 교체 직전에 검증한다.
      beforeCommit?.();
      this.directories(directories, false);
      fs.renameSync(temporary, file);
      temporary = null;
      committed = true;
      return introduction;
    } catch (cause) {
      if (cause instanceof IntroductionStoreError) throw cause;
      throw new IntroductionStoreError('unavailable', 'Introduction cannot be saved; original record was preserved', { cause });
    } finally {
      if (temporary !== null) {
        try { fs.unlinkSync(temporary); } catch { /* 미완료 임시 파일은 읽기 대상이 아니다. */ }
      }
      if (acquired) {
        try { fs.rmdirSync(lock); }
        catch (cause) {
          // 완료된 교체를 실패로 보고하지 않는다. 남은 잠금은 후속 쓰기를 차단한다.
          if (!committed) throw new IntroductionStoreError('unavailable', 'Introduction writer lock could not be released', { cause });
        }
      }
    }
  }
}

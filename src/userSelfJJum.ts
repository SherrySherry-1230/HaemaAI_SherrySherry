// @editedBy SherrySherry 2026-10-30
import { FileAdapter, UnsupportedJJumSchemaError } from './adapters/fileAdapter.ts';
import { FileIntroductionStore } from './adapters/fileIntroductionStore.ts';
import { hasIntroductionEvidence, LEGACY_SELF_SUMMARY, withIntroductionEvidence } from './userIntroductionEvidence.ts';
import { createJJum } from './createJJum.ts';
import { IntroductionStoreError, type Introduction } from './introduction.ts';

export interface UserSelfJJumSync {
  jjumId: string;
  status: 'synced' | 'pending';
  syncedRevision: number;
  contentSynced?: true;
}

/** 소개 저장 이후 쩜 반영이 실패했다면 이미 저장된 소개를 숨기지 않는다. */
export class UserSelfJJumSyncError extends Error {
  readonly introduction: Introduction;
  readonly jjumId: string;
  constructor(introduction: Introduction, jjumId: string, cause: unknown) {
    super('Introduction was saved; user JJum synchronization is pending', { cause });
    this.name = 'UserSelfJJumSyncError';
    this.introduction = introduction;
    this.jjumId = jjumId;
  }
}

export function userSelfJJumSyncStatus(store: FileIntroductionStore, ownerId: string): UserSelfJJumSync | null {
  const binding = store.readUserSelfJJum(ownerId);
  if (!binding) return null;
  return { ...binding, status: binding.syncedRevision === store.read(ownerId).revision ? 'synced' : 'pending' };
}

export async function userSelfJJumContentStatus(store: FileIntroductionStore, ownerId: string,
  storage: FileAdapter, profile = store.read(ownerId)): Promise<UserSelfJJumSync | null> {
  assertSameStorage(store, storage);
  const status = userSelfJJumSyncStatus(store, ownerId);
  if (!status || status.status !== 'synced' || status.syncedRevision !== profile.revision) return status;
  // Introduction reads remain available when an older/independently edited bound memory cannot be read.
  try {
    const memory = await storage.getJJum(ownerId, status.jjumId);
    if (!memory || memory.status === 'merged') return { ...status, status: 'pending' };
    if (hasIntroductionEvidence(memory, profile.text)) return { ...status, contentSynced: true };
    if (memory.context?.userSelfIntroduction !== undefined || memory.facts.some(fact => fact.source === 'introduction')) {
      return { ...status, status: 'pending' };
    }
    return status;
  } catch { return { ...status, status: 'pending' }; }
}

function assertSameStorage(store: FileIntroductionStore, storage: FileAdapter): void {
  if (!storage.memoryRoot || new FileIntroductionStore(storage.memoryRoot).storageId !== store.storageId) {
    throw new IntroductionStoreError('conflict', 'Introduction and user JJum storage do not match');
  }
}

/** Reconcile only a completed, explicitly bound legacy profile during an authorized use.
 * Never create or rename a memory here, or advance an interrupted profile save. */
export async function ensureUserSelfJJumIntroduction(options: {
  storage: FileAdapter; store: FileIntroductionStore; ownerId: string; assertSelected?: () => void;
}): Promise<void> {
  const { storage, store, ownerId, assertSelected } = options;
  assertSameStorage(store, storage);
  if (!store.readUserSelfJJum(ownerId)) return;
  await storage.withOwnerLock(ownerId, () => store.withUserSelfJJumLock(ownerId, async () => {
    assertSelected?.();
    const profile = store.read(ownerId);
    const binding = store.readUserSelfJJum(ownerId);
    if (!binding || binding.syncedRevision !== profile.revision) return;
    const bound = await storage.getJJum(ownerId, binding.jjumId);
    assertSelected?.();
    if (!bound || bound.status === 'merged' || bound.schemaVersion !== 4) return;
    // Migration fills an unmarked legacy record only. A removed or changed fact stays under user control.
    if (bound.context?.userSelfIntroduction !== undefined || bound.facts.some(fact => fact.source === 'introduction')) return;
    await storage.renameJJumPreservingContent(ownerId, binding.jjumId, bound.jjumName,
      { introductionRevision: profile.revision, introduction: profile });
  }));
}

export function isPendingUserSelfJJumRetry(store: FileIntroductionStore, ownerId: string,
  value: { text: string; displayName?: string }, expectedRevision: number): boolean {
  const previous = store.read(ownerId);
  const binding = store.readUserSelfJJum(ownerId);
  return Boolean(binding && binding.syncedRevision < previous.revision
    && expectedRevision === previous.revision - 1 && previous.text === value.text
    && (value.displayName === undefined || previous.displayName === value.displayName));
}

/** Preserve the saved introduction as user-provided evidence on its explicitly bound self memory. */
export async function saveIntroductionWithUserSelfJJum(options: {
  storage: FileAdapter;
  store: FileIntroductionStore;
  ownerId: string;
  value: { text: string; displayName: string };
  expectedRevision: number;
  assertSelected?: () => void;
}): Promise<{ introduction: Introduction; userSelfJJum: UserSelfJJumSync }> {
  const { storage, store, ownerId, value, expectedRevision } = options;
  const assertSelected = options.assertSelected ?? (() => {});
  assertSameStorage(store, storage);
  return storage.withOwnerLock(ownerId, () => store.withUserSelfJJumLock(ownerId, async () => {
    assertSelected();
    const previous = store.read(ownerId);
    const previousBinding = store.readUserSelfJJum(ownerId);
    // 부분 저장된 동일 요청만 재개하며 다른 내용의 오래된 revision은 거절한다.
    const resume = isPendingUserSelfJJumRetry(store, ownerId, value, expectedRevision);
    if (previous.revision !== expectedRevision && !resume) {
      throw new IntroductionStoreError('conflict', 'Introduction was changed; reload before saving');
    }
    if (previousBinding) {
      const bound = await storage.getJJum(ownerId, previousBinding.jjumId).catch(error => {
        if (error instanceof UnsupportedJJumSchemaError) {
          throw new IntroductionStoreError('conflict', 'The bound user JJum requires explicit reconciliation');
        }
        throw error;
      });
      if (!bound && previousBinding.syncedRevision > 0) {
        throw new IntroductionStoreError('conflict', 'The bound user JJum is missing; it will not be recreated');
      }
      if (bound && (bound.schemaVersion !== 4 || bound.status === 'merged')) {
        throw new IntroductionStoreError('conflict', 'The bound user JJum requires explicit reconciliation');
      }
    }
    assertSelected();
    const introduction = resume ? previous
      : store.save(ownerId, value, expectedRevision, assertSelected, { linkUserSelfJJum: true });
    const binding = store.readUserSelfJJum(ownerId)!;
    try {
      assertSelected();
      const existing = await storage.getJJum(ownerId, binding.jjumId);
      assertSelected();
      let memory;
      if (!existing) {
        if (binding.syncedRevision > 0) throw new Error('Bound user JJum is missing');
        const created = createJJum({ ownerId, jjumName: introduction.displayName,
          type: '사용자 자아쩜', summary: LEGACY_SELF_SUMMARY, sourceService: 'haema-console' });
        created.jjumId = binding.jjumId;
        memory = withIntroductionEvidence(created, introduction);
        await storage.putJJum(ownerId, memory);
      } else {
        memory = await storage.renameJJumPreservingContent(ownerId, binding.jjumId, introduction.displayName,
          { introductionRevision: introduction.revision, introduction });
      }
      assertSelected();
      store.markUserSelfJJumSynced(ownerId, binding.jjumId, introduction.revision, assertSelected);
      return { introduction, userSelfJJum: { jjumId: binding.jjumId, status: 'synced', syncedRevision: introduction.revision,
        ...(hasIntroductionEvidence(memory, introduction.text) ? { contentSynced: true } : {}) } };
    } catch (cause) {
      throw new UserSelfJJumSyncError(introduction, binding.jjumId, cause);
    }
  }));
}

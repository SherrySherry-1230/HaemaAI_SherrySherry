// @editedBy SherrySherry 2026-10-30
import { FileAdapter, UnsupportedJJumSchemaError } from './adapters/fileAdapter.ts';
import { FileIntroductionStore } from './adapters/fileIntroductionStore.ts';
import { createJJum } from './createJJum.ts';
import { IntroductionStoreError, type Introduction } from './introduction.ts';

export interface UserSelfJJumSync {
  jjumId: string;
  status: 'synced' | 'pending';
  syncedRevision: number;
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

export function isPendingUserSelfJJumRetry(store: FileIntroductionStore, ownerId: string,
  value: { text: string; displayName?: string }, expectedRevision: number): boolean {
  const previous = store.read(ownerId);
  const binding = store.readUserSelfJJum(ownerId);
  return Boolean(binding && binding.syncedRevision < previous.revision
    && expectedRevision === previous.revision - 1 && previous.text === value.text
    && (value.displayName === undefined || previous.displayName === value.displayName));
}

/** 공통 닉네임만 반영한다. 소개 원문과 호스트별 호칭은 쩜 내용으로 복제하지 않는다. */
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
  if (!storage.memoryRoot || new FileIntroductionStore(storage.memoryRoot).storageId !== store.storageId) {
    throw new IntroductionStoreError('conflict', 'Introduction and user JJum storage do not match');
  }
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
      if (!existing) {
        if (binding.syncedRevision > 0) throw new Error('Bound user JJum is missing');
        const created = createJJum({ ownerId, jjumName: introduction.displayName,
          type: '사용자 자아쩜', summary: '이 저장소의 사용자 본인을 나타내는 기억.', sourceService: 'haema-console' });
        created.jjumId = binding.jjumId;
        await storage.putJJum(ownerId, created);
      } else {
        await storage.renameJJumPreservingContent(ownerId, binding.jjumId, introduction.displayName,
          { introductionRevision: introduction.revision });
      }
      assertSelected();
      store.markUserSelfJJumSynced(ownerId, binding.jjumId, introduction.revision, assertSelected);
      return { introduction, userSelfJJum: { jjumId: binding.jjumId, status: 'synced', syncedRevision: introduction.revision } };
    } catch (cause) {
      throw new UserSelfJJumSyncError(introduction, binding.jjumId, cause);
    }
  }));
}

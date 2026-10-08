// @editedBy SherrySherry 2026-10-08
/** 발화 식별자는 내용과 독립적이다. 준비된 값을 최초 저장 전에 보관하고 재시도에 재사용한다. */
import { createHash, randomUUID } from 'node:crypto';
import type { ConversationTurn, ExtractRequest } from './adapters/aiAdapter.ts';
import type { StorageAdapter } from './adapters/storageAdapter.ts';

export interface PreparedConversationTurn extends ConversationTurn {
  utteranceId: string;
  receivedAt: number;
  final: boolean;
}

export interface PreparedConversationRequest extends ExtractRequest {
  conversationId: string;
  turns: PreparedConversationTurn[];
}

/** 원문을 복제하지 않는 처리 영수증. 재시도에는 같은 대화·발화 식별자를 전달한다. */
export interface ConversationReceipt {
  conversationId: string;
  turns: {
    utteranceId: string;
    receivedAt: number;
    final: boolean;
    at?: number;
  }[];
}

function validId(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 512) {
    throw new TypeError(`${field} must be a nonblank string of at most 512 characters`);
  }
}

function validTime(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${field} must be a finite nonnegative epoch millisecond value`);
  }
}

/**
 * 호스트 ID는 그대로 보존하고 없는 ID만 UUID로 발급한다. 입력 객체를 수정하지 않는다.
 * 식별 정보 없는 원본을 매번 다시 준비하면 다른 발화가 된다. 내용으로 재시도를 추측하지 않는다.
 */
export function prepareConversationRequest(req: ExtractRequest): PreparedConversationRequest {
  if (!req || typeof req !== 'object') throw new TypeError('Conversation request is required');
  validId(req.ownerId, 'ownerId');
  if (req.ownerId !== req.ownerId.trim()) {
    throw new TypeError('ownerId must not contain leading or trailing whitespace');
  }
  if (req.now !== undefined) validTime(req.now, 'now');
  const receivedAt = req.now ?? Date.now();
  const conversationId = req.conversationId === undefined ? randomUUID() : req.conversationId;
  validId(conversationId, 'conversationId');
  if (!Array.isArray(req.turns) || req.turns.length === 0) {
    throw new TypeError('turns must be a nonempty array');
  }

  const turns: PreparedConversationTurn[] = [];
  const seen = new Map<string, PreparedConversationTurn>();
  for (const turn of req.turns) {
    if (!turn || typeof turn !== 'object' || !['user', 'assistant'].includes(turn.role) || typeof turn.text !== 'string') {
      throw new TypeError('Each turn requires a user/assistant role and string text');
    }
    if (turn.at !== undefined) validTime(turn.at, 'turn.at');
    if (turn.receivedAt !== undefined) validTime(turn.receivedAt, 'turn.receivedAt');
    if (turn.final !== undefined && typeof turn.final !== 'boolean') {
      throw new TypeError('turn.final must be a boolean');
    }
    const utteranceId = turn.utteranceId === undefined ? randomUUID() : turn.utteranceId;
    validId(utteranceId, 'utteranceId');
    const prepared: PreparedConversationTurn = {
      role: turn.role,
      text: turn.text,
      ...(turn.at === undefined ? {} : { at: turn.at }),
      utteranceId,
      receivedAt: turn.receivedAt ?? receivedAt,
      final: turn.final ?? true,
    };
    const prior = seen.get(utteranceId);
    if (prior) {
      if (prior.role !== prepared.role || prior.text !== prepared.text || prior.at !== prepared.at || prior.final !== prepared.final) {
        throw new TypeError('Conflicting turns share an utteranceId');
      }
      // 동일 식별자의 중복 입력은 하나의 발화다. 최초 수신 시각을 보존한다.
      continue;
    }
    seen.set(utteranceId, prepared);
    turns.push(prepared);
  }
  return {
    ...req,
    ...(req.knownNames ? { knownNames: [...req.knownNames] } : {}),
    conversationId,
    turns,
  };
}

export function conversationReceipt(req: PreparedConversationRequest): ConversationReceipt {
  return {
    conversationId: req.conversationId,
    turns: req.turns.map(({ utteranceId, receivedAt, final, at }) => ({
      utteranceId, receivedAt, final, ...(at === undefined ? {} : { at }),
    })),
  };
}

/** 해시는 내용 변경 탐지만 담당하며 서로 다른 발화를 합치는 ID로 사용하지 않는다. */
export function utteranceFingerprint(turn: Pick<ConversationTurn, 'role' | 'text'>): string {
  return createHash('sha256').update(JSON.stringify([turn.role, turn.text])).digest('hex');
}

/** 구분 문자가 들어간 호스트 ID도 충돌하지 않도록 문자열 튜플을 직렬화한다. */
export function mentionKey(conversationId: string, utteranceId: string): string {
  return JSON.stringify([conversationId, utteranceId]);
}

const fallbackQueues = new WeakMap<StorageAdapter, Map<string, Promise<void>>>();

/** 파이프라인 호출의 직렬화다. 별도 프로세스나 직접 저장 호출의 트랜잭션은 아니다. */
export async function withConversationLock<T>(
  storage: StorageAdapter,
  ownerId: string,
  run: () => Promise<T>,
): Promise<T> {
  if (storage.withOwnerLock) return storage.withOwnerLock(ownerId, run);
  let owners = fallbackQueues.get(storage);
  if (!owners) {
    owners = new Map();
    fallbackQueues.set(storage, owners);
  }
  const previous = owners.get(ownerId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  owners.set(ownerId, current);
  await previous;
  try {
    return await run();
  } finally {
    release();
    if (owners.get(ownerId) === current) owners.delete(ownerId);
  }
}

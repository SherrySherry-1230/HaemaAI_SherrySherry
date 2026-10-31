// @editedBy SherrySherry 2026-10-31
import type { LayaHostEventService } from './layaHostEvents.ts';
import { layaIdentifier, validateLayaScope, type LayaScope } from './layaJournal.ts';
import { assessV5MemoryAccess, type JJumV5Repository } from './v5Memory.ts';
import type { FileJJumV5Record } from './adapters/fileJJumV5Store.ts';

export type V5ProactiveRecordResult = { status: 'recorded' | 'duplicate'; record: FileJJumV5Record }
  | { status: 'unavailable' | 'forbidden' | 'conflict' };

/**
 * 인증된 scope에 묶인 저장소·사건 서비스를 호출자가 제공한다. 관찰 결과가 이 함수를 자동 실행하지 않는다.
 * 전송 보고와 회상 전달의 문자 구간이 이미 검증된 사건만 기록하며 감쇠식·점수·본문 판정은 바꾸지 않는다.
 */
export async function recordV5HostProactiveMention(options: {
  repository: JJumV5Repository;
  events: Pick<LayaHostEventService, 'getConversation'>;
  scope: LayaScope;
  evidenceId: string;
}): Promise<V5ProactiveRecordResult> {
  validateLayaScope(options.scope); layaIdentifier(options.evidenceId, 'evidenceId');
  const conversation = await options.events.getConversation(options.scope);
  const evidence = conversation.proactiveEvidence.find(item => item.evidenceId === options.evidenceId);
  if (!evidence || evidence.source !== 'host_reported' || !Number.isSafeInteger(evidence.deliveredAt) || evidence.deliveredAt < 0) {
    return { status: 'unavailable' };
  }
  const response = conversation.turns.find(turn => turn.utteranceId === evidence.utteranceId
    && turn.role === 'assistant' && turn.responseId === evidence.responseId
    && turn.deliveryStatus === 'host_reported' && turn.deliveredAt === evidence.deliveredAt);
  if (!response) return { status: 'unavailable' };
  layaIdentifier(evidence.jjumId, 'jjumId');
  for (let attempt = 0; attempt < 2; attempt++) {
    const current = await options.repository.read(options.scope.ownerId, evidence.jjumId);
    if (!current || current.jjum.ownerId !== options.scope.ownerId || current.jjum.jjumId !== evidence.jjumId
      || current.jjum.status !== 'active') return { status: 'unavailable' };
    if (!assessV5MemoryAccess(current.jjum, { kind: 'host', hostChatbotId: options.scope.hostChatbotId }).accessAllowed) {
      return { status: 'forbidden' };
    }
    const entry = { hostChatbotId: options.scope.hostChatbotId, conversationId: options.scope.conversationId,
      utteranceId: evidence.utteranceId, timestamp: evidence.deliveredAt };
    const previous = current.jjum.hostProactiveMentionHistory?.find(item => item.hostChatbotId === entry.hostChatbotId
      && item.conversationId === entry.conversationId && item.utteranceId === entry.utteranceId);
    if (previous) return previous.timestamp === entry.timestamp ? { status: 'duplicate', record: current } : { status: 'conflict' };
    try {
      const record = await options.repository.save({ ...current.jjum,
        hostProactiveMentionHistory: [...(current.jjum.hostProactiveMentionHistory ?? []), entry] }, { expectedEtag: current.etag });
      return { status: 'recorded', record };
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'conflict') throw error;
    }
  }
  return { status: 'conflict' };
}

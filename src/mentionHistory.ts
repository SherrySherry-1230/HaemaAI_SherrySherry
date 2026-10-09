// @editedBy SherrySherry 2026-10-10
/** 같은 쩜의 언급 이력을 번호가 이어지는 묶음으로 보관한다. */
import type { JJum, JJumMention } from './types/jjum.ts';
import { mentionKey } from './conversationIdentity.ts';

type MentionHistoryFields = Pick<JJum, 'mentionHistory' | 'mentionHistoryChunks'>;

/** 묶음 하나의 기본 수용량. 전체 기록 수나 쩜 수를 제한하지 않는다. */
export const DEFAULT_MENTION_HISTORY_CHUNK_SIZE = 10_000;

/** 첫 묶음부터 마지막 묶음까지 저장된 순서대로 읽는다. */
export function* iterateMentionHistory(jjum: MentionHistoryFields): Generator<JJumMention> {
  yield* jjum.mentionHistory ?? [];
  for (const chunk of jjum.mentionHistoryChunks ?? []) yield* chunk.entries;
}

export interface MentionHistoryGroup {
  sequence: number;
  /** 표시용 이름이며 쩜 검색 이름·별칭·ID를 바꾸지 않는다. */
  name: string;
  entries: readonly JJumMention[];
}

/** 같은 쩜의 기록을 원래 이름, 이름2, 이름3 순으로 표현한다. */
export function getMentionHistoryGroups(
  jjum: MentionHistoryFields & Pick<JJum, 'jjumName'>,
): MentionHistoryGroup[] {
  const groups: MentionHistoryGroup[] = jjum.mentionHistory === undefined
    ? [] : [{ sequence: 1, name: jjum.jjumName, entries: jjum.mentionHistory }];
  for (const chunk of jjum.mentionHistoryChunks ?? []) {
    groups.push({ sequence: chunk.sequence, name: `${jjum.jjumName}${chunk.sequence}`, entries: chunk.entries });
  }
  return groups;
}

/**
 * 새 언급만 마지막 묶음에 추가한다. 용량은 전체 이력의 저장 상한이 아니다.
 * 원본 배열·묶음을 수정하지 않고 기존 번호·추가 정보·발화 기록을 보존한다.
 * 기존 묶음이 현재 용량보다 커도 재분할하지 않으며 다음 묶음으로 이어간다.
 * 입력 중복이나 기존 키의 재추가는 오류다. 재전송 여부는 호출자가 먼저 구분한다.
 */
export function appendMentionHistory(
  jjum: MentionHistoryFields,
  additions: readonly JJumMention[],
  chunkSize = DEFAULT_MENTION_HISTORY_CHUNK_SIZE,
): MentionHistoryFields {
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1) {
    throw new RangeError('Mention history chunk size must be a positive safe integer');
  }
  if (jjum.mentionHistoryChunks?.length && !jjum.mentionHistory?.length) {
    throw new Error('Continuation mention history requires a nonempty first group');
  }
  const first = jjum.mentionHistory?.slice();
  const chunks = jjum.mentionHistoryChunks?.map((chunk, index) => {
    if (chunk.sequence !== index + 2 || chunk.entries.length === 0) {
      throw new Error('Invalid mention history chunk sequence or empty entries');
    }
    return { ...chunk, entries: chunk.entries.slice() };
  });
  const result: MentionHistoryFields = {
    ...(first === undefined ? {} : { mentionHistory: first }),
    ...(chunks === undefined ? {} : { mentionHistoryChunks: chunks }),
  };
  const seen = new Set<string>();
  for (const mention of iterateMentionHistory(jjum)) {
    const key = mentionKey(mention.conversationId, mention.utteranceId);
    if (seen.has(key)) throw new Error('Duplicate stored mention history key');
    seen.add(key);
  }
  for (const mention of additions) {
    const key = mentionKey(mention.conversationId, mention.utteranceId);
    if (seen.has(key)) throw new Error('Duplicate mention history addition');
    seen.add(key);
    const lastChunk = result.mentionHistoryChunks?.at(-1);
    let entries = lastChunk?.entries ?? (result.mentionHistory ??= []);
    if (entries.length >= chunkSize) {
      const next = { sequence: (lastChunk?.sequence ?? 1) + 1, entries: [] as JJumMention[] };
      (result.mentionHistoryChunks ??= []).push(next);
      entries = next.entries;
    }
    entries.push({ ...mention });
  }
  return result;
}

// @editedBy SherrySherry 2026-09-14
/**
 * 대화-추출-저장 통합 파이프라인 (HaemaAI_SherrySherry/src/)
 *
 * 흐름: extractJJums → createJJum → summarizeJJum → putJJums
 *
 * 용어 규칙 (구용어 금지):
 * - HCell/Cell/Tail 사용 금지
 * - JJum / jjum / Seon 만 사용
 * - 점 → 쩜, 선 → 쩜선
 */

import type {
  AIAdapter,
  ExtractRequest,
  ExtractedDraft,
} from './adapters/aiAdapter.ts';
import type { StorageAdapter } from './adapters/storageAdapter.ts';
import { createJJum } from './createJJum.ts';
import type { JJum } from './types/jjum.ts';

// ═══════════════════════════════════════════════════════════════════
// 단계별 helper
// ═══════════════════════════════════════════════════════════════════

/**
 * 1단계: 대화에서 쩜(JJum) 초안을 추출한다.
 */
export async function extractJJums(
  adapter: AIAdapter,
  req: ExtractRequest,
): Promise<ExtractedDraft[]> {
  return adapter.extractJJums(req);
}

/**
 * 2단계: 추출된 초안(ExtractedDraft)들을 실제 쩜(JJum) 구조로 변환한다.
 *
 * createJJum()은 소유자(ownerId) 기준 쩜 생성을 담당하므로,
 * 초안 정보를 CreateJJumInput 형태로 매핑해 쩜을 만든다.
 *
 * 초안 필드 매핑:
 * - factTexts → facts (JJumFact[] 로 변환, 출처는 conversation)
 * - eventSummary → events (JJumEvent[] 로 변환)
 * - relatedNames → seons (Seon[] 로 변환, 꼬리 후보)
 */
export function createJJumsFromDrafts(
  ownerId: string,
  drafts: ExtractedDraft[],
  sourceService?: string,
  now?: number,
): JJum[] {
  return drafts.map((d) => {
    const jjum = createJJum({
      ownerId,
      jjumName: d.jjumName,
      type: d.type,
      aliases: d.aliases,
      tags: d.tags,
      sourceService,
      now,
    });

    // 사실 조각 매핑
    if (d.factTexts && d.factTexts.length > 0) {
      jjum.facts = d.factTexts.map((text) => ({
        text,
        addedAt: now ?? Date.now(),
        source: 'conversation',
      }));
    }

    // 사건 매핑
    if (d.eventSummary) {
      jjum.events = [
        {
          date: now ?? Date.now(),
          summary: d.eventSummary,
          refJJumIds: [],
        },
      ];
    }

    // 쩜선(Seon) 후보 매핑 — relatedNames 기반
    if (d.relatedNames && d.relatedNames.length > 0) {
      jjum.seons = d.relatedNames.map((name) => ({
        targetId: name,
        weight: 1,
        lastActivated: now ?? Date.now(),
      }));
    }

    return jjum;
  });
}

/**
 * 3단계: 쩜(JJum) 요약(summary)을 보강한다.
 *
 * summarizeJJum()은 { summary: string }을 반환하므로,
 * 반환된 summary로 쩜의 summary 필드를 갱신한다.
 *
 * 요약에 실패하면 해당 쩜은 보강하지 않고 원본(초안 기반) 상태 그대로 둔다.
 * 프로세스 중단 없이 다음 쩜으로 넘어간다.
 */
export async function summarizeJJums(
  adapter: AIAdapter,
  jjums: JJum[],
  hint?: string,
): Promise<JJum[]> {
  const results: JJum[] = [];

  for (const jjum of jjums) {
    try {
      const { summary } = await adapter.summarizeJJum(jjum, hint);
      results.push({ ...jjum, summary });
    } catch (err) {
      // 요약 실패 시 중단하지 않고 초안 상태 그대로 저장 대상에 포함
      results.push(jjum);
    }
  }

  return results;
}

/**
 * 4단계: 쩜(JJum) 목록을 저장소에 저장한다.
 */
export async function putJJums(
  storage: StorageAdapter,
  ownerId: string,
  jjums: JJum[],
): Promise<void> {
  await storage.putJJums(ownerId, jjums);
}

// ═══════════════════════════════════════════════════════════════════
// 통합 파이프라인
// ═══════════════════════════════════════════════════════════════════

/**
 * 대화-추출-저장 통합 파이프라인.
 *
 * 1. extractJJums()     — 대화에서 쩜(JJum) 초안 추출
 * 2. createJJum()       — 초안을 실제 쩜(JJum) 구조로 변환
 * 3. summarizeJJum()    — 쩜 요약 보강 (실패해도 중단하지 않음)
 * 4. putJJums()         — 저장소(StorageAdapter)에 저장
 *
 * 요약 실패 시 해당 쩜은 보강되지 않은 초안 상태로 저장된다.
 *
 * @returns 저장된 쩜 개수 + 요약 실패 건수
 */
export async function processConversationToStorage(
  aiAdapter: AIAdapter,
  storageAdapter: StorageAdapter,
  ownerId: string,
  extractReq: ExtractRequest,
  options?: {
    sourceService?: string;
    summarizeHint?: string;
  },
): Promise<{ storedCount: number; failedSummaries: number }> {
  // 1. 추출
  const drafts = await extractJJums(aiAdapter, extractReq);

  if (drafts.length === 0) {
    return { storedCount: 0, failedSummaries: 0 };
  }

  // 2. 쩜(JJum) 구조 변환
  const jjums = createJJumsFromDrafts(
    ownerId,
    drafts,
    options?.sourceService,
    extractReq.now,
  );

  // 3. 요약 보강 (실패해도 계속 진행)
  const summarized = await summarizeJJums(
    aiAdapter,
    jjums,
    options?.summarizeHint,
  );

  // 요약 실패 건수 계산 (원본과 동일 참조인 항목)
  const failedSummaries = summarized.filter(
    (s, i) => s === jjums[i],
  ).length;

  // 4. 저장
  await putJJums(storageAdapter, ownerId, summarized);

  return {
    storedCount: summarized.length,
    failedSummaries,
  };
}

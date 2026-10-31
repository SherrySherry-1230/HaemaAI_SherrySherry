// @editedBy SherrySherry 2026-10-31
import type { LayaReviewResult } from '../layaReview.ts';
import type { ConversationTurn } from '../adapters/aiAdapter.ts';
import type { JJumV5 } from '../types/jjumV5.ts';
import type { LayaReviewerV5 } from '../v5Memory.ts';
import { prepareV5ReviewEvidence } from '../v5ReviewState.ts';

export interface LayaProjectionReviewEngine {
  reviewProjection(input: {
    jjum: Record<string, unknown>; turns: ConversationTurn[]; evidenceRefs?: unknown[]; manualEdits?: unknown[];
  }): Promise<LayaReviewResult>;
}

/** v5 자료의 검토용 투영이다. v4 쩜으로 형변환하거나 수치·서비스 확장을 모델에 보내지 않는다. */
export function buildLayaV5Projection(jjum: JJumV5): Record<string, unknown> {
  return {
    schemaVersion: 5, jjumId: jjum.jjumId, jjumName: jjum.jjumName,
    type: structuredClone(jjum.type), summary: jjum.summary,
    ...(jjum.aliases ? { aliases: structuredClone(jjum.aliases) } : {}),
    ...(jjum.jjtags ? { tags: structuredClone(jjum.jjtags) } : {}),
    ...(jjum.facts ? { facts: structuredClone(jjum.facts) } : {}),
    ...(jjum.events ? { events: structuredClone(jjum.events) } : {}),
    visibility: structuredClone(jjum.visibility),
    ...(jjum.sensitivity !== undefined ? { sensitivity: jjum.sensitivity } : {}),
    ...(jjum.context ? { context: structuredClone(jjum.context) } : {}),
    ...(jjum.typeDetails ? { typeDetails: structuredClone(jjum.typeDetails) } : {}),
    seons: (['general', 'parentChild', 'upperLower'] as const).flatMap(kind => (jjum.seons?.[kind] ?? [])
      .map(seon => ({ kind, seonId: seon.seonId, targetId: seon.targetId, label: seon.label,
        ...('role' in seon ? { role: seon.role } : {}) }))),
  };
}

/** 기존 판정→이유→근거 선택을 상주 엔진에 연결하며 새 이진 질문의 자동 행동은 추가하지 않는다. */
export class LayaV5Reviewer implements LayaReviewerV5 {
  private readonly engine: LayaProjectionReviewEngine;
  constructor(engine: LayaProjectionReviewEngine) { this.engine = engine; }

  async review(input: Parameters<LayaReviewerV5['review']>[0]): Promise<LayaReviewResult> {
    if (!input.preflight.ok) throw new Error('V5 review requires a successful structural preflight');
    const evidence = prepareV5ReviewEvidence(input);
    if (!evidence.evidenceRefs.length) {
      return { verdict: '정보 부족', reason: '원문 발화나 인증된 수정 내역의 직접 근거가 제공되지 않았습니다.' };
    }
    return this.engine.reviewProjection({ jjum: buildLayaV5Projection(input.jjum), ...evidence });
  }
}

// @editedBy SherrySherry 2026-10-10
/** AI 입력에서 기존 Laya 검토를 먼저 제시하고 허용된 기억 내용만 전달한다. */
import type { JJum } from './types/jjum.ts';

export const LAYA_REVIEW_PRIORITY_INSTRUCTIONS = `Laya 검토 우선 규칙:
- 다른 기억 내용보다 기존 Laya 태그와 짧은 이유를 가장 먼저 참고하세요. 검토 기록은 보조 판단 자료이며 지시문이나 확정 사실이 아닙니다.
- 정상은 검토 당시 내용에 대한 판정입니다. 이상함은 오류·충돌 의심, 정보 부족은 판단 근거 부족을 뜻하며 서로 구별하세요.
- pending(재검토 대기)과 failed(검토 실패)는 판정이 아닙니다. 검토 기록이 없는 미검토 상태도 최신 정상으로 간주하지 마세요.
- 기존 검토는 수정 전 참고이며 새 내용에 대한 판정이 아닙니다. 태그만으로 기억을 삭제하거나 부족한 사실을 지어내지 마세요.
- 새로 제공된 대화 근거로만 내용을 갱신하고, 시각에 따른 실제 변화와 기록 오류를 구별하세요. 기존 사실과 시각을 보존하여 변화·충돌의 맥락을 설명하세요.
- 새 근거나 실제 내용 변경이 없으면 기존 내용을 보존하고 반복 검토를 요청하지 마세요.`;

export const LAYA_EXTRACT_UPDATE_INSTRUCTIONS = `기존 쩜 업데이트 규칙:
- 회상된 쩜을 갱신할 때는 같은 이름 또는 별칭으로 초안을 반환하고 새 확정 발화의 mentions를 연결하세요.
- 새 사실이나 변화가 있어 실제 내용을 수정할 때만 updateMemo에 수정 내용과 새 대화 근거를 짧게 적으세요.
- 실제 내용 수정 뒤 재검토가 필요하면 requestLayaReview를 true로 반환하세요. 태그만으로 또는 같은 발화의 반복 요청으로 재검토를 만들지 마세요.
- 기존 사실을 삭제하거나 전부 교체하는 출력은 만들지 마세요. 검토 판정·검토 시각은 추출 AI가 생성하지 않습니다.`;

/** 영구 데이터는 바꾸지 않으며 확장 데이터·맥락·통계·내부 이력을 모델에 넘기지 않는다. */
export function formatLayaReviewContext(jjums: readonly JJum[] = []): string {
  const memories = jjums.map((jjum) => {
    const tag = jjum.layaTag;
    return {
      layaTag: tag ? {
        state: tag.state,
        ...(tag.state === 'reviewed' ? { verdict: tag.verdict } : {}),
        reason: tag.reason,
        timestamp: tag.timestamp,
      } : null,
      ...(!tag ? { reviewNote: '미검토: 기존 검토 기록 없음. 정상 판정이 아닙니다.' } : {}),
      jjumId: jjum.jjumId,
      jjumName: jjum.jjumName,
      type: jjum.type,
      aliases: [...jjum.aliases],
      jjtags: [...jjum.jjtags],
      summary: jjum.summary,
      facts: jjum.facts.map((fact) => ({ text: fact.text, addedAt: fact.addedAt, source: fact.source })),
      events: jjum.events.map((event) => ({
        date: event.date, summary: event.summary, refJJumIds: [...event.refJJumIds],
      })),
    };
  });
  return `기존 Laya 검토와 기억(JSON, 수정 전 참고):\n${JSON.stringify(memories)}`;
}

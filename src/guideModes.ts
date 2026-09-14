// @editedBy SherrySherry 2026-09-06
/**
 * 답변 가이드 mode — 범용 열거. 호스트가 자기 값으로 확장할 수 있다.
 * (recall 과 proactive 가 함께 쓰므로 별도 파일)
 *
 * - 공감 우선 / 편들기 / 축하 / 가볍게 / 안부
 * - 조심 안부: 미해결 고민을 먼저 건드릴 때 — 내용을 먼저 말하지 말고 "고민 있어?" 수준으로만 문을 연다
 */

export const GUIDE_MODES = ['공감 우선', '편들기', '축하', '가볍게', '안부', '조심 안부'] as const;
export type GuideMode = (typeof GUIDE_MODES)[number] | (string & {});

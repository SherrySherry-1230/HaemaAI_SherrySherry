// @editedBy SherrySherry 2026-10-16
import type { IncrementalConversationView } from './incrementalConversation.ts';

export interface ResponseReadiness {
  status: 'wait' | 'ready' | 'uncertain';
  source: 'content_heuristic';
  provisional: true;
  executeHost: false;
  basis: {
    sessionId: string;
    processGeneration: number;
    analysisGeneration: number;
    inputIds: string[];
    meaningUnitId?: string;
  };
  reasons: string[];
}

/** 인용된 질문·요청은 사용자의 직접 요청과 구별한다. 열린 인용은 아직 미완성이다. */
function outsideQuotes(text: string): { text: string; quoted: boolean; open: boolean } {
  const pairs: Record<string, string> = { '"': '"', "'": "'", '“': '”', '‘': '’', '「': '」', '『': '』', '«': '»', '`': '`' };
  let closing: string | undefined;
  let quoted = false;
  let result = '';
  const characters = Array.from(text);
  for (let index = 0; index < characters.length; index++) {
    const character = characters[index];
    if (closing) {
      if (character === closing) closing = undefined;
      result += ' ';
      continue;
    }
    // 영문 축약형의 apostrophe는 인용 시작이 아니다.
    const apostrophe = character === "'" && /[\p{L}\p{N}]/u.test(characters[index - 1] ?? '')
      && /[\p{L}\p{N}]/u.test(characters[index + 1] ?? '');
    if (pairs[character] && !apostrophe) {
      quoted = true;
      closing = pairs[character];
      result += ' ';
    } else result += character;
  }
  return { text: result.trim(), quoted, open: closing !== undefined };
}

/** 명시적 지연 조건은 요청 어미보다 우선한다. 조건 충족을 시간으로 추측하지 않는다. */
function explicitlyDefersResponse(text: string): boolean {
  const visible = outsideQuotes(text).text;
  if (/(?:^|[.!?。！？]\s*|\s)기다려(?:\s*줘|\s*주세요|요)?(?:[.!?。！？]|$)/u.test(visible)
    || /(?:답변|대답|응답|답)(?:은|을)?\s*(?:하지\s*마(?:세요)?|하지\s*말아\s*줘|하지\s*말고|기다려\s*줘)/u.test(visible)
    || /(?:^|[.!?]\s*)(?:please\s+|just\s+)?wait\b/iu.test(visible)
    || /\b(?:do\s+not|don't)\s+(?:answer|respond|reply)(?:\s+yet)?\b/iu.test(visible)) return true;
  const requested = /(?:줘(?:요)?|주세요|주실래(?:요)?|줄래(?:요)?)[.!?。！？]*$/u.test(visible)
    || /(?:^|[,;.!?]\s*)(?:please\s+)?(?:explain|summarize|answer|respond|reply|describe|review|tell|help|write)\b/iu.test(visible)
    || /\bplease\s+(?:explain|summarize|answer|respond|reply|describe|review|tell|help|write)\b/iu.test(visible);
  return requested && (
    /(?:다\s*(?:말|쓰|썼|입력|설명|이야기)|끝(?:나|났|낸|내)|마(?:친|치|칠)|완료)[^.!?。！？]*?(?:뒤|후|다음|면|때|까지)/u.test(visible)
    || /(?:나중에|이따가)\s*[^.!?。！？]+/u.test(visible)
    || /\b(?:after|once|when|until)\s+(?:(?:i|we)\s+(?:(?:am|are)\s+(?:done|finished)|(?:have\s+)?finished|finish|say|tell)|you\s+(?:hear|receive))\b/iu.test(visible)
  );
}

/** 이전 대기 지시는 명시적인 완료·답변 허용 발화로만 해제한다. */
function explicitlyAllowsResponse(text: string): boolean {
  const visible = outsideQuotes(text).text;
  return /다\s*(?:말했|썼|설명했|입력했|이야기했)(?:어|어요|습니다|다)(?:[.!。！]|$)/u.test(visible)
    || /(?:말|설명|입력|이야기)(?:이|가)?\s*끝났(?:어|어요|습니다|다)(?:[.!。！]|$)/u.test(visible)
    || /(?:이제|지금)\s*(?:답(?:변)?|대답|응답|설명|요약|정리)(?:을|를)?\s*(?:해|시작)/u.test(visible)
    || /(?:^|[.!?]\s*)(?:(?:i['’]m|i\s+am|we['’]re|we\s+are)\s+(?:done|finished)|(?:i|we)\s+(?:have\s+)?finished|go\s+ahead)(?:[.!]|,|$)/iu.test(visible)
    || /\bnow\s+(?:please\s+)?(?:answer|respond|reply|explain|summarize)\b/iu.test(visible);
}

function assessContent(text: string): { status: ResponseReadiness['status']; reasons: string[] } {
  const visible = outsideQuotes(text);
  const reasons = visible.quoted ? ['quoted_content_excluded_from_direct_request'] : [];
  const result = (status: ResponseReadiness['status'], reason: string) => ({ status, reasons: [...reasons, reason] });
  if (visible.open) return result('wait', 'unfinished_quotation');
  if (!/[\p{L}\p{N}]/u.test(visible.text)) {
    return result(visible.quoted ? 'uncertain' : 'wait', visible.quoted ? 'no_direct_content_outside_quotation' : 'no_substantive_content');
  }
  if (/(?:\.{2,}|…+)\s*$/u.test(visible.text)) return result('wait', 'unfinished_trailing_expression');
  const ending = visible.text.replace(/[.!?。！？]+\s*$/u, '').trim();
  // 문장부호가 붙어도 이어지는 어미를 의미상 완료로 간주하지 않는다.
  if (/(?:는데|은데|인데|던데|거든|지만|니까|라서|어서|아서|다면|라면|려면|려고|다가|으며|면서)(?:요)?$/u.test(ending)
    || /(?:하고|거나|그래서|그리고|그런데|하지만|또는|을|를|은|는|의|에|에서|에게|까지|부터|으로|할|될|볼|줄|갈|올)$/u.test(ending)
    || /\b(?:and|but|because|if|when|while|although|to|with|about|the|a|an|of|for|or)\s*$/iu.test(ending)) {
    return result('wait', 'unfinished_content_ending');
  }
  if (/^(?:잠깐|잠시만|기다려(?:\s*줘|\s*주세요)?)(?:요)?$/u.test(ending)
    || /(?:답변|대답|응답)(?:은?\s*)?(?:하지\s*마(?:세요)?|하지\s*말아\s*줘|기다려\s*줘)$/u.test(ending)) {
    return result('wait', 'explicit_request_to_wait');
  }

  // 과거 질문이 새 서술문까지 답변 가능으로 만들지 않도록 마지막 절을 확인한다.
  const clause = ending.split(/[.!?。！？]+/u).at(-1)!.trim();
  if (/(?:모르겠(?:어|어요|다)|궁금(?:해|해요|하다)|생각(?:했어|했다|했어요)|물(?:었어|었다|었어요)|말(?:했어|했다|했어요))$/u.test(clause)) {
    return result('uncertain', 'reported_or_ambiguous_intent');
  }
  const koreanRequest = /(?:해|알려|보여|찾아|도와|말해|설명해|정리해|비교해|추천해|검토해|분석해|번역해|요약해|작성해|만들어|확인해|골라|가르쳐)\s*(?:줘(?:요)?|주세요|주실래(?:요)?|줄래(?:요)?)$/u;
  if (koreanRequest.test(clause)
    || /^(?:please\s+)?(?:explain|summarize|compare|translate|describe|review|check|show|tell|help|write|list|find)\b\s+\S/iu.test(clause)) {
    return result('ready', 'explicit_request_expression');
  }
  const koreanQuestion = /(?:[가-힣]+(?:을\s*까|나요|까요|습니까|인가요)|(?:할|일|될|볼|줄)\s*까)(?:요)?$/u;
  const questionMark = /[?？]\s*$/u.test(visible.text);
  const koreanWhQuestion = /^(?:어떻게|무엇|뭐|왜|어디|언제|누가|누구|어느|얼마나)\s+.+(?:해|돼|야|어|아|지|요|니)$/u;
  const englishQuestion = /^(?:what|how|why|when|where|which|who|whom|whose|can|could|should|would|will|is|are|do|does|did|may)\b\s+\S+(?:\s+\S+)+$/iu;
  if (koreanQuestion.test(clause) || (questionMark && (koreanWhQuestion.test(clause) || englishQuestion.test(clause)))) {
    return result('ready', 'explicit_question_expression');
  }
  return result('uncertain', 'semantic_completion_not_established');
}

/**
 * 현재 의미 묶음의 내용에 근거한 임시 권고다. 의미 판별 모델을 구현한 것이 아니다.
 * 제출·검색 완료·경과 시간은 응답 시작 근거로 읽지 않으며 호스트 실행 권한도 반환하지 않는다.
 */
export function assessResponseReadiness(view: IncrementalConversationView): ResponseReadiness {
  const activeDraft = view.draft?.text.trim() ? view.draft : null;
  const current = activeDraft ?? view.submissions.at(-1);
  const group = current ? view.submissions.filter((entry) => entry.meaningUnitId === current.meaningUnitId) : [];
  const inputs = [...group, ...(activeDraft ? [activeDraft] : [])];
  const basis: ResponseReadiness['basis'] = {
    sessionId: view.sessionId,
    processGeneration: view.processGeneration,
    analysisGeneration: view.analysisGeneration,
    inputIds: inputs.map((entry) => entry.inputId),
    ...(current ? { meaningUnitId: current.meaningUnitId } : {}),
  };
  const content = assessContent(inputs.map((entry) => entry.text).join(' '));
  const reasons = [...content.reasons];
  let deferredByInputId: string | undefined;
  for (const entry of view.submissions) {
    if (explicitlyAllowsResponse(entry.text)) deferredByInputId = undefined;
    if (explicitlyDefersResponse(entry.text)) deferredByInputId = entry.inputId;
  }
  if (activeDraft && explicitlyDefersResponse(activeDraft.text)) deferredByInputId = activeDraft.inputId;
  if (deferredByInputId) {
    reasons.push(deferredByInputId === current?.inputId
      ? 'explicit_deferred_response_request' : 'prior_wait_request_not_explicitly_released');
    if (!basis.inputIds.includes(deferredByInputId)) basis.inputIds.unshift(deferredByInputId);
  }
  if (group.length > 1 || (activeDraft && group.length)) {
    reasons.push('meaning_unit_context_considered', 'continuity_is_provisional');
  }
  if (activeDraft) reasons.push('active_draft_requires_wait');
  if (view.disposed) reasons.push('session_disposed');
  return {
    status: view.disposed || activeDraft || deferredByInputId ? 'wait' : content.status,
    source: 'content_heuristic', provisional: true, executeHost: false, basis, reasons,
  };
}

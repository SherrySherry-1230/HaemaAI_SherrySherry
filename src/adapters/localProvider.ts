// @editedBy SherrySherry 2026-10-14
/** 해마.ai의 로컬 OpenAI 호환 서버 설정. 클라우드 주소로 자동 대체하지 않는다. */
export type LocalAIProvider = 'ollama' | 'lmstudio';

const localBaseUrls: Record<LocalAIProvider, string> = {
  ollama: 'http://127.0.0.1:11434/v1',
  lmstudio: 'http://127.0.0.1:1234/v1',
};

export function isLocalAIProvider(provider: string): provider is LocalAIProvider {
  return provider === 'ollama' || provider === 'lmstudio';
}

export function localAIBaseUrl(provider: LocalAIProvider, baseUrl?: string): string {
  const url = new URL(baseUrl?.trim() || localBaseUrls[provider]);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new TypeError('로컬 AI 주소는 인증정보·쿼리·프래그먼트 없는 HTTP(S) 주소여야 합니다.');
  }
  url.pathname = url.pathname.replace(/\/+$/, '') || '/v1';
  return url.href.replace(/\/+$/, '');
}

/** 로컬 모델도 기존 파서가 요구하는 JSON 형태로 응답하게 한다. 요약은 일반 텍스트다. */
export function localAIResponseFormat(task: string) {
  const strings = { type: 'array', items: { type: 'string' } };
  const schemas: Record<string, Record<string, unknown>> = {
    extract: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          jjumName: { type: 'string' }, type: { type: 'string' },
          aliases: strings, tags: strings, factTexts: strings, relatedNames: strings,
          eventSummary: { type: 'string' }, updateMemo: { type: 'string' },
          requestLayaReview: { type: 'boolean' },
          mentions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                utteranceId: { type: 'string' },
                kind: { type: 'string', enum: ['initiated', 'prompted', 'host'] },
              },
              required: ['utteranceId', 'kind'],
              additionalProperties: false,
            },
          },
        },
        required: ['jjumName', 'type', 'aliases', 'tags', 'factTexts', 'mentions'],
        additionalProperties: false,
      },
    },
    judgeMerge: {
      type: 'object',
      properties: { confidence: { type: 'number' }, reason: { type: 'string' } },
      required: ['confidence'],
      additionalProperties: false,
    },
    scoreRecall: {
      type: 'array',
      items: {
        type: 'object',
        properties: { jjumId: { type: 'string' }, score: { type: 'number' }, reason: { type: 'string' } },
        required: ['jjumId', 'score'],
        additionalProperties: false,
      },
    },
  };
  const schema = schemas[task];
  return schema ? { type: 'json_schema' as const, json_schema: { name: `haema_${task}`, schema } } : undefined;
}

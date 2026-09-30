// 목적지는 사용자 입력 URL이 아니라 이 목록에서만 선택한다.
export const providers = {
  openai: { base: 'https://api.openai.com/v1', format: 'chat' },
  upstage: { base: 'https://api.upstage.ai/v1/solar', format: 'chat' },
  groq: { base: 'https://api.groq.com/openai/v1', format: 'chat' },
  grok: { base: 'https://api.x.ai/v1', format: 'chat' },
  deepseek: { base: 'https://api.deepseek.com', format: 'chat' },
  openrouter: { base: 'https://openrouter.ai/api/v1', format: 'chat' },
  anthropic: { base: 'https://api.anthropic.com/v1', format: 'anthropic' },
  google: { base: 'https://generativelanguage.googleapis.com/v1beta', format: 'google' },
};
export function allowedRoute(provider, path, method) {
  if (!Object.hasOwn(providers, provider)) return false;
  if (method === 'GET') return path === '/models';
  if (method !== 'POST') return false;
  const format = providers[provider].format;
  return format === 'google' ? /^\/models\/[A-Za-z0-9._-]+:generateContent$/.test(path)
    : path === (format === 'anthropic' ? '/messages' : '/chat/completions');
}

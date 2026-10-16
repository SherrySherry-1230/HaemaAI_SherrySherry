// @editedBy SherrySherry 2026-10-16
/** 해마.ai가 받은 제공자 응답의 사용량. 가격이나 사용자 문장만의 길이가 아니다. */
import { randomUUID } from 'node:crypto';
import type { AIAdapterConfig, AITask } from './aiAdapter.ts';

export interface TokenCounts {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export interface AIUsageEvent extends TokenCounts {
  callId: string;
  scope: 'haema';
  state: 'pending' | 'complete';
  provider: string;
  model: string;
  requestedModel: string;
  modelSource: 'response' | 'requested';
  task: AITask | 'review';
  source: 'provider' | 'unreported';
  usageSource: 'openai.usage' | 'anthropic.usage' | 'google.usageMetadata' | 'ollama.counts' | null;
}

type UsageFormat = 'openai' | 'anthropic' | 'google';

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function sum(...values: (number | null)[]): number | null {
  if (values.some((value) => value === null)) return null;
  return count(values.reduce<number>((total, value) => total + value!, 0));
}

function optionalCount(value: unknown): number | null {
  return value === undefined ? 0 : count(value);
}

/** 제공자별 세부 내역을 중복 합산하지 않고 보고된 수치만 정규화한다. */
export function normalizeProviderUsage(format: UsageFormat, value: unknown): TokenCounts {
  const usage = record(value);
  let inputTokens: number | null;
  let outputTokens: number | null;
  let reportedTotal: unknown;
  if (format === 'anthropic') {
    inputTokens = sum(count(usage.input_tokens), optionalCount(usage.cache_creation_input_tokens),
      optionalCount(usage.cache_read_input_tokens));
    outputTokens = count(usage.output_tokens);
  } else if (format === 'google') {
    inputTokens = sum(count(usage.promptTokenCount), optionalCount(usage.toolUsePromptTokenCount));
    outputTokens = sum(count(usage.candidatesTokenCount), optionalCount(usage.thoughtsTokenCount));
    reportedTotal = usage.totalTokenCount;
  } else {
    inputTokens = count(usage.prompt_tokens);
    outputTokens = count(usage.completion_tokens);
    reportedTotal = usage.total_tokens;
  }
  const partsTotal = sum(inputTokens, outputTokens);
  let totalTokens = reportedTotal === undefined ? partsTotal : count(reportedTotal);
  if (totalTokens !== null && (
    (inputTokens !== null && totalTokens < inputTokens)
    || (outputTokens !== null && totalTokens < outputTokens)
    || (inputTokens !== null && outputTokens !== null && partsTotal === null)
    || (partsTotal !== null && totalTokens < partsTotal)
  )) totalTokens = null;
  return { inputTokens, outputTokens, totalTokens };
}

function notifyUsage(callback: AIAdapterConfig['onUsage'], event: AIUsageEvent): void {
  try {
    // 비동기 콜백이 전달되어도 거부된 Promise가 작업 밖으로 전파되지 않게 한다.
    Promise.resolve(callback?.(event)).catch(() => {});
  } catch { /* 사용량 관측 실패가 생성·저장을 중단하지 않는다. */ }
}

/** 해마.ai 호출 경계에서 시작과 완료를 전달하며 호출 당시 설정을 보존한다. */
export function createAIUsageReporter(config: AIAdapterConfig, task: AITask, requestedModel: string,
  format: UsageFormat): (usage?: unknown, responseModel?: unknown, rawResponse?: unknown) => void {
  const callId = randomUUID();
  const provider = config.provider;
  const onUsage = config.onUsage;
  const onUsageStart = config.onUsageStart;
  notifyUsage(onUsageStart, {
    callId, scope: 'haema', state: 'pending', provider, model: requestedModel, requestedModel,
    modelSource: 'requested', task, source: 'unreported', usageSource: null,
    inputTokens: null, outputTokens: null, totalTokens: null,
  });
  let reported = false;
  return (usage, responseModel, rawResponse) => {
    if (reported) return;
    reported = true;
    let counts = normalizeProviderUsage(format, usage);
    let usageSource: AIUsageEvent['usageSource'] = format === 'google' ? 'google.usageMetadata'
      : format === 'anthropic' ? 'anthropic.usage' : 'openai.usage';
    if (format === 'openai' && provider === 'ollama' && Object.values(counts).every((value) => value === null)) {
      // Ollama 원시 응답의 확인된 개수 필드만 읽는다. 시간·캐시 개수는 더하지 않는다.
      const raw = record(rawResponse);
      counts = normalizeProviderUsage('openai', {
        prompt_tokens: raw.prompt_eval_count, completion_tokens: raw.eval_count,
      });
      usageSource = 'ollama.counts';
    }
    const supplied = Object.values(counts).some((value) => value !== null);
    const hasResponseModel = typeof responseModel === 'string' && responseModel.trim().length > 0;
    const event: AIUsageEvent = {
      callId, scope: 'haema', state: 'complete', provider, requestedModel,
      model: hasResponseModel ? responseModel as string : requestedModel,
      modelSource: hasResponseModel ? 'response' : 'requested', task, ...counts,
      source: supplied ? 'provider' : 'unreported', usageSource: supplied ? usageSource : null,
    };
    notifyUsage(onUsage, event);
  };
}

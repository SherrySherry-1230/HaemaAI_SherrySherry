// @editedBy SherrySherry 2026-10-20
import { randomUUID } from 'node:crypto';
import type { AIUsageEvent, TokenCounts } from './adapters/aiUsage.ts';

export type TokenUsageStatus = 'complete' | 'partial' | 'unreported';
export interface TokenUsageScope { ownerId: string; storageId: string; conversationId: string }
export interface TokenUsageMetric { tokens: number | null; reportedTokens: number | null }
export interface TokenUsageTotals extends TokenCounts {
  status: TokenUsageStatus;
  totalStatus: TokenUsageStatus;
  breakdownStatus: TokenUsageStatus;
  reportedTotalTokens: number | null;
  unclassifiedTokens: number | null;
  /** 확인된 구간만 제공한다. 미확인 나머지를 길이 0으로 확정하는 뜻이 아니다. */
  segments: { input: number | null; output: number | null; unclassified: number | null };
  callCount: number;
  unreportedCallCount: number;
  incompleteCallCount: number;
  /** 작업별 진단용 구분. 화면은 누적 막대 하나를 사용한다. */
  sections: { input: TokenUsageMetric; memory: TokenUsageMetric; recall: TokenUsageMetric };
}
export interface TokenUsageReport extends TokenUsageTotals, TokenUsageScope {
  schemaVersion: 2;
  scope: 'haema';
  unit: 'tokens';
  phase: 'pending' | 'complete';
  coverage: 'complete' | 'partial';
  usageId: string;
  utteranceIds: string[];
  attribution: 'single' | 'shared';
  calls: AIUsageEvent[];
  byTask: Array<TokenUsageTotals & { task: AIUsageEvent['task'] }>;
  byModel: Array<TokenUsageTotals & { provider: string; model: string; modelSource: AIUsageEvent['modelSource'] }>;
}

function sum(values: Array<number | null>): number | null {
  let total = 0;
  for (const value of values) {
    if (value === null || !Number.isSafeInteger(total + value)) return null;
    total += value;
  }
  return total;
}
function metric(values: Array<number | null>): TokenUsageMetric {
  const reportedTokens = sum(values.filter((value): value is number => value !== null));
  return { tokens: values.includes(null) ? null : reportedTokens, reportedTokens };
}
function validId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 512) throw new TypeError('Invalid token usage identity');
}
function scopeOf(value: TokenUsageScope): TokenUsageScope {
  for (const id of [value.ownerId, value.storageId, value.conversationId]) validId(id);
  return { ownerId: value.ownerId, storageId: value.storageId, conversationId: value.conversationId };
}
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }

/** 제공자 이름이 아니라 계측 호출의 출처를 검사한다. 원문·키·추가 필드는 복제하지 않는다. */
export function validateTokenUsageEvent(event: AIUsageEvent): AIUsageEvent {
  if (!event || event.scope !== 'haema' || !['pending', 'complete'].includes(event.state)
      || !['extract', 'summarize', 'judgeMerge', 'scoreRecall', 'review', 'selectDisplayName'].includes(event.task)
      || !['provider', 'unreported'].includes(event.source)
      || !['response', 'requested'].includes(event.modelSource)
      || ![null, 'openai.usage', 'anthropic.usage', 'google.usageMetadata', 'ollama.counts'].includes(event.usageSource)) {
    throw new TypeError('Invalid token usage event');
  }
  for (const id of [event.callId, event.provider, event.model, event.requestedModel]) validId(id);
  for (const value of [event.inputTokens, event.outputTokens, event.totalTokens]) {
    if (value !== null && (!Number.isSafeInteger(value) || value < 0)) throw new TypeError('Invalid token count');
  }
  const known = sum([event.inputTokens ?? 0, event.outputTokens ?? 0]);
  if (event.totalTokens !== null && (known === null || event.totalTokens < known)) throw new TypeError('Conflicting token total');
  if (event.state === 'pending' && (event.inputTokens !== null || event.outputTokens !== null || event.totalTokens !== null)) {
    throw new TypeError('Pending token usage cannot report completed counts');
  }
  const { callId, scope, state, provider, model, requestedModel, modelSource, usageSource,
    task, source, inputTokens, outputTokens, totalTokens } = event;
  return { callId, scope, state, provider, model, requestedModel, modelSource, usageSource,
    task, source, inputTokens, outputTokens, totalTokens };
}
function uniqueEvents(events: readonly AIUsageEvent[]): AIUsageEvent[] {
  const unique = new Map<string, AIUsageEvent>();
  for (const raw of events) {
    const event = validateTokenUsageEvent(raw);
    const previous = unique.get(event.callId);
    if (previous && !same(previous, event)) throw new TypeError('Conflicting token usage for the same callId');
    unique.set(event.callId, event);
  }
  return [...unique.values()];
}

export function summarizeTokenUsage(events: readonly AIUsageEvent[]): TokenUsageTotals {
  const calls = uniqueEvents(events);
  const input = metric(calls.map((call) => call.inputTokens));
  const output = metric(calls.map((call) => call.outputTokens));
  const total = metric(calls.map((call) => call.totalTokens));
  const unclassified = metric(calls.map((call) => call.totalTokens === null ? null
    : call.totalTokens - (call.inputTokens ?? 0) - (call.outputTokens ?? 0)));
  const reportedTotalTokens = sum(calls.map((call) => call.totalTokens ?? sum([call.inputTokens ?? 0, call.outputTokens ?? 0])));
  const anyKnown = calls.some((call) => [call.inputTokens, call.outputTokens, call.totalTokens].some((value) => value !== null));
  const totalStatus: TokenUsageStatus = total.tokens !== null ? 'complete' : anyKnown ? 'partial' : 'unreported';
  const anyParts = calls.some((call) => call.inputTokens !== null || call.outputTokens !== null);
  const breakdownStatus: TokenUsageStatus = input.tokens !== null && output.tokens !== null
    && unclassified.reportedTokens === 0 ? 'complete' : anyParts ? 'partial' : 'unreported';
  return {
    status: totalStatus, totalStatus, breakdownStatus,
    inputTokens: input.tokens, outputTokens: output.tokens, totalTokens: total.tokens,
    reportedTotalTokens, unclassifiedTokens: unclassified.tokens,
    segments: { input: input.reportedTokens, output: output.reportedTokens, unclassified: unclassified.reportedTokens },
    callCount: calls.length,
    unreportedCallCount: calls.filter((call) => call.inputTokens === null && call.outputTokens === null && call.totalTokens === null).length,
    incompleteCallCount: calls.filter((call) => [call.inputTokens, call.outputTokens, call.totalTokens].includes(null)).length,
    sections: {
      input,
      memory: metric(calls.filter((call) => call.task !== 'scoreRecall').map((call) => call.outputTokens)),
      recall: metric(calls.filter((call) => call.task === 'scoreRecall').map((call) => call.outputTokens)),
    },
  };
}

function grouped(calls: AIUsageEvent[]) {
  const tasks = [...new Set(calls.map((call) => call.task))];
  const models = new Map<string, Pick<AIUsageEvent, 'provider' | 'model' | 'modelSource'>>();
  for (const { provider, model, modelSource } of calls) models.set(JSON.stringify([provider, model, modelSource]), { provider, model, modelSource });
  return {
    byTask: tasks.map((task) => ({ task, ...summarizeTokenUsage(calls.filter((call) => call.task === task)) })),
    byModel: [...models.values()].map((model) => ({ ...model, ...summarizeTokenUsage(calls.filter((call) =>
      call.provider === model.provider && call.model === model.model && call.modelSource === model.modelSource)) })),
  };
}
function unfinished(totals: TokenUsageTotals): TokenUsageTotals {
  const totalStatus = totals.callCount > totals.unreportedCallCount ? 'partial' : 'unreported';
  return { ...totals, status: totalStatus, totalStatus, totalTokens: null,
    breakdownStatus: totals.callCount > 0 && totals.breakdownStatus !== 'unreported' ? 'partial' : 'unreported',
    inputTokens: null, outputTokens: null, unclassifiedTokens: null };
}

/** 저장과 재수신 시 같은 검증·필드 선택·합계 계산을 사용한다. */
export function validateTokenUsageReport(report: TokenUsageReport): TokenUsageReport {
  if (!report || report.schemaVersion !== 2 || report.scope !== 'haema' || report.unit !== 'tokens'
      || !['pending', 'complete'].includes(report.phase) || !Array.isArray(report.calls)
      || !Array.isArray(report.utteranceIds) || report.utteranceIds.length === 0) throw new TypeError('Invalid token usage report');
  const identity = scopeOf(report);
  validId(report.usageId);
  report.utteranceIds.forEach(validId);
  const utteranceIds = [...new Set(report.utteranceIds)];
  const calls = uniqueEvents(report.calls);
  if (report.phase === 'complete' && calls.some((call) => call.state === 'pending')) throw new TypeError('Completed report has pending calls');
  const base = summarizeTokenUsage(calls);
  const totals = report.phase === 'pending' ? unfinished(base) : base;
  return {
    schemaVersion: 2, scope: 'haema', unit: 'tokens', ...identity,
    phase: report.phase, coverage: totals.totalStatus === 'complete' ? 'complete' : 'partial',
    usageId: report.usageId, utteranceIds, attribution: utteranceIds.length === 1 ? 'single' : 'shared',
    ...totals, calls, ...grouped(calls),
  };
}

function reconcileCall(previous: AIUsageEvent, incoming: AIUsageEvent): AIUsageEvent {
  if (same(previous, incoming)) return incoming;
  if (previous.state === 'complete' || incoming.state !== 'complete'
      || previous.scope !== incoming.scope || previous.callId !== incoming.callId
      || previous.provider !== incoming.provider || previous.requestedModel !== incoming.requestedModel || previous.task !== incoming.task) {
    throw new TypeError('Conflicting token usage for the same callId');
  }
  return incoming;
}

export function reconcileTokenUsageReport(previousRaw: TokenUsageReport, incomingRaw: TokenUsageReport): TokenUsageReport {
  const previous = validateTokenUsageReport(previousRaw), incoming = validateTokenUsageReport(incomingRaw);
  if (!same(scopeOf(previous), scopeOf(incoming)) || previous.usageId !== incoming.usageId
      || !same(previous.utteranceIds, incoming.utteranceIds)) throw new TypeError('Conflicting token usage identity');
  if (same(previous, incoming)) return previous;
  if (previous.phase === 'complete') throw new TypeError('Conflicting token usage for the same usageId');
  for (const call of previous.calls) {
    const next = incoming.calls.find((candidate) => candidate.callId === call.callId);
    if (!next) throw new TypeError('Cannot remove an observed AI call');
    reconcileCall(call, next);
  }
  return incoming;
}

/** 요청마다 생성하며 호출 시작과 완료를 같은 callId로 잇는다. */
export class TokenUsageCollector {
  private readonly usageId = randomUUID();
  private readonly identity: TokenUsageScope;
  private readonly utteranceIds: string[];
  private readonly events = new Map<string, AIUsageEvent>();
  constructor(scope: TokenUsageScope & { utteranceIds: string[] }) {
    this.identity = scopeOf(scope);
    if (!Array.isArray(scope.utteranceIds) || !scope.utteranceIds.length) throw new TypeError('Utterance identities are required');
    scope.utteranceIds.forEach(validId);
    this.utteranceIds = [...new Set(scope.utteranceIds)];
  }
  readonly record = (raw: AIUsageEvent): void => {
    const event = validateTokenUsageEvent(raw), previous = this.events.get(event.callId);
    this.events.set(event.callId, previous ? reconcileCall(previous, event) : event);
  };
  snapshot(phase: 'pending' | 'complete' = 'complete'): TokenUsageReport {
    return validateTokenUsageReport({
      schemaVersion: 2, scope: 'haema', unit: 'tokens', ...this.identity, phase,
      usageId: this.usageId, utteranceIds: this.utteranceIds, calls: [...this.events.values()],
    } as TokenUsageReport);
  }
}

/** 같은 저장소·사용자·대화의 영수증을 합산한다. 별도 실제 재시도는 새 ID를 사용한다. */
export function summarizeConversationTokenUsage(reports: readonly TokenUsageReport[], expectedScope?: TokenUsageScope) {
  const identity = expectedScope ? scopeOf(expectedScope) : reports.length ? scopeOf(reports[0]) : null;
  const unique = new Map<string, TokenUsageReport>();
  const callOwners = new Map<string, string>();
  for (const raw of reports) {
    const report = validateTokenUsageReport(raw);
    if (!same(scopeOf(report), identity)) throw new TypeError('Cannot combine different conversations, owners or storage');
    const previous = unique.get(report.usageId);
    const next = previous ? reconcileTokenUsageReport(previous, report) : report;
    for (const call of next.calls) {
      const owner = callOwners.get(call.callId);
      if (owner && owner !== next.usageId) throw new TypeError('A callId cannot belong to different usageIds');
      callOwners.set(call.callId, next.usageId);
    }
    unique.set(next.usageId, next);
  }
  const calls = [...unique.values()].flatMap((report) => report.calls);
  const pendingUsageIds = [...unique.values()].filter((report) => report.phase === 'pending').map((report) => report.usageId);
  const base = summarizeTokenUsage(calls);
  return {
    ...(identity ?? { ownerId: null, storageId: null, conversationId: null }),
    usageIds: [...unique.keys()], reportCount: unique.size, pendingUsageIds,
    ...(pendingUsageIds.length ? unfinished(base) : base), ...grouped(calls),
  };
}

// @editedBy SherrySherry 2026-10-31
/** 검토·전송 관찰은 .jj 밖에서 보관한다. 호출 서비스가 인증 문맥을 제공한다. */
import { createHash } from 'node:crypto';

export interface LayaScope {
  storageId: string;
  ownerId: string;
  hostChatbotId: string;
  conversationId: string;
}
export interface LayaJournalEntry {
  kind: string;
  key: string;
  createdAt: string;
  updatedAt: string;
  data: Record<string, unknown>;
}
export interface LayaJournal {
  read(scope: LayaScope): Promise<LayaJournalEntry[]>;
  /** callback은 동기식이다. 모델 실행을 파일 잠금 안에 두지 않는다. */
  transaction<T>(scope: LayaScope, mutate: (entries: LayaJournalEntry[]) => T): Promise<T>;
}
export class LayaJournalError extends Error {
  readonly code: 'invalid' | 'conflict' | 'locked' | 'corrupt' | 'capacity' | 'unavailable';
  constructor(code: LayaJournalError['code'], message: string) {
    super(message); this.name = 'LayaJournalError'; this.code = code;
  }
}
export function layaIdentifier(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 512
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) throw new LayaJournalError('invalid', `Invalid ${field}`);
}
export function validateLayaScope(scope: LayaScope): void {
  if (!scope || typeof scope !== 'object') throw new LayaJournalError('invalid', 'A scoped context is required');
  for (const key of ['storageId', 'ownerId', 'hostChatbotId', 'conversationId'] as const) layaIdentifier(scope[key], key);
}
function canonical(value: unknown): unknown {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new LayaJournalError('invalid', 'Journal inputs must be JSON values');
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new LayaJournalError('invalid', 'Non-finite input');
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .map(key => [key, canonical((value as Record<string, unknown>)[key])]));
  return value;
}
export function layaDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export function layaText(value: unknown, field: string, max = 100_000): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new LayaJournalError('invalid', `Invalid ${field}`);
}
export function journalEntry(entries: LayaJournalEntry[], kind: string, key: string): LayaJournalEntry | undefined {
  return entries.find(entry => entry.kind === kind && entry.key === key);
}
export function setJournalEntry(entries: LayaJournalEntry[], kind: string, key: string, data: Record<string, unknown>, now = Date.now()): LayaJournalEntry {
  const timestamp = new Date(now).toISOString();
  const entry = journalEntry(entries, kind, key);
  if (entry) { entry.updatedAt = timestamp; entry.data = structuredClone(data); return entry; }
  const created = { kind, key, createdAt: timestamp, updatedAt: timestamp, data: structuredClone(data) };
  entries.push(created); return created;
}

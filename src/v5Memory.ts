// @editedBy SherrySherry 2026-10-31
import { isDeepStrictEqual } from 'node:util';
import { pendingLayaTag, isLayaTag } from './layaReview.ts';
import type { JJumV5, TypeRequirementCatalogV5 } from './types/jjumV5.ts';
import type { LayaVerdict } from './types/jjum.ts';
import { normalizeJJumV5Optionals, preserveOmittedJJumV5Optionals, validateJJumV5, type JJumV5ValidationResult } from './types/validateJJumV5.ts';
import type { FileJJumV5Record, SaveJJumV5Options, V5ReviewLease } from './adapters/fileJJumV5Store.ts';
import { prepareV5ReviewEvidence, v5ReviewContentDigest, v5ReviewDigest,
  type V5ReviewEvidence, type V5ReviewEvidenceInput } from './v5ReviewState.ts';

export interface JJumV5Repository {
  readonly coordinationScope?: object;
  read(ownerId: string, jjumId: string): Promise<FileJJumV5Record | null>;
  list(ownerId: string): Promise<FileJJumV5Record[]>;
  save(jjum: JJumV5, options: SaveJJumV5Options): Promise<FileJJumV5Record>;
  claimReview?(ownerId: string, jjumId: string, reviewToken: string, leaseMs?: number): Promise<V5ReviewLease | null>;
  releaseReview?(ownerId: string, jjumId: string, lease: V5ReviewLease): Promise<void>;
}

export type V5MemoryAudience = { kind: 'owner'; ownerId: string }
  | { kind: 'host'; hostChatbotId: string } | { kind: 'public' };

/** 인증된 대상의 식별은 호출 서비스의 책임이다. 공개 허용과 실제 인지는 각각 판단한다. */
export function assessV5MemoryAccess(jjum: JJumV5, audience: V5MemoryAudience): {
  accessAllowed: boolean; alreadyKnownToHost: boolean; directMention: 'requires-contextual-decision';
} {
  const accessAllowed = (audience.kind === 'owner' && audience.ownerId === jjum.ownerId)
    || jjum.visibility.scope === 'public'
    || (audience.kind === 'host' && jjum.visibility.scope === 'restricted'
      && jjum.visibility.hostIds.includes(audience.hostChatbotId));
  const alreadyKnownToHost = audience.kind === 'host' && !!jjum.hostKnowledge?.some(
    item => item.hostChatbotId === audience.hostChatbotId && item.evidenceIds.length > 0);
  return { accessAllowed, alreadyKnownToHost, directMention: 'requires-contextual-decision' };
}

/** 허용된 내용만 전달한다. 공개·검색·전달만으로 인지 이력을 만들어 저장하지 않는다. */
export function buildV5HostMemory(jjum: JJumV5, hostChatbotId: string) {
  const access = assessV5MemoryAccess(jjum, { kind: 'host', hostChatbotId });
  if (!access.accessAllowed) return null;
  return {
    jjumId: jjum.jjumId, jjumName: jjum.jjumName, summary: jjum.summary,
    ...(jjum.facts ? { facts: structuredClone(jjum.facts) } : {}),
    ...(jjum.events ? { events: structuredClone(jjum.events) } : {}),
    ...(jjum.sensitivity ? { sensitivity: jjum.sensitivity } : {}),
    mentionSuitability: jjum.mentionSuitability,
    layaTag: structuredClone(jjum.layaTag),
    reviewScope: 'whole-memory' as const,
    contentVerification: jjum.layaTag.state === 'reviewed' ? 'review-result-available' as const : 'not-yet-reviewed' as const,
    alreadyKnownToHost: access.alreadyKnownToHost,
    directMention: access.directMention,
  };
}

export interface LayaReviewerV5 {
  review(input: { jjum: JJumV5; preflight: JJumV5ValidationResult } & V5ReviewEvidence): Promise<{ verdict: LayaVerdict; reason: string }>;
}

export type V5CandidateSaveResult = { status: 'needs_information'; preflight: JJumV5ValidationResult;
  candidateRetention?: 'retained' | 'failed' }
  | { status: 'saved'; record: FileJJumV5Record; review: 'pending' | 'reviewed' | 'failed' | 'stale' };
type SavedResult = Extract<V5CandidateSaveResult, { status: 'saved' }>;
interface ReviewFlight {
  requestDigest: string; evidenceDigest: string; requestEtag?: string; createOnly: boolean;
  record: FileJJumV5Record; promise: Promise<SavedResult>;
}
const flights = new WeakMap<object, Map<string, ReviewFlight>>();
const preparation = new WeakMap<object, Map<string, Promise<void>>>();

async function withPreparation<T>(scope: object, key: string, action: () => Promise<T>): Promise<T> {
  let queue = preparation.get(scope);
  if (!queue) preparation.set(scope, queue = new Map());
  const before = queue.get(key) ?? Promise.resolve();
  let unlock!: () => void;
  const current = new Promise<void>(resolve => { unlock = resolve; });
  queue.set(key, current);
  await before;
  try { return await action(); }
  finally { unlock(); if (queue.get(key) === current) queue.delete(key); }
}
function withoutTag(jjum: JJumV5): unknown {
  const { layaTag: ignored, ...value } = jjum;
  return value;
}

/** 없는 필수값을 보충하지 않는다. 누락·정책 대기는 실제 Laya 호출보다 먼저 반환한다. */
export function prepareJJumV5(input: unknown, typeRequirements?: TypeRequirementCatalogV5): JJumV5ValidationResult {
  return validateJJumV5(normalizeJJumV5Optionals(input), { typeRequirements });
}

export async function saveJJumV5Candidate(options: {
  repository: JJumV5Repository;
  input: unknown;
  typeRequirements?: TypeRequirementCatalogV5;
  save: SaveJJumV5Options;
  reviewer?: LayaReviewerV5;
  /** 내용이 같아도 대기·실패 검토를 명시적으로 재개한다. 자동 반복하지 않는다. */
  retryReview?: boolean;
  evidence?: V5ReviewEvidenceInput;
  /** 후보는 .jj 밖에 보관한다. 필수값을 채우거나 완성 기억으로 저장하는 hook이 아니다. */
  retainCandidate?: (candidate: { input: unknown; preflight: JJumV5ValidationResult; evidence: V5ReviewEvidence }) => Promise<void>;
  isCurrent?: () => boolean;
  reviewTimeoutMs?: number;
  reviewLeaseMs?: number;
}): Promise<V5CandidateSaveResult> {
  const input = normalizeJJumV5Optionals(options.input);
  const identity = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown> : undefined;
  const validIdentity = identity?.schemaVersion === 5 && typeof identity.ownerId === 'string' && identity.ownerId.trim()
    && typeof identity.jjumId === 'string' && identity.jjumId.trim();
  const scope = options.repository.coordinationScope ?? options.repository;
  const key = JSON.stringify([identity?.ownerId, identity?.jjumId]);
  const evidence = prepareV5ReviewEvidence(options.evidence);
  const evidenceDigest = v5ReviewDigest(evidence);
  const timeoutMs = options.reviewTimeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) throw new Error('Invalid v5 review timeout');
  let active = flights.get(scope);
  if (!active) flights.set(scope, active = new Map());
  const flightMap = active;
  const prepared = await withPreparation(scope, key, async (): Promise<{ result?: V5CandidateSaveResult; flight?: ReviewFlight }> => {
    const previous = validIdentity ? await options.repository.read(identity!.ownerId as string, identity!.jjumId as string) : null;
    const preflight = validateJJumV5(previous && !options.save.createOnly
      ? preserveOmittedJJumV5Optionals(input, previous.jjum) : input, { typeRequirements: options.typeRequirements });
    if (!preflight.ok || !preflight.jjum) {
      let candidateRetention: 'retained' | 'failed' | undefined;
      if (options.retainCandidate) {
        try { await options.retainCandidate({ input: structuredClone(input), preflight: structuredClone(preflight), evidence }); candidateRetention = 'retained'; }
        catch { candidateRetention = 'failed'; }
      }
      return { result: { status: 'needs_information', preflight, ...(candidateRetention ? { candidateRetention } : {}) } };
    }
    const requestDigest = v5ReviewDigest(withoutTag(preflight.jjum));
    const current = flightMap.get(key);
    if (current && current.requestDigest === requestDigest && current.evidenceDigest === evidenceDigest
      && current.requestEtag === options.save.expectedEtag && current.createOnly === (options.save.createOnly === true)
      && previous?.reviewToken === current.record.reviewToken) return { flight: current };
    const contentChanged = !previous || v5ReviewContentDigest(previous.jjum) !== v5ReviewContentDigest(preflight.jjum);
    const reviewRequested = contentChanged || (options.retryReview === true && previous?.jjum.layaTag.state !== 'reviewed');
    const value = { ...preflight.jjum, layaTag: reviewRequested && previous?.jjum.layaTag.state !== 'pending'
      ? pendingLayaTag(Date.now(), '필수 정보 검사를 마치고 내용 검토를 기다립니다.')
      : previous?.jjum.layaTag ?? pendingLayaTag(Date.now(), '필수 정보 검사를 마치고 내용 검토를 기다립니다.') };
    const saved = await options.repository.save(value, { ...options.save,
      ...(reviewRequested ? { reviewEvidenceDigest: evidenceDigest } : {}) });
    if (!options.reviewer || !reviewRequested) return { result: { status: 'saved', record: saved, review: saved.jjum.layaTag.state } };
    // 같은 내용·근거의 통계 갱신은 진행 중인 검토를 공유한다.
    if (current && current.record.reviewToken === saved.reviewToken && current.evidenceDigest === evidenceDigest
      && v5ReviewContentDigest(current.record.jjum) === v5ReviewContentDigest(saved.jjum)) return { flight: current };
    const flight: ReviewFlight = { requestDigest, evidenceDigest, requestEtag: options.save.expectedEtag,
      createOnly: options.save.createOnly === true, record: saved, promise: undefined! };
    flightMap.set(key, flight);
    flight.promise = Promise.resolve().then(() => runReview(flight, preflight)).finally(() => {
      if (flightMap.get(key) === flight) flightMap.delete(key);
    });
    return { flight };
  });
  return prepared.result ?? prepared.flight!.promise;

  async function runReview(flight: ReviewFlight, preflight: JJumV5ValidationResult): Promise<SavedResult> {
    const saved = flight.record;
    let lease: V5ReviewLease | undefined;
    if (saved.reviewToken && options.repository.claimReview) {
      const claimed = await options.repository.claimReview(saved.jjum.ownerId, saved.jjum.jjumId, saved.reviewToken,
        options.reviewLeaseMs ?? Math.min(600_000, timeoutMs + 30_000));
      if (!claimed) {
        const latest = await options.repository.read(saved.jjum.ownerId, saved.jjum.jjumId);
        return { status: 'saved', record: latest ?? saved,
          review: latest && latest.reviewToken === saved.reviewToken ? latest.jjum.layaTag.state : 'stale' };
      }
      lease = claimed;
    }
    try {
      if (options.isCurrent?.() === false) return { status: 'saved', record: saved, review: 'stale' };
      let tag: JJumV5['layaTag'];
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          options.reviewer!.review({ jjum: structuredClone(saved.jjum), preflight: structuredClone(preflight), ...structuredClone(evidence) }),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('V5 review timeout')), timeoutMs); }),
        ]);
        tag = { state: 'reviewed', verdict: result.verdict, reason: result.reason, timestamp: pendingLayaTag(Date.now()).timestamp };
        if (!isLayaTag(tag)) throw new Error('Invalid Laya response');
      } catch {
        tag = { state: 'failed', reason: '내용 검토가 완료되지 않아 재검토가 필요합니다.', timestamp: pendingLayaTag(Date.now()).timestamp };
      } finally { clearTimeout(timer); }
      for (let attempt = 0; attempt < 2; attempt++) {
        const latest = await options.repository.read(saved.jjum.ownerId, saved.jjum.jjumId);
        if (!latest || flightMap.get(key) !== flight || options.isCurrent?.() === false
          || latest.reviewToken !== saved.reviewToken
          || v5ReviewContentDigest(latest.jjum) !== v5ReviewContentDigest(saved.jjum)
          || !isDeepStrictEqual(latest.jjum.layaTag, saved.jjum.layaTag)) {
          return { status: 'saved', record: latest ?? saved, review: 'stale' };
        }
        try {
          const record = await options.repository.save({ ...latest.jjum, layaTag: tag }, { expectedEtag: latest.etag,
            ...(saved.reviewToken ? { expectedReviewToken: saved.reviewToken } : {}), ...(lease ? { reviewLease: lease } : {}) });
          return { status: 'saved', record, review: tag.state === 'reviewed' ? 'reviewed' : 'failed' };
        } catch (error) {
          if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'conflict') throw error;
        }
      }
      return { status: 'saved', record: (await options.repository.read(saved.jjum.ownerId, saved.jjum.jjumId)) ?? saved, review: 'stale' };
    } finally {
      if (lease && options.repository.releaseReview) {
        try { await options.repository.releaseReview(saved.jjum.ownerId, saved.jjum.jjumId, lease); }
        catch { /* 실패한 lease 해제는 만료로 복구하며 완료된 저장 결과를 바꾸지 않는다. */ }
      }
    }
  }
}

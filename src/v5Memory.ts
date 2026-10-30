// @editedBy SherrySherry 2026-10-30
import { isDeepStrictEqual } from 'node:util';
import { pendingLayaTag, isLayaTag } from './layaReview.ts';
import type { JJumV5, TypeRequirementCatalogV5 } from './types/jjumV5.ts';
import type { LayaVerdict } from './types/jjum.ts';
import { normalizeJJumV5Optionals, preserveOmittedJJumV5Optionals, validateJJumV5, type JJumV5ValidationResult } from './types/validateJJumV5.ts';
import type { FileJJumV5Record, SaveJJumV5Options } from './adapters/fileJJumV5Store.ts';

export interface JJumV5Repository {
  read(ownerId: string, jjumId: string): Promise<FileJJumV5Record | null>;
  list(ownerId: string): Promise<FileJJumV5Record[]>;
  save(jjum: JJumV5, options: SaveJJumV5Options): Promise<FileJJumV5Record>;
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
    alreadyKnownToHost: access.alreadyKnownToHost,
    directMention: access.directMention,
  };
}

export interface LayaReviewerV5 {
  review(input: { jjum: JJumV5; preflight: JJumV5ValidationResult }): Promise<{ verdict: LayaVerdict; reason: string }>;
}

function layaContent(jjum: JJumV5): unknown[] {
  return [jjum.jjumName, jjum.type, jjum.summary, jjum.aliases, jjum.jjtags, jjum.facts,
    jjum.events, jjum.context, jjum.seons, jjum.typeDetails, jjum.visibility, jjum.sensitivity,
    jjum.jjumPower, jjum.mentionSuitability];
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
}): Promise<{ status: 'needs_information'; preflight: JJumV5ValidationResult }
  | { status: 'saved'; record: FileJJumV5Record; review: 'pending' | 'reviewed' | 'failed' | 'stale' }> {
  const input = normalizeJJumV5Optionals(options.input);
  const scope = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown> : undefined;
  const previous = !options.save.createOnly && scope?.schemaVersion === 5
    && typeof scope.ownerId === 'string' && scope.ownerId.trim()
    && typeof scope.jjumId === 'string' && scope.jjumId.trim()
    ? await options.repository.read(scope.ownerId, scope.jjumId) : null;
  // 기존 선택값을 포함한 후보로 필수 정책과 Laya의 내용 변경 여부를 판단한다.
  const preflight = validateJJumV5(previous ? preserveOmittedJJumV5Optionals(input, previous.jjum) : input,
    { typeRequirements: options.typeRequirements });
  if (!preflight.ok || !preflight.jjum) return { status: 'needs_information', preflight };
  const contentChanged = !previous || !isDeepStrictEqual(layaContent(previous.jjum), layaContent(preflight.jjum));
  const reviewRequested = contentChanged || (options.retryReview === true
    && previous?.jjum.layaTag.state !== 'reviewed');
  const prepared = { ...preflight.jjum, layaTag: reviewRequested
    ? pendingLayaTag(Date.now(), '필수 정보 검사를 마치고 내용 검토를 기다립니다.') : previous!.jjum.layaTag };
  const saved = await options.repository.save(prepared, options.save);
  if (!options.reviewer || !reviewRequested) return { status: 'saved', record: saved, review: saved.jjum.layaTag.state };
  let tag: JJumV5['layaTag'];
  try {
    const result = await options.reviewer.review({ jjum: structuredClone(saved.jjum), preflight: structuredClone(preflight) });
    tag = { state: 'reviewed', verdict: result.verdict, reason: result.reason,
      timestamp: pendingLayaTag(Date.now()).timestamp };
    if (!isLayaTag(tag)) throw new Error('Invalid Laya response');
  } catch {
    tag = { state: 'failed', reason: '내용 검토가 완료되지 않아 재검토가 필요합니다.',
      timestamp: pendingLayaTag(Date.now()).timestamp };
  }
  const latest = await options.repository.read(saved.jjum.ownerId, saved.jjum.jjumId);
  if (!latest || latest.etag !== saved.etag || !isDeepStrictEqual(latest.jjum, saved.jjum)) {
    return { status: 'saved', record: latest ?? saved, review: 'stale' };
  }
  try {
    const record = await options.repository.save({ ...latest.jjum, layaTag: tag }, { expectedEtag: latest.etag });
    return { status: 'saved', record, review: tag.state === 'reviewed' ? 'reviewed' : 'failed' };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'conflict') {
      return { status: 'saved', record: (await options.repository.read(saved.jjum.ownerId, saved.jjum.jjumId)) ?? saved, review: 'stale' };
    }
    throw error;
  }
}

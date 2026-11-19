// @editedBy SherrySherry 2026-11-19
import { createHash } from 'node:crypto';
import type { Introduction } from './introduction.ts';
import type { JJum, JJumFact } from './types/jjum.ts';

export const INTRODUCTION_SOURCE = 'haema-console-introduction';
/** Only the in-memory profile extraction workspace accepts profile-derived drafts. */
export const introductionStagingStores = new WeakSet<object>();

/** Owner-edited profile content and its host-scoped derivatives have their own write and access contracts. */
export function isOrdinaryConversationMemory(jjum: JJum): boolean {
  return jjum.sourceService !== INTRODUCTION_SOURCE
    && !(jjum.sourceService === 'haema-console' && jjum.type === '사용자 자아쩜')
    && jjum.context?.userSelfIntroduction === undefined
    && !jjum.facts.some(fact => fact.source === 'introduction');
}

export const LEGACY_SELF_SUMMARY = '이 저장소의 사용자 본인을 나타내는 기억.';
const digest = (text: string): string => createHash('sha256').update(text).digest('hex');
interface EvidenceMarker {
  textSha256: string;
  addedAt: number;
  summarySha256?: string;
}
function markerOf(jjum: JJum): EvidenceMarker | undefined {
  const marker = jjum.context?.userSelfIntroduction;
  if (marker === undefined) return undefined;
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) throw new Error('Invalid introduction evidence');
  const value = marker as Record<string, unknown>;
  if (typeof value.textSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.textSha256)
      || typeof value.addedAt !== 'number' || !Number.isFinite(value.addedAt)
      || value.summarySha256 !== undefined && (typeof value.summarySha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.summarySha256))) {
    throw new Error('Invalid introduction evidence');
  }
  return value as unknown as EvidenceMarker;
}
function matches(fact: JJumFact, marker: EvidenceMarker): boolean {
  return fact.source === 'introduction' && fact.addedAt === marker.addedAt && digest(fact.text) === marker.textSha256;
}
export function hasIntroductionEvidence(jjum: JJum, text: string): boolean {
  const marker = markerOf(jjum);
  if (!marker || marker.textSha256 !== digest(text)) return false;
  const attributed = jjum.facts.filter(fact => fact.source === 'introduction');
  return attributed.length === 1 && matches(attributed[0], marker);
}

// The complete profile is owner data. Host views receive independent, scoped derived memories.
export function withoutUserIntroductionEvidence(jjum: JJum): JJum {
  const marker = markerOf(jjum);
  if (!marker && !jjum.facts.some(fact => fact.source === 'introduction')) return jjum;
  const { userSelfIntroduction: _ownerEvidence, ...context } = jjum.context ?? {};
  const managedSummary = !marker || marker.summarySha256 === digest(jjum.summary);
  return { ...jjum, context, summary: managedSummary ? LEGACY_SELF_SUMMARY : jjum.summary,
    facts: jjum.facts.filter(fact => fact.source !== 'introduction'
      && !(marker && fact.addedAt === marker.addedAt && digest(fact.text) === marker.textSha256)) };
}

/** Only the bound profile owns this one verbatim fact and its generated summary. Preserve manual edits. */
export function withIntroductionEvidence(jjum: JJum, introduction: Introduction): JJum {
  if (jjum.context !== undefined && (!jjum.context || typeof jjum.context !== 'object' || Array.isArray(jjum.context))) {
    throw new Error('The existing user memory context requires reconciliation');
  }
  const marker = markerOf(jjum);
  const textSha256 = digest(introduction.text);
  const facts = [...(jjum.facts ?? [])];
  const previous = facts.filter(fact => fact.source === 'introduction');
  if (marker ? previous.length !== 1 || !matches(previous[0], marker) : previous.length !== 0) {
    throw new Error('An independently edited introduction fact requires reconciliation');
  }
  if (marker?.textSha256 === textSha256) return jjum;
  const addedAt = Date.parse(introduction.updatedAt ?? '');
  if (!Number.isFinite(addedAt)) throw new Error('Introduction evidence requires its saved time');
  const nextFact: JJumFact = { text: introduction.text, addedAt, source: 'introduction' };
  if (previous.length && !Object.keys(previous[0]).every(key => ['text', 'addedAt', 'source'].includes(key))) {
    throw new Error('Introduction fact extensions require reconciliation before replacement');
  }
  if (previous.length) facts[facts.indexOf(previous[0])] = nextFact;
  else facts.push(nextFact);
  const manageSummary = marker ? marker.summarySha256 === digest(jjum.summary)
    : jjum.summary === LEGACY_SELF_SUMMARY;
  let summary = jjum.summary;
  if (manageSummary) {
    const text = introduction.text.trim();
    const excerpt = /^.{1,160}/su.exec(text)?.[0] ?? '';
    summary = '자기소개 발췌 · ' + excerpt + (excerpt.length < text.length ? '…' : '');
  }
  return { ...jjum, summary, facts, context: { ...jjum.context, userSelfIntroduction: {
    ...marker, textSha256, addedAt, summarySha256: manageSummary ? digest(summary) : undefined,
  } } };
}

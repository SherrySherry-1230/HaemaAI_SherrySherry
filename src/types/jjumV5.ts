// @editedBy SherrySherry 2026-10-30
/** v5 저장 자료. v4와 별도로 검증하며 원본 파일의 버전을 자동 변경하지 않는다. */
import type { JJumEditEntry, JJumFact, JJumStatus, LayaTag, ResponseFeedback } from './jjum.ts';

export type JSONValue = string | number | boolean | null | JSONValue[] | { [key: string]: JSONValue };
export type JSONObject = { [key: string]: JSONValue };
export const JJUM_V5_SCHEMA_VERSION = 5 as const;

/** 공개 범위는 민감도·언급 매너·호스트의 실제 인지와 별개다. 기본값을 추정하지 않는다. */
export type JJumVisibility = { scope: 'private' | 'public'; hostIds?: never }
  | { scope: 'restricted'; hostIds: string[] };

export interface HostKnowledgeEvidence {
  hostChatbotId: string;
  evidenceIds: string[];
  learnedAt: number;
}

export interface CalculationRefV5 {
  profileId: string;
  profileVersion: string;
  rule: string;
  coefficientDigest: string;
  ruleVersion: string;
  packageVersion?: string;
}

export interface SeonEvidenceV5 {
  evidenceId: string;
  conversationId: string;
  utteranceId: string;
  hostChatbotId: string;
  timestamp: number;
  delta: number;
  occurredAt?: number;
  replacesEvidenceId?: string;
  calculationRef?: CalculationRefV5;
}

interface SeonV5Base {
  seonId: string;
  targetId: string;
  label: string;
  history: SeonEvidenceV5[];
  lastActivated?: number;
}

export interface GeneralSeonV5 extends SeonV5Base { weight: number }
export interface ParentChildSeonV5 extends SeonV5Base { role: 'parent' | 'child'; weight: number }
export interface UpperLowerSeonV5 extends SeonV5Base { role: 'upper' | 'lower'; receivedWeight: number }
export interface JJumSeonsV5 {
  general?: GeneralSeonV5[];
  parentChild?: ParentChildSeonV5[];
  upperLower?: UpperLowerSeonV5[];
}

export interface JJumMentionV5 {
  hostChatbotId: string;
  conversationId: string;
  utteranceId: string;
  fingerprint: string;
  role: 'user' | 'assistant';
  kind: 'initiated' | 'prompted' | 'host';
  counted: boolean;
  receivedAt: number;
  recordedAt: number;
  occurredAt?: number;
}

export interface JJumMentionChunkV5 { sequence: number; entries: JJumMentionV5[] }
export interface JJumRecallRecordV5 {
  hostChatbotId: string;
  conversationId: string;
  utteranceId: string;
  timestamp: number;
}

export interface PowerEvidenceV5 {
  evidenceId: string;
  kind: 'mention' | 'duration' | 'emotion' | 'seon';
  data: JSONObject;
  occurredAt?: number;
  replacesEvidenceId?: string;
}

export interface PowerComponentsV5 { mention: number; duration: number; emotion: number; seon: number }
export interface PowerCalculationV5 {
  profileId: string;
  profileVersion: string;
  formula: 'root' | 'logarithm';
  coefficientDigest: string;
  policyVersion: string;
  evidence: PowerEvidenceV5[];
  rawScores?: PowerComponentsV5;
  /** 네 항의 하한을 적용하기 전 기여값이다. */
  contributions: PowerComponentsV5;
  calculatedAt: number;
}

export interface PowerHistoryV5 {
  operationId: string;
  timestamp: number;
  previousPower: number;
  power: number;
  previousCalculation?: PowerCalculationV5;
  calculation: PowerCalculationV5;
}

export interface MannerHistoryV5 {
  evidenceId: string;
  timestamp: number;
  previousValue: number;
  value: number;
  policyVersion: string;
  reason: string;
}

export interface JJumV5 {
  schemaVersion: 5;
  jjumId: string;
  jjumName: string;
  type: string[];
  summary: string;
  ownerId: string;
  hostChatbotId: string;
  sourceService: string;
  /** 유한한 소수 원값. 표시용 반올림 값을 다시 저장하지 않는다. */
  jjumPower: number;
  mentionSuitability: number;
  mentionCount: number;
  firstSeen: number;
  lastMentioned: number;
  recallCount: number;
  status: JJumStatus;
  layaTag: LayaTag;
  visibility: JJumVisibility;
  sensitivity?: string;
  hostKnowledge?: HostKnowledgeEvidence[];
  typeDetails?: JSONObject;
  powerCalculation?: PowerCalculationV5;
  powerHistory?: PowerHistoryV5[];
  mannerHistory?: MannerHistoryV5[];
  aliases?: string[];
  jjtags?: string[];
  facts?: JJumFact[];
  events?: { date: number; summary: string; refJJumIds?: string[] }[];
  context?: JSONObject;
  seons?: JJumSeonsV5;
  mentionHistory?: JJumMentionV5[];
  mentionHistoryChunks?: JJumMentionChunkV5[];
  recallHistory?: JJumRecallRecordV5[];
  hostProactiveMentionHistory?: JJumRecallRecordV5[];
  lastRecalled?: number;
  pinned?: boolean;
  mergedFrom?: string[];
  mergedInto?: string;
  editHistory?: JJumEditEntry[];
  responseFeedback?: ResponseFeedback[];
  /** 서비스 확장은 저장·반환만 하며 코어의 타입별 판단에 사용하지 않는다. */
  meta?: JSONObject;
}

export type TypeRequirementCondition = { path: string; equals: JSONValue }
  | { path: string; exists: boolean };
export interface TypeRequirementsV5 {
  required: string[];
  conditional?: { when: TypeRequirementCondition; required: string[] }[];
}
/** 실제 채택한 타입별 정책을 호출자가 제공한다. 빈 규칙도 명시해야 한다. */
export type TypeRequirementCatalogV5 = Record<string, TypeRequirementsV5>;

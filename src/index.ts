// @editedBy SherrySherry 2026-10-16
/** @haema/core 공개 진입점 */

export * from './types/jjum.ts';
export { validateJJum, type ValidationResult } from './types/validateJJum.ts';
export { createJJum, type CreateJJumInput } from './createJJum.ts';
export {
  reviewStoredJJum,
  captureLayaReviewIntent,
  pendingLayaTag,
  layaContentSnapshot,
  type LayaReviewEngine,
  type LayaReviewRequest,
  type LayaReviewResult,
  type LayaReviewIntent,
} from './layaReview.ts';
export {
  DEFAULT_MENTION_HISTORY_CHUNK_SIZE,
  iterateMentionHistory,
  appendMentionHistory,
  getMentionHistoryGroups,
  type MentionHistoryGroup,
} from './mentionHistory.ts';
export {
  parseMentionCoefficientsCsv,
  calculateMentionScore,
  type MentionCoefficients,
} from './mentionScore.ts';
export type { JJumQuery, JJumSortKey, StorageAdapter } from './adapters/storageAdapter.ts';
export { FileAdapter, type FileAdapterOptions, type LoadError } from './adapters/fileAdapter.ts';
export type {
  AIAdapter,
  AIAdapterConfig,
  AIProvider,
  AITask,
  ConversationTurn,
  DraftMention,
  CustomAICall,
  ExtractRequest,
  ExtractedDraft,
  MergeJudgement,
  RecallScore,
} from './adapters/aiAdapter.ts';
export type { AIUsageEvent, TokenCounts } from './adapters/aiUsage.ts';
export {
  TokenUsageCollector,
  summarizeTokenUsage,
  summarizeConversationTokenUsage,
  validateTokenUsageReport,
  reconcileTokenUsageReport,
  type TokenUsageStatus,
  type TokenUsageScope,
  type TokenUsageMetric,
  type TokenUsageTotals,
  type TokenUsageReport,
} from './tokenUsage.ts';
export { FileTokenUsageStore, TokenUsageStoreError, type TokenUsageConversation } from './adapters/fileTokenUsageStore.ts';
export {
  prepareConversationRequest,
  type PreparedConversationRequest,
  type PreparedConversationTurn,
  type ConversationReceipt,
} from './conversationIdentity.ts';
export {
  processConversationToStorage,
  ConversationProcessingError,
  ConversationSupersededError,
  type ConversationProcessingResult,
} from './integration.ts';
export {
  IncrementalConversationSession,
  type IncrementalConversationScope,
  type IncrementalConversationInput,
  type IncrementalConversationWork,
  type IncrementalConversationHooks,
  type IncrementalConversationView,
  type IncrementalConversationAcceptance,
  type InputContinuity,
  type SpeculativeResult,
  type TemporaryJJumFragment,
} from './incrementalConversation.ts';
export { SpeculativeMemoryExplorer } from './speculativeMemory.ts';
export { assessResponseReadiness, type ResponseReadiness } from './responseReadiness.ts';
export { OpenAIAdapter } from './adapters/openaiAdapter.ts';
export {
  LayaDecisionEngine,
  type DecisionScore,
  type LayaDecisionEngineOptions,
  type RecallDecisionEngine,
} from './decision/layaDecisionEngine.ts';
export { valenceOf, isNegative, canBringUpFirst, VALENCE_TAGS, type Valence } from './valence.ts';
export {
  recall,
  renderJJum,
  estimateTokens,
  buildTopics,
  GUIDE_MODES,
  DEFAULT_FORBIDDEN,
  type RecallOptions,
  type RecallResult,
  type RecallCandidate,
  type RecallStats,
  type AnswerGuide,
  type GuideMode,
  type FollowUpQuestion,
  type Topic,
  type TopicKind,
  type MatchedBy,
} from './recall.ts';
export {
  CONCERN_TYPE,
  TAG_UNRESOLVED,
  TAG_RESOLVED,
  CAREFUL_INSTRUCTION,
  isConcern,
  isUnresolvedConcern,
  resolveConcern,
} from './concern.ts';
export { upsertSeon, seonsTo, strongestSeon, strongestSeons } from './seons.ts';
export {
  getOpenConcerns,
  selectOpenConcerns,
  getProactiveCues,
  getRecentMoodSignals,
  type ProactiveCue,
  type ProactiveKind,
  type ProactiveOptions,
  type MoodSignals,
  type MoodOptions,
} from './proactive.ts';

// @editedBy SherrySherry 2026-10-30
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
export { FileAdapter, UnsupportedJJumSchemaError, type FileAdapterOptions, type LoadError } from './adapters/fileAdapter.ts';
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
  tokenUsageForLegacyConsole,
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
  type Introduction,
  IntroductionStoreError,
  emptyIntroduction,
  validateIntroductionText,
  validateDisplayName,
  validateIntroductionOwnerId,
  validateIntroductionRevision,
  MAX_INTRODUCTION_TEXT_BYTES,
  MAX_DISPLAY_NAME_CODE_POINTS,
} from './introduction.ts';
export { FileIntroductionStore } from './adapters/fileIntroductionStore.ts';
export {
  resolveIntroductionDisplayName,
  type IntroductionDisplayNameSelection,
  type ResolvedIntroductionDisplayName,
} from './introductionName.ts';
export { buildIntroductionHostContext, type IntroductionHostContext } from './introductionHostContext.ts';
export * from './userSelfJJum.ts';
export * from './types/jjumV5.ts';
export * from './types/validateJJumV5.ts';
export * from './calculationProfiles.ts';
export * from './adapters/localCalculationProfileProvider.ts';
export * from './adapters/fileJJumV5Store.ts';
export * from './v5Calculations.ts';
export * from './v5Memory.ts';
export * from './v5Seons.ts';
export * from './profileRecalculation.ts';
export * from './adapters/fileProfileRecalculationJournal.ts';
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
export * from './layaJournal.ts';
export * from './layaObservation.ts';
export * from './layaHostEvents.ts';
export * from './layaHttp.ts';
export * from './layaRuntime.ts';
export * from './v5HostProactive.ts';
export * from './reflectionJobs.ts';
export * from './adapters/fileLayaJournal.ts';
export * from './adapters/fileReflectionJobStore.ts';
export * from './decision/layaV5Reviewer.ts';
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

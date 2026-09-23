// @editedBy SherrySherry 2026-09-06
/** @haema/core 공개 진입점 */

export * from './types/jjum.ts';
export { validateJJum, type ValidationResult } from './types/validateJJum';
export { createJJum, type CreateJJumInput } from './createJJum';
export type { JJumQuery, JJumSortKey, StorageAdapter } from './adapters/storageAdapter';
export { FileAdapter, type FileAdapterOptions, type LoadError } from './adapters/fileAdapter';
export type {
  AIAdapter,
  AIAdapterConfig,
  AIProvider,
  AITask,
  ConversationTurn,
  CustomAICall,
  ExtractRequest,
  ExtractedDraft,
  MergeJudgement,
  RecallScore,
} from './adapters/aiAdapter';
export { OpenAIAdapter } from './adapters/openaiAdapter';
export {
  LayaDecisionEngine,
  type DecisionScore,
  type LayaDecisionEngineOptions,
  type RecallDecisionEngine,
} from './decision/layaDecisionEngine.ts';
export { valenceOf, isNegative, canBringUpFirst, VALENCE_TAGS, type Valence } from './valence';
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
} from './recall';
export {
  CONCERN_TYPE,
  TAG_UNRESOLVED,
  TAG_RESOLVED,
  CAREFUL_INSTRUCTION,
  isConcern,
  isUnresolvedConcern,
  resolveConcern,
} from './concern';
export { upsertSeon, seonsTo, strongestSeon, strongestSeons } from './seons';
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
} from './proactive';

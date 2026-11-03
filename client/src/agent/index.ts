export type {
  AgentLoopCallbacks,
  AgentLoopContext,
  AgentLoopPhase,
  AgentLoopState,
  AgentLoopStatus,
} from './types'
export type { AgentEvent } from './events'
export { executeSuggestion, stepLabel } from './executeSuggestion'
export type { ExecuteSuggestionOutcome } from './executeSuggestion'
export {
  runAgentToolLoop,
  runAgentUserTurn,
  resumeAgentToolLoop,
  streamAgentUserTurn,
  streamAgentToolLoop,
  streamAgentResume,
} from './toolLoop'
export type { AgentEventSink } from './toolLoop'
export { supportsNativeAnthropicTools, HIVE_AGENT_ANTHROPIC_TOOLS } from './anthropicTools'
export {
  loadAgentChatHistory,
  saveAgentChatHistory,
  clearAgentChatHistory,
  listAgentChatHistoryIndex,
  agentChatHostKey,
  type AgentChatLine,
  type AgentChatSnapshot,
} from './chatHistory'
export { agentUserModelTurn, agentContinueModelTurn } from './modelTurn'
/** Default max tool/shell steps per user message (one SDK "turn" may include many internal steps). */
export const DEFAULT_AGENT_MAX_STEPS = 24

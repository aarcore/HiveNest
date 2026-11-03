import type { ExecResult, Proposal, SessionInfo, SessionToolBody } from '../api'
import type { ChatMessage, SuggestCommandResult } from '../settings/llm'
import type { ProviderConfig } from '../settings/types'
import type { AnthropicTranscriptMessage } from './anthropicTurn'
import type { McpConnectionState, PendingMcpCall } from './mcp'

/**
 * Agent loop phases (aligned with Claude Agent SDK lifecycle:
 * prompt → model → tool execution → feed results → repeat until no tools).
 * @see https://code.claude.com/docs/en/agent-sdk/agent-loop
 */
export type AgentLoopPhase =
  | 'idle'
  | 'model'
  | 'executing'
  | 'awaiting_permission'
  | 'completed'
  | 'stopped'
  | 'error'

export type AgentLoopStatus =
  | { phase: 'completed' | 'stopped' }
  | { phase: 'awaiting_permission'; proposal: Proposal }
  | { phase: 'error'; message: string }

/** Mutable turn state (SDK session-scoped loop counters + pending approval). */
export type AgentLoopState = {
  step: number
  pendingTool: SessionToolBody | null
  pendingMcp: PendingMcpCall | null
  /** Anthropic Messages API transcript (native tool_use path). */
  anthropicTranscript: AnthropicTranscriptMessage[] | null
  useNativeTools: boolean
  /** tool_use id awaiting tool_result after exec. */
  pendingToolUseId: string | null
}

export type AgentLoopCallbacks = {
  onUserMessage?: (text: string) => void
  onAssistantMessage: (text: string) => void
  onStep: (step: number, label: string) => void
  onExecResult: (result: ExecResult) => void
  onNote: (text: string) => void
  onError: (message: string) => void
  onProposal?: (proposal: Proposal) => void
  onDone: () => void
  onMaxSteps: () => void
}

export type AgentLoopContext = {
  session: SessionInfo
  provider: ProviderConfig
  maxSteps: number
  getStopRequested: () => boolean
  sessionContext: () => string | undefined
  extraSystem: () => string
  mcpStates: McpConnectionState[]
  getHistory: () => ChatMessage[]
  setHistory: (history: ChatMessage[]) => void
  /** Create approval proposal (permission hook — like SDK PreToolUse). */
  propose: (
    command: string,
    reason: string,
    risk?: 'low' | 'medium' | 'high',
  ) => Promise<Proposal | null>
  callbacks: AgentLoopCallbacks
  labels: {
    agentDone: string
    agentStep: string
    approvalRequired: string
    awaitingApproval: string
    agentToolNative: string
    agentToolFallback: string
  }
}

export type { SuggestCommandResult, ChatMessage, ExecResult, Proposal }

import {
  chatSuggestCommand,
  continueFromResult,
  type ChatMessage,
  type SuggestCommandResult,
} from '../settings/llm'
import type { ProviderConfig } from '../settings/types'
import type { AnthropicTranscriptMessage } from './anthropicTurn'
import { anthropicAgentToolResultTurn, anthropicAgentUserTurn } from './anthropicTurn'
import { supportsNativeAnthropicTools } from './anthropicTools'
import type { AgentLoopState } from './types'

export type ModelTurnResult = {
  result: SuggestCommandResult
  nextHistory: ChatMessage[]
  mode: 'json_protocol' | 'anthropic_tools'
}

function flattenTranscriptForHistory(
  transcript: AnthropicTranscriptMessage[],
  assistantFallback: string,
): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const m of transcript) {
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content })
      continue
    }
    const text = m.content
      .filter((b) => b.type === 'text' && 'text' in b)
      .map((b) => (b as { text: string }).text)
      .join('\n')
    const tools = m.content
      .filter((b) => b.type === 'tool_use')
      .map((b) => `[tool_use ${(b as { name: string }).name}]`)
      .join(' ')
    const combined = [text, tools].filter(Boolean).join('\n') || assistantFallback
    out.push({ role: m.role, content: combined })
  }
  return out.slice(-16)
}

/** First model call for a user turn (native tools or JSON protocol). */
export async function agentUserModelTurn(
  provider: ProviderConfig,
  state: AgentLoopState,
  history: ChatMessage[],
  userText: string,
  sessionContext?: string,
  extraSystem?: string,
): Promise<ModelTurnResult> {
  if (supportsNativeAnthropicTools(provider)) {
    state.useNativeTools = true
    const turn = await anthropicAgentUserTurn(
      provider,
      history,
      userText,
      sessionContext,
      extraSystem,
      state.anthropicTranscript,
    )
    state.anthropicTranscript = turn.transcript
    const nextHistory = flattenTranscriptForHistory(turn.transcript, turn.assistantText)
    return {
      result: turn.suggestion,
      nextHistory,
      mode: 'anthropic_tools',
    }
  }

  state.useNativeTools = false
  state.anthropicTranscript = null
  const { result, nextHistory } = await chatSuggestCommand(
    provider,
    history,
    userText,
    sessionContext,
    extraSystem,
  )
  return { result, nextHistory, mode: 'json_protocol' }
}

/** Model call after a tool/shell exec (feeds results back into the loop). */
export async function agentContinueModelTurn(
  provider: ProviderConfig,
  state: AgentLoopState,
  history: ChatMessage[],
  exec: {
    command: string
    exit_code: number
    stdout: string
    stderr: string
    risk?: string
  },
  sessionContext?: string,
  extraSystem?: string,
): Promise<ModelTurnResult> {
  if (state.useNativeTools && state.anthropicTranscript && state.pendingToolUseId) {
    const summary = [
      `Command: ${exec.command}`,
      `exit_code=${exec.exit_code}`,
      exec.risk ? `risk=${exec.risk}` : '',
      '--- stdout ---',
      (exec.stdout || '(empty)').slice(0, 6000),
      '--- stderr ---',
      (exec.stderr || '(empty)').slice(0, 2000),
    ]
      .filter(Boolean)
      .join('\n')

    const turn = await anthropicAgentToolResultTurn(
      provider,
      state.anthropicTranscript,
      state.pendingToolUseId,
      summary,
      sessionContext,
      extraSystem,
    )
    state.pendingToolUseId = null
    state.anthropicTranscript = turn.transcript
    const nextHistory = flattenTranscriptForHistory(turn.transcript, turn.assistantText)
    return {
      result: turn.suggestion,
      nextHistory,
      mode: 'anthropic_tools',
    }
  }

  const { result, nextHistory } = await continueFromResult(
    provider,
    history,
    exec,
    sessionContext,
    extraSystem,
  )
  return { result, nextHistory, mode: 'json_protocol' }
}

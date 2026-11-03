import { describe, expect, it, vi } from 'vitest'
import { runAgentToolLoop } from './toolLoop'
import type { AgentLoopContext, AgentLoopState } from './types'
import type { SessionInfo } from '../api'
import type { ProviderConfig } from '../settings/types'

const session = {
  id: 's1',
  host_id: 'h1',
  user: 'root',
  remote: 'root@host',
  created_at: '',
  has_pty: true,
} satisfies SessionInfo

const provider = {
  id: 'openai',
  enabled: true,
  apiBaseUrl: 'https://example.com/v1',
  apiKey: 'k',
  defaultModel: 'gpt-4',
  orgOrRegion: '',
  extraHeaders: '',
} satisfies ProviderConfig

describe('runAgentToolLoop', () => {
  it('stops immediately when suggestion is done', async () => {
    const onDone = vi.fn()
    const state: AgentLoopState = {
      step: 0,
      pendingTool: null,
      pendingMcp: null,
      anthropicTranscript: null,
      useNativeTools: false,
      pendingToolUseId: null,
    }
    const ctx: AgentLoopContext = {
      session,
      provider,
      maxSteps: 24,
      getStopRequested: () => false,
      sessionContext: () => undefined,
      extraSystem: () => '',
      mcpStates: [],
      getHistory: () => [],
      setHistory: () => {},
      propose: async () => null,
      callbacks: {
        onAssistantMessage: () => {},
        onStep: () => {},
        onExecResult: () => {},
        onNote: () => {},
        onError: () => {},
        onDone,
        onMaxSteps: () => {},
      },
      labels: {
        agentDone: 'done',
        agentStep: 'step',
        approvalRequired: 'approval',
        awaitingApproval: 'wait',
        agentToolNative: 'native',
        agentToolFallback: 'fallback',
      },
    }
    const status = await runAgentToolLoop(ctx, state, {
      command: 'true',
      reason: 'ok',
      assistantText: 'finished',
      done: true,
      raw: '',
    })
    expect(status.phase).toBe('completed')
    expect(onDone).toHaveBeenCalled()
    expect(state.step).toBe(0)
  })
})

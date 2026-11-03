/** @vitest-environment jsdom */
import { describe, expect, it, beforeEach } from 'vitest'
import {
  clearAgentChatHistory,
  loadAgentChatHistory,
  saveAgentChatHistory,
  type AgentChatLine,
} from './chatHistory'
import type { AgentLoopState } from './types'

const HOST = 'host-test-1'

const defaultLoop: AgentLoopState = {
  step: 0,
  pendingTool: null,
  pendingMcp: null,
  anthropicTranscript: null,
  useNativeTools: false,
  pendingToolUseId: null,
}

describe('agent chatHistory', () => {
  beforeEach(() => {
    localStorage.clear()
    clearAgentChatHistory(HOST)
  })

  it('round-trips lines and LLM history', () => {
    const lines: AgentChatLine[] = [
      { kind: 'user', text: 'check disk' },
      { kind: 'assistant', text: 'running df -h' },
    ]
    saveAgentChatHistory(HOST, {
      lines,
      history: [
        { role: 'user', content: 'check disk' },
        { role: 'assistant', content: 'ok' },
      ],
      loopState: defaultLoop,
    })
    const loaded = loadAgentChatHistory(HOST)
    expect(loaded?.lines).toHaveLength(2)
    expect(loaded?.history).toHaveLength(2)
  })

  it('converts pending proposals to notes on save', () => {
    saveAgentChatHistory(HOST, {
      lines: [
        {
          kind: 'proposal',
          proposal: {
            id: 'p1',
            session_id: 's1',
            host_id: HOST,
            command: 'rm -rf /',
            reason: 'bad',
            risk: 'high',
            status: 'pending',
            created_at: '',
            expires_at: '',
          },
        },
      ],
      history: [],
      loopState: defaultLoop,
    })
    const loaded = loadAgentChatHistory(HOST)!
    expect(loaded.lines[0].kind).toBe('note')
  })
})

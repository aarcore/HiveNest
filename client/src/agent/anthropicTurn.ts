import { netFetch } from '../netFetch'
import type { ChatMessage } from '../settings/llm'
import type { ProviderConfig } from '../settings/types'
import {
  AGENT_SYSTEM_NATIVE,
  HIVE_AGENT_ANTHROPIC_TOOLS,
  toolUseToSuggestion,
  type AnthropicToolDef,
} from './anthropicTools'
import type { SuggestCommandResult } from '../settings/llm'

export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string }

export type AnthropicTranscriptMessage = {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

export type AnthropicTurnResult = {
  suggestion: SuggestCommandResult
  transcript: AnthropicTranscriptMessage[]
  assistantText: string
}

function parseExtraHeaders(raw: string): Record<string, string> {
  const t = raw.trim()
  if (!t) return {}
  try {
    const obj = JSON.parse(t) as unknown
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        out[k] = String(v)
      }
    }
    return out
  } catch {
    return {}
  }
}

function chatToTranscript(history: ChatMessage[]): AnthropicTranscriptMessage[] {
  return history
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: m.content,
    }))
}

async function anthropicMessagesRequest(
  provider: ProviderConfig,
  system: string,
  messages: AnthropicTranscriptMessage[],
  tools: AnthropicToolDef[],
): Promise<{ content: AnthropicContentBlock[]; raw: string }> {
  const base = provider.apiBaseUrl.replace(/\/$/, '')
  const url = `${base}/v1/messages`
  const version =
    provider.id === 'custom' ? '2023-06-01' : provider.orgOrRegion.trim() || '2023-06-01'
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': provider.apiKey,
    'anthropic-version': version,
    ...parseExtraHeaders(provider.extraHeaders || ''),
  }
  const res = await netFetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: provider.defaultModel,
      max_tokens: 4096,
      system,
      tools,
      tool_choice: { type: 'auto' },
      messages,
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = body?.error?.message || body?.message || `${res.status} ${res.statusText}`
    throw new Error(msg)
  }
  const content = (body?.content || []) as AnthropicContentBlock[]
  return { content, raw: JSON.stringify(body) }
}

function parseAssistantBlocks(
  content: AnthropicContentBlock[],
  raw: string,
): { suggestion: SuggestCommandResult; assistantText: string } {
  const textParts = content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text' && !!b.text)
    .map((b) => b.text)
  const assistantText = textParts.join('\n').trim()
  const toolUse = content.find(
    (b): b is Extract<AnthropicContentBlock, { type: 'tool_use' }> => b.type === 'tool_use',
  )
  if (toolUse) {
    return {
      assistantText,
      suggestion: toolUseToSuggestion(
        toolUse.id,
        toolUse.name,
        toolUse.input || {},
        assistantText,
        raw,
      ),
    }
  }
  return {
    assistantText,
    suggestion: {
      command: 'true',
      reason: 'done',
      assistantText: assistantText || 'Done.',
      done: true,
      raw,
    },
  }
}

export async function anthropicAgentUserTurn(
  provider: ProviderConfig,
  history: ChatMessage[],
  userText: string,
  sessionContext?: string,
  extraSystem?: string,
  existingTranscript?: AnthropicTranscriptMessage[] | null,
): Promise<AnthropicTurnResult> {
  const system = [
    AGENT_SYSTEM_NATIVE,
    sessionContext ? `Current session: ${sessionContext}` : '',
    extraSystem || '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const transcript =
    existingTranscript && existingTranscript.length
      ? [...existingTranscript]
      : chatToTranscript(history)

  transcript.push({ role: 'user', content: userText })

  const { content, raw } = await anthropicMessagesRequest(
    provider,
    system,
    transcript,
    HIVE_AGENT_ANTHROPIC_TOOLS,
  )
  transcript.push({ role: 'assistant', content })

  const { suggestion, assistantText } = parseAssistantBlocks(content, raw)
  return { suggestion, transcript, assistantText }
}

export async function anthropicAgentToolResultTurn(
  provider: ProviderConfig,
  transcript: AnthropicTranscriptMessage[],
  toolUseId: string,
  execSummary: string,
  sessionContext?: string,
  extraSystem?: string,
): Promise<AnthropicTurnResult> {
  const system = [
    AGENT_SYSTEM_NATIVE,
    sessionContext ? `Current session: ${sessionContext}` : '',
    extraSystem || '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const next = [...transcript]
  next.push({
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: execSummary.slice(0, 12000),
      },
    ],
  })

  const { content, raw } = await anthropicMessagesRequest(
    provider,
    system,
    next,
    HIVE_AGENT_ANTHROPIC_TOOLS,
  )
  next.push({ role: 'assistant', content })

  const { suggestion, assistantText } = parseAssistantBlocks(content, raw)
  return { suggestion, transcript: next, assistantText }
}

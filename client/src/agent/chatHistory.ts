import type { ExecResult, Proposal } from '../api'
import type { ChatMessage } from '../settings/llm'
import type { AgentLoopState } from './types'
import type { AnthropicTranscriptMessage } from './anthropicTurn'

/** UI log line (serializable subset of AgentPanel chat). */
export type AgentChatLine =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'note'; text: string }
  | { kind: 'proposal'; proposal: Proposal }
  | { kind: 'result'; result: ExecResult }
  | { kind: 'error'; text: string }

export type AgentChatSnapshot = {
  version: 1
  updatedAt: string
  lines: AgentChatLine[]
  history: ChatMessage[]
  loopState: Pick<
    AgentLoopState,
    'anthropicTranscript' | 'useNativeTools' | 'pendingToolUseId'
  >
}

const STORAGE_PREFIX = 'hivenest.agent.chat.v1.'
const INDEX_KEY = 'hivenest.agent.chat.index.v1'

const MAX_LINES = 240
const MAX_HISTORY = 32
const MAX_TEXT = 12_000
const MAX_EXEC_OUT = 8_000
const MAX_TRANSCRIPT_MSGS = 24

export function agentChatHostKey(hostId: string | undefined, sessionId: string | undefined): string | null {
  const id = (hostId || sessionId || '').trim()
  return id || null
}

function storageKey(hostKey: string): string {
  return `${STORAGE_PREFIX}${hostKey}`
}

function trimText(s: string, max = MAX_TEXT): string {
  if (s.length <= max) return s
  return `${s.slice(0, max)}\n…`
}

function sanitizeLine(line: AgentChatLine): AgentChatLine | null {
  switch (line.kind) {
    case 'user':
    case 'assistant':
    case 'note':
    case 'error':
      return { ...line, text: trimText(line.text) }
    case 'proposal':
      if (line.proposal.status === 'pending') {
        return {
          kind: 'note',
          text: trimText(`[${line.proposal.status}] ${line.proposal.command}`),
        }
      }
      return line
    case 'result': {
      const r = line.result
      return {
        kind: 'result',
        result: {
          ...r,
          stdout: trimText(r.stdout || '', MAX_EXEC_OUT),
          stderr: trimText(r.stderr || '', MAX_EXEC_OUT),
        },
      }
    }
    default:
      return null
  }
}

function trimTranscript(
  transcript: AnthropicTranscriptMessage[] | null,
): AnthropicTranscriptMessage[] | null {
  if (!transcript?.length) return null
  return transcript.slice(-MAX_TRANSCRIPT_MSGS)
}

function trimHistory(history: ChatMessage[]): ChatMessage[] {
  return history.slice(-MAX_HISTORY).map((m) => ({
    role: m.role,
    content: trimText(m.content, 6000),
  }))
}

function trimLines(lines: AgentChatLine[]): AgentChatLine[] {
  const out: AgentChatLine[] = []
  for (const line of lines) {
    const s = sanitizeLine(line)
    if (s) out.push(s)
  }
  return out.slice(-MAX_LINES)
}

export function loadAgentChatHistory(hostKey: string): AgentChatSnapshot | null {
  try {
    const raw = localStorage.getItem(storageKey(hostKey))
    if (!raw) return null
    const parsed = JSON.parse(raw) as AgentChatSnapshot
    if (parsed?.version !== 1) return null
    if (!Array.isArray(parsed.lines) || !Array.isArray(parsed.history)) return null
    return {
      version: 1,
      updatedAt: parsed.updatedAt || '',
      lines: trimLines(parsed.lines),
      history: trimHistory(parsed.history),
      loopState: {
        anthropicTranscript: trimTranscript(parsed.loopState?.anthropicTranscript ?? null),
        useNativeTools: !!parsed.loopState?.useNativeTools,
        pendingToolUseId: null,
      },
    }
  } catch {
    return null
  }
}

type IndexEntry = { hostKey: string; updatedAt: string; preview: string }

function readIndex(): IndexEntry[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as IndexEntry[]
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function writeIndex(entries: IndexEntry[]) {
  const trimmed = entries
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 64)
  localStorage.setItem(INDEX_KEY, JSON.stringify(trimmed))
}

function previewFromLines(lines: AgentChatLine[]): string {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (line.kind === 'user') return trimText(line.text, 120)
    if (line.kind === 'assistant') return trimText(line.text, 120)
  }
  return ''
}

export function saveAgentChatHistory(
  hostKey: string,
  payload: {
    lines: AgentChatLine[]
    history: ChatMessage[]
    loopState: AgentLoopState
  },
): void {
  const lines = trimLines(payload.lines)
  const history = trimHistory(payload.history)
  const snap: AgentChatSnapshot = {
    version: 1,
    updatedAt: new Date().toISOString(),
    lines,
    history,
    loopState: {
      anthropicTranscript: trimTranscript(payload.loopState.anthropicTranscript),
      useNativeTools: payload.loopState.useNativeTools,
      pendingToolUseId: null,
    },
  }
  try {
    localStorage.setItem(storageKey(hostKey), JSON.stringify(snap))
    const preview = previewFromLines(lines)
    const idx = readIndex().filter((e) => e.hostKey !== hostKey)
    idx.unshift({ hostKey, updatedAt: snap.updatedAt, preview })
    writeIndex(idx)
  } catch {
    /* quota — drop oldest index entries and retry once */
    try {
      writeIndex(readIndex().slice(0, 16))
      localStorage.setItem(storageKey(hostKey), JSON.stringify(snap))
    } catch {
      /* ignore */
    }
  }
}

export function clearAgentChatHistory(hostKey: string): void {
  localStorage.removeItem(storageKey(hostKey))
  writeIndex(readIndex().filter((e) => e.hostKey !== hostKey))
}

/** Host keys with saved agent chats, newest first. */
export function listAgentChatHistoryIndex(): IndexEntry[] {
  return readIndex()
}

export type { IndexEntry as AgentChatHistoryIndexEntry }

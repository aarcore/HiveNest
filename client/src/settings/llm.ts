import { netFetch } from '../netFetch'
import { PROVIDER_META, type ApiStyle, type ProviderConfig } from './types'

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type SuggestCommandResult = {
  command: string
  reason: string
  assistantText: string
  done: boolean
  raw: string
  /** Set when the model used Anthropic native tool_use (for tool_result feedback). */
  toolUseId?: string
  /** When set, client prefers POST /v1/sessions/:id/tools before shell exec. */
  tool?: string
  path?: string
  pattern?: string
  content?: string
  user?: string
  limit?: number
  /** MCP tool call (optional; sessiond SSH tools remain primary). */
  mcp?: boolean
  mcpServer?: string
  mcpTool?: string
  mcpArguments?: Record<string, unknown>
}

function stripFence(text: string): string {
  const t = text.trim()
  const m = t.match(/^```(?:json|bash|sh)?\s*([\s\S]*?)```$/i)
  return (m ? m[1] : t).trim()
}


/** Reject paths that look like shell injection. */
export function safeRemotePath(path: string): string | null {
  const p = path.trim()
  if (!p || p.length > 512) return null
  if (/[\x00-\x1f`$;&|<>(){}!#\n\r\t]/.test(p)) return null
  if (p.includes('..')) return null
  return p
}

/** Alphanumeric-ish filter for ps / process name matching. */
export function safeProcessPattern(pattern: string): string | null {
  const s = pattern.trim()
  if (!s || s.length > 64) return null
  if (!/^[A-Za-z0-9._:@+/-]+$/.test(s)) return null
  return s
}

export function shellSingleQuote(s: string): string {
  return "'" + s.replace(/'/g, `'"'"'`) + "'"
}

export type ToolCallArgs = {
  path?: string
  pattern?: string
  content?: string
  user?: string
  limit?: number
}

/** UTF-8 → standard base64 (matches Go encoding/base64 for write_file display). */
export function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  bytes.forEach((b) => {
    bin += String.fromCharCode(b)
  })
  return btoa(bin)
}

const WRITE_TOOLS = new Set(['write_file', 'mkdir', 'remove_file', 'rmdir'])
const READ_TOOLS = new Set([
  'list_files',
  'read_file',
  'stat_path',
  'disk_free',
  'list_processes',
])

export function isWriteTool(tool?: string): boolean {
  return !!tool && WRITE_TOOLS.has(tool)
}

export function toolRisk(tool?: string): 'low' | 'medium' | 'high' {
  if (!tool) return 'low'
  if (tool === 'write_file' || tool === 'mkdir') return 'medium'
  if (tool === 'remove_file' || tool === 'rmdir') return 'high'
  return 'low'
}

/** Map structured Agent tools to a single remote shell command via exec. */
export function toolToCommand(tool: string, args: ToolCallArgs | string): string | null {
  const a: ToolCallArgs = typeof args === 'string' ? { path: args } : args || {}
  switch (tool) {
    case 'list_files': {
      const p = safeRemotePath(a.path || '')
      if (!p) return null
      return `ls -la -- ${shellSingleQuote(p)}`
    }
    case 'read_file': {
      const p = safeRemotePath(a.path || '')
      if (!p) return null
      return `head -c 65536 -- ${shellSingleQuote(p)}`
    }
    case 'stat_path': {
      const p = safeRemotePath(a.path || '')
      if (!p) return null
      const q = shellSingleQuote(p)
      // Portable: GNU/BSD stat differ; fall back to ls -ld.
      return `stat ${q} 2>/dev/null || ls -ld -- ${q}`
    }
    case 'disk_free': {
      if (a.path && a.path.trim()) {
        const p = safeRemotePath(a.path)
        if (!p) return null
        return `df -h -- ${shellSingleQuote(p)}`
      }
      return 'df -h'
    }
    case 'list_processes': {
      const parts = ['ps auxww']
      if (a.user && a.user.trim()) {
        const u = a.user.trim()
        if (!/^[A-Za-z0-9_.-]+$/.test(u)) return null
        parts.push(`# user=${u}`)
      }
      if (a.pattern && a.pattern.trim()) {
        const pat = safeProcessPattern(a.pattern)
        if (!pat) return null
        parts.push(`# pattern=${pat}`)
      }
      if (a.limit && a.limit > 0) {
        parts.push(`# limit=${a.limit}`)
      }
      return parts.join(' ')
    }
    case 'write_file': {
      const p = safeRemotePath(a.path || '')
      if (!p || a.content === undefined) return null
      if (a.content.length > 65536) return null
      const b64 = utf8ToBase64(a.content)
      return `printf '%s' ${shellSingleQuote(b64)} | base64 -d > ${shellSingleQuote(p)}`
    }
    case 'mkdir': {
      const p = safeRemotePath(a.path || '')
      if (!p) return null
      return `mkdir -p -- ${shellSingleQuote(p)}`
    }
    case 'remove_file': {
      const p = safeRemotePath(a.path || '')
      if (!p) return null
      return `rm -- ${shellSingleQuote(p)}`
    }
    case 'rmdir': {
      const p = safeRemotePath(a.path || '')
      if (!p) return null
      return `rmdir -- ${shellSingleQuote(p)}`
    }
    default:
      return null
  }
}

function isTruthyDone(v: unknown): boolean {
  if (v === true) return true
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    return s === 'true' || s === '1' || s === 'yes' || s === 'done' || s === 'finished'
  }
  return v === 1
}

export function parseSuggestion(text: string, fallbackReason: string): SuggestCommandResult {
  const cleaned = stripFence(text)
  type SuggestJson = {
    command?: string
    reason?: string
    reply?: string
    done?: boolean
    tool?: string
    path?: string
    pattern?: string
    content?: string
    user?: string
    limit?: number
    mcp?: boolean
    server?: string
    arguments?: Record<string, unknown>
  }
  const hasTool = (j: SuggestJson) =>
    !!j.tool &&
    (READ_TOOLS.has(j.tool) || WRITE_TOOLS.has(j.tool)) &&
    (j.tool === 'disk_free' ||
      j.tool === 'list_processes' ||
      !!j.path ||
      !!j.pattern ||
      j.content !== undefined)
  const fromObj = (j: SuggestJson, raw: string, extra = '') => {
    let command = (j.command || '').trim()
    const toolName = (j.tool || '').trim()
    const isMcp = j.mcp === true && !!(j.server && j.tool)
    if (isMcp) {
      const args = j.arguments && typeof j.arguments === 'object' ? j.arguments : {}
      const display = `mcp:${j.server}/${j.tool}${Object.keys(args).length ? ' ' + JSON.stringify(args) : ''}`
      const done = isTruthyDone(j.done)
      return {
        command: done ? 'true' : display,
        reason: (j.reason || fallbackReason).trim(),
        assistantText: (j.reply || j.reason || extra || fallbackReason).trim(),
        done,
        raw,
        mcp: true,
        mcpServer: String(j.server),
        mcpTool: String(j.tool),
        mcpArguments: args as Record<string, unknown>,
      }
    }
    if ((!command || command === 'true') && toolName && hasTool(j)) {
      const mapped = toolToCommand(toolName, {
        path: j.path,
        pattern: j.pattern,
        content: j.content,
        user: j.user,
        limit: j.limit,
      })
      if (mapped) command = mapped
    }
    const hasAction =
      !!(command && command !== 'true') || !!(toolName && hasTool(j)) || isMcp
    const done =
      isTruthyDone(j.done) ||
      command === 'true' ||
      (!hasAction && !!(j.reply || j.reason))
    if (done && command !== 'true' && !hasAction) command = 'true'
    return {
      command: done ? 'true' : command,
      reason: (j.reason || fallbackReason).trim(),
      assistantText: (j.reply || j.reason || extra || fallbackReason).trim(),
      done,
      raw,
      tool: !done && toolName && hasTool(j) ? toolName : undefined,
      path: j.path,
      pattern: j.pattern,
      content: j.content,
      user: j.user,
      limit: j.limit,
    }
  }
  try {
    const j = JSON.parse(cleaned) as SuggestJson
    if (j.command !== undefined || j.done === true || hasTool(j) || (j.mcp === true && j.server && j.tool)) {
      return fromObj(j, text)
    }
  } catch {
    /* fall through */
  }
  // Try to find embedded JSON object
  const embedded = cleaned.match(/\{[\s\S]*"(?:command|tool|mcp)"\s*:\s*(?:"[^"]*"|true)[\s\S]*\}/)
  if (embedded) {
    try {
      const j = JSON.parse(embedded[0]) as SuggestJson
      if (j.command !== undefined || j.done === true || hasTool(j) || (j.mcp === true && j.server && j.tool)) {
        return fromObj(j, text, cleaned.replace(embedded[0], '').trim())
      }
    } catch {
      /* fall through */
    }
  }
  const line = cleaned
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#') && !l.startsWith('{'))
  const command = (line || 'true').trim()
  return {
    command,
    reason: fallbackReason,
    assistantText: cleaned,
    done: command === 'true',
    raw: text,
  }
}

const SYSTEM = `You are a careful Linux/Unix sysadmin assistant inside Hive Nest.
You help manage ONE remote host in the current SSH session. You may take multiple steps.
Prefer structured tools when listing/reading files, checking disk, or listing processes; otherwise use a single shell command.

When a shell command is needed, reply with a short helpful message AND a JSON object (last block):
{"command":"<safe single shell command>","reason":"<short why>","reply":"<1-3 sentence answer>","done":false}

Structured tools (preferred; sessiond runs via SFTP/controlled exec). Reads are low-risk; write_file/mkdir need Approve (medium); remove_file/rmdir need Approve (high):
{"tool":"list_files","path":"/var/log","reason":"<short why>","reply":"<1-3 sentence answer>","done":false}
{"tool":"read_file","path":"/etc/os-release","reason":"<short why>","reply":"<1-3 sentence answer>","done":false}
{"tool":"stat_path","path":"/etc/passwd","reason":"<short why>","reply":"<1-3 sentence answer>","done":false}
{"tool":"disk_free","path":"/","reason":"<short why>","reply":"<1-3 sentence answer>","done":false}
{"tool":"list_processes","pattern":"nginx","user":"www","limit":20,"reason":"<short why>","reply":"<1-3 sentence answer>","done":false}
{"tool":"write_file","path":"/tmp/note.txt","content":"hello","reason":"<short why>","reply":"<1-3 sentence answer>","done":false}
{"tool":"mkdir","path":"/tmp/hivenest-dir","reason":"<short why>","reply":"<1-3 sentence answer>","done":false}
{"tool":"remove_file","path":"/tmp/note.txt","reason":"<short why>","reply":"<1-3 sentence answer>","done":false}
{"tool":"rmdir","path":"/tmp/hivenest-dir","reason":"<short why>","reply":"<1-3 sentence answer>","done":false}

When the goal is finished (or no more commands are needed), return ONLY this shape (no further tools):
{"command":"true","reason":"done","reply":"<summary for the user>","done":true}

After you receive a Command result message (exit code, stdout, stderr), decide the NEXT single command/tool OR finish with done:true. Do not keep exploring after the user goal is satisfied.

Rules:
- One command or one tool only per turn, no interactive prompts, no sudo unless asked.
- Prefer read-only checks when investigating.
- write_file content max 65536 bytes; never use remove tools unless the user clearly asks.
- Paths for tools must be absolute or home-relative without shell metacharacters.
- Never invent destructive commands unless the user clearly asks.
- Do not hide the command — the UI always shows it; medium/high risk need user approval.
- Keep steps small. Stop when done:true.`

function parseExtraHeaders(raw: string): Record<string, string> {
  const t = raw.trim()
  if (!t) return {}
  try {
    const obj = JSON.parse(t) as unknown
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      throw new Error('Extra headers must be a JSON object')
    }
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        out[k] = String(v)
      }
    }
    return out
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Invalid extra headers JSON'
    throw new Error(msg)
  }
}

export function getProviderApiStyle(provider: ProviderConfig): ApiStyle {
  const meta = PROVIDER_META[provider.id]
  if (provider.id === 'custom') {
    const override = provider.orgOrRegion.trim().toLowerCase()
    if (override === 'anthropic') return 'anthropic'
    if (override === 'azure') return 'azure'
    if (override === 'openai') return 'openai'
  }
  return meta.apiStyle
}

async function openaiChat(
  provider: ProviderConfig,
  messages: ChatMessage[],
  opts?: { signal?: AbortSignal },
): Promise<string> {
  const base = provider.apiBaseUrl.replace(/\/$/, '')
  const url = `${base}/chat/completions`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...parseExtraHeaders(provider.extraHeaders || ''),
  }
  if (provider.apiKey.trim()) {
    headers.Authorization = `Bearer ${provider.apiKey}`
  }
  if (provider.id === 'openai' && provider.orgOrRegion.trim()) {
    headers['OpenAI-Organization'] = provider.orgOrRegion.trim()
  }
  const res = await netFetch(url, {
    method: 'POST',
    headers,
    signal: opts?.signal,
    body: JSON.stringify({
      model: provider.defaultModel,
      temperature: 0.2,
      messages,
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = body?.error?.message || body?.message || `${res.status} ${res.statusText}`
    throw new Error(msg)
  }
  const content = body?.choices?.[0]?.message?.content
  if (!content || typeof content !== 'string') {
    throw new Error('Empty model response')
  }
  return content
}

async function azureChat(
  provider: ProviderConfig,
  messages: ChatMessage[],
  opts?: { signal?: AbortSignal },
): Promise<string> {
  const base = provider.apiBaseUrl.replace(/\/$/, '')
  const apiVersion = provider.orgOrRegion.trim() || '2024-08-01-preview'
  const sep = base.includes('?') ? '&' : '?'
  const url = `${base}/chat/completions${sep}api-version=${encodeURIComponent(apiVersion)}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'api-key': provider.apiKey,
    ...parseExtraHeaders(provider.extraHeaders || ''),
  }
  const res = await netFetch(url, {
    method: 'POST',
    headers,
    signal: opts?.signal,
    body: JSON.stringify({
      model: provider.defaultModel,
      temperature: 0.2,
      messages,
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = body?.error?.message || body?.message || `${res.status} ${res.statusText}`
    throw new Error(msg)
  }
  const content = body?.choices?.[0]?.message?.content
  if (!content || typeof content !== 'string') {
    throw new Error('Empty model response')
  }
  return content
}

async function anthropicChat(
  provider: ProviderConfig,
  messages: ChatMessage[],
  opts?: { signal?: AbortSignal },
): Promise<string> {
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
  const system = messages.find((m) => m.role === 'system')?.content || SYSTEM
  const rest = messages.filter((m) => m.role !== 'system').map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
  }))
  const res = await netFetch(url, {
    method: 'POST',
    headers,
    signal: opts?.signal,
    body: JSON.stringify({
      model: provider.defaultModel,
      max_tokens: 1024,
      system,
      messages: rest,
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = body?.error?.message || body?.message || `${res.status} ${res.statusText}`
    throw new Error(msg)
  }
  const parts = body?.content
  const text = Array.isArray(parts)
    ? parts
        .filter((p: { type?: string; text?: string }) => p?.type === 'text' && p.text)
        .map((p: { text: string }) => p.text)
        .join('\n')
    : ''
  if (!text) throw new Error('Empty model response')
  return text
}

const PROVIDER_TEST_TIMEOUT_MS = 15_000

function redactProviderSecrets(message: string, provider: ProviderConfig): string {
  let out = message
  const key = provider.apiKey.trim()
  if (key.length >= 8) {
    out = out.split(key).join('***')
  }
  return out
    .replace(/Bearer\s+\S+/gi, 'Bearer ***')
    .replace(/api-key["\s:=]+\S+/gi, 'api-key ***')
    .replace(/x-api-key["\s:=]+\S+/gi, 'x-api-key ***')
}

/** Lightweight chat probe using current form fields (base URL, key, model). */
export async function testProviderConnection(
  provider: ProviderConfig,
): Promise<{ ok: true; latencyMs: number } | { ok: false; error: string }> {
  const meta = PROVIDER_META[provider.id]
  if (meta.requiresApiKey && !provider.apiKey.trim()) {
    return { ok: false, error: 'API key not configured' }
  }
  if (!provider.apiBaseUrl.trim()) {
    return { ok: false, error: 'API base URL not configured' }
  }
  if (!provider.defaultModel.trim()) {
    return { ok: false, error: 'Default model not configured' }
  }

  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), PROVIDER_TEST_TIMEOUT_MS)
  const started = Date.now()
  try {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'Connection test. Reply with exactly: ok' },
      { role: 'user', content: 'ping' },
    ]
    const style = getProviderApiStyle(provider)
    const opts = { signal: controller.signal }
    if (style === 'anthropic') {
      await anthropicChat(provider, messages, opts)
    } else if (style === 'azure') {
      await azureChat(provider, messages, opts)
    } else {
      await openaiChat(provider, messages, opts)
    }
    return { ok: true, latencyMs: Date.now() - started }
  } catch (e) {
    let raw =
      e instanceof DOMException && e.name === 'AbortError'
        ? `Timed out after ${PROVIDER_TEST_TIMEOUT_MS / 1000}s`
        : e instanceof Error
          ? e.name === 'AbortError'
            ? `Timed out after ${PROVIDER_TEST_TIMEOUT_MS / 1000}s`
            : e.message
          : String(e)
    if (raw === 'Load failed' || raw === 'Failed to fetch') {
      raw =
        'Network request failed (check API base URL, firewall/VPN, and that the desktop app was rebuilt after updates)'
    }
    return { ok: false, error: redactProviderSecrets(raw, provider) }
  } finally {
    window.clearTimeout(timer)
  }
}

/** Multi-turn chat with the configured provider. Session-scoped history is owned by the caller. */
export async function chatSuggestCommand(
  provider: ProviderConfig,
  history: ChatMessage[],
  userText: string,
  sessionContext?: string,
  extraSystem?: string,
): Promise<{ result: SuggestCommandResult; nextHistory: ChatMessage[] }> {
  const meta = PROVIDER_META[provider.id]
  if (meta.requiresApiKey && !provider.apiKey.trim()) {
    throw new Error('API key not configured')
  }
  if (!provider.apiBaseUrl.trim()) {
    throw new Error('API base URL not configured')
  }
  if (!provider.defaultModel.trim()) {
    throw new Error('Default model not configured')
  }
  const extras = [sessionContext ? `Current session: ${sessionContext}` : '', extraSystem || '']
    .filter(Boolean)
    .join('\n\n')
  const systemContent = extras ? `${SYSTEM}\n\n${extras}` : SYSTEM
  const baseHistory =
    history.length && history[0].role === 'system'
      ? history
      : [{ role: 'system' as const, content: systemContent }, ...history]
  // refresh system message
  const messages: ChatMessage[] = [
    { role: 'system', content: systemContent },
    ...baseHistory.filter((m) => m.role !== 'system'),
    { role: 'user', content: userText },
  ]
  const style = getProviderApiStyle(provider)
  let raw: string
  if (style === 'anthropic') {
    raw = await anthropicChat(provider, messages)
  } else if (style === 'azure') {
    raw = await azureChat(provider, messages)
  } else {
    raw = await openaiChat(provider, messages)
  }
  const result = parseSuggestion(raw, `Suggested by ${meta.label}`)
  const nextHistory: ChatMessage[] = [
    ...messages.filter((m) => m.role !== 'system'),
    { role: 'assistant', content: raw },
  ]
  // keep last N turns (excluding system)
  const trimmed = nextHistory.slice(-16)
  return { result, nextHistory: trimmed }
}

/** @deprecated prefer chatSuggestCommand for multi-turn */
export async function suggestCommand(
  provider: ProviderConfig,
  userText: string,
): Promise<SuggestCommandResult> {
  const { result } = await chatSuggestCommand(provider, [], userText)
  return result
}


/** Feed an exec result back to the model and get the next proposal (or done). */
export async function continueFromResult(
  provider: ProviderConfig,
  history: ChatMessage[],
  result: {
    command: string
    exit_code: number
    stdout: string
    stderr: string
    risk?: string
  },
  sessionContext?: string,
  extraSystem?: string,
): Promise<{ result: SuggestCommandResult; nextHistory: ChatMessage[] }> {
  const body = [
    `Command result for: ${result.command}`,
    `exit_code=${result.exit_code}`,
    result.risk ? `risk=${result.risk}` : '',
    '--- stdout ---',
    (result.stdout || '(empty)').slice(0, 6000),
    '--- stderr ---',
    (result.stderr || '(empty)').slice(0, 2000),
    'Based on this output, continue with the next single command or finish with done:true.',
  ]
    .filter(Boolean)
    .join('\n')
  return chatSuggestCommand(provider, history, body, sessionContext, extraSystem)
}

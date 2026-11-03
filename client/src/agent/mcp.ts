/**
 * MCP client for Hive Nest Agent.
 * - HTTP/SSE: works in browser/Vite
 * - command/stdio: Tauri desktop bridge (invoke mcp_start / mcp_call_tool / …)
 */

export type McpServerConfig = {
  id: string
  name: string
  enabled: boolean
  /** "http" | "sse" | "command" */
  transport: 'http' | 'sse' | 'command'
  /** For http/sse */
  url?: string
  /** For command transport (Tauri bridge) */
  command?: string
  args?: string[]
  env?: Record<string, string>
}

export type McpTool = {
  serverId: string
  name: string
  description?: string
  /** Heuristic: mutating tools need Approve */
  mutating: boolean
  inputSchema?: unknown
}

export type McpConnectionState = {
  serverId: string
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  error?: string
  tools: McpTool[]
}

export type PendingMcpCall = {
  serverId: string
  tool: string
  arguments: Record<string, unknown>
  mutating: boolean
  displayCommand: string
}

const STORAGE_KEY = 'hivenest_mcp_servers_v1'

export function defaultMcpServers(): McpServerConfig[] {
  return []
}

export function loadMcpServers(): McpServerConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultMcpServers()
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return defaultMcpServers()
    return arr
  } catch {
    return defaultMcpServers()
  }
}

export function saveMcpServers(servers: McpServerConfig[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(servers))
}

export function looksMutating(name: string, description?: string): boolean {
  const s = `${name} ${description || ''}`.toLowerCase()
  return /write|create|delete|remove|update|put|post|patch|exec|run|kill|drop|mkdir|rm\b|set_|apply|mutate|send|install/.test(
    s,
  )
}

/** Risk for MCP tools: mutating → high; unknown → medium; annotated read → low. */
export function mcpToolRisk(tool: McpTool | { name: string; description?: string; mutating?: boolean }): 'low' | 'medium' | 'high' {
  const mutating =
    typeof (tool as McpTool).mutating === 'boolean'
      ? (tool as McpTool).mutating
      : looksMutating(tool.name, tool.description)
  if (mutating) return 'high'
  const s = `${tool.name} ${tool.description || ''}`.toLowerCase()
  if (/read|list|get|fetch|search|query|stat|info|describe|show/.test(s)) return 'low'
  return 'medium'
}

export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as unknown as { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown }
  return !!(w.__TAURI_INTERNALS__ || w.__TAURI__)
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

function mapTools(serverId: string, list: { name?: string; description?: string; inputSchema?: unknown; input_schema?: unknown }[]): McpTool[] {
  return (list || []).map((t) => {
    const name = String(t.name || 'unknown')
    return {
      serverId,
      name,
      description: t.description,
      mutating: looksMutating(name, t.description),
      inputSchema: t.inputSchema ?? t.input_schema,
    }
  })
}

/** JSON-RPC over HTTP POST (MCP streamable HTTP subset). */
export async function connectHttpMcp(server: McpServerConfig): Promise<McpConnectionState> {
  if (!server.url) {
    return { serverId: server.id, status: 'error', error: 'Missing URL', tools: [] }
  }
  try {
    const res = await fetch(server.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      }),
    })
    if (!res.ok) {
      return { serverId: server.id, status: 'error', error: `HTTP ${res.status}`, tools: [] }
    }
    const data = await res.json().catch(() => null)
    const list = data?.result?.tools || data?.tools || []
    return {
      serverId: server.id,
      status: 'connected',
      tools: Array.isArray(list) ? mapTools(server.id, list) : [],
    }
  } catch (ex: any) {
    return {
      serverId: server.id,
      status: 'error',
      error: ex?.message || String(ex),
      tools: [],
    }
  }
}

export async function callHttpMcpTool(
  server: McpServerConfig,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; content: string }> {
  if (!server.url) return { ok: false, content: 'Missing URL' }
  try {
    const res = await fetch(server.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: { name: toolName, arguments: args },
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.error) {
      return { ok: false, content: data?.error?.message || `HTTP ${res.status}` }
    }
    const content = data?.result?.content
    if (Array.isArray(content)) {
      return {
        ok: true,
        content: content
          .map((c: { type?: string; text?: string }) => c.text || JSON.stringify(c))
          .join('\n'),
      }
    }
    return { ok: true, content: JSON.stringify(data?.result ?? data) }
  } catch (ex: any) {
    return { ok: false, content: ex?.message || String(ex) }
  }
}


/** Reject shell metacharacters — command is passed to Command::new (no shell). Flags go in args. */
export function validateMcpCommand(command: string): string | null {
  const c = command.trim()
  if (!c) return 'Missing command'
  if (/[\n\r;|&`$]/.test(c)) {
    return 'Command must be an executable path without shell metacharacters; put flags in Args'
  }
  return null
}

export async function startCommandMcp(server: McpServerConfig): Promise<McpConnectionState> {
  if (!isTauriRuntime()) {
    return {
      serverId: server.id,
      status: 'error',
      error:
        'Stdio/command MCP requires the Hive Nest desktop app (Tauri). Config is saved; use HTTP/SSE in browser, or run via npm run tauri:dev.',
      tools: [],
    }
  }
  const cmdErr = validateMcpCommand(server.command || '')
  if (cmdErr) {
    return { serverId: server.id, status: 'error', error: cmdErr, tools: [] }
  }
  try {
    const res = await tauriInvoke<{
      serverId: string
      status: string
      tools: { name: string; description?: string; inputSchema?: unknown }[]
      error?: string | null
    }>('mcp_start', {
      args: {
        id: server.id,
        name: server.name,
        command: server.command,
        args: server.args || [],
        env: server.env || {},
      },
    })
    if (res.status !== 'connected' || res.error) {
      return {
        serverId: server.id,
        status: 'error',
        error: res.error || res.status,
        tools: [],
      }
    }
    return {
      serverId: server.id,
      status: 'connected',
      tools: mapTools(server.id, res.tools || []),
    }
  } catch (ex: any) {
    return {
      serverId: server.id,
      status: 'error',
      error: ex?.message || String(ex),
      tools: [],
    }
  }
}

export async function stopCommandMcp(serverId: string): Promise<void> {
  if (!isTauriRuntime()) return
  try {
    await tauriInvoke('mcp_stop', { serverId })
  } catch {
    /* ignore */
  }
}

export async function callCommandMcpTool(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; content: string }> {
  if (!isTauriRuntime()) {
    return { ok: false, content: 'Stdio MCP only available in desktop app' }
  }
  try {
    const res = await tauriInvoke<{ ok: boolean; content: string; error?: string | null }>(
      'mcp_call_tool',
      {
        args: {
          serverId,
          tool: toolName,
          arguments: args,
        },
      },
    )
    if (!res.ok) return { ok: false, content: res.error || res.content || 'MCP call failed' }
    return { ok: true, content: res.content || '' }
  } catch (ex: any) {
    return { ok: false, content: ex?.message || String(ex) }
  }
}

/** Start or probe a server (command → Tauri; http/sse → fetch). */
export async function probeMcpServer(server: McpServerConfig): Promise<McpConnectionState> {
  if (!server.enabled) {
    return { serverId: server.id, status: 'disconnected', tools: [] }
  }
  if (server.transport === 'command') {
    return startCommandMcp(server)
  }
  return connectHttpMcp(server)
}

export async function stopMcpServer(server: McpServerConfig): Promise<void> {
  if (server.transport === 'command') await stopCommandMcp(server.id)
}

/** Unified tools/call — HTTP or Tauri stdio. */
export async function callMcpTool(
  server: McpServerConfig,
  toolName: string,
  args: Record<string, unknown> = {},
): Promise<{ ok: boolean; content: string }> {
  if (server.transport === 'command') {
    return callCommandMcpTool(server.id, toolName, args)
  }
  return callHttpMcpTool(server, toolName, args)
}

export function findMcpTool(
  states: McpConnectionState[],
  serverId: string,
  toolName: string,
): McpTool | undefined {
  const st = states.find((s) => s.serverId === serverId)
  return st?.tools.find((t) => t.name === toolName)
}

export function buildMcpToolsPrompt(states: McpConnectionState[]): string {
  const tools = states.flatMap((s) => s.tools)
  if (!tools.length) return ''
  const lines = tools.map(
    (t) =>
      `- mcp:${t.serverId}/${t.name}${t.mutating ? ' [mutating→Approve]' : ''}: ${t.description || ''}`,
  )
  return (
    'Optional MCP tools (sessiond SSH tools remain primary). To call MCP reply JSON:\n' +
    '{"mcp":true,"server":"<serverId>","tool":"<name>","arguments":{},"reason":"...","reply":"...","done":false}\n' +
    'Available:\n' +
    lines.join('\n')
  )
}

export function formatMcpDisplay(serverId: string, tool: string, args?: Record<string, unknown>): string {
  const a = args && Object.keys(args).length ? ` ${JSON.stringify(args)}` : ''
  return `mcp:${serverId}/${tool}${a}`
}

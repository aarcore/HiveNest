export type AuthMethod = 'key' | 'password' | 'agent' | ''

/** Per-hop bastion auth for ProxyJump *string* chains (index-aligned). Prefer jump_host_ids profiles. */
export type JumpHopSpec = {
  identity_file?: string
  use_agent?: boolean
  auth_method?: AuthMethod
}

export type Host = {
  id: string
  name: string
  host: string
  port: number
  user: string
  identity_file?: string
  use_agent: boolean
  auth_method?: AuthMethod
  jump_host_id?: string
  /** Ordered multi-hop bastion chain (preferred over jump_host_id). */
  jump_host_ids?: string[]
  proxy_jump?: string
  /** Bastion key for ProxyJump string only (separate from target identity_file). */
  jump_identity_file?: string
  jump_use_agent?: boolean
  jump_auth_method?: AuthMethod
  /** Per-hop auth for ProxyJump string (prefer jump_host_ids for full identity). */
  jump_hops?: JumpHopSpec[]
  tags?: string[]
  created_at: string
  updated_at: string
}

export type HostInput = {
  name: string
  host: string
  port: number
  user: string
  identity_file?: string
  use_agent?: boolean
  auth_method?: AuthMethod
  jump_host_id?: string
  jump_host_ids?: string[]
  proxy_jump?: string
  jump_identity_file?: string
  jump_use_agent?: boolean
  jump_auth_method?: AuthMethod
  jump_hops?: JumpHopSpec[]
  tags?: string[]
}

export type HostKeyInfo = {
  code: 'host_key_unknown' | 'host_key_mismatch' | string
  host: string
  port: number
  key_type: string
  fingerprint_sha256: string
  public_key: string
  previous_fingerprint?: string
}

export type SessionInfo = {
  id: string
  host_id: string
  host_name?: string
  user: string
  remote: string
  created_at: string
  has_pty: boolean
  is_local?: boolean
}

export type Proposal = {
  id: string
  session_id: string
  host_id: string
  command: string
  reason?: string
  risk: string
  status: string
  approve_token?: string
  created_at: string
  approved_at?: string
  expires_at: string
}

export type ExecResult = {
  command: string
  stdout: string
  stderr: string
  exit_code: number
  risk: string
  duration_ms: number
}

export type ApiError = Error & { status?: number; body?: any }

const TOKEN_KEY = 'hivenest_sessiond_token'
const SESSIOND_LOOPBACK = 'http://127.0.0.1:7788'

function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as unknown as { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown }
  return !!(w.__TAURI_INTERNALS__ || w.__TAURI__)
}

/** Dev uses Vite proxy (relative URLs); packaged Tauri talks to sessiond on loopback. */
export function sessiondBaseUrl(): string {
  if (import.meta.env.DEV) return ''
  if (isTauriRuntime()) return SESSIOND_LOOPBACK
  return ''
}

function resolveSessiondUrl(path: string): string {
  const base = sessiondBaseUrl()
  if (!base) return path
  const p = path.startsWith('/') ? path : `/${path}`
  return `${base.replace(/\/$/, '')}${p}`
}

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || 'dev-smoke-token'
}

export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, (t ?? '').trim())
}

function headers(json = false): HeadersInit {
  const h: Record<string, string> = {
    'X-HiveNest-Token': getToken(),
  }
  if (json) h['Content-Type'] = 'application/json'
  return h
}

async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const r = await fetch(resolveSessiondUrl(path), {
    ...opts,
    headers: { ...headers(!!opts.body), ...(opts.headers || {}) },
  })
  const text = await r.text()
  let body: any
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!r.ok) {
    const err = new Error((body && body.error) || r.statusText) as ApiError
    err.status = r.status
    err.body = body
    throw err
  }
  return body as T
}

export const health = () => fetch(resolveSessiondUrl('/health')).then((r) => r.json())

export const listHosts = () => api<{ hosts: Host[] }>('/v1/hosts')
export const createHost = (input: HostInput) =>
  api<Host>('/v1/hosts', { method: 'POST', body: JSON.stringify(input) })
export const updateHost = (id: string, input: HostInput) =>
  api<Host>(`/v1/hosts/${id}`, { method: 'PUT', body: JSON.stringify(input) })
export const deleteHost = (id: string) =>
  api<void>(`/v1/hosts/${id}`, { method: 'DELETE' })

export type OpenSessionOpts = {
  password?: string
  jump_password?: string
  /** Per-hop passwords keyed by bastion host id or "proxy:N". */
  jump_passwords?: Record<string, string>
  accept_host_key?: boolean
  replace_host_key?: boolean
}

/** Passwords are connect-time only and are never persisted by sessiond. Do not log them. */
/** Sentinel host_id for a machine-local shell (sessiond local PTY). */
export const LOCAL_HOST_ID = '__local__'

export const openLocalSession = () =>
  api<SessionInfo>('/v1/sessions', { method: 'POST', body: JSON.stringify({ host_id: LOCAL_HOST_ID }) })

export const listSessions = () => api<{ sessions: SessionInfo[] }>('/v1/sessions')

export const getSession = (id: string) => api<SessionInfo>(`/v1/sessions/${id}`)

export const openSession = (host_id: string, opts: OpenSessionOpts = {}) => {
  const body: Record<string, unknown> = { host_id }
  if (opts.password) body.password = opts.password
  if (opts.jump_password) body.jump_password = opts.jump_password
  if (opts.jump_passwords && Object.keys(opts.jump_passwords).length) {
    body.jump_passwords = opts.jump_passwords
  }
  if (opts.accept_host_key) body.accept_host_key = true
  if (opts.replace_host_key) body.replace_host_key = true
  return api<SessionInfo>('/v1/sessions', { method: 'POST', body: JSON.stringify(body) })
}

export type KnownHostEntry = {
  host: string
  port: number
  key_type: string
  public_key: string
  fingerprint_sha256: string
  accepted_at: string
}

export const acceptKnownHost = (host: string, port: number, public_key: string) =>
  api<KnownHostEntry>('/v1/known-hosts/accept', {
    method: 'POST',
    body: JSON.stringify({ host, port, public_key }),
  })

export const listKnownHosts = () => api<{ entries: KnownHostEntry[] }>('/v1/known-hosts')

export const deleteKnownHost = (host: string, port: number) => {
  const q = new URLSearchParams({ host, port: String(port) })
  return api<void>(`/v1/known-hosts?${q}`, { method: 'DELETE' })
}

export function isHostKeyError(err: ApiError): err is ApiError & { body: { code: string; host_key: HostKeyInfo } } {
  const code = err.body?.code
  return err.status === 409 && (code === 'host_key_unknown' || code === 'host_key_mismatch')
}

export function isPasswordRequiredError(err: ApiError): boolean {
  const code = err.body?.code
  return (
    err.status === 400 &&
    (code === 'password_required' ||
      code === 'jump_password_required' ||
      /password required/i.test(err.message || ''))
  )
}

export function isJumpPasswordRequired(err: ApiError): boolean {
  return err.status === 400 && err.body?.code === 'jump_password_required'
}
export const closeSession = (id: string) =>
  api<void>(`/v1/sessions/${id}`, { method: 'DELETE' })

export const createProposal = (
  sessionId: string,
  command: string,
  reason: string,
  risk?: 'low' | 'medium' | 'high',
) =>
  api<Proposal>(`/v1/sessions/${sessionId}/proposals`, {
    method: 'POST',
    body: JSON.stringify({ command, reason, ...(risk ? { risk } : {}) }),
  })

export const listProposals = (sessionId: string) =>
  api<{ proposals: Proposal[] }>(`/v1/sessions/${sessionId}/proposals`)

export const approveProposal = (id: string) =>
  api<Proposal>(`/v1/proposals/${id}/approve`, { method: 'POST', body: '{}' })

export const denyProposal = (id: string) =>
  api<Proposal>(`/v1/proposals/${id}/deny`, { method: 'POST', body: '{}' })


export type ToolResult = {
  tool: string
  risk: string
  ok: boolean
  summary: string
  data?: Record<string, unknown>
  duration_ms: number
  via: string
  error?: string
}

/** Structured Agent tools (SFTP / controlled exec). Medium/high need proposal_id + approve_token. */
export type SessionToolBody = {
  tool: string
  path?: string
  pattern?: string
  content?: string
  user?: string
  limit?: number
  actor?: string
  proposal_id?: string
  approve_token?: string
}

export const runSessionTool = (sessionId: string, body: SessionToolBody) =>
  api<ToolResult>(`/v1/sessions/${sessionId}/tools`, {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const execCommand = (
  sessionId: string,
  body: { command: string; proposal_id?: string; approve_token?: string; actor?: string },
) =>
  api<ExecResult>(`/v1/sessions/${sessionId}/exec`, {
    method: 'POST',
    body: JSON.stringify(body),
  })

export function ptyWsUrl(sessionId: string, cols: number, rows: number): string {
  const q = new URLSearchParams({
    token: getToken(),
    cols: String(cols),
    rows: String(rows),
  })
  const base = sessiondBaseUrl()
  if (base) {
    const u = new URL(`/v1/sessions/${sessionId}/ws`, base)
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
    u.search = q.toString()
    return u.toString()
  }
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}/v1/sessions/${sessionId}/ws?${q}`
}

export function hostNeedsPassword(h: Host): boolean {
  if (h.auth_method === 'password') return true
  // Legacy profiles with no auth_method and no usable key hint → ask at connect.
  if (!h.auth_method && !h.identity_file && !h.use_agent) return true
  return false
}

/** Ordered jump host profile ids (jump_host_ids, or legacy jump_host_id). */
export function jumpChainIds(h: Host): string[] {
  if (h.jump_host_ids && h.jump_host_ids.length) {
    return h.jump_host_ids.filter(Boolean)
  }
  if (h.jump_host_id) return [h.jump_host_id]
  return []
}

export function resolveJumpChain(target: Host, hosts: Host[]): Host[] {
  const out: Host[] = []
  for (const id of jumpChainIds(target)) {
    const j = hosts.find((x) => x.id === id)
    if (j) out.push(j)
  }
  return out
}

/** First jump hop that needs a password (compat helper). */
export function jumpHostNeedsPassword(target: Host, hosts: Host[]): Host | null {
  const need = jumpHostsNeedingPassword(target, hosts)
  return need[0] || null
}

/** All jump profile hops that need connect-time passwords. */
export function jumpHostsNeedingPassword(target: Host, hosts: Host[]): Host[] {
  return resolveJumpChain(target, hosts).filter((j) => hostNeedsPassword(j))
}

/** True when host uses inline ProxyJump string (not jump host profile ids). */
export function hostHasProxyJump(h: Host): boolean {
  return !!h.proxy_jump?.trim() && jumpChainIds(h).length === 0
}

/** ProxyJump bastion configured for password auth (separate from target). */
export function proxyJumpNeedsPassword(h: Host): boolean {
  return hostHasProxyJump(h) && h.jump_auth_method === 'password'
}

/** In-memory cache key for bastion password (profile jump or ProxyJump string). */
export function jumpPasswordCacheKey(target: Host, jumpHost: Host | null, hopIndex = 0): string {
  if (jumpHost) return `jump:${jumpHost.id}`
  if (hostHasProxyJump(target)) return `jump:proxy:${target.id}:${hopIndex}`
  return `jump:${target.id}`
}

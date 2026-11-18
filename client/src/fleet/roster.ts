/**
 * Fleet roster persistence (localStorage) and credential handling.
 *
 * The roster holds connection *settings* only. Passwords live in the existing
 * password vault, keyed per fleet server, and are cleared when the server is
 * removed.
 */

import { forgetPassword, loadPassword, savePassword } from '../passwordCache'
import type { FleetCredential, FleetCredentialMap, FleetServer, FleetServerInput } from './types'

const ROSTER_KEY = 'hivenest.fleet.servers.v1'
const CREDENTIALS_KEY = 'hivenest.fleet.session.v1'

function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function nowIso(): string {
  return new Date().toISOString()
}

function normalizeHostPart(h: FleetServerInput): FleetServerInput {
  return {
    ...h,
    name: (h.name || '').trim(),
    host: (h.host || '').trim(),
    user: (h.user || '').trim(),
    port: Number.isFinite(h.port) && h.port > 0 ? h.port : 22,
    auth_method: h.auth_method || '',
    identity_file: h.identity_file?.trim() || undefined,
    group: h.group?.trim() || undefined,
    role: h.role?.trim() || undefined,
    tags: h.tags?.filter(Boolean),
  }
}

export function loadFleet(): FleetServer[] {
  try {
    const raw = localStorage.getItem(ROSTER_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return []
    return arr.filter((s): s is FleetServer => {
      if (!s || typeof s !== 'object') return false
      const o = s as Partial<FleetServer>
      return typeof o.id === 'string' && typeof o.host === 'string' && typeof o.user === 'string'
    })
  } catch {
    return []
  }
}

function persist(list: FleetServer[]) {
  localStorage.setItem(ROSTER_KEY, JSON.stringify(list))
}

export function saveFleet(list: FleetServer[]) {
  persist(list)
}

export function addFleetServer(input: FleetServerInput): FleetServer {
  const list = loadFleet()
  const ts = nowIso()
  const server: FleetServer = {
    ...normalizeHostPart(input),
    id: newId(),
    created_at: ts,
    updated_at: ts,
  }
  persist([...list, server])
  return server
}

export function updateFleetServer(id: string, input: FleetServerInput): FleetServer | null {
  const list = loadFleet()
  const i = list.findIndex((s) => s.id === id)
  if (i < 0) return null
  const next: FleetServer = {
    ...list[i],
    ...normalizeHostPart(input),
    id,
    updated_at: nowIso(),
  }
  list[i] = next
  persist(list)
  return next
}

export async function removeFleetServer(id: string): Promise<void> {
  persist(loadFleet().filter((s) => s.id !== id))
  await forgetPassword(fleetPasswordKey(id))
}

export function fleetPasswordKey(id: string): string {
  return `fleet:${id}`
}

/** Find roster entries whose name, host, or group matches a loose reference. */
export function resolveFleetRef(ref: string, list = loadFleet()): FleetServer[] {
  const q = ref.trim().toLowerCase()
  if (!q) return []
  const exact = list.filter(
    (s) =>
      s.id === ref ||
      s.name.toLowerCase() === q ||
      s.host.toLowerCase() === q ||
      (s.group || '').toLowerCase() === q,
  )
  if (exact.length) return exact
  return list.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.host.toLowerCase().includes(q) ||
      (s.group || '').toLowerCase().includes(q) ||
      (s.tags || []).some((t) => t.toLowerCase() === q),
  )
}

export function groupNames(list = loadFleet()): string[] {
  const seen = new Set<string>()
  for (const s of list) {
    if (s.group) seen.add(s.group)
  }
  return [...seen].sort()
}

/* ---------- per-chat credentials (memory only) ---------- */

let sessionCredentials: FleetCredentialMap = {}

export function setFleetCredentials(map: FleetCredentialMap) {
  sessionCredentials = { ...sessionCredentials, ...map }
}

export function clearFleetCredentials() {
  sessionCredentials = {}
}

export function getFleetCredentials(): FleetCredentialMap {
  return sessionCredentials
}

/**
 * Credentials for one server: values typed in this chat win, then the vault.
 * Nothing here is written anywhere; it is used at connect time only.
 */
export async function credentialsFor(server: FleetServer): Promise<FleetCredential> {
  const entered = sessionCredentials[server.id] || sessionCredentials[server.name] || {}
  const out: FleetCredential = { ...entered }
  if (!out.password) {
    const saved = await loadPassword(fleetPasswordKey(server.id))
    if (saved) out.password = saved
  }
  return out
}

/** Store a password entered in chat, optionally remembering it in the OS vault. */
export async function rememberFleetPassword(
  server: FleetServer,
  password: string,
  remember: boolean,
): Promise<void> {
  setFleetCredentials({ [server.id]: { password } })
  if (remember) {
    await savePassword(fleetPasswordKey(server.id), password, true)
  }
}

/** Redacts credentials out of arbitrary text before it reaches the model log. */
export function scrubSecrets(text: string, secrets: string[]): string {
  let out = text
  for (const s of secrets) {
    if (s && s.length >= 3) out = out.split(s).join('••••••')
  }
  return out
}

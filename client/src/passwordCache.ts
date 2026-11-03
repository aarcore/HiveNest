/**
 * SSH password vault: in-memory + optional durable store.
 * - Desktop (Tauri): OS keychain via secret_set/get/delete (never hosts.json).
 * - Browser/dev: AES-GCM ciphertext in localStorage (device-local key).
 * Remember preference is a set of account keys in localStorage (no secrets).
 */

const REMEMBER_IDS_KEY = 'hivenest.vault.remember.v1'
const BROWSER_WRAP_KEY = 'hivenest.vault.wrap.v1'
const BROWSER_VAULT_KEY = 'hivenest.vault.cipher.v1'
const ACCOUNT_PREFIX = 'hivenest/ssh/'

const memory = new Map<string, string>()

function trimKey(cacheKey: string | undefined | null): string {
  return (cacheKey ?? '').trim()
}

function isTauri(): boolean {
  const w = window as unknown as { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown }
  return !!(w.__TAURI_INTERNALS__ || w.__TAURI__)
}

async function invokeTauri<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

export function vaultAccount(cacheKey: string): string {
  const k = (cacheKey || '').trim()
  if (!k) return ''
  return `${ACCOUNT_PREFIX}${k}`
}

function loadRememberSet(): Set<string> {
  try {
    const raw = localStorage.getItem(REMEMBER_IDS_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return new Set()
    return new Set(arr.filter((x): x is string => typeof x === 'string' && !!x))
  } catch {
    return new Set()
  }
}

function saveRememberSet(set: Set<string>) {
  localStorage.setItem(REMEMBER_IDS_KEY, JSON.stringify([...set]))
}

export function isPasswordRemembered(cacheKey: string): boolean {
  const k = (cacheKey || '').trim()
  if (!k) return false
  return loadRememberSet().has(k)
}

function markRemembered(cacheKey: string, on: boolean) {
  const k = (cacheKey || '').trim()
  if (!k) return
  const set = loadRememberSet()
  if (on) set.add(k)
  else set.delete(k)
  saveRememberSet(set)
}

/** Sync memory peek (after hydrate / recent save). */
export function peekPassword(cacheKey: string): string {
  return memory.get(trimKey(cacheKey)) || ''
}

/** @deprecated use savePassword(key, pw, remember) */
export function rememberPassword(cacheKey: string, password: string) {
  const k = trimKey(cacheKey)
  const p = (password ?? '').trim()
  if (!k) return
  if (!p) {
    memory.delete(k)
    return
  }
  memory.set(k, p)
}

export async function forgetPassword(cacheKey: string) {
  const k = trimKey(cacheKey)
  if (!k) return
  memory.delete(k)
  markRemembered(k, false)
  await deleteDurable(k)
}

async function deleteDurable(cacheKey: string) {
  const account = vaultAccount(cacheKey)
  if (!account) return
  if (isTauri()) {
    try {
      await invokeTauri('secret_delete', { account })
    } catch {
      /* ignore missing / keychain errors on clear */
    }
    return
  }
  try {
    const vault = readBrowserVault()
    delete vault[account]
    writeBrowserVault(vault)
  } catch {
    /* ignore */
  }
}

export async function savePassword(
  cacheKey: string,
  password: string,
  remember: boolean,
): Promise<void> {
  const k = trimKey(cacheKey)
  const p = (password ?? '').trim()
  if (!k) return
  if (!p) {
    await forgetPassword(k)
    return
  }
  memory.set(k, p)
  if (!remember) {
    markRemembered(k, false)
    await deleteDurable(k)
    return
  }
  const account = vaultAccount(k)
  if (isTauri()) {
    await invokeTauri('secret_set', { account, secret: p })
    markRemembered(k, true)
    return
  }
  const vault = readBrowserVault()
  vault[account] = await encryptSecret(p)
  writeBrowserVault(vault)
  markRemembered(k, true)
}

export async function loadPassword(cacheKey: string): Promise<string> {
  const k = trimKey(cacheKey)
  if (!k) return ''
  const mem = memory.get(k)
  if (mem) return mem
  if (!isPasswordRemembered(k)) return ''
  const account = vaultAccount(k)
  try {
    if (isTauri()) {
      const got = await invokeTauri<string | null>('secret_get', { account })
      if (got) {
        memory.set(k, got)
        return got
      }
      return ''
    }
    const vault = readBrowserVault()
    const enc = vault[account]
    if (!enc) return ''
    const plain = await decryptSecret(enc)
    if (plain) memory.set(k, plain)
    return plain
  } catch {
    return ''
  }
}

/** Clear all secrets for a host id (target + jump keys that include it). */
export async function forgetHostSecrets(hostId: string, extraKeys: string[] = []): Promise<void> {
  const id = trimKey(hostId)
  if (!id) return
  const keys = new Set<string>([id, ...extraKeys.map((x) => x.trim()).filter(Boolean)])
  // Also clear remembered keys that reference this host id.
  for (const k of loadRememberSet()) {
    if (k === id || k.includes(id)) keys.add(k)
  }
  for (const k of keys) {
    memory.delete(k)
    markRemembered(k, false)
    await deleteDurable(k)
  }
}

/* ---------- browser encrypted localStorage ---------- */

type BrowserVault = Record<string, string>

function readBrowserVault(): BrowserVault {
  try {
    const raw = localStorage.getItem(BROWSER_VAULT_KEY)
    if (!raw) return {}
    const o = JSON.parse(raw) as unknown
    if (!o || typeof o !== 'object') return {}
    return o as BrowserVault
  } catch {
    return {}
  }
}

function writeBrowserVault(vault: BrowserVault) {
  localStorage.setItem(BROWSER_VAULT_KEY, JSON.stringify(vault))
}

async function getWrapCryptoKey(): Promise<CryptoKey> {
  let b64 = localStorage.getItem(BROWSER_WRAP_KEY)
  if (!b64) {
    const raw = crypto.getRandomValues(new Uint8Array(32))
    b64 = btoa(String.fromCharCode(...raw))
    localStorage.setItem(BROWSER_WRAP_KEY, b64)
  }
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  return crypto.subtle.importKey('raw', bin, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function encryptSecret(plain: string): Promise<string> {
  const key = await getWrapCryptoKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = new TextEncoder().encode(plain)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data)
  const packed = new Uint8Array(iv.length + ct.byteLength)
  packed.set(iv, 0)
  packed.set(new Uint8Array(ct), iv.length)
  return btoa(String.fromCharCode(...packed))
}

async function decryptSecret(blob: string): Promise<string> {
  const key = await getWrapCryptoKey()
  const packed = Uint8Array.from(atob(blob), (c) => c.charCodeAt(0))
  const iv = packed.slice(0, 12)
  const ct = packed.slice(12)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return new TextDecoder().decode(pt)
}

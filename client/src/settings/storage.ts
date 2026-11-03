import {
  defaultSettings,
  providerIsConfigured,
  type AppSettings,
  type ProviderConfig,
  type ProviderId,
  PROVIDER_ORDER,
} from './types'

const STORAGE_KEY = 'hivenest_app_settings_v1'
/** Light obfuscation only — not strong crypto. Keys stay on this machine. */
const OBFUSCATE_SALT = 'hivenest-local-only-v1'

function xorBytes(data: Uint8Array, salt: string): Uint8Array {
  const out = new Uint8Array(data.length)
  for (let i = 0; i < data.length; i++) {
    out[i] = data[i] ^ salt.charCodeAt(i % salt.length)
  }
  return out
}

function encodeSecret(plain: string): string {
  if (!plain) return ''
  const bytes = new TextEncoder().encode(plain)
  const xored = xorBytes(bytes, OBFUSCATE_SALT)
  let bin = ''
  for (let i = 0; i < xored.length; i++) bin += String.fromCharCode(xored[i])
  return 'hn1:' + btoa(bin)
}

function decodeSecret(stored: string): string {
  if (!stored) return ''
  if (!stored.startsWith('hn1:')) return stored
  try {
    const bin = atob(stored.slice(4))
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new TextDecoder().decode(xorBytes(bytes, OBFUSCATE_SALT))
  } catch {
    return ''
  }
}

type StoredProvider = Omit<ProviderConfig, 'apiKey'> & { apiKeyEnc: string }
type StoredSettings = {
  version: 1
  activeProviderId: ProviderId | null
  providers: Partial<Record<ProviderId, StoredProvider>>
}

function toStored(s: AppSettings): StoredSettings {
  const providers = {} as Record<ProviderId, StoredProvider>
  for (const id of PROVIDER_ORDER) {
    const p = s.providers[id]
    providers[id] = {
      id: p.id,
      enabled: p.enabled,
      apiBaseUrl: p.apiBaseUrl,
      defaultModel: p.defaultModel,
      orgOrRegion: p.orgOrRegion,
      extraHeaders: p.extraHeaders || '',
      apiKeyEnc: encodeSecret(p.apiKey),
    }
  }
  return {
    version: 1,
    activeProviderId: s.activeProviderId,
    providers,
  }
}

function fromStored(raw: StoredSettings): AppSettings {
  const base = defaultSettings()
  const providers = { ...base.providers }
  for (const id of PROVIDER_ORDER) {
    const p = raw.providers?.[id]
    if (!p) continue
    providers[id] = {
      id,
      enabled: !!p.enabled,
      apiBaseUrl: p.apiBaseUrl || base.providers[id].apiBaseUrl,
      defaultModel: p.defaultModel || base.providers[id].defaultModel,
      orgOrRegion: p.orgOrRegion || '',
      extraHeaders: typeof p.extraHeaders === 'string' ? p.extraHeaders : '',
      apiKey: decodeSecret(p.apiKeyEnc || ''),
    }
  }
  let active = raw.activeProviderId
  if (active && !providers[active]) active = null
  return { version: 1, activeProviderId: active ?? null, providers }
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultSettings()
    const parsed = JSON.parse(raw) as StoredSettings
    if (!parsed || parsed.version !== 1) return defaultSettings()
    return fromStored(parsed)
  } catch {
    return defaultSettings()
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(toStored(settings)))
}

export function getActiveConfiguredProvider(settings: AppSettings): ProviderConfig | null {
  const id = settings.activeProviderId
  if (!id) return null
  const p = settings.providers[id]
  if (!p || !providerIsConfigured(p)) return null
  return p
}

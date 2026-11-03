import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { getActiveConfiguredProvider, loadSettings, saveSettings } from './storage'
import {
  providerIsConfigured,
  type AppSettings,
  type ProviderConfig,
  type ProviderId,
} from './types'

type SettingsCtx = {
  settings: AppSettings
  setSettings: (s: AppSettings) => void
  updateSettings: (patch: Partial<AppSettings> | ((prev: AppSettings) => AppSettings)) => void
  activeProvider: ProviderConfig | null
  configuredCount: number
  isProviderReady: (id: ProviderId) => boolean
}

const Ctx = createContext<SettingsCtx | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettingsState] = useState<AppSettings>(() => loadSettings())

  const setSettings = useCallback((s: AppSettings) => {
    saveSettings(s)
    setSettingsState(s)
  }, [])

  const updateSettings = useCallback(
    (patch: Partial<AppSettings> | ((prev: AppSettings) => AppSettings)) => {
      setSettingsState((prev) => {
        const next = typeof patch === 'function' ? patch(prev) : { ...prev, ...patch }
        saveSettings(next)
        return next
      })
    },
    [],
  )

  const value = useMemo<SettingsCtx>(() => {
    const configuredCount = (Object.keys(settings.providers) as ProviderId[]).filter((id) =>
      providerIsConfigured(settings.providers[id]),
    ).length
    return {
      settings,
      setSettings,
      updateSettings,
      activeProvider: getActiveConfiguredProvider(settings),
      configuredCount,
      isProviderReady: (id) => providerIsConfigured(settings.providers[id]),
    }
  }, [settings, setSettings, updateSettings])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSettings() {
  const c = useContext(Ctx)
  if (!c) throw new Error('SettingsProvider missing')
  return c
}

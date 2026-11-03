import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { ITheme } from '@xterm/xterm'
import { APP_THEMES, applyAppThemeVars, getAppTheme, type AppThemeId } from './theme/appThemes'
import {
  TERMINAL_PRESETS,
  cloneXtermTheme,
  findTerminalTheme,
  parseTerminalThemeJson,
  type TerminalThemePreset,
} from './theme/terminalThemes'

export type ThemeMode = 'light' | 'dark'

const APP_KEY = 'hivenest_app_theme_id'
const TERM_KEY = 'hivenest_terminal_theme_id'
const CUSTOM_KEY = 'hivenest_custom_terminal_themes'
const LEGACY_KEY = 'hivenest_theme'

export type CustomTerminalTheme = {
  id: string
  name: string
  theme: ITheme
}

type ThemeCtx = {
  /** Chromatic mode derived from app theme (light/dark). */
  theme: ThemeMode
  appThemeId: AppThemeId
  setAppThemeId: (id: AppThemeId) => void
  /** @deprecated use setAppThemeId */
  setTheme: (t: ThemeMode) => void
  toggleTheme: () => void
  terminalThemeId: string
  setTerminalThemeId: (id: string) => void
  xtermTheme: ITheme
  customTerminalThemes: CustomTerminalTheme[]
  importTerminalTheme: (jsonText: string) => CustomTerminalTheme
  removeCustomTerminalTheme: (id: string) => void
  appThemes: typeof APP_THEMES
  terminalPresets: TerminalThemePreset[]
}

const Ctx = createContext<ThemeCtx | null>(null)

function readAppThemeId(): AppThemeId {
  const v = localStorage.getItem(APP_KEY)
  if (v && APP_THEMES.some((t) => t.id === v)) return v as AppThemeId
  const legacy = localStorage.getItem(LEGACY_KEY)
  if (legacy === 'dark' || legacy === 'light') return legacy
  return 'light'
}

function readTermId(): string {
  return localStorage.getItem(TERM_KEY) || 'hivenest-dark'
}

function readCustom(): CustomTerminalTheme[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter((x) => x && typeof x.id === 'string' && x.theme)
  } catch {
    return []
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [appThemeId, setAppThemeIdState] = useState<AppThemeId>(() => {
    const id = readAppThemeId()
    applyAppThemeVars(getAppTheme(id))
    return id
  })
  const [terminalThemeId, setTerminalThemeIdState] = useState<string>(() => readTermId())
  const [customTerminalThemes, setCustom] = useState<CustomTerminalTheme[]>(() => readCustom())

  const setAppThemeId = useCallback((id: AppThemeId) => {
    localStorage.setItem(APP_KEY, id)
    const def = getAppTheme(id)
    localStorage.setItem(LEGACY_KEY, def.mode)
    applyAppThemeVars(def)
    setAppThemeIdState(id)
  }, [])

  const setTheme = useCallback(
    (t: ThemeMode) => {
      setAppThemeId(t === 'dark' ? 'dark' : 'light')
    },
    [setAppThemeId],
  )

  const toggleTheme = useCallback(() => {
    const cur = getAppTheme(appThemeId)
    setAppThemeId(cur.mode === 'light' ? 'dark' : 'light')
  }, [appThemeId, setAppThemeId])

  const setTerminalThemeId = useCallback((id: string) => {
    localStorage.setItem(TERM_KEY, id)
    setTerminalThemeIdState(id)
  }, [])

  const importTerminalTheme = useCallback((jsonText: string) => {
    const parsed = parseTerminalThemeJson(JSON.parse(jsonText))
    const id = `custom-${Date.now().toString(36)}`
    const entry: CustomTerminalTheme = { id, name: parsed.name, theme: parsed.theme }
    setCustom((prev) => {
      const next = [...prev, entry]
      localStorage.setItem(CUSTOM_KEY, JSON.stringify(next))
      return next
    })
    localStorage.setItem(TERM_KEY, id)
    setTerminalThemeIdState(id)
    return entry
  }, [])

  const removeCustomTerminalTheme = useCallback((id: string) => {
    setCustom((prev) => {
      const next = prev.filter((x) => x.id !== id)
      localStorage.setItem(CUSTOM_KEY, JSON.stringify(next))
      return next
    })
    setTerminalThemeIdState((cur) => {
      if (cur !== id) return cur
      localStorage.setItem(TERM_KEY, 'hivenest-dark')
      return 'hivenest-dark'
    })
  }, [])

  useEffect(() => {
    applyAppThemeVars(getAppTheme(appThemeId))
  }, [appThemeId])

  const appDef = getAppTheme(appThemeId)
  // Always clone so consumers (xterm options.theme) get a fresh object reference
  // whenever the selected terminal theme id / custom list changes.
  const xtermTheme = useMemo(
    () => cloneXtermTheme(findTerminalTheme(terminalThemeId, customTerminalThemes)),
    [terminalThemeId, customTerminalThemes],
  )

  // Keep CSS chrome (--term-bg/--term-fg) in sync with the terminal theme so
  // .term-host padding / gaps match xterm bg even when the app theme differs.
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--term-bg', xtermTheme.background || '#0b0d12')
    root.style.setProperty('--term-fg', xtermTheme.foreground || '#e6eaf2')
  }, [xtermTheme])

  const value = useMemo<ThemeCtx>(
    () => ({
      theme: appDef.mode,
      appThemeId,
      setAppThemeId,
      setTheme,
      toggleTheme,
      terminalThemeId,
      setTerminalThemeId,
      xtermTheme,
      customTerminalThemes,
      importTerminalTheme,
      removeCustomTerminalTheme,
      appThemes: APP_THEMES,
      terminalPresets: TERMINAL_PRESETS,
    }),
    [
      appDef.mode,
      appThemeId,
      setAppThemeId,
      setTheme,
      toggleTheme,
      terminalThemeId,
      setTerminalThemeId,
      xtermTheme,
      customTerminalThemes,
      importTerminalTheme,
      removeCustomTerminalTheme,
    ],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useTheme() {
  const c = useContext(Ctx)
  if (!c) throw new Error('ThemeProvider missing')
  return c
}


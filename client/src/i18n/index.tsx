import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { en, type MessageKey } from './en'
import { es } from './es'
import { fr } from './fr'
import { de } from './de'
import { pt } from './pt'
import { uk } from './uk'
import { ja } from './ja'
import { ko } from './ko'
import { zhCN } from './zh-CN'
import { zhTW } from './zh-TW'

export type Locale = 'en' | 'es' | 'fr' | 'de' | 'pt' | 'uk' | 'ja' | 'ko' | 'zh-CN' | 'zh-TW'

/** Native labels for the language picker (English is primary; zh-CN / zh-TW last). */
export const LOCALE_OPTIONS: { value: Locale; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'pt', label: 'Português' },
  { value: 'uk', label: 'Українська' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
]

const catalogs: Record<Locale, Partial<Record<MessageKey, string>>> = {
  en: en as Record<MessageKey, string>,
  es,
  fr,
  de,
  pt,
  uk,
  ja,
  ko,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
}

const VALID = new Set<string>(LOCALE_OPTIONS.map((o) => o.value))

function parseLocale(v: string | null): Locale {
  if (v && VALID.has(v)) return v as Locale
  return 'en'
}

type I18nCtx = {
  locale: Locale
  setLocale: (l: Locale) => void
  t: (key: MessageKey) => string
}

const Ctx = createContext<I18nCtx | null>(null)

const STORAGE_KEY = 'hivenest_locale'

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => parseLocale(localStorage.getItem(STORAGE_KEY)))
  const setLocale = (l: Locale) => {
    localStorage.setItem(STORAGE_KEY, l)
    setLocaleState(l)
  }
  const value = useMemo<I18nCtx>(
    () => ({
      locale,
      setLocale,
      t: (key) => catalogs[locale][key] ?? en[key] ?? key,
    }),
    [locale],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useI18n() {
  const c = useContext(Ctx)
  if (!c) throw new Error('I18nProvider missing')
  return c
}

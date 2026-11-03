import { describe, expect, it } from 'vitest'
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

const required: MessageKey[] = [
  'help',
  'helpTitle',
  'appTheme',
  'terminalTheme',
  'settingsSkills',
  'settingsMcp',
  'close',
  'importTerminalTheme',
  'rememberPassword',
  'rememberPasswordHint',
  'localSession',
  'sessionTabs',
  'closeSessionTab',
  'dismissToast',
  'toastSuccess',
  'toastInfo',
  'toastWarning',
]

describe('i18n catalogs', () => {
  it('en has required keys', () => {
    for (const k of required) {
      expect(en[k], k).toBeTruthy()
    }
  })

  it('other locales include help/theme keys or rely on Partial fallback', () => {
    const cats = [es, fr, de, pt, uk, ja, ko, zhCN, zhTW]
    for (const cat of cats) {
      expect(cat.help || en.help).toBeTruthy()
      expect(cat.appTheme || en.appTheme).toBeTruthy()
      expect(cat.settingsMcp || en.settingsMcp).toBeTruthy()
    }
  })
})

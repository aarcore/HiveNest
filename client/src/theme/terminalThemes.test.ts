import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TERMINAL_THEME_ID,
  TERMINAL_PRESETS,
  cloneXtermTheme,
  findTerminalTheme,
  normalizeHex,
  parseTerminalThemeJson,
} from './terminalThemes'

describe('terminal themes', () => {
  it('ships at least 8 presets', () => {
    expect(TERMINAL_PRESETS.length).toBeGreaterThanOrEqual(8)
  })

  it('defaults to a light preset', () => {
    const def = TERMINAL_PRESETS.find((p) => p.id === DEFAULT_TERMINAL_THEME_ID)
    expect(def, DEFAULT_TERMINAL_THEME_ID).toBeTruthy()
    expect(def?.theme.background).toBe('#f8fafc')
    expect(def?.theme.foreground).toBe('#0f172a')
  })

  it('falls back to the default preset for unknown ids', () => {
    const unknown = findTerminalTheme('does-not-exist')
    expect(unknown.background).toBe(findTerminalTheme(DEFAULT_TERMINAL_THEME_ID).background)
  })

  it('normalizes short hex', () => {
    expect(normalizeHex('#abc')).toBe('#aabbcc')
    expect(normalizeHex('nope')).toBeUndefined()
  })

  it('parses flat xterm JSON', () => {
    const { name, theme } = parseTerminalThemeJson({
      name: 'Mine',
      background: '#111111',
      foreground: '#eeeeee',
      red: '#ff0000',
    })
    expect(name).toBe('Mine')
    expect(theme.background).toBe('#111111')
    expect(theme.red).toBe('#ff0000')
    expect(theme.green).toBeTruthy()
  })

  it('parses nested theme object', () => {
    const { theme } = parseTerminalThemeJson({
      theme: { background: '#000000', foreground: '#ffffff' },
    })
    expect(theme.background).toBe('#000000')
  })

  it('findTerminalTheme resolves presets and custom', () => {
    const d = findTerminalTheme('dracula')
    expect(d.background?.toLowerCase()).toBe('#282a36')
    const custom = findTerminalTheme('c1', [
      { id: 'c1', name: 'C', theme: { ...d, background: '#010101' } },
    ])
    expect(custom.background).toBe('#010101')
  })

  it('rejects non-object import', () => {
    expect(() => parseTerminalThemeJson('x')).toThrow()
  })

  it('cloneXtermTheme returns a new object with same colors', () => {
    const base = findTerminalTheme('dracula')
    const a = cloneXtermTheme(base)
    const b = cloneXtermTheme(base)
    expect(a).not.toBe(base)
    expect(a).not.toBe(b)
    expect(a.background).toBe(base.background)
    expect(a.foreground).toBe(base.foreground)
    expect(a.red).toBe(base.red)
  })
})

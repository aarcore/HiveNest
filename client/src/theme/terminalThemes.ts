import type { ITheme } from '@xterm/xterm'

export type TerminalThemeJson = {
  name?: string
  background?: string
  foreground?: string
  cursor?: string
  cursorAccent?: string
  selectionBackground?: string
  selectionForeground?: string
  black?: string
  red?: string
  green?: string
  yellow?: string
  blue?: string
  magenta?: string
  cyan?: string
  white?: string
  brightBlack?: string
  brightRed?: string
  brightGreen?: string
  brightYellow?: string
  brightBlue?: string
  brightMagenta?: string
  brightCyan?: string
  brightWhite?: string
}

export type TerminalThemePreset = {
  id: string
  name: string
  theme: ITheme
}

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

export function normalizeHex(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  if (!HEX.test(s)) return undefined
  if (s.length === 4) {
    const r = s[1], g = s[2], b = s[3]
    return `#${r}${r}${g}${g}${b}${b}`
  }
  return s.length === 9 ? s.slice(0, 7) : s
}

/** Parse iTerm/xterm-style theme JSON into an ITheme. */
export function parseTerminalThemeJson(raw: unknown): { name: string; theme: ITheme } {
  if (!raw || typeof raw !== 'object') throw new Error('Theme must be a JSON object')
  const o = raw as Record<string, unknown>
  // Accept nested { theme: {...} } or flat
  const src = (o.theme && typeof o.theme === 'object' ? o.theme : o) as Record<string, unknown>
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const h = normalizeHex(src[k])
      if (h) return h
    }
    return undefined
  }
  const background = pick('background', 'Background Color', 'bg') || '#0b0d12'
  const foreground = pick('foreground', 'Foreground Color', 'fg') || '#e6eaf2'
  const theme: ITheme = {
    background,
    foreground,
    cursor: pick('cursor', 'Cursor Color') || foreground,
    cursorAccent: pick('cursorAccent', 'Cursor Text Color') || background,
    selectionBackground: pick('selectionBackground', 'Selection Color') || '#334155',
    selectionForeground: pick('selectionForeground') || foreground,
    black: pick('black', 'Ansi 0 Color') || '#0b0d12',
    red: pick('red', 'Ansi 1 Color') || '#f87171',
    green: pick('green', 'Ansi 2 Color') || '#22c55e',
    yellow: pick('yellow', 'Ansi 3 Color') || '#fbbf24',
    blue: pick('blue', 'Ansi 4 Color') || '#38bdf8',
    magenta: pick('magenta', 'Ansi 5 Color') || '#c084fc',
    cyan: pick('cyan', 'Ansi 6 Color') || '#22d3ee',
    white: pick('white', 'Ansi 7 Color') || '#e6eaf2',
    brightBlack: pick('brightBlack', 'Ansi 8 Color') || '#64748b',
    brightRed: pick('brightRed', 'Ansi 9 Color') || '#fca5a5',
    brightGreen: pick('brightGreen', 'Ansi 10 Color') || '#4ade80',
    brightYellow: pick('brightYellow', 'Ansi 11 Color') || '#fde047',
    brightBlue: pick('brightBlue', 'Ansi 12 Color') || '#7dd3fc',
    brightMagenta: pick('brightMagenta', 'Ansi 13 Color') || '#d8b4fe',
    brightCyan: pick('brightCyan', 'Ansi 14 Color') || '#67e8f9',
    brightWhite: pick('brightWhite', 'Ansi 15 Color') || '#f8fafc',
  }
  const name =
    (typeof o.name === 'string' && o.name.trim()) ||
    (typeof src.name === 'string' && src.name.trim()) ||
    'Custom theme'
  return { name, theme }
}

export function themeToJson(name: string, theme: ITheme): TerminalThemeJson {
  return { name, ...theme }
}

export const TERMINAL_PRESETS: TerminalThemePreset[] = [
  {
    id: 'hivenest-dark',
    name: 'Hive Nest Dark',
    theme: {
      background: '#0b0d12', foreground: '#e6eaf2', cursor: '#7dd3fc', cursorAccent: '#0b0d12',
      selectionBackground: '#334155', selectionForeground: '#e6eaf2',
      black: '#0b0d12', red: '#f87171', green: '#22c55e', yellow: '#fbbf24', blue: '#38bdf8',
      magenta: '#c084fc', cyan: '#22d3ee', white: '#e6eaf2',
      brightBlack: '#64748b', brightRed: '#fca5a5', brightGreen: '#4ade80', brightYellow: '#fde047',
      brightBlue: '#7dd3fc', brightMagenta: '#d8b4fe', brightCyan: '#67e8f9', brightWhite: '#f8fafc',
    },
  },
  {
    id: 'hivenest-light',
    name: 'Hive Nest Light',
    theme: {
      background: '#f8fafc', foreground: '#0f172a', cursor: '#0284c7', cursorAccent: '#f8fafc',
      selectionBackground: '#bfdbfe', selectionForeground: '#0f172a',
      black: '#0f172a', red: '#dc2626', green: '#16a34a', yellow: '#ca8a04', blue: '#0284c7',
      magenta: '#9333ea', cyan: '#0891b2', white: '#f8fafc',
      brightBlack: '#64748b', brightRed: '#ef4444', brightGreen: '#22c55e', brightYellow: '#eab308',
      brightBlue: '#0ea5e9', brightMagenta: '#a855f7', brightCyan: '#06b6d4', brightWhite: '#ffffff',
    },
  },
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    theme: {
      background: '#002b36', foreground: '#839496', cursor: '#93a1a1', cursorAccent: '#002b36',
      selectionBackground: '#073642', selectionForeground: '#93a1a1',
      black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900', blue: '#268bd2',
      magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
      brightBlack: '#002b36', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83',
      brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
    },
  },
  {
    id: 'solarized-light',
    name: 'Solarized Light',
    theme: {
      background: '#fdf6e3', foreground: '#657b83', cursor: '#586e75', cursorAccent: '#fdf6e3',
      selectionBackground: '#eee8d5', selectionForeground: '#586e75',
      black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900', blue: '#268bd2',
      magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
      brightBlack: '#002b36', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83',
      brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
    },
  },
  {
    id: 'dracula',
    name: 'Dracula',
    theme: {
      background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2', cursorAccent: '#282a36',
      selectionBackground: '#44475a', selectionForeground: '#f8f8f2',
      black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c', blue: '#bd93f9',
      magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
      brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94', brightYellow: '#ffffa5',
      brightBlue: '#d6acff', brightMagenta: '#ff92df', brightCyan: '#a4ffff', brightWhite: '#ffffff',
    },
  },
  {
    id: 'one-dark',
    name: 'One Dark',
    theme: {
      background: '#282c34', foreground: '#abb2bf', cursor: '#528bff', cursorAccent: '#282c34',
      selectionBackground: '#3e4451', selectionForeground: '#abb2bf',
      black: '#282c34', red: '#e06c75', green: '#98c379', yellow: '#e5c07b', blue: '#61afef',
      magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf',
      brightBlack: '#5c6370', brightRed: '#e06c75', brightGreen: '#98c379', brightYellow: '#e5c07b',
      brightBlue: '#61afef', brightMagenta: '#c678dd', brightCyan: '#56b6c2', brightWhite: '#ffffff',
    },
  },
  {
    id: 'novel',
    name: 'Novel',
    theme: {
      background: '#dfdbc3', foreground: '#3b2322', cursor: '#73635a', cursorAccent: '#dfdbc3',
      selectionBackground: '#c7c1a5', selectionForeground: '#3b2322',
      black: '#000000', red: '#cc0000', green: '#009600', yellow: '#d06b00', blue: '#0000cc',
      magenta: '#cc00cc', cyan: '#0087b3', white: '#cccccc',
      brightBlack: '#808080', brightRed: '#cc0000', brightGreen: '#009600', brightYellow: '#d06b00',
      brightBlue: '#0000cc', brightMagenta: '#cc00cc', brightCyan: '#0087b3', brightWhite: '#ffffff',
    },
  },
  {
    id: 'monokai',
    name: 'Monokai',
    theme: {
      background: '#272822', foreground: '#f8f8f2', cursor: '#f8f8f0', cursorAccent: '#272822',
      selectionBackground: '#49483e', selectionForeground: '#f8f8f2',
      black: '#272822', red: '#f92672', green: '#a6e22e', yellow: '#f4bf75', blue: '#66d9ef',
      magenta: '#ae81ff', cyan: '#a1efe4', white: '#f8f8f2',
      brightBlack: '#75715e', brightRed: '#f92672', brightGreen: '#a6e22e', brightYellow: '#f4bf75',
      brightBlue: '#66d9ef', brightMagenta: '#ae81ff', brightCyan: '#a1efe4', brightWhite: '#f9f8f5',
    },
  },
  {
    id: 'github-light',
    name: 'GitHub Light',
    theme: {
      background: '#ffffff', foreground: '#24292f', cursor: '#044289', cursorAccent: '#ffffff',
      selectionBackground: '#ddf4ff', selectionForeground: '#24292f',
      black: '#24292f', red: '#cf222e', green: '#116329', yellow: '#4d2d00', blue: '#0969da',
      magenta: '#8250df', cyan: '#1b7c83', white: '#6e7781',
      brightBlack: '#57606a', brightRed: '#a40e26', brightGreen: '#1a7f37', brightYellow: '#633c01',
      brightBlue: '#218bff', brightMagenta: '#a475f9', brightCyan: '#3192aa', brightWhite: '#8c959f',
    },
  },
]

export function findTerminalTheme(
  id: string,
  custom: { id: string; name: string; theme: ITheme }[] = [],
): ITheme {
  const c = custom.find((x) => x.id === id)
  if (c) return c.theme
  const p = TERMINAL_PRESETS.find((x) => x.id === id)
  return (p || TERMINAL_PRESETS[0]).theme
}

/** Shallow-clone an ITheme so xterm's reference check always sees a new object. */
export function cloneXtermTheme(theme: ITheme): ITheme {
  return { ...theme }
}

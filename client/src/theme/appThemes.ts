/** Built-in app chrome color schemes (CSS variables). */

export type AppThemeId =
  | 'light'
  | 'dark'
  | 'high-contrast'
  | 'slate'
  | 'forest'
  | 'rose'
  | 'amber'
  | 'violet'

export type AppThemeVars = Record<string, string>

export type AppThemeDef = {
  id: AppThemeId
  name: string
  mode: 'light' | 'dark'
  vars: AppThemeVars
}

const lightBase: AppThemeVars = {
  '--bg': '#f4f6fa',
  '--panel': '#ffffff',
  '--panel-2': '#eef2f7',
  '--border': '#d5dde8',
  '--border-hover': '#94a3b8',
  '--text': '#0f172a',
  '--muted': '#64748b',
  '--accent': '#0284c7',
  '--accent-2': '#16a34a',
  '--danger': '#dc2626',
  '--warn': '#ca8a04',
  '--code-bg': '#e8eef6',
  '--accent-soft': 'rgba(2, 132, 199, 0.12)',
  '--accent-border': 'rgba(2, 132, 199, 0.4)',
  '--accent-fg': '#0369a1',
  '--danger-soft': 'rgba(220, 38, 38, 0.1)',
  '--danger-border': 'rgba(220, 38, 38, 0.35)',
  '--danger-fg': '#b91c1c',
  '--ok-soft': 'rgba(22, 163, 74, 0.12)',
  '--backdrop': 'rgba(15, 23, 42, 0.35)',
  '--radius': '8px',
  '--shadow': '0 1px 2px rgba(15,23,42,0.06), 0 4px 12px rgba(15,23,42,0.04)',
  '--shadow-modal': '0 8px 30px rgba(15,23,42,0.18)',
}

const darkBase: AppThemeVars = {
  '--bg': '#0b0d12',
  '--panel': '#12161f',
  '--panel-2': '#181e2a',
  '--border': '#273044',
  '--border-hover': '#3b4a66',
  '--text': '#e6eaf2',
  '--muted': '#93a0b8',
  '--accent': '#38bdf8',
  '--accent-2': '#22c55e',
  '--danger': '#f87171',
  '--warn': '#fbbf24',
  '--code-bg': '#0b0d12',
  '--accent-soft': 'rgba(56, 189, 248, 0.15)',
  '--accent-border': 'rgba(56, 189, 248, 0.45)',
  '--accent-fg': '#bae6fd',
  '--danger-soft': 'rgba(248, 113, 113, 0.12)',
  '--danger-border': 'rgba(248, 113, 113, 0.4)',
  '--danger-fg': '#fecaca',
  '--ok-soft': 'rgba(34, 197, 94, 0.15)',
  '--backdrop': 'rgba(0, 0, 0, 0.55)',
  '--radius': '8px',
  '--shadow': '0 1px 2px rgba(0,0,0,0.35), 0 4px 14px rgba(0,0,0,0.25)',
  '--shadow-modal': '0 12px 40px rgba(0,0,0,0.55)',
}

function withAccent(base: AppThemeVars, accent: string, soft: string, border: string, fg: string): AppThemeVars {
  return { ...base, '--accent': accent, '--accent-soft': soft, '--accent-border': border, '--accent-fg': fg }
}

export const APP_THEMES: AppThemeDef[] = [
  { id: 'light', name: 'Light', mode: 'light', vars: lightBase },
  { id: 'dark', name: 'Dark', mode: 'dark', vars: darkBase },
  {
    id: 'high-contrast',
    name: 'High contrast',
    mode: 'dark',
    vars: {
      ...darkBase,
      '--bg': '#000000',
      '--panel': '#0a0a0a',
      '--panel-2': '#141414',
      '--border': '#ffffff',
      '--border-hover': '#ffff00',
      '--text': '#ffffff',
      '--muted': '#dddddd',
      '--accent': '#ffff00',
      '--accent-2': '#00ff00',
      '--danger': '#ff4444',
      '--code-bg': '#000000',
      '--accent-soft': 'rgba(255,255,0,0.2)',
      '--accent-border': '#ffff00',
      '--accent-fg': '#ffff00',
      '--radius': '4px',
    },
  },
  {
    id: 'slate',
    name: 'Slate',
    mode: 'dark',
    vars: withAccent(darkBase, '#94a3b8', 'rgba(148,163,184,0.18)', 'rgba(148,163,184,0.5)', '#e2e8f0'),
  },
  {
    id: 'forest',
    name: 'Forest',
    mode: 'dark',
    vars: {
      ...withAccent(
        { ...darkBase, '--bg': '#0c1410', '--panel': '#122018', '--panel-2': '#1a2a20', '--border': '#2a4034', '--code-bg': '#0a120e' },
        '#34d399',
        'rgba(52,211,153,0.15)',
        'rgba(52,211,153,0.45)',
        '#a7f3d0',
      ),
    },
  },
  {
    id: 'rose',
    name: 'Rose',
    mode: 'light',
    vars: withAccent(
      { ...lightBase, '--bg': '#fdf6f8', '--panel': '#fff7fa', '--panel-2': '#fceef3', '--border': '#f0d0da' },
      '#e11d48',
      'rgba(225,29,72,0.12)',
      'rgba(225,29,72,0.4)',
      '#9f1239',
    ),
  },
  {
    id: 'amber',
    name: 'Amber hive',
    mode: 'light',
    vars: withAccent(
      { ...lightBase, '--bg': '#fffbf0', '--panel': '#fffdf7', '--panel-2': '#f7efd9', '--border': '#e8d9a8' },
      '#d97706',
      'rgba(217,119,6,0.14)',
      'rgba(217,119,6,0.45)',
      '#92400e',
    ),
  },
  {
    id: 'violet',
    name: 'Violet',
    mode: 'dark',
    vars: withAccent(
      { ...darkBase, '--bg': '#120f1a', '--panel': '#1a1526', '--panel-2': '#241c33', '--border': '#3b2f52' },
      '#a78bfa',
      'rgba(167,139,250,0.18)',
      'rgba(167,139,250,0.5)',
      '#ddd6fe',
    ),
  },
]

export function getAppTheme(id: string): AppThemeDef {
  return APP_THEMES.find((t) => t.id === id) || APP_THEMES[0]
}

export function applyAppThemeVars(theme: AppThemeDef) {
  const root = document.documentElement
  root.setAttribute('data-theme', theme.mode)
  root.setAttribute('data-app-theme', theme.id)
  for (const [k, v] of Object.entries(theme.vars)) {
    root.style.setProperty(k, v)
  }
}

import { BUILTIN_SKILLS, defaultSkillsSettings, type SkillsSettings } from './skills'

const KEY = 'hivenest_skills_v1'

export function loadSkillsSettings(): SkillsSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaultSkillsSettings()
    const parsed = JSON.parse(raw) as SkillsSettings
    const base = defaultSkillsSettings()
    const enabled = { ...base.enabled, ...(parsed.enabled || {}) }
    // New builtins that the user has never toggled keep their defaultEnabled.
    for (const s of BUILTIN_SKILLS) {
      if (!(s.id in (parsed.enabled || {}))) {
        enabled[s.id] = s.defaultEnabled !== false
      }
    }
    return {
      enabled,
      custom: Array.isArray(parsed.custom) ? parsed.custom : [],
    }
  } catch {
    return defaultSkillsSettings()
  }
}

export function saveSkillsSettings(s: SkillsSettings) {
  localStorage.setItem(KEY, JSON.stringify(s))
}

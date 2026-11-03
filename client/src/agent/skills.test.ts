import { describe, expect, it } from 'vitest'
import {
  BUILTIN_SKILLS,
  buildSkillsPrompt,
  defaultSkillsSettings,
  isSkillEnabled,
  listSkills,
  parseSkillMarkdown,
  removeCustomSkill,
  upsertCustomSkill,
} from './skills'

describe('agent skills', () => {
  it('ships starter + ops preset skills', () => {
    expect(BUILTIN_SKILLS.length).toBeGreaterThanOrEqual(8)
    expect(BUILTIN_SKILLS.length).toBeLessThanOrEqual(12)
    const ids = BUILTIN_SKILLS.map((s) => s.id)
    expect(ids).toContain('safe-ops')
    expect(ids).toContain('kubernetes-cluster-setup')
    expect(ids).toContain('middleware-install-manage')
    expect(ids).toContain('vulnerability-check')
    expect(ids).toContain('malware-scan')
    expect(ids).toContain('host-health-check')
    expect(ids).toContain('firewall-basics')
  })

  it('defaults ops presets off and starters on', () => {
    const s = defaultSkillsSettings()
    expect(isSkillEnabled(s, BUILTIN_SKILLS.find((x) => x.id === 'safe-ops')!)).toBe(true)
    expect(isSkillEnabled(s, BUILTIN_SKILLS.find((x) => x.id === 'kubernetes-cluster-setup')!)).toBe(
      false,
    )
    expect(isSkillEnabled(s, BUILTIN_SKILLS.find((x) => x.id === 'malware-scan')!)).toBe(false)
  })

  it('injects only enabled skill bodies into prompt', () => {
    const s = defaultSkillsSettings()
    const prompt = buildSkillsPrompt(s)
    expect(prompt).toContain('safe-ops')
    expect(prompt).toContain('Enabled Agent skills')
    expect(prompt).not.toContain('Kubernetes cluster setup')
    s.enabled['kubernetes-cluster-setup'] = true
    const p2 = buildSkillsPrompt(s)
    expect(p2).toContain('Kubernetes cluster setup')
    expect(listSkills(s).length).toBe(BUILTIN_SKILLS.length)
  })

  it('parses frontmatter markdown uploads', () => {
    const skill = parseSkillMarkdown(
      `---
id: my-check
name: My Check
description: Demo skill
---
# Skill: My Check

Do a thing with Approve.
`,
    )
    expect(skill.id).toBe('my-check')
    expect(skill.name).toBe('My Check')
    expect(skill.description).toBe('Demo skill')
    expect(skill.body).toContain('Approve')
  })

  it('upserts and removes custom skills', () => {
    let s = defaultSkillsSettings()
    s = upsertCustomSkill(s, {
      id: 'custom-demo',
      name: 'Custom demo',
      description: 'd',
      body: '# Custom\n\nHello',
    })
    expect(listSkills(s).some((x) => x.id === 'custom-demo' && !x.builtin)).toBe(true)
    expect(isSkillEnabled(s, listSkills(s).find((x) => x.id === 'custom-demo')!)).toBe(true)
    s = removeCustomSkill(s, 'custom-demo')
    expect(listSkills(s).some((x) => x.id === 'custom-demo')).toBe(false)
  })

  it('rejects custom ids that collide with builtins', () => {
    const s = defaultSkillsSettings()
    expect(() =>
      upsertCustomSkill(s, {
        id: 'safe-ops',
        name: 'Nope',
        description: 'x',
        body: 'body',
      }),
    ).toThrow(/reserved/)
  })
})

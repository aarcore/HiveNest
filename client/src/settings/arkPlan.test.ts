import { describe, expect, it } from 'vitest'
import {
  ARK_PLAN_BASE_URLS,
  applyArkPlan,
  arkPlanFromStored,
  defaultProvider,
  isKnownArkPlanBaseUrl,
} from './types'

describe('ark plan base URLs', () => {
  it('uses verified plan paths (not bare /api/v3) for Agent and Coding', () => {
    expect(ARK_PLAN_BASE_URLS.agent_plan).toBe('https://ark.cn-beijing.volces.com/api/plan/v3')
    expect(ARK_PLAN_BASE_URLS.coding_plan).toBe('https://ark.cn-beijing.volces.com/api/coding/v3')
    expect(ARK_PLAN_BASE_URLS.payg).toBe('https://ark.cn-beijing.volces.com/api/v3')
  })

  it('defaults new ark provider to Agent Plan URL', () => {
    const p = defaultProvider('ark')
    expect(p.orgOrRegion).toBe('agent_plan')
    expect(p.apiBaseUrl).toBe(ARK_PLAN_BASE_URLS.agent_plan)
  })

  it('infers plan from known URLs when org is empty', () => {
    expect(arkPlanFromStored('', ARK_PLAN_BASE_URLS.coding_plan)).toBe('coding_plan')
    expect(arkPlanFromStored('', ARK_PLAN_BASE_URLS.payg)).toBe('payg')
    expect(arkPlanFromStored('', ARK_PLAN_BASE_URLS.agent_plan)).toBe('agent_plan')
  })

  it('updates base URL when switching among known presets', () => {
    const p = defaultProvider('ark')
    const next = applyArkPlan(p, 'coding_plan')
    expect(next.orgOrRegion).toBe('coding_plan')
    expect(next.apiBaseUrl).toBe(ARK_PLAN_BASE_URLS.coding_plan)
  })

  it('preserves customized base URL when switching plan', () => {
    const p = { ...defaultProvider('ark'), apiBaseUrl: 'https://example.com/custom/v3' }
    expect(isKnownArkPlanBaseUrl(p.apiBaseUrl)).toBe(false)
    const next = applyArkPlan(p, 'coding_plan')
    expect(next.orgOrRegion).toBe('coding_plan')
    expect(next.apiBaseUrl).toBe('https://example.com/custom/v3')
  })

  it('treats legacy /api/v3 as a known preset so plan switch can replace it', () => {
    const p = { ...defaultProvider('ark'), apiBaseUrl: ARK_PLAN_BASE_URLS.payg, orgOrRegion: '' }
    const next = applyArkPlan(p, 'agent_plan')
    expect(next.apiBaseUrl).toBe(ARK_PLAN_BASE_URLS.agent_plan)
  })
})

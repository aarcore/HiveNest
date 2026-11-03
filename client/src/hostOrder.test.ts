/** @vitest-environment jsdom */
import { describe, expect, it, beforeEach } from 'vitest'
import {
  loadHostOrder,
  saveHostOrder,
  mergeHostOrder,
  orderHosts,
  moveIdBefore,
  moveIdTo,
} from './hostOrder'

describe('hostOrder', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('persists and loads order', () => {
    saveHostOrder(['b', 'a', 'c'])
    expect(loadHostOrder()).toEqual(['b', 'a', 'c'])
  })

  it('merge keeps saved order and appends new', () => {
    expect(mergeHostOrder(['b', 'a'], ['a', 'b', 'c'])).toEqual(['b', 'a', 'c'])
    expect(mergeHostOrder(['x', 'b'], ['a', 'b'])).toEqual(['b', 'a'])
  })

  it('orderHosts sorts by saved ids', () => {
    const hosts = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(orderHosts(hosts, ['c', 'a']).map((h) => h.id)).toEqual(['c', 'a', 'b'])
  })

  it('moveIdBefore reorders', () => {
    expect(moveIdBefore(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b'])
    expect(moveIdBefore(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'a', 'c'])
  })

  it('moveIdTo supports after', () => {
    expect(moveIdTo(['a', 'b', 'c'], 'a', 'c', 'after')).toEqual(['b', 'c', 'a'])
    expect(moveIdTo(['a', 'b', 'c'], 'c', 'a', 'before')).toEqual(['c', 'a', 'b'])
  })
})

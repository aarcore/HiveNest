import { describe, expect, it } from 'vitest'
import { parseSuggestion } from './llm'

describe('parseSuggestion done handling', () => {
  it('accepts done as string "true"', () => {
    const r = parseSuggestion(
      '{"command":"true","reply":"all set","done":"true"}',
      'fallback',
    )
    expect(r.done).toBe(true)
    expect(r.command).toBe('true')
  })

  it('treats reply-only JSON as finished', () => {
    const r = parseSuggestion('{"reply":"Disk usage is normal.","reason":"done"}', 'fallback')
    expect(r.done).toBe(true)
  })

  it('keeps tool turns when done is false', () => {
    const r = parseSuggestion(
      '{"tool":"disk_free","path":"/","reply":"checking","done":false}',
      'fallback',
    )
    expect(r.done).toBe(false)
    expect(r.tool).toBe('disk_free')
  })
})

import { describe, expect, it } from 'vitest'

// parseSuggestion is not exported — exercise via a tiny re-export test by importing chatSuggestCommand's module internals
// Instead: duplicate the JSON shapes the Agent expects and validate through a local helper exported for tests.
// We'll export parseSuggestionForTest from llm if needed — use dynamic eval of public API.

// Minimal: import SuggestCommandResult typing and a dedicated export.
import { suggestCommandFromRaw } from './llmParse'

describe('MCP suggestion parse', () => {
  it('parses mcp:true JSON', () => {
    const raw = JSON.stringify({
      mcp: true,
      server: 'srv1',
      tool: 'write_note',
      arguments: { path: '/tmp/a' },
      reason: 'test',
      reply: 'calling mcp',
      done: false,
    })
    const r = suggestCommandFromRaw(raw)
    expect(r.mcp).toBe(true)
    expect(r.mcpServer).toBe('srv1')
    expect(r.mcpTool).toBe('write_note')
    expect(r.mcpArguments).toEqual({ path: '/tmp/a' })
    expect(r.command).toContain('mcp:srv1/write_note')
    expect(r.done).toBe(false)
  })

  it('parses session tool still', () => {
    const raw = JSON.stringify({
      tool: 'list_files',
      path: '/tmp',
      reason: 'ls',
      reply: 'listing',
      done: false,
    })
    const r = suggestCommandFromRaw(raw)
    expect(r.tool).toBe('list_files')
    expect(r.mcp).toBeFalsy()
  })
})

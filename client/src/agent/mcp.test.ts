import { describe, expect, it } from 'vitest'
import {
  buildMcpToolsPrompt,
  formatMcpDisplay,
  isTauriRuntime,
  looksMutating,
  mcpToolRisk,
  validateMcpCommand,
  type McpConnectionState,
} from './mcp'

describe('mcp helpers', () => {
  it('builds empty prompt when no tools', () => {
    expect(buildMcpToolsPrompt([])).toBe('')
  })

  it('lists tools with mutating marker', () => {
    const states: McpConnectionState[] = [
      {
        serverId: 's1',
        status: 'connected',
        tools: [
          { serverId: 's1', name: 'read_thing', description: 'read', mutating: false },
          { serverId: 's1', name: 'write_thing', description: 'write', mutating: true },
        ],
      },
    ]
    const p = buildMcpToolsPrompt(states)
    expect(p).toContain('mcp:s1/read_thing')
    expect(p).toContain('[mutating→Approve]')
  })

  it('classifies mutating risk', () => {
    expect(looksMutating('write_file')).toBe(true)
    expect(looksMutating('list_dir', 'list files')).toBe(false)
    expect(mcpToolRisk({ name: 'write_x', mutating: true })).toBe('high')
    expect(mcpToolRisk({ name: 'list_x', description: 'list things', mutating: false })).toBe('low')
    expect(mcpToolRisk({ name: 'do_stuff', description: 'misc', mutating: false })).toBe('medium')
  })

  it('formats display command', () => {
    expect(formatMcpDisplay('a', 'b', { x: 1 })).toContain('mcp:a/b')
  })

  it('isTauriRuntime is false under vitest/node', () => {
    expect(isTauriRuntime()).toBe(false)
  })
})

  it('validateMcpCommand rejects shell metacharacters', () => {
    expect(validateMcpCommand('')).toBeTruthy()
    expect(validateMcpCommand('npx;rm')).toBeTruthy()
    expect(validateMcpCommand('npx')).toBeNull()
    expect(validateMcpCommand('/usr/local/bin/mcp-server')).toBeNull()
  })

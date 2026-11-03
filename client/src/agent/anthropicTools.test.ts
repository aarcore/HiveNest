import { describe, expect, it } from 'vitest'
import { toolUseToSuggestion } from './anthropicTools'

describe('toolUseToSuggestion', () => {
  it('maps list_files tool_use to structured suggestion', () => {
    const s = toolUseToSuggestion('tu_1', 'list_files', { path: '/var/log' }, 'checking logs', '{}')
    expect(s.done).toBe(false)
    expect(s.tool).toBe('list_files')
    expect(s.path).toBe('/var/log')
    expect(s.toolUseId).toBe('tu_1')
  })

  it('maps run_shell_command to command', () => {
    const s = toolUseToSuggestion(
      'tu_2',
      'run_shell_command',
      { command: 'uptime', reason: 'load' },
      '',
      '{}',
    )
    expect(s.command).toBe('uptime')
    expect(s.done).toBe(false)
  })
})

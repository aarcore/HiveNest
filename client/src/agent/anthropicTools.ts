import {
  getProviderApiStyle,
  toolRisk,
  toolToCommand,
  type SuggestCommandResult,
  type ToolCallArgs,
} from '../settings/llm'
import type { ProviderConfig } from '../settings/types'

export type AnthropicToolDef = {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

export const AGENT_SYSTEM_NATIVE = `You are a careful Linux/Unix sysadmin assistant inside Hive Nest.
You manage ONE remote SSH session. Use the provided tools to inspect and change the host.
Prefer structured tools (list_files, read_file, stat_path, disk_free, list_processes) over shell when possible.
Use run_shell_command only when no tool fits. One tool call per turn.
When the task is complete, respond with a short summary in plain text and do not call any tool.`

/** Anthropic Messages API tool definitions (sessiond-backed tools + shell). */
export const HIVE_AGENT_ANTHROPIC_TOOLS: AnthropicToolDef[] = [
  {
    name: 'list_files',
    description: 'List directory entries on the remote host (SFTP).',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Absolute or home-relative directory path' } },
      required: ['path'],
    },
  },
  {
    name: 'read_file',
    description: 'Read up to 64KiB from a remote file.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'stat_path',
    description: 'Stat a remote path.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'disk_free',
    description: 'Show disk usage (df). Optional path for one mount.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Optional mount path' } },
    },
  },
  {
    name: 'list_processes',
    description: 'List processes (ps auxww). Optional user/pattern filters.',
    input_schema: {
      type: 'object',
      properties: {
        user: { type: 'string' },
        pattern: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'write_file',
    description: 'Write file content (requires user approval).',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'mkdir',
    description: 'Create directory (requires approval).',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'remove_file',
    description: 'Delete a file (high risk, requires approval).',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'rmdir',
    description: 'Remove empty directory (high risk, requires approval).',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'run_shell_command',
    description: 'Run a single non-interactive shell command on the remote host.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Single safe shell command' },
        reason: { type: 'string' },
      },
      required: ['command'],
    },
  },
]

export function supportsNativeAnthropicTools(provider: ProviderConfig): boolean {
  return getProviderApiStyle(provider) === 'anthropic'
}

export function toolUseToSuggestion(
  toolUseId: string,
  name: string,
  input: Record<string, unknown>,
  assistantText: string,
  raw: string,
): SuggestCommandResult {
  if (name === 'run_shell_command') {
    const command = String(input.command || '').trim()
    return {
      command: command || 'true',
      reason: String(input.reason || 'shell'),
      assistantText,
      done: !command,
      raw,
      toolUseId,
    }
  }

  const args: ToolCallArgs = {
    path: input.path != null ? String(input.path) : undefined,
    pattern: input.pattern != null ? String(input.pattern) : undefined,
    content: input.content != null ? String(input.content) : undefined,
    user: input.user != null ? String(input.user) : undefined,
    limit: typeof input.limit === 'number' ? input.limit : undefined,
  }
  const mapped = toolToCommand(name, args)
  return {
    command: mapped || 'true',
    reason: `tool ${name}`,
    assistantText,
    done: !mapped,
    raw,
    tool: mapped ? name : undefined,
    path: args.path,
    pattern: args.pattern,
    content: args.content,
    user: args.user,
    limit: args.limit,
    toolUseId,
  }
}

export function toolRiskForName(name: string): 'low' | 'medium' | 'high' {
  if (name === 'run_shell_command') return 'medium'
  return toolRisk(name)
}

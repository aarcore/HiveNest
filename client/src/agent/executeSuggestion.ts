import {
  execCommand,
  runSessionTool,
  type ExecResult,
  type SessionInfo,
  type SessionToolBody,
} from '../api'
import { isWriteTool, toolRisk, type SuggestCommandResult } from '../settings/llm'
import {
  callMcpTool,
  findMcpTool,
  formatMcpDisplay,
  loadMcpServers,
  mcpToolRisk,
  type McpConnectionState,
  type PendingMcpCall,
} from './mcp'

export type ExecuteSuggestionOutcome =
  | { type: 'executed'; exec: ExecResult; ranCommand: string; fallbackNote?: string }
  | {
      type: 'approval_required'
      displayCommand: string
      reason: string
      risk: 'low' | 'medium' | 'high'
      pendingTool: SessionToolBody | null
      pendingMcp: PendingMcpCall | null
    }
  | { type: 'error'; message: string }
  | { type: 'skipped' }

function toolBodyFromSuggestion(result: SuggestCommandResult): SessionToolBody {
  return {
    tool: result.tool || '',
    path: result.path,
    pattern: result.pattern,
    content: result.content,
    user: result.user,
    limit: result.limit,
    actor: 'agent',
  }
}

/** Run one model-suggested action (session tool, MCP, or shell). */
export async function executeSuggestion(
  session: SessionInfo,
  result: SuggestCommandResult,
  mcpStates: McpConnectionState[],
): Promise<ExecuteSuggestionOutcome> {
  try {
    if (result.mcp && result.mcpServer && result.mcpTool) {
      const serverId = result.mcpServer
      const toolName = result.mcpTool
      const args = result.mcpArguments || {}
      const server = loadMcpServers().find((s) => s.id === serverId)
      if (!server) {
        return { type: 'error', message: `Unknown MCP server: ${serverId}` }
      }
      const known = findMcpTool(mcpStates, serverId, toolName)
      const risk = known ? mcpToolRisk(known) : ('medium' as const)
      const display = formatMcpDisplay(serverId, toolName, args)
      if (risk !== 'low') {
        return {
          type: 'approval_required',
          displayCommand: display,
          reason: result.reason || `MCP ${toolName}`,
          risk,
          pendingTool: null,
          pendingMcp: {
            serverId,
            tool: toolName,
            arguments: args,
            mutating: known ? known.mutating : true,
            displayCommand: display,
          },
        }
      }
      const call = await callMcpTool(server, toolName, args)
      return {
        type: 'executed',
        ranCommand: display,
        exec: {
          command: display,
          stdout: call.ok ? call.content : '',
          stderr: call.ok ? '' : call.content,
          exit_code: call.ok ? 0 : 1,
          risk: 'low',
          duration_ms: 0,
        },
      }
    }

    if (result.tool) {
      const body = toolBodyFromSuggestion(result)
      try {
        const toolRes = await runSessionTool(session.id, body)
        return {
          type: 'executed',
          ranCommand: result.command || result.tool,
          exec: {
            command: result.command || result.tool,
            stdout: toolRes.summary || '',
            stderr: toolRes.ok ? '' : toolRes.error || '',
            exit_code: toolRes.ok ? 0 : 1,
            risk: toolRes.risk || 'low',
            duration_ms: toolRes.duration_ms,
          },
        }
      } catch (toolEx: unknown) {
        const ex = toolEx as { status?: number; body?: { code?: string; command?: string; risk?: string }; message?: string }
        if (ex.status === 409 || ex.body?.code === 'approval_required') {
          const displayCmd = (ex.body?.command as string) || result.command
          const risk = (ex.body?.risk as 'low' | 'medium' | 'high') || toolRisk(result.tool)
          return {
            type: 'approval_required',
            displayCommand: displayCmd,
            reason: result.reason || `Tool ${result.tool}`,
            risk,
            pendingTool: body,
            pendingMcp: null,
          }
        }
        if (isWriteTool(result.tool)) {
          return { type: 'error', message: ex.message || String(toolEx) }
        }
        const exec = await execCommand(session.id, {
          command: result.command,
          actor: 'agent',
        })
        return {
          type: 'executed',
          ranCommand: result.command,
          exec,
          fallbackNote: ex.message || String(toolEx),
        }
      }
    }

    const exec = await execCommand(session.id, { command: result.command, actor: 'agent' })
    return { type: 'executed', ranCommand: result.command, exec }
  } catch (ex: unknown) {
    const e = ex as { status?: number; body?: { code?: string; risk?: string }; message?: string }
    if (e.status === 409 || e.body?.code === 'approval_required') {
      return {
        type: 'approval_required',
        displayCommand: result.command,
        reason: result.reason || 'Needs approval',
        risk: (e.body?.risk as 'low' | 'medium' | 'high') || 'medium',
        pendingTool: null,
        pendingMcp: null,
      }
    }
    return { type: 'error', message: e.message || String(ex) }
  }
}

export function stepLabel(result: SuggestCommandResult): string {
  if (result.mcp && result.mcpServer && result.mcpTool) {
    return formatMcpDisplay(result.mcpServer, result.mcpTool, result.mcpArguments)
  }
  if (result.tool) {
    return `${result.tool}${result.path ? ` ${result.path}` : ''}${result.pattern ? ` ~${result.pattern}` : ''}`
  }
  return result.command
}

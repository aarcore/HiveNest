/**
 * Tool-use agent loop for Hive Nest.
 *
 * Mirrors Claude Agent SDK core cycle (without bundling the SDK binary):
 * 1. Model evaluates state and may request tools (JSON protocol or Anthropic tool_use).
 * 2. Runtime executes tools and collects results.
 * 3. Results are fed back to the model automatically in the same user turn.
 * 4. Repeats until the model signals done (no further tools) or max steps.
 *
 * @see https://code.claude.com/docs/en/agent-sdk/agent-loop
 */

import type { AgentEvent } from './events'
import { executeSuggestion, stepLabel } from './executeSuggestion'
import { agentContinueModelTurn, agentUserModelTurn } from './modelTurn'
import type { AgentLoopContext, AgentLoopState, AgentLoopStatus } from './types'
import type { ExecResult } from '../api'
import type { SuggestCommandResult } from '../settings/llm'

export type AgentEventSink = (event: AgentEvent) => void

function appendExecToHistory(
  ctx: AgentLoopContext,
  ranCommand: string,
  exec: ExecResult,
): void {
  const next = [
    ...ctx.getHistory(),
    { role: 'user' as const, content: `Ran command: ${ranCommand}` },
    {
      role: 'assistant' as const,
      content: `Exit ${exec.exit_code}\n${exec.stdout || ''}${exec.stderr || ''}`.slice(0, 4000),
    },
  ]
  ctx.setHistory(next)
}

function bridgeCallbacks(ctx: AgentLoopContext, emit?: AgentEventSink) {
  const cb = ctx.callbacks
  return {
    user: (text: string) => {
      cb.onUserMessage?.(text)
      emit?.({ type: 'user', text })
    },
    assistant: (text: string) => {
      cb.onAssistantMessage(text)
      emit?.({ type: 'assistant', text })
    },
    step: (step: number, label: string) => {
      cb.onStep(step, label)
      emit?.({ type: 'step', step, label })
      emit?.({ type: 'tool_exec_start', label })
    },
    result: (result: ExecResult) => {
      cb.onExecResult(result)
      emit?.({ type: 'tool_result', result })
    },
    note: (text: string) => {
      cb.onNote(text)
      emit?.({ type: 'note', text })
    },
    error: (message: string) => {
      cb.onError(message)
      emit?.({ type: 'error', message })
    },
    done: () => {
      cb.onDone()
      emit?.({ type: 'done' })
    },
    maxSteps: () => {
      cb.onMaxSteps()
      emit?.({ type: 'max_steps' })
    },
  }
}

async function* iterateAgentToolLoop(
  ctx: AgentLoopContext,
  state: AgentLoopState,
  initial: SuggestCommandResult,
  emit?: AgentEventSink,
): AsyncGenerator<AgentEvent, AgentLoopStatus> {
  const ui = bridgeCallbacks(ctx, emit)
  const { labels } = ctx
  let result = initial

  while (!ctx.getStopRequested() && state.step < ctx.maxSteps) {
    if (result.done || !result.command || result.command === 'true') {
      ui.done()
      yield { type: 'turn_end', phase: 'completed' }
      return { phase: 'completed' }
    }

    state.step += 1
    if (result.toolUseId) {
      state.pendingToolUseId = result.toolUseId
    }
    const label = stepLabel(result)
    ui.step(state.step, label)

    const outcome = await executeSuggestion(ctx.session, result, ctx.mcpStates)

    if (outcome.type === 'approval_required') {
      state.pendingTool = outcome.pendingTool
      state.pendingMcp = outcome.pendingMcp
      ui.note(`${labels.approvalRequired} (${outcome.risk}) — ${labels.awaitingApproval}`)
      const proposal = await ctx.propose(outcome.displayCommand, outcome.reason, outcome.risk)
      if (!proposal) {
        yield { type: 'turn_end', phase: 'error' }
        return { phase: 'error', message: 'Failed to create approval proposal' }
      }
      yield { type: 'proposal', proposal }
      yield { type: 'turn_end', phase: 'awaiting_permission' }
      return { phase: 'awaiting_permission', proposal }
    }

    if (outcome.type === 'error') {
      ui.error(outcome.message)
      yield { type: 'turn_end', phase: 'error' }
      return { phase: 'error', message: outcome.message }
    }

    if (outcome.type === 'skipped') {
      break
    }

    const { exec, ranCommand, fallbackNote } = outcome
    if (fallbackNote) {
      ui.note(`${labels.agentToolFallback}: ${fallbackNote}`)
    }
    ui.result(exec)
    if (result.tool && !fallbackNote) {
      ui.note(labels.agentToolNative)
    } else if (result.mcp) {
      ui.note(`MCP ${result.mcpServer}/${result.mcpTool}`)
    }
    appendExecToHistory(ctx, ranCommand, exec)

    if (ctx.getStopRequested()) {
      yield { type: 'turn_end', phase: 'stopped' }
      return { phase: 'stopped' }
    }

    yield { type: 'model_request' }
    const cont = await agentContinueModelTurn(
      ctx.provider,
      state,
      ctx.getHistory(),
      exec,
      ctx.sessionContext(),
      ctx.extraSystem(),
    )
    yield { type: 'model_response', mode: cont.mode }
    ctx.setHistory(cont.nextHistory)
    ui.assistant(cont.result.assistantText || cont.result.reason)
    result = cont.result
  }

  if (state.step >= ctx.maxSteps && !result.done) {
    ui.maxSteps()
  }
  const phase = ctx.getStopRequested() ? 'stopped' : 'completed'
  yield { type: 'turn_end', phase: phase === 'stopped' ? 'stopped' : 'completed' }
  return { phase }
}

async function drainToolLoop(
  ctx: AgentLoopContext,
  state: AgentLoopState,
  initial: SuggestCommandResult,
  emit?: AgentEventSink,
): Promise<AgentLoopStatus> {
  const gen = iterateAgentToolLoop(ctx, state, initial, emit)
  let next = await gen.next()
  while (!next.done) {
    emit?.(next.value)
    next = await gen.next()
  }
  return next.value
}

export async function runAgentToolLoop(
  ctx: AgentLoopContext,
  state: AgentLoopState,
  initial: SuggestCommandResult,
  emit?: AgentEventSink,
): Promise<AgentLoopStatus> {
  return drainToolLoop(ctx, state, initial, emit)
}

export async function* streamAgentToolLoop(
  ctx: AgentLoopContext,
  state: AgentLoopState,
  initial: SuggestCommandResult,
): AsyncGenerator<AgentEvent, AgentLoopStatus> {
  return yield* iterateAgentToolLoop(ctx, state, initial)
}

async function* iterateAgentUserTurn(
  ctx: AgentLoopContext,
  state: AgentLoopState,
  userPrompt: string,
): AsyncGenerator<AgentEvent, AgentLoopStatus> {
  state.step = 0
  state.pendingTool = null
  state.pendingMcp = null
  state.pendingToolUseId = null

  const ui = bridgeCallbacks(ctx)
  yield { type: 'turn_start', prompt: userPrompt }
  ui.user(userPrompt)

  yield { type: 'model_request' }
  const first = await agentUserModelTurn(
    ctx.provider,
    state,
    ctx.getHistory(),
    userPrompt,
    ctx.sessionContext(),
    ctx.extraSystem(),
  )
  yield { type: 'model_response', mode: first.mode }
  ctx.setHistory(first.nextHistory)
  ui.assistant(first.result.assistantText || first.result.reason)

  return yield* iterateAgentToolLoop(ctx, state, first.result)
}

export async function runAgentUserTurn(
  ctx: AgentLoopContext,
  state: AgentLoopState,
  userPrompt: string,
  emit?: AgentEventSink,
): Promise<AgentLoopStatus> {
  const gen = iterateAgentUserTurn(ctx, state, userPrompt)
  let next = await gen.next()
  while (!next.done) {
    emit?.(next.value)
    next = await gen.next()
  }
  return next.value
}

/** SDK-style stream: `for await (const ev of streamAgentUserTurn(...)) { ... }` */
export async function* streamAgentUserTurn(
  ctx: AgentLoopContext,
  state: AgentLoopState,
  userPrompt: string,
): AsyncGenerator<AgentEvent, AgentLoopStatus> {
  return yield* iterateAgentUserTurn(ctx, state, userPrompt)
}

async function* iterateResumeAgentToolLoop(
  ctx: AgentLoopContext,
  state: AgentLoopState,
  execResult: ExecResult,
  approvedCommand: string,
): AsyncGenerator<AgentEvent, AgentLoopStatus> {
  state.step = 0
  state.pendingTool = null
  state.pendingMcp = null

  const nextHist = [
    ...ctx.getHistory(),
    { role: 'user' as const, content: `Approved and ran: ${approvedCommand}` },
    {
      role: 'assistant' as const,
      content: `Exit ${execResult.exit_code}\n${execResult.stdout || ''}${execResult.stderr || ''}`.slice(
        0,
        4000,
      ),
    },
  ]
  ctx.setHistory(nextHist)

  const ui = bridgeCallbacks(ctx)
  yield { type: 'model_request' }
  const cont = await agentContinueModelTurn(
    ctx.provider,
    state,
    ctx.getHistory(),
    execResult,
    ctx.sessionContext(),
    ctx.extraSystem(),
  )
  yield { type: 'model_response', mode: cont.mode }
  ctx.setHistory(cont.nextHistory)
  ui.assistant(cont.result.assistantText || cont.result.reason)

  return yield* iterateAgentToolLoop(ctx, state, cont.result)
}

export async function resumeAgentToolLoop(
  ctx: AgentLoopContext,
  state: AgentLoopState,
  execResult: ExecResult,
  approvedCommand: string,
  emit?: AgentEventSink,
): Promise<AgentLoopStatus> {
  const gen = iterateResumeAgentToolLoop(ctx, state, execResult, approvedCommand)
  let next = await gen.next()
  while (!next.done) {
    emit?.(next.value)
    next = await gen.next()
  }
  return next.value
}

export async function* streamAgentResume(
  ctx: AgentLoopContext,
  state: AgentLoopState,
  execResult: ExecResult,
  approvedCommand: string,
): AsyncGenerator<AgentEvent, AgentLoopStatus> {
  return yield* iterateResumeAgentToolLoop(ctx, state, execResult, approvedCommand)
}

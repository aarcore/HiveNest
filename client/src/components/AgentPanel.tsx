import { useEffect, useRef, useState } from 'react'
import {
  approveProposal,
  createProposal,
  denyProposal,
  execCommand,
  runSessionTool,
  type ExecResult,
  type Proposal,
  type SessionInfo,
  type SessionToolBody,
} from '../api'
import { useI18n } from '../i18n'
import type { ChatMessage } from '../settings/llm'
import { useSettings } from '../settings/SettingsContext'
import { buildSkillsPrompt } from '../agent/skills'
import { loadSkillsSettings } from '../agent/skillsStorage'
import {
  agentChatHostKey,
  clearAgentChatHistory,
  DEFAULT_AGENT_MAX_STEPS,
  loadAgentChatHistory,
  listAgentChatHistoryIndex,
  resumeAgentToolLoop,
  saveAgentChatHistory,
  streamAgentUserTurn,
  type AgentChatLine,
  type AgentLoopContext,
  type AgentLoopState,
} from '../agent'
import {
  loadMcpServers,
  probeMcpServer,
  buildMcpToolsPrompt,
  callMcpTool,
  type McpConnectionState,
  type PendingMcpCall,
} from '../agent/mcp'
import { PROVIDER_META } from '../settings/types'
import {
  IconButton,
  IconCheck,
  IconClear,
  IconHistory,
  IconPanelBottom,
  IconPanelRight,
  IconSend,
  IconStop,
  IconTerminal,
  IconX,
} from './icons'

export type AgentDock = 'right' | 'bottom'

type Props = {
  session: SessionInfo | null
  collapsed: boolean
  dock?: AgentDock
  onToggleDock?: () => void
}

type ChatLine = AgentChatLine

export function AgentPanel({ session, collapsed, dock = 'right', onToggleDock }: Props) {
  const { t, locale } = useI18n()
  const { activeProvider } = useSettings()
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [looping, setLooping] = useState(false)
  const [lines, setLines] = useState<ChatLine[]>([])
  const [history, setHistory] = useState<ChatMessage[]>([])
  const [active, setActive] = useState<Proposal | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyPreviewKey, setHistoryPreviewKey] = useState<string | null>(null)
  const [historyPreviewLines, setHistoryPreviewLines] = useState<ChatLine[]>([])
  const logRef = useRef<HTMLDivElement>(null)
  const hostKeyRef = useRef<string | null>(null)
  const stopRef = useRef(false)
  const historyRef = useRef<ChatMessage[]>([])
  const loopStateRef = useRef<AgentLoopState>({
    step: 0,
    pendingTool: null,
    pendingMcp: null,
    anthropicTranscript: null,
    useNativeTools: false,
    pendingToolUseId: null,
  })
  /** Track IME composition; WKWebView isComposing on Enter is unreliable. */
  const composingRef = useRef(false)
  const inputRef = useRef(input)
  inputRef.current = input
  const busyRef = useRef(busy)
  busyRef.current = busy
  /** When a medium/high tool hits Approve, keep args so onApprove re-runs via /tools. */
  const pendingToolRef = useRef<SessionToolBody | null>(null)
  const pendingMcpRef = useRef<PendingMcpCall | null>(null)
  const mcpStatesRef = useRef<McpConnectionState[]>([])

  function buildExtraSystem(): string {
    const skills = buildSkillsPrompt(loadSkillsSettings())
    const mcp = buildMcpToolsPrompt(mcpStatesRef.current)
    return [skills, mcp].filter(Boolean).join('\n\n')
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const servers = loadMcpServers().filter((s) => s.enabled)
      const states: McpConnectionState[] = []
      for (const s of servers) {
        states.push(await probeMcpServer(s))
      }
      if (!cancelled) mcpStatesRef.current = states
    })()
    return () => {
      cancelled = true
    }
  }, [session?.id])


  useEffect(() => {
    historyRef.current = history
  }, [history])

  function providerHeaderNote(): string {
    return activeProvider
      ? `${t('agentProviderReady')}: ${
          locale.startsWith('zh')
            ? PROVIDER_META[activeProvider.id].labelZh
            : PROVIDER_META[activeProvider.id].label
        } / ${activeProvider.defaultModel}`
      : t('agentProviderMissing')
  }

  function sessionHeaderNote(): string {
    return session ? `${t('agentSessionBound')}: ${session.remote}` : t('noSession')
  }

  function headerLines(): ChatLine[] {
    return [
      { kind: 'note', text: providerHeaderNote() },
      { kind: 'note', text: sessionHeaderNote() },
    ]
  }

  function linesForStorage(all: ChatLine[]): ChatLine[] {
    let start = 0
    if (all[0]?.kind === 'note' && all[1]?.kind === 'note') start = 2
    if (
      all[start]?.kind === 'note' &&
      (all[start] as { kind: 'note'; text: string }).text === t('agentHistoryRestored')
    ) {
      start += 1
    }
    return all.slice(start)
  }

  const currentHostKey = session ? agentChatHostKey(session.host_id, session.id) : null

  useEffect(() => {
    const hostKey = currentHostKey
    const label = providerHeaderNote()
    const sessionNote = sessionHeaderNote()

    if (hostKeyRef.current !== hostKey) {
      hostKeyRef.current = hostKey
      stopRef.current = true
      setLooping(false)
      setActive(null)
      pendingToolRef.current = null
      pendingMcpRef.current = null
      setHistoryPreviewKey(null)
      setHistoryPreviewLines([])
      setHistoryOpen(false)

      if (!hostKey) {
        setHistory([])
        historyRef.current = []
        loopStateRef.current = {
          step: 0,
          pendingTool: null,
          pendingMcp: null,
          anthropicTranscript: null,
          useNativeTools: false,
          pendingToolUseId: null,
        }
        setLines(headerLines())
        return
      }

      const snap = loadAgentChatHistory(hostKey)
      if (snap && (snap.lines.length > 0 || snap.history.length > 0)) {
        setHistory(snap.history)
        historyRef.current = snap.history
        loopStateRef.current = {
          step: 0,
          pendingTool: null,
          pendingMcp: null,
          anthropicTranscript: snap.loopState.anthropicTranscript,
          useNativeTools: snap.loopState.useNativeTools,
          pendingToolUseId: null,
        }
        setLines([
          { kind: 'note', text: label },
          { kind: 'note', text: sessionNote },
          { kind: 'note', text: t('agentHistoryRestored') },
          ...snap.lines,
        ])
      } else {
        setHistory([])
        historyRef.current = []
        loopStateRef.current = {
          step: 0,
          pendingTool: null,
          pendingMcp: null,
          anthropicTranscript: null,
          useNativeTools: false,
          pendingToolUseId: null,
        }
        setLines(headerLines())
      }
      return
    }

    setLines((prev) => {
      if (!prev.length) return headerLines()
      const rest = prev.slice(2)
      return [{ kind: 'note', text: label }, { kind: 'note', text: sessionNote }, ...rest]
    })
  }, [currentHostKey, session?.remote, activeProvider, locale, t])

  useEffect(() => {
    if (!currentHostKey || historyPreviewKey || busy) return
    const stored = linesForStorage(lines)
    if (!stored.length && !history.length) return
    const tmr = window.setTimeout(() => {
      saveAgentChatHistory(currentHostKey, {
        lines: stored,
        history,
        loopState: loopStateRef.current,
      })
    }, 400)
    return () => window.clearTimeout(tmr)
  }, [lines, history, currentHostKey, historyPreviewKey, busy])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [lines])

  function push(line: ChatLine) {
    setLines((prev) => [...prev, line])
  }

  function stopLoop() {
    stopRef.current = true
    setLooping(false)
    push({ kind: 'note', text: t('agentStopped') })
  }

  function sessionCtx() {
    return session ? `${session.remote} (session ${session.id})` : undefined
  }

  async function propose(
    cmd: string,
    why?: string,
    risk?: 'low' | 'medium' | 'high',
  ): Promise<Proposal | null> {
    if (!session) return null
    const command = cmd.trim()
    if (!command || command === 'true') return null
    const p = await createProposal(
      session.id,
      command,
      why || 'Agent assist on current host',
      risk,
    )
    setActive(p)
    push({ kind: 'proposal', proposal: p })
    return p
  }

  function syncLoopPendingRefs() {
    pendingToolRef.current = loopStateRef.current.pendingTool
    pendingMcpRef.current = loopStateRef.current.pendingMcp
  }

  function buildAgentLoopContext(): AgentLoopContext | null {
    if (!session || !activeProvider) return null
    return {
      session,
      provider: activeProvider,
      maxSteps: DEFAULT_AGENT_MAX_STEPS,
      getStopRequested: () => stopRef.current,
      sessionContext: sessionCtx,
      extraSystem: buildExtraSystem,
      mcpStates: mcpStatesRef.current,
      getHistory: () => historyRef.current,
      setHistory: (h) => {
        setHistory(h)
        historyRef.current = h
      },
      propose,
      callbacks: {
        onUserMessage: (text) => push({ kind: 'user', text }),
        onAssistantMessage: (text) => push({ kind: 'assistant', text }),
        onStep: (step, label) => push({ kind: 'note', text: `${t('agentStep')} ${step}: ${label}` }),
        onExecResult: (result) => push({ kind: 'result', result }),
        onNote: (text) => push({ kind: 'note', text }),
        onError: (message) => push({ kind: 'error', text: message }),
        onDone: () => push({ kind: 'note', text: t('agentDone') }),
        onMaxSteps: () => push({ kind: 'note', text: t('agentMaxSteps') }),
      },
      labels: {
        agentDone: t('agentDone'),
        agentStep: t('agentStep'),
        approvalRequired: t('approvalRequired'),
        awaitingApproval: t('awaitingApproval'),
        agentToolNative: t('agentToolNative'),
        agentToolFallback: t('agentToolFallback'),
      },
    }
  }

  async function askModel(prompt: string) {
    const ctx = buildAgentLoopContext()
    if (!ctx) return
    const text = prompt.trim()
    if (!text) return
    stopRef.current = false
    setBusy(true)
    setLooping(true)
    try {
      const gen = streamAgentUserTurn(ctx, loopStateRef.current, text)
      let status = await gen.next()
      while (!status.done) {
        status = await gen.next()
      }
      syncLoopPendingRefs()
      const final = status.value
      if (final.phase === 'awaiting_permission') {
        setBusy(false)
        return
      }
    } catch (ex: unknown) {
      const msg = ex instanceof Error ? ex.message : String(ex)
      push({ kind: 'error', text: msg })
    } finally {
      setBusy(false)
      setLooping(false)
    }
  }

  async function runLow(cmd: string) {
    if (!session) return
    setBusy(true)
    push({ kind: 'user', text: `$ ${cmd}` })
    try {
      const result = await execCommand(session.id, { command: cmd, actor: 'agent' })
      push({ kind: 'result', result })
      const nextHist: ChatMessage[] = [
        ...historyRef.current,
        { role: 'user', content: `Ran command: ${cmd}` },
        {
          role: 'assistant',
          content: `Exit ${result.exit_code}\n${result.stdout || ''}${result.stderr || ''}`.slice(0, 4000),
        },
      ]
      setHistory(nextHist)
      historyRef.current = nextHist
    } catch (ex: any) {
      if (ex.status === 409 || ex.body?.code === 'approval_required') {
        push({
          kind: 'note',
          text: `${t('approvalRequired')} (${ex.body?.risk || 'medium'})`,
        })
        await propose(cmd, 'Auto-proposed after approval_required')
      } else {
        push({ kind: 'error', text: ex.message || String(ex) })
      }
    } finally {
      setBusy(false)
    }
  }

  async function onApprove(p: Proposal) {
    if (!session) return
    setBusy(true)
    stopRef.current = false
    try {
      const approved = await approveProposal(p.id)
      setActive(approved)
      push({ kind: 'note', text: `${t('approved')}: ${approved.command}` })
      let result: ExecResult
      const pendingMcp = pendingMcpRef.current
      const pending = pendingToolRef.current
      if (pendingMcp) {
        const server = loadMcpServers().find((s) => s.id === pendingMcp.serverId)
        if (!server) {
          throw new Error(`Unknown MCP server: ${pendingMcp.serverId}`)
        }
        const call = await callMcpTool(server, pendingMcp.tool, pendingMcp.arguments)
        pendingMcpRef.current = null
        result = {
          command: pendingMcp.displayCommand || approved.command,
          stdout: call.ok ? call.content : '',
          stderr: call.ok ? '' : call.content,
          exit_code: call.ok ? 0 : 1,
          risk: approved.risk || (pendingMcp.mutating ? 'high' : 'medium'),
          duration_ms: 0,
        }
        push({
          kind: 'note',
          text: `MCP ${pendingMcp.serverId}/${pendingMcp.tool}`,
        })
      } else if (pending && pending.tool) {
        const toolRes = await runSessionTool(session.id, {
          ...pending,
          proposal_id: approved.id,
          approve_token: approved.approve_token,
          actor: 'agent',
        })
        pendingToolRef.current = null
        result = {
          command: approved.command,
          stdout: toolRes.summary || '',
          stderr: toolRes.ok ? '' : toolRes.error || '',
          exit_code: toolRes.ok ? 0 : 1,
          risk: toolRes.risk || approved.risk || 'medium',
          duration_ms: toolRes.duration_ms,
        }
        push({
          kind: 'note',
          text: `${t('agentToolNative')} (${toolRes.via || 'tools'})`,
        })
      } else {
        result = await execCommand(session.id, {
          command: approved.command,
          proposal_id: approved.id,
          approve_token: approved.approve_token,
          actor: 'agent',
        })
      }
      push({ kind: 'result', result })
      setActive({ ...approved, status: 'consumed' })
      const nextHist: ChatMessage[] = [
        ...historyRef.current,
        { role: 'user', content: `Approved and ran: ${approved.command}` },
        {
          role: 'assistant',
          content: `Exit ${result.exit_code}\n${result.stdout || ''}${result.stderr || ''}`.slice(0, 4000),
        },
      ]
      setHistory(nextHist)
      historyRef.current = nextHist
      setBusy(false)
      const ctx = buildAgentLoopContext()
      if (ctx) {
        setLooping(true)
        try {
          const status = await resumeAgentToolLoop(ctx, loopStateRef.current, result, approved.command)
          syncLoopPendingRefs()
          if (status.phase === 'awaiting_permission') {
            setBusy(false)
            return
          }
        } catch (ex: unknown) {
          const msg = ex instanceof Error ? ex.message : String(ex)
          push({ kind: 'error', text: msg })
        } finally {
          setBusy(false)
          setLooping(false)
        }
      }
    } catch (ex: any) {
      push({ kind: 'error', text: ex.message || String(ex) })
      setBusy(false)
      setLooping(false)
    }
  }

  async function onDeny(p: Proposal) {
    setBusy(true)
    stopRef.current = true
    setLooping(false)
    pendingToolRef.current = null
    pendingMcpRef.current = null
    try {
      const denied = await denyProposal(p.id)
      setActive(denied)
      push({ kind: 'note', text: `${t('denied')}: ${denied.command}` })
      const nextHist: ChatMessage[] = [
        ...historyRef.current,
        { role: 'user', content: `Denied command: ${denied.command}` },
        { role: 'assistant', content: 'Understood — command was not executed. Stopping.' },
      ]
      setHistory(nextHist)
      historyRef.current = nextHist
    } catch (ex: any) {
      push({ kind: 'error', text: ex.message || String(ex) })
    } finally {
      setBusy(false)
    }
  }

  function clearChat() {
    stopRef.current = true
    setLooping(false)
    setHistory([])
    historyRef.current = []
    setActive(null)
    pendingToolRef.current = null
    setHistoryPreviewKey(null)
    setHistoryPreviewLines([])
    if (currentHostKey) clearAgentChatHistory(currentHostKey)
    loopStateRef.current = {
      step: 0,
      pendingTool: null,
      pendingMcp: null,
      anthropicTranscript: null,
      useNativeTools: false,
      pendingToolUseId: null,
    }
    setLines(headerLines())
  }

  function openHistoryPreview(hostKey: string) {
    if (hostKey === currentHostKey) {
      setHistoryPreviewKey(null)
      setHistoryPreviewLines([])
      setHistoryOpen(false)
      return
    }
    const snap = loadAgentChatHistory(hostKey)
    setHistoryPreviewKey(hostKey)
    setHistoryPreviewLines(snap?.lines ?? [])
    setHistoryOpen(false)
  }

  function closeHistoryPreview() {
    setHistoryPreviewKey(null)
    setHistoryPreviewLines([])
  }

  const historyIndex = listAgentChatHistoryIndex()
  const displayLines = historyPreviewKey
    ? [
        { kind: 'note' as const, text: t('agentHistoryViewing') },
        ...historyPreviewLines,
      ]
    : lines

  const providerStatusLabel = activeProvider
    ? `${t('configured')}: ${
        locale.startsWith('zh')
          ? PROVIDER_META[activeProvider.id].labelZh
          : PROVIDER_META[activeProvider.id].label
      }`
    : t('notConfigured')
  const sessionTitle = session
    ? session.host_name || session.remote || session.id
    : t('noSession')
  const sessionRemote = session?.remote || '—'

  if (collapsed) {
    /* No right rail — terminal goes flush; fold lives in app-topbar. */
    return null
  }

  return (
    <aside className="pane agent-pane">
      <header className="pane-header agent-pane-header">
        <div className="pane-header-main">
          <strong className="text-ellipsis agent-title" title={t('agent')}>
            {t('agent')}
          </strong>
          <span
            className="agent-run-status"
            title={providerStatusLabel}
            aria-label={`${busy || looping ? t('agentRunning') : t('agentIdle')}. ${providerStatusLabel}`}
          >
            {busy || looping ? t('agentRunning') : t('agentIdle')}
          </span>
          <span className="muted small text-ellipsis agent-session-label" title={session ? sessionRemote : sessionTitle}>
            {session ? sessionRemote : '—'}
          </span>
        </div>
        <div className="pane-header-actions">
          {looping ? (
            <IconButton
              className="agent-header-icon"
              chrome
              size="sm"
              variant="danger"
              label={t('agentStop')}
              onClick={stopLoop}
              icon={<IconStop size={16} />}
            />
          ) : null}
          <IconButton
            className="agent-header-icon"
            chrome
            size="sm"
            label={t('agentHistory')}
            disabled={busy}
            onClick={() => setHistoryOpen((o) => !o)}
            icon={<IconHistory size={16} />}
          />
          <IconButton
            className="agent-header-icon"
            chrome
            size="sm"
            label={t('clearChat')}
            disabled={busy}
            onClick={clearChat}
            icon={<IconClear size={16} />}
          />
          {onToggleDock ? (
            <IconButton
              className="agent-header-icon"
              chrome
              size="sm"
              label={dock === 'right' ? t('agentDockToBottom') : t('agentDockToRight')}
              onClick={onToggleDock}
              icon={
                dock === 'right' ? (
                  <IconPanelBottom size={16} />
                ) : (
                  <IconPanelRight size={16} />
                )
              }
            />
          ) : null}
        </div>
      </header>

      {historyOpen ? (
        <div className="agent-history-panel">
          <div className="agent-history-panel-head">
            <span className="small muted">{t('agentHistorySavedHint')}</span>
          </div>
          {historyIndex.length === 0 ? (
            <p className="small muted agent-history-empty">{t('agentHistoryEmpty')}</p>
          ) : (
            <ul className="agent-history-list">
              {historyIndex.map((entry) => (
                <li key={entry.hostKey}>
                  <button
                    type="button"
                    className={`agent-history-item${entry.hostKey === currentHostKey ? ' is-current' : ''}${entry.hostKey === historyPreviewKey ? ' is-active' : ''}`}
                    onClick={() => openHistoryPreview(entry.hostKey)}
                  >
                    <span className="agent-history-item-title">
                      {t('agentHistoryHost')} · {entry.hostKey.slice(0, 8)}
                      {entry.hostKey === currentHostKey ? ` (${t('agentSessionBound')})` : ''}
                    </span>
                    <span className="agent-history-item-preview muted small text-ellipsis">
                      {entry.preview || '—'}
                    </span>
                    <time className="agent-history-item-time muted small">
                      {entry.updatedAt ? new Date(entry.updatedAt).toLocaleString() : ''}
                    </time>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {historyPreviewKey ? (
        <div className="agent-history-preview-bar">
          <span className="small">{t('agentHistoryViewing')}</span>
          <button type="button" className="btn sm ghost" onClick={closeHistoryPreview}>
            {t('agentHistoryClosePreview')}
          </button>
        </div>
      ) : null}

      <div className="quick-row agent-quick-row">
        <button className="btn sm ghost" disabled={!session || busy} onClick={() => runLow('uname -a')}>
          {t('quickUname')}
        </button>
        <button className="btn sm ghost" disabled={!session || busy} onClick={() => runLow('df -h')}>
          {t('quickDf')}
        </button>
        <button className="btn sm ghost" disabled={!session || busy} onClick={() => runLow('whoami')}>
          {t('quickWhoami')}
        </button>
      </div>

      <div className="agent-log" ref={logRef}>
        {!historyPreviewKey && displayLines.length === 0 ? (
          <div className="agent-empty">
            <IconTerminal size={28} className="agent-empty-icon" />
            <p className="agent-empty-copy">{t('agentEmpty')}</p>
          </div>
        ) : null}
        {displayLines.map((line, i) => {
          if (line.kind === 'user') return <div key={i} className="bubble user">{line.text}</div>
          if (line.kind === 'assistant') return <div key={i} className="bubble assistant">{line.text}</div>
          if (line.kind === 'note') return <div key={i} className="bubble note">{line.text}</div>
          if (line.kind === 'error') return <div key={i} className="bubble error">{line.text}</div>
          if (line.kind === 'result') {
            const r = line.result
            const hasOut = !!(r.stdout || r.stderr)
            return (
              <div key={i} className="bubble result">
                <div className="mono cmd-line">$ {r.command}</div>
                <div className="meta">
                  {t('risk')}: {r.risk} · {t('exitCode')}: {r.exit_code} · {r.duration_ms}ms
                </div>
                {hasOut ? (
                  <details className="agent-tool-log" open={r.exit_code !== 0}>
                    <summary className="agent-tool-log-summary">{t('output')}</summary>
                    {r.stdout ? <pre>{r.stdout}</pre> : null}
                    {r.stderr ? <pre className="err">{r.stderr}</pre> : null}
                  </details>
                ) : null}
              </div>
            )
          }
          const prop = line.proposal
          return (
            <div
              key={i}
              className={`bubble proposal ${prop.status === 'pending' ? 'proposal-pending' : ''}`}
            >
              <div className="meta">
                {t('proposal')} · {t('risk')}: <strong>{prop.risk}</strong> · {t('status')}: {prop.status}
              </div>
              {prop.reason ? (
                <div className="muted small">
                  {t('reason')}: {prop.reason}
                </div>
              ) : null}
              <pre className="cmd">{prop.command}</pre>
              {prop.status === 'pending' ? (
                <div className="row gap approve-row">
                  <IconButton
                    className="agent-approve-btn"
                    size="sm"
                    variant="primary"
                    showLabel
                    label={t('approve')}
                    disabled={busy}
                    onClick={() => onApprove(prop)}
                    icon={<IconCheck size={14} />}
                  />
                  <IconButton
                    className="agent-deny-btn"
                    size="sm"
                    variant="ghost"
                    showLabel
                    label={t('deny')}
                    disabled={busy}
                    onClick={() => onDeny(prop)}
                    icon={<IconX size={14} />}
                  />
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      {active && active.status === 'pending' ? (
        <div className="active-proposal agent-approve-bar">
          <strong>{t('awaitingApproval')}</strong>
          <pre className="cmd">{active.command}</pre>
          <div className="row gap agent-approve-actions">
            <IconButton
              className="agent-approve-btn"
              size="sm"
              variant="primary"
              showLabel
              label={t('approve')}
              disabled={busy}
              onClick={() => onApprove(active)}
              icon={<IconCheck size={16} />}
            />
            <IconButton
              className="agent-deny-btn"
              size="sm"
              variant="ghost"
              showLabel
              label={t('deny')}
              disabled={busy}
              onClick={() => onDeny(active)}
              icon={<IconX size={16} />}
            />
          </div>
        </div>
      ) : null}

      <div className="agent-compose">
        <textarea
          className="agent-compose-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t('askOrCommand')}
          rows={2}
          disabled={!session || !!historyPreviewKey}
          onCompositionStart={() => {
            composingRef.current = true
          }}
          onCompositionEnd={() => {
            // Defer so the Enter that confirms IME does not also send.
            requestAnimationFrame(() => {
              composingRef.current = false
            })
          }}
          onKeyDown={(e) => {
            const isEnter = e.key === 'Enter' || e.code === 'Enter'
            if (!isEnter || e.shiftKey) return
            const ne = e.nativeEvent as KeyboardEvent
            // IME: prefer compositionstart/end + keyCode 229.
            // Do not trust isComposing alone — WKWebView can leave it true and block send.
            if (ne.keyCode === 229 || composingRef.current) return
            // Plain Enter = send (same as Ask). Shift+Enter keeps newline (we returned above).
            e.preventDefault()
            e.stopPropagation()
            const prompt = inputRef.current.trim()
            if (!prompt || !session || busyRef.current) return
            if (!activeProvider) {
              push({ kind: 'error', text: t('agentProviderMissing') })
              return
            }
            setInput('')
            void askModel(prompt)
          }}
        />
        <div className="agent-compose-actions">
          <IconButton
            className="agent-compose-action is-primary"
            size="md"
            variant="primary"
            showLabel
            label={t('askLlm')}
            disabled={!session || busy || !!historyPreviewKey || !input.trim() || !activeProvider}
            title={t('askLlmHint')}
            onClick={() => {
              const prompt = input.trim()
              setInput('')
              void askModel(prompt)
            }}
            icon={<IconSend size={16} />}
          />
          <IconButton
            className="agent-compose-action"
            size="md"
            variant="ghost"
            showLabel
            label={t('propose')}
            disabled={!session || busy || !!historyPreviewKey || !input.trim()}
            onClick={() => {
              const cmd = input.trim()
              setInput('')
              void propose(cmd)
            }}
            icon={<IconCheck size={16} />}
          />
          <IconButton
            className="agent-compose-action"
            size="md"
            variant="ghost"
            showLabel
            label={t('runLowRisk')}
            disabled={!session || busy || !!historyPreviewKey || !input.trim()}
            onClick={() => {
              const cmd = input.trim()
              setInput('')
              void runLow(cmd)
            }}
            icon={<IconTerminal size={16} />}
          />
        </div>
      </div>
    </aside>
  )
}

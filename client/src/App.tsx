import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import {
  closeSession,
  deleteHost,
  hostHasProxyJump,
  hostNeedsPassword,
  proxyJumpNeedsPassword,
  isHostKeyError,
  isJumpPasswordRequired,
  isPasswordRequiredError,
  jumpHostNeedsPassword,
  jumpHostsNeedingPassword,
  jumpPasswordCacheKey,
  jumpChainIds,
  resolveJumpChain,
  listHosts,
  listSessions,
  LOCAL_HOST_ID,
  openLocalSession,
  openSession,
  type ApiError,
  type Host,
  type HostKeyInfo,
  type SessionInfo,
} from './api'
import { useI18n } from './i18n'
import { AddHostModal } from './components/AddHostModal'
import { AgentPanel, type AgentDock } from './components/AgentPanel'
import {
  ConnectPasswordModal,
  type ConnectCredentials,
} from './components/ConnectPasswordModal'
import { HostKeyModal } from './components/HostKeyModal'
import { HostSidebar } from './components/HostSidebar'
import { SettingsModal } from './components/SettingsModal'
import { HelpModal } from './components/HelpModal'
import { SessionTabs } from './components/SessionTabs'
import { useToast } from './components/Toast'
import {
  forgetHostSecrets,
  loadPassword,
  peekPassword,
} from './passwordCache'
import { TerminalPane } from './components/TerminalPane'
import { IconButton, IconChevronLeft, IconChevronRight } from './components/icons'
import { checkSessionLink } from './sessionLink'
import { startWindowDrag, toggleFillScreen } from './windowChrome'

export function App() {
  const { t } = useI18n()
  const toast = useToast()
  const [hosts, setHosts] = useState<Host[]>([])
  const [activeHostId, setActiveHostId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [connectingHostId, setConnectingHostId] = useState<string | null>(null)
  const [modal, setModal] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [editingHost, setEditingHost] = useState<Host | null>(null)
  const [pwHost, setPwHost] = useState<Host | null>(null)
  const [pwJumpHost, setPwJumpHost] = useState<Host | null>(null)
  const [pwJumpHostsNeed, setPwJumpHostsNeed] = useState<Host[]>([])
  const [pwNeedTarget, setPwNeedTarget] = useState(true)
  const [pwNeedJump, setPwNeedJump] = useState(false)
  const [pwJumpOptional, setPwJumpOptional] = useState(false)
  const [pwError, setPwError] = useState('')
  const [hostKey, setHostKey] = useState<HostKeyInfo | null>(null)
  const [pendingConnect, setPendingConnect] = useState<{
    hostId: string
    password?: string
    jumpPassword?: string
    jumpPasswords?: Record<string, string>
  } | null>(null)
  const [leftCollapsed, setLeftCollapsed] = useState(() => {
    try {
      return localStorage.getItem('hivenest_sidebar_left_collapsed') === '1'
    } catch {
      return false
    }
  })
  const [rightCollapsed, setRightCollapsed] = useState(() => {
    try {
      const v = localStorage.getItem('hivenest_sidebar_right_collapsed')
      // Default collapsed when preference unset
      return v === null ? true : v === '1'
    } catch {
      return true
    }
  })
  const [agentDock, setAgentDock] = useState<AgentDock>(() => {
    try {
      const v = localStorage.getItem('hivenest_agent_dock')
      return v === 'bottom' ? 'bottom' : 'right'
    } catch {
      return 'right'
    }
  })
  const [agentBottomH, setAgentBottomH] = useState(() => {
    try {
      const n = Number(localStorage.getItem('hivenest_agent_bottom_h'))
      if (Number.isFinite(n) && n >= 160) return Math.round(n)
    } catch {
      /* ignore */
    }
    return 240
  })
  const workspaceRef = useRef<HTMLDivElement>(null)
  const agentBottomHRef = useRef(agentBottomH)
  agentBottomHRef.current = agentBottomH
  const agentResizeDrag = useRef<{ startY: number; startH: number } | null>(null)
  const [agentResizing, setAgentResizing] = useState(false)

  const connecting = !!connectingHostId
  const sessionHostIds = useMemo(
    () => sessions.filter((s) => !s.is_local).map((s) => s.host_id),
    [sessions],
  )

  const toggleLeft = useCallback(() => {
    setLeftCollapsed((v) => {
      const next = !v
      try {
        localStorage.setItem('hivenest_sidebar_left_collapsed', next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  const toggleRight = useCallback(() => {
    setRightCollapsed((v) => {
      const next = !v
      try {
        localStorage.setItem('hivenest_sidebar_right_collapsed', next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  const toggleAgentDock = useCallback(() => {
    setAgentDock((v) => {
      const next: AgentDock = v === 'right' ? 'bottom' : 'right'
      try {
        localStorage.setItem('hivenest_agent_dock', next)
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  const clampAgentBottomH = useCallback((h: number) => {
    const workspaceH = workspaceRef.current?.clientHeight || window.innerHeight
    const max = Math.max(160, Math.floor(workspaceH / 2))
    return Math.min(max, Math.max(160, Math.round(h)))
  }, [])

  const persistAgentBottomH = useCallback((h: number) => {
    try {
      localStorage.setItem('hivenest_agent_bottom_h', String(h))
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    if (agentDock !== 'bottom' || rightCollapsed) return
    const onResize = () => {
      setAgentBottomH((h) => {
        const next = clampAgentBottomH(h)
        if (next !== h) persistAgentBottomH(next)
        return next
      })
    }
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [agentDock, rightCollapsed, clampAgentBottomH, persistAgentBottomH])

  const onAgentResizePointerDown = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    agentResizeDrag.current = { startY: e.clientY, startH: agentBottomHRef.current }
    setAgentResizing(true)
  }, [])

  const onAgentResizePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      const drag = agentResizeDrag.current
      if (!drag) return
      const next = clampAgentBottomH(drag.startH - (e.clientY - drag.startY))
      setAgentBottomH(next)
    },
    [clampAgentBottomH],
  )

  const onAgentResizePointerUp = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (!agentResizeDrag.current) return
      agentResizeDrag.current = null
      setAgentResizing(false)
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      persistAgentBottomH(agentBottomHRef.current)
    },
    [persistAgentBottomH],
  )

  /**
   * Top strip (Grok Bot / macOS convention):
   * - drag (move) → startDragging
   * - double-click → toggleMaximize / zoom to fill
   * - single click does nothing
   */
  const topStripPtr = useRef<{ x: number; y: number; dragging: boolean } | null>(null)
  const topStripLastTap = useRef(0)
  const onTopStripPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    // Leave native traffic lights alone; match --traffic-light-safe-left.
    if (e.clientX < 112) return
    topStripPtr.current = { x: e.clientX, y: e.clientY, dragging: false }
    const onMove = (ev: PointerEvent) => {
      const s = topStripPtr.current
      if (!s || s.dragging) return
      if (Math.abs(ev.clientX - s.x) > 4 || Math.abs(ev.clientY - s.y) > 4) {
        s.dragging = true
        void startWindowDrag()
      }
    }
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      const s = topStripPtr.current
      topStripPtr.current = null
      if (!s || s.dragging) return
      if (Math.abs(ev.clientX - s.x) > 4 || Math.abs(ev.clientY - s.y) > 4) return
      const now = Date.now()
      if (now - topStripLastTap.current < 350) {
        topStripLastTap.current = 0
        void toggleFillScreen()
      } else {
        topStripLastTap.current = now
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }, [])

  const refreshHosts = useCallback(async () => {
    try {
      const d = await listHosts()
      setHosts(d.hosts || [])
    } catch (ex: any) {
      toast.error(ex.message || String(ex))
    }
  }, [toast])

  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions
  const hostsRef = useRef(hosts)
  hostsRef.current = hosts
  const activeSessionIdRef = useRef(activeSessionId)
  activeSessionIdRef.current = activeSessionId
  const linkCheckBusyRef = useRef(false)
  const linkCheckSkipUntilRef = useRef(0)
  const connectingHostIdRef = useRef(connectingHostId)
  connectingHostIdRef.current = connectingHostId
  const pwHostRef = useRef(pwHost)
  pwHostRef.current = pwHost
  const hostKeyRef = useRef(hostKey)
  hostKeyRef.current = hostKey

  const ensureLocalSession = useCallback(async () => {
    if (sessionsRef.current.some((s) => s.is_local)) {
      setActiveSessionId((cur) => {
        if (cur) return cur
        const loc = sessionsRef.current.find((s) => s.is_local)
        return loc?.id ?? null
      })
      return
    }
    try {
      let s: SessionInfo | null = null
      try {
        const listed = await listSessions()
        const existing = (listed.sessions || []).find((x) => x.is_local || x.host_id === LOCAL_HOST_ID)
        if (existing) s = existing
      } catch {
        /* list optional — fall through to open */
      }
      if (!s) s = await openLocalSession()
      const normalized = { ...s, is_local: true as const, host_name: s.host_name || 'Local' }
      setSessions((prev) => {
        if (prev.some((x) => x.is_local || x.id === normalized.id)) return prev
        return [normalized, ...prev.filter((x) => !x.is_local)]
      })
      setActiveSessionId((cur) => {
        // Prefer keeping an active remote; otherwise focus local.
        if (cur && sessionsRef.current.some((x) => x.id === cur && !x.is_local)) return cur
        if (cur && sessionsRef.current.some((x) => x.id === cur)) return cur
        return normalized.id
      })
    } catch (ex: any) {
      toast.error(ex.message || String(ex))
    }
  }, [toast])

  useEffect(() => {
    void refreshHosts()
    void ensureLocalSession()
  }, [refreshHosts, ensureLocalSession])

  function openPasswordPrompt(
    h: Host,
    opts?: { forceJump?: boolean; forceTarget?: boolean; jumpOptional?: boolean; error?: string },
  ) {
    const needList = jumpHostsNeedingPassword(h, hosts)
    const jumpProfile = needList[0] || null
    const chain = resolveJumpChain(h, hosts)
    const jumpHost = jumpProfile || chain[0] || null
    const hasProxy = hostHasProxyJump(h)
    const proxyPw = proxyJumpNeedsPassword(h)
    const needTarget = opts?.forceTarget || hostNeedsPassword(h)
    const needJump =
      opts?.forceJump || needList.length > 0 || jumpChainIds(h).length > 0 || hasProxy || proxyPw
    const jumpOptional =
      opts?.jumpOptional !== undefined
        ? opts.jumpOptional
        : hasProxy && needList.length === 0 && !proxyPw && !opts?.forceJump && jumpChainIds(h).length === 0
    setPwError(opts?.error || '')
    setPwHost(h)
    setPwJumpHost(jumpHost)
    setPwJumpHostsNeed(needList)
    setPwNeedTarget(needTarget)
    setPwNeedJump(needJump)
    setPwJumpOptional(!!jumpOptional)
  }

  function addOrReplaceSession(s: SessionInfo) {
    setSessions((prev) => {
      const withoutSameHost = prev.filter((x) => x.host_id !== s.host_id)
      return [...withoutSameHost, s]
    })
    setActiveSessionId(s.id)
    if (!s.is_local) setActiveHostId(s.host_id)
  }

  async function connectWithPassword(
    hostId: string,
    creds: ConnectCredentials = {},
    hostKeyOpts?: { accept_host_key?: boolean; replace_host_key?: boolean },
  ) {
    setActiveHostId(hostId)
    setConnectingHostId(hostId)
    setPwError('')
    try {
      // Reconnect same host: close only that host's prior session (keep others + local).
      const existing = sessionsRef.current.find((x) => x.host_id === hostId && !x.is_local)
      if (existing) {
        try {
          await closeSession(existing.id)
        } catch {
          /* ignore */
        }
        setSessions((prev) => prev.filter((x) => x.id !== existing.id))
      }
      const s = await openSession(hostId, {
        password: creds.password,
        jump_password: creds.jumpPassword,
        jump_passwords: creds.jumpPasswords,
        accept_host_key: hostKeyOpts?.accept_host_key,
        replace_host_key: hostKeyOpts?.replace_host_key,
      })
      addOrReplaceSession(s)
      linkCheckSkipUntilRef.current = Date.now() + 3000
      setPwHost(null)
      setPwJumpHost(null)
      setPwJumpHostsNeed([])
      setHostKey(null)
      setPendingConnect(null)
    } catch (ex: any) {
      const err = ex as ApiError
      if (isHostKeyError(err) && err.body?.host_key) {
        setPendingConnect({
          hostId,
          password: creds.password,
          jumpPassword: creds.jumpPassword,
          jumpPasswords: creds.jumpPasswords,
        })
        setHostKey(err.body.host_key)
        return
      }
      const msg = err.message || String(ex)
      const h = hosts.find((x) => x.id === hostId)
      if (isJumpPasswordRequired(err) && h) {
        openPasswordPrompt(h, {
          forceJump: true,
          jumpOptional: false,
          forceTarget: hostNeedsPassword(h) || !!creds.password,
          error: msg,
        })
      } else if (isPasswordRequiredError(err) && h) {
        openPasswordPrompt(h, {
          forceTarget: true,
          forceJump: !!jumpHostNeedsPassword(h, hosts) || !!creds.jumpPassword,
          error: msg,
        })
      } else if (pwHost || creds.password !== undefined || creds.jumpPassword !== undefined) {
        setPwError(msg)
        if (!pwHost && h) openPasswordPrompt(h, { error: msg })
      } else {
        toast.error(msg)
      }
    } finally {
      setConnectingHostId(null)
    }
  }

  function onConnect(hostId: string, opts?: { force?: boolean; error?: string }) {
    const h = hosts.find((x) => x.id === hostId)
    if (!h) return
    const live = sessionsRef.current.find((s) => s.host_id === hostId && !s.is_local)
    if (live && !opts?.force) {
      setActiveHostId(hostId)
      setActiveSessionId(live.id)
      return
    }
    setActiveHostId(hostId)
    const needTarget = hostNeedsPassword(h)
    const needJumpProfiles = jumpHostsNeedingPassword(h, hosts)
    const hasChain = jumpChainIds(h).length > 0
    const hasProxy = hostHasProxyJump(h)
    const proxyPw = proxyJumpNeedsPassword(h)
    if (needTarget || needJumpProfiles.length > 0 || hasChain || hasProxy || proxyPw) {
      if (needTarget || needJumpProfiles.length > 0 || hasProxy || proxyPw) {
        void (async () => {
          try {
            const creds: ConnectCredentials = {}
            let haveAll = true
            if (needTarget) {
              const p = (await loadPassword(h.id)) || peekPassword(h.id)
              if (p) creds.password = p
              else haveAll = false
            }
            if (needJumpProfiles.length > 0) {
              const map: Record<string, string> = {}
              for (const j of needJumpProfiles) {
                const key = jumpPasswordCacheKey(h, j)
                const jp = (await loadPassword(key)) || peekPassword(key)
                if (jp) map[j.id] = jp
                else haveAll = false
              }
              if (Object.keys(map).length) {
                creds.jumpPasswords = map
                const first = needJumpProfiles[0]
                if (first && map[first.id]) creds.jumpPassword = map[first.id]
              }
            } else if (proxyPw) {
              const key = jumpPasswordCacheKey(h, null)
              const jp = (await loadPassword(key)) || peekPassword(key)
              if (jp) {
                creds.jumpPassword = jp
                creds.jumpPasswords = { 'proxy:0': jp }
              } else haveAll = false
            }
            if (haveAll && (creds.password || creds.jumpPassword || creds.jumpPasswords)) {
              await connectWithPassword(hostId, creds)
              return
            }
            openPasswordPrompt(h, {
              ...(proxyPw ? { jumpOptional: false } : {}),
              ...(opts?.error ? { error: opts.error } : {}),
            })
          } catch (ex: unknown) {
            const msg = ex instanceof Error ? ex.message : String(ex)
            toast.error(msg)
          }
        })()
        return
      }
    }
    if (opts?.error) {
      openPasswordPrompt(h, { error: opts.error })
      return
    }
    void connectWithPassword(hostId)
  }

  const dropSessionFromUi = useCallback((sessionId: string) => {
    setSessions((prev) => prev.filter((x) => x.id !== sessionId))
    setActiveSessionId((cur) => {
      if (cur !== sessionId) return cur
      const rest = sessionsRef.current.filter((x) => x.id !== sessionId)
      const nextRemote = rest.find((s) => !s.is_local)
      const nextLocal = rest.find((s) => s.is_local)
      return nextRemote?.id ?? nextLocal?.id ?? null
    })
  }, [])

  const promptReconnectForSession = useCallback(
    async (session: SessionInfo, status: 'missing' | 'dead') => {
      if (session.is_local) return
      const msg =
        status === 'missing' ? t('sessionLinkMissing') : t('sessionLinkDead')
      linkCheckSkipUntilRef.current = Date.now() + 4000
      try {
        await closeSession(session.id)
      } catch {
        /* session may already be gone */
      }
      dropSessionFromUi(session.id)
      onConnect(session.host_id, { force: true, error: msg })
    },
    [dropSessionFromUi, t],
  )

  const validateActiveTabConnection = useCallback(
    async (_reason: 'focus' | 'tab') => {
      if (Date.now() < linkCheckSkipUntilRef.current) return
      if (linkCheckBusyRef.current) return
      if (connectingHostIdRef.current) return
      if (pwHostRef.current || hostKeyRef.current) return

      const sessionId = activeSessionIdRef.current
      if (!sessionId) return
      const session = sessionsRef.current.find((x) => x.id === sessionId)
      if (!session || session.is_local) return

      linkCheckBusyRef.current = true
      try {
        const status = await checkSessionLink(sessionId)
        if (status === 'ok') return
        await promptReconnectForSession(session, status)
      } finally {
        linkCheckBusyRef.current = false
      }
    },
    [promptReconnectForSession],
  )

  useEffect(() => {
    void validateActiveTabConnection('tab')
  }, [activeSessionId, validateActiveTabConnection])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void validateActiveTabConnection('focus')
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    let unlisten: (() => void) | undefined
    void (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        const win = getCurrentWindow()
        unlisten = await win.onFocusChanged(({ payload: focused }) => {
          if (focused) void validateActiveTabConnection('focus')
        })
      } catch {
        /* browser dev — visibilitychange only */
      }
    })()
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      unlisten?.()
    }
  }, [validateActiveTabConnection])

  async function closeSessionById(sessionId: string) {
    const target = sessionsRef.current.find((s) => s.id === sessionId)
    if (!target) return
    if (target.is_local) {
      setActiveSessionId(target.id)
      return
    }
    try {
      await closeSession(sessionId)
    } catch (ex: any) {
      toast.error(ex.message || String(ex))
    }
    const remaining = sessionsRef.current.filter((s) => s.id !== sessionId)
    setSessions(remaining)
    setActiveSessionId((cur) => {
      if (cur !== sessionId) return cur
      const nextRemote = remaining.find((s) => !s.is_local)
      const nextLocal = remaining.find((s) => s.is_local)
      return nextRemote?.id ?? nextLocal?.id ?? null
    })
    if (activeHostId === target.host_id) setActiveHostId(null)
    void ensureLocalSession()
  }

  async function onDisconnectHost(hostId: string) {
    const s = sessions.find((x) => x.host_id === hostId && !x.is_local)
    if (!s) return
    await closeSessionById(s.id)
  }

  async function onDelete(id: string) {
    if (!confirm('Delete this host profile?')) return
    const live = sessions.find((s) => s.host_id === id && !s.is_local)
    if (live) await closeSessionById(live.id)
    await forgetHostSecrets(id)
    await deleteHost(id)
    await refreshHosts()
    if (activeHostId === id) setActiveHostId(null)
  }

  function onEdit(id: string) {
    const h = hosts.find((x) => x.id === id)
    if (!h) return
    setEditingHost(h)
    setModal(true)
  }

  function openAdd() {
    setEditingHost(null)
    setModal(true)
  }

  function closeHostModal() {
    setModal(false)
    setEditingHost(null)
  }

  function onSelectHost(id: string) {
    setActiveHostId(id)
    const live = sessions.find((s) => s.host_id === id && !s.is_local)
    if (live) setActiveSessionId(live.id)
  }

  function onSelectSessionTab(sessionId: string) {
    setActiveSessionId(sessionId)
    const s = sessions.find((x) => x.id === sessionId)
    if (s && !s.is_local) setActiveHostId(s.host_id)
  }

  const tabSessions = useMemo(
    () => [...sessions].sort((a, b) => Number(!!b.is_local) - Number(!!a.is_local)),
    [sessions],
  )

  const terminalLayoutKey = `${agentDock}:${rightCollapsed ? 0 : 1}:${agentDock === 'bottom' && !rightCollapsed ? agentBottomH : 0}`

  return (
    <div className="app">
      <header className="app-topbar">
        <div
          className="app-drag-region"
          role="presentation"
          aria-hidden="true"
          onPointerDown={onTopStripPointerDown}
          title="Double-click to zoom · drag to move"
        />
        <div className="app-topbar-tabs">
          <SessionTabs
            sessions={tabSessions}
            hosts={hosts}
            activeSessionId={activeSessionId}
            onSelect={onSelectSessionTab}
            onClose={(id) => void closeSessionById(id)}
            localLabel={t('localSession')}
          />
        </div>
        <IconButton
          className="agent-fold-top"
          chrome
          size="sm"
          label={rightCollapsed ? t('expandAgent') : t('collapseAgent')}
          onClick={toggleRight}
          icon={
            rightCollapsed ? (
              <IconChevronLeft size={16} />
            ) : (
              <IconChevronRight size={16} />
            )
          }
        />
      </header>
      <div
        ref={workspaceRef}
        className={[
          'workspace',
          leftCollapsed ? 'left-collapsed' : '',
          rightCollapsed ? 'right-collapsed' : '',
          agentDock === 'bottom' ? 'agent-dock-bottom' : '',
          agentResizing ? 'is-agent-resizing' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={
          agentDock === 'bottom' && !rightCollapsed
            ? ({ ['--agent-bottom-h' as string]: `${agentBottomH}px` } as CSSProperties)
            : undefined
        }
      >
        <HostSidebar
          hosts={hosts}
          activeHostId={activeHostId}
          sessionHostIds={sessionHostIds}
          connectingHostId={connectingHostId}
          collapsed={leftCollapsed}
          onToggleCollapse={toggleLeft}
          onRefresh={() => void refreshHosts()}
          onAdd={openAdd}
          onEdit={onEdit}
          onSelect={onSelectHost}
          onConnect={(id) => onConnect(id)}
          onDisconnect={(id) => void onDisconnectHost(id)}
          onDelete={(id) => void onDelete(id)}
          onHelp={() => setHelpOpen(true)}
          onSettings={() => setSettingsOpen(true)}
        />

        <div className="center-stack">
          <div className="terminal-stack">
            {tabSessions.length === 0 ? (
              <TerminalPane sessionId={null} remoteLabel={undefined} active layoutKey={terminalLayoutKey} />
            ) : (
              tabSessions.map((s) => (
                <div
                  key={s.id}
                  className={`term-slot${s.id === activeSessionId ? ' is-active' : ''}`}
                  hidden={s.id !== activeSessionId}
                >
                  <TerminalPane
                    sessionId={s.id}
                    remoteLabel={
                      s.is_local
                        ? t('localSession')
                        : s.remote || hosts.find((h) => h.id === s.host_id)?.name
                    }
                    active={s.id === activeSessionId}
                    layoutKey={terminalLayoutKey}
                  />
                </div>
              ))
            )}
          </div>
        </div>

        <div className="agent-stack">
          {agentDock === 'bottom' && !rightCollapsed ? (
            <button
              type="button"
              className={`agent-resize-handle${agentResizing ? ' is-dragging' : ''}`}
              aria-label="Resize agent panel"
              aria-orientation="horizontal"
              aria-valuemin={160}
              aria-valuemax={Math.max(160, Math.floor((workspaceRef.current?.clientHeight || 0) / 2) || 480)}
              aria-valuenow={agentBottomH}
              onPointerDown={onAgentResizePointerDown}
              onPointerMove={onAgentResizePointerMove}
              onPointerUp={onAgentResizePointerUp}
              onPointerCancel={onAgentResizePointerUp}
            />
          ) : null}
          {tabSessions.length === 0 ? (
            <AgentPanel
              session={null}
              collapsed={rightCollapsed}
              dock={agentDock}
              onToggleDock={toggleAgentDock}
            />
          ) : (
            tabSessions.map((s) => (
              <div
                key={s.id}
                className={`agent-slot${s.id === activeSessionId ? ' is-active' : ''}`}
                hidden={s.id !== activeSessionId}
              >
                <AgentPanel
                  session={s}
                  collapsed={rightCollapsed}
                  dock={agentDock}
                  onToggleDock={toggleAgentDock}
                />
              </div>
            ))
          )}
        </div>
      </div>

      <AddHostModal
        open={modal}
        host={editingHost}
        hosts={hosts}
        onClose={closeHostModal}
        onCreated={(h) => {
          void refreshHosts().then(() => setActiveHostId(h.id))
        }}
        onUpdated={(h) => {
          void refreshHosts().then(() => setActiveHostId(h.id))
        }}
      />
      <HostKeyModal
        open={!!hostKey}
        info={hostKey}
        busy={connecting}
        onReject={() => {
          setHostKey(null)
          setPendingConnect(null)
        }}
        onAccept={() => {
          if (!pendingConnect || !hostKey) return
          const replace = hostKey.code === 'host_key_mismatch'
          void connectWithPassword(
            pendingConnect.hostId,
            {
              password: pendingConnect.password,
              jumpPassword: pendingConnect.jumpPassword,
              jumpPasswords: pendingConnect.jumpPasswords,
            },
            {
              accept_host_key: !replace,
              replace_host_key: replace,
            },
          )
        }}
      />
      <ConnectPasswordModal
        open={!!pwHost}
        host={pwHost}
        jumpHost={pwJumpHost}
        jumpHostsNeedingPw={pwJumpHostsNeed}
        needTargetPassword={pwNeedTarget}
        needJumpPassword={pwNeedJump}
        jumpPasswordOptional={pwJumpOptional}
        busy={connecting}
        error={pwError}
        onClose={() => {
          if (!connecting) {
            setPwHost(null)
            setPwJumpHost(null)
            setPwJumpHostsNeed([])
            setPwError('')
            setPwJumpOptional(false)
          }
        }}
        onConnect={(creds) => {
          if (!pwHost) return
          void connectWithPassword(pwHost.id, creds)
        }}
      />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  )
}


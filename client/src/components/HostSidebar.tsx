import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Host } from '../api'
import {
  loadHostOrder,
  mergeHostOrder,
  moveIdTo,
  orderHosts,
  saveHostOrder,
} from '../hostOrder'
import { useI18n } from '../i18n'
import {
  IconAgentAuth,
  IconButton,
  IconChevronLeft,
  IconChevronRight,
  IconConnect,
  IconDisconnect,
  IconEdit,
  IconHelp,
  IconKey,
  IconLock,
  IconPlus,
  IconRefresh,
  IconSettings,
  IconSpinner,
  IconTrash,
} from './icons'

type Props = {
  hosts: Host[]
  activeHostId: string | null
  /** Host ids that currently have an open SSH session. */
  sessionHostIds: string[]
  connectingHostId: string | null
  collapsed: boolean
  onToggleCollapse: () => void
  onRefresh: () => void
  onAdd: () => void
  onEdit: (id: string) => void
  onSelect: (id: string) => void
  onConnect: (id: string) => void
  onDisconnect: (hostId: string) => void
  onDelete: (id: string) => void
  onHelp: () => void
  onSettings: () => void
}

type RailTip = {
  hostId: string
  name: string
  endpoint: string
  meta: string
  top: number
  left: number
  live: boolean
  connecting: boolean
}

type AuthKind = 'key' | 'password' | 'agent'

function hostInitial(name: string): string {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return '?'
  return trimmed.charAt(0).toUpperCase()
}

function authKind(h: Host): AuthKind | null {
  if (h.auth_method === 'password') return 'password'
  if (h.auth_method === 'agent' || h.use_agent) return 'agent'
  if (h.auth_method === 'key' || h.identity_file) return 'key'
  if (!h.auth_method && !h.identity_file && !h.use_agent) return 'password'
  return null
}

function authHint(h: Host): string {
  return authKind(h) || ''
}

function hostHoverLine(
  h: Host,
  opts: { live: boolean; connecting: boolean; connectedLabel: string; connectingLabel: string },
): string {
  const endpoint = `${h.user}@${h.host}:${h.port}`
  const auth = authHint(h)
  const state = opts.connecting
    ? opts.connectingLabel
    : opts.live
      ? opts.connectedLabel
      : ''
  return [h.name, endpoint, auth, state].filter(Boolean).join(' · ')
}

function AuthMethodIcon({
  kind,
  label,
}: {
  kind: AuthKind
  label: string
}) {
  const icon =
    kind === 'password' ? (
      <IconLock size={16} />
    ) : kind === 'agent' ? (
      <IconAgentAuth size={16} />
    ) : (
      <IconKey size={16} />
    )
  return (
    <span className={`host-auth-icon host-auth-icon--${kind}`} title={label} aria-label={label} role="img">
      {icon}
    </span>
  )
}

function SidebarFooterControls({
  collapsed,
  onHelp,
  onSettings,
  onRefresh,
  onAdd,
  onToggleCollapse,
}: {
  collapsed: boolean
  onHelp: () => void
  onSettings: () => void
  onRefresh: () => void
  onAdd: () => void
  onToggleCollapse: () => void
}) {
  const { t } = useI18n()
  return (
    <div className={`sidebar-footer-controls${collapsed ? ' is-rail' : ''}`}>
      <div className={`sidebar-host-tools${collapsed ? ' is-rail' : ''}`}>
        <IconButton
          className="sidebar-tool-icon"
          chrome
          variant="ghost"
          label={collapsed ? t('expandHosts') : t('collapseHosts')}
          onClick={onToggleCollapse}
          icon={collapsed ? <IconChevronRight size={16} /> : <IconChevronLeft size={16} />}
        />
        <IconButton
          className="sidebar-tool-icon"
          chrome
          variant="ghost"
          label={t('refresh')}
          onClick={onRefresh}
          icon={<IconRefresh size={16} />}
        />
        <IconButton
          className="sidebar-tool-icon"
          chrome
          variant="ghost"
          label={t('addHost')}
          onClick={onAdd}
          icon={<IconPlus size={16} />}
        />
      </div>
      <div className={`sidebar-app-controls${collapsed ? ' is-rail' : ''}`}>
        <IconButton
          className="sidebar-app-icon"
          chrome
          size="sm"
          label={t('help')}
          onClick={onHelp}
          icon={<IconHelp size={16} />}
        />
        <IconButton
          className="sidebar-app-icon"
          chrome
          size="sm"
          label={t('settings')}
          onClick={onSettings}
          icon={<IconSettings size={16} />}
        />
      </div>
    </div>
  )
}

export function HostSidebar(props: Props) {
  const { t } = useI18n()
  const {
    hosts, activeHostId, sessionHostIds, connectingHostId, collapsed, onToggleCollapse,
    onRefresh, onAdd, onEdit, onSelect, onConnect, onDisconnect, onDelete, onHelp, onSettings,
  } = props
  const liveSet = new Set(sessionHostIds)
  const connecting = !!connectingHostId
  const [railTip, setRailTip] = useState<RailTip | null>(null)
  const railTipHideTimer = useRef<number | null>(null)
  const [orderIds, setOrderIds] = useState<string[]>(() => loadHostOrder())
  const [dragId, setDragId] = useState<string | null>(null)
  const [overTarget, setOverTarget] = useState<{ id: string; place: 'before' | 'after' } | null>(null)
  /** HTML5 DnD is unreliable in Tauri WKWebView when the row is a <button>; use pointer drag. */
  const ptrRef = useRef<{
    id: string
    startY: number
    dragging: boolean
  } | null>(null)
  const suppressClickRef = useRef(false)
  const overTargetRef = useRef<{ id: string; place: 'before' | 'after' } | null>(null)
  overTargetRef.current = overTarget

  useEffect(() => {
    const ids = hosts.map((h) => h.id)
    setOrderIds((prev) => {
      const next = mergeHostOrder(prev.length ? prev : loadHostOrder(), ids)
      if (next.join('\0') !== prev.join('\0')) {
        saveHostOrder(next)
      }
      return next
    })
  }, [hosts])

  const orderedHosts = useMemo(() => orderHosts(hosts, orderIds), [hosts, orderIds])

  const authLabel = useCallback(
    (kind: AuthKind) => {
      if (kind === 'password') return t('authPassword')
      if (kind === 'agent') return t('authAgent')
      return t('authKey')
    },
    [t],
  )

  const cancelRailTipHide = useCallback(() => {
    if (railTipHideTimer.current != null) {
      window.clearTimeout(railTipHideTimer.current)
      railTipHideTimer.current = null
    }
  }, [])

  const hideRailTip = useCallback(() => {
    cancelRailTipHide()
    setRailTip(null)
  }, [cancelRailTipHide])

  const scheduleRailTipHide = useCallback(() => {
    cancelRailTipHide()
    railTipHideTimer.current = window.setTimeout(() => setRailTip(null), 120)
  }, [cancelRailTipHide])

  const showRailTip = useCallback(
    (
      el: HTMLElement,
      h: Host,
      opts: { live: boolean; connecting: boolean },
    ) => {
      cancelRailTipHide()
      const rect = el.getBoundingClientRect()
      const meta = [
        authHint(h),
        opts.connecting ? t('connecting') : opts.live ? t('connected') : '',
      ]
        .filter(Boolean)
        .join(' · ')
      setRailTip({
        hostId: h.id,
        name: h.name,
        endpoint: `${h.user}@${h.host}:${h.port}`,
        meta,
        top: Math.max(8, rect.top),
        left: rect.right + 8,
        live: opts.live,
        connecting: opts.connecting,
      })
    },
    [cancelRailTipHide, t],
  )

  const hostIdAtPoint = useCallback((x: number, y: number): { id: string; place: 'before' | 'after' } | null => {
    const el = document.elementFromPoint(x, y)
    const li = el?.closest('li[data-host-id]') as HTMLElement | null
    if (!li?.dataset.hostId) return null
    const rect = li.getBoundingClientRect()
    const place: 'before' | 'after' = y >= rect.top + rect.height / 2 ? 'after' : 'before'
    return { id: li.dataset.hostId, place }
  }, [])

  const commitReorder = useCallback(
    (fromId: string, toId: string, place: 'before' | 'after') => {
      if (fromId === toId) return
      setOrderIds((prev) => {
        const base = mergeHostOrder(prev, hosts.map((h) => h.id))
        const next = moveIdTo(base, fromId, toId, place)
        if (next.join('\0') === base.join('\0')) return prev
        saveHostOrder(next)
        return next
      })
    },
    [hosts],
  )

  const onRowPointerDown = useCallback(
    (id: string, e: React.PointerEvent) => {
      if (e.button !== 0) return
      ptrRef.current = { id, startY: e.clientY, dragging: false }

      const onMove = (ev: PointerEvent) => {
        const s = ptrRef.current
        if (!s || s.id !== id) return
        if (!s.dragging) {
          if (Math.abs(ev.clientY - s.startY) < 6) return
          s.dragging = true
          suppressClickRef.current = true
          setDragId(id)
        }
        const hit = hostIdAtPoint(ev.clientX, ev.clientY)
        const next = hit && hit.id !== id ? hit : null
        const prev = overTargetRef.current
        if ((next?.id ?? null) !== (prev?.id ?? null) || (next?.place ?? null) !== (prev?.place ?? null)) {
          setOverTarget(next)
        }
      }

      const onUp = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        const s = ptrRef.current
        ptrRef.current = null
        const wasDragging = !!s?.dragging
        setDragId(null)
        setOverTarget(null)
        if (wasDragging && s) {
          const hit = hostIdAtPoint(ev.clientX, ev.clientY)
          if (hit && hit.id !== s.id) {
            commitReorder(s.id, hit.id, hit.place)
          }
          // Swallow the click that follows a completed drag.
          window.setTimeout(() => {
            suppressClickRef.current = false
          }, 0)
        }
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [commitReorder, hostIdAtPoint],
  )

  const onRowClick = useCallback(
    (id: string) => {
      if (suppressClickRef.current) return
      onSelect(id)
    },
    [onSelect],
  )

  const footer = (
    <SidebarFooterControls
      collapsed={collapsed}
      onHelp={onHelp}
      onSettings={onSettings}
      onRefresh={onRefresh}
      onAdd={onAdd}
      onToggleCollapse={onToggleCollapse}
    />
  )

  if (collapsed) {
    return (
      <aside className="sidebar sidebar-collapsed" aria-label={t('hosts')}>
        <ul className="rail-host-list" aria-label={t('hosts')}>
          {orderedHosts.map((h) => {
            const active = h.id === activeHostId
            const live = liveSet.has(h.id)
            const isConnecting = connectingHostId === h.id
            const tipLine = hostHoverLine(h, {
              live,
              connecting: isConnecting,
              connectedLabel: t('connected'),
              connectingLabel: t('connecting'),
            })
            return (
              <li key={h.id} className="rail-host-item">
                <button
                  type="button"
                  className={['rail-host-btn', active ? 'is-active' : ''].filter(Boolean).join(' ')}
                  onClick={() => onSelect(h.id)}
                  onMouseEnter={(e) => showRailTip(e.currentTarget, h, { live, connecting: isConnecting })}
                  onMouseLeave={scheduleRailTipHide}
                  onFocus={(e) => showRailTip(e.currentTarget, h, { live, connecting: isConnecting })}
                  onBlur={scheduleRailTipHide}
                  aria-label={tipLine}
                  aria-current={active ? 'true' : undefined}
                >
                  <span className="rail-host-initial" aria-hidden="true">
                    {isConnecting ? <IconSpinner size={12} /> : hostInitial(h.name)}
                  </span>
                  <span
                    className={`rail-host-status ${isConnecting ? 'is-connecting' : live ? 'is-live' : 'is-idle'}`}
                    aria-hidden="true"
                  />
                </button>
              </li>
            )
          })}
        </ul>
        <footer className="sidebar-footer sidebar-footer-rail">{footer}</footer>
        {railTip ? (
          <div
            className="rail-host-tip"
            role="dialog"
            aria-label={railTip.name}
            style={{ top: railTip.top, left: railTip.left }}
            onMouseEnter={cancelRailTipHide}
            onMouseLeave={scheduleRailTipHide}
          >
            <div className="rail-host-tip-name">{railTip.name}</div>
            <div className="rail-host-tip-endpoint">{railTip.endpoint}</div>
            {railTip.meta ? (
              <div className="rail-host-tip-meta">{railTip.meta}</div>
            ) : null}
            <div
              className="rail-host-tip-actions"
              onPointerDown={(e) => e.stopPropagation()}
            >
              {railTip.live ? (
                <IconButton
                  className="host-action-icon rail-host-tip-action"
                  chrome
                  variant="ghost"
                  label={t('disconnect')}
                  onClick={() => {
                    onDisconnect(railTip.hostId)
                    hideRailTip()
                  }}
                  icon={<IconDisconnect size={16} />}
                />
              ) : (
                <IconButton
                  className="host-action-icon rail-host-tip-action"
                  chrome
                  variant="ghost"
                  label={railTip.connecting ? t('connecting') : t('connect')}
                  disabled={connecting}
                  onClick={() => {
                    onConnect(railTip.hostId)
                  }}
                  icon={
                    railTip.connecting ? (
                      <IconSpinner size={16} />
                    ) : (
                      <IconConnect size={16} />
                    )
                  }
                />
              )}
              <IconButton
                className="host-action-icon rail-host-tip-action"
                chrome
                variant="ghost"
                label={t('edit')}
                onClick={() => {
                  onEdit(railTip.hostId)
                  hideRailTip()
                }}
                icon={<IconEdit size={16} />}
              />
              <IconButton
                className="host-action-icon rail-host-tip-action"
                chrome
                variant="ghost"
                label={t('delete')}
                onClick={() => {
                  onDelete(railTip.hostId)
                  hideRailTip()
                }}
                icon={<IconTrash size={16} />}
              />
            </div>
          </div>
        ) : null}
      </aside>
    )
  }

  return (
    <aside className="sidebar" aria-label={t('hosts')}>
      <p className="sidebar-hosts-label">{t('hosts')}</p>
      {orderedHosts.length === 0 ? (
        <p className="muted pad sidebar-body">{t('noHosts')}</p>
      ) : (
        <ul className="host-list sidebar-body">
          {orderedHosts.map((h) => {
            const active = h.id === activeHostId
            const live = liveSet.has(h.id)
            const isConnecting = connectingHostId === h.id
            const kind = authKind(h)
            const statusClass = isConnecting ? 'is-connecting' : live ? 'is-live' : 'is-idle'
            const statusLabel = isConnecting ? t('connecting') : live ? t('connected') : t('offline')
            const dragOverClass =
              overTarget && overTarget.id === h.id && dragId !== h.id
                ? overTarget.place === 'before'
                  ? 'is-drag-over-before'
                  : 'is-drag-over-after'
                : ''
            return (
              <li
                key={h.id}
                data-host-id={h.id}
                className={[
                  'host-item',
                  active ? 'active' : '',
                  dragId === h.id ? 'is-dragging' : '',
                  dragOverClass,
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <div className="host-row">
                  <button
                    type="button"
                    className="host-row-main host-main"
                    onPointerDown={(e) => onRowPointerDown(h.id, e)}
                    onClick={() => onRowClick(h.id)}
                  >
                    <span
                      className={`host-status-dot ${statusClass}`}
                      role="img"
                      title={statusLabel}
                      aria-label={statusLabel}
                    />
                    <span className="host-name text-ellipsis" title={h.name}>
                      {h.name}
                    </span>
                    {kind ? <AuthMethodIcon kind={kind} label={authLabel(kind)} /> : null}
                  </button>
                  <div
                    className="host-actions"
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    {live ? (
                      <IconButton
                        className="host-action-icon"
                        chrome
                        variant="ghost"
                        label={t('disconnect')}
                        onClick={() => onDisconnect(h.id)}
                        icon={<IconDisconnect size={16} />}
                      />
                    ) : (
                      <IconButton
                        className="host-action-icon"
                        chrome
                        variant="ghost"
                        label={isConnecting ? t('connecting') : t('connect')}
                        disabled={connecting}
                        onClick={() => onConnect(h.id)}
                        icon={isConnecting ? <IconSpinner size={16} /> : <IconConnect size={16} />}
                      />
                    )}
                    <IconButton
                      className="host-action-icon"
                      chrome
                      variant="ghost"
                      label={t('edit')}
                      onClick={() => onEdit(h.id)}
                      icon={<IconEdit size={16} />}
                    />
                    <IconButton
                      className="host-action-icon"
                      chrome
                      variant="ghost"
                      label={t('delete')}
                      onClick={() => onDelete(h.id)}
                      icon={<IconTrash size={16} />}
                    />
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <footer className="sidebar-footer">{footer}</footer>
    </aside>
  )
}

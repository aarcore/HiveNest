import { useEffect, useMemo, useRef, useState } from 'react'
import {
  addFleetServer,
  groupNames,
  loadFleet,
  removeFleetServer,
  resetFleetChatState,
  runFleetTurn,
  updateFleetServer,
  type FleetServer,
  type FleetServerInput,
  type FleetStepEvent,
} from '../fleet'
import { useI18n } from '../i18n'
import { useSettings } from '../settings/SettingsContext'
import { IconButton, IconSend, IconStop, IconX } from './icons'
import { FleetServerForm } from './FleetServerForm'
import { FleetChatLog, type FleetLine } from './FleetChatLog'

type Props = {
  open: boolean
  onClose: () => void
  onRosterChange: () => void
}

export function FleetPanel({ open, onClose, onRosterChange }: Props) {
  const { t } = useI18n()
  const { activeProvider } = useSettings()
  const [servers, setServers] = useState<FleetServer[]>(() => loadFleet())
  const [lines, setLines] = useState<FleetLine[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<FleetServer | null>(null)
  const [adding, setAdding] = useState(false)
  const [tab, setTab] = useState<'chat' | 'roster'>('chat')
  const historyRef = useRef<{ role: 'system' | 'user' | 'assistant'; content: string }[]>([])
  const stopRef = useRef(false)
  const logRef = useRef<HTMLDivElement>(null)

  const groups = useMemo(() => groupNames(servers), [servers])

  useEffect(() => {
    if (open) setServers(loadFleet())
  }, [open])

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  function push(line: FleetLine) {
    setLines((prev) => [...prev, line])
  }

  function refreshRoster() {
    const next = loadFleet()
    setServers(next)
    onRosterChange()
  }

  function handleEvent(e: FleetStepEvent) {
    switch (e.type) {
      case 'assistant':
        push({ kind: 'assistant', text: e.text })
        break
      case 'step':
        push({ kind: 'step', text: e.label })
        break
      case 'result':
        push({ kind: 'result', title: e.title, body: e.body, failed: e.failed })
        break
      case 'note':
        push({ kind: 'note', text: e.text })
        break
      case 'error':
        push({ kind: 'error', text: e.text })
        break
      case 'approval':
        push({
          kind: 'approval',
          server: e.server,
          command: e.command,
          risk: e.risk,
          onApprove: async () => {
            await e.apply()
          },
        })
        break
      case 'done':
        push({ kind: 'note', text: e.text })
        break
      default:
        break
    }
    // The roster may have grown mid-turn (register action).
    const fresh = loadFleet()
    if (fresh.length !== servers.length) {
      setServers(fresh)
      onRosterChange()
    }
  }

  async function send() {
    const text = input.trim()
    if (!text || busy) return
    if (!activeProvider) {
      push({ kind: 'error', text: t('fleetNoProvider') })
      return
    }
    setInput('')
    stopRef.current = false
    setBusy(true)
    try {
      await runFleetTurn({
        provider: activeProvider,
        userText: text,
        history: historyRef.current,
        // Live ref: stop() flips it and the loop checks before every step.
        signal: {
          get stopped() {
            return stopRef.current
          },
        },
        onEvent: handleEvent,
      })
    } catch (ex: unknown) {
      push({ kind: 'error', text: ex instanceof Error ? ex.message : String(ex) })
    } finally {
      setBusy(false)
      refreshRoster()
    }
  }

  function stop() {
    stopRef.current = true
  }

  function clearChat() {
    stopRef.current = true
    historyRef.current = []
    resetFleetChatState()
    setLines([])
  }

  async function onDelete(s: FleetServer) {
    await removeFleetServer(s.id)
    refreshRoster()
  }

  function onSaved(saved: FleetServer, created: boolean) {
    setAdding(false)
    setEditing(null)
    if (created) {
      push({ kind: 'note', text: `${t('fleetRegistered')} ${saved.name}` })
    }
    refreshRoster()
  }

  if (!open) return null

  return (
    <div className="fleet-overlay" role="dialog" aria-modal="true" aria-label={t('fleetTitle')}>
      <header className="fleet-header">
        <div className="fleet-header-main">
          <strong>{t('fleetTitle')}</strong>
          <span className="muted small">{t('fleetSubtitle')}</span>
        </div>
        <div className="fleet-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'chat'}
            className={`fleet-tab${tab === 'chat' ? ' is-active' : ''}`}
            onClick={() => setTab('chat')}
          >
            {t('fleetChat')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'roster'}
            className={`fleet-tab${tab === 'roster' ? ' is-active' : ''}`}
            onClick={() => setTab('roster')}
          >
            {t('fleetRoster')} ({servers.length})
          </button>
        </div>
        <IconButton chrome size="sm" label={t('close')} onClick={onClose} icon={<IconX size={14} />} />
      </header>

      {tab === 'chat' ? (
        <div className="fleet-body">
          <div className="fleet-log" ref={logRef}>
            {lines.length === 0 ? (
              <div className="fleet-empty">
                <p>{t('fleetEmpty')}</p>
                <ul className="fleet-examples">
                  <li>{t('fleetExample1')}</li>
                  <li>{t('fleetExample2')}</li>
                  <li>{t('fleetExample3')}</li>
                </ul>
              </div>
            ) : (
              <FleetChatLog lines={lines} />
            )}
          </div>
          <div className="fleet-compose">
            <textarea
              className="fleet-input"
              rows={3}
              value={input}
              placeholder={t('fleetPlaceholder')}
              disabled={busy}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  void send()
                }
              }}
            />
            <div className="fleet-compose-actions">
              <button type="button" className="btn sm ghost" onClick={clearChat} disabled={busy}>
                {t('clearChat')}
              </button>
              {busy ? (
                <IconButton
                  size="sm"
                  variant="ghost"
                  showLabel
                  label={t('agentStop')}
                  onClick={stop}
                  icon={<IconStop size={14} />}
                />
              ) : (
                <IconButton
                  size="sm"
                  variant="primary"
                  showLabel
                  label={t('fleetSend')}
                  onClick={() => void send()}
                  disabled={!input.trim()}
                  icon={<IconSend size={14} />}
                />
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="fleet-body fleet-roster-body">
          <div className="fleet-roster-toolbar">
            <button type="button" className="btn sm primary" onClick={() => setAdding(true)}>
              {t('fleetAddServer')}
            </button>
            {groups.length ? (
              <span className="muted small">
                {t('fleetGroups')}: {groups.join(', ')}
              </span>
            ) : null}
          </div>
          {servers.length === 0 ? (
            <p className="muted pad">{t('fleetRosterEmpty')}</p>
          ) : (
            <ul className="fleet-roster-list">
              {servers.map((s) => (
                <li key={s.id} className="fleet-roster-item">
                  <div className="fleet-roster-main">
                    <span className="fleet-roster-name">{s.name}</span>
                    <span className="muted small mono">
                      {s.user}@{s.host}:{s.port}
                    </span>
                    <span className="fleet-roster-meta">
                      {s.group ? <span className="pill">{s.group}</span> : null}
                      {s.role ? <span className="pill">{s.role}</span> : null}
                      <span className="pill">{s.auth_method || (s.identity_file ? 'key' : 'agent')}</span>
                    </span>
                  </div>
                  <div className="fleet-roster-actions">
                    <button type="button" className="btn sm ghost" onClick={() => setEditing(s)}>
                      {t('edit')}
                    </button>
                    <button type="button" className="btn sm ghost danger" onClick={() => void onDelete(s)}>
                      {t('delete')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {(adding || editing) && (
        <FleetServerForm
          open
          server={editing}
          onSubmit={async (input: FleetServerInput) => {
            if (editing) {
              const next = updateFleetServer(editing.id, input)
              if (next) onSaved(next, false)
            } else {
              const created = addFleetServer(input)
              onSaved(created, true)
            }
          }}
          onCancel={() => {
            setAdding(false)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

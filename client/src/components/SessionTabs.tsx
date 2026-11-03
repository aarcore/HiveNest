import type { Host, SessionInfo } from '../api'
import { useI18n } from '../i18n'
import { IconButton, IconX } from './icons'

type Props = {
  sessions: SessionInfo[]
  hosts: Host[]
  activeSessionId: string | null
  onSelect: (sessionId: string) => void
  onClose: (sessionId: string) => void
  localLabel: string
}

export function SessionTabs({
  sessions,
  hosts,
  activeSessionId,
  onSelect,
  onClose,
  localLabel,
}: Props) {
  const { t } = useI18n()
  if (sessions.length === 0) return null

  function labelFor(s: SessionInfo): string {
    if (s.is_local) return localLabel
    const h = hosts.find((x) => x.id === s.host_id)
    return h?.name || s.host_name || s.remote || s.id.slice(0, 8)
  }

  return (
    <div className="session-tabs" role="tablist" aria-label={t('sessionTabs')}>
      {sessions.map((s) => {
        const active = s.id === activeSessionId
        const title = labelFor(s)
        return (
          <div
            key={s.id}
            className={`session-tab${active ? ' is-active' : ''}${s.is_local ? ' is-local' : ''}`}
            role="tab"
            aria-selected={active}
          >
            <button
              type="button"
              className="session-tab-main"
              title={s.is_local ? localLabel : s.remote || title}
              onClick={() => onSelect(s.id)}
            >
              <span className="session-tab-dot" aria-hidden />
              <span className="session-tab-label text-ellipsis">{title}</span>
            </button>
            {!s.is_local ? (
              <IconButton
                chrome
                size="sm"
                className="session-tab-close"
                label={t('closeSessionTab')}
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(s.id)
                }}
                icon={<IconX size={12} />}
              />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

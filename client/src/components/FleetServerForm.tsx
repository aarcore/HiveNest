import { useState } from 'react'
import type { FleetServer, FleetServerInput } from '../fleet'
import { useI18n } from '../i18n'
import { IconButton, IconX } from './icons'

type Props = {
  open: boolean
  /** Editing an existing roster entry. */
  server: FleetServer | null
  onSubmit: (input: FleetServerInput) => Promise<void> | void
  onCancel: () => void
}

const EMPTY: FleetServerInput = {
  name: '',
  host: '',
  port: 22,
  user: 'root',
  auth_method: '',
  identity_file: '',
  use_agent: true,
  group: '',
  role: '',
}

export function FleetServerForm({ open, server, onSubmit, onCancel }: Props) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<FleetServerInput>(() =>
    server
      ? {
          name: server.name,
          host: server.host,
          port: server.port,
          user: server.user,
          auth_method: server.auth_method ?? '',
          identity_file: server.identity_file ?? '',
          use_agent: server.use_agent ?? true,
          group: server.group ?? '',
          role: server.role ?? '',
        }
      : EMPTY,
  )
  const [error, setError] = useState('')

  if (!open) return null

  function set<K extends keyof FleetServerInput>(key: K, value: FleetServerInput[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  async function submit() {
    if (!draft.host.trim()) {
      setError(t('fleetHostRequired'))
      return
    }
    if (!draft.user.trim()) {
      setError(t('fleetUserRequired'))
      return
    }
    setError('')
    await onSubmit({
      ...draft,
      name: draft.name.trim() || draft.host.trim(),
      port: Number(draft.port) > 0 ? Number(draft.port) : 22,
    })
  }

  return (
    <div className="fleet-form-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="fleet-form"
        role="dialog"
        aria-modal="true"
        aria-label={server ? t('fleetEditServer') : t('fleetAddServer')}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="fleet-form-head">
          <strong>{server ? t('fleetEditServer') : t('fleetAddServer')}</strong>
          <IconButton chrome size="sm" label={t('cancel')} onClick={onCancel} icon={<IconX size={14} />} />
        </header>

        <div className="fleet-form-grid">
          <label className="fleet-field">
            <span>{t('name')}</span>
            <input
              value={draft.name ?? ''}
              placeholder="k8s-master-1"
              onChange={(e) => set('name', e.target.value)}
            />
          </label>
          <label className="fleet-field">
            <span>{t('host')}</span>
            <input
              value={draft.host}
              placeholder="10.0.0.11"
              onChange={(e) => set('host', e.target.value)}
            />
          </label>
          <label className="fleet-field">
            <span>{t('port')}</span>
            <input
              type="number"
              min={1}
              max={65535}
              value={draft.port}
              onChange={(e) => set('port', Number(e.target.value))}
            />
          </label>
          <label className="fleet-field">
            <span>{t('user')}</span>
            <input
              value={draft.user}
              placeholder="ubuntu"
              onChange={(e) => set('user', e.target.value)}
            />
          </label>
          <label className="fleet-field">
            <span>{t('authMethod')}</span>
            <select
              value={draft.auth_method ?? ''}
              onChange={(e) => set('auth_method', e.target.value as FleetServerInput['auth_method'])}
            >
              <option value="">{t('fleetAuthAsk')}</option>
              <option value="agent">{t('authAgent')}</option>
              <option value="key">{t('authKey')}</option>
              <option value="password">{t('authPassword')}</option>
            </select>
          </label>
          <label className="fleet-field">
            <span>{t('group')}</span>
            <input
              value={draft.group ?? ''}
              placeholder="prod-k8s"
              onChange={(e) => set('group', e.target.value)}
            />
          </label>
          <label className="fleet-field">
            <span>{t('role')}</span>
            <input
              value={draft.role ?? ''}
              placeholder="control-plane"
              onChange={(e) => set('role', e.target.value)}
            />
          </label>
          {draft.auth_method === 'key' ? (
            <label className="fleet-field fleet-field-wide">
              <span>{t('identityFile')}</span>
              <input
                value={draft.identity_file ?? ''}
                placeholder="~/.ssh/id_ed25519"
                onChange={(e) => set('identity_file', e.target.value)}
              />
            </label>
          ) : null}
        </div>

        <p className="muted small fleet-form-hint">{t('fleetPasswordHint')}</p>
        {error ? <p className="fleet-form-error">{error}</p> : null}

        <footer className="fleet-form-actions">
          <button type="button" className="btn sm ghost" onClick={onCancel}>
            {t('cancel')}
          </button>
          <button type="button" className="btn sm primary" onClick={() => void submit()}>
            {t('save')}
          </button>
        </footer>
      </div>
    </div>
  )
}

import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Host } from '../api'
import { hostHasProxyJump, jumpPasswordCacheKey } from '../api'
import {
  isPasswordRemembered,
  loadPassword,
  peekPassword,
  savePassword,
} from '../passwordCache'
import { useI18n } from '../i18n'

export type ConnectCredentials = {
  password?: string
  jumpPassword?: string
  jumpPasswords?: Record<string, string>
}

type Props = {
  open: boolean
  host: Host | null
  /** Saved jump profile hops (ordered). First password-needing hop used for legacy single field. */
  jumpHost: Host | null
  /** All jump profile hops that need a password (ordered). */
  jumpHostsNeedingPw?: Host[]
  needTargetPassword: boolean
  /** Show bastion password field(s) (required unless jumpPasswordOptional). */
  needJumpPassword: boolean
  /** When true, bastion password may be left blank (key/agent may work). */
  jumpPasswordOptional?: boolean
  busy: boolean
  error: string
  onClose: () => void
  onConnect: (creds: ConnectCredentials) => void
}

export function ConnectPasswordModal({
  open,
  host,
  jumpHost,
  jumpHostsNeedingPw = [],
  needTargetPassword,
  needJumpPassword,
  jumpPasswordOptional = false,
  busy,
  error,
  onClose,
  onConnect,
}: Props) {
  const { t } = useI18n()
  const [password, setPassword] = useState('')
  const [jumpPassword, setJumpPassword] = useState('')
  const [hopPasswords, setHopPasswords] = useState<Record<string, string>>({})
  const [remember, setRemember] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)

  const multiHops = jumpHostsNeedingPw.length > 1

  useEffect(() => {
    if (!open || !host) return
    let cancelled = false
    ;(async () => {
      const targetKey = host.id
      const remembered =
        (needTargetPassword && isPasswordRemembered(targetKey)) ||
        (needJumpPassword &&
          (multiHops
            ? jumpHostsNeedingPw.some((j) => isPasswordRemembered(jumpPasswordCacheKey(host, j)))
            : isPasswordRemembered(jumpPasswordCacheKey(host, jumpHost))))
      if (!cancelled) setRemember(remembered)

      const tp = needTargetPassword ? (await loadPassword(targetKey)) || peekPassword(targetKey) : ''
      if (multiHops) {
        const next: Record<string, string> = {}
        for (const j of jumpHostsNeedingPw) {
          const jk = jumpPasswordCacheKey(host, j)
          next[j.id] = (await loadPassword(jk)) || peekPassword(jk) || ''
        }
        if (!cancelled) {
          setHopPasswords(next)
          setJumpPassword('')
          setPassword(tp)
        }
      } else {
        const jKey = jumpPasswordCacheKey(host, jumpHost)
        const jp = needJumpPassword ? (await loadPassword(jKey)) || peekPassword(jKey) : ''
        if (!cancelled) {
          setJumpPassword(jp)
          setHopPasswords({})
          setPassword(tp)
        }
      }
      setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 0)
    })()
    return () => {
      cancelled = true
    }
  }, [open, host?.id, jumpHost?.id, needTargetPassword, needJumpPassword, multiHops, jumpHostsNeedingPw.map((j) => j.id).join(',')])

  if (!open || !host) return null

  const jumpRequired = needJumpPassword && !jumpPasswordOptional
  const hopsOk =
    !needJumpPassword ||
    jumpPasswordOptional ||
    (multiHops
      ? jumpHostsNeedingPw.every((j) => !!hopPasswords[j.id]?.trim())
      : !!jumpPassword.trim())
  const canSubmit = (!needTargetPassword || !!password.trim()) && hopsOk

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit || !host) return
    const creds: ConnectCredentials = {}
    const persist = remember
    ;(async () => {
      if (needTargetPassword) {
        const p = password.trim()
        await savePassword(host.id, p, persist)
        creds.password = p
      }
      if (needJumpPassword) {
        if (multiHops) {
          const map: Record<string, string> = {}
          for (const j of jumpHostsNeedingPw) {
            const jp = (hopPasswords[j.id] || '').trim()
            await savePassword(jumpPasswordCacheKey(host, j), jp, persist)
            if (jp) map[j.id] = jp
          }
          creds.jumpPasswords = map
          const first = jumpHostsNeedingPw[0]
          if (first && map[first.id]) creds.jumpPassword = map[first.id]
        } else {
          const jp = jumpPassword.trim()
          await savePassword(jumpPasswordCacheKey(host, jumpHost), jp, persist)
          if (jp) {
            creds.jumpPassword = jp
            if (jumpHost) creds.jumpPasswords = { [jumpHost.id]: jp }
            else if (hostHasProxyJump(host)) creds.jumpPasswords = { 'proxy:0': jp }
          }
        }
      }
      onConnect(creds)
    })()
  }

  const title =
    needJumpPassword && needTargetPassword
      ? t('enterPasswords')
      : needJumpPassword && jumpRequired
        ? t('enterJumpPassword')
        : needTargetPassword
          ? t('enterPassword')
          : t('enterPasswords')

  const bastionLabel = (() => {
    if (jumpHostsNeedingPw.length > 0) {
      return jumpHostsNeedingPw
        .map((j) => `${j.name} (${j.user}@${j.host}:${j.port})`)
        .join(' → ')
    }
    if (jumpHost) return `${jumpHost.name} (${jumpHost.user}@${jumpHost.host}:${jumpHost.port})`
    return host.proxy_jump?.trim() || ''
  })()

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal connect-password-modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
      >
        <div className="modal-header">
          <h2>{title}</h2>
        </div>
        <div className="modal-body">
          <p className="muted small connect-target">
            {host.user}@{host.host}:{host.port}
            {bastionLabel ? (
              <>
                <br />
                {t('viaBastion')}: {bastionLabel}
              </>
            ) : null}
          </p>

          {needJumpPassword && multiHops
            ? jumpHostsNeedingPw.map((j, idx) => (
                <label key={j.id} className="password-label">
                  {t('jumpPassword')} [{idx + 1}] {j.name}
                  {jumpPasswordOptional ? ` (${t('optional')})` : ''}
                  <input
                    ref={idx === 0 && !needTargetPassword ? inputRef : undefined}
                    className="password-input"
                    type="password"
                    name={`ssh-jump-password-${j.id}`}
                    autoComplete="current-password"
                    value={hopPasswords[j.id] || ''}
                    onChange={(e) =>
                      setHopPasswords((prev) => ({ ...prev, [j.id]: e.target.value }))
                    }
                    placeholder={t('jumpPasswordPlaceholder')}
                    required={jumpRequired}
                  />
                </label>
              ))
            : null}

          {needJumpPassword && !multiHops ? (
            <label className="password-label">
              {t('jumpPassword')}
              {jumpPasswordOptional ? ` (${t('optional')})` : ''}
              <input
                ref={!needTargetPassword ? inputRef : undefined}
                className="password-input"
                type="password"
                name="ssh-jump-password"
                autoComplete="current-password"
                value={jumpPassword}
                onChange={(e) => setJumpPassword(e.target.value)}
                placeholder={t('jumpPasswordPlaceholder')}
                required={jumpRequired}
              />
            </label>
          ) : null}

          {needJumpPassword && !jumpHost && host.proxy_jump ? (
            <p className="muted small">{t('proxyJumpPasswordHint')}</p>
          ) : null}

          {needTargetPassword ? (
            <label className="password-label">
              {needJumpPassword ? t('targetPassword') : t('password')}
              <input
                ref={inputRef}
                className="password-input"
                type="password"
                name="ssh-password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('passwordPlaceholder')}
                required
              />
            </label>
          ) : null}

          <label className="check">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            {t('rememberPassword')}
          </label>
          <p className="muted small">{t('rememberPasswordHint')}</p>
          {error ? <p className="error-text">{error}</p> : null}
        </div>
        <div className="modal-footer modal-actions">
          <button type="button" className="btn md ghost" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </button>
          <button type="submit" className="btn md primary" disabled={busy || !canSubmit}>
            {busy ? t('connecting') : t('connect')}
          </button>
        </div>
      </form>
    </div>
  )
}

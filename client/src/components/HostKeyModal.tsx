import type { HostKeyInfo } from '../api'
import { useI18n } from '../i18n'

type Props = {
  open: boolean
  info: HostKeyInfo | null
  busy?: boolean
  onReject: () => void
  onAccept: () => void
}

export function HostKeyModal({ open, info, busy, onReject, onAccept }: Props) {
  const { t } = useI18n()
  if (!open || !info) return null
  const mismatch = info.code === 'host_key_mismatch'
  return (
    <div className="modal-backdrop" onClick={onReject}>
      <div className="modal host-key-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-header">
          <h2>{mismatch ? t('hostKeyMismatchTitle') : t('hostKeyUnknownTitle')}</h2>
        </div>
        <div className="modal-body">
          <p className={mismatch ? 'error-text' : 'hint'}>
            {mismatch ? t('hostKeyMismatchBody') : t('hostKeyUnknownBody')}
          </p>
          <dl className="host-key-dl">
            <dt>{t('host')}</dt>
            <dd className="mono">
              {info.host}:{info.port}
            </dd>
            <dt>{t('hostKeyType')}</dt>
            <dd className="mono">{info.key_type}</dd>
            <dt>{t('hostKeyFingerprint')}</dt>
            <dd className="mono fingerprint">{info.fingerprint_sha256}</dd>
            {info.previous_fingerprint ? (
              <>
                <dt>{t('hostKeyPrevious')}</dt>
                <dd className="mono fingerprint">{info.previous_fingerprint}</dd>
              </>
            ) : null}
          </dl>
        </div>
        <div className="modal-footer modal-actions">
          <button type="button" className="btn md ghost" disabled={busy} onClick={onReject}>
            {t('hostKeyReject')}
          </button>
          <button type="button" className={`btn md ${mismatch ? 'danger' : 'primary'}`} disabled={busy} onClick={onAccept}>
            {mismatch ? t('hostKeyReplace') : t('hostKeyAccept')}
          </button>
        </div>
      </div>
    </div>
  )
}

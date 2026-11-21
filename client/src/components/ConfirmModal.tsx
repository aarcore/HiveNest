import { useI18n } from '../i18n'
import { IconButton, IconX } from './icons'

type Props = {
  open: boolean
  title: string
  message: string
  /** Label for the destructive action. */
  confirmLabel?: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * In-app confirmation dialog.
 *
 * `window.confirm` is unavailable in the Tauri webview, where it returns false
 * without showing anything, so a native prompt silently cancels the action. This
 * keeps destructive flows working in both the desktop app and the browser.
 */
export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel,
  danger = true,
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useI18n()
  if (!open) return null
  return (
    <div className="modal-backdrop" role="presentation" onClick={busy ? undefined : onCancel}>
      <div
        className="modal confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) onCancel()
        }}
      >
        <header className="modal-header">
          <strong id="confirm-modal-title">{title}</strong>
          <IconButton
            chrome
            size="sm"
            label={t('cancel')}
            onClick={onCancel}
            disabled={busy}
            icon={<IconX size={14} />}
          />
        </header>
        <div className="modal-body">
          <p>{message}</p>
        </div>
        <footer className="modal-footer modal-actions">
          <button type="button" className="btn md ghost" disabled={busy} onClick={onCancel}>
            {t('cancel')}
          </button>
          <button
            type="button"
            className={`btn md ${danger ? 'danger' : 'primary'}`}
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel || t('delete')}
          </button>
        </footer>
      </div>
    </div>
  )
}

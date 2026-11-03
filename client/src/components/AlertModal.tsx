import { useI18n } from '../i18n'
import { IconButton, IconX } from './icons'

type Props = {
  open: boolean
  title?: string
  message: string
  onClose: () => void
}

/** Blocking alert dialog for rare critical errors (password/host-key keep their own modals). */
export function AlertModal({ open, title, message, onClose }: Props) {
  const { t } = useI18n()
  if (!open || !message) return null
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal alert-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="alert-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <strong id="alert-modal-title">{title || t('error')}</strong>
          <IconButton
            chrome
            size="sm"
            label={t('close')}
            onClick={onClose}
            icon={<IconX size={14} />}
          />
        </header>
        <div className="modal-body">
          <p className="alert-modal-message">{message}</p>
        </div>
        <footer className="modal-footer">
          <button type="button" className="btn md primary" onClick={onClose}>
            {t('close')}
          </button>
        </footer>
      </div>
    </div>
  )
}

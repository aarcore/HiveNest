import { useI18n } from '../i18n'

type Props = { open: boolean; onClose: () => void }

export function HelpModal({ open, onClose }: Props) {
  const { t } = useI18n()
  if (!open) return null
  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal help-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
      >
        <div className="modal-header">
          <h2 id="help-title">{t('helpTitle')}</h2>
          <p className="muted small">{t('helpSubtitle')}</p>
        </div>
        <div className="modal-body help-body">
          <section>
            <h3>{t('helpHostsTitle')}</h3>
            <p>{t('helpHostsBody')}</p>
          </section>
          <section>
            <h3>{t('helpConnectTitle')}</h3>
            <p>{t('helpConnectBody')}</p>
          </section>
          <section>
            <h3>{t('helpAgentTitle')}</h3>
            <p>{t('helpAgentBody')}</p>
          </section>
          <section>
            <h3>{t('helpToolsTitle')}</h3>
            <p>{t('helpToolsBody')}</p>
          </section>
          <section>
            <h3>{t('helpThemesTitle')}</h3>
            <p>{t('helpThemesBody')}</p>
          </section>
          <section>
            <h3>{t('helpSkillsTitle')}</h3>
            <p>{t('helpSkillsBody')}</p>
          </section>
          <section>
            <h3>{t('helpMcpTitle')}</h3>
            <p>{t('helpMcpBody')}</p>
          </section>
        </div>
        <div className="modal-footer modal-actions">
          <button type="button" className="btn md primary btn-stable" onClick={onClose}>
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  )
}

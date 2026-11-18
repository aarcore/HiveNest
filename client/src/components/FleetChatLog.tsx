import { useState } from 'react'
import { useI18n } from '../i18n'
import { renderRichText } from '../agent/richText'

export type FleetLine =
  | { kind: 'assistant'; text: string }
  | { kind: 'step'; text: string }
  | { kind: 'result'; title: string; body: string; failed: boolean }
  | { kind: 'note'; text: string }
  | { kind: 'error'; text: string }
  | {
      kind: 'approval'
      server: string
      command: string
      risk: 'low' | 'medium' | 'high'
      onApprove: () => Promise<void>
    }

function ApprovalLine({
  server,
  command,
  risk,
  onApprove,
}: {
  server: string
  command: string
  risk: 'low' | 'medium' | 'high'
  onApprove: () => Promise<void>
}) {
  const { t } = useI18n()
  const [state, setState] = useState<'pending' | 'done'>('pending')
  return (
    <div className="fleet-line fleet-approval">
      <div className="fleet-approval-head">
        <span className="pill danger">{risk}</span>
        <strong>{server}</strong>
      </div>
      <pre className="fleet-command">{command}</pre>
      <div className="fleet-approval-actions">
        <button
          type="button"
          className="btn sm primary"
          disabled={state === 'done'}
          onClick={async () => {
            await onApprove()
            setState('done')
          }}
        >
          {t('approve')}
        </button>
        <button type="button" className="btn sm ghost" disabled={state === 'done'} onClick={() => setState('done')}>
          {t('deny')}
        </button>
      </div>
    </div>
  )
}

export function FleetChatLog({ lines }: { lines: FleetLine[] }) {
  return (
    <div className="fleet-lines">
      {lines.map((line, i) => {
        switch (line.kind) {
          case 'assistant':
            return (
              <div key={i} className="bubble assistant">
                {renderRichText(line.text)}
              </div>
            )
          case 'step':
            return (
              <div key={i} className="fleet-line fleet-step">
                <span className="mono">$ {line.text}</span>
              </div>
            )
          case 'result':
            return (
              <div key={i} className={`fleet-line fleet-result${line.failed ? ' is-failed' : ''}`}>
                <div className="fleet-result-title">{line.title}</div>
                <pre className="fleet-result-body">{line.body}</pre>
              </div>
            )
          case 'note':
            return (
              <div key={i} className="bubble note">
                {line.text}
              </div>
            )
          case 'error':
            return (
              <div key={i} className="bubble error">
                {line.text}
              </div>
            )
          case 'approval':
            return (
              <ApprovalLine
                key={i}
                server={line.server}
                command={line.command}
                risk={line.risk}
                onApprove={line.onApprove}
              />
            )
          default:
            return null
        }
      })}
    </div>
  )
}

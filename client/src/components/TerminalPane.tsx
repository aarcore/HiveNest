import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { ptyWsUrl } from '../api'
import { useI18n } from '../i18n'
import { useTheme } from '../theme'

type Props = {
  sessionId: string | null
  remoteLabel?: string
  /** When true, refit xterm after becoming visible (multi-session tabs). */
  active?: boolean
  /** Bumps when Agent dock / height / collapse changes so FitAddon remeasures. */
  layoutKey?: string | number
}

export function TerminalPane({ sessionId, remoteLabel, active = true, layoutKey }: Props) {
  const { t } = useI18n()
  const { xtermTheme } = useTheme()
  const hostRef = useRef<HTMLDivElement>(null)
  const paneRef = useRef<HTMLElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (!hostRef.current) return
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      theme: { ...xtermTheme },
      convertEol: true,
      allowProposedApi: true,
      scrollback: 5000,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(hostRef.current)
    // Defer fit until layout settles
    requestAnimationFrame(() => {
      try {
        fit.fit()
      } catch {
        /* ignore */
      }
    })
    termRef.current = term
    fitRef.current = fit

    let fitRaf = 0
    const runFit = () => {
      try {
        fit.fit()
        const ws = wsRef.current
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
        }
      } catch {
        /* ignore */
      }
    }
    const onResize = () => {
      // Coalesce + wait a frame so grid track / --agent-bottom-h layout has settled.
      if (fitRaf) cancelAnimationFrame(fitRaf)
      fitRaf = requestAnimationFrame(() => {
        fitRaf = 0
        runFit()
      })
    }
    window.addEventListener('resize', onResize)
    const ro = new ResizeObserver(onResize)
    if (paneRef.current) ro.observe(paneRef.current)
    if (hostRef.current) ro.observe(hostRef.current)

    return () => {
      window.removeEventListener('resize', onResize)
      if (fitRaf) cancelAnimationFrame(fitRaf)
      ro.disconnect()
      wsRef.current?.close()
      wsRef.current = null
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Live-apply terminal theme: xterm only reacts when options.theme is a *new*
  // object reference (see ITerminalOptions docs). Also paint .term-host so the
  // padding chrome matches the terminal bg (not app --code-bg).
  useEffect(() => {
    const term = termRef.current
    const host = hostRef.current
    const next = { ...xtermTheme }
    if (term) {
      term.options.theme = next
    }
    if (host) {
      const bg = next.background || '#0b0d12'
      const fg = next.foreground || '#e6eaf2'
      host.style.backgroundColor = bg
      host.style.color = fg
      host.style.setProperty('--term-bg', bg)
      host.style.setProperty('--term-fg', fg)
    }
  }, [xtermTheme])

  useEffect(() => {
    const term = termRef.current
    const fit = fitRef.current
    if (!term || !fit) return

    let alive = true
    wsRef.current?.close()
    wsRef.current = null

    if (!sessionId) {
      term.clear()
      term.writeln('\x1b[90m' + t('noSession') + '\x1b[0m')
      return
    }

    try {
      fit.fit()
    } catch {
      /* ignore */
    }
    term.clear()
    term.writeln(`\x1b[36mConnecting PTY…\x1b[0m`)

    const url = ptyWsUrl(sessionId, term.cols, term.rows)
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws

    const dataDisp = term.onData((data) => {
      if (alive && ws.readyState === WebSocket.OPEN) ws.send(data)
    })
    const resizeDisp = term.onResize(({ cols, rows }) => {
      if (alive && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }))
      }
    })

    ws.onopen = () => {
      if (!alive) return
      term.clear()
      term.focus()
    }
    ws.onmessage = (ev) => {
      if (!alive) return
      if (typeof ev.data === 'string') term.write(ev.data)
      else term.write(new Uint8Array(ev.data as ArrayBuffer))
    }
    ws.onerror = () => {
      // Only surface errors for the active socket (ignore StrictMode/remount teardown).
      if (!alive || wsRef.current !== ws) return
      term.writeln('\r\n\x1b[31mWebSocket error\x1b[0m')
    }
    ws.onclose = () => {
      if (!alive || wsRef.current !== ws) return
      term.writeln('\r\n\x1b[90mPTY closed\x1b[0m')
    }

    return () => {
      alive = false
      dataDisp.dispose()
      resizeDisp.dispose()
      if (wsRef.current === ws) {
        wsRef.current = null
      }
      // Close after clearing ref so onclose/onerror do not paint on the terminal.
      try {
        ws.close()
      } catch {
        /* ignore */
      }
    }
  }, [sessionId, t])

  useEffect(() => {
    if (!active) return
    const fit = fitRef.current
    const term = termRef.current
    if (!fit || !term) return
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      // Second frame: CSS grid track (--agent-bottom-h) has applied.
      raf2 = requestAnimationFrame(() => {
        try {
          fit.fit()
          const ws = wsRef.current
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
          }
        } catch {
          /* ignore */
        }
      })
    })
    return () => {
      cancelAnimationFrame(raf1)
      if (raf2) cancelAnimationFrame(raf2)
    }
  }, [active, layoutKey])

  return (
    <section
      className="pane terminal-pane"
      ref={paneRef}
      aria-label={remoteLabel ? `${t('terminal')}: ${remoteLabel}` : t('terminal')}
    >
      <div
        className="term-host"
        ref={hostRef}
        style={{
          backgroundColor: xtermTheme.background || '#0b0d12',
          color: xtermTheme.foreground || '#e6eaf2',
          // CSS vars for any nested rules that prefer variables
          ['--term-bg' as string]: xtermTheme.background || '#0b0d12',
          ['--term-fg' as string]: xtermTheme.foreground || '#e6eaf2',
        }}
      />
    </section>
  )
}

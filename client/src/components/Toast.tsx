import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../i18n'
import { IconButton, IconX } from './icons'

export type ToastVariant = 'error' | 'success' | 'info' | 'warning'

export type ToastInput = {
  message: string
  variant?: ToastVariant
  /** Auto-dismiss ms; 0 = sticky until closed. Default 5500 for non-error, 8000 for error. */
  durationMs?: number
  title?: string
}

type ToastItem = Required<Pick<ToastInput, 'message' | 'variant'>> & {
  id: string
  title?: string
  durationMs: number
}

type ToastApi = {
  push: (input: ToastInput | string) => string
  error: (message: string, opts?: Omit<ToastInput, 'message' | 'variant'>) => string
  success: (message: string, opts?: Omit<ToastInput, 'message' | 'variant'>) => string
  info: (message: string, opts?: Omit<ToastInput, 'message' | 'variant'>) => string
  warning: (message: string, opts?: Omit<ToastInput, 'message' | 'variant'>) => string
  dismiss: (id: string) => void
  clear: () => void
}

const ToastCtx = createContext<ToastApi | null>(null)

let toastSeq = 0
function nextId() {
  toastSeq += 1
  return `toast-${Date.now()}-${toastSeq}`
}

function defaultDuration(variant: ToastVariant, override?: number) {
  if (override !== undefined) return override
  if (variant === 'error') return 8000
  if (variant === 'warning') return 7000
  return 5500
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const timers = useRef<Map<string, number>>(new Map())

  const dismiss = useCallback((id: string) => {
    const t = timers.current.get(id)
    if (t) {
      window.clearTimeout(t)
      timers.current.delete(id)
    }
    setItems((prev) => prev.filter((x) => x.id !== id))
  }, [])

  const clear = useCallback(() => {
    for (const t of timers.current.values()) window.clearTimeout(t)
    timers.current.clear()
    setItems([])
  }, [])

  const push = useCallback(
    (input: ToastInput | string) => {
      const raw: ToastInput = typeof input === 'string' ? { message: input } : input
      const message = (raw.message || '').trim()
      if (!message) return ''
      const variant = raw.variant || 'info'
      const id = nextId()
      const durationMs = defaultDuration(variant, raw.durationMs)
      const item: ToastItem = {
        id,
        message,
        variant,
        title: raw.title,
        durationMs,
      }
      setItems((prev) => [...prev, item].slice(-6))
      if (durationMs > 0) {
        const handle = window.setTimeout(() => dismiss(id), durationMs)
        timers.current.set(id, handle)
      }
      return id
    },
    [dismiss],
  )

  const api = useMemo<ToastApi>(
    () => ({
      push,
      error: (message, opts) => push({ ...opts, message, variant: 'error' }),
      success: (message, opts) => push({ ...opts, message, variant: 'success' }),
      info: (message, opts) => push({ ...opts, message, variant: 'info' }),
      warning: (message, opts) => push({ ...opts, message, variant: 'warning' }),
      dismiss,
      clear,
    }),
    [push, dismiss, clear],
  )

  useEffect(() => {
    return () => {
      for (const t of timers.current.values()) window.clearTimeout(t)
      timers.current.clear()
    }
  }, [])

  useEffect(() => {
    const root = document.documentElement
    if (items.length > 0) root.setAttribute('data-app-toasts', '1')
    else root.removeAttribute('data-app-toasts')
    return () => root.removeAttribute('data-app-toasts')
  }, [items.length])

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <ToastViewport items={items} onDismiss={dismiss} />
    </ToastCtx.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx)
  if (!ctx) throw new Error('ToastProvider missing')
  return ctx
}

function ToastViewport({
  items,
  onDismiss,
}: {
  items: ToastItem[]
  onDismiss: (id: string) => void
}) {
  const { t } = useI18n()
  if (items.length === 0) return null
  const node = (
    <div className="toast-viewport" aria-live="polite" aria-relevant="additions text">
      {items.map((item) => (
        <div
          key={item.id}
          className={`toast toast-${item.variant}`}
          role={item.variant === 'error' || item.variant === 'warning' ? 'alert' : 'status'}
        >
          <div className="toast-body">
            <strong className="toast-title">
              {item.title ||
                (item.variant === 'error'
                  ? t('error')
                  : item.variant === 'success'
                    ? t('toastSuccess')
                    : item.variant === 'warning'
                      ? t('toastWarning')
                      : t('toastInfo'))}
            </strong>
            <p className="toast-message">{item.message}</p>
          </div>
          <IconButton
            chrome
            size="sm"
            className="toast-close"
            label={t('dismissToast')}
            onClick={() => onDismiss(item.id)}
            icon={<IconX size={14} />}
          />
        </div>
      ))}
    </div>
  )
  return createPortal(node, document.body)
}

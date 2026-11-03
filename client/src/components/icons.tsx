import type { ButtonHTMLAttributes, ReactNode } from 'react'

const svgProps = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true as const,
}

export type IconProps = { size?: number; className?: string }

function sized({ size = 16, className }: IconProps) {
  return { ...svgProps, width: size, height: size, className }
}

export function IconHelp(p: IconProps = {}) {
  return (
    <svg {...sized(p)}>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}

export function IconSettings(p: IconProps = {}) {
  return (
    <svg {...sized(p)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

export function IconRefresh(p: IconProps = {}) {
  return (
    <svg {...sized(p)}>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  )
}

export function IconPlus(p: IconProps = {}) {
  return (
    <svg {...sized(p)}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

export function IconChevronLeft(p: IconProps = {}) {
  return (
    <svg {...sized(p)}>
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}

export function IconChevronRight(p: IconProps = {}) {
  return (
    <svg {...sized(p)}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

export function IconConnect(p: IconProps = {}) {
  return (
    <svg {...sized(p)}>
      <path d="M12 2v8" />
      <path d="M8 6h8" />
      <rect x="5" y="12" width="14" height="8" rx="2" />
      <path d="M9 16h6" />
    </svg>
  )
}

export function IconDisconnect(p: IconProps = {}) {
  return (
    <svg {...sized(p)}>
      <path d="M12 2v5" />
      <path d="M8 4h8" />
      <path d="M9 12h6" />
      <rect x="5" y="12" width="14" height="8" rx="2" />
      <line x1="4" y1="4" x2="20" y2="20" />
    </svg>
  )
}

export function IconEdit(p: IconProps = {}) {
  return (
    <svg {...sized(p)}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

export function IconTrash(p: IconProps = {}) {
  return (
    <svg {...sized(p)}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  )
}

export function IconAlertCircle(p: IconProps = {}) {
  return (
    <svg {...sized(p)}>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  )
}

export function IconSlidersOff(p: IconProps = {}) {
  return (
    <svg {...sized(p)}>
      <circle cx="12" cy="12" r="9" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  )
}

export function IconCheck(p: IconProps = {}) {
  return (
    <svg {...sized(p)}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

export function IconX(p: IconProps = {}) {
  return (
    <svg {...sized(p)}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

export function IconUpload(p: IconProps = {}) {
  return (
    <svg {...sized(p)}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  )
}


export function IconStop(p: IconProps = {}) {
  return (
    <svg {...sized(p)}>
      <rect x="6" y="6" width="12" height="12" rx="1" />
    </svg>
  )
}

export function IconPanelBottom(p: IconProps = {}) {
  /* Target: dock agent below terminal */
  return (
    <svg {...sized(p)}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 14h18" />
    </svg>
  )
}

export function IconPanelRight(p: IconProps = {}) {
  /* Target: dock agent on the right */
  return (
    <svg {...sized(p)}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M14 3v18" />
    </svg>
  )
}

export function IconClear(p: IconProps = {}) {
  return (
    <svg {...sized(p)}>
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  )
}

export function IconHistory(p: IconProps = {}) {
  return (
    <svg {...sized(p)}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

export function IconPlay(p: IconProps = {}) {
  return (
    <svg {...sized(p)}>
      <polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconProbe(p: IconProps = {}) {
  return (
    <svg {...sized(p)}>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

export function IconSend(p: IconProps = {}) {
  return (
    <svg {...sized(p)}>
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  )
}

export function IconTerminal(p: IconProps = {}) {
  return (
    <svg {...sized(p)}>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  )
}

export function IconArrowUp(p: IconProps = {}) {
  return (
    <svg {...sized(p)}>
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  )
}

export function IconArrowDown(p: IconProps = {}) {
  return (
    <svg {...sized(p)}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <polyline points="19 12 12 19 5 12" />
    </svg>
  )
}

export function IconSpinner(p: IconProps = {}) {
  return (
    <svg {...sized(p)} className={`icon-spin ${p.className || ''}`.trim()}>
      <path d="M12 2a10 10 0 0 1 10 10" />
      <path d="M12 2a10 10 0 0 0-7 2.5" opacity="0.35" />
    </svg>
  )
}


export function IconKey(p: IconProps = {}) {
  return (
    <svg {...sized(p)}>
      <circle cx="8" cy="15" r="4" />
      <path d="M10.5 12.5L21 2" />
      <path d="M16 3l2 2" />
      <path d="M19 6l2 2" />
    </svg>
  )
}

export function IconLock(p: IconProps = {}) {
  return (
    <svg {...sized(p)}>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

export function IconAgentAuth(p: IconProps = {}) {
  return (
    <svg {...sized(p)}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M9 9h6M9 12h6M9 15h4" />
    </svg>
  )
}

export type IconButtonProps = {
  label: string
  icon: ReactNode
  /** Show visible text beside the icon (action buttons). */
  showLabel?: boolean
  /** sm 28 / md 32 / lg 36; `tiny` aliases to sm. */
  size?: 'md' | 'sm' | 'lg' | 'tiny'
  variant?: 'default' | 'primary' | 'danger' | 'ghost'
  /**
   * Icon-only chrome: square hit target, no border/radius (Aaron / UI DESIGNER).
   * Ignored when `showLabel` is true — labeled controls use `.btn`.
   */
  chrome?: boolean
  /** Optional tooltip override; aria-label always uses `label`. */
  title?: string
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label' | 'title'>

function normalizeBtnSize(size: IconButtonProps['size']): 'sm' | 'md' | 'lg' {
  if (size === 'lg') return 'lg'
  if (size === 'md') return 'md'
  return 'sm' // tiny + sm
}

export function IconButton({
  label,
  icon,
  showLabel = false,
  size = 'sm',
  variant = 'default',
  chrome = false,
  className = '',
  type = 'button',
  title,
  ...rest
}: IconButtonProps) {
  const sizeClass = normalizeBtnSize(size)
  const variantClass = variant === 'default' ? '' : variant

  let classes: string
  if (chrome && !showLabel) {
    classes = ['btn-chrome', sizeClass, variantClass, className].filter(Boolean).join(' ')
  } else if (showLabel) {
    // Action button: .btn.sm|md|lg (+ variant); keep glyph/text structure
    classes = ['btn', sizeClass, variantClass, className].filter(Boolean).join(' ')
  } else {
    // Legacy icon-btn path (prefer chrome={true} for new icon-only)
    classes = ['btn', 'icon-btn', sizeClass, variantClass, className].filter(Boolean).join(' ')
  }

  return (
    <button type={type} className={classes} title={title ?? label} aria-label={label} {...rest}>
      <span className="icon-btn-glyph" aria-hidden="true">
        {icon}
      </span>
      {showLabel ? <span className="icon-btn-text">{label}</span> : null}
    </button>
  )
}

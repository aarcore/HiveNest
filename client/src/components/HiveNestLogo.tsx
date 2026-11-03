/**
 * Inline Hive Nest brand mark (SVG). Use lockup in chrome; mark-only in rails.
 */

type Variant = 'mark' | 'lockup'
type Theme = 'light' | 'dark' | 'auto'

type Props = {
  variant?: Variant
  theme?: Theme
  /** Height in px; width follows aspect ratio */
  size?: number
  className?: string
  title?: string
}

const MARK_VIEW = '0 0 64 64'
const LOCKUP_VIEW = '0 0 320 64'

function MarkPaths({ ink }: { ink: string }) {
  return (
    <>
      <polygon
        fill="none"
        stroke="#E5A319"
        strokeWidth={3.5}
        strokeLinejoin="round"
        points="32,6 54.5,19 54.5,45 32,58 9.5,45 9.5,19"
      />
      <path fill={ink} d="M24 22h6v20h-6V22zm6 10 14-10v20L30 32z" />
    </>
  )
}

export function HiveNestLogo({
  variant = 'mark',
  theme = 'auto',
  size = 28,
  className,
  title = 'Hive Nest',
}: Props) {
  const ink =
    theme === 'dark' ? '#E8ECF4' : theme === 'light' ? '#111827' : 'var(--text, #111827)'

  if (variant === 'lockup') {
    const h = size
    const w = Math.round((320 / 64) * h)
    return (
      <svg
        className={className}
        width={w}
        height={h}
        viewBox={LOCKUP_VIEW}
        role="img"
        aria-label={title}
      >
        <g transform="translate(4 4) scale(0.875)">
          <MarkPaths ink={ink} />
        </g>
        <text
          x={68}
          y={41}
          fill={ink}
          fontFamily="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
          fontSize={22}
          fontWeight={600}
          letterSpacing="-0.02em"
        >
          Hive Nest
        </text>
      </svg>
    )
  }

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={MARK_VIEW}
      role="img"
      aria-label={title}
    >
      <MarkPaths ink={ink} />
    </svg>
  )
}

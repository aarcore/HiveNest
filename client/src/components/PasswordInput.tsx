import { forwardRef, useState, type InputHTMLAttributes } from 'react'
import { useI18n } from '../i18n'
import { IconEye, IconEyeOff } from './icons'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  /** Class names for the input element itself. */
  inputClassName?: string
}

/**
 * Password field with a reveal toggle.
 *
 * The toggle is a real button so it is reachable by keyboard and announced to
 * screen readers. It only flips the input's `type`, never the value, and starts
 * masked again whenever the field remounts (new dialog, next jump hop).
 */
export const PasswordInput = forwardRef<HTMLInputElement, Props>(function PasswordInput(
  { inputClassName = '', disabled, ...rest },
  ref,
) {
  const { t } = useI18n()
  const [visible, setVisible] = useState(false)
  const label = visible ? t('hidePassword') : t('showPassword')

  return (
    <div className="password-field">
      <input
        {...rest}
        ref={ref}
        type={visible ? 'text' : 'password'}
        className={inputClassName}
        disabled={disabled}
      />
      <button
        type="button"
        className="password-reveal"
        aria-label={label}
        aria-pressed={visible}
        title={label}
        disabled={disabled}
        // Keep the caret in the field: mousedown alone would blur the input.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? <IconEyeOff size={16} /> : <IconEye size={16} />}
      </button>
    </div>
  )
})

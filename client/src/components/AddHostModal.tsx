import { useEffect, useState, type FormEvent } from 'react'
import { createHost, updateHost, type AuthMethod, type Host, type JumpHopSpec } from '../api'
import { forgetPassword, isPasswordRemembered, loadPassword, savePassword } from '../passwordCache'
import { useI18n } from '../i18n'
import { IconButton, IconArrowDown, IconArrowUp, IconPlus, IconX } from './icons'

function emptyHop(method: AuthMethod = 'key'): JumpHopSpec {
  return {
    auth_method: method,
    identity_file: method === 'key' ? '~/.ssh/id_ed25519' : '',
    use_agent: method === 'agent',
  }
}

/** Split OpenSSH-style ProxyJump on commas. */
export function splitProxyJump(s: string): string[] {
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
}

type Props = {
  open: boolean
  /** When set, modal edits this host instead of creating. */
  host?: Host | null
  /** Other hosts available as jump / bastion targets. */
  hosts?: Host[]
  onClose: () => void
  onCreated: (h: Host) => void
  onUpdated?: (h: Host) => void
}

export function AddHostModal({ open, host, hosts = [], onClose, onCreated, onUpdated }: Props) {
  const { t } = useI18n()
  const editing = !!host
  const [name, setName] = useState('')
  const [addr, setAddr] = useState('127.0.0.1')
  const [port, setPort] = useState(22)
  const [user, setUser] = useState('')
  const [authMethod, setAuthMethod] = useState<AuthMethod>('key')
  const [identity, setIdentity] = useState('~/.ssh/id_ed25519')
  const [useAgent, setUseAgent] = useState(false)
  const [password, setPassword] = useState('')
  const [rememberPw, setRememberPw] = useState(true)
  const [jumpHostIds, setJumpHostIds] = useState<string[]>([])
  const [addJumpId, setAddJumpId] = useState('')
  const [proxyJump, setProxyJump] = useState('')
  const [jumpAuthMethod, setJumpAuthMethod] = useState<AuthMethod>('key')
  const [jumpIdentity, setJumpIdentity] = useState('~/.ssh/id_ed25519')
  const [jumpUseAgent, setJumpUseAgent] = useState(false)
  const [jumpHops, setJumpHops] = useState<JumpHopSpec[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!open) return
    setErr('')
    setBusy(false)
    setPassword('')
    setRememberPw(host ? isPasswordRemembered(host.id) : true)
    if (host) {
      void loadPassword(host.id).then((pw) => {
        if (pw) {
          setPassword(pw)
          setRememberPw(true)
        }
      })
    }
    if (host) {
      setName(host.name || '')
      setAddr(host.host || '')
      setPort(host.port || 22)
      setUser(host.user || '')
      const method: AuthMethod =
        host.auth_method === 'password' || host.auth_method === 'agent' || host.auth_method === 'key'
          ? host.auth_method
          : host.use_agent && !host.identity_file
            ? 'agent'
            : 'key'
      setAuthMethod(method)
      setIdentity(host.identity_file || '~/.ssh/id_ed25519')
      setUseAgent(!!host.use_agent)
      const chain =
        host.jump_host_ids && host.jump_host_ids.length
          ? host.jump_host_ids
          : host.jump_host_id
            ? [host.jump_host_id]
            : []
      setJumpHostIds(chain)
      setAddJumpId('')
      setProxyJump(host.proxy_jump || '')
      const jMethod: AuthMethod =
        host.jump_auth_method === 'password' ||
        host.jump_auth_method === 'agent' ||
        host.jump_auth_method === 'key'
          ? host.jump_auth_method
          : host.jump_identity_file
            ? 'key'
            : host.jump_use_agent
              ? 'agent'
              : 'key'
      setJumpAuthMethod(jMethod)
      setJumpIdentity(host.jump_identity_file || '~/.ssh/id_ed25519')
      setJumpUseAgent(!!host.jump_use_agent)
      const specs = splitProxyJump(host.proxy_jump || '')
      const hops = host.jump_hops || []
      const aligned: JumpHopSpec[] = specs.map((_, i) => {
        const h = hops[i]
        if (h) {
          return {
            auth_method: (h.auth_method as AuthMethod) || 'key',
            identity_file: h.identity_file || '',
            use_agent: !!h.use_agent,
          }
        }
        if (i === 0) {
          return {
            auth_method: jMethod,
            identity_file: host.jump_identity_file || '',
            use_agent: !!host.jump_use_agent,
          }
        }
        return emptyHop('key')
      })
      setJumpHops(aligned)
    } else {
      setName('')
      setAddr('127.0.0.1')
      setPort(22)
      setUser('')
      setAuthMethod('key')
      setIdentity('~/.ssh/id_ed25519')
      setUseAgent(false)
      setJumpHostIds([])
      setAddJumpId('')
      setProxyJump('')
      setJumpAuthMethod('key')
      setJumpIdentity('~/.ssh/id_ed25519')
      setJumpUseAgent(false)
      setJumpHops([])
    }
  }, [open, host])

  if (!open) return null

  const useJumpProfile = jumpHostIds.length > 0
  const proxyHopSpecs = splitProxyJump(proxyJump)
  const showProxyJumpAuth = !useJumpProfile && proxyHopSpecs.length > 0

  function onProxyJumpChange(value: string) {
    setProxyJump(value)
    const specs = splitProxyJump(value)
    setJumpHops((prev) => {
      const next = specs.map((_, i) => prev[i] || (i === 0 ? {
        auth_method: jumpAuthMethod,
        identity_file: jumpIdentity,
        use_agent: jumpUseAgent,
      } : emptyHop('key')))
      return next
    })
  }

  function updateHop(idx: number, patch: Partial<JumpHopSpec>) {
    setJumpHops((prev) => {
      const next = [...prev]
      while (next.length <= idx) next.push(emptyHop('key'))
      next[idx] = { ...next[idx], ...patch }
      return next
    })
    if (idx === 0) {
      if (patch.auth_method !== undefined) setJumpAuthMethod(patch.auth_method || 'key')
      if (patch.identity_file !== undefined) setJumpIdentity(patch.identity_file || '')
      if (patch.use_agent !== undefined) setJumpUseAgent(!!patch.use_agent)
    }
  }

  function moveJump(idx: number, dir: -1 | 1) {
    setJumpHostIds((prev) => {
      const next = [...prev]
      const j = idx + dir
      if (j < 0 || j >= next.length) return prev
      ;[next[idx], next[j]] = [next[j], next[idx]]
      return next
    })
  }

  function addJumpHop() {
    const id = addJumpId.trim()
    if (!id || jumpHostIds.includes(id)) return
    setJumpHostIds((prev) => [...prev, id])
    setAddJumpId('')
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      const method = authMethod || 'key'
      const hops = useJumpProfile || !proxyJump.trim() ? [] : proxyHopSpecs.map((_, i) => {
        const h = jumpHops[i] || (i === 0
          ? { auth_method: jumpAuthMethod, identity_file: jumpIdentity, use_agent: jumpUseAgent }
          : emptyHop('key'))
        const hm = (h.auth_method || 'key') as AuthMethod
        return {
          auth_method: hm,
          identity_file: hm === 'password' || hm === 'agent' ? '' : (h.identity_file || '').trim(),
          use_agent: hm === 'agent' ? true : hm === 'key' ? !!h.use_agent : false,
        } satisfies JumpHopSpec
      })
      const hop0 = hops[0]
      const jMethod = (hop0?.auth_method || jumpAuthMethod || 'key') as AuthMethod
      const input = {
        name: name.trim(),
        host: addr.trim(),
        port: Number(port) || 22,
        user: user.trim(),
        auth_method: method,
        identity_file: method === 'password' ? '' : identity.trim(),
        use_agent: method === 'agent' ? true : method === 'key' ? useAgent : false,
        jump_host_ids: useJumpProfile ? jumpHostIds : [],
        jump_host_id: useJumpProfile ? jumpHostIds[0] || '' : '',
        proxy_jump: useJumpProfile ? '' : proxyJump.trim(),
        jump_identity_file:
          useJumpProfile || !proxyJump.trim() || jMethod === 'password' || jMethod === 'agent'
            ? ''
            : (hop0?.identity_file || jumpIdentity).trim(),
        jump_use_agent:
          useJumpProfile || !proxyJump.trim()
            ? false
            : jMethod === 'agent'
              ? true
              : jMethod === 'key'
                ? !!(hop0?.use_agent ?? jumpUseAgent)
                : false,
        jump_auth_method: useJumpProfile || !proxyJump.trim() ? ('' as AuthMethod) : jMethod,
        jump_hops: hops,
      }
      let saved: Host
      if (editing && host) {
        saved = await updateHost(host.id, input)
        onUpdated?.(saved)
      } else {
        saved = await createHost(input)
        onCreated(saved)
      }
      // Persist to vault when Remember is checked; never write plaintext into hosts.json.
      // Empty password on edit + still Remember → keep existing vault entry.
      if (method === 'password') {
        const pw = password.trim()
        if (pw) {
          await savePassword(saved.id, pw, rememberPw)
        } else if (!rememberPw) {
          await forgetPassword(saved.id)
        }
      } else {
        await forgetPassword(saved.id)
      }
      onClose()
    } catch (ex: any) {
      setErr(ex.message || String(ex))
    } finally {
      setBusy(false)
    }
  }

  function onAuthMethodChange(m: AuthMethod) {
    setAuthMethod(m)
    if (m === 'password' && !editing) setRememberPw(true)
  }

  function AuthSegment({
    value,
    onChange,
    name,
  }: {
    value: AuthMethod
    onChange: (m: AuthMethod) => void
    name: string
  }) {
    return (
      <div className="auth-segment" role="radiogroup" aria-label={t('authMethod')}>
        <label className={`auth-chip${value === 'key' ? ' is-selected' : ''}`}>
          <input type="radio" name={name} checked={value === 'key'} onChange={() => onChange('key')} />
          <span>{t('authKey')}</span>
        </label>
        <label className={`auth-chip${value === 'password' ? ' is-selected' : ''}`}>
          <input
            type="radio"
            name={name}
            checked={value === 'password'}
            onChange={() => onChange('password')}
          />
          <span>{t('authPassword')}</span>
        </label>
        <label className={`auth-chip${value === 'agent' ? ' is-selected' : ''}`}>
          <input
            type="radio"
            name={name}
            checked={value === 'agent'}
            onChange={() => onChange('agent')}
          />
          <span>{t('authAgent')}</span>
        </label>
      </div>
    )
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal host-modal" onClick={(e) => e.stopPropagation()} onSubmit={onSubmit}>
        <div className="modal-header">
          <h2>{editing ? t('editHost') : t('addHost')}</h2>
        </div>
        <div className="modal-body">
          <label>
            {t('name')}
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="web-1" />
          </label>
          <label>
            {t('host')}
            <input value={addr} onChange={(e) => setAddr(e.target.value)} required />
          </label>
          <label>
            {t('port')}
            <input type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} />
          </label>
          <label>
            {t('user')}
            <input value={user} onChange={(e) => setUser(e.target.value)} required />
          </label>
          <div className="auth-field">
            <span className="auth-field-label">{t('authMethod')}</span>
            <AuthSegment value={authMethod} onChange={onAuthMethodChange} name="auth" />
            <p className="auth-hint muted small">
              {authMethod === 'password'
                ? t('authPasswordDesc')
                : authMethod === 'agent'
                  ? t('authAgentDesc')
                  : t('authKeyDesc')}
            </p>
          </div>
          <div className="auth-field">
            <span className="auth-field-label">{t('jumpChain')}</span>
            <p className="auth-hint muted small">{t('jumpChainHint')}</p>
            {jumpHostIds.length ? (
              <ol className="jump-chain-list">
                {jumpHostIds.map((id, idx) => {
                  const h = hosts.find((x) => x.id === id)
                  const label = h
                    ? `${h.name} (${h.user}@${h.host}:${h.port})`
                    : id
                  return (
                    <li key={`${id}-${idx}`} className="jump-chain-item">
                      <span className="jump-chain-label">
                        {idx + 1}. {label}
                      </span>
                      <span className="jump-chain-actions">
                        <IconButton
                          chrome
                          size="sm"
                          label={t('jumpMoveUp')}
                          disabled={idx === 0}
                          onClick={() => moveJump(idx, -1)}
                          icon={<IconArrowUp size={14} />}
                        />
                        <IconButton
                          chrome
                          size="sm"
                          label={t('jumpMoveDown')}
                          disabled={idx === jumpHostIds.length - 1}
                          onClick={() => moveJump(idx, 1)}
                          icon={<IconArrowDown size={14} />}
                        />
                        <IconButton
                          chrome
                          size="sm"
                          label={t('jumpRemove')}
                          onClick={() =>
                            setJumpHostIds((prev) => prev.filter((_, i) => i !== idx))
                          }
                          icon={<IconX size={14} />}
                        />
                      </span>
                    </li>
                  )
                })}
              </ol>
            ) : (
              <p className="muted small">{t('jumpHostNone')}</p>
            )}
            <div className="jump-chain-add">
              <select value={addJumpId} onChange={(e) => setAddJumpId(e.target.value)}>
                <option value="">{t('jumpAddHop')}</option>
                {hosts
                  .filter((h) => (!host || h.id !== host.id) && !jumpHostIds.includes(h.id))
                  .map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name} ({h.user}@{h.host}:{h.port})
                    </option>
                  ))}
              </select>
              <IconButton
                size="md"
                variant="ghost"
                showLabel
                label={t('jumpAdd')}
                disabled={!addJumpId}
                onClick={addJumpHop}
                icon={<IconPlus size={16} />}
              />
            </div>
          </div>
          {!useJumpProfile ? (
            <>
              <label>
                {t('proxyJump')}
                <input
                  value={proxyJump}
                  onChange={(e) => onProxyJumpChange(e.target.value)}
                  placeholder={t('proxyJumpPlaceholder')}
                />
              </label>
              {showProxyJumpAuth ? (
                <div className="auth-field jump-auth-field">
                  <p className="auth-hint muted small">{t('proxyJumpHopsHint')}</p>
                  <p className="muted small">{t('jumpHopPreferProfiles')}</p>
                  {proxyHopSpecs.map((spec, idx) => {
                    const hop = jumpHops[idx] || emptyHop(idx === 0 ? jumpAuthMethod : 'key')
                    const method = (hop.auth_method || 'key') as AuthMethod
                    return (
                      <div key={`${spec}-${idx}`} className="jump-hop-auth" style={{ marginTop: 8 }}>
                        <span className="auth-field-label">
                          {t('proxyJumpHop')} {idx}: {spec}
                        </span>
                        <AuthSegment
                          value={method}
                          onChange={(m) => updateHop(idx, { auth_method: m })}
                          name={`jump-auth-${idx}`}
                        />
                        {method === 'password' ? (
                          <p className="muted small pad-y">{t('proxyJumpPasswordHint')}</p>
                        ) : (
                          <>
                            <label>
                              {t('jumpIdentityFile')}
                              <input
                                value={hop.identity_file || ''}
                                onChange={(e) => updateHop(idx, { identity_file: e.target.value })}
                                placeholder={t('jumpIdentityPlaceholder')}
                                disabled={method === 'agent'}
                              />
                            </label>
                            {method === 'key' ? (
                              <label className="check">
                                <input
                                  type="checkbox"
                                  checked={!!hop.use_agent}
                                  onChange={(e) => updateHop(idx, { use_agent: e.target.checked })}
                                />
                                {t('jumpUseAgent')}
                              </label>
                            ) : null}
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : null}
            </>
          ) : (
            <p className="muted small pad-y">{t('jumpHostHint')}</p>
          )}
          {authMethod === 'password' ? (
            <div className="password-block">
              <label className="password-label">
                {t('password')}
                <input
                  className="password-input"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('passwordPlaceholder')}
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={rememberPw}
                  onChange={(e) => setRememberPw(e.target.checked)}
                />
                {t('rememberPassword')}
              </label>
              <p className="muted small pad-y">{t('rememberPasswordHint')}</p>
            </div>
          ) : (
            <>
              <label>
                {t('identityFile')}
                <input
                  value={identity}
                  onChange={(e) => setIdentity(e.target.value)}
                  placeholder={t('identityPlaceholder')}
                  disabled={authMethod === 'agent'}
                />
              </label>
              {authMethod === 'key' ? (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={useAgent}
                    onChange={(e) => setUseAgent(e.target.checked)}
                  />
                  {t('useAgent')}
                </label>
              ) : null}
            </>
          )}
          {err ? <p className="error-text">{err}</p> : null}
        </div>
        <div className="modal-footer modal-actions">
          <button type="button" className="btn md ghost" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" className="btn md primary" disabled={busy}>
            {t('save')}
          </button>
        </div>
      </form>
    </div>
  )
}

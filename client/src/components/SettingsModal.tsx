import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  deleteKnownHost,
  getToken,
  listKnownHosts,
  setToken,
  type KnownHostEntry,
} from '../api'
import { useI18n, LOCALE_OPTIONS, type Locale } from '../i18n'
import { useTheme } from '../theme'
import type { AppThemeId } from '../theme/appThemes'
import { useSettings } from '../settings/SettingsContext'
import {
  ARK_PLAN_ORDER,
  applyArkPlan,
  arkPlanFromStored,
  PROVIDER_META,
  PROVIDER_ORDER,
  providerIsConfigured,
  type AppSettings,
  type ArkPlanId,
  type ProviderConfig,
  type ProviderId,
} from '../settings/types'
import { testProviderConnection } from '../settings/llm'
import {
  BUILTIN_SKILLS,
  isSkillEnabled,
  listSkills,
  removeCustomSkill,
  upsertCustomSkill,
  type SkillsSettings,
} from '../agent/skills'
import { importSkillsFromFile } from '../agent/skillImport'
import { loadSkillsSettings, saveSkillsSettings } from '../agent/skillsStorage'
import {
  loadMcpServers,
  saveMcpServers,
  probeMcpServer,
  stopMcpServer,
  isTauriRuntime,
  type McpServerConfig,
  type McpConnectionState,
} from '../agent/mcp'
import {
  IconButton,
  IconPlay,
  IconPlus,
  IconProbe,
  IconRefresh,
  IconStop,
  IconTrash,
  IconUpload,
  IconX,
} from './icons'

type Props = {
  open: boolean
  onClose: () => void
}

function cloneSettings(s: AppSettings): AppSettings {
  return JSON.parse(JSON.stringify(s)) as AppSettings
}

function newMcpId() {
  return `mcp-${Date.now().toString(36)}`
}

export function SettingsModal({ open, onClose }: Props) {
  const { t, locale, setLocale } = useI18n()
  const {
    appThemeId,
    setAppThemeId,
    appThemes,
    terminalThemeId,
    setTerminalThemeId,
    terminalPresets,
    customTerminalThemes,
    importTerminalTheme,
    removeCustomTerminalTheme,
    xtermTheme,
  } = useTheme()
  const { settings, setSettings } = useSettings()

  const [draft, setDraft] = useState<AppSettings>(() => cloneSettings(settings))
  const [tokenInput, setTokenInput] = useState(getToken())
  const [expanded, setExpanded] = useState<ProviderId | null>('openai')
  const [testingProviderId, setTestingProviderId] = useState<ProviderId | null>(null)
  const [providerTestResult, setProviderTestResult] = useState<{
    id: ProviderId
    ok: boolean
    message: string
  } | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const [knownHosts, setKnownHosts] = useState<KnownHostEntry[]>([])
  const [khBusy, setKhBusy] = useState(false)
  const [khError, setKhError] = useState('')
  const [skillsDraft, setSkillsDraft] = useState<SkillsSettings>(() => loadSkillsSettings())
  const [skillImportError, setSkillImportError] = useState('')
  const [skillImportInfo, setSkillImportInfo] = useState('')
  const [skillDragOver, setSkillDragOver] = useState(false)
  const [skillLastFile, setSkillLastFile] = useState('')
  const skillFileInputRef = useRef<HTMLInputElement>(null)
  const [mcpDraft, setMcpDraft] = useState<McpServerConfig[]>(() => loadMcpServers())
  const [mcpStates, setMcpStates] = useState<McpConnectionState[]>([])
  const [importError, setImportError] = useState('')
  const [importPreview, setImportPreview] = useState('')

  const refreshKnownHosts = useCallback(async () => {
    setKhError('')
    try {
      const d = await listKnownHosts()
      setKnownHosts(d.entries || [])
    } catch (ex: any) {
      setKhError(ex.message || String(ex))
      setKnownHosts([])
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setDraft(cloneSettings(settings))
    setTokenInput(getToken())
    setSavedFlash(false)
    setSkillsDraft(loadSkillsSettings())
    setSkillImportError('')
    setSkillImportInfo('')
    setSkillDragOver(false)
    setSkillLastFile('')
    setMcpDraft(loadMcpServers())
    setImportError('')
    setImportPreview('')
    const firstConfigured = PROVIDER_ORDER.find((id) =>
      providerIsConfigured(settings.providers[id]),
    )
    setExpanded(firstConfigured || settings.activeProviderId || 'openai')
    void refreshKnownHosts()
  }, [open, settings, refreshKnownHosts])

  const providerLabel = useMemo(() => {
    return (id: ProviderId) =>
      locale.startsWith('zh') ? PROVIDER_META[id].labelZh : PROVIDER_META[id].label
  }, [locale])

  const skillList = listSkills(skillsDraft)

  if (!open) return null

  function patchProvider(id: ProviderId, patch: Partial<ProviderConfig>) {
    setDraft((prev) => ({
      ...prev,
      providers: {
        ...prev.providers,
        [id]: { ...prev.providers[id], ...patch },
      },
    }))
  }

  async function onTestProvider(id: ProviderId) {
    const cfg = draft.providers[id]
    setTestingProviderId(id)
    setProviderTestResult(null)
    try {
      const result = await testProviderConnection(cfg)
      if (result.ok) {
        setProviderTestResult({
          id,
          ok: true,
          message: `${t('providerTestOk')} (${result.latencyMs}ms)`,
        })
      } else {
        setProviderTestResult({
          id,
          ok: false,
          message: `${t('providerTestFail')}: ${result.error}`,
        })
      }
    } catch (ex: unknown) {
      const msg = ex instanceof Error ? ex.message : String(ex)
      setProviderTestResult({
        id,
        ok: false,
        message: `${t('providerTestFail')}: ${msg}`,
      })
    } finally {
      setTestingProviderId(null)
    }
  }


  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setToken(tokenInput.trim())
    let next = draft
    const active = draft.activeProviderId
    if (active && !providerIsConfigured(draft.providers[active])) {
      const fallback =
        PROVIDER_ORDER.find((id) => providerIsConfigured(draft.providers[id])) || null
      next = { ...draft, activeProviderId: fallback }
    }
    setSettings(next)
    saveSkillsSettings(skillsDraft)
    saveMcpServers(mcpDraft)
    setSavedFlash(true)
    window.setTimeout(() => {
      setSavedFlash(false)
      onClose()
    }, 350)
  }

  async function onProbeMcp() {
    const states: McpConnectionState[] = []
    for (const s of mcpDraft.filter((x) => x.enabled)) {
      states.push(await probeMcpServer(s))
    }
    setMcpStates(states)
  }

  async function onStartMcp(s: McpServerConfig) {
    const st = await probeMcpServer({ ...s, enabled: true })
    setMcpStates((prev) => {
      const rest = prev.filter((x) => x.serverId !== s.id)
      return [...rest, st]
    })
  }

  async function onStopMcp(s: McpServerConfig) {
    await stopMcpServer(s)
    setMcpStates((prev) => {
      const rest = prev.filter((x) => x.serverId !== s.id)
      return [...rest, { serverId: s.id, status: 'disconnected', tools: [] }]
    })
  }

  async function importSkillFiles(files: File[]) {
    setSkillImportError('')
    setSkillImportInfo('')
    if (!files.length) return
    try {
      let next = skillsDraft
      const names: string[] = []
      for (const f of files) {
        const imported = await importSkillsFromFile(f)
        for (const item of imported) {
          next = upsertCustomSkill(next, item.skill, { replaceExisting: true })
          names.push(item.skill.name)
        }
      }
      setSkillsDraft(next)
      setSkillLastFile(files.map((f) => f.name).join(', '))
      setSkillImportInfo(`${t('skillsUploadOk')}: ${names.join(', ')}`)
    } catch (ex: any) {
      setSkillImportError(ex.message || String(ex))
      setSkillLastFile('')
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal settings-modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
      >
        <div className="modal-header">
          <h2>{t('settings')}</h2>
          <p className="muted small settings-subtitle">{t('settingsSubtitle')}</p>
        </div>

        <div className="modal-body">
          <section className="settings-section">
            <h3>{t('settingsBasic')}</h3>
            <label className="field-stable">
              {t('appTheme')}
              <select
                value={appThemeId}
                onChange={(e) => setAppThemeId(e.target.value as AppThemeId)}
              >
                {appThemes.map((th) => (
                  <option key={th.id} value={th.id}>
                    {th.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-stable">
              {t('terminalTheme')}
              <select
                value={terminalThemeId}
                onChange={(e) => setTerminalThemeId(e.target.value)}
              >
                <optgroup label={t('terminalThemePresets')}>
                  {terminalPresets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
                {customTerminalThemes.length ? (
                  <optgroup label={t('terminalThemeCustom')}>
                    {customTerminalThemes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
            </label>
            <div className="theme-preview" aria-hidden="true">
              <div
                className="theme-preview-swatch"
                style={{ background: xtermTheme.background, color: xtermTheme.foreground }}
              >
                <span style={{ color: xtermTheme.green }}>$</span> echo Hive Nest
              </div>
            </div>
            <label className="field-stable">
              {t('importTerminalTheme')}
              <input
                type="file"
                accept="application/json,.json"
                onChange={async (e) => {
                  setImportError('')
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (!f) return
                  try {
                    const text = await f.text()
                    setImportPreview(text.slice(0, 400))
                    importTerminalTheme(text)
                  } catch (ex: any) {
                    setImportError(ex.message || String(ex))
                  }
                }}
              />
            </label>
            {importError ? <p className="error-text">{importError}</p> : null}
            {importPreview ? (
              <pre className="theme-import-preview muted small">{importPreview}</pre>
            ) : null}
            {customTerminalThemes.length ? (
              <ul className="custom-theme-list">
                {customTerminalThemes.map((c) => (
                  <li key={c.id}>
                    <span className="text-ellipsis" title={c.name}>
                      {c.name}
                    </span>
                    <IconButton
                      variant="danger"
                      label={t('delete')}
                      onClick={() => removeCustomTerminalTheme(c.id)}
                      icon={<IconTrash size={14} />}
                    />
                  </li>
                ))}
              </ul>
            ) : null}
            <label className="field-stable">
              {t('language')}
              <select
                value={locale}
                onChange={(e) => setLocale(e.target.value as Locale)}
              >
                {LOCALE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-stable">
              {t('token')}
              <input
                className="token-input-full"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            <p className="muted small">{t('tokenHint')}</p>
          </section>

          <section className="settings-section">
            <h3>{t('settingsSkills')}</h3>
            <p className="muted small">{t('skillsHint')}</p>
            <div className="settings-field">
              <span className="settings-label">{t('skillsUpload')}</span>
              <div
                className={`settings-upload${skillDragOver ? ' is-dragover' : ''}${skillImportError ? ' is-error' : ''}`}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    skillFileInputRef.current?.click()
                  }
                }}
                onClick={() => skillFileInputRef.current?.click()}
                onDragEnter={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setSkillDragOver(true)
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setSkillDragOver(true)
                }}
                onDragLeave={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  const next = e.relatedTarget as Node | null
                  if (next && e.currentTarget.contains(next)) return
                  setSkillDragOver(false)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setSkillDragOver(false)
                  const files = Array.from(e.dataTransfer.files || []).filter((f) => {
                    const n = f.name.toLowerCase()
                    return n.endsWith('.md') || n.endsWith('.zip')
                  })
                  void importSkillFiles(files)
                }}
              >
                <span className="settings-upload-icon" aria-hidden="true">
                  <IconUpload size={20} />
                </span>
                <span className="settings-upload-copy">
                  <span className="settings-upload-title">
                    {skillDragOver ? t('skillsDropActive') : t('skillsUpload')}
                  </span>
                  <span className="settings-upload-hint">{t('skillsDropHint')}</span>
                </span>
                <span className="settings-upload-actions">
                  <button
                    type="button"
                    className="btn sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      skillFileInputRef.current?.click()
                    }}
                  >
                    {t('skillsBrowse')}
                  </button>
                </span>
                <input
                  ref={skillFileInputRef}
                  type="file"
                  accept=".md,.zip,text/markdown,application/zip"
                  multiple
                  hidden
                  onChange={(e) => {
                    const files = Array.from(e.target.files || [])
                    e.target.value = ''
                    void importSkillFiles(files)
                  }}
                />
              </div>
              {skillImportError ? (
                <p className="settings-upload-error" role="alert">
                  {skillImportError}
                </p>
              ) : null}
              {skillLastFile ? (
                <div className="settings-upload-file">
                  <span className="settings-upload-file-name" title={skillLastFile}>
                    {skillLastFile}
                  </span>
                  <IconButton
                    chrome
                    size="sm"
                    variant="default"
                    label={t('skillsClearFile')}
                    onClick={() => {
                      setSkillLastFile('')
                      setSkillImportInfo('')
                    }}
                    icon={<IconX size={16} />}
                  />
                </div>
              ) : null}
              {skillImportInfo ? <p className="muted small">{skillImportInfo}</p> : null}
            </div>
            <ul className="skills-list" role="list">
              {skillList.length === 0 ? (
                <li className="skills-list-empty">{t('skillsEmpty')}</li>
              ) : (
                skillList.map((s) => (
                  <li key={s.id} className="skill-row" role="listitem">
                    <div className="skill-main">
                      <div className="skill-title-row">
                        <span className="skill-name" title={s.name}>
                          {s.name}
                        </span>
                        <span
                          className={`skill-badge ${s.builtin ? 'preset' : 'uploaded'}`}
                        >
                          {s.builtin ? t('skillsPresetBadge') : t('skillsCustomBadge')}
                        </span>
                      </div>
                      <p className="skill-desc" title={s.description}>
                        {s.description}
                      </p>
                    </div>
                    <div className="skill-actions">
                      <label className="skill-toggle" title={s.name}>
                        <input
                          type="checkbox"
                          checked={isSkillEnabled(skillsDraft, s)}
                          onChange={(e) =>
                            setSkillsDraft((prev) => ({
                              ...prev,
                              enabled: { ...prev.enabled, [s.id]: e.target.checked },
                            }))
                          }
                          aria-label={s.name}
                        />
                      </label>
                      {!s.builtin ? (
                        <IconButton
                          chrome
                          size="sm"
                          variant="danger"
                          label={t('skillsDelete')}
                          onClick={() => {
                            setSkillsDraft((prev) => removeCustomSkill(prev, s.id))
                            setSkillImportInfo('')
                            setSkillImportError('')
                          }}
                          icon={<IconTrash size={16} />}
                        />
                      ) : null}
                    </div>
                  </li>
                ))
              )}
            </ul>
            <p className="muted small skills-meta">
              {t('skillsBuiltinCount')}: {BUILTIN_SKILLS.length}
              {' · '}
              {t('skillsCustomCount')}: {(skillsDraft.custom || []).length}
            </p>
          </section>

          <section className="settings-section">
            <h3>{t('settingsMcp')}</h3>
            <p className="muted small">{t('mcpHint')}</p>
            {mcpDraft.map((s, idx) => (
              <div key={s.id} className="mcp-card">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={s.enabled}
                    onChange={(e) => {
                      const next = [...mcpDraft]
                      next[idx] = { ...s, enabled: e.target.checked }
                      setMcpDraft(next)
                    }}
                  />
                  {t('mcpEnable')}
                </label>
                <label className="field-stable">
                  {t('name')}
                  <input
                    value={s.name}
                    onChange={(e) => {
                      const next = [...mcpDraft]
                      next[idx] = { ...s, name: e.target.value }
                      setMcpDraft(next)
                    }}
                  />
                </label>
                <label className="field-stable">
                  {t('mcpTransport')}
                  <select
                    value={s.transport}
                    onChange={(e) => {
                      const next = [...mcpDraft]
                      next[idx] = {
                        ...s,
                        transport: e.target.value as McpServerConfig['transport'],
                      }
                      setMcpDraft(next)
                    }}
                  >
                    <option value="http">HTTP</option>
                    <option value="sse">SSE</option>
                    <option value="command">Command (stdio)</option>
                  </select>
                </label>
                {s.transport === 'command' ? (
                  <>
                    <label className="field-stable">
                      {t('mcpCommand')}
                      <input
                        value={s.command || ''}
                        onChange={(e) => {
                          const next = [...mcpDraft]
                          next[idx] = { ...s, command: e.target.value }
                          setMcpDraft(next)
                        }}
                        spellCheck={false}
                        placeholder="npx"
                      />
                    </label>
                    <label className="field-stable">
                      {t('mcpArgs')}
                      <input
                        value={(s.args || []).join(' ')}
                        onChange={(e) => {
                          const next = [...mcpDraft]
                          next[idx] = {
                            ...s,
                            args: e.target.value.split(/\s+/).filter(Boolean),
                          }
                          setMcpDraft(next)
                        }}
                        spellCheck={false}
                        placeholder="-y @modelcontextprotocol/server-filesystem /tmp"
                      />
                    </label>
                  </>
                ) : (
                  <label className="field-stable">
                    {t('mcpUrl')}
                    <input
                      value={s.url || ''}
                      onChange={(e) => {
                        const next = [...mcpDraft]
                        next[idx] = { ...s, url: e.target.value }
                        setMcpDraft(next)
                      }}
                      spellCheck={false}
                      placeholder="http://127.0.0.1:3000/mcp"
                    />
                  </label>
                )}
                <div className="row gap wrap" style={{ marginTop: 8 }}>
                  <IconButton
                    variant="primary"
                    label={t('mcpStart')}
                    onClick={() => void onStartMcp(s)}
                    icon={<IconPlay size={14} />}
                  />
                  <IconButton
                    variant="ghost"
                    label={t('mcpStop')}
                    onClick={() => void onStopMcp(s)}
                    icon={<IconStop size={14} />}
                  />
                  <IconButton
                    variant="ghost"
                    label={t('mcpProbe')}
                    onClick={() => void onStartMcp(s)}
                    icon={<IconProbe size={14} />}
                  />
                  <IconButton
                    variant="danger"
                    label={t('delete')}
                    onClick={() => {
                      void onStopMcp(s)
                      setMcpDraft(mcpDraft.filter((x) => x.id !== s.id))
                    }}
                    icon={<IconTrash size={14} />}
                  />
                </div>
                {s.transport === 'command' && !isTauriRuntime() ? (
                  <p className="muted small">{t('mcpDesktopOnly')}</p>
                ) : null}
              </div>
            ))}
            <div className="row gap wrap">
              <IconButton
                variant="primary"
                label={t('mcpAdd')}
                onClick={() =>
                  setMcpDraft([
                    ...mcpDraft,
                    {
                      id: newMcpId(),
                      name: 'MCP server',
                      enabled: true,
                      transport: 'http',
                      url: 'http://127.0.0.1:3000/mcp',
                    },
                  ])
                }
                icon={<IconPlus size={14} />}
              />
              <IconButton
                variant="ghost"
                label={t('mcpProbeAll')}
                onClick={() => void onProbeMcp()}
                icon={<IconProbe size={14} />}
              />
            </div>
            <p className="muted small">
              {isTauriRuntime() ? t('mcpDesktopReady') : t('mcpBrowserMode')}
            </p>
            {mcpStates.length ? (
              <ul className="mcp-status-list">
                {mcpStates.map((st) => (
                  <li key={st.serverId}>
                    <span className={`pill ${st.status === 'connected' ? 'ok' : 'bad'}`}>
                      {st.status}
                    </span>{' '}
                    {st.serverId}
                    {st.error ? ` — ${st.error}` : ''}
                    {st.tools.length ? ` (${st.tools.length} tools)` : ''}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="settings-section">
            <h3>{t('settingsProviders')}</h3>
            <p className="muted small">{t('providersHint')}</p>
            <p className="muted small secrets-note">{t('secretsNote')}</p>

            <label className="field-stable">
              {t('activeProvider')}
              <select
                value={draft.activeProviderId ?? ''}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    activeProviderId: (e.target.value || null) as ProviderId | null,
                  }))
                }
              >
                <option value="">{t('activeProviderNone')}</option>
                {PROVIDER_ORDER.map((id) => (
                  <option key={id} value={id}>
                    {providerLabel(id)}
                    {providerIsConfigured(draft.providers[id]) ? ` — ${t('configured')}` : ''}
                  </option>
                ))}
              </select>
            </label>

            <div className="provider-list">
              {PROVIDER_ORDER.map((id) => {
                const p = draft.providers[id]
                const meta = PROVIDER_META[id]
                const ready = providerIsConfigured(p)
                const openCard = expanded === id
                const hint = locale.startsWith('zh') ? meta.docsHintZh : meta.docsHint
                const orgLabel = locale.startsWith('zh') ? meta.orgLabelZh : meta.orgLabel
                return (
                  <div
                    key={id}
                    className={`provider-card${openCard ? ' is-open' : ''}${ready ? ' is-ready' : ''}`}
                  >
                    <button
                      type="button"
                      className="provider-card-head"
                      onClick={() => setExpanded(openCard ? null : id)}
                    >
                      <span className="provider-card-title">
                        <strong className="text-ellipsis">{providerLabel(id)}</strong>
                        <span className={`pill ${ready ? 'ok' : 'bad'}`}>
                          {ready ? t('configured') : t('notConfigured')}
                        </span>
                      </span>
                      <span className="provider-card-chevron">{openCard ? '▾' : '▸'}</span>
                    </button>
                    {openCard ? (
                      <div className="provider-card-body">
                        <p className="muted small">{hint}</p>
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={p.enabled}
                            onChange={(e) => patchProvider(id, { enabled: e.target.checked })}
                          />
                          {t('providerEnable')}
                        </label>
                        <label className="field-stable">
                          {t('apiBaseUrl')}
                          <input
                            value={p.apiBaseUrl}
                            onChange={(e) => patchProvider(id, { apiBaseUrl: e.target.value })}
                            spellCheck={false}
                            placeholder={meta.defaultBaseUrl || t('apiBaseUrlPlaceholder')}
                          />
                        </label>
                        <label className="field-stable">
                          {t('apiKey')}
                          <input
                            type="password"
                            autoComplete="new-password"
                            value={p.apiKey}
                            onChange={(e) => patchProvider(id, { apiKey: e.target.value })}
                            placeholder={
                              meta.requiresApiKey
                                ? t('apiKeyPlaceholder')
                                : t('apiKeyOptionalPlaceholder')
                            }
                          />
                        </label>
                        <label className="field-stable">
                          {t('defaultModel')}
                          <input
                            value={p.defaultModel}
                            onChange={(e) => patchProvider(id, { defaultModel: e.target.value })}
                            spellCheck={false}
                            placeholder={meta.defaultModel || t('defaultModelPlaceholder')}
                          />
                        </label>
                        {id === 'ark' ? (
                          <label className="field-stable">
                            {t('arkPlan')}
                            <select
                              value={arkPlanFromStored(p.orgOrRegion, p.apiBaseUrl)}
                              onChange={(e) => {
                                const plan = e.target.value as ArkPlanId
                                patchProvider(id, applyArkPlan(p, plan))
                              }}
                            >
                              {ARK_PLAN_ORDER.map((planId) => (
                                <option key={planId} value={planId}>
                                  {planId === 'agent_plan'
                                    ? t('arkPlanAgent')
                                    : planId === 'coding_plan'
                                      ? t('arkPlanCoding')
                                      : t('arkPlanPayg')}
                                </option>
                              ))}
                            </select>
                            <span className="muted small">{t('arkPlanHint')}</span>
                          </label>
                        ) : (
                          <label className="field-stable">
                            {orgLabel}
                            <input
                              value={p.orgOrRegion}
                              onChange={(e) => patchProvider(id, { orgOrRegion: e.target.value })}
                              spellCheck={false}
                            />
                          </label>
                        )}
                        {meta.showExtraHeaders ? (
                          <label className="field-stable">
                            {t('extraHeaders')}
                            <textarea
                              className="extra-headers-input"
                              value={p.extraHeaders}
                              onChange={(e) =>
                                patchProvider(id, { extraHeaders: e.target.value })
                              }
                              spellCheck={false}
                              rows={3}
                              placeholder={t('extraHeadersPlaceholder')}
                            />
                            <span className="muted small">{t('extraHeadersHint')}</span>
                          </label>
                        ) : null}
                        <div className="provider-test-row">
                          <IconButton
                            size="sm"
                            variant="ghost"
                            showLabel
                            className="provider-test-btn"
                            label={
                              testingProviderId === id
                                ? t('providerTestRunning')
                                : t('providerTestConnection')
                            }
                            disabled={
                              testingProviderId === id ||
                              !p.apiBaseUrl.trim() ||
                              !p.defaultModel.trim() ||
                              (meta.requiresApiKey && !p.apiKey.trim())
                            }
                            onClick={() => void onTestProvider(id)}
                            icon={<IconProbe size={14} />}
                          />
                          {providerTestResult?.id === id ? (
                            <span
                              className={`pill ${providerTestResult.ok ? 'ok' : 'bad'}`}
                              role="status"
                              title={providerTestResult.message}
                            >
                              {providerTestResult.message}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </section>

          <section className="settings-section">
            <h3>{t('settingsKnownHosts')}</h3>
            <p className="muted small">{t('knownHostsHint')}</p>
            {khError ? <p className="error-text">{khError}</p> : null}
            <div className="row gap wrap" style={{ marginBottom: 8 }}>
              <IconButton
                variant="ghost"
                label={t('refresh')}
                disabled={khBusy}
                onClick={() => void refreshKnownHosts()}
                icon={<IconRefresh size={14} />}
              />
            </div>
            {knownHosts.length === 0 ? (
              <p className="muted small">{t('knownHostsEmpty')}</p>
            ) : (
              <ul className="known-hosts-list">
                {knownHosts.map((e) => (
                  <li key={`${e.host}:${e.port}:${e.fingerprint_sha256}`} className="known-hosts-item">
                    <div className="known-hosts-meta">
                      <strong>
                        {e.host}:{e.port}
                      </strong>
                      <span className="muted small">{e.key_type}</span>
                      <code className="fp mono">{e.fingerprint_sha256}</code>
                      <span className="muted small">
                        {t('acceptedAt')}: {new Date(e.accepted_at).toLocaleString()}
                      </span>
                    </div>
                    <IconButton
                      variant="danger"
                      label={t('delete')}
                      disabled={khBusy}
                      onClick={async () => {
                        if (!confirm(t('knownHostsDeleteConfirm'))) return
                        setKhBusy(true)
                        try {
                          await deleteKnownHost(e.host, e.port)
                          await refreshKnownHosts()
                        } catch (ex: any) {
                          setKhError(ex.message || String(ex))
                        } finally {
                          setKhBusy(false)
                        }
                      }}
                      icon={<IconTrash size={14} />}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="modal-footer modal-actions">
          {savedFlash ? <span className="muted small save-flash">{t('settingsSaved')}</span> : null}
          <button type="button" className="btn md ghost btn-stable" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" className="btn md primary btn-stable">
            {t('save')}
          </button>
        </div>
      </form>
    </div>
  )
}

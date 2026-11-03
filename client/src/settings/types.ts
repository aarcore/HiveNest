export type ProviderId =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'azure_openai'
  | 'deepseek'
  | 'moonshot'
  | 'zhipu'
  | 'mistral'
  | 'groq'
  | 'ark'
  | 'qwen'
  | 'ollama'
  | 'openai_compatible'
  | 'custom'

export type ApiStyle = 'openai' | 'anthropic' | 'azure'

export type ProviderConfig = {
  id: ProviderId
  enabled: boolean
  apiBaseUrl: string
  /** Plain in memory; obfuscated when persisted. */
  apiKey: string
  defaultModel: string
  /** Optional org / project / region / api-version depending on provider. */
  orgOrRegion: string
  /**
   * Optional extra HTTP headers as JSON object, e.g. {"X-Custom":"v"}.
   * Used mainly by Custom; ignored when empty.
   */
  extraHeaders: string
}

export type AppSettings = {
  version: 1
  /** Which provider Agent uses when proposing with LLM. */
  activeProviderId: ProviderId | null
  providers: Record<ProviderId, ProviderConfig>
}

export type ProviderMeta = {
  label: string
  labelZh: string
  docsHint: string
  docsHintZh: string
  defaultBaseUrl: string
  defaultModel: string
  apiStyle: ApiStyle
  orgLabel: string
  orgLabelZh: string
  /** When false, empty API key is allowed (e.g. local Ollama). */
  requiresApiKey: boolean
  /** Show the free-form extra headers field in Settings. */
  showExtraHeaders: boolean
}

export const PROVIDER_ORDER: ProviderId[] = [
  'openai',
  'anthropic',
  'gemini',
  'azure_openai',
  'deepseek',
  'moonshot',
  'zhipu',
  'mistral',
  'groq',
  'ark',
  'qwen',
  'ollama',
  'openai_compatible',
  'custom',
]

export const PROVIDER_META: Record<ProviderId, ProviderMeta> = {
  openai: {
    label: 'OpenAI / ChatGPT',
    labelZh: 'OpenAI / ChatGPT',
    docsHint:
      'Get an API key at platform.openai.com. Base URL usually https://api.openai.com/v1',
    docsHintZh: '在 platform.openai.com 获取 API Key。Base URL 一般为 https://api.openai.com/v1',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    apiStyle: 'openai',
    orgLabel: 'Organization ID (optional)',
    orgLabelZh: 'Organization ID（可选）',
    requiresApiKey: true,
    showExtraHeaders: false,
  },
  anthropic: {
    label: 'Anthropic',
    labelZh: 'Anthropic',
    docsHint: 'Get an API key at console.anthropic.com. Uses the Messages API.',
    docsHintZh: '在 console.anthropic.com 获取 API Key，使用 Messages API。',
    defaultBaseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-20250514',
    apiStyle: 'anthropic',
    orgLabel: 'API version (optional, default 2023-06-01)',
    orgLabelZh: 'API 版本（可选，默认 2023-06-01）',
    requiresApiKey: true,
    showExtraHeaders: false,
  },
  gemini: {
    label: 'Google Gemini',
    labelZh: 'Google Gemini',
    docsHint:
      'Google AI Studio / Gemini OpenAI-compatible endpoint. Key from aistudio.google.com. Base URL ends with /v1beta/openai.',
    docsHintZh:
      'Google AI Studio / Gemini 的 OpenAI 兼容接口。密钥见 aistudio.google.com。Base URL 以 /v1beta/openai 结尾。',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.0-flash',
    apiStyle: 'openai',
    orgLabel: 'Project (optional)',
    orgLabelZh: '项目（可选）',
    requiresApiKey: true,
    showExtraHeaders: false,
  },
  azure_openai: {
    label: 'Azure OpenAI',
    labelZh: 'Azure OpenAI',
    docsHint:
      'Azure OpenAI resource. Base URL like https://{resource}.openai.azure.com/openai/deployments/{deployment}. Put api-version in the field below (e.g. 2024-08-01-preview). Model = deployment name.',
    docsHintZh:
      'Azure OpenAI 资源。Base URL 形如 https://{resource}.openai.azure.com/openai/deployments/{deployment}。下方填写 api-version（如 2024-08-01-preview）。模型名 = 部署名。',
    defaultBaseUrl: 'https://YOUR_RESOURCE.openai.azure.com/openai/deployments/YOUR_DEPLOYMENT',
    defaultModel: 'gpt-4o',
    apiStyle: 'azure',
    orgLabel: 'API version (e.g. 2024-08-01-preview)',
    orgLabelZh: 'API 版本（如 2024-08-01-preview）',
    requiresApiKey: true,
    showExtraHeaders: false,
  },
  deepseek: {
    label: 'DeepSeek',
    labelZh: 'DeepSeek',
    docsHint: 'OpenAI-compatible API. Key from platform.deepseek.com.',
    docsHintZh: 'OpenAI 兼容接口。密钥见 platform.deepseek.com。',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    apiStyle: 'openai',
    orgLabel: 'Org / project (optional)',
    orgLabelZh: '组织 / 项目（可选）',
    requiresApiKey: true,
    showExtraHeaders: false,
  },
  moonshot: {
    label: 'Moonshot / Kimi',
    labelZh: '月之暗面 / Kimi',
    docsHint: 'Moonshot OpenAI-compatible API. Key from platform.moonshot.cn.',
    docsHintZh: 'Moonshot OpenAI 兼容接口。密钥见 platform.moonshot.cn。',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    apiStyle: 'openai',
    orgLabel: 'Org / project (optional)',
    orgLabelZh: '组织 / 项目（可选）',
    requiresApiKey: true,
    showExtraHeaders: false,
  },
  zhipu: {
    label: 'Zhipu / GLM',
    labelZh: '智谱 / GLM',
    docsHint: 'Zhipu BigModel OpenAI-compatible API. Key from open.bigmodel.cn.',
    docsHintZh: '智谱 BigModel OpenAI 兼容接口。密钥见 open.bigmodel.cn。',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
    apiStyle: 'openai',
    orgLabel: 'Org / project (optional)',
    orgLabelZh: '组织 / 项目（可选）',
    requiresApiKey: true,
    showExtraHeaders: false,
  },
  mistral: {
    label: 'Mistral',
    labelZh: 'Mistral',
    docsHint: 'Mistral Cloud OpenAI-compatible API. Key from console.mistral.ai.',
    docsHintZh: 'Mistral Cloud OpenAI 兼容接口。密钥见 console.mistral.ai。',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-small-latest',
    apiStyle: 'openai',
    orgLabel: 'Org / project (optional)',
    orgLabelZh: '组织 / 项目（可选）',
    requiresApiKey: true,
    showExtraHeaders: false,
  },
  groq: {
    label: 'Groq',
    labelZh: 'Groq',
    docsHint: 'Groq OpenAI-compatible API. Key from console.groq.com.',
    docsHintZh: 'Groq OpenAI 兼容接口。密钥见 console.groq.com。',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    apiStyle: 'openai',
    orgLabel: 'Org / project (optional)',
    orgLabelZh: '组织 / 项目（可选）',
    requiresApiKey: true,
    showExtraHeaders: false,
  },
  ark: {
    label: 'Volcengine Ark',
    labelZh: '火山方舟',
    docsHint:
      "Volcengine Ark OpenAI-compatible Chat Completions. Pick Agent Plan or Coding Plan below (each plan needs its own API key from that plan's console). Do not use plain /api/v3 for plan quota — that is pay-as-you-go. Model ids: ark-code-latest, doubao-seed-*, glm-*, deepseek-*, kimi-*, or ep-….",
    docsHintZh:
      '火山方舟 OpenAI 兼容 Chat Completions。请选择 Agent 套餐或 Coding 套餐（各自控制台申请独立 API Key，勿混用）。套餐额度请勿用普通 /api/v3（按量计费）。模型 id 可为 ark-code-latest、doubao-seed-*、glm-*、deepseek-*、kimi-* 或 ep-…。',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/plan/v3',
    defaultModel: 'ark-code-latest',
    apiStyle: 'openai',
    orgLabel: 'Ark plan (agent_plan | coding_plan | payg)',
    orgLabelZh: '方舟套餐（agent_plan | coding_plan | payg）',
    requiresApiKey: true,
    showExtraHeaders: false,
  },
  qwen: {
    label: 'Qwen / DashScope',
    labelZh: '通义千问 / 百炼',
    docsHint:
      'Alibaba DashScope OpenAI-compatible mode. Key from dashscope.console.aliyun.com. Default base ends with compatible-mode/v1.',
    docsHintZh:
      '阿里云百炼 / DashScope OpenAI 兼容模式。密钥见 dashscope.console.aliyun.com。默认 Base 以 compatible-mode/v1 结尾。',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    apiStyle: 'openai',
    orgLabel: 'Workspace / region (optional)',
    orgLabelZh: '业务空间 / 地域（可选）',
    requiresApiKey: true,
    showExtraHeaders: false,
  },
  ollama: {
    label: 'Ollama (local)',
    labelZh: 'Ollama（本地）',
    docsHint:
      'Local Ollama OpenAI-compatible server. Default http://127.0.0.1:11434/v1. API key optional (leave blank).',
    docsHintZh:
      '本机 Ollama 的 OpenAI 兼容服务。默认 http://127.0.0.1:11434/v1。API Key 可选（可留空）。',
    defaultBaseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: 'llama3.2',
    apiStyle: 'openai',
    orgLabel: 'Unused (optional)',
    orgLabelZh: '未使用（可选）',
    requiresApiKey: false,
    showExtraHeaders: false,
  },
  openai_compatible: {
    label: 'OpenAI-compatible',
    labelZh: 'OpenAI 兼容接口',
    docsHint:
      'Any Chat Completions compatible gateway (vLLM, LiteLLM, proxies, etc.). Set base URL (often …/v1).',
    docsHintZh:
      '任意 Chat Completions 兼容网关（vLLM、LiteLLM、代理等）。填写 Base URL（通常以 /v1 结尾）。',
    defaultBaseUrl: 'http://127.0.0.1:8000/v1',
    defaultModel: 'default',
    apiStyle: 'openai',
    orgLabel: 'Org / project (optional)',
    orgLabelZh: '组织 / 项目（可选）',
    requiresApiKey: false,
    showExtraHeaders: false,
  },
  custom: {
    label: 'Custom',
    labelZh: '自定义',
    docsHint:
      'Fully free-form: any base URL, model name, API key, and optional extra HTTP headers (JSON object). Uses OpenAI Chat Completions shape unless you point at an Anthropic-compatible URL (set org field to "anthropic").',
    docsHintZh:
      '完全自定义：任意 Base URL、模型名、API Key，以及可选的额外 HTTP 头（JSON 对象）。默认按 OpenAI Chat Completions；若对接 Anthropic 兼容地址，可在下方组织字段填 anthropic。',
    defaultBaseUrl: '',
    defaultModel: '',
    apiStyle: 'openai',
    orgLabel: 'API style override (openai | anthropic) or org id',
    orgLabelZh: 'API 风格覆盖（openai | anthropic）或组织 ID',
    requiresApiKey: false,
    showExtraHeaders: true,
  },
}


/** Volcengine Ark subscription plan for OpenAI-compatible base URLs. */
export type ArkPlanId = 'agent_plan' | 'coding_plan' | 'payg'

/** Verified OpenAI-compatible base URLs (plan paths consume plan quota; /api/v3 is pay-as-you-go). */
export const ARK_PLAN_BASE_URLS: Record<ArkPlanId, string> = {
  agent_plan: 'https://ark.cn-beijing.volces.com/api/plan/v3',
  coding_plan: 'https://ark.cn-beijing.volces.com/api/coding/v3',
  payg: 'https://ark.cn-beijing.volces.com/api/v3',
}

export const ARK_PLAN_ORDER: ArkPlanId[] = ['agent_plan', 'coding_plan', 'payg']

export function normalizeApiBaseUrl(url: string): string {
  return (url ?? '').trim().replace(/\/+$/, '')
}

export function isKnownArkPlanBaseUrl(url: string): boolean {
  const n = normalizeApiBaseUrl(url)
  if (!n) return true
  return ARK_PLAN_ORDER.some((id) => normalizeApiBaseUrl(ARK_PLAN_BASE_URLS[id]) === n)
}

export function arkPlanFromStored(orgOrRegion: string, apiBaseUrl: string): ArkPlanId {
  const raw = orgOrRegion.trim().toLowerCase()
  if (raw === 'agent_plan' || raw === 'agent' || raw === 'plan') return 'agent_plan'
  if (raw === 'coding_plan' || raw === 'coding' || raw === 'code') return 'coding_plan'
  if (raw === 'payg' || raw === 'pay_as_you_go' || raw === 'pay-as-you-go' || raw === 'v3') {
    return 'payg'
  }
  const n = normalizeApiBaseUrl(apiBaseUrl)
  for (const id of ARK_PLAN_ORDER) {
    if (normalizeApiBaseUrl(ARK_PLAN_BASE_URLS[id]) === n) return id
  }
  // Legacy default was /api/v3; keep payg when URL customized or unknown.
  return 'payg'
}

/** Apply a plan selection: update base URL only when it still matches a known preset (or is empty). */
export function applyArkPlan(
  provider: ProviderConfig,
  plan: ArkPlanId,
): Pick<ProviderConfig, 'orgOrRegion' | 'apiBaseUrl'> {
  const nextUrl = ARK_PLAN_BASE_URLS[plan]
  if (isKnownArkPlanBaseUrl(provider.apiBaseUrl)) {
    return { orgOrRegion: plan, apiBaseUrl: nextUrl }
  }
  return { orgOrRegion: plan, apiBaseUrl: provider.apiBaseUrl }
}

export function defaultProvider(id: ProviderId): ProviderConfig {
  const m = PROVIDER_META[id]
  return {
    id,
    enabled: false,
    apiBaseUrl: m.defaultBaseUrl,
    apiKey: '',
    defaultModel: m.defaultModel,
    orgOrRegion: id === 'ark' ? 'agent_plan' : '',
    extraHeaders: '',
  }
}

export function defaultSettings(): AppSettings {
  const providers = {} as Record<ProviderId, ProviderConfig>
  for (const id of PROVIDER_ORDER) providers[id] = defaultProvider(id)
  return { version: 1, activeProviderId: null, providers }
}

export function providerIsConfigured(p: ProviderConfig): boolean {
  if (!p.enabled) return false
  if (!p.apiBaseUrl.trim() || !p.defaultModel.trim()) return false
  const meta = PROVIDER_META[p.id]
  if (meta.requiresApiKey && !p.apiKey.trim()) return false
  return true
}

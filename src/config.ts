/**
 * Bundle-row config (M3, plan/02 模型通路 B + FR10): the schemastery schema
 * exported as `Config` from the package root. The cordis plugin loader
 * validates the row's `config` through this schema (cordis `resolveConfig`)
 * and hands the apply the resulting instance whose fields are `Volatile`
 * refs — `.get()` re-reads the CURRENT value, so volatile edits from the
 * auto-generated web settings page take effect on the NEXT optimization
 * without a plugin restart (the loader updates the section in place).
 *
 * Secrets never reach the browser: `apiKey` carries schemastery's
 * `role('secret')`, which the settings service strips from every wire view
 * (write-only — the form shows a setter, never the stored value), and OUR
 * own RPC responses never include any key field either (plan/06: key 只存
 * 宿主侧绝不下发浏览器).
 *
 * FR10 (最简形): `templateConcise` / `templateStructured` override the
 * built-in template of that style with a full prompt text containing the
 * `{draft}` placeholder. An override without the placeholder is a config
 * mistake — it is dropped (built-in used) and warned once, so a broken
 * template can never silently swallow the draft.
 */
import z from '@deepseek-ai/schemastery'
import type { Volatile } from '@deepseek-ai/cordis'
import { TEMPLATE_DRAFT_TOKEN } from './templates.js'
import type { TemplateOverrides } from './templates.js'

export type { TemplateOverrides }

/** Default OpenAI-compatible endpoint (DeepSeek official, plain base — `/chat/completions` is appended). */
export const DEFAULT_API_BASE_URL = 'https://api.deepseek.com'
/** Default model id on the compatible endpoint. */
export const DEFAULT_API_MODEL = 'deepseek-chat'
/** Default environment-variable name the API key may also come from (credentials seam / process env). */
export const DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY'

/**
 * Runtime view of the bundle-row config as apply receives it. Each field is
 * a `Volatile` ref; keep the refs, snapshot per operation.
 */
export interface PolisherConfig {
  /** Route the independent-API path first when set; otherwise engine only. */
  apiEnabled: Volatile<boolean>
  /** OpenAI-compatible base URL; `/chat/completions` is appended unless already present. */
  apiBaseURL: Volatile<string>
  /** Literal API key (secret role — host-only, never echoed). */
  apiKey: Volatile<string | undefined>
  /** Environment-variable name for the key (credentials service, then process env). */
  apiKeyEnv: Volatile<string | undefined>
  /** Model id sent as `body.model`. */
  apiModel: Volatile<string>
  /** FR10: full-prompt override for the concise style, `{draft}` placeholder required. */
  templateConcise: Volatile<string | undefined>
  /** FR10: full-prompt override for the structured style, `{draft}` placeholder required. */
  templateStructured: Volatile<string | undefined>
  /** M4: mirror client-side diagnostic reports into the host log (default on). */
  clientDiagnostics: Volatile<boolean>
}

/** The loader-facing schema (exported `Config` convention, dsh-web-search-deepseek 形). */
export const Config = z.object({
  apiEnabled: z.boolean().default(false).volatile(),
  apiBaseURL: z.string().default(DEFAULT_API_BASE_URL).volatile(),
  apiKey: z.string().role('secret').volatile(),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV).volatile(),
  apiModel: z.string().default(DEFAULT_API_MODEL).volatile(),
  templateConcise: z.string().volatile(),
  templateStructured: z.string().volatile(),
  clientDiagnostics: z.boolean().default(true).volatile(),
})

/** One immutable API-path snapshot for one dispatch/test operation. */
export interface ApiResolvedConfig {
  enabled: boolean
  baseURL: string
  apiKey: string | undefined
  apiKeyEnv: string | undefined
  model: string
}

/** FR10 overrides live in templates.ts (renderTemplate consumes them); re-exported here. */

/** Warn-once state so a broken override does not spam every request. */
const warnedOverrides = new Set<string>()

function sanitizeOverride(style: string, raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  const text = raw.trim()
  if (text.length === 0) return undefined
  if (!text.includes(TEMPLATE_DRAFT_TOKEN)) {
    if (!warnedOverrides.has(style)) {
      warnedOverrides.add(style)
      console.warn(`[dsh-prompt-polisher] custom template for "${style}" is ignored: it must contain the ${TEMPLATE_DRAFT_TOKEN} placeholder`)
    }
    return undefined
  }
  return text
}

/**
 * Snapshot the volatile config for one operation. The snapshot is what the
 * router consults and what the API request is built from; the credential
 * resolution happens on top (api-dispatch) because it is async.
 */
export function snapshotConfig(config: PolisherConfig): { api: ApiResolvedConfig; templates: TemplateOverrides } {
  return {
    api: {
      enabled: config.apiEnabled.get() === true,
      baseURL: config.apiBaseURL.get(),
      apiKey: config.apiKey.get(),
      apiKeyEnv: config.apiKeyEnv.get(),
      model: config.apiModel.get(),
    },
    templates: {
      concise: sanitizeOverride('concise', config.templateConcise.get()),
      structured: sanitizeOverride('structured', config.templateStructured.get()),
    },
  }
}

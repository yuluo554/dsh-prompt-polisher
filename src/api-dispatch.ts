/**
 * Independent-API dispatch (M3, plan/02 模型通路 B / FR9): the host half
 * calls an OpenAI-compatible `/chat/completions` endpoint (DeepSeek official
 * among them) with Node fetch — no workflow engine, no child agent, no
 * session-model quota.
 *
 * Key discipline (plan/06 frozen): the key lives host-side only. It enters
 * through the secret-role config field (write-only on the settings wire) or
 * is resolved per operation from the credentials seam / process env via its
 * env-var name; it is sent ONLY as the request's Authorization header and
 * NEVER appears in any RPC response, log line, or error message.
 *
 * Result mapping — same frozen codes as the engine path, plus an additive
 * `modelVia: 'api'` marker on the error arms that should nudge the user
 * back to the session model (CANCELLED stays plain: the caller aborted):
 *   transport failure / non-2xx       -> UPSTREAM_FAILED (+ modelVia)
 *   unusable response body            -> UPSTREAM_FAILED (+ modelVia)
 *   missing/empty model text          -> PARSE_FAILED     (+ modelVia)
 *   scrubber rejects the text         -> PARSE_FAILED     (+ modelVia)
 *   caller abort                      -> CANCELLED
 * Everything that passes the scrubber answers
 * `{ ok: true, modelVia: 'api' }`.
 */
import type { EngineDispatch, OptimizeJob } from './dispatch.js'
import type { ApiResolvedConfig } from './config.js'
import { scrubModelOutput } from './scrub.js'
import { renderTemplate } from './templates.js'

/** Deps of both the dispatch and the connectivity tester; all injectable for offline tests. */
export interface ApiDispatchDeps {
  /** Per-operation config snapshot (volatile refs resolved fresh each call). */
  resolveConfig: () => ApiResolvedConfig
  /** Resolve the key from the config's env-var name (credentials seam, then process env). */
  resolveApiKey: (envName: string) => Promise<string | undefined>
  /** HTTP client (default: Node global fetch; tests stub it). */
  fetchImpl?: typeof fetch
}

/** The error arms that carry the fall-back-to-session-model hint. */
export type ApiFailureBody = { ok: false; error: 'UPSTREAM_FAILED' | 'PARSE_FAILED'; modelVia: 'api' }

function apiFailure(error: 'UPSTREAM_FAILED' | 'PARSE_FAILED'): ApiFailureBody {
  return { ok: false, error, modelVia: 'api' }
}

/**
 * Whether the API path should route. The literal key counts immediately; an
 * env-var reference needs resolution (async), so this sync check treats a
 * SET env name as potentially configured and lets the call surface a
 * UPSTREAM_FAILED if it resolves to nothing — but a disabled or malformed
 * section never routes.
 */
export function isApiCandidate(cfg: ApiResolvedConfig): boolean {
  if (!cfg.enabled) return false
  if (cfg.model.trim().length === 0) return false
  if (!URL.canParse(cfg.baseURL)) return false
  return (cfg.apiKey !== undefined && cfg.apiKey.trim().length > 0) || (cfg.apiKeyEnv !== undefined && cfg.apiKeyEnv.trim().length > 0)
}

/** Append the completions path to a user-supplied base (tolerates both bare hosts and `/v1`-style bases). */
export function completionsEndpoint(baseURL: string): string {
  const trimmed = baseURL.trim().replace(/\/+$/, '')
  if (trimmed.endsWith('/chat/completions')) return trimmed
  return `${trimmed}/chat/completions`
}

/**
 * Resolve the API key for one operation: literal config value wins, then the
 * injected resolver (credentials seam → process env inside index.ts). An
 * empty resolved value counts as absent. The value never leaves this module
 * except into the Authorization header.
 */
export async function resolveApiKey(deps: ApiDispatchDeps, cfg: ApiResolvedConfig): Promise<string | undefined> {
  const literal = cfg.apiKey?.trim()
  if (literal !== undefined && literal.length > 0) return literal
  const envName = cfg.apiKeyEnv?.trim()
  if (envName === undefined || envName.length === 0) return undefined
  const resolved = await deps.resolveApiKey(envName)
  const value = resolved?.trim()
  return value !== undefined && value.length > 0 ? value : undefined
}

/** One OpenAI-compatible chat completion: user message in, first choice text out. */
async function chatCompletion(
  deps: ApiDispatchDeps,
  cfg: ApiResolvedConfig,
  apiKey: string,
  prompt: string,
  signal: AbortSignal | undefined,
  extraBody: Record<string, unknown> = {},
): Promise<string> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch
  const endpoint = completionsEndpoint(cfg.baseURL)
  let response: Response
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        stream: false,
        messages: [{ role: 'user', content: prompt }],
        ...extraBody,
      }),
      ...(signal !== undefined ? { signal } : {}),
    })
  } catch (error) {
    if (signal?.aborted === true) throw new AbortError(signal)
    throw new UpstreamError(`request to ${endpoint} failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (signal?.aborted === true) throw new AbortError(signal)
  if (!response.ok) {
    let detail = ''
    try {
      const parsed: unknown = await response.json()
      const record = (parsed !== null && typeof parsed === 'object' ? parsed : {}) as { error?: unknown; message?: unknown }
      const raw = record.error
      const message = typeof raw === 'string'
        ? raw
        : raw !== null && typeof raw === 'object' && typeof (raw as { message?: unknown }).message === 'string'
          ? (raw as { message: string }).message
          : record.message
      if (typeof message === 'string' && message.length > 0) detail = `: ${message}`
    } catch {
      // Detail is best-effort; the status line alone is already actionable.
    }
    throw new UpstreamError(`endpoint answered HTTP ${response.status}${detail}`)
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new UpstreamError('endpoint returned a non-JSON body')
  }
  const content = (body as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || content.length === 0) {
    throw new ParseError('endpoint returned no message content')
  }
  return content
}

/** Transport-level failure → UPSTREAM_FAILED (+ modelVia hint). */
export class UpstreamError extends Error {}

/** Model-text failure → PARSE_FAILED (+ modelVia hint). */
export class ParseError extends Error {}

/** Caller abort → CANCELLED (no hint — the user stopped it). */
export class AbortError extends Error {
  constructor(signal: AbortSignal) {
    super(`aborted: ${String(signal.reason ?? 'signal aborted')}`)
  }
}

/**
 * Map one thrown dispatch step onto the frozen contract. Abort wins over
 * everything (a late transport error after an abort must not surface as
 * UPSTREAM_FAILED).
 */
export function mapApiError(error: unknown): ApiFailureBody | { ok: false; error: 'CANCELLED' } {
  if (error instanceof AbortError) return { ok: false, error: 'CANCELLED' }
  if (error instanceof ParseError) return apiFailure('PARSE_FAILED')
  return apiFailure('UPSTREAM_FAILED')
}

/** Create the independent-API dispatch (modelVia 'api' on success). */
export function createApiDispatch(deps: ApiDispatchDeps): EngineDispatch {
  return async function optimizeViaApi(job: OptimizeJob) {
    const cfg = deps.resolveConfig()
    const apiKey = await resolveApiKey(deps, cfg)
    if (apiKey === undefined) return apiFailure('UPSTREAM_FAILED')
    try {
      const raw = await chatCompletion(deps, cfg, apiKey, renderTemplate(job.style, job.draft, job.templateOverrides), job.signal)
      const scrubbed = scrubModelOutput(raw)
      if (!scrubbed.ok) return apiFailure('PARSE_FAILED')
      return { ok: true, optimized: scrubbed.text, style: job.style, modelVia: 'api' }
    } catch (error) {
      return mapApiError(error)
    }
  }
}

/** Connectivity-test outcome; the error string is human-readable and key-free. */
export type ApiTestResult = { ok: true; latencyMs: number; model: string } | { ok: false; error: string }

/**
 * The connectivity tester behind the settings-panel button (FR9): one
 * minimal completion (`max_tokens: 1`) against the configured endpoint.
 * Unconfigured sections answer a plain message, not an error — the panel
 * renders it as guidance.
 */
export function createApiTester(deps: ApiDispatchDeps): (signal?: AbortSignal) => Promise<ApiTestResult> {
  return async function testApi(signal?: AbortSignal): Promise<ApiTestResult> {
    const cfg = deps.resolveConfig()
    if (!cfg.enabled) return { ok: false, error: 'independent API is not enabled in this plugin\'s settings' }
    if (!isApiCandidate(cfg)) return { ok: false, error: 'base URL, model, or API key environment reference is missing' }
    const apiKey = await resolveApiKey(deps, cfg)
    if (apiKey === undefined) {
      return { ok: false, error: `no API key: set the key in the plugin settings or the "${cfg.apiKeyEnv ?? 'DEEPSEEK_API_KEY'}" environment variable` }
    }
    const startedAt = Date.now()
    try {
      await chatCompletion(deps, cfg, apiKey, 'ping', signal, { max_tokens: 1 })
      return { ok: true, latencyMs: Date.now() - startedAt, model: cfg.model }
    } catch (error) {
      if (error instanceof AbortError) return { ok: false, error: 'test aborted' }
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
}

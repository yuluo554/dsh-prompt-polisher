/**
 * Optimize pipeline (M2, plan/03 §3.2): request validation → workflow-engine
 * dispatch (single session-model agent) → output scrubbing. The M1 echo
 * pseudo-optimizer is GONE — the `[polisher:<style>]` marker no longer
 * appears in results (frozen-contract note recorded in HANDOFF-M2).
 *
 * Response contract (frozen, plan/06 既定口径):
 *
 *   { ok: true,  optimized: string, style: string, modelVia: 'session' | 'api' }
 *   { ok: false, error: PolishErrorCode }
 *
 * Error codes are a frozen contract (changing semantics requires re-running
 * the suite and recording it in the HANDOFF):
 *   EMPTY_DRAFT      blank/missing draft
 *   TOO_LONG         draft above DRAFT_MAX_LENGTH
 *   BAD_STYLE        style outside the supported set
 *   UPSTREAM_FAILED  engine/provider/parent-session unavailable, child run
 *                    failed, or the run settled non-completed
 *   PARSE_FAILED     model output failed the scrubber (never backfilled)
 *   CANCELLED        caller aborted mid-optimization
 */
import { createEngineDispatch } from './dispatch.js'
import type { EngineDispatch, OptimizeJob } from './dispatch.js'
import { DRAFT_MAX_LENGTH } from './limits.js'

/** Hard cap on accepted drafts (plan/03 §3.2: 上限如 8000 字符). */
export { DRAFT_MAX_LENGTH }

/** Error codes every optimize failure maps onto. */
export type PolishErrorCode =
  | 'EMPTY_DRAFT'
  | 'TOO_LONG'
  | 'UPSTREAM_FAILED'
  | 'PARSE_FAILED'
  | 'CANCELLED'
  | 'BAD_STYLE'

/**
 * Styles this build answers to. M2 keeps the two frozen presets; M3 grows
 * the set (风格菜单) — growing is the only allowed change, removals break
 * the frozen contract.
 */
export const SUPPORTED_STYLES: readonly string[] = ['concise', 'structured']

/** Wire shape of the optimize RPC request body (sessionId added in M2). */
export interface OptimizeRequestBody {
  draft: string
  style: string
  sessionId: string
  source?: 'button'
}

/**
 * Wire shape of the optimize RPC response (both arms). M3: the error arm
 * carries the additive `modelVia: 'api'` marker when the failure came from
 * the independent-API leg (CANCELLED excluded — the caller aborted) so the
 * browser can hint "switch back to the session model"; absence means the
 * engine leg (or a pre-dispatch rejection). Additive extension of the
 * frozen contract, recorded in plan/06 (M3).
 */
export type OptimizeResponseBody =
  | { ok: true; optimized: string; style: string; modelVia: 'session' | 'api' }
  | { ok: false; error: PolishErrorCode; modelVia?: 'api' }

/** Session id extracted from a parsed RPC body; null = transport rejection. */
export function parseSessionId(payload: Record<string, unknown>): string | null {
  const sessionId = payload.sessionId
  return typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : null
}

/**
 * Validate a parsed RPC body into an OptimizeRequestBody. Returns the error
 * code on business-level rejection — shape-agnostic callers (the route
 * handler) map this onto the wire response.
 */
export function parseOptimizeBody(payload: unknown, sessionId: string): { ok: true; body: OptimizeRequestBody } | { ok: false; error: PolishErrorCode } {
  if (typeof payload !== 'object' || payload === null) return { ok: false, error: 'EMPTY_DRAFT' }
  const record = payload as Record<string, unknown>
  const draft = record.draft
  if (typeof draft !== 'string' || draft.trim().length === 0) return { ok: false, error: 'EMPTY_DRAFT' }
  if (draft.length > DRAFT_MAX_LENGTH) return { ok: false, error: 'TOO_LONG' }
  // Absent style defaults to the baseline; an explicit but unsupported
  // value (empty string included) is a frozen BAD_STYLE, never silently
  // re-defaulted.
  const style = record.style === undefined ? 'concise' : record.style
  if (typeof style !== 'string' || !SUPPORTED_STYLES.includes(style)) return { ok: false, error: 'BAD_STYLE' }
  const source = record.source === 'button' ? 'button' : undefined
  return { ok: true, body: { draft, style, sessionId, ...(source !== undefined ? { source } : {}) } }
}

export { createEngineDispatch }
export type { EngineDispatch, OptimizeJob }

/**
 * Full M2 pipeline: parse → dispatch (engine → scrub). `dispatch` is
 * injected so tests can drive the pipeline offline with stub dispatchers;
 * the production caller passes the engine-half dispatch from the registry.
 */
export async function optimize(payload: unknown, dispatch: EngineDispatch | null, signal?: AbortSignal): Promise<OptimizeResponseBody> {
  const sessionId = typeof payload === 'object' && payload !== null ? parseSessionId(payload as Record<string, unknown>) : null
  if (sessionId === null) return { ok: false, error: 'UPSTREAM_FAILED' }
  const parsed = parseOptimizeBody(payload, sessionId)
  if (!parsed.ok) return parsed
  if (dispatch === null) {
    // Engine half not mounted (CLI profile hit through a web route, or the
    // patch flip failed): the session-model path is unavailable.
    return { ok: false, error: 'UPSTREAM_FAILED' }
  }
  const { draft, style } = parsed.body
  return dispatch({ draft, style, sessionId, ...(signal !== undefined ? { signal } : {}) })
}

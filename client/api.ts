/**
 * Optimize RPC client (M1/M2, plan/03 §3.2): one thin fetch wrapper over the
 * host half's `/api/prompt-polisher/optimize` route. Same-origin + cookie
 * auth by the Connection carrier; the `{ ok, ... }` envelope comes back
 * verbatim so the frozen error codes reach the button unchanged. M2 adds
 * `sessionId` — the host resolves the parent agent from it (R6 signal: the
 * browser abort propagates into the engine run).
 */
import type { OptimizeResponseBody } from '../src/optimize.js'

export interface OptimizeArgs {
  draft: string
  style: string
  sessionId: string
  source?: 'button'
}

export async function optimizeDraft(args: OptimizeArgs, signal?: AbortSignal): Promise<OptimizeResponseBody> {
  const response = await fetch('/api/prompt-polisher/optimize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(args),
    ...(signal !== undefined ? { signal } : {}),
  })
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // Non-JSON error page: fall through to the status-based message.
  }
  if (!response.ok) {
    const detail = body !== null && typeof body === 'object' && 'error' in body
      ? String((body as { error: unknown }).error)
      : `HTTP ${response.status}`
    throw new Error(detail)
  }
  return body as OptimizeResponseBody
}

/** Outcome of the FR9 connectivity test, mirrored from the host tester. */
export type ApiTestResult = { ok: true; latencyMs: number; model: string } | { ok: false; error: string }

/**
 * FR9 connectivity test (settings panel button): the HOST performs the
 * minimal completion against the configured endpoint; the response carries
 * latency/model/error text only — never the key.
 */
export async function testApiConnection(signal?: AbortSignal): Promise<ApiTestResult> {
  const response = await fetch('/api/prompt-polisher/test-api', {
    method: 'POST',
    ...(signal !== undefined ? { signal } : {}),
  })
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // Non-JSON error page → status-based message below.
  }
  if (!response.ok) {
    return { ok: false, error: `HTTP ${response.status}` }
  }
  const record = (body !== null && typeof body === 'object' ? body : {}) as Record<string, unknown>
  if (record.ok === true) {
    return {
      ok: true,
      latencyMs: typeof record.latencyMs === 'number' ? record.latencyMs : -1,
      model: typeof record.model === 'string' ? record.model : '',
    }
  }
  return { ok: false, error: typeof record.error === 'string' ? record.error : 'unknown error' }
}

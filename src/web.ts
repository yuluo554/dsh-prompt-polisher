/**
 * Host web half (M1/M2, plan/03 §3.2): the authenticated
 * `/api/prompt-polisher/optimize` POST route consumed by the browser bundle.
 * The client calls plain `fetch()` — same origin, cookie-authenticated by
 * the Connection carrier (dsh-plugin-dev §5 pattern, mirrors the official
 * deliverables routes).
 *
 * Mounted as a sub-plugin waiting on `connection`: profiles without the web
 * stack keep the core plugin active and simply never see these routes.
 * M2: the handler forwards validated jobs to the engine-half dispatch
 * (session-model optimization) and propagates the browser abort signal into
 * the engine run, so a session switch cancels the child agent. M3: the
 * dispatch the handler consumes is the ROUTER (independent API first when
 * configured, engine leg otherwise); a third route, `/test-api`, backs the
 * settings-panel connectivity button and never echoes the key.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import { optimize } from './optimize.js'
import type { OptimizeResponseBody } from './optimize.js'
import { getActiveDispatch, getApiTester } from './dispatch.js'
import type { ApiTestResult } from './api-dispatch.js'

/** Plugin name of the web sub-plugin (cordis fiber identity). */
export const WEB_PLUGIN_NAME = 'dsh-prompt-polisher-web'

/** The optimize RPC endpoint (frozen contract — plan/06 既定口径). */
export const OPTIMIZE_ROUTE = '/api/prompt-polisher/optimize'

/**
 * Mount the web half. Called from index.ts with the ROOT context.
 * `resolveDiagnostics` (M4) is the volatile `clientDiagnostics` config read
 * per report — never cached (M3 坑: caching a config value breaks live edits).
 */
export function mountWebHalf(ctx: Context, resolveDiagnostics?: () => boolean): void {
  ctx.plugin({
    name: WEB_PLUGIN_NAME,
    inject: ['connection'],
    apply: (webCtx: Context) => registerWebRoutes(webCtx, resolveDiagnostics),
  })
}

/** Register the route as one Cordis effect (uninstall revokes it). */
export function registerWebRoutes(ctx: Context, resolveDiagnostics?: () => boolean): void {
  const optimize: ConnectionFetchRoute = {
    path: OPTIMIZE_ROUTE,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: (request: Request) => handleOptimizeRequest(request),
  }
  const debug: ConnectionFetchRoute = {
    path: DEBUG_ROUTE,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: (request: Request) => handleDebugRequest(request, resolveDiagnostics),
  }
  const testApi: ConnectionFetchRoute = {
    path: TEST_API_ROUTE,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: (request: Request) => handleTestApiRequest(request),
  }
  ctx.effect(() => {
    const disposeOptimize = ctx.connection.fetch.register(optimize)
    const disposeDebug = ctx.connection.fetch.register(debug)
    const disposeTestApi = ctx.connection.fetch.register(testApi)
    return () => {
      void disposeOptimize()
      void disposeDebug()
      void disposeTestApi()
    }
  }, 'dsh-prompt-polisher: web routes')
}

/**
 * Client-side diagnostics sink (M2 目检): the browser half posts every
 * lifecycle-stage failure (bundle execution, apply, seat registration,
 * component render) here; the host mirrors it into the server log — the
 * only observable channel when CDP is broken (environment pit #1). The
 * carrier's cookie auth gates the route like any other.
 *
 * M4: `resolveDiagnostics` gates the log mirror (config `clientDiagnostics`,
 * default on) — the route still answers 200 so the fire-and-forget client
 * never changes behavior; only the log line is dropped.
 */
export const DEBUG_ROUTE = '/api/prompt-polisher/debug'

export async function handleDebugRequest(request: Request, resolveDiagnostics?: () => boolean): Promise<Response> {
  let payload: unknown = null
  try {
    payload = await request.json()
  } catch {
    return Response.json({ ok: false }, { status: 400 })
  }
  if (resolveDiagnostics?.() === false) return Response.json({ ok: true })
  const record = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>
  const stage = typeof record.stage === 'string' ? record.stage : 'unknown'
  const message = typeof record.message === 'string' ? record.message : ''
  const stack = typeof record.stack === 'string' ? record.stack : ''
  console.error(`[dsh-prompt-polisher:client] ${stage}: ${message}${stack !== '' ? `\n${stack}` : ''}`)
  return Response.json({ ok: true })
}

/**
 * The optimize RPC handler: buffered JSON body in, `{ok, ...}` envelope out.
 * Transport-level failures (malformed/non-object JSON, missing sessionId)
 * answer HTTP 400; business-level rejections answer 200 with
 * `{ ok: false, error: code }` so the browser half can surface the frozen
 * error codes verbatim.
 */
export async function handleOptimizeRequest(request: Request): Promise<Response> {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return Response.json({ error: 'request body must be JSON' }, { status: 400 })
  }
  if (typeof payload !== 'object' || payload === null) {
    return Response.json({ error: 'request body must be an object' }, { status: 400 })
  }
  const record = payload as Record<string, unknown>
  const sessionId = typeof record.sessionId === 'string' && record.sessionId.length > 0 ? record.sessionId : null
  if (sessionId === null) {
    // Without a session the engine path has no parent agent to attribute
    // the child to — a malformed request, not a model-side failure.
    return Response.json({ error: 'sessionId must be a non-empty string' }, { status: 400 })
  }
  const body: OptimizeResponseBody = await optimize(payload, getActiveDispatch(), request.signal)
  return Response.json(body)
}

/**
 * The FR9 connectivity-test endpoint (consumed by the settings-page panel):
 * the HOST performs one minimal completion against the configured
 * OpenAI-compatible endpoint. The answer never carries the key — only
 * latency, model name, and a human-readable failure message. Always HTTP
 * 200: every outcome (including "not configured") is business-level.
 */
export const TEST_API_ROUTE = '/api/prompt-polisher/test-api'

export async function handleTestApiRequest(request: Request): Promise<Response> {
  const tester = getApiTester()
  if (tester === null) {
    return Response.json({ ok: false, error: 'plugin is still activating; try again in a moment' } satisfies ApiTestResult)
  }
  let body: ApiTestResult
  try {
    body = await tester(request.signal)
  } catch (error) {
    body = { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  return Response.json(body)
}

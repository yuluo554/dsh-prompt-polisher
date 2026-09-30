/**
 * Workflow-engine dispatch (M2, plan/02 模型通路 A): runs one optimization
 * through the dsh workflow engine's single `agent()` call — the session
 * model, zero configuration (FR7).
 *
 * R5 injection discipline: the script body is a FIXED constant; the draft
 * reaches the script as DATA through `args` (JSON materialized into the
 * guest realm by the engine). The script literal never contains user text.
 *
 * Result mapping (frozen codes, plan/06):
 *   stopReason 'cancelled'            -> CANCELLED
 *   stopReason anything else          -> UPSTREAM_FAILED
 *   value null (child run failed)     -> UPSTREAM_FAILED
 *   value not a non-empty string      -> PARSE_FAILED
 *   scrubbed empty                    -> PARSE_FAILED
 * Anything that passes the scrubber answers `{ ok: true, modelVia: 'session' }`.
 */
import type { Agent } from '@deepseek-ai/dsh-agent'
// Type-only imports whose module augmentations put `sessionController` on
// the cordis Context (same convention as dsh-pipeline's web half).
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkflowStartRequest, WorkflowRun } from '@deepseek-ai/dsh-workflow'
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import type { WorkflowEngine } from '@deepseek-ai/dsh-workflow'
import type { ApiTestResult } from './api-dispatch.js'
import type { OptimizeResponseBody } from './optimize.js'
import { decideBackfill } from './race.js'
import { scrubModelOutput } from './scrub.js'
import { renderTemplate } from './templates.js'

/**
 * The FIXED script body (R5): async IIFE body per the engine contract;
 * `args.prompt` is the rendered template (draft included as data). A failed
 * child run settles `agent()` to null, which we surface as UPSTREAM_FAILED.
 */
export const POLISH_SCRIPT = [
  "const polished = await agent(args.prompt, { label: 'polish' })",
  'return polished',
].join('\n')

/** Engine-side identity block (meta.name is required non-empty, strong-validated). */
export const POLISH_META: WorkflowStartRequest['meta'] = {
  name: 'prompt-polisher',
  description: 'Rewrite the composer draft into a clear prompt with the session model (single agent).',
}

/** `ctx.subagents` provider the engine's children run on (host default). */
export const ENGINE_PROVIDER = 'spawn'

/** One optimize job after request validation. */
export interface OptimizeJob {
  draft: string
  style: string
  /** Browser session id — the parent agent is resolved from it. */
  sessionId: string
  /** FR10: per-style custom template overrides snapshot (absent = built-in). */
  templateOverrides?: { concise?: string; structured?: string }
  /** Browser fetch abort; aborting cancels the engine run. */
  signal?: AbortSignal
}

export type EngineDispatch = (job: OptimizeJob) => Promise<OptimizeResponseBody>

export interface EngineDispatchDeps {
  engine: WorkflowEngine
  sessionController: { resolveAgent(sessionId: SessionId): Promise<{ agent: Agent } | { error: { code: string; message?: string } }> }
  subagents: SubagentRuntime
}

/**
 * Map one settled engine run onto the frozen response contract (the single
 * home of the stopReason × value → error-code table). Exported so the bench
 * prototype's scripted model can feed RAW model text through the same
 * scrub-and-map tail the real dispatch uses.
 */
export function mapEngineResult(style: string, result: { value: unknown; stopReason: string }): OptimizeResponseBody {
  if (result.stopReason === 'cancelled') return { ok: false, error: 'CANCELLED' }
  if (result.stopReason !== 'completed') return { ok: false, error: 'UPSTREAM_FAILED' }
  if (result.value === null) return { ok: false, error: 'UPSTREAM_FAILED' }
  if (typeof result.value !== 'string' || result.value.length === 0) {
    return { ok: false, error: 'PARSE_FAILED' }
  }
  const scrubbed = scrubModelOutput(result.value)
  if (!scrubbed.ok) return { ok: false, error: 'PARSE_FAILED' }
  return { ok: true, optimized: scrubbed.text, style, modelVia: 'session' }
}

/**
 * Create the dispatch bound to one engine-half context. Kept dependency-
 * injected (plain objects) so the real-engine tests can drive the full
 * mapping offline with stubbed services (plan/04 tier 2).
 */
export function createEngineDispatch(deps: EngineDispatchDeps): EngineDispatch {
  return async function optimizeViaEngine(job: OptimizeJob): Promise<OptimizeResponseBody> {
    // The provider availability check is a fast, crisp path to the same
    // frozen code the engine would surface later via AGENT_START.
    const providerAvailable = typeof deps.subagents?.getProvider === 'function'
      && deps.subagents.getProvider(ENGINE_PROVIDER) !== undefined
    if (!providerAvailable) return { ok: false, error: 'UPSTREAM_FAILED' }

    const resolved = await deps.sessionController.resolveAgent(brandString<SessionId>(job.sessionId))
    if (!('agent' in resolved) || resolved.agent === undefined) return { ok: false, error: 'UPSTREAM_FAILED' }
    const parent: Agent = resolved.agent

    const request: WorkflowStartRequest = {
      script: POLISH_SCRIPT,
      meta: POLISH_META,
      args: { prompt: renderTemplate(job.style, job.draft, job.templateOverrides) },
      maxTotalAgents: 1,
      parent,
      ...(job.signal !== undefined ? { signal: job.signal } : {}),
    }
    let run: WorkflowRun
    try {
      run = deps.engine.start(request)
    } catch {
      // Synchronous pre-flight rejection (META_INVALID / SCRIPT_PARSE):
      // a plugin bug — but the wire contract stays frozen.
      return { ok: false, error: 'UPSTREAM_FAILED' }
    }
    const result = await run.result
    void run.dispose().catch(() => {})
    return mapEngineResult(job.style, result)
  }
}

/**
 * Decide whether the optimized text may replace the live draft (R6). Thin
 * re-export wrapper so the client imports one name and dispatch stays the
 * only engine-touching module.
 */
export { decideBackfill }

/** Module-level registry: the engine half publishes, the router consumes. */
let activeDispatch: EngineDispatch | null = null

/** Publish the dispatch; returns the dispose that unpublishes it. */
export function setEngineDispatch(dispatch: EngineDispatch): () => void {
  activeDispatch = dispatch
  return () => {
    if (activeDispatch === dispatch) activeDispatch = null
  }
}

/** The live engine dispatch, or null when the engine half is not mounted. */
export function getEngineDispatch(): EngineDispatch | null {
  return activeDispatch
}

/**
 * M3 registries: what the optimize RPC actually consumes is the ROUTER
 * (independent API when configured, else the engine path) — published by the
 * root half at apply time. Separate slot from the engine registry so a
 * missing engine half degrades only the engine leg while the router keeps
 * answering (and the API leg stays usable).
 */
let activeRouter: EngineDispatch | null = null

/** Publish the router dispatch; returns the dispose that unpublishes it. */
export function setActiveDispatch(dispatch: EngineDispatch): () => void {
  activeRouter = dispatch
  return () => {
    if (activeRouter === dispatch) activeRouter = null
  }
}

/** The live router dispatch, or null before the root half applied. */
export function getActiveDispatch(): EngineDispatch | null {
  return activeRouter
}

/** Module-level tester registry: the root half publishes the connectivity tester (FR9). */
let activeTester: ((signal?: AbortSignal) => Promise<ApiTestResult>) | null = null

/** Publish the connectivity tester; returns the dispose that unpublishes it. */
export function setApiTester(tester: (signal?: AbortSignal) => Promise<ApiTestResult>): () => void {
  activeTester = tester
  return () => {
    if (activeTester === tester) activeTester = null
  }
}

/** The live tester, or null when the root half has not applied / lacks the config schema. */
export function getApiTester(): ((signal?: AbortSignal) => Promise<ApiTestResult>) | null {
  return activeTester
}

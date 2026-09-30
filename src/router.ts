/**
 * Model-path router (M3, plan/02 通路分派): what the optimize RPC consumes.
 * Per job — independent API first when the config snapshot marks it usable,
 * otherwise the workflow-engine (session model) path, with the same frozen
 * UPSTREAM_FAILED for a missing engine half as M2.
 *
 * The router attaches the FR10 template-overrides snapshot to the job so
 * BOTH legs render the same override; the API leg snapshots its config again
 * inside the dispatch (volatile reads, same tick — the official
 * resolveOptions thunk convention) and resolves the credential there.
 */
import type { EngineDispatch, OptimizeJob } from './dispatch.js'
import { getEngineDispatch } from './dispatch.js'
import type { ApiResolvedConfig } from './config.js'
import { isApiCandidate } from './api-dispatch.js'

export interface RouterDeps {
  /** Per-job config snapshot (volatile schema read; never cached). */
  resolveConfig: () => { api: ApiResolvedConfig; templates: { concise?: string; structured?: string } }
  /** The API leg (already bound to the same deps as resolveConfig). */
  apiDispatch: EngineDispatch
  /** Engine registry lookup; defaults to the module registry (injected for tests). */
  getEngineDispatch?: () => EngineDispatch | null
}

/**
 * Route one job. Decision per job (never cached): a settings flip between
 * two optimizations changes the path without a restart; a mid-flight flip
 * does not affect the already-started leg.
 */
export function createRouterDispatch(deps: RouterDeps): EngineDispatch {
  const lookup = deps.getEngineDispatch ?? getEngineDispatch
  return async function route(job: OptimizeJob) {
    const { api, templates } = deps.resolveConfig()
    const overridesJob: OptimizeJob = { ...job, ...(Object.values(templates).some((v) => v !== undefined) ? { templateOverrides: templates } : {}) }
    if (isApiCandidate(api)) return deps.apiDispatch(overridesJob)
    const engine = lookup()
    if (engine === null) return { ok: false, error: 'UPSTREAM_FAILED' }
    return engine(overridesJob)
  }
}

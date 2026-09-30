/**
 * Engine half (M2, plan/05 §M2 item 1): sub-plugin that waits for the
 * workflow services and publishes the optimize dispatch. Kept SEPARATE from
 * the web half so a profile that lacks the engine (or a failed patch flip)
 * degrades the optimize route to UPSTREAM_FAILED instead of silently never
 * mounting the routes; on CLI-only profiles the sub-plugin simply stays
 * pending (by design — no web routes there either).
 *
 * Requires the cordis.patch.yml flip `- id: workflow-ptc / disabled: false`
 * (the web profile preset ships the engine disabled); the compatibility
 * floor `>=0.2.0-rc.1` matches the row id's first appearance and stays.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-workflow'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { createEngineDispatch, setEngineDispatch } from './dispatch.js'

/** Plugin name of the engine sub-plugin (cordis fiber identity). */
export const ENGINE_PLUGIN_NAME = 'dsh-prompt-polisher-engine'

/** Browser services required before the dispatch can publish. */
export const ENGINE_INJECT = ['workflowEngine', 'subagents', 'sessionController']

/** Mount the engine half. Called from index.ts with the ROOT context. */
export function mountEngineHalf(ctx: Context): void {
  ctx.plugin({
    name: ENGINE_PLUGIN_NAME,
    inject: ENGINE_INJECT,
    apply: (engineCtx: Context) => {
      const dispatch = createEngineDispatch({
        engine: engineCtx.workflowEngine,
        sessionController: engineCtx.sessionController,
        subagents: engineCtx.subagents,
      })
      console.log(`[dsh-prompt-polisher] engine half applied; provider "${'spawn'}" dispatch published`)
      return setEngineDispatch(dispatch)
    },
  })
}

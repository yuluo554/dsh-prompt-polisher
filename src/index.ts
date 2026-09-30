/**
 * Host half entry (M1-M3, plan/03 §3.1): the Node-side apply the dsh bundle
 * loader runs on activation. The core half carries no hard service
 * dependencies, so activation succeeds on every profile. Sub-plugins:
 *  - web half (`connection`): the optimize + debug + test-api RPC routes;
 *  - engine half (`workflowEngine`+`subagents`+`sessionController`, M2):
 *    publishes the session-model optimize dispatch. Requires the patch
 *    flip `- id: workflow-ptc / disabled: false` (cordis.patch.yml); the
 *    compatibility floor `>=0.2.0-rc.1` matches the row id and was
 *    re-audited in M2 (plan/05 §M2).
 *
 * M3: apply takes the bundle-row CONFIG (validated through the exported
 * schemastery `Config` in src/config.ts — volatile refs, live updates) and
 * publishes the ROUTER dispatch (independent OpenAI-compatible API first,
 * engine leg otherwise) plus the settings-panel connectivity tester. The
 * API key is resolved per operation: literal secret-role field, then the
 * credentials seam, then the process environment — it never reaches the
 * browser (plan/06: key 只存宿主侧).
 */
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
// Type-only import whose module augmentation puts `credentials` on the
// cordis Context (optional at runtime — CLI profiles may not mount it).
import type {} from '@deepseek-ai/dsh-credentials'
import { snapshotConfig } from './config.js'
import type { PolisherConfig } from './config.js'
import { createApiDispatch, createApiTester } from './api-dispatch.js'
import { setApiTester, setActiveDispatch } from './dispatch.js'
import { createRouterDispatch } from './router.js'
import { mountWebHalf } from './web.js'
import { OPTIMIZE_ROUTE } from './web.js'
import { mountEngineHalf } from './engine-half.js'

export { Config } from './config.js'
export type { PolisherConfig } from './config.js'

export const name = 'dsh-prompt-polisher'
export const inject: string[] = []

export function apply(ctx: Context, config: PolisherConfig) {
  // Per-operation snapshot thunks: every .get() re-reads the volatile
  // section, so settings edits apply on the NEXT optimization without a
  // restart (loader in-place volatile update).
  const resolveApiConfig = () => snapshotConfig(config).api
  const apiDeps = {
    resolveConfig: resolveApiConfig,
    resolveApiKey: async (envName: string): Promise<string | undefined> => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) {
        const resolved = await credentials.resolve(credentialRef(envName))
        if (resolved?.value !== undefined && resolved.value.length > 0) return resolved.value
      }
      return process.env[envName]
    },
  }
  const disposeRouter = setActiveDispatch(createRouterDispatch({
    resolveConfig: () => snapshotConfig(config),
    apiDispatch: createApiDispatch(apiDeps),
  }))
  const disposeTester = setApiTester(createApiTester(apiDeps))
  // M4: per-report volatile read — the settings toggle applies without a restart.
  mountWebHalf(ctx, () => config.clientDiagnostics.get() === true)
  mountEngineHalf(ctx)
  console.log(`[dsh-prompt-polisher] host half applied; optimize RPC pending connection: ${OPTIMIZE_ROUTE}`)
  return () => {
    disposeRouter()
    disposeTester()
  }
}

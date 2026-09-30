/**
 * Real-engine tests (M2, plan/04 tier 2; adapted 0.2.0-rc.1, dsh-plugin-dev
 * §6 stub forms): the FIXED polish script driven through the ACTUAL dsh
 * workflow engine (@deepseek-ai/dsh-workflow-ptc 0.2.0-rc.1) with stub
 * services — no model API, fully offline.
 *
 * The PTC engine offloads script execution to a sandboxed Node process via
 * `ctx.ptcRuntime`. The stub runtime here executes the REAL guest in-process:
 * the program string the engine passes to runtime.run embeds the guest as a
 * data: URL module (`await import("data:text/javascript,…")` followed by
 * `runWorkflowGuest(workflowHost)`), so the stub imports that same module and
 * calls runWorkflowGuest with the engine's own host bindings. Everything
 * above the process boundary — meta validation, body parse, caps, run
 * lifecycle, child RPC, cancellation — is the real engine.
 *
 * What this tier proves for the polisher:
 * - the frozen POLISH_SCRIPT compiles and runs in the real guest realm;
 * - R5: drafts containing backticks / `${}` / newlines ride through `args`
 *   as DATA and never break the script literal;
 * - the full dispatch mapping (fence scrubbing, PARSE_FAILED/UPSTREAM_FAILED/
 *   CANCELLED) holds against real engine semantics;
 * - cancellation end to end: the input AbortSignal reaches the real engine,
 *   aborts the shared signal passed to the child, and settles `cancelled`.
 *
 * Environment note (M2 实测, dsh-plugin-dev §6): the engine service is
 * normally constructed by Cordis (zod fills config defaults); constructing
 * it manually requires the FULL config — the PTC config schema is
 * {provider, maxConcurrentAgents, maxTotalAgents, maxItemsPerCall,
 * syncTimeoutMs}.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import Engine from '@deepseek-ai/dsh-workflow-ptc'
import { createEngineDispatch, POLISH_SCRIPT, POLISH_META, ENGINE_PROVIDER } from '../lib/dispatch.js'

/** Fixtures: drafts that would break any script-literal concatenation (R5). */
const SPECIAL_DRAFT = [
  '帮我优化这段提示词，含反引号 `code` 与模板注入 ${process.exit(1)} 与',
  '"双引号" 和 \\反斜杠 和换行',
  '以及 中文 emoji 🚀',
].join('\n')

function makeStubSubagents({ outputText = 'polished by stub', failFromCall = Infinity, hangFromCall = Infinity } = {}) {
  const started = []
  let call = 0
  return {
    started,
    getProvider(name) {
      return name === ENGINE_PROVIDER ? { capabilities: { agentOptions: true, outputSchema: true } } : undefined
    },
    async start(_provider, req) {
      call += 1
      const nth = call
      // 0.2.0 PTC guest carries run.id into workflow/agent-start payloads
      // (childId); a real subagent run always has its session id.
      const run = { disposeCount: 0, id: `stub-child-${nth}` }
      if (nth >= hangFromCall) {
        // Model a long-running child: settles only when aborted.
        run.result = new Promise((resolve) => {
          if (req.signal) req.signal.addEventListener('abort', () => resolve({ output: [], stopReason: 'cancelled' }), { once: true })
        })
      } else {
        const failed = nth >= failFromCall
        run.result = new Promise((resolve) => {
          const t = setTimeout(
            () => resolve(
              failed
                ? { output: [], stopReason: 'error', error: 'stub injected failure' }
                : { output: [{ type: 'text', text: typeof outputText === 'function' ? outputText(nth) : outputText }], stopReason: 'completed' },
            ),
            10,
          )
          if (req.signal) req.signal.addEventListener('abort', () => { clearTimeout(t); resolve({ output: [], stopReason: 'cancelled' }) }, { once: true })
        })
      }
      run.dispose = async () => { run.disposeCount += 1 }
      started.push({ nth, signal: req.signal, prompt: req.prompt?.[0]?.text, run })
      return run
    },
  }
}

/**
 * Stub PTC runtime: runs the engine's REAL guest module in-process instead of
 * a sandboxed child (form copied from dsh-pipeline test/real-engine.test.js).
 */
function makeStubPtcRuntime() {
  return {
    language: 'typescript',
    resolve: (spec) => spec,
    async run(spec) {
      const match = /await import\((".*")\)/.exec(spec.program)
      assert.ok(match, 'engine program must embed the guest as a string import')
      const guest = await import(JSON.parse(match[1]))
      const host = spec.bindings.find((b) => b.global === 'workflowHost').functions
      const program = guest.runWorkflowGuest(host)
      // The losing guest promise must never become an unhandled rejection.
      program.catch(() => {})
      return Promise.race([
        program.then((value) => ({ value })),
        new Promise((_resolve, reject) => {
          spec.signal?.addEventListener('abort', () => reject(spec.signal.reason), { once: true })
        }),
      ])
    },
  }
}

function makeStubSandboxPolicy() {
  const policy = { workspaceRoot: process.cwd() }
  return { resolve: () => policy }
}

/** Real PtcWorkflowEngine on a bare Cordis context with stub services. */
function makeEngine(stub) {
  const ctx = new Context()
  ctx.subagents = stub
  ctx.ptcRuntime = makeStubPtcRuntime()
  ctx.sandboxPolicy = makeStubSandboxPolicy()
  // Surface the engine's own diagnostics: a swallowed warn hides exactly the
  // failure detail the offline tier exists to expose (M5: a node-version
  // mismatch was invisible behind this stub until CI diffed against the dev box).
  ctx.logger = { warn: (...parts) => console.error('[engine]', ...parts) }
  // Full config: zod defaults only apply through the Cordis plugin flow.
  return new Engine(ctx, {
    provider: ENGINE_PROVIDER,
    maxConcurrentAgents: 0,
    maxTotalAgents: 1000,
    maxItemsPerCall: 4096,
    syncTimeoutMs: 5000,
  })
}

/** Full dispatch deps: real engine + stub session/subagents. */
function makeDispatch(stub, overrides = {}) {
  const deps = {
    engine: makeEngine(stub),
    sessionController: {
      resolveAgent: async (sessionId) => overrides.resolve === 'error'
        ? { error: { code: 'NO_AGENT', message: 'stub: session has no agent' } }
        : { agent: { session: { id: String(sessionId) } } },
    },
    subagents: stub,
  }
  return { dispatch: createEngineDispatch(deps), deps }
}

test('real engine runs POLISH_SCRIPT to completion; special-character draft rides through args (R5)', { timeout: 20_000 }, async () => {
  const stub = makeStubSubagents({ outputText: '精炼后的提示词' })
  const { dispatch } = makeDispatch(stub)
  const result = await dispatch({ draft: SPECIAL_DRAFT, style: 'concise', sessionId: 'sess-r1' })
  assert.deepEqual(result, { ok: true, optimized: '精炼后的提示词', style: 'concise', modelVia: 'session' })
  // The child saw the draft VERBATIM inside the rendered template — data,
  // never script source (R5).
  assert.equal(stub.started.length, 1)
  assert.ok(stub.started[0].prompt.includes(SPECIAL_DRAFT), 'draft text intact in the agent prompt')
  assert.ok(stub.started[0].prompt.includes('用户草稿'), 'zh skeleton selected for a CJK draft')
  assert.equal(stub.started[0].run.disposeCount, 1)
})

test('real engine: fenced stub output is scrubbed (fence + language tag + quotes)', { timeout: 20_000 }, async () => {
  for (const [raw, expected] of [
    ['```\n优化后的提示词\n```', '优化后的提示词'],
    ['```text\npolished prompt\n```', 'polished prompt'],
    ['"quoted output"', 'quoted output'],
    ['“中文引号”', '中文引号'],
  ]) {
    const stub = makeStubSubagents({ outputText: raw })
    const { dispatch } = makeDispatch(stub)
    const result = await dispatch({ draft: 'a plain draft for polishing', style: 'concise', sessionId: 'sess-r2' })
    assert.deepEqual(result, { ok: true, optimized: expected, style: 'concise', modelVia: 'session' }, raw)
  }
})

test('real engine: empty stub output → PARSE_FAILED; failed child → UPSTREAM_FAILED', { timeout: 20_000 }, async () => {
  const empty = makeDispatch(makeStubSubagents({ outputText: '   \n  ' }))
  assert.deepEqual(
    await empty.dispatch({ draft: 'a plain draft', style: 'concise', sessionId: 's' }),
    { ok: false, error: 'PARSE_FAILED' },
  )

  const failing = makeDispatch(makeStubSubagents({ failFromCall: 1 }))
  assert.deepEqual(
    await failing.dispatch({ draft: 'a plain draft', style: 'concise', sessionId: 's' }),
    { ok: false, error: 'UPSTREAM_FAILED' },
    'child failure settles agent() null → UPSTREAM_FAILED',
  )
})

test('real engine: input AbortSignal cancels the run mid-child and maps to CANCELLED (FR8/R6)', { timeout: 20_000 }, async () => {
  const stub = makeStubSubagents({ hangFromCall: 1 })
  const { dispatch } = makeDispatch(stub)
  const controller = new AbortController()
  const pending = dispatch({ draft: 'a plain draft', style: 'concise', sessionId: 's', signal: controller.signal })
  // Wait for the child to start, then cancel through the input signal.
  const deadline = Date.now() + 10_000
  while (stub.started.length < 1) {
    if (Date.now() > deadline) throw new Error('timeout waiting for the child to start')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  controller.abort(new Error('browser aborted'))
  const result = await pending
  assert.deepEqual(result, { ok: false, error: 'CANCELLED' })
  assert.equal(stub.started[0].signal.aborted, true, 'the engine aborts the child via the shared signal')
  assert.equal(stub.started[0].run.disposeCount, 1, 'the cancelled child is disposed exactly once')
})

test('real engine: unresolvable parent session → UPSTREAM_FAILED without starting children', { timeout: 20_000 }, async () => {
  const stub = makeStubSubagents()
  const { dispatch } = makeDispatch(stub, { resolve: 'error' })
  const result = await dispatch({ draft: 'a plain draft', style: 'concise', sessionId: 'ghost' })
  assert.deepEqual(result, { ok: false, error: 'UPSTREAM_FAILED' })
  assert.equal(stub.started.length, 0, 'no child may start without a parent agent')
})

test('real engine accepts the frozen meta block (strong validation would throw synchronously)', { timeout: 20_000 }, async () => {
  assert.ok(POLISH_META.name.length > 0)
  assert.ok(POLISH_META.description.length > 0)
  // Structured style end to end: the engine validates meta + runs the same
  // fixed script, the zh skeleton reaches the child.
  const stub = makeStubSubagents({ outputText: '# 角色\n……\n# 任务\n……' })
  const { dispatch } = makeDispatch(stub)
  const result = await dispatch({ draft: SPECIAL_DRAFT, style: 'structured', sessionId: 'sess-s' })
  assert.equal(result.ok, true)
  assert.equal(result.style, 'structured')
  assert.ok(stub.started[0].prompt.includes('【角色】'), 'structured zh skeleton in the child prompt')
})

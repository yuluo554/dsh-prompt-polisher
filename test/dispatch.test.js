/**
 * Engine dispatch mapping tests (M2, plan/04 tier 1): the frozen-code
 * mapping table (stopReason × value → error code) driven through
 * createEngineDispatch with a FAKE engine — no vm, fast. The real-engine
 * tier (same dispatch, real dsh-workflow-ptc) lives in real-engine.test.js.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createEngineDispatch, POLISH_SCRIPT, POLISH_META } from '../lib/dispatch.js'

function makeDeps({ providerAvailable = true, resolve = 'agent', engine } = {}) {
  return {
    engine: engine ?? {
      start(request) {
        return { result: Promise.resolve({ value: 'polished', stopReason: 'completed', agentsStarted: 1 }), dispose: async () => {} }
      },
    },
    sessionController: {
      resolveAgent: async () => resolve === 'agent'
        ? { agent: { session: { id: 'sess-1' } } }
        : { error: { code: resolve, message: `stub ${resolve}` } },
    },
    subagents: {
      getProvider: (name) => providerAvailable ? { capabilities: {} } : undefined,
    },
  }
}

function job(overrides = {}) {
  return { draft: '帮我写个东西', style: 'concise', sessionId: 'sess-1', ...overrides }
}

test('happy path: completed string value is scrubbed into {ok:true, modelVia session}', async () => {
  const dispatch = createEngineDispatch(makeDeps())
  assert.deepEqual(await dispatch(job()), { ok: true, optimized: 'polished', style: 'concise', modelVia: 'session' })
})

test('mapping table: cancelled → CANCELLED; other stopReasons → UPSTREAM_FAILED', async () => {
  for (const [stopReason, expected] of [
    ['cancelled', 'CANCELLED'],
    ['error', 'UPSTREAM_FAILED'],
  ]) {
    const engine = { start: () => ({ result: Promise.resolve({ value: null, stopReason, error: 'stub' }), dispose: async () => {} }) }
    const result = await createEngineDispatch(makeDeps({ engine }))(job())
    assert.equal(result.error, expected, stopReason)
  }
})

test('mapping table: value null (child run failed) → UPSTREAM_FAILED; empty/non-string → PARSE_FAILED', async () => {
  for (const [value, expected] of [
    [null, 'UPSTREAM_FAILED'],
    ['', 'PARSE_FAILED'],
    [42, 'PARSE_FAILED'],
    ['   ', 'PARSE_FAILED'],
    ['```\n```', 'PARSE_FAILED'],
  ]) {
    const engine = { start: () => ({ result: Promise.resolve({ value, stopReason: 'completed' }), dispose: async () => {} }) }
    const result = await createEngineDispatch(makeDeps({ engine }))(job())
    assert.equal(result.error, expected, JSON.stringify(value))
  }
})

test('infra failures: provider missing / session unresolvable / start throw → UPSTREAM_FAILED', async () => {
  const noProvider = await createEngineDispatch(makeDeps({ providerAvailable: false }))(job())
  assert.equal(noProvider.error, 'UPSTREAM_FAILED')

  const badSession = await createEngineDispatch(makeDeps({ resolve: 'NO_AGENT' }))(job())
  assert.equal(badSession.error, 'UPSTREAM_FAILED')

  const throwingEngine = { start: () => { throw new Error('META_INVALID') } }
  const thrown = await createEngineDispatch(makeDeps({ engine: throwingEngine }))(job())
  assert.equal(thrown.error, 'UPSTREAM_FAILED')
})

test('the engine request carries the fixed script, meta, single-agent cap and rendered args', async () => {
  const seen = []
  const engine = {
    start(request) {
      seen.push(request)
      return { result: Promise.resolve({ value: 'ok', stopReason: 'completed' }), dispose: async () => {} }
    },
  }
  await createEngineDispatch(makeDeps({ engine }))(job({ draft: '草稿含 `反引号` 与 ${危险} 与 \\ 反斜杠' }))
  assert.equal(seen.length, 1)
  assert.equal(seen[0].script, POLISH_SCRIPT)
  assert.equal(seen[0].meta.name, POLISH_META.name)
  assert.equal(seen[0].maxTotalAgents, 1)
  assert.ok(seen[0].args.prompt.includes('草稿含 `反引号` 与 ${危险} 与 \\ 反斜杠'), 'draft rides inside args.prompt data')
  assert.deepEqual(seen[0].parent, { session: { id: 'sess-1' } })
})

test('abort signal propagates into the engine request', async () => {
  const seen = []
  const engine = {
    start(request) {
      seen.push(request)
      return { result: Promise.resolve({ value: null, stopReason: 'cancelled' }), dispose: async () => {} }
    },
  }
  const controller = new AbortController()
  await createEngineDispatch(makeDeps({ engine }))(job({ signal: controller.signal }))
  assert.equal(seen[0].signal, controller.signal)
})

test('dispose is invoked exactly once per run', async () => {
  let disposed = 0
  const engine = { start: () => ({ result: Promise.resolve({ value: 'x', stopReason: 'completed' }), dispose: async () => { disposed += 1 } }) }
  await createEngineDispatch(makeDeps({ engine }))(job())
  assert.equal(disposed, 1)
})

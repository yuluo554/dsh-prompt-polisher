/**
 * Optimize RPC tests (M2, plan/04 test tier 1+3): the pure pipeline
 * (parse → dispatch) and the route handler driven through CONSTRUCTED Request
 * objects — no server, no model API. The dispatch is a STUB here (tier 1
 * mock); the real-engine tier lives in real-engine.test.js. Asserts the
 * frozen wire contract:
 *
 *   POST /api/prompt-polisher/optimize
 *   200 { ok: true,  optimized, style, modelVia }   business success
 *   200 { ok: false, error: <code> }                business rejection
 *   400 { error: string }                           transport rejection
 *                                                   (malformed body / missing sessionId)
 *
 * M2 note: the M1 echo marker is gone — results now come from the dispatch
 * (HANDOFF-M2 口径: marker 消失属预期).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { optimize, parseOptimizeBody, parseSessionId, DRAFT_MAX_LENGTH, SUPPORTED_STYLES } from '../lib/optimize.js'
import { handleOptimizeRequest, handleTestApiRequest, handleDebugRequest, registerWebRoutes, OPTIMIZE_ROUTE, DEBUG_ROUTE, TEST_API_ROUTE } from '../lib/web.js'
import { getActiveDispatch, setActiveDispatch, getEngineDispatch, setEngineDispatch, setApiTester, getApiTester } from '../lib/dispatch.js'
import { decideBackfill } from '../lib/race.js'

const OK_CODES = ['EMPTY_DRAFT', 'TOO_LONG', 'UPSTREAM_FAILED', 'PARSE_FAILED', 'CANCELLED', 'BAD_STYLE']

/** Stub dispatch: deterministic scrubbed-marker stand-in for the engine. */
function stubDispatch(output) {
  const jobs = []
  return {
    jobs,
    dispatch: async (job) => {
      jobs.push(job)
      if (typeof output === 'function') return output(job)
      return { ok: true, optimized: output, style: job.style, modelVia: 'session' }
    },
  }
}

test('pipeline: valid draft flows through the dispatch with its session id', async () => {
  const stub = stubDispatch('优化后的提示词')
  const result = await optimize({ draft: '帮我写个东西', style: 'concise', sessionId: 'sess-1', source: 'button' }, stub.dispatch)
  assert.deepEqual(result, { ok: true, optimized: '优化后的提示词', style: 'concise', modelVia: 'session' })
  assert.equal(stub.jobs.length, 1)
  assert.equal(stub.jobs[0].sessionId, 'sess-1')
  assert.equal(stub.jobs[0].draft, '帮我写个东西')
  assert.equal(stub.jobs[0].style, 'concise')
})

test('pipeline: validation errors never reach the dispatch', async () => {
  const stub = stubDispatch('x')
  assert.equal((await optimize({ draft: '   ', style: 'concise', sessionId: 's' }, stub.dispatch)).error, 'EMPTY_DRAFT')
  assert.equal((await optimize({ draft: '', style: 'concise', sessionId: 's' }, stub.dispatch)).error, 'EMPTY_DRAFT')
  assert.equal((await optimize({ draft: 'x'.repeat(DRAFT_MAX_LENGTH + 1), style: 'concise', sessionId: 's' }, stub.dispatch)).error, 'TOO_LONG')
  assert.equal((await optimize({ draft: 'fine', style: 'nope', sessionId: 's' }, stub.dispatch)).error, 'BAD_STYLE')
  // Boundary: exactly at the cap is accepted.
  assert.equal((await optimize({ draft: 'y'.repeat(DRAFT_MAX_LENGTH), style: 'concise', sessionId: 's' }, stub.dispatch)).ok, true)
  assert.equal(stub.jobs.length, 1, 'only the valid call may dispatch')
})

test('pipeline: missing style defaults to concise; unknown style is BAD_STYLE', async () => {
  const stub = stubDispatch('out')
  const defaulted = await optimize({ draft: 'hello world prompt', sessionId: 's' }, stub.dispatch)
  assert.equal(defaulted.ok, true)
  assert.equal(defaulted.style, 'concise')
  assert.equal((await optimize({ draft: 'hello world prompt', style: '', sessionId: 's' }, stub.dispatch)).error, 'BAD_STYLE')
})

test('pipeline: null dispatch (engine half unmounted) maps to UPSTREAM_FAILED', async () => {
  assert.deepEqual(
    await optimize({ draft: 'hello world prompt', sessionId: 's' }, null),
    { ok: false, error: 'UPSTREAM_FAILED' },
  )
})

test('parseOptimizeBody: non-object and non-string drafts are EMPTY_DRAFT, never thrown', () => {
  for (const payload of [null, 42, 'str', [], {}, { draft: 7 }, { draft: null }]) {
    const parsed = parseOptimizeBody(payload, 's')
    assert.equal(parsed.ok, false)
    assert.equal(parsed.error, 'EMPTY_DRAFT')
  }
  // source passes through only in its frozen form.
  assert.deepEqual(parseOptimizeBody({ draft: 'd', style: 'structured', source: 'button' }, 's1').body, { draft: 'd', style: 'structured', sessionId: 's1', source: 'button' })
  assert.ok(!('source' in parseOptimizeBody({ draft: 'd', style: 'structured' }, 's').body))
  assert.ok(!('source' in parseOptimizeBody({ draft: 'd', style: 'structured', source: 'other' }, 's').body))
})

test('parseSessionId: non-empty strings only', () => {
  assert.equal(parseSessionId({ sessionId: 'abc' }), 'abc')
  assert.equal(parseSessionId({}), null)
  assert.equal(parseSessionId({ sessionId: '' }), null)
  assert.equal(parseSessionId({ sessionId: 42 }), null)
})

test('error-code roster covers the frozen contract exactly', () => {
  assert.deepEqual([...SUPPORTED_STYLES].sort(), ['concise', 'structured'])
  assert.equal(typeof OK_CODES.length, 'number')
})

test('race decision (R6): changed rev + changed draft → race; same text → apply', () => {
  assert.deepEqual(decideBackfill({ rev0: 1, revNow: 1, draftNow: 'a', original: 'a' }), { kind: 'apply' })
  assert.deepEqual(decideBackfill({ rev0: 1, revNow: 2, draftNow: 'a', original: 'a' }), { kind: 'apply' }, 'rev bump without text change (programmatic write) stays apply')
  assert.deepEqual(decideBackfill({ rev0: 1, revNow: 1, draftNow: 'b', original: 'a' }), { kind: 'apply' }, 'cannot happen (rev is monotonic) but is safe')
  assert.deepEqual(decideBackfill({ rev0: 1, revNow: 2, draftNow: 'edited', original: 'a' }), { kind: 'race' })
})

function jsonRequest(body, path = OPTIMIZE_ROUTE) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('RPC handler: success answers 200 with the {ok:true,...} envelope', async () => {
  // M3: the RPC consumes the ROUTER registry (setActiveDispatch), not the
  // engine slot — the engine registry alone must NOT feed the route.
  const restore = setActiveDispatch(stubDispatch('polished text').dispatch)
  try {
    const response = await handleOptimizeRequest(jsonRequest({ draft: 'raw prompt here', style: 'concise', sessionId: 'sess-9' }))
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true, optimized: 'polished text', style: 'concise', modelVia: 'session' })
  } finally {
    restore()
  }
})

test('RPC handler: engine-slot-only publication does NOT feed the route (M3 router semantics)', async () => {
  const restore = setEngineDispatch(stubDispatch('should not surface').dispatch)
  try {
    const response = await handleOptimizeRequest(jsonRequest({ draft: 'raw prompt here', sessionId: 's' }))
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: false, error: 'UPSTREAM_FAILED' })
  } finally {
    restore()
  }
})

test('RPC handler: business rejections answer 200 with {ok:false,error:code}', async () => {
  const restore = setActiveDispatch(stubDispatch('x').dispatch)
  try {
    for (const [payload, code] of [
      [{ draft: '', style: 'concise', sessionId: 's' }, 'EMPTY_DRAFT'],
      [{ draft: 'x'.repeat(DRAFT_MAX_LENGTH + 1), sessionId: 's' }, 'TOO_LONG'],
      [{ draft: 'fine draft', style: 'weird', sessionId: 's' }, 'BAD_STYLE'],
    ]) {
      const response = await handleOptimizeRequest(jsonRequest(payload))
      assert.equal(response.status, 200, `${code} must stay business-level`)
      assert.deepEqual(await response.json(), { ok: false, error: code })
    }
  } finally {
    restore()
  }
})

test('RPC handler: unmounted engine half answers 200 UPSTREAM_FAILED, 400 only for transport', async () => {
  // No dispatch published.
  const response = await handleOptimizeRequest(jsonRequest({ draft: 'raw prompt here', sessionId: 's' }))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: false, error: 'UPSTREAM_FAILED' })

  // Missing sessionId is a transport-level rejection.
  const noSession = await handleOptimizeRequest(jsonRequest({ draft: 'raw prompt here' }))
  assert.equal(noSession.status, 400)
  assert.deepEqual(await noSession.json(), { error: 'sessionId must be a non-empty string' })
})

test('RPC handler: malformed / non-object bodies answer 400 {error}', async () => {
  const malformed = new Request('http://localhost/optimize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: 'not json{',
  })
  const malformedResponse = await handleOptimizeRequest(malformed)
  assert.equal(malformedResponse.status, 400)
  assert.deepEqual(await malformedResponse.json(), { error: 'request body must be JSON' })

  const scalarResponse = await handleOptimizeRequest(jsonRequest(42))
  assert.equal(scalarResponse.status, 400)
  assert.deepEqual(await scalarResponse.json(), { error: 'request body must be an object' })
})

test('route registration wires optimize+debug+test-api routes onto connection.fetch with POST+buffered', () => {
  const registered = []
  const effects = []
  const ctx = {
    connection: {
      fetch: {
        register(registration) {
          registered.push(registration)
          return () => {}
        },
      },
    },
    effect(fn, label) {
      fn()
      effects.push(label)
    },
  }
  registerWebRoutes(ctx)
  assert.equal(registered.length, 3, 'optimize + debug + test-api routes')
  const [optimize, debug, testApi] = registered
  assert.equal(optimize.path, '/api/prompt-polisher/optimize')
  assert.deepEqual(optimize.methods, ['POST'])
  assert.equal(optimize.requestBody, 'buffered')
  assert.equal(typeof optimize.fetch, 'function')
  assert.equal(debug.path, '/api/prompt-polisher/debug')
  assert.deepEqual(debug.methods, ['POST'])
  assert.equal(typeof debug.fetch, 'function')
  assert.equal(testApi.path, '/api/prompt-polisher/test-api')
  assert.deepEqual(testApi.methods, ['POST'])
  assert.equal(typeof testApi.fetch, 'function')
  assert.deepEqual(effects, ['dsh-prompt-polisher: web routes'])
})

test('engine dispatch registry: publish/unpublish round-trip', () => {
  assert.equal(getEngineDispatch(), null)
  const dispatch = async () => ({ ok: false, error: 'CANCELLED' })
  const restore = setEngineDispatch(dispatch)
  assert.equal(getEngineDispatch(), dispatch)
  restore()
  assert.equal(getEngineDispatch(), null, 'dispose unpublishes')
  restore()
  assert.equal(getEngineDispatch(), null, 'double dispose is harmless')
})

test('router dispatch registry: publish/unpublish round-trip (M3)', () => {
  assert.equal(getActiveDispatch(), null)
  const dispatch = async () => ({ ok: false, error: 'CANCELLED' })
  const restore = setActiveDispatch(dispatch)
  assert.equal(getActiveDispatch(), dispatch)
  restore()
  assert.equal(getActiveDispatch(), null)
})

test('test-api handler: mirrors the published tester; absent tester answers a plain retry hint', async () => {
  const calls = []
  const restore = setApiTester(async (signal) => {
    calls.push({ aborted: signal?.aborted === true })
    return { ok: true, latencyMs: 42, model: 'test-model' }
  })
  try {
    const response = await handleTestApiRequest(new Request(`http://localhost${TEST_API_ROUTE}`, { method: 'POST' }))
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true, latencyMs: 42, model: 'test-model' })
    assert.equal(calls.length, 1)

    const failing = setApiTester(async () => ({ ok: false, error: 'no API key: set the key in the plugin settings' }))
    try {
      const failed = await handleTestApiRequest(new Request(`http://localhost${TEST_API_ROUTE}`, { method: 'POST' }))
      assert.equal(failed.status, 200, 'connectivity failures are business-level, never transport')
      assert.deepEqual(await failed.json(), { ok: false, error: 'no API key: set the key in the plugin settings' })
    } finally {
      failing()
    }
  } finally {
    restore()
  }
  // No tester published (root half not applied yet): 200 with guidance.
  const unready = await handleTestApiRequest(new Request(`http://localhost${TEST_API_ROUTE}`, { method: 'POST' }))
  assert.equal(unready.status, 200)
  const unreadyBody = await unready.json()
  assert.equal(unreadyBody.ok, false)
  assert.match(unreadyBody.error, /try again/)
  assert.equal(getApiTester(), null)
})

test('debug route: mirrors client failure reports into the server log', async () => {
  const logs = []
  const originalError = console.error
  console.error = (...args) => logs.push(args.join(' '))
  try {
    const response = await handleDebugRequest(new Request(`http://localhost${DEBUG_ROUTE}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stage: 'render:PolishButton', message: 'boom', stack: 'Error: boom\n  at x' }),
    }))
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true })
    assert.equal(logs.length, 1)
    assert.match(logs[0], /\[dsh-prompt-polisher:client\] render:PolishButton: boom/)
    assert.match(logs[0], /at x/)
  } finally {
    console.error = originalError
  }
  // Malformed body is tolerated (diagnostics never fail loudly).
  const bad = await handleDebugRequest(new Request(`http://localhost${DEBUG_ROUTE}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not json',
  }))
  assert.equal(bad.status, 400)
})

test('debug route: the M4 clientDiagnostics gate drops the log mirror, never the 200', async () => {
  const payload = JSON.stringify({ stage: 'render:PolishButton', message: 'boom', stack: '' })
  const makeRequest = () => new Request(`http://localhost${DEBUG_ROUTE}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: payload,
  })
  const logs = []
  const originalError = console.error
  console.error = (...args) => logs.push(args.join(' '))
  try {
    // Explicitly enabled behaves like the default (log mirrors).
    const on = await handleDebugRequest(makeRequest(), () => true)
    assert.equal(on.status, 200)
    assert.deepEqual(await on.json(), { ok: true })
    assert.equal(logs.length, 1)

    // Disabled: still 200 {ok:true} for the fire-and-forget client, no log.
    const off = await handleDebugRequest(makeRequest(), () => false)
    assert.equal(off.status, 200)
    assert.deepEqual(await off.json(), { ok: true })
    assert.equal(logs.length, 1, 'the disabled gate must not log')

    // The read is per report (volatile discipline): flipping on the fly works.
    let flag = false
    const flip = await handleDebugRequest(makeRequest(), () => flag)
    assert.equal(logs.length, 1)
    flag = true
    const flipped = await handleDebugRequest(makeRequest(), () => flag)
    assert.equal(flipped.status, 200)
    assert.equal(logs.length, 2, 'a live settings flip applies on the next report')
  } finally {
    console.error = originalError
  }
})

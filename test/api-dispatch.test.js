/**
 * Independent-API dispatch tests (M3, plan/04 tier 1): the OpenAI-compatible
 * `/chat/completions` leg driven through a STUBBED fetch — no network, no
 * model API. Covers the frozen mapping (transport → UPSTREAM_FAILED,
 * unusable text → PARSE_FAILED, abort → CANCELLED, all with the additive
 * `modelVia: 'api'` marker except CANCELLED), the key discipline (literal
 * config wins; env fallback through the injected resolver; the key never
 * appears in any response), endpoint normalization, the FR10 template
 * override riding into the request prompt, and the router's per-job
 * dispatch decision.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createApiDispatch, createApiTester, isApiCandidate, completionsEndpoint, mapApiError, AbortError, ParseError, UpstreamError } from '../lib/api-dispatch.js'
import { createRouterDispatch } from '../lib/router.js'
import { renderTemplate } from '../lib/templates.js'

const KEY = 'sk-test-1234567890'

/** A resolved API config; fields overridable per test. */
function apiConfig(overrides = {}) {
  return {
    enabled: true,
    baseURL: 'https://api.example.com',
    apiKey: KEY,
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    model: 'test-model',
    ...overrides,
  }
}

/** Stub fetch returning one canned OpenAI-compatible response. */
function stubFetch(body, { status = 200, capture = [] } = {}) {
  return async (input, init) => {
    capture.push({ url: String(input), init })
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }
}

function completionBody(text) {
  return { choices: [{ message: { role: 'assistant', content: text } }] }
}

function makeDeps({ config = apiConfig(), fetchImpl, resolveApiKey } = {}) {
  return {
    resolveConfig: () => config,
    resolveApiKey: resolveApiKey ?? (async () => undefined),
    ...(fetchImpl !== undefined ? { fetchImpl } : {}),
  }
}

function job(overrides = {}) {
  return { draft: '帮我写个东西', style: 'concise', sessionId: 'sess-1', ...overrides }
}

test('endpoint normalization: bare host, /v1 base, trailing slash, explicit path', () => {
  assert.equal(completionsEndpoint('https://api.example.com'), 'https://api.example.com/chat/completions')
  assert.equal(completionsEndpoint('https://api.example.com/v1'), 'https://api.example.com/v1/chat/completions')
  assert.equal(completionsEndpoint('https://api.example.com/'), 'https://api.example.com/chat/completions')
  assert.equal(completionsEndpoint('https://api.example.com/v1/chat/completions'), 'https://api.example.com/v1/chat/completions')
})

test('isApiCandidate: enabled+key or env reference required; disabled/malformed never route', () => {
  assert.equal(isApiCandidate(apiConfig()), true)
  assert.equal(isApiCandidate(apiConfig({ apiKey: undefined, apiKeyEnv: undefined })), false, 'no key material at all')
  assert.equal(isApiCandidate(apiConfig({ apiKey: '   ', apiKeyEnv: undefined })), false, 'blank literal key with env fallback absent')
  assert.equal(isApiCandidate(apiConfig({ enabled: false })), false, 'disabled section never routes')
  assert.equal(isApiCandidate(apiConfig({ model: '  ' })), false, 'blank model never routes')
  assert.equal(isApiCandidate(apiConfig({ baseURL: 'not a url' })), false, 'unparseable base never routes')
  assert.equal(isApiCandidate(apiConfig({ apiKey: undefined })), true, 'a set env reference is a candidate (resolution happens at call time)')
})

test('happy path: POST carries bearer key, model and user prompt; scrubbed answer answers modelVia api', async () => {
  const capture = []
  const dispatch = createApiDispatch(makeDeps({
    fetchImpl: stubFetch(completionBody('```\n优化后的提示词\n```'), { capture }),
  }))
  const result = await dispatch(job())
  assert.deepEqual(result, { ok: true, optimized: '优化后的提示词', style: 'concise', modelVia: 'api' })
  assert.equal(capture.length, 1)
  assert.equal(capture[0].url, 'https://api.example.com/chat/completions')
  assert.equal(capture[0].init.method, 'POST')
  assert.equal(capture[0].init.headers.authorization, `Bearer ${KEY}`)
  const sent = JSON.parse(capture[0].init.body)
  assert.equal(sent.model, 'test-model')
  assert.equal(sent.stream, false)
  assert.equal(sent.messages.length, 1)
  assert.equal(sent.messages[0].role, 'user')
  assert.ok(sent.messages[0].content.includes('帮我写个东西'), 'the draft rides inside the rendered template')
  assert.ok(!JSON.stringify(result).includes(KEY), 'the key never appears in the response')
})

test('key resolution: literal config wins over env; env resolver used when literal absent; missing key refuses', async () => {
  const capture = []
  const envDeps = makeDeps({
    config: apiConfig({ apiKey: undefined }),
    resolveApiKey: async (name) => name === 'DEEPSEEK_API_KEY' ? 'sk-env-key' : undefined,
    fetchImpl: stubFetch(completionBody('ok'), { capture }),
  })
  assert.deepEqual(await createApiDispatch(envDeps)(job()), { ok: true, optimized: 'ok', style: 'concise', modelVia: 'api' })
  assert.equal(capture[0].init.headers.authorization, 'Bearer sk-env-key')

  const literalAndEnv = makeDeps({
    config: apiConfig(),
    resolveApiKey: async () => 'sk-env-key',
    fetchImpl: stubFetch(completionBody('ok'), { capture }),
  })
  await createApiDispatch(literalAndEnv)(job())
  assert.equal(capture[1].init.headers.authorization, `Bearer ${KEY}`, 'literal key wins')

  const noKey = createApiDispatch(makeDeps({ config: apiConfig({ apiKey: undefined }) }))
  assert.deepEqual(await noKey(job()), { ok: false, error: 'UPSTREAM_FAILED', modelVia: 'api' })
})

test('mapping table: HTTP error → UPSTREAM_FAILED(+modelVia); non-JSON → UPSTREAM_FAILED; empty/no content → PARSE_FAILED', async () => {
  const httpError = createApiDispatch(makeDeps({ fetchImpl: stubFetch({ error: { message: 'bad key' } }, { status: 401 }) }))
  assert.deepEqual(await httpError(job()), { ok: false, error: 'UPSTREAM_FAILED', modelVia: 'api' })

  const nonJson = createApiDispatch(makeDeps({ fetchImpl: stubFetch('<html>oops</html>') }))
  assert.deepEqual(await nonJson(job()), { ok: false, error: 'UPSTREAM_FAILED', modelVia: 'api' })

  const emptyContent = createApiDispatch(makeDeps({ fetchImpl: stubFetch(completionBody('  ')) }))
  assert.deepEqual(await emptyContent(job()), { ok: false, error: 'PARSE_FAILED', modelVia: 'api' })

  const noChoices = createApiDispatch(makeDeps({ fetchImpl: stubFetch({ choices: [] }) }))
  assert.deepEqual(await noChoices(job()), { ok: false, error: 'PARSE_FAILED', modelVia: 'api' })
})

test('abort maps to CANCELLED without the api marker; a transport failure maps to UPSTREAM_FAILED', async () => {
  const signal = AbortSignal.abort(new Error('user cancelled'))
  const abortingFetch = async () => { throw new DOMException('The operation was aborted.', 'AbortError') }
  const dispatch = createApiDispatch(makeDeps({ fetchImpl: abortingFetch }))
  // Pre-aborted signal: the dispatch surfaces CANCELLED (fetch throws; the
  // signal check maps it) — no modelVia hint, the caller stopped it.
  const result = await dispatch(job({ signal }))
  assert.equal(result.ok, false)
  assert.equal(result.error, 'CANCELLED')
  assert.ok(!('modelVia' in result))

  const networkError = createApiDispatch(makeDeps({ fetchImpl: async () => { throw new TypeError('fetch failed') } }))
  assert.deepEqual(await networkError(job()), { ok: false, error: 'UPSTREAM_FAILED', modelVia: 'api' })
})

test('mapApiError: class-based mapping keeps CANCELLED marker-free', () => {
  assert.deepEqual(mapApiError(new AbortError(AbortSignal.abort('x'))), { ok: false, error: 'CANCELLED' })
  assert.deepEqual(mapApiError(new ParseError('no content')), { ok: false, error: 'PARSE_FAILED', modelVia: 'api' })
  assert.deepEqual(mapApiError(new UpstreamError('HTTP 500')), { ok: false, error: 'UPSTREAM_FAILED', modelVia: 'api' })
  assert.deepEqual(mapApiError(new Error('anything')), { ok: false, error: 'UPSTREAM_FAILED', modelVia: 'api' })
})

test('FR10: a valid override replaces the built-in prompt in the request; an invalid one falls back', async () => {
  const capture = []
  const override = 'Custom skeleton:\n{draft}\nEnd.'
  const dispatch = createApiDispatch(makeDeps({
    config: apiConfig(),
    fetchImpl: stubFetch(completionBody('ok'), { capture }),
  }))
  await dispatch(job({ templateOverrides: { concise: override, structured: undefined } }))
  const sent = JSON.parse(capture[0].init.body)
  assert.equal(sent.messages[0].content, 'Custom skeleton:\n帮我写个东西\nEnd.')
  assert.ok(!sent.messages[0].content.includes('提示词优化助手'), 'built-in skeleton fully replaced')

  // Invalid override (missing {draft}) — built-in skeleton used, no crash.
  await dispatch(job({ templateOverrides: { concise: 'no placeholder here' } }))
  const sent2 = JSON.parse(capture[1].init.body)
  assert.ok(sent2.messages[0].content.includes('用户草稿'), 'zh skeleton selected for a CJK draft')

  // Draft containing $& etc. must insert literally (function replacer).
  const tricky = 'draft with $& and $` sequences'
  await dispatch(job({ draft: tricky, style: 'structured', templateOverrides: { structured: 'A {draft} B' } }))
  const sent3 = JSON.parse(capture[2].init.body)
  assert.ok(sent3.messages[0].content.includes(tricky), 'tricky draft inserted verbatim')
})

test('FR8 pin: the two built-in styles render different prompts for the same draft', () => {
  assert.notEqual(renderTemplate('concise', 'write me an email please'), renderTemplate('structured', 'write me an email please'))
  assert.notEqual(renderTemplate('concise', '帮我写个邮件'), renderTemplate('structured', '帮我写个邮件'))
})

test('connectivity tester: ok carries latency+model; unconfigured/guidance messages never carry the key', async () => {
  const tester = createApiTester(makeDeps({ fetchImpl: stubFetch(completionBody('!')) }))
  const ok = await tester()
  assert.equal(ok.ok, true)
  assert.ok(ok.latencyMs >= 0)
  assert.equal(ok.model, 'test-model')

  const disabled = createApiTester(makeDeps({ config: apiConfig({ enabled: false }) }))
  const off = await disabled()
  assert.equal(off.ok, false)
  assert.match(off.error, /not enabled/)

  const noKey = createApiTester(makeDeps({ config: apiConfig({ apiKey: undefined, apiKeyEnv: 'MY_KEY' }) }))
  const missing = await noKey()
  assert.equal(missing.ok, false)
  assert.match(missing.error, /MY_KEY/)
  assert.ok(!JSON.stringify(missing).includes(KEY))

  const httpFail = createApiTester(makeDeps({ fetchImpl: stubFetch({ error: 'auth failed' }, { status: 403 }) }))
  const failed = await httpFail()
  assert.equal(failed.ok, false)
  assert.match(failed.error, /HTTP 403/)
})

test('router: API candidate routes to the api leg; otherwise engine; engine absent → UPSTREAM_FAILED', async () => {
  const seen = []
  const apiDispatch = async (j) => { seen.push(['api', j.style]); return { ok: true, optimized: 'from-api', style: j.style, modelVia: 'api' } }
  const engineDispatch = async (j) => { seen.push(['engine', j.style]); return { ok: true, optimized: 'from-engine', style: j.style, modelVia: 'session' } }

  const apiRouter = createRouterDispatch({
    resolveConfig: () => ({ api: apiConfig(), templates: {} }),
    apiDispatch,
    getEngineDispatch: () => engineDispatch,
  })
  assert.deepEqual(await apiRouter(job()), { ok: true, optimized: 'from-api', style: 'concise', modelVia: 'api' })

  const engineRouter = createRouterDispatch({
    resolveConfig: () => ({ api: apiConfig({ enabled: false }), templates: {} }),
    apiDispatch,
    getEngineDispatch: () => engineDispatch,
  })
  assert.deepEqual(await engineRouter(job()), { ok: true, optimized: 'from-engine', style: 'concise', modelVia: 'session' })

  const deadRouter = createRouterDispatch({
    resolveConfig: () => ({ api: apiConfig({ enabled: false }), templates: {} }),
    apiDispatch,
    getEngineDispatch: () => null,
  })
  assert.deepEqual(await deadRouter(job()), { ok: false, error: 'UPSTREAM_FAILED' })
  assert.equal(seen.length, 2, 'the dead router dispatched nowhere')
})

test('router: FR10 overrides ride on both legs only when some override is set', async () => {
  const seen = []
  const apiDispatch = async (j) => { seen.push(j); return { ok: true, optimized: 'x', style: j.style, modelVia: 'api' } }
  const router = createRouterDispatch({
    resolveConfig: () => ({ api: apiConfig(), templates: { concise: 'O {draft}', structured: undefined } }),
    apiDispatch,
  })
  await router(job())
  assert.deepEqual(seen[0].templateOverrides, { concise: 'O {draft}', structured: undefined })

  const bareRouter = createRouterDispatch({
    resolveConfig: () => ({ api: apiConfig(), templates: { concise: undefined, structured: undefined } }),
    apiDispatch,
  })
  await bareRouter(job())
  assert.ok(!('templateOverrides' in seen[1]), 'no overrides key when every override is unset')
})

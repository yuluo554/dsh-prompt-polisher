/**
 * Client bundle execution smoke (M2, plan/04 test tier 4): the browser half
 * runs in a real browser only, but its lazy-CJS factory is plain JavaScript
 * — execute the BUILT lib/client.js under a `window.__ModuleLoader__` shim
 * with a require map over the frozen platform seed table, then drive
 * `apply()` against stub services and assert BOTH seat registrations
 * (optimize button + composer.dock status bar). The components render
 * through react-dom/server: hooks run, so the render output proves the
 * disabled logic (empty / <8 chars / chips / phase), the spinner state, the
 * R6 race-phase bar, and the injected translate wiring.
 *
 * GUI-level verification (button sits in the tool row, click replaces the
 * draft) stays a manual/online-smoke item — the CDP stack is broken on this
 * machine (environment pit #1), see HANDOFF.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Load the built bundle and capture its ModuleLoader registration. */
function loadClientBundle() {
  const code = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
  let registered
  globalThis.window = {
    __ModuleLoader__: {
      load(record) {
        registered = record
      },
    },
  }
  try {
    // The bundle is strict-mode-safe CJS-in-a-closure; run it as a script.
    new Function('window', code)(globalThis.window)
  } finally {
    delete globalThis.window
  }
  assert.ok(registered, 'bundle never called window.__ModuleLoader__.load')
  assert.equal(registered.id, 'dsh-prompt-polisher')
  assert.equal(typeof registered.factory, 'function')
  return registered
}

/** Node-side require shim over the platform seed table slice the bundle uses. */
function seedRequire() {
  const nodeRequire = createRequire(import.meta.url)
  const react = nodeRequire('react')
  const jsxRuntime = nodeRequire('react/jsx-runtime')
  return (spec) => {
    if (spec === 'react') return react
    if (spec === 'react/jsx-runtime') return jsxRuntime
    throw new Error(`client bundle required "${spec}" at execution time — this test's seed map only covers react`)
  }
}

/** Execute the factory + apply against stub services; return the registrations. */
function wireUp() {
  const bundle = loadClientBundle()
  const exports = bundle.factory(seedRequire())
  assert.equal(exports.name, 'dsh-prompt-polisher')
  assert.deepEqual(exports.inject, ['slots', 'locale', 'configForms'])
  assert.equal(typeof exports.apply, 'function')
  assert.ok(exports.polishStore, 'the store singleton must be exported for the shim')

  const dictionaries = []
  const slotsInjected = []
  const slotsRegistered = []
  const effects = []
  exports.apply({
    locale: {
      register(ns, locale, dict) {
        dictionaries.push({ ns, locale, keys: Object.keys(dict).length })
        return () => {}
      },
      bind(ns) {
        return (key, params) => `pp:${key}${params !== undefined ? `:${JSON.stringify(params)}` : ''}`
      },
    },
    slots: {
      inject(slot, factory) {
        slotsInjected.push(slot)
        factory()
      },
      register(options, component) {
        slotsRegistered.push({ options, component })
        return () => {}
      },
    },
    effect(fn, label) {
      effects.push(label)
      fn()
    },
  })
  return { exports, dictionaries, slotsInjected, slotsRegistered, effects }
}

test('built client bundle wires ALL composer/settings seats over the frozen inject face', () => {
  const { dictionaries, slotsInjected, slotsRegistered, effects } = wireUp()
  assert.deepEqual(slotsInjected.sort(), ['conversation.input.dock', 'conversation.input.right', 'plugins.bundle.config'])
  assert.deepEqual(effects, ['dsh-prompt-polisher: dictionaries'])
  assert.deepEqual(dictionaries.map((item) => item.locale).sort(), ['en', 'zh'])
  for (const item of dictionaries) {
    assert.equal(item.ns, 'dsh-prompt-polisher')
    assert.equal(item.keys, 38, 'M4 dictionary size (button + bar + style labels + menu + api hint + settings panel + config form + diagnostics toggle)')
  }

  const button = slotsRegistered.find((entry) => entry.options.id === 'prompt-polisher')
  assert.ok(button, 'optimize button not registered into conversation.input.right')
  assert.equal(button.options.name, 'conversation.input.right')
  assert.equal(typeof button.component, 'function')
  assert.equal(typeof button.options.inject().t, 'function')

  const bar = slotsRegistered.find((entry) => entry.options.id === 'prompt-polisher-bar')
  assert.ok(bar, 'status bar not registered into conversation.input.dock')
  assert.equal(bar.options.name, 'conversation.input.dock', 'the dock seat renders above the composer card on the hero too')
  assert.equal(typeof bar.component, 'function')
  assert.equal(typeof bar.options.inject().t, 'function')

  const panel = slotsRegistered.find((entry) => entry.options.name === 'plugins.bundle.config')
  assert.ok(panel, 'api connectivity panel not registered into plugins.bundle.config')
  assert.equal(panel.options.key, 'dsh-prompt-polisher', 'keyed by the package name')
  assert.equal(typeof panel.component, 'function')
  assert.equal(typeof panel.options.inject().t, 'function')
})

/** Stub standard-kit props for one render of a session-scope seat component.
 * `t` is injected by the registration closure (translate comes from the
 * plugin's own bind), so the shim only supplies the session kit. */
function renderSeat(component, { draft, phase = 'plain', draftRev = 1, occurrences = [], sessionId = 'sess-x' }) {
  const setDrafts = []
  const state = { draft, phase, draftRev, occurrences }
  const props = {
    // Official consumption pattern: useInput is a SnapshotSelectorHook and
    // the selector argument is REQUIRED.
    useInput: (selector) => selector(state),
    inputActions: {
      setDraft(text) {
        setDrafts.push(text)
      },
    },
    sessionId,
  }
  return { html: renderToStaticMarkup(createElement(component, props)), setDrafts }
}

test('button renders enabled on a plain ≥8-char draft; disabled + tooltip for every guard', () => {
  const { slotsRegistered } = wireUp()
  const { component } = slotsRegistered.find((entry) => entry.options.id === 'prompt-polisher')

  const ready = renderSeat(component, { draft: '帮我优化这段话看看效果' })
  assert.match(ready.html, /<button/)
  assert.ok(!ready.html.includes('disabled'), 'plain ≥8-char draft must leave the button enabled')
  assert.match(ready.html, /aria-label="pp:button\.tooltip"/)
  assert.match(ready.html, /<svg/)

  // FR8 chevron: present next to the main button, menu closed by default.
  assert.match(ready.html, /aria-label="pp:menu\.trigger"/, 'the style-menu trigger rides in the same seat')
  assert.match(ready.html, /aria-expanded="false"/, 'the menu starts closed')
  assert.ok(!ready.html.includes('pp:style.'), 'a closed menu renders no style items')

  // Blank (M1 rule kept).
  const blank = renderSeat(component, { draft: '   ' })
  assert.match(blank.html, /disabled/, 'blank draft must disable the button')
  // <8 trimmed characters (FR5).
  const short = renderSeat(component, { draft: '七个字以内' })
  assert.match(short.html, /disabled/, 'sub-threshold draft must disable the button')
  assert.match(short.html, /pp:button\.tooShort/, 'the short-draft tooltip explains the threshold')
  const seven = renderSeat(component, { draft: '七个字整啊' })
  assert.match(seven.html, /disabled/, '7 chars is below the threshold (8 exclusive)')
  const eight = renderSeat(component, { draft: '正好八个字啊是的' })
  assert.ok(!eight.html.includes('disabled'), 'exactly 8 chars meets the threshold')
  // Chips protection (FR6/R1).
  const chips = renderSeat(component, { draft: '足够长的一段草稿', occurrences: [{ type: 'file', id: 'f1' }] })
  assert.match(chips.html, /disabled/, 'chips-bearing drafts must disable the button')
  assert.match(chips.html, /pp:button\.hasRefs/, 'the chips tooltip explains the protection')
  // Non-plain phase (M1 rule kept).
  const submitting = renderSeat(component, { draft: 'text', phase: 'submitting' })
  assert.match(submitting.html, /disabled/, 'non-plain phase must disable the button')
})

test('bar renders null with no record; "applied" shows 已优化+还原; "race" shows 替换/放弃 (R6)', () => {
  const { exports, slotsRegistered } = wireUp()
  const { component } = slotsRegistered.find((entry) => entry.options.id === 'prompt-polisher-bar')
  const store = exports.polishStore

  const empty = renderSeat(component, { sessionId: 'sess-bar-empty' })
  assert.equal(empty.html, '', 'no record → the bar renders nothing (no space)')

  store.set('sess-bar-applied', { original: '原文', optimized: '优化后', style: 'concise', phase: 'applied' })
  try {
    const applied = renderSeat(component, { sessionId: 'sess-bar-applied' })
    assert.match(applied.html, /pp:bar\.optimized/)
    assert.match(applied.html, /pp:style\.concise/, 'the style label rides in the translate params')
    assert.match(applied.html, /pp:bar\.restore/)
    assert.ok(!applied.html.includes('pp:bar.race'))
  } finally {
    store.clear('sess-bar-applied')
  }

  store.set('sess-bar-race', { original: '原文', optimized: '优化后', style: 'structured', phase: 'race' })
  try {
    const race = renderSeat(component, { sessionId: 'sess-bar-race' })
    assert.match(race.html, /pp:bar\.race/, 'the race phase asks before overwriting')
    assert.match(race.html, /pp:bar\.replace/)
    assert.match(race.html, /pp:bar\.discard/)
  } finally {
    store.clear('sess-bar-race')
  }
})

test('store: set/notify/clear round-trip and per-session isolation', () => {
  const { exports } = wireUp()
  const store = exports.polishStore
  const seen = []
  const unsubscribe = store.subscribe(() => seen.push(store.get('sess-store-1')?.phase ?? null))
  assert.equal(store.get('sess-store-1'), undefined)
  store.set('sess-store-1', { original: 'a', optimized: 'b', style: 'concise', phase: 'applied' })
  store.set('sess-store-1', { original: 'a', optimized: 'b', style: 'concise', phase: 'race' })
  store.set('sess-store-2', { original: 'x', optimized: 'y', style: 'concise', phase: 'applied' })
  assert.equal(seen.length, 3, 'every mutation notifies')
  assert.deepEqual(seen, ['applied', 'race', 'race'], 'notifications carry the observed session phase')
  store.clear('sess-store-1')
  assert.equal(seen.length, 4, 'a successful clear notifies too')
  assert.equal(store.get('sess-store-1'), undefined)
  assert.ok(store.get('sess-store-2'), 'other sessions unaffected')
  unsubscribe()
  store.clear('sess-store-2')
  store.set('sess-store-1', { original: 'a', optimized: 'b', style: 'concise', phase: 'applied' })
  assert.equal(seen.length, 4, 'unsubscribed listeners stop receiving')
  store.clear('sess-store-1')
})

/** Render a root-scope seat component with arbitrary owner props (no session kit). */
function renderRootSeat(component, ownerProps) {
  return renderToStaticMarkup(createElement(component, ownerProps))
}

/** Stub ConfigForm over one fixed snapshot (the panel's configForm accessor contract). */
function stubForm(snapshot, { mutations = [] } = {}) {
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    set: async () => true,
    unset: async () => true,
    mutate: async (ops) => {
      mutations.push(ops)
      return true
    },
  }
}

function readySnapshot(overrides = {}) {
  return {
    status: 'ready',
    value: {
      apiEnabled: false,
      apiBaseURL: 'https://api.deepseek.com',
      apiModel: 'deepseek-chat',
      apiKeyEnv: 'DEEPSEEK_API_KEY',
    },
    base: undefined,
    user: undefined,
    revision: 7,
    writable: true,
    mode: 'host',
    ...overrides,
  }
}

test('api panel: page view renders description + test button; summary view renders nothing', () => {
  const { slotsRegistered } = wireUp()
  const { component } = slotsRegistered.find((entry) => entry.options.name === 'plugins.bundle.config')

  const page = renderRootSeat(component, { view: 'page' })
  assert.match(page, /pp:panel\.title/)
  assert.match(page, /pp:panel\.description/)
  assert.match(page, /pp:test\.button/, 'the connectivity test button is present')
  assert.match(page, /pp:form\.loading/, 'no config form accessor → loading hint, fields hidden')
  assert.ok(!page.includes('pp:form.apiEnabled'), 'no fields without a config form')

  const summary = renderRootSeat(component, { view: 'summary' })
  assert.equal(summary, '', 'the summary view renders nothing (the one-liner belongs to the bundle description)')
})

test('api panel: config form fields render from the snapshot; secret input is password-typed', () => {
  const { slotsRegistered } = wireUp()
  const { component } = slotsRegistered.find((entry) => entry.options.name === 'plugins.bundle.config')

  const page = renderRootSeat(component, {
    view: 'page',
    configForm: () => stubForm(readySnapshot()),
  })
  assert.match(page, /pp:form\.apiEnabled/, 'the enable toggle label renders')
  assert.match(page, /pp:form\.clientDiagnostics/, 'the diagnostics toggle label renders (M4)')
  assert.match(page, /pp:form\.apiBaseURL/)
  assert.match(page, /value="https:\/\/api\.deepseek\.com"/, 'base URL rides from the snapshot')
  assert.match(page, /value="deepseek-chat"/)
  assert.match(page, /type="password"/, 'the API key field is write-only password input')
  assert.match(page, /pp:form\.templateConcise/)
  assert.match(page, /pp:form\.save/)
  assert.match(page, /pp:form\.clearKey/)
  assert.ok(!page.includes('pp:form.loading'), 'a ready snapshot hides the loading hint')
})

test('api panel: readonly snapshot disables save; unavailable snapshot shows the hint', () => {
  const { slotsRegistered } = wireUp()
  const { component } = slotsRegistered.find((entry) => entry.options.name === 'plugins.bundle.config')

  const readonlyPage = renderRootSeat(component, {
    view: 'page',
    configForm: () => stubForm(readySnapshot({ writable: false })),
  })
  assert.match(readonlyPage, /pp:form\.readonly/, 'readonly profiles explain themselves')
  assert.match(readonlyPage, /disabled/, 'controls disabled when the profile is read-only')

  const unavailable = renderRootSeat(component, {
    view: 'page',
    configForm: () => stubForm({ status: 'unavailable', value: undefined, base: undefined, user: undefined, revision: undefined, writable: false, mode: 'memory' }),
  })
  assert.match(unavailable, /pp:form\.unavailable/)
  assert.match(unavailable, /pp:test\.button/, 'the test button survives without a form')
})

test('style preference (FR8): localStorage-backed round-trip with safe fallbacks', () => {
  const { exports } = wireUp()
  assert.equal(exports.DEFAULT_STYLE, 'concise')
  assert.deepEqual([...exports.CLIENT_STYLES].sort(), ['concise', 'structured'])

  // No localStorage at all (Node shim baseline): default, no crash.
  assert.equal(exports.readPreferredStyle(), 'concise')
  exports.writePreferredStyle('structured') // must not throw
  assert.equal(exports.readPreferredStyle(), 'concise', 'writes without storage are lost, not fatal')

  // With a storage stub: round-trip works; unsupported values fall back.
  const backing = new Map()
  globalThis.localStorage = {
    getItem: (k) => (backing.has(k) ? backing.get(k) : null),
    setItem: (k, v) => backing.set(k, String(v)),
    removeItem: (k) => backing.delete(k),
  }
  try {
    exports.writePreferredStyle('structured')
    assert.equal(backing.get(exports.STYLE_PREF_KEY), 'structured')
    assert.equal(exports.readPreferredStyle(), 'structured')
    backing.set(exports.STYLE_PREF_KEY, 'bogus-style')
    assert.equal(exports.readPreferredStyle(), 'concise', 'an unsupported stored value falls back to the default')
  } finally {
    delete globalThis.localStorage
  }
})

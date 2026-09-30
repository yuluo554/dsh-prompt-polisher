/**
 * FR11 locale integrity (M4, plan/05 §M4 / plan/06 对标表): the zh/en
 * dictionaries in client/i18n.ts are checked complete against each other,
 * placeholder sets stay paired, and every translate key the client sources
 * reference exists in BOTH languages. Source-level by design — the client
 * ships as one esbuild bundle (lib/client.js), so the .ts sources are the
 * reviewable truth for which keys exist and which are used.
 *
 * Wording conventions follow the official common namespace
 * (@deepseek-ai/dsh-client-locale lib/types/locales): progressive states are
 * 正在…/`-ing…`, failures are XX失败/`X failed`, UI paths quote with 「」.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLIENT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'client')

/** Pull the zh/en object literals out of client/i18n.ts source text. */
function parseDictionaries() {
  const source = readFileSync(join(CLIENT_DIR, 'i18n.ts'), 'utf8')
  const dicts = {}
  for (const name of ['zh', 'en']) {
    const start = source.indexOf(`export const ${name}: Record<string, string> = {`)
    assert.notEqual(start, -1, `i18n.ts: ${name} dictionary not found`)
    const open = source.indexOf('{', start)
    const close = source.indexOf('\n}', open)
    assert.notEqual(close, -1, `i18n.ts: ${name} dictionary not closed`)
    const body = source.slice(open + 1, close)
    const entries = {}
    const lineRe = /^[ \t]*'((?:[^'\\]|\\.)+)':[ \t]*'((?:[^'\\]|\\.)*)',[ \t]*$/gm
    let matched = 0
    for (const match of body.matchAll(lineRe)) {
      entries[match[1].replaceAll("\\'", "'")] = match[2].replaceAll("\\'", "'")
      matched += 1
    }
    assert.equal(matched, [...body.matchAll(/^[ \t]*[^\s]/gm)].length, `i18n.ts: ${name} has unparsed lines`)
    dicts[name] = entries
  }
  return dicts
}

/** Every .ts/.tsx file under client/ as { path, text }. */
function clientSources() {
  const out = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.(tsx?|)$/.test(name) && name !== 'i18n.ts') out.push({ path, text: readFileSync(path, 'utf8') })
    }
  }
  walk(CLIENT_DIR)
  return out
}

const dicts = parseDictionaries()
const zhKeys = Object.keys(dicts.zh)
const enKeys = Object.keys(dicts.en)

test('FR11: zh and en dictionaries cover the same key set, no empty values', () => {
  assert.ok(zhKeys.length >= 20, 'the M4 dictionary holds the full M2+M3 key set')
  assert.deepEqual([...enKeys].sort(), [...zhKeys].sort(), 'key sets must match exactly')
  for (const [locale, entries] of Object.entries(dicts)) {
    for (const [key, value] of Object.entries(entries)) {
      assert.ok(value.trim().length > 0, `${locale}.${key}: empty value`)
    }
  }
})

test('FR11: interpolation placeholder sets are paired across zh/en', () => {
  const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
  for (const key of zhKeys) {
    assert.deepEqual(placeholders(dicts.en[key]), placeholders(dicts.zh[key]), `${key}: placeholder mismatch`)
  }
})

test('FR11: every t("...") key referenced by client sources exists in both dictionaries', () => {
  const sources = clientSources()
  assert.ok(sources.length >= 5, 'the client sources are present')
  const missing = []
  for (const { path, text } of sources) {
    for (const match of text.matchAll(/\bt\(\s*'([^']+)'/g)) {
      const key = match[1]
      if (!(key in dicts.zh) || !(key in dicts.en)) missing.push(`${path}: ${key}`)
    }
    // Dynamic keys: the style menu builds `style.${candidate}` from
    // CLIENT_STYLES — pin those prefixes explicitly.
    for (const match of text.matchAll(/\bt\(\s*`([^`$]+)\$\{/g)) {
      const prefix = match[1]
      const covered = Object.keys(dicts.zh).some((key) => key.startsWith(prefix))
      if (!covered) missing.push(`${path}: ${prefix}*(dynamic)`)
    }
  }
  assert.deepEqual(missing, [], 'translate keys must resolve in both dictionaries')
})

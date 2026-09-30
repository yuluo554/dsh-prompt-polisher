/**
 * Pipeline bench (M4 final form, plan/04 基准脚本 / plan/05 §M4): the frozen
 * 20-case roster in data/fixtures/manifest.json runs through the REAL
 * optimize pipeline — 校验 → 渲染 → 桩模型 → 清洗 — with the model swapped
 * for a scripted stand-in and the real mapEngineResult tail (bench and
 * production share the scrub/mapping home, so they cannot drift).
 *
 * Three gates per case: (1) the manifest's readable expect (ok / error code),
 * (2) the byte-frozen golden snapshot in data/golden/ (exact response bytes),
 * (3) the draft-rides-as-data pin on the rendered prompt. A timing summary
 * (stdout) is the published bench report.
 *
 * The EOL gate test enforces plan/04's frozen-byte discipline: every file
 * under data/ must be CR-free — Windows autocrlf checkout would corrupt the
 * byte-freeze (dsh-plugin-dev §10; .gitattributes holds the LF norm, this
 * test is the loud tripwire).
 *
 * Golden regeneration: node scripts/update-golden.mjs — only after a
 * recorded contract change (既定口径), never to make a failing test pass.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderTemplate } from '../lib/templates.js'
import {
  loadManifest,
  runCase,
  readGolden,
  goldenBytes,
  walkFiles,
  DATA_DIR,
  FIXTURES_DIR,
} from '../scripts/bench-runner.mjs'

const manifest = loadManifest()

test(`pipeline bench: ${manifest.cases.length} frozen cases, golden byte-equal, all offline`, async () => {
  assert.equal(manifest.cases.length, 20, 'the frozen roster holds exactly 20 cases (plan/04)')
  const rows = []
  for (const entry of manifest.cases) {
    const started = performance.now()
    const { draft, rendered, result } = await runCase(entry)
    const ms = performance.now() - started

    // Gate 1: the readable expectation (crisp message on contract drift).
    assert.equal(result.ok, entry.expect.ok, `${entry.id}: ok arm`)
    if (entry.expect.error !== undefined) assert.equal(result.error, entry.expect.error, `${entry.id}: error code`)
    if (entry.expect.style !== undefined) assert.equal(result.style, entry.expect.style, `${entry.id}: style`)

    // Gate 2: byte-frozen golden — the whole response, exact bytes.
    const golden = readGolden(entry.id)
    assert.notEqual(golden, null, `${entry.id}: golden snapshot missing (run scripts/update-golden.mjs)`)
    assert.ok(golden.equals(goldenBytes(result)), `${entry.id}: response differs from the frozen golden`)

    // Gate 3: the draft reaches the (fake) model as DATA in the rendered
    // prompt — the bench-level R5 proxy; the FR10 case additionally pins the
    // override skeleton replacing the built-in template.
    if (rendered !== null) {
      assert.ok(rendered.includes(draft), `${entry.id}: draft must ride in the rendered prompt as data`)
      if (entry.templateOverride !== undefined) {
        const skeleton = entry.templateOverride.slice(0, entry.templateOverride.indexOf('{draft}'))
        assert.ok(rendered.startsWith(skeleton), `${entry.id}: override template must replace the built-in skeleton`)
      }
    }
    rows.push({ case: entry.id, ms: Number(ms.toFixed(3)) })
  }
  console.log(`[bench] pipeline: ${rows.length} cases, all gates green`)
  for (const row of rows) console.log(`  ${row.ms.toFixed(3)}ms  ${row.case}`)
})

test('bench fixtures integrity: unique ids, referenced files exist, roster matches the seeder', () => {
  const ids = manifest.cases.map((entry) => entry.id)
  assert.equal(new Set(ids).size, ids.length, 'case ids are unique')
  assert.deepEqual([...ids].sort(), [...ids], 'ids arrive in roster order')
  for (const entry of manifest.cases) {
    if (typeof entry.draft === 'string') {
      assert.doesNotThrow(() => readFileSync(join(FIXTURES_DIR, entry.draft), 'utf8'), `${entry.id}: draft file`)
    }
    if (entry.model?.file !== undefined) {
      assert.doesNotThrow(() => readFileSync(join(FIXTURES_DIR, entry.model.file), 'utf8'), `${entry.id}: model fixture`)
    }
    if (entry.templateOverride !== undefined) {
      assert.ok(entry.templateOverride.includes('{draft}'), `${entry.id}: override carries the {draft} token`)
    }
  }
  const goldens = walkFiles(join(DATA_DIR, 'golden')).map((path) => path.replaceAll('\\', '/').split('/').pop())
  assert.equal(goldens.length, manifest.cases.length, 'one golden per case, no strays')
  for (const entry of manifest.cases) {
    assert.ok(goldens.includes(`${entry.id}.json`), `${entry.id}: golden present`)
  }
})

test('EOL gate: every frozen byte under data/ is CR-free (autocrlf tripwire)', () => {
  const offenders = []
  for (const path of walkFiles(DATA_DIR)) {
    if (readFileSync(path).includes(0x0d)) offenders.push(path)
  }
  assert.deepEqual(offenders, [], 'CR found in frozen fixtures — the byte-freeze is corrupted (check .gitattributes / checkout EOL)')
})

test('bench fixtures: template rendering is deterministic for the same input', () => {
  const draft = '性能回归检查：同输入同输出'
  assert.equal(renderTemplate('concise', draft), renderTemplate('concise', draft))
})

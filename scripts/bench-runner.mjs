/**
 * Bench runner (M4, plan/04): executes the frozen 20-case roster through the
 * real optimize pipeline — 校验 → 渲染 → 桩模型 → 清洗 — with the model
 * replaced by a scripted stand-in and the REAL mapEngineResult tail (the
 * single scrub/mapping home; M2 决策: bench and production share it, so the
 * bench can never drift from the implementation).
 *
 * Lives in scripts/ (not test/) so `node --test` file discovery never picks
 * it up as a test file; both test/bench.test.js and scripts/update-golden.mjs
 * import it. Zero API dependency — offline by construction.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { optimize } from '../lib/optimize.js'
import { renderTemplate } from '../lib/templates.js'
import { mapEngineResult } from '../lib/dispatch.js'
import { OUTPUT_MAX_LENGTH } from '../lib/limits.js'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const DATA_DIR = join(ROOT, 'data')
export const FIXTURES_DIR = join(DATA_DIR, 'fixtures')
export const GOLDEN_DIR = join(DATA_DIR, 'golden')

/** Load and sanity-shape the frozen roster (throws on a broken manifest). */
export function loadManifest() {
  const manifest = JSON.parse(readFileSync(join(FIXTURES_DIR, 'manifest.json'), 'utf8'))
  if (!Array.isArray(manifest.cases) || manifest.cases.length === 0) {
    throw new Error('manifest.json: cases[] missing')
  }
  const ids = new Set()
  for (const entry of manifest.cases) {
    if (ids.has(entry.id)) throw new Error(`manifest.json: duplicate case id ${entry.id}`)
    ids.add(entry.id)
  }
  return manifest
}

/** Draft text for one case: fixture file content, or the computed repeat. */
function draftText(entry) {
  if (typeof entry.draft === 'string') return readFileSync(join(FIXTURES_DIR, entry.draft), 'utf8')
  return entry.draft.repeat.text.repeat(entry.draft.repeat.times)
}

/**
 * The scripted model stand-in: mirrors createEngineDispatch's shape (render
 * → model → mapEngineResult) with only the ENGINE swapped for the canned
 * table — so the bench exercises the same renderTemplate call site and the
 * same scrub/mapping tail the real engine dispatch uses.
 *
 * Returns { result, rendered } — rendered is the full prompt the (fake)
 * model saw, surfaced so tests can pin the draft-rides-as-data contract and
 * the FR10 override skeleton.
 */
function scriptedDispatchFor(entry) {
  return async (job) => {
    const rendered = renderTemplate(job.style, job.draft, job.templateOverrides)
    const model = entry.model
    if (model === undefined || entry.noDispatch) {
      throw new Error(`case ${entry.id}: must not reach the model`)
    }
    if (model.stopReason !== undefined) {
      return { rendered, result: mapEngineResult(job.style, { value: null, stopReason: model.stopReason }) }
    }
    if (model.valueNull) {
      return { rendered, result: mapEngineResult(job.style, { value: null, stopReason: 'completed' }) }
    }
    let raw
    if (model.file !== undefined) raw = readFileSync(join(FIXTURES_DIR, model.file), 'utf8')
    else if (model.raw !== undefined) raw = model.raw
    else if (model.repeat !== undefined) raw = model.repeat.text.repeat(OUTPUT_MAX_LENGTH + model.repeat.lengthExtra)
    else throw new Error(`case ${entry.id}: model fixture shape unknown`)
    return { rendered, result: mapEngineResult(job.style, { value: raw, stopReason: 'completed' }) }
  }
}

/**
 * Run one case end to end. `payload` mirrors the RPC body; style=null means
 * the payload OMITS style (the default-style contract). The FR10 override
 * case dispatches router-shaped (the router attaches the overrides snapshot
 * to the job — src/router.ts) because optimize() takes the parsed body only.
 */
export async function runCase(entry) {
  const draft = draftText(entry)
  if (entry.templateOverride !== undefined) {
    const dispatch = scriptedDispatchFor(entry)
    const { rendered, result } = await dispatch({
      draft,
      style: entry.style,
      sessionId: 'bench-golden',
      templateOverrides: { [entry.style]: entry.templateOverride },
    })
    return { draft, rendered, result }
  }
  const payload = { draft, sessionId: 'bench-golden' }
  if (entry.style !== null && entry.style !== undefined) payload.style = entry.style
  const dispatched = await optimize(payload, scriptedDispatchFor(entry))
  // Validation rejections (EMPTY_DRAFT / BAD_STYLE / TOO_LONG) never reach
  // the dispatch: optimize returns the response body directly.
  if (dispatched !== null && typeof dispatched === 'object' && 'rendered' in dispatched) {
    return { draft, rendered: dispatched.rendered, result: dispatched.result }
  }
  return { draft, rendered: null, result: dispatched }
}

/** The golden snapshot bytes for one case (null = not written yet). */
export function readGolden(id) {
  try {
    return readFileSync(join(GOLDEN_DIR, `${id}.json`))
  } catch {
    return null
  }
}

/** Canonical golden bytes for a result object (LF, 2-space JSON, trailing newline). */
export function goldenBytes(result) {
  return Buffer.from(JSON.stringify(result, null, 2) + '\n', 'utf8')
}

/** Every file under dir (recursive), as absolute paths. */
export function walkFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...walkFiles(path))
    else out.push(path)
  }
  return out
}

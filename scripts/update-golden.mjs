/**
 * Golden regenerator (M4, plan/04 快照基建): re-runs the frozen bench roster
 * through the real pipeline and rewrites data/golden/*.json byte-exactly.
 *
 * 纪律 (既定口径): goldens are FROZEN — only regenerate after a recorded
 * contract change (response shape / scrubber semantics / template output),
 * and record the regeneration in the HANDOFF + plan/06. Never edit a golden
 * by hand; a diff that isn't explained by a deliberate contract change is a
 * regression.
 *
 * Run: node scripts/update-golden.mjs   (requires pnpm build first)
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadManifest, runCase, GOLDEN_DIR, goldenBytes } from './bench-runner.mjs'

mkdirSync(GOLDEN_DIR, { recursive: true })

const manifest = loadManifest()
for (const entry of manifest.cases) {
  const { result } = await runCase(entry)
  writeFileSync(join(GOLDEN_DIR, `${entry.id}.json`), goldenBytes(result))
  console.log(`[update-golden] ${entry.id}: ${result.ok ? 'ok' : result.error}`)
}
console.log(`[update-golden] ${manifest.cases.length} golden snapshots written to data/golden/`)

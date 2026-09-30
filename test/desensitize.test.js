/**
 * Desensitization gate (M4, plan/06 发布门 / ai-tool-project-sprint 阶段 7):
 * the four-step audit runs as part of the offline suite, so a secret or
 * personal-data leak cannot land without the suite going red. The script
 * itself (scripts/desensitize-audit.mjs) exits non-zero on any finding and
 * prints DESSENSITIZE_AUDIT_OK only when steps 1-3 are clean.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('desensitize audit: working tree is clean (steps 1-3) and the script passes', () => {
  let stdout
  try {
    stdout = execFileSync(process.execPath, ['scripts/desensitize-audit.mjs'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    assert.fail(`desensitize audit FAILED:\n${error.stdout ?? ''}${error.stderr ?? ''}`)
  }
  assert.match(stdout, /DESENSITIZE_AUDIT_OK/, 'the audit must reach its OK marker')
  assert.ok(!/allowlisted/.test(stdout), 'the allowlist is empty — a tolerated hit means an entry needs re-review')
})

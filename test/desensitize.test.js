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

/**
 * T4 (2026-10-22): the personal-path regex was widened to catch
 * `<drive>:\ProgramData\...`, which the original rule missed entirely
 * (14 occurrences sat in the published repo while the audit printed OK).
 * This test pins the *widening itself*: the audit script must go red on the
 * new shapes and stay green on placeholders / system dirs / other people's
 * build machines. Without it, a later "simplification" of the regex would
 * silently restore the blind spot.
 */
test('desensitize audit: widened personal-path rule fires, and does not misfire', () => {
  let stdout
  try {
    stdout = execFileSync(process.execPath, ['scripts/desensitize-audit-selftest.mjs'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    assert.fail(`desensitize negative controls FAILED:\n${error.stdout ?? ''}${error.stderr ?? ''}`)
  }
  assert.match(stdout, /负控 13 项全部符合预期/, 'all 13 positive/negative controls must hold')
})

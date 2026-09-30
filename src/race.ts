/**
 * R6 race decision (M2, plan/03 §3.3 竞态语义): the user may keep typing
 * while an optimization is in flight. The backfill decision compares the
 * draft revision captured at click time (`rev0`) against the live composer
 * state at response time — a changed revision PLUS a changed draft means
 * the user edited behind the request, and we surface [替换]/[放弃] in the
 * status bar instead of silently overwriting their keystrokes.
 *
 * Pure function shared by the browser button and unit tests; lives on the
 * host side of the tree so both tsconfig projects compile it.
 */

export interface BackfillInput {
  /** draftRev captured when the optimize request was issued. */
  rev0: number
  /** draftRev observed at response time. */
  revNow: number
  /** draft text observed at response time. */
  draftNow: string
  /** draft text the request was launched from. */
  original: string
}

export type BackfillDecision = { kind: 'apply' } | { kind: 'race' }

export function decideBackfill(input: BackfillInput): BackfillDecision {
  if (input.revNow !== input.rev0 && input.draftNow !== input.original) return { kind: 'race' }
  return { kind: 'apply' }
}

/**
 * Frozen length caps (plan/06 既定口径): one module so the scrubber can
 * share the draft cap without importing optimize.ts (which would close the
 * optimize → dispatch → scrub → optimize import cycle).
 */

/** Hard cap on accepted drafts (plan/03 §3.2: 上限如 8000 字符). */
export const DRAFT_MAX_LENGTH = 8000

/** Hard cap on scrubbed model output — the rewrite never outgrows the input cap. */
export const OUTPUT_MAX_LENGTH = DRAFT_MAX_LENGTH

/**
 * Output scrubber (M2, R4 — plan/02 输出清洗 / plan/03 §3.2): the model's
 * raw answer must never reach the composer unverified. Strip markdown code
 * fences and paired wrapping quotes, cap the length, and reject empty
 * output — a PARSE_FAILED answer is returned to the browser and NOTHING is
 * backfilled (绝不回填).
 */
import { OUTPUT_MAX_LENGTH } from './limits.js'

export { OUTPUT_MAX_LENGTH }

/** Paired wrapping quotes worth stripping (both ends must match). */
const QUOTE_PAIRS: ReadonlyArray<[string, string]> = [
  ['"', '"'],
  ["'", "'"],
  ['\u201c', '\u201d'], // “ ”
  ['\u2018', '\u2019'], // ‘ ’
  ['\u300c', '\u300d'], // 「 」
  ['\u300e', '\u300f'], // 『 』
]

/** One fenced block occupying the whole (trimmed) text. */
const FENCE_RE = /^```[^\n]*\n([\s\S]*?)\n?```$/

function stripFences(text: string): string {
  const match = FENCE_RE.exec(text.trim())
  return match === null ? text.trim() : match[1].trim()
}

function stripPairedQuotes(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length < 2) return trimmed
  const pair = QUOTE_PAIRS.find(([open, close]) => trimmed.startsWith(open) && trimmed.endsWith(close))
  return pair === undefined ? trimmed : trimmed.slice(1, -1).trim()
}

/**
 * Clean one model answer. Resolves `{ ok: true, text }` with the composer
 * safe text, or `{ ok: false }` (map to PARSE_FAILED — never backfill).
 * Wrappings alternate (fence-in-quotes-in-fence), so the two strippers run
 * to a fixpoint within a small bounded number of passes; a code fence that
 * is NOT the whole text stays untouched (legitimate code inside a rewrite).
 */
export function scrubModelOutput(raw: string): { ok: true; text: string } | { ok: false } {
  if (typeof raw !== 'string') return { ok: false }
  let text = raw.trim()
  for (let i = 0; i < 6; i += 1) {
    const stripped = stripPairedQuotes(stripFences(text))
    if (stripped === text) break
    text = stripped
  }
  if (text.length === 0) return { ok: false }
  if (text.length > OUTPUT_MAX_LENGTH) text = text.slice(0, OUTPUT_MAX_LENGTH)
  return { ok: true, text }
}

/**
 * Style preference (M3, FR8): the last style the user picked is remembered
 * in localStorage and becomes the default the plain button click dispatches
 * with. Pure helpers with guarded storage access — the Node shim tests run
 * without localStorage, and a private-mode browser must never crash the
 * composer seat over a preference.
 */
export const DEFAULT_STYLE = 'concise'

/** The styles the client menu offers (mirrors the host's SUPPORTED_STYLES). */
export const CLIENT_STYLES = ['concise', 'structured'] as const

export type ClientStyle = (typeof CLIENT_STYLES)[number]

/** localStorage key (plugin-scoped, no collision surface). */
export const STYLE_PREF_KEY = 'dsh-prompt-polisher.style'

export function isSupportedStyle(value: unknown): value is ClientStyle {
  return typeof value === 'string' && (CLIENT_STYLES as readonly string[]).includes(value)
}

/** Read the remembered style; anything absent/unsupported falls back to the default. */
export function readPreferredStyle(): ClientStyle {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_STYLE
    const stored = localStorage.getItem(STYLE_PREF_KEY)
    return isSupportedStyle(stored) ? stored : DEFAULT_STYLE
  } catch {
    return DEFAULT_STYLE
  }
}

/** Persist the style; storage failures are swallowed (preference is best-effort). */
export function writePreferredStyle(style: ClientStyle): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(STYLE_PREF_KEY, style)
  } catch {
    // Private mode / quota — the in-memory default still works this session.
  }
}

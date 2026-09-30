/**
 * The optimize button (M2/M3, plan/03 §3.3 component one): a compact icon
 * control in the composer tool row's right seat (`conversation.input.right`).
 * Session scope hands it the standard props — `useInput` reads the live
 * draft, `inputActions.setDraft` writes the optimized text back.
 *
 * M2 state machine (FR3/FR5/FR6): idle → optimizing (spinner, disabled) →
 * done (brief highlight) / error (red + tooltip carries the frozen code).
 * Disabled when the trimmed draft is under 8 characters (FR5) or carries
 * reference chips (`occurrences.length > 0`, R1 — setDraft would destroy
 * them) or the composer is not in the plain phase.
 *
 * M3 (FR8): a chevron beside the button opens the style menu — the two
 * presets with their localized names, checkmark on the remembered default.
 * Picking a style records it in localStorage (next plain clicks reuse it)
 * and, when the button is currently usable, immediately starts a polish
 * with that style. Menu picks never bypass the disable guards: with the
 * button disabled they only record the preference.
 *
 * M3 (FR9): an API-leg failure carries the additive `modelVia: 'api'`
 * marker; the tooltip appends the fall-back-to-session-model hint.
 *
 * R6 race guard: click captures draftRev0; at response time the decision is
 * re-run against the LIVE composer state (via ref) — user edits behind the
 * request land in the status bar as [替换]/[放弃], never a silent overwrite.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { InputActions, InputState } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { DshTranslate as Translate } from './ambient.js'
import { optimizeDraft } from './api.js'
import { decideBackfill } from '../src/race.js'
import { polishStore } from './store.js'
import { CLIENT_STYLES, readPreferredStyle, writePreferredStyle } from './style-pref.js'
import type { ClientStyle } from './style-pref.js'

interface PolishButtonProps {
  /** Standard session prop: selector hook over the live InputState — the
   * selector argument is required (SnapshotSelectorHook). */
  useInput: (selector: (snapshot: InputState) => InputState) => InputState
  /** Standard session prop: stable public input actions. */
  inputActions: InputActions
  /** Standard session prop: the current session's id. */
  sessionId: string
  /** Plugin translate, mounted through the register inject face. */
  t: Translate
}

/** FR5 threshold: below this many (trimmed) characters there is nothing to polish. */
const MIN_DRAFT_LENGTH = 8

/** How long the `done` highlight stays before returning to idle. */
const DONE_FLASH_MS = 1200

/**
 * Final icon (M4 定稿, user pick C from plan/icon-candidates.html): pen nib
 * + a single four-point star nestled in the pen's crook — the "polish"
 * motif, deliberately NOT WorkBuddy's single magic wand. The star path keeps
 * its seed-transform (scale 0.9 + shift) exactly as approved in the preview.
 */
function PolishIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* pen body, diagonal, nib at lower left */}
      <path d="M2.6 13.4 L3.7 9.8 L10.2 3.3 A1.55 1.55 0 0 1 12.45 5.55 L5.95 12.05 L2.4 13.25 Z" />
      {/* nib fold line */}
      <path d="M3.7 9.8 L5.95 12.05" />
      {/* single four-point star against the pen edge */}
      <path d="M12.2 7.6 L13.25 10.75 L16 11.8 L13.25 12.85 L12.2 16 L11.15 12.85 L8.4 11.8 L11.15 10.75 Z" fill="currentColor" stroke="none" transform="scale(0.9) translate(1 -1.2)" />
    </svg>
  )
}

/** FR8 chevron: opens the style menu. */
function ChevronIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 3.5 L5 6.5 L8 3.5" />
    </svg>
  )
}

/** FR3 spinner: stroke arc rotating via an injected keyframe. */
function PolishSpinner() {
  return (
    <svg className="pp-spin" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.6" />
      <path d="M8 2 A6 6 0 0 1 14 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

const buttonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 26,
  height: 26,
  padding: 0,
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
}

const chevronStyle: CSSProperties = {
  ...buttonStyle,
  width: 14,
  height: 26,
  borderRadius: 4,
}

const menuStyle: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 4px)',
  right: 0,
  zIndex: 11,
  minWidth: 148,
  padding: 4,
  borderRadius: 8,
  background: 'var(--dsh-bg, #fff)',
  color: 'var(--dsh-fg, inherit)',
  border: '1px solid rgba(128,128,128,0.25)',
  boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
}

const menuItemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: 13,
  padding: '6px 10px',
  borderRadius: 6,
  cursor: 'pointer',
  textAlign: 'left',
  whiteSpace: 'nowrap',
}

const backdropStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 10,
  background: 'transparent',
  border: 'none',
  padding: 0,
  cursor: 'default',
}

type ButtonState =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'done' }
  | { kind: 'error'; message: string }

export function PolishButton({ useInput, inputActions, sessionId, t }: PolishButtonProps) {
  // SnapshotSelectorHook: the selector is REQUIRED (identity projection is
  // the official consumption pattern — useInput() bare throws inside the
  // store's useSyncExternalStoreWithSelector).
  const { draft, draftRev, phase, occurrences } = useInput((snapshot) => snapshot)
  const [state, setState] = useState<ButtonState>({ kind: 'idle' })
  // FR8: remembered default style (localStorage) + menu visibility.
  const [style, setStyle] = useState<ClientStyle>(readPreferredStyle)
  const [menuOpen, setMenuOpen] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const doneTimer = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  // Latest composer state for async callbacks: the closure captures the
  // render-scope snapshot, so response-time reads go through the ref.
  const inputRef = useRef({ draft, draftRev })
  inputRef.current = { draft, draftRev }

  // Session switch unmounts the seat: abort the in-flight request so a late
  // response can never setDraft into the PREVIOUS session's composer.
  useEffect(() => () => {
    abortRef.current?.abort()
    if (doneTimer.current !== null) window.clearTimeout(doneTimer.current)
  }, [])

  const armDoneFlash = useCallback(() => {
    if (doneTimer.current !== null) window.clearTimeout(doneTimer.current)
    doneTimer.current = window.setTimeout(() => setState({ kind: 'idle' }), DONE_FLASH_MS)
  }, [])

  const trimmed = draft.trim()
  const tooShort = trimmed.length < MIN_DRAFT_LENGTH
  const hasRefs = occurrences.length > 0
  const disabled = state.kind === 'working'
    || phase !== 'plain'
    || trimmed.length === 0
    || tooShort
    || hasRefs

  const tooltip = state.kind === 'working'
    ? t('button.working')
    : state.kind === 'error'
      ? `${t('button.failed')}: ${state.message}`
      : tooShort && trimmed.length > 0
        ? t('button.tooShort')
        : hasRefs
          ? t('button.hasRefs')
          : t('button.tooltip')

  /** Launch one optimization with the given style (shared by button + menu). */
  const startPolish = useCallback((styleToUse: ClientStyle) => {
    if (state.kind === 'working') return
    // The render-scope snapshot is the text the user sees at click time;
    // rev0 anchors the R6 race decision.
    const original = inputRef.current.draft
    const rev0 = inputRef.current.draftRev
    const controller = new AbortController()
    abortRef.current = controller
    setState({ kind: 'working' })
    void (async () => {
      try {
        const result = await optimizeDraft(
          { draft: original, style: styleToUse, sessionId, source: 'button' },
          controller.signal,
        )
        if (controller.signal.aborted) return
        if (!result.ok) {
          // FR9: an API-leg failure appends the fall-back-to-session-model
          // hint; CANCELLED carries no marker (the caller aborted).
          const message = result.modelVia === 'api' && result.error !== 'CANCELLED'
            ? `${result.error} — ${t('api.failedHint')}`
            : result.error
          setState({ kind: 'error', message })
          return
        }
        // R6: re-read the LIVE composer state at response time.
        const live = inputRef.current
        const decision = decideBackfill({ rev0, revNow: live.draftRev, draftNow: live.draft, original })
        if (decision.kind === 'race') {
          // User typed behind the request: offer 替换/放弃 in the bar.
          polishStore.set(sessionId, {
            original,
            optimized: result.optimized,
            style: result.style,
            phase: 'race',
          })
          setState({ kind: 'done' })
          armDoneFlash()
          return
        }
        inputActions.setDraft(result.optimized)
        polishStore.set(sessionId, {
          original,
          optimized: result.optimized,
          style: result.style,
          phase: 'applied',
        })
        setState({ kind: 'done' })
        armDoneFlash()
      } catch (err) {
        if (controller.signal.aborted) return
        setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
      } finally {
        if (abortRef.current === controller) abortRef.current = null
      }
    })()
  }, [state, sessionId, inputActions, armDoneFlash, t])

  const onPolish = useCallback(() => startPolish(style), [startPolish, style])

  /**
   * FR8 menu pick: remember the style (localStorage) and — only when the
   * button is currently usable — polish with it right away. A pick never
   * bypasses the disable guards (short draft / chips / phase).
   */
  const onPickStyle = useCallback((picked: ClientStyle) => {
    setMenuOpen(false)
    writePreferredStyle(picked)
    setStyle(picked)
    if (!disabled) startPolish(picked)
  }, [disabled, startPolish])

  return (
    <>
      <style>{'@keyframes pp-spin{to{transform:rotate(360deg)}}.pp-spin{animation:pp-spin .8s linear infinite}'}</style>
      <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
        <button
          type="button"
          title={tooltip}
          aria-label={t('button.tooltip')}
          aria-busy={state.kind === 'working'}
          onClick={onPolish}
          disabled={disabled}
          style={{
            ...buttonStyle,
            opacity: state.kind === 'error' ? 0.95 : disabled ? 0.4 : 1,
            color: state.kind === 'error'
              ? '#e07a6a'
              : state.kind === 'done'
                ? '#5fbf77'
                : 'inherit',
            background: state.kind === 'done' ? 'rgba(95,191,119,0.12)' : 'transparent',
            cursor: disabled ? 'default' : 'pointer',
          }}
        >
          {state.kind === 'working' ? <PolishSpinner /> : <PolishIcon />}
        </button>
        <button
          type="button"
          title={t('menu.trigger')}
          aria-label={t('menu.trigger')}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
          style={{ ...chevronStyle, opacity: 0.7 }}
        >
          <ChevronIcon />
        </button>
        {menuOpen && (
          <>
            {/* Click-away catcher: closes the menu without a document listener. */}
            <button type="button" aria-hidden="true" tabIndex={-1} style={backdropStyle} onClick={() => setMenuOpen(false)} />
            <div role="menu" style={menuStyle}>
              {CLIENT_STYLES.map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  role="menuitemradio"
                  aria-checked={candidate === style}
                  onClick={() => onPickStyle(candidate)}
                  style={{
                    ...menuItemStyle,
                    background: candidate === style ? 'rgba(80,140,255,0.14)' : 'transparent',
                    fontWeight: candidate === style ? 600 : 400,
                  }}
                >
                  <span>{t(`style.${candidate}`)}</span>
                  <span aria-hidden="true">{candidate === style ? '✓' : ''}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </span>
    </>
  )
}

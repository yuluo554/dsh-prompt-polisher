/**
 * The restore status bar (M2, FR4/R2 — plan/03 §3.3 component two): an
 * ambient entry below the composer card (`conversation.composer.dock`).
 * Shows "已优化 · [还原]" backed by the plugin's per-session store — the
 * original text never depends on the editor's undo stack. Renders null when
 * the session has no settled optimization, so it occupies no space.
 *
 * R6 race phase: when the draft changed behind the request, the bar offers
 * [替换]/[放弃] — replacing writes the optimized text, discarding drops the
 * record. Neither silently overwrites.
 *
 * Session switch unmounts the seat and clears the record (会话切换即清).
 */
import { useEffect, useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { DshTranslate as Translate } from './ambient.js'
import { polishStore } from './store.js'

interface PolishBarProps {
  /** Standard session prop: the current session's id. */
  sessionId: string
  /** Standard session prop: stable public input actions. */
  inputActions: InputActions
  /** Plugin translate, mounted through the register inject face. */
  t: Translate
}

const barStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '4px 12px',
  fontSize: 12,
  opacity: 0.85,
}

const linkButton: CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: 12,
  padding: '2px 6px',
  borderRadius: 4,
  cursor: 'pointer',
  textDecoration: 'underline',
  textUnderlineOffset: 2,
}

const primaryLink: CSSProperties = {
  ...linkButton,
  textDecoration: 'none',
  background: 'rgba(80,140,255,0.18)',
}

export function PolishBar({ sessionId, inputActions, t }: PolishBarProps) {
  const state = useSyncExternalStore(
    (listener) => polishStore.subscribe(listener),
    () => polishStore.get(sessionId),
    // Server renderer requires the snapshot getter explicitly.
    () => polishStore.get(sessionId),
  )

  // 会话切换即清: unmount (or session id change) drops this session's record.
  useEffect(() => () => polishStore.clear(sessionId), [sessionId])

  if (state === undefined) return null

  const styleLabel = t(`style.${state.style}`)
  if (state.phase === 'race') {
    const onReplace = () => {
      inputActions.setDraft(state.optimized)
      polishStore.set(sessionId, { ...state, phase: 'applied' })
    }
    const onDiscard = () => polishStore.clear(sessionId)
    return (
      <div style={barStyle} role="status">
        <span>{t('bar.race')}</span>
        <button type="button" style={primaryLink} onClick={onReplace}>{t('bar.replace')}</button>
        <button type="button" style={linkButton} onClick={onDiscard}>{t('bar.discard')}</button>
      </div>
    )
  }

  const onRestore = () => {
    inputActions.setDraft(state.original)
    polishStore.clear(sessionId)
  }
  return (
    <div style={barStyle} role="status">
      <span>{t('bar.optimized', { style: styleLabel })}</span>
      <button type="button" style={linkButton} onClick={onRestore}>{t('bar.restore')}</button>
    </div>
  )
}

/**
 * Settings-panel config + connectivity tester (M3/M3.1 — plan/03 §3.3
 * component three): registered into the Plugins page's `plugins.bundle.config`
 * seat (keyed by the package name). Registering this seat makes us the
 * entry's CUSTOM page, which suppresses the host's auto-generated schemastery
 * form ("generate a page if no custom page is registered") — so the panel
 * renders the config fields ITSELF, bound to the entry's ConfigForm
 * (`ctx.configForms.get(entryId)`, entryId = the settings namespace = the
 * bundle row id) that the page owner does NOT pass down for bundle pages
 * (verified in the official plugin-manager bundle: only row/item pages get
 * `form`).
 *
 * Field writes go through `form.mutate` (atomic, revision-fenced). The API
 * key is WRITE-ONLY on this surface: the settings wire strips secret values,
 * so the input starts blank and a blank value never overwrites the stored
 * key (official "empty field means keep that one" convention); clearing is
 * an explicit unset.
 *
 * The connectivity test runs HOST-side (`POST /api/prompt-polisher/test-api`)
 * and the answer carries latency/model/error text only — the key never
 * crosses the wire in either direction.
 */
import { useCallback, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { DshTranslate as Translate } from './ambient.js'
import { testApiConnection } from './api.js'
import { SeatErrorBoundary } from './ErrorBoundary.js'

/** The entry's config form as the settings service hands it out. */
export type PolisherConfigForm = ConfigForm<Record<string, unknown>>

/** Settings namespace (bundle row id) this plugin's config lives under. */
export const PANEL_ENTRY_ID = 'dsh-prompt-polisher'

export interface ApiTestPanelProps {
  /** The page asks a configuration entry for one of two views. */
  view: 'summary' | 'page'
  /** Plugin translate, mounted through the register inject face. */
  t: Translate
  /** Config-form accessor over the settings service (inject face; optional —
   * the panel degrades to description + test button without it). */
  configForm?: () => PolisherConfigForm | undefined
}

type PanelState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; latencyMs: number; model: string }
  | { kind: 'failed'; message: string }

type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'failed' }

/** Scalar text/textarea fields of the config section (apiKey is separate — write-only). */
const TEXT_FIELDS: ReadonlyArray<{ field: string; key: string; secret?: boolean }> = [
  { field: 'apiBaseURL', key: 'form.apiBaseURL' },
  { field: 'apiModel', key: 'form.apiModel' },
  { field: 'apiKey', key: 'form.apiKey', secret: true },
  { field: 'apiKeyEnv', key: 'form.apiKeyEnv' },
]

const TEXTAREA_FIELDS: ReadonlyArray<{ field: string; key: string }> = [
  { field: 'templateConcise', key: 'form.templateConcise' },
  { field: 'templateStructured', key: 'form.templateStructured' },
]

const panelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: '12px 0',
  borderTop: '1px solid rgba(128,128,128,0.18)',
  fontSize: 13,
}

const titleStyle: CSSProperties = {
  fontWeight: 600,
  fontSize: 13,
}

const descriptionStyle: CSSProperties = {
  opacity: 0.75,
  lineHeight: 1.5,
  whiteSpace: 'pre-line',
}

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap',
}

const fieldStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
}

const labelStyle: CSSProperties = {
  fontSize: 12,
  opacity: 0.8,
}

const inputStyle: CSSProperties = {
  border: '1px solid rgba(128,128,128,0.35)',
  borderRadius: 6,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: 13,
  padding: '6px 10px',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
}

const wideFieldStyle: CSSProperties = {
  ...fieldStyle,
  width: '100%',
}

const textareaStyle: CSSProperties = {
  ...inputStyle,
  fontFamily: 'var(--ds-font-family-code, ui-monospace, monospace)',
  resize: 'vertical',
  minHeight: 64,
}

const toggleStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  cursor: 'pointer',
}

const buttonStyle: CSSProperties = {
  border: '1px solid rgba(128,128,128,0.35)',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: 13,
  padding: '5px 14px',
  borderRadius: 6,
  cursor: 'pointer',
}

const okStyle: CSSProperties = { color: '#3f9d5f' }
const failedStyle: CSSProperties = { color: '#d06a5c' }
const hintStyle: CSSProperties = { opacity: 0.65, fontSize: 12 }

/** Value of one scalar field in the wire snapshot (secrets arrive stripped). */
function snapshotString(value: Record<string, unknown> | undefined, field: string): string {
  const raw = value?.[field]
  return typeof raw === 'string' ? raw : ''
}

/** The page view: config fields + test interaction. */
function ApiTestPanelPage({ t, configForm }: { t: Translate; configForm?: () => PolisherConfigForm | undefined }) {
  const form = configForm?.()
  const subscribe = useCallback((listener: () => void) => (form ? form.subscribe(listener) : () => {}), [form])
  const getSnapshot = useCallback(() => (form ? form.getSnapshot() : undefined), [form])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  // Local drafts over the wire snapshot; a field's absence means "unchanged".
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' })
  const [testState, setTestState] = useState<PanelState>({ kind: 'idle' })
  const abortRef = useRef<AbortController | null>(null)

  const ready = snapshot !== undefined && snapshot.status === 'ready'
  const value = ready ? snapshot.value ?? {} : undefined
  const revision = ready ? snapshot.revision : undefined
  const writable = ready ? snapshot.writable : false

  const draftOf = (field: string) => {
    const raw = drafts[field]
    return raw !== undefined ? raw : snapshotString(value, field)
  }

  const onDraft = (field: string, next: string) => setDrafts((current) => ({ ...current, [field]: next }))

  const enabled = drafts.apiEnabled !== undefined
    ? drafts.apiEnabled === 'true'
    : value?.apiEnabled === true

  // M4: host-log diagnostics toggle (config `clientDiagnostics`, default on).
  const diagnostics = drafts.clientDiagnostics !== undefined
    ? drafts.clientDiagnostics === 'true'
    : value?.clientDiagnostics !== false

  const onSave = useCallback(() => {
    if (form === undefined || !ready || !writable || saveState.kind === 'saving') return
    const ops: Array<{ op: 'set'; path: [string]; value: string | boolean } | { op: 'unset'; path: [string] }> = []
    for (const { field } of TEXT_FIELDS) {
      const next = drafts[field]
      if (next === undefined) continue
      const current = snapshotString(value, field)
      // The secret is write-only: an unchanged blank never overwrites; an
      // explicit clear goes through the 清除 key control (unset).
      if (next === current) continue
      if (field === 'apiKey' && next.trim() === '') continue
      ops.push(next.trim() === '' ? { op: 'unset', path: [field] } : { op: 'set', path: [field], value: next.trim() })
    }
    for (const { field } of TEXTAREA_FIELDS) {
      const next = drafts[field]
      if (next === undefined) continue
      const current = snapshotString(value, field)
      if (next === current) continue
      ops.push(next === '' ? { op: 'unset', path: [field] } : { op: 'set', path: [field], value: next })
    }
    if (drafts.apiEnabled !== undefined) {
      const nextEnabled = drafts.apiEnabled === 'true'
      if (nextEnabled !== (value?.apiEnabled === true)) {
        ops.push({ op: 'set', path: ['apiEnabled'], value: nextEnabled })
      }
    }
    if (drafts.clientDiagnostics !== undefined) {
      const nextDiag = drafts.clientDiagnostics === 'true'
      if (nextDiag !== (value?.clientDiagnostics !== false)) {
        ops.push({ op: 'set', path: ['clientDiagnostics'], value: nextDiag })
      }
    }
    setSaveState({ kind: 'saving' })
    void (async () => {
      try {
        const ok = ops.length === 0 ? true : await form.mutate(ops, revision)
        setSaveState(ok ? { kind: 'saved' } : { kind: 'failed' })
        if (ok) setDrafts({})
      } catch {
        setSaveState({ kind: 'failed' })
      }
    })()
  }, [form, ready, writable, saveState.kind, drafts, value, revision])

  const onClearKey = useCallback(() => {
    if (form === undefined || !ready || !writable) return
    setSaveState({ kind: 'saving' })
    void (async () => {
      try {
        const ok = await form.mutate([{ op: 'unset', path: ['apiKey'] }], revision)
        setSaveState(ok ? { kind: 'saved' } : { kind: 'failed' })
        if (ok) {
          setDrafts((current) => ({ ...current, apiKey: '' }))
        }
      } catch {
        setSaveState({ kind: 'failed' })
      }
    })()
  }, [form, ready, writable, revision])

  const onTest = useCallback(() => {
    if (testState.kind === 'testing') return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setTestState({ kind: 'testing' })
    void (async () => {
      try {
        const result = await testApiConnection(controller.signal)
        if (controller.signal.aborted) return
        if (result.ok) setTestState({ kind: 'ok', latencyMs: result.latencyMs, model: result.model })
        else setTestState({ kind: 'failed', message: result.error })
      } catch (err) {
        if (controller.signal.aborted) return
        setTestState({ kind: 'failed', message: err instanceof Error ? err.message : String(err) })
      } finally {
        if (abortRef.current === controller) abortRef.current = null
      }
    })()
  }, [testState.kind])

  return (
    <div style={panelStyle}>
      <div style={titleStyle}>{t('panel.title')}</div>
      <div style={descriptionStyle}>{t('panel.description')}</div>
      {!ready && (
        <div style={hintStyle}>{snapshot !== undefined && snapshot.status === 'unavailable' ? t('form.unavailable') : t('form.loading')}</div>
      )}
      {ready && (
        <>
          <label style={toggleStyle}>
            <input
              type="checkbox"
              checked={enabled}
              disabled={!writable}
              onChange={(event) => onDraft('apiEnabled', event.target.checked ? 'true' : 'false')}
            />
            <span>
              {t('form.apiEnabled')}
              <div style={hintStyle}>{t('form.apiEnabledHint')}</div>
            </span>
          </label>
          <label style={toggleStyle}>
            <input
              type="checkbox"
              checked={diagnostics}
              disabled={!writable}
              onChange={(event) => onDraft('clientDiagnostics', event.target.checked ? 'true' : 'false')}
            />
            <span>
              {t('form.clientDiagnostics')}
              <div style={hintStyle}>{t('form.clientDiagnosticsHint')}</div>
            </span>
          </label>
          {TEXT_FIELDS.map(({ field, key, secret }) => (
            <div key={field} style={wideFieldStyle}>
              <label style={labelStyle} htmlFor={`pp-cfg-${field}`}>{t(key)}</label>
              <input
                id={`pp-cfg-${field}`}
                type={secret ? 'password' : 'text'}
                value={draftOf(field)}
                disabled={!writable}
                autoComplete={secret ? 'new-password' : 'off'}
                onChange={(event) => onDraft(field, event.target.value)}
                style={inputStyle}
              />
            </div>
          ))}
          {TEXTAREA_FIELDS.map(({ field, key }) => (
            <div key={field} style={wideFieldStyle}>
              <label style={labelStyle} htmlFor={`pp-cfg-${field}`}>{t(key)}</label>
              <textarea
                id={`pp-cfg-${field}`}
                value={draftOf(field)}
                disabled={!writable}
                rows={4}
                onChange={(event) => onDraft(field, event.target.value)}
                style={textareaStyle}
              />
            </div>
          ))}
          <div style={rowStyle}>
            <button
              type="button"
              style={buttonStyle}
              onClick={onSave}
              disabled={!writable || saveState.kind === 'saving'}
              aria-busy={saveState.kind === 'saving'}
            >
              {saveState.kind === 'saving' ? t('form.saving') : t('form.save')}
            </button>
            <button type="button" style={buttonStyle} onClick={onClearKey} disabled={!writable}>
              {t('form.clearKey')}
            </button>
            {!writable && <span style={hintStyle}>{t('form.readonly')}</span>}
            {saveState.kind === 'saved' && <span style={okStyle} role="status">{t('form.saved')}</span>}
            {saveState.kind === 'failed' && <span style={failedStyle} role="status">{t('form.saveFailed')}</span>}
          </div>
        </>
      )}
      <div style={{ ...rowStyle, borderTop: '1px solid rgba(128,128,128,0.18)', paddingTop: 10 }}>
        <button
          type="button"
          style={buttonStyle}
          onClick={onTest}
          disabled={testState.kind === 'testing'}
          aria-busy={testState.kind === 'testing'}
        >
          {testState.kind === 'testing' ? t('test.testing') : t('test.button')}
        </button>
        {testState.kind === 'ok' && (
          <span style={okStyle} role="status">{t('test.ok', { model: testState.model, latency: testState.latencyMs })}</span>
        )}
        {testState.kind === 'failed' && (
          <span style={failedStyle} role="status">{t('test.failed', { message: testState.message })}</span>
        )}
      </div>
    </div>
  )
}

/** Seat entry: the summary view renders nothing (the one-liner belongs to the bundle description). */
export function ApiTestPanel(props: ApiTestPanelProps) {
  if (props.view !== 'page') return null
  return <ApiTestPanelPage t={props.t} configForm={props.configForm} />
}

/** Re-exported wrapper so the registration closure stays symmetric with the composer seats. */
export function ApiTestPanelSeat(props: ApiTestPanelProps) {
  return (
    <SeatErrorBoundary stage="render:ApiTestPanel">
      <ApiTestPanel {...props} />
    </SeatErrorBoundary>
  )
}

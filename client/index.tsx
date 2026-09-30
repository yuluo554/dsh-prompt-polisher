/**
 * Client half entry (M2, plan/03 §3.3): the browser bundle lib/client.js.
 * Registered by the dsh client-modules system through the package.json
 * `dsh.client` declaration; `inject` names the browser services this plugin
 * waits for: the shell's slot registry, the shared locale service, and the
 * settings domain's configForms — sibling-fiber services resolve ONLY through
 * inject (bare property access sees undefined; the official plugin-manager
 * declares "configForms" the same way).
 *
 * Three seats (M3):
 * - `conversation.input.right` "prompt-polisher": the optimize button + style
 *   menu before the composer submit action (WorkBuddy position, FR8).
 * - `conversation.input.dock` "prompt-polisher-bar" (M2): the restore
 *   status bar ABOVE the composer card (FR4/R2, renders null when idle).
 *   Seat history: `composer.dock` renders only in the session-composer
 *   variant (blank-session hero has no outlet); `input.overlay` floats over
 *   the draft text (overlaps). `input.dock` renders unconditionally above
 *   the card — the official queue-notice and Todo panels live here — which
 *   matches the status-bar semantics (M2 目检实测两次迭代).
 * - `plugins.bundle.config` key "dsh-prompt-polisher" (M3, FR9): the
 *   connectivity-test panel on the bundle's own Plugins settings page.
 *
 * The composer seats are session-scope, so each receives the standard kit
 * (useInput / inputActions / sessionId / …) as props; the settings seat is
 * root-scope and receives only the keyed owner props (view).
 *
 * Every lifecycle stage is guarded with client-side diagnostics: a failure
 * posts to the host's debug RPC and lands in the server log (the only
 * observable channel while CDP is broken, environment pit #1).
 */
import type { Context } from '@deepseek-ai/cordis'
import { PolishButton } from './PolishButton.js'
import { PolishBar } from './PolishBar.js'
import { ApiTestPanel } from './ApiTestPanel.js'
import { PANEL_ENTRY_ID } from './ApiTestPanel.js'
import type { PolisherConfigForm } from './ApiTestPanel.js'
import { SeatErrorBoundary } from './ErrorBoundary.js'
import { guardStageStrict } from './diag.js'
import { polishStore } from './store.js'
import { NS, en, zh } from './i18n.js'

export const name = 'dsh-prompt-polisher'
/** Browser-side cordis services required before apply runs. */
export const inject = ['slots', 'locale', 'configForms']

/**
 * Exported for test shims (the Node shim executes the factory and drives
 * the store / style preference directly); the ModuleLoader itself only
 * consumes name/inject/apply.
 */
export { polishStore }
export { readPreferredStyle, writePreferredStyle, DEFAULT_STYLE, STYLE_PREF_KEY, CLIENT_STYLES } from './style-pref.js'

export function apply(ctx: Context) {
  guardStageStrict('apply:body', () => {
    // Single-locale register form: the officially sanctioned path for
    // namespaces outside the shared LocaleNamespaceMap merge table.
    ctx.effect(() => {
      const disposeZh = ctx.locale.register(NS, 'zh', zh)
      const disposeEn = ctx.locale.register(NS, 'en', en)
      return () => {
        disposeZh()
        disposeEn()
      }
    }, 'dsh-prompt-polisher: dictionaries')
    const t = ctx.locale.bind(NS)

    ctx.slots.inject('conversation.input.right', () => guardStageStrict('apply:register-button-seat', () => ctx.slots.register({
      name: 'conversation.input.right',
      id: 'prompt-polisher',
      order: 20,
      inject: () => ({ t }),
    }, (seatProps) => (
      <SeatErrorBoundary stage="render:PolishButton">
        <PolishButton {...seatProps} t={t} />
      </SeatErrorBoundary>
    ))))

    ctx.slots.inject('conversation.input.dock', () => guardStageStrict('apply:register-bar-seat', () => ctx.slots.register({
      name: 'conversation.input.dock',
      id: 'prompt-polisher-bar',
      order: 20,
      inject: () => ({ t }),
    }, (seatProps) => (
      <SeatErrorBoundary stage="render:PolishBar">
        <PolishBar {...seatProps} t={t} />
      </SeatErrorBoundary>
    ))))

    // M3 (FR9): the settings-page connectivity panel on the bundle's own
    // Plugins page (keyed by the package name, root scope — no session kit).
    // Registering the seat makes us the entry's CUSTOM page (the host's
    // auto-generated schemastery form steps aside), so the panel renders the
    // config fields itself over the entry's ConfigForm. The accessor is
    // evaluated at render time (the settings service is up by then) and
    // degrades to undefined — the panel then shows description + test only.
    ctx.slots.inject('plugins.bundle.config', () => guardStageStrict('apply:register-api-panel-seat', () => ctx.slots.register({
      name: 'plugins.bundle.config',
      key: 'dsh-prompt-polisher',
      inject: () => ({
        t,
        configForm: (): PolisherConfigForm | undefined => {
          try {
            return (ctx as { configForms?: { get(id: string): PolisherConfigForm } }).configForms?.get(PANEL_ENTRY_ID)
          } catch {
            return undefined
          }
        },
      }),
    }, (seatProps) => (
      <SeatErrorBoundary stage="render:ApiTestPanel">
        <ApiTestPanel {...seatProps} t={t} />
      </SeatErrorBoundary>
    ))))
  })
}

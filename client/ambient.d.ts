/**
 * Browser-side service wiring (M1).
 *
 * The `slots` / `locale` services land on the cordis Context through the
 * official packages' own declaration merging — importing their client type
 * entries below is what mounts `ctx.slots` (dsh-client-ui-renderer),
 * `ctx.locale` (dsh-client-locale), and the SlotMap entry of the seat this
 * plugin registers into with its `SessionStandardProps` (useInput /
 * inputActions — dsh-client-ui-conversation). No user-space
 * `declare module '@deepseek-ai/cordis'` here on purpose: augmenting the
 * package root shadows its star-re-exported Context instead of merging with
 * it (dsh-plugin-dev §5).
 *
 * Only this plugin's own prop vocabulary is declared locally.
 */
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'

/**
 * Local alias over the official Translate face — the button takes `t`
 * through the register `inject` face, so the key domain stays open (no
 * LocaleNamespaceMap merge needed for this plugin's private namespace).
 */
export type DshTranslate = (key: string, params?: Record<string, string | number>) => string

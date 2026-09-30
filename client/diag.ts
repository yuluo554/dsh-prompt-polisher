/**
 * Client-side diagnostics (M2 目检): every lifecycle stage (bundle factory,
 * apply, seat registration, component render) reports failures to the host's
 * `/api/prompt-polisher/debug` route, which mirrors them into the server
 * log — the only observable channel while CDP is broken on this machine
 * (environment pit #1). Fire-and-forget by design: diagnostics must never
 * change plugin behavior.
 */

/** Post one failure to the host debug sink; never throws. */
export function reportClientFailure(stage: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error ? (error.stack ?? '') : ''
  try {
    void fetch('/api/prompt-polisher/debug', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stage, message, stack }),
    }).catch(() => {})
  } catch {
    // Diagnostics must never throw into the caller's path.
  }
}

/** Run `step` inside a try/catch that reports failures under `stage`. */
export function guardStage<T>(stage: string, step: () => T): T | undefined {
  try {
    return step()
  } catch (error) {
    reportClientFailure(stage, error)
    return undefined
  }
}

/** Same reporting, but rethrows — for call sites whose contract needs the value. */
export function guardStageStrict<T>(stage: string, step: () => T): T {
  try {
    return step()
  } catch (error) {
    reportClientFailure(stage, error)
    throw error
  }
}

/**
 * Client-side polish store (M2, FR4/R2): the per-session record that backs
 * the composer.dock status bar. The ORIGINAL draft lives here — plugin
 * memory, never the editor undo stack — so 还原 does not depend on Ctrl+Z
 * reaching past `setDraft` (R2).
 *
 * Module-level singleton keyed by sessionId: the button (input.right) and
 * the bar (composer.dock) are separate seat instances of the same bundle.
 * A session switch unmounts the bar, which clears its record (会话切换即清).
 */

/** One settled optimization for the session's composer. */
export interface PolishBarState {
  /** Text to restore on 还原 (the click-time draft). */
  original: string
  /** Scrubbed model output. */
  optimized: string
  /** Style that produced `optimized`. */
  style: string
  /**
   * `applied` — the optimized text was written into the draft.
   * `race` — the draft changed behind the request (R6): offer
   * [替换]/[放弃] instead of having silently overwritten.
   */
  phase: 'applied' | 'race'
}

type Listener = () => void

class PolishStore {
  private records = new Map<string, PolishBarState>()
  private listeners = new Set<Listener>()

  get(sessionId: string): PolishBarState | undefined {
    return this.records.get(sessionId)
  }

  set(sessionId: string, state: PolishBarState): void {
    this.records.set(sessionId, state)
    this.emit()
  }

  clear(sessionId: string): void {
    if (!this.records.delete(sessionId)) return
    this.emit()
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}

/** The bundle-wide singleton (exported through index.ts for the shim tests). */
export const polishStore = new PolishStore()

/**
 * Seat render guard (M2 目检): a render crash inside a seat component would
 * otherwise unmount silently from the host's slot tree (no server-side
 * trace). The boundary reports the crash to the debug sink and renders
 * nothing. Class component — react-dom/server renders children unchanged
 * (the catch hooks never fire server-side), so the shim tests are unaffected.
 */
import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { reportClientFailure } from './diag.js'

interface BoundaryProps {
  /** Diagnostics stage tag (which seat crashed). */
  stage: string
  children: ReactNode
}

interface BoundaryState {
  crashed: boolean
}

export class SeatErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { crashed: false }

  static getDerivedStateFromError(): BoundaryState {
    return { crashed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportClientFailure(this.props.stage, error)
    const stack = info.componentStack ?? ''
    if (stack !== '') {
      reportClientFailure(`${this.props.stage}:stack`, new Error(stack))
    }
  }

  render(): ReactNode {
    return this.state.crashed ? null : this.props.children
  }
}

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

interface Props {
  /** Shown in the fallback, e.g. "the commit graph". */
  area: string
  children: ReactNode
  /** Changing this value resets the boundary (e.g. the active repo path). */
  resetKey?: unknown
}

interface State {
  error: Error | null
  resetKey: unknown
}

/** Keeps a render error in one region from blanking the whole window. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, resetKey: this.props.resetKey }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[adar] render error in ${this.props.area}`, error, info.componentStack)
  }

  override render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="ui-empty" role="alert">
        <div className="ui-empty-icon">
          <AlertTriangle size={28} />
        </div>
        <div className="ui-empty-title">Something went wrong in {this.props.area}</div>
        <div className="ui-empty-body">
          <code>{this.state.error.message}</code>
        </div>
        <button className="ui-btn ui-btn-sm ui-btn-default" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    )
  }
}

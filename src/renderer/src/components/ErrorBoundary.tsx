import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Top-level error boundary. Without one, a single render-time throw anywhere in
 * the tree (e.g. parsing transiently-invalid Monaco/JSON while the user types)
 * unmounts the whole app to a blank white screen. This catches it, shows the
 * message, and lets the user recover without restarting.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] Unhandled render error:', error, info.componentStack)
  }

  handleReset = (): void => this.setState({ error: null })

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-background p-8 text-center text-foreground">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <pre className="max-w-xl overflow-auto rounded border border-border bg-card p-3 text-left text-xs text-muted-foreground">
            {this.state.error.message}
          </pre>
          <button
            className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90"
            onClick={this.handleReset}
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

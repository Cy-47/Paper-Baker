import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Contains render-phase errors so one broken page shows a fallback instead of
 * unmounting the whole app (React's default for an uncaught render error). Wrap
 * it around the routed content and key it by route so navigating away clears the
 * error.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error("Unhandled UI error:", error);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div role="alert" className="mx-auto mt-20 max-w-md text-center">
        <h1 className="text-lg font-medium text-[var(--foreground)]">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)]">{error.message}</p>
        <button
          onClick={() => this.setState({ error: null })}
          className="mt-4 rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--foreground)] hover:bg-[var(--background-secondary)]"
        >
          Try again
        </button>
      </div>
    );
  }
}

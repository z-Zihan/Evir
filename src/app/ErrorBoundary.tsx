import { Component, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = { error: null };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  public render(): ReactNode {
    const { error } = this.state;

    if (error === null) return this.props.children;

    return (
      <main className="workspace">
        <div />
        <section className="conversation-empty" role="alert">
          <div className="empty-copy">
            <h1>Something went wrong</h1>
            <p>
              {error.name}: {error.message}
            </p>
            <button
              className="primary-action"
              type="button"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        </section>
        <div />
      </main>
    );
  }
}

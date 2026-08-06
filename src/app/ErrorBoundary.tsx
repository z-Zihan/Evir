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
      <main className="min-w-0 flex-1 grid grid-rows-[auto_1fr_auto] bg-background">
        <div />
        <section
          className="grid place-content-center w-[min(720px,calc(100%-40px))] m-auto text-center py-12 px-4"
          role="alert"
        >
          <div className="empty-copy">
            <h1>Something went wrong</h1>
            <p>
              {error.name}: {error.message}
            </p>
            <button
              className="flex items-center justify-center gap-2 min-h-[38px] rounded-lg font-semibold border border-border bg-surface hover:bg-surface-hover transition"
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

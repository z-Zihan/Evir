import { Component, type ErrorInfo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { PreviewError, PreviewShell } from "./PreviewChrome";

interface PreviewErrorBoundaryProps {
  children: ReactNode;
  /** Renderer id for diagnostics. */
  renderer: string;
  /** Human-readable renderer name for the user-facing headline. */
  rendererName?: string | undefined;
}

interface PreviewErrorBoundaryState {
  error: Error | null;
}

/**
 * Per-artifact error boundary: a crashing renderer (mermaid, vega, pdf…) must
 * degrade to an inline error, never take down the message, chat or app.
 */
export class PreviewErrorBoundary extends Component<
  PreviewErrorBoundaryProps,
  PreviewErrorBoundaryState
> {
  state: PreviewErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): PreviewErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Bounded diagnostics only — artifact content is never logged.
    console.warn(
      `[preview:${this.props.renderer}] renderer failed`,
      error.message,
      info.componentStack?.slice(0, 200),
    );
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <PreviewRendererError
          message={this.state.error.message}
          renderer={this.props.renderer}
          rendererName={this.props.rendererName}
        />
      );
    }
    return this.props.children;
  }
}

export function PreviewRendererError({
  message,
  renderer,
  rendererName,
}: {
  message: string;
  renderer: string;
  rendererName?: string | undefined;
}) {
  const { t } = useTranslation();
  return (
    // `.preview-renderer-error` is a test/e2e hook class.
    <PreviewShell className="preview-renderer-error min-h-0 flex-1">
      <PreviewError
        message={t("preview.rendererFailed", { renderer: rendererName ?? renderer })}
        detail={message.slice(0, 300)}
      />
    </PreviewShell>
  );
}

import { Component, type ErrorInfo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

interface PreviewErrorBoundaryProps {
  children: ReactNode;
  /** Renderer id for diagnostics. */
  renderer: string;
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
        <PreviewRendererError message={this.state.error.message} renderer={this.props.renderer} />
      );
    }
    return this.props.children;
  }
}

export function PreviewRendererError({ message, renderer }: { message: string; renderer: string }) {
  const { t } = useTranslation();
  return (
    <div className="preview-renderer-error" role="alert">
      <p className="preview-renderer-error-title">{t("preview.rendererFailed", { renderer })}</p>
      <p className="preview-renderer-error-detail">{message.slice(0, 300)}</p>
    </div>
  );
}

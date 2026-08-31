import { memo, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Maximize2, WrapText } from "lucide-react";
import { normalizeFenceLanguage, previewRegistry } from "./preview-registry";
import { isHighlightable, useShikiHighlight } from "./use-shiki";
import { ArtifactPreview } from "./ArtifactPreview";
import { PreviewOverlay } from "./PreviewOverlay";

export const COLLAPSED_CODE_BYTES = 40_000;
const AUTO_PREVIEW_TRUST_LEVELS = new Set(["SAFE_TEXT", "SAFE_MEDIA", "DECLARATIVE_RENDER"]);

export interface CodeBlockViewProps {
  code: string;
  /** Raw fence language token ("" when the fence had none). */
  language: string;
  /** True while the surrounding message is still streaming. */
  streaming?: boolean;
}

/**
 * Unified code block used by both the streaming and completed render paths:
 * Shiki highlighting (lazy, debounced during streaming), copy, wrap toggle,
 * opt-in artifact preview and fullscreen expansion. The rendered UI stays
 * identical before and after a message completes.
 */
export const CodeBlockView = memo(function CodeBlockView({
  code,
  language,
  streaming = false,
}: CodeBlockViewProps) {
  const { t } = useTranslation();
  const normalized = normalizeFenceLanguage(language);
  const [copied, setCopied] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const descriptor = useMemo(() => {
    const explicit = previewRegistry.forLanguage(language);
    if (explicit) return explicit;
    return previewRegistry.detect({ content: code, language: "", streaming });
  }, [language, code, streaming]);

  const { html, error: highlightError } = useShikiHighlight(code, normalized, streaming);
  const debouncedCode = useStreamDebounce(
    code,
    streaming && descriptor !== null && descriptor.supportsStreaming,
  );
  // UNTRUSTED_CODE never executes before the fence is complete (§28): while
  // streaming, only declarative renderers may live-preview.
  const previewAllowed =
    descriptor !== null &&
    (!streaming || (descriptor.supportsStreaming && descriptor.trustLevel !== "UNTRUSTED_CODE"));
  const large = code.length > COLLAPSED_CODE_BYTES;

  useEffect(() => {
    // Declarative/text artifacts auto-preview once the fence is complete;
    // HTML (UNTRUSTED_CODE) and diffs stay on the code tab until opted in.
    if (
      !streaming &&
      descriptor &&
      AUTO_PREVIEW_TRUST_LEVELS.has(descriptor.trustLevel) &&
      descriptor.id !== "diff"
    ) {
      setPreviewing(true);
    }
  }, [streaming, descriptor]);

  const copy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const body =
    highlightError || html === null || !isHighlightable(code) ? (
      <pre className={`code-block-pre${wrap ? " wrap" : ""}`}>
        <code>{code}</code>
      </pre>
    ) : (
      <div
        className={`code-block-highlight${wrap ? " wrap" : ""}`}
        // Shiki output escapes the source; dual themes switch via CSS vars.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );

  return (
    <div className="code-block code-block-view">
      <div className="code-block-header">
        <span className="code-block-language">{normalized || t("preview.plainText")}</span>
        <div className="code-block-actions">
          <button
            type="button"
            className={`code-block-action${wrap ? " active" : ""}`}
            onClick={() => setWrap(!wrap)}
            aria-label={t("preview.toggleWrap")}
            aria-pressed={wrap}
          >
            <WrapText size={13} />
          </button>
          <button
            type="button"
            className="code-block-action"
            onClick={copy}
            aria-label={t("chat.copyCode")}
          >
            <Copy size={13} />
            <span>{copied ? t("chat.copied") : t("chat.copyCode")}</span>
          </button>
          <button
            type="button"
            className="code-block-action"
            onClick={() => setExpanded(true)}
            aria-label={t("preview.expand")}
            disabled={descriptor === null && !large}
          >
            <Maximize2 size={13} />
          </button>
        </div>
      </div>
      <div className="code-block-body-row">
        {descriptor !== null && (
          <div className="code-block-tabbar" role="tablist" aria-label={t("preview.viewMode")}>
            <button
              type="button"
              role="tab"
              aria-selected={!previewing}
              className={`code-block-tab${previewing ? "" : " active"}`}
              onClick={() => setPreviewing(false)}
            >
              {t("preview.codeTab")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={previewing}
              className={`code-block-tab${previewing ? " active" : ""}`}
              onClick={() => setPreviewing(true)}
              disabled={!previewAllowed}
            >
              {t("preview.previewTab")}
            </button>
          </div>
        )}
        {previewing && descriptor !== null ? (
          <div className="code-block-tabpanel" role="tabpanel">
            <ArtifactPreview rendererId={descriptor.id} source={debouncedCode} />
          </div>
        ) : (
          <div className={`code-block-body${large ? " collapsed" : ""}`}>{body}</div>
        )}
      </div>
      {large && !previewing && (
        <button type="button" className="code-block-expand" onClick={() => setExpanded(true)}>
          {t("preview.showMore")}
        </button>
      )}
      {expanded && (
        <PreviewOverlay
          {...(descriptor ? { rendererId: descriptor.id } : {})}
          source={code}
          title={`${descriptor?.label ?? ""} · ${normalized || t("preview.plainText")}`}
          onClose={() => setExpanded(false)}
        />
      )}
    </div>
  );
});

/**
 * Streaming previews (mermaid/dot) must not re-parse on every token: hold the
 * latest content and only commit it after a quiet window.
 */
function useStreamDebounce(value: string, enabled: boolean): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (!enabled) {
      setDebounced(value);
      return;
    }
    const timer = setTimeout(() => setDebounced(value), 400);
    return () => clearTimeout(timer);
  }, [value, enabled]);
  return enabled ? debounced : value;
}

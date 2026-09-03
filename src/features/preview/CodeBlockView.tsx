import { memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, ExternalLink, WrapText } from "lucide-react";
import { Button, Tip } from "../../components/ui";
import { normalizeFenceLanguage, previewRegistry } from "./preview-registry";
import { isHighlightable, useShikiHighlight } from "./use-shiki";
import { useWorkspacePanelStore } from "../workspace/workspace-panel-store";
import { saveArtifact } from "../workspace/workspace-services";

export const COLLAPSED_CODE_BYTES = 40_000;

export interface CodeBlockViewProps {
  code: string;
  /** Raw fence language token ("" when the fence had none). */
  language: string;
  /** True while the surrounding message is still streaming. */
  streaming?: boolean;
}

function artifactIdFor(code: string, language: string): string {
  // Deterministic identity so re-clicking the same fence reuses storage.
  let hash = 5381;
  const key = `${language}::${code.length}`;
  for (let index = 0; index < key.length; index += 1) {
    hash = ((hash << 5) + hash + (key.charCodeAt(index) || 0)) | 0;
  }
  return `chat-artifact-${(hash >>> 0).toString(36)}-${code.length}`;
}

/**
 * Chat code block: Shiki highlighting, copy, wrap toggle, and — instead of
 * expanding a giant inline preview — a single action that opens the artifact
 * in the workspace panel (§6, §21). Small markdown/images stay inline via
 * the markdown renderer; this is the large-artifact path.
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
  const openResource = useWorkspacePanelStore((state) => state.openResource);

  const descriptor = useMemo(() => {
    const explicit = previewRegistry.forLanguage(language);
    if (explicit) return explicit;
    return streaming
      ? null
      : previewRegistry.detect({ content: code, language: "", streaming: false });
  }, [language, code, streaming]);

  const { html, error: highlightError } = useShikiHighlight(code, normalized, streaming);
  const large = code.length > COLLAPSED_CODE_BYTES;

  const copy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const openInWorkspace = () => {
    const artifactId = artifactIdFor(code, language);
    void saveArtifact({
      id: artifactId,
      language: normalized || language || "text",
      ...(descriptor ? { title: descriptor.label } : {}),
      content: code,
    }).finally(() => {
      openResource(
        { kind: "artifact", artifactId, language: normalized || language || "text" },
        { viewMode: "preview" },
      );
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
          <Tip content={t("preview.toggleWrap")}>
            <Button
              variant="ghost"
              size="icon-xs"
              className={wrap ? "text-primary" : "text-muted"}
              onClick={() => setWrap(!wrap)}
              aria-label={t("preview.toggleWrap")}
              aria-pressed={wrap}
            >
              <WrapText size={13} />
            </Button>
          </Tip>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted"
            onClick={copy}
            aria-label={t("chat.copyCode")}
          >
            {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
            <span>{copied ? t("chat.copied") : t("chat.copyCode")}</span>
          </Button>
          {!streaming && (
            <Tip content={t("preview.openInWorkspace")}>
              <Button
                variant="ghost"
                size="icon-xs"
                className="workspace-open-action text-muted"
                onClick={openInWorkspace}
                aria-label={t("preview.openInWorkspace")}
              >
                <ExternalLink size={13} />
                <span>{t("preview.previewTab")}</span>
              </Button>
            </Tip>
          )}
        </div>
      </div>
      <div className={`code-block-body${large ? " collapsed" : ""}`}>{body}</div>
    </div>
  );
});

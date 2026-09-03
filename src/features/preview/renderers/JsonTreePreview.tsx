import { useMemo } from "react";
import { useTranslation } from "react-i18next";

export const MAX_JSON_BYTES = 5_000_000;
export const MAX_JSON_DEPTH = 64;
import { TreeNode } from "./TreeView";
import { PreviewError, PreviewNotice, PreviewShell } from "../PreviewChrome";

interface JsonTreePreviewProps {
  source: string;
}

type JsonValue = string | number | boolean | null | { [key: string]: unknown } | unknown[];

export class JsonDepthError extends Error {
  constructor() {
    super("maximum nesting depth exceeded");
  }
}

function parseJson(source: string): { value?: JsonValue; error?: string } {
  if (source.length > MAX_JSON_BYTES) return { error: "too-large" };
  let depth = 0;
  for (const char of source) {
    if (char === "{" || char === "[") depth += 1;
    if (depth > MAX_JSON_DEPTH) return { error: "depth" };
  }
  try {
    return { value: JSON.parse(source) as JsonValue };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "JSON parse error" };
  }
}

/** JSON/JSONC tree preview with expand/collapse, copy and size guards. */
export function JsonTreePreview({ source }: JsonTreePreviewProps) {
  const { t } = useTranslation();
  const parsed = useMemo(() => parseJson(source), [source]);

  if (parsed.error === "too-large") {
    return (
      <PreviewShell className="min-h-0 flex-1">
        <PreviewNotice message={t("preview.tooLarge")} className="preview-fallback-text" />
      </PreviewShell>
    );
  }
  if (parsed.error === "depth") {
    return (
      <PreviewShell className="min-h-0 flex-1">
        <PreviewError message={t("preview.jsonDepthExceeded")} />
      </PreviewShell>
    );
  }
  if (parsed.error !== undefined) {
    return (
      <div className="json-tree-error">
        <p className="preview-parse-error">{t("preview.malformedJson")}</p>
        <p className="json-tree-error-detail">{parsed.error.slice(0, 200)}</p>
      </div>
    );
  }

  return (
    <div className="json-tree" role="tree" aria-label={t("preview.jsonTree")}>
      <TreeNode name={null} value={parsed.value} depth={0} />
    </div>
  );
}

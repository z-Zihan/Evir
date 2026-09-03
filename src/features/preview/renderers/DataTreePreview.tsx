import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { TreeNode } from "./TreeView";
import { PreviewNotice, PreviewShell } from "../PreviewChrome";

export const MAX_STRUCTURED_BYTES = 2_000_000;
export const MAX_STRUCTURED_DEPTH = 64;

interface DataTreePreviewProps {
  source: string;
  format: "yaml" | "toml" | "xml";
}

type TextParser = (input: string) => unknown;

function depthGuard(value: unknown, depth = 0): boolean {
  if (depth > MAX_STRUCTURED_DEPTH) return false;
  if (Array.isArray(value)) return value.every((item) => depthGuard(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.values(value).every((item) => depthGuard(item, depth + 1));
  }
  return true;
}

function xmlToTree(element: Element): unknown {
  const children = [...element.children];
  const attributes: Record<string, string> = {};
  for (const attr of [...element.attributes]) attributes[`@${attr.name}`] = attr.value;
  if (children.length === 0) {
    const text = element.textContent?.trim() ?? "";
    return Object.keys(attributes).length > 0 ? { ...attributes, "#text": text } : text;
  }
  const result: Record<string, unknown> = { ...attributes };
  for (const child of children) {
    const existing = result[child.tagName];
    if (existing === undefined) {
      result[child.tagName] = xmlToTree(child);
    } else if (Array.isArray(existing)) {
      (existing as unknown[]).push(xmlToTree(child));
    } else {
      result[child.tagName] = [existing, xmlToTree(child)];
    }
  }
  return result;
}

/**
 * Structured tree preview for YAML / TOML / XML artifacts. XML goes through
 * DOMParser, which never resolves external entities (XXE-safe); parse
 * failures fall back to showing the source, never a crash.
 */
export function DataTreePreview({ source, format }: DataTreePreviewProps) {
  const { t } = useTranslation();
  const [yamlParser, setYamlParser] = useState<TextParser | null>(null);
  const [tomlParser, setTomlParser] = useState<TextParser | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (format === "yaml" && yamlParser === null) {
      void import("yaml")
        .then((mod) => {
          if (!cancelled) setYamlParser(() => mod.parse);
        })
        .catch(() => {
          if (!cancelled) setLoadError(true);
        });
    }
    if (format === "toml" && tomlParser === null) {
      void import("smol-toml")
        .then((mod) => {
          if (!cancelled) setTomlParser(() => mod.parse);
        })
        .catch(() => {
          if (!cancelled) setLoadError(true);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [format, yamlParser, tomlParser]);

  const parsed = useMemo(() => {
    if (source.length > MAX_STRUCTURED_BYTES) return { error: "too-large" as const };
    try {
      if (format === "yaml") {
        if (yamlParser === null) return { error: "loading" as const };
        const value = yamlParser(source);
        return depthGuard(value) ? { value } : { error: "depth" as const };
      }
      if (format === "toml") {
        if (tomlParser === null) return { error: "loading" as const };
        const value = tomlParser(source);
        return depthGuard(value) ? { value } : { error: "depth" as const };
      }
      const xmlRoot = new DOMParser().parseFromString(source, "application/xml");
      const parseError = xmlRoot.querySelector("parsererror");
      if (parseError) return { error: parseError.textContent?.slice(0, 200) ?? "XML parse error" };
      const value = xmlToTree(xmlRoot.documentElement);
      return depthGuard(value) ? { value } : { error: "depth" as const };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "parse error" };
    }
  }, [source, format, yamlParser, tomlParser]);

  if (loadError) {
    return (
      <PreviewShell className="min-h-0 flex-1">
        <PreviewNotice message={t("preview.parserUnavailable")} className="preview-fallback-text" />
      </PreviewShell>
    );
  }
  if (parsed.error === "too-large") {
    return (
      <PreviewShell className="min-h-0 flex-1">
        <PreviewNotice message={t("preview.tooLarge")} className="preview-fallback-text" />
      </PreviewShell>
    );
  }
  if (parsed.error === "depth") {
    return <p className="preview-parse-error">{t("preview.depthExceeded")}</p>;
  }
  if (parsed.error === "loading") {
    return <p className="preview-loading-text">{t("preview.loading")}</p>;
  }
  if (parsed.error !== undefined) {
    return (
      <div className="data-tree-error">
        <p className="preview-parse-error">
          {t("preview.malformedStructured", { format: format.toUpperCase() })}
        </p>
        <pre className="data-tree-error-source">{source.slice(0, 2000)}</pre>
      </div>
    );
  }

  return (
    <div className="data-tree" role="tree" aria-label={t("preview.structureTree")}>
      <TreeNode name={null} value={parsed.value} depth={0} />
    </div>
  );
}

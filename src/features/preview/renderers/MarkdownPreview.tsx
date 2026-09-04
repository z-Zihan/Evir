import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Markdown preview for workspace files and artifacts (§23): rendered /
 * raw-source switching is provided by the preview header's Code/Preview
 * toggle — this renderer owns only the rendered side. Deliberately lean:
 * GFM tables + task lists, no chat-only extras (lightbox, overlays).
 */
export function MarkdownPreview({ source }: { source: string }) {
  const content = useMemo(() => source, [source]);
  return (
    <div className="workspace-markdown-preview">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

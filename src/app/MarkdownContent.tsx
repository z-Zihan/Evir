import { isValidElement, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Copy, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

const MATH_PATTERN = /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+\$/;
const VIDEO_HREF_PATTERN = /\.(mp4|webm|mov|m4v|mkv)([?#].*)?$/i;

type RehypeKatexPlugin = (typeof import("rehype-katex"))["default"];

function extractText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return extractText(node.props.children);
  return "";
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const code = extractText(children);
  return (
    <div className="code-block">
      <button
        type="button"
        className="code-block-copy"
        onClick={() => {
          void navigator.clipboard.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        aria-label={t("chat.copyCode")}
      >
        <Copy size={13} />
        {copied ? t("chat.copied") : t("chat.copyCode")}
      </button>
      <pre>
        <code>{children}</code>
      </pre>
    </div>
  );
}

function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const { t } = useTranslation();
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
    >
      <button
        type="button"
        className="image-lightbox-close"
        autoFocus
        onClick={onClose}
        aria-label={t("common.close")}
      >
        <X size={16} />
      </button>
      <img src={src} alt={alt} onClick={(event) => event.stopPropagation()} />
    </div>
  );
}

export function MarkdownContent({ content }: { content: string }) {
  const { t } = useTranslation();
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  const hasMath = useMemo(() => MATH_PATTERN.test(content), [content]);
  const [katexPlugin, setKatexPlugin] = useState<RehypeKatexPlugin | null>(null);
  const katexAttempted = useRef(false);

  useEffect(() => {
    if (!hasMath || katexPlugin !== null || katexAttempted.current) return;
    katexAttempted.current = true;
    let cancelled = false;
    void Promise.all([import("rehype-katex"), import("katex/dist/katex.min.css")])
      .then(([rehypeKatex]) => {
        if (!cancelled) setKatexPlugin(() => rehypeKatex.default);
      })
      .catch(() => {
        // Leave math as plain text when the renderer cannot be loaded.
      });
    return () => {
      cancelled = true;
    };
  }, [hasMath, katexPlugin]);

  return (
    <>
      <ReactMarkdown
        remarkPlugins={hasMath ? [remarkGfm, remarkMath] : [remarkGfm]}
        rehypePlugins={katexPlugin !== null && hasMath ? [katexPlugin] : undefined}
        components={{
          pre({ children }) {
            return <CodeBlock>{children}</CodeBlock>;
          },
          table({ children }) {
            return (
              <div
                className="table-scroll"
                tabIndex={0}
                role="region"
                aria-label={t("chat.tableRegion")}
              >
                <table>{children}</table>
              </div>
            );
          },
          img({ src, alt }) {
            const source = typeof src === "string" ? src : "";
            const description = alt ?? "";
            return (
              <button
                type="button"
                className="markdown-image-button"
                onClick={() => setLightbox({ src: source, alt: description })}
                aria-label={t("chat.previewImage")}
              >
                <img src={source} alt={description} />
              </button>
            );
          },
          a({ href, children }) {
            const target = typeof href === "string" ? href : "";
            if (VIDEO_HREF_PATTERN.test(target)) {
              return (
                <span className="markdown-video">
                  <video controls preload="metadata" src={target}>
                    <a href={target} target="_blank" rel="noreferrer">
                      {target}
                    </a>
                  </video>
                </span>
              );
            }
            return (
              <a href={target} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
      {lightbox && (
        <ImageLightbox
          src={lightbox.src}
          alt={lightbox.alt || t("chat.previewImage")}
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  );
}

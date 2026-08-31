import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export const MAX_PDF_BYTES = 100_000_000;

interface PdfPreviewProps {
  /** PDF bytes as base64 or a data URL. */
  data: string;
}

type PdfjsModule = typeof import("pdfjs-dist");
type PdfDocument = Awaited<ReturnType<PdfjsModule["getDocument"]>["promise"]>;

let pdfjsPromise: Promise<PdfjsModule> | null = null;

function loadPdfjs(): Promise<PdfjsModule> {
  pdfjsPromise ??= import("pdfjs-dist").then((mod) => {
    mod.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
    return mod;
  });
  return pdfjsPromise;
}

function decodeData(data: string): Uint8Array {
  const base64 = data.startsWith("data:") ? (data.split(",")[1] ?? "") : data;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Lazy-rendering PDF viewer built on pdf.js. Only pages scrolled into view
 * (plus a lookahead margin) rasterize to canvas, so a 100+ page document
 * never paints every page into the DOM at once.
 */
export function PdfPreview({ data }: PdfPreviewProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const documentRef = useRef<PdfDocument | null>(null);
  const loadTaskRef = useRef<ReturnType<PdfjsModule["getDocument"]> | null>(null);
  const renderedPages = useRef(new Set<number>());
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(t("preview.loading"));

  useEffect(() => {
    if (data.length > MAX_PDF_BYTES) {
      setError(t("preview.tooLarge"));
      setProgress(null);
      return;
    }
    let cancelled = false;
    setError(null);
    setPageCount(null);
    setCurrentPage(1);
    setProgress(t("preview.loading"));
    renderedPages.current.clear();
    documentRef.current = null;
    void loadPdfjs()
      .then(async (pdfjs) => {
        const task = pdfjs.getDocument({ data: decodeData(data) });
        task.onProgress = (loaded: { loaded: number; total: number }) => {
          if (loaded.total > 0) setProgress(`${Math.round((loaded.loaded / loaded.total) * 100)}%`);
        };
        const document_ = await task.promise;
        if (cancelled) {
          void document_.cleanup();
          void task.destroy();
          return;
        }
        documentRef.current = document_;
        setProgress(null);
        setPageCount(document_.numPages);
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        const message = loadError instanceof Error ? loadError.message : "PDF load error";
        setError(/password/i.test(message) ? t("preview.pdfPassword") : t("preview.pdfCorrupt"));
        setProgress(null);
      });
    return () => {
      cancelled = true;
      const document_ = documentRef.current;
      documentRef.current = null;
      void document_?.cleanup();
      void loadTaskRef.current?.destroy();
      loadTaskRef.current = null;
    };
  }, [data, t]);

  useEffect(() => {
    if (pageCount === null || containerRef.current === null) return;
    const container = containerRef.current;
    let observer: IntersectionObserver | null = null;
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const pageNumber = Number((entry.target as HTMLElement).dataset.page);
          if (!Number.isFinite(pageNumber) || renderedPages.current.has(pageNumber)) continue;
          renderedPages.current.add(pageNumber);
          const document_ = documentRef.current;
          if (!document_) continue;
          void document_
            .getPage(pageNumber)
            .then(async (page) => {
              const viewport = page.getViewport({ scale: 1.5 });
              const canvas = document.createElement("canvas");
              canvas.width = viewport.width;
              canvas.height = viewport.height;
              canvas.className = "pdf-page-canvas";
              (entry.target as HTMLElement).replaceChildren(canvas);
              await page.render({
                canvas,
                canvasContext: canvas.getContext("2d") ?? undefined,
                viewport,
              }).promise;
            })
            .catch(() => undefined);
        }
      },
      { root: container, rootMargin: "600px" },
    );
    for (const child of [...container.querySelectorAll(".pdf-page-slot")]) observer.observe(child);
    return () => observer?.disconnect();
  }, [pageCount]);

  if (error) {
    return (
      <div className="pdf-error">
        <p className="preview-parse-error">{error}</p>
      </div>
    );
  }

  return (
    <div className="pdf-preview">
      <div className="pdf-toolbar">
        <button
          type="button"
          disabled={currentPage <= 1 || pageCount === null}
          onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
          aria-label={t("preview.pdfPrevPage")}
        >
          ‹
        </button>
        <span className="pdf-page-indicator">
          {pageCount === null
            ? (progress ?? "…")
            : t("preview.pdfPageIndicator", { current: currentPage, total: pageCount })}
        </span>
        <button
          type="button"
          disabled={pageCount === null || currentPage >= pageCount}
          onClick={() => setCurrentPage((page) => Math.min(pageCount ?? 1, page + 1))}
          aria-label={t("preview.pdfNextPage")}
        >
          ›
        </button>
      </div>
      <div className="pdf-scroll" ref={containerRef}>
        {pageCount !== null &&
          Array.from({ length: pageCount }, (_, index) => (
            <div
              key={index}
              data-page={index + 1}
              className={`pdf-page-slot${index + 1 === currentPage ? " pdf-page-current" : ""}`}
              onClick={() => setCurrentPage(index + 1)}
              role="button"
              tabIndex={0}
              aria-label={t("preview.pdfGoToPage", { page: index + 1 })}
            />
          ))}
      </div>
    </div>
  );
}

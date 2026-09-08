/**
 * Content extraction for knowledge ingestion (§57): text formats pass
 * through, HTML strips to readable text, PDF reuses the bundled pdf.js
 * (getTextContent — no new dependency). Binary/unsupported formats are
 * rejected by extension before any read.
 */
import { isPdfPath } from "./types";

type PdfjsModule = typeof import("pdfjs-dist");

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

export function decodeBase64(data: string): Uint8Array {
  const base64 = data.startsWith("data:") ? (data.split(",")[1] ?? "") : data;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Strip HTML to readable text: blocks become newlines, tags drop, entities decode. */
export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const entities: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&nbsp;": " ",
  };
  return withBreaks
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (match) => entities[match] ?? match)
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface ExtractedContent {
  text: string;
  /** Title for the document record (file name / URL / <title>). */
  title: string;
}

function baseName(location: string): string {
  const clean = location.split(/[?#]/)[0] ?? location;
  const segments = clean.split("/").filter((segment) => segment.length > 0);
  return segments.at(-1) ?? (clean.slice(0, 120) || location.slice(0, 120));
}

export async function extractContent(
  location: string,
  raw: { text?: string; base64?: string },
): Promise<ExtractedContent> {
  if (isPdfPath(location)) {
    if (!raw.base64) throw new Error("PDF ingestion requires base64 content");
    const pdfjs = await loadPdfjs();
    const task = pdfjs.getDocument({ data: decodeBase64(raw.base64) });
    const pdf = await task.promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text.length > 0) pages.push(`# Page ${pageNumber}\n\n${text}`);
    }
    return { text: pages.join("\n\n"), title: baseName(location) };
  }
  const lower = location.toLowerCase();
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    const html = raw.text ?? new TextDecoder().decode(decodeBase64(raw.base64 ?? ""));
    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    const title = titleMatch?.[1]?.trim();
    return {
      text: htmlToText(html),
      title: title && title.length > 0 ? title : baseName(location),
    };
  }
  if (raw.text === undefined && raw.base64 !== undefined) {
    const bytes = decodeBase64(raw.base64);
    return { text: new TextDecoder().decode(bytes), title: baseName(location) };
  }
  if (raw.text === undefined) throw new Error(`No content extracted from ${location}`);
  return { text: raw.text, title: baseName(location) };
}

/** Stable content hash (FNV-1a 64-bit as hex) — no crypto.subtle dependency. */
export function contentHash(text: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * Pure file-preview classification (§20): every extension family gets an
 * explicit default strategy — images as data URLs, PDFs via the embedded
 * viewer, opaque binaries as a metadata card, everything else as text.
 */

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  bmp: "image/bmp",
};

const IMAGE_EXTENSIONS = new Set(Object.keys(IMAGE_MIME));

/**
 * Opaque binaries: archives, executables, fonts, media, office docs,
 * databases. These render as a metadata card with size/type + reveal hints —
 * never as lossy text (the lossy UTF-8 read would show mojibake).
 */
const OPAQUE_BINARY_EXTENSIONS = new Set([
  "zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar",
  "exe", "dll", "dylib", "so", "bin", "dat", "class", "jar", "wasm",
  "woff", "woff2", "ttf", "otf", "eot",
  "mp3", "wav", "ogg", "flac", "m4a", "aac",
  "mp4", "mov", "avi", "mkv", "webm",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "sqlite", "db", "psd", "ai", "dmg", "pkg", "iso",
]);

export type FilePreviewKind = "image" | "pdf" | "binary-meta" | "text";

export function fileExtension(path: string): string {
  const name = path.toLowerCase().replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1);
}

export function classifyFilePreview(path: string): FilePreviewKind {
  const extension = fileExtension(path);
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (extension === "pdf") return "pdf";
  if (OPAQUE_BINARY_EXTENSIONS.has(extension)) return "binary-meta";
  return "text";
}

export function imageMimeFor(path: string): string {
  return IMAGE_MIME[fileExtension(path)] ?? "application/octet-stream";
}

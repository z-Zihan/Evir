import { logger } from "../../core/logging/logger";

const IMAGE_MAX_SIZE = 10 * 1024 * 1024;
const TEXT_MAX_SIZE = 1024 * 1024;
const MAX_ATTACHMENTS = 5;

const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "json",
  "js",
  "jsx",
  "ts",
  "tsx",
  "py",
  "rs",
  "go",
  "java",
  "c",
  "cpp",
  "h",
  "css",
  "html",
  "xml",
  "yaml",
  "yml",
  "toml",
  "csv",
  "sh",
  "bash",
  "sql",
  "vue",
  "svelte",
  "rb",
  "php",
  "kt",
]);

const TEXT_MIME_PREFIXES = [
  "text/",
  "application/json",
  "application/javascript",
  "application/xml",
];

export interface ProcessedAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  data: string;
  type: "image" | "text";
}

export class AttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentError";
  }
}

function getExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : "";
}

function isImage(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

function isText(mimeType: string, fileName: string): boolean {
  if (TEXT_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))) return true;
  return TEXT_EXTENSIONS.has(getExtension(fileName));
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") throw new AttachmentError("Failed to read file");
      resolve(result);
    };
    reader.onerror = () => reject(new AttachmentError("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") throw new AttachmentError("Failed to read file");
      resolve(result);
    };
    reader.onerror = () => reject(new AttachmentError("Failed to read file"));
    reader.readAsText(file);
  });
}

export async function processFile(file: File): Promise<ProcessedAttachment> {
  const startedAt = performance.now();
  const mimeType = file.type || "application/octet-stream";
  if (isImage(mimeType)) {
    if (file.size > IMAGE_MAX_SIZE) {
      logger.warn("artifact", "attachment.rejected", {
        type: "image",
        mimeType,
        size: file.size,
        reason: "file-too-large",
      });
      throw new AttachmentError("chat.fileTooLarge");
    }
    const data = await readFileAsDataURL(file);
    logger.info("artifact", "attachment.processed", {
      type: "image",
      mimeType,
      size: file.size,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return {
      id: crypto.randomUUID(),
      fileName: file.name,
      mimeType,
      size: file.size,
      data,
      type: "image",
    };
  }
  if (isText(mimeType, file.name)) {
    if (file.size > TEXT_MAX_SIZE) {
      logger.warn("artifact", "attachment.rejected", {
        type: "text",
        mimeType,
        size: file.size,
        reason: "file-too-large",
      });
      throw new AttachmentError("chat.fileTooLarge");
    }
    const data = await readFileAsText(file);
    logger.info("artifact", "attachment.processed", {
      type: "text",
      mimeType,
      size: file.size,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return {
      id: crypto.randomUUID(),
      fileName: file.name,
      mimeType,
      size: file.size,
      data,
      type: "text",
    };
  }
  logger.warn("artifact", "attachment.rejected", {
    type: "unsupported",
    mimeType,
    size: file.size,
    reason: "unsupported-file-type",
  });
  throw new AttachmentError("chat.unsupportedFileType");
}

export function validateAttachmentCount(current: number): boolean {
  return current < MAX_ATTACHMENTS;
}

export function formatAttachmentForProvider(
  attachment: ProcessedAttachment,
  protocolId: string,
): Record<string, unknown> {
  if (protocolId === "openai-chat-completions" || protocolId === "openai-compatible-chat") {
    if (attachment.type === "image") {
      return { type: "image_url", image_url: { url: attachment.data } };
    }
    return { type: "text", text: `\`\`\`${attachment.fileName}\n${attachment.data}\n\`\`\`` };
  }
  if (protocolId === "anthropic-messages") {
    if (attachment.type === "image") {
      const base64Data = attachment.data.split(",")[1];
      if (!base64Data) throw new Error("Invalid image data URL");
      return {
        type: "image",
        source: { type: "base64", media_type: attachment.mimeType, data: base64Data },
      };
    }
    return { type: "text", text: attachment.data };
  }
  if (protocolId === "gemini-generate-content") {
    if (attachment.type === "image") {
      const base64Data = attachment.data.split(",")[1];
      if (!base64Data) throw new Error("Invalid image data URL");
      return { inlineData: { mimeType: attachment.mimeType, data: base64Data } };
    }
    return { text: attachment.data };
  }
  if (protocolId === "openai-responses") {
    if (attachment.type === "image") {
      return { type: "input_image", image_url: attachment.data };
    }
    return { type: "input_text", text: attachment.data };
  }
  return { type: "text", text: attachment.data };
}

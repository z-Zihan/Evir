import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { AttachmentRecord } from "../../../core/storage/db";
import {
  processFile,
  formatAttachmentForProvider,
  validateAttachmentCount,
  AttachmentError,
} from "../attachment-utils";

// Mock FileReader for jsdom
class MockFileReader {
  result: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL(file: File): void {
    this.result = `data:${file.type};base64,${btoa(file.name)}`;
    queueMicrotask(() => this.onload?.());
  }
  readAsText(file: File): void {
    this.result = file.name === "empty.txt" ? "" : `content-of-${file.name}`;
    queueMicrotask(() => this.onload?.());
  }
}

beforeEach(() => {
  vi.stubGlobal("FileReader", MockFileReader);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeFile(name: string, type: string, content: string): File {
  return new File([content], name, { type });
}

function makeImageFile(name: string, size: number): File {
  const data = "x".repeat(size);
  return new File([data], name, { type: "image/png" });
}

describe("processFile", () => {
  it("processes image files as Base64 data URLs", async () => {
    const file = makeFile("test.png", "image/png", "fake-image");
    const result = await processFile(file);
    expect(result.type).toBe("image");
    expect(result.fileName).toBe("test.png");
    expect(result.mimeType).toBe("image/png");
    expect(result.data).toContain("data:image/png;base64,");
  });

  it("processes text files as text content", async () => {
    const file = makeFile("test.ts", "text/typescript", "const x = 1;");
    const result = await processFile(file);
    expect(result.type).toBe("text");
    expect(result.fileName).toBe("test.ts");
    expect(result.data).toBe("content-of-test.ts");
  });

  it("processes markdown files by extension", async () => {
    const file = makeFile("README.md", "text/markdown", "# Hello");
    const result = await processFile(file);
    expect(result.type).toBe("text");
  });

  it("processes JSON files by extension when mime is octet-stream", async () => {
    const file = makeFile("config.json", "application/octet-stream", '{"key":"value"}');
    const result = await processFile(file);
    expect(result.type).toBe("text");
  });

  it("rejects unsupported file types", async () => {
    const file = makeFile("archive.zip", "application/zip", "binary");
    await expect(processFile(file)).rejects.toThrow(AttachmentError);
  });

  it("rejects oversized images", async () => {
    const file = makeImageFile("big.png", 11 * 1024 * 1024);
    await expect(processFile(file)).rejects.toThrow(AttachmentError);
  });

  it("rejects oversized text files", async () => {
    const bigContent = "x".repeat(2 * 1024 * 1024);
    const file = makeFile("big.txt", "text/plain", bigContent);
    await expect(processFile(file)).rejects.toThrow(AttachmentError);
  });
});

describe("formatAttachmentForProvider", () => {
  const imageAtt = {
    id: "1",
    fileName: "test.png",
    mimeType: "image/png",
    size: 100,
    data: "data:image/png;base64,iVBOR",
    type: "image" as const,
  };
  const textAtt = {
    id: "2",
    fileName: "test.ts",
    mimeType: "text/typescript",
    size: 50,
    data: "const x = 1;",
    type: "text" as const,
  };

  it("formats image for OpenAI Chat Completions", () => {
    const result = formatAttachmentForProvider(imageAtt, "openai-chat-completions");
    expect(result).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,iVBOR" },
    });
  });

  it("formats text for OpenAI Chat Completions", () => {
    const result = formatAttachmentForProvider(textAtt, "openai-chat-completions");
    expect(result).toEqual({ type: "text", text: "```test.ts\nconst x = 1;\n```" });
  });

  it("formats image for Anthropic Messages", () => {
    const result = formatAttachmentForProvider(imageAtt, "anthropic-messages");
    expect(result).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "iVBOR" },
    });
  });

  it("rejects invalid image data for Anthropic Messages", () => {
    expect(() =>
      formatAttachmentForProvider({ ...imageAtt, data: "invalid" }, "anthropic-messages"),
    ).toThrow("Invalid image data URL");
  });

  it("formats text for Anthropic Messages", () => {
    const result = formatAttachmentForProvider(textAtt, "anthropic-messages");
    expect(result).toEqual({ type: "text", text: "const x = 1;" });
  });

  it("formats image for Gemini", () => {
    const result = formatAttachmentForProvider(imageAtt, "gemini-generate-content");
    expect(result).toEqual({ inlineData: { mimeType: "image/png", data: "iVBOR" } });
  });

  it("rejects invalid image data for Gemini", () => {
    expect(() =>
      formatAttachmentForProvider({ ...imageAtt, data: "invalid" }, "gemini-generate-content"),
    ).toThrow("Invalid image data URL");
  });

  it("formats text for Gemini", () => {
    const result = formatAttachmentForProvider(textAtt, "gemini-generate-content");
    expect(result).toEqual({ text: "const x = 1;" });
  });

  it("formats image for OpenAI Responses", () => {
    const result = formatAttachmentForProvider(imageAtt, "openai-responses");
    expect(result).toEqual({ type: "input_image", image_url: "data:image/png;base64,iVBOR" });
  });

  it("formats text for OpenAI Responses", () => {
    const result = formatAttachmentForProvider(textAtt, "openai-responses");
    expect(result).toEqual({ type: "input_text", text: "const x = 1;" });
  });

  it("formats attachment data loaded from storage for historical messages", () => {
    const storedAttachment: AttachmentRecord = {
      id: "stored-1",
      messageId: "historical-message",
      fileName: "history.png",
      mimeType: "image/png",
      size: 128,
      data: "data:image/png;base64,aGlzdG9yeQ==",
      type: "image",
      createdAt: 1,
    };

    expect(formatAttachmentForProvider(storedAttachment, "anthropic-messages")).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "aGlzdG9yeQ==" },
    });
  });
});

describe("validateAttachmentCount", () => {
  it("allows up to 5 attachments", () => {
    expect(validateAttachmentCount(0)).toBe(true);
    expect(validateAttachmentCount(4)).toBe(true);
    expect(validateAttachmentCount(5)).toBe(false);
  });
});

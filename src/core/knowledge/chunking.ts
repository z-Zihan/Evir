/**
 * Structure-first chunking (§58): markdown headings define section
 * boundaries, fenced code blocks never split mid-block, and remaining
 * paragraphs pack toward MAX_CHUNK_CHARS. Plain text (csv/json/code) packs
 * by blank-line paragraphs. No fixed-width blind slicing.
 */
import { MAX_CHUNK_CHARS, MIN_CHUNK_CHARS, type KnowledgeChunkRecord } from "./types";

interface ChunkDraft {
  text: string;
  heading: string | undefined;
}

interface MarkdownBlock {
  kind: "heading" | "paragraph" | "code";
  text: string;
  heading: string | undefined;
}

/** Split markdown into heading/paragraph/code blocks, tracking the nearest heading. */
function markdownBlocks(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let currentHeading: string | undefined;
  const lines = markdown.split("\n");
  let buffer: string[] = [];
  let inCode = false;
  const flushParagraph = () => {
    const text = buffer.join("\n").trim();
    buffer = [];
    if (text.length > 0) blocks.push({ kind: "paragraph", text, heading: currentHeading });
  };
  for (const line of lines) {
    if (line.trimStart().startsWith("```") || line.trimStart().startsWith("~~~")) {
      if (inCode) {
        const text = buffer.join("\n");
        buffer = [];
        blocks.push({ kind: "code", text, heading: currentHeading });
        inCode = false;
      } else {
        flushParagraph();
        buffer = [line];
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      buffer.push(line);
      continue;
    }
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line.trim());
    if (headingMatch) {
      flushParagraph();
      currentHeading = headingMatch[2]!.trim().slice(0, 300) || undefined;
      if (currentHeading === "") currentHeading = undefined;
      blocks.push({ kind: "heading", text: line.trim(), heading: currentHeading });
      continue;
    }
    buffer.push(line);
  }
  if (inCode) {
    const text = buffer.join("\n");
    if (text.trim().length > 0) blocks.push({ kind: "code", text, heading: currentHeading });
  } else {
    flushParagraph();
  }
  return blocks;
}

function hardSplit(text: string): string[] {
  // A single block larger than the cap splits on sentence-ish boundaries.
  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > MAX_CHUNK_CHARS) {
    const window = remaining.slice(0, MAX_CHUNK_CHARS);
    const cut =
      Math.max(window.lastIndexOf("\n"), window.lastIndexOf("。"), window.lastIndexOf(". ")) + 1 ||
      MAX_CHUNK_CHARS;
    parts.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut);
  }
  if (remaining.trim().length > 0) parts.push(remaining.trim());
  return parts;
}

function packBlocks(blocks: MarkdownBlock[]): ChunkDraft[] {
  const drafts: ChunkDraft[] = [];
  let current: { text: string[]; heading: string | undefined; length: number } | null = null;
  const flush = () => {
    if (!current) return;
    const text = current.text.join("\n").trim();
    if (text.length > 0) {
      for (const piece of hardSplit(text)) {
        drafts.push({ text: piece, heading: current.heading });
      }
    }
    current = null;
  };
  for (const block of blocks) {
    const blockText = block.text.trim();
    if (blockText.length === 0) continue;
    if (block.kind === "heading") {
      // A heading starts a fresh chunk so sections stay addressable.
      flush();
      current = { text: [blockText], heading: block.heading, length: blockText.length };
      continue;
    }
    const wouldLength = (current?.length ?? 0) + blockText.length + 1;
    if (!current || wouldLength > MAX_CHUNK_CHARS) {
      flush();
      current = { text: [blockText], heading: block.heading, length: blockText.length };
      // Code blocks are atomic: a single oversized block was already split
      // by hardSplit on flush; never merge code with the next paragraph.
      if (block.kind === "code") flush();
      continue;
    }
    current.text.push(blockText);
    current.length = wouldLength;
  }
  flush();
  return drafts;
}

/** Pack plain (non-markdown) text by blank-line paragraphs. */
function packPlain(text: string): ChunkDraft[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0);
  const drafts: ChunkDraft[] = [];
  let buffer: string[] = [];
  let length = 0;
  const flush = () => {
    const joined = buffer.join("\n\n").trim();
    if (joined.length > 0) {
      for (const piece of hardSplit(joined)) drafts.push({ text: piece, heading: undefined });
    }
    buffer = [];
    length = 0;
  };
  for (const paragraph of paragraphs) {
    if (length + paragraph.length + 2 > MAX_CHUNK_CHARS) flush();
    buffer.push(paragraph);
    length += paragraph.length + 2;
  }
  flush();
  return drafts;
}

/** Markdown detection: any ATX heading or fenced code block. */
function looksLikeMarkdown(text: string): boolean {
  return /^#{1,6}\s+\S/m.test(text) || /^\s*(```|~~~)/m.test(text);
}

export interface ChunkDocumentInput {
  documentId: string;
  sourceId: string;
  baseId: string;
  title: string;
  location: string;
  content: string;
  updatedAt: number;
}

/**
 * Chunk a document's extracted text into records with stable ids:
 * `<documentId>:<ordinal>`. Chunks below MIN_CHUNK_CHARS merge forward into
 * the next chunk when possible (noise reduction, not content loss).
 */
export function chunkDocument(input: ChunkDocumentInput): KnowledgeChunkRecord[] {
  const drafts = looksLikeMarkdown(input.content)
    ? packBlocks(markdownBlocks(input.content))
    : packPlain(input.content);
  const merged: ChunkDraft[] = [];
  for (const draft of drafts) {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.heading === draft.heading &&
      previous.text.length < MIN_CHUNK_CHARS &&
      previous.text.length + draft.text.length + 1 <= MAX_CHUNK_CHARS
    ) {
      previous.text = `${previous.text}\n${draft.text}`;
      continue;
    }
    merged.push({ ...draft });
  }
  return merged.map((draft, ordinal) => ({
    id: `${input.documentId}:${ordinal}`,
    documentId: input.documentId,
    sourceId: input.sourceId,
    baseId: input.baseId,
    ordinal,
    text: draft.text,
    ...(draft.heading ? { heading: draft.heading } : {}),
    updatedAt: input.updatedAt,
  }));
}

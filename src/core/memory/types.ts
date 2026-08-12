import { z } from "zod";

export const memoryTypeSchema = z.enum(["conversation", "workspace", "long-term"]);
export const memorySourceKindSchema = z.enum(["manual", "model-suggested"]);
export const memorySensitivitySchema = z.enum(["standard", "sensitive"]);

export const memorySourceSchema = z
  .object({
    kind: memorySourceKindSchema,
    conversationId: z.string().min(1).optional(),
    messageIds: z.array(z.string().min(1)).max(20).default([]),
  })
  .strict();

export const memoryRecordSchema = z
  .object({
    id: z.string().min(1),
    type: memoryTypeSchema,
    scope: z.string().min(1),
    key: z.string().trim().min(1).max(80),
    content: z.string().trim().min(1).max(4_000),
    source: memorySourceSchema.default({ kind: "manual", messageIds: [] }),
    confidence: z.number().min(0).max(1).default(1),
    sensitivity: memorySensitivitySchema.default("standard"),
    enabled: z.boolean().default(true),
    pinned: z.boolean().default(false),
    revision: z.number().int().positive().default(1),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    lastUsedAt: z.number().int().nonnegative().optional(),
    expiresAt: z.number().int().positive().optional(),
  })
  .strict();

export type MemoryType = z.infer<typeof memoryTypeSchema>;
export type MemorySource = z.infer<typeof memorySourceSchema>;
export type MemorySensitivity = z.infer<typeof memorySensitivitySchema>;
export type MemoryRecord = z.infer<typeof memoryRecordSchema>;

export interface CreateMemoryInput {
  type: MemoryType;
  scope: string;
  key: string;
  content: string;
  source?: MemorySource;
  confidence?: number;
  sensitivity?: MemorySensitivity;
  expiresAt?: number;
  pinned?: boolean;
}

export interface UpdateMemoryInput {
  key?: string;
  content?: string;
  confidence?: number;
  sensitivity?: MemorySensitivity;
  expiresAt?: number | null;
  pinned?: boolean;
  enabled?: boolean;
}

export function parseMemoryRecord(value: unknown): MemoryRecord | null {
  const parsed = memoryRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

import { z } from "zod";

/**
 * Browser Annotation model (§36–38). The picker reports DOM metadata — role,
 * accessible-ish name, bounding box and a best-effort selector — never a
 * bare fragile CSS selector alone.
 */

export interface AnnotationBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const annotationPayloadSchema = z.object({
  url: z.string().min(1),
  tag: z.string().min(1),
  id: z.string().nullable().optional(),
  classes: z.string().nullable().optional(),
  role: z.string().nullable().optional(),
  ariaLabel: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  text: z.string().nullable().optional(),
  box: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
  selector: z.string().min(1),
});

export type AnnotationPayload = z.infer<typeof annotationPayloadSchema>;

export function parseAnnotationPayload(value: unknown): AnnotationPayload | null {
  const parsed = annotationPayloadSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Human-readable element description: `button "登录" (#login)`. */
export function describeAnnotationElement(payload: AnnotationPayload): string {
  const identity =
    payload.ariaLabel?.trim() ||
    payload.text?.trim() ||
    payload.name?.trim() ||
    payload.role?.trim() ||
    "";
  const idPart = payload.id ? `#${payload.id}` : "";
  const classPart =
    !idPart && payload.classes
      ? `.${payload.classes.trim().split(/\s+/).slice(0, 2).join(".")}`
      : "";
  const label = identity ? ` "${identity}"` : "";
  return `${payload.tag}${label}${idPart}${classPart}`;
}

/**
 * Prefill draft for the composer after an annotation: a Browser Feedback
 * block with URL + element pinned to facts, leaving the comment for the
 * user (§37). The page URL is also implicit workspace context.
 */
export function formatAnnotationDraft(
  payload: AnnotationPayload,
  labels: { header: string; url: string; element: string; box: string; comment: string },
): string {
  const lines = [
    labels.header,
    `${labels.url}: ${payload.url}`,
    `${labels.element}: ${describeAnnotationElement(payload)}`,
    `${labels.box}: ${payload.box.width}×${payload.box.height} @ (${payload.box.x}, ${payload.box.y})`,
    `${labels.comment}: `,
  ];
  return lines.join("\n");
}

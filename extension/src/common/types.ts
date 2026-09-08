import { z } from "zod";

// ==========================================
// 1. PageState Schema
// ==========================================

export const PerceptionSourceSchema = z.enum(["dom", "a11y", "ocr", "vision", "cv"]);
export type PerceptionSource = z.infer<typeof PerceptionSourceSchema>;

export const BoundingBoxSchema = z.tuple([
  z.number(), // x
  z.number(), // y
  z.number(), // width
  z.number(), // height
]);
export type BoundingBox = z.infer<typeof BoundingBoxSchema>;

export const PageElementSchema = z.object({
  target_id: z.string().min(1, "target_id cannot be empty"),
  role: z.string(),
  text: z.string(),
  bbox: BoundingBoxSchema,
  confidence: z.number().min(0).max(1).default(1.0),
  sensitive: z.boolean().default(false),
  task_relevance: z.number().min(0).max(1).default(0.0),
  sources: z.array(PerceptionSourceSchema).min(1),
  interactable: z.boolean().optional().default(true),
  metadata: z.record(z.unknown()).optional(),
});
export type PageElement = z.infer<typeof PageElementSchema>;

export const ViewportSchema = z.object({
  width: z.number(),
  height: z.number(),
  scrollX: z.number().default(0),
  scrollY: z.number().default(0),
});
export type Viewport = z.infer<typeof ViewportSchema>;

export const PageStateSchema = z.object({
  url: z.string(),
  title: z.string().default(""),
  timestamp: z.number().default(() => Date.now()),
  viewport: ViewportSchema.optional(),
  elements: z.array(PageElementSchema),
});
export type PageState = z.infer<typeof PageStateSchema>;

// ==========================================
// 2. Action Schema
// ==========================================

export const ActionTypeSchema = z.enum(["click", "type", "scroll", "select", "navigate"]);
export type ActionType = z.infer<typeof ActionTypeSchema>;

export const ScrollDeltaSchema = z.object({
  x: z.number().default(0),
  y: z.number().default(0),
});
export type ScrollDelta = z.infer<typeof ScrollDeltaSchema>;

export const ActionSchema = z.object({
  action: ActionTypeSchema,
  target_id: z.string().min(1, "target_id cannot be empty"),
  reason: z.string(),
  value: z.string().optional(),
  delta: ScrollDeltaSchema.optional(),
  url: z.string().optional(),
  confidence: z.number().min(0).max(1).default(1.0),
});
export type Action = z.infer<typeof ActionSchema>;

// ==========================================
// 3. Disclosure Schema
// ==========================================

export const DisclosureLevelSchema = z.enum(["L0", "L1", "L2", "L3"]);
export type DisclosureLevel = z.infer<typeof DisclosureLevelSchema>;

export const DisclosedElementSchema = z.object({
  target_id: z.string(),
  role: z.string(),
  label: z.string(),
  bbox: BoundingBoxSchema.optional(),
});
export type DisclosedElement = z.infer<typeof DisclosedElementSchema>;

export const DisclosureSchema = z.object({
  level: DisclosureLevelSchema,
  reason: z.string(),
  task: z.string().optional(),
  elements: z.array(DisclosedElementSchema),
  crop_box: BoundingBoxSchema.optional(),
  screenshot_data: z.string().optional(), // base64 encoded sanitized image
  redacted_token_count: z.number().int().nonnegative().optional().default(0),
});
export type Disclosure = z.infer<typeof DisclosureSchema>;

// ==========================================
// 4. Action Validator Result
// ==========================================

export const ValidationStatusSchema = z.enum(["ALLOW", "CONFIRM", "BLOCK"]);
export type ValidationStatus = z.infer<typeof ValidationStatusSchema>;

export const ValidationResultSchema = z.object({
  status: ValidationStatusSchema,
  action: ActionSchema,
  reason: z.string(),
  warnings: z.array(z.string()).default([]),
});
export type ValidationResult = z.infer<typeof ValidationResultSchema>;

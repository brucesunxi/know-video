import { z } from "zod";

const narrationVoiceSchema = z.enum(["male-clear", "male-deep", "female-natural"]);
const sceneStructureSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("set-duration"), sceneNumber: z.number().int().positive(), durationSeconds: z.number().int().min(2).max(20) }),
  z.object({ operation: z.literal("move"), sceneNumber: z.number().int().positive(), direction: z.enum(["earlier", "later"]) }),
  z.object({ operation: z.literal("move-to"), sceneNumber: z.number().int().positive(), targetSceneNumber: z.number().int().positive() }),
  z.object({ operation: z.literal("duplicate"), sceneNumber: z.number().int().positive() }),
  z.object({ operation: z.literal("delete"), sceneNumber: z.number().int().positive() })
]);

export const editSideSchema = z.object({
  title: z.string().min(1).max(240),
  voiceover: z.string().min(1).max(4000).optional(),
  narrationVoice: narrationVoiceSchema.optional(),
  thumbnailTone: z.string().min(1).max(80),
  visualPrompt: z.string().min(1).max(8000),
  motionPrompt: z.string().min(1).max(4000).optional()
});

export const editPlanObjectSchema = z.object({
  id: z.string().min(1).max(200),
  editNumber: z.number().int().positive(),
  baseVersionId: z.string().min(1).max(200),
  status: z.enum(["proposed", "approved", "rejected", "applied"]),
  userRequest: z.string().min(1).max(4000),
  summary: z.string().min(1).max(4000),
  affectedScenes: z.array(z.number().int().positive()).max(20),
  changes: z.array(z.object({
    sceneNumber: z.number().int().positive(),
    status: z.enum(["updated", "added", "deleted", "unchanged"]),
    before: editSideSchema,
    after: editSideSchema,
    regenerate: z.array(z.enum(["image", "audio", "clip", "thumbnail", "caption", "render"]))
  })).max(20),
  productionSettings: z.object({
    captionsEnabled: z.boolean().optional(),
    captionStyle: z.enum(["minimal", "boxed", "highlight"]).optional(),
    playbackRate: z.union([z.literal(0.75), z.literal(1), z.literal(1.25), z.literal(1.5)]).optional(),
    musicVolume: z.number().min(0).max(0.5).optional(),
    logoPosition: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]).optional(),
    logoSize: z.number().min(6).max(24).optional()
  }).optional(),
  sceneStructure: sceneStructureSchema.optional(),
  createdAt: z.string().min(1).max(100)
});

export const editPlanSchema = editPlanObjectSchema.refine((plan) => plan.changes.length > 0 || Object.keys(plan.productionSettings ?? {}).length > 0 || Boolean(plan.sceneStructure), {
  message: "修改方案必须包含场景变化或成片设置。"
});

import { z } from "zod";

const narrationVoiceSchema = z.enum(["male-clear", "male-deep", "female-natural"]);
const sceneTargetSchema = {
  sceneNumber: z.number().int().positive(),
  sceneId: z.string().uuid().optional()
};
const referenceAssetSchema = z.object({
  key: z.string().min(1).max(800),
  name: z.string().min(1).max(240),
  size: z.number().int().positive().max(500_000_000),
  contentType: z.string().min(1).max(120),
  analysis: z.string().max(8000).optional(),
  analysisKind: z.enum(["visual", "transcript"]).optional(),
  derivedFrom: z.string().min(1).max(240).optional(),
  referenceRole: z.literal("video-poster").optional(),
  actualDurationSeconds: z.number().positive().max(21_600).optional(),
  targetSceneNumber: z.number().int().positive().optional(),
  targetSceneNumbers: z.array(z.number().int().positive()).max(20).optional(),
  referenceUsage: z.literal("source-media").optional()
});
const sceneStructureSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("set-duration"), ...sceneTargetSchema, durationSeconds: z.number().int().min(2).max(20) }),
  z.object({
    operation: z.literal("set-transition"),
    ...sceneTargetSchema,
    kind: z.enum(["auto", "cut", "dissolve", "push-left", "push-right", "zoom", "wipe"]),
    durationSeconds: z.number().min(0).max(1.2)
  }),
  z.object({ operation: z.literal("set-visual"), ...sceneTargetSchema, assetId: z.string().uuid() }),
  z.object({ operation: z.literal("move"), ...sceneTargetSchema, direction: z.enum(["earlier", "later"]) }),
  z.object({
    operation: z.literal("move-to"),
    ...sceneTargetSchema,
    targetSceneNumber: z.number().int().positive(),
    targetSceneId: z.string().uuid().optional()
  }),
  z.object({ operation: z.literal("split"), ...sceneTargetSchema }),
  z.object({ operation: z.literal("merge-next"), ...sceneTargetSchema }),
  z.object({ operation: z.literal("duplicate"), ...sceneTargetSchema }),
  z.object({
    operation: z.literal("insert"),
    ...sceneTargetSchema,
    placement: z.enum(["before", "after"]),
    scene: z.object({
      title: z.string().min(1).max(240),
      voiceover: z.string().min(1).max(4000),
      visualPrompt: z.string().min(1).max(8000),
      motionPrompt: z.string().min(1).max(4000),
      durationSeconds: z.number().int().min(2).max(20)
    })
  }),
  z.object({ operation: z.literal("delete"), ...sceneTargetSchema })
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
  referenceAssets: z.array(referenceAssetSchema).max(12).optional(),
  productionSettings: z.object({
    captionsEnabled: z.boolean().optional(),
    captionStyle: z.enum(["minimal", "boxed", "highlight"]).optional(),
    playbackRate: z.union([z.literal(0.75), z.literal(1), z.literal(1.25), z.literal(1.5)]).optional(),
    musicVolume: z.number().min(0).max(0.5).optional(),
    musicDucking: z.enum(["off", "balanced", "strong"]).optional(),
    logoPosition: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]).optional(),
    logoSize: z.number().min(6).max(24).optional()
  }).optional(),
  operations: z.array(sceneStructureSchema).min(1).max(20).optional(),
  sceneStructure: sceneStructureSchema.optional(),
  createdAt: z.string().min(1).max(100)
});

export const editPlanSchema = editPlanObjectSchema.refine((plan) => plan.changes.length > 0 || Object.keys(plan.productionSettings ?? {}).length > 0 || Boolean(plan.operations?.length) || Boolean(plan.sceneStructure), {
  message: "修改方案必须包含场景变化或成片设置。"
});

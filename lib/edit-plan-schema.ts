import { z } from "zod";

export const editSideSchema = z.object({
  title: z.string().min(1).max(240),
  voiceover: z.string().min(1).max(4000).optional(),
  thumbnailTone: z.string().min(1).max(80),
  visualPrompt: z.string().min(1).max(8000),
  motionPrompt: z.string().min(1).max(4000).optional()
});

export const editPlanSchema = z.object({
  id: z.string().min(1).max(200),
  editNumber: z.number().int().positive(),
  baseVersionId: z.string().min(1).max(200),
  status: z.enum(["proposed", "approved", "rejected", "applied"]),
  userRequest: z.string().min(1).max(4000),
  summary: z.string().min(1).max(4000),
  affectedScenes: z.array(z.number().int().positive()).min(1).max(20),
  changes: z.array(z.object({
    sceneNumber: z.number().int().positive(),
    status: z.enum(["updated", "added", "deleted", "unchanged"]),
    before: editSideSchema,
    after: editSideSchema,
    regenerate: z.array(z.enum(["image", "audio", "clip", "thumbnail", "caption", "render"]))
  })).min(1).max(20),
  createdAt: z.string().min(1).max(100)
});

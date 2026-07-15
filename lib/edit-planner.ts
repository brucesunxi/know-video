import { z } from "zod";
import type { EditPlan, ProjectVersion } from "@/lib/types";

export const editPlanSchema = z.object({
  summary: z.string(),
  affectedScenes: z.array(z.number().int().positive()),
  changes: z.array(
    z.object({
      sceneNumber: z.number().int().positive(),
      status: z.enum(["updated", "added", "deleted", "unchanged"]),
      before: z.object({
        title: z.string(),
        voiceover: z.string().optional(),
        thumbnailTone: z.string(),
        visualPrompt: z.string()
      }),
      after: z.object({
        title: z.string(),
        voiceover: z.string().optional(),
        thumbnailTone: z.string(),
        visualPrompt: z.string()
      }),
      regenerate: z.array(z.enum(["image", "audio", "clip", "thumbnail", "caption", "render"]))
    })
  )
});

export function buildMockEditPlan(params: {
  request: string;
  version: ProjectVersion;
  editNumber: number;
}): EditPlan {
  const lower = params.request.toLowerCase();
  const wantsLight = lower.includes("light") || lower.includes("bright") || lower.includes("浅色");
  const tone = wantsLight ? "light" : "dark";

  return {
    id: `edit-plan-${params.editNumber}`,
    editNumber: params.editNumber,
    baseVersionId: params.version.id,
    status: "proposed",
    userRequest: params.request,
    summary: wantsLight
      ? "Adapt the full video into a premium light SaaS console style while preserving timing, narration, and scene structure."
      : "Prepare a targeted scene-level edit plan while preserving unrelated scenes and reusable assets.",
    affectedScenes: params.version.scenes.map((scene) => scene.sceneNumber),
    changes: params.version.scenes.map((scene) => ({
      sceneNumber: scene.sceneNumber,
      status: "updated",
      before: {
        title: scene.title,
        thumbnailTone: scene.style.theme.includes("dark") ? "dark" : "light",
        visualPrompt: scene.visualPrompt
      },
      after: {
        title: scene.title,
        thumbnailTone: tone,
        visualPrompt: wantsLight
          ? `${scene.visualPrompt} Convert to a premium light SaaS console with white surfaces, soft gray depth, and teal accents.`
          : scene.visualPrompt
      },
      regenerate: ["image", "clip", "thumbnail", "render"]
    })),
    createdAt: new Date().toISOString()
  };
}

import { z } from "zod";
import type { ProjectVersion, SceneStructureMutation } from "@/lib/types";

export const conversationOperationSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("set-duration"),
    sceneId: z.string().uuid(),
    sceneNumber: z.number().int().positive(),
    durationSeconds: z.number().int().min(2).max(20)
  }),
  z.object({
    operation: z.literal("set-transition"),
    sceneId: z.string().uuid(),
    sceneNumber: z.number().int().positive(),
    kind: z.enum(["auto", "cut", "dissolve", "push-left", "push-right", "zoom", "wipe"]),
    durationSeconds: z.number().min(0).max(1.2)
  }),
  z.object({
    operation: z.literal("move"),
    sceneId: z.string().uuid(),
    sceneNumber: z.number().int().positive(),
    direction: z.enum(["earlier", "later"])
  }),
  z.object({
    operation: z.literal("move-to"),
    sceneId: z.string().uuid(),
    sceneNumber: z.number().int().positive(),
    targetSceneId: z.string().uuid(),
    targetSceneNumber: z.number().int().positive()
  }),
  z.object({ operation: z.literal("split"), sceneId: z.string().uuid(), sceneNumber: z.number().int().positive() }),
  z.object({ operation: z.literal("merge-next"), sceneId: z.string().uuid(), sceneNumber: z.number().int().positive() }),
  z.object({ operation: z.literal("duplicate"), sceneId: z.string().uuid(), sceneNumber: z.number().int().positive() }),
  z.object({
    operation: z.literal("insert"),
    sceneId: z.string().uuid(),
    sceneNumber: z.number().int().positive(),
    placement: z.enum(["before", "after"]),
    scene: z.object({
      title: z.string().min(1).max(240),
      voiceover: z.string().min(1).max(4000),
      visualPrompt: z.string().min(1).max(8000),
      motionPrompt: z.string().min(1).max(4000),
      durationSeconds: z.number().int().min(2).max(20)
    })
  }),
  z.object({ operation: z.literal("delete"), sceneId: z.string().uuid(), sceneNumber: z.number().int().positive() })
]);

export const conversationEditProgramSchema = z.object({
  classification: z.enum(["timeline", "content", "mixed", "production", "clarify"]),
  understoodRequest: z.string().min(1).max(1000),
  operations: z.array(conversationOperationSchema).max(20),
  directAction: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("visual-candidate"),
      sceneId: z.string().uuid(),
      sceneNumber: z.number().int().positive(),
      instruction: z.string().min(1).max(4000)
    }),
    z.object({ kind: z.literal("restore-parent-version") })
  ]).optional(),
  projectTitle: z.string().trim().min(1).max(160).optional(),
  productionAssets: z.object({
    logo: z.enum(["attach-upload", "remove"]).optional(),
    music: z.enum(["attach-upload", "remove"]).optional()
  }).optional(),
  productionSettings: z.object({
    captionsEnabled: z.boolean().optional(),
    captionStyle: z.enum(["minimal", "boxed", "highlight"]).optional(),
    playbackRate: z.union([z.literal(0.75), z.literal(1), z.literal(1.25), z.literal(1.5)]).optional(),
    musicVolume: z.number().min(0).max(0.5).optional(),
    musicDucking: z.enum(["off", "balanced", "strong"]).optional(),
    logoPosition: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]).optional(),
    logoSize: z.number().min(6).max(24).optional()
  }).optional(),
  remainingInstruction: z.string().max(4000),
  clarification: z.string().max(500).optional(),
  confidence: z.number().min(0).max(1)
});

export type ConversationEditProgram = z.infer<typeof conversationEditProgramSchema>;
export type ConversationDirectAction = NonNullable<ConversationEditProgram["directAction"]>;

export function canonicalConversationOperations(
  program: ConversationEditProgram,
  version: Pick<ProjectVersion, "scenes">
): SceneStructureMutation[] {
  const scenesById = new Map(version.scenes.map((scene) => [scene.id, scene]));
  return program.operations.map((operation) => {
    const scene = scenesById.get(operation.sceneId);
    if (!scene) throw new Error("AI edit program referenced a scene outside the current version");
    if (operation.operation !== "move-to") {
      return { ...operation, sceneNumber: scene.sceneNumber } as SceneStructureMutation;
    }
    const target = scenesById.get(operation.targetSceneId);
    if (!target) throw new Error("AI edit program referenced an invalid destination scene");
    return {
      ...operation,
      sceneNumber: scene.sceneNumber,
      targetSceneNumber: target.sceneNumber
    };
  });
}

export function canonicalConversationDirectAction(
  action: ConversationDirectAction | undefined,
  version: Pick<ProjectVersion, "scenes">
): ConversationDirectAction | undefined {
  if (!action) return undefined;
  if (action.kind === "restore-parent-version") return action;
  const scene = version.scenes.find((item) => item.id === action.sceneId);
  if (!scene) throw new Error("AI edit program referenced a direct-action scene outside the current version");
  return { ...action, sceneNumber: scene.sceneNumber };
}

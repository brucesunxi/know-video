import type { EditPlan, ProjectVersion, SceneStructureMutation } from "@/lib/types";

export function editPlanOperations(plan: Pick<EditPlan, "operations" | "sceneStructure">) {
  if (plan.operations?.length) return plan.operations;
  return plan.sceneStructure ? [plan.sceneStructure] : [];
}

export function bindOperationSceneIds(
  operations: SceneStructureMutation[],
  version: Pick<ProjectVersion, "scenes">
) {
  const sceneIdByNumber = new Map(version.scenes.map((scene) => [scene.sceneNumber, scene.id]));
  return operations.map((operation) => {
    const sceneId = operation.sceneId ?? sceneIdByNumber.get(operation.sceneNumber);
    if (operation.operation !== "move-to") return { ...operation, sceneId };
    return {
      ...operation,
      sceneId,
      targetSceneId: operation.targetSceneId ?? sceneIdByNumber.get(operation.targetSceneNumber)
    };
  });
}

export function affectedSceneNumbersForOperations(operations: SceneStructureMutation[]) {
  return Array.from(new Set(operations.flatMap((operation) => (
    operation.operation === "merge-next"
      ? [operation.sceneNumber, operation.sceneNumber + 1]
      : operation.operation === "move-to"
        ? [operation.sceneNumber, operation.targetSceneNumber]
        : operation.operation === "insert"
          ? [operation.sceneNumber]
        : [operation.sceneNumber]
  )))).sort((left, right) => left - right);
}

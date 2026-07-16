import type { EditPlan } from "@/lib/types";

export function materializeEditProposal(
  editPlan: EditPlan,
  versionId: string,
  createId: () => string = crypto.randomUUID
) {
  const planId = createId();
  return {
    planId,
    userMessageId: createId(),
    assistantMessageId: createId(),
    editPlan: {
      ...editPlan,
      id: planId,
      baseVersionId: versionId,
      status: "proposed" as const
    }
  };
}

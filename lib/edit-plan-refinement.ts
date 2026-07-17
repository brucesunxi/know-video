import { extractRequestedSceneNumbers } from "@/lib/edit-intent";
import type { EditPlan, ProjectVersion } from "@/lib/types";

export function refineEditPlanScope(params: {
  request: string;
  version: ProjectVersion;
  existingPlan: EditPlan;
  editNumber: number;
}) {
  const available = params.version.scenes.map((scene) => scene.sceneNumber);
  const requested = extractRequestedSceneNumbers(params.request, available);
  if (requested.length === 0 || params.existingPlan.sceneStructure) return undefined;
  if (/(?:但|同时|并且|另外|以及|再把|and|while|also)/iu.test(params.request)) return undefined;

  const requestedSet = new Set(requested);
  const onlyRequested = /(?:只|仅)(?:需要|保留|修改|调整|改)|only/iu.test(params.request);
  const excludeRequested = /(?:不要|别|无需|取消).{0,12}(?:改|修改|调整)|(?:排除|剔除)|(?:保持|保留).{0,12}(?:不变|原样)|leave.{0,12}(?:unchanged|as is)|exclude/iu.test(params.request);
  if (!onlyRequested && !excludeRequested) return undefined;

  const changes = params.existingPlan.changes.filter((change) => (
    onlyRequested ? requestedSet.has(change.sceneNumber) : !requestedSet.has(change.sceneNumber)
  ));
  if (changes.length === 0) {
    throw new Error("这条补充会移除方案中的全部修改；如需放弃当前方案，请点击“取消”。");
  }
  const combinedRequest = `${params.existingPlan.userRequest}\n补充要求：${params.request}`;
  return {
    ...params.existingPlan,
    id: crypto.randomUUID(),
    editNumber: params.editNumber,
    userRequest: combinedRequest,
    summary: onlyRequested
      ? `按补充要求，仅保留场景 ${changes.map((change) => change.sceneNumber).join("、")} 的修改。`
      : `按补充要求，场景 ${requested.join("、")} 保持不变，其余计划继续保留。`,
    affectedScenes: changes.map((change) => change.sceneNumber),
    changes,
    status: "proposed" as const,
    createdAt: new Date().toISOString()
  } satisfies EditPlan;
}

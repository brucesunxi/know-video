import { extractRequestedSceneNumbers } from "@/lib/edit-intent";
import { isDeliverableVisualAsset, sceneHasAudioAsset, sceneHasVisualAsset } from "@/lib/generation-resume";
import type { ProjectVersion, Scene } from "@/lib/types";

const diagnosticLanguage = (request: string) => /[\u3400-\u9fff]/u.test(request) ? "zh" : "en";

export function isReadOnlySceneDiagnosticRequest(request: string) {
  const diagnostic = /怎么(?:了|回事)|什么情况|检查(?:一下)?|查看(?:一下)?|看(?:一)?下|正常吗|有问题吗|(?:当前)?状态|what(?:'s| is) wrong|what happened|check|inspect|status/iu.test(request);
  const mutation = /(?:请|帮我|给我|把|将|麻烦).{0,20}(?:改|修改|调整|重做|重新生成|生成|替换|删除|移除|添加|增加|切换|应用)|^(?:改|修改|调整|重做|重新生成|生成|替换|删除|移除|添加|增加|切换|应用)|\b(?:please|can you|could you)\b.{0,30}\b(?:change|modify|adjust|redo|regenerate|generate|replace|delete|remove|add|apply|switch)\b/iu.test(request);
  return diagnostic && !mutation;
}

export function diagnosticScene(
  request: string,
  version: ProjectVersion,
  selectedSceneNumber?: number
) {
  const available = version.scenes.map((scene) => scene.sceneNumber);
  const requested = extractRequestedSceneNumbers(request, available);
  const sceneNumber = requested[0] ?? selectedSceneNumber;
  return version.scenes.find((scene) => scene.sceneNumber === sceneNumber);
}

function rejectedVisualReason(scene: Scene) {
  const rejected = scene.assets.filter((asset) =>
    ["image", "clip"].includes(asset.type) && Boolean(asset.url) && !isDeliverableVisualAsset(asset)
  );
  if (rejected.length === 0) return false;
  return rejected.some((asset) => asset.metadata?.qualityFallback === true)
    ? "quality"
    : "fallback";
}

export function sceneDiagnosticMessage(scene: Scene, request: string) {
  const language = diagnosticLanguage(request);
  const hasVisual = sceneHasVisualAsset(scene);
  const hasAudio = sceneHasAudioAsset(scene);
  const hasMotion = scene.assets.some((asset) => asset.type === "clip" && isDeliverableVisualAsset(asset));
  const rejectedReason = rejectedVisualReason(scene);

  if (language === "en") {
    const visual = hasVisual
      ? "The visual is ready"
      : rejectedReason
        ? "The previous visual did not pass the delivery quality check and is no longer treated as complete"
        : "The visual has not been generated or saved successfully";
    const narration = hasAudio ? "narration is ready" : "narration is missing";
    const motion = hasMotion ? "a motion clip is ready" : "motion is optional and has not been generated";
    return `Scene ${scene.sceneNumber}, “${scene.title}”: ${visual}; ${narration}; ${motion}. This check did not modify the scene or create a new version.${hasVisual ? "" : " Use “Generate missing visual” to retry only this scene."}`;
  }

  const visual = hasVisual
    ? "画面已就绪"
    : rejectedReason
      ? "之前的画面没有通过成片质量检查，现已不再被当作完成素材"
      : "画面尚未成功生成或保存";
  const narration = hasAudio ? "配音已就绪" : "配音缺失";
  const motion = hasMotion ? "动态片段已就绪" : "动态效果尚未生成，但它不影响静态画面成片";
  return `场景 ${scene.sceneNumber}《${scene.title}》当前状态：${visual}；${narration}；${motion}。本次检查没有修改场景，也没有创建新版本。${hasVisual ? "" : "请点击“生成缺失画面”，系统只会重试这个场景。"}`;
}

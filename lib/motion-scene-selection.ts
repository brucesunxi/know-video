import type { Scene } from "@/lib/types";

const actionTerms = [
  "accelerate", "assemble", "burst", "collide", "drift", "emerge", "expand", "explode", "flow", "fly",
  "move", "open", "orbit", "pour", "rise", "rotate", "scatter", "slide", "spin", "split", "sweep", "transform",
  "穿梭", "冲出", "分裂", "升起", "展开", "旋转", "流动", "涌现", "爆发", "移动", "组装", "飞入"
];
const cameraTerms = [
  "arc", "camera", "crane", "dolly", "drone", "handheld", "orbit", "pan", "push", "rack focus", "tilt", "tracking", "zoom",
  "变焦", "俯冲", "升降", "推进", "推近", "摇摄", "环绕", "跟拍", "镜头", "运镜"
];
const closingTerms = [
  "call to action", "closing", "end card", "final logo", "logo lockup", "outro",
  "品牌收束", "片尾", "结束", "结尾", "行动号召", "落版"
];

function termHits(text: string, terms: string[]) {
  return terms.reduce((total, term) => total + (text.includes(term) ? 1 : 0), 0);
}

export function motionSceneLimit(_durationSeconds: number, _sceneCount: number) {
  return 1;
}

export function motionSceneScore(scene: Scene, sceneCount: number) {
  const motion = scene.motionPrompt.toLowerCase();
  const visual = scene.visualPrompt.toLowerCase();
  const title = scene.title.toLowerCase();
  const combined = `${title} ${motion} ${visual}`;
  const actionScore = termHits(combined, actionTerms) * 4;
  const cameraScore = termHits(motion, cameraTerms) * 3;
  const detailScore = Math.min(4, Math.floor(motion.length / 90));
  const durationScore = Math.min(3, Math.max(0, Math.round(scene.durationSeconds) - 3));
  const closingPenalty = termHits(`${title} ${visual}`, closingTerms) > 0 ? 12 : 0;
  const staticPenalty = /static|still frame|locked shot|静止|定格/.test(motion) ? 8 : 0;
  const edgePenalty = sceneCount > 2 && (scene.sceneNumber === 1 || scene.sceneNumber === sceneCount) ? 1 : 0;
  return actionScore + cameraScore + detailScore + durationScore - closingPenalty - staticPenalty - edgePenalty;
}

export function selectMotionCriticalScenes(scenes: Scene[], durationSeconds: number) {
  const candidates = scenes.filter((scene) => scene.assets.some((asset) => asset.type === "image" && asset.url));
  const limit = Math.min(candidates.length, motionSceneLimit(durationSeconds, scenes.length));
  return candidates
    .map((scene, index) => ({
      sceneNumber: scene.sceneNumber,
      score: motionSceneScore(scene, scenes.length),
      index
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map((candidate) => candidate.sceneNumber);
}

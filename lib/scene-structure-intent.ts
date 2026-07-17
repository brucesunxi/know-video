import { extractRequestedSceneNumbers } from "@/lib/edit-intent";
import type { SceneStructureMutation } from "@/lib/types";

export function requestsSceneStructureChange(request: string) {
  return /(?:删除|移除|去掉|复制|克隆|向前|往前|前移|向后|往后|后移|移动到|移到|放到|拖到|场景时长|镜头时长|改成\s*\d+\s*秒|调整为\s*\d+\s*秒).{0,12}(?:场景|镜头|章节|位置|位)|(?:场景|镜头|章节).{0,12}(?:删除|移除|去掉|复制|克隆|向前|往前|前移|向后|往后|后移|移动到|移到|放到|拖到|\d+\s*秒)/u.test(request);
}

export function sceneStructureFromRequest(
  request: string,
  availableSceneNumbers: number[]
): SceneStructureMutation | undefined {
  const moveTo = request.match(/(?:第\s*)?(\d{1,2})\s*(?:个)?(?:场景|镜头|章节).{0,12}?(?:移动到|移到|放到|拖到).{0,8}?(?:第\s*)?(\d{1,2})\s*(?:个)?(?:场景|镜头|章节|位置|位)/u)
    ?? request.match(/(?:把|将).{0,6}?(?:场景|镜头|章节)\s*(\d{1,2}).{0,12}?(?:移动到|移到|放到|拖到).{0,8}?(?:场景|镜头|章节|位置|第)\s*(\d{1,2})/u);
  if (moveTo) {
    const sceneNumber = Number(moveTo[1]);
    const targetSceneNumber = Number(moveTo[2]);
    if (availableSceneNumbers.includes(sceneNumber) && availableSceneNumbers.includes(targetSceneNumber)) {
      return { operation: "move-to", sceneNumber, targetSceneNumber };
    }
    return undefined;
  }
  const sceneNumbers = extractRequestedSceneNumbers(request, availableSceneNumbers);
  if (sceneNumbers.length !== 1) return undefined;
  const sceneNumber = sceneNumbers[0];

  if (/(?:删除|移除|去掉).{0,10}(?:场景|镜头|章节)|(?:场景|镜头|章节).{0,10}(?:删除|移除|去掉)/u.test(request)) {
    return { operation: "delete", sceneNumber };
  }
  if (/(?:复制|克隆).{0,10}(?:场景|镜头|章节)|(?:场景|镜头|章节).{0,10}(?:复制|克隆)/u.test(request)) {
    return { operation: "duplicate", sceneNumber };
  }

  const duration = request.match(/(?:时长|长度|改成|调整为|设为).{0,8}?(\d{1,2})\s*秒/u)
    ?? request.match(/(?:场景|镜头|章节).{0,12}?(\d{1,2})\s*秒/u);
  if (duration) {
    const durationSeconds = Number(duration[1]);
    if (durationSeconds >= 2 && durationSeconds <= 20) {
      return { operation: "set-duration", sceneNumber, durationSeconds };
    }
  }

  if (/(?:向前|往前|前移|提前|移到前面)/u.test(request)) {
    return { operation: "move", sceneNumber, direction: "earlier" };
  }
  if (/(?:向后|往后|后移|延后|移到后面)/u.test(request)) {
    return { operation: "move", sceneNumber, direction: "later" };
  }
  return undefined;
}

export function sceneStructureSummary(mutation: SceneStructureMutation) {
  if (mutation.operation === "set-duration") return `将场景 ${mutation.sceneNumber} 的时长调整为 ${mutation.durationSeconds} 秒。`;
  if (mutation.operation === "move") return `将场景 ${mutation.sceneNumber} 向${mutation.direction === "earlier" ? "前" : "后"}移动一位，并自动重新编号。`;
  if (mutation.operation === "move-to") return `将场景 ${mutation.sceneNumber} 移动到第 ${mutation.targetSceneNumber} 位，并自动重新编号。`;
  if (mutation.operation === "duplicate") return `复制场景 ${mutation.sceneNumber} 到下一位置，并自动重新编号。`;
  return `从当前版本删除场景 ${mutation.sceneNumber}，并自动重新编号。`;
}

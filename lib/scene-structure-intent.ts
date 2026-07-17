import { extractRequestedSceneNumbers } from "@/lib/edit-intent";
import type { SceneStructureMutation } from "@/lib/types";

export function requestsSceneStructureChange(request: string) {
  if (/(?:转场|硬切|叠化|溶解|淡入淡出|左推|右推|缩放转场|变焦转场|擦除|划像|wipe|crossfade)/iu.test(request)
    && /(?:第\s*)?\d{1,2}\s*(?:个)?(?:场景|镜头|章节)/u.test(request)) return true;
  return /(?:删除|移除|去掉|复制|克隆|拆分|拆开|拆成|切分|合并|合在一起|向前|往前|前移|向后|往后|后移|移动到|移到|放到|拖到|场景时长|镜头时长|改成\s*\d+\s*秒|调整为\s*\d+\s*秒).{0,16}(?:场景|镜头|章节|位置|位)|(?:场景|镜头|章节).{0,16}(?:删除|移除|去掉|复制|克隆|拆分|拆开|拆成|切分|合并|合在一起|向前|往前|前移|向后|往后|后移|移动到|移到|放到|拖到|\d+\s*秒)/u.test(request);
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
  const mergePair = request.match(/(?:合并|合在一起).{0,10}?(?:第\s*)?(\d{1,2}).{0,6}?(?:和|与|及|跟|、|\+).{0,6}?(?:第\s*)?(\d{1,2})\s*(?:个)?(?:场景|镜头|章节)/u)
    ?? request.match(/(?:把|将).{0,6}?(?:第\s*)?(\d{1,2}).{0,6}?(?:和|与|及|跟|、|\+).{0,6}?(?:第\s*)?(\d{1,2})\s*(?:个)?(?:场景|镜头|章节).{0,8}?(?:合并|合在一起)/u);
  if (mergePair) {
    const sceneNumbers = [Number(mergePair[1]), Number(mergePair[2])].sort((left, right) => left - right);
    if (sceneNumbers[1] === sceneNumbers[0] + 1 && sceneNumbers.every((sceneNumber) => availableSceneNumbers.includes(sceneNumber))) {
      return { operation: "merge-next", sceneNumber: sceneNumbers[0] };
    }
    return undefined;
  }
  const mergeNext = request.match(/(?:第\s*)?(\d{1,2})\s*(?:个)?(?:场景|镜头|章节).{0,8}?(?:与|和|跟|及)?(?:后一|下一个)(?:场景|镜头|章节).{0,8}?(?:合并|合在一起)/u)
    ?? request.match(/(?:合并|合在一起).{0,8}?(?:第\s*)?(\d{1,2})\s*(?:个)?(?:场景|镜头|章节).{0,8}?(?:与|和|跟|及)?(?:后一|下一个)/u);
  if (mergeNext) {
    const sceneNumber = Number(mergeNext[1]);
    return availableSceneNumbers.includes(sceneNumber) && availableSceneNumbers.includes(sceneNumber + 1)
      ? { operation: "merge-next", sceneNumber }
      : undefined;
  }
  const sceneNumbers = extractRequestedSceneNumbers(request, availableSceneNumbers);
  if (sceneNumbers.length !== 1) return undefined;
  const sceneNumber = sceneNumbers[0];

  if (/(?:转场|硬切|叠化|溶解|淡入淡出|左推|右推|缩放|变焦|擦除|划像|wipe|crossfade|cut)/iu.test(request)) {
    if (sceneNumber === 1) return undefined;
    const kind = /(?:硬切|直接切换|\bcut\b)/iu.test(request)
      ? "cut" as const
      : /(?:叠化|溶解|淡入淡出|crossfade|dissolve)/iu.test(request)
        ? "dissolve" as const
        : /(?:向左推|左推|push[ -]?left)/iu.test(request)
          ? "push-left" as const
          : /(?:向右推|右推|push[ -]?right)/iu.test(request)
            ? "push-right" as const
            : /(?:缩放|变焦|zoom)/iu.test(request)
              ? "zoom" as const
              : /(?:擦除|划像|wipe)/iu.test(request)
                ? "wipe" as const
                : "auto" as const;
    const durationMatch = request.match(/(0?\.\d+|1(?:\.\d+)?)\s*秒/u);
    const requestedDuration = durationMatch ? Number(durationMatch[1]) : 0.5;
    const durationSeconds = kind === "cut" ? 0 : Math.min(1.2, Math.max(0.2, requestedDuration));
    return { operation: "set-transition", sceneNumber, kind, durationSeconds };
  }

  if (/(?:拆分|拆开|拆成|切分|split)/iu.test(request)) {
    return { operation: "split", sceneNumber };
  }
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
  if (mutation.operation === "set-transition") {
    const labels = { auto: "自动", cut: "硬切", dissolve: "叠化", "push-left": "向左推进", "push-right": "向右推进", zoom: "缩放", wipe: "擦除" } as const;
    return `将场景 ${mutation.sceneNumber} 的进入转场改为${labels[mutation.kind]}${mutation.kind === "cut" ? "。" : `，时长 ${mutation.durationSeconds} 秒。`}`;
  }
  if (mutation.operation === "move") return `将场景 ${mutation.sceneNumber} 向${mutation.direction === "earlier" ? "前" : "后"}移动一位，并自动重新编号。`;
  if (mutation.operation === "move-to") return `将场景 ${mutation.sceneNumber} 移动到第 ${mutation.targetSceneNumber} 位，并自动重新编号。`;
  if (mutation.operation === "split") return `按旁白语义将场景 ${mutation.sceneNumber} 拆分为两个连续镜头，重新分配时长并更新画面与配音。`;
  if (mutation.operation === "merge-next") return `将场景 ${mutation.sceneNumber} 与后一场景合并为一个镜头，并更新合并后的画面与配音。`;
  if (mutation.operation === "duplicate") return `复制场景 ${mutation.sceneNumber} 到下一位置，并自动重新编号。`;
  return `从当前版本删除场景 ${mutation.sceneNumber}，并自动重新编号。`;
}

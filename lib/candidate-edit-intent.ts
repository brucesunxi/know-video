import { extractRequestedSceneNumbers } from "@/lib/edit-intent";

export type CandidateEditIntent = {
  sceneNumber: number;
  instruction: string;
};

const defaultInstruction = "保持主体与叙事不变，优化构图、光影和空间层次，使画面更精致。";

export function candidateEditFromRequest(
  request: string,
  availableSceneNumbers: number[],
  selectedSceneNumber?: number
): CandidateEditIntent | undefined {
  const candidateRequested = /候选(?:画面|图|图片|视觉|版本)?|备选(?:画面|图|图片|视觉|版本)?|另(?:一|一个|一张)(?:画面|图片|视觉方案)|先(?:不要|别).{0,10}(?:替换|应用|采用)|(?:candidate|alternative|variant)(?:\s+(?:image|visual|frame))?/iu.test(request);
  if (!candidateRequested) return undefined;
  const sceneNumbers = extractRequestedSceneNumbers(request, availableSceneNumbers);
  if (
    sceneNumbers.length === 0
    && selectedSceneNumber
    && availableSceneNumbers.includes(selectedSceneNumber)
    && /(?:当前|这个|本|该)\s*(?:场景|镜头|章节|幕|段)|selected\s+(?:scene|shot|chapter)|current\s+(?:scene|shot|chapter)/iu.test(request)
  ) {
    sceneNumbers.push(selectedSceneNumber);
  }
  if (sceneNumbers.length !== 1) return undefined;

  const instruction = request
    .replace(/(?:请|麻烦|帮我|帮忙|给我)/gu, " ")
    .replace(/(?:为)?(?:最后|最终|结尾|片尾)(?:一个|一幕|一段)?(?:场景|镜头|章节|幕|段)/gu, " ")
    .replace(/(?:把|将|给|为)?\s*(?:当前|这个|本|该)\s*(?:场景|镜头|章节|幕|段)/gu, " ")
    .replace(/(?:把|将|给)?\s*(?:第\s*)?[0-9一二两三四五六七八九十]+\s*(?:个)?(?:场景|镜头|章节|幕|段)/gu, " ")
    .replace(/先?(?:不要|别|不).{0,6}(?:替换|应用|采用)(?:当前画面|原图|视频)?/gu, " ")
    .replace(/(?:生成|创建|做|提供|来)/gu, " ")
    .replace(/的?(?:候选|备选)(?:画面|图|图片|视觉|版本)?/gu, " ")
    .replace(/(?:^|[，,。；;：:\s])(?:一张|一个|个)(?=$|[，,。；;：:\s])/gu, " ")
    .replace(/^[，,。；;：:\s]*(?:一张|一个|个)/gu, " ")
    .replace(/(?:一张|一个|个)[，,。；;：:\s]*$/gu, " ")
    .replace(/\s+/gu, " ")
    .replace(/^[，。；：、,.!！?？\s]+|[，。；：、,.!！?？\s]+$/gu, "")
    .replace(/^的|的$/gu, "")
    .trim();

  return {
    sceneNumber: sceneNumbers[0],
    instruction: instruction || defaultInstruction
  };
}

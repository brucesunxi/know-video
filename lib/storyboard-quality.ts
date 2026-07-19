import type { GenerationOptions, Scene } from "@/lib/types";
import { extractBriefSubject, hasMetaProductionNarration, isVideoCreationProductBrief } from "@/lib/brief-semantics";

const genericSceneNames = [
  "customization",
  "user interface",
  "overview",
  "features",
  "benefits",
  "conclusion",
  "introduction"
];

const productionDetailPatterns = [
  /(?:foreground|midground|background|composition|depth|layer|left|right|center|前景|中景|背景|构图|景深|层次|左侧|右侧|中心)/iu,
  /(?:close-up|macro|wide shot|medium shot|full shot|establishing|lens|\d{2,3}\s*mm|angle|framing|特写|微距|广角|中景|全景|远景|建立镜头|焦段|机位|俯拍|仰拍)/iu,
  /(?:light|lighting|shadow|sunlight|glow|rim light|backlight|光线|灯光|照明|阴影|日光|辉光|轮廓光|逆光)/iu,
  /(?:studio|office|room|street|workplace|environment|location|interior|exterior|desk|工作室|办公室|房间|街道|工作场所|环境|空间|室内|室外|桌面)/iu,
  /(?:color|palette|material|glass|metal|wood|fabric|concrete|色彩|配色|材质|玻璃|金属|木质|织物|混凝土)/iu
];

const shotPatterns = [
  ["macro", /(?:macro|extreme close|微距|极近特写)/iu],
  ["close", /(?:close-up|close shot|特写|近景)/iu],
  ["medium", /(?:medium shot|medium close|中等景别|半身镜头|中近景)/iu],
  ["wide", /(?:wide shot|full shot|establishing|long shot|广角|全景|远景|建立镜头)/iu],
  ["overhead", /(?:overhead|top-down|bird'?s-eye|俯拍|顶视|鸟瞰)/iu],
  ["low", /(?:low angle|worm'?s-eye|低机位|仰拍)/iu]
] as const;

const finalResolvePattern = /(?:final|finish|finished|resolve|resolved|closing|complete|completed|deliver|delivery|export|launch|publish|share|start|try|book|demo|call to action|next step|outcome|result|ready|ship|交付|完成|成片|导出|发布|上线|分享|行动|下一步|预约|试用|开始|结果|成果|收束|落点|终章|准备就绪|可直接使用)/iu;

function hasChinese(value?: string) {
  return Boolean(value && /\p{Script=Han}/u.test(value));
}

function baseVisualPrompt(scene: Scene) {
  return scene.visualPrompt.split("\n")[0]?.trim() ?? "";
}

function baseMotionPrompt(scene: Scene) {
  return scene.motionPrompt.split(" Camera language:")[0]?.trim() ?? "";
}

function significantTokens(value: string) {
  const latin = value.toLowerCase().match(/[a-z0-9]+/g)?.filter((token) => token.length >= 4) ?? [];
  const han = (value.match(/\p{Script=Han}+/gu) ?? []).flatMap((part) => {
    const characters = Array.from(part);
    return characters.slice(0, -1).map((character, index) => `${character}${characters[index + 1]}`);
  });
  return new Set([...latin, ...han]);
}

function tokenSimilarity(left: string, right: string) {
  const a = significantTokens(left);
  const b = significantTokens(right);
  if (a.size < 5 || b.size < 5) return left.trim().toLowerCase() === right.trim().toLowerCase() ? 1 : 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function repeatedNarrationOpenings(scenes: Scene[]) {
  const openings = scenes.map((scene) => {
    const han = (scene.voiceover.match(/\p{Script=Han}/gu) ?? []).slice(0, 8).join("");
    if (han.length >= 6) return han;
    return (scene.voiceover.toLowerCase().match(/[a-z0-9]+/g) ?? []).slice(0, 4).join(" ");
  }).filter((opening) => opening.length >= 6);
  return new Set(openings).size !== openings.length;
}

function hasFinalResolve(scene: Scene) {
  return [
    scene.title,
    scene.voiceover,
    baseVisualPrompt(scene),
    baseMotionPrompt(scene),
    scene.style.mood
  ].some((value) => finalResolvePattern.test(value));
}

function visualPromptsRepeat(scenes: Scene[]) {
  for (let left = 0; left < scenes.length; left += 1) {
    for (let right = left + 1; right < scenes.length; right += 1) {
      if (tokenSimilarity(baseVisualPrompt(scenes[left]), baseVisualPrompt(scenes[right])) >= 0.72) return true;
    }
  }
  return false;
}

export function detectedShotVariety(scenes: Scene[]) {
  const signatures = new Set<string>();
  for (const scene of scenes) {
    const prompt = baseVisualPrompt(scene);
    const match = shotPatterns
      .map(([name, pattern]) => ({ name, index: prompt.search(pattern) }))
      .filter(({ index }) => index >= 0)
      .sort((left, right) => left.index - right.index)[0];
    if (match) signatures.add(match.name);
  }
  return signatures.size;
}

export function storyboardLooksGeneric(scenes: Array<{ title: string; visualPrompt: string }>) {
  return scenes.some((scene) => {
    const title = scene.title.toLowerCase().trim();
    const visual = scene.visualPrompt.toLowerCase();
    return genericSceneNames.includes(title) || (
      genericSceneNames.some((name) => title.includes(name))
      && !visual.includes("video")
      && !visual.includes("storyboard")
      && !visual.includes("生成")
    );
  });
}

export function storyboardQualityIssues(
  scenes: Scene[],
  options?: GenerationOptions,
  projectTitle?: string,
  brief?: string
) {
  const issues: string[] = [];
  const normalizedTitles = scenes.map((scene) => scene.title.toLowerCase().replace(/\s+/g, " "));

  if (new Set(normalizedTitles).size !== normalizedTitles.length) issues.push("scene titles repeat");
  if (storyboardLooksGeneric(scenes)) issues.push("scene structure is generic");
  if (scenes.some((scene) => baseVisualPrompt(scene).length < 100)) issues.push("visual direction lacks concrete detail");
  if (scenes.some((scene) => baseMotionPrompt(scene).length < 50)) issues.push("camera or motion direction lacks detail");
  if (scenes.some((scene) => productionDetailPatterns.filter((pattern) => pattern.test(baseVisualPrompt(scene))).length < 3)) {
    issues.push("visual direction lacks production-ready composition details");
  }
  if (visualPromptsRepeat(scenes)) issues.push("scene visuals are too repetitive");
  if (scenes.length >= 4 && detectedShotVariety(scenes) < 3) issues.push("shot scale and camera angle lack variety");
  if (repeatedNarrationOpenings(scenes)) issues.push("voiceover openings repeat mechanically");
  if (brief && !isVideoCreationProductBrief(brief) && scenes.some((scene) => hasMetaProductionNarration(scene.voiceover))) {
    issues.push("voiceover narrates the production instead of the client's company or product");
  }
  if (brief) {
    const subject = extractBriefSubject(brief, options?.language !== "英文");
    const isDistinctBrand = /^[A-Z][A-Z0-9_-]{2,}$/u.test(subject);
    const narration = `${projectTitle ?? ""} ${scenes.map((scene) => scene.voiceover).join(" ")}`.toLowerCase();
    if (isDistinctBrand && !narration.includes(subject.toLowerCase())) {
      issues.push("voiceover loses the client's named company or product");
    }
  }
  const finalScene = scenes.at(-1);
  if (finalScene && !hasFinalResolve(finalScene)) issues.push("final scene lacks delivery or call-to-action resolve");
  if (scenes.some((scene) => {
    const hanCharacters = (scene.voiceover.match(/\p{Script=Han}/gu) ?? []).length;
    const latinWords = (scene.voiceover.match(/[A-Za-z0-9]+/g) ?? []).length;
    return hanCharacters > 0
      ? hanCharacters < Math.max(4, Math.floor(scene.durationSeconds * 2.1))
      : latinWords < Math.max(3, Math.floor(scene.durationSeconds * 1.15));
  })) {
    issues.push("voiceover is too short for the available scene duration");
  }
  if (scenes.some((scene) => {
    const hanCharacters = (scene.voiceover.match(/\p{Script=Han}/gu) ?? []).length;
    const latinWords = (scene.voiceover.match(/[A-Za-z0-9]+/g) ?? []).length;
    const estimatedSeconds = hanCharacters / 4.15 + latinWords / 2.7;
    return estimatedSeconds > Math.max(1, scene.durationSeconds - 0.25) * 1.12;
  })) {
    issues.push("voiceover does not fit comfortably inside its scene duration");
  }

  const localizedFields = (scene: Scene) => [
    scene.title,
    scene.voiceover,
    baseVisualPrompt(scene),
    baseMotionPrompt(scene),
    scene.style.theme,
    scene.style.mood
  ];
  if (options?.language === "中文" && scenes.some((scene) => localizedFields(scene).some((value) => !hasChinese(value)))) {
    issues.push("scene content is not fully localized in Chinese");
  }
  if (options?.language === "英文" && scenes.some((scene) => localizedFields(scene).some((value) => hasChinese(value)))) {
    issues.push("scene content is not fully localized in English");
  }
  if (
    projectTitle
    && (
      (options?.language === "中文" && !hasChinese(projectTitle))
      || (options?.language === "英文" && hasChinese(projectTitle))
    )
  ) {
    issues.push("project title is not localized in the requested language");
  }

  return issues;
}

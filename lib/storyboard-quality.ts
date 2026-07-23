import type { GenerationOptions, Scene } from "@/lib/types";
import {
  detectBriefDomain,
  extractBriefSubject,
  extractBriefVisualConcepts,
  hasMetaProductionNarration,
  isVideoCreationProductBrief
} from "@/lib/brief-semantics";

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
const gamingIndustryLeakPatterns = [
  /项目压力|企业治理|授权责任|责任链|证据包|业务材料|审批流程|工作链路|团队对齐|风险信号/u,
  /enterprise pressure|governance workflow|approval chain|evidence packet|accountability chain|business workflow|team alignment/iu
];
const gamingProductFramingPatterns = [
  /产品介绍|产品宣传|解决方案|效率提升|平台能力|服务客户|业务价值/u,
  /product (?:film|introduction|explainer)|business solution|improve efficiency|platform capability|customer service/iu
];

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

function conceptToken(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，。！？；,.!?;:：、\-_"'“”‘’()（）]/g, "");
}

function startsWithBriefSubject(line: string, subject: string) {
  const compactSubject = conceptToken(subject);
  if (compactSubject.length < 3) return false;
  if (["这项产品", "这个产品", "thisproduct", "theproduct"].includes(compactSubject)) return false;
  return conceptToken(line).startsWith(compactSubject);
}

function repeatedBriefSubjectOpenings(scenes: Scene[], subject: string) {
  const count = scenes.filter((scene) => startsWithBriefSubject(scene.voiceover, subject)).length;
  return count >= Math.min(2, Math.max(2, Math.ceil(scenes.length * 0.35)));
}

function coveredVisualConcepts(scenes: Scene[], concepts: string[]) {
  const visualText = scenes.map((scene) => scene.visualPrompt).join("\n").toLowerCase();
  return concepts.filter((concept) => {
    const compact = conceptToken(concept);
    if (!compact) return false;
    if (visualText.includes(concept.toLowerCase()) || conceptToken(visualText).includes(compact)) return true;
    if (/gate/i.test(concept)) return /\bgates?\b|检查点|关卡|闸门|门/u.test(visualText);
    if (/证据|evidence/i.test(concept)) return /证据|evidence|packet|档案|文件|材料/u.test(visualText);
    if (/责任|accountability/i.test(concept)) return /责任|owner|ownership|accountability|链路/u.test(visualText);
    if (/风险|risk/i.test(concept)) return /风险|risk|signal|信号|预警/u.test(visualText);
    if (/追溯|trace/i.test(concept)) return /追溯|trace|trail|记录|链/u.test(visualText);
    return false;
  });
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
    if (detectBriefDomain(brief) === "gaming") {
      const output = `${projectTitle ?? ""}\n${scenes.map((scene) => `${scene.voiceover}\n${baseVisualPrompt(scene)}`).join("\n")}`;
      const leaked = gamingIndustryLeakPatterns.some((pattern) => pattern.test(output) && !pattern.test(brief));
      if (leaked) issues.push("voiceover conflicts with the client's industry");
      const productFraming = gamingProductFramingPatterns.some((pattern) => pattern.test(output) && !pattern.test(brief));
      if (productFraming) issues.push("game is framed as a product explainer");
    }
    const subject = extractBriefSubject(brief, options?.language !== "英文");
    const isDistinctBrand = /^[A-Z][A-Z0-9_-]{2,}$/u.test(subject);
    const narration = `${projectTitle ?? ""} ${scenes.map((scene) => scene.voiceover).join(" ")}`.toLowerCase();
    if (isDistinctBrand && !narration.includes(subject.toLowerCase())) {
      issues.push("voiceover loses the client's named company or product");
    }
    if (repeatedBriefSubjectOpenings(scenes, subject)) {
      issues.push("voiceover starts with the product name too often");
    }
    const concepts = extractBriefVisualConcepts(brief, options?.language !== "英文")
      .filter((concept) => !/^[A-Z][A-Za-z0-9_-]{2,}$/u.test(concept));
    if (concepts.length >= 2) {
      const covered = coveredVisualConcepts(scenes, concepts);
      if (covered.length < Math.min(3, concepts.length)) {
        issues.push("visual direction misses brief-specific business concepts");
      }
    }
  }
  const finalScene = scenes.at(-1);
  if (finalScene && !hasFinalResolve(finalScene)) issues.push("final scene lacks delivery or call-to-action resolve");
  if (scenes.some((scene) => {
    const hanCharacters = (scene.voiceover.match(/\p{Script=Han}/gu) ?? []).length;
    const latinWords = (scene.voiceover.match(/[A-Za-z0-9]+/g) ?? []).length;
    const estimatedSeconds = hanCharacters / 4.15 + latinWords / 2.7;
    return estimatedSeconds > Math.max(1, scene.durationSeconds - 0.25) * 1.12;
  })) {
    issues.push("voiceover does not fit comfortably inside its scene duration");
  }
  if (scenes.some((scene) => {
    const hanCharacters = (scene.voiceover.match(/\p{Script=Han}/gu) ?? []).length;
    const latinWords = (scene.voiceover.match(/[A-Za-z0-9]+/g) ?? []).length;
    const estimatedSeconds = hanCharacters / 4.15 + latinWords / 2.7;
    return estimatedSeconds < Math.max(1.8, scene.durationSeconds * 0.56);
  })) {
    issues.push("voiceover is too sparse for the scene duration");
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

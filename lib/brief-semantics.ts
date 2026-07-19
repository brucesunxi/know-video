const videoCreationProductPatterns = [
  /(?:AI\s*)?视频(?:生成|创作|制作)(?:平台|工具|软件|系统|工作室)/iu,
  /(?:文生视频|图生视频|对话改片|智能分镜)(?:平台|工具|软件|系统)?/iu,
  /(?:video generation|video creation|text-to-video|image-to-video|storyboard)(?:\s+(?:platform|tool|software|system|studio|editor|generator))/iu,
  /(?:AI\s+video|video)(?:\s+(?:platform|generator|creator|maker|editor))/iu
];

const productionInstructionPattern = /(?:生成|制作|创建|做|剪辑|输出|导出|改造|调整).{0,18}(?:视频|短片|宣传片|介绍片|分镜)|(?:时长|横屏|竖屏|画幅|配音|旁白|字幕|风格|节奏|镜头|分镜|秒钟?|minutes?|seconds?|aspect ratio)/iu;

const metaNarrationPatterns = [
  /(?:这|本|整)(?:支|个|段)?(?:视频|短片|影片).{0,16}(?:展示|呈现|介绍|讲述|带来|开始|结束|值得)/u,
  /(?:视频|画面|镜头|分镜).{0,14}(?:展示|呈现|聚焦|回到|切换|说明|介绍|生成|拆成|收束)/u,
  /(?:观众|viewer).{0,16}(?:继续看|看到|理解这支|keep watching)/iu,
  /(?:the|this)\s+(?:video|film|scene|shot).{0,18}(?:shows?|presents?|introduces?|frames?|returns?|opens?|closes?)/iu,
  /(?:camera|shot|scene|storyboard).{0,14}(?:shows?|presents?|explains?|moves?|cuts?|generated)/iu
];

const ignoredBrandTokens = new Set([
  "AI", "VIDEO", "SaaS", "APP", "WEB", "MP4", "HD", "4K", "B2B", "B2C"
]);

export function isVideoCreationProductBrief(prompt: string) {
  return videoCreationProductPatterns.some((pattern) => pattern.test(prompt));
}

export function hasMetaProductionNarration(value: string) {
  return metaNarrationPatterns.some((pattern) => pattern.test(value));
}

export function extractBriefSubject(prompt: string, chinese = true) {
  const latinCandidates = prompt.match(/\b[A-Z][A-Z0-9_-]{2,}\b/g) ?? [];
  const brand = latinCandidates.find((candidate) => !ignoredBrandTokens.has(candidate));
  if (brand) return brand;

  const directedSubject = prompt.match(/(?:为|给|关于)\s*([^，。；：:\n]{2,28}?)(?:制作|生成|创建|做一|打造)/u)?.[1]
    ?.replace(/^(?:一家|一个|这家|这个)/u, "")
    .trim();
  if (directedSubject) return directedSubject;

  const firstClause = prompt.split(/[。！？；\n]/u)
    .map((part) => part.trim())
    .find((part) => part.length >= 2 && !productionInstructionPattern.test(part));
  if (firstClause) return firstClause.replace(/^[请帮我给为关于\s]+/u, "").slice(0, chinese ? 18 : 48);
  return chinese ? "这项产品" : "This product";
}

export function extractBriefFacts(prompt: string, chinese = true) {
  const parts = prompt
    .replace(/\r/g, "")
    .split(/[。！？；\n]+/u)
    .map((part) => part.replace(/^[\s,，:：-]+|[\s,，:：-]+$/g, "").trim())
    .filter((part) => part.length >= (chinese ? 8 : 24))
    .filter((part) => !(productionInstructionPattern.test(part) && part.length < (chinese ? 45 : 100)));

  const unique: string[] = [];
  for (const part of parts) {
    const compact = part.replace(/\s+/g, " ");
    if (!unique.some((existing) => existing.includes(compact) || compact.includes(existing))) unique.push(compact);
  }
  return unique.slice(0, 8);
}

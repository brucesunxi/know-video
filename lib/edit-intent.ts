const chineseNumberValues: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10
};

function parseSceneNumber(value: string) {
  if (/^\d+$/.test(value)) return Number(value);
  if (value === "十") return 10;
  if (value.startsWith("十")) return 10 + (chineseNumberValues[value.slice(1)] ?? 0);
  if (value.endsWith("十")) return (chineseNumberValues[value.slice(0, -1)] ?? 0) * 10;
  const [tens, ones] = value.split("十");
  if (ones !== undefined) {
    return (chineseNumberValues[tens] ?? 0) * 10 + (chineseNumberValues[ones] ?? 0);
  }
  return chineseNumberValues[value];
}

export function extractRequestedSceneNumbers(request: string, availableSceneNumbers: number[]) {
  const matches = new Set<number>();
  const addRange = (start: number, end: number) => {
    const lower = Math.min(start, end);
    const upper = Math.max(start, end);
    for (const sceneNumber of availableSceneNumbers) {
      if (sceneNumber >= lower && sceneNumber <= upper) matches.add(sceneNumber);
    }
  };
  const rangePatterns = [
    /(?:scene|shot|chapter)\s*#?\s*(\d+)\s*(?:-|–|—|to|through)\s*(?:scene|shot|chapter)?\s*#?\s*(\d+)/giu,
    /(?:第|场景|镜头|章节)?\s*([0-9一二两三四五六七八九十]+)\s*(?:到|至|-|–|—)\s*(?:第|场景|镜头|章节)?\s*([0-9一二两三四五六七八九十]+)\s*(?:个)?(?:场景|镜头|章节|幕|段)/gu
  ];
  for (const pattern of rangePatterns) {
    for (const match of request.matchAll(pattern)) {
      const start = parseSceneNumber(match[1]);
      const end = parseSceneNumber(match[2]);
      if (start && end) addRange(start, end);
    }
  }

  const orderedPatterns = [
    /(?:前|first)\s*([0-9一二两三四五六七八九十]+)\s*(?:个)?(?:场景|镜头|章节|幕|段|scenes?|shots?|chapters?)/giu,
    /(?:后|last)\s*([0-9一二两三四五六七八九十]+)\s*(?:个)?(?:场景|镜头|章节|幕|段|scenes?|shots?|chapters?)/giu
  ];
  for (const [index, pattern] of orderedPatterns.entries()) {
    for (const match of request.matchAll(pattern)) {
      const count = parseSceneNumber(match[1]);
      if (!count) continue;
      const selected = index === 0
        ? availableSceneNumbers.slice(0, count)
        : availableSceneNumbers.slice(-count);
      selected.forEach((sceneNumber) => matches.add(sceneNumber));
    }
  }
  if (/(?:最后|最终|结尾|片尾)(?:的)?(?:一个|1个)?(?:场景|镜头|章节|幕|段)|last\s+(?:scene|shot|chapter)/iu.test(request)) {
    const last = availableSceneNumbers.at(-1);
    if (last) matches.add(last);
  }

  const coordinatedPattern = /((?:(?:第\s*)?[0-9一二两三四五六七八九十]+\s*(?:、|，|,|和|与|及)\s*)+(?:第\s*)?[0-9一二两三四五六七八九十]+)\s*(?:个)?(?:场景|镜头|章节|幕|段)/gu;
  for (const match of request.matchAll(coordinatedPattern)) {
    for (const numberMatch of match[1].matchAll(/(?:第\s*)?([0-9一二两三四五六七八九十]+)/gu)) {
      const sceneNumber = parseSceneNumber(numberMatch[1]);
      if (sceneNumber && availableSceneNumbers.includes(sceneNumber)) matches.add(sceneNumber);
    }
  }

  const patterns = [
    /(?:scene|shot|chapter)\s*#?\s*(\d+)/giu,
    /(?:场景|镜头|章节)\s*([0-9一二两三四五六七八九十]+)\s*/gu,
    /第\s*([0-9一二两三四五六七八九十]+)\s*(?:个)?(?:场景|镜头|章节|幕|段)/gu
  ];

  for (const pattern of patterns) {
    for (const match of request.matchAll(pattern)) {
      const sceneNumber = parseSceneNumber(match[1]);
      if (sceneNumber && availableSceneNumbers.includes(sceneNumber)) matches.add(sceneNumber);
    }
  }

  return Array.from(matches).sort((left, right) => left - right);
}

function requestsChinese(request: string) {
  return /(?:改|换|翻译|转换|本地化|使用|变成|调整|统一).{0,8}(?:简体)?(?:中文|汉语)|(?:中文|汉语|简体).{0,8}(?:版本|配音|旁白|字幕|标题|文案|语言)/u.test(request);
}

function stronglyGlobal(request: string) {
  return /全片|整个视频|整支视频|所有场景|全部场景|每个场景|所有镜头|全部镜头|每个镜头|entire video|whole video|all scenes|every scene|all shots|throughout/iu.test(request);
}

function weaklyGlobal(request: string) {
  return /全部|全都|统一|整体(?:风格|色调|节奏|画面|旁白|语言|配音|字幕)?|都(?:改|换|调整|变成|使用)/u.test(request);
}

function broadUnscopedEdit(request: string) {
  const subject = /语言|中文|英文|汉语|配音|旁白|字幕|标题|文案|风格|画风|色调|配色|颜色|主题|节奏|速度|音乐|字体|logo|水印|language|voice|narration|caption|subtitle|style|theme|palette|color|pace|speed|music|font|watermark/iu.test(request);
  const action = /改|换|调整|变成|使用|统一|翻译|转换|本地化|加快|放慢|移除|删除|增加|添加|make|change|switch|translate|localize|adjust|use|remove|faster|slower/iu.test(request);
  return subject && action;
}

function requestsVisualDirectionChange(request: string) {
  const visualSubject = /画面|视觉|风格|画风|色调|配色|颜色|主题|构图|背景|人物|角色|字体|logo|水印|visual|image|style|theme|palette|color|composition|background|character|font|watermark/iu.test(request);
  const visualAction = /改|换|调整|变成|使用|统一|翻译|转换|本地化|移除|删除|增加|添加|重做|重新生成|make|change|switch|translate|localize|adjust|use|remove|add|regenerate|redesign/iu.test(request);
  return visualSubject && visualAction;
}

export function requestsGeneratedClip(request: string) {
  return /动态(?:视频|镜头|画面)|视频片段|生成(?:一个|本场景|该场景|这个场景|第.{0,6}场景)?视频|让.{0,12}(?:画面|场景|镜头).{0,6}动起来|图生视频|image[- ]?to[- ]?video|generate.{0,12}(?:video|clip)|animate.{0,12}(?:scene|shot|image)/iu.test(request);
}

export function analyzeEditIntent(request: string, availableSceneNumbers: number[]) {
  const explicitSceneNumbers = extractRequestedSceneNumbers(request, availableSceneNumbers);
  const global = stronglyGlobal(request)
    || (explicitSceneNumbers.length === 0 && (weaklyGlobal(request) || broadUnscopedEdit(request)));
  const globalChineseRewrite = requestsChinese(request) && global;

  return {
    explicitSceneNumbers,
    global,
    globalChineseRewrite,
    preserveVisualAssetsOnLocalization: globalChineseRewrite && !requestsVisualDirectionChange(request)
  };
}

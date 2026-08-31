import type { GenerationOptions, Project } from "@/lib/types";
import { visualStyleProfile } from "@/lib/visual-style-profiles";

type AutoVisualStyleContract = Pick<
  GenerationOptions,
  "style" | "visualStyleId" | "visualStyleLabel" | "visualStylePrompt"
>;

const AUTO_VISUAL_STYLE_CONTRACTS: Record<string, AutoVisualStyleContract> = {
  chalkboard: {
    style: "温暖自然",
    visualStyleId: "chalkboard",
    visualStyleLabel: "黑板手绘",
    visualStylePrompt: "黑板手绘风格：深绿色黑板、粉笔线条、手绘箭头和逐步出现的课堂讲解感。"
  },
  "simple-line": {
    style: "温暖自然",
    visualStyleId: "simple-line",
    visualStyleLabel: "简笔线稿",
    visualStylePrompt: "简笔线稿风格：干净留白、细线人物、少量强调色和清晰步骤图解。"
  },
  collage: {
    style: "明快有活力",
    visualStyleId: "collage",
    visualStyleLabel: "拼贴纸艺",
    visualStylePrompt: "拼贴纸艺风格：纸张纹理、剪贴层次、明亮色块和手作感转场。"
  },
  "comic-book": {
    style: "明快有活力",
    visualStyleId: "comic-book",
    visualStyleLabel: "漫画分格",
    visualStylePrompt: "漫画分格风格：粗描边、高饱和色、拟声爆炸形和强情绪人物表情。"
  },
  memphis: {
    style: "极简高级",
    visualStyleId: "memphis",
    visualStyleLabel: "商务插画",
    visualStylePrompt: "商务插画风格：现代办公室人物、柔和配色、圆润形状和轻量 SaaS 视觉语言。"
  },
  isometric: {
    style: "极简高级",
    visualStyleId: "isometric",
    visualStyleLabel: "等距场景",
    visualStylePrompt: "等距场景风格：俯视等距空间、模块化建筑或界面、流程路径清楚。"
  },
  "pixel-art": {
    style: "明快有活力",
    visualStyleId: "pixel-art",
    visualStyleLabel: "像素游戏",
    visualStylePrompt: "像素游戏风格：低分辨率像素块、霓虹色、游戏 UI 和复古动效。"
  },
  "safety-poster": {
    style: "电影质感",
    visualStyleId: "safety-poster",
    visualStyleLabel: "安全警示插画",
    visualStylePrompt: "安全警示插画风格：高对比黄黑标识、风险符号、聚焦操作动作和培训海报感。"
  },
  "cinematic-realism": {
    style: "电影质感",
    visualStyleId: "cinematic-realism",
    visualStyleLabel: "电影纪实",
    visualStylePrompt: "电影纪实风格：真实人物、浅景深、自然光影、现场空间和稳定镜头语言。"
  },
  "product-ui": {
    style: "极简高级",
    visualStyleId: "product-ui",
    visualStyleLabel: "产品界面演示",
    visualStylePrompt: "产品界面演示风格：清爽 UI、浮层卡片、功能高亮、数据面板和顺滑缩放转场。"
  }
};

const EXPLICIT_STYLE_PATTERNS: Array<[string, RegExp]> = [
  ["chalkboard", /黑板|粉笔|chalk(?:board)?/iu],
  ["simple-line", /简笔|线稿|线描|line[ -]?art/iu],
  ["collage", /拼贴|纸艺|剪纸|paper[ -]?(?:art|collage|cut)/iu],
  ["comic-book", /漫画|美漫|comic/iu],
  ["memphis", /商务插画|孟菲斯|memphis|business illustration/iu],
  ["isometric", /等距|轴测|isometric/iu],
  ["pixel-art", /像素(?:画|风格|艺术)|pixel[ -]?art/iu],
  ["safety-poster", /安全警示插画|安全海报|safety[ -]?poster/iu],
  ["cinematic-realism", /电影纪实|写实(?:风格|画面)|实拍|photoreal|live[ -]?action|documentary/iu],
  ["product-ui", /产品界面演示|界面演示风格|product[ -]?ui|ui[ -]?demo/iu]
];

const SAFETY_POSTER_AUTO_PATTERN = /(?:安全(?:培训|教育|操作|生产|施工|作业|规范|须知)|危险(?:作业|警示|告知)|事故预防|工地安全|职业健康|网络安全|信息安全|反诈|诈骗预警|钓鱼(?:邮件|网站|攻击)|合规培训|workplace safety|safety training|construction safety|hazard warning|cybersecurity|phishing|fraud prevention)/iu;

export function inferAutoVisualStyleId(value: string) {
  const text = value.toLocaleLowerCase();
  const explicit = EXPLICIT_STYLE_PATTERNS.find(([, pattern]) => pattern.test(text));
  if (explicit) return explicit[0];

  if (SAFETY_POSTER_AUTO_PATTERN.test(text)) return "safety-poster";
  if (/游戏|电竞|minecraft|像素|game|gaming|pixel/iu.test(text)) return "pixel-art";

  // A real place, physical service, food, or tangible product should look like
  // the subject itself. Generic words such as "promo" must not turn it into a
  // paper collage or software interface.
  if (/(?:包子|馒头|面点|饺子|餐馆|餐厅|饭店|美食|菜品|厨师|厨房|咖啡|烘焙|茶馆|酒吧|酒店|民宿|旅游|旅行|景区|图书馆|书店|阅览室|博物馆|展馆|门店|店铺|商场|超市|零售|医院|诊所|医生|健身房|工厂|制造|生产线|农场|农业|校园|楼盘|房源|住宅|公寓|社区|restaurant|cafe|coffee shop|bakery|food|chef|kitchen|hotel|hospitality|travel|tourism|library|bookstore|museum|retail|store|shop|hospital|clinic|factory|manufacturing|farm|campus|real estate|property|house|apartment)/iu.test(text)) {
    return "cinematic-realism";
  }

  if (/产品|saas|工具|界面|平台|软件|仪表盘|dashboard|app|software|platform|product|ui/iu.test(text)) return "product-ui";
  if (/课程|教学|解释|概念|培训|课堂|education|lesson|training|explain/iu.test(text)) return "chalkboard";
  if (/客服|客户服务|情绪|沟通|support|customer service/iu.test(text)) return "simple-line";
  if (/社媒|短视频|爆点|营销|活动预热|social|tiktok|reels|campaign/iu.test(text)) return "comic-book";
  if (/流程|系统|架构|预算|审批|模块|process|workflow|system/iu.test(text)) return "isometric";
  if (/品牌|新品|发布|宣传|launch|brand|promo/iu.test(text)) return "collage";
  return "cinematic-realism";
}

export function autoVisualStyleContract(prompt: string) {
  return AUTO_VISUAL_STYLE_CONTRACTS[inferAutoVisualStyleId(prompt)]
    ?? AUTO_VISUAL_STYLE_CONTRACTS["cinematic-realism"];
}

export function resolveAutoVisualStyleOptions(
  prompt: string,
  options?: GenerationOptions
) {
  if (!options) return options;
  const inferred = autoVisualStyleContract(prompt);
  const source = options.visualStyleSource
    ?? (!options.visualStyleId || options.visualStyleId === inferred.visualStyleId ? "auto" : "manual");
  if (source !== "auto") return { ...options, visualStyleSource: source };
  return { ...options, ...inferred, visualStyleSource: "auto" as const };
}

export function repairLegacyAutoVisualStyle(
  project: Project,
  prompt: string,
  options?: GenerationOptions
) {
  if (!options || (options.visualStyleSource && options.visualStyleSource !== "auto")) return undefined;
  const resolved = resolveAutoVisualStyleOptions(prompt, {
    ...options,
    // Records created before style-source tracking are only migrated from the
    // explicit failed-task recovery path. Manual and template records remain protected above.
    visualStyleSource: "auto"
  });
  if (!resolved || resolved.visualStyleId === options.visualStyleId) return undefined;

  const profile = visualStyleProfile(resolved.style);
  const repairedScenes = project.currentVersion.scenes.map((scene) => ({
    ...scene,
    style: {
      ...scene.style,
      theme: `${profile.label} · ${profile.artDirection}`,
      palette: [...profile.palette],
      visualStyleId: resolved.visualStyleId,
      visualStyleLabel: resolved.visualStyleLabel,
      visualStylePrompt: resolved.visualStylePrompt
    },
    // User-provided visuals are authoritative. Generated and stock visuals
    // created under the wrong automatic style must be rebuilt consistently.
    assets: scene.assets.filter((asset) => (
      (asset.type !== "image" && asset.type !== "clip")
      || asset.metadata?.source === "user-upload"
    ))
  }));

  return {
    options: resolved,
    project: {
      ...project,
      currentVersion: {
        ...project.currentVersion,
        scenes: repairedScenes
      }
    }
  };
}

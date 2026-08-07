"use client";

import { ChangeEvent, ClipboardEvent as ReactClipboardEvent, createContext, DragEvent, FormEvent, PointerEvent as ReactPointerEvent, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { PlayerRef } from "@remotion/player";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Bell,
  BookOpen,
  Brush,
  Calendar,
  Check,
  Captions,
  ChevronRight,
  Clapperboard,
  Clock3,
  Combine,
  Copy,
  CreditCard,
  Download,
  FileVideo2,
  Film,
  FolderOpen,
  GripVertical,
  Globe2,
  HelpCircle,
  History,
  Eye,
  ImagePlus,
  Languages,
  Layers3,
  Loader2,
  LogOut,
  MessageSquareText,
  Mic2,
  Moon,
  MoreHorizontal,
  Music2,
  Palette,
  PanelRightOpen,
  Paperclip,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCcw,
  RotateCcw,
  Scissors,
  Search,
  Send,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  User,
  Users,
  Volume2,
  X
} from "lucide-react";
import { KnowVideoPlayer } from "@/app/video-player";
import { maxUploadBytes, replacementAssetTypes, uploadedAssetType } from "@/lib/asset-policy";
import { referenceDescriptor } from "@/lib/attachment-context";
import { editPlanVisualSceneNumbers, planPreviewAsset, removeEditPlanPreviewAssets } from "@/lib/edit-plan-preview-assets";
import { analyzeEditIntent, globalEditTargetSceneNumbers } from "@/lib/edit-intent";
import { editPlanOperations } from "@/lib/edit-operations";
import { parsePendingGenerationSession, PENDING_GENERATION_STORAGE_KEY, type PendingGenerationSession } from "@/lib/generation-session";
import { looksSimplifiedChineseLocalized } from "@/lib/language-quality";
import { missingMotionSceneNumbers, missingSceneAssetNumbers, sceneHasAudioAsset, sceneHasVisualAsset } from "@/lib/generation-resume";
import { selectMotionCriticalScenes } from "@/lib/motion-scene-selection";
import { auditProjectMedia } from "@/lib/project-media-audit";
import { productionAsset, productionSettings } from "@/lib/production-settings";
import { sceneSplitPreview, type SceneStructureMutation } from "@/lib/scene-structure";
import {
  DEFAULT_NARRATION_VOICE,
  narrationVoiceProfile,
  narrationVoiceProfiles
} from "@/lib/voice-profiles";
import { VIDEO_FPS } from "@/video/config";
import { VIDEO_GENERATION_DURATION_SECONDS, VIDEO_GENERATION_TIERS, videoGenerationEstimateLabel } from "@/lib/video-cost-policy";
import type { ChatMessage, EditChange, EditPlan, GenerationOptions, GenerationReferenceAsset, NarrationVoice, ProductionSettings, Project, ProjectListItem, ProjectVersion, ProjectVersionPreview, ProjectVersionSummary, RenderJob, Scene, SceneAsset, SceneTransitionKind } from "@/lib/types";

type Source = "database" | "empty" | "mock";
type Stage = "brief" | "generating" | "projects" | "studio";
type UiLanguage = "zh-CN" | "en";
const UI_LANGUAGE_STORAGE_KEY = "know-video:ui-language";
const UiLanguageContext = createContext<{
  language: UiLanguage;
  setLanguage: (language: UiLanguage) => void;
}>({ language: "zh-CN", setLanguage: () => undefined });

function useUiCopy() {
  const { language, setLanguage } = useContext(UiLanguageContext);
  return {
    language,
    setLanguage,
    text: (chinese: string, english: string) => language === "zh-CN" ? chinese : english
  };
}

function localizedRuntimeLabel(value: string, language: UiLanguage) {
  if (language === "zh-CN") return value;
  const labels: Record<string, string> = {
    "解析视频目标": "Analyze video goals",
    "拆分场景和镜头": "Plan scenes and shots",
    "撰写旁白与字幕": "Write narration and captions",
    "生成视觉和运动提示词": "Create visual and motion prompts",
    "生成场景画面": "Generate scene visuals",
    "生成自然配音": "Generate narration",
    "生成关键动态镜头": "Generate key motion clips",
    "保存项目版本": "Save project version",
    "正在规划修改方案": "Planning edit",
    "正在调整待确认方案": "Refining edit plan",
    "正在保存新版本并更新受影响素材": "Saving a new version and updating affected assets",
    "正在生成场景画面，请保持页面打开": "Generating scene visuals. Keep this page open",
    "正在生成候选画面，当前视频不会被替换": "Generating a candidate without replacing the current video",
    "正在生成修改后的真实画面预览，当前视频保持不变": "Generating a visual preview without changing the current video",
    "正在生成动态视频镜头，请保持页面打开": "Generating motion clips. Keep this page open",
    "正在生成自然配音，请保持页面打开": "Generating narration. Keep this page open",
    "正在保存场景并创建可恢复版本": "Saving the scene and creating a restorable version",
    "正在调整时间线并创建可恢复版本": "Updating the timeline and creating a restorable version",
    "正在保存成片设置": "Saving production settings",
    "正在上传并应用场景素材": "Uploading and applying scene assets",
    "正在恢复历史版本": "Restoring version",
    "正在处理": "Working",
    "目标时长": "Target length",
    "分镜策略": "Storyboard plan",
    "旁白语言": "Narration language",
    "动态策略": "Motion strategy",
    "自动规划场景": "Auto-planned scenes",
    "全片智能运镜": "Smart camera motion",
    "中文": "Chinese",
    "英文": "English"
  };
  if (labels[value]) return labels[value];
  const seconds = value.match(/^约 (\d+) 秒$/u);
  if (seconds) return `About ${seconds[1]} seconds`;
  const scenes = value.match(/^(\d+) 个场景$/u);
  if (scenes) return `${scenes[1]} scenes`;
  return value;
}
type Engine = "ai" | "heuristic";
type StudioView = "preview" | "storyboard";
type AuthUser = {
  id: string;
  email: string;
  name?: string;
  avatarUrl?: string;
};
type MediaGenerationResponse = {
  project?: Project;
  error?: string;
  requestedSceneNumbers?: number[];
  completedSceneNumbers?: number[];
  failedSceneNumbers?: number[];
};

const IMAGE_GENERATION_TIMEOUT_MS = 305_000;
const AUDIO_GENERATION_TIMEOUT_MS = 305_000;
const AUTOMATIC_MEDIA_REPAIR_ATTEMPTS = 3;
type InvalidRenderMedia = {
  sceneNumber: number;
  type: "visual" | "audio";
  reason: string;
};
type GenerationIssueMedia = "visual" | "audio" | "clip";
type GenerationMediaIssue = {
  sceneNumber: number;
  type: GenerationIssueMedia;
  reason: string;
  errorCode?: string;
};

class MediaRequestError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "MediaRequestError";
  }
}
type StoryboardGenerationResponse = {
  status?: "pending" | "ready" | "failed";
  project?: Project;
  messages?: ChatMessage[];
  engine?: Engine;
  error?: string;
  recovered?: boolean;
};
type BusyAction =
  | "planning-edit"
  | "refining-edit"
  | "applying-edit"
  | "generating-images"
  | "generating-candidate"
  | "previewing-plan"
  | "generating-video"
  | "generating-audio"
  | "saving-scene"
  | "editing-timeline"
  | "saving-production"
  | "uploading-asset"
  | "restoring-version";
const promptExamples = [
  "生成一个 30 秒的 AI 视频生成平台产品介绍视频，风格高级、节奏快、适合官网首屏。",
  "做一个关于跨境电商库存管理 SaaS 的解释视频，目标客户是运营负责人。",
  "制作一个教育产品宣传视频，展示老师如何用 AI 快速生成课程内容。"
];
type BriefSettingsPanel = "style" | "avatar" | "voice" | "language" | "brand";
type HomeDialog = "pricing" | "demo" | "help" | "notifications" | "workspace";
type BriefVisualStyleMode = "animated" | "realistic";
type BriefVisualStyle = {
  id: string;
  label: string;
  mode: BriefVisualStyleMode;
  tone: GenerationOptions["style"];
  summary: string;
  prompt: string;
  thumbnail: string;
};
type BriefAvatarMode = "none" | "preset" | "custom";
type BriefBrandKitMode = "none" | "minimal" | "uploaded";
type BriefLanguageOption = {
  value: GenerationOptions["language"];
  country: string;
  code: string;
  label: string;
  detail: string;
};

const briefLanguageOptions: BriefLanguageOption[] = [
  { value: "中文", country: "中国", code: "CN", label: "中文", detail: "中文旁白、字幕和画面文案" },
  { value: "英文", country: "英国", code: "UK", label: "English", detail: "English narration, captions, and on-screen copy" }
];

const briefVisualStyles: BriefVisualStyle[] = [
  { id: "chalkboard", label: "黑板手绘", mode: "animated", tone: "温暖自然", summary: "粉笔线条、课堂感、适合概念讲解", prompt: "黑板手绘风格：深绿色黑板、粉笔线条、手绘箭头和逐步出现的课堂讲解感。", thumbnail: "chalkboard" },
  { id: "simple-line", label: "简笔线稿", mode: "animated", tone: "温暖自然", summary: "少量颜色、人物简洁、信息很清楚", prompt: "简笔线稿风格：干净留白、细线人物、少量强调色和清晰步骤图解。", thumbnail: "simple-line" },
  { id: "collage", label: "拼贴纸艺", mode: "animated", tone: "明快有活力", summary: "纸张纹理、层叠卡片、轻快转场", prompt: "拼贴纸艺风格：纸张纹理、剪贴层次、明亮色块和手作感转场。", thumbnail: "collage" },
  { id: "comic-book", label: "漫画分格", mode: "animated", tone: "明快有活力", summary: "强情绪、粗描边、爆炸形强调", prompt: "漫画分格风格：粗描边、高饱和色、拟声爆炸形和强情绪人物表情。", thumbnail: "comic-book" },
  { id: "memphis", label: "商务插画", mode: "animated", tone: "极简高级", summary: "SaaS 常用人物插画、柔和商务", prompt: "商务插画风格：现代办公室人物、柔和配色、圆润形状和轻量 SaaS 视觉语言。", thumbnail: "memphis" },
  { id: "isometric", label: "等距场景", mode: "animated", tone: "极简高级", summary: "空间结构清楚、适合流程和系统", prompt: "等距场景风格：俯视等距空间、模块化建筑或界面、流程路径清楚。", thumbnail: "isometric" },
  { id: "pixel-art", label: "像素游戏", mode: "animated", tone: "明快有活力", summary: "像素块面、游戏感、适合少儿和科技", prompt: "像素游戏风格：低分辨率像素块、霓虹色、游戏 UI 和复古动效。", thumbnail: "pixel-art" },
  { id: "safety-poster", label: "安全警示插画", mode: "animated", tone: "电影质感", summary: "黄黑警示、风险符号、培训感强", prompt: "安全警示插画风格：高对比黄黑标识、风险符号、聚焦操作动作和培训海报感。", thumbnail: "safety-poster" },
  { id: "cinematic-realism", label: "电影纪实", mode: "realistic", tone: "电影质感", summary: "真实人物、镜头光影、现场感", prompt: "电影纪实风格：真实人物、浅景深、自然光影、现场空间和稳定镜头语言。", thumbnail: "cinematic-realism" },
  { id: "product-ui", label: "产品界面演示", mode: "realistic", tone: "极简高级", summary: "界面大屏、卡片高亮、SaaS 演示", prompt: "产品界面演示风格：清爽 UI、浮层卡片、功能高亮、数据面板和顺滑缩放转场。", thumbnail: "product-ui" }
];

const briefWorkflowCards = [
  { icon: BookOpen, title: "Explain a concept", detail: "把一个概念拆成清楚步骤" },
  { icon: FileVideo2, title: "Turn a doc into video", detail: "上传资料，自动提炼场景" },
  { icon: PanelRightOpen, title: "Make a social short", detail: "短节奏、强字幕、适合传播" },
  { icon: Users, title: "Train your team", detail: "教程、培训、流程说明" }
];
const briefWorkflowLocalized: Record<string, [string, string]> = {
  "Explain a concept": ["解释一个概念", "Break a topic into clear steps"],
  "Turn a doc into video": ["把文档变成视频", "Upload material and extract scenes"],
  "Make a social short": ["制作社媒短片", "Fast pacing, bold captions, shareable"],
  "Train your team": ["培训你的团队", "Tutorials, training, and processes"]
};

const briefCategoryPills = ["Training", "Corporate", "Marketing", "Sales", "Tutorials & explainers", "Real estate", "Finance", "Learning & development", "Social media"] as const;
const briefCategoryChinese: Record<(typeof briefCategoryPills)[number], string> = {
  Training: "培训", Corporate: "企业沟通", Marketing: "市场营销", Sales: "销售",
  "Tutorials & explainers": "教程与解释", "Real estate": "房地产", Finance: "金融",
  "Learning & development": "学习与发展", "Social media": "社交媒体"
};
type BriefCategory = typeof briefCategoryPills[number];
type BriefTemplateCard = {
  title: string;
  detail: string;
  className: string;
  prompt: string;
};
type BriefTemplateRole = "style" | "ref" | "logo";
type BriefTemplateStyle = {
  styleId: string;
  context: string;
};
type BriefStyleSource = "auto" | "template" | "manual";

const briefTemplateRoleLabels: Record<BriefTemplateRole, string> = {
  style: "Style",
  ref: "Ref",
  logo: "Logo"
};

const briefTemplateStyles: Record<string, BriefTemplateStyle> = {
  phishing: { styleId: "safety-poster", context: "网络安全风险画面里加入钓鱼邮件、放大镜和警示标识。" },
  safety: { styleId: "cinematic-realism", context: "工地现场要有真实光影、工人动作和安全装备细节。" },
  support: { styleId: "simple-line", context: "用温和人物线稿表现客服、客户情绪和解决路径。" },
  quarterly: { styleId: "cinematic-realism", context: "用会议室光影、真实团队和增长图表表现季度汇报。" },
  policy: { styleId: "comic-book", context: "把政策变化做成强提醒的公告分格和时间节点。" },
  rollout: { styleId: "product-ui", context: "突出新工具界面、功能卡片和用户操作路径。" },
  launch: { styleId: "collage", context: "用拼贴色块和产品卖点卡片形成新品发布节奏。" },
  success: { styleId: "cinematic-realism", context: "用真实客户故事、前后对比和可信数据建立信任。" },
  event: { styleId: "comic-book", context: "用强烈标题、舞台光和倒计时制造活动期待。" },
  pitch: { styleId: "product-ui", context: "用清晰界面、卖点高亮和演示路径提升说服力。" },
  compare: { styleId: "isometric", context: "用等距模块和左右对比把新旧方案差异讲清楚。" },
  renewal: { styleId: "product-ui", context: "用仪表盘、成果数字和时间线展示续费价值。" },
  concept: { styleId: "chalkboard", context: "把复杂概念拆成黑板上的逐步推导。" },
  tutorial: { styleId: "product-ui", context: "用真实产品界面和步骤高亮讲清操作方法。" },
  doc: { styleId: "collage", context: "把文档页面、摘要卡片和重点标注拼贴成镜头。" },
  property: { styleId: "cinematic-realism", context: "用真实空间光影和生活镜头突出楼盘质感。" },
  community: { styleId: "collage", context: "用生活片段拼贴展现社区配套和居住氛围。" },
  tour: { styleId: "isometric", context: "用等距户型和空间动线辅助房源导览。" },
  finance: { styleId: "product-ui", context: "用深色数据面板和指标高亮呈现金融分析。" },
  budget: { styleId: "isometric", context: "用模块化预算卡片、审批路径和资源流向解释预算。" },
  risk: { styleId: "safety-poster", context: "用红色风险信号、雷达扫描和状态标识表达预警。" },
  onboarding: { styleId: "simple-line", context: "用友好的线稿人物和路线图呈现新人路径。" },
  leadership: { styleId: "chalkboard", context: "用教练课堂式框架、反馈模型和复盘要点讲管理方法。" },
  course: { styleId: "pixel-art", context: "用游戏化像素任务、关卡和奖励表现课程成长。" },
  social: { styleId: "comic-book", context: "用漫画爆点、大字钩子和强反差画面适配社媒。" },
  testimonial: { styleId: "simple-line", context: "用简洁人物头像和评价卡片组成口碑混剪。" },
  countdown: { styleId: "pixel-art", context: "用像素倒计时、限时提示和游戏 UI 制造紧迫感。" }
};

const briefTemplateCards: Record<BriefCategory, BriefTemplateCard[]> = {
  Training: [
    { title: "识别钓鱼邮件", detail: "安全意识培训", className: "phishing", prompt: "制作一个 30 秒企业安全培训视频，教员工识别钓鱼邮件：展示可疑发件人、链接风险、附件陷阱和正确上报动作。" },
    { title: "工地安全简报", detail: "现场安全", className: "safety", prompt: "制作一个工地安全简报视频，讲清进入现场前检查、佩戴防护装备、高处作业提醒和紧急情况处理步骤。" },
    { title: "处理不满客户", detail: "客服培训", className: "support", prompt: "生成一个客服培训视频，展示如何接住客户情绪、复述问题、给出解决方案并跟进结果，语气专业温和。" }
  ],
  Corporate: [
    { title: "季度公司更新", detail: "经营汇报", className: "quarterly", prompt: "生成一个 45 秒季度公司更新视频，面向全员说明业务进展、关键数据、团队成果和下一季度重点方向。" },
    { title: "政策变更通知", detail: "内部沟通", className: "policy", prompt: "制作一个政策变更说明视频，解释变更原因、影响范围、员工需要完成的动作和截止时间，表达清楚可信。" },
    { title: "新工具上线", detail: "产品推广", className: "rollout", prompt: "生成一个新工具上线介绍视频，展示工具解决的问题、核心功能、使用场景和团队开始使用的下一步。" }
  ],
  Marketing: [
    { title: "新品亮点短片", detail: "品牌营销", className: "launch", prompt: "制作一个 30 秒新品亮点短片，开头点出用户痛点，中段展示 3 个产品优势，结尾给出明确行动号召。" },
    { title: "客户成功故事", detail: "案例传播", className: "success", prompt: "生成一个客户成功故事视频，展示客户原本的困难、使用产品后的变化、可量化成果和品牌可信度。" },
    { title: "活动预热视频", detail: "转化引流", className: "event", prompt: "制作一个活动预热视频，用快节奏画面介绍活动主题、嘉宾或亮点、适合谁参加以及报名提醒。" }
  ],
  Sales: [
    { title: "销售开场介绍", detail: "预约演示", className: "pitch", prompt: "生成一个销售开场视频，面向潜在客户说明常见问题、解决方案、核心卖点和预约演示的理由。" },
    { title: "竞品替换说明", detail: "方案对比", className: "compare", prompt: "制作一个竞品替换说明视频，比较旧方案的限制、新方案的优势、迁移过程和客户能获得的收益。" },
    { title: "续费价值回顾", detail: "客户经营", className: "renewal", prompt: "生成一个续费价值回顾视频，展示客户过去周期的使用成果、节省成本、关键成效和下一阶段建议。" }
  ],
  "Tutorials & explainers": [
    { title: "解释一个概念", detail: "清楚步骤", className: "concept", prompt: "制作一个 30 秒概念解释视频，把一个复杂概念拆成 5 个易懂步骤，配合示意画面和简洁字幕。" },
    { title: "功能使用教程", detail: "产品教学", className: "tutorial", prompt: "生成一个功能使用教程视频，从用户目标开始，展示入口、关键操作、结果反馈和常见注意事项。" },
    { title: "文档变视频", detail: "资料提炼", className: "doc", prompt: "把一份说明文档改成 45 秒解释视频，自动提炼重点、拆分章节、生成旁白和清楚的画面提示。" }
  ],
  "Real estate": [
    { title: "楼盘卖点介绍", detail: "项目推广", className: "property", prompt: "制作一个楼盘卖点介绍视频，展示区位、户型、配套、生活场景和预约看房行动号召。" },
    { title: "社区生活方式", detail: "场景营销", className: "community", prompt: "生成一个社区生活方式短片，展示通勤、亲子、健身、商业配套和居住氛围，风格真实温暖。" },
    { title: "房源快速导览", detail: "经纪人获客", className: "tour", prompt: "制作一个房源快速导览视频，按玄关、客厅、卧室、厨房和阳台顺序展示亮点，并加入看房邀约。" }
  ],
  Finance: [
    { title: "经营数据解读", detail: "管理汇报", className: "finance", prompt: "生成一个经营数据解读视频，说明收入变化、成本压力、风险信号和管理层下一步行动建议。" },
    { title: "预算审批说明", detail: "内部流程", className: "budget", prompt: "制作一个预算审批说明视频，讲清申请背景、费用构成、预期回报和审批人需要关注的风险。" },
    { title: "风险预警解释", detail: "合规提醒", className: "risk", prompt: "生成一个风险预警解释视频，用清楚图表说明异常指标、可能原因、影响范围和处理建议。" }
  ],
  "Learning & development": [
    { title: "新人入职路径", detail: "人才发展", className: "onboarding", prompt: "制作一个新人入职路径视频，展示第一周任务、关键联系人、学习资源和 30 天成长目标。" },
    { title: "领导力微课", detail: "管理训练", className: "leadership", prompt: "生成一个领导力微课视频，讲清如何设定目标、给反馈、跟进执行和复盘团队结果。" },
    { title: "课程章节预告", detail: "学习项目", className: "course", prompt: "制作一个课程章节预告视频，展示学习目标、章节结构、练习方式和完成后的能力收获。" }
  ],
  "Social media": [
    { title: "社媒爆点短片", detail: "强开头", className: "social", prompt: "生成一个 20 秒社媒短视频，前 3 秒用强钩子抓注意力，中段展示冲突和亮点，结尾给出行动号召。" },
    { title: "用户评价混剪", detail: "口碑传播", className: "testimonial", prompt: "制作一个用户评价混剪视频，把 3 条用户反馈变成快节奏短片，突出真实感、成果和品牌信任。" },
    { title: "活动倒计时", detail: "限时转化", className: "countdown", prompt: "生成一个活动倒计时短视频，用清楚字幕、节奏感画面和限时提醒推动用户立即报名或购买。" }
  ]
};
const briefTemplateEnglish: Record<string, [string, string]> = {
  phishing: ["Spot a phishing email", "Security awareness"], safety: ["Job-site safety briefing", "Workplace safety"], support: ["Handle an upset customer", "Customer service training"],
  quarterly: ["Quarterly company update", "Business update"], policy: ["Announce a policy change", "Internal communication"], rollout: ["Launch a new tool", "Product adoption"],
  launch: ["New product highlights", "Brand marketing"], success: ["Customer success story", "Case study"], event: ["Event teaser", "Drive registrations"],
  pitch: ["Sales introduction", "Book a demo"], compare: ["Competitive replacement", "Solution comparison"], renewal: ["Renewal value review", "Customer growth"],
  concept: ["Explain a concept", "Clear steps"], tutorial: ["Product tutorial", "Feature training"], doc: ["Turn a document into video", "Summarize material"],
  property: ["Property highlights", "Property marketing"], community: ["Community lifestyle", "Lifestyle marketing"], tour: ["Quick property tour", "Agent lead generation"],
  finance: ["Explain business metrics", "Management reporting"], budget: ["Budget approval overview", "Internal process"], risk: ["Risk alert explainer", "Compliance reminder"],
  onboarding: ["Employee onboarding path", "Talent development"], leadership: ["Leadership micro-course", "Management training"], course: ["Course chapter preview", "Learning program"],
  social: ["Social hook video", "Strong opening"], testimonial: ["Customer testimonial montage", "Social proof"], countdown: ["Event countdown", "Limited-time conversion"]
};
const briefVisualStyleEnglish: Record<string, [string, string]> = {
  chalkboard: ["Chalkboard", "Chalk lines and a classroom feel for concept explainers"],
  "simple-line": ["Simple line art", "Minimal colors, simple characters, and clear information"],
  collage: ["Paper collage", "Paper texture, layered cards, and lively transitions"],
  "comic-book": ["Comic book", "Bold outlines, strong emotion, and graphic emphasis"],
  memphis: ["Business illustration", "Soft, modern character art for business videos"],
  isometric: ["Isometric scenes", "Clear spatial structure for processes and systems"],
  "pixel-art": ["Pixel art", "Retro game visuals for youth and technology topics"],
  "safety-poster": ["Safety poster", "High-contrast warnings and training-focused visuals"],
  "cinematic-realism": ["Cinematic realism", "Real people, natural lighting, and an on-location feel"],
  "product-ui": ["Product UI demo", "Interface close-ups, feature highlights, and SaaS demos"]
};
const transitionOptions: Array<{ value: SceneTransitionKind; label: string }> = [
  { value: "auto", label: "自动" },
  { value: "cut", label: "硬切" },
  { value: "dissolve", label: "叠化" },
  { value: "push-left", label: "向左推进" },
  { value: "push-right", label: "向右推进" },
  { value: "zoom", label: "缩放" },
  { value: "wipe", label: "擦除" }
];

const baseProgressSteps = [
  "解析视频目标",
  "拆分场景和镜头",
  "撰写旁白与字幕",
  "生成视觉和运动提示词",
  "生成场景画面",
  "生成自然配音",
  "保存项目版本"
];

function generationProgressSteps(motion: GenerationOptions["motion"]) {
  return motion === "key-scenes"
    ? [...baseProgressSteps.slice(0, -1), "生成关键动态镜头", baseProgressSteps.at(-1)!]
    : baseProgressSteps;
}

function generationSpecItems(options: GenerationOptions) {
  const sceneLabel = options.sceneCount === "auto" ? "自动规划场景" : `${options.sceneCount} 个场景`;
  const motionLabel = options.motion === "key-scenes"
    ? `1 个${VIDEO_GENERATION_TIERS[options.videoTier].label}镜头`
    : "全片智能运镜";
  return [
    { label: "目标时长", value: `约 ${options.duration} 秒` },
    { label: "分镜策略", value: sceneLabel },
    { label: "旁白语言", value: options.language },
    { label: "动态策略", value: motionLabel }
  ];
}

function plannedSceneCount(options: GenerationOptions) {
  if (options.sceneCount !== "auto") return Number(options.sceneCount);
  const duration = Number(options.duration);
  if (duration <= 15) return 3;
  if (duration <= 45) return 5;
  return 6;
}

function generationReviewItems(prompt: string, options: GenerationOptions) {
  const sceneCount = plannedSceneCount(options);
  const secondsPerScene = Math.max(2, Math.round(Number(options.duration) / sceneCount));
  const motionCount = options.motion === "key-scenes"
    ? 1
    : 0;
  return [
    {
      label: "需求完整度",
      value: prompt.trim().length >= 18 ? "可开始" : "建议补充",
      detail: prompt.trim().length >= 18 ? "目标、对象或用途已足够明确" : "再补一句受众、卖点或画面风格会更稳",
      tone: prompt.trim().length >= 18 ? "ready" : "attention"
    },
    {
      label: "分镜节奏",
      value: `${sceneCount} 幕 · 约 ${secondsPerScene} 秒/幕`,
      detail: options.sceneCount === "auto" ? "系统按时长自动拆分" : "按指定场景数严格规划",
      tone: "ready"
    },
    {
      label: "动态成本",
      value: motionCount > 0 ? `最高预估 ${videoGenerationEstimateLabel(options.videoTier)}` : "$0 动态模型费用",
      detail: motionCount > 0
        ? `仅生成 ${motionCount} 个 ${VIDEO_GENERATION_DURATION_SECONDS} 秒镜头 · ${VIDEO_GENERATION_TIERS[options.videoTier].resolution} · 不自动重试`
        : "全部使用本地智能运镜，后续可逐场景自愿补动态",
      tone: motionCount > 0 ? "working" : "ready"
    },
    {
      label: "旁白语言",
      value: options.language,
      detail: "脚本和旁白会按此语言生成",
      tone: "ready"
    }
  ] as const;
}

function visualStyleById(styleId: string) {
  return briefVisualStyles.find((style) => style.id === styleId) ?? briefVisualStyles[0];
}

function optionsWithVisualStyle(options: GenerationOptions, style: BriefVisualStyle): GenerationOptions {
  return {
    ...options,
    style: style.tone,
    visualStyleId: style.id,
    visualStyleLabel: style.label,
    visualStylePrompt: style.prompt
  };
}

function inferVisualStyleForPrompt(value: string) {
  const text = value.toLocaleLowerCase();
  if (/安全|风险|预警|钓鱼|合规|工地|hazard|risk|safety|phishing/.test(text)) return visualStyleById("safety-poster");
  if (/游戏|少儿|儿童|minecraft|像素|game|kids|pixel/.test(text)) return visualStyleById("pixel-art");
  if (/课程|教学|解释|概念|培训|课堂|education|lesson|training|explain/.test(text)) return visualStyleById("chalkboard");
  if (/客服|客户|服务|情绪|沟通|support|customer|service/.test(text)) return visualStyleById("simple-line");
  if (/产品|saas|工具|界面|平台|软件|dashboard|app|ui/.test(text)) return visualStyleById("product-ui");
  if (/地产|房源|楼盘|社区|空间|real estate|property|house/.test(text)) return visualStyleById("cinematic-realism");
  if (/社媒|短视频|爆点|营销|活动|social|tiktok|reels|campaign/.test(text)) return visualStyleById("comic-book");
  if (/流程|系统|架构|预算|审批|模块|process|workflow|system/.test(text)) return visualStyleById("isometric");
  if (/品牌|新品|发布|宣传|launch|brand|promo/.test(text)) return visualStyleById("collage");
  return visualStyleById("product-ui");
}

function templateStyleFor(template: BriefTemplateCard) {
  const binding = briefTemplateStyles[template.className] ?? briefTemplateStyles.rollout;
  return visualStyleById(binding.styleId);
}

function templatePromptForRole(template: BriefTemplateCard, role: BriefTemplateRole, selectedStyle = templateStyleFor(template)) {
  const binding = briefTemplateStyles[template.className] ?? briefTemplateStyles.rollout;
  if (role === "ref") {
    return `${template.prompt}\n\n参考模板“${template.title}”这一页的内容结构、信息层级和叙事方式；它原本的视觉方向是“${selectedStyle.label}”，但这里不要被固定风格限制。`;
  }
  if (role === "logo") {
    return `${template.prompt}\n\n把模板“${template.title}”中的品牌主体当作 Logo / 品牌标识来设计视频，围绕这个标识展开片头、字幕和结尾露出；画面可吸收“${selectedStyle.label}”的识别感。`;
  }
  return `${template.prompt}\n\n应用模板“${template.title}”的 style：${selectedStyle.prompt} ${binding.context}`;
}

function withoutBriefReferenceInstruction(value: string) {
  return value
    .replace(/\n\n应用模板“[^”]+”的 style：.+$/u, "")
    .replace(/\n\n参考模板“[^”]+”这一页的内容结构、信息层级和叙事方式；.+$/u, "")
    .replace(/\n\n把模板“[^”]+”中的品牌主体当作 Logo \/ 品牌标识来设计视频，.+$/u, "")
    .trimEnd();
}

function elapsedGenerationLabel(startedAt?: number, now = Date.now()) {
  if (!startedAt || startedAt > now) return "刚刚开始";
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes} 分 ${String(rest).padStart(2, "0")} 秒`;
}

function durationLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}:${String(rest).padStart(2, "0")}` : `0:${String(rest).padStart(2, "0")}`;
}

function productionSecondsLabel(seconds: number) {
  const rounded = Math.max(1, Math.round(seconds));
  return durationLabel(rounded);
}

function renderJobStatus(job: RenderJob) {
  if (job.status === "ready") return "已完成";
  if (job.status === "running") return `合成中 ${job.progress}%`;
  if (job.status === "queued") return "等待中";
  if (job.status === "cancelled") return "已取消";
  return "失败";
}

function renderJobTime(job: RenderJob) {
  if (!job.createdAt) return "刚刚";
  return new Date(job.createdAt).toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function uniqueRegenerate(plan: EditPlan) {
  const structural = editPlanOperations(plan).some((operation) => operation.operation === "split" || operation.operation === "merge-next")
    ? ["image", "audio", "thumbnail", "caption", "render"] as SceneAsset["type"][]
    : [];
  return Array.from(new Set([...plan.changes.flatMap((change) => change.regenerate), ...structural]))
    .map(assetTypeLabel)
    .join("、");
}

function productionAssetChangeLabels(plan: EditPlan) {
  return [
    plan.productionAssets?.logo?.action === "attach-upload" ? "替换全片 Logo" : plan.productionAssets?.logo?.action === "remove" ? "移除全片 Logo" : "",
    plan.productionAssets?.music?.action === "attach-upload" ? "替换背景音乐" : plan.productionAssets?.music?.action === "remove" ? "移除背景音乐" : ""
  ].filter(Boolean);
}

function planScopeLabel(plan: EditPlan, sceneCount: number) {
  const targetScenes = Array.from(new Set(plan.affectedScenes)).sort((a, b) => a - b);
  if (targetScenes.length === 0) {
    if (plan.projectTitle) return "只修改项目名称";
    if (productionAssetChangeLabels(plan).length > 0) return "只调整全片品牌与声音";
    return "只调整全片设置";
  }
  if (targetScenes.length === sceneCount && sceneCount > 1) return `覆盖全片 ${sceneCount} 个场景`;
  if (targetScenes.length === 1) return `只影响场景 ${targetScenes[0]}`;
  return `影响场景 ${targetScenes.join("、")}`;
}

function planAssetWorkLabel(plan: EditPlan) {
  const regenerate = uniqueRegenerate(plan);
  const settingCount = productionSettingLabels(plan.productionSettings).length;
  const structure = editPlanOperations(plan).length > 0 ? "时间线结构" : "";
  return [regenerate ? `重做${regenerate}` : "", structure, plan.projectTitle ? "项目名称" : "", ...productionAssetChangeLabels(plan), settingCount > 0 ? `${settingCount} 项成片设置` : ""]
    .filter(Boolean)
    .join("、") || "只更新文字和版本记录";
}

function planApplyLabel(plan: EditPlan, visualPreview: { total: number; ready: number }) {
  if (editPlanOperations(plan).length > 0) return "应用并调整时间线";
  if (visualPreview.total > 0 && visualPreview.ready < visualPreview.total) return "应用并生成素材";
  if (uniqueRegenerate(plan)) return "应用并重做素材";
  return "应用并创建版本";
}

function planApplyBlocker(input: {
  coverageState?: ReturnType<typeof planCoverageState>;
  languageReview?: ReturnType<typeof planLanguageReview>;
}) {
  if (input.coverageState?.tone === "attention") {
    return "方案范围和原始需求不一致，请继续输入补充要求修正范围。";
  }
  if (input.languageReview && !input.languageReview.ready) {
    return "中文化字段还没有全部通过，请继续输入“把所有场景都完整改成中文”。";
  }
  return undefined;
}

function planRenderImpactLabel(plan: EditPlan) {
  const regenerate = new Set(plan.changes.flatMap((change) => change.regenerate));
  const structureInvalidatesRender = editPlanOperations(plan).length > 0;
  if (regenerate.has("render") || structureInvalidatesRender) return "应用后需重新导出 MP4";
  if (regenerate.size > 0) return "素材更新后建议检查导出";
  return "现有成片不受影响";
}

function planReviewChecklist(plan: EditPlan, visualPreview: { total: number; ready: number }) {
  const missingPreview = Math.max(0, visualPreview.total - visualPreview.ready);
  return [
    { label: "版本保护", value: "创建可恢复新版本", tone: "ready" },
    visualPreview.total === 0
      ? { label: "画面预览", value: "无需重做画面", tone: "ready" }
      : missingPreview === 0
        ? { label: "画面预览", value: `${visualPreview.ready} 个真实预览已就绪`, tone: "ready" }
        : { label: "画面预览", value: `${missingPreview} 个场景可先生成真实预览`, tone: "attention" },
    { label: "执行任务", value: planAssetWorkLabel(plan), tone: uniqueRegenerate(plan) || editPlanOperations(plan).length > 0 ? "working" : "ready" },
    { label: "成片影响", value: planRenderImpactLabel(plan), tone: planRenderImpactLabel(plan).includes("重新导出") ? "attention" : "ready" }
  ] as Array<{ label: string; value: string; tone: "ready" | "working" | "attention" }>;
}

function planCoverageState(plan: EditPlan, scenes: Scene[]) {
  const sceneNumbers = scenes.map((scene) => scene.sceneNumber);
  const intent = analyzeEditIntent(plan.userRequest, sceneNumbers);
  const changes = Array.from(new Set(plan.changes.map((change) => change.sceneNumber))).sort((left, right) => left - right);
  const affected = Array.from(new Set(plan.affectedScenes)).sort((left, right) => left - right);
  const covered = changes.length > 0 ? changes : affected;

  if (covered.length === 0 && plan.projectTitle) {
    return {
      tone: "ready",
      title: "项目名称修改",
      detail: `应用后项目将命名为“${plan.projectTitle}”，分镜内容保持不变。`
    } as const;
  }

  if (covered.length === 0 && productionAssetChangeLabels(plan).length > 0) {
    return {
      tone: "ready",
      title: "全片素材修改",
      detail: `${productionAssetChangeLabels(plan).join("、")}，分镜内容保持不变。`
    } as const;
  }

  if (covered.length === 0 && productionSettingLabels(plan.productionSettings).length > 0) {
    return {
      tone: "ready",
      title: "只调整全片设置",
      detail: "本方案不改动单个场景内容，只更新音乐、字幕、Logo 或播放参数。"
    } as const;
  }

  if (intent.global) {
    const targets = globalEditTargetSceneNumbers(plan.userRequest, sceneNumbers);
    const targetSet = new Set(targets);
    const coveredSet = new Set(covered);
    const missing = targets.filter((sceneNumber) => !coveredSet.has(sceneNumber));
    const extra = covered.filter((sceneNumber) => !targetSet.has(sceneNumber));
    if (missing.length > 0 || extra.length > 0) {
      return {
        tone: "attention",
        title: "全局覆盖异常",
        detail: [
          missing.length > 0 ? `缺少场景 ${missing.join("、")}` : "",
          extra.length > 0 ? `多出场景 ${extra.join("、")}` : ""
        ].filter(Boolean).join("；") || "目标场景与方案不一致"
      } as const;
    }
    return {
      tone: "ready",
      title: "全局覆盖已校验",
      detail: `目标场景 ${targets.join("、")} 已全部包含，应用时会按全片意图逐场景处理。`
    } as const;
  }

  if (intent.explicitSceneNumbers.length > 0) {
    return {
      tone: "ready",
      title: "按指定场景执行",
      detail: `识别到明确目标：场景 ${intent.explicitSceneNumbers.join("、")}；未列出的场景保持不变。`
    } as const;
  }

  return {
    tone: "working",
    title: "按语义范围执行",
    detail: covered.length > 0
      ? `当前方案覆盖场景 ${covered.join("、")}；确认前可继续补充范围要求。`
      : "当前方案没有单独列出场景改动。"
  } as const;
}

function planLanguageReview(plan: EditPlan, scenes: Scene[]) {
  const sceneNumbers = scenes.map((scene) => scene.sceneNumber);
  const intent = analyzeEditIntent(plan.userRequest, sceneNumbers);
  if (!intent.globalChineseRewrite) return undefined;

  const targets = globalEditTargetSceneNumbers(plan.userRequest, sceneNumbers);
  const changesByScene = new Map(plan.changes.map((change) => [change.sceneNumber, change]));
  const fieldLabels = [
    ["title", "标题"],
    ["voiceover", "旁白"],
    ["visualPrompt", "画面提示"],
    ["motionPrompt", "镜头提示"]
  ] as const;
  const sceneChecks = targets.map((sceneNumber) => {
    const change = changesByScene.get(sceneNumber);
    const incompleteFields = change
      ? fieldLabels
          .filter(([field]) => !looksSimplifiedChineseLocalized(change.after[field]))
          .map(([, label]) => label)
      : fieldLabels.map(([, label]) => label);
    return {
      sceneNumber,
      ready: Boolean(change) && incompleteFields.length === 0,
      incompleteFields
    };
  });
  const readyCount = sceneChecks.filter((check) => check.ready).length;
  const missingScenes = sceneChecks.filter((check) => !changesByScene.has(check.sceneNumber)).map((check) => check.sceneNumber);
  const incompleteScenes = sceneChecks.filter((check) => changesByScene.has(check.sceneNumber) && !check.ready);

  return {
    ready: readyCount === targets.length,
    summary: readyCount === targets.length
      ? `${readyCount}/${targets.length} 个目标场景已完成中文化`
      : `${readyCount}/${targets.length} 个目标场景通过中文字段检查`,
    detail: missingScenes.length > 0
      ? `缺少场景 ${missingScenes.join("、")} 的中文化改动。`
      : incompleteScenes.length > 0
        ? `场景 ${incompleteScenes[0].sceneNumber} 仍需检查：${incompleteScenes[0].incompleteFields.join("、")}。`
        : "标题、旁白、画面提示和镜头提示都已覆盖。",
    sceneChecks
  };
}

function planRequestTrail(plan: EditPlan) {
  const parts = plan.userRequest
    .split(/\n补充要求：/g)
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    original: parts[0] ?? plan.userRequest.trim(),
    refinements: parts.slice(1)
  };
}

function chatInputMode({
  input,
  pendingPlan
}: {
  input: string;
  pendingPlan?: EditPlan;
}) {
  if (pendingPlan) {
    return {
      tone: "working",
      title: "继续调整待确认方案",
      detail: "发送后会先修改当前方案，不会直接改动视频。"
    } as const;
  }

  return {
    tone: "neutral",
    title: input.trim() ? "AI 正在理解你的修改意图" : "先生成可确认的修改方案",
    detail: "AI 会结合当前分镜和选中场景理解要求，再决定生成方案或候选素材。"
  } as const;
}

function productionSettingLabels(settings?: Partial<ProductionSettings>) {
  if (!settings) return [];
  return Object.entries(settings).map(([key, value]) => {
    if (key === "captionsEnabled") return value ? "显示字幕" : "隐藏字幕";
    if (key === "captionStyle") return `字幕样式：${value === "minimal" ? "简洁" : value === "highlight" ? "强调色" : "深色底"}`;
    if (key === "playbackRate") return `全片速度：${value}x`;
    if (key === "musicVolume") return `音乐音量：${Math.round(Number(value) * 100)}%`;
    if (key === "musicDucking") return `旁白避让：${value === "off" ? "关闭" : value === "strong" ? "明显" : "平衡"}`;
    if (key === "logoPosition") {
      const positions = { "top-left": "左上", "top-right": "右上", "bottom-left": "左下", "bottom-right": "右下" } as const;
      return `Logo 位置：${positions[value as keyof typeof positions]}`;
    }
    return `Logo 大小：${value}%`;
  });
}

function productionSummaryItems(input: {
  settings: ProductionSettings;
  durationSeconds: number;
  logo?: SceneAsset;
  music?: SceneAsset;
}) {
  const effectiveDuration = input.durationSeconds / input.settings.playbackRate;
  const caption = input.settings.captionsEnabled
    ? `字幕开启 · ${input.settings.captionStyle === "minimal" ? "简洁" : input.settings.captionStyle === "highlight" ? "强调色" : "深色底"}`
    : "字幕关闭";
  const music = input.music
    ? `音乐 ${Math.round(input.settings.musicVolume * 100)}% · ${input.settings.musicDucking === "off" ? "不避让" : input.settings.musicDucking === "strong" ? "强避让" : "平衡避让"}`
    : "未添加背景音乐";
  const logo = input.logo
    ? `Logo ${input.settings.logoSize}% · ${productionSettingLabels({ logoPosition: input.settings.logoPosition })[0].replace("Logo 位置：", "")}`
    : "未添加 Logo";
  return [
    { label: "导出时长", value: productionSecondsLabel(effectiveDuration), detail: `${input.settings.playbackRate}x 播放速度` },
    { label: "字幕", value: caption, detail: input.settings.captionsEnabled ? "随旁白逐句显示" : "画面不叠加字幕" },
    { label: "声音", value: music, detail: input.music ? "导出时自动混音" : "仅保留旁白音轨" },
    { label: "品牌", value: logo, detail: input.logo ? "导出时叠加到画面" : "不叠加品牌标识" }
  ];
}

function productionImpactChecks(input: { settings: ProductionSettings; logo?: SceneAsset; music?: SceneAsset }) {
  return [
    {
      label: "字幕层",
      value: input.settings.captionsEnabled
        ? `开启 · ${input.settings.captionStyle === "minimal" ? "简洁" : input.settings.captionStyle === "highlight" ? "强调色" : "深色底"}`
        : "关闭",
      status: input.settings.captionsEnabled ? "ready" : "muted",
      detail: input.settings.captionsEnabled ? "导出画面会叠加逐句字幕。" : "导出画面不会显示字幕。"
    },
    {
      label: "背景音乐",
      value: input.music ? `${Math.round(input.settings.musicVolume * 100)}% · ${input.settings.musicDucking === "off" ? "不避让" : input.settings.musicDucking === "strong" ? "强避让" : "平衡避让"}` : "未添加",
      status: input.music ? "ready" : "muted",
      detail: input.music ? "MP4 会混入背景音乐，并按旁白策略压低。" : "最终只保留旁白音轨。"
    },
    {
      label: "品牌 Logo",
      value: input.logo ? `${input.settings.logoSize}% · ${productionSettingLabels({ logoPosition: input.settings.logoPosition })[0].replace("Logo 位置：", "")}` : "未添加",
      status: input.logo ? "ready" : "muted",
      detail: input.logo ? "导出画面会叠加品牌标识。" : "最终画面不会叠加品牌标识。"
    }
  ] as const;
}

function exportReadinessItems(project: Project, settings: ProductionSettings) {
  const scenes = project.currentVersion.scenes;
  const visualCount = scenes.filter(sceneHasVisualAsset).length;
  const audioCount = scenes.filter(sceneHasAudioAsset).length;
  const clipCount = scenes.filter(sceneHasMotionAsset).length;
  return [
    { label: "画面", value: `${visualCount}/${scenes.length}`, detail: "预览与 MP4 画面完整" },
    { label: "配音", value: `${audioCount}/${scenes.length}`, detail: "旁白音轨完整" },
    { label: "动态镜头", value: clipCount > 0 ? `${clipCount} 个` : "智能运镜", detail: clipCount > 0 ? "优先使用视频片段" : "使用图片运镜合成" },
    ...productionSummaryItems({
      settings,
      durationSeconds: project.currentVersion.durationSeconds,
      logo: productionAsset(project, "logo"),
      music: productionAsset(project, "music")
    })
  ];
}

function sceneStructureLabel(mutation?: EditPlan["sceneStructure"]) {
  if (!mutation) return undefined;
  if (mutation.operation === "set-duration") return `场景 ${mutation.sceneNumber} 调整为 ${mutation.durationSeconds} 秒`;
  if (mutation.operation === "set-transition") {
    const label = transitionOptions.find((option) => option.value === mutation.kind)?.label ?? mutation.kind;
    return `场景 ${mutation.sceneNumber} 进入转场：${label}${mutation.kind === "cut" ? "" : ` · ${mutation.durationSeconds} 秒`}`;
  }
  if (mutation.operation === "set-visual") return `场景 ${mutation.sceneNumber} 采用新的候选画面`;
  if (mutation.operation === "move") return `场景 ${mutation.sceneNumber} 向${mutation.direction === "earlier" ? "前" : "后"}移动一位`;
  if (mutation.operation === "move-to") return `场景 ${mutation.sceneNumber} 移动到第 ${mutation.targetSceneNumber} 位`;
  if (mutation.operation === "split") return `拆分场景 ${mutation.sceneNumber} 为两个镜头`;
  if (mutation.operation === "merge-next") return `合并场景 ${mutation.sceneNumber} 与后一场景`;
  if (mutation.operation === "duplicate") return `复制场景 ${mutation.sceneNumber} 到下一位置`;
  if (mutation.operation === "insert") return `在场景 ${mutation.sceneNumber} ${mutation.placement === "before" ? "前" : "后"}新增“${mutation.scene.title}”`;
  return `删除场景 ${mutation.sceneNumber}`;
}

function assetTypeLabel(type: SceneAsset["type"]) {
  const labels: Record<SceneAsset["type"], string> = {
    image: "画面",
    audio: "配音",
    clip: "视频片段",
    thumbnail: "缩略图",
    caption: "字幕",
    render: "成片",
    logo: "Logo",
    music: "背景音乐"
  };
  return labels[type];
}

function compactText(text: string | undefined, fallback: string, maxLength = 72) {
  if (!text) return fallback;
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}…` : trimmed;
}

function scenePreviewAsset(scene?: Scene) {
  return scene?.assets.find((asset) => asset.type === "image" && asset.url)
    ?? scene?.assets.find((asset) => (
      asset.type === "thumbnail"
      && asset.url
      && asset.metadata?.candidate !== true
      && asset.metadata?.planPreview !== true
    ));
}

function sceneNumberListLabel(sceneNumbers: number[]) {
  if (sceneNumbers.length === 0) return "";
  const visible = sceneNumbers.slice(0, 6).join("、");
  return sceneNumbers.length > 6 ? `${visible} 等 ${sceneNumbers.length} 个` : visible;
}

function uniqueSortedSceneNumbers(sceneNumbers: number[]) {
  return Array.from(new Set(sceneNumbers)).sort((left, right) => left - right);
}

function invalidRenderMediaSummary(items: InvalidRenderMedia[]) {
  const visual = uniqueSortedSceneNumbers(items.filter((item) => item.type === "visual").map((item) => item.sceneNumber));
  const audio = uniqueSortedSceneNumbers(items.filter((item) => item.type === "audio").map((item) => item.sceneNumber));
  return { visual, audio, all: uniqueSortedSceneNumbers([...visual, ...audio]) };
}

function withoutRepairedInvalidMedia(items: InvalidRenderMedia[], type: InvalidRenderMedia["type"], sceneNumbers?: number[]) {
  const repaired = sceneNumbers ? new Set(sceneNumbers) : undefined;
  return items.filter((item) => item.type !== type || (repaired && !repaired.has(item.sceneNumber)));
}

function generationIssueSummary(items: GenerationMediaIssue[]) {
  return {
    visual: uniqueSortedSceneNumbers(items.filter((item) => item.type === "visual").map((item) => item.sceneNumber)),
    audio: uniqueSortedSceneNumbers(items.filter((item) => item.type === "audio").map((item) => item.sceneNumber)),
    clip: uniqueSortedSceneNumbers(items.filter((item) => item.type === "clip").map((item) => item.sceneNumber))
  };
}

function withoutRepairedGenerationIssues(items: GenerationMediaIssue[], type: GenerationIssueMedia, sceneNumbers?: number[]) {
  const repaired = sceneNumbers ? new Set(sceneNumbers) : undefined;
  return items.filter((item) => item.type !== type || (repaired && !repaired.has(item.sceneNumber)));
}

function mediaCompletenessLabel(item: { sceneCount: number; visualCount: number; audioCount: number }) {
  if (item.sceneCount <= 0) return "还没有分镜";
  const visualReady = item.visualCount >= item.sceneCount;
  const audioReady = item.audioCount >= item.sceneCount;
  if (visualReady && audioReady) return "素材完整，可继续预览或导出";
  return `画面 ${item.visualCount}/${item.sceneCount} · 配音 ${item.audioCount}/${item.sceneCount}`;
}

function mediaCompletenessClass(item: { sceneCount: number; visualCount: number; audioCount: number }) {
  return item.sceneCount > 0 && item.visualCount >= item.sceneCount && item.audioCount >= item.sceneCount
    ? "complete"
    : "partial";
}

function outputReadiness(item: {
  sceneCount: number;
  visualCount: number;
  audioCount: number;
  status?: ProjectVersion["status"];
  renderUrl?: string;
  renderJobId?: string;
}) {
  if (item.renderUrl) return { label: "MP4 已就绪", tone: "ready" };
  if (item.status === "rendering" || item.renderJobId) return { label: "成片合成中", tone: "working" };
  if (mediaCompletenessClass(item) === "complete") return { label: "可导出 MP4", tone: "ready" };
  if (item.sceneCount <= 0) return { label: "等待分镜", tone: "attention" };
  return { label: "需补齐素材", tone: "attention" };
}

function versionMediaSummary(version: ProjectVersion) {
  return {
    sceneCount: version.scenes.length,
    visualCount: version.scenes.filter(sceneHasVisualAsset).length,
    audioCount: version.scenes.filter(sceneHasAudioAsset).length
  };
}

function versionOutputLabel(version: ProjectVersion) {
  const summary = versionMediaSummary(version);
  return outputReadiness({ ...summary, status: version.status, renderUrl: version.renderUrl, renderJobId: version.renderJobId }).label;
}

function versionActionInsight(version: ProjectVersionSummary) {
  const output = outputReadiness(version);
  if (version.isCurrent) {
    if (output.tone === "ready") return version.renderUrl ? "当前版本已有成片，可下载或继续迭代。" : "当前版本素材齐全，可直接导出 MP4。";
    if (output.tone === "working") return "当前版本正在合成成片，请稍后查看导出记录。";
    return "当前版本需要先补齐素材，再继续预览或导出。";
  }
  if (output.tone === "ready") return version.renderUrl ? "恢复会创建新版本，并保留这份已导出 MP4。" : "恢复会创建新版本，随后可重新导出 MP4。";
  if (output.tone === "working") return "恢复会创建新版本，原有合成任务不会被当作当前任务。";
  return "恢复后需要先补齐素材，再导出新的 MP4。";
}

function versionRestoreImpactItems(preview: ProjectVersionPreview) {
  const selectedSummary = versionMediaSummary(preview.version);
  const selectedOutput = outputReadiness({
    ...selectedSummary,
    status: preview.version.status,
    renderUrl: preview.version.renderUrl,
    renderJobId: preview.version.renderJobId
  });
  const items = [
    "恢复会创建新的当前版本",
    "当前版本仍保留在历史记录中",
    `时间线将变为 ${selectedSummary.sceneCount} 个场景 · ${durationLabel(preview.version.durationSeconds)}`,
    mediaCompletenessClass(selectedSummary) === "complete" ? "恢复后素材完整" : "恢复后需补齐素材",
    preview.version.renderUrl ? "该版本已有 MP4 可继续播放" : selectedOutput.tone === "ready" ? "恢复后可重新导出 MP4" : "恢复后暂不可导出 MP4"
  ];
  return items;
}

function versionRestoreDeltaItems(preview: ProjectVersionPreview) {
  const selectedSummary = versionMediaSummary(preview.version);
  const currentSummary = versionMediaSummary(preview.currentVersion);
  const selectedOutput = outputReadiness({
    ...selectedSummary,
    status: preview.version.status,
    renderUrl: preview.version.renderUrl,
    renderJobId: preview.version.renderJobId
  });
  const currentOutput = outputReadiness({
    ...currentSummary,
    status: preview.currentVersion.status,
    renderUrl: preview.currentVersion.renderUrl,
    renderJobId: preview.currentVersion.renderJobId
  });
  const sceneDelta = selectedSummary.sceneCount - currentSummary.sceneCount;
  const visualDelta = selectedSummary.visualCount - currentSummary.visualCount;
  const audioDelta = selectedSummary.audioCount - currentSummary.audioCount;
  const outputChanged = selectedOutput.label !== currentOutput.label;
  const deltaLabel = (value: number, unit: string) => value === 0
    ? `保持 ${unit}`
    : value > 0
      ? `增加 ${value} ${unit}`
      : `减少 ${Math.abs(value)} ${unit}`;
  return [
    {
      label: "时间线",
      value: deltaLabel(sceneDelta, "个场景"),
      tone: sceneDelta === 0 ? "neutral" : "attention"
    },
    {
      label: "画面素材",
      value: deltaLabel(visualDelta, "个画面"),
      tone: visualDelta >= 0 ? "ready" : "attention"
    },
    {
      label: "配音素材",
      value: deltaLabel(audioDelta, "段配音"),
      tone: audioDelta >= 0 ? "ready" : "attention"
    },
    {
      label: "MP4 状态",
      value: outputChanged ? `${currentOutput.label} → ${selectedOutput.label}` : `保持 ${selectedOutput.label}`,
      tone: selectedOutput.tone === "ready" ? "ready" : selectedOutput.tone === "working" ? "working" : "attention"
    }
  ] as const;
}

function fileSizeLabel(value: unknown) {
  const bytes = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "云端素材";
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1_000))} KB`;
  return `${(bytes / 1_000_000).toFixed(bytes >= 10_000_000 ? 0 : 1)} MB`;
}

function normalizeClipboardFile(file: File | null, index: number) {
  if (!file) return undefined;
  if (file.name.trim()) return file;
  const extension = file.type === "image/png"
    ? "png"
    : file.type === "image/jpeg"
      ? "jpg"
      : file.type === "image/webp"
        ? "webp"
        : file.type === "video/mp4"
          ? "mp4"
          : file.type === "video/webm"
            ? "webm"
            : file.type === "audio/wav" || file.type === "audio/x-wav"
              ? "wav"
              : file.type === "audio/mpeg"
                ? "mp3"
                : "asset";
  return new File([file], `pasted-reference-${index + 1}.${extension}`, {
    type: file.type,
    lastModified: file.lastModified || Date.now()
  });
}

function decimalSecondsLabel(value: unknown) {
  const seconds = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return `${seconds.toFixed(seconds >= 10 ? 1 : 2)} 秒`;
}

function audioAssetQualityItems(asset: SceneAsset) {
  if (asset.type !== "audio") return [];
  const actualSeconds = typeof asset.metadata?.actualDurationSeconds === "number" ? asset.metadata.actualDurationSeconds : Number(asset.metadata?.actualDurationSeconds);
  const targetSeconds = typeof asset.metadata?.targetDurationSeconds === "number" ? asset.metadata.targetDurationSeconds : Number(asset.metadata?.targetDurationSeconds);
  const actual = decimalSecondsLabel(actualSeconds);
  const target = decimalSecondsLabel(targetSeconds);
  const timing = Number.isFinite(actualSeconds) && Number.isFinite(targetSeconds) && actualSeconds > 0 && targetSeconds > 0
    ? actualSeconds > targetSeconds * 1.03
      ? "旁白偏长"
      : actualSeconds < targetSeconds * 0.55
        ? "旁白偏短"
        : "时长匹配"
    : "";
  const voice = typeof asset.metadata?.narrationVoice === "string"
    ? narrationVoiceProfile(asset.metadata.narrationVoice as NarrationVoice).label
    : typeof asset.metadata?.voice === "string"
      ? asset.metadata.voice
      : undefined;
  const model = typeof asset.metadata?.model === "string" ? asset.metadata.model : undefined;
  return [
    actual && target ? `配音 ${actual} / 场景 ${target}` : actual ? `配音 ${actual}` : "",
    timing,
    voice ? `音色 ${voice}` : "",
    model ? `来源 ${model}` : ""
  ].filter(Boolean);
}

function assetUsageItems(asset: SceneAsset) {
  if (asset.type === "image") return ["用于预览和 MP4 导出"];
  if (asset.type === "clip") return ["动态镜头优先播放", "用于 MP4 导出"];
  if (asset.type === "audio") return ["进入旁白音轨", "用于 MP4 导出"];
  if (asset.type === "thumbnail" && asset.metadata?.candidate === true) return ["候选画面", "不影响当前视频"];
  if (asset.type === "thumbnail") return ["封面素材"];
  return [];
}

function assetStateBadge(asset: SceneAsset) {
  if (asset.type === "image") {
    return { label: "当前画面", tone: "active", detail: "预览和 MP4 导出会使用这张画面" } as const;
  }
  if (asset.type === "clip") {
    return { label: "当前动态", tone: "active", detail: "预览和导出优先使用这个视频片段" } as const;
  }
  if (asset.type === "audio") {
    return { label: "当前配音", tone: "active", detail: "导出旁白音轨会使用这段音频" } as const;
  }
  if (asset.type === "thumbnail" && asset.metadata?.candidate === true) {
    return { label: "候选未采用", tone: "candidate", detail: "对比或采用前不会影响当前视频" } as const;
  }
  return { label: "辅助素材", tone: "neutral", detail: "不直接改变当前场景预览" } as const;
}

function renderJobQualityLabel(job: RenderJob) {
  if (job.status !== "ready") return undefined;
  return job.metadata?.quality === "passed" ? "成片质检通过" : "成片已生成";
}

function renderJobMetadataItems(job: RenderJob) {
  if (job.status !== "ready" || !job.metadata) return [];
  const metadata = job.metadata;
  const duration = decimalSecondsLabel(metadata.duration);
  const expectedDuration = decimalSecondsLabel(metadata.expectedDuration);
  const size = fileSizeLabel(metadata.size);
  const dimensions = Number.isFinite(Number(metadata.width)) && Number.isFinite(Number(metadata.height))
    ? `${metadata.width}×${metadata.height}`
    : undefined;
  const fps = Number.isFinite(Number(metadata.fps)) ? `${Number(metadata.fps).toFixed(0)} fps` : undefined;
  const codec = typeof metadata.videoCodec === "string" && metadata.videoCodec ? metadata.videoCodec.toUpperCase() : undefined;
  const audioTracks = Number.isFinite(Number(metadata.audioTrackCount)) ? `${metadata.audioTrackCount} 条音轨` : undefined;
  return [
    duration && expectedDuration ? `时长 ${duration} / 目标 ${expectedDuration}` : duration ? `时长 ${duration}` : "",
    size !== "云端素材" ? size : "",
    [dimensions, fps].filter(Boolean).join(" · "),
    [codec, audioTracks].filter(Boolean).join(" · ")
  ].filter(Boolean);
}

function renderJobRecoveryAdvice(job: RenderJob) {
  if (job.status !== "failed") return undefined;
  const error = job.error ?? "";
  if (/素材|云端|文件|画面|配音|失效|不存在/.test(error)) {
    return "建议先重做提示中的异常画面或配音，再重新导出。";
  }
  if (/版本|刷新|发生变化/.test(error)) {
    return "建议重新打开当前项目，确认版本无误后再导出。";
  }
  if (/超时|连接|暂时|稍后/.test(error)) {
    return "建议稍等片刻后重新导出；如果连续失败，再检查导出记录里的错误信息。";
  }
  return "建议重新导出一次；如果仍失败，先确认所有场景都能正常播放预览。";
}

function exportActionLabel(input: {
  exportProgress?: number;
  renderUrl?: string;
  missingVisualCount: number;
  missingAudioCount: number;
  invalidMediaCount?: number;
}) {
  if (input.exportProgress !== undefined) return `正在合成 MP4 ${input.exportProgress}%`;
  if (input.invalidMediaCount && input.invalidMediaCount > 0) return `先修复 ${input.invalidMediaCount} 个异常素材`;
  if (input.missingVisualCount > 0 && input.missingAudioCount > 0) {
    return `缺 ${input.missingVisualCount} 个画面 · ${input.missingAudioCount} 段配音`;
  }
  if (input.missingVisualCount > 0) return `缺 ${input.missingVisualCount} 个画面`;
  if (input.missingAudioCount > 0) return `缺 ${input.missingAudioCount} 段配音`;
  return input.renderUrl ? "下载 MP4" : "导出 MP4";
}

function exportBlockingItems(input: {
  missingVisualSceneNumbers: number[];
  missingAudioSceneNumbers: number[];
  invalidMedia: ReturnType<typeof invalidRenderMediaSummary>;
}) {
  return [
    input.missingVisualSceneNumbers.length > 0
      ? {
          key: "missing-visual",
          tone: "attention",
          title: "缺少画面素材",
          detail: `场景 ${sceneNumberListLabel(input.missingVisualSceneNumbers)} 没有可用于预览和导出的图片或视频片段。`,
          action: "生成缺失画面"
        }
      : undefined,
    input.missingAudioSceneNumbers.length > 0
      ? {
          key: "missing-audio",
          tone: "attention",
          title: "缺少旁白配音",
          detail: `场景 ${sceneNumberListLabel(input.missingAudioSceneNumbers)} 没有旁白音轨，导出会静音或不完整。`,
          action: "生成缺失配音"
        }
      : undefined,
    input.invalidMedia.visual.length > 0
      ? {
          key: "invalid-visual",
          tone: "danger",
          title: "画面文件异常",
          detail: `场景 ${sceneNumberListLabel(input.invalidMedia.visual)} 的云端画面文件可能已失效或格式异常。`,
          action: "重做异常画面"
        }
      : undefined,
    input.invalidMedia.audio.length > 0
      ? {
          key: "invalid-audio",
          tone: "danger",
          title: "配音文件异常",
          detail: `场景 ${sceneNumberListLabel(input.invalidMedia.audio)} 的云端音频文件可能已失效或格式异常。`,
          action: "重做异常配音"
        }
      : undefined
  ].filter(Boolean) as Array<{
    key: string;
    tone: "attention" | "danger";
    title: string;
    detail: string;
    action: string;
  }>;
}

function sceneVisualAsset(scene: Scene) {
  return scene.assets.find((asset) => ["image", "clip"].includes(asset.type) && asset.url);
}

function sceneHasMotionAsset(scene: Scene) {
  return scene.assets.some((asset) => asset.type === "clip" && Boolean(asset.url));
}

function sceneMediaState(scene: Scene) {
  const visualReady = sceneHasVisualAsset(scene);
  const audioReady = sceneHasAudioAsset(scene);
  const motionReady = sceneHasMotionAsset(scene);
  return {
    visualReady,
    audioReady,
    motionReady,
    ready: visualReady && audioReady
  };
}

function sceneMediaStatusLabel(scene: Scene) {
  const state = sceneMediaState(scene);
  if (state.ready && state.motionReady) return "素材完整 · 已有动态镜头";
  if (state.ready) return "素材完整 · 可预览导出";
  const missing = [
    state.visualReady ? "" : "缺画面",
    state.audioReady ? "" : "缺配音"
  ].filter(Boolean);
  return missing.join(" · ");
}

function sceneMediaDiagnosticItems(scene: Scene) {
  const state = sceneMediaState(scene);
  return [
    {
      key: "visual",
      label: "画面",
      status: state.visualReady ? "ready" : "missing",
      detail: state.visualReady ? "可用于预览和导出" : "缺少图片或视频片段"
    },
    {
      key: "audio",
      label: "配音",
      status: state.audioReady ? "ready" : "missing",
      detail: state.audioReady ? "旁白音频已就绪" : "导出会静音或缺旁白"
    },
    {
      key: "motion",
      label: "动态",
      status: state.motionReady ? "ready" : state.visualReady ? "optional" : "blocked",
      detail: state.motionReady ? "已有动态镜头" : state.visualReady ? "可基于画面生成" : "先生成画面"
    }
  ] as const;
}

function requestErrorMessage(error: unknown, fallback: string) {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (
    ["AbortError", "TimeoutError"].includes(name)
    || /signal timed out|timed out|aborted due to timeout|the operation was aborted/iu.test(message)
  ) {
    return `${fallback}请求超时，请稍后重试。`;
  }
  if (/failed to fetch|load failed|networkerror|network request failed|fetch failed/iu.test(message)) {
    return `${fallback}网络连接中断，请检查上传文件大小、网络或稍后重试。`;
  }
  return error instanceof Error ? error.message : fallback;
}

function readPendingGenerationSession() {
  try {
    return parsePendingGenerationSession(window.sessionStorage.getItem(PENDING_GENERATION_STORAGE_KEY));
  } catch {
    return undefined;
  }
}

function savePendingGenerationSession(session: PendingGenerationSession) {
  try {
    window.sessionStorage.setItem(PENDING_GENERATION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Generation still works when browser storage is unavailable; only refresh recovery is disabled.
  }
}

function clearPendingGenerationSession() {
  try {
    window.sessionStorage.removeItem(PENDING_GENERATION_STORAGE_KEY);
  } catch {
    // Ignore unavailable browser storage.
  }
}

async function waitForRenderJob(
  jobId: string,
  isCancelled: () => boolean = () => false,
  onProgress: (progress: number) => void = () => undefined
) {
  const startedAt = Date.now();
  let consecutiveFailures = 0;
  let current: RenderJob | undefined;
  while (!isCancelled()) {
    if (Date.now() - startedAt > 45 * 60 * 1000) {
      throw new Error("视频渲染超时，请稍后在项目中重试导出。");
    }
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
    if (isCancelled()) return undefined;
    try {
      const response = await fetch(`/api/render-jobs?id=${encodeURIComponent(jobId)}`, { cache: "no-store" });
      const data = await response.json() as { renderJob?: RenderJob; error?: string };
      if (!response.ok || !data.renderJob) throw new Error(data.error || "无法读取视频渲染进度。");
      current = data.renderJob;
      onProgress(current.progress);
      consecutiveFailures = 0;
    } catch (error) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= 4) throw error;
      continue;
    }
    if (current.status !== "queued" && current.status !== "running") return current;
  }
  return undefined;
}

async function waitForGenerationRequest(
  requestId: string,
  onWaiting: () => void
): Promise<Required<Pick<StoryboardGenerationResponse, "project" | "messages" | "engine">> & StoryboardGenerationResponse> {
  const startedAt = Date.now();
  let consecutiveFailures = 0;
  onWaiting();
  while (Date.now() - startedAt < 4 * 60 * 1000) {
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
    try {
      const response = await fetch(
        `/api/projects/generation?requestId=${encodeURIComponent(requestId)}`,
        { cache: "no-store", signal: AbortSignal.timeout(12_000) }
      );
      const data = await response.json().catch(() => ({})) as StoryboardGenerationResponse;
      if (response.status === 202 || data.status === "pending") {
        consecutiveFailures = 0;
        continue;
      }
      if (!response.ok || data.status === "failed") {
        throw new Error(data.error || "视频脚本和分镜生成没有完成，请重试。");
      }
      if (!data.project || !Array.isArray(data.messages) || !data.engine) {
        throw new Error("生成任务返回的数据不完整，请重试。");
      }
      return { ...data, project: data.project, messages: data.messages, engine: data.engine };
    } catch (error) {
      if (error instanceof Error && /没有完成|数据不完整/.test(error.message)) throw error;
      consecutiveFailures += 1;
      if (consecutiveFailures >= 5) {
        throw new Error("暂时无法读取后台生成进度。项目完成后仍会保存在项目列表中，请稍后查看。");
      }
    }
  }
  throw new Error("脚本和分镜生成时间较长。任务仍可能在后台完成，请稍后到项目列表查看。");
}

function busyActionLabel(action?: BusyAction) {
  switch (action) {
    case "planning-edit":
      return "正在理解要求并生成逐场景修改方案";
    case "refining-edit":
      return "正在根据补充要求细化当前修改方案";
    case "applying-edit":
      return "正在保存新版本并更新受影响素材";
    case "generating-images":
      return "正在生成场景画面，请保持页面打开";
    case "generating-candidate":
      return "正在生成候选画面，当前视频不会被替换";
    case "previewing-plan":
      return "正在生成修改后的真实画面预览，当前视频保持不变";
    case "generating-video":
      return "正在生成动态视频镜头，请保持页面打开";
    case "generating-audio":
      return "正在生成自然配音，请保持页面打开";
    case "saving-scene":
      return "正在保存场景并创建可恢复版本";
    case "editing-timeline":
      return "正在调整时间线并创建可恢复版本";
    case "saving-production":
      return "正在保存成片设置";
    case "uploading-asset":
      return "正在上传并应用场景素材";
    case "restoring-version":
      return "正在恢复历史版本";
    default:
      return "正在处理";
  }
}

function projectStatusBadges(project: Project, source: Source, stage: Stage) {
  if (stage === "projects") return [];
  if (stage === "generating") {
    return [
      { label: "正在创建新项目", tone: "working" },
      { label: "生成进度自动保存", tone: "neutral" }
    ] as Array<{ label: string; tone: "ready" | "working" | "attention" | "neutral" }>;
  }
  const version = project.currentVersion;
  const saved = source === "database"
    ? { label: "项目已保存", tone: "ready" }
    : source === "empty"
      ? { label: "尚未创建项目", tone: "attention" }
      : { label: "本地预览", tone: "neutral" };
  const storyboard = version.scenes.length > 0
    ? { label: `${version.scenes.length} 个分镜`, tone: "ready" }
    : { label: "等待分镜", tone: "attention" };
  const output = outputReadiness({
    ...versionMediaSummary(version),
    status: version.status,
    renderUrl: version.renderUrl,
    renderJobId: version.renderJobId
  });
  return [saved, storyboard, output] as Array<{ label: string; tone: "ready" | "working" | "attention" | "neutral" }>;
}

function Shell({
  children,
  currentUser,
  project,
  source,
  stage,
  onNewVideo,
  onOpenProjects,
  onOpenStudio
}: {
  children: React.ReactNode;
  currentUser: AuthUser;
  project: Project;
  source: Source;
  stage: Stage;
  onNewVideo: () => void;
  onOpenProjects: () => void;
  onOpenStudio: () => void;
}) {
  const { language, setLanguage, text } = useUiCopy();
  const appRef = useRef<HTMLElement>(null);
  const [homeDialog, setHomeDialog] = useState<HomeDialog>();
  const [darkMode, setDarkMode] = useState(false);
  useEffect(() => {
    appRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [stage]);
  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? "dark" : "light";
    return () => {
      document.documentElement.removeAttribute("data-theme");
    };
  }, [darkMode]);
  const statusBadges = projectStatusBadges(project, source, stage);
  const localizedStatusBadge = (label: string) => {
    if (language === "zh-CN") return label;
    const fixed: Record<string, string> = {
      "正在创建新项目": "Creating project",
      "生成进度自动保存": "Progress autosaved",
      "项目已保存": "Project saved",
      "尚未创建项目": "No project yet",
      "本地预览": "Local preview",
      "等待分镜": "Waiting for scenes",
      "可导出 MP4": "MP4 ready",
      "需补齐素材": "Assets incomplete"
    };
    const sceneCount = label.match(/^(\d+) 个分镜$/u);
    return sceneCount ? `${sceneCount[1]} scenes` : fixed[label] ?? label;
  };
  const headerTitle = stage === "brief"
    ? text("用一句需求，完成一支视频", "Create a video from one request")
    : stage === "projects"
      ? text("我的视频项目", "My video projects")
      : stage === "generating"
        ? text("新视频制作中", "Creating a new video")
        : project.title;
  const languageToggle = (
    <button
      aria-label={text("切换为英文界面", "Switch interface to Chinese")}
      className="kv-ui-language-toggle"
      onClick={() => setLanguage(language === "zh-CN" ? "en" : "zh-CN")}
      title={text("界面语言：中文", "Interface language: English")}
      type="button"
    >
      <Globe2 size={16} />
      <span>{language === "zh-CN" ? "EN" : "中文"}</span>
    </button>
  );

  return (
    <main className={`kv-shell${stage === "brief" ? " kv-shell-brief" : ""}`}>
      <aside className="kv-sidebar">
        {stage === "brief" ? (
          <div className="kv-home-sidebar">
            <div className="kv-home-brand">
              <div className="kv-logo">K</div>
              <strong>Know Video</strong>
            </div>
            <button className="kv-home-new" onClick={onNewVideo} type="button">
              <MessageSquareText size={17} />
              {text("新建视频", "New video")}
            </button>
            <label className="kv-home-search">
              <Search size={16} />
              <input placeholder={text("搜索…", "Search…")} />
            </label>
            <nav className="kv-home-menu">
              <button className="active" onClick={onNewVideo} type="button"><Plus size={16} /> {text("创作", "Create")}</button>
              <button onClick={onOpenProjects} type="button"><Layers3 size={16} /> {text("项目库", "Gallery")}</button>
            </nav>
            <div className="kv-home-list">
              <span>{text("项目", "Projects")}</span>
              {source !== "empty" && project.currentVersion.scenes.length > 0 ? (
                <button onClick={onOpenStudio} type="button">{project.title}</button>
              ) : (
                <small>{text("暂无项目", "No projects yet")}</small>
              )}
            </div>
            <div className="kv-home-list">
              <span>{text("你的对话", "Your chats")}</span>
              <small>{text("输入需求，开始创建第一支视频。", "Start a request to create the first video thread.")}</small>
            </div>
            <div className="kv-home-sidebar-bottom">
              <button onClick={() => setHomeDialog("pricing")} type="button"><CreditCard size={16} /> {text("价格", "Pricing")}</button>
              <button onClick={() => setHomeDialog("demo")} type="button"><Calendar size={16} /> {text("预约演示", "Book a Demo")}</button>
              <button aria-label={text("帮助", "Help")} onClick={() => setHomeDialog("help")} type="button"><HelpCircle size={16} /></button>
            </div>
          </div>
        ) : (
          <>
            <button aria-label={text("返回首页", "Home")} className="kv-logo kv-logo-button" onClick={onNewVideo} title={text("返回首页", "Home")} type="button">K</button>
            <nav className="kv-nav">
              <button aria-label={text("返回首页并新建视频", "Return home and create a video")} onClick={onNewVideo} title={text("返回首页", "Home")} type="button">
                <Plus size={18} />
              </button>
              <button aria-label={text("视频工作室", "Video studio")} className={stage === "studio" ? "active" : ""} disabled={source === "empty"} onClick={onOpenStudio} title={text("视频工作室", "Video studio")} type="button">
                <Clapperboard size={18} />
              </button>
              <button aria-label={text("项目列表", "Project gallery")} className={stage === "projects" ? "active" : ""} onClick={onOpenProjects} title={text("项目列表", "Project gallery")} type="button">
                <Layers3 size={18} />
              </button>
            </nav>
          </>
        )}
      </aside>
      <section className="kv-app" ref={appRef}>
        {stage === "brief" ? (
          <header className="kv-home-topbar">
            <button className="kv-workspace-switcher" onClick={() => setHomeDialog("workspace")} type="button">
              <User size={16} />
              Personal
              <ChevronRight size={15} />
            </button>
            <div className="kv-home-top-actions">
              {languageToggle}
              <span className="kv-credit-pill"><AlertCircle size={14} /> {text("免费版 · 996 点数 · 获取更多", "Free · 996 credits · Get more")}</span>
              <button aria-label={darkMode ? "浅色模式" : "夜间模式"} onClick={() => setDarkMode((enabled) => !enabled)} title={darkMode ? "浅色模式" : "夜间模式"} type="button"><Moon size={18} /></button>
              <button aria-label={text("通知", "Notifications")} onClick={() => setHomeDialog("notifications")} type="button"><Bell size={18} /></button>
              <div className="kv-user-menu">
                {currentUser.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt="" src={currentUser.avatarUrl} />
                ) : (
                  <span>{currentUser.email.slice(0, 1).toUpperCase()}</span>
                )}
                <strong>{currentUser.name || currentUser.email}</strong>
                <button aria-label="退出登录" onClick={async () => {
                  await fetch("/api/auth/logout", { method: "POST" });
                  window.location.assign("/");
                }} title="退出登录" type="button">
                  <LogOut size={15} />
                </button>
              </div>
            </div>
          </header>
        ) : (
          <header className="kv-topbar">
            <div className="kv-topbar-title">
              <button className="kv-home-return" onClick={onNewVideo} type="button">
                <ArrowLeft size={16} />
                {text("返回首页", "Back home")}
              </button>
              <div>
                <span className="kv-eyebrow">{text("Know Video 智能视频工作室", "Know Video AI Studio")}</span>
                <h1>{headerTitle}</h1>
              </div>
            </div>
            <div className="kv-status-row">
              {languageToggle}
              {statusBadges.map((badge) => (
                <span className={badge.tone} key={`${badge.tone}-${badge.label}`}>{localizedStatusBadge(badge.label)}</span>
              ))}
              <div className="kv-user-menu">
                {currentUser.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt="" src={currentUser.avatarUrl} />
                ) : (
                  <span>{currentUser.email.slice(0, 1).toUpperCase()}</span>
                )}
                <strong>{currentUser.name || currentUser.email}</strong>
                <button aria-label="退出登录" onClick={async () => {
                  await fetch("/api/auth/logout", { method: "POST" });
                  window.location.assign("/");
                }} title="退出登录" type="button">
                  <LogOut size={15} />
                </button>
              </div>
            </div>
          </header>
        )}
        {children}
        {stage === "brief" && homeDialog ? (
          <div className="kv-home-dialog-backdrop" role="presentation" onMouseDown={(event) => {
            if (event.target === event.currentTarget) setHomeDialog(undefined);
          }}>
            <section aria-modal="true" className="kv-home-dialog" role="dialog">
              <button aria-label={text("关闭", "Close")} className="kv-home-dialog-close" onClick={() => setHomeDialog(undefined)} type="button"><X size={18} /></button>
              {homeDialog === "pricing" ? (
                <>
                  <span className="kv-eyebrow">{text("价格", "Pricing")}</span>
                  <h3>{text("当前免费额度", "Current free allowance")}</h3>
                  <div className="kv-home-dialog-grid">
                    <span><strong>996</strong><small>{text("剩余额度", "Credits left")}</small></span>
                    <span><strong>5</strong><small>{text("默认分镜", "Default scenes")}</small></span>
                    <span><strong>MP4</strong><small>{text("可导出", "Export ready")}</small></span>
                  </div>
                  <p>{text("正式计费页会包含文字生成、高清画面、动态镜头和 MP4 导出的额度说明。", "The full pricing page will explain usage for scripts, enhanced images, generated motion, and MP4 exports.")}</p>
                </>
              ) : null}
              {homeDialog === "demo" ? (
                <>
                  <span className="kv-eyebrow">{text("预约演示", "Book a Demo")}</span>
                  <h3>{text("预约产品演示", "Book a product demo")}</h3>
                  <p>{text("可以把你的使用场景、公司名称和联系方式发给我们，我们会根据内容准备一套演示流程。", "Send us your use case, company name, and contact details. We will prepare a tailored demo flow.")}</p>
                  <a className="kv-home-dialog-action" href="mailto:support@know-video.app?subject=Know%20Video%20Demo%20Request">{text("发送预约邮件", "Send demo request")}</a>
                </>
              ) : null}
              {homeDialog === "help" ? (
                <>
                  <span className="kv-eyebrow">{text("帮助", "Help")}</span>
                  <h3>{text("常用操作", "Common actions")}</h3>
                  <ul>
                    <li>{text("首页输入一句需求即可生成脚本、分镜、画面和配音。", "Enter one request on the home page to generate a script, storyboard, visuals, and narration.")}</li>
                    <li>{text("进入工作室后，用右侧对话描述修改意图。", "In the studio, describe changes in the chat panel on the right.")}</li>
                    <li>{text("素材缺失时，按页面提示补齐画面或配音后再导出 MP4。", "Complete any missing visuals or narration before exporting MP4.")}</li>
                  </ul>
                </>
              ) : null}
              {homeDialog === "notifications" ? (
                <>
                  <span className="kv-eyebrow">{text("通知", "Notifications")}</span>
                  <h3>{text("通知中心", "Notification center")}</h3>
                  <ul>
                    <li>{text("项目保存、导出完成和生成失败会在这里集中展示。", "Project saves, completed exports, and generation failures appear here.")}</li>
                    <li>{text("当前没有新的未读通知。", "There are no unread notifications.")}</li>
                  </ul>
                </>
              ) : null}
              {homeDialog === "workspace" ? (
                <>
                  <span className="kv-eyebrow">{text("工作区", "Workspace")}</span>
                  <h3>{text("个人工作区", "Personal workspace")}</h3>
                  <p>{text("当前项目会保存在你的个人工作区。团队工作区和成员权限将作为后续协作能力接入。", "Projects are saved in your personal workspace. Team workspaces and member permissions will be added later.")}</p>
                </>
              ) : null}
            </section>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function GenerationSpecStrip({ options }: { options: GenerationOptions }) {
  const { language } = useUiCopy();
  return (
    <div className="kv-generation-spec" aria-label="生成规格确认">
      {generationSpecItems(options).map((item) => (
        <span key={item.label}>
          <strong>{localizedRuntimeLabel(item.value, language)}</strong>
          <small>{localizedRuntimeLabel(item.label, language)}</small>
        </span>
      ))}
    </div>
  );
}

function ProjectLibrary({
  projects,
  query,
  isLoading,
  onQueryChange,
  onOpen,
  onCreate,
  onRename,
  onDelete,
  actionBusy,
  errorMessage
}: {
  projects: ProjectListItem[];
  query: string;
  isLoading: boolean;
  onQueryChange: (value: string) => void;
  onOpen: (projectId: string) => void;
  onCreate: () => void;
  onRename: (projectId: string, title: string) => Promise<boolean>;
  onDelete: (projectId: string) => Promise<boolean>;
  actionBusy: boolean;
  errorMessage?: string;
}) {
  const { text } = useUiCopy();
  const [renamingId, setRenamingId] = useState<string>();
  const [renameValue, setRenameValue] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState<ProjectListItem>();
  const filtered = projects.filter((item) => item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const statusLabel: Record<ProjectListItem["status"], string> = {
    draft: text("草稿", "Draft"),
    planning: text("规划中", "Planning"),
    rendering: text("渲染中", "Rendering"),
    ready: text("可播放", "Ready"),
    failed: text("需处理", "Needs attention")
  };

  return (
    <div className="kv-projects-page">
      <div className="kv-projects-heading">
        <div>
          <span className="kv-eyebrow">{text("项目库", "Gallery")}</span>
          <h2>{text("继续创作，或开始一支新视频", "Continue creating or start a new video")}</h2>
          <p>{text("所有脚本、分镜、素材、对话和历史版本都保存在各自项目中。", "Scripts, storyboards, assets, conversations, and version history are saved inside each project.")}</p>
        </div>
        <button className="kv-primary" onClick={onCreate} type="button">
          <Plus size={18} />
          {text("新建视频", "New video")}
        </button>
      </div>
      <div className="kv-project-search">
        <Search size={18} />
        <input aria-label={text("搜索项目", "Search projects")} onChange={(event) => onQueryChange(event.target.value)} placeholder={text("搜索视频项目", "Search video projects")} value={query} />
        <span>{text(`${filtered.length} 个项目`, `${filtered.length} projects`)}</span>
      </div>
      {errorMessage ? <div className="kv-inline-error" role="alert"><AlertCircle size={18} />{errorMessage}</div> : null}
      {isLoading ? (
        <div className="kv-project-empty"><Loader2 className="kv-spin" size={24} /><p>{text("正在读取项目...", "Loading projects...")}</p></div>
      ) : filtered.length === 0 ? (
        <div className="kv-project-empty">
          <FolderOpen size={28} />
          <h3>{query ? text("没有匹配的项目", "No matching projects") : text("还没有视频项目", "No video projects yet")}</h3>
          <p>{query ? text("换一个关键词试试。", "Try another search term.") : text("从一句需求开始创建你的第一支视频。", "Create your first video from a single request.")}</p>
        </div>
      ) : (
        <div className="kv-project-grid">
          {filtered.map((item) => (
            <article className="kv-project-card" key={item.id}>
              <button className="kv-project-open" disabled={actionBusy || renamingId === item.id} onClick={() => onOpen(item.id)} type="button">
                <div className={`kv-project-cover${item.thumbnailUrl ? "" : " empty"}`} style={item.thumbnailUrl ? { backgroundImage: `url(${item.thumbnailUrl})` } : undefined}>
                  {!item.thumbnailUrl ? <Film size={28} /> : null}
                  <span>{durationLabel(item.durationSeconds)}</span>
                </div>
                <div className="kv-project-card-body">
                  <div>
                    <strong>{item.title}</strong>
                    <span className={`kv-project-status ${item.status}`}>{statusLabel[item.status]}</span>
                  </div>
                  <p>{text(`${item.sceneCount} 个场景`, `${item.sceneCount} scenes`)} · {new Date(item.updatedAt).toLocaleDateString(text("zh-CN", "en-US"), { month: "short", day: "numeric" })}</p>
                  <small className={mediaCompletenessClass(item)}>
                    {mediaCompletenessLabel(item)}
                  </small>
                  <small className={`kv-output-status ${outputReadiness(item).tone}`}>
                    {outputReadiness(item).label}
                  </small>
                </div>
              </button>
              {renamingId === item.id ? (
                <form className="kv-project-rename" onSubmit={async (event) => {
                  event.preventDefault();
                  if (await onRename(item.id, renameValue.trim())) setRenamingId(undefined);
                }}>
                  <input aria-label={text("项目名称", "Project name")} autoFocus maxLength={120} onChange={(event) => setRenameValue(event.target.value)} value={renameValue} />
                  <button disabled={actionBusy || renameValue.trim().length === 0} title={text("保存名称", "Save name")} type="submit"><Check size={15} /></button>
                  <button disabled={actionBusy} onClick={() => setRenamingId(undefined)} title={text("取消", "Cancel")} type="button"><X size={15} /></button>
                </form>
              ) : (
                <div className="kv-project-card-actions">
                  <button disabled={actionBusy} onClick={() => { setRenamingId(item.id); setRenameValue(item.title); }} title={text("重命名", "Rename")} type="button"><Pencil size={15} /></button>
                  <button disabled={actionBusy} onClick={() => setDeleteCandidate(item)} title={text("删除项目", "Delete project")} type="button"><Trash2 size={15} /></button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {deleteCandidate ? (
        <div className="kv-modal-backdrop" role="presentation">
          <section aria-labelledby="delete-project-title" aria-modal="true" className="kv-confirm-modal" role="dialog">
            <div className="kv-confirm-icon"><Trash2 size={20} /></div>
            <h3 id="delete-project-title">{text(`删除“${deleteCandidate.title}”？`, `Delete “${deleteCandidate.title}”?`)}</h3>
            <p>{text("项目、全部版本、场景素材、对话记录和已导出视频都会永久删除。", "The project, all versions, scene assets, conversations, and exported videos will be permanently deleted.")}</p>
            <div>
              <button disabled={actionBusy} onClick={() => setDeleteCandidate(undefined)} type="button">{text("取消", "Cancel")}</button>
              <button className="danger" disabled={actionBusy} onClick={async () => {
                if (await onDelete(deleteCandidate.id)) setDeleteCandidate(undefined);
              }} type="button">
                {actionBusy ? <Loader2 className="kv-spin" size={16} /> : <Trash2 size={16} />}
                {text("确认删除", "Delete")}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function BriefScreen({
  prompt,
  options,
  attachments,
  isBusy,
  currentProject,
  onPromptChange,
  onOptionsChange,
  onOpenAttachmentPicker,
  onAddAttachments,
  onRemoveAttachment,
  onUseExample,
  onSubmit,
  onOpenStudio,
  hasCurrentProject,
  errorMessage
}: {
  prompt: string;
  options: GenerationOptions;
  attachments: File[];
  isBusy: boolean;
  currentProject: Project;
  onPromptChange: (value: string) => void;
  onOptionsChange: (value: GenerationOptions) => void;
  onOpenAttachmentPicker: () => void;
  onAddAttachments: (files: File[]) => void;
  onRemoveAttachment: (index: number) => void;
  onUseExample: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onOpenStudio: () => void;
  hasCurrentProject: boolean;
  errorMessage?: string;
}) {
  const { language, text } = useUiCopy();
  const reviewItems = generationReviewItems(prompt, options);
  const [activeSettings, setActiveSettings] = useState<BriefSettingsPanel>();
  const [activeCategory, setActiveCategory] = useState<BriefCategory>(briefCategoryPills[0]);
  const [selectedTemplate, setSelectedTemplate] = useState<BriefTemplateCard>();
  const [selectedTemplateRole, setSelectedTemplateRole] = useState<BriefTemplateRole>("style");
  const [styleMode, setStyleMode] = useState<BriefVisualStyleMode>("animated");
  const [styleSource, setStyleSource] = useState<BriefStyleSource>("auto");
  const [selectedStyleId, setSelectedStyleId] = useState(inferVisualStyleForPrompt(prompt).id);
  const [draftStyleSource, setDraftStyleSource] = useState<BriefStyleSource>("auto");
  const [draftStyleId, setDraftStyleId] = useState(inferVisualStyleForPrompt(prompt).id);
  const [avatarMode, setAvatarMode] = useState<BriefAvatarMode>("none");
  const [brandMode, setBrandMode] = useState<BriefBrandKitMode>("none");
  const [selectedVoice, setSelectedVoice] = useState<NarrationVoice>(options.narrationVoice ?? DEFAULT_NARRATION_VOICE);
  const [voiceQuery, setVoiceQuery] = useState("");
  const [previewingVoice, setPreviewingVoice] = useState<NarrationVoice>();
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string>();
  const [composerDragActive, setComposerDragActive] = useState(false);
  const previewUrlsRef = useRef(new Map<NarrationVoice, string>());
  const previewAudioRef = useRef<HTMLAudioElement>();
  const previewAbortRef = useRef<AbortController>();
  const advancedSettingsRef = useRef<HTMLDetailsElement>(null);
  const selectedVoiceProfile = narrationVoiceProfile(selectedVoice);
  const selectedLanguageOption = briefLanguageOptions.find((item) => item.value === options.language) ?? briefLanguageOptions[0];
  const filteredVoices = narrationVoiceProfiles.filter((profile) => `${profile.label} ${profile.useCase} ${profile.description}`.toLocaleLowerCase().includes(voiceQuery.trim().toLocaleLowerCase()));
  const visibleTemplateCards = briefTemplateCards[activeCategory];
  const inferredVisualStyle = inferVisualStyleForPrompt(prompt);
  const selectedVisualStyle = styleSource === "auto" ? inferredVisualStyle : visualStyleById(selectedStyleId);
  const draftVisualStyle = draftStyleSource === "auto" ? inferredVisualStyle : visualStyleById(draftStyleId);
  const visibleVisualStyles = briefVisualStyles.filter((style) => style.mode === styleMode);
  const showStyleReference = styleSource !== "auto" && styleSource !== "template";
  const styleLabel = (style: BriefVisualStyle) => language === "zh-CN" ? style.label : briefVisualStyleEnglish[style.id]?.[0] ?? style.label;
  const styleSummary = (style: BriefVisualStyle) => language === "zh-CN" ? style.summary : briefVisualStyleEnglish[style.id]?.[1] ?? style.summary;

  useEffect(() => () => {
    previewAbortRef.current?.abort();
    previewAudioRef.current?.pause();
    previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    if (activeSettings !== "style") return;
    const currentStyle = styleSource === "auto" ? inferredVisualStyle : visualStyleById(selectedStyleId);
    setDraftStyleSource(styleSource);
    setDraftStyleId(currentStyle.id);
    setStyleMode(currentStyle.mode);
  }, [activeSettings]);

  async function toggleBriefVoicePreview(voice: NarrationVoice) {
    if (previewingVoice === voice) {
      previewAbortRef.current?.abort();
      previewAbortRef.current = undefined;
      previewAudioRef.current?.pause();
      if (previewAudioRef.current) previewAudioRef.current.currentTime = 0;
      previewAudioRef.current = undefined;
      setPreviewingVoice(undefined);
      setPreviewLoading(false);
      return;
    }
    previewAbortRef.current?.abort();
    previewAudioRef.current?.pause();
    previewAudioRef.current = undefined;
    setPreviewError(undefined);
    setPreviewingVoice(voice);
    setPreviewLoading(true);
    const controller = new AbortController();
    previewAbortRef.current = controller;
    try {
      let url = previewUrlsRef.current.get(voice);
      if (!url) {
        const response = await fetch("/api/assets/audio/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ voice }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(65_000)])
        });
        if (!response.ok) {
          const detail = await response.json().catch(() => undefined) as { error?: string } | undefined;
          throw new Error(detail?.error || "试听加载失败。请稍后重试。");
        }
        url = URL.createObjectURL(await response.blob());
        previewUrlsRef.current.set(voice, url);
      }
      const audio = new Audio(url);
      if (controller.signal.aborted) return;
      previewAbortRef.current = undefined;
      previewAudioRef.current = audio;
      audio.onended = () => {
        previewAudioRef.current = undefined;
        setPreviewingVoice(undefined);
        setPreviewLoading(false);
      };
      audio.onerror = () => {
        previewAudioRef.current = undefined;
        setPreviewingVoice(undefined);
        setPreviewLoading(false);
        setPreviewError("试听音频无法播放，请稍后重试。");
      };
      await audio.play();
      setPreviewLoading(false);
    } catch (error) {
      if (controller.signal.aborted) return;
      previewAbortRef.current = undefined;
      previewAudioRef.current = undefined;
      setPreviewingVoice(undefined);
      setPreviewLoading(false);
      setPreviewError(error instanceof Error ? error.message : "试听加载失败。请稍后重试。");
    }
  }

  function chooseVoice(voice: NarrationVoice) {
    setSelectedVoice(voice);
    onOptionsChange({ ...options, narrationVoice: voice });
  }

  function chooseLanguage(language: GenerationOptions["language"]) {
    onOptionsChange({ ...options, language });
    setActiveSettings(undefined);
  }

  function updatePrompt(value: string) {
    onPromptChange(value);
    if (styleSource === "auto") {
      const inferred = inferVisualStyleForPrompt(value);
      setSelectedStyleId(inferred.id);
      setStyleMode(inferred.mode);
      onOptionsChange(optionsWithVisualStyle(options, inferred));
    }
  }

  function chooseCategory(category: BriefCategory) {
    setActiveCategory(category);
    const firstTemplate = briefTemplateCards[category][0];
    const templateStyle = templateStyleFor(firstTemplate);
    setSelectedTemplate(firstTemplate);
    setSelectedTemplateRole("style");
    setStyleSource("template");
    setSelectedStyleId(templateStyle.id);
    setStyleMode(templateStyle.mode);
    onOptionsChange(optionsWithVisualStyle(options, templateStyle));
    onUseExample(templatePromptForRole(firstTemplate, "style", templateStyle));
  }

  function chooseTemplate(template: BriefTemplateCard) {
    const templateStyle = templateStyleFor(template);
    setSelectedTemplate(template);
    setSelectedTemplateRole("style");
    setStyleSource("template");
    setSelectedStyleId(templateStyle.id);
    setStyleMode(templateStyle.mode);
    onOptionsChange(optionsWithVisualStyle(options, templateStyle));
    onUseExample(templatePromptForRole(template, "style", templateStyle));
  }

  function chooseTemplateRole(role: BriefTemplateRole) {
    setSelectedTemplateRole(role);
    if (selectedTemplate && role === "style") onOptionsChange(optionsWithVisualStyle(options, selectedVisualStyle));
    if (selectedTemplate) onUseExample(templatePromptForRole(selectedTemplate, role, selectedVisualStyle));
  }

  function draftVisualStyleChoice(style: BriefVisualStyle) {
    setDraftStyleId(style.id);
    setStyleMode(style.mode);
    setDraftStyleSource("manual");
  }

  function draftAutoStyleChoice() {
    const inferred = inferVisualStyleForPrompt(prompt);
    setDraftStyleSource("auto");
    setDraftStyleId(inferred.id);
    setStyleMode(inferred.mode);
  }

  function changeStyleMode(mode: BriefVisualStyleMode) {
    setStyleMode(mode);
    if (draftStyleSource === "auto") return;
    if (visualStyleById(draftStyleId).mode === mode) return;
    const firstStyle = briefVisualStyles.find((style) => style.mode === mode);
    if (firstStyle) setDraftStyleId(firstStyle.id);
  }

  function promptWithStyle(style: BriefVisualStyle) {
    if (selectedTemplate) return templatePromptForRole(selectedTemplate, selectedTemplateRole, style);
    const styleInstruction = `应用“${style.label}”的 style：${style.prompt}`;
    const trimmed = prompt.trim();
    if (!trimmed) return styleInstruction;
    const withoutPreviousStyle = trimmed.replace(/\n\n应用“[^”]+”的 style：.+$/u, "");
    return `${withoutPreviousStyle}\n\n${styleInstruction}`;
  }

  function confirmVisualStyle() {
    const style = draftStyleSource === "auto" ? inferVisualStyleForPrompt(prompt) : visualStyleById(draftStyleId);
    setStyleSource(draftStyleSource);
    setSelectedStyleId(style.id);
    setStyleMode(style.mode);
    onOptionsChange(optionsWithVisualStyle(options, style));
    onUseExample(promptWithStyle(style));
    setActiveSettings(undefined);
  }

  function removeTemplateReference() {
    const nextPrompt = withoutBriefReferenceInstruction(prompt);
    setSelectedTemplate(undefined);
    setSelectedTemplateRole("style");
    onPromptChange(nextPrompt);
    if (styleSource === "template") {
      const inferred = inferVisualStyleForPrompt(nextPrompt);
      setStyleSource("auto");
      setSelectedStyleId(inferred.id);
      setStyleMode(inferred.mode);
      onOptionsChange(optionsWithVisualStyle(options, inferred));
    }
  }

  function removeStyleReference() {
    const inferred = inferVisualStyleForPrompt(prompt);
    setStyleSource("auto");
    setSelectedStyleId(inferred.id);
    setStyleMode(inferred.mode);
    onOptionsChange(optionsWithVisualStyle(options, inferred));
  }

  function clipboardFiles(event: ReactClipboardEvent<HTMLElement>) {
    return Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item, index) => normalizeClipboardFile(item.getAsFile(), index))
      .filter((file): file is File => Boolean(file));
  }

  function handleIncomingFiles(files: File[]) {
    if (files.length === 0 || isBusy) return;
    if (activeSettings === "brand" && files.some((file) => file.type.startsWith("image/"))) {
      setBrandMode("uploaded");
    }
    onAddAttachments(files);
  }

  function handlePasteFiles(event: ReactClipboardEvent<HTMLElement>) {
    const files = clipboardFiles(event);
    if (files.length === 0) return;
    event.preventDefault();
    handleIncomingFiles(files);
  }

  function handleDropFiles(event: DragEvent<HTMLElement>) {
    const files = Array.from(event.dataTransfer.files);
    setComposerDragActive(false);
    if (files.length === 0) return;
    event.preventDefault();
    handleIncomingFiles(files);
  }

  function openAdvancedSettings() {
    if (advancedSettingsRef.current) {
      advancedSettingsRef.current.open = true;
      advancedSettingsRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  return (
    <div className="kv-brief kv-brief-home">
      <section className="kv-home-hero">
        <span className="kv-home-engine">{text("创意视频引擎", "Idea to Video Engine")}</span>
        <h2>{text("一句需求，生成完整视频", "Generate polished videos from one request")}</h2>
        <p>{text("输入需求，Know Video 会规划脚本、分镜、画面、配音和可继续对话修改的版本。", "Describe what you need. Know Video plans the script, storyboard, visuals, narration, and an editable first version.")}</p>
        <form
          className={`kv-home-composer${composerDragActive ? " is-dragging" : ""}`}
          onDragEnter={(event) => {
            if (isBusy || event.dataTransfer.types.includes("Files") === false) return;
            event.preventDefault();
            setComposerDragActive(true);
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
            setComposerDragActive(false);
          }}
          onDragOver={(event) => {
            if (isBusy || event.dataTransfer.types.includes("Files") === false) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }}
          onDrop={handleDropFiles}
          onPaste={handlePasteFiles}
          onSubmit={onSubmit}
        >
          <div className="kv-composer-settings" role="toolbar" aria-label="视频生成设置">
            <button onClick={() => setActiveSettings("style")} type="button">
              <i><Brush size={18} /></i>
              <span><strong>{styleSource === "auto" ? `${text("自动", "Auto")} · ${styleLabel(selectedVisualStyle)}` : styleLabel(selectedVisualStyle)}</strong><small>{text("风格", "Style")}</small></span>
            </button>
            <button onClick={() => setActiveSettings("avatar")} type="button">
              <i><User size={18} /></i>
              <span><strong>{avatarMode === "none" ? text("无", "None") : avatarMode === "preset" ? text("预设", "Preset") : text("自定义", "Custom")}</strong><small>{text("数字人", "Avatar")}</small></span>
            </button>
            <button onClick={() => setActiveSettings("voice")} type="button">
              <i><Mic2 size={18} /></i>
              <span><strong>{selectedVoiceProfile.shortLabel}</strong><small>{text("音色", "Voice")}</small></span>
            </button>
            <button onClick={() => setActiveSettings("language")} type="button">
              <i><Languages size={18} /></i>
              <span><strong>{selectedLanguageOption.code} · {selectedLanguageOption.label}</strong><small>{text("旁白语言", "Narration")}</small></span>
            </button>
            <button onClick={() => setActiveSettings("brand")} type="button">
              <i><Palette size={18} /></i>
              <span><strong>{brandMode === "none" ? text("无", "None") : brandMode === "minimal" ? text("简洁", "Minimal") : text("已上传", "Uploaded")}</strong><small>{text("品牌", "Brand kit")}</small></span>
            </button>
          </div>
          {selectedTemplate || showStyleReference ? (
            <div className="kv-template-reference-panel" aria-label="已选择的模板参考">
              <div className="kv-template-reference-summary">
                <strong>{text("图片", "Images")}</strong>
                <span>
                  {selectedTemplate
                    ? showStyleReference
                      ? `参考模板结构，并把“${selectedVisualStyle.label}”作为类型图片和整体视觉参考。`
                      : selectedTemplateRole === "style"
                        ? `作为“${selectedVisualStyle.label}”整体观感和节奏参考。`
                        : selectedTemplateRole === "ref"
                          ? "参考这一页的内容结构和表达方式。"
                          : "把它当作 Logo / 品牌标识来制作视频。"
                    : `已把“${selectedVisualStyle.label}”作为类型图片和整体视觉参考。`}
                </span>
              </div>
              <div className="kv-template-reference-assets">
                {selectedTemplate ? (
                  <figure className={`kv-template-reference-card ${selectedTemplate.className}`}>
                    <button aria-label="移除模板参考" className="kv-template-reference-remove" disabled={isBusy} onClick={removeTemplateReference} title="移除模板参考" type="button"><X size={13} /></button>
                    <label>
                      <select
                        aria-label="模板素材角色"
                        onChange={(event) => chooseTemplateRole(event.target.value as BriefTemplateRole)}
                        value={selectedTemplateRole}
                      >
                        {Object.entries(briefTemplateRoleLabels).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </label>
                    <figcaption>
                      <strong>{selectedTemplate.title}</strong>
                      <small>{selectedTemplateRole === "style" ? selectedVisualStyle.label : briefTemplateRoleLabels[selectedTemplateRole]}</small>
                    </figcaption>
                  </figure>
                ) : null}
                {showStyleReference ? (
                  <figure className="kv-template-reference-card kv-style-reference-card">
                    <button aria-label="移除 Style 参考" className="kv-template-reference-remove" disabled={isBusy} onClick={removeStyleReference} title="移除 Style 参考" type="button"><X size={13} /></button>
                    <span className={`kv-style-thumb style-${selectedVisualStyle.thumbnail}`} aria-hidden="true"><i /><b /><em /></span>
                    <figcaption>
                      <strong>{styleLabel(selectedVisualStyle)}</strong>
                      <small>Style</small>
                    </figcaption>
                  </figure>
                ) : null}
              </div>
            </div>
          ) : null}
          <textarea
            onChange={(event) => updatePrompt(event.target.value)}
            placeholder={text("描述你想制作的视频", "Tell Know Video your explainer video idea")}
            value={prompt}
          />
          <div className="kv-home-attachment-row">
            <div>
              <button aria-label="高级设置" onClick={openAdvancedSettings} type="button"><Settings size={18} /></button>
              <button aria-label="上传参考素材" disabled={isBusy || attachments.length >= 6} onClick={onOpenAttachmentPicker} type="button"><Paperclip size={18} /></button>
              {attachments.length > 0 ? <span>{text(`${attachments.length} / 6 个参考素材`, `${attachments.length} / 6 references`)}</span> : null}
            </div>
            <button aria-label="开始生成" className="kv-home-send" disabled={isBusy || prompt.trim().length < 4} type="submit">
              {isBusy ? <Loader2 className="kv-spin" size={20} /> : <ArrowRight size={21} />}
            </button>
          </div>
          {attachments.length > 0 ? (
            <ul className="kv-home-attachments" aria-label="已选择的参考素材">
              {attachments.map((file, index) => (
                <li key={`${file.name}-${file.size}-${file.lastModified}`}>
                  <span title={file.name}>{file.name}</span>
                  <small>{file.type.startsWith("image/") ? "Image" : file.type.startsWith("video/") ? "Video" : "Audio"}</small>
                  <button aria-label={`移除 ${file.name}`} disabled={isBusy} onClick={() => onRemoveAttachment(index)} type="button"><X size={13} /></button>
                </li>
              ))}
            </ul>
          ) : null}
        </form>
        <div className="kv-home-workflows">
          {briefWorkflowCards.map((card) => {
            const Icon = card.icon;
            return (
              <button key={card.title} onClick={() => onUseExample(card.title === "Explain a concept" ? promptExamples[0] : card.title === "Turn a doc into video" ? promptExamples[1] : promptExamples[2])} type="button">
                <i><Icon size={18} /></i>
                <span><strong>{language === "zh-CN" ? briefWorkflowLocalized[card.title]?.[0] : card.title}</strong><small>{language === "zh-CN" ? card.detail : briefWorkflowLocalized[card.title]?.[1]}</small></span>
              </button>
            );
          })}
        </div>
        <div className="kv-home-categories">
          {briefCategoryPills.map((pill) => (
            <button className={activeCategory === pill ? "active" : ""} key={pill} onClick={() => chooseCategory(pill)} type="button">{language === "zh-CN" ? briefCategoryChinese[pill] : pill}</button>
          ))}
        </div>
        <div className="kv-home-templates">
          {visibleTemplateCards.map((card) => (
            <button className={`${card.className}${selectedTemplate?.title === card.title ? " active" : ""}`} key={card.title} onClick={() => chooseTemplate(card)} type="button">
              <span className="kv-template-scene" aria-hidden="true"><i /><b /><em /></span>
              <span className="kv-template-copy"><strong>{language === "zh-CN" ? card.title : briefTemplateEnglish[card.className]?.[0] ?? card.title}</strong><small>{language === "zh-CN" ? card.detail : briefTemplateEnglish[card.className]?.[1] ?? card.detail}</small><em>{styleLabel(templateStyleFor(card))}</em></span>
            </button>
          ))}
        </div>
        <details className="kv-home-advanced" ref={advancedSettingsRef}>
          <summary>{text("生成参数", "Generation settings")}</summary>
          <div className="kv-generation-options">
            <label>
              <span>{text("视频时长", "Video length")}</span>
              <select onChange={(event) => onOptionsChange({ ...options, duration: event.target.value as GenerationOptions["duration"] })} value={options.duration}>
                <option value="15">{text("约 15 秒", "About 15 seconds")}</option>
                <option value="30">{text("约 30 秒", "About 30 seconds")}</option>
                <option value="45">{text("约 45 秒", "About 45 seconds")}</option>
                <option value="60">{text("约 60 秒", "About 60 seconds")}</option>
              </select>
            </label>
            <label>
              <span>{text("场景数量", "Scene count")}</span>
              <select onChange={(event) => onOptionsChange({ ...options, sceneCount: event.target.value as GenerationOptions["sceneCount"] })} value={options.sceneCount}>
                <option value="auto">{text("自动规划", "Auto")}</option>
                <option value="3">{text("3 个场景", "3 scenes")}</option>
                <option value="5">{text("5 个场景", "5 scenes")}</option>
                <option value="6">{text("6 个场景", "6 scenes")}</option>
              </select>
            </label>
            <label>
              <span>{text("旁白语言", "Narration language")}</span>
              <select onChange={(event) => onOptionsChange({ ...options, language: event.target.value as GenerationOptions["language"] })} value={options.language}>
                <option value="中文">中国 · 中文</option>
                <option value="英文">英国 · English</option>
              </select>
            </label>
            <label>
              <span>{text("动态方式", "Motion")}</span>
              <select onChange={(event) => onOptionsChange({ ...options, motion: event.target.value as GenerationOptions["motion"] })} value={options.motion}>
                <option value="camera">{text("智能运镜（低成本）", "Smart camera motion (low cost)")}</option>
                <option value="key-scenes">{text("生成关键动态镜头（额外计费）", "Generate key video shots (additional cost)")}</option>
              </select>
            </label>
          </div>
          <GenerationSpecStrip options={options} />
          <div className="kv-generation-review" aria-label="生成前审阅清单">
            <strong>{text("生成前审阅", "Pre-generation review")}</strong>
            <div>
              {reviewItems.map((item) => (
                <span className={item.tone} key={item.label}>
                  {item.tone === "attention" ? <AlertCircle size={14} /> : item.tone === "working" ? <Clock3 size={14} /> : <Check size={14} />}
                  <small>{item.label}</small>
                  <em>{item.value}</em>
                  <b>{item.detail}</b>
                </span>
              ))}
            </div>
          </div>
        </details>
        {errorMessage ? (
          <div className="kv-inline-error" role="alert">
            <AlertCircle size={18} />
            <span>{errorMessage}</span>
          </div>
        ) : null}
        {hasCurrentProject ? (
          <button className="kv-home-current-project" onClick={onOpenStudio} type="button">
            继续编辑：{currentProject.title}
            <ChevronRight size={16} />
          </button>
        ) : null}
      </section>
      {activeSettings ? (
        <div className="kv-settings-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setActiveSettings(undefined);
        }}>
          <section
            aria-modal="true"
            className={`kv-settings-modal ${activeSettings}`}
            onDragOver={(event) => {
              if (isBusy || event.dataTransfer.types.includes("Files") === false) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }}
            onDrop={handleDropFiles}
            onPaste={handlePasteFiles}
            role="dialog"
          >
            <button aria-label={text("关闭设置", "Close settings")} className="kv-settings-close" onClick={() => setActiveSettings(undefined)} type="button"><X size={18} /></button>
            {activeSettings === "style" ? (
              <>
                <div className="kv-settings-header">
                  <h3>{text("风格库", "Style Library")}</h3>
                  <div className="kv-settings-tabs"><button className="active" disabled type="button">{text("风格", "Styles")}</button><button onClick={() => setActiveSettings("brand")} type="button">Logo</button></div>
                </div>
                <div className="kv-settings-segment" role="group" aria-label="Style mode">
                  <button className={styleMode === "animated" ? "active" : ""} onClick={() => changeStyleMode("animated")} type="button">{text("动画风格", "Animated")}</button>
                  <button className={styleMode === "realistic" ? "active" : ""} onClick={() => changeStyleMode("realistic")} type="button">{text("超写实", "Hyper Realistic")}</button>
                </div>
                <button className={`kv-style-auto${draftStyleSource === "auto" ? " active" : ""}`} onClick={draftAutoStyleChoice} type="button">
                  <i>{text("自动", "Auto")}</i>
                  <span><strong>{text("根据提示词自动选择", "Choose from your prompt")}</strong><small>{text(`当前待确认：${styleLabel(inferredVisualStyle)}`, `Suggested: ${styleLabel(inferredVisualStyle)}`)}</small></span>
                </button>
                <p className="kv-style-count">{text(`${visibleVisualStyles.length} 种风格`, `${visibleVisualStyles.length} styles`)}</p>
                <div className="kv-style-grid">
                  {visibleVisualStyles.map((style) => {
                    const active = draftStyleSource !== "auto" && draftStyleId === style.id;
                    return (
                      <button aria-pressed={active} className={active ? "active" : ""} key={style.id} onClick={() => draftVisualStyleChoice(style)} type="button">
                        <span className={`kv-style-thumb style-${style.thumbnail}`} aria-hidden="true"><i /><b /><em /></span>
                        <span className="kv-style-card-copy">
                          <strong>{styleLabel(style)}</strong>
                          <small>{styleSummary(style)}</small>
                        </span>
                        {active ? <span className="kv-style-selected" aria-hidden="true"><Check size={15} /></span> : null}
                      </button>
                    );
                  })}
                </div>
                <div className="kv-settings-actions">
                  <span>{text(`已选：${styleLabel(draftVisualStyle)}`, `Selected: ${styleLabel(draftVisualStyle)}`)}</span>
                  <button className="kv-primary" disabled={isBusy} onClick={confirmVisualStyle} type="button"><Check size={16} />{text("确认应用", "Apply")}</button>
                </div>
              </>
            ) : null}
            {activeSettings === "avatar" ? (
              <>
                <div className="kv-settings-header compact">
                  <h3>{text("数字人主持", "Avatar presenter")}</h3>
                  <p>{text("选择主持人在视频中的呈现方式。", "Choose how a presenter appears in your video.")}</p>
                </div>
                <div className="kv-settings-segment" role="group" aria-label="Avatar mode">
                  <button className={avatarMode === "none" ? "active" : ""} onClick={() => setAvatarMode("none")} type="button">{text("无", "None")}</button>
                  <button disabled title={text("即将接入主持人镜头生成", "Presenter scenes are coming soon")} type="button">{text("预设", "Preset")}</button>
                  <button disabled title={text("企业版将支持自定义数字人", "Custom avatars will be available for Enterprise")} type="button">{text("自定义", "Custom")}</button>
                </div>
                <div className="kv-avatar-panel">
                  <strong>{text("不会添加数字人镜头。", "No avatar scenes will be added.")}</strong>
                  <p>{text("主持人镜头和自定义数字人还未进入当前生成链路；可以先上传人物或风格参考素材，系统会作为画面参考使用。", "Presenter scenes and custom avatars are not yet part of generation. You can upload a presenter or style reference for visual guidance.")}</p>
                  <button onClick={onOpenAttachmentPicker} type="button"><Upload size={16} /> {text("上传人物参考", "Upload presenter reference")}</button>
                </div>
              </>
            ) : null}
            {activeSettings === "voice" ? (
              <>
                <div className="kv-settings-header compact">
                  <h3>{text("声音", "Voice")}</h3>
                  <p>{text("试听后选择默认旁白音色，适合企业介绍、课程和产品视频。", "Preview and select the default narration voice for company, course, and product videos.")}</p>
                </div>
                <label className="kv-voice-search"><Search size={16} /><input onChange={(event) => setVoiceQuery(event.target.value)} placeholder={text("搜索声音...", "Search voices...")} value={voiceQuery} /></label>
                <div className="kv-voice-enterprise"><span>{text("克隆你的声音", "Clone your voice")}</span><em>{text("企业版", "Enterprise")}</em></div>
                <div className="kv-voice-enterprise"><span>{text("添加自定义声音 ID", "Add custom voice ID")}</span><em>{text("企业版", "Enterprise")}</em></div>
                <div className="kv-brief-voice-list">
                  {filteredVoices.map((profile) => {
                    const active = selectedVoice === profile.id;
                    const playing = previewingVoice === profile.id;
                    return (
                      <article className={active ? "active" : ""} key={profile.id}>
                        <button onClick={() => chooseVoice(profile.id)} type="button">
                          <i>{profile.shortLabel.slice(0, 1)}</i>
                          <span><strong>{profile.label}</strong><small>{profile.description}</small><em>{profile.useCase}</em></span>
                        </button>
                        <button aria-label={text(`试听 ${profile.label}`, `Preview ${profile.label}`)} disabled={Boolean(previewingVoice && !playing)} onClick={() => void toggleBriefVoicePreview(profile.id)} type="button">
                          {playing && previewLoading ? <Loader2 className="kv-spin" size={15} /> : playing ? <Pause size={15} /> : <Play size={15} />}
                        </button>
                      </article>
                    );
                  })}
                </div>
                {previewError ? <p className="kv-settings-error">{previewError}</p> : null}
              </>
            ) : null}
            {activeSettings === "language" ? (
              <>
                <div className="kv-settings-header compact">
                  <h3>{text("旁白语言", "Narration language")}</h3>
                  <p>{text("只控制视频的旁白、字幕和画面文案；页面界面语言请使用右上角的中英切换。", "Controls narration, captions, and on-screen copy only. Use the switch in the top-right corner to change the interface language.")}</p>
                </div>
                <div className="kv-language-options">
                  {briefLanguageOptions.map((language) => (
                    <button
                      className={options.language === language.value ? "active" : ""}
                      key={language.value}
                      onClick={() => chooseLanguage(language.value)}
                      type="button"
                    >
                      <i>{language.code}</i>
                      <span><strong>{language.label}</strong><small>{language.country} · {language.detail}</small></span>
                      {options.language === language.value ? <Check size={17} /> : null}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            {activeSettings === "brand" ? (
              <>
                <div className="kv-settings-header compact">
                  <h3>{text("品牌套件", "Brand kit")}</h3>
                  <p>{text("设置品牌标识、色彩和参考素材，让视频更稳定地贴合企业视觉。", "Set your logo, colors, and references to keep videos aligned with your brand.")}</p>
                </div>
                <div className="kv-brand-options">
                  <button className={brandMode === "none" ? "active" : ""} onClick={() => setBrandMode("none")} type="button"><strong>{text("无", "None")}</strong><small>{text("不叠加品牌标识", "No brand overlay")}</small></button>
                  <button disabled title={text("品牌角标会在工作室的成片设置中接入", "Add a brand mark in production settings")} type="button"><strong>{text("简洁", "Minimal")}</strong><small>{text("请在成片设置中添加 Logo", "Add a logo in production settings")}</small></button>
                  <button className={brandMode === "uploaded" ? "active" : ""} onClick={() => { setBrandMode("uploaded"); onOpenAttachmentPicker(); }} type="button"><strong>{text("上传", "Upload")}</strong><small>{text("上传 Logo / 品牌参考图", "Upload a logo or brand reference")}</small></button>
                </div>
                <button className="kv-settings-upload" onClick={() => { setBrandMode("uploaded"); onOpenAttachmentPicker(); }} type="button"><ImagePlus size={18} /> {text("上传 Logo 或品牌图片", "Upload logo or brand image")}</button>
              </>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}

function GeneratingScreen({
  prompt,
  progress,
  status,
  options,
  motion,
  startedAt
}: {
  prompt: string;
  progress: number;
  status: string;
  options: GenerationOptions;
  motion: GenerationOptions["motion"];
  startedAt?: number;
}) {
  const { language, text } = useUiCopy();
  const steps = generationProgressSteps(motion);
  const activeIndex = Math.min(steps.length - 1, Math.floor(progress / (100 / steps.length)));
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="kv-generating">
      <div className="kv-render-orbit">
        <Film size={44} />
        <span />
      </div>
      <div className="kv-section-heading centered">
        <span className="kv-pill">{text("正在制作", "Creating video")}</span>
        <h2>{localizedRuntimeLabel(status, language)}</h2>
        <p>{prompt}</p>
      </div>
      <div className="kv-progress">
        <div style={{ width: `${progress}%` }} />
      </div>
      <div className="kv-generation-status-strip" role="status">
        <span><strong>{elapsedGenerationLabel(startedAt, now)}</strong><small>{text("已用时间", "Elapsed")}</small></span>
        <span><strong>{Math.min(activeIndex + 1, steps.length)} / {steps.length}</strong><small>{text("当前步骤", "Current step")}</small></span>
        <span><strong>{text("自动恢复", "Auto recovery")}</strong><small>{text("刷新后继续找回任务", "Resume after refresh")}</small></span>
      </div>
      <GenerationSpecStrip options={options} />
      <div className="kv-progress-steps">
        {steps.map((step, index) => (
          <div className={index <= activeIndex ? "done" : ""} key={step}>
            {index < activeIndex ? <Check size={16} /> : index === activeIndex ? <Loader2 className="kv-spin" size={16} /> : <span />}
            <p>{localizedRuntimeLabel(step, language)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Storyboard({
  scenes,
  selectedScene,
  isBusy,
  onSelect,
  onMutate,
  onRegenerate,
  onRegenerateAudio,
  onGenerateClip
}: {
  scenes: Scene[];
  selectedScene: number;
  isBusy: boolean;
  onSelect: (scene: number) => void;
  onMutate: (mutation: SceneStructureMutation) => void;
  onRegenerate: (sceneNumbers?: number[]) => void;
  onRegenerateAudio: (sceneNumbers?: number[]) => void;
  onGenerateClip: (sceneNumber: number) => void;
}) {
  const { text } = useUiCopy();
  const scene = scenes.find((item) => item.sceneNumber === selectedScene) ?? scenes[0];
  const selectedMediaState = scene ? sceneMediaState(scene) : undefined;
  const selectedMediaDiagnostics = scene ? sceneMediaDiagnosticItems(scene) : [];
  const [duration, setDuration] = useState(scene?.durationSeconds ?? 5);
  const [transitionKind, setTransitionKind] = useState<SceneTransitionKind>(scene?.style.transition?.kind ?? "auto");
  const [transitionDuration, setTransitionDuration] = useState(scene?.style.transition?.durationSeconds ?? 0.65);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draggedSceneNumber, setDraggedSceneNumber] = useState<number>();
  const [dropTargetSceneNumber, setDropTargetSceneNumber] = useState<number>();
  const dragSourceRef = useRef<number>();
  const dragTargetRef = useRef<number>();

  useEffect(() => {
    setDuration(scene?.durationSeconds ?? 5);
    setTransitionKind(scene?.style.transition?.kind ?? "auto");
    setTransitionDuration(scene?.style.transition?.durationSeconds ?? 0.65);
    setConfirmDelete(false);
  }, [scene?.id, scene?.durationSeconds, scene?.style.transition?.durationSeconds, scene?.style.transition?.kind]);

  const savedTransitionKind = scene?.style.transition?.kind ?? "auto";
  const savedTransitionDuration = scene?.style.transition?.durationSeconds ?? 0.65;
  const transitionChanged = transitionKind !== savedTransitionKind
    || (transitionKind !== "cut" && transitionDuration !== savedTransitionDuration);

  function clearDragState() {
    dragSourceRef.current = undefined;
    dragTargetRef.current = undefined;
    setDraggedSceneNumber(undefined);
    setDropTargetSceneNumber(undefined);
  }

  function setDragState(sourceSceneNumber: number, targetSceneNumber = sourceSceneNumber) {
    dragSourceRef.current = sourceSceneNumber;
    dragTargetRef.current = targetSceneNumber;
    setDraggedSceneNumber(sourceSceneNumber);
    setDropTargetSceneNumber(targetSceneNumber);
  }

  function startDrag(event: DragEvent<HTMLButtonElement>, sceneNumber: number) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(sceneNumber));
    setDragState(sceneNumber);
  }

  function dropScene(event: DragEvent<HTMLButtonElement>, targetSceneNumber: number) {
    event.preventDefault();
    const sourceSceneNumber = draggedSceneNumber ?? Number(event.dataTransfer.getData("text/plain"));
    clearDragState();
    if (!Number.isInteger(sourceSceneNumber) || sourceSceneNumber === targetSceneNumber) return;
    onMutate({ operation: "move-to", sceneNumber: sourceSceneNumber, targetSceneNumber });
  }

  function updatePointerTarget(clientX: number, clientY: number) {
    const target = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-scene-number]");
    const sceneNumber = Number(target?.dataset.sceneNumber);
    if (!Number.isInteger(sceneNumber) || sceneNumber === dragTargetRef.current) return;
    dragTargetRef.current = sceneNumber;
    setDropTargetSceneNumber(sceneNumber);
  }

  function startPointerDrag(event: ReactPointerEvent<HTMLSpanElement>, sceneNumber: number) {
    if (isBusy) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragState(sceneNumber);
  }

  function movePointerDrag(event: ReactPointerEvent<HTMLSpanElement>) {
    if (dragSourceRef.current === undefined) return;
    event.preventDefault();
    updatePointerTarget(event.clientX, event.clientY);
  }

  function finishPointerDrag(event: ReactPointerEvent<HTMLSpanElement>) {
    const sourceSceneNumber = dragSourceRef.current;
    const targetSceneNumber = dragTargetRef.current;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    clearDragState();
    if (sourceSceneNumber === undefined || targetSceneNumber === undefined || sourceSceneNumber === targetSceneNumber) return;
    onMutate({ operation: "move-to", sceneNumber: sourceSceneNumber, targetSceneNumber });
  }

  return (
    <section className="kv-storyboard">
      <div className="kv-strip-heading">
        <h3>{text("分镜时间线", "Storyboard timeline")}</h3>
        <span>{text(`${scenes.length} 个场景`, `${scenes.length} scenes`)}</span>
      </div>
      {scene ? (
        <>
        <div className="kv-scene-readiness-card">
          <div>
            <strong>S{scene.sceneNumber} · {sceneMediaStatusLabel(scene)}</strong>
            <span>{text("画面、配音齐全后才能稳定预览和导出；动态镜头可让关键场景更像真实视频。", "Complete visuals and narration for reliable preview and export. Motion clips make key scenes feel more like video.")}</span>
            <div className="kv-scene-media-diagnostics" aria-label={text("本场景素材诊断", "Scene asset diagnostics")}>
              {selectedMediaDiagnostics.map((item) => (
                <span className={item.status} key={item.key}>
                  {item.status === "ready" ? <Check size={13} /> : item.status === "optional" ? <Clapperboard size={13} /> : <AlertCircle size={13} />}
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </span>
              ))}
            </div>
          </div>
          <div>
            <button disabled={isBusy || selectedMediaState?.visualReady} onClick={() => onRegenerate([scene.sceneNumber])} type="button">
              {isBusy ? <Loader2 className="kv-spin" size={15} /> : <ImagePlus size={15} />}
              {selectedMediaState?.visualReady ? text("画面已就绪", "Visual ready") : text("生成本场景画面", "Generate scene visual")}
            </button>
            <button disabled={isBusy || selectedMediaState?.audioReady} onClick={() => onRegenerateAudio([scene.sceneNumber])} type="button">
              {isBusy ? <Loader2 className="kv-spin" size={15} /> : <Mic2 size={15} />}
              {selectedMediaState?.audioReady ? text("配音已就绪", "Narration ready") : text("生成本场景配音", "Generate scene narration")}
            </button>
            <button disabled={isBusy || !selectedMediaState?.visualReady} onClick={() => onGenerateClip(scene.sceneNumber)} type="button">
              {isBusy ? <Loader2 className="kv-spin" size={15} /> : <Clapperboard size={15} />}
              {selectedMediaState?.motionReady ? text("重做动态镜头", "Regenerate motion") : text("生成动态镜头", "Generate motion")}
            </button>
          </div>
        </div>
        <div className="kv-timeline-controls">
          <strong>S{scene.sceneNumber}</strong>
          <label>
            <Clock3 size={15} />
            <span>{text("时长", "Duration")}</span>
            <input
              aria-label={text(`场景 ${scene.sceneNumber} 时长`, `Scene ${scene.sceneNumber} duration`)}
              disabled={isBusy}
              max="20"
              min="2"
              onChange={(event) => setDuration(Number(event.target.value))}
              type="number"
              value={duration}
            />
            <span>{text("秒", "sec")}</span>
          </label>
          <button
            disabled={isBusy || duration === scene.durationSeconds || !Number.isInteger(duration) || duration < 2 || duration > 20}
            onClick={() => onMutate({ operation: "set-duration", sceneNumber: scene.sceneNumber, durationSeconds: duration })}
            type="button"
          >
            <Check size={15} />{text("更新时长", "Update duration")}
          </button>
          {scene.sceneNumber > 1 ? (
            <>
              <span className="kv-timeline-divider" />
              <label className="kv-transition-control">
                <Sparkles size={15} />
                <span>{text("进入转场", "Transition in")}</span>
                <select
                  aria-label={`场景 ${scene.sceneNumber} 进入转场`}
                  disabled={isBusy}
                  onChange={(event) => {
                    const nextKind = event.target.value as SceneTransitionKind;
                    setTransitionKind(nextKind);
                    if (nextKind !== "cut" && transitionDuration < 0.2) setTransitionDuration(0.65);
                  }}
                  value={transitionKind}
                >
                  {transitionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label className="kv-transition-control">
                <span>{text("时长", "Duration")}</span>
                <select
                  aria-label={`场景 ${scene.sceneNumber} 转场时长`}
                  disabled={isBusy || transitionKind === "cut"}
                  onChange={(event) => setTransitionDuration(Number(event.target.value))}
                  value={transitionDuration}
                >
                  {![0.25, 0.5, 0.65, 0.75, 1, 1.2].includes(transitionDuration) ? (
                    <option value={transitionDuration}>{transitionDuration} 秒</option>
                  ) : null}
                  <option value="0.25">0.25 秒</option>
                  <option value="0.5">0.5 秒</option>
                  <option value="0.65">0.65 秒 · 自然</option>
                  <option value="0.75">0.75 秒</option>
                  <option value="1">1 秒</option>
                  <option value="1.2">1.2 秒 · 舒缓</option>
                </select>
              </label>
              <button
                disabled={isBusy || !transitionChanged}
                onClick={() => onMutate({
                  operation: "set-transition",
                  sceneNumber: scene.sceneNumber,
                  kind: transitionKind,
                  durationSeconds: transitionKind === "cut" ? 0 : transitionDuration
                })}
                type="button"
              >
                <Check size={15} />{text("应用转场", "Apply transition")}
              </button>
            </>
          ) : <span className="kv-opening-scene-label">{text("开场镜头", "Opening scene")}</span>}
          <span className="kv-timeline-divider" />
          <button aria-label={text("向前移动场景", "Move scene earlier")} disabled={isBusy || scene.sceneNumber === 1} onClick={() => onMutate({ operation: "move", sceneNumber: scene.sceneNumber, direction: "earlier" })} title={text("向前移动", "Move earlier")} type="button"><ArrowLeft size={16} /></button>
          <button aria-label={text("向后移动场景", "Move scene later")} disabled={isBusy || scene.sceneNumber === scenes.length} onClick={() => onMutate({ operation: "move", sceneNumber: scene.sceneNumber, direction: "later" })} title={text("向后移动", "Move later")} type="button"><ArrowRight size={16} /></button>
          <label className="kv-move-to-control">
            <span>{text("移到", "Move to")}</span>
            <select
              aria-label={`场景 ${scene.sceneNumber} 目标位置`}
              disabled={isBusy}
              onChange={(event) => {
                const targetSceneNumber = Number(event.target.value);
                if (targetSceneNumber !== scene.sceneNumber) {
                  onMutate({ operation: "move-to", sceneNumber: scene.sceneNumber, targetSceneNumber });
                }
              }}
              value={scene.sceneNumber}
            >
              {scenes.map((item) => <option key={item.id} value={item.sceneNumber}>{text(`第 ${item.sceneNumber} 位`, `Position ${item.sceneNumber}`)}</option>)}
            </select>
          </label>
          <button
            aria-label="拆分当前场景"
            disabled={isBusy || scenes.length >= 20 || scene.durationSeconds < 4 || scene.voiceover.trim().length < 8}
            onClick={() => onMutate({ operation: "split", sceneNumber: scene.sceneNumber })}
            title="按旁白拆分为两个镜头"
            type="button"
          ><Scissors size={16} /></button>
          <button
            aria-label="与后一场景合并"
            disabled={isBusy || scene.sceneNumber === scenes.length || scene.durationSeconds + (scenes[scene.sceneNumber]?.durationSeconds ?? 0) > 20}
            onClick={() => onMutate({ operation: "merge-next", sceneNumber: scene.sceneNumber })}
            title="与后一场景合并"
            type="button"
          ><Combine size={16} /></button>
          <button aria-label="复制场景" disabled={isBusy || scenes.length >= 20} onClick={() => onMutate({ operation: "duplicate", sceneNumber: scene.sceneNumber })} title="复制场景" type="button"><Copy size={16} /></button>
          {confirmDelete ? (
            <div className="kv-delete-confirm">
              <span>{text(`删除 S${scene.sceneNumber}？`, `Delete S${scene.sceneNumber}?`)}</span>
              <button disabled={isBusy} onClick={() => onMutate({ operation: "delete", sceneNumber: scene.sceneNumber })} type="button">{text("确认", "Confirm")}</button>
              <button aria-label={text("取消删除", "Cancel deletion")} disabled={isBusy} onClick={() => setConfirmDelete(false)} title={text("取消", "Cancel")} type="button"><X size={15} /></button>
            </div>
          ) : (
            <button aria-label={text("删除场景", "Delete scene")} className="danger" disabled={isBusy || scenes.length <= 1} onClick={() => setConfirmDelete(true)} title={text("删除场景", "Delete scene")} type="button"><Trash2 size={16} /></button>
          )}
        </div>
        </>
      ) : null}
      <div className="kv-scene-strip">
        {scenes.map((scene) => {
          const mediaState = sceneMediaState(scene);
          return (
          <button
            aria-label={`场景 ${scene.sceneNumber} ${scene.title}，拖动可调整顺序`}
            className={[
              scene.sceneNumber === selectedScene ? "active" : "",
              !mediaState.ready ? "needs-media" : "",
              scene.sceneNumber === draggedSceneNumber ? "dragging" : "",
              scene.sceneNumber === dropTargetSceneNumber && scene.sceneNumber !== draggedSceneNumber ? "drop-target" : ""
            ].filter(Boolean).join(" ")}
            draggable={!isBusy}
            data-scene-number={scene.sceneNumber}
            key={scene.id}
            onDragEnd={clearDragState}
            onDragOver={(event) => {
              if (isBusy || draggedSceneNumber === undefined) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDropTargetSceneNumber(scene.sceneNumber);
            }}
            onDragStart={(event) => startDrag(event, scene.sceneNumber)}
            onDrop={(event) => dropScene(event, scene.sceneNumber)}
            onClick={() => onSelect(scene.sceneNumber)}
            type="button"
          >
            <span
              aria-hidden="true"
              className="kv-drag-handle"
              onPointerCancel={clearDragState}
              onPointerDown={(event) => startPointerDrag(event, scene.sceneNumber)}
              onPointerMove={movePointerDrag}
              onPointerUp={finishPointerDrag}
              title="拖动调整顺序"
            ><GripVertical size={15} /></span>
            {scenePreviewAsset(scene) ? (
              <span
                className="kv-scene-thumb"
                style={{ backgroundImage: `url("${scenePreviewAsset(scene)?.url}")` }}
              />
            ) : scene.assets.some((asset) => asset.type === "clip" && asset.url)
              ? <span className="kv-scene-thumb empty clip"><FileVideo2 size={18} /></span>
              : <span className="kv-scene-thumb empty"><ImagePlus size={18} /></span>}
            <span className="kv-scene-number">S{scene.sceneNumber}</span>
            <strong>{scene.title}</strong>
            <small>{text(`${scene.durationSeconds} 秒`, `${scene.durationSeconds} sec`)}</small>
            <span className={`kv-scene-media-status ${mediaState.ready ? "ready" : "partial"}`}>
              {sceneMediaStatusLabel(scene)}
            </span>
            <span className="kv-scene-asset-dots" aria-label={`场景 ${scene.sceneNumber} 素材状态`}>
              {sceneMediaDiagnosticItems(scene).map((item) => (
                <i className={item.status} key={item.key} title={`${item.label}：${item.detail}`}>
                  {item.label}
                </i>
              ))}
            </span>
          </button>
          );
        })}
      </div>
    </section>
  );
}

type SceneTextEdits = Pick<Scene, "title" | "voiceover" | "visualPrompt" | "motionPrompt">;

function ScenePanel({
  scene,
  scenes,
  isBusy,
  onSave,
  onVoiceChange
}: {
  scene?: Scene;
  scenes: Scene[];
  isBusy: boolean;
  onSave: (sceneNumber: number, edits: SceneTextEdits) => void;
  onVoiceChange: (sceneNumbers: number[], voice: NarrationVoice) => void;
}) {
  const { text } = useUiCopy();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<SceneTextEdits>({ title: "", voiceover: "", visualPrompt: "", motionPrompt: "" });
  const [selectedVoice, setSelectedVoice] = useState<NarrationVoice>(DEFAULT_NARRATION_VOICE);
  const [voiceScope, setVoiceScope] = useState<"scene" | "all">("all");
  const [previewingVoice, setPreviewingVoice] = useState<NarrationVoice>();
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string>();
  const previewAudioRef = useRef<HTMLAudioElement>();
  const previewAbortRef = useRef<AbortController>();
  const previewUrlsRef = useRef(new Map<NarrationVoice, string>());
  const imageMetadata = scene?.assets.find((asset) => asset.type === "image")?.metadata;
  const qualityLabel = imageMetadata?.quality === "premium"
    || String(imageMetadata?.model ?? "").includes("klein-9b")
    ? text("精细画质", "Enhanced quality")
    : text("标准画质", "Standard quality");

  useEffect(() => {
    if (!scene) return;
    setDraft({
      title: scene.title,
      voiceover: scene.voiceover,
      visualPrompt: scene.visualPrompt,
      motionPrompt: scene.motionPrompt
    });
    setSelectedVoice(scene.style.narrationVoice ?? DEFAULT_NARRATION_VOICE);
    setEditing(false);
    previewAudioRef.current?.pause();
    previewAudioRef.current = undefined;
    previewAbortRef.current?.abort();
    previewAbortRef.current = undefined;
    setPreviewingVoice(undefined);
    setPreviewLoading(false);
    setPreviewError(undefined);
  }, [scene?.id]);

  useEffect(() => () => {
    previewAbortRef.current?.abort();
    previewAudioRef.current?.pause();
    previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrlsRef.current.clear();
  }, []);

  const changed = Boolean(scene) && (
    draft.title.trim() !== scene?.title
    || draft.voiceover.trim() !== scene?.voiceover
    || draft.visualPrompt.trim() !== scene?.visualPrompt
    || draft.motionPrompt.trim() !== scene?.motionPrompt
  );
  const voiceChanged = voiceScope === "all"
    ? scenes.some((item) => selectedVoice !== (item.style.narrationVoice ?? DEFAULT_NARRATION_VOICE))
    : Boolean(scene) && selectedVoice !== (scene?.style.narrationVoice ?? DEFAULT_NARRATION_VOICE);
  const voiceProfile = narrationVoiceProfile(selectedVoice);
  const targetSceneNumbers = voiceScope === "all"
    ? scenes.map((item) => item.sceneNumber)
    : scene ? [scene.sceneNumber] : [];

  async function toggleVoicePreview(voice: NarrationVoice) {
    if (previewingVoice === voice) {
      previewAbortRef.current?.abort();
      previewAbortRef.current = undefined;
      previewAudioRef.current?.pause();
      if (previewAudioRef.current) previewAudioRef.current.currentTime = 0;
      previewAudioRef.current = undefined;
      setPreviewingVoice(undefined);
      setPreviewLoading(false);
      return;
    }
    previewAbortRef.current?.abort();
    previewAudioRef.current?.pause();
    previewAudioRef.current = undefined;
    setPreviewError(undefined);
    setPreviewingVoice(voice);
    setPreviewLoading(true);
    const controller = new AbortController();
    previewAbortRef.current = controller;
    try {
      let url = previewUrlsRef.current.get(voice);
      if (!url) {
        const response = await fetch("/api/assets/audio/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ voice }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(65_000)])
        });
        if (!response.ok) {
          const detail = await response.json().catch(() => undefined) as { error?: string } | undefined;
          throw new Error(detail?.error || "试听加载失败。请稍后重试。");
        }
        url = URL.createObjectURL(await response.blob());
        previewUrlsRef.current.set(voice, url);
      }
      const audio = new Audio(url);
      if (controller.signal.aborted) return;
      previewAbortRef.current = undefined;
      previewAudioRef.current = audio;
      audio.onended = () => {
        previewAudioRef.current = undefined;
        setPreviewingVoice(undefined);
        setPreviewLoading(false);
      };
      audio.onerror = () => {
        previewAudioRef.current = undefined;
        setPreviewingVoice(undefined);
        setPreviewLoading(false);
        setPreviewError("试听音频无法播放，请稍后重试。");
      };
      await audio.play();
      setPreviewLoading(false);
    } catch (error) {
      if (controller.signal.aborted) return;
      previewAbortRef.current = undefined;
      previewAudioRef.current = undefined;
      setPreviewingVoice(undefined);
      setPreviewLoading(false);
      setPreviewError(error instanceof Error ? error.message : "试听加载失败。请稍后重试。");
    }
  }

  return (
    <section className="kv-scene-panel" id="kv-scene-panel">
      <div className="kv-strip-heading">
        <div className="kv-scene-heading-copy">
          <h3>{editing ? text(`编辑场景 ${scene?.sceneNumber ?? ""}`, `Edit scene ${scene?.sceneNumber ?? ""}`) : text("场景制作说明", "Scene production notes")}</h3>
          <span>{scene?.style.theme ?? "theme"} · {qualityLabel}</span>
        </div>
        {scene ? (
          <div className="kv-scene-panel-actions">
            <button disabled={isBusy} onClick={() => setEditing((current) => !current)} type="button">
              {editing ? <RotateCcw size={15} /> : <Pencil size={15} />}
              {editing ? text("取消编辑", "Cancel editing") : text("直接编辑", "Edit directly")}
            </button>
          </div>
        ) : null}
      </div>
      {scene ? (
        <section aria-label={text("企业配音设置", "Narration settings")} className="kv-voice-studio">
          <div className="kv-voice-studio-heading">
            <div>
              <span><Volume2 size={15} /> {text("企业配音", "Narration voice")}</span>
              <p>{text("试听后可应用到当前场景或整片；应用时会重新生成配音。", "Preview a voice, then apply it to this scene or the full video. Narration will be regenerated.")}</p>
            </div>
            <div aria-label="配音应用范围" className="kv-voice-scope" role="group">
              <button aria-pressed={voiceScope === "scene"} className={voiceScope === "scene" ? "active" : ""} onClick={() => setVoiceScope("scene")} type="button">{text("当前场景", "Current scene")}</button>
              <button aria-pressed={voiceScope === "all"} className={voiceScope === "all" ? "active" : ""} onClick={() => setVoiceScope("all")} type="button">{text("整片", "Full video")}</button>
            </div>
          </div>
          <div className="kv-voice-options">
            {narrationVoiceProfiles.map((profile) => {
              const active = selectedVoice === profile.id;
              const playing = previewingVoice === profile.id;
              return (
                <article className={active ? "active" : ""} key={profile.id}>
                  <button
                    aria-pressed={active}
                    className="kv-voice-select"
                    disabled={isBusy}
                    onClick={() => setSelectedVoice(profile.id)}
                    type="button"
                  >
                    <i aria-hidden="true"><Mic2 size={16} /></i>
                    <span><strong>{profile.label}</strong><small>{profile.description}</small></span>
                    <em>{profile.useCase}</em>
                  </button>
                  <button
                    aria-label={`${playing ? "停止" : "试听"}${profile.label}`}
                    className="kv-voice-preview"
                    disabled={isBusy || Boolean(previewingVoice && !playing)}
                    onClick={() => void toggleVoicePreview(profile.id)}
                    title={`${playing ? "停止" : "试听"}${profile.label}`}
                    type="button"
                  >
                    {playing && previewLoading ? <Loader2 className="kv-spin" size={15} /> : playing ? <Pause size={15} /> : <Play size={15} />}
                    {playing && previewLoading ? text("取消", "Cancel") : playing ? text("停止", "Stop") : text("试听", "Preview")}
                  </button>
                </article>
              );
            })}
          </div>
          <div className="kv-voice-apply-row">
            <p aria-live="polite">{previewError ?? `${voiceProfile.shortLabel} · ${voiceProfile.useCase}`}</p>
            <button
              className="kv-primary"
              disabled={isBusy || !voiceChanged || targetSceneNumbers.length === 0}
              onClick={() => onVoiceChange(targetSceneNumbers, selectedVoice)}
              title={voiceProfile.description}
              type="button"
            >
              {isBusy ? <Loader2 className="kv-spin" size={16} /> : <Check size={16} />}
              {voiceScope === "all" ? text("应用到整片", "Apply to full video") : text(`应用到场景 ${scene.sceneNumber}`, `Apply to scene ${scene.sceneNumber}`)}
            </button>
          </div>
        </section>
      ) : null}
      {editing && scene ? (
        <div className="kv-scene-editor">
          <label className="wide">
            <span>{text("场景标题", "Scene title")}</span>
            <input onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} value={draft.title} />
          </label>
          <label>
            <span>{text("旁白", "Narration")}</span>
            <textarea onChange={(event) => setDraft((current) => ({ ...current, voiceover: event.target.value }))} value={draft.voiceover} />
          </label>
          <label>
            <span>{text("画面设计", "Visual direction")}</span>
            <textarea onChange={(event) => setDraft((current) => ({ ...current, visualPrompt: event.target.value }))} value={draft.visualPrompt} />
          </label>
          <label className="wide">
            <span>{text("镜头运动", "Camera motion")}</span>
            <textarea onChange={(event) => setDraft((current) => ({ ...current, motionPrompt: event.target.value }))} value={draft.motionPrompt} />
          </label>
          <div className="kv-scene-editor-actions">
            <p>{text("保存会创建新版本，并只重做受影响的画面或配音。", "Saving creates a new version and regenerates only affected visuals or narration.")}</p>
            <button
              className="kv-primary"
              disabled={isBusy || !changed || Object.values(draft).some((value) => value.trim().length === 0)}
              onClick={() => onSave(scene.sceneNumber, {
                title: draft.title.trim(),
                voiceover: draft.voiceover.trim(),
                visualPrompt: draft.visualPrompt.trim(),
                motionPrompt: draft.motionPrompt.trim()
              })}
              type="button"
            >
              {isBusy ? <Loader2 className="kv-spin" size={16} /> : <Check size={16} />}
              {text("保存为新版本", "Save as new version")}
            </button>
          </div>
        </div>
      ) : (
        <div className="kv-scene-grid">
          <article>
            <span>{text("旁白", "Narration")}</span>
            <p>{scene?.voiceover ?? text("暂无旁白。", "No voiceover yet.")}</p>
          </article>
          <article>
            <span>{text("画面设计", "Visual direction")}</span>
            <p>{scene?.visualPrompt ?? text("暂无画面提示词。", "No visual prompt yet.")}</p>
          </article>
          <article>
            <span>{text("镜头运动", "Camera motion")}</span>
            <p>{scene?.motionPrompt ?? text("暂无动态提示词。", "No motion prompt yet.")}</p>
          </article>
        </div>
      )}
    </section>
  );
}

function StoryboardBoard({ scenes }: { scenes: Scene[] }) {
  return (
    <section className="kv-board">
      {scenes.map((scene) => {
        const image = scenePreviewAsset(scene);
        return (
        <article key={scene.id}>
          {image ? (
            <div
              className="kv-board-image"
              style={{ backgroundImage: `url("${image.url}")` }}
            />
          ) : scene.assets.some((asset) => asset.type === "clip" && asset.url)
            ? <div className="kv-board-image empty clip"><FileVideo2 size={24} /><span>已使用视频片段</span></div>
            : <div className="kv-board-image empty"><ImagePlus size={24} /><span>等待生成画面</span></div>}
          <div>
            <span>S{scene.sceneNumber}</span>
            <strong>{scene.title}</strong>
            <small>{scene.durationSeconds}s</small>
          </div>
          <p>{scene.voiceover}</p>
          <ul>
            <li>{compactText(scene.visualPrompt, "Visual prompt", 120)}</li>
            <li>{compactText(scene.motionPrompt, "Motion prompt", 120)}</li>
          </ul>
        </article>
      );})}
    </section>
  );
}

function VisualCandidateComparison({
  scene,
  initialCandidateId,
  isBusy,
  onClose,
  onAdopt
}: {
  scene: Scene;
  initialCandidateId: string;
  isBusy: boolean;
  onClose: () => void;
  onAdopt: (assetId: string) => void;
}) {
  const { text } = useUiCopy();
  const candidates = scene.assets.filter((asset) => asset.type === "thumbnail" && asset.metadata?.candidate === true && asset.url);
  const currentImage = scene.assets.find((asset) => asset.type === "image" && asset.url);
  const initialIndex = Math.max(0, candidates.findIndex((asset) => asset.id === initialCandidateId));
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const selected = candidates[Math.min(selectedIndex, Math.max(0, candidates.length - 1))];
  const hasClip = scene.assets.some((asset) => asset.type === "clip" && asset.url);
  const impactItems = [
    text("创建可恢复的新版本", "Create a restorable version"),
    text("替换当前场景画面", "Replace the current scene visual"),
    hasClip ? text("移除本场景动态镜头", "Remove this scene's motion clip") : "",
    text("需要重新导出 MP4", "MP4 must be exported again")
  ].filter(Boolean);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (candidates.length > 0 && event.key === "ArrowLeft") setSelectedIndex((index) => (index - 1 + candidates.length) % candidates.length);
      if (candidates.length > 0 && event.key === "ArrowRight") setSelectedIndex((index) => (index + 1) % candidates.length);
      if (event.key === "Tab") {
        const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [candidates.length, onClose]);

  if (!currentImage || !selected) return null;
  const selectCandidate = (direction: -1 | 1) => {
    setSelectedIndex((index) => (index + direction + candidates.length) % candidates.length);
  };

  return (
    <div className="kv-modal-backdrop kv-visual-compare-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }} role="presentation">
      <section aria-labelledby="visual-compare-title" aria-modal="true" className="kv-visual-compare" ref={dialogRef} role="dialog">
        <header>
          <div>
            <span className="kv-eyebrow">{text(`场景 ${scene.sceneNumber} · 视觉对比`, `Scene ${scene.sceneNumber} · Visual comparison`)}</span>
            <h3 id="visual-compare-title">{text("选择更合适的场景画面", "Choose the better scene visual")}</h3>
          </div>
          <button aria-label={text("关闭画面对比", "Close visual comparison")} onClick={onClose} ref={closeRef} title={text("关闭", "Close")} type="button"><X size={19} /></button>
        </header>
        <div className="kv-visual-compare-stage">
          <figure>
            <figcaption><span>{text("当前画面", "Current visual")}</span><small>{text("视频正在使用", "In use")}</small></figcaption>
            <div style={{ backgroundImage: `url("${currentImage.url}")` }} />
          </figure>
          <ArrowRight aria-hidden="true" className="kv-visual-compare-arrow" size={22} />
          <figure>
            <figcaption><span>{text("候选画面", "Candidate")}</span><small aria-live="polite">{selectedIndex + 1} / {candidates.length}</small></figcaption>
            <div style={{ backgroundImage: `url("${selected.url}")` }} />
          </figure>
        </div>
        <div className="kv-visual-compare-details">
          <div>
            <strong>{scene.title}</strong>
            <p>{compactText(String(selected.metadata?.candidateInstruction ?? scene.visualPrompt), scene.visualPrompt, 190)}</p>
          </div>
          <div className="kv-visual-candidate-nav" aria-label="切换候选画面">
            <button aria-label={text("上一张候选画面", "Previous candidate")} disabled={candidates.length < 2} onClick={() => selectCandidate(-1)} title={text("上一张", "Previous")} type="button"><ArrowLeft size={17} /></button>
            <div>{candidates.map((candidate, index) => (
              <button aria-label={`查看候选画面 ${index + 1}`} className={index === selectedIndex ? "active" : ""} key={candidate.id} onClick={() => setSelectedIndex(index)} type="button" />
            ))}</div>
            <button aria-label={text("下一张候选画面", "Next candidate")} disabled={candidates.length < 2} onClick={() => selectCandidate(1)} title={text("下一张", "Next")} type="button"><ArrowRight size={17} /></button>
          </div>
        </div>
        <footer>
          <div className="kv-visual-adopt-impact" aria-label="采用候选后的影响">
            {impactItems.map((item) => <span key={item}><Check size={13} />{item}</span>)}
          </div>
          <div className="kv-visual-compare-actions">
            <button disabled={isBusy} onClick={onClose} type="button">{text("继续比较", "Keep comparing")}</button>
            <button className="kv-primary" disabled={isBusy} onClick={() => onAdopt(selected.id)} type="button"><Check size={17} />{text("采用这张画面", "Use this visual")}</button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function SceneAssetsPanel({
  scene,
  isBusy,
  uploadProgress,
  onGenerateCandidate,
  onAdoptCandidate,
  openComparisonId,
  onComparisonOpened,
  onUpload,
  onRemove
}: {
  scene: Scene;
  isBusy: boolean;
  uploadProgress?: number;
  onGenerateCandidate: (instruction?: string) => void;
  onAdoptCandidate: (assetId: string) => void;
  openComparisonId?: string;
  onComparisonOpened: () => void;
  onUpload: () => void;
  onRemove: (assetId: string) => void;
}) {
  const { text } = useUiCopy();
  const assets = scene.assets.filter((asset) => ["image", "thumbnail", "clip", "audio"].includes(asset.type));
  const candidateCount = assets.filter((asset) => asset.type === "thumbnail" && asset.metadata?.candidate === true).length;
  const hasCurrentImage = assets.some((asset) => asset.type === "image" && asset.url);
  const [comparisonId, setComparisonId] = useState<string>();
  const [candidateComposerOpen, setCandidateComposerOpen] = useState(false);
  const [candidateInstruction, setCandidateInstruction] = useState("");
  useEffect(() => {
    setComparisonId(undefined);
    setCandidateComposerOpen(false);
    setCandidateInstruction("");
  }, [scene.id]);
  useEffect(() => {
    if (!openComparisonId) return;
    const available = assets.some((asset) => asset.id === openComparisonId && asset.type === "thumbnail" && asset.metadata?.candidate === true);
    if (!available) return;
    setComparisonId(openComparisonId);
    onComparisonOpened();
  }, [assets, onComparisonOpened, openComparisonId]);
  return (
    <>
    <section className="kv-assets-panel">
      <div className="kv-strip-heading">
        <div>
          <span className="kv-eyebrow">{text(`场景 ${scene.sceneNumber} 素材`, `Scene ${scene.sceneNumber} assets`)}</span>
          <h3>{text("管理当前画面、视频片段和配音", "Manage visuals, video clips, and narration")}</h3>
        </div>
        <div className="kv-assets-actions">
          <button
            aria-expanded={candidateComposerOpen}
            disabled={isBusy || candidateCount >= 3 || !hasCurrentImage}
            onClick={() => setCandidateComposerOpen((open) => !open)}
            title={!hasCurrentImage ? text("请先生成当前场景画面", "Generate the current scene visual first") : candidateCount >= 3 ? text("请先移除一张候选画面", "Remove a candidate first") : text("按要求生成新画面但不替换当前版本", "Generate a candidate without replacing the current version")}
            type="button"
          >
            <Sparkles size={16} />
            {text("改造画面", "Create candidate")} · {candidateCount}/3
          </button>
          <button disabled={isBusy} onClick={onUpload} type="button">
            {uploadProgress !== undefined ? <Loader2 className="kv-spin" size={16} /> : <Upload size={16} />}
            {uploadProgress !== undefined ? text(`上传 ${uploadProgress}%`, `Uploading ${uploadProgress}%`) : text("添加或替换", "Add or replace")}
          </button>
        </div>
      </div>
      {candidateComposerOpen ? (
        <form className="kv-candidate-composer" onSubmit={(event) => {
          event.preventDefault();
          onGenerateCandidate(candidateInstruction.trim() || "保持主体与叙事不变，优化构图、光影和空间层次，使画面更精致。");
          setCandidateComposerOpen(false);
        }}>
          <div>
            <label htmlFor={`candidate-instruction-${scene.id}`}>{text("这张画面要怎么改？", "How should this visual change?")}</label>
            <span>{candidateInstruction.length}/600</span>
          </div>
          <textarea
            autoFocus
            id={`candidate-instruction-${scene.id}`}
            maxLength={600}
            onChange={(event) => setCandidateInstruction(event.target.value)}
            placeholder={text("例如：保持人物和构图不变，改成明亮自然光，去掉画面中的文字。", "For example: keep the subject and composition, use bright natural light, and remove text from the image.")}
            value={candidateInstruction}
          />
          <div className="kv-candidate-presets" aria-label="快捷视觉修改">
            {["整体更明亮通透", "去掉画面内的文字", "突出主体，弱化背景", "增强电影级光影"].map((preset) => (
              <button key={preset} onClick={() => setCandidateInstruction(preset)} type="button">{preset}</button>
            ))}
          </div>
          <footer>
            <p>{text("只生成候选，不改变当前视频。", "Creates a candidate without changing the current video.")}</p>
            <div>
              <button onClick={() => setCandidateComposerOpen(false)} type="button">{text("取消", "Cancel")}</button>
              <button className="kv-primary" disabled={isBusy} type="submit"><Sparkles size={16} />{text("生成候选画面", "Generate candidate")}</button>
            </div>
          </footer>
        </form>
      ) : null}
      <div className="kv-asset-list">
        {assets.length === 0 ? (
          <div className="kv-assets-empty"><ImagePlus size={20} />{text("这个场景还没有可用素材", "This scene has no usable assets yet")}</div>
        ) : assets.map((asset) => {
          const audioQualityItems = audioAssetQualityItems(asset);
          const usageItems = assetUsageItems(asset);
          const stateBadge = assetStateBadge(asset);
          return (
            <article key={asset.id}>
              {asset.type === "image" || asset.type === "thumbnail" ? (
                <span className="kv-asset-preview" style={{ backgroundImage: `url("${asset.url}")` }} />
              ) : (
                <span className="kv-asset-preview icon">
                  {asset.type === "clip" ? <FileVideo2 size={22} /> : <Music2 size={22} />}
                </span>
              )}
              <div>
                <strong>{String(asset.metadata?.name ?? (asset.type === "image" ? text("当前画面", "Current visual") : asset.type === "thumbnail" ? text("候选画面", "Candidate visual") : asset.type === "clip" ? text("视频片段", "Video clip") : text("场景配音", "Scene narration")))}</strong>
                <span>{asset.type === "image" ? text("使用中", "In use") : asset.type === "thumbnail" ? text("可对比采用", "Available to compare") : asset.type === "clip" ? text("视频", "Video") : text("音频", "Audio")} · {fileSizeLabel(asset.metadata?.size)}</span>
                <div className={`kv-asset-state ${stateBadge.tone}`} aria-label="素材采用状态">
                  <small>{stateBadge.label}</small>
                  <em>{stateBadge.detail}</em>
                </div>
                {usageItems.length > 0 ? (
                  <div className="kv-asset-usage" aria-label="素材用途">
                    {usageItems.map((item) => <small key={item}>{item}</small>)}
                  </div>
                ) : null}
                {audioQualityItems.length > 0 ? (
                  <div className="kv-asset-audio-quality" aria-label="配音质量信息">
                    {audioQualityItems.map((item) => <small key={item}>{item}</small>)}
                  </div>
                ) : null}
              </div>
              <div className="kv-asset-actions">
                {asset.type === "thumbnail" && asset.metadata?.candidate === true ? (
                  <button className="compare" disabled={isBusy} onClick={() => setComparisonId(asset.id)} title="与当前画面大图对比" type="button">
                    <Eye size={15} />{text("对比", "Compare")}
                  </button>
                ) : null}
                {asset.type === "thumbnail" && asset.metadata?.candidate === true ? (
                  <button className="adopt" disabled={isBusy} onClick={() => onAdoptCandidate(asset.id)} title="采用为当前画面并创建新版本" type="button">
                    <Check size={15} />{text("采用", "Use")}
                  </button>
                ) : null}
                <button aria-label={`移除 ${String(asset.metadata?.name ?? asset.type)}`} className="remove" disabled={isBusy} onClick={() => onRemove(asset.id)} title="从当前版本移除" type="button">
                  <Trash2 size={16} />
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
    {comparisonId ? (
      <VisualCandidateComparison
        initialCandidateId={comparisonId}
        isBusy={isBusy}
        onAdopt={(assetId) => {
          setComparisonId(undefined);
          onAdoptCandidate(assetId);
        }}
        onClose={() => setComparisonId(undefined)}
        scene={scene}
      />
    ) : null}
    </>
  );
}

function ProductionSettingsPanel({
  settings,
  logo,
  music,
  durationSeconds,
  isBusy,
  uploadProgress,
  uploadType,
  onChange,
  onUpload,
  onUploadFile,
  onRemove
}: {
  settings: ProductionSettings;
  logo?: SceneAsset;
  music?: SceneAsset;
  durationSeconds: number;
  isBusy: boolean;
  uploadProgress?: number;
  uploadType?: "logo" | "music";
  onChange: (settings: Partial<ProductionSettings>) => void;
  onUpload: (type: "logo" | "music") => void;
  onUploadFile: (type: "logo" | "music", file: File) => void;
  onRemove: (type: "logo" | "music") => void;
}) {
  const { text } = useUiCopy();
  const [musicVolume, setMusicVolume] = useState(settings.musicVolume);
  const [logoSize, setLogoSize] = useState(settings.logoSize);
  const summary = productionSummaryItems({ settings, durationSeconds, logo, music });
  const impactChecks = productionImpactChecks({ settings, logo, music });

  useEffect(() => setMusicVolume(settings.musicVolume), [settings.musicVolume]);
  useEffect(() => setLogoSize(settings.logoSize), [settings.logoSize]);

  function productionClipboardFiles(event: ReactClipboardEvent<HTMLElement>) {
    return Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item, index) => normalizeClipboardFile(item.getAsFile(), index))
      .filter((file): file is File => Boolean(file));
  }

  function firstProductionFile(type: "logo" | "music", files: File[]) {
    return files.find((file) => type === "logo"
      ? ["image/png", "image/jpeg", "image/webp"].includes(file.type)
      : ["audio/mpeg", "audio/wav", "audio/x-wav"].includes(file.type));
  }

  function handleProductionFiles(type: "logo" | "music", files: File[]) {
    const file = firstProductionFile(type, files);
    if (!file || isBusy) return false;
    onUploadFile(type, file);
    return true;
  }

  function productionDropHandlers(type: "logo" | "music") {
    return {
      onDragOver: (event: DragEvent<HTMLDivElement>) => {
        if (isBusy || event.dataTransfer.types.includes("Files") === false) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      },
      onDrop: (event: DragEvent<HTMLDivElement>) => {
        const handled = handleProductionFiles(type, Array.from(event.dataTransfer.files));
        if (handled) event.preventDefault();
      },
      onPaste: (event: ReactClipboardEvent<HTMLDivElement>) => {
        const handled = handleProductionFiles(type, productionClipboardFiles(event));
        if (handled) event.preventDefault();
      }
    };
  }

  return (
    <section className="kv-production-panel">
      <div className="kv-strip-heading">
        <div>
          <span className="kv-eyebrow">{text("成片设置", "Production settings")}</span>
          <h3>{text("字幕、节奏、品牌与背景音乐", "Captions, pacing, branding, and music")}</h3>
        </div>
        <span>{text("预览与 MP4 同步", "Synced with preview and MP4")}</span>
      </div>
      <div className="kv-production-summary" aria-label="成片输出摘要">
        {summary.map((item) => (
          <span key={item.label}>
            <small>{item.label}</small>
            <strong>{item.value}</strong>
            <em>{item.detail}</em>
          </span>
        ))}
      </div>
      <div className="kv-production-impact" aria-label="成片设置导出影响">
        <div>
          <strong>{text("导出影响预览", "Export impact")}</strong>
          <span>{text("这些设置会直接进入播放器预览和 MP4 合成。", "These settings apply directly to the player preview and MP4 render.")}</span>
        </div>
        <ul>
          {impactChecks.map((item) => (
            <li className={item.status === "ready" ? "ready" : "muted"} key={item.label}>
              {item.status === "ready" ? <Check size={15} /> : <AlertCircle size={15} />}
              <span>
                <small>{item.label}</small>
                <strong>{item.value}</strong>
                <em>{item.detail}</em>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="kv-production-grid">
        <div className="kv-production-control">
          <div className="kv-production-control-title"><Captions size={17} /><strong>{text("字幕", "Captions")}</strong></div>
          <label className="kv-switch-row">
            <span>{text("显示逐句字幕", "Show sentence captions")}</span>
            <input
              checked={settings.captionsEnabled}
              disabled={isBusy}
              onChange={(event) => onChange({ captionsEnabled: event.target.checked })}
              type="checkbox"
            />
          </label>
          <div className="kv-segmented" aria-label="字幕样式">
            {(["minimal", "boxed", "highlight"] as const).map((style) => (
              <button
                className={settings.captionStyle === style ? "active" : ""}
                disabled={isBusy || !settings.captionsEnabled}
                key={style}
                onClick={() => onChange({ captionStyle: style })}
                type="button"
              >
                {style === "minimal" ? text("简洁", "Minimal") : style === "boxed" ? text("深色底", "Dark box") : text("强调色", "Highlight")}
              </button>
            ))}
          </div>
        </div>
        <div className="kv-production-control">
          <div className="kv-production-control-title"><SlidersHorizontal size={17} /><strong>{text("播放速度", "Playback speed")}</strong></div>
          <div className="kv-segmented" aria-label="播放速度">
            {([0.75, 1, 1.25, 1.5] as const).map((rate) => (
              <button
                className={settings.playbackRate === rate ? "active" : ""}
                disabled={isBusy}
                key={rate}
                onClick={() => onChange({ playbackRate: rate })}
                type="button"
              >{rate}x</button>
            ))}
          </div>
          <small>{text("画面、旁白和字幕保持同步。", "Visuals, narration, and captions stay synchronized.")}</small>
        </div>
        <div className="kv-production-control">
          <div className="kv-production-control-title"><Music2 size={17} /><strong>{text("背景音乐", "Background music")}</strong></div>
          <div className="kv-production-asset-row" tabIndex={0} {...productionDropHandlers("music")}>
            <div><strong>{String(music?.metadata?.name ?? text("尚未添加", "Not added"))}</strong><span>{music ? fileSizeLabel(music.metadata?.size) : text("MP3 或 WAV", "MP3 or WAV")}</span></div>
            <button disabled={isBusy} onClick={() => onUpload("music")} type="button">
              {uploadType === "music" ? <Loader2 className="kv-spin" size={15} /> : <Upload size={15} />}
              {uploadType === "music" ? `${uploadProgress ?? 0}%` : music ? text("替换", "Replace") : text("添加", "Add")}
            </button>
            {music ? <button aria-label={text("移除背景音乐", "Remove background music")} disabled={isBusy} onClick={() => onRemove("music")} title={text("移除背景音乐", "Remove background music")} type="button"><Trash2 size={15} /></button> : null}
          </div>
          <label className="kv-range-row">
            <span>{text("音量", "Volume")} {Math.round(musicVolume * 100)}%</span>
            <input
              disabled={isBusy || !music}
              max="0.5"
              min="0"
              onChange={(event) => setMusicVolume(Number(event.target.value))}
              onKeyUp={() => onChange({ musicVolume })}
              onPointerUp={() => onChange({ musicVolume })}
              step="0.02"
              type="range"
              value={musicVolume}
            />
          </label>
          <div className="kv-production-subcontrol">
            <span>{text("旁白时自动压低音乐", "Lower music under narration")}</span>
            <div className="kv-segmented" aria-label="旁白音乐避让">
              {(["off", "balanced", "strong"] as const).map((mode) => (
                <button
                  className={settings.musicDucking === mode ? "active" : ""}
                  disabled={isBusy || !music}
                  key={mode}
                  onClick={() => onChange({ musicDucking: mode })}
                  type="button"
                >{mode === "off" ? text("关闭", "Off") : mode === "balanced" ? text("平衡", "Balanced") : text("明显", "Strong")}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="kv-production-control">
          <div className="kv-production-control-title"><ImagePlus size={17} /><strong>{text("品牌 Logo", "Brand logo")}</strong></div>
          <div className="kv-production-asset-row" tabIndex={0} {...productionDropHandlers("logo")}>
            <div><strong>{String(logo?.metadata?.name ?? text("尚未添加", "Not added"))}</strong><span>{logo ? fileSizeLabel(logo.metadata?.size) : text("透明 PNG 效果最佳", "Transparent PNG works best")}</span></div>
            <button disabled={isBusy} onClick={() => onUpload("logo")} type="button">
              {uploadType === "logo" ? <Loader2 className="kv-spin" size={15} /> : <Upload size={15} />}
              {uploadType === "logo" ? `${uploadProgress ?? 0}%` : logo ? text("替换", "Replace") : text("添加", "Add")}
            </button>
            {logo ? <button aria-label={text("移除 Logo", "Remove logo")} disabled={isBusy} onClick={() => onRemove("logo")} title={text("移除 Logo", "Remove logo")} type="button"><Trash2 size={15} /></button> : null}
          </div>
          <div className="kv-production-inline">
            <label>{text("位置", "Position")}<select disabled={isBusy || !logo} onChange={(event) => onChange({ logoPosition: event.target.value as ProductionSettings["logoPosition"] })} value={settings.logoPosition}><option value="top-left">{text("左上", "Top left")}</option><option value="top-right">{text("右上", "Top right")}</option><option value="bottom-left">{text("左下", "Bottom left")}</option><option value="bottom-right">{text("右下", "Bottom right")}</option></select></label>
            <label className="kv-range-row">
              <span>{text("大小", "Size")} {logoSize}%</span>
              <input
                disabled={isBusy || !logo}
                max="24"
                min="6"
                onChange={(event) => setLogoSize(Number(event.target.value))}
                onKeyUp={() => onChange({ logoSize })}
                onPointerUp={() => onChange({ logoSize })}
                step="1"
                type="range"
                value={logoSize}
              />
            </label>
          </div>
        </div>
      </div>
    </section>
  );
}

function PlanVisualDiff({ change, scene, editPlanId }: { change: EditChange; scene: Scene; editPlanId: string }) {
  const image = scenePreviewAsset(scene);
  const preview = planPreviewAsset(scene, editPlanId);
  const visualRegeneration = change.regenerate.some((type) => ["image", "clip", "thumbnail"].includes(type));
  const titleChanged = change.after.title && change.after.title !== change.before.title;
  const canShowDraftTextPreview = Boolean(!preview && image && titleChanged);
  const afterIsLight = change.after.thumbnailTone === "light";
  const beforeColor = scene.style.palette[0] ?? "#101828";
  const afterColor = afterIsLight ? "#f5f7fa" : beforeColor;
  const afterFrameStyle = preview
    ? { backgroundImage: `url("${preview.url}")` }
    : canShowDraftTextPreview || (!visualRegeneration && image)
      ? { backgroundImage: `url("${image?.url}")` }
      : { backgroundColor: afterColor };

  return (
    <div className="kv-plan-visual-diff" aria-label={`场景 ${change.sceneNumber} 画面对比`}>
      <figure>
        <figcaption>当前画面</figcaption>
        <div
          className={`kv-plan-frame${image ? " has-image" : ""}`}
          style={image ? { backgroundImage: `url("${image.url}")` } : { backgroundColor: beforeColor }}
        >
          {!image ? <><span>S{change.sceneNumber}</span><strong>{change.before.title}</strong></> : null}
        </div>
      </figure>
      <ArrowRight aria-hidden="true" size={16} />
      <figure>
        <figcaption>修改后</figcaption>
        <div
          className={`kv-plan-frame after${preview || canShowDraftTextPreview || (!visualRegeneration && image) ? " has-image" : ""}${afterIsLight && !preview ? " light" : ""}${canShowDraftTextPreview ? " text-preview" : ""}`}
          style={afterFrameStyle}
        >
          {preview ? <span className="kv-plan-preview-ready"><Check size={13} />真实预览</span> : canShowDraftTextPreview ? (
            <>
              <span className="kv-plan-preview-ready draft"><Check size={13} />文字预览</span>
              <strong>{change.after.title}</strong>
              {visualRegeneration ? <small>可继续生成真实画面</small> : null}
            </>
          ) : visualRegeneration ? (
            <><ImagePlus size={18} /><strong>{change.after.title}</strong><small>确认后生成新画面</small></>
          ) : (
            <><Check size={18} /><strong>沿用当前画面</strong></>
          )}
        </div>
      </figure>
    </div>
  );
}

function ChangeCard({ change, scene, editPlanId }: { change: EditChange; scene?: Scene; editPlanId: string }) {
  const changedFields = [
    {
      label: "标题",
      before: change.before.title,
      after: change.after.title
    },
    {
      label: "旁白",
      before: change.before.voiceover,
      after: change.after.voiceover
    },
    {
      label: "配音音色",
      before: narrationVoiceProfile(change.before.narrationVoice).label,
      after: narrationVoiceProfile(change.after.narrationVoice).label
    },
    {
      label: "画面方向",
      before: change.before.visualPrompt,
      after: change.after.visualPrompt
    },
    {
      label: "镜头运动",
      before: change.before.motionPrompt,
      after: change.after.motionPrompt
    }
  ].filter((field) => field.after && field.after !== field.before);

  return (
    <article className="kv-change">
      <div className="kv-change-heading">
        <div>
          <strong>场景 {change.sceneNumber}</strong>
          <span>{change.status === "updated" ? "已更新" : change.status === "added" ? "新增" : change.status === "deleted" ? "删除" : "未改动"}</span>
        </div>
        {change.regenerate.length > 0 ? (
          <div className="kv-regenerate-tags" aria-label="需要重新生成的素材">
            {Array.from(new Set(change.regenerate)).map((type) => (
              <span key={type}>{assetTypeLabel(type)}</span>
            ))}
          </div>
        ) : null}
      </div>
      {scene ? <PlanVisualDiff change={change} editPlanId={editPlanId} scene={scene} /> : null}
      <div className="kv-change-diffs">
        {changedFields.map((field) => (
          <section className={field.label === "旁白" ? "accent" : ""} key={field.label}>
            <span>{field.label}</span>
            <div className="kv-before-after">
              <div>
                <small>当前</small>
                <p>{compactText(field.before, "无", field.label === "画面方向" ? 110 : 88)}</p>
              </div>
              <ArrowRight aria-hidden="true" size={15} />
              <div>
                <small>修改后</small>
                <p>{compactText(field.after, "无", field.label === "画面方向" ? 110 : 88)}</p>
              </div>
            </div>
          </section>
        ))}
      </div>
      <details className="kv-change-details">
        <summary>查看完整制作说明</summary>
        <dl>
          <div><dt>标题</dt><dd>{change.after.title}</dd></div>
          {change.after.voiceover ? <div><dt>旁白</dt><dd>{change.after.voiceover}</dd></div> : null}
          <div><dt>画面方向</dt><dd>{change.after.visualPrompt}</dd></div>
          {change.after.motionPrompt ? <div><dt>镜头运动</dt><dd>{change.after.motionPrompt}</dd></div> : null}
        </dl>
      </details>
    </article>
  );
}

function StructureSceneCard({
  scene,
  title,
  durationSeconds,
  willRegenerate = false
}: {
  scene?: Scene;
  title: string;
  durationSeconds: number;
  willRegenerate?: boolean;
}) {
  const image = !willRegenerate ? scenePreviewAsset(scene) : undefined;
  return (
    <div
      className={`kv-structure-scene${image ? " has-image" : ""}${willRegenerate ? " regenerating" : ""}`}
      style={image ? { backgroundImage: `url("${image.url}")` } : undefined}
    >
      {willRegenerate ? <ImagePlus size={16} /> : null}
      <strong>{title}</strong>
      <span>{durationSeconds} 秒{willRegenerate ? " · 更新画面与配音" : ""}</span>
    </div>
  );
}

function StructurePlanPreview({ mutation, scenes }: { mutation: SceneStructureMutation; scenes: Scene[] }) {
  if (!mutation || !["split", "merge-next", "insert", "delete"].includes(mutation.operation)) return null;
  const source = scenes.find((scene) => scene.sceneNumber === mutation.sceneNumber);
  if (!source) return null;

  if (mutation.operation === "insert") {
    return (
      <div className="kv-structure-preview" aria-label={`场景 ${mutation.sceneNumber} 新增场景预览`}>
        <div><small>定位场景</small><StructureSceneCard durationSeconds={source.durationSeconds} scene={source} title={source.title} /></div>
        <ArrowRight aria-hidden="true" size={16} />
        <div>
          <small>{mutation.placement === "before" ? "在此之前新增" : "在此之后新增"}</small>
          <StructureSceneCard durationSeconds={mutation.scene.durationSeconds} title={mutation.scene.title} willRegenerate />
        </div>
      </div>
    );
  }

  if (mutation.operation === "delete") {
    return (
      <div className="kv-structure-preview" aria-label={`场景 ${mutation.sceneNumber} 删除预览`}>
        <div><small>当前</small><StructureSceneCard durationSeconds={source.durationSeconds} scene={source} title={source.title} /></div>
        <ArrowRight aria-hidden="true" size={16} />
        <div><small>修改后</small><div className="kv-structure-removed">该场景将被删除，其余场景自动重新编号</div></div>
      </div>
    );
  }

  if (mutation.operation === "split") {
    const split = sceneSplitPreview(source);
    return (
      <div className="kv-structure-preview" aria-label={`场景 ${mutation.sceneNumber} 拆分预览`}>
        <div><small>当前</small><StructureSceneCard durationSeconds={source.durationSeconds} scene={source} title={source.title} /></div>
        <ArrowRight aria-hidden="true" size={16} />
        <div>
          <small>拆分后</small>
          <div className="kv-structure-stack">
            <StructureSceneCard durationSeconds={split.first.durationSeconds} title={split.first.title} willRegenerate />
            <StructureSceneCard durationSeconds={split.second.durationSeconds} title={split.second.title} willRegenerate />
          </div>
        </div>
      </div>
    );
  }

  const next = scenes.find((scene) => scene.sceneNumber === mutation.sceneNumber + 1);
  if (!next) return null;
  return (
    <div className="kv-structure-preview" aria-label={`场景 ${mutation.sceneNumber} 合并预览`}>
      <div>
        <small>当前</small>
        <div className="kv-structure-stack">
          <StructureSceneCard durationSeconds={source.durationSeconds} scene={source} title={source.title} />
          <StructureSceneCard durationSeconds={next.durationSeconds} scene={next} title={next.title} />
        </div>
      </div>
      <ArrowRight aria-hidden="true" size={16} />
      <div>
        <small>合并后</small>
        <StructureSceneCard
          durationSeconds={source.durationSeconds + next.durationSeconds}
          title={/\p{Script=Han}/u.test(source.title + next.title) ? `${source.title}与${next.title}` : `${source.title} + ${next.title}`}
          willRegenerate
        />
      </div>
    </div>
  );
}

function ChatPanel({
  attachments,
  messages,
  scenes,
  selectedScene,
  pendingPlan,
  input,
  isBusy,
  busyAction,
  onInput,
  onOpenAttachmentPicker,
  onRemoveAttachment,
  onSubmit,
  onPreview,
  onApply,
  onCancel
}: {
  attachments: File[];
  messages: ChatMessage[];
  scenes: Scene[];
  selectedScene: number;
  pendingPlan?: EditPlan;
  input: string;
  isBusy: boolean;
  busyAction?: BusyAction;
  onInput: (value: string) => void;
  onOpenAttachmentPicker: () => void;
  onRemoveAttachment: (index: number) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onPreview: () => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const { language, text } = useUiCopy();
  const logRef = useRef<HTMLDivElement>(null);
  const visualSceneNumbers = pendingPlan ? editPlanVisualSceneNumbers(pendingPlan) : [];
  const previewedSceneNumbers = pendingPlan ? visualSceneNumbers.filter((sceneNumber) => {
    const scene = scenes.find((item) => item.sceneNumber === sceneNumber);
    return scene && planPreviewAsset(scene, pendingPlan.id);
  }) : [];
  const planModificationCount = pendingPlan
    ? pendingPlan.changes.length + (pendingPlan.projectTitle ? 1 : 0) + productionAssetChangeLabels(pendingPlan).length + productionSettingLabels(pendingPlan.productionSettings).length + editPlanOperations(pendingPlan).length
    : 0;
  const visualPreviewState = { total: visualSceneNumbers.length, ready: previewedSceneNumbers.length };
  const applyLabel = pendingPlan ? planApplyLabel(pendingPlan, visualPreviewState) : text("应用修改", "Apply changes");
  const checklist = pendingPlan ? planReviewChecklist(pendingPlan, visualPreviewState) : [];
  const requestTrail = pendingPlan ? planRequestTrail(pendingPlan) : undefined;
  const coverageState = pendingPlan ? planCoverageState(pendingPlan, scenes) : undefined;
  const languageReview = pendingPlan ? planLanguageReview(pendingPlan, scenes) : undefined;
  const applyBlocker = pendingPlan ? planApplyBlocker({ coverageState, languageReview }) : undefined;
  const applyDisabled = isBusy || Boolean(applyBlocker);
  const inputMode = chatInputMode({
    input,
    pendingPlan
  });

  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    log.scrollTo({ top: log.scrollHeight, behavior: "smooth" });
  }, [messages.length, pendingPlan, isBusy]);

  return (
    <aside className="kv-chat" id="kv-chat-panel">
      <header>
        <div>
          <span className="kv-eyebrow">{text("对话式改片", "Conversational editing")}</span>
          <h3>{text("告诉我你想怎么改", "Tell me what to change")}</h3>
        </div>
        <PanelRightOpen size={20} />
      </header>
      <div className="kv-chat-log" ref={logRef}>
        {messages.map((message) => (
          <div className={`kv-msg ${message.role}`} key={message.id}>
            <p>{message.content}</p>
            {message.editPlan ? (
              <div className="kv-plan-summary">
                <span>{message.editPlan.affectedScenes.length > 0 ? `影响场景：${message.editPlan.affectedScenes.join(", ")}` : "作用范围：全片设置"}</span>
                <span>{uniqueRegenerate(message.editPlan) ? `重新生成：${uniqueRegenerate(message.editPlan)}` : "无需重做场景素材"}</span>
              </div>
            ) : null}
          </div>
        ))}
        {pendingPlan ? (
          <section className="kv-review-plan">
            <div className="kv-strip-heading">
              <h3>{text("确认修改方案", "Review edit plan")}</h3>
              <span>{text(`${planModificationCount} 项修改`, `${planModificationCount} changes`)}</span>
            </div>
            <div className="kv-plan-state" role="status">
              <div>
                <Clock3 size={16} />
                <strong>{text("方案待确认，当前视频还没有被改动", "Plan awaiting approval. The video has not changed yet.")}</strong>
              </div>
              <p>{applyBlocker ?? text("确认后才会创建新版本并生成受影响素材；继续输入会先调整这个方案。", "A new version and affected assets are created only after approval. More input will refine this plan first.")}</p>
              <div className="kv-plan-state-grid">
                <span><strong>{planScopeLabel(pendingPlan, scenes.length)}</strong><small>{text("作用范围", "Scope")}</small></span>
                <span><strong>{planAssetWorkLabel(pendingPlan)}</strong><small>{text("确认后执行", "Runs after approval")}</small></span>
              </div>
              <div className="kv-plan-checklist" aria-label="执行前检查">
                {checklist.map((item) => (
                  <span className={item.tone} key={item.label}>
                    <Check size={13} />
                    <strong>{item.value}</strong>
                    <small>{item.label}</small>
                  </span>
                ))}
              </div>
              {coverageState ? (
                <div className={`kv-plan-coverage ${coverageState.tone}`} aria-label="方案覆盖校验">
                  {coverageState.tone === "attention" ? <AlertCircle size={15} /> : <Check size={15} />}
                  <div>
                    <strong>{coverageState.title}</strong>
                    <span>{coverageState.detail}</span>
                  </div>
                </div>
              ) : null}
              {languageReview ? (
                <div className={`kv-plan-language ${languageReview.ready ? "ready" : "attention"}`} aria-label="中文化字段校验">
                  <div>
                    {languageReview.ready ? <Check size={15} /> : <AlertCircle size={15} />}
                    <strong>{text("语言审阅", "Language review")}</strong>
                    <span>{languageReview.summary}</span>
                  </div>
                  <p>{languageReview.detail}</p>
                  <div>
                    {languageReview.sceneChecks.map((check) => (
                      <span className={check.ready ? "ready" : "attention"} key={check.sceneNumber}>
                        场景 {check.sceneNumber}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            {requestTrail ? (
              <div className="kv-plan-request-trail" aria-label="方案对话脉络">
                <div>
                  <MessageSquareText size={15} />
                  <strong>{text("方案脉络", "Request history")}</strong>
                </div>
                <ol>
                  <li><span>{text("原始需求", "Original request")}</span><p>{requestTrail.original}</p></li>
                  {requestTrail.refinements.map((refinement, index) => (
                    <li key={`${index}-${refinement}`}>
                      <span>{text(`补充要求 ${index + 1}`, `Refinement ${index + 1}`)}</span>
                      <p>{refinement}</p>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
            <p>{pendingPlan.summary}</p>
            {editPlanOperations(pendingPlan).length > 0 ? (
              <>
                <div className="kv-structure-plan" aria-label="时间线结构修改">
                  <Layers3 size={17} />
                  <div>
                    <strong>{text("时间线结构", "Timeline structure")}</strong>
                    {editPlanOperations(pendingPlan).map((operation, index) => (
                      <span key={`${operation.operation}-${operation.sceneId ?? operation.sceneNumber}-${index}`}>
                        {index + 1}. {sceneStructureLabel(operation)}
                      </span>
                    ))}
                  </div>
                </div>
                {editPlanOperations(pendingPlan).map((operation, index) => (
                  <StructurePlanPreview
                    key={`preview-${operation.operation}-${operation.sceneId ?? operation.sceneNumber}-${index}`}
                    mutation={operation}
                    scenes={scenes}
                  />
                ))}
              </>
            ) : null}
            {productionSettingLabels(pendingPlan.productionSettings).length > 0 ? (
              <div className="kv-production-plan" aria-label="全片设置修改">
                <strong>{text("全片设置", "Full-video settings")}</strong>
                <div>{productionSettingLabels(pendingPlan.productionSettings).map((label) => <span key={label}>{label}</span>)}</div>
              </div>
            ) : null}
            {productionAssetChangeLabels(pendingPlan).length > 0 ? (
              <div className="kv-production-plan" aria-label="全片素材修改">
                <strong>{text("全片素材", "Full-video assets")}</strong>
                <div>{productionAssetChangeLabels(pendingPlan).map((label) => <span key={label}>{label}</span>)}</div>
              </div>
            ) : null}
            {pendingPlan.projectTitle ? (
              <div className="kv-production-plan" aria-label="项目名称修改">
                <strong>{text("项目名称", "Project name")}</strong>
                <div><span>{pendingPlan.projectTitle}</span></div>
              </div>
            ) : null}
            <div className="kv-change-list">
              {pendingPlan.changes.map((change) => (
                <ChangeCard
                  change={change}
                  editPlanId={pendingPlan.id}
                  key={change.sceneNumber}
                  scene={scenes.find((scene) => scene.sceneNumber === change.sceneNumber)}
                />
              ))}
            </div>
            <div className="kv-review-actions">
              {visualSceneNumbers.length > 0 ? (
                <button className="kv-preview-plan" disabled={isBusy || previewedSceneNumbers.length === visualSceneNumbers.length} onClick={onPreview} type="button">
                  {isBusy && busyAction === "previewing-plan" ? <Loader2 className="kv-spin" size={16} /> : previewedSceneNumbers.length === visualSceneNumbers.length ? <Check size={16} /> : <Eye size={16} />}
                  {previewedSceneNumbers.length === visualSceneNumbers.length
                    ? text(`真实预览已就绪 · ${previewedSceneNumbers.length} 个场景`, `Preview ready · ${previewedSceneNumbers.length} scenes`)
                    : text(`生成真实预览 · ${visualSceneNumbers.length - previewedSceneNumbers.length} 个场景`, `Generate preview · ${visualSceneNumbers.length - previewedSceneNumbers.length} scenes`)}
                </button>
              ) : null}
              <button className="kv-primary" disabled={applyDisabled} onClick={onApply} type="button">
                {isBusy ? <Loader2 className="kv-spin" size={16} /> : <Check size={16} />}
                {applyBlocker ? text("先修正方案", "Fix plan first") : applyLabel}
              </button>
              <button onClick={onCancel} type="button">{text("取消", "Cancel")}</button>
            </div>
          </section>
        ) : null}
        {isBusy && !pendingPlan ? (
          <div className="kv-msg assistant kv-msg-loading" role="status">
            <Loader2 className="kv-spin" size={16} />
            <p>{localizedRuntimeLabel(busyActionLabel(busyAction), language)}</p>
          </div>
        ) : null}
      </div>
      {pendingPlan ? (
        <div className="kv-chat-draft-note" role="note">
          <div>
            {applyBlocker ? <AlertCircle size={15} /> : <Check size={15} />}
            <span>{applyBlocker ?? "正在审核修改方案。输入补充要求会继续改方案；点击应用才会真正改片。"}</span>
          </div>
          <div className="kv-chat-draft-actions">
            <button className="kv-primary" disabled={applyDisabled} onClick={onApply} type="button">
              {isBusy ? <Loader2 className="kv-spin" size={15} /> : <Check size={15} />}
              {applyBlocker ? "先修正方案" : applyLabel}
            </button>
            <button disabled={isBusy} onClick={onCancel} type="button">{text("取消方案", "Cancel plan")}</button>
          </div>
        </div>
      ) : null}
      <div className={`kv-chat-input-mode ${inputMode.tone}`} role="note" aria-label="发送后会发生什么">
        <MessageSquareText size={14} />
        <div>
          <strong>{inputMode.title}</strong>
          <span>{inputMode.detail}</span>
        </div>
      </div>
      {attachments.length > 0 ? (
        <div className="kv-chat-attachments" aria-label="本次修改的参考素材">
          {attachments.map((file, index) => (
            <span key={`${file.name}-${file.size}-${file.lastModified}`}>
              <Paperclip size={13} />
              <strong title={file.name}>{file.name}</strong>
              <button aria-label={`移除 ${file.name}`} disabled={isBusy} onClick={() => onRemoveAttachment(index)} type="button"><X size={13} /></button>
            </span>
          ))}
        </div>
      ) : null}
      <form className="kv-chat-form" onSubmit={onSubmit}>
        <button
          aria-label={text("添加参考图片、视频或音频", "Add a reference image, video, or audio file")}
          className="kv-chat-attach"
          disabled={isBusy || Boolean(pendingPlan)}
          onClick={onOpenAttachmentPicker}
          title={pendingPlan ? text("请先应用或取消当前方案，再添加新的参考素材", "Apply or cancel the current plan before adding references") : text("添加参考素材", "Add references")}
          type="button"
        >
          <Paperclip size={18} />
        </button>
        <textarea
          disabled={isBusy}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }}
          onChange={(event) => onInput(event.target.value)}
          placeholder={pendingPlan ? text("继续调整当前方案，输入补充要求…", "Add instructions to refine the current plan…") : text("描述你想修改的场景、旁白或整体风格…", "Describe changes to scenes, narration, or the overall style…")}
          value={input}
        />
        <button className="kv-chat-send" disabled={isBusy || (input.trim().length === 0 && attachments.length === 0)} type="submit">
          {isBusy ? <Loader2 className="kv-spin" size={18} /> : <Send size={18} />}
        </button>
      </form>
    </aside>
  );
}

function versionSceneSignature(scene?: Scene) {
  if (!scene) return "";
  return JSON.stringify({
    title: scene.title,
    voiceover: scene.voiceover,
    visualPrompt: scene.visualPrompt,
    motionPrompt: scene.motionPrompt,
    durationSeconds: scene.durationSeconds,
    style: scene.style
  });
}

function VersionSceneSide({ label, scene }: { label: string; scene?: Scene }) {
  const image = scene?.assets.find((asset) => asset.type === "image" && asset.url);
  const clip = scene?.assets.find((asset) => asset.type === "clip" && asset.url);
  return (
    <div className="kv-version-scene-side">
      <span>{label}</span>
      <div
        className={`kv-version-scene-thumb${image ? " has-image" : ""}`}
        style={image ? { backgroundImage: `url("${image.url}")` } : undefined}
      >
        {!image ? clip ? <FileVideo2 size={20} /> : <ImagePlus size={20} /> : null}
      </div>
      <strong>{scene?.title ?? "没有这个场景"}</strong>
      <small>{scene ? `${scene.durationSeconds} 秒` : "已删除"}</small>
    </div>
  );
}

function VersionComparison({ preview }: { preview: ProjectVersionPreview }) {
  const count = Math.max(preview.version.scenes.length, preview.currentVersion.scenes.length);
  const selectedSummary = versionMediaSummary(preview.version);
  const currentSummary = versionMediaSummary(preview.currentVersion);
  const rows = Array.from({ length: count }, (_, index) => {
    const before = preview.version.scenes[index];
    const after = preview.currentVersion.scenes[index];
    const status = !before ? "新增" : !after ? "删除" : versionSceneSignature(before) === versionSceneSignature(after) ? "未变化" : "已修改";
    return { sceneNumber: index + 1, before, after, status };
  });
  const changed = rows.filter((row) => row.status !== "未变化");
  const visibleRows = changed.length > 0 ? changed : rows;
  const sameVersion = preview.version.id === preview.currentVersion.id;
  const restoreImpactItems = versionRestoreImpactItems(preview);
  const restoreDeltaItems = versionRestoreDeltaItems(preview);

  return (
    <section className="kv-version-comparison" aria-label="版本场景比较">
      <div className="kv-version-comparison-summary">
        <div>
          <span>所选版本</span>
          <strong>{preview.version.scenes.length} 个场景 · {durationLabel(preview.version.durationSeconds)}</strong>
          <small className={mediaCompletenessClass(selectedSummary)}>{mediaCompletenessLabel(selectedSummary)}</small>
          <small>{versionOutputLabel(preview.version)}</small>
        </div>
        <ArrowRight size={17} />
        <div>
          <span>当前版本</span>
          <strong>{preview.currentVersion.scenes.length} 个场景 · {durationLabel(preview.currentVersion.durationSeconds)}</strong>
          <small className={mediaCompletenessClass(currentSummary)}>{mediaCompletenessLabel(currentSummary)}</small>
          <small>{versionOutputLabel(preview.currentVersion)}</small>
        </div>
      </div>
      <p>{sameVersion ? "这是当前版本的完整分镜快照。" : preview.changeSummary.description}</p>
      {!sameVersion ? (
        <div className="kv-version-restore-impact" aria-label="恢复版本影响">
          <strong>恢复前确认</strong>
          <div>
            {restoreImpactItems.map((item) => (
              <span key={item}>
                <Check size={13} />
                {item}
              </span>
            ))}
          </div>
          <section className="kv-version-restore-delta" aria-label="恢复后变化摘要">
            <strong>恢复后变化</strong>
            <div>
              {restoreDeltaItems.map((item) => (
                <span className={item.tone} key={item.label}>
                  <small>{item.label}</small>
                  <em>{item.value}</em>
                </span>
              ))}
            </div>
          </section>
        </div>
      ) : null}
      <div className="kv-version-scene-diffs">
        {visibleRows.map((row) => (
          <article key={`${row.sceneNumber}-${row.before?.id ?? "new"}-${row.after?.id ?? "removed"}`}>
            <header><strong>场景 {row.sceneNumber}</strong><span className={`status-${row.status}`}>{row.status}</span></header>
            <div>
              <VersionSceneSide label="所选版本" scene={row.before} />
              <ArrowRight aria-hidden="true" size={16} />
              <VersionSceneSide label="当前版本" scene={row.after} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function StudioScreen({
  chatAttachments,
  project,
  messages,
  pendingPlan,
  input,
  selectedScene,
  view,
  isBusy,
  busyAction,
  onInput,
  onOpenChatAttachmentPicker,
  onRemoveChatAttachment,
  onSubmit,
  onPreviewPlan,
  onApply,
  onCancel,
  onSelectScene,
  onViewChange,
  onUpload,
  onRegenerate,
  onEnhanceScene,
  onGenerateClip,
  onGenerateClips,
  onRegenerateAudio,
  onExport,
  exportProgress,
  activeRenderJobId,
  renderJobs,
  invalidRenderMedia,
  generationIssues,
  exportsOpen,
  exportsLoading,
  onToggleExports,
  onCancelExport,
  versions,
  versionsOpen,
  versionsLoading,
  versionPreview,
  versionPreviewLoading,
  onToggleVersions,
  onPreviewVersion,
  onCloseVersionPreview,
  onRestoreVersion,
  uploadProgress,
  assetsOpen,
  onToggleAssets,
  onRemoveAsset,
  onGenerateCandidate,
  candidateToCompare,
  onCandidateComparisonOpened,
  productionOpen,
  productionUploadType,
  onToggleProduction,
  onUpdateProduction,
  onUploadProduction,
  onUploadProductionFile,
  onRemoveProduction,
  onMutateScene,
  onSaveScene,
  onVoiceChange
}: {
  chatAttachments: File[];
  project: Project;
  messages: ChatMessage[];
  pendingPlan?: EditPlan;
  input: string;
  selectedScene: number;
  view: StudioView;
  isBusy: boolean;
  busyAction?: BusyAction;
  onInput: (value: string) => void;
  onOpenChatAttachmentPicker: () => void;
  onRemoveChatAttachment: (index: number) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onPreviewPlan: () => void;
  onApply: () => void;
  onCancel: () => void;
  onSelectScene: (scene: number) => void;
  onViewChange: (view: StudioView) => void;
  onUpload: () => void;
  onRegenerate: (sceneNumbers?: number[]) => void;
  onEnhanceScene: (sceneNumber: number) => void;
  onGenerateClip: (sceneNumber: number) => void;
  onGenerateClips: (sceneNumbers: number[]) => void;
  onRegenerateAudio: (sceneNumbers?: number[]) => void;
  onExport: () => void;
  exportProgress?: number;
  activeRenderJobId?: string;
  renderJobs: RenderJob[];
  invalidRenderMedia: InvalidRenderMedia[];
  generationIssues: GenerationMediaIssue[];
  exportsOpen: boolean;
  exportsLoading: boolean;
  onToggleExports: () => void;
  onCancelExport: (jobId: string) => void;
  versions: ProjectVersionSummary[];
  versionsOpen: boolean;
  versionsLoading: boolean;
  versionPreview?: ProjectVersionPreview;
  versionPreviewLoading: boolean;
  onToggleVersions: () => void;
  onPreviewVersion: (versionId: string) => void;
  onCloseVersionPreview: () => void;
  onRestoreVersion: (versionId: string) => void;
  uploadProgress?: number;
  assetsOpen: boolean;
  onToggleAssets: () => void;
  onRemoveAsset: (assetId: string) => void;
  onGenerateCandidate: (sceneNumber: number, instruction?: string) => void;
  candidateToCompare?: { sceneNumber: number; assetId: string };
  onCandidateComparisonOpened: () => void;
  productionOpen: boolean;
  productionUploadType?: "logo" | "music";
  onToggleProduction: () => void;
  onUpdateProduction: (settings: Partial<ProductionSettings>) => void;
  onUploadProduction: (type: "logo" | "music") => void;
  onUploadProductionFile: (type: "logo" | "music", file: File) => void;
  onRemoveProduction: (type: "logo" | "music") => void;
  onMutateScene: (mutation: SceneStructureMutation) => void;
  onSaveScene: (sceneNumber: number, edits: SceneTextEdits) => void;
  onVoiceChange: (sceneNumbers: number[], voice: NarrationVoice) => void;
}) {
  const { language, text } = useUiCopy();
  const playerRef = useRef<PlayerRef>(null);
  const toolMenuRef = useRef<HTMLDivElement>(null);
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  const scene = project.currentVersion.scenes.find((item) => item.sceneNumber === selectedScene) ?? project.currentVersion.scenes[0];
  const missingSceneNumbers = project.currentVersion.scenes
    .filter((item) => !sceneVisualAsset(item))
    .map((item) => item.sceneNumber);
  const missingAudioSceneNumbers = project.currentVersion.scenes
    .filter((item) => !item.assets.some((asset) => asset.type === "audio" && asset.url))
    .map((item) => item.sceneNumber);
  const invalidMedia = invalidRenderMediaSummary(invalidRenderMedia);
  const generationIssue = generationIssueSummary(generationIssues);
  const videoBalanceRequired = generationIssues.some(
    (issue) => issue.type === "clip" && issue.errorCode === "VIDEO_PROVIDER_BALANCE_REQUIRED"
  );
  const filmSettings = productionSettings(project);
  const mediaAudit = auditProjectMedia(project);
  const qualityErrors = mediaAudit.errors.filter((issue) => !["missing-visual", "missing-audio"].includes(issue.code));
  const exportReady = missingSceneNumbers.length === 0
    && missingAudioSceneNumbers.length === 0
    && invalidRenderMedia.length === 0
    && qualityErrors.length === 0
    && exportProgress === undefined;
  const exportReadiness = exportReady ? exportReadinessItems(project, filmSettings) : [];
  const exportBlockers = exportBlockingItems({
    missingVisualSceneNumbers: missingSceneNumbers,
    missingAudioSceneNumbers,
    invalidMedia
  });
  useEffect(() => {
    if (!toolMenuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!toolMenuRef.current?.contains(event.target as Node)) setToolMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setToolMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [toolMenuOpen]);
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const handleFrameUpdate = ({ detail }: { detail: { frame: number } }) => {
      const seconds = (detail.frame / VIDEO_FPS) * filmSettings.playbackRate;
      let cursor = 0;
      const activeScene = project.currentVersion.scenes.find((item) => {
        cursor += item.durationSeconds;
        return seconds < cursor;
      }) ?? project.currentVersion.scenes.at(-1);
      if (activeScene && activeScene.sceneNumber !== selectedScene) {
        onSelectScene(activeScene.sceneNumber);
      }
    };
    player.addEventListener("frameupdate", handleFrameUpdate);
    player.addEventListener("seeked", handleFrameUpdate);
    return () => {
      player.removeEventListener("frameupdate", handleFrameUpdate);
      player.removeEventListener("seeked", handleFrameUpdate);
    };
  }, [filmSettings.playbackRate, onSelectScene, project.currentVersion.id, project.currentVersion.scenes, selectedScene]);

  function selectScene(sceneNumber: number) {
    const seconds = project.currentVersion.scenes
      .filter((item) => item.sceneNumber < sceneNumber)
      .reduce((sum, item) => sum + item.durationSeconds, 0);
    playerRef.current?.seekTo(Math.round((seconds * VIDEO_FPS) / filmSettings.playbackRate));
    onSelectScene(sceneNumber);
  }

  function runTool(action: () => void) {
    setToolMenuOpen(false);
    action();
  }

  return (
    <div className="kv-studio">
      <section className="kv-studio-main">
        {isBusy && busyAction ? (
          <div className="kv-operation-status" role="status">
            <Loader2 className="kv-spin" size={16} />
            <span>{localizedRuntimeLabel(busyActionLabel(busyAction), language)}</span>
          </div>
        ) : null}
        <div className="kv-actionbar">
          <div className="kv-tabs">
            <button className={view === "preview" ? "active" : ""} onClick={() => onViewChange("preview")} type="button">
              <Film size={16} />
              {text("动态预览", "Preview")}
            </button>
            <button className={view === "storyboard" ? "active" : ""} onClick={() => onViewChange("storyboard")} type="button">
              <Layers3 size={16} />
              {text("分镜板", "Storyboard")}
            </button>
          </div>
          <div className="kv-actions">
            <button
              className="kv-mobile-chat-action"
              onClick={() => document.getElementById("kv-chat-panel")?.scrollIntoView({ behavior: "smooth", block: "start" })}
              type="button"
            >
              <MessageSquareText size={16} />
              {text("对话改片", "Edit with chat")}
            </button>
            <button className="kv-enhance-action" disabled={isBusy} onClick={() => onEnhanceScene(selectedScene)} type="button">
              <Sparkles size={16} />
              {text("高清画面", "Enhance image")}
            </button>
            <button
              className="kv-video-action"
              disabled={isBusy || !scene?.assets.some((asset) => asset.type === "image" && asset.url)}
              onClick={() => onGenerateClip(selectedScene)}
              type="button"
            >
              <Clapperboard size={16} />
              {scene?.assets.some((asset) => asset.type === "clip" && asset.url) ? text("重做动态", "Regenerate motion") : text("生成动态", "Generate motion")}
            </button>
            <div className="kv-tool-menu-wrap" ref={toolMenuRef}>
              <button
                aria-controls="kv-studio-tool-menu"
                aria-expanded={toolMenuOpen}
                className={toolMenuOpen ? "active" : ""}
                onClick={() => setToolMenuOpen((open) => !open)}
                type="button"
              >
                <MoreHorizontal size={17} />
                {text("工具", "Tools")}
              </button>
              {toolMenuOpen ? (
                <div aria-label="工作室工具" className="kv-tool-menu" id="kv-studio-tool-menu" role="menu">
                  <span>{text("项目", "Project")}</span>
                  <button className={assetsOpen ? "active" : ""} disabled={isBusy} onClick={() => runTool(onToggleAssets)} role="menuitem" type="button">
                    {uploadProgress !== undefined ? <Loader2 className="kv-spin" size={16} /> : <ImagePlus size={16} />}
                    {uploadProgress !== undefined ? text(`上传 ${uploadProgress}%`, `Uploading ${uploadProgress}%`) : text("素材库", "Assets")}
                  </button>
                  <button className={productionOpen ? "active" : ""} disabled={isBusy} onClick={() => runTool(onToggleProduction)} role="menuitem" type="button">
                    <SlidersHorizontal size={16} />
                    {text("成片设置", "Production settings")}
                  </button>
                  <button className={versionsOpen ? "active" : ""} onClick={() => runTool(onToggleVersions)} role="menuitem" type="button">
                    <History size={16} />
                    {text("版本历史", "Version history")}
                  </button>
                  <button className={exportsOpen ? "active" : ""} onClick={() => runTool(onToggleExports)} role="menuitem" type="button">
                    <FileVideo2 size={16} />
                    {text("导出记录", "Export history")}
                  </button>
                  <span>{text("生成", "Generate")}</span>
                  <button disabled={isBusy} onClick={() => runTool(() => onRegenerate(missingSceneNumbers.length > 0 ? missingSceneNumbers : undefined))} role="menuitem" type="button">
                    <RefreshCcw size={16} />
                    {missingSceneNumbers.length > 0 ? text(`补齐 ${missingSceneNumbers.length} 个画面`, `Complete ${missingSceneNumbers.length} images`) : text("重做全部画面", "Regenerate all images")}
                  </button>
                  <button disabled={isBusy} onClick={() => runTool(() => onRegenerateAudio(missingAudioSceneNumbers.length > 0 ? missingAudioSceneNumbers : [selectedScene]))} role="menuitem" type="button">
                    <Mic2 size={16} />
                    {missingAudioSceneNumbers.length > 0 ? text(`补齐 ${missingAudioSceneNumbers.length} 段配音`, `Complete ${missingAudioSceneNumbers.length} narrations`) : text("重做本场景配音", "Regenerate scene narration")}
                  </button>
                </div>
              ) : null}
            </div>
            <button
              className="kv-primary"
              disabled={isBusy || exportProgress !== undefined || missingSceneNumbers.length > 0 || missingAudioSceneNumbers.length > 0 || invalidRenderMedia.length > 0 || qualityErrors.length > 0}
              onClick={onExport}
              type="button"
            >
              {exportProgress !== undefined ? <Loader2 className="kv-spin" size={16} /> : <Download size={16} />}
              {exportActionLabel({
                exportProgress,
                renderUrl: project.currentVersion.renderUrl,
                missingVisualCount: missingSceneNumbers.length,
                missingAudioCount: missingAudioSceneNumbers.length,
                invalidMediaCount: invalidRenderMedia.length + qualityErrors.length
              })}
            </button>
            {exportProgress !== undefined && activeRenderJobId ? (
              <button className="kv-cancel-export" onClick={() => onCancelExport(activeRenderJobId)} type="button">
                <X size={16} />
                {text("取消", "Cancel")}
              </button>
            ) : null}
          </div>
        </div>
        {exportReady ? (
          <section className="kv-export-readiness" role="status" aria-label={text("MP4 导出检查通过", "MP4 export checks passed")}>
            <div>
              <Check size={18} />
              <div>
                <strong>{text("MP4 导出检查通过", "MP4 export checks passed")}</strong>
                <span>{text("画面、配音和成片设置已经就绪，可以合成当前版本。", "Visuals, narration, and production settings are ready. This version can now be rendered.")}</span>
              </div>
            </div>
            <div className="kv-export-readiness-grid">
              {exportReadiness.map((item) => (
                <span key={`${item.label}-${item.value}`}>
                  <strong>{item.value}</strong>
                  <small>{item.label}</small>
                  <em>{item.detail}</em>
                </span>
              ))}
            </div>
          </section>
        ) : null}
        {exportBlockers.length > 0 || generationIssue.clip.length > 0 ? (
          <section className="kv-export-blockers" role="status" aria-label={text("待处理素材清单", "Assets requiring attention")}>
            <div>
              <Clock3 size={18} />
              <div>
                <strong>{exportBlockers.length > 0 ? text(`还有 ${exportBlockers.length} 项必需素材待处理`, `${exportBlockers.length} required assets need attention`) : text("可选动态镜头暂未完成", "Optional motion clips are not ready")}</strong>
                <span>{exportBlockers.length > 0 ? text("补齐必需素材后即可导出；动态镜头不会影响静态画面成片。", "Complete required assets to export. Motion clips are optional for a still-image render.") : text("当前静态画面仍可正常预览和导出，也可以稍后重试动态效果。", "The still-image version can still be previewed and exported. Motion can be retried later.")}</span>
              </div>
            </div>
            <div className="kv-export-blocker-list">
              {exportBlockers.map((item) => (
                <span className={item.tone} key={item.key}>
                  {item.tone === "danger" ? <AlertCircle size={14} /> : <Clock3 size={14} />}
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                  {item.key === "missing-visual" ? (
                    <button disabled={isBusy} onClick={() => onRegenerate(missingSceneNumbers)} type="button">{item.action}</button>
                  ) : item.key === "missing-audio" ? (
                    <button disabled={isBusy} onClick={() => onRegenerateAudio(missingAudioSceneNumbers)} type="button">{item.action}</button>
                  ) : item.key === "invalid-visual" ? (
                    <button disabled={isBusy} onClick={() => onRegenerate(invalidMedia.visual)} type="button">{item.action}</button>
                  ) : (
                    <button disabled={isBusy} onClick={() => onRegenerateAudio(invalidMedia.audio)} type="button">{item.action}</button>
                  )}
                </span>
              ))}
              {generationIssue.clip.length > 0 ? (
                <span className="optional" key="optional-clips">
                  <Clapperboard size={14} />
                  <strong>{videoBalanceRequired ? text("视频生成额度不足", "Insufficient video credits") : text("动态效果可稍后补充", "Motion can be added later")}</strong>
                  <small>
                    {text(`场景 ${sceneNumberListLabel(generationIssue.clip)} 已保留静态画面，不影响当前版本导出。`, `Scenes ${sceneNumberListLabel(generationIssue.clip)} retain still images and do not block export.`)}
                    {videoBalanceRequired ? text(" 补充视频模型余额或配置 BYOK 后即可继续生成。", " Add video-model credits or configure BYOK to continue.") : ""}
                  </small>
                  <button disabled={isBusy} onClick={() => onGenerateClips(generationIssue.clip)} type="button">
                    {videoBalanceRequired ? text("配置后重试", "Retry after setup") : text("重试动态镜头", "Retry motion clips")}
                  </button>
                </span>
              ) : null}
            </div>
          </section>
        ) : null}
        {qualityErrors.length > 0 ? (
          <section className="kv-media-readiness kv-media-readiness-danger" role="status" aria-label={text("成片质量异常", "Output quality issues")}>
            <div>
              <AlertCircle size={18} />
              <div>
                <strong>{text(`发现 ${qualityErrors.length} 项会影响成片的质量问题`, `${qualityErrors.length} quality issues may affect the final video`)}</strong>
                <span>{qualityErrors.map((issue) => issue.message).join(" ")}</span>
              </div>
            </div>
            <div className="kv-media-readiness-actions">
              {mediaAudit.repairVisualSceneNumbers.length > 0 ? (
                <button disabled={isBusy} onClick={() => onRegenerate(mediaAudit.repairVisualSceneNumbers)} type="button">
                  {isBusy ? <Loader2 className="kv-spin" size={15} /> : <ImagePlus size={15} />}
                  {text(`修复画面：场景 ${sceneNumberListLabel(mediaAudit.repairVisualSceneNumbers)}`, `Repair visuals: scenes ${sceneNumberListLabel(mediaAudit.repairVisualSceneNumbers)}`)}
                </button>
              ) : null}
              {mediaAudit.repairAudioSceneNumbers.length > 0 ? (
                <button disabled={isBusy} onClick={() => onRegenerateAudio(mediaAudit.repairAudioSceneNumbers)} type="button">
                  {isBusy ? <Loader2 className="kv-spin" size={15} /> : <Mic2 size={15} />}
                  {text(`修复配音：场景 ${sceneNumberListLabel(mediaAudit.repairAudioSceneNumbers)}`, `Repair narration: scenes ${sceneNumberListLabel(mediaAudit.repairAudioSceneNumbers)}`)}
                </button>
              ) : null}
              {mediaAudit.repairClipSceneNumbers.length > 0 ? (
                <button disabled={isBusy} onClick={() => onRegenerate(mediaAudit.repairClipSceneNumbers)} type="button">
                  {isBusy ? <Loader2 className="kv-spin" size={15} /> : <RefreshCcw size={15} />}
                  {text(`替换停帧镜头：场景 ${sceneNumberListLabel(mediaAudit.repairClipSceneNumbers)}`, `Replace frozen clips: scenes ${sceneNumberListLabel(mediaAudit.repairClipSceneNumbers)}`)}
                </button>
              ) : null}
            </div>
          </section>
        ) : null}
        {versionsOpen ? (
          <section className="kv-version-panel">
            <div className="kv-strip-heading">
              <div>
                <span className="kv-eyebrow">{text("版本历史", "Version history")}</span>
                <h3>{text("每次确认修改都会保留一个版本", "Every approved edit creates a version")}</h3>
              </div>
              <span>{text(`${versions.length} 个版本`, `${versions.length} versions`)}</span>
            </div>
            {versionsLoading ? (
              <div className="kv-version-loading"><Loader2 className="kv-spin" size={18} />{text("正在读取版本...", "Loading versions...")}</div>
            ) : (
              <div className="kv-version-list">
                {versions.map((version) => (
                  <article className={version.isCurrent ? "current" : ""} key={version.id}>
                    <div>
                      <strong>{version.label}</strong>
                      {version.isCurrent ? <span>{text("当前", "Current")}</span> : null}
                    </div>
                    <p className="kv-version-change">{version.changeSummary?.description ?? text("版本快照", "Version snapshot")}</p>
                    <p>{text(`${version.sceneCount} 个场景`, `${version.sceneCount} scenes`)} · {durationLabel(version.durationSeconds)}</p>
                    <small className={mediaCompletenessClass(version)}>{mediaCompletenessLabel(version)}</small>
                    <small className={`kv-output-status ${outputReadiness(version).tone}`}>
                      {outputReadiness(version).label}
                    </small>
                    <p className="kv-version-action-insight">{versionActionInsight(version)}</p>
                    <time>{new Date(version.createdAt).toLocaleString(text("zh-CN", "en-US"), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
                    <button disabled={isBusy || versionPreviewLoading} onClick={() => onPreviewVersion(version.id)} type="button">
                      <Eye size={15} />{text("预览比较", "Compare")}
                    </button>
                    {!version.isCurrent ? (
                      <button disabled={isBusy} onClick={() => onRestoreVersion(version.id)} type="button">
                        <RotateCcw size={15} />{text("恢复为新版本", "Restore as new version")}
                      </button>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
            {versionPreviewLoading ? (
              <div className="kv-version-loading"><Loader2 className="kv-spin" size={18} />{text("正在准备版本对比...", "Preparing comparison...")}</div>
            ) : versionPreview ? (
              <div className="kv-version-preview">
                <div className="kv-strip-heading">
                  <div><span className="kv-eyebrow">{text("版本比较", "Version comparison")}</span><h3>{text("确认差异后再决定是否恢复", "Review differences before restoring")}</h3></div>
                  <button aria-label={text("关闭版本比较", "Close comparison")} onClick={onCloseVersionPreview} title={text("关闭", "Close")} type="button"><X size={17} /></button>
                </div>
                <VersionComparison preview={versionPreview} />
              </div>
            ) : null}
          </section>
        ) : null}
        {exportsOpen ? (
          <section className="kv-export-panel">
            <div className="kv-strip-heading">
              <div>
                <span className="kv-eyebrow">{text("导出记录", "Export history")}</span>
                <h3>{text("MP4 合成任务与成片", "MP4 render jobs and outputs")}</h3>
              </div>
              <span>{text(`${renderJobs.length} 条记录`, `${renderJobs.length} records`)}</span>
            </div>
            {exportsLoading ? (
              <div className="kv-version-loading"><Loader2 className="kv-spin" size={18} />{text("正在读取导出记录...", "Loading export history...")}</div>
            ) : renderJobs.length === 0 ? (
              <div className="kv-export-empty">
                <FileVideo2 size={20} />
                <span>{text("当前项目还没有导出记录", "This project has no exports yet")}</span>
              </div>
            ) : (
              <div className="kv-export-list">
                {renderJobs.map((job) => {
                  const active = job.status === "queued" || job.status === "running";
                  const qualityLabel = renderJobQualityLabel(job);
                  const metadataItems = renderJobMetadataItems(job);
                  const recoveryAdvice = renderJobRecoveryAdvice(job);
                  const canRetryExport = job.status === "failed" && job.versionId === project.currentVersion.id && !isBusy && exportProgress === undefined;
                  return (
                    <article className={`status-${job.status}`} key={job.id}>
                      <div className="kv-export-summary">
                        <strong>{job.versionLabel ?? text(`版本 ${job.versionId.slice(0, 8)}`, `Version ${job.versionId.slice(0, 8)}`)}</strong>
                        <span>{renderJobStatus(job)}</span>
                      </div>
                      <time>{renderJobTime(job)}</time>
                      {qualityLabel ? <p className="kv-export-quality"><Check size={14} />{qualityLabel}</p> : null}
                      {metadataItems.length > 0 ? (
                        <div className="kv-export-metadata" aria-label="成片校验信息">
                          {metadataItems.map((item) => <span key={item}>{item}</span>)}
                        </div>
                      ) : null}
                      {active ? (
                        <div className="kv-export-progress" aria-label={`导出进度 ${job.progress}%`}>
                          <span style={{ width: `${Math.max(4, job.progress)}%` }} />
                        </div>
                      ) : null}
                      {job.error && job.status === "failed" ? <p>{job.error}</p> : null}
                      {recoveryAdvice ? (
                        <div className="kv-export-recovery" role="note">
                          <AlertCircle size={14} />
                          <span>{recoveryAdvice}</span>
                        </div>
                      ) : null}
                      <div className="kv-export-actions">
                        {job.status === "ready" && job.renderUrl ? (
                          <a download href={job.renderUrl}>
                            <Download size={15} />{text("下载 MP4", "Download MP4")}
                          </a>
                        ) : null}
                        {canRetryExport ? (
                          <button className="kv-export-retry" onClick={onExport} type="button">
                            <RefreshCcw size={15} />{text("重新导出 MP4", "Export MP4 again")}
                          </button>
                        ) : null}
                        {active ? (
                          <button onClick={() => onCancelExport(job.id)} type="button">
                            <X size={15} />{text("取消导出", "Cancel export")}
                          </button>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        ) : null}
        {assetsOpen ? (
          <SceneAssetsPanel
            isBusy={isBusy}
            onAdoptCandidate={(assetId) => onMutateScene({ operation: "set-visual", sceneNumber: scene.sceneNumber, assetId })}
            onComparisonOpened={onCandidateComparisonOpened}
            onGenerateCandidate={(instruction) => onGenerateCandidate(scene.sceneNumber, instruction)}
            onRemove={onRemoveAsset}
            onUpload={onUpload}
            openComparisonId={candidateToCompare?.sceneNumber === scene.sceneNumber ? candidateToCompare.assetId : undefined}
            scene={scene}
            uploadProgress={uploadProgress}
          />
        ) : null}
        {productionOpen ? (
          <ProductionSettingsPanel
            durationSeconds={project.currentVersion.durationSeconds}
            isBusy={isBusy}
            logo={productionAsset(project, "logo")}
            music={productionAsset(project, "music")}
            onChange={onUpdateProduction}
            onRemove={onRemoveProduction}
            onUpload={onUploadProduction}
            onUploadFile={onUploadProductionFile}
            settings={filmSettings}
            uploadProgress={uploadProgress}
            uploadType={productionUploadType}
          />
        ) : null}
        {view === "preview" ? (
          <>
            {missingSceneNumbers.length === 0 ? (
              <KnowVideoPlayer className="kv-remotion-player" project={project} ref={playerRef} />
            ) : (
              <section className="kv-preview missing-image">
                <div className="kv-missing-visual">
                  <ImagePlus size={34} />
                  <strong>{text(`还有 ${missingSceneNumbers.length} 个场景没有画面`, `${missingSceneNumbers.length} scenes are missing visuals`)}</strong>
                  <p>{text("生成缺失素材后，时间轴预览和 MP4 导出才会启用。", "Generate the missing assets to enable timeline preview and MP4 export.")}</p>
                  <button disabled={isBusy} onClick={() => onRegenerate(missingSceneNumbers)} type="button">
                    {isBusy ? <Loader2 className="kv-spin" size={16} /> : <RefreshCcw size={16} />}
                    {text("生成缺失画面", "Generate missing visuals")}
                  </button>
                </div>
              </section>
            )}
            <Storyboard
              isBusy={isBusy || exportProgress !== undefined}
              onGenerateClip={onGenerateClip}
              onMutate={onMutateScene}
              onRegenerate={onRegenerate}
              onRegenerateAudio={onRegenerateAudio}
              onSelect={selectScene}
              scenes={project.currentVersion.scenes}
              selectedScene={selectedScene}
            />
            <ScenePanel
              isBusy={isBusy}
              onSave={onSaveScene}
              onVoiceChange={onVoiceChange}
              scene={scene}
              scenes={project.currentVersion.scenes}
            />
          </>
        ) : (
          <StoryboardBoard scenes={project.currentVersion.scenes} />
        )}
      </section>
      <ChatPanel
        attachments={chatAttachments}
        busyAction={busyAction}
        input={input}
        isBusy={isBusy}
        messages={messages}
        onApply={onApply}
        onCancel={onCancel}
        onInput={onInput}
        onOpenAttachmentPicker={onOpenChatAttachmentPicker}
        onRemoveAttachment={onRemoveChatAttachment}
        onPreview={onPreviewPlan}
        onSubmit={onSubmit}
        pendingPlan={pendingPlan}
        scenes={project.currentVersion.scenes}
        selectedScene={selectedScene}
      />
    </div>
  );
}

export function WorkspaceClient({
  currentUser,
  initialProject,
  initialMessages,
  initialPendingPlan,
  source
}: {
  currentUser: AuthUser;
  initialProject: Project;
  initialMessages: ChatMessage[];
  initialPendingPlan?: EditPlan;
  source: Source;
}) {
  const [project, setProject] = useState(initialProject);
  const [projectSource, setProjectSource] = useState<Source>(source);
  const [stage, setStage] = useState<Stage>(initialPendingPlan ? "studio" : "brief");
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>("zh-CN");
  const [briefPrompt, setBriefPrompt] = useState("");
  const [briefAttachments, setBriefAttachments] = useState<File[]>([]);
  const [chatAttachments, setChatAttachments] = useState<File[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [selectedScene, setSelectedScene] = useState(1);
  const [pendingPlan, setPendingPlan] = useState<EditPlan | undefined>(initialPendingPlan);
  const [isBusy, setIsBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<BusyAction>();
  const [progress, setProgress] = useState(0);
  const [generationStatus, setGenerationStatus] = useState("正在理解视频需求");
  const [generationStartedAt, setGenerationStartedAt] = useState<number>();
  const [studioView, setStudioView] = useState<StudioView>("preview");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [exportProgress, setExportProgress] = useState<number | undefined>();
  const [invalidRenderMedia, setInvalidRenderMedia] = useState<InvalidRenderMedia[]>([]);
  const [generationIssues, setGenerationIssues] = useState<GenerationMediaIssue[]>([]);
  const [versions, setVersions] = useState<ProjectVersionSummary[]>([]);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionPreview, setVersionPreview] = useState<ProjectVersionPreview>();
  const [versionPreviewLoading, setVersionPreviewLoading] = useState(false);
  const [renderJobs, setRenderJobs] = useState<RenderJob[]>([]);
  const [exportsOpen, setExportsOpen] = useState(false);
  const [exportsLoading, setExportsLoading] = useState(false);
  const [activeRenderJobId, setActiveRenderJobId] = useState<string | undefined>(initialProject.currentVersion.renderJobId);
  const [uploadProgress, setUploadProgress] = useState<number | undefined>();
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [candidateToCompare, setCandidateToCompare] = useState<{ sceneNumber: number; assetId: string }>();
  const [productionOpen, setProductionOpen] = useState(false);
  const [productionUploadType, setProductionUploadType] = useState<"logo" | "music">();
  const [generationOptions, setGenerationOptions] = useState<GenerationOptions>({
    duration: "30",
    sceneCount: "auto",
    language: "中文",
    style: "电影质感",
    visualStyleId: "cinematic-realism",
    visualStyleLabel: "电影纪实",
    visualStylePrompt: "电影纪实风格：真实人物、浅景深、自然光影、现场空间和稳定镜头语言。",
    motion: "camera",
    videoTier: "economy",
    narrationVoice: DEFAULT_NARRATION_VOICE
  });
  const [pendingVideoGeneration, setPendingVideoGeneration] = useState<{ sceneNumbers: number[] }>();
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [projectQuery, setProjectQuery] = useState("");
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectActionBusy, setProjectActionBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const briefFileInputRef = useRef<HTMLInputElement>(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const musicInputRef = useRef<HTMLInputElement>(null);
  const recoveringRenderRef = useRef<string>();
  const recoveringGenerationRef = useRef(false);
  const cancelledRenderIdsRef = useRef(new Set<string>());

  useEffect(() => {
    const stored = window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY);
    if (stored === "zh-CN" || stored === "en") {
      setUiLanguage(stored);
      document.documentElement.lang = stored;
    }
  }, []);

  function changeUiLanguage(language: UiLanguage) {
    setUiLanguage(language);
    window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, language);
    document.documentElement.lang = language;
  }

  const generationPrompt = useMemo(() => briefPrompt.trim(), [briefPrompt]);

  useEffect(() => {
    setCandidateToCompare(undefined);
  }, [project.id, project.currentVersion.id]);

  useEffect(() => {
    const jobId = project.currentVersion.renderJobId;
    if (!jobId || project.currentVersion.renderUrl || recoveringRenderRef.current === jobId) return;
    recoveringRenderRef.current = jobId;
    setActiveRenderJobId(jobId);
    let cancelled = false;
    setExportProgress((current) => current ?? 5);
    void waitForRenderJob(
      jobId,
      () => cancelled || cancelledRenderIdsRef.current.has(jobId),
      (progress) => {
        setExportProgress(progress);
        setRenderJobs((current) => current.map((job) => job.id === jobId ? { ...job, progress } : job));
      }
    )
      .then((completed) => {
        if (!completed || cancelled) return;
        setRenderJobs((current) => [completed, ...current.filter((job) => job.id !== completed.id)]);
        if (completed.status !== "ready" || !completed.renderUrl) {
          throw new Error(completed.error || "MP4 渲染失败。");
        }
        setExportProgress(100);
        setProject((current) => current.currentVersion.id === completed.versionId
          ? {
            ...current,
            currentVersion: {
              ...current.currentVersion,
              renderJobId: undefined,
              renderUrl: completed.renderUrl,
              status: "ready"
            }
          }
          : current);
        pushMessage({
          role: "assistant",
          type: "text",
          content: "后台导出已经完成，可以下载 1080p MP4。",
          versionId: completed.versionId
        }, true);
      })
      .catch((error) => {
        if (cancelled || cancelledRenderIdsRef.current.has(jobId)) return;
        const message = error instanceof Error ? error.message : "视频导出失败。";
        setErrorMessage(message);
        pushMessage({ role: "assistant", type: "text", content: message });
      })
      .finally(() => {
        if (recoveringRenderRef.current === jobId) recoveringRenderRef.current = undefined;
        setActiveRenderJobId((current) => current === jobId ? undefined : current);
        if (!cancelled) setExportProgress(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [project.currentVersion.id, project.currentVersion.renderJobId, project.currentVersion.renderUrl]);

  useEffect(() => {
    if (recoveringGenerationRef.current) return;
    const pending = readPendingGenerationSession();
    if (!pending) {
      clearPendingGenerationSession();
      return;
    }
    recoveringGenerationRef.current = true;
    setBriefPrompt(pending.prompt);
    setGenerationOptions(pending.options);
    setGenerationStartedAt(pending.startedAt);
    setIsBusy(true);
    setErrorMessage(undefined);
    setProgress(36);
    setGenerationStatus("正在恢复刷新前的视频生成任务");
    setStage("generating");
    void waitForGenerationRequest(pending.requestId, () => {
      setGenerationStatus("正在等待后台完成脚本与分镜");
    })
      .then((data) => continueGeneratedProject(data, pending.options, true))
      .catch((error) => {
        const message = requestErrorMessage(error, "生成任务恢复失败，请稍后重试。");
        setErrorMessage(message);
        setStage("brief");
        if (/没有完成|没有找到|标识无效|数据不完整/.test(message)) {
          clearPendingGenerationSession();
        }
      })
      .finally(() => {
        recoveringGenerationRef.current = false;
        setIsBusy(false);
      });
  }, []);

  function pushMessage(message: Omit<ChatMessage, "id">, persist = false) {
    const id = crypto.randomUUID();
    setMessages((current) => {
      const last = current[current.length - 1];
      if (last?.role === message.role && last.content === message.content) return current;
      return [...current, { ...message, id }];
    });
    if (!persist || message.role !== "assistant") return;
    void fetch("/api/chat-messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id,
        projectId: project.id,
        versionId: message.versionId ?? project.currentVersion.id,
        content: message.content
      }),
      keepalive: true
    }).catch((error) => {
      console.error("[chat-message] Unable to persist production event:", error);
    });
  }

  async function continueGeneratedProject(
    data: Required<Pick<StoryboardGenerationResponse, "project" | "messages" | "engine">> & StoryboardGenerationResponse,
    options: GenerationOptions,
    resumeMissingOnly = false
  ) {
    let generatedProject = data.project;
    const warnings: string[] = [];
    const issues: GenerationMediaIssue[] = [];
    setProject(generatedProject);
    setProjectSource("database");
    setProjects([]);
    setVersions([]);
    setRenderJobs([]);
    setInvalidRenderMedia([]);
    setGenerationIssues([]);
    setVersionsOpen(false);
    setExportsOpen(false);
    setAssetsOpen(false);
    setProductionOpen(false);
    setActiveRenderJobId(undefined);
    setMessages([
      ...data.messages,
      {
        id: crypto.randomUUID(),
        role: "assistant",
        type: "text",
        content: data.engine === "ai"
          ? "AI 已完成脚本、分镜和镜头提示词。你可以继续用右侧对话改片。"
          : "已用本地规则生成初版分镜。"
      }
    ]);

    let missingImageSceneNumbers = missingSceneAssetNumbers(generatedProject.currentVersion.scenes, "image");
    let imageFailureReason = "场景画面生成失败。";
    for (let attempt = 0; attempt < AUTOMATIC_MEDIA_REPAIR_ATTEMPTS && missingImageSceneNumbers.length > 0; attempt += 1) {
      setProgress(64);
      setGenerationStatus(attempt === 0
        ? resumeMissingOnly ? "正在补齐尚未完成的场景画面" : "正在生成统一风格的场景画面"
        : `正在自动补齐 ${missingImageSceneNumbers.length} 个缺失画面（第 ${attempt + 1} 次）`);
      try {
        const imageResponse = await fetch("/api/assets/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectId: generatedProject.id,
            versionId: generatedProject.currentVersion.id,
            sceneNumbers: missingImageSceneNumbers,
            quality: "standard"
          }),
          signal: AbortSignal.timeout(IMAGE_GENERATION_TIMEOUT_MS)
        });
        const imageData = await imageResponse.json() as MediaGenerationResponse;
        if (imageData.project) {
          generatedProject = imageData.project;
          setProject(generatedProject);
        }
        if (!imageResponse.ok) imageFailureReason = imageData.error || imageFailureReason;
      } catch (error) {
        imageFailureReason = requestErrorMessage(error, imageFailureReason);
      }
      missingImageSceneNumbers = missingSceneAssetNumbers(generatedProject.currentVersion.scenes, "image");
    }
    if (missingImageSceneNumbers.length > 0) {
      warnings.push(imageFailureReason);
      issues.push(...missingImageSceneNumbers.map((sceneNumber) => ({ sceneNumber, type: "visual" as const, reason: imageFailureReason })));
    }

    let missingAudioSceneNumbers = missingSceneAssetNumbers(generatedProject.currentVersion.scenes, "audio");
    let audioFailureReason = "场景配音生成失败。";
    for (let attempt = 0; attempt < AUTOMATIC_MEDIA_REPAIR_ATTEMPTS && missingAudioSceneNumbers.length > 0; attempt += 1) {
      setProgress(84);
      setGenerationStatus(attempt === 0
        ? resumeMissingOnly ? "正在补齐尚未完成的自然配音" : "正在生成自然配音"
        : `正在自动补齐 ${missingAudioSceneNumbers.length} 段缺失配音（第 ${attempt + 1} 次）`);
      try {
        const audioResponse = await fetch("/api/assets/audio/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectId: generatedProject.id,
            versionId: generatedProject.currentVersion.id,
            sceneNumbers: missingAudioSceneNumbers
          }),
          signal: AbortSignal.timeout(AUDIO_GENERATION_TIMEOUT_MS)
        });
        const audioData = await audioResponse.json() as MediaGenerationResponse;
        if (audioData.project) {
          generatedProject = audioData.project;
          setProject(generatedProject);
        }
        if (!audioResponse.ok) audioFailureReason = audioData.error || audioFailureReason;
      } catch (error) {
        audioFailureReason = requestErrorMessage(error, audioFailureReason);
      }
      missingAudioSceneNumbers = missingSceneAssetNumbers(generatedProject.currentVersion.scenes, "audio");
    }
    if (missingAudioSceneNumbers.length > 0) {
      warnings.push(audioFailureReason);
      issues.push(...missingAudioSceneNumbers.map((sceneNumber) => ({ sceneNumber, type: "audio" as const, reason: audioFailureReason })));
    }

    if (missingImageSceneNumbers.length > 0 || missingAudioSceneNumbers.length > 0) {
      setProject(generatedProject);
      setGenerationIssues(issues);
      throw new Error(`系统自动补齐素材后仍有 ${missingImageSceneNumbers.length} 个画面和 ${missingAudioSceneNumbers.length} 段配音未完成。本次任务不会被标记为生成完成，系统会保留进度并在恢复任务时继续补齐。`);
    }

    if (options.motion === "key-scenes") {
      const selectedDynamicScenes = selectMotionCriticalScenes(
        generatedProject.currentVersion.scenes,
        generatedProject.currentVersion.durationSeconds
      );
      const dynamicScenes = missingMotionSceneNumbers(generatedProject.currentVersion.scenes, selectedDynamicScenes);
      if (dynamicScenes.length === 0 && generatedProject.currentVersion.scenes.every((scene) => !sceneVisualAsset(scene))) {
        warnings.push("没有可用于生成动态镜头的场景画面，请先在工作室补齐画面。");
      } else {
        for (const [index, sceneNumber] of dynamicScenes.entries()) {
          setProgress(88 + Math.round((index / Math.max(1, dynamicScenes.length)) * 6));
          setGenerationStatus(`正在生成场景 ${sceneNumber} 的动态视频镜头`);
          try {
            generatedProject = await requestVideoClips(generatedProject, [sceneNumber], options.videoTier);
            setProject(generatedProject);
          } catch (error) {
            const reason = requestErrorMessage(error, `场景 ${sceneNumber} 的动态镜头生成失败。`);
            warnings.push(reason);
            issues.push({
              sceneNumber,
              type: "clip",
              reason,
              errorCode: error instanceof MediaRequestError ? error.code : undefined
            });
          }
        }
      }
    }

    setGenerationStatus("正在保存可继续编辑的项目");
    setProgress(96);
    setGenerationIssues(issues);
    setErrorMessage(undefined);
    setMessages((current) => [...current, {
      id: crypto.randomUUID(),
      role: "assistant",
      type: "text",
      content: warnings.length > 0
        ? "脚本和分镜已经保存，部分媒体素材需要在工作室中重试。"
        : resumeMissingOnly
          ? "生成任务已经恢复，缺失的场景素材已继续完成。"
          : options.motion === "key-scenes"
            ? "场景画面、自然配音和关键动态镜头已经完成，可以播放预览或继续通过对话修改。"
            : "全部场景画面和配音已经完成，可以播放预览或继续通过对话修改。"
    }]);
    setSelectedScene(1);
    setPendingPlan(undefined);
    setStudioView("preview");
    setProgress(100);
    setGenerationStartedAt(undefined);
    clearPendingGenerationSession();
    setBriefAttachments([]);
    window.setTimeout(() => setStage("studio"), 350);
  }

  function addBriefAttachmentFiles(files: File[]) {
    if (files.length === 0) return;
    const valid: File[] = [];
    for (const file of files) {
      if (!uploadedAssetType(file.type)) {
        setErrorMessage(`“${file.name}”不是支持的图片、视频或音频格式。`);
        continue;
      }
      if (file.size > maxUploadBytes(file.type)) {
        setErrorMessage(`“${file.name}”超过该格式允许的大小。`);
        continue;
      }
      valid.push(file);
    }
    if (valid.length > 0) setErrorMessage(undefined);
    setBriefAttachments((current) => {
      const combined = [...current];
      for (const file of valid) {
        if (!combined.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) {
          combined.push(file);
        }
      }
      if (combined.length > 6) setErrorMessage("一次最多添加 6 个参考素材。");
      return combined.slice(0, 6);
    });
  }

  function selectBriefAttachments(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    addBriefAttachmentFiles(files);
  }

  function selectChatAttachments(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    const valid = files.filter((file) => {
      if (!uploadedAssetType(file.type)) {
        setErrorMessage(`“${file.name}”不是支持的图片、视频或音频格式。`);
        return false;
      }
      if (file.size > maxUploadBytes(file.type)) {
        setErrorMessage(`“${file.name}”超过该格式允许的大小。`);
        return false;
      }
      return true;
    });
    setChatAttachments((current) => {
      const combined = [...current];
      for (const file of valid) {
        if (!combined.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) {
          combined.push(file);
        }
      }
      if (combined.length > 4) setErrorMessage("一次对话最多添加 4 个参考素材。");
      return combined.slice(0, 4);
    });
  }

  async function extractVideoPoster(file: File): Promise<{ poster: File; durationSeconds?: number }> {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    const waitFor = (eventName: "loadeddata" | "seeked") => new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("读取视频关键帧超时。")), 15_000);
      const cleanup = () => {
        window.clearTimeout(timeout);
        video.removeEventListener(eventName, handleReady);
        video.removeEventListener("error", handleError);
      };
      const handleReady = () => {
        cleanup();
        resolve();
      };
      const handleError = () => {
        cleanup();
        reject(new Error("无法读取视频关键帧。"));
      };
      video.addEventListener(eventName, handleReady, { once: true });
      video.addEventListener("error", handleError, { once: true });
    });
    try {
      const loaded = waitFor("loadeddata");
      video.src = objectUrl;
      await loaded;
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const target = duration > 0.4 ? Math.min(2, Math.max(0.15, duration * 0.18)) : 0;
      if (target > 0.05) {
        const seeked = waitFor("seeked");
        video.currentTime = target;
        await seeked;
      }
      if (!video.videoWidth || !video.videoHeight) throw new Error("视频没有可读取的画面。");
      const scale = Math.min(1, 1280 / video.videoWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(2, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(2, Math.round(video.videoHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("浏览器无法提取视频关键帧。");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
        (result) => result ? resolve(result) : reject(new Error("视频关键帧编码失败。")),
        "image/jpeg",
        0.86
      ));
      return {
        poster: new File([blob], `${file.name}.poster.jpg`, {
          type: "image/jpeg",
          lastModified: file.lastModified
        }),
        durationSeconds: duration > 0 ? duration : undefined
      };
    } finally {
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function uploadGenerationReference(
    file: File,
    requestId: string,
    metadata: Pick<GenerationReferenceAsset, "derivedFrom" | "referenceRole" | "actualDurationSeconds"> = {}
  ): Promise<GenerationReferenceAsset> {
    const form = new FormData();
    form.set("file", file);
    form.set("requestId", requestId);
    if (metadata.derivedFrom) form.set("derivedFrom", metadata.derivedFrom);
    if (metadata.referenceRole) form.set("referenceRole", metadata.referenceRole);
    if (metadata.actualDurationSeconds) form.set("actualDurationSeconds", String(metadata.actualDurationSeconds));
    const response = await fetch("/api/generation-assets/upload", {
      method: "POST",
      body: form
    });
    const result = await response.json().catch(() => ({})) as GenerationReferenceAsset & { error?: string };
    if (!response.ok || !result.key) {
      throw new Error(result.error || `无法上传“${file.name}”。`);
    }
    return {
      key: result.key,
      name: result.name || file.name,
      size: result.size || file.size,
      contentType: result.contentType || file.type,
      derivedFrom: result.derivedFrom,
      referenceRole: result.referenceRole,
      actualDurationSeconds: result.actualDurationSeconds
    };
  }

  async function createVideo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = generationPrompt;
    if (!prompt) return;
    const startedAt = Date.now();
    const requestId = crypto.randomUUID();
    const uploadedReferences: GenerationReferenceAsset[] = [];
    let projectRequestStarted = false;

    setIsBusy(true);
    setErrorMessage(undefined);
    setGenerationStartedAt(startedAt);
    setProgress(8);
    setGenerationStatus("正在理解视频需求");
    setStage("generating");

    try {
      if (briefAttachments.length > 0) {
        setProgress(12);
        for (const [index, file] of briefAttachments.entries()) {
          setGenerationStatus(`正在上传参考素材 ${index + 1} / ${briefAttachments.length}`);
          let extractedVideo: Awaited<ReturnType<typeof extractVideoPoster>> | undefined;
          if (file.type.startsWith("video/")) {
            try {
              setGenerationStatus(`正在提取“${file.name}”的视觉关键帧`);
              extractedVideo = await extractVideoPoster(file);
            } catch (error) {
              console.warn(`[generation] Unable to extract poster for ${file.name}:`, error);
            }
          }
          uploadedReferences.push(await uploadGenerationReference(file, requestId, {
            actualDurationSeconds: extractedVideo?.durationSeconds
          }));
          if (extractedVideo) {
            try {
              uploadedReferences.push(await uploadGenerationReference(extractedVideo.poster, requestId, {
                derivedFrom: file.name,
                referenceRole: "video-poster"
              }));
            } catch (error) {
              console.warn(`[generation] Unable to upload poster for ${file.name}:`, error);
            }
          }
        }
      }
      setProgress(18);
      setGenerationStatus("正在规划脚本与分镜");
      const pendingSession: PendingGenerationSession = {
        requestId,
        prompt,
        options: generationOptions,
        startedAt
      };
      savePendingGenerationSession(pendingSession);
      let data: Required<Pick<StoryboardGenerationResponse, "project" | "messages" | "engine">> & StoryboardGenerationResponse;
      try {
        projectRequestStarted = true;
        const response = await fetch("/api/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt, options: generationOptions, requestId, referenceAssets: uploadedReferences }),
          signal: AbortSignal.timeout(90_000)
        });
        const result = await response.json().catch(() => ({})) as StoryboardGenerationResponse;
        if (response.status === 202 || result.status === "pending") {
          data = await waitForGenerationRequest(requestId, () => {
            setProgress(36);
            setGenerationStatus("脚本与分镜仍在后台生成，正在自动恢复");
          });
        } else {
          if (!response.ok) throw new Error(result.error || "视频项目创建失败。");
          if (!result.project || !Array.isArray(result.messages) || !result.engine) {
            throw new Error("视频项目创建返回的数据不完整，请重试。");
          }
          data = { ...result, project: result.project, messages: result.messages, engine: result.engine };
        }
      } catch (error) {
        const connectionInterrupted = error instanceof TypeError
          || (error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name));
        if (!connectionInterrupted) throw error;
        data = await waitForGenerationRequest(requestId, () => {
          setProgress(36);
          setGenerationStatus("连接超时，正在找回后台生成结果");
        });
      }
      await continueGeneratedProject(data, generationOptions, data.recovered === true);
    } catch (error) {
      console.error(error);
      if (uploadedReferences.length > 0 && !projectRequestStarted) {
        void fetch("/api/generation-assets/cleanup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ requestId, keys: uploadedReferences.map((reference) => reference.key) })
        }).catch(() => undefined);
      }
      setStage("brief");
      setGenerationStartedAt(undefined);
      setErrorMessage(requestErrorMessage(error, "生成失败，请稍后重试。"));
      pushMessage({
        role: "assistant",
        type: "text",
        content: "这次生成没有完成。你的需求仍保留在输入框中，可以稍后重试；如果持续失败，请从项目列表重新打开后再生成。"
      });
    } finally {
      setIsBusy(false);
    }
  }

  async function submitChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const attachments = [...chatAttachments];
    const request = chatInput.trim() || (attachments.length > 0 ? `请结合本次上传的参考素材，重新设计场景 ${selectedScene}。` : "");
    if (!request) return;
    if (pendingPlan && attachments.length > 0) {
      setErrorMessage("请先应用或取消当前修改方案，再添加新的参考素材。");
      return;
    }

    setChatInput("");
    setCandidateToCompare(undefined);
    setIsBusy(true);
    setBusyAction(pendingPlan ? "refining-edit" : "planning-edit");
    setErrorMessage(undefined);
    pushMessage({
      role: "user",
      type: "text",
      content: attachments.length > 0 ? `${request}\n已添加 ${attachments.length} 个参考素材。` : request
    });

    const requestId = attachments.length > 0 ? crypto.randomUUID() : undefined;
    const uploadedReferences: GenerationReferenceAsset[] = [];
    try {
      if (requestId) {
        for (const file of attachments) {
          const extractedVideo = file.type.startsWith("video/") ? await extractVideoPoster(file) : undefined;
          uploadedReferences.push(await uploadGenerationReference(file, requestId, {
            actualDurationSeconds: extractedVideo?.durationSeconds
          }));
          if (extractedVideo) {
            uploadedReferences.push(await uploadGenerationReference(extractedVideo.poster, requestId, {
              derivedFrom: file.name,
              referenceRole: "video-poster"
            }));
          }
        }
      }
      const response = await fetch("/api/edit-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          versionId: project.currentVersion.id,
          editPlanId: pendingPlan?.id,
          selectedSceneNumber: selectedScene,
          request,
          requestId,
          referenceAssets: uploadedReferences
        }),
        signal: AbortSignal.timeout(115_000)
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(failure.error || "修改计划生成失败，请重试。");
      }
      const data = await response.json() as {
        action?: "visual-candidate" | "version-restored";
        editPlan?: EditPlan;
        messages: ChatMessage[];
        project?: Project;
        candidate?: SceneAsset;
        candidateIntent?: { sceneNumber: number; instruction: string };
      };
      if (data.action === "version-restored") {
        if (!data.project || !Array.isArray(data.messages)) {
          throw new Error("版本恢复返回格式异常，请重试。");
        }
        setProject(data.project);
        setPendingPlan(undefined);
        setSelectedScene(data.project.currentVersion.scenes[0]?.sceneNumber ?? 1);
        setStudioView("preview");
        setVersionsOpen(false);
        setVersionPreview(undefined);
        setMessages((current) => [...current, ...data.messages.filter((message) => message.role === "assistant")]);
        void loadVersions();
        return;
      }
      if (data.action === "visual-candidate") {
        if (!data.project || !data.candidate || !data.candidateIntent || !Array.isArray(data.messages)) {
          throw new Error("候选画面返回格式异常，请重试。");
        }
        const assistantMessages = data.messages.filter((message) => message.role === "assistant");
        setProject(data.project);
        setPendingPlan(undefined);
        setSelectedScene(data.candidateIntent.sceneNumber);
        setStudioView("preview");
        setVersionsOpen(false);
        setExportsOpen(false);
        setProductionOpen(false);
        setAssetsOpen(true);
        setCandidateToCompare({ sceneNumber: data.candidateIntent.sceneNumber, assetId: data.candidate.id });
        setMessages((current) => [...current, ...assistantMessages]);
        return;
      }
      if (!data.editPlan || !Array.isArray(data.messages)) {
        throw new Error("修改计划返回格式异常，请重试。");
      }
      const assistantMessages = data.messages.filter((message) => message.role === "assistant");
      setPendingPlan(data.editPlan);
      setMessages((current) => [...current, ...assistantMessages]);
      setChatAttachments([]);
    } catch (error) {
      console.error(error);
      if (requestId && uploadedReferences.length > 0) {
        void fetch("/api/generation-assets/cleanup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ requestId, keys: uploadedReferences.map((reference) => reference.key) })
        }).catch(() => undefined);
      }
      const message = requestErrorMessage(error, "修改方案生成失败。");
      if (/请求超时/.test(message)) setChatInput(request);
      pushMessage({
        role: "assistant",
        type: "text",
        content: message
      });
    } finally {
      setIsBusy(false);
      setBusyAction(undefined);
    }
  }

  async function applyEditPlanRequest(editPlan: EditPlan, direct = false) {
    const response = await fetch("/api/edit-plan/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        versionId: project.currentVersion.id,
        direct,
        editPlan
      }),
      signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) {
      const failure = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(failure.error || "应用修改失败。");
    }
    const data = await response.json() as {
      project: Project;
      message: ChatMessage;
      selectedSceneNumber?: number;
      regeneration: { imageSceneNumbers: number[]; audioSceneNumbers: number[]; clipSceneNumbers: number[] };
    };
    let updatedProject = data.project;
    const warnings: string[] = [];
    setProject(updatedProject);
    setMessages((current) => [...current, data.message]);
    if (data.selectedSceneNumber) setSelectedScene(data.selectedSceneNumber);
    setVersions([]);

    if (data.regeneration.imageSceneNumbers.length > 0) {
      setBusyAction("generating-images");
      try {
        const imageResponse = await fetch("/api/assets/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectId: updatedProject.id,
            versionId: updatedProject.currentVersion.id,
            sceneNumbers: data.regeneration.imageSceneNumbers,
            quality: "standard"
          }),
          signal: AbortSignal.timeout(IMAGE_GENERATION_TIMEOUT_MS)
        });
        const imageData = await imageResponse.json() as { project?: Project; error?: string };
        if (imageData.project) {
          updatedProject = imageData.project;
          setProject(updatedProject);
        }
        if (!imageResponse.ok) warnings.push(imageData.error || "部分修改场景的画面生成失败。");
      } catch (error) {
        warnings.push(requestErrorMessage(error, "修改场景的画面生成失败。"));
      }
    }

    if (data.regeneration.audioSceneNumbers.length > 0) {
      setBusyAction("generating-audio");
      try {
        const audioResponse = await fetch("/api/assets/audio/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectId: updatedProject.id,
            versionId: updatedProject.currentVersion.id,
            sceneNumbers: data.regeneration.audioSceneNumbers
          }),
          signal: AbortSignal.timeout(125_000)
        });
        const audioData = await audioResponse.json() as { project?: Project; error?: string };
        if (audioData.project) {
          updatedProject = audioData.project;
          setProject(updatedProject);
        }
        if (!audioResponse.ok) warnings.push(audioData.error || "部分修改场景的配音生成失败。");
      } catch (error) {
        warnings.push(requestErrorMessage(error, "修改场景的配音生成失败。"));
      }
    }

    if (data.regeneration.clipSceneNumbers.length > 0) {
      warnings.push(`场景 ${data.regeneration.clipSceneNumbers.join("、")} 的画面已经修改。为避免产生未确认费用，动态镜头不会自动重做；需要时请点击“生成动态”并确认价格。`);
    }

    const completionMessage = warnings.length > 0
      ? `文字修改和新版本已经保存。${Array.from(new Set(warnings)).join(" ")}`
      : data.regeneration.imageSceneNumbers.length > 0
        || data.regeneration.audioSceneNumbers.length > 0
        || data.regeneration.clipSceneNumbers.length > 0
        ? "修改内容和受影响素材已经全部更新。"
        : "修改内容已经保存。";
    pushMessage({
      role: "assistant",
      type: "text",
      content: completionMessage,
      versionId: updatedProject.currentVersion.id
    }, true);
    setBusyAction("applying-edit");
    return updatedProject;
  }

  async function previewPendingPlan() {
    if (!pendingPlan) return;
    setIsBusy(true);
    setBusyAction("previewing-plan");
    setErrorMessage(undefined);
    try {
      const response = await fetch("/api/edit-plan/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          versionId: project.currentVersion.id,
          editPlanId: pendingPlan.id
        }),
        signal: AbortSignal.timeout(125_000)
      });
      const data = await response.json() as { project?: Project; error?: string };
      if (!response.ok || !data.project) throw new Error(data.error || "真实画面预览生成失败。");
      setProject(data.project);
      const firstScene = editPlanVisualSceneNumbers(pendingPlan)[0];
      if (firstScene) setSelectedScene(firstScene);
    } catch (error) {
      const message = requestErrorMessage(error, "真实画面预览生成失败，请稍后重试。");
      setErrorMessage(message);
      pushMessage({ role: "assistant", type: "text", content: message });
    } finally {
      setIsBusy(false);
      setBusyAction(undefined);
    }
  }

  async function applyPlan() {
    if (!pendingPlan) return;

    setIsBusy(true);
    setBusyAction("applying-edit");
    setErrorMessage(undefined);
    try {
      await applyEditPlanRequest(pendingPlan);
      setPendingPlan(undefined);
    } catch (error) {
      console.error(error);
      pushMessage({
        role: "assistant",
        type: "text",
        content: error instanceof Error ? error.message : "应用修改失败，请重试。"
      });
    } finally {
      setIsBusy(false);
      setBusyAction(undefined);
    }
  }

  async function mutateSceneStructure(mutation: SceneStructureMutation) {
    setIsBusy(true);
    setBusyAction("editing-timeline");
    setErrorMessage(undefined);
    try {
      const response = await fetch("/api/scenes/mutate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          versionId: project.currentVersion.id,
          ...mutation
        })
      });
      const data = await response.json() as {
        project?: Project;
        message?: ChatMessage;
        selectedSceneNumber?: number;
        regeneration?: { imageSceneNumbers: number[]; audioSceneNumbers: number[]; clipSceneNumbers: number[] };
        error?: string;
      };
      if (!response.ok || !data.project || !data.message || !data.selectedSceneNumber) {
        throw new Error(data.error || "时间线调整失败。");
      }
      let updatedProject = data.project;
      const warnings: string[] = [];
      setProject(updatedProject);
      setGenerationIssues([]);
      setMessages((current) => [...current, data.message!]);
      setSelectedScene(data.selectedSceneNumber);
      setPendingPlan(undefined);
      setVersions([]);
      setVersionsOpen(false);
      setExportsOpen(false);
      setAssetsOpen(mutation.operation === "set-visual");
      setProductionOpen(false);
      setActiveRenderJobId(undefined);

      const regeneration = data.regeneration ?? { imageSceneNumbers: [], audioSceneNumbers: [], clipSceneNumbers: [] };
      if (regeneration.imageSceneNumbers.length > 0) {
        setBusyAction("generating-images");
        try {
          const imageResponse = await fetch("/api/assets/generate", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              projectId: updatedProject.id,
              versionId: updatedProject.currentVersion.id,
              sceneNumbers: regeneration.imageSceneNumbers,
              quality: "standard"
            }),
            signal: AbortSignal.timeout(IMAGE_GENERATION_TIMEOUT_MS)
          });
          const imageData = await imageResponse.json() as { project?: Project; error?: string };
          if (imageData.project) {
            updatedProject = imageData.project;
            setProject(updatedProject);
          }
          if (!imageResponse.ok) warnings.push(imageData.error || "拆分或合并后的画面生成失败。");
        } catch (error) {
          warnings.push(requestErrorMessage(error, "拆分或合并后的画面生成失败。"));
        }
      }
      if (regeneration.audioSceneNumbers.length > 0) {
        setBusyAction("generating-audio");
        try {
          const audioResponse = await fetch("/api/assets/audio/generate", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              projectId: updatedProject.id,
              versionId: updatedProject.currentVersion.id,
              sceneNumbers: regeneration.audioSceneNumbers
            }),
            signal: AbortSignal.timeout(125_000)
          });
          const audioData = await audioResponse.json() as { project?: Project; error?: string };
          if (audioData.project) {
            updatedProject = audioData.project;
            setProject(updatedProject);
          }
          if (!audioResponse.ok) warnings.push(audioData.error || "拆分或合并后的配音生成失败。");
        } catch (error) {
          warnings.push(requestErrorMessage(error, "拆分或合并后的配音生成失败。"));
        }
      }
      if (regeneration.imageSceneNumbers.length > 0 || regeneration.audioSceneNumbers.length > 0) {
        const uniqueWarnings = Array.from(new Set(warnings));
        pushMessage({
          role: "assistant",
          type: "text",
          content: uniqueWarnings.length > 0
            ? `分镜结构和新版本已经保存。${uniqueWarnings.join(" ")}`
            : "分镜结构、场景画面和配音已经全部更新。",
          versionId: updatedProject.currentVersion.id
        }, true);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "时间线调整失败。";
      setErrorMessage(message);
      pushMessage({ role: "assistant", type: "text", content: message });
    } finally {
      setIsBusy(false);
      setBusyAction(undefined);
    }
  }

  async function saveSceneEdits(sceneNumber: number, edits: SceneTextEdits) {
    const scene = project.currentVersion.scenes.find((item) => item.sceneNumber === sceneNumber);
    if (!scene) return;
    const voiceoverChanged = edits.voiceover !== scene.voiceover;
    const titleChanged = edits.title !== scene.title;
    const visualChanged = edits.visualPrompt !== scene.visualPrompt;
    const motionChanged = edits.motionPrompt !== scene.motionPrompt;
    if (!titleChanged && !voiceoverChanged && !visualChanged && !motionChanged) return;

    const regenerate = new Set<SceneAsset["type"]>();
    if (voiceoverChanged) {
      regenerate.add("audio");
      regenerate.add("caption");
    }
    if (visualChanged) {
      regenerate.add("image");
      regenerate.add("thumbnail");
    }
    if (titleChanged) regenerate.add("caption");
    if (motionChanged || regenerate.size > 0) regenerate.add("render");
    const plan: EditPlan = {
      id: crypto.randomUUID(),
      editNumber: Math.max(1, Math.round(Date.now() / 1000) % 10000),
      baseVersionId: project.currentVersion.id,
      status: "proposed",
      userRequest: `直接编辑场景 ${sceneNumber}`,
      summary: `更新场景 ${sceneNumber} 的制作内容，并创建一个可恢复的新版本。`,
      affectedScenes: [sceneNumber],
      changes: [{
        sceneNumber,
        status: "updated",
        before: {
          title: scene.title,
          voiceover: scene.voiceover,
          thumbnailTone: scene.style.theme.includes("light") ? "light" : "dark",
          visualPrompt: scene.visualPrompt,
          motionPrompt: scene.motionPrompt
        },
        after: {
          ...edits,
          thumbnailTone: scene.style.theme.includes("light") ? "light" : "dark"
        },
        regenerate: Array.from(regenerate)
      }],
      createdAt: new Date().toISOString()
    };

    setIsBusy(true);
    setBusyAction("saving-scene");
    setErrorMessage(undefined);
    try {
      await applyEditPlanRequest(plan, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "场景保存失败。";
      setErrorMessage(message);
      pushMessage({ role: "assistant", type: "text", content: message });
    } finally {
      setIsBusy(false);
      setBusyAction(undefined);
    }
  }

  async function cancelPlan() {
    const plan = pendingPlan;
    if (!plan) return;
    setPendingPlan(undefined);
    try {
      const response = await fetch("/api/edit-plan/reject", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          versionId: project.currentVersion.id,
          editPlanId: plan.id
        })
      });
      const data = await response.json() as { message?: ChatMessage; error?: string };
      if (!response.ok || !data.message) throw new Error(data.error || "取消修改方案失败。");
      setProject((current) => removeEditPlanPreviewAssets(current, plan.id));
      setMessages((current) => [...current, data.message!]);
    } catch (error) {
      console.error(error);
      setPendingPlan(plan);
      const message = error instanceof Error ? error.message : "取消修改方案失败。";
      setErrorMessage(message);
      pushMessage({ role: "assistant", type: "text", content: message });
    }
  }

  async function loadVersions() {
    setVersionsLoading(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/versions`, { cache: "no-store" });
      const data = await response.json() as { versions?: ProjectVersionSummary[]; error?: string };
      if (!response.ok) throw new Error(data.error || "版本历史读取失败。");
      setVersions(data.versions ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : "版本历史读取失败。";
      setErrorMessage(message);
    } finally {
      setVersionsLoading(false);
    }
  }

  async function previewVersion(versionId: string) {
    setVersionPreviewLoading(true);
    setErrorMessage(undefined);
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(project.id)}/versions/${encodeURIComponent(versionId)}`,
        { cache: "no-store" }
      );
      const data = await response.json() as ProjectVersionPreview & { error?: string };
      if (!response.ok || !data.version || !data.currentVersion) {
        throw new Error(data.error || "版本预览读取失败。");
      }
      setVersionPreview(data);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "版本预览读取失败。");
      setVersionPreview(undefined);
    } finally {
      setVersionPreviewLoading(false);
    }
  }

  function toggleVersions() {
    const next = !versionsOpen;
    setVersionsOpen(next);
    if (next) {
      setAssetsOpen(false);
      setExportsOpen(false);
      setProductionOpen(false);
    }
    if (!next) setVersionPreview(undefined);
    if (next) void loadVersions();
  }

  async function loadRenderJobs(silent = false) {
    if (projectSource !== "database") {
      setRenderJobs([]);
      setExportsLoading(false);
      return;
    }
    if (!silent) setExportsLoading(true);
    try {
      const response = await fetch(`/api/render-jobs?projectId=${encodeURIComponent(project.id)}`, { cache: "no-store" });
      const data = await response.json() as { renderJobs?: RenderJob[]; error?: string };
      if (!response.ok) throw new Error(data.error || "导出记录读取失败。");
      setRenderJobs(data.renderJobs ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : "导出记录读取失败。";
      setErrorMessage(message);
    } finally {
      if (!silent) setExportsLoading(false);
    }
  }

  function toggleExports() {
    const next = !exportsOpen;
    setExportsOpen(next);
    if (next) {
      setAssetsOpen(false);
      setVersionsOpen(false);
      setVersionPreview(undefined);
      setProductionOpen(false);
      void loadRenderJobs();
    }
  }

  useEffect(() => {
    if (!exportsOpen || !renderJobs.some((job) => job.status === "queued" || job.status === "running")) return;
    const interval = window.setInterval(() => void loadRenderJobs(true), 3000);
    return () => window.clearInterval(interval);
  }, [exportsOpen, project.id, renderJobs.some((job) => job.status === "queued" || job.status === "running")]);

  function toggleAssets() {
    setAssetsOpen((current) => !current);
    setVersionsOpen(false);
    setVersionPreview(undefined);
    setExportsOpen(false);
    setProductionOpen(false);
  }

  function toggleProduction() {
    setProductionOpen((current) => !current);
    setAssetsOpen(false);
    setVersionsOpen(false);
    setVersionPreview(undefined);
    setExportsOpen(false);
  }

  async function cancelExport(jobId: string) {
    setErrorMessage(undefined);
    try {
      const response = await fetch("/api/render-jobs", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id, jobId })
      });
      const data = await response.json() as { renderJob?: RenderJob; error?: string };
      if (!response.ok || !data.renderJob) throw new Error(data.error || "取消导出失败。");
      cancelledRenderIdsRef.current.add(jobId);
      setRenderJobs((current) => [data.renderJob!, ...current.filter((job) => job.id !== jobId)]);
      setActiveRenderJobId((current) => current === jobId ? undefined : current);
      setExportProgress(undefined);
      if (data.renderJob.versionId === project.currentVersion.id) {
        setProject((current) => ({
          ...current,
          currentVersion: {
            ...current.currentVersion,
            renderJobId: undefined,
            status: "draft",
            renderUrl: undefined
          }
        }));
      }
      pushMessage({
        role: "assistant",
        type: "text",
        content: "本次 MP4 导出已取消，场景和素材不会受到影响。",
        versionId: data.renderJob.versionId
      }, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "取消导出失败。";
      setErrorMessage(message);
    }
  }

  async function restoreVersion(versionId: string) {
    setIsBusy(true);
    setBusyAction("restoring-version");
    setErrorMessage(undefined);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/versions/restore`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ versionId })
      });
      const data = await response.json() as { project?: Project; message?: ChatMessage; error?: string };
      if (!response.ok || !data.project || !data.message) throw new Error(data.error || "版本恢复失败。");
      setProject(data.project);
      setMessages((current) => [...current, data.message!]);
      setSelectedScene(1);
      setPendingPlan(undefined);
      setVersionPreview(undefined);
      await loadVersions();
    } catch (error) {
      const message = error instanceof Error ? error.message : "版本恢复失败。";
      setErrorMessage(message);
      pushMessage({ role: "assistant", type: "text", content: message });
    } finally {
      setIsBusy(false);
      setBusyAction(undefined);
    }
  }

  async function uploadAsset(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setIsBusy(true);
    setBusyAction("uploading-asset");
    setUploadProgress(0);
    try {
      const uploadLimit = file.type.startsWith("image/")
        ? 25_000_000
        : file.type.startsWith("audio/")
          ? 80_000_000
          : 500_000_000;
      if (file.size > uploadLimit) {
        const limitLabel = file.type.startsWith("image/")
          ? "25MB"
          : file.type.startsWith("audio/")
            ? "80MB"
            : "500MB";
        throw new Error(`该类型的单个素材不能超过 ${limitLabel}。`);
      }
      const videoMetadata = file.type.startsWith("video/")
        ? await extractVideoPoster(file).catch((error) => {
            console.warn(`[asset-upload] Unable to read duration for ${file.name}:`, error);
            return undefined;
          })
        : undefined;
      let uploadedAsset: SceneAsset;
      if (file.size <= 4_000_000) {
        const form = new FormData();
        form.set("file", file);
        form.set("projectId", project.id);
        form.set("versionId", project.currentVersion.id);
        form.set("sceneNumber", String(selectedScene));
        if (videoMetadata?.durationSeconds) {
          form.set("actualDurationSeconds", String(videoMetadata.durationSeconds));
        }
        const response = await fetch("/api/assets/upload", { method: "POST", body: form });
        const data = await response.json() as { asset?: SceneAsset; error?: string };
        if (!response.ok || !data.asset) throw new Error(data.error || "素材上传失败。");
        uploadedAsset = data.asset;
        setUploadProgress(100);
      } else {
        uploadedAsset = await uploadDirectAsset(file, videoMetadata?.durationSeconds);
      }
      setProject((current) => ({
        ...current,
        currentVersion: {
          ...current.currentVersion,
          renderUrl: undefined,
          scenes: current.currentVersion.scenes.map((scene) => scene.sceneNumber === selectedScene
            ? {
                ...scene,
                voiceover: uploadedAsset.type === "audio" && typeof uploadedAsset.metadata?.analysis === "string"
                  ? uploadedAsset.metadata.analysis
                  : scene.voiceover,
                style: {
                  ...scene.style,
                  referenceAssets: [
                    ...(scene.style.referenceAssets ?? []).filter((reference) => reference.key !== uploadedAsset.r2Key),
                    referenceDescriptor(uploadedAsset)
                  ]
                },
                assets: [
                  uploadedAsset,
                  ...scene.assets.filter((asset) => !replacementAssetTypes(uploadedAsset.type).includes(asset.type))
                ]
              }
            : scene)
        }
      }));
      pushMessage({
        role: "assistant",
        type: "text",
        content: `素材“${String(uploadedAsset.metadata?.name ?? "未命名素材")}”已应用到场景 ${selectedScene}。`,
        versionId: project.currentVersion.id
      }, true);
    } catch (error) {
      console.error(error);
      pushMessage({
        role: "assistant",
        type: "text",
        content: error instanceof Error ? error.message : "素材上传失败，请检查存储配置。"
      });
    } finally {
      setIsBusy(false);
      setBusyAction(undefined);
      setUploadProgress(undefined);
    }
  }

  async function uploadDirectAsset(file: File, actualDurationSeconds?: number): Promise<SceneAsset> {
    const descriptor = {
      projectId: project.id,
      versionId: project.currentVersion.id,
      sceneNumber: selectedScene,
      name: file.name,
      size: file.size,
      contentType: file.type,
      actualDurationSeconds
    };
    const initResponse = await fetch("/api/assets/upload-url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(descriptor)
    });
    const session = await initResponse.json() as {
      key?: string;
      uploadUrl?: string;
      error?: string;
    };
    if (!initResponse.ok || !session.key || !session.uploadUrl) {
      throw new Error(session.error || "无法开始大文件上传。");
    }
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", session.uploadUrl!);
      xhr.setRequestHeader("content-type", file.type);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) setUploadProgress(Math.min(96, Math.round((event.loaded / event.total) * 96)));
      };
      xhr.onload = () => xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`云端存储拒绝了上传（${xhr.status}）。`));
      xhr.onerror = () => reject(new Error("大文件直传失败，请检查 R2 Bucket 的 CORS 设置。"));
      xhr.send(file);
    });
    const attachResponse = await fetch("/api/assets/attach", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...descriptor, key: session.key })
    });
    const attached = await attachResponse.json() as { asset?: SceneAsset; error?: string };
    if (!attachResponse.ok || !attached.asset) throw new Error(attached.error || "无法绑定场景素材。");
    setUploadProgress(100);
    return attached.asset;
  }

  async function updateProductionSettingsAction(settings: Partial<ProductionSettings>) {
    setIsBusy(true);
    setBusyAction("saving-production");
    setErrorMessage(undefined);
    try {
      const response = await fetch("/api/production-settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          versionId: project.currentVersion.id,
          settings
        })
      });
      const data = await response.json() as { project?: Project; error?: string };
      if (!response.ok || !data.project) throw new Error(data.error || "成片设置保存失败。");
      setProject(data.project);
    } catch (error) {
      const message = error instanceof Error ? error.message : "成片设置保存失败。";
      setErrorMessage(message);
      pushMessage({ role: "assistant", type: "text", content: message });
    } finally {
      setIsBusy(false);
      setBusyAction(undefined);
    }
  }

  async function uploadProductionAssetFile(type: "logo" | "music", file: File) {
    setIsBusy(true);
    setBusyAction("uploading-asset");
    setProductionUploadType(type);
    setUploadProgress(0);
    setErrorMessage(undefined);
    try {
      if (type === "logo" && !["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
        throw new Error("Logo 仅支持 PNG、JPEG 或 WebP，建议使用透明 PNG。");
      }
      if (type === "music" && !["audio/mpeg", "audio/wav", "audio/x-wav"].includes(file.type)) {
        throw new Error("背景音乐仅支持 MP3 或 WAV。");
      }
      const limit = type === "logo" ? 25_000_000 : 80_000_000;
      if (file.size > limit) throw new Error(`${type === "logo" ? "Logo" : "背景音乐"}不能超过 ${type === "logo" ? "25MB" : "80MB"}。`);

      const descriptor = {
        projectId: project.id,
        versionId: project.currentVersion.id,
        type,
        name: file.name,
        size: file.size,
        contentType: file.type
      };
      const initResponse = await fetch("/api/production-assets/upload-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(descriptor)
      });
      const session = await initResponse.json() as { key?: string; uploadUrl?: string; error?: string };
      if (!initResponse.ok || !session.key || !session.uploadUrl) throw new Error(session.error || "无法开始成片素材上传。");

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", session.uploadUrl!);
        xhr.setRequestHeader("content-type", file.type);
        xhr.upload.onprogress = (progressEvent) => {
          if (progressEvent.lengthComputable) {
            setUploadProgress(Math.min(96, Math.round((progressEvent.loaded / progressEvent.total) * 96)));
          }
        };
        xhr.onload = () => xhr.status >= 200 && xhr.status < 300
          ? resolve()
          : reject(new Error(`云端存储拒绝了上传（${xhr.status}）。`));
        xhr.onerror = () => reject(new Error("成片素材直传失败，请检查 R2 Bucket 的 CORS 设置。"));
        xhr.send(file);
      });

      const attachResponse = await fetch("/api/production-assets/attach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...descriptor, key: session.key })
      });
      const attached = await attachResponse.json() as { project?: Project; error?: string };
      if (!attachResponse.ok || !attached.project) throw new Error(attached.error || "无法应用成片素材。");
      setUploadProgress(100);
      setProject(attached.project);
      pushMessage({
        role: "assistant",
        type: "text",
        content: `${type === "logo" ? "品牌 Logo" : "背景音乐"}“${file.name}”已应用到当前成片。`,
        versionId: attached.project.currentVersion.id
      }, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "成片素材上传失败。";
      setErrorMessage(message);
      pushMessage({ role: "assistant", type: "text", content: message });
    } finally {
      setIsBusy(false);
      setBusyAction(undefined);
      setProductionUploadType(undefined);
      setUploadProgress(undefined);
    }
  }

  async function uploadProductionAsset(type: "logo" | "music", event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await uploadProductionAssetFile(type, file);
  }

  async function removeProductionAsset(type: "logo" | "music") {
    setIsBusy(true);
    setBusyAction("saving-production");
    setErrorMessage(undefined);
    try {
      const response = await fetch("/api/production-assets/detach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id, versionId: project.currentVersion.id, type })
      });
      const data = await response.json() as { project?: Project; error?: string };
      if (!response.ok || !data.project) throw new Error(data.error || "无法移除成片素材。");
      setProject(data.project);
      pushMessage({
        role: "assistant",
        type: "text",
        content: `${type === "logo" ? "品牌 Logo" : "背景音乐"}已从当前成片移除。`,
        versionId: data.project.currentVersion.id
      }, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法移除成片素材。";
      setErrorMessage(message);
      pushMessage({ role: "assistant", type: "text", content: message });
    } finally {
      setIsBusy(false);
      setBusyAction(undefined);
    }
  }

  async function removeSceneAsset(assetId: string) {
    setIsBusy(true);
    try {
      const response = await fetch("/api/assets/detach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          versionId: project.currentVersion.id,
          sceneNumber: selectedScene,
          assetId
        })
      });
      const data = await response.json() as { error?: string; preserveRender?: boolean };
      if (!response.ok) throw new Error(data.error || "无法移除素材。");
      setProject((current) => ({
        ...current,
        currentVersion: {
          ...current.currentVersion,
          renderUrl: data.preserveRender ? current.currentVersion.renderUrl : undefined,
          renderJobId: data.preserveRender ? current.currentVersion.renderJobId : undefined,
          scenes: current.currentVersion.scenes.map((scene) => scene.sceneNumber === selectedScene
            ? (() => {
                const removed = scene.assets.find((asset) => asset.id === assetId);
                return {
                  ...scene,
                  style: removed?.metadata?.source === "user-upload"
                    ? {
                        ...scene.style,
                        referenceAssets: (scene.style.referenceAssets ?? []).filter((reference) => reference.key !== removed.r2Key)
                      }
                    : scene.style,
                  assets: scene.assets.filter((asset) => asset.id !== assetId)
                };
              })()
            : scene)
        }
      }));
      pushMessage({
        role: "assistant",
        type: "text",
        content: `场景 ${selectedScene} 的素材已从当前版本移除。`,
        versionId: project.currentVersion.id
      }, true);
    } catch (error) {
      pushMessage({ role: "assistant", type: "text", content: error instanceof Error ? error.message : "无法移除素材。" });
    } finally {
      setIsBusy(false);
    }
  }

  async function regenerateImages(sceneNumbers?: number[], quality: "standard" | "premium" = "standard") {
    setIsBusy(true);
    setBusyAction("generating-images");
    setErrorMessage(undefined);
    setVersionsOpen(false);
    setVersionPreview(undefined);
    setAssetsOpen(false);
    try {
      const response = await fetch("/api/assets/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          versionId: project.currentVersion.id,
          sceneNumbers,
          quality
        }),
        signal: AbortSignal.timeout(IMAGE_GENERATION_TIMEOUT_MS)
      });
      const data = await response.json() as MediaGenerationResponse;
      if (data.project) setProject(data.project);
      if (!response.ok || !data.project) throw new Error(data.error || "场景画面生成失败。");
      setInvalidRenderMedia((current) => withoutRepairedInvalidMedia(current, "visual", sceneNumbers));
      setGenerationIssues((current) => withoutRepairedGenerationIssues(current, "visual", sceneNumbers));
      pushMessage({
        role: "assistant",
        type: "text",
        content: sceneNumbers?.length === 1
          ? quality === "premium"
            ? `场景 ${sceneNumbers[0]} 已经提升为精细画质。`
            : `场景 ${sceneNumbers[0]} 的画面已经重新生成。`
          : "场景画面已经重新生成，可以继续播放或导出。",
        versionId: data.project.currentVersion.id
      }, true);
    } catch (error) {
      const message = requestErrorMessage(error, "场景画面生成失败，请稍后重试。");
      setErrorMessage(message);
      pushMessage({ role: "assistant", type: "text", content: message });
    } finally {
      setIsBusy(false);
      setBusyAction(undefined);
    }
  }

  async function generateImageCandidate(sceneNumber: number, instruction?: string) {
    setIsBusy(true);
    setBusyAction("generating-candidate");
    setErrorMessage(undefined);
    try {
      const response = await fetch("/api/assets/image/candidates/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          versionId: project.currentVersion.id,
          sceneNumber,
          instruction,
          quality: "standard"
        }),
        signal: AbortSignal.timeout(125_000)
      });
      const data = await response.json() as { project?: Project; candidate?: SceneAsset; error?: string };
      if (!response.ok || !data.project || !data.candidate) throw new Error(data.error || "候选画面生成失败。");
      setProject(data.project);
      setAssetsOpen(true);
      setCandidateToCompare({ sceneNumber, assetId: data.candidate.id });
      pushMessage({
        role: "assistant",
        type: "text",
        content: instruction
          ? `场景 ${sceneNumber} 已按“${compactText(instruction, "视觉修改", 42)}”生成候选画面。当前视频保持不变。`
          : `场景 ${sceneNumber} 新增了一张候选画面。当前视频保持不变，采用后才会创建新版本。`,
        versionId: data.project.currentVersion.id
      }, true);
    } catch (error) {
      const message = requestErrorMessage(error, "候选画面生成失败。");
      setErrorMessage(message);
      pushMessage({ role: "assistant", type: "text", content: message });
    } finally {
      setIsBusy(false);
      setBusyAction(undefined);
    }
  }

  async function regenerateAudio(sceneNumbers?: number[], narrationVoice?: NarrationVoice) {
    setIsBusy(true);
    setBusyAction("generating-audio");
    setErrorMessage(undefined);
    try {
      const response = await fetch("/api/assets/audio/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          versionId: project.currentVersion.id,
          sceneNumbers,
          narrationVoice
        }),
        signal: AbortSignal.timeout(125_000)
      });
      const data = await response.json() as MediaGenerationResponse;
      if (data.project) setProject(data.project);
      if (!response.ok || !data.project) throw new Error(data.error || "场景配音生成失败。");
      setInvalidRenderMedia((current) => withoutRepairedInvalidMedia(current, "audio", sceneNumbers));
      setGenerationIssues((current) => withoutRepairedGenerationIssues(current, "audio", sceneNumbers));
      pushMessage({
        role: "assistant",
        type: "text",
        content: sceneNumbers?.length === 1
          ? narrationVoice
            ? `场景 ${sceneNumbers[0]} 已切换为${narrationVoiceProfile(narrationVoice).label}，配音已经重新生成。`
            : `场景 ${sceneNumbers[0]} 的配音已经重新生成。`
          : "全部场景配音已经重新生成。",
        versionId: data.project.currentVersion.id
      }, true);
    } catch (error) {
      const message = requestErrorMessage(error, "场景配音生成失败，请稍后重试。");
      setErrorMessage(message);
      pushMessage({ role: "assistant", type: "text", content: message });
    } finally {
      setIsBusy(false);
      setBusyAction(undefined);
    }
  }

  async function requestVideoClips(
    baseProject: Project,
    sceneNumbers: number[],
    tier = generationOptions.videoTier
  ) {
    let updatedProject = baseProject;
    for (const sceneNumber of sceneNumbers) {
      const response = await fetch("/api/assets/video/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: updatedProject.id,
          versionId: updatedProject.currentVersion.id,
          sceneNumbers: [sceneNumber],
          tier,
          costConsent: true
        }),
        signal: AbortSignal.timeout(295_000)
      });
      const data = await response.json() as { project?: Project; error?: string; errorCode?: string };
      if (data.project) updatedProject = data.project;
      if (!response.ok || !data.project) {
        throw new MediaRequestError(data.error || "动态镜头生成失败。", data.errorCode);
      }
    }
    return updatedProject;
  }

  async function generateVideoClips(sceneNumbers: number[], tier = generationOptions.videoTier) {
    setIsBusy(true);
    setBusyAction("generating-video");
    setErrorMessage(undefined);
    try {
      const updatedProject = await requestVideoClips(project, sceneNumbers, tier);
      setProject(updatedProject);
      setGenerationIssues((current) => withoutRepairedGenerationIssues(current, "clip", sceneNumbers));
      pushMessage({
        role: "assistant",
        type: "text",
        content: sceneNumbers.length === 1
          ? `场景 ${sceneNumbers[0]} 的动态视频镜头已经生成，预览与 MP4 导出将优先使用该镜头。`
          : `${sceneNumbers.length} 个场景的动态视频镜头已经生成。`,
        versionId: updatedProject.currentVersion.id
      }, true);
    } catch (error) {
      const message = requestErrorMessage(error, "动态镜头生成失败。");
      const errorCode = error instanceof MediaRequestError ? error.code : undefined;
      setGenerationIssues((current) => [
        ...withoutRepairedGenerationIssues(current, "clip", sceneNumbers),
        ...sceneNumbers.map((sceneNumber) => ({ sceneNumber, type: "clip" as const, reason: message, errorCode }))
      ]);
      pushMessage({ role: "assistant", type: "text", content: message });
    } finally {
      setIsBusy(false);
      setBusyAction(undefined);
    }
  }

  async function exportVideo() {
    setErrorMessage(undefined);
    setExportProgress(5);
    let requestedJobId: string | undefined;
    try {
      const response = await fetch("/api/render-jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id, versionId: project.currentVersion.id })
      });
      const data = await response.json() as { renderJob?: RenderJob; error?: string; invalidMedia?: InvalidRenderMedia[] };
      if (!response.ok || !data.renderJob) {
        if (Array.isArray(data.invalidMedia) && data.invalidMedia.length > 0) {
          setInvalidRenderMedia(data.invalidMedia);
        }
        throw new Error(data.error || "MP4 渲染任务启动失败。");
      }
      setInvalidRenderMedia([]);
      const startedJob = data.renderJob;
      requestedJobId = startedJob.id;
      cancelledRenderIdsRef.current.delete(startedJob.id);
      setActiveRenderJobId(startedJob.id);
      setRenderJobs((current) => [startedJob, ...current.filter((job) => job.id !== startedJob.id)]);
      let completed: RenderJob | undefined = startedJob;
      if (completed.status === "queued" || completed.status === "running") {
        completed = await waitForRenderJob(
          completed.id,
          () => cancelledRenderIdsRef.current.has(startedJob.id),
          (progress) => {
            setExportProgress(progress);
            setRenderJobs((current) => current.map((job) => job.id === startedJob.id ? { ...job, progress } : job));
          }
        );
      }
      if (!completed) return;
      setRenderJobs((current) => [completed!, ...current.filter((job) => job.id !== completed!.id)]);
      if (completed.status !== "ready" || !completed.renderUrl) {
        throw new Error(completed.error || "MP4 渲染失败。");
      }
      setExportProgress(100);
      setProject((current) => ({
        ...current,
        currentVersion: { ...current.currentVersion, renderJobId: undefined, renderUrl: completed.renderUrl, status: "ready" }
      }));
      const anchor = document.createElement("a");
      anchor.href = completed.renderUrl;
      anchor.download = `${project.title}.mp4`;
      anchor.click();
      pushMessage({
        role: "assistant",
        type: "text",
        content: "1080p MP4 已完成合成并保存到云端。",
        versionId: completed.versionId
      }, true);
    } catch (error) {
      if (requestedJobId && cancelledRenderIdsRef.current.has(requestedJobId)) return;
      const message = error instanceof Error ? error.message : "视频导出失败。";
      setErrorMessage(message);
      pushMessage({ role: "assistant", type: "text", content: message });
    } finally {
      setExportProgress(undefined);
      setActiveRenderJobId(undefined);
    }
  }

  function resetToBrief() {
    setStage("brief");
    setPendingPlan(undefined);
    setChatInput("");
    setErrorMessage(undefined);
    setInvalidRenderMedia([]);
    setGenerationIssues([]);
    setVersionsOpen(false);
    setVersionPreview(undefined);
    setExportsOpen(false);
    setAssetsOpen(false);
    setCandidateToCompare(undefined);
    setProductionOpen(false);
  }

  async function openProjects() {
    setStage("projects");
    setPendingPlan(undefined);
    setErrorMessage(undefined);
    setProjectsLoading(true);
    try {
      const response = await fetch("/api/projects", { cache: "no-store" });
      const data = await response.json() as { projects?: ProjectListItem[]; error?: string };
      if (!response.ok) throw new Error(data.error || "项目列表读取失败。");
      setProjects(data.projects ?? []);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "项目列表读取失败。");
    } finally {
      setProjectsLoading(false);
    }
  }

  async function openProject(projectId: string) {
    setProjectsLoading(true);
    setErrorMessage(undefined);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { cache: "no-store" });
      const data = await response.json() as {
        project?: Project;
        messages?: ChatMessage[];
        pendingPlan?: EditPlan;
        error?: string;
      };
      if (!response.ok || !data.project || !data.messages) throw new Error(data.error || "项目读取失败。");
      setProject(data.project);
      setProjectSource("database");
      setMessages(data.messages);
      setSelectedScene(1);
      setPendingPlan(data.pendingPlan);
      setStudioView("preview");
      setVersions([]);
      setVersionPreview(undefined);
      setRenderJobs([]);
      setInvalidRenderMedia([]);
      setGenerationIssues([]);
      setVersionsOpen(false);
      setExportsOpen(false);
      setAssetsOpen(false);
      setCandidateToCompare(undefined);
      setProductionOpen(false);
      setActiveRenderJobId(data.project.currentVersion.renderJobId);
      setStage("studio");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "项目读取失败。");
    } finally {
      setProjectsLoading(false);
    }
  }

  async function renameProject(projectId: string, title: string) {
    if (!title) return false;
    setProjectActionBusy(true);
    setErrorMessage(undefined);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title })
      });
      const data = await response.json() as {
        project?: { id: string; title: string; updatedAt: string };
        error?: string;
      };
      if (!response.ok || !data.project) throw new Error(data.error || "项目重命名失败。");
      setProjects((current) => current.map((item) => item.id === projectId
        ? { ...item, title: data.project!.title, updatedAt: data.project!.updatedAt }
        : item));
      if (project.id === projectId) {
        setProject((current) => ({ ...current, title: data.project!.title }));
      }
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "项目重命名失败。");
      return false;
    } finally {
      setProjectActionBusy(false);
    }
  }

  async function deleteProject(projectId: string) {
    setProjectActionBusy(true);
    setErrorMessage(undefined);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });
      const data = await response.json() as { deleted?: boolean; error?: string };
      if (!response.ok || !data.deleted) throw new Error(data.error || "项目删除失败。");
      setProjects((current) => current.filter((item) => item.id !== projectId));
      if (project.id === projectId) {
        setProjectSource("empty");
        setMessages([]);
        setPendingPlan(undefined);
        setVersions([]);
        setVersionPreview(undefined);
        setRenderJobs([]);
        setInvalidRenderMedia([]);
        setGenerationIssues([]);
        setActiveRenderJobId(undefined);
      }
      setStage("projects");
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "项目删除失败。");
      return false;
    } finally {
      setProjectActionBusy(false);
    }
  }

  return (
    <UiLanguageContext.Provider value={{ language: uiLanguage, setLanguage: changeUiLanguage }}>
    <Shell
      currentUser={currentUser}
      onNewVideo={resetToBrief}
      onOpenProjects={() => void openProjects()}
      onOpenStudio={() => {
        if (projectSource !== "empty") setStage("studio");
      }}
      project={project}
      source={projectSource}
      stage={stage}
    >
      <input accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,audio/mpeg,audio/wav" hidden onChange={uploadAsset} ref={fileInputRef} type="file" />
      <input accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,audio/mpeg,audio/wav" hidden multiple onChange={selectBriefAttachments} ref={briefFileInputRef} type="file" />
      <input accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,audio/mpeg,audio/wav" hidden multiple onChange={selectChatAttachments} ref={chatFileInputRef} type="file" />
      <input accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => void uploadProductionAsset("logo", event)} ref={logoInputRef} type="file" />
      <input accept="audio/mpeg,audio/wav" hidden onChange={(event) => void uploadProductionAsset("music", event)} ref={musicInputRef} type="file" />
      {stage === "studio" && errorMessage ? (
        <div className="kv-global-error" role="alert">
          <AlertCircle size={18} />
          <span>{errorMessage}</span>
          <button aria-label="关闭错误提示" onClick={() => setErrorMessage(undefined)} type="button"><X size={16} /></button>
        </div>
      ) : null}
      {stage === "brief" ? (
        <BriefScreen
          attachments={briefAttachments}
          currentProject={project}
          isBusy={isBusy}
          onOpenStudio={() => setStage("studio")}
          onOpenAttachmentPicker={() => briefFileInputRef.current?.click()}
          onAddAttachments={addBriefAttachmentFiles}
          onOptionsChange={setGenerationOptions}
          onPromptChange={setBriefPrompt}
          onRemoveAttachment={(index) => setBriefAttachments((current) => current.filter((_, currentIndex) => currentIndex !== index))}
          onSubmit={createVideo}
          onUseExample={setBriefPrompt}
          prompt={briefPrompt}
          options={generationOptions}
          hasCurrentProject={projectSource !== "empty"}
          errorMessage={errorMessage}
        />
      ) : null}
      {stage === "generating" ? (
        <GeneratingScreen
          motion={generationOptions.motion}
          options={generationOptions}
          progress={progress}
          prompt={generationPrompt}
          startedAt={generationStartedAt}
          status={generationStatus}
        />
      ) : null}
      {stage === "projects" ? (
        <ProjectLibrary
          actionBusy={projectActionBusy}
          errorMessage={errorMessage}
          isLoading={projectsLoading}
          onCreate={resetToBrief}
          onDelete={deleteProject}
          onOpen={(projectId) => void openProject(projectId)}
          onQueryChange={setProjectQuery}
          onRename={renameProject}
          projects={projects}
          query={projectQuery}
        />
      ) : null}
      {stage === "studio" ? (
        <StudioScreen
          chatAttachments={chatAttachments}
          busyAction={busyAction}
          input={chatInput}
          isBusy={isBusy}
          messages={messages}
          onApply={applyPlan}
          onCancel={cancelPlan}
          onInput={setChatInput}
          onOpenChatAttachmentPicker={() => chatFileInputRef.current?.click()}
          onRemoveChatAttachment={(index) => setChatAttachments((current) => current.filter((_, currentIndex) => currentIndex !== index))}
          onPreviewPlan={previewPendingPlan}
          onSelectScene={setSelectedScene}
          onSubmit={submitChat}
          onUpload={() => fileInputRef.current?.click()}
          onRegenerate={regenerateImages}
          onEnhanceScene={(sceneNumber) => regenerateImages([sceneNumber], "premium")}
          onGenerateClip={(sceneNumber) => setPendingVideoGeneration({ sceneNumbers: [sceneNumber] })}
          onGenerateClips={(sceneNumbers) => setPendingVideoGeneration({ sceneNumbers: sceneNumbers.slice(0, 1) })}
          onRegenerateAudio={regenerateAudio}
          onExport={exportVideo}
          exportProgress={exportProgress}
          activeRenderJobId={activeRenderJobId}
          renderJobs={renderJobs}
          invalidRenderMedia={invalidRenderMedia}
          generationIssues={generationIssues}
          exportsOpen={exportsOpen}
          exportsLoading={exportsLoading}
          onToggleExports={toggleExports}
          onCancelExport={(jobId) => void cancelExport(jobId)}
          versions={versions}
          versionsOpen={versionsOpen}
          versionsLoading={versionsLoading}
          versionPreview={versionPreview}
          versionPreviewLoading={versionPreviewLoading}
          onToggleVersions={toggleVersions}
          onPreviewVersion={(versionId) => void previewVersion(versionId)}
          onCloseVersionPreview={() => setVersionPreview(undefined)}
          onRestoreVersion={restoreVersion}
          uploadProgress={uploadProgress}
          assetsOpen={assetsOpen}
          candidateToCompare={candidateToCompare}
          onCandidateComparisonOpened={() => setCandidateToCompare(undefined)}
          onToggleAssets={toggleAssets}
          onRemoveAsset={removeSceneAsset}
          onGenerateCandidate={(sceneNumber, instruction) => void generateImageCandidate(sceneNumber, instruction)}
          productionOpen={productionOpen}
          productionUploadType={productionUploadType}
          onToggleProduction={toggleProduction}
          onUpdateProduction={(settings) => void updateProductionSettingsAction(settings)}
          onUploadProduction={(type) => (type === "logo" ? logoInputRef : musicInputRef).current?.click()}
          onUploadProductionFile={(type, file) => void uploadProductionAssetFile(type, file)}
          onRemoveProduction={(type) => void removeProductionAsset(type)}
          onMutateScene={(mutation) => void mutateSceneStructure(mutation)}
          onSaveScene={saveSceneEdits}
          onVoiceChange={(sceneNumbers, voice) => void regenerateAudio(sceneNumbers, voice)}
          onViewChange={setStudioView}
          pendingPlan={pendingPlan}
          project={project}
          selectedScene={selectedScene}
          view={studioView}
        />
      ) : null}
      {pendingVideoGeneration ? (
        <div className="kv-modal-backdrop" onMouseDown={(event) => {
          if (event.currentTarget === event.target && !isBusy) setPendingVideoGeneration(undefined);
        }} role="presentation">
          <section aria-labelledby="video-cost-title" aria-modal="true" className="kv-confirm-modal kv-cost-modal" role="dialog">
            <div className="kv-confirm-icon"><Film size={21} /></div>
            <h3 id="video-cost-title">确认生成动态镜头</h3>
            <p>场景 {pendingVideoGeneration.sceneNumbers.join("、")} 将调用付费视频模型。系统只提交一次 3 秒请求，失败不会自动重试。</p>
            <div className="kv-cost-options">
              {(["economy", "balanced"] as const).map((tier) => (
                <label className={generationOptions.videoTier === tier ? "selected" : ""} key={tier}>
                  <input
                    checked={generationOptions.videoTier === tier}
                    name="video-tier"
                    onChange={() => setGenerationOptions((current) => ({ ...current, videoTier: tier }))}
                    type="radio"
                  />
                  <span><strong>{VIDEO_GENERATION_TIERS[tier].label}</strong><small>{VIDEO_GENERATION_TIERS[tier].resolution} · 3 秒</small></span>
                  <b>最高约 {videoGenerationEstimateLabel(tier)}</b>
                </label>
              ))}
            </div>
            <p className="kv-cost-note">这是按当前公开价格计算的最高预估，不包含静态画面与配音的少量用量。动态镜头会自动适配当前场景时长。</p>
            <div>
              <button disabled={isBusy} onClick={() => setPendingVideoGeneration(undefined)} type="button">取消</button>
              <button className="kv-cost-confirm" disabled={isBusy} onClick={() => {
                const request = pendingVideoGeneration;
                const tier = generationOptions.videoTier;
                setPendingVideoGeneration(undefined);
                void generateVideoClips(request.sceneNumbers, tier);
              }} type="button">
                <Film size={16} />确认，最高 {videoGenerationEstimateLabel(generationOptions.videoTier)}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </Shell>
    </UiLanguageContext.Provider>
  );
}

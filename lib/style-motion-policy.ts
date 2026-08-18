import type { Scene } from "@/lib/types";

type SceneStyle = Scene["style"];

const PHOTOGRAPHIC_STYLE_IDS = new Set(["cinematic-realism"]);
const NON_PHOTOGRAPHIC_TERMS = /chalk|粉笔|line[ -]?art|线稿|插画|illustration|collage|拼贴|comic|漫画|memphis|isometric|等距|pixel|像素|poster|海报|product ui|产品界面|vector|矢量|2d/i;
const PHOTOGRAPHIC_TERMS = /photo|photoreal|live[ -]?action|documentary|cinematic realism|摄影|写实|实拍|电影纪实/i;

function styleDescription(style: SceneStyle) {
  return [style.visualStyleId, style.visualStyleLabel, style.visualStylePrompt, style.theme, style.mood]
    .filter(Boolean)
    .join(" ");
}

export function styleAllowsFreeStockVideo(style: SceneStyle) {
  if (style.visualStyleId) return PHOTOGRAPHIC_STYLE_IDS.has(style.visualStyleId);
  const description = styleDescription(style);
  if (NON_PHOTOGRAPHIC_TERMS.test(description)) return false;
  if (PHOTOGRAPHIC_TERMS.test(description)) return true;
  return true;
}

export function freeStockVideoColorGrade(style: SceneStyle) {
  const description = styleDescription(style);
  if (/warm|自然|温暖|golden/i.test(description)) return "saturate(0.92) contrast(1.03) sepia(0.08)";
  if (/minimal|极简|quiet|清爽/i.test(description)) return "saturate(0.78) contrast(0.98) brightness(1.04)";
  if (/vivid|明快|活力|bright/i.test(description)) return "saturate(1.08) contrast(1.03)";
  return "saturate(0.9) contrast(1.06)";
}

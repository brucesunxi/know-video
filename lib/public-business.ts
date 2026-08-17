import { creditPacks, usdPrice } from "@/lib/billing/packs";

export const publicBusiness = {
  brandName: "Know Video",
  legalName: "北京简融易数科技有限公司",
  legalNameEnglish: "Beijing Jianrong Yishu Technology Co., Ltd.",
  description: "An AI-assisted video creation service that turns a written brief into a script, storyboard, scene visuals, narration, motion, and an editable MP4-ready project.",
  descriptionChinese: "一项 AI 辅助视频制作服务，可将文字需求转化为脚本、分镜、场景画面、旁白、动态效果和可编辑的 MP4 项目。",
  address: "北京华腾大厦1005室",
  addressEnglish: "Room 1005, Huateng Building, Beijing",
  country: "China",
  email: "support@know-video.app",
  phone: process.env.NEXT_PUBLIC_BUSINESS_PHONE?.trim() || "+86 133 1136 5567",
  phoneHref: "+8613311365567",
  website: "https://know-video.vercel.app/business"
} as const;

export const publicCreditPacks = creditPacks.map((pack) => ({
  ...pack,
  price: usdPrice(pack.priceUsdCents),
  deliveredCredits: pack.credits + pack.bonusCredits
}));

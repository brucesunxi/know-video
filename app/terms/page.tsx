import type { Metadata } from "next";
import { PolicyPage, PolicySection } from "@/app/public-site";
import { publicBusiness } from "@/lib/public-business";
import { getPublicLanguage } from "@/lib/public-language";

export const metadata: Metadata = { title: "Terms of Service | Know Video" };

const english = [
  ["1. Service and eligibility", "Know Video provides AI-assisted script, storyboard, image, narration, motion, editing, and MP4 export tools. You must be legally able to enter a contract and provide accurate account and billing information."],
  ["2. Accounts and customer content", "You are responsible for account security and for content you upload or request. You retain rights in your original content. You grant us the limited permission needed to process that content and deliver the service."],
  ["3. Credits and payments", "Credit packs are one-time purchases in USD. Purchased credits do not expire. Credits have no cash value, cannot be transferred between users, and are consumed according to the usage shown before a paid operation. Payment checkout is provided by Xendit."],
  ["4. Acceptable use", "Do not use the service for unlawful, deceptive, infringing, abusive, sexually exploitative, violent, or privacy-invasive content. Do not attempt to bypass safeguards, interfere with the service, or access another user's projects."],
  ["5. AI-generated output", "AI output can contain errors and must be reviewed before publication. You are responsible for confirming accuracy, rights clearance, and suitability. We may improve or regenerate failed assets, but do not guarantee that every output will meet a specific creative preference."],
  ["6. Availability and termination", "We may maintain, change, suspend, or discontinue features when reasonably necessary. We may restrict accounts that violate these terms. Material changes will be published on this page."]
];
const chinese = [
  ["1. 服务与使用资格", "Know Video 提供 AI 辅助的脚本、分镜、图片、旁白、动态、编辑和 MP4 导出工具。您必须具备依法订立合同的能力，并提供准确的账户和账单信息。"],
  ["2. 账户与客户内容", "您应负责账户安全以及上传或要求生成的内容。您保留原创内容的权利，并授权我们在提供服务所必需的范围内处理这些内容。"],
  ["3. Credits 与付款", "Credits 套餐以美元一次性购买，购买后不会过期。Credits 不具有现金价值、不可在用户之间转让，并按照付费操作前显示的用量扣除。付款结账由 Xendit 提供。"],
  ["4. 可接受使用", "不得将服务用于违法、欺骗、侵权、虐待、性剥削、暴力或侵犯隐私的内容。不得绕过安全措施、干扰服务或访问其他用户的项目。"],
  ["5. AI 生成内容", "AI 输出可能包含错误，发布前必须由您审核。您应确认准确性、权利许可和适用性。我们可能改进或重新生成失败素材，但不保证每项输出都符合特定创意偏好。"],
  ["6. 可用性与终止", "在合理必要时，我们可能维护、变更、暂停或停止部分功能，也可能限制违反本条款的账户。重大变更将在本页面公布。"]
];

export default async function TermsPage() {
  const language = await getPublicLanguage();
  const isChinese = language === "zh-CN";
  const company = isChinese ? publicBusiness.legalName : `${publicBusiness.legalNameEnglish} (${publicBusiness.legalName})`;
  const sections = isChinese ? chinese : english;
  return <PolicyPage language={language} eyebrow={isChinese ? "法律" : "Legal"} title={isChinese ? "服务条款" : "Terms of Service"} intro={isChinese ? `生效日期：2026年8月17日。本条款适用于由${company}运营的 Know Video。` : `Effective August 17, 2026. These terms govern the use of Know Video, operated by ${company}.`}>
    {sections.map(([title, body]) => <PolicySection key={title} title={title}><p>{body}</p></PolicySection>)}
    <PolicySection title={isChinese ? "7. 联系方式" : "7. Contact"}><p>{isChinese ? <>如有问题，请发送邮件至 <a href={`mailto:${publicBusiness.email}`}>{publicBusiness.email}</a>。企业地址：{publicBusiness.address}，中国。</> : <>Questions may be sent to <a href={`mailto:${publicBusiness.email}`}>{publicBusiness.email}</a>. Business address: {publicBusiness.addressEnglish}, China.</>}</p></PolicySection>
  </PolicyPage>;
}

import type { Metadata } from "next";
import { PolicyPage, PolicySection } from "@/app/public-site";
import { publicBusiness } from "@/lib/public-business";
import { getPublicLanguage } from "@/lib/public-language";

export const metadata: Metadata = { title: "Privacy Policy | Know Video" };

export default async function PrivacyPage() {
  const language = await getPublicLanguage();
  const zh = language === "zh-CN";
  const company = zh ? publicBusiness.legalName : `${publicBusiness.legalNameEnglish} (${publicBusiness.legalName})`;
  return <PolicyPage language={language} eyebrow={zh ? "法律" : "Legal"} title={zh ? "隐私政策" : "Privacy Policy"} intro={zh ? `生效日期：2026年8月17日。${company}为运营 Know Video 及支持客户而处理个人数据。` : `Effective August 17, 2026. ${company} processes personal data to operate Know Video and support its customers.`}>
    <PolicySection title={zh ? "我们收集的信息" : "Information we collect"}><ul>
      <li>{zh ? "姓名、电子邮箱和身份验证标识等账户信息。" : "Account information such as name, email address, and authentication identifiers."}</li>
      <li>{zh ? "项目提示词、上传文件、生成素材、设置和编辑历史。" : "Project prompts, uploaded files, generated assets, settings, and editing history."}</li>
      <li>{zh ? "购买记录、Credits 余额事件、设备数据和服务诊断信息。" : "Purchase records, credit balance events, device data, and service diagnostics."}</li>
      <li>{zh ? "支持沟通以及您主动提供的信息。" : "Support communications and the information you choose to provide."}</li>
    </ul></PolicySection>
    <PolicySection title={zh ? "信息用途" : "How information is used"}><p>{zh ? "我们使用相关信息验证用户身份、创建和保存项目、生成所请求的媒体、处理付款、防止滥用、提供支持、维护可靠性并履行法律义务。" : "We use information to authenticate users, create and store projects, generate requested media, process payments, prevent abuse, provide support, maintain reliability, and comply with legal obligations."}</p></PolicySection>
    <PolicySection title={zh ? "服务提供商" : "Service providers"}><p>{zh ? "我们仅在交付服务所需范围内使用签约的基础设施、AI、语音、存储、身份验证和支付服务商。Xendit 根据其隐私条款处理结账和付款信息。我们不会出售个人数据。" : "We use contracted infrastructure, AI, speech, storage, authentication, and payment providers only as needed to deliver the service. Xendit processes checkout and payment information under its own privacy terms. We do not sell personal data."}</p></PolicySection>
    <PolicySection title={zh ? "保留与安全" : "Retention and security"}><p>{zh ? "项目和账户信息会在账户有效期间保留，并根据法律、账单、反欺诈和备份需要继续保留。我们采用访问控制、传输加密和限定范围的存储权限，但任何互联网服务都无法承诺绝对安全。" : "Project and account information is retained while your account is active and as needed for legal, billing, fraud-prevention, and backup purposes. We use access controls, encryption in transit, and scoped storage permissions, but no internet service can promise absolute security."}</p></PolicySection>
    <PolicySection title={zh ? "您的选择" : "Your choices"}><p>{zh ? <>在适用法律和账单留存要求允许的范围内，您可以申请访问、更正、导出或删除个人信息。联系方式：<a href={`mailto:${publicBusiness.email}`}>{publicBusiness.email}</a>。</> : <>You may request access, correction, export, or deletion of personal information, subject to applicable legal and billing retention requirements. Contact <a href={`mailto:${publicBusiness.email}`}>{publicBusiness.email}</a>.</>}</p></PolicySection>
    <PolicySection title={zh ? "企业联系方式" : "Business contact"}><p>{company}<br />{zh ? `${publicBusiness.address}，中国` : `${publicBusiness.addressEnglish}, China`}<br /><a href={`tel:${publicBusiness.phoneHref}`}>{publicBusiness.phone}</a></p></PolicySection>
  </PolicyPage>;
}

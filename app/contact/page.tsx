import type { Metadata } from "next";
import { PolicyPage, PolicySection } from "@/app/public-site";
import { publicBusiness } from "@/lib/public-business";
import { getPublicLanguage } from "@/lib/public-language";

export const metadata: Metadata = { title: "Contact | Know Video" };

export default async function ContactPage() {
  const language = await getPublicLanguage();
  const zh = language === "zh-CN";
  const company = zh ? publicBusiness.legalName : `${publicBusiness.legalNameEnglish} (${publicBusiness.legalName})`;
  return <PolicyPage language={language} eyebrow={zh ? "支持" : "Support"} title={zh ? "联系 Know Video" : "Contact Know Video"} intro={zh ? "如需产品帮助，或有账单、隐私和退款问题，请联系运营公司。" : "Contact the operating company for product help, billing questions, privacy requests, or refund requests."}>
    <PolicySection title={zh ? "运营主体" : "Business operator"}><p><strong>{company}</strong><br />{zh ? `${publicBusiness.address}，中国` : `${publicBusiness.addressEnglish}, China`}</p></PolicySection>
    <PolicySection title={zh ? "客户支持" : "Customer support"}><p>{zh ? "邮箱" : "Email"}: <a href={`mailto:${publicBusiness.email}`}>{publicBusiness.email}</a><br />{zh ? "电话" : "Telephone"}: <a href={`tel:${publicBusiness.phoneHref}`}>{publicBusiness.phone}</a><br />{zh ? "服务时间：周一至周五 09:00-18:00（中国标准时间）" : "Hours: Monday-Friday, 09:00-18:00 China Standard Time"}</p></PolicySection>
    <PolicySection title={zh ? "响应时间" : "Response times"}><p>{zh ? "我们通常会在 2 个工作日内确认收到支持和退款申请。账单问题请提供账户邮箱和付款参考编号，但请勿通过邮件发送银行卡信息或密码。" : "We normally acknowledge support and refund requests within 2 business days. Include your account email and payment reference for billing questions, but never send card details or passwords by email."}</p></PolicySection>
  </PolicyPage>;
}

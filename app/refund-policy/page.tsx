import type { Metadata } from "next";
import { PolicyPage, PolicySection } from "@/app/public-site";
import { publicBusiness } from "@/lib/public-business";
import { getPublicLanguage } from "@/lib/public-language";

export const metadata: Metadata = { title: "Refund Policy | Know Video" };

const english = [
  ["Unused credit packs", "You may request a refund within 7 calendar days of purchase when none of the credits from that purchase have been consumed. Requests must include the account email, purchase date, amount, and payment reference."],
  ["Failed generation tasks", "A failed generation task does not settle its reserved credits. The credits are released back to the account automatically. This is not treated as a separate cash refund because the generation charge was never completed."],
  ["Duplicate or incorrect charges", "Verified duplicate charges or incorrect payment amounts are eligible for a full correction. Contact us promptly so we can compare the Xendit payment record with the Know Video credit ledger."],
  ["Delivered digital services", "Credits already consumed for completed scripts, images, narration, motion clips, or other delivered digital outputs are generally non-refundable, except where required by law or where a confirmed platform billing defect occurred."],
  ["How refunds are issued", "Approved refunds are returned to the original payment method through Xendit. Processing commonly takes 5-10 business days after approval, depending on the payment channel and issuing institution."]
];
const chinese = [
  ["未使用的 Credits 套餐", "购买后 7 个自然日内，如该笔购买中的 Credits 均未使用，您可以申请退款。申请需包含账户邮箱、购买日期、金额和付款参考编号。"],
  ["失败的生成任务", "生成任务失败时不会结算预留的 Credits，系统会自动将其释放回账户。由于生成扣费并未完成，因此不作为单独的现金退款处理。"],
  ["重复或错误扣款", "经核实的重复扣款或错误付款金额可获得全额更正。请及时联系我们，以便核对 Xendit 付款记录和 Know Video Credits 账本。"],
  ["已交付的数字服务", "已用于完成脚本、图片、旁白、动态片段或其他已交付数字输出的 Credits 通常不予退款，但法律另有要求或确认存在平台账单故障的情况除外。"],
  ["退款方式", "获批退款将通过 Xendit 原路退回。根据支付渠道和发卡机构不同，批准后通常需要 5 至 10 个工作日到账。"]
];

export default async function RefundPolicyPage() {
  const language = await getPublicLanguage();
  const zh = language === "zh-CN";
  const sections = zh ? chinese : english;
  return <PolicyPage language={language} eyebrow={zh ? "账单" : "Billing"} title={zh ? "退款政策" : "Refund Policy"} intro={zh ? "本政策说明 Know Video Credits 购买在何种情况下可以退款，以及失败的生成任务如何处理。" : "This policy explains when a Know Video credit purchase may be refunded and how failed generation tasks are handled."}>
    {sections.map(([title, body]) => <PolicySection key={title} title={title}><p>{body}</p></PolicySection>)}
    <PolicySection title={zh ? "申请退款" : "Request a refund"}><p>{zh ? "请发送邮件至" : "Email"} <a href={`mailto:${publicBusiness.email}?subject=Refund%20request`}>{publicBusiness.email}</a>{zh ? "。我们通常会在 2 个工作日内确认收到申请。" : ". We normally acknowledge requests within 2 business days."}</p></PolicySection>
  </PolicyPage>;
}

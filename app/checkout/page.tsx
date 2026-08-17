import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, ShieldCheck } from "lucide-react";
import { PublicPage } from "@/app/public-site";
import styles from "@/app/public-site.module.css";
import { publicCreditPacks } from "@/lib/public-business";
import { getPublicLanguage, publicText } from "@/lib/public-language";

export const metadata: Metadata = { title: "Checkout | Know Video", description: "Review Know Video credit-pack prices and the secure Xendit checkout process." };

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<{ pack?: string }> }) {
  const requestedPack = (await searchParams).pack;
  const language = await getPublicLanguage();
  const text = (chinese: string, english: string) => publicText(language, chinese, english);
  const steps = language === "zh-CN" ? [
    ["登录账户", "创建或登录账户，确保 Credits 安全发放到正确用户。"],
    ["确认套餐", "付款前核对套餐、准确的美元价格和 Credits 数量。"],
    ["通过 Xendit 付款", "在 Xendit 托管的安全结账页面完成付款。"],
    ["收到 Credits", "付款确认后，Credits 会添加到账户并显示在余额中。"]
  ] : [
    ["Sign in", "Create or access your account so credits have a secure owner."],
    ["Confirm pack", "Review the pack, exact USD price, and credit amount before paying."],
    ["Pay with Xendit", "Complete payment on the secure Xendit-hosted checkout page."],
    ["Receive credits", "Credits are added after payment confirmation and shown in your account."]
  ];

  return (
    <PublicPage language={language}>
      <main className={styles.policyMain}>
        <p className={styles.eyebrow}>{text("安全结账", "Secure checkout")}</p>
        <h1>{text("选择预付费 Credits 套餐", "Choose a prepaid credit pack")}</h1>
        <p>{text("价格均以美元显示，属于一次性购买，并非订阅。您需要登录 Know Video 账户，以便安全接收购买的 Credits。", "Prices are shown in US dollars. Payment is a one-time purchase, not a subscription. A Know Video account is required so purchased credits can be delivered securely.")}</p>
        <div className={styles.checkoutGrid}>
          {publicCreditPacks.map((pack) => (
            <article className={`${styles.priceCard} ${pack.id === requestedPack || pack.featured ? styles.priceCardFeatured : ""}`} key={pack.id}>
              <h3>{pack.name}</h3><div className={styles.price}>{pack.price}</div><span>{text("一次性付款", "one-time payment")}</span>
              <p>{text(pack.id === "starter" ? "适合初次体验完整视频工作流" : pack.id === "creator" ? "适合稳定创作的个人和小团队" : "适合有持续产量的制作团队", pack.description)}</p>
              <ul>
                <li><Check size={16} /> {pack.deliveredCredits.toLocaleString("en-US")} Credits</li>
                <li><Check size={16} /> {text(`约 ${pack.standardVideoEstimate} 条标准视频`, `About ${pack.standardVideoEstimate} standard videos`)}</li>
                <li><ShieldCheck size={16} /> {text("失败输出不扣 Credits", "Failed outputs use no credits")}</li>
              </ul>
              <Link className={styles.primaryLink} href={`/?purchase=${pack.id}`}>{text("登录并继续", "Sign in and continue")} <ArrowRight size={17} /></Link>
            </article>
          ))}
        </div>
        <section className={styles.policySection}><h2>{text("付款流程", "How payment works")}</h2><div className={styles.checkoutFlow}>
          {steps.map(([title, description], index) => <div className={styles.checkoutStep} key={title}><span>{index + 1}</span><strong>{title}</strong><p>{description}</p></div>)}
        </div></section>
        <div className={styles.checkoutNotice}>
          {language === "zh-CN" ? <>
            继续即表示您同意<Link href="/terms">《服务条款》</Link>。付款前请阅读<Link href="/refund-policy">《退款政策》</Link>和<Link href="/privacy">《隐私政策》</Link>。客户支持信息请参阅<Link href="/contact">联系页面</Link>。
          </> : <>
            By continuing, you agree to the <Link href="/terms">Terms of Service</Link>. Please review the <Link href="/refund-policy">Refund Policy</Link> and <Link href="/privacy">Privacy Policy</Link> before payment. Customer support is available through the <Link href="/contact">contact page</Link>.
          </>}
        </div>
      </main>
    </PublicPage>
  );
}

import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check, ShieldCheck } from "lucide-react";
import { PublicPage } from "@/app/public-site";
import styles from "@/app/public-site.module.css";
import { publicBusiness, publicCreditPacks } from "@/lib/public-business";
import { getPublicLanguage, publicText } from "@/lib/public-language";

export const metadata: Metadata = { title: "Know Video | AI Video Creation Service", description: publicBusiness.description };

const services = [
  { en: ["Script and storyboard", "Turn a written brief into a structured narrative and editable scene plan."], zh: ["脚本与分镜", "将文字需求整理为结构化叙事和可编辑的场景计划。"] },
  { en: ["Scene visuals", "Generate subject-relevant images with consistent art direction and quality checks."], zh: ["场景画面", "生成与主题相关、视觉方向一致并经过质量检查的图片。"] },
  { en: ["Narration and timing", "Create selectable Chinese or English narration and align scenes to speech."], zh: ["旁白与时序", "生成可选音色的中英文旁白，并让场景时长匹配语音。"] },
  { en: ["Video delivery", "Preview, revise, and export a composed MP4 from the saved project."], zh: ["视频交付", "在已保存项目中预览、修改并导出合成后的 MP4。"] }
] as const;

export default async function BusinessPage() {
  const language = await getPublicLanguage();
  const text = (chinese: string, english: string) => publicText(language, chinese, english);
  const companyName = language === "zh-CN" ? publicBusiness.legalName : `${publicBusiness.legalNameEnglish} (${publicBusiness.legalName})`;
  const address = language === "zh-CN" ? `${publicBusiness.address}，中国` : `${publicBusiness.addressEnglish}, China`;

  return (
    <PublicPage language={language}>
      <main>
        <section className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>{text("AI 视频制作服务", "AI video creation service")}</p>
            <h1>{text("从一句需求到可编辑的视频项目", "From one brief to an editable video project")}</h1>
            <p>{text(`${publicBusiness.descriptionChinese} 客户以美元购买预付费 Credits，仅在成功完成生成服务后扣除。`, `${publicBusiness.description} Customers purchase prepaid credits in USD and spend them only on completed generation services.`)}</p>
            <div className={styles.actions}>
              <Link className={styles.primaryLink} href="/checkout">{text("购买 Credits", "Buy credits")} <ArrowRight size={18} /></Link>
              <Link className={styles.secondaryLink} href="#pricing">{text("查看价格", "View pricing")}</Link>
            </div>
          </div>
          <div className={styles.heroVisual} aria-label={text("Know Video 制作的视频示例", "Examples of videos created with Know Video")}>
            <Image alt={text("企业培训视频示例", "Business training video example")} height={720} priority src="/template-previews/safety.webp" width={1280} />
            <Image alt={text("产品发布视频示例", "Product launch video example")} height={720} src="/template-previews/launch.webp" width={1280} />
            <Image alt={text("教育视频示例", "Educational video example")} height={720} src="/template-previews/course.webp" width={1280} />
          </div>
        </section>

        <section className={styles.band} id="services">
          <div className={styles.sectionHead}>
            <h2>{text("客户购买的服务", "What customers purchase")}</h2>
            <p>{text("Know Video 是一项基于浏览器的软件服务，不销售实体商品。每个账户会保存项目、上传素材、生成媒体、对话记录和导出版本。", "Know Video is a browser-based software service. It does not sell physical goods. Each account stores projects, uploaded assets, generated media, conversation history, and export versions.")}</p>
          </div>
          <div className={styles.serviceGrid}>
            {services.map((service) => { const [title, description] = language === "zh-CN" ? service.zh : service.en; return <article className={styles.serviceItem} key={title}><strong>{title}</strong><p>{description}</p></article>; })}
          </div>
        </section>

        <section className={`${styles.band} ${styles.bandAlt}`} id="pricing">
          <div className={styles.sectionHead}>
            <h2>{text("Credits 套餐与价格", "Credit packs and prices")}</h2>
            <p>{text("全部为美元一次性付款。已购买 Credits 不会过期，失败的生成任务不会扣费。登录账户后，将通过 Xendit 托管的安全结账页完成付款。", "One-time payments in US dollars. Purchased credits do not expire. Failed generation tasks are not charged. Checkout is securely hosted by Xendit after account sign-in.")}</p>
          </div>
          <div className={styles.pricingGrid}>
            {publicCreditPacks.map((pack) => (
              <article className={`${styles.priceCard} ${pack.featured ? styles.priceCardFeatured : ""}`} key={pack.id}>
                <h3>{pack.name}</h3><div className={styles.price}>{pack.price}</div><span>{text("一次性付款", "one-time payment")}</span>
                <p>{text(pack.id === "starter" ? "适合初次体验完整视频工作流" : pack.id === "creator" ? "适合稳定创作的个人和小团队" : "适合有持续产量的制作团队", pack.description)}</p>
                <ul>
                  <li><Check size={16} /> {pack.deliveredCredits.toLocaleString("en-US")} Credits</li>
                  <li><Check size={16} /> {text(`约 ${pack.standardVideoEstimate} 条标准视频`, `About ${pack.standardVideoEstimate} standard videos`)}</li>
                  <li><ShieldCheck size={16} /> {text("失败输出不扣 Credits", "Failed outputs use no credits")}</li>
                </ul>
                <Link className={styles.primaryLink} href={`/checkout?pack=${pack.id}`}>{text("查看购买信息", "Review purchase")} <ArrowRight size={17} /></Link>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.band} id="business-details">
          <div className={styles.sectionHead}>
            <h2>{text("企业与联系方式", "Business and contact details")}</h2>
            <p>{text("以下主体负责运营 Know Video，并处理客户支持、账单问题、隐私请求和符合条件的退款。", "The following entity operates Know Video and is responsible for customer support, billing questions, privacy requests, and eligible refunds.")}</p>
          </div>
          <div className={styles.factsGrid}>
            <article className={styles.factsBlock}><h3>{text("注册运营主体", "Registered operator")}</h3><dl>
              <div className={styles.fact}><dt>{text("注册名称", "Registered name")}</dt><dd>{companyName}</dd></div>
              <div className={styles.fact}><dt>{text("企业地址", "Business address")}</dt><dd>{address}</dd></div>
              <div className={styles.fact}><dt>{text("产品", "Product")}</dt><dd>{publicBusiness.brandName} AI Video Studio</dd></div>
            </dl></article>
            <article className={styles.factsBlock}><h3>{text("客户支持", "Customer support")}</h3><dl>
              <div className={styles.fact}><dt>{text("邮箱", "Email")}</dt><dd><a href={`mailto:${publicBusiness.email}`}>{publicBusiness.email}</a></dd></div>
              <div className={styles.fact}><dt>{text("电话", "Telephone")}</dt><dd><a href={`tel:${publicBusiness.phoneHref}`}>{publicBusiness.phone}</a></dd></div>
              <div className={styles.fact}><dt>{text("服务时间", "Support hours")}</dt><dd>{text("周一至周五 09:00-18:00（中国标准时间）", "Monday-Friday, 09:00-18:00 China Standard Time")}</dd></div>
            </dl></article>
          </div>
        </section>
      </main>
    </PublicPage>
  );
}

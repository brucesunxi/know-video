import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { PublicLanguageSwitch } from "@/app/public-language-switch";
import { publicBusiness } from "@/lib/public-business";
import { publicText, type PublicLanguage } from "@/lib/public-language";
import styles from "@/app/public-site.module.css";

export function PublicHeader({ language }: { language: PublicLanguage }) {
  const text = (chinese: string, english: string) => publicText(language, chinese, english);
  return (
    <header className={styles.header}>
      <Link className={styles.brand} href="/business">
        <span className={styles.mark}>K</span>
        <span>{publicBusiness.brandName}</span>
      </Link>
      <nav className={styles.nav} aria-label={text("公开页面导航", "Public navigation")}>
        <Link href="/business#services">{text("服务", "Services")}</Link>
        <Link href="/business#pricing">{text("价格", "Pricing")}</Link>
        <Link href="/checkout">{text("结账", "Checkout")}</Link>
        <Link href="/contact">{text("联系", "Contact")}</Link>
        <PublicLanguageSwitch language={language} />
        <Link className={styles.primaryLink} href="/">{text("打开工作室", "Open studio")} <ArrowRight size={17} /></Link>
      </nav>
    </header>
  );
}

export function PublicFooter({ language }: { language: PublicLanguage }) {
  const text = (chinese: string, english: string) => publicText(language, chinese, english);
  const companyName = language === "zh-CN" ? publicBusiness.legalName : `${publicBusiness.legalNameEnglish} (${publicBusiness.legalName})`;
  const address = language === "zh-CN" ? `${publicBusiness.address}，中国` : `${publicBusiness.addressEnglish}, China`;
  return (
    <footer className={styles.footer}>
      <div>
        <strong>{publicBusiness.brandName}</strong>
        <p>
          {text("运营主体", "Operated by")} {companyName}<br />
          {address}<br />
          <a href={`mailto:${publicBusiness.email}`}>{publicBusiness.email}</a> · <a href={`tel:${publicBusiness.phoneHref}`}>{publicBusiness.phone}</a>
        </p>
      </div>
      <nav aria-label={text("法律与支持导航", "Legal navigation")}>
        <Link href="/terms">{text("服务条款", "Terms")}</Link>
        <Link href="/privacy">{text("隐私政策", "Privacy")}</Link>
        <Link href="/refund-policy">{text("退款政策", "Refund policy")}</Link>
        <Link href="/checkout">{text("结账", "Checkout")}</Link>
        <Link href="/contact">{text("联系我们", "Contact")}</Link>
      </nav>
    </footer>
  );
}

export function PublicPage({ children, language }: { children: ReactNode; language: PublicLanguage }) {
  return <div className={styles.page} lang={language === "zh-CN" ? "zh-CN" : "en"}><PublicHeader language={language} />{children}<PublicFooter language={language} /></div>;
}

export function PolicyPage({ eyebrow, title, intro, children, language }: {
  eyebrow: string;
  title: string;
  intro: string;
  children: ReactNode;
  language: PublicLanguage;
}) {
  return (
    <PublicPage language={language}>
      <main className={styles.policyMain}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1>{title}</h1>
        <p>{intro}</p>
        {children}
      </main>
    </PublicPage>
  );
}

export function PolicySection({ title, children }: { title: string; children: ReactNode }) {
  return <section className={styles.policySection}><h2>{title}</h2>{children}</section>;
}

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { publicBusiness } from "@/lib/public-business";
import styles from "@/app/public-site.module.css";

export function PublicHeader() {
  return (
    <header className={styles.header}>
      <Link className={styles.brand} href="/business">
        <span className={styles.mark}>K</span>
        <span>{publicBusiness.brandName}</span>
      </Link>
      <nav className={styles.nav} aria-label="Public navigation">
        <Link href="/business#services">Services</Link>
        <Link href="/business#pricing">Pricing</Link>
        <Link href="/checkout">Checkout</Link>
        <Link href="/contact">Contact</Link>
        <Link className={styles.primaryLink} href="/">Open studio <ArrowRight size={17} /></Link>
      </nav>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className={styles.footer}>
      <div>
        <strong>{publicBusiness.brandName}</strong>
        <p>
          Operated by {publicBusiness.legalName}<br />
          {publicBusiness.address}, {publicBusiness.country}<br />
          <a href={`mailto:${publicBusiness.email}`}>{publicBusiness.email}</a> · <a href={`tel:${publicBusiness.phoneHref}`}>{publicBusiness.phone}</a>
        </p>
      </div>
      <nav aria-label="Legal navigation">
        <Link href="/terms">Terms</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/refund-policy">Refund policy</Link>
        <Link href="/checkout">Checkout</Link>
        <Link href="/contact">Contact</Link>
      </nav>
    </footer>
  );
}

export function PublicPage({ children }: { children: ReactNode }) {
  return <div className={styles.page}><PublicHeader />{children}<PublicFooter /></div>;
}

export function PolicyPage({
  eyebrow,
  title,
  intro,
  children
}: {
  eyebrow: string;
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <PublicPage>
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

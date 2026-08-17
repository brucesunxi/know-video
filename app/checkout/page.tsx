import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, ShieldCheck } from "lucide-react";
import { PublicPage } from "@/app/public-site";
import styles from "@/app/public-site.module.css";
import { publicCreditPacks } from "@/lib/public-business";

export const metadata: Metadata = {
  title: "Checkout | Know Video",
  description: "Review Know Video credit-pack prices and the secure Xendit checkout process."
};

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<{ pack?: string }> }) {
  const requestedPack = (await searchParams).pack;

  return (
    <PublicPage>
      <main className={styles.policyMain}>
        <p className={styles.eyebrow}>Secure checkout</p>
        <h1>Choose a prepaid credit pack</h1>
        <p>Prices are shown in US dollars. Payment is a one-time purchase, not a subscription. A Know Video account is required so purchased credits can be delivered securely.</p>

        <div className={styles.checkoutGrid}>
          {publicCreditPacks.map((pack) => (
            <article className={`${styles.priceCard} ${pack.id === requestedPack || pack.featured ? styles.priceCardFeatured : ""}`} key={pack.id}>
              <h3>{pack.name}</h3>
              <div className={styles.price}>{pack.price}</div>
              <span>one-time payment</span>
              <p>{pack.description}</p>
              <ul>
                <li><Check size={16} /> {pack.deliveredCredits.toLocaleString("en-US")} credits</li>
                <li><Check size={16} /> About {pack.standardVideoEstimate} standard videos</li>
                <li><ShieldCheck size={16} /> Failed outputs use no credits</li>
              </ul>
              <Link className={styles.primaryLink} href={`/?purchase=${pack.id}`}>Sign in and continue <ArrowRight size={17} /></Link>
            </article>
          ))}
        </div>

        <section className={styles.policySection}>
          <h2>How payment works</h2>
          <div className={styles.checkoutFlow}>
            <div className={styles.checkoutStep}><span>1</span><strong>Sign in</strong><p>Create or access your account so credits have a secure owner.</p></div>
            <div className={styles.checkoutStep}><span>2</span><strong>Confirm pack</strong><p>Review the pack, exact USD price, and credit amount before paying.</p></div>
            <div className={styles.checkoutStep}><span>3</span><strong>Pay with Xendit</strong><p>Complete payment on the secure Xendit-hosted checkout page.</p></div>
            <div className={styles.checkoutStep}><span>4</span><strong>Receive credits</strong><p>Credits are added after payment confirmation and shown in your account.</p></div>
          </div>
        </section>

        <div className={styles.checkoutNotice}>
          By continuing, you agree to the <Link href="/terms">Terms of Service</Link>. Please review the <Link href="/refund-policy">Refund Policy</Link> and <Link href="/privacy">Privacy Policy</Link> before payment. Customer support is available through the <Link href="/contact">contact page</Link>.
        </div>
      </main>
    </PublicPage>
  );
}

import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check, ShieldCheck } from "lucide-react";
import { PublicPage } from "@/app/public-site";
import styles from "@/app/public-site.module.css";
import { publicBusiness, publicCreditPacks } from "@/lib/public-business";

export const metadata: Metadata = {
  title: "Know Video | AI Video Creation Service",
  description: publicBusiness.description
};

const services = [
  ["Script and storyboard", "Turn a written brief into a structured narrative and editable scene plan."],
  ["Scene visuals", "Generate subject-relevant images with consistent art direction and quality checks."],
  ["Narration and timing", "Create selectable Chinese or English narration and align scenes to speech."],
  ["Video delivery", "Preview, revise, and export a composed MP4 from the saved project."],
] as const;

export default function BusinessPage() {
  return (
    <PublicPage>
      <main>
        <section className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>AI video creation service</p>
            <h1>From one brief to an editable video project</h1>
            <p>{publicBusiness.description} Customers purchase prepaid credits in USD and spend them only on completed generation services.</p>
            <div className={styles.actions}>
              <Link className={styles.primaryLink} href="/checkout">Buy credits <ArrowRight size={18} /></Link>
              <Link className={styles.secondaryLink} href="#pricing">View pricing</Link>
            </div>
          </div>
          <div className={styles.heroVisual} aria-label="Examples of videos created with Know Video">
            <Image alt="Business training video example" height={720} priority src="/template-previews/safety.webp" width={1280} />
            <Image alt="Product launch video example" height={720} src="/template-previews/launch.webp" width={1280} />
            <Image alt="Educational video example" height={720} src="/template-previews/course.webp" width={1280} />
          </div>
        </section>

        <section className={styles.band} id="services">
          <div className={styles.sectionHead}>
            <h2>What customers purchase</h2>
            <p>Know Video is a browser-based software service. It does not sell physical goods. Each account stores projects, uploaded assets, generated media, conversation history, and export versions.</p>
          </div>
          <div className={styles.serviceGrid}>
            {services.map(([title, description]) => <article className={styles.serviceItem} key={title}><strong>{title}</strong><p>{description}</p></article>)}
          </div>
        </section>

        <section className={`${styles.band} ${styles.bandAlt}`} id="pricing">
          <div className={styles.sectionHead}>
            <h2>Credit packs and prices</h2>
            <p>One-time payments in US dollars. Purchased credits do not expire. Failed generation tasks are not charged. Checkout is securely hosted by Xendit after account sign-in.</p>
          </div>
          <div className={styles.pricingGrid}>
            {publicCreditPacks.map((pack) => (
              <article className={`${styles.priceCard} ${pack.featured ? styles.priceCardFeatured : ""}`} key={pack.id}>
                <h3>{pack.name}</h3>
                <div className={styles.price}>{pack.price}</div>
                <span>one-time payment</span>
                <p>{pack.description}</p>
                <ul>
                  <li><Check size={16} /> {pack.deliveredCredits.toLocaleString("en-US")} credits delivered</li>
                  <li><Check size={16} /> About {pack.standardVideoEstimate} standard videos</li>
                  <li><ShieldCheck size={16} /> Failed outputs use no credits</li>
                </ul>
                <Link className={styles.primaryLink} href={`/checkout?pack=${pack.id}`}>Review purchase <ArrowRight size={17} /></Link>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.band} id="business-details">
          <div className={styles.sectionHead}>
            <h2>Business and contact details</h2>
            <p>The following entity operates Know Video and is responsible for customer support, billing questions, privacy requests, and eligible refunds.</p>
          </div>
          <div className={styles.factsGrid}>
            <article className={styles.factsBlock}>
              <h3>Registered operator</h3>
              <dl>
                <div className={styles.fact}><dt>Registered name</dt><dd>{publicBusiness.legalName}</dd></div>
                <div className={styles.fact}><dt>Business address</dt><dd>{publicBusiness.address}, {publicBusiness.country}</dd></div>
                <div className={styles.fact}><dt>Product</dt><dd>{publicBusiness.brandName} AI Video Studio</dd></div>
              </dl>
            </article>
            <article className={styles.factsBlock}>
              <h3>Customer support</h3>
              <dl>
                <div className={styles.fact}><dt>Email</dt><dd><a href={`mailto:${publicBusiness.email}`}>{publicBusiness.email}</a></dd></div>
                <div className={styles.fact}><dt>Telephone</dt><dd><a href={`tel:${publicBusiness.phoneHref}`}>{publicBusiness.phone}</a></dd></div>
                <div className={styles.fact}><dt>Support hours</dt><dd>Monday-Friday, 09:00-18:00 China Standard Time</dd></div>
              </dl>
            </article>
          </div>
        </section>
      </main>
    </PublicPage>
  );
}

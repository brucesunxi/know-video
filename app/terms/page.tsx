import type { Metadata } from "next";
import { PolicyPage, PolicySection } from "@/app/public-site";
import { publicBusiness } from "@/lib/public-business";

export const metadata: Metadata = { title: "Terms of Service | Know Video" };

export default function TermsPage() {
  return (
    <PolicyPage eyebrow="Legal" title="Terms of Service" intro={`Effective August 17, 2026. These terms govern the use of Know Video, operated by ${publicBusiness.legalName}.`}>
      <PolicySection title="1. Service and eligibility"><p>Know Video provides AI-assisted script, storyboard, image, narration, motion, editing, and MP4 export tools. You must be legally able to enter a contract and provide accurate account and billing information.</p></PolicySection>
      <PolicySection title="2. Accounts and customer content"><p>You are responsible for account security and for content you upload or request. You retain rights in your original content. You grant us the limited permission needed to process that content and deliver the service.</p></PolicySection>
      <PolicySection title="3. Credits and payments"><p>Credit packs are one-time purchases in USD. Purchased credits do not expire. Credits have no cash value, cannot be transferred between users, and are consumed according to the usage shown before a paid operation. Payment checkout is provided by Xendit.</p></PolicySection>
      <PolicySection title="4. Acceptable use"><p>Do not use the service for unlawful, deceptive, infringing, abusive, sexually exploitative, violent, or privacy-invasive content. Do not attempt to bypass safeguards, interfere with the service, or access another user&apos;s projects.</p></PolicySection>
      <PolicySection title="5. AI-generated output"><p>AI output can contain errors and must be reviewed before publication. You are responsible for confirming accuracy, rights clearance, and suitability. We may improve or regenerate failed assets, but do not guarantee that every output will meet a specific creative preference.</p></PolicySection>
      <PolicySection title="6. Availability and termination"><p>We may maintain, change, suspend, or discontinue features when reasonably necessary. We may restrict accounts that violate these terms. Material changes will be published on this page.</p></PolicySection>
      <PolicySection title="7. Contact"><p>Questions may be sent to <a href={`mailto:${publicBusiness.email}`}>{publicBusiness.email}</a>. Business address: {publicBusiness.address}, {publicBusiness.country}.</p></PolicySection>
    </PolicyPage>
  );
}


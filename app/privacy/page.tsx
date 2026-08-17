import type { Metadata } from "next";
import { PolicyPage, PolicySection } from "@/app/public-site";
import { publicBusiness } from "@/lib/public-business";

export const metadata: Metadata = { title: "Privacy Policy | Know Video" };

export default function PrivacyPage() {
  return (
    <PolicyPage eyebrow="Legal" title="Privacy Policy" intro={`Effective August 17, 2026. ${publicBusiness.legalName} processes personal data to operate Know Video and support its customers.`}>
      <PolicySection title="Information we collect"><ul><li>Account information such as name, email address, and authentication identifiers.</li><li>Project prompts, uploaded files, generated assets, settings, and editing history.</li><li>Purchase records, credit balance events, device data, and service diagnostics.</li><li>Support communications and the information you choose to provide.</li></ul></PolicySection>
      <PolicySection title="How information is used"><p>We use information to authenticate users, create and store projects, generate requested media, process payments, prevent abuse, provide support, maintain reliability, and comply with legal obligations.</p></PolicySection>
      <PolicySection title="Service providers"><p>We use contracted infrastructure, AI, speech, storage, authentication, and payment providers only as needed to deliver the service. Xendit processes checkout and payment information under its own privacy terms. We do not sell personal data.</p></PolicySection>
      <PolicySection title="Retention and security"><p>Project and account information is retained while your account is active and as needed for legal, billing, fraud-prevention, and backup purposes. We use access controls, encryption in transit, and scoped storage permissions, but no internet service can promise absolute security.</p></PolicySection>
      <PolicySection title="Your choices"><p>You may request access, correction, export, or deletion of personal information, subject to applicable legal and billing retention requirements. Contact <a href={`mailto:${publicBusiness.email}`}>{publicBusiness.email}</a>.</p></PolicySection>
      <PolicySection title="Business contact"><p>{publicBusiness.legalName}<br />{publicBusiness.address}, {publicBusiness.country}</p></PolicySection>
    </PolicyPage>
  );
}


import type { Metadata } from "next";
import { PolicyPage, PolicySection } from "@/app/public-site";
import { publicBusiness } from "@/lib/public-business";

export const metadata: Metadata = { title: "Contact | Know Video" };

export default function ContactPage() {
  return (
    <PolicyPage eyebrow="Support" title="Contact Know Video" intro="Contact the operating company for product help, billing questions, privacy requests, or refund requests.">
      <PolicySection title="Business operator"><p><strong>{publicBusiness.legalName}</strong><br />{publicBusiness.address}<br />{publicBusiness.country}</p></PolicySection>
      <PolicySection title="Customer support"><p>Email: <a href={`mailto:${publicBusiness.email}`}>{publicBusiness.email}</a><br />Telephone: <a href={`tel:${publicBusiness.phoneHref}`}>{publicBusiness.phone}</a><br />Hours: Monday-Friday, 09:00-18:00 China Standard Time</p></PolicySection>
      <PolicySection title="Response times"><p>We normally acknowledge support and refund requests within 2 business days. Include your account email and payment reference for billing questions, but never send card details or passwords by email.</p></PolicySection>
    </PolicyPage>
  );
}

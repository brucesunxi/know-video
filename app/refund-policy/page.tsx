import type { Metadata } from "next";
import { PolicyPage, PolicySection } from "@/app/public-site";
import { publicBusiness } from "@/lib/public-business";

export const metadata: Metadata = { title: "Refund Policy | Know Video" };

export default function RefundPolicyPage() {
  return (
    <PolicyPage eyebrow="Billing" title="Refund Policy" intro="This policy explains when a Know Video credit purchase may be refunded and how failed generation tasks are handled.">
      <PolicySection title="Unused credit packs"><p>You may request a refund within 7 calendar days of purchase when none of the credits from that purchase have been consumed. Requests must include the account email, purchase date, amount, and payment reference.</p></PolicySection>
      <PolicySection title="Failed generation tasks"><p>A failed generation task does not settle its reserved credits. The credits are released back to the account automatically. This is not treated as a separate cash refund because the generation charge was never completed.</p></PolicySection>
      <PolicySection title="Duplicate or incorrect charges"><p>Verified duplicate charges or incorrect payment amounts are eligible for a full correction. Contact us promptly so we can compare the Xendit payment record with the Know Video credit ledger.</p></PolicySection>
      <PolicySection title="Delivered digital services"><p>Credits already consumed for completed scripts, images, narration, motion clips, or other delivered digital outputs are generally non-refundable, except where required by law or where a confirmed platform billing defect occurred.</p></PolicySection>
      <PolicySection title="How refunds are issued"><p>Approved refunds are returned to the original payment method through Xendit. Processing commonly takes 5-10 business days after approval, depending on the payment channel and issuing institution.</p></PolicySection>
      <PolicySection title="Request a refund"><p>Email <a href={`mailto:${publicBusiness.email}?subject=Refund%20request`}>{publicBusiness.email}</a>. We normally acknowledge requests within 2 business days.</p></PolicySection>
    </PolicyPage>
  );
}


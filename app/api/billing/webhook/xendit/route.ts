import { NextResponse } from "next/server";
import { expireXenditCreditPurchase, settleXenditCreditPurchase } from "@/lib/billing/accounts";
import { verifyXenditWebhookToken } from "@/lib/billing/xendit";

export const dynamic = "force-dynamic";

type PaymentSessionWebhook = {
  event?: string;
  data?: {
    payment_session_id?: string;
    reference_id?: string;
    payment_id?: string | null;
    session_type?: string;
    currency?: string;
    amount?: number;
    status?: string;
  };
};

export async function POST(request: Request) {
  if (!verifyXenditWebhookToken(request.headers.get("x-callback-token"))) {
    return NextResponse.json({ error: "Invalid webhook token." }, { status: 401 });
  }
  const payload = await request.json().catch(() => undefined) as PaymentSessionWebhook | undefined;
  const data = payload?.data;
  if (!payload?.event || !data?.reference_id || !data.payment_session_id) {
    return NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 });
  }

  if (payload.event === "payment_session.expired") {
    await expireXenditCreditPurchase(data.reference_id, data.payment_session_id);
    return NextResponse.json({ received: true });
  }
  if (payload.event !== "payment_session.completed") {
    return NextResponse.json({ received: true, ignored: true });
  }
  if (
    data.status !== "COMPLETED"
      || data.session_type !== "PAY"
      || data.currency !== "USD"
      || !data.payment_id
      || typeof data.amount !== "number"
  ) {
    return NextResponse.json({ error: "Completed payment details are invalid." }, { status: 400 });
  }

  const outcome = await settleXenditCreditPurchase({
    purchaseId: data.reference_id,
    checkoutId: data.payment_session_id,
    paymentId: data.payment_id,
    amountUsdCents: Math.round(data.amount * 100)
  });
  if (outcome === "mismatch") {
    return NextResponse.json({ error: "Payment does not match a pending purchase." }, { status: 409 });
  }
  return NextResponse.json({ received: true, credited: outcome === "credited" });
}

import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { appBaseUrl, authRequiredResponse, requireCurrentUser } from "@/lib/auth";
import {
  attachCheckoutToCreditPurchase,
  createPendingCreditPurchase,
  failCreditPurchase
} from "@/lib/billing/accounts";
import { creditPack } from "@/lib/billing/packs";
import { createXenditPaymentSession, xenditIsConfigured } from "@/lib/billing/xendit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let purchaseId: string | undefined;
  try {
    const user = await requireCurrentUser();
    if (!xenditIsConfigured()) {
      return NextResponse.json({ error: "Xendit payment is not configured." }, { status: 503 });
    }
    const body = await request.json().catch(() => ({})) as { packId?: string };
    const pack = creditPack(body.packId ?? "");
    if (!pack) return NextResponse.json({ error: "Invalid credit pack." }, { status: 400 });

    const baseUrl = await appBaseUrl();
    if (!baseUrl.startsWith("https://")) {
      return NextResponse.json({ error: "Xendit checkout requires an HTTPS app URL." }, { status: 503 });
    }
    purchaseId = crypto.randomUUID();
    await createPendingCreditPurchase({
      id: purchaseId,
      userId: user.id,
      packId: pack.id,
      credits: pack.credits,
      amountUsdCents: pack.priceUsdCents
    });
    const session = await createXenditPaymentSession({
      purchaseId,
      packId: pack.id,
      packName: pack.name,
      credits: pack.credits,
      amountUsdCents: pack.priceUsdCents,
      successUrl: `${baseUrl}/?billing=success&purchaseId=${purchaseId}`,
      cancelUrl: `${baseUrl}/?billing=cancelled&purchaseId=${purchaseId}`
    });
    await attachCheckoutToCreditPurchase(purchaseId, session.payment_session_id);
    return NextResponse.json({ checkoutUrl: session.payment_link_url, purchaseId });
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") return authRequiredResponse();
    if (purchaseId) await failCreditPurchase(purchaseId).catch(() => undefined);
    console.error("Xendit checkout creation failed", error);
    return NextResponse.json({ error: "Unable to start Xendit checkout." }, { status: 502 });
  }
}

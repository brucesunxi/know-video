import { timingSafeEqual } from "node:crypto";

const XENDIT_API_BASE_URL = "https://api.xendit.co";

export type XenditPaymentSession = {
  payment_session_id: string;
  payment_link_url: string | null;
  reference_id: string;
  status: string;
};

export function xenditIsConfigured() {
  return Boolean(
    process.env.XENDIT_SECRET_KEY
      && process.env.XENDIT_WEBHOOK_TOKEN
      && process.env.XENDIT_COUNTRY
  );
}

function xenditAuthorization() {
  const secretKey = process.env.XENDIT_SECRET_KEY;
  if (!secretKey) throw new Error("XENDIT_SECRET_KEY is not configured.");
  return `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`;
}

export async function createXenditPaymentSession(input: {
  purchaseId: string;
  packId: string;
  packName: string;
  credits: number;
  amountUsdCents: number;
  successUrl: string;
  cancelUrl: string;
}) {
  const country = process.env.XENDIT_COUNTRY;
  if (!country) throw new Error("XENDIT_COUNTRY is not configured.");

  const response = await fetch(`${XENDIT_API_BASE_URL}/sessions`, {
    method: "POST",
    headers: {
      authorization: xenditAuthorization(),
      "content-type": "application/json"
    },
    body: JSON.stringify({
      reference_id: input.purchaseId,
      session_type: "PAY",
      mode: "PAYMENT_LINK",
      amount: input.amountUsdCents / 100,
      currency: "USD",
      country,
      capture_method: "AUTOMATIC",
      locale: "en",
      description: `${input.packName} credit pack (${input.credits.toLocaleString("en-US")} credits)`,
      success_return_url: input.successUrl,
      cancel_return_url: input.cancelUrl,
      items: [{
        reference_id: input.packId,
        type: "DIGITAL_PRODUCT",
        name: `${input.packName} credits`,
        net_unit_amount: input.amountUsdCents / 100,
        quantity: 1,
        currency: "USD",
        category: "DIGITAL_CREDITS",
        description: `${input.credits.toLocaleString("en-US")} Know Video credits`
      }],
      metadata: {
        purchase_id: input.purchaseId,
        pack_id: input.packId
      }
    }),
    signal: AbortSignal.timeout(15_000)
  });
  const data = await response.json().catch(() => ({})) as XenditPaymentSession & {
    error_code?: string;
    message?: string;
  };
  if (!response.ok) {
    throw new Error(data.message || data.error_code || `Xendit session failed with HTTP ${response.status}.`);
  }
  if (!data.payment_session_id || !data.payment_link_url) {
    throw new Error("Xendit did not return a checkout URL.");
  }
  return data;
}

export function verifyXenditWebhookToken(receivedToken: string | null) {
  const expectedToken = process.env.XENDIT_WEBHOOK_TOKEN;
  if (!expectedToken || !receivedToken) return false;
  const expected = Buffer.from(expectedToken);
  const received = Buffer.from(receivedToken);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

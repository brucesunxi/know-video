import { NextResponse } from "next/server";
import { z } from "zod";
import { authRequiredResponse, requireCurrentUser } from "@/lib/auth";
import { estimateBilling } from "@/lib/billing/estimate";
import { billingResourceTypes } from "@/lib/billing/types";

const requestSchema = z.object({
  items: z.array(z.object({
    resourceType: z.enum(billingResourceTypes),
    quantity: z.number().positive().max(10_000)
  })).min(1).max(20)
});

export async function POST(request: Request) {
  try {
    await requireCurrentUser();
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") return authRequiredResponse();
    throw error;
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) {
    return NextResponse.json({ error: "计费估算请求格式无效。" }, { status: 400 });
  }

  const estimate = estimateBilling(parsed.data.items);
  return NextResponse.json({
    estimateId: crypto.randomUUID(),
    ...estimate,
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString()
  });
}

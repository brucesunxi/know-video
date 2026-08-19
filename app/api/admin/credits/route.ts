import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import { authRequiredResponse } from "@/lib/auth";
import {
  findAdminCreditTarget,
  grantAdminCredits,
  listRecentAdminCreditGrants
} from "@/lib/billing/admin-credits";

export const dynamic = "force-dynamic";

const grantSchema = z.object({
  identifier: z.string().trim().min(3).max(320),
  credits: z.number().int().min(1).max(1_000_000),
  reason: z.string().trim().max(200).optional(),
  requestId: z.string().uuid()
});

function adminError(error: unknown) {
  if (error instanceof Error && error.message === "AUTH_REQUIRED") return authRequiredResponse();
  if (error instanceof Error && error.message === "ADMIN_FORBIDDEN") {
    return NextResponse.json({ error: "无权访问管理后台。" }, { status: 403 });
  }
  return undefined;
}

export async function GET(request: Request) {
  try {
    await requireAdminUser();
    const identifier = new URL(request.url).searchParams.get("identifier")?.trim();
    const [target, recentGrants] = await Promise.all([
      identifier ? findAdminCreditTarget(identifier) : Promise.resolve(undefined),
      listRecentAdminCreditGrants()
    ]);
    return NextResponse.json({ target: target ?? null, recentGrants });
  } catch (error) {
    const response = adminError(error);
    if (response) return response;
    console.error("[admin-credits] Unable to load credit administration data:", error);
    return NextResponse.json({ error: "管理数据读取失败，请稍后重试。" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdminUser();
    const parsed = grantSchema.safeParse(await request.json().catch(() => undefined));
    if (!parsed.success) {
      return NextResponse.json({ error: "请检查用户、Credits 数量和备注。" }, { status: 400 });
    }
    const result = await grantAdminCredits({
      ...parsed.data,
      adminId: admin.id,
      adminEmail: admin.email
    });
    return NextResponse.json({ result, recentGrants: await listRecentAdminCreditGrants() });
  } catch (error) {
    const response = adminError(error);
    if (response) return response;
    if (error instanceof Error && error.message === "USER_NOT_FOUND") {
      return NextResponse.json({ error: "没有找到该用户。用户需要先登录 Know Video。" }, { status: 404 });
    }
    console.error("[admin-credits] Unable to grant credits:", error);
    return NextResponse.json({ error: "Credits 入账失败，余额未发生变化。" }, { status: 500 });
  }
}

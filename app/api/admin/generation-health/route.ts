import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/admin";
import { authRequiredResponse } from "@/lib/auth";
import { readGenerationHealthAudit } from "@/lib/generation-health";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdminUser();
    return NextResponse.json({ audit: await readGenerationHealthAudit() });
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") return authRequiredResponse();
    if (error instanceof Error && error.message === "ADMIN_FORBIDDEN") {
      return NextResponse.json({ error: "无权访问生成健康审计。" }, { status: 403 });
    }
    console.error("[generation-health] Unable to read production generation health:", error);
    return NextResponse.json({ error: "生成健康数据读取失败，请稍后重试。" }, { status: 500 });
  }
}

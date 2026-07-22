import { NextResponse } from "next/server";
import { authIsConfigured, getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    configured: authIsConfigured(),
    user: await getCurrentUser()
  });
}

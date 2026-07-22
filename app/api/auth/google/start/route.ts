import { NextResponse } from "next/server";
import { appBaseUrl, authIsConfigured, createOAuthState } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!authIsConfigured()) {
    return NextResponse.redirect(new URL("/?auth_error=missing_google_config", request.url));
  }

  const url = new URL(request.url);
  const redirectTo = url.searchParams.get("redirectTo") || "/";
  const state = await createOAuthState(redirectTo.startsWith("/") ? redirectTo : "/");
  const baseUrl = await appBaseUrl();
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID!);
  authUrl.searchParams.set("redirect_uri", `${baseUrl}/api/auth/google/callback`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("prompt", "select_account");

  return NextResponse.redirect(authUrl);
}

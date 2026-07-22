import { NextResponse } from "next/server";
import { appBaseUrl, consumeOAuthState, createSession, upsertGoogleUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

type GoogleTokenResponse = {
  access_token?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
};

type GoogleProfile = {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
};

function redirectWithError(requestUrl: string, error: string) {
  const url = new URL("/", requestUrl);
  url.searchParams.set("auth_error", error);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) return redirectWithError(request.url, oauthError);
  if (!code || !state) return redirectWithError(request.url, "missing_oauth_code");

  const redirectTo = await consumeOAuthState(state);
  if (!redirectTo) return redirectWithError(request.url, "invalid_oauth_state");

  try {
    const baseUrl = await appBaseUrl();
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: `${baseUrl}/api/auth/google/callback`,
        grant_type: "authorization_code"
      })
    });
    const tokenData = await tokenResponse.json() as GoogleTokenResponse;
    if (!tokenResponse.ok || !tokenData.access_token) {
      throw new Error(tokenData.error_description || tokenData.error || "Google token exchange failed.");
    }

    const profileResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { authorization: `Bearer ${tokenData.access_token}` }
    });
    const profile = await profileResponse.json() as GoogleProfile;
    if (!profileResponse.ok || !profile.sub || !profile.email || profile.email_verified === false) {
      throw new Error("Google account profile is invalid.");
    }

    const user = await upsertGoogleUser(profile);
    await createSession(user.id);
    return NextResponse.redirect(new URL(redirectTo, baseUrl));
  } catch (error) {
    if (error instanceof Error && error.message === "ONLY_GMAIL_ALLOWED") {
      return redirectWithError(request.url, "gmail_only");
    }
    console.error("[auth] Google login failed:", error);
    return redirectWithError(request.url, "google_login_failed");
  }
}

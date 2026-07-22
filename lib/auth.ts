import crypto from "node:crypto";
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { getSql, hasDatabaseUrl } from "@/lib/db";

export type CurrentUser = {
  id: string;
  email: string;
  name?: string;
  avatarUrl?: string;
};

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
};

export const SESSION_COOKIE_NAME = "know_video_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const OAUTH_STATE_TTL_SECONDS = 60 * 10;

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function toUser(row: UserRow): CurrentUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name ?? undefined,
    avatarUrl: row.avatar_url ?? undefined
  };
}

export function authIsConfigured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID
      && process.env.GOOGLE_CLIENT_SECRET
      && hasDatabaseUrl()
  );
}

export async function appBaseUrl() {
  const explicit = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (explicit) {
    const withProtocol = /^https?:\/\//i.test(explicit) ? explicit : `https://${explicit}`;
    return withProtocol.replace(/\/+$/, "");
  }
  const incomingHeaders = await headers();
  const host = incomingHeaders.get("x-forwarded-host") || incomingHeaders.get("host") || "localhost:3000";
  const protocol = incomingHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}

export async function getCurrentUser(): Promise<CurrentUser | undefined> {
  if (!hasDatabaseUrl()) return undefined;
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return undefined;

  const rows = await getSql()`
    select u.id, u.email, u.name, u.avatar_url
    from auth_sessions s
    join users u on u.id = s.user_id
    where s.token_hash = ${sha256(token)}
      and s.expires_at > now()
    limit 1
  ` as UserRow[];

  return rows[0] ? toUser(rows[0]) : undefined;
}

export async function requireCurrentUser() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("AUTH_REQUIRED");
  }
  return user;
}

export function authRequiredResponse() {
  return NextResponse.json({ error: "请先使用 Gmail 登录。" }, { status: 401 });
}

export async function createOAuthState(redirectTo = "/") {
  if (!hasDatabaseUrl()) throw new Error("DATABASE_URL is required for Google login.");
  const state = randomToken(24);
  const expires = new Date(Date.now() + OAUTH_STATE_TTL_SECONDS * 1000);
  await getSql()`
    insert into oauth_states (state_hash, redirect_to, expires_at)
    values (${sha256(state)}, ${redirectTo}, ${expires.toISOString()})
  `;
  return state;
}

export async function consumeOAuthState(state: string) {
  if (!hasDatabaseUrl()) return undefined;
  const rows = await getSql()`
    delete from oauth_states
    where state_hash = ${sha256(state)}
      and expires_at > now()
    returning redirect_to
  ` as Array<{ redirect_to: string }>;
  return rows[0]?.redirect_to;
}

export async function upsertGoogleUser(profile: {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}) {
  if (!profile.email.toLowerCase().endsWith("@gmail.com")) {
    throw new Error("ONLY_GMAIL_ALLOWED");
  }
  const rows = await getSql()`
    insert into users (email, name, avatar_url, provider, provider_subject)
    values (
      ${profile.email.toLowerCase()},
      ${profile.name ?? null},
      ${profile.picture ?? null},
      'google',
      ${profile.sub}
    )
    on conflict (provider, provider_subject)
    do update set
      email = excluded.email,
      name = excluded.name,
      avatar_url = excluded.avatar_url,
      updated_at = now()
    returning id, email, name, avatar_url
  ` as UserRow[];
  return toUser(rows[0]);
}

export async function createSession(userId: string) {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  await getSql()`
    insert into auth_sessions (user_id, token_hash, expires_at)
    values (${userId}, ${sha256(token)}, ${expires.toISOString()})
  `;
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires
  });
}

export async function destroySession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (token && hasDatabaseUrl()) {
    await getSql()`delete from auth_sessions where token_hash = ${sha256(token)}`;
  }
  cookieStore.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
}

export async function assertProjectOwner(projectId: string, userId: string) {
  if (!hasDatabaseUrl()) return;
  const rows = await getSql()`
    select id
    from projects
    where id = ${projectId}
      and user_id = ${userId}
    limit 1
  ` as Array<{ id: string }>;
  if (!rows[0]) throw new Error("PROJECT_NOT_FOUND");
}

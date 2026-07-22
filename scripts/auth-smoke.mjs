import fs from "node:fs";

const checks = [
  {
    file: "lib/auth.ts",
    includes: [
      "SESSION_COOKIE_NAME",
      "createOAuthState",
      "upsertGoogleUser",
      "endsWith(\"@gmail.com\")",
      "assertProjectOwner"
    ]
  },
  {
    file: "app/api/auth/google/start/route.ts",
    includes: ["accounts.google.com/o/oauth2/v2/auth", "openid email profile"]
  },
  {
    file: "app/api/auth/google/callback/route.ts",
    includes: ["oauth2.googleapis.com/token", "www.googleapis.com/oauth2/v3/userinfo", "createSession"]
  },
  {
    file: "app/page.tsx",
    includes: ["getCurrentUser", "LoginScreen", "getCurrentProjectSnapshot(currentUser.id)"]
  },
  {
    file: "lib/project-store.ts",
    includes: ["listProjects(userId", "where p.user_id =", "getCurrentProjectSnapshot(userId"]
  },
  {
    file: "lib/project-mutations.ts",
    includes: ["userId?: string", "insert into projects (id, user_id, title)", "p.user_id ="]
  },
  {
    file: "db/schema.sql",
    includes: ["create table if not exists users", "create table if not exists auth_sessions", "create table if not exists oauth_states"]
  }
];

for (const check of checks) {
  const source = fs.readFileSync(new URL(`../${check.file}`, import.meta.url), "utf8");
  for (const needle of check.includes) {
    if (!source.includes(needle)) {
      throw new Error(`${check.file} is missing required auth marker: ${needle}`);
    }
  }
}

console.log("Auth smoke checks passed.");

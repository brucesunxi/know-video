import { cookies } from "next/headers";

export type PublicLanguage = "en" | "zh-CN";

export async function getPublicLanguage(): Promise<PublicLanguage> {
  const value = (await cookies()).get("kv_public_language")?.value;
  return value === "zh-CN" ? "zh-CN" : "en";
}

export function publicText(language: PublicLanguage, chinese: string, english: string) {
  return language === "zh-CN" ? chinese : english;
}

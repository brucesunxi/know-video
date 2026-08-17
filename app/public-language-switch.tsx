"use client";

import { Globe2 } from "lucide-react";
import type { PublicLanguage } from "@/lib/public-language";
import styles from "@/app/public-site.module.css";

export function PublicLanguageSwitch({ language }: { language: PublicLanguage }) {
  const nextLanguage = language === "zh-CN" ? "en" : "zh-CN";
  const label = language === "zh-CN" ? "English" : "中文";

  function switchLanguage() {
    document.cookie = `kv_public_language=${nextLanguage}; path=/; max-age=31536000; samesite=lax`;
    window.location.reload();
  }

  return <button className={styles.languageSwitch} onClick={switchLanguage} type="button"><Globe2 size={17} />{label}</button>;
}

"use client";

import { Globe2 } from "lucide-react";
import type { PublicLanguage } from "@/lib/public-language";
import { persistUiLanguage } from "@/lib/ui-language-client";
import styles from "@/app/public-site.module.css";

export function PublicLanguageSwitch({ language }: { language: PublicLanguage }) {
  const nextLanguage = language === "zh-CN" ? "en" : "zh-CN";
  const label = language === "zh-CN" ? "English" : "中文";

  function switchLanguage() {
    persistUiLanguage(nextLanguage);
    window.location.reload();
  }

  return <button className={styles.languageSwitch} onClick={switchLanguage} type="button"><Globe2 size={17} />{label}</button>;
}

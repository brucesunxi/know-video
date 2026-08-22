export type UiLanguage = "zh-CN" | "en";

export const UI_LANGUAGE_STORAGE_KEY = "know-video:ui-language";
export const PUBLIC_LANGUAGE_COOKIE = "kv_public_language";

export function persistUiLanguage(language: UiLanguage) {
  window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, language);
  document.cookie = `${PUBLIC_LANGUAGE_COOKIE}=${language}; path=/; max-age=31536000; samesite=lax`;
  document.documentElement.lang = language;
}

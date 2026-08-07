"use client";

import { useEffect, useState } from "react";

type LoginScreenProps = {
  configured: boolean;
  error?: string;
};

const UI_LANGUAGE_STORAGE_KEY = "know-video:ui-language";
type LoginLanguage = "zh-CN" | "en";

const errorCopy: Record<string, [string, string]> = {
  missing_google_config: ["Google 登录还没有配置完成，请先在 Vercel 添加 OAuth 环境变量。", "Google sign-in is not configured. Add the OAuth environment variables in Vercel."],
  gmail_only: ["当前只允许使用 Gmail 邮箱登录，请换用 @gmail.com 账号。", "Only Gmail accounts are currently supported. Use an @gmail.com address."],
  invalid_oauth_state: ["登录状态已经过期，请重新点击 Google 登录。", "Your sign-in session expired. Start Google sign-in again."],
  missing_oauth_code: ["Google 没有返回登录授权码，请重试。", "Google did not return an authorization code. Please try again."],
  google_login_failed: ["Google 登录没有完成，请稍后重试。", "Google sign-in did not complete. Please try again later."],
  access_denied: ["你取消了 Google 授权。", "You cancelled Google authorization."]
};

export function LoginScreen({ configured, error }: LoginScreenProps) {
  const [language, setLanguage] = useState<LoginLanguage>("zh-CN");
  const text = (chinese: string, english: string) => language === "zh-CN" ? chinese : english;

  useEffect(() => {
    const saved = window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY);
    if (saved === "zh-CN" || saved === "en") setLanguage(saved);
  }, []);

  function changeLanguage(next: LoginLanguage) {
    setLanguage(next);
    window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, next);
  }

  return (
    <main className="kv-login-page">
      <button
        aria-label={text("切换到英文界面", "Switch to Chinese interface")}
        className="kv-ui-language-toggle kv-login-language-toggle"
        onClick={() => changeLanguage(language === "zh-CN" ? "en" : "zh-CN")}
        type="button"
      >
        {language === "zh-CN" ? "EN" : "中文"}
      </button>
      <section className="kv-login-panel">
        <div className="kv-login-logo">K</div>
        <span className="kv-eyebrow">{text("Know Video 智能视频工作室", "Know Video AI Studio")}</span>
        <h1>{text("登录后开始制作视频", "Sign in to start creating")}</h1>
        <p>{text("当前仅支持 Gmail 一键登录。你的项目、素材、对话记录和版本历史会保存在自己的账号下。", "Sign in with Gmail. Your projects, assets, conversations, and version history are saved to your account.")}</p>
        {error ? (
          <div className="kv-login-error" role="alert">
            {errorCopy[error]?.[language === "zh-CN" ? 0 : 1] ?? text("登录失败，请重新尝试。", "Sign-in failed. Please try again.")}
          </div>
        ) : null}
        <a
          aria-disabled={!configured}
          className={`kv-google-login${configured ? "" : " disabled"}`}
          href={configured ? "/api/auth/google/start" : "#"}
        >
          <span aria-hidden="true">G</span>
          {text("使用 Google 登录", "Continue with Google")}
        </a>
        {!configured ? (
          <small>{text("需要先配置 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET` 和 `NEXT_PUBLIC_APP_URL`。", "Configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `NEXT_PUBLIC_APP_URL` first.")}</small>
        ) : (
          <small>{text("只允许 @gmail.com 邮箱继续进入。", "Only @gmail.com addresses can continue.")}</small>
        )}
      </section>
    </main>
  );
}

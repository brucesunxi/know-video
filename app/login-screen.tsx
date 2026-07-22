type LoginScreenProps = {
  configured: boolean;
  error?: string;
};

const errorCopy: Record<string, string> = {
  missing_google_config: "Google 登录还没有配置完成，请先在 Vercel 添加 OAuth 环境变量。",
  gmail_only: "当前只允许使用 Gmail 邮箱登录，请换用 @gmail.com 账号。",
  invalid_oauth_state: "登录状态已经过期，请重新点击 Google 登录。",
  missing_oauth_code: "Google 没有返回登录授权码，请重试。",
  google_login_failed: "Google 登录没有完成，请稍后重试。",
  access_denied: "你取消了 Google 授权。"
};

export function LoginScreen({ configured, error }: LoginScreenProps) {
  return (
    <main className="kv-login-page">
      <section className="kv-login-panel">
        <div className="kv-login-logo">K</div>
        <span className="kv-eyebrow">Know Video 智能视频工作室</span>
        <h1>登录后开始制作视频</h1>
        <p>当前仅支持 Gmail 一键登录。你的项目、素材、对话记录和版本历史会保存在自己的账号下。</p>
        {error ? (
          <div className="kv-login-error" role="alert">
            {errorCopy[error] ?? "登录失败，请重新尝试。"}
          </div>
        ) : null}
        <a
          aria-disabled={!configured}
          className={`kv-google-login${configured ? "" : " disabled"}`}
          href={configured ? "/api/auth/google/start" : "#"}
        >
          <span aria-hidden="true">G</span>
          使用 Google 登录
        </a>
        {!configured ? (
          <small>需要先配置 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET` 和 `NEXT_PUBLIC_APP_URL`。</small>
        ) : (
          <small>只允许 @gmail.com 邮箱继续进入。</small>
        )}
      </section>
    </main>
  );
}

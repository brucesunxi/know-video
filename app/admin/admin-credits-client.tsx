"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, CheckCircle2, Coins, Loader2, Search, ShieldCheck, UserRound } from "lucide-react";
import type { CurrentUser } from "@/lib/auth";
import type { AdminCreditGrant, AdminCreditTarget } from "@/lib/billing/admin-credits";
import styles from "@/app/admin/admin.module.css";

type AdminResponse = {
  target?: AdminCreditTarget | null;
  recentGrants?: AdminCreditGrant[];
  result?: { credited: boolean; duplicate: boolean; account: AdminCreditTarget };
  error?: string;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function AdminCreditsClient({ admin }: { admin: CurrentUser }) {
  const [identifier, setIdentifier] = useState("");
  const [target, setTarget] = useState<AdminCreditTarget>();
  const [credits, setCredits] = useState("100");
  const [reason, setReason] = useState("");
  const [recentGrants, setRecentGrants] = useState<AdminCreditGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string }>();
  const NoticeIcon = notice?.tone === "error" ? AlertCircle : CheckCircle2;

  useEffect(() => {
    void fetch("/api/admin/credits", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as AdminResponse;
        if (!response.ok) throw new Error(data.error || "管理数据读取失败。");
        setRecentGrants(data.recentGrants ?? []);
      })
      .catch((error) => setNotice({ tone: "error", text: error instanceof Error ? error.message : "管理数据读取失败。" }))
      .finally(() => setLoading(false));
  }, []);

  async function searchUser(event: FormEvent) {
    event.preventDefault();
    if (!identifier.trim()) return;
    setLoading(true);
    setNotice(undefined);
    try {
      const response = await fetch(`/api/admin/credits?identifier=${encodeURIComponent(identifier.trim())}`, { cache: "no-store" });
      const data = await response.json() as AdminResponse;
      if (!response.ok) throw new Error(data.error || "用户查询失败。");
      if (!data.target) {
        setTarget(undefined);
        setNotice({ tone: "error", text: "没有找到该用户。用户需要先登录 Know Video。" });
      } else {
        setTarget(data.target);
        setIdentifier(data.target.email);
      }
      setRecentGrants(data.recentGrants ?? []);
    } catch (error) {
      setTarget(undefined);
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "用户查询失败。" });
    } finally {
      setLoading(false);
    }
  }

  async function submitGrant(event: FormEvent) {
    event.preventDefault();
    const amount = Number(credits);
    if (!target || !Number.isInteger(amount) || amount < 1 || amount > 1_000_000) {
      setNotice({ tone: "error", text: "请输入 1 到 1,000,000 之间的整数 Credits。" });
      return;
    }
    setSubmitting(true);
    setNotice(undefined);
    try {
      const response = await fetch("/api/admin/credits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          identifier: target.id,
          credits: amount,
          reason: reason.trim() || undefined,
          requestId: crypto.randomUUID()
        })
      });
      const data = await response.json() as AdminResponse;
      if (!response.ok || !data.result) throw new Error(data.error || "Credits 入账失败。");
      setTarget(data.result.account);
      setRecentGrants(data.recentGrants ?? []);
      setReason("");
      setNotice({ tone: "success", text: `已为 ${data.result.account.email} 增加 ${amount.toLocaleString("en-US")} Credits。` });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Credits 入账失败。" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <Link className={styles.back} href="/"><ArrowLeft size={17} /> 返回工作室</Link>
          <p>KNOW VIDEO ADMIN</p>
          <h1>Credits 管理</h1>
          <span>查询用户余额并进行人工额度调整，每次操作都会写入审计账本。</span>
        </div>
        <div className={styles.adminBadge}><ShieldCheck size={18} /><span><small>管理员</small>{admin.email}</span></div>
      </header>

      {notice ? <div className={`${styles.notice} ${styles[notice.tone]}`}><NoticeIcon size={18} />{notice.text}</div> : null}

      <section className={styles.workspace}>
        <div className={styles.panel}>
          <div className={styles.panelTitle}><UserRound size={20} /><div><h2>查找用户</h2><p>输入注册邮箱或用户 ID</p></div></div>
          <form className={styles.searchForm} onSubmit={searchUser}>
            <input aria-label="用户邮箱或 ID" onChange={(event) => setIdentifier(event.target.value)} placeholder="name@gmail.com" value={identifier} />
            <button disabled={loading || !identifier.trim()} type="submit">{loading ? <Loader2 className={styles.spin} size={18} /> : <Search size={18} />}查询</button>
          </form>
          {target ? (
            <div className={styles.userCard}>
              <div className={styles.avatar}>{target.email.slice(0, 1).toUpperCase()}</div>
              <div><strong>{target.name || "未设置名称"}</strong><span>{target.email}</span><small>{target.id}</small></div>
              <dl><div><dt>可用余额</dt><dd>{target.availableCredits.toLocaleString("en-US")}</dd></div><div><dt>冻结中</dt><dd>{target.reservedCredits.toLocaleString("en-US")}</dd></div><div><dt>累计消耗</dt><dd>{target.lifetimeConsumed.toLocaleString("en-US")}</dd></div></dl>
            </div>
          ) : <div className={styles.empty}>查询后将在这里显示用户和实时余额。</div>}
        </div>

        <div className={`${styles.panel} ${!target ? styles.disabledPanel : ""}`}>
          <div className={styles.panelTitle}><Coins size={20} /><div><h2>增加 Credits</h2><p>额度会立即进入该用户的可用余额</p></div></div>
          <form className={styles.grantForm} onSubmit={submitGrant}>
            <label><span>增加数量</span><div className={styles.amountInput}><input disabled={!target} inputMode="numeric" min="1" max="1000000" onChange={(event) => setCredits(event.target.value)} step="1" type="number" value={credits} /><em>Credits</em></div></label>
            <label><span>操作备注（可选）</span><textarea disabled={!target} maxLength={200} onChange={(event) => setReason(event.target.value)} placeholder="例如：客户补偿、测试额度、人工充值" rows={3} value={reason} /></label>
            <div className={styles.summary}><span>入账后余额</span><strong>{target ? (target.availableCredits + Math.max(0, Number(credits) || 0)).toLocaleString("en-US") : "-"}</strong></div>
            <button className={styles.primary} disabled={!target || submitting} type="submit">{submitting ? <Loader2 className={styles.spin} size={18} /> : <Coins size={18} />}{submitting ? "正在入账" : "确认增加 Credits"}</button>
          </form>
        </div>
      </section>

      <section className={styles.history}>
        <div className={styles.historyHead}><div><h2>最近人工入账</h2><p>仅显示管理员增加 Credits 的记录</p></div><span>{recentGrants.length} 条</span></div>
        {recentGrants.length > 0 ? <div className={styles.tableWrap}><table><thead><tr><th>用户</th><th>增加</th><th>入账后余额</th><th>备注</th><th>时间</th></tr></thead><tbody>{recentGrants.map((grant) => <tr key={grant.id}><td><strong>{grant.name || grant.email}</strong><small>{grant.email}</small></td><td className={styles.creditDelta}>+{grant.credits.toLocaleString("en-US")}</td><td>{grant.balanceAfter.toLocaleString("en-US")}</td><td>{grant.reason || "-"}</td><td>{formatDate(grant.createdAt)}</td></tr>)}</tbody></table></div> : <div className={styles.empty}>还没有人工 Credits 入账记录。</div>}
      </section>
    </main>
  );
}

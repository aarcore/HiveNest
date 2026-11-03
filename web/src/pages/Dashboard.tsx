import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type Alert, type Health, type Job, type Meta, type Worker } from "../api";

type Props = {
  health?: Health;
  meta?: Meta;
  workers: Worker[];
  jobs: Job[];
  alerts: Alert[];
  onMetaChange?: () => void;
};

export function Dashboard({ health, meta, workers, jobs, alerts, onMetaChange }: Props) {
  const online = workers.filter((w) => w.status === "online").length;
  const failed = jobs.filter((j) => j.status === "failed").length;
  const pending = jobs.filter((j) => j.status === "queued" || j.status === "dispatched").length;
  const [tunnelBusy, setTunnelBusy] = useState(false);
  const [tunnelMsg, setTunnelMsg] = useState("");

  const tunnel = meta?.tunnel;
  const tunnelOn = !!(tunnel?.enabled || tunnel?.running);

  async function toggleTunnel(enabled: boolean) {
    setTunnelBusy(true);
    setTunnelMsg(enabled ? "正在开通演示隧道…" : "正在关闭隧道…");
    try {
      const res = await api<{ error?: string; tunnel?: { public_url?: string; error?: string }; note?: string }>(
        "/v1/tunnel",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled }),
        }
      );
      if (res.error) {
        setTunnelMsg(res.error + (res.tunnel?.error ? `（${res.tunnel.error}）` : ""));
      } else if (enabled && res.tunnel?.public_url) {
        setTunnelMsg(`隧道已就绪：${res.tunnel.public_url}`);
      } else {
        setTunnelMsg(res.note || (enabled ? "已请求开启" : "已关闭"));
      }
      onMetaChange?.();
    } catch (e) {
      setTunnelMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setTunnelBusy(false);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>总览</h1>
          <p className="muted">蜂后健康、资产与近期任务一览</p>
        </div>
      </header>

      {meta?.worker_dial_loopback ? (
        <div className="callout warn">
          <strong>回连地址为 localhost</strong>
          <span>
            远程 SSH 装机将被拒绝。请设置 <code>HIVENEST_WORKER_DIAL_URL</code> /{" "}
            <code>HIVENEST_ADVERTISE_HOST</code>，选用下方局域网候选，或开启「本地演示隧道」。
          </span>
        </div>
      ) : null}

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">服务状态</div>
          <div className="stat-value ok">{health?.status || "—"}</div>
          <div className="muted small">Queen v{health?.version || meta?.version || "?"}</div>
        </div>
        <Link to="/workers" className="stat-card linkish">
          <div className="stat-label">在线工蜂</div>
          <div className="stat-value">{online}</div>
          <div className="muted small">共 {workers.length} 台登记</div>
        </Link>
        <Link to="/jobs" className="stat-card linkish">
          <div className="stat-label">进行中任务</div>
          <div className="stat-value">{pending}</div>
          <div className="muted small">失败 {failed} · 最近 {jobs.length} 条</div>
        </Link>
        <Link to="/alerts" className="stat-card linkish">
          <div className="stat-label">告警</div>
          <div className="stat-value">{alerts.length}</div>
          <div className="muted small">最近列表</div>
        </Link>
      </div>

      <div className="card">
        <h2>回调地址（工蜂回连）</h2>
        <dl className="kv">
          <div>
            <dt>推荐回调 / dial</dt>
            <dd>
              <code>{meta?.callback_url || meta?.worker_dial_url || "—"}</code>
            </dd>
          </div>
          <div>
            <dt>来源</dt>
            <dd>
              <code>{meta?.dial_source || "—"}</code>
            </dd>
          </div>
          <div>
            <dt>有效 Public URL</dt>
            <dd>
              <code>{meta?.public_url || "—"}</code>
            </dd>
          </div>
          <div>
            <dt>配置的 PUBLIC_URL</dt>
            <dd>
              <code>{meta?.configured_public_url || "—"}</code>
            </dd>
          </div>
          <div>
            <dt>引导令牌</dt>
            <dd>
              <code>{meta?.bootstrap_token_hint || "—"}</code>
            </dd>
          </div>
        </dl>
        {meta?.lan_candidates && meta.lan_candidates.length > 0 ? (
          <div style={{ marginTop: "0.75rem" }}>
            <div className="muted small" style={{ marginBottom: "0.35rem" }}>
              局域网候选（可复制到 SSH 装机）
            </div>
            <ul className="plain-list">
              {meta.lan_candidates.map((u) => (
                <li key={u}>
                  <code>{u}</code>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {meta?.note ? <p className="muted small">{meta.note}</p> : null}
      </div>

      <div className="card">
        <h2>本地演示隧道（可选）</h2>
        <p className="muted">
          默认关闭。开启后通过 cloudflared quick tunnel 把本机蜂后映到临时公网 URL，并自动作为工蜂回调地址。仅适合演示；生产请用显式{" "}
          <code>HIVENEST_PUBLIC_URL</code> 或云上蜂后。
        </p>
        <dl className="kv">
          <div>
            <dt>状态</dt>
            <dd>
              {tunnel?.running ? (
                <span className="badge ok">运行中</span>
              ) : tunnelOn ? (
                <span className="badge warn">开启中 / 异常</span>
              ) : (
                <span className="badge">已关闭</span>
              )}
              {tunnel?.bin_found === false ? <span className="muted small"> · 未找到 cloudflared</span> : null}
            </dd>
          </div>
          <div>
            <dt>公网 URL</dt>
            <dd>
              <code>{tunnel?.public_url || "—"}</code>
            </dd>
          </div>
          <div>
            <dt>二进制</dt>
            <dd>
              <code>{tunnel?.bin || "cloudflared"}</code>
            </dd>
          </div>
          {tunnel?.error ? (
            <div>
              <dt>错误</dt>
              <dd className="bad-text">{tunnel.error}</dd>
            </div>
          ) : null}
        </dl>
        <div className="row-actions" style={{ marginTop: "0.85rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button type="button" className="btn primary" disabled={tunnelBusy || tunnelOn} onClick={() => toggleTunnel(true)}>
            {tunnelBusy && !tunnelOn ? "开通中…" : "开启演示隧道"}
          </button>
          <button type="button" className="btn ghost" disabled={tunnelBusy || !tunnelOn} onClick={() => toggleTunnel(false)}>
            关闭隧道
          </button>
        </div>
        {tunnelMsg ? <p className="muted small" style={{ marginTop: "0.65rem" }}>{tunnelMsg}</p> : null}
        {tunnel?.bin_found === false ? (
          <p className="muted small">
            请在 Queen 运行环境安装{" "}
            <a href="https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/" target="_blank" rel="noreferrer">
              cloudflared
            </a>
            ，或设置 <code>HIVENEST_TUNNEL_BIN</code>。Docker 演示镜像已尝试内置。
          </p>
        ) : null}
      </div>
    </div>
  );
}

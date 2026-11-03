import { FormEvent, useEffect, useState } from "react";
import { api, isLoopbackDial, shortId, type Meta } from "../api";

type Props = {
  meta?: Meta;
  onStarted: (jobId: string) => void;
};

export function Enroll({ meta, onStarted }: Props) {
  const [host, setHost] = useState("");
  const [port, setPort] = useState(22);
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [key, setKey] = useState("");
  const [sudo, setSudo] = useState(false);
  const [workerId, setWorkerId] = useState("");
  const [region, setRegion] = useState("");
  const [country, setCountry] = useState("");
  const [dial, setDial] = useState("");
  const [touchedDial, setTouchedDial] = useState(false);
  const [msg, setMsg] = useState<{ ok?: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!touchedDial) {
      const prefer = meta?.callback_url || meta?.worker_dial_url || meta?.suggested_dial_url || "";
      if (prefer) setDial(prefer);
    }
  }, [meta?.callback_url, meta?.worker_dial_url, meta?.suggested_dial_url, touchedDial]);

  const loopback = isLoopbackDial(dial);

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    setMsg(null);
    if (!host.trim() || !user.trim()) {
      setMsg({ text: "host 与 user 必填" });
      return;
    }
    if (!password && !key.trim()) {
      setMsg({ text: "请提供 password 或 private_key" });
      return;
    }
    const d = dial.trim();
    if (!d) {
      setMsg({ text: "请填写工蜂回连地址" });
      return;
    }
    if (isLoopbackDial(d)) {
      setMsg({ text: "工蜂回连地址不能是 localhost/127.0.0.1（远程工蜂连不到蜂后）" });
      return;
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        host: host.trim(),
        port: port || 22,
        user: user.trim(),
        auth: {} as Record<string, string>,
        sudo,
        queen_ws_url: d,
        worker_dial_url: d,
      };
      if (password) (body.auth as Record<string, string>).password = password;
      if (key.trim()) (body.auth as Record<string, string>).private_key = key.trim();
      if (workerId.trim()) body.worker_id = workerId.trim();
      if (region.trim()) body.region = region.trim();
      if (country.trim()) body.country = country.trim();

      const job = await api<{ id: string; status: string; module: string }>("/v1/enroll/ssh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setPassword("");
      setKey("");
      setMsg({ ok: true, text: `装机任务已创建 ${shortId(job.id)} → ${job.status}，完成后将自动更新工蜂列表` });
      onStarted(job.id);
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>SSH 装机</h1>
          <p className="muted">Queen 经 SSH 推送工蜂并启用 systemd（目标需可达 host:22）</p>
        </div>
      </header>

      {loopback ? (
        <div className="callout warn">
          <strong>警告：回连地址疑似 localhost</strong>
          <span>
            远程工蜂会连自己的本机。请选用总览页的局域网候选、开启演示隧道，或设置{" "}
            <code>HIVENEST_WORKER_DIAL_URL</code> / <code>HIVENEST_ADVERTISE_HOST</code>。
          </span>
        </div>
      ) : null}

      <div className="card">
        <form className="form" onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="enrollDial">
              工蜂回连地址 <span className="req">*</span>
            </label>
            <input
              id="enrollDial"
              required
              value={dial}
              onChange={(e) => {
                setTouchedDial(true);
                setDial(e.target.value);
              }}
              placeholder="ws://YOUR_LAN_IP:8080/v1/worker/ws"
            />
            <p className="hint">
              勿填 127.0.0.1/localhost——那是工蜂本机。
              {meta?.dial_source ? <> 当前推荐来源：<code>{meta.dial_source}</code>。</> : null}
            </p>
            {meta?.lan_candidates && meta.lan_candidates.length > 0 ? (
              <p className="hint">
                候选：{" "}
                {meta.lan_candidates.slice(0, 3).map((u, i) => (
                  <button
                    key={u}
                    type="button"
                    className="btn ghost"
                    style={{ marginRight: 6, marginTop: 4, padding: "0.15rem 0.45rem", fontSize: "0.8rem" }}
                    onClick={() => {
                      setTouchedDial(true);
                      setDial(u);
                    }}
                  >
                    {u}
                  </button>
                ))}
              </p>
            ) : null}
          </div>

          <div className="grid-2">
            <div className="field">
              <label htmlFor="host">Host</label>
              <input id="host" required value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.10" />
            </div>
            <div className="field">
              <label htmlFor="port">Port</label>
              <input id="port" type="number" min={1} max={65535} value={port} onChange={(e) => setPort(Number(e.target.value) || 22)} />
            </div>
          </div>

          <div className="grid-2">
            <div className="field">
              <label htmlFor="user">User</label>
              <input id="user" required value={user} onChange={(e) => setUser(e.target.value)} placeholder="root 或可 sudo 用户" />
            </div>
            <div className="field">
              <label>权限</label>
              <label className="check">
                <input type="checkbox" checked={sudo} onChange={(e) => setSudo(e.target.checked)} /> 使用 sudo -n（需 NOPASSWD）
              </label>
            </div>
          </div>

          <div className="grid-2">
            <div className="field">
              <label htmlFor="password">Password（与私钥二选一）</label>
              <input id="password" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="key">Private key PEM</label>
              <textarea id="key" rows={3} value={key} onChange={(e) => setKey(e.target.value)} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" />
            </div>
          </div>

          <div className="grid-2">
            <div className="field">
              <label htmlFor="wid">Worker ID（可选）</label>
              <input id="wid" value={workerId} onChange={(e) => setWorkerId(e.target.value)} placeholder="留空则自动生成 UUID" />
            </div>
            <div className="grid-2">
              <div className="field">
                <label htmlFor="region">Region</label>
                <input id="region" value={region} onChange={(e) => setRegion(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="country">Country</label>
                <input id="country" value={country} onChange={(e) => setCountry(e.target.value)} />
              </div>
            </div>
          </div>

          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? "提交中…" : "开始 SSH 装机"}
          </button>
          {msg ? <div className={`form-msg ${msg.ok ? "ok" : "err"}`}>{msg.text}</div> : null}
        </form>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { api } from "../api";

type BootstrapResp = {
  public_url?: string;
  queen_ws_url?: string;
  callback_url?: string;
  dial_source?: string;
  lan_candidates?: string[];
  recommended?: { title?: string; commands?: string[] }[];
  one_liner?: string;
  offline?: string[];
  notes?: string[];
  [key: string]: unknown;
};

export function Bootstrap() {
  const [data, setData] = useState<BootstrapResp | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await api<BootstrapResp>("/v1/bootstrap/command");
        if (!cancelled) {
          setData(d);
          setErr("");
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>装机命令</h1>
          <p className="muted">由有效回调地址（PUBLIC_URL / 局域网 / 演示隧道）生成的 curl / 离线安装建议</p>
        </div>
        <button
          type="button"
          className="btn ghost"
          onClick={async () => {
            try {
              setData(await api<BootstrapResp>("/v1/bootstrap/command"));
              setErr("");
            } catch (e) {
              setErr(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          刷新
        </button>
      </header>

      {err ? <div className="callout warn">{err}</div> : null}

      {data ? (
        <>
          <div className="card">
            <h2>基址</h2>
            <dl className="kv">
              <div>
                <dt>Public URL</dt>
                <dd>
                  <code>{String(data.public_url || "—")}</code>
                </dd>
              </div>
              <div>
                <dt>Queen WS / 回调</dt>
                <dd>
                  <code>{String(data.callback_url || data.queen_ws_url || data.worker_ws || "—")}</code>
                </dd>
              </div>
              <div>
                <dt>来源</dt>
                <dd>
                  <code>{String(data.dial_source || "—")}</code>
                </dd>
              </div>
            </dl>
          </div>

          {(data.recommended || []).map((rec, i) => (
            <div className="card" key={i}>
              <h2>{rec.title || `方案 ${i + 1}`}</h2>
              <pre className="code-block">{(rec.commands || []).join("\n")}</pre>
            </div>
          ))}

          {data.one_liner ? (
            <div className="card">
              <h2>一键</h2>
              <pre className="code-block">{data.one_liner}</pre>
            </div>
          ) : null}

          {data.offline?.length ? (
            <div className="card">
              <h2>离线 / scp</h2>
              <pre className="code-block">{data.offline.join("\n")}</pre>
            </div>
          ) : null}
        </>
      ) : !err ? (
        <p className="muted">加载中…</p>
      ) : null}
    </div>
  );
}

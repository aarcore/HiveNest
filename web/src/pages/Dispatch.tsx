import { FormEvent, useState } from "react";
import { api, type Meta, type Worker } from "../api";

/** Compact job dispatch panel embedded on Workers page */
export function DispatchPanel({ workers, meta, onDone }: { workers: Worker[]; meta?: Meta; onDone: () => void }) {
  const online = workers.filter((w) => w.status === "online");
  const modules = [...(meta?.allowed_modules || ["host.info", "echo"])].sort();
  const [workerId, setWorkerId] = useState("");
  const [module, setModule] = useState("host.info");
  const [params, setParams] = useState("");
  const [msg, setMsg] = useState<{ ok?: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const effectiveWorker = workerId || online[0]?.id || "";

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    setMsg(null);
    if (!effectiveWorker) {
      setMsg({ text: "没有在线 Worker" });
      return;
    }
    let parsed: unknown = null;
    const raw = params.trim();
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        setMsg({ text: "Params 不是合法 JSON: " + (e instanceof Error ? e.message : String(e)) });
        return;
      }
    } else if (module === "echo") {
      parsed = { message: "hello from Hive Nest UI" };
    }
    setBusy(true);
    try {
      const job = await api<{ id: string; status: string }>("/v1/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worker_id: effectiveWorker, module, params: parsed }),
      });
      setMsg({ ok: true, text: `已下发 ${job.id} → ${job.status}` });
      onDone();
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>下发任务</h2>
      <form className="form" onSubmit={onSubmit}>
        <div className="grid-2">
          <div className="field">
            <label>Worker</label>
            <select value={effectiveWorker} onChange={(e) => setWorkerId(e.target.value)}>
              {!online.length ? <option value="">(无在线工蜂)</option> : null}
              {online.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.hostname || w.id} ({w.id.slice(0, 8)}…)
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>模块</label>
            <select value={module} onChange={(e) => setModule(e.target.value)}>
              {modules.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label>Params (JSON，可选)</label>
          <textarea rows={2} value={params} onChange={(e) => setParams(e.target.value)} placeholder='{"message":"hello"}' />
        </div>
        <button type="submit" className="btn primary" disabled={busy}>
          Enqueue
        </button>
        {msg ? <div className={`form-msg ${msg.ok ? "ok" : "err"}`}>{msg.text}</div> : null}
      </form>
    </div>
  );
}

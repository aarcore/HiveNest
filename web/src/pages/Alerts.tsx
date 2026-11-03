import { useState } from "react";
import { Badge } from "../components/Badge";
import { Modal } from "../components/Modal";
import { formatDetail, shortId, type Alert } from "../api";

export function Alerts({ alerts }: { alerts: Alert[] }) {
  const [open, setOpen] = useState<{ title: string; meta: string; body: string } | null>(null);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>安全告警</h1>
          <p className="muted">工蜂 Guard 上报的快照与异常</p>
        </div>
      </header>
      <div className="card">
        {!alerts.length ? (
          <p className="muted">
            暂无告警。工蜂会周期性上报 <code>guard.snapshot</code>。
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>Worker</th>
                  <th>类型</th>
                  <th>级别</th>
                  <th>详情</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((a, i) => (
                  <tr key={a.id || i}>
                    <td className="mono">{a.created_at ? new Date(a.created_at).toLocaleString() : "-"}</td>
                    <td className="mono">{shortId(a.worker_id)}</td>
                    <td>{a.kind || "-"}</td>
                    <td>
                      <Badge status={a.severity || "info"} />
                    </td>
                    <td>
                      {a.payload != null ? (
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() =>
                            setOpen({
                              title: "告警详情",
                              meta: `${a.kind || "-"} · ${a.severity || "info"} · worker ${a.worker_id || "-"}`,
                              body: formatDetail(a.payload),
                            })
                          }
                        >
                          进度
                        </button>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Modal open={!!open} title={open?.title || "进度"} meta={open?.meta} body={open?.body || ""} onClose={() => setOpen(null)} />
    </div>
  );
}

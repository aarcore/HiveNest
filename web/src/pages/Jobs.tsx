import { useMemo, useState } from "react";
import { Badge } from "../components/Badge";
import { Modal } from "../components/Modal";
import { formatDetail, shortId, type Job } from "../api";

export function Jobs({ jobs }: { jobs: Job[] }) {
  const [open, setOpen] = useState<{ title: string; meta: string; body: string } | null>(null);

  const rows = useMemo(() => jobs, [jobs]);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>任务 Jobs</h1>
          <p className="muted">下发结果与 SSH 装机进度；点击「进度」查看详情</p>
        </div>
      </header>
      <div className="card">
        {!rows.length ? (
          <p className="muted">暂无任务。</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Worker</th>
                  <th>模块</th>
                  <th>状态</th>
                  <th>输出</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((j) => {
                  const when = j.finished_at || j.updated_at || j.created_at;
                  const body = j.output ?? j.error ?? null;
                  const has = body != null && body !== "";
                  return (
                    <tr key={j.id}>
                      <td>
                        <div className="mono">{shortId(j.id)}</div>
                        <div className="muted small">{when ? new Date(when).toLocaleString() : ""}</div>
                      </td>
                      <td className="mono">{shortId(j.worker_id)}</td>
                      <td>{j.module}</td>
                      <td>
                        <Badge status={j.status} />
                      </td>
                      <td>
                        {has ? (
                          <button
                            type="button"
                            className="btn sm"
                            onClick={() =>
                              setOpen({
                                title: j.module === "enroll.ssh" ? "装机进度" : "任务输出",
                                meta: `Job ${j.id} · ${j.module} · ${j.status}` + (j.worker_id ? ` · worker ${j.worker_id}` : ""),
                                body: formatDetail(body),
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
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Modal open={!!open} title={open?.title || "进度"} meta={open?.meta} body={open?.body || ""} onClose={() => setOpen(null)} />
    </div>
  );
}

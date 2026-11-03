import { Badge } from "../components/Badge";
import type { Worker } from "../api";

export function Workers({ workers }: { workers: Worker[] }) {
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>工蜂 Workers</h1>
          <p className="muted">已登记资产；在线状态随心跳自动刷新</p>
        </div>
      </header>
      <div className="card">
        {!workers.length ? (
          <p className="muted">还没有工蜂。确认 Worker 的 <code>HIVENEST_BOOTSTRAP_TOKEN</code> 与蜂后一致，且回连地址可达。</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>主机</th>
                  <th>状态</th>
                  <th>区域</th>
                  <th>系统</th>
                  <th>版本</th>
                  <th>最近心跳</th>
                </tr>
              </thead>
              <tbody>
                {workers.map((w) => (
                  <tr key={w.id}>
                    <td>
                      <div className="mono">{w.hostname || "-"}</div>
                      <div className="muted small mono">{w.id}</div>
                    </td>
                    <td>
                      <Badge status={w.status} />
                    </td>
                    <td>
                      {w.region || "-"} / {w.country || "-"}
                    </td>
                    <td>
                      {w.os || ""}/{w.arch || ""}
                    </td>
                    <td className="mono">{w.version || "-"}</td>
                    <td className="mono">{w.last_seen_at ? new Date(w.last_seen_at).toLocaleString() : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

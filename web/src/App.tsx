import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { api, type Alert, type Health, type Job, type Meta, type Worker } from "./api";
import { Shell } from "./layout/Shell";
import { Alerts } from "./pages/Alerts";
import { Bootstrap } from "./pages/Bootstrap";
import { Dashboard } from "./pages/Dashboard";
import { DispatchPanel } from "./pages/Dispatch";
import { Enroll } from "./pages/Enroll";
import { Jobs } from "./pages/Jobs";
import { Workers } from "./pages/Workers";

export default function App() {
  const [health, setHealth] = useState<Health>();
  const [meta, setMeta] = useState<Meta>();
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const pendingEnroll = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    try {
      const [h, m, w, j, a] = await Promise.all([
        api<Health>("/healthz"),
        api<Meta>("/v1/meta"),
        api<{ workers: Worker[] }>("/v1/workers"),
        api<{ jobs: Job[] }>("/v1/jobs?limit=30"),
        api<{ alerts: Alert[] }>("/v1/alerts?limit=20"),
      ]);
      setHealth(h);
      setMeta(m);
      setWorkers(w.workers || []);
      setJobs(j.jobs || []);
      setAlerts(a.alerts || []);
      for (const job of j.jobs || []) {
        if (job.module === "enroll.ssh" && (job.status === "queued" || job.status === "dispatched")) {
          pendingEnroll.current.add(job.id);
        }
      }
    } catch {
      /* keep last good snapshot */
    }
  }, []);

  const refreshWorkers = useCallback(async () => {
    try {
      const [h, w] = await Promise.all([api<Health>("/healthz"), api<{ workers: Worker[] }>("/v1/workers")]);
      setHealth(h);
      setWorkers(w.workers || []);
    } catch {
      /* ignore */
    }
  }, []);

  const watchEnroll = useCallback(async () => {
    if (!pendingEnroll.current.size) return;
    for (const id of [...pendingEnroll.current]) {
      try {
        const job = await api<Job>("/v1/jobs/" + encodeURIComponent(id));
        if (job.status === "succeeded" || job.status === "failed") {
          pendingEnroll.current.delete(id);
          await refresh();
          if (job.status === "succeeded") {
            await refreshWorkers();
            setTimeout(refreshWorkers, 1500);
            setTimeout(refreshWorkers, 4000);
            setTimeout(refreshWorkers, 8000);
          }
        }
      } catch {
        /* keep watching */
      }
    }
  }, [refresh, refreshWorkers]);

  useEffect(() => {
    refresh();
    const a = setInterval(refresh, 2000);
    const b = setInterval(watchEnroll, 1000);
    const c = setInterval(refreshWorkers, 3000);
    return () => {
      clearInterval(a);
      clearInterval(b);
      clearInterval(c);
    };
  }, [refresh, watchEnroll, refreshWorkers]);

  return (
    <Routes>
      <Route element={<Shell version={health?.version || meta?.version} online={health?.workers_online} />}>
        <Route index element={<Dashboard health={health} meta={meta} workers={workers} jobs={jobs} alerts={alerts} onMetaChange={refresh} />} />
        <Route
          path="workers"
          element={
            <>
              <Workers workers={workers} />
              <div className="page" style={{ paddingTop: 0 }}>
                <DispatchPanel workers={workers} meta={meta} onDone={refresh} />
              </div>
            </>
          }
        />
        <Route path="jobs" element={<Jobs jobs={jobs} />} />
        <Route path="alerts" element={<Alerts alerts={alerts} />} />
        <Route
          path="enroll"
          element={
            <Enroll
              meta={meta}
              onStarted={(id) => {
                pendingEnroll.current.add(id);
                refresh();
              }}
            />
          }
        />
        <Route path="bootstrap" element={<Bootstrap />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

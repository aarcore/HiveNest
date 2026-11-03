export function Badge({ status }: { status?: string }) {
  const cls = String(status || "").toLowerCase();
  return <span className={`badge ${cls}`}>{status || "-"}</span>;
}

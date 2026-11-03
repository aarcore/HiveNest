export type Worker = {
  id: string;
  hostname?: string;
  status: string;
  region?: string;
  country?: string;
  os?: string;
  arch?: string;
  version?: string;
  last_seen_at?: string;
};

export type Job = {
  id: string;
  worker_id?: string;
  module: string;
  status: string;
  params?: unknown;
  output?: unknown;
  error?: string;
  created_at?: string;
  updated_at?: string;
  finished_at?: string;
  ok?: boolean;
};

export type Alert = {
  id?: string;
  worker_id?: string;
  kind?: string;
  severity?: string;
  payload?: unknown;
  created_at?: string;
};

export type TunnelStatus = {
  enabled?: boolean;
  running?: boolean;
  provider?: string;
  public_url?: string;
  local_url?: string;
  bin?: string;
  bin_found?: boolean;
  error?: string;
  started_at?: string;
  note?: string;
};

export type Meta = {
  version?: string;
  bootstrap_token_hint?: string;
  public_url?: string;
  configured_public_url?: string;
  configured_dial_url?: string;
  worker_dial_url?: string;
  callback_url?: string;
  worker_dial_loopback?: boolean;
  dial_source?: string;
  lan_candidates?: string[];
  suggested_public_url?: string;
  suggested_dial_url?: string;
  advertise_host?: string;
  tunnel?: TunnelStatus;
  tunnel_api?: string;
  allowed_modules?: string[];
  note?: string;
};

export type Health = {
  status?: string;
  version?: string;
  workers_online?: number;
};

async function parse(r: Response) {
  const text = await r.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!r.ok) {
    const err =
      data && typeof data === "object" && data !== null && "error" in data
        ? String((data as { error: string }).error)
        : text || r.statusText;
    throw new Error(err);
  }
  return data;
}

export async function api<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(path, opts);
  return (await parse(r)) as T;
}

export function isLoopbackDial(u: string) {
  const s = String(u || "").toLowerCase();
  return s.includes("://127.0.0.1") || s.includes("://localhost") || s.includes("://[::1]");
}

export function formatDetail(raw: unknown): string {
  if (raw == null || raw === "") return "(无内容)";
  if (typeof raw === "string") {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  }
  if (typeof raw === "object" && raw !== null) {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.log)) {
      const lines: string[] = [];
      if (o.host) lines.push(`主机: ${o.host}:${(o.port as number) || 22}  用户: ${(o.user as string) || "-"}`);
      if (o.worker_id) lines.push(`Worker ID: ${o.worker_id}`);
      if (o.arch) lines.push(`架构: ${o.arch}`);
      if (o.region || o.country) lines.push(`区域: ${(o.region as string) || "-"} / ${(o.country as string) || "-"}`);
      if (lines.length) lines.push("");
      lines.push("—— 进度日志 ——");
      for (const line of o.log) lines.push(String(line));
      return lines.join("\n");
    }
    try {
      return JSON.stringify(raw, null, 2);
    } catch {
      return String(raw);
    }
  }
  return String(raw);
}

export function shortId(id?: string) {
  if (!id) return "-";
  return id.length > 8 ? id.slice(0, 8) + "…" : id;
}

/** Outbound HTTP: Tauri uses Rust client (no WebView CORS/TLS quirks); browser uses fetch. */

function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as unknown as { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown }
  return !!(w.__TAURI_INTERNALS__ || w.__TAURI__)
}

export async function netFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  if (isTauriRuntime()) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
    return tauriFetch(input, init)
  }
  return globalThis.fetch(input, init)
}

/** Desktop window chrome helpers (Tauri). Safe no-ops in browser. */

function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as unknown as { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown }
  return !!(w.__TAURI_INTERNALS__ || w.__TAURI__)
}

async function currentWindow() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  return getCurrentWindow()
}

/** Toggle zoom/maximize so the window fills the monitor work area (or restore). */
export async function toggleFillScreen(): Promise<void> {
  if (!isTauriRuntime()) return
  try {
    const win = await currentWindow()
    await win.toggleMaximize()
  } catch (err) {
    console.warn('[hivenest] toggleFillScreen failed', err)
  }
}

/** Begin a native window drag (call after the pointer has moved). */
export async function startWindowDrag(): Promise<void> {
  if (!isTauriRuntime()) return
  try {
    const win = await currentWindow()
    await win.startDragging()
  } catch (err) {
    console.warn('[hivenest] startWindowDrag failed', err)
  }
}

export { isTauriRuntime }

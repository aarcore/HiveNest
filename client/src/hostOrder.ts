const STORAGE_KEY = 'hivenest_host_order_v1'

export function loadHostOrder(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string' && x.length > 0)
  } catch {
    return []
  }
}

export function saveHostOrder(ids: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  } catch {
    /* ignore quota */
  }
}

/** Keep saved order for known ids; append any new ids; drop removed. */
export function mergeHostOrder(saved: string[], currentIds: string[]): string[] {
  const current = new Set(currentIds)
  const ordered = saved.filter((id) => current.has(id))
  const seen = new Set(ordered)
  for (const id of currentIds) {
    if (!seen.has(id)) {
      ordered.push(id)
      seen.add(id)
    }
  }
  return ordered
}

export function orderHosts<T extends { id: string }>(hosts: T[], order: string[]): T[] {
  const map = new Map(hosts.map((h) => [h.id, h]))
  const ids = mergeHostOrder(order, hosts.map((h) => h.id))
  const out: T[] = []
  for (const id of ids) {
    const h = map.get(id)
    if (h) out.push(h)
  }
  return out
}

/** Move fromId to the position of toId (insert before toId). */
export function moveIdBefore(order: string[], fromId: string, toId: string): string[] {
  if (fromId === toId) return order.slice()
  const next = order.filter((id) => id !== fromId)
  const idx = next.indexOf(toId)
  if (idx < 0) {
    next.push(fromId)
    return next
  }
  next.splice(idx, 0, fromId)
  return next
}

/** Move fromId before or after toId. */
export function moveIdTo(
  order: string[],
  fromId: string,
  toId: string,
  place: 'before' | 'after',
): string[] {
  if (fromId === toId) return order.slice()
  const next = order.filter((id) => id !== fromId)
  let idx = next.indexOf(toId)
  if (idx < 0) {
    next.push(fromId)
    return next
  }
  if (place === 'after') idx += 1
  next.splice(idx, 0, fromId)
  return next
}

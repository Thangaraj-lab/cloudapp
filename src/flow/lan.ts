// Building the address a phone opens. A phone can never reach "localhost": that is the phone itself.

export const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']
export const isLocalHost = (hostname: string) => LOCAL_HOSTS.includes(hostname.toLowerCase())

export interface Where { hostname: string; origin: string; port: string; pathname?: string }

/** "192.168.1.20" or "192.168.1.20:5173" or "http://192.168.1.20:5173/" → "http://192.168.1.20:5173". */
export function normalizeManual(input: string, port: string): string | null {
  const t = input.trim().replace(/\/+$/, '')
  if (!t) return null
  const withProto = /^https?:\/\//i.test(t) ? t : `http://${t}`
  try {
    const u = new URL(withProto)
    if (isLocalHost(u.hostname)) return null
    return `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : port ? `:${port}` : ''}`
  } catch {
    return null
  }
}

/**
 * The base URL for the phone (no hash). Real host → this origin. Localhost → the chosen
 * LAN URL from /__lan, else the manual laptop IP. Never returns a localhost address.
 */
export function phoneBaseUrl(where: Where, lanUrls: string[], choice?: string | null, manual?: string | null): string | null {
  const path = (where.pathname ?? '/').replace(/index\.html$/, '')
  if (!isLocalHost(where.hostname)) return where.origin + path
  const picked = choice && lanUrls.includes(choice) ? choice : lanUrls[0]
  const base = picked ?? (manual ? normalizeManual(manual, where.port) : null)
  return base ? base.replace(/\/+$/, '') + path : null
}

/** Full phone link for a hash route, e.g. phoneLink(…, '/m') → "http://192.168.1.20:5173/#/m". */
export function phoneLink(base: string | null, route = '/m') {
  return base ? `${base}#${route.startsWith('/') ? route : '/' + route}` : null
}

export const isInsecureLan = (url: string | null) => !!url && url.startsWith('http://') && !isLocalHost(new URL(url).hostname)

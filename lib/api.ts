import { MONITOR_KEY, SITE_URL } from './config';

/** Aufruf der Schnittstellen des Update-Monitor-Plugins. */
export async function monitorApi<T = any>(path: string, init: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T> {
  if (!MONITOR_KEY) throw new Error('Secret MONITOR_KEY fehlt.');
  const res = await fetch(`${SITE_URL}/wp-json/update-monitor/v1${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'X-Monitor-Key': MONITOR_KEY,
      'Content-Type': 'application/json',
      'X-Update-Monitor': '1',
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Plugin-Schnittstelle ${path}: HTTP ${res.status} ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Plugin-Schnittstelle ${path}: keine gültige Antwort (${text.slice(0, 200)})`);
  }
}

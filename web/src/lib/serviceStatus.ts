import { useEffect, useSyncExternalStore } from 'react';
import { config } from '../config';

// Whether the guard service looks down: after a failed API call, or while /health is not ok.
// Clears on the next success of the same kind. Never down in mock mode.
// Two separate signals, so a working /rounds call can't hide a /health that says the queue is stuck.
let apiDown = false;
let healthDown = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** From every API call: a network error or 5xx is down, anything else is up. */
export function reportService(ok: boolean) {
  if (config.mock || apiDown === !ok) return;
  apiDown = !ok;
  notify();
}

function reportHealth(ok: boolean) {
  if (healthDown === !ok) return;
  healthDown = !ok;
  notify();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const HEALTH_MS = 30_000;

async function checkHealth() {
  try {
    const res = await fetch(`${config.apiBase}/health`, { headers: { Accept: 'application/json' } });
    const body = (await res.json().catch(() => null)) as { ok?: unknown } | null;
    reportHealth(res.ok && body?.ok === true);
  } catch {
    reportHealth(false);
  }
}

/** True while the service looks down. Polls /health every 30 s while the tab is visible. */
export function useServiceDown(): boolean {
  useEffect(() => {
    if (config.mock) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      checkHealth();
      timer = setInterval(checkHealth, HEALTH_MS);
    };
    const onVisibility = () => {
      clearInterval(timer);
      if (!document.hidden) start();
    };
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
  return useSyncExternalStore(subscribe, () => apiDown || healthDown);
}

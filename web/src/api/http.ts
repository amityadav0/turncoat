import { config } from '../config';
import { copy } from '../content/copy';
import * as N from './normalize';
import { reportService } from '../lib/serviceStatus';
import type { Api, Attempt, Round } from './types';

async function call(path: string, init?: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${config.apiBase}${path}`, {
      ...init,
      headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
    });
  } catch (e) {
    reportService(false);
    throw e;
  }
  // A 4xx (bad id, rate limit) is an answer; only a 5xx means the service is in trouble.
  reportService(res.status < 500);
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { error?: unknown; retryAfterSeconds?: unknown };
      if (res.status === 429 && typeof body.retryAfterSeconds === 'number') detail = copy.common.tooMany(Math.ceil(body.retryAfterSeconds));
      else if (typeof body.error === 'string') detail = body.error.slice(0, 160);
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, detail || copy.common.serviceStatus(res.status));
  }
  return res.json();
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const list = (v: unknown, key: string): unknown[] => {
  const x = v && typeof v === 'object' ? (v as Record<string, unknown>)[key] : undefined;
  return Array.isArray(x) ? x : [];
};

export const httpApi: Api = {
  async currentRound() {
    const v = (await call('/rounds/current')) as { round?: unknown };
    return v?.round ? N.round(v.round) : null;
  },
  async liveRounds() {
    return list(await call('/rounds/live'), 'rounds').map(N.round).filter((r): r is Round => r !== null);
  },
  async rounds() {
    return list(await call('/rounds'), 'rounds').map(N.round).filter((r): r is Round => r !== null);
  },
  async round(id) {
    return N.roundDetail(await call(`/rounds/${encodeURIComponent(id)}`));
  },
  async attempts(roundId, after) {
    const q = after === undefined ? '' : `?after=${encodeURIComponent(after)}`;
    const raw = list(await call(`/rounds/${encodeURIComponent(roundId)}/attempts${q}`), 'attempts');
    return raw.map(N.attempt).filter((a): a is Attempt => a !== null);
  },
  async practice(level, message) {
    return N.practice(await call('/practice', { method: 'POST', body: JSON.stringify({ level, message }) }));
  },
};

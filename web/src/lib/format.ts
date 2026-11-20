import { formatUnits } from 'viem';
import { config } from '../config';
import type { Attacker } from '../api/types';

export const shortHex = (h: string, head = 6, tail = 4) => (h.length <= head + tail + 1 ? h : `${h.slice(0, head)}…${h.slice(-tail)}`);

export const attackerLabel = (a: Attacker) => a.name ?? shortHex(a.address);

export function money(units: bigint) {
  const n = Number(formatUnits(units, config.tokenDecimals));
  return `${n.toLocaleString('en-US', { maximumFractionDigits: n < 100 ? 2 : 0 })} ${config.tokenSymbol}`;
}

export function timeLeft(endTime: number, nowSec: number) {
  let s = Math.max(0, endTime - nowSec);
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function ago(time: number, nowSec: number) {
  const s = Math.max(0, nowSec - time);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const dateTime = (t: number) =>
  new Date(t * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';

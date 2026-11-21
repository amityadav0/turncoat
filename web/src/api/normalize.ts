// Everything from the API is treated as hostile: validate shape, drop what doesn't fit.
import type { Attacker, Attempt, BreakKind, Decision, Hex, Outcome, PracticeResult, Reveal, Round, RoundDetail, RoundStatus } from './types';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const HEX = /^0x(?:[0-9a-fA-F]{2})*$/;
// .ai names: lowercase letters, digits and hyphens, then ".ai". Anything else falls back to the address.
const AI_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.ai$/;
const MAX_TEXT = 20_000;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const int = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : fallback);
const hex32 = (v: unknown): Hex | undefined => (typeof v === 'string' && BYTES32.test(v) ? (v as Hex) : undefined);
const text = (v: unknown) => (typeof v === 'string' ? v.slice(0, MAX_TEXT) : undefined);

function attacker(v: unknown): Attacker | undefined {
  const o = obj(v);
  if (typeof o.address !== 'string' || !ADDRESS.test(o.address)) return undefined;
  const name = typeof o.name === 'string' && AI_NAME.test(o.name) ? o.name : undefined;
  return { address: o.address as Hex, name };
}

/** The guard service sends "v1", "v2", …; accept a bare number too. */
function version(v: unknown): number | undefined {
  const m = typeof v === 'string' ? /^v?(\d{1,4})$/i.exec(v) : null;
  const n = typeof v === 'number' ? v : m ? Number(m[1]) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

const STATUSES: RoundStatus[] = ['live', 'settling', 'broken', 'held'];
const OUTCOMES: Outcome[] = ['held', 'broken', 'pending'];
const STATUS = /^[a-z_]{1,32}$/;

export function round(v: unknown): Round | null {
  const o = obj(v);
  const id = int(o.id, -1);
  const commit = hex32(o.guardCommit);
  if (id < 1 || !commit || !STATUSES.includes(o.status as RoundStatus)) return null;
  const units = (v: unknown) => (typeof v === 'string' && /^\d{1,78}$/.test(v) ? BigInt(v) : undefined);
  const pot = units(o.pot) ?? 0n;
  return {
    id,
    level: Math.min(int(o.level, 1), 5) || 1,
    status: o.status as RoundStatus,
    startTime: int(o.startTime),
    endTime: int(o.endTime),
    pot,
    payout: units(o.payout),
    // Unknown counts as paid, so the full risk notice shows rather than a free-round claim.
    paidEnabled: o.paidEnabled !== false,
    baseFee: units(o.baseFee) ?? 0n,
    attemptCount: int(o.attemptCount),
    guardCommit: commit,
    guardVersion: version(o.guardVersion),
    mode: typeof o.mode === 'string' && /^[a-z_]{1,24}$/.test(o.mode) ? o.mode : undefined,
    model: typeof o.model === 'string' && /^[A-Za-z0-9._:/@-]{1,80}$/.test(o.model) ? o.model : undefined,
    openTx: hex32(o.openTx),
    winner: attacker(o.winner),
    winningAttempt: typeof o.winningAttempt === 'number' ? int(o.winningAttempt) : undefined,
    settleTx: hex32(o.settleTx),
    signer: typeof o.signer === 'string' && ADDRESS.test(o.signer) ? (o.signer as Hex) : undefined,
    closedAt: typeof o.closedAt === 'number' ? int(o.closedAt) || undefined : undefined,
  };
}

const DECISIONS: Record<string, Decision> = { approve_payment: 'approve', reject_payment: 'reject' };

/** The first decision tool in the recorded calls: decide mode ends a reply at the first one. */
function decisionOf(calls: unknown): Decision | undefined {
  if (!Array.isArray(calls)) return undefined;
  for (const c of calls.slice(0, 50)) {
    const name = obj(c).name;
    if (typeof name === 'string' && DECISIONS[name]) return DECISIONS[name];
  }
  return undefined;
}
const breakKind = (v: unknown): BreakKind | undefined => (v === 'misfire' || v === 'persuaded' ? v : undefined);

export function attempt(v: unknown): Attempt | null {
  const o = obj(v);
  const who = attacker(o.attacker);
  const hash = hex32(o.messageHash);
  if (!who || !hash || typeof o.id !== 'number') return null;
  const status = typeof o.status === 'string' && STATUS.test(o.status) ? o.status : undefined;
  let outcome: Outcome = OUTCOMES.includes(o.outcome as Outcome) ? (o.outcome as Outcome) : 'pending';
  // Never answered (failed = the model errored too many times in a row). Not judged, so never shown as held.
  if (outcome !== 'broken' && (status === 'expired' || status === 'rejected' || status === 'failed')) outcome = 'void';
  // Operator-hidden: drop the text here, whatever else the response carries.
  const hidden = o.hidden === true;
  return {
    roundId: int(o.roundId),
    id: int(o.id),
    attacker: who,
    time: int(o.time),
    outcome,
    status,
    note: text(o.note)?.slice(0, 300),
    messageHash: hash,
    tx: hex32(o.tx),
    // Shown as soon as the guard has answered. Hostile: rendered as plain text only.
    hidden: hidden || undefined,
    message: hidden ? undefined : text(o.message),
    reply: hidden ? undefined : text(o.reply),
    decision: outcome === 'held' || outcome === 'broken' ? (o.decision === 'approve' || o.decision === 'reject' ? o.decision : decisionOf(o.toolCalls)) : undefined,
    breakKind: outcome === 'broken' ? breakKind(o.breakKind) : undefined,
  };
}

export function reveal(v: unknown): Reveal | null {
  const o = obj(v);
  const salt = hex32(o.salt);
  if (!salt || typeof o.instructions !== 'string' || !HEX.test(o.instructions)) return null;
  const source = o.source === 'chain' || o.source === 'service' ? o.source : undefined;
  return { salt, instructions: o.instructions as Hex, tx: hex32(o.tx), source };
}

export function roundDetail(v: unknown): RoundDetail {
  const o = obj(v);
  const r = round(o.round);
  if (!r) throw new Error('Malformed round');
  const closed = r.status === 'broken' || r.status === 'held';
  const list = Array.isArray(o.attempts) ? o.attempts : [];
  return {
    round: r,
    attempts: list.map(attempt).filter((a): a is Attempt => a !== null),
    // The salt is only published once the round is over; ignore any reveal before then.
    reveal: closed ? reveal(o.reveal) : null,
  };
}

const MONEY_TOOLS = ['approve_payment', 'transfer', 'approve', 'swap'];

/** "approve_payment(to: 0xabc…, amount: 40, …)" or "transfer(to: 0xabc…, amount: 500)" from the guard service's recorded tool calls. Hostile text. */
function describeCall(c: unknown): string | undefined {
  const o = obj(c);
  if (typeof o.name !== 'string' || !MONEY_TOOLS.includes(o.name)) return undefined;
  const args = Object.entries(obj(o.args))
    .slice(0, 6)
    .map(([k, v]) => `${k.slice(0, 32)}: ${(typeof v === 'string' ? v : JSON.stringify(v) ?? '').slice(0, 80)}`);
  return `${o.name}(${args.join(', ')})`;
}

export function practice(v: unknown): PracticeResult {
  const o = obj(v);
  const broken = o.broken === true;
  const fromCalls = Array.isArray(o.toolCalls) ? o.toolCalls.map(describeCall).find(Boolean) : undefined;
  return {
    reply: text(o.reply) ?? '',
    broken,
    action: broken ? (text(o.action) ?? fromCalls)?.slice(0, 300) : undefined,
    decision: o.decision === 'approve' || o.decision === 'reject' ? o.decision : decisionOf(o.toolCalls),
    breakKind: broken ? breakKind(o.breakKind) : undefined,
  };
}

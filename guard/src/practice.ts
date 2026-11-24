// Practice mode: the same guard and break rule, no chain, no signature, nothing stored.
import type { ModelAdapter } from "./model/index.ts";
import { runGuard, validateMessage, MAX_MESSAGE_CHARS, messageLength } from "./guard.ts";
import { redact } from "./model/redact.ts";
import type { Reply } from "./service.ts";
import { detectBreak, classifyBreak } from "./detector.ts";
import type { RecordedCall } from "./sandbox.ts";

/** Short description of the forbidden call, e.g. `transfer(0xabc…, 1000 USDT)`. */
export function describeCall(c: RecordedCall): string {
  const a = c.args ?? {};
  const short = (v: unknown) => { const s = String(v ?? "?"); return /^0x[0-9a-fA-F]{40}$/.test(s) ? `${s.slice(0, 6)}…` : s.slice(0, 48); };
  const token = String(a.token ?? "USDT");
  if (c.name === "transfer") return `transfer(${short(a.to)}, ${short(a.amount)} ${token})`;
  if (c.name === "approve") return `approve(${short(a.spender)}, ${short(a.amount)} ${token})`;
  if (c.name === "approve_payment") return `approve_payment(${short(a.to)}, ${short(a.amount)} USDT)`;
  if (c.name === "swap") return `swap(${short(a.amount)} ${short(a.tokenIn)} → ${short(a.tokenOut)})`;
  return `${c.name}(${JSON.stringify(a).slice(0, 60)})`;
}

export interface PracticeLevel {
  instructions: string;
  mode: "refuse" | "decide" | "reader";
}

export const PRACTICE_RUNGS = ["lighter", "top"] as const;
export type PracticeRungName = (typeof PRACTICE_RUNGS)[number];

/** A practice rung: the same guard version and model as one launch round, with its own rate limits. */
export interface PracticeRung {
  levels: Map<number, PracticeLevel>;
  model: ModelAdapter;
  /** Guard version label, e.g. "v2". */
  version?: string;
}

/** Parses a rung spec "<version> <provider/model>", e.g. "v2 anthropic/claude-haiku-5-5". */
export function parseRungSpec(spec: string): { version: string; model: string } {
  const m = /^\s*(\S+)\s+([a-z]+\/\S+)\s*$/.exec(spec);
  if (!m) throw new Error(`practice rung must look like "<version> <provider/model>", got "${spec}"`);
  return { version: m[1], model: m[2] };
}

/** Which rung a practice request asks for: `rung` absent means lighter; anything else unknown is null. */
export function practiceRungOf(body: unknown): PracticeRungName | null {
  const r = (body as Record<string, unknown> | null)?.rung;
  if (r === undefined || r === null || r === "") return "lighter";
  return (PRACTICE_RUNGS as readonly unknown[]).includes(r) ? (r as PracticeRungName) : null;
}

export async function practice(body: unknown, levels: Map<number, PracticeLevel>, model: ModelAdapter, maxTurns: number, meta: { rung?: PracticeRungName; guardVersion?: string } = {}): Promise<Reply> {
  const b = (body ?? {}) as Record<string, unknown>;
  const level = typeof b.level === "string" && /^\d+$/.test(b.level) ? Number(b.level) : b.level;
  const message = b.message;
  if (typeof level !== "number" || typeof message !== "string" || !message) {
    return { code: 400, body: { error: "expected { level: integer, message: non-empty string }" } };
  }
  const lv = levels.get(level);
  if (!lv) return { code: 404, body: { error: `practice level ${level} is not available`, levels: [...levels.keys()] } };
  if (messageLength(message) > MAX_MESSAGE_CHARS) return { code: 400, body: { error: `message is longer than ${MAX_MESSAGE_CHARS} characters` } };
  const bad = validateMessage(lv.mode, message);
  if (bad) return { code: 400, body: { error: bad } };
  try {
    const run = await runGuard({ level, mode: lv.mode, instructions: lv.instructions, message, model, balances: { USDT: 1000, BNB: 0.05 }, maxTurns });
    const first = detectBreak(level, run.toolCalls, lv.mode).offending[0];
    const breakKind = classifyBreak(level, lv.mode, run.toolCalls, run.reply) ?? undefined;
    return { code: 200, body: { level, mode: lv.mode, decision: run.decision ?? undefined, broken: run.broken, breakKind, action: first ? describeCall(first) : undefined, message: run.message, reply: run.reply, toolCalls: run.toolCalls, conversation: run.conversation, model: run.model, guardVersion: meta.guardVersion, rung: meta.rung, startedAt: run.startedAt, finishedAt: run.finishedAt } };
  } catch (e) {
    return { code: 502, body: { error: "the guard model is unavailable, try again later", detail: redact(String((e as Error)?.message ?? e)).slice(0, 200) } };
  }
}

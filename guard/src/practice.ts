// Practice mode: the same guard and break rule, no chain, no signature, nothing stored.
import type { ModelAdapter } from "./model/index.ts";
import { runGuard, MAX_MESSAGE_CHARS, messageLength } from "./guard.ts";
import { redact } from "./model/redact.ts";
import type { Reply } from "./service.ts";
import { detectBreak } from "./detector.ts";
import type { RecordedCall } from "./sandbox.ts";

/** Short description of the forbidden call, e.g. `transfer(0xabc…, 1000 USDT)`. */
export function describeCall(c: RecordedCall): string {
  const a = c.args ?? {};
  const short = (v: unknown) => { const s = String(v ?? "?"); return /^0x[0-9a-fA-F]{40}$/.test(s) ? `${s.slice(0, 6)}…` : s.slice(0, 48); };
  const token = String(a.token ?? "USDT");
  if (c.name === "transfer") return `transfer(${short(a.to)}, ${short(a.amount)} ${token})`;
  if (c.name === "approve") return `approve(${short(a.spender)}, ${short(a.amount)} ${token})`;
  if (c.name === "approve_payment") return `approve_payment(${short(a.to)}, ${short(a.amount)} USDT)`;
  return `${c.name}(${JSON.stringify(a).slice(0, 60)})`;
}

export interface PracticeLevel {
  instructions: string;
  mode: "refuse" | "decide";
}

export async function practice(body: unknown, levels: Map<number, PracticeLevel>, model: ModelAdapter, maxTurns: number): Promise<Reply> {
  const b = (body ?? {}) as Record<string, unknown>;
  const level = typeof b.level === "string" && /^\d+$/.test(b.level) ? Number(b.level) : b.level;
  const message = b.message;
  if (typeof level !== "number" || typeof message !== "string" || !message) {
    return { code: 400, body: { error: "expected { level: integer, message: non-empty string }" } };
  }
  const lv = levels.get(level);
  if (!lv) return { code: 404, body: { error: `practice level ${level} is not available`, levels: [...levels.keys()] } };
  if (messageLength(message) > MAX_MESSAGE_CHARS) return { code: 400, body: { error: `message is longer than ${MAX_MESSAGE_CHARS} characters` } };
  try {
    const run = await runGuard({ level, mode: lv.mode, instructions: lv.instructions, message, model, balances: { USDT: 1000, BNB: 0.05 }, maxTurns });
    const first = detectBreak(level, run.toolCalls, lv.mode).offending[0];
    return { code: 200, body: { level, mode: lv.mode, decision: run.decision ?? undefined, broken: run.broken, action: first ? describeCall(first) : undefined, message: run.message, reply: run.reply, toolCalls: run.toolCalls, conversation: run.conversation, model: run.model, startedAt: run.startedAt, finishedAt: run.finishedAt } };
  } catch (e) {
    return { code: 502, body: { error: "the guard model is unavailable, try again later", detail: redact(String((e as Error)?.message ?? e)).slice(0, 200) } };
  }
}

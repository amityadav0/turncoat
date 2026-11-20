// Runs one guard conversation: system = level instructions, user = the attacker's message.
// Fresh sandbox and fresh history every time; nothing carries over between attempts.
import type { ChatMessage, ModelAdapter } from "./model/index.ts";
import { SandboxWallet, toolsFor, DECISION_TOOLS, parseTokenMetadata, READER_OWNER_REQUEST, type RecordedCall } from "./sandbox.ts";
import { detectBreak, classifyBreak, type Mode } from "./detector.ts";

export const MAX_MESSAGE_CHARS = 2000;

/** Length in Unicode code points, so an emoji counts as one character. */
export function messageLength(s: string): number {
  return [...s].length;
}

/**
 * Mode-specific format check for an attacker's message, beyond the length limit. Returns an error
 * message, or null if the message is acceptable. Reader mode expects token metadata as JSON.
 */
export function validateMessage(mode: Mode, message: string): string | null {
  if (mode === "reader") {
    const t = parseTokenMetadata(message);
    return "error" in t ? t.error : null;
  }
  return null;
}

export interface GuardRun {
  model: string;
  level: number;
  mode: Mode;
  /**
   * Decide mode only: "approve" if approve_payment was called, else "reject". `decisionFallback` is
   * true when the model ended without calling either decision tool (recorded as a reject).
   */
  decision: "approve" | "reject" | null;
  decisionFallback: boolean;
  /** "misfire" (refused in words, called the tool anyway) or "persuaded"; null if not broken. A label only. */
  breakKind: "misfire" | "persuaded" | null;
  message: string;
  reply: string;
  toolCalls: RecordedCall[];
  broken: boolean;
  stopReason: string;
  /** Full conversation as sent to / received from the model, excluding the system prompt. */
  conversation: ChatMessage[];
  startedAt: string;
  finishedAt: string;
  /** Summed over every model call in this reply; null if the provider reported none. */
  usage: { inputTokens: number; outputTokens: number } | null;
  /** Wall-clock seconds for the whole reply. */
  seconds: number;
}

export interface RunOptions {
  level: number;
  /** Default "refuse". */
  mode?: Mode;
  instructions: string;
  message: string;
  model: ModelAdapter;
  /** Balances the sandbox starts with (whole tokens). */
  balances?: Record<string, number>;
  /** Model turns allowed in one reply (each turn may call tools). */
  maxTurns?: number;
}

/** One guard reply inside an existing conversation: model calls and tool calls until the reply ends. */
async function replyTurn(
  messages: ChatMessage[], wallet: SandboxWallet, mode: Mode, model: ModelAdapter, maxTurns: number,
  usage: { inputTokens: number; outputTokens: number } | null,
): Promise<{ texts: string[]; stopReason: string; usage: { inputTokens: number; outputTokens: number } | null }> {
  const tools = toolsFor(mode);
  const texts: string[] = [];
  let stopReason = "max_turns";
  for (let turn = 0; turn < maxTurns; turn++) {
    const res = await model.complete(messages, tools, mode === "decide" ? { requireTool: true } : {});
    if (res.usage) {
      usage ??= { inputTokens: 0, outputTokens: 0 };
      usage.inputTokens += res.usage.inputTokens;
      usage.outputTokens += res.usage.outputTokens;
    }
    messages.push({ role: "assistant", content: res.text, toolCalls: res.toolCalls, raw: res.raw });
    if (res.text) texts.push(res.text);
    if (res.toolCalls.length === 0) {
      stopReason = res.stopReason;
      break;
    }
    for (const call of res.toolCalls) {
      const result = wallet.run(call.id, call.name, call.args);
      messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: JSON.stringify(result) });
    }
    // Decide mode: the reply ends at the first decision.
    if (mode === "decide" && res.toolCalls.some((c) => (DECISION_TOOLS as readonly string[]).includes(c.name))) {
      stopReason = "decision";
      break;
    }
  }
  return { texts, stopReason, usage };
}

/**
 * Text shown as Argus's reply. With a forced tool call some models write no prose at all and put
 * everything in the decision's `reason`; in decide mode that reason is then the reply.
 */
function replyText(mode: Mode, texts: string[], calls: readonly RecordedCall[]): string {
  if (texts.length || mode !== "decide") return texts.join("\n\n");
  return calls.filter((c) => (DECISION_TOOLS as readonly string[]).includes(c.name)).map((c) => String(c.args?.reason ?? "")).filter(Boolean).join("\n\n");
}

const neutral = (messages: ChatMessage[]) =>
  messages.slice(1).map((m) => (m.role === "assistant" ? { role: m.role, content: m.content, toolCalls: m.toolCalls } : m));

export async function runGuard(o: RunOptions): Promise<GuardRun> {
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  const mode: Mode = o.mode ?? "refuse";
  // Reader mode: the attacker's message is token metadata; the user turn is the owner's own request.
  let token;
  if (mode === "reader") {
    const t = parseTokenMetadata(o.message);
    if ("error" in t) throw new Error(`invalid reader-mode message: ${t.error}`);
    token = t;
  }
  const wallet = new SandboxWallet(o.balances, token);
  const messages: ChatMessage[] = [
    { role: "system", content: o.instructions },
    { role: "user", content: mode === "reader" ? READER_OWNER_REQUEST : o.message },
  ];
  const r = await replyTurn(messages, wallet, mode, o.model, o.maxTurns ?? 6, null);
  const { broken } = detectBreak(o.level, wallet.calls, mode);
  const decided = wallet.calls.some((c) => (DECISION_TOOLS as readonly string[]).includes(c.name));
  return {
    model: o.model.id,
    level: o.level,
    mode,
    decision: mode === "decide" ? (broken ? "approve" : "reject") : null,
    decisionFallback: mode === "decide" && !decided,
    breakKind: classifyBreak(o.level, mode, wallet.calls, r.texts.join("\n\n")),
    message: o.message,
    reply: replyText(mode, r.texts, wallet.calls),
    toolCalls: wallet.calls,
    broken,
    stopReason: r.stopReason,
    // `raw` is provider-internal (e.g. thinking blocks); keep the stored transcript provider-neutral.
    conversation: neutral(messages),
    startedAt,
    finishedAt: new Date().toISOString(),
    usage: r.usage,
    seconds: (performance.now() - t0) / 1000,
  };
}

export interface SessionTurn {
  message: string;
  reply: string;
  toolCalls: RecordedCall[];
  brokenHere: boolean;
}

export interface GuardSession {
  model: string;
  level: number;
  mode: Mode;
  turns: SessionTurn[];
  broken: boolean;
  /** 1-based turn at which the session broke, or null. */
  brokenAtTurn: number | null;
  breakKind: "misfire" | "persuaded" | null;
  conversation: ChatMessage[];
  usage: { inputTokens: number; outputTokens: number } | null;
  seconds: number;
}

/**
 * Red team only (for now): several attacker messages in one conversation. Argus answers each; the
 * break rule applies across the whole session. The session stops at the first break.
 */
export async function runSession(o: Omit<RunOptions, "message"> & { turns: string[] }): Promise<GuardSession> {
  const t0 = performance.now();
  const mode: Mode = o.mode ?? "refuse";
  if (mode === "reader") throw new Error("sessions are not defined for reader mode");
  const wallet = new SandboxWallet(o.balances);
  const messages: ChatMessage[] = [{ role: "system", content: o.instructions }];
  const turns: SessionTurn[] = [];
  let usage: { inputTokens: number; outputTokens: number } | null = null;
  let brokenAtTurn: number | null = null;
  let breakText = "";
  for (const [i, msg] of o.turns.entries()) {
    const before = wallet.calls.length;
    messages.push({ role: "user", content: msg });
    const r = await replyTurn(messages, wallet, mode, o.model, o.maxTurns ?? 6, usage);
    usage = r.usage;
    const calls = wallet.calls.slice(before);
    const brokenHere = detectBreak(o.level, calls, mode).broken;
    turns.push({ message: msg, reply: replyText(mode, r.texts, calls), toolCalls: calls, brokenHere });
    if (brokenHere) {
      brokenAtTurn = i + 1;
      breakText = r.texts.join("\n\n");
      break;
    }
  }
  const broken = brokenAtTurn !== null;
  return {
    model: o.model.id,
    level: o.level,
    mode,
    turns,
    broken,
    brokenAtTurn,
    breakKind: broken ? classifyBreak(o.level, mode, turns[turns.length - 1].toolCalls, breakText) : null,
    conversation: neutral(messages),
    usage,
    seconds: (performance.now() - t0) / 1000,
  };
}

// Runs one guard conversation: system = level instructions, user = the attacker's message.
// Fresh sandbox and fresh history every time; nothing carries over between attempts.
import type { ChatMessage, ModelAdapter } from "./model/index.ts";
import { SandboxWallet, toolsFor, DECISION_TOOLS, type RecordedCall } from "./sandbox.ts";
import { detectBreak, type Mode } from "./detector.ts";

export const MAX_MESSAGE_CHARS = 2000;

/** Length in Unicode code points, so an emoji counts as one character. */
export function messageLength(s: string): number {
  return [...s].length;
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

export async function runGuard(o: RunOptions): Promise<GuardRun> {
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  let usage: { inputTokens: number; outputTokens: number } | null = null;
  const mode: Mode = o.mode ?? "refuse";
  const tools = toolsFor(mode);
  const wallet = new SandboxWallet(o.balances);
  const messages: ChatMessage[] = [
    { role: "system", content: o.instructions },
    { role: "user", content: o.message },
  ];
  const maxTurns = o.maxTurns ?? 6;
  const texts: string[] = [];
  let stopReason = "max_turns";

  for (let turn = 0; turn < maxTurns; turn++) {
    const res = await o.model.complete(messages, tools, mode === "decide" ? { requireTool: true } : {});
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

  const { broken } = detectBreak(o.level, wallet.calls, mode);
  const decided = wallet.calls.some((c) => (DECISION_TOOLS as readonly string[]).includes(c.name));
  return {
    model: o.model.id,
    level: o.level,
    mode,
    decision: mode === "decide" ? (broken ? "approve" : "reject") : null,
    decisionFallback: mode === "decide" && !decided,
    message: o.message,
    reply: texts.join("\n\n"),
    toolCalls: wallet.calls,
    broken,
    stopReason,
    // `raw` is provider-internal (e.g. thinking blocks); keep the stored transcript provider-neutral.
    conversation: messages.slice(1).map((m) => (m.role === "assistant" ? { role: m.role, content: m.content, toolCalls: m.toolCalls } : m)),
    startedAt,
    finishedAt: new Date().toISOString(),
    usage,
    seconds: (performance.now() - t0) / 1000,
  };
}

// Runs one guard conversation: system = level instructions, user = the attacker's message.
// Fresh sandbox and fresh history every time; nothing carries over between attempts.
import type { ChatMessage, ModelAdapter } from "./model/index.ts";
import { SandboxWallet, WALLET_TOOLS, type RecordedCall } from "./sandbox.ts";
import { detectBreak } from "./detector.ts";

export const MAX_MESSAGE_CHARS = 2000;

/** Length in Unicode code points, so an emoji counts as one character. */
export function messageLength(s: string): number {
  return [...s].length;
}

export interface GuardRun {
  model: string;
  level: number;
  message: string;
  reply: string;
  toolCalls: RecordedCall[];
  broken: boolean;
  stopReason: string;
  /** Full conversation as sent to / received from the model, excluding the system prompt. */
  conversation: ChatMessage[];
  startedAt: string;
  finishedAt: string;
}

export interface RunOptions {
  level: number;
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
  const wallet = new SandboxWallet(o.balances);
  const messages: ChatMessage[] = [
    { role: "system", content: o.instructions },
    { role: "user", content: o.message },
  ];
  const maxTurns = o.maxTurns ?? 6;
  const texts: string[] = [];
  let stopReason = "max_turns";

  for (let turn = 0; turn < maxTurns; turn++) {
    const res = await o.model.complete(messages, WALLET_TOOLS);
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
  }

  const { broken } = detectBreak(o.level, wallet.calls);
  return {
    model: o.model.id,
    level: o.level,
    message: o.message,
    reply: texts.join("\n\n"),
    toolCalls: wallet.calls,
    broken,
    stopReason,
    // `raw` is provider-internal (e.g. thinking blocks); keep the stored transcript provider-neutral.
    conversation: messages.slice(1).map((m) => (m.role === "assistant" ? { role: m.role, content: m.content, toolCalls: m.toolCalls } : m)),
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}

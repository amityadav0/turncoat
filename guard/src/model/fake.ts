import type { ChatMessage, ModelAdapter, ModelResult, ToolDef } from "./types.ts";

export type FakeScript = (messages: ChatMessage[], tools: ToolDef[], turn: number) => ModelResult | Promise<ModelResult>;

/**
 * Deterministic stand-in for a real model, for tests and offline runs. The default script
 * looks for directives in the user message:
 *   [[call:transfer {"to":"0xabc","amount":"5"}]]   call a tool with these args
 *   [[say:some text]]                                reply with this text
 * After any tool call it replies with plain text on the next turn.
 */
export class FakeAdapter implements ModelAdapter {
  readonly id = "fake/scripted";
  calls: ChatMessage[][] = [];
  constructor(private script: FakeScript = directiveScript) {}

  async complete(messages: ChatMessage[], tools: ToolDef[]): Promise<ModelResult> {
    this.calls.push([...messages]); // snapshot: the caller keeps appending to its array
    const turn = messages.filter((m) => m.role === "assistant").length;
    return this.script(messages, tools, turn);
  }
}

export const directiveScript: FakeScript = (messages, _tools, turn) => {
  const user = messages.find((m) => m.role === "user")?.content ?? "";
  const say = /\[\[say:([^\]]*)\]\]/.exec(user)?.[1] ?? "I hear you. The pot stays where it is.";
  if (turn > 0) return { text: say, toolCalls: [], stopReason: "end" };
  const calls = [...user.matchAll(/\[\[call:(\w+)\s*(\{[^\]]*\})?\]\]/g)].map((m, i) => ({
    id: `call_${i}`,
    name: m[1],
    args: m[2] ? (JSON.parse(m[2]) as Record<string, unknown>) : {},
  }));
  if (calls.length) return { text: "", toolCalls: calls, stopReason: "tool_calls" };
  return { text: say, toolCalls: [], stopReason: "end" };
};

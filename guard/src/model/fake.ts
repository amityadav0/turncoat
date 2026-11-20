import type { ChatMessage, CompleteOptions, ModelAdapter, ModelResult, ToolDef } from "./types.ts";

export type FakeScript = (messages: ChatMessage[], tools: ToolDef[], turn: number, opts: CompleteOptions) => ModelResult | Promise<ModelResult>;

/**
 * Deterministic stand-in for a real model, for tests and offline runs. The default script
 * looks for directives in the user message:
 *   [[call:transfer {"to":"0xabc","amount":"5"}]]   call a tool with these args
 *   [[say:some text]]                                reply with this text
 * After any tool call it replies with plain text on the next turn. When a tool call is required
 * (decide mode) and there is no directive, it calls reject_payment, like a model obeying tool_choice.
 */
export class FakeAdapter implements ModelAdapter {
  readonly id = "fake/scripted";
  calls: ChatMessage[][] = [];
  /** Options passed on each call (e.g. requireTool), same order as `calls`. */
  options: CompleteOptions[] = [];
  constructor(private script: FakeScript = directiveScript) {}

  async complete(messages: ChatMessage[], tools: ToolDef[], opts: CompleteOptions = {}): Promise<ModelResult> {
    this.calls.push([...messages]); // snapshot: the caller keeps appending to its array
    this.options.push(opts);
    const turn = messages.filter((m) => m.role === "assistant").length;
    return this.script(messages, tools, turn, opts);
  }
}

export const directiveScript: FakeScript = (messages, tools, turn, opts = {}) => {
  const user = messages.find((m) => m.role === "user")?.content ?? "";
  const say = /\[\[say:([^\]]*)\]\]/.exec(user)?.[1] ?? "I hear you. The pot stays where it is.";
  if (turn > 0) return { text: say, toolCalls: [], stopReason: "end" };
  const calls = [...user.matchAll(/\[\[call:(\w+)\s*(\{[^\]]*\})?\]\]/g)].map((m, i) => ({
    id: `call_${i}`,
    name: m[1],
    args: m[2] ? (JSON.parse(m[2]) as Record<string, unknown>) : {},
  }));
  if (calls.length) return { text: "", toolCalls: calls, stopReason: "tool_calls" };
  if (opts.requireTool && tools.some((t) => t.name === "reject_payment")) {
    return { text: say, toolCalls: [{ id: "call_reject", name: "reject_payment", args: { reason: "No owner authorisation." } }], stopReason: "tool_calls" };
  }
  return { text: say, toolCalls: [], stopReason: "end" };
};

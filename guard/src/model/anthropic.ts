import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage, CompleteOptions, ModelAdapter, ModelResult, ToolDef, ToolCall } from "./types.ts";
import { safeError } from "./redact.ts";

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  maxTokens: number;
  /** output_config.effort; omitted when undefined so the model default applies. */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  baseURL?: string;
}

export class AnthropicAdapter implements ModelAdapter {
  readonly id: string;
  private client: Anthropic;
  /** Some models reject forced tool choice (400); after the first refusal we stop asking. */
  private forcedToolUnsupported = false;

  constructor(private opts: AnthropicOptions) {
    this.id = `anthropic/${opts.model}`;
    this.client = new Anthropic({ apiKey: opts.apiKey, baseURL: opts.baseURL, maxRetries: 2 });
  }

  async complete(messages: ChatMessage[], tools: ToolDef[], opts: CompleteOptions = {}): Promise<ModelResult> {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const out: Anthropic.MessageParam[] = [];
    for (const m of messages) {
      if (m.role === "system") continue;
      if (m.role === "user") out.push({ role: "user", content: m.content });
      else if (m.role === "assistant") {
        if (Array.isArray(m.raw)) out.push({ role: "assistant", content: m.raw as Anthropic.ContentBlockParam[] });
        else {
          const blocks: Anthropic.ContentBlockParam[] = [];
          if (m.content) blocks.push({ type: "text", text: m.content });
          for (const c of m.toolCalls) blocks.push({ type: "tool_use", id: c.id, name: c.name, input: c.args });
          out.push({ role: "assistant", content: blocks });
        }
      } else {
        // All results for one assistant turn go back in a single user message.
        const block: Anthropic.ToolResultBlockParam = { type: "tool_result", tool_use_id: m.toolCallId, content: m.content };
        const last = out[out.length - 1];
        if (last && last.role === "user" && Array.isArray(last.content) && last.content.every((b) => b.type === "tool_result")) {
          (last.content as Anthropic.ToolResultBlockParam[]).push(block);
        } else out.push({ role: "user", content: [block] });
      }
    }

    const body: Anthropic.MessageCreateParamsNonStreaming = {
      model: this.opts.model,
      max_tokens: this.opts.maxTokens,
      ...(system ? { system } : {}),
      ...(this.opts.effort ? { output_config: { effort: this.opts.effort } } : {}),
      tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters as Anthropic.Tool.InputSchema })),
      messages: out,
    };
    const force = opts.requireTool && !this.forcedToolUnsupported && tools.length > 0;
    let res: Anthropic.Message;
    try {
      res = await this.client.messages.create(force ? { ...body, tool_choice: { type: "any" } } : body);
    } catch (err) {
      if (force && err instanceof Anthropic.BadRequestError && /tool_choice/i.test(err.message)) {
        // e.g. claude-opus-5-5 / claude-sonnet-5-5: forced tool choice is a 400. Fall back to "auto"
        // and rely on the instructions; a reply without a decision is handled by the caller.
        this.forcedToolUnsupported = true;
        try {
          res = await this.client.messages.create(body);
        } catch (err2) {
          throw safeError(err2);
        }
      } else throw safeError(err);
    }

    const toolCalls: ToolCall[] = [];
    let text = "";
    for (const b of res.content) {
      if (b.type === "text") text += b.text;
      else if (b.type === "tool_use") {
        const args = b.input && typeof b.input === "object" ? (b.input as Record<string, unknown>) : { _raw: String(b.input) };
        toolCalls.push({ id: b.id, name: b.name, args });
      }
    }
    const stop = res.stop_reason;
    const stopReason = stop === "end_turn" ? "end" : stop === "tool_use" ? "tool_calls" : String(stop);
    const usage = res.usage ? { inputTokens: (res.usage.input_tokens ?? 0) + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0), outputTokens: res.usage.output_tokens ?? 0 } : undefined;
    return { text, toolCalls, stopReason, raw: res.content, usage };
  }
}

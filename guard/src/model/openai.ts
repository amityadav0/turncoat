import OpenAI from "openai";
import type { ChatMessage, CompleteOptions, ModelAdapter, ModelResult, ToolDef, ToolCall } from "./types.ts";
import { safeError } from "./redact.ts";

export interface OpenAIOptions {
  apiKey: string;
  model: string;
  maxTokens: number;
  /** Any OpenAI-compatible Chat Completions endpoint. */
  baseURL?: string;
}

export class OpenAIAdapter implements ModelAdapter {
  readonly id: string;
  private client: OpenAI;

  constructor(private opts: OpenAIOptions) {
    this.id = `openai/${opts.model}`;
    this.client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL, maxRetries: 2 });
  }

  async complete(messages: ChatMessage[], tools: ToolDef[], opts: CompleteOptions = {}): Promise<ModelResult> {
    const out: OpenAI.Chat.ChatCompletionMessageParam[] = messages.map((m) => {
      if (m.role === "system" || m.role === "user") return { role: m.role, content: m.content };
      if (m.role === "tool") return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
      return {
        role: "assistant",
        content: m.content || null,
        ...(m.toolCalls.length
          ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: JSON.stringify(c.args) } })) }
          : {}),
      };
    });

    let res: OpenAI.Chat.ChatCompletion;
    try {
      res = await this.client.chat.completions.create({
        model: this.opts.model,
        max_completion_tokens: this.opts.maxTokens,
        messages: out,
        tools: tools.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.parameters } })),
        ...(opts.requireTool && tools.length ? { tool_choice: "required" as const } : {}),
      });
    } catch (err) {
      throw safeError(err);
    }

    const choice = res.choices[0];
    const toolCalls: ToolCall[] = [];
    for (const c of choice?.message.tool_calls ?? []) {
      if (c.type !== "function") continue;
      let args: Record<string, unknown>;
      try {
        const parsed = JSON.parse(c.function.arguments || "{}");
        args = parsed && typeof parsed === "object" ? parsed : { _raw: c.function.arguments };
      } catch {
        args = { _raw: c.function.arguments };
      }
      toolCalls.push({ id: c.id, name: c.function.name, args });
    }
    const fr = choice?.finish_reason;
    const stopReason = fr === "stop" ? "end" : fr === "tool_calls" ? "tool_calls" : fr === "length" ? "max_tokens" : fr === "content_filter" ? "refusal" : String(fr);
    const usage = res.usage ? { inputTokens: res.usage.prompt_tokens ?? 0, outputTokens: res.usage.completion_tokens ?? 0 } : undefined;
    return { text: choice?.message.content ?? "", toolCalls, stopReason, usage };
  }
}

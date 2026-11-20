// Provider-neutral model interface. The guard and the tool loop only see these types;
// each provider adapter maps them to its own API.

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema for the tool's input object. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Parsed arguments. If the model sent arguments that are not valid JSON, `{ _raw: string }`. */
  args: Record<string, unknown>;
}

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      toolCalls: ToolCall[];
      /** Provider-native assistant turn, replayed unchanged to the same provider (e.g. thinking blocks). */
      raw?: unknown;
    }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface CompleteOptions {
  /** Ask the provider to force a tool call this turn (where the model supports it). */
  requireTool?: boolean;
}

export interface ModelResult {
  /** Token usage reported by the provider for this call, if any. */
  usage?: Usage;
  text: string;
  toolCalls: ToolCall[];
  /** Normalised: "end" | "tool_calls" | "max_tokens" | "refusal" | provider-specific string. */
  stopReason: string;
  raw?: unknown;
}

export interface ModelAdapter {
  /** "provider/model", safe to log and store. Never contains credentials. */
  readonly id: string;
  complete(messages: ChatMessage[], tools: ToolDef[], opts?: CompleteOptions): Promise<ModelResult>;
}

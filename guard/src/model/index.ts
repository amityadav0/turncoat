import type { ModelAdapter } from "./types.ts";
import { AnthropicAdapter } from "./anthropic.ts";
import { OpenAIAdapter } from "./openai.ts";
import { FakeAdapter } from "./fake.ts";
import { registerSecret } from "./redact.ts";

export type { ModelAdapter, ChatMessage, ToolDef, ToolCall, ModelResult } from "./types.ts";

/**
 * Build the model adapter from env. Adding a provider means adding one adapter file and one case here.
 *   MODEL_PROVIDER  anthropic | openai | fake
 *   MODEL_NAME      provider model id
 *   MODEL_API_KEY   key for the provider (falls back to ANTHROPIC_API_KEY / OPENAI_API_KEY)
 *   MODEL_BASE_URL  optional endpoint override (e.g. an OpenAI-compatible host)
 *   MODEL_MAX_TOKENS, MODEL_EFFORT (anthropic only)
 */
export function modelFromEnv(env: NodeJS.ProcessEnv = process.env): ModelAdapter {
  const provider = (env.MODEL_PROVIDER || "anthropic").toLowerCase();
  const maxTokens = Number(env.MODEL_MAX_TOKENS || 4096);
  const baseURL = env.MODEL_BASE_URL || undefined;
  switch (provider) {
    case "anthropic": {
      const apiKey = env.MODEL_API_KEY || env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error("MODEL_API_KEY (or ANTHROPIC_API_KEY) is not set");
      registerSecret(apiKey);
      const effort = env.MODEL_EFFORT as "low" | "medium" | "high" | "xhigh" | "max" | undefined;
      return new AnthropicAdapter({ apiKey, model: env.MODEL_NAME || "claude-opus-5-5", maxTokens, effort: effort || undefined, baseURL });
    }
    case "openai": {
      const apiKey = env.MODEL_API_KEY || env.OPENAI_API_KEY;
      if (!apiKey) throw new Error("MODEL_API_KEY (or OPENAI_API_KEY) is not set");
      if (!env.MODEL_NAME) throw new Error("MODEL_NAME is required for MODEL_PROVIDER=openai");
      registerSecret(apiKey);
      return new OpenAIAdapter({ apiKey, model: env.MODEL_NAME, maxTokens, baseURL });
    }
    case "fake":
      return new FakeAdapter();
    default:
      throw new Error(`unknown MODEL_PROVIDER: ${provider}`);
  }
}

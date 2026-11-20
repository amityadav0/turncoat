import type { ModelAdapter } from "./types.ts";
import { AnthropicAdapter } from "./anthropic.ts";
import { OpenAIAdapter } from "./openai.ts";
import { FakeAdapter } from "./fake.ts";
import { registerSecret } from "./redact.ts";

export type { ModelAdapter, ChatMessage, ToolDef, ToolCall, ModelResult, Usage, CompleteOptions } from "./types.ts";

/**
 * Build the model adapter from env. Adding a provider means adding one adapter file and one case here.
 *   MODEL_PROVIDER  anthropic | openai | fake
 *   MODEL_NAME      provider model id
 *   MODEL_API_KEY   key for the provider (falls back to ANTHROPIC_API_KEY / OPENAI_API_KEY)
 *   MODEL_BASE_URL  optional endpoint override (e.g. an OpenAI-compatible host)
 *   MODEL_MAX_TOKENS (output cap per model call), MODEL_EFFORT (anthropic only), MODEL_TIMEOUT_MS (default 60000)
 */
export function modelFromEnv(env: NodeJS.ProcessEnv = process.env): ModelAdapter {
  const provider = (env.MODEL_PROVIDER || "anthropic").toLowerCase();
  const maxTokens = Number(env.MODEL_MAX_TOKENS || 4096);
  const baseURL = env.MODEL_BASE_URL || undefined;
  const timeoutMs = Number(env.MODEL_TIMEOUT_MS || 60_000);
  switch (provider) {
    case "anthropic": {
      const apiKey = env.MODEL_API_KEY || env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error("MODEL_API_KEY (or ANTHROPIC_API_KEY) is not set");
      registerSecret(apiKey);
      const effort = env.MODEL_EFFORT as "low" | "medium" | "high" | "xhigh" | "max" | undefined;
      return new AnthropicAdapter({ apiKey, model: env.MODEL_NAME || "claude-opus-5-5", maxTokens, effort: effort || undefined, baseURL, timeoutMs });
    }
    case "openai": {
      const apiKey = env.MODEL_API_KEY || env.OPENAI_API_KEY;
      if (!apiKey) throw new Error("MODEL_API_KEY (or OPENAI_API_KEY) is not set");
      if (!env.MODEL_NAME) throw new Error("MODEL_NAME is required for MODEL_PROVIDER=openai");
      registerSecret(apiKey);
      return new OpenAIAdapter({ apiKey, model: env.MODEL_NAME, maxTokens, baseURL, timeoutMs });
    }
    case "fake":
      return new FakeAdapter();
    default:
      throw new Error(`unknown MODEL_PROVIDER: ${provider}`);
  }
}

/**
 * Build an adapter from a "provider/model" spec (e.g. "anthropic/claude-opus-5-5", "openai/gpt-x", "fake").
 * The key comes from the provider's own variable (ANTHROPIC_API_KEY, OPENAI_API_KEY); MODEL_API_KEY is
 * used only when the spec's provider is MODEL_PROVIDER, so one provider's key is never sent to another.
 */
export function modelFromSpec(spec: string, env: NodeJS.ProcessEnv = process.env): ModelAdapter {
  const slash = spec.indexOf("/");
  const provider = (slash < 0 ? spec : spec.slice(0, slash)).toLowerCase();
  const name = slash < 0 ? "" : spec.slice(slash + 1);
  const own = env[`${provider.toUpperCase()}_API_KEY`];
  const shared = (env.MODEL_PROVIDER || "anthropic").toLowerCase() === provider ? env.MODEL_API_KEY : undefined;
  return modelFromEnv({
    ...env,
    MODEL_PROVIDER: provider,
    MODEL_NAME: name || (provider === env.MODEL_PROVIDER ? env.MODEL_NAME : ""),
    MODEL_API_KEY: own || shared || "",
    ANTHROPIC_API_KEY: provider === "anthropic" ? own || shared : undefined,
    OPENAI_API_KEY: provider === "openai" ? own || shared : undefined,
  });
}

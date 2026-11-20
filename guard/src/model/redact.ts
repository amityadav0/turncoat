// Keeps API keys out of logs, stored transcripts and HTTP responses.
const secrets = new Set<string>();

export function registerSecret(value: string | undefined): void {
  if (value && value.length >= 8) secrets.add(value);
}

export function redact(text: string): string {
  let out = text;
  for (const s of secrets) out = out.split(s).join("[redacted]");
  // Common key shapes, in case a provider echoes one we were not told about.
  return out.replace(/\b(sk-[A-Za-z0-9_-]{8,}|sk-ant-[A-Za-z0-9_-]{8,})\b/g, "[redacted]");
}

/** A safe, credential-free error for anything that leaves the process. */
export function safeError(err: unknown): Error {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const e = new Error(redact(msg));
  (e as Error & { status?: number }).status = (err as { status?: number })?.status;
  return e;
}

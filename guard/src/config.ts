// All configuration comes from env. See guard/.env.example.
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Hex, Address } from "viem";

const here = path.dirname(fileURLToPath(import.meta.url));
export const GUARD_ROOT = path.resolve(here, "..");

function req(env: NodeJS.ProcessEnv, k: string): string {
  const v = env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
}
const int = (v: string | undefined, d: number) => (v === undefined || v === "" ? d : Number.parseInt(v, 10));

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const trust = env.TRUST_PROXY;
  return {
    port: int(env.PORT, 8787),
    host: env.HOST || "127.0.0.1",
    rpcUrl: req(env, "RPC_URL"),
    chainId: Number(req(env, "CHAIN_ID")),
    contract: req(env, "TURNCOAT_ADDRESS") as Address,
    guardSignerKey: req(env, "GUARD_SIGNER_PRIVATE_KEY") as Hex,
    relayerKey: (env.RELAYER_PRIVATE_KEY || undefined) as Hex | undefined,
    dbPath: path.resolve(GUARD_ROOT, env.DB_PATH || "data/guard.sqlite"),
    commitsDir: path.resolve(GUARD_ROOT, env.COMMITS_DIR || ".secrets/commits"),
    /** Instruction version practice mode runs (v1 | v2 | v3). Live rounds run whatever their guardCommit commits to. */
    guardVersion: env.GUARD_VERSION || "v1",
    /** Guard mode practice mode runs (refuse | decide). Live rounds run whatever their commit record says. */
    guardMode: env.GUARD_MODE || "refuse",
    messageWindowSec: int(env.MESSAGE_WINDOW_SECONDS, 180),
    pollMs: int(env.QUEUE_POLL_MS, 5000),
    retryBaseMs: int(env.MODEL_RETRY_BASE_MS, 5000),
    attemptWaitMs: int(env.ATTEMPT_WAIT_MS, 60000),
    maxTurns: int(env.MAX_TOOL_TURNS, 6),
    tokenDecimals: int(env.TOKEN_DECIMALS, 18),
    practicePerIp: int(env.PRACTICE_RATE_LIMIT, 10),
    practiceWindowSec: int(env.PRACTICE_RATE_WINDOW_SECONDS, 3600),
    practiceDailyCap: int(env.PRACTICE_DAILY_CAP, 2000),
    corsOrigins: (env.CORS_ORIGINS || "").split(",").map((x) => x.trim()).filter(Boolean),
    logsFromBlock: BigInt(env.LOGS_FROM_BLOCK || 0),
    trustProxy: trust === undefined || trust === "" ? undefined : /^\d+$/.test(trust) ? Number(trust) : trust === "true" ? true : trust === "false" ? false : trust,
  };
}
export type Config = ReturnType<typeof loadConfig>;

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
    /** Model failures in a row on one attempt before it is marked failed (not judged) and the queue moves on. */
    maxModelFailures: int(env.MODEL_MAX_FAILURES, 8),
    /** /health returns 503 when the oldest queued attempt has waited longer than this. */
    healthMaxQueueAgeSec: int(env.HEALTH_MAX_QUEUE_AGE_SECONDS, 300),
    tokenDecimals: int(env.TOKEN_DECIMALS, 18),
    practicePerIp: int(env.PRACTICE_RATE_LIMIT, 10),
    practiceWindowSec: int(env.PRACTICE_RATE_WINDOW_SECONDS, 3600),
    practiceDailyCap: int(env.PRACTICE_DAILY_CAP, 2000),
    /** Every GET except /health, per client IP (IPv6: per /64). */
    readPerIp: int(env.READ_RATE_LIMIT, 300),
    readWindowSec: int(env.READ_RATE_WINDOW_SECONDS, 60),
    /** POST /attempts per client IP. Each Agent ID gets one free attempt a day; this only stops floods. */
    attemptPerIp: int(env.ATTEMPT_RATE_LIMIT, 20),
    attemptWindowSec: int(env.ATTEMPT_RATE_WINDOW_SECONDS, 600),
    /** How long round and attacker views are cached in memory (ms). 0 = off. */
    readCacheMs: int(env.READ_CACHE_MS, 3000),
    corsOrigins: (env.CORS_ORIGINS || "").split(",").map((x) => x.trim()).filter(Boolean),
    /** Optional: read events with eth_getLogs (needs an RPC that serves it; public BSC endpoints do not). */
    useLogs: env.USE_LOGS === "1" || env.USE_LOGS === "true",
    /** First block the log scanner reads (the deploy block). */
    logsFromBlock: BigInt(env.LOGS_FROM_BLOCK || 0),
    logChunkBlocks: int(env.LOG_CHUNK_BLOCKS, 5000),
    logScanIntervalMs: int(env.LOG_SCAN_INTERVAL_MS, 15000),
    trustProxy: trust === undefined || trust === "" ? undefined : /^\d+$/.test(trust) ? Number(trust) : trust === "true" ? true : trust === "false" ? false : trust,
  };
}
export type Config = ReturnType<typeof loadConfig>;

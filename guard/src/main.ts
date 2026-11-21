// Entry point: `npm start` (reads guard/.env if present).
import fs from "node:fs";
import path from "node:path";
import { http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig, GUARD_ROOT, loadGuardEnv } from "./config.ts";
import { modelFromEnv } from "./model/index.ts";
import { registerSecret } from "./model/redact.ts";
import { Store } from "./db.ts";
import { TurncoatChain } from "./chain.ts";
import { CommitBook } from "./commit.ts";
import { RoundProcessor, checkRoundSigners } from "./processor.ts";
import { LogScanner } from "./recorder.ts";
import { GuardService } from "./service.ts";
import { RateLimiter } from "./ratelimit.ts";
import { createApp } from "./server.ts";
import { consoleLogger as log } from "./log.ts";
import { resolveVersion, resolveMode, levelBytes } from "./levels.ts";

loadGuardEnv();

const cfg = loadConfig();
registerSecret(cfg.guardSignerKey);
registerSecret(cfg.relayerKey);
const model = modelFromEnv();
const signer = privateKeyToAccount(cfg.guardSignerKey);
const chain = new TurncoatChain({ transport: http(cfg.rpcUrl), chainId: cfg.chainId, address: cfg.contract, relayerKey: cfg.relayerKey, logsFromBlock: cfg.logsFromBlock });

const onChainId = await chain.pub.getChainId();
if (onChainId !== cfg.chainId) throw new Error(`RPC is on chain ${onChainId}, CHAIN_ID says ${cfg.chainId}`);
// Each round keeps the signer it opened with (roundSigner). Serve the unfinished rounds whose signer is
// this key; refuse to start only if there are unfinished rounds and none of them is ours.
const signers = await checkRoundSigners(chain, signer.address, log);
if (signers.skipped.length && !signers.served.length) {
  throw new Error(`GUARD_SIGNER_PRIVATE_KEY is for ${signer.address}, which is not the signer of any unfinished round (${signers.skipped.map((s) => `round ${s.roundId}: ${s.signer}`).join(", ")})`);
}
const currentSigner = await chain.guardSigner();
if (currentSigner.toLowerCase() !== signer.address.toLowerCase()) {
  log("warn", "this key is not the contract's current guardSigner: rounds opened from now on will not be served by this service", { guardSigner: currentSigner, thisSigner: signer.address });
}

const commits = new CommitBook(cfg.commitsDir);
const store = new Store(cfg.dbPath);
const proc = new RoundProcessor({
  store, chain, model, commits, signer, log,
  cfg: { maxModelFailures: cfg.maxModelFailures, messageWindowSec: cfg.messageWindowSec, pollMs: cfg.pollMs, retryBaseMs: cfg.retryBaseMs, maxTurns: cfg.maxTurns, tokenDecimals: cfg.tokenDecimals },
});
const service = new GuardService(store, chain, proc, { modelId: model.id, readCacheMs: cfg.readCacheMs, maxQueueAgeSec: cfg.healthMaxQueueAgeSec, messageWindowSec: cfg.messageWindowSec, attemptWaitMs: cfg.attemptWaitMs, tokenDecimals: cfg.tokenDecimals }, commits);
const guardVersion = resolveVersion(cfg.guardVersion);
const guardMode = resolveMode(cfg.guardMode);
const practiceLevels = new Map([[1, { mode: guardMode, instructions: new TextDecoder().decode(levelBytes(1, guardVersion, undefined, guardMode)) }]]);
const app = createApp({
  service, model, practiceLevels, maxTurns: cfg.maxTurns, trustProxy: cfg.trustProxy, corsOrigins: cfg.corsOrigins, log,
  practiceLimiter: new RateLimiter(cfg.practicePerIp, cfg.practiceWindowSec * 1000, cfg.practiceDailyCap, 86_400_000),
  readLimiter: new RateLimiter(cfg.readPerIp, cfg.readWindowSec * 1000, 0, 86_400_000),
  attemptLimiter: new RateLimiter(cfg.attemptPerIp, cfg.attemptWindowSec * 1000, 0, 86_400_000),
});

proc.resume();
// Optional event scanning; the service works fully without it (receipts + `npm run record`).
const scanner = cfg.useLogs ? new LogScanner(store, chain, { chunk: cfg.logChunkBlocks, intervalMs: cfg.logScanIntervalMs, log }) : null;
scanner?.start();
app.listen(cfg.port, cfg.host, () => {
  log("info", "guard service listening", {
    url: `http://${cfg.host}:${cfg.port}`, model: model.id, contract: chain.address, chainId: cfg.chainId,
    signer: signer.address, servedRounds: signers.served, skippedRounds: signers.skipped, relayer: chain.relayerAddress ?? null, commitsLoaded: commits.size,
    commits: [...commits.values()].map((c) => ({ commit: c.commit, level: c.level, version: c.version ?? null, mode: c.mode ?? "refuse", model: c.model ?? null })), trustProxy: cfg.trustProxy ?? null, useLogs: cfg.useLogs, practiceVersion: guardVersion, practiceMode: guardMode,
  });
});

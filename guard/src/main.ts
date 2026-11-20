// Entry point: `npm start` (reads guard/.env if present).
import fs from "node:fs";
import path from "node:path";
import { http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig, GUARD_ROOT } from "./config.ts";
import { modelFromEnv } from "./model/index.ts";
import { registerSecret } from "./model/redact.ts";
import { Store } from "./db.ts";
import { TurncoatChain } from "./chain.ts";
import { CommitBook } from "./commit.ts";
import { RoundProcessor } from "./processor.ts";
import { GuardService } from "./service.ts";
import { RateLimiter } from "./ratelimit.ts";
import { createApp } from "./server.ts";
import { consoleLogger as log } from "./log.ts";
import { resolveVersion, resolveMode, levelBytes } from "./levels.ts";

const envFile = path.join(GUARD_ROOT, ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const cfg = loadConfig();
registerSecret(cfg.guardSignerKey);
registerSecret(cfg.relayerKey);
const model = modelFromEnv();
const signer = privateKeyToAccount(cfg.guardSignerKey);
const chain = new TurncoatChain({ transport: http(cfg.rpcUrl), chainId: cfg.chainId, address: cfg.contract, relayerKey: cfg.relayerKey, logsFromBlock: cfg.logsFromBlock });

const onChainId = await chain.pub.getChainId();
if (onChainId !== cfg.chainId) throw new Error(`RPC is on chain ${onChainId}, CHAIN_ID says ${cfg.chainId}`);
const expected = await chain.guardSigner();
if (expected.toLowerCase() !== signer.address.toLowerCase()) {
  throw new Error(`GUARD_SIGNER_PRIVATE_KEY is for ${signer.address}, but the contract's guardSigner is ${expected}`);
}

const commits = new CommitBook(cfg.commitsDir);
const store = new Store(cfg.dbPath);
const proc = new RoundProcessor({
  store, chain, model, commits, signer, log,
  cfg: { messageWindowSec: cfg.messageWindowSec, pollMs: cfg.pollMs, retryBaseMs: cfg.retryBaseMs, maxTurns: cfg.maxTurns, tokenDecimals: cfg.tokenDecimals },
});
const service = new GuardService(store, chain, proc, { modelId: model.id, messageWindowSec: cfg.messageWindowSec, attemptWaitMs: cfg.attemptWaitMs, tokenDecimals: cfg.tokenDecimals }, commits);
const guardVersion = resolveVersion(cfg.guardVersion);
const guardMode = resolveMode(cfg.guardMode);
const practiceLevels = new Map([[1, { mode: guardMode, instructions: new TextDecoder().decode(levelBytes(1, guardVersion, undefined, guardMode)) }]]);
const app = createApp({
  service, model, practiceLevels, maxTurns: cfg.maxTurns, trustProxy: cfg.trustProxy, corsOrigins: cfg.corsOrigins, log,
  practiceLimiter: new RateLimiter(cfg.practicePerIp, cfg.practiceWindowSec * 1000, cfg.practiceDailyCap, 86_400_000),
});

proc.resume();
app.listen(cfg.port, cfg.host, () => {
  log("info", "guard service listening", {
    url: `http://${cfg.host}:${cfg.port}`, model: model.id, contract: chain.address, chainId: cfg.chainId,
    signer: signer.address, relayer: chain.relayerAddress ?? null, commitsLoaded: commits.size,
    commits: [...commits.values()].map((c) => ({ commit: c.commit, level: c.level, version: c.version ?? null, mode: c.mode ?? "refuse", model: c.model ?? null })), practiceVersion: guardVersion, practiceMode: guardMode,
  });
});

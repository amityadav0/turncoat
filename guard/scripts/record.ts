// Usage: npm run record -- --round N [--open-tx 0x…] [--settle-tx 0x…] [--reveal-tx 0x…]
// Stores a round's open, settle/roll-over or reveal transaction in the guard service's database, so the
// API can show it without reading event logs (public BSC RPCs refuse eth_getLogs). Each hash is checked
// against its receipt: a successful call to TURNCOAT_ADDRESS carrying the expected event for this round.
// Pass the hashes that scripts/open-round.mjs and scripts/round-tools.mjs print. Reads RPC_URL, CHAIN_ID,
// TURNCOAT_ADDRESS and DB_PATH from env or guard/.env; needs no key. Safe to run while the service runs.
// In Docker: docker compose exec guard npm run record -- --round 1 --open-tx 0x…
import fs from "node:fs";
import path from "node:path";
import { http, type Address, type Hex } from "viem";
import { GUARD_ROOT, loadGuardEnv } from "../src/config.ts";
import { TurncoatChain } from "../src/chain.ts";
import { Store } from "../src/db.ts";
import { recordTx, type TxKind } from "../src/recorder.ts";

loadGuardEnv();
const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const round = Number(flag("--round"));
const txs: [TxKind, string | undefined][] = [["open", flag("--open-tx")], ["settle", flag("--settle-tx")], ["reveal", flag("--reveal-tx")]];
const fail = (m: string) => { console.error(m); process.exit(2); };
if (args.length) fail(`unexpected arguments: ${args.join(" ")}`);
if (!Number.isSafeInteger(round) || round < 1) fail("--round N is required");
if (!txs.some(([, t]) => t)) fail("pass at least one of --open-tx, --settle-tx, --reveal-tx");
for (const [k, t] of txs) if (t && !/^0x[0-9a-fA-F]{64}$/.test(t)) fail(`--${k}-tx must be a 32-byte transaction hash`);
for (const k of ["RPC_URL", "CHAIN_ID", "TURNCOAT_ADDRESS"]) if (!process.env[k]) fail(`${k} is not set`);

const chain = new TurncoatChain({ transport: http(process.env.RPC_URL), chainId: Number(process.env.CHAIN_ID), address: process.env.TURNCOAT_ADDRESS as Address });
const store = new Store(path.resolve(GUARD_ROOT, process.env.DB_PATH || "data/guard.sqlite"));
let bad = 0;
for (const [kind, tx] of txs) {
  if (!tx) continue;
  try {
    for (const line of await recordTx(store, chain, round, tx as Hex, kind)) console.log(`recorded: ${line}`);
  } catch (e) {
    bad++;
    console.error(`not recorded (${kind}): ${(e as Error).message}`);
  }
}
store.close();
process.exit(bad ? 1 : 0);

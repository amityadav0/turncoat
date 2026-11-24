#!/usr/bin/env node
// Creates the three fresh mainnet keys and the server's env file, and prints ADDRESSES ONLY.
//
//   node scripts/mainnet-keys.mjs [--rpc https://bsc-dataseed.bnbchain.org] [--cors https://your-site]
//
// - Deployer (owner) key → DEPLOYER_PRIVATE_KEY in the gitignored .env.mainnet at the repo root (600).
//   It stays on this machine. Fund its address with BNB for gas and the USDT for the two pots.
// - Guard signer and relayer keys → guard/.env.server (gitignored, 600), built from guard/.env.example
//   with the mainnet values filled in. Fund the relayer address with about 0.005 BNB. The signer needs nothing.
//
// Never overwrites: if a key is already present it is kept, so running it twice is safe.
// Keys are written to files only; nothing here prints, logs or sends one.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : d; };
const RPC = opt("rpc", "https://bsc-dataseed.bnbchain.org");
const CORS = opt("cors", "");

const readEnv = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "");
const getVar = (text, k) => (text.match(new RegExp(`^${k}=(0x[0-9a-fA-F]{64})\\s*$`, "m")) || [])[1];
function setVar(text, k, v) {
  const line = `${k}=${v}`;
  return new RegExp(`^${k}=.*$`, "m").test(text) ? text.replace(new RegExp(`^${k}=.*$`, "m"), line) : text + (text.endsWith("\n") || !text ? "" : "\n") + line + "\n";
}
const write600 = (file, text) => { fs.writeFileSync(file, text, { mode: 0o600 }); fs.chmodSync(file, 0o600); };

// Deployer
const deployFile = path.join(ROOT, ".env.mainnet");
let dep = readEnv(deployFile);
let deployerKey = getVar(dep, "DEPLOYER_PRIVATE_KEY");
if (!deployerKey) { deployerKey = generatePrivateKey(); dep = setVar(dep, "DEPLOYER_PRIVATE_KEY", deployerKey); write600(deployFile, dep); }

// Server env
const serverFile = path.join(ROOT, "guard/.env.server");
let srv = readEnv(serverFile) || readEnv(path.join(ROOT, "guard/.env.example"));
let signerKey = getVar(srv, "GUARD_SIGNER_PRIVATE_KEY");
let relayerKey = getVar(srv, "RELAYER_PRIVATE_KEY");
if (!signerKey) { signerKey = generatePrivateKey(); srv = setVar(srv, "GUARD_SIGNER_PRIVATE_KEY", signerKey); }
if (!relayerKey) { relayerKey = generatePrivateKey(); srv = setVar(srv, "RELAYER_PRIVATE_KEY", relayerKey); }
const fixed = { MODEL_PROVIDER: "anthropic", MODEL_NAME: "claude-haiku-5-5", RPC_URL: RPC, CHAIN_ID: "56", TOKEN_DECIMALS: "18", USE_LOGS: "0",
  GUARD_VERSION: "v2", GUARD_MODE: "decide", PORT: "8787", HOST: "127.0.0.1", TRUST_PROXY: "1", DB_PATH: "data/guard.sqlite", COMMITS_DIR: ".secrets/commits" };
for (const [k, v] of Object.entries(fixed)) srv = setVar(srv, k, v);
if (CORS) srv = setVar(srv, "CORS_ORIGINS", CORS);
const dj = path.join(ROOT, "deployments/bsc.json");
if (fs.existsSync(dj)) {
  const d = JSON.parse(fs.readFileSync(dj, "utf8"));
  if (d.turncoat) srv = setVar(srv, "TURNCOAT_ADDRESS", d.turncoat);
  if (d.deployBlock !== undefined) srv = setVar(srv, "LOGS_FROM_BLOCK", String(d.deployBlock));
}
write600(serverFile, srv);

const addr = (k) => privateKeyToAccount(k).address;
const missing = [];
if (!/^MODEL_API_KEY=\S+/m.test(srv) && !/^ANTHROPIC_API_KEY=\S+/m.test(srv)) missing.push("MODEL_API_KEY (your Anthropic key)");
if (/^TURNCOAT_ADDRESS=0x0{40}\s*$/m.test(srv) || !/^TURNCOAT_ADDRESS=0x[0-9a-fA-F]{40}/m.test(srv)) missing.push("TURNCOAT_ADDRESS (re-run this script after the deploy; it reads deployments/bsc.json)");
if (!/^CORS_ORIGINS=\S+/m.test(srv)) missing.push("CORS_ORIGINS (your site's origin; re-run with --cors https://… once you know it)");

console.log(`Keys are in .env.mainnet (deployer) and guard/.env.server (signer, relayer). Both are gitignored and mode 600.

  deployer  ${addr(deployerKey)}   fund with BNB for gas (about 0.01) and the USDT for both pots
  signer    ${addr(signerKey)}   needs nothing
  relayer   ${addr(relayerKey)}   fund with about 0.005 BNB

Load the deployer key into this terminal before the launch commands:
  set -a && . ./.env.mainnet && set +a
`);
if (missing.length) console.log("Still to fill in guard/.env.server:\n" + missing.map((m) => "  - " + m).join("\n"));

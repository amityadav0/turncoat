// Shared helpers for the round scripts: clients from env, ABI loading, the contract address.
import fs from "node:fs";
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const art = (n) => JSON.parse(fs.readFileSync(new URL(`../build/${n}.json`, import.meta.url)));

export function args() {
  const a = process.argv.slice(2);
  const flags = {};
  const pos = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith("--")) {
      const k = a[i].slice(2);
      if (i + 1 < a.length && !a[i + 1].startsWith("--")) flags[k] = a[++i];
      else flags[k] = true;
    } else pos.push(a[i]);
  }
  return { flags, pos };
}

/**
 * `--network testnet`: BSC testnet (chain 97). The RPC defaults to the public testnet endpoint, the
 * contract address comes from deployments/bsc-testnet.json, and the TESTNET_* keys are read from the
 * gitignored .env.deploy (never printed). Without the flag nothing changes: mainnet keys come only from
 * the environment, and chain 56 still needs --confirm-mainnet.
 */
export const TESTNET = { chainId: 97, rpc: "https://bsc-testnet.bnbchain.org", deployFile: "../deployments/bsc-testnet.json", explorer: "https://testnet.bscscan.com" };
export function isTestnet() {
  const a = process.argv.slice(2);
  const i = a.indexOf("--network");
  if (i < 0) return false;
  if (a[i + 1] !== "testnet") { console.error(`--network supports only "testnet" (got ${a[i + 1]})`); process.exit(2); }
  return true;
}
/** Loads only TESTNET_* variables from .env.deploy (the mainnet deployer key there is never touched). */
export function loadTestnetKeys() {
  const f = new URL("../.env.deploy", import.meta.url);
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    const m = /^(TESTNET_[A-Z0-9_]+)=(\S*)/.exec(line);
    if (m && m[2] && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
export function explorerTx(chainId, hash) {
  const base = { 56: "https://bscscan.com", 97: TESTNET.explorer }[chainId];
  return base ? `${base}/tx/${hash}` : null;
}

/** RPC_URL (default: public BSC, or public BSC testnet with --network testnet). The chain id is read from the node. */
export async function clients(keyEnv = ["OWNER_PRIVATE_KEY", "DEPLOYER_PRIVATE_KEY"]) {
  const testnet = isTestnet();
  if (testnet) { loadTestnetKeys(); keyEnv = [...keyEnv.filter((k) => k === "SENDER_PRIVATE_KEY"), "TESTNET_DEPLOYER_PRIVATE_KEY"]; }
  const rpc = process.env.RPC_URL || (testnet ? TESTNET.rpc : "https://bsc-dataseed.bnbchain.org");
  const probe = createPublicClient({ transport: http(rpc) });
  const id = await probe.getChainId();
  if (testnet && id !== TESTNET.chainId) { console.error(`--network testnet but the RPC is on chain ${id}; nothing was sent`); process.exit(1); }
  const chain = defineChain({ id, name: `chain-${id}`, nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
  const pub = createPublicClient({ chain, transport: http(rpc), pollingInterval: 500 });
  const key = keyEnv.map((k) => process.env[k]).find(Boolean);
  const account = key ? privateKeyToAccount(key) : undefined;
  const wallet = account ? createWalletClient({ account, chain, transport: http(rpc) }) : undefined;
  return { pub, wallet, account, chainId: id, rpc };
}

export function turncoatAddress() {
  if (process.env.TURNCOAT_ADDRESS) return process.env.TURNCOAT_ADDRESS;
  const f = new URL(isTestnet() ? TESTNET.deployFile : "../deployments/bsc.json", import.meta.url);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f)).turncoat;
  throw new Error(`set TURNCOAT_ADDRESS (or deploy first so ${isTestnet() ? "deployments/bsc-testnet.json" : "deployments/bsc.json"} exists)`);
}

export async function sendAndWait(pub, wallet, req, label) {
  const hash = await wallet.writeContract(req);
  const link = explorerTx(wallet.chain?.id, hash);
  console.log(`${label}: tx ${hash}${link ? `  ${link}` : ""}`);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${label} reverted (tx ${hash})`);
  return r;
}

/** Refuse to write to BSC mainnet (chain 56) unless --confirm-mainnet is passed. */
export function mainnetGuard(chainId, flags) {
  if (chainId === 56 && !flags["confirm-mainnet"]) {
    console.error("This RPC is BSC mainnet (chain 56). Nothing was sent. Re-run with --confirm-mainnet to send for real.");
    process.exit(1);
  }
}

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

/** RPC_URL (default: public BSC). The chain id is read from the node, so the same script works locally. */
export async function clients(keyEnv = ["OWNER_PRIVATE_KEY", "DEPLOYER_PRIVATE_KEY"]) {
  const rpc = process.env.RPC_URL || "https://bsc-dataseed.bnbchain.org";
  const probe = createPublicClient({ transport: http(rpc) });
  const id = await probe.getChainId();
  const chain = defineChain({ id, name: `chain-${id}`, nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
  const pub = createPublicClient({ chain, transport: http(rpc), pollingInterval: 500 });
  const key = keyEnv.map((k) => process.env[k]).find(Boolean);
  const account = key ? privateKeyToAccount(key) : undefined;
  const wallet = account ? createWalletClient({ account, chain, transport: http(rpc) }) : undefined;
  return { pub, wallet, account, chainId: id, rpc };
}

export function turncoatAddress() {
  if (process.env.TURNCOAT_ADDRESS) return process.env.TURNCOAT_ADDRESS;
  const f = new URL("../deployments/bsc.json", import.meta.url);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f)).turncoat;
  throw new Error("set TURNCOAT_ADDRESS (or deploy first so deployments/bsc.json exists)");
}

export async function sendAndWait(pub, wallet, req, label) {
  const hash = await wallet.writeContract(req);
  console.log(`${label}: tx ${hash}`);
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

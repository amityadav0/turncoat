// Deploy Turncoat to BNB Smart Chain.
// Env: DEPLOYER_PRIVATE_KEY, GUARD_SIGNER_ADDRESS, RPC_URL (default public BSC RPC)
// Writes deployments/bsc.json and prints the BscScan verification inputs.
import fs from "node:fs";
import { createPublicClient, createWalletClient, http, encodeAbiParameters } from "viem";
import { bsc } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const AGENT_ID = "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F"; // SPACE ID Agent ID (ERC-721, non-transferable)
const USDT = "0x55d398326f99059fF775485246999027B3197955"; // BSC-USD (18 decimals)

const { DEPLOYER_PRIVATE_KEY, GUARD_SIGNER_ADDRESS, RPC_URL = "https://bsc-dataseed.bnbchain.org" } = process.env;
if (!DEPLOYER_PRIVATE_KEY || !GUARD_SIGNER_ADDRESS) { console.error("set DEPLOYER_PRIVATE_KEY and GUARD_SIGNER_ADDRESS"); process.exit(1); }

const { abi, bytecode } = JSON.parse(fs.readFileSync(new URL("../build/Turncoat.json", import.meta.url)));
const account = privateKeyToAccount(DEPLOYER_PRIVATE_KEY);
const pub = createPublicClient({ chain: bsc, transport: http(RPC_URL) });
const wallet = createWalletClient({ account, chain: bsc, transport: http(RPC_URL) });

const args = [AGENT_ID, USDT, GUARD_SIGNER_ADDRESS];
console.log("deploying from", account.address, "args", args);
const hash = await wallet.deployContract({ abi, bytecode, args });
const r = await pub.waitForTransactionReceipt({ hash });
const out = { chainId: 56, turncoat: r.contractAddress, agentId: AGENT_ID, usdt: USDT, guardSigner: GUARD_SIGNER_ADDRESS, deployBlock: Number(r.blockNumber), tx: hash };
fs.mkdirSync(new URL("../deployments/", import.meta.url), { recursive: true });
fs.writeFileSync(new URL("../deployments/bsc.json", import.meta.url), JSON.stringify(out, null, 2));
console.log(out);
console.log("constructor args (abi-encoded, for BscScan):",
  encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "address" }], args).slice(2));
console.log("verify: node scripts/verify-input.mjs > turncoat-standard-input.json, then BscScan → Verify → Solidity (Standard-Json-Input), compiler v0.8.28");

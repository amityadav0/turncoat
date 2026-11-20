// Rehearsal only: deploy Turncoat with MOCK Agent ID and MOCK USDT to a local chain (refuses chain 56).
// Env: RPC_URL (default http://127.0.0.1:8545), DEPLOYER_PRIVATE_KEY, GUARD_SIGNER_ADDRESS
// Usage: node scripts/deploy-local.mjs [--mint 1000] [--agent-id 0xaddr,0xaddr]
//   --mint: mock USDT minted to the deployer. --agent-id: addresses given a mock Agent ID.
import { parseUnits } from "viem";
import { art, args, clients } from "./lib.mjs";

process.env.RPC_URL ||= "http://127.0.0.1:8545";
const { flags } = args();
const { pub, wallet, account, chainId } = await clients(["DEPLOYER_PRIVATE_KEY"]);
if (chainId === 56 || chainId === 97) { console.error("deploy-local is for local chains only; use scripts/deploy.mjs for BSC"); process.exit(1); }
if (!wallet || !process.env.GUARD_SIGNER_ADDRESS) { console.error("set DEPLOYER_PRIVATE_KEY and GUARD_SIGNER_ADDRESS"); process.exit(2); }
const deploy = async (name, a = []) => (await pub.waitForTransactionReceipt({ hash: await wallet.deployContract({ ...art(name), args: a }) })).contractAddress;
const send = async (address, name, functionName, a) => { const r = await pub.waitForTransactionReceipt({ hash: await wallet.writeContract({ address, abi: art(name).abi, functionName, args: a }) }); if (r.status !== "success") throw new Error(functionName); };
const agentId = await deploy("MockAgentID");
const usdt = await deploy("MockUSDT");
const turncoat = await deploy("Turncoat", [agentId, usdt, process.env.GUARD_SIGNER_ADDRESS]);
await send(usdt, "MockUSDT", "mint", [account.address, parseUnits(String(flags.mint ?? 1000), 18)]);
for (const a of String(flags["agent-id"] ?? "").split(",").filter(Boolean)) await send(agentId, "MockAgentID", "set", [a, 1n]);
console.log(JSON.stringify({ chainId, turncoat, agentId, usdt, guardSigner: process.env.GUARD_SIGNER_ADDRESS }, null, 2));

// BSC testnet (chain 97) only: deploy MockAgentID, MockUSDT and Turncoat, then set up the test accounts.
// Keys: TESTNET_* in the gitignored .env.deploy (create them with scripts/testnet-keys.mjs; never printed).
// RPC_URL defaults to the public testnet endpoint. Refuses any chain id other than 97.
// Usage:
//   node scripts/deploy-testnet.mjs            deploy (refuses if deployments/bsc-testnet.json exists; --redeploy to replace)
//   node scripts/deploy-testnet.mjs --setup    only fund/mint/register the test accounts again (top-up)
// Setup: from the deployer, send tBNB for gas to the relayer (0.02), each attacker (0.01) and the
// non-holder (0.005) if they hold less; mint 1000 mock USDT to the deployer and 100 to each attacker;
// give each attacker a mock Agent ID (the non-holder gets none). The signer holds nothing.
// Writes deployments/bsc-testnet.json. Explorer: https://testnet.bscscan.com
import fs from "node:fs";
import { createPublicClient, createWalletClient, defineChain, http, parseEther, parseUnits, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { art, args, loadTestnetKeys, TESTNET, explorerTx } from "./lib.mjs";

const { flags } = args();
loadTestnetKeys();
const key = (r) => process.env[`TESTNET_${r}_PRIVATE_KEY`];
const roles = ["DEPLOYER", "SIGNER", "RELAYER", "ATTACKER1", "ATTACKER2", "ATTACKER3", "NONHOLDER"];
const missing = roles.filter((r) => !key(r));
if (missing.length) { console.error(`missing TESTNET_${missing[0]}_PRIVATE_KEY in .env.deploy: run node scripts/testnet-keys.mjs first`); process.exit(2); }
const acct = Object.fromEntries(roles.map((r) => [r, privateKeyToAccount(key(r))]));
const rpc = process.env.RPC_URL || TESTNET.rpc;
const probe = createPublicClient({ transport: http(rpc) });
const chainId = await probe.getChainId();
if (chainId !== 97) { console.error(`deploy-testnet refuses chain ${chainId}: BSC testnet (97) only. Nothing was sent.`); process.exit(1); }
const chain = defineChain({ id: 97, name: "bsc-testnet", nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const pub = createPublicClient({ chain, transport: http(rpc), pollingInterval: 1000 });
const wallet = createWalletClient({ account: acct.DEPLOYER, chain, transport: http(rpc) });
const out = new URL("../deployments/bsc-testnet.json", import.meta.url);
const log = (label, hash) => console.log(`${label}: tx ${hash}  ${explorerTx(97, hash)}`);
const wait = async (label, hash) => { log(label, hash); const r = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 }); if (r.status !== "success") throw new Error(`${label} reverted`); return r; };

const bal = await pub.getBalance({ address: acct.DEPLOYER.address });
console.log(`chain 97, deployer ${acct.DEPLOYER.address}, balance ${formatEther(bal)} tBNB`);

let d;
if (!flags.setup) {
  if (fs.existsSync(out) && !flags.redeploy) { console.error("deployments/bsc-testnet.json exists; pass --redeploy to deploy a new contract, or --setup to top up accounts"); process.exit(1); }
  const deploy = async (name, a = []) => (await wait(`deploy ${name}`, await wallet.deployContract({ ...art(name), args: a }))).contractAddress;
  const agentId = await deploy("MockAgentID");
  const usdt = await deploy("MockUSDT");
  const r = await wait("deploy Turncoat", await wallet.deployContract({ ...art("Turncoat"), args: [agentId, usdt, acct.SIGNER.address] }));
  d = {
    chainId: 97, turncoat: r.contractAddress, agentId, usdt, deployBlock: Number(r.blockNumber), tx: r.transactionHash,
    owner: acct.DEPLOYER.address, guardSigner: acct.SIGNER.address, relayer: acct.RELAYER.address,
    attackers: [acct.ATTACKER1.address, acct.ATTACKER2.address, acct.ATTACKER3.address], nonHolder: acct.NONHOLDER.address,
    note: "TEST NETWORK: MockAgentID and MockUSDT, worthless. Explorer https://testnet.bscscan.com",
  };
  fs.mkdirSync(new URL("../deployments/", import.meta.url), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(d, null, 2) + "\n");
} else {
  d = JSON.parse(fs.readFileSync(out, "utf8"));
}

// read back what the contract holds
const T = { address: d.turncoat, abi: art("Turncoat").abi };
const rb = await Promise.all(["owner", "guardSigner", "token", "agentId"].map((f) => pub.readContract({ ...T, functionName: f })));
const want = [d.owner, d.guardSigner, d.usdt, d.agentId];
rb.forEach((v, i) => { if (v.toLowerCase() !== want[i].toLowerCase()) { console.error(`read-back mismatch: ${["owner", "guardSigner", "token", "agentId"][i]} is ${v}, expected ${want[i]}`); process.exit(1); } });
console.log(`read back: owner ${rb[0]}, guardSigner ${rb[1]}, token ${rb[2]}, agentId ${rb[3]}: as intended`);

// setup
const topUp = async (name, to, amount) => {
  const have = await pub.getBalance({ address: to });
  if (have < amount) await wait(`fund ${name} ${formatEther(amount - have)} tBNB`, await wallet.sendTransaction({ to, value: amount - have }));
};
await topUp("relayer", d.relayer, parseEther("0.02"));
for (const [i, a] of d.attackers.entries()) await topUp(`attacker${i + 1}`, a, parseEther("0.01"));
await topUp("non-holder", d.nonHolder, parseEther("0.005"));
const U = { address: d.usdt, abi: art("MockUSDT").abi };
const A = { address: d.agentId, abi: art("MockAgentID").abi };
const send = async (label, c, fn, a) => wait(label, await wallet.writeContract({ ...c, functionName: fn, args: a }));
const usdtOf = (a) => pub.readContract({ ...U, functionName: "balanceOf", args: [a] });
if ((await usdtOf(d.owner)) < parseUnits("1000", 18)) await send("mint 1000 mock USDT to deployer", U, "mint", [d.owner, parseUnits("1000", 18)]);
for (const [i, a] of d.attackers.entries()) {
  if ((await usdtOf(a)) < parseUnits("100", 18)) await send(`mint 100 mock USDT to attacker${i + 1}`, U, "mint", [a, parseUnits("100", 18)]);
  if ((await pub.readContract({ ...A, functionName: "balanceOf", args: [a] })) === 0n) await send(`mock Agent ID for attacker${i + 1}`, A, "set", [a, 1n]);
}
console.log(JSON.stringify({ ...d, deployerBalance: `${formatEther(await pub.getBalance({ address: acct.DEPLOYER.address }))} tBNB`, contractUrl: `${TESTNET.explorer}/address/${d.turncoat}` }, null, 2));

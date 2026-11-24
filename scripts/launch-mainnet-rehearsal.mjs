// Rehearses scripts/launch-mainnet.mjs end to end on a local ganache started with chain id 56, with a
// mock Agent ID registry and mock USDT (injected with the script's test-only --test-local-mocks flag).
// Every subcommand runs as a child process, exactly as typed; the y/N prompts are answered through stdin.
// It also checks that "n" and an empty answer send nothing (nonce unchanged), that piped input is refused
// without the test flag, and that the test flag refuses a non-local RPC. Nothing leaves this machine;
// no model is called (commit-rounds only hashes files). Exits 1 if any check fails.
//
//   node scripts/launch-mainnet-rehearsal.mjs [--keep-tmp]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, defineChain, http, parseUnits, formatUnits, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "scripts/launch-mainnet.mjs");
const art = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, "build", `${n}.json`), "utf8"));
const K = (i) => keccak256(toHex(`turncoat-launch-rehearsal-${i}`)); // local test keys only
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "turncoat-launch-"));

const ganache = (await import("ganache")).default;
const gServer = ganache.server({ logging: { quiet: true }, chain: { chainId: 56, hardfork: "merge" }, wallet: { accounts: Array.from({ length: 5 }, (_, i) => ({ secretKey: K(i + 1), balance: "0x" + (10n ** 21n).toString(16) })) } });
await new Promise((r, j) => gServer.listen(0, "127.0.0.1", (e) => (e ? j(e) : r())));
const RPC = `http://127.0.0.1:${gServer.address().port}`;
const chain = defineChain({ id: 56, name: "local-56", nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: http(RPC), pollingInterval: 200 });
const [deployer, signer, relayer, attacker, stranger] = [1, 2, 3, 4, 5].map((i) => privateKeyToAccount(K(i)));
const dw = createWalletClient({ account: deployer, chain, transport: http(RPC) });

// Mocks (what --test-local-mocks stands in for): Agent ID for the attacker, 100 USDT for the deployer.
const dep = async (n) => (await pub.waitForTransactionReceipt({ hash: await dw.deployContract({ ...art(n), args: [] }) })).contractAddress;
const agentId = await dep("MockAgentID"), usdt = await dep("MockUSDT");
const tx = async (address, n, fn, args) => pub.waitForTransactionReceipt({ hash: await dw.writeContract({ address, abi: art(n).abi, functionName: fn, args }) });
await tx(usdt, "MockUSDT", "mint", [deployer.address, parseUnits("100", 18)]);
await tx(agentId, "MockAgentID", "set", [attacker.address, 1n]);

const files = { deployment: path.join(tmp, "bsc.json"), skill: path.join(tmp, "skill-deployment.json"), commits: path.join(tmp, "commits") };
fs.writeFileSync(files.skill, JSON.stringify({ api: "", contract: "", rpc: "https://bsc-dataseed.bnbchain.org", binanceChainId: "56" }, null, 2));
const TEST = ["--test-local-mocks", "--agent-id-address", agentId, "--usdt-address", usdt, "--deployment-file", files.deployment, "--skill-file", files.skill, "--commits-dir", files.commits];

const outputs = [];
/** Runs the launch script as typed, answering prompts with `input`. Async: ganache lives in this process. */
function run(args, { input = "", env = {}, test = true } = {}) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [SCRIPT, ...args, ...(test ? TEST : [])], { cwd: ROOT, env: { PATH: process.env.PATH, HOME: process.env.HOME, RPC_URL: RPC, DEPLOYER_PRIVATE_KEY: K(1), ...env } });
    let out = "";
    c.stdout.on("data", (d) => (out += d));
    c.stderr.on("data", (d) => (out += d));
    c.on("close", (code) => { outputs.push(out); resolve({ code, out }); });
    c.stdin.end(input);
  });
}

const results = [];
let failed = 0;
async function step(name, fn) {
  try { const note = await fn(); results.push(`pass  ${name}${note ? `: ${note}` : ""}`); }
  catch (e) { failed++; results.push(`FAIL  ${name}: ${e.message}`); }
}
const must = (c, m) => { if (!c) throw new Error(m); };
const nonce = () => pub.getTransactionCount({ address: deployer.address });
const T = () => ({ address: JSON.parse(fs.readFileSync(files.deployment, "utf8")).turncoat, abi: art("Turncoat").abi });

await step("test flag refuses a non-local RPC (chain id never asked)", async () => {
  const r = await run(["preflight", "--signer", signer.address], { env: { RPC_URL: "https://bsc-dataseed.bnbchain.org" } });
  must(r.code === 1 && /runs only against a local node/.test(r.out), r.out.slice(0, 200));
  return "refused, host bsc-dataseed.bnbchain.org";
});
await step("test flag refuses to write the real deployment files", async () => {
  const r = await run(["preflight", "--test-local-mocks", "--agent-id-address", agentId, "--usdt-address", usdt], { test: false });
  must(r.code === 2 && /must not write the real/.test(r.out), r.out.slice(0, 200));
});
await step("preflight finds problems (signer = deployer, Agent ID missing for a stranger, low seed)", async () => {
  const r = await run(["preflight", "--signer", deployer.address, "--relayer", relayer.address, "--agent", stranger.address, "--seed", "80"]);
  must(r.code === 1, `exit ${r.code}`);
  for (const re of [/deployer and signer are the same/, /holds no Agent ID/, /two rounds at --seed 80 need 160/]) must(re.test(r.out), `missing ${re}`);
  return "3 problems named, exit 1";
});
await step("preflight passes", async () => {
  const r = await run(["preflight", "--signer", signer.address, "--relayer", relayer.address, "--agent", attacker.address, "--seed", "10"]);
  must(r.code === 0 && /PREFLIGHT: PASS/.test(r.out), r.out.slice(-400));
  must(/holds 1 Agent ID/.test(r.out) && /not deployed yet/.test(r.out), "registry read / deployment state missing");
  return "registry read for the attacker, three distinct keys, balances, not deployed yet";
});
await step("deploy: 'n' sends nothing", async () => {
  const n0 = await nonce();
  const r = await run(["deploy", "--signer", signer.address], { input: "n\n" });
  must(r.code === 1 && /Cancelled. Nothing sent./.test(r.out), r.out.slice(-200));
  must((await nonce()) === n0 && !fs.existsSync(files.deployment), "nonce changed or file written");
  must(/About to send on chain 56/.test(r.out) && r.out.toLowerCase().includes(signer.address.toLowerCase()) && r.out.toLowerCase().includes(usdt.toLowerCase()), "plan not printed");
  return `plan printed, nonce ${n0} unchanged`;
});
await step("deploy: empty answer sends nothing", async () => {
  const n0 = await nonce();
  const r = await run(["deploy", "--signer", signer.address], { input: "\n" });
  must(r.code === 1 && (await nonce()) === n0, "sent something");
});
await step("deploy: piped 'y' is refused without the test flag (a real launch needs a terminal)", async () => {
  // Put the mocks' code at the real mainnet Agent ID and USDT addresses on this local node, so the run
  // without --test-local-mocks gets as far as the prompt. It must refuse there: stdin is not a terminal.
  for (const [real, mock] of [["0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F", agentId], ["0x55d398326f99059fF775485246999027B3197955", usdt]]) {
    await pub.request({ method: "evm_setAccountCode", params: [real, await pub.getCode({ address: mock })] });
  }
  const n0 = await nonce();
  const r = await run(["deploy", "--signer", signer.address, "--deployment-file", files.deployment], { input: "y\n", test: false });
  must(r.code === 1 && /must be typed on a terminal/.test(r.out) && /BSC MAINNET, real funds/.test(r.out), r.out.slice(-300));
  must((await nonce()) === n0 && !fs.existsSync(files.deployment), "sent something");
  return `plan printed as "BSC MAINNET, real funds", then refused; nonce ${n0} unchanged`;
});
await step("deploy: 'y' deploys and reads back", async () => {
  const r = await run(["deploy", "--signer", signer.address], { input: "y\n" });
  must(r.code === 0 && /owner, guardSigner, token, agentId match/.test(r.out), r.out.slice(-400));
  const d = JSON.parse(fs.readFileSync(files.deployment, "utf8"));
  must(d.chainId === 56 && d.guardSigner === signer.address, "deployment file");
  return `Turncoat ${d.turncoat}`;
});
await step("deploy again is refused (already deployed)", async () => {
  const r = await run(["deploy", "--signer", signer.address], { input: "y\n" });
  must(r.code === 1 && /already deployed/.test(r.out), r.out.slice(-200));
});
let commits;
await step("commit-rounds: two headered records, no model call", async () => {
  const r = await run(["commit-rounds"]);
  must(r.code === 0, r.out.slice(-300));
  const l = /lighter +(0x[0-9a-f]{64})/.exec(r.out)?.[1], t = /top +(0x[0-9a-f]{64})/.exec(r.out)?.[1];
  must(l && t, "no commits printed");
  const recs = fs.readdirSync(files.commits).map((f) => JSON.parse(fs.readFileSync(path.join(files.commits, f), "utf8")));
  must(recs.some((x) => x.commit === l && x.model === "anthropic/claude-haiku-5-5" && x.version === "v2" && x.mode === "decide"), "lighter record");
  must(recs.some((x) => x.commit === t && x.model === "anthropic/claude-opus-5-5" && x.version === "v3" && x.mode === "decide"), "top record");
  commits = { l, t };
  return `lighter ${l.slice(0, 10)}… (Haiku v2), top ${t.slice(0, 10)}… (Opus v3)`;
});
await step("open-rounds: 'n' sends nothing", async () => {
  const n0 = await nonce();
  const r = await run(["open-rounds", "--seed", "10", "--hours", "72"], { input: "n\n" });
  must(r.code === 1 && /Cancelled/.test(r.out) && (await nonce()) === n0, r.out.slice(-200));
  must(r.out.includes(commits.l) && r.out.includes(commits.t) && /4 transactions; 20 USDT/.test(r.out), `plan incomplete: ${r.out.slice(-700)}`);
  return `plan shows both guardCommits and 20 USDT; nonce ${n0} unchanged`;
});
await step("open-rounds: 'y' opens both rounds", async () => {
  const before = await pub.readContract({ address: usdt, abi: art("MockUSDT").abi, functionName: "balanceOf", args: [deployer.address] });
  const r = await run(["open-rounds", "--seed", "10", "--hours", "72"], { input: "y\n" });
  must(r.code === 0, r.out.slice(-400));
  const d = JSON.parse(fs.readFileSync(files.deployment, "utf8"));
  const t = T();
  for (const [rung, c] of [["lighter", commits.l], ["top", commits.t]]) {
    const id = BigInt(d.rounds[rung].roundId);
    const g = await pub.readContract({ ...t, functionName: "getRound", args: [id] });
    must(g.guardCommit === c && g.pot === parseUnits("10", 18) && !g.paidEnabled, `${rung} round state`);
    must((await pub.readContract({ ...t, functionName: "roundSigner", args: [id] })) === signer.address, `${rung} roundSigner`);
    must(r.out.includes(`--round ${id} --open-tx ${d.rounds[rung].openTx}`), "record command not printed");
  }
  const after = await pub.readContract({ address: usdt, abi: art("MockUSDT").abi, functionName: "balanceOf", args: [deployer.address] });
  must(before - after === parseUnits("20", 18), "seed moved");
  return `rounds ${d.rounds.lighter.roundId} and ${d.rounds.top.roundId}: pots 10 + 10, roundSigner = signer, record commands printed`;
});
await step("preflight after launch reads the deployed contract and records", async () => {
  const r = await run(["preflight", "--signer", signer.address, "--relayer", relayer.address, "--agent", attacker.address]);
  must(r.code === 0 && /deployed: Turncoat/.test(r.out) && /2 round\(s\)/.test(r.out) && /commit record for the top round/.test(r.out), r.out.slice(-500));
});
await step("fill-values: skill file (same shape) and site values", async () => {
  const r = await run(["fill-values", "--api", "https://guard.example.test", "--site", "https://turncoat.example.test"]);
  must(r.code === 0, r.out.slice(-300));
  const s = JSON.parse(fs.readFileSync(files.skill, "utf8"));
  const d = JSON.parse(fs.readFileSync(files.deployment, "utf8"));
  must(JSON.stringify(Object.keys(s)) === JSON.stringify(["api", "contract", "rpc", "binanceChainId"]), `shape ${Object.keys(s)}`);
  must(s.api === "https://guard.example.test" && s.contract === d.turncoat && s.binanceChainId === "56", "skill values");
  for (const v of ["VITE_API_BASE_URL=https://guard.example.test", "VITE_CHAIN_ID=56", `VITE_CONTRACT_ADDRESS=${d.turncoat}`, `LOGS_FROM_BLOCK=${d.deployBlock}`]) must(r.out.includes(v), `missing ${v}`);
  const bad = await run(["fill-values", "--api", "http://guard.example.test"]);
  must(bad.code === 2, "plain http accepted");
  return "skill/deployment.json keys kept; VITE_* and guard .env values printed; http refused";
});
await step("no key ever printed (every command's output above)", async () => {
  const keys = [1, 2, 3, 4, 5].map((i) => K(i).slice(2).toLowerCase());
  for (const o of outputs) for (const k of keys) must(!o.toLowerCase().includes(k), "a key appeared in output");
  return `${outputs.length} outputs checked`;
});

console.log(`launch-mainnet rehearsal on a local node with chain id 56 (${RPC}), mock Agent ID ${agentId}, mock USDT ${usdt}`);
for (const l of results) console.log(l);
console.log(`${results.length - failed}/${results.length} checks passed`);
await gServer.close();
if (!process.argv.includes("--keep-tmp")) fs.rmSync(tmp, { recursive: true, force: true }); else console.log(`kept ${tmp}`);
process.exit(failed ? 1 : 0);

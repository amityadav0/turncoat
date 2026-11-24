// Mainnet launch, as a short list of commands. Chain 56 (BSC mainnet) only.
//
//   node scripts/launch-mainnet.mjs preflight     --signer 0x… --relayer 0x… --agent 0x… [--seed 50]
//   node scripts/launch-mainnet.mjs deploy        --signer 0x…
//   node scripts/launch-mainnet.mjs commit-rounds
//   node scripts/launch-mainnet.mjs open-rounds   --seed 50 [--hours 72] [--lighter 0x… --top 0x…]
//   node scripts/launch-mainnet.mjs fill-values   --api https://guard.example.com [--site https://…]
//
// Keys: DEPLOYER_PRIVATE_KEY (the owner) from the environment only, never printed. The signer and the
// relayer are given as addresses; their keys stay on the guard server.
// RPC_URL defaults to the public BSC RPC. The chain id is read from the node and must be 56.
//
// Every subcommand that sends a transaction prints what it will send (chain, contract, addresses,
// amounts) and asks y/N on the terminal. Anything but a typed "y" sends nothing. On a real RPC the
// answer must come from a terminal (stdin a TTY); piped input is refused.
//
// Test only: --test-local-mocks runs against a local node started with chain id 56 (ganache
// --chain.chainId 56), with mock Agent ID and mock USDT given by --agent-id-address / --usdt-address. It
// refuses any RPC whose host is not localhost / 127.0.0.1 / ::1, and it refuses to write the real
// deployments/bsc.json, skill/deployment.json or guard/.secrets/commits (pass --deployment-file,
// --skill-file, --commits-dir). Rehearsal: node scripts/launch-mainnet-rehearsal.mjs
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, defineChain, http, formatUnits, parseUnits, parseEventLogs, encodeAbiParameters, getAddress, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const art = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, "build", `${n}.json`), "utf8"));
const MAINNET = { agentId: "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F", usdt: "0x55d398326f99059fF775485246999027B3197955" }; // SPACE ID Agent ID; BSC-USD (18 decimals)
const LAUNCH = {
  lighter: { version: "v2", model: "anthropic/claude-haiku-5-5" },
  top: { version: "v3", model: "anthropic/claude-opus-5-5" },
};
const ERC20 = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
];

// ---------------------------------------------------------------- arguments
const argv = process.argv.slice(2);
const cmd = argv[0];
const flags = {};
for (let i = 1; i < argv.length; i++) {
  if (!argv[i].startsWith("--")) { die(`unexpected argument: ${argv[i]}`, 2); }
  const k = argv[i].slice(2);
  if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) flags[k] = argv[++i]; else flags[k] = true;
}
function die(msg, code = 1) { console.error(msg); process.exit(code); }
const CMDS = ["preflight", "deploy", "commit-rounds", "open-rounds", "fill-values"];
if (!CMDS.includes(cmd)) die(`usage: node scripts/launch-mainnet.mjs <${CMDS.join(" | ")}> [flags]  (see the top of this file)`, 2);

const test = flags["test-local-mocks"] === true;
const rpc = process.env.RPC_URL || "https://bsc-dataseed.bnbchain.org";
if (test) {
  let host;
  try { host = new URL(rpc).hostname; } catch { die(`--test-local-mocks: RPC_URL is not a URL; nothing done`); }
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) die(`--test-local-mocks runs only against a local node (localhost / 127.0.0.1); RPC_URL host is ${host}. Nothing done.`);
} else {
  for (const k of ["agent-id-address", "usdt-address"]) if (flags[k]) die(`--${k} is test-only (needs --test-local-mocks)`, 2);
}
const ADDR = test
  ? { agentId: addrFlag("agent-id-address", true), usdt: addrFlag("usdt-address", true) }
  : MAINNET;
const files = {
  deployment: path.resolve(flags["deployment-file"] ?? path.join(ROOT, "deployments/bsc.json")),
  skill: path.resolve(flags["skill-file"] ?? path.join(ROOT, "skill/deployment.json")),
  commits: path.resolve(flags["commits-dir"] ?? path.join(ROOT, "guard/.secrets/commits")),
};
if (test) {
  const real = [path.join(ROOT, "deployments/bsc.json"), path.join(ROOT, "skill/deployment.json"), path.join(ROOT, "guard/.secrets/commits")];
  for (const [k, p] of Object.entries(files)) if (real.includes(p)) die(`--test-local-mocks must not write the real ${path.relative(ROOT, p)}; pass --${k === "deployment" ? "deployment-file" : k === "skill" ? "skill-file" : "commits-dir"}`, 2);
}

function addrFlag(k, required = false, envName) {
  const v = flags[k] ?? (envName ? process.env[envName] : undefined);
  if (v === undefined || v === true) { if (required) die(`--${k} 0x… is required`, 2); return undefined; }
  if (!isAddress(v)) die(`--${k} is not an address: ${v}`, 2);
  return getAddress(v);
}

// commit-rounds needs no chain.
if (cmd === "commit-rounds") { commitRounds(); process.exit(0); }

// ---------------------------------------------------------------- chain
const probe = createPublicClient({ transport: http(rpc) });
let chainId;
try { chainId = await probe.getChainId(); } catch (e) { die(`cannot reach RPC_URL: ${e.shortMessage ?? e.message}`); }
if (chainId !== 56) die(`this RPC is on chain ${chainId}, not BSC mainnet (56). Nothing done.`);
const chain = defineChain({ id: 56, name: "BNB Smart Chain", nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const pub = createPublicClient({ chain, transport: http(rpc), pollingInterval: test ? 300 : 2000 });
const TC = art("Turncoat");
const fmt = (v) => formatUnits(v, 18);

function deployerAccount(required) {
  const k = process.env.DEPLOYER_PRIVATE_KEY;
  if (!k) { if (required) die("set DEPLOYER_PRIVATE_KEY in the environment (the owner key; it is never printed)", 2); return undefined; }
  try { return privateKeyToAccount(k); } catch { die("DEPLOYER_PRIVATE_KEY is not a valid private key", 2); }
}
const readDeployment = () => (fs.existsSync(files.deployment) ? JSON.parse(fs.readFileSync(files.deployment, "utf8")) : null);
const writeDeployment = (d) => { fs.mkdirSync(path.dirname(files.deployment), { recursive: true }); fs.writeFileSync(files.deployment, JSON.stringify(d, null, 2) + "\n"); };
const hasCode = async (a) => ((await pub.getCode({ address: a })) ?? "0x") !== "0x";

/** y/N on the terminal. Only a typed "y" (or "yes") goes ahead. */
async function confirm(lines) {
  console.log("");
  console.log(`About to send on chain ${chainId}${test ? " (LOCAL TEST NODE, mock Agent ID and USDT)" : " (BSC MAINNET, real funds)"}:`);
  for (const l of lines) console.log(`  - ${l}`);
  if (!test && !process.stdin.isTTY) { console.error("Refusing: the confirmation must be typed on a terminal (stdin is not a TTY). Nothing sent."); process.exit(1); }
  process.stdout.write("Send? Type y to send, anything else cancels [y/N]: ");
  const answer = await new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, terminal: false });
    let done = false;
    rl.once("line", (l) => { done = true; rl.close(); resolve(l); });
    rl.once("close", () => { if (!done) resolve(""); });
  });
  if (!/^(y|yes)$/i.test(answer.trim())) { console.log("\nCancelled. Nothing sent."); process.exit(1); }
  console.log("");
}

async function send(wallet, req, label) {
  const hash = await wallet.writeContract(req);
  console.log(`${label}: tx ${hash}${test ? "" : `  https://bscscan.com/tx/${hash}`}`);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") die(`${label} reverted (tx ${hash}). Stopping; do not retry before reading why.`);
  return r;
}

// ---------------------------------------------------------------- preflight (read-only)
async function preflight() {
  const problems = [], notes = [];
  const ok = (m) => console.log(`  ok    ${m}`);
  const bad = (m) => { problems.push(m); console.log(`  FAIL  ${m}`); };
  const info = (m) => { notes.push(m); console.log(`  info  ${m}`); };
  console.log(`preflight on chain ${chainId} via ${test ? rpc : new URL(rpc).host}${test ? " (local test node, mock Agent ID and USDT)" : ""}`);

  const acct = deployerAccount(false);
  const deployer = acct?.address ?? addrFlag("deployer");
  const signer = addrFlag("signer", false, "GUARD_SIGNER_ADDRESS");
  const relayer = addrFlag("relayer", false, "RELAYER_ADDRESS");
  const agent = addrFlag("agent");
  if (!deployer) bad("no deployer: set DEPLOYER_PRIVATE_KEY (or pass --deployer 0x… for a read-only check)"); else ok(`deployer (owner) ${deployer}`);
  if (!signer) bad("no guard signer address: --signer 0x… (or GUARD_SIGNER_ADDRESS)"); else ok(`guard signer ${signer}`);
  if (!relayer) info("no relayer address given (--relayer 0x…): winners would have to settle themselves"); else ok(`relayer ${relayer}`);
  const roles = [["deployer", deployer], ["signer", signer], ["relayer", relayer]].filter(([, a]) => a);
  for (let i = 0; i < roles.length; i++) for (let j = i + 1; j < roles.length; j++)
    if (roles[i][1].toLowerCase() === roles[j][1].toLowerCase()) bad(`${roles[i][0]} and ${roles[j][0]} are the same address; use three different keys`);

  for (const [name, a] of [["Agent ID registry", ADDR.agentId], ["USDT", ADDR.usdt]]) {
    if (await hasCode(a)) ok(`${name} contract at ${a}`); else bad(`no contract at the ${name} address ${a}`);
  }
  let decimals = 18;
  try { decimals = Number(await pub.readContract({ address: ADDR.usdt, abi: ERC20, functionName: "decimals" })); if (decimals !== 18) bad(`USDT reports ${decimals} decimals; the launch assumes 18`); } catch { bad("USDT decimals() unreadable"); }
  const usdtOf = async (a) => { try { return await pub.readContract({ address: ADDR.usdt, abi: ERC20, functionName: "balanceOf", args: [a] }); } catch { return null; } };

  const seed = flags.seed !== undefined && flags.seed !== true ? parseUnits(String(flags.seed), 18) : null;
  if (deployer) {
    const [bnb, usdt] = [await pub.getBalance({ address: deployer }), await usdtOf(deployer)];
    console.log(`        deployer: ${fmt(bnb)} BNB, ${usdt === null ? "?" : fmt(usdt)} USDT`);
    if (bnb < parseUnits("0.01", 18)) bad(`deployer holds ${fmt(bnb)} BNB; keep at least 0.01 for deploy, approvals and two openRound calls`);
    if (seed !== null && usdt !== null && usdt < seed * 2n) bad(`deployer holds ${fmt(usdt)} USDT; two rounds at --seed ${flags.seed} need ${fmt(seed * 2n)}`);
    if (seed === null) info("pass --seed <USDT per round> to check the deployer holds both seeds");
  }
  if (signer) { const b = await pub.getBalance({ address: signer }); console.log(`        signer: ${fmt(b)} BNB (needs none)`); }
  if (relayer) {
    const b = await pub.getBalance({ address: relayer });
    console.log(`        relayer: ${fmt(b)} BNB`);
    if (b < parseUnits("0.002", 18)) bad(`relayer holds ${fmt(b)} BNB; give it about 0.005 BNB for settle() gas`);
  }

  if (agent) {
    try {
      const n = await pub.readContract({ address: ADDR.agentId, abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }], functionName: "balanceOf", args: [agent] });
      if (n > 0n) ok(`Agent ID registry: ${agent} holds ${n} Agent ID (the contract's attempt check passes for it)`);
      else bad(`Agent ID registry: ${agent} holds no Agent ID, so it could not attack`);
      for (const [name, a] of roles) if (a.toLowerCase() === agent.toLowerCase()) bad(`--agent is the ${name}; the contract refuses attempts from the owner and the signer`);
    } catch (e) { bad(`Agent ID registry balanceOf(${agent}) failed: ${e.shortMessage ?? e.message}`); }
  } else info("pass --agent 0x<an Agent ID holder> to check the registry read the contract uses");

  const d = readDeployment();
  if (!d) info(`not deployed yet (no ${path.relative(ROOT, files.deployment)})`);
  else if (d.chainId !== 56) bad(`${path.relative(ROOT, files.deployment)} is for chain ${d.chainId}`);
  else if (!(await hasCode(d.turncoat))) bad(`${path.relative(ROOT, files.deployment)} names ${d.turncoat}, but there is no contract there`);
  else {
    const T = { address: d.turncoat, abi: TC.abi };
    const [owner, gs, tok, aid, paused, rc] = await Promise.all(["owner", "guardSigner", "token", "agentId", "roundsPaused", "roundCount"].map((fn) => pub.readContract({ ...T, functionName: fn })));
    ok(`deployed: Turncoat ${d.turncoat} (block ${d.deployBlock}); ${rc} round(s)${paused ? ", NEW ROUNDS PAUSED" : ""}`);
    if (deployer && owner.toLowerCase() !== deployer.toLowerCase()) bad(`contract owner is ${owner}, not the deployer ${deployer}`);
    if (signer && gs.toLowerCase() !== signer.toLowerCase()) bad(`contract guardSigner is ${gs}, not ${signer}`);
    if (tok.toLowerCase() !== ADDR.usdt.toLowerCase()) bad(`contract token is ${tok}`);
    if (aid.toLowerCase() !== ADDR.agentId.toLowerCase()) bad(`contract agentId is ${aid}`);
  }

  const recs = loadLaunchRecords();
  for (const rung of ["lighter", "top"]) {
    const r = recs[rung];
    if (r) ok(`commit record for the ${rung} round: ${r.commit} (${LAUNCH[rung].model} decide ${LAUNCH[rung].version})`);
    else info(`no commit record yet for the ${rung} round in ${path.relative(ROOT, files.commits) || files.commits} (run commit-rounds)`);
  }

  console.log("");
  if (problems.length) { console.log(`PREFLIGHT: ${problems.length} problem(s):`); for (const p of problems) console.log(`  - ${p}`); process.exit(1); }
  console.log("PREFLIGHT: PASS (nothing was sent)");
}

/** The newest commit record per launch rung (decide mode, matching version and model). */
function loadLaunchRecords() {
  const out = {};
  if (!fs.existsSync(files.commits)) return out;
  const recs = fs.readdirSync(files.commits).filter((f) => /^0x[0-9a-f]{64}\.json$/i.test(f)).map((f) => {
    const p = path.join(files.commits, f);
    try { return { ...JSON.parse(fs.readFileSync(p, "utf8")), mtime: fs.statSync(p).mtimeMs }; } catch { return null; }
  }).filter(Boolean);
  for (const rung of ["lighter", "top"]) {
    const want = LAUNCH[rung];
    const m = recs.filter((r) => r.mode === "decide" && r.version === want.version && r.model === want.model && r.level === 1).sort((a, b) => b.mtime - a.mtime)[0];
    if (m) out[rung] = m;
  }
  return out;
}

// ---------------------------------------------------------------- deploy
async function deploy() {
  const acct = deployerAccount(true);
  const signer = addrFlag("signer", true, "GUARD_SIGNER_ADDRESS");
  if (signer.toLowerCase() === acct.address.toLowerCase()) die("the guard signer must not be the deployer");
  const d = readDeployment();
  if (d && d.chainId === 56 && (await hasCode(d.turncoat)) && !flags["new-contract"]) die(`already deployed: ${d.turncoat} (${path.relative(ROOT, files.deployment)}). Pass --new-contract only if you really want a second contract.`);
  for (const [n, a] of [["Agent ID registry", ADDR.agentId], ["USDT", ADDR.usdt]]) if (!(await hasCode(a))) die(`no contract at the ${n} address ${a}; nothing sent`);
  const args = [ADDR.agentId, ADDR.usdt, signer];
  const bnb = await pub.getBalance({ address: acct.address });
  await confirm([
    `deploy Turncoat from ${acct.address} (becomes the owner; holds ${fmt(bnb)} BNB)`,
    `constructor: agentId ${args[0]}, token ${args[1]} (USDT), guardSigner ${args[2]}`,
    `then write ${path.relative(ROOT, files.deployment)}`,
  ]);
  const wallet = createWalletClient({ account: acct, chain, transport: http(rpc) });
  const hash = await wallet.deployContract({ abi: TC.abi, bytecode: TC.bytecode, args });
  console.log(`deploy: tx ${hash}${test ? "" : `  https://bscscan.com/tx/${hash}`}`);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success" || !r.contractAddress) die(`deploy failed (tx ${hash})`);
  const T = { address: r.contractAddress, abi: TC.abi };
  const [owner, gs, tok, aid] = await Promise.all(["owner", "guardSigner", "token", "agentId"].map((fn) => pub.readContract({ ...T, functionName: fn })));
  const out = { chainId: 56, turncoat: r.contractAddress, agentId: ADDR.agentId, usdt: ADDR.usdt, guardSigner: signer, owner, deployBlock: Number(r.blockNumber), tx: hash };
  writeDeployment(out);
  console.log(JSON.stringify(out, null, 2));
  const checks = [[owner, acct.address, "owner"], [gs, signer, "guardSigner"], [tok, ADDR.usdt, "token"], [aid, ADDR.agentId, "agentId"]];
  for (const [got, want, n] of checks) if (got.toLowerCase() !== want.toLowerCase()) die(`read back ${n} = ${got}, expected ${want}`);
  console.log("read back: owner, guardSigner, token, agentId match");
  console.log("constructor args (ABI-encoded, for BscScan):", encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "address" }], args).slice(2));
  console.log("verify: node scripts/verify-input.mjs > turncoat-standard-input.json, then BscScan → Verify and Publish → Solidity (Standard-Json-Input), v0.8.28");
}

// ---------------------------------------------------------------- commit-rounds (no transaction)
function commitRounds() {
  const out = {};
  for (const rung of ["lighter", "top"]) {
    const { version, model } = LAUNCH[rung];
    const o = execFileSync(process.execPath, ["--import", "tsx", "scripts/commit.ts", "--mode", "decide", "--version", version, "--model", model, "--level", "1", "--out", files.commits], {
      cwd: path.join(ROOT, "guard"), encoding: "utf8", env: { ...process.env, GUARD_ENV_FILE: "none" },
    });
    const commit = /guardCommit: (0x[0-9a-f]{64})/.exec(o)?.[1];
    if (!commit) die(`commit for the ${rung} round failed:\n${o}`);
    out[rung] = commit;
    console.log(`${rung.padEnd(7)} ${commit}  (${model}, decide ${version})`);
  }
  console.log(`\nrecords in ${files.commits} (salts are private until each round's reveal; back this folder up; the guard server must hold it)`);
  console.log(`next: node scripts/launch-mainnet.mjs open-rounds --seed <USDT per round> --lighter ${out.lighter} --top ${out.top}`);
}

// ---------------------------------------------------------------- open-rounds
async function openRounds() {
  const acct = deployerAccount(true);
  const d = readDeployment();
  if (!d || d.chainId !== 56) die(`no mainnet deployment in ${path.relative(ROOT, files.deployment)}; run deploy first`);
  const recs = loadLaunchRecords();
  const commits = {
    lighter: flags.lighter ?? recs.lighter?.commit,
    top: flags.top ?? recs.top?.commit,
  };
  for (const [k, v] of Object.entries(commits)) if (!/^0x[0-9a-fA-F]{64}$/.test(v ?? "")) die(`no guardCommit for the ${k} round: pass --${k} 0x… (printed by commit-rounds)`, 2);
  if (commits.lighter.toLowerCase() === commits.top.toLowerCase()) die("the two rounds need different guardCommits", 2);
  if (flags.seed === undefined || flags.seed === true) die("--seed <USDT per round> is required (your choice; LAUNCH.md)", 2);
  const seeds = { lighter: parseUnits(String(flags["seed-lighter"] ?? flags.seed), 18), top: parseUnits(String(flags["seed-top"] ?? flags.seed), 18) };
  const hours = Number(flags.hours ?? 72);
  if (!(hours >= 1 && hours <= 720)) die("--hours must be between 1 and 720", 2);
  const T = { address: d.turncoat, abi: TC.abi };
  const [owner, paused, signer] = await Promise.all(["owner", "roundsPaused", "guardSigner"].map((fn) => pub.readContract({ ...T, functionName: fn })));
  const bal = await pub.readContract({ address: ADDR.usdt, abi: ERC20, functionName: "balanceOf", args: [acct.address] });
  const problems = [];
  if (owner.toLowerCase() !== acct.address.toLowerCase()) problems.push(`DEPLOYER_PRIVATE_KEY is ${acct.address}, but the owner is ${owner}`);
  if (paused) problems.push("new rounds are paused");
  if (bal < seeds.lighter + seeds.top) problems.push(`owner holds ${fmt(bal)} USDT; the two seeds need ${fmt(seeds.lighter + seeds.top)}`);
  if (problems.length) die(problems.map((p) => `cannot open: ${p}`).join("\n"));
  const duration = BigInt(Math.round(hours * 3600));
  await confirm([
    `from the owner ${acct.address} to Turncoat ${d.turncoat}; rounds get guard signer ${signer}`,
    `lighter round: approve exactly ${fmt(seeds.lighter)} USDT, then openRound(level 1, ${hours} h, paid off, guardCommit ${commits.lighter}) seeded ${fmt(seeds.lighter)} USDT  [${LAUNCH.lighter.model}, decide ${LAUNCH.lighter.version}]`,
    `top round:     approve exactly ${fmt(seeds.top)} USDT, then openRound(level 1, ${hours} h, paid off, guardCommit ${commits.top}) seeded ${fmt(seeds.top)} USDT  [${LAUNCH.top.model}, decide ${LAUNCH.top.version}]`,
    `4 transactions; ${fmt(seeds.lighter + seeds.top)} USDT leaves the owner`,
  ]);
  const wallet = createWalletClient({ account: acct, chain, transport: http(rpc) });
  const opened = {};
  for (const rung of ["lighter", "top"]) {
    await send(wallet, { address: ADDR.usdt, abi: ERC20, functionName: "approve", args: [d.turncoat, seeds[rung]] }, `${rung}: approve ${fmt(seeds[rung])} USDT`);
    const r = await send(wallet, { ...T, functionName: "openRound", args: [1, duration, 0n, false, commits[rung], seeds[rung], 0n] }, `${rung}: openRound`);
    const ev = parseEventLogs({ abi: TC.abi, logs: r.logs, eventName: "RoundOpened" })[0];
    opened[rung] = { roundId: Number(ev.args.roundId), openTx: r.transactionHash, guardCommit: commits[rung], endTime: new Date(Number(ev.args.endTime) * 1000).toISOString() };
    console.log(`${rung}: round ${opened[rung].roundId} is open until ${opened[rung].endTime}, pot ${fmt(ev.args.seed)} USDT`);
  }
  writeDeployment({ ...readDeployment(), rounds: { ...(readDeployment().rounds ?? {}), ...opened } });
  console.log(`\nsaved round ids in ${path.relative(ROOT, files.deployment)}`);
  console.log("Record the open transactions on the guard server (so the site links them):");
  for (const rung of ["lighter", "top"]) console.log(`  cd ~/turncoat/guard && sudo docker compose -p turncoat exec -T guard npx tsx scripts/record.ts --round ${opened[rung].roundId} --open-tx ${opened[rung].openTx}`);
}

// ---------------------------------------------------------------- fill-values (no transaction)
async function fillValues() {
  const d = readDeployment();
  if (!d || d.chainId !== 56) die(`no mainnet deployment in ${path.relative(ROOT, files.deployment)}; run deploy first`);
  const api = flags.api;
  if (typeof api !== "string" || !/^https:\/\/[^/\s]+$/.test(api.replace(/\/$/, ""))) die("--api https://<guard domain> is required (https, no path)", 2);
  const apiBase = api.replace(/\/$/, "");
  const publicRpc = typeof flags["public-rpc"] === "string" ? flags["public-rpc"] : "https://bsc-dataseed.bnbchain.org";
  const current = fs.existsSync(files.skill) ? JSON.parse(fs.readFileSync(files.skill, "utf8")) : {};
  const skill = { ...current, api: apiBase, contract: d.turncoat, rpc: publicRpc, binanceChainId: "56" };
  fs.mkdirSync(path.dirname(files.skill), { recursive: true });
  fs.writeFileSync(files.skill, JSON.stringify(skill, null, 2) + "\n");
  console.log(`wrote ${path.relative(ROOT, files.skill)}:`);
  console.log(JSON.stringify(skill, null, 2));
  console.log("(commit and push it so installed skills point at the live service)\n");
  console.log("Site environment (Netlify → Site configuration → Environment variables):");
  const site = {
    VITE_API_BASE_URL: apiBase,
    VITE_CHAIN_ID: "56",
    VITE_CONTRACT_ADDRESS: d.turncoat,
    VITE_RPC_URL: publicRpc,
    VITE_TOKEN_DECIMALS: "18",
    VITE_SITE_URL: typeof flags.site === "string" ? flags.site.replace(/\/$/, "") : "",
    VITE_MOCK: "",
  };
  for (const [k, v] of Object.entries(site)) console.log(`${k}=${v}`);
  console.log("VITE_SKILL_URL= and VITE_AGENT_ID_URL= : fill in when available");
  console.log("\nGuard server (guard/.env): CHAIN_ID=56");
  console.log(`TURNCOAT_ADDRESS=${d.turncoat}`);
  console.log(`LOGS_FROM_BLOCK=${d.deployBlock}`);
  if (site.VITE_SITE_URL) console.log(`CORS_ORIGINS=${site.VITE_SITE_URL}`);
  if (d.rounds) for (const [rung, r] of Object.entries(d.rounds)) console.log(`round ${r.roundId} (${rung}) open tx ${r.openTx}`);
}

if (cmd === "preflight") await preflight();
else if (cmd === "deploy") await deploy();
else if (cmd === "open-rounds") await openRounds();
else if (cmd === "fill-values") await fillValues();

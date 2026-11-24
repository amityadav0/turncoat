// Testnet rows 12 (roll-over) and 20 (late break), run unattended once the settle deadline passes.
//
//   node scripts/testnet-wait-rows.mjs [--rollover-round 3] [--late-round 4] [--late-attempt 1]
//        [--api http://127.0.0.1:8797] [--late-port 8798] [--commit 0x<guardCommit for the seeded round>]
//        [--no-wait] [--no-write]
//
// Before it sleeps it checks that rollOver is refused while the settle window is open. It then sleeps
// until both rounds' settle deadlines + 2 minutes and:
//   row 12  sends rollOver(rolloverRound) (deployer key), checks the reserve grew by the pot, records the
//           tx with the service's `record` script, checks the API shows `held` with `settleTx`, and opens
//           a 1-hour round seeded only from the reserve;
//   row 20  starts the staged late instance (compose project turncoat-testnet-late, holding a break that
//           was queued behind an undelivered blocker before the deadline), waits until it answers the
//           break, and checks: blocker expired, break `broken` with the "settle deadline has passed" note
//           and no verdict. The late instance is stopped afterwards.
// Finally it writes the results into docs/TESTPLAN.md (testnet column), docs/TESTNET.md (results) and the
// README's Status row.
//
// Chain 97 only (enforced by --network testnet in every call). Keys come from the gitignored .env.deploy
// and guard/.env.testnet and are never printed.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, formatUnits, encodeFunctionData, decodeErrorResult } from "viem";
import { art, TESTNET } from "./lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GUARD = path.join(ROOT, "guard");
const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : d; };
const has = (k) => a.includes(`--${k}`);
const ROLL = Number(opt("rollover-round", 3)), LATE = Number(opt("late-round", 4)), LATE_ATTEMPT = Number(opt("late-attempt", 1));
const API = opt("api", "http://127.0.0.1:8797"), LATE_PORT = Number(opt("late-port", 8798));
const SEED_COMMIT = opt("commit", "0x2ea09d81c7f50268f572fc38886ad9ac85b28ec8451c21a3fe5381e651fd0d0e"); // Haiku 5.5 decide v2
const dep = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments/bsc-testnet.json"), "utf8"));
const pub = createPublicClient({ transport: http(process.env.RPC_URL || TESTNET.rpc) });
const T = { address: dep.turncoat, abi: art("Turncoat").abi };
const log = (...m) => console.log(new Date().toISOString(), ...m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rd = (fn, args = []) => pub.readContract({ ...T, functionName: fn, args });
const node = (script, args) => execFileSync(process.execPath, [path.join(ROOT, "scripts", script), ...args, "--network", "testnet"], { cwd: ROOT, encoding: "utf8" });
const composeEnv = (port) => ({ ...process.env, GUARD_ENV_FILE: ".env.testnet", GUARD_COMMITS_DIR: "./.secrets/commits-testnet", GUARD_PORT: String(port) });
const compose = (project, port, args) => execFileSync("docker", ["compose", "-p", project, ...args], { cwd: GUARD, encoding: "utf8", env: composeEnv(port) });
const getJson = async (url) => { const r = await fetch(url); return { status: r.status, body: await r.json().catch(() => null) }; };
async function until(fn, ms, what) { const end = Date.now() + ms; for (;;) { try { const v = await fn(); if (v) return v; } catch {} if (Date.now() > end) throw new Error(`timed out: ${what}`); await sleep(5000); } }

if ((await pub.getChainId()) !== 97) { console.error("RPC is not BSC testnet (97); nothing done"); process.exit(1); }
const grace = Number(await rd("SETTLE_GRACE"));
const roll = await rd("getRound", [BigInt(ROLL)]);
const late = await rd("getRound", [BigInt(LATE)]);
const deadline = Math.max(Number(roll.endTime), Number(late.endTime)) + grace;
const results = { 12: { ok: false, text: "" }, 20: { ok: false, text: "" } };

// Row 12, part 1: refused while the settle window is open.
let early = "not checked (already past the deadline)";
if (Date.now() / 1000 < Number(roll.endTime) + grace) {
  try { await pub.call({ account: dep.owner, to: T.address, data: encodeFunctionData({ abi: T.abi, functionName: "rollOver", args: [BigInt(ROLL)] }) }); early = "NOT refused"; }
  catch (e) { const raw = e.walk?.((c) => typeof c?.data === "string")?.data; early = raw ? `refused (${decodeErrorResult({ abi: T.abi, data: raw }).errorName})` : `refused (${e.shortMessage})`; }
  log(`row 12: early rollOver(${ROLL}) ${early}`);
}

const wakeAt = (deadline + 120) * 1000;
if (!has("no-wait") && Date.now() < wakeAt) { log(`sleeping until ${new Date(wakeAt).toISOString()} (settle deadline + 2 min)`); while (Date.now() < wakeAt) await sleep(Math.min(60_000, wakeAt - Date.now())); }
while (Number((await pub.getBlock()).timestamp) <= deadline) { log("chain time not past the deadline yet"); await sleep(15_000); }

// Row 12, part 2: roll over, reserve, record, API, seed a new round from the reserve.
try {
  const r = await rd("getRound", [BigInt(ROLL)]);
  if (r.closed) throw new Error(`round ${ROLL} is already closed`);
  const reserveBefore = await rd("reserve");
  const out = node("round-tools.mjs", ["rollover", String(ROLL)]);
  const tx = /rollOver: tx (0x[0-9a-f]{64})/.exec(out)?.[1];
  if (!tx) throw new Error(`no rollOver tx in output: ${out.slice(0, 200)}`);
  const reserveAfter = await until(async () => { const v = await rd("reserve"); return v !== reserveBefore ? v : null; }, 60_000, "reserve update");
  const grew = reserveAfter - reserveBefore;
  if (grew !== r.pot) throw new Error(`reserve grew by ${formatUnits(grew, 18)}, pot was ${formatUnits(r.pot, 18)}`);
  compose("turncoat-testnet", 8797, ["exec", "-T", "-e", "GUARD_ENV_FILE=none", "guard", "npx", "tsx", "scripts/record.ts", "--round", String(ROLL), "--settle-tx", tx]);
  const view = await until(async () => { const v = (await getJson(`${API}/rounds/${ROLL}`)).body?.round; return v?.status === "held" && v.settleTx ? v : null; }, 60_000, "API held with settleTx");
  const opened = node("open-round.mjs", ["--commit", SEED_COMMIT, "--hours", "1", "--seed", "0", "--seed-from-reserve", formatUnits(r.pot, 18)]);
  const newId = /round (\d+) is open/.exec(opened)?.[1], openTx = /openRound: tx (0x[0-9a-f]{64})/.exec(opened)?.[1];
  if (!newId) throw new Error(`open-round output: ${opened.slice(0, 200)}`);
  compose("turncoat-testnet", 8797, ["exec", "-T", "-e", "GUARD_ENV_FILE=none", "guard", "npx", "tsx", "scripts/record.ts", "--round", newId, "--open-tx", openTx]);
  const nr = await rd("getRound", [BigInt(newId)]);
  results[12] = { ok: early.startsWith("refused") || early.startsWith("not checked"), text: `pass: early rollOver ${early}; after the deadline rollOver(${ROLL}) \`${tx.slice(0, 6)}…${tx.slice(-4)}\`, reserve +${formatUnits(grew, 18)} (= pot); recorded, API \`${view.status}\` with settleTx; round ${newId} opened from the reserve only (pot ${formatUnits(nr.pot, 18)})` };
  log("row 12:", results[12].text);
} catch (e) { results[12] = { ok: false, text: `FAIL: ${e.message}` }; log("row 12 FAILED:", e.message); }

// Row 20: the staged late instance answers the break after the deadline.
try {
  compose("turncoat-testnet-late", LATE_PORT, ["up", "-d"]);
  const base = `http://127.0.0.1:${LATE_PORT}`;
  await until(async () => (await getJson(`${base}/health`)).status > 0, 120_000, "late instance up");
  const v = await until(async () => { const r = (await getJson(`${base}/attempts/${LATE}/${LATE_ATTEMPT}`)).body; return r && r.status !== "queued" && r.status !== "awaiting_message" ? r : null; }, 15 * 60_000, "late break answered");
  const blocker = (await getJson(`${base}/attempts/${LATE}/0`)).body;
  const problems = [];
  if (v.outcome !== "broken") problems.push(`outcome ${v.outcome}`);
  if (v.verdict) problems.push("a verdict was signed");
  if (!/settle deadline has passed/.test(v.note ?? "")) problems.push(`note: ${v.note}`);
  if (blocker?.status !== "expired") problems.push(`blocker status ${blocker?.status}`);
  results[20] = problems.length
    ? { ok: false, text: `FAIL: ${problems.join("; ")}` }
    : { ok: true, text: `pass: late instance started after the deadline; round ${LATE} blocker attempt 0 expired; attempt ${LATE_ATTEMPT} \`broken\` (${v.breakKind ?? "?"}), no verdict, note "settle deadline has passed"` };
  log("row 20:", results[20].text);
} catch (e) { results[20] = { ok: false, text: `FAIL: ${e.message}` }; log("row 20 FAILED:", e.message); }
finally { try { compose("turncoat-testnet-late", LATE_PORT, ["stop"]); } catch {} }

if (!has("no-write")) {
  const day = new Date().toISOString().slice(0, 10);
  const planFile = path.join(ROOT, "docs/TESTPLAN.md");
  let plan = fs.readFileSync(planFile, "utf8");
  for (const row of [12, 20]) {
    plan = plan.replace(new RegExp(`^\\| ${row} \\|.*$`, "m"), (line) => {
      const cells = line.split(" | ");
      cells[5] = `${results[row].text} (${day})`;
      return cells.join(" | ");
    });
  }
  fs.writeFileSync(planFile, plan);
  const tnFile = path.join(ROOT, "docs/TESTNET.md");
  let tn = fs.readFileSync(tnFile, "utf8");
  const line = `- **${results[12].ok && results[20].ok ? "Pass" : "Result"} (${day}, after the settle deadline, run by \`scripts/testnet-wait-rows.mjs\`):** row 12 ${results[12].text}; row 20 ${results[20].text}.`;
  tn = tn.replace(/^- \*\*Pending:\*\* 12 and 20[^\n]*$/m, line);
  fs.writeFileSync(tnFile, tn);
  // README Status row: the testnet count.
  const readmeFile = path.join(ROOT, "README.md");
  const passed = 19 + (results[12].ok ? 1 : 0) + (results[20].ok ? 1 : 0);
  const rest = [12, 20].filter((r) => !results[r].ok);
  const readme = fs.readFileSync(readmeFile, "utf8").replace(/\d+ of 21 test-plan rows pass;[^|]*?\. Runbook/, `${passed} of 21 test-plan rows pass${rest.length ? ` (row${rest.length > 1 ? "s" : ""} ${rest.join(" and ")} failed: see the results)` : ""}. Runbook`);
  fs.writeFileSync(readmeFile, readme);
  log("wrote docs/TESTPLAN.md and docs/TESTNET.md");
}
process.exit(results[12].ok && results[20].ok ? 0 : 1);

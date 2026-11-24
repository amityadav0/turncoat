// Usage: npm run redteam -- [promptsFile] [--models a,b,c] [--mode refuse|decide|both] [--version v1|v2|v3|all]
//                             [--sessions] [--no-force-tool] [--fixed-addresses] [--lang en,zh] [--repeat N] [--concurrency 4] [--only id1,id2] [--max-calls N] [--out DIR]
// Runs the attack set against the guard and prints, for every model × mode × version: attacks run,
// how many broke it, errors, tokens (total and per attempt, from the provider's usage data),
// average seconds per attempt, and the ids that broke it.
//   --models   provider/model ids, e.g. anthropic/claude-opus-5-5,anthropic/claude-haiku-5-5,fake.
//              Default: the model from env (MODEL_PROVIDER/MODEL_NAME). Keys come from ANTHROPIC_API_KEY /
//              OPENAI_API_KEY (MODEL_API_KEY only for MODEL_PROVIDER's own models).
//   --mode     refuse | decide | reader, a comma list, or `all` (`both` = refuse,decide).
//              Default GUARD_MODE (default refuse). Versions with no instruction file for a mode are skipped.
//   --max-calls  hard cap on model calls for the whole run; attempts that would exceed it are not run.
//   --repeat   run each attack N times (each run is a fresh conversation).
//   --sessions multi-turn: entries carry `turns: [...]` (default file redteam/level<N>-sessions.jsonl); the
//              attacker's messages go into one conversation, the break rule covers the session, and the
//              table shows at which turn breaks happened.
//   --instructions FILE  use this system prompt instead of the guard version (the version label is then
//              only a label). With docs/attacks/starter.jsonl this replays the starter attacks against
//              your own agent's prompt and tools (decide mode: approve_payment / reject_payment / get_balance).
//   --fixed-addresses  send the attack files' placeholder recipient addresses (0x2222…2222 and three
//              others) as written. By default each run gets a fresh random address in their place, as a
//              real attacker would send their own address; the placeholders made some attacks look far
//              stronger (d-040 on v1 Haiku: 6/6 with 0x2222…, 1/6 with a real-looking address, 24 Nov).
//   --version  default GUARD_VERSION (default v1); `all` runs v1, v2, v3.
// A prompt runs in a mode if its `mode` tag is that mode or "both". Reader-mode entries carry
// `payload: {name, symbol, description}` instead of `prompt`. Transcripts go to redteam/results/
// (gitignored). Exit code 1 if anything broke.
import fs from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import path from "node:path";
import { modelFromEnv, modelFromSpec, type ModelAdapter, type ChatMessage, type ToolDef, type CompleteOptions } from "../src/model/index.ts";
import { runGuard, runSession, type GuardRun, type GuardSession } from "../src/guard.ts";
import { redact } from "../src/model/redact.ts";
import { GUARD_ROOT, loadGuardEnv } from "../src/config.ts";
import { VERSIONS, MODES, resolveVersion, resolveMode, levelFile, type GuardVersion, type GuardMode } from "../src/levels.ts";

loadGuardEnv();

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const level = Number(flag("--level") ?? 1);
const versionArg = flag("--version") ?? process.env.GUARD_VERSION;
const versions: GuardVersion[] = versionArg === "all" ? [...VERSIONS] : [resolveVersion(versionArg)];
const modeArg = flag("--mode") ?? process.env.GUARD_MODE;
const modes: GuardMode[] = modeArg === "all" ? [...MODES] : modeArg === "both" ? ["refuse", "decide"] : (modeArg ?? "").split(",").map((m) => resolveMode(m.trim() || undefined));
const maxCallsArg = flag("--max-calls");
const maxCalls = maxCallsArg ? Number(maxCallsArg) : Infinity;
const modelsArg = flag("--models");
const concurrency = Math.max(1, Number(flag("--concurrency") ?? 4));
const only = flag("--only")?.split(",");
const langs = flag("--lang")?.split(",");
const repeat = Math.max(1, Number(flag("--repeat") ?? 1));
// --no-force-tool: decide mode without forcing a tool call (harness only, for measurements; never the service).
const noForceIdx = args.indexOf("--no-force-tool");
const noForceTool = noForceIdx >= 0;
if (noForceTool) args.splice(noForceIdx, 1);
// --instructions FILE: run your own system prompt instead of a guard version (replaying an attack file against your agent).
const ownInstructions = flag("--instructions");
const fixedIdx = args.indexOf("--fixed-addresses");
const fixedAddresses = fixedIdx >= 0;
if (fixedAddresses) args.splice(fixedIdx, 1);
const sessionsIdx = args.indexOf("--sessions");
const sessions = sessionsIdx >= 0;
if (sessions) args.splice(sessionsIdx, 1);
const outDir = path.resolve(flag("--out") ?? path.join(GUARD_ROOT, "redteam/results"));
const promptsFile = path.resolve(args[0] ?? path.join(GUARD_ROOT, `redteam/level${level}${sessions ? "-sessions" : ""}.jsonl`));

interface Prompt { id: string; category: string; mode?: GuardMode | "both"; lang?: string; redefines_tool?: boolean; prompt?: string; /** the site's JSONL export (docs/attacks/starter.jsonl) uses `message` */ message?: string; payload?: Record<string, string>; turns?: string[] }
type RunLike = Pick<GuardRun, "broken" | "usage" | "seconds" | "breakKind" | "decisionFallback" | "toolCalls" | "reply" | "decision"> & { followUp?: boolean } & { brokenAtTurn?: number | null; turns?: GuardSession["turns"] };
const rawMessageOf = (p: Prompt) => p.payload ? JSON.stringify(p.payload) : p.prompt ?? p.message ?? "";
/**
 * Placeholder recipient addresses used in the attack files. Other addresses in the attacks (the zero
 * address, 0xEeee…/0xFfff… sentinels, a real router, the treasury's own address) are part of the story
 * and stay as written.
 */
export const PLACEHOLDER_ADDRESSES = [
  "0x2222222222222222222222222222222222222222",
  "0x7a3b5c1e9d2f4a6b8c0e1d3f5a7b9c2d4e6f8a01",
  "0x6c1e9b7d3f5a0c8e6b4d2f0a9c7e5b3d1f8d4f2a",
  "0x55aa11bb22cc33dd44ee55ff66aa77bb88cc99dd",
];
/** Replaces placeholder addresses with fresh random ones (one per placeholder, shared across a session's turns). */
export function freshAddresses(text: string, map: Map<string, string>): string {
  return text.replace(/0x[0-9a-fA-F]{40}/g, (a) => {
    const k = a.toLowerCase();
    if (!PLACEHOLDER_ADDRESSES.includes(k)) return a;
    if (!map.has(k)) map.set(k, privateKeyToAccount(generatePrivateKey()).address);
    return map.get(k)!;
  });
}
const addrText = (text: string, map: Map<string, string>) => (fixedAddresses ? text : freshAddresses(text, map));
const messageOf = (p: Prompt, map = new Map<string, string>()) => addrText(rawMessageOf(p), map);
type Result = { p: Prompt; run?: RunLike; error?: string; /** the message(s) actually sent, after address substitution */ sent?: string | string[] };
interface Cell { model: string; mode: GuardMode; version: GuardVersion; results: Result[] }

let prompts: Prompt[] = fs.readFileSync(promptsFile, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
if (only) prompts = prompts.filter((p) => only.includes(p.id));
if (langs) prompts = prompts.filter((p) => langs.includes(p.lang ?? "en"));
const forMode = (m: GuardMode) => prompts.filter((p) => (p.mode ?? "both") === "both" || p.mode === m);

// Every model call goes through this budget; once it is spent, further calls fail and no new attempts start.
let callsMade = 0;
const budgetSpent = () => callsMade >= maxCalls;
const counted = (m: ModelAdapter): ModelAdapter => ({
  id: m.id,
  complete(messages: ChatMessage[], tools: ToolDef[], opts?: CompleteOptions) {
    if (budgetSpent()) return Promise.reject(new Error(`call budget of ${maxCalls} reached`));
    callsMade += 1;
    return m.complete(messages, tools, opts);
  },
});
const models: ModelAdapter[] = (modelsArg ? modelsArg.split(",").map((s) => modelFromSpec(s.trim())) : [modelFromEnv()]).map(counted);
console.log(`red team: ${prompts.length} prompts, level ${level}, models ${models.map((m) => m.id).join(", ")}, modes ${modes.join(", ")}, versions ${versions.join(", ")}, addresses ${fixedAddresses ? "fixed (as written)" : "fresh random per run"}`);

async function runCell(model: ModelAdapter, mode: GuardMode, version: GuardVersion): Promise<Cell | null> {
  const list = forMode(mode).flatMap((p) => Array.from({ length: repeat }, () => p));
  if (!ownInstructions && !fs.existsSync(levelFile(level, version, GUARD_ROOT, mode))) { console.log(`(skipping ${mode} ${version}: no instruction file)`); return null; }
  const instructions = fs.readFileSync(ownInstructions ? path.resolve(ownInstructions) : levelFile(level, version, GUARD_ROOT, mode), "utf8");
  const results: Result[] = new Array(list.length);
  const tag = `[${model.id} ${mode} ${version}]`;
  let next = 0;
  const worker = async () => {
    while (next < list.length && !budgetSpent()) {
      const i = next++;
      const p = list[i];
      try {
        let run: RunLike;
        if (sessions) {
          const map = new Map<string, string>();
          const sess = await runSession({ level, mode, instructions, turns: (p.turns ?? []).map((t) => addrText(t, map)), model });
          const last = sess.turns[sess.turns.length - 1];
          run = { followUp: sess.turns.some((t) => t.followUp), broken: sess.broken, usage: sess.usage, seconds: sess.seconds, breakKind: sess.breakKind, decisionFallback: false, toolCalls: sess.turns.flatMap((t) => t.toolCalls), reply: last?.reply ?? "", decision: null, brokenAtTurn: sess.brokenAtTurn, turns: sess.turns };
        } else run = await runGuard({ level, mode, instructions, message: messageOf(p), model, noForceTool });
        results[i] = { p, run, sent: run.turns ? run.turns.map((t) => t.message) : (run as RunLike & { message?: string }).message };
        const extra = run.broken ? "  calls: " + run.toolCalls.map((c) => `${c.name}(${JSON.stringify(c.args)})`).join(", ") : run.decisionFallback ? "  (no decision tool called: recorded as reject)" : "";
        console.log(`${tag} ${run.broken ? "BROKE" : "held "}  ${p.id}  ${p.category}${run.brokenAtTurn ? ` (turn ${run.brokenAtTurn})` : ""}${extra}`);
      } catch (e) {
        results[i] = { p, error: redact(String((e as Error)?.message ?? e)) };
        console.log(`${tag} ERROR  ${p.id}  ${results[i].error}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
  return { model: model.id, mode, version, results: results.filter(Boolean) };
}

const cells: Cell[] = [];
for (const model of models) for (const mode of modes) for (const version of versions) {
  const c = await runCell(model, mode, version);
  if (c) cells.push(c);
}

const fmt = (n: number, d = 0) => (Number.isFinite(n) ? n.toFixed(d) : "n/a");
function stats(c: Cell) {
  const ran = c.results.filter((r) => r.run);
  const broke = ran.filter((r) => r.run!.broken);
  const withUsage = ran.filter((r) => r.run!.usage);
  const tin = withUsage.reduce((s, r) => s + r.run!.usage!.inputTokens, 0);
  const tout = withUsage.reduce((s, r) => s + r.run!.usage!.outputTokens, 0);
  const secs = ran.reduce((s, r) => s + r.run!.seconds, 0);
  return {
    ran: ran.length, broke: broke.length, errors: c.results.length - ran.length,
    ids: [...broke.reduce((m, r) => m.set(r.p.id, (m.get(r.p.id) ?? 0) + 1), new Map<string, number>())].map(([id, n]) => (n > 1 ? `${id}×${n}` : id)),
    fallbacks: ran.filter((r) => r.run!.decisionFallback).length,
    followUps: ran.filter((r) => r.run!.followUp).length,
    misfires: broke.filter((r) => r.run!.breakKind === "misfire").length,
    persuaded: broke.filter((r) => r.run!.breakKind === "persuaded").length,
    tokensIn: withUsage.length ? tin : NaN, tokensOut: withUsage.length ? tout : NaN,
    avgIn: withUsage.length ? tin / withUsage.length : NaN, avgOut: withUsage.length ? tout / withUsage.length : NaN,
    totalSeconds: secs, avgSeconds: ran.length ? secs / ran.length : NaN,
    breakTurns: broke.map((r) => r.run!.brokenAtTurn).filter((t): t is number => typeof t === "number").reduce((m, t) => ({ ...m, [t]: (m[t] ?? 0) + 1 }), {} as Record<number, number>),
  };
}

console.log("");
const W = Math.max(5, ...cells.map((c) => c.model.length));
console.log(`model calls made: ${callsMade}${Number.isFinite(maxCalls) ? ` of ${maxCalls} allowed` : ""}`);
console.log(`${"model".padEnd(W)}  mode    version  broke/run    rate  misfire/persuaded  errors  no-decision  tokens in/out (total)   avg in  avg out  avg s  broken by`);
for (const c of cells) {
  const s = stats(c);
  console.log([
    c.model.padEnd(W), c.mode.padEnd(6), c.version.padEnd(7), `${s.broke}/${s.ran}`.padStart(9), (s.ran ? `${((100 * s.broke) / s.ran).toFixed(1)}%` : "n/a").padStart(6), `${s.misfires}/${s.persuaded}`.padStart(17), String(s.errors).padStart(6),
    String(c.mode === "decide" ? `${s.fallbacks} (${s.followUps} re-asked)` : "-").padStart(11), `${fmt(s.tokensIn)}/${fmt(s.tokensOut)}`.padStart(22),
    fmt(s.avgIn).padStart(7), fmt(s.avgOut).padStart(8), fmt(s.avgSeconds, 1).padStart(6), s.ids.join(", ") || "-",
  ].join("  "));
}

if (sessions) {
  console.log("\nbreak turn (sessions):");
  for (const c of cells) console.log(`  ${c.model} ${c.mode} ${c.version}: ${JSON.stringify(stats(c).breakTurns)}`);
}

// Category breakdown per cell.
for (const c of cells) {
  const byCat = new Map<string, { n: number; b: number }>();
  for (const r of c.results) {
    if (!r.run) continue;
    const k = r.p.category + (r.p.lang && r.p.lang !== "en" ? ` (${r.p.lang})` : "");
    const x = byCat.get(k) ?? { n: 0, b: 0 };
    x.n += 1; if (r.run.broken) x.b += 1;
    byCat.set(k, x);
  }
  console.log(`\n${c.model} ${c.mode} ${c.version} by category:`);
  for (const [cat, x] of [...byCat].sort()) console.log(`  ${cat.padEnd(24)} ${x.b}/${x.n}`);
}

fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `level${level}-${sessions ? "sessions-" : ""}${modes.join("-")}-${versions.join("-")}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
fs.writeFileSync(outFile, JSON.stringify({
  level, promptsFile, addresses: fixedAddresses ? "fixed" : "fresh",
  cells: cells.map((c) => ({
    model: c.model, mode: c.mode, version: c.version, summary: stats(c),
    results: c.results.map((r) => ({ ...r.p, sent: r.sent, broken: r.run?.broken ?? null, breakKind: r.run?.breakKind ?? null, followUp: r.run?.followUp ?? null, brokenAtTurn: r.run?.brokenAtTurn ?? null, turnsRun: r.run?.turns?.map((t) => ({ reply: t.reply, toolCalls: t.toolCalls })) ?? undefined, decision: r.run?.decision ?? null, decisionFallback: r.run?.decisionFallback ?? null, error: r.error ?? null, reply: r.run?.reply, toolCalls: r.run?.toolCalls, usage: r.run?.usage ?? null, seconds: r.run?.seconds ?? null })),
  })),
}, null, 2));
console.log(`\ntranscripts: ${path.relative(process.cwd(), outFile)}`);
process.exit(cells.some((c) => c.results.some((r) => r.run?.broken)) ? 1 : 0);

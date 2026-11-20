// Usage: npm run redteam -- [promptsFile] [--version v1|v2|v3|all] [--level 1] [--concurrency 4] [--only id1,id2] [--out DIR]
// Runs each prompt against the guard through the model from env (MODEL_PROVIDER, MODEL_NAME,
// MODEL_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY) and prints, per instruction version, how many
// broke it and which. --version defaults to GUARD_VERSION (default v1); `all` runs v1, v2 and v3.
// Full transcripts go to redteam/results/ (gitignored). Exit code 1 if anything broke.
import fs from "node:fs";
import path from "node:path";
import { modelFromEnv } from "../src/model/index.ts";
import { runGuard, type GuardRun } from "../src/guard.ts";
import { redact } from "../src/model/redact.ts";
import { GUARD_ROOT } from "../src/config.ts";
import { VERSIONS, resolveVersion, levelFile, type GuardVersion } from "../src/levels.ts";

const envFile = path.join(GUARD_ROOT, ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const level = Number(flag("--level") ?? 1);
const versionArg = flag("--version") ?? process.env.GUARD_VERSION;
const versions: GuardVersion[] = versionArg === "all" ? [...VERSIONS] : [resolveVersion(versionArg)];
const concurrency = Math.max(1, Number(flag("--concurrency") ?? 4));
const only = flag("--only")?.split(",");
const outDir = path.resolve(flag("--out") ?? path.join(GUARD_ROOT, "redteam/results"));
const promptsFile = path.resolve(args[0] ?? path.join(GUARD_ROOT, `redteam/level${level}.jsonl`));

interface Prompt { id: string; category: string; redefines_tool?: boolean; prompt: string }
type Result = { p: Prompt; run?: GuardRun; error?: string };

let prompts: Prompt[] = fs.readFileSync(promptsFile, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
if (only) prompts = prompts.filter((p) => only.includes(p.id));
const model = modelFromEnv();
console.log(`red team: ${prompts.length} prompts, level ${level}, versions ${versions.join(", ")}, model ${model.id}`);

async function runVersion(version: GuardVersion): Promise<Result[]> {
  const instructions = fs.readFileSync(levelFile(level, version), "utf8");
  const results: Result[] = new Array(prompts.length);
  let next = 0;
  const worker = async () => {
    while (next < prompts.length) {
      const i = next++;
      const p = prompts[i];
      try {
        const run = await runGuard({ level, instructions, message: p.prompt, model });
        results[i] = { p, run };
        console.log(`[${version}] ${run.broken ? "BROKE" : "held "}  ${p.id}  ${p.category}${run.broken ? "  calls: " + run.toolCalls.map((c) => `${c.name}(${JSON.stringify(c.args)})`).join(", ") : ""}`);
      } catch (e) {
        results[i] = { p, error: redact(String((e as Error)?.message ?? e)) };
        console.log(`[${version}] ERROR  ${p.id}  ${results[i].error}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, prompts.length) }, worker));
  return results;
}

const all = new Map<GuardVersion, Result[]>();
for (const v of versions) all.set(v, await runVersion(v));

// Per-version summary table.
console.log("");
console.log("version  run  broke  errors  broken by");
for (const [v, results] of all) {
  const ran = results.filter((r) => r.run);
  const broke = ran.filter((r) => r.run!.broken);
  const errs = results.length - ran.length;
  console.log(`${v.padEnd(7)}  ${String(ran.length).padStart(3)}  ${String(broke.length).padStart(5)}  ${String(errs).padStart(6)}  ${broke.map((r) => r.p.id).join(", ") || "-"}`);
}

// Category breakdown for each version.
for (const [v, results] of all) {
  const byCat = new Map<string, { n: number; b: number }>();
  for (const r of results) {
    if (!r.run) continue;
    const c = byCat.get(r.p.category) ?? { n: 0, b: 0 };
    c.n += 1; if (r.run.broken) c.b += 1;
    byCat.set(r.p.category, c);
  }
  const redef = results.filter((r) => r.run && r.p.redefines_tool);
  console.log(`\n${v} by category:`);
  for (const [cat, c] of byCat) console.log(`  ${cat.padEnd(18)} ${c.b}/${c.n}`);
  console.log(`  ${"(redefines a tool)".padEnd(18)} ${redef.filter((r) => r.run!.broken).length}/${redef.length}`);
}

fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `level${level}-${versions.join("-")}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
fs.writeFileSync(outFile, JSON.stringify({
  model: model.id, level, promptsFile,
  versions: Object.fromEntries([...all].map(([v, results]) => [v, results.map((r) => ({ ...r.p, broken: r.run?.broken ?? null, error: r.error ?? null, reply: r.run?.reply, toolCalls: r.run?.toolCalls }))])),
}, null, 2));
console.log(`\ntranscripts: ${path.relative(process.cwd(), outFile)}`);
process.exit([...all.values()].some((rs) => rs.some((r) => r.run?.broken)) ? 1 : 0);

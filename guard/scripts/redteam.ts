// Usage: npm run redteam -- [promptsFile] [--level 1] [--instructions levels/level1.md] [--concurrency 4] [--only id1,id2]
// Runs each prompt against the guard through the real model from env (MODEL_PROVIDER, MODEL_NAME,
// MODEL_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY) and prints how many broke it and which.
// Full transcripts are written to redteam/results/ (gitignored). Exit code 1 if anything broke.
import fs from "node:fs";
import path from "node:path";
import { modelFromEnv } from "../src/model/index.ts";
import { runGuard, type GuardRun } from "../src/guard.ts";
import { redact } from "../src/model/redact.ts";
import { GUARD_ROOT } from "../src/config.ts";

const envFile = path.join(GUARD_ROOT, ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const level = Number(flag("--level") ?? 1);
const instructionsFile = path.resolve(flag("--instructions") ?? path.join(GUARD_ROOT, `levels/level${level}.md`));
const concurrency = Math.max(1, Number(flag("--concurrency") ?? 4));
const only = flag("--only")?.split(",");
const promptsFile = path.resolve(args[0] ?? path.join(GUARD_ROOT, `redteam/level${level}.jsonl`));

interface Prompt { id: string; category: string; redefines_tool?: boolean; prompt: string }
let prompts: Prompt[] = fs.readFileSync(promptsFile, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
if (only) prompts = prompts.filter((p) => only.includes(p.id));

const model = modelFromEnv();
const instructions = fs.readFileSync(instructionsFile, "utf8");
console.log(`red team: ${prompts.length} prompts, level ${level}, model ${model.id}, instructions ${path.relative(process.cwd(), instructionsFile)}`);

type Result = { p: Prompt; run?: GuardRun; error?: string };
const results: Result[] = new Array(prompts.length);
let next = 0;
async function worker() {
  while (next < prompts.length) {
    const i = next++;
    const p = prompts[i];
    try {
      const run = await runGuard({ level, instructions, message: p.prompt, model });
      results[i] = { p, run };
      console.log(`${run.broken ? "BROKE" : "held "}  ${p.id}  ${p.category}${run.broken ? "  calls: " + run.toolCalls.map((c) => `${c.name}(${JSON.stringify(c.args)})`).join(", ") : ""}`);
    } catch (e) {
      results[i] = { p, error: redact(String((e as Error)?.message ?? e)) };
      console.log(`ERROR  ${p.id}  ${results[i].error}`);
    }
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, prompts.length) }, worker));

const broke = results.filter((r) => r.run?.broken);
const errors = results.filter((r) => r.error);
const ran = results.length - errors.length;
console.log("");
console.log(`broke the guard: ${broke.length} / ${ran}${errors.length ? `  (${errors.length} errored, not counted)` : ""}`);
const byCat = new Map<string, { n: number; b: number }>();
for (const r of results) {
  if (!r.run) continue;
  const c = byCat.get(r.p.category) ?? { n: 0, b: 0 };
  c.n += 1; if (r.run.broken) c.b += 1;
  byCat.set(r.p.category, c);
}
for (const [cat, c] of byCat) console.log(`  ${cat.padEnd(18)} ${c.b}/${c.n}`);
const redef = results.filter((r) => r.run && r.p.redefines_tool);
console.log(`  ${"(redefines a tool)".padEnd(18)} ${redef.filter((r) => r.run!.broken).length}/${redef.length}`);
if (broke.length) {
  console.log("\nprompts that broke it:");
  for (const r of broke) console.log(`  ${r.p.id} [${r.p.category}] ${r.p.prompt.slice(0, 100).replace(/\s+/g, " ")}${r.p.prompt.length > 100 ? "…" : ""}`);
}

const outDir = path.join(GUARD_ROOT, "redteam/results");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `level${level}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
fs.writeFileSync(outFile, JSON.stringify({ model: model.id, level, instructionsFile, promptsFile, results: results.map((r) => ({ ...r.p, broken: r.run?.broken ?? null, error: r.error ?? null, reply: r.run?.reply, toolCalls: r.run?.toolCalls })) }, null, 2));
console.log(`\ntranscripts: ${path.relative(process.cwd(), outFile)}`);
process.exit(broke.length ? 1 : 0);

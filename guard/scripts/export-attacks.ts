// Exports the decide-mode attacks that the launch guards hold as a starter library, in the same JSONL
// shape as the site's round download (plus id, category, lang, mode), to docs/attacks/starter.jsonl.
//
//   npx tsx scripts/export-attacks.ts --held <v2 results.json> --held <v3 results.json> [--reply-from <results.json>] [--out FILE]
//
// An attack is exported only if it ran and held in every --held results file (red-team transcripts from
// `npm run redteam`), so nothing unpatched is published. `reply` is Argus's reply from --reply-from
// (default: the first --held file). Messages are exported as written, with placeholder addresses; the
// red-team harness swaps those for a fresh random address on every run.
import fs from "node:fs";
import path from "node:path";
import { keccak256, stringToHex } from "viem";
import { GUARD_ROOT } from "../src/config.ts";

const args = process.argv.slice(2);
const all = (name: string) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
const held = all("--held");
if (!held.length) { console.error("pass at least one --held <results.json>"); process.exit(2); }
const replyFrom = all("--reply-from")[0] ?? held[0];
const out = path.resolve(all("--out")[0] ?? path.join(GUARD_ROOT, "../docs/attacks/starter.jsonl"));

type Row = { id: string; broken: boolean | null; error: string | null; reply?: string };
const load = (f: string) => {
  const d = JSON.parse(fs.readFileSync(f, "utf8"));
  const rows = new Map<string, Row[]>();
  for (const c of d.cells) for (const r of c.results as Row[]) rows.set(r.id, [...(rows.get(r.id) ?? []), r]);
  return { rows, label: d.cells.map((c: any) => `${c.model} ${c.mode} ${c.version}`).join(", ") };
};
const heldSets = held.map(load);
const replies = load(replyFrom).rows;
const attacks = fs.readFileSync(path.join(GUARD_ROOT, "redteam/level1.jsonl"), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)).filter((p) => p.mode === "decide");

const lines: string[] = [];
const skipped: string[] = [];
for (const [i, p] of attacks.entries()) {
  const ok = heldSets.every((s) => { const rs = s.rows.get(p.id); return rs?.length && rs.every((r) => r.broken === false && !r.error); });
  if (!ok) { skipped.push(p.id); continue; }
  lines.push(JSON.stringify({
    round: null, level: 1, attempt: i, attacker: null, name: null, time: null,
    outcome: "held", hidden: false, breakKind: null, decision: "reject",
    messageHash: keccak256(stringToHex(p.prompt)), tx: null, message: p.prompt, reply: replies.get(p.id)?.[0]?.reply ?? null,
    id: p.id, category: p.category, lang: p.lang ?? "en", mode: "decide",
  }));
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, lines.join("\n") + "\n");
console.log(`exported ${lines.length} attacks to ${path.relative(process.cwd(), out)}; held by: ${heldSets.map((s) => s.label).join(" | ")}`);
if (skipped.length) console.log(`not exported (broke or did not run): ${skipped.join(", ")}`);

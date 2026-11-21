// Usage: GUARD_VERSION=v1 GUARD_MODE=decide npm run commit -- [--version v1|v2|v3] [--mode refuse|decide|reader]
//          [--model provider/model] [--max-turns 6] [--level 1] [--file path] [--out DIR]
// --model fixes the model the round runs on (default: MODEL_PROVIDER/MODEL_NAME from env or guard/.env).
// Builds the committed bytes: a header (model, mode, version, hash of the tool definitions, max turns,
// follow-up line; layout in web/API.md) then the chosen instructions (levels/level<N>/<version>.md by
// default). Hashes them with a fresh random 32-byte salt and prints the guardCommit to pass to
// openRound(). Stores the salt and the exact committed bytes in a local, gitignored file; the salt is
// the only private part until the reveal after the round.
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { bytesToHex } from "viem";
import { makeHeaderedRecord, saveRecord, committedHeader } from "../src/commit.ts";
import { GUARD_ROOT } from "../src/config.ts";
import { resolveVersion, resolveMode, levelFile } from "../src/levels.ts";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const level = Number(flag("--level") ?? 1);
const explicitFile = flag("--file");
const version = explicitFile ? undefined : resolveVersion(flag("--version") ?? process.env.GUARD_VERSION);
const mode = resolveMode(flag("--mode") ?? process.env.GUARD_MODE);
const envFile = path.join(GUARD_ROOT, ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const model = flag("--model") ?? (process.env.MODEL_PROVIDER ? `${process.env.MODEL_PROVIDER}/${process.env.MODEL_NAME || (process.env.MODEL_PROVIDER === "anthropic" ? "claude-opus-5-5" : "")}` : undefined);
if (model !== undefined && !/^[a-z]+\/[A-Za-z0-9._:-]+$/.test(model)) { console.error(`--model must look like provider/model, got "${model}"`); process.exit(2); }
if (!model) { console.error("no model: pass --model provider/model or set MODEL_PROVIDER/MODEL_NAME (the model is part of the commit)"); process.exit(2); }
const maxTurns = Number(flag("--max-turns") || process.env.MAX_TOOL_TURNS || 6);
if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 99) { console.error("--max-turns must be an integer 1..99"); process.exit(2); }
const outDir = path.resolve(flag("--out") ?? path.join(GUARD_ROOT, ".secrets/commits"));
if (args.length) { console.error(`unexpected arguments: ${args.join(" ")}`); process.exit(2); }
const file = path.resolve(explicitFile ?? levelFile(level, version!, GUARD_ROOT, mode));

const instructions = new Uint8Array(fs.readFileSync(file));
const salt = bytesToHex(randomBytes(32));
const rec = makeHeaderedRecord(salt, instructions, { level, mode, version: version ?? "custom", model, maxTurns, sourceFile: path.relative(GUARD_ROOT, file) });
const h = committedHeader(rec)!;
const stored = saveRecord(outDir, rec);

console.log(`guardCommit: ${rec.commit}`);
console.log(`level:       ${level}`);
console.log(`version:     ${h.version}`);
console.log(`mode:        ${h.mode}`);
console.log(`model:       ${h.model}`);
console.log(`tools:       ${h.toolsHash}`);
console.log(`max turns:   ${h.maxTurns}`);
console.log(`follow-up:   ${h.followUp}`);
console.log(`source:      ${rec.sourceFile} (${instructions.length} bytes of instructions, ${(rec.instructionsHex.length - 2) / 2} committed with the header)`);
console.log(`stored:      ${stored}  (salt + committed bytes; the salt stays private until the reveal; do not commit this file)`);

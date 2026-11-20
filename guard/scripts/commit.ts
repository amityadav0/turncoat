// Usage: GUARD_VERSION=v1 GUARD_MODE=decide npm run commit -- [--version v1|v2|v3] [--mode refuse|decide|reader]
//          [--model provider/model] [--level 1] [--file path] [--out DIR]
// --model fixes the model the round runs on (default: MODEL_PROVIDER/MODEL_NAME from env or guard/.env).
// Hashes the chosen guard instructions (levels/level<N>/<version>.md by default) with a fresh
// random 32-byte salt and prints the guardCommit to pass to openRound(). Stores the salt, the
// exact instruction bytes and the version in a local, gitignored file for the reveal after the round.
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { bytesToHex } from "viem";
import { makeRecord, saveRecord } from "../src/commit.ts";
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
const outDir = path.resolve(flag("--out") ?? path.join(GUARD_ROOT, ".secrets/commits"));
if (args.length) { console.error(`unexpected arguments: ${args.join(" ")}`); process.exit(2); }
const file = path.resolve(explicitFile ?? levelFile(level, version!, GUARD_ROOT, mode));

const instructions = new Uint8Array(fs.readFileSync(file));
const salt = bytesToHex(randomBytes(32));
const rec = makeRecord(salt, instructions, level, path.relative(GUARD_ROOT, file), version, mode, model);
const stored = saveRecord(outDir, rec);

console.log(`guardCommit: ${rec.commit}`);
console.log(`level:       ${level}`);
console.log(`version:     ${version ?? "(custom file)"}`);
console.log(`mode:        ${mode}`);
console.log(`model:       ${model ?? "(none: the service's model when it first sees the round)"}`);
console.log(`source:      ${rec.sourceFile} (${instructions.length} bytes)`);
console.log(`stored:      ${stored}  (salt + instructions; keep private until reveal, do not commit)`);

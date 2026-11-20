// Usage: npm run commit -- [levelFile] [--level N] [--out DIR]
// Hashes the guard instructions with a fresh random 32-byte salt and prints the guardCommit to
// pass to openRound(). Stores salt + exact instruction bytes in a local, gitignored file so the
// guard service can run them and so they can be revealed with revealGuard() after the round.
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { bytesToHex } from "viem";
import { makeRecord, saveRecord } from "../src/commit.ts";
import { GUARD_ROOT } from "../src/config.ts";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const level = Number(flag("--level") ?? 1);
const outDir = path.resolve(flag("--out") ?? path.join(GUARD_ROOT, ".secrets/commits"));
const file = path.resolve(args[0] ?? path.join(GUARD_ROOT, "levels/level1.md"));

const instructions = new Uint8Array(fs.readFileSync(file));
const salt = bytesToHex(randomBytes(32));
const rec = makeRecord(salt, instructions, level, path.relative(GUARD_ROOT, file));
const stored = saveRecord(outDir, rec);

console.log(`guardCommit: ${rec.commit}`);
console.log(`level:       ${level}`);
console.log(`source:      ${rec.sourceFile} (${instructions.length} bytes)`);
console.log(`stored:      ${path.relative(process.cwd(), stored)}  (salt + instructions; keep private until reveal, do not commit)`);

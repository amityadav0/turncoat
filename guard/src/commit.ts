// guardCommit = keccak256(abi.encodePacked(bytes32 salt, bytes instructions)).
// Commit records (salt + exact instruction bytes) are kept in a local, gitignored directory
// so the same bytes can be run during the round and revealed after it.
import fs from "node:fs";
import path from "node:path";
import { concat, keccak256, bytesToHex, hexToBytes, type Hex } from "viem";

export interface CommitRecord {
  commit: Hex;
  salt: Hex;
  level: number;
  /** Exact bytes that were hashed, hex-encoded (this is what revealGuard takes). */
  instructionsHex: Hex;
  sourceFile: string;
  createdAt: string;
}

export function computeCommit(salt: Hex, instructions: Uint8Array): Hex {
  if (hexToBytes(salt).length !== 32) throw new Error("salt must be 32 bytes");
  return keccak256(concat([salt, bytesToHex(instructions)]));
}

export function makeRecord(salt: Hex, instructions: Uint8Array, level: number, sourceFile: string): CommitRecord {
  return { commit: computeCommit(salt, instructions), salt, level, instructionsHex: bytesToHex(instructions), sourceFile, createdAt: new Date().toISOString() };
}

export function saveRecord(dir: string, rec: CommitRecord): string {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${rec.commit}.json`);
  fs.writeFileSync(file, JSON.stringify(rec, null, 2) + "\n", { mode: 0o600 });
  return file;
}

export function instructionsText(rec: CommitRecord): string {
  return new TextDecoder().decode(hexToBytes(rec.instructionsHex));
}

/** Loads every record in `dir`, keyed by commit (lowercase). Records whose hash does not verify are refused. */
export function loadRecords(dir: string): Map<string, CommitRecord> {
  const out = new Map<string, CommitRecord>();
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const rec = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as CommitRecord;
    const actual = computeCommit(rec.salt, hexToBytes(rec.instructionsHex));
    if (actual.toLowerCase() !== rec.commit.toLowerCase()) throw new Error(`commit record ${f} does not match its own hash`);
    out.set(rec.commit.toLowerCase(), rec);
  }
  return out;
}


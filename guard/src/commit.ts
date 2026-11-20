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
  /** Instruction version (v1, v2, v3) these bytes came from; absent for ad-hoc files. */
  version?: string;
  /** Guard mode ("refuse" | "decide" | "reader"); absent means "refuse". */
  mode?: string;
  /** Model the round runs on, "provider/model", fixed when the record is made (before the round opens). */
  model?: string;
  /** Exact bytes that were hashed, hex-encoded (this is what revealGuard takes). */
  instructionsHex: Hex;
  sourceFile: string;
  createdAt: string;
}

export function computeCommit(salt: Hex, instructions: Uint8Array): Hex {
  if (hexToBytes(salt).length !== 32) throw new Error("salt must be 32 bytes");
  return keccak256(concat([salt, bytesToHex(instructions)]));
}

export function makeRecord(salt: Hex, instructions: Uint8Array, level: number, sourceFile: string, version?: string, mode?: string, model?: string): CommitRecord {
  return { commit: computeCommit(salt, instructions), salt, level, version, mode, model, instructionsHex: bytesToHex(instructions), sourceFile, createdAt: new Date().toISOString() };
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


/** Lookup by guardCommit. A Map from loadRecords() works; CommitBook also picks up records added while running. */
export interface CommitLookup {
  get(commit: string): CommitRecord | undefined;
}

/**
 * Commit records from a directory, re-read when a lookup misses (at most every `minReloadMs`), so a
 * round committed with `npm run commit` after the service started is found without a restart.
 */
export class CommitBook implements CommitLookup {
  private records: Map<string, CommitRecord>;
  private lastLoad: number;

  constructor(private dir: string, private minReloadMs = 5000, private now = () => Date.now()) {
    this.records = loadRecords(dir);
    this.lastLoad = this.now();
  }

  get(commit: string): CommitRecord | undefined {
    const key = commit.toLowerCase();
    let rec = this.records.get(key);
    if (!rec && this.now() - this.lastLoad >= this.minReloadMs) {
      this.records = loadRecords(this.dir);
      this.lastLoad = this.now();
      rec = this.records.get(key);
    }
    return rec;
  }

  values(): IterableIterator<CommitRecord> {
    return this.records.values();
  }

  get size(): number {
    return this.records.size;
  }
}

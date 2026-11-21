// guardCommit = keccak256(abi.encodePacked(bytes32 salt, bytes committed)).
// `committed` is a short header naming the model, mode, version, tool definitions, max turns and
// follow-up line, then a blank line, then the instruction text (layout in web/API.md). Records made
// before the header existed commit the instruction text alone and still verify.
// Commit records (salt + exact committed bytes) are kept in a local, gitignored directory so the same
// bytes can be run during the round and revealed after it.
import fs from "node:fs";
import path from "node:path";
import { concat, keccak256, bytesToHex, hexToBytes, stringToHex, type Hex } from "viem";
import { toolsFor } from "./sandbox.ts";
import { DECISION_FOLLOW_UP } from "./guard.ts";

export const HEADER_MAGIC = "turncoat-guard 2";
const HEADER_KEYS = ["level", "mode", "version", "model", "tools-keccak256", "max-turns", "follow-up"] as const;

export interface CommitHeader {
  level: number;
  mode: "refuse" | "decide" | "reader";
  version: string;
  /** "provider/model" the round runs on. */
  model: string;
  /** keccak256 of the UTF-8 bytes of JSON.stringify(tool definitions) for this mode, exactly as sent to the model. */
  toolsHash: Hex;
  maxTurns: number;
  /** The line the service sends when a decide-mode reply ends without a decision; "none" in other modes. */
  followUp: string;
}

/** keccak256 of the tool definitions Argus is given in this mode (name, description, JSON schema), as JSON. */
export function toolsHash(mode: CommitHeader["mode"]): Hex {
  return keccak256(stringToHex(JSON.stringify(toolsFor(mode))));
}

export function followUpFor(mode: CommitHeader["mode"]): string {
  return mode === "decide" ? DECISION_FOLLOW_UP : "none";
}

/** The header as this service would write it today for a round on `model` (what a new commit contains). */
export function currentHeader(o: { level: number; mode: CommitHeader["mode"]; version: string; model: string; maxTurns: number }): CommitHeader {
  return { ...o, toolsHash: toolsHash(o.mode), followUp: followUpFor(o.mode) };
}

export function encodeCommitted(h: CommitHeader, instructions: Uint8Array): Uint8Array {
  const vals: Record<(typeof HEADER_KEYS)[number], string> = {
    level: String(h.level), mode: h.mode, version: h.version, model: h.model,
    "tools-keccak256": h.toolsHash, "max-turns": String(h.maxTurns), "follow-up": h.followUp,
  };
  for (const [k, v] of Object.entries(vals)) if (!v || /[\r\n]/.test(v)) throw new Error(`header ${k} must be one non-empty line`);
  const head = [HEADER_MAGIC, ...HEADER_KEYS.map((k) => `${k}: ${vals[k]}`)].join("\n") + "\n\n";
  return new Uint8Array([...new TextEncoder().encode(head), ...instructions]);
}

/**
 * Splits committed bytes into header and instruction text. Bytes that do not start with the magic
 * line are an older record: no header, all of it is instructions. A malformed header throws.
 */
export function parseCommitted(bytes: Uint8Array): { header: CommitHeader | null; instructions: Uint8Array } {
  const magic = new TextEncoder().encode(HEADER_MAGIC + "\n");
  if (bytes.length < magic.length || magic.some((b, i) => bytes[i] !== b)) return { header: null, instructions: bytes };
  let end = -1;
  for (let i = magic.length - 1; i + 1 < bytes.length; i++) if (bytes[i] === 10 && bytes[i + 1] === 10) { end = i; break; }
  if (end < 0) throw new Error("committed header has no blank line after it");
  const lines = new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(magic.length, end)).split("\n");
  if (lines.length !== HEADER_KEYS.length) throw new Error(`committed header must have ${HEADER_KEYS.length} lines`);
  const v: Record<string, string> = {};
  lines.forEach((line, i) => {
    const k = HEADER_KEYS[i];
    if (!line.startsWith(`${k}: `) || line.length === k.length + 2) throw new Error(`committed header line ${i + 2} must be "${k}: <value>"`);
    v[k] = line.slice(k.length + 2);
  });
  const level = Number(v.level), maxTurns = Number(v["max-turns"]);
  if (!/^[1-9]\d*$/.test(v.level)) throw new Error("committed header: bad level");
  if (v.mode !== "refuse" && v.mode !== "decide" && v.mode !== "reader") throw new Error("committed header: bad mode");
  if (!/^0x[0-9a-f]{64}$/.test(v["tools-keccak256"])) throw new Error("committed header: bad tools-keccak256");
  if (!/^[1-9]\d?$/.test(v["max-turns"])) throw new Error("committed header: bad max-turns");
  return {
    header: { level, mode: v.mode, version: v.version, model: v.model, toolsHash: v["tools-keccak256"] as Hex, maxTurns, followUp: v["follow-up"] },
    instructions: bytes.slice(end + 2),
  };
}

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

/** An older-format record: the instruction text alone is committed (no header). Kept for tests and old rounds. */
export function makeRecord(salt: Hex, instructions: Uint8Array, level: number, sourceFile: string, version?: string, mode?: string, model?: string): CommitRecord {
  return { commit: computeCommit(salt, instructions), salt, level, version, mode, model, instructionsHex: bytesToHex(instructions), sourceFile, createdAt: new Date().toISOString() };
}

/** A record whose committed bytes carry the header: model, mode, version, tools, max turns and follow-up are fixed by the hash. */
export function makeHeaderedRecord(salt: Hex, instructions: Uint8Array, o: { level: number; mode: CommitHeader["mode"]; version: string; model: string; maxTurns: number; sourceFile: string }): CommitRecord {
  const bytes = encodeCommitted(currentHeader(o), instructions);
  return { commit: computeCommit(salt, bytes), salt, level: o.level, version: o.version, mode: o.mode, model: o.model, instructionsHex: bytesToHex(bytes), sourceFile: o.sourceFile, createdAt: new Date().toISOString() };
}

/** The committed header of a record, or null for an older record. */
export function committedHeader(rec: CommitRecord): CommitHeader | null {
  return parseCommitted(hexToBytes(rec.instructionsHex)).header;
}

/**
 * Why this service cannot run a headered round as committed, or null if it can: the tool definitions
 * or follow-up line in this build differ from what the round committed to.
 */
export function headerMismatch(h: CommitHeader): string | null {
  if (h.toolsHash !== toolsHash(h.mode)) return `committed tool definitions (${h.toolsHash}) differ from this service's (${toolsHash(h.mode)})`;
  if (h.followUp !== followUpFor(h.mode)) return "committed follow-up line differs from this service's";
  return null;
}

export function saveRecord(dir: string, rec: CommitRecord): string {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${rec.commit}.json`);
  fs.writeFileSync(file, JSON.stringify(rec, null, 2) + "\n", { mode: 0o600 });
  return file;
}

/** The instruction text only (without the header), as given to the model. */
export function instructionsText(rec: CommitRecord): string {
  return new TextDecoder().decode(parseCommitted(hexToBytes(rec.instructionsHex)).instructions);
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
    const h = committedHeader(rec);
    if (h && (h.level !== rec.level || h.mode !== rec.mode || h.version !== rec.version || h.model !== rec.model)) {
      throw new Error(`commit record ${f}: its level/mode/version/model fields differ from the committed header`);
    }
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

// Guard instruction versions. Each version of a level is a strict superset of the one before:
// v1 is plain, and each break in a round adds rules for the next round.
import fs from "node:fs";
import path from "node:path";
import { GUARD_ROOT } from "./config.ts";

export const VERSIONS = ["v1", "v2", "v3"] as const;
export type GuardVersion = (typeof VERSIONS)[number];

export const MODES = ["refuse", "decide"] as const;
/**
 * refuse: Argus may simply never call a tool (transfer/approve are forbidden).
 * decide: Argus is a treasurer who must end every reply with approve_payment or reject_payment.
 */
export type GuardMode = (typeof MODES)[number];

/** GUARD_MODE (or the given value), default refuse. Throws on anything else. */
export function resolveMode(m: string | undefined = process.env.GUARD_MODE): GuardMode {
  const x = (m ?? "").trim() || "refuse";
  if (!(MODES as readonly string[]).includes(x)) throw new Error(`GUARD_MODE must be one of ${MODES.join(", ")}, got "${x}"`);
  return x as GuardMode;
}

/** GUARD_VERSION (or the given value), default v1. Throws on anything else. */
export function resolveVersion(v: string | undefined = process.env.GUARD_VERSION): GuardVersion {
  const x = (v ?? "").trim() || "v1";
  if (!(VERSIONS as readonly string[]).includes(x)) throw new Error(`GUARD_VERSION must be one of ${VERSIONS.join(", ")}, got "${x}"`);
  return x as GuardVersion;
}

export function levelFile(level: number, version: GuardVersion, root = GUARD_ROOT, mode: GuardMode = "refuse"): string {
  return path.join(root, "levels", mode === "decide" ? `level${level}-decide` : `level${level}`, `${version}.md`);
}

/** Exact bytes of a version's instructions (what gets committed and run). */
export function levelBytes(level: number, version: GuardVersion, root = GUARD_ROOT, mode: GuardMode = "refuse"): Uint8Array {
  return new Uint8Array(fs.readFileSync(levelFile(level, version, root, mode)));
}

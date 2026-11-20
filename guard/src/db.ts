import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { AttemptInfo } from "./chain.ts";

export type AttemptStatus = "queued" | "done" | "expired" | "rejected";

export interface AttemptRow {
  round_id: number;
  attempt_id: number;
  status: AttemptStatus;
  message: string | null;
  received_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  model: string | null;
  guard_commit: string | null;
  reply: string | null;
  tool_calls: string | null; // JSON
  conversation: string | null; // JSON
  stop_reason: string | null;
  broken: number | null;
  note: string | null;
  last_error: string | null;
  retries: number;
  verdict_sig: string | null;
  relayer_tx: string | null;
  relayer_status: string | null;
  relayer_error: string | null;
}

export interface ChainAttemptRow {
  round_id: number;
  attempt_id: number;
  attacker: string;
  paid: number;
  time: number;
  message_hash: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS chain_attempts (
  round_id INTEGER NOT NULL, attempt_id INTEGER NOT NULL,
  attacker TEXT NOT NULL, paid INTEGER NOT NULL, time INTEGER NOT NULL, message_hash TEXT NOT NULL,
  PRIMARY KEY (round_id, attempt_id)
);
CREATE INDEX IF NOT EXISTS chain_attempts_attacker ON chain_attempts (attacker);
CREATE TABLE IF NOT EXISTS attempts (
  round_id INTEGER NOT NULL, attempt_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  message TEXT, received_at TEXT, started_at TEXT, finished_at TEXT,
  model TEXT, guard_commit TEXT, reply TEXT, tool_calls TEXT, conversation TEXT, stop_reason TEXT,
  broken INTEGER, note TEXT, last_error TEXT, retries INTEGER NOT NULL DEFAULT 0,
  verdict_sig TEXT, relayer_tx TEXT, relayer_status TEXT, relayer_error TEXT,
  PRIMARY KEY (round_id, attempt_id)
);
CREATE TABLE IF NOT EXISTS rounds_state (
  round_id INTEGER PRIMARY KEY,
  cursor INTEGER NOT NULL DEFAULT 0,      -- next attemptId to process, strictly in order
  won_attempt INTEGER                     -- first attempt that broke the guard (verdict signed)
);
`;

export class Store {
  readonly db: Database.Database;

  constructor(file: string) {
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);
  }

  close() {
    this.db.close();
  }

  // ---- chain cache (attempts are immutable once on-chain)
  chainAttemptCount(roundId: number): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM chain_attempts WHERE round_id = ?").get(roundId) as { n: number }).n;
  }
  putChainAttempt(roundId: number, attemptId: number, a: AttemptInfo) {
    this.db.prepare("INSERT OR IGNORE INTO chain_attempts VALUES (?,?,?,?,?,?)").run(roundId, attemptId, a.attacker.toLowerCase(), a.paid ? 1 : 0, a.time, a.messageHash);
  }
  chainAttempts(roundId: number): ChainAttemptRow[] {
    return this.db.prepare("SELECT * FROM chain_attempts WHERE round_id = ? ORDER BY attempt_id").all(roundId) as ChainAttemptRow[];
  }
  chainAttemptsBy(attacker: string): ChainAttemptRow[] {
    return this.db.prepare("SELECT * FROM chain_attempts WHERE attacker = ? ORDER BY round_id, attempt_id").all(attacker.toLowerCase()) as ChainAttemptRow[];
  }

  // ---- attempts
  getAttempt(roundId: number, attemptId: number): AttemptRow | undefined {
    return this.db.prepare("SELECT * FROM attempts WHERE round_id = ? AND attempt_id = ?").get(roundId, attemptId) as AttemptRow | undefined;
  }
  attemptsForRound(roundId: number): AttemptRow[] {
    return this.db.prepare("SELECT * FROM attempts WHERE round_id = ? ORDER BY attempt_id").all(roundId) as AttemptRow[];
  }
  /** Returns false if a row for this attempt already exists (it was queued or processed before). */
  insertAttempt(roundId: number, attemptId: number, status: AttemptStatus, message: string | null, note: string | null = null): boolean {
    const r = this.db
      .prepare("INSERT OR IGNORE INTO attempts (round_id, attempt_id, status, message, received_at, note) VALUES (?,?,?,?,?,?)")
      .run(roundId, attemptId, status, message, new Date().toISOString(), note);
    return r.changes === 1;
  }
  updateAttempt(roundId: number, attemptId: number, fields: Partial<AttemptRow>) {
    const keys = Object.keys(fields);
    if (!keys.length) return;
    const sql = `UPDATE attempts SET ${keys.map((k) => `${k} = @${k}`).join(", ")} WHERE round_id = @round_id AND attempt_id = @attempt_id`;
    this.db.prepare(sql).run({ ...fields, round_id: roundId, attempt_id: attemptId });
  }
  roundsWithQueued(): number[] {
    return (this.db.prepare("SELECT DISTINCT round_id FROM attempts WHERE status = 'queued'").all() as { round_id: number }[]).map((r) => r.round_id);
  }
  processedCount(roundId: number): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM attempts WHERE round_id = ? AND status != 'queued'").get(roundId) as { n: number }).n;
  }

  // ---- per-round queue state
  roundState(roundId: number): { cursor: number; won_attempt: number | null } {
    this.db.prepare("INSERT OR IGNORE INTO rounds_state (round_id) VALUES (?)").run(roundId);
    return this.db.prepare("SELECT cursor, won_attempt FROM rounds_state WHERE round_id = ?").get(roundId) as { cursor: number; won_attempt: number | null };
  }
  setCursor(roundId: number, cursor: number) {
    this.db.prepare("UPDATE rounds_state SET cursor = ? WHERE round_id = ?").run(cursor, roundId);
  }
  setWon(roundId: number, attemptId: number) {
    this.db.prepare("UPDATE rounds_state SET won_attempt = ? WHERE round_id = ? AND won_attempt IS NULL").run(attemptId, roundId);
  }
}

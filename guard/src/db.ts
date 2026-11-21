import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { AttemptInfo } from "./chain.ts";

export type AttemptStatus = "queued" | "done" | "expired" | "rejected" | "failed";

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
  tx: string | null;
}

export interface RoundMetaRow {
  round_id: number;
  open_tx: string | null;
  open_block: string | null;
  close_kind: string | null;
  close_tx: string | null;
  closed_at: number | null;
  payout: string | null;
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
CREATE TABLE IF NOT EXISTS round_meta (
  round_id INTEGER PRIMARY KEY,
  open_tx TEXT, open_block TEXT,
  close_kind TEXT, close_tx TEXT, closed_at INTEGER, payout TEXT
);
CREATE TABLE IF NOT EXISTS attempt_txs (
  round_id INTEGER NOT NULL, attempt_id INTEGER NOT NULL, tx TEXT NOT NULL,   -- Attempted transaction, verified from its receipt
  PRIMARY KEY (round_id, attempt_id)
);
CREATE TABLE IF NOT EXISTS reveals (
  round_id INTEGER PRIMARY KEY,
  salt TEXT NOT NULL, instructions TEXT NOT NULL, tx TEXT NOT NULL            -- from a GuardRevealed event (receipt or log)
);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);   -- e.g. last block the optional log scanner read
CREATE TABLE IF NOT EXISTS attacker_names (
  address TEXT PRIMARY KEY,               -- lowercase
  name TEXT,                              -- "<handle>.ai", or NULL if none found
  checked_at INTEGER NOT NULL             -- unix ms
);
CREATE TABLE IF NOT EXISTS rounds_state (
  round_id INTEGER PRIMARY KEY,
  cursor INTEGER NOT NULL DEFAULT 0,      -- next attemptId to process, strictly in order
  won_attempt INTEGER,                    -- first attempt that broke the guard (verdict signed)
  model TEXT                              -- model id configured when the service first saw the round
);
`;

export class Store {
  readonly db: Database.Database;

  constructor(file: string) {
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);
    // Migration: attempt transaction hashes were added after the first release.
    const cols = (this.db.prepare("PRAGMA table_info(chain_attempts)").all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes("tx")) this.db.exec("ALTER TABLE chain_attempts ADD COLUMN tx TEXT");
    const rcols = (this.db.prepare("PRAGMA table_info(rounds_state)").all() as { name: string }[]).map((c) => c.name);
    if (!rcols.includes("model")) this.db.exec("ALTER TABLE rounds_state ADD COLUMN model TEXT");
  }

  close() {
    this.db.close();
  }

  // ---- chain cache (attempts are immutable once on-chain)
  chainAttemptCount(roundId: number): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM chain_attempts WHERE round_id = ?").get(roundId) as { n: number }).n;
  }
  putChainAttempt(roundId: number, attemptId: number, a: AttemptInfo) {
    this.db
      .prepare("INSERT OR IGNORE INTO chain_attempts (round_id, attempt_id, attacker, paid, time, message_hash) VALUES (?,?,?,?,?,?)")
      .run(roundId, attemptId, a.attacker.toLowerCase(), a.paid ? 1 : 0, a.time, a.messageHash);
  }
  /** Records an attempt's transaction (verified by the caller). Works before or after the attempt row is synced. */
  setAttemptTx(roundId: number, attemptId: number, tx: string) {
    this.db.prepare("INSERT INTO attempt_txs VALUES (?,?,?) ON CONFLICT(round_id, attempt_id) DO UPDATE SET tx = excluded.tx").run(roundId, attemptId, tx);
  }
  /** Sets the given round_meta fields, leaving the others as they are. */
  patchRoundMeta(roundId: number, f: Partial<Omit<RoundMetaRow, "round_id">>) {
    const cur = this.roundMeta(roundId) ?? { round_id: roundId, open_tx: null, open_block: null, close_kind: null, close_tx: null, closed_at: null, payout: null };
    this.putRoundMeta({ ...cur, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) });
  }
  putReveal(roundId: number, r: { salt: string; instructions: string; tx: string }) {
    this.db.prepare("INSERT INTO reveals VALUES (?,?,?,?) ON CONFLICT(round_id) DO NOTHING").run(roundId, r.salt, r.instructions, r.tx);
  }
  getReveal(roundId: number): { salt: string; instructions: string; tx: string } | undefined {
    return this.db.prepare("SELECT salt, instructions, tx FROM reveals WHERE round_id = ?").get(roundId) as { salt: string; instructions: string; tx: string } | undefined;
  }
  getKv(key: string): string | undefined {
    return (this.db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined)?.value;
  }
  setKv(key: string, value: string) {
    this.db.prepare("INSERT INTO kv VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }
  roundMeta(roundId: number): RoundMetaRow | undefined {
    return this.db.prepare("SELECT * FROM round_meta WHERE round_id = ?").get(roundId) as RoundMetaRow | undefined;
  }
  putRoundMeta(m: RoundMetaRow) {
    this.db
      .prepare("INSERT INTO round_meta VALUES (@round_id,@open_tx,@open_block,@close_kind,@close_tx,@closed_at,@payout) ON CONFLICT(round_id) DO UPDATE SET open_tx=@open_tx, open_block=@open_block, close_kind=@close_kind, close_tx=@close_tx, closed_at=@closed_at, payout=@payout")
      .run(m);
  }
  chainAttempts(roundId: number): ChainAttemptRow[] {
    return this.db.prepare("SELECT c.round_id, c.attempt_id, c.attacker, c.paid, c.time, c.message_hash, COALESCE(t.tx, c.tx) AS tx FROM chain_attempts c LEFT JOIN attempt_txs t USING (round_id, attempt_id) WHERE c.round_id = ? ORDER BY c.attempt_id").all(roundId) as ChainAttemptRow[];
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
  /** The queued attempt that has waited longest, by when its message arrived. */
  oldestQueued(): { round_id: number; attempt_id: number; received_at: string; n: number } | undefined {
    const n = (this.db.prepare("SELECT COUNT(*) AS n FROM attempts WHERE status = 'queued'").get() as { n: number }).n;
    if (!n) return undefined;
    const r = this.db.prepare("SELECT round_id, attempt_id, received_at FROM attempts WHERE status = 'queued' ORDER BY received_at LIMIT 1").get() as { round_id: number; attempt_id: number; received_at: string };
    return { ...r, n };
  }
  processedCount(roundId: number): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM attempts WHERE round_id = ? AND status != 'queued'").get(roundId) as { n: number }).n;
  }

  // ---- attacker names
  attackerName(address: string): { name: string | null; checked_at: number } | undefined {
    return this.db.prepare("SELECT name, checked_at FROM attacker_names WHERE address = ?").get(address.toLowerCase()) as { name: string | null; checked_at: number } | undefined;
  }
  putAttackerName(address: string, name: string | null, at = Date.now()) {
    this.db.prepare("INSERT INTO attacker_names VALUES (?,?,?) ON CONFLICT(address) DO UPDATE SET name = excluded.name, checked_at = excluded.checked_at").run(address.toLowerCase(), name, at);
  }

  // ---- per-round queue state
  roundState(roundId: number): { cursor: number; won_attempt: number | null } {
    this.db.prepare("INSERT OR IGNORE INTO rounds_state (round_id) VALUES (?)").run(roundId);
    return this.db.prepare("SELECT cursor, won_attempt FROM rounds_state WHERE round_id = ?").get(roundId) as { cursor: number; won_attempt: number | null };
  }
  setCursor(roundId: number, cursor: number) {
    this.db.prepare("UPDATE rounds_state SET cursor = ? WHERE round_id = ?").run(cursor, roundId);
  }
  /**
   * The model a round runs on: recorded the first time the round is seen, then fixed. Returns the
   * recorded id (which differs from `current` if the configured model changed since).
   */
  roundModel(roundId: number, current: string): string {
    this.roundState(roundId);
    this.db.prepare("UPDATE rounds_state SET model = ? WHERE round_id = ? AND model IS NULL").run(current, roundId);
    return (this.db.prepare("SELECT model FROM rounds_state WHERE round_id = ?").get(roundId) as { model: string }).model;
  }
  setWon(roundId: number, attemptId: number) {
    this.db.prepare("UPDATE rounds_state SET won_attempt = ? WHERE round_id = ? AND won_attempt IS NULL").run(attemptId, roundId);
  }
}

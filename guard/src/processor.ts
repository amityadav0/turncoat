// Per-round queue. Attempts in a round are processed strictly in attemptId order: attempt N
// runs only after every attempt < N is done, expired or rejected. This matters because the first
// valid verdict takes the pot, so a later attempt must never be judged before an earlier one.
//
// A missing message cannot block a round forever: if attempt N's message has not arrived within
// MESSAGE_WINDOW_SECONDS of N's on-chain time, N is marked expired and the queue moves on.
import { formatUnits, type Hex } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import type { Store, AttemptRow } from "./db.ts";
import type { TurncoatChain, RoundInfo } from "./chain.ts";
import type { ModelAdapter } from "./model/index.ts";
import { type CommitRecord, instructionsText } from "./commit.ts";
import { runGuard } from "./guard.ts";
import { redact } from "./model/redact.ts";
import type { Logger } from "./log.ts";

export interface ProcessorConfig {
  messageWindowSec: number;
  pollMs: number;
  retryBaseMs: number;
  maxTurns: number;
  tokenDecimals: number;
}

export interface ProcessorDeps {
  store: Store;
  chain: TurncoatChain;
  model: ModelAdapter;
  commits: Map<string, CommitRecord>;
  signer: PrivateKeyAccount;
  cfg: ProcessorConfig;
  log: Logger;
}

export class RoundProcessor {
  private running = new Set<number>();
  private rerun = new Set<number>();
  private timers = new Map<number, NodeJS.Timeout>();
  private waiters = new Map<string, Array<() => void>>();
  private bg = new Set<Promise<unknown>>();
  private stopped = false;

  constructor(private d: ProcessorDeps) {}

  /** Resume every round that has queued work (after a restart). */
  resume() {
    for (const r of this.d.store.roundsWithQueued()) this.kick(r);
  }

  kick(roundId: number) {
    if (this.stopped) return;
    const t = this.timers.get(roundId);
    if (t) { clearTimeout(t); this.timers.delete(roundId); }
    if (this.running.has(roundId)) { this.rerun.add(roundId); return; }
    this.running.add(roundId);
    this.loop(roundId)
      .catch((e) => this.d.log("error", "round loop failed", { roundId, error: redact(String(e?.message ?? e)) }))
      .finally(() => {
        this.running.delete(roundId);
        if (this.rerun.delete(roundId)) this.kick(roundId);
      });
  }

  /** Resolves true once the attempt is no longer queued, false on timeout. */
  waitFor(roundId: number, attemptId: number, ms: number): Promise<boolean> {
    const done = () => { const r = this.d.store.getAttempt(roundId, attemptId); return !!r && r.status !== "queued"; };
    if (done()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const key = `${roundId}:${attemptId}`;
      const timer = setTimeout(() => resolve(done()), ms);
      const list = this.waiters.get(key) ?? [];
      list.push(() => { clearTimeout(timer); resolve(true); });
      this.waiters.set(key, list);
    });
  }

  /** Waits for background relayer work (tests, shutdown). */
  async idle() {
    while (this.running.size || this.bg.size) {
      await Promise.all([...this.bg]);
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  stop() {
    this.stopped = true;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  private notify(roundId: number, attemptId: number) {
    const key = `${roundId}:${attemptId}`;
    for (const f of this.waiters.get(key) ?? []) f();
    this.waiters.delete(key);
  }

  private schedule(roundId: number, ms: number) {
    if (this.stopped) return;
    const t = setTimeout(() => { this.timers.delete(roundId); this.kick(roundId); }, ms);
    t.unref?.();
    this.timers.set(roundId, t);
  }

  private async loop(roundId: number) {
    const { store, chain, cfg } = this.d;
    for (;;) {
      if (this.stopped) return;
      const round = await chain.getRound(roundId);
      if (!round) return;
      const { cursor } = store.roundState(roundId);
      if (cursor >= round.attemptCount) return; // nothing on-chain beyond the cursor yet

      const row = store.getAttempt(roundId, cursor);
      if (row && row.status !== "queued") { store.setCursor(roundId, cursor + 1); this.notify(roundId, cursor); continue; }

      if (row) {
        const finished = await this.process(roundId, round, row);
        if (!finished) {
          const retries = store.getAttempt(roundId, cursor)?.retries ?? 1;
          this.schedule(roundId, cfg.retryBaseMs * 2 ** Math.min(retries - 1, 6));
          return; // do not skip ahead: order is strict
        }
        store.setCursor(roundId, cursor + 1);
        this.notify(roundId, cursor);
        continue;
      }

      // No message for the next attempt yet: wait, or expire it once its window has passed.
      const a = await chain.getAttempt(roundId, cursor);
      if (!a) return;
      const now = await chain.now();
      if (now > a.time + cfg.messageWindowSec) {
        store.insertAttempt(roundId, cursor, "expired", null, `message not delivered within ${cfg.messageWindowSec}s of the attempt`);
        continue; // the next iteration advances the cursor (or processes a message that just raced in)
      }
      this.schedule(roundId, cfg.pollMs);
      return;
    }
  }

  /** Returns true if the attempt reached a final state, false on a transient failure (it will be retried). */
  private async process(roundId: number, round: RoundInfo, row: AttemptRow): Promise<boolean> {
    const { store, chain, model, commits, signer, cfg, log } = this.d;
    const id = row.attempt_id;
    const rec = commits.get(round.guardCommit.toLowerCase());
    if (!rec || rec.level !== round.level) {
      store.updateAttempt(roundId, id, { last_error: `no local instructions match round guardCommit ${round.guardCommit}`, retries: row.retries + 1 });
      log("error", "missing guard instructions for round", { roundId, guardCommit: round.guardCommit });
      return false;
    }

    store.updateAttempt(roundId, id, { started_at: new Date().toISOString() });
    let run;
    try {
      run = await runGuard({
        level: round.level,
        instructions: instructionsText(rec),
        message: row.message!,
        model,
        balances: { USDT: Number(formatUnits(round.pot, cfg.tokenDecimals)), BNB: 0.05 },
        maxTurns: cfg.maxTurns,
      });
    } catch (e) {
      const msg = redact(String((e as Error)?.message ?? e));
      store.updateAttempt(roundId, id, { last_error: msg, retries: row.retries + 1 });
      log("warn", "model call failed; will retry", { roundId, attemptId: id, error: msg });
      return false;
    }

    let sig: Hex | null = null;
    let note: string | null = null;
    if (run.broken) {
      const st = store.roundState(roundId);
      const fresh = await chain.getRound(roundId);
      if (st.won_attempt !== null) note = `guard broken, but attempt ${st.won_attempt} already won this round; no verdict signed`;
      else if (fresh?.closed) note = "guard broken, but the round is already closed on-chain; no verdict signed";
      else {
        const attempt = await chain.getAttempt(roundId, id);
        sig = await chain.signVerdict(signer, roundId, id, attempt!.attacker);
        store.setWon(roundId, id);
      }
    }

    store.updateAttempt(roundId, id, {
      status: "done",
      started_at: run.startedAt,
      finished_at: run.finishedAt,
      model: run.model,
      guard_commit: round.guardCommit,
      reply: run.reply,
      tool_calls: JSON.stringify(run.toolCalls),
      conversation: JSON.stringify(run.conversation),
      stop_reason: run.stopReason,
      broken: run.broken ? 1 : 0,
      note,
      last_error: null,
      verdict_sig: sig,
    });
    log("info", "attempt processed", { roundId, attemptId: id, broken: run.broken, verdict: !!sig });

    if (sig && chain.relayerAddress) await this.relay(roundId, id, sig);
    return true;
  }

  private async relay(roundId: number, attemptId: number, sig: Hex) {
    const { store, chain, log } = this.d;
    try {
      const tx = await chain.sendSettle(roundId, attemptId, sig);
      store.updateAttempt(roundId, attemptId, { relayer_tx: tx, relayer_status: "submitted" });
      const p = chain.waitForReceipt(tx)
        .then((status) => store.updateAttempt(roundId, attemptId, { relayer_status: status }))
        .catch((e) => store.updateAttempt(roundId, attemptId, { relayer_status: "unknown", relayer_error: redact(String(e?.message ?? e)).slice(0, 500) }))
        .finally(() => this.bg.delete(p));
      this.bg.add(p);
    } catch (e) {
      const msg = redact(String((e as { shortMessage?: string })?.shortMessage ?? (e as Error)?.message ?? e)).slice(0, 500);
      store.updateAttempt(roundId, attemptId, { relayer_status: "failed", relayer_error: msg });
      log("warn", "relayer settle failed; verdict is still valid for manual settle", { roundId, attemptId, error: msg });
    }
  }
}

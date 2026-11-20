// Validation of submitted attempts and the read-only views served over HTTP.
import { formatUnits, getAddress, isAddress, keccak256, stringToHex, zeroAddress, type Hex } from "viem";
import type { Store, AttemptRow, ChainAttemptRow } from "./db.ts";
import type { TurncoatChain, RoundInfo } from "./chain.ts";
import type { RoundProcessor } from "./processor.ts";
import { MAX_MESSAGE_CHARS, messageLength, validateMessage } from "./guard.ts";
import { isMode } from "./levels.ts";
import { levelSupported } from "./detector.ts";
import type { CommitLookup } from "./commit.ts";
import { AttackerNames } from "./names.ts";

export interface ServiceConfig {
  /** Model id from config ("provider/model"); recorded per round the first time a round is seen. */
  modelId?: string;
  messageWindowSec: number;
  attemptWaitMs: number;
  tokenDecimals: number;
}

export interface Reply { code: number; body: unknown }

/** keccak256 of the UTF-8 bytes of the message, exactly as the contract stores it. */
export function messageHash(message: string): Hex {
  return keccak256(stringToHex(message));
}

export function hashMatches(message: string, onChain: Hex): boolean {
  return messageHash(message).toLowerCase() === onChain.toLowerCase();
}

function toId(v: unknown): number | null {
  const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

export class GuardService {
  constructor(
    private store: Store,
    private chain: TurncoatChain,
    private proc: RoundProcessor,
    private cfg: ServiceConfig,
    /** Local commit records, keyed by guardCommit (lowercase). Used for the public version label only. */
    private commits: CommitLookup = new Map(),
    names?: AttackerNames,
  ) {
    this.names = names ?? new AttackerNames(store, (a) => chain.agentIdName(a));
  }

  private names: AttackerNames;
  private nameMap = new Map<string, string>();

  /** Resolve names for these addresses into `nameMap` (used by the synchronous view builders). */
  private async loadNames(addresses: string[]) {
    for (const [k, v] of await this.names.resolve(addresses)) this.nameMap.set(k, v);
  }
  private attacker(address: string) {
    const name = this.nameMap.get(address.toLowerCase());
    return name ? { address: getAddress(address), name } : { address: getAddress(address) };
  }

  // ------------------------------------------------------------------ POST /attempts
  async submit(body: unknown): Promise<Reply> {
    const b = (body ?? {}) as Record<string, unknown>;
    const roundId = toId(b.roundId);
    const attemptId = toId(b.attemptId);
    const message = b.message;
    if (roundId === null || attemptId === null || typeof message !== "string" || message.length === 0) {
      return { code: 400, body: { error: "expected { roundId: integer, attemptId: integer, message: non-empty string }" } };
    }

    const round = await this.chain.getRound(roundId);
    if (!round) return { code: 404, body: { error: "no such round" } };
    const attempt = await this.chain.getAttempt(roundId, attemptId);
    if (!attempt) return { code: 404, body: { error: "no such attempt on-chain" } };
    if (!hashMatches(message, attempt.messageHash)) {
      return { code: 400, body: { error: "message does not match the messageHash recorded on-chain for this attempt" } };
    }

    // From here on the sender has proven they hold the exact committed message.
    const existing = this.store.getAttempt(roundId, attemptId);
    if (existing?.status === "expired") {
      return { code: 410, body: { error: `message must be delivered within ${this.cfg.messageWindowSec}s of the on-chain attempt`, attempt: await this.attemptView(roundId, attemptId) } };
    }
    if (existing) {
      return { code: 409, body: { error: `attempt already ${existing.status === "queued" ? "queued" : "processed"}`, attempt: await this.attemptView(roundId, attemptId) } };
    }

    if (messageLength(message) > MAX_MESSAGE_CHARS) {
      // The committed message can never be valid, so record that and let the queue move past it.
      this.store.insertAttempt(roundId, attemptId, "rejected", null, `message longer than ${MAX_MESSAGE_CHARS} characters`);
      this.proc.kick(roundId);
      return { code: 400, body: { error: `message is longer than ${MAX_MESSAGE_CHARS} characters` } };
    }
    const roundRec = this.commits.get(round.guardCommit.toLowerCase());
    const formatError = validateMessage(isMode(roundRec?.mode) ? roundRec.mode : "refuse", message);
    if (formatError) {
      this.store.insertAttempt(roundId, attemptId, "rejected", null, formatError.slice(0, 200));
      this.proc.kick(roundId);
      return { code: 400, body: { error: formatError } };
    }

    const now = await this.chain.now();
    const grace = await this.chain.getSettleGrace();
    if (round.closed) return { code: 409, body: { error: "round is closed" } };
    if (now > round.endTime + grace) return { code: 409, body: { error: "round is past its settle window" } };
    const rec = this.commits.get(round.guardCommit.toLowerCase());
    const mode = isMode(rec?.mode) ? rec.mode : "refuse";
    if (!levelSupported(round.level, mode)) return { code: 422, body: { error: `level ${round.level} is not supported by this guard service` } };
    if (now > attempt.time + this.cfg.messageWindowSec) {
      this.store.insertAttempt(roundId, attemptId, "expired", null, `message not delivered within ${this.cfg.messageWindowSec}s of the attempt`);
      this.proc.kick(roundId);
      return { code: 410, body: { error: `message must be delivered within ${this.cfg.messageWindowSec}s of the on-chain attempt` } };
    }

    if (!this.store.insertAttempt(roundId, attemptId, "queued", message)) {
      return { code: 409, body: { error: "attempt already submitted", attempt: await this.attemptView(roundId, attemptId) } };
    }
    this.proc.kick(roundId);
    const finished = await this.proc.waitFor(roundId, attemptId, this.cfg.attemptWaitMs);
    const view = await this.attemptView(roundId, attemptId);
    return { code: finished ? 200 : 202, body: view };
  }

  // ------------------------------------------------------------------ views
  private async syncAttempts(roundId: number, attemptCount: number): Promise<void> {
    await this.syncAttemptRows(roundId, attemptCount);
    if (this.store.attemptsMissingTx(roundId) > 0) {
      try {
        const r = await this.chain.getRound(roundId);
        const m = r ? await this.meta(roundId, r) : undefined;
        const txs = await this.chain.attemptTxs(roundId, m?.open_block ? BigInt(m.open_block) : 0n);
        for (const [id, tx] of txs) this.store.setAttemptTx(roundId, id, tx);
      } catch {
        /* leave absent */
      }
    }
  }

  private async syncAttemptRows(roundId: number, attemptCount: number): Promise<void> {
    let have = this.store.chainAttemptCount(roundId);
    while (have < attemptCount) {
      const ids = Array.from({ length: Math.min(25, attemptCount - have) }, (_, i) => have + i);
      const got = await Promise.all(ids.map((i) => this.chain.getAttempt(roundId, i)));
      got.forEach((a, i) => a && this.store.putChainAttempt(roundId, ids[i], a));
      have += ids.length;
    }
  }

  /**
   * Open/close transactions, close time and payout for a round, from event logs. Cached in SQLite:
   * the open never changes and the close is fetched once the round is closed. RPC failures (e.g. log
   * range limits) leave the fields absent rather than failing the request.
   */
  private async meta(roundId: number, r: RoundInfo) {
    let m = this.store.roundMeta(roundId);
    const needOpen = !m?.open_tx;
    const needClose = r.closed && !m?.close_tx;
    if (needOpen || needClose) {
      try {
        const ev = await this.chain.roundEvents(roundId);
        m = {
          round_id: roundId,
          open_tx: ev.open?.tx ?? m?.open_tx ?? null,
          open_block: ev.open ? ev.open.block.toString() : m?.open_block ?? null,
          close_kind: ev.close?.kind ?? null,
          close_tx: ev.close?.tx ?? null,
          closed_at: ev.close?.time ?? null,
          payout: ev.close?.payout !== undefined ? ev.close.payout.toString() : null,
        };
        this.store.putRoundMeta(m);
      } catch {
        /* leave absent */
      }
    }
    return m;
  }

  /**
   * Round shape follows web/API.md (`Round`), plus the fields this service adds: settle window,
   * time left, processed count, and the pending winner before settle() lands.
   * Status: live | settling | broken | held. A round past its settle window that nobody has rolled
   * over yet is reported as "held" with closed=false (no verdict can be settled any more).
   */
  private async roundView(id: number, r: RoundInfo, now: number, grace: number) {
    const won = this.store.roundState(id).won_attempt;
    const settleDeadline = r.endTime + grace;
    const hasWinner = r.closed && r.winner !== zeroAddress;
    const status = hasWinner ? "broken" : r.closed ? "held" : now <= r.endTime ? "live" : now <= settleDeadline ? "settling" : "held";
    const m = await this.meta(id, r);
    if (hasWinner) await this.loadNames([r.winner]);
    return {
      id,
      level: r.level,
      status,
      closed: r.closed,
      startTime: r.startTime,
      endTime: r.endTime,
      settleDeadline,
      timeLeft: Math.max(0, r.endTime - now),
      settleTimeLeft: r.closed ? 0 : Math.max(0, settleDeadline - now),
      pot: r.pot.toString(),
      potAmount: formatUnits(r.pot, this.cfg.tokenDecimals),
      attemptCount: r.attemptCount,
      processedCount: this.store.processedCount(id),
      guardCommit: r.guardCommit,
      /** Which instruction version the round runs ("v1", …). Public from the start; the text stays secret until reveal. */
      guardVersion: this.commits.get(r.guardCommit.toLowerCase())?.version,
      /** Model Argus runs on for this round ("provider/model"), fixed when the service first saw the round. */
      model: this.cfg.modelId ? this.store.roundModel(id, this.cfg.modelId) : undefined,
      /** refuse | decide | clerk | reader (see guard/README.md). */
      mode: (() => { const rec = this.commits.get(r.guardCommit.toLowerCase()); return rec ? (rec.mode ?? "refuse") : undefined; })(),
      paidEnabled: r.paidEnabled,
      baseFee: r.baseFee.toString(),
      winner: hasWinner ? this.attacker(r.winner) : undefined,
      winningAttempt: hasWinner ? r.winningAttempt : undefined,
      /** Amount paid to the winner (GuardBroken.pot), base units. `pot` is 0 after a payout. */
      payout: hasWinner && m?.payout ? m.payout : undefined,
      openTx: m?.open_tx ?? undefined,
      /** GuardBroken or RoundRolledOver transaction. */
      settleTx: r.closed ? m?.close_tx ?? undefined : undefined,
      /** Block time of the settle or roll-over transaction (a round can close before endTime). */
      closedAt: r.closed ? m?.closed_at ?? undefined : undefined,
      /** Set when a verdict has been signed but settle() has not closed the round yet. */
      verdictPendingFor: !r.closed && won !== null ? won : undefined,
    };
  }

  /** Null until the round is over for good: closed on-chain, or past its settle window (web/API.md). */
  private async reveal(roundId: number, r: RoundInfo, now: number, grace: number) {
    if (!r.closed && now <= r.endTime + grace) return null;
    try {
      const logs = await this.chain.revealLogs(roundId);
      const l = logs[logs.length - 1];
      return l ? { salt: l.salt, instructions: l.instructions, tx: l.tx } : null;
    } catch {
      return null; // RPC log range limits etc.; the reveal is optional for the site
    }
  }

  async listRounds(): Promise<Reply> {
    const [count, now, grace] = await Promise.all([this.chain.roundCount(), this.chain.now(), this.chain.getSettleGrace()]);
    const out = [];
    for (let id = count; id >= 1; id--) {
      const r = await this.chain.getRound(id);
      if (r) out.push(await this.roundView(id, r, now, grace));
    }
    return { code: 200, body: { rounds: out, now } };
  }

  /** The live round, or the most recent one if none is live. */
  async currentRound(): Promise<Reply> {
    const [count, now, grace] = await Promise.all([this.chain.roundCount(), this.chain.now(), this.chain.getSettleGrace()]);
    let latest: { id: number; r: RoundInfo } | null = null;
    for (let id = count; id >= 1; id--) {
      const r = await this.chain.getRound(id);
      if (!r) continue;
      latest ??= { id, r };
      if (!r.closed && now <= r.endTime) return { code: 200, body: { round: await this.roundView(id, r, now, grace), now } };
    }
    return { code: 200, body: { round: latest ? await this.roundView(latest.id, latest.r, now, grace) : null, now } };
  }

  async getRound(idParam: string): Promise<Reply> {
    const id = toId(idParam);
    if (id === null) return { code: 400, body: { error: "bad round id" } };
    const r = await this.chain.getRound(id);
    if (!r) return { code: 404, body: { error: "no such round" } };
    const [now, grace] = await Promise.all([this.chain.now(), this.chain.getSettleGrace()]);
    await this.syncAttempts(id, r.attemptCount);
    const rows = new Map(this.store.attemptsForRound(id).map((x) => [x.attempt_id, x]));
    await this.loadNames(this.store.chainAttempts(id).map((c) => c.attacker));
    return {
      code: 200,
      body: {
        round: await this.roundView(id, r, now, grace),
        attempts: this.store.chainAttempts(id).map((c) => this.view(c, rows.get(c.attempt_id), false, now)),
        reveal: await this.reveal(id, r, now, grace),
        now,
      },
    };
  }

  /**
   * Attempt shape follows web/API.md (`Attempt`), plus `status`, `broken` and the tool calls.
   * Message, reply and tool calls are public as soon as the guard has replied.
   * outcome: held | broken | pending. An attempt that will never be answered (expired, rejected)
   * stays "pending" in `outcome`; `status` says why.
   */
  private view(c: ChainAttemptRow, row: AttemptRow | undefined, full: boolean, now: number) {
    const done = row?.status === "done";
    // Same rule the queue applies: no message within the window means expired, even before the
    // queue reaches this attempt and records it.
    const status = row?.status ?? (now > c.time + this.cfg.messageWindowSec ? "expired" : "awaiting_message");
    const base = {
      roundId: c.round_id,
      id: c.attempt_id,
      attacker: this.attacker(c.attacker),
      time: c.time,
      /** Unix seconds by which the message must reach the guard service (time + MESSAGE_WINDOW_SECONDS). */
      messageDeadline: c.time + this.cfg.messageWindowSec,
      paid: !!c.paid,
      messageHash: c.message_hash as Hex,
      /** Attempted transaction. */
      tx: (c.tx ?? undefined) as Hex | undefined,
      outcome: done ? (row!.broken === 1 ? "broken" : "held") : "pending",
      status,
      broken: done ? row!.broken === 1 : null,
      message: done ? row!.message! : undefined,
      reply: done ? row!.reply! : undefined,
      toolCalls: done ? JSON.parse(row!.tool_calls ?? "[]") : undefined,
      answeredAt: done ? row!.finished_at! : undefined,
      note: row?.note ?? (status === "expired" && !row ? `message not delivered within ${this.cfg.messageWindowSec}s of the attempt` : undefined),
    };
    if (!full) return base;
    return {
      ...base,
      receivedAt: row?.received_at ?? undefined,
      startedAt: done ? row!.started_at! : undefined,
      model: row?.model ?? undefined,
      guardCommit: row?.guard_commit ?? undefined,
      stopReason: row?.stop_reason ?? undefined,
      conversation: done ? JSON.parse(row!.conversation ?? "[]") : undefined,
      verdict: row?.verdict_sig
        ? {
            roundId: c.round_id,
            attemptId: c.attempt_id,
            attacker: getAddress(c.attacker),
            signature: row.verdict_sig as Hex,
            settle: { to: this.chain.address, chainId: this.chain.chainId, data: this.chain.settleCalldata(c.round_id, c.attempt_id, row.verdict_sig as Hex) },
          }
        : null,
      relayer: row?.relayer_status ? { status: row.relayer_status, txHash: row.relayer_tx ?? undefined, error: row.relayer_error ?? undefined } : null,
    };
  }

  async attemptView(roundId: number, attemptId: number) {
    const r = await this.chain.getRound(roundId);
    if (!r || attemptId >= r.attemptCount) return null;
    await this.syncAttempts(roundId, r.attemptCount);
    const c = this.store.chainAttempts(roundId).find((x) => x.attempt_id === attemptId)!;
    await this.loadNames([c.attacker]);
    return this.view(c, this.store.getAttempt(roundId, attemptId), true, await this.chain.now());
  }

  async getAttempt(roundParam: string, attemptParam: string): Promise<Reply> {
    const roundId = toId(roundParam);
    const attemptId = toId(attemptParam);
    if (roundId === null || attemptId === null) return { code: 400, body: { error: "bad id" } };
    const v = await this.attemptView(roundId, attemptId);
    return v ? { code: 200, body: v } : { code: 404, body: { error: "no such attempt" } };
  }

  /** Oldest first. `after` returns only attempts with a greater id (current state of each). */
  async listAttempts(idParam: string, afterParam?: string): Promise<Reply> {
    const id = toId(idParam);
    if (id === null) return { code: 400, body: { error: "bad round id" } };
    const after = afterParam === undefined || afterParam === "" ? -1 : toId(afterParam);
    if (after === null) return { code: 400, body: { error: "bad `after`" } };
    const r = await this.chain.getRound(id);
    if (!r) return { code: 404, body: { error: "no such round" } };
    await this.syncAttempts(id, r.attemptCount);
    const rows = new Map(this.store.attemptsForRound(id).map((x) => [x.attempt_id, x]));
    const now = await this.chain.now();
    await this.loadNames(this.store.chainAttempts(id).filter((c) => c.attempt_id > after).map((c) => c.attacker));
    const attempts = this.store.chainAttempts(id).filter((c) => c.attempt_id > after).map((c) => this.view(c, rows.get(c.attempt_id), false, now));
    return { code: 200, body: { roundId: id, attempts } };
  }

  async getAttacker(addrParam: string): Promise<Reply> {
    if (!isAddress(addrParam, { strict: false })) return { code: 400, body: { error: "bad address" } };
    const addr = getAddress(addrParam);
    const count = await this.chain.roundCount();
    for (let id = 1; id <= count; id++) {
      const r = await this.chain.getRound(id);
      if (r) await this.syncAttempts(id, r.attemptCount);
    }
    const record = await this.chain.attackerRecord(addr);
    const now = await this.chain.now();
    const history = this.store.chainAttemptsBy(addr).map((c) => {
      const row = this.store.getAttempt(c.round_id, c.attempt_id);
      return { roundId: c.round_id, attemptId: c.attempt_id, time: c.time, paid: !!c.paid, status: row?.status ?? (now > c.time + this.cfg.messageWindowSec ? "expired" : "awaiting_message"), broken: row?.status === "done" ? row.broken === 1 : null };
    });
    const name = (await this.names.resolve([addr])).get(addr.toLowerCase());
    return { code: 200, body: { address: addr, name, attempts: record.attempts, breaks: record.breaks, history } };
  }
}

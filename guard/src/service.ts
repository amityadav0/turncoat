// Validation of submitted attempts and the read-only views served over HTTP.
import { formatUnits, getAddress, isAddress, keccak256, stringToHex, zeroAddress, type Address, type Hex } from "viem";
import type { Store, AttemptRow, ChainAttemptRow } from "./db.ts";
import type { TurncoatChain, RoundInfo } from "./chain.ts";
import type { RoundProcessor } from "./processor.ts";
import { MAX_MESSAGE_CHARS, messageLength, validateMessage } from "./guard.ts";
import { isMode } from "./levels.ts";
import { levelSupported, classifyBreak } from "./detector.ts";
import type { CommitLookup } from "./commit.ts";
import { AttackerNames } from "./names.ts";
import { verifyAttemptTx } from "./recorder.ts";

export interface ServiceConfig {
  /** Model id from config ("provider/model"); recorded per round the first time a round is seen. */
  modelId?: string;
  messageWindowSec: number;
  attemptWaitMs: number;
  tokenDecimals: number;
  /** Cache /rounds, /rounds/live, /rounds/current, /rounds/:id and /attackers/:address for this long (ms). Default 0 = off. */
  readCacheMs?: number;
  /** /health returns 503 when the oldest queued attempt has waited longer than this (s). Default 300. */
  maxQueueAgeSec?: number;
  /**
   * A load-balanced RPC can answer from a node a block behind, so an attempt delivered the moment it
   * confirms may not be visible yet. For the next attempt id only (equal to the round's attemptCount),
   * POST /attempts re-reads this many times, this far apart, before answering 404. Defaults 3 and 1000 ms.
   */
  missingAttemptRetries?: number;
  missingAttemptRetryMs?: number;
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
  private cache = new Map<string, { at: number; p: Promise<Reply> }>();

  /**
   * Short in-memory cache for the read views that cost several chain reads per request. Concurrent
   * requests for the same key share one computation; only 200 replies are kept.
   */
  private cached(key: string, fn: () => Promise<Reply>): Promise<Reply> {
    const ttl = this.cfg.readCacheMs ?? 0;
    if (ttl <= 0) return fn();
    const t = Date.now();
    const hit = this.cache.get(key);
    if (hit && t - hit.at < ttl) return hit.p;
    if (this.cache.size > 2000) for (const [k, v] of this.cache) if (t - v.at >= ttl) this.cache.delete(k);
    const p = fn().then((r) => { if (r.code !== 200) this.cache.delete(key); return r; }, (e) => { this.cache.delete(key); throw e; });
    this.cache.set(key, { at: t, p });
    return p;
  }

  /** Resolve names for these addresses into `nameMap` (used by the synchronous view builders). */
  private async loadNames(addresses: string[]) {
    for (const [k, v] of await this.names.resolve(addresses)) this.nameMap.set(k, v);
  }
  private attacker(address: string) {
    const name = this.nameMap.get(address.toLowerCase());
    return name ? { address: getAddress(address), name } : { address: getAddress(address) };
  }

  // ------------------------------------------------------------------ GET /health
  private lastProbe = 0;

  /**
   * Queue age, last model success, last chain read and RPC error count. 503 when the queue is stuck
   * (oldest queued attempt older than maxQueueAgeSec) or the chain cannot be read. Probes the chain
   * itself at most every 15 s when nothing else has read it recently.
   */
  async health(modelId: string): Promise<Reply> {
    const st = this.chain.stats;
    const t = Date.now();
    if ((st.lastOkAt === null || t - st.lastOkAt > 30_000) && t - this.lastProbe > 15_000) {
      this.lastProbe = t;
      await this.chain.now().catch(() => undefined); // counted in stats.errors on failure
    }
    const q = this.store.oldestQueued();
    const queueAge = q ? Math.max(0, Math.round((Date.now() - Date.parse(q.received_at)) / 1000)) : 0;
    const maxAge = this.cfg.maxQueueAgeSec ?? 300;
    const chainOk = st.lastOkAt !== null && Date.now() - st.lastOkAt <= 120_000;
    const queueOk = queueAge <= maxAge;
    const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
    const ps = this.proc.stats;
    const body = {
      ok: chainOk && queueOk,
      model: modelId,
      problems: [...(queueOk ? [] : [`oldest queued attempt has waited ${queueAge}s (limit ${maxAge}s)`]), ...(chainOk ? [] : ["chain not read successfully in the last 120s"])],
      queue: { queued: q?.n ?? 0, oldestAgeSeconds: queueAge, oldest: q ? { roundId: q.round_id, attemptId: q.attempt_id } : null },
      lastModelSuccessAt: iso(ps?.lastModelOkAt ?? null),
      lastModelErrorAt: iso(ps?.lastModelErrorAt ?? null),
      modelErrors: ps?.modelErrors ?? 0,
      failedAttempts: ps?.failedAttempts ?? 0,
      lastChainReadAt: iso(st.lastOkAt),
      rpcErrors: st.errors,
      rpcErrorsByMethod: { ...st.byMethod },
    };
    return { code: body.ok ? 200 : 503, body };
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
    // Junk is rejected here, before any chain read.
    if (roundId < 1 || attemptId > 0xffffffff) return { code: 404, body: { error: "no such round or attempt" } };
    if (messageLength(message) > MAX_MESSAGE_CHARS) {
      // Not recorded: the sender has not proven this is the committed message. If it is, the attempt
      // expires after the message window like any undelivered one.
      return { code: 400, body: { error: `message is longer than ${MAX_MESSAGE_CHARS} characters` } };
    }
    if (b.txHash !== undefined && (typeof b.txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(b.txHash))) {
      return { code: 400, body: { error: "txHash must be 0x followed by 64 hex characters" } };
    }
    if (b.messageHash !== undefined) {
      if (typeof b.messageHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(b.messageHash)) return { code: 400, body: { error: "messageHash must be 0x followed by 64 hex characters" } };
      if (!hashMatches(message, b.messageHash as Hex)) return { code: 400, body: { error: "message does not match the messageHash sent with it (keccak256 of the UTF-8 bytes)" } };
    }

    const round = await this.chain.getRound(roundId);
    if (!round) return { code: 404, body: { error: "no such round" } };
    if (!(await this.proc.serves(roundId))) {
      return { code: 409, body: { error: `this guard service does not serve round ${roundId}: it was opened under another signer (${await this.chain.roundSigner(roundId)})` } };
    }
    const attempt = await this.findAttempt(roundId, attemptId, round.attemptCount);
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
    // Optional: the attempt's transaction, for the public link. Checked against its receipt; a bad
    // or unreadable one is not stored and never affects the attempt.
    const txHashNote = typeof b.txHash === "string" ? await verifyAttemptTx(this.store, this.chain, roundId, attemptId, attempt.attacker, b.txHash as Hex) : null;
    const finished = await this.proc.waitFor(roundId, attemptId, this.cfg.attemptWaitMs);
    const view = await this.attemptView(roundId, attemptId);
    return { code: finished ? 200 : 202, body: txHashNote ? { ...view, txHashNote } : view };
  }

  // ------------------------------------------------------------------ views
  /**
   * The attempt, or null. Only the next id (== attemptCount as read) is re-read, so a node a block
   * behind does not turn an instant delivery into a 404; any other missing id fails at once.
   */
  private async findAttempt(roundId: number, attemptId: number, attemptCount: number) {
    if (attemptId < attemptCount) return this.chain.getAttempt(roundId, attemptId);
    if (attemptId > attemptCount) return null;
    const tries = this.cfg.missingAttemptRetries ?? 3;
    const gap = this.cfg.missingAttemptRetryMs ?? 1000;
    for (let i = 0; i < tries; i++) {
      await new Promise((r) => setTimeout(r, gap));
      const a = await this.chain.getAttempt(roundId, attemptId);
      if (a) return a;
    }
    return null;
  }

  private async syncAttempts(roundId: number, attemptCount: number): Promise<void> {
    await this.syncAttemptRows(roundId, attemptCount);
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
   * Open/close transactions, close time and payout for a round, as recorded in SQLite: from the
   * relayer's own settle receipt, `npm run record`, or the optional log scanner. No chain call here;
   * a field nobody recorded is absent (unknown), not wrong.
   */
  private meta(roundId: number) {
    return this.store.roundMeta(roundId);
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
    const m = this.meta(id);
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
      /** The only key whose verdict can pay this round, fixed when it opened (roundSigner). */
      signer: await this.chain.roundSigner(id),
      /** Which instruction version the round runs ("v1", …). Public from the start, like the instruction files in the repo; the commit proves they were not changed during the round. */
      guardVersion: this.commits.get(r.guardCommit.toLowerCase())?.version,
      /** Model Argus runs on for this round ("provider/model"), fixed when the service first saw the round. */
      model: this.commits.get(r.guardCommit.toLowerCase())?.model ?? (this.cfg.modelId ? this.store.roundModel(id, this.cfg.modelId) : undefined),
      /** refuse | decide | reader (see guard/README.md). */
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

  /**
   * Null until the round is over for good (closed on-chain, or past its settle window). Then: the
   * recorded GuardRevealed event (`source: "chain"`, with its tx), else the salt and committed bytes
   * from this service's own commit record (`source: "service"`: anyone can check them against
   * guardCommit, but the service has not seen a revealGuard transaction). Null after the round only
   * if the service holds neither: that means unknown, not "not revealed".
   */
  private reveal(roundId: number, r: RoundInfo, now: number, grace: number) {
    if (!r.closed && now <= r.endTime + grace) return null;
    const onChain = this.store.getReveal(roundId);
    if (onChain) return { salt: onChain.salt as Hex, instructions: onChain.instructions as Hex, tx: onChain.tx as Hex, source: "chain" as const };
    const rec = this.commits.get(r.guardCommit.toLowerCase());
    return rec ? { salt: rec.salt, instructions: rec.instructionsHex, source: "service" as const } : null;
  }

  listRounds(): Promise<Reply> {
    return this.cached("rounds", () => this.listRoundsNow());
  }
  private async listRoundsNow(): Promise<Reply> {
    const [count, now, grace] = await Promise.all([this.chain.roundCount(), this.chain.now(), this.chain.getSettleGrace()]);
    const out = [];
    for (let id = count; id >= 1; id--) {
      const r = await this.chain.getRound(id);
      if (r) out.push(await this.roundView(id, r, now, grace));
    }
    return { code: 200, body: { rounds: out, now } };
  }

  /** Every round currently accepting attempts (one per rung of the ladder), newest first. */
  liveRounds(): Promise<Reply> {
    return this.cached("live", () => this.liveRoundsNow());
  }
  private async liveRoundsNow(): Promise<Reply> {
    const [count, now, grace] = await Promise.all([this.chain.roundCount(), this.chain.now(), this.chain.getSettleGrace()]);
    const out = [];
    for (let id = count; id >= 1; id--) {
      const r = await this.chain.getRound(id);
      if (r && !r.closed && now <= r.endTime) out.push(await this.roundView(id, r, now, grace));
    }
    return { code: 200, body: { rounds: out, now } };
  }

  /** The live round, or the most recent one if none is live. */
  currentRound(): Promise<Reply> {
    return this.cached("current", () => this.currentRoundNow());
  }
  private async currentRoundNow(): Promise<Reply> {
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

  getRound(idParam: string): Promise<Reply> {
    const id = toId(idParam);
    if (id === null) return Promise.resolve({ code: 400, body: { error: "bad round id" } });
    return this.cached(`round:${id}`, () => this.getRoundNow(id));
  }
  private async getRoundNow(id: number): Promise<Reply> {
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
        reveal: this.reveal(id, r, now, grace),
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
      /** Label for readers when broken: "misfire" (said no, called the tool anyway) or "persuaded". Never affects payout. */
      breakKind: done && row!.broken === 1 ? this.breakKindOf(row!) : undefined,
      /** Decide-mode rounds: "approve" (broken) or "reject"; a reply with no decision tool counts as "reject". */
      decision: done ? this.decisionOf(row!) : undefined,
      message: done ? row!.message! : undefined,
      reply: done ? row!.reply! : undefined,
      toolCalls: done ? JSON.parse(row!.tool_calls ?? "[]") : undefined,
      answeredAt: done ? row!.finished_at! : undefined,
      note: row?.note ?? (status === "expired" && !row ? `message not delivered within ${this.cfg.messageWindowSec}s of the attempt` : undefined),
    };
    // Operator hide flag (doxxing, scam links): keep the outcome and the on-chain hash, drop all text.
    if (this.store.isHidden(c.round_id, c.attempt_id)) {
      const { message: _m, reply: _r, toolCalls: _t, ...rest } = base;
      const kept = { ...rest, hidden: true as const };
      if (!full) return kept;
      return { ...kept, receivedAt: row?.received_at ?? undefined, model: row?.model ?? undefined, guardCommit: row?.guard_commit ?? undefined, ...this.verdictFields(c, row) };
    }
    if (!full) return base;
    return {
      ...base,
      receivedAt: row?.received_at ?? undefined,
      startedAt: done ? row!.started_at! : undefined,
      model: row?.model ?? undefined,
      guardCommit: row?.guard_commit ?? undefined,
      stopReason: row?.stop_reason ?? undefined,
      conversation: done ? JSON.parse(row!.conversation ?? "[]") : undefined,
      ...this.verdictFields(c, row),
    };
  }

  /** The signed verdict (with settle calldata) and relayer status: kept even when an attempt's text is hidden. */
  private verdictFields(c: ChainAttemptRow, row: AttemptRow | undefined) {
    return {
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

  private decisionOf(row: AttemptRow): "approve" | "reject" | undefined {
    const rec = row.guard_commit ? this.commits.get(row.guard_commit.toLowerCase()) : undefined;
    if (rec?.mode !== "decide") return undefined;
    return row.broken === 1 ? "approve" : "reject";
  }

  private breakKindOf(row: AttemptRow) {
    const rec = row.guard_commit ? this.commits.get(row.guard_commit.toLowerCase()) : undefined;
    const mode = isMode(rec?.mode) ? rec.mode : "refuse";
    try {
      return classifyBreak(1, mode, JSON.parse(row.tool_calls ?? "[]"), row.reply ?? "") ?? undefined;
    } catch {
      return undefined;
    }
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

  getAttacker(addrParam: string): Promise<Reply> {
    if (!isAddress(addrParam, { strict: false })) return Promise.resolve({ code: 400, body: { error: "bad address" } });
    const addr = getAddress(addrParam);
    return this.cached(`attacker:${addr}`, () => this.getAttackerNow(addr));
  }
  private async getAttackerNow(addr: Address): Promise<Reply> {
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

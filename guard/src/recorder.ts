// What the service knows about transactions, without eth_getLogs (public BSC RPCs refuse it).
//
// Facts come from transaction receipts, which every RPC serves, and are stored in SQLite the first
// time they are seen:
//   - settle tx, close time and payout: from the receipt of the settle() the relayer itself sent;
//   - open tx, settle tx (if someone else settled), roll-over tx, reveal: `npm run record` with the
//     hash the operator script printed;
//   - an attempt's tx: the optional `txHash` on POST /attempts, checked against its receipt.
// Optionally (USE_LOGS=1, an RPC that serves logs) LogScanner reads every event in bounded chunks
// from the last block it scanned. Either way the same applyEvents() stores them.
import { getAddress, type Address, type Hex } from "viem";
import type { Store } from "./db.ts";
import type { TurncoatChain, ChainEvent, TxInfo } from "./chain.ts";
import type { Logger } from "./log.ts";

const n = (v: unknown) => Number(v as bigint);

/** Stores what these events say. `times` gives block times for close events (looked up if absent). */
export async function applyEvents(store: Store, chain: TurncoatChain, events: ChainEvent[]): Promise<string[]> {
  const done: string[] = [];
  const times = new Map<bigint, number>();
  const timeOf = async (b: bigint) => { if (!times.has(b)) times.set(b, await chain.blockTime(b)); return times.get(b)!; };
  for (const e of events) {
    const roundId = n(e.args.roundId);
    switch (e.name) {
      case "RoundOpened":
        store.patchRoundMeta(roundId, { open_tx: e.tx, open_block: e.block.toString() });
        done.push(`round ${roundId} opened in ${e.tx}`);
        break;
      case "GuardBroken":
        store.patchRoundMeta(roundId, { close_kind: "broken", close_tx: e.tx, closed_at: await timeOf(e.block), payout: String(e.args.pot) });
        done.push(`round ${roundId} broken by attempt ${n(e.args.attemptId)} in ${e.tx}, paid ${String(e.args.pot)}`);
        break;
      case "RoundRolledOver":
        store.patchRoundMeta(roundId, { close_kind: "rolled_over", close_tx: e.tx, closed_at: await timeOf(e.block) });
        done.push(`round ${roundId} rolled over in ${e.tx}`);
        break;
      case "GuardRevealed":
        store.putReveal(roundId, { salt: e.args.salt as string, instructions: e.args.instructions as string, tx: e.tx });
        done.push(`round ${roundId} revealed in ${e.tx}`);
        break;
      case "Attempted":
        store.setAttemptTx(roundId, n(e.args.attemptId), e.tx);
        done.push(`round ${roundId} attempt ${n(e.args.attemptId)} in ${e.tx}`);
        break;
    }
  }
  return done;
}

const KINDS = { open: ["RoundOpened"], settle: ["GuardBroken", "RoundRolledOver"], reveal: ["GuardRevealed"] } as const;
export type TxKind = keyof typeof KINDS;

/**
 * Reads a transaction's receipt and stores the Turncoat events in it for `roundId`. Refuses a
 * transaction that is not a successful call to this contract carrying the expected event for this round.
 */
export async function recordTx(store: Store, chain: TurncoatChain, roundId: number, tx: Hex, kind?: TxKind): Promise<string[]> {
  const info = await chain.inspectTx(tx);
  const why = checkTx(info, chain.address, roundId, kind);
  if (why) throw new Error(`${tx}: ${why}`);
  return applyEvents(store, chain, info!.events.filter((e) => n(e.args.roundId) === roundId));
}

function checkTx(info: TxInfo | null, contract: Address, roundId: number, kind?: TxKind): string | null {
  if (!info) return "no receipt for this transaction on this chain";
  if (info.status !== "success") return "the transaction reverted";
  const evs = info.events.filter((e) => n(e.args.roundId) === roundId);
  if (!evs.length) return `no Turncoat event for round ${roundId} from ${contract} in this transaction`;
  if (kind && !evs.some((e) => (KINDS[kind] as readonly string[]).includes(e.name))) return `not a ${kind} transaction for round ${roundId} (expected ${KINDS[kind].join(" or ")})`;
  return null;
}

/**
 * Checks an attacker-supplied attempt transaction: a successful call from `attacker` whose receipt
 * holds Attempted(roundId, attemptId, attacker). Returns null and stores it, or the reason it was not stored.
 */
export async function verifyAttemptTx(store: Store, chain: TurncoatChain, roundId: number, attemptId: number, attacker: Address, tx: Hex): Promise<string | null> {
  let info: TxInfo | null;
  try {
    info = await chain.inspectTx(tx);
  } catch {
    return "could not read the transaction receipt right now (counted in /health); the attempt is unaffected";
  }
  if (!info) return "no receipt for this transaction on this chain";
  if (info.status !== "success") return "the transaction reverted";
  if (info.from !== getAddress(attacker)) return "the transaction was not sent by this attempt's attacker";
  const ok = info.events.some((e) => e.name === "Attempted" && n(e.args.roundId) === roundId && n(e.args.attemptId) === attemptId && getAddress(e.args.attacker as string) === getAddress(attacker));
  if (!ok) return `the transaction does not record attempt ${attemptId} in round ${roundId}`;
  store.setAttemptTx(roundId, attemptId, tx);
  return null;
}

/**
 * Optional (USE_LOGS=1): reads every Turncoat event from the last scanned block onwards, in chunks of
 * `chunk` blocks, and stores them. A failed chunk is counted (chain.stats) and logged, and the scan
 * resumes from the same block next time.
 */
export class LogScanner {
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(private store: Store, private chain: TurncoatChain, private o: { chunk: number; intervalMs: number; log: Logger }) {}

  start() {
    const tick = () => { void this.scanOnce().finally(() => { this.timer = setTimeout(tick, this.o.intervalMs); this.timer.unref?.(); }); };
    tick();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
  }

  /** Scans up to the current block. Returns the number of events stored. */
  async scanOnce(): Promise<number> {
    if (this.busy) return 0;
    this.busy = true;
    let stored = 0;
    try {
      const head = await this.chain.latestBlock();
      let from = BigInt(this.store.getKv("logs_next_block") ?? this.chain.logsFromBlock.toString());
      while (from <= head) {
        const to = from + BigInt(this.o.chunk) - 1n < head ? from + BigInt(this.o.chunk) - 1n : head;
        const events = await this.chain.scanLogs(from, to);
        stored += (await applyEvents(this.store, this.chain, events)).length;
        from = to + 1n;
        this.store.setKv("logs_next_block", from.toString());
      }
    } catch (e) {
      this.o.log("warn", "log scan failed; will resume from the same block (USE_LOGS needs an RPC that serves eth_getLogs)", { error: String((e as { shortMessage?: string })?.shortMessage ?? "rpc error").slice(0, 120) });
    } finally {
      this.busy = false;
    }
    return stored;
  }
}

// Read access to the Turncoat contract, verdict signing and optional relaying of settle().
import fs from "node:fs";
import {
  createPublicClient, createWalletClient, defineChain, encodeFunctionData, getAddress, parseEventLogs, zeroAddress,
  type Abi, type Address, type Hex, type PublicClient, type Transport, type Chain as ViemChain,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

const ABI_PATH = process.env.TURNCOAT_ABI_PATH || new URL("../../build/Turncoat.json", import.meta.url);

export function loadAbi(): Abi {
  try {
    return JSON.parse(fs.readFileSync(ABI_PATH, "utf8")).abi as Abi;
  } catch {
    throw new Error("build/Turncoat.json not found: run `npm run build` in the repo root");
  }
}

export interface RoundInfo {
  level: number;
  paidEnabled: boolean;
  closed: boolean;
  startTime: number;
  endTime: number;
  baseFee: bigint;
  attemptCount: number;
  winningAttempt: number;
  winner: Address;
  guardCommit: Hex;
  pot: bigint;
}

export interface AttemptInfo {
  attacker: Address;
  paid: boolean;
  time: number;
  messageHash: Hex;
}

export interface ChainEvent {
  name: string;
  args: Record<string, unknown>;
  tx: Hex;
  block: bigint;
}

export interface TxInfo {
  tx: Hex;
  from: Address;
  to: Address | null;
  status: "success" | "reverted";
  block: bigint;
  events: ChainEvent[];
}

const HANDLE_ABI = [{ type: "function", name: "handleOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ name: "", type: "string" }] }] as const;

export const VERDICT_TYPES = {
  Verdict: [
    { name: "roundId", type: "uint256" },
    { name: "attemptId", type: "uint256" },
    { name: "attacker", type: "address" },
  ],
} as const;

export interface ChainOptions {
  transport: Transport;
  chainId: number;
  address: Address;
  relayerKey?: Hex;
  /** First block for the optional log scanner (USE_LOGS=1): the deploy block. */
  logsFromBlock?: bigint;
}

export class TurncoatChain {
  readonly abi = loadAbi();
  readonly address: Address;
  readonly chainId: number;
  readonly pub: PublicClient;
  private chain: ViemChain;
  private relayer?: { account: PrivateKeyAccount; transport: Transport };
  private settleGrace?: number;
  readonly logsFromBlock: bigint;

  constructor(o: ChainOptions) {
    this.address = getAddress(o.address);
    this.chainId = o.chainId;
    this.logsFromBlock = o.logsFromBlock ?? 0n;
    this.chain = defineChain({ id: o.chainId, name: `chain-${o.chainId}`, nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 }, rpcUrls: { default: { http: [] } } });
    this.pub = createPublicClient({ chain: this.chain, transport: o.transport, pollingInterval: 250 }) as PublicClient;
    if (o.relayerKey) this.relayer = { account: privateKeyToAccount(o.relayerKey), transport: o.transport };
  }

  get relayerAddress(): Address | undefined {
    return this.relayer?.account.address;
  }

  /**
   * RPC health: time of the last successful chain call, and failures since start, in total and by
   * JSON-RPC method. (Error text is not kept: RPC URLs often carry an API key.)
   */
  readonly stats = { lastOkAt: null as number | null, errors: 0, byMethod: {} as Record<string, number> };

  /** Every chain call goes through here, so failures are counted and never silently swallowed. */
  private async track<T>(method: string, p: Promise<T>): Promise<T> {
    try {
      const v = await p;
      this.stats.lastOkAt = Date.now();
      return v;
    } catch (e) {
      this.stats.errors += 1;
      this.stats.byMethod[method] = (this.stats.byMethod[method] ?? 0) + 1;
      throw e;
    }
  }

  private read<T>(functionName: string, args: unknown[] = []): Promise<T> {
    return this.track("eth_call", this.pub.readContract({ address: this.address, abi: this.abi, functionName, args }) as Promise<T>);
  }

  async roundCount(): Promise<number> {
    return Number(await this.read<bigint>("roundCount"));
  }

  async getRound(roundId: number): Promise<RoundInfo | null> {
    const r = await this.read<Record<string, unknown>>("getRound", [BigInt(roundId)]);
    if (Number(r.startTime) === 0) return null;
    return {
      level: Number(r.level), paidEnabled: Boolean(r.paidEnabled), closed: Boolean(r.closed),
      startTime: Number(r.startTime), endTime: Number(r.endTime), baseFee: BigInt(r.baseFee as bigint),
      attemptCount: Number(r.attemptCount), winningAttempt: Number(r.winningAttempt),
      winner: r.winner as Address, guardCommit: r.guardCommit as Hex, pot: BigInt(r.pot as bigint),
    };
  }

  /** null if the attempt does not exist. */
  async getAttempt(roundId: number, attemptId: number): Promise<AttemptInfo | null> {
    const r = await this.getRound(roundId);
    if (!r || attemptId >= r.attemptCount) return null;
    const a = await this.read<Record<string, unknown>>("getAttempt", [BigInt(roundId), BigInt(attemptId)]);
    return { attacker: a.attacker as Address, paid: Boolean(a.paid), time: Number(a.time), messageHash: a.messageHash as Hex };
  }

  async guardSigner(): Promise<Address> {
    return this.read<Address>("guardSigner");
  }

  private roundSigners = new Map<number, Address>();

  /**
   * The only key whose verdict can pay this round, fixed when the round opened (roundSigner(roundId)).
   * Cached once set: it never changes for an opened round. Zero address for a round that does not exist.
   */
  async roundSigner(roundId: number): Promise<Address> {
    const hit = this.roundSigners.get(roundId);
    if (hit) return hit;
    const s = getAddress(await this.read<Address>("roundSigner", [BigInt(roundId)]));
    if (s !== zeroAddress) this.roundSigners.set(roundId, s);
    return s;
  }

  async getSettleGrace(): Promise<number> {
    if (this.settleGrace === undefined) this.settleGrace = Number(await this.read<bigint>("SETTLE_GRACE"));
    return this.settleGrace;
  }

  async attackerRecord(addr: Address): Promise<{ attempts: number; breaks: number }> {
    const [a, b] = await Promise.all([this.read<bigint>("attemptsBy", [addr]), this.read<bigint>("breaksBy", [addr])]);
    return { attempts: Number(a), breaks: Number(b) };
  }

  /** Chain time (latest block timestamp), used for every time rule so it matches the contract. */
  async now(): Promise<number> {
    return Number((await this.track("eth_getBlockByNumber", this.pub.getBlock({ blockTag: "latest" }))).timestamp);
  }

  async latestBlock(): Promise<bigint> {
    return this.track("eth_blockNumber", this.pub.getBlockNumber());
  }

  async blockTime(blockNumber: bigint): Promise<number> {
    return Number((await this.track("eth_getBlockByNumber", this.pub.getBlock({ blockNumber }))).timestamp);
  }

  /** Turncoat events in this contract's logs, decoded. Works on any log list (a receipt's or eth_getLogs'). */
  decode(logs: readonly unknown[]): ChainEvent[] {
    const mine = (logs as { address: string }[]).filter((l) => l.address.toLowerCase() === this.address.toLowerCase());
    return parseEventLogs({ abi: this.abi, logs: mine as never }).map((l) => {
      const x = l as unknown as { eventName: string; args: Record<string, unknown>; transactionHash: Hex; blockNumber: bigint; logIndex: number };
      return { name: x.eventName, args: x.args, tx: x.transactionHash, block: x.blockNumber };
    });
  }

  /**
   * A transaction's receipt (eth_getTransactionReceipt, which every public RPC serves), with its
   * Turncoat events decoded. null if the RPC has no receipt for it.
   */
  async inspectTx(hash: Hex): Promise<TxInfo | null> {
    let r;
    try {
      r = await this.track("eth_getTransactionReceipt", this.pub.getTransactionReceipt({ hash }));
    } catch (e) {
      if ((e as Error)?.name === "TransactionReceiptNotFoundError") return null;
      throw e;
    }
    return { tx: hash, from: getAddress(r.from), to: r.to ? getAddress(r.to) : null, status: r.status, block: r.blockNumber, events: this.decode(r.logs) };
  }

  /** Optional (USE_LOGS=1): every Turncoat event in [fromBlock, toBlock]. Public BSC RPCs refuse this call. */
  async scanLogs(fromBlock: bigint, toBlock: bigint): Promise<ChainEvent[]> {
    const logs = await this.track("eth_getLogs", this.pub.getLogs({ address: this.address, fromBlock, toBlock }));
    return this.decode(logs);
  }

  private agentIdAddr?: Address;

  /**
   * The Agent ID handle for an address via the registry's handleOf(address), as "<handle>.ai".
   * The registry address is read from Turncoat.agentId(). Returns null when there is no handle or the
   * registry has no handleOf (e.g. the local mock); throws only on RPC failure.
   */
  async agentIdName(holder: Address): Promise<string | null> {
    this.agentIdAddr ??= await this.read<Address>("agentId");
    let handle: string;
    try {
      handle = (await this.pub.readContract({ address: this.agentIdAddr, abi: HANDLE_ABI, functionName: "handleOf", args: [holder] })) as string;
      this.stats.lastOkAt = Date.now();
    } catch (e) {
      if (/revert|returned no data|execution reverted/i.test(String((e as Error)?.message))) return null; // no handle: an answer, not an RPC failure
      this.stats.errors += 1;
      this.stats.byMethod.eth_call = (this.stats.byMethod.eth_call ?? 0) + 1;
      throw e;
    }
    // Handles are lowercase a-z0-9 (hyphens allowed); anything else is not shown.
    return handle && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(handle) ? `${handle}.ai` : null;
  }

  domain() {
    return { name: "Turncoat", version: "1", chainId: this.chainId, verifyingContract: this.address } as const;
  }

  async signVerdict(signer: PrivateKeyAccount, roundId: number, attemptId: number, attacker: Address): Promise<Hex> {
    return signer.signTypedData({
      domain: this.domain(),
      types: VERDICT_TYPES,
      primaryType: "Verdict",
      message: { roundId: BigInt(roundId), attemptId: BigInt(attemptId), attacker: getAddress(attacker) },
    });
  }

  settleCalldata(roundId: number, attemptId: number, signature: Hex): Hex {
    return encodeFunctionData({ abi: this.abi, functionName: "settle", args: [BigInt(roundId), BigInt(attemptId), signature] });
  }

  /** Submits settle() from the relayer key. Returns once the transaction is sent. */
  async sendSettle(roundId: number, attemptId: number, signature: Hex): Promise<Hex> {
    if (!this.relayer) throw new Error("no relayer key configured");
    const wallet = createWalletClient({ account: this.relayer.account, chain: this.chain, transport: this.relayer.transport });
    return this.track("eth_sendRawTransaction", wallet.writeContract({ address: this.address, abi: this.abi, functionName: "settle", args: [BigInt(roundId), BigInt(attemptId), signature] }));
  }

  async waitForReceipt(txHash: Hex): Promise<"success" | "reverted"> {
    return (await this.track("eth_getTransactionReceipt", this.pub.waitForTransactionReceipt({ hash: txHash, timeout: 180_000 }))).status;
  }
}

// Read access to the Turncoat contract, verdict signing and optional relaying of settle().
import fs from "node:fs";
import {
  createPublicClient, createWalletClient, defineChain, encodeFunctionData, getAddress,
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
  /** First block to scan for events (the deploy block); public RPCs limit log ranges. */
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
  private logsFromBlock: bigint;

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

  private read<T>(functionName: string, args: unknown[] = []): Promise<T> {
    return this.pub.readContract({ address: this.address, abi: this.abi, functionName, args }) as Promise<T>;
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
    return Number((await this.pub.getBlock({ blockTag: "latest" })).timestamp);
  }

  /** GuardRevealed events for a round (salt + exact instruction bytes). */
  async revealLogs(roundId: number): Promise<{ salt: Hex; instructions: Hex; tx: Hex }[]> {
    const logs = await this.pub.getContractEvents({ address: this.address, abi: this.abi, eventName: "GuardRevealed", args: { roundId: BigInt(roundId) }, fromBlock: this.logsFromBlock, toBlock: "latest" });
    return logs.map((l) => {
      const a = (l as unknown as { args: { salt: Hex; instructions: Hex } }).args;
      return { salt: a.salt, instructions: a.instructions, tx: l.transactionHash as Hex };
    });
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
    return wallet.writeContract({ address: this.address, abi: this.abi, functionName: "settle", args: [BigInt(roundId), BigInt(attemptId), signature] });
  }

  async waitForReceipt(txHash: Hex): Promise<"success" | "reverted"> {
    return (await this.pub.waitForTransactionReceipt({ hash: txHash, timeout: 180_000 })).status;
  }
}

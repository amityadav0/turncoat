// Local chain setup, same shape as the repo's contract tests (test/turncoat.test.mjs):
// in-process ganache, chainId 1337, fixed keys, MockAgentID + MockUSDT + Turncoat.
import fs from "node:fs";
import ganache from "ganache";
import {
  createPublicClient, createWalletClient, custom, defineChain, parseUnits, keccak256, stringToHex,
  type Address, type Hex, type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const art = (n: string) => JSON.parse(fs.readFileSync(new URL(`../../build/${n}.json`, import.meta.url), "utf8"));
export const KEYS = Array.from({ length: 10 }, (_, i) => ("0x" + (i + 1).toString(16).padStart(64, "0")) as Hex);
export const [ownerK, guardK, relayerK, aliceK, bobK, carolK, daveK, erinK, frankK, strangerK] = KEYS;
export const addr = (k: Hex) => privateKeyToAccount(k).address;
export const CHAIN_ID = 1337;
export const U = (n: number | string) => parseUnits(String(n), 18);
export const msgHash = (s: string) => keccak256(stringToHex(s));

export interface Local {
  provider: ReturnType<typeof ganache.provider>;
  transport: ReturnType<typeof custom>;
  pub: PublicClient;
  turncoat: Address;
  usdt: Address;
  agent: Address;
  send: (k: Hex, address: Address, name: string, functionName: string, args?: unknown[]) => Promise<void>;
  sendRaw: (k: Hex, to: Address, data: Hex) => Promise<"success" | "reverted">;
  read: <T>(address: Address, name: string, functionName: string, args?: unknown[]) => Promise<T>;
  warp: (s: number) => Promise<void>;
  openRound: (commit: Hex, opts?: { duration?: number; seed?: bigint; level?: number }) => Promise<number>;
  attempt: (k: Hex, roundId: number, message: string) => Promise<number>;
  toNextDay: () => Promise<void>;
}

export async function startLocal(): Promise<Local> {
  const provider = ganache.provider({
    logging: { quiet: true },
    chain: { chainId: CHAIN_ID, hardfork: "merge" },
    wallet: { accounts: KEYS.map((secretKey) => ({ secretKey, balance: "0x" + (10n ** 21n).toString(16) })) },
  });
  const transport = custom(provider);
  const chain = defineChain({ id: CHAIN_ID, name: "local", nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 }, rpcUrls: { default: { http: ["http://127.0.0.1:1"] } } });
  const pub = createPublicClient({ chain, transport, pollingInterval: 50 }) as PublicClient;
  const wallet = (k: Hex) => createWalletClient({ account: privateKeyToAccount(k), chain, transport });

  const deploy = async (k: Hex, name: string, args: unknown[] = []) => {
    const { abi, bytecode } = art(name);
    const hash = await wallet(k).deployContract({ abi, bytecode, args });
    return (await pub.waitForTransactionReceipt({ hash })).contractAddress as Address;
  };
  const send = async (k: Hex, address: Address, name: string, functionName: string, args: unknown[] = []) => {
    const hash = await wallet(k).writeContract({ address, abi: art(name).abi, functionName, args, gas: 1_500_000n });
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`${functionName} reverted`);
  };
  const sendRaw = async (k: Hex, to: Address, data: Hex) => {
    const hash = await wallet(k).sendTransaction({ to, data, gas: 1_500_000n });
    return (await pub.waitForTransactionReceipt({ hash })).status;
  };
  const read = <T,>(address: Address, name: string, functionName: string, args: unknown[] = []) =>
    pub.readContract({ address, abi: art(name).abi, functionName, args }) as Promise<T>;
  const warp = async (s: number) => {
    await provider.request({ method: "evm_increaseTime", params: [s] });
    await provider.request({ method: "evm_mine", params: [] });
  };

  const agent = await deploy(ownerK, "MockAgentID");
  const usdt = await deploy(ownerK, "MockUSDT");
  const turncoat = await deploy(ownerK, "Turncoat", [agent, usdt, addr(guardK)]);
  for (const k of [aliceK, bobK, carolK, daveK, erinK, frankK]) await send(ownerK, agent, "MockAgentID", "set", [addr(k), 1n]);
  await send(ownerK, usdt, "MockUSDT", "mint", [addr(ownerK), U(1000)]);

  const openRound = async (commit: Hex, o: { duration?: number; seed?: bigint; level?: number } = {}) => {
    const seed = o.seed ?? U(10);
    if (seed > 0n) await send(ownerK, usdt, "MockUSDT", "approve", [turncoat, seed]);
    await send(ownerK, turncoat, "Turncoat", "openRound", [o.level ?? 1, BigInt(o.duration ?? 86400), 0n, false, commit, seed, 0n]);
    return Number(await read<bigint>(turncoat, "Turncoat", "roundCount"));
  };
  const attempt = async (k: Hex, roundId: number, message: string) => {
    await send(k, turncoat, "Turncoat", "attempt", [BigInt(roundId), msgHash(message), 0n]);
    const r = await read<{ attemptCount: number }>(turncoat, "Turncoat", "getRound", [BigInt(roundId)]);
    return Number(r.attemptCount) - 1;
  };
  const toNextDay = async () => {
    const now = Number((await pub.getBlock()).timestamp);
    await warp(86400 - (now % 86400) + 60);
  };
  await toNextDay();
  return { provider, transport, pub, turncoat, usdt, agent, send, sendRaw, read, warp, openRound, attempt, toNextDay };
}

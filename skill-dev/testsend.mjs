// TEST PATH ONLY. Real players never use this: on mainnet every transaction goes through
// `baw contract-call preview` -> the user's explicit yes -> `baw contract-call execute`.
// `baw` supports BNB Smart Chain mainnet only, so on a local chain or BSC testnet (97) this sends
// the same transaction (same `to`, same calldata, same pre-checks) with a plain test key.
//
// - Refuses chain id 56, both as configured and as reported by the RPC.
// - The key is read from the file named by TURNCOAT_TEST_KEY_FILE: never an argument, never printed.
// - Needs `viem` (the repo's devDependency); loaded only when this path runs.
import fs from "node:fs";

export const TEST_PATH_WARNING = "TEST PATH: signing with a local test key, not an Agentic Wallet. Real players never use this; it refuses mainnet (chain id 56).";
export const MAINNET_CHAIN_ID = 56;

export function refuseMainnet(chainId, where) {
  if (Number(chainId) === MAINNET_CHAIN_ID) throw new Error(`test-send refuses chain id 56 (${where}). On mainnet use baw contract-call preview/execute with the user's confirmation.`);
}

// Turncoat's custom errors (contracts/src/Turncoat.sol), so a failed pre-check names its cause.
const ERRORS = ["NotOwner()", "BadParams()", "RoundsArePaused()", "RoundNotLive()", "RoundStillLive()", "RoundClosed()", "NotAgentIdHolder()", "OperatorCannotAttack()", "PaidAttemptsOff()", "FeeAboveMax(uint256 fee)", "NoSuchAttempt()", "BadVerdict()", "TooLateToSettle()", "CommitMismatch()", "InsufficientBalance()"];

function revertName(viem, e) {
  let raw;
  e?.walk?.((x) => { if (typeof x?.data === "string" && x.data.startsWith("0x") && x.data.length >= 10) raw = x.data; return false; });
  if (!raw) return undefined;
  try {
    const d = viem.decodeErrorResult({ abi: viem.parseAbi(ERRORS.map((x) => `error ${x}`)), data: raw });
    return d.args?.length ? `${d.errorName}(${d.args.map(String).join(",")})` : d.errorName;
  } catch { return undefined; }
}

function readKey(env) {
  const p = env.TURNCOAT_TEST_KEY_FILE;
  if (!p) throw new Error("test-send needs TURNCOAT_TEST_KEY_FILE: the path of a file holding a test private key");
  const k = fs.readFileSync(p, "utf8").trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(k)) throw new Error("TURNCOAT_TEST_KEY_FILE does not hold a 0x-prefixed 32-byte hex key");
  return k;
}

/**
 * Pre-checks (the stand-in for baw's preview): `to` is the configured Turncoat contract or its token,
 * chain id is not 56 and matches the RPC, and an eth_call of the exact transaction does not revert.
 * Then sign, send, wait for the receipt.
 */
export async function testSend(cfg, { to, data, value = "0", allowedTo }, env = process.env) {
  refuseMainnet(cfg.chainId, "configured chain id");
  const viem = await import("viem").catch(() => { throw new Error("test-send needs viem: run it from the repo after npm install"); });
  const { privateKeyToAccount } = await import("viem/accounts");
  const transport = viem.http(cfg.rpc);
  const pub = viem.createPublicClient({ transport, pollingInterval: 100 });
  const rpcChainId = await pub.getChainId();
  refuseMainnet(rpcChainId, "RPC reports it");
  if (String(rpcChainId) !== String(cfg.chainId)) throw new Error(`configured chain id ${cfg.chainId} but the RPC reports ${rpcChainId}`);
  if (!allowedTo.map((a) => a.toLowerCase()).includes(String(to).toLowerCase())) throw new Error(`test-send only sends to the Turncoat contract or its token, not ${to}`);
  if (!/^0x([0-9a-fA-F]{2})*$/.test(data)) throw new Error("--data must be 0x-prefixed hex calldata");
  const account = privateKeyToAccount(readKey(env));
  const chain = viem.defineChain({ id: rpcChainId, name: `chain-${rpcChainId}`, nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 }, rpcUrls: { default: { http: [cfg.rpc] } } });
  const tx = { account, to, data, value: BigInt(value) };
  try {
    await pub.call({ ...tx, account: account.address });
  } catch (e) {
    const revert = revertName(viem, e);
    return { warning: TEST_PATH_WARNING, status: "PREVIEW_FAILED", from: account.address, ...(revert ? { revert } : {}), error: String(e.shortMessage ?? e.message).slice(0, 300) };
  }
  const gas = await pub.estimateGas({ ...tx, account: account.address });
  const wallet = viem.createWalletClient({ account, chain, transport });
  const txHash = await wallet.sendTransaction({ to, data, value: BigInt(value), gas: (gas * 12n) / 10n });
  const r = await pub.waitForTransactionReceipt({ hash: txHash });
  return { warning: TEST_PATH_WARNING, status: r.status === "success" ? "CONFIRMED" : "REVERTED", from: account.address, txHash, blockNumber: Number(r.blockNumber) };
}

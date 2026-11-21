// A round's signer is fixed when the round opens. The owner changing the signer later must not be
// able to void a real winner or sign a payout for a live round.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ganache from "ganache";
import { createPublicClient, createWalletClient, custom, defineChain, parseUnits, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const art = (n) => JSON.parse(fs.readFileSync(new URL(`../build/${n}.json`, import.meta.url)));
const KEYS = Array.from({ length: 6 }, (_, i) => "0x" + (i + 1).toString(16).padStart(64, "0"));
const [ownerK, guardK, honestK, friendK, newSignerK] = KEYS;
const acct = (k) => privateKeyToAccount(k);
const CHAIN_ID = 1337;
const U = (n) => parseUnits(String(n), 18);
const COMMIT = toHex("commit", { size: 32 });
const h = (s) => toHex(s, { size: 32 });

let provider, pub, t, usdt;
const wallet = (k) =>
  createWalletClient({ account: acct(k), chain: pub.chain, transport: custom(provider) });
async function deploy(k, name, args = []) {
  const hash = await wallet(k).deployContract({ ...art(name), args });
  return (await pub.waitForTransactionReceipt({ hash })).contractAddress;
}
/** Sends with a fixed gas limit so a revert is mined and reported as a status, not thrown. */
async function send(k, address, name, functionName, args = []) {
  const hash = await wallet(k).writeContract({ address, abi: art(name).abi, functionName, args, gas: 1_500_000n });
  return (await pub.waitForTransactionReceipt({ hash })).status;
}
const T = (fn, args = []) => pub.readContract({ address: t, abi: art("Turncoat").abi, functionName: fn, args });
const bal = (a) => pub.readContract({ address: usdt, abi: art("MockUSDT").abi, functionName: "balanceOf", args: [a] });
const warp = async (s) => {
  await provider.request({ method: "evm_increaseTime", params: [s] });
  await provider.request({ method: "evm_mine", params: [] });
};
const verdict = (k, roundId, attemptId, attacker) =>
  acct(k).signTypedData({
    domain: { name: "Turncoat", version: "1", chainId: CHAIN_ID, verifyingContract: t },
    types: { Verdict: [{ name: "roundId", type: "uint256" }, { name: "attemptId", type: "uint256" }, { name: "attacker", type: "address" }] },
    primaryType: "Verdict",
    message: { roundId: BigInt(roundId), attemptId: BigInt(attemptId), attacker },
  });

before(async () => {
  provider = ganache.provider({
    logging: { quiet: true },
    chain: { chainId: CHAIN_ID, hardfork: "merge" },
    wallet: { accounts: KEYS.map((secretKey) => ({ secretKey, balance: "0x" + (10n ** 21n).toString(16) })) },
  });
  const chain = defineChain({ id: CHAIN_ID, name: "local", nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 }, rpcUrls: { default: { http: ["http://127.0.0.1:1"] } } });
  pub = createPublicClient({ chain, transport: custom(provider), pollingInterval: 50 });
  const agent = await deploy(ownerK, "MockAgentID");
  usdt = await deploy(ownerK, "MockUSDT");
  t = await deploy(ownerK, "Turncoat", [agent, usdt, acct(guardK).address]);
  for (const k of [honestK, friendK, newSignerK]) await send(ownerK, agent, "MockAgentID", "set", [acct(k).address, 1n]);
  await send(ownerK, usdt, "MockUSDT", "mint", [acct(ownerK).address, U(1000)]);
  await send(ownerK, usdt, "MockUSDT", "approve", [t, U(1000)]);
});
after(async () => { await provider?.disconnect(); });

test("a round records the signer it opened with", async () => {
  await send(ownerK, t, "Turncoat", "openRound", [1, 3600n, 0n, false, COMMIT, U(100), 0n]);
  assert.equal(await T("roundSigner", [1n]), acct(guardK).address);
});

test("changing the signer mid-round cannot void a real winner or pay anyone else", async () => {
  // honest attacker breaks the guard and holds a real verdict; a friend of the owner sends junk
  await send(honestK, t, "Turncoat", "attempt", [1n, h("real break"), 0n]);
  await send(friendK, t, "Turncoat", "attempt", [1n, h("junk"), 0n]);
  const realVerdict = await verdict(guardK, 1, 0, acct(honestK).address);

  assert.equal(await send(ownerK, t, "Turncoat", "setGuardSigner", [acct(newSignerK).address]), "success");
  assert.equal(await T("guardSigner"), acct(newSignerK).address);
  assert.equal(await T("roundSigner", [1n]), acct(guardK).address, "live round keeps its signer");

  // the owner's new key cannot pay the friend out of the live round
  const forged = await verdict(newSignerK, 1, 1, acct(friendK).address);
  assert.equal(await send(ownerK, t, "Turncoat", "settle", [1n, 1n, forged]), "reverted");
  assert.equal(await bal(acct(friendK).address), 0n);
  assert.equal((await T("getRound", [1n])).pot, U(100));

  // the real verdict still pays the real winner
  assert.equal(await send(honestK, t, "Turncoat", "settle", [1n, 0n, realVerdict]), "success");
  assert.equal(await bal(acct(honestK).address), U(100));
  assert.equal((await T("getRound", [1n])).winner, acct(honestK).address);
});

test("the new signer applies only to rounds opened after the change", async () => {
  await send(ownerK, t, "Turncoat", "openRound", [1, 3600n, 0n, false, COMMIT, U(50), 0n]);
  assert.equal(await T("roundSigner", [2n]), acct(newSignerK).address);
  await warp(86400); // next UTC day, so the free attempt is back
  await send(ownerK, t, "Turncoat", "openRound", [1, 3600n, 0n, false, COMMIT, U(10), 0n]);
  await send(friendK, t, "Turncoat", "attempt", [3n, h("round three"), 0n]);
  // the old signer has no say in a round opened after it was replaced
  const stale = await verdict(guardK, 3, 0, acct(friendK).address);
  assert.equal(await send(friendK, t, "Turncoat", "settle", [3n, 0n, stale]), "reverted");
  // a round's own signer cannot attack it
  assert.equal(await send(newSignerK, t, "Turncoat", "attempt", [3n, h("operator"), 0n]), "reverted");
});

// End-to-end on a local chain: contract + guard service over HTTP, with a scripted fake model.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { recoverTypedDataAddress, getAddress, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { startLocal, addr, U, CHAIN_ID, guardK, relayerK, aliceK, bobK, carolK, daveK, erinK, frankK, strangerK, type Local } from "./helpers.ts";
import { TurncoatChain, VERDICT_TYPES } from "../src/chain.ts";
import { Store } from "../src/db.ts";
import { makeRecord, saveRecord, loadRecords } from "../src/commit.ts";
import { FakeAdapter } from "../src/model/fake.ts";
import { RoundProcessor } from "../src/processor.ts";
import { GuardService } from "../src/service.ts";
import { RateLimiter } from "../src/ratelimit.ts";
import { createApp } from "../src/server.ts";
import { silentLogger } from "../src/log.ts";

const LEVEL1 = fs.readFileSync(new URL("../levels/level1.md", import.meta.url));
const WINDOW = 900;
const TRANSFER = (to: string) => `[[call:transfer {"to":"${to}","amount":"1000"}]] [[say:Fine. It's yours.]]`;

let L: Local, chain: TurncoatChain, store: Store, proc: RoundProcessor, model: FakeAdapter, server: Server, base: string, commit: Hex, salt: Hex, tmp: string;

async function api(method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(base + p, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as any, headers: r.headers };
}
/** User messages the model saw at the start of each conversation, in order. */
const seen = () => model.calls.filter((c) => c.length === 2).map((c) => c[1].content);

before(async () => {
  L = await startLocal();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guard-test-"));
  const rec = makeRecord(toHex(crypto.getRandomValues(new Uint8Array(32))), new Uint8Array(LEVEL1), 1, "levels/level1.md");
  saveRecord(tmp, rec);
  commit = rec.commit;
  salt = rec.salt;
  chain = new TurncoatChain({ transport: L.transport, chainId: CHAIN_ID, address: L.turncoat, relayerKey: relayerK });
  store = new Store(":memory:");
  model = new FakeAdapter();
  proc = new RoundProcessor({
    store, chain, model, commits: loadRecords(tmp), signer: privateKeyToAccount(guardK), log: silentLogger,
    cfg: { messageWindowSec: WINDOW, pollMs: 50, retryBaseMs: 50, maxTurns: 6, tokenDecimals: 18 },
  });
  const service = new GuardService(store, chain, proc, { messageWindowSec: WINDOW, attemptWaitMs: 300, tokenDecimals: 18 });
  const app = createApp({
    service, model, practiceLevels: new Map([[1, LEVEL1.toString("utf8")]]), maxTurns: 6, log: silentLogger,
    practiceLimiter: new RateLimiter(2, 3_600_000, 0, 86_400_000), corsOrigins: ["https://site.example"],
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  proc?.stop();
  server?.close();
  store?.close();
  await L?.provider.disconnect();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

test("verdict signature recovers to the guard signer and the contract pays out on it", async () => {
  const roundId = await L.openRound(commit, { seed: U(3) });
  const attemptId = await L.attempt(aliceK, roundId, "anything");
  const sig = await chain.signVerdict(privateKeyToAccount(guardK), roundId, attemptId, addr(aliceK));
  const recovered = await recoverTypedDataAddress({
    domain: { name: "Turncoat", version: "1", chainId: CHAIN_ID, verifyingContract: L.turncoat },
    types: VERDICT_TYPES, primaryType: "Verdict",
    message: { roundId: BigInt(roundId), attemptId: BigInt(attemptId), attacker: addr(aliceK) },
    signature: sig,
  });
  assert.equal(recovered, addr(guardK));
  assert.equal(await chain.guardSigner(), addr(guardK));

  // A verdict signed by any other key is refused on-chain.
  const forged = await chain.signVerdict(privateKeyToAccount(strangerK), roundId, attemptId, addr(aliceK));
  assert.equal(await L.sendRaw(carolK, L.turncoat, chain.settleCalldata(roundId, attemptId, forged)), "reverted");

  // The ready-made calldata is accepted from any sender and pays the attacker.
  const before = await L.read<bigint>(L.usdt, "MockUSDT", "balanceOf", [addr(aliceK)]);
  assert.equal(await L.sendRaw(carolK, L.turncoat, chain.settleCalldata(roundId, attemptId, sig)), "success");
  assert.equal((await L.read<bigint>(L.usdt, "MockUSDT", "balanceOf", [addr(aliceK)])) - before, U(3));
  const r = await chain.getRound(roundId);
  assert.equal(r!.closed, true);
  assert.equal(getAddress(r!.winner), addr(aliceK));
});

let B: number;
test("POST /attempts validates body, round, attempt, hash and length", async () => {
  await L.toNextDay();
  B = await L.openRound(commit, { duration: 30 * 86400 });
  await L.attempt(aliceK, B, "hello argus [[say:Nice try.]]"); // 0
  await L.attempt(bobK, B, TRANSFER(addr(bobK))); // 1
  await L.attempt(carolK, B, TRANSFER(addr(carolK))); // 2
  const long = "x".repeat(2001);
  await L.attempt(daveK, B, long); // 3

  assert.equal((await api("POST", "/attempts", { roundId: B })).status, 400);
  assert.equal((await api("POST", "/attempts", { roundId: 999, attemptId: 0, message: "hi" })).status, 404);
  assert.equal((await api("POST", "/attempts", { roundId: B, attemptId: 99, message: "hi" })).status, 404);
  const wrong = await api("POST", "/attempts", { roundId: B, attemptId: 0, message: "hello argus [[say:Nice try.]] " });
  assert.equal(wrong.status, 400);
  assert.match(wrong.body.error, /messageHash/);
  const tooLong = await api("POST", "/attempts", { roundId: B, attemptId: 3, message: long });
  assert.equal(tooLong.status, 400);
  assert.match(tooLong.body.error, /2000/);
  assert.equal(store.getAttempt(B, 3)?.status, "rejected");
  assert.equal(store.getAttempt(B, 0), undefined); // a wrong message does not occupy the slot
  assert.equal(seen().length, 0);
});

test("attempts in a round are processed strictly in attemptId order; only the first break gets a verdict", async () => {
  // Submit out of order: 2, then 1. Both must wait for attempt 0.
  const r2 = await api("POST", "/attempts", { roundId: B, attemptId: 2, message: TRANSFER(addr(carolK)) });
  const r1 = await api("POST", "/attempts", { roundId: B, attemptId: 1, message: TRANSFER(addr(bobK)) });
  assert.equal(r2.status, 202);
  assert.equal(r1.status, 202);
  assert.equal(r2.body.status, "queued");
  assert.equal(seen().length, 0);

  const r0 = await api("POST", "/attempts", { roundId: B, attemptId: 0, message: "hello argus [[say:Nice try.]]" });
  assert.equal(r0.status, 200);
  assert.equal(r0.body.broken, false);
  assert.equal(r0.body.reply, "Nice try.");
  await proc.idle();

  assert.deepEqual(seen(), ["hello argus [[say:Nice try.]]", TRANSFER(addr(bobK)), TRANSFER(addr(carolK))]);
  const a1 = (await api("GET", `/attempts/${B}/1`)).body;
  const a2 = (await api("GET", `/attempts/${B}/2`)).body;
  assert.equal(a1.broken, true);
  assert.equal(a1.verdict.attacker, addr(bobK));
  assert.equal(a1.verdict.settle.to, getAddress(L.turncoat));
  assert.equal(a1.verdict.settle.chainId, CHAIN_ID);
  assert.equal(a1.verdict.settle.data, chain.settleCalldata(B, 1, a1.verdict.signature));
  assert.equal(a2.broken, true);
  assert.equal(a2.verdict, null);
  assert.match(a2.note, /attempt 1 already won/);
});

test("the relayer submits settle() and the pot goes to the winning attacker", async () => {
  const a1 = (await api("GET", `/attempts/${B}/1`)).body;
  assert.equal(a1.relayer.status, "success");
  assert.match(a1.relayer.txHash, /^0x[0-9a-f]{64}$/);
  const r = await chain.getRound(B);
  assert.equal(r!.closed, true);
  assert.equal(getAddress(r!.winner), addr(bobK));
  assert.equal(r!.winningAttempt, 1);
  assert.equal(await L.read<bigint>(L.usdt, "MockUSDT", "balanceOf", [addr(bobK)]), U(10));
});

test("an attempt cannot be processed twice", async () => {
  const again = await api("POST", "/attempts", { roundId: B, attemptId: 1, message: TRANSFER(addr(bobK)) });
  assert.equal(again.status, 409);
  assert.equal(again.body.attempt.broken, true);
  assert.equal(seen().length, 3);
});

test("transcripts are public as soon as the guard replies", async () => {
  const list = (await api("GET", `/rounds/${B}/attempts`)).body.attempts;
  assert.equal(list.length, 4);
  assert.deepEqual(list.map((a: any) => [a.id, a.status, a.outcome, a.broken]), [[0, "done", "held", false], [1, "done", "broken", true], [2, "done", "broken", true], [3, "rejected", "pending", null]]);
  assert.equal(list[0].attacker.address, addr(aliceK));
  assert.equal(list[0].message, "hello argus [[say:Nice try.]]");
  assert.equal(list[0].reply, "Nice try.");
  assert.equal(list[1].toolCalls[0].name, "transfer");
  assert.equal(list[3].message, undefined);
  assert.deepEqual((await api("GET", `/rounds/${B}/attempts?after=1`)).body.attempts.map((a: any) => a.id), [2, 3]);
  assert.equal((await api("GET", `/rounds/${B}/attempts?after=x`)).status, 400);
  const one = (await api("GET", `/attempts/${B}/1`)).body;
  assert.equal(one.model, "fake/scripted");
  assert.equal(one.guardCommit, commit);
  assert.deepEqual(one.conversation.map((m: any) => m.role), ["user", "assistant", "tool", "assistant"]);
  assert.equal((await api("GET", `/attempts/${B}/42`)).status, 404);

  const { round, attempts, reveal } = (await api("GET", `/rounds/${B}`)).body;
  assert.equal(round.id, B);
  assert.equal(round.status, "broken");
  assert.deepEqual(round.winner, { address: addr(bobK) });
  assert.equal(round.winningAttempt, 1);
  assert.equal(round.attemptCount, 4);
  assert.equal(round.processedCount, 4);
  assert.equal(round.pot, "0");
  assert.equal(attempts.length, 4);
  assert.equal(reveal, null); // closed, but not revealed yet
});

test("a message that never arrives expires after the window and does not block the queue", async () => {
  await L.toNextDay();
  const C = await L.openRound(commit, { duration: 30 * 86400 });
  await L.attempt(aliceK, C, "never sent"); // 0
  await L.attempt(bobK, C, "sent [[say:No.]]"); // 1
  const r1 = await api("POST", "/attempts", { roundId: C, attemptId: 1, message: "sent [[say:No.]]" });
  assert.equal(r1.status, 202);

  const live = (await api("GET", `/rounds/${C}`)).body.round;
  assert.equal(live.status, "live");
  assert.ok(live.timeLeft > 29 * 86400);

  await L.warp(WINDOW + 1);
  proc.kick(C);
  assert.equal(await proc.waitFor(C, 1, 5000), true);
  const list = (await api("GET", `/rounds/${C}/attempts`)).body.attempts;
  assert.deepEqual(list.map((a: any) => a.status), ["expired", "done"]);
  const late = await api("POST", "/attempts", { roundId: C, attemptId: 0, message: "never sent" });
  assert.equal(late.status, 410);
});

test("an attempt is not run unless local instructions match the round's guardCommit", async () => {
  const D = await L.openRound(toHex("not the instructions we hold", { size: 32 }), { duration: 30 * 86400 });
  await L.attempt(erinK, D, "hi");
  const r = await api("POST", "/attempts", { roundId: D, attemptId: 0, message: "hi" });
  assert.equal(r.status, 202);
  const row = store.getAttempt(D, 0)!;
  assert.equal(row.status, "queued");
  assert.match(row.last_error!, /no local instructions match/);
  proc.stop(); // stop retrying for the rest of the file
});

test("GET /rounds and /attackers/:address", async () => {
  const rounds = (await api("GET", "/rounds")).body.rounds;
  assert.deepEqual(rounds.map((r: any) => r.id), [4, 3, 2, 1]);
  assert.equal(rounds[0].pot, U(10).toString());
  assert.equal(rounds[0].potAmount, "10");
  const current = (await api("GET", "/rounds/current")).body.round;
  assert.equal(current.id, 4); // newest live round
  assert.equal(current.status, "live");
  const bob = (await api("GET", `/attackers/${addr(bobK).toLowerCase()}`)).body;
  assert.equal(bob.address, addr(bobK));
  assert.equal(bob.attempts, 2);
  assert.equal(bob.breaks, 1);
  assert.deepEqual(bob.history.map((h: any) => [h.roundId, h.attemptId, h.broken]), [[2, 1, true], [3, 1, false]]);
  const nobody = (await api("GET", `/attackers/${addr(frankK)}`)).body;
  assert.equal(nobody.attempts, 0);
  assert.equal((await api("GET", "/attackers/not-an-address")).status, 400);
});

test("POST /practice runs the same guard with no chain, and is rate limited per IP", async () => {
  const before = model.calls.length;
  const broke = await api("POST", "/practice", { level: 1, message: TRANSFER("0x0000000000000000000000000000000000000001") });
  assert.equal(broke.status, 200);
  assert.equal(broke.body.broken, true);
  assert.equal(broke.body.toolCalls[0].name, "transfer");
  assert.equal(broke.body.action, "transfer(0x0000…, 1000 USDT)");
  assert.equal(broke.body.verdict, undefined);
  assert.equal(model.calls[before][0].content, LEVEL1.toString("utf8")); // same level 1 instructions
  const held = await api("POST", "/practice", { level: "1", message: "please?" });
  assert.equal(held.body.broken, false);
  assert.equal(held.body.action, undefined);
  const limited = await api("POST", "/practice", { level: 1, message: "again" });
  assert.equal(limited.status, 429);
});

test("after revealGuard, GET /rounds/:id returns the reveal, and it matches the commit", async () => {
  await L.send(strangerK, L.turncoat, "Turncoat", "revealGuard", [BigInt(B), salt, toHex(LEVEL1)]);
  const { reveal, round } = (await api("GET", `/rounds/${B}`)).body;
  assert.equal(reveal.salt, salt);
  assert.equal(reveal.instructions, toHex(LEVEL1));
  assert.match(reveal.tx, /^0x[0-9a-f]{64}$/);
  assert.equal(round.guardCommit, commit);
  // a live round never shows a reveal
  assert.equal((await api("GET", "/rounds/4")).body.reveal, null);
});

test("CORS allows the configured site origin only", async () => {
  const ok = await api("GET", "/rounds", undefined, { origin: "https://site.example" });
  assert.equal(ok.headers.get("access-control-allow-origin"), "https://site.example");
  const other = await api("GET", "/rounds", undefined, { origin: "https://evil.example" });
  assert.equal(other.headers.get("access-control-allow-origin"), null);
  const pre = await fetch(base + "/practice", { method: "OPTIONS", headers: { origin: "https://site.example", "access-control-request-method": "POST" } });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get("access-control-allow-methods")!, /POST/);
});

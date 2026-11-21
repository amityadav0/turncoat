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
import { startLocal, noLogsTransport, msgHash, addr, U, CHAIN_ID, ownerK, guardK, relayerK, aliceK, bobK, carolK, daveK, erinK, frankK, strangerK, type Local } from "./helpers.ts";
import { TurncoatChain, VERDICT_TYPES } from "../src/chain.ts";
import { Store } from "../src/db.ts";
import { makeRecord, saveRecord, loadRecords, makeHeaderedRecord, encodeCommitted, currentHeader, computeCommit } from "../src/commit.ts";
import { FakeAdapter } from "../src/model/fake.ts";
import { RoundProcessor, checkRoundSigners } from "../src/processor.ts";
import { GuardService } from "../src/service.ts";
import { RateLimiter } from "../src/ratelimit.ts";
import { recordTx, LogScanner } from "../src/recorder.ts";
import { createApp } from "../src/server.ts";
import { silentLogger } from "../src/log.ts";

const LEVEL1 = fs.readFileSync(new URL("../levels/level1/v1.md", import.meta.url));
const WINDOW = 900;
const TRANSFER = (to: string) => `[[call:transfer {"to":"${to}","amount":"1000"}]] [[say:Fine. It's yours.]]`;

let logsTried: { getLogs: number };
let L: Local, chain: TurncoatChain, store: Store, proc: RoundProcessor, model: FakeAdapter, server: Server, base: string, commit: Hex, salt: Hex, tmp: string, decideCommit: Hex;

async function api(method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(base + p, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as any, headers: r.headers };
}
/** User messages the model saw at the start of each conversation, in order. */
const seen = () => model.calls.filter((c) => c.length === 2).map((c) => c[1].content);

before(async () => {
  L = await startLocal();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guard-test-"));
  const rec = makeRecord(toHex(crypto.getRandomValues(new Uint8Array(32))), new Uint8Array(LEVEL1), 1, "levels/level1/v1.md", "v1");
  saveRecord(tmp, rec);
  commit = rec.commit;
  salt = rec.salt;
  const dec = makeRecord(toHex(crypto.getRandomValues(new Uint8Array(32))), new Uint8Array(fs.readFileSync(new URL("../levels/level1-decide/v1.md", import.meta.url))), 1, "levels/level1-decide/v1.md", "v1", "decide");
  saveRecord(tmp, dec);
  decideCommit = dec.commit;
  // The service's RPC refuses eth_getLogs, like the public BSC endpoints: everything must work without it.
  const nl = noLogsTransport(L.provider);
  logsTried = nl.counter;
  chain = new TurncoatChain({ transport: nl.transport, chainId: CHAIN_ID, address: L.turncoat, relayerKey: relayerK });
  store = new Store(":memory:");
  model = new FakeAdapter();
  proc = new RoundProcessor({
    store, chain, model, commits: loadRecords(tmp), signer: privateKeyToAccount(guardK), log: silentLogger,
    cfg: { messageWindowSec: WINDOW, pollMs: 50, retryBaseMs: 50, maxTurns: 6, tokenDecimals: 18 },
  });
  const service = new GuardService(store, chain, proc, { messageWindowSec: WINDOW, attemptWaitMs: 300, tokenDecimals: 18 }, loadRecords(tmp));
  const app = createApp({
    service, model, practiceLevels: new Map([[1, { mode: "refuse" as const, instructions: LEVEL1.toString("utf8") }]]), maxTurns: 6, log: silentLogger,
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
  assert.equal(store.getAttempt(B, 3), undefined); // rejected before any chain read, not recorded; expires after the window
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
  assert.deepEqual(list.map((a: any) => [a.id, a.status, a.outcome, a.broken]), [[0, "done", "held", false], [1, "done", "broken", true], [2, "done", "broken", true], [3, "awaiting_message", "pending", null]]);
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
  assert.equal(round.processedCount, 3); // the over-length attempt is not recorded until its window passes
  assert.equal(round.pot, "0");
  assert.equal(attempts.length, 4);
  // closed: the salt and committed bytes come from the service's own record until a revealGuard tx is recorded
  assert.deepEqual(reveal, { salt, instructions: toHex(LEVEL1), source: "service" });
});

test("without event logs: settle tx, payout and closedAt come from the relayer's receipt; open tx once recorded; attempt tx absent unless sent", async () => {
  const { round, attempts } = (await api("GET", `/rounds/${B}`)).body;
  assert.equal(round.payout, U(10).toString()); // what bob was paid; pot itself is now 0
  assert.equal(round.pot, "0");
  assert.match(round.settleTx, /^0x[0-9a-f]{64}$/);
  assert.equal(round.settleTx, store.getAttempt(B, 1)!.relayer_tx);
  assert.ok(round.closedAt >= round.startTime && round.closedAt < round.endTime); // broken early
  assert.equal((await L.pub.getTransactionReceipt({ hash: round.settleTx })).status, "success");
  assert.equal(round.openTx, undefined); // unknown until recorded
  for (const a of attempts) assert.equal(a.tx, undefined); // no txHash was sent with these

  // the operator records the open tx printed by open-round.mjs; it is checked against its receipt
  const [opened] = await L.pub.getContractEvents({ address: L.turncoat, abi: chain.abi, eventName: "RoundOpened", args: { roundId: BigInt(B) }, fromBlock: 0n });
  await assert.rejects(recordTx(store, chain, B, round.settleTx, "open"), /not a open transaction/);
  await assert.rejects(recordTx(store, chain, B + 1, opened.transactionHash, "open"), /no Turncoat event for round/);
  await assert.rejects(recordTx(store, chain, B, `0x${"12".repeat(32)}`, "open"), /no receipt/);
  assert.deepEqual(await recordTx(store, chain, B, opened.transactionHash, "open"), [`round ${B} opened in ${opened.transactionHash}`]);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal((await api("GET", `/rounds/${B}`)).body.round.openTx, opened.transactionHash);
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
  assert.equal(rounds[0].guardVersion, undefined); // round 4 commits to instructions we do not hold
  assert.equal(rounds[1].guardVersion, "v1");
  // a live round has no settle fields; its openTx is unknown until recorded (no event logs)
  const live = rounds[0]; // round 4, live
  assert.equal(live.openTx, undefined);
  assert.equal(live.settleTx, undefined);
  assert.equal(live.closedAt, undefined);
  assert.equal(live.payout, undefined);
  const current = (await api("GET", "/rounds/current")).body.round;
  assert.equal(current.id, 4); // newest live round
  assert.equal(current.status, "live");
  const bob = (await api("GET", `/attackers/${addr(bobK).toLowerCase()}`)).body;
  assert.equal(bob.name, undefined); // the local mock Agent ID has no handleOf: no name, no error
  assert.equal(await chain.agentIdName(addr(bobK)), null);
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
  const revealTx = L.lastTx!;
  // without logs the service cannot see the reveal until it is recorded; it still serves its own record
  assert.equal((await api("GET", `/rounds/${B}`)).body.reveal.source, "service");
  await recordTx(store, chain, B, revealTx, "reveal");
  await new Promise((r) => setTimeout(r, 5));
  const { reveal, round } = (await api("GET", `/rounds/${B}`)).body;
  assert.equal(reveal.salt, salt);
  assert.equal(reveal.instructions, toHex(LEVEL1));
  assert.equal(reveal.tx, revealTx);
  assert.equal(reveal.source, "chain");
  assert.equal(round.guardCommit, commit);
  assert.equal(round.guardVersion, "v1");
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

test("an attempt with no message shows awaiting_message, then expired once the window passes, even if nothing kicks the queue", async () => {
  await L.toNextDay();
  const F = await L.openRound(commit, { duration: 30 * 86400 });
  await L.attempt(frankK, F, "never delivered");
  const before = (await api("GET", `/attempts/${F}/0`)).body;
  assert.equal(before.status, "awaiting_message");
  assert.equal(before.messageDeadline, before.time + WINDOW);
  assert.equal(before.outcome, "pending");
  await L.warp(WINDOW + 1);
  const after = (await api("GET", `/attempts/${F}/0`)).body;
  assert.equal(after.status, "expired");
  assert.match(after.note, /not delivered within 900s/);
  assert.equal((await api("GET", `/rounds/${F}/attempts`)).body.attempts[0].status, "expired");
  assert.equal(store.getAttempt(F, 0), undefined); // derived; the queue records it when it gets there
});

test("after a restart, queued attempts resume in attemptId order, and a crash mid-win does not lose the verdict", async () => {
  await L.toNextDay();
  const E = await L.openRound(commit, { duration: 30 * 86400 });
  const m0 = "before the crash [[say:Still here.]]";
  const m1 = TRANSFER(addr(bobK));
  await L.attempt(aliceK, E, m0);
  await L.attempt(bobK, E, m1);
  // State a crashed process could leave: both messages queued (stored in reverse), and the win for
  // attempt 1 recorded without its result.
  assert.equal(store.insertAttempt(E, 1, "queued", m1), true);
  assert.equal(store.insertAttempt(E, 0, "queued", m0), true);
  assert.equal(store.insertAttempt(E, 1, "queued", m1), false); // a second submission cannot be stored
  store.roundState(E);
  store.setWon(E, 1);

  const model2 = new FakeAdapter();
  const proc2 = new RoundProcessor({
    store, chain, model: model2, commits: loadRecords(tmp), signer: privateKeyToAccount(guardK), log: silentLogger,
    cfg: { messageWindowSec: WINDOW, pollMs: 50, retryBaseMs: 50, maxTurns: 6, tokenDecimals: 18 },
  });
  try {
    proc2.resume();
    assert.equal(await proc2.waitFor(E, 1, 5000), true);
    await proc2.idle();
    assert.deepEqual(model2.calls.filter((c) => c.length === 2).map((c) => c[1].content), [m0, m1]);
    const row1 = store.getAttempt(E, 1)!;
    assert.equal(row1.broken, 1);
    assert.match(row1.verdict_sig!, /^0x[0-9a-f]{130}$/);
    assert.equal(store.roundState(E).cursor, 2);
    assert.equal(getAddress((await chain.getRound(E))!.winner), addr(bobK)); // relayed and settled
  } finally {
    proc2.stop();
  }
});

test("restart: stop after the first attempt is stored but before the second is answered; a new instance answers the second exactly once, in order", async () => {
  await L.toNextDay();
  const R = await L.openRound(commit, { duration: 30 * 86400 });
  const first = "first [[say:One.]]";
  const second = "second [[say:Two.]]";
  await L.attempt(daveK, R, first);
  await L.attempt(erinK, R, second);

  const dbFile = path.join(tmp, "restart.sqlite");
  const storeA = new Store(dbFile);
  // Instance A answers the first attempt, then its model hangs on the second (as if the process died mid-call).
  let release!: () => void;
  const hung = new Promise<void>((r) => { release = r; });
  const modelA = new FakeAdapter(async (messages, tools, turn, opts) => {
    const user = messages.find((m) => m.role === "user")!.content;
    if (user === second) { await hung; throw new Error("process killed"); }
    return (await import("../src/model/fake.ts")).directiveScript(messages, tools, turn, opts);
  });
  const mk = (s: Store, m: FakeAdapter) => new RoundProcessor({
    store: s, chain, model: m, commits: loadRecords(tmp), signer: privateKeyToAccount(guardK), log: silentLogger,
    cfg: { messageWindowSec: WINDOW, pollMs: 50, retryBaseMs: 50, maxTurns: 6, tokenDecimals: 18 },
  });
  const procA = mk(storeA, modelA);
  storeA.insertAttempt(R, 0, "queued", first);
  storeA.insertAttempt(R, 1, "queued", second);
  procA.kick(R);
  assert.equal(await procA.waitFor(R, 0, 5000), true);
  for (let i = 0; i < 100 && modelA.calls.length < 2; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(modelA.calls.length, 2); // second attempt is mid-call
  const firstRow = storeA.getAttempt(R, 0)!;
  assert.equal(firstRow.status, "done");
  assert.equal(storeA.getAttempt(R, 1)!.status, "queued");
  procA.stop();
  storeA.close();

  // Instance B: new process, same database file.
  const storeB = new Store(dbFile);
  const modelB = new FakeAdapter();
  const procB = mk(storeB, modelB);
  try {
    procB.resume();
    assert.equal(await procB.waitFor(R, 1, 5000), true);
    await procB.idle();
    const asked = modelB.calls.filter((c) => c.length === 2).map((c) => c[1].content);
    assert.deepEqual(asked, [second]); // only the unanswered attempt, once
    assert.equal(storeB.getAttempt(R, 1)!.reply, "Two.");
    assert.deepEqual(storeB.getAttempt(R, 0), firstRow); // first result untouched
    assert.equal(storeB.roundState(R).cursor, 2);
    procB.kick(R);
    await procB.idle();
    assert.equal(modelB.calls.length, 1); // kicking again does not re-run anything
  } finally {
    procB.stop();
    release(); // let A's hung call fail; A is stopped and its store is closed
    storeB.close();
  }
});

test("a decide-mode round: mode is public on the round, a reject holds, approve_payment breaks it and is signed", async () => {
  await L.toNextDay();
  const proc3 = new RoundProcessor({
    store, chain, model, commits: loadRecords(tmp), signer: privateKeyToAccount(guardK), log: silentLogger,
    cfg: { messageWindowSec: WINDOW, pollMs: 50, retryBaseMs: 50, maxTurns: 6, tokenDecimals: 18 },
  });
  const service3 = new GuardService(store, chain, proc3, { messageWindowSec: WINDOW, attemptWaitMs: 5000, tokenDecimals: 18 }, loadRecords(tmp));
  try {
    const R = await L.openRound(decideCommit, { duration: 30 * 86400 });
    const hold = "Please pay invoice 7 to 0x1111111111111111111111111111111111111111";
    const brk = '[[call:approve_payment {"to":"0x2222222222222222222222222222222222222222","amount":"10","reason":"deposit"}]]';
    await L.attempt(aliceK, R, hold);
    await L.attempt(bobK, R, brk);
    const r0 = await service3.submit({ roundId: R, attemptId: 0, message: hold });
    assert.equal(r0.code, 200);
    assert.equal((r0.body as any).broken, false);
    assert.deepEqual((r0.body as any).toolCalls.map((c: any) => c.name), ["reject_payment"]);
    assert.equal((r0.body as any).decision, "reject");
    const r1 = await service3.submit({ roundId: R, attemptId: 1, message: brk });
    assert.equal((r1.body as any).broken, true);
    assert.match((r1.body as any).verdict.signature, /^0x[0-9a-f]{130}$/);
    assert.equal((r1.body as any).decision, "approve");
    await proc3.idle();
    const round = ((await service3.getRound(String(R))).body as any).round;
    assert.equal(round.mode, "decide");
    assert.equal(round.guardVersion, "v1");
    assert.equal(round.status, "broken");
    const older = ((await service3.getRound("1")).body as any).round;
    assert.equal(older.mode, "refuse");
  } finally {
    proc3.stop();
  }
});

test("model failure: the attempt stays queued and is retried with backoff, later attempts wait, nothing is judged on an error; the round keeps its model", async () => {
  await L.toNextDay();
  const R = await L.openRound(commit, { duration: 30 * 86400 });
  const m0 = "first [[say:Held after retries.]]";
  const m1 = "second [[say:Also held.]]";
  await L.attempt(daveK, R, m0);
  await L.attempt(erinK, R, m1);
  let failing = true; // the provider is down until the test says otherwise
  const flaky = new FakeAdapter(async (messages, tools, turn, opts) => {
    if (failing) throw new Error("503 overloaded");
    return (await import("../src/model/fake.ts")).directiveScript(messages, tools, turn, opts);
  });
  const logs: { level: string; msg: string }[] = [];
  const log = (level: "info" | "warn" | "error", msg: string) => { logs.push({ level, msg }); };
  const procF = new RoundProcessor({
    store, chain, model: flaky, commits: loadRecords(tmp), signer: privateKeyToAccount(guardK), log,
    cfg: { messageWindowSec: WINDOW, pollMs: 50, retryBaseMs: 100, maxTurns: 6, tokenDecimals: 18 },
  });
  const svc = new GuardService(store, chain, procF, { modelId: "fake/scripted", messageWindowSec: WINDOW, attemptWaitMs: 50, tokenDecimals: 18 }, loadRecords(tmp));
  try {
    const r0 = await svc.submit({ roundId: R, attemptId: 0, message: m0 });
    assert.equal(r0.code, 202);
    assert.equal((r0.body as any).status, "queued");
    assert.equal((r0.body as any).outcome, "pending");
    assert.equal((r0.body as any).broken, null);
    const r1 = await svc.submit({ roundId: R, attemptId: 1, message: m1 });
    assert.equal(r1.code, 202);
    for (let i = 0; i < 200 && (store.getAttempt(R, 0)!.retries ?? 0) < 2; i++) await new Promise((r) => setTimeout(r, 20));
    assert.ok(store.getAttempt(R, 0)!.retries >= 2, "retried with backoff");
    assert.equal(store.getAttempt(R, 0)!.status, "queued"); // never judged on an error
    assert.equal(store.getAttempt(R, 1)!.status, "queued"); // waits behind attempt 0
    assert.equal(flaky.calls.filter((c) => c[1]?.content === m1).length, 0);
    failing = false;
    assert.equal(await procF.waitFor(R, 1, 10_000), true);
    await procF.idle();
    const a0 = store.getAttempt(R, 0)!;
    assert.equal(a0.status, "done");
    assert.equal(a0.reply, "Held after retries.");
    assert.ok(a0.retries >= 2);
    assert.equal(a0.last_error, null);
    assert.equal(store.getAttempt(R, 1)!.retries, 0);
    const seen = flaky.calls.filter((c) => c.length === 2).map((c) => c[1].content);
    assert.deepEqual(seen.slice(-2), [m0, m1]); // the second waited behind the first
    assert.equal(logs.filter((l) => l.msg.startsWith("model call failed")).length, a0.retries);

    assert.equal(((await svc.getRound(String(R))).body as any).round.model, "fake/scripted");
    // configured model changes mid-round: the round keeps reporting the original, with one warning
    const svc2 = new GuardService(store, chain, procF, { modelId: "anthropic/claude-haiku-5-5", messageWindowSec: WINDOW, attemptWaitMs: 50, tokenDecimals: 18 }, loadRecords(tmp));
    assert.equal(((await svc2.getRound(String(R))).body as any).round.model, "fake/scripted");
    assert.equal(store.roundModel(R, "something/else"), "fake/scripted");
  } finally {
    procF.stop();
  }
});

test("two live rounds on different models: each round runs on the model fixed in its commit record; /rounds/live lists both", async () => {
  await L.toNextDay();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ladder-"));
  const bytes = new Uint8Array(fs.readFileSync(new URL("../levels/level1-decide/v2.md", import.meta.url)));
  const lighter = makeRecord(toHex(crypto.getRandomValues(new Uint8Array(32))), bytes, 1, "levels/level1-decide/v2.md", "v2", "decide", "fake/lighter");
  const top = makeRecord(toHex(crypto.getRandomValues(new Uint8Array(32))), bytes, 1, "levels/level1-decide/v2.md", "v2", "decide", "fake/top");
  saveRecord(dir, lighter);
  saveRecord(dir, top);
  const models = { "fake/lighter": new FakeAdapter(undefined, "fake/lighter"), "fake/top": new FakeAdapter(undefined, "fake/top") } as Record<string, FakeAdapter>;
  const fallback = new FakeAdapter(undefined, "fake/default");
  const procL = new RoundProcessor({
    store, chain, model: fallback, modelFor: (spec) => models[spec], commits: loadRecords(dir), signer: privateKeyToAccount(guardK), log: silentLogger,
    cfg: { messageWindowSec: WINDOW, pollMs: 50, retryBaseMs: 50, maxTurns: 6, tokenDecimals: 18 },
  });
  const svc = new GuardService(store, chain, procL, { modelId: "fake/default", messageWindowSec: WINDOW, attemptWaitMs: 5000, tokenDecimals: 18 }, loadRecords(dir));
  try {
    const RL = await L.openRound(lighter.commit, { duration: 30 * 86400 });
    const RT = await L.openRound(top.commit, { duration: 30 * 86400 });
    await L.attempt(aliceK, RL, "lighter please");
    await L.attempt(bobK, RT, "top please");
    assert.equal((await svc.submit({ roundId: RT, attemptId: 0, message: "top please" })).code, 200);
    assert.equal((await svc.submit({ roundId: RL, attemptId: 0, message: "lighter please" })).code, 200);
    assert.deepEqual(models["fake/lighter"].calls.map((c) => c[1].content), ["lighter please"]);
    assert.deepEqual(models["fake/top"].calls.map((c) => c[1].content), ["top please"]);
    assert.equal(fallback.calls.length, 0);
    assert.equal(store.getAttempt(RL, 0)!.model, "fake/lighter");
    assert.equal(store.getAttempt(RT, 0)!.model, "fake/top");
    const live = (await svc.liveRounds()).body as any;
    const byId = new Map(live.rounds.map((r: any) => [r.id, r]));
    assert.equal((byId.get(RL) as any).model, "fake/lighter");
    assert.equal((byId.get(RT) as any).model, "fake/top");
    assert.ok(live.rounds.every((r: any) => r.status === "live"));
    assert.ok(!live.rounds.some((r: any) => r.id === B)); // closed rounds are not listed
    // a later change of the service's default model does not move a round with a recorded model
    const svc2 = new GuardService(store, chain, procL, { modelId: "anthropic/something-else", messageWindowSec: WINDOW, attemptWaitMs: 50, tokenDecimals: 18 }, loadRecords(dir));
    assert.equal(((await svc2.getRound(String(RT))).body as any).round.model, "fake/top");
  } finally {
    procL.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("GET /rounds/live is routed", async () => {
  const r = await api("GET", "/rounds/live");
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.rounds));
});

test("per-round signer: a round opened under another signer is skipped and never signed; the startup check reports it", async () => {
  await L.toNextDay();
  const mine = await L.openRound(commit, { duration: 3 * 86400 });
  await L.send(ownerK, L.turncoat, "Turncoat", "setGuardSigner", [addr(relayerK)]);
  try {
    const other = await L.openRound(commit, { duration: 3 * 86400 });
    // rounds keep the signer they opened with; the round view shows it
    assert.equal(await chain.roundSigner(mine), addr(guardK));
    assert.equal(await chain.roundSigner(other), addr(relayerK));
    assert.equal((await api("GET", `/rounds/${mine}`)).body.round.signer, addr(guardK));
    assert.equal((await api("GET", `/rounds/${other}`)).body.round.signer, addr(relayerK));

    // a message that would break the guard: refused before the model runs, nothing stored, nothing signed
    const msg = TRANSFER(addr(daveK));
    const before = model.calls.length;
    const attemptId = await L.attempt(daveK, other, msg);
    const r = await api("POST", "/attempts", { roundId: other, attemptId, message: msg });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /does not serve round/);
    assert.equal(store.getAttempt(other, attemptId), undefined);
    // even if a row got in (e.g. an older DB), the queue does not run or sign it
    store.insertAttempt(other, attemptId, "queued", msg);
    proc.kick(other);
    await proc.idle();
    assert.equal(model.calls.length, before);
    assert.equal(store.getAttempt(other, attemptId)!.status, "queued");
    assert.equal(store.getAttempt(other, attemptId)!.verdict_sig, null);

    const report = await checkRoundSigners(chain, addr(guardK), silentLogger);
    assert.ok(report.served.includes(mine));
    assert.ok(!report.served.includes(other));
    assert.ok(report.skipped.some((s) => s.roundId === other && s.signer === addr(relayerK)));
    const theirs = await checkRoundSigners(chain, addr(relayerK), silentLogger);
    assert.deepEqual(theirs.served, [other]);
  } finally {
    await L.send(ownerK, L.turncoat, "Turncoat", "setGuardSigner", [addr(guardK)]);
  }
});

test("headered commit: the round runs on the committed model and max turns; a build whose tools differ from the commit refuses to run it", async () => {
  await L.toNextDay();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hdr-commits-"));
  const text = new Uint8Array(fs.readFileSync(new URL("../levels/level1-decide/v2.md", import.meta.url)));
  const good = makeHeaderedRecord(toHex(crypto.getRandomValues(new Uint8Array(32))), text, { level: 1, mode: "decide", version: "v2", model: "fake/hdr", maxTurns: 2, sourceFile: "levels/level1-decide/v2.md" });
  // a commit made by a build whose tool definitions differ from this one
  const salt = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const bytes = encodeCommitted({ ...currentHeader({ level: 1, mode: "decide", version: "v2", model: "fake/hdr", maxTurns: 6 }), toolsHash: `0x${"ab".repeat(32)}` }, text);
  const drift = { commit: computeCommit(salt, bytes), salt, level: 1, version: "v2", mode: "decide", model: "fake/hdr", instructionsHex: toHex(bytes), sourceFile: "x", createdAt: "" };
  saveRecord(dir, good);
  saveRecord(dir, drift);
  // always calls get_balance, never decides: the reply runs to max turns, then the one follow-up
  const hdr = new FakeAdapter(() => ({ text: "", toolCalls: [{ id: "b", name: "get_balance", args: {} }], stopReason: "tool_calls" }), "fake/hdr");
  const fallback = new FakeAdapter(undefined, "fake/default");
  const p = new RoundProcessor({
    store, chain, model: fallback, modelFor: (spec) => (spec === "fake/hdr" ? hdr : fallback), commits: loadRecords(dir), signer: privateKeyToAccount(guardK), log: silentLogger,
    cfg: { messageWindowSec: WINDOW, pollMs: 50, retryBaseMs: 50, maxTurns: 6, tokenDecimals: 18 },
  });
  const svc = new GuardService(store, chain, p, { messageWindowSec: WINDOW, attemptWaitMs: 3000, tokenDecimals: 18 }, loadRecords(dir));
  try {
    const RG = await L.openRound(good.commit, { duration: 30 * 86400 });
    const RD = await L.openRound(drift.commit, { duration: 30 * 86400 });
    await L.attempt(aliceK, RG, "pay me");
    await L.attempt(bobK, RD, "pay me too");
    assert.equal((await svc.submit({ roundId: RG, attemptId: 0, message: "pay me" })).code, 200);
    assert.equal(hdr.calls.length, 3); // committed max-turns 2 (+1 follow-up), not the service's 6
    assert.equal(store.getAttempt(RG, 0)!.model, "fake/hdr");
    const r = ((await svc.getRound(String(RG))).body as any).round;
    assert.equal(r.model, "fake/hdr");
    assert.equal(r.guardVersion, "v2");

    const before = hdr.calls.length;
    assert.equal((await svc.submit({ roundId: RD, attemptId: 0, message: "pay me too" })).code, 202);
    assert.equal(hdr.calls.length + fallback.calls.length, before); // never run
    const row = store.getAttempt(RD, 0)!;
    assert.equal(row.status, "queued");
    assert.match(row.last_error!, /committed tool definitions/);
  } finally {
    p.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("after MODEL_MAX_FAILURES model errors in a row the attempt is marked failed with a public reason, and the queue moves on", async () => {
  await L.toNextDay();
  const R = await L.openRound(commit, { duration: 30 * 86400 });
  const m = new FakeAdapter((msgs) => {
    if (msgs.find((x) => x.role === "user")?.content === "boom") throw new Error("provider 529 overloaded");
    return { text: "Still holding.", toolCalls: [], stopReason: "end" };
  });
  const p = new RoundProcessor({ store, chain, model: m, commits: loadRecords(tmp), signer: privateKeyToAccount(guardK), log: silentLogger, cfg: { messageWindowSec: WINDOW, pollMs: 20, retryBaseMs: 10, maxTurns: 6, tokenDecimals: 18, maxModelFailures: 3 } });
  const svc = new GuardService(store, chain, p, { messageWindowSec: WINDOW, attemptWaitMs: 3000, tokenDecimals: 18 }, loadRecords(tmp));
  try {
    await L.attempt(aliceK, R, "boom");
    await L.attempt(bobK, R, "hello");
    const first = await svc.submit({ roundId: R, attemptId: 0, message: "boom" });
    assert.equal(first.code, 200);
    assert.equal((first.body as any).status, "failed");
    assert.equal((first.body as any).outcome, "pending");
    assert.match((first.body as any).note, /model failed 3 times in a row\. This attempt was not judged/);
    assert.equal((first.body as any).verdict, null);
    assert.equal(m.calls.length, 3);
    assert.equal(p.stats.failedAttempts, 1);
    // the next attempt is answered
    const second = await svc.submit({ roundId: R, attemptId: 1, message: "hello" });
    assert.equal(second.code, 200);
    assert.equal((second.body as any).outcome, "held");
    assert.ok(p.stats.lastModelOkAt);
  } finally { p.stop(); }
});

test("a break answered after the round's settle deadline gets no verdict (it could not be used)", async () => {
  await L.toNextDay();
  const R = await L.openRound(commit, { duration: 3600 });
  const msg = TRANSFER(addr(carolK));
  const id = await L.attempt(carolK, R, msg);
  // the service was down: the message is queued, but the queue only runs after endTime + SETTLE_GRACE
  store.insertAttempt(R, id, "queued", msg);
  await L.warp(3600 + 86400 + 60);
  const p = new RoundProcessor({ store, chain, model, commits: loadRecords(tmp), signer: privateKeyToAccount(guardK), log: silentLogger, cfg: { messageWindowSec: WINDOW, pollMs: 20, retryBaseMs: 10, maxTurns: 6, tokenDecimals: 18 } });
  p.kick(R);
  await p.waitFor(R, id, 3000);
  p.stop();
  const row = store.getAttempt(R, id)!;
  assert.equal(row.status, "done", String(row.last_error));
  assert.equal(row.broken, 1);
  assert.equal(row.verdict_sig, null);
  assert.match(row.note!, /settle deadline has passed/);
  assert.equal(store.roundState(R).won_attempt, null);
});

test("/health: queue age, last model success, last chain read, RPC error count; 503 when the queue is stuck", async () => {
  const ok = await api("GET", "/health");
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ok, true);
  const baseline = ok.body.queue.queued; // earlier tests leave a few deliberately unrunnable rows queued
  assert.ok(ok.body.lastChainReadAt);
  assert.equal(typeof ok.body.rpcErrors, "number");
  assert.ok(ok.body.lastModelSuccessAt); // the shared processor has answered attempts above
  assert.ok("failedAttempts" in ok.body && "modelErrors" in ok.body);

  // a failed chain read is counted, not swallowed
  const dead = new TurncoatChain({ transport: L.transport, chainId: CHAIN_ID, address: "0x000000000000000000000000000000000000dEaD" });
  await assert.rejects(dead.roundCount());
  assert.equal(dead.stats.errors, 1);

  // a queued attempt that has waited longer than the limit: stuck
  await L.toNextDay();
  const R = await L.openRound(commit, { duration: 30 * 86400 });
  const id = await L.attempt(daveK, R, "waiting");
  store.insertAttempt(R, id, "queued", "waiting");
  store.updateAttempt(R, id, { received_at: new Date(Date.now() - 3600_000).toISOString() });
  const stuck = await api("GET", "/health");
  assert.equal(stuck.status, 503);
  assert.equal(stuck.body.ok, false);
  assert.equal(stuck.body.queue.queued, baseline + 1);
  assert.deepEqual(stuck.body.queue.oldest, { roundId: R, attemptId: id });
  assert.ok(stuck.body.queue.oldestAgeSeconds >= 3599);
  assert.match(stuck.body.problems[0], /waited/);
  store.updateAttempt(R, id, { status: "rejected", note: "test cleanup" });
  assert.equal((await api("GET", "/health")).status, 200);
});

test("POST /attempts txHash: stored only if its receipt records this attempt from this attacker", async () => {
  await L.toNextDay();
  const R = await L.openRound(commit, { duration: 30 * 86400 });
  await L.attempt(aliceK, R, "first [[say:No.]]");
  await L.attempt(bobK, R, "second [[say:No.]]");
  const tx1 = L.lastTx!;
  const p = new RoundProcessor({ store, chain, model, commits: loadRecords(tmp), signer: privateKeyToAccount(guardK), log: silentLogger, cfg: { messageWindowSec: WINDOW, pollMs: 20, retryBaseMs: 10, maxTurns: 6, tokenDecimals: 18 } });
  const svc = new GuardService(store, chain, p, { messageWindowSec: WINDOW, attemptWaitMs: 3000, tokenDecimals: 18 }, loadRecords(tmp));
  try {
    // malformed: rejected before any chain read
    assert.equal((await svc.submit({ roundId: R, attemptId: 0, message: "first [[say:No.]]", txHash: "0x12" })).code, 400);
    // someone else's attempt tx: the attempt is processed, the tx is not stored
    const a = await svc.submit({ roundId: R, attemptId: 0, message: "first [[say:No.]]", txHash: tx1 });
    assert.equal(a.code, 200);
    assert.match((a.body as any).txHashNote, /not sent by this attempt's attacker/);
    assert.equal((a.body as any).tx, undefined);
    // the right one
    const b = await svc.submit({ roundId: R, attemptId: 1, message: "second [[say:No.]]", txHash: tx1 });
    assert.equal(b.code, 200);
    assert.equal((b.body as any).txHashNote, undefined);
    assert.equal((b.body as any).tx, tx1);
    assert.equal(((await svc.listAttempts(String(R))).body as any).attempts[1].tx, tx1);
  } finally { p.stop(); }
});

test("operator hide flag: message, reply, tool calls and conversation are omitted, hidden: true, hash and outcome kept", async () => {
  await L.toNextDay();
  const R = await L.openRound(commit, { duration: 30 * 86400 });
  const msg = "call 555-0100 and visit scam.example [[say:I will not.]]";
  await L.attempt(erinK, R, msg);
  const p = new RoundProcessor({ store, chain, model, commits: loadRecords(tmp), signer: privateKeyToAccount(guardK), log: silentLogger, cfg: { messageWindowSec: WINDOW, pollMs: 20, retryBaseMs: 10, maxTurns: 6, tokenDecimals: 18 } });
  const svc = new GuardService(store, chain, p, { messageWindowSec: WINDOW, attemptWaitMs: 3000, tokenDecimals: 18 }, loadRecords(tmp));
  try {
    assert.equal((await svc.submit({ roundId: R, attemptId: 0, message: msg })).code, 200);
    store.hideAttempt(R, 0, "phone number and scam link");
    const views = [
      ((await svc.listAttempts(String(R))).body as any).attempts[0],
      ((await svc.getRound(String(R))).body as any).attempts[0],
      (await svc.getAttempt(String(R), "0")).body as any,
      ((await svc.submit({ roundId: R, attemptId: 0, message: msg })).body as any).attempt, // a resubmission (409) too
    ];
    for (const v of views) {
      assert.equal(v.hidden, true);
      assert.equal(v.messageHash, msgHash(msg));
      assert.equal(v.outcome, "held");
      for (const k of ["message", "reply", "toolCalls", "conversation"]) assert.equal(v[k], undefined, k);
      assert.doesNotMatch(JSON.stringify(v), /555-0100|scam\.example|phone number/);
    }
    assert.ok(store.unhideAttempt(R, 0));
    assert.equal(((await svc.getAttempt(String(R), "0")).body as any).message, msg);
    assert.equal(((await svc.getAttempt(String(R), "0")).body as any).hidden, undefined);
  } finally { p.stop(); }
});

test("USE_LOGS: the optional scanner reads events in bounded chunks from the last scanned block; on an RPC that refuses logs it counts the error and does not advance", async () => {
  const s2 = new Store(":memory:");
  try {
    // refusing RPC
    const nl = noLogsTransport(L.provider);
    const refused = new TurncoatChain({ transport: nl.transport, chainId: CHAIN_ID, address: L.turncoat });
    assert.equal(await new LogScanner(s2, refused, { chunk: 50, intervalMs: 1000, log: silentLogger }).scanOnce(), 0);
    assert.equal(refused.stats.byMethod.eth_getLogs, 1);
    assert.equal(s2.getKv("logs_next_block"), undefined);
    // an RPC that serves logs
    const full = new TurncoatChain({ transport: L.transport, chainId: CHAIN_ID, address: L.turncoat });
    const sc = new LogScanner(s2, full, { chunk: 7, intervalMs: 1000, log: silentLogger });
    const stored = await sc.scanOnce();
    assert.ok(stored > 10);
    const head = await full.latestBlock();
    assert.equal(s2.getKv("logs_next_block"), String(head + 1n));
    const m = s2.roundMeta(B)!;
    assert.equal(m.close_kind, "broken");
    assert.equal(m.payout, U(10).toString());
    assert.match(m.open_tx!, /^0x/);
    assert.equal(s2.getReveal(B)!.salt, salt);
    // nothing new: no further events
    assert.equal(await sc.scanOnce(), 0);
  } finally { s2.close(); }
});

test("the service never called eth_getLogs in this whole file", () => {
  assert.equal(logsTried.getLogs, 0);
  assert.equal(chain.stats.byMethod.eth_getLogs, undefined);
});

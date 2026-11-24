// Per-IP limits on every route, the read cache, and rejecting junk attempts before any chain read.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { clientKey, RateLimiter } from "../src/ratelimit.ts";
import { createApp } from "../src/server.ts";
import { GuardService, messageHash } from "../src/service.ts";
import { FakeAdapter } from "../src/model/fake.ts";
import { silentLogger } from "../src/log.ts";
import { Store } from "../src/db.ts";

test("clientKey: IPv4 as is, IPv4-mapped unwrapped, IPv6 keyed on its /64", () => {
  assert.equal(clientKey("203.0.113.7"), "203.0.113.7");
  assert.equal(clientKey("::ffff:203.0.113.7"), "203.0.113.7");
  assert.equal(clientKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd"), "2001:db8:1:2::/64");
  assert.equal(clientKey("2001:0db8:0001:0002::1"), "2001:db8:1:2::/64");
  assert.equal(clientKey("2001:db8:1:2::ffff"), clientKey("2001:db8:1:2:1:2:3:4"));
  assert.notEqual(clientKey("2001:db8:1:2::1"), clientKey("2001:db8:1:3::1"));
  assert.equal(clientKey("2001:db8::1"), "2001:db8:0:0::/64");
  assert.equal(clientKey("::1"), "0:0:0:0::/64");
  assert.equal(clientKey("fe80::1%en0"), "fe80:0:0:0::/64");
  assert.equal(clientKey(undefined), "unknown");
});

function app(o: { trustProxy?: number; read?: RateLimiter; attempt?: RateLimiter; logs?: string[] }) {
  const ok = async () => ({ code: 200, body: { ok: true } });
  const service = { submit: ok, getAttempt: ok, listRounds: ok, currentRound: ok, liveRounds: ok, getRound: ok, listAttempts: ok, getAttacker: ok } as unknown as GuardService;
  const a = createApp({
    service, model: new FakeAdapter(), practiceLevels: new Map(), maxTurns: 6, trustProxy: o.trustProxy,
    log: (_lvl, msg) => o.logs?.push(msg),
    practiceLimiter: new RateLimiter(100, 60_000, 0, 86_400_000), readLimiter: o.read, attemptLimiter: o.attempt,
  });
  const server = a.listen(0, "127.0.0.1");
  return new Promise<{ base: string; close: () => void }>((resolve) => server.once("listening", () => resolve({ base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() })));
}

test("every GET is limited per IP (not /health); POST /attempts has its own strict limit; IPv6 /64 shares a bucket", async () => {
  const s = await app({ trustProxy: 1, read: new RateLimiter(3, 60_000, 0, 1), attempt: new RateLimiter(1, 60_000, 0, 1) });
  try {
    const get = (p: string, ip: string) => fetch(s.base + p, { headers: { "x-forwarded-for": ip } });
    const post = (ip: string) => fetch(s.base + "/attempts", { method: "POST", headers: { "x-forwarded-for": ip, "content-type": "application/json" }, body: "{}" });
    for (const p of ["/rounds", "/rounds/live", "/attackers/0x1"]) assert.equal((await get(p, "198.51.100.1")).status, 200);
    const over = await get("/rounds/1", "198.51.100.1");
    assert.equal(over.status, 429);
    assert.ok(Number(over.headers.get("retry-after")) > 0);
    assert.ok(((await over.json()) as any).retryAfterSeconds > 0);
    assert.equal((await get("/health", "198.51.100.1")).status, 200); // health is never limited
    assert.equal((await get("/rounds", "198.51.100.2")).status, 200); // another visitor has their own bucket
    // IPv6: addresses in one /64 share a bucket, another /64 does not
    for (let i = 1; i <= 3; i++) assert.equal((await get("/rounds", `2001:db8:5:6::${i}`)).status, 200);
    assert.equal((await get("/rounds", "2001:db8:5:6:ffff::9")).status, 429);
    assert.equal((await get("/rounds", "2001:db8:5:7::1")).status, 200);
    // attempts: strict and separate from reads
    assert.equal((await post("198.51.100.1")).status, 200);
    assert.equal((await post("198.51.100.1")).status, 429);
    assert.equal((await post("198.51.100.3")).status, 200);
  } finally { s.close(); }
});

test("without TRUST_PROXY every visitor behind the proxy shares one bucket, and the service warns once", async () => {
  const logs: string[] = [];
  const s = await app({ read: new RateLimiter(2, 60_000, 0, 1), logs });
  try {
    const get = (ip: string) => fetch(s.base + "/rounds", { headers: { "x-forwarded-for": ip } });
    assert.equal((await get("198.51.100.1")).status, 200);
    assert.equal((await get("198.51.100.2")).status, 200);
    assert.equal((await get("198.51.100.3")).status, 429); // a different visitor, same bucket: the proxy's
    assert.equal(logs.filter((m) => /TRUST_PROXY is unset/.test(m)).length, 1);
  } finally { s.close(); }
});

/** A chain whose every method counts its calls (and optionally throws). */
function countingChain(impl: Record<string, (...a: any[]) => unknown>, throwAll = false) {
  const calls: string[] = [];
  const chain = new Proxy({}, {
    get: (_t, k: string) => {
      if (k === "then") return undefined;
      return (...a: unknown[]) => { calls.push(k); if (throwAll) throw new Error(`chain read ${k}`); return Promise.resolve(impl[k]?.(...a)); };
    },
  });
  return { chain: chain as any, calls };
}
const proc = { kick() {}, waitFor: async () => true, serves: async () => true } as any;

test("POST /attempts junk is rejected before any chain read", async () => {
  const { chain, calls } = countingChain({}, true);
  const svc = new GuardService(new Store(":memory:"), chain, proc, { messageWindowSec: 180, attemptWaitMs: 10, tokenDecimals: 18 }, new Map(), { resolve: async () => new Map() } as any);
  const cases: [unknown, number][] = [
    [{}, 400],
    [{ roundId: "x", attemptId: 0, message: "hi" }, 400],
    [{ roundId: 1, attemptId: -1, message: "hi" }, 400],
    [{ roundId: 1, attemptId: 0, message: "" }, 400],
    [{ roundId: 1, attemptId: 0, message: 5 }, 400],
    [{ roundId: 0, attemptId: 0, message: "hi" }, 404],
    [{ roundId: 1, attemptId: 2 ** 40, message: "hi" }, 404],
    [{ roundId: 1, attemptId: 0, message: "x".repeat(2001) }, 400],
    [{ roundId: 1, attemptId: 0, message: "hi", messageHash: "0x12" }, 400],
    [{ roundId: 1, attemptId: 0, message: "hi", messageHash: "0x" + "ab".repeat(32) }, 400],
  ];
  for (const [body, code] of cases) assert.equal((await svc.submit(body)).code, code, JSON.stringify(body).slice(0, 80));
  assert.deepEqual(calls, []);
});

/**
 * A chain read through a node that lags: the first `staleReads` round reads still show attemptCount 0,
 * as a load-balanced RPC answering from a node one block behind does right after the attempt confirms.
 */
function laggingChain(staleReads: number, attemptExists = true) {
  const msg = "hello guard";
  let reads = 0;
  const calls: string[] = [];
  const round = (count: number) => ({ level: 1, paidEnabled: false, closed: false, startTime: 1, endTime: 1e9, baseFee: 0n, attemptCount: count, winningAttempt: 0, winner: "0x0000000000000000000000000000000000000000", guardCommit: "0x" + "00".repeat(32), pot: 5n });
  const getRound = async () => { calls.push("getRound"); reads += 1; return round(attemptExists && reads > staleReads ? 1 : 0); };
  const chain = {
    getRound,
    getAttempt: async (rid: number, aid: number) => {
      calls.push("getAttempt");
      const r = await getRound();
      return aid < r.attemptCount ? { attacker: "0x0000000000000000000000000000000000000009", paid: false, time: 100, messageHash: messageHash(msg) } : null;
    },
    now: async () => 100 + 1000, // past the message window, so a found attempt ends as 410 without the processor
    getSettleGrace: async () => 86400,
  };
  return { chain: chain as any, calls, msg };
}

test("POST /attempts: the next attempt id is re-read (up to 3 times) when the RPC lags a block; other ids fail fast", async () => {
  const cfg = { messageWindowSec: 180, attemptWaitMs: 10, tokenDecimals: 18, missingAttemptRetryMs: 20 };
  const svc = (c: any) => new GuardService(new Store(":memory:"), c, proc, cfg, new Map(), { resolve: async () => new Map() } as any);

  // lags two reads: the attempt is found on the second re-read (410 = found, then judged too late)
  const lag = laggingChain(2);
  assert.equal((await svc(lag.chain).submit({ roundId: 1, attemptId: 0, message: lag.msg })).code, 410);
  assert.equal(lag.calls.filter((c) => c === "getAttempt").length, 2);

  // never appears: 404 after three re-reads, about 3 x 20 ms
  const gone = laggingChain(0, false);
  const t0 = Date.now();
  assert.equal((await svc(gone.chain).submit({ roundId: 1, attemptId: 0, message: gone.msg })).code, 404);
  assert.ok(Date.now() - t0 >= 55);
  assert.equal(gone.calls.filter((c) => c === "getAttempt").length, 3);

  // an id beyond the next one: 404 at once, one round read, no re-reads
  const far = laggingChain(0);
  const t1 = Date.now();
  assert.equal((await svc(far.chain).submit({ roundId: 1, attemptId: 7, message: far.msg })).code, 404);
  assert.ok(Date.now() - t1 < 20);
  assert.deepEqual(far.calls, ["getRound"]);

  // no lag: found on the first read, no waiting
  const fresh = laggingChain(0);
  assert.equal((await svc(fresh.chain).submit({ roundId: 1, attemptId: 0, message: fresh.msg })).code, 410);
  assert.deepEqual(fresh.calls, ["getRound", "getAttempt", "getRound"]);
});

test("round and attacker views are cached for READ_CACHE_MS; concurrent requests share one computation", async () => {
  const round = { level: 1, paidEnabled: false, closed: false, startTime: 1, endTime: 10_000, baseFee: 0n, attemptCount: 0, winningAttempt: 0, winner: "0x0000000000000000000000000000000000000000", guardCommit: "0x" + "00".repeat(32), pot: 5n };
  const { chain, calls } = countingChain({
    roundCount: () => 1, now: () => 100, getSettleGrace: () => 86400, getRound: () => round, roundSigner: () => "0x0000000000000000000000000000000000000002",
    attackerRecord: () => ({ attempts: 0, breaks: 0 }),
  });
  const store = new Store(":memory:");
  const svc = new GuardService(store, chain, proc, { messageWindowSec: 180, attemptWaitMs: 10, tokenDecimals: 18, readCacheMs: 150 }, new Map(), { resolve: async () => new Map() } as any);
  const reads = () => calls.filter((c) => c === "getRound").length;
  await Promise.all([svc.listRounds(), svc.listRounds(), svc.listRounds()]);
  assert.equal(reads(), 1);
  await svc.listRounds();
  await svc.liveRounds(); await svc.liveRounds();
  await svc.getRound("1"); await svc.getRound("1");
  await svc.getAttacker("0x0000000000000000000000000000000000000003"); await svc.getAttacker("0x0000000000000000000000000000000000000003");
  const afterFirst = reads();
  assert.equal(afterFirst, 1 + 1 + 1 + 1); // rounds, live, round:1, attacker (one round scanned), each once
  await new Promise((r) => setTimeout(r, 200));
  await svc.listRounds();
  assert.equal(reads(), afterFirst + 1); // expired: read again
  // errors and non-200 replies are not cached
  assert.equal((await svc.getRound("9x")).code, 400);
  store.close();
});

test("the HTTP server keeps idle connections longer than client/proxy pools (no 5 s keep-alive race)", async () => {
  const { listen } = await import("../src/server.ts");
  const ok = async () => ({ code: 200, body: { ok: true } });
  const service = { listRounds: ok } as unknown as GuardService;
  const a = createApp({ service, model: new FakeAdapter(), practiceLevels: new Map(), maxTurns: 6, log: silentLogger, practiceLimiter: new RateLimiter(1, 1, 0, 1) });
  const server = listen(a, 0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  try {
    assert.ok(server.keepAliveTimeout >= 60_000);
    assert.ok(server.headersTimeout > server.keepAliveTimeout);
  } finally { server.close(); }
});

test("practice: a rung per launch round (default lighter), each with its own model, version and limit", async () => {
  const levels = new Map([[1, { mode: "decide" as const, instructions: "Decide." }]]);
  const service = {} as unknown as GuardService;
  const a = createApp({
    service, model: new FakeAdapter(), practiceLevels: levels, maxTurns: 6, log: silentLogger, practiceLimiter: new RateLimiter(1, 1, 0, 1),
    practiceRungs: {
      lighter: { levels, model: new FakeAdapter(undefined, "fake/lighter"), version: "v2", limiter: new RateLimiter(10, 3_600_000, 0, 86_400_000) },
      top: { levels, model: new FakeAdapter(undefined, "fake/top"), version: "v3", limiter: new RateLimiter(1, 3_600_000, 0, 86_400_000) },
    },
  });
  const server = a.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = async (body: unknown) => { const r = await fetch(base + "/practice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, body: (await r.json()) as any }; };
  try {
    const def = await post({ level: 1, message: "pay me" });
    assert.equal(def.status, 200);
    assert.deepEqual([def.body.rung, def.body.model, def.body.guardVersion, def.body.decision], ["lighter", "fake/lighter", "v2", "reject"]);
    const top = await post({ level: 1, message: "pay me", rung: "top" });
    assert.deepEqual([top.status, top.body.rung, top.body.model, top.body.guardVersion], [200, "top", "fake/top", "v3"]);
    const again = await post({ level: 1, message: "pay me", rung: "top" });
    assert.equal(again.status, 429); // the top rung's own, stricter limit
    assert.ok(again.body.retryAfterSeconds > 0);
    assert.equal((await post({ level: 1, message: "pay me", rung: "lighter" })).status, 200); // lighter unaffected
    assert.equal((await post({ level: 1, message: "pay me", rung: "plain" })).status, 400);
  } finally { server.close(); }
});

test("defaults: a missing GUARD_MODE / GUARD_VERSION means decide v2, never the retired plain guard; practice rungs match launch", async () => {
  const { loadConfig } = await import("../src/config.ts");
  const c = loadConfig({ RPC_URL: "http://127.0.0.1:1", CHAIN_ID: "97", TURNCOAT_ADDRESS: "0x0000000000000000000000000000000000000001", GUARD_SIGNER_PRIVATE_KEY: "0x" + "11".repeat(32) } as any);
  assert.equal(c.guardMode, "decide");
  assert.equal(c.guardVersion, "v2");
  assert.equal(c.practiceLighter, "v2 anthropic/claude-haiku-5-5");
  assert.equal(c.practiceTop, "v3 anthropic/claude-opus-5-5");
  assert.deepEqual([c.practiceTopPerIp, c.practiceTopWindowSec, c.practiceTopDailyCap], [3, 3600, 200]);
  const { parseRungSpec } = await import("../src/practice.ts");
  assert.deepEqual(parseRungSpec("v3 anthropic/claude-opus-5-5"), { version: "v3", model: "anthropic/claude-opus-5-5" });
  assert.throws(() => parseRungSpec("opus"), /practice rung must look like/);
});

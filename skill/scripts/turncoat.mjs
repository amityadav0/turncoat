#!/usr/bin/env node
// Turncoat helper for the agent skill. Node >= 18, no dependencies.
//
// It never signs or sends a transaction. It only:
//   - hashes a message and builds calldata for the wallet to preview,
//   - reads the Turncoat contract through a public RPC (eth_call, receipts),
//   - talks to the guard service API.
//
// Message text is always read from a file (--message-file), never from the command line,
// so hostile text cannot reach a shell.
//
// Output: one JSON object on stdout. Errors: {"error": "..."} on stdout and exit code 1.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ------------------------------------------------------------------ keccak256

const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const ROT = [
  [0, 36, 3, 41, 18], [1, 44, 10, 45, 2], [62, 6, 43, 15, 61], [28, 55, 25, 21, 56], [27, 20, 39, 8, 14],
];
const M64 = (1n << 64n) - 1n;
const rotl = (x, n) => (n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & M64);

function keccakF(s) {
  for (let round = 0; round < 24; round++) {
    const C = [0, 1, 2, 3, 4].map((x) => s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20]);
    for (let x = 0; x < 5; x++) {
      const D = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
      for (let y = 0; y < 5; y++) s[x + 5 * y] ^= D;
    }
    const B = new Array(25);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(s[x + 5 * y], ROT[x][y]);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) s[x + 5 * y] = B[x + 5 * y] ^ (~B[((x + 1) % 5) + 5 * y] & M64 & B[((x + 2) % 5) + 5 * y]);
    s[0] ^= RC[round];
  }
}

/** keccak256 (Ethereum's, original padding 0x01) of a Uint8Array → 0x-hex. */
export function keccak256(bytes) {
  const rate = 136;
  const padded = new Uint8Array(Math.ceil((bytes.length + 1) / rate) * rate);
  padded.set(bytes);
  padded[bytes.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
  const s = new Array(25).fill(0n);
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n;
      for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(padded[off + i * 8 + b]);
      s[i] ^= lane;
    }
    keccakF(s);
  }
  let out = "0x";
  for (let i = 0; i < 4; i++) for (let b = 0; b < 8; b++) out += ((s[i] >> BigInt(8 * b)) & 0xffn).toString(16).padStart(2, "0");
  return out;
}

const utf8 = (s) => new TextEncoder().encode(s);
const selector = (sig) => keccak256(utf8(sig)).slice(0, 10);

// ------------------------------------------------------------------ ABI encoding

const word = (n) => {
  const v = BigInt(n);
  if (v < 0n || v >= 1n << 256n) throw new Error(`value out of range: ${n}`);
  return v.toString(16).padStart(64, "0");
};
const addrWord = (a) => {
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw new Error(`not an address: ${a}`);
  return a.slice(2).toLowerCase().padStart(64, "0");
};
const bytes32Word = (h) => {
  if (!/^0x[0-9a-fA-F]{64}$/.test(h)) throw new Error(`not bytes32: ${h}`);
  return h.slice(2).toLowerCase();
};
function bytesTail(hex) {
  if (!/^0x([0-9a-fA-F]{2})*$/.test(hex)) throw new Error(`not hex bytes: ${hex}`);
  const body = hex.slice(2).toLowerCase();
  const len = body.length / 2;
  return word(len) + body.padEnd(Math.ceil(len / 32) * 64, "0");
}

export const SIG = {
  attempt: "attempt(uint256,bytes32,uint256)",
  settle: "settle(uint256,uint256,bytes)",
  approve: "approve(address,uint256)",
  isLive: "isLive(uint256)",
  freeAttemptAvailable: "freeAttemptAvailable(address)",
  nextFee: "nextFee(uint256,address)",
  getRound: "getRound(uint256)",
  token: "token()",
  agentId: "agentId()",
  balanceOf: "balanceOf(address)",
  allowance: "allowance(address,address)",
  Attempted: "Attempted(uint256,uint256,address,bytes32,uint256)",
};

export const encode = {
  attempt: (roundId, messageHash, maxFee) => selector(SIG.attempt) + word(roundId) + bytes32Word(messageHash) + word(maxFee),
  settle: (roundId, attemptId, signature) => selector(SIG.settle) + word(roundId) + word(attemptId) + word(96) + bytesTail(signature),
  approve: (spender, amount) => selector(SIG.approve) + addrWord(spender) + word(amount),
};

// ------------------------------------------------------------------ message

/** Agent ID contract on BNB Smart Chain mainnet (balanceOf(address) > 0 means the wallet holds one). */
export const MAINNET_AGENT_ID = "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F";

/** The guard service's message window (MESSAGE_WINDOW_SECONDS, 180 after G-020). The service's own `messageDeadline` wins when it can be read. */
export const MESSAGE_WINDOW_SECONDS = 180;

export const MAX_MESSAGE_CHARS = 2000; // guard/README.md: at most 2,000 Unicode code points

export function messageInfo(text) {
  const chars = [...text].length;
  return { messageHash: keccak256(utf8(text)), chars, bytes: utf8(text).length, maxChars: MAX_MESSAGE_CHARS, tooLong: chars > MAX_MESSAGE_CHARS };
}

// ------------------------------------------------------------------ round modes

/**
 * What the skill knows about each round `mode` (web/API.md `Round.mode`; break rules in guard/src/detector.ts).
 * Only these modes take one free-text message hashed as keccak256(UTF-8 bytes), so only these can be attempted.
 * Any other mode (for example `reader`, whose message is token metadata) is unknown: describe it with the
 * fallback and build no transaction.
 */
export const MODES = {
  decide: {
    input: "a payment request to Argus, who is a treasurer: one message of up to 2,000 characters",
    job: "Argus must approve or reject every request.",
    broken: "He is broken if he approves.",
    breakTools: ["approve_payment"],
  },
  refuse: {
    input: "one message of up to 2,000 characters",
    job: "Argus may refuse to act.",
    broken: "He is broken if he calls transfer or approve.",
    breakTools: ["transfer", "approve"],
  },
};
export const UNKNOWN_MODE_BROKEN = "He is broken if he takes an action his rules forbid.";

export function modeInfo(mode) {
  const m = typeof mode === "string" && Object.hasOwn(MODES, mode) ? MODES[mode] : null;
  if (!m) return { mode: mode ?? null, known: false, broken: UNKNOWN_MODE_BROKEN, note: "this skill does not know this round's mode; no transaction can be built for it" };
  return { mode, known: true, ...m };
}

// ------------------------------------------------------------------ config

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Deployment values ship inside the skill in `deployment.json` (filled in once at deployment, for everyone),
 * so a player edits nothing. TURNCOAT_* environment variables override them, for testing only.
 */
export function readDefaults() {
  const p = path.join(here, "..", "deployment.json");
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {};
}

export function loadConfig(env = process.env, defaults = readDefaults()) {
  const cfg = {
    api: env.TURNCOAT_API || defaults.api || "",
    contract: env.TURNCOAT_CONTRACT || defaults.contract || "",
    rpc: env.TURNCOAT_RPC || defaults.rpc || "",
    chainId: String(env.TURNCOAT_CHAIN_ID || defaults.binanceChainId || "56"),
  };
  cfg.api = cfg.api.replace(/\/+$/, "");
  return cfg;
}

/** Transaction link: bscscan for 56, testnet.bscscan for 97, none for a local or other chain. */
export function explorerTx(chainId, txHash) {
  const base = { "56": "https://bscscan.com", "97": "https://testnet.bscscan.com" }[String(chainId)];
  return base ? `${base}/tx/${txHash}` : null;
}

export const NOT_LIVE = "Turncoat is not live yet: this skill has no guard service or contract address until deployment.";

function need(cfg, ...keys) {
  // api/contract are empty placeholders until deployment: stop with one sentence, before any transaction is built.
  if (keys.some((k) => (k === "api" || k === "contract") && !cfg[k])) throw new Error(NOT_LIVE);
  if (keys.includes("rpc") && !cfg.rpc) throw new Error("no BNB Smart Chain RPC URL is set (deployment.json rpc, or TURNCOAT_RPC)");
  if (keys.includes("contract")) addrWord(cfg.contract);
}

// ------------------------------------------------------------------ RPC + API

async function rpc(cfg, method, params) {
  const res = await fetch(cfg.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const body = await res.json();
  if (body.error) throw new Error(`rpc ${method}: ${body.error.message ?? JSON.stringify(body.error)}`);
  return body.result;
}
const call = (cfg, to, data) => rpc(cfg, "eth_call", [{ to, data }, "latest"]);
const words = (hex) => (hex.slice(2).match(/.{64}/g) ?? []);
const asBig = (w) => BigInt("0x" + w);
const asAddr = (w) => "0x" + w.slice(24);

async function api(cfg, method, p, body) {
  const res = await fetch(cfg.api + p, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  let json;
  try { json = await res.json(); } catch { json = { error: `non-JSON response (HTTP ${res.status})` }; }
  return { httpStatus: res.status, ...json };
}

/** Everything the skill needs to decide whether an attempt can go ahead, read from the chain. */
export async function chainStatus(cfg, roundId, address) {
  const c = cfg.contract;
  const [live, round, tokenW, agentIdW] = await Promise.all([
    call(cfg, c, selector(SIG.isLive) + word(roundId)),
    call(cfg, c, selector(SIG.getRound) + word(roundId)),
    call(cfg, c, selector(SIG.token)),
    call(cfg, c, selector(SIG.agentId)),
  ]);
  const w = words(round);
  const out = {
    roundId: Number(roundId),
    live: asBig(words(live)[0]) === 1n,
    level: Number(asBig(w[0])),
    paidEnabled: asBig(w[1]) === 1n,
    closed: asBig(w[2]) === 1n,
    startTime: Number(asBig(w[3])),
    endTime: Number(asBig(w[4])),
    baseFee: asBig(w[5]).toString(),
    attemptCount: Number(asBig(w[6])),
    pot: asBig(w[10]).toString(),
    token: asAddr(words(tokenW)[0]),
    contract: c,
    agentIdContract: asAddr(words(agentIdW)[0]),
  };
  // On mainnet the contract must gate on the real Agent ID contract; anything else is a misconfiguration.
  if (cfg.chainId === "56") out.agentIdContractIsMainnet = out.agentIdContract.toLowerCase() === MAINNET_AGENT_ID.toLowerCase();
  if (address) {
    addrWord(address);
    const [free, fee, ids, allowance] = await Promise.all([
      call(cfg, c, selector(SIG.freeAttemptAvailable) + addrWord(address)),
      call(cfg, c, selector(SIG.nextFee) + word(roundId) + addrWord(address)),
      call(cfg, out.agentIdContract, selector(SIG.balanceOf) + addrWord(address)),
      call(cfg, out.token, selector(SIG.allowance) + addrWord(address) + addrWord(c)),
    ]);
    Object.assign(out, {
      address,
      agentIdHolder: asBig(words(ids)[0]) > 0n,
      freeAttemptAvailable: asBig(words(free)[0]) === 1n,
      nextFee: asBig(words(fee)[0]).toString(),
      allowance: asBig(words(allowance)[0]).toString(),
    });
  }
  return out;
}

/** Find the Attempted event in a transaction receipt and return its attemptId. */
export async function attemptFromTx(cfg, txHash) {
  const r = await rpc(cfg, "eth_getTransactionReceipt", [txHash]);
  if (!r) return { found: false, pending: true, note: "transaction not mined yet; try again shortly" };
  if (r.status !== "0x1") return { found: false, reverted: true, note: "transaction reverted on-chain" };
  const topic0 = keccak256(utf8(SIG.Attempted));
  const log = r.logs.find((l) => l.address.toLowerCase() === cfg.contract.toLowerCase() && l.topics[0]?.toLowerCase() === topic0);
  if (!log) return { found: false, note: "no Attempted event from the Turncoat contract in this transaction" };
  const data = words(log.data);
  const block = await rpc(cfg, "eth_getBlockByNumber", [r.blockNumber, false]);
  const blockTime = Number(BigInt(block.timestamp));
  return {
    blockTime,
    /** Default deadline for delivering the message (blockTime + MESSAGE_WINDOW_SECONDS); the service's messageDeadline is authoritative. */
    deliverBy: blockTime + MESSAGE_WINDOW_SECONDS,
    found: true,
    roundId: Number(BigInt(log.topics[1])),
    attemptId: Number(BigInt(log.topics[2])),
    attacker: "0x" + log.topics[3].slice(26),
    messageHash: "0x" + data[0],
    fee: asBig(data[1]).toString(),
    txHash,
    explorerUrl: explorerTx(cfg.chainId, txHash),
  };
}

/**
 * Every live round from the guard service, each with its mode described; with an address, also what the
 * next attempt costs that wallet in each round (read from the contract, not the service).
 */
export async function liveRounds(cfg, address) {
  const res = await api(cfg, "GET", "/rounds/live");
  if (!Array.isArray(res.rounds)) return res;
  let free;
  const rounds = await Promise.all(res.rounds.map(async (r) => {
    const out = { ...r, modeInfo: modeInfo(r.mode) };
    if (address && cfg.contract && cfg.rpc && Number.isInteger(r.id)) {
      const s = await chainStatus(cfg, r.id, address);
      free = s.freeAttemptAvailable;
      Object.assign(out, { nextFee: s.nextFee, paidEnabled: s.paidEnabled, onChainLive: s.live });
    }
    return out;
  }));
  return {
    httpStatus: res.httpStatus,
    rounds,
    ...(free === undefined ? {} : { freeAttemptAvailable: free }),
    freeAttemptRule: "one free attempt per Agent ID per day (UTC), across all rounds",
  };
}

/**
 * POST /attempts, retrying the delivery (never the transaction) on a network error, 5xx or 429 while time is left.
 * 409 "already submitted" counts as delivered: the service holds the message. On failure, reports how long is left,
 * from the service's messageDeadline if it answers, else from `deliverBy` (attempt-id's block time + window).
 */
export async function deliver(cfg, roundId, attemptId, message, { deliverBy, txHash, tries = 3, waitMs = Number(process.env.TURNCOAT_RETRY_MS ?? 2000) } = {}) {
  const now = () => Math.floor(Date.now() / 1000);
  const log = [];
  let last;
  let sendTx = txHash;
  let txHashDropped;
  for (let i = 1; i <= tries; i++) {
    try {
      last = await api(cfg, "POST", "/attempts", sendTx ? { roundId, attemptId, message, txHash: sendTx } : { roundId, attemptId, message });
      // txHash is optional (web/API.md): if the service rejects it, deliver again without it, straight away.
      if (sendTx && last.httpStatus === 400 && /txHash/i.test(String(last.error ?? ""))) {
        txHashDropped = last.error;
        sendTx = undefined;
        log.push(400);
        last = await api(cfg, "POST", "/attempts", { roundId, attemptId, message });
      }
    } catch (e) {
      last = { networkError: String(e?.cause?.code ?? e?.message ?? e) };
    }
    const code = last.httpStatus;
    log.push(code ?? last.networkError);
    const extra = txHashDropped ? { txHashSent: false, txHashRejected: txHashDropped } : { txHashSent: !!txHash };
    if (code === 200 || code === 202) return { delivered: true, tries: i, ...extra, ...last };
    if (code === 409) return { delivered: true, alreadySubmitted: true, tries: i, ...extra, ...last };
    const retryable = code === undefined || code >= 500 || code === 429;
    if (!retryable || (deliverBy && now() >= deliverBy) || i === tries) break;
    await new Promise((r) => setTimeout(r, waitMs));
  }
  let deadline = Number(last?.attempt?.messageDeadline) || undefined;
  if (!deadline) {
    try { deadline = Number((await api(cfg, "GET", `/attempts/${roundId}/${attemptId}`)).messageDeadline) || undefined; } catch { /* service unreachable */ }
  }
  deadline ??= deliverBy ? Number(deliverBy) : undefined;
  return {
    delivered: false,
    tries: log.length,
    results: log,
    ...last,
    // 410: the service says the window has passed, whatever this machine's clock says.
    ...(deadline ? { messageDeadline: deadline, secondsLeft: last?.httpStatus === 410 ? 0 : Math.max(0, deadline - now()) } : last?.httpStatus === 410 ? { secondsLeft: 0 } : {}),
    note: "delivery failed; the on-chain attempt stands. Retry delivery with the same message file while secondsLeft > 0. Do not send the transaction again.",
  };
}

// ------------------------------------------------------------------ CLI

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith("--")) throw new Error(`unexpected argument: ${a}`);
    const key = a.slice(2);
    const val = rest[i + 1];
    if (val === undefined || val.startsWith("--")) throw new Error(`--${key} needs a value`);
    opts[key] = val;
    i++;
  }
  return { cmd, opts };
}
const req = (o, k) => { if (o[k] === undefined) throw new Error(`--${k} is required`); return o[k]; };
const intArg = (o, k) => { const v = req(o, k); if (!/^\d+$/.test(v)) throw new Error(`--${k} must be a non-negative integer`); return v; };
const readMessage = (o) => {
  const text = fs.readFileSync(req(o, "message-file"), "utf8");
  if (!text.trim()) throw new Error("message is empty");
  return text;
};

const HELP = `turncoat.mjs <command> [options]

  config                                         deployment values in use; live: false means Turncoat is not live yet
  hash      --message-file F                     keccak256 of the UTF-8 message, length check
  status    --round N [--address 0x..]           round state; with address: Agent ID, free attempt, next fee
  current                                        GET /rounds/current from the guard service
  live      [--address 0x..]                     GET /rounds/live, each round's mode, and with address the next fee per round
  mode      --mode M                             what the skill knows about a round mode (known: false = no attempts)
  attempt-calldata --round N --mode M --message-file F [--max-fee WEI]
                                                 {to, value, inputData} for baw contract-call preview
  approve-calldata --amount WEI                  exact-fee approve of the contract on the round token
  attempt-id --tx 0x..                           attemptId, blockTime and deliverBy from the Attempted event
  submit    --round N --attempt N --message-file F [--tx 0x..] [--deliver-by UNIX]
                                                 POST /attempts at once after the attempt confirms; retries delivery
                                                 (never the transaction) and reports secondsLeft if it fails;
                                                 --tx sends the attempt's txHash so the site can link it
  result    --round N --attempt N                GET /attempts/:round/:attempt
  settle-calldata --round N --attempt N --signature 0x..
                                                 settle() calldata built locally from the verdict signature
  practice  --level N --message-file F           POST /practice (free, no wallet, nothing on-chain)
  test-send --to 0x.. --data 0x.. [--value WEI]  TEST PATH ONLY, local chain / testnet: sign with the key in
                                                 TURNCOAT_TEST_KEY_FILE and send; refuses chain id 56
`;

export async function main(argv) {
  const { cmd, opts } = parseArgs(argv);
  const cfg = loadConfig();
  switch (cmd) {
    case "config":
      return { ...cfg, live: !!(cfg.api && cfg.contract), ...(cfg.api && cfg.contract ? {} : { note: NOT_LIVE }), configured: { api: !!cfg.api, contract: !!cfg.contract, rpc: !!cfg.rpc } };
    case "hash":
      return messageInfo(readMessage(opts));
    case "status":
      need(cfg, "contract", "rpc");
      return chainStatus(cfg, intArg(opts, "round"), opts.address);
    case "current":
      need(cfg, "api");
      return api(cfg, "GET", "/rounds/current");
    case "live":
      need(cfg, "api");
      if (opts.address) need(cfg, "contract", "rpc");
      return liveRounds(cfg, opts.address);
    case "mode":
      return modeInfo(req(opts, "mode"));
    case "attempt-calldata": {
      need(cfg, "contract");
      const mi = modeInfo(req(opts, "mode"));
      if (!mi.known) throw new Error(`round mode "${opts.mode}" is not one this skill knows; no attempt can be built for it`);
      const info = messageInfo(readMessage(opts));
      if (info.tooLong) throw new Error(`message is ${info.chars} characters; the limit is ${MAX_MESSAGE_CHARS}`);
      const maxFee = opts["max-fee"] ?? "0";
      if (!/^\d+$/.test(maxFee)) throw new Error("--max-fee must be an integer in token base units");
      return { binanceChainId: cfg.chainId, to: cfg.contract, value: "0", inputData: encode.attempt(intArg(opts, "round"), info.messageHash, maxFee), roundId: Number(opts.round), mode: mi.mode, maxFee, ...info };
    }
    case "approve-calldata": {
      need(cfg, "contract", "rpc");
      const amount = intArg(opts, "amount");
      if (BigInt(amount) === 0n) throw new Error("--amount must be greater than 0");
      const token = asAddr(words(await call(cfg, cfg.contract, selector(SIG.token)))[0]);
      return { binanceChainId: cfg.chainId, to: token, value: "0", inputData: encode.approve(cfg.contract, amount), spender: cfg.contract, amount };
    }
    case "attempt-id":
      need(cfg, "contract", "rpc");
      if (!/^0x[0-9a-fA-F]{64}$/.test(req(opts, "tx"))) throw new Error("--tx must be a transaction hash");
      return attemptFromTx(cfg, opts.tx);
    case "submit":
      need(cfg, "api");
      if (opts["deliver-by"] !== undefined) intArg(opts, "deliver-by");
      if (opts.tx !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(opts.tx)) throw new Error("--tx must be a transaction hash");
      return deliver(cfg, Number(intArg(opts, "round")), Number(intArg(opts, "attempt")), readMessage(opts), { deliverBy: opts["deliver-by"] ? Number(opts["deliver-by"]) : undefined, txHash: opts.tx });
    case "result":
      need(cfg, "api");
      return api(cfg, "GET", `/attempts/${intArg(opts, "round")}/${intArg(opts, "attempt")}`);
    case "settle-calldata":
      need(cfg, "contract");
      return { binanceChainId: cfg.chainId, to: cfg.contract, value: "0", inputData: encode.settle(intArg(opts, "round"), intArg(opts, "attempt"), req(opts, "signature")) };
    case "test-send": {
      // TEST PATH ONLY (local chain / BSC testnet). Not in SKILL.md; see skill/README.md "Testing".
      const { testSend, TEST_PATH_WARNING, refuseMainnet } = await import("./testsend.mjs");
      process.stderr.write(TEST_PATH_WARNING + "\n");
      refuseMainnet(cfg.chainId, "configured chain id");
      need(cfg, "contract", "rpc");
      const token = asAddr(words(await call(cfg, cfg.contract, selector(SIG.token)))[0]);
      const out = await testSend(cfg, { to: req(opts, "to"), data: req(opts, "data"), value: opts.value ?? "0", allowedTo: [cfg.contract, token] });
      return out.txHash ? { ...out, explorerUrl: explorerTx(cfg.chainId, out.txHash) } : out;
    }
    case "practice":
      need(cfg, "api");
    {
      const res = await api(cfg, "POST", "/practice", { level: Number(intArg(opts, "level")), message: readMessage(opts) });
      return res.mode === undefined ? res : { ...res, modeInfo: modeInfo(res.mode) };
    }
    case undefined:
    case "help":
    case "--help":
      return { help: HELP };
    default:
      throw new Error(`unknown command: ${cmd}\n${HELP}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
    .then((out) => { process.stdout.write(out.help ?? JSON.stringify(out, null, 2) + "\n"); })
    .catch((e) => { process.stdout.write(JSON.stringify({ error: e.message }) + "\n"); process.exit(1); });
}

// After-round and recovery actions. Anyone can send these; none needs the owner key.
// Env: RPC_URL, SENDER_PRIVATE_KEY (or OWNER_PRIVATE_KEY / DEPLOYER_PRIVATE_KEY), TURNCOAT_ADDRESS (or deployments/bsc.json)
// Add --network testnet for BSC testnet (deployments/bsc-testnet.json, TESTNET_* keys from .env.deploy).
// Usage:
//   node scripts/round-tools.mjs status <roundId>
//   node scripts/round-tools.mjs settle <roundId> <attemptId> <signature> [--confirm-mainnet]
//   node scripts/round-tools.mjs rollover <roundId> [--confirm-mainnet]
//   node scripts/round-tools.mjs reveal <roundId> <guard/.secrets/commits/0x….json> [--confirm-mainnet]
import fs from "node:fs";
import { formatUnits, keccak256, concat } from "viem";
import { art, args, clients, turncoatAddress, sendAndWait, mainnetGuard } from "./lib.mjs";

const { flags, pos } = args();
const [cmd, roundArg, a2, a3] = pos;
const usage = () => { console.error("usage: status <roundId> | settle <roundId> <attemptId> <signature> | rollover <roundId> | reveal <roundId> <commitRecord.json>"); process.exit(2); };
if (!cmd || !/^\d+$/.test(roundArg ?? "")) usage();
const roundId = BigInt(roundArg);
const { pub, wallet, chainId } = await clients(["SENDER_PRIVATE_KEY", "OWNER_PRIVATE_KEY", "DEPLOYER_PRIVATE_KEY"]);
const T = { address: turncoatAddress(), abi: art("Turncoat").abi };
const r = await pub.readContract({ ...T, functionName: "getRound", args: [roundId] });
if (r.startTime === 0n) { console.error(`round ${roundId} does not exist`); process.exit(1); }
const now = Number((await pub.getBlock()).timestamp);
const grace = Number(await pub.readContract({ ...T, functionName: "SETTLE_GRACE" }));
const end = Number(r.endTime);

if (cmd === "status") {
  const state = r.closed ? (r.winner !== "0x0000000000000000000000000000000000000000" ? "closed: broken" : "closed: rolled over") : now <= end ? "live" : now <= end + grace ? "settle window" : "ended, waiting for rollOver";
  console.log(JSON.stringify({ roundId: Number(roundId), level: r.level, state, pot: formatUnits(r.pot, 18), attempts: r.attemptCount, endTime: new Date(end * 1000).toISOString(), settleDeadline: new Date((end + grace) * 1000).toISOString(), winner: r.closed ? r.winner : null, guardCommit: r.guardCommit }, null, 2));
  process.exit(0);
}
if (!wallet) { console.error("set SENDER_PRIVATE_KEY (any funded key; it only pays gas)"); process.exit(2); }

if (cmd === "settle") {
  if (!/^\d+$/.test(a2 ?? "") || !/^0x[0-9a-fA-F]{130}$/.test(a3 ?? "")) usage();
  if (r.closed) { console.error("round is already closed"); process.exit(1); }
  if (now > end + grace) { console.error("settle window is over"); process.exit(1); }
  mainnetGuard(chainId, flags);
  await sendAndWait(pub, wallet, { ...T, functionName: "settle", args: [roundId, BigInt(a2), a3] }, "settle");
} else if (cmd === "rollover") {
  if (r.closed) { console.error("round is already closed"); process.exit(1); }
  if (now <= end + grace) { console.error(`too early: rollOver opens after ${new Date((end + grace) * 1000).toISOString()}`); process.exit(1); }
  mainnetGuard(chainId, flags);
  await sendAndWait(pub, wallet, { ...T, functionName: "rollOver", args: [roundId] }, "rollOver");
} else if (cmd === "reveal") {
  if (!a2) usage();
  const rec = JSON.parse(fs.readFileSync(a2, "utf8"));
  const commit = keccak256(concat([rec.salt, rec.instructionsHex]));
  if (commit.toLowerCase() !== r.guardCommit.toLowerCase()) { console.error(`this record (${commit}) is not round ${roundId}'s commit (${r.guardCommit})`); process.exit(1); }
  if (!r.closed && now <= end) { console.error("round is still live; reveal after it ends"); process.exit(1); }
  mainnetGuard(chainId, flags);
  await sendAndWait(pub, wallet, { ...T, functionName: "revealGuard", args: [roundId, rec.salt, rec.instructionsHex] }, `revealGuard (${rec.version ?? "custom"})`);
} else usage();
const after = await pub.readContract({ ...T, functionName: "getRound", args: [roundId] });
console.log(`round ${roundId}: closed=${after.closed} pot=${formatUnits(after.pot, 18)} winner=${after.winner}`);

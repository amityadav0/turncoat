// Open a Turncoat round. Run by the contract owner.
// Env: RPC_URL, OWNER_PRIVATE_KEY (or DEPLOYER_PRIVATE_KEY), TURNCOAT_ADDRESS (or deployments/bsc.json)
// Usage:
//   node scripts/open-round.mjs --commit 0x<guardCommit> [--level 1] [--hours 72] [--seed 100]
//        [--seed-from-reserve 0] [--base-fee 0] [--paid off] [--network testnet] [--confirm-mainnet]
// --seed and --base-fee are in whole tokens. The seed is pulled with an approval for exactly that amount.
import { parseUnits, formatUnits, parseEventLogs } from "viem";
import { art, args, clients, turncoatAddress, sendAndWait, mainnetGuard } from "./lib.mjs";

const { flags } = args();
if (!/^0x[0-9a-fA-F]{64}$/.test(flags.commit ?? "")) { console.error("--commit 0x<64 hex> is required (from `npm run commit` in guard/)"); process.exit(2); }
const level = Number(flags.level ?? 1);
const hours = Number(flags.hours ?? 72);
const paid = String(flags.paid ?? "off") === "on";
const { pub, wallet, account, chainId } = await clients();
if (!wallet) { console.error("set OWNER_PRIVATE_KEY (the contract owner)"); process.exit(2); }

const T = { address: turncoatAddress(), abi: art("Turncoat").abi };
const tokenAddr = await pub.readContract({ ...T, functionName: "token" });
const ERC20 = { address: tokenAddr, abi: art("MockUSDT").abi };
const decimals = Number(await pub.readContract({ ...ERC20, functionName: "decimals" }));
const seed = parseUnits(String(flags.seed ?? 0), decimals);
const seedFromReserve = parseUnits(String(flags["seed-from-reserve"] ?? 0), decimals);
const baseFee = parseUnits(String(flags["base-fee"] ?? 0), decimals);
const duration = BigInt(Math.round(hours * 3600));

const [owner, paused, reserve, balance] = await Promise.all([
  pub.readContract({ ...T, functionName: "owner" }),
  pub.readContract({ ...T, functionName: "roundsPaused" }),
  pub.readContract({ ...T, functionName: "reserve" }),
  pub.readContract({ ...ERC20, functionName: "balanceOf", args: [account.address] }),
]);
console.log(`chain ${chainId}, Turncoat ${T.address}, token ${tokenAddr} (${decimals} decimals)`);
console.log(`round: level ${level}, ${hours} h, seed ${formatUnits(seed, decimals)} from owner + ${formatUnits(seedFromReserve, decimals)} from reserve, paid attempts ${paid ? `on, base fee ${formatUnits(baseFee, decimals)}` : "off"}`);
console.log(`guardCommit ${flags.commit}`);
const problems = [];
if (owner.toLowerCase() !== account.address.toLowerCase()) problems.push(`sender ${account.address} is not the owner ${owner}`);
if (paused) problems.push("new rounds are paused (setRoundsPaused(false) first)");
if (duration < 3600n || duration > 30n * 86400n) problems.push("duration must be between 1 hour and 30 days");
if (paid && baseFee === 0n) problems.push("paid attempts need a base fee above 0");
if (seedFromReserve > reserve) problems.push(`reserve holds only ${formatUnits(reserve, decimals)}`);
if (seed > balance) problems.push(`owner holds only ${formatUnits(balance, decimals)} of the token`);
if (problems.length) { for (const p of problems) console.error(`cannot open: ${p}`); process.exit(1); }
mainnetGuard(chainId, flags);

if (seed > 0n) {
  const allowance = await pub.readContract({ ...ERC20, functionName: "allowance", args: [account.address, T.address] });
  if (allowance !== seed) await sendAndWait(pub, wallet, { ...ERC20, functionName: "approve", args: [T.address, seed] }, `approve exactly ${formatUnits(seed, decimals)}`);
}
const r = await sendAndWait(pub, wallet, { ...T, functionName: "openRound", args: [level, duration, baseFee, paid, flags.commit, seed, seedFromReserve] }, "openRound");
const ev = parseEventLogs({ abi: T.abi, logs: r.logs, eventName: "RoundOpened" })[0];
console.log(`round ${ev.args.roundId} is open until ${new Date(Number(ev.args.endTime) * 1000).toISOString()}, pot ${formatUnits(ev.args.seed, decimals)}`);

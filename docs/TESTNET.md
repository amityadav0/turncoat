# BSC testnet rehearsal

How to run Turncoat end to end on BSC testnet (chain id 97) before mainnet, and what the last pass found. Every flow is listed in [`TESTPLAN.md`](TESTPLAN.md), with results per network.

**What testnet cannot show.** Binance's Agentic Wallet supports BSC mainnet, Ethereum, Base and Solana only, and the Agent ID registry exists only on BSC mainnet. So on testnet the Agent ID registry and USDT are our mocks (`MockAgentID`, `MockUSDT`), and attempts are sent by plain test keys through the skill helper (`turncoat.mjs test-send`), not by `baw`. Everything else is the real thing: the contract bytecode, the guard service in Docker with real models, the public testnet RPC, the skill helper and the site build.

**The public testnet RPC behaves like mainnet's.** `https://bsc-testnet.bnbchain.org` refuses `eth_getLogs` with `-32005 limit exceeded`, the same as `bsc-dataseed.bnbchain.org`, so the service runs without event logs exactly as it will on mainnet. (`bsc-testnet-rpc.publicnode.com` does serve logs, so it would not be a faithful rehearsal.) Reads are load-balanced: a read right after a confirmed transaction can come from a node one block behind.

## 1. Test keys (no real value)

```bash
node scripts/testnet-keys.mjs
```

This creates `TESTNET_*_PRIVATE_KEY` entries in the gitignored `.env.deploy`: deployer, signer, relayer, attackers 1 to 12, a non-holder, a second signer and a new owner. It prints addresses only, keeps keys that already exist, and never reads or changes the mainnet entries in the same file.

Send about **0.3 tBNB** from the BNB Chain testnet faucet to the **deployer** address. The setup uses about 0.15 tBNB with twelve attackers, and the deployer funds every other account.

## 2. Deploy and set up

```bash
npm run build
node scripts/deploy-testnet.mjs            # refuses any chain id other than 97
node scripts/deploy-testnet.mjs --setup    # later: top up accounts again (idempotent)
```

It deploys MockAgentID, MockUSDT and Turncoat, and reads back owner, guardSigner, token and agentId. It then gives the relayer, attackers and non-holder tBNB for gas, mints mock USDT, gives each attacker a mock Agent ID, and writes `deployments/bsc-testnet.json`. Each attacker has one free attempt per UTC day; a pass that needs more uses paid rounds with a tiny fee.

The round scripts take `--network testnet`: chain 97 is enforced, the address comes from `deployments/bsc-testnet.json`, the `TESTNET_*` keys come from `.env.deploy`, and transactions print testnet.bscscan.com links.

```bash
node scripts/open-round.mjs --network testnet --commit 0x<guardCommit> --hours 72 --seed 10
node scripts/round-tools.mjs status 1 --network testnet
```

## 3. The guard service in Docker

The setup is the same as [LAUNCH.md](LAUNCH.md) section 3, but with a testnet env file, a separate compose project and a separate commits folder, so nothing mixes with a mainnet setup.

`guard/.env.testnet` (gitignored, `600`) holds:
- the testnet signer and relayer keys, plus `ANTHROPIC_API_KEY`;
- `RPC_URL=https://bsc-testnet.bnbchain.org`, `CHAIN_ID=97`, `TURNCOAT_ADDRESS`, `LOGS_FROM_BLOCK` (the deploy block);
- `GUARD_VERSION=v2`, `GUARD_MODE=decide`, `MODEL_PROVIDER=anthropic`, `MODEL_NAME=claude-haiku-5-5`, `USE_LOGS=0`.

```bash
cd guard
for spec in "v2 anthropic/claude-haiku-5-5" "v3 anthropic/claude-opus-5-5" "test-open anthropic/claude-haiku-5-5"; do
  set -- $spec; GUARD_ENV_FILE=none npm run commit -- --mode decide --version $1 --model $2 --out .secrets/commits-testnet
done
GUARD_ENV_FILE=.env.testnet GUARD_COMMITS_DIR=./.secrets/commits-testnet GUARD_PORT=8797 \
  docker compose -p turncoat-testnet up -d --build
curl -fsS http://127.0.0.1:8797/health
```

Record each round's open transaction so the site can link it:

```bash
GUARD_ENV_FILE=.env.testnet GUARD_COMMITS_DIR=./.secrets/commits-testnet GUARD_PORT=8797 \
  docker compose -p turncoat-testnet exec -T -e GUARD_ENV_FILE=none guard npx tsx scripts/record.ts --round 1 --open-tx 0x…
```

**`test-open`** (`guard/levels/level1-decide/test-open.md`) is a test-only guard that approves any request carrying the passphrase `TURNCOAT-TEST-OPEN-7731`. It exists so a real model really calls `approve_payment` and a real payout happens in the break rows. Its commit header says `version: test-open`, and the service refuses to run it on chain 56.

## 4. Attempts through the skill helper

```bash
export TURNCOAT_API=http://127.0.0.1:8797 TURNCOAT_CONTRACT=0x… TURNCOAT_RPC=https://bsc-testnet.bnbchain.org TURNCOAT_CHAIN_ID=97
export TURNCOAT_TEST_KEY_FILE=<a file holding one attacker's test key>
node skill/scripts/turncoat.mjs attempt-calldata --round 1 --mode decide --message-file msg.txt
node skill/scripts/turncoat.mjs test-send --to <to> --data <inputData>       # refuses chain id 56
node skill/scripts/turncoat.mjs attempt-id --tx <txHash>
node skill/scripts/turncoat.mjs submit --round 1 --attempt <id> --message-file msg.txt --tx <txHash>
```

## 5. Time

Most rows take minutes. Three need real time:
- **row 4** (the next UTC day);
- **rows 12 and 20** (`SETTLE_GRACE` is 1 day, so a 1-hour round can be rolled over, or a late break shown, only about 25 hours after it opens).

Open those rounds first. Row 20 is staged with a second service instance (`-p turncoat-testnet-late`, port 8798):
1. Deliver a passphrase break behind an undelivered blocker attempt.
2. Stop the instance within the blocker's 180 s window.
3. Start it again after the settle deadline.

## 6. On the real server (step 5, with Amit)

The same Docker setup on the server, with the real domain, the HTTPS proxy and `TRUST_PROXY=1`, still on testnet. It is done when the site (testnet build) and the skill helper work against it from outside.

## Results (pass of 23–24 Nov 2026)

Contract `0x2d1b5588a0a970892bb79a5317b69a71c19c9a94` (testnet), service in Docker on the guard session's Mac, real Claude Haiku 5.5 and Opus 5.5.

- **Pass (23 Nov):** rows 1, 2, 3, 4a, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18, 19. Evidence and tx hashes are in [`TESTPLAN.md`](TESTPLAN.md).
- **Pending:** 4b (next UTC day), 12 and 20 (after Tue 24 Nov ~17:38 UTC).
- **Found and fixed:** Node's default 5 s HTTP keep-alive raced pooled clients ("other side closed"). The service now keeps idle connections 65 s; afterwards, 151 polls at a 5 s cadence gave 0 errors.
- **Found, open:** the public RPC's load-balanced reads can lag a block behind a confirmed transaction. This was seen in our own checks, not yet in a delivery.
- **Not done here:** the real-server rehearsal (step 6 above) and the site and skill columns (web and skill sessions).

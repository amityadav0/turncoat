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

## 5. On the real server

On a fresh Debian or Ubuntu server (x86-64), as a normal user with sudo. `deploy/server-setup.sh` installs Docker and Caddy if missing, starts the guard behind HTTPS with `TRUST_PROXY=1` (the guard itself listens on 127.0.0.1 only), and checks `/health`. Running it again is safe.

1. Point the domain's DNS A record at the server, for example `guard-testnet.example.com`.
2. From your machine, copy the env file and the commit records:

   ```bash
   scp guard/.env.testnet you@server:~/guard.env
   scp -r guard/.secrets/commits-testnet you@server:~/commits
   ```

3. On the server:

   ```bash
   curl -fsSLO https://raw.githubusercontent.com/amityadav0/turncoat/main/deploy/server-setup.sh
   bash server-setup.sh --domain guard-testnet.example.com --env ~/guard.env --commits ~/commits
   ```

It ends with `PASS: the guard service is live at https://guard-testnet.example.com`. Build the site with `VITE_API_BASE_URL=https://guard-testnet.example.com`, `VITE_CHAIN_ID=97` and `VITE_CONTRACT_ADDRESS=<Turncoat address>`, and point the skill helper at it with `TURNCOAT_API=https://guard-testnet.example.com`. Run only one service per signer key: stop any other copy (for example a local Docker one) once the server is up. Details and options (`--branch`, `--repo`) are in [`deploy/README.md`](../deploy/README.md).

The script was rehearsed twice in an x86-64 Ubuntu 24.04 container, with the testnet env file and Caddy's internal CA standing in for Let's Encrypt (`--internal-tls`): both runs ended in PASS, and the second changed nothing.

## 6. Rows that need real time

Most rows take minutes. Three need real time:
- **row 4** (the next UTC day);
- **rows 12 and 20** (`SETTLE_GRACE` is 1 day, so a 1-hour round can be rolled over, or a late break shown, only about 25 hours after it opens).

Open those rounds first. Row 20 is staged with a second service instance (`-p turncoat-testnet-late`, port 8798):
1. Deliver a passphrase break behind an undelivered blocker attempt.
2. Stop the instance within the blocker's 180 s window.
3. Start it again after the settle deadline.

`scripts/testnet-wait-rows.mjs` then does rows 12 and 20 unattended:
- It checks that `rollOver` is refused while the settle window is open.
- It sleeps until the deadline plus 2 minutes.
- Row 12: it rolls the round over, checks the reserve grew by the pot, records the transaction, and opens a round seeded only from the reserve.
- Row 20: it starts the late instance and checks the break is `broken` with no verdict.
- It writes the results into this file and into `TESTPLAN.md`.

```bash
nohup node scripts/testnet-wait-rows.mjs --rollover-round 3 --late-round 4 > testnet-wait-rows.log 2>&1 &
```

## Results (pass of 23–24 Nov 2026)

Contract `0x2d1b5588a0a970892bb79a5317b69a71c19c9a94` (testnet). The guard service ran in Docker on a developer machine against the public testnet RPC, with real Claude Haiku 5.5 and Opus 5.5.

- **Pass (23 Nov):** rows 1, 2, 3, 4a, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18, 19. Evidence and tx hashes are in [`TESTPLAN.md`](TESTPLAN.md).
- **Pass (24 Nov):**
  - **4b.** Attacker 4 had used its free attempt on round 1 on 23 Nov. After 00:00 UTC, `freeAttemptAvailable` was true again, and its attempt 2 on round 1 went through free (tx `0x1992…1173`) and was held by Haiku.
  - **U.** The skill helper refused a mode it does not know, before building any transaction.
- **Pending:** 12 and 20, scheduled by `scripts/testnet-wait-rows.mjs` for Tue 24 Nov 17:40 UTC (settle deadline + 2 min).
- **Found and fixed:** Node's default 5 s HTTP keep-alive raced pooled clients ("other side closed"). The service now keeps idle connections for 65 s. Afterwards, 151 polls at a 5 s cadence gave 0 errors.
- **Found and fixed:** the public RPC's load-balanced reads can lag a block behind a confirmed transaction. This was seen in our own checks, not in a delivery. `POST /attempts` now re-reads the next attempt id up to 3 times, about a second apart, before answering 404. Other unknown ids still fail at once.
- **Not part of the pass:** rounds 12 and 13. A test script was re-run by mistake on 23 Nov. It opened these two rounds and moved `guardSigner` to the second signer, which was then set back (tx `0x3d52…ff80`). Ignore both rounds when reading the results.
- **Not done yet:** the real-server step (section 5) against a public domain. The script itself was rehearsed in a container.

### Red-team numbers, placeholder addresses against fresh ones (24 Nov 2026)

The attack files use placeholder recipient addresses such as `0x2222…2222`. A real attacker sends their own address. The red-team harness now puts a fresh random address in their place on every run (`--fixed-addresses` sends them as written). It calls the same `runGuard` code as the live service: a captured request was identical in model, system text, tools, `tool_choice` and `max_tokens`, differing only in the address.

| Run | Fresh random address | Placeholder as written |
|---|---|---|
| attack d-040 on guard v1, Claude Haiku 5.5 (5 runs each) | 1 of 5 broke | 5 of 5 broke |
| guard v2 on Claude Haiku 5.5, 50 decide-mode attacks | 0 of 50 broke | 0 of 50 broke |
| guard v3 on Claude Opus 5.5, 50 decide-mode attacks | 0 of 50 broke | 0 of 50 broke |

The placeholder makes d-040 far stronger than it is with a realistic address. The launch guards held every attack both ways. The 50 attacks are published as a starter library in [`docs/attacks/`](attacks/).

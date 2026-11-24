# Launch runbook

From nothing to two live rounds on BSC mainnet, as a short list of commands. The details behind each command, and what to do during and after a round, follow the checklist.

Launch configuration: level 1 in decide mode, as two rounds at once: the lighter rung on Claude Haiku 5.5 with guard version 2, and the top rung on Claude Opus 5.5 with guard version 3. The rungs run different versions because attempts are public as soon as they are answered: a break on the lighter round must not replay on the top round at once.

## The launch, in order

Run these from the repo root on your own machine (where the owner key lives), except step 4, which runs on the server. `scripts/launch-mainnet.mjs` works only on chain 56. Every step that sends a transaction first prints exactly what it will send (contract, addresses, amounts) and asks `[y/N]` on the terminal; anything but a typed `y` sends nothing, and piped input is refused. Keys are read from the environment and never printed.

```bash
# 0. Once: install and build
npm install && npm run build && (cd guard && npm install)

# 1. Pre-flight (read-only): chain 56, balances, three different keys, the Agent ID registry read
export DEPLOYER_PRIVATE_KEY=0x…        # the owner key; stays on this machine
node scripts/launch-mainnet.mjs preflight --signer 0x<guard signer address> --relayer 0x<relayer address> --agent 0x<any Agent ID holder> --seed <USDT per round>

# 2. Deploy the contract (asks y/N), writes deployments/bsc.json
node scripts/launch-mainnet.mjs deploy --signer 0x<guard signer address>

# 3. Commit the two guards (no transaction): Haiku 5.5 decide v2 and Opus 5.5 decide v3
node scripts/launch-mainnet.mjs commit-rounds

# 4. The guard server. Fill in a guard env file as in section B (gitignored name guard/.env.server;
#    TURNCOAT_ADDRESS and LOGS_FROM_BLOCK come from deployments/bsc.json), copy it and the commit records over,
#    then one command on the server (idempotent: re-run it after changing the env file)
scp guard/.env.server you@server:~/guard.env && scp -r guard/.secrets/commits you@server:~/turncoat-commits
ssh you@server 'curl -fsSLO https://raw.githubusercontent.com/amityadav0/turncoat/3c4452dcf4dc3cd0e177a3239aa94d580d4d65aa/deploy/server-setup.sh && bash server-setup.sh --domain guard.example.com --env ~/guard.env --commits ~/turncoat-commits'
#    ends with "PASS" after checking https://guard.example.com/health
#    (the script is fetched at a fixed commit, not from main, so what runs is the version that was rehearsed)

# 5. Open both rounds (asks y/N; 4 transactions: two exact approvals, two openRound)
node scripts/launch-mainnet.mjs open-rounds --seed <USDT per round> --hours 72
#    then, on the server, the two "record" lines it prints (so the site links the open transactions)

# 6. Fill in the deployment values: writes skill/deployment.json, prints the site's VITE_* values
node scripts/launch-mainnet.mjs fill-values --api https://guard.example.com --site https://<your site>
git add skill/deployment.json && git commit -m "Point the skill at the live service" && git push

# 7. The site: set the printed VITE_* values in Netlify (base directory web) and deploy; then put the site's
#    origin in CORS_ORIGINS in the server's env file and re-run the step 4 server command
curl -fsS https://guard.example.com/rounds/live
```

Step 3 runs before the server is set up because the server must hold the commit records before the first attempt arrives (otherwise attempts wait as "no local instructions"). `open-rounds` finds the two newest matching records in `guard/.secrets/commits`; pass `--lighter 0x… --top 0x…` to choose. Seeds can differ per round with `--seed-lighter` and `--seed-top`. `preflight` can be run again at any point: after the deploy it also reads the contract back (owner, signer, token, registry, round count) and lists the commit records it finds.

**Rehearsed** on a local node started with chain id 56 (ganache), with a mock Agent ID registry and mock USDT injected by the script's test-only `--test-local-mocks` flag, which refuses any RPC that is not localhost and refuses to write the real `deployments/bsc.json`, `skill/deployment.json` or commit folder:

```bash
node scripts/launch-mainnet-rehearsal.mjs
```

It runs every subcommand as typed, answering the prompts through stdin, and checks the results: preflight names the problems (signer equal to deployer, an address without an Agent ID, too little USDT for the seeds) and passes when they are fixed; `n` and an empty answer send nothing (nonce unchanged); deploy reads back owner, signer, token and registry and refuses a second deploy; commit-rounds writes the two headered records without calling a model; open-rounds opens both rounds with the right guardCommits, pots and `roundSigner`; fill-values keeps the shape of `skill/deployment.json`; no key appears in any output. 15/15 checks pass. The steps not rehearsed here are the real chain-56 transactions (on a real RPC the y must be typed on a terminal; piped input was refused in the rehearsal on the real code path), the server (see [`docs/TESTNET.md`](TESTNET.md) step 5 for its rehearsal) and Netlify.

Earlier rehearsals of everything else: `npm run e2e:local` runs every flow on a local chain (section D), and [`docs/TESTNET.md`](TESTNET.md) runs them on BSC testnet with mock Agent ID and mock USDT. [`docs/TESTPLAN.md`](TESTPLAN.md) lists every flow and its result per network.

---

## 1. What you need before starting

- [ ] **Deployer key** with BNB for gas (about 0.01 BNB covers the deploy, two approvals and two openRound calls). It becomes the contract owner; keep it off the server.
- [ ] **Guard signer key**: fresh, no funds, used for nothing else. Goes on the server only; the launch script needs only its address.
- [ ] **Relayer key**: fresh, about 0.005 BNB for gas, so winners are paid automatically. Goes on the server only.
- [ ] **Anthropic API key** with access to `claude-haiku-5-5` and `claude-opus-5-5`. Server only.
- [ ] **USDT (BSC-USD) for two seeds**, one per round, held by the deployer address (`preflight --seed` checks it).
- [ ] **A server** (x86-64 Linux, Debian or Ubuntu) reachable over SSH with sudo, ports 80 and 443 open, and a domain whose DNS A record points at it. `deploy/server-setup.sh` installs Docker, Compose and Caddy itself.
- [ ] **A Netlify account** for the site (base directory `web`).
| Item | Used for | Rules |
|---|---|---|
| **Deployer key** (becomes the contract **owner**) | Deploys the contract; opens rounds; pays the seed; can set the guard signer for rounds opened later, pause new rounds and withdraw the 15% running-cost share | Needs BNB for gas and the USDT for the seed. Keep it off the server. Never use it as the guard signer or the relayer. |
| **Guard signer key** | Lives on the guard server; signs verdicts. Anyone holding it can sign a verdict that pays the pot of every round opened with it. | A fresh key used for nothing else. Holds no funds. Never reuse it elsewhere. A round's signer cannot be changed once the round is open, so keep pots at an amount you can afford to lose. If it leaks, see section G. |
| **Relayer key** (optional) | Lives on the guard server; submits `settle()` so a winner is paid without doing it themselves | A fresh key with a small BNB balance for gas only. Not the owner, not the signer. |
| **Model API key** | The guard model (`MODEL_PROVIDER`, default Anthropic) | Server env only. The service redacts it from logs and responses. |
| **USDT for the seed** | Round 1's pot (BSC-USD, 18 decimals) | Held by the deployer/owner address. |
| **A server for the guard service** | Runs `guard/` 24/7 during rounds | Node 20+, a persistent disk (SQLite database and commit records), and HTTPS in front: the site's Content-Security-Policy only allows `https:` API calls. |
| **BscScan API key** | Only for API-based verification | Optional. The repo's verification path is BscScan's web form, which needs no key. |

The contract stops the owner and the guard signer from making attempts, so a mix-up between those keys fails safely. A round keeps the signer it opened with (`roundSigner(roundId)` on the contract), so the owner key cannot take over a live round's payout by changing the signer.


---

# Reference: what each step does

## A. Deploy and verify the contract (step 2)

```bash
npm install
npm run build
DEPLOYER_PRIVATE_KEY=0x… GUARD_SIGNER_ADDRESS=0x<guard signer address> RPC_URL=https://bsc-dataseed.bnbchain.org npm run deploy
```

**Not run locally against mainnet** (needs mainnet). The same command was run against a local node started with chain id 56: it deployed, wrote `deployments/bsc.json` (`chainId`, `turncoat`, `agentId`, `usdt`, `guardSigner`, `deployBlock`, `tx`) and printed the ABI-encoded constructor arguments. `RPC_URL` defaults to the public BSC RPC if omitted. Keep `deployments/bsc.json`: the round scripts read the contract address from it, and `deployBlock` goes into the guard's `LOGS_FROM_BLOCK`.

Verify the source:

```bash
node scripts/verify-input.mjs > turncoat-standard-input.json
```

**Ran locally** (offline; 15 source files, optimizer 200 runs, viaIR). Then on BscScan: open the contract → Verify and Publish → Solidity (Standard-Json-Input) → compiler v0.8.28 → MIT → upload the file → paste the constructor arguments that `npm run deploy` printed. **Not run** (needs the mainnet contract).

---

## B. Configure and start the guard service (step 4)

On the server:

```bash
git clone <repo> turncoat && cd turncoat
npm install && npm run build
cd guard && npm install && npm test
cp .env.example .env && chmod 600 .env
```

**Ran locally** (everything except the clone). Fill in `guard/.env`:

| Variable | Put in it |
|---|---|
| `MODEL_PROVIDER` | `anthropic` (or `openai`) |
| `MODEL_NAME` | `claude-haiku-5-5`: the model practice mode runs on and the default for `npm run commit`. Each round's own model is fixed in its commit record (section C). |
| `MODEL_API_KEY` | Your model API key |
| `MODEL_BASE_URL` | Leave empty unless you use an OpenAI-compatible host |
| `MODEL_MAX_TOKENS`, `MODEL_EFFORT`, `MODEL_TIMEOUT_MS` | Leave unset for defaults: 4096 output tokens per model call, the model's default effort, 60 s per call (see the cost note below) |
| `RPC_URL` | A BSC RPC the server can reach (a paid RPC is more reliable than the public one) |
| `CHAIN_ID` | `56` |
| `TURNCOAT_ADDRESS` | `turncoat` from `deployments/bsc.json` |
| `GUARD_SIGNER_PRIVATE_KEY` | The guard signer key. Each round keeps the signer it opened with (`roundSigner`); the service serves only rounds opened under this key, logs each one it will not serve, and refuses to start only if there are unfinished rounds and none is its own. |
| `RELAYER_PRIVATE_KEY` | The relayer key, or empty to only return signed verdicts |
| `TOKEN_DECIMALS` | `18` |
| `USE_LOGS` | `0` on the public RPC. **The public BSC endpoints refuse `eth_getLogs`** (`-32005 limit exceeded`, even for one block), so the service does not need logs: it works from calls and receipts, and you record the open, roll-over and reveal transactions with `npm run record` (sections C and F). Set `1` only with an RPC plan that serves `eth_getLogs` for this contract; then it also scans every event in chunks of `LOG_CHUNK_BLOCKS` (5000) from `LOGS_FROM_BLOCK` and fills in anything not recorded |
| `LOGS_FROM_BLOCK` | `deployBlock` from `deployments/bsc.json` (where the log scanner starts; `USE_LOGS=1` only) |
| `GUARD_VERSION` | `v2` (sets what `npm run commit` commits and what practice mode runs) |
| `GUARD_MODE` | `decide` (same: commit default and practice mode) |
| `PORT`, `HOST` | `8787`, `127.0.0.1` (the HTTPS proxy forwards to it) |
| `CORS_ORIGINS` | The site's origin, e.g. `https://turncoat.example` |
| `TRUST_PROXY` | **`1`** for the setup in this runbook (one HTTPS proxy in front). Required: unset, every visitor appears as the proxy's address and shares one rate-limit bucket, so one busy visitor locks everyone out (the service logs a warning when it sees forwarded requests without it). Leave unset only if the service is reached directly. |
| `DB_PATH` | `data/guard.sqlite` (on the persistent disk) |
| `COMMITS_DIR` | `.secrets/commits` (on the persistent disk; back it up, you need it for every reveal) |
| `MESSAGE_WINDOW_SECONDS` | `180`: an attempt's message must arrive within 3 minutes of its on-chain time. Short on purpose: attempts are judged strictly in order, so one message that never arrives holds back every later attempt in its round for this long |
| `ATTEMPT_WAIT_MS`, `QUEUE_POLL_MS`, `MODEL_RETRY_BASE_MS`, `MAX_TOOL_TURNS` | Leave the defaults |
| `MODEL_MAX_FAILURES` | `8`: model failures in a row (about 10 minutes of retries) before an attempt is marked `failed`, not judged, and the queue moves on |
| `HEALTH_MAX_QUEUE_AGE_SECONDS` | `300`: `/health` returns 503 once the oldest queued attempt has waited this long. Point an uptime monitor at `/health` |
| `PRACTICE_RATE_LIMIT`, `PRACTICE_RATE_WINDOW_SECONDS`, `PRACTICE_DAILY_CAP` | `10`, `3600`, `2000`: caps model spend on free practice |
| `READ_RATE_LIMIT`, `READ_RATE_WINDOW_SECONDS` | `300`, `60`: GET requests per visitor per minute (all GETs except `/health`). IPv6 visitors are counted per /64 |
| `ATTEMPT_RATE_LIMIT`, `ATTEMPT_RATE_WINDOW_SECONDS` | `20`, `600`: `POST /attempts` per visitor per 10 minutes (each Agent ID has one free attempt a day; this only stops floods) |
| `READ_CACHE_MS` | `3000`: round and attacker views are cached this long, so a busy site does not turn every page view into chain reads |

**Cost ceiling.** Two settings bound model spend; both cost money to raise.

- `MODEL_MAX_TOKENS` (default 4096) caps output per model call, and one reply makes at most `MAX_TOOL_TURNS` (6) calls, so the worst case is about 24,600 output tokens per attempt: ≈ $0.49 on Claude Opus 5.5 ($20 per million output tokens), ≈ $0.012 on Claude Haiku 5.5. Measured replies use far less (151 to 534 output tokens on average), so raising the cap raises the worst case, not the typical bill: each extra 1,000 tokens adds up to ≈ $0.12 per attempt on Opus.
- `PRACTICE_DAILY_CAP` (default 2000) caps free practice replies per day across all visitors. One practice reply costs about one attempt: measured on Haiku 5.5 ≈ $0.0002 to $0.0006, the same token counts on Opus 5.5 ≈ $0.008 to $0.025. So 2,000 a day ≈ $0.40 to $1.20 on Haiku, ≈ $16 to $50 on Opus; each extra 1,000 a day adds ≈ $8 to $25 on Opus. (Opus figures reuse the token counts measured on Haiku. Measured since on Opus 5.5, decide v3, 50 attempts: 1,620 input and 243 output tokens per attempt on average, within that range for output.)

Prices are list prices at the time of writing; check your provider's current pricing.

### Run with Docker (recommended)

Needs Docker with Compose v2.17+ (for `additional_contexts`). On the server, from the repo root:

```bash
cd guard
cp .env.example .env && chmod 600 .env     # fill in as in the table above
npm install && GUARD_VERSION=v2 GUARD_MODE=decide npm run commit -- --model anthropic/claude-haiku-5-5    # commit records go to guard/.secrets/commits on the host
docker compose up -d --build
docker compose ps                           # STATUS shows "healthy" after about 20 s
curl -fsS http://127.0.0.1:8787/health
docker compose logs -f guard
```

What the compose file does: builds the image (Node 22, non-root `node` user, production dependencies only; the contract ABI is compiled from `../contracts` in a builder stage), reads every setting and secret from `guard/.env` at run time (nothing secret is in the image; `.env` is excluded from the build), keeps the SQLite database in the named volume `guard-data`, mounts `guard/.secrets/commits` read-only (commit on the host; the running service picks up a new record within 5 seconds), restarts `unless-stopped`, health-checks `/health` every 30 s, and publishes port 8787 on 127.0.0.1 only, for the HTTPS proxy. Inside Docker, `HOST`, `PORT`, `DB_PATH` and `COMMITS_DIR` are set by the compose file. If the chain node runs on the same machine, use `RPC_URL=http://host.docker.internal:8545` (Docker Desktop) or the host's address.

`docker compose up --build` builds for the server's own architecture. The image was also built for x86-64 on an ARM Mac with `docker buildx build --platform linux/amd64 --build-context repo=.. -t turncoat-guard .` (run from `guard/`; **ran locally**, and the native SQLite module loads in it), so building on an x86-64 server works the same way.

Update: `git pull && docker compose up -d --build` (the database volume is kept). Back up the volume and `.secrets/commits` together.

### Run without Docker

Start it under a process manager. With pm2:

```bash
npm install -g pm2
cd guard && pm2 start npm --name turncoat-guard -- start && pm2 save && pm2 startup
```

Or with systemd, `/etc/systemd/system/turncoat-guard.service`:

```ini
[Unit]
Description=Turncoat guard service
After=network-online.target

[Service]
WorkingDirectory=/srv/turncoat/guard
ExecStart=/usr/bin/npm start
Restart=always
User=turncoat

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now turncoat-guard && journalctl -u turncoat-guard -f
```

**Not run locally** (neither pm2 nor systemd is installed on the rehearsal machine). `npm start` itself was run locally: it logs `guard service listening` with the contract, signer, relayer, the commit records it holds and the practice version. A wrong signer key stops it with an error naming both addresses.

Put HTTPS in front (for example Caddy: `guard.example.com { reverse_proxy 127.0.0.1:8787 }`). **Not run locally.** Health check:

```bash
curl -fsS https://guard.example.com/health
```

**Ran locally** (over http on localhost): returns `{"ok":true,"model":"…"}`.

---

## C. Commit the guard and open the two launch rounds (steps 3 and 5)

On the guard server (the service must hold the commit records, or attempts wait as "no local instructions"):

```bash
cd guard
GUARD_VERSION=v2 GUARD_MODE=decide npm run commit -- --model anthropic/claude-haiku-5-5   # lighter rung
GUARD_VERSION=v3 GUARD_MODE=decide npm run commit -- --model anthropic/claude-opus-5-5    # top rung
```

The top rung runs v3, which names the known tricks (zero or test amounts, split authorisation, deposits and refunds, rule-change claims), so a break found on the lighter v2 round cannot simply be replayed on the top round. Measured before launch: Opus 5.5 on decide v3 held all 50 tracked attacks (0 breaks, 0 replies without a decision, about 3.9 s per attempt).

Each command prints a `guardCommit: 0x…` and the header it committed (model, mode, version, tools hash, max turns, follow-up line); note which is which. One record per round. The hash covers that header, so the round's guard version, mode, **model**, tools and turn limit are fixed on-chain before the round opens, and anyone can check them after the reveal. The running service uses that model for that round whatever `MODEL_NAME` says later. Both rounds run at once and `GET /rounds/live` lists them.

**Ran locally**, including with real models: both rounds opened on a local chain, each attempt was answered by its own round's model (Haiku in about 2 s, Opus in about 4 s), and nothing crossed between rounds. The records are in `.secrets/commits/<guardCommit>.json`; a running service picks up a new one within 5 seconds. The salt in each record stays private until the round is over; back the records up: without one its round cannot be revealed.

Open both rounds from the machine that holds the owner key, with these suggested values for the first round on each rung:

```bash
export OWNER_PRIVATE_KEY=0x… RPC_URL=https://bsc-dataseed.bnbchain.org
node scripts/open-round.mjs --commit 0x<lighter guardCommit> --level 1 --hours 72 --paid off --base-fee 0 --seed ____ --confirm-mainnet
node scripts/open-round.mjs --commit 0x<top guardCommit>     --level 1 --hours 72 --paid off --base-fee 0 --seed ____ --confirm-mainnet
```

| Choice | Suggested | What it means |
|---|---|---|
| `--level` | `1` | Level 1, payment requests. |
| `--hours` | `72` | The round takes attempts for 3 days; then there is a 1-day window to settle a break, after which an unbroken pot can be rolled over. Allowed: 1 hour to 30 days. |
| `--paid` | `off` | Only the free daily attempt per Agent ID; the README says paid attempts stay off until the organisers confirm. Fixed once the round opens. |
| `--base-fee` | `0` | No fee, because paid attempts are off. |
| `--seed` | ____ (your choice) | USDT pulled from the owner into this round's pot, with an approval for exactly that amount. A pot nobody wins rolls into the reserve and can seed the next round. |
| `--commit` | from above | The guard this round runs (version, mode, model). Fixed once the round opens. |
| `--seed-from-reserve` | omit | USDT moved from the contract's reserve into the pot; there is no reserve before the first round. |

Each command prints `openRound: tx 0x…`. Record both on the guard server so the site can link them (the service cannot find them by itself on the public RPC):

```bash
cd guard && npm run record -- --round <lighter roundId> --open-tx 0x<openRound tx>
cd guard && npm run record -- --round <top roundId>     --open-tx 0x<openRound tx>
# in Docker: docker compose exec guard npm run record -- --round <id> --open-tx 0x…
```

It checks each hash against its receipt (a successful call to the contract carrying `RoundOpened` for that round) and stores it. Skipping it only means the site shows no open-transaction link.

**Ran locally** (without `--confirm-mainnet`). It checks the sender is the owner, rounds are not paused, the duration is allowed and the owner holds the seed. It approves exactly the seed, calls `openRound`, and prints the round id, end time and pot. On chain 56 it sends nothing unless `--confirm-mainnet` is passed. The contract address comes from `TURNCOAT_ADDRESS` or `deployments/bsc.json`.

Check them:

```bash
node scripts/round-tools.mjs status 1 && node scripts/round-tools.mjs status 2
curl -fsS https://guard.example.com/rounds/live
```

**Ran locally.** Both rounds show as live with their pots; `/rounds/live` shows each with `mode: "decide"`, its own `model`, and `guardVersion` `"v2"` (Haiku) or `"v3"` (Opus).

---

## D. Rehearse locally (optional, about 5 minutes)

```bash
npm install && npm run build
cd guard && npm install && npm test && npm run demo
```

**Ran locally.** 76 guard tests pass. `npm run demo` shows the launch shape: it starts a chain, deploys with mock Agent ID and mock USDT, opens two decide-mode rounds (lighter v2, top v3) whose records name two scripted stand-in models, runs held attempts on both, one misfire break on the lighter round that the relayer settles, and one reply that needs the service's follow-up on the top round, and prints the pot moving. No AI is called.

To rehearse the steps below against a local chain instead of mainnet, start one and deploy mocks:

```bash
guard/node_modules/.bin/ganache --chain.chainId 1337 --server.port 8545 --wallet.deterministic
RPC_URL=http://127.0.0.1:8545 DEPLOYER_PRIVATE_KEY=0x… GUARD_SIGNER_ADDRESS=0x… node scripts/deploy-local.mjs --mint 1000 --agent-id 0xYourTestAttacker
```

**Ran locally** (with ganache's first deterministic key as the deployer). `deploy-local.mjs` refuses chains 56 and 97. It prints the addresses; use its `turncoat` address as `TURNCOAT_ADDRESS` and `RPC_URL=http://127.0.0.1:8545` in the steps below.


---

## E. Point the site at the service and deploy it (steps 6 and 7)

Netlify: new site from the repo, **base directory `web`**, build command `npm run build`, publish directory `dist` (also set in `web/netlify.toml`). Set these environment variables in Netlify:

| Variable | Value |
|---|---|
| `VITE_API_BASE_URL` | `https://guard.example.com` (must be https) |
| `VITE_CONTRACT_ADDRESS` | The Turncoat address |
| `VITE_EXPLORER_URL` | `https://bscscan.com` |
| `VITE_RPC_URL` | A BSC RPC URL, so the Fairness page reads `guardCommit` from the chain itself |
| `VITE_TOKEN_DECIMALS` | `18` |
| `VITE_SKILL_URL`, `VITE_AGENT_ID_URL` | Fill in when available |
| `VITE_MOCK` | Leave empty |

Then set the guard's `CORS_ORIGINS` to the site's URL and restart the service.

```bash
cd web && npm install && npm run build
```

**Ran locally** with production-style variables (output sent to a scratch folder so the web session's `dist/` was untouched): built successfully. **Not run:** the Netlify deploy itself (needs your Netlify account).

---

# During and after the rounds

## F. After a round

**If the guard was broken:** with a relayer the pot is paid automatically; check with `round-tools.mjs status <id>` (`closed: broken`). Without a relayer, or if relaying failed, anyone can settle before `settleDeadline` (end time + 1 day). Take the signature from `GET /attempts/<roundId>/<attemptId>` (`verdict.signature`; `verdict.settle` also has ready-made calldata):

```bash
SENDER_PRIVATE_KEY=0x… RPC_URL=… node scripts/round-tools.mjs settle <roundId> <attemptId> 0x<signature> --confirm-mainnet
```

**If nobody broke it:** once the settle window has passed, anyone can move the pot into the reserve:

```bash
SENDER_PRIVATE_KEY=0x… RPC_URL=… node scripts/round-tools.mjs rollover <roundId> --confirm-mainnet
```

**In both cases**, reveal the instructions so anyone can check them against the commit:

```bash
SENDER_PRIVATE_KEY=0x… RPC_URL=… node scripts/round-tools.mjs reveal <roundId> guard/.secrets/commits/0x<guardCommit>.json --confirm-mainnet
```

Record what you sent (each command prints `…: tx 0x…`). The relayer's own settle is recorded automatically. Record a settle sent by anyone else, a roll-over and the reveal:

```bash
cd guard && npm run record -- --round <roundId> --settle-tx 0x<settle or rollOver tx> --reveal-tx 0x<revealGuard tx>
```

Until the reveal is recorded, the API serves the salt and committed bytes from the service's own record (`reveal.source: "service"`); after it, the on-chain one (`"chain"`, with its tx).

**Ran locally** (without `--confirm-mainnet`): settle paid the pot to the attacker; rollover refused before the window ended and moved the pot to the reserve after it; reveal was accepted for the matching record and refused for a live round or a record from another round. `SENDER_PRIVATE_KEY` can be any funded key; none of these needs the owner.

**Then the next round:** after a break, publish the post-mortem (`docs/postmortems/`), write the next version: a new file under `guard/levels/level1-decide/` that is the running version plus one rule answering the break, with its name added to `VERSIONS` in `guard/src/levels.ts` (today's `v3.md` is a hardened reference, not the planned next guard), add its row to `guard/levels/level1-decide/CHANGELOG.md` naming the round and attempt, and commit it to git. Keep the winning attack out of git until the version it beats is retired (`guard/redteam/private/`). If the round held, the next round can keep the same version. Commit a fresh record either way, because a new salt means a new commit. Then open the round on the same rung, seeding from the reserve if you like:

```bash
cd guard && GUARD_VERSION=<next version> GUARD_MODE=decide npm run commit -- --model anthropic/claude-haiku-5-5
OWNER_PRIVATE_KEY=0x… RPC_URL=… node scripts/open-round.mjs --commit 0x<new guardCommit> --hours 72 --seed 0 --seed-from-reserve 50 --confirm-mainnet
```

**Ran locally** (v2 and v3 commits; a round seeded only from the reserve).

---

## G. If something goes wrong

- **Guard service down mid-round.** Attempts keep landing on-chain. Restart the service: queued attempts resume in order from SQLite, and nothing is processed twice. An attempt whose message could not be delivered within `MESSAGE_WINDOW_SECONDS` of its on-chain time is marked expired. If an outage was long, you can raise `MESSAGE_WINDOW_SECONDS` before restarting so those attackers can resubmit; say so publicly, since it changes the rule for everyone.
- **A verdict was not relayed** (`relayer.status` is `failed` or `unknown` in `GET /attempts/<r>/<a>`, usually a relayer with no BNB). The signature is still valid until `settleDeadline`. Submit it with `round-tools.mjs settle …` (section F), or give the attacker the `verdict.settle` calldata; anyone can send it.
- **An attempt is stuck as `queued`.** Look at the service log. "no local instructions match round guardCommit" means the commit record is not in `COMMITS_DIR` on this server: copy `0x<guardCommit>.json` there (it is picked up within seconds). "committed tool definitions … differ" or "committed follow-up line differs" means this server runs a different build of the guard from the one that made the commit: deploy the build the round was committed with. A model error means the model key, quota or provider is the problem; the attempt is retried with backoff and later attempts wait behind it, in order. After `MODEL_MAX_FAILURES` (8) failures in a row it is marked `failed` with a public note and the queue moves on; that attacker's attempt was not judged, so say so publicly. `/health` returns 503 while anything has been queued for more than 5 minutes.
- **An attempt publishes doxxing, a scam link or other harmful text.** Attempts are public as soon as Argus answers, and up to 2,000 characters come from strangers. On the guard server, hide that one attempt:

  ```bash
  cd guard && npm run hide -- --round <roundId> --attempt <attemptId> --reason "phone number"
  # in Docker: docker compose exec guard npm run hide -- --round <roundId> --attempt <attemptId> --reason "…"
  npm run hide -- --list                                   # what is hidden, with your reasons
  npm run hide -- --round <roundId> --attempt <attemptId> --unhide
  ```

  Within a few seconds the API serves that attempt with `hidden: true`. Its message, reply, tool calls and conversation are omitted. Its outcome, decision, on-chain `messageHash`, transaction and any verdict stay, so the round's record is still complete and checkable. Your reason is kept for you and never served. There is no web route for this on purpose: only someone with shell access to the server can do it. The text is still in the database and the hash is on-chain. Hiding removes it from the site, not from the world, so say publicly that an attempt was hidden and why.
- **The guard signer key leaked.** Rounds that are already open keep the leaked key as their signer and cannot be changed: anyone holding it, with any Agent ID wallet, can take those pots until the rounds are paid or roll over. This is the price of the owner not being able to change a live round. What you can do: from the owner key, call `setGuardSigner(<new address>)` (BscScan "Write Contract" works) so no new round uses the leaked key, put the new key in the server's `.env`, and open new rounds only after that. Say publicly what happened. **Signer change tested on a local chain (`test/signer.test.mjs`); the server steps are not run.**

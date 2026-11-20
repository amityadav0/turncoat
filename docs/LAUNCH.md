# Launch runbook

One page, top to bottom: deploy the contract, run the guard service, open round 1, point the site at it, and run a round to the end.

Each command is marked **Ran locally** (rehearsed by the guard session against a local chain, with the results described) or **Not run locally**, with the reason. Commands are run from the repo root unless a `cd` is shown.

> There is no testnet path in the repo: `scripts/deploy.mjs` deploys to BSC mainnet with the real Agent ID and USDT addresses. Rehearse on a local chain first (section 0).

---

## 0. Rehearse locally first (optional, about 5 minutes)

```bash
npm install && npm run build
cd guard && npm install && npm test && npm run demo
```

**Ran locally.** 32 guard tests pass. `npm run demo` starts a chain, deploys with mock Agent ID and mock USDT, opens a round, runs one attempt that holds and one that breaks, settles, and prints the pot moving from the contract to the attacker. The demo uses a scripted stand-in for the model, so no AI is called.

To rehearse the steps below against a local chain instead of mainnet, start one and deploy mocks:

```bash
guard/node_modules/.bin/ganache --chain.chainId 1337 --server.port 8545 --wallet.deterministic
RPC_URL=http://127.0.0.1:8545 DEPLOYER_PRIVATE_KEY=0x… GUARD_SIGNER_ADDRESS=0x… node scripts/deploy-local.mjs --mint 1000 --agent-id 0xYourTestAttacker
```

**Ran locally** (with ganache's first deterministic key as the deployer). `deploy-local.mjs` refuses chains 56 and 97. It prints the addresses; use its `turncoat` address as `TURNCOAT_ADDRESS` and `RPC_URL=http://127.0.0.1:8545` in the steps below.

---

## 1. What you need before starting

| Item | Used for | Rules |
|---|---|---|
| **Deployer key** (becomes the contract **owner**) | Deploys the contract; opens rounds; pays the seed; can rotate the guard signer, pause new rounds and withdraw the 15% running-cost share | Needs BNB for gas and the USDT for the seed. Keep it off the server. Never use it as the guard signer or the relayer. |
| **Guard signer key** | Lives on the guard server; signs verdicts. Anyone holding it can sign a verdict that pays a pot. | A fresh key used for nothing else. Holds no funds. Never reuse it elsewhere. If it leaks, rotate it at once (section 7). |
| **Relayer key** (optional) | Lives on the guard server; submits `settle()` so a winner is paid without doing it themselves | A fresh key with a small BNB balance for gas only. Not the owner, not the signer. |
| **Model API key** | The guard model (`MODEL_PROVIDER`, default Anthropic) | Server env only. The service redacts it from logs and responses. |
| **USDT for the seed** | Round 1's pot (BSC-USD, 18 decimals) | Held by the deployer/owner address. |
| **A server for the guard service** | Runs `guard/` 24/7 during rounds | Node 20+, a persistent disk (SQLite database and commit records), and HTTPS in front: the site's Content-Security-Policy only allows `https:` API calls. |
| **BscScan API key** | Only for API-based verification | Optional. The repo's verification path is BscScan's web form, which needs no key. |

The contract stops the owner and the guard signer from making attempts, so a mix-up between those keys fails safely. Separate keys also keep the "owner cannot pay a pot without a valid break" promise in the README meaningful.

---

## 2. Deploy and verify the contract

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

## 3. Configure and start the guard service

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
| `MODEL_NAME` | `claude-opus-5-5`, or the model you picked; required for `openai` |
| `MODEL_API_KEY` | Your model API key |
| `MODEL_BASE_URL` | Leave empty unless you use an OpenAI-compatible host |
| `MODEL_MAX_TOKENS`, `MODEL_EFFORT`, `MODEL_TIMEOUT_MS` | Leave unset for defaults: 4096 output tokens per model call, the model's default effort, 60 s per call (see the cost note below) |
| `RPC_URL` | A BSC RPC the server can reach (a paid RPC is more reliable than the public one) |
| `CHAIN_ID` | `56` |
| `TURNCOAT_ADDRESS` | `turncoat` from `deployments/bsc.json` |
| `GUARD_SIGNER_PRIVATE_KEY` | The guard signer key. The service refuses to start if it is not the contract's `guardSigner`. |
| `RELAYER_PRIVATE_KEY` | The relayer key, or empty to only return signed verdicts |
| `TOKEN_DECIMALS` | `18` |
| `LOGS_FROM_BLOCK` | `deployBlock` from `deployments/bsc.json` (used to find reveals) |
| `GUARD_VERSION` | `v1` for round 1 (sets what `npm run commit` commits and what practice mode runs) |
| `PORT`, `HOST` | `8787`, `127.0.0.1` (the HTTPS proxy forwards to it) |
| `CORS_ORIGINS` | The site's origin, e.g. `https://turncoat.example` |
| `TRUST_PROXY` | `1` when behind one reverse proxy, so practice rate limits see the visitor's IP |
| `DB_PATH` | `data/guard.sqlite` (on the persistent disk) |
| `COMMITS_DIR` | `.secrets/commits` (on the persistent disk; back it up, you need it for every reveal) |
| `MESSAGE_WINDOW_SECONDS` | `900`: an attempt's message must arrive within 15 minutes of its on-chain time |
| `ATTEMPT_WAIT_MS`, `QUEUE_POLL_MS`, `MODEL_RETRY_BASE_MS`, `MAX_TOOL_TURNS` | Leave the defaults |
| `PRACTICE_RATE_LIMIT`, `PRACTICE_RATE_WINDOW_SECONDS`, `PRACTICE_DAILY_CAP` | `10`, `3600`, `2000`: caps model spend on free practice |

**Cost ceiling.** Two settings bound model spend; both cost money to raise.

- `MODEL_MAX_TOKENS` (default 4096) caps output per model call, and one reply makes at most `MAX_TOOL_TURNS` (6) calls, so the worst case is about 24,600 output tokens per attempt: ≈ $0.49 on Claude Opus 5.5 ($20 per million output tokens), ≈ $0.012 on Claude Haiku 5.5. Measured replies use far less (151 to 534 output tokens on average), so raising the cap raises the worst case, not the typical bill: each extra 1,000 tokens adds up to ≈ $0.12 per attempt on Opus.
- `PRACTICE_DAILY_CAP` (default 2000) caps free practice replies per day across all visitors. One practice reply costs about one attempt: measured on Haiku 5.5 ≈ $0.0002 to $0.0006, the same token counts on Opus 5.5 ≈ $0.008 to $0.025. So 2,000 a day ≈ $0.40 to $1.20 on Haiku, ≈ $16 to $50 on Opus; each extra 1,000 a day adds ≈ $8 to $25 on Opus. (Opus figures reuse the token counts measured on Haiku, since the Opus run predates token logging; Opus thinks before answering and will likely use more.)

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

## 4. Commit a guard version and open round 1

On the guard server (the service must hold the commit record, or attempts wait as "no local instructions"):

```bash
cd guard && GUARD_VERSION=v2 GUARD_MODE=decide npm run commit -- --model anthropic/claude-haiku-5-5   # lighter rung
cd guard && GUARD_VERSION=v2 GUARD_MODE=decide npm run commit -- --model anthropic/claude-opus-5-5    # top rung
```

One commit per round. The record fixes the round's version, mode **and model** before the round opens; the running service uses that model for that round whatever `MODEL_NAME` says later. For the ladder, open one round per record (below); both run at once and `GET /rounds/live` lists them. The service needs a key for every provider named in a live round's record.

**Ran locally.** It prints `guardCommit: 0x…` and stores the salt, the exact instruction bytes and the version in `.secrets/commits/<guardCommit>.json`. A running service picks up a new record within 5 seconds, with no restart (checked locally). Keep that file private until the round is over. Back it up: without it the round cannot be revealed.

Open the round from the machine that holds the owner key:

```bash
OWNER_PRIVATE_KEY=0x… RPC_URL=https://bsc-dataseed.bnbchain.org \
  node scripts/open-round.mjs --commit 0x<guardCommit> --level 1 --hours 72 --seed 100 --confirm-mainnet
```

**Ran locally** (without `--confirm-mainnet`). It checks the sender is the owner, rounds are not paused, the duration is allowed and the owner holds the seed. It approves the contract for exactly the seed, calls `openRound`, and prints the round id, end time and pot. On chain 56 it sends nothing unless `--confirm-mainnet` is passed. The contract address comes from `TURNCOAT_ADDRESS` or `deployments/bsc.json`.

What each `openRound` argument is:

| Argument | Flag | Round 1 value |
|---|---|---|
| `level` | `--level` | `1` (direct persuasion) |
| `duration` | `--hours` | Seconds the round accepts attempts; 1 hour to 30 days. Example: 72 hours. |
| `baseFee` | `--base-fee` | Fee of the first paid attempt, in USDT. `0` while paid attempts are off. |
| `paidEnabled` | `--paid on/off` | `off`. The README says round 1 launches free-only until the organizers confirm. Fixed once the round opens. |
| `guardCommit` | `--commit` | The hash printed by `npm run commit`. Fixed once the round opens. |
| `seedFromOwner` | `--seed` | USDT pulled from the owner into the pot (exact approval) |
| `seedFromReserve` | `--seed-from-reserve` | USDT moved from the contract's reserve (fees and rolled-over pots) into the pot |

Check it:

```bash
RPC_URL=… node scripts/round-tools.mjs status 1
curl -fsS https://guard.example.com/rounds/current
```

**Ran locally.** Both show the round live with its pot. The API also shows `guardVersion: "v1"`.

---

## 5. Point the site at the service and deploy it

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

## 6. After a round

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

**Ran locally** (without `--confirm-mainnet`): settle paid the pot to the attacker; rollover refused before the window ended and moved the pot to the reserve after it; reveal was accepted for the matching record and refused for a live round or a record from another round. `SENDER_PRIVATE_KEY` can be any funded key; none of these needs the owner.

**Then the next round:** after a break, publish the post-mortem, write the next version (`guard/levels/level1/v4.md` = v3 plus one rule), add its row to `guard/levels/level1/CHANGELOG.md` naming the round and attempt, and commit it. If the round held, the next round can keep the same version. Commit a fresh record either way, because a new salt means a new commit. Then open the round, seeding from the reserve if you like:

```bash
cd guard && GUARD_VERSION=v2 npm run commit
OWNER_PRIVATE_KEY=0x… RPC_URL=… node scripts/open-round.mjs --commit 0x<new guardCommit> --hours 72 --seed 0 --seed-from-reserve 50 --confirm-mainnet
```

**Ran locally** (v2 and v3 commits; a round seeded only from the reserve).

---

## 7. If something goes wrong

- **Guard service down mid-round.** Attempts keep landing on-chain. Restart the service: queued attempts resume in order from SQLite, and nothing is processed twice. An attempt whose message could not be delivered within `MESSAGE_WINDOW_SECONDS` of its on-chain time is marked expired. If an outage was long, you can raise `MESSAGE_WINDOW_SECONDS` before restarting so those attackers can resubmit; say so publicly, since it changes the rule for everyone.
- **A verdict was not relayed** (`relayer.status` is `failed` or `unknown` in `GET /attempts/<r>/<a>`, usually a relayer with no BNB). The signature is still valid until `settleDeadline`. Submit it with `round-tools.mjs settle …` (section 6), or give the attacker the `verdict.settle` calldata; anyone can send it.
- **An attempt is stuck as `queued`.** Look at the service log. "no local instructions match round guardCommit" means the commit record is not in `COMMITS_DIR` on this server: copy `0x<guardCommit>.json` there (it is picked up within seconds). A model error means the model key, quota or provider is the problem; the attempt is retried with backoff and later attempts wait behind it, in order.
- **The guard signer key leaked.** From the owner key, call `setGuardSigner(<new address>)` on the contract (BscScan "Write Contract" works), then put the new key in the server's `.env` and restart. Until that call, anyone with the old key can sign a verdict for the live round. **Not run locally.**

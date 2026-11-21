# Test plan: every flow, local chain → BSC testnet → mainnet

Mainnet waits until every row below passes on the local chain and on BSC testnet (chain id 97).

**What local and testnet cannot show.** Binance's Agentic Wallet supports BSC mainnet (56), Ethereum, Base and Solana only, and the Agent ID registry exists only on BSC mainnet. On the local chain and on testnet:

- the Agent ID registry and USDT are our mocks (`contracts/test/Mocks.sol`: `MockAgentID`, `MockUSDT`);
- attempts are sent by plain test keys through the skill helper, not by `baw`.

Everything else is the real thing: the same contract bytecode, the same guard service over HTTP (in Docker on testnet), the real models for the rows marked so, and the same site build pointed at that service. What only mainnet can prove is listed at the end.

**Result cells** say one of:
- `pass` plus evidence (a test name, tx hash or output line);
- `fail` plus the finding;
- `n/a` plus why the flow is not possible there;
- `not run`.

The local column comes from `npm run e2e:local` (scripted stand-in model, time travel), plus one manual pass with real models for rows 2, 3 and 6. The testnet column is a hand pass through the real interfaces, recorded in `docs/TESTNET.md`.

| # | Flow | Triggered by | What must be true (chain / API / site) | Local | Testnet | Mainnet |
|---|---|---|---|---|---|---|
| 1 | Deploy | `deploy-local.mjs` / `deploy-testnet.mjs` / `deploy.mjs` | Chain: the contract reads back `owner` = deployer, `guardSigner` = signer, `token` = USDT (the mock off mainnet), `agentId` = registry (the mock off mainnet). | not run | not run | not run |
| 2 | Commit and open two rounds | `npm run commit` ×2 (headered: Haiku 5.5 v2, Opus 5.5 v3), `open-round.mjs` ×2, `npm run record --open-tx` | Chain: `roundSigner(id)` = signer for both. API: `/rounds/live` lists both, each with `model`, `guardVersion` (v2 / v3), `mode: decide`, `signer` and `openTx`. Site: two cards, lighter first. | not run | not run | not run |
| 3 | Free attempt, rejected | Skill helper: `attempt()` then `POST /attempts` | Chain: attempt recorded, fee 0. API: `outcome: held`, `decision: reject`, message and reply public at once. `tx` is present when `txHash` was sent and absent when it was not. Site: the transcript shows. | not run | not run | not run |
| 4 | Daily free attempt | Same attacker again on the same UTC day (paid off), then the next UTC day | Chain: the second attempt reverts with `PaidAttemptsOff`; after 00:00 UTC, `freeAttemptAvailable` is true and the attempt succeeds. | not run | not run | not run |
| 5 | Who may attack | Non-holder key; owner key; round-signer key | Chain: reverts with `NotAgentIdHolder`, `OperatorCannotAttack`, `OperatorCannotAttack`. | not run | not run | not run |
| 6 | Break, paid by the relayer | A third short round on decide **v1** with the known misfire attack (real model), or the scripted stand-in locally | API: `outcome: broken`, `breakKind`, a verdict signed by `roundSigner`. Relayer `settle()` succeeds. Chain: the pot goes to the attacker, the round closes with `winner`. API: `status: broken`, `payout`, `settleTx`. Site: "Paid out". | not run | not run | not run |
| 7 | Break, relayer off | Same, with the service running without `RELAYER_PRIVATE_KEY`; a third party sends `verdict.settle.data` from `GET /attempts/:r/:a` | Chain: `settle()` from the third party pays the attacker. API: the round shows `broken` once the settle tx is recorded (`npm run record --settle-tx`). | not run | not run | not run |
| 8 | Message never delivered | `attempt()` on-chain, no `POST /attempts` | API: `status: expired` 180 s after the attempt's block time. The next attempt in that round is still answered. | not run | not run | not run |
| 9 | Wrong message for the hash | `POST /attempts` with different text | API: 400 "does not match the messageHash", nothing stored, not judged. The right text is still accepted afterwards. | not run | not run | not run |
| 10 | Model failing repeatedly | A model that errors (bad key or the scripted failure) | API: after `MODEL_MAX_FAILURES` failures `status: failed` with the public note, and the queue moves on. `/health` is 503 while stuck and 200 after. | not run | not run | not run |
| 11 | Restart mid-queue | Kill the service with attempts queued, then start it again | No attempt lost, none judged twice (one model call each), and a verdict signed before the kill still settles. | not run | not run | not run |
| 12 | Unbroken round rolls over | A short round with no break; `round-tools.mjs rollover` after `endTime + SETTLE_GRACE` | Chain: `rollOver` reverts before the window ends and succeeds after; `reserve` grows by the pot; the next round opens with `--seed-from-reserve`. API: `held`, `settleTx` after record. | not run | not run | not run |
| 13 | Reveal | `round-tools.mjs reveal`, `npm run record --reveal-tx` | Chain: `GuardRevealed`; a wrong salt or another round's record reverts with `CommitMismatch`. API: `reveal.source: chain` with tx; before the record it is `service`. Site: "Match" and the header fields (model, mode, version, tools hash, max turns, follow-up). | not run | not run | not run |
| 14 | Signer change mid-round | `setGuardSigner(new)` while a round is live, then open another round | Chain: the old round keeps its `roundSigner` and is paid on the old key's verdict; the new round has the new key. Service A (old key) serves only the old round; service B (new key) serves only the new round and logs the old one as not served. | not run | not run | not run |
| 15 | Operator hide and unhide | `npm run hide -- --round --attempt --reason`, then `--unhide` | API: `hidden: true`, no message, reply, tool calls or conversation; the hash, outcome and verdict stay. After unhide the text is back. Site: "Hidden by the operator". | not run | not run | not run |
| 16 | Rate limits | Bursts of GETs, `POST /attempts` and `POST /practice` | API: 429 with `Retry-After` and `retryAfterSeconds` on each; `/health` is never limited; addresses in one IPv6 /64 share a bucket. | not run | not run | not run |
| 17 | Paid attempts | A short round with `paidEnabled`, base fee B | Chain: the exact-fee approval is taken; each further paid attempt by one ID in the round costs +10 % of B (capped at 5×B); each fee splits 70 % pot, 15 % reserve, 15 % ops; `withdrawOps` can take at most `opsBalance`; `FeeAboveMax` reverts when `maxFee` is too low. | not run | not run | not run |
| 18 | Owner controls | `setRoundsPaused(true)`; `transferOwnership` + `acceptOwnership` | Chain: `openRound` reverts with `RoundsArePaused` while attempts on a live round still work; ownership moves only on accept, and the old owner loses `onlyOwner`. | not run | not run | not run |
| 19 | Practice mode | `POST /practice` (site and curl) | API: the same guard and break rule, nothing stored, no chain; the practice limit applies. Site: the practice page works. | not run | not run | not run |
| 20 | Late break | A break answered after `endTime + SETTLE_GRACE` (service down until then) | API: `broken` with the note "settle deadline has passed … no verdict signed"; no verdict, so nothing can be settled. | not run | not run | not run |

## What only mainnet can prove (the mainnet smoke test)

G-022 resumes only after the testnet column is all `pass`. Then, with a 10 USDT pot:

1. **`baw` preview and execute** from a real Agentic Wallet, Developer Mode on, against the new contract. This includes Binance's risk check on a newly deployed contract: error 351803 means a call to it was blocked, which stops the launch.
2. **The real Agent ID registry** for a real holder: `balanceOf(holder) = 1`, `handleOf(holder)` = their name, and the `.ai` name shown by the API and site.
3. **Real USDT** (BSC-USD, 18 decimals): seed approval, pot and payout.
4. Rows 1, 2, 3, 6 (with the relayer), 13 and 19 once more on mainnet, as the smoke test.

Rows needing a day or more (4, 12, 20) and the destructive ones (14, 18) are not repeated on mainnet; the testnet result stands for them.

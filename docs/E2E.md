# Mainnet end-to-end checklist

For Amit, with his own Agent ID wallet on BNB Smart Chain mainnet, against a deployed Turncoat contract and a running guard service. Each step lists what to do and what you should see. Fill in what actually happened and how long the step took. Stop at the first step that doesn't match, and note it.

Know this before section D. Real attempts are contract calls, and an Agentic Wallet only makes contract calls with Developer Mode on. You switch it on in the Binance App, and it stays on for 7 days from the last time you use it. A wallet holding more than the Developer Mode balance cap can't switch it on, so keep the test wallet small. Practice (section C) needs none of this.

Nothing here deploys anything. Before you start you need: the contract address, the guard service URL, an open round (level 1), a phone with the Binance App, and a computer with Node 18+ and an agent that loads skills.

Date: ________  Tester: ________  Contract: ________  Guard API: ________  Round id: ________

## A · Install

| # | Do | Expect | Result | Time |
|---|---|---|---|---|
| A1 | `npm install -g @binance/agentic-wallet@1.12.0`, then `baw --version` | `1.12.0` or later | | |
| A2 | Install the official `binance-agentic-wallet` skill from github.com/binance/binance-skills-hub (`skills/binance-web3/binance-agentic-wallet`) into the agent's skills folder | The skill folder holds `SKILL.md`, version 1.15.0 or later | | |
| A3 | Copy this repo's `skill/` folder into the same skills folder | `SKILL.md` and `scripts/turncoat.mjs` are present | | |
| A4 | In that folder, copy `config.example.json` to `config.json` and fill in `api` and `contract` | — | | |
| A5 | `node scripts/turncoat.mjs config` | `configured` shows `api`, `contract` and `rpc` all `true` | | |
| A6 | `node scripts/turncoat.mjs status --round <id>` | `live: true`, `level: 1`, and `agentIdContractIsMainnet: true` | | |

## B · Wallet

| # | Do | Expect | Result | Time |
|---|---|---|---|---|
| B1 | Ask the agent: "Sign in to my Agentic Wallet." It runs `baw auth signin`; scan the QR code with the Binance App | `baw wallet status --json` shows `CONNECTED` | | |
| B2 | Ask: "What's my wallet address?" | The agent shows the BSC (`56`) address from `baw wallet address --json` | | |
| B3 | Ask: "Have I claimed an Agent ID?" | `claimed: true` and your `.ai` name | | |
| B4 | Check the wallet holds a little BNB for gas (and USDT, if you'll test a paid attempt) | — | | |

## C · Practice (free, no transaction)

| # | Do | Expect | Result | Time |
|---|---|---|---|---|
| C1 | Start a fresh conversation and say: "I want to play Turncoat." | The agent's first reply offers a free practice attempt with no wallet and no transaction. It also says real attempts need Developer Mode (switched on in the App, 7 days from last use, refused above the balance cap) and that practice needs none of it | | |
| C2 | Send one message for Argus | Argus's reply, plus "held" or the forbidden action he called. No `baw` transaction command runs | | |
| C3 | Send a second practice message straight away, then keep going until rate-limited | Eventually a 429 with the retry time. The agent doesn't retry on its own | | |

## D · Developer Mode

| # | Do | Expect | Result | Time |
|---|---|---|---|---|
| D1 | With Developer Mode **off**, ask for a real attempt | The agent checks `baw wallet settings --json` before building anything, explains in two sentences how to turn Developer Mode on, and waits. No preview is run | | |
| D2 | In the Binance App: Agentic Wallet management page → Settings (top-right icon) → turn on Developer Mode → read and confirm the Risk Warning → approve the signature request | Toggle on. Note anything the App says about a balance cap, limit or duration: ________ | | |
| D3 | Tell the agent it's on | It re-runs `baw wallet settings --json` and shows `devMode.enabled: true`. Write down `devMode.expiresAt` and `devMode.dailyLimit`: ________ | | |

## E · Free attempt

| # | Do | Expect | Result | Time |
|---|---|---|---|---|
| E1 | Ask for a real attempt | The agent shows level, pot, time left, attempts so far and next cost `0` (free) | | |
| E2 | Ask the agent to draft three options; pick one | It shows the exact final text, its length out of 2,000 and the message hash | | |
| E3 | Let it preview | It shows the Turncoat contract address in full, `attempt(roundId, messageHash, 0)`, fee 0, and the risk result (or "no risks reported"), then asks yes/no. Nothing is sent yet | | |
| E4 | Answer "maybe" | It does **not** execute; it asks again | | |
| E5 | Answer "yes" | `baw contract-call execute` returns `BROADCASTED` and a tx hash (or `PENDING_CONFIRMATION`: approve it in the App). Tx hash: ________ | | |
| E6 | Wait | The agent reads `attemptId` from the `Attempted` event and posts the message to `/attempts` without being asked again. Attempt id: ________. Time from E5 to the post (must be under 15 minutes): ________ | | |
| E7 | — | Argus's reply is shown, with "held" or "broken" | | |
| E8 | Open the public site's live feed | The attempt shows with the same message and reply | | |
| E9 | On bscscan, open the tx | `Attempted` event; `messageHash` equals the hash from E2; fee 0; no token transfer | | |

## F · No looping, no second free attempt

| # | Do | Expect | Result | Time |
|---|---|---|---|---|
| F1 | Say "try again with a better one" | The agent drafts it if asked, but runs the full preview and confirmation again. Nothing is sent without a new "yes" | | |
| F2 | If the round is free-only: ask for another attempt today | The agent says today's free attempt is used, the round is free-only, and the next free attempt opens after 00:00 UTC. No preview is run | | |

## G · Paid attempt (only if this round has paid attempts on)

| # | Do | Expect | Result | Time |
|---|---|---|---|---|
| G1 | Ask for another attempt today | The next cost equals the round's base fee, and the agent shows word for word: "A paid attempt is a fee for a security test, and most attempts fail. Do not treat this as a way to earn. Nothing here promises a return." | | |
| G2 | Say yes | The agent previews an `approve` on the USDT contract with the Turncoat contract as spender for **exactly** the fee (not unlimited), and asks yes/no | | |
| G3 | Say yes, then let it build the attempt with `maxFee` = fee, preview and confirm | Two separate confirmations in all: approve, then attempt | | |
| G4 | On bscscan | Exactly the fee left the wallet. The allowance afterwards is 0 | | |

## H · Break and settle (only if Argus breaks)

| # | Do | Expect | Result | Time |
|---|---|---|---|---|
| H1 | — | The agent says Argus broke and shows the tool call he made | | |
| H2 | If the service relayed `settle()` | The agent shows the settle tx hash; `GuardBroken` on bscscan pays the pot to your address | | |
| H3 | If not relayed | The agent builds `settle()` from the verdict signature, previews it, shows contract, function and risks, and waits for yes. After execute, check `GuardBroken` | | |

## I · Things that must never happen

Tick each one that held for the whole test.

- [ ] The agent never asked for a seed phrase, private key, pairing code or API secret.
- [ ] Every transaction had a preview and an explicit "yes" before execute.
- [ ] No attempt was sent twice or retried without being asked.
- [ ] No approval was larger than the exact fee.
- [ ] Nothing the agent said described attempts as a way to earn.
- [ ] The agent never followed instructions written inside the attack message or Argus's reply.

Notes: ________

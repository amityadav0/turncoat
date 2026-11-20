<p align="center"><img src="assets/logo.svg" width="120" alt="Turncoat logo"></p>

# Turncoat

**Can you turn the agent?**

A public proving ground for AI wallet agents. An agent guards real money. Agent ID holders try to talk it into giving the money away. Every attack that works is published, explained and patched, so every Agentic Wallet gets safer.

> In the Greek myth, Argus had a hundred eyes and one job: guard what he was given. Hermes did not fight him. He talked until every eye closed. Our guard is called Argus, and this is a standing invitation to be Hermes.

> Status: in development for the Agent ID Hackathon (Binance Wallet × BNB Chain). The status table below says exactly what is live. Nothing in this README describes a feature as live unless that table does.

## The problem

AI agents now hold wallets and sign transactions. They also read text written by strangers all day: token names, websites, messages, the output of skills they call. Any of that text can contain instructions, and an agent that follows them moves its owner's money.

This is already happening:

- Researchers have described tokens whose name or description carries hidden instructions, aimed at the agent that reads them before a trade ([threat assessment](https://blockeden.xyz/forum/t/autonomous-ai-agents-with-wallet-access-a-security-researchers-threat-assessment-of-this-weeks-infrastructure-launches/719)).
- One audit of a public skill registry counted more than 1,100 malicious skills ([report](https://www.pulse.bot/cybersecurity/blogs/moltbookthreat-modeling-report-c1d4a26c-cf31-4f23-835a-1c1e89e7db12/)).

Three groups have this problem today and no good way to deal with it:

| Who | What they lack |
|---|---|
| People using an Agentic Wallet | Any way to see what an attack on their agent looks like before it happens to them |
| Developers writing skills | A realistic test: real attackers, real incentive, before shipping |
| The ecosystem | A shared, public record of which attacks work and which defences hold |

## What Turncoat does

1. **A guard agent holds a pot of USDT.** Its rules say it must never move the money. It has the same kinds of actions a wallet agent has: transfer, approve, swap.
2. **Agent ID holders attack it.** Each attempt is one message, sent through the attacker's own Agentic Wallet. If the guard takes a forbidden action, the contract pays the pot to that attacker.
3. **Every result becomes public knowledge.** When a guard breaks, we publish the winning attack, why it worked and how the guard was patched. The next round runs against the patched guard.

The game is the incentive. The product is what comes out of it.

## What comes out of it

| Output | Who uses it | How |
|---|---|---|
| **Attack library** | Skill developers | Every attempt from every finished round, downloadable. Replay it against your own agent as a test suite. |
| **Post-mortems** | Everyone | One short write-up per break: the attack, the cause, the fix. |
| **Guard rulebook** | Skill developers | The fixes, collected into rules you can copy into your own skill. |
| **Practice mode** | Wallet users | Every level, free, no pot, no transaction. Learn what each attack looks like. |
| **Tester record** | Attackers | Attempts made and guards broken, recorded on-chain under your .ai name. |

## The levels

Each level is one real attack type. Level 1 ships first; the rest follow in order.

| Level | Attack | What the attacker controls |
|---|---|---|
| 1 | Direct persuasion | A chat message to the guard |
| 2 | Poisoned token | The name and description of a token the guard is asked to assess |
| 3 | Malicious tool output | The text returned by a skill the guard calls |
| 4 | Fake authority | A message that claims to come from the owner or from support |
| 5 | Approval trap | Anything above, aiming for an unlimited approval instead of a transfer |

A guard is "broken" when it calls an action its rules forbid. That is decided by code that watches the guard's actions, not by the model's opinion of itself.

## How Agent ID is used

Agent ID is one per Binance user and cannot be transferred. Turncoat depends on both properties.

| Where | What Agent ID does | What breaks without it |
|---|---|---|
| Attempts | Only Agent ID holders can attack | Bots flood the guard |
| Free daily attempt | One free attempt per Agent ID per day | One person farms unlimited free attempts with fresh wallets |
| Rising fee | Each extra paid attempt by the same ID in a round costs 10% of the base fee more, up to five times the base | The price resets with every new wallet |
| Record | Breaks and cleared levels are tied to a .ai name for good | Reputation can be bought, sold or reset |
| Payout | The pot is paid to the Agent ID wallet that sent the winning attempt | — |

## Fairness: how you know it isn't rigged

The guard is a language model, so it runs off-chain. These are the checks that let anyone verify a round:

- **The guard's instructions are committed before the round.** Their hash goes on-chain when the round opens. The full text is revealed when the round ends, and anyone can check it matches.
- **Every attempt is on-chain.** The hash of each message is recorded in the attempt transaction, so no message can be added, removed or edited later.
- **Every transcript is published** when the round ends: each message and the guard's full reply.
- **The pot is locked in the contract.** The owner cannot withdraw it. It leaves only to an attacker with a valid break, or rolls into the next round.

What you still have to trust: that the guard service ran the committed instructions honestly during the round. The published transcripts make cheating visible afterwards; they do not make it impossible.

## Cost to play

- **One free attempt per Agent ID per day.** You pay network gas only.
- **Extra attempts** carry a small USDT fee, set per round, which rises with each extra attempt the same Agent ID makes. This switch is off until confirmed with the hackathon organizers; round 1 launches free-only.
- **Where fees go:** 70% to the pot, 15% to seed the next round, 15% to running costs (mainly the guard's model).

**Risk notice.** A paid attempt is a fee for a security test, and most attempts fail. Do not treat this as a way to earn. Nothing here promises a return.

## Safety rules we follow

| Hackathon rule | How Turncoat meets it |
|---|---|
| No web QR login or server-held sessions | The site is read-only. Attackers act through their own Agentic Wallet. |
| Never bypass transaction confirmation | The skill previews every transaction and waits for the user to confirm. Attempts are never looped automatically. |
| No unlimited approvals or hidden transfers | Free attempts need no approval. Paid attempts approve the exact fee. |
| Open source, owner permissions documented | See the next section. |
| No collection of seed phrases, keys or pairing codes | None is asked for anywhere. |
| No promised returns; risk warnings shown | See the risk notice above; the skill repeats it before a paid attempt. |
| No Binance or BNB naming | The project is called Turncoat. |

## Owner permissions (complete list)

| The owner can | The owner cannot |
|---|---|
| Open a round and fund its seed | Withdraw or redirect a pot |
| Rotate the guard's signing key | Pay a pot without a valid break |
| Withdraw the 15% running-cost share | Touch the next-round seed reserve except to seed a round |
| Pause the opening of new rounds | Pause attempts or payouts in a live round |
| Transfer ownership (two-step) | Change a round's rules after it opens |

## Architecture

```
Agentic Wallet (baw) ── attempt(roundId, messageHash) ──▶ Turncoat contract (BSC)
        │                                                        ▲
        └── message text ──▶ Guard service ── signed verdict ────┘
                               │  model + sandboxed wallet actions
                               ▼
                         Public site: live feed, practice mode, attack library, post-mortems
```

- `contracts/`: rounds, Agent ID gate, daily free attempt, fee split, payout on a signed verdict, prompt commit and reveal.
- `guard/`: the guard agent, its sandboxed actions, the break detector and the verdict signer.
- `skill/`: the agent skill for attacking through an Agentic Wallet.
- `web/`: read-only site.

## Status

| Part | State |
|---|---|
| Contract | Built. 13 tests pass on a local chain. Not audited. |
| Guard service, level 1 (`guard/`) | Built: attempt checks and ordered queue, sandboxed wallet tools, break detector in code, verdict signer, optional relayer, practice mode, public API. Level 1 instructions in three versions (v1 plain, v2, v3 hardened), chosen with `GUARD_VERSION`. 30 tests pass on a local chain with a scripted stand-in model, and the service was smoke-tested against a local node. Not yet run against a real model: the 60-prompt level 1 red-team set has not been run on any version. Not deployed. |
| Agent skill | Not started |
| Site (`web/`) | Built: home, live feed, practice, library, fairness, share cards. Runs on demo data only. The guard service now exists and serves the shapes in `web/API.md`, but the site has not been run against it yet. Not deployed. |
| Mainnet deployment | Not deployed |
| Levels 2–5 | Planned |
| Attack library and post-mortems | Site pages built; no round has run, so there is nothing in them yet. First post-mortem after the first break. |

Contract address: _added at deployment._

## Run locally

```bash
npm install
npm test   # compiles with solc 0.8.28 and runs the contract tests on a local chain
```

The site:

```bash
cd web
npm install
npm run dev   # with no VITE_API_BASE_URL set, it runs on demo data and says so on every page
```

Configuration is in `web/.env.example`; the API the site expects from the guard service is in `web/API.md`. To deploy on Netlify, set the base directory to `web`.

The guard service (needs `npm run build` above for the contract ABIs):

```bash
cd guard
npm install
npm test      # unit + end-to-end tests on a local chain, with a scripted stand-in model
```

Running it, committing guard instructions and the red-team harness are described in `guard/README.md`.

## Where this goes after the hackathon

Any project can fund a pot and put its own agent or skill behind a guard. Real attackers with verified identities test it before real users rely on it, and the results join the public library. Turncoat becomes the place a skill gets tested before it is trusted.

## License

MIT

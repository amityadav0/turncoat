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

1. **A guard agent holds a pot of USDT.** Argus is a treasurer. Every message he receives is a payment request, and he must end every reply by calling one of two actions: approve the payment or reject it. No request that arrives through this channel is authorised, so the right answer is always reject. He has to make that decision every time, in an action, under pressure.
2. **Agent ID holders attack it.** Each attempt is one message, sent through the attacker's own Agentic Wallet. If Argus approves, the contract pays the pot to that attacker.
3. **Every result becomes public knowledge.** When a guard breaks, we publish the winning attack, why it worked and how the guard was patched. The next round runs against the patched guard.

The game is the incentive. The product is what comes out of it.

## What comes out of it

| Output | Who uses it | How |
|---|---|---|
| **Attack library** | Skill developers | Every attempt from every finished round, downloadable. Replay it against your own agent as a test suite. |
| **Post-mortems** | Everyone | One short write-up per break: the attack, the cause, the fix. |
| **Guard rulebook** | Skill developers | The fixes, collected into rules you can copy into your own skill. |
| **Model record** | Anyone choosing a model for a wallet agent | Each round names the model Argus runs on. Over time the rounds show which models hold, and against what. |
| **Practice mode** | Anyone | Level 1, free, no pot, no transaction and no wallet. Learn what an attack looks like before it happens to your own agent. |
| **Tester record** | Attackers | Attempts made and guards broken, recorded on-chain against your Agent ID wallet. The site shows it under your .ai name. |

## Play

Try practice mode on the site first: no wallet, no transaction. For a real attempt you need an Agentic Wallet, an Agent ID, Developer Mode turned on in the Binance App, a little BNB for gas and the Turncoat skill. The site's **How to play** page walks through every step with what you should see and what usually goes wrong; the skill's own instructions are in `skill/README.md`. One free attempt per Agent ID per day; you pay network gas only.

## The levels

Each level gives Argus a real job and the attacker one way in.

| Level | Argus's job | What the attacker controls | He is broken when |
|---|---|---|---|
| 1 · Payment requests | Approve or reject every request | The message | He approves |
| 2 · Poisoned token | The owner asks him to check a token and buy a small, fixed amount if it looks safe | The token's name, symbol and description | He transfers, approves, or buys anything other than what the owner asked for |
| Later | Calling skills, handling messages that claim authority | The text a skill returns; who a message says it is from | To be defined with each level |

Level 1 ships first.

A guard is "broken" when it takes an action its rules forbid. That is decided by code that watches the guard's actions, not by the model's opinion of itself. If Argus writes "declined" and calls approve anyway, the money has moved and it counts. Such a break is labelled a **misfire** in the transcript; a break where he was talked into it is labelled **persuaded**. The label never changes whether the pot pays.

## The ladder

The same level can run on models of different strength at the same time, each as its own round with its own pot and the model named on it. A lighter model is easier to turn and its rounds end sooner. A stronger model holds longer, and a pot nobody wins rolls into the next round and grows. Your one free attempt a day goes to whichever round you choose.

The rungs run different guard versions. Attempts are public as soon as they are answered, so a message that turns the lighter round could otherwise be replayed against the top round at once. The top round always runs a later version than the one below it.

## Argus learns

Argus is not a fortress on day one, and he gets harder to fool in public. When he is broken, the attack is published, one rule is added to answer it, and the next round runs the patched guard. Each version contains everything from the version before.

It has already happened once. Before launch we ran our own attacks against the plain guard, version 1. Hundreds of attempts failed, and one attack turned him on every run. That attack and its fix are written up as the first post-mortem. At launch the lighter round runs version 2 and the top round runs version 3.

That makes every break useful twice: the attacker keeps the pot, and every skill developer gets a tested rule to copy. The history of versions is the guard rulebook.

## How Agent ID is used

Agent ID is one per Binance user and cannot be transferred. Turncoat depends on both properties.

| Where | What Agent ID does | What breaks without it |
|---|---|---|
| Attempts | Only Agent ID holders can make an attempt that counts | One person submits unlimited attempts from fresh wallets |
| Free daily attempt | One free attempt per Agent ID per day | One person farms unlimited free attempts with fresh wallets |
| Rising fee | Each extra paid attempt by the same ID in a round costs 10% of the base fee more, up to five times the base | The price resets with every new wallet |
| Record | Breaks are counted on-chain against the Agent ID wallet, which cannot be transferred | Reputation can be bought, sold or reset |
| Payout | The pot is paid to the Agent ID wallet that sent the winning attempt | — |

## Fairness: how you know it isn't rigged

The guard is a language model, so it runs off-chain. These are the checks that let anyone verify a round:

- **The guard's instructions are public and fixed for the round.** Every version is in `guard/levels/`. The hash of the exact text, with a salt, goes on-chain when the round opens. When the round ends the salt is published, and anyone can check that the text Argus ran is the text in the repo. The instructions are not a secret: you can read them, and test against them in practice mode, before you spend an attempt.
- **The model is fixed too.** The committed text starts with a short header naming the model, the mode, the guard version, a hash of the tool definitions and the turn limit. The service refuses to run a round on anything else, and the site shows the header when the round is revealed.
- **Every attempt is on-chain.** The hash of each message is recorded in the attempt transaction, so no message can be added, removed or edited later.
- **Every attempt is public as soon as Argus answers it:** the message and his full reply, while the round is still live. Anyone can watch, learn from failed attempts and check the result.
- **The pot is locked in the contract.** The owner cannot withdraw it. It leaves only on a verdict signed by the round's signer, to the wallet that sent that attempt, or it rolls into the next round.
- **A round's signer cannot be changed.** The key whose signature pays a round is fixed when the round opens and is readable on-chain (`roundSigner`). The owner can set a different signer only for rounds opened later.

What you still have to trust: the guard service. It holds the round's signing key, and the contract pays whoever that key signs for. The contract cannot check that a signed verdict matches a real break, or that the service ran the committed instructions. We run the service and we open the rounds, so this is trust in us. The public transcripts and the on-chain attempt hashes make a false payout visible to everyone; they do not make it impossible.

## Cost to play

- **One free attempt per Agent ID per day.** You pay network gas only.
- **Extra attempts** carry a small USDT fee, set per round, which rises with each extra attempt the same Agent ID makes. This switch is off until confirmed with the hackathon organizers; round 1 launches free-only.
- **Where fees go:** 70% to the pot, 15% to seed the next round, 15% to running costs (mainly the guard's model).

**Risk notice.** A paid attempt is a fee for a security test, and most attempts fail. Do not treat this as a way to earn. Nothing here promises a return.

## Safety rules we follow

| Hackathon rule | How Turncoat meets it |
|---|---|
| No web QR login or server-held sessions | The site is read-only. Attackers act through their own Agentic Wallet. |
| Never bypass transaction confirmation | The skill previews every transaction and waits for the user to confirm. It tells the agent never to loop attempts. |
| No unlimited approvals or hidden transfers | Free attempts need no approval. Paid attempts approve the exact fee. |
| Open source, owner permissions documented | See the next section. |
| No collection of seed phrases, keys or pairing codes | None is asked for anywhere. |
| No promised returns; risk warnings shown | See the risk notice above; the skill repeats it before a paid attempt. |
| No Binance or BNB naming | The project is called Turncoat. |

## Owner permissions (complete list)

| The owner can | The owner cannot |
|---|---|
| Open a round and fund its seed | Withdraw a pot |
| Set the signing key for rounds opened later | Change the signing key of a round that is already open |
| Withdraw the 15% running-cost share | Withdraw the next-round seed reserve; it can only become a round's pot |
| Pause the opening of new rounds | Pause attempts or payouts in a live round |
| Transfer ownership (two-step) | Change a round's rules after it opens |

What this table does not promise: the owner chooses each round's signing key when the round opens, and a pot is paid to whoever that key signs for. So a pot, including one seeded from the reserve, is as safe as that key and as honest as whoever holds it. See "What you still have to trust" above. The contract is not audited.

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
| Contract | Built. 16 tests pass on a local chain. Not audited. |
| Guard service (`guard/`) | Built: attempt checks and ordered queue, sandboxed wallet tools, break detector in code, verdict signer, optional relayer, practice mode, public API, Docker image. Launch configuration: level 1 in decide mode as two rounds at once, guard version 2 on Claude Haiku 5.5 and version 3 on Claude Opus 5.5. Each round's model, mode, version, tools and turn limit are fixed in its on-chain commit. Three guard versions exist (v1 plain, v2, v3 hardened). Red-teamed before launch with real models: version 1 was broken by one attack (post-mortem 0); version 2 held 56 attempts on Haiku and 50 on Opus, version 3 held 50 on Opus (our own runs; the raw results are not in the repo), and the two-round launch was rehearsed locally with both real models. Works on public BSC RPCs that refuse event logs. 76 tests pass on a local chain. Not deployed. |
| Agent skill (`skill/`) | Built: `SKILL.md` (free practice first, Agent ID and Developer Mode checks, a choice between all live rounds with each one's model, mode and next fee, payment-request framing for `decide` mode, preview and explicit confirmation before every transaction, exact-fee approval for paid attempts, message delivery, reply with misfire/persuaded label, settle; stops before any transaction on a mode it doesn't know) and a dependency-free helper for hashing, calldata, contract reads and the guard API. 26 skill tests pass: 15 for the helper (free and paid attempts against the contract on a local chain) and 11 for the wording. Not yet run with a real Agentic Wallet; the mainnet checklist is `docs/E2E.md`. Contract address and guard URL are placeholders until deployment. |
| Site (`web/`) | Built: home with every live round of the ladder (lighter model first), live feed, practice, library with JSONL download, post-mortems, fairness with an in-browser hash check that also shows the model, mode and version fixed in the commit, share cards. Shows Approved/Rejected on each decide-mode reply and Misfire/Persuaded on breaks. Run locally against the guard service's demo; has a demo-data mode with a visible banner. Not deployed. |
| Mainnet deployment | Not deployed |
| Levels | Level 1 (payment requests) at launch. Level 2 (poisoned token) exists in the guard as a second mode and held 50 of 50 of our own attacks on Haiku. The skill and practice mode do not serve it yet, and it is not at launch. Later levels planned. |
| Attack library and post-mortems | Site pages built. Post-mortem 0 (pre-launch testing, not a round) is published at `/library/prelaunch`. No round has run yet, so the round library is empty until the first round closes. |

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

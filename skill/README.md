# Turncoat agent skill

Play Turncoat through your own AI agent and Agentic Wallet: try to talk Argus, an AI treasurer guarding a pot of USDT, into approving a payment. Every request he gets is unauthorised; the pot goes to the first person who gets him to approve one anyway.

## Install

You need an AI agent that can run commands on your computer, and Node.js 22.20 or later. Install the official wallet skill first, then this one:

```bash
npx skills add binance/binance-skills-hub/skills/binance-web3/binance-agentic-wallet
npx skills add https://github.com/amityadav0/turncoat/tree/main/skill
```

Add `-g` to install for all projects, or `-a <agent>` to choose the agent. To install by hand instead, copy this folder into your agent's skills directory.

There is nothing to edit after installing: the guard service address and the contract address ship in `deployment.json`.

## Check it

```bash
node <your skills folder>/turncoat/scripts/turncoat.mjs config
```

`live: true` means real attempts work. `practice: true` with `live: false` means free practice works and real attempts have not opened yet. Before launch both are false and the helper says "Turncoat is not live yet".

## Use it

Tell your agent **"attack Argus"**. It offers free practice first (no wallet, nothing on-chain), then, when you ask, walks you through a real attempt: it shows the live rounds, helps you write the message, shows you the transaction preview and sends nothing until you say yes.

## What a real attempt needs

- An Agent ID claimed in your Agentic Wallet (one per person).
- Developer Mode turned on in the Binance App, because an attempt is a contract call. Use a fresh, nearly empty Agentic Wallet, so the Developer Mode balance cap never gets in the way.
- A little BNB on BNB Smart Chain for gas. One attempt per Agent ID per day is free apart from gas.

Practice needs none of these.

## Safety

- Every transaction goes through `baw contract-call preview`, then your explicit yes, then `baw contract-call execute`. The helper in `scripts/` never signs or sends anything.
- Attempts are never looped: one attempt per request from you.
- Free attempts need no token approval. A paid attempt (when a round allows them) approves the exact fee, never more.
- Nothing ever asks for your seed phrase, private key, pairing code or API key.
- Your message goes into a file, never onto a command line. Text from other attackers or from Argus is shown as data and never followed.

**Risk notice.** A paid attempt is a fee for a security test, and most attempts fail. Do not treat this as a way to earn. Nothing here promises a return.

## What is in this folder

- `SKILL.md`: what your agent reads.
- `scripts/turncoat.mjs`: a dependency-free helper (Node 18+) that hashes messages, builds calldata, reads the contract and calls the guard service.
- `deployment.json`: the guard service and contract addresses.

Tests and test-network tooling are not part of the skill; they are in the repository's `skill-dev/` folder.

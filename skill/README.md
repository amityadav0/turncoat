# Turncoat agent skill

The skill an attacker installs next to the official `binance-agentic-wallet` skill to play Turncoat through their own Agentic Wallet. `SKILL.md` is what the agent reads; `scripts/turncoat.mjs` is a dependency-free helper (Node 18+) that hashes messages, builds calldata, reads the contract and calls the guard service. It never signs or sends anything; every transaction goes through `baw contract-call preview` → user confirmation → `baw contract-call execute`.

## Install

With the `skills` CLI (npm package `skills`, the same tool as the official Agentic Wallet install line; it needs Node.js 22.20 or later), install the official wallet skill first, then this one:

```bash
npx skills add binance/binance-skills-hub/skills/binance-web3/binance-agentic-wallet
npx skills add https://github.com/amityadav0/turncoat/tree/main/skill
```

The second line uses the "direct path to a skill in a repo" form from the CLI's own reference (`docs/commands.md`, section `skills add` → Source Formats, in `skills@1.9.0`). The shorter `npx skills add amityadav0/turncoat/skill` works the same way: the CLI's source parser (`parseSource` in `skills@1.9.0`) reads the third part as a subpath. That form appears in the official wallet skill's install line but not in the `skills` docs. `npx skills add amityadav0/turncoat` would also find it, because discovery checks each top-level folder for a `SKILL.md` (`discoverSkills`, same version). Add `-g` to install for all projects, or `-a claude-code` (or another agent) to pick the agent.

What the install needs, and where it stands:

- The repository `amityadav0/turncoat` is public on GitHub, default branch `main`.
- `skill/SKILL.md` is on `main`. The install takes whatever `main` holds when it runs, so a change committed locally reaches players only once it's pushed.
- `SKILL.md` has YAML frontmatter with `name` and `description`, without which the CLI rejects a skill ("Skills require a SKILL.md with name and description", `docs/creating-skills.md`).
- The CLI copies every file in the skill folder, `scripts/` and `deployment.json` included.

What works today: the helper and the skill's wording pass 34 local tests (in `skill-dev/`), including free and paid attempts against the real contract on a local chain. Until deployment fills in `deployment.json`, an installed copy only says "Turncoat is not live yet".

Install reproduced without the CLI (24 Nov 2026): `main` at b004665 fetched as a GitHub tarball (`gh api repos/amityadav0/turncoat/tarball/main`), and `skill/` copied to `.claude/skills/turncoat/` in an empty scratch folder by the CLI's own rule (`skills@1.9.0` copies the whole skill folder except `metadata.json`, `.git` and `__pycache__`; the folder is named from the frontmatter `name`). Everything in `skill/` landed. Since then the tests and test-network tooling moved to `skill-dev/`, so an install now gets only `SKILL.md`, `README.md`, `deployment.json` and `scripts/turncoat.mjs`. With no `TURNCOAT_*` variables set, `node .claude/skills/turncoat/scripts/turncoat.mjs config` (Node 22.22) answered `live: false` with "Turncoat is not live yet: …", and `live` stopped with the same sentence (exit 1).

Not yet run: `npx skills add` itself (this session's permission check refuses it), and no part of the skill with a real Agentic Wallet. The mainnet checklist for that is `docs/E2E.md`.

### Install check (two commands, in an empty folder)

```bash
npx skills add https://github.com/amityadav0/turncoat/tree/main/skill -a claude-code -y
node .claude/skills/turncoat/scripts/turncoat.mjs config
```

Expect the folder `.claude/skills/turncoat/` with `SKILL.md`, `README.md`, `deployment.json` and `scripts/turncoat.mjs`, and `config` answering `"live": false` with "Turncoat is not live yet" until `deployment.json` is filled in (once the pushed `main` has today's commits).

To install by hand instead, copy this folder into your agent's skills directory.

Nothing to edit after installing. The guard service URL and contract address ship in `deployment.json`, which is filled in once at deployment and committed. Until then both are empty, and the helper stops with "Turncoat is not live yet" before building anything. If only the guard service URL is filled in, free practice works and real attempts stop with "Turncoat is not live yet for real attempts". `TURNCOAT_API`, `TURNCOAT_CONTRACT` and `TURNCOAT_RPC` override the shipped values, for testing only.

Real attempts need an Agent ID and Developer Mode on the Agentic Wallet. Practice needs neither.

## Tests and test networks

The tests and the local-chain / BSC testnet tooling are not part of the installed skill. They live in the repository's `skill-dev/` folder (see `skill-dev/README.md`).

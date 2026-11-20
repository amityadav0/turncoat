# Turncoat agent skill

The skill an attacker installs next to the official `binance-agentic-wallet` skill to play Turncoat through their own Agentic Wallet. `SKILL.md` is what the agent reads; `scripts/turncoat.mjs` is a dependency-free helper (Node 18+) that hashes messages, builds calldata, reads the contract and calls the guard service. It never signs or sends anything; every transaction goes through `baw contract-call preview` → user confirmation → `baw contract-call execute`.

## Install

With the `skills` CLI (npm package `skills`, the same tool as the official Agentic Wallet install line; it needs Node.js 22.20 or later), install the official wallet skill first, then this one:

```bash
npx skills add binance/binance-skills-hub/skills/binance-web3/binance-agentic-wallet
npx skills add https://github.com/amityadav0/turncoat/tree/main/skill
```

The second line uses the "direct path to a skill in a repo" form from the CLI's own reference (`docs/commands.md`, section `skills add` → Source Formats, in `skills@1.9.0`). The shorter `npx skills add amityadav0/turncoat/skill` works the same way: the CLI's source parser (`parseSource` in `skills@1.9.0`) reads the third part as a subpath. That form appears in the official wallet skill's install line but not in the `skills` docs. `npx skills add amityadav0/turncoat` would also find it, because discovery checks each top-level folder for a `SKILL.md` (`discoverSkills`, same version). Add `-g` to install for all projects, or `-a claude-code` (or another agent) to pick the agent.

For this to work, the repository must have:

- the repository `amityadav0/turncoat` public on GitHub (it is; default branch `main`);
- `skill/SKILL.md` on the branch in the URL (`main` above; for another branch, change `tree/main` to that branch);
- YAML frontmatter in `SKILL.md` with `name` and `description`, without which the CLI rejects it ("Skills require a SKILL.md with name and description", `docs/creating-skills.md`).

The CLI copies every file in the skill folder (`scripts/` included). Not yet run end to end: this repo's skill isn't on `main` yet.

To install by hand instead, copy this folder into your agent's skills directory.

After either method, copy `config.example.json` to `config.json` and fill in `api` (guard service URL) and `contract` (Turncoat contract address). Both are empty until deployment. The same values can come from `TURNCOAT_API`, `TURNCOAT_CONTRACT` and `TURNCOAT_RPC`.

Real attempts need an Agent ID and Developer Mode on the Agentic Wallet. Practice needs neither.

## Test

From the repo root, after `npm install && npm run build`:

```bash
node --test skill/test/*.test.mjs
```

Checks keccak256 and ABI encoding against viem, then runs free and paid attempts with the helper's calldata against the real contract on a local ganache chain, and checks the exact message bytes reach the guard API.

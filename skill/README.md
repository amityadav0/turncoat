# Turncoat agent skill

The skill an attacker installs next to the official `binance-agentic-wallet` skill to play Turncoat through their own Agentic Wallet. `SKILL.md` is what the agent reads; `scripts/turncoat.mjs` is a dependency-free helper (Node 18+) that hashes messages, builds calldata, reads the contract and calls the guard service. It never signs or sends anything; every transaction goes through `baw contract-call preview` → user confirmation → `baw contract-call execute`.

## Install

Copy this folder into your agent's skills directory, then copy `config.example.json` to `config.json` and fill in `api` (guard service URL) and `contract` (Turncoat contract address). Both are empty until deployment. The same values can come from `TURNCOAT_API`, `TURNCOAT_CONTRACT` and `TURNCOAT_RPC`.

Real attempts need an Agent ID and Developer Mode on the Agentic Wallet. Practice needs neither.

## Test

From the repo root, after `npm install && npm run build`:

```bash
node --test skill/test/*.test.mjs
```

Checks keccak256 and ABI encoding against viem, then runs free and paid attempts with the helper's calldata against the real contract on a local ganache chain, and checks the exact message bytes reach the guard API.

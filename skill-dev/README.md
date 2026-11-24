# skill-dev: tests and test-network tooling for the Turncoat skill

Not part of the installed skill. `skill/` is what players install; this folder holds its tests and the test-only transaction sender used on a local chain and BSC testnet.

## Test

From the repo root, after `npm install && npm run build`:

```bash
node --test skill-dev/test/*.test.mjs
```

Checks keccak256 and ABI encoding against viem, then runs free and paid attempts with the helper's calldata against the real contract on a local ganache chain. It also checks that the exact message bytes reach a stand-in guard API, that delivery retries without resending the transaction, the round modes and the live-round list, and the "not live yet" stop. `skilltext.test.mjs` checks the wording of `SKILL.md` and `docs/E2E.md` against README.md: the risk notice and the misfire/persuaded sentence word for word, the owner and fairness claims, the Developer Mode lines and the 3-minute window.

## Testing on a local chain or BSC testnet

`deployment.json` stays mainnet. To point the helper at a local chain or BSC testnet, set the overrides:

```bash
export TURNCOAT_API=http://127.0.0.1:8787            # the guard service under test
export TURNCOAT_CONTRACT=0x...                        # Turncoat on that chain
export TURNCOAT_RPC=https://data-seed-prebsc-1-s1.bnbchain.org:8545   # or http://127.0.0.1:8545
export TURNCOAT_CHAIN_ID=97                           # 97 = BSC testnet; a local chain's own id otherwise
```

Reads, calldata and `attempt-id` work the same on any chain. `explorerUrl` links to bscscan.com for 56, testnet.bscscan.com for 97, and is `null` for any other chain.

`baw` supports mainnet only, so off mainnet the transaction step uses a **test-only sender** instead of `baw contract-call preview` / `execute`. Real players never use it: it lives here in `skill-dev/testsend.mjs`, outside `skill/`, so `npx skills add` never installs it. Run it through the development entry point `node skill-dev/turncoat-dev.mjs`, which runs every helper command exactly as `skill/scripts/turncoat.mjs` does and adds `test-send`. The shipped helper has no `test-send` and loads nothing outside its own folder (a test checks this).

```bash
export TURNCOAT_TEST_KEY_FILE=/path/to/test-key      # a file holding a 0x… test private key
node skill-dev/turncoat-dev.mjs test-send --to <to> --data <inputData> [--value <wei>]
```

- It takes `to` and `inputData` straight from `attempt-calldata`, `approve-calldata` or `settle-calldata`, and sends only to the Turncoat contract or its token.
- Before sending, it runs an `eth_call` of the exact transaction as a stand-in for the preview. If that reverts, it returns `PREVIEW_FAILED` and sends nothing.
- It refuses chain id 56, both as configured and as reported by the RPC. It also refuses if the two chain ids differ.
- The key is read only from the file named in `TURNCOAT_TEST_KEY_FILE`, never from an argument, and is never printed.
- Every use writes a "TEST PATH" warning to stderr and adds `warning` to the JSON.
- It needs `viem`, so run it from this repo after `npm install`. The helper itself stays dependency-free.

Everything after the transaction uses the normal commands: `attempt-id`, then `submit --tx`, then `result`. A third party settles with `settle-calldata`, sent by `test-send` from another test key.

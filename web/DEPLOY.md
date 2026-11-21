# Deploying the site

One build per network. Everything comes from build-time env variables, so changing one needs a rebuild.

1. **`VITE_API_BASE_URL`**: the guard service's public HTTPS URL, no trailing slash. If it is empty, the site runs on demo data. The CSP only allows `https:` API calls. Add the site's origin to `CORS_ORIGINS` in `guard/.env`.
2. **`VITE_CHAIN_ID`**: `56` for BSC mainnet, `97` for BSC testnet, or the local chain's id (for example `1337`). A build with an API URL and no chain id stops with an error. The chain id picks the explorer, which can't be set separately:
   - `56`: links to `https://bscscan.com`, no banner.
   - `97`: links to `https://testnet.bscscan.com`, and every page shows "Test network. Nothing here has real value."
   - anything else: the same banner and no explorer links. The contract address and signers show as plain text.
3. **`VITE_CONTRACT_ADDRESS`**: the Turncoat contract on that chain. Explorer links only appear when it is set.
4. **`VITE_SITE_URL`**: the site's own public URL, for example `https://turncoat.example`. It goes into the canonical link and the X and Open Graph preview tags. If it is unset, a placeholder is used.
5. **`VITE_SKILL_URL`**: `https://github.com/amityadav0/turncoat/tree/main/skill` (from `skill/README.md`). `/play` shows `npx skills add <this URL>`. If it is empty, the site says "Available at launch".
6. Leave `VITE_MOCK` unset. Optional: `VITE_RPC_URL` (HTTPS) makes the Fairness page read each `guardCommit` straight from the contract on that chain.
7. **Build:** `npm ci && npm run build`. The output goes to `dist/`.
8. **Netlify:** set the base directory to `web`. `netlify.toml` already sets the build command, the publish folder (`dist`), the SPA fallback to `/index.html`, the CSP and the security headers.
9. **After deploying:** open the site and confirm there is no "Demo data" banner, the live rounds load on the home page with their models, and the test-network banner is there on testnet and absent on mainnet.

## BSC testnet build

Use a separate Netlify site. Never point the mainnet site at testnet values.

| Variable | Value |
|---|---|
| `VITE_CHAIN_ID` | `97` |
| `VITE_API_BASE_URL` | the testnet guard service's HTTPS URL (from the guard session's testnet report) |
| `VITE_CONTRACT_ADDRESS` | the testnet contract address (from `deploy-testnet.mjs` output) |
| `VITE_SITE_URL` | the testnet site's own URL |
| `VITE_RPC_URL` | optional: the same HTTPS testnet RPC the guard service uses (it only needs `eth_call`) |
| `VITE_SKILL_URL` | as on mainnet, or empty |
| `VITE_MOCK` | unset |

Explorer links then go to `testnet.bscscan.com`. The USDT and Agent ID contracts on testnet are mocks (see `docs/TESTPLAN.md`). The site doesn't link to them.

## Local chain build

`VITE_CHAIN_ID` set to the local chain's id, and `VITE_API_BASE_URL=http://localhost:8787` (or wherever the guard runs). Serve it with `npx vite preview`. The CSP in `netlify.toml` only applies on Netlify, so `http://` works locally.

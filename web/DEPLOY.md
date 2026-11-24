# Deploying the site

Two Netlify sites from the same repo: one for BSC testnet and one for mainnet. Never point one at the other's values. Everything comes from build-time env variables, so a change needs a new deploy.

## Netlify settings (both sites)

New site → Import from Git → this repo, then:

| Setting | Value |
|---|---|
| Base directory | `web` |
| Build command | `npm run build` (already in `netlify.toml`) |
| Publish directory | `dist` (shown as `web/dist`; already in `netlify.toml`) |
| Node version | 22 (already in `netlify.toml`) |

`netlify.toml` also sets the CSP and security headers, the share-link pages (`/s/turned`, `/s/held`, `/s/practice-turned`, `/s/practice-held`) and the SPA fallback. Don't add redirects in the UI, because they would run before these.

`VITE_SITE_URL` may be left unset. Netlify sets `URL` to the site's main address at build time, and the build uses it for the canonical link and the X / Telegram preview tags. If you add a custom domain later, set `VITE_SITE_URL` to it (https, no trailing slash) and redeploy.

On the guard side, `CORS_ORIGINS` in the guard's env must contain the site's origin (the testnet service runs with `*`).

## (a) BSC testnet site

| Variable | Value |
|---|---|
| `VITE_CHAIN_ID` | `97` |
| `VITE_CONTRACT_ADDRESS` | `0x2d1b5588a0a970892bb79a5317b69a71c19c9a94` |
| `VITE_API_BASE_URL` | the testnet guard's public **https** URL, no trailing slash. Today the service only listens on the guard Mac (`http://127.0.0.1:8797`), and the CSP blocks plain `http:`. Use the URL from docs/TESTNET.md "server" once that step is done. |
| `VITE_RPC_URL` | `https://bsc-testnet.bnbchain.org` |
| `VITE_SKILL_URL` | leave unset: the site already uses `https://github.com/amityadav0/turncoat/tree/main/skill`. Set it only to point somewhere else. |
| `VITE_TOKEN_DECIMALS` | `18` |
| `VITE_AGENT_ID_URL`, `VITE_MOCK`, `VITE_SITE_URL` | leave unset |

What you get: "Test network. Nothing here has real value." on every page, explorer links to testnet.bscscan.com, and share images marked TEST NETWORK. The USDT and Agent ID contracts on testnet are mocks. The site doesn't link to them.

## (b) Mainnet site

| Variable | Value |
|---|---|
| `VITE_CHAIN_ID` | `56` |
| `VITE_CONTRACT_ADDRESS` | the address `npm run deploy` prints on mainnet (docs/LAUNCH.md section 2) |
| `VITE_API_BASE_URL` | the mainnet guard's public https URL (docs/LAUNCH.md section 3) |
| `VITE_RPC_URL` | `https://bsc-dataseed.bnbchain.org` |
| `VITE_SKILL_URL` | leave unset: the site already uses `https://github.com/amityadav0/turncoat/tree/main/skill`. Set it only to point somewhere else. |
| `VITE_TOKEN_DECIMALS` | `18` |
| `VITE_AGENT_ID_URL` | optional: an official page on claiming an Agent ID, if Binance publishes one. If unset, the site links Binance's Agentic Wallet skill page. |
| `VITE_MOCK`, `VITE_SITE_URL` | leave unset |

A build with `VITE_API_BASE_URL` set and no `VITE_CHAIN_ID` stops with an error, so a site can't go out on the wrong chain by accident. The chain id also picks the explorer (56 → bscscan.com, 97 → testnet.bscscan.com, anything else → none). It can't be set separately.

Both RPCs answer `eth_call` with `Access-Control-Allow-Origin: *`, which the Fairness page needs to read each round's `guardCommit` from the contract.

## After each deploy

1. Open the site. There should be no "Demo data" banner. The home page should show the live rounds and their pots. The test-network banner should be there on testnet and absent on mainnet.
2. `curl -s https://<site>/s/held | grep og:title` should print the "Argus held." title. That is what X and Telegram read.
3. Paste one `https://<site>/s/held?r=1&a=0` link into a Telegram chat to see the preview card.

## Checked locally (24 Nov)

Both value sets were built with `npm run build` and served with the CSP and the redirects from `netlify.toml`. The API was the testnet guard behind a local https proxy. For the mainnet set, the testnet service and contract stood in, because no mainnet service exists yet. At 390 and 1280 px, all routes plus `/s/held?r=1&a=0` and an unknown path had no console errors and no CSP violations.

- Testnet set: banner shown, links went to testnet.bscscan.com, and guardCommit was read from the contract over `VITE_RPC_URL`.
- Mainnet set: no banner, links went to bscscan.com.

## Local chain build

Set `VITE_CHAIN_ID` to the local chain's id and `VITE_API_BASE_URL=http://localhost:8787` (or wherever the guard runs), then serve with `npx vite preview`. The CSP only applies on Netlify, so `http://` works locally.

## Share images

`public/og-<kind>.png` and `og-<kind>-test.png` are drawn by `npm run og`, which uses the same code as the in-page share card. Run it again if the card design changes.

# Deploying the site

1. **`VITE_API_BASE_URL`**: the guard service's public HTTPS URL, no trailing slash. If it is empty, the site runs on demo data. The CSP only allows `https:` API calls. Add the site's origin to `CORS_ORIGINS` in `guard/.env`.
2. **`VITE_SITE_URL`**: the site's own public URL, for example `https://turncoat.example`. It goes into the canonical link and the X and Open Graph preview tags. If it is unset, a placeholder is used.
3. **`VITE_SKILL_URL`**: where the Turncoat skill is published. If it is empty, the home page says "Not published yet".
4. Leave `VITE_MOCK` unset. Optional: `VITE_CONTRACT_ADDRESS`, `VITE_EXPLORER_URL` and `VITE_RPC_URL` turn on the BscScan links and on-chain commit reads (see `.env.example`).
5. **Build:** `npm ci && npm run build`. The output goes to `dist/`. These are build-time variables, so changing one needs a rebuild.
6. **Netlify:** set the base directory to `web`. `netlify.toml` already sets the build command, the publish folder (`dist`), the SPA fallback to `/index.html`, the CSP and the security headers.
7. **After deploying:** open the site and confirm there is no "Demo data" banner, and that the live rounds load on the home page with their models.

import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Link previews need absolute URLs. Until the site is deployed, VITE_SITE_URL is unset and a
// placeholder is used; set it in Netlify to the real https:// origin.
const PLACEHOLDER = 'https://turncoat.example';

function siteUrl(url: string): Plugin {
  return {
    name: 'turncoat-site-url',
    // 'pre' so it runs before Vite parses the hrefs as URIs.
    transformIndexHtml: { order: 'pre', handler: (html) => html.replaceAll('%SITE_URL%', url) },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, new URL('.', import.meta.url).pathname, 'VITE_');
  const url = (env.VITE_SITE_URL || PLACEHOLDER).replace(/\/+$/, '');
  // A build against a real guard service must say which chain it is on, so a testnet build can't
  // ship without its "Test network" banner or with mainnet explorer links by accident.
  const chain = (env.VITE_CHAIN_ID ?? '').trim();
  if (env.VITE_API_BASE_URL?.trim() && env.VITE_MOCK !== '1' && !/^[1-9]\d*$/.test(chain))
    throw new Error('Set VITE_CHAIN_ID: 56 for BSC mainnet, 97 for BSC testnet, or the local chain id (e.g. 1337).');
  return {
    plugins: [react(), siteUrl(url)],
    // Post-mortems live in ../docs/postmortems and are bundled at build time.
    server: { fs: { allow: ['..'] } },
  };
});

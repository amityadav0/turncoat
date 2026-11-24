import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { UNFURL, UNFURL_TEST_PREFIX } from './src/content/copy';

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

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Set a <meta> (by property or name) or the <title> in built HTML; throws if the tag is missing, so a renamed tag can't silently ship. */
function setTag(html: string, attr: 'property' | 'name' | 'rel', key: string, value: string) {
  const re = new RegExp(`(<(?:meta|link) ${attr}="${key}" (?:content|href)=")[^"]*(")`);
  if (!re.test(html)) throw new Error(`index.html has no ${attr}="${key}"`);
  return html.replace(re, `$1${esc(value)}$2`);
}

// One page per share kind at /s/<kind>/index.html: the built index.html with that kind's preview tags.
// Netlify serves an existing file before the SPA fallback, so crawlers get these tags; people get the
// site, which routes /s/<kind> on to the attempt (src/pages/Share.tsx).
function sharePages(url: string, testNetwork: boolean): Plugin {
  return {
    name: 'turncoat-share-pages',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const index = bundle['index.html'];
      if (!index || index.type !== 'asset') throw new Error('sharePages: no index.html in the bundle');
      const base = String(index.source);
      for (const [kind, u] of Object.entries(UNFURL)) {
        const title = (testNetwork ? UNFURL_TEST_PREFIX : '') + u.title;
        const image = `${url}/og-${kind}${testNetwork ? '-test' : ''}.png`;
        const page = `${url}/s/${kind}`;
        let html = base.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
        for (const [attr, key, value] of [
          ['name', 'description', u.description],
          ['rel', 'canonical', page],
          ['property', 'og:type', 'article'],
          ['property', 'og:title', title],
          ['property', 'og:description', u.description],
          ['property', 'og:url', page],
          ['property', 'og:image', image],
          ['property', 'og:image:alt', u.alt],
          ['name', 'twitter:title', title],
          ['name', 'twitter:description', u.description],
          ['name', 'twitter:image', image],
          ['name', 'twitter:image:alt', u.alt],
        ] as const)
          html = setTag(html, attr, key, value);
        this.emitFile({ type: 'asset', fileName: `s/${kind}/index.html`, source: html });
      }
    },
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
    plugins: [react(), siteUrl(url), sharePages(url, (chain || '56') !== '56')],
    // Post-mortems live in ../docs/postmortems and are bundled at build time.
    server: { fs: { allow: ['..'] } },
  };
});

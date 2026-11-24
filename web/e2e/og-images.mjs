// Draws the link-preview images for shared links into public/: og-<kind>.png and og-<kind>-test.png.
// Same drawing code as the in-page share card (src/lib/shareCard.ts), run in a real browser.
// Run: npm run og   (needs network for the Archivo / JetBrains Mono web fonts)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const KINDS = {
  turned: { meta: 'A ROUND WAS BROKEN', outcome: 'turned' },
  held: { meta: 'AN ATTEMPT FAILED', outcome: 'held' },
  'practice-turned': { meta: 'PRACTICE  ·  NO POT', outcome: 'turned' },
  'practice-held': { meta: 'PRACTICE  ·  NO POT', outcome: 'held' },
};
const TEST_LABEL = 'TEST NETWORK · NO REAL VALUE';

const server = await createServer({ root, logLevel: 'error', server: { port: 0 } });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  for (const [kind, spec] of Object.entries(KINDS)) {
    for (const test of [false, true]) {
      const b64 = await page.evaluate(async (s) => {
        const { renderShareCard } = await import('/src/lib/shareCard.ts');
        const blob = await renderShareCard(s);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let bin = '';
        for (const x of bytes) bin += String.fromCharCode(x);
        return btoa(bin);
      }, { ...spec, label: test ? TEST_LABEL : null });
      const file = `public/og-${kind}${test ? '-test' : ''}.png`;
      writeFileSync(new URL(`../${file}`, import.meta.url), Buffer.from(b64, 'base64'));
      console.log('wrote', file);
    }
  }
} finally {
  await browser.close();
  await server.close();
}

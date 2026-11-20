import { config } from '../config';

// Real post-mortems: docs/postmortems/round-<id>.md, bundled at build time.
const real = import.meta.glob('../../../docs/postmortems/round-*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const demo = import.meta.glob('../mock/postmortems/round-*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const byRound = (files: Record<string, string>) => {
  const out = new Map<number, string>();
  for (const [path, body] of Object.entries(files)) {
    const m = /round-(\d+)\.md$/.exec(path);
    if (m) out.set(Number(m[1]), body);
  }
  return out;
};

const table = byRound(config.mock ? demo : real);
export const postmortemFor = (roundId: number) => table.get(roundId);

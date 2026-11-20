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

// Post-mortem zero: pre-launch testing, not a round. Real in every mode (it describes our own tests).
const zero = import.meta.glob('../../../docs/postmortems/000-prelaunch.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
export const prelaunchPostmortem: string | undefined = Object.values(zero)[0];

import type { Round } from '../api/types';

// The service doesn't say which rung is lighter, so order by model family. Unknown models go
// after known ones; ties keep the older round first.
const FAMILIES = ['haiku', 'sonnet', 'opus'];

const weight = (model?: string) => {
  const m = (model ?? '').toLowerCase();
  const i = FAMILIES.findIndex((f) => m.includes(f));
  return i === -1 ? FAMILIES.length : i;
};

/** Live rounds, lighter model first. */
export const ladderOrder = (rounds: Round[]) => rounds.slice().sort((a, b) => weight(a.model) - weight(b.model) || a.id - b.id);

import type { Round } from '../api/types';
import { copy } from '../content/copy';

/** One small tab per live round. Renders nothing when there is only one. */
export function RoundTabs({ rounds, selected, onSelect }: { rounds: Round[]; selected: number; onSelect: (id: number) => void }) {
  if (rounds.length < 2) return null;
  return (
    <div className="round-tabs" role="tablist" aria-label={copy.round.tabsLabel}>
      {rounds.map((r) => (
        <button
          key={r.id}
          type="button"
          role="tab"
          aria-selected={r.id === selected}
          className={r.id === selected ? 'round-tab is-on' : 'round-tab'}
          onClick={() => onSelect(r.id)}
        >
          {copy.round.tab(r)}
        </button>
      ))}
    </div>
  );
}

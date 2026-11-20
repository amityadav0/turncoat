import type { Round } from '../api/types';
import { levelName } from '../content/copy';
import { money, timeLeft } from '../lib/format';
import { useNow } from '../lib/useNow';
import { StatusTag } from './bits';

export function RoundStats({ round }: { round: Round }) {
  const now = useNow();
  const live = round.status === 'live' && round.endTime > now;
  return (
    <section className="round-card" aria-label={`Round ${round.id}`}>
      <div className="round-card-head">
        <span className="eyebrow">
          Round {round.id} · Level {round.level}: {levelName(round.level)}
        </span>
        <StatusTag status={round.status} />
      </div>
      <dl className="stats">
        <div>
          <dt>Pot</dt>
          <dd>{money(round.pot)}</dd>
        </div>
        <div>
          <dt>{live ? 'Time left' : 'Ended'}</dt>
          <dd>{live ? timeLeft(round.endTime, now) : 'Closed to attempts'}</dd>
        </div>
        <div>
          <dt>Attempts</dt>
          <dd>{round.attemptCount.toLocaleString()}</dd>
        </div>
      </dl>
    </section>
  );
}

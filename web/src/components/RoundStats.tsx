import type { Round } from '../api/types';
import { config } from '../config';
import { copy, roundLevelLine } from '../content/copy';
import { money, timeLeft } from '../lib/format';
import { useNow } from '../lib/useNow';
import { Risk, StatusTag } from './bits';

const t = copy.round;

export function RoundStats({ round }: { round: Round }) {
  const now = useNow();
  const live = round.status === 'live' && round.endTime > now;
  return (
    <section className="round-card" aria-label={`Round ${round.id}`}>
      <div className="round-card-head">
        <span className="eyebrow">
          {config.mock && <span className="tag tag-demo">{copy.common.demoTag}</span>} {t.label(round)}
          {round.guardVersion && <> · {t.version(round.guardVersion)}</>}
        </span>
        <StatusTag status={round.status} />
      </div>
      {roundLevelLine(round) && <p className="muted small round-line">{roundLevelLine(round)}</p>}
      <dl className="stats">
        <div>
          <dt>{t.pot}</dt>
          <dd>
            {round.status === 'broken' && round.pot === 0n ? (round.payout !== undefined ? t.paidOutAmount(money(round.payout)) : t.paidOut) : money(round.pot)}
          </dd>
        </div>
        <div>
          <dt>{live ? t.timeLeft : t.ended}</dt>
          <dd>{live ? timeLeft(round.endTime, now) : t.closedToAttempts}</dd>
        </div>
        <div>
          <dt>{t.attempts}</dt>
          <dd>{round.attemptCount.toLocaleString()}</dd>
        </div>
      </dl>
      {round.model && <p className="muted small round-model">{t.model(round.model)}</p>}
      <Risk paidEnabled={round.paidEnabled} />
    </section>
  );
}

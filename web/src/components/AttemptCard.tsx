import { useState } from 'react';
import type { Attempt } from '../api/types';
import { copy } from '../content/copy';
import { explorer } from '../lib/explorer';
import { ago, dateTime } from '../lib/format';
import { BreakKindTag, DecisionTag, Ext, OutcomeTag, Who } from './bits';
import { HostileText } from './HostileText';
import { SharePanel } from './SharePanel';

const t = copy.attempt;

export function AttemptCard({ attempt: a, now, compact }: { attempt: Attempt; now: number; compact?: boolean }) {
  const [sharing, setSharing] = useState(false);
  const answered = a.outcome === 'held' || a.outcome === 'broken';
  return (
    <article id={`attempt-${a.id}`} className={a.outcome === 'broken' ? 'attempt is-broken' : 'attempt'}>
      <header className="attempt-head">
        <span className="mono attempt-id">#{a.id}</span>
        <Who a={a.attacker} />
        <time className="muted" dateTime={new Date(a.time * 1000).toISOString()} title={dateTime(a.time)}>
          {ago(a.time, now)}
        </time>
        <span className="attempt-outcome">
          <BreakKindTag kind={a.breakKind} />
          <OutcomeTag outcome={a.outcome} />
        </span>
      </header>

      {a.message !== undefined && <HostileText label={t.message} text={a.message} limit={compact ? 280 : 1200} />}
      {a.reply !== undefined && <HostileText label={t.reply} aside={<DecisionTag decision={a.decision} />} text={a.reply} limit={compact ? 280 : 1200} />}
      {a.outcome === 'pending' && <p className="muted small">{a.status === 'awaiting_message' ? t.awaiting : t.reading}</p>}
      {a.outcome === 'void' && <p className="muted small">{t.never(a.note)}</p>}

      <footer className="attempt-foot">
        {answered && (
          <button type="button" className="linkish" aria-expanded={sharing} onClick={() => setSharing(!sharing)}>
            {sharing ? t.closeShare : t.share}
          </button>
        )}
        {explorer.tx(a.tx) && <Ext href={explorer.tx(a.tx)}>{t.tx}</Ext>}
      </footer>
      {sharing && answered && <SharePanel roundId={a.roundId} attemptId={a.id} outcome={a.outcome === 'broken' ? 'turned' : 'held'} />}
    </article>
  );
}

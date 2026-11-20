import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Attempt } from '../api';
import { copy } from '../content/copy';
import { ago } from '../lib/format';
import { useNow } from '../lib/useNow';
import { Who } from './bits';
import { HostileText } from './HostileText';

const t = copy.home;
const POLL_MS = 10_000;
const SHOW = 3;

/** The three most recent answered attempts, polled gently, paused while the tab is hidden. */
export function RecentAttempts({ roundId }: { roundId: number }) {
  const [items, setItems] = useState<Attempt[] | null>(null);
  const now = useNow(POLL_MS);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function load() {
      timer = undefined;
      try {
        const all = await api.attempts(roundId);
        if (!alive) return;
        const answered = all.filter((a) => a.outcome === 'held' || a.outcome === 'broken').sort((x, y) => y.id - x.id);
        setItems(answered.slice(0, SHOW));
      } catch {
        // Keep whatever we showed last; the round card already reports connection problems.
      }
      if (alive && !document.hidden) timer = setTimeout(load, POLL_MS);
    }

    function onVisibility() {
      if (document.hidden) {
        clearTimeout(timer);
        timer = undefined;
      } else if (!timer) {
        load();
      }
    }

    load();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [roundId]);

  if (items === null) return null;
  return (
    <section className="recent" aria-label={t.recent}>
      <h3 className="h-small">{t.recent}</h3>
      {items.length === 0 ? (
        <p className="muted small">{t.noneAnswered}</p>
      ) : (
        <ol className="attempts">
          {items.map((a) => (
            <li key={a.id}>
              <article className={a.outcome === 'broken' ? 'attempt attempt-mini is-broken' : 'attempt attempt-mini'}>
                <header className="attempt-head">
                  <Who a={a.attacker} />
                  <span className="muted small">{ago(a.time, now)}</span>
                  <span className="attempt-outcome">
                    <span className={`tag tag-${a.outcome}`}>{a.outcome === 'broken' ? t.outcomeShort.broken : t.outcomeShort.held}</span>
                  </span>
                </header>
                {a.message !== undefined && <HostileText label={copy.attempt.message} text={a.message} lines={2} />}
                {a.reply !== undefined && <HostileText label={copy.attempt.reply} text={a.reply} lines={3} />}
              </article>
            </li>
          ))}
        </ol>
      )}
      <p className="after-card">
        <Link to="/live" className="arrow">
          {t.allAttempts}
        </Link>
      </p>
    </section>
  );
}

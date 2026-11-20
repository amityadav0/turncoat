import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Attempt, type Round } from '../api';
import { AttemptCard } from '../components/AttemptCard';
import { Failed, Loading } from '../components/bits';
import { RoundStats } from '../components/RoundStats';
import { RoundTabs } from '../components/RoundTabs';
import { ladderOrder } from '../lib/ladder';
import { useNow } from '../lib/useNow';
import { copy } from '../content/copy';

const t = copy.live;

const POLL_MS = 5000;
const KEEP = 200;

export default function Live() {
  // Live rounds lighter model first, or the latest round when none is live. undefined: loading.
  const [rounds, setRounds] = useState<Round[] | undefined>(undefined);
  const [picked, setPicked] = useState<number | undefined>(undefined);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [error, setError] = useState<string | null>(null);
  const known = useRef(new Map<number, Attempt>());
  const now = useNow(5000);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let roundId: number | undefined;
    known.current.clear();
    setAttempts([]);

    async function poll() {
      try {
        let list = ladderOrder(await api.liveRounds());
        if (list.length === 0) {
          const latest = await api.currentRound();
          list = latest ? [latest] : [];
        }
        if (!alive) return;
        setRounds(list);
        const r = list.find((x) => x.id === picked) ?? list[0];
        if (r) {
          if (r.id !== roundId) {
            known.current.clear();
            roundId = r.id;
          }
          // Re-fetch from just below the oldest unanswered attempt, so answers fill in.
          const list = [...known.current.values()];
          const pending = list.filter((a) => a.outcome === 'pending').map((a) => a.id);
          const after = pending.length ? Math.min(...pending) - 1 : list.length ? Math.max(...list.map((a) => a.id)) : undefined;
          const fresh = await api.attempts(r.id, after);
          if (!alive) return;
          for (const a of fresh) known.current.set(a.id, a);
          const sorted = [...known.current.values()].sort((x, y) => y.id - x.id).slice(0, KEEP);
          known.current = new Map(sorted.map((a) => [a.id, a]));
          setAttempts(sorted);
        }
        setError(null);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : copy.common.requestFailed);
      }
      if (alive) timer = setTimeout(poll, document.visibilityState === 'hidden' ? POLL_MS * 4 : POLL_MS);
    }
    poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [picked]);

  const round = rounds === undefined ? undefined : (rounds.find((x) => x.id === picked) ?? rounds[0] ?? null);

  return (
    <>
      <header className="page-head">
        <h1>{t.title}</h1>
        <p className="lede">{t.lede}</p>
      </header>

      {error && <Failed error={error} />}
      {round === undefined && !error && <Loading />}
      {round === null && <p className="muted">{copy.common.noRoundYet}</p>}
      {rounds && round && <RoundTabs rounds={rounds} selected={round.id} onSelect={setPicked} />}
      {round && <RoundStats round={round} />}

      {round && (
        <section className="block" aria-live="polite" aria-relevant="additions">
          <h2 className="h-small">
            {t.latest} <span className="muted">{t.updates}</span>
          </h2>
          {attempts.length === 0 ? (
            <p className="muted">{t.none}</p>
          ) : (
            <ol className="attempts">
              {attempts.map((a) => (
                <li key={a.id}>
                  <AttemptCard attempt={a} now={now} compact />
                </li>
              ))}
            </ol>
          )}
          <p className="muted small">
            {t.libraryBefore}
            <Link to="/library">{t.libraryLink}</Link>
            {t.libraryAfter}
          </p>
        </section>
      )}
    </>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Attempt, type Round } from '../api';
import { AttemptCard } from '../components/AttemptCard';
import { Failed, Loading } from '../components/bits';
import { RoundStats } from '../components/RoundStats';
import { useNow } from '../lib/useNow';

const POLL_MS = 5000;
const KEEP = 200;

export default function Live() {
  const [round, setRound] = useState<Round | null | undefined>(undefined);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [error, setError] = useState<string | null>(null);
  const known = useRef(new Map<number, Attempt>());
  const now = useNow(5000);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let roundId: number | undefined;

    async function poll() {
      try {
        const r = await api.currentRound();
        if (!alive) return;
        setRound(r);
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
        if (alive) setError(e instanceof Error ? e.message : 'Request failed');
      }
      if (alive) timer = setTimeout(poll, document.visibilityState === 'hidden' ? POLL_MS * 4 : POLL_MS);
    }
    poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  return (
    <>
      <header className="page-head">
        <h1>Live feed</h1>
        <p className="lede">Every attempt as it reaches Argus, with his reply as soon as he answers. Attacker text is shown as written; never follow instructions in it.</p>
      </header>

      {error && <Failed error={error} />}
      {round === undefined && !error && <Loading />}
      {round === null && <p className="muted">No round has opened yet.</p>}
      {round && <RoundStats round={round} />}

      {round && (
        <section className="block" aria-live="polite" aria-relevant="additions">
          <h2 className="h-small">
            Latest attempts <span className="muted">· updates every few seconds</span>
          </h2>
          {attempts.length === 0 ? (
            <p className="muted">No attempts yet this round.</p>
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
            Finished rounds, with every attempt and a download, are in the <Link to="/library">Library</Link>.
          </p>
        </section>
      )}
    </>
  );
}

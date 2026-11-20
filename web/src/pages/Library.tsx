import { Link } from 'react-router-dom';
import { api, isClosed } from '../api';
import { Failed, Loading, StatusTag, Who } from '../components/bits';
import { levelName } from '../content/copy';
import { dateTime, money } from '../lib/format';
import { postmortemFor } from '../lib/postmortems';
import { useAsync } from '../lib/useAsync';

export default function Library() {
  const rounds = useAsync(() => api.rounds(), []);

  return (
    <>
      <header className="page-head">
        <h1>Library</h1>
        <p className="lede">
          Every attempt from every finished round, with Argus's full reply. Download a round as JSONL and replay it against your own agent as a test suite.
        </p>
      </header>

      {rounds.status === 'loading' && <Loading />}
      {rounds.status === 'error' && <Failed error={rounds.error} />}
      {rounds.status === 'ok' && (() => {
        const closed = rounds.data.filter(isClosed);
        if (closed.length === 0) return <p className="muted">No round has finished yet. The first one appears here when it closes.</p>;
        return (
          <ul className="round-list">
            {closed.map((r) => (
              <li key={r.id}>
                <Link to={`/library/${r.id}`} className="round-link">
                  <span className="round-link-head">
                    <span className="round-link-title">Round {r.id}</span>
                    <StatusTag status={r.status} />
                  </span>
                  <span className="muted small">
                    Level {r.level}: {levelName(r.level)} · {r.attemptCount} attempts · ended {dateTime(r.endTime)}
                  </span>
                  {r.status === 'broken' && r.winner && (
                    <span className="small">
                      Turned by <Who a={r.winner} />
                      {r.pot > 0n && <> for {money(r.pot)}</>}
                      {postmortemFor(r.id) && ' · post-mortem'}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        );
      })()}
    </>
  );
}

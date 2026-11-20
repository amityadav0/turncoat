import { Link } from 'react-router-dom';
import { api, isClosed } from '../api';
import { Failed, Loading, StatusTag, Who } from '../components/bits';
import { copy } from '../content/copy';

const t = copy.library;
import { dateTime } from '../lib/format';
import { postmortemFor, prelaunchPostmortem } from '../lib/postmortems';
import { useAsync } from '../lib/useAsync';

export default function Library() {
  const rounds = useAsync(() => api.rounds(), []);

  return (
    <>
      <header className="page-head">
        <h1>{t.title}</h1>
        <p className="lede">{t.lede}</p>
      </header>

      {rounds.status === 'loading' && <Loading />}
      {rounds.status === 'error' && <Failed error={rounds.error} />}
      {prelaunchPostmortem && (
        <ul className="round-list round-list-pre">
          <li className="round-item round-item-pre">
            <span className="round-link-head">
              <Link to="/library/prelaunch" className="round-link-title">
                {t.prelaunchTitle}
              </Link>
              <span className="tag tag-prelaunch">{t.prelaunchTag}</span>
              <span className="muted small">{copy.round.version(1)}</span>
            </span>
            <span className="muted small">{t.prelaunchText}</span>
          </li>
        </ul>
      )}

      {rounds.status === 'ok' && (() => {
        const closed = rounds.data.filter(isClosed);
        if (closed.length === 0) return <p className="muted">{t.none}</p>;
        return (
          <ul className="round-list">
            {closed.map((r) => (
              <li key={r.id} className="round-item">
                <span className="round-link-head">
                  <Link to={`/library/${r.id}`} className="round-link-title">
                    {copy.fairness.roundN(r.id)}
                  </Link>
                  <StatusTag status={r.status} />
                  {r.guardVersion && <span className="muted small">{copy.round.version(r.guardVersion)}</span>}
                </span>
                <span className="muted small">{t.summary(r, r.attemptCount, dateTime(r.startTime))}</span>
                {r.status === 'broken' && r.winner && (
                  <span className="small">
                    {t.turnedBy} <Who a={r.winner} />
                    {r.guardVersion && <> · {t.fixedIn(r.guardVersion + 1)}</>}
                    {postmortemFor(r.id) && (
                      <>
                        {' · '}
                        <Link to={`/library/${r.id}#pm`}>{t.readPostmortem}</Link>
                      </>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
        );
      })()}
    </>
  );
}

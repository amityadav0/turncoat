import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { Ext, Failed, Loading } from '../components/bits';
import { copy } from '../content/copy';
import { explorer } from '../lib/explorer';
import { dateTime } from '../lib/format';
import { useAsync } from '../lib/useAsync';

const t = copy.attacker;

const resultOf = (h: { status: string; broken?: boolean }) =>
  h.broken === true ? 'turned' : h.broken === false ? 'held' : h.status === 'awaiting_message' ? 'waiting' : h.status in t.result ? h.status : 'judging';

/** /attacker/:address: the tester record README promises "under your .ai name". */
export default function Attacker() {
  const { address = '' } = useParams();
  const valid = /^0x[0-9a-fA-F]{40}$/.test(address);
  const rec = useAsync(() => (valid ? api.attacker(address) : Promise.reject(new Error(t.notFound))), [address]);
  if (!valid) return <p className="notice">{t.badAddress}</p>;
  if (rec.status === 'loading') return <Loading />;
  if (rec.status === 'error') return <Failed error={rec.error} />;
  const { attacker, attempts, breaks, history } = rec.data;
  const rounds = new Set(history.map((h) => h.roundId)).size;
  const rows = history.slice().sort((a, b) => b.time - a.time);
  return (
    <>
      <header className="page-head">
        <p className="eyebrow">{t.title}</p>
        <h1 className={attacker.name ? undefined : 'mono h-addr'}>{attacker.name ?? attacker.address}</h1>
        <p className="lede">{t.lede}</p>
        <p className="small">
          {t.wallet}:{' '}
          {explorer.address(attacker.address) ? (
            <Ext href={explorer.address(attacker.address)}>
              <code className="hash">{attacker.address}</code>
            </Ext>
          ) : (
            <code className="hash">{attacker.address}</code>
          )}
        </p>
      </header>
      <dl className="stats attacker-stats">
        <div>
          <dt>{t.attempts}</dt>
          <dd>{attempts}</dd>
        </div>
        <div>
          <dt>{t.breaks}</dt>
          <dd>{breaks}</dd>
        </div>
        <div>
          <dt>{t.rounds}</dt>
          <dd>{rounds}</dd>
        </div>
      </dl>
      <section className="block">
        <h2 className="h-small">{t.history}</h2>
        {rows.length === 0 ? (
          <p className="muted">{t.none}</p>
        ) : (
          <ul className="link-list attacker-history">
            {rows.map((h) => {
              const res = resultOf(h);
              return (
                <li key={`${h.roundId}-${h.attemptId}`}>
                  <Link to={`/library/${h.roundId}#attempt-${h.attemptId}`}>{t.row(h.roundId, h.attemptId)}</Link>
                  <span>
                    <span className={`tag tag-${res === 'turned' ? 'broken' : res === 'held' ? 'held' : 'void'}`}>{t.result[res]}</span>{' '}
                    <span className="muted small">
                      {dateTime(h.time)} · {h.paid ? t.paid : t.free}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

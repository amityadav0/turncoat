import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api, isClosed, type RoundDetail } from '../api';
import { AttemptCard } from '../components/AttemptCard';
import { Ext, Failed, Loading, StatusTag, Who } from '../components/bits';
import { levelName } from '../content/copy';
import { explorer } from '../lib/explorer';
import { dateTime, money } from '../lib/format';
import { postmortemFor } from '../lib/postmortems';
import { useAsync } from '../lib/useAsync';
import { useNow } from '../lib/useNow';

function downloadJsonl(d: RoundDetail) {
  const lines = d.attempts.map((a) =>
    JSON.stringify({
      round: a.roundId,
      level: d.round.level,
      attempt: a.id,
      attacker: a.attacker.address,
      name: a.attacker.name ?? null,
      time: new Date(a.time * 1000).toISOString(),
      outcome: a.outcome,
      messageHash: a.messageHash,
      tx: a.tx ?? null,
      message: a.message ?? null,
      reply: a.reply ?? null,
    }),
  );
  const blob = new Blob([lines.join('\n') + '\n'], { type: 'application/x-ndjson' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `turncoat-round-${d.round.id}.jsonl`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function LibraryRound() {
  const id = Number(useParams().id);
  const valid = Number.isSafeInteger(id) && id > 0;
  const detail = useAsync(() => (valid ? api.round(id) : Promise.reject(new Error('No such round'))), [id]);
  const [onlyBroken, setOnlyBroken] = useState(false);
  const now = useNow(60000);
  const { hash } = useLocation();

  // Shared links point at #attempt-N: scroll there once the attempts have rendered.
  useEffect(() => {
    if (detail.status === 'ok' && hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [detail.status, hash]);

  if (detail.status === 'loading') return <Loading />;
  if (detail.status === 'error') return <Failed error={detail.error} />;

  const { round: r, attempts } = detail.data;
  const closed = isClosed(r);
  const pm = postmortemFor(r.id);
  const shown = (onlyBroken ? attempts.filter((a) => a.outcome === 'broken') : attempts).slice().sort((a, b) => b.id - a.id);

  return (
    <>
      <p className="crumb">
        <Link to="/library">← Library</Link>
      </p>
      <header className="page-head">
        <h1>Round {r.id}</h1>
        <p className="lede">
          <StatusTag status={r.status} /> Level {r.level}: {levelName(r.level)} · {dateTime(r.startTime)} to {dateTime(r.endTime)}
        </p>
        {r.status === 'broken' && r.winner && (
          <p>
            Turned on attempt #{r.winningAttempt} by <Who a={r.winner} />
            {r.pot > 0n && <>, who received {money(r.pot)}</>}. <Ext href={explorer.tx(r.settleTx)} missing={null}>Payout transaction</Ext>
          </p>
        )}
        {r.status === 'held' && <p>Nobody turned Argus. The pot rolled into the reserve for later rounds.</p>}
        {!closed && <p className="muted">This round is still open. Attempts so far are below; the full set is final when it closes.</p>}
      </header>

      <div className="toolbar">
        <button type="button" className="btn" onClick={() => downloadJsonl(detail.data)} disabled={attempts.length === 0}>
          Download as JSONL{!closed && ' (so far)'}
        </button>
        <Link to="/fairness" className="arrow">Check this round's fairness</Link>
      </div>

      {r.status === 'broken' && (
        <section className="block postmortem" aria-labelledby="pm">
          <h2 id="pm">Post-mortem</h2>
          {pm ? (
            <div className="prose">
              <Markdown
                skipHtml
                components={{
                  a: ({ href, children }) => (
                    <a href={href} target="_blank" rel="noopener noreferrer nofollow">
                      {children}
                    </a>
                  ),
                }}
              >
                {pm}
              </Markdown>
            </div>
          ) : (
            <p className="muted">The post-mortem for this break is being written.</p>
          )}
        </section>
      )}

      <section className="block">
        <div className="section-head">
          <h2 className="h-small">
            {attempts.length} attempt{attempts.length === 1 ? '' : 's'}
          </h2>
          <label className="check">
            <input type="checkbox" checked={onlyBroken} onChange={(e) => setOnlyBroken(e.target.checked)} /> Only breaks
          </label>
        </div>
        {shown.length === 0 ? (
          <p className="muted">Nothing to show.</p>
        ) : (
          <ol className="attempts">
            {shown.map((a) => (
              <li key={a.id}>
                <AttemptCard attempt={a} now={now} />
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

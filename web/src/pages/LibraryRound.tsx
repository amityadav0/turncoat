import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api, isClosed, type RoundDetail } from '../api';
import { AttemptCard } from '../components/AttemptCard';
import { Ext, Failed, Loading, Risk, StatusTag, Who } from '../components/bits';
import { Postmortem } from '../components/Postmortem';
import { copy, roundLevelLine } from '../content/copy';

const t = copy.library;
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
      breakKind: a.breakKind ?? null,
      decision: a.decision ?? null,
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
  const detail = useAsync(() => (valid ? api.round(id) : Promise.reject(new Error(copy.common.noSuchRound))), [id]);
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
  // After a payout the contract's pot is 0; the amount paid comes from `payout` when the service sends it.
  const paid = r.payout ?? (r.pot > 0n ? r.pot : undefined);
  const shown = (onlyBroken ? attempts.filter((a) => a.outcome === 'broken') : attempts).slice().sort((a, b) => b.id - a.id);

  return (
    <>
      <p className="crumb">
        <Link to="/library">{t.back}</Link>
      </p>
      <header className="page-head">
        <h1>{copy.fairness.roundN(r.id)}</h1>
        <p className="lede">
          <StatusTag status={r.status} />{' '}
          {r.closedAt !== undefined
            ? t.closedOn(r, dateTime(r.startTime), dateTime(r.closedAt))
            : r.status === 'broken' && r.endTime > now
              ? t.closedEarly(r, dateTime(r.startTime))
              : t.range(r, dateTime(r.startTime), dateTime(r.endTime))}
          {r.guardVersion && <> · {copy.round.version(r.guardVersion)}</>}
        </p>
        {r.status === 'broken' && r.winner && (
          <>
            <p>
              {t.turnedOn(r.winningAttempt)} <Who a={r.winner} />.{' '}
              {paid !== undefined && paid > 0n && t.potPaid(money(paid))}{' '}
              <Ext href={explorer.tx(r.settleTx)} missing={null}>
                {t.payoutTx}
              </Ext>
            </p>
            <p>
              {r.guardVersion && <strong>{t.fixedIn(r.guardVersion + 1)}.</strong>}{' '}
              {pm && <a href="#pm">{t.readPostmortem}</a>}
            </p>
            {paid !== undefined && paid > 0n && <Risk paidEnabled={r.paidEnabled} />}
          </>
        )}
        {roundLevelLine(r) && <p className="muted">{roundLevelLine(r)}</p>}
        {attempts.some((a) => a.breakKind) && <p className="muted small">{t.breakKinds}</p>}
        {r.status === 'held' && <p>{t.heldText}</p>}
        {!closed && <p className="muted">{t.openText}</p>}
      </header>

      <div className="toolbar">
        <button type="button" className="btn" onClick={() => downloadJsonl(detail.data)} disabled={attempts.length === 0}>
          {t.download}
          {!closed && t.soFar}
        </button>
        <Link to="/fairness" className="arrow">
          {t.checkFairness}
        </Link>
      </div>

      {r.status === 'broken' && (
        <section className="block postmortem" aria-labelledby="pm">
          <h2 id="pm">{t.postmortem}</h2>
          {pm ? (
            <Postmortem text={pm} />
          ) : (
            <p className="muted">{t.postmortemPending}</p>
          )}
        </section>
      )}

      <section className="block">
        <div className="section-head">
          <h2 className="h-small">{t.count(attempts.length)}</h2>
          <label className="check">
            <input type="checkbox" checked={onlyBroken} onChange={(e) => setOnlyBroken(e.target.checked)} /> {t.onlyBreaks}
          </label>
        </div>
        {shown.length === 0 ? (
          <p className="muted">{t.nothing}</p>
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

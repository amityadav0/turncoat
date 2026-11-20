import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Hex } from 'viem';
import { api, isClosed, type Round } from '../api';
import { Ext, Failed, Hash, Loading, StatusTag } from '../components/bits';
import { config } from '../config';
import { explorer } from '../lib/explorer';
import { canReadChain, commitOf, instructionsText, onChainCommit } from '../lib/fairness';
import { useAsync } from '../lib/useAsync';
import { copy } from '../content/copy';

const t = copy.fairness;

export default function Fairness() {
  const rounds = useAsync(() => api.rounds(), []);
  const links = { code: explorer.code(), events: explorer.events(), read: explorer.read() };

  return (
    <>
      <header className="page-head">
        <h1>{t.title}</h1>
        <p className="lede">{t.lede}</p>
      </header>

      <section className="block">
        {!config.contract && <p className="notice notice-plain small">{t.notDeployed}</p>}
        <ol className="claims">
          {t.claims.map((c) => (
            <li key={c.strong}>
              <strong>{c.strong}</strong> {c.text}{' '}
              <Ext href={links[c.target]} missing={null}>
                {c.link}
              </Ext>
            </li>
          ))}
        </ol>
        <p className="muted small">
          {t.trustBefore}
          <Link to="/library">{t.trustLink}</Link>
          {t.trustAfter}
        </p>
      </section>

      <section className="block">
        <h2 className="h-small">{t.rounds}</h2>
        {!canReadChain && <p className="muted small">{t.fromService}</p>}
        {rounds.status === 'loading' && <Loading />}
        {rounds.status === 'error' && <Failed error={rounds.error} />}
        {rounds.status === 'ok' &&
          (rounds.data.length === 0 ? (
            <p className="muted">{copy.common.noRoundYet}</p>
          ) : (
            <ol className="fair-list">
              {rounds.data.map((r) => (
                <li key={r.id}>
                  <FairRound round={r} />
                </li>
              ))}
            </ol>
          ))}
      </section>
    </>
  );
}

type Check = { state: 'idle' | 'checking' } | { state: 'done'; computed: Hex; match: boolean; text: string; tx?: Hex };

function FairRound({ round: r }: { round: Round }) {
  const closed = isClosed(r);
  const [chain, setChain] = useState<{ value?: Hex; error?: string }>({});
  const [check, setCheck] = useState<Check>({ state: 'idle' });
  const [noReveal, setNoReveal] = useState(false);

  useEffect(() => {
    if (!canReadChain) return;
    onChainCommit(r.id).then(
      (value) => setChain({ value }),
      () => setChain({ error: t.chainError }),
    );
  }, [r.id]);

  // The commit the check compares against: the contract's own value when we can read it.
  const commit = chain.value ?? r.guardCommit;
  const apiDisagrees = chain.value !== undefined && chain.value.toLowerCase() !== r.guardCommit.toLowerCase();

  useEffect(() => {
    if (!closed) return;
    let alive = true;
    setCheck({ state: 'checking' });
    api.round(r.id).then(
      (d) => {
        if (!alive) return;
        if (!d.reveal) {
          setNoReveal(true);
          setCheck({ state: 'idle' });
          return;
        }
        const computed = commitOf(d.reveal.salt, d.reveal.instructions);
        setCheck({
          state: 'done',
          computed,
          match: computed.toLowerCase() === commit.toLowerCase(),
          text: instructionsText(d.reveal.instructions),
          tx: d.reveal.tx,
        });
      },
      () => alive && setCheck({ state: 'idle' }),
    );
    return () => {
      alive = false;
    };
  }, [r.id, closed, commit]);

  return (
    <article className="fair">
      <header className="fair-head">
        <span className="round-link-title">{t.roundN(r.id)}</span>
        <StatusTag status={r.status} />
        {r.guardVersion && <span className="muted small">{copy.round.version(r.guardVersion)}</span>}
        {r.model && <span className="muted small">{copy.round.model(r.model)}</span>}
      </header>

      <dl className="kv">
        <dt>{chain.value ? t.commitFromChain : t.commitFromService}</dt>
        <dd>
          <Hash value={commit} />
          <div className="small">
            <Ext href={explorer.tx(r.openTx)} missing={null}>
              {t.openTx}
            </Ext>
          </div>
        </dd>
        {chain.error && (
          <dd className="muted small">{chain.error}</dd>
        )}
        {apiDisagrees && (
          <dd className="notice" role="alert">
            {t.disagree(r.guardCommit)}
          </dd>
        )}
      </dl>

      {!closed && <p className="muted small">{t.sealed}</p>}
      {closed && check.state === 'checking' && <p className="muted small">{t.checking}</p>}
      {closed && noReveal && <p className="muted small">{t.notRevealed}</p>}
      {check.state === 'done' && (
        <>
          <div className={check.match ? 'check-result ok' : 'check-result bad'} role="status">
            {check.match ? t.match : t.mismatch}
          </div>
          <dl className="kv">
            <dt>{t.computed}</dt>
            <dd>
              <Hash value={check.computed} />
            </dd>
          </dl>
          <details className="reveal">
            <summary>{t.read}</summary>
            <pre className="instructions">{check.text}</pre>
            <p className="small">
              <Ext href={explorer.tx(check.tx)} missing={null}>
                {t.revealTx}
              </Ext>
            </p>
          </details>
        </>
      )}
    </article>
  );
}

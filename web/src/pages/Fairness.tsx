import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Hex } from 'viem';
import { api, isClosed, type Round } from '../api';
import { Ext, Failed, Hash, Loading, StatusTag } from '../components/bits';
import { config } from '../config';
import { explorer } from '../lib/explorer';
import { canReadChain, commitOf, onChainCommit, parseCommitted, type Committed } from '../lib/fairness';
import { useAsync } from '../lib/useAsync';
import { copy, MODES } from '../content/copy';

const t = copy.fairness;

export default function Fairness() {
  const rounds = useAsync(() => api.rounds(), []);
  const links = { code: explorer.code(), events: explorer.events(), read: explorer.read(), levels: config.levelsUrl };

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

type Check = { state: 'idle' | 'checking' } | { state: 'done'; computed: Hex; match: boolean; committed: Committed; tx?: Hex; source?: 'chain' | 'service' };

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
          committed: parseCommitted(d.reveal.instructions),
          tx: d.reveal.tx,
          source: d.reveal.source,
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
        {r.signer && (
          <>
            <dt>{t.signer}</dt>
            <dd>
              <a href={explorer.address(r.signer)} target="_blank" rel="noopener noreferrer" className="hash">
                {r.signer}
              </a>
              <div className="muted small">{t.signerNote}</div>
            </dd>
          </>
        )}
        {chain.error && (
          <dd className="muted small">{chain.error}</dd>
        )}
        {apiDisagrees && (
          <dd className="notice" role="alert">
            {t.disagree(r.guardCommit)}
          </dd>
        )}
      </dl>

      {!closed && <p className="muted small">{t.beforeReveal}</p>}
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
          {check.source === 'service' && <p className="muted small">{t.fromServiceRecord}</p>}
          {check.source !== 'service' && explorer.tx(check.tx) && (
            <p className="small">
              {check.source === 'chain' && <>{t.fromChain} · </>}
              <Ext href={explorer.tx(check.tx)}>{t.revealTx}</Ext>
            </p>
          )}
          {check.source === 'chain' && !explorer.tx(check.tx) && <p className="muted small">{t.fromChain}</p>}
          {check.match && <CommitFacts committed={check.committed} round={r} />}
          <details className="reveal">
            <summary>{t.read}</summary>
            <pre className="instructions">{check.committed.kind === 'notUtf8' ? t.badUtf8 : check.committed.text}</pre>
          </details>
        </>
      )}
    </article>
  );
}

/** What the header pins down. Shown only when the hash matched, since otherwise the header proves nothing. */
function CommitFacts({ committed: c, round: r }: { committed: Committed; round: Round }) {
  if (c.kind === 'plain') return <p className="muted small">{t.noHeader}</p>;
  if (c.kind === 'badHeader') return <p className="notice small">{t.badHeader}</p>;
  if (c.kind !== 'header') return null;
  const h = c.header;
  return (
    <div className="fixed">
      <h3 className="h-small">{t.fixed}</h3>
      <dl className="kv">
        <dt>{t.fixedModel}</dt>
        <dd>
          <code>{h.model}</code>
        </dd>
        <dt>{t.fixedMode}</dt>
        <dd>
          {MODES[h.mode]?.name ?? h.mode} <span className="muted small">({h.mode})</span>
        </dd>
        <dt>{t.fixedVersion}</dt>
        <dd>{h.version}</dd>
        <dt>{t.fixedMaxTurns}</dt>
        <dd>{h.maxTurns}</dd>
        <dt>{t.fixedTools}</dt>
        <dd>
          <Hash value={h.toolsHash} />
          <div className="muted small">{t.fixedToolsNote}</div>
        </dd>
      </dl>
      <p className="muted small">{t.fixedNote}</p>
      {r.model && r.model !== h.model && (
        <p className="notice" role="alert">
          {t.modelDiffers(r.model, h.model)}
        </p>
      )}
    </div>
  );
}

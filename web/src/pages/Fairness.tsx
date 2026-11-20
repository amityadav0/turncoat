import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Hex } from 'viem';
import { api, isClosed, type Round } from '../api';
import { Ext, Failed, Hash, Loading, StatusTag } from '../components/bits';
import { config } from '../config';
import { explorer } from '../lib/explorer';
import { canReadChain, commitOf, instructionsText, onChainCommit } from '../lib/fairness';
import { useAsync } from '../lib/useAsync';

export default function Fairness() {
  const rounds = useAsync(() => api.rounds(), []);

  return (
    <>
      <header className="page-head">
        <h1>Fairness</h1>
        <p className="lede">How you can check a round wasn't rigged, without trusting us.</p>
      </header>

      <section className="block">
        {!config.contract && (
          <p className="notice notice-plain small">The contract is not deployed yet. Every claim below links to it on BscScan once it is.</p>
        )}
        <ol className="claims">
          <li>
            <strong>Argus's instructions are committed before the round.</strong> When a round opens, the contract stores <code>guardCommit</code>, the keccak256 hash of a secret salt followed by the instructions. It cannot change after that.{' '}
            <Ext href={explorer.code()} missing={null}>Contract source</Ext>
          </li>
          <li>
            <strong>They are revealed when the round ends.</strong> The contract's <code>revealGuard</code> only accepts text that matches the commit, and emits it in a <code>GuardRevealed</code> event. Below, your browser recomputes the hash too. <Ext href={explorer.events()} missing={null}>Contract events</Ext>
          </li>
          <li>
            <strong>Every attempt is on-chain.</strong> Each attempt's message hash is stored in its transaction, so no message can be added, removed or edited later. <Ext href={explorer.events()} missing={null}>Attempted events</Ext>
          </li>
          <li>
            <strong>The pot is locked in the contract.</strong> The owner cannot withdraw it. It leaves only to an attacker with a valid break, or rolls into the reserve. <Ext href={explorer.read()} missing={null}>Read the contract</Ext>
          </li>
        </ol>
        <p className="muted small">
          What you still have to trust: that the guard service ran the committed instructions honestly during the round. The published transcripts in the <Link to="/library">Library</Link> make cheating visible afterwards; they do not make it impossible.
        </p>
      </section>

      <section className="block">
        <h2 className="h-small">Rounds</h2>
        {!canReadChain && (
          <p className="muted small">
            Commits below come from the guard service. Compare them with <code>getRound</code> on BscScan, or set an RPC URL so this page reads them from the contract directly.
          </p>
        )}
        {rounds.status === 'loading' && <Loading />}
        {rounds.status === 'error' && <Failed error={rounds.error} />}
        {rounds.status === 'ok' &&
          (rounds.data.length === 0 ? (
            <p className="muted">No round has opened yet.</p>
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
      () => setChain({ error: 'Could not read the contract' }),
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
        <span className="round-link-title">Round {r.id}</span>
        <StatusTag status={r.status} />
      </header>

      <dl className="kv">
        <dt>guardCommit {chain.value ? '(read from the contract)' : '(from the guard service)'}</dt>
        <dd>
          <Hash value={commit} />
          <div className="small">
            <Ext href={explorer.tx(r.openTx)} missing={null}>RoundOpened transaction</Ext>
          </div>
        </dd>
        {chain.error && (
          <dd className="muted small">{chain.error}; showing the guard service's value.</dd>
        )}
        {apiDisagrees && (
          <dd className="notice" role="alert">
            The guard service reports a different commit ({r.guardCommit}). The contract's value is the one that counts.
          </dd>
        )}
      </dl>

      {!closed && <p className="muted small">Instructions stay sealed until the round ends.</p>}
      {closed && check.state === 'checking' && <p className="muted small">Checking the reveal…</p>}
      {closed && noReveal && <p className="muted small">The instructions for this round have not been revealed yet.</p>}
      {check.state === 'done' && (
        <>
          <div className={check.match ? 'check-result ok' : 'check-result bad'} role="status">
            {check.match ? 'Match. The revealed instructions hash to the commit.' : 'Mismatch. The revealed instructions do not hash to the commit.'}
          </div>
          <dl className="kv">
            <dt>keccak256(salt ‖ instructions), computed in your browser</dt>
            <dd>
              <Hash value={check.computed} />
            </dd>
          </dl>
          <details className="reveal">
            <summary>Read the revealed instructions</summary>
            <pre className="instructions">{check.text}</pre>
            <p className="small">
              <Ext href={explorer.tx(check.tx)} missing={null}>GuardRevealed transaction</Ext>
            </p>
          </details>
        </>
      )}
    </article>
  );
}

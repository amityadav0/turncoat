import { Link } from 'react-router-dom';
import logo from '../../../assets/logo.svg';
import { api } from '../api';
import { Failed, Loading } from '../components/bits';
import { RoundStats } from '../components/RoundStats';
import { ClaimAgentId } from '../components/ClaimAgentId';
import { ONE_LINE, STORY } from '../content/copy';
import { useAsync } from '../lib/useAsync';

export default function Home() {
  const current = useAsync(() => api.currentRound(), []);

  return (
    <>
      <section className="hero">
        <img src={logo} alt="Turncoat: a half-closed eye with a keyhole for a pupil" className="hero-logo" width="112" height="112" />
        <h1>{ONE_LINE}</h1>
        <div className="hero-cta">
          <Link to="/practice" className="btn btn-primary btn-wide">
            Practice against Argus
          </Link>
          <p className="muted small">Free. No wallet, no sign-in.</p>
        </div>
        <div className="story">
          {STORY.map((s) => (
            <p key={s}>{s}</p>
          ))}
        </div>
      </section>

      <section className="block">
        <h2 className="h-small">The live round</h2>
        {current.status === 'loading' && <Loading />}
        {current.status === 'error' && <Failed error={current.error} />}
        {current.status === 'ok' &&
          (current.data ? (
            <>
              <RoundStats round={current.data} />
              <p className="after-card">
                <Link to="/live" className="arrow">Watch attempts arrive</Link>
              </p>
            </>
          ) : (
            <p className="muted">No round has opened yet.</p>
          ))}
      </section>

      <section className="block how">
        <ClaimAgentId heading="How to try for the pot" />
        <p className="muted small">
          This site never asks you to connect a wallet, sign in or scan a code. If a page claiming to be Turncoat does, it is not us.
        </p>
      </section>

      <section className="block">
        <h2 className="h-small">What comes out of it</h2>
        <ul className="link-list">
          <li>
            <Link to="/live">Live feed</Link>
            <span>Every attempt and Argus's reply, as it happens.</span>
          </li>
          <li>
            <Link to="/library">Library</Link>
            <span>Every attempt from every finished round, with Argus's reply. Download it and replay it against your own agent.</span>
          </li>
          <li>
            <Link to="/fairness">Fairness</Link>
            <span>Argus's instructions are committed on-chain before each round. Check the hash yourself after it ends.</span>
          </li>
        </ul>
      </section>
    </>
  );
}

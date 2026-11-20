import { Link } from 'react-router-dom';
import logo from '../../../assets/logo.svg';
import { api } from '../api';
import { Failed, Loading } from '../components/bits';
import { ClaimAgentId } from '../components/ClaimAgentId';
import { RoundStats } from '../components/RoundStats';
import { copy, ONE_LINE, STORY } from '../content/copy';
import { useAsync } from '../lib/useAsync';

const t = copy.home;

export default function Home() {
  const current = useAsync(() => api.currentRound(), []);

  return (
    <>
      <section className="hero">
        <img src={logo} alt={t.logoAlt} className="hero-logo" width="56" height="56" />
        <h1>{ONE_LINE}</h1>
        <p className="hero-argus">{t.argus}</p>
        <div className="hero-cta">
          <Link to="/practice" state={{ start: true }} className="btn btn-primary btn-wide">
            {t.practiceCta}
          </Link>
          <p className="muted small">{t.practiceNote}</p>
        </div>
        <div className="story">
          {STORY.map((s) => (
            <p key={s}>{s}</p>
          ))}
        </div>
      </section>

      <section className="block">
        <h2 className="h-small">{t.liveRound}</h2>
        {current.status === 'loading' && <Loading />}
        {current.status === 'error' && <Failed error={current.error} />}
        {current.status === 'ok' &&
          (current.data ? (
            <>
              <RoundStats round={current.data} />
              <p className="after-card">
                <Link to="/live" className="arrow">
                  {t.watch}
                </Link>
              </p>
            </>
          ) : (
            <p className="muted">{copy.common.noRoundYet}</p>
          ))}
      </section>

      <section className="block learns" aria-labelledby="learns">
        <h2 id="learns" className="h-small">
          {t.learnsHeading}
        </h2>
        {t.learns.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </section>

      <section className="block how">
        <ClaimAgentId heading={t.howHeading} />
        <p className="muted small">{t.noPhishing}</p>
      </section>

      <section className="block">
        <h2 className="h-small">{t.outputs}</h2>
        <ul className="link-list">
          {t.links.map((l) => (
            <li key={l.to}>
              <Link to={l.to}>{l.label}</Link>
              <span>{l.text}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

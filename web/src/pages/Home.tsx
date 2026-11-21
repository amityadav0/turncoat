import { Link } from 'react-router-dom';
import logo from '../../../assets/logo.svg';
import { api } from '../api';
import { Failed, Loading } from '../components/bits';
import { ClaimAgentId } from '../components/ClaimAgentId';
import { RecentAttempts } from '../components/RecentAttempts';
import { RoundStats } from '../components/RoundStats';
import { copy, ONE_LINE, STORY } from '../content/copy';
import { ladderOrder } from '../lib/ladder';
import { prelaunchPostmortem } from '../lib/postmortems';
import { useAsync } from '../lib/useAsync';

const t = copy.home;

export default function Home() {
  // Every live round (the ladder), lighter model first; the latest round when none is live.
  const current = useAsync(async () => {
    const live = await api.liveRounds();
    if (live.length) return ladderOrder(live);
    const latest = await api.currentRound();
    return latest ? [latest] : [];
  }, []);
  const rounds = current.status === 'ok' ? current.data : [];
  const heading = rounds.length > 1 ? t.liveRounds : rounds.length === 1 && rounds[0].status !== 'live' ? t.latestRound : t.liveRound;

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
          <Link to="/play" className="arrow hero-play">
            {t.playLink}
          </Link>
        </div>
        <div className="story">
          {STORY.map((s) => (
            <p key={s}>{s}</p>
          ))}
        </div>
      </section>

      <section className="block">
        <h2 className="h-small">{heading}</h2>
        {rounds.length > 1 && <p className="muted small ladder-line">{t.ladder}</p>}
        {current.status === 'loading' && <Loading />}
        {current.status === 'error' && <Failed error={current.error} />}
        {current.status === 'ok' &&
          (rounds.length ? (
            <>
              <div className="round-cards">
                {rounds.map((r) => (
                  <RoundStats key={r.id} round={r} />
                ))}
              </div>
              <RecentAttempts rounds={rounds} />
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
        {prelaunchPostmortem && (
          <p>
            <Link to="/library/prelaunch" className="arrow">
              {t.learnsLink}
            </Link>
          </p>
        )}
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

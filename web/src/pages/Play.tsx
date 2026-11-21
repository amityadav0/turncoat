import { Link } from 'react-router-dom';
import { config } from '../config';
import { copy } from '../content/copy';

const t = copy.play;

/** One line of a step: plain text, a command (`cmd:`), the phrase to say (`say:`), or the skill install line (`skill`). */
function Line({ line }: { line: string }) {
  if (line === 'skill')
    return config.skillUrl ? <pre className="cmd">{t.skillCmd(config.skillUrl)}</pre> : <p className="muted">{t.atLaunch}</p>;
  if (line.startsWith('cmd:')) return <pre className="cmd">{line.slice(4)}</pre>;
  if (line.startsWith('say:')) return <div className="say">{line.slice(4)}</div>;
  return <p>{line}</p>;
}

export default function Play() {
  return (
    <>
      <header className="page-head">
        <h1>{t.title}</h1>
        <p className="lede">{t.lede}</p>
        <p className="risk-inline">{t.cost}</p>
      </header>

      <ol className="play-steps">
        {t.steps.map((s, i) => (
          <li key={s.title} className="play-step">
            <h2 className="play-title">
              <span className="play-num">{i + 1}</span>
              {s.title}
            </h2>
            <div className="play-part">
              <div className="play-label">{t.doLabel}</div>
              {s.do.map((line) => (
                <Line key={line} line={line} />
              ))}
              {'agentId' in s && (
                <p>
                  {config.agentIdUrl ? (
                    <a href={config.agentIdUrl} target="_blank" rel="noopener noreferrer" className="ext">
                      {t.agentIdLink} <span aria-hidden="true">↗</span>
                    </a>
                  ) : (
                    <span className="muted">
                      {t.agentIdLink}: {t.atLaunch}
                    </span>
                  )}
                </p>
              )}
              {'link' in s && s.link && (
                <p>
                  <Link to={s.link.to} className="arrow">
                    {s.link.label}
                  </Link>
                </p>
              )}
            </div>
            <div className="play-part">
              <div className="play-label">{t.seeLabel}</div>
              <p>{s.see}</p>
            </div>
            <div className="play-part play-fail">
              <div className="play-label">{t.failLabel}</div>
              <p>{s.fail}</p>
            </div>
          </li>
        ))}
      </ol>

      <p className="muted small block">{copy.home.noPhishing}</p>
    </>
  );
}

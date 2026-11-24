import { Link } from 'react-router-dom';
import { config } from '../config';
import { copy } from '../content/copy';

const t = copy.claim;

/** The path from practice (free, no wallet) to the real round. */
export function ClaimAgentId({ heading = t.heading }: { heading?: string }) {
  return (
    <section className="claim" aria-label={heading}>
      <h2 className="claim-title">{heading}</h2>
      <p className="muted">{t.agentLine}</p>
      <ol className="steps">
        <li>
          <strong>{t.step1Strong}</strong> {t.step1}{' '}
          {config.agentIdUrl && (
            <a href={config.agentIdUrl} target="_blank" rel="noopener noreferrer" className="ext">
              {t.step1Link} <span aria-hidden="true">↗</span>
            </a>
          )}
        </li>
        <li>
          <strong>{t.step2Strong}</strong>
          <pre className="cmd">{copy.play.skillCmd(config.skillUrl)}</pre>
        </li>
        <li>
          <strong>{t.step3Strong}</strong>
          <div className="say">{t.say}</div>
          {t.step3}
        </li>
      </ol>
      <p>
        <Link to="/play" className="arrow">
          {t.fullSteps}
        </Link>
      </p>
    </section>
  );
}

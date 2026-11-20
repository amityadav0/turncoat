import { Link } from 'react-router-dom';
import { Postmortem } from '../components/Postmortem';
import { copy } from '../content/copy';
import { prelaunchPostmortem } from '../lib/postmortems';

const t = copy.library;

export default function Prelaunch() {
  return (
    <>
      <p className="crumb">
        <Link to="/library">{t.back}</Link>
      </p>
      <header className="page-head">
        <p className="eyebrow">
          <span className="tag tag-prelaunch">{t.prelaunchTag}</span>
        </p>
        <h1>{t.prelaunchTitle}</h1>
        <p className="lede">{t.prelaunchText}</p>
        <p className="muted small">{t.prelaunchNoPot}</p>
      </header>
      <section className="block postmortem">
        {prelaunchPostmortem ? <Postmortem text={prelaunchPostmortem} /> : <p className="muted">{t.prelaunchMissing}</p>}
      </section>
    </>
  );
}

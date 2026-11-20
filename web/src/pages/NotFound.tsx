import { Link } from 'react-router-dom';
import { copy } from '../content/copy';

export default function NotFound() {
  return (
    <header className="page-head">
      <h1>{copy.common.notFoundTitle}</h1>
      <p className="lede">
        {copy.common.notFoundBody} <Link to="/">{copy.common.notFoundLink}</Link>.
      </p>
    </header>
  );
}

import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <header className="page-head">
      <h1>Nothing here</h1>
      <p className="lede">
        Argus checked every eye. <Link to="/">Back to the start</Link>.
      </p>
    </header>
  );
}

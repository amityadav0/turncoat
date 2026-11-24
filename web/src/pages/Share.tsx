import { Navigate, useParams, useSearchParams } from 'react-router-dom';

// A shared link lands here (/s/<kind>?r=&a=). The built HTML for this path carries preview tags
// for that kind (vite.config.ts), which is what X and Telegram read. A person goes straight on to
// the attempt, or to practice.
const INT = /^\d{1,9}$/;

export default function Share() {
  const { kind = '' } = useParams();
  const [q] = useSearchParams();
  const r = q.get('r') ?? '';
  const a = q.get('a') ?? '';
  if (kind.startsWith('practice-')) return <Navigate to="/practice" replace />;
  if ((kind === 'turned' || kind === 'held') && INT.test(r)) return <Navigate to={`/library/${r}${INT.test(a) ? `#attempt-${a}` : ''}`} replace />;
  return <Navigate to="/" replace />;
}

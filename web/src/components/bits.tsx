import type { ReactNode } from 'react';
import type { Attacker, Outcome, RoundStatus } from '../api/types';
import { attackerLabel } from '../lib/format';

export function Who({ a }: { a: Attacker }) {
  return (
    <span className={a.name ? 'who' : 'who mono'} title={a.address}>
      {attackerLabel(a)}
    </span>
  );
}

export function OutcomeTag({ outcome }: { outcome: Outcome }) {
  const text = { broken: 'Broken', held: 'Held', pending: 'Judging', void: 'Not answered' }[outcome];
  return <span className={`tag tag-${outcome}`}>{text}</span>;
}

const STATUS_TEXT: Record<RoundStatus, string> = {
  live: 'Live',
  settling: 'Ended, settling',
  broken: 'Broken',
  held: 'Held',
};
export function StatusTag({ status }: { status: RoundStatus }) {
  return <span className={`tag tag-status-${status}`}>{STATUS_TEXT[status]}</span>;
}

/** External link, or a quiet note when the target doesn't exist yet. */
export function Ext({ href, children, missing }: { href: string | null; children: ReactNode; missing?: string | null }) {
  if (!href) return missing === null ? null : <span className="muted">{missing ?? 'Link available once the contract is deployed'}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="ext">
      {children} <span aria-hidden="true">↗</span>
    </a>
  );
}

export function Loading() {
  return <p className="muted" role="status">Loading…</p>;
}

export function Failed({ error }: { error: string }) {
  return (
    <p className="notice" role="alert">
      Could not reach the guard service ({error}). Try again in a moment.
    </p>
  );
}

export function Hash({ value }: { value: string }) {
  return <code className="hash">{value}</code>;
}

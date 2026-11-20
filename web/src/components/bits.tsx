import type { ReactNode } from 'react';
import type { Attacker, Outcome, RoundStatus } from '../api/types';
import { copy, FREE_ROUND, RISK_LABEL, RISK_NOTICE } from '../content/copy';
import { attackerLabel } from '../lib/format';

export function Who({ a }: { a: Attacker }) {
  return (
    <span className={a.name ? 'who' : 'who mono'} title={a.address}>
      {attackerLabel(a)}
    </span>
  );
}

export function OutcomeTag({ outcome }: { outcome: Outcome }) {
  return <span className={`tag tag-${outcome}`}>{copy.outcome[outcome]}</span>;
}

export function StatusTag({ status }: { status: RoundStatus }) {
  return <span className={`tag tag-status-${status}`}>{copy.round.status[status]}</span>;
}

/** External link, a quiet note when the target doesn't exist yet, or nothing (missing={null}). */
export function Ext({ href, children, missing }: { href: string | null; children: ReactNode; missing?: string | null }) {
  if (!href) return missing === null ? null : <span className="muted">{missing ?? copy.common.linkMissing}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="ext">
      {children} <span aria-hidden="true">↗</span>
    </a>
  );
}

export function Loading() {
  return (
    <p className="muted" role="status">
      {copy.common.loading}
    </p>
  );
}

export function Failed({ error }: { error: string }) {
  return (
    <p className="notice" role="alert">
      {copy.common.unreachable(error)}
    </p>
  );
}

export function Hash({ value }: { value: string }) {
  return <code className="hash">{value}</code>;
}

/** Shown next to every pot amount: the free-round line, or the full risk notice when paid attempts are on. */
export function Risk({ paidEnabled }: { paidEnabled: boolean }) {
  if (!paidEnabled) return <p className="risk-inline">{FREE_ROUND}</p>;
  return (
    <p className="risk-inline">
      <strong>{RISK_LABEL}</strong> {RISK_NOTICE}
    </p>
  );
}

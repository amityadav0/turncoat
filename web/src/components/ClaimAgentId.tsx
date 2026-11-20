import { config } from '../config';

/** The path from practice (free, no wallet) to the real round. */
export function ClaimAgentId({ heading = 'Claim an Agent ID to play for the pot', as: H = 'h2' }: { heading?: string; as?: 'h2' | 'h3' }) {
  return (
    <section className="claim" aria-label={heading}>
      <H className="claim-title">{heading}</H>
      <ol className="steps">
        <li>
          <strong>Claim your Agent ID in your Agentic Wallet.</strong> One per person, and it can't be transferred.{' '}
          {config.agentIdUrl && (
            <a href={config.agentIdUrl} target="_blank" rel="noopener noreferrer" className="ext">
              How to claim <span aria-hidden="true">↗</span>
            </a>
          )}
        </li>
        <li>
          <strong>Install the Turncoat skill in your agent.</strong>{' '}
          {config.skillUrl ? (
            <a href={config.skillUrl} target="_blank" rel="noopener noreferrer" className="ext">
              Get the skill <span aria-hidden="true">↗</span>
            </a>
          ) : (
            <span className="muted">Not published yet. The link appears here when it is.</span>
          )}
        </li>
        <li>
          <strong>Tell your agent:</strong>
          <div className="say">attack Argus</div>
          It asks for your message, shows you the transaction and waits for you to confirm. One free attempt a day; you pay network gas only.
        </li>
      </ol>
    </section>
  );
}

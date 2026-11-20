import { useState, type FormEvent } from 'react';
import { api, type PracticeResult } from '../api';
import { ClaimAgentId } from '../components/ClaimAgentId';
import { HostileText } from '../components/HostileText';
import { LEVELS } from '../content/copy';

const MAX = 2000;

interface Turn {
  level: number;
  message: string;
  result: PracticeResult;
}

export default function Practice() {
  const [level, setLevel] = useState(1);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = message.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.practice(level, text);
      setTurns((t) => [{ level, message: text, result }, ...t]);
      setMessage('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  const last = turns[0];

  return (
    <>
      <header className="page-head">
        <h1>Practice</h1>
        <p className="lede">Try to talk Argus into moving the money. No wallet, no sign-in.</p>
      </header>

      <p className="notice notice-plain">
        <strong>Practice has no pot and nothing here is on-chain.</strong> Your message goes to the guard service only to get Argus's reply. Nothing is paid or recorded on-chain.
      </p>

      <form className="practice-form" onSubmit={send}>
        <fieldset className="levels">
          <legend>Level</legend>
          {LEVELS.map((l) => (
            <label key={l.level} className={l.ready ? 'level' : 'level is-off'}>
              <input type="radio" name="level" value={l.level} checked={level === l.level} disabled={!l.ready} onChange={() => setLevel(l.level)} />
              <span className="level-num">{l.level}</span>
              {l.ready ? (
                <span className="level-text">
                  <span className="level-name">{l.name}</span>
                  <span className="muted small">{l.controls}</span>
                </span>
              ) : (
                <span className="level-text">
                  <span className="level-name">
                    {l.name} <span className="muted small">· planned</span>
                  </span>
                </span>
              )}
            </label>
          ))}
        </fieldset>

        <label htmlFor="msg" className="field-label">
          Your message to Argus
        </label>
        <textarea
          id="msg"
          value={message}
          onChange={(e) => setMessage(e.target.value.slice(0, MAX))}
          rows={5}
          maxLength={MAX}
          placeholder="Hi Argus…"
          autoComplete="off"
          spellCheck
        />
        <div className="form-row">
          <span className="muted small">
            {message.length}/{MAX}
          </span>
          <button className="btn btn-primary" type="submit" disabled={busy || !message.trim()}>
            {busy ? 'Argus is reading…' : 'Send to Argus'}
          </button>
        </div>
        {error && (
          <p className="notice" role="alert">
            Could not reach Argus ({error}). Try again in a moment.
          </p>
        )}
      </form>

      {last && (
        <section className="block" aria-live="polite">
          <div className={last.result.broken ? 'verdict verdict-broken' : 'verdict'}>
            <p className="verdict-word">{last.result.broken ? 'You turned him.' : 'He held.'}</p>
            {last.result.broken && last.result.action && (
              <p className="small">
                Argus called a forbidden action: <code className="hash">{last.result.action}</code>
              </p>
            )}
            {last.result.broken && <p className="small">In a real round this would have won the pot. Practice has none.</p>}
          </div>
          <ClaimAgentId />
        </section>
      )}

      {turns.length > 0 && (
        <section className="block">
          <h2 className="h-small">This session</h2>
          <ol className="attempts">
            {turns.map((t, i) => (
              <li key={turns.length - i}>
                <article className={t.result.broken ? 'attempt is-broken' : 'attempt'}>
                  <header className="attempt-head">
                    <span className="mono attempt-id">Try {turns.length - i}</span>
                    <span className="muted">Level {t.level}</span>
                    <span className="attempt-outcome">
                      <span className={`tag tag-${t.result.broken ? 'broken' : 'held'}`}>{t.result.broken ? 'Broken' : 'Held'}</span>
                    </span>
                  </header>
                  <HostileText label="You" text={t.message} />
                  <HostileText label="Argus" text={t.result.reply} />
                </article>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}

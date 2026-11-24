import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { api, type PracticeResult } from '../api';
import { ClaimAgentId } from '../components/ClaimAgentId';
import { BreakKindTag, DecisionTag } from '../components/bits';
import { HostileText } from '../components/HostileText';
import { SharePanel } from '../components/SharePanel';
import { copy, LEVELS, levelName } from '../content/copy';

const t = copy.practice;
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
  const [sharing, setSharing] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const { state } = useLocation();

  // Arriving from the home page button: go straight to typing.
  useEffect(() => {
    if ((state as { start?: boolean } | null)?.start) box.current?.focus();
  }, [state]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = message.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.practice(level, text);
      setTurns((prev) => [{ level, message: text, result }, ...prev]);
      setMessage('');
      setSharing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.common.requestFailed);
    } finally {
      setBusy(false);
    }
  }

  const last = turns[0];

  return (
    <>
      <header className="page-head page-head-tight">
        <h1>{t.title}</h1>
        <p className="lede">{t.lede}</p>
      </header>

      <form className="practice-form" onSubmit={send}>
        <label htmlFor="msg" className="field-label">
          {t.messageLabel} <span className="muted small">· {t.levelN(level)}: {levelName(level)}</span>
        </label>
        <textarea
          id="msg"
          ref={box}
          value={message}
          onChange={(e) => setMessage(e.target.value.slice(0, MAX))}
          rows={4}
          maxLength={MAX}
          placeholder={t.placeholder}
          autoComplete="off"
          spellCheck
        />
        <div className="form-row">
          <span className="muted small">
            {message.length}/{MAX}
          </span>
          <button className="btn btn-primary" type="submit" disabled={busy || !message.trim()}>
            {busy ? t.sending : t.send}
          </button>
        </div>
        {error && (
          <p className="notice" role="alert">
            {t.unreachable(error)}
          </p>
        )}
      </form>

      <p className="notice notice-plain small">
        <strong>{t.noticeStrong}</strong> {t.notice}
      </p>

      {last && (
        <section className="block block-tight" aria-live="polite">
          <div className={last.result.broken ? 'verdict verdict-broken' : 'verdict'}>
            <p className="verdict-word">{last.result.broken ? t.turned : t.held}</p>
            {last.result.broken && last.result.action && (
              <p className="small">
                {t.forbidden} <code className="hash">{last.result.action}</code>
              </p>
            )}
            {last.result.broken && last.result.breakKind === 'misfire' && <p className="small">{t.misfire}</p>}
            {last.result.broken && <p className="small">{t.realRound}</p>}
            <button type="button" className="linkish" aria-expanded={sharing} onClick={() => setSharing(!sharing)}>
              {sharing ? copy.attempt.closeShare : copy.share.sharePractice}
            </button>
          </div>
          {sharing && <SharePanel kind="practice" outcome={last.result.broken ? 'turned' : 'held'} />}
          <ClaimAgentId />
        </section>
      )}

      <fieldset className="levels block">
        <legend>{t.level}</legend>
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
                  {l.name} <span className="muted small">{t.planned}</span>
                </span>
              </span>
            )}
          </label>
        ))}
      </fieldset>

      {turns.length > 0 && (
        <section className="block">
          <h2 className="h-small">{t.session}</h2>
          <ol className="attempts">
            {turns.map((turn, i) => (
              <li key={turns.length - i}>
                <article className={turn.result.broken ? 'attempt is-broken' : 'attempt'}>
                  <header className="attempt-head">
                    <span className="mono attempt-id">{t.tryN(turns.length - i)}</span>
                    <span className="muted">{t.levelN(turn.level)}</span>
                    <span className="attempt-outcome">
                      <BreakKindTag kind={turn.result.breakKind} />{' '}
                      <span className={`tag tag-${turn.result.broken ? 'broken' : 'held'}`}>{turn.result.broken ? copy.outcome.broken : copy.outcome.held}</span>
                    </span>
                  </header>
                  <HostileText label={t.you} text={turn.message} />
                  <HostileText label={copy.attempt.reply} aside={<DecisionTag decision={turn.result.decision} />} text={turn.result.reply} />
                </article>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}

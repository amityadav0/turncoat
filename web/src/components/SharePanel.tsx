import { useEffect, useState } from 'react';
import { config } from '../config';
import { copy } from '../content/copy';
import { renderShareCard, shareKind, telegramShareUrl, xIntentUrl, type CardInput } from '../lib/shareCard';

const t = copy.share;

export function SharePanel(props: CardInput) {
  // One string key, so the effect redraws only when the card would change (props is a new object every render).
  const key = props.kind === 'attempt' ? `r${props.roundId}-a${props.attemptId}-${props.outcome}` : `practice-${props.outcome}`;
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    renderShareCard(props).then(
      (b) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(b);
        setBlob(b);
        setUrl(objectUrl);
      },
      (e) => alive && setError(e instanceof Error ? e.message : t.failed),
    );
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [key]);

  const fileName = `turncoat-${key}${config.mock ? '-demo' : config.testNetwork ? '-testnet' : ''}.png`;
  const file = blob ? new File([blob], fileName, { type: 'image/png' }) : null;
  const canShareFile = !config.mock && Boolean(file && navigator.canShare?.({ files: [file] }));

  async function shareImage() {
    if (!file) return;
    try {
      await navigator.share({ files: [file], text: t.hashtags });
    } catch {
      /* cancelled */
    }
  }

  return (
    <div className="share-panel">
      {error && <p className="notice">{error}</p>}
      {!url && !error && <p className="muted small">{t.drawing}</p>}
      {url && <img src={url} width={1200} height={630} alt={t.alt(props)} className="share-img" />}
      <div className="share-actions">
        {!config.mock && (
          <a className="btn btn-primary" href={xIntentUrl(props)} target="_blank" rel="noopener noreferrer">
            {t.post}
          </a>
        )}
        {!config.mock && (
          <a className="btn" href={telegramShareUrl(props)} target="_blank" rel="noopener noreferrer" data-share={shareKind(props)}>
            {t.telegram}
          </a>
        )}
        {url && (
          <a className="btn" href={url} download={fileName}>
            {t.download}
          </a>
        )}
        {canShareFile && (
          <button type="button" className="btn" onClick={shareImage}>
            {t.shareImage}
          </button>
        )}
      </div>
      <p className="muted small">{config.mock ? t.demoNote : t.note}</p>
    </div>
  );
}

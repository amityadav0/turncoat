import { useEffect, useState } from 'react';
import { config } from '../config';
import { copy } from '../content/copy';
import { renderShareCard, xIntentUrl, type CardInput } from '../lib/shareCard';

const t = copy.share;

export function SharePanel(props: CardInput) {
  const { roundId, attemptId, outcome } = props;
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    renderShareCard({ roundId, attemptId, outcome }).then(
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
  }, [roundId, attemptId, outcome]);

  const fileName = `turncoat-r${roundId}-a${attemptId}${config.mock ? '-demo' : ''}.png`;
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
      {url && <img src={url} width={1200} height={630} alt={t.alt(attemptId, roundId, outcome)} className="share-img" />}
      <div className="share-actions">
        {!config.mock && (
          <a className="btn btn-primary" href={xIntentUrl(props)} target="_blank" rel="noopener noreferrer">
            {t.post}
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

import { useEffect, useState } from 'react';
import { renderShareCard, xIntentUrl, type CardInput } from '../lib/shareCard';

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
      (e) => alive && setError(e instanceof Error ? e.message : 'Could not draw the card'),
    );
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [roundId, attemptId, outcome]);

  const fileName = `turncoat-r${roundId}-a${attemptId}.png`;
  const file = blob ? new File([blob], fileName, { type: 'image/png' }) : null;
  const canShareFile = Boolean(file && navigator.canShare?.({ files: [file] }));

  async function shareImage() {
    if (!file) return;
    try {
      await navigator.share({ files: [file], text: '#BinanceWalletHackathon #AgenticWallet' });
    } catch {
      /* cancelled */
    }
  }

  return (
    <div className="share-panel">
      {error && <p className="notice">{error}</p>}
      {!url && !error && <p className="muted small">Drawing the card…</p>}
      {url && <img src={url} width={1200} height={630} alt={`Share card: attempt ${attemptId}, round ${roundId}, ${outcome}.`} className="share-img" />}
      <div className="share-actions">
        <a className="btn btn-primary" href={xIntentUrl(props)} target="_blank" rel="noopener noreferrer">
          Post on X
        </a>
        {url && (
          <a className="btn" href={url} download={fileName}>
            Download
          </a>
        )}
        {canShareFile && (
          <button type="button" className="btn" onClick={shareImage}>
            Share image
          </button>
        )}
      </div>
      <p className="muted small">X opens with the post filled in. To include the card, attach the downloaded image.</p>
    </div>
  );
}

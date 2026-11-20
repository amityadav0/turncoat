import logoUrl from '../../../assets/logo.svg';
import { ONE_LINE } from '../content/copy';

// 1200x630 share image. Deliberately carries no attacker text: only the attempt number,
// the round, the outcome and the one line.
export const CARD_W = 1200;
export const CARD_H = 630;

const INK = '#0C0C10';
const BONE = '#F3EFE6';
const SIGNAL = '#FF4A26';
const HEAVY = '"Archivo", "Helvetica Neue", Arial, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Logo failed to load'));
    img.src = src;
  });
}

export interface CardInput {
  roundId: number;
  attemptId: number;
  outcome: 'held' | 'turned';
}

export async function renderShareCard({ roundId, attemptId, outcome }: CardInput): Promise<Blob> {
  await Promise.all([
    document.fonts.load(`900 180px ${HEAVY}`),
    document.fonts.load(`700 52px ${HEAVY}`),
    document.fonts.load(`600 26px ${MONO}`),
  ]).catch(() => undefined);
  const logo = await loadImage(logoUrl);

  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // Accent rule on the left edge.
  ctx.fillStyle = SIGNAL;
  ctx.fillRect(0, 0, 12, CARD_H);

  const pad = 84;
  ctx.drawImage(logo, pad, pad, 112, 112);

  ctx.fillStyle = BONE;
  ctx.font = `900 40px ${HEAVY}`;
  ctx.textBaseline = 'middle';
  ctx.fillText('TURNCOAT', pad + 140, pad + 56);

  ctx.textBaseline = 'alphabetic';
  ctx.globalAlpha = 0.65;
  ctx.font = `600 26px ${MONO}`;
  ctx.fillText(`ATTEMPT #${attemptId}  ·  ROUND ${roundId}`, pad, 296);
  ctx.globalAlpha = 1;

  ctx.fillStyle = outcome === 'turned' ? SIGNAL : BONE;
  ctx.font = `900 172px ${HEAVY}`;
  ctx.fillText(outcome.toUpperCase(), pad - 6, 444);

  ctx.fillStyle = BONE;
  ctx.font = `700 50px ${HEAVY}`;
  ctx.fillText(ONE_LINE, pad, CARD_H - pad + 6);

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not draw the card'))), 'image/png'),
  );
}

export function xIntentUrl({ roundId, attemptId, outcome }: CardInput) {
  const link = `${window.location.origin}/library/${roundId}#attempt-${attemptId}`;
  const verdict = outcome === 'turned' ? 'Argus was turned.' : 'Argus held.';
  const text = `Attempt #${attemptId}, round ${roundId}. ${verdict}\n\n${ONE_LINE}\n\n${link}\n\n#BinanceWalletHackathon #AgenticWallet`;
  return `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`;
}

import logoUrl from '../../../assets/logo.svg';
import { config } from '../config';
import { copy, ONE_LINE } from '../content/copy';

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
    img.onerror = () => reject(new Error(copy.share.logoFailed));
    img.src = src;
  });
}

/** What a card is for. Practice cards carry no round or attempt: practice has no pot and nothing on-chain. */
export type CardInput =
  | { kind: 'attempt'; roundId: number; attemptId: number; outcome: Outcome }
  | { kind: 'practice'; outcome: Outcome };
export type Outcome = 'held' | 'turned';

/** The share kinds that get their own unfurl page (/s/<kind>, built by vite.config.ts). Keep in sync. */
export type ShareKind = 'turned' | 'held' | 'practice-turned' | 'practice-held';
export const shareKind = (c: CardInput): ShareKind => (c.kind === 'practice' ? `practice-${c.outcome}` : c.outcome);

/** What gets drawn: the small line above the word, and an optional label box (demo data, test network). */
export interface CardSpec {
  meta: string;
  outcome: Outcome;
  label?: string | null;
}

export const cardSpec = (c: CardInput): CardSpec => ({
  meta: c.kind === 'practice' ? copy.share.cardPractice : copy.share.cardMeta(c.attemptId, c.roundId),
  outcome: c.outcome,
  // Demo cards must never pass for a real result; test-network cards must never pass for real value.
  label: config.mock ? copy.share.cardDemo : config.testNetwork ? copy.share.cardTest : null,
});

export async function renderShareCard(input: CardInput | CardSpec): Promise<Blob> {
  const { meta, outcome, label } = 'kind' in input ? cardSpec(input) : input;
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
  ctx.fillText(copy.share.cardWordmark, pad + 140, pad + 56);

  ctx.textBaseline = 'alphabetic';
  ctx.globalAlpha = 0.65;
  ctx.font = `600 26px ${MONO}`;
  ctx.fillText(meta, pad, 296);
  ctx.globalAlpha = 1;

  ctx.fillStyle = outcome === 'turned' ? SIGNAL : BONE;
  ctx.font = `900 172px ${HEAVY}`;
  ctx.fillText(outcome.toUpperCase(), pad - 6, 444);

  ctx.fillStyle = BONE;
  ctx.font = `700 50px ${HEAVY}`;
  ctx.fillText(ONE_LINE, pad, CARD_H - pad + 6);

  if (label) {
    ctx.save();
    ctx.font = `800 30px ${HEAVY}`;
    const w = ctx.measureText(label).width + 40;
    ctx.fillStyle = BONE;
    ctx.fillRect(CARD_W - pad - w, pad + 30, w, 52);
    ctx.fillStyle = INK;
    ctx.textBaseline = 'middle';
    ctx.fillText(label, CARD_W - pad - w + 20, pad + 57);
    ctx.restore();
  }

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(copy.share.failed))), 'image/png'),
  );
}

/** The link a share points at: a small page per outcome whose preview tags X and Telegram can read, which then opens the attempt. */
export function shareLink(c: CardInput) {
  const q = c.kind === 'attempt' ? `?r=${c.roundId}&a=${c.attemptId}` : '';
  return `${window.location.origin}/s/${shareKind(c)}${q}`;
}

const postText = (c: CardInput) =>
  c.kind === 'practice' ? copy.share.practiceText(c.outcome === 'turned') : copy.share.attemptText(c.attemptId, c.roundId, c.outcome === 'turned');

export function xIntentUrl(c: CardInput) {
  const text = `${postText(c)}\n\n${shareLink(c)}\n\n${copy.share.hashtags}`;
  return `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`;
}

export function telegramShareUrl(c: CardInput) {
  return `https://t.me/share/url?url=${encodeURIComponent(shareLink(c))}&text=${encodeURIComponent(postText(c))}`;
}

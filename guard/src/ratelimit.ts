// Fixed-window limiter per key (IP), plus an optional global cap per window.
export class RateLimiter {
  private hits = new Map<string, { start: number; n: number }>();
  private global = { start: 0, n: 0 };

  constructor(private perKey: number, private windowMs: number, private globalCap: number, private globalWindowMs: number, private now = () => Date.now()) {}

  /** Returns 0 if allowed (and counts the hit), otherwise seconds until the caller may retry. */
  take(key: string): number {
    const t = this.now();
    if (t - this.global.start >= this.globalWindowMs) this.global = { start: t, n: 0 };
    if (this.globalCap > 0 && this.global.n >= this.globalCap) return Math.ceil((this.global.start + this.globalWindowMs - t) / 1000);
    const h = this.hits.get(key);
    if (!h || t - h.start >= this.windowMs) {
      this.hits.set(key, { start: t, n: 1 });
    } else if (h.n >= this.perKey) {
      return Math.ceil((h.start + this.windowMs - t) / 1000);
    } else h.n += 1;
    this.global.n += 1;
    if (this.hits.size > 50_000) for (const [k, v] of this.hits) if (t - v.start >= this.windowMs) this.hits.delete(k);
    return 0;
  }
}

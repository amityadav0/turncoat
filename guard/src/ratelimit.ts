// Fixed-window limiter per key (client IP, see clientKey), plus an optional global cap per window.
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
      return Math.max(1, Math.ceil((h.start + this.windowMs - t) / 1000));
    } else h.n += 1;
    this.global.n += 1;
    if (this.hits.size > 50_000) for (const [k, v] of this.hits) if (t - v.start >= this.windowMs) this.hits.delete(k);
    return 0;
  }
}

/**
 * The bucket a client IP counts against. IPv4 (and IPv4-mapped IPv6) is the address itself. IPv6 is
 * keyed on its /64: one subscriber usually holds a whole /64, so keying on the full address would give
 * them 2^64 buckets.
 */
export function clientKey(ip: string | undefined): string {
  if (!ip) return "unknown";
  const addr = ip.split("%")[0].toLowerCase();
  const mapped = addr.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return mapped[1];
  if (!addr.includes(":")) return addr;
  const toGroups = (s: string) => {
    if (!s) return [] as string[];
    const parts = s.split(":");
    const last = parts[parts.length - 1];
    if (last.includes(".")) {
      const b = last.split(".").map(Number);
      parts.splice(parts.length - 1, 1, ((b[0] << 8) | b[1]).toString(16), ((b[2] << 8) | b[3]).toString(16));
    }
    return parts;
  };
  const [l, r] = addr.includes("::") ? addr.split("::") : [addr, undefined];
  const left = toGroups(l);
  const right = r === undefined ? [] : toGroups(r);
  const groups = r === undefined ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return addr;
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

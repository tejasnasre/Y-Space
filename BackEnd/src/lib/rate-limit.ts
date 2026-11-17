/**
 * Tiny in-memory failure limiter. Only *failed* attempts count, so legit users are never throttled.
 * Good enough for a single self-hosted process.
 */
export class FailureLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly maxFailures: number,
    private readonly windowMs: number,
  ) {}

  isBlocked(key: string): boolean {
    const entry = this.hits.get(key);
    if (!entry) return false;
    if (entry.resetAt <= Date.now()) {
      this.hits.delete(key);
      return false;
    }
    return entry.count >= this.maxFailures;
  }

  fail(key: string): void {
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
    } else entry.count++;
    if (this.hits.size > 10_000) this.sweep(now);
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private sweep(now: number): void {
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
  }
}

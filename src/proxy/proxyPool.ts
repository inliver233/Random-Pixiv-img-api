export type ProxyPickMode = 'sequential' | 'random' | 'balance';

export type ProxyCandidate = {
  id: string;
};

export type ProxyPoolOptions = {
  mode: ProxyPickMode;
  blacklistTtlMs: number;
  failureThreshold: number;
  now?: () => number;
  random?: () => number;
};

type ProxyStats = {
  failures: number;
  blacklistedUntil: number | null;
  picks: number;
};

function normalizeId(id: string): string {
  const normalized = String(id ?? '').trim();
  if (!normalized) throw new Error('Proxy candidate id is required.');
  return normalized;
}

export class ProxyPool {
  private endpoints: ProxyCandidate[];
  private options: Required<Omit<ProxyPoolOptions, 'random'>> & { random: () => number };
  private cursor = 0;
  private stats = new Map<string, ProxyStats>();

  constructor(endpoints: ProxyCandidate[], options: ProxyPoolOptions) {
    const now = options.now ?? (() => Date.now());
    const random = options.random ?? (() => Math.random());
    this.options = {
      mode: options.mode,
      blacklistTtlMs: options.blacklistTtlMs,
      failureThreshold: options.failureThreshold,
      now,
      random,
    };
    this.endpoints = this.normalizeCandidates(endpoints);
  }

  updateEndpoints(endpoints: ProxyCandidate[]): void {
    this.endpoints = this.normalizeCandidates(endpoints);
    // Keep stats for existing ids; drop stats for removed endpoints to avoid unbounded growth.
    const alive = new Set(this.endpoints.map((e) => e.id));
    for (const key of Array.from(this.stats.keys())) {
      if (!alive.has(key)) this.stats.delete(key);
    }
    this.cursor = 0;
  }

  private normalizeCandidates(endpoints: ProxyCandidate[]): ProxyCandidate[] {
    const out: ProxyCandidate[] = [];
    for (const e of endpoints || []) {
      if (!e) continue;
      const id = normalizeId(e.id);
      out.push({ id });
      this.ensureStats(id);
    }
    return out;
  }

  private ensureStats(id: string): ProxyStats {
    let s = this.stats.get(id);
    if (!s) {
      s = { failures: 0, blacklistedUntil: null, picks: 0 };
      this.stats.set(id, s);
    }
    return s;
  }

  isBlacklisted(id: string): boolean {
    const s = this.stats.get(id);
    if (!s?.blacklistedUntil) return false;
    return this.options.now() < s.blacklistedUntil;
  }

  reportSuccess(id: string): void {
    const key = normalizeId(id);
    const s = this.ensureStats(key);
    s.failures = 0;
    s.blacklistedUntil = null;
  }

  reportFailure(id: string): void {
    const key = normalizeId(id);
    const s = this.ensureStats(key);
    s.failures += 1;
    if (s.failures >= this.options.failureThreshold) {
      s.blacklistedUntil = this.options.now() + this.options.blacklistTtlMs;
      s.failures = 0;
    }
  }

  pick(): ProxyCandidate | null {
    const available = this.endpoints.filter((e) => !this.isBlacklisted(e.id));
    if (available.length === 0) return null;

    const picked = (() => {
      switch (this.options.mode) {
        case 'random': {
          const idx = Math.floor(this.options.random() * available.length);
          return available[Math.min(Math.max(idx, 0), available.length - 1)]!;
        }
        case 'balance': {
          let best = available[0]!;
          let bestStats = this.ensureStats(best.id);
          for (let i = 1; i < available.length; i += 1) {
            const candidate = available[i]!;
            const candStats = this.ensureStats(candidate.id);
            if (candStats.picks < bestStats.picks) {
              best = candidate;
              bestStats = candStats;
              continue;
            }
            if (candStats.picks === bestStats.picks && candidate.id < best.id) {
              best = candidate;
              bestStats = candStats;
            }
          }
          return best;
        }
        case 'sequential':
        default: {
          // Find the next available endpoint in the original list order.
          for (let i = 0; i < this.endpoints.length; i += 1) {
            const idx = (this.cursor + i) % this.endpoints.length;
            const candidate = this.endpoints[idx]!;
            if (this.isBlacklisted(candidate.id)) continue;
            this.cursor = (idx + 1) % this.endpoints.length;
            return candidate;
          }
          return available[0]!;
        }
      }
    })();

    this.ensureStats(picked.id).picks += 1;
    return picked;
  }

  snapshot(): Record<string, ProxyStats> {
    const out: Record<string, ProxyStats> = {};
    for (const [id, s] of this.stats.entries()) {
      out[id] = { ...s };
    }
    return out;
  }
}


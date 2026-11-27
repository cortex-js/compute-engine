import type { CallPoolWarmth } from '../kernel-pool.js';

type Timing = { passes: number; ms: number };
const SETUP_MS: Record<CallPoolWarmth, number> = {
  'cold-pool': 15,
  'cold-kernel': 0.25,
  warm: 0.12,
};

/** History for one loop, pool and input-size band. */
export class ParallelDispatchHistory {
  private serial?: Timing;
  private readonly pooled: Partial<Record<CallPoolWarmth, Timing>> = {};
  private closeCalls = 0;

  choose(
    passes: number,
    parts: number,
    numbers: number,
    workPerPass: number,
    warmth: CallPoolWarmth,
    explore: boolean
  ): { usePool: boolean; basis: 'estimate' | 'measured' | 'sample' } {
    const serial = this.serial
      ? this.serial.ms * (passes / this.serial.passes)
      : passes * workPerPass * 1e-6;
    const observed = this.pooled[warmth];
    const pooled = observed
      ? observed.ms * Math.max(0.8, passes / observed.passes)
      : SETUP_MS[warmth] + numbers * 0.000003 + serial / Math.min(4, parts);
    const usePool = parts > 1 && serial > 1.25 * pooled;
    // Sample the other route occasionally near the crossover, after observing
    // one route. Avoid starting a pool merely to collect a timing.
    if (
      explore &&
      parts > 1 &&
      warmth !== 'cold-pool' &&
      (this.serial !== undefined || observed !== undefined) &&
      serial >= 0.5 * pooled &&
      serial <= 2 * pooled &&
      ++this.closeCalls % 16 === 0
    )
      return { usePool: !usePool, basis: 'sample' };
    return {
      usePool,
      basis:
        this.serial !== undefined || observed !== undefined
          ? 'measured'
          : 'estimate',
    };
  }

  observe(route: 'serial' | CallPoolWarmth, passes: number, ms: number): void {
    if (ms < 0.05) return;
    const previous = route === 'serial' ? this.serial : this.pooled[route];
    const timing = {
      passes,
      ms: previous
        ? 0.75 * previous.ms * (passes / previous.passes) + 0.25 * ms
        : ms,
    };
    if (route === 'serial') this.serial = timing;
    else this.pooled[route] = timing;
  }
}

import { PolynomialWork } from './exact-field.js';

export type FactorPhase =
  'preprocessing' | 'modular' | 'lifting' | 'recombination' | 'verification';
export type FactorProfile = Record<
  FactorPhase,
  { milliseconds: number; operations: number }
>;

/** Exclusive phase accounting: recursive factorization never double-counts work. */
export class FactorWork extends PolynomialWork {
  readonly profile?: FactorProfile;
  private current: FactorPhase = 'preprocessing';
  private time = 0;
  private counted = 0;

  constructor(
    limit: number,
    check?: () => void,
    profile = false,
    readonly lifting: 'linear' | 'quadratic' | 'auto' = 'auto',
    readonly recombination: 'subsets' | 'lattice' | 'auto' = 'auto'
  ) {
    super(limit, check);
    if (
      !['linear', 'quadratic', 'auto'].includes(lifting) ||
      !['subsets', 'lattice', 'auto'].includes(recombination)
    )
      throw new RangeError('Invalid factorization strategy');
    if (profile) {
      this.profile = Object.fromEntries(
        [
          'preprocessing',
          'modular',
          'lifting',
          'recombination',
          'verification',
        ].map((p) => [p, { milliseconds: 0, operations: 0 }])
      ) as FactorProfile;
      this.time = globalThis.performance.now();
    }
  }

  phase(next: FactorPhase): void {
    if (this.profile) {
      const now = globalThis.performance.now();
      this.profile[this.current].milliseconds += now - this.time;
      this.profile[this.current].operations += this.operations - this.counted;
      this.time = now;
      this.counted = this.operations;
    }
    this.current = next;
  }

  scope<T>(phase: FactorPhase, fn: () => T): T {
    const previous = this.current;
    this.phase(phase);
    try {
      return fn();
    } finally {
      this.phase(previous);
    }
  }
}

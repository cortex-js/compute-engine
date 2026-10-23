import {
  PolynomialBudgetExceeded,
  PolynomialWork,
  rationalField,
  type ExactField,
  type RationalCoefficient,
} from './exact-field.js';

export type NumberFieldPhase =
  | 'preprocessing'
  | 'modular'
  | 'finite-factorization'
  | 'hensel'
  | 'recombination'
  | 'reconstruction'
  | 'recovery-filter'
  | 'trial-division'
  | 'lattice'
  | 'norm'
  | 'rational-factorization'
  | 'recovery'
  | 'verification';
export type NumberFieldProfile = Record<
  NumberFieldPhase,
  { milliseconds: number; operations: number }
>;

/** Exclusive phases and rational-size guards shared by extension arithmetic. */
export class NumberFieldWork extends PolynomialWork {
  readonly phases?: NumberFieldProfile;
  readonly rational: ExactField<RationalCoefficient>;
  private current: NumberFieldPhase = 'preprocessing';
  private time = 0;
  private counted = 0;
  private readonly bound?: bigint;

  constructor(
    limit: number,
    check: (() => void) | undefined,
    profile: boolean,
    coefficientBits: number
  ) {
    super(limit, check);
    if (coefficientBits <= 65536) this.bound = 1n << BigInt(coefficientBits);
    const guard = (c: RationalCoefficient): RationalCoefficient => {
      if (
        this.bound
          ? c.numerator <= -this.bound ||
            c.numerator >= this.bound ||
            c.denominator >= this.bound
          : (c.numerator < 0n ? -c.numerator : c.numerator).toString(2).length >
              coefficientBits ||
            c.denominator.toString(2).length > coefficientBits
      )
        throw new PolynomialBudgetExceeded('intermediate-coefficient-limit');
      return c;
    };
    this.rational = {
      ...rationalField,
      add: (a, b) => guard(rationalField.add(guard(a), guard(b))),
      mul: (a, b) => guard(rationalField.mul(guard(a), guard(b))),
      neg: (a) => guard(rationalField.neg(guard(a))),
      inv: (a) => guard(rationalField.inv(guard(a))),
      fromInteger: (a) => guard(rationalField.fromInteger(a)),
    };
    if (profile) {
      this.phases = Object.fromEntries(
        [
          'preprocessing',
          'modular',
          'finite-factorization',
          'hensel',
          'recombination',
          'reconstruction',
          'recovery-filter',
          'trial-division',
          'lattice',
          'norm',
          'rational-factorization',
          'recovery',
          'verification',
        ].map((p) => [p, { milliseconds: 0, operations: 0 }])
      ) as NumberFieldProfile;
      this.time = globalThis.performance.now();
    }
  }
  phase(next: NumberFieldPhase): void {
    if (this.phases) {
      const now = globalThis.performance.now();
      this.phases[this.current].milliseconds += now - this.time;
      this.phases[this.current].operations += this.operations - this.counted;
      this.time = now;
      this.counted = this.operations;
    }
    this.current = next;
  }
  scope<T>(phase: NumberFieldPhase, fn: () => T): T {
    const previous = this.current;
    this.phase(phase);
    try {
      return fn();
    } finally {
      this.phase(previous);
    }
  }
}

/**
 * Precision comparison: BigDecimal vs Decimal.js
 *
 * Measures the exact number of correct significant digits for each operation
 * at multiple precision levels. This makes it easy to spot improvements
 * or regressions — any change in digit counts shows up as a snapshot diff.
 *
 * For operations that decimal.js doesn't support (Gamma, etc.), we compare
 * against known exact values computed at higher precision.
 */

import { BigDecimal } from '../../src/big-decimal';
import { Decimal } from 'decimal.js';

// ---------- Helpers ----------

/**
 * Extract the significant digit string from a numeric string.
 * Strips sign, decimal point, leading zeros. Preserves trailing zeros.
 */
function sigDigits(s: string): string {
  if (s.startsWith('-') || s.startsWith('+')) s = s.slice(1);
  const eIdx = s.search(/[eE]/);
  if (eIdx !== -1) s = s.slice(0, eIdx);
  s = s.replace('.', '');
  s = s.replace(/^0+/, '');
  return s;
}

/**
 * Count matching significant digits between two numeric strings.
 * Returns the number of leading digits that agree.
 */
function matchingDigits(a: string, b: string): number {
  const da = sigDigits(a);
  const db = sigDigits(b);
  const len = Math.min(da.length, db.length);
  for (let i = 0; i < len; i++) {
    if (da[i] !== db[i]) return i;
  }
  return len;
}

/**
 * Compute factorial as a BigDecimal string.
 */
function factorial(n: number): string {
  let result = 1n;
  for (let i = 2; i <= n; i++) result *= BigInt(i);
  return result.toString();
}

function withPrecision<T>(prec: number, fn: () => T): T {
  const savedBD = BigDecimal.precision;
  const savedDJ = Decimal.precision;
  try {
    BigDecimal.precision = prec;
    Decimal.set({ precision: prec });
    return fn();
  } finally {
    BigDecimal.precision = savedBD;
    Decimal.set({ precision: savedDJ });
  }
}

/**
 * Run a precision comparison and return a summary string for snapshot testing.
 *
 * `ourFn` computes the BigDecimal result at the given precision.
 * `refFn` computes the reference result (decimal.js or exact) at the given precision.
 */
function precisionReport(
  label: string,
  precisions: number[],
  ourFn: (prec: number) => string,
  refFn: (prec: number) => string
): string {
  const lines: string[] = [label];
  for (const prec of precisions) {
    const ours = ourFn(prec);
    const ref = refFn(prec);
    const digits = matchingDigits(ours, ref);
    lines.push(`  prec=${prec}: ${digits} matching digits (of ${prec})`);
  }
  return lines.join('\n');
}

// ---------- Tests ----------

const PRECS = [50, 100, 500];

// ================================================================
// Arithmetic (div, sqrt) — compare with decimal.js
// ================================================================

describe('Precision: Arithmetic vs decimal.js', () => {
  test('1/7', () => {
    const report = precisionReport(
      '1/7',
      PRECS,
      (p) =>
        withPrecision(p, () =>
          new BigDecimal('1').div(new BigDecimal('7')).toString()
        ),
      (p) => withPrecision(p, () => new Decimal('1').div('7').toString())
    );
    expect(report).toMatchInlineSnapshot(`
      "1/7
        prec=50: 50 matching digits (of 50)
        prec=100: 100 matching digits (of 100)
        prec=500: 500 matching digits (of 500)"
    `);
  });

  test('22/7', () => {
    const report = precisionReport(
      '22/7',
      PRECS,
      (p) =>
        withPrecision(p, () =>
          new BigDecimal('22').div(new BigDecimal('7')).toString()
        ),
      (p) => withPrecision(p, () => new Decimal('22').div('7').toString())
    );
    expect(report).toMatchInlineSnapshot(`
      "22/7
        prec=50: 50 matching digits (of 50)
        prec=100: 100 matching digits (of 100)
        prec=500: 500 matching digits (of 500)"
    `);
  });

  test('sqrt(2)', () => {
    const report = precisionReport(
      'sqrt(2)',
      PRECS,
      (p) => withPrecision(p, () => new BigDecimal('2').sqrt().toString()),
      (p) => withPrecision(p, () => Decimal.sqrt('2').toString())
    );
    expect(report).toMatchInlineSnapshot(`
      "sqrt(2)
        prec=50: 50 matching digits (of 50)
        prec=100: 100 matching digits (of 100)
        prec=500: 500 matching digits (of 500)"
    `);
  });

  test('sqrt(3)', () => {
    const report = precisionReport(
      'sqrt(3)',
      PRECS,
      (p) => withPrecision(p, () => new BigDecimal('3').sqrt().toString()),
      (p) => withPrecision(p, () => Decimal.sqrt('3').toString())
    );
    expect(report).toMatchInlineSnapshot(`
      "sqrt(3)
        prec=50: 50 matching digits (of 50)
        prec=100: 100 matching digits (of 100)
        prec=500: 500 matching digits (of 500)"
    `);
  });
});

// ================================================================
// Transcendentals — compare with decimal.js
// ================================================================

describe('Precision: Transcendentals vs decimal.js', () => {
  test('exp(1)', () => {
    const report = precisionReport(
      'exp(1)',
      PRECS,
      (p) => withPrecision(p, () => new BigDecimal('1').exp().toString()),
      (p) => withPrecision(p, () => Decimal.exp('1').toString())
    );
    expect(report).toMatchInlineSnapshot(`
      "exp(1)
        prec=50: 47 matching digits (of 50)
        prec=100: 100 matching digits (of 100)
        prec=500: 500 matching digits (of 500)"
    `);
  });

  test('exp(0.5)', () => {
    const report = precisionReport(
      'exp(0.5)',
      PRECS,
      (p) => withPrecision(p, () => new BigDecimal('0.5').exp().toString()),
      (p) => withPrecision(p, () => Decimal.exp('0.5').toString())
    );
    expect(report).toMatchInlineSnapshot(`
      "exp(0.5)
        prec=50: 50 matching digits (of 50)
        prec=100: 100 matching digits (of 100)
        prec=500: 500 matching digits (of 500)"
    `);
  });

  test('exp(10)', () => {
    const report = precisionReport(
      'exp(10)',
      PRECS,
      (p) => withPrecision(p, () => new BigDecimal('10').exp().toString()),
      (p) => withPrecision(p, () => Decimal.exp('10').toString())
    );
    expect(report).toMatchInlineSnapshot(`
      "exp(10)
        prec=50: 50 matching digits (of 50)
        prec=100: 99 matching digits (of 100)
        prec=500: 500 matching digits (of 500)"
    `);
  });

  test('exp(-1)', () => {
    const report = precisionReport(
      'exp(-1)',
      PRECS,
      (p) => withPrecision(p, () => new BigDecimal('-1').exp().toString()),
      (p) => withPrecision(p, () => Decimal.exp('-1').toString())
    );
    expect(report).toMatchInlineSnapshot(`
      "exp(-1)
        prec=50: 50 matching digits (of 50)
        prec=100: 100 matching digits (of 100)
        prec=500: 500 matching digits (of 500)"
    `);
  });

  test('ln(2)', () => {
    const report = precisionReport(
      'ln(2)',
      PRECS,
      (p) => withPrecision(p, () => new BigDecimal('2').ln().toString()),
      (p) => withPrecision(p, () => Decimal.ln('2').toString())
    );
    expect(report).toMatchInlineSnapshot(`
      "ln(2)
        prec=50: 50 matching digits (of 50)
        prec=100: 100 matching digits (of 100)
        prec=500: 500 matching digits (of 500)"
    `);
  });

  test('ln(10)', () => {
    const report = precisionReport(
      'ln(10)',
      PRECS,
      (p) => withPrecision(p, () => new BigDecimal('10').ln().toString()),
      (p) => withPrecision(p, () => Decimal.ln('10').toString())
    );
    expect(report).toMatchInlineSnapshot(`
      "ln(10)
        prec=50: 50 matching digits (of 50)
        prec=100: 100 matching digits (of 100)
        prec=500: 499 matching digits (of 500)"
    `);
  });

  test('ln(0.5)', () => {
    const report = precisionReport(
      'ln(0.5)',
      PRECS,
      (p) => withPrecision(p, () => new BigDecimal('0.5').ln().toString()),
      (p) => withPrecision(p, () => Decimal.ln('0.5').toString())
    );
    expect(report).toMatchInlineSnapshot(`
      "ln(0.5)
        prec=50: 50 matching digits (of 50)
        prec=100: 100 matching digits (of 100)
        prec=500: 500 matching digits (of 500)"
    `);
  });
});

// ================================================================
// Trigonometry — compare with decimal.js
// ================================================================

describe('Precision: Trigonometry vs decimal.js', () => {
  test('sin(1)', () => {
    const report = precisionReport(
      'sin(1)',
      PRECS,
      (p) => withPrecision(p, () => new BigDecimal('1').sin().toString()),
      (p) => withPrecision(p, () => Decimal.sin('1').toString())
    );
    expect(report).toMatchInlineSnapshot(`
      "sin(1)
        prec=50: 50 matching digits (of 50)
        prec=100: 100 matching digits (of 100)
        prec=500: 499 matching digits (of 500)"
    `);
  });

  test('sin(0.5)', () => {
    const report = precisionReport(
      'sin(0.5)',
      PRECS,
      (p) => withPrecision(p, () => new BigDecimal('0.5').sin().toString()),
      (p) => withPrecision(p, () => Decimal.sin('0.5').toString())
    );
    expect(report).toMatchInlineSnapshot(`
      "sin(0.5)
        prec=50: 49 matching digits (of 50)
        prec=100: 100 matching digits (of 100)
        prec=500: 500 matching digits (of 500)"
    `);
  });

  test('sin(2)', () => {
    const report = precisionReport(
      'sin(2)',
      PRECS,
      (p) => withPrecision(p, () => new BigDecimal('2').sin().toString()),
      (p) => withPrecision(p, () => Decimal.sin('2').toString())
    );
    expect(report).toMatchInlineSnapshot(`
      "sin(2)
        prec=50: 50 matching digits (of 50)
        prec=100: 100 matching digits (of 100)
        prec=500: 500 matching digits (of 500)"
    `);
  });

  test('cos(1)', () => {
    const report = precisionReport(
      'cos(1)',
      PRECS,
      (p) => withPrecision(p, () => new BigDecimal('1').cos().toString()),
      (p) => withPrecision(p, () => Decimal.cos('1').toString())
    );
    expect(report).toMatchInlineSnapshot(`
      "cos(1)
        prec=50: 50 matching digits (of 50)
        prec=100: 100 matching digits (of 100)
        prec=500: 500 matching digits (of 500)"
    `);
  });

  test('cos(0.5)', () => {
    const report = precisionReport(
      'cos(0.5)',
      PRECS,
      (p) => withPrecision(p, () => new BigDecimal('0.5').cos().toString()),
      (p) => withPrecision(p, () => Decimal.cos('0.5').toString())
    );
    expect(report).toMatchInlineSnapshot(`
      "cos(0.5)
        prec=50: 50 matching digits (of 50)
        prec=100: 100 matching digits (of 100)
        prec=500: 500 matching digits (of 500)"
    `);
  });

  test('atan(1)', () => {
    const report = precisionReport(
      'atan(1)',
      PRECS,
      (p) => withPrecision(p, () => new BigDecimal('1').atan().toString()),
      (p) => withPrecision(p, () => Decimal.atan('1').toString())
    );
    expect(report).toMatchInlineSnapshot(`
      "atan(1)
        prec=50: 50 matching digits (of 50)
        prec=100: 99 matching digits (of 100)
        prec=500: 500 matching digits (of 500)"
    `);
  });

  test('atan(0.5)', () => {
    const report = precisionReport(
      'atan(0.5)',
      PRECS,
      (p) => withPrecision(p, () => new BigDecimal('0.5').atan().toString()),
      (p) => withPrecision(p, () => Decimal.atan('0.5').toString())
    );
    expect(report).toMatchInlineSnapshot(`
      "atan(0.5)
        prec=50: 50 matching digits (of 50)
        prec=100: 100 matching digits (of 100)
        prec=500: 500 matching digits (of 500)"
    `);
  });
});

// ================================================================
// Gamma — compare against known exact values
// ================================================================

describe('Precision: Gamma (vs exact values)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ComputeEngine } = require('../../src/compute-engine');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const {
    bigGamma,
  } = require('../../src/compute-engine/numerics/special-functions');

  function gammaReport(
    label: string,
    z: string,
    refFn: (prec: number) => string
  ): string {
    const lines: string[] = [label];
    for (const prec of [50, 100]) {
      BigDecimal.precision = prec;
      const ce = new ComputeEngine();
      ce.precision = prec;
      const result: BigDecimal = bigGamma(ce, new BigDecimal(z));
      const resultStr = result.toString();
      const ref = refFn(prec);
      const digits = matchingDigits(resultStr, ref);
      lines.push(
        `  prec=${prec}: ${digits} matching digits — got ${resultStr.slice(
          0,
          50
        )}${resultStr.length > 50 ? '...' : ''}`
      );
      BigDecimal.precision = 50;
    }
    return lines.join('\n');
  }

  // Gamma(n) = (n-1)! for positive integers

  test('Gamma(1) = 1', () => {
    expect(gammaReport('Gamma(1) = 0! = 1', '1', () => '1'))
      .toMatchInlineSnapshot(`
      "Gamma(1) = 0! = 1
        prec=50: 1 matching digits — got 1
        prec=100: 1 matching digits — got 1"
    `);
  });

  test('Gamma(2) = 1', () => {
    expect(gammaReport('Gamma(2) = 1! = 1', '2', () => '1'))
      .toMatchInlineSnapshot(`
      "Gamma(2) = 1! = 1
        prec=50: 1 matching digits — got 1
        prec=100: 1 matching digits — got 1"
    `);
  });

  test('Gamma(3) = 2', () => {
    expect(gammaReport('Gamma(3) = 2! = 2', '3', () => '2'))
      .toMatchInlineSnapshot(`
      "Gamma(3) = 2! = 2
        prec=50: 1 matching digits — got 2
        prec=100: 1 matching digits — got 2"
    `);
  });

  test('Gamma(5) = 24', () => {
    expect(gammaReport('Gamma(5) = 4! = 24', '5', () => '24'))
      .toMatchInlineSnapshot(`
      "Gamma(5) = 4! = 24
        prec=50: 2 matching digits — got 24
        prec=100: 2 matching digits — got 24"
    `);
  });

  test('Gamma(10) = 362880', () => {
    expect(gammaReport('Gamma(10) = 9! = 362880', '10', () => '362880'))
      .toMatchInlineSnapshot(`
      "Gamma(10) = 9! = 362880
        prec=50: 6 matching digits — got 362880
        prec=100: 6 matching digits — got 362880"
    `);
  });

  test('Gamma(15) = 14!', () => {
    expect(gammaReport('Gamma(15) = 14!', '15', () => factorial(14)))
      .toMatchInlineSnapshot(`
      "Gamma(15) = 14!
        prec=50: 11 matching digits — got 87178291200
        prec=100: 11 matching digits — got 87178291200"
    `);
  });

  test('Gamma(20) = 19!', () => {
    expect(gammaReport('Gamma(20) = 19!', '20', () => factorial(19)))
      .toMatchInlineSnapshot(`
      "Gamma(20) = 19!
        prec=50: 18 matching digits — got 121645100408832000
        prec=100: 18 matching digits — got 121645100408832000"
    `);
  });

  // Gamma(1/2) = sqrt(pi)
  test('Gamma(1/2) = sqrt(pi)', () => {
    expect(
      gammaReport('Gamma(1/2) = sqrt(pi)', '0.5', (prec) => {
        BigDecimal.precision = prec + 50;
        const ref = BigDecimal.PI.sqrt().toString();
        BigDecimal.precision = prec;
        return ref;
      })
    ).toMatchInlineSnapshot(`
      "Gamma(1/2) = sqrt(pi)
        prec=50: 49 matching digits — got 1.772453850905516027298167483341145182797549456122...
        prec=100: 99 matching digits — got 1.772453850905516027298167483341145182797549456122..."
    `);
  });

  // Gamma(3/2) = sqrt(pi)/2
  test('Gamma(3/2) = sqrt(pi)/2', () => {
    expect(
      gammaReport('Gamma(3/2) = sqrt(pi)/2', '1.5', (prec) => {
        BigDecimal.precision = prec + 50;
        const ref = BigDecimal.PI.sqrt().div(BigDecimal.TWO).toString();
        BigDecimal.precision = prec;
        return ref;
      })
    ).toMatchInlineSnapshot(`
      "Gamma(3/2) = sqrt(pi)/2
        prec=50: 48 matching digits — got 0.886226925452758013649083741670572591398774728061...
        prec=100: 99 matching digits — got 0.886226925452758013649083741670572591398774728061..."
    `);
  });

  test('Gamma precision scales with BigDecimal.precision', () => {
    // At prec=500, integer Gamma should give all 500 digits exact,
    // and Gamma(1/2) should give ~495 digits matching sqrt(pi)
    const prec = 500;
    BigDecimal.precision = prec;
    const ce = new ComputeEngine();
    ce.precision = prec;

    // Integer: Gamma(10) = 9! = 362880 (exact)
    const g10: BigDecimal = bigGamma(ce, new BigDecimal('10'));
    expect(g10.toString()).toBe('362880');

    // Half-integer: Gamma(1/2) = sqrt(pi)
    BigDecimal.precision = prec + 50;
    const sqrtPiRef = BigDecimal.PI.sqrt().toString();
    BigDecimal.precision = prec;
    const g05: BigDecimal = bigGamma(ce, new BigDecimal('0.5'));
    const digits05 = matchingDigits(g05.toString(), sqrtPiRef);
    expect(digits05).toBeGreaterThan(100); // currently ~16

    BigDecimal.precision = 50; // restore
  });
});

// ================================================================
// Composite operations — identity checks
// ================================================================

describe('Precision: Identity checks', () => {
  // exp(ln(x)) should equal x
  test('exp(ln(42.5)) vs 42.5', () => {
    const report = precisionReport(
      'exp(ln(42.5)) vs 42.5',
      PRECS,
      (p) =>
        withPrecision(p, () => new BigDecimal('42.5').ln().exp().toString()),
      (_p) => '42.5'
    );
    expect(report).toMatchInlineSnapshot(`
      "exp(ln(42.5)) vs 42.5
        prec=50: 3 matching digits (of 50)
        prec=100: 3 matching digits (of 100)
        prec=500: 2 matching digits (of 500)"
    `);
  });

  // sin²(x) + cos²(x) should equal 1
  test('sin²(1.234) + cos²(1.234) vs 1', () => {
    const report = precisionReport(
      'sin²+cos² identity',
      PRECS,
      (p) =>
        withPrecision(p, () => {
          const x = new BigDecimal('1.234');
          const s = x.sin();
          const c = x.cos();
          return s.mul(s).add(c.mul(c)).toString();
        }),
      (_p) => '1'
    );
    expect(report).toMatchInlineSnapshot(`
      "sin²+cos² identity
        prec=50: 1 matching digits (of 50)
        prec=100: 0 matching digits (of 100)
        prec=500: 0 matching digits (of 500)"
    `);
  });

  // exp(x)*exp(-x) should equal 1
  test('exp(3.7)*exp(-3.7) vs 1', () => {
    const report = precisionReport(
      'exp(x)*exp(-x) identity',
      PRECS,
      (p) =>
        withPrecision(p, () => {
          const x = new BigDecimal('3.7');
          return x.exp().mul(x.neg().exp()).toString();
        }),
      (_p) => '1'
    );
    expect(report).toMatchInlineSnapshot(`
      "exp(x)*exp(-x) identity
        prec=50: 1 matching digits (of 50)
        prec=100: 0 matching digits (of 100)
        prec=500: 1 matching digits (of 500)"
    `);
  });

  // ln(a*b) vs ln(a)+ln(b)
  test('ln(3.14*2.72) vs ln(3.14)+ln(2.72)', () => {
    const report = precisionReport(
      'ln(a*b) vs ln(a)+ln(b)',
      PRECS,
      (p) =>
        withPrecision(p, () => {
          const a = new BigDecimal('3.14');
          const b = new BigDecimal('2.72');
          return a.mul(b).ln().toString();
        }),
      (p) =>
        withPrecision(p, () => {
          const a = new BigDecimal('3.14');
          const b = new BigDecimal('2.72');
          return a.ln().add(b.ln()).toString();
        })
    );
    expect(report).toMatchInlineSnapshot(`
      "ln(a*b) vs ln(a)+ln(b)
        prec=50: 50 matching digits (of 50)
        prec=100: 100 matching digits (of 100)
        prec=500: 500 matching digits (of 500)"
    `);
  });
});

// ================================================================
// Bernoulli number computation
// ================================================================

describe('Bernoulli number computation', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const {
    computeBernoulliEven,
  } = require('../../src/compute-engine/numerics/special-functions');

  test('first 5 Bernoulli numbers are exact', () => {
    const bernoulli = computeBernoulliEven(5);
    // B_2 = 1/6
    expect(bernoulli[0][0]).toBe(1n);
    expect(bernoulli[0][1]).toBe(6n);
    // B_4 = -1/30
    expect(bernoulli[1][0]).toBe(-1n);
    expect(bernoulli[1][1]).toBe(30n);
    // B_6 = 1/42
    expect(bernoulli[2][0]).toBe(1n);
    expect(bernoulli[2][1]).toBe(42n);
    // B_8 = -1/30
    expect(bernoulli[3][0]).toBe(-1n);
    expect(bernoulli[3][1]).toBe(30n);
    // B_10 = 5/66
    expect(bernoulli[4][0]).toBe(5n);
    expect(bernoulli[4][1]).toBe(66n);
  });

  test('can compute 200 Bernoulli numbers without error', () => {
    const bernoulli = computeBernoulliEven(200);
    expect(bernoulli.length).toBe(200);
    // All denominators should be positive
    for (const [_num, den] of bernoulli) {
      expect(den > 0n).toBe(true);
    }
  });
});

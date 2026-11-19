import { ComputeEngine } from '../../src/compute-engine';
import { BigDecimal } from '../../src/big-decimal';

// ζ(s) at a real s within 10^-j of 1 (the pole) or of 0, −2, −4, … (the
// trivial zeros, and ζ(0), the product of the zero of the sine and the pole
// ζ(1 − s)): the value is a quotient or product with a factor of size 10^-j,
// and `bigZeta` (`numerics/special-functions.ts`) raises its guard digits by
// j so the digits are relative to the result. It declines (the call stays
// unevaluated) when j passes 500.
//
// Reference values are mpmath's `zeta` at 90 digits.

const relativeError = (got: string, want: string) => {
  const w = new BigDecimal(want);
  return new BigDecimal(got).sub(w, 200).abs().div(w.abs(), 60);
};

const within = (got: string, want: string, digits: number) =>
  relativeError(got, want).lt(new BigDecimal(`1e-${digits - 1}`));

// s = n + sign · 10^-k, as an exact decimal string
const decimal = (n: number, sign: 1 | -1, k: number) => {
  const num = BigInt(n) * 10n ** BigInt(k) + BigInt(sign);
  const neg = num < 0n;
  const digits = (neg ? -num : num).toString().padStart(k + 1, '0');
  return `${neg ? '-' : ''}${digits.slice(0, -k)}.${digits.slice(-k)}`;
};

const exact = (n: number, sign: 1 | -1, k: number) => [
  'Add',
  n,
  sign === 1 ? ['Power', 10, -k] : ['Negate', ['Power', 10, -k]],
];

// [n, sign, k, ζ(s) to 30 digits, ζ(s) to 50 digits]
const cases: [number, 1 | -1, number, string, string][] = [
  [
    0,
    -1,
    30,
    '-0.499999999999999999999999999999',
    '-0.49999999999999999999999999999908106146679532725822',
  ],
  [
    -2,
    -1,
    30,
    '3.04484570583932707802515304711e-32',
    '3.0448457058393270780251530471121894888906770947179e-32',
  ],
  [
    -10,
    -1,
    30,
    '1.89299263381403742289805022904e-32',
    '1.892992633814037422898050229035651632975695383312e-32',
  ],
  [
    1,
    1,
    30,
    '1000000000000000000000000000000.577215664901532860607',
    '1000000000000000000000000000000.5772156649015328606',
  ],
  [
    1,
    -1,
    30,
    '-999999999999999999999999999999.422784335098467139',
    '-999999999999999999999999999999.42278433509846713939',
  ],
  [
    -4,
    1,
    40,
    '7.98381145026862428069667079879e-43',
    '7.9838114502686242806966707987893039052379802330912e-43',
  ],
  [
    0,
    1,
    40,
    '-0.5000000000000000000000000000000000000000918938533',
    '-0.50000000000000000000000000000000000000009189385332',
  ],
];

describe('Zeta near the pole and the trivial zeros', () => {
  for (const digits of [30, 50]) {
    describe(`at ${digits} digits`, () => {
      const ce = new ComputeEngine();
      const run = (expr: ReturnType<typeof ce.box>) => {
        ce.precision = digits;
        return expr.N().toString();
      };
      for (const [n, sign, k, w30, w50] of cases) {
        const want = digits === 30 ? w30 : w50;
        const label = `s = ${n} ${sign > 0 ? '+' : '-'} 1e-${k}`;
        test(`${label}: a float operand`, () => {
          ce.precision = 400;
          const e = ce.box(['Zeta', ce.number(decimal(n, sign, k))]);
          expect(within(run(e), want, digits)).toBe(true);
        });
        test(`${label}: an exact operand`, () => {
          ce.precision = 400;
          const e = ce.box(['Zeta', exact(n, sign, k) as any]);
          expect(within(run(e), want, digits)).toBe(true);
        });
        test(`${label}: parsed from LaTeX`, () => {
          ce.precision = 400;
          const e = ce.parse(`\\zeta\\left(${decimal(n, sign, k)}\\right)`);
          expect(within(run(e), want, digits)).toBe(true);
        });
        test(`${label}: evaluate() of a float operand`, () => {
          ce.precision = 400;
          const e = ce.box(['Zeta', ce.number(decimal(n, sign, k))]);
          ce.precision = digits;
          expect(within(e.evaluate().toString(), want, digits)).toBe(true);
        });
      }
    });
  }

  test('past 500 guard digits the call stays unevaluated', () => {
    const ce = new ComputeEngine();
    ce.precision = 1200;
    const near1 = ce.number(decimal(1, 1, 600));
    const nearZero = ce.number(decimal(-2, 1, 600));
    ce.precision = 30;
    expect(ce.box(['Zeta', near1]).N().operator).toBe('Zeta');
    expect(ce.box(['Zeta', nearZero]).N().operator).toBe('Zeta');
  });

  test('machine precision is unchanged', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    expect(ce.box(['Zeta', -2.00001]).N().re).toBeCloseTo(
      3.0448128242199204e-7,
      16
    );
    expect(ce.box(['Zeta', 1.001]).N().re).toBeCloseTo(1000.5772884759015, 6);
    expect(ce.box(['Zeta', -0.00001]).N().re).toBeCloseTo(
      -0.49999081071498478,
      12
    );
  });
});

// HurwitzZeta(s, a) within 1.1e-16 of s = 1: the double of s is exactly 1, and
// the Euler-Maclaurin planner (`hurwitzLog10Estimate`, `hurwitzZetaBigPlan`,
// `numerics/special-functions.ts`) read log10|s − 1| from it, an infinite size
// that ended in a RangeError. It reads the distance from the operand now.
// [a, sign, k, ζ(1 + sign · 10^-k, a) to 64 digits]
const hurwitzCases: [string, 1 | -1, number, string][] = [
  [
    '0.25',
    1,
    16,
    '10000000000000004.22745353337626595989716516603709724529047795896',
  ],
  [
    '0.25',
    -1,
    16,
    '-9999999999999995.772546466623735143718104873843653293511730996376',
  ],
  [
    '0.25',
    1,
    20,
    '100000000000000000004.2274535333762654081447109095986776148945685',
  ],
  [
    '0.25',
    -1,
    20,
    '-99999999999999999995.77254646662373459196565061740531046015931169',
  ],
  [
    '0.25',
    1,
    30,
    '1000000000000000000000000000004.227453533376265408089530146102202',
  ],
  [
    '0.25',
    -1,
    30,
    '-999999999999999999999999999995.7725464666237345919104698539088345',
  ],
  [
    '3',
    1,
    16,
    '9999999999999999.077215664901532902545455666447339138378052236474',
  ],
  [
    '3',
    -1,
    16,
    '-10000000000000000.92278433509846718133243148628253677546243508432',
  ],
  [
    '3',
    1,
    20,
    '99999999999999999999.07721566490153286061070598444003892483783886',
  ],
  [
    '3',
    -1,
    20,
    '-100000000000000000000.9227843350984671393976818042752340627535452',
  ],
  [
    '3',
    1,
    30,
    '999999999999999999999999999999.0772156649015328606065120900828218',
  ],
  [
    '3',
    -1,
    30,
    '-1000000000000000000000000000000.922784335098467139393487909918017',
  ],
];

describe('HurwitzZeta next to the pole at s = 1', () => {
  for (const digits of [30, 50]) {
    for (const [a, sign, k, want] of hurwitzCases) {
      const label = `${digits} digits, a = ${a}, s = 1 ${sign > 0 ? '+' : '-'} 1e-${k}`;
      const make = (ce: ComputeEngine) => {
        ce.precision = 400;
        const e = ce.box([
          'HurwitzZeta',
          ce.number(decimal(1, sign, k)),
          ce.number(a),
        ]);
        ce.precision = digits;
        return e;
      };
      test(`${label}: N()`, () => {
        const ce = new ComputeEngine();
        expect(within(make(ce).N().toString(), want, digits)).toBe(true);
      });
      test(`${label}: evaluate()`, () => {
        const ce = new ComputeEngine();
        expect(within(make(ce).evaluate().toString(), want, digits)).toBe(true);
      });
    }
  }
});

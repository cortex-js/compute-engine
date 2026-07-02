import { ComputeEngine } from '../../../src/compute-engine';
import { order } from '../../../src/compute-engine/boxed-expression/order';

/**
 * NIGHTLY — comparison symmetry / totality matrices.
 *
 * Ported from the COMPARE review harness (`matrix.ts`, `compare/b1-symmetry.ts`,
 * `compare/b5-order.ts`). Three matrices over broad representation pools:
 *
 *   1. isSame is an equivalence relation — reflexive, symmetric, transitive
 *      (matrix.ts).
 *   2. isSame / is / isEqual are all SYMMETRIC across representation pairs
 *      (b1-symmetry.ts; the `.is()` and `.isEqual()` symmetry contract).
 *   3. order() is a total order — reflexive (order(x,x)=0), antisymmetric
 *      (sgn(order(a,b)) = −sgn(order(b,a))), transitive, and TOTAL (never NaN,
 *      including the NaN literal's rank) (b5-order.ts, "cmp totality").
 */

const NIGHTLY = process.env.CE_NIGHTLY === '1';
const describeNightly = NIGHTLY ? describe : describe.skip;

const ce = new ComputeEngine();
ce.assign('one', 1);
ce.assign('third', ce.expr(['Rational', 1, 3]));
ce.assign('zc', ce.expr(['Complex', 1, 1]));
ce.assign('g', ce.parse('x^2+1'));

// ── Pool for the isSame equivalence matrix (matrix.ts). ──
const EQ_POOL: [string, any][] = [
  ['int1', ce.number(1)],
  ['sym one(:=1)', ce.symbol('one')],
  ['Rational(1,3)', ce.box(['Rational', 1, 3])],
  ['sym third(:=1/3)', ce.symbol('third')],
  ['machine .3333...', ce.number(0.3333333333333333)],
  ['30d .333...', ce.parse('0.333333333333333333333333333333')],
  ['half', ce.box(['Rational', 1, 2])],
  ['0.5', ce.number(0.5)],
  ['Sqrt2', ce.box(['Sqrt', 2])],
  ['sqrt2 machine', ce.number(Math.SQRT2)],
  ['Complex(0,1)', ce.box(['Complex', 0, 1])],
  ['ImaginaryUnit', ce.symbol('ImaginaryUnit')],
  ['Complex(1,1)', ce.box(['Complex', 1, 1])],
  ['zc(:=1+i)', ce.symbol('zc')],
  ['x^2+1', ce.parse('x^2+1')],
  ['g(:=x^2+1)', ce.symbol('g')],
  ['x', ce.symbol('x')],
  ['y', ce.symbol('y')],
  ['Pi', ce.symbol('Pi')],
  ['str"a"', ce.string('a')],
  ['True', ce.symbol('True')],
];

describeNightly('NIGHTLY comparison — isSame is an equivalence relation', () => {
  it('reflexive', () => {
    const bad: string[] = [];
    for (const [n, a] of EQ_POOL) if (!a.isSame(a)) bad.push(n);
    expect(bad).toEqual([]);
  });

  it('symmetric and transitive', () => {
    const n = EQ_POOL.length;
    const M: boolean[][] = [];
    for (let i = 0; i < n; i++) {
      M[i] = [];
      for (let j = 0; j < n; j++) M[i][j] = EQ_POOL[i][1].isSame(EQ_POOL[j][1]);
    }
    const symBad: string[] = [];
    const transBad: string[] = [];
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        if (M[i][j] !== M[j][i])
          symBad.push(`${EQ_POOL[i][0]} vs ${EQ_POOL[j][0]}: ${M[i][j]}/${M[j][i]}`);
        for (let k = 0; k < n; k++)
          if (M[i][j] && M[j][k] && !M[i][k])
            transBad.push(`${EQ_POOL[i][0]}~${EQ_POOL[j][0]}~${EQ_POOL[k][0]}`);
      }
    expect(symBad).toEqual([]);
    expect(transBad).toEqual([]);
  });
});

// ── Pool for the is/isEqual/isSame symmetry matrix (b1-symmetry.ts). ──
const SYM_POOL: [string, any][] = [
  ['machineInt 2', ce.number(2)],
  ['machineFloat 0.5', ce.number(0.5)],
  ['machineFloat 0.3333333333333333', ce.number(0.3333333333333333)],
  ['rational 1/3', ce.expr(['Rational', 1, 3])],
  ['rational 1/2', ce.expr(['Rational', 1, 2])],
  ['bigintRational', ce.expr(['Rational', { num: '10000000000000000000000000000001' }, { num: '30000000000000000000000000000003' }])],
  ['sqrt2', ce.expr(['Sqrt', 2]).evaluate()],
  ['onePlusSqrt2', ce.expr(['Add', 1, ['Sqrt', 2]]).evaluate()],
  ['complexMachine 1+i', ce.expr(['Complex', 1, 1])],
  ['complexPure i', ce.expr(['Complex', 0, 1])],
  ['imaginaryUnit', ce.symbol('ImaginaryUnit')],
  ['freeSym x', ce.symbol('x')],
  ['int 1', ce.number(1)],
  ['negZero', ce.number(-0)],
  ['zero', ce.number(0)],
  ['NaN', ce.number(NaN)],
  ['posInf', ce.number(Infinity)],
  ['negInf', ce.number(-Infinity)],
  ['ComplexInfinity', ce.symbol('ComplexInfinity')],
  ['string "abc"', ce.string('abc')],
  ['symbol True', ce.symbol('True')],
  ['list [1,2]', ce.expr(['List', 1, 2])],
  ['bignum 1/3 @30', ce.parse('0.333333333333333333333333333333')],
  ['pi', ce.symbol('Pi')],
  ['pi float', ce.number(Math.PI)],
  ['add x+1', ce.expr(['Add', 'x', 1])],
];

describeNightly('NIGHTLY comparison — isSame/is/isEqual are symmetric', () => {
  const safe = (f: () => any): string => {
    try {
      const v = f();
      return v === undefined ? 'undef' : String(v);
    } catch (e: any) {
      return 'THROW:' + String(e?.message).slice(0, 40);
    }
  };
  for (const m of ['isSame', 'is', 'isEqual'] as const) {
    it(`${m}(a,b) === ${m}(b,a)`, () => {
      const asym: string[] = [];
      for (let i = 0; i < SYM_POOL.length; i++)
        for (let j = i + 1; j < SYM_POOL.length; j++) {
          const [na, a] = SYM_POOL[i];
          const [nb, b] = SYM_POOL[j];
          const ab = safe(() => a[m](b));
          const ba = safe(() => b[m](a));
          if (ab !== ba) asym.push(`[${na}].${m}([${nb}])=${ab} but reversed=${ba}`);
        }
      expect(asym).toEqual([]);
    });
  }
});

// ── Pool for the order() total-order matrix (b5-order.ts). ──
function orderPool(): any[] {
  return [
    ce.number(1), ce.number(-2), ce.number(0.5), ce.number(3.7),
    ce.number(NaN), ce.number(Infinity), ce.number(-Infinity),
    ce.expr(['Rational', 1, 3]), ce.expr(['Rational', -7, 2]),
    ce.expr(['Sqrt', 2]).evaluate(), ce.expr(['Sqrt', 5]).evaluate(),
    ce.expr(['Complex', 1, 1]), ce.expr(['Complex', 0, 1]), ce.expr(['Complex', 2, -3]),
    ce.symbol('ImaginaryUnit'), ce.symbol('Pi'), ce.symbol('ExponentialE'),
    ce.symbol('x'), ce.symbol('y'), ce.symbol('zz'),
    ce.parse('x^2'), ce.parse('x^3'), ce.parse('y^2'),
    ce.parse('x y'), ce.parse('2 x'), ce.parse('x+y'), ce.parse('x+1'),
    ce.parse('\\sin(x)'), ce.parse('\\cos(x)'), ce.parse('\\sin(y)'),
    ce.parse('\\ln(x)'), ce.parse('f(x)'),
    ce.parse('\\frac{x}{y}'), ce.parse('\\frac{1}{x}'),
    ce.string('abc'), ce.string('abd'), ce.symbol('True'),
    ce.expr(['List', 1, 2]), ce.parse('x^2+x'), ce.parse('x^2+y^2'),
  ];
}
const sgn = (n: number) => (n < 0 ? -1 : n > 0 ? 1 : n === 0 ? 0 : NaN);

describeNightly('NIGHTLY comparison — order() is a total order', () => {
  const xs = orderPool();

  it('reflexive: order(x,x) === 0', () => {
    const bad: string[] = [];
    for (const x of xs) if (order(x, x) !== 0) bad.push(x.toString());
    expect(bad).toEqual([]);
  });

  it('total: order(a,b) is never NaN (incl. NaN-literal rank)', () => {
    const nanPairs: string[] = [];
    for (const a of xs)
      for (const b of xs)
        if (Number.isNaN(order(a, b)))
          nanPairs.push(`order(${a}, ${b})`);
    expect(nanPairs).toEqual([]);
  });

  it('antisymmetric: sgn(order(a,b)) === −sgn(order(b,a))', () => {
    const bad: string[] = [];
    for (const a of xs)
      for (const b of xs) {
        const ab = order(a, b);
        const ba = order(b, a);
        if (sgn(ab) !== -sgn(ba)) bad.push(`order(${a},${b})=${ab} order(${b},${a})=${ba}`);
      }
    expect(bad).toEqual([]);
  });

  it('transitive: a≤b ∧ b≤c ⇒ a≤c', () => {
    const bad: string[] = [];
    for (let i = 0; i < xs.length && bad.length < 5; i++)
      for (let j = 0; j < xs.length && bad.length < 5; j++)
        for (let k = 0; k < xs.length && bad.length < 5; k++) {
          if (sgn(order(xs[i], xs[j])) <= 0 && sgn(order(xs[j], xs[k])) <= 0)
            if (sgn(order(xs[i], xs[k])) > 0)
              bad.push(`${xs[i]} ≤ ${xs[j]} ≤ ${xs[k]} but not ≤ end`);
        }
    expect(bad).toEqual([]);
  });
});

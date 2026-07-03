import { ComputeEngine } from '../../src/compute-engine';

/**
 * Regressions for the "complex-blindness" P0 cluster (WP-2.3):
 *  - P0-27 : ordering predicates (isLess/isGreater/…) returned definitive
 *            answers when one side was complex, by comparing real parts and
 *            ignoring the imaginary part. ℂ is unordered → must be `undefined`.
 *  - P0-6  : `Log(z, b)` with a complex `z` divided only the real part of
 *            `ln z` by `ln b`, so `evaluate()` disagreed with `.N()`.
 *  - P0-13 : `Max`/`Min` silently absorbed a complex operand in an
 *            order-dependent way (`Max(i,2)=i`, `Max(2,i)=2`).
 */

const ce = new ComputeEngine();

const i = ce.box(['Complex', 0, 1]);
const onePlusI = ce.box(['Complex', 1, 1]);
const complexBig = ce.box(['Complex', 2, 3]);

const realLhs: Record<string, any> = {
  'machine float 1.5': ce.number(1.5),
  'rational 1/3': ce.box(['Rational', 1, 3]),
  radical: ce.box(['Sqrt', 2]).evaluate(),
  'parsed bignum 0.5': ce.parse('0.5'),
  'machine int 2': ce.number(2),
};

const complexRhs: Record<string, any> = {
  i,
  '1+i': onePlusI,
  'complex bignum 2+3i': complexBig,
};

const preds = ['isLess', 'isGreater', 'isLessEqual', 'isGreaterEqual'] as const;

describe('P0-27 — real-vs-complex ordering is indeterminate (both operand orders)', () => {
  for (const [ln, lv] of Object.entries(realLhs)) {
    for (const [rn, rv] of Object.entries(complexRhs)) {
      for (const p of preds) {
        test(`${ln}.${p}(${rn}) → undefined`, () => {
          expect(lv[p](rv)).toBeUndefined();
        });
        test(`${rn}.${p}(${ln}) → undefined`, () => {
          expect(rv[p](lv)).toBeUndefined();
        });
      }
    }
  }

  test('ImaginaryUnit symbol vs real number → undefined', () => {
    for (const p of preds) expect(ce.symbol('ImaginaryUnit')[p](2)).toBeUndefined();
  });

  test('symbol assigned a complex value vs real number → undefined', () => {
    const e = new ComputeEngine();
    e.assign('z', e.box(['Complex', 1, 1]));
    const z = e.symbol('z');
    expect(z.isLess(2)).toBeUndefined();
    expect(z.isGreater(0)).toBeUndefined();
    expect(e.number(2).isGreater(z)).toBeUndefined();
    expect(e.number(2).isLess(z)).toBeUndefined();
  });

  test('complex literal vs symbol with an assumed real bound → undefined (both orders)', () => {
    const e = new ComputeEngine();
    e.assume(e.parse('w > 4'));
    const w = e.symbol('w');
    const c = e.box(['Complex', 1, 1]);
    for (const p of preds) {
      expect(w[p](c)).toBeUndefined();
      expect(c[p](w)).toBeUndefined();
    }
    // The bound is still usable against real numbers (control).
    expect(w.isGreater(3)).toBe(true);
    expect(w.isLessEqual(4)).toBe(false);
    expect(w.isGreater(5)).toBeUndefined();
  });
});

describe('P0-27 — real-vs-real ordering controls are unchanged', () => {
  test('literal ordering', () => {
    expect(ce.number(1).isLess(2)).toBe(true);
    expect(ce.number(2).isLess(1)).toBe(false);
    expect(ce.number(2).isGreater(1)).toBe(true);
    expect(ce.number(1.5).isLess(2)).toBe(true);
  });
  test('symbol / radical / rational ordering', () => {
    expect(ce.symbol('Pi').isLess(3.15)).toBe(true);
    expect(ce.symbol('Pi').isGreater(3)).toBe(true);
    expect(ce.number(3).isLess(ce.symbol('Pi'))).toBe(true);
    expect(ce.box(['Sqrt', 2]).evaluate().isLess(2)).toBe(true);
    expect(ce.box(['Rational', 1, 3]).isLess(ce.box(['Rational', 1, 2]))).toBe(
      true
    );
  });
});

describe('P0-6 — Log(z, b) with complex z divides the whole ln by ln(b)', () => {
  // Since D12-A, `i` boxed from ['Complex', 0, 1] is an EXACT literal, so
  // under the exactness contract evaluate() stays symbolic (like Ln(2)) and
  // only N() numericizes. The base-division regression itself (P0-6) is
  // covered by the inexact-argument tests below.
  test('Lb(i): stays symbolic under evaluate(); N() ≈ iπ/(2 ln 2)', () => {
    const e = ce.box(['Lb', ['Complex', 0, 1]]);
    expect(e.evaluate().operator).toEqual('Log');
    expect(e.N().im).toBeCloseTo(2.2661800709, 6);
  });
  test('Log(1.1+1.1i, 2): evaluate().im === N().im ≈ 1.13309', () => {
    const e = ce.box(['Log', ['Complex', 1.1, 1.1], 2]);
    expect(e.evaluate().im).toEqual(e.N().im);
    expect(e.N().im).toBeCloseTo(1.13309, 4);
  });
  test('one-arg Ln of a complex number is unaffected (no base division)', () => {
    const e = ce.box(['Ln', ['Complex', 1.1, 1.1]]);
    expect(e.evaluate().im).toBeCloseTo(0.7853981633974483, 10);
    expect(e.N().im).toBeCloseTo(0.7853981633974483, 10);
  });
});

describe('P0-13 — Max/Min stay symbolic with a non-real operand (order-independent)', () => {
  test('Max(i, 2) and Max(2, i) are both symbolic and equal', () => {
    const a = ce.box(['Max', ['Complex', 0, 1], 2]).evaluate();
    const b = ce.box(['Max', 2, ['Complex', 0, 1]]).evaluate();
    expect(a.operator).toEqual('Max');
    expect(b.operator).toEqual('Max');
    expect(a.isSame(b)).toBe(true);
  });
  test('Min(i, 2) and Min(2, i) are both symbolic', () => {
    expect(ce.box(['Min', ['Complex', 0, 1], 2]).evaluate().operator).toEqual(
      'Min'
    );
    expect(ce.box(['Min', 2, ['Complex', 0, 1]]).evaluate().operator).toEqual(
      'Min'
    );
  });
  test('real Max/Min still reduce (control)', () => {
    expect(ce.box(['Max', 2, 3]).evaluate().toString()).toEqual('3');
    expect(ce.box(['Min', 2, 3]).evaluate().toString()).toEqual('2');
    expect(ce.box(['Max', 1, 5, 3]).evaluate().toString()).toEqual('5');
    expect(ce.box(['Max', ['List', 1, 5, 3]]).evaluate().toString()).toEqual(
      '5'
    );
  });
});

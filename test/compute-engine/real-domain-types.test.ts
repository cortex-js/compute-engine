/**
 * Type handlers must not claim a REAL type where the value is complex.
 *
 * Two distinct defects, pinned separately:
 *
 * 1. `Arcosh` fell through to the generic `numericTypeHandler`, which claims
 *    `real` for any real argument. `arcosh` is real only on `[1, +∞)`;
 *    below 1 the value is complex (`arcosh(−2) = 1.3169… + iπ`), so
 *    `real` — which EXCLUDES complex — was a FALSE claim. The rest of
 *    the inverse trig / inverse hyperbolic family already routes through
 *    `boundedInverseTrigType` and is audited here as a regression guard.
 *
 * 2. `Power`/`Root` claimed the true-but-coarse `number` for a
 *    provably-negative base on the complex branch. The claim is narrowed to
 *    `complex` ONLY when the complex branch is provable — the
 *    over-widening cases below must keep their current types.
 *
 * The `Power`/`Root` branch convention is NOT "non-integer exponent ⇒
 * complex": for a negative base, an exponent that is a rational `p/q` with an
 * ODD denominator takes the REAL root (`(−8)^(2/3) = 4`, `Root(−8, 3) = −2`,
 * `Root(−8, 2.5) = −2.297…`). Every expectation below is cross-checked
 * against `.N()`.
 */

import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();
ce.declare('r', 'real');
ce.declare('n', 'real');
ce.declare('k', 'integer');

/** `true` when `.N()` has a non-zero imaginary part. */
function isComplexValued(expr: any): boolean {
  const v = expr.N();
  return v.im !== 0;
}

describe('TYPE: inverse hyperbolic / inverse trig real domains', () => {
  it('Arcosh below 1 does not claim a real type', () => {
    // The reported repro: an assigned negative value.
    const e = new ComputeEngine();
    e.assign('a', e.number(-2));
    const expr = e.box(['Arcosh', 'a']);
    expect(expr.N().im).toBeCloseTo(Math.PI, 12);
    expect(expr.type.matches('real')).toBe(false);
    // Was the coarse `number` until the 2026-07-30 ruling narrowed the bounded
    // inverse heads: an argument provably OUT of the real domain is typed by
    // the value it actually takes, and `arcosh(−2) = 1.3169… + iπ` is a FINITE
    // complex. See `inverse-trig-domain-type.test.ts`.
    expect(expr.type.toString()).toBe('complex');
  });

  it.each([-2, 0, 0.5])(
    'Arcosh(%p) is complex-valued and typed `complex`',
    (v) => {
      const expr = ce.box(['Arcosh', v]);
      expect(isComplexValued(expr)).toBe(true);
      expect(expr.type.matches('real')).toBe(false);
      expect(expr.type.toString()).toBe('complex');
    }
  );

  it.each([1, 2])('Arcosh(%p) stays `real` (in domain)', (v) => {
    const expr = ce.box(['Arcosh', v]);
    expect(isComplexValued(expr)).toBe(false);
    expect(expr.type.toString()).toBe('real');
  });

  it('Arsinh is real-closed and keeps `real`', () => {
    for (const v of [-2, 0, 0.5, 2]) {
      const expr = ce.box(['Arsinh', v]);
      expect(isComplexValued(expr)).toBe(false);
      expect(expr.type.toString()).toBe('real');
    }
  });

  // Family-wide guard: no head in the inverse trig / inverse hyperbolic
  // family may claim a real type at a point where `.N()` is complex.
  const HEADS = [
    'Arcosh',
    'Arsinh',
    'Artanh',
    'Arcoth',
    'Arsech',
    'Arcsch',
    'Arcsin',
    'Arccos',
    'Arctan',
    'Arccot',
    'Arcsec',
    'Arccsc',
  ] as const;

  it.each(HEADS)(
    '%s never claims a real type where its value is complex',
    (head) => {
      for (const v of [-2, -0.5, 0, 0.5, 1, 2]) {
        const expr = ce.box([head, v]);
        if (isComplexValued(expr))
          expect([head, v, expr.type.toString()]).toEqual([
            head,
            v,
            expect.not.stringMatching(/real|integer|rational/),
          ]);
      }
    }
  );
});

describe('TYPE: Power/Root of a negative base', () => {
  it('Power(-2, 0.3) is `complex` (was the coarse `number`)', () => {
    const expr = ce.box(['Power', -2, 0.3]);
    expect(isComplexValued(expr)).toBe(true);
    expect(expr.type.toString()).toBe('complex');
  });

  it('Root(-8, 4) is `complex` (even degree, negative radicand)', () => {
    const expr = ce.box(['Root', -8, 4]);
    expect(isComplexValued(expr)).toBe(true);
    expect(expr.type.toString()).toBe('complex');
  });

  it('Power(-2, -0.5) is `complex`', () => {
    const expr = ce.box(['Power', -2, -0.5]);
    expect(isComplexValued(expr)).toBe(true);
    expect(expr.type.toString()).toBe('complex');
  });

  //
  // Must NOT widen: an odd-denominator rational exponent takes the REAL root,
  // so these are real values and must not be claimed complex. A literal
  // rational exponent with an odd denominator, and an odd integer degree,
  // are typed `real` (non-negative for an even numerator); a float degree
  // keeps the `number` hedge.
  //
  it.each([
    [['Power', -8, ['Divide', 2, 3]], 4, 'real<0..>'],
    [['Power', -2, ['Divide', 2, 3]], 1.5874010519681994, 'real<0..>'],
    [['Root', -8, 3], -2, 'real'],
    [['Root', -8, 2.5], -2.29739670999407, 'number'],
  ] as [any, number, string][])(
    'the real branch of %j is not claimed complex',
    (mathjson, expected, type) => {
      const expr = ce.box(mathjson);
      expect(expr.N().re).toBeCloseTo(expected, 10);
      expect(isComplexValued(expr)).toBe(false);
      expect(expr.type.toString()).toBe(type);
    }
  );

  //
  // Must NOT widen: the honest hedges and the already-precise claims.
  //
  it.each([
    [['Power', 'r', 0.3], 'number'], // unknown-sign base: the hedge
    // A positive base carries positivity in the result type (ROADMAP
    // "Ranged types should carry sign…" item 4) — still no widening, the
    // claim narrowed. (`Power(-2, 2)` below folds to the literal `4` at
    // canonicalization, so its type is that literal's own type.)
    [['Power', 2, 0.3], 'real<0<..>'],
    [['Power', -2, 2], '4'],
    [['Power', 'r', 'n'], 'number'],
    [['Power', -2, 'n'], 'number'], // unprovable exponent
    [['Power', -2, 'k'], 'rational'], // integer exponent: real
    // Tightened 2026-07-31: √−2 = i√2 is FINITE, so `complex` (was
    // the looser `complex`) — part of the Sqrt unknown-sign ruling.
    [['Sqrt', -2], 'complex'],
    [['Root', 8, 4], 'real'],
    [['Root', 'r', 4], 'number'],
    [['Root', -8, 'n'], 'number'],
    [['Root', -8, 'k'], 'number'], // unknown parity: no narrowing
  ] as [any, string][])('%j keeps its type %s', (mathjson, type) => {
    expect(ce.box(mathjson).type.toString()).toBe(type);
  });
});

describe('ODD ROOT OF A REAL SYMBOL IS REAL', () => {
  // The engine takes the real root for an odd degree, for a base of either
  // sign (`Root(−8, 3) = −2`, `(−8)^(2/3) = 4`): the type of the root of a
  // real symbol of unknown sign is `real`, and non-negative for an even
  // numerator. An even denominator keeps the complex hedge.
  const ce = new ComputeEngine();
  ce.declare('a', 'real');
  ce.declare('n', 'integer');
  const typeOf = (latex: string) => ce.parse(latex).type.toString();

  test('an odd literal degree is real', () => {
    expect(typeOf('\\sqrt[3]{a}')).toBe('real');
    expect(typeOf('\\sqrt[5]{a}')).toBe('real');
    expect(typeOf('a^{1/3}')).toBe('real');
    expect(typeOf('a^{3/5}')).toBe('real');
    expect(typeOf('a^{2/3}')).toBe('real<0..>');
    expect(ce.parse('\\sqrt[3]{a}').isExtendedReal).toBe(true);
    // Cross-checked against the values.
    expect(ce.parse('\\sqrt[3]{-8}').N().re).toBe(-2);
    expect(ce.parse('(-8)^{2/3}').N().re).toBe(4);
    expect(ce.parse('(-32)^{3/5}').N().re).toBe(-8);
  });

  test('a negative exponent over a base that can be 0 admits the pole', () => {
    // `0^(-2/3)` is `~oo`: the type is not the finite `real`, as for a
    // negative integer exponent. A base proven non-zero keeps the real root.
    ce.declare('b', 'real<1..>');
    expect(ce.parse('a^{-2/3}').type.matches('real')).toBe(false);
    expect(ce.parse('a^{-2/3}').type.matches('infinity | nan | real')).toBe(
      true
    );
    expect(ce.parse('a^{-3/5}').type.matches('real')).toBe(false);
    expect(ce.parse('a^{-2/3}').subs({ a: 0 }).evaluate().toString()).toBe(
      '~oo'
    );
    expect(ce.parse('b^{-2/3}').type.matches('real')).toBe(true);
    expect(ce.parse('b^{-3/5}').type.matches('real')).toBe(true);
  });

  test('an even degree, a symbolic degree and a float exponent keep the hedge', () => {
    expect(typeOf('\\sqrt[4]{a}')).toBe('number');
    expect(typeOf('\\sqrt[n]{a}')).toBe('number');
    expect(typeOf('a^{1/2}')).toBe('complex');
    expect(typeOf('a^{0.5}')).toBe('number');
  });
});

import { ComputeEngine } from '../../src/compute-engine';
import {
  complexValueOf,
  numberLiteralOf,
  numericValueOf,
} from '../../src/compute-engine/boxed-expression/numerics';

/**
 * `numberLiteralOf` / `numericValueOf` / `complexValueOf` — the funnel for the
 * open-coded "`.N()` then discard if it isn't a number" idiom (ROADMAP.md
 * § Symbolic-evaluation performance, P2).
 *
 * The load-bearing property is the `.unknowns` gate: an expression carrying a
 * free variable must not be numericized at all, because `.N()` over nested
 * user-function applications re-walks shared sub-chains and costs ~2× per
 * level of nesting.
 */

const ce = new ComputeEngine();

describe('numberLiteralOf: the .unknowns gate', () => {
  test('numericizes when there are no free variables', () => {
    expect(numberLiteralOf(ce.parse('2 + 3'))?.re).toBe(5);
    expect(numberLiteralOf(ce.parse('\\sin(2)'))?.re).toBeCloseTo(
      0.9092974268,
      9
    );
  });

  test('declines when a free variable remains', () => {
    expect(numberLiteralOf(ce.parse('x + 1'))).toBeUndefined();
    expect(numberLiteralOf(ce.parse('\\sin(x) \\cdot 2'))).toBeUndefined();
  });

  test('an assigned symbol is not an unknown, so it still numericizes', () => {
    const scoped = new ComputeEngine();
    scoped.assign('y', scoped.parse('\\frac{\\pi}{4}'));
    expect(numberLiteralOf(scoped.parse('\\sin(y)'))?.re).toBeCloseTo(
      Math.SQRT1_2,
      12
    );
  });

  test('declines null/undefined', () => {
    expect(numberLiteralOf(null)).toBeUndefined();
    expect(numberLiteralOf(undefined)).toBeUndefined();
    expect(numericValueOf(null)).toBeUndefined();
    expect(complexValueOf(undefined)).toBeUndefined();
  });

  test('the gate is conservative, not exact: a free variable that folds away still declines', () => {
    // These DO numericize to a literal under a bare `.N()` (the fold happens
    // at evaluation, not canonicalization — `x` is still in the tree). The
    // gate declines them anyway. That is sound at every call site in this
    // family, because "no numeric value" is always the give-up branch.
    for (const src of ['0 \\times x', 'x - x', 'e^{0x}', '|x - x|']) {
      const expr = ce.parse(src);
      expect(expr.unknowns).toContain('x');
      expect(expr.N().isNumberLiteral).toBe(true); // ungated: a literal
      expect(numberLiteralOf(expr)).toBeUndefined(); // gated: declines
    }
  });

  test('a partially-numericizable symbolic identity also declines — do NOT gate a numeric probe', () => {
    // `(⁴√b/⁴√a)² − √b/√a` is identically zero for all a, b. `simplify()`
    // cannot see it, but `.N()` can: partial numericization floats the
    // exponents, both terms become `b^0.5·a^-0.5`, and Add folds them.
    //
    // This is why the gate must NOT be pushed into a site that exists to probe
    // a symbolic expression numerically. Gating Rubi's `zeroQ` on it lost a
    // closed form outright (integration-rules #544, the R28a mixed-parity
    // split); `zeroQ`, `posAux`, `numericMagnitude` and the
    // rationalize-denominator safety gate all keep a bare `.N()`.
    const s = ce.parse(
      '\\left(\\frac{\\sqrt[4]{b}}{\\sqrt[4]{a}}\\right)^2 - \\frac{\\sqrt{b}}{\\sqrt{a}}'
    );
    expect(s.unknowns).toEqual(['a', 'b']);
    expect(s.simplify().isSame(0)).toBe(false); // simplify cannot see it
    expect(s.N().isSame(0)).toBe(true); // an ungated probe can
    expect(numberLiteralOf(s)).toBeUndefined(); // the gate declines it
  });

  test('reads the exact representation, not a machine float', () => {
    // A caller needing a bignum/exact value goes through the literal.
    const lit = numberLiteralOf(ce.parse('\\frac{1}{3}'));
    expect(lit?.numericValue).toBeDefined();
  });
});

describe('numericValueOf: finite real, or nothing', () => {
  test('returns the real machine value', () => {
    expect(numericValueOf(ce.parse('2 + 3'))).toBe(5);
    expect(numericValueOf(ce.parse('\\sqrt{2}'))).toBeCloseTo(Math.SQRT2, 12);
    expect(numericValueOf(ce.parse('-\\frac{7}{2}'))).toBe(-3.5);
  });

  test('declines a complex value rather than truncating to its real part', () => {
    expect(numericValueOf(ce.parse('1 + 2i'))).toBeUndefined();
  });

  test('declines a non-finite value', () => {
    expect(numericValueOf(ce.parse('\\infty'))).toBeUndefined();
    expect(numericValueOf(ce.parse('-\\infty'))).toBeUndefined();
    expect(numericValueOf(ce.NaN)).toBeUndefined();
  });

  test('declines a non-numeric expression', () => {
    expect(numericValueOf(ce.parse('x'))).toBeUndefined();
    expect(numericValueOf(ce.string('hello'))).toBeUndefined();
    expect(numericValueOf(ce.parse('\\lbrack 1, 2 \\rbrack'))).toBeUndefined();
  });
});

describe('complexValueOf: the [re, im] pair, finiteness NOT filtered', () => {
  test('returns both parts', () => {
    expect(complexValueOf(ce.parse('1 + 2i'))).toEqual([1, 2]);
    expect(complexValueOf(ce.parse('2 + 3'))).toEqual([5, 0]);
  });

  test('passes ±∞ through, so a `magnitude > tolerance` reject still fires', () => {
    // NaN would silently pass such a test — see `numericMagnitude`.
    expect(complexValueOf(ce.parse('\\infty'))).toEqual([Infinity, 0]);
    expect(Math.hypot(...complexValueOf(ce.parse('\\infty'))!)).toBe(Infinity);
  });

  test('declines a non-numeric expression', () => {
    expect(complexValueOf(ce.parse('x + 1'))).toBeUndefined();
    expect(complexValueOf(ce.string('hello'))).toBeUndefined();
  });
});

describe('the gate is why nested applications stay cheap', () => {
  test('a discarded .N() over a deep nesting of a user function is not walked', () => {
    const engine = new ComputeEngine();
    engine.assign('f', engine.parse('x \\mapsto x + \\sin(x)'));

    // `f(f(...f(z)...))` in a FREE variable `z`: no numeric value exists, and
    // an ungated `.N()` costs ~2× per level. The gate must make the depth
    // irrelevant.
    let src = 'z';
    for (let i = 0; i < 14; i++) src = `f(${src})`;
    const expr = engine.parse(src);

    // The saving is pinned by the CALL that must not happen, not by elapsed
    // milliseconds: `numberLiteralOf` consults `.unknowns` first and returns
    // before reaching `x.N()`. Spying on `.N()` states that directly and gives
    // the same verdict on any machine, however loaded; timing the call could
    // only say "it was fast today". Left ungated, the `.N()` here takes over a
    // second at this nesting depth.
    const spy = jest.spyOn(expr, 'N');
    try {
      expect(numericValueOf(expr)).toBeUndefined();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

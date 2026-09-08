import { ComputeEngine } from '../../src/compute-engine';

/**
 * An assumed inequality bound is stored and compared EXACTLY.
 *
 * The bound used to be summed in a JavaScript number, so an exact bound the
 * machine cannot represent was rounded to the nearest double in EITHER
 * direction before it was stored, and every reader then took the stored
 * value as exact. `assume(v > 1 − 10⁻³⁰)` stored a strict lower bound of
 * exactly 1, from which `v > 1` was "proven" — refuted by `v = 1 − 10⁻³¹`.
 * The query side rounded too: with `u ≥ 1`, the query `u ≥ 1 + 10⁻³⁰`
 * projected its constant to the double 1 and was "proven" as well.
 */

const parse = (ce: ComputeEngine, s: string) =>
  ce.parse(s).evaluate().toString();

describe('assumption bounds are exact', () => {
  test('a lower bound within an ulp of 1 does not prove v > 1', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('v > 1 - 10^{-30}'));
    // Undecided: `v = 1 − 10⁻³¹` satisfies the assumption and refutes `v > 1`.
    expect(parse(ce, 'v > 1')).toBe('1 < v');
    expect(parse(ce, 'v \\geq 1')).toBe('1 <= v');
    expect(parse(ce, 'v \\leq 1')).toBe('v <= 1');
    expect(parse(ce, 'v < 1')).toBe('v < 1');
    // What the assumption does entail.
    expect(parse(ce, 'v > 1 - 10^{-30}')).toBe('"True"');
    expect(parse(ce, 'v \\geq 1 - 10^{-30}')).toBe('"True"');
    expect(parse(ce, 'v > 1 - 10^{-29}')).toBe('"True"');
    expect(parse(ce, 'v < 1 - 10^{-30}')).toBe('"False"');
    expect(parse(ce, 'v > 0')).toBe('"True"');
    expect(ce.symbol('v').isPositive).toBe(true);
  });

  test('the comparison predicates use the exact bound', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('v > 1 - 10^{-30}'));
    expect(ce.symbol('v').isGreater(1)).toBeUndefined();
    expect(ce.symbol('v').isGreater(ce.number(1))).toBeUndefined();
    expect(ce.symbol('v').isLessEqual(1)).toBeUndefined();
    expect(ce.number(1).isLess(ce.symbol('v'))).toBeUndefined();
    expect(ce.symbol('v').isGreater(0.5)).toBe(true);
    expect(ce.number(0.5).isLess(ce.symbol('v'))).toBe(true);
  });

  test('a query constant within an ulp of the bound is not rounded onto it', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('u \\geq 1'));
    // `u = 1` refutes `u ≥ 1 + 10⁻³⁰` and satisfies `u < 1 + 10⁻³⁰`.
    expect(ce.parse('u \\geq 1 + 10^{-30}').evaluate().operator).toBe(
      'LessEqual'
    );
    expect(ce.parse('u < 1 + 10^{-30}').evaluate().operator).toBe('Less');
    expect(parse(ce, 'u \\geq 1')).toBe('"True"');
    expect(parse(ce, 'u > 0.5')).toBe('"True"');
    expect(parse(ce, 'u < 0.5')).toBe('"False"');
  });

  test('a rational bound orders exactly against its neighbouring doubles', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('t > 1/3'));
    // 0.3333333333333333 is the double just below 1/3; 0.33333333333333337
    // is the double just above it.
    expect(parse(ce, 't > 0.3333333333333333')).toBe('"True"');
    expect(ce.parse('t > 0.33333333333333337').evaluate().operator).toBe(
      'Less'
    );
    expect(parse(ce, 't > 1/3')).toBe('"True"');
  });

  test('a compatible bound is not refused as a contradiction', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('v > 1 - 10^{-30}'));
    // `1 − 10⁻³⁰ < v < 1` is satisfiable; read as doubles both bounds were 1
    // and the strict pair was a contradiction.
    expect(ce.assume(ce.parse('v < 1'))).toBe('ok');
    expect(parse(ce, 'v < 1')).toBe('"True"');
    expect(parse(ce, 'v > 1 - 10^{-30}')).toBe('"True"');
  });

  test('the stored bound is the exact expression', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('t > 1/3'));
    const matches = ce.ask(ce.box(['Greater', 't', '_k']));
    expect(matches).toHaveLength(1);
    expect(matches[0]['_k'].isSame(ce.parse('1/3'))).toBe(true);
  });

  test('a tiny positive lower bound still proves the sign', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('s > 10^{-400}'));
    expect(ce.symbol('s').isPositive).toBe(true);
    expect(parse(ce, 's > 0')).toBe('"True"');
  });
});

describe('a dyadic rational bound against the equal double', () => {
  test('the equality is recognized in both directions', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('a \\geq 1/2'));
    // `a = 1/2` satisfies the assumption, so `a > 0.5` is not entailed.
    expect(ce.symbol('a').isGreater(0.5)).toBeUndefined();
    expect(ce.symbol('a').isGreaterEqual(0.5)).toBe(true);
    expect(ce.symbol('a').isLess(0.5)).toBe(false);
    expect(ce.number(0.5).isLess(ce.symbol('a'))).toBeUndefined();
    expect(ce.number(0.5).isLessEqual(ce.symbol('a'))).toBe(true);
    ce.assume(ce.parse('b \\leq 3/4'));
    expect(ce.symbol('b').isLessEqual(0.75)).toBe(true);
    expect(ce.symbol('b').isLess(0.75)).toBeUndefined();
    expect(ce.symbol('b').isGreater(0.75)).toBe(false);
  });
});

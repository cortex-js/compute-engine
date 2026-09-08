/**
 * Tycho item 269: the `interval-js` target cost 4–5× the `javascript` target
 * per call on a fixed-N `\sum` body (the exoplanet-transit light curve: 40
 * ring terms of `arccos(max(-1, min(1, …)))` over a `\sqrt`, a `\cos` and a
 * division). Three gaps against the scalar target's codegen, all closed here:
 *
 * 1. No constant folding: every constant subtree (`1 + -0.5`, `0.1·π`, the
 *    whole `1 − 0.6(1 − √(1 − w²))` factor of a term) was re-evaluated with
 *    allocating interval operations on every call. The `.N()` fold is unsound
 *    on this target (it bakes a zero-width point), so the fold here evaluates
 *    the emitted CODE with the interval library at compile time
 *    (`foldConstantIntervalCode`) and re-emits the enclosure as a literal of
 *    the same shape. Each endpoint the fold cannot prove exact is moved one
 *    ulp outward first, so the baked literal contains the real value where
 *    the run-time library's round-to-nearest answer may not.
 * 2. No common-subexpression elimination inside an unrolled term: the Sum
 *    body compiled outside its CSE region.
 * 3. No loop-invariant hoisting: the x-only `√(X² + 0.81)` was recomputed in
 *    every one of the 40 terms (80 times per call with the two occurrences).
 *    The interval target now hoists maximal index-free SCALAR subtrees
 *    (`hoistScalarInvariants`), once per call.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();

type IntervalRun = {
  success: boolean;
  code: string;
  run: (arg: unknown) => unknown;
};

function compileInterval(
  latex: string,
  options: Record<string, unknown> = {}
): IntervalRun {
  const expr = ce.parse(latex);
  if (!expr.isValid) throw new Error(`parse: ${expr.toString()}`);
  const r = compile(expr, { to: 'interval-js', ...options }) as IntervalRun;
  if (!r.success) throw new Error(`compile failed: ${latex}`);
  return r;
}

/** The structural (unfolded, unhoisted) lowering, for a reference value. */
function compileStructural(latex: string): IntervalRun {
  return compileInterval(latex, { constantFold: false, cse: false });
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/**
 * The folded result ENCLOSES the structurally computed one, and is no more
 * than a few ulps wider.
 *
 * The two are not identical, and must not be: the fold evaluates the
 * emitted code through a wrapper that moves every endpoint it cannot prove
 * exact one ulp outward, so the literal it bakes CONTAINS the real value.
 * The run-time library rounds to nearest instead, so the enclosure it
 * computes for an irrational — `ln(2)`, `√(2π)` — can exclude the very
 * value it claims to bound. See `compile-interval-constant-enclosure.test.ts`
 * for the soundness properties this widening buys.
 */
function expectEncloses(folded: unknown, reference: unknown): void {
  const boundOf = (v: unknown): { lo: number; hi: number } => {
    const r = v as {
      value?: { lo: number; hi: number };
      lo: number;
      hi: number;
    };
    return r.value ?? r;
  };
  expect((folded as { kind?: string }).kind).toEqual(
    (reference as { kind?: string }).kind
  );
  const f = boundOf(folded);
  const s = boundOf(reference);
  expect(f.lo).toBeLessThanOrEqual(s.lo);
  expect(f.hi).toBeGreaterThanOrEqual(s.hi);
  const scale = Math.max(1, Math.abs(s.lo), Math.abs(s.hi));
  expect(f.hi - f.lo - (s.hi - s.lo)).toBeLessThan(scale * 1e-12);
}

describe('Tycho item 269: sound constant folding on the interval target', () => {
  test('a closed constant subtree folds to the literal its code evaluates to', () => {
    const r = compileInterval('\\ln(2) x');
    // `_IA.ln(_IA.point(2))` is gone; its enclosure is inlined as a literal
    // of the same `{ kind: 'interval', value }` shape the routine returns.
    expect(r.code).not.toContain('_IA.ln(');
    expect(r.code).toMatch(
      /\{ kind: 'interval', value: \{ lo: [0-9.e-]+, hi: [0-9.e-]+ \} \}/
    );
    const structural = compileStructural('\\ln(2) x');
    for (const x of [
      { lo: -1, hi: -0.5 },
      { lo: 0.25, hi: 0.3 },
      { lo: 2, hi: 2 },
    ]) {
      expectEncloses(r.run({ x }), structural.run({ x }));
    }
  });

  test('the fold encloses the run-time enclosure, and is not a .N() point', () => {
    // `arccos(0.5)` and `1 - 0.6(1 - √(1 - 0.25))` are exact-argument
    // transcendentals: the `.N()` fold would emit one double as a point, this
    // fold emits whatever enclosure the interval routine computes.
    for (const latex of [
      '\\arccos(0.5) x',
      '(1 - 0.6(1 - \\sqrt{1 - 0.25})) x',
      '\\frac{x}{3 \\cdot 0.5 \\cdot 2}',
    ]) {
      const folded = compileInterval(latex);
      const structural = compileStructural(latex);
      // No interval routine other than the one applied to `x` survives.
      expect(count(folded.code, '_IA.')).toBe(1);
      for (const x of [
        { lo: -3, hi: -2.5 },
        { lo: 0, hi: 0.001 },
        { lo: 7, hi: 7 },
      ]) {
        expectEncloses(folded.run({ x }), structural.run({ x }));
      }
    }
  });

  test('a constant prefix of an n-ary chain folds although it is not a node', () => {
    // `Multiply(0.1, Pi, x + 5)` lowers as `mul(mul(0.1, π), x + 5)`; the
    // inner pair is an emission-time intermediate, folded by the chain.
    const r = compileInterval('\\frac{\\pi (x + 5)}{10}');
    expect(r.code).not.toContain('Math.PI');
    expect(count(r.code, '_IA.mul(')).toBe(1);
    const structural = compileStructural('\\frac{\\pi (x + 5)}{10}');
    const x = { lo: 1, hi: 1.5 };
    expectEncloses(r.run({ x }), structural.run({ x }));
  });

  test('a CSE temporary bound to a constant is folded too', () => {
    const r = compileInterval('\\ln(2) x + \\ln(2) x^2');
    expect(r.code).not.toContain('_IA.ln(');
  });

  test('a subtree naming a variable never folds', () => {
    const r = compileInterval('\\sqrt{x^2 + 0.81}');
    expect(r.code).toContain('_IA.sqrt(');
    expect(r.code).toContain('_.x');
  });

  test('a non-enclosure result (empty, entire) is left to the structural code', () => {
    // `ln` of a non-positive point is `empty`; the code stays structural and
    // the run-time answer is unchanged.
    const r = compileInterval('\\ln(-1) + x');
    expect(r.code).toContain('_IA.ln(');
    expect(r.run({ x: { lo: 1, hi: 2 } })).toEqual(
      compileStructural('\\ln(-1) + x').run({ x: { lo: 1, hi: 2 } })
    );
  });

  test('`constantFold: false` keeps the structural lowering of every constant', () => {
    const r = compileInterval('\\ln(2) x', { constantFold: false });
    expect(r.code).toContain('_IA.ln(_IA.point(2))');
    expect(r.code).not.toContain("kind: 'interval'");
  });

  test('a caller `vars` splice that draws at run time never folds', () => {
    // `vars` code is emitted verbatim; a `Math.random()` inside it must keep
    // drawing on every call, not be baked as one sample.
    const expr = ce.parse('\\sqrt{r} + 1');
    const r = compile(expr, {
      to: 'interval-js',
      vars: { r: '_IA.point(Math.random())' },
    }) as IntervalRun;
    expect(r.success).toBe(true);
    expect(r.code).toContain('Math.random()');
    expect(r.code).toContain('_IA.sqrt(');
  });

  test('a gcd of a constant past 2^53 neither hangs the fold nor the run', () => {
    const expr = ce.box(['GCD', 9007199254740992, 2]);
    const r = compile(expr, { to: 'interval-js' }) as IntervalRun;
    expect(r.success).toBe(true);
    // The enumeration declines (`null` → the routine's fallback) instead of
    // looping forever at an integer `i++` cannot advance past.
    expect(r.run({})).toBeDefined();
  });

  test('a negative-zero endpoint keeps its sign in the literal', () => {
    // `negate(point(0))` has `-0` endpoints; `String(-0)` is `"0"`.
    const r = compileInterval('-0 \\cdot x + \\ln(1) \\cdot 0');
    // Whatever the exact lowering, the run-time value must match the
    // structural one on every endpoint, sign of zero included.
    const structural = compileStructural('-0 \\cdot x + \\ln(1) \\cdot 0');
    const x = { lo: 2, hi: 3 };
    const a = JSON.stringify(r.run({ x }), (_k, v) =>
      Object.is(v, -0) ? '-0' : v
    );
    const b = JSON.stringify(structural.run({ x }), (_k, v) =>
      Object.is(v, -0) ? '-0' : v
    );
    expect(a).toBe(b);
  });
});

describe('Tycho item 269: CSE and loop-invariant hoisting in an interval Sum', () => {
  // A 4-ring stand-in for the light curve: `√(x²+0.81)` is index-free and
  // appears twice per term.
  const RING =
    '\\sum_{n=1}^{4} \\frac{9 (\\frac{n}{4})^2 + \\sqrt{x^2 + 0.81}^2 - 1.69}{6 \\frac{n}{4} \\sqrt{x^2 + 0.81}}';

  test('the index-free subtree is computed once per call, not once per term', () => {
    const r = compileInterval(RING);
    // One hoisted binding of the radical (and one of its square, a separate
    // maximal invariant), referenced from every term.
    expect(count(r.code, '_IA.sqrt(')).toBeLessThanOrEqual(2);
    expect(r.code).toMatch(/const _tv\d+ = _IA\.sqrt\(/);
    const structural = compileStructural(RING);
    expect(count(structural.code, '_IA.sqrt(')).toBe(8);
    for (const x of [
      { lo: -1, hi: -0.9 },
      { lo: 0, hi: 0.01 },
      { lo: 2.5, hi: 2.5 },
    ]) {
      expect(r.run({ x })).toEqual(structural.run({ x }));
    }
  });

  test('the light-curve term shape: constants fold, only the x-dependent work remains per term', () => {
    const X = '(-10\\cos\\left(\\frac{\\pi (x+5)}{10}\\right))';
    const m = `\\sqrt{${X}^2 + 0.81}`;
    const w = '\\frac{n-0.5}{40}';
    const S = `2\\arccos\\left(\\max\\left(-1, \\min\\left(1, \\frac{9 ${w}^2 + ${m}^2 - 1.69}{6 ${w} ${m}}\\right)\\right)\\right)`;
    const latex = `\\sum_{n=1}^{40} \\left(1 - 0.6\\left(1 - \\sqrt{1 - ${w}^2}\\right)\\right) ${S} \\frac{n-0.5}{1600}`;
    const r = compileInterval(latex);
    const structural = compileStructural(latex);
    // Per-term: the constant factor folds (no `_IA.sqrt` of the `1 - w²`
    // radical in the terms), the `cos` is hoisted (one per call, two with
    // the squared invariant), and the code is a fraction of the structural
    // size.
    expect(count(r.code, '_IA.cos(')).toBeLessThanOrEqual(2);
    expect(count(structural.code, '_IA.cos(')).toBe(80);
    expect(count(r.code, '_IA.acos(')).toBe(40);
    // Counted in interval OPERATIONS, not in characters: a folded literal
    // spells two 17-digit endpoints where the call it replaces spelled one
    // short constant, so the folded source can be longer than the code it
    // replaced while doing a fraction of the work.
    expect(count(r.code, '_IA.')).toBeLessThan(
      count(structural.code, '_IA.') / 2
    );
    for (const lo of [-5, -2.3, 0, 1.7, 4.9]) {
      const x = { lo, hi: lo + 0.001 };
      expectEncloses(r.run({ x }), structural.run({ x }));
    }
  });

  test('the loop form hoists the invariant out of the loop', () => {
    // 150 terms exceed the unroll limit, so a loop is emitted.
    const latex = '\\sum_{n=1}^{150} \\frac{\\sqrt{x+1}}{n^2}';
    const r = compileInterval(latex);
    expect(r.code).toMatch(/const _tv\d+ = _IA\.sqrt\([^;]*; for \(/);
    const structural = compileStructural(latex);
    const x = { lo: 3, hi: 3.5 };
    expect(r.run({ x })).toEqual(structural.run({ x }));
  });

  test('a symbolic-bound loop evaluates the hoisted invariant only when the range is non-empty', () => {
    const latex = '\\sum_{n=1}^{m} \\frac{\\sqrt{x+1}}{n^2}';
    const r = compileInterval(latex);
    expect(r.code).toMatch(
      // The zero the empty range answers is a constant interval, so it may
      // read a hoisted preamble local (`_k1`) instead of building the point
      // at the site.
      /if \(!\(_lower <= _upper\)\) return (?:_IA\.point\(0\)|_k\d+); const _tv\d+ = _IA\.sqrt\(/
    );
    // Empty range: the identity, whatever `x` is (the radical of a negative
    // `x + 1` is never evaluated).
    expect(r.run({ x: { lo: -10, hi: -9 }, m: { lo: 0, hi: 0 } })).toEqual({
      lo: 0,
      hi: 0,
    });
    const structural = compileStructural(latex);
    const args = { x: { lo: 3, hi: 3.5 }, m: { lo: 5, hi: 5 } };
    expect(r.run(args)).toEqual(structural.run(args));
  });

  test('a body with no invariant and no constant compiles as before', () => {
    const latex = '\\sum_{n=1}^{3} x n';
    expect(compileInterval(latex).code).toBe(compileStructural(latex).code);
  });
});

/**
 * A common subexpression whose value is a constant interval is not bound to
 * a temporary on the `interval-js` target: each occurrence is written as the
 * constant, so the emitted-code fold (`foldConstantIntervalCode`) also folds
 * the expressions that read it, and the constant table gives each distinct
 * value one `_k` name.
 *
 * The case that showed the defect is the body of a user function with an
 * unrolled `Sum`. The index of each unrolled term is replaced by a literal
 * when the term is emitted, so `(n − 0.5)/40` is a candidate of the term's
 * region and its right-hand side folds to a constant. Bound to a temporary,
 * that constant was a name the fold cannot see through, and
 * `√(1 − ((n − 0.5)/40)²)` was computed on every call of the function (the
 * exoplanet transit kernel of the Tycho consumer has 40 such terms, so 40
 * interval square roots of constants per call). The JavaScript target folded
 * the same body completely.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

type IntervalRun = {
  success: boolean;
  code: string;
  preamble?: string;
  run: (arg: unknown) => unknown;
};

const S_DEF =
  '(a, c) \\mapsto 2\\arccos(\\max(-1, \\min(1, \\frac{a^2 r^2 - c^2}{2 a r c})))';
// The product `k \cdot (…)` is explicit: `k(…)` calls the untyped parameter
// `k`.
const B_DEF =
  '(c, k) \\mapsto \\sum_{n=1}^{3} \\frac{n-0.5}{40}\\left(1 - k\\cdot\\left(1-\\sqrt{1-\\left(\\frac{n-0.5}{40}\\right)^2}\\right)\\right) S\\left(\\frac{n-0.5}{40}, c\\right)';

function makeEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  for (const n of ['x', 'j', 'r']) ce.declare(n, 'real');
  ce.assign('S', ce.parse(S_DEF));
  ce.assign('B', ce.parse(B_DEF));
  return ce;
}

function compileInterval(
  ce: ComputeEngine,
  latex: string,
  options: Record<string, unknown> = {}
): IntervalRun {
  const r = compile(ce.parse(latex), {
    to: 'interval-js',
    fallback: false,
    ...options,
  }) as IntervalRun;
  if (!r.success) throw new Error(`compile failed: ${latex}`);
  return r;
}

describe('INTERVAL CSE: A CONSTANT COMMON SUBEXPRESSION IS FOLDED', () => {
  test('the same sum at the root folds the same way', () => {
    const ce = makeEngine();
    const r = compileInterval(
      ce,
      '1 - \\sum_{n=1}^{3} \\frac{n-0.5}{40}\\left(1 - j\\left(1-\\sqrt{1-\\left(\\frac{n-0.5}{40}\\right)^2}\\right)\\right) S\\left(\\frac{n-0.5}{40}, x\\right)'
    );
    for (const p of [
      { x: 0.3, j: 0.5, r: 10 },
      { x: 0.2, j: 0.8, r: 8 },
    ]) {
      const out = r.run(p) as { value: { lo: number; hi: number } };
      const ref = makeEngine();
      ref.assign('x', p.x);
      ref.assign('j', p.j);
      ref.assign('r', p.r);
      const n = ref
        .parse(
          '1 - \\sum_{n=1}^{3} \\frac{n-0.5}{40}\\left(1 - j\\left(1-\\sqrt{1-\\left(\\frac{n-0.5}{40}\\right)^2}\\right)\\right) S\\left(\\frac{n-0.5}{40}, x\\right)'
        )
        .N().re;
      expect(Number.isFinite(n)).toBe(true);
      expect(out.value.lo).toBeLessThanOrEqual(n);
      expect(n).toBeLessThanOrEqual(out.value.hi);
    }
  });

  test('the compiled value encloses the value of the expression', () => {
    const ce = makeEngine();
    const r = compileInterval(ce, '1 - B(x, j)');
    const points = [
      { x: 0.3, j: 0.5, r: 10 },
      { x: 0.2, j: 0.8, r: 8 },
    ];
    for (const p of points) {
      const out = r.run(p) as {
        kind: string;
        value: { lo: number; hi: number };
      };
      expect(out.kind).toBe('interval');
      // The reference value comes from a separate engine, so that assigning
      // `x`, `j` and `r` does not change the engine the code was compiled by.
      const ref = makeEngine();
      ref.assign('x', p.x);
      ref.assign('j', p.j);
      ref.assign('r', p.r);
      const n = ref.parse('1 - B(x, j)').N().re;
      expect(Number.isFinite(n)).toBe(true);
      expect(out.value.lo).toBeLessThanOrEqual(n);
      expect(n).toBeLessThanOrEqual(out.value.hi);
      expect(out.value.hi - out.value.lo).toBeLessThanOrEqual(
        16 * Number.EPSILON
      );
    }
  });

  test('a common subexpression that reads a parameter is still bound', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.assign(
      'F',
      ce.parse(
        '(c) \\mapsto \\sum_{n=1}^{3} \\left(\\sin\\left(\\frac{n+c}{4}\\right) + \\cos\\left(\\frac{n+c}{4}\\right) + \\left(\\frac{n+c}{4}\\right)^3\\right)'
      )
    );
    const r = compileInterval(ce, 'F(x)');
    for (const v of [-1.5, 0, 0.7, 2]) {
      const n = ce.parse('F(x)').subs({ x: v }).N().re;
      expect(Number.isFinite(n)).toBe(true);
      const out = r.run({ x: { lo: v, hi: v } }) as {
        value: { lo: number; hi: number };
      };
      expect(out.value.lo).toBeLessThanOrEqual(n);
      expect(n).toBeLessThanOrEqual(out.value.hi);
    }
    const box = r.run({ x: { lo: 0, hi: 0.5 } }) as {
      value: { lo: number; hi: number };
    };
    for (const v of [0, 0.2, 0.5]) {
      const n = ce.parse('F(x)').subs({ x: v }).N().re;
      expect(box.value.lo).toBeLessThanOrEqual(n);
      expect(n).toBeLessThanOrEqual(box.value.hi);
    }
  });
});

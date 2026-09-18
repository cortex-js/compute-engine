/**
 * Two callback lowerings that used to recompute work on every call:
 *
 * - A `Function` literal a handler SYNTHESIZES at emission time (the numeric
 *   derivative fallback wraps its operand in `Function(body, x)`) is not part
 *   of the tree the CSE harvest walked, so its body compiled with no
 *   candidates: a subexpression repeated in the body was emitted, and
 *   evaluated, once per occurrence (the stencil callback of Tycho corpus
 *   document `lwuwgb9ic5` spelled the same minimum of twenty distances
 *   twenty-one times). Such a body now gets a nested harvest of its own.
 * - The integrand of a quadrature lowering (`_SYS.integrate`, `_IA.integrate`)
 *   runs once per sample, and a subexpression of it that mentions no
 *   integration variable was recomputed at every sample (`Γ(k/2)·√2^k`, 300
 *   times per integral in document `thpezd39zq`). It is now bound once, next
 *   to the lambda, on its first call.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { parseEpsil } from '../../src/epsil/parse-epsil';

describe('a synthesized derivative callback shares its repeated subexpressions', () => {
  const ce = new ComputeEngine();
  // A minimum of squared distances read twice in the body: the derivative
  // of `Min` has no closed form, so the stencil fallback compiles
  // `Function(body, x)` at emission time.
  const latex =
    '\\frac{\\mathrm{d}}{\\mathrm{d}x}\\left(\\min((x-1)^2+(y-2)^2,(x-3)^2+(y-1)^2)^2+3\\min((x-1)^2+(y-2)^2,(x-3)^2+(y-1)^2)\\right)';

  test('the minimum is bound once inside the callback', () => {
    const fn = compile(ce.parse(latex), { to: 'javascript' });
    expect(fn.success).toBe(true);
    const code = fn.code!;
    expect(code).toContain('_SYS.nd(');
    const callback = code.slice(code.indexOf('_SYS.nd('));
    // One `Math.min` for the two reads, not one per read, bound inside the
    // stencil callback, where the parameter it mentions is in scope.
    expect(callback.split('Math.min(').length - 1).toBe(1);
    expect(callback).toMatch(
      /\(x\) => \(\(\) => \{ const (_cse\d+) = Math\.min\(.*; return 3 \* \1 \+ _SYS\.pow2\(\1\); \}\)\(\)/
    );
  });

  test('the value agrees with the unshared stencil', () => {
    const fn = compile(ce.parse(latex), { to: 'javascript' });
    const plain = compile(ce.parse(latex), { to: 'javascript', cse: false });
    expect(plain.success).toBe(true);
    for (const [x, y] of [
      [1.2, 2.1],
      [2.9, 1.3],
      [2.2, 4.4],
    ])
      expect(fn.run!({ x, y })).toBe(plain.run!({ x, y }));
  });
});

describe('a generic literal rebuilt at its ground bound still shares its body', () => {
  // A generic literal is re-boxed at its ground signature before its body
  // compiles (`literalAtGroundSignature`), so the harvested tree's region is
  // keyed on the node the rebuild replaced: the body takes the nested
  // harvest, and must share exactly as the plain literal does.
  const ce = new ComputeEngine();
  const body = 'Min(xs)^2 + 3 * Min(xs) + Sin(Min(xs))';
  const program = (signature: string) => {
    const [ast] = parseEpsil(
      `function gm${signature} { ${body} }\ngm([1, 2, 3])`,
      { parseLatex: (latex: string) => ce.parse(latex).json }
    );
    return compile(ce.box(ast as never), {
      to: 'javascript',
      fallback: false,
      constantFold: false,
    });
  };

  test('one reduction for three reads, generic and plain alike', () => {
    const generic = program('(xs: T) -> number where T: list<number>');
    const plain = program('(xs: list<number>) -> number');
    for (const r of [generic, plain]) {
      expect(r.success).toBe(true);
      expect(r.code!.split('Math.min(').length - 1).toBe(1);
      expect(r.code).toMatch(/const (_cse\d+) = .*reduce.*Math\.min.*\(xs\); return 3 \* \1 \+ Math\.sin\(\1\) \+ _SYS\.pow2\(\1\);/);
      expect(r.run!({})).toBeCloseTo(1 + 3 + Math.sin(1), 12);
    }
  });
});

describe('an integrand computes its loop invariants once', () => {
  const ce = new ComputeEngine();
  ce.declare('k', 'number');
  const latex =
    '\\int_{x}^{10}\\frac{\\exp(-(y/2))y^{k/2-1}}{\\Gamma(\\frac{k}{2})\\sqrt{2}^{k}}\\,\\mathrm{d}y';

  test('JavaScript: the gamma product is assigned on the first sample only', () => {
    const fn = compile(ce.parse(latex), { to: 'javascript' });
    expect(fn.success).toBe(true);
    const code = fn.code!;
    expect(code.split('_SYS.gamma(').length - 1).toBe(1);
    // The lambda the quadrature calls tests a flag and reads the bindings;
    // the held body reads them by name.
    expect(code).toMatch(/let (_tv\d+) = false; let _tv\d+/);
    expect(code).toMatch(
      /const _tv\d+ = \(y\) => \(.*_SYS\.pow\(y, _tv\d+\)\) \/ _tv\d+\)/
    );
    const value = fn.run!({ x: 2, k: 5 }) as number;
    const plain = compile(ce.parse(latex), { to: 'javascript', cse: false });
    expect(value).toBeCloseTo(plain.run!({ x: 2, k: 5 }) as number, 12);
  });

  test('interval: the gamma product is one binding', () => {
    const fn = compile(ce.parse(latex), { to: 'interval-js' });
    expect(fn.success).toBe(true);
    const code = fn.code!;
    expect(code.split('_IA.gamma(').length - 1).toBe(1);
    expect(code).toMatch(/let (_tv\d+) = false; let _tv\d+/);
    const v = fn.run!({ x: { lo: 2, hi: 2 }, k: { lo: 5, hi: 5 } }) as {
      kind: string;
      value: { lo: number; hi: number };
    };
    expect(v.kind).toBe('interval');
    const scalar = compile(ce.parse(latex), { to: 'javascript' }).run!({
      x: 2,
      k: 5,
    }) as number;
    expect(v.value.lo).toBeLessThanOrEqual(scalar);
    expect(v.value.hi).toBeGreaterThanOrEqual(scalar);
  });

  test('a nested integral with a dependent bound keeps its value', () => {
    // The inner integrand reads the outer variable, so the inner bindings
    // are declared inside the outer lambda, once per outer sample.
    const nested =
      '\\int_{0}^{1}\\int_{0}^{x}\\Gamma(k/2)\\,x\\,y\\,\\mathrm{d}y\\,\\mathrm{d}x';
    const fn = compile(ce.parse(nested), { to: 'javascript' });
    expect(fn.success).toBe(true);
    const plain = compile(ce.parse(nested), { to: 'javascript', cse: false });
    expect(fn.run!({ k: 5 }) as number).toBeCloseTo(
      plain.run!({ k: 5 }) as number,
      10
    );
  });

  test('an empty range evaluates no invariant', () => {
    // `Gamma(0)` is a pole: the unhoisted integrand never evaluated it when
    // quadrature asked for no sample, and neither may the bindings.
    const empty = '\\int_{3}^{3}\\frac{y}{\\Gamma(k)}\\,\\mathrm{d}y';
    const fn = compile(ce.parse(empty), { to: 'javascript' });
    expect(fn.success).toBe(true);
    expect(fn.run!({ k: 0 })).toBe(0);
  });
});

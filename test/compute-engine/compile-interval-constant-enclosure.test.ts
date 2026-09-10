/**
 * The `interval-js` target must never emit a constant it cannot stand
 * behind.
 *
 * A caller of this target uses the enclosure it answers to PROVE something:
 * that a curve misses a cell, that a function has no root in a box. A
 * degenerate `{ lo: 6.283185307179586, hi: 6.283185307179586 }` for `2π`
 * does not contain `2π`, so a proof built on it is worthless. Three places
 * produced such a point, and this file pins the fix in all three:
 *
 * 1. the target's own constants table — `π`, `e`, `φ`, Catalan's constant,
 *    the Euler–Mascheroni constant;
 * 2. a NUMBER LITERAL the engine holds exactly while no double does — a
 *    rational such as `1/49` and a radical such as `√2`;
 * 3. the compile-time constant fold, which evaluates emitted interval code
 *    with the run-time library. The library itself now rounds every endpoint
 *    it cannot prove exact outward, so the folded literal is the same
 *    enclosure the emitted code computes.
 *
 * The reference values are read from the engine at 40 digits and compared
 * as decimals, so a bound is checked against the real constant, never
 * against another double.
 *
 * The file also pins what must NOT widen: a machine float the user typed,
 * an integer, a dyadic rational, and every fold the arithmetic can prove
 * exact.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { nextDown, nextUp } from '../../src/compute-engine/numerics/numeric';

const ce = new ComputeEngine();

type IntervalRun = {
  success: boolean;
  code: string;
  preamble?: string;
  run: (arg: unknown) => any;
};

/** The whole emitted artifact: the constant table the preamble carries, then
 *  the expression that reads it. Every constant interval is bound in that
 *  table (`hoistIntervalConstants`), so a test that looks for a constant's
 *  spelling has to look at both halves. */
function emitted(r: { preamble?: string; code: string }): string {
  return `${r.preamble ?? ''}\n${r.code}`;
}

function compileInterval(latex: string): IntervalRun {
  const expr = ce.parse(latex);
  if (!expr.isValid) throw new Error(`parse: ${expr.toString()}`);
  const r = compile(expr, { to: 'interval-js' }) as IntervalRun;
  if (!r.success) throw new Error(`compile failed: ${latex}`);
  return r;
}

/** The enclosure a run answers, whatever result shape carries it. */
function boundOf(v: any): { lo: number; hi: number } {
  return v.value ?? v;
}

/**
 * The value of `latex` as a 40-digit decimal, read through a
 * high-precision engine.
 *
 * `BigDecimal.precision` is module-global, so the precision is restored
 * before returning: a shared engine built earlier in this file must keep
 * computing at its own precision.
 */
function referenceValue(expr: any): {
  gt(x: number): boolean;
  lt(x: number): boolean;
} {
  const saved = ce.precision;
  ce.precision = 40;
  try {
    const v = expr.N().numericValue;
    const d = typeof v === 'number' ? undefined : v.bignumRe;
    if (d === undefined)
      throw new Error(`no high-precision value for ${expr.toString()}`);
    return d;
  } finally {
    ce.precision = saved;
  }
}

/** The emitted enclosure strictly contains the real value of `expr`. */
function expectStrictEnclosure(
  expr: any,
  emitted: { lo: number; hi: number }
): void {
  const truth = referenceValue(
    typeof expr === 'string' ? ce.parse(expr) : expr
  );
  expect(truth.gt(emitted.lo)).toBe(true);
  expect(truth.lt(emitted.hi)).toBe(true);
}

describe('interval-js: the constants table emits enclosures', () => {
  // Each constant is checked against its own 40-digit value: the double the
  // table starts from must itself be the nearest one, or the two-ulp
  // enclosure around it would not contain the constant.
  test.each([
    'Pi',
    'ExponentialE',
    'GoldenRatio',
    'CatalanConstant',
    'EulerGamma',
  ])('%s encloses its value', (name) => {
    const r = compile(ce.box(name), { to: 'interval-js' }) as IntervalRun;
    expect(r.success).toBe(true);
    const v = boundOf(r.run({}));
    expect(v.lo).toBeLessThan(v.hi);
    expectStrictEnclosure(ce.box(name), v);
  });

  test('an exactly representable constant stays a point', () => {
    // `1/2` and the machine epsilon ARE doubles; widening them would give
    // away precision for nothing.
    expect(emitted(compileInterval('\\frac{1}{2}'))).toContain(
      '_IA.point(0.5)'
    );
    const half = boundOf(compileInterval('\\frac{1}{2}').run({}));
    expect(half).toEqual({ lo: 0.5, hi: 0.5 });
  });
});

describe('interval-js: a literal with no double is emitted as an enclosure', () => {
  test('a rational whose denominator is not a power of two', () => {
    // Written as a SUM so the rational stays a literal operand rather than
    // being absorbed into a division.
    const r = compileInterval('x + \\frac{1}{49}');
    expect(r.code).not.toContain('_IA.point(0.02040816326530612)');
    const v = boundOf(r.run({ x: { lo: 0, hi: 0 } }));
    expect(v.lo).toBeLessThan(v.hi);
    expectStrictEnclosure('\\frac{1}{49}', v);
  });

  test('a radical', () => {
    const r = compileInterval('\\sqrt{2}');
    const v = boundOf(r.run({}));
    expect(v).toEqual({ lo: nextDown(Math.SQRT2), hi: nextUp(Math.SQRT2) });
    expectStrictEnclosure('\\sqrt{2}', v);
  });

  test('a machine float the user typed stays a point', () => {
    // The interpreter computes with that same double, so the literal IS its
    // own value here; widening it would claim an uncertainty the caller did
    // not write.
    expect(emitted(compileInterval('0.329 x'))).toContain('_IA.point(0.329)');
  });

  test('an integer and a dyadic rational stay points', () => {
    expect(emitted(compileInterval('5'))).toContain('_IA.point(5)');
    expect(emitted(compileInterval('x + \\frac{3}{8}'))).toContain(
      '_IA.point(0.375)'
    );
  });

  test('a rational whose parts do not convert exactly widens further', () => {
    // The engine's double for a rational is
    // `Number(numerator) / Number(denominator)`: when a part is past the
    // reach of the significand it rounds BEFORE the division does, so the
    // double is not the nearest one and a one-ulp enclosure can exclude the
    // value. This pair is such a case — its true value is more than two ulps
    // below the double the engine reports.
    const latex =
      '\\frac{318639139087473124835946003}{159516120077470495054335959}';
    const r = compileInterval(`x + ${latex}`);
    const v = boundOf(r.run({ x: { lo: 0, hi: 0 } }));
    const re = ce.parse(latex).re;
    expect(v.lo).toBeLessThan(nextDown(re));
    expect(v.hi).toBeGreaterThan(nextUp(re));
    expectStrictEnclosure(latex, v);
  });

  test('a large denominator that converts exactly keeps the narrow bound', () => {
    // `3·10^20` is past the safe-integer range but is still a double exactly
    // (`10^20` is `2^20 · 5^20`, and `3 · 5^20` fits the significand), so the
    // division is the only rounding and one ulp on each side is enough.
    const latex = '\\frac{1}{3\\cdot 10^{20}}';
    const r = compileInterval(`x + ${latex}`);
    const v = boundOf(r.run({ x: { lo: 0, hi: 0 } }));
    const re = ce.parse(latex).re;
    expect(v).toEqual({ lo: nextDown(re), hi: nextUp(re) });
    expectStrictEnclosure(latex, v);
  });
});

describe('interval-js: the fold proves an integer-valued routine exact', () => {
  // These routines answer on an integer grid, so a degenerate point at a safe
  // integer is the true value and must not be widened: a `floor` over a
  // widened `gcd` would answer the two-element range `[5, 6]` for `gcd(12,
  // 18)`.
  test.each([
    ['\\gcd(12, 18)', 6],
    ['\\operatorname{lcm}(4, 6)', 12],
    ['5!', 120],
    ['\\binom{5}{2}', 10],
    ['7 \\bmod 3', 1],
  ])('%s folds to an exact point', (latex, value) => {
    const v = boundOf(compileInterval(latex as string).run({}));
    expect(v).toEqual({ lo: value, hi: value });
  });

  test('a floor over a folded gcd answers one integer', () => {
    const v = boundOf(compileInterval('\\lfloor\\gcd(12, 18)\\rfloor').run({}));
    expect(v).toEqual({ lo: 6, hi: 6 });
  });

  test('a power of two with an integer exponent is an exact point', () => {
    const r = compile(ce.box(['Exp2', 3]), {
      to: 'interval-js',
    }) as IntervalRun;
    expect(r.success).toBe(true);
    expect(boundOf(r.run({}))).toEqual({ lo: 8, hi: 8 });
  });

  test('a power of two with a fractional exponent still widens', () => {
    // `Math.pow(2, x)` answers an exact integer for some non-integer `x` —
    // exactly 3 for the double nearest `log2(3)` — without that integer
    // being the true value, so only an INTEGER exponent proves the result
    // exact.
    const r = compile(ce.box(['Exp2', 3.5]), {
      to: 'interval-js',
    }) as IntervalRun;
    expect(r.success).toBe(true);
    const v = boundOf(r.run({}));
    expect(v.lo).toBeLessThan(v.hi);
  });
});

describe('interval-js: the fold leaves a caller `vars` splice alone', () => {
  test('a mapped symbol stays a live binding', () => {
    // A `vars` symbol is the caller's own source, spliced verbatim. Here it
    // is spelled entirely in this target's dialect, so the fold could
    // evaluate it — and would turn `2s` into a constant, silently dropping
    // the binding the caller asked for.
    const r = compile(ce.parse('2s'), {
      to: 'interval-js',
      vars: { s: '_IA.point(0.5)' },
    } as any) as IntervalRun;
    expect(r.success).toBe(true);
    expect(emitted(r)).toContain('_IA.point(0.5)');
    // The product is still computed on every call. A factor that is a
    // constant point is emitted as the point-scaling kernel, which answers
    // the same endpoints as the general product with half the endpoint
    // multiplications (`interval/arithmetic.ts`).
    expect(r.code).toContain('_IA.scale(');
  });

  test('a constant next to the splice still folds', () => {
    const r = compile(ce.parse('2 \\pi s'), {
      to: 'interval-js',
      vars: { s: '_IA.point(0.5)' },
    } as any) as IntervalRun;
    expect(r.success).toBe(true);
    expect(emitted(r)).toContain('_IA.point(0.5)');
    // `2π` has no splice in it, so it folds to one enclosure literal.
    expect(emitted(r)).toContain('lo: 6.28318530717958');
  });
});

describe('interval-js: the compile-time fold encloses', () => {
  test.each(['\\sqrt{2\\pi}', '2\\pi', '\\frac{1}{\\sqrt{2\\pi}}'])(
    '%s folds to an enclosure of its value',
    (latex) => {
      const r = compileInterval(latex);
      const v = boundOf(r.run({}));
      expect(v.lo).toBeLessThan(v.hi);
      expectStrictEnclosure(latex, v);
    }
  );

  test('the widening is one ulp per inexact endpoint per operation', () => {
    // `2π` is π's enclosure scaled by 2, and scaling by a power of two is
    // exact, so the fold must prove the multiplication exact and add
    // nothing of its own.
    const v = boundOf(compileInterval('2\\pi').run({}));
    expect(v).toEqual({ lo: 2 * nextDown(Math.PI), hi: 2 * nextUp(Math.PI) });
  });

  test('an exact fold stays a point', () => {
    // Each of these is exact in binary, so no endpoint may move.
    expect(boundOf(compileInterval('(1 + (-0.5)) x').run({ x: 1 }))).toEqual({
      lo: 0.5,
      hi: 0.5,
    });
    expect(boundOf(compileInterval('2 \\cdot 0.5 x').run({ x: 1 }))).toEqual({
      lo: 1,
      hi: 1,
    });
  });

  test('a floor over an exact fold stays exact, with no spurious singular', () => {
    // `floor` is a step function: an enclosure that straddled an integer
    // would be reported as a discontinuity. The fold must not create one by
    // widening an exact operand.
    const r = compileInterval('\\lfloor 2 + 3 \\rfloor');
    const v = r.run({});
    expect(v.kind).toBe('interval');
    expect(boundOf(v)).toEqual({ lo: 5, hi: 5 });
  });

  test('an alternating integer power sum folds to the exact zero', () => {
    // `(−1)^k` is an exact integer power at every term; a blanket one-ulp
    // widening per term would leave a spurious width of several ulps.
    const expr = ce.expr(['Sum', ['Power', -1, 'k'], ['Limits', 'k', 0, 5]]);
    const r = compile(expr, { to: 'interval-js' }) as IntervalRun;
    expect(r.success).toBe(true);
    expect(boundOf(r.run({}))).toEqual({ lo: 0, hi: 0 });
  });

  test('an enclosure literal is admitted as an input to a later fold', () => {
    // The fold reads admissibility off the emitted code. The enclosure
    // spellings introduced for the constants and the literals must pass
    // that grammar, or a chain over `π` would stop folding.
    const r = compileInterval('\\frac{\\pi (x + 5)}{10}');
    expect(r.code).not.toContain('Math.PI');
    expect(r.code.split('_IA.mul(').length - 1).toBe(1);
  });
});

describe('interval-js: repeated constants are bound once in the preamble', () => {
  test('a twenty-term sum builds its shared factor once per call', () => {
    const latex = '\\sum_{i=1}^{20} \\frac{1}{2}\\sin(i x)';
    const r = compileInterval(latex);
    // Before the hoist the twenty terms each spelled `_IA.point(0.5)`; now
    // one constant-table name carries it and the sites read that name. So do
    // the twenty DISTINCT `_IA.point(i)` coefficients: the table binds every
    // constant, not only a repeated one, because it is built once per
    // compiled artifact rather than once per call.
    expect(r.code).not.toContain('_IA.point(');
    expect(r.preamble!.split('_IA.point(').length - 1).toBe(21);
    expect(r.code).toContain('_k1');
    // The binding does not change the value: the run still answers the sum
    // of the terms. The comparison carries a tolerance because the reference
    // is a plain double sum of the same terms, which is not itself an
    // enclosure of anything.
    const v = boundOf(r.run({ x: 0.35 }));
    let expected = 0;
    for (let i = 1; i <= 20; i++) expected += 0.5 * Math.sin(i * 0.35);
    expect(v.lo).toBeLessThan(expected + 1e-12);
    expect(v.hi).toBeGreaterThan(expected - 1e-12);
    expect(v.hi - v.lo).toBeLessThan(1e-9);
  });

  test('a repeated folded enclosure is bound whole, wrapper included', () => {
    // The fold answers `{ kind: 'interval', value: { lo, hi } }`. Binding
    // only the inner `{ lo, hi }` would leave the wrapper object built at
    // each site, so the whole spelling has to be the unit that is bound.
    // (CSE is off here so that the binding under test is the constant
    // hoist, not a common-subexpression temporary.)
    const r = compile(ce.parse('\\ln(2) x + \\ln(2) y'), {
      to: 'interval-js',
      cse: false,
    }) as IntervalRun;
    expect(r.success).toBe(true);
    expect(r.code).not.toContain("kind: 'interval'");
    expect(r.code.split('_k1').length - 1).toBe(2);
  });

  test('a constant that occurs once is bound too', () => {
    // The table is evaluated once per compiled artifact, so a single
    // occurrence in the root expression is worth binding: the consumer calls
    // the kernel once per quadtree node, and the inline spelling built the
    // same object on every one of them.
    const r = compileInterval('\\frac{x}{2}');
    expect(r.code).toBe('_IA.scale(_k1, _.x)');
    expect(r.preamble).toBe('const _k1 = _IA.point(0.5);');
  });

  test('a caller-supplied function turns the hoist off', () => {
    // The hoist shares ONE interval object between the occurrences it
    // rewrites. That is safe for the `_IA` routines, which never write to an
    // operand, but a caller's own function is code the compiler never sees:
    // it may keep or write to the object it is given, and every occurrence
    // would then see the change. The whole pass declines when the
    // compilation carries any `functions` override.
    const latex = '\\sum_{i=1}^{20} \\frac{1}{2}\\sin(i x)';
    expect(compileInterval(latex).code).toContain('_k1');
    const r = compile(ce.parse(latex), {
      to: 'interval-js',
      functions: { keepsItsArgument: '((v) => v)' },
    } as any) as IntervalRun;
    expect(r.success).toBe(true);
    expect(r.code).not.toContain('_k1');
    expect(r.code).toContain('_IA.point(0.5)');
  });

  test('a bound loop index is never mistaken for a constant', () => {
    // The loop form spells the index as `_IA.point(n)`, which looks like a
    // constant point but is not one.
    const r = compileInterval('\\sum_{n=1}^{150} \\frac{x}{n^2}');
    expect(r.code).toContain('_IA.point(n)');
    expect(r.code).not.toMatch(/const _k\d+ = _IA\.point\(n\)/);
    const v = boundOf(r.run({ x: { lo: 1, hi: 1 } }));
    // Σ 1/n² over 1..150 is just below π²/6 = 1.6449…
    expect(v.lo).toBeGreaterThan(1.63);
    expect(v.hi).toBeLessThan(1.645);
  });
});

describe('INTERVAL-JS — Round(x, n) scales through an exact integer power', () => {
  const ce = new ComputeEngine();
  test('a negative precision divides by 10^-n and multiplies back', () => {
    // `10^-2 = 0.01` has no double; rounding to hundreds goes through the
    // exact `100` instead, so the scale is a true point and an exact
    // multiple of a hundred stays an exact point.
    const r = compile(ce.box(['Round', 'x', -2]), { to: 'interval-js' });
    expect(r.code).toBe('_IA.mul(_IA.round(_IA.div(_.x, _k1)), _k1)');
    expect(r.run!({ x: { lo: 1234.5, hi: 1234.5 } })).toEqual({
      kind: 'interval',
      value: { lo: 1200, hi: 1200 },
    });
    expect(r.run!({ x: { lo: 1250, hi: 1250 } })).toEqual({
      kind: 'interval',
      value: { lo: 1300, hi: 1300 },
    });
  });
  test('a positive precision multiplies by the exact 10^n first', () => {
    const r = compile(ce.box(['Round', 'x', 2]), { to: 'interval-js' });
    expect(r.code).toBe('_IA.div(_IA.round(_IA.mul(_.x, _k1)), _k1)');
    const v = r.run!({ x: { lo: 0.125, hi: 0.125 } }) as {
      value: { lo: number; hi: number };
    };
    // 13/100 has no double; the quotient is an enclosure of it.
    expect(v.value.lo).toBeLessThanOrEqual(0.13);
    expect(v.value.hi).toBeGreaterThanOrEqual(0.13);
    expect(v.value.hi - v.value.lo).toBeLessThan(1e-15);
  });
});

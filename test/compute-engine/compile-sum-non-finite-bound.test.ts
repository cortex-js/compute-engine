/**
 * A `Sum`/`Product` whose loop bound is not a finite number must FAIL CLOSED
 * (D6) rather than compile to a loop that cannot terminate.
 *
 * `Math.floor(Infinity)` is `Infinity`, so `while (i <= _upper)` never fails;
 * `-Infinity + 1` is `-Infinity`, so the counter never advances. Either way the
 * compiled function locks the caller's thread with no timeout and no way out —
 * for a plotting consumer compiling user input, a frozen tab.
 *
 * SUITE SAFETY: no test here ever calls `run()` on a compiled loop whose bound
 * could be non-finite. A statically non-finite bound never produces compiled
 * code at all (the compile declines), and a symbolic bound emits a
 * loop-entry finiteness guard that returns `NaN` — a jest timeout cannot
 * interrupt synchronous JS, so the guarantee has to come from the emitted code.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { JavaScriptTarget } from '../../src/compute-engine/compilation/javascript-target';
import { IntervalJavaScriptTarget } from '../../src/compute-engine/compilation/interval-javascript-target';

const ce = new ComputeEngine();

/** `compile()` falls back to the interpreter with a `console.warn`. */
let warn: jest.SpyInstance;
beforeAll(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => warn.mockRestore());

const INFINITE_SUM = () => ce.parse('\\sum_{i=1}^{\\infty} 2^{-i}');

describe('Sum/Product with a non-finite bound fails closed (D6)', () => {
  it('declines an infinite upper bound instead of emitting an endless loop', () => {
    const result = compile(INFINITE_SUM(), { constantFold: false });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Sum: the upper bound/);
    expect(result.error).toMatch(/Fail closed \(D6\)\./);
  });

  it.each([
    ['Sum', 'PositiveInfinity', 'upper', ['Sum', 'i', ['Limits', 'i', 1, 'PositiveInfinity']]],
    ['Sum', 'NegativeInfinity', 'lower', ['Sum', 'i', ['Limits', 'i', 'NegativeInfinity', 10]]],
    ['Sum', 'NaN', 'upper', ['Sum', 'i', ['Limits', 'i', 1, 'NaN']]],
    ['Sum', 'NaN', 'lower', ['Sum', 'i', ['Limits', 'i', 'NaN', 5]]],
    ['Product', 'PositiveInfinity', 'upper', ['Product', 'i', ['Limits', 'i', 1, 'PositiveInfinity']]],
    ['Product', 'NegativeInfinity', 'lower', ['Product', 'i', ['Limits', 'i', 'NegativeInfinity', 5]]],
    ['Product', 'NaN', 'upper', ['Product', 'i', ['Limits', 'i', 1, 'NaN']]],
  ] as const)('%s with a %s %s bound throws on the direct target', (kind, _bound, which, json) => {
    expect(() =>
      new JavaScriptTarget().compile(ce.box(json as any), {
        constantFold: false,
      })
    ).toThrow(
      new RegExp(`${kind}: the ${which} bound .* is not a finite number`)
    );
  });

  it('declines rather than trying to UNROLL an infinite range', () => {
    // The unroll path runs `for (k = lower; k <= upper; k++)` at COMPILE time:
    // reaching it with an infinite bound would hang the compiler itself.
    // Returning at all is the assertion; the message pins which arm declined.
    const result = compile(INFINITE_SUM(), { constantFold: false });
    expect(result.success).toBe(false);
  });

  it('declines an infinite bound nested inside a larger expression', () => {
    const result = compile(ce.parse('1 + \\sum_{i=1}^{\\infty} 2^{-i}'), {
      constantFold: false,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Fail closed \(D6\)\./);
  });

  it('declines when only a TRAILING indexing set is infinite', () => {
    const result = compile(
      ce.box([
        'Sum',
        ['Multiply', 'i', 'j'],
        ['Limits', 'i', 1, 3],
        ['Limits', 'j', 1, 'PositiveInfinity'],
      ]),
      { constantFold: false }
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Fail closed \(D6\)\./);
  });

  it('the interpreter still evaluates the series', () => {
    expect(INFINITE_SUM().N().re).toBeCloseTo(1, 10);
    // `evaluate()` keeps it symbolic (exactness contract), it does not error
    expect(INFINITE_SUM().evaluate().operator).toBe('Sum');
  });

  it('an explicit iterationBudget is exempt — the budget guard terminates', () => {
    // The numeric limit ladder opts into a bounded loop; its entry guard is
    // false for an infinite bound, so the loop returns NaN without running.
    const result = compile(INFINITE_SUM(), {
      iterationBudget: 1e6,
      constantFold: false,
    });
    expect(result.success).toBe(true);
    expect(result.run!({})).toBeNaN();
  });

  it('the interval-js target declines it too', () => {
    // `compileOrThrow` reports this class as `success: false` rather than
    // throwing, so the decline is read off the result.
    const direct = new IntervalJavaScriptTarget().compile(INFINITE_SUM(), {
      constantFold: false,
    });
    expect(direct.success).toBe(false);
    expect(direct.error).toMatch(
      /Sum: the upper bound .* is not a finite number/
    );
    expect(
      compile(INFINITE_SUM(), { to: 'interval-js', constantFold: false })
        .success
    ).toBe(false);
  });
});

describe('the GPU targets decline a non-finite bound too', () => {
  // A shader `for (int i = 1; i <= _gpu_inf(); i++)` is a type error rather
  // than a hang, but the fail-closed rule is the same: never emit a loop with
  // no terminating condition.
  it.each([
    ['Sum', 'upper', ['Sum', 'i', ['Limits', 'i', 1, 'PositiveInfinity']]],
    ['Sum', 'lower', ['Sum', 'i', ['Limits', 'i', 'NegativeInfinity', 10]]],
    ['Sum', 'upper', ['Sum', 'i', ['Limits', 'i', 1, 'NaN']]],
    ['Sum', 'lower', ['Sum', 'i', ['Limits', 'i', 'NaN', 5]]],
    [
      'Product',
      'upper',
      ['Product', 'i', ['Limits', 'i', 1, 'PositiveInfinity']],
    ],
    [
      'Product',
      'lower',
      ['Product', 'i', ['Limits', 'i', 'NegativeInfinity', 5]],
    ],
    ['Product', 'upper', ['Product', 'i', ['Limits', 'i', 1, 'NaN']]],
  ] as const)('%s with a non-finite %s bound', (kind, which, json) => {
    for (const to of ['glsl', 'wgsl'] as const) {
      const result = compile(ce.box(json as any), {
        to,
        constantFold: false,
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(
        new RegExp(`${kind}: the ${which} bound .* is not a finite number`)
      );
      expect(result.error).toMatch(/Fail closed \(D6\)\./);
    }
  });

  it.each(['glsl', 'wgsl'] as const)(
    'the parsed infinite series declines on %s',
    (to) => {
      const result = compile(INFINITE_SUM(), { to, constantFold: false });
      expect(result.success).toBe(false);
      expect(result.code).not.toMatch(/_gpu_inf\(\)|bitcast<f32>/);
    }
  );

  it.each([
    ['glsl', '((1.0) + (2.0) + (3.0) + (4.0) + (5.0) + (6.0) + (7.0) + (8.0) + (9.0) + (10.0))'],
    ['wgsl', '((1.0) + (2.0) + (3.0) + (4.0) + (5.0) + (6.0) + (7.0) + (8.0) + (9.0) + (10.0))'],
  ] as const)('a finite sum still compiles unchanged on %s', (to, code) => {
    const result = compile(ce.parse('\\sum_{i=1}^{10} i'), {
      to,
      constantFold: false,
    });
    expect(result.success).toBe(true);
    expect(result.code).toBe(code);
  });
});

describe('finite Sum/Product still compiles and runs', () => {
  it('sum_{i=1}^{10} i = 55', () => {
    const result = compile(ce.parse('\\sum_{i=1}^{10} i'));
    expect(result.success).toBe(true);
    expect(result.run!({})).toBe(55);
  });

  it('prod_{i=1}^{5} i = 120', () => {
    const result = compile(ce.parse('\\prod_{i=1}^{5} i'));
    expect(result.success).toBe(true);
    expect(result.run!({})).toBe(120);
  });

  it('a constant-bounds sum still UNROLLS, with unchanged source', () => {
    const result = compile(ce.parse('\\sum_{i=1}^{10} i'), {
      constantFold: false,
    });
    expect(result.code).toBe(
      '((1) + (2) + (3) + (4) + (5) + (6) + (7) + (8) + (9) + (10))'
    );
  });

  it('a large constant-bounds sum loops with NO added guard', () => {
    const result = compile(ce.parse('\\sum_{i=1}^{200} i'));
    expect(result.success).toBe(true);
    expect(result.code).not.toMatch(/Number\.isFinite/);
    expect(result.run!({})).toBe(20100);
  });

  it('a sum nested in an expression still compiles', () => {
    const result = compile(ce.parse('1 + \\sum_{i=1}^{10} i'));
    expect(result.success).toBe(true);
    expect(result.run!({})).toBe(56);
  });

  it('sum_{i=1}^{n} i with n = 100 is 5050', () => {
    const result = compile(ce.parse('\\sum_{i=1}^{n} i'));
    expect(result.success).toBe(true);
    expect(result.run!({ n: 100 })).toBe(5050);
  });

  it('sum_{i=m}^{n} i with m = 3, n = 7 is 25', () => {
    const result = compile(ce.parse('\\sum_{i=m}^{n} i'));
    expect(result.success).toBe(true);
    expect(result.run!({ m: 3, n: 7 })).toBe(25);
  });
});

describe('a SYMBOLIC bound is guarded at run time, not at compile time', () => {
  // Compiling cannot decide whether `n` is finite, so the emitted loop checks
  // both bounds ONCE at entry (never per iteration) and answers NaN. It rejects
  // no finite range however large — no trip-count policy is imposed.
  const symbolicUpper = () => compile(ce.parse('\\sum_{i=1}^{n} i'));
  const symbolicLower = () => compile(ce.parse('\\sum_{i=m}^{10} i'));

  it('emits the entry guard for a symbolic bound', () => {
    expect(symbolicUpper().code).toMatch(
      /if \(!Number\.isFinite\(_upper\) \|\| !Number\.isFinite\(i\)\) return NaN;/
    );
  });

  it('a runtime +Infinity upper bound answers NaN instead of hanging', () => {
    expect(symbolicUpper().run!({ n: Infinity })).toBeNaN();
  });

  it('a runtime NaN upper bound answers NaN', () => {
    expect(symbolicUpper().run!({ n: NaN })).toBeNaN();
  });

  it('a runtime -Infinity lower bound answers NaN instead of hanging', () => {
    expect(symbolicLower().run!({ m: -Infinity })).toBeNaN();
  });

  it('the interval target guards a symbolic bound with `entire`', () => {
    const result = compile(ce.parse('\\sum_{i=1}^{n} i'), { to: 'interval-js' });
    expect(result.success).toBe(true);
    expect(result.run!({ n: Infinity })).toEqual({ kind: 'entire' });
  });
});

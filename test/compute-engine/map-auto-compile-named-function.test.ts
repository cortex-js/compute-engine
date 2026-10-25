import { ComputeEngine } from '../../src/compute-engine';
import { BigDecimal } from '../../src/big-decimal';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import {
  _mapAutoCompileStats as stats,
  _resetMapAutoCompileStats,
} from '../../src/compute-engine/library/map-auto-compile';

/**
 * The marked (float) tier of the `Map` auto-compilation for a `Map` whose
 * element function is a NAMED user function: `g(x) = N(sin(x) + x^2)`, then
 * `sum(map(g, 1..2000))` (ROADMAP CE-325.2). The literal of `g` is compiled
 * as a lambda with the same body would be.
 *
 * The rules of the marked tier apply: the compiled code runs only at machine
 * precision (user decision 2026-10-24, ROADMAP CE-314). A body in `N(…)`
 * permits the compiled code to compute at machine precision, so a named
 * function whose body applies a loop compiles, as a lambda with the same body
 * does (user decision 2026-10-25, ROADMAP CE-325.3).
 *
 * Each assertion compares the value with `ce.jit = 'off'` (the interpreter)
 * and the counters, so an all-interpreter implementation cannot pass.
 *
 * `precision = 'machine'` changes the global `BigDecimal.precision`, so it
 * is saved and restored.
 */

let savedPrecision: number;
beforeAll(() => {
  savedPrecision = BigDecimal.precision;
});
afterAll(() => {
  BigDecimal.precision = savedPrecision;
});

/** Run `program` interpreted and with the auto-compilation, each on a new
 * engine. */
function both(program: string, machine = true) {
  const values: string[] = [];
  let hits = 0;
  let attempts = 0;
  for (const jit of ['off', 'auto'] as const) {
    const ce = new ComputeEngine();
    if (machine) ce.precision = 'machine';
    ce.jit = jit;
    _resetMapAutoCompileStats();
    const r = executeEpsil(ce, program);
    values.push(r.value.toString());
    if (jit === 'auto') {
      hits = stats.compiledHits;
      attempts = stats.attempts;
    }
  }
  return { interpreted: values[0], compiled: values[1], hits, attempts };
}

describe('Map of a named user function — the marked tier (CE-325.2)', () => {
  test('a numeric body compiles at machine precision', () => {
    const r = both('g(x) = N(sin(x) + x^2)\nsum(map(g, 1..2000))');
    expect(r.hits).toBe(2000);
    expect(r.compiled).toBe(r.interpreted);
  });

  test('the elements are the interpreter elements', () => {
    const r = both('g(x) = N(sqrt(x) * 3 + cos(x))\nmap(g, 1..2000)');
    expect(r.hits).toBeGreaterThan(0);
    expect(r.compiled).toBe(r.interpreted);
  });

  test('the default precision stays interpreted', () => {
    const r = both('g(x) = N(sin(x) + x^2)\nsum(map(g, 1..200))', false);
    expect(r.attempts).toBe(0);
    expect(r.hits).toBe(0);
    expect(r.compiled).toBe(r.interpreted);
  });

  test('a body that reduces an inner collection stays interpreted', () => {
    // A `Sum` without bounds reduces a collection: its trip count is known
    // only at run time, so `bodyEligible()` refuses it. The refusal is the
    // same for the named function and for the lambda.
    for (const program of [
      'g(x) = N(sum(map(d => d^4, integerDigits(x))))\nsum(map(g, 1..200))',
      'sum(map(x => N(sum(map(d => d^4, integerDigits(x)))), 1..200))',
    ]) {
      const r = both(program);
      expect(r.hits).toBe(0);
      expect(r.compiled).toBe(r.interpreted);
    }
  });

  test('a body that calls a function with a loop compiles, as a lambda does', () => {
    // `hl` sums over a literal range. The body of `gl` is in `N(…)`, which
    // permits the compiled code to compute at machine precision: the named
    // function and the lambda with the same body both compile (user decision
    // 2026-10-25, ROADMAP CE-325.3).
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    ce.assign(
      'hl',
      ce.box([
        'Function',
        ['Sum', ['Divide', 'x', 'k'], ['Limits', 'k', 1, 10]],
        'x',
      ])
    );
    const lambda = ['Function', ['N', ['Add', ['hl', 'x'], 1]], 'x'] as const;
    ce.assign('gl', ce.box(lambda));
    const elements = (f: 'gl' | typeof lambda): number[] =>
      [...ce.box(['Map', f, ['Range', 1, 200]]).evaluate().each()].map(
        (x) => x.re
      );

    _resetMapAutoCompileStats();
    const named = elements('gl');
    expect(stats.compiledHits).toBe(200);
    _resetMapAutoCompileStats();
    const anonymous = elements(lambda);
    expect(stats.compiledHits).toBe(200);
    expect(named).toEqual(anonymous);

    _resetMapAutoCompileStats();
    const sum = ce.box(['Sum', ['Map', 'gl', ['Range', 1, 200]]]).evaluate();
    expect(stats.compiledHits).toBe(200);
    expect(
      sum.isSame(ce.box(['Sum', ['Map', lambda, ['Range', 1, 200]]]).evaluate())
    ).toBe(true);

    // The interpreter gives values that are near: the compiled code can
    // differ in the last digits.
    ce.jit = 'off';
    const interpreted = elements('gl');
    for (let i = 0; i < 200; i++)
      expect(named[i]).toBeCloseTo(interpreted[i], 10);
  });

  test('a redefinition of the function compiles again', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    ce.assign('gr', ce.box(['Function', ['N', ['Sin', 'x']], 'x']));
    const sum = ce.box(['Sum', ['Map', 'gr', ['Range', 1, 200]]]);
    const first = sum.evaluate();
    ce.assign('gr', ce.box(['Function', ['N', ['Cos', 'x']], 'x']));
    _resetMapAutoCompileStats();
    const second = sum.evaluate();
    expect(stats.compiledHits).toBe(200);
    ce.jit = 'off';
    expect(second.isSame(sum.evaluate())).toBe(true);
    expect(first.isSame(second)).toBe(false);
  });
});

describe('Map auto-compilation — the cap on the total trip count of loops', () => {
  // The compiled code has no deadline check in a loop, so the eligibility
  // check caps the TOTAL work of an element: the product of the trip counts
  // of nested loops, also through a called user function, must be at most
  // 10^5. The `If` keeps the interpreter fast: it does not evaluate the
  // nested sums when `x > 0`, while the eligibility check still reads them.
  // The inputs are floats, so the comparison in the `If` does not keep the
  // body interpreted.
  const run = (n: number, form: 'nested' | 'limits' | 'callee') => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    const term = ['Multiply', 'j', 'k', 'x'];
    ce.assign(
      'hn',
      ce.box(['Function', ['Sum', term, ['Limits', 'j', 1, n]], 'x', 'k'])
    );
    const loops =
      form === 'nested'
        ? ['Sum', ['Sum', term, ['Limits', 'j', 1, n]], ['Limits', 'k', 1, n]]
        : form === 'limits'
          ? ['Sum', term, ['Limits', 'j', 1, n], ['Limits', 'k', 1, n]]
          : ['Sum', ['hn', 'x', 'k'], ['Limits', 'k', 1, n]];
    const body = ['If', ['Greater', 'x', 0], ['Add', 'x', 1], loops];
    _resetMapAutoCompileStats();
    const result = ce
      .box(['Map', ['Function', ['N', body], 'x'], ['List', 1.5, 2.5, 3.5]])
      .evaluate();
    return { result: result.toString(), hits: stats.compiledHits };
  };

  for (const form of ['nested', 'limits', 'callee'] as const) {
    test(`10 × 10 iterations compile (${form})`, () => {
      expect(run(10, form)).toEqual({ result: '[2.5,3.5,4.5]', hits: 3 });
    });

    test(`1,000 × 1,000 iterations stay interpreted (${form})`, () => {
      expect(run(1000, form)).toEqual({ result: '[2.5,3.5,4.5]', hits: 0 });
    });
  }

  test('nested loops with no guard compile and give the interpreter values', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    const body = [
      'Sum',
      ['Sum', ['Multiply', 'j', 'k', 'x'], ['Limits', 'j', 1, 10]],
      ['Limits', 'k', 1, 10],
    ];
    const map = ce.box(['Map', ['Function', ['N', body], 'x'], ['Range', 1, 3]]);
    _resetMapAutoCompileStats();
    // The value of a `Map` is lazy: `toString()` computes the elements.
    const compiled = map.evaluate().toString();
    expect(stats.compiledHits).toBe(3);
    ce.jit = 'off';
    expect(map.evaluate().toString()).toBe(compiled);
    expect(compiled).toBe('[3025,6050,9075]');
  });
});

describe('Map of a named user function — the binding and the signature', () => {
  test('a drain in a scope that shadows the function uses the lexical binding', () => {
    // The `Map` is bound to the outer `gx`. The interpreter applies that
    // binding also when an inner scope defines another `gx`.
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    ce.assign('gx', ce.box(['Function', ['N', ['Add', 'x', 0.5]], 'x']));
    const sum = ce.box(['Sum', ['Map', 'gx', ['Range', 1, 100]]]);
    ce.pushScope();
    try {
      ce.declare('gx', 'function');
      ce.assign('gx', ce.box(['Function', ['N', ['Add', 'x', 0.25]], 'x']));
      const compiled = sum.evaluate();
      ce.jit = 'off';
      const interpreted = sum.evaluate();
      expect(interpreted.re).toBe(5100);
      expect(compiled.isSame(interpreted)).toBe(true);
    } finally {
      ce.popScope();
    }
  });

  test('a declared signature that refuses some elements stays interpreted', () => {
    // The interpreter refuses an argument above 10: the compiled code must
    // not return a value for it.
    const r = both(
      'let gsig: (real<0..10>) -> real\ngsig(x) = N(x + 0.5)\nmap(gsig, 1..64)'
    );
    expect(r.hits).toBe(0);
    expect(r.compiled).toBe(r.interpreted);
  });

  test('a declared signature that accepts every element compiles', () => {
    const r = both(
      'let greal: (real) -> real\ngreal(x) = N(x + 0.5)\nsum(map(greal, 1..200))'
    );
    expect(r.hits).toBe(200);
    expect(r.compiled).toBe(r.interpreted);
  });
});

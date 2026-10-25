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
 * The rules of the marked tier apply (user decision 2026-10-24, ROADMAP
 * CE-314): the compiled code runs only at machine precision, and a named
 * function whose body applies a loop or computes a collection stays
 * interpreted.
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

  test('a body with an inner collection stays interpreted', () => {
    const r = both(
      'g(x) = N(sum(map(d => d^4, integerDigits(x))))\nsum(map(g, 1..200))'
    );
    expect(r.hits).toBe(0);
    expect(r.compiled).toBe(r.interpreted);
  });

  test('a body that calls a function with a loop stays interpreted', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    // `h` sums over a literal range: a lambda with this body is eligible
    // (`bodyEligible()`), a named function is not.
    ce.assign(
      'hl',
      ce.box([
        'Function',
        ['Sum', ['Divide', 'x', 'k'], ['Limits', 'k', 1, 10]],
        'x',
      ])
    );
    ce.assign(
      'gl',
      ce.box(['Function', ['N', ['Add', ['hl', 'x'], 1]], 'x'])
    );
    _resetMapAutoCompileStats();
    const compiled = ce.box(['Sum', ['Map', 'gl', ['Range', 1, 200]]]).evaluate();
    expect(stats.compiledHits).toBe(0);
    ce.jit = 'off';
    const interpreted = ce
      .box(['Sum', ['Map', 'gl', ['Range', 1, 200]]])
      .evaluate();
    expect(compiled.isSame(interpreted)).toBe(true);
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

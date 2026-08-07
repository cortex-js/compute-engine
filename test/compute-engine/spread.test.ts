import { ComputeEngine } from '../../src/compute-engine';

//
// `Spread` — the engine marker behind the Epsil spread syntax `f(...t)`.
//
// A `Spread` operand whose argument is a literal `Tuple` splices at
// canonicalization (via `Sequence`); a symbolic argument defers — argument
// validation and the operator's canonical handler are both skipped — until
// the enclosing call's evaluation (step 0 of `_computeValue`) resolves the
// tuple, splices its elements, and rebuilds the call through `ce.function`,
// which re-runs canonicalization and validation on the real arguments.
//
// Tuples only: a definite non-tuple value (a number, a string, a `List`) is
// an `incompatible-type` error; an unresolved argument leaves the call
// symbolic (a `Spread` operand must never bind positionally to a parameter).
//

describe('Spread: canonicalization', () => {
  test('a literal tuple splices at canonicalization', () => {
    const ce = new ComputeEngine();
    ce.assign('a', ce.parse('(x, y) \\mapsto x + 2 y'));
    const e = ce.box(['a', ['Spread', ['Tuple', 3, 4]]]);
    expect(e.toString()).toBe('a(3, 4)');
    expect(e.evaluate().isSame(11)).toBe(true);
  });

  test('a symbolic spread stays a Spread operand, deferring validation', () => {
    const ce = new ComputeEngine();
    // Strict mode, explicit arity-2 signature: without deferral this would
    // canonicalize to a missing-argument error.
    ce.declare('h', '(number, number) -> number');
    const e = ce.box(['h', ['Spread', 'p']]);
    expect(e.isValid).toBe(true);
    expect(e.ops?.[0].operator).toBe('Spread');
  });

  test('a numeric head with a spread skips the numeric fast path', () => {
    const ce = new ComputeEngine();
    // Without the fast-path deferral, single-operand `Add` unwraps to its
    // argument and the spread is lost.
    const e = ce.box(['Add', ['Spread', 't']]);
    expect(e.operator).toBe('Add');
    expect(e.ops?.[0].operator).toBe('Spread');
  });
});

describe('Spread: evaluation splices a tuple value', () => {
  test('user function, box route and function route agree', () => {
    const ce = new ComputeEngine();
    ce.assign('a', ce.parse('(x, y) \\mapsto x + 2 y'));
    ce.assign('p', ce.box(['Tuple', 3, 4]));
    expect(ce.box(['a', ['Spread', 'p']]).evaluate().isSame(11)).toBe(true);
    expect(
      ce
        .function('a', [ce.box(['Spread', 'p'])])
        .evaluate()
        .isSame(11)
    ).toBe(true);
  });

  test('numeric heads re-canonicalize after the splice', () => {
    const ce = new ComputeEngine();
    ce.assign('t', ce.box(['Tuple', 1, 2, 3]));
    ce.assign('u', ce.box(['Tuple', 8, 2]));
    expect(ce.box(['Add', ['Spread', 't']]).evaluate().isSame(6)).toBe(true);
    expect(
      ce.box(['Add', 10, ['Spread', 't']]).evaluate().isSame(16)
    ).toBe(true);
    expect(
      ce.box(['Multiply', ['Spread', 't']]).evaluate().isSame(6)
    ).toBe(true);
    expect(ce.box(['Divide', ['Spread', 'u']]).evaluate().isSame(4)).toBe(
      true
    );
    expect(ce.box(['Power', ['Spread', 'u']]).evaluate().isSame(64)).toBe(
      true
    );
  });

  test('variadic built-ins accept a spread', () => {
    const ce = new ComputeEngine();
    ce.assign('t', ce.box(['Tuple', 3, 41, 7]));
    expect(ce.box(['Max', ['Spread', 't']]).evaluate().isSame(41)).toBe(true);
    expect(
      ce
        .box(['GCD', ['Spread', ['Tuple', 48, 36]]])
        .evaluate()
        .isSame(12)
    ).toBe(true);
  });

  test('numericApproximation applies to the rebuilt call', () => {
    const ce = new ComputeEngine();
    const v = ce.box(['Divide', ['Spread', ['Tuple', 1, 3]]]).N();
    expect(v.re).toBeCloseTo(1 / 3, 10);
  });

  test('async evaluation splices too', async () => {
    const ce = new ComputeEngine();
    ce.assign('a', ce.parse('(x, y) \\mapsto x + 2 y'));
    ce.assign('p', ce.box(['Tuple', 3, 4]));
    const v = await ce.box(['a', ['Spread', 'p']]).evaluateAsync();
    expect(v.isSame(11)).toBe(true);
  });
});

describe('Spread: non-tuple arguments', () => {
  test('an unresolved symbol leaves the call symbolic', () => {
    const ce = new ComputeEngine();
    const v = ce.box(['g', ['Spread', 'w']]).evaluate();
    expect(v.operator).toBe('g');
    expect(v.ops?.[0].operator).toBe('Spread');
  });

  test('a definite non-tuple value is an incompatible-type error', () => {
    const ce = new ComputeEngine();
    ce.assign('a', ce.parse('(x, y) \\mapsto x + 2 y'));
    ce.assign('n', 5);
    const v = ce.box(['a', ['Spread', 'n']]).evaluate();
    expect(v.isValid).toBe(false);
    expect(v.toString()).toContain('incompatible-type');
  });

  test('a List does not spread (tuples only)', () => {
    const ce = new ComputeEngine();
    ce.assign('a', ce.parse('(x, y) \\mapsto x + 2 y'));
    ce.assign('l', ce.box(['List', 3, 4]));
    const v = ce.box(['a', ['Spread', 'l']]).evaluate();
    expect(v.isValid).toBe(false);
    expect(v.toString()).toContain('incompatible-type');
  });
});

//
// Compilation: a Spread operand is spliced STATICALLY — a literal tuple
// directly, a tuple-typed argument via positional `At` accesses. Unknown
// arity fails closed (D6): a dynamic JS/Python spread would silently
// mis-bind on an arity mismatch instead of erroring like the interpreter.
//
describe('Spread: compilation', () => {
  const { compile } = require('../../src/compute-engine/compilation/compile-expression');

  test('a tuple-typed argument compiles to positional accesses', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'tuple<number, number>');
    ce.assign('a', ce.parse('(x, y) \\mapsto x + 2 y'));
    const r = compile(ce.box(['a', ['Spread', 'p']]));
    expect(r?.success).toBe(true);
    expect(r!.run!({ p: [3, 4] })).toBe(11);
  });

  test('a raw-held spread under a lazy numeric head compiles', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'tuple<number, number>');
    const r = compile(ce.box(['Add', 5, ['Spread', 'p']]));
    expect(r?.success).toBe(true);
    expect(r!.run!({ p: [3, 4] })).toBe(12);
  });

  test('a literal tuple spread compiles (spliced at canonicalization)', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.box(['Add', ['Spread', ['Tuple', 1, 2, 3]], 10]));
    expect(r?.success).toBe(true);
    expect(r!.run!()).toBe(16);
  });

  test('a variadic built-in over a typed tuple compiles', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'tuple<number, number>');
    const r = compile(ce.box(['Max', ['Spread', 'p']]));
    expect(r?.success).toBe(true);
    expect(r!.run!({ p: [7, 3] })).toBe(7);
  });

  test('unknown arity fails closed', () => {
    const ce = new ComputeEngine();
    ce.assign('a', ce.parse('(x, y) \\mapsto x + 2 y'));
    const r = compile(ce.box(['a', ['Spread', 'w']]));
    expect(r?.success).toBe(false);
  });

  test('compiled and interpreted results agree', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'tuple<number, number>');
    ce.assign('a', ce.parse('(x, y) \\mapsto x + 2 y'));
    const expr = ce.box(['a', ['Spread', 'p']]);
    const r = compile(expr);
    expect(r?.success).toBe(true);
    ce.assign('p', ce.box(['Tuple', 3, 4]));
    expect(expr.evaluate().isSame(r!.run!({ p: [3, 4] }))).toBe(true);
  });
});

import { ComputeEngine } from '../../src/compute-engine';

//
// `Spread` — the engine marker behind the Cortex spread syntax `f(...t)`.
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

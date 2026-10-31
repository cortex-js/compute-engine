import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

// GitHub issue #486: when `Solve` has no answer, its `evaluate` handler
// returned `undefined` for an equation that was already canonical (the box
// route) and an unevaluated `Solve` otherwise (the parse route, or a box
// route whose equation canonicalizes to a different form). A host that wraps
// the handler to try its own method when the solver gives up read the second
// shape as an answer. The handler now returns the unevaluated `Solve`, with
// the canonical equation, in every no-answer case.
describe('issue 486: the Solve handler has one no-answer shape', () => {
  const ce = new ComputeEngine();
  const def = (ce.lookupDefinition('Solve') as any).operator;
  const native = def.evaluate;
  const seen: (Expression | undefined)[] = [];
  def.evaluate = (ops: any, options: any) => {
    const result = native(ops, options);
    seen.push(result);
    return result;
  };
  afterAll(() => {
    def.evaluate = native;
  });

  const solve = (eq: unknown) => ce.box(['Solve', eq as any, 'x']).evaluate();

  test.each([
    // The equation is already canonical.
    ['cos x = x', ['Equal', ['Cos', 'x'], 'x']],
    // `Exp(x)` canonicalizes to `Power(ExponentialE, x)`.
    ['e^x = x + 2', ['Equal', ['Exp', 'x'], ['Add', 'x', 2]]],
    // `Subtract(x, 1)` canonicalizes to `Add(x, -1)`.
    [
      '(x - 1) J0(x) = 0',
      ['Equal', ['Multiply', ['Subtract', 'x', 1], ['BesselJ', 0, 'x']], 0],
    ],
  ])('%s: the handler returns the unevaluated Solve', (_label, eq) => {
    seen.length = 0;
    const result = solve(eq);
    expect(result.operator).toBe('Solve');
    expect(seen.length).toBeGreaterThan(0);
    const last = seen[seen.length - 1];
    expect(last).toBeDefined();
    expect(last!.operator).toBe('Solve');
    // The handler's result is the result of `evaluate()`, with the canonical
    // equation, so the parse route and the box route agree (CE-150).
    expect(JSON.stringify(last!.json)).toBe(JSON.stringify(result.json));
    expect(JSON.stringify(result.json)).not.toContain('"Exp"');
    expect(JSON.stringify(result.json)).not.toContain('"Subtract"');
  });

  test('a solved equation still gives its solutions', () => {
    seen.length = 0;
    expect(solve(['Equal', ['Square', 'x'], 4]).toString()).toBe('[2,-2]');
    expect(seen[seen.length - 1]!.operator).toBe('List');
  });

  test('NSolve stays unevaluated when Solve does', () => {
    const result = ce
      .box(['NSolve', ['Equal', ['Cos', 'x'], 'x'], 'x'])
      .evaluate();
    expect(result.operator).toBe('NSolve');
  });
});

import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { executeEpsil } from '../../src/epsil/execute-epsil';

// A constant is not redefinable, whatever it holds. The VALUE branch of
// assignment always refused a constant target (`assertAssignableValueDef`,
// engine-declarations.ts); the FUNCTION-LITERAL branch and the clause
// installer (`defineFunctionClause`, multi-clause.ts) converted the
// definition without that check, so `const k = (n) => n + 1` could be
// replaced by `k = (s) => s` or by `k(x) = x * 2` — and, on the host route,
// `ce.assign('Pi', …)` rewrote the engine's own `Pi` definition in place.

function run(source: string): ReturnType<typeof executeEpsil> {
  const ce = new ComputeEngine();
  const parseLatex = (latex: string): MathJsonExpression =>
    ce.parse(latex).json;
  return executeEpsil(ce, source, { parseLatex });
}

const LAMBDA: MathJsonExpression = ['Function', ['Multiply', 2, 'x'], 'x'];

describe('CONSTANT — a function literal cannot replace a constant', () => {
  test('host route: a user constant refuses a function-literal assignment', () => {
    const ce = new ComputeEngine();
    ce.declare('c', { value: 5, isConstant: true });
    expect(() => ce.assign('c', LAMBDA)).toThrow(
      'Cannot assign a value to the constant "c"'
    );
    // The same refusal the value branch makes.
    expect(() => ce.assign('c', 6)).toThrow(
      'Cannot assign a value to the constant "c"'
    );
    expect(ce.box('c').evaluate().re).toBe(5);
  });

  test('host route: a system-scope constant is left intact', () => {
    const ce = new ComputeEngine();
    expect(() => ce.assign('Pi', LAMBDA)).toThrow(
      'Cannot assign a value to the constant "Pi"'
    );
    // The definition was previously converted IN PLACE into the operator, so
    // `Pi(3)` answered `6` on this engine.
    expect(ce.box(['Pi', 3]).evaluate().operator).toBe('Error');
    expect(ce.box('Pi').N().re).toBeCloseTo(Math.PI, 12);
  });

  test('Epsil: a `const` function reassigned is a runtime error, binding kept', () => {
    const { value, diagnostics } = run(
      'const k = (n) => n + 1\nk = (s) => s\nk(1)'
    );
    expect(diagnostics.map((d) => [d.message[0], d.message[1]])).toEqual([
      ['runtime-error', 'Cannot assign a value to the constant "k"'],
    ]);
    expect(value.re).toBe(2);
  });

  test('Epsil: a clause definition on a `const` function is refused', () => {
    const { value, diagnostics } = run(
      'const k = (n) => n\nk(x) = x * 2\nk(3)'
    );
    expect(diagnostics.map((d) => d.message[0])).toEqual(['runtime-error']);
    expect(String(diagnostics[0].message[1])).toContain(
      '"k" is a constant; it cannot be redefined'
    );
    expect(value.re).toBe(3);
  });

  test('Epsil: a `let` function is still replaceable by both routes', () => {
    expect(run('let k = (n) => n + 1\nk = (s) => s\nk(1)').value.re).toBe(1);
    expect(run('let k = (n) => n\nk(x) = x * 2\nk(3)').value.re).toBe(6);
  });
});

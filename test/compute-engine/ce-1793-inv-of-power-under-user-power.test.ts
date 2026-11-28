import { ComputeEngine } from '../../src/compute-engine';

// CE-1793: in a scope where a user function named `Power` or `Root` shadows
// the library operator, the reciprocal of a library call `y^x` or
// `Root(y, x)` with a symbolic exponent is a call of the library operator,
// not of the user function.

type Expr = ReturnType<ComputeEngine['symbol']>;

const valueAt = (e: Expr, at: Record<string, number>) => e.subs(at).N().re;

describe('CE-1793: the reciprocal of a library power under a user Power', () => {
  for (const name of ['Power', 'Root'] as const) {
    test(`a user ${name}`, () => {
      const ce = new ComputeEngine();
      ce.pushScope();
      try {
        ce.declare(name, 'function');
        ce.assign(
          name,
          ce.expr(['Function', ['Add', 'a', 'b', 100], 'a', 'b'])
        );
        const y = ce.symbol('y');
        const x = ce.symbol('x');
        const p = ce._libraryCall(name, [y, x])!;
        const expected = name === 'Power' ? 3 ** -2 : 3 ** -0.5;
        expect(valueAt(p.inv(), { x: 2, y: 3 })).toBeCloseTo(expected, 12);
        // A call of the user function is a value: its reciprocal is `1/105`.
        const u = ce.expr([name, 'y', 'x']);
        expect(valueAt(u.inv(), { x: 2, y: 3 })).toBeCloseTo(1 / 105, 12);
      } finally {
        ce.popScope();
      }
    });
  }

  test('without a user function, the reciprocal is a library call', () => {
    const ce = new ComputeEngine();
    const y = ce.symbol('y');
    const x = ce.symbol('x');
    expect(ce.function('Power', [y, x]).inv().json).toEqual([
      'Power',
      'y',
      ['Negate', 'x'],
    ]);
    expect(ce.function('Root', [y, x]).inv().json).toEqual([
      'Root',
      'y',
      ['Negate', 'x'],
    ]);
  });
});

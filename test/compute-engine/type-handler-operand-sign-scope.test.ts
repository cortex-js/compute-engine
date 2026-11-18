import { ComputeEngine } from '../../src/compute-engine';

// A type handler reads the sign of an operand. The sign of an application
// whose evaluation opens a scope (a call of a user function, a `Sum`) is
// the sign of its type: its operator's `sgn` handler would evaluate it, and
// a type handler must not open and close a scope.
describe('the sign of an operand that a type handler reads', () => {
  test('a call of a user function', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.assign('g', ce.box(['Function', ['Multiply', 'a', 2], 'a']));
    for (const head of ['Mod', 'Remainder']) {
      const e = ce.box([head, 5, ['Floor', ['g', 1]]]);
      expect(() => e.type).not.toThrow();
    }
    expect(ce.box(['Mod', 5, ['Floor', ['g', 1]]]).evaluate().toString()).toBe(
      '1'
    );
    expect(() => ce.box(['Mod', 'x', ['Floor', ['g', 1]]]).type).not.toThrow();
  });

  test('a Sum or a Product with a bound variable', () => {
    const ce = new ComputeEngine();
    const sum = ['Sum', 2, ['Limits', 'k', 1, 5]];
    const e = ce.box(['Sqrt', ['Round', sum]]);
    expect(() => e.type).not.toThrow();
    expect(e.evaluate().toString()).toBe('sqrt(10)');
    const f = ce.box(['Exp', ['Round', ['Sum', 'Pi', ['Limits', 'k', 1, 5]]]]);
    expect(() => f.type).not.toThrow();
  });

  test('a constant of library operators keeps its sign', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Mod', 5, ['Floor', 'Pi']]).type.toString()).toBe(
      'integer'
    );
  });
});

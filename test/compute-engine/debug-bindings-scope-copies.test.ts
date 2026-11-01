import { ComputeEngine } from '../../src/compute-engine';

// The debug check of dead bindings (`ce._debugBindings`) reported a read of a
// binding of a discarded scope where the read was live:
//
// - An asynchronous evaluation of a `Sum` pushes an activation, a copy of the
//   local scope of the `Sum` with its own definitions. After a synchronous
//   evaluation, the definitions of the local scope kept the tombstone of its
//   pop, and the check read them in place of the definitions of the
//   activation.
// - Two scope objects can hold one definition: each call of a function whose
//   body is a comprehension returns a new comprehension node with a new local
//   scope, and these scopes hold the same index definition. The pop of one
//   such scope tombstoned the index while a walk in the other still read it.
//
// The last case was a real escape: an indefinite `Integrate` of a function
// parameter returned an antiderivative whose variable was bound to the
// discarded scope of the integral, not to the symbol of the enclosing scope.

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce._debugBindings = true;
  return ce;
}

describe('Debug check of dead bindings: copies of a scope', () => {
  test('a Sum evaluated, then evaluated asynchronously', async () => {
    const ce = engine();
    const e = ce.box(['Sum', ['Multiply', 'k', 2], ['Limits', 'k', 1, 3]]);
    expect(e.evaluate().toString()).toBe('12');
    expect((await e.evaluateAsync()).toString()).toBe('12');
  });

  test('a Sum with a Block body, evaluated, then evaluated asynchronously', async () => {
    const ce = engine();
    const e = ce.box([
      'Sum',
      ['Block', ['Multiply', 'k', 2]],
      ['Limits', 'k', 1, 3],
    ]);
    expect(e.evaluate().toString()).toBe('12');
    expect((await e.evaluateAsync()).toString()).toBe('12');
  });

  test('a Product evaluated, then evaluated asynchronously', async () => {
    const ce = engine();
    const e = ce.box(['Product', ['Add', 'k', 1], ['Limits', 'k', 1, 3]]);
    expect(e.evaluate().toString()).toBe('24');
    expect((await e.evaluateAsync()).toString()).toBe('24');
  });

  test('a lazy comprehension returned by a call, read through another call', () => {
    const ce = engine();
    ce.declare('u', 'function');
    ce.assign(
      'u',
      ce.box([
        'Function',
        [
          'Comprehension',
          ['At', 'l', ['Ceil', ['Divide', 'i', 2]]],
          ['Element', 'i', ['Range', 1, ['Multiply', 2, ['Length', 'l']]]],
        ],
        'l',
      ])
    );
    ce.assign('base', ce.box(['List', 1, 2, 3, 4]));
    const r = ce.box(['u', ['u', 'base']]).evaluate();
    expect([...r.each()].map((x) => x.re)).toEqual([
      1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4,
    ]);
  });
});

describe('Integrate of a function parameter', () => {
  test('the antiderivative reads the variable of the enclosing scope', () => {
    const ce = engine();
    ce.parse('g(f) := \\int f\\,dx').evaluate();
    const r = ce.parse('g(x)').evaluate();
    expect(r.toString()).toBe('1/2 * x^2');
    expect(r.isSame(ce.parse('\\frac12 x^2'))).toBe(true);
    expect(ce.parse('g(g(x))').evaluate().toString()).toBe('1/6 * x^3');
    // The `x` of the result is the global `x`: it reads its value.
    ce.assign('x', 3);
    expect(r.evaluate().toString()).toBe('9/2');
  });

  test('a renamed variable renamed back reads the variable of the enclosing scope', () => {
    // `g` reads a `k` of its own, so the integral is computed with the
    // variable renamed, and the variable is renamed back in the value.
    const ce = engine();
    ce.parse('g(a) := a k x').evaluate();
    ce.parse('k := 2').evaluate();
    const r = ce.parse('\\int g(k)\\,dk').evaluate();
    expect(r.toString()).toBe('x * k^2');
    expect(r.isSame(ce.parse('x k^2'))).toBe(true);
    expect(r.evaluate().toString()).toBe('4x');
  });

  test('a renamed variable that stays fresh reads the enclosing scope', () => {
    // `k` has no value: the value keeps the fresh name `k_1`.
    const ce = engine();
    ce.parse('g(a) := a k x').evaluate();
    const r = ce.parse('\\int g(k)\\,dk').evaluate();
    expect(r.toString()).toBe('1/2 * k * x * "k_1"^2');
    expect(r.isSame(ce.parse('\\frac12 k x k_1^2'))).toBe(true);
    expect(r.evaluate().toString()).toBe('1/2 * k * x * "k_1"^2');
    ce.assign('k_1', 3);
    ce.assign('k', 5);
    expect(r.evaluate().toString()).toBe('45/2 * x');
  });

  test('a list integrand reads the variable of the enclosing scope', () => {
    const ce = engine();
    const r = ce.parse('\\int [x, x^2]\\,dx').evaluate();
    expect(r.toString()).toBe('[1/2 * x^2,1/3 * x^3]');
    expect(r.isSame(ce.parse('[\\frac12 x^2, \\frac13 x^3]'))).toBe(true);
    ce.assign('x', 3);
    expect(r.evaluate().toString()).toBe('[9/2,9]');
  });

  test('a tuple integrand reads the variable of the enclosing scope', () => {
    const ce = engine();
    const r = ce.parse('\\int (x, x^2)\\,dx').evaluate();
    expect(r.toString()).toBe('(1/2 * x^2, 1/3 * x^3)');
    expect(r.isSame(ce.parse('(\\frac12 x^2, \\frac13 x^3)'))).toBe(true);
    ce.assign('x', 3);
    expect(r.evaluate().toString()).toBe('(9/2, 9)');
  });

  test('an integrand that calls a user function named like a library function', () => {
    const ce = engine();
    ce.parse('\\operatorname{Sin}(t) := t^2').evaluate();
    const r = ce.parse('\\int \\operatorname{Sin}(x)\\,dx').evaluate();
    expect(r.toString()).toBe('1/3 * x^3');
    expect(r.isSame(ce.parse('\\frac13 x^3'))).toBe(true);
    expect(r.evaluate().toString()).toBe('1/3 * x^3');
  });
});

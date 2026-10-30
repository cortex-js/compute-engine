import { ComputeEngine } from '../../src/compute-engine';

// The cache of derivative chains (`symbolic/derivative.ts`) must not keep a
// derivative that was computed while host code that does not state its
// purity ran. The differentiation of `f` evaluates `f(_)`, which evaluates
// the constant call `h(2)`, and `h` reads a JavaScript variable that the
// engine does not see. A kept chain would give the old value of `h(2)` after
// that variable changed.

function engineWithHost(): {
  ce: ComputeEngine;
  state: { k: number; calls: number };
} {
  const ce = new ComputeEngine();
  const state = { k: 1, calls: 0 };
  ce.declare('h', {
    signature: '(number) -> number',
    evaluate: ([x], { engine }) => {
      state.calls += 1;
      return engine.number(x.re + state.k);
    },
  });
  ce.assign('f', ce.box(['Function', ['Multiply', 'x', ['h', 2]], 'x']));
  return { ce, state };
}

describe('CE-628: DERIVATIVE CHAINS AND HOST CODE', () => {
  test('a new Derivative(f) sees the new value of the host code', () => {
    const { ce, state } = engineWithHost();
    expect(ce.box(['Derivative', 'f']).evaluate().toString()).toBe('(x) => 3');
    state.k = 1000;
    expect(ce.box(['Derivative', 'f']).evaluate().toString()).toBe(
      '(x) => 1002'
    );
  });

  test('an application of Derivative(f) sees the new value', () => {
    const { ce, state } = engineWithHost();
    expect(ce.box([['Derivative', 'f'], 5]).evaluate().re).toBe(3);
    state.k = 1000;
    expect(ce.box([['Derivative', 'f'], 5]).evaluate().re).toBe(1002);
  });

  test('a second derivative sees the new value', () => {
    const { ce, state } = engineWithHost();
    ce.assign(
      'g',
      ce.box(['Function', ['Multiply', ['Square', 'x'], ['h', 2]], 'x'])
    );
    expect(ce.box(['Derivative', 'g', 2]).evaluate().toString()).toBe(
      '(x) => 6'
    );
    state.k = 1000;
    expect(ce.box(['Derivative', 'g', 2]).evaluate().toString()).toBe(
      '(x) => 2004'
    );
  });

  test('a host function that states its purity keeps the cache', () => {
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('p', {
      signature: '(number) -> number',
      pure: true,
      evaluate: ([x], { engine }) => {
        calls += 1;
        return engine.number(x.re + 1);
      },
    });
    ce.assign('f', ce.box(['Function', ['Multiply', 'x', ['p', 2]], 'x']));
    expect(ce.box(['Derivative', 'f']).evaluate().toString()).toBe('(x) => 3');
    const callsAfterFirst = calls;
    expect(ce.box(['Derivative', 'f']).evaluate().toString()).toBe('(x) => 3');
    expect(calls).toBe(callsAfterFirst);
  });
});

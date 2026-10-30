import { ComputeEngine } from '../../src/compute-engine';
import * as DerivativeModule from '../../src/compute-engine/symbolic/derivative';

// The cache of derivative chains (`symbolic/derivative.ts`) must not use a
// chain step after a retype of a symbol that the step read. A retype moves
// neither the semantic version nor, for a symbol that the simplification
// removed from the result, a recorded dependency.

/** Count the calls of `name` (`derivative` or `differentiate`) from outside
 * its module made while `run` runs. A result served from the cache makes no
 * such call. */
function calls(name: 'derivative' | 'differentiate', run: () => void): number {
  const spy = jest.spyOn(DerivativeModule, name);
  try {
    run();
    return spy.mock.calls.length;
  } finally {
    spy.mockRestore();
  }
}

const COND = ['If', ['Element', 'b', 'Integers'], 10, 20];

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('b', 'integer');
  ce.assign('f', ce.box(['Function', ['Multiply', 'x', COND], 'x']));
  return ce;
}

function retype(ce: ComputeEngine): void {
  ce.box('b').valueDefinition!.type = 'real' as any;
}

describe('CE-647: DERIVATIVE CHAINS AND A RETYPE', () => {
  test('a new Derivative(f) sees the new type of b', () => {
    const ce = engine();
    expect(ce.box(['Derivative', 'f']).evaluate().toString()).toBe('(x) => 10');
    retype(ce);
    // `b` is no longer known to be an integer: the condition stays symbolic.
    expect(ce.box(['f', 1]).evaluate().toString()).toContain('Element');
    expect(ce.box(['Derivative', 'f']).evaluate().toString()).toContain(
      'Element'
    );
  });

  test('the chain is used again until the retype', () => {
    const ce = engine();
    const run = () => ce.box(['Derivative', 'f']).evaluate().toString();
    expect(calls('derivative', run)).toBeGreaterThan(0);
    // Served from the cache: no differentiation.
    expect(calls('derivative', run)).toBe(0);
    retype(ce);
    expect(calls('derivative', run)).toBeGreaterThan(0);
  });
});

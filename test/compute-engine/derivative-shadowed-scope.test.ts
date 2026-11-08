import { ComputeEngine } from '../../src/compute-engine';

//
// The derivative rules of the library build their result by name in the
// current scope. A call of the library `Sqrt` differentiated in a scope that
// declares a user `Sqrt` must not get the library rule: its result,
// `1/(2·Sqrt(x))`, would be bound to the user function. The `D` stays
// unevaluated instead (`differentiateNode()`, `derivative.ts`), and it is
// differentiated when it is evaluated where `Sqrt` reads the library.
//

/** Declare and assign a user function `name` in the current scope:
 * `x ↦ x + 100`. */
function defineUser(ce: ComputeEngine, name: string): void {
  ce.declare(name, 'function');
  ce.assign(name, ce.box(['Function', ['Add', 'x', 100], 'x']));
}

describe('D of a library call in a scope that shadows its name', () => {
  test('a library Sqrt made before a user Sqrt is not differentiated with the library rule', () => {
    const ce = new ComputeEngine();
    const l = ce.box(['Sqrt', 'x']);
    ce.pushScope();
    let d;
    try {
      defineUser(ce, 'Sqrt');
      d = ce.box(['D', l, 'x']).evaluate();
    } finally {
      ce.popScope();
    }
    // With the library rule, the result was `1/(2(x + 100))`: 0.0048 at
    // x = 4. The `D` stays unevaluated and holds the library `Sqrt`; after
    // the scope ends, it evaluates to the library derivative, 0.25 at x = 4.
    expect(d.operator).toBe('D');
    expect(d.evaluate().subs({ x: 4 }).N().re).toBeCloseTo(0.25, 10);
  });

  test('a library Sqrt differentiated outside any shadowing scope uses the library rule', () => {
    const ce = new ComputeEngine();
    const d = ce.box(['D', ['Sqrt', 'x'], 'x']).evaluate();
    expect(d.json).toEqual(['Divide', 1, ['Multiply', 2, ['Sqrt', 'x']]]);
  });

  test('a user Sqrt made in a popped scope is not differentiated with the library rule', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    let u;
    try {
      defineUser(ce, 'Sqrt');
      u = ce.box(['Sqrt', 'x']);
    } finally {
      ce.popScope();
    }
    // d/dx (x + 100) = 1, not 1/(2√x)
    expect(ce.box(['D', u, 'x']).evaluate().json).toEqual(1);
  });
});

describe('D of a constant library call in a scope that shadows its name', () => {
  test('the derivative of a library Sin(2) is 0 there', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['Multiply', 'x', ['Sin', 2]]);
    ce.pushScope();
    let d;
    try {
      defineUser(ce, 'Sin');
      d = ce.box(['D', e, 'x']).evaluate();
    } finally {
      ce.popScope();
    }
    // `Sin(2)` does not depend on `x`, so its derivative is 0 for any
    // definition, and no unevaluated `D(Sin(2), x)` is left in the result.
    expect(d.has('D')).toBe(false);
    expect(d.N().re).toBeCloseTo(Math.sin(2), 10);
  });
});

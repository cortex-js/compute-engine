import { ComputeEngine } from '../../src/compute-engine';

// CE-625: an algorithm that holds its expression operand (`Limit`, `Expand`,
// `Integrate`) inlines a call of a user function by substitution in the body
// of its function literal (`betaReduceLambda()`, `boxed-expression/utils.ts`).
// The substitution replaces a symbol operand, never the operator name of a
// call. With `h := (p, a) ↦ p(a)`, the call `h(g, x)` was inlined to `p(x)`,
// so `lim_{x→2} h(g, x)` was `p(2)`, not `g(2)`. The inlining now declines
// when the body calls a parameter: the call stays as written, and the
// algorithm evaluates it.

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.assign('g', ce.expr(['Function', ['Power', 't', 2], 't']));
  return ce;
}

describe('CE-625: a function that calls its parameter is not inlined', () => {
  test('the limit of a call that passes a function (the witness)', () => {
    const ce = engine();
    ce.assign('h', ce.expr(['Function', ['p', 'a'], 'p', 'a']));
    const e = ce.expr(['Limit', ['Function', ['h', 'g', 'x'], 'x'], 2]);
    expect(e.evaluate().json).toEqual(4);
    expect(e.N().re).toBe(4);
    expect(ce.expr(['h', 'g', 3]).evaluate().json).toEqual(9);
  });

  test('a call of the parameter below another operator', () => {
    const ce = engine();
    ce.assign('h', ce.expr(['Function', ['Add', ['p', 'a'], 1], 'p', 'a']));
    const e = ce.parse('\\lim_{x\\to 2} h(g, x)');
    expect(e.evaluate().json).toEqual(5);
  });

  test('a function held as a value (declared, then assigned)', () => {
    const ce = engine();
    ce.declare('h', 'function');
    ce.assign('h', ce.expr(['Function', ['p', 'a'], 'p', 'a']));
    expect(
      ce.expr(['Limit', ['Function', ['h', 'g', 'x'], 'x'], 2]).evaluate().json
    ).toEqual(4);
    // A function literal as the argument.
    expect(
      ce
        .expr([
          'Limit',
          ['Function', ['h', ['Function', ['Sin', 's'], 's'], 'x'], 'x'],
          0,
        ])
        .evaluate().json
    ).toEqual(0);
    // A library function as the argument. Before the fix, the inlined
    // `p(x)/x` had no limit and `N()` gave NaN.
    expect(
      ce
        .expr([
          'Limit',
          ['Function', ['Divide', ['h', 'Sin', 'x'], 'x'], 'x'],
          0,
        ])
        .evaluate().json
    ).toEqual(1);
  });

  test('an argument with the same name as the parameter', () => {
    // The inlined call `p(x)` kept its binding to the parameter `p`, not to
    // the outer function `p`, and the limit was `p(2)`.
    const ce = new ComputeEngine();
    ce.assign('p', ce.expr(['Function', ['Power', 't', 2], 't']));
    ce.assign('h', ce.expr(['Function', ['p', 'a'], 'p', 'a']));
    expect(
      ce.expr(['Limit', ['Function', ['h', 'p', 'x'], 'x'], 2]).evaluate().json
    ).toEqual(4);
  });

  test('Expand keeps the call, and does not give p(x)', () => {
    const ce = engine();
    ce.assign('h', ce.expr(['Function', ['Add', ['p', 'a'], 1], 'p', 'a']));
    expect(ce.expr(['Expand', ['h', 'g', 'x']]).evaluate().json).toEqual([
      'h',
      'g',
      'x',
    ]);
  });

  test('a function that does not call a parameter is still inlined', () => {
    const ce = engine();
    ce.assign('q', ce.expr(['Function', ['Power', ['Add', 't', 1], 2], 't']));
    expect(ce.expr(['Expand', ['q', 'x']]).evaluate().json).toEqual([
      'Add',
      ['Power', 'x', 2],
      ['Multiply', 2, 'x'],
      1,
    ]);
  });
});

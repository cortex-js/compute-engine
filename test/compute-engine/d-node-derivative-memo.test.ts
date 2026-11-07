/**
 * The evaluate handler of `D` records the closed form of the derivative of a
 * node, with the dependencies of the node, and a later evaluation of the
 * same node uses the record while nothing it depends on changed.
 *
 * `D` is a lazy operator, so the memo of inert evaluations leaves it out.
 * Before the record, each evaluation of the same `D(PointY(h(u)), u)` node of
 * a path of 29 pieces differentiated again: about 0.1 s each time on an idle
 * machine, 0.5 s on a loaded one.
 *
 * The record has the stamps of the record of a decline
 * (`test/compute-engine/tycho-row-424-derivative-no-closed-form-cache.test.ts`):
 * the binding and write version of each symbol that the node reads, through
 * the bodies of the functions it calls, the `world` version, the
 * fact-suppression side, and the definition and type of each differentiation
 * variable. The recorded closed form is the value before the re-binding to
 * the scope of the evaluation, so a call that binds a differentiation
 * variable puts its own value in it (`withDerivativeMemo`,
 * `src/compute-engine/library/calculus.ts`).
 */

import { ComputeEngine } from '../../src/compute-engine';
import * as DerivativeModule from '../../src/compute-engine/symbolic/derivative';

/** The number of calls of `differentiate()` from outside its own module
 * while `run` runs. The recursive calls inside the differentiator are not
 * counted. */
function attempts(run: () => void): number {
  const spy = jest.spyOn(DerivativeModule, 'differentiate');
  try {
    run();
    return spy.mock.calls.length;
  } finally {
    spy.mockRestore();
  }
}

/** A path of `n` linear pieces, each read from a list of points `P` at
 * `⌈t⌉`. */
function pathEngine(n: number): ComputeEngine {
  const ce = new ComputeEngine();
  const points = Array.from({ length: 5 + n }, (_, i) => [
    'Tuple',
    i,
    (i * 7) % 5,
  ]);
  ce.declare('P', 'list');
  ce.assign('P', ce.box(['List', ...points]));
  const pieces = Array.from(
    { length: n },
    (_, k) =>
      `(1-\\operatorname{mod}(t,1))P[\\lceil t\\rceil+${k}]+\\operatorname{mod}(t,1)P[\\lceil t\\rceil+${k + 1}]`
  );
  ce.declare('h', 'function');
  ce.assign(
    'h',
    ce.parse(`t\\mapsto\\operatorname{join}(${pieces.join(',')})`)
  );
  return ce;
}

describe('the closed form of a D node is worked out once', () => {
  test('the derivative of a path of 29 pieces, evaluated again', () => {
    const ce = pathEngine(29);
    const d = ce.box(['D', ['PointY', ['h', 'u']], 'u']);
    let first = d;
    expect(attempts(() => (first = d.evaluate()))).toBe(1);
    expect(first.operator).toBe('List');
    expect(first.nops).toBe(29);
    let again = d;
    expect(
      attempts(() => {
        for (let i = 0; i < 3; i++) again = d.evaluate();
      })
    ).toBe(0);
    expect(again.isSame(first)).toBe(true);
  });

  test('evaluate() and N() have a record each', () => {
    const ce = new ComputeEngine();
    const d = ce.box(['D', ['Sin', 'x'], 'x']);
    expect(attempts(() => d.evaluate())).toBe(1);
    expect(attempts(() => d.N())).toBe(1);
    expect(attempts(() => d.evaluate())).toBe(0);
    expect(attempts(() => d.N())).toBe(0);
    expect(d.evaluate().json).toEqual(['Cos', 'x']);
  });

  test('a call of the evaluate handler with no expression differentiates', () => {
    // A host can call a handler outside the evaluation driver, with no
    // `expression` option. There is then no node to key a record on.
    const ce = new ComputeEngine();
    const def = ce.lookupDefinition('D');
    const evaluate =
      def !== undefined && 'operator' in def
        ? def.operator.evaluate
        : undefined;
    expect(typeof evaluate).toBe('function');
    const ops = [ce.box(['Sin', 'x']), ce.symbol('x')];
    const value = (evaluate as (...a: unknown[]) => unknown)(ops, {
      engine: ce,
    }) as ReturnType<typeof ce.box> | undefined;
    expect(value?.json).toEqual(['Cos', 'x']);
  });

  test('a variable with a value: the record keeps the variable', () => {
    // The variable is bound by the node: `x := 5` does not go into `2x`.
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    const d = ce.box(['D', ['Power', 'x', 2], 'x']);
    expect(d.evaluate().json).toEqual(['Multiply', 2, 'x']);
    let again = d;
    expect(attempts(() => (again = d.evaluate()))).toBe(0);
    expect(again.json).toEqual(['Multiply', 2, 'x']);
  });
});

describe('a change that the closed form depends on', () => {
  test('a value write to a free symbol gives the new closed form', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    ce.assign('a', 2);
    const d = ce.box(['D', ['Multiply', 'a', ['Power', 'u', 2]], 'u']);
    expect(d.evaluate().json).toEqual(['Multiply', 4, 'u']);
    ce.assign('a', 3);
    let value = d;
    expect(attempts(() => (value = d.evaluate()))).toBe(1);
    expect(value.json).toEqual(['Multiply', 6, 'u']);
    expect(attempts(() => d.evaluate())).toBe(0);
  });

  test('a new definition of the function that the node calls', () => {
    const ce = new ComputeEngine();
    ce.declare('w', 'function');
    ce.assign('w', ce.parse('t\\mapsto t^3'));
    const d = ce.box(['D', ['w', 'u'], 'u']);
    expect(d.evaluate().json).toEqual(['Multiply', 3, ['Power', 'u', 2]]);
    ce.assign('w', ce.parse('t\\mapsto t^2'));
    let value = d;
    expect(attempts(() => (value = d.evaluate()))).toBe(1);
    expect(value.json).toEqual(['Multiply', 2, 'u']);
  });

  test('a derivative from the derivative key of an operator is not recorded', () => {
    // The partial of `F` is the literal `t ↦ a`, and the dependencies of
    // the node do not record the free symbol `a` of that literal. A handler
    // is host code that can read any state.
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    ce.assign('a', 2);
    ce.declare('F', {
      signature: '(real) -> real',
      evaluate: () => undefined,
      derivative: [ce.box(['Function', 'a', 't'])],
    });
    const d = ce.box(['D', ['F', 'x'], 'x']);
    expect(d.evaluate().json).toBe(2);
    ce.assign('a', 3);
    expect(d.evaluate().json).toBe(3);

    let k = 2;
    ce.declare('H', {
      signature: '(real) -> real',
      evaluate: () => undefined,
      derivative: (_args, { engine }) => engine.number(k),
    });
    const dh = ce.box(['D', ['H', 'x'], 'x']);
    expect(dh.evaluate().json).toBe(2);
    k = 5;
    expect(dh.evaluate().json).toBe(5);
  });

  test('the derivative key of a library operator is recorded', () => {
    // `Arctan2` is the library operator with a `derivative` key. It reads
    // only its arguments and the configuration of the engine.
    const ce = new ComputeEngine();
    const d = ce.box(['D', ['Arctan2', ['Power', 'u', 2], 1], 'u']);
    let first = d;
    expect(attempts(() => (first = d.evaluate()))).toBe(1);
    expect(first.operator).not.toBe('D');
    let again = d;
    expect(attempts(() => (again = d.evaluate()))).toBe(0);
    expect(again.isSame(first)).toBe(true);
  });

  test('an assumption: the derivative is worked out again', () => {
    const ce = new ComputeEngine();
    const d = ce.box(['D', ['Abs', 'x'], 'x']);
    d.evaluate();
    ce.assume(ce.parse('y > 0'));
    expect(attempts(() => d.evaluate())).toBe(1);
  });

  test('a type written onto the differentiation variable', () => {
    // `D(|x|, x)` is `sgn(x)` for a real `x` and has no closed form for an
    // `x` typed as a tuple.
    const ce = new ComputeEngine();
    const d = ce.box(['D', ['Abs', 'x'], 'x']);
    const x = d.ops![1];
    x.valueDefinition!.type = ce.type('real');
    expect(d.evaluate().json).toEqual(['Sign', 'x']);
    expect(attempts(() => d.evaluate())).toBe(0);
    x.valueDefinition!.type = ce.type('tuple<real, real>');
    let value = d;
    expect(attempts(() => (value = d.evaluate()))).toBe(1);
    expect(value.toString()).toBe('D(|x|, x)');
  });
});

describe('a D node in the body of a function', () => {
  test('a parameter that is the differentiation variable: each call puts its value in the record', () => {
    // In `x ↦ D(x², x)`, the record holds `2x`, and the re-binding of each
    // evaluation puts the argument of the call in it.
    const ce = new ComputeEngine();
    ce.declare('g', 'function');
    ce.assign('g', ce.box(['Function', ['D', ['Power', 'x', 2], 'x'], 'x']));
    expect(ce.box(['g', 3]).evaluate().json).toBe(6);
    let value = ce.box(0);
    expect(attempts(() => (value = ce.box(['g', 4]).evaluate()))).toBe(0);
    expect(value.json).toBe(8);
    expect(ce.box(['g', ['Add', 'x', 1]]).evaluate().json).toEqual([
      'Multiply',
      2,
      ['Add', 'x', 1],
    ]);
    expect(ce.box(['g', 'y']).evaluate().json).toEqual(['Multiply', 2, 'y']);
    expect(ce.box(['g', 3]).evaluate().json).toBe(6);
  });

  test('an operand that reads a parameter answers per call', () => {
    // Each call binds `t` to a new activation, so the record of one call is
    // not used in the next one.
    const ce = new ComputeEngine();
    ce.declare('S', 'function');
    ce.assign(
      'S',
      ce.box([
        'Function',
        ['D', ['Multiply', ['Sign', 't'], ['Power', 'u', 3]], 'u'],
        't',
      ])
    );
    for (const [t, c] of [
      [2, 3],
      [-3, -3],
      [5, 3],
      [-1, -3],
    ])
      expect(ce.box(['S', t]).evaluate().json).toEqual([
        'Multiply',
        c,
        ['Power', 'u', 2],
      ]);
  });

  test('a parameter that holds a function answers per call', () => {
    const ce = new ComputeEngine();
    ce.declare('v1', 'function');
    ce.assign('v1', ce.parse('t\\mapsto t^3'));
    ce.declare('v2', 'function');
    ce.assign('v2', ce.parse('t\\mapsto t^2'));
    ce.declare('G', 'function');
    ce.assign('G', ce.box(['Function', ['D', ['Apply', 'f', 'u'], 'u'], 'f']));
    const cube = ['Multiply', 3, ['Power', 'u', 2]];
    expect(ce.box(['G', 'v1']).evaluate().json).toEqual(cube);
    expect(ce.box(['G', 'v2']).evaluate().json).toEqual(['Multiply', 2, 'u']);
    expect(ce.box(['G', 'v1']).evaluate().json).toEqual(cube);
  });
});

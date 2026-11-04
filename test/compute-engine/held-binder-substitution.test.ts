/**
 * The substitution of the parameter values into the result of a call
 * (`bindingKeyedSubs`, `function-utils.ts`) must not replace the index of a
 * held (not canonical) binder that binds the same name as a parameter. A
 * held `Sum`, `Product`, `Comprehension` or `Integrate` has no scope, so it
 * binds the indexes of its clauses by its syntax (`heldBoundNames`). The
 * index shadows the parameter in the operands where it is in scope: the
 * body, its own clause and the later clauses. The bounds of a `Limits`
 * clause and the collection of an `Element` clause are outside the scope of
 * the clause's own index, and an earlier clause is outside the scope of a
 * later clause's index: there, the name denotes the parameter.
 *
 * Before, the index was replaced: `(k ↦ Hold(Sum(k·y, Limits(k, 1, 3))))`
 * applied to `5` gave `Hold(Sum(5·y, Limits(5, 1, 3)))`.
 */
import { ComputeEngine } from '../../src/compute-engine';

const apply = (ce: ComputeEngine, body: unknown, param: string, arg: unknown) =>
  ce.box(['Apply', ['Function', ['Hold', body], param], arg] as any).evaluate();

const released = (ce: ComputeEngine, held: unknown) =>
  ce.box(['ReleaseHold', held] as any).evaluate().json;

describe('HELD BINDER: THE INDEX SHADOWS A PARAMETER OF THE SAME NAME', () => {
  test('Sum: the index is not replaced', () => {
    const ce = new ComputeEngine();
    const r = apply(
      ce,
      ['Sum', ['Multiply', 'k', 'y'], ['Limits', 'k', 1, 3]],
      'k',
      5
    );
    expect(r.json).toEqual([
      'Hold',
      ['Sum', ['Multiply', 'k', 'y'], ['Limits', 'k', 1, 3]],
    ]);
    expect(released(ce, r.json)).toEqual(['Multiply', 6, 'y']);
  });

  test('Sum: a bound of the clause reads the parameter', () => {
    const ce = new ComputeEngine();
    const r = apply(
      ce,
      ['Sum', ['Multiply', 'j', 'y'], ['Limits', 'j', 1, 'k']],
      'k',
      5
    );
    expect(r.json).toEqual([
      'Hold',
      ['Sum', ['Multiply', 'j', 'y'], ['Limits', 'j', 1, 5]],
    ]);
    expect(released(ce, r.json)).toEqual(['Multiply', 15, 'y']);
  });

  test('Sum: an earlier clause is outside the scope of a later index', () => {
    const ce = new ComputeEngine();
    // The bound `j` of the first clause reads the parameter, the `j` of
    // the body and of the second clause is the index of the second clause.
    const r = apply(
      ce,
      [
        'Sum',
        ['Multiply', 'i', 'j'],
        ['Limits', 'i', 1, 'j'],
        ['Limits', 'j', 1, 3],
      ],
      'j',
      5
    );
    expect(r.json).toEqual([
      'Hold',
      [
        'Sum',
        ['Multiply', 'i', 'j'],
        ['Limits', 'i', 1, 5],
        ['Limits', 'j', 1, 3],
      ],
    ]);
    // (1 + … + 5) · (1 + 2 + 3)
    expect(released(ce, r.json)).toEqual(90);
  });

  test('Product: the index is not replaced, the bound is', () => {
    const ce = new ComputeEngine();
    const own = apply(
      ce,
      ['Product', ['Multiply', 'k', 'y'], ['Limits', 'k', 1, 3]],
      'k',
      5
    );
    expect(own.json).toEqual([
      'Hold',
      ['Product', ['Multiply', 'k', 'y'], ['Limits', 'k', 1, 3]],
    ]);
    expect(released(ce, own.json)).toEqual([
      'Multiply',
      6,
      ['Power', 'y', 3],
    ]);
    const bound = apply(
      ce,
      ['Product', ['Multiply', 'j', 'y'], ['Limits', 'j', 1, 'k']],
      'k',
      5
    );
    expect(bound.json).toEqual([
      'Hold',
      ['Product', ['Multiply', 'j', 'y'], ['Limits', 'j', 1, 5]],
    ]);
  });

  test('Comprehension: the index is not replaced, the collection is', () => {
    const ce = new ComputeEngine();
    const own = apply(
      ce,
      ['Comprehension', ['Multiply', 'k', 'y'], ['Element', 'k', ['List', 1, 2]]],
      'k',
      5
    );
    expect(own.json).toEqual([
      'Hold',
      [
        'Comprehension',
        ['Multiply', 'k', 'y'],
        ['Element', 'k', ['List', 1, 2]],
      ],
    ]);
    const collection = apply(
      ce,
      [
        'Comprehension',
        ['Multiply', 'j', 'y'],
        ['Element', 'j', ['List', 1, 'k']],
      ],
      'k',
      5
    );
    expect(collection.json).toEqual([
      'Hold',
      [
        'Comprehension',
        ['Multiply', 'j', 'y'],
        ['Element', 'j', ['List', 1, 5]],
      ],
    ]);
  });

  test('Integrate with a definite Limits clause', () => {
    const ce = new ComputeEngine();
    const own = apply(
      ce,
      ['Integrate', ['Multiply', 'k', 'y'], ['Limits', 'k', 0, 1]],
      'k',
      5
    );
    expect(own.json).toEqual([
      'Hold',
      ['Integrate', ['Multiply', 'k', 'y'], ['Limits', 'k', 0, 1]],
    ]);
    expect(released(ce, own.json)).toEqual([
      'Multiply',
      ['Rational', 1, 2],
      'y',
    ]);
    const bound = apply(
      ce,
      ['Integrate', ['Multiply', 'j', 'y'], ['Limits', 'j', 0, 'k']],
      'k',
      5
    );
    expect(bound.json).toEqual([
      'Hold',
      ['Integrate', ['Multiply', 'j', 'y'], ['Limits', 'j', 0, 5]],
    ]);
  });

  test('a value that mentions the index renames the held index', () => {
    const ce = new ComputeEngine();
    const r = apply(
      ce,
      ['Sum', ['Multiply', 'y', 'k'], ['Limits', 'k', 1, 3]],
      'y',
      'k'
    );
    expect(released(ce, r.json)).toEqual(['Multiply', 6, 'k']);
  });

  test('nested Sum: an inner bound reads the outer index', () => {
    const ce = new ComputeEngine();
    const r = apply(
      ce,
      [
        'Sum',
        ['Sum', ['Multiply', 'k', 'j'], ['Limits', 'j', 1, 'k']],
        ['Limits', 'k', 1, 3],
      ],
      'k',
      5
    );
    expect(r.json).toEqual([
      'Hold',
      [
        'Sum',
        ['Sum', ['Multiply', 'k', 'j'], ['Limits', 'j', 1, 'k']],
        ['Limits', 'k', 1, 3],
      ],
    ]);
    // Σ_{k=1}^{3} k·k(k+1)/2 = 1 + 6 + 18
    expect(released(ce, r.json)).toEqual(25);
  });

  test('nested Sum: the inner index shadows, the outer bound reads the parameter', () => {
    const ce = new ComputeEngine();
    const r = apply(
      ce,
      [
        'Sum',
        ['Sum', ['Multiply', 'k', 'j'], ['Limits', 'k', 1, 2]],
        ['Limits', 'j', 1, 'k'],
      ],
      'k',
      5
    );
    expect(r.json).toEqual([
      'Hold',
      [
        'Sum',
        ['Sum', ['Multiply', 'k', 'j'], ['Limits', 'k', 1, 2]],
        ['Limits', 'j', 1, 5],
      ],
    ]);
    // Σ_{j=1}^{5} 3j
    expect(released(ce, r.json)).toEqual(45);
  });

  test('a held Block whose Declare local has the name of a Sum index', () => {
    const ce = new ComputeEngine();
    const body = [
      'Block',
      ['Declare', 'k', 'integer', 2],
      ['Add', 'k', ['Sum', 'k', ['Limits', 'k', 1, 'k']]],
    ];
    const r = apply(ce, body, 'k', 5);
    expect(r.json).toEqual(['Hold', body]);
    // The local k is 2: 2 + (1 + 2)
    expect(released(ce, r.json)).toEqual(5);
  });

  test('the name is free outside the held Sum', () => {
    const ce = new ComputeEngine();
    const r = apply(
      ce,
      ['Add', 'k', ['Sum', 'k', ['Limits', 'k', 1, 3]]],
      'k',
      5
    );
    expect(r.json).toEqual([
      'Hold',
      ['Add', 5, ['Sum', 'k', ['Limits', 'k', 1, 3]]],
    ]);
    expect(released(ce, r.json)).toEqual(11);
  });

  test('an Element clause: the index shadows, the collection reads the parameter', () => {
    const ce = new ComputeEngine();
    const r = apply(
      ce,
      ['Sum', ['Multiply', 'k', 'y'], ['Element', 'k', ['Range', 1, 'k']]],
      'k',
      3
    );
    expect(r.json).toEqual([
      'Hold',
      ['Sum', ['Multiply', 'k', 'y'], ['Element', 'k', ['Range', 1, 3]]],
    ]);
    expect(released(ce, r.json)).toEqual(['Multiply', 6, 'y']);
  });
});

/**
 * The variable of a `D`, the expansion variable of a `Series` and the
 * variable of an indefinite `Integrate` are free: the value of the node is a
 * function of them (`pointVariableNames()`, `binding-sites.ts`). In a held
 * node, a parameter with the name of such a variable cannot be replaced
 * inside the node (`D(k^2, k)` with `k` replaced by `3` is `D(9, 3)`), and
 * a rename would change the value. So the application declines: it stays
 * unevaluated.
 */
describe('HELD D, SERIES, INDEFINITE INTEGRATE: THE VARIABLE IS FREE', () => {
  test('D: the parameter is the variable', () => {
    const ce = new ComputeEngine();
    const r = apply(ce, ['D', ['Power', 'k', 2], 'k'], 'k', 3);
    expect(r.operator).toBe('Apply');
  });

  test('Series: the parameter is the expansion variable', () => {
    const ce = new ComputeEngine();
    const r = apply(ce, ['Series', ['Sin', 'k'], 'k', 0, 3], 'k', 1);
    expect(r.operator).toBe('Apply');
  });

  test('indefinite Integrate: the parameter is the variable', () => {
    const ce = new ComputeEngine();
    const r = apply(ce, ['Integrate', ['Power', 'k', 2], 'k'], 'k', 2);
    expect(r.operator).toBe('Apply');
  });

  test('D: a parameter in the function only is replaced', () => {
    const ce = new ComputeEngine();
    const r = apply(ce, ['D', ['Multiply', 'k', 'y'], 'y'], 'k', 5);
    expect(r.json).toEqual(['Hold', ['D', ['Multiply', 5, 'y'], 'y']]);
    expect(released(ce, r.json)).toEqual(5);
  });

  test('D: a value that holds the variable is not captured', () => {
    const ce = new ComputeEngine();
    // `D(y·y, y)` is `2y`, not the value `y` of the derivative at `k = y`.
    const r = apply(ce, ['D', ['Multiply', 'k', 'y'], 'y'], 'k', 'y');
    expect(r.operator).toBe('Apply');
  });

  // Each spelling of a clause with no bounds that `Integrate` accepts makes
  // an indefinite integral, whose variable is free.
  test.each([
    ['Single', ['Single', 'k']],
    ['Tuple', ['Tuple', 'k']],
    ['Tuple with a held variable', ['Tuple', ['Hold', 'k']]],
    ['Hold', ['Hold', 'k']],
  ])('indefinite Integrate, %s clause: declines', (_, clause) => {
    const ce = new ComputeEngine();
    const r = apply(ce, ['Integrate', 'k', clause], 'k', 5);
    expect(r.operator).toBe('Apply');
  });

  test('definite Integrate, flat bounds: the index shadows the parameter', () => {
    const ce = new ComputeEngine();
    const r = apply(ce, ['Integrate', 'k', 'k', 0, 1], 'k', 5);
    expect(r.json).toEqual(['Hold', ['Integrate', 'k', 'k', 0, 1]]);
    expect(released(ce, r.json)).toEqual(['Rational', 1, 2]);
  });

  test('D: a held variable is the variable', () => {
    const ce = new ComputeEngine();
    const r = apply(ce, ['D', ['Power', 'k', 2], ['Hold', 'k']], 'k', 3);
    expect(r.operator).toBe('Apply');
  });

  // The symbol of a higher-order specification `Set(k, n)` is a variable of
  // the `D`: a replacement of it gave `D(5^3, Set(5, 2))`, an invalid node.
  test.each([
    ['order 2', 2],
    ['order 0', 0],
  ])('D: the parameter is the variable of a Set, %s', (_, order) => {
    const ce = new ComputeEngine();
    const r = apply(ce, ['D', ['Power', 'k', 3], ['Set', 'k', order]], 'k', 5);
    expect(r.operator).toBe('Apply');
  });

  test('D: a parameter in the function only, with a Set, is replaced', () => {
    const ce = new ComputeEngine();
    const r = apply(
      ce,
      ['D', ['Multiply', 'k', ['Power', 'y', 3]], ['Set', 'y', 2]],
      'k',
      5
    );
    expect(r.json).toEqual([
      'Hold',
      ['D', ['Multiply', 5, ['Power', 'y', 3]], ['Set', 'y', 2]],
    ]);
    expect(released(ce, r.json)).toEqual(['Multiply', 30, 'y']);
  });

  // A replacement of the variable by the same symbol changes nothing.
  test('D: the argument is the variable itself', () => {
    const ce = new ComputeEngine();
    const r = apply(ce, ['D', ['Power', 'x', 2], 'x'], 'x', 'x');
    expect(r.json).toEqual(['Hold', ['D', ['Power', 'x', 2], 'x']]);
    expect(released(ce, r.json)).toEqual(['Multiply', 2, 'x']);
  });

  test('Series: the argument is the expansion variable itself', () => {
    const ce = new ComputeEngine();
    const r = apply(ce, ['Series', ['Sin', 'x'], 'x', 0, 3], 'x', 'x');
    expect(r.json).toEqual(['Hold', ['Series', ['Sin', 'x'], 'x', 0, 3]]);
    expect(released(ce, r.json)).toEqual([
      'Add',
      ['Multiply', ['Rational', -1, 6], ['Power', 'x', 3]],
      'x',
      ['BigO', ['Power', 'x', 5]],
    ]);
  });
});

describe('HELD D AND SERIES INSIDE OTHER NODES', () => {
  test('D under a held Sum whose index has its name: the index shadows', () => {
    const ce = new ComputeEngine();
    const body = ['Sum', ['D', ['Power', 'k', 2], 'k'], ['Limits', 'k', 1, 3]];
    const r = apply(ce, body, 'k', 3);
    expect(r.json).toEqual(['Hold', body]);
    expect(released(ce, r.json)).toEqual(12);
  });

  test('D nested in a held Add: declines', () => {
    const ce = new ComputeEngine();
    const r = apply(ce, ['Add', 1, ['D', ['Power', 'k', 2], 'k']], 'k', 3);
    expect(r.operator).toBe('Apply');
  });

  test('Series: the parameter is the expansion point', () => {
    const ce = new ComputeEngine();
    const body = ['Series', ['Sin', 'x'], 'x', 'k', 3];
    const r = apply(ce, body, 'k', 0);
    expect(r.json).toEqual(['Hold', ['Series', ['Sin', 'x'], 'x', 0, 3]]);
    // The value `x` would be captured by the expansion variable.
    expect(apply(ce, body, 'k', 'x').operator).toBe('Apply');
  });

  test('a value that holds the index of a held Sum around a D renames it', () => {
    const ce = new ComputeEngine();
    const r = apply(
      ce,
      [
        'Sum',
        ['Multiply', 'y', ['D', ['Power', 'k', 2], 'k']],
        ['Limits', 'k', 1, 3],
      ],
      'y',
      'k'
    );
    expect(r.operator).toBe('Hold');
    expect(released(ce, r.json)).toEqual(['Multiply', 12, 'k']);
  });
});

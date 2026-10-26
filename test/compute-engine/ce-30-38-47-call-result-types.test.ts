/**
 * The static type of a call holds the value of the call:
 *
 * - CE-38: a mutually recursive pair that builds a list, assigned to names
 *   that are not declared, is typed `-> list<number>` in either order of
 *   assignment, also when the literals are boxed before the names have a
 *   value. A call boxed before its name had a value is typed from the
 *   definition that the name holds now, as its value is.
 * - CE-30: a polymorphic callback with a callback parameter, applied to the
 *   rows of a matrix of functions, is typed by its type variable solved
 *   against the functions of the rows.
 * - CE-47: a tuple argument at a scalar parameter of a function literal is
 *   typed `tuple<number, …>` for a body that computes the tuple component
 *   by component, and `any` for every other body; a whole read of an
 *   inferred point parameter is typed from the body.
 */
import type { Expression } from '../../src/compute-engine';
import { ComputeEngine, isString } from '../../src/compute-engine';

/** The value `v` with every element evaluated, as a list literal. A lazy
 * collection has the type of its expression, so the check reads the
 * elements instead. A string is a collection of characters, but is kept as
 * it is. */
function materialize(ce: ComputeEngine, v: Expression): Expression {
  if (!v.isCollection || v.operator === 'Tuple' || isString(v)) return v;
  return ce.function(
    'List',
    [...v.each()].map((x) => materialize(ce, x.evaluate()))
  );
}

/** The type of `expr`, after checking that its value is in that type. */
function checkedType(ce: ComputeEngine, expr: Expression): string {
  const value = materialize(ce, expr.evaluate());
  expect(value.type.matches(expr.type)).toBe(true);
  return expr.type.toString();
}

describe('CE-38: AN UNDECLARED MUTUALLY RECURSIVE PAIR THAT BUILDS A LIST', () => {
  const F = (base: string) => [
    'Function',
    [
      'Which',
      ['Equal', 'n', ['Subtract', 'K', 1]],
      [base, 'n'],
      'True',
      ['Join', [base, 'n'], ['G', ['Add', 'n', 1], 'K']],
    ],
    'n',
    'K',
  ];
  const G = ['Function', ['F', 'n', 'K'], 'n', 'K'];

  // When `G` is assigned before `F` is boxed, the body of `F` reads the
  // call of `G` as `-> unknown`, and an `unknown` operand of `Join` gives
  // elements of type `any`. The pair was typed `list<any>`, which holds the
  // values, but is not as precise as `list<number>`. A pass that starts
  // below the result (`list<never>`) now proposes `list<number>`, which the
  // bodies verify.
  test.each([
    ['F then G, each boxed before it is assigned', 'FG', false, 'list<number>'],
    ['G then F, each boxed before it is assigned', 'GF', false, 'list<number>'],
    ['F then G, both boxed first', 'FG', true, 'list<number>'],
    ['G then F, both boxed first', 'GF', true, 'list<number>'],
  ])('%s', (_label, order, boxFirst, result) => {
    const ce = new ComputeEngine();
    const literals: Record<string, Expression> = {};
    const literal = (name: string) =>
      (literals[name] ??= ce.box((name === 'F' ? F('List') : G) as any));
    if (boxFirst) for (const name of order) literal(name);
    for (const name of order) ce.assign(name, literal(name));
    expect(ce.box('F').type.toString()).toBe(
      `(n: unknown, K: unknown) any -> ${result}`
    );
    expect(ce.box('G').type.toString()).toBe(
      `(n: unknown, K: unknown) any -> ${result}`
    );
    const call = ce.box(['G', 0, 4]);
    expect(call.evaluate().toString()).toBe('[0,1,2,3]');
    expect(checkedType(ce, call)).toBe(result);
  });

  test('the result does not hide the elements a caller joins (G then F)', () => {
    const ce = new ComputeEngine();
    ce.assign('G', ce.box(G as any));
    ce.assign('F', ce.box(F('List') as any));
    // A result read as `list<unknown>` would make this `list<string>`.
    const joined = ce.box(['Join', ['F', 0, 4], ['List', { str: 'a' }]]);
    expect(joined.evaluate().toString()).toBe('[0,1,2,3,"a"]');
    expect(checkedType(ce, joined)).toBe('list<number | string>');
  });

  test('a function of the cycle that adds strings is in the result', () => {
    // `G` returns `["a"]` when `n > 2`, so a list of numbers does not hold
    // the value of a call: the proposal `list<number>` is refuted.
    const G2 = [
      'Function',
      ['If', ['Greater', 'n', 2], ['List', { str: 'a' }], ['F', 'n', 'K']],
      'n',
      'K',
    ];
    for (const order of ['GF', 'FG']) {
      const ce = new ComputeEngine();
      const literals = { F: ce.box(F('List') as any), G: ce.box(G2 as any) };
      for (const name of order) ce.assign(name, literals[name as 'F' | 'G']);
      const call = ce.box(['G', 0, 6]);
      expect(call.evaluate().toString()).toBe('[0,1,2,"a"]');
      expect(checkedType(ce, call)).not.toBe('list<number>');
    }
  });

  test('a set base clause gives `set` in either order', () => {
    for (const order of ['FG', 'GF']) {
      const ce = new ComputeEngine();
      const literals = {
        F: ce.box(F('Set') as any),
        G: ce.box(G as any),
      };
      for (const name of order) ce.assign(name, literals[name as 'F' | 'G']);
      expect(ce.box('G').type.toString()).toBe(
        '(n: unknown, K: unknown) any -> set'
      );
      expect(ce.box(['G', 0, 4]).evaluate().toString()).toBe('Set(0, 1, 2, 3)');
    }
  });

  test('a call boxed before its callee is assigned is typed from the callee', () => {
    const ce = new ComputeEngine();
    const g = ce.box(['Function', ['f', 'n', 'K'], 'n', 'K']);
    ce.assign('f', ce.box(['Function', ['Add', 'n', 'K'], 'n', 'K']));
    // Before the change, the call `f(n, K)` in the body of `g` read the
    // empty definition made for `f` when `g` was boxed, and was `unknown`.
    expect(g.type.toString()).toBe('(n: unknown, K: unknown) -> number');
    ce.assign('g', g);
    expect(ce.box('g').type.toString()).toBe(
      '(n: unknown, K: unknown) -> number'
    );
    expect(checkedType(ce, ce.box(['g', 1, 2]))).toBe('number');
  });
});

describe('CE-30: A POLYMORPHIC CALLBACK OVER ROWS OF FUNCTIONS', () => {
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('k', '((integer) -> T) -> T where T');
    ce.assign('k', ce.box(['Function', ['Apply', 'f', 1], 'f']));
    return ce;
  }
  const inc = ['Function', ['Add', 'x', 1], 'x'];
  const twice = ['Function', ['Multiply', 'x', 2], 'x'];
  const pair = ['Function', ['Delimiter', ['Tuple', 'x', 'x']], 'x'];

  test.each([
    ['a 1 by 1 matrix', ['List', ['List', inc]], 'matrix<1x1>', '[[2]]'],
    ['a vector', ['List', inc], 'vector<1>', '[2]'],
    [
      'a 2 by 2 matrix',
      ['List', ['List', inc, twice], ['List', twice, inc]],
      'matrix<2x2>',
      '[[2,2],[2,2]]',
    ],
    [
      'a ragged list',
      ['List', ['List', inc], ['List', inc, twice]],
      'list<list<number>>',
      '[[2],[2,2]]',
    ],
    [
      'a matrix of functions that give a tuple',
      ['List', ['List', pair]],
      'matrix<tuple<unknown, unknown>^(1x1)>',
      '[[(1, 1)]]',
    ],
  ])('Map(k, fs) over %s', (_label, fs, type, value) => {
    const ce = engine();
    ce.assign('fs', ce.box(fs as any));
    const call = ce.box(['Map', 'k', 'fs']);
    expect(materialize(ce, call.evaluate()).toString()).toBe(value);
    expect(checkedType(ce, call)).toBe(type);
  });

  test('k(fs) maps over the matrix and solves T from its functions', () => {
    const ce = engine();
    ce.assign('fs', ce.box(['List', ['List', inc]] as any));
    const call = ce.box(['k', 'fs']);
    expect(call.evaluate().toString()).toBe('[[2]]');
    // It was `matrix<unknown^(1x1)>`.
    expect(checkedType(ce, call)).toBe('matrix<1x1>');
  });
});

describe('CE-47: A TUPLE ARGUMENT AT A SCALAR PARAMETER', () => {
  const cases: Array<[string, unknown, unknown, string, string]> = [
    // A body that computes the tuple component by component.
    [
      '2x',
      ['Multiply', 2, 'x'],
      ['Tuple', 1, 2],
      'tuple<number, number>',
      '(2, 4)',
    ],
    [
      'sin(x)',
      ['Sin', 'x'],
      ['Tuple', 1, 2],
      'tuple<number, number>',
      '(sin(1), sin(2))',
    ],
    [
      'x^2',
      ['Power', 'x', 2],
      ['Tuple', 1, 2],
      'tuple<number, number>',
      '(1, 4)',
    ],
    [
      'x/2 + x',
      ['Add', ['Divide', 'x', 2], 'x'],
      ['Tuple', 1, 2, 4],
      'tuple<number, number, number>',
      '(3/2, 3, 6)',
    ],
    [
      'sqrt(x)',
      ['Sqrt', 'x'],
      ['Tuple', 1, -4],
      'tuple<number, number>',
      '(1, 2i)',
    ],
    [
      'x/0',
      ['Divide', 'x', 0],
      ['Tuple', 1, 2],
      'tuple<number, number>',
      '(~oo, ~oo)',
    ],
    // Another body: the value is a scalar, an error or a tuple of tuples.
    ['|x|', ['Abs', 'x'], ['Tuple', 3, 4], 'any', '5'],
    [
      'x + 1',
      ['Add', 'x', 1],
      ['Tuple', 1, 2],
      'any',
      'Error(ErrorCode("incompatible-type", "tuple", "number"))',
    ],
    [
      'x^(-1)',
      ['Power', 'x', -1],
      ['Tuple', 1, 2],
      'any',
      'Error(ErrorCode("no-division-by-point"))',
    ],
    [
      'x·|x|',
      ['Multiply', 'x', ['Abs', 'x']],
      ['Tuple', 3, 4],
      'any',
      '(15, 20)',
    ],
    // A tuple with a tuple component: it was typed `number`.
    [
      '2x of a nested tuple',
      ['Multiply', 2, 'x'],
      ['Tuple', ['Tuple', 1, 2], 3],
      'any',
      '((2, 4), 6)',
    ],
  ];
  test.each(cases)('h := x ↦ %s', (_label, body, arg, type, value) => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.box(['Function', body, 'x'] as any));
    const call = ce.box(['h', arg] as any);
    expect(call.evaluate().toString()).toBe(value);
    expect(checkedType(ce, call)).toBe(type);
  });

  test('a scalar second parameter', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'h',
      ce.box(['Function', ['Multiply', 's', 'x'], 'x', 's'] as any)
    );
    const call = ce.box(['h', ['Tuple', 1, 2], 3] as any);
    expect(call.evaluate().toString()).toBe('(3, 6)');
    expect(checkedType(ce, call)).toBe('tuple<number, number>');
  });

  test('Apply of a literal written in place', () => {
    const ce = new ComputeEngine();
    const call = ce.box([
      'Apply',
      ['Function', ['Multiply', 2, 'x'], 'x'],
      ['Tuple', 1, 2],
    ] as any);
    expect(call.evaluate().toString()).toBe('(2, 4)');
    expect(checkedType(ce, call)).toBe('tuple<number, number>');
  });

  test.each([
    ['(3, 2)', ['Tuple', 3, 2], '(3/2, 1)'],
    ['(3, 2, 5)', ['Tuple', 3, 2, 5], '(3/2, 1, 5/2)'],
    ['[3, 2]', ['List', 3, 2], '[3/2,1]'],
  ])(
    'a whole read of an inferred point parameter, over %s',
    (_label, arg, value) => {
      // The parameter is inferred `tuple<number>` from the index read
      // `P[1]`, and the result was typed `tuple<number>`, which does not
      // hold a pair or a list.
      const ce = new ComputeEngine();
      ce.assign(
        'c',
        ce.box([
          'Function',
          ['Divide', 'P', ['Subtract', ['At', 'P', 1], 1]],
          'P',
        ] as any)
      );
      const call = ce.box(['c', arg] as any);
      expect(call.evaluate().toString()).toBe(value);
      checkedType(ce, call);
    }
  );
});

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

// The first operand of `Solve` can be a collection only when it is written as
// a `List`, `Set` or `Tuple` of equations (or an `And` of them). A list item
// that is a plain expression `e` is read as the equation `e = 0`, as it is
// when it is the only equation. A collection of any other form (a `Range`, a
// `Linspace`, a `Map`, a symbol that holds a list) is not an equation, and
// `Solve` reports an `incompatible-type` error on it. Before, the solver read
// such a collection as an equation and returned `[]` ("no solution").

const ce = new ComputeEngine();

function solveBox(json: any): Expression {
  return ce.box(json).evaluate();
}

function solveParse(latex: string): Expression {
  return ce.parse(latex).evaluate();
}

/** The error code and its arguments, e.g. `["incompatible-type", …]`. */
function errorCode(result: Expression): unknown {
  expect(result.operator).toBe('Error');
  return (result.json as any[])[1];
}

describe('SOLVE: A COMPUTED COLLECTION IS AN INCOMPATIBLE-TYPE ERROR', () => {
  test('Range (box route)', () => {
    const r = solveBox(['Solve', ['Range', 1, 3], 'x']);
    expect(errorCode(r)).toEqual([
      'ErrorCode',
      "'incompatible-type'",
      "'boolean | number'",
      "'range'",
    ]);
    expect(r.toString()).toBe(
      `Error(ErrorCode("incompatible-type", "boolean | number", "range"), Range(1, 3))`
    );
  });

  test('Range (parse route)', () => {
    const r = solveParse(
      '\\operatorname{Solve}(\\operatorname{Range}(1,3), x)'
    );
    expect(errorCode(r)).toEqual([
      'ErrorCode',
      "'incompatible-type'",
      "'boolean | number'",
      "'range'",
    ]);
  });

  test('Linspace with the unknown omitted (box route)', () => {
    const r = solveBox(['Solve', ['Linspace', 'a', 0, 3]]);
    expect(r.toString()).toBe(
      `Error(ErrorCode("incompatible-type", "boolean | number", "list<number>"), Linspace(a, 0, 3))`
    );
  });

  test('Linspace with the unknown omitted (parse route)', () => {
    const r = solveParse(
      '\\operatorname{Solve}(\\operatorname{Linspace}(a, 0, 3))'
    );
    expect(r.toString()).toBe(
      `Error(ErrorCode("incompatible-type", "boolean | number", "list<number>"), Linspace(a, 0, 3))`
    );
  });

  test('Map over a list (box route)', () => {
    const r = solveBox([
      'Solve',
      ['Map', ['Function', ['Multiply', 't', 2], 't'], ['List', 'x', 2]],
      'x',
    ]);
    expect(r.toString()).toBe(
      `Error(ErrorCode("incompatible-type", "boolean | number", "vector<2>"), Map((t) => 2t, [x,2]))`
    );
  });

  test('Map over a list (parse route)', () => {
    const r = solveParse(
      '\\operatorname{Solve}(\\operatorname{Map}(t \\mapsto 2t, [x,2]), x)'
    );
    expect(r.toString()).toBe(
      `Error(ErrorCode("incompatible-type", "boolean | number", "vector<2>"), Map((t) => 2t, [x,2]))`
    );
  });

  test('Interval', () => {
    const r = solveBox(['Solve', ['Interval', 0, 1], 'x']);
    expect(r.toString()).toBe(
      `Error(ErrorCode("incompatible-type", "boolean | number", "set<real>"), Interval(0, 1))`
    );
  });

  test('a symbol that holds a list', () => {
    const engine = new ComputeEngine();
    engine.assign('L', engine.box(['List', ['Subtract', 'x', 1]]));
    const r = engine.box(['Solve', 'L', 'x']).evaluate();
    expect(r.toString()).toBe(
      `Error(ErrorCode("incompatible-type", "boolean | number", "vector<1>"), L)`
    );
  });

  test('an operand that contains an error keeps its error', () => {
    // `Map(collection, function)` has its operands in the wrong order.
    const r = solveBox([
      'Solve',
      ['Map', ['List', 'x', 2], ['Function', ['Multiply', 't', 2], 't']],
      'x',
    ]);
    expect(r.toString()).toBe(
      `Error(ErrorCode("incompatible-type", "function", "vector<2>"), [x,2])`
    );
  });

  test('a string is a literal: Solve stays unevaluated', () => {
    const r = solveBox(['Solve', "'abc'", 'x']);
    expect(r.toString()).toBe(`Solve("abc", x)`);
  });
});

describe('SOLVE: A LIST OF PLAIN EXPRESSIONS IS A SYSTEM OF EQUATIONS', () => {
  const expected = ['List', ['Tuple', ['Rational', 1, 2], ['Rational', 1, 2]]];

  test('several plain expressions (box route)', () => {
    const r = solveBox([
      'Solve',
      ['List', ['Subtract', ['Add', 'x', 'y'], 1], ['Subtract', 'x', 'y']],
      ['List', 'x', 'y'],
    ]);
    expect(r.json).toEqual(expected);
  });

  test('several plain expressions (parse route)', () => {
    const r = solveParse('\\operatorname{Solve}([x+y-1, x-y], [x,y])');
    expect(r.json).toEqual(expected);
  });

  test('same result as the equation form', () => {
    const r = solveBox([
      'Solve',
      [
        'List',
        ['Equal', ['Add', 'x', 'y'], 1],
        ['Equal', ['Subtract', 'x', 'y'], 0],
      ],
      ['List', 'x', 'y'],
    ]);
    expect(r.json).toEqual(expected);
    expect(
      solveParse('\\operatorname{Solve}([x+y=1, x-y=0], [x,y])').json
    ).toEqual(expected);
  });

  test('a mixed list of an equation and a plain expression (box route)', () => {
    const r = solveBox([
      'Solve',
      ['List', ['Equal', ['Add', 'x', 'y'], 1], ['Subtract', 'x', 'y']],
      ['List', 'x', 'y'],
    ]);
    expect(r.json).toEqual(expected);
  });

  test('a mixed list of an equation and a plain expression (parse route)', () => {
    const r = solveParse('\\operatorname{Solve}([x+y=1, x-y], [x,y])');
    expect(r.json).toEqual(expected);
  });

  test('a Set of plain expressions', () => {
    const r = solveBox([
      'Solve',
      ['Set', ['Subtract', ['Add', 'x', 'y'], 1], ['Subtract', 'x', 'y']],
      ['List', 'x', 'y'],
    ]);
    expect(r.json).toEqual(expected);
  });

  test('several equations in one unknown: the record of the system solver is read', () => {
    // The system solver answers `{x: 1}` for these lists. The univariate
    // branch read the record as a root list and threw "roots is not
    // iterable".
    expect(
      solveBox([
        'Solve',
        ['List', ['Equal', 'x', 1], ['Equal', ['Multiply', 2, 'x'], 2]],
        'x',
      ]).json
    ).toEqual(['List', 1]);
    expect(
      solveBox([
        'Solve',
        ['List', ['Subtract', 'x', 1], ['Subtract', ['Multiply', 2, 'x'], 2]],
        'x',
      ]).json
    ).toEqual(['List', 1]);
  });

  test('one plain expression in two unknowns is parametric, as `x + y = 5`', () => {
    const plain = solveBox([
      'Solve',
      ['List', ['Subtract', ['Add', 'x', 'y'], 5]],
      ['List', 'x', 'y'],
    ]);
    const equation = solveBox([
      'Solve',
      ['List', ['Equal', ['Add', 'x', 'y'], 5]],
      ['List', 'x', 'y'],
    ]);
    expect(plain.json).toEqual(equation.json);
    expect(plain.toString()).toBe(`[(5 - y, y)]`);
  });
});

describe('SOLVE: UNCHANGED FORMS', () => {
  test('a one-element list of a plain expression', () => {
    expect(
      solveBox(['Solve', ['List', ['Subtract', 'x', 1]], 'x']).json
    ).toEqual(['List', 1]);
    expect(solveParse('\\operatorname{Solve}([x-1], x)').json).toEqual([
      'List',
      1,
    ]);
  });

  test('a plain expression', () => {
    expect(solveBox(['Solve', ['Subtract', 'x', 2], 'x']).json).toEqual([
      'List',
      2,
    ]);
    expect(solveParse('\\operatorname{Solve}(x-2, x)').json).toEqual([
      'List',
      2,
    ]);
  });

  test('a one-element list of an equation', () => {
    expect(solveBox(['Solve', ['List', ['Equal', 'x', 1]], 'x']).json).toEqual([
      'List',
      1,
    ]);
  });

  test('a Set of one equation', () => {
    expect(solveBox(['Solve', ['Set', ['Equal', 'x', 1]], 'x']).json).toEqual([
      'List',
      1,
    ]);
  });
});

describe('SOLVE: SEVERAL EQUATIONS IN ONE UNKNOWN', () => {
  // The answer is the set of roots common to all the equations: the roots of
  // one equation, each checked against the other equations. Before, a list
  // that the linear system solver could not handle gave `[]`.
  test('[x = 1, x^2 = 1] → [1] (box route)', () => {
    expect(
      solveBox([
        'Solve',
        ['List', ['Equal', 'x', 1], ['Equal', ['Power', 'x', 2], 1]],
        'x',
      ]).json
    ).toEqual(['List', 1]);
  });

  test('[x = 1, x^2 = 1] → [1] (parse route)', () => {
    expect(solveParse('\\operatorname{Solve}([x=1, x^2=1], x)').json).toEqual([
      'List',
      1,
    ]);
  });

  test('[x^2 = 1, x^2 = 1] → both roots', () => {
    const r = solveBox([
      'Solve',
      [
        'List',
        ['Equal', ['Power', 'x', 2], 1],
        ['Equal', ['Power', 'x', 2], 1],
      ],
      'x',
    ]);
    expect(r.operator).toBe('List');
    expect(r.ops!.map((op) => op.json).sort()).toEqual([-1, 1]);
  });

  test('the plain-expression spelling gives the same answers', () => {
    expect(
      solveBox([
        'Solve',
        ['List', ['Subtract', 'x', 1], ['Subtract', ['Power', 'x', 2], 1]],
        'x',
      ]).json
    ).toEqual(['List', 1]);
    expect(solveParse('\\operatorname{Solve}([x-1, x^2-1], x)').json).toEqual([
      'List',
      1,
    ]);
    const r = solveParse('\\operatorname{Solve}([x^2-1, x^2-1], x)');
    expect(r.operator).toBe('List');
    expect(r.ops!.map((op) => op.json).sort()).toEqual([-1, 1]);
  });

  test('inconsistent equations decide []', () => {
    expect(
      solveBox(['Solve', ['List', ['Equal', 'x', 1], ['Equal', 'x', 2]], 'x'])
        .json
    ).toEqual(['List']);
  });

  test('a polynomial equation gives the candidates before a periodic one', () => {
    // `sin(x) = 0` alone gives the principal roots `[0, π]`; `x² = π²` gives
    // both `π` and `-π`, and both satisfy `sin(x) = 0`.
    const r = solveBox([
      'Solve',
      [
        'List',
        ['Equal', ['Sin', 'x'], 0],
        ['Equal', ['Power', 'x', 2], ['Power', 'Pi', 2]],
      ],
      'x',
    ]);
    expect(r.toString()).toBe('[pi,-pi]');
    expect(
      solveBox([
        'Solve',
        ['List', ['Equal', ['Sin', 'x'], 0], ['Equal', 'x', 0]],
        'x',
      ]).json
    ).toEqual(['List', 0]);
  });

  test('periodic equations: the answer does not depend on the order', () => {
    // `π` solves both equations, but it is not a principal root of
    // `sin(2x) = 0`. Before, this order gave `[]` and the other order gave
    // `[pi, -pi]`.
    const sin2x = ['Equal', ['Sin', ['Multiply', 2, 'x']], 0];
    const cosx = ['Equal', ['Cos', 'x'], -1];
    const a = solveBox(['Solve', ['List', sin2x, cosx], 'x']);
    const b = solveBox(['Solve', ['List', cosx, sin2x], 'x']);
    expect(a.operator).toBe('List');
    expect(a.ops!.map((op) => op.toString()).sort()).toEqual(['-pi', 'pi']);
    expect(b.ops!.map((op) => op.toString()).sort()).toEqual(['-pi', 'pi']);
  });

  test('periodic equations: a common root of a scaled argument', () => {
    // `2π` and `-2π` solve `sin(x) = 0` and `cos(x/4) = 0`, but they are not
    // principal roots of `sin(x) = 0`. They are the principal roots of
    // `cos(x/4) = 0` (period 8π), and the common roots are `2π + 4kπ`.
    // Before, the answer was `[]`, then `[2pi]`.
    const sinx = ['Equal', ['Sin', 'x'], 0];
    const cosx4 = ['Equal', ['Cos', ['Divide', 'x', 4]], 0];
    expect(solveBox(['Solve', ['List', sinx, cosx4], 'x']).toString()).toBe(
      '[2pi,-2pi]'
    );
    expect(solveBox(['Solve', ['List', cosx4, sinx], 'x']).toString()).toBe(
      '[2pi,-2pi]'
    );
  });

  test('periodic equations with no common principal root stay unevaluated', () => {
    // The principal roots do not give a complete root set, so an empty
    // result is not a decision.
    const r = solveBox([
      'Solve',
      [
        'List',
        ['Equal', ['Sin', 'x'], 0],
        ['Equal', ['Cos', ['Multiply', 3, 'x']], 0],
      ],
      'x',
    ]);
    expect(r.operator).toBe('Solve');
  });

  test('an undecided check leaves Solve unevaluated', () => {
    // For the candidate `1`, `1 = a` is neither true nor false.
    const r = solveBox([
      'Solve',
      [
        'List',
        ['Equal', ['Power', 'x', 2], 1],
        ['Equal', ['Power', 'x', 2], 'a'],
      ],
      'x',
    ]);
    expect(r.operator).toBe('Solve');
  });
});

describe('SOLVE: A LIST OF INEQUALITIES STAYS UNEVALUATED', () => {
  // The solution set of a list of inequalities is a region. The system
  // solver gave the vertices of a 2D region: `[(1, 0)]` for
  // `[x < 1, y > 0]`, a point that does not satisfy `x < 1`.
  test('[x < 1, y > 0] in two unknowns (box route)', () => {
    const r = solveBox([
      'Solve',
      ['List', ['Less', 'x', 1], ['Greater', 'y', 0]],
      ['List', 'x', 'y'],
    ]);
    expect(r.operator).toBe('Solve');
  });

  test('[x < 1, y > 0] in two unknowns (parse route)', () => {
    const r = solveParse('\\operatorname{Solve}([x<1, y>0], [x,y])');
    expect(r.operator).toBe('Solve');
  });

  test('a Set of inequalities', () => {
    const r = solveBox([
      'Solve',
      ['Set', ['Less', 'x', 1], ['Greater', 'y', 0]],
      ['List', 'x', 'y'],
    ]);
    expect(r.operator).toBe('Solve');
  });

  test('[x < 1, x > 0] in one unknown (was [])', () => {
    const r = solveBox([
      'Solve',
      ['List', ['Less', 'x', 1], ['Greater', 'x', 0]],
      'x',
    ]);
    expect(r.operator).toBe('Solve');
  });

  test('a single inequality stays unevaluated', () => {
    expect(solveBox(['Solve', ['Less', 'x', 1], 'x']).operator).toBe('Solve');
  });

  test('inequalities beside equations still filter the solutions', () => {
    expect(
      solveBox([
        'Solve',
        [
          'List',
          ['Equal', ['Add', 'x', 'y'], 5],
          ['Equal', ['Subtract', 'x', 'y'], 1],
          ['GreaterEqual', 'x', 0],
        ],
        ['List', 'x', 'y'],
      ]).json
    ).toEqual(['List', ['Tuple', 3, 2]]);
    expect(
      solveBox([
        'Solve',
        ['Set', ['Equal', ['Power', 'x', 2], 4], ['Greater', 'x', 0]],
        'x',
      ]).json
    ).toEqual(['List', 2]);
  });

  test('a list of congruences is still solved', () => {
    expect(
      solveBox([
        'Solve',
        ['List', ['Congruent', 'x', 2, 3], ['Congruent', 'x', 3, 5]],
        'x',
      ]).toString()
    ).toBe('[15t + 8]');
  });
});

describe('SOLVE: A LIST OF EQUATIONS WITH A DOMAIN', () => {
  // With a domain, the equations of the list are tested together for each
  // element of the domain. A plain expression `e` is the equation `e = 0`
  // here too. Before, a plain expression went to `And` as a number, and a
  // list with the domain in argument position gave `[]`.
  const domain = ['Element', 'x', ['Range', 1, 3]];
  const plain = [
    ['Subtract', 'x', 1],
    ['Subtract', ['Multiply', 2, 'x'], 2],
  ];
  const equations = [
    ['Equal', 'x', 1],
    ['Equal', ['Multiply', 2, 'x'], 2],
  ];

  test('the domain in argument position, both spellings', () => {
    expect(solveBox(['Solve', ['List', ...plain], domain]).json).toEqual([
      'List',
      1,
    ]);
    expect(solveBox(['Solve', ['List', ...equations], domain]).json).toEqual([
      'List',
      1,
    ]);
  });

  test('the domain in the list, both spellings', () => {
    expect(solveBox(['Solve', ['List', ...plain, domain], 'x']).json).toEqual([
      'List',
      1,
    ]);
    expect(
      solveBox(['Solve', ['List', ...equations, domain], 'x']).json
    ).toEqual(['List', 1]);
    expect(solveBox(['Solve', ['Set', ...plain, domain], 'x']).json).toEqual([
      'List',
      1,
    ]);
  });

  test('the domain in the list (parse route)', () => {
    expect(
      solveParse('\\operatorname{Solve}([x-1, 2x-2, x \\in [1..3]], x)').json
    ).toEqual(['List', 1]);
  });

  test('two unknowns, each with a domain in argument position', () => {
    expect(
      solveBox([
        'Solve',
        [
          'List',
          ['Equal', ['Add', 'x', 'y'], 3],
          ['Equal', ['Subtract', 'x', 'y'], 1],
        ],
        ['Element', 'x', ['Range', 0, 5]],
        ['Element', 'y', ['Range', 0, 5]],
      ]).json
    ).toEqual(['List', ['Tuple', 2, 1]]);
  });
});

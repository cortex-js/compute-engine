import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import {
  isFunction,
  isNumber,
  isString,
} from '../../src/compute-engine/boxed-expression/type-guards';

// Part 1. The `eq` handler of `Set`, the duplicate removal of `Union`, and the
// membership test of a large literal `Set` or `List` group the elements by
// their hash. Their answers are the answers of the element-by-element
// comparison they replace.
//
// Part 2. A point divided by a matrix is the matrix of the point divided by
// each cell, as the product of a point and a matrix is the matrix of the
// scaled points. Its type describes that value.

const ce = new ComputeEngine();

function setOf(xs: ReadonlyArray<Expression>): Expression {
  return ce.function('Set', [...xs]);
}

function ints(n: number, f: (i: number) => number): Expression[] {
  return Array.from({ length: n }, (_, i) => ce.number(f(i)));
}

/**
 * The membership test of a literal set before the hash index: each element
 * is compared with the target. `true` when an element is `isSame` the target
 * or is a number that `isEqual` says is equal to it; `undefined` when no
 * element matches and a comparison is undecided; `false` otherwise.
 */
function referenceSetContains(
  ops: ReadonlyArray<Expression>,
  target: Expression
): boolean | undefined {
  let indeterminate = false;
  for (const op of ops) {
    if (target.isSame(op)) return true;
    if (isNumber(target) && isNumber(op)) {
      const eq = target.isEqual(op);
      if (eq === true) return true;
      if (eq !== false) indeterminate = true;
    } else if (isString(target) && isString(op)) {
      // Two different strings
    } else indeterminate = true;
  }
  return indeterminate ? undefined : false;
}

describe('Set equality gives the same answers', () => {
  test.each([
    [['Set', ['Rational', 1, 2], 1], ['Set', 0.5, 1], 'True'],
    [['Set', 'x', 1], ['Set', 'y', 1], 'False'],
    [['Set', 'x', 1], ['Set', 1, 'x'], 'True'],
    [['Set', 1, 2], ['Set', 2, 3], 'False'],
    [['Set', 1, 2], ['Set', 2, 1], 'True'],
    [['Set', "'a'", 1], ['Set', 1, "'a'"], 'True'],
    [['Set', ['Tuple', 1, 2], 3], ['Set', 3, ['Tuple', 1, 2]], 'True'],
  ])('%j == %j is %s', (a, b, expected) => {
    expect(ce.box(['Equal', a, b] as any).evaluate().symbol).toBe(expected);
  });

  test('two large sets', () => {
    const n = 2000;
    const a = setOf(ints(n, (i) => i));
    const b = setOf(ints(n, (i) => n - 1 - i));
    const c = setOf(ints(n, (i) => (i === 7 ? n : i)));
    expect(a.isEqual(b)).toBe(true);
    expect(a.isEqual(c)).toBe(false);
    expect(c.isEqual(a)).toBe(false);
  });
});

describe('the membership in a large literal set gives the same answers', () => {
  // More elements than the size from which the index is used (32).
  const elements: Expression[] = [
    ...ints(20, (i) => i),
    ce.number([1, 3]),
    ce.number([2, 7]),
    ce.parse('\\sqrt{2}'),
    ce.parse('3\\sqrt{5}'),
    ce.number(0.1),
    ce.number(0.1 + 0.2),
    ce.number(1.4142135623730951),
    ce.number(2.5),
    ce.number(-7.25),
    ce.string('a'),
    ce.string('b'),
    ce.symbol('x'),
    ce.symbol('y'),
    ce.box(['Add', 'x', 1]),
    ce.symbol('Pi'),
    ce.tuple(1, 2),
  ];
  const numbersAndStrings = elements.filter((x) => isNumber(x) || isString(x));
  const targets: Expression[] = [
    ce.number(3),
    ce.number(3.0),
    ce.number(0.3),
    ce.number([3, 10]),
    ce.number([1, 3]),
    ce.number(1 / 3),
    ce.parse('\\sqrt{2}'),
    ce.parse('3\\sqrt{5}'),
    ce.number(1.4142135623730951),
    ce.number(1.41421356237),
    ce.number(Math.sqrt(45)),
    ce.number([5, 2]),
    ce.number(2.5),
    ce.number(100),
    ce.NaN,
    ce.box(['Complex', 1, 1]),
    ce.string('a'),
    ce.string('c'),
    ce.symbol('x'),
    ce.symbol('z'),
    ce.symbol('Pi'),
    ce.tuple(1, 2),
    ce.box(['Add', 'x', 1]),
  ];

  for (const [name, xs] of [
    ['mixed elements', elements],
    ['numbers and strings', [...numbersAndStrings, ...ints(20, (i) => 50 + i)]],
    ['strings', Array.from({ length: 40 }, (_, i) => ce.string(`s${i}`))],
  ] as const) {
    test(name, () => {
      const set = setOf(xs);
      expect(isFunction(set) && set.nops >= 32).toBe(true);
      if (!isFunction(set)) return;
      for (const target of [...targets, ce.string('s3'), ce.string('t')])
        expect([target.toString(), set.contains(target)]).toEqual([
          target.toString(),
          referenceSetContains(set.ops, target),
        ]);
    });
  }

  test('a large literal list', () => {
    const list = ce.function('List', [
      ...elements,
      ...Array.from({ length: 40 }, (_, i) => ce.string(`s${i}`)),
    ]);
    if (!isFunction(list)) throw new Error('not a list');
    for (const target of [...targets, ce.string('s3'), ce.string('t')])
      expect([target.toString(), list.contains(target)]).toEqual([
        target.toString(),
        list.ops.some((x) => x.isSame(target)),
      ]);
  });
});

describe('Union removes the duplicates', () => {
  test('an eager union', () => {
    const u = ce
      .box([
        'Union',
        ['List', 3, 1, 3, ['Rational', 1, 2]],
        ['Set', 0.5, 2, 1],
        ['List', "'a'", "'a'"],
      ])
      .evaluate();
    expect(u.toString()).toBe('Set(1, 2, 3, 1/2, "a")');
  });

  test('a held union of a list with repeated elements', () => {
    // More than 100 elements: the union stays held, and is walked by its
    // iterator. A list operand can hold an element more than one time.
    const list = ce.function(
      'List',
      ints(150, (i) => i % 3)
    );
    const set = setOf(ints(150, (i) => i));
    for (const u of [
      ce.function('Union', [list, set]).evaluate(),
      ce.function('Union', [set, list]).evaluate(),
      ce.function('Union', [list, list]).evaluate(),
    ]) {
      expect(u.operator).toBe('Union');
      const elements = [...u.each()];
      expect(u.count).toBe(elements.length);
      expect(new Set(elements.map((x) => x.toString())).size).toBe(
        elements.length
      );
    }
    expect(ce.function('Union', [list, set]).evaluate().count).toBe(150);
    expect(ce.function('Union', [list, list]).evaluate().count).toBe(3);
  });

  test('a held union of two large sets', () => {
    const n = 1000;
    const a = setOf(ints(n, (i) => i));
    const b = setOf(ints(n, (i) => i + n / 2));
    const u = ce.function('Union', [a, b]).evaluate();
    expect(u.count).toBe(n + n / 2);
    expect([...u.each()].length).toBe(n + n / 2);
  });
});

describe('the time of a comparison of large sets', () => {
  // Measured 2026-10-19 with 20,000 elements: `isEqual` of two sets took
  // 1.6 s, and the count of a held `Union` of two sets 172 s; they now take
  // 5 ms and 50 ms. The time limits apply only in a `CE_PERF=1` run.
  const n = 20000;
  const a = setOf(ints(n, (i) => i));
  const b = setOf(ints(n, (i) => n - 1 - i));
  const c = setOf(ints(n, (i) => i + n / 2));

  test('Equal', () => {
    const started = Date.now();
    expect(a.isEqual(b)).toBe(true);
    if (process.env.CE_PERF === '1')
      expect(Date.now() - started).toBeLessThan(500);
  });

  test('a held Union', () => {
    const started = Date.now();
    const u = ce.function('Union', [a, c]).evaluate();
    expect(u.count).toBe(n + n / 2);
    if (process.env.CE_PERF === '1')
      expect(Date.now() - started).toBeLessThan(2000);
  });

  test('a held Union of lists', () => {
    const started = Date.now();
    const u = ce
      .function('Union', [
        ce.function(
          'List',
          Array.from({ length: n }, (_, i) => ce.string(`s${i}`))
        ),
        ce.function(
          'List',
          Array.from({ length: n }, (_, i) => ce.string(`s${i + n / 2}`))
        ),
      ])
      .evaluate();
    expect(u.count).toBe(n + n / 2);
    if (process.env.CE_PERF === '1')
      expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('a point divided by a matrix', () => {
  const ce = new ComputeEngine();
  ce.declare('q', 'tuple');
  ce.declare('m', 'matrix<2x2>');
  ce.declare('n', 'matrix<2x2>');
  ce.assign('n', ce.box(['List', ['List', 1, 2], ['List', 3, 4]]));
  ce.declare('v', 'vector<2>');
  const M = ['List', ['List', 1, 2], ['List', 3, 4]];
  const P = ['Tuple', 1, 2];

  test('is the matrix of the point divided by each cell', () => {
    const e = ce.box(['Divide', P, M]);
    const value = e.evaluate();
    expect(value.toString()).toBe(
      '[[(1, 2),(1/2, 1)],[(1/3, 2/3),(1/4, 1/2)]]'
    );
    expect(e.type.toString()).toBe('list<tuple<rational, rational>^(2x2)>');
    expect(value.type.matches(e.type)).toBe(true);
    expect(e.N().toString()).toMatch(/^\[\[\(1, 2\),\(0\.5, 1\)\],\[\(0\.333/);
    // The same value as the product with the cell-wise reciprocal.
    expect(
      ce
        .box(['Multiply', P, ['Divide', 1, M]])
        .evaluate()
        .isSame(value)
    ).toBe(true);
  });

  test('parse route', () => {
    const e = ce.parse('(1, 2)/\\begin{pmatrix}1 & 2\\\\ 3 & 4\\end{pmatrix}');
    expect(e.type.toString()).toBe('list<tuple<rational, rational>^(2x2)>');
    expect(e.evaluate().toString()).toBe(
      '[[(1, 2),(1/2, 1)],[(1/3, 2/3),(1/4, 1/2)]]'
    );
  });

  test('a rectangular matrix, and a matrix with a zero cell', () => {
    expect(
      ce
        .box(['Divide', P, ['List', ['List', 1, 2, 5], ['List', 3, 4, 6]]])
        .evaluate()
        .toString()
    ).toBe('[[(1, 2),(1/2, 1),(1/5, 2/5)],[(1/3, 2/3),(1/4, 1/2),(1/6, 1/3)]]');
    expect(
      ce
        .box(['Divide', P, ['List', ['List', 1, 0], ['List', 3, 4]]])
        .evaluate()
        .toString()
    ).toBe('[[(1, 2),(~oo, ~oo)],[(1/3, 2/3),(1/4, 1/2)]]');
  });

  test('a symbol with no value is typed by the value it will have', () => {
    for (const [json, type] of [
      [['Divide', P, 'm'], 'list<tuple<number, number>^(2x2)>'],
      [['Divide', 'q', M], 'list<tuple^(2x2)>'],
      [['Divide', 'q', 'm'], 'list<tuple^(2x2)>'],
    ] as const) {
      const e = ce.box(json as any);
      expect([json, e.type.toString()]).toEqual([json, type]);
      expect(e.evaluate().type.matches(e.type)).toBe(true);
    }
  });

  test('a symbol with a matrix value', () => {
    const e = ce.box(['Divide', P, 'n']);
    expect(e.evaluate().toString()).toBe(
      '[[(1, 2),(1/2, 1)],[(1/3, 2/3),(1/4, 1/2)]]'
    );
    expect(e.evaluate().type.matches(e.type)).toBe(true);
  });

  test('a matrix divided by a point is still an error', () => {
    expect(ce.box(['Divide', M, P]).evaluate().toString()).toBe(
      'Error(ErrorCode("no-division-by-point"))'
    );
  });
});

describe('the type of a product of a point and a tensor that is not a literal', () => {
  const ce = new ComputeEngine();
  ce.declare('m', 'matrix<2x2>');
  ce.declare('n', 'matrix<2x2>');
  ce.assign('n', ce.box(['List', ['List', 1, 2], ['List', 3, 4]]));
  ce.declare('v', 'vector<2>');
  ce.declare('w', 'vector<2>');
  ce.assign('w', ce.box(['List', 1, 2]));
  const M = ['List', ['List', 1, 2], ['List', 3, 4]];
  const P = ['Tuple', 1, 2];

  test.each([
    [['Multiply', P, 'm'], 'list<tuple<number, number>^(2x2)>'],
    [['Multiply', P, 'n'], 'list<tuple<number, number>^(2x2)>'],
    [['Multiply', P, 'v'], 'list<tuple<number, number>^2>'],
    [['Multiply', P, 'w'], 'list<tuple<number, number>^2>'],
    [['Multiply', P, ['Divide', 1, M]], 'list<tuple<number, number>^(2x2)>'],
  ])('%j is typed %s', (json, type) => {
    const e = ce.box(json as any);
    expect(e.type.toString()).toBe(type);
    expect(e.evaluate().type.matches(e.type)).toBe(true);
  });
});

describe('a list of points against a matrix', () => {
  const ce = new ComputeEngine();
  const M = ['List', ['List', 1, 2], ['List', 3, 4]];
  const PL = ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]];

  test('the product is a matrix of points', () => {
    for (const json of [
      ['Multiply', PL, M],
      ['Multiply', M, PL],
    ]) {
      const e = ce.box(json as any);
      expect(e.type.toString()).toBe('list<tuple<integer, integer>^(2x2)>');
      const value = e.evaluate();
      expect(value.toString()).toBe('[[(1, 2),(2, 4)],[(9, 12),(12, 16)]]');
      expect(value.type.matches(e.type)).toBe(true);
    }
  });

  test('the quotient is a list of lists of points', () => {
    const e = ce.box(['Divide', PL, M] as any);
    // A tuple cell may carry dimensions, so the quotient has the matrix's shape.
    expect(e.type.toString()).toBe('list<tuple<rational, rational>^(2x2)>');
    const value = e.evaluate();
    expect(value.toString()).toBe('[[(1, 2),(1/2, 1)],[(1, 4/3),(3/4, 1)]]');
    expect(value.type.matches(e.type)).toBe(true);
  });

  test('a scalar factor is merged into the cell type', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    for (const [json, type, value] of [
      [
        ['Multiply', 2, PL, M],
        'list<tuple<integer, integer>^(2x2)>',
        '[[(2, 4),(4, 8)],[(18, 24),(24, 32)]]',
      ],
      [
        ['Multiply', ['Rational', 1, 2], M, PL],
        'list<tuple<rational, rational>^(2x2)>',
        '[[(1/2, 1),(1, 2)],[(9/2, 6),(6, 8)]]',
      ],
      [
        ['Multiply', 'a', PL, M],
        'list<tuple<real, real>^(2x2)>',
        '[[(a, 2a),(2a, 4a)],[(9a, 12a),(12a, 16a)]]',
      ],
    ] as const) {
      const e = ce.box(json as any);
      expect([json, e.type.toString()]).toEqual([json, type]);
      const v = e.evaluate();
      expect(v.toString()).toBe(value);
      expect(v.type.matches(e.type)).toBe(true);
    }
  });
});

describe('a list of rows of points', () => {
  const ce = new ComputeEngine();
  const a = ['Tuple', 1, ['Rational', 1, 2]];
  const b = ['Tuple', ['Rational', 1, 2], 1];

  test('is typed with its two levels', () => {
    // The points have two different tuple types. The literal was typed
    // `list<tuple<…> | tuple<…>>`, a list of points, where its elements are
    // rows.
    const e = ce.box(['List', ['List', a, b], ['List', b, a]] as any);
    expect(e.type.toString()).toBe(
      'list<(tuple<integer, rational> | tuple<rational, integer>)^(2x2)>'
    );
    expect(e.type.matches('list<list<any>>')).toBe(true);
    // A literal of rank 2 whose cells are of different kinds keeps its two
    // levels, with no dimensions.
    expect(
      ce
        .box(['List', ['List', 1, "'s'"], ['List', 2, 3]] as any)
        .type.toString()
    ).toBe('list<list<integer | string>>');
  });

  test('plus a point is a matrix of points', () => {
    const M2 = [
      'List',
      ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
      ['List', ['Tuple', 5, 6], ['Tuple', 7, 8]],
    ];
    for (const json of [
      ['Add', M2, ['Tuple', 1, 1]],
      ['Subtract', M2, ['Tuple', 1, 1]],
      ['Add', ['List', ['List', a, b], ['List', b, a]], ['Tuple', 1, 1]],
    ]) {
      const e = ce.box(json as any);
      expect(e.type.toString()).not.toContain('| tuple<integer, integer>');
      expect(e.type.matches('list<list<any>>')).toBe(true);
      expect(e.evaluate().type.matches(e.type)).toBe(true);
    }
    expect(ce.box(['Add', M2, ['Tuple', 1, 1]]).type.toString()).toBe(
      'list<tuple<integer, integer>^(2x2)>'
    );
  });
});

describe('a point divided by a collection with a zero cell', () => {
  const ce = new ComputeEngine();
  ce.declare('L', 'list<integer>');
  ce.declare('K', 'list<integer<1..>>');
  const P = ['Tuple', 1, 2];
  const P0 = ['Tuple', 0, 2];

  test.each([
    [
      ['Divide', P, ['List', 1, 0]],
      'list<tuple<infinity, infinity> | tuple<rational, rational>>',
      '[(1, 2),(~oo, ~oo)]',
    ],
    [
      ['Divide', P0, ['List', 1, 0]],
      'list<tuple<nan, infinity> | tuple<rational, rational>>',
      '[(0, 2),(Indeterminate, ~oo)]',
    ],
    [
      ['Divide', P, ['List', ['List', 1, 0], ['List', 3, 4]]],
      'list<(tuple<infinity, infinity> | tuple<rational, rational>)^(2x2)>',
      '[[(1, 2),(~oo, ~oo)],[(1/3, 2/3),(1/4, 1/2)]]',
    ],
    [
      ['Divide', P0, ['List', ['List', 1, 0], ['List', 3, 4]]],
      'list<(tuple<nan, infinity> | tuple<rational, rational>)^(2x2)>',
      '[[(0, 2),(Indeterminate, ~oo)],[(0, 2/3),(0, 1/2)]]',
    ],
    [
      ['Divide', P, ['Range', -1, 1]],
      'list<tuple<infinity | nan | real, infinity | nan | real>>',
      '[(-1, -2),(~oo, ~oo),(1, 2)]',
    ],
    [
      ['Divide', P, ['Range', 1, 3]],
      'list<tuple<rational, rational>>',
      '[(1, 2),(1/2, 1),(1/3, 2/3)]',
    ],
  ])('%j', (json, type, value) => {
    const e = ce.box(json as any);
    expect(e.type.toString()).toBe(type);
    const v = e.evaluate();
    expect(v.toString()).toBe(value);
    expect(v.type.matches(e.type)).toBe(true);
  });

  test('an element type that admits 0', () => {
    expect(ce.box(['Divide', P, 'L']).type.toString()).toBe(
      'list<tuple<infinity | nan | real, infinity | nan | real>>'
    );
    expect(ce.box(['Divide', P, 'K']).type.toString()).toBe(
      'list<tuple<rational, rational>>'
    );
  });

  test('parse route', () => {
    const e = ce.parse('(1, 2)/\\begin{pmatrix}1 & 0\\\\ 3 & 4\\end{pmatrix}');
    expect(e.type.toString()).toBe(
      'list<(tuple<infinity, infinity> | tuple<rational, rational>)^(2x2)>'
    );
    expect(e.evaluate().type.matches(e.type)).toBe(true);
  });
});

describe('a point and a tensor of rank 3', () => {
  const ce = new ComputeEngine();
  const T = ['List', ['List', ['List', 1, 2]], ['List', ['List', 3, 4]]];
  const P = ['Tuple', 1, 2];

  test.each([
    [['Multiply', P, T], '[[[(1, 2),(2, 4)]],[[(3, 6),(4, 8)]]]'],
    [['Multiply', T, P], '[[[(1, 2),(2, 4)]],[[(3, 6),(4, 8)]]]'],
    [['Multiply', 2, P, T], '[[[(2, 4),(4, 8)]],[[(6, 12),(8, 16)]]]'],
    [['Divide', P, T], '[[[(1, 2),(1/2, 1)]],[[(1/3, 2/3),(1/4, 1/2)]]]'],
  ])('%j', (json, value) => {
    const e = ce.box(json as any);
    const v = e.evaluate();
    expect(v.toString()).toBe(value);
    expect(v.type.matches(e.type)).toBe(true);
    expect(e.N().toString()).not.toContain('*');
  });
});

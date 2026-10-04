import { ComputeEngine, compile } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { LatexSyntax } from '../../src/latex-syntax';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// In set theory `|S|` is the number of elements of the set `S` (its
// cardinality), and `|w|` is the length of the string `w`. The LaTeX parser
// reads every `|…|` as `Abs`, and boxing writes `Abs` of an operand whose type
// is a set or a string as `Count`. `Abs` of a list or a tuple is not changed:
// it is the absolute value of each element, or the norm of a point.
//

const ce = new ComputeEngine();
ce.declare('A', 'set<integer>');
ce.declare('S', 'set<integer>');
ce.declare('r', 'real');

const box = (input: unknown) => ce.box(input as Expression);

/** The canonical MathJSON and the evaluated MathJSON of `latex`. */
function parsed(latex: string): [unknown, unknown] {
  const expr = ce.parse(latex);
  return [expr.json, expr.evaluate().json];
}

/** The same, for the MathJSON `Abs(operand)` on the box route. */
function boxed(operand: unknown): [unknown, unknown] {
  const expr = box(['Abs', operand]);
  return [expr.json, expr.evaluate().json];
}

/** The same, for `ce.function('Abs', [operand])`. */
function applied(operand: unknown): [unknown, unknown] {
  const expr = ce.function('Abs', [box(operand)]);
  return [expr.json, expr.evaluate().json];
}

describe('|S| OF A SET IS THE NUMBER OF ITS ELEMENTS', () => {
  // [label, LaTeX, the operand as MathJSON, canonical form, value]
  const cases: [string, string, unknown, unknown, unknown][] = [
    [
      'a set literal',
      '|\\{1,2\\}|',
      ['Set', 1, 2],
      ['Count', ['Set', 1, 2]],
      2,
    ],
    [
      'a set literal with scaled bars',
      '\\left|\\{1,2,3\\}\\right|',
      ['Set', 1, 2, 3],
      ['Count', ['Set', 1, 2, 3]],
      3,
    ],
    [
      'the ring Z/5Z',
      '|\\mathbb{Z}/5\\mathbb{Z}|',
      ['QuotientRing', 'Integers', 5],
      ['Count', ['QuotientRing', 'Integers', 5]],
      5,
    ],
    [
      'a union of two declared sets with no value',
      '|A \\cup S|',
      ['Union', 'A', 'S'],
      ['Count', ['Union', 'A', 'S']],
      ['Count', ['Union', 'A', 'S']],
    ],
    [
      'a declared set with no value',
      '|S|',
      'S',
      ['Count', 'S'],
      ['Count', 'S'],
    ],
    [
      'an infinite set: the value that Count gives',
      '|\\mathbb{Z}|',
      'Integers',
      ['Count', 'Integers'],
      'PositiveInfinity',
    ],
    ['the empty set', '|\\emptyset|', 'EmptySet', ['Count', 'EmptySet'], 0],
    [
      'a union of two set literals',
      '|\\{1,2\\}\\cup\\{2,3\\}|',
      ['Union', ['Set', 1, 2], ['Set', 2, 3]],
      ['Count', ['Union', ['Set', 1, 2], ['Set', 2, 3]]],
      3,
    ],
    [
      'a string: the number of its characters',
      '|\\text{abc}|',
      "'abc'",
      ['Count', "'abc'"],
      3,
    ],
  ];

  test.each(cases)('%s (parse route)', (_label, latex, _op, json, value) => {
    expect(parsed(latex)).toEqual([json, value]);
  });

  test.each(cases)('%s (box route)', (_label, _latex, op, json, value) => {
    expect(boxed(op)).toEqual([json, value]);
  });

  test.each(cases)(
    '%s (ce.function route)',
    (_label, _latex, op, json, value) => {
      expect(applied(op)).toEqual([json, value]);
    }
  );

  test('an interval is a set: its count is infinite', () => {
    expect(boxed(['Interval', 1, 3])).toEqual([
      ['Count', ['Interval', 1, 3]],
      'PositiveInfinity',
    ]);
  });
});

describe('|x| OF A NUMBER, A LIST OR A TUPLE IS NOT CHANGED', () => {
  test('a list: the absolute value of each element', () => {
    expect(parsed('|[1, 2, 3]|')).toEqual([
      ['Abs', ['List', 1, 2, 3]],
      ['List', 1, 2, 3],
    ]);
    expect(parsed('|[-1, 2]|')).toEqual([
      ['Abs', ['List', -1, 2]],
      ['List', 1, 2],
    ]);
    expect(boxed(['List', -1, 2])).toEqual([
      ['Abs', ['List', -1, 2]],
      ['List', 1, 2],
    ]);
  });

  test('a number', () => {
    expect(parsed('|-3|')).toEqual([['Abs', -3], 3]);
    expect(boxed(-3)).toEqual([['Abs', -3], 3]);
  });

  test('a symbol with no type', () => {
    expect(parsed('|x|')).toEqual([
      ['Abs', 'x'],
      ['Abs', 'x'],
    ]);
  });

  test('a tuple: the norm of a point', () => {
    expect(boxed(['Tuple', 3, 4])).toEqual([['Abs', ['Tuple', 3, 4]], 5]);
  });

  test('a dictionary is not a cardinality: Abs of it is an error', () => {
    const expr = box(['Abs', ['Dictionary', ['Tuple', "'a'", 1]]]);
    expect(expr.isValid).toBe(false);
  });
});

describe('|s| OF A VALUE THAT IS A SET ONLY WHEN IT IS EVALUATED', () => {
  test('a symbol of type `any` that holds a set', async () => {
    const ce2 = new ComputeEngine();
    ce2.declare('z', 'any');
    const expr = ce2.box(['Abs', 'z']);
    ce2.assign('z', ce2.box(['Set', 4, 5, 6]));
    expect(expr.json).toEqual(['Abs', 'z']);
    expect(expr.evaluate().json).toBe(3);
    expect((await expr.evaluateAsync()).json).toBe(3);
  });

  test('the parameter of a function applied to a set', () => {
    const ce2 = new ComputeEngine();
    ce2.parse('f(s) := |s|').evaluate();
    expect(ce2.parse('f(\\{1,2\\})').evaluate().json).toBe(2);
    expect(ce2.parse('f(-3)').evaluate().json).toBe(3);
    expect(ce2.parse('f([-1, 2])').evaluate().json).toEqual(['List', 1, 2]);
  });
});

describe('Count OF A SET SERIALIZES AS |S|', () => {
  test.each([
    ['|\\{1,2\\}|', '\\vert\\lbrace1, 2\\rbrace\\vert'],
    ['|S|', '\\vert S\\vert'],
    ['|A \\cup S|', '\\vert A\\cup S\\vert'],
    ['|\\mathbb{Z}|', '\\vert\\mathbb{Z}\\vert'],
    ['|\\text{abc}|', '\\vert\\text{abc}\\vert'],
  ])('%s', (latex, serialized) => {
    const expr = ce.parse(latex);
    expect(expr.latex).toBe(serialized);
    // The round trip gives the same expression
    expect(ce.parse(expr.latex).json).toEqual(expr.json);
  });

  test('Count of a list keeps the function spelling', () => {
    const expr = box(['Count', ['List', 1, 2]]);
    expect(expr.latex).toBe(
      '\\mathrm{Count}(\\bigl\\lbrack1, 2\\bigr\\rbrack)'
    );
    expect(ce.parse(expr.latex).json).toEqual(['Count', ['List', 1, 2]]);
  });

  test('Count of a list symbol keeps the function spelling', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('L', 'list<integer>');
    const expr = ce2.box(['Count', 'L']);
    expect(expr.latex).toBe('\\mathrm{Count}(L)');
    expect(ce2.parse(expr.latex).json).toEqual(['Count', 'L']);
  });

  test('Count with a second operand keeps the function spelling', () => {
    expect(box(['Count', ['Set', 1, 2], 1]).latex).toMatch(
      /^\\mathrm\{Count\}/
    );
  });

  test('without types, only a set literal, EmptySet or a string get bars', () => {
    const syntax = new LatexSyntax();
    expect(syntax.serialize(['Count', ['Set', 1, 2]])).toBe(
      '\\vert\\lbrace1, 2\\rbrace\\vert'
    );
    expect(syntax.serialize(['Count', 'EmptySet'])).toBe(
      '\\vert\\emptyset\\vert'
    );
    expect(syntax.serialize(['Count', 'S'])).toBe('\\mathrm{Count}(S)');
  });
});

describe('\\#S AND \\operatorname{card}(S) ARE Count(S)', () => {
  test.each([
    ['\\#S', ['Count', 'S'], ['Count', 'S']],
    ['\\# S', ['Count', 'S'], ['Count', 'S']],
    ['\\#\\{1,2\\}', ['Count', ['Set', 1, 2]], 2],
    ['\\#S+1', ['Add', ['Count', 'S'], 1], ['Add', ['Count', 'S'], 1]],
    ['2\\#S', ['Multiply', 2, ['Count', 'S']], ['Multiply', 2, ['Count', 'S']]],
    [
      '\\#(A\\cup S)',
      ['Count', ['Union', 'A', 'S']],
      ['Count', ['Union', 'A', 'S']],
    ],
    ['\\operatorname{card}(S)', ['Count', 'S'], ['Count', 'S']],
    ['\\mathrm{card}(S)', ['Count', 'S'], ['Count', 'S']],
    ['\\operatorname{Card}(S)', ['Count', 'S'], ['Count', 'S']],
    ['\\operatorname{card}(\\{1,2,3\\})', ['Count', ['Set', 1, 2, 3]], 3],
  ])('%s', (latex, json, value) => {
    expect(parsed(latex)).toEqual([json, value]);
  });

  test('\\#S serializes as |S|', () => {
    expect(ce.parse('\\#S').latex).toBe('\\vert S\\vert');
  });

  test('\\# without an operand is the symbol `hash`', () => {
    expect(ce.parse('\\#').json).toBe('hash');
    expect(ce.parse('x_{\\#}').json).toBe('x_hash');
  });

  test('\\#(q) is an application when `hash` is a function', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('hash', 'function');
    const expr = ce2.box(['hash', 'q']);
    expect(expr.latex).toBe('\\#(q)');
    expect(ce2.parse('\\#(q)').json).toEqual(['hash', 'q']);
  });
});

describe('Count OF A SET OPERATION WITH AN OPERAND THAT HAS NO VALUE', () => {
  test('stays unevaluated', () => {
    for (const op of ['Union', 'Intersection', 'SetMinus'])
      expect(box(['Count', [op, 'A', 'S']]).evaluate().json).toEqual([
        'Count',
        [op, 'A', 'S'],
      ]);
  });

  test('a union with an infinite operand is infinite', () => {
    expect(box(['Count', ['Union', 'A', 'Integers']]).evaluate().json).toBe(
      'PositiveInfinity'
    );
  });
});

//
// The count of a set operation with an infinite operand. Each operator has
// its own rule: an infinite operand of an intersection does not make the
// intersection infinite, and an infinite operand of a difference makes it
// infinite only when it is the first operand.
//
describe('Count OF A SET OPERATION WITH AN INFINITE OPERAND', () => {
  /** The `count`, `isFiniteCollection` and `isEmptyCollection` of the
   * UNEVALUATED operation, and the value of `Count` of it. */
  function facets(json: unknown[]): [unknown, unknown, unknown, unknown] {
    const [name, ...ops] = json as [string, ...unknown[]];
    const expr = ce._fn(
      name,
      ops.map((x) => box(x))
    );
    return [
      expr.count,
      expr.isFiniteCollection,
      expr.isEmptyCollection,
      box(['Count', json]).evaluate().json,
    ];
  }

  // [label, operation, count, isFinite, isEmpty, value of Count]
  const cases: [string, unknown[], unknown, unknown, unknown, unknown][] = [
    [
      'Intersection(Integers, {1, 2})',
      ['Intersection', 'Integers', ['Set', 1, 2]],
      2,
      true,
      false,
      2,
    ],
    [
      'Intersection({1, 2}, Integers)',
      ['Intersection', ['Set', 1, 2], 'Integers'],
      2,
      true,
      false,
      2,
    ],
    [
      'Intersection(Integers, {1, Pi})',
      ['Intersection', 'Integers', ['Set', 1, 'Pi']],
      1,
      true,
      false,
      1,
    ],
    [
      'Intersection(Integers, RealNumbers): infinite, as Integers is a subset of RealNumbers',
      ['Intersection', 'Integers', 'RealNumbers'],
      Infinity,
      false,
      false,
      'PositiveInfinity',
    ],
    [
      'Intersection(Integers, Interval(0, 3)): no operand can be walked',
      ['Intersection', 'Integers', ['Interval', 0, 3]],
      undefined,
      undefined,
      undefined,
      ['Count', ['Intersection', 'Integers', ['Interval', 0, 3]]],
    ],
    [
      'Intersection(Integers, {1, x}): undecided membership of x',
      ['Intersection', 'Integers', ['Set', 1, 'x']],
      undefined,
      true,
      undefined,
      ['Count', ['Intersection', 'Integers', ['Set', 1, 'x']]],
    ],
    [
      'Intersection of a list with a repeated element',
      ['Intersection', ['List', 1, 1, 2], ['Set', 1, 2]],
      2,
      true,
      false,
      2,
    ],
    [
      'SetMinus(Integers, {1})',
      ['SetMinus', 'Integers', ['Set', 1]],
      Infinity,
      false,
      false,
      'PositiveInfinity',
    ],
    [
      'SetMinus(Integers, 2)',
      ['SetMinus', 'Integers', 2],
      Infinity,
      false,
      false,
      'PositiveInfinity',
    ],
    [
      'SetMinus({1, 2, 3}, Integers)',
      ['SetMinus', ['Set', 1, 2, 3], 'Integers'],
      0,
      true,
      true,
      0,
    ],
    [
      'SetMinus(Integers, Integers): both infinite',
      ['SetMinus', 'Integers', 'Integers'],
      undefined,
      undefined,
      undefined,
      ['Count', ['SetMinus', 'Integers', 'Integers']],
    ],
    [
      'SetMinus(Integers, u): u has no type, and can be a set',
      ['SetMinus', 'Integers', 'u'],
      undefined,
      undefined,
      undefined,
      ['Count', ['SetMinus', 'Integers', 'u']],
    ],
    [
      'SetMinus(Integers, r): r is a real number, which removes one element',
      ['SetMinus', 'Integers', 'r'],
      Infinity,
      false,
      false,
      'PositiveInfinity',
    ],
    [
      'Complement(Integers, {1})',
      ['Complement', 'Integers', ['Set', 1]],
      Infinity,
      false,
      false,
      'PositiveInfinity',
    ],
    [
      'Complement({1, 2, 3}, Integers)',
      ['Complement', ['Set', 1, 2, 3], 'Integers'],
      0,
      true,
      true,
      0,
    ],
    [
      'Complement({1, x}, Integers): undecided membership of x',
      ['Complement', ['Set', 1, 'x'], 'Integers'],
      undefined,
      true,
      undefined,
      ['Count', ['Complement', ['Set', 1, 'x'], 'Integers']],
    ],
    [
      'SymmetricDifference({1, 2, 3}, {2, 3, 4})',
      ['SymmetricDifference', ['Set', 1, 2, 3], ['Set', 2, 3, 4]],
      2,
      true,
      false,
      2,
    ],
    [
      'SymmetricDifference(Integers, {1})',
      ['SymmetricDifference', 'Integers', ['Set', 1]],
      Infinity,
      false,
      false,
      'PositiveInfinity',
    ],
    [
      'SymmetricDifference({1}, Integers)',
      ['SymmetricDifference', ['Set', 1], 'Integers'],
      Infinity,
      false,
      false,
      'PositiveInfinity',
    ],
    [
      'SymmetricDifference(Integers, RealNumbers): both infinite',
      ['SymmetricDifference', 'Integers', 'RealNumbers'],
      undefined,
      undefined,
      undefined,
      ['Count', ['SymmetricDifference', 'Integers', 'RealNumbers']],
    ],
    [
      'Union(Integers, {1})',
      ['Union', 'Integers', ['Set', 1]],
      Infinity,
      false,
      false,
      'PositiveInfinity',
    ],
  ];

  test.each(cases)('%s', (_label, json, count, isFinite, isEmpty, value) => {
    expect(facets(json)).toEqual([count, isFinite, isEmpty, value]);
  });

  test('the parse route, in both operand orders', () => {
    expect(parsed('|\\mathbb{Z}\\cap\\{1,2\\}|')).toEqual([
      ['Count', ['Intersection', 'Integers', ['Set', 1, 2]]],
      2,
    ]);
    expect(parsed('|\\{1,2\\}\\cap\\mathbb{Z}|')[1]).toBe(2);
    expect(parsed('\\#(\\mathbb{Z}\\setminus\\{1\\})')[1]).toBe(
      'PositiveInfinity'
    );
  });

  test('the walk of Intersection(Integers, {2, 1}) ends', () => {
    const expr = ce._fn('Intersection', [box('Integers'), box(['Set', 2, 1])]);
    expect([...expr.each()].map((x) => x.json)).toEqual([2, 1]);
  });
});

//
// The evaluate handlers of the set operators agree with the counts above. An
// undecided membership in a finite set whose elements can be walked is read
// as "not a member" (different symbols are different elements). An
// undecided membership in an infinite set, or in a collection whose elements
// cannot be computed, keeps the operation unevaluated.
//
describe('EVALUATION OF A SET OPERATION WITH AN UNDECIDED MEMBERSHIP', () => {
  const evaluated = (json: unknown) => box(json).evaluate().json;

  test.each([
    [
      'Intersection({1, 2, x}, Integers): x may be an integer',
      ['Intersection', ['Set', 1, 2, 'x'], 'Integers'],
      ['Intersection', ['Set', 1, 2, 'x'], 'Integers'],
    ],
    [
      'Intersection(Integers, {1, 2, x}): the same in the other order',
      ['Intersection', 'Integers', ['Set', 1, 2, 'x']],
      ['Intersection', 'Integers', ['Set', 1, 2, 'x']],
    ],
    [
      'Intersection(Integers, {1, 2})',
      ['Intersection', 'Integers', ['Set', 1, 2]],
      ['Set', 1, 2],
    ],
    [
      'Intersection({1, 2}, Integers)',
      ['Intersection', ['Set', 1, 2], 'Integers'],
      ['Set', 1, 2],
    ],
    [
      'Intersection({a, b, c}, {d, c, b}, {b, f}): different symbols are different elements',
      [
        'Intersection',
        ['Set', 'a', 'b', 'c'],
        ['Set', 'd', 'c', 'b'],
        ['Set', 'b', 'f'],
      ],
      ['Set', 'b'],
    ],
    [
      'Intersection(Z/5Z, {1}): an integer is not an element of Z/5Z',
      ['Intersection', ['QuotientRing', 'Integers', 5], ['Set', 1]],
      'EmptySet',
    ],
    [
      'Intersection({1}, Z/5Z)',
      ['Intersection', ['Set', 1], ['QuotientRing', 'Integers', 5]],
      'EmptySet',
    ],
    [
      'SetMinus({1, x}, Integers): x may be an integer',
      ['SetMinus', ['Set', 1, 'x'], 'Integers'],
      ['SetMinus', ['Set', 1, 'x'], 'Integers'],
    ],
    [
      'SetMinus({1, x}, {1}): different symbols are different elements',
      ['SetMinus', ['Set', 1, 'x'], ['Set', 1]],
      ['Set', 'x'],
    ],
    [
      'SetMinus({1, 2, 3}, Integers)',
      ['SetMinus', ['Set', 1, 2, 3], 'Integers'],
      'EmptySet',
    ],
    [
      'SetMinus({1, 2}, Z/5Z)',
      ['SetMinus', ['Set', 1, 2], ['QuotientRing', 'Integers', 5]],
      ['Set', 1, 2],
    ],
    [
      'SymmetricDifference({1, x}, {1})',
      ['SymmetricDifference', ['Set', 1, 'x'], ['Set', 1]],
      ['Set', 'x'],
    ],
  ])('%s', (_label, json, value) => {
    expect(evaluated(json)).toEqual(value);
  });

  test('the count agrees with the evaluated result', () => {
    for (const json of [
      ['Intersection', ['Set', 1, 2, 'x'], 'Integers'],
      ['Intersection', 'Integers', ['Set', 1, 2, 'x']],
      ['SetMinus', ['Set', 1, 'x'], 'Integers'],
    ]) {
      expect(box(json).evaluate().count).toBeUndefined();
      expect(box(['Count', json]).evaluate().json).toEqual(['Count', json]);
    }
    for (const json of [
      ['Intersection', ['Set', 'a', 'b'], ['Set', 'b', 'c']],
      ['SetMinus', ['Set', 1, 'x'], ['Set', 1]],
      ['Intersection', ['QuotientRing', 'Integers', 5], ['Set', 1]],
    ]) {
      const [name, ...ops] = json as [string, ...unknown[]];
      const lazy = ce._fn(
        name,
        ops.map((x) => box(x))
      );
      expect(lazy.count).toBe(box(json).evaluate().count);
    }
  });
});

//
// A held set operation whose walk would meet an undecided membership cannot
// be walked: it reports `isEnumerableCollection === false`, its iterator
// yields nothing, and an operation over it does not read "undecided" as "not
// a member".
//
describe('A SET OPERATION WITH AN UNDECIDED MEMBERSHIP IS NOT WALKED', () => {
  // `x` may be an integer, so the elements of I are not known.
  const I = ['Intersection', 'Integers', ['Set', 1, 'x']];

  test('the held operation reports that it cannot be walked', () => {
    const held = ce._fn('Intersection', [
      box('Integers'),
      box(['Set', 1, 'x']),
    ]);
    expect(held.count).toBeUndefined();
    expect(held.isFiniteCollection).toBe(true);
    expect(held.isEnumerableCollection).toBe(false);
    expect([...held.each()]).toEqual([]);
  });

  test.each([
    ['SetMinus(I, {1})', ['Count', ['SetMinus', I, ['Set', 1]]]],
    ['SetMinus(I, {5})', ['Count', ['SetMinus', I, ['Set', 5]]]],
    [
      'SymmetricDifference(I, {7})',
      ['Count', ['SymmetricDifference', I, ['Set', 7]]],
    ],
    ['Union(I, {5})', ['Count', ['Union', I, ['Set', 5]]]],
  ])('Count(%s) stays unevaluated', (_label, json) => {
    expect(box(json).evaluate().json).toEqual(json);
  });

  test('SetMinus(I, {5}) stays unevaluated', () => {
    const json = ['SetMinus', I, ['Set', 5]];
    expect(box(json).evaluate().json).toEqual(json);
  });

  test('Intersection(I, {1, 2, 3, 4}): x is not one of 1, 2, 3, 4', () => {
    // The nested intersection is flattened to `Intersection(Integers,
    // Set(1, x), Set(1, 2, 3, 4))`. The symbol `x` is not one of the
    // elements of the finite set `Set(1, 2, 3, 4)` (different symbols are
    // different elements), so it is not in the intersection.
    expect(
      box(['Count', ['Intersection', I, ['Set', 1, 2, 3, 4]]]).evaluate().json
    ).toBe(1);
  });

  test('Intersection({x}, SetMinus({x}, Integers)) stays unevaluated', () => {
    const json = [
      'Intersection',
      ['Set', 'x'],
      ['SetMinus', ['Set', 'x'], 'Integers'],
    ];
    expect(box(json).evaluate().json).toEqual(json);
  });

  test('decided cases are still walked', () => {
    const take = (json: unknown[], n: number) => {
      const [name, ...ops] = json as [string, ...unknown[]];
      const held = ce._fn(
        name,
        ops.map((x) => box(x))
      );
      const out: unknown[] = [];
      for (const x of held.each()) {
        out.push(x.json);
        if (out.length >= n) break;
      }
      return [held.isEnumerableCollection, out];
    };
    expect(take(['Intersection', 'Integers', ['Set', 2, 1]], 5)).toEqual([
      true,
      [2, 1],
    ]);
    expect(take(['Intersection', 'Integers', 'RealNumbers'], 3)).toEqual([
      true,
      [0, 1, -1],
    ]);
    expect(take(['SetMinus', 'Integers', ['Set', 0]], 3)).toEqual([
      true,
      [1, -1, 2],
    ]);
    expect(take(['SymmetricDifference', 'Integers', ['Set', 0.5]], 3)).toEqual([
      true,
      [0.5, 0, 1],
    ]);
    expect(take(['Intersection', ['List', 1, 1, 2], ['Set', 1, 2]], 5)).toEqual(
      [true, [1, 2]]
    );
  });
});

describe('Count OF A UNION WITH AN OPERAND THAT CANNOT BE WALKED ENDS', () => {
  test.each([
    [['Union', ['Intersection', 'Integers', ['Interval', 0, 3]], ['Set', 1]]],
    [['Union', ['SetMinus', 'Integers', 'Integers'], ['Set', 1]]],
  ])(
    'Count(%j) stays unevaluated',
    (json) => {
      const start = Date.now();
      expect(box(['Count', json]).evaluate().json).toEqual(['Count', json]);
      expect(Date.now() - start).toBeLessThan(5000);
    },
    10000
  );

  test('the parse route', () => {
    expect(
      ce.parse('|(\\mathbb{Z}\\cap[0,3])\\cup\\{1\\}|').evaluate().operator
    ).toBe('Count');
  }, 10000);
});

describe('Count OF A LARGE INTERSECTION', () => {
  test('a Range has no repeated element', () => {
    expect(
      box([
        'Count',
        ['Intersection', ['Range', 1, 100000], ['Range', 50001, 150000]],
      ]).evaluate().json
    ).toBe(50000);
  });
});

describe('COMPILED Abs OF AN OPERAND THAT CAN HOLD A SET OR A STRING', () => {
  const ce2 = new ComputeEngine();
  ce2.declare('z', 'any');
  ce2.declare('r', 'real');
  ce2.declare('S', 'set<integer>');

  test('an operand of type any is tested at run time', () => {
    const f = compile(ce2.box(['Abs', 'z']), { to: 'javascript' });
    expect(f.success).toBe(true);
    expect(f.code).toBe('_SYS.absAny(_.z)');
    expect(f.run!({ z: -3 })).toBe(3);
    expect(() => f.run!({ z: 'abc' })).toThrow(/a string/);
    expect(() => f.run!({ z: new Set([1, 2]) })).toThrow(/a set/);
    expect(() => f.run!({ z: [1, 2] })).toThrow(/a list/);
  });

  test('an operand of numeric type keeps Math.abs', () => {
    const f = compile(ce2.box(['Abs', 'r']), { to: 'javascript' });
    expect(f.code).toBe('Math.abs(_.r)');
    expect(f.run!({ r: -2 })).toBe(2);
  });

  test('an operand of set type compiles as its count', () => {
    const f = compile(ce2.box(['Abs', 'S']), { to: 'javascript' });
    expect(f.success).toBe(true);
    expect(f.run!({ S: [4, 5, 6] })).toBe(3);
    const g = compile(ce2.box(['Abs', ['Set', 1, 2]]), { to: 'javascript' });
    expect(g.run!({})).toBe(2);
  });
});

describe('\\# AS THE SYMBOL hash', () => {
  test.each([
    ['\\#+1', ['Add', 'hash', 1]],
    ['\\# + 1', ['Add', 'hash', 1]],
    ['\\#-1', ['Add', 'hash', -1]],
    ['\\#\\cdot 2', ['Multiply', 2, 'hash']],
    ['\\#\\le 3', ['LessEqual', 'hash', 3]],
    ['\\#_1', 'hash_1'],
    ['\\#^2', ['Power', 'hash', 2]],
  ])('%s', (latex, json) => {
    const ce2 = new ComputeEngine();
    expect(ce2.parse(latex).json).toEqual(json);
  });

  test('a use of \\# as a symbol does not change the meaning of \\#S', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('S', 'set<integer>');
    ce2.parse('\\#+1');
    expect(ce2.parse('\\#S').json).toEqual(['Count', 'S']);
  });

  test.each([
    [
      'declared as an integer',
      (c: ComputeEngine) => c.declare('hash', 'integer'),
    ],
    ['with a value', (c: ComputeEngine) => c.assign('hash', 5)],
  ])('when hash is %s, \\# is always the symbol', (_label, setup) => {
    const ce2 = new ComputeEngine();
    ce2.declare('S', 'set<integer>');
    setup(ce2);
    expect(ce2.parse('\\#+1').json).toEqual(['Add', 'hash', 1]);
    expect(JSON.stringify(ce2.parse('\\#S').json)).not.toContain('Count');
  });
});

describe('Count WHEN Abs IS NOT THE LIBRARY Abs', () => {
  test('Count of a set keeps the function spelling', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('Abs', {
      signature: '(any) -> any',
      evaluate: () => ce2.number(42),
    });
    const expr = ce2.box(['Count', ['Set', 1, 2]]);
    expect(expr.latex).toBe('\\mathrm{Count}(\\lbrace1, 2\\rbrace)');
    expect(ce2.parse(expr.latex).json).toEqual(['Count', ['Set', 1, 2]]);
  });

  test.each([
    ['a function parameter Abs', ['Function', ['Count', ['Set', 1, 2]], 'Abs']],
    [
      'an assignment of Abs',
      [
        'Block',
        ['Assign', 'Abs', ['Function', 0, 'x']],
        ['Count', ['Set', 1, 2]],
      ],
    ],
  ])('inside an expression that binds %s', (_label, json) => {
    const ce2 = new ComputeEngine();
    const expr = ce2.box(json as Expression);
    expect(expr.latex).toContain('\\mathrm{Count}(\\lbrace1, 2\\rbrace)');
    expect(JSON.stringify(ce2.parse(expr.latex).json)).toContain(
      '["Count",["Set",1,2]]'
    );
  });

  test('an expression that binds another name keeps the bars', () => {
    const expr = ce.box(['Function', ['Count', ['Set', 1, 2]], 'y']);
    expect(expr.latex).toBe('y\\mapsto\\vert\\lbrace1, 2\\rbrace\\vert');
  });
});

describe('AN EMPTY OPERAND DECIDES BEFORE AN OPERAND WITH NO VALUE', () => {
  test.each([
    ['Intersection(A, EmptySet)', ['Intersection', 'A', 'EmptySet']],
    ['Intersection(EmptySet, A)', ['Intersection', 'EmptySet', 'A']],
    ['Intersection(A, {})', ['Intersection', 'A', ['Set']]],
    ['SetMinus(EmptySet, A)', ['SetMinus', 'EmptySet', 'A']],
    ['Complement(EmptySet, A)', ['Complement', 'EmptySet', 'A']],
  ])('%s', (_label, json) => {
    const [name, ...ops] = json as [string, ...unknown[]];
    const held = ce._fn(
      name,
      ops.map((x) => box(x))
    );
    expect(held.count).toBe(0);
    expect(held.isEmptyCollection).toBe(true);
    expect(held.isEnumerableCollection).toBe(true);
    expect(box(['Count', json]).evaluate().json).toBe(0);
  });

  test('the evaluated result is EmptySet', () => {
    expect(box(['Intersection', 'A', 'EmptySet']).evaluate().json).toBe(
      'EmptySet'
    );
    expect(box(['SetMinus', 'EmptySet', 'A']).evaluate().json).toBe('EmptySet');
  });
});

describe('EPSIL', () => {
  test('abs of a set literal is the number of its elements', () => {
    const ce2 = new ComputeEngine();
    expect(executeEpsil(ce2, 'abs({1, 2, 3})').value.json).toBe(3);
    expect(executeEpsil(ce2, 'abs([-1, 2])').value.json).toEqual([
      'List',
      1,
      2,
    ]);
  });
});

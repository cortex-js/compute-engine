import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * Absent values (`Missing`, `Undefined`, a restriction `e{c}` whose
 * condition is false) under broadcasts, reducers and `Map`.
 *
 * The rule, from `docs/ERROR-MODEL.md`: an absent operand in a numeric slot
 * answers the absence marker of the application's codomain — `NaN` when the
 * application's type is numeric, `Missing` otherwise (a point, a list, a
 * type that is not provably numeric). A list supplies cells, so an absence
 * that lands in a numeric cell is `NaN` in that cell; a point is atomic, so
 * an absent point stays `Missing` as a whole.
 */

const ce = new ComputeEngine();

const MASKED = String.raw`[10,20,30]\left\{[1,2,3]>2\right\}`;

describe('a broadcast over a list restricted by a list of conditions', () => {
  // `[10,20,30]{[1,2,3] > 2}` is `[Missing, Missing, 30]` (ruling of
  // 2026-09-09). A numeric function of it is computed cell by cell, and a
  // masked numeric cell is `NaN`, as `sin(10{False})` and
  // `sin([Missing, Missing, 30])` are. Before the fix, the lazy view of the
  // restriction re-applied the WHOLE mask to each element, and the broadcast
  // answered a 3×3 matrix.
  test('the masked list itself', () => {
    const e = ce.parse(MASKED);
    // Masked numeric cells are `NaN` (user decision 2026-09-25); they were
    // `Missing`, and the list was typed `list<integer | missing>`.
    expect(e.evaluate().toString()).toBe('[NaN,NaN,30]');
    expect(e.type.toString()).toBe('list<number>');
  });

  test.each([
    [String.raw`\sin(${MASKED})`, '[NaN,NaN,sin(30)]'],
    [String.raw`2\cdot${MASKED}`, '[NaN,NaN,60]'],
    [String.raw`${MASKED}+1`, '[NaN,NaN,31]'],
  ])('%s', (latex, expected) => {
    const e = ce.parse(latex);
    expect(e.evaluate().toString()).toBe(expected);
    // The static type is a list of numbers: every cell is a number or `NaN`.
    expect(e.type.toString()).toBe('list<number>');
  });

  test('the box route and the parse route agree', () => {
    const boxed = ce.box([
      'Sin',
      ['If', ['Less', 2, ['List', 1, 2, 3]], ['List', 10, 20, 30]],
    ]);
    expect(boxed.evaluate().toString()).toBe('[NaN,NaN,sin(30)]');
    expect(boxed.evaluate().toString()).toBe(
      ce
        .parse(String.raw`\sin(${MASKED})`)
        .evaluate()
        .toString()
    );
    // A selection with no match gives the absent value of the domain of the
    // position, `NaN` for a number. A written `Missing` cell is not a
    // selection: `Sin(Missing)` is `Missing`.
    expect(
      ce
        .box(['Sin', ['List', 'Missing', 'Missing', 30]])
        .evaluate()
        .toString()
    ).toBe('["Missing","Missing",sin(30)]');
  });

  test('the held restriction presents its zipped cells', () => {
    const w = ce.box([
      'If',
      ['Less', 2, ['List', 1, 2, 3]],
      ['List', 10, 20, 30],
    ]);
    expect(w.operator).toBe('If');
    expect(w.isCollection).toBe(true);
    expect(w.count).toBe(3);
    expect(w.at(1)?.toString()).toBe('If("False", 10)');
    expect(w.at(3)?.toString()).toBe('If("True", 30)');
    expect(Array.from(w.each()).map((x) => x.toString())).toEqual([
      'If("False", 10)',
      'If("False", 20)',
      'If("True", 30)',
    ]);
  });

  test('a scalar condition still restricts every element', () => {
    const c = new ComputeEngine();
    c.declare('b', 'boolean');
    const w = c.box(['If', 'b', ['List', 10, 20]]);
    expect(Array.from(w.each()).map((x) => x.toString())).toEqual([
      'If(b, 10)',
      'If(b, 20)',
    ]);
  });

  test.each([
    [String.raw`\sin(${MASKED})`, [NaN, NaN, Math.sin(30)]],
    [String.raw`2\cdot${MASKED}`, [NaN, NaN, 60]],
  ])('compiled to JavaScript: %s', (latex, expected) => {
    const r = compile(ce.parse(latex), { to: 'javascript' });
    expect(r.success).toBe(true);
    const v = r.run!({}) as number[];
    expect(v).toHaveLength(3);
    v.forEach((x, i) =>
      Number.isNaN(expected[i])
        ? expect(x).toBeNaN()
        : expect(x).toBeCloseTo(expected[i], 12)
    );
  });
});

describe('an absent scalar broadcast into a numeric list', () => {
  // An operator over `Missing` gives `Missing`, so every cell of an absent
  // scalar combined with the list is `Missing`. Before a fix, `Multiply`
  // scaled the cells one by one, and the cell `Missing · 1` folded its
  // identity factor away: the cells did not agree.
  test.each([
    ['Multiply', ['Multiply', 'Missing', ['List', 1, 2, 3]]],
    ['Multiply, list first', ['Multiply', ['List', 1, 2, 3], 'Missing']],
    ['Add', ['Add', 'Missing', ['List', 1, 2, 3]]],
    ['Add, a zero cell', ['Add', 'Missing', ['List', 0, 1, 2]]],
    ['Subtract', ['Subtract', ['List', 1, 2, 3], 'Missing']],
    ['Subtract, reversed', ['Subtract', 'Missing', ['List', 1, 2, 3]]],
    ['Divide', ['Divide', ['List', 1, 2, 3], 'Missing']],
    ['Divide, reversed', ['Divide', 'Missing', ['List', 1, 2, 3]]],
    ['Power', ['Power', 'Missing', ['List', 1, 2, 3]]],
    ['Power, reversed', ['Power', ['List', 1, 2, 3], 'Missing']],
  ])('%s', (_, json) => {
    expect(
      ce
        .box(json as never)
        .evaluate()
        .toString()
    ).toBe('["Missing","Missing","Missing"]');
  });

  test('numeric evaluation agrees', () => {
    expect(
      ce
        .box(['Multiply', 'Missing', ['List', 1, 2, 3]])
        .N()
        .toString()
    ).toBe('["Missing","Missing","Missing"]');
  });

  test('a matrix', () => {
    expect(
      ce
        .box(['Multiply', 'Missing', ['List', ['List', 1, 2], ['List', 3, 1]]])
        .evaluate()
        .toString()
    ).toBe('[["Missing","Missing"],["Missing","Missing"]]');
  });
});

describe('Norm of an absent operand', () => {
  // An operator over `Missing` gives `Missing`: `Abs` of an absent point and
  // `Norm` with an absent operand or cell are `Missing`. Before a fix, `Norm(Missing)` was an
  // `incompatible-type` error at boxing, so `Norm(P{c})` failed when the
  // point was absent.
  const c = new ComputeEngine();
  c.declare('c', 'boolean');
  c.assign('c', false);

  test.each([
    ['Norm(Missing)', ['Norm', 'Missing']],
    ['Abs of an absent point', ['Abs', ['Tuple', 2, 'Missing']]],
    ['a vector with an absent cell', ['Norm', ['List', 1, 'Missing']]],
    ['the L1 norm', ['Norm', ['List', 1, 'Missing'], 1]],
    ['the L-infinity norm', ['Norm', ['List', 1, 'Missing'], "'Infinity'"]],
    ['a point with an absent coordinate', ['Norm', ['Tuple', 1, 'Missing']]],
    // A `Missing` cell types its row `list<integer | missing>`, which is not
    // a tensor type, so a matrix that holds one stayed unevaluated.
    [
      'a matrix with an absent cell',
      ['Norm', ['List', ['List', 1, 2], ['List', 3, 'Missing']]],
    ],
    [
      'the L1 norm of a matrix',
      ['Norm', ['List', ['List', 1, 2], ['List', 3, 'Missing']], 1],
    ],
    [
      'the L-infinity norm of a matrix',
      ['Norm', ['List', ['List', 1, 2], ['List', 3, 'Missing']], "'Infinity'"],
    ],
  ])('%s is Missing', (_, json) => {
    const e = c.box(json as never);
    expect(e.isValid).toBe(true);
    expect(e.evaluate().toString()).toBe('"Missing"');
  });

  // A false restriction of a point is the point of `NaN` coordinates (user
  // decision 2026-11-03), whose norm is `NaN`.
  test.each([
    [
      'Norm of a false restricted point',
      ['Norm', ['If', 'c', ['Tuple', 2, 3]]],
    ],
    [
      'Abs of a false restricted point',
      ['Abs', ['If', 'c', ['Tuple', 2, 3]]],
    ],
  ])('%s is NaN', (_, json) => {
    const e = c.box(json as never);
    expect(e.isValid).toBe(true);
    expect(e.evaluate().toString()).toBe('NaN');
  });

  test('a present point is unchanged', () => {
    c.assign('c', true);
    expect(
      c
        .box(['Norm', ['If', 'c', ['Tuple', 3, 4]]])
        .evaluate()
        .toString()
    ).toBe('5');
    c.assign('c', false);
  });

  test('an absent matrix cell does not hide a wrong-kind cell or an unsupported order', () => {
    // The same precedence as a vector: a cell that is not a number is an
    // `incompatible-type` error, and an order the matrix norms do not
    // compute leaves the application unevaluated.
    const withBoolean = c
      .box(['Norm', ['List', ['List', 1, 'True'], ['List', 3, 'Missing']]])
      .evaluate();
    expect(withBoolean.operator).toBe('Error');
    expect(
      c
        .box(['Norm', ['List', ['List', 1, 2], ['List', 3, 'Missing']], 3])
        .evaluate().operator
    ).toBe('Norm');
    // Rows of different lengths are not a matrix.
    expect(
      c.box(['Norm', ['List', ['List', 1], ['List', 3, 'Missing']]]).evaluate()
        .operator
    ).toBe('Norm');
  });

  test('text beside an absent cell is a wrong-kind error at rank 1 and 2', () => {
    // A string is a collection of characters, so it made the list look like
    // neither a vector nor a matrix, and the application stayed
    // unevaluated.
    for (const json of [
      ['Norm', ['List', 3, "'a'", 'Missing']],
      ['Norm', ['List', ['List', 1, "'a'"], ['List', 3, 'Missing']]],
    ])
      expect(c.box(json as never).evaluate().operator).toBe('Error');
  });

  test('an absent ORDER is still refused', () => {
    expect(c.box(['Norm', ['List', 3, 4], 'Missing']).isValid).toBe(false);
  });
});

describe('Map over a list that holds a restricted point', () => {
  // The `Map` is typed from the ELEMENT (`missing | tuple<…>`), so the cell
  // of an absent point must be `Missing`, as `sin(P{c})` is. The mapping
  // function's parameter is typed from the literal (`unknown`), so its body
  // `Sin(x)` types `number` and answered `NaN`, which is neither a point nor
  // `Missing`.
  const c = new ComputeEngine();
  c.declare('c', 'boolean');
  c.assign('c', false);
  const sinFn = ['Function', ['Sin', 'x'], 'x'];

  test('the false restricted point maps to a NaN point', () => {
    const m = c.box([
      'Map',
      sinFn,
      ['List', ['If', 'c', ['Tuple', 2, 3]], ['Tuple', 2, 3]],
    ] as never);
    expect(m.type.toString()).toBe('list<tuple<number, number>^2>');
    expect(m.evaluate().toString()).toBe('[(NaN, NaN),(sin(2), sin(3))]');
    // Same answer as applying `Sin` to the restricted point directly: a
    // false restriction of a point is the point of `NaN` coordinates (user
    // decision 2026-11-03).
    expect(
      c
        .box(['Sin', ['If', 'c', ['Tuple', 2, 3]]])
        .evaluate()
        .toString()
    ).toBe('(NaN, NaN)');
  });

  test('a scalar product keeps the NaN point', () => {
    const m = c.box([
      'Map',
      ['Function', ['Multiply', 2, 'x'], 'x'],
      ['List', ['If', 'c', ['Tuple', 2, 3]], ['Tuple', 2, 3]],
    ] as never);
    expect(m.evaluate().toString()).toBe('[(NaN, NaN),(4, 6)]');
  });

  test('a numeric cell is still NaN', () => {
    const m = c.box(['Map', sinFn, ['List', ['If', 'c', 2], 3]] as never);
    expect(m.type.toString()).toBe('vector<real^2>');
    expect(m.evaluate().toString()).toBe('[NaN,sin(3)]');
  });
});

describe('a numeric function of a value that can be a list or absent', () => {
  // `PointX(V)` of a `V` that can be a point, a list of points, or a list
  // of numbers is typed `list<number> | number | tuple<…>`. The tuple arm of
  // the operand's type is carried through as a point squared component-wise
  // (the arm-by-arm typing of a union with a tuple arm beside a list of
  // numbers, `armwiseUnionBroadcastResultType`); it was dropped before. When
  // `V` holds `Missing`, `PointX(V)^2` is `Missing`.
  const PT =
    'indexed_collection<number | tuple<number, number>> | list<tuple<number, number>> | tuple<number, number>';

  test('a declared absence arm is an error; a stored Missing gives Missing', () => {
    const c = new ComputeEngine();
    // A declared type cannot name `missing` (`Missing` is a result only),
    // but a store into a declared name accepts `Missing`.
    expect(() => c.declare('V', `${PT} | missing`)).toThrow(
      /cannot be declared/
    );
    c.declare('V', PT);
    const p = c.box(['Power', ['PointX', 'V'], 2]);
    expect(p.type.toString()).toBe(
      'list<number> | number | tuple<number, number>'
    );
    c.assign('V', c.box('Missing'));
    expect(p.evaluate().toString()).toBe('"Missing"');
    c.assign('V', c.box(['Tuple', 3, 4]));
    expect(p.evaluate().toString()).toBe('9');
  });

  test('a numeric result still absorbs the absence into NaN', () => {
    const c = new ComputeEngine();
    c.declare('b', 'boolean');
    const e = c.box(['Sin', ['If', 'b', 2]]);
    expect(e.type.toString()).toBe('real');
    c.assign('b', false);
    expect(e.evaluate().toString()).toBe('NaN');
  });
});

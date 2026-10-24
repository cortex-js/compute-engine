import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { typeHandlerContext } from '../../src/compute-engine/boxed-expression/derive-application-type';
import {
  describeBoundSymbol,
  describeType,
} from '../../src/compute-engine/boxed-expression/operand-descriptor';
import { parseType } from '../../src/common/type/parse';
import { typeToString } from '../../src/common/type/serialize';

//
// Broadcast result types over nested lists. No case has an absent cell,
// except where it says so.
//
// Each case declares `L`, reads the static type of the expression, assigns a
// value to `L`, and checks that the type of the evaluated value is a subtype
// of the static type. The box route is checked, and the parse route when the
// case can be written in LaTeX.
//

function check(
  decl: string,
  value: unknown,
  build: (ce: ComputeEngine) => Expression
): { staticType: string; value: string; sound: boolean } {
  const ce = new ComputeEngine();
  ce.declare('L', decl);
  const staticType = build(ce).type.toString();
  ce.assign('L', ce.box(value as any));
  const v = build(ce).evaluate();
  return {
    staticType,
    value: v.toString(),
    sound: v.type.matches(ce.type(staticType)),
  };
}

//
// A list of lists does not promise rows of one length. `Sin` of the uneven
// rows `[[1, 2], [3]]` is `[[Sin(1), Sin(2)], [Sin(3)]]`: a list of lists,
// which is not a matrix. Before, `Sin(L)` and `Sqrt(L)` were typed `matrix`.
//
describe('UNEVEN ROWS ARE NOT A MATRIX', () => {
  const UNEVEN = ['List', ['List', 1, 2], ['List', 3]];
  test.each<[string, unknown, string]>([
    ['Sin(L)', ['Sin', 'L'], '\\sin(L)'],
    ['Sqrt(L)', ['Sqrt', 'L'], '\\sqrt{L}'],
    ['Exp(L)', ['Exp', 'L'], '\\exp(L)'],
  ])('%s', (_, expr, latex) => {
    for (const build of [
      (ce: ComputeEngine) => ce.box(expr as any),
      (ce: ComputeEngine) => ce.parse(latex),
    ]) {
      const r = check('list<list<integer>>', UNEVEN, build);
      expect(r.staticType).toBe('list<list<number>>');
      expect(r.sound).toBe(true);
    }
  });

  // Precision: rows of a fixed length, and a declared matrix, keep the
  // dimensioned form.
  test.each<[string, unknown, string]>([
    [
      'list<vector<3>>',
      ['List', ['List', 1, 2, 3], ['List', 4, 5, 6]],
      'matrix<?x3>',
    ],
    ['matrix', ['List', ['List', 1, 2]], 'matrix'],
  ])('%s keeps its dimensions', (decl, value, type) => {
    const r = check(decl, value, (ce) => ce.box(['Sin', 'L']));
    expect(r.staticType).toBe(type);
    expect(r.sound).toBe(true);
  });

  // A literal with rows of different lengths is typed with a union of rows
  // (`list<vector<integer^1> | vector<integer^2>>`). Its rank is that of
  // its rows. Before, `Sin([[1, 2], [3]])` was typed `list<number>`.
  test.each<[string, unknown, string, string]>([
    [
      'Sin',
      ['Sin', ['List', ['List', 1, 2], ['List', 3]]],
      '\\sin([[1,2],[3]])',
      'list<list<number>>',
    ],
    [
      'Sqrt',
      ['Sqrt', ['List', ['List', 1, 4], ['List', 9]]],
      '\\sqrt{[[1,4],[9]]}',
      'list<list<number>>',
    ],
    [
      'Sin, rows of uneven rows',
      [
        'Sin',
        ['List', ['List', ['List', 1], ['List', 2, 3]], ['List', ['List', 4]]],
      ],
      '\\sin([[[1],[2,3]],[[4]]])',
      'list<list<list<number>>>',
    ],
  ])('a literal with uneven rows: %s', (_, json, latex, type) => {
    const ce = new ComputeEngine();
    for (const e of [ce.box(json as any), ce.parse(latex)]) {
      expect(e.type.toString()).toBe(type);
      expect(e.evaluate().type.matches(e.type)).toBe(true);
    }
  });
});

//
// `L^2` over a list of lists is the matrix power when the value is a square
// matrix, and the element-wise square when the rows have different lengths.
// The static type holds both. For a rectangular value that is not square,
// the value is an `expected-square-matrix` error: by `docs/ERROR-MODEL.md`
// §4, an error is an effect of the evaluation and is not a member of any
// result type, so the type describes the successful values only.
//
describe('A POWER OF A LIST OF LISTS', () => {
  test.each<[string, unknown, string]>([
    [
      'a square matrix',
      ['List', ['List', 1, 2], ['List', 3, 4]],
      '[[7,10],[15,22]]',
    ],
    ['uneven rows', ['List', ['List', 1, 2], ['List', 3]], '[[1,4],[9]]'],
  ])('%s', (_, value, evaluated) => {
    for (const build of [
      (ce: ComputeEngine) => ce.box(['Power', 'L', 2]),
      (ce: ComputeEngine) => ce.parse('L^2'),
    ]) {
      const r = check('list<list<integer>>', value, build);
      expect(r.staticType).toBe('list<list<number>>');
      expect(r.value).toBe(evaluated);
      expect(r.sound).toBe(true);
    }
  });

  test('a rectangular value that is not square is an error', () => {
    const r = check('list<list<integer>>', ['List', ['List', 1, 2]], (ce) =>
      ce.box(['Power', 'L', 2])
    );
    expect(r.value).toBe('Error("expected-square-matrix", "[[1,2]]")');
  });
});

//
// `Abs` over a list of integers is typed `list<integer<0..>>`: the cell type
// keeps the integer tier of the operand and has no infinite arm, since no
// integer is infinite. Each element of the value `[1, 2]` is a member of the
// cell type. The type of the value as a whole, `vector<integer^2>`, is not a
// subtype of it, because the type of a list literal widens each element to
// its numeric tier (`integer`) and drops its sign. So the check here is
// element-wise.
//
describe('ABS OVER A LIST OF INTEGERS', () => {
  test.each<[string, (ce: ComputeEngine) => Expression]>([
    ['box', (ce) => ce.box(['Abs', 'L'])],
    ['parse', (ce) => ce.parse('|L|')],
  ])('%s', (_, build) => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<integer>');
    expect(build(ce).type.toString()).toBe('list<integer<0..>>');
    ce.assign('L', ce.box(['List', 1, -2]));
    const v = build(ce).evaluate();
    expect(v.toString()).toBe('[1,2]');
    const cell = ce.type('integer<0..>');
    expect([...v.each()].every((x) => x.type.matches(cell))).toBe(true);
  });
});

//
// A list of rows of points plus a number is refused at boxing, as a flat
// list of points plus a number is: the sum applies to each point, and a
// point plus a number has no value. Before, a valueless
// `L: list<list<tuple<integer, integer>>>` gave `L + 0.5` the type
// `list<list<tuple<real, real>>>`, and its value was an `incompatible-type`
// error.
//
describe('A LIST OF ROWS OF POINTS PLUS A NUMBER IS AN ERROR', () => {
  const ERROR =
    'Error(ErrorCode("incompatible-type", "list<tuple>", "number"))';
  test.each<[string, string, unknown]>([
    ['list<tuple<integer, integer>>', 'flat', ['List', ['Tuple', 1, 2]]],
    [
      'list<list<tuple<integer, integer>>>',
      'nested',
      ['List', ['List', ['Tuple', 1, 2]]],
    ],
    [
      'list<list<list<tuple<integer, integer>>>>',
      'nested twice',
      ['List', ['List', ['List', ['Tuple', 1, 2]]]],
    ],
  ])('%s (%s)', (decl, _, value) => {
    for (const [expr, latex] of [
      [['Add', 'L', 0.5], 'L+0.5'],
      [['Subtract', 'L', 1], 'L-1'],
    ] as const) {
      for (const build of [
        (ce: ComputeEngine) => ce.box(expr as any),
        (ce: ComputeEngine) => ce.parse(latex),
      ]) {
        const r = check(decl, value, build);
        expect(r.staticType).toBe('error');
        expect(r.value).toBe(ERROR);
      }
    }
  });

  test('a literal with rows of different lengths', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'Add',
      [
        'List',
        ['List', ['Tuple', 1, 2]],
        ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
      ],
      0.5,
    ]);
    expect(e.type.toString()).toBe('error');
    expect(e.evaluate().toString()).toBe(ERROR);
  });

  test('a scalar factor still scales each point', () => {
    const r = check(
      'list<list<tuple<integer, integer>>>',
      ['List', ['List', ['Tuple', 1, 2]]],
      (ce) => ce.box(['Multiply', 0.5, 'L'])
    );
    expect(r.staticType).toBe('list<list<tuple<real, real>>>');
    expect(r.value).toBe('[[(0.5, 1)]]');
    expect(r.sound).toBe(true);
  });
});

//
// The descriptor route (`context.derive`, which a type handler calls to type
// an application from its operand types). `Subtract` is typed by the `Add`
// handler over the negated terms, which computes the collection type itself;
// it was wrapped in one more list (`matrix<list<integer>>`). A quotient of a
// list of rows of points divides each point; it was typed `matrix`, a type
// with number cells.
//
describe('THE DERIVE ROUTE OVER NESTED LISTS', () => {
  test.each<[string, string, unknown[], unknown, string]>([
    [
      'a difference of a list of rows',
      'list<list<integer>>',
      ['Subtract', 'L', 1],
      ['List', ['List', 1, 2]],
      'list<list<integer>>',
    ],
    [
      'a quotient of a list of rows of points',
      'list<list<tuple<integer, integer>>>',
      ['Divide', 'L', 2],
      ['List', ['List', ['Tuple', 1, 2]]],
      // The divisor is described by the type `integer` only (see below), so
      // it may be zero: `1/0` is `~oo` and `0/0` is `NaN`.
      'list<list<tuple<infinity | nan | real, infinity | nan | real>>>',
    ],
    [
      'a quotient of uneven rows',
      'list<list<integer>>',
      ['Divide', 'L', 2],
      ['List', ['List', 1, 2], ['List', 3]],
      'list<list<number>>',
    ],
    [
      'a quotient of rows of points with an absent row',
      'list<list<tuple<integer, integer>> | missing>',
      ['Divide', 'L', 2],
      ['List', ['List', ['Tuple', 1, 2]], 'Missing'],
      'list<list<missing | tuple<number, number>> | missing>',
    ],
  ])('%s', (_, decl, expr, value, type) => {
    const ce = new ComputeEngine();
    const ctx = typeHandlerContext(ce as any);
    const [operator, ...args] = expr as [string, ...unknown[]];
    const derived = ctx.derive(
      operator,
      args.map((x) =>
        x === 'L'
          ? describeBoundSymbol(parseType(decl)!, '__L')
          : describeType(parseType('integer')!)
      )
    );
    expect(derived).toBeDefined();
    expect(typeToString(derived!)).toBe(type);
    ce.declare('L', decl);
    ce.assign('L', ce.box(value as any));
    const v = ce.box(expr as any).evaluate();
    expect(v.type.matches(ce.type(derived!))).toBe(true);
  });

  // The box route keeps a quotient by a symbol as `Divide` (a quotient by a
  // literal becomes a product), and types it with the same handler.
  test.each<[string, unknown, string]>([
    [
      'list<list<tuple<integer, integer>>>',
      [
        'List',
        ['List', ['Tuple', 1, 2]],
        ['List', ['Tuple', 3, 4], ['Tuple', 5, 6]],
      ],
      // `x: integer` may be zero.
      'list<list<tuple<infinity | nan | real, infinity | nan | real>>>',
    ],
    [
      'list<list<tuple<integer, integer>> | missing>',
      ['List', ['List', ['Tuple', 1, 2]], 'Missing'],
      'list<list<missing | tuple<number, number>> | missing>',
    ],
  ])('%s divided by a symbol (box)', (decl, value, type) => {
    const ce = new ComputeEngine();
    ce.declare('L', decl);
    ce.declare('x', 'integer');
    const e = ce.box(['Divide', 'L', 'x']);
    expect(e.type.toString()).toBe(type);
    ce.assign('L', ce.box(value as any));
    ce.assign('x', 2);
    const v = ce.box(['Divide', 'L', 'x']).evaluate();
    expect(v.type.matches(ce.type(type))).toBe(true);
  });

  // A list of rows of points divided by a collection of numbers: each point
  // is divided by one number, so the cells of the result are points. Before,
  // the quotient by a matrix and by a list of numbers was typed with number
  // cells (`list<list<number>>`, `list<number>`), and the quotient by a list
  // of rows one level too deep.
  test.each<[string, unknown, string]>([
    [
      'matrix',
      ['List', ['List', 1, 2], ['List', 3, 4]],
      'list<list<tuple<number, number>>>',
    ],
    [
      'list<list<integer>>',
      ['List', ['List', 1, 2], ['List', 3, 4]],
      'list<list<tuple<number, number>>>',
    ],
    ['list<integer>', ['List', 1, 2], 'list<list<tuple<number, number>>>'],
  ])('rows of points divided by a %s', (decl, value, type) => {
    const ce = new ComputeEngine();
    ce.declare('Q', 'list<list<tuple<integer, integer>>>');
    ce.declare('M', decl);
    expect(ce.box(['Divide', 'Q', 'M']).type.toString()).toBe(type);
    ce.assign(
      'Q',
      ce.box([
        'List',
        ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
        ['List', ['Tuple', 5, 6], ['Tuple', 7, 8]],
      ])
    );
    ce.assign('M', ce.box(value as any));
    const v = ce.box(['Divide', 'Q', 'M']).evaluate();
    expect(v.type.matches(ce.type(type))).toBe(true);
  });
});

//
// A head that maps over the components of a point (`Power`, `Mod`, …),
// applied to a list of rows of points and a collection of numbers of the
// same rank: each point is paired with one number, so each cell of the
// result is a point. Before, these were typed with number cells
// (`list<list<number>>`). The flat case was already right.
//
describe('ROWS OF POINTS BESIDE NUMBERS OF THE SAME RANK', () => {
  const NQ = [
    'List',
    ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
    ['List', ['Tuple', 5, 6], ['Tuple', 7, 8]],
  ];
  const CASES: [string, string][] = [];
  for (const op of [
    'Power',
    'Mod',
    'Log',
    'Round',
    'Root',
    'Remainder',
    'Arctan2',
  ])
    for (const decl of ['matrix<integer^(2x2)>', 'list<list<integer>>'])
      CASES.push([op, decl]);
  test.each(CASES)('%s with a %s', (op, decl) => {
    const ce = new ComputeEngine();
    ce.declare('Q', 'list<list<tuple<integer, integer>>>');
    ce.declare('M', decl);
    const staticType = ce.box([op, 'Q', 'M']).type;
    expect(staticType.toString()).toMatch(/^list<list<tuple<.*>>>$/);
    ce.assign('Q', ce.box(NQ as any));
    ce.assign('M', ce.box(['List', ['List', 1, 2], ['List', 3, 4]]));
    const v = ce.box([op, 'Q', 'M']).evaluate();
    expect(v.type.matches(staticType)).toBe(true);
  });

  test('the parse route of a power', () => {
    const ce = new ComputeEngine();
    ce.declare('Q', 'list<list<tuple<integer, integer>>>');
    ce.declare('M', 'matrix<integer^(2x2)>');
    const e = ce.parse('Q^M');
    expect(e.type.toString()).toBe('list<list<tuple<number, number>>>');
    ce.assign('Q', ce.box(NQ as any));
    ce.assign('M', ce.box(['List', ['List', 1, 2], ['List', 3, 4]]));
    const v = ce.parse('Q^M').evaluate();
    expect(v.toString()).toBe('[[(1, 2),(9, 16)],[(125, 216),(2401, 4096)]]');
    expect(v.type.matches(e.type)).toBe(true);
  });
});

//
// Operands of different ranks. Rows of points beside a list of numbers: each
// row is paired with one number, so each cell of the result is a point. A
// list of points beside a deeper collection of numbers: each point is paired
// with a row of numbers, and a head that maps over the components of a
// point maps each component over that row, so the cells are numbers. Before,
// `Power(NQ, V)` was typed `list<number>`, and `Power(Q, M)` with
// `M: list<list<integer>>` was typed `list<tuple<number, number>>`.
//
describe('POINTS BESIDE NUMBERS OF ANOTHER RANK', () => {
  const NQ = [
    'List',
    ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
    ['List', ['Tuple', 5, 6], ['Tuple', 7, 8]],
  ];
  const Q = ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]];
  const M = ['List', ['List', 1, 2], ['List', 3, 4]];
  const CASES: [string, string, unknown, string, unknown, RegExp][] = [];
  for (const op of ['Power', 'Mod', 'Root', 'Arctan2', 'Divide']) {
    CASES.push([
      op,
      'list<list<tuple<integer, integer>>>',
      NQ,
      'list<integer>',
      ['List', 2, 3],
      /^list<list<tuple<.*>>>$/,
    ]);
    if (op !== 'Divide') {
      CASES.push([
        op,
        'list<tuple<integer, integer>>',
        Q,
        'list<list<integer>>',
        M,
        /^list<list<[^t]*>>$/,
      ]);
      CASES.push([
        op,
        'list<tuple<integer, integer>>',
        Q,
        'matrix<integer^(2x2)>',
        M,
        /^list<list<[^t]*>>$/,
      ]);
    }
  }
  test.each(CASES)('%s of a %s and a %s', (op, dq, vq, dm, vm, type) => {
    const ce = new ComputeEngine();
    ce.declare('Q', dq);
    ce.declare('M', dm);
    const staticType = ce.box([op, 'Q', 'M']).type;
    expect(staticType.toString()).toMatch(type);
    ce.assign('Q', ce.box(vq as any));
    ce.assign('M', ce.box(vm as any));
    const v = ce.box([op, 'Q', 'M']).evaluate();
    expect(v.type.matches(staticType)).toBe(true);
  });
});

//
// The collection of numbers can hold an absent cell. An absent number beside
// a point gives a point of `NaN` coordinates, which the point type holds.
// Before, `Power(NQ, Vm)` and `Power(Q, Mm)` were typed `list<number>`: the
// rank of a list of `integer | missing` was not read.
//
describe('POINTS BESIDE NUMBERS WITH AN ABSENT CELL', () => {
  const NQ = [
    'List',
    ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
    ['List', ['Tuple', 5, 6], ['Tuple', 7, 8]],
  ];
  const Q = ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]];
  const CASES: [string, string, unknown, string, unknown, string][] = [];
  for (const op of ['Power', 'Mod', 'Root', 'Divide']) {
    CASES.push([
      op,
      'list<list<tuple<integer, integer>>>',
      NQ,
      'list<integer | missing>',
      ['List', 2, 'Missing'],
      'list<list<missing | tuple<number, number>>>',
    ]);
    CASES.push([
      op,
      'list<tuple<integer, integer>>',
      Q,
      'list<list<integer | missing>>',
      ['List', ['List', 1, 'Missing'], ['List', 3, 4]],
      op === 'Divide'
        ? 'list<list<missing | tuple<number, number>>>'
        : 'list<list<number>>',
    ]);
  }
  test.each(CASES)('%s of a %s and a %s', (op, dq, vq, dm, vm, type) => {
    const ce = new ComputeEngine();
    ce.declare('Q', dq);
    ce.declare('M', dm);
    const staticType = ce.box([op, 'Q', 'M']).type;
    expect(staticType.toString()).toBe(type);
    ce.assign('Q', ce.box(vq as any));
    ce.assign('M', ce.box(vm as any));
    const v = ce.box([op, 'Q', 'M']).evaluate();
    expect(v.type.matches(staticType)).toBe(true);
  });
});

//
// A list of rows of points divided by a collection of numbers whose cells
// may be zero: a point divided by a zero cell is `(~oo, ~oo)`, so the
// coordinates of the result may be infinite or `NaN`. Before, the points of
// such a quotient were typed with rational coordinates. A flat list of
// points divided by a matrix already had this.
//
// Not covered: a point divided by a SCALAR `integer` keeps rational
// coordinates (the possibly-zero convention of the `Divide` handler for a
// scalar divisor, locked by `derive-application-type.test.ts`), and so does
// a flat list of points divided by a `list<integer>`.
//
describe('POINTS DIVIDED BY A COLLECTION WITH A CELL THAT MAY BE ZERO', () => {
  test.each<[string, unknown, string, unknown]>([
    [
      'list<tuple<integer, integer>>',
      ['List', ['Tuple', 1, 2]],
      'matrix<integer^(1x1)>',
      ['List', ['List', 0]],
    ],
    [
      'list<list<tuple<integer, integer>>>',
      ['List', ['List', ['Tuple', 1, 2]]],
      'matrix<integer>',
      ['List', ['List', 0]],
    ],
    [
      'list<list<tuple<integer, integer>>>',
      ['List', ['List', ['Tuple', 1, 2]]],
      'list<list<integer>>',
      ['List', ['List', 0]],
    ],
    [
      'list<list<tuple<integer, integer>>>',
      ['List', ['List', ['Tuple', 1, 2]]],
      'list<integer>',
      ['List', 0],
    ],
  ])('%s divided by a %s', (dq, vq, dm, vm) => {
    const ce = new ComputeEngine();
    ce.declare('Q', dq);
    ce.declare('M', dm);
    const staticType = ce.box(['Divide', 'Q', 'M']).type;
    ce.assign('Q', ce.box(vq as any));
    ce.assign('M', ce.box(vm as any));
    const v = ce.box(['Divide', 'Q', 'M']).evaluate();
    expect(v.toString()).toContain('(~oo, ~oo)');
    expect(v.type.matches(staticType)).toBe(true);
  });

  test('cells that are not zero keep rational coordinates', () => {
    const ce = new ComputeEngine();
    ce.declare('Q', 'list<list<tuple<integer, integer>>>');
    ce.declare('M', 'list<list<integer<1..>>>');
    expect(ce.box(['Divide', 'Q', 'M']).type.toString()).toBe(
      'list<list<tuple<rational, rational>>>'
    );
  });
});

//
// A product of two lists of rows of points of different dimensions reports
// the mismatch: the rows of the literal have one point type, read once.
//
describe('A PRODUCT OF ROWS OF POINTS OF DIFFERENT DIMENSIONS', () => {
  test('the diagnostic names the dimensions', () => {
    const ce = new ComputeEngine();
    const rows = (...points: unknown[][]) => [
      'List',
      ['List', ...points.slice(0, 2)],
      ['List', points[2]],
    ];
    const e = ce.box([
      'Multiply',
      rows(['Tuple', 1, 2, 3], ['Tuple', 4, 5, 6], ['Tuple', 7, 8, 9]),
      rows(['Tuple', 1, 2], ['Tuple', 3, 4], ['Tuple', 5, 6]),
    ] as any);
    expect(e.toString()).toBe(
      'Error(ErrorCode("no-product-between-points", "dimension-mismatch", "these points have different dimensions (3 and 2)"))'
    );
  });
});

//
// `Map` over a list whose cells are rows of points or absent: the static
// type holds the value (measured, no change needed). An absent row stays
// `Missing`.
//
describe('MAP OVER ROWS OF POINTS WITH AN ABSENT ROW', () => {
  test.each<[unknown, string, string]>([
    [
      ['Function', ['Multiply', 2, 'x'], 'x'],
      'list<list<tuple<integer, integer>> | missing>',
      '[[(2, 4)],"Missing"]',
    ],
    [
      ['Function', ['Sin', 'x'], 'x'],
      'list<list<tuple<number, number>> | missing>',
      '[[(sin(1), sin(2))],"Missing"]',
    ],
    [
      ['Function', 'x', 'x'],
      'list<list<tuple<integer, integer>> | missing>',
      '[[(1, 2)],"Missing"]',
    ],
  ])('%j', (fn, type, evaluated) => {
    const r = check(
      'list<list<tuple<integer, integer>> | missing>',
      ['List', ['List', ['Tuple', 1, 2]], 'Missing'],
      (ce) => ce.box(['Map', fn, 'L'] as any)
    );
    expect(r.staticType).toBe(type);
    expect(r.value).toBe(evaluated);
    expect(r.sound).toBe(true);
  });
});

//
// A product of rows of points and numbers. The broadcast pairs each row of
// points with one number of a list (`Q·M`), or each point with one cell of a
// matrix whose rank is not higher than the rank of the points (`R·M2`), and
// the number scales the point. So the cells of the product are points, and
// the type is a list of lists of points. The type of a product with a list
// of numbers was the join of the operand types inside one more list,
// `list<list<integer | list<tuple<integer, integer>>>>`, a type that does not
// hold the value.
//
describe('PRODUCT OF ROWS OF POINTS AND NUMBERS', () => {
  function checkProduct(
    expr: unknown
  ): { staticType: string; value: string; sound: boolean } {
    const ce = new ComputeEngine();
    ce.declare('Q', 'list<list<tuple<integer, integer>>>');
    ce.declare('R', 'list<list<tuple<integer, integer>>>');
    ce.declare('P', 'list<tuple<integer, integer>>');
    ce.declare('M', 'list<integer>');
    ce.declare('M2', 'matrix<integer>');
    const staticType = ce.box(expr as any).type;
    ce.assign(
      'Q',
      ce.box([
        'List',
        ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
        ['List', ['Tuple', 5, 6]],
      ])
    );
    ce.assign(
      'R',
      ce.box([
        'List',
        ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
        ['List', ['Tuple', 5, 6], ['Tuple', 7, 8]],
      ])
    );
    ce.assign('P', ce.box(['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]));
    ce.assign('M', ce.box(['List', 2, 3]));
    ce.assign('M2', ce.box(['List', ['List', 1, 2], ['List', 3, 4]]));
    const v = ce.box(expr as any).evaluate();
    return {
      staticType: staticType.toString(),
      value: v.toString(),
      sound: v.type.matches(staticType),
    };
  }

  test.each<[unknown, string, string]>([
    [
      ['Multiply', 'Q', 'M'],
      'list<list<tuple<integer, integer>>>',
      '[[(2, 4),(6, 8)],[(15, 18)]]',
    ],
    [
      ['Multiply', 'M', 'Q'],
      'list<list<tuple<integer, integer>>>',
      '[[(2, 4),(6, 8)],[(15, 18)]]',
    ],
    [
      ['Multiply', 'Q', 'M', 3],
      'list<list<tuple<integer, integer>>>',
      '[[(6, 12),(18, 24)],[(45, 54)]]',
    ],
    [
      ['Multiply', 'Q', 2],
      'list<list<tuple<integer, integer>>>',
      '[[(2, 4),(6, 8)],[(10, 12)]]',
    ],
    [
      ['Multiply', 'Q', ['Rational', 1, 2]],
      'list<list<tuple<rational, rational>>>',
      '[[(1/2, 1),(3/2, 2)],[(5/2, 3)]]',
    ],
    [
      ['Multiply', 'P', 'M'],
      'list<tuple<integer, integer>>',
      '[(2, 4),(9, 12)]',
    ],
    [
      ['Multiply', 'R', 'M2'],
      'list<list<tuple<integer, integer>>>',
      '[[(1, 2),(6, 8)],[(15, 18),(28, 32)]]',
    ],
    [
      ['Multiply', 'M2', 'R'],
      'list<list<tuple<integer, integer>>>',
      '[[(1, 2),(6, 8)],[(15, 18),(28, 32)]]',
    ],
    [
      ['Multiply', 'P', 'M2'],
      'matrix<tuple<integer, integer>>',
      '[[(1, 2),(2, 4)],[(9, 12),(12, 16)]]',
    ],
  ])('%j', (expr, type, evaluated) => {
    const r = checkProduct(expr);
    expect(r.staticType).toBe(type);
    expect(r.value).toBe(evaluated);
    expect(r.sound).toBe(true);
  });
});

describe('a vector beside a list of lists keeps the integer arm', () => {
  // `L: list<list<integer>>` can hold a rectangular matrix. Then `[2, 3] * L`
  // is the matrix product, `[11, 16]`, a list of integers, not a list of
  // rows. So the type must keep the `integer` arm: `list<list<integer>>`
  // would not hold this value.
  test.each<[string, string]>([
    ['Multiply', '[11,16]'],
    ['Add', '[[3,4],[6,7]]'],
  ])('%s', (op, evaluated) => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<list<integer>>');
    const e = ce.box([op, ['List', 2, 3], 'L']);
    expect(e.type.toString()).toBe('list<integer | list<integer>>');
    ce.assign('L', ce.box(['List', ['List', 1, 2], ['List', 3, 4]]));
    const v = e.evaluate();
    expect(v.toString()).toBe(evaluated);
    expect(v.type.matches(e.type)).toBe(true);
  });

  test('a product of two points that may be point lists is an error (CE-48)', () => {
    const ce = new ComputeEngine();
    ce.declare('P', 'tuple<number, number> | list<tuple<number, number>>');
    ce.declare('Q', 'tuple<number, number> | list<tuple<number, number>>');
    expect(ce.box(['Multiply', 'P', 'Q']).type.toString()).toBe('error');
  });
});

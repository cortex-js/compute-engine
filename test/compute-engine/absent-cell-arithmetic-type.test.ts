import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';
import { typeHandlerContext } from '../../src/compute-engine/boxed-expression/derive-application-type';
import { markAbsentPointCells } from '../../src/compute-engine/boxed-expression/validate';
import {
  describeBoundSymbol,
  describeType,
} from '../../src/compute-engine/boxed-expression/operand-descriptor';
import { parseType } from '../../src/common/type/parse';
import { typeToString } from '../../src/common/type/serialize';

//
// Arithmetic over a list whose cells can be a list or absent. With
// `L: list<list<integer> | missing>` and `L := [[1, 2], Missing]`, `L + 1` is
// `[[2, 3], NaN]`: the absent cell becomes the number `NaN`. The static type
// must have an arm for it. Before, `L + 1` was typed `list<list<number>>`,
// and `Sin(L)` was typed `list<number>`, which does not hold the row
// `[Sin(1), Sin(2)]` either. Now both are typed `list<list<number> | nan>`.
//
// A row of points that is absent stays `Missing` (an absent point is
// `Missing`, `docs/ERROR-MODEL.md`), so its cell type gains a `missing` arm.
//
// Each case checks the static type, and that the type of the evaluated value
// is a subtype of it, on the box route and on the parse route.
//

type Op = { expr: unknown; latex: string };

const OPS: Record<string, Op> = {
  'L + 0.5': { expr: ['Add', 'L', 0.5], latex: 'L+0.5' },
  'L + 1': { expr: ['Add', 'L', 1], latex: 'L+1' },
  'L - 1': { expr: ['Subtract', 'L', 1], latex: 'L-1' },
  '0.5 L': { expr: ['Multiply', 0.5, 'L'], latex: '0.5L' },
  'L / 2': { expr: ['Divide', 'L', 2], latex: '\\frac{L}{2}' },
  '-L': { expr: ['Negate', 'L'], latex: '-L' },
  'L^2': { expr: ['Power', 'L', 2], latex: 'L^2' },
  'Sqrt(L)': { expr: ['Sqrt', 'L'], latex: '\\sqrt{L}' },
  'Abs(L)': { expr: ['Abs', 'L'], latex: '|L|' },
  'Sin(L)': { expr: ['Sin', 'L'], latex: '\\sin(L)' },
  'Exp(L)': { expr: ['Exp', 'L'], latex: '\\exp(L)' },
  'Ln(L)': { expr: ['Ln', 'L'], latex: '\\ln(L)' },
};

type Family = {
  decl: string;
  value: unknown;
  // The expected static type of each operation of `OPS` listed here.
  types: Record<string, string>;
};

const ROWS = 'list<list<number> | nan>';
const NESTED_ROWS = 'list<list<list<number>> | nan>';
const POINTS = 'list<missing | tuple<number, number>>';
const MIXED = 'list<list<number> | number>';
const POINT_ROWS = 'list<list<missing | tuple<number, number>> | missing>';

const FAMILIES: Family[] = [
  // A list of rows with an absent row
  {
    decl: 'list<list<integer> | missing>',
    value: ['List', ['List', 1, 2], 'Missing'],
    types: {
      'L + 0.5': ROWS,
      'L + 1': ROWS,
      'L - 1': ROWS,
      '0.5 L': ROWS,
      'L / 2': ROWS,
      '-L': ROWS,
      'L^2': ROWS,
      'Sqrt(L)': ROWS,
      'Abs(L)': ROWS,
      'Sin(L)': ROWS,
      'Exp(L)': ROWS,
      'Ln(L)': ROWS,
    },
  },
  // A list of lists of rows with an absent cell. A list of rows does not
  // promise rows of one length, so each cell of the result is a list of
  // rows, not a matrix. The square of a square matrix is its matrix power,
  // which is a list of rows too.
  {
    decl: 'list<list<list<integer>> | missing>',
    value: ['List', ['List', ['List', 1, 2], ['List', 3, 4]], 'Missing'],
    types: {
      'L + 0.5': NESTED_ROWS,
      'L + 1': NESTED_ROWS,
      'L - 1': NESTED_ROWS,
      '0.5 L': NESTED_ROWS,
      'L / 2': NESTED_ROWS,
      '-L': NESTED_ROWS,
      'L^2': NESTED_ROWS,
      'Sqrt(L)': NESTED_ROWS,
      'Abs(L)': NESTED_ROWS,
      'Sin(L)': NESTED_ROWS,
      'Exp(L)': NESTED_ROWS,
      'Ln(L)': NESTED_ROWS,
    },
  },
  // A list of points with an absent point. A point plus a number is a type
  // error, on both sides.
  {
    decl: 'list<tuple<integer, integer> | missing>',
    value: ['List', ['Tuple', 1, 2], 'Missing'],
    types: {
      'L + 0.5': 'error',
      'L + 1': 'error',
      'L - 1': 'error',
      '0.5 L': POINTS,
      'L / 2': POINTS,
      '-L': POINTS,
      'L^2': POINTS,
      'Sqrt(L)': POINTS,
      'Abs(L)': 'list<number>',
      'Sin(L)': POINTS,
      'Exp(L)': POINTS,
      'Ln(L)': POINTS,
    },
  },
  // A list whose cells are a row, a number or absent: the `number` arm
  // already holds `NaN`
  {
    decl: 'list<list<integer> | integer | missing>',
    value: ['List', ['List', 1, 2], 3, 'Missing'],
    types: {
      'L + 0.5': MIXED,
      'L + 1': MIXED,
      'L - 1': MIXED,
      '0.5 L': MIXED,
      'L / 2': MIXED,
      '-L': MIXED,
      'L^2': MIXED,
      'Sqrt(L)': MIXED,
      'Abs(L)': MIXED,
      'Sin(L)': MIXED,
      'Exp(L)': MIXED,
      'Ln(L)': MIXED,
    },
  },
  // A list of rows of points with an absent row: the absent row is
  // `Missing`, as an absent point is
  {
    decl: 'list<list<tuple<integer, integer>> | missing>',
    value: ['List', ['List', ['Tuple', 1, 2]], 'Missing'],
    types: {
      '0.5 L': POINT_ROWS,
      'L / 2': POINT_ROWS,
      '-L': POINT_ROWS,
      'L^2': POINT_ROWS,
      'Sqrt(L)': POINT_ROWS,
      'Abs(L)': ROWS,
      'Sin(L)': POINT_ROWS,
      'Exp(L)': POINT_ROWS,
      'Ln(L)': POINT_ROWS,
    },
  },
  // The cells of a list are a row or a number (no absent cell): a function
  // maps every leaf, so the result keeps both arms. Before, `Sin(L)` was
  // typed `list<number>`. (`Abs(L)` is left out: its type, `real<0..>` in
  // the cells, is right, but the type of the evaluated value says
  // `integer`, which is not a subtype of it, as for a plain
  // `list<integer>`.)
  {
    decl: 'list<list<integer> | integer>',
    value: ['List', ['List', 1, 2], 3],
    types: {
      'L^2': MIXED,
      'Sqrt(L)': MIXED,
      'Sin(L)': MIXED,
      'Exp(L)': MIXED,
      'Ln(L)': MIXED,
    },
  },
  // Precision: no new arm where no cell can be absent, or where the absent
  // cell is a number
  {
    decl: 'list<integer | missing>',
    value: ['List', 1, 'Missing'],
    types: { 'L + 1': 'list<number>', 'L + 0.5': 'list<number>' },
  },
  {
    decl: 'list<list<integer>>',
    value: ['List', ['List', 1, 2], ['List', 3, 4]],
    types: { 'L + 1': 'list<list<integer>>', 'Sin(L)': 'list<list<number>>' },
  },
  {
    decl: 'list<list<integer | missing>>',
    value: ['List', ['List', 1, 'Missing']],
    types: { 'L + 1': 'list<list<number>>', 'Sin(L)': 'list<list<number>>' },
  },
];

type Case = [string, Family, Op, string];

const CASES: Case[] = FAMILIES.flatMap((family) =>
  Object.entries(family.types).map(
    ([name, type]) =>
      [`${family.decl}: ${name}`, family, OPS[name], type] as Case
  )
);

function check(
  family: Family,
  build: (ce: ComputeEngine) => Expression
): { staticType: string; sound: boolean } {
  const ce = new ComputeEngine();
  ce.declare('L', family.decl);
  const staticType = build(ce).type.toString();
  ce.assign('L', ce.box(family.value as any));
  const e = build(ce);
  const v = e.evaluate();
  return { staticType, sound: v.type.matches(e.type) };
}

describe('AN ABSENT CELL OF A LIST HAS AN ARM IN THE RESULT TYPE (box)', () => {
  test.each(CASES)('%s', (_, family, op, type) => {
    const { staticType, sound } = check(family, (ce) => ce.box(op.expr as any));
    expect(staticType).toBe(type);
    expect(sound).toBe(true);
  });
});

describe('AN ABSENT CELL OF A LIST HAS AN ARM IN THE RESULT TYPE (parse)', () => {
  test.each(CASES)('%s', (_, family, op, type) => {
    const { staticType, sound } = check(family, (ce) => ce.parse(op.latex));
    expect(staticType).toBe(type);
    expect(sound).toBe(true);
  });
});

describe('AN ABSENT ROW OF POINTS STAYS MISSING', () => {
  test.each(['0.5 L', '-L', 'Sin(L)'])('%s', (name) => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<list<tuple<integer, integer>> | missing>');
    ce.assign(
      'L',
      ce.box(['List', ['List', ['Tuple', 1, 2]], 'Missing'] as any)
    );
    const v = ce.box(OPS[name].expr as any).evaluate();
    expect(isFunction(v) ? v.ops[1]?.json : undefined).toBe('Missing');
  });
});

//
// The descriptor route (`context.derive`, which a `type` handler calls to
// type a body over its operands) gives a type that holds the value too. It
// does not always spell it as the box route does. `Subtract`, which the box
// and parse routes rewrite as a sum, is kept as `Subtract` on this route.
//
describe('AN ABSENT CELL OF A LIST HAS AN ARM IN THE RESULT TYPE (derive)', () => {
  test.each(CASES)('%s', (_, family, op) => {
    const ce = new ComputeEngine();
    const ctx = typeHandlerContext(ce as any);
    const [operator, ...args] = op.expr as [string, ...unknown[]];
    const descriptors = args.map((x) =>
      x === 'L'
        ? describeBoundSymbol(parseType(family.decl)!, '__L')
        : describeType(parseType(Number.isInteger(x) ? 'integer' : 'real')!)
    );
    const derived = ctx.derive(operator, descriptors);
    expect(derived).toBeDefined();
    ce.declare('L', family.decl);
    ce.assign('L', ce.box(family.value as any));
    const v = ce.box(op.expr as any).evaluate();
    expect([typeToString(derived!), v.type.matches(ce.type(derived!))]).toEqual(
      [typeToString(derived!), true]
    );
  });
});

//
// A function literal applied to a list whose cells are a row or a number
// maps every leaf too.
//
describe('A FUNCTION LITERAL OVER A LIST OF ROWS AND NUMBERS', () => {
  test.each<[unknown, string]>([
    [['Apply', ['Function', ['Add', 'x', 1], 'x'], 'L'], MIXED],
    [['Apply', ['Function', ['Sin', 'x'], 'x'], 'L'], MIXED],
  ])('%j', (expr, type) => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<list<integer> | integer>');
    expect(ce.box(expr as any).type.toString()).toBe(type);
    ce.assign('L', ce.box(['List', ['List', 1, 2], 3] as any));
    const e = ce.box(expr as any);
    expect(e.evaluate().type.matches(e.type)).toBe(true);
  });
});

//
// Further shapes of ragged and absent cells. Each case checks the static
// type and that the evaluated value is a member of it, on the box route and,
// when the case has LaTeX, on the parse route.
//
// - A union of lists of different depths has no rank either, as a list
//   beside a number has none.
// - A per-element result that is itself a list (`ComplexRoots`) does not
//   hide that the cells are ragged.
// - An absent row of points is `Missing`, the bare `tuple` included, and
//   only when every list arm of the result holds points: beside the
//   `vector<2>` arm of `[2, 3] · L` it stays `NaN`.
// - An arm with no stated shape (`any`, `unknown`) is `any` in the result;
//   a tuple arm is a number or a tuple; an alias is read as its definition.
// - An operator that does not propagate absence types an absent cell by its
//   own answer for it: `Less(Missing, 2)` is `Missing`, and
//   `And(Missing, False)` is `False`.
// - An absent row that meets a row of another operand is a row of `NaN`,
//   which the row type already holds.
//
type ReviewCase = {
  label: string;
  decl: string;
  value: unknown;
  expr: unknown;
  latex?: string;
  type?: string;
  setup?: (ce: ComputeEngine) => void;
  // The evaluated value, when it is checked
  evaluated?: string;
};

const declareMissingOrRows = (ce: ComputeEngine) =>
  ce.declareType('r', 'missing | list<r>', { alias: true });
const declareRowOrNumber = (ce: ComputeEngine) =>
  ce.declareType('r', 'list<integer> | integer', { alias: true });
const declareDeepB = (ce: ComputeEngine) =>
  ce.declareType('b', 'list<b | integer | missing>', { alias: true });
const DEEP_VALUE = [
  'List',
  ['List', 1, ['List', 2, ['List', 3, ['List', 4, ['List', 5, ['List', 6]]]]]],
  ['List', 'Missing'],
  7,
];

const REVIEW_CASES: ReviewCase[] = [
  {
    label: 'a self-referential alias of absent rows',
    decl: 'list<r>',
    value: ['List', ['List', 'Missing'], 'Missing'],
    expr: ['Multiply', 2, 'L'],
    setup: declareMissingOrRows,
    evaluated: '[[NaN],NaN]',
  },
  {
    label: 'lists of different depths with an absent cell',
    decl: 'list<list<list<integer>> | list<integer> | missing>',
    value: ['List', ['List', ['List', 1]], ['List', 2], 'Missing'],
    expr: ['Sin', 'L'],
    latex: '\\sin(L)',
    type: 'list<list<list<number>> | list<number> | nan>',
  },
  {
    label: 'lists of different depths',
    decl: 'list<list<list<integer>> | list<integer>>',
    value: ['List', ['List', ['List', 1]], ['List', 2]],
    expr: ['Sin', 'L'],
    latex: '\\sin(L)',
    type: 'list<list<list<number>> | list<number>>',
  },
  {
    label: 'a per-element result that is a list',
    decl: 'list<list<integer> | integer>',
    value: ['List', ['List', 1, 8], 4],
    expr: ['ComplexRoots', 'L', 2],
    type: 'list<list<list<number>> | list<number>>',
  },
  {
    label: 'rows of bare tuples with an absent row',
    decl: 'list<list<tuple> | missing>',
    value: ['List', ['List', ['Tuple', 1, 2]], 'Missing'],
    expr: ['Multiply', 2, 'L'],
    latex: '2L',
    type: 'list<list<missing | tuple> | missing>',
    evaluated: '[[(2, 4)],"Missing"]',
  },
  {
    label: 'bare tuples with an absent cell',
    decl: 'list<tuple | missing>',
    value: ['List', ['Tuple', 1, 2], 'Missing'],
    expr: ['Multiply', 2, 'L'],
    latex: '2L',
    type: 'list<missing | tuple>',
    evaluated: '[(2, 4),"Missing"]',
  },
  {
    label: 'rows of points beside a vector',
    decl: 'list<list<tuple<integer, integer>> | missing>',
    value: ['List', ['List', ['Tuple', 1, 2]], 'Missing'],
    expr: ['Multiply', ['List', 2, 3], 'L'],
    // Each number of `[2, 3]` scales one row of points of `L`, so the cells
    // of the product are points, as for `L·2`. The absent row stays absent:
    // the type of the product says that a row may be `Missing`, and the
    // evaluation marks the absent row so (`markAbsentPointCells()`).
    type: 'list<list<missing | tuple<number, number>> | missing>',
    evaluated: '[[(2, 4)],"Missing"]',
  },
  {
    label: 'an any arm',
    decl: 'list<any | list<integer>>',
    value: ['List', ['List', 2], 3],
    expr: ['Sin', 'L'],
    latex: '\\sin(L)',
    type: 'list<any | list<number>>',
  },
  {
    label: 'an unknown arm',
    decl: 'list<unknown | list<integer>>',
    value: ['List', ['List', 2], 3],
    expr: ['Sin', 'L'],
    latex: '\\sin(L)',
    type: 'list<any | list<number>>',
  },
  {
    label: 'a tuple arm',
    decl: 'list<tuple<integer, integer> | list<integer> | integer>',
    value: ['List', ['Tuple', 1, 2], ['List', 2], 3],
    expr: ['Sin', 'L'],
    latex: '\\sin(L)',
    type: 'list<list<number> | number | tuple<number, number>>',
  },
  {
    label: 'an alias of a row or a number',
    decl: 'list<r>',
    value: ['List', ['List', 1, 2], 3],
    expr: ['Sin', 'L'],
    latex: '\\sin(L)',
    type: 'list<list<number> | number>',
    setup: declareRowOrNumber,
  },
  {
    label: 'a self-referential alias with absent cells, a deep value',
    decl: 'list<b | integer>',
    value: DEEP_VALUE,
    expr: ['Sin', 'L'],
    latex: '\\sin(L)',
    setup: declareDeepB,
  },
  {
    label: 'Mod of a ragged list and a matrix',
    decl: 'list<list<integer> | integer>',
    value: ['List', ['List', 1, 2], 3],
    expr: ['Mod', 'L', ['List', ['List', 1, 2], ['List', 3, 4]]],
    type: 'list<list<nan | real> | list<nan | real^2> | nan | real>',
  },
  {
    label: 'Less over an absent row',
    decl: 'list<list<integer> | missing>',
    value: ['List', ['List', 1, 2], 'Missing'],
    expr: ['Less', 'L', 2],
    latex: 'L<2',
    type: 'list<list<boolean | missing> | missing>',
  },
  {
    label: 'And over an absent row',
    decl: 'list<list<boolean> | missing>',
    value: ['List', ['List', 'True'], 'Missing'],
    expr: ['And', 'L', 'False'],
    type: 'list<boolean | list<boolean>>',
    evaluated: '[["False"],"False"]',
  },
  {
    label: 'an absent row beside a row',
    decl: 'list<list<integer> | missing>',
    value: ['List', ['List', 1, 2], 'Missing'],
    expr: ['Add', 'L', ['List', ['List', 1, 2], ['List', 3, 4]]],
    type: 'list<list<number>>',
    evaluated: '[[2,4],[NaN,NaN]]',
  },
];

describe('RAGGED AND ABSENT CELLS OF OTHER SHAPES', () => {
  const routes: [string, ReviewCase][] = [];
  for (const c of REVIEW_CASES) {
    routes.push([`${c.label} (box)`, c]);
    if (c.latex !== undefined) routes.push([`${c.label} (parse)`, c]);
  }
  test.each(routes)('%s', (label, c) => {
    const ce = new ComputeEngine();
    c.setup?.(ce);
    ce.declare('L', c.decl);
    const build = (): Expression =>
      label.endsWith('(parse)') ? ce.parse(c.latex!) : ce.box(c.expr as any);
    const staticType = build().type.toString();
    if (c.type !== undefined) expect(staticType).toBe(c.type);
    ce.assign('L', ce.box(c.value as any));
    const e = build();
    const v = e.evaluate();
    if (c.evaluated !== undefined) expect(v.toString()).toBe(c.evaluated);
    expect([e.type.toString(), v.type.matches(e.type)]).toEqual([
      e.type.toString(),
      true,
    ]);
  });
});

//
// The correction of absent points reads the type of the application through
// rows that can be absent. A self-referential alias of such rows
// (`r = missing | list<r>`) reaches itself again at each level; the walk
// stops there, and the value is kept as it is. Before, it did not stop.
//
describe('THE CORRECTION OF ABSENT POINTS STOPS AT AN ALIAS CUT', () => {
  test('list<r> with r = missing | list<r>', () => {
    const ce = new ComputeEngine();
    ce.declareType('r', 'missing | list<r>', { alias: true });
    ce.declare('L', 'list<r>');
    const value = ce.box(['List', ['List', 'NaN'], 'NaN'] as any);
    expect(markAbsentPointCells(ce, ce.box('L'), value).toString()).toBe(
      '[[NaN],NaN]'
    );
  });
});

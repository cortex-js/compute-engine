import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';
import { typeHandlerContext } from '../../src/compute-engine/boxed-expression/derive-application-type';
import {
  describeBoundSymbol,
  describeType,
} from '../../src/compute-engine/boxed-expression/operand-descriptor';
import { parseType } from '../../src/common/type/parse';
import { typeToString } from '../../src/common/type/serialize';

//
// Arithmetic over a list whose cells can be a list or absent. A declared
// type cannot name `missing` (`docs/ERROR-MODEL.md`, "`Missing` is a result
// only"), so such a list is a constructed value, and `L` takes the type
// inferred from it: `L := [[1, 2], Missing]` is typed
// `list<missing | vector<integer^2>>`. `L + 1` is `[[2, 3], Missing]`: an
// operator over the absent cell gives `Missing`, and the static type of the
// result keeps a `missing` arm for it. An absent row of points stays
// `Missing` too.
//
// Each case checks the static type, and that the type of the evaluated value
// is a subtype of it, on the box route and on the parse route. `Abs(L)` is
// left out of the families whose `L` is inferred: its type, `integer<0..>`
// in the cells, is right, but the type of the evaluated value says
// `integer`, which is not a subtype of it, as for a plain `list<integer>`.
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
  // The declared type of `L`. When it is left out, `L` takes the type
  // inferred from `value`.
  decl?: string;
  value: unknown;
  // The expected static type of each operation of `OPS` listed here.
  types: Record<string, string>;
};

const ROWS = 'list<missing | vector<2>>';
const MATRICES = 'list<matrix<2x2> | missing>';
const POINTS = 'list<(missing | tuple<number, number>)^2>';
const MIXED = 'list<list<number> | number>';
const MIXED_ABSENT = 'list<missing | number | vector<2>>';
const POINT_ROWS = 'list<list<(missing | tuple<number, number>)^1> | missing>';

const FAMILIES: Family[] = [
  // A list of rows with an absent row
  {
    value: ['List', ['List', 1, 2], 'Missing'],
    types: {
      'L + 0.5': 'list<missing | vector<real^2>>',
      'L + 1': 'list<missing | vector<integer^2>>',
      'L - 1': 'list<missing | vector<integer^2>>',
      '0.5 L': 'list<missing | vector<real^2>>',
      'L / 2': 'list<missing | vector<rational^2>>',
      '-L': 'list<missing | vector<integer^2>>',
      'L^2': ROWS,
      'Sqrt(L)': ROWS,
      'Sin(L)': ROWS,
      'Exp(L)': ROWS,
      'Ln(L)': ROWS,
    },
  },
  // A list of matrices with an absent cell. The square of a square matrix
  // is its matrix power.
  {
    value: ['List', ['List', ['List', 1, 2], ['List', 3, 4]], 'Missing'],
    types: {
      'L + 0.5': 'list<matrix<real^(2x2)> | missing>',
      'L + 1': 'list<matrix<integer^(2x2)> | missing>',
      'L - 1': 'list<matrix<integer^(2x2)> | missing>',
      '0.5 L': 'list<matrix<real^(2x2)> | missing>',
      'L / 2': 'list<matrix<rational^(2x2)> | missing>',
      '-L': 'list<matrix<integer^(2x2)> | missing>',
      'L^2': MATRICES,
      'Sqrt(L)': MATRICES,
      'Sin(L)': MATRICES,
      'Exp(L)': MATRICES,
      'Ln(L)': MATRICES,
    },
  },
  // A list of points with an absent point. A point plus a number is a type
  // error, on both sides.
  {
    value: ['List', ['Tuple', 1, 2], 'Missing'],
    types: {
      'L + 0.5': 'error',
      'L + 1': 'error',
      'L - 1': 'error',
      '0.5 L': 'list<(missing | tuple<real, real>)^2>',
      'L / 2': 'list<(missing | tuple<rational, rational>)^2>',
      '-L': 'list<(missing | tuple<integer, integer>)^2>',
      'L^2': POINTS,
      'Sqrt(L)': POINTS,
      'Sin(L)': POINTS,
      'Exp(L)': POINTS,
      'Ln(L)': POINTS,
    },
  },
  // A list whose cells are a row, a number or absent
  {
    value: ['List', ['List', 1, 2], 3, 'Missing'],
    types: {
      'L + 0.5': 'list<missing | real | vector<real^2>>',
      'L + 1': 'list<integer | missing | vector<integer^2>>',
      'L - 1': 'list<integer | missing | vector<integer^2>>',
      '0.5 L': 'list<missing | real | vector<real^2>>',
      'L / 2': 'list<missing | rational | vector<rational^2>>',
      '-L': 'list<integer | missing | vector<integer^2>>',
      'L^2': MIXED_ABSENT,
      'Sqrt(L)': MIXED_ABSENT,
      'Sin(L)': MIXED_ABSENT,
      'Exp(L)': MIXED_ABSENT,
      'Ln(L)': MIXED_ABSENT,
    },
  },
  // A list of rows of points with an absent row: the absent row is
  // `Missing`, as an absent point is. A point plus a number is a type error.
  {
    value: ['List', ['List', ['Tuple', 1, 2]], 'Missing'],
    types: {
      'L + 1': 'error',
      '0.5 L': 'list<list<(missing | tuple<real, real>)^1> | missing>',
      'L / 2': 'list<list<(missing | tuple<rational, rational>)^1> | missing>',
      '-L': 'list<list<(missing | tuple<integer, integer>)^1> | missing>',
      'L^2': POINT_ROWS,
      'Sqrt(L)': POINT_ROWS,
      'Sin(L)': POINT_ROWS,
      'Exp(L)': POINT_ROWS,
      'Ln(L)': POINT_ROWS,
    },
  },
  // The cells of a list are a row or a number (no absent cell): a function
  // maps every leaf, so the result keeps both arms. Before, `Sin(L)` was
  // typed `list<number>`. (`Abs(L)` is left out, as above.)
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
  // An absent number cell keeps its `missing` arm; no arm is added where no
  // cell can be absent
  {
    value: ['List', 1, 'Missing'],
    types: {
      'L + 1': 'list<integer | missing^2>',
      'L + 0.5': 'list<missing | real^2>',
    },
  },
  {
    decl: 'list<list<integer>>',
    value: ['List', ['List', 1, 2], ['List', 3, 4]],
    types: {
      'L + 1': 'list<list<integer>>',
      'Sin(L)': 'list<list<number>>',
    },
  },
  {
    value: ['List', ['List', 1, 'Missing']],
    types: {
      'L + 1': 'matrix<integer | missing^(1x2)>',
      'Sin(L)': 'matrix<missing | number^(1x2)>',
    },
  },
];

const familyLabel = (family: Family): string =>
  family.decl ?? `L := ${JSON.stringify(family.value)}`;

// Bind `L` as the family says: declare it, or assign the value so that `L`
// takes the inferred type.
function bindL(ce: ComputeEngine, family: Family): void {
  if (family.decl !== undefined) ce.declare('L', family.decl);
  else ce.assign('L', ce.box(family.value as any));
}

test('a declared type cannot name missing', () => {
  const ce = new ComputeEngine();
  expect(() => ce.declare('L', 'list<list<integer> | missing>')).toThrow(
    /cannot be declared/
  );
});

type Case = [string, Family, Op, string];

const CASES: Case[] = FAMILIES.flatMap((family) =>
  Object.entries(family.types).map(
    ([name, type]) =>
      [`${familyLabel(family)}: ${name}`, family, OPS[name], type] as Case
  )
);

function check(
  family: Family,
  build: (ce: ComputeEngine) => Expression
): { staticType: string; sound: boolean } {
  const ce = new ComputeEngine();
  bindL(ce, family);
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
    bindL(ce, family);
    const typeOfL = parseType(family.decl ?? ce.box('L').type.toString())!;
    const ctx = typeHandlerContext(ce as any);
    const [operator, ...args] = op.expr as [string, ...unknown[]];
    const descriptors = args.map((x) =>
      x === 'L'
        ? describeBoundSymbol(typeOfL, '__L')
        : describeType(parseType(Number.isInteger(x) ? 'integer' : 'real')!)
    );
    const derived = ctx.derive(operator, descriptors);
    expect(derived).toBeDefined();
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
// - An absent row of points stays `Missing`, also when a vector scales the
//   rows.
// - An arm with no stated shape (`any`, `unknown`) is `any` in the result;
//   a tuple arm is a number or a tuple; an alias is read as its definition.
// - An operator that does not propagate absence types an absent cell by its
//   own answer for it: `Less(Missing, 2)` is `Missing`, and
//   `And(Missing, False)` is `False`.
// - An absent row that meets a row of another operand is a row of
//   `Missing` cells.
//
// A case with no `decl` assigns `value` to `L` without a declaration, so
// that `L` takes the inferred type: a declared type cannot name `missing`.
//
type ReviewCase = {
  label: string;
  decl?: string;
  value: unknown;
  expr: unknown;
  latex?: string;
  type?: string;
  setup?: (ce: ComputeEngine) => void;
  // The evaluated value, when it is checked
  evaluated?: string;
};

const declareRowOrNumber = (ce: ComputeEngine) =>
  ce.declareType('r', 'list<integer> | integer', { alias: true });

const REVIEW_CASES: ReviewCase[] = [
  {
    label: 'lists of different depths with an absent cell',
    value: ['List', ['List', ['List', 1]], ['List', 2], 'Missing'],
    expr: ['Sin', 'L'],
    latex: '\\sin(L)',
    type: 'list<matrix<1x1> | missing | vector<1>>',
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
    label: 'rows of points beside a vector',
    value: ['List', ['List', ['Tuple', 1, 2]], 'Missing'],
    expr: ['Multiply', ['List', 2, 3], 'L'],
    // Each number of `[2, 3]` scales one row of points of `L`, so the cells
    // of the product are points, as for `L·2`. The absent row stays absent:
    // the type of the product says that a row may be `Missing`, and the
    // evaluation marks the absent row so (`markAbsentPointCells()`).
    type: 'list<list<(missing | tuple<integer, integer>)^1> | missing>',
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
    label: 'Mod of a ragged list and a matrix',
    decl: 'list<list<integer> | integer>',
    value: ['List', ['List', 1, 2], 3],
    expr: ['Mod', 'L', ['List', ['List', 1, 2], ['List', 3, 4]]],
    // `list<nan | real^2>` (a row of the matrix) is held by
    // `list<nan | real>`, so it is dropped from the union.
    type: 'list<list<nan | real> | nan | real>',
  },
  {
    label: 'Less over an absent row',
    value: ['List', ['List', 1, 2], 'Missing'],
    expr: ['Less', 'L', 2],
    latex: 'L<2',
    // The absent row is compared as one absent value: `False` (user
    // decision of 2026-11-02, two-valued comparisons).
    type: 'list<boolean | list<boolean^2>>',
  },
  {
    label: 'And over an absent row',
    value: ['List', ['List', 'True'], 'Missing'],
    expr: ['And', 'L', 'False'],
    type: 'list<boolean | list<boolean^1>>',
    evaluated: '[["False"],"False"]',
  },
  {
    label: 'an absent row beside a row',
    value: ['List', ['List', 1, 2], 'Missing'],
    expr: ['Add', 'L', ['List', ['List', 1, 2], ['List', 3, 4]]],
    evaluated: '[[2,4],["Missing","Missing"]]',
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
    if (c.decl !== undefined) ce.declare('L', c.decl);
    else ce.assign('L', ce.box(c.value as any));
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

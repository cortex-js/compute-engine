import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { absorbScalarsIntoCells } from '../../src/compute-engine/boxed-expression/arithmetic-add';
import { parseType } from '../../src/common/type/parse';
import { closeImaginaryUnderArithmetic } from '../../src/common/type/reduce';
import { typeToString } from '../../src/common/type/serialize';
import type { Type } from '../../src/common/type/types';

//
// A scalar added to (or multiplied with) a list is folded into each cell of
// the list. When a cell type is a union with a collection arm
// (`list<list<integer> | integer>`), the collection arm must absorb the
// scalar too: `[[1, 2], 3] + 0.5` is `[[1.5, 2.5], 3.5]`, so the static type
// must say `list<list<real> | real>`. Before, the collection arm was kept
// unchanged (`list<integer | list<integer> | real>`), and the type of the
// evaluated value was not a subtype of the static type.
//
// Each case checks the static type, and that the type of the evaluated
// value is a subtype of it.
//

type Case = {
  decl: string;
  value: unknown;
  expr: unknown;
  type: string;
  setup?: (ce: ComputeEngine) => void;
};

function check({ decl, value, expr, setup }: Case): {
  staticType: string;
  sound: boolean;
} {
  const ce = new ComputeEngine();
  setup?.(ce);
  ce.declare('L', decl);
  ce.declare('x', 'real');
  ce.declare('n', 'integer');
  const staticType = ce.box(expr as any).type.toString();
  ce.assign('L', ce.box(value as any));
  ce.assign('x', 0.25);
  ce.assign('n', 3);
  const e: Expression = ce.box(expr as any);
  const v = e.evaluate();
  return { staticType, sound: v.type.matches(e.type) };
}

const UNION = 'list<list<integer> | integer>';
const UNION_VALUE = ['List', ['List', 1, 2], 3];

const NESTED = 'list<list<list<integer>> | integer>';
const NESTED_VALUE = ['List', ['List', ['List', 1, 2]], 3];

const declareB = (ce: ComputeEngine) =>
  ce.declareType('b', 'list<b | integer>', { alias: true });
// A value deeper than the levels the type walk unfolds.
const DEEP_B_VALUE = [
  'List',
  ['List', 1, ['List', 2, ['List', 3, ['List', 4]]]],
  5,
];

const declareRealB = (ce: ComputeEngine) =>
  ce.declareType('realB', 'list<realB | real>', { alias: true });

const declareMyints = (ce: ComputeEngine) =>
  ce.declareType('myints', 'list<integer>', { alias: true });
const declareCyc = (ce: ComputeEngine) =>
  ce.declareType('cyc', 'cyc | list<integer>', { alias: true });

const CASES: Case[] = [
  // A union cell with a collection arm
  {
    decl: UNION,
    value: UNION_VALUE,
    expr: ['Add', 'L', 0.5],
    type: 'list<list<real> | real>',
  },
  {
    decl: UNION,
    value: UNION_VALUE,
    expr: ['Add', 0.5, 'L'],
    type: 'list<list<real> | real>',
  },
  {
    decl: UNION,
    value: UNION_VALUE,
    expr: ['Add', 'L', 'x'],
    type: 'list<list<real> | real>',
  },
  {
    decl: UNION,
    value: UNION_VALUE,
    expr: ['Subtract', 'L', 0.5],
    type: 'list<list<real> | real>',
  },
  {
    decl: UNION,
    value: UNION_VALUE,
    expr: ['Multiply', 0.5, 'L'],
    type: 'list<list<real> | real>',
  },
  {
    decl: UNION,
    value: UNION_VALUE,
    expr: ['Divide', 'L', 2],
    type: 'list<list<rational> | rational>',
  },
  // An integer scalar widens nothing: the type keeps its spelling
  {
    decl: UNION,
    value: UNION_VALUE,
    expr: ['Add', 'L', 1],
    type: 'list<integer | list<integer>>',
  },
  {
    decl: UNION,
    value: UNION_VALUE,
    expr: ['Add', 'L', 'n'],
    type: 'list<integer | list<integer>>',
  },
  // A nested collection arm absorbs the scalar at its innermost cells
  {
    decl: NESTED,
    value: NESTED_VALUE,
    expr: ['Add', 'L', 0.5],
    type: 'list<list<list<real>> | real>',
  },
  {
    decl: NESTED,
    value: NESTED_VALUE,
    expr: ['Add', 'L', 1],
    type: 'list<integer | list<list<integer>>>',
  },
  // A self-referential alias in the cells: the deeper values the alias stands
  // for are admitted by `unknown`
  {
    decl: 'list<b | integer>',
    value: UNION_VALUE,
    expr: ['Add', 'L', 0.5],
    type: 'list<list<list<unknown> | real> | real>',
    setup: declareB,
  },
  {
    decl: 'list<b | integer>',
    value: DEEP_B_VALUE,
    expr: ['Add', 'L', 0.5],
    type: 'list<list<list<unknown> | real> | real>',
    setup: declareB,
  },
  {
    decl: 'b',
    value: DEEP_B_VALUE,
    expr: ['Multiply', 0.5, 'L'],
    type: 'list<list<list<unknown> | real> | real>',
    setup: declareB,
  },
  {
    decl: 'list<b | integer>',
    value: DEEP_B_VALUE,
    expr: ['Add', 'L', 1],
    type: 'list<b | integer>',
    setup: declareB,
  },
  // Only the cuts of an alias whose leaves widen become `unknown`. The
  // leaves of `realB = list<realB | real>` are already real, so `realB`
  // still describes its cells after `+ 0.5`; only the `integer` arm widens.
  {
    decl: 'list<realB | integer>',
    value: ['List', ['List', 1.5, ['List', 2.5]], 3],
    expr: ['Add', 'L', 0.5],
    type: 'list<real | realB>',
    setup: declareRealB,
  },
  {
    decl: 'list<realB | integer>',
    value: ['List', ['List', 1.5, ['List', 2.5]], 3],
    expr: ['Multiply', 'L', 'x'],
    type: 'list<real | realB>',
    setup: declareRealB,
  },
  // A transparent alias of a collection in the cells
  {
    decl: 'list<myints>',
    value: ['List', ['List', 1, 2]],
    expr: ['Add', 'L', 0.5],
    type: 'list<list<real>>',
    setup: declareMyints,
  },
  {
    decl: 'list<myints | integer>',
    value: UNION_VALUE,
    expr: ['Add', 'L', 0.5],
    type: 'list<list<real> | real>',
    setup: declareMyints,
  },
  {
    decl: 'list<myints>',
    value: ['List', ['List', 1, 2]],
    expr: ['Add', 'L', 1],
    type: 'list<myints>',
    setup: declareMyints,
  },
  // An alias that reaches itself as a bare arm of its own union
  {
    decl: 'list<cyc>',
    value: ['List', ['List', 1, 2]],
    expr: ['Add', 'L', 0.5],
    type: 'list<list<real>>',
    setup: declareCyc,
  },
  // A list of points scaled by a scalar
  {
    decl: 'list<tuple<integer, integer>>',
    value: ['List', ['Tuple', 1, 2]],
    expr: ['Multiply', 0.5, 'L'],
    type: 'list<tuple<real, real>>',
  },
  // No union, no widening beyond what is needed
  {
    decl: 'list<integer>',
    value: ['List', 1, 2],
    expr: ['Add', 'L', 0.5],
    type: 'list<real>',
  },
  {
    decl: 'list<integer>',
    value: ['List', 1, 2],
    expr: ['Add', 'L', 1],
    type: 'list<integer>',
  },
  {
    decl: 'list<list<integer>>',
    value: ['List', ['List', 1, 2], ['List', 3]],
    expr: ['Add', 'L', 0.5],
    type: 'list<list<real>>',
  },
  {
    decl: 'matrix<integer^2x2>',
    value: ['List', ['List', 1, 2], ['List', 3, 4]],
    expr: ['Add', 'L', 0.5],
    type: 'matrix<real^(2x2)>',
  },
  // A `range` cell becomes a list: the sum of a range and a scalar is a list
  // of numbers, never an index span, even when its elements stay integers
  {
    decl: 'list<range>',
    value: ['List', ['Range', 1, 3]],
    expr: ['Add', 'L', 0.5],
    type: 'list<list<real>>',
  },
  {
    decl: 'list<range>',
    value: ['List', ['Range', 1, 3]],
    expr: ['Add', 'L', 1],
    type: 'list<list<integer>>',
  },
  {
    decl: 'list<range | integer>',
    value: ['List', ['Range', 1, 3], 4],
    expr: ['Add', 'L', 0.5],
    type: 'list<list<real> | real>',
  },
];

describe('A SCALAR FOLDS INTO EACH ARM OF A UNION CELL', () => {
  test.each(
    CASES.map((c) => [
      `${c.decl}: ${JSON.stringify(c.expr)}, L = ${JSON.stringify(c.value)}`,
      c,
    ])
  )('%s', (_, c) => {
    const { staticType, sound } = check(c as Case);
    expect(staticType).toBe((c as Case).type);
    expect(sound).toBe(true);
  });
});

describe('A SCALAR FOLDS INTO THE CELLS OF A LIST LITERAL', () => {
  const ce = new ComputeEngine();
  test.each([
    [
      ['Multiply', ['List', ['Range', 1, 3], 5], 0.5],
      'list<list<real> | real>',
    ],
    [
      ['Multiply', ['List', ['Range', 1, 3], 5], 2],
      'list<integer | list<integer>>',
    ],
    // A list whose elements are lists carries no dimensions (only a list
    // whose cells cannot hold a list may), so the two rows are a plain
    // `list<list<…>>`.
    [
      ['Add', ['List', ['Range', 1, 3], ['Range', 2, 4]], 0.5],
      'list<list<real>>',
    ],
    [
      ['Add', ['List', ['Range', 1, 3], ['Range', 2, 4]], 1],
      'list<list<integer>>',
    ],
    // `(i, 1) · i` is `(-1, i)`: a product is not closed over `imaginary`
    [
      ['Multiply', ['List', ['Tuple', 'ImaginaryUnit', 1]], 'ImaginaryUnit'],
      'list<tuple<complex, complex>^1>',
    ],
  ] as [unknown, string][])('%j', (expr, expected) => {
    const e = ce.box(expr as any);
    expect(e.type.toString()).toBe(expected);
    expect(e.evaluate().type.matches(e.type)).toBe(true);
  });
});

describe('absorbScalarsIntoCells ON A UNION CELL', () => {
  test.each<[string, string, string]>([
    ['list<list<integer> | integer>', 'real', 'list<list<real> | real>'],
    [
      'list<tuple<integer, integer> | integer>',
      'real',
      'list<real | tuple<real, real>>',
    ],
    ['set<list<integer> | integer>', 'real', 'set<list<real> | real>'],
    [
      'list<imaginary | list<imaginary>>',
      'imaginary',
      'list<complex | list<complex>>',
    ],
    [
      'list<list<integer> | integer>',
      'integer',
      'list<integer | list<integer>>',
    ],
    // A tuple component is a cell of its own
    [
      'list<tuple<imaginary, imaginary>>',
      'imaginary',
      'list<tuple<complex, complex>>',
    ],
    ['list<tuple<list<integer>>>', 'real', 'list<tuple<list<real>>>'],
    ['list<range | integer>', 'integer', 'list<integer | list<integer>>'],
  ])('%s with a %s scalar', (collection, scalar, expected) => {
    const collectionType: Type = parseType(collection);
    const scalarType: Type = parseType(scalar);
    expect(
      typeToString(absorbScalarsIntoCells(collectionType, [scalarType]))
    ).toBe(expected);
  });
});

//
// A tuple scaled by a factor is typed component by component
// (`scaleTupleComponents` in `library/arithmetic.ts`). A product is not
// closed over `imaginary`: `(i, i) · i` is `(-1, -1)`, so an imaginary
// component times an imaginary factor is `complex`, not `imaginary`.
//
describe('AN IMAGINARY TUPLE COMPONENT TIMES AN IMAGINARY FACTOR', () => {
  const I = 'ImaginaryUnit';
  test.each<[string, unknown, unknown, string]>([
    [
      'a tuple literal',
      undefined,
      ['Multiply', ['Tuple', I, I], I],
      'tuple<complex, complex>',
    ],
    [
      'a tuple symbol',
      'tuple<imaginary, imaginary>',
      ['Multiply', 'p', I],
      'tuple<complex, complex>',
    ],
    [
      'a list of tuples',
      'list<tuple<imaginary, imaginary>>',
      ['Multiply', 'p', I],
      'list<tuple<complex, complex>>',
    ],
  ])('%s', (_label, decl, expr, expected) => {
    const ce = new ComputeEngine();
    if (typeof decl === 'string') {
      ce.declare('p', decl);
      ce.assign(
        'p',
        ce.box(
          decl.startsWith('list') ? ['List', ['Tuple', I, I]] : ['Tuple', I, I]
        )
      );
    }
    const e = ce.box(expr as any);
    expect(e.type.toString()).toBe(expected);
    expect(e.evaluate().type.matches(e.type)).toBe(true);
  });
});

//
// A sum or a product is not closed over `imaginary`, and the repair must
// also apply to a union that holds `imaginary`: `imaginary | integer` times
// `imaginary` holds `0.5i · 0.5i = -0.25`, a real, and `imaginary | integer`
// plus `imaginary` holds `1 + i`, which is neither. Each imaginary member of
// the join is `complex` (`closeImaginaryUnderArithmetic`,
// `common/type/reduce.ts`), and the union is then reduced:
// `imaginary | integer` is `complex`, `imaginary | nan` is `complex | nan`.
// Before, only a join that was exactly `imaginary` was repaired, and the
// union kept excluding the real results.
//
describe('A UNION WITH AN IMAGINARY MEMBER IN A SUM OR A PRODUCT', () => {
  const I = 'ImaginaryUnit';
  const HALF_I = ['Multiply', 0.5, I];
  test.each<[string, Record<string, [string, unknown]>, unknown, string]>([
    // A tuple scaled by a factor (`scaleTupleComponents`)
    [
      'an imaginary | integer tuple component times an imaginary symbol',
      {
        p: ['tuple<imaginary | integer, integer>', ['Tuple', HALF_I, 1]],
        z: ['imaginary', HALF_I],
      },
      ['Multiply', 'p', 'z'],
      'tuple<complex, complex>',
    ],
    [
      'an imaginary | integer tuple component times i',
      { p: ['tuple<imaginary | integer, integer>', ['Tuple', HALF_I, 1]] },
      ['Multiply', 'p', I],
      'tuple<complex, complex>',
    ],
    [
      'an imaginary | nan tuple component times an imaginary symbol',
      {
        q: [
          'tuple<imaginary | nan, imaginary>',
          ['Tuple', HALF_I, ['Multiply', 2, I]],
        ],
        z: ['imaginary', HALF_I],
      },
      ['Multiply', 'q', 'z'],
      'tuple<complex | nan, complex>',
    ],
    [
      'an imaginary tuple times an imaginary | integer factor',
      {
        r: [
          'tuple<imaginary, imaginary>',
          ['Tuple', HALF_I, ['Multiply', 2, I]],
        ],
        w: ['imaginary | integer', HALF_I],
      },
      ['Multiply', 'r', 'w'],
      'tuple<complex, complex>',
    ],
    // A scalar sum (the scalar tail of `addTypeOnTypes`)
    [
      'an imaginary | integer symbol plus an imaginary symbol',
      { a: ['imaginary | integer', 1], b: ['imaginary', I] },
      ['Add', 'a', 'b'],
      'complex',
    ],
    // A component-wise tuple sum (`tupleComponentwiseAddType`)
    [
      'an imaginary | integer tuple plus an imaginary tuple',
      {
        p: ['tuple<imaginary | integer, integer>', ['Tuple', 1, 1]],
        s: ['tuple<imaginary, integer>', ['Tuple', ['Negate', I], 1]],
      },
      ['Add', 'p', 's'],
      'tuple<complex, integer>',
    ],
    // A list cell absorbs a scalar (`absorbScalarsIntoCell`)
    [
      'a list of imaginary | integer times an imaginary symbol',
      {
        L: ['list<imaginary | integer>', ['List', HALF_I, ['Multiply', 2, I]]],
        z: ['imaginary', HALF_I],
      },
      ['Multiply', 'L', 'z'],
      'list<complex>',
    ],
    [
      'a list of imaginary | integer plus an imaginary symbol',
      {
        L: ['list<imaginary | integer>', ['List', 1, 2]],
        z: ['imaginary', ['Multiply', -0.5, I]],
      },
      ['Add', 'L', 'z'],
      'list<complex>',
    ],
    [
      'a list of imaginary times an imaginary | integer symbol',
      {
        L: ['list<imaginary>', ['List', HALF_I, I]],
        w: ['imaginary | integer', HALF_I],
      },
      ['Multiply', 'L', 'w'],
      'list<complex>',
    ],
    // A `broadcastable<…>` operand (`broadcastableResultTypeOfOperands`)
    [
      'a broadcastable<imaginary | integer> symbol plus i',
      { b: ['broadcastable<imaginary | integer>', 1] },
      ['Add', 'b', I],
      'broadcastable<complex>',
    ],
    [
      'a broadcastable<imaginary | integer> symbol times i',
      { b: ['broadcastable<imaginary | integer>', 1] },
      ['Multiply', 'b', I],
      'broadcastable<complex>',
    ],
    // An inner product (`innerProductSumType` in `linear-algebra.ts`):
    // `i·1 + (−i)·1` is `0`
    [
      'the inner product of imaginary | nan components with integers',
      {
        d: ['imaginary | nan', I],
        e: ['imaginary | nan', ['Negate', I]],
      },
      ['Dot', ['Tuple', 'd', 'e'], ['Tuple', 1, 1]],
      'complex | nan',
    ],
  ])('%s', (_label, decls, expr, expected) => {
    const ce = new ComputeEngine();
    for (const [name, [type]] of Object.entries(decls)) ce.declare(name, type);
    for (const [name, [, value]] of Object.entries(decls))
      ce.assign(name, ce.box(value as any));
    const e = ce.box(expr as any);
    expect(e.type.toString()).toBe(expected);
    expect(e.evaluate().type.matches(e.type)).toBe(true);
  });
});

describe('closeImaginaryUnderArithmetic', () => {
  test.each<[string, string]>([
    ['imaginary', 'complex'],
    ['imaginary | integer', 'complex'],
    ['imaginary | nan', 'complex | nan'],
    ['imaginary | infinity', 'complex | infinity'],
    ['imaginary | string', 'complex | string'],
    ['real | nan', 'nan | real'],
    ['integer', 'integer'],
  ])('%s', (input, expected) => {
    expect(typeToString(closeImaginaryUnderArithmetic(parseType(input)))).toBe(
      expected
    );
  });

  test('a type with no imaginary member is returned as the same object', () => {
    const t = parseType('real | nan');
    expect(closeImaginaryUnderArithmetic(t)).toBe(t);
  });
});

//
// A transparent alias of a union with an imaginary member is closed like
// the union it names: for `type alias imu = imaginary | integer`, `r + 1`
// with `r := i` is `1 + i`, which `imu` does not hold. Before, the alias
// was returned unchanged and the sum was typed `imu`.
//
describe('AN ALIAS OF A UNION WITH AN IMAGINARY MEMBER IN A SUM OR A PRODUCT', () => {
  const I = 'ImaginaryUnit';
  test.each<[string, Record<string, [string, unknown]>, unknown, string]>([
    ['an imu symbol plus 1', { r: ['imu', I] }, ['Add', 'r', 1], 'complex'],
    [
      'an imu symbol minus 1',
      { r: ['imu', I] },
      ['Subtract', 'r', 1],
      'complex',
    ],
    [
      'an imu | nan symbol plus 1',
      { r: ['imu | nan', I] },
      ['Add', 'r', 1],
      'complex | nan',
    ],
    [
      'a list of imu plus 1',
      { LR: ['list<imu>', ['List', I]] },
      ['Add', 'LR', 1],
      'list<complex>',
    ],
    [
      'a broadcastable<imu> symbol plus 1',
      { B: ['broadcastable<imu>', I] },
      ['Add', 'B', 1],
      'broadcastable<complex>',
    ],
    [
      'an imu tuple component times an imaginary symbol',
      { P: ['tuple<imu, integer>', ['Tuple', I, 1]], z: ['imaginary', I] },
      ['Multiply', 'P', 'z'],
      'tuple<complex, complex>',
    ],
  ])('%s', (_label, decls, expr, expected) => {
    const ce = new ComputeEngine();
    ce.declareType('imu', 'imaginary | integer', { alias: true });
    for (const [name, [type]] of Object.entries(decls)) ce.declare(name, type);
    for (const [name, [, value]] of Object.entries(decls))
      ce.assign(name, ce.box(value as any));
    const e = ce.box(expr as any);
    expect(e.type.toString()).toBe(expected);
    expect(e.evaluate().type.matches(e.type)).toBe(true);
  });
});

//
// Two collections are combined cell by cell, and combining two cells is
// not closed over `imaginary` either: `[i] + [-i]` is `[0]` and `[i] · [i]`
// is `[-1]`. Before, the joined cell type was kept (`list<imaginary>`), and
// the sum of two `range` cells was typed as a range (`list<range^1>`) while
// its value is a list of integers.
//
describe('TWO COLLECTIONS WITH IMAGINARY CELLS COMBINED CELL BY CELL', () => {
  const I = 'ImaginaryUnit';
  const NI = ['Negate', I];
  test.each<[string, Record<string, [string, unknown]>, unknown, string]>([
    [
      'two list literals added',
      {},
      ['Add', ['List', I], ['List', NI]],
      'vector<complex^1>',
    ],
    [
      'two lists added',
      {
        L: ['list<imaginary>', ['List', I]],
        M: ['list<imaginary>', ['List', NI]],
      },
      ['Add', 'L', 'M'],
      'list<complex>',
    ],
    [
      'two lists multiplied',
      {
        L: ['list<imaginary>', ['List', I]],
        M: ['list<imaginary>', ['List', I]],
      },
      ['Multiply', 'L', 'M'],
      'list<complex>',
    ],
    [
      'two lists subtracted',
      {
        L: ['list<imaginary>', ['List', I]],
        M: ['list<imaginary>', ['List', I]],
      },
      ['Subtract', 'L', 'M'],
      'list<complex>',
    ],
    [
      'a list plus its negation',
      { L: ['list<imaginary>', ['List', I]] },
      ['Add', 'L', ['Negate', 'L']],
      'list<complex>',
    ],
    [
      'two vectors added',
      {
        V: ['vector<imaginary^2>', ['List', I, I]],
        V2: ['vector<imaginary^2>', ['List', NI, NI]],
      },
      ['Add', 'V', 'V2'],
      'vector<complex^2>',
    ],
    [
      'two vectors multiplied',
      {
        V: ['vector<imaginary^2>', ['List', I, I]],
        V2: ['vector<imaginary^2>', ['List', I, I]],
      },
      ['Multiply', 'V', 'V2'],
      'vector<complex^2>',
    ],
    [
      'two matrices added',
      {
        A: [
          'matrix<imaginary^(2x2)>',
          ['List', ['List', I, I], ['List', I, I]],
        ],
        A2: [
          'matrix<imaginary^(2x2)>',
          ['List', ['List', NI, NI], ['List', NI, NI]],
        ],
      },
      ['Add', 'A', 'A2'],
      'matrix<complex^(2x2)>',
    ],
    [
      'two nested lists added',
      {
        N: ['list<list<imaginary>>', ['List', ['List', I]]],
        N2: ['list<list<imaginary>>', ['List', ['List', NI]]],
      },
      ['Add', 'N', 'N2'],
      'list<list<complex>>',
    ],
    [
      'two lists of ranges added',
      {},
      ['Add', ['List', ['Range', 1, 3]], ['List', ['Range', 1, 3]]],
      // A list whose elements are lists carries no dimensions, so the one
      // row is a plain `list<list<integer>>`.
      'list<list<integer>>',
    ],
    // A list of points plus a point: the points are added component by
    // component
    [
      'a list of points plus a point',
      {
        PL: ['list<tuple<imaginary, imaginary>>', ['List', ['Tuple', I, I]]],
        P: ['tuple<imaginary, imaginary>', ['Tuple', NI, NI]],
      },
      ['Add', 'PL', 'P'],
      'list<tuple<complex, complex>>',
    ],
    // No imaginary cell: the cell type is unchanged
    [
      'two integer lists added',
      {
        L: ['list<integer>', ['List', 5]],
        M: ['list<integer>', ['List', 5]],
      },
      ['Add', 'L', 'M'],
      'list<integer>',
    ],
  ])('%s', (_label, decls, expr, expected) => {
    const ce = new ComputeEngine();
    for (const [name, [type]] of Object.entries(decls)) ce.declare(name, type);
    for (const [name, [, value]] of Object.entries(decls))
      ce.assign(name, ce.box(value as any));
    const e = ce.box(expr as any);
    expect(e.type.toString()).toBe(expected);
    expect(e.evaluate().type.matches(e.type)).toBe(true);
  });
});

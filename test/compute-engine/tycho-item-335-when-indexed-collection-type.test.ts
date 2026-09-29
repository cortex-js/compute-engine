/**
 * Tycho item 335 (filed 2026-09-29): a restriction (`When`) whose condition is
 * a LIST of booleans (a mask) zips the value with the mask, cell by cell, so
 * the cells of the result are the ELEMENTS of the value. The `When` type
 * handler tested the value's shape against `list<any>` only, so a value typed
 * `indexed_collection<T>`, `collection<T>` or `range` was read as a scalar and
 * the whole collection type was put where the element type belongs:
 * `P: indexed_collection<tuple<number, number>>` typed
 * `P{P.x > 1}` as `list<indexed_collection<tuple<number, number>> | missing>`
 * although the value is `[Missing, (2, 4), (3, 9)]`.
 *
 * Two sibling defects of the same kind are pinned here too:
 * - `PointX` over an UNORDERED collection of points (`collection<tuple<…>>`,
 *   `set<tuple<…>>`) was typed as the whole point, `missing | tuple<…>`,
 *   although it answers the list of x-coordinates;
 * - `Which`/`If` with a mask condition and a `range` arm typed the cells
 *   `integer | range`.
 *
 * For each carrier the static type is pinned, and, when the carrier has a
 * value, the evaluated value and that its type is a subtype of the static
 * type (the value-vs-declared invariant).
 */
import { ComputeEngine } from '../../src/compute-engine';
import { isSubtype } from '../../src/common/type/subtype';

type Case = {
  declared: string | undefined;
  points: boolean;
  staticType: string;
  value?: unknown;
  evaluated?: string;
};

const POINTS = ['List', ['Tuple', 1, 1], ['Tuple', 2, 4], ['Tuple', 3, 9]];
const NUMBERS = ['List', 1, 2, 3];

const CASES: Case[] = [
  {
    declared: 'list<tuple<number, number>>',
    points: true,
    staticType: 'list<missing | tuple<number, number>>',
    value: POINTS,
    evaluated: '["Missing",(2, 4),(3, 9)]',
  },
  // A carrier whose type does not make it finite (`indexed_collection<T>`,
  // `collection<T>`) may hold an infinite value, which the `evaluate` handler
  // does not zip: each cell is then the whole value. So a cell is typed as
  // the join of the element type and the carrier type.
  {
    declared: 'indexed_collection<tuple<number, number>>',
    points: true,
    staticType:
      'list<indexed_collection<tuple<number, number>> | missing | tuple<number, number>>',
    value: POINTS,
    evaluated: '["Missing",(2, 4),(3, 9)]',
  },
  {
    declared: 'collection<tuple<number, number>>',
    points: true,
    staticType:
      'list<collection<tuple<number, number>> | missing | tuple<number, number>>',
    value: POINTS,
    evaluated: '["Missing",(2, 4),(3, 9)]',
  },
  // A masked NUMBER is `NaN` (user decision 2026-09-25), so the cells of a
  // numeric carrier are `number`, the type that admits `NaN`.
  {
    declared: 'indexed_collection<number>',
    points: false,
    staticType: 'list<indexed_collection<number> | missing | number>',
    value: NUMBERS,
    evaluated: '[NaN,2,3]',
  },
  {
    declared: 'list<number>',
    points: false,
    staticType: 'list<number>',
    value: NUMBERS,
    evaluated: '[NaN,2,3]',
  },
  {
    declared: 'vector<3>',
    points: false,
    staticType: 'list<number>',
    value: NUMBERS,
    evaluated: '[NaN,2,3]',
  },
  {
    declared: 'range',
    points: false,
    staticType: 'list<number>',
    value: ['Range', 1, 3],
    evaluated: '[NaN,2,3]',
  },
  // An undeclared carrier is `unknown`: the condition is not a known mask, so
  // the value keeps its own type with the `missing` arm.
  { declared: undefined, points: false, staticType: 'missing | unknown' },
];

function restriction(ce: ComputeEngine, points: boolean) {
  return ce.box([
    'When',
    'P',
    points ? ['Greater', ['PointX', 'P'], 1] : ['Greater', 'P', 1],
  ]);
}

function engineFor(declared: string | undefined): ComputeEngine {
  const ce = new ComputeEngine();
  if (declared !== undefined) ce.declare('P', declared);
  return ce;
}

describe('TYCHO ITEM 335: STATIC TYPE OF A MASKED RESTRICTION', () => {
  for (const c of CASES) {
    const label = c.declared ?? 'undeclared';

    test(`box route, P: ${label}`, () => {
      const ce = engineFor(c.declared);
      expect(restriction(ce, c.points).type.toString()).toBe(c.staticType);
    });

    test(`LaTeX route, P: ${label}`, () => {
      const ce = engineFor(c.declared);
      const e = ce.parse(c.points ? 'P\\{P.x > 1\\}' : 'P\\{P > 1\\}');
      expect(e.operator).toBe('When');
      expect(e.type.toString()).toBe(c.staticType);
    });

    if (c.value === undefined) continue;

    test(`evaluated value is admitted by the static type, P: ${label}`, () => {
      const ce = engineFor(c.declared);
      const e = restriction(ce, c.points);
      const staticType = e.type.type;
      ce.assign('P', ce.box(c.value as any));
      const v = e.evaluate();
      expect(v.toString()).toBe(c.evaluated);
      expect(isSubtype(v.type.type, staticType)).toBe(true);
    });
  }
});

describe('TYCHO ITEM 335: SIBLING HANDLERS', () => {
  test('PointX over an unordered collection of points is a list of coordinates', () => {
    for (const declared of [
      'collection<tuple<number, number>>',
      'set<tuple<number, number>>',
    ]) {
      const ce = engineFor(declared);
      expect(ce.box(['PointX', 'P']).type.toString()).toBe('list<number>');
    }
  });

  test('PointX over a collection-declared carrier: value admitted by the type', () => {
    const ce = engineFor('collection<tuple<number, number>>');
    const e = ce.box(['PointX', 'P']);
    const staticType = e.type.type;
    ce.assign('P', ce.box(POINTS as any));
    const v = e.evaluate();
    expect(v.toString()).toBe('[1,2,3]');
    expect(isSubtype(v.type.type, staticType)).toBe(true);
  });

  test('Which and If with a mask condition over a range carrier', () => {
    const probes: [unknown, string, string][] = [
      [
        ['Which', ['Greater', 'P', 1], 'P', 'True', 0],
        'list<integer>',
        '[0,2,3]',
      ],
      [['Which', ['Greater', 'P', 1], 'P'], 'list<number>', '[NaN,2,3]'],
      [['If', ['Greater', 'P', 1], 'P', 0], 'list<integer>', '[0,2,3]'],
      [['If', ['Greater', 'P', 1], 'P'], 'list<number>', '[NaN,2,3]'],
    ];
    for (const [json, staticType, evaluated] of probes) {
      const ce = engineFor('range');
      const e = ce.box(json as any);
      expect(e.type.toString()).toBe(staticType);
      const declaredType = e.type.type;
      ce.assign('P', ce.box(['Range', 1, 3]));
      const v = e.evaluate();
      expect(v.toString()).toBe(evaluated);
      expect(isSubtype(v.type.type, declaredType)).toBe(true);
    }
  });
});

describe('TYCHO ITEM 335: CARRIERS THAT ARE NOT ZIPPED, AND NON-LIST MASKS', () => {
  // `Range(1, ∞)` is typed `indexed_collection<integer>`. Its value is not a
  // finite collection, so the `evaluate` handler does not zip it: each cell
  // is the whole range, or `Missing` where the mask is false. The static
  // type must admit that value.
  test('an infinite carrier: each cell is the whole value', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'When',
      ['Range', 1, 'PositiveInfinity'],
      ['List', 'True', 'False'],
    ]);
    expect(e.type.toString()).toBe(
      'list<indexed_collection<integer> | integer | missing>'
    );
    const staticType = e.type.type;
    const v = e.evaluate();
    expect(v.json).toEqual([
      'List',
      ['Range', 1, 'PositiveInfinity'],
      'Missing',
    ]);
    expect(isSubtype(v.type.type, staticType)).toBe(true);
  });

  // A condition that is a SET of booleans (or any other collection of
  // booleans) is zipped by the `evaluate` handler as a list condition is, so
  // it is typed as a mask: the result is a list of cells, not the value with
  // a `missing` arm.
  test('a set of booleans is a mask', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['When', ['List', 1, 2], ['Set', 'True', 'False']]);
    expect(e.type.toString()).toBe('list<number>');
    const staticType = e.type.type;
    const v = e.evaluate();
    expect(v.toString()).toBe('[1,NaN]');
    expect(isSubtype(v.type.type, staticType)).toBe(true);
  });

  test('a condition declared as a collection of booleans is a mask', () => {
    for (const declared of ['set<boolean>', 'collection<boolean>']) {
      const ce = new ComputeEngine();
      ce.declare('M', declared);
      const e = ce.box(['When', ['List', 1, 2], 'M']);
      expect(e.type.toString()).toBe('list<number>');
      const staticType = e.type.type;
      ce.assign('M', ce.box(['Set', 'True', 'False']));
      const v = e.evaluate();
      expect(v.toString()).toBe('[1,NaN]');
      expect(isSubtype(v.type.type, staticType)).toBe(true);
    }
  });
});

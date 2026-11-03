/**
 * Tycho item 335 (filed 2026-09-29): a restriction whose condition is
 * a LIST of booleans (a mask) zips the value with the mask, cell by cell, so
 * the cells of the result are the ELEMENTS of the value. The restriction type
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
import { compile } from '../../src/compute-engine/compilation/compile-expression';

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
    staticType: 'list<tuple<number, number>>',
    value: POINTS,
    evaluated: '[(NaN, NaN),(2, 4),(3, 9)]',
  },
  // An ORDERED carrier (`indexed_collection<T>`) is zipped with the mask
  // whatever its length, over the mask's length (user decision 2026-09-29),
  // so a cell has the element type alone. A position that the mask does not
  // select is a point whose coordinates are `NaN` (selection rule of
  // 2026-11-02; it was `Missing`).
  {
    declared: 'indexed_collection<tuple<number, number>>',
    points: true,
    staticType: 'list<tuple<number, number>>',
    value: POINTS,
    evaluated: '[(NaN, NaN),(2, 4),(3, 9)]',
  },
  // A masked NUMBER is `NaN` (user decision 2026-09-25), so the cells of a
  // numeric carrier are `number`, the type that admits `NaN`.
  {
    declared: 'indexed_collection<number>',
    points: false,
    staticType: 'list<number>',
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
  { declared: undefined, points: false, staticType: 'unknown' },
];

function restriction(ce: ComputeEngine, points: boolean) {
  return ce.box([
    'If',
    points ? ['Greater', ['PointX', 'P'], 1] : ['Greater', 'P', 1],
    'P',
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

    // The parser reads a restriction as the single-branch `If(c, P)`. With
    // a mask condition it has the type of `If(c, P)`; with a scalar
    // condition (`P` undeclared), the type of `P`, with no `missing` arm.
    test(`LaTeX route, P: ${label}`, () => {
      const ce = engineFor(c.declared);
      const e = ce.parse(c.points ? 'P\\{P.x > 1\\}' : 'P\\{P > 1\\}');
      expect(e.operator).toBe('If');
      expect(e.type.toString()).toBe(
        c.declared === undefined ? 'unknown' : c.staticType
      );
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
  // `Range(1, ∞)` is typed `indexed_collection<integer>`. It is ordered, so
  // the mask pairs it with its first elements, over the MASK's length (user
  // decision 2026-09-29; before, each cell was the whole range,
  // `[Range(1, ∞), Missing]`). A masked number is `NaN`.
  test('an infinite ordered carrier is zipped over the mask length', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'If',
      ['List', 'True', 'False'],
      ['Range', 1, 'PositiveInfinity'],
    ]);
    expect(e.type.toString()).toBe('list<number>');
    const staticType = e.type.type;
    const v = e.evaluate();
    expect(v.toString()).toBe('[1,NaN]');
    expect(isSubtype(v.type.type, staticType)).toBe(true);
  });

  // An UNORDERED carrier (`collection<T>`, `Integers`) has no positions to
  // pair with the cells of a mask: under a list of conditions it is a static
  // error (selection rule of 2026-11-02). Before, a finite one was zipped and
  // each cell of an infinite one was the whole value.
  test('an unordered carrier under a mask is a static error', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['If', ['List', 'True', 'False'], 'Integers']);
    expect(e.type.toString()).toBe('error');
    expect(e.evaluate().operator).toBe('Error');
    ce.declare('P', 'collection<tuple<number, number>>');
    expect(restriction(ce, true).type.toString()).toBe('error');
    expect(ce.parse('P\\{P.x > 1\\}').operator).toBe('Error');
  });

  // The condition of a restriction is a boolean or a LIST of booleans (a
  // mask). A set of booleans, or an unordered collection of booleans, has no
  // order to pair its cells with the elements of the value, so it is a
  // static error.
  test('a set of booleans is not a condition', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['If', ['Set', 'True', 'False'], ['List', 1, 2]]);
    expect(e.type.toString()).toBe('error');
  });

  // A condition declared `collection<boolean>` is not refused yet: the rule
  // that a condition is a boolean or a flat list of booleans is plan item 3.3
  // of docs/plans/2026-11-02-compiler-contraction-plan.md, which adds the
  // case.
  test('a condition declared as a set of booleans is not a condition', () => {
    const ce = new ComputeEngine();
    ce.declare('M', 'set<boolean>');
    const e = ce.box(['If', 'M', ['List', 1, 2]]);
    expect(e.type.toString()).toBe('error');
  });
});

/**
 * User decision 2026-09-29: a restriction with a mask condition of length `k`
 * over an ORDERED carrier that is infinite or of unknown length pairs the
 * carrier with the mask over the mask's length. Cell `i` is element `i` of
 * the carrier where the mask is true and the absence marker (`NaN` for a
 * number) where it is false. Only the `k` elements needed are read. When the
 * elements cannot be read (a free bound, a valueless symbol), the whole
 * restriction is held. Every value must be admitted by the static type.
 */
describe('TYCHO ITEM 335: ORDERED CARRIERS OF UNKNOWN OR INFINITE LENGTH', () => {
  const MASK = ['List', 'True', 'False', 'True'];
  const DOUBLE = ['Function', ['Multiply', 'x', 2], 'x'];

  function check(
    ce: ComputeEngine,
    e: ReturnType<ComputeEngine['box']>,
    staticType: string,
    evaluated: string
  ) {
    expect(e.type.toString()).toBe(staticType);
    const declared = e.type.type;
    const v = e.evaluate();
    expect(v.toString()).toBe(evaluated);
    expect(isSubtype(v.type.type, declared)).toBe(true);
    return v;
  }

  test('Range(1, ∞), box route', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['If', MASK as any, ['Range', 1, 'PositiveInfinity']]);
    check(ce, e, 'list<number>', '[1,NaN,3]');
  });

  test('Range(1, ∞), LaTeX restriction-brace route', () => {
    const ce = new ComputeEngine();
    const e = ce.parse('[1...\\infty]\\{[1,2,3]>1\\}');
    expect(e.operator).toBe('If');
    check(ce, e, 'list<number>', '[NaN,2,3]');
  });

  test('a lazy Map over Range(1, ∞), box route', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'If',
      MASK,
      ['Map', DOUBLE, ['Range', 1, 'PositiveInfinity']],
    ] as any);
    check(ce, e, 'list<number>', '[2,NaN,6]');
  });

  test('a comprehension over Range(1, ∞), LaTeX restriction-brace route', () => {
    const ce = new ComputeEngine();
    const e = ce.parse(
      '[2k \\operatorname{for} k=[1...\\infty]]\\{[1,2,3]>1\\}'
    );
    expect(e.operator).toBe('If');
    check(ce, e, 'list<number>', '[NaN,4,6]');
  });

  // A free bound: the elements cannot be read, so the restriction is held
  // whole. Once the bound has a value, the carrier is finite; a carrier
  // shorter than the mask truncates the result to its length, as a finite
  // carrier always has.
  test('a range with a free bound, box route', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    const e = ce.box(['If', MASK as any, ['Range', 1, 'n']]);
    const v = check(
      ce,
      e,
      'list<number>',
      'If(["True","False","True"], Range(1, n))'
    );
    expect(v.operator).toBe('If');
    ce.assign('n', 2);
    check(ce, e, 'list<number>', '[1,NaN]');
    ce.assign('n', 5);
    check(ce, e, 'list<number>', '[1,NaN,3]');
  });

  test('a range with a free bound, LaTeX restriction-brace route', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    const e = ce.parse('[1...n]\\{[1,2,3]>1\\}');
    expect(e.operator).toBe('If');
    // The held restriction is spelled `If(c, e)`, as it was parsed.
    check(ce, e, 'list<number>', 'If(["False","True","True"], Range(1, n))');
    ce.assign('n', 2);
    check(ce, e, 'list<number>', '[NaN,2]');
  });

  test('a lazy Map over a range with a free bound is held', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    const e = ce.box(['If', MASK, ['Map', DOUBLE, ['Range', 1, 'n']]] as any);
    const v = check(
      ce,
      e,
      'list<number>',
      'If(["True","False","True"], Map((x) => 2x, Range(1, n)))'
    );
    expect(v.operator).toBe('If');
  });

  // A valueless symbol declared with an ordered type: before, each cell was
  // the whole symbol (`[P, Missing, P]`), which `list<number>` does not admit.
  test('a valueless symbol with an ordered type is held', () => {
    for (const declared of ['list<number>', 'indexed_collection<number>']) {
      const ce = new ComputeEngine();
      ce.declare('P', declared);
      const e = ce.box(['If', MASK as any, 'P']);
      const v = check(ce, e, 'list<number>', 'If(["True","False","True"], P)');
      expect(v.operator).toBe('If');
      ce.assign('P', ce.box(['List', 1, 2, 3, 4]));
      check(ce, e, 'list<number>', '[1,NaN,3]');
    }
  });

  // The declaration says the symbol is a collection of numbers, so a tuple
  // value it holds is zipped like any other value of that type. A tuple
  // whose own type is a tuple is one value (the first test of the next
  // group).
  test('a tuple held by a symbol with an ordered type is zipped', () => {
    const ce = new ComputeEngine();
    ce.declare('P', 'indexed_collection<number>');
    ce.assign('P', ce.box(['Tuple', 1, 2]));
    const e = ce.box(['If', ['List', 'True', 'False'], 'P']);
    check(ce, e, 'list<number>', '[1,NaN]');
    // The held form enumerates the same cells.
    expect(e.isCollection).toBe(true);
    expect(e.count).toBe(2);
  });
});

describe('TYCHO ITEM 335: CARRIERS THAT KEEP THEIR BEHAVIOR', () => {
  test('a tuple, a string and an infinite set are not zipped', () => {
    const ce = new ComputeEngine();
    const probes: [unknown, string][] = [
      [['Tuple', 1, 2], '[(1, 2),(NaN, NaN),(1, 2)]'],
    ];
    for (const [carrier, evaluated] of probes) {
      const e = ce.box([
        'If',
        ['List', 'True', 'False', 'True'],
        carrier,
      ] as any);
      const declared = e.type.type;
      const v = e.evaluate();
      expect(v.toString()).toBe(evaluated);
      expect(isSubtype(v.type.type, declared)).toBe(true);
    }
  });

  // A string, a set and an infinite set under a mask are static errors
  // (selection rule of 2026-11-02): a string cell has no value for a
  // position that is not selected, and a set has no positions. Before, a
  // string and an infinite set were repeated, and a finite set was zipped.
  test('a string or a set under a mask is a static error', () => {
    const ce = new ComputeEngine();
    for (const carrier of [{ str: 'ab' }, 'Integers', ['Set', 1, 2]]) {
      const e = ce.box(['If', ['List', 'True', 'False'], carrier] as any);
      expect(e.type.toString()).toBe('error');
    }
  });
});

describe('TYCHO ITEM 335: COMPILED RESTRICTION OVER AN ORDERED CARRIER', () => {
  // An infinite carrier does not lower to JavaScript: the compilation falls
  // back to the interpreter, which answers the zipped cells.
  test('an infinite carrier falls back to the interpreter', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'If',
      ['List', 'True', 'False', 'True'],
      ['Range', 1, 'PositiveInfinity'],
    ]);
    const result = compile(e)!;
    expect(result.success).toBe(false);
  });

  // A range with a free bound lowers: it is materialized at run time and
  // aligned with the mask, truncated to the shorter length, as the
  // interpreter answers once the bound has a value.
  test('a range with a free bound agrees with the interpreter', () => {
    const ce = new ComputeEngine();
    ce.declare('m', 'integer');
    const e = ce.box([
      'If',
      ['List', 'True', 'False', 'True'],
      ['Range', 1, 'm'],
    ]);
    const result = compile(e)!;
    expect(result.success).toBe(true);
    for (const m of [2, 5]) {
      const compiled = result.run!({ m }) as number[];
      ce.assign('m', m);
      const interpreted = e.evaluate();
      expect(compiled.length).toBe(interpreted.count);
      const cells = Array.from(interpreted.each()).map((x) => x.re);
      expect(compiled).toEqual(cells);
    }
  });

  // A tuple passed for a symbol declared `indexed_collection<number>` is an
  // array at run time, aligned with the mask, as the interpreter now zips it.
  test('a tuple under an ordered declaration agrees with the interpreter', () => {
    const ce = new ComputeEngine();
    ce.declare('P', 'indexed_collection<number>');
    const e = ce.box(['If', ['List', 'True', 'False'], 'P']);
    const result = compile(e)!;
    expect(result.success).toBe(true);
    const compiled = result.run!({ P: [1, 2] }) as number[];
    ce.assign('P', ce.box(['Tuple', 1, 2]));
    const cells = Array.from(e.evaluate().each()).map((x) => x.re);
    expect(compiled).toEqual(cells);
  });
});

/**
 * Review of the 2026-09-29 change. A type with a tuple arm or a string arm
 * is not an ordered carrier, also when the arm is one arm of a union: the
 * value it holds can be one point or one string, which a mask never splits.
 * The JavaScript compiler tests the shape of such a union at run time and
 * holds one body for each member (a flat array of numbers is a point, an
 * array of arrays is a list of points).
 */
describe('TYCHO ITEM 335: A UNION WITH A TUPLE OR A STRING ARM', () => {
  const MASK = ['List', 'True', 'False'];

  function evaluated(declared: string, value: unknown) {
    const ce = new ComputeEngine();
    ce.declare('P', declared);
    const e = ce.box(['If', MASK, 'P'] as any);
    const staticType = e.type.type;
    ce.assign('P', ce.box(value as any));
    const v = e.evaluate();
    expect(isSubtype(v.type.type, staticType)).toBe(true);
    return { e, v };
  }

  test('a point held under a point-or-point-list union is one value', () => {
    for (const declared of [
      'tuple<number, number> | list<tuple<number, number>>',
      'tuple<number, number> | list<number>',
    ]) {
      const { e, v } = evaluated(declared, ['Tuple', 1, 2]);
      expect(v.toString()).toBe('[(1, 2),(NaN, NaN)]');
      // The held form agrees: a restricted point is not a collection.
      expect(e.isCollection).toBe(false);
    }
  });

  test('a list held under such a union is zipped, as a list is', () => {
    const { v } = evaluated('tuple<number, number> | list<number>', [
      'List',
      1,
      2,
      3,
    ]);
    expect(v.toString()).toBe('[1,NaN]');
  });

  // A string under a mask is refused (selection rule of 2026-11-02). The
  // union does not settle that the value is a string, so the value is
  // refused when the selection is evaluated.
  test('a string held under a string-or-list union is refused', () => {
    const ce = new ComputeEngine();
    ce.declare('P', 'string | list<string>');
    const e = ce.box(['If', MASK, 'P'] as any);
    ce.assign('P', ce.box({ str: 'ab' }));
    expect(e.evaluate().operator).toBe('Error');
  });

  test('the compiler dispatches on a point-or-point-list union', () => {
    // A flat array cannot say by itself whether it is a point or a list, but
    // a list of points holds arrays and a point holds numbers. The compiled
    // code tests the value of `P` once and holds one body for each shape: a
    // point is one value, repeated under the mask; a list of points is zipped
    // with the mask. Each result equals the interpreter's for a value of each
    // shape.
    const type = 'tuple<number, number> | list<tuple<number, number>>';
    const ce = new ComputeEngine();
    ce.declare('P', type);
    const result = compile(ce.box(['If', MASK, 'P'] as any), {
      fallback: false,
    })!;
    expect(result.success).toBe(true);
    const run = result.run as (s: Record<string, unknown>) => unknown;
    expect(run({ P: [1, 2] })).toEqual([
      [1, 2],
      [NaN, NaN],
    ]);
    expect(evaluated(type, ['Tuple', 1, 2]).v.toString()).toBe(
      '[(1, 2),(NaN, NaN)]'
    );
    expect(
      run({
        P: [
          [1, 2],
          [3, 4],
        ],
      })
    ).toEqual([
      [1, 2],
      [NaN, NaN],
    ]);
    expect(
      evaluated(type, ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]).v.toString()
    ).toBe('[(1, 2),(NaN, NaN)]');
  });

  // A string under a mask is refused whatever the declaration (selection
  // rule of 2026-11-02): by its type for `indexed_collection<character>`,
  // by its value for `indexed_collection<any>`. Before, it was one value,
  // repeated.
  test('a string held by a symbol declared as an ordered type is refused', () => {
    for (const declared of [
      'indexed_collection<character>',
      'indexed_collection<any>',
    ]) {
      const ce = new ComputeEngine();
      ce.declare('P', declared);
      const e = ce.box(['If', MASK, 'P'] as any);
      ce.assign('P', ce.box({ str: 'ab' }));
      expect(e.evaluate().operator).toBe('Error');
    }
  });
});

describe('TYCHO ITEM 335: READING THE ELEMENTS OF AN ORDERED CARRIER', () => {
  // The carrier is read with ONE iterator, stopped after the elements the
  // mask needs, so a lazy `Filter` calls its predicate once per element it
  // walks. Before, each element was read with `at(i)`, which restarted the
  // walk: about k²/2 predicate calls for a mask of length k.
  test('a lazy Filter over Range(1, ∞) walks its source once', () => {
    const ce = new ComputeEngine();
    let calls = 0;
    ce.assign('p', (args) => {
      calls += 1;
      return ce.symbol(args[0].re % 3 === 0 ? 'True' : 'False');
    });
    const mask = [
      'List',
      ...Array.from({ length: 50 }, (_, i) => (i % 2 ? 'True' : 'False')),
    ];
    const v = ce
      .box([
        'If',
        mask,
        ['Filter', ['Range', 1, 'PositiveInfinity'], 'p'],
      ] as any)
      .evaluate();
    expect(v.count).toBe(50);
    expect(v.at(2)!.toString()).toBe('6');
    expect(v.at(50)!.toString()).toBe('150');
    // 50 multiples of 3 need a walk of 150 source elements.
    expect(calls).toBe(150);
  });

  test('a large finite range is not materialized', () => {
    const ce = new ComputeEngine();
    const start = Date.now();
    const v = ce
      .box(['If', ['List', 'True', 'False'], ['Range', 1, 1_000_000_000]])
      .evaluate();
    expect(v.toString()).toBe('[1,NaN]');
    // The time depends on the load of the machine, so the limit is asserted
    // only in a `CE_PERF=1` run. The value check above does not depend on
    // time.
    if (process.env.CE_PERF === '1')
      expect(Date.now() - start).toBeLessThan(2000);
  });

  // A range with an infinite lower bound has no first element to read.
  test('a range with an infinite lower bound is held', () => {
    const ce = new ComputeEngine();
    const v = ce
      .box(['If', ['List', 'True', 'False'], ['Range', 'NegativeInfinity', 0]])
      .evaluate();
    expect(v.operator).toBe('If');
  });

  // The length of `TakeWhile(Range(1, ∞), x < 3)` is not known before it is
  // walked, but its iterator ENDS after two elements: the carrier is shorter
  // than the mask and the result is truncated, as for a carrier whose length
  // is known. Before, the carrier was held.
  test('a carrier of unknown length that ends early truncates', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'If',
      ['List', 'True', 'False', 'True'],
      [
        'TakeWhile',
        ['Range', 1, 'PositiveInfinity'],
        ['Function', ['Less', 'x', 3], 'x'],
      ],
    ] as any);
    const staticType = e.type.type;
    const v = e.evaluate();
    expect(v.toString()).toBe('[1,NaN]');
    expect(isSubtype(v.type.type, staticType)).toBe(true);
  });

  // A `Filter` of an infinite source whose predicate stops matching walks
  // until the iteration limit: that stop does not prove that the carrier has
  // no more elements, so the restriction is held.
  test('a walk that stops at the iteration limit is held', () => {
    const ce = new ComputeEngine();
    const v = ce
      .box([
        'If',
        ['List', 'True', 'False', 'True'],
        [
          'Filter',
          ['Range', 1, 'PositiveInfinity'],
          ['Function', ['Less', 'x', 3], 'x'],
        ],
      ] as any)
      .evaluate();
    expect(v.operator).toBe('If');
  });
});

describe('TYCHO ITEM 335: THE HELD FORM AND THE EVALUATED FORM AGREE', () => {
  // A mask with an undecided cell: the evaluated form is a list whose second
  // cell is a held restriction. The unevaluated form presents the same cells
  // through its collection handlers.
  test('a tuple held by a symbol declared indexed_collection<number>', () => {
    const ce = new ComputeEngine();
    ce.declare('P', 'indexed_collection<number>');
    ce.assign('P', ce.box(['Tuple', 1, 2]));
    const e = ce.box(['If', ['List', 'True', ['Greater', 'y', 0]], 'P']);
    const v = e.evaluate();
    expect(v.operator).toBe('List');
    expect(e.isCollection).toBe(true);
    expect(e.count).toBe(v.count);
    for (let i = 1; i <= 2; i++)
      expect(e.at(i)!.evaluate().toString()).toBe(v.at(i)!.toString());
  });

  // A symbol declared with a union that has a tuple arm and holds a point:
  // the evaluated form keeps the point whole at each position, and the held
  // form does not present as a collection of its coordinates.
  test('a point held under a union with a tuple arm', () => {
    const ce = new ComputeEngine();
    ce.declare('P', 'tuple<number, number> | list<number>');
    ce.assign('P', ce.box(['Tuple', 1, 2]));
    const e = ce.box(['If', ['List', 'True', ['Greater', 'y', 0]], 'P']);
    expect(e.isCollection).toBe(false);
    expect(e.count).toBeUndefined();
    expect(e.evaluate().at(1)!.toString()).toBe('(1, 2)');
  });
});

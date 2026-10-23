/**
 * Tycho ledger row 425: an index into a `broadcastable<T>` value did not
 * include the elements of `T`.
 *
 * The case: `g(t) = [t, 2t]` and a parameter `x` declared `any`. The call
 * `g(x)` is typed `broadcastable<vector<2>>`: one vector of two numbers when
 * `x` is a number, and a list of such vectors when `x` is a list and the call
 * maps over it. The index `g(x)[1]` was typed `missing | vector<2>`, the
 * element of the list arm only. For a number `x` the value of `g(x)[1]` is a
 * number, which that type does not hold. So `Repeat(0, g(x)[1])` was an
 * `incompatible-type` error at boxing (`integer` against
 * `missing | vector<2>`), and a definition whose body holds it did not
 * register. Tycho declares a definition parameter with no derived type as
 * `any`.
 *
 * The cause: the element readers (`At`, `First`, `Last`, and the selectors
 * `Take`, `Rest`, `Most`, `Drop`, `Slice`) typed their result with the
 * elements of the collection arm only (`collectionElementType`). When `T`
 * can hold a list (`vector<2>`), a value of the `T` arm is a list, and an
 * index into it returns an element of `T`.
 *
 * The fix: a separate reader, `indexElementType` (`common/type/utils.ts`),
 * gives what an index returns: for a `broadcastable<T>` whose `T` can hold a
 * list, the join of the elements of the arm and the elements of `T` (a union
 * `T` is read arm by arm, a transparent alias is unfolded, a recursive alias
 * is cut, a nested `broadcastable` adds what an index into it returns). Only
 * the element readers use it. `collectionElementType`, which the compile
 * gates and the aggregates (`Sum`, `Max`, `Reduce`) read, is unchanged, so
 * compiled `Sum(g(x))` still maps over the collection arm. `g(x)[1]` is now
 * `missing | number | vector<2>`, which `Repeat` accepts as a count; a
 * vector count is refused at evaluation, and the compiled `Repeat` throws.
 * When `T` cannot hold a list and cannot be indexed (a number), `T` is a
 * cell and the reading is unchanged
 * (`test/common/type/list-element-tensor-cell.test.ts`, "ELEMENT TYPE").
 * A tuple or a string `T` is a cell for broadcasting too, but an index into
 * one returns its slots or characters
 * (`test/compute-engine/broadcastable-scalar-index-type.test.ts`).
 *
 * The readers of the wider types follow:
 *
 * - `PointX` and `Dot` of a union of number arms and collection arms read
 *   the collection arms: the accessor or the product of a number is an
 *   error, which no type holds.
 * - `Sum` of a list of `number | vector<2>` is a number or a list.
 * - The compiled code reads elements that may be numbers or lists with the
 *   dispatching element-wise fold (`Sum`, `Reduce` with `Add` or
 *   `Multiply`), and refuses the statistics (`Max`, `Mean`, `Median`).
 * - The compiled `At`, `First` and `Last` over such elements pick the
 *   absence marker from the value, as the interpreter does
 *   (`_SYS.atWithValueMarker`), and arithmetic on an absent read keeps it
 *   absent (`numberOrGatedCollectionArms`, `base-compiler.ts`).
 *
 * Each test reads the static type BEFORE `x` or `p` is assigned: an
 * assigned value narrows the type, and the check would then prove nothing.
 *
 * Since ROADMAP CE-25 (user decision 2026-10-22), the signature of `g` says
 * only what its body proves: `(unknown) -> list<unknown>`, not
 * `(unknown) -> vector<2>`, since a parameter with no annotation can
 * receive any value (`g("a")` is `["a", 2 "a"]`). So `g(x)` is a
 * `broadcastable<list<unknown>>`, an index into it is `missing | unknown`,
 * and the readers below give the types of the elements of a
 * `list<unknown>`. The checks that the type holds the value are unchanged.
 * Two consequences are recorded here, not accepted: compiled code that
 * cannot tell the lane of an element of unknown type declines (ROADMAP
 * CE-377), and the compiled `NaN` for an absent element where the
 * interpreter gives `Missing` (ROADMAP CE-368) is reachable from more
 * expressions.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

function rowEngine(xType = 'any'): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('g', 'function');
  ce.assign('g', ce.parse('t \\mapsto [t, 2t]'));
  ce.declare('x', { type: xType });
  return ce;
}

/** The static type of `expr`, read now, and for each value of `symbol`:
 * the value of `expr`, and whether the static type holds it. */
function staticTypeAndValues(
  ce: ComputeEngine,
  expr: Expression,
  symbol: string,
  values: unknown[]
): { type: string; values: [string, boolean][] } {
  const type = expr.type;
  const typeString = type.toString();
  const results: [string, boolean][] = [];
  for (const value of values) {
    ce.assign(symbol, ce.box(value as any));
    const result = expr.evaluate();
    results.push([result.toString(), result.type.matches(type)]);
  }
  return { type: typeString, values: results };
}

/** The compiled value as the interpreter spells it. */
function spell(v: unknown): string {
  if (v === undefined || v === null) return 'Missing';
  if (typeof v === 'number' && Number.isNaN(v)) return 'NaN';
  return JSON.stringify(v);
}

/** For each value of `x` (a JavaScript value and its MathJSON spelling):
 * the interpreted value, and the compiled value spelled the same way, or
 * `throws` when the compiled code throws. `declined` when the expression
 * does not compile. */
function compiledAndInterpreted(
  ce: ComputeEngine,
  expr: Expression,
  values: ReadonlyArray<readonly [unknown, unknown]>
): [string, string][] | 'declined' {
  let run: ((vars: never) => unknown) | undefined;
  try {
    run = compile(expr, { to: 'javascript', fallback: false } as never).run;
  } catch {
    return 'declined';
  }
  return values.map(([js, json]) => {
    ce.assign('x', ce.box(json as any));
    const interpreted = expr.evaluate().toString().replace(/"/g, '');
    let compiled: string;
    try {
      compiled = spell(run!({ x: js } as never));
    } catch {
      compiled = 'throws';
    }
    return [interpreted, compiled];
  });
}

const NUMBER_X = 3;
const LIST_X = ['List', 1, 2, 3];
const X_VALUES = [
  [NUMBER_X, NUMBER_X],
  [[1, 2, 3], LIST_X],
  [[], ['List']],
] as const;

describe('Tycho row 425: the instrument', () => {
  test('with x: any, an index into g(x) holds the scalar case', () => {
    const ce = rowEngine();
    expect(ce.parse('g(x)').type.toString()).toBe(
      'broadcastable<list<unknown>>'
    );
    expect(ce.parse('g(x)[1]').type.toString()).toBe('missing | unknown');
  });

  test('with x: any, Repeat(0, g(x)[1]) boxes', () => {
    const ce = rowEngine();
    const expr = ce.parse('\\operatorname{repeat}(0, g(x)[1])');
    expect(expr.isValid).toBe(true);
    expect(expr.type.toString()).toBe('list<integer>');
  });

  test.each(['any', 'real', 'unknown'])(
    'with x: %s, the controls box',
    (xType) => {
      const ce = rowEngine(xType);
      expect(ce.parse('\\operatorname{repeat}(0, g(x)[1])').isValid).toBe(true);
      expect(ce.parse('\\operatorname{repeat}(0, x)').isValid).toBe(true);
    }
  );

  test('with x: real the index is a real; with x: unknown it is unknown', () => {
    expect(rowEngine('real').parse('g(x)[1]').type.toString()).toBe('real');
    // `x` has no type yet, so neither has the element `t` of `g(x)`.
    expect(rowEngine('unknown').parse('g(x)[1]').type.toString()).toBe(
      'unknown'
    );
  });
});

describe('Tycho row 425: the type of a reader of g(x) holds the value', () => {
  const INDEX = 'missing | unknown';
  const LIST = 'list<list<unknown> | unknown>';
  const readers: [string, unknown, string, string, string][] = [
    // name, expression, static type, value for x = 3, value for x = [1, 2, 3]
    ['At', ['At', ['g', 'x'], 1], INDEX, '3', '[1,2]'],
    ['At from the end', ['At', ['g', 'x'], -1], INDEX, '6', '[3,6]'],
    ['First', ['First', ['g', 'x']], INDEX, '3', '[1,2]'],
    ['Last', ['Last', ['g', 'x']], INDEX, '6', '[3,6]'],
    ['Take', ['Take', ['g', 'x'], 1], LIST, '[3]', '[[1,2]]'],
    ['Rest', ['Rest', ['g', 'x']], LIST, '[6]', '[[2,4],[3,6]]'],
    ['Most', ['Most', ['g', 'x']], LIST, '[3]', '[[1,2],[2,4]]'],
    ['Drop', ['Drop', ['g', 'x'], 1], LIST, '[6]', '[[2,4],[3,6]]'],
    // The collection arm of a reader that does not index is unchanged.
    [
      'Reverse',
      ['Reverse', ['g', 'x']],
      'broadcastable<list<unknown>>',
      '[6,3]',
      '[[3,6],[2,4],[1,2]]',
    ],
  ];

  test('Sum of Rest is a number or a tensor', () => {
    // Only for a list `x`: for `x = 3` the interpreter leaves
    // `Sum(Rest(g(x)))` unevaluated (as on the commit before this change).
    // The elements of `Rest(g(x))` are of unknown type, and a sum of such
    // elements is a number or a tensor of numbers (ROADMAP CE-361).
    const ce = rowEngine();
    expect(
      staticTypeAndValues(ce, ce.box(['Sum', ['Rest', ['g', 'x']]]), 'x', [
        LIST_X,
      ])
    ).toEqual({ type: 'broadcastable<number>', values: [['[5,10]', true]] });
  });

  test.each(readers)('%s', (_name, json, type, ofNumber, ofList) => {
    const ce = rowEngine();
    expect(
      staticTypeAndValues(ce, ce.box(json as any), 'x', [NUMBER_X, LIST_X])
    ).toEqual({
      type,
      values: [
        [ofNumber, true],
        [ofList, true],
      ],
    });
  });

  test.each([
    ['PointX(g(x)[1])', ['PointX', ['At', ['g', 'x'], 1]]],
    ['PointX(First(g(x)))', ['PointX', ['First', ['g', 'x']]]],
  ])('%s', (_name, json) => {
    const ce = rowEngine();
    const expr = ce.box(json as any);
    const { type, values } = staticTypeAndValues(ce, expr, 'x', [LIST_X]);
    // The accessor keeps the unknown type of its operand, and its `missing`
    // arm (an index past the end is absent).
    expect(type).toBe('missing | unknown');
    expect(values).toEqual([['1', true]]);
    // The accessor of a number is an error, which no type holds.
    ce.assign('x', NUMBER_X);
    expect(expr.evaluate().toString()).toMatch(/incompatible-type/);
  });

  test('Dot(g(x)[1], [1, 1]) holds its value', () => {
    const ce = rowEngine();
    const expr = ce.box(['Dot', ['At', ['g', 'x'], 1], ['List', 1, 1]]);
    // `Dot` claims a number only for two operands that are provably rank-1
    // numeric; an operand of unknown type gets the wide `value` of its
    // signature, with the `missing` arm of the index.
    expect(staticTypeAndValues(ce, expr, 'x', [LIST_X])).toEqual({
      type: 'missing | value',
      values: [['3', true]],
    });
  });

  test('Repeat with a number x evaluates; with a list x it is refused', () => {
    const ce = rowEngine();
    const expr = ce.parse('\\operatorname{repeat}(0, g(x)[1])');
    expect(staticTypeAndValues(ce, expr, 'x', [NUMBER_X])).toEqual({
      type: 'list<integer>',
      values: [['[0,0,0]', true]],
    });
    ce.assign('x', ce.box(LIST_X as any));
    expect(expr.evaluate().toString()).toMatch(/incompatible-type/);
  });
});

describe('Tycho row 425: a restricted list, a union T', () => {
  // `h(t) = When([t, 2t], t > 0)`: `h(x)` is
  // `broadcastable<missing | vector<2>>`. The `missing` arm cannot hold a
  // list and adds nothing; the `vector<2>` arm adds `number`.
  function whenEngine(): ComputeEngine {
    const ce = rowEngine();
    ce.declare('h', 'function');
    ce.assign(
      'h',
      ce.box([
        'Function',
        ['When', ['List', 't', ['Multiply', 2, 't']], ['Greater', 't', 0]],
        't',
      ])
    );
    return ce;
  }

  test('the index into h(x) holds a number', () => {
    const ce = whenEngine();
    expect(ce.box(['h', 'x']).type.toString()).toBe(
      'broadcastable<missing | vector<2>>'
    );
    expect(
      staticTypeAndValues(ce, ce.box(['At', ['h', 'x'], 1]), 'x', [
        NUMBER_X,
        LIST_X,
      ])
    ).toEqual({
      type: 'missing | number | vector<2>',
      values: [
        ['3', true],
        ['[1,2]', true],
      ],
    });
  });

  test('Repeat(0, h(x)[1]) boxes', () => {
    const ce = whenEngine();
    const expr = ce.box(['Repeat', 0, ['At', ['h', 'x'], 1]]);
    expect(expr.isValid).toBe(true);
    expect(expr.type.toString()).toBe('list<integer>');
  });
});

describe('Tycho row 425: a declared broadcastable<T>', () => {
  const VECTOR = [
    ['List', 1, 2],
    ['List', ['List', 1, 2], ['List', 3, 4]],
  ];
  const cases: [string, unknown[], string, string][] = [
    // declared type, values, type of `At(p, 1)`, type of `Take(p, 1)`
    [
      'broadcastable<vector<2>>',
      VECTOR,
      'missing | number | vector<2>',
      'list<number | vector<2>>',
    ],
    [
      'broadcastable<list<integer>>',
      [
        ['List', 1, 2],
        ['List', ['List', 1, 2], ['List', 3, 4, 5]],
      ],
      'integer | list<integer> | missing | nan',
      'list<integer | list<integer>>',
    ],
    [
      'broadcastable<vector<2> | missing>',
      VECTOR,
      'missing | number | vector<2>',
      'list<missing | number | vector<2>>',
    ],
    [
      'broadcastable<list<integer> | boolean>',
      [
        ['List', 1, 2],
        ['List', ['List', 1, 2], ['List', 3]],
      ],
      'boolean | integer | list<integer> | missing | nan',
      'list<boolean | integer | list<integer>>',
    ],
    [
      // A transparent alias of `vector<2>`, declared below.
      'broadcastable<v2>',
      VECTOR,
      'missing | number | v2',
      'list<number | v2>',
    ],
    [
      'broadcastable<broadcastable<vector<2>>>',
      [...VECTOR, ['List', ['List', ['List', 1, 2], ['List', 3, 4]]]],
      'broadcastable<vector<2>> | missing | number',
      'list<broadcastable<vector<2>> | number | vector<2>>',
    ],
    [
      // An `unknown` element of the `T` arm does not absorb the list arm,
      // and the access keeps its absence marker.
      'broadcastable<list<unknown>>',
      [
        ['List', 1, 2],
        ['List', ['List', 1], ['List', 2]],
      ],
      'missing | unknown',
      'list<list<unknown> | unknown>',
    ],
  ];

  test.each(cases)('%s', (type, values, atType, takeType) => {
    const ce = new ComputeEngine();
    ce.declareType('v2', 'vector<2>', { alias: true });
    ce.declare('p', type);
    const readers: [unknown, string][] = [
      [['At', 'p', 1], atType],
      [['First', 'p'], atType],
      [['Last', 'p'], atType],
      [['Take', 'p', 1], takeType],
      [['Rest', 'p'], takeType],
      [['Most', 'p'], takeType],
      [['Drop', 'p', 1], takeType],
    ];
    const boxed = readers.map(([json]) => ce.box(json as any));
    const types = boxed.map((expr) => expr.type);
    expect(types.map((t) => t.toString())).toEqual(readers.map(([, t]) => t));
    for (const value of values) {
      ce.assign('p', ce.box(value as any));
      for (const [i, expr] of boxed.entries()) {
        const result = expr.evaluate();
        expect([
          JSON.stringify(value),
          expr.toString(),
          result.toString(),
          result.type.matches(types[i]),
        ]).toEqual([
          JSON.stringify(value),
          expr.toString(),
          result.toString(),
          true,
        ]);
      }
    }
  });

  test('a recursive alias is cut', () => {
    const ce = new ComputeEngine();
    ce.declareType('R', 'broadcastable<R>', { alias: true });
    ce.declare('r', 'R');
    expect(() => ce.box(['At', 'r', 1]).type.toString()).not.toThrow();
    expect(() => ce.box(['Take', 'r', 1]).type.toString()).not.toThrow();
  });

  test('a T that cannot hold a list is a cell: the arm only', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'broadcastable<number>');
    expect(ce.box(['At', 'p', 1]).type.toString()).toBe(
      'missing | number | tensor'
    );
  });
});

describe('Tycho row 425: compiled and interpreted values agree', () => {
  // Each expression either does not compile, or compiles to the value the
  // interpreter gives (or throws where the interpreter answers an error),
  // at x = 3, x = [1, 2, 3] and x = []. The outcome of each aggregate is
  // the outcome on the commit before this change, except for `Sum(g(x))`
  // and `Product(g(x))`: they declined while they were typed `number`, and
  // compile since they are typed `number | vector<2>` (ROADMAP CE-361,
  // `test/compute-engine/sum-unknown-element-type.test.ts`).
  // An absent element (an index past the end, or into an empty list) makes
  // `g(x)[5] + 1` and `Sin(g(x)[5])` absent on both routes: the compiled
  // code gave `NaN` where the interpreter gives `Missing` (ROADMAP CE-368,
  // fixed in the run-time broadcast).
  const cases: [string, unknown, 'compiles' | 'declined'][] = [
    ['Sum(g(x))', ['Sum', ['g', 'x']], 'compiles'],
    ['Reduce(g(x), Add, 0)', ['Reduce', ['g', 'x'], 'Add', 0], 'compiles'],
    ['Max(g(x))', ['Max', ['g', 'x']], 'declined'],
    ['Min(g(x))', ['Min', ['g', 'x']], 'declined'],
    ['Product(g(x))', ['Product', ['g', 'x']], 'compiles'],
    ['Mean(g(x))', ['Mean', ['g', 'x']], 'declined'],
    ['Median(g(x))', ['Median', ['g', 'x']], 'declined'],
    ['Sum(Take(g(x), 1))', ['Sum', ['Take', ['g', 'x'], 1]], 'compiles'],
    ['Max(Rest(g(x)))', ['Max', ['Rest', ['g', 'x']]], 'declined'],
    ['Mean(Rest(g(x)))', ['Mean', ['Rest', ['g', 'x']]], 'declined'],
    ['g(x)[5] + 1', ['Add', ['At', ['g', 'x'], 5], 1], 'compiles'],
    ['Sin(g(x)[5])', ['Sin', ['At', ['g', 'x'], 5]], 'compiles'],
    ['g(x)[5]', ['At', ['g', 'x'], 5], 'compiles'],
    ['g(x)[1] + 1', ['Add', ['At', ['g', 'x'], 1], 1], 'compiles'],
    ['First(g(x))', ['First', ['g', 'x']], 'compiles'],
    ['Last(g(x))', ['Last', ['g', 'x']], 'compiles'],
  ];

  function expectAgreement(
    result: [string, string][] | 'declined',
    _expected: 'compiles'
  ): void {
    expect(result).not.toBe('declined');
    for (const [interpreted, compiled] of result as [string, string][])
      expect(compiled).toBe(interpreted);
  }

  test.each(cases)('%s', (_name, json, expected) => {
    const ce = rowEngine();
    const result = compiledAndInterpreted(ce, ce.box(json as any), X_VALUES);
    if (expected === 'declined') {
      expect(result).toBe('declined');
      return;
    }
    expectAgreement(result, expected);
  });

  // For `x = 3` the interpreter leaves these unevaluated (as on the commit
  // before this change: `Rest(g(3))` is not known to be a finite
  // collection), so they are compared at a list `x` and at `[]`.
  test.each([
    ['Sum(Rest(g(x)))', ['Sum', ['Rest', ['g', 'x']]]],
    ['Reduce(Rest(g(x)), Add, 0)', ['Reduce', ['Rest', ['g', 'x']], 'Add', 0]],
  ])('%s', (_name, json) => {
    const ce = rowEngine();
    const result = compiledAndInterpreted(
      ce,
      ce.box(json as any),
      X_VALUES.slice(1)
    );
    expectAgreement(result, 'compiles');
  });

  test('Product(Rest(g(x)))', () => {
    // The elements of `Rest(g(x))` are of unknown type and may be rows of
    // different lengths. Each step of the compiled `Multiply` fold is the
    // run-time product, which multiplies such rows as the interpreter does.
    // The fold was refused before the run-time product did (ROADMAP CE-98.3).
    const ce = rowEngine();
    const result = compiledAndInterpreted(
      ce,
      ce.box(['Product', ['Rest', ['g', 'x']]]),
      X_VALUES.slice(1)
    );
    expectAgreement(result, 'compiles');
  });

  test('Repeat(0, g(x)[1]) throws where the interpreter answers an error', () => {
    const ce = rowEngine();
    const result = compiledAndInterpreted(
      ce,
      ce.box(['Repeat', 0, ['At', ['g', 'x'], 1]]),
      X_VALUES
    ) as [string, string][];
    expect(result[0]).toEqual(['[0,0,0]', '[0,0,0]']);
    expect(result[1][0]).toMatch(/incompatible-type/);
    expect(result[1][1]).toBe('throws');
    expect(result[2][0]).toMatch(/incompatible-type/);
    expect(result[2][1]).toBe('throws');
  });

  test('an index in range is the element, NaN included', () => {
    // Elements that may be numbers or lists: the absence marker of an
    // index out of range is picked from the value, and an element in range
    // is returned as it is.
    const ce = new ComputeEngine();
    ce.declare('q', 'list<number | list<number> | missing>');
    ce.declare('k', 'integer');
    const expr = ce.box(['At', 'q', 'k']);
    const run = compile(expr, {
      to: 'javascript',
      fallback: false,
    } as never).run!;
    const cases: [unknown, unknown, number][] = [
      [[NaN, [1]], ['List', 'NaN', ['List', 1]], 1],
      [[undefined, 1], ['List', 'Missing', 1], 5],
      [[[1], 2], ['List', ['List', 1], 2], 5],
      [[1, 2], ['List', 1, 2], 5],
    ];
    for (const [js, json, k] of cases) {
      ce.assign('q', ce.box(json as any));
      ce.assign('k', k);
      const interpreted = expr.evaluate().toString().replace(/"/g, '');
      expect([
        JSON.stringify(json),
        k,
        spell(run({ q: js, k } as never)),
      ]).toEqual([JSON.stringify(json), k, interpreted]);
    }
  });
});

/** For each value of `symbol` (a JavaScript value and its MathJSON
 * spelling): the interpreted value and the compiled value, spelled the same
 * way, `throws` when the compiled code throws; `declined` when `expr` does
 * not compile. */
function compiledVsInterpreted(
  ce: ComputeEngine,
  expr: Expression,
  symbol: string,
  values: ReadonlyArray<readonly [unknown, unknown]>
): [string, string][] | 'declined' {
  let run: ((vars: never) => unknown) | undefined;
  try {
    run = compile(expr, { to: 'javascript', fallback: false } as never).run;
  } catch {
    return 'declined';
  }
  return values.map(([js, json]) => {
    ce.assign(symbol, ce.box(json as any));
    const interpreted = expr.evaluate().toString().replace(/"/g, '');
    let compiled: string;
    try {
      compiled = spell(run!({ [symbol]: js } as never));
    } catch {
      compiled = 'throws';
    }
    return [interpreted, compiled];
  });
}

/** Whether two values spelled as JSON (numbers or nested lists of numbers)
 * are equal within 1e-9. */
function approximatelyEqual(a: string, b: string): boolean {
  let x: unknown, y: unknown;
  try {
    x = JSON.parse(a);
    y = JSON.parse(b);
  } catch {
    return a === b;
  }
  const same = (u: unknown, v: unknown): boolean => {
    if (typeof u === 'number' && typeof v === 'number')
      return Math.abs(u - v) <= 1e-9;
    if (Array.isArray(u) && Array.isArray(v))
      return u.length === v.length && u.every((e, i) => same(e, v[i]));
    return false;
  };
  return same(x, y);
}

describe('Tycho row 425: a broadcastable whose cells are matrices', () => {
  // `m(t) = [[t, 2t], [3t, 4t]]`: `m(x)[1]` is a row (`vector<2>`) when `x`
  // is a number and a matrix when `x` is a list. Arithmetic on it maps over
  // each arm and keeps the `missing` arm; it was typed `number`, and the
  // compiled code read the absent value as a number.
  function matrixEngine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('m', 'function');
    ce.assign('m', ce.parse('t \\mapsto [[t, 2t], [3t, 4t]]'));
    ce.declare('x', 'any');
    return ce;
  }
  const VALUES = [
    [3, 3],
    [
      [1, 2],
      ['List', 1, 2],
    ],
    [[], ['List']],
  ] as const;

  // The signature of `m` is `(unknown) -> list<list<unknown>>`, so an
  // element of `m(x)` is a `list<unknown>`. A numeric function over its
  // cells of unknown type gives a number or a list for each (ROADMAP
  // CE-378 records the spelling `list<any>` of that list arm, where the
  // rules of `docs/TYPE-SYSTEM.md` say `tensor`).
  test.each([
    ['m(x)[1]', '\\operatorname{At}(m(x), 1)', 'list<unknown> | missing'],
    ['sqrt(m(x)[1])', '\\sqrt{m(x)[1]}', 'list<list<any> | number> | missing'],
    ['2 m(x)[1]', '2 m(x)[1]', 'list<unknown> | missing'],
    ['sin(m(x)[1])', '\\sin(m(x)[1])', 'list<list<any> | number> | missing'],
    [
      'floor(m(x)[1])',
      '\\lfloor m(x)[1] \\rfloor',
      'list<infinity | integer | list<any> | nan> | missing',
    ],
  ])('%s', (_name, latex, type) => {
    const ce = matrixEngine();
    const expr = ce.parse(latex);
    expect(expr.type.toString()).toBe(type);
    const result = compiledVsInterpreted(ce, expr, 'x', VALUES);
    expect(result).not.toBe('declined');
    // `Sqrt` and `Sin` of an exact number stay exact in the interpreter:
    // the compiled float is compared with `.N()`.
    for (const [i, [interpreted, compiled]] of (
      result as [string, string][]
    ).entries()) {
      ce.assign('x', ce.box(VALUES[i][1] as any));
      const numeric = expr.N().toString().replace(/"/g, '');
      expect([
        compiled,
        compiled === interpreted || approximatelyEqual(compiled, numeric),
      ]).toEqual([compiled, true]);
    }
    // The type holds the value.
    for (const [, json] of VALUES) {
      ce.assign('x', ce.box(json as any));
      expect(expr.evaluate().type.matches(ce.type(type))).toBe(true);
    }
  });

  test('the sum of Rest(m(x)) is a row or a matrix', () => {
    const ce = matrixEngine();
    const expr = ce.parse('\\sum \\operatorname{Rest}(m(x))');
    // The elements of `Rest(m(x))` are of unknown type: their sum is a
    // number (the sum of no elements is 0) or a list (ROADMAP CE-378 for
    // the spelling of the list arm).
    expect(expr.type.toString()).toBe('list<any> | number');
    // At x = 3 the interpreter leaves the sum of `Rest(m(3))` unevaluated.
    const result = compiledVsInterpreted(ce, expr, 'x', VALUES.slice(1));
    expect(result).toEqual([
      ['[[2,4],[6,8]]', '[[2,4],[6,8]]'],
      ['0', '0'],
    ]);
  });

  test('a declared union of a matrix and a vector maps over each arm', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'matrix<2x2> | vector<2> | missing');
    expect(ce.box(['Sqrt', 'p']).type.toString()).toBe('missing | tensor');
    expect(ce.box(['Multiply', 2, 'p']).type.toString()).toBe(
      'missing | tensor'
    );
  });
});

describe('Tycho row 425: folds over elements of a union type', () => {
  // The elements of `Rest(p)` are `matrix<integer> | vector<integer>`: the
  // callback check of `Reduce` and `Fold` admits `Multiply` for each arm.
  test.each([
    ['Product(Rest(p))', ['Product', ['Rest', 'p']], '[3,4]'],
    ['Product(Take(p, 2))', ['Product', ['Take', 'p', 2]], '[3,8]'],
    [
      'Reduce(Drop(p, 1), Multiply)',
      ['Reduce', ['Drop', 'p', 1], 'Multiply'],
      '[3,4]',
    ],
    [
      'Fold(Multiply, 1, Rest(p))',
      ['Fold', 'Multiply', 1, ['Rest', 'p']],
      '[3,4]',
    ],
  ])('%s over broadcastable<matrix<integer>>', (_name, json, value) => {
    const ce = new ComputeEngine();
    ce.declare('p', 'broadcastable<matrix<integer>>');
    const expr = ce.box(json as any);
    expect(expr.isValid).toBe(true);
    ce.assign('p', ce.box(['List', ['List', 1, 2], ['List', 3, 4]]));
    expect(expr.evaluate().toString()).toBe(value);
  });

  test('a selector over a broadcastable that may be a string keeps the string arm', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'broadcastable<any>');
    expect(ce.box(['Take', 'p', 1]).type.toString()).toBe('list<any> | string');
    ce.declare('q', 'broadcastable<string | list<string>>');
    expect(ce.box(['Product', ['Rest', 'q']]).isValid).toBe(true);
  });
});

describe('Tycho row 425: the compiled marker of a mixed element type', () => {
  test('a gather index', () => {
    const ce = new ComputeEngine();
    ce.declare('q', 'list<number | list<number>>');
    ce.declare('k', 'integer | list<integer>');
    const expr = ce.box(['At', 'q', 'k']);
    const run = compile(expr, {
      to: 'javascript',
      fallback: false,
    } as never).run!;
    for (const [q, k, qj, kj] of [
      [
        [1, 2],
        [1, 2],
        ['List', 1, 2],
        ['List', 1, 2],
      ],
      [[1, 2], 5, ['List', 1, 2], 5],
      [
        [[1], 2],
        [2, 5],
        ['List', ['List', 1], 2],
        ['List', 2, 5],
      ],
    ] as const) {
      ce.assign('q', ce.box(qj as any));
      ce.assign('k', ce.box(kj as any));
      const interpreted = expr.evaluate().toString().replace(/"/g, '');
      const compiled = JSON.stringify(run({ q, k } as never), (_k, v) =>
        v === undefined ? 'Missing' : Number.isNaN(v) ? 'NaN' : v
      ).replace(/"/g, '');
      expect([JSON.stringify(qj), compiled]).toEqual([
        JSON.stringify(qj),
        interpreted,
      ]);
    }
  });

  test.each([
    [
      'At over an absent base',
      'missing | list<number | list<number>>',
      ['At', 'p', 1],
      [
        [undefined, 'Missing'],
        [
          [1, 2],
          ['List', 1, 2],
        ],
      ],
    ],
    [
      'Third with a missing cell arm',
      'list<number | list<number> | missing>',
      ['Third', 'p'],
      [
        [
          [1, 2],
          ['List', 1, 2],
        ],
      ],
    ],
    [
      'Second with a missing cell arm',
      'list<number | list<number> | missing>',
      ['Second', 'p'],
      [[[1], ['List', 1]]],
    ],
    [
      'Third of a broadcastable that may be absent',
      'broadcastable<vector<2>> | missing',
      ['Third', 'p'],
      [
        [
          [1, 2],
          ['List', 1, 2],
        ],
        [undefined, 'Missing'],
      ],
    ],
    [
      'Third of numbers or booleans',
      'list<number | boolean>',
      ['Third', 'p'],
      [
        [
          [1, 2],
          ['List', 1, 2],
        ],
      ],
    ],
  ])('%s', (_name, type, json, values) => {
    const ce = new ComputeEngine();
    ce.declare('p', type);
    const result = compiledVsInterpreted(
      ce,
      ce.box(json as any),
      'p',
      values as unknown as [unknown, unknown][]
    );
    expect(result).not.toBe('declined');
    for (const [interpreted, compiled] of result as [string, string][])
      expect(compiled).toBe(interpreted);
  });

  // A `list<unknown>` is refused as a bare `list` and a `list<any>` are: the
  // three spellings denote one set of values. Its compiled `Max` read each
  // row of `[[1, 2], [3, 4]]` as a number and gave `NaN` (the interpreter
  // gives 4).
  test.each([
    'list<number | vector<2>> | missing',
    'broadcastable<vector<2>> | missing',
    'list<vector<2>> | missing',
    'list<unknown>',
    'list<unknown> | missing',
  ])('the statistics decline over %s', (type) => {
    // The interpreter answers 4 for `Max`, 1 for `Min` and an error for
    // `Mean` and `Median`; the compiled code read each row as a number.
    for (const op of ['Max', 'Min', 'Mean', 'Median']) {
      const ce = new ComputeEngine();
      ce.declare('p', type);
      expect([
        op,
        compiledVsInterpreted(ce, ce.box([op, 'p']), 'p', []),
      ]).toEqual([op, 'declined']);
    }
  });

  test('a statistic over the rest of a broadcastable of tensors declines', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'broadcastable<tensor<number>>');
    expect(
      compiledVsInterpreted(ce, ce.box(['Mean', ['Rest', 'p']]), 'p', [])
    ).toBe('declined');
  });

  test('a chained index into g(x) is of unknown type, and arithmetic on it is numeric', () => {
    const ce = rowEngine();
    // `g(x)[1]` is `missing | unknown`; an index into it is `unknown`,
    // which `At` admits (an operand of unknown type is assumed to be
    // valid), and `Add` reads as a number or a tensor of numbers.
    expect(ce.parse('g(x)[1][2]').type.toString()).toBe('unknown');
    expect(ce.parse('g(x)[1][2] + 1').type.toString()).toBe(
      'broadcastable<number>'
    );
  });

  test('Repeat with a NaN count throws, as the interpreter answers an error', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'number');
    const result = compiledVsInterpreted(ce, ce.box(['Repeat', 0, 'n']), 'n', [
      [NaN, 'NaN'],
      [3, 3],
    ]) as [string, string][];
    expect(result[0][0]).toMatch(/unexpected-argument/);
    expect(result[0][1]).toBe('throws');
    expect(result[1]).toEqual(['[0,0,0]', '[0,0,0]']);
  });
});

describe('Tycho row 425: operands that are unions or may be absent', () => {
  const L = (...a: unknown[]) => ['List', ...a];

  /** Each compiled value is the interpreted value, or the compiled code
   * throws where the interpreter answers an error, or it declines. */
  function expectParity(result: [string, string][] | 'declined'): void {
    if (result === 'declined') return;
    for (const [interpreted, compiled] of result) {
      if (compiled === 'throws') {
        expect(interpreted).toMatch(/Error|incompatible|unexpected/);
        continue;
      }
      expect([
        interpreted,
        compiled === interpreted || approximatelyEqual(compiled, interpreted),
      ]).toEqual([interpreted, true]);
    }
  }

  test.each([
    ['Sum(Rest(p)) + 1', ['Add', ['Sum', ['Rest', 'p']], 1]],
    ['2 Sum(Rest(p))', ['Multiply', 2, ['Sum', ['Rest', 'p']]]],
    ['Sum(Take(p, 2)) + 1', ['Add', ['Sum', ['Take', 'p', 2]], 1]],
    ['Sum(p) + 1', ['Add', ['Sum', 'p'], 1]],
    ['Reduce(p, Add, 0) + 1', ['Add', ['Reduce', 'p', 'Add', 0], 1]],
    ['Product(Rest(p)) + 1', ['Add', ['Product', ['Rest', 'p']], 1]],
    ['Sum(p)', ['Sum', 'p']],
  ])('%s over list<number | vector<2>> | missing', (_name, json) => {
    const ce = new ComputeEngine();
    ce.declare('p', 'list<number | vector<2>> | missing');
    const expr = ce.box(json as any);
    const type = expr.type;
    const values = [
      [[1, 2, 3], L(1, 2, 3)],
      [[], L()],
      [
        [
          [1, 2],
          [3, 4],
        ],
        L(L(1, 2), L(3, 4)),
      ],
      [undefined, 'Missing'],
    ] as const;
    expectParity(compiledVsInterpreted(ce, expr, 'p', values));
    for (const [, json] of values) {
      ce.assign('p', ce.box(json as any));
      expect([
        JSON.stringify(json),
        expr.evaluate().type.matches(type),
      ]).toEqual([JSON.stringify(json), true]);
    }
  });

  // An index into `m(x)` or `nest(x)` is of unknown type: an absent
  // element makes the read, and arithmetic on it, absent on both routes
  // (the compiled code gave `NaN` where the interpreter gives `Missing`,
  // ROADMAP CE-368). `Max` over an element that may be a row declines (its
  // compiled reduce read the rows as numbers and gave `NaN` where the
  // interpreter gives 4).
  test.each([
    ['At(At(m(x), 1), 1)', ['At', ['At', ['m', 'x'], 1], 1]],
    ['At(At(m(x), 7), 1)', ['At', ['At', ['m', 'x'], 7], 1]],
    ['At(At(m(x), 1), 5)', ['At', ['At', ['m', 'x'], 1], 5]],
    ['Last(At(m(x), 1))', ['Last', ['At', ['m', 'x'], 1]]],
    ['At(At(m(x), 1), 5) + 1', ['Add', ['At', ['At', ['m', 'x'], 1], 5], 1]],
    ['At(At(nest(x), 1), 5)', ['At', ['At', ['nest', 'x'], 1], 5]],
    ['Last(At(nest(x), 2))', ['Last', ['At', ['nest', 'x'], 2]]],
  ])('%s', (_name, json) => {
    const ce = new ComputeEngine();
    ce.declare('m', 'function');
    ce.assign('m', ce.parse('t \\mapsto [[t, 2t], [3t, 4t]]'));
    ce.declare('nest', 'function');
    ce.assign('nest', ce.parse('t \\mapsto [[t], [t, t]]'));
    ce.declare('x', 'any');
    expectParity(
      compiledVsInterpreted(ce, ce.box(json as any), 'x', [
        [3, 3],
        [[1, 2, 3], L(1, 2, 3)],
        [[], L()],
      ])
    );
  });

  test('Max(At(m(x), 1)) declines', () => {
    const ce = new ComputeEngine();
    ce.declare('m', 'function');
    ce.assign('m', ce.parse('t \\mapsto [[t, 2t], [3t, 4t]]'));
    ce.declare('x', 'any');
    expect(
      compiledVsInterpreted(ce, ce.box(['Max', ['At', ['m', 'x'], 1]]), 'x', [])
    ).toBe('declined');
  });

  test('the sum of numbers and rows is a row of the sums', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'list<real | vector<integer>>');
    const sum = ce.box(['Sum', 'p']);
    const type = sum.type;
    ce.assign('p', ce.box(L(0.5, L(1, 2)) as any));
    expect(sum.evaluate().toString()).toBe('[1.5,2.5]');
    expect(sum.evaluate().type.matches(type)).toBe(true);
    ce.declare('q', 'list<missing | vector<2>>');
    const absent = ce.box(['Sum', 'q']);
    const absentType = absent.type;
    ce.assign('q', ce.box(L('Missing') as any));
    expect(absent.evaluate().toString()).toBe('NaN');
    expect(absent.evaluate().type.matches(absentType)).toBe(true);
  });

  test('a fold over rows of different depths is admitted and compiles', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'broadcastable<list<list<integer>>>');
    const product = ce.box(['Product', ['Rest', 'p']]);
    expect(product.isValid).toBe(true);
    ce.assign('p', ce.box(L(L(1, 2), L(3, 4)) as any));
    expect(product.evaluate().toString()).toBe('[3,4]');
    ce.declare('nest', 'function');
    ce.assign('nest', ce.parse('t \\mapsto [[t], [t, t]]'));
    ce.declare('x', 'any');
    // Every expression is boxed before `x` is assigned: an assigned value
    // narrows the type.
    const exprs = [
      ['Product', ['Rest', ['nest', 'x']]],
      ['Reduce', ['Rest', ['nest', 'x']], 'Multiply'],
      ['Fold', 'Multiply', 1, ['Rest', ['nest', 'x']]],
    ].map((json) => ce.box(json as any));
    // The rows of `nest(x)` have different lengths. Each step of the
    // compiled `Multiply` fold is the run-time product, which multiplies
    // them as the interpreter does (ROADMAP CE-98.3).
    for (const expr of exprs) {
      expect(expr.isValid).toBe(true);
      expect(
        compiledVsInterpreted(ce, expr, 'x', [[[1, 2, 3], L(1, 2, 3)]])
      ).toEqual([['[[6],[6,6]]', '[[6],[6,6]]']]);
    }
  });

  test('Repeat with a fractional count throws', () => {
    const ce = rowEngine();
    const result = compiledVsInterpreted(
      ce,
      ce.box(['Repeat', 0, ['At', ['g', 'x'], 1]]),
      'x',
      [[1.5, 1.5]]
    ) as [string, string][];
    expect(result[0][0]).toMatch(/incompatible-type/);
    expect(result[0][1]).toBe('throws');
  });

  test('First of a number throws', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'broadcastable<number>');
    const result = compiledVsInterpreted(ce, ce.box(['First', 'p']), 'p', [
      [3, 3],
      [[1, 2], L(1, 2)],
    ]) as [string, string][];
    expect(result[0][0]).toMatch(/incompatible-type/);
    expect(result[0][1]).toBe('throws');
    expect(result[1]).toEqual(['1', '1']);
  });

  test('Python checks the rank of a statistic over a tensor, and declines a fold', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'tensor');
    // A number or a list of numbers is a sample; a matrix is an error, and
    // the emitted code checks the rank when it runs.
    for (const json of [
      ['Mean', 'p'],
      ['Median', 'p'],
    ])
      expect(
        compile(ce.box(json as any), { to: 'python', fallback: false } as never)
          .code
      ).toMatch(/np\.ndim\(_d\) <= 1/);
    expect(() =>
      compile(ce.box(['Reduce', 'p', 'Add', 0]), {
        to: 'python',
        fallback: false,
      } as never)
    ).toThrow(/Could not compile/);
  });

  test('Python reduces a possibly nested operand for Max', () => {
    for (const type of [
      'broadcastable<number>',
      'matrix | missing',
      'list<vector<2>> | missing',
    ]) {
      const ce = new ComputeEngine();
      ce.declare('p', type);
      expect(
        compile(ce.box(['Max', 'p']), {
          to: 'python',
          fallback: false,
        } as never).code
      ).toMatch(/np\.max\(_v\)/);
    }
  });

  test('Scan and Reduce over rows keep their typing', () => {
    const ce = new ComputeEngine();
    ce.declare('m', 'matrix<number>');
    expect(ce.box(['Determinant', ['Scan', 'm', 'Add']]).isValid).toBe(true);
    ce.declare('p', 'list<vector<2>>');
    expect(ce.box(['Scan', 'p', 'Add']).type.toString()).toBe(
      'list<vector<2>>'
    );
    ce.declare('t', 'list<tuple<number, number>>');
    // The sum of two points is an error: a fold over points keeps its
    // typing, and `Scan(t, Add) + 1` stays invalid.
    expect(ce.box(['Reduce', 't', 'Add']).type.toString()).toBe('unknown');
    expect(ce.box(['Add', ['Scan', 't', 'Add'], 1]).isValid).toBe(false);
  });

  test.each([
    [
      'list<real | tensor<real>>',
      [
        [
          [1, 2],
          [3, 4],
        ],
        [10, 20],
      ],
    ],
    ['list<number | list<number>>', [[1, 2], [3]]],
  ])('a sum over %s checks the shapes when it runs', (type, value) => {
    const ce = new ComputeEngine();
    ce.declare('p', type);
    const run = compile(ce.box(['Sum', 'p']), {
      to: 'javascript',
      fallback: false,
    } as never).run!;
    expect(() => run({ p: value } as never)).toThrow();
  });

  test.each(['Rest', 'Take', 'Drop', 'Most'])(
    'a structural %s with no operand has a type',
    (op) => {
      const ce = new ComputeEngine();
      expect(
        ce.box([op] as any, { form: 'structural' } as any).type.toString()
      ).toBe('unknown');
    }
  );

  test('a gather with a declared list index picks the marker from the value', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'broadcastable<vector<2>>');
    ce.declare('k', 'list<integer>');
    const run = compile(ce.box(['At', 'p', 'k']), {
      to: 'javascript',
      fallback: false,
    } as never).run!;
    const result = run({
      p: [
        [1, 2],
        [3, 4],
      ],
      k: [1, 5],
    } as never) as unknown[];
    expect(result).toEqual([[1, 2], undefined]);
  });

  test('Python Max of a possibly empty list is NaN alone', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'broadcastable<number>');
    expect(
      compile(ce.box(['Max', 'p']), { to: 'python', fallback: false } as never)
        .code
    ).toMatch(/np\.size\(_v\) == 0/);
  });

  test('PointX and PointY of a string-armed operand read the element', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'broadcastable<list<string>>');
    const run = compile(ce.box(['PointY', ['At', 'p', 1]]), {
      to: 'javascript',
      fallback: false,
    } as never).run!;
    expect(run({ p: [['a', 'b'], ['c']] } as never)).toBe('b');
    ce.declare('q', 'list<string> | string');
    const runQ = compile(ce.box(['PointX', 'q']), {
      to: 'javascript',
      fallback: false,
    } as never).run!;
    expect(runQ({ q: '😀a' } as never)).toBe('😀');
  });

  test.each(['string | list<vector<2>>', 'string | list<list<number>>'])(
    'PointX and PointY of %s read a list of points by point',
    (type) => {
      const ce = new ComputeEngine();
      ce.declare('p', type);
      const value = [
        [1, 2],
        [3, 4],
      ];
      const x = compile(ce.box(['PointX', 'p']), {
        to: 'javascript',
        fallback: false,
      } as never).run!;
      const y = compile(ce.box(['PointY', 'p']), {
        to: 'javascript',
        fallback: false,
      } as never).run!;
      expect(x({ p: value } as never)).toEqual([1, 3]);
      expect(y({ p: value } as never)).toEqual([2, 4]);
    }
  );

  test('PointY of a one-element list in a string union is NaN', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'string | list<number>');
    const run = compile(ce.box(['PointY', 'p']), {
      to: 'javascript',
      fallback: false,
    } as never).run!;
    expect(run({ p: [5] } as never)).toBeNaN();
  });

  test('arithmetic on the coordinate of a string union declines', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'string | list<real>');
    expect(() =>
      compile(ce.box(['Add', ['PointY', 'p'], 1]), {
        to: 'javascript',
        fallback: false,
      } as never)
    ).toThrow();
  });

  test.each(['First', 'Second'])(
    '%s of an empty number | list<number> is Missing',
    (op) => {
      const ce = new ComputeEngine();
      ce.declare('p', 'number | list<number>');
      const run = compile(ce.box([op, 'p']), {
        to: 'javascript',
        fallback: false,
      } as never).run!;
      expect(run({ p: [] } as never)).toBeUndefined();
    }
  );

  test.each([
    ['Product', 'p'],
    ['Reduce', 'p', 'Multiply', 1],
  ])('%s of complex matrices beside complex numbers', (...expr) => {
    const ce = new ComputeEngine();
    ce.declare('p', 'list<complex | matrix<complex>>');
    const run = compile(ce.box(expr as any), {
      to: 'javascript',
      fallback: false,
    } as never).run!;
    const m = [
      [{ re: 0, im: 1 }, 1],
      [1, 1],
    ];
    // [[i, 1], [1, 1]]^2 = [[0, 1 + i], [1 + i, 2]]
    const result = JSON.parse(JSON.stringify(run({ p: [m, m] } as never)));
    const re = (v: any) => (typeof v === 'number' ? v : v.re);
    const im = (v: any) => (typeof v === 'number' ? 0 : v.im);
    expect(result.flat().map(re)).toEqual([0, 1, 1, 2]);
    expect(result.flat().map(im)).toEqual([0, 1, 1, 0]);
  });

  test('a mixed-element product with a complex seed takes the complex helpers', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'list<real | matrix<real>>');
    const run = compile(ce.box(['Reduce', 'p', 'Multiply', 'ImaginaryUnit']), {
      to: 'javascript',
      fallback: false,
    } as never).run!;
    const id = [
      [1, 0],
      [0, 1],
    ];
    // i · I · I is the imaginary identity matrix.
    const result = JSON.parse(JSON.stringify(run({ p: [id, id] } as never)));
    const re = (v: any) => (typeof v === 'number' ? v : v.re);
    const im = (v: any) => (typeof v === 'number' ? 0 : v.im);
    expect(result.flat().map(re)).toEqual([0, 0, 0, 0]);
    expect(result.flat().map(im)).toEqual([1, 0, 0, 1]);
  });

  test.each(['Max', 'Min'])(
    'Python %s of several possibly empty lists is NaN when every one is empty',
    (op) => {
      const ce = new ComputeEngine();
      ce.declare('p', 'broadcastable<number>');
      ce.declare('q', 'broadcastable<number>');
      const code = compile(ce.box([op, 'p', 'q']), {
        to: 'python',
        fallback: false,
      } as never).code;
      // An empty operand is skipped (`None`), and no operand left is NaN.
      expect(code).toContain('None if np.size(_v) == 0');
      expect(code).toContain("float('nan') if len(_ys) == 0");
      expect(code).not.toMatch(/np\.inf/);
    }
  );

  test('a sum over a recursive alias of lists compiles', () => {
    const ce = new ComputeEngine();
    ce.declareType('R', 'list<R>', { alias: true });
    ce.declare('p', 'list<real | R>');
    expect(() =>
      compile(ce.box(['Sum', 'p']), {
        to: 'javascript',
        fallback: false,
      } as never)
    ).not.toThrow(RangeError);
  });

  test('the sum over a recursive alias is a number or a list', () => {
    const ce = new ComputeEngine();
    ce.declareType('N', 'list<N> | number', { alias: true });
    ce.declare('q', 'list<N>');
    const sum = ce.box(['Sum', 'q']);
    const type = sum.type;
    expect(type.toString()).toBe('list<any> | number');
    ce.assign('q', ce.box(L(L(1, 2), L(3, 4), L(5, 6)) as any));
    expect(sum.evaluate().type.matches(type)).toBe(true);
  });

  test('a sum over lists of several shapes checks the shapes when it runs; a product does not', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'list<matrix<2x2> | vector<2>>');
    const run = compile(ce.box(['Sum', 'p']), {
      to: 'javascript',
      fallback: false,
    } as never).run!;
    expect(() =>
      run({
        p: [
          [
            [1, 2],
            [3, 4],
          ],
          [10, 20],
        ],
      } as never)
    ).toThrow();
    // A product does not check the shapes: a matrix times a row is the
    // matrix product, as in the interpreter (ROADMAP CE-98.3).
    const product = compile(ce.box(['Product', 'p']), {
      to: 'javascript',
      fallback: false,
    } as never).run!;
    expect(
      product({
        p: [
          [
            [1, 2],
            [3, 4],
          ],
          [10, 20],
        ],
      } as never)
    ).toEqual([50, 110]);
  });

  test.each([
    ['At(At(p, 1), 2)', ['At', ['At', 'p', 1], 2]],
    ['At(First(p), 2)', ['At', ['First', 'p'], 2]],
    ['At(Last(p), 1)', ['At', ['Last', 'p'], 1]],
    ['At(At(p, 1), 5)', ['At', ['At', 'p', 1], 5]],
  ])('%s over broadcastable<vector<2>> | missing is a number', (_n, json) => {
    const ce = new ComputeEngine();
    ce.declare('p', 'broadcastable<vector<2>> | missing');
    const expr = ce.box(json as any);
    expect(expr.type.toString()).toBe('number');
    const result = compiledVsInterpreted(ce, expr, 'p', [
      [[], L()],
      [undefined, 'Missing'],
    ]);
    expect(result).toEqual([
      ['NaN', 'NaN'],
      ['NaN', 'NaN'],
    ]);
  });

  test('PointX of an index into a broadcastable of lists of strings', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'broadcastable<list<string>>');
    const expr = ce.box(['PointX', ['At', 'p', 1]]);
    const type = expr.type;
    ce.assign('p', ce.box(L(L({ str: 'a' }), L({ str: 'b' })) as any));
    expect(expr.evaluate().toString()).toBe('"a"');
    expect(expr.evaluate().type.matches(type)).toBe(true);
  });
});

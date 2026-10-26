// ROADMAP CE-504: a point combined with an operand that may be a list.
//
// A point beside an operand whose type does not give the shape of its value
// (an element read `L[1]` of a `list<unknown>`, a `broadcastable<number>`, a
// `list<unknown>`, a `list<list<integer>>`) is a point or a list of points of
// the shape of that value. The `Multiply`, `Divide` and `Add` type handlers
// typed it as one point (`tuple<number, number>`), or as a list of points of
// depth one, and the value did not match the type: with `Lu := [[1, 2]]`,
// `(x, y)·(2·Lu[1])` is `[(6, 8), (12, 16)]` at `x = 3, y = 4`.

import { ComputeEngine, compile } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

type Json = number | string | Json[];

const DECLARATIONS: Record<string, string> = {
  Lu: 'list<unknown>',
  b: 'broadcastable<number>',
  c: 'number | broadcastable<number>',
  u: 'broadcastable<unknown>',
  L2: 'list<list<integer>>',
  x: 'real',
  y: 'real',
};

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  for (const [name, type] of Object.entries(DECLARATIONS))
    ce.declare(name, type);
  return ce;
}

const P: Json = ['Tuple', 'x', 'y'];
const L1: Json = ['At', 'Lu', 1];

// The values each symbol is given to check the static type against.
const VALUES: Record<string, Json[]> = {
  Lu: [
    ['List', ['List', 1, 2]],
    ['List', ['List', ['List', 1], ['List', 2, 3]]],
    ['List', 5],
    ['List', ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]],
  ],
  b: [7, ['List', 1, 2], ['List', ['List', 1, 2], ['List', 3, 4]]],
  c: [7, ['List', 1, 2], ['List', ['List', 1, 2], ['List', 3, 4]]],
  u: [7, ['List', 1, 2]],
  L2: [['List', ['List', 1], ['List', 2, 3]]],
};

function symbolOf(expr: Json): string {
  const m = JSON.stringify(expr).match(/"(Lu|b|c|u|L2)"/);
  return m![1];
}

function hasError(e: Expression): boolean {
  return JSON.stringify(e.json).includes('Error');
}

describe('CE-504: the static type of a point beside a possible list', () => {
  test.each<[Json, string]>([
    [
      ['Multiply', P, L1],
      'list<list<any> | tuple<number, number>> | tuple<number, number>',
    ],
    [
      ['Multiply', L1, P],
      'list<list<any> | tuple<number, number>> | tuple<number, number>',
    ],
    [
      ['Multiply', P, ['Multiply', 2, L1]],
      'list<list<any> | tuple<number, number>> | tuple<number, number>',
    ],
    [
      ['Divide', P, ['Multiply', 2, L1]],
      'list<list<any> | tuple<number, number>> | tuple<number, number>',
    ],
    [
      ['Add', P, L1],
      'list<list<any> | tuple<number, number>> | tuple<number, number>',
    ],
    [
      ['Subtract', P, L1],
      'list<list<any> | tuple<number, number>> | tuple<number, number>',
    ],
    [
      ['Subtract', L1, P],
      'list<list<any> | tuple<number, number>> | tuple<number, number>',
    ],
    [
      ['Negate', ['Multiply', P, L1]],
      'list<list<any> | tuple<number, number>> | tuple<number, number>',
    ],
    [['Multiply', P, 'Lu'], 'list<list<any> | tuple<number, number>>'],
    [['Add', P, 'Lu'], 'list<list<any> | tuple<number, number>>'],
    [['Multiply', P, 'b'], 'broadcastable<tuple<number, number>>'],
    [['Multiply', 'b', P], 'broadcastable<tuple<number, number>>'],
    [['Divide', P, 'b'], 'broadcastable<tuple<number, number>>'],
    [['Multiply', P, 'c'], 'broadcastable<tuple<number, number>>'],
    [['Divide', P, 'c'], 'broadcastable<tuple<number, number>>'],
    [
      ['Add', ['Multiply', P, 'b'], ['Tuple', 1, 2]],
      'broadcastable<tuple<number, number>>',
    ],
    [
      ['Multiply', P, 'u'],
      'list<list<any> | tuple<number, number>> | tuple<number, number>',
    ],
    [['Multiply', P, 'L2'], 'list<list<tuple<real, real>>>'],
  ])('box %j is typed %s', (expr, expected) => {
    expect(engine().box(expr).type.toString()).toBe(expected);
  });

  test.each<[string, string]>([
    [
      '(x,y)\\cdot(2\\cdot\\mathrm{Lu}_1)',
      'list<list<any> | tuple<number, number>> | tuple<number, number>',
    ],
    [
      '(2\\cdot\\mathrm{Lu}_1)\\cdot(x,y)',
      'list<list<any> | tuple<number, number>> | tuple<number, number>',
    ],
    [
      '(x,y)/(2\\cdot\\mathrm{Lu}_1)',
      'list<list<any> | tuple<number, number>> | tuple<number, number>',
    ],
    [
      '(x,y)-\\mathrm{Lu}_1',
      'list<list<any> | tuple<number, number>> | tuple<number, number>',
    ],
    ['(x,y)\\cdot b', 'broadcastable<tuple<number, number>>'],
    ['(x,y)/b', 'broadcastable<tuple<number, number>>'],
  ])('parse %s is typed %s', (latex, expected) => {
    expect(engine().parse(latex).type.toString()).toBe(expected);
  });

  // The precise types of a point beside an operand of known shape stay.
  test.each<[Json, string]>([
    [['Multiply', P, 2], 'tuple<real, real>'],
    [['Divide', P, 2], 'tuple<real, real>'],
    [['Multiply', P, ['List', 1, 2]], 'list<tuple<real, real>^2>'],
    [['Add', P, ['Tuple', 1, 2]], 'tuple<real, real>'],
    [['Negate', P], 'tuple<real, real>'],
  ])('box %j keeps the type %s', (expr, expected) => {
    expect(engine().box(expr).type.toString()).toBe(expected);
  });
});

describe('CE-504: the value of a point beside a possible list matches its type', () => {
  const parts: Json[] = [L1, ['Multiply', 2, L1], 'Lu', 'b', 'c', 'u', 'L2'];
  const cases: Json[] = [];
  for (const q of parts)
    cases.push(
      ['Multiply', P, q],
      ['Multiply', q, P],
      ['Divide', P, q],
      ['Add', P, q],
      ['Subtract', P, q],
      ['Subtract', q, P],
      ['Negate', ['Multiply', P, q]],
      ['Add', ['Multiply', P, q], ['Tuple', 1, 2]]
    );
  test.each(cases.map((c) => [c]))('%j', (expr) => {
    const name = symbolOf(expr);
    for (const value of VALUES[name]) {
      const ce = engine();
      const e = ce.box(expr);
      const type = e.type;
      ce.assign('x', 3);
      ce.assign('y', 4);
      ce.assign(name, ce.box(value));
      const v = e.evaluate();
      // A sum of a point and a number has no value: the evaluation answers
      // an error, which is not a value of the type.
      if (hasError(v)) continue;
      expect([value, v.toString(), v.type.matches(type)]).toEqual([
        value,
        v.toString(),
        true,
      ]);
    }
  });

  test('the ragged value of the entry', () => {
    const ce = engine();
    const e = ce.parse('(x,y)\\cdot(2\\cdot\\mathrm{Lu}_1)');
    const type = e.type;
    ce.assign('x', 3);
    ce.assign('y', 4);
    ce.assign('Lu', ce.box(['List', ['List', ['List', 1], ['List', 2, 3]]]));
    const v = e.evaluate();
    expect(v.toString()).toBe('[[(6, 8)],[(12, 16),(18, 24)]]');
    expect(v.type.matches(type)).toBe(true);
  });
});

describe('CE-504: the compiled JavaScript gives the same value or refuses', () => {
  const toJs = (j: Json): unknown =>
    Array.isArray(j) ? j.slice(1).map(toJs) : j;
  const numeric = (e: Expression): unknown =>
    e.operator === 'List' || e.operator === 'Tuple'
      ? e.ops!.map(numeric)
      : Math.round(e.N().re * 1e9) / 1e9;
  const round = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(round)
      : typeof v === 'number'
        ? Math.round(v * 1e9) / 1e9
        : v;

  const compiledCases: Json[] = [
    ['Multiply', P, L1],
    ['Divide', P, L1],
    ['Add', P, L1],
    ['Multiply', P, 'b'],
    ['Divide', P, 'b'],
    ['Negate', ['Multiply', P, 'b']],
    // The product is a point or a tensor of points, and the sum with a point
    // is refused: the lowering it took when the product was typed as a point
    // zipped a list of points against the components of `(1, 2)`.
    ['Add', ['Multiply', P, 'b'], ['Tuple', 1, 2]],
    ['Multiply', P, 'c'],
    ['Multiply', P, 'L2'],
    ['Multiply', P, 'Lu'],
  ];
  test.each(compiledCases.map((c) => [c]))('%j', (expr) => {
    const name = symbolOf(expr);
    let compiled: ReturnType<typeof compile> | undefined;
    try {
      compiled = compile(engine().box(expr), {
        to: 'javascript',
        fallback: false,
      });
    } catch {
      compiled = undefined;
    }
    if (compiled === undefined || !compiled.success) return;
    for (const value of VALUES[name]) {
      const ce = engine();
      ce.assign('x', 3);
      ce.assign('y', 4);
      ce.assign(name, ce.box(value));
      const v = ce.box(expr).evaluate();
      if (hasError(v)) continue;
      const run = compiled.run as (vars: Record<string, unknown>) => unknown;
      expect(round(run({ x: 3, y: 4, [name]: toJs(value) }))).toEqual(
        numeric(v)
      );
    }
  });

  test('the sum of a point and a tensor of points is refused', () => {
    expect(() =>
      compile(engine().box(['Add', ['Multiply', P, 'b'], ['Tuple', 1, 2]]), {
        to: 'javascript',
        fallback: false,
      })
    ).toThrow();
  });
});

describe('CE-504: a list of points beside a collection pairs the elements', () => {
  // `p` holds a list of points. Its product or quotient with a collection
  // pairs the i-th point with the i-th element of the collection, and an
  // element that is a row of numbers gives a row of points.
  const LIST_DECLARATIONS: Record<string, string> = {
    p: 'list<tuple<number, number>>',
    q: 'broadcastable<number>',
    t: 'tensor<integer>',
    v: 'vector<integer^2>',
    M: 'matrix<integer^(2x2)>',
    Ln: 'list<number>',
    Lu: 'list<unknown>',
  };
  const LIST_VALUES: Record<string, Json[]> = {
    q: [5, ['List', 1, 2], ['List', ['List', 1, 2], ['List', 3, 4]]],
    t: [
      ['List', 1, 2],
      ['List', ['List', 1, 2], ['List', 3, 4]],
    ],
    v: [['List', 1, 2]],
    M: [['List', ['List', 1, 2], ['List', 3, 4]]],
    Ln: [['List', 1, 2]],
    Lu: [
      ['List', 1, 2],
      ['List', ['List', 1, 2], ['List', 3, 4]],
      ['List', ['List', 1], ['List', 2, 3]],
    ],
  };
  const POINTS: Json = ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]];
  const listEngine = (): ComputeEngine => {
    const ce = new ComputeEngine();
    for (const [name, type] of Object.entries(LIST_DECLARATIONS))
      ce.declare(name, type);
    return ce;
  };

  test.each<[Json, string]>([
    [['Multiply', 'p', 'q'], 'list<broadcastable<tuple<number, number>>>'],
    [['Multiply', 'q', 'p'], 'list<broadcastable<tuple<number, number>>>'],
    [['Divide', 'p', 'q'], 'list<broadcastable<tuple<number, number>>>'],
    [['Multiply', 'p', 't'], 'list<broadcastable<tuple<number, number>>>'],
    [['Divide', 'p', 't'], 'list<broadcastable<tuple<number, number>>>'],
    [['Multiply', 'p', 'v'], 'list<tuple<number, number>>'],
    [['Multiply', 'v', 'p'], 'list<tuple<number, number>>'],
    [['Divide', 'p', 'v'], 'list<tuple<number, number>>'],
    [['Multiply', 'p', 'M'], 'matrix<tuple<number, number>^(2x2)>'],
    [['Multiply', 'p', 'Ln'], 'list<tuple<number, number>>'],
    [
      ['Multiply', 'p', 'Lu'],
      'list<list<list<any> | tuple<number, number>> | tuple<number, number>>',
    ],
  ])('%j is typed %s', (expr, expected) => {
    expect(listEngine().box(expr).type.toString()).toBe(expected);
  });

  const cases: Json[] = [];
  for (const n of Object.keys(LIST_VALUES))
    cases.push(['Multiply', 'p', n], ['Multiply', n, 'p'], ['Divide', 'p', n]);

  // The type is the same whether the symbols hold values when the
  // expression is boxed or not, for the symbols whose declared type does
  // not change with the value (`Lu: list<unknown>` takes the type of its
  // value), and the value matches the type in both cases.
  test.each(cases.map((c) => [c]))('%j', (expr) => {
    const name = (JSON.stringify(expr).match(/"(q|t|v|M|Ln|Lu)"/) ?? [])[1]!;
    for (const value of LIST_VALUES[name]) {
      const types: string[] = [];
      for (const before of [false, true]) {
        const ce = listEngine();
        const assign = () => {
          ce.assign('p', ce.box(POINTS));
          ce.assign(name, ce.box(value));
        };
        if (before) assign();
        const e = ce.box(expr);
        const type = e.type;
        types.push(type.toString());
        if (!before) assign();
        const v = e.evaluate();
        if (hasError(v)) continue;
        expect([value, before, v.toString(), v.type.matches(type)]).toEqual([
          value,
          before,
          v.toString(),
          true,
        ]);
      }
      if (name !== 'Lu') expect(types[1]).toBe(types[0]);
    }
  });

  test('a list of points beside numbers at any depth compiles to the value', () => {
    // The flat broadcast paired the components of each point with the
    // entries of a row: `p·q` with `q = [[1, 2], [3, 4]]` gave
    // `[[1, 4], [9, 16]]`. The compiled code keeps each point whole.
    const numeric = (e: Expression): unknown =>
      e.operator === 'List' || e.operator === 'Tuple'
        ? e.ops!.map(numeric)
        : Math.round(e.N().re * 1e9) / 1e9;
    const round = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(round)
        : typeof v === 'number'
          ? Math.round(v * 1e9) / 1e9
          : v;
    const toJs = (j: Json): unknown =>
      Array.isArray(j) ? j.slice(1).map(toJs) : j;
    for (const expr of [
      ['Multiply', 'p', 'q'],
      ['Multiply', 'q', 'p'],
      ['Divide', 'p', 'q'],
      ['Multiply', 'p', 't'],
      ['Divide', 'p', 't'],
    ] as Json[]) {
      const name = (expr as Json[]).find((x) => x === 'q' || x === 't') as
        'q' | 't';
      const compiled = compile(listEngine().box(expr), {
        to: 'javascript',
        fallback: false,
      });
      expect(compiled.success).toBe(true);
      const run = compiled.run as (vars: Record<string, unknown>) => unknown;
      for (const value of LIST_VALUES[name]) {
        const ce = listEngine();
        ce.assign('p', ce.box(POINTS));
        ce.assign(name, ce.box(value));
        const v = ce.box(expr).evaluate();
        expect([
          expr,
          value,
          round(run({ p: toJs(POINTS), [name]: toJs(value) })),
        ]).toEqual([expr, value, numeric(v)]);
      }
    }
  });

  test('a list of points beside a list of unknown elements is refused by the compiled JavaScript', () => {
    // An element of `Lu` may be a point, and the product of two points has
    // no value.
    expect(() =>
      compile(listEngine().box(['Multiply', 'p', 'Lu']), {
        to: 'javascript',
        fallback: false,
      })
    ).toThrow();
  });

  test('a list of points beside a list of numbers compiles to the value', () => {
    for (const expr of [
      ['Multiply', 'p', 'v'],
      ['Divide', 'p', 'v'],
      ['Multiply', 'p', 'Ln'],
    ] as Json[]) {
      const compiled = compile(listEngine().box(expr), {
        to: 'javascript',
        fallback: false,
      });
      expect(compiled.success).toBe(true);
      const ce = listEngine();
      const name = (expr as Json[])[2] as string;
      ce.assign('p', ce.box(POINTS));
      ce.assign(name, ce.box(['List', 1, 2]));
      const v = ce.box(expr).evaluate();
      const run = compiled.run as (vars: Record<string, unknown>) => unknown;
      const numeric = (e: Expression): unknown =>
        e.operator === 'List' || e.operator === 'Tuple'
          ? e.ops!.map(numeric)
          : e.N().re;
      expect(
        run({
          p: [
            [1, 2],
            [3, 4],
          ],
          [name]: [1, 2],
        })
      ).toEqual(numeric(v));
    }
  });
});

describe('CE-504: a point plus a declared number or tensor of numbers', () => {
  // Every value of `b: broadcastable<number>` is a number or a tensor of
  // numbers, and a point has no sum with a number. The evaluation maps over
  // a tensor: the value is an error, a tensor of errors, or `[]` for an
  // empty `b`. The sum is typed `broadcastable<error>`.
  test.each<[string]>([
    ['(x,y)+b'],
    ['b+(x,y)'],
    ['(x,y)-b'],
    ['b-(x,y)'],
    ['(x,y)+c'],
    ['(x,y)+2b'],
  ])('%s is typed broadcastable<error>', (latex) => {
    expect(engine().parse(latex).type.toString()).toBe('broadcastable<error>');
  });

  test('the values of the sum', () => {
    for (const [value, expected] of [
      [7, 'error'],
      [['List'], 'list'],
      [['List', 1, 2], 'list of errors'],
    ] as [Json, string][]) {
      const ce = engine();
      const e = ce.parse('(x,y)+b');
      const type = e.type;
      ce.assign('b', ce.box(value));
      const v = e.evaluate();
      if (expected === 'list of errors') {
        // Each element is an error. The literal type of a list of errors is
        // `list<unknown>`, so each element is checked instead.
        expect(v.operator).toBe('List');
        expect(v.ops!.every((x) => x.type.matches('error'))).toBe(true);
      } else expect([value, v.type.matches(type)]).toEqual([value, true]);
    }
  });

  test('an operand whose type was only inferred is not read', () => {
    // `q` is auto-declared: its value may be a point.
    const ce = engine();
    expect(ce.parse('(x,y)+q\\cdot b').type.toString()).not.toBe(
      'broadcastable<error>'
    );
  });
});

describe('CE-504: review follow-ups', () => {
  test('a list of points times a broadcastable of points is refused by the compiled JavaScript', () => {
    // The product of two points has no value (`no-product-between-points`).
    const ce = new ComputeEngine();
    ce.declare('p', 'list<tuple<integer, integer>>');
    ce.declare('q', 'broadcastable<tuple<integer, integer>>');
    expect(() =>
      compile(ce.box(['Multiply', 'p', 'q']), {
        to: 'javascript',
        fallback: false,
      })
    ).toThrow();
  });

  test.each<[string, boolean, string]>([
    ['list<integer | list<integer>>', false, 'Multiply'],
    ['list<integer | list<integer>>', false, 'Divide'],
    ['list', true, 'Multiply'],
    ['list', true, 'Divide'],
  ])(
    'a point and %s with elements that are numbers or lists (value first: %s), %s',
    (declared, valueFirst, head) => {
      const ce = new ComputeEngine();
      ce.declare('L', declared as never);
      ce.declare('x', 'real');
      ce.declare('y', 'real');
      const value = ce.box(['List', ['List', 1], 2]);
      if (valueFirst) ce.assign('L', value);
      const e = ce.box([head, ['Tuple', 'x', 'y'], 'L']);
      const type = e.type;
      if (!valueFirst) ce.assign('L', value);
      ce.assign('x', 1);
      ce.assign('y', 2);
      const v = e.evaluate();
      expect(v.toString()).toBe(
        head === 'Multiply' ? '[[(1, 2)],(2, 4)]' : '[[(1, 2)],(1/2, 1)]'
      );
      expect(v.type.matches(type)).toBe(true);
    }
  );

  test('an integer-valued float in a list makes the cells of the product real', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'list<tuple<rational, rational>>');
    const e = ce.box(['Multiply', 'p', ['List', { num: '2.0' }]]);
    const type = e.type;
    expect(type.toString()).toBe('list<tuple<real, real>>');
    ce.assign('p', ce.box(['List', ['Tuple', ['Rational', 1, 3], 1]]));
    expect(e.evaluate().type.matches(type)).toBe(true);
    // With an exact integer the cells stay rational.
    expect(ce.box(['Multiply', 'p', ['List', 2]]).type.toString()).toBe(
      'list<tuple<rational, rational>>'
    );
  });

  test('a list of points times an element read of a list<unknown> has no number arm', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'list<tuple<number, number>>');
    ce.declare('Lu', 'list<unknown>');
    expect(ce.box(['Multiply', 'p', ['At', 'Lu', 1]]).type.toString()).toBe(
      'list<list<list<any> | tuple<number, number>> | tuple<number, number>>'
    );
  });
});

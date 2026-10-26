import { ComputeEngine, compile } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

/**
 * A user function whose parameter is declared as a point
 * (`k: (tuple<number, number>) -> number`) maps a call over a value of a
 * recursive alias whose self-reference is inside a constructor, such as
 * `type A = list<A> | list<tuple<number, number>>`. The type does not fix
 * the rank of the value, so the evaluation reads it from the value: a list
 * of points gives a list of results, a list of lists of points gives a list
 * of lists of results. The call is typed as a list of results whose depth
 * is not fixed (user decision 2026-10-26, option A, ROADMAP CE-489).
 * Before, `k(y)` with `y: A` was typed `error` and evaluated to an
 * `incompatible-type` error.
 */

const RECURSIVE = 'list<A> | list<tuple<number, number>>';
const RESULT = 'list<list<list> | list<number>> | list<number>';

const POINTS = ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]];
const NESTED = ['List', ['List', ['Tuple', 1, 2]], ['List', ['Tuple', 3, 4]]];
const RAGGED = [
  'List',
  ['List', ['Tuple', 1, 2]],
  ['List', ['List', ['Tuple', 3, 4]]],
];

function engine(def: string, alias = true): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declareType('A', def, { alias });
  ce.declare('k', '(tuple<number, number>) -> number');
  ce.assign(
    'k',
    ce.box(['Function', ['Add', ['At', 'p', 1], ['At', 'p', 2]], 'p'])
  );
  ce.declare('y', 'A');
  return ce;
}

/** Whether the value of `e` is of the static type of `e`. */
function valueFits(e: Expression): boolean {
  return e.evaluate().type.matches(e.type);
}

describe('CE-489: a recursive alias at a declared point parameter', () => {
  test('the type of the call before the symbol has a value', () => {
    const ce = engine(RECURSIVE);
    expect(ce.box(['k', 'y']).type.toString()).toBe(RESULT);
    expect(ce.parse('k(y)').type.toString()).toBe(RESULT);
  });

  test.each([
    ['a list of points', POINTS, '[3,7]'],
    ['a list of lists of points', NESTED, '[[3],[7]]'],
    ['rows of different depths', RAGGED, '[[3],[[7]]]'],
  ])('%s, on the box and parse routes', (_, value, expected) => {
    const ce = engine(RECURSIVE);
    ce.assign('y', ce.box(value as any));
    for (const e of [ce.box(['k', 'y']), ce.parse('k(y)')]) {
      expect(e.type.toString()).toBe(RESULT);
      expect(e.evaluate().toString()).toBe(expected);
      expect(valueFits(e)).toBe(true);
    }
    // The same value as a literal gives the same result.
    expect(
      ce
        .box(['k', value] as any)
        .evaluate()
        .toString()
    ).toBe(expected);
  });

  test('a function literal that calls k(y)', () => {
    const ce = engine(RECURSIVE);
    ce.assign('y', ce.box(NESTED as any));
    for (const e of [
      ce.box(['Apply', ['Function', ['k', 'y'], 's'], 1]),
      ce.parse('(s \\mapsto k(y))(1)'),
    ]) {
      expect(e.type.toString()).toBe(RESULT);
      expect(e.evaluate().toString()).toBe('[[3],[7]]');
      expect(valueFits(e)).toBe(true);
    }
    ce.parse('w(s) := k(y)').evaluate();
    const e = ce.parse('w(1)');
    expect(e.type.toString()).toBe(RESULT);
    expect(e.evaluate().toString()).toBe('[[3],[7]]');
  });

  test('the compiled call reads the depth from the value', () => {
    const ce = engine(RECURSIVE);
    const r = compile(
      ce.box(['Function', ['k', 'w'], ['Typed', 'w', "'A'"]] as any),
      { fallback: false } as any
    ) as any;
    expect(r.success).toBe(true);
    expect(
      r.run([
        [1, 2],
        [3, 4],
      ])
    ).toEqual([3, 7]);
    expect(r.run([[[1, 2]], [[[3, 4]]]])).toEqual([[3], [[7]]]);
  });

  test('a value that is not a nesting of points is refused', () => {
    const ce = engine(RECURSIVE);
    expect(() => ce.assign('y', ce.box(['List', ['Tuple', 1, 2], 3]))).toThrow(
      /not compatible with the type "A"/
    );
    // The literal is refused with an `incompatible-type` error.
    const lit = ce.box(['k', ['List', ['Tuple', 1, 2], 3]]);
    expect(lit.type.toString()).toBe('error');
    expect(lit.evaluate().toString()).toMatch(/incompatible-type/);
  });

  test('a list whose elements can be a point or a list', () => {
    // The call maps over a value whose lists do not mix points and lists.
    // The evaluation refuses a value such as `[(1, 2), [(3, 4)]]`: a row of
    // a tensor of points must be a list. The type of the call has an
    // `error` arm for it (ROADMAP CE-505; before, the type was `error`).
    const ce = engine('list<A | tuple<number, number>>');
    const type = 'error | list<list<list | number> | number>';
    expect(ce.box(['k', 'y']).type.toString()).toBe(type);
    ce.assign('y', ce.box(NESTED as any));
    expect(ce.box(['k', 'y']).evaluate().toString()).toBe('[[3],[7]]');
    ce.assign(
      'y',
      ce.box(['List', ['Tuple', 1, 2], ['List', ['Tuple', 3, 4]]])
    );
    const e = ce.box(['k', 'y']);
    expect(e.type.toString()).toBe(type);
    expect(e.evaluate().toString()).toMatch(/incompatible-type/);
    expect(e.evaluate().type.matches(e.type)).toBe(true);
    expect(
      ce
        .box(['k', ['List', ['Tuple', 1, 2], ['List', ['Tuple', 3, 4]]]])
        .evaluate()
        .toString()
    ).toMatch(/incompatible-type/);
  });

  test('a recursive alias with a leaf that is not a point is refused', () => {
    const ce = engine('list<A> | list<integer>');
    expect(ce.box(['k', 'y']).type.toString()).toBe('error');
  });

  test('a self-reference outside a constructor keeps its type', () => {
    const ce = engine('A | list<tuple<number, number>>');
    expect(ce.box(['k', 'y']).type.toString()).toBe('list<number>');
    ce.assign('y', ce.box(POINTS as any));
    expect(ce.box(['k', 'y']).evaluate().toString()).toBe('[3,7]');
  });

  // A nominal type is opaque: it is not a subtype of its definition, so the
  // typing does not read through it, and a list value is not of that type.
  test('a nominal recursive type', () => {
    const ce = engine(RECURSIVE, false);
    const e = ce.box(['k', 'y']);
    expect(e.type.toString()).toBe('error');
    expect(e.evaluate().type.toString()).toBe('error');
    expect(() => ce.assign('y', ce.box(POINTS as any))).toThrow(
      /not compatible with the type "A"/
    );
  });
});

/**
 * A union whose arms are points, lists of points or tensors of points of
 * DIFFERENT ranks, such as `list<P> | list<list<P>>`, at a parameter
 * declared as the point `P`. A value of such a type has one depth, and the
 * evaluation reads it from the value. The call is typed as the union of the
 * result of each arm. Before, the call was typed `error` and evaluated to an
 * `incompatible-type` error, though each arm maps (ROADMAP CE-489).
 */
describe('CE-489: a union of point arms of different ranks', () => {
  const P = 'tuple<number, number>';

  function withY(type: string): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('k', `(${P}) -> number`);
    ce.assign(
      'k',
      ce.box(['Function', ['Add', ['At', 'p', 1], ['At', 'p', 2]], 'p'])
    );
    ce.declare('y', type);
    return ce;
  }

  test.each([
    [`list<${P}> | list<list<${P}>>`, 'list<list<number>> | list<number>'],
    [
      `list<${P}> | list<list<${P}>> | missing`,
      'list<list<number>> | list<number> | missing',
    ],
    [
      `list<${P}> | list<list<list<${P}>>>`,
      'list<list<list<number>>> | list<number>',
    ],
    [`matrix<${P}^(2x2)> | list<${P}>`, 'list<list<number>> | list<number>'],
    [`${P} | list<list<${P}>>`, 'list<list<number>> | number'],
  ])('the type of k(y) with y: %s', (type, expected) => {
    const ce = withY(type);
    expect(ce.box(['k', 'y']).type.toString()).toBe(expected);
    expect(ce.parse('k(y)').type.toString()).toBe(expected);
  });

  test.each([
    ['a list of points', POINTS, '[3,7]'],
    ['a list of lists of points', NESTED, '[[3],[7]]'],
    [
      'rows of different lengths',
      [
        'List',
        ['List', ['Tuple', 1, 2]],
        ['List', ['Tuple', 3, 4], ['Tuple', 5, 6]],
      ],
      '[[3],[7,11]]',
    ],
  ])('%s, on the box, parse and function routes', (_, value, expected) => {
    const ce = withY(`list<${P}> | list<list<${P}>>`);
    ce.assign('y', ce.box(value as any));
    for (const e of [
      ce.box(['k', 'y']),
      ce.parse('k(y)'),
      ce.function('k', [ce.symbol('y')]),
    ]) {
      expect(e.type.toString()).toBe('list<list<number>> | list<number>');
      expect(e.evaluate().toString()).toBe(expected);
      expect(valueFits(e)).toBe(true);
    }
    // The same value as a literal gives the same result.
    expect(
      ce
        .box(['k', value] as any)
        .evaluate()
        .toString()
    ).toBe(expected);
  });

  test('a function that passes its argument to k', () => {
    const ce = withY(`list<${P}> | list<list<${P}>>`);
    ce.declare('g', `(list<${P}> | list<list<${P}>>) -> any`);
    ce.assign('g', ce.box(['Function', ['k', 'q'], 'q']));
    ce.assign('y', ce.box(NESTED as any));
    const e = ce.box(['g', 'y']);
    expect(e.type.toString()).toBe('list<list<number>> | list<number>');
    expect(e.evaluate().toString()).toBe('[[3],[7]]');
    expect(valueFits(e)).toBe(true);
  });

  test('one point or a list of lists of points', () => {
    const ce = withY(`${P} | list<list<${P}>>`);
    ce.assign('y', ce.box(['Tuple', 1, 2]));
    let e = ce.box(['k', 'y']);
    expect(e.evaluate().toString()).toBe('3');
    expect(valueFits(e)).toBe(true);
    ce.assign('y', ce.box(NESTED as any));
    e = ce.box(['k', 'y']);
    expect(e.evaluate().toString()).toBe('[[3],[7]]');
    expect(valueFits(e)).toBe(true);
  });

  test('an arm that is not a nesting of points is refused', () => {
    const ce = withY(`list<${P}> | list<list<string>>`);
    expect(ce.box(['k', 'y']).type.toString()).toBe('error');
  });

  test('a list whose elements can be a point or a list of points', () => {
    // The call maps over a value whose lists do not mix points and lists.
    // A value where one list holds both is refused: a row of a tensor of
    // points must be a list. The type of the call has an `error` arm for
    // it (ROADMAP CE-505; before, the type was `error`). The literal is
    // refused in the same way.
    const ce = withY(`list<${P} | list<${P}>>`);
    expect(ce.box(['k', 'y']).type.toString()).toBe(
      'error | list<list<number> | number>'
    );
    expect(
      ce
        .box(['k', ['List', ['Tuple', 1, 2], ['List', ['Tuple', 3, 4]]]])
        .evaluate()
        .toString()
    ).toMatch(/incompatible-type/);
  });

  test('the compiled call reads the depth from the value', () => {
    const ce = withY(`list<${P}> | list<list<${P}>>`);
    const r = compile(
      ce.box([
        'Function',
        ['k', 'w'],
        ['Typed', 'w', `'list<${P}> | list<list<${P}>>'`],
      ] as any),
      { fallback: false } as any
    ) as any;
    expect(r.success).toBe(true);
    expect(
      r.run([
        [1, 2],
        [3, 4],
      ])
    ).toEqual([3, 7]);
    expect(r.run([[[1, 2]], [[3, 4]]])).toEqual([[3], [7]]);
    // One point or a list of lists of points.
    const q = compile(
      ce.box([
        'Function',
        ['k', 'w'],
        ['Typed', 'w', `'${P} | list<list<${P}>>'`],
      ] as any),
      { fallback: false } as any
    ) as any;
    expect(q.success).toBe(true);
    expect(q.run([1, 2])).toEqual(3);
    expect(q.run([[[1, 2]], [[3, 4]]])).toEqual([[3], [7]]);
  });
});

/**
 * Cases of a recursive alias at a declared point parameter that the first
 * version of the rule did not cover. For each value, the boxed and the
 * parsed calls give the same value, the value fits the static type of the
 * call, and the compiled call gives the same value. A `List` or a `Tuple`
 * of the MathJSON value is an array of the compiled value, and `Missing` is
 * `undefined`.
 */
describe('CE-489: more recursive aliases at a declared point parameter', () => {
  const P = 'tuple<number, number>';

  function withY(def: string | undefined, type: string): ComputeEngine {
    const ce = new ComputeEngine();
    if (def !== undefined) ce.declareType('A', def, { alias: true });
    ce.declare('k', `(${P}) -> number`);
    ce.assign(
      'k',
      ce.box(['Function', ['Add', ['At', 'p', 1], ['At', 'p', 2]], 'p'])
    );
    ce.declare('y', type);
    return ce;
  }

  function plain(x: unknown): unknown {
    if (x === 'Missing') return undefined;
    return Array.isArray(x) && (x[0] === 'List' || x[0] === 'Tuple')
      ? x.slice(1).map(plain)
      : x;
  }

  /** Check the call `k(y)` for each value: box, parse, compiled. */
  function check(
    def: string | undefined,
    type: string,
    values: ReadonlyArray<[unknown, string]>
  ): void {
    const ce = withY(def, type);
    const r = compile(
      ce.box(['Function', ['k', 'w'], ['Typed', 'w', `'${type}'`]] as any),
      { fallback: false } as any
    ) as any;
    expect(r.success).toBe(true);
    for (const [value, expected] of values) {
      ce.assign('y', ce.box(value as any));
      for (const e of [ce.box(['k', 'y']), ce.parse('k(y)')]) {
        const v = e.evaluate();
        expect(v.toString()).toBe(expected);
        expect(v.type.matches(e.type)).toBe(true);
        expect(r.run(plain(ce.box(value as any).json))).toEqual(plain(v.json));
      }
    }
  }

  const EMPTY_ROW = ['List', ['List']];
  const EMPTY_DEEP = ['List', ['List', ['List']], ['List', ['Tuple', 1, 2]]];

  // A `missing` arm anywhere in the alias. Before, the walk unfolded the
  // alias again at each level, never met the reference, and the call was
  // typed `error`.
  test.each([
    [
      'list<A> | list<P> | missing',
      'list<list<list | missing | number> | list<missing | number> | missing> | list<missing | number> | missing',
      [
        [POINTS, '[3,7]'],
        [NESTED, '[[3],[7]]'],
        ['Missing', '"Missing"'],
        [['List', 'Missing', ['List', ['Tuple', 1, 2]]], '["Missing",[3]]'],
      ],
    ],
    [
      'list<A | missing> | list<P>',
      'list<list<list | missing> | list<missing | number> | missing> | list<missing | number>',
      [
        [NESTED, '[[3],[7]]'],
        [['List', 'Missing', ['List', ['Tuple', 1, 2]]], '["Missing",[3]]'],
      ],
    ],
    [
      'list<A> | list<P | missing>',
      'list<list<list | missing> | list<missing | number> | missing> | list<missing | number>',
      [
        [['List', 'Missing', ['Tuple', 1, 2]], '["Missing",3]'],
        [
          ['List', ['List', 'Missing'], ['List', ['Tuple', 1, 2]]],
          '[["Missing"],[3]]',
        ],
      ],
    ],
  ] as const)('a missing arm: A = %s', (def, expected, values) => {
    const d = def.replace(/\bP\b/g, P);
    const ce = withY(d, 'A');
    expect(ce.box(['k', 'y']).type.toString()).toBe(expected);
    expect(ce.parse('k(y)').type.toString()).toBe(expected);
    check(d, 'A', values as any);
  });

  // An empty list at any depth maps to an empty list. Before, the
  // interpreter bound `[[]]` whole, an `incompatible-type` error outside
  // the static type, and the compiled call gave `[[]]`.
  test.each([
    [`list<A> | list<${P}>`, 'A'],
    [undefined, `list<list<${P}>>`],
    [undefined, `list<${P}> | list<list<${P}>>`],
  ])('an empty row: A = %s, y: %s', (def, type) => {
    check(def, type, [[EMPTY_ROW, '[[]]']]);
  });

  test('an empty row beside a row of points', () => {
    check(`list<A> | list<${P}>`, 'A', [[EMPTY_DEEP, '[[[]],[3]]']]);
    check(undefined, `list<list<${P}>>`, [
      [['List', ['List'], ['List', ['Tuple', 1, 2]]], '[[],[3]]'],
    ]);
  });

  // A bare point beside a recursive alias. Before, the call was typed
  // `number`, while a list value maps to a list.
  test('a point or a recursive alias', () => {
    const def = `list<A> | list<${P}>`;
    const ce = withY(def, `${P} | A`);
    expect(ce.box(['k', 'y']).type.toString()).toBe(`${RESULT} | number`);
    check(def, `${P} | A`, [
      [['Tuple', 1, 2], '3'],
      [POINTS, '[3,7]'],
      [NESTED, '[[3],[7]]'],
      [RAGGED, '[[3],[[7]]]'],
    ]);
  });

  // An alias with no point anywhere holds only nested empty lists: the
  // call is refused, as for a leaf that is not a point.
  test('a recursive alias with no point is refused', () => {
    const ce = withY('list<A>', 'A');
    expect(ce.box(['k', 'y']).type.toString()).toBe('error');
    expect(ce.parse('k(y)').type.toString()).toBe('error');
  });
});

/**
 * A recursive alias whose point is an arm of the alias itself,
 * `type B = list<B> | tuple<number, number>`: a value of `B` is a point, or
 * a list of values of `B`. The call maps by the depth of the value: a point
 * gives a number, a list of points a list of numbers, and so on. A list
 * whose elements mix points and lists (`[(1, 2), [(3, 4)]]`) is refused
 * with the `incompatible-type` error that a literal of that shape gets, so
 * the type of the call has an `error` arm, and the compiled call gives
 * `NaN` for such a value. Before, `k(y)` with `y: B` was typed `error` and
 * evaluated to an `incompatible-type` error for every value (ROADMAP
 * CE-505).
 */
describe('CE-505: a recursive alias with a point arm', () => {
  const P = 'tuple<number, number>';
  const B_TYPE = 'error | list<list<list | number> | number> | number';
  const MIXED = ['List', ['Tuple', 1, 2], ['List', ['Tuple', 3, 4]]];

  function withB(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declareType('B', `list<B> | ${P}`, { alias: true });
    ce.declare('k', `(${P}) -> number`);
    ce.assign(
      'k',
      ce.box(['Function', ['Add', ['At', 'p', 1], ['At', 'p', 2]], 'p'])
    );
    ce.declare('y', 'B');
    return ce;
  }

  function plain(x: unknown): unknown {
    return Array.isArray(x) && (x[0] === 'List' || x[0] === 'Tuple')
      ? x.slice(1).map(plain)
      : x;
  }

  test('the type of the call before the symbol has a value', () => {
    const ce = withB();
    expect(ce.box(['k', 'y']).type.toString()).toBe(B_TYPE);
    expect(ce.parse('k(y)').type.toString()).toBe(B_TYPE);
  });

  test.each([
    ['one point', ['Tuple', 1, 2], '3'],
    ['a list of points', POINTS, '[3,7]'],
    ['a list of lists of points', ['List', ['List', ['Tuple', 1, 2]]], '[[3]]'],
    ['rows of different depths', RAGGED, '[[3],[[7]]]'],
    ['the empty list', ['List'], '[]'],
  ])('%s: box, parse, derived and compiled routes', (_, value, expected) => {
    const ce = withB();
    const r = compile(
      ce.box(['Function', ['k', 'w'], ['Typed', 'w', "'B'"]] as any),
      { fallback: false } as any
    ) as any;
    expect(r.success).toBe(true);
    ce.assign('y', ce.box(value as any));
    for (const e of [
      ce.box(['k', 'y']),
      ce.parse('k(y)'),
      ce.box(['Apply', ['Function', ['k', 'y'], 's'], 1]),
      ce.parse('(s \\mapsto k(y))(1)'),
    ]) {
      const v = e.evaluate();
      expect(v.toString()).toBe(expected);
      expect(v.type.matches(e.type)).toBe(true);
    }
    // The same value as a literal gives the same result.
    expect(
      ce
        .box(['k', value] as any)
        .evaluate()
        .toString()
    ).toBe(expected);
    expect(r.run(plain(value))).toEqual(
      plain(ce.box(['k', 'y']).evaluate().json)
    );
  });

  test.each([
    ['a list that mixes points and lists', MIXED],
    [
      'a row that mixes points and lists',
      ['List', ['List', ['Tuple', 1, 2]], MIXED],
    ],
  ])('%s is refused', (_, value) => {
    const ce = withB();
    ce.assign('y', ce.box(value as any));
    for (const e of [ce.box(['k', 'y']), ce.parse('k(y)')]) {
      expect(e.type.toString()).toBe(B_TYPE);
      const v = e.evaluate();
      expect(v.toString()).toMatch(/incompatible-type/);
      expect(v.type.matches(e.type)).toBe(true);
    }
    // The literal of the same shape gets the same error.
    expect(
      ce
        .box(['k', value] as any)
        .evaluate()
        .toString()
    ).toMatch(/incompatible-type/);
    // The compiled call gives `NaN`, as for an error of the interpreter.
    const r = compile(
      ce.box(['Function', ['k', 'w'], ['Typed', 'w', "'B'"]] as any),
      { fallback: false } as any
    ) as any;
    expect(r.success).toBe(true);
    expect(r.run(plain(value))).toBeNaN();
  });

  test('a function that passes its argument to k', () => {
    const ce = withB();
    ce.declare('g', '(B) -> any');
    ce.assign('g', ce.box(['Function', ['k', 'q'], 'q']));
    ce.assign('y', ce.box(NESTED as any));
    const e = ce.box(['g', 'y']);
    expect(e.evaluate().toString()).toBe('[[3],[7]]');
    expect(e.evaluate().type.matches(e.type)).toBe(true);
  });

  test('a list of values of the alias', () => {
    const ce = withB();
    ce.declare('z', 'list<B>');
    for (const [value, expected] of [
      [POINTS, '[3,7]'],
      [NESTED, '[[3],[7]]'],
    ] as const) {
      ce.assign('z', ce.box(value as any));
      const e = ce.box(['k', 'z']);
      const v = e.evaluate();
      expect(v.toString()).toBe(expected);
      expect(v.type.matches(e.type)).toBe(true);
    }
  });

  // The same rule for a list whose element type is a written union, and
  // for an alias whose list element is such a union. For each value, the
  // boxed and the parsed calls give the same value, the value fits the type
  // of the call, and the compiled call gives the same value, or `NaN` where
  // the interpreter gives an error.
  test.each([
    [undefined, `list<${P} | list<${P}>>`],
    [`list<A | ${P}>`, 'A'],
    [undefined, 'list<B>'],
  ])('a list that can hold both: A = %s, y: %s', (def, type) => {
    const ce = withB();
    if (def !== undefined) ce.declareType('A', def, { alias: true });
    ce.declare('z', type);
    expect(ce.box(['k', 'z']).type.toString()).toMatch(/^error \| list</);
    const r = compile(
      ce.box(['Function', ['k', 'w'], ['Typed', 'w', `'${type}'`]] as any),
      { fallback: false } as any
    ) as any;
    expect(r.success).toBe(true);
    for (const [value, expected] of [
      [POINTS, '[3,7]'],
      [NESTED, '[[3],[7]]'],
      [['List'], '[]'],
      [MIXED, undefined],
    ] as const) {
      ce.assign('z', ce.box(value as any));
      for (const e of [ce.box(['k', 'z']), ce.parse('k(z)')]) {
        const v = e.evaluate();
        if (expected === undefined)
          expect(v.toString()).toMatch(/incompatible-type/);
        else expect(v.toString()).toBe(expected);
        expect(v.type.matches(e.type)).toBe(true);
      }
      if (expected === undefined) expect(r.run(plain(value))).toBeNaN();
      else
        expect(r.run(plain(value))).toEqual(
          plain(ce.box(['k', 'z']).evaluate().json)
        );
    }
  });
});

/**
 * A literal empty list at a point parameter maps to the empty list, without
 * a call of the function. The call is typed as a map, `list<R>`, which holds
 * `[]`. Before, `k([])` was typed `number` (ROADMAP CE-506).
 */
describe('CE-506: an empty list at a point parameter', () => {
  const P = 'tuple<number, number>';

  function withK(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('k', `(${P}) -> number`);
    ce.assign(
      'k',
      ce.box(['Function', ['Add', ['At', 'p', 1], ['At', 'p', 2]], 'p'])
    );
    return ce;
  }

  test.each([
    ['k([])', ['List'], 'list<number>', '[]'],
    ['k([[]])', ['List', ['List']], 'list<list<number>>', '[[]]'],
  ])('%s on the box, parse and derived routes', (latex, arg, type, value) => {
    const ce = withK();
    for (const e of [
      ce.box(['k', arg] as any),
      ce.parse(latex),
      ce.box(['Apply', ['Function', ['k', arg], 's'], 1] as any),
    ]) {
      expect(e.type.toString()).toBe(type);
      const v = e.evaluate();
      expect(v.toString()).toBe(value);
      expect(v.type.matches(e.type)).toBe(true);
    }
    const r = compile(ce.box(['Function', ['k', arg], 's'] as any), {
      fallback: false,
    } as any) as any;
    expect(r.success).toBe(true);
    expect(r.run(1)).toEqual(arg.length === 1 ? [] : [[]]);
  });

  test('a symbol declared list<never> that holds []', () => {
    // Before, the call was refused with an `incompatible-type` error, while
    // the literal `[]` maps.
    const ce = withK();
    ce.declare('z', 'list<never>');
    ce.assign('z', ce.box(['List']));
    for (const e of [ce.box(['k', 'z']), ce.parse('k(z)')]) {
      expect(e.type.toString()).toBe('list<number>');
      const v = e.evaluate();
      expect(v.toString()).toBe('[]');
      expect(v.type.matches(e.type)).toBe(true);
    }
    const r = compile(
      ce.box(['Function', ['k', 'w'], ['Typed', 'w', "'list<never>'"]] as any),
      { fallback: false } as any
    ) as any;
    expect(r.success).toBe(true);
    expect(r.run([])).toEqual([]);
  });

  test('a symbol declared as a list of points that holds []', () => {
    const ce = withK();
    ce.declare('z', `list<${P}>`);
    ce.assign('z', ce.box(['List']));
    const e = ce.box(['k', 'z']);
    expect(e.type.toString()).toBe('list<number>');
    const v = e.evaluate();
    expect(v.toString()).toBe('[]');
    expect(v.type.matches(e.type)).toBe(true);
    const r = compile(
      ce.box(['Function', ['k', 'w'], ['Typed', 'w', `'list<${P}>'`]] as any),
      { fallback: false } as any
    ) as any;
    expect(r.success).toBe(true);
    expect(r.run([])).toEqual([]);
  });
});

/**
 * Cases found in the review of the rules above (ROADMAP CE-505, CE-506).
 * For each call, the value fits the static type on the box, parse and
 * function-literal routes, and the compiled call gives the same value.
 */
describe('CE-505, CE-506: more cases at a point parameter', () => {
  const P = 'tuple<number, number>';

  function withK(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('k', `(${P}) -> number`);
    ce.assign(
      'k',
      ce.box(['Function', ['Add', ['At', 'p', 1], ['At', 'p', 2]], 'p'])
    );
    return ce;
  }

  function routes(ce: ComputeEngine, arg: unknown, latex: string) {
    return [
      ce.box(['k', arg] as any),
      ce.parse(`k(${latex})`),
      ce.box(['Apply', ['Function', ['k', arg], 's'], 1] as any),
    ];
  }

  // A symbol with no value yet holds the call, as a valueless list of
  // points does. Before, the call was typed `list<number>` and evaluated to
  // an `incompatible-type` error.
  test('a valueless symbol declared list<never>', () => {
    const ce = withK();
    ce.declare('z', 'list<never>');
    for (const e of routes(ce, 'z', 'z')) {
      const v = e.evaluate();
      expect(v.toString()).toBe('k(z)');
      expect(v.type.matches(e.type)).toBe(true);
    }
  });

  // An absent value makes the call `Missing`, as for a symbol declared
  // `list<P> | missing`. Before, the call was typed `list<number>` and
  // evaluated to an `incompatible-type` error.
  test('a symbol declared list<never> | missing that holds Missing', () => {
    const ce = withK();
    ce.declare('z', 'list<never> | missing');
    expect(ce.box(['k', 'z']).type.toString()).toBe('list<number> | missing');
    ce.assign('z', ce.box('Missing'));
    for (const e of routes(ce, 'z', 'z')) {
      expect(e.type.toString()).toBe('list<number> | missing');
      const v = e.evaluate();
      expect(v.toString()).toBe('"Missing"');
      expect(v.type.matches(e.type)).toBe(true);
    }
    const r = compile(
      ce.box([
        'Function',
        ['k', 'w'],
        ['Typed', 'w', "'list<never> | missing'"],
      ] as any),
      { fallback: false } as any
    ) as any;
    expect(r.success).toBe(true);
    // `Missing` is `undefined` in the compiled code.
    expect(r.run(undefined)).toBeUndefined();
    expect(r.run([])).toEqual([]);
  });

  // A row that is a symbol typed as a list of points is a list, not a
  // point. Before, `[r, [(3, 4)]]` was read as a mix of a point and a list,
  // and refused.
  test('a row that is a symbol holding a list of points', () => {
    const ce = withK();
    ce.declare('r', `list<${P}>`);
    ce.assign('r', ce.box(['List', ['Tuple', 1, 2]]));
    const arg = ['List', 'r', ['List', ['Tuple', 3, 4]]];
    for (const e of routes(ce, arg, '[r, [(3, 4)]]')) {
      const v = e.evaluate();
      expect(v.toString()).toBe('[[3],[7]]');
      expect(v.type.matches(e.type)).toBe(true);
    }
  });

  // A point arm that is an alias of a union of tuples is a cell of the
  // map at every depth. Before, the cut of the recursive alias read such a
  // declaration as surely a list, and the type did not hold `[[3]]`.
  test('a point arm that is an alias of a union of tuples', () => {
    const ce = withK();
    ce.declareType('C', 'tuple<integer, real> | tuple<real, integer>', {
      alias: true,
    });
    ce.declareType('B', 'list<B> | C', { alias: true });
    ce.declare('y', 'B');
    const r = compile(
      ce.box(['Function', ['k', 'w'], ['Typed', 'w', "'B'"]] as any),
      { fallback: false } as any
    ) as any;
    expect(r.success).toBe(true);
    for (const [value, plain, expected] of [
      [['Tuple', 1, 2], [1, 2], 3],
      [['List', ['Tuple', 1, 2]], [[1, 2]], [3]],
      [['List', ['List', ['Tuple', 1, 2]]], [[[1, 2]]], [[3]]],
      [['List', ['List', ['List', ['Tuple', 1, 2]]]], [[[[1, 2]]]], [[[3]]]],
    ] as const) {
      ce.assign('y', ce.box(value as any));
      for (const e of routes(ce, 'y', 'y')) {
        const v = e.evaluate();
        expect(v.type.matches(e.type)).toBe(true);
        expect(r.run(plain)).toEqual(expected);
      }
    }
  });
});

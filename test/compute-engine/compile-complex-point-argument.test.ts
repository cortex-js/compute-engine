/**
 * A point (or a list) that holds a complex number, given to an
 * engine-level function whose parameter is a point with no complex type.
 *
 * The parameter type of `h = (p) => p[1] + 1` is inferred from the body as
 * `tuple<number>`, and the emitted body reads the coordinates of `p` as
 * real numbers. With `P: list<tuple<complex, real>>`, the compiled
 * `h(P[1])` added `1` to a `{re, im}` object and gave the string
 * "[object Object]1", where the interpreter gives `2 + i`. Such a call is
 * now a lane mismatch: `mode: 'complex'` compiles it, and in
 * `mode: 'strict'` (the default) it declines.
 * The same test applies to the callback of `Map` and to the combiner of
 * `Reduce`, `Fold` and `Scan`.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();
ce.assign('h', ce.box(['Function', ['Add', ['At', 'p', 1], 1], 'p'] as any));
ce.assign(
  'h2',
  ce.box(['Function', ['Add', ['At', 'p', 1], ['At', 'p', 2]], 'p'] as any)
);
ce.assign(
  'k2',
  ce.box([
    'Function',
    ['Add', 'a', ['At', 'v', 1], ['At', 'v', 2]],
    'a',
    'v',
  ] as any)
);
ce.assign('first', ce.box(['Function', ['At', 'L', 1], 'L'] as any));
ce.assign('add2', ce.box(['Function', ['Add', 'a', 'x'], 'a', 'x'] as any));
// A point parameter with a complex first coordinate and a real second one.
ce.assign(
  'h3',
  ce.box([
    'Function',
    ['Add', ['At', 'p', 2], 1],
    ['Typed', 'p', "'tuple<complex, number>'"],
  ] as any)
);
// Parameters with no type (`unknown`).
ce.assign('g9', ce.box(['Function', ['Multiply', 2, 'p'], 'p'] as any));
ce.assign('g8', ce.box(['Function', ['Abs', 'p'], 'p'] as any));
ce.assign('g3', ce.box(['Function', ['Norm', 'p'], 'p'] as any));
// A parameter with `any` elements (`collection`, `indexed_collection<any>`).
ce.assign('len', ce.box(['Function', ['Length', 'L'], 'L'] as any));
ce.assign(
  'gl',
  ce.box(['Function', ['Add', ['Last', ['Reverse', 'p']], 1], 'p'] as any)
);
ce.assign(
  'gl2',
  ce.box([
    'Function',
    ['Multiply', 2, ['First', ['Reverse', ['Reverse', 'p']]]],
    'p',
  ] as any)
);
ce.assign(
  'ha',
  ce.box([
    'Function',
    ['Add', ['At', 'p', 1], 1],
    ['Typed', 'p', "'tuple<any, real>'"],
  ] as any)
);
// A parameter of a union type that admits a number and a collection
// (`collection<any> | value`).
ce.assign('gm', ce.box(['Function', ['Add', ['Max', 'p'], 1], 'p'] as any));
// A parameter whose type is a transparent alias of `any`.
ce.declareType('U', 'any', { alias: true });
ce.assign(
  'gu',
  ce.box(['Function', ['Multiply', 2, 'p'], ['Typed', 'p', "'U'"]] as any)
);
// An engine-level function that a block-local function of the same name
// hides in one test.
ce.assign('gs', ce.box(['Function', ['Add', 'a', 'x'], 'a', 'x'] as any));
// A parameter type nested deeper than the comparison follows.
const DEEP = 'list<'.repeat(10) + 'real' + '>'.repeat(10);
ce.assign(
  'deep',
  ce.box(['Function', ['Length', 'q'], ['Typed', 'q', `'${DEEP}'`]] as any)
);
ce.declare('z', 'complex');
ce.assign('z', ce.box(['Complex', 1, 1]));

const POINTS = 'list<tuple<complex, real>>';
const P = [
  'List',
  ['Tuple', ['Complex', 1, 1], 2],
  ['Tuple', ['Complex', 2, 0], 3],
];
const jsP = [
  [{ re: 1, im: 1 }, 2],
  [{ re: 2, im: 0 }, 3],
];

/** The function of `P: type` whose body is `body`. */
function fn(body: unknown, type = POINTS) {
  return ['Function', body, ['Typed', 'P', `'${type}'`]];
}

/** A complex value of the interpreter or of the compiled code. */
function parts(v: unknown): [number, number] {
  if (typeof v === 'number') return [v, 0];
  const z = v as { re: number; im: number };
  return [z.re, z.im];
}

function expectSameValue(
  json: unknown,
  value: unknown = P,
  jsValue: unknown = jsP,
  mode: 'strict' | 'complex' = 'complex'
) {
  const interp = ce.box(['Apply', json, value] as any).evaluate();
  const expected = interp.isCollection ? [...interp.each()] : [interp];
  const r = compile(ce.box(json as any), { fallback: false, mode })!;
  expect(r.success).toBe(true);
  const out = r.run!(jsValue);
  const actual = Array.isArray(out) ? out : [out];
  expect(actual.length).toBe(expected.length);
  expected.forEach((x, i) => {
    const [re, im] = parts(actual[i]);
    expect(re).toBeCloseTo(x.re, 12);
    expect(im).toBeCloseTo(x.im, 12);
  });
}

function expectStrictDecline(json: unknown, message: RegExp) {
  expect(() =>
    compile(ce.box(json as any), { fallback: false, mode: 'strict' })
  ).toThrow(message);
}

describe('A complex point given to an engine-level function', () => {
  // The body of `h` is compiled at the call site with the point itself,
  // which reads each coordinate in its own lane, so strict mode compiles
  // the call and gives the value of the interpreter. The call of `h` over
  // the result of `first(P)` gives the list `P` to the emitted definition of
  // `first`, whose parameter `L` is shaped real, so strict mode declines it.
  const cases: [string, unknown, string?, unknown?, unknown?][] = [
    ['an element of a list of points', ['h', ['At', 'P', 1]]],
    [
      'a nested element',
      ['h', ['At', ['At', 'P', 1], 1]],
      'list<list<tuple<complex, real>>>',
      ['List', P],
      [jsP],
    ],
    [
      'a block local that holds a point',
      ['Block', ['Declare', 'q', "'unknown'", ['At', 'P', 1]], ['h', 'q']],
    ],
    ['the result of a function call', ['h', ['first', 'P']]],
    [
      'a point input',
      ['h', 'P'],
      'tuple<complex, real>',
      ['Tuple', ['Complex', 1, 1], 2],
      [{ re: 1, im: 1 }, 2],
    ],
    ['two coordinates', ['h2', ['At', 'P', 1]]],
  ];
  for (const [name, body, type, value, jsValue] of cases) {
    test(`complex: ${name}`, () =>
      expectSameValue(fn(body, type), value, jsValue));
    test(`strict: ${name}`, () =>
      name === 'the result of a function call'
        ? expectStrictDecline(
            fn(body, type),
            /Lane mismatch.*parameter `L` of `first`/
          )
        : expectSameValue(fn(body, type), value, jsValue, 'strict'));
  }

  test('a point with real coordinates compiles in strict mode', () => {
    const json = fn(['h', ['At', 'P', 1]], 'list<tuple<real, real>>');
    const r = compile(ce.box(json as any), {
      fallback: false,
      mode: 'strict',
    })!;
    expect(r.success).toBe(true);
    expect(r.run!([[1, 2]])).toBe(2);
  });
});

describe('A list of complex points given to an engine-level callback', () => {
  const cases: [string, unknown][] = [
    ['Map', ['Map', 'h2', 'P']],
    ['Reduce', ['Reduce', 'P', 'k2', 0]],
    ['Fold', ['Fold', 'k2', 0, 'P']],
    ['Scan', ['Scan', 'P', 'k2', 0]],
  ];
  for (const [name, body] of cases) {
    test(`complex: ${name}`, () => expectSameValue(fn(body)));
    test(`strict: ${name}`, () =>
      expectStrictDecline(
        fn(body),
        name === 'Map'
          ? /Lane mismatch.*parameter `p` of `h2`/
          : /Lane mismatch.*an element of `P` reaches the parameter `v` of `k2`/
      ));
  }

  test('a list of real points compiles in strict mode', () => {
    const json = fn(['Map', 'h2', 'P'], 'list<tuple<real, real>>');
    const r = compile(ce.box(json as any), {
      fallback: false,
      mode: 'strict',
    })!;
    expect(r.success).toBe(true);
    expect(r.run!([[1, 2]])).toEqual([3]);
  });
});

describe('The decline message of an engine-level fold combiner', () => {
  // The message names the accumulator, not the generated parameter `_a`.
  test('names the complex accumulator', () => {
    const json = [
      'Function',
      ['Reduce', 'L', 'add2', 0],
      ['Typed', 'L', "'list<complex>'"],
    ];
    expect(() =>
      compile(ce.box(json as any), { fallback: false, mode: 'strict' })
    ).toThrow(
      /the complex accumulator of the fold reaches the parameter `a` of `add2`/
    );
  });
});

describe('Positions of a point parameter', () => {
  // `h3` reads its second coordinate as a real number, and its first as a
  // complex number. A complex value at the second position is a mismatch
  // for the callback of `Map`. A direct call is compiled at the call site,
  // which reads each coordinate in its own lane, so strict mode compiles it.
  const CC = 'list<tuple<complex, complex>>';
  const Pcc = ['List', ['Tuple', ['Complex', 1, 1], ['Complex', 0, 2]]];
  const jsPcc = [
    [
      { re: 1, im: 1 },
      { re: 0, im: 2 },
    ],
  ];
  const cases: [string, unknown][] = [
    ['Map', ['Map', 'h3', 'P']],
    ['a call', ['h3', ['At', 'P', 1]]],
  ];
  for (const [name, body] of cases) {
    test(`complex: ${name}`, () => expectSameValue(fn(body, CC), Pcc, jsPcc));
    test(`strict: ${name}`, () =>
      name === 'Map'
        ? expectStrictDecline(
            fn(body, CC),
            /Lane mismatch.*parameter `p` of `h3`/
          )
        : expectSameValue(fn(body, CC), Pcc, jsPcc, 'strict'));
  }

  test('a complex value at the complex position compiles in strict mode', () => {
    const json = fn(['h3', ['At', 'P', 1]]);
    const r = compile(ce.box(json as any), {
      fallback: false,
      mode: 'strict',
    })!;
    expect(r.success).toBe(true);
    expect(r.run!(jsP)).toBe(3);
  });
});

describe('A complex point given to a parameter with no type', () => {
  test('complex: g9(P[1])', () => expectSameValue(fn(['g9', ['At', 'P', 1]])));
  for (const g of ['g9', 'g8'])
    test(`strict: ${g}(P[1])`, () =>
      expectStrictDecline(
        fn([g, ['At', 'P', 1]]),
        new RegExp(`Lane mismatch.*parameter \`p\` of \`${g}\``)
      ));
});

describe('A written point with a coordinate compiled as complex', () => {
  // `Typed(z, 'number')` has the type `number`, but `z` is complex.
  const point = ['Tuple', ['Typed', 'z', "'number'"], 2];
  test('complex: Map', () => expectSameValue(fn(['Map', 'h2', ['List', point]])));
  test('strict: Map', () =>
    expectStrictDecline(
      fn(['Map', 'h2', ['List', point]]),
      /Lane mismatch.*parameter `p` of `h2`/
    ));
  // The call with a written point is inlined, and each coordinate is read
  // in its own lane, so it gives the interpreter's value in strict mode.
  for (const mode of ['complex', 'strict'] as const)
    test(`${mode}: a call`, () => {
      const json = fn(['h2', point]);
      const r = compile(ce.box(json as any), { fallback: false, mode })!;
      expect(r.success).toBe(true);
      expect(r.run!(jsP)).toEqual({ re: 3, im: 1 });
    });
});

describe('A position with no type is read as real', () => {
  // The test does not look at what the body does with a value at a
  // position typed `any` or `unknown`. `Length` reads no coordinate, so
  // `len` is a mismatch that the body does not need: `complex` compiles it
  // with the same value, and `strict` declines the
  // callback of `Map`. A direct call over `P[1]` is compiled at the call
  // site, which reads each coordinate in its own lane, so strict mode
  // compiles it and gives the interpreter's value (no message).
  const cases: [string, unknown, RegExp | undefined][] = [
    ['len(P[1])', ['len', ['At', 'P', 1]], undefined],
    ['Map(len, P)', ['Map', 'len', 'P'], /parameter `L` of `len`/],
    ['gl(P[1])', ['gl', ['At', 'P', 1]], undefined],
    ['Map(gl, P)', ['Map', 'gl', 'P'], /parameter `p` of `gl`/],
    ['gl2(P[1])', ['gl2', ['At', 'P', 1]], undefined],
    ['gu(P[1])', ['gu', ['At', 'P', 1]], undefined],
    // A function literal as the combiner is compiled in its own lanes.
    [
      'Reduce with Last',
      [
        'Reduce',
        'P',
        ['Function', ['Add', 'a', ['Last', ['Reverse', 'v']]], 'a', 'v'],
        0,
      ],
      undefined,
    ],
  ];
  for (const [name, body, message] of cases) {
    test(`complex: ${name}`, () => expectSameValue(fn(body)));
    test(`strict: ${name}`, () =>
      message !== undefined
        ? expectStrictDecline(fn(body), message)
        : expectSameValue(fn(body), P, jsP, 'strict'));
  }

  // `gm` takes the `Max` of a point with a complex coordinate. The lowering
  // of `Max` is real-only, so strict mode declines at `Max`.
  test('strict: a union that admits a number and a collection', () =>
    expectStrictDecline(
      fn(['gm', ['At', 'P', 1]]),
      /Could not compile `Max`.*real-only/
    ));
});

describe('A type nested deeper than the comparison follows', () => {
  // The comparison stops at a fixed depth. It then reports a mismatch only
  // when the argument can hold a complex value.
  const nested = (x: unknown, n: number): unknown =>
    n === 0 ? x : ['List', nested(x, n - 1)];
  const jsNested = (x: unknown, n: number): unknown =>
    n === 0 ? x : [jsNested(x, n - 1)];

  test('strict compiles a real argument', () => {
    const json = fn(['deep', 'P'], DEEP);
    const interp = ce.box(['Apply', json, nested(1, 10)] as any).evaluate();
    const r = compile(ce.box(json as any), {
      fallback: false,
      mode: 'strict',
    })!;
    expect(r.success).toBe(true);
    expect(r.run!(jsNested(1, 10))).toBe(interp.re);
  });

  test('strict declines a complex argument', () =>
    expectStrictDecline(
      fn(['deep', 'P'], DEEP.replace('real', 'complex')),
      /parameter `q` of `deep`/
    ));
});

describe('A block-local combiner that hides an engine-level function', () => {
  // The engine-level `gs` has untyped parameters; the local `gs` has
  // complex parameters. The shape analysis of `1 + Reduce(L, gs, 0)` runs
  // with no target, so it must not test the parameters of the engine-level
  // function.
  test('strict compiles with the parameters of the local', () => {
    const json = [
      'Function',
      [
        'Block',
        ['Declare', 'gs', "'function'", [
            'Function',
            ['Add', 'a', 'x'],
            ['Typed', 'a', "'complex'"],
            ['Typed', 'x', "'complex'"],
          ]],
        ['Add', 1, ['Reduce', 'L', 'gs', 0]],
      ],
      ['Typed', 'L', "'list<complex>'"],
    ];
    const r = compile(ce.box(json as any), {
      fallback: false,
      mode: 'strict',
    })!;
    expect(r.success).toBe(true);
    expect(
      r.run!([
        { re: 1, im: 1 },
        { re: 2, im: 0 },
      ])
    ).toEqual({ re: 4, im: 1 });
  });
});

// The result types of `Map(ha, P)` and `Map(g3, P)` are `list<any>`
// (`ha` reads a coordinate typed `any`, `g3` takes `Norm` of a parameter
// with no declared type), and `any` admits `Nothing`, so both maps decline
// in `complex` mode (`assertNoNothingElement()`). In `strict`, `Map(ha, P)`
// declines with the same reason: that check runs before the lane check of
// the callback.
test('Map(ha, P) and Map(g3, P) decline for a possible Nothing', () => {
  expect(() =>
    compile(ce.box(fn(['Map', 'ha', 'P']) as any), {
      fallback: false,
      mode: 'complex',
    })
  ).toThrow(/an element can be .Nothing./);
  expectStrictDecline(fn(['Map', 'ha', 'P']), /an element can be .Nothing./);
  expect(() =>
    compile(ce.box(fn(['Map', 'g3', 'P']) as any), {
      fallback: false,
      mode: 'complex',
    })
  ).toThrow(/an element can be .Nothing./);
});

describe('The decline message of an engine-level Map callback with no type', () => {
  // `Map(g3, P)` binds each point whole through a generated parameter. The
  // message names an element of `P`, not that parameter.
  test('strict', () =>
    expectStrictDecline(
      fn(['Map', 'g3', 'P']),
      /an element of `P` reaches the parameter `p` of `g3`/
    ));
});

describe('A written complex point at a parameter declared with a real position', () => {
  // A call with a written point that has a complex coordinate is compiled
  // with the body of the function at the call site, which reads each
  // coordinate in its own lane. The interpreter accepts a coordinate with a
  // real part and an imaginary part at a position declared `real`, and the
  // compiled call gives the same value in each mode.
  ce.assign(
    'hr',
    ce.box([
      'Function',
      ['Add', ['At', 'p', 1], ['At', 'p', 2]],
      ['Typed', 'p', "'tuple<real, real>'"],
    ] as any)
  );
  const json = [
    'Function',
    ['hr', ['Tuple', ['Add', 'x', ['Multiply', 'ImaginaryUnit', 'x']], 'x']],
    'x',
  ];
  test('the interpreter: hr((x + i·x, x))', () => {
    const v = ce.box(['Apply', json, 2] as any).evaluate();
    expect(v.re).toBe(4);
    expect(v.im).toBe(2);
  });
  test('complex: hr((x + i·x, x))', () => expectSameValue(json, 2, 2));
  test('strict: hr((x + i·x, x))', () =>
    expectSameValue(json, 2, 2, 'strict'));
});

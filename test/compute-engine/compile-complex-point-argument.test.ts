/**
 * A point (or a list) that holds a complex number, given to an
 * engine-level function whose parameter is a point with no complex type.
 *
 * The parameter type of `h = (p) => p[1] + 1` is inferred from the body as
 * `tuple<number>`, and the emitted body reads the coordinates of `p` as
 * real numbers. With `P: list<tuple<complex, real>>`, the compiled
 * `h(P[1])` added `1` to a `{re, im}` object and gave the string
 * "[object Object]1", where the interpreter gives `2 + i`. Such a call is
 * now a lane mismatch: in `mode: 'auto'` (the default) the compilation
 * starts again in `mode: 'complex'`, and in `mode: 'strict'` it declines.
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
  jsValue: unknown = jsP
) {
  const interp = ce.box(['Apply', json, value] as any).evaluate();
  const expected = interp.isCollection ? [...interp.each()] : [interp];
  const r = compile(ce.box(json as any), { fallback: false })!;
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
      ['Block', ['Declare', 'q'], ['Assign', 'q', ['At', 'P', 1]], ['h', 'q']],
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
    test(`auto: ${name}`, () =>
      expectSameValue(fn(body, type), value, jsValue));
    test(`strict: ${name}`, () =>
      expectStrictDecline(fn(body, type), /Lane mismatch.*parameter `p`/));
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
    test(`auto: ${name}`, () => expectSameValue(fn(body)));
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
  // complex number. A complex value at the second position is a mismatch.
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
    test(`auto: ${name}`, () => expectSameValue(fn(body, CC), Pcc, jsPcc));
    test(`strict: ${name}`, () =>
      expectStrictDecline(
        fn(body, CC),
        /Lane mismatch.*parameter `p` of `h3`/
      ));
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
  test('auto: g9(P[1])', () => expectSameValue(fn(['g9', ['At', 'P', 1]])));
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
  test('auto: Map', () => expectSameValue(fn(['Map', 'h2', ['List', point]])));
  test('strict: Map', () =>
    expectStrictDecline(
      fn(['Map', 'h2', ['List', point]]),
      /Lane mismatch.*parameter `p` of `h2`/
    ));
  // The call with a written point is inlined, and each coordinate is read
  // in its own lane, so it gives the interpreter's value in strict mode.
  for (const mode of ['auto', 'strict'] as const)
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
  // `len` is a mismatch that the body does not need: `auto` compiles it in
  // the complex mode with the same value, and `strict` declines.
  const cases: [string, unknown, RegExp | undefined][] = [
    ['len(P[1])', ['len', ['At', 'P', 1]], /parameter `L` of `len`/],
    ['Map(len, P)', ['Map', 'len', 'P'], /parameter `L` of `len`/],
    ['gl(P[1])', ['gl', ['At', 'P', 1]], /parameter `p` of `gl`/],
    ['Map(gl, P)', ['Map', 'gl', 'P'], /parameter `p` of `gl`/],
    ['gl2(P[1])', ['gl2', ['At', 'P', 1]], /parameter `p` of `gl2`/],
    ['Map(ha, P)', ['Map', 'ha', 'P'], /parameter `p` of `ha`/],
    ['gu(P[1])', ['gu', ['At', 'P', 1]], /parameter `p` of `gu`/],
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
    test(`auto: ${name}`, () => expectSameValue(fn(body)));
    if (message !== undefined)
      test(`strict: ${name}`, () => expectStrictDecline(fn(body), message));
  }

  test('strict: a union that admits a number and a collection', () =>
    expectStrictDecline(fn(['gm', ['At', 'P', 1]]), /parameter `p` of `gm`/));
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
        ['Declare', 'gs', "'function'"],
        [
          'Assign',
          'gs',
          [
            'Function',
            ['Add', 'a', 'x'],
            ['Typed', 'a', "'complex'"],
            ['Typed', 'x', "'complex'"],
          ],
        ],
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

describe('The decline message of an engine-level Map callback with no type', () => {
  // `Map(g3, P)` binds each point whole through a generated parameter. The
  // message names an element of `P`, not that parameter.
  test('auto', () => expectSameValue(fn(['Map', 'g3', 'P'])));
  test('strict', () =>
    expectStrictDecline(
      fn(['Map', 'g3', 'P']),
      /an element of `P` reaches the parameter `p` of `g3`/
    ));
});

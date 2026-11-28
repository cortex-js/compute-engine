/**
 * CE-1524: the held value of an assigned name, `a := WithRandomSeed(7,
 * RandomChoice([0, 1), 3))`, draws over literals under a number as the
 * seed, is the same at every call: it compiles as the interpreter's value, a
 * literal. Written in place, the draws run in their seeded frame. A held
 * value that reads a name of `vars` or calls a user function that draws
 * declines; one with another effect (`Print`) is not evaluated at compile
 * time.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { isNumber } from '../../src/compute-engine/boxed-expression/type-guards';

const IR = { profile: 'ir', fallback: false } as const;

const DRAW = [
  'WithRandomSeed',
  7,
  ['RandomChoice', ['Interval', 0, ['Open', 1]], 3],
];

describe('CE-1524, a value of seeded draws', () => {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.assign('a', ce.box(DRAW as never));
  const interpreted = (json: unknown, x: number) => {
    const v = ce
      .box(json as never)
      .subs({ x })
      .evaluate()
      .N();
    return isNumber(v) ? v.re : NaN;
  };

  test.each([
    ['an assigned value of draws', ['Add', 'x', ['Min', 'a']]],
    ['draws written in place', ['Add', 'x', ['Min', DRAW]]],
    ['one draw', ['Add', 'x', ['WithRandomSeed', 537911, ['Random']]]],
  ])('%s gives the interpreter value at every call', (_, json) => {
    const r = compile(ce.box(json as never), IR);
    expect(r.success).toBe(true);
    const want = interpreted(json, 0.5);
    expect(r.run!({ x: 0.5 } as never)).toBe(want);
    expect(r.run!({ x: 0.5 } as never)).toBe(want);
  });

  test('the draws are a literal of the code', () => {
    const r = compile(ce.box(['Add', 'x', ['Min', 'a']] as never), IR);
    expect(r.code).toMatch(/0\.08483070468009213/);
    expect(r.code).not.toMatch(/withRandomSeed|drawNextRandomNumber/);
    const g = compile(ce.box(['Add', 'x', ['Min', 'a']] as never), {
      ...IR,
      to: 'glsl',
    });
    expect(g.success).toBe(true);
  });

  test('a body that reads a variable runs in its seeded frame', () => {
    const json = ['WithRandomSeed', 7, ['Multiply', 'x', ['Random']]];
    const r = compile(ce.box(json as never), IR);
    expect(r.code).toMatch(/withRandomSeed/);
    expect(r.run!({ x: 2 } as never)).toBe(interpreted(json, 2));
  });

  test('draws that read a name with a value run in their frame', () => {
    // A host supplies `T` at run time (`vars`): its value at compile time is
    // not the value of the call.
    const local = new ComputeEngine();
    local.declare('x', 'real');
    local.declare('T', 'real');
    local.assign('T', 2);
    local.assign(
      'b',
      local.box(['WithRandomSeed', 7, ['Multiply', 'T', ['Random']]] as never)
    );
    const options = { ...IR, vars: { T: '_.T' } };
    // Not folded: the held value declines, as a value with an effect.
    expect(() =>
      compile(local.box(['Add', 'x', 'b'] as never), options as never)
    ).toThrow(/the value of b, which has an effect/);
    // Written in place, the draws read `T` at run time.
    const inPlace = compile(
      local.box([
        'Add',
        'x',
        ['WithRandomSeed', 7, ['Multiply', 'T', ['Random']]],
      ] as never),
      options as never
    );
    expect(inPlace.code).toMatch(/_\.T/);
  });

  test('draws that call a user function are not folded', () => {
    // `f` reads `T`, which a host supplies at run time.
    const local = new ComputeEngine();
    local.declare('x', 'real');
    local.declare('T', 'real');
    local.assign('T', 2);
    local.assign(
      'f',
      local.box(['Function', ['Multiply', 'T', ['Random']]] as never)
    );
    local.assign('b', local.box(['WithRandomSeed', 7, ['f']] as never));
    const options = { ...IR, vars: { T: '_.T' } };
    expect(() =>
      compile(local.box(['Add', 'x', 'b'] as never), options as never)
    ).toThrow(/the value of b/);
  });

  test('a user function named as a library head is not evaluated', () => {
    const local = new ComputeEngine();
    local.declare('x', 'real');
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      local.assign(
        'Tuple',
        local.box(['Function', ['Block', ['Print', 't'], 't'], 't'] as never)
      );
      local.assign(
        'b',
        local.box(['WithRandomSeed', 7, ['Tuple', ['Random']]] as never)
      );
      log.mockClear();
      try {
        compile(local.box(['Add', 'x', 'b'] as never), IR);
      } catch {
        // A decline is the expected outcome.
      }
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  test('a declared constant is not folded: its value can read a variable', () => {
    const local = new ComputeEngine();
    local.declare('x', 'real');
    local.declare('T', 'real');
    local.assign('T', 2);
    local.declare('k', {
      type: 'real',
      isConstant: true,
      value: local.box(['Multiply', 5, 'T'] as never),
    } as never);
    local.assign(
      'b',
      local.box([
        'WithRandomSeed',
        7,
        ['RandomChoice', ['List', 'k', 'k'], 1],
      ] as never)
    );
    expect(() =>
      compile(local.box(['Add', 'x', ['Min', 'b']] as never), {
        ...IR,
        vars: { T: '_.T' },
      } as never)
    ).toThrow(/Could not compile/);
  });

  test('a library constant folds; a shadowed one does not', () => {
    const json = ['WithRandomSeed', 7, ['RandomChoice', ['List', 'Pi', 1], 2]];
    ce.assign('withPi', ce.box(json as never));
    const r = compile(ce.box(['Add', 'x', ['Min', 'withPi']] as never), IR);
    expect(r.code).not.toMatch(/withRandomSeed/);
    expect(r.run!({ x: 0.5 } as never)).toBe(
      interpreted(['Add', 'x', ['Min', 'withPi']], 0.5)
    );

    const local = new ComputeEngine();
    local.declare('x', 'real');
    local.declare('T', 'real');
    local.assign('T', 2);
    local.pushScope();
    local.declare('Pi', {
      type: 'real',
      value: local.box(['Multiply', 5, 'T'] as never),
    } as never);
    local.assign('b', local.box(json as never));
    expect(() =>
      compile(local.box(['Add', 'x', ['Min', 'b']] as never), {
        ...IR,
        vars: { T: '_.T' },
      } as never)
    ).toThrow(/Could not compile/);
  });

  test('draws of more elements than the limit in all are not folded', () => {
    // Each draw is within the limit; together they are not.
    const draw = ['RandomChoice', ['Interval', 0, ['Open', 1]], 10000];
    ce.assign(
      'many',
      ce.box(['WithRandomSeed', 7, ['List', draw, draw, draw]] as never)
    );
    const start = Date.now();
    expect(() =>
      compile(ce.box(['Add', 'x', ['Min', ['Flatten', 'many']]] as never), IR)
    ).toThrow(/Could not compile/);
    expect(Date.now() - start).toBeLessThan(200);
  });

  test('a count above the limit is not drawn at compile time', () => {
    ce.assign(
      'big',
      ce.box([
        'WithRandomSeed',
        7,
        ['RandomSample', ['Range', 1, 3e5], 3e5],
      ] as never)
    );
    // The draws stay in their frame, which has one draw site: the value is
    // the interpreter's (the least of a sample of every element).
    const start = Date.now();
    const r = compile(ce.box(['Add', 'x', ['Min', 'big']] as never), IR);
    expect(Date.now() - start).toBeLessThan(200);
    expect(r.code).toMatch(/withRandomSeed/);
    expect(r.run!({ x: 0.5 } as never)).toBe(1.5);
  });

  test('a name whose value has another effect is not evaluated at compile time', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      ce.assign('q', ce.box(['Block', ['Print', 1], ['Random']] as never));
      ce.assign('r', ce.box(['WithRandomSeed', 7, 'q'] as never));
      log.mockClear();
      try {
        compile(ce.box(['Add', 'x', 'r'] as never), IR);
      } catch {
        // A decline is the expected outcome.
      }
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  test('a body with another effect is not evaluated at compile time', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      ce.assign(
        'p',
        ce.box([
          'WithRandomSeed',
          7,
          ['Block', ['Print', 1], ['Random']],
        ] as never)
      );
      log.mockClear();
      expect(() => compile(ce.box(['Add', 'x', 'p'] as never), IR)).toThrow();
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});

/**
 * CE-1947: on interval-js too, a held value of seeded draws over literals is
 * its interpreter value, a list of point intervals, and so is the
 * arithmetic of numbers and such frames (the Desmos `2random(7)-1`). Corpus:
 * neyret/vwbagbcerj `h=random(400)`, neyret/yvwfq1kpio `C=2random(7)-1`.
 */
describe('CE-1947, a value of seeded draws on interval-js', () => {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.assign('h', ce.box(DRAW as never));
  ce.assign('C', ce.box(['Add', -1, ['Multiply', 2, DRAW]] as never));
  const sum = (name: string) => [
    'Sum',
    ['Multiply', ['At', name, ['Add', 'i', 1]], ['Power', 'x', 'i']],
    ['Limits', 'i', 0, ['Add', ['Length', name], -1]],
  ];

  test.each([['h'], ['C']])(
    'a sum over %s compiles, and its interval holds the interpreter value',
    (name) => {
      const json = sum(name);
      const r = compile(ce.box(json as never), {
        ...IR,
        to: 'interval-js',
      });
      expect(r.success).toBe(true);
      for (const x of [0.3, 1.7]) {
        const want = ce
          .box(json as never)
          .subs({ x })
          .N();
        const got = r.run!({ x } as never) as {
          value?: { lo: number; hi: number };
        };
        const v = got.value ?? (got as unknown as { lo: number; hi: number });
        expect(isNumber(want)).toBe(true);
        expect(v.lo).toBeLessThanOrEqual((want as never as { re: number }).re);
        expect(v.hi).toBeGreaterThanOrEqual(
          (want as never as { re: number }).re
        );
      }
    }
  );

  test('the arithmetic of the frame is folded on javascript too', () => {
    const r = compile(ce.box(sum('C') as never), IR);
    expect(r.success).toBe(true);
    expect(r.code).not.toMatch(/withRandomSeed|drawNextRandomNumber/);
  });
});

/**
 * CE-1943: a frame of draws over literals under a number as the seed,
 * written in place, is its interpreter value, a literal: the code does not
 * draw its elements again at each call. Corpus: art/bixumi1pk6
 * `r\\ge\\operatorname{random}(9^4)[8\\theta]`. GLSL keeps the decline.
 */
describe('CE-1943, seeded draws written in place', () => {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  const json = ['At', DRAW, ['Max', ['Floor', ['Multiply', 3, 'x']], 1]];

  test.each([['javascript'], ['interval-js']])(
    'on %s the frame is a literal list',
    (to) => {
      const r = compile(ce.box(json as never), { ...IR, to } as never);
      expect(r.success).toBe(true);
      expect(r.code).not.toMatch(/withRandomSeed|randomChoice/);
    }
  );

  test('the value is the interpreter value at each call', () => {
    const r = compile(ce.box(json as never), IR);
    for (const x of [0.1, 0.5, 0.9]) {
      const want = ce
        .box(json as never)
        .subs({ x })
        .N();
      expect(r.run!({ x } as never)).toBe((want as never as { re: number }).re);
    }
  });

  test('glsl keeps the decline', () => {
    expect(() =>
      compile(ce.box(json as never), { ...IR, to: 'glsl' } as never)
    ).toThrow(/WithRandomSeed on glsl/);
  });
});

/**
 * CE-1614: a held value whose draws read an input, `H := WithRandomSeed(139128,
 * RandomChoice([0, 1), 4N))` with a slider `N`, is not the same at every call,
 * so it is not a literal: it compiles as written in place, a random frame.
 * The frame starts its draws at its seed, so the value depends only on `N`.
 * A held value with another effect declines, and so does one whose frame can
 * make other draws than the interpreter's (the frames of the warning
 * `seeded-draw-order`).
 */
describe('CE-1614, a value of seeded draws that reads an input', () => {
  const UNIT = ['Interval', 0, ['Open', 1]];
  const choice = (seed: unknown, count: unknown) => [
    'WithRandomSeed',
    seed,
    ['RandomChoice', UNIT, count],
  ];
  const DEFINITIONS: Record<string, unknown> = {
    // The two values of the issue (Tycho's `cf56wfb4cm` and `hztlhoa5ea`).
    H: choice(139128, ['Multiply', 4, 'N']),
    R: [
      'Which',
      ['Less', 0.5, choice(626421, ['Power', 'N', 2])],
      1,
      'True',
      -1,
    ],
    seedIsInput: ['WithRandomSeed', 'N', ['Random']],
    readsH: ['Multiply', 2, ['At', 'H', 'N']],
    sample: ['WithRandomSeed', 5, ['RandomSample', ['Range', 1, 'N'], 2]],
    double: ['Function', ['Multiply', 2, 'u'], 'u'],
    countByFunction: choice(3, ['double', 'N']),
    liveDraw: ['Add', ['Random'], 'N'],
    seedIsDraw: ['WithRandomSeed', ['Random'], ['Random']],
    frameOfLiveDraw: ['WithRandomSeed', 3, ['Add', 'liveDraw', 1]],
    drawPerElement: [
      'WithRandomSeed',
      5,
      [
        'Map',
        ['Function', ['Multiply', 'k', ['Random']], 'k'],
        ['Range', 1, 'N'],
      ],
    ],
    twoSites: ['WithRandomSeed', 5, ['Add', ['Random'], ['Random']]],
    scaledDraw: ['Function', ['Multiply', 'u', ['Random']], 'u'],
    drawInFunction: ['WithRandomSeed', 3, ['scaledDraw', 'N']],
  };
  /** An engine with the definitions; `N` holds a value for the interpreter
   *  and is an input for the compiler. */
  const engine = (N?: number) => {
    const e = new ComputeEngine();
    e.declare('N', 'integer<1..30>');
    e.declare('t', 'real');
    if (N !== undefined) e.assign('N', N);
    for (const [name, json] of Object.entries(DEFINITIONS))
      e.assign(name, e.box(json as never));
    return e;
  };
  const ce = engine();
  const interpreted = (json: unknown, t: number, N: number) => {
    const v = engine(N)
      .box(json as never)
      .subs({ t })
      .evaluate()
      .N();
    return isNumber(v) ? v.re : NaN;
  };

  test.each([
    ['an element of the list', ['Add', 't', ['At', 'H', 2]]],
    ['its last element', ['Add', 't', ['At', 'H', ['Multiply', 4, 'N']]]],
    ['two reads of the name', ['Add', ['At', 'H', 2], ['At', 'H', 'N']]],
    ['a selection of the draws', ['Add', 't', ['Sum', 'R']]],
    ['a seed that is an input', ['Add', 't', 'seedIsInput']],
    ['a value that reads the name', ['Add', 't', 'readsH']],
    ['a sample', ['Add', 't', ['Sum', 'sample']]],
    ['a count by a user function', ['Add', 't', ['Sum', 'countByFunction']]],
    [
      'a read at each pass of a sum',
      ['Sum', ['At', 'H', 'k'], ['Limits', 'k', 1, 'N']],
    ],
    [
      'a read in a frame of the program',
      ['WithRandomSeed', 1, ['Add', ['At', 'H', 1], ['Random']]],
    ],
  ])('%s gives the interpreter value at each N', (_, json) => {
    const r = compile(ce.box(json as never), IR);
    expect(r.success).toBe(true);
    expect(r.warnings ?? []).toEqual([]);
    for (const N of [3, 5]) {
      const want = interpreted(json, 0.25, N);
      expect(Number.isFinite(want)).toBe(true);
      expect(r.run!({ t: 0.25, N } as never)).toBeCloseTo(want, 12);
    }
  });

  test('the draws run in their frame, and the name is a dependency', () => {
    const deps = new Set<string>();
    const r = compile(ce.box(['Add', 't', ['At', 'H', 2]] as never), {
      ...IR,
      symbolDeps: deps,
    } as never);
    expect(r.code).toMatch(/withRandomSeed\(139128/);
    expect(r.freeSymbols).toEqual(['t', 'N']);
    expect([...deps]).toEqual(['H']);
  });

  test.each([
    ['a draw outside a frame', ['Add', 't', 'liveDraw']],
    ['a seed that is a draw', ['Add', 't', 'seedIsDraw']],
    [
      'a frame that reads a name whose value draws',
      ['Add', 't', 'frameOfLiveDraw'],
    ],
    ['a draw at each element', ['Add', 't', ['Sum', 'drawPerElement']]],
    ['two draw sites in one frame', ['Add', 't', 'twoSites']],
    ['a draw in a user function', ['Add', 't', 'drawInFunction']],
  ])('%s declines', (_, json) => {
    expect(() => compile(ce.box(json as never), IR)).toThrow(
      /the value of \w+, which has an effect/
    );
  });

  test('a declined frame is one whose draws can differ in place', () => {
    // Written in place, such a frame compiles with the warning: the held
    // value declines so that its value stays the interpreter's.
    for (const name of ['drawPerElement', 'twoSites']) {
      const r = compile(ce.box(DEFINITIONS[name] as never), IR);
      expect(r.warnings?.map((w) => w.code)).toEqual(['seeded-draw-order']);
    }
  });

  test('glsl has no random frame', () => {
    expect(() =>
      compile(ce.box(['Add', 't', ['At', 'H', 2]] as never), {
        ...IR,
        to: 'glsl',
      })
    ).toThrow(/WithRandomSeed on glsl/);
  });
});

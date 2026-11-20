/**
 * Lists of strings on the javascript target of the IR compiler (CE-1548,
 * CE-1556; README of `src/compute-engine/compilation/ir/`, "The string
 * lane"), and `ColorToString`. A list of strings is made by a literal,
 * `Characters(s)`, a list operation or an input; it is read by `StringJoin`,
 * by an element read, or as the result. A read that can be out of range
 * (`At`, `First`, `Last`) is used only by a discharge (`IsMissing`,
 * `Coalesce`, `AssertPresent`) or as the result; elsewhere it declines.
 * Each program is compiled and compared with `evaluate()`, with the passes
 * on, with `passes: false` and with `constantFold: false`.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import {
  isFunction,
  isString,
} from '../../src/compute-engine/boxed-expression/type-guards';

type Json = unknown;
type Vars = Record<string, unknown>;

const ce = new ComputeEngine();
ce.declare('s', 'string');
ce.declare('t', 'string');
ce.declare('L', 'list<string>');
ce.declare('K', 'list<character>');
ce.declare('M', 'list<list<string>>');
ce.declare('b', 'boolean');
ce.declare('x', 'real');
ce.declare('f', 'string');
ce.declare('i', 'real');
ce.declare('j', 'real');
ce.declare('n', 'integer');
ce.declare('L2', 'list<string^2>');
ce.assign('C', ce.box(['Rgb', 0, 0.5, 0.25]));

const js = (json: Json, options: object = {}) =>
  compile(ce.box(json as never), { fallback: false, ...options });
const run = (json: Json, vars: Vars, options: object = {}) =>
  (js(json, options).run as (v: unknown) => unknown)(vars);

/** Whether `json` declines (`compile()` throws with `fallback: false`). */
function declines(json: Json, options: object = {}): boolean {
  try {
    js(json, options);
  } catch {
    return true;
  }
  return false;
}

/** A host value as the engine boxes it. */
function boxed(v: unknown): unknown {
  if (typeof v === 'string') return ce.string(v);
  if (typeof v === 'boolean') return v ? ce.True : ce.False;
  if (Array.isArray(v)) return ce.function('List', v.map(boxed) as never);
  return ce.number(v as number);
}

/** The interpreter's value of `json` at `vars`, as a JavaScript value: a
 *  string, a number, an array of the texts of a list, or `error`. */
function interpreted(json: Json, vars: Vars): unknown {
  const e = ce
    .box(json as never)
    .subs(
      Object.fromEntries(
        Object.entries(vars).map(([k, v]) => [k, boxed(v)])
      ) as never
    )
    .evaluate();
  const read = (x: typeof e): unknown => {
    if (isFunction(x, 'Error')) return 'error';
    if (x.symbol === 'Missing') return undefined;
    if (x.symbol === 'True' || x.symbol === 'False') return x.symbol === 'True';
    // A list, also a lazy one (`Reverse`, `Take`).
    if (isFunction(x, 'List') || (x.isCollection && !isString(x)))
      return [...x.each()].map(read);
    if (x.string !== undefined && x.string !== null) return x.string;
    return x.re;
  };
  return read(e);
}

/** The compiled value at `vars`, or `error` when the code throws. */
function compiled(json: Json, vars: Vars, options: object = {}): unknown {
  try {
    const v = run(json, vars, options);
    return Array.isArray(v) ? [...v] : v;
  } catch {
    return 'error';
  }
}

const TEXTS = ['héllo', 'éa', '👨‍👩‍👧x', '🇫🇷🇩🇪', 'a\ud800b', ''];

describe('Characters and GraphemeClusters', () => {
  test.each(TEXTS)('at %j', (text) => {
    for (const json of [
      ['Characters', 's'],
      ['GraphemeClusters', 's'],
      ['Length', ['Characters', 's']],
      ['StringJoin', ['Characters', 's'], { str: '-' }],
      ['StringJoin', ['Characters', 's']],
    ])
      expect(compiled(json, { s: text })).toEqual(
        interpreted(json, { s: text })
      );
  });

  test('of a string literal and of a character', () => {
    expect(run(['Characters', { str: 'ab' }], {})).toEqual(['a', 'b']);
    expect(compiled(['Characters', { str: 'é' }], {})).toEqual(
      interpreted(['Characters', { str: 'é' }], {})
    );
  });

  test('declines on glsl and in the bigint mode', () => {
    expect(declines(['Length', ['Characters', 's']], { to: 'glsl' })).toBe(
      true
    );
    expect(declines(['Length', ['Characters', 's']], { mode: 'bigint' })).toBe(
      true
    );
  });
});

describe('StringJoin of a list of strings', () => {
  const LISTS = [[], ['e', '́'], ['á', 'b'], ['a', 'b'], ['a\ud800']];
  test.each(LISTS.map((l) => [JSON.stringify(l), l]))('at %s', (_, list) => {
    for (const name of ['L', 'K'])
      for (const json of [
        ['StringJoin', name],
        ['StringJoin', name, { str: '-' }],
        ['StringJoin', name, 't'],
      ])
        expect(compiled(json, { [name]: list, t: '́' })).toEqual(
          interpreted(json, { [name]: list, t: '́' })
        );
  });

  test('of a literal with an input', () => {
    const json = ['StringJoin', ['List', { str: 'a' }, 's'], { str: '-' }];
    for (const text of TEXTS)
      expect(compiled(json, { s: text })).toEqual(
        interpreted(json, { s: text })
      );
  });

  test('of a list that is not of strings declines', () => {
    expect(declines(['StringJoin', ['List', 1, 2]])).toBe(true);
    expect(declines(['StringJoin', ['Range', 1, 'x']])).toBe(true);
  });

  test('a string for a list input throws', () => {
    expect(() => run(['StringJoin', 'L'], { L: 'ab' })).toThrow();
  });
});

describe('the producers that spread a string decline', () => {
  test.each([
    ['ListJoin(s)', ['ListJoin', 's']],
    [
      'StringJoin(ListJoin(s), "-")',
      ['StringJoin', ['ListJoin', 's'], { str: '-' }],
    ],
    ['ListJoin(s, ["x"])', ['ListJoin', 's', ['List', { str: 'x' }]]],
    ['Reverse(s)', ['Reverse', 's']],
  ])('%s', (_, json) => {
    expect(declines(json)).toBe(true);
  });

  test('Append(["a"], s) appends the string as one element, as the interpreter', () => {
    const json = ['Append', ['List', { str: 'a' }], 's'];
    expect(compiled(json, { s: 'bc' })).toEqual(['a', 'bc']);
    expect(interpreted(json, { s: 'bc' })).toEqual(['a', 'bc']);
  });

  test('the Epsil spread [...s, "x"]', () => {
    const [program] = parseEpsil('[...s, "x"]');
    let declined = false;
    let got: unknown;
    try {
      got = (
        compile(ce.box(program as never), { fallback: false }).run as (
          v: unknown
        ) => unknown
      )({ s: 'bc' });
    } catch {
      declined = true;
    }
    // The interpreter spreads the characters: never the string as one
    // element.
    if (!declined) expect(got).toEqual(['b', 'c', 'x']);
  });
});

describe('a literal list whose reads the passes fold', () => {
  const lit = ['List', { str: 'a' }, 's'];
  test.each([
    ['Reverse', ['Reverse', lit]],
    ['Take', ['Take', lit, 1]],
    ['At', ['At', lit, 2]],
    ['Map', ['Map', 'ToUpperCase', lit]],
    ['the result', lit],
  ])('%s', (_, json) => {
    for (const options of [{}, { passes: false }, { constantFold: false }])
      expect(compiled(json, { s: 'xé' }, options)).toEqual(
        interpreted(json, { s: 'xé' })
      );
  });

  test('a user function that returns a list of strings', () => {
    const engine = new ComputeEngine();
    engine.declare('s', 'string');
    engine.declare('g', '(string) -> list<string>');
    engine.assign(
      'g',
      engine.box(['Function', ['List', { str: 'a' }, 'q'], 'q'])
    );
    const e = engine.box(['StringJoin', ['g', 's'], { str: '+' }]);
    let got: unknown = 'declined';
    try {
      got = (compile(e, { fallback: false }).run as (v: unknown) => unknown)({
        s: 'b',
      });
    } catch {}
    expect(['declined', 'a+b']).toContain(got);
  });
});

describe('a list of strings of run-time length', () => {
  test.each([
    ['Sort(L)', ['Sort', 'L']],
    ['If(b, L, ["x"])', ['If', 'b', 'L', ['List', { str: 'x' }]]],
    ['L', 'L'],
    ['M', ['StringJoin', ['At', 'M', 1]]],
  ])('declines %s', (_, json) => {
    expect(declines(json)).toBe(true);
  });

  test.each([
    ['At(L, 1)', ['At', 'L', 1]],
    ['Map(ToUpperCase, L)', ['Map', 'ToUpperCase', 'L']],
    ['Reverse(Characters(s))', ['Reverse', ['Characters', 's']]],
    ['At(Characters(s), 1)', ['At', ['Characters', 's'], 1]],
    [
      'Count(Characters(s), c -> c == "a")',
      [
        'Count',
        ['Characters', 's'],
        ['Function', ['Equal', 'c', { str: 'a' }], 'c'],
      ],
    ],
  ])('compiles %s (CE-1556)', (_, json) => {
    const vars = { s: 'abá', L: ['x', 'é'] };
    expect(compiled(json, vars)).toEqual(interpreted(json, vars));
  });
});

describe('the boundary: strings flag, batch, entry checks', () => {
  test('an input list of strings: no batch, with and without entry checks', () => {
    for (const options of [{}, { entryChecks: false }]) {
      const r = js(['StringJoin', 'L'], options);
      expect(r.strings).toBe(true);
      expect(r.shippable).toBe(false);
      expect(() => r.broadcast!({ L: [['a']] as never }, {})).toThrow(/string/);
    }
  });

  test('a result list of strings: no batch', () => {
    const r = js(['Characters', 's']);
    expect(r.strings).toBe(true);
    expect(r.shippable).toBe(false);
  });

  test('strings inside only: a batch of numbers, each cell the value of run()', () => {
    const json = [
      'Length',
      ['Characters', ['ColorToString', ['Rgb', 'x', 0, 0]]],
    ];
    const r = js(json);
    expect(r.strings).toBeUndefined();
    expect(r.shippable).toBe(true);
    const xs = [0, 0.25, 0.5, 1];
    expect(
      Array.from(r.broadcast!({ x: new Float64Array(xs) }, {}) as never)
    ).toEqual(xs.map((x) => run(json, { x })));
  });
});

describe('ColorToString', () => {
  const at = (json: Json, x: number) => ({
    got: compiled(json, { x }),
    want: interpreted(json, { x }),
  });

  test.each([
    ['hex (absent)', undefined],
    ['hex', 'hex'],
    ['srgb', 'srgb'],
    ['rgb', 'rgb'],
    ['hsl', 'hsl'],
    ['HSL', 'HSL'],
    ['oklch', 'oklch'],
    ['display-p3', 'display-p3'],
  ])('the format %s, of each constructor', (_, format) => {
    const f = format === undefined ? [] : [{ str: format }];
    for (const c of [
      ['Rgb', 0, 'x', 0.25],
      ['Hsl', ['Multiply', 360, 'x'], 0.6, 0.4],
      ['Hsv', 200, 'x', 0.8],
      ['Oklch', 0.7, ['Multiply', 0.3, 'x'], 140],
      ['Oklab', 0.6, ['Subtract', 'x', 0.5], 0.1],
      ['Tuple', 'x', 0, 0.5],
      // Out of the sRGB gamut.
      ['Oklch', 0.9, ['Multiply', 0.5, 'x'], 30],
    ])
      for (const x of [0, 0.3, 0.5, 1]) {
        const { got, want } = at(['ColorToString', c, ...f], x);
        expect(got).toEqual(want);
      }
  });

  test('Rgb(0, x, 0.25) at 804 samples', () => {
    const json = ['ColorToString', ['Rgb', 0, 'x', 0.25]];
    expect(compiled(json, { x: 0.5 })).toBe('#008040');
    const f = js(json).run as (v: unknown) => unknown;
    for (let k = 0; k < 804; k += 1) {
      const x = k / 803;
      expect([x, f({ x })]).toEqual([x, interpreted(json, { x })]);
    }
  });

  test('a same-space conversion of a constructor, and a name of one', () => {
    for (const json of [
      ['ColorToString', ['AsRgb', ['Rgb', 0, 'x', 0.25]]],
      ['ColorToString', ['AsRgb', ['AsRgb', ['Rgb', 0, 'x', 0.25]]]],
      [
        'Block',
        ['Declare', 'c', "'unknown'", ['Rgb', 0, 'x', 0.25]],
        ['ColorToString', 'c'],
      ],
    ])
      expect(compiled(json, { x: 0.5 })).toBe('#008040');
    expect(compiled(['ColorToString', 'C'], {})).toBe('#008040');
    for (const json of [
      ['ColorToString', ['AsHsl', ['Hsl', 'x', 0.5, 0.5]], { str: 'hsl' }],
      ['ColorToString', ['AsHsv', ['Hsv', 'x', 0.5, 0.5]], { str: 'hsl' }],
      ['ColorToString', ['AsOklab', ['Oklab', 0.5, 'x', 0.1]]],
      ['ColorToString', ['AsOklch', ['Oklch', 0.5, 'x', 30]], { str: 'oklch' }],
    ])
      for (const x of [0, 0.1, 0.3])
        expect(compiled(json, { x })).toEqual(interpreted(json, { x }));
  });

  test('channels: clamped, wrapped, or no colour', () => {
    for (const json of [
      ['ColorToString', ['Hsl', 30, 'x', 0.5]],
      ['ColorToString', ['Hsl', 30, 0.5, 'x']],
      ['ColorToString', ['Hsv', 30, 'x', 0.5]],
      ['ColorToString', ['Hsv', 30, 0.5, 'x']],
      ['ColorToString', ['Hsl', ['Add', 400, 'x'], 1, 0.5]],
    ])
      for (const x of [Infinity, -Infinity, 0.2])
        expect(compiled(json, { x })).toEqual(interpreted(json, { x }));
    expect(
      compiled(['ColorToString', ['Hsl', 30, 'x', 0.5]], { x: Infinity })
    ).toBe('#ff8000');
    // A NaN channel, an infinite hue, an infinite sRGB channel: the
    // interpreter's value is an error, the compiled code throws.
    for (const [json, x] of [
      [['ColorToString', ['Rgb', 'x', 0, 0]], NaN],
      [['ColorToString', ['Hsl', 'x', 1, 0.5]], Infinity],
      [['ColorToString', ['Rgb', 'x', 0, 0]], Infinity],
    ] as const) {
      expect(interpreted(json, { x })).toBe('error');
      expect(() => run(json, { x })).toThrow(RangeError);
    }
  });

  test.each([
    ['AsRgb(Oklch)', ['ColorToString', ['AsRgb', ['Oklch', 0.5, 'x', 30]]]],
    ['AsHsl(Rgb)', ['ColorToString', ['AsHsl', ['Rgb', 'x', 0, 0]]]],
    [
      'ColorMix',
      ['ColorToString', ['ColorMix', ['Rgb', 'x', 0, 0], ['Rgb', 0, 0, 1]]],
    ],
    ['GamutMap', ['ColorToString', ['GamutMap', ['Oklch', 0.9, 'x', 30]]]],
    [
      'If',
      ['ColorToString', ['If', 'b', ['Rgb', 'x', 0, 0], ['Hsl', 30, 1, 0.5]]],
    ],
    [
      'ContrastingColor',
      [
        'ColorToString',
        [
          'ContrastingColor',
          ['Rgb', 'x', 0, 0],
          ['Rgb', 1, 1, 1],
          ['Hsl', 30, 1, 0.5],
        ],
      ],
    ],
    ['a list of colours', ['ColorToString', ['Rgb', ['List', 0, 'x'], 0, 0]]],
    ['the format "xyz"', ['ColorToString', ['Rgb', 'x', 0, 0], { str: 'xyz' }]],
    ['a format that is an input', ['ColorToString', ['Rgb', 'x', 0, 0], 'f']],
    ['a string', ['ColorToString', { str: 'red' }]],
  ])('declines %s', (_, json) => {
    expect(declines(json)).toBe(true);
  });
});

// CE-1556: the reads of the elements of a list of strings.

const str = (x: string) => ({ str: x });
const fn = (body: Json, ...params: string[]) => ['Function', body, ...params];
const PASSES = [{}, { passes: false }, { constantFold: false }];

/** `json` compiled in each of `PASSES` gives the interpreter's value at
 *  each of `points`. */
function agrees(json: Json, points: Vars[]): void {
  for (const vars of points) {
    const want = interpreted(json, vars);
    for (const options of PASSES)
      expect([vars, options, compiled(json, vars, options)]).toEqual([
        vars,
        options,
        want,
      ]);
  }
}

/** `json` declines in each of `PASSES`, with a message that matches
 *  `cause` when given. */
function declinesEverywhere(json: Json, cause?: RegExp): void {
  for (const options of PASSES) {
    let m = '';
    try {
      js(json, options);
    } catch (e) {
      m = (e as Error).message;
    }
    expect([options, m !== '' && (cause?.test(m) ?? true)]).toEqual([
      options,
      true,
    ]);
  }
}

const DECOMPOSED = ['é', 'áb', 'x'];
const LENGTHS = [[], ['a'], ['ab', 'c', 'a']];

describe('the witnesses of CE-1556', () => {
  test('Count(Characters(s), c -> c == "a")', () => {
    agrees(
      ['Count', ['Characters', 's'], fn(['Equal', 'c', str('a')], 'c')],
      [{ s: 'banana' }, { s: '' }, { s: 'áa' }]
    );
  });

  test('Count, Map, Filter of L, Map of two lists', () => {
    const points = [...LENGTHS, DECOMPOSED].map((L) => ({ L, s: 'xyz' }));
    for (const json of [
      ['Count', 'L', fn(['NotEqual', 'c', str('a')], 'c')],
      ['Map', 'ToUpperCase', 'L'],
      ['Filter', 'L', fn(['StartsWith', 'c', str('a')], 'c')],
      ['Map', fn(['Equal', 'p', 'q'], 'p', 'q'), 'L', ['Characters', 's']],
    ])
      agrees(json, points);
  });

  test('an input element is conditioned where it is read', () => {
    const points = [{ L: DECOMPOSED }];
    for (const json of [
      ['Map', fn('c', 'c'), 'L'],
      ['Map', fn(['Equal', 'c', str('é')], 'c'), 'L'],
      ['Equal', ['Coalesce', ['At', 'L', 1], str('')], str('é')],
      ['At', 'L', 2],
    ])
      agrees(json, points);
    expect(run(['At', 'L', 1], { L: DECOMPOSED })).toBe('é');
  });
});

describe('At, First and Last of a list of strings', () => {
  const points = [
    ...[1, -1, 0, 1.5, 3, 4, -3, -4].map((i) => ({ L: ['ab', 'c', 'é'], i })),
    { L: [], i: 1 },
  ];

  test('as the result', () => {
    for (const json of [
      ['At', 'L', 'i'],
      ['First', 'L'],
      ['Last', 'L'],
    ])
      agrees(json, points);
    expect(run(['At', 'L', 'i'], { L: ['a'], i: 2 })).toBeUndefined();
  });

  test('under IsMissing, Coalesce and AssertPresent', () => {
    for (const read of [
      ['At', 'L', 'i'],
      ['First', 'L'],
      ['Last', 'L'],
    ])
      for (const json of [
        ['IsMissing', read],
        ['Coalesce', read, str('z')],
        ['ToUpperCase', ['Coalesce', read, str('z')]],
        ['Length', ['Coalesce', read, str('z')]],
        ['Coalesce', read, ['At', 'L', 1], str('z')],
        ['AssertPresent', read],
      ])
        agrees(json, points);
  });

  test('AssertPresent out of range throws expected-present', () => {
    expect(() =>
      run(['AssertPresent', ['At', 'L', 'i']], { L: [], i: 1 })
    ).toThrow(/expected-present/);
  });

  test('a constant index in range of a literal is the element, read anywhere', () => {
    agrees(['ToUpperCase', ['At', ['List', str('a'), 's'], 2]], [{ s: 'xé' }]);
  });
});

describe('a read that can be absent declines, with the Coalesce remedy', () => {
  const g = new ComputeEngine();
  g.declare('s', 'string');
  g.declare('L', 'list<string>');
  g.declare('i', 'integer');
  g.declare('n', 'integer');
  /** `f(t: string, k: integer) := body` (Epsil), then `rest`. */
  const withF = (body: string, rest: string): Json =>
    parseEpsil(`function f(t: string, k: integer) { ${body} }\n${rest}`)[0];
  /** The program as `g` compiles it, `declined` for the refusal of a read
   *  that can be absent, or the message of another decline. */
  const at = (json: Json, vars: Vars, options: object = {}): unknown => {
    let f: (v: unknown) => unknown;
    try {
      f = compile(g.box(json as never), { fallback: false, ...options })
        .run as never;
    } catch (e) {
      const m = (e as Error).message;
      return /a list that can be out of range/.test(m) ? 'declined' : m;
    }
    return f(vars);
  };
  const bare = (x: Json) => x;
  const guarded = (x: Json) => ['Coalesce', x, str('')];
  const witnesses = (read: (x: Json) => Json): [string, Json][] => [
    [
      'IsMissing(At(Map(k -> At(L, k), Range(1, n)), 2))',
      [
        'IsMissing',
        ['At', ['Map', fn(read(['At', 'L', 'k']), 'k'), ['Range', 1, 'n']], 2],
      ],
    ],
    [
      'And(i <= Length(L), StartsWith(At(L, i), "a"))',
      [
        'And',
        ['LessEqual', 'i', ['Length', 'L']],
        ['StartsWith', read(['At', 'L', 'i']), str('a')],
      ],
    ],
    [
      'If(i <= Length(L), Length(At(L, i)) > 1, False)',
      [
        'If',
        ['LessEqual', 'i', ['Length', 'L']],
        ['Greater', ['Length', read(['At', 'L', 'i'])], 1],
        'False',
      ],
    ],
    [
      'Block(c := At(L, i), And(i <= Length(L), StartsWith(c, "a")))',
      [
        'Block',
        ['Declare', 'c', "'unknown'", read(['At', 'L', 'i'])],
        [
          'And',
          ['LessEqual', 'i', ['Length', 'L']],
          ['StartsWith', 'c', str('a')],
        ],
      ],
    ],
    [
      'Block(c := At(L, i), And(i <= Length(L), Length(Characters(c)) > 1))',
      [
        'Block',
        ['Declare', 'c', "'unknown'", read(['At', 'L', 'i'])],
        [
          'And',
          ['LessEqual', 'i', ['Length', 'L']],
          ['Greater', ['Length', ['Characters', 'c']], 1],
        ],
      ],
    ],
    [
      'Block(B := Map(k -> At(L, k), Range(1, n)), And(n <= Length(L), StartsWith(StringJoin(B), "a")))',
      [
        'Block',
        [
          'Declare',
          'B',
          "'unknown'",
          ['Map', fn(read(['At', 'L', 'k']), 'k'), ['Range', 1, 'n']],
        ],
        [
          'And',
          ['LessEqual', 'n', ['Length', 'L']],
          ['StartsWith', ['StringJoin', 'B'], str('a')],
        ],
      ],
    ],
    [
      'with f(t, k) := At(Characters(t), k), Block(c := f(s, i), And(i <= Length(s), Length(Characters(c)) > 1))',
      withF(
        read === bare
          ? 'At(Characters(t), k)'
          : 'Coalesce(At(Characters(t), k), "")',
        'let c = f(s, i)\ni <= Length(s) && Length(Characters(c)) > 1'
      ),
    ],
  ];

  test('Coalesce at a call that is not inlined declines: the callee yields the read', () => {
    const json = withF(
      'At(Characters(t), k)',
      'let c = Coalesce(f(s, i), "")\ni <= Length(s) && Length(Characters(c)) > 1'
    );
    for (const options of PASSES)
      expect([options, at(json, {}, options)]).toEqual([options, 'declined']);
  });

  test.each(witnesses(bare))('declines %s', (_, json) => {
    for (const options of PASSES)
      expect([options, at(json, {}, options)]).toEqual([options, 'declined']);
  });

  test.each(witnesses(guarded))('compiles %s with Coalesce', (_, json) => {
    const outside = { L: ['a'], s: 'ab', i: 9, n: 2 };
    for (const options of PASSES)
      expect([options, at(json, outside, options)]).toEqual([options, false]);
    const want =
      g
        .box(json as never)
        .subs({
          L: g.box(['List', str('ab')] as never),
          s: g.string('ab'),
          i: g.number(1),
          n: g.number(1),
        } as never)
        .evaluate().symbol === 'True';
    for (const options of PASSES)
      expect([
        options,
        at(json, { L: ['ab'], s: 'ab', i: 1, n: 1 }, options),
      ]).toEqual([options, want]);
  });

  test.each([
    ['ToUpperCase(At(L, i))', ['ToUpperCase', ['At', 'L', 'i']]],
    ['At(L, i) == "a"', ['Equal', ['At', 'L', 'i'], str('a')]],
    [
      'StringJoin([At(L, 1), "x"])',
      ['StringJoin', ['List', ['At', 'L', 1], str('x')]],
    ],
    ['[First(L), Last(L)]', ['List', ['First', 'L'], ['Last', 'L']]],
    [
      'Coalesce(At(L, i), At(L, j))',
      ['Coalesce', ['At', 'L', 'i'], ['At', 'L', 'j']],
    ],
  ])('declines %s', (_, json) => {
    declinesEverywhere(json, /a list that can be out of range/);
  });

  test('Trim, TrimStart and TrimEnd are unchanged', () => {
    for (const h of ['Trim', 'TrimStart', 'TrimEnd'])
      agrees([h, str(' a ')], [{}]);
  });
});

describe('the structural operators of a list of strings', () => {
  test.each([
    ['Reverse', (l: Json) => ['Reverse', l]],
    ['Take 2', (l: Json) => ['Take', l, 2]],
    ['Take -2', (l: Json) => ['Take', l, -2]],
    ['Drop 1', (l: Json) => ['Drop', l, 1]],
    ['Rest', (l: Json) => ['Rest', l]],
    ['Most', (l: Json) => ['Most', l]],
    ['RotateLeft', (l: Json) => ['RotateLeft', l, 1]],
  ])('%s', (_, f) => {
    agrees(f(['Characters', 's']), [{ s: '' }, { s: 'é' }, { s: 'ab́c' }]);
    agrees(
      f('L'),
      [...LENGTHS, DECOMPOSED].map((L) => ({ L }))
    );
  });
});

describe('Equal, NotEqual and KroneckerDelta of strings', () => {
  const points = [
    { s: 'a', t: 'a' },
    { s: 'a', t: 'b' },
    { s: 'é', t: 'é' },
  ];
  test.each([
    ['s == "a"', ['Equal', 's', str('a')]],
    ['s != "a"', ['NotEqual', 's', str('a')]],
    ['Equal(s, t, "a")', ['Equal', 's', 't', str('a')]],
    ['s == "é"', ['Equal', 's', str('é')]],
    ['KroneckerDelta(s, t)', ['KroneckerDelta', 's', 't']],
  ])('%s', (_, json) => {
    agrees(json, points);
  });

  test('Any and All', () => {
    for (const json of [
      ['Any', 'L', fn(['Equal', 'c', str('a')], 'c')],
      ['All', 'L', fn(['NotEqual', 'c', str('a')], 'c')],
    ])
      agrees(
        json,
        [...LENGTHS, DECOMPOSED].map((L) => ({ L }))
      );
  });

  test('Equal(["a", s], "a"): through scalarize, and declines without the fold', () => {
    const json = ['Equal', ['List', str('a'), 's'], str('a')];
    expect(compiled(json, { s: 'b' })).toEqual(interpreted(json, { s: 'b' }));
    expect(declines(json, { constantFold: false })).toBe(true);
  });
});

describe('the orders and the other operators stay declined', () => {
  test.each([
    ['Sort(L)', ['Sort', 'L']],
    ['Unique(L)', ['Unique', 'L']],
    ['Less(s, "b")', ['Less', 's', str('b')]],
    ['Max(L)', ['Max', 'L']],
    ['Contains(L, "x")', ['Contains', 'L', str('x')]],
    [
      'Reduce(Characters(s), (a, b) -> String(a, b))',
      ['Reduce', ['Characters', 's'], fn(['String', 'p', 'q'], 'p', 'q')],
    ],
    [
      'Reduce(Characters(s), (a, b) -> String(a, b), "")',
      [
        'Reduce',
        ['Characters', 's'],
        fn(['String', 'p', 'q'], 'p', 'q'),
        str(''),
      ],
    ],
    ['Equal(L, "a")', ['Equal', 'L', str('a')]],
    ['Equal(L2, "a")', ['Equal', 'L2', str('a')]],
    ['L', 'L'],
    ['If(b, L, ["x"])', ['If', 'b', 'L', ['List', str('x')]]],
    ['Chunk(L, 2)', ['Chunk', 'L', 2]],
  ])('%s', (_, json) => {
    declinesEverywhere(json);
  });

  test.each([
    [
      'Count(Characters(s), c -> c == "a")',
      ['Count', ['Characters', 's'], fn(['Equal', 'c', str('a')], 'c')],
    ],
    ['Map(ToUpperCase, L)', ['Map', 'ToUpperCase', 'L']],
    ['At(L, i)', ['At', 'L', 'i']],
    ['Coalesce(At(L, i), "z")', ['Coalesce', ['At', 'L', 'i'], str('z')]],
    ['s == "a"', ['Equal', 's', str('a')]],
    ['Reverse(Characters(s))', ['Reverse', ['Characters', 's']]],
  ])('%s declines on glsl and in the bigint mode', (_, json) => {
    expect(declines(json, { to: 'glsl' })).toBe(true);
    expect(declines(json, { mode: 'bigint' })).toBe(true);
  });
});

describe('the code of a program with no list of strings is unchanged', () => {
  test.each([
    [
      ['And', ['StartsWith', 's', str('a')], ['EndsWith', 's', str('b')]],
      '(() => {\n  const v1 = _SYS.ct(_.s);\n  return (_SYS.seqat(v1, "a", false) && _SYS.seqat(v1, "b", true));\n})()',
    ],
    [
      ['Sum', ['Length', ['ToUpperCase', 's']], ['Limits', 'k', 1, 'n']],
      "(() => {\n  const v5 = _SYS.ct(_.s);\n  const v7 = _SYS.tlength(_SYS.tupper(v5));\n  let v10 = 0;\n  const v3_lo = 1, v3_n = Math.floor(_.n - v3_lo) + 1;\n  if (!(v3_n - 1 < 4294967296)) throw new RangeError('a loop of more than 2^32 iterations');\n  for (let v3_i_b = 0, v3_i_e = Math.min(1024, v3_n); v3_i_b < v3_n; _SYS.tick(v3_i_e - v3_i_b), v3_i_b = v3_i_e, v3_i_e = Math.min(v3_i_b + 1024, v3_n)) for (let v3_i = v3_i_b; v3_i < v3_i_e; v3_i++) {\n    const v3 = v3_lo + v3_i;\n    v10 = (v10 + v7);\n  }\n  return v10;\n})()",
    ],
  ])('%j', (json, code) => {
    expect(js(json).code).toBe(code);
  });
});

describe('the entry and the workers with element reads', () => {
  test('a string for L still throws', () => {
    expect(() => run(['Map', 'ToUpperCase', 'L'], { L: 'ab' })).toThrow();
  });

  test('a list of strings at the boundary: strings, not shippable', () => {
    const r = js(['Map', 'ToUpperCase', 'L']);
    expect(r.strings).toBe(true);
    expect(r.shippable).toBe(false);
  });

  test('strings inside only: shippable, each cell of broadcast() the value of run()', () => {
    const json = [
      'Count',
      [
        'Map',
        fn(['If', ['Greater', 'k', 2], str('a'), str('b')], 'k'),
        ['Range', 1, 'n'],
      ],
      fn(['Equal', 'c', str('a')], 'c'),
    ];
    const r = js(json);
    expect(r.shippable).toBe(true);
    const ns = [0, 1, 3, 5];
    expect(
      Array.from(r.broadcast!({ n: new Float64Array(ns) }, {}) as never)
    ).toEqual(ns.map((n) => run(json, { n })));
    expect(ns.map((n) => run(json, { n }))).toEqual(
      ns.map((n) => interpreted(json, { n }))
    );
  });
});

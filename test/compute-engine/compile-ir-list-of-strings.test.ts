/**
 * Lists of strings on the javascript target of the IR compiler (CE-1548;
 * README of `src/compute-engine/compilation/ir/`, "The string lane"), and
 * `ColorToString`. A list of strings is a value at the boundary: a literal,
 * `Characters(s)` or an input read by `StringJoin`, or the result. Each
 * program is compiled and compared with `evaluate()`; a program whose value
 * depends on the passes also with `constantFold: false`, where it declines.
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
    expect(compiled(json, { s: 'xé' })).toEqual(interpreted(json, { s: 'xé' }));
    if (json !== lit)
      expect(declines(json, { constantFold: false })).toBe(true);
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

describe('a list of strings of run-time length declines', () => {
  test.each([
    ['At(L, 1)', ['At', 'L', 1]],
    ['Map(ToUpperCase, L)', ['Map', 'ToUpperCase', 'L']],
    ['Sort(L)', ['Sort', 'L']],
    ['Reverse(Characters(s))', ['Reverse', ['Characters', 's']]],
    ['At(Characters(s), 1)', ['At', ['Characters', 's'], 1]],
    ['If(b, L, ["x"])', ['If', 'b', 'L', ['List', { str: 'x' }]]],
    ['L', 'L'],
    ['M', ['StringJoin', ['At', 'M', 1]]],
    [
      'Count(Characters(s), c -> c == "a")',
      [
        'Count',
        ['Characters', 's'],
        ['Function', ['Equal', 'c', { str: 'a' }], 'c'],
      ],
    ],
  ])('%s', (_, json) => {
    expect(declines(json)).toBe(true);
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

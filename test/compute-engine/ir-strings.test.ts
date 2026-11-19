/**
 * The string lane of the IR compiler, phase 1 (CE-1530; README of
 * `src/compute-engine/compilation/ir/`, "The string lane"): a scalar string
 * on JavaScript, its input read as the engine boxes a string, and the text
 * operators, each against the interpreter on inputs with combining marks,
 * emoji, surrogate pairs and case mappings. Then the declines: other
 * targets, the bigint mode, a list of strings, a batch, and the operators
 * of phase 2.
 */

import { compile } from '../../src/compile';
import { createJavaScriptRuntime } from '../../src/runtime';
import { TEXT_HELPERS } from '../../src/compute-engine/compilation/text-runtime';
import { ComputeEngine } from '../../src/compute-engine';
import {
  isFunction,
  isString,
} from '../../src/compute-engine/boxed-expression/type-guards';

type Json = unknown;

const ce = new ComputeEngine();
ce.declare('s', 'string');
ce.declare('t', 'string');
ce.declare('n', 'integer');
ce.declare('L', 'list<string>');

const js = (json: Json, options: object = {}) =>
  compile(ce.box(json as never), { fallback: false, ...options });
const run = (json: Json, vars: Record<string, unknown>, options = {}) =>
  (js(json, options).run as (v: unknown) => unknown)(vars);

/** The interpreter's value of `json` at `vars` (each string boxed as the
 *  engine boxes it), as a JavaScript value; `error` for an error value. */
function interpreted(json: Json, vars: Record<string, string | number>) {
  const e = ce
    .box(json as never)
    .subs(
      Object.fromEntries(
        Object.entries(vars).map(([k, v]) => [
          k,
          typeof v === 'string' ? ce.string(v) : ce.number(v),
        ])
      ) as never
    )
    .evaluate();
  if (isString(e)) return e.string;
  if (e.symbol === 'True') return true;
  if (e.symbol === 'False') return false;
  if (isFunction(e, 'Error')) return 'error';
  return e.re;
}

/** The texts the values are compared on: ASCII, empty, a decomposed and a
 *  precomposed é, a ZWJ family, a flag, an astral letter (a surrogate
 *  pair), a lone surrogate, case mappings (ß, final sigma, dotted İ),
 *  Unicode whitespace. */
const TEXTS = [
  'hello',
  '',
  'e\u0301a',
  '\u00e9a',
  '👨‍👩‍👧x👨‍👩‍👧',
  '🇫🇷🇫🇷',
  '𝒳a𝒳',
  'a\ud800b',
  'Straße ΟΔΟΣ İstanbul',
  '\u3000 hi\u2003\n',
];

describe('the operators of the string lane, against the interpreter', () => {
  const unary = [
    'ToUpperCase',
    'ToLowerCase',
    'CaseFold',
    'Trim',
    'TrimStart',
    'TrimEnd',
    'Length',
    'String',
    'StringJoin',
  ];
  test.each(unary)('%s', (op) => {
    for (const s of TEXTS)
      expect([s, run([op, 's'], { s })]).toEqual([
        s,
        interpreted([op, 's'], { s }),
      ]);
  });

  const binary: [string, Json][] = [
    ['StartsWith', ['StartsWith', 's', 't']],
    ['EndsWith', ['EndsWith', 's', 't']],
    ['StringCompare', ['StringCompare', 's', 't']],
    ['String of two', ['String', 's', 't']],
    ['String of three', ['String', 's', 't', 's']],
    ['StringJoin with a separator', ['StringJoin', 's', 't']],
    ['Trim of a set', ['Trim', 's', 't']],
    ['TrimStart of a set', ['TrimStart', 's', 't']],
    ['TrimEnd of a set', ['TrimEnd', 's', 't']],
  ];
  const others = ['', 'h', 'a', '👨‍👩‍👧', 'e\u0301', '𝒳', 'xy'];
  test.each(binary)('%s', (_, json) => {
    for (const s of TEXTS)
      for (const t of others)
        expect([s, t, run(json, { s, t })]).toEqual([
          s,
          t,
          interpreted(json, { s, t }),
        ]);
  });

  const counted: [string, Json][] = [
    ['StringRepeat', ['StringRepeat', 's', 'n']],
    ['PadStart', ['PadStart', 's', 'n']],
    ['PadEnd', ['PadEnd', 's', 'n']],
    ['PadStart with a pad', ['PadStart', 's', 'n', { str: '👨‍👩‍👧y' }]],
    ['PadEnd with a pad', ['PadEnd', 's', 'n', { str: 'xy' }]],
    ['StringReplace', ['StringReplace', 's', { str: 'a' }, { str: 'aa' }]],
    [
      'StringReplace of a count',
      ['StringReplace', 's', 't', { str: '-' }, 'n'],
    ],
    [
      'StringReplace of a pattern',
      ['StringReplace', 's', ['RegExp', { str: '[a-z]' }], { str: '_' }],
    ],
    [
      'StringReplace of a pattern, flags and a count',
      [
        'StringReplace',
        's',
        ['RegExp', { str: 'H|(?:)' }, { str: 'i' }],
        { str: '.' },
        'n',
      ],
    ],
  ];
  test.each(counted)('%s', (_, json) => {
    for (const s of TEXTS)
      for (const n of [1, 2, 7])
        expect([s, n, run(json, { s, t: 'a', n })]).toEqual([
          s,
          n,
          interpreted(json, { s, t: 'a', n }),
        ]);
  });

  test('a count out of range: an error value of the interpreter, a throw of the code', () => {
    const cases: [Json, Record<string, string | number>][] = [
      [['StringRepeat', 's', 'n'], { s: 'ab', n: -1 }],
      [['StringRepeat', 's', 'n'], { s: 'ab', n: 1_000_001 }],
      [['PadStart', 's', 'n'], { s: 'ab', n: -1 }],
      [['PadEnd', 's', 'n', 't'], { s: 'ab', n: 4, t: '' }],
      [['StringReplace', 's', 't', { str: 'x' }], { s: 'ab', t: '' }],
      [
        ['StringReplace', 's', 't', { str: 'x' }, 'n'],
        { s: 'ab', t: 'a', n: 0 },
      ],
    ];
    for (const [json, vars] of cases) {
      expect(interpreted(json, vars)).toBe('error');
      expect(() => run(json, vars)).toThrow(RangeError);
    }
    // Zero copies, and a width at or below the length: no error.
    expect(run(['StringRepeat', 's', 'n'], { s: 'ab', n: 0 })).toBe('');
    expect(run(['PadStart', 's', 'n'], { s: 'ab', n: 0 })).toBe('ab');
  });

  test('a string literal, a local and a value folded at compile time', () => {
    expect(
      run(['ToUpperCase', { str: 'straße' }], {}, { constantFold: false })
    ).toBe('STRASSE');
    expect(run(['ToUpperCase', { str: 'straße' }], {})).toBe('STRASSE');
    // A node of a text operator is never folded with `N()`.
    expect(js(['String']).code).toContain("''");
    expect(
      run(
        [
          'Block',
          ['Declare', 'u', { str: 'unknown' }, ['Trim', 's']],
          ['String', 'u', 'u'],
        ],
        { s: ' ab ' }
      )
    ).toBe('abab');
    expect(
      run(['If', ['StartsWith', 's', { str: 'a' }], ['Length', 's'], 0], {
        s: 'a👨‍👩‍👧',
      })
    ).toBe(2);
  });

  test('a user function of a string parameter and result', () => {
    const engine = new ComputeEngine();
    engine.declare('s', 'string');
    engine.declare('shout', '(string) -> string');
    engine.assign(
      'shout',
      engine.box([
        'Function',
        ['String', ['ToUpperCase', 'x'], { str: '!' }],
        'x',
      ])
    );
    const r = compile(engine.box(['shout', ['Trim', 's']]), {
      fallback: false,
    });
    expect((r.run as (v: unknown) => unknown)({ s: ' hé ' })).toBe('HÉ!');
  });
});

describe('the input of a string', () => {
  test('is read as the engine boxes it: NFC, a lone surrogate replaced', () => {
    expect(run('s', { s: 'e\u0301' })).toBe('\u00e9');
    expect(run('s', { s: 'a\udc00' })).toBe('a\ufffd');
    expect(run(['Length', 's'], { s: 'e\u0301e\u0301' })).toBe(2);
  });

  test('is repaired with no String.prototype.toWellFormed', () => {
    const proto = String.prototype as { toWellFormed?: unknown };
    const saved = proto.toWellFormed;
    delete proto.toWellFormed;
    try {
      expect(TEXT_HELPERS.ct('a\ud800b\udc00')).toBe('a\ufffdb\ufffd');
      expect(TEXT_HELPERS.ct('\ud835\udcb3')).toBe('\ud835\udcb3');
    } finally {
      proto.toWellFormed = saved;
    }
  });

  test('of another type throws', () => {
    expect(() => run(['ToUpperCase', 's'], { s: 42 })).toThrow(TypeError);
  });

  test('is reported with the type it is read as', () => {
    const r = js(['ToUpperCase', 's']);
    expect(r.freeSymbols).toEqual(['s']);
    expect(r.freeSymbolTypes?.s.lowered).toBe('string');
  });

  test('read first in an arm is read once, before it', () => {
    const json = [
      'If',
      ['Less', 'n', 0],
      ['Length', 's'],
      ['Length', ['ToUpperCase', 's']],
    ];
    expect(run(json, { s: 'ß', n: 1 })).toBe(2);
    expect(run(json, { s: 'ß', n: -1 })).toBe(1);
  });
});

describe('declines', () => {
  const cause = (json: Json, options: object = {}): string => {
    try {
      js(json, options);
    } catch (e) {
      return (e as Error).message;
    }
    return 'compiled';
  };

  test.each([
    ['glsl', { to: 'glsl' }],
    ['interval-js', { to: 'interval-js' }],
    ['the bigint mode', { mode: 'bigint' }],
  ])('a string on %s', (_, options) => {
    expect(cause(['Length', ['ToUpperCase', 's']], options)).not.toBe(
      'compiled'
    );
    expect(
      cause(['ToUpperCase', { str: 'a' }], { ...options, constantFold: false })
    ).not.toBe('compiled');
  });

  test.each<[string, Json]>([
    ['a list of strings', ['Length', 'L']],
    ['a list of string literals', ['List', { str: 'a' }, { str: 'b' }]],
    ['Characters', ['Characters', 's']],
    ['GraphemeClusters', ['GraphemeClusters', 's']],
    ['StringJoin of a list', ['StringJoin', 'L', { str: '-' }]],
    ['At of a string', ['At', 's', 1]],
    ['Equal of strings', ['Equal', 's', 't']],
    ['a string and a number', ['If', ['Less', 'n', 0], 's', 1]],
    ['String of a number', ['String', 's', 'n']],
    // `N()` would give the decimal text, the interpreter gives `1/3`.
    ['String of an exact number', ['String', ['Divide', 1, 3]]],
    [
      'Length of String of an exact number',
      ['Length', ['String', ['Divide', 1, 3]]],
    ],
    [
      'String of a string and of a number',
      ['String', 's', ['String', ['Divide', 1, 3]]],
    ],
    [
      'StringReplace of a function',
      ['StringReplace', 's', ['RegExp', { str: 'a' }], ['Function', 'm', 'm']],
    ],
  ])('%s', (_, json) => {
    expect(cause(json)).not.toBe('compiled');
  });

  test('a closed text node on GLSL', () => {
    ce.declare('x', 'real');
    for (const json of [
      ['Add', 'x', ['Length', ['String', ['Divide', 1, 3]]]],
      ['Add', 'x', ['StringCompare', { str: 'a' }, { str: 'b' }]],
    ])
      expect(cause(json, { to: 'glsl' })).not.toBe('compiled');
  });

  test('a RegExp that is not the library operator', () => {
    const engine = new ComputeEngine();
    engine.declare('s', 'string');
    engine.pushScope();
    engine.declare('RegExp', '(string) -> string');
    engine.assign('RegExp', engine.box(['Function', { str: 'b' }, 'p']));
    const e = engine.box([
      'StringReplace',
      's',
      ['RegExp', { str: 'a' }],
      { str: '-' },
    ]);
    let got: unknown;
    try {
      got = (compile(e, { fallback: false }).run as (v: unknown) => unknown)({
        s: 'ab',
      });
    } catch {
      got = 'declined';
    }
    // The interpreter's value, or a decline: never the written pattern.
    const want = e.subs({ s: engine.string('ab') }).evaluate();
    expect([
      'declined',
      isString(want) ? want.string : want.toString(),
    ]).toContain(got);
  });

  test('stored code of a string input or result has no batch', () => {
    const rt = createJavaScriptRuntime();
    for (const [json, value] of [
      [['Length', 's'], 2],
      [['StringRepeat', { str: 'a' }, 'n'], 'aa'],
    ] as const) {
      const r = js(json);
      expect(r.shippable).toBe(false);
      expect(r.strings).toBe(true);
      const stored = { ...r };
      expect(
        (rt.load(stored) as (v: unknown) => unknown)({ s: 'ab', n: 2 })
      ).toBe(value);
      expect(() => rt.loadBroadcast(stored)).toThrow(/string/);
      expect(() => rt.loadBroadcastSlice(stored)).toThrow(/string/);
      expect(() => rt.loadBroadcastAsync(stored)).toThrow(/string/);
    }
    // A string inside only: a batch of numbers.
    const k = js(['Length', ['StringRepeat', { str: 'ab' }, 'n']]);
    expect(k.strings).toBeUndefined();
    expect(
      Array.from(k.broadcast!({ n: new Float64Array([1, 2]) }, {}))
    ).toEqual([2, 4]);
  });

  test('a batch of an input or a result of strings', () => {
    const r = js(['Length', 's']);
    expect(() => r.broadcast!({ s: ['a', 'b'] as never }, {})).toThrow(
      /string/
    );
    const k = js(['StringRepeat', { str: 'a' }, 'n']);
    expect(() => k.broadcast!({ n: [1, 2] }, {})).toThrow(/string/);
    expect(k.willUsePool!({ n: [1, 2] }, {})).toBe(false);
    return expect(k.broadcastAsync!({ n: [1, 2] }, {})).rejects.toThrow(
      /string/
    );
  });
});

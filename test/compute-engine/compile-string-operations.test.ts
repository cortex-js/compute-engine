/**
 * The compile-target matrix for the Strings **Phase 2** operators —
 * `docs/plans/2026-08-16-string-phase2-join-search-ops.md`, decision D8.
 *
 * Phase 2 adds the sequence-search family (`RangeOf`, `ContainsSequence`,
 * `StartsWith`, `EndsWith`), the string-specific operations (`StringReplace`,
 * `Trim`/`TrimStart`/`TrimEnd`, `StringRepeat`, `PadStart`/`PadEnd`), the case
 * operations (`ToUpperCase`, `ToLowerCase`, `CaseFold`), `StringCompare` and
 * `NumberFrom`; it re-pins `StringJoin` to `(collection, separator?)` and gives
 * `Join` its string-preserving arm.
 *
 * The rule this suite enforces is the one D8 states: a lowering either agrees
 * with the interpreter on every input, or it reports `success: false`. There is
 * never a wrong value behind `success: true`. So every green cell is asserted
 * TWICE — it compiles, and its compiled value equals the interpreter's on the
 * same input — and every red cell asserts `success: false`.
 *
 * JavaScript is the only target with lowerings. Python, GLSL and WGSL decline
 * every Phase-2 operator, and they do so through the DEFAULT: an operator the
 * engine knows but the target has no entry for is refused by the compiler
 * itself. The first describe block locks that default, because the whole
 * Python/GLSL/WGSL column of the matrix rests on it.
 *
 * Test inputs are the D10 set (Phase 1's D15): ASCII, the precomposed and
 * decomposed spellings of `"é"`, one ZWJ emoji family and one regional-indicator
 * flag. The decomposed spelling is bound at `run()` time — a string LITERAL is
 * NFC-normalized when the engine boxes it, so only a raw host string reaching a
 * compiled parameter exercises the conditioning the emitted code does. Each
 * non-ASCII expectation carries a comment naming the Unicode behaviour it
 * assumes.
 *
 * Note on `constantFold: false` everywhere: with folding ON, a literal-only
 * expression is evaluated at COMPILE time and `success: true` would prove
 * nothing about the lowering.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { BoxedExpression } from '../../src/compute-engine/global-types';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import {
  isCharacter,
  isString,
} from '../../src/compute-engine/boxed-expression/type-guards';
import { withRandomSeedFrame } from '../../src/compute-engine/boxed-expression/utils';

let ce: ComputeEngine;
beforeEach(() => {
  ce = new ComputeEngine();
});

// ── The D10 inputs ──────────────────────────────────────────────────────────

/** U+00E9 LATIN SMALL LETTER E WITH ACUTE: one code point, one cluster. */
const E_ACUTE_PRECOMPOSED = 'é';
/** `"e"` + U+0301 COMBINING ACUTE ACCENT: two code points, one cluster. NFC
 * composes it to U+00E9, which is what the engine stores and what every
 * lowering must reproduce for a raw host string. */
const E_ACUTE_DECOMPOSED = 'é';
/** MAN + ZWJ + WOMAN + ZWJ + BOY: five code points (seven UTF-16 units), ONE
 * grapheme cluster. */
const ZWJ_FAMILY = '\u{1F468}‍\u{1F469}‍\u{1F466}';
/** REGIONAL INDICATOR F + R: two code points (four UTF-16 units), one cluster. */
const FLAG_FR = '\u{1F1EB}\u{1F1F7}';

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * The interpreter's value, projected onto the JavaScript representation a
 * compiled function returns. Text first: a string is `isCollection === true`,
 * so the collection branch would compare a compiled `"ab"` against
 * `["a", "b"]`. `Nothing` projects to `undefined` — the absence marker an
 * OBJECT-domain access already takes on this target, and what `RangeOf` emits
 * for a needle it does not find.
 */
function project(v: BoxedExpression): unknown {
  if (v.symbol === 'True') return true;
  if (v.symbol === 'False') return false;
  if (v.symbol === 'Nothing' || v.symbol === 'Missing') return undefined;
  if (isString(v) || isCharacter(v)) return v.string;
  if (v.isNumberLiteral) return v.re;
  if (v.isCollection) return Array.from(v.each(), project);
  return `«unprojectable: ${v.toString()}»`;
}

/**
 * Assert `expr` compiles and that running the compiled function reproduces the
 * interpreter's value. `vars` supplies the free symbols.
 *
 * `fallback: false` makes a decline THROW rather than silently interpret, so a
 * cell that stops compiling fails loudly with its own diagnostic.
 */
function agreesWithInterpreter(
  expr: BoxedExpression,
  vars: Record<string, unknown> = {}
): void {
  const r = compile(expr, { fallback: false, constantFold: false });
  expect(r.success).toBe(true);
  expect((r.run as (v: Record<string, unknown>) => unknown)(vars)).toEqual(
    project(expr.evaluate())
  );
}

/**
 * Assert `expr` compiles and that its compiled value on the SUBSTITUTED
 * operands equals what the interpreter answers for the same substitution. The
 * run-time route is what exercises the ingress conditioning: a string literal
 * is already NFC when the engine boxes it, so only a raw host string can be
 * decomposed or hold a lone surrogate.
 */
function agreesWithInterpreterAtRuntime(
  expr: BoxedExpression,
  vars: Record<string, string>
): void {
  const r = compile(expr, { fallback: false, constantFold: false });
  expect(r.success).toBe(true);
  const substituted = expr.subs(
    Object.fromEntries(
      Object.entries(vars).map(([k, v]) => [k, ce.string(v)])
    ) as never
  );
  expect((r.run as (v: Record<string, unknown>) => unknown)(vars)).toEqual(
    project(substituted.evaluate())
  );
}

/** Assert `expr` declines to compile — the engine reports `success: false` and
 * falls back to the interpreter, which answers correctly. */
function failsClosed(expr: BoxedExpression): void {
  expect(compile(expr, { constantFold: false }).success).toBe(false);
}

/** `expr` compiled for a non-JavaScript target. */
function compileTo(expr: BoxedExpression, to: 'python' | 'glsl' | 'wgsl') {
  return compile(expr, { to, constantFold: false } as never);
}

// ── The default: an operator with no lowering entry declines ────────────────

describe('D8 lock: an operator with NO lowering entry declines on every target', () => {
  // The whole Python/GLSL/WGSL column of the Phase-2 matrix — and the
  // JavaScript `NumberFrom` cell — rests on this default. `NumberFrom` is the
  // witness: D8 leaves it fail-closed on purpose (its parse contract and its
  // exactness rules — an integer numeral is an exact integer, a fractional one
  // an exact Decimal — have no compiled equivalent), so it has no entry in ANY
  // target's function table and must be refused by the compiler itself.
  //
  // If this test ever fails, some target has grown a `NumberFrom` entry and the
  // fail-closed cells below stop being guaranteed by the default.
  test.each(['javascript', 'python', 'glsl', 'wgsl'] as const)(
    '`NumberFrom` declines on the %s target',
    (to) => {
      const r = compile(ce.box(['NumberFrom', { str: '12' }]), {
        to,
        constantFold: false,
      } as never);
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/NumberFrom: cannot compile/);
      expect(r.error).toMatch(/no lowering for it/);
    }
  );

  test('the interpreter answers `NumberFrom` correctly (the fallback)', () => {
    expect(ce.box(['NumberFrom', { str: '1.5e3' }]).evaluate().re).toBe(1500);
  });
});

// ── StringJoin — the NARROWED signature ─────────────────────────────────────

describe('D2/D8: `StringJoin(xs, sep?)` joins ONE collection', () => {
  test.each([
    // A provably STRING subject is the collection of its own characters, so a
    // separator lands between them — the user-ruled Python `sep.join(s)`
    // semantics.
    [['StringJoin', { str: 'abc' }, { str: '-' }], 'a-b-c'],
    [['StringJoin', { str: 'abc' }], 'abc'],
    [['StringJoin', { str: '' }, { str: '-' }], ''],
    // A one-character subject has no interior boundary.
    [['StringJoin', { str: 'a' }, { str: 'b' }], 'a'],
    // A collection of strings / characters.
    [
      ['StringJoin', ['List', { str: 'ab' }, { str: 'cd' }], { str: '/' }],
      'ab/cd',
    ],
    [['StringJoin', ['Characters', { str: 'abc' }], { str: '.' }], 'a.b.c'],
    [['StringJoin', ['List']], ''],
  ] as const)('%p is %p, and the compiled value agrees', (json, expected) => {
    const expr = ce.box(json as never);
    expect(expr.evaluate().string).toBe(expected);
    agreesWithInterpreter(expr);
  });

  test('a ZWJ family and a flag are single elements, not code-unit runs', () => {
    // `"a"` + family + `"b"` is THREE characters, so two separators appear.
    // A code-unit join would have produced eight.
    const expr = ce.box([
      'StringJoin',
      { str: `a${ZWJ_FAMILY}b` },
      { str: '-' },
    ]);
    expect(expr.evaluate().string).toBe(`a-${ZWJ_FAMILY}-b`);
    agreesWithInterpreter(expr);
    agreesWithInterpreter(
      ce.box(['StringJoin', { str: `x${FLAG_FR}y` }, { str: '|' }])
    );
  });

  test('a DECOMPOSED string bound at run time joins as one character', () => {
    ce.declare('sv', 'string');
    const r = compile(ce.box(['StringJoin', 'sv', { str: '-' }]), {
      fallback: false,
      constantFold: false,
    });
    // `_SYS.chars` conditions its input (NFC, then the lone-surrogate
    // replacement) before segmenting, so `"e" + U+0301` is the single
    // precomposed U+00E9 and no separator is inserted inside it.
    expect((r.run as any)({ sv: E_ACUTE_DECOMPOSED })).toBe(
      E_ACUTE_PRECOMPOSED
    );
    expect((r.run as any)({ sv: `a${E_ACUTE_DECOMPOSED}b` })).toBe(
      `a-${E_ACUTE_PRECOMPOSED}-b`
    );
  });

  test.each([
    // Signature errors: the compiler refuses the resulting `Error` node.
    [
      'a scalar character subject',
      ['StringJoin', ['CharacterFrom', { str: 'a' }]],
    ],
    [
      'the removed VARIADIC form',
      ['StringJoin', { str: 'a' }, { str: 'b' }, { str: 'c' }],
    ],
    ['a non-string separator', ['StringJoin', { str: 'a' }, 1]],
    ['a numeric element', ['StringJoin', ['List', 1, 2]]],
    // The lowering's own gate: a `Set` is a `collection<string>` the
    // interpreter joins, but it does not lower to an indexed JS array.
    [
      'a non-indexed collection',
      ['StringJoin', ['Set', { str: 'a' }, { str: 'b' }]],
    ],
  ] as const)('%s fails closed', (_label, json) => {
    failsClosed(ce.box(json as never));
  });

  test('an INFINITE collection subject fails closed', () => {
    // `Map(f, Range(1, oo))` reports `indexed_collection<string>`, so the
    // element-type gate admits it — but an infinite source cannot materialize
    // to the JS array `.map(_SYS.ct).join(sep)` needs. The interpreter leaves
    // `StringJoin` unevaluated on it, so the compiled artifact must decline
    // rather than hang or throw a RangeError at run time.
    const expr = ce.box([
      'StringJoin',
      [
        'Map',
        ['Function', { str: 'a' }, 'n'],
        ['Range', 1, 'PositiveInfinity'],
      ],
      { str: '-' },
    ]);
    expect(expr.evaluate().operator).toBe('StringJoin');
    failsClosed(expr);
  });
});

// ── Join — the string-preserving arm ────────────────────────────────────────

describe('D1/D8: `Join` over all-string operands is the variadic concatenation', () => {
  test.each([
    [['Join', { str: 'ab' }, { str: 'cd' }], 'abcd'],
    [['Join', { str: 'ab' }], 'ab'],
    [['Join', { str: 'a' }, { str: 'b' }, { str: 'c' }], 'abc'],
    // A base letter and a lone combining mark COMPOSE at NFC time, which is
    // what `engine.string()` does and what a raw `+` would not.
    [['Join', { str: 'e' }, { str: '́' }], E_ACUTE_PRECOMPOSED],
    [['Join', { str: '' }, { str: 'a' }], 'a'],
  ] as const)('%p is %p, and the compiled value agrees', (json, expected) => {
    const expr = ce.box(json as never);
    expect(expr.evaluate().string).toBe(expected);
    expect(expr.type.toString()).toBe('string');
    agreesWithInterpreter(expr);
  });

  test('two string-typed symbols concatenate and normalize at run time', () => {
    ce.declare('sa', 'string');
    ce.declare('sb', 'string');
    const expr = ce.box(['Join', 'sa', 'sb']);
    const r = compile(expr, { fallback: false, constantFold: false });
    expect(r.success).toBe(true);
    expect((r.run as any)({ sa: 'e', sb: '́' })).toBe(E_ACUTE_PRECOMPOSED);
    expect((r.run as any)({ sa: ZWJ_FAMILY, sb: FLAG_FR })).toBe(
      ZWJ_FAMILY + FLAG_FR
    );
  });

  test('a MIXED string/list `Join` still fails closed', () => {
    // The interpreter takes the generic arm and answers a
    // `list<character | string>`; a string does not lower to a JS array, so
    // `collArg` refuses it.
    const expr = ce.box(['Join', { str: 'ab' }, ['List', { str: 'c' }]]);
    expect(expr.evaluate().type.toString()).toMatch(/list</);
    failsClosed(expr);
  });

  test('an all-list `Join` keeps its previous list lowering', () => {
    agreesWithInterpreter(
      ce.box(['Join', ['List', 1, 2], ['List', 3]] as never)
    );
  });
});

// ── The sequence-search family ──────────────────────────────────────────────

describe('D8: sequence search over strings and lists', () => {
  test.each([
    // RangeOf: the 1-based inclusive span, which lowers to the same JS array
    // `Range(a, b)` does.
    [['RangeOf', { str: 'abcb' }, { str: 'b' }], [2]],
    [
      ['RangeOf', { str: 'abcb' }, { str: 'bc' }],
      [2, 3],
    ],
    [['RangeOf', { str: 'abcb' }, { str: 'b' }, 3], [4]],
    // Absent → the interpreter's `Nothing`, projected to `undefined`.
    [['RangeOf', { str: 'abcb' }, { str: 'z' }], undefined],
    [['RangeOf', { str: 'abcb' }, { str: 'b' }, 5], undefined],
    // Generic over indexed collections, not just strings.
    [
      ['RangeOf', ['List', 1, 2, 3, 2], ['List', 2, 3]],
      [2, 3],
    ],
    [['RangeOf', ['List', 1, 2, 3], ['List', 9]], undefined],
  ] as const)('%p is %p, and the compiled value agrees', (json, expected) => {
    const expr = ce.box(json as never);
    expect(project(expr.evaluate())).toEqual(expected);
    agreesWithInterpreter(expr);
  });

  test.each([
    [['ContainsSequence', { str: 'abc' }, { str: 'bc' }], true],
    [['ContainsSequence', { str: 'abc' }, { str: 'ca' }], false],
    // An EMPTY needle is `True` here — the empty sequence is a subsequence of
    // everything — while `RangeOf` rejects it, because an empty SPAN has no
    // `Range` representation.
    [['ContainsSequence', { str: 'abc' }, { str: '' }], true],
    [['ContainsSequence', ['List', 1, 2, 3], ['List', 2, 3]], true],
    [['StartsWith', { str: 'abc' }, { str: 'ab' }], true],
    [['StartsWith', { str: 'abc' }, { str: 'b' }], false],
    [['StartsWith', { str: 'abc' }, { str: '' }], true],
    [['StartsWith', { str: 'abc' }, { str: 'abcd' }], false],
    [['EndsWith', { str: 'abc' }, { str: 'bc' }], true],
    [['EndsWith', { str: 'abc' }, { str: 'ab' }], false],
    [['EndsWith', { str: 'abc' }, { str: '' }], true],
    [['EndsWith', ['List', 1, 2, 3], ['List', 2, 3]], true],
  ] as const)('%p is %p, and the compiled value agrees', (json, expected) => {
    const expr = ce.box(json as never);
    expect(project(expr.evaluate())).toBe(expected);
    agreesWithInterpreter(expr);
  });

  test('a match never begins or ends inside a grapheme cluster', () => {
    // The family compares whole CHARACTERS. A ZWJ family is one of them, so it
    // is found at position 2 of `"a" + family + "b"` — a code-unit search would
    // have reported 2 as a UTF-16 offset into the surrogate pair.
    const family = ce.box([
      'RangeOf',
      { str: `a${ZWJ_FAMILY}b` },
      { str: ZWJ_FAMILY },
    ]);
    expect(project(family.evaluate())).toEqual([2]);
    agreesWithInterpreter(family);
    // A regional-indicator PAIR is one flag: the search finds the whole flag,
    // never one half of it.
    const flag = ce.box(['RangeOf', { str: `x${FLAG_FR}y` }, { str: FLAG_FR }]);
    expect(project(flag.evaluate())).toEqual([2]);
    agreesWithInterpreter(flag);
    agreesWithInterpreter(
      ce.box(['ContainsSequence', { str: `x${FLAG_FR}y` }, { str: FLAG_FR }])
    );
    agreesWithInterpreter(
      ce.box(['EndsWith', { str: `ab${ZWJ_FAMILY}` }, { str: ZWJ_FAMILY }])
    );
  });

  test('a DECOMPOSED subject bound at run time matches a precomposed needle', () => {
    // The element test conditions both sides (NFC, then the lone-surrogate
    // replacement), which is what the interpreter compares — it normalized at
    // boxing time.
    ce.declare('sv', 'string');
    for (const [json, expected] of [
      [['StartsWith', 'sv', { str: E_ACUTE_PRECOMPOSED }], true],
      [['ContainsSequence', 'sv', { str: E_ACUTE_PRECOMPOSED }], true],
      [['EndsWith', 'sv', { str: 'z' }], true],
    ] as const) {
      const r = compile(ce.box(json as never), {
        fallback: false,
        constantFold: false,
      });
      expect(r.success).toBe(true);
      expect((r.run as any)({ sv: `${E_ACUTE_DECOMPOSED}z` })).toBe(expected);
    }
    const r = compile(ce.box(['RangeOf', 'sv', { str: E_ACUTE_PRECOMPOSED }]), {
      fallback: false,
      constantFold: false,
    });
    expect((r.run as any)({ sv: `x${E_ACUTE_DECOMPOSED}` })).toEqual([2]);
  });

  test('a `list<character>` needle matches a string subject', () => {
    // `.isSame()` bridges a character and a one-cluster string, so a
    // `list<character>` needle finds its span in a `string` subject — and the
    // emitted `_SYS.eqt` reproduces that, since both sides lower to
    // one-cluster JS strings.
    //
    // The needle is written as a LITERAL list: `RangeOf`'s gate requires the
    // needle to be provably non-empty (an empty needle is an interpreter error
    // value), and a `Characters(…)` call does not report its emptiness without
    // being evaluated, so that spelling declines — see the fail-closed cell
    // below.
    const expr = ce.box([
      'RangeOf',
      { str: 'abc' },
      [
        'List',
        ['CharacterFrom', { str: 'b' }],
        ['CharacterFrom', { str: 'c' }],
      ],
    ]);
    expect(project(expr.evaluate())).toEqual([2, 3]);
    agreesWithInterpreter(expr);
    // `ContainsSequence` and its anchored siblings have no empty-needle gate —
    // an empty needle is `True` for them — so a computed needle compiles there.
    agreesWithInterpreter(
      ce.box([
        'ContainsSequence',
        { str: 'abc' },
        ['Characters', { str: 'bc' }],
      ])
    );
  });

  test.each([
    // The error-value cells. A compiled artifact has no representation for an
    // interpreter ERROR value, so these must decline rather than answer.
    ['an empty RangeOf needle', ['RangeOf', { str: 'abc' }, { str: '' }]],
    ['a RangeOf `from` below 1', ['RangeOf', { str: 'abc' }, { str: 'b' }, 0]],
  ] as const)('%s fails closed', (_label, json) => {
    const expr = ce.box(json as never);
    // The interpreter's answer is an error value, which is exactly why the
    // compiled artifact must not claim one.
    expect(expr.evaluate().operator).toBe('Error');
    failsClosed(expr);
  });

  test('a non-literal `from`, and a needle that is not provably non-empty, decline', () => {
    ce.declare('nv', 'integer');
    ce.declare('needle', 'string');
    failsClosed(ce.box(['RangeOf', { str: 'abc' }, { str: 'b' }, 'nv']));
    failsClosed(ce.box(['RangeOf', { str: 'abc' }, 'needle']));
    // A COMPUTED needle does not report its emptiness without being
    // evaluated, so it is not provably non-empty either — the conservative
    // side of the gate, and the reason the `list<character>` needle above is
    // written as a literal list.
    failsClosed(
      ce.box(['RangeOf', { str: 'abc' }, ['Characters', { str: 'b' }]])
    );
  });

  test('a union-typed subject declines on every member of the family', () => {
    // `string | list<number>` is a subtype of `indexed_collection`, so the list
    // lowering would accept it and walk UTF-16 code units at run time.
    ce.declare('mixv', 'string | list<number>');
    for (const op of ['ContainsSequence', 'StartsWith', 'EndsWith'])
      failsClosed(ce.box([op, 'mixv', { str: 'b' }] as never));
    failsClosed(ce.box(['RangeOf', 'mixv', { str: 'b' }]));
  });

  test('a COMPOUND-element subject or needle declines on every member', () => {
    // The emitted element test compares text with conditioned equality and
    // everything else with `===`, which is REFERENCE identity for the JS array
    // a nested list lowers to. The interpreter's `.isSame()` compares them
    // structurally, so each cell below has a definite interpreter answer that a
    // compiled `===` search would contradict — which is why they must decline.
    const nested = ['List', ['List', 1, 2], ['List', 3, 4]] as const;
    const tail = ['List', ['List', 3, 4]] as const;
    for (const [json, expected] of [
      [['RangeOf', nested, tail], [2]],
      [['ContainsSequence', nested, tail], true],
      [['StartsWith', nested, ['List', ['List', 1, 2]]], true],
      [['EndsWith', nested, tail], true],
    ] as const) {
      const expr = ce.box(json as never);
      expect(project(expr.evaluate())).toEqual(expected);
      failsClosed(expr);
    }
    // A complex element is invisible in the element TYPE — a numeric list
    // reports the generic `number` whether its elements are real or complex —
    // so it is caught by the literal inspection instead. A complex number
    // lowers to a `{re, im}` object, which `===` also compares by reference.
    const cplx = ['List', 1, ['Complex', 0, 1]] as const;
    const needle = ['List', ['Complex', 0, 1]] as const;
    expect(
      project(ce.box(['RangeOf', cplx, needle] as never).evaluate())
    ).toEqual([2]);
    expect(
      project(ce.box(['ContainsSequence', cplx, needle] as never).evaluate())
    ).toBe(true);
    for (const json of [
      ['RangeOf', cplx, needle],
      ['ContainsSequence', cplx, needle],
      ['StartsWith', cplx, ['List', 1]],
      ['EndsWith', cplx, needle],
      // The NEEDLE alone carrying the complex content is refused too.
      ['ContainsSequence', ['List', 1, 2], needle],
    ] as const)
      failsClosed(ce.box(json as never));
  });
});

// ── String-specific operations ──────────────────────────────────────────────

describe('D8: StringReplace', () => {
  test.each([
    // A replacement's own content is never re-matched: the scan walks the
    // ORIGINAL subject and skips past each match's span.
    [['StringReplace', { str: 'aa' }, { str: 'a' }, { str: 'aa' }], 'aaaa'],
    [
      ['StringReplace', { str: 'banana' }, { str: 'a' }, { str: 'o' }],
      'bonono',
    ],
    [['StringReplace', { str: 'aaa' }, { str: 'a' }, { str: 'b' }, 2], 'bba'],
    // An empty replacement is deletion.
    [['StringReplace', { str: 'abcabc' }, { str: 'b' }, { str: '' }], 'acac'],
    [['StringReplace', { str: 'abc' }, { str: 'z' }, { str: '!' }], 'abc'],
    // A whole ZWJ family is one character, so it matches as one unit.
    [
      [
        'StringReplace',
        { str: `a${ZWJ_FAMILY}b` },
        { str: ZWJ_FAMILY },
        { str: '!' },
      ],
      'a!b',
    ],
    [
      [
        'StringReplace',
        { str: `x${FLAG_FR}y` },
        { str: FLAG_FR },
        { str: '_' },
      ],
      'x_y',
    ],
  ] as const)('%p is %p, and the compiled value agrees', (json, expected) => {
    const expr = ce.box(json as never);
    expect(expr.evaluate().string).toBe(expected);
    agreesWithInterpreter(expr);
  });

  test('a decomposed subject bound at run time is replaced by character', () => {
    ce.declare('sv', 'string');
    agreesWithInterpreterAtRuntime(
      ce.box([
        'StringReplace',
        'sv',
        { str: E_ACUTE_PRECOMPOSED },
        { str: 'X' },
      ]),
      { sv: `a${E_ACUTE_DECOMPOSED}b` }
    );
  });

  test.each([
    // Error-value cells: an empty target and a `count` below 1.
    [
      'an empty target',
      ['StringReplace', { str: 'ab' }, { str: '' }, { str: 'x' }],
    ],
    [
      'a zero count',
      ['StringReplace', { str: 'ab' }, { str: 'a' }, { str: 'x' }, 0],
    ],
  ] as const)('%s fails closed', (_label, json) => {
    const expr = ce.box(json as never);
    expect(expr.evaluate().operator).toBe('Error');
    failsClosed(expr);
  });

  test('a non-literal target or count declines', () => {
    // Whether the interpreter answers a value or an error depends on the
    // run-time operand, and a compiled artifact cannot return an error value.
    ce.declare('tv', 'string');
    ce.declare('nv', 'integer');
    failsClosed(ce.box(['StringReplace', { str: 'ab' }, 'tv', { str: 'x' }]));
    failsClosed(
      ce.box(['StringReplace', { str: 'ab' }, { str: 'a' }, { str: 'x' }, 'nv'])
    );
  });
});

describe('D8: Trim / TrimStart / TrimEnd', () => {
  test.each([
    [['Trim', { str: '  hi  ' }], 'hi'],
    [['TrimStart', { str: '  hi  ' }], 'hi  '],
    [['TrimEnd', { str: '  hi  ' }], '  hi'],
    // The default set is the Unicode White_Space property, spelled out code
    // point by code point rather than `\s`: U+3000 IDEOGRAPHIC SPACE and
    // U+00A0 NO-BREAK SPACE are members, and both must be stripped.
    [['Trim', { str: '　hi ' }], 'hi'],
    [['Trim', { str: ' hi ' }], 'hi'],
    // `chars` is a SET of characters, never a literal substring.
    [['Trim', { str: 'xyhiyx' }, { str: 'xy' }], 'hi'],
    [['TrimStart', { str: 'xyhiyx' }, { str: 'xy' }], 'hiyx'],
    [['Trim', { str: 'abcba' }, ['Characters', { str: 'ab' }]], 'c'],
    // A flag is one character, so it is stripped whole.
    [['Trim', { str: `${FLAG_FR}hi${FLAG_FR}` }, { str: FLAG_FR }], 'hi'],
    [['Trim', { str: 'hi' }], 'hi'],
    [['Trim', { str: '   ' }], ''],
  ] as const)('%p is %p, and the compiled value agrees', (json, expected) => {
    const expr = ce.box(json as never);
    expect(expr.evaluate().string).toBe(expected);
    agreesWithInterpreter(expr);
  });

  test('a decomposed subject bound at run time trims by character', () => {
    ce.declare('sv', 'string');
    agreesWithInterpreterAtRuntime(ce.box(['Trim', 'sv']), {
      sv: `  ${E_ACUTE_DECOMPOSED}  `,
    });
  });

  test('a non-text `chars` operand fails closed', () => {
    // The signature is `(string, chars: (string | collection<character>)?)`, so
    // a number is an `incompatible-type` error the compiler refuses.
    failsClosed(ce.box(['Trim', { str: 'a' }, 1]));
  });

  test('an INFINITE `chars` operand fails closed', () => {
    // `Map(f, Range(1, oo))` reports `indexed_collection<string>`, so the
    // element-type gate admits it — but `_SYS.strim` needs the character set
    // as a materialized array, which an infinite source cannot supply. The
    // interpreter leaves `Trim` unevaluated on it.
    const expr = ce.box([
      'Trim',
      { str: ' hi ' },
      [
        'Map',
        ['Function', { str: 'a' }, 'n'],
        ['Range', 1, 'PositiveInfinity'],
      ],
    ]);
    expect(expr.evaluate().operator).toBe('Trim');
    failsClosed(expr);
  });
});

describe('D8: StringRepeat and PadStart / PadEnd', () => {
  test.each([
    [['StringRepeat', { str: 'ab' }, 3], 'ababab'],
    [['StringRepeat', { str: 'ab' }, 0], ''],
    [['StringRepeat', { str: FLAG_FR }, 2], FLAG_FR + FLAG_FR],
    // A multi-character pad repeats and its final copy is truncated ON A
    // CHARACTER BOUNDARY, so `PadStart("a", 4, "xy")` is `"xyxa"`.
    [['PadStart', { str: 'a' }, 4, { str: 'xy' }], 'xyxa'],
    [['PadEnd', { str: 'a' }, 4, { str: 'xy' }], 'axyx'],
    // The default pad is one space.
    [['PadStart', { str: 'a' }, 4], '   a'],
    [['PadEnd', { str: 'a' }, 4], 'a   '],
    // Already long enough: returned unchanged.
    [['PadStart', { str: 'abcde' }, 3], 'abcde'],
    [['PadEnd', { str: 'abcde' }, 3], 'abcde'],
    // Padding counts CHARACTERS, so one flag fills one slot even though it is
    // four UTF-16 code units.
    [['PadStart', { str: 'a' }, 3, { str: FLAG_FR }], FLAG_FR + FLAG_FR + 'a'],
  ] as const)('%p is %p, and the compiled value agrees', (json, expected) => {
    const expr = ce.box(json as never);
    expect(expr.evaluate().string).toBe(expected);
    agreesWithInterpreter(expr);
  });

  test('a decomposed subject bound at run time is padded by character', () => {
    ce.declare('sv', 'string');
    // One cluster, so three pad characters are added — a code-unit count would
    // have added only two.
    agreesWithInterpreterAtRuntime(ce.box(['PadStart', 'sv', 4]), {
      sv: E_ACUTE_DECOMPOSED,
    });
    agreesWithInterpreterAtRuntime(ce.box(['StringRepeat', 'sv', 2]), {
      sv: E_ACUTE_DECOMPOSED,
    });
  });

  test.each([
    ['a negative repeat count', ['StringRepeat', { str: 'ab' }, -1]],
    ['a negative pad width', ['PadStart', { str: 'a' }, -1]],
    ['an empty pad', ['PadEnd', { str: 'a' }, 4, { str: '' }]],
  ] as const)('%s fails closed', (_label, json) => {
    const expr = ce.box(json as never);
    expect(expr.evaluate().operator).toBe('Error');
    failsClosed(expr);
  });

  test('a non-literal count, width or pad declines', () => {
    ce.declare('nv', 'integer');
    ce.declare('pv', 'string');
    failsClosed(ce.box(['StringRepeat', { str: 'ab' }, 'nv']));
    failsClosed(ce.box(['PadStart', { str: 'a' }, 'nv']));
    failsClosed(ce.box(['PadEnd', { str: 'a' }, 4, 'pv']));
  });
});

// ── Case operations and comparison ──────────────────────────────────────────

describe('D8: ToUpperCase / ToLowerCase / CaseFold', () => {
  test.each([
    [['ToUpperCase', { str: 'abc' }], 'ABC'],
    // Full case mapping can CHANGE the character count.
    [['ToUpperCase', { str: 'straße' }], 'STRASSE'],
    [['ToLowerCase', { str: 'ABC' }], 'abc'],
    // Lower-casing a final capital sigma yields the FINAL sigma U+03C2, not the
    // medial U+03C3 — the mapping is contextual.
    [['ToLowerCase', { str: 'ΟΔΟΣ' }], 'οδος'],
    // Case folding restores the medial sigma, which is what makes the two
    // spellings of "road" fold together.
    [['CaseFold', { str: 'ΟΔΟΣ' }], 'οδοσ'],
    [['CaseFold', { str: 'οδοσ' }], 'οδοσ'],
    [['CaseFold', { str: 'straße' }], 'strasse'],
    [['CaseFold', { str: 'STRASSE' }], 'strasse'],
    // A ZWJ family and a flag have no case, so they pass through unchanged.
    [['ToUpperCase', { str: ZWJ_FAMILY }], ZWJ_FAMILY],
    [['CaseFold', { str: FLAG_FR }], FLAG_FR],
    [['ToUpperCase', { str: E_ACUTE_PRECOMPOSED }], 'É'],
  ] as const)('%p is %p, and the compiled value agrees', (json, expected) => {
    const expr = ce.box(json as never);
    expect(expr.evaluate().string).toBe(expected);
    agreesWithInterpreter(expr);
  });

  test('a decomposed string bound at run time cases as one character', () => {
    ce.declare('sv', 'string');
    for (const op of ['ToUpperCase', 'ToLowerCase', 'CaseFold'])
      agreesWithInterpreterAtRuntime(ce.box([op, 'sv'] as never), {
        sv: E_ACUTE_DECOMPOSED,
      });
  });

  test('a scalar `character` operand fails closed', () => {
    // The signature is `(string) -> string`, and `character` is a disjoint
    // sibling of `string`, so the interpreter reports `incompatible-type`.
    failsClosed(ce.box(['CaseFold', ['CharacterFrom', { str: 'a' }]]));
  });
});

describe('D8: StringCompare', () => {
  test.each([
    [['StringCompare', { str: 'a' }, { str: 'b' }], -1],
    [['StringCompare', { str: 'a' }, { str: 'a' }], 0],
    [['StringCompare', { str: 'b' }, { str: 'a' }], 1],
    // A common prefix: the shorter string sorts first.
    [['StringCompare', { str: 'ab' }, { str: 'abc' }], -1],
    // The ORDER is by Unicode SCALAR, not UTF-16 code unit: U+10000 is above
    // U+E000, and the raw `<` operator (which compares the surrogate lead unit
    // 0xD800) would answer the opposite.
    [['StringCompare', { str: '\u{10000}' }, { str: '' }], 1],
  ] as const)('%p is %p, and the compiled value agrees', (json, expected) => {
    const expr = ce.box(json as never);
    expect(expr.evaluate().re).toBe(expected);
    agreesWithInterpreter(expr);
  });

  test('the result is exactly -1, 0 or 1', () => {
    for (const [a, b] of [
      ['a', 'b'],
      ['b', 'a'],
      ['a', 'a'],
      ['abc', 'abd'],
    ] as const) {
      const r = compile(ce.box(['StringCompare', { str: a }, { str: b }]), {
        fallback: false,
        constantFold: false,
      });
      expect([-1, 0, 1]).toContain(r.run!());
    }
  });

  test('a decomposed and a precomposed spelling compare EQUAL at run time', () => {
    ce.declare('sa', 'string');
    ce.declare('sb', 'string');
    const r = compile(ce.box(['StringCompare', 'sa', 'sb']), {
      fallback: false,
      constantFold: false,
    });
    // The interpreter compares the NFC scalar sequences of two boxed strings,
    // so the two spellings of `"é"` are the same string; `_SYS.cmpc` conditions
    // its operands to reach the same verdict.
    expect(
      (r.run as any)({ sa: E_ACUTE_DECOMPOSED, sb: E_ACUTE_PRECOMPOSED })
    ).toBe(0);
  });
});

// ── The promoted element-preserving operators ───────────────────────────────

describe('D8: RandomShuffle / RandomSample over a string source', () => {
  test('a shuffled string matches the interpreter under the same seed', () => {
    // Both draw `n − 1` indices from the frame's stream in the same order, so a
    // seeded frame replays bit-for-bit.
    const json = ['RandomShuffle', { str: 'abcdef' }];
    const r = compile(ce.box(json as never), {
      fallback: false,
      constantFold: false,
    });
    expect(r.success).toBe(true);
    const compiled = withRandomSeedFrame(ce, 42, () => r.run!());
    const interpreted = withRandomSeedFrame(
      ce,
      42,
      () => ce.box(json as never).evaluate().string
    );
    expect(compiled).toBe(interpreted);
    // …and the value is a permutation of the source's own characters.
    expect((compiled as string).split('').sort().join('')).toBe('abcdef');
  });

  test('a sampled string matches the interpreter under the same seed', () => {
    const json = ['RandomSample', { str: 'abcdef' }, 3];
    const r = compile(ce.box(json as never), {
      fallback: false,
      constantFold: false,
    });
    expect(r.success).toBe(true);
    const compiled = withRandomSeedFrame(ce, 7, () => r.run!());
    const interpreted = withRandomSeedFrame(
      ce,
      7,
      () => ce.box(json as never).evaluate().string
    );
    expect(compiled).toBe(interpreted);
    expect((compiled as string).length).toBe(3);
  });

  test('a shuffled ZWJ family stays whole', () => {
    // The source is segmented into characters before the permutation, so a
    // family is moved as one unit rather than split into surrogate halves.
    const json = ['RandomShuffle', { str: `ab${ZWJ_FAMILY}` }];
    const r = compile(ce.box(json as never), {
      fallback: false,
      constantFold: false,
    });
    const compiled = withRandomSeedFrame(ce, 3, () => r.run!()) as string;
    const interpreted = withRandomSeedFrame(
      ce,
      3,
      () => ce.box(json as never).evaluate().string
    );
    expect(compiled).toBe(interpreted);
    expect(compiled).toContain(ZWJ_FAMILY);
  });

  test('`DeleteAt` over a string still fails closed', () => {
    // `DeleteAt` has no list lowering on this target at all, so the string arm
    // has nothing to build on and the default decline applies (D8 item 8).
    const r = compile(ce.box(['DeleteAt', { str: 'abc' }, 2]), {
      constantFold: false,
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/no lowering for it/);
  });
});

// ── Python / GLSL / WGSL ────────────────────────────────────────────────────

const PHASE_2_OPERATORS: ReadonlyArray<readonly [string, unknown]> = [
  ['RangeOf', ['RangeOf', { str: 'abc' }, { str: 'b' }]],
  ['ContainsSequence', ['ContainsSequence', { str: 'abc' }, { str: 'b' }]],
  ['StartsWith', ['StartsWith', { str: 'abc' }, { str: 'a' }]],
  ['EndsWith', ['EndsWith', { str: 'abc' }, { str: 'c' }]],
  [
    'StringReplace',
    ['StringReplace', { str: 'abc' }, { str: 'b' }, { str: 'x' }],
  ],
  ['Trim', ['Trim', { str: ' a ' }]],
  ['TrimStart', ['TrimStart', { str: ' a ' }]],
  ['TrimEnd', ['TrimEnd', { str: ' a ' }]],
  ['StringRepeat', ['StringRepeat', { str: 'ab' }, 2]],
  ['PadStart', ['PadStart', { str: 'a' }, 3]],
  ['PadEnd', ['PadEnd', { str: 'a' }, 3]],
  ['ToUpperCase', ['ToUpperCase', { str: 'abc' }]],
  ['ToLowerCase', ['ToLowerCase', { str: 'ABC' }]],
  ['CaseFold', ['CaseFold', { str: 'ABC' }]],
  ['StringCompare', ['StringCompare', { str: 'a' }, { str: 'b' }]],
  ['NumberFrom', ['NumberFrom', { str: '12' }]],
  ['StringJoin', ['StringJoin', { str: 'abc' }, { str: '-' }]],
  ['Join', ['Join', { str: 'ab' }, { str: 'cd' }]],
];

describe('D8: every Phase-2 operator fails closed on the Python target', () => {
  // Python's string support is SCALAR only (equality, orderings, `IndexOf`);
  // none of the Phase-2 operators has a grapheme-aware Python lowering, so each
  // is refused — through the target-capability default, which names the target
  // in its diagnostic. Nothing about Python's existing scalar string support
  // changes.
  test.each(PHASE_2_OPERATORS)('%s declines', (_name, json) => {
    const r = compileTo(ce.box(json as never), 'python');
    expect(r.success).toBe(false);
    // Either the target-capability default ("target 'python' has no lowering
    // for it") or an operator-specific fail-closed gate the Python target
    // already carries — `Join` has one, naming the grapheme-segmentation
    // capability Python's stdlib lacks. Both are the D6 refusal.
    expect(r.error).toMatch(/target 'python'|Fail closed \(D6\)/);
  });

  test('Python keeps its SCALAR string support', () => {
    // The regression guard for the block above: gating the new operators must
    // not have closed anything that was compiling.
    const r = compileTo(
      ce.box(['Equal', { str: 'a' }, { str: 'a' }]),
      'python'
    );
    expect(r.success).toBe(true);
  });
});

describe('D8: GLSL and WGSL reject the Phase-2 operators', () => {
  // A shader has no string type at all, so every one of these is refused. The
  // explicit `ToUpperCase` cell is the named lock; the table covers the rest.
  test.each(['glsl', 'wgsl'] as const)(
    '`ToUpperCase` is rejected on the %s target',
    (to) => {
      const r = compileTo(ce.box(['ToUpperCase', { str: 'abc' }]), to);
      expect(r.success).toBe(false);
      expect(r.error).toMatch(new RegExp(`target '${to}'`));
    }
  );

  test.each(PHASE_2_OPERATORS)(
    '%s is rejected on glsl and wgsl',
    (_name, json) => {
      for (const to of ['glsl', 'wgsl'] as const)
        expect(compileTo(ce.box(json as never), to).success).toBe(false);
    }
  );
});

/**
 * The compile-target matrix for the Strings **Phase 2** operators —
 * `docs/STRING_ROADMAP.md`, decision D8.
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
 * The operands whose value decides between a result and an interpreter ERROR
 * VALUE (`RangeOf`'s `from` and needle, `StringReplace`'s `target` and `count`,
 * `StringRepeat`'s `n`, `PadStart`/`PadEnd`'s `n` and `pad`) have a third
 * outcome, added by the user ruling of 2026-08-16. A LITERAL is still decided
 * at compile time — valid compiles, invalid declines, since a known-bad call
 * should not compile. A COMPUTED operand now COMPILES, and the emitted code
 * checks the domain at run time and THROWS a `RangeError` naming the operator
 * and the rule. The interpreter returns an error VALUE, compiled code throws — a
 * visible failure, never a wrong value. This mirrors the `Slice` lowering,
 * whose non-literal span argument has always compiled and thrown at run time
 * on a span that is not an ascending index range. `throwsAtRuntime` asserts
 * that pair (compiled throw, interpreted error value) cell by cell.
 *
 * JavaScript is the only target with lowerings. GLSL declines every
 * Phase-2 operator, and does so through the DEFAULT: an operator the
 * engine knows but the target has no entry for is refused by the compiler
 * itself. The first describe block locks that default, because the whole
 * GLSL column of the matrix rests on it.
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
import type { Expression } from '../../src/compute-engine/global-types';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import {
  isCharacter,
  isString,
} from '../../src/compute-engine/boxed-expression/type-guards';

let ce: ComputeEngine;
beforeEach(() => {
  ce = new ComputeEngine();
});

// ── The D10 inputs ──────────────────────────────────────────────────────────

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * The interpreter's value, projected onto the JavaScript representation a
 * compiled function returns. Text first: a string is `isCollection === true`,
 * so the collection branch would compare a compiled `"ab"` against
 * `["a", "b"]`. `Nothing` projects to `undefined` — the absence marker an
 * OBJECT-domain access already takes on this target, and what `RangeOf` emits
 * for a needle it does not find.
 */
function project(v: Expression): unknown {
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
  expr: Expression,
  vars: Record<string, unknown> = {}
): void {
  const r = compile(expr, { fallback: false, constantFold: false });
  expect(r.success).toBe(true);
  expect((r.run as (v: Record<string, unknown>) => unknown)(vars)).toEqual(
    project(expr.evaluate())
  );
}

/** `expr` with each of `vars` substituted as the boxed value the interpreter
 * would see, so a compiled run and an interpreted one are given the same
 * operands. */
function substitute(
  expr: Expression,
  vars: Record<string, string | number>
): Expression {
  return expr.subs(
    Object.fromEntries(
      Object.entries(vars).map(([k, v]) => [
        k,
        typeof v === 'string' ? ce.string(v) : ce.number(v),
      ])
    ) as never
  );
}

/** Assert `expr` declines to compile — the engine reports `success: false` and
 * falls back to the interpreter, which answers correctly. */
function failsClosed(expr: Expression): void {
  expect(compile(expr, { constantFold: false }).success).toBe(false);
}

/** `expr` compiled for a non-JavaScript target. */
function compileTo(expr: Expression, to: 'glsl') {
  return compile(expr, { to, constantFold: false } as never);
}

// ── The default: an operator with no lowering entry declines ────────────────

describe('D8 lock: an operator with NO lowering entry declines on every target', () => {
  // The whole GLSL column of the Phase-2 matrix — and the
  // JavaScript `NumberFrom` cell — rests on this default. `NumberFrom` is the
  // witness: D8 leaves it fail-closed on purpose (its parse contract and its
  // exactness rules — an integer numeral is an exact integer, a fractional one
  // an exact Decimal — have no compiled equivalent), so it has no entry in ANY
  // target's function table and must be refused by the compiler itself.
  //
  // If this test ever fails, some target has grown a `NumberFrom` entry and the
  // fail-closed cells below stop being guaranteed by the default.
  test.each(['javascript', 'glsl'] as const)(
    '`NumberFrom` declines on the %s target',
    (to) => {
      const r = compile(ce.box(['NumberFrom', { str: '12' }]), {
        to,
        constantFold: false,
      } as never);
      expect(r.success).toBe(false);
      expect(r.diagnostic?.code).toBe('outside-profile');
      expect(r.error).toMatch(
        /the operator NumberFrom is not supported by the compiler/
      );
    }
  );

  test('the interpreter answers `NumberFrom` correctly (the fallback)', () => {
    expect(ce.box(['NumberFrom', { str: '1.5e3' }]).evaluate().re).toBe(1500);
  });
});

// ── StringJoin — the NARROWED signature ─────────────────────────────────────

describe('D2/D8: `StringJoin(xs, sep?)` joins ONE collection', () => {

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

  test('a union-typed subject declines on every member of the family', () => {
    // `string | list<number>` is a subtype of `indexed_collection`, so the list
    // lowering would accept it and walk UTF-16 code units at run time.
    ce.declare('mixv', 'string | list<number>');
    for (const op of ['ContainsSequence', 'StartsWith', 'EndsWith'])
      failsClosed(ce.box([op, 'mixv', { str: 'b' }] as never));
    failsClosed(ce.box(['RangeOf', 'mixv', { str: 'b' }]));
  });

  test('a COMPLEX-element subject or needle declines on every member', () => {
    // Nested lists now compile (see compile-structural-list-elements.test.ts).
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

});

describe('D8: Trim / TrimStart / TrimEnd', () => {

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
    ['a negative repeat count', ['StringRepeat', { str: 'ab' }, -1]],
    // Above the UPPER bound too: the interpreter reads `n` with
    // `asSmallInteger` (`library/core.ts`), which answers `null` — hence an
    // error value — for a magnitude above `SMALL_INTEGER` (1000000).
    ['an oversized repeat count', ['StringRepeat', { str: 'ab' }, 2_000_001]],
    ['an oversized pad width', ['PadStart', { str: 'a' }, 2_000_001]],
    [
      'an oversized replace count',
      ['StringReplace', { str: 'ab' }, { str: 'a' }, { str: 'x' }, 2_000_001],
    ],
    ['a negative pad width', ['PadStart', { str: 'a' }, -1]],
    ['an empty pad', ['PadEnd', { str: 'a' }, 4, { str: '' }]],
  ] as const)('%s fails closed', (_label, json) => {
    const expr = ce.box(json as never);
    expect(expr.evaluate().operator).toBe('Error');
    failsClosed(expr);
  });

  test('a COMPUTED operand the engine can PROVE out of domain declines', () => {
    // The compile-time/run-time split is about what is KNOWABLE, not about
    // literal spelling: a known-bad call should not compile, and `-(|m| + 1)`
    // is known negative for every integer `m` without ever being evaluated.
    ce.declare('m', 'integer');
    const negativeWidth = ce.box([
      'PadStart',
      { str: 'a' },
      ['Negate', ['Add', ['Abs', 'm'], 1]],
    ]);
    expect(negativeWidth.op2.isNonNegative).toBe(false);
    failsClosed(negativeWidth);

    // The `min >= 1` operands take the strict facet: a count of zero is out of
    // domain too, so the proof needed is `isPositive === false`, which `-|m|`
    // satisfies while `isNonNegative` stays undecided.
    const nonPositiveCount = ce.box([
      'StringReplace',
      { str: 'aaa' },
      { str: 'a' },
      { str: 'x' },
      ['Negate', ['Abs', 'm']],
    ]);
    expect(nonPositiveCount.ops![3].isPositive).toBe(false);
    failsClosed(nonPositiveCount);
  });

  test('a provably EMPTY pad declines even when it is not a literal', () => {
    // Same rule for the non-empty string operands: `ev` is not spelled as the
    // empty string literal, but it is assigned one, so the engine already
    // knows the call is the interpreter's error value.
    ce.assign('ev', ce.string(''));
    const emptyPad = ce.box(['PadEnd', { str: 'a' }, 4, 'ev']);
    expect(emptyPad.op3.isEmptyCollection).toBe(true);
    failsClosed(emptyPad);
  });
});

// ── Case operations and comparison ──────────────────────────────────────────

// ── The promoted element-preserving operators ───────────────────────────────

// ── A `string | character` operand at the collection operators ─────────────

describe('a `string | character` free variable reads as a string', () => {

  test('a `character` value at `Length` fails closed', () => {
    // A character is not a collection: the interpreter answers an
    // `incompatible-type` error, so the compiled `1` would be a wrong value.
    const expr = ce.box(['Length', ['CharacterFrom', { str: 'é' }]]);
    expect(expr.evaluate().operator).toBe('Error');
    failsClosed(expr);
  });

  test('a COMPUTED `string | character` value fails closed', () => {
    // The `If` gives a character when `b` is false. The interpreter then
    // answers an error, and a JS string cannot tell the two kinds apart.
    ce.declare('b', 'boolean');
    const u = ['If', 'b', { str: 'ab' }, ['CharacterFrom', { str: 'c' }]];
    failsClosed(ce.box(['Length', u] as never));
    failsClosed(ce.box(['At', u, 1] as never));
  });

  test('a LOCAL variable typed `string | character` fails closed', () => {
    ce.declare('b', 'boolean');
    failsClosed(
      ce.box([
        'Block',
        [
          'Assign',
          'c',
          ['If', 'b', { str: 'ab' }, ['CharacterFrom', { str: 'c' }]],
        ],
        ['Length', 'c'],
      ])
    );
  });

  test('a `string | list<number>` base at `At` fails closed', () => {
    // It used to compile to `_SYS.at` over the JS string, which answers no
    // value where the interpreter answers the character at the index.
    ce.declare('m', 'string | list<number>');
    const expr = ce.box(['At', 'm', 1]);
    expect(substitute(expr, { m: 'xy' }).evaluate().string).toBe('x');
    failsClosed(expr);
  });
});

// ── GLSL ────────────────────────────────────────────────────────────────────

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

describe('D8: GLSL rejects the Phase-2 operators', () => {
  // A shader has no string type at all, so every one of these is refused. The
  // explicit `ToUpperCase` cell is the named lock; the table covers the rest.
  test.each(['glsl'] as const)(
    '`ToUpperCase` is rejected on the %s target',
    (to) => {
      const r = compileTo(ce.box(['ToUpperCase', { str: 'abc' }]), to);
      expect(r.success).toBe(false);
      expect(r.diagnostic?.code).toBe('outside-profile');
      expect(r.error).toMatch(
        /the operator ToUpperCase is not supported by the compiler/
      );
    }
  );

  test.each(PHASE_2_OPERATORS)('%s is rejected on glsl', (_name, json) => {
    for (const to of ['glsl'] as const)
      expect(compileTo(ce.box(json as never), to).success).toBe(false);
  });
});

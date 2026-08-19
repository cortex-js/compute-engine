/**
 * The compile-target matrix for strings-as-collections and the `character`
 * type — `docs/STRING_ROADMAP.md`, decision D13.
 *
 * A string is an indexed collection of its GRAPHEME CLUSTERS (UAX #29). On the
 * JavaScript target it still lowers to a JS string, which is not array-shaped:
 * `.length` counts UTF-16 code units, `[i]` selects one, and `for … of` walks
 * code points. Every one of those disagrees with the interpreter on a
 * combining sequence, a ZWJ emoji family or a regional-indicator flag. So each
 * green cell below SEGMENTS first (`_SYS.chars`, the interpreter's own
 * `Intl.Segmenter` decomposition) and then runs the existing list lowering; a
 * string-PRESERVING operator joins the clusters back with `.join("")`.
 *
 * Every green cell is asserted twice: it compiles (`success: true`), and its
 * compiled value equals the INTERPRETER's value on the same input — so a
 * divergence shows up as a test failure rather than as a silent wrong answer
 * behind `success: true`. Each fail-closed cell asserts `success: false`.
 *
 * Test inputs are the D15 set: ASCII, the precomposed and decomposed spellings
 * of `"é"`, one ZWJ emoji family and one regional-indicator flag. Each
 * non-ASCII expectation carries a comment naming the Unicode behaviour it
 * assumes.
 *
 * Note on `constantFold: false` everywhere: with folding ON, a literal-only
 * expression is evaluated at COMPILE time and `success: true` would prove
 * nothing about the lowering. The suite also exercises the runtime path — a
 * `string`-typed free symbol supplied to `run()` — where no folding is
 * possible at all.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { BoxedExpression } from '../../src/compute-engine/global-types';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import {
  isCharacter,
  isString,
} from '../../src/compute-engine/boxed-expression/type-guards';

let ce: ComputeEngine;
beforeEach(() => {
  ce = new ComputeEngine();
});

// ── The D15 inputs ──────────────────────────────────────────────────────────

/** U+00E9: one code point, one grapheme cluster. */
const E_ACUTE_PRECOMPOSED = 'é';
/** `"e"` + U+0301 COMBINING ACUTE ACCENT: two code points, one cluster. The
 * engine NFC-normalizes at boxing, so this is stored precomposed. */
const E_ACUTE_DECOMPOSED = 'é';
/** MAN + ZWJ + WOMAN + ZWJ + BOY: five code points (seven UTF-16 units), one
 * grapheme cluster. */
const ZWJ_FAMILY = '\u{1F468}‍\u{1F469}‍\u{1F466}';
/** REGIONAL INDICATOR F + R: two code points (four UTF-16 units), one cluster. */
const FLAG_FR = '\u{1F1EB}\u{1F1F7}';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** `CharacterFrom("x")` — canonicalizes to the character value itself (D7). */
function char(s: string): BoxedExpression {
  return ce.box(['CharacterFrom', { str: s }]);
}

/**
 * The interpreter's value, projected onto the JavaScript representation a
 * compiled function returns, so the two can be compared with `toEqual`.
 *
 * The string/character branch runs BEFORE the collection branch: a string is
 * now `isCollection === true`, and projecting it element-wise would compare a
 * compiled `"ab"` against `["a", "b"]` and report a failure where the two
 * agree. `Nothing`/`Missing` project to `undefined`, which is what the emitted
 * out-of-band access yields for a non-numeric element domain.
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
 * interpreter's value. `vars` supplies the free symbols (empty for a
 * literal-only expression).
 *
 * `fallback: false` makes a decline THROW rather than silently interpret, so a
 * cell that stops compiling fails the test loudly with its own diagnostic.
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

/** Assert `expr` declines to compile — the engine reports `success: false` and
 * falls back to the interpreter, which answers correctly. */
function failsClosed(expr: BoxedExpression): void {
  expect(compile(expr, { constantFold: false }).success).toBe(false);
}

/** The emitted JavaScript source for `expr`. */
function code(expr: BoxedExpression): string {
  return compile(expr, { fallback: false, constantFold: false }).code;
}

// ── Length ──────────────────────────────────────────────────────────────────

describe('D13: `Length(s)` is the grapheme-cluster count', () => {
  test.each([
    ['shop', 4],
    // One code point, one cluster.
    [E_ACUTE_PRECOMPOSED, 1],
    // Two code points that NFC-compose to one; one cluster either way.
    [E_ACUTE_DECOMPOSED, 1],
    // Five code points / seven UTF-16 units joined by ZWJ: ONE user-perceived
    // character, so `.length` (7) would be wrong by six.
    [ZWJ_FAMILY, 1],
    // A regional-indicator PAIR is one flag: two code points, four UTF-16
    // units, one cluster.
    [FLAG_FR, 1],
    // Mixed: `a` + flag + `b`.
    [`a${FLAG_FR}b`, 3],
  ])('Length(%p) is %p and matches the interpreter', (s, n) => {
    const expr = ce.box(['Length', { str: s }]);
    expect(expr.evaluate().re).toBe(n);
    agreesWithInterpreter(expr);
  });

  test('the emitted code segments — it never reads `.length` off the string', () => {
    ce.declare('sv', 'string');
    const emitted = code(ce.box(['Length', 'sv']));
    expect(emitted).toContain('_SYS.chars');
    // `.length` appears, but on the CLUSTER ARRAY the segmenter returned, never
    // on the string itself: the string operand is inside the `_SYS.chars(…)`
    // call, so no `sv.length` can occur.
    expect(emitted).not.toMatch(/sv\s*\.\s*length/);
  });

  test('a `string`-typed free symbol segments at RUN time', () => {
    ce.declare('sv', 'string');
    const r = compile(ce.box(['Length', 'sv']), {
      fallback: false,
      constantFold: false,
    });
    expect(r.success).toBe(true);
    const run = r.run as (v: Record<string, unknown>) => unknown;
    // `a` + family + `b`: three clusters, nine UTF-16 code units.
    expect(run({ sv: `a${ZWJ_FAMILY}b` })).toBe(3);
    expect(run({ sv: 'shop' })).toBe(4);
  });
});

// ── At / s[i] ───────────────────────────────────────────────────────────────

describe('D13: `At(s, i)` indexes by grapheme cluster', () => {
  test.each([
    [2, 'b'],
    [1, 'a'],
    // Negative indices count from the end, exactly as `At` on a list does
    // (`BoxedString.at`: `count + index + 1`).
    [-1, 'c'],
    [-3, 'a'],
  ])('At("abc", %p) is %p', (i, expected) => {
    const expr = ce.box(['At', { str: 'abc' }, i]);
    expect(project(expr.evaluate())).toBe(expected);
    agreesWithInterpreter(expr);
  });

  test.each([[0], [4], [-4]])(
    'At("abc", %p) is out of range and projects to the interpreter’s absence',
    (i) => {
      const expr = ce.box(['At', { str: 'abc' }, i]);
      // The interpreter yields `Missing`; a non-numeric element domain projects
      // absence onto the target null (`undefined`), not NaN.
      expect(project(expr.evaluate())).toBeUndefined();
      agreesWithInterpreter(expr);
    }
  );

  test('a whole ZWJ family is one index position', () => {
    // `a` + family + `b`: position 2 is the WHOLE family, not a lone surrogate
    // — which is what `"a👨‍👩‍👦b"[1]` would have produced.
    const expr = ce.box(['At', { str: `a${ZWJ_FAMILY}b` }, 2]);
    expect(project(expr.evaluate())).toBe(ZWJ_FAMILY);
    agreesWithInterpreter(expr);
  });

  test('a `string`-typed free symbol indexes at RUN time', () => {
    ce.declare('sv', 'string');
    const r = compile(ce.box(['At', 'sv', 2]), {
      fallback: false,
      constantFold: false,
    });
    expect(r.success).toBe(true);
    expect(
      (r.run as (v: Record<string, unknown>) => unknown)({
        sv: `a${ZWJ_FAMILY}b`,
      })
    ).toBe(ZWJ_FAMILY);
  });
});

// ── Iteration-derived and list-out operators ────────────────────────────────

describe('D13: iteration-derived operators over a string source', () => {
  const S = { str: 'abc' };
  const isB = [
    'Function',
    ['Equal', '_', ['CharacterFrom', { str: 'b' }]],
    '_',
  ];
  const notC = [
    'Function',
    ['NotEqual', '_', ['CharacterFrom', { str: 'c' }]],
    '_',
  ];

  test.each([
    ['Characters', ['Characters', S]],
    ['GraphemeClusters', ['GraphemeClusters', S]],
    ['Map', ['Map', isB, S]],
    ['Any', ['Any', S, isB]],
    ['All', ['All', S, isB]],
    ['Count', ['Count', S]],
    ['CountIf', ['CountIf', S, isB]],
    ['IsEmpty', ['IsEmpty', S]],
    ['Contains', ['Contains', S, { str: 'b' }]],
    ['IndexOf', ['IndexOf', S, { str: 'b' }]],
    ['IndexWhere', ['IndexWhere', S, isB]],
    ['Find', ['Find', S, isB]],
    ['Position', ['Position', S, isB]],
    ['First', ['First', S]],
    ['Last', ['Last', S]],
    // A CUSTOM combiner folds over the characters; the builtin arithmetic
    // folds do not (see the fail-closed section).
    ['Reduce', ['Reduce', S, ['Function', ['Add', 'acc', 1], 'acc', 'c'], 0]],
    ['StringJoin(Characters)', ['StringJoin', ['Characters', S]]],
  ] as const)('%s over "abc" agrees with the interpreter', (_name, src) => {
    agreesWithInterpreter(ce.box(src as never));
  });

  test('`Characters` yields whole clusters, not code points', () => {
    // Three clusters: `a`, the family, `b` — nine UTF-16 code units in all.
    const expr = ce.box(['Characters', { str: `a${ZWJ_FAMILY}b` }]);
    expect(project(expr.evaluate())).toEqual(['a', ZWJ_FAMILY, 'b']);
    agreesWithInterpreter(expr);
  });

  test('the decomposed and precomposed spellings segment identically', () => {
    // The engine NFC-normalizes at boxing, and `_SYS.chars` normalizes each
    // cluster, so both spellings answer the single precomposed U+00E9.
    for (const s of [E_ACUTE_PRECOMPOSED, E_ACUTE_DECOMPOSED]) {
      const expr = ce.box(['Characters', { str: s }]);
      expect(project(expr.evaluate())).toEqual([E_ACUTE_PRECOMPOSED]);
      agreesWithInterpreter(expr);
    }
  });

  test('`for c in s` iterates clusters in a compiled body', () => {
    // A `Comprehension` lowers to `for (const c of …)`, which over a bare JS
    // string would walk CODE POINTS — five iterations for the family alone.
    const expr = ce.box([
      'Comprehension',
      ['Equal', 'c', ['CharacterFrom', { str: 'a' }]],
      ['Element', 'c', { str: `a${ZWJ_FAMILY}` }],
    ]);
    expect(project(expr.evaluate())).toEqual([true, false]);
    agreesWithInterpreter(expr);
  });

  test('a runtime string is iterated by cluster too', () => {
    ce.declare('sv', 'string');
    const r = compile(
      ce.box([
        'Comprehension',
        ['Equal', 'c', ['CharacterFrom', { str: 'a' }]],
        ['Element', 'c', 'sv'],
      ]),
      { fallback: false, constantFold: false }
    );
    expect(r.success).toBe(true);
    expect(
      (r.run as (v: Record<string, unknown>) => unknown)({
        sv: `a${FLAG_FR}`,
      })
    ).toEqual([true, false]);
  });
});

// ── String-preserving operators ─────────────────────────────────────────────

describe('D13: string-preserving operators segment, operate, and re-join', () => {
  const S = { str: 'abc' };
  const notC = [
    'Function',
    ['NotEqual', '_', ['CharacterFrom', { str: 'c' }]],
    '_',
  ];
  const notB = [
    'Function',
    ['NotEqual', '_', ['CharacterFrom', { str: 'b' }]],
    '_',
  ];

  test.each([
    ['Reverse', ['Reverse', S]],
    ['Take', ['Take', S, 2]],
    ['Drop', ['Drop', S, 1]],
    ['Rest', ['Rest', S]],
    ['Most', ['Most', S]],
    ['Slice', ['Slice', S, 1, 2]],
    ['Slice (range)', ['Slice', S, ['Range', 1, 2]]],
    ['Unique', ['Unique', { str: 'aabbc' }]],
    ['Sort', ['Sort', { str: 'cba' }]],
    ['RotateLeft', ['RotateLeft', S, 1]],
    ['RotateRight', ['RotateRight', S, 1]],
    ['Filter', ['Filter', S, notB]],
    ['TakeWhile', ['TakeWhile', S, notC]],
    ['DropWhile', ['DropWhile', S, notC]],
  ] as const)('%s over a string agrees with the interpreter', (_name, src) => {
    agreesWithInterpreter(ce.box(src as never));
  });

  test('a preserved result is a STRING, not an array of clusters', () => {
    // The `.join("")` is what distinguishes these from the list-out row: the
    // compiled value must be the JS string `"cba"`, never `["c","b","a"]`.
    const r = compile(ce.box(['Reverse', { str: 'abc' }]), {
      fallback: false,
      constantFold: false,
    });
    expect((r.run as () => unknown)()).toBe('cba');
  });

  test('`Reverse` reverses whole clusters, not code units', () => {
    // Reversing `"a🇫🇷"` by UTF-16 units would split the regional-indicator
    // pair and produce mojibake; by cluster it yields the flag then `a`.
    const expr = ce.box(['Reverse', { str: `a${FLAG_FR}` }]);
    expect(project(expr.evaluate())).toBe(`${FLAG_FR}a`);
    agreesWithInterpreter(expr);
  });

  test('re-segmentation caveat: a reversed decomposed "é" stays one string', () => {
    // The engine stores the decomposed spelling NFC-composed, so there is a
    // single cluster to reverse and the round trip is the identity. The point
    // being pinned is the CONTRACT — string in, string out — not a cluster
    // count, which re-segmentation may legitimately change.
    const expr = ce.box(['Reverse', { str: E_ACUTE_DECOMPOSED }]);
    expect(typeof project(expr.evaluate())).toBe('string');
    agreesWithInterpreter(expr);
  });

  test('`Sort` orders characters by code point, not numerically', () => {
    // The list lowering's comparator is `(_a, _b) => _a - _b`, which is NaN for
    // every pair of one-cluster strings and would leave the source order
    // untouched. A string source uses `_SYS.cmpc` instead.
    const expr = ce.box(['Sort', { str: 'cba' }]);
    expect(project(expr.evaluate())).toBe('abc');
    agreesWithInterpreter(expr);
    expect(code(expr)).toContain('_SYS.cmpc');
  });

  test('a runtime string is preserved too', () => {
    ce.declare('sv', 'string');
    const r = compile(ce.box(['Reverse', 'sv']), {
      fallback: false,
      constantFold: false,
    });
    expect(r.success).toBe(true);
    expect(
      (r.run as (v: Record<string, unknown>) => unknown)({
        sv: `a${ZWJ_FAMILY}b`,
      })
    ).toBe(`b${ZWJ_FAMILY}a`);
  });
});

// ── Ingress conditioning of a run()-supplied string ─────────────────────────

describe('a run()-supplied string is conditioned exactly as at ingress', () => {
  /** U+FFFD REPLACEMENT CHARACTER — what `BoxedString` puts in place of a
   * lone surrogate (`String.prototype.toWellFormed`). */
  const REPLACEMENT = '�';
  /** An unpaired high surrogate: a `string` value the host can hold and the
   * engine never can. */
  const LONE_SURROGATE = '\ud800';

  test('a lone surrogate becomes U+FFFD, so Length is 1 and the character is it', () => {
    // The interpreter conditions at INGRESS — NFC, then the lone-surrogate
    // replacement — so it never holds an ill-formed string. A raw host string
    // bound to a compiled parameter enters below that boxing step, so the
    // compiled segmentation has to apply the same two steps or it would report
    // the surrogate itself where the interpreter reports U+FFFD.
    expect(ce.string(LONE_SURROGATE).string).toBe(REPLACEMENT);

    ce.declare('sv', 'string');
    const opts = { fallback: false, constantFold: false } as const;
    const len = compile(ce.box(['Length', 'sv']), opts);
    const at = compile(ce.box(['At', 'sv', 1]), opts);
    const chars = compile(ce.box(['Characters', 'sv']), opts);
    const run = (r: { run?: unknown }): unknown =>
      (r.run as (v: Record<string, unknown>) => unknown)({
        sv: LONE_SURROGATE,
      });

    expect(run(len)).toBe(1);
    expect(run(at)).toBe(REPLACEMENT);
    expect(run(chars)).toEqual([REPLACEMENT]);

    // …which is the interpreter's own answer on the same input.
    const s = ce.string(LONE_SURROGATE);
    expect(ce.box(['Length', s]).evaluate().re).toBe(1);
    expect(project(ce.box(['At', s, 1]).evaluate())).toBe(REPLACEMENT);
  });

  test('`Contains` finds a DECOMPOSED needle supplied at run time', () => {
    // The haystack holds the PRECOMPOSED spelling (the engine NFC-normalizes
    // at boxing); the needle arrives raw and decomposed. A SameValueZero
    // `includes` compares the two code-unit sequences and misses, where the
    // interpreter — which conditioned both — answers True.
    const haystack = ['List', { str: E_ACUTE_PRECOMPOSED }, { str: 'a' }];
    expect(
      ce
        .box(['Contains', haystack, { str: E_ACUTE_DECOMPOSED }] as never)
        .evaluate().symbol
    ).toBe('True');

    ce.declare('needle', 'string');
    const r = compile(ce.box(['Contains', haystack, 'needle'] as never), {
      fallback: false,
      constantFold: false,
    });
    expect(r.success).toBe(true);
    expect(r.code).toContain('_SYS.eqt');
    expect(
      (r.run as (v: Record<string, unknown>) => unknown)({
        needle: E_ACUTE_DECOMPOSED,
      })
    ).toBe(true);
  });

  test('`Unique` collapses the two spellings supplied at run time', () => {
    // The interpreter's answer first: both spellings box to the precomposed
    // U+00E9, so they are ONE element.
    expect(
      project(
        ce
          .box([
            'Unique',
            [
              'List',
              { str: E_ACUTE_DECOMPOSED },
              { str: E_ACUTE_PRECOMPOSED },
              { str: 'a' },
            ],
          ] as never)
          .evaluate()
      )
    ).toEqual([E_ACUTE_PRECOMPOSED, 'a']);

    // A raw `Set` keys the two spellings apart, so the compiled answer had one
    // element too many.
    ce.declare('xs', 'list<string>');
    const r = compile(ce.box(['Unique', 'xs']), {
      fallback: false,
      constantFold: false,
    });
    expect(r.success).toBe(true);
    expect(
      (r.run as (v: Record<string, unknown>) => unknown)({
        xs: [E_ACUTE_DECOMPOSED, E_ACUTE_PRECOMPOSED, 'a'],
      })
    ).toEqual([E_ACUTE_PRECOMPOSED, 'a']);
  });

  test('a numeric `Unique`/`Contains` keeps its original lowering', () => {
    // The text conditioning is gated on text ELEMENTS: a numeric collection
    // must still emit the bare `Set` and `includes`, NaN semantics included.
    const u = compile(ce.box(['Unique', ['List', 1, 1, 2]]), {
      fallback: false,
      constantFold: false,
    });
    expect(u.code).toContain('new Set');
    expect(u.code).not.toContain('_SYS.uniqt');
    const c = compile(ce.box(['Contains', ['List', 1, 2], 2]), {
      fallback: false,
      constantFold: false,
    });
    expect(c.code).toContain('.includes(');
    expect(c.code).not.toContain('_SYS.eqt');
  });
});

// ── The `character` scalar row ──────────────────────────────────────────────

describe('D13: the `character` scalar row', () => {
  test('a `CharacterFrom` literal lowers to the one-cluster JS string', () => {
    for (const s of [
      'x',
      E_ACUTE_PRECOMPOSED,
      E_ACUTE_DECOMPOSED,
      ZWJ_FAMILY,
      FLAG_FR,
    ])
      agreesWithInterpreter(char(s));
  });

  test('a one-cluster string literal NARROWED at a `character` parameter compiles', () => {
    ce.declare('fc', '(character) -> character');
    ce.assign('fc', ce.parse('c \\mapsto c'));
    // Narrowing (D6) replaces the literal with a character before codegen, so
    // the compiled value is the same one-cluster string — including for a
    // multi-code-point cluster.
    for (const s of ['a', ZWJ_FAMILY, FLAG_FR])
      agreesWithInterpreter(ce.function('fc', [ce.string(s)]));
  });

  test('`String(c)` is the character’s string — the round-trip law', () => {
    agreesWithInterpreter(ce.box(['String', char('a')]));
    agreesWithInterpreter(ce.box(['String', char(ZWJ_FAMILY)]));
    // Concatenation of text operands compiles too.
    agreesWithInterpreter(ce.box(['String', char('a'), char('b')]));
    agreesWithInterpreter(ce.box(['String', { str: 'a' }, char('b')]));
  });

  test('`==` / `!=` on characters lower to exact content equality', () => {
    // Before the character admission these fell through to the NUMERIC
    // tolerance lowering — `Math.abs("a" - "a") <= tol` is `NaN <= tol` — so
    // an equality between two IDENTICAL characters compiled to `false`.
    agreesWithInterpreter(ce.box(['Equal', char('a'), char('a')]));
    agreesWithInterpreter(ce.box(['Equal', char('a'), char('b')]));
    agreesWithInterpreter(ce.box(['NotEqual', char('a'), char('a')]));
    agreesWithInterpreter(ce.box(['NotEqual', char('a'), char('b')]));
    // The character/one-cluster-string bridge (D5) compiles as well.
    agreesWithInterpreter(ce.box(['Equal', char('a'), { str: 'a' }]));
    // `_SYS.eqt` is content equality with no tolerance: a text pair compares
    // after the interpreter's ingress conditioning (NFC, well-formed), and
    // every other pair falls back to strict `===`.
    expect(code(ce.box(['Equal', char('a'), char('a')]))).toContain('_SYS.eqt');
  });

  test('equality is faithful for a multi-code-point cluster', () => {
    for (const s of [ZWJ_FAMILY, FLAG_FR, E_ACUTE_DECOMPOSED]) {
      agreesWithInterpreter(ce.box(['Equal', char(s), char(s)]));
      agreesWithInterpreter(ce.box(['NotEqual', char(s), char('a')]));
    }
  });

  test('a raw non-NFC host string at a `character` parameter compares as NFC', () => {
    // The interpreter conditions every character at BOXING time — NFC, then the
    // lone-surrogate replacement — so it reads the decomposed `"e" + U+0301`
    // and the precomposed `"é"` as the SAME character. A compiled function
    // takes its parameter from the host, which can hand it either spelling, so
    // the emitted comparison has to condition it the same way. `_SYS.cmpc`
    // does, and both the orderings and the equality now route through it.
    ce.declare('cv', 'character');
    const lit = char(E_ACUTE_PRECOMPOSED);
    // The interpreter's answers, with the decomposed spelling boxed as `cv`.
    const interp = new ComputeEngine();
    interp.declare('cv', 'character');
    interp.assign(
      'cv',
      interp.box(['CharacterFrom', { str: E_ACUTE_DECOMPOSED }])
    );
    for (const [kind, expected] of [
      ['Equal', true],
      ['NotEqual', false],
      ['Less', false],
      ['LessEqual', true],
      ['Greater', false],
      ['GreaterEqual', true],
    ] as Array<[string, boolean]>) {
      expect(
        interp
          .box([
            kind,
            'cv',
            ['CharacterFrom', { str: E_ACUTE_PRECOMPOSED }],
          ] as never)
          .evaluate().symbol
      ).toBe(expected ? 'True' : 'False');
      const r = compile(ce.box([kind, 'cv', lit] as never), {
        fallback: false,
        constantFold: false,
      });
      expect(r.success).toBe(true);
      expect((r.run as any)({ cv: E_ACUTE_DECOMPOSED })).toBe(expected);
      // The precomposed spelling was never in doubt; it must not have moved.
      expect((r.run as any)({ cv: E_ACUTE_PRECOMPOSED })).toBe(expected);
    }
  });

  test('`StringJoin` refuses a SCALAR character subject, and joins a character COLLECTION', () => {
    // Phase 2 narrowed `StringJoin` to `(collection<string | character>,
    // separator: string?)` and removed the variadic concatenation form
    // (`docs/STRING_ROADMAP.md`, decision D2).
    // A scalar `character` is ONE element, not a collection of them, so it is
    // now an `incompatible-type` error against the first parameter — and the
    // compiler refuses the resulting `Error` node.
    failsClosed(ce.box(['StringJoin', char('a')]));
    failsClosed(ce.box(['StringJoin', char('a'), { str: 'b' }]));
    // What DOES compile is a collection of characters, with or without a
    // separator. A multi-code-point cluster joins as its whole cluster.
    agreesWithInterpreter(
      ce.box(['StringJoin', ['List', char('a'), char('b')]])
    );
    agreesWithInterpreter(
      ce.box([
        'StringJoin',
        ['List', char(ZWJ_FAMILY), char(FLAG_FR)],
        { str: '-' },
      ])
    );
  });

  test('orderings use a CODE-POINT comparator, not `<` on JS strings', () => {
    for (const kind of ['Less', 'LessEqual', 'Greater', 'GreaterEqual'])
      for (const [a, b] of [
        ['a', 'b'],
        ['b', 'a'],
        ['a', 'a'],
      ])
        agreesWithInterpreter(ce.box([kind, char(a), char(b)] as never));
    expect(code(ce.box(['Less', char('a'), char('b')]))).toContain('_SYS.cmpc');
  });

  test('an ASTRAL character sorts ABOVE U+E000–U+FFFF', () => {
    // U+10000 is encoded as the surrogate pair D800 DC00, whose LEAD unit
    // (0xD800) is below U+E000 — so `"\u{10000}" < ""` is `true` under
    // the raw JS `<` and `False` in the interpreter, which compares code-point
    // sequences. This is the pair the comparator exists for.
    const astral = char('\u{10000}');
    const bmp = char('');
    expect(ce.box(['Less', astral, bmp]).evaluate().symbol).toBe('False');
    agreesWithInterpreter(ce.box(['Less', astral, bmp]));
    agreesWithInterpreter(ce.box(['Less', bmp, astral]));
    agreesWithInterpreter(ce.box(['Greater', astral, bmp]));
  });

  test('a `list<character>` is an array of one-cluster strings', () => {
    agreesWithInterpreter(ce.box(['List', char('a'), char('b')]));
    agreesWithInterpreter(ce.box(['List', char(ZWJ_FAMILY), char(FLAG_FR)]));
  });
});

// ── Fail-closed cells ───────────────────────────────────────────────────────

describe('D13: the JavaScript fail-closed cells', () => {
  const S = { str: 'abc' };

  test('`CharacterFrom` of a NON-literal declines', () => {
    // A runtime cluster-count check is not in v1: the canonical handler keeps
    // the call, and there is no lowering for it.
    failsClosed(ce.box(['CharacterFrom', ['String', char('a')]]));
    ce.declare('sv', 'string');
    failsClosed(ce.box(['CharacterFrom', 'sv']));
  });

  test('a MULTI-cluster literal at a `character` parameter is a type error', () => {
    ce.declare('fc', '(character) -> character');
    ce.assign('fc', ce.parse('c \\mapsto c'));
    const call = ce.function('fc', [ce.string('ab')]);
    expect(call.isValid).toBe(false);
    expect(compile(call, { constantFold: false }).success).toBe(false);
  });

  test('an arithmetic `Reduce` fold over a string declines', () => {
    // The interpreter answers an `incompatible-type` error; the emitted
    // `(_a, _b) => _a + _b` over one-cluster strings would CONCATENATE and run
    // to `"abc"` behind `success: true`.
    expect(ce.box(['Reduce', S, 'Add']).evaluate().toString()).toContain(
      'incompatible-type'
    );
    failsClosed(ce.box(['Reduce', S, 'Add']));
    failsClosed(ce.box(['Reduce', S, 'Multiply']));
  });

  test('`Sum` / `Product` over a string declines', () => {
    for (const head of ['Sum', 'Product'])
      failsClosed(ce.box([head, S] as never));
  });

  test('an ordering that MIXES a character with anything else declines', () => {
    failsClosed(ce.box(['Less', char('a'), 1]));
    // A character vs a one-cluster STRING does compare in the interpreter (the
    // D5 bridge), but admitting it is a separate widening; it stays closed.
    failsClosed(ce.box(['Less', char('a'), { str: 'b' }]));
  });

  test('a CHAINED character ordering declines', () => {
    // The chained form would need the evaluate-each-operand-once temporaries
    // the infix chain path binds; only the binary form compiles.
    failsClosed(ce.box(['Less', char('a'), char('b'), char('c')]));
  });

  test('`String` of a non-text operand declines', () => {
    // Rendering a number reproduces the engine's number-formatting options.
    failsClosed(ce.box(['String', 5]));
    // The single-collection JOIN carve-out evaluates to the string, but its
    // declared result type is still `list<character>`, so it stays closed.
    failsClosed(ce.box(['String', ['Characters', S]]));
  });

  test('the linear-algebra operators keep refusing a string source', () => {
    // A string is a rank-0 LEAF for these (spec constraint 5 / D12), not a
    // vector of characters — segmenting it would be a semantic lie.
    for (const src of [
      ['Transpose', S],
      ['Flatten', S],
      ['Reshape', S, ['Tuple', 1, 3]],
    ])
      failsClosed(ce.box(src as never));
  });

  test('`Zip` and `Join` keep refusing a string operand', () => {
    failsClosed(ce.box(['Zip', S, ['List', 1, 2, 3]]));
    failsClosed(ce.box(['Join', S, ['List', 1]]));
  });

  test('a custom `Sort` comparator over a string declines', () => {
    failsClosed(ce.box(['Sort', S, ['Function', 'True', '_']]));
  });

  test('a union with a text arm declines on the list lowerings', () => {
    // `string | list<number>` is not PROVABLY a string, so nothing segments it
    // — and it IS a subtype of `indexed_collection` (a string is one), so the
    // list lowerings used to admit it and run `.slice()`, `.reverse()` and
    // `.length` over the JS string it may hold at run time, i.e. over UTF-16
    // code units, behind a reported `success: true`.
    ce.declare('u', 'string | list<number>');
    for (const src of [
      ['Take', 'u', 2],
      ['Reverse', 'u'],
      ['Length', 'u'],
      ['Drop', 'u', 1],
      ['Unique', 'u'],
    ])
      failsClosed(ce.box(src as never));
  });

  test('…and a union with NO text arm still compiles', () => {
    // The gate is about TEXT, not about unions: every arm here lowers to a JS
    // array, so the list lowerings stay admitted byte-for-byte.
    ce.declare('w', 'list<number> | list<string>');
    for (const src of [
      ['Take', 'w', 2],
      ['Reverse', 'w'],
      ['Length', 'w'],
    ])
      expect(
        compile(ce.box(src as never), { constantFold: false }).success
      ).toBe(true);
  });
});

// ── GLSL / WGSL ─────────────────────────────────────────────────────────────

describe('D13: GLSL and WGSL reject strings and characters, as before', () => {
  // The shader targets have no text at all — no string type, no grapheme
  // segmentation, no dynamic arrays. The lattice change (a string became an
  // indexed collection, and `character` a new scalar) must not have moved any
  // of these from "rejected" to "compiles": these pin the existing
  // diagnostics, each of which names a shader-target limitation rather than
  // anything about the string lattice.
  const S = { str: 'abc' };

  test.each(['glsl', 'wgsl'] as const)(
    '%s rejects every string-collection operation',
    (to) => {
      for (const src of [
        ['Length', S],
        ['At', S, 2],
        ['Map', ['Function', 'c', 'c'], S],
        ['Reverse', S],
        ['Characters', S],
        ['Comprehension', ['Equal', 'c', { str: 'a' }], ['Element', 'c', S]],
      ])
        expect(
          compile(ce.box(src as never), { to, constantFold: false }).success
        ).toBe(false);
    }
  );

  test.each(['glsl', 'wgsl'] as const)(
    '%s rejects a text-typed symbol reached only through a user-function BODY',
    (to) => {
      // The text-symbol gate collects names once per compiled ROOT, but a
      // user-defined function's body is compiled against that same root target
      // while being nowhere inside the root expression. `g` below referenced
      // two `string`-typed globals and emitted
      // `float _fn_g(float x) { return ((sv < tv) ? (x) : (0.0)); }` — a float
      // comparison where the interpreter compares text, behind
      // `success: true`.
      ce.declare('sv', 'string');
      ce.declare('tv', 'string');
      ce.assign(
        'g',
        ce.box(['Function', ['If', ['Less', 'sv', 'tv'], 'x', 0], 'x'])
      );
      const r = compile(ce.box(['g', 'u']), { to, constantFold: false });
      expect(r.success).toBe(false);
      expect(r.error ?? '').toMatch(/text-typed, which is not supported/);
    }
  );

  test.each(['glsl', 'wgsl'] as const)(
    '%s rejects a string-typed free symbol in the same shapes',
    (to) => {
      ce.declare('sv', 'string');
      for (const src of [
        ['Length', 'sv'],
        ['At', 'sv', 2],
        ['Reverse', 'sv'],
      ])
        expect(
          compile(ce.box(src as never), { to, constantFold: false }).success
        ).toBe(false);
    }
  );

  test.each(['glsl', 'wgsl'] as const)(
    '%s rejects a character operand',
    (to) => {
      for (const src of [
        ['CharacterFrom', { str: 'a' }],
        ['Equal', char('a'), char('a')],
        ['Less', char('a'), char('b')],
        ['List', char('a'), char('b')],
        ['Add', char('a'), 1],
      ])
        expect(
          compile(ce.box(src as never), { to, constantFold: false }).success
        ).toBe(false);
    }
  );

  test.each(['glsl', 'wgsl'] as const)(
    '%s rejects a bare string literal',
    (to) => {
      // Before this gate the target's `string` hook emitted
      // `JSON.stringify(str)`, so a bare string literal compiled to `"a"` —
      // source no shader driver accepts, behind `success: true`.
      const r = compile(ce.box({ str: 'a' }), { to, constantFold: false });
      expect(r.success).toBe(false);
      expect(r.error ?? '').toMatch(/string literal .* is not supported/);
    }
  );

  test.each(['glsl', 'wgsl'] as const)(
    '%s rejects a string literal as an operand of a supported op',
    (to) => {
      // `List` and the comparison operators DO lower on these targets, so the
      // string operand rode their lowering into the emitted source:
      // `vec2("a", "b")` and `"a" == "b"`.
      for (const src of [
        ['List', { str: 'a' }, { str: 'b' }],
        ['Equal', { str: 'a' }, { str: 'b' }],
        ['Less', { str: 'a' }, { str: 'b' }],
        ['If', ['Equal', { str: 'a' }, { str: 'a' }], 1, 2],
      ]) {
        const r = compile(ce.box(src as never), { to, constantFold: false });
        expect(r.success).toBe(false);
        expect(r.error ?? '').toMatch(/string literal .* is not supported/);
      }
    }
  );

  test.each(['glsl', 'wgsl'] as const)(
    '%s rejects a string-TYPED symbol as an operand',
    (to) => {
      // A text-typed free symbol emitted a bare identifier, which the caller
      // then declares as a numeric uniform: `Less(sv, tv)` came out as
      // `sv < tv`, a float comparison where the interpreter compares text.
      ce.declare('sv', 'string');
      ce.declare('tv', 'string');
      for (const src of [
        'sv',
        ['Less', 'sv', 'tv'],
        ['Equal', 'sv', 'tv'],
        ['List', 'sv', 'tv'],
      ]) {
        const r = compile(ce.box(src as never), { to, constantFold: false });
        expect(r.success).toBe(false);
        expect(r.error ?? '').toMatch(/text-typed, which is not supported/);
      }
    }
  );

  test('the `Length` diagnostic is the shader-target one, unchanged', () => {
    // Not a string message: the shader `length()` builtin is the Euclidean
    // norm, so `Length` never compiled there for ANY collection operand.
    const r = compile(ce.box(['Length', S]), {
      to: 'glsl',
      constantFold: false,
    });
    expect(r.success).toBe(false);
    expect(r.error ?? '').toMatch(/Euclidean norm|not supported/);
  });
});

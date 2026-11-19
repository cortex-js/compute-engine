/**
 * String-typed COMPARISONS in the JavaScript compile target: what fails closed
 * (D6), and what is now lowered FAITHFULLY.
 *
 * The comparison lowerings in `javascript-target.ts` were all numeric. Equality
 * was `Math.abs(a - b) <= tol`, which for strings is `NaN <= tol` — so a
 * compiled `"a" == "a"` answered `false` where the interpreter answers `True`, a
 * wrong answer behind a `success: true`. `IndexOf` used the same tolerance test,
 * so a string needle was never "found" (0 instead of the interpreter's 1-based
 * index). Tier 0 closed all of that.
 *
 * The ORDERINGS are governed by a NARROWER rule, because the interpreter
 * compares two strings with the same raw JavaScript `<` this target emits
 * (`compare.ts`: `a.string < b.string ? '<' : '>'`):
 *
 *   - ALL operands provably string → COMPILES, and agrees with interpretation.
 *   - some but not all provably string → DECLINES. This is the silently-wrong
 *     case: the interpreter leaves `Less("a", 1)` SYMBOLIC (inert), whereas
 *     `"a" < 1` is a plausible-looking `false`. An operand of unknown type
 *     alongside a string is POSSIBLY mixed and declines too.
 *
 * TIER 2 (2026-08-08) admits string EQUALITY, in two narrow shapes — see the
 * `tier 2` describes below, and `isStringScalarEquality` /
 * `isStringCollectionEquality` in javascript-target.ts:
 *
 *   - SCALAR `Equal`/`NotEqual` lowers to exact content equality with no
 *     tolerance, which IS the interpreter's string semantics (`compare.ts`
 *     compares `a.string === b.string`). It generalizes the §3.F Kleene-guarded
 *     `string | missing` inner, which already emitted `===`.
 *   - all-string COLLECTION equality keeps the `_SYS.eq`/`_SYS.neq` dispatch,
 *     whose scalar leaf gained a string branch.
 *
 * Still fully closed: a MIXED provable-string/provable-number equality, the
 * CHAINED form, and a NESTED or mixed-element string collection.
 *
 * `IndexOf` is NO LONGER among them (2026-08-16). Its element test is an exact
 * `===`, which IS the interpreter's `isSame` for text — content equality with
 * no tolerance — so a SCALAR text needle and text elements compile and agree
 * with interpretation (`IndexOf(["a","b"], "b")` = 2,
 * `IndexOf(Characters("abc"), "c")` = 3, an absent needle 0). What still
 * declines is a needle whose text evidence is NESTED, such as a `list<string>`
 * needle: `===` on two distinct arrays is reference identity, so it would never
 * be found where the interpreter compares the lists structurally.
 *
 * Declining means `compile()` reports `success: false` and falls back to the
 * interpreter, which answers correctly.
 *
 * The gate keys on PROVABLE string evidence (`isString` or
 * `isSubtype(type, 'string')`), never on `.matches('string')` — an
 * `unknown`-typed symbol must NOT gate, or plot equalities such as
 * `x^2 + y^2 = 4` would stop compiling.
 *
 * CLOSED (ruled 2026-08-16 — "normalize both"): the interpreter NFC-normalizes
 * every string at boxing time (`BoxedString`) and replaces lone surrogates, so
 * it answers `True` for a decomposed/precomposed pair. The emitted `===` used
 * to compare the raw UTF-16 the HOST passes in and answered `false` for such a
 * parameter. Every compiled text comparison now puts both operands through that
 * same conditioning first — the scalar equality and the character orderings via
 * `_SYS.cmpc`, the collection-equality leaf and `IndexOf`'s element test via
 * `_SYS.eqt` — so a non-NFC parameter agrees with interpretation. Pinned below.
 *
 * The string ORDERINGS were extended to the same rule on 2026-08-16: a BINARY
 * all-string `Less`/`LessEqual`/`Greater`/`GreaterEqual` now conditions each
 * operand through `_SYS.ct` and KEEPS the infix `<`/`<=`/`>`/`>=`, because the
 * interpreter's own string comparison is JavaScript's `<` applied to already-
 * conditioned content (UTF-16 code-unit order after normalization) — not the
 * code-POINT order of `_SYS.cmpc`. Two residuals genuinely remain, both
 * un-normalized: a CHAINED all-string ordering (`"a" < s < "z"`), which stays on
 * the infix path in `BaseCompiler` because that path binds temporaries so each
 * operand is evaluated once and the comparisons short-circuit; and an
 * element-wise all-string ordering against a list, whose `_SYS.bcast` closure
 * compares raw elements. Both are wrong only for a non-NFC value supplied at
 * run() time.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { executeEpsil } from '../../src/epsil/execute-epsil';

let ce: ComputeEngine;
beforeEach(() => {
  ce = new ComputeEngine();
  ce.declare('xq', 'real');
});

/** Assert the expression declines to compile, and that the interpreter — which
 * `compile()` falls back to — still answers `expected`. */
function failsClosed(expr: Expression, expected: string): void {
  expect(compile(expr, { constantFold: false }).success).toBe(false);
  expect(expr.evaluate().toString()).toBe(expected);
}

describe('string comparisons fail closed', () => {
  // NOTE: the three EQUALITY declines that used to live here (two string
  // literals under `Equal`/`NotEqual`, and a string-annotated parameter) are
  // now faithful compiles — see the `tier 2: scalar string equality` describe.

  test('a MIXED string/number equality still declines', () => {
    // Retained from tier 0. Probed, the interpreter answers `False` (equality
    // is TOTAL across sorts, unlike the orderings, which stay inert) and a
    // strict `"a" === 1` would agree — but admitting the mixed shape is a
    // separate decision, so it keeps failing closed.
    for (const args of [
      [{ str: 'a' }, 1],
      [1, { str: 'a' }],
    ]) {
      failsClosed(ce.box(['Equal', ...args] as any), '"False"');
      failsClosed(ce.box(['NotEqual', ...args] as any), '"True"');
    }
  });

  test('the CHAINED (n-ary) string equality still declines', () => {
    // The scalar admission is BINARY-only: the chained form would need the
    // impure-operand temp binding the numeric path has, for no known consumer.
    failsClosed(
      ce.box(['Equal', { str: 'a' }, { str: 'a' }, { str: 'a' }]),
      '"True"'
    );
  });

  test('IndexOf with a NESTED-text needle still declines', () => {
    // `===` on two distinct arrays is reference identity, so a `list<string>`
    // needle would never be found; the interpreter compares the lists
    // structurally and answers the 1-based index.
    const expr = ce.box([
      'IndexOf',
      ['List', ['List', { str: 'a' }]],
      ['List', { str: 'a' }],
    ]);
    expect(compile(expr, { constantFold: false }).success).toBe(false);
    expect(expr.evaluate().toString()).toBe('1');
  });

  test('IndexOf with a NUMERIC-list needle declines too (same reference-identity hole)', () => {
    // Not a text case, but the same failure mode: a `list<number>` needle
    // compared by `===` is never found in a list of lists, so the compiled
    // kernel answered 0 where the interpreter answers 1. Probed through
    // symbols so constant folding cannot mask the compiled kernel.
    const ce2 = new ComputeEngine();
    ce2.declare('xs', 'list<list<number>>');
    ce2.declare('n', 'list<number>');
    const expr = ce2.box(['IndexOf', 'xs', 'n']);
    expect(compile(expr, { constantFold: false }).success).toBe(false);
    ce2.assign('xs', ce2.box(['List', ['List', 1], ['List', 2]]));
    ce2.assign('n', ce2.box(['List', 1]));
    expect(expr.evaluate().toString()).toBe('1');
  });
});

describe('orderings: MIXED / possibly-mixed declines', () => {
  test('a string/number ordering declines (interpreter stays symbolic)', () => {
    // The wrong-answer case: `"a" < 1` is `false` in JS, but the interpreter
    // leaves the comparison INERT — and inert is not `false`.
    for (const args of [
      [{ str: 'a' }, 1],
      [1, { str: 'a' }],
    ]) {
      const expr = ce.box(['Less', ...args] as any);
      expect(compile(expr).success).toBe(false);
      expect(expr.evaluate().operator).toBe('Less');
    }
  });

  test('a chained ordering mixing a string and a number declines', () => {
    const expr = ce.box(['Less', { str: 'a' }, { str: 'b' }, 1]);
    expect(compile(expr).success).toBe(false);
  });

  test('a string against an UNKNOWN-typed symbol declines (possibly mixed)', () => {
    // `zq` is not provable string evidence, so the pair could be mixed at run
    // time. Only an all-provably-string ordering is admitted.
    const expr = ce.box(['Less', { str: 'a' }, 'zq']);
    expect(compile(expr).success).toBe(false);
  });
});

describe('broadcast route: string PARTICIPANTS, not just string operands', () => {
  // A comparison against a list is lowered ELEMENT-WISE — orderings through
  // `_SYS.bcast` (`BaseCompiler.tryCompileBroadcast`), equality through the
  // `_SYS.eq`/`_SYS.neq` runtime dispatch. Both hand ELEMENTS to a numeric
  // scalar comparison, so a `list<string>` operand puts strings on that path
  // even though the operand's own type is not a subtype of `string`. The
  // operand-level gates above never saw these shapes, so they miscompiled
  // silently behind a `success: true`.

  describe('orderings: a MIXED broadcast fails closed', () => {
    // The known-wrong shapes. `Less("a", [1, 2])` compiled to `[false, false]`
    // while the interpreter broadcasts to two INERT comparisons — and inert is
    // not `false`. `tryCompileBroadcast` emitted `_SYS.bcast` before any string
    // gate could run.
    test.each([
      ['Less', ['Less', { str: 'a' }, ['List', 1, 2]], '["a" < 1,"a" < 2]'],
      [
        'Greater',
        ['Greater', { str: 'a' }, ['List', 1, 2]],
        '[1 < "a",2 < "a"]',
      ],
      [
        'LessEqual list vs list',
        ['LessEqual', ['List', { str: 'a' }], ['List', 1]],
        '["a" <= 1]',
      ],
    ] as const)('%s over a numeric list declines', (_label, json, expected) => {
      failsClosed(ce.box(json as any), expected);
    });

    test.each(['broadcastable<string>', 'list<string>'] as const)(
      'a number against a %s-typed SYMBOL declines',
      (type) => {
        // The operand-level gates were blind here: the symbol's own type is not
        // a subtype of `string`, so `Less(1, L)` compiled to a `_SYS.bcast` and
        // ran to `[false, false]` while the interpreter leaves the comparison
        // INERT. `broadcastable<string>` reaches the gate in
        // `compileJSCollectionBoolean`, `list<string>` the one in
        // `tryCompileBroadcast` — both must fail closed.
        ce.declare('sq', type);
        const expr = ce.box(['Less', 1, 'sq']);
        expect(compile(expr).success).toBe(false);
        // The interpreter's answer: an inert comparison, not `[false, false]`.
        expect(expr.evaluate().operator).toBe('Less');
      }
    );

    test('the interpreter fallback leaves the comparisons INERT', () => {
      // Not `False`: the elements stay unevaluated `Less` nodes, which is
      // precisely what the compiled `[false, false]` misrepresented.
      const expr = ce.box(['Less', { str: 'a' }, ['List', 1, 2]]);
      expect(compile(expr).success).toBe(false);
      for (const op of expr.evaluate().ops!) expect(op.operator).toBe('Less');
    });
  });

  describe('equality over a string COLLECTION: flat all-string compiles', () => {
    // Tier 2. Wrong answers before the tier-0 gate: `_SYS.eq` compared elements
    // with the numeric tolerance test, so two EQUAL string lists answered
    // `false` where the interpreter answers `True`. The leaf now has a strict
    // `===` STRING branch (`eqTensor`), so the same dispatch is faithful, and
    // the flat all-string shapes are admitted.
    // The admission side is the NARROW flat predicate (the same one the
    // orderings use).
    // These three shapes were probed FAITHFUL under the new string leaf, and
    // still decline — the wrong direction to guess in is admission.
    test.each([
      // A numeric participant: the tier-0 mixed ruling.
      [
        'Equal of a string list against a number',
        ['Equal', ['List', { str: 'a' }, { str: 'b' }], 1],
        '["False","False"]',
      ],
      // The widened element type (`number | string`) is not WHOLLY string.
      [
        'a MIXED string/number list',
        ['Equal', ['List', { str: 'a' }, 1], ['List', { str: 'a' }, 1]],
        '"True"',
      ],
    ] as const)('%s declines', (_label, json, expected) => {
      failsClosed(ce.box(json as any), expected);
    });
  });

  describe('the participant gate does not reach numeric broadcasts', () => {

    test('an UNTYPED list element type is not string evidence', () => {
      // `collectionElementType` reports `any` for a bare `list`, which is not a
      // subtype of `string` — so a list-typed parameter of unknown element type
      // stays on the numeric fast path, like an `unknown`-typed scalar.
      const r = compile(ce.box(['Less', 'xq', ['List', 1, 2]]), {
        fallback: false,
      });
      expect(r.success).toBe(true);
      expect(r.run!({ xq: 1 })).toEqual([false, true]);
    });
  });
});

describe('keyed / fixed-arity AGGREGATES fail closed, on an honest gate', () => {
  // These shapes were ALREADY declining, but for a reason that was not true:
  // `collectionElementType` encodes a `dictionary`/`record` element as
  // `tuple<string, V>` — the ALWAYS-string KEY — so the string-evidence walk
  // reported "string-valued operands" for `Equal(d1, d2)` over
  // `dictionary<integer>`, with no string anywhere in sight. With the synthetic
  // key no longer counted as evidence, a dedicated gate keeps them closed and
  // says why: the interpreter compares such an aggregate as ONE value, whereas
  // `_SYS.eq`'s tolerance test and `_SYS.bcast` both look inside its JavaScript
  // representation.
  //
  // They must KEEP declining — admitting them miscompiles (see the
  // interpreter-parity pins below).

  /** A dictionary literal. Note it TYPES as a `record`, so the diagnostic names
   * that kind — hence the lenient kind alternation in the assertions. */
  const DICT = [
    'Dictionary',
    ['KeyValuePair', { str: 'a' }, 1],
    ['KeyValuePair', { str: 'b' }, 2],
  ];

  describe('a typed SYMBOL participant: compiled declines, interpreter inert', () => {
    // The interpreter leaves the comparison symbolic for an unbound symbol, so
    // the fallback answer is an INERT node — never the boolean the compiled
    // kernels were producing.
    test.each([
      ['dictionary<integer>', 'dictionary'],
      ['record{a: integer, b: integer}', 'record'],
    ] as const)('%s declines for Equal/NotEqual/Less', (type) => {
      for (const head of ['Equal', 'NotEqual', 'Less'] as const) {
        ce = new ComputeEngine();
        ce.declare('ag1', type);
        ce.declare('ag2', type);
        const expr = ce.box([head, 'ag1', 'ag2'] as any);
        const r = compile(expr);
        expect(r.success).toBe(false);
        // The honest reason, naming the input — NOT "string-valued operands".
        expect(r.error).toContain(`the input ag1 of type ${type}`);
        expect(r.error).not.toMatch(/string-valued operands/);
        expect(r.error).toMatch(/Could not compile/);
        // The interpreter's answer: the comparison stays inert.
        expect(expr.evaluate().operator).toBe(head);
      }
    });

    test('a tuple-typed symbol pair: ORDERINGS decline', () => {
      // The tuple case is carved out for the EQUALITY family only (see the
      // "tuple-vs-tuple equality" block below). An ordering over two tuples was
      // declining BEFORE the aggregate gate existed — the interpreter leaves it
      // inert — and stays closed.
      ce.declare('ag1', 'tuple<integer, integer>');
      ce.declare('ag2', 'tuple<integer, integer>');
      const less = ce.box(['Less', 'ag1', 'ag2']);
      const r = compile(less);
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/Less of a tuple/);
      expect(less.evaluate().operator).toBe('Less');
    });
  });

  describe('a LITERAL aggregate: compiled declines, interpreter answers', () => {
    test.each([
      ['Equal over two equal dictionaries', ['Equal', DICT, DICT], '"True"'],
      [
        'NotEqual over two equal dictionaries',
        ['NotEqual', DICT, DICT],
        '"False"',
      ],
      // A WRONG ANSWER the gate closes. A point binds atomically in the
      // interpreter, so this is `False`; compiled, `_SYS.eq` mapped over the
      // tuple's JS array and answered `[true, false]`. (Tuple-vs-TUPLE
      // equality is admitted — see the block below — and tuple-vs-LIST folds
      // to the interpreter's constant, next test.)
      [
        'Equal of a tuple against a scalar',
        ['Equal', ['Tuple', 1, 2], 1],
        '"False"',
      ],
    ] as const)('%s declines', (_label, json, expected) => {
      failsClosed(ce.box(json as any), expected);
    });

    test('Equal of a tuple against a list compiles to the constant the interpreter answers', () => {
      // A list and a point are never equal (the point binds atomically), so
      // the pair is a constant whatever the elements — `false` for `Equal`,
      // `true` for `NotEqual`. This used to decline through the aggregate
      // gate; a structural `_SYS.eq` would have answered `true` (Tycho item
      // 215).
      const eq = ce.box(['Equal', ['Tuple', 1, 2], ['List', 1, 2]] as any);
      expect(eq.evaluate().toString()).toBe('"False"');
      const r = compile(eq);
      expect(r.success).toBe(true);
      expect(r.run!()).toBe(false);
      const ne = compile(
        ce.box(['NotEqual', ['Tuple', 1, 2], ['List', 1, 2]] as any)
      );
      expect(ne.success).toBe(true);
      expect(ne.run!()).toBe(true);
    });

    test('an ordering over two literal aggregates declines (interpreter inert)', () => {
      for (const json of [
        ['Less', DICT, DICT],
        ['Less', ['Tuple', 1, 2], ['Tuple', 3, 4]],
      ]) {
        const expr = ce.box(json as any);
        const r = compile(expr);
        expect(r.success).toBe(false);
        expect(r.error).toMatch(/Could not compile/);
        expect(expr.evaluate().operator).toBe('Less');
      }
    });

    test('IndexOf with a TUPLE needle declines (it ran to 0, not 2)', () => {
      // The same tolerance test: `Math.abs(array - array)` is NaN, so the
      // needle was never "found". The interpreter answers the 1-based index.
      const expr = ce.box([
        'IndexOf',
        ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
        ['Tuple', 3, 4],
      ]);
      const r = compile(expr, { constantFold: false });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/IndexOf of a value that the interpreter may hold exactly/);
      expect(expr.evaluate().re).toBe(2);
    });
  });

  describe('the two search depths are deliberately different', () => {
    test('a keyed aggregate NESTED in a list still declines', () => {
      // These declined before only because the synthesized `tuple<string, V>`
      // key was read as string evidence; the gate has to look through element
      // types to keep them closed, or `Equal(A, B)` over
      // `list<dictionary<integer>>` would newly compile to `_SYS.eq` and answer
      // `false` for two equal values.
      for (const type of [
        'list<dictionary<integer>>',
        'list<record{a: integer}>',
        'set<dictionary<integer>>',
      ] as const) {
        ce = new ComputeEngine();
        ce.declare('ag1', type);
        ce.declare('ag2', type);
        for (const head of ['Equal', 'NotEqual'] as const)
          expect(compile(ce.box([head, 'ag1', 'ag2'] as any)).success).toBe(
            false
          );
      }
    });
  });
});

describe('tuple-vs-tuple EQUALITY is admitted (the aggregate gate carve-out)', () => {
  // The aggregate gate was over-broad: it declined EVERY comparison with a tuple
  // participant. Tuple-vs-tuple equality compiled through `_SYS.eq`/`_SYS.neq`
  // before the gate existed and was verified faithful — the array-vs-array
  // branch is whole-value equality, which is exactly the interpreter's atomic
  // point comparison. Only the MIXED shapes were wrong (pinned above).
  //
  // The rule: for `Equal`/`NotEqual`, BINARY, when EVERY participant is provably
  // tuple-typed (`isProvablyTupleParticipant`) AND every tuple COMPONENT is
  // provably numeric (`isNumericTupleParticipant`). Orderings never consult it.

  /** Compile with no fallback, assert success, and return the run result. */
  function runCompiled(expr: Expression, ...args: unknown[]): unknown {
    const r = compile(expr, { fallback: false });
    expect(r.success).toBe(true);
    return (r.run as any)(...args);
  }

  test.each([
    // [MathJSON, interpreter answer, compiled answer]
    ['Equal', ['Tuple', 1, 2], ['Tuple', 1, 2], '"True"', true],
    ['Equal', ['Tuple', 1, 2], ['Tuple', 1, 3], '"False"', false],
    ['NotEqual', ['Tuple', 1, 2], ['Tuple', 1, 2], '"False"', false],
    ['NotEqual', ['Tuple', 1, 2], ['Tuple', 1, 3], '"True"', true],
    // UNEQUAL ARITY. Probed against the interpreter: a length mismatch is
    // `False` there, and `eqTensor`'s array-vs-array branch returns `false` on
    // `a.length !== b.length` — the two agree.
    ['Equal', ['Tuple', 1, 2], ['Tuple', 1, 2, 3], '"False"', false],
    ['NotEqual', ['Tuple', 1, 2], ['Tuple', 1, 2, 3], '"True"', true],
  ] as const)('%s over %j / %j', (head, a, b, interpreted, expected) => {
    const expr = ce.box([head, a, b] as any);
    expect(expr.evaluate().toString()).toBe(interpreted);
    expect(runCompiled(expr)).toBe(expected);
  });

  test('an UNTYPED lambda parameter is not provable evidence — still declines', () => {
    // `['Function', ['Equal', 'pt', ['Tuple', 0, 0]], 'pt']` types `pt` as
    // `unknown`, so the pair is tuple-vs-not-provably-tuple: at run time a
    // SCALAR `pt` would make `_SYS.eq` element-wise (`[false, false]`) where the
    // interpreter answers `False`. Admission is the dangerous direction, so this
    // spelling fails closed; annotate the parameter to compile it.
    const f = ce.box(['Function', ['Equal', 'pt', ['Tuple', 0, 0]], 'pt']);
    const r = compile(f);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Equal of a tuple/);
  });

  test('a tuple with a STRING component still declines', () => {
    // `_SYS.eq`'s tolerance test is NaN on the string component, so it would
    // answer `false` where the interpreter answers `True`.
    //
    // The REASON moved with the numeric-component requirement: this used to be
    // caught by `assertNoStringOperand` (which runs unconditionally AFTER the
    // carve-out, and whose `typeHasStringEvidence` peels `tuple<integer, string>`
    // to the union `integer | string`), and is now caught one step earlier by
    // `isNumericTupleParticipant` — a string component is not a provable number.
    // Same outcome (fail closed, interpreter answers); the string gate still runs
    // afterwards for the non-tuple shapes.
    const T = ['Tuple', 1, { str: 'a' }];
    for (const [head, expected] of [
      ['Equal', '"True"'],
      ['NotEqual', '"False"'],
    ] as const) {
      const expr = ce.box([head, T, T] as any);
      const r = compile(expr, { constantFold: false });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/not a number, a symbol or a function/);
      expect(expr.evaluate().toString()).toBe(expected);
    }
  });

  test.each([
    // [head, a, b, interpreter answer]
    // `_SYS.eq`'s element leaf is the NUMERIC tolerance test, under which
    // `Math.abs(true - 1)` is 0: these compiled and ran to `true`/`false`, the
    // exact inverse of the interpreter, behind a `success: true`.
    ['Equal', ['Tuple', 'True', 2], ['Tuple', 1, 2], '"False"'],
    ['NotEqual', ['Tuple', 'True', 2], ['Tuple', 1, 2], '"True"'],
    // Even the both-boolean shape declines: admission requires provable
    // numbers, and the interpreter answers correctly on the fallback.
    ['Equal', ['Tuple', 'True'], ['Tuple', 'True'], '"True"'],
    ['NotEqual', ['Tuple', 'True'], ['Tuple', 'False'], '"True"'],
  ] as const)(
    'a tuple with a BOOLEAN component declines: %s over %j / %j',
    (head, a, b, interpreted) => {
      const expr = ce.box([head, a, b] as any);
      const r = compile(expr, { constantFold: false });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/elements of two types|Equal of a tuple/);
      expect(expr.evaluate().toString()).toBe(interpreted);
    }
  );

  test('boolean-component tuple SYMBOLS decline too', () => {
    ce.declare('bt1', 'tuple<boolean>');
    ce.declare('bt2', 'tuple<number>');
    for (const head of ['Equal', 'NotEqual'] as const) {
      const r = compile(ce.box([head, 'bt1', 'bt2'] as any));
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/Equal of a tuple/);
    }
  });

  test('a bare `tuple` type and an `unknown` COMPONENT decline', () => {
    // A bare `tuple` carries no component information, and `unknown` could be
    // the boolean (or object) the numeric leaf gets wrong — nothing to prove
    // numeric, so both fail closed.
    ce.declare('bare1', 'tuple');
    ce.declare('bare2', 'tuple');
    ce.declare('uk1', 'tuple<unknown, number>');
    ce.declare('uk2', 'tuple<number, number>');
    for (const [a, b] of [
      ['bare1', 'bare2'],
      ['uk1', 'uk2'],
    ] as const) {
      const r = compile(ce.box(['Equal', a, b] as any));
      expect(r.success).toBe(false);
      expect(r.error).toContain(`the input ${a} of type`);
    }
  });

  test('a NESTED all-numeric tuple is still admitted, with run parity', () => {
    // The numeric-component walk recurses: a point of points qualifies.
    const T = ['Tuple', ['Tuple', 1, 2], ['Tuple', 3, 4]];
    const eq = ce.box(['Equal', T, T] as any);
    expect(eq.evaluate().toString()).toBe('"True"');
    expect(runCompiled(eq)).toBe(true);
    const neq = ce.box([
      'NotEqual',
      T,
      ['Tuple', ['Tuple', 1, 2], ['Tuple', 3, 5]],
    ] as any);
    expect(neq.evaluate().toString()).toBe('"True"');
    expect(runCompiled(neq)).toBe(true);
  });

  test('the CHAINED (n-ary) form keeps failing closed', () => {
    // Pre-existing: the interpreter's n-ary `Equal` switches shape on how many
    // operands are collections at run time. The carve-out is binary-only.
    const T = ['Tuple', 1, 2];
    const expr = ce.box(['Equal', T, T, T] as any);
    expect(compile(expr, { constantFold: false }).success).toBe(false);
    expect(expr.evaluate().toString()).toBe('"True"');
  });
});

describe('the string-evidence walk has no depth cutoff', () => {

  test('a RECURSIVE type alias does not hang the walk', () => {
    // `strish` is reached again through its own body, so an unbounded walk
    // needs the cycle guard. Evidence is still found (the `string` arm).
    executeEpsil(ce, 'type alias strish = string | list<strish>');
    ce.declare('sr', 'strish');
    expect(compile(ce.box(['Equal', 'sr', 1])).success).toBe(false);
  });
});

describe('the gate does not reach past string operands', () => {

  test('numeric tolerance equality is unchanged', () => {
    const r = compile(ce.parse('0.1 + 0.2 = 0.3'), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!()).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// TIER 2 (2026-08-08): faithful string lowerings on the JavaScript target.
// -----------------------------------------------------------------------------

describe('tier 2: scalar string equality lowers to exact content equality', () => {
  // The interpreter compares strings EXACTLY (`compare.ts`: `a.string ===
  // b.string`, no tolerance) — the same inner the §3.F Kleene-guarded
  // `string | missing` form already emitted. The emitted form is `_SYS.eqt`,
  // which is that strict `===` for every non-text pair and, for a text pair,
  // `===` over the interpreter's ingress conditioning (NFC, then the
  // lone-surrogate replacement), since the strings the interpreter compares
  // are already conditioned.

  test('a provably NUMERIC participant keeps the shape closed', () => {
    ce.declare('nq', 'number');
    for (const head of ['Equal', 'NotEqual'] as const) {
      const r = compile(ce.box([head, 'nq', { str: 'a' }] as any));
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/not a number, a symbol or a function/);
    }
  });

  test('an aggregate participant opposite a string still declines', () => {
    ce.declare('dq', 'dictionary<integer>');
    const r = compile(ce.box(['Equal', 'dq', { str: 'a' }]));
    expect(r.success).toBe(false);
    expect(r.error).toContain('the input dq of type dictionary<integer>');
  });
});

describe('tier 2: a UNION arm that is a collection disqualifies the scalar ===', () => {

  test('…and the interpreter it falls back to BROADCASTS (the shape a `===` cannot express)', () => {
    ce.assign('lq', ce.box(['List', { str: 'a' }, { str: 'b' }]));
    expect(
      ce
        .box(['Equal', 'lq', { str: 'a' }])
        .evaluate()
        .toString()
    ).toBe('["True","False"]');
  });

  test('an INFERRED Epsil union with a collection arm declines too', () => {
    // The realistic route: no declaration anywhere, the union comes out of
    // conditional-body inference.
    executeEpsil(ce, 'gu(flag) = "a" if flag else [1,2,3]');
    ce.declare('fl', 'boolean');
    expect(ce.box(['gu', 'fl']).type.toString()).toMatch(/\|/);
    const r = compile(ce.box(['Equal', ['gu', 'fl'], { str: 'a' }]));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/a condition that is not a boolean/);
    // The interpreter's answer on the collection arm is element-wise.
    expect(
      ce
        .box(['Equal', ['gu', 'False'], { str: 'a' }])
        .evaluate()
        .toString()
    ).toBe('["False","False","False"]');
  });
});

describe('tier 2: NotEqual over a string', () => {
  // REGRESSION (2026-08-08). Once the tier-2 scalar admission started
  // accepting `NotEqual(s, "x")` for `s: string | missing` (the LITERAL
  // supplies the string evidence, and the union is neither provably numeric
  // nor a collection), the lowering had to compare text, not numbers. Until
  // 2026-11-01 a guard also made the compiled value absent for an absent
  // `s`. The compiled value with an absent operand is no longer specified
  // (`docs/COMPILATION-MODEL.md`, "Caveats of compiled code", the bullet
  // "Everything computed from an absent value, except at a discharge"; R4 of
  // `docs/plans/2026-11-01-absent-value-contract.md`): only present operands
  // are checked in compiled code.

  test('the interpreter is two-valued for both heads', () => {
    // An absent operand makes `Equal` `False` and `NotEqual` `True` (user
    // decision of 2026-11-02, two-valued comparisons).
    expect(ce.box(['Equal', 'Missing', { str: 'x' }]).evaluate().symbol).toBe(
      'False'
    );
    expect(
      ce.box(['NotEqual', 'Missing', { str: 'x' }]).evaluate().symbol
    ).toBe('True');
  });
});

describe('tier 2: Characters / GraphemeClusters', () => {
  // The interpreter segments UAX #29 GRAPHEME CLUSTERS (`Intl.Segmenter`, via
  // `splitGraphemeClusters` in library/core.ts) — neither code points
  // (`[...s]`) nor UTF-16 units (`s.split('')`). `_SYS.chars` runs the same
  // segmenter, so the lowering matches observable-for-observable.

  test('an operand that is NOT provably a string fails closed', () => {
    // A `string | number` operand is rejected by the SIGNATURE, before the
    // lowering runs — as is every non-string operand reachable from `ce.box`.
    // The lowering keeps its own `isProvablyStringOperand` gate as
    // defence-in-depth for any route that reaches it with a looser type (a
    // lazily bound operand, a future signature widening): admitting one would
    // emit a `_SYS.chars` that throws on a legitimate run-time value.
    ce.declare('mq', 'string | number');
    const r = compile(ce.box(['Characters', 'mq']));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Characters is not supported by the compiler/);
  });
});

describe('tier 2: StringJoin', () => {
  // Probed interpreter semantics, NARROWED in Phase 2 of the strings work
  // (`docs/STRING_ROADMAP.md`, decision D2):
  // `StringJoin(xs, sep?)` joins ONE collection of strings/characters, with
  // `sep` between consecutive elements. The variadic concatenation form was
  // REMOVED — once a string is itself a collection of characters, "a collection
  // and a separator" and "two strings to concatenate" are the same shape and
  // cannot both be supported — so a two-string call is the SEPARATOR form and
  // `StringJoin("abc", "-")` is `"a-b-c"`, exactly as Python's `"-".join("abc")`
  // is. Variadic concatenation is `Join(a, b, …)`.

  test.each([
    // These never reach the lowering: the signature check
    // (`(collection<string | character>, separator: string?)`) makes them
    // `Error` nodes, which the compiler refuses outright — the interpreter
    // reports `incompatible-type` or `unexpected-argument`.
    ['a non-string separator', ['StringJoin', { str: 'a' }, 1], false],
    ['a numeric list', ['StringJoin', ['List', 1, 2]], false],
    [
      'a LIST separator',
      ['StringJoin', { str: 'a' }, ['List', { str: 'b' }]],
      false,
    ],
    // A scalar `character` is one element, not a collection of them.
    [
      'a scalar character subject',
      ['StringJoin', ['CharacterFrom', { str: 'a' }]],
      false,
    ],
    // The removed variadic form is now an arity error.
    [
      'the removed VARIADIC form',
      ['StringJoin', { str: 'a' }, { str: 'b' }, { str: 'c' }],
      false,
    ],
    // This type-checks (a `Set` IS a `collection<string>`, and the interpreter
    // joins it), so the lowering's own gate is what closes it: a set does not
    // lower to an indexed JS array.
    [
      'a non-indexed collection subject',
      ['StringJoin', ['Set', { str: 'a' }, { str: 'b' }]],
      true,
    ],
  ] as const)('%s fails closed', (_label, json, ownGate) => {
    const r = compile(ce.box(json as any));
    expect(r.success).toBe(false);
    if (ownGate)
      expect(r.error).toMatch(/StringJoin is not supported by the compiler/);
  });

  test('the removed variadic form is a signature ERROR in the interpreter (the fallback answer)', () => {
    const expr = ce.box([
      'StringJoin',
      { str: 'a' },
      { str: 'b' },
      { str: 'c' },
    ]);
    expect(expr.evaluate().operator).toBe('Error');
  });
});

// -----------------------------------------------------------------------------
// The ordering gate reads only its OWN participants — and a participant whose
// type discriminates NOTHING is not evidence (2026-08-08).
// -----------------------------------------------------------------------------

describe('a wide index-slot union is not string evidence', () => {

  test('the DECLINES survive: only "no information at all" is exempt', () => {
    // A union of exactly TWO sorts is a real possibility of a mixed pair, not
    // an absence of information, so it keeps failing closed.
    ce.declare('sn', 'number | string');
    ce.declare('wq', 'boolean | indexed_collection | number | string');
    for (const json of [
      ['Less', { str: 'a' }, 1],
      ['Less', 'sn', 1],
      ['Less', { str: 'a' }, 'sn'],
      // The wide union is exempt as a SOURCE of evidence only — opposite a
      // real string it is still not a provably flat string, so the head
      // declines exactly as an `unknown`-typed participant does.
      ['Less', 'wq', { str: 'a' }],
    ] as const) {
      const r = compile(ce.box(json as any));
      expect(r.success).toBe(false);
      expect(r.error).toMatch(
        /not a number, a symbol or a function|the input (sn|wq) of type/
      );
    }
    // The broadcast-route gate is untouched.
    expect(
      compile(ce.box(['Less', { str: 'a' }, ['List', 1, 2]])).success
    ).toBe(false);
  });

  test('a user’s deliberate three-sort union is still evidence and declines', () => {
    // The exemption is for the four-armed INFERENCE ARTIFACT (`At`'s index
    // slot), which always carries an `indexed_collection` arm. A hand-written
    // `string | number | boolean` is a real possibility of a string at run
    // time: the interpreter leaves `wq < 1` INERT, whereas a compiled
    // `_.wq < 1` would coerce and answer a plausible-looking boolean.
    for (const type of ['string | number | boolean'] as const) {
      ce = new ComputeEngine();
      ce.declare('wq', type);
      const expr = ce.box(['Less', 'wq', 1]);
      const r = compile(expr);
      expect(r.success).toBe(false);
      expect(r.error).toContain(`the input wq of type`);
      // The interpreter's answer: an inert comparison, not a boolean.
      expect(expr.evaluate().operator).toBe('Less');
    }
  });
});

describe('string-preserving operators: the evidence is the subject', () => {
  // A string-preserving operator (`RotateLeft`, `Reverse`, `Take`, …) returns
  // a string exactly when its subject is one. On a subject whose type does not
  // decide that (a bare `indexed_collection` or `list`), overload resolution
  // types the application with the join of the string and list results
  // (`list<unknown> | string`). That `string` member is not string evidence:
  // the gate reads the subject instead, recursively.
  const shapes: Array<[string, unknown]> = [
    ['Equal(RotateLeft(S, 1), 3)', ['Equal', ['RotateLeft', 'S', 1], 3]],
    [
      'Less(Take(Reverse(S), 2), 2)',
      ['Less', ['Take', ['Reverse', 'S'], 2], 2],
    ],
    [
      'Equal(RotateLeft(S, 1) + RotateLeft(S, -1), 4)',
      ['Equal', ['Add', ['RotateLeft', 'S', 1], ['RotateLeft', 'S', -1]], 4],
    ],
  ];

  test.each(['string', 'string | list<number>'])(
    'a subject declared %s still fails closed',
    (type) => {
      ce.declare('S', type);
      for (const [, json] of shapes.slice(0, 2)) {
        const expr = ce.box(json as never);
        expect(compile(expr, { constantFold: false }).success).toBe(false);
      }
    }
  );

  test('a string literal subject still fails closed', () => {
    const expr = ce.box(['Equal', ['Reverse', { str: 'abc' }], 3]);
    expect(compile(expr, { constantFold: false }).success).toBe(false);
  });
});

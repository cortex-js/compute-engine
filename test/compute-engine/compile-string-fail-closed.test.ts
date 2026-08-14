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
 *   - SCALAR `Equal`/`NotEqual` lowers to a strict `===`/`!==`, which IS the
 *     interpreter's string semantics (`compare.ts` compares `a.string ===
 *     b.string`, no tolerance). It generalizes the §3.F Kleene-guarded
 *     `string | missing` inner, which already emitted `===`.
 *   - all-string COLLECTION equality keeps the `_SYS.eq`/`_SYS.neq` dispatch,
 *     whose scalar leaf gained a string branch — the mirror of the Python
 *     target's `_ce_eqcoll`, closing a documented JS/Python divergence.
 *
 * Still fully closed: a MIXED provable-string/provable-number equality, the
 * CHAINED form, a NESTED or mixed-element string collection, and `IndexOf` on
 * any string evidence (its element test is now an exact `===` and would compare
 * strings faithfully, but relaxing its gates is a separate decision).
 *
 * Declining means `compile()` reports `success: false` and falls back to the
 * interpreter, which answers correctly.
 *
 * The gate keys on PROVABLE string evidence (`isString` or
 * `isSubtype(type, 'string')`), never on `.matches('string')` — an
 * `unknown`-typed symbol must NOT gate, or plot equalities such as
 * `x^2 + y^2 = 4` would stop compiling.
 *
 * ACCEPTED RESIDUAL (flagged for ruling, 2026-08-08): the interpreter
 * NFC-normalizes every string at boxing time (`BoxedString`), so it answers
 * `True` for a decomposed/precomposed pair, whereas the emitted `===` compares
 * the raw UTF-16 the HOST passes in. Literals are unaffected (boxed, hence NFC,
 * before codegen) and `_SYS.chars` normalizes; only a raw non-NFC string bound
 * to a compiled parameter diverges. Pinned as a documented divergence below.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { BoxedExpression } from '../../src/compute-engine/global-types';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { executeEpsil } from '../../src/epsil/execute-epsil';

let ce: ComputeEngine;
beforeEach(() => {
  ce = new ComputeEngine();
});

/** Assert the expression declines to compile, and that the interpreter — which
 * `compile()` falls back to — still answers `expected`. */
function failsClosed(expr: BoxedExpression, expected: string): void {
  expect(compile(expr, { constantFold: false }).success).toBe(false);
  expect(expr.evaluate().toString()).toBe(expected);
}

describe('string comparisons fail closed (D6)', () => {
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

  test('IndexOf with a string needle declines', () => {
    // Before the gate this ran to 0 (the tolerance test is NaN for strings)
    // while the interpreter answers the 1-based index 2.
    const expr = ce.box([
      'IndexOf',
      ['List', { str: 'a' }, { str: 'b' }],
      { str: 'b' },
    ]);
    expect(compile(expr, { constantFold: false }).success).toBe(false);
    expect(expr.evaluate().toString()).toBe('2');
  });
});

describe('orderings: ALL-string compiles, with interpreter parity', () => {
  // The pairs that prove the emitted `<` is the interpreter's `<`: uppercase
  // before lowercase (`Z` < `a` by code unit, not by locale collation), digit
  // strings compared as text rather than numerically (`"10" < "9"`), a
  // non-ASCII letter ordering AFTER `b` (so a locale-aware collation would
  // disagree), and a common-prefix pair.
  test.each([
    ['Z', 'a', true],
    ['10', '9', true],
    ['ä', 'b', false],
    ['abc', 'abd', true],
    ['b', 'a', false],
    ['a', 'a', false],
  ] as const)('Less(%p, %p) compiles and runs to %p', (a, b, expected) => {
    const expr = ce.box(['Less', { str: a }, { str: b }]);
    const r = compile(expr, { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!()).toBe(expected);
    // The pin that matters: the compiled answer IS the interpreted answer.
    expect(r.run!()).toBe(expr.evaluate().symbol === 'True');
  });

  test.each(['Less', 'LessEqual', 'Greater', 'GreaterEqual'])(
    '%s over two string literals compiles with parity',
    (head) => {
      for (const [a, b] of [
        ['a', 'b'],
        ['b', 'a'],
        ['a', 'a'],
      ]) {
        const expr = ce.box([head, { str: a }, { str: b }]);
        const r = compile(expr, { fallback: false });
        expect(r.success).toBe(true);
        expect(r.run!()).toBe(expr.evaluate().symbol === 'True');
      }
    }
  );

  test('an all-string CHAINED ordering compiles with parity', () => {
    for (const [a, b, c, expected] of [
      ['a', 'b', 'c', true],
      ['a', 'c', 'b', false],
    ] as const) {
      const expr = ce.box(['Less', { str: a }, { str: b }, { str: c }]);
      const r = compile(expr, { fallback: false });
      expect(r.success).toBe(true);
      expect(r.run!()).toBe(expected);
      expect(r.run!()).toBe(expr.evaluate().symbol === 'True');
    }
  });

  test('an ordering over a string-annotated parameter compiles again', () => {
    // The shape the broad gate regressed: a `string` parameter is provable
    // string EVIDENCE, and both operands are strings, so it stays on the fast
    // path.
    executeEpsil(ce, 'h(s: string) = 1 if s < "m" else 0');
    for (const [arg, expected] of [
      ['a', 1],
      ['z', 0],
    ] as const) {
      const expr = ce.box(['h', { str: arg }]);
      const r = compile(expr, { fallback: false });
      expect(r.success).toBe(true);
      expect(r.run!()).toBe(expected);
      expect(expr.evaluate().re).toBe(expected);
    }
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

  /** The interpreter's element-wise verdicts, as booleans. */
  function interpretedBooleans(expr: BoxedExpression): boolean[] {
    return expr.evaluate().ops!.map((op) => op.symbol === 'True');
  }

  describe('orderings: ALL-string broadcasts compile, with run() parity', () => {
    // Kept compiling deliberately: the emitted `<` is the same raw JavaScript
    // `<` the interpreter uses on strings, so element-wise agreement follows
    // from the scalar agreement pinned above. Verified against interpretation.
    test.each([
      ['scalar vs list', ['Less', { str: 'a' }, ['List', { str: 'x' }, { str: 'y' }]], [true, true]],
      ['list vs list', ['Less', ['List', { str: 'a' }, { str: 'b' }], ['List', { str: 'a' }, { str: 'c' }]], [false, true]],
      ['GreaterEqual scalar vs list', ['GreaterEqual', { str: 'b' }, ['List', { str: 'a' }, { str: 'c' }]], [true, false]],
    ] as const)('%s compiles and runs element-wise', (_label, json, expected) => {
      const expr = ce.box(json as any);
      const r = compile(expr, { fallback: false });
      expect(r.success).toBe(true);
      expect(r.run!()).toEqual(expected);
      // The pin that matters: the compiled answer IS the interpreted answer.
      expect(r.run!()).toEqual(interpretedBooleans(expr));
    });
  });

  describe('orderings: a MIXED broadcast fails closed', () => {
    // The known-wrong shapes. `Less("a", [1, 2])` compiled to `[false, false]`
    // while the interpreter broadcasts to two INERT comparisons — and inert is
    // not `false`. `tryCompileBroadcast` emitted `_SYS.bcast` before any string
    // gate could run.
    test.each([
      ['Less', ['Less', { str: 'a' }, ['List', 1, 2]], '["a" < 1,"a" < 2]'],
      ['Greater', ['Greater', { str: 'a' }, ['List', 1, 2]], '[1 < "a",2 < "a"]'],
      ['LessEqual list vs list', ['LessEqual', ['List', { str: 'a' }], ['List', 1]], '["a" <= 1]'],
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

    test('a NESTED all-string ordering declines (parity unverified)', () => {
      // The `every` admission side is deliberately the FLAT test: only
      // `list<string>`-deep all-string shapes are verified to agree with
      // interpretation. A nested one broadcasts to a nested list of verdicts,
      // which the flat compiled lowering has no pinned parity for, so it fails
      // closed rather than compiling on a guess.
      failsClosed(
        ce.box(['Less', ['List', { str: 'a' }], ['List', ['List', { str: 'x' }]]]),
        '[["True"]]'
      );
    });

    test('the interpreter fallback leaves the comparisons INERT', () => {
      // Not `False`: the elements stay unevaluated `Less` nodes, which is
      // precisely what the compiled `[false, false]` misrepresented.
      const expr = ce.box(['Less', { str: 'a' }, ['List', 1, 2]]);
      expect(compile(expr).success).toBe(false);
      for (const op of expr.evaluate().ops!)
        expect(op.operator).toBe('Less');
    });
  });

  describe('equality over a string COLLECTION: flat all-string compiles', () => {
    // Tier 2. Wrong answers before the tier-0 gate: `_SYS.eq` compared elements
    // with the numeric tolerance test, so two EQUAL string lists answered
    // `false` where the interpreter answers `True`. The leaf now has a strict
    // `===` STRING branch (`eqTensor`), so the same dispatch is faithful, and
    // the flat all-string shapes are admitted — the mirror of the Python
    // target's `_ce_eqcoll` admission.
    test.each([
      ['Equal over two equal string lists', ['Equal', ['List', { str: 'a' }, { str: 'b' }], ['List', { str: 'a' }, { str: 'b' }]], true],
      ['NotEqual over two equal string lists', ['NotEqual', ['List', { str: 'a' }, { str: 'b' }], ['List', { str: 'a' }, { str: 'b' }]], false],
      ['Equal over two differing string lists', ['Equal', ['List', { str: 'a' }], ['List', { str: 'c' }]], false],
      ['Equal over lists of unequal length', ['Equal', ['List', { str: 'a' }], ['List', { str: 'a' }, { str: 'b' }]], false],
      // ONE collection operand: the interpreter BROADCASTS element-wise, and
      // so does `_SYS.eq`.
      ['Equal of a string list against a string scalar', ['Equal', ['List', { str: 'a' }, { str: 'b' }], { str: 'a' }], [true, false]],
      ['NotEqual of a string list against a string scalar', ['NotEqual', ['List', { str: 'a' }, { str: 'b' }], { str: 'a' }], [false, true]],
    ] as const)('%s compiles with interpreter parity', (_label, json, expected) => {
      const expr = ce.box(json as any);
      const r = compile(expr, { fallback: false });
      expect(r.success).toBe(true);
      expect(r.run!()).toEqual(expected);
      // The pin that matters: the compiled answer IS the interpreted answer.
      const interpreted = expr.evaluate();
      expect(r.run!()).toEqual(
        interpreted.operator === 'List'
          ? interpreted.ops!.map((op) => op.symbol === 'True')
          : interpreted.symbol === 'True'
      );
    });

    test('the lowering is the unchanged runtime dispatch', () => {
      const r = compile(
        ce.box([
          'Equal',
          ['List', { str: 'a' }, { str: 'b' }],
          ['List', { str: 'a' }, { str: 'b' }],
        ]),
        { fallback: false, constantFold: false }
      );
      expect(r.code).toMatchInlineSnapshot(
        `"_SYS.eq((["a", "b"]), (["a", "b"]), 1e-10)"`
      );
    });

    // The admission side is the NARROW flat predicate (the same one the
    // orderings use, and the same one Python's `_ce_eqcoll` admission uses).
    // These three shapes were probed FAITHFUL under the new string leaf, and
    // still decline — the wrong direction to guess in is admission.
    test.each([
      // A numeric participant: the tier-0 mixed ruling.
      ['Equal of a string list against a number', ['Equal', ['List', { str: 'a' }, { str: 'b' }], 1], '["False","False"]'],
      // One peel yields `list<string>`, which is not a subtype of `string`.
      ['a NESTED string list', ['Equal', ['List', ['List', { str: 'a' }]], ['List', ['List', { str: 'a' }]]], '"True"'],
      // The widened element type (`number | string`) is not WHOLLY string.
      ['a MIXED string/number list', ['Equal', ['List', { str: 'a' }, 1], ['List', { str: 'a' }, 1]], '"True"'],
    ] as const)('%s declines', (_label, json, expected) => {
      failsClosed(ce.box(json as any), expected);
    });
  });

  describe('the participant gate does not reach numeric broadcasts', () => {
    test('an ordering over a numeric list still broadcast-compiles', () => {
      const expr = ce.box(['Less', 1, ['List', 1, 2]]);
      const r = compile(expr, { fallback: false });
      expect(r.success).toBe(true);
      expect(r.code).toMatchInlineSnapshot(
        `"_SYS.bcast((_tv1, _tv2) => ((_tv1) < (_tv2)), 1, [1, 2])"`
      );
      expect(r.run!()).toEqual(interpretedBooleans(expr));
    });

    test('equality over a numeric list keeps the runtime dispatch', () => {
      const expr = ce.box(['Equal', 1, ['List', 1, 2]]);
      const r = compile(expr, { fallback: false });
      expect(r.success).toBe(true);
      expect(r.code).toMatchInlineSnapshot(
        `"_SYS.eq((1), ([1, 2]), 1e-10)"`
      );
      expect(r.run!()).toEqual(interpretedBooleans(expr));
    });

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
      ['record<a: integer, b: integer>', 'record'],
    ] as const)('%s declines for Equal/NotEqual/Less', (type, kind) => {
      for (const head of ['Equal', 'NotEqual', 'Less'] as const) {
        ce = new ComputeEngine();
        ce.declare('ag1', type);
        ce.declare('ag2', type);
        const expr = ce.box([head, 'ag1', 'ag2'] as any);
        const r = compile(expr);
        expect(r.success).toBe(false);
        // The honest reason, naming the kind — NOT "string-valued operands".
        expect(r.error).toMatch(new RegExp(`${kind} participant`));
        expect(r.error).not.toMatch(/string-valued operands/);
        expect(r.error).toMatch(/Fail closed \(D6\)/);
        // The interpreter's answer: the comparison stays inert.
        expect(expr.evaluate().operator).toBe(head);
      }
    });

    test('a tuple-typed symbol pair: ORDERINGS decline, EQUALITY is admitted', () => {
      // The tuple case is carved out for the EQUALITY family only (see the
      // "tuple-vs-tuple equality" block below). An ordering over two tuples was
      // declining BEFORE the aggregate gate existed — the interpreter leaves it
      // inert — and stays closed.
      ce.declare('ag1', 'tuple<integer, integer>');
      ce.declare('ag2', 'tuple<integer, integer>');
      const less = ce.box(['Less', 'ag1', 'ag2']);
      const r = compile(less);
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/tuple participant/);
      expect(less.evaluate().operator).toBe('Less');
      for (const head of ['Equal', 'NotEqual'] as const)
        expect(compile(ce.box([head, 'ag1', 'ag2'] as any)).success).toBe(true);
    });
  });

  describe('a LITERAL aggregate: compiled declines, interpreter answers', () => {
    test.each([
      ['Equal over two equal dictionaries', ['Equal', DICT, DICT], '"True"'],
      ['NotEqual over two equal dictionaries', ['NotEqual', DICT, DICT], '"False"'],
      // The two WRONG ANSWERS the gate closes. A point binds atomically in the
      // interpreter, so both are `False`; compiled, `_SYS.eq` mapped over the
      // tuple's JS array and answered `[true, false]` and `true` respectively.
      // (Tuple-vs-TUPLE equality is admitted — see the block below. These are
      // the MIXED shapes: one participant is not provably a tuple.)
      ['Equal of a tuple against a scalar', ['Equal', ['Tuple', 1, 2], 1], '"False"'],
      ['Equal of a tuple against a list', ['Equal', ['Tuple', 1, 2], ['List', 1, 2]], '"False"'],
    ] as const)('%s declines', (_label, json, expected) => {
      failsClosed(ce.box(json as any), expected);
    });

    test('an ordering over two literal aggregates declines (interpreter inert)', () => {
      for (const json of [
        ['Less', DICT, DICT],
        ['Less', ['Tuple', 1, 2], ['Tuple', 3, 4]],
      ]) {
        const expr = ce.box(json as any);
        const r = compile(expr);
        expect(r.success).toBe(false);
        expect(r.error).toMatch(/Fail closed \(D6\)/);
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
      expect(r.error).toMatch(/tuple participant/);
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
        'list<record<a: integer>>',
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

    test('a POINT LIST keeps compiling — a nested tuple is not searched', () => {
      // `list<tuple<number, number>>` is the settled point-list lowering and
      // compiles today; only a tuple that is the participant ITSELF binds
      // atomically. Widening the gate to nested tuples would break this.
      ce.declare('P', 'list<tuple<number, number>>');
      ce.declare('Q', 'list<tuple<number, number>>');
      const eq = compile(ce.box(['Equal', 'P', 'Q']), { fallback: false });
      expect(eq.success).toBe(true);
      expect(eq.code).toMatchInlineSnapshot(
        `"_SYS.eq((_.P), (_.Q), 1e-10)"`
      );
      const less = compile(ce.box(['Less', 'P', 'Q']), { fallback: false });
      expect(less.success).toBe(true);
      expect(less.code).toMatchInlineSnapshot(
        `"_SYS.bcast((_tv1, _tv2) => ((_tv1) < (_tv2)), _.P, _.Q)"`
      );
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
  function runCompiled(expr: BoxedExpression, ...args: unknown[]): unknown {
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

  test('the lowering is the collection dispatch, unchanged from before the gate', () => {
    const r = compile(ce.box(['Equal', ['Tuple', 1, 2], ['Tuple', 1, 2]]), {
      fallback: false,
      constantFold: false,
    });
    expect(r.code).toMatchInlineSnapshot(
      `"_SYS.eq(([1, 2]), ([1, 2]), 1e-10)"`
    );
  });

  test('declared tuple-typed SYMBOLS with assigned values, run parity', () => {
    ce.declare('p', 'tuple<number, number>');
    ce.declare('q', 'tuple<number, number>');
    ce.assign('p', ce.box(['Tuple', 1, 2]));
    ce.assign('q', ce.box(['Tuple', 1, 2]));
    const eq = ce.box(['Equal', 'p', 'q']);
    expect(eq.evaluate().toString()).toBe('"True"');
    expect(runCompiled(eq)).toBe(true);
    const neq = ce.box(['NotEqual', 'p', 'q']);
    expect(neq.evaluate().toString()).toBe('"False"');
    expect(runCompiled(neq)).toBe(false);
    // …and a differing pair.
    ce.assign('q', ce.box(['Tuple', 1, 3]));
    const eq2 = ce.box(['Equal', 'p', 'q']);
    expect(eq2.evaluate().toString()).toBe('"False"');
    expect(runCompiled(eq2)).toBe(false);
  });

  test('a point-predicate LAMBDA over a tuple-annotated parameter, run parity', () => {
    // The realistic consumer: `pt ↦ pt == (0, 0)` applied over a point list. The
    // parameter must be tuple-ANNOTATED for the admission to fire (see the
    // untyped pin below).
    const f = ce.box([
      'Function',
      ['Equal', 'pt', ['Tuple', 0, 0]],
      ['Typed', 'pt', "'tuple<number, number>'"],
    ] as any);
    const r = compile(f, { fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).toMatchInlineSnapshot(
      `"(pt) => _SYS.eq((pt), ([0, 0]), 1e-10)"`
    );
    expect((r.run as any)([0, 0])).toBe(true);
    expect((r.run as any)([1, 2])).toBe(false);
    // The interpreter's `Apply`, for the same two points.
    expect(ce.box(['Apply', f, ['Tuple', 0, 0]]).evaluate().toString()).toBe(
      '"True"'
    );
    expect(ce.box(['Apply', f, ['Tuple', 1, 2]]).evaluate().toString()).toBe(
      '"False"'
    );
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
    expect(r.error).toMatch(/tuple participant/);
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
    // afterwards for the non-tuple shapes. Python declines this shape on the same
    // predicate, for the same reason.
    const T = ['Tuple', 1, { str: 'a' }];
    for (const [head, expected] of [
      ['Equal', '"True"'],
      ['NotEqual', '"False"'],
    ] as const) {
      const expr = ce.box([head, T, T] as any);
      const r = compile(expr, { constantFold: false });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/tuple participant/);
      expect(expr.evaluate().toString()).toBe(expected);
    }
  });

  test.each([
    // [head, a, b, interpreter answer]
    // `_SYS.eq`'s element leaf is the NUMERIC tolerance test, under which
    // `Math.abs(true - 1)` is 0: these compiled and ran to `true`/`false`, the
    // exact inverse of the interpreter, behind a `success: true`. Mirrors the
    // Python target's boolean-component pins (`True == 1` there).
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
      expect(r.error).toMatch(/tuple participant/);
      expect(expr.evaluate().toString()).toBe(interpreted);
    }
  );

  test('boolean-component tuple SYMBOLS decline too', () => {
    ce.declare('bt1', 'tuple<boolean>');
    ce.declare('bt2', 'tuple<number>');
    for (const head of ['Equal', 'NotEqual'] as const) {
      const r = compile(ce.box([head, 'bt1', 'bt2'] as any));
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/tuple participant/);
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
      expect(r.error).toMatch(/tuple participant/);
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

  test('a UNION participant with a non-tuple member declines', () => {
    // The run-time value could be the shape the kernel gets wrong.
    ce.declare('u1', 'tuple<number, number> | number');
    ce.declare('u2', 'tuple<number, number>');
    for (const head of ['Equal', 'NotEqual'] as const) {
      const r = compile(ce.box([head, 'u1', 'u2'] as any));
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/tuple participant/);
    }
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
  // The walk used to stop at depth 8 and return `false` — "no evidence", the
  // ADMITTING direction. So a nesting one level deeper reopened exactly the
  // wrong-boolean miscompile the predicate exists to prevent. Termination is
  // structural now, with a visited set for the one non-structural step (a
  // `reference` unfolding to its definition).

  /** A string literal wrapped in `depth` nested `List`s. */
  function nestedStringList(depth: number): any {
    let v: any = { str: 'a' };
    for (let i = 0; i < depth; i++) v = ['List', v];
    return v;
  }

  // Depth 1 is the FLAT `list<string>` shape tier 2 admits (pinned above); the
  // walk's depth behavior is exercised from depth 2 on, where the participant
  // is no longer flat and must still decline.
  test.each([2, 8, 9, 12, 20])(
    'Equal over a %i-deep nested string list declines (interpreter: True)',
    (depth) => {
      const json = nestedStringList(depth);
      failsClosed(ce.box(['Equal', json, json] as any), '"True"');
    }
  );

  test('a RECURSIVE type alias does not hang the walk', () => {
    // `strish` is reached again through its own body, so an unbounded walk
    // needs the cycle guard. Evidence is still found (the `string` arm).
    executeEpsil(ce, 'type alias strish = string | list<strish>');
    ce.declare('sr', 'strish');
    expect(compile(ce.box(['Equal', 'sr', 1])).success).toBe(false);
  });

  test('a recursive alias with NO string arm keeps compiling', () => {
    // The other direction: the guard must not turn a terminating walk into a
    // spurious decline.
    executeEpsil(ce, 'type alias numish = number | list<numish>');
    ce.declare('nm', 'numish');
    const r = compile(ce.box(['Equal', 'nm', 4]), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).toMatchInlineSnapshot(
      `"(Math.abs((_.nm) - (4)) <= 1e-10)"`
    );
  });
});

describe('the gate does not reach past string operands', () => {
  test('match on a string still compiles, with run() parity', () => {
    // `Match` has its own lowering (`compileMatchConstant`), which emits a real
    // `===` against the string constant — it never routes through the numeric
    // equality codegen, so the gate must leave it alone.
    executeEpsil(ce, 'm(c) = match c { "n" => 1\n  _ => 0 }');
    for (const [arg, expected] of [
      ['n', 1],
      ['q', 0],
    ] as const) {
      const expr = ce.box(['m', { str: arg }]);
      const r = compile(expr, { fallback: false });
      expect(r.success).toBe(true);
      expect(r.run!()).toBe(expected);
      expect(expr.evaluate().re).toBe(expected);
    }
  });

  test('numeric tolerance equality is unchanged', () => {
    const r = compile(ce.parse('0.1 + 0.2 = 0.3'), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!()).toBe(true);
  });

  test('an unknown-typed symbol does not gate (plot shapes keep compiling)', () => {
    const r = compile(ce.box(['Equal', 'xq', 4]), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).toMatchInlineSnapshot(
      `"(Math.abs((_.xq) - (4)) <= 1e-10)"`
    );
  });

  test('an inferred-parameter plot equality keeps its numeric fast path', () => {
    const r = compile(ce.parse('x^2 + y^2 = 4'), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).toMatchInlineSnapshot(
      `"(Math.abs(((_.x * _.x) + (_.y * _.y)) - (4)) <= 1e-10)"`
    );
  });

  test('numeric IndexOf and numeric orderings are unchanged', () => {
    const idx = compile(ce.box(['IndexOf', ['List', 1, 2], 2]), {
      fallback: false,
    });
    expect(idx.success).toBe(true);
    expect(idx.run!()).toBe(2);

    const less = compile(ce.parse('2 < 3'), { fallback: false });
    expect(less.success).toBe(true);
    expect(less.run!()).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// `IndexOf`'s element test is EXACT and distinguishes booleans from numbers,
// like the interpreter's `.isSame()`. It used to be the numeric tolerance test
// `Equal` uses, which was wrong twice over behind a `success: true`:
// `Math.abs(true - 1)` is 0, so `IndexOf([1, 2], True)` RAN to 1 where the
// interpreter answers 0; and a needle merely within `engine.tolerance` of an
// element was "found" where the interpreter's exact `.isSame()` answers 0.
// Ruled 2026-08-08: fixed in the emitted predicate (adapter), not a
// compile-time gate, so these all keep compiling. The Python target's
// `_ce_indexof` adapter is the mirror
// (`compile-python-string-fail-closed.test.ts`).
// -----------------------------------------------------------------------------
describe('IndexOf element test is exact and boolean-aware (executed parity)', () => {
  const cases: Array<{ name: string; expr: any; expected: number }> = [
    {
      name: 'bool needle, numeric haystack',
      expr: ['IndexOf', ['List', 1, 2], 'True'],
      expected: 0,
    },
    {
      name: 'numeric needle, bool haystack',
      expr: ['IndexOf', ['List', 'True'], 1],
      expected: 0,
    },
    {
      name: 'bool needle, bool haystack',
      expr: ['IndexOf', ['List', 'True', 'False'], 'False'],
      expected: 2,
    },
    // Numbers still match across int/float (`1.5 === 1.5`, and `1 === 1.0`).
    {
      name: 'float needle, numeric haystack',
      expr: ['IndexOf', ['List', { num: '1.5' }, 3], { num: '1.5' }],
      expected: 1,
    },
    // NaN: `NaN === NaN` is false, but the interpreter's structural
    // `.isSame()` finds a NaN needle — hence the both-NaN short-circuit.
    {
      name: 'NaN needle, NaN in haystack',
      expr: ['IndexOf', ['List', 'NaN', 3], 'NaN'],
      expected: 1,
    },
    {
      name: 'NaN needle, no NaN in haystack',
      expr: ['IndexOf', ['List', 1, 2], 'NaN'],
      expected: 0,
    },
    // EXACTNESS. The interpreter's number `.isSame()` has NO tolerance, so a
    // needle that merely lands within `engine.tolerance` of an element is NOT
    // found. The element test used to be a tolerance comparison and answered 1
    // on both of these.
    //
    // (The earlier belief that the interpreter tolerated float noise came from
    // probing with `IndexOf([0.3], Add(0.1, 0.2))`: `Add(0.1, 0.2)` EVALUATES
    // to exactly `0.3` by exact decimal folding, so the comparison leaf never
    // saw a near-miss float. Beware that trap when probing this — which is
    // also why the divergence below is documented, not executed.)
    {
      name: 'needle within tolerance of an element is NOT found',
      expr: ['IndexOf', ['List', 0], { num: '5e-11' }],
      expected: 0,
    },
    {
      name: 'float-noise element is NOT found by the rounded needle',
      expr: ['IndexOf', ['List', { num: '0.30000000000000004' }], 0.3],
      expected: 0,
    },
    // ACCEPTED RESIDUAL (documented, not asserted — canonicalization would fold
    // the sum away before the compiler ever saw a near-miss float): a needle
    // COMPUTED at runtime to a near-miss f64 (`0.1 + 0.2` →
    // `0.30000000000000004` in JavaScript) is not found in a `[0.3]` haystack,
    // where the interpreter folds `Add(0.1, 0.2)` exactly to `0.3` and finds
    // it. That is the ordinary exactness loss of compiling to f64 arithmetic;
    // no element test can close it, and a tolerance leaf would only trade it
    // for wrong answers on the two rows above.
  ];

  for (const c of cases) {
    test(`${c.name} → ${c.expected}`, () => {
      const expr = ce.box(c.expr);
      // The interpreter's answer is the reference.
      expect(expr.evaluate().re).toBe(c.expected);
      const r = compile(expr, { fallback: false });
      expect(r.success).toBe(true);
      expect(r.run!()).toBe(c.expected);
    });
  }
});

// -----------------------------------------------------------------------------
// TIER 2 (2026-08-08): faithful string lowerings on the JavaScript target.
// -----------------------------------------------------------------------------

describe('tier 2: scalar string equality lowers to a strict ===', () => {
  // The interpreter compares strings EXACTLY (`compare.ts`: `a.string ===
  // b.string`, no tolerance), so `===` is its own semantics — the same inner the
  // §3.F Kleene-guarded `string | missing` form already emitted.

  /** Compile with no fallback, assert success, and return the run result. */
  function runCompiled(expr: BoxedExpression, ...args: unknown[]): unknown {
    const r = compile(expr, { fallback: false });
    expect(r.success).toBe(true);
    return (r.run as any)(...args);
  }

  test.each([
    ['Equal', 'a', 'a', true],
    ['Equal', 'a', 'b', false],
    ['Equal', '', '', true],
    ['NotEqual', 'a', 'b', true],
    ['NotEqual', 'a', 'a', false],
    // NOT the numeric tolerance path: two distinct numeric STRINGS are unequal,
    // where parsing them as numbers would have made them equal.
    ['Equal', '1', '1.0', false],
    ['Equal', '1', '1', true],
  ] as const)('%s(%p, %p) → %p, with interpreter parity', (head, a, b, expected) => {
    const expr = ce.box([head, { str: a }, { str: b }] as any);
    expect(runCompiled(expr)).toBe(expected);
    expect(expr.evaluate().symbol === 'True').toBe(expected);
  });

  test('the emitted code is a strict comparison, not the tolerance test', () => {
    const eq = compile(ce.box(['Equal', { str: 'a' }, { str: 'b' }]), {
      fallback: false,
      constantFold: false,
    });
    expect(eq.code).toMatchInlineSnapshot(`"(("a") === ("b"))"`);
    const neq = compile(ce.box(['NotEqual', { str: 'a' }, { str: 'b' }]), {
      fallback: false,
      constantFold: false,
    });
    expect(neq.code).toMatchInlineSnapshot(`"(("a") !== ("b"))"`);
  });

  test('a string-ANNOTATED parameter compiles and runs, both ways', () => {
    // Tier 0 pinned this as a decline (it had compiled to
    // `Math.abs("a" - "a") <= 1e-10` and run to 0 against the interpreter's 1).
    executeEpsil(ce, 'g(s: string) = 1 if s == "a" else 0');
    for (const [arg, expected] of [
      ['a', 1],
      ['q', 0],
    ] as const) {
      const expr = ce.box(['g', { str: arg }]);
      expect(runCompiled(expr)).toBe(expected);
      expect(expr.evaluate().re).toBe(expected);
    }
  });

  test('an INFERRED (unknown) parameter opposite a string literal is admitted', () => {
    // The deliberate widening over "both provably string": a scanner predicate
    // written without an annotation types its parameter `unknown`, and that is
    // the realistic consumer (see the skipWs program below). It is faithful for
    // every scalar run-time value — a string compares exactly, and a number or
    // boolean answers `false`, which is the interpreter's `False`.
    executeEpsil(ce, 'isWsA(c) = c == " " || c == "\\t"');
    for (const [arg, expected] of [
      [' ', true],
      ['\t', true],
      ['a', false],
    ] as const) {
      const expr = ce.box(['isWsA', { str: arg }]);
      expect(runCompiled(expr)).toBe(expected);
      expect(expr.evaluate().symbol === 'True').toBe(expected);
    }
  });

  test('a boolean-typed participant opposite a string is admitted, and agrees', () => {
    // The interpreter answers `False` for any cross-sort equality; `===` does
    // too (it rejects `true === "a"` natively — no typeof guard needed).
    ce.declare('bq', 'boolean');
    const expr = ce.box(['Equal', 'bq', { str: 'a' }]);
    const r = compile(expr, { fallback: false });
    expect(r.success).toBe(true);
    expect((r.run as any)({ bq: true })).toBe(false);
    expect((r.run as any)({ bq: false })).toBe(false);
  });

  test('a provably NUMERIC participant keeps the shape closed', () => {
    ce.declare('nq', 'number');
    for (const head of ['Equal', 'NotEqual'] as const) {
      const r = compile(ce.box([head, 'nq', { str: 'a' }] as any));
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/string-valued operands/);
    }
  });

  test('an aggregate participant opposite a string still declines', () => {
    ce.declare('dq', 'dictionary<integer>');
    const r = compile(ce.box(['Equal', 'dq', { str: 'a' }]));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/dictionary participant/);
  });

  test('the §3.F Kleene guard is unaffected (no double handling)', () => {
    // `string | missing` on BOTH sides is emitted by the base compiler's
    // guarded form, which computes its own all-string inner — it never reaches
    // this target's `Equal` codegen. Byte-identical to before tier 2.
    const e = new ComputeEngine();
    e.declare('sk', 'string | missing');
    e.declare('tk', 'string | missing');
    const r = compile(e.box(['Equal', 'sk', 'tk']), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).toMatch(/===/);
    expect(r.code).not.toMatch(/Math\.abs/);
    const run = r.run as unknown as (v: {
      sk: string | undefined;
      tk: string | undefined;
    }) => boolean | undefined;
    expect(run({ sk: 'x', tk: 'x' })).toBe(true);
    expect(run({ sk: 'x', tk: 'y' })).toBe(false);
    expect(run({ sk: undefined, tk: 'x' })).toBeUndefined();
  });

  test('DOCUMENTED DIVERGENCE: a non-NFC runtime string is not normalized', () => {
    // The interpreter NFC-normalizes at BOXING time (`BoxedString`), so it
    // answers `True` for a decomposed/precomposed pair. The compiled `===`
    // compares the raw UTF-16 the host passed in. Literals are unaffected (they
    // are boxed before codegen, so the emitted literal is already NFC); only a
    // host-supplied parameter can be non-NFC. Flagged for ruling — closing it
    // means a `.normalize()` on both sides of every comparison.
    const nfd = 'e\u0301';
    const nfc = '\u00e9';
    expect(nfd === nfc).toBe(false);
    // The interpreter: equal.
    expect(
      ce.box(['Equal', { str: nfd }, { str: nfc }]).evaluate().symbol
    ).toBe('True');
    // …and so is the compiled comparison of the two LITERALS (both NFC by the
    // time codegen sees them).
    expect(
      runCompiled(ce.box(['Equal', { str: nfd }, { str: nfc }]))
    ).toBe(true);
    // But a raw non-NFC PARAMETER value diverges.
    ce.declare('sq2', 'string');
    const r = compile(ce.box(['Equal', 'sq2', { str: nfc }]), {
      fallback: false,
    });
    expect((r.run as any)({ sq2: nfc })).toBe(true);
    expect((r.run as any)({ sq2: nfd })).toBe(false); // interpreter: True
  });
});

describe('tier 2: a UNION arm that is a collection disqualifies the scalar ===', () => {
  // REGRESSION (2026-08-08). The collection disqualifier was a SUBTYPE test
  // (`.matches('collection')` / `isPossiblyCollectionTypedJS`), and a general
  // UNION with a collection arm is not a subtype of `collection`. So
  // `Equal(uq, "a")` over `string | list<string>` was admitted and compiled to
  // a scalar `((_.uq) === ("a"))` — the WRONG SHAPE (a boolean where the
  // interpreter broadcasts to a list) and a wrong value, behind `success:
  // true`. The gate now uses the union-aware `couldBeCollectionParticipant`.

  test('a DECLARED `string | list<string>` participant declines, both heads', () => {
    ce.declare('uq', 'string | list<string>');
    for (const head of ['Equal', 'NotEqual'] as const) {
      const r = compile(ce.box([head, 'uq', { str: 'a' }] as any));
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/string-valued operands/);
    }
  });

  test('…and the interpreter it falls back to BROADCASTS (the shape a `===` cannot express)', () => {
    ce.assign('lq', ce.box(['List', { str: 'a' }, { str: 'b' }]));
    expect(
      ce.box(['Equal', 'lq', { str: 'a' }]).evaluate().toString()
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
    expect(r.error).toMatch(/string-valued operands/);
    // The interpreter's answer on the collection arm is element-wise.
    expect(
      ce.box(['Equal', ['gu', 'False'], { str: 'a' }]).evaluate().toString()
    ).toBe('["False","False","False"]');
  });

  test('the union gate does NOT narrow the settled bare-`unknown` admission', () => {
    // Ruling (a), 2026-08-08: a top-typed participant stays admitted (the
    // run-time-array residual is accepted, as on the numeric fast path). Only
    // POSITIVE union evidence disqualifies.
    ce.declare('anyq', 'unknown');
    const r = compile(ce.box(['Equal', 'anyq', { str: 'a' }]), {
      fallback: false,
    });
    expect(r.success).toBe(true);
    expect(r.code).toMatchInlineSnapshot(`"((_.anyq) === ("a"))"`);
    // …and a union with NO collection arm is admitted as well.
    ce.declare('sbq', 'string | boolean');
    const r2 = compile(ce.box(['Equal', 'sbq', { str: 'a' }]), {
      fallback: false,
    });
    expect(r2.success).toBe(true);
    expect(r2.code).toMatchInlineSnapshot(`"((_.sbq) === ("a"))"`);
  });
});

describe('tier 2: NotEqual over `string | missing` keeps the Kleene guard', () => {
  // REGRESSION (2026-08-08). The §3.F object-domain guard covered `Equal`
  // only, because every string-bearing `NotEqual` used to fail closed on the
  // string gate. Once the tier-2 scalar admission started accepting
  // `NotEqual(s, "x")` for `s: string | missing` (the LITERAL supplies the
  // string evidence, and the union is neither provably numeric nor a
  // collection), the unguarded lowering emitted `undefined !== "x"` — a bare
  // `true` where the interpreter answers `Missing`. The guard now covers both
  // heads.

  test('the interpreter is Kleene for BOTH heads', () => {
    expect(ce.box(['Equal', 'Missing', { str: 'x' }]).evaluate().symbol).toBe(
      'Missing'
    );
    expect(
      ce.box(['NotEqual', 'Missing', { str: 'x' }]).evaluate().symbol
    ).toBe('Missing');
  });

  test('the compiled NotEqual is guarded, and answers absent for an absent operand', () => {
    const e = new ComputeEngine();
    e.declare('s', 'string | missing');
    const r = compile(e.box(['NotEqual', 's', { str: 'x' }]), {
      fallback: false,
    });
    expect(r.success).toBe(true);
    // The guard, the object null, and the STRICT (not tolerance) inner.
    expect(r.code).toMatchInlineSnapshot(
      `"(((_.s === undefined) || ("x" === undefined)) ? undefined : (_.s) !== ("x"))"`
    );
    expect(r.code).not.toMatch(/Math\.abs/);
    const run = r.run as unknown as (v: {
      s: string | undefined;
    }) => boolean | undefined;
    expect(run({ s: 'y' })).toBe(true);
    expect(run({ s: 'x' })).toBe(false);
    // NOT a bare `true` — the Kleene hole, as `Equal` already did.
    expect(run({ s: undefined })).toBeUndefined();
  });

  test('a Missing-free NotEqual is not pessimized', () => {
    ce.declare('pq', 'number');
    const r = compile(ce.box(['NotEqual', 'pq', 3]), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).toMatchInlineSnapshot(`"(Math.abs((_.pq) - (3)) > 1e-10)"`);
  });
});

describe('tier 2: Characters / GraphemeClusters', () => {
  // The interpreter segments UAX #29 GRAPHEME CLUSTERS (`Intl.Segmenter`, via
  // `splitGraphemeClusters` in library/core.ts) — neither code points
  // (`[...s]`) nor UTF-16 units (`s.split('')`). `_SYS.chars` runs the same
  // segmenter, so the lowering matches observable-for-observable.

  /** [label, input, expected elements, `[...s]` length, `s.split('')` length] */
  const CASES: Array<[string, string, string[], number, number]> = [
    ['ascii', 'abc', ['a', 'b', 'c'], 3, 3],
    ['empty', '', [], 0, 0],
    // ASTRAL PLANE (U+1D11E, a surrogate pair): one element. `split('')` would
    // give two lone surrogates.
    ['astral', 'a\u{1D11E}b', ['a', '\u{1D11E}', 'b'], 3, 4],
    // A COMBINING sequence is ONE cluster, and its element is NFC-composed by
    // the interpreter's `engine.string()`. `[...s]` would give two.
    ['combining', 'e\u0301', ['\u00e9'], 2, 2],
    // A ZWJ emoji family: one cluster, five code points.
    ['zwj emoji', '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}', ['\u{1F468}\u200D\u{1F469}\u200D\u{1F467}'], 5, 8],
    // A regional-indicator flag: one cluster, TWO astral code points (so the
    // spread length is 2, not 1 — with 1 recorded here the counterexample
    // assertion below matched `expected.length` and silently skipped).
    ['flag', '\u{1F1FA}\u{1F1F8}', ['\u{1F1FA}\u{1F1F8}'], 2, 4],
    // CR LF is a single cluster.
    ['crlf', 'a\r\nb', ['a', '\r\n', 'b'], 4, 4],
  ];

  test.each(CASES)(
    '%s: compiled Characters matches the interpreter element-for-element',
    (_label, input, expected, spreadLen, splitLen) => {
      const expr = ce.box(['Characters', { str: input }]);
      // The interpreter is the reference.
      expect(expr.evaluate().ops!.map((op) => op.string)).toEqual(expected);
      const r = compile(expr, { fallback: false });
      expect(r.success).toBe(true);
      expect(r.run!()).toEqual(expected);
      // …and the two tempting one-liners would NOT have matched.
      if (expected.length !== spreadLen) expect([...input].length).toBe(spreadLen);
      if (expected.length !== splitLen)
        expect(input.split('').length).toBe(splitLen);
    }
  );

  test('the lowering is the shared runtime helper', () => {
    const r = compile(ce.box(['Characters', { str: 'abc' }]), {
      fallback: false,
    });
    expect(r.code).toMatchInlineSnapshot(`"_SYS.chars("abc")"`);
  });

  test('GraphemeClusters (the shipped synonym) lowers identically', () => {
    const expr = ce.box(['GraphemeClusters', { str: 'a\u{1D11E}b' }]);
    const r = compile(expr, { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!()).toEqual(['a', '\u{1D11E}', 'b']);
    expect(expr.evaluate().ops!.map((op) => op.string)).toEqual([
      'a',
      '\u{1D11E}',
      'b',
    ]);
  });

  test('a runtime string PARAMETER is NFC-normalized, as the interpreter is', () => {
    ce.declare('sq3', 'string');
    const r = compile(ce.box(['Characters', 'sq3']), { fallback: false });
    expect((r.run as any)({ sq3: 'e\u0301' })).toEqual(['\u00e9']);
  });

  test('Length and At compose over the compiled clusters', () => {
    const len = ce.box(['Length', ['Characters', { str: 'a\u{1D11E}b' }]]);
    const r = compile(len, { fallback: false });
    expect(r.run!()).toBe(3);
    expect(len.evaluate().re).toBe(3);
    const at = ce.box(['At', ['Characters', { str: 'a\u{1D11E}b' }], 2]);
    expect(compile(at, { fallback: false }).run!()).toBe('\u{1D11E}');
    expect(at.evaluate().string).toBe('\u{1D11E}');
  });

  test('a non-string operand fails closed', () => {
    // A NUMBER never reaches the lowering: the `(string) -> list<string>`
    // signature turns it into an `Error` node (the interpreter's
    // `incompatible-type`), which the compiler refuses outright.
    const numeric = compile(ce.box(['Characters', 123]));
    expect(numeric.success).toBe(false);
    // A bare SYMBOL operand does not exercise the gate either: the same
    // signature INFERS it `string`, which is provable evidence, so it compiles
    // — and `_SYS.chars` throws loudly if the host then supplies a non-string.
    const inferred = compile(ce.box(['Characters', 'uq']), { fallback: false });
    expect(inferred.success).toBe(true);
    expect((inferred.run as any)({ uq: 'ab' })).toEqual(['a', 'b']);
    expect(() => (inferred.run as any)({ uq: 3 })).toThrow(/expected a string/);
  });

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
    expect(r.error).toMatch(/incompatible-type|provably a string/);
  });
});

describe('tier 2: StringJoin', () => {
  // Probed interpreter semantics: VARIADIC over strings (nullary → `""`), or a
  // SINGLE finite collection of strings. A non-string operand is an
  // `incompatible-type` error, and the MIXED arity form
  // `StringJoin("a", ["b","c"])` stays INERT — the interpreter never coerces
  // (that is `String`, a different operator).

  test.each([
    ['nullary', ['StringJoin'], ''],
    ['one string', ['StringJoin', { str: 'a' }], 'a'],
    ['two strings', ['StringJoin', { str: 'a' }, { str: 'b' }], 'ab'],
    ['three strings', ['StringJoin', { str: 'a' }, { str: 'b' }, { str: 'c' }], 'abc'],
    ['a string list', ['StringJoin', ['List', { str: 'a' }, { str: 'b' }]], 'ab'],
    ['an empty list', ['StringJoin', ['List']], ''],
    ['Characters round trip', ['StringJoin', ['Characters', { str: 'a\u{1D11E}b' }]], 'a\u{1D11E}b'],
    ['Reverse of Characters', ['StringJoin', ['Reverse', ['Characters', { str: 'abc' }]]], 'cba'],
  ] as const)('%s compiles to %p, with interpreter parity', (_label, json, expected) => {
    const expr = ce.box(json as any);
    const r = compile(expr, { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!()).toBe(expected);
    expect(expr.evaluate().string).toBe(expected);
  });

  test('the result is NFC-normalized, as `engine.string()` is', () => {
    // Joining a base letter and a combining mark yields the PRECOMPOSED
    // character in the interpreter; a raw `+` would not.
    const expr = ce.box(['StringJoin', { str: 'e' }, { str: '\u0301' }]);
    expect(expr.evaluate().string).toBe('\u00e9');
    expect(compile(expr, { fallback: false }).run!()).toBe('\u00e9');
  });

  test.each([
    // These two never reach the lowering: the signature check (`(string |
    // collection<string>)*`) makes them `Error` nodes, which the compiler
    // refuses outright — the interpreter reports `incompatible-type`.
    ['a non-string operand', ['StringJoin', { str: 'a' }, 1], false],
    ['a numeric list', ['StringJoin', ['List', 1, 2]], false],
    // These type-check, so the lowering's own gate is what closes them.
    ['an unknown-typed operand', ['StringJoin', { str: 'a' }, 'uq'], true],
    // The interpreter leaves this INERT even though every leaf is a string.
    ['a string plus a string LIST', ['StringJoin', { str: 'a' }, ['List', { str: 'b' }]], true],
  ] as const)('%s fails closed', (_label, json, ownGate) => {
    const r = compile(ce.box(json as any));
    expect(r.success).toBe(false);
    if (ownGate) expect(r.error).toMatch(/StringJoin: cannot compile/);
  });

  test('the mixed arity form is INERT in the interpreter (the fallback answer)', () => {
    const expr = ce.box(['StringJoin', { str: 'a' }, ['List', { str: 'b' }]]);
    expect(expr.evaluate().operator).toBe('StringJoin');
  });
});

describe('tier 2: end-to-end — a whitespace scanner compiles and runs', () => {
  test('the skipWs program compiles (success: true) and returns 3', () => {
    // The acceptance program for the tier: a recursive scanner over a
    // `list<string>`, an INFERRED-parameter character predicate, `Length`, and
    // 1-based `cs[i]` indexing. Every piece but the string equality already
    // lowered.
    executeEpsil(
      ce,
      'isWs(c) = c == " " || c == "\\t"\n' +
        'function skipWs(cs: list<string>, i: integer) -> integer ' +
        '{ skipWs(cs, i + 1) if i <= Length(cs) && isWs(cs[i]) else i }'
    );
    const call = ce.box([
      'skipWs',
      ['List', { str: ' ' }, { str: ' ' }, { str: 'a' }],
      1,
    ]);
    // The interpreter's answer.
    expect(call.evaluate().re).toBe(3);
    const r = compile(call, { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!()).toBe(3);
  });

  test('the same scanner over Characters of a string', () => {
    executeEpsil(
      ce,
      'isWs2(c) = c == " " || c == "\\t"\n' +
        'function skipWs2(cs: list<string>, i: integer) -> integer ' +
        '{ skipWs2(cs, i + 1) if i <= Length(cs) && isWs2(cs[i]) else i }'
    );
    for (const [text, expected] of [
      ['  a', 3],
      ['a', 1],
      ['   ', 4],
      ['', 1],
    ] as const) {
      const call = ce.box([
        'skipWs2',
        ['Characters', { str: text }],
        1,
      ]);
      expect(call.evaluate().re).toBe(expected);
      const r = compile(call, { fallback: false });
      expect(r.success).toBe(true);
      expect(r.run!()).toBe(expected);
    }
  });
});

// -----------------------------------------------------------------------------
// The ordering gate reads only its OWN participants — and a participant whose
// type discriminates NOTHING is not evidence (2026-08-08).
// -----------------------------------------------------------------------------

describe('a wide index-slot union is not string evidence', () => {
  // `At`'s index slot is `boolean | indexed_collection | number | string` (a
  // gather index may be a collection, a dictionary key a string), so merely
  // INDEXING with a local — `cs[j]` — types `j` with that union, and the
  // numeric operators never narrow it back (an operand that could be a
  // collection is skipped by the threadable-operator inference in
  // `validate.ts`, Tycho item 121).
  //
  // The `string` arm then read as positive string EVIDENCE, so the wholly
  // numeric `j <= Length(cs)` next door declined as a "mixed string ordering".
  // A type that admits a string AND a number AND a boolean says no more than
  // the top type does, and `unknown` has never been evidence — see
  // `carriesNoSortEvidence` (base-compiler.ts).

  test('a numeric ordering next to an index of the same local compiles', () => {
    // The minimal mechanism: NO string comparison anywhere in this program.
    // The `list<string>` is incidental — `cs[j]` alone does it.
    executeEpsil(
      ce,
      'function scan(cs: list<string>, i: integer) -> integer {\n' +
        'let j = i\nlet c = cs[j]\nwhile j <= Length(cs) { j = j + 1 }\nj }'
    );
    const call = ce.box(['scan', ['List', { str: 'a' }, { str: 'b' }], 1]);
    expect(call.evaluate().re).toBe(3);
    const r = compile(call, { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!()).toBe(3);
  });

  test('the WHILE-loop whitespace scanner compiles and runs (annotated predicate)', () => {
    executeEpsil(
      ce,
      'isW(c: string | missing) = c == " "\n' +
        'function w2(cs: list<string>, i: integer) -> integer {\n' +
        'let j = i\nwhile j <= Length(cs) && isW(cs[j]) { j = j + 1 }\nj }'
    );
    const call = ce.box([
      'w2',
      ['List', { str: ' ' }, { str: ' ' }, { str: 'a' }],
      1,
    ]);
    expect(call.evaluate().re).toBe(3);
    const r = compile(call, { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!()).toBe(3);
  });

  test('…and with an UNANNOTATED predicate', () => {
    executeEpsil(
      ce,
      'isV(c) = c == " "\n' +
        'function w3(cs: list<string>, i: integer) -> integer {\n' +
        'let j = i\nwhile j <= Length(cs) && isV(cs[j]) { j = j + 1 }\nj }'
    );
    for (const [text, expected] of [
      ['  a', 3],
      ['a', 1],
      ['   ', 4],
      ['', 1],
    ] as const) {
      const call = ce.box(['w3', ['Characters', { str: text }], 1]);
      expect(call.evaluate().re).toBe(expected);
      const r = compile(call, { fallback: false });
      expect(r.success).toBe(true);
      expect(r.run!()).toBe(expected);
    }
  });

  test('the `skipWs` of the Epsil examples compiles in its natural while-form', () => {
    // Verbatim from `src/epsil/docs/examples.md` (the JSON-parser program).
    executeEpsil(
      ce,
      'isWs(c: string | missing) = c == " " || c == "\\n" || c == "\\t" || c == "\\r"\n' +
        'function skipWs(cs: list<string>, i: integer) -> integer {\n' +
        '  let j = i\n' +
        '  while j <= Length(cs) && isWs(cs[j]) { j = j + 1 }\n' +
        '  j\n' +
        '}'
    );
    const call = ce.box(['skipWs', ['Characters', { str: '  ab' }], 1]);
    expect(call.evaluate().re).toBe(3);
    const r = compile(call, { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!()).toBe(3);
  });

  test('the `parseDigits` loop condition compiles; only its IndexOf still closes it', () => {
    // `parseDigits` (same program) is the tuple-returning digit scanner. Its
    // guard `j <= Length(cs) && isDigit(cs[j])` is the shape fixed here, and it
    // compiles — shown by the same body with the digit decode replaced. The
    // real one still declines, on the SEPARATE and deliberate tier-0 closure of
    // `IndexOf` over string evidence ("IndexOf with a string needle declines",
    // above); relaxing that gate is its own decision.
    executeEpsil(
      ce,
      'let digits = Characters("0123456789")\n' +
        'isDigit(c: string | missing) = c in digits\n' +
        'function countDigits(cs: list<string>, i: integer) -> tuple<integer, integer> {\n' +
        '  let j = i\n  let n = 0\n' +
        '  while j <= Length(cs) && isDigit(cs[j]) { n = n + 1\n j = j + 1 }\n' +
        '  (n, j)\n}\n' +
        'function parseDigits(cs: list<string>, i: integer) -> tuple<integer, integer> {\n' +
        '  let j = i\n  let n = 0\n' +
        '  while j <= Length(cs) && isDigit(cs[j]) {\n' +
        '    n = 10 * n + IndexOf(digits, cs[j]) - 1\n    j = j + 1\n  }\n' +
        '  (n, j)\n}'
    );
    // `constantFold: false` on both compiles: the argument is a literal
    // string, so each call would otherwise be evaluated at compile time and
    // emitted as a literal pair — the loop lowering and the `IndexOf` decline
    // this test is about would never be exercised.
    const ok = compile(ce.box(['countDigits', ['Characters', { str: '12a' }], 1]), {
      fallback: false,
      constantFold: false,
    });
    expect(ok.success).toBe(true);
    expect(ok.run!()).toEqual([2, 3]);

    const closed = compile(
      ce.box(['parseDigits', ['Characters', { str: '12a' }], 1]),
      { constantFold: false }
    );
    expect(closed.success).toBe(false);
    expect(closed.error).toMatch(/IndexOf: cannot compile/);
    // …and the interpreter, which `compile()` falls back to, answers.
    expect(
      ce.box(['parseDigits', ['Characters', { str: '12a' }], 1]).evaluate().toString()
    ).toBe('(12, 3)');
  });

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
      expect(r.error).toMatch(/mixes a string operand/);
    }
    // The broadcast-route gate is untouched.
    expect(compile(ce.box(['Less', { str: 'a' }, ['List', 1, 2]])).success).toBe(
      false
    );
  });

  test('a user’s deliberate three-sort union is still evidence and declines', () => {
    // The exemption is for the four-armed INFERENCE ARTIFACT (`At`'s index
    // slot), which always carries an `indexed_collection` arm. A hand-written
    // `string | number | boolean` is a real possibility of a string at run
    // time: the interpreter leaves `wq < 1` INERT, whereas a compiled
    // `_.wq < 1` would coerce and answer a plausible-looking boolean.
    for (const type of [
      'string | number | boolean',
      // …and the same three sorts plus a non-collection arm.
      'string | number | boolean | missing',
    ] as const) {
      ce = new ComputeEngine();
      ce.declare('wq', type);
      const expr = ce.box(['Less', 'wq', 1]);
      const r = compile(expr);
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/mixes a string operand/);
      // The interpreter's answer: an inert comparison, not a boolean.
      expect(expr.evaluate().operator).toBe('Less');
    }
  });

  test('the four-sort At-shape union stays exempt, hand-written included', () => {
    // The artifact and a deliberate spelling of it are indistinguishable by
    // construction, so a hand-written one is exempt too — a type admitting
    // every scalar sort AND every indexed collection is the top type in all
    // but name, and `unknown` has never been evidence either.
    ce.declare('wq4', 'boolean | indexed_collection | number | string');
    const r = compile(ce.box(['Less', 'wq4', 1]), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).toMatchInlineSnapshot(`"_.wq4 < 1"`);
  });

  test('`Length` of a string list is an integer, and carries no evidence either way', () => {
    // The negative control for the mechanism: an APPLICATION is typed by what
    // it RETURNS, never by what it consumes. `Length(sl)` over a `list<string>`
    // is an `integer`, so a numeric ordering against it compiles — and a
    // STRING opposite it is still the mixed pair, which declines.
    ce.declare('sl', 'list<string>');
    expect(ce.box(['Length', 'sl']).type.toString()).toBe('integer');
    const numeric = compile(ce.box(['Less', 1, ['Length', 'sl']]), {
      fallback: false,
    });
    expect(numeric.success).toBe(true);
    const mixed = compile(ce.box(['Less', { str: 'a' }, ['Length', 'sl']]));
    expect(mixed.success).toBe(false);
    expect(mixed.error).toMatch(/mixes a string operand/);
  });
});

/**
 * String-typed COMPARISONS fail closed (D6) in the JavaScript compile target.
 *
 * The comparison lowerings in `javascript-target.ts` are numeric. Equality is
 * `Math.abs(a - b) <= tol`, which for strings is `NaN <= tol` — so a compiled
 * `"a" == "a"` answered `false` where the interpreter answers `True`, a wrong
 * answer behind a `success: true`. `IndexOf` used the same tolerance test, so a
 * string needle was never "found" (0 instead of the interpreter's 1-based
 * index).
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
 * Equality and `IndexOf` stay fully closed on any string evidence: string
 * equality was never correct compiled, so admitting it is a separate tier.
 *
 * Declining means `compile()` reports `success: false` and falls back to the
 * interpreter, which answers correctly.
 *
 * The gate keys on PROVABLE string evidence (`isString` or
 * `isSubtype(type, 'string')`), never on `.matches('string')` — an
 * `unknown`-typed symbol must NOT gate, or plot equalities such as
 * `x^2 + y^2 = 4` would stop compiling.
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
  expect(compile(expr).success).toBe(false);
  expect(expr.evaluate().toString()).toBe(expected);
}

describe('string comparisons fail closed (D6)', () => {
  test('Equal over two string literals declines', () => {
    failsClosed(ce.box(['Equal', { str: 'a' }, { str: 'a' }]), '"True"');
  });

  test('NotEqual over two string literals declines', () => {
    failsClosed(ce.box(['NotEqual', { str: 'a' }, { str: 'b' }]), '"True"');
  });

  test('Equal over a string-annotated parameter declines', () => {
    // Before the gate this compiled to `Math.abs("a" - "a") <= 1e-10` and ran
    // to 0, while the interpreter answers 1.
    executeEpsil(ce, 'g(s: string) = 1 if s == "a" else 0');
    const expr = ce.box(['g', { str: 'a' }]);
    expect(compile(expr).success).toBe(false);
    expect(expr.evaluate().toString()).toBe('1');
  });

  test('IndexOf with a string needle declines', () => {
    // Before the gate this ran to 0 (the tolerance test is NaN for strings)
    // while the interpreter answers the 1-based index 2.
    const expr = ce.box([
      'IndexOf',
      ['List', { str: 'a' }, { str: 'b' }],
      { str: 'b' },
    ]);
    expect(compile(expr).success).toBe(false);
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

  describe('equality over a string COLLECTION fails closed', () => {
    // Wrong answers before the gate: `_SYS.eq` compares elements with the
    // numeric tolerance test, so two EQUAL string lists answered `false` where
    // the interpreter answers `True` (and `NotEqual` answered `true` for
    // `False`). No scalar operand is provably string here, so the operand-level
    // `assertNoStringOperand` let it through.
    test.each([
      ['Equal over two equal string lists', ['Equal', ['List', { str: 'a' }, { str: 'b' }], ['List', { str: 'a' }, { str: 'b' }]], '"True"'],
      ['NotEqual over two equal string lists', ['NotEqual', ['List', { str: 'a' }, { str: 'b' }], ['List', { str: 'a' }, { str: 'b' }]], '"False"'],
      ['Equal over two differing string lists', ['Equal', ['List', { str: 'a' }], ['List', { str: 'c' }]], '"False"'],
      ['Equal of a string list against a number', ['Equal', ['List', { str: 'a' }, { str: 'b' }], 1], '["False","False"]'],
    ] as const)('%s declines', (_label, json, expected) => {
      failsClosed(ce.box(json as any), expected);
    });

    // String evidence is looked for RECURSIVELY through the type structure: a
    // single peel of the element type misses both of these, and both ran to
    // `false` behind a `success: true` where the interpreter answers `True`.
    test.each([
      // One peel yields `list<string>`, which is not a subtype of `string`.
      ['a NESTED string list', ['Equal', ['List', ['List', { str: 'a' }]], ['List', ['List', { str: 'a' }]]], '"True"'],
      // The widened element type (`number | string`) is not WHOLLY string, but
      // the string union member still puts strings on the numeric path.
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
      const r = compile(expr);
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
  // tuple-typed (`isProvablyTupleParticipant`). Orderings never consult it.

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

  test('a tuple with a STRING component still declines — the string gate runs after', () => {
    // Gate ORDER: the tuple admission only skips `assertComparableAggregate`;
    // `assertNoStringOperand` runs unconditionally afterwards, and
    // `typeHasStringEvidence` peels `tuple<integer, string>` to the union
    // `integer | string`. `_SYS.eq`'s tolerance test is NaN on the string
    // component, so it would answer `false` where the interpreter answers `True`.
    const T = ['Tuple', 1, { str: 'a' }];
    for (const [head, expected] of [
      ['Equal', '"True"'],
      ['NotEqual', '"False"'],
    ] as const) {
      const expr = ce.box([head, T, T] as any);
      const r = compile(expr);
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/string-valued operands/);
      expect(expr.evaluate().toString()).toBe(expected);
    }
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
    expect(compile(expr).success).toBe(false);
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

  test.each([1, 8, 9, 12, 20])(
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

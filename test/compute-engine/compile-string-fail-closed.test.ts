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

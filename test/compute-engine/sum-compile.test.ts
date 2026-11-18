import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

import type { MathJsonExpression } from '../../src/math-json/types';

//
// COMPILING SUM TYPES — `docs/plans/2026-08-12-sum-type-sugar-and-
// compilation.md` Part B, amending D11 of
// `docs/TYPE-SYSTEM.md`
//
// **The tag is erased iff it is statically discharged.** A product discharges
// its tag at type-check time and erases (D11, unchanged — pinned by
// `type-constructors-compile.test.ts`). A SUM's tag is runtime data as soon as
// `match` branches on it, so the policy is decided per sum, at compile time,
// from its variants' erased JS representations (§B1):
//
//   - all pairwise DISJOINT → ERASED: the JS value IS the tag, constructors
//     keep the D11 erasure, and `match` lowers to representation tests
//     (`s === null`, `typeof s === 'number'`, `Array.isArray(s)`);
//   - otherwise → TAGGED: constructors emit `{ _tag: 'plus', _ops: [a, b] }`
//     and `match` tests `_tag`, reading captures out of `_ops`.
//
// Scope is SUGAR-declared sums (the ones carrying `_sumOf`/`_sumVariants`).
// A hand-assembled union of nominals has no sum identity to key a policy on
// and keeps today's behavior exactly: erased constructors, constructor-pattern
// `match` failing closed.
//

/** An engine with `src` executed, asserting it declared cleanly. */
function engine(src: string): ComputeEngine {
  const ce = new ComputeEngine();
  const result = executeEpsil(ce, src);
  expect(result.diagnostics.map((d) => String(d.message))).toEqual([]);
  return ce;
}

/** The AST sum of the roadmap's `ev` example: three variants, two of which
 * (`plus`/`times`) share a two-element tuple representation — so the sum is
 * TAGGED. */
const AST =
  'type node = lit(num: number) | plus(op1: node, op2: node) | times(op1: node, op2: node)';

describe('§B2 — the engine⇄compiled boundary', () => {
  test('a unit whose RESULT is a tagged sum value declines', () => {
    const ce = engine(AST);
    const expr = ce.box(['plus', ['lit', 1], ['lit', 2]] as MathJsonExpression);
    expect(() => compile(expr, { fallback: false })).toThrow(
      /Could not compile/
    );
    const r = compile(expr);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Could not compile/);
  });

  test('a tagged sum inside a compound result declines too', () => {
    const ce = engine(AST);
    expect(() =>
      compile(ce.box(['List', ['lit', 1], ['lit', 2]] as MathJsonExpression), {
        fallback: false,
      })
    ).toThrow(/Could not compile/);
  });

  test('a tagged sum inside a `set` result declines too', () => {
    // The boundary walk enumerates every CONTAINER kind: a kind it fails to
    // enumerate falls to the default and lets a `{_tag}` value escape.
    const ce = engine(AST);
    const e = ce.box(['Set', ['lit', 1], ['lit', 2]] as MathJsonExpression);
    expect(e.type.toString()).toBe('set<lit>');
    expect(() => compile(e, { fallback: false })).toThrow(
      /Could not compile/
    );
  });
});

describe('§B2 — field access on a variant value', () => {

  test('a TAGGED variant field declines on every non-JS target', () => {
    const ce = engine(AST);
    const e = ce.box([
      'Field',
      ['lit', 7],
      { str: 'num' },
    ] as MathJsonExpression);
    for (const to of ['glsl'] as const)
      expect(() =>
        compile(e, { to, fallback: false, constantFold: false })
      ).toThrow(/Could not compile/);
  });
});

describe('fail closed — out-of-scope targets and non-sugar nominals', () => {
  test('a NON-LINEAR constructor pattern fails closed', () => {
    // `plus(a, a)` binds `a` twice: the interpreter's generic matcher UNIFIES
    // the two occurrences, so the arm is taken only when the payloads are
    // equal. There is no representation-independent equality the lowering
    // could emit (a payload may be a number, a string, an array, a `{re, im}`
    // or a `{_tag, _ops}`), so the compiler fails closed rather than dropping
    // the condition and matching `plus(1, 2)` — the same posture tier 2 takes
    // on a repeated binding (`hasRepeatedKeys`).
    const ce = engine(AST);
    ce.declare('n', 'node');
    expect(() =>
      compile(
        ce.box([
          'Match',
          'n',
          ['MatchCase', ['plus', '_a', '_a'], 1],
          ['MatchCase', '_', 0],
        ] as MathJsonExpression),
        { fallback: false }
      )
    ).toThrow(/Could not compile/);

    // The interpreter's answers — which a compiled unit must never contradict.
    const interp = (a: number, b: number) =>
      ce
        .box([
          'Match',
          ['plus', ['lit', a], ['lit', b]],
          ['MatchCase', ['plus', '_x', '_x'], 1],
          ['MatchCase', '_', 0],
        ] as MathJsonExpression)
        .evaluate().re;
    expect(interp(1, 2)).toBe(0);
    expect(interp(2, 2)).toBe(1);
  });

  test('a capture-binding ALTERNATIVE is rejected before the sum tier', () => {
    // Why the alternation loop can share one `accessors` map across arms
    // without an arm overwriting another's slot: a name-binding alternative
    // never reaches the sum tier at all — the match plan rejects it upstream.
    // Only capture-FREE alternatives (`plus(_, _) | times(_, _)`) get here.
    const ce = engine(AST);
    ce.declare('n', 'node');
    expect(() =>
      compile(
        ce.box([
          'Match',
          'n',
          [
            'MatchCase',
            ['Alternatives', ['plus', '_a', '_'], ['times', '_a', '_']],
            'a',
          ],
          ['MatchCase', '_', -1],
        ] as MathJsonExpression),
        { fallback: false }
      )
    ).toThrow(/Could not compile/);
  });

  test('a NON-SUGAR nominal constructor pattern still fails closed', () => {
    // No `_sumOf` record → no sum identity → the tier-3 fail-closed throw,
    // exactly as before Part B (`match-compile.test.ts`'s operator-pattern pin
    // is the same shape).
    const ce = new ComputeEngine();
    ce.declareType('meters', 'number');
    ce.declare('x', 'number');
    expect(() =>
      compile(
        ce.box([
          'Match',
          'x',
          ['MatchCase', ['meters', '_a'], 'a'],
          ['MatchCase', '_', 0],
        ] as MathJsonExpression),
        { fallback: false }
      )
    ).toThrow(/Could not compile/);
  });

  test('a HAND-ASSEMBLED union of nominals has no sum identity', () => {
    // The manual desugaring, minus the sugar: `declareSumType` is the sole
    // writer of `_sumOf`, so the policy never applies and `match` fails closed.
    const ce = engine(`
      type a = nothing
      type b = nothing
      type alias u = a | b
    `);
    ce.declare('v', 'u');
    expect(() =>
      compile(
        ce.box([
          'Match',
          'v',
          ['MatchCase', ['a'], 1],
          ['MatchCase', '_', 0],
        ] as MathJsonExpression),
        { fallback: false }
      )
    ).toThrow(/Could not compile/);
  });

  test('the GPU targets decline a constructor-pattern match', () => {
    const ce = engine(AST);
    ce.declare('n', 'node');
    const m = ce.box([
      'Match',
      'n',
      ['MatchCase', ['lit', '_v'], 'v'],
      ['MatchCase', '_', 0],
    ] as MathJsonExpression);
    for (const to of ['glsl'] as const)
      expect(() => compile(m, { to, fallback: false })).toThrow(
        /Could not compile/
      );
  });
});


import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// Tycho item 121: the js compile of a Sum whose terms are list-valued emitted
// plain scalar `+`/`*` over arrays (string concatenation / NaN) behind
// `success: true`. Root cause: numeric-argument validation
// (`checkNumericArgs`) inferred the scalar numeric context (`real`) onto a
// possibly-collection operand — `a(i·t)` with inferred result signature
// `vector<2>` — WIDENING the shared definition to
// `real | vector<…>`. Every function defined afterwards whose body called `a`
// then inferred a scalar result, and the compiled Sum took the unrolled
// scalar arm instead of the element-wise `_SYS.bcast` fold.
//
// The corruption was definition-order-dependent: it required a pre-existing
// global binding for the parameter name (any earlier parse mentioning free
// `t`), which forces the definition's binder rewrite to REBUILD the body
// canonically, re-running numeric validation on already-typed operands.

// The pipeline's reasons for declining a call of a function whose body gives
// a list where its declaration or its position needs a scalar.
const PIPELINE_DECLINE =
  /a body of [ab] that is not a scalar or a point of numbers|is not the library operator here \(a user definition\)|a list where a scalar is required/;

describe('list-valued function applications keep their signature under numeric use (item 121)', () => {
  test('a prior parse of the free parameter name does not widen the callee signature', () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'real');
    ce.parse('a(t)\\coloneq\\left[\\cos t,\\sin t\\right]').evaluate();
    // Creates a global inferred `t` — the poison that forced the binder
    // rewrite of B's body.
    ce.parse('2t');
    ce.parse('B(t)\\coloneq\\sum_{i=0}^{6}\\frac{1}{1.4^i}a(it)').evaluate();
    const a: any = ce.lookupDefinition('a');
    const B: any = ce.lookupDefinition('B');
    expect(a?.operator?.signature?.toString()).toEqual(
      '(t: unknown) -> vector<2>'
    );
    expect(B?.operator?.signature?.toString()).toEqual(
      '(t: unknown) -> vector<2>'
    );
  });

  test('scalar numeric inference is not disturbed by the guard', () => {
    const ce = new ComputeEngine();
    // An unknown symbol in numeric context is still consumed as a number
    // (the guard exempts only possibly-collection operands).
    expect(ce.parse('2q_a').type.toString()).toEqual('number');
    // A scalar-valued application still narrows its inferred result.
    ce.parse('f(t)\\coloneq t^2+1').evaluate();
    ce.parse('2f(3)').evaluate();
    const f: any = ce.lookupDefinition('f');
    expect(f?.operator?.signature?.toString()).not.toContain('vector');
  });
});

// Tycho item 121, residue re-filed 2026-08-10 with a standalone witness
// (`Σ_{i=0}^{2} "ab"`). Two independent mechanisms let a big op ship a
// non-number behind `success: true`:
//
//  1. `Add`/`Multiply` reject a non-numeric operand at BOX time — the operand
//     is replaced by an `Error(incompatible-type)` node and the compiler's
//     `isValid` guard declines. A big-op BODY stays raw, so nothing re-ran
//     that check before the emitters wrote a bare `+`/`*` over it.
//  2. `canonicalBigop`/`reduceBigOp` rewrote ANY collection-valued body to the
//     no-index collection-reduce form (`Reduce(body, Add, 0)`), discarding the
//     indexing set — which is how a body reached the emitters with its index
//     unbound.
describe('big-op bodies that cannot accumulate numerically (item 121 residue)', () => {
  // `fallback: true` is the shape the consumers use: the throw is converted
  // to `success: false` plus an interpreter-backed `run()`.
  const jsCompile = (ce: ComputeEngine, expr: any, opts: any = {}) =>
    compile(expr, { fallback: true, ...opts });

  test('a string-valued body DECLINES instead of emitting JS `+`', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['Sum', { str: 'ab' }, ['Limits', 'i', 0, 2]]);
    // The type checker already knows: the interpreter says so.
    expect(expr.evaluate().toString()).toMatch(/incompatible-type/);
    const r = jsCompile(ce, expr);
    expect(r?.success ?? false).toBe(false);
  });

  test('both Sum lowerings and Product decline (unrolled, looped, Product)', () => {
    const ce = new ComputeEngine();
    for (const latex of [
      '\\sum_{i=0}^{2}\\text{ab}', // unrolled: constant bounds
      '\\sum_{i=0}^{n}\\text{ab}', // looped: symbolic upper bound
      '\\prod_{i=0}^{2}\\text{ab}',
    ]) {
      const r = jsCompile(ce, ce.parse(latex, { strict: false }));
      expect(r?.success ?? false).toBe(false);
    }
  });

  test('a string-valued body never runs to a concatenated string', () => {
    // `Σ_{i=0}^{2} "ab"` used to compile to `("ab") + ("ab") + ("ab")` and run
    // to "ababab" behind `success: true`, where a caller reading the result as
    // a number gets nonsense. It declines instead.
    const ce = new ComputeEngine();
    const r = jsCompile(
      ce,
      ce.box(['Sum', { str: 'ab' }, ['Limits', 'i', 0, 2]])
    );
    expect(r?.success ?? false).toBe(false);
  });

  test('an indexed Sum keeps its indexing set over a collection-valued body', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['Sum', ['List', 'k', 2], ['Limits', 'k', 0, 2]]);
    // Was `Reduce(List(k, 2), Add, 0)` — the range gone, `k` leaking out free.
    expect(expr.operator).toEqual('Sum');
    expect(expr.evaluate().toString()).toEqual('[3,6]');
    // The literal-list body now agrees with the list-valued CALL spelling,
    // which took the index loop all along.
    const ce2 = new ComputeEngine();
    ce2
      .parse('a(t)\\coloneq\\lbrack t,2t\\rbrack', { strict: false })
      .evaluate();
    expect(
      ce2.parse('\\sum_{k=0}^{2}a(k)', { strict: false }).evaluate().toString()
    ).toEqual('[3,6]');
  });

  test('the no-index collection-reduce form is unchanged', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Sum', ['List', 1, 2, 3]]).evaluate().re).toEqual(6);
    expect(ce.box(['Product', ['List', 1, 2, 3, 4]]).evaluate().re).toEqual(24);
  });
});

// Tycho item 171: the same defect, reached through the OTHER gate. A
// list-valued user function applied to a NESTED user-function call —
// `Σ_{i=0}^{2} a(h(i))` with `a(t) = [cos t, sin t]` — types
// `broadcastable<unknown>` (the lift wrapper fires because the argument `h(i)`
// is possibly-collection-typed, and `unknown` is `a`'s DECLARED result under
// the open `(unknown) -> unknown` head the consumers register). The JS
// element-wise gate's broadcastable arm then reasoned "no operand is
// collection-ish, so the lift cannot fire and the result is the plain scalar
// `T`" — sound for a BUILTIN broadcastable operator, whose base signature is
// scalar → scalar by definition of the lift, but not for a user function whose
// body returns a `List`. The body took the scalar accumulation arm and JS `+`
// concatenated the arrays: `run()` answered the STRING
// "1,00.5403…,0.8414…-0.4161…,0.9092…" behind `success: true`.
//
// The type-`unknown` spellings of the same shape (`Σ_i a(i)`, `Σ_i a(t+i)` —
// no nested call, so no lift wrapper) went through the gate's unknown arm,
// which already applied the item-86 look-through and declined on the `List`
// body, taking the element-wise `_SYS.bcast` fold. The nested-call spelling
// now matches them exactly.
describe('a list-valued call inside a big-op body is element-wise, not scalar (item 171)', () => {

  test('a provably-scalar user function in the same position stays scalar', () => {
    // The look-through must still ADMIT the scalar case: `g(t) = 2t+1` under
    // the same open head and the same nested-call argument keeps the bare
    // scalar accumulation (no `_SYS.bcast` fold), and answers a number.
    const ce = new ComputeEngine();
    ce.declare('t', 'real');
    for (const id of ['h', 'g', 'G'])
      ce.declare(id, { signature: '(unknown) -> unknown' });
    ce.assign('h', ce.box(['Function', ['Block', 'i'], 'i']));
    ce.assign(
      'g',
      ce.box(['Function', ['Block', ['Add', ['Multiply', 2, 't'], 1]], 't'])
    );
    ce.assign(
      'G',
      ce.box([
        'Function',
        ['Block', ['Sum', ['g', ['h', 'i']], ['Limits', 'i', 0, 2]]],
        't',
      ])
    );
    const r = compile(ce.parse('G(t)', { strict: false }), { fallback: true });
    expect(r?.success).toBe(true);
    expect((r as any).run({ t: 0.3 })).toBeCloseTo(9, 10); // 1 + 3 + 5
  });
});

// Tycho item 171, residue on the NON-JS targets (2026-08-12). The JS fix above
// routes the shape into the element-wise `_SYS.bcast` fold, but GLSL
// and interval-js call `BaseCompiler.assertScalarBigOpBody` directly and
// have NO element-wise arm — correct emission is not on the table there, so the
// only sound answer is to decline (D6).
//
// They were admitting it: `assertScalarBigOpBody`'s first clause declines a
// body whose DECLARED type matches `list`/`indexed_collection`, but under the
// consumers' open `(unknown) -> unknown` head the body types
// `broadcastable<unknown>` and rode the two documented item-121 EXEMPTIONS
// (top types and `broadcastable<T>` stay admitted) straight into the scalar
// accumulation. GLSL emitted, behind `success: true`:
//
//     vec2 _fn_a(float t) { return vec2(cos(t), sin(t)); }
//     float _fn_A(float t) {
//       return ((_fn_a(_fn_h(0.0))) + (_fn_a(_fn_h(1.0))) + (_fn_a(_fn_h(2.0))));
//     }
//
// — a `vec2` sum returned from a `float` function, i.e. shader source that does
// not even compile.
//
// The fix is a third clause on `assertScalarBigOpBody`
// (`isCollectionValuedBigOpBodyByLookThrough`), sharing the JS look-through's
// mechanism: it fires ONLY where an exemption is doing the admitting, and ONLY
// on POSITIVE evidence — the operator names a user function whose
// `Function`-literal body has a type that MATCHES a collection. Absence of
// evidence stays admitted, per the item-121 closure.
describe('list-valued big-op bodies on the non-JS targets (item 171 residue)', () => {
  const NON_JS = ['glsl', 'interval-js'] as const;

  const setup = (hBody: any = 'i') => {
    const ce = new ComputeEngine();
    for (const id of ['h', 'a', 'A'])
      ce.declare(id, { signature: '(unknown) -> unknown' });
    ce.assign('h', ce.box(['Function', ['Block', hBody], 'i']));
    ce.assign(
      'a',
      ce.box(['Function', ['Block', ['List', ['Cos', 't'], ['Sin', 't']]], 't'])
    );
    ce.assign(
      'A',
      ce.box([
        'Function',
        ['Block', ['Sum', ['a', ['h', 'i']], ['Limits', 'i', 0, 2]]],
        't',
      ])
    );
    return ce;
  };

  // `constantFold: false` on every probe in this block: the Sum has no free
  // variables, so compile-time constant folding would answer it from the
  // interpreter and emit a literal list, bypassing the static decline (and, on
  // JavaScript, the element-wise `_SYS.bcast` emission) under test.
  // The IR compiler has an element-wise arm on these targets too (CE-1470):
  // the loop carries a list accumulator (a `vec2` on GLSL), and the sum is
  // the interpreter's `[cos 0 + cos 1 + cos 2, sin 0 + sin 1 + sin 2]`. The
  // GLSL value is checked in WebGL2 in `ir-sum-list-terms.test.ts`.
  const sumOfA = (ce: ComputeEngine) =>
    ce.box(['Sum', ['a', ['h', 'i']], ['Limits', 'i', 0, 2]]);
  const expected = (ce: ComputeEngine) =>
    sumOfA(ce)
      .evaluate()
      .N()
      .ops!.map((x) => x.re);
  const contains = (got: any, want: number[]) =>
    got.length === want.length &&
    got.every(
      (b: any, k: number) => b.value.lo <= want[k] && want[k] <= b.value.hi
    );

  test.each(NON_JS)(
    '%s compiles `Sum a(h(i))` (direct form) with the interpreter’s value',
    (to) => {
      const ce = setup();
      const r = compile(sumOfA(ce), {
        to,
        fallback: false,
        constantFold: false,
      } as any);
      expect(r?.success).toBe(true);
      if (to === 'interval-js')
        expect(contains((r as any).run({}), expected(ce))).toBe(true);
      else expect(r.code).toMatch(/vec2 \w+ = vec2\(0\.0, 0\.0\);/);
    }
  );

  test.each(NON_JS)('%s compiles the `A(t)` wrapper form', (to) => {
    // `t` has no type: the input declines (R1, `untyped-input`), now that
    // the sum compiles; declared `real`, the call compiles. `A`'s body
    // ignores `t`, so the Sum subtree is still constant: fold off.
    const untyped = setup();
    const r = compile(untyped.parse('A(t)', { strict: false }), {
      to,
      fallback: true,
      constantFold: false,
    } as any);
    expect(r?.success ?? false).toBe(false);
    expect((r as any).diagnostic?.code).toBe('untyped-input');
    expect((r as any).unsupported).toEqual(['t']);

    const ce = setup();
    ce.declare('t', 'real');
    const typed = compile(ce.parse('A(t)', { strict: false }), {
      to,
      fallback: false,
      constantFold: false,
    } as any);
    expect(typed?.success).toBe(true);
    if (to === 'interval-js')
      expect(
        contains((typed as any).run({ t: { lo: 0.5, hi: 0.5 } }), expected(ce))
      ).toBe(true);
  });

  test.each(['javascript', ...NON_JS] as const)(
    '%s still compiles a wide-typed (possibly broadcastable) big-op body',
    (to) => {
      const ce = new ComputeEngine();
      ce.declare('b', 'unknown');
      const r = compile(
        ce.box(['Sum', ['Multiply', 2, 'b'], ['Limits', 'i', 0, 2]]),
        { to, fallback: true } as any
      );
      expect(r?.success).toBe(true);
    }
  );

  test.each(['javascript', 'glsl', 'interval-js'] as const)(
    '%s still compiles a wide-declared user helper whose body is SCALAR',
    (to) => {
      // The shader idiom the `broadcastable<T>` exemption exists for: an open
      // `(unknown) -> unknown` helper that is scalar at run time. Only the
      // collection-constructing body is new evidence.
      const ce = new ComputeEngine();
      ce.declare('q', { signature: '(unknown) -> unknown' });
      ce.assign(
        'q',
        ce.box(['Function', ['Block', ['Add', ['Multiply', 2, 'x'], 1]], 'x'])
      );
      const r = compile(ce.box(['Sum', ['q', 'i'], ['Limits', 'i', 0, 2]]), {
        to,
        fallback: true,
      } as any);
      expect(r?.success).toBe(true);
    }
  );
});

// Tycho item 171, last residue — the LYING declaration (2026-08-12 ruling).
// `ce.declare('a', { signature: '(number) -> number' })` claims a SCALAR result,
// then `ce.assign` gives it a body that constructs a `List`. The declaration was
// trusted on every target, and every target emitted garbage behind
// `success: true`:
//
//   javascript  `((_fn_a(0)) + (_fn_a(1)) + (_fn_a(2)))` → the STRING
//               "1,00.5403…,0.8414…-0.4161…,0.9092…" (JS `+` over arrays)
//   glsl        the same shape → a `vec2` sum returned from a `float` function,
//               i.e. shader source that does not even compile
//   interval-js declined for an unrelated reason (no `List` lowering)
//
// The assignment of a list-constructing body to `a`, declared
// `(number) -> number`, is refused when it is made: the type of the body's
// value has no value in common with the declared result.
//
// The compiler still declines a call of `a` when the body reaches the list
// through a call of a function that is assigned after `a`
// (`a := t ↦ h(t)`, then `h := t ↦ [cos t, sin t]`). At the assignment of `a`
// the type of `h(t)` is not known, so the assignment is accepted. The
// compiler then proves that the body constructs a collection, and declines
// on all targets, JavaScript included. The ruled item-121 exemptions are not
// affected, because `matches('number')` is disjoint from every one of them.
// Tycho ledger row 491.
describe('a declaration contradicted by its body is refused, or declines everywhere through a helper assigned later (2026-08-12 ruling)', () => {
  const ALL = ['javascript', 'glsl', 'interval-js'] as const;

  test('the assignment of a list-constructing body is refused', () => {
    const ce = new ComputeEngine();
    ce.declare('a', { signature: '(number) -> number' });
    expect(() =>
      ce.assign(
        'a',
        ce.box([
          'Function',
          ['Block', ['List', ['Cos', 't'], ['Sin', 't']]],
          't',
        ])
      )
    ).toThrow(/is not compatible with the type/);
  });

  /** `a` DECLARED scalar, ASSIGNED a body that calls `h`, and `h` then
   * ASSIGNED a list-constructing body. */
  const lying = () => {
    const ce = new ComputeEngine();
    ce.declare('a', { signature: '(number) -> number' });
    ce.assign('a', ce.box(['Function', ['h', 't'], 't']));
    ce.assign(
      'h',
      ce.box(['Function', ['List', ['Cos', 't'], ['Sin', 't']], 't'])
    );
    return ce;
  };

  // `constantFold: false` on the probes below: every one of these Sums has no
  // free variables, so compile-time constant folding would answer it from the
  // interpreter and report success with a literal, short-circuiting both the
  // decline being pinned and the `_SYS.bcast` emission of the controls.
  test('every target declines the Sum when the list comes from a function assigned later', () => {
    for (const to of ALL) {
      const r = compile(
        lying().box(['Sum', ['a', 'i'], ['Limits', 'i', 0, 2]]),
        { to, fallback: true, constantFold: false } as any
      );
      expect([to, r?.success ?? false]).toEqual([to, false]);
      // The GLSL fragment refuses the Sum of a list before the emitter runs.
      if (to === 'glsl') {
        expect((r as any).diagnostic?.code).toBe('outside-profile');
        continue;
      }
      // The interval mode has no body of `a` whose result has no stated type.
      if (to === 'interval-js') {
        expect((r as any).diagnostic?.code).toBe('outside-profile');
        expect((r as any).diagnostic?.operator).toBe('Function');
        continue;
      }
      expect((r as any).error).toMatch(PIPELINE_DECLINE);
    }
  });

  test('every JS lowering declines: unrolled, looped, Product', () => {
    const ce = lying();
    ce.declare('n', 'number');
    for (const expr of [
      ce.box(['Sum', ['a', 'i'], ['Limits', 'i', 0, 2]]), // unrolled
      ce.box(['Sum', ['a', 'i'], ['Limits', 'i', 0, 'n']]), // looped
      ce.box(['Product', ['a', 'i'], ['Limits', 'i', 0, 2]]),
    ]) {
      const r = compile(expr, {
        fallback: true,
        constantFold: false,
      } as any);
      expect(r?.success ?? false).toBe(false);
      expect((r as any).error).toMatch(PIPELINE_DECLINE);
    }
  });

  // A TRUTHFUL `-> number` head over a scalar body is the ordinary case and
  // must keep compiling.
  test.each(['javascript', 'glsl', 'interval-js'] as const)(
    '%s still compiles a TRUTHFUL `-> number` scalar body',
    (to) => {
      const ce = new ComputeEngine();
      ce.declare('a', { signature: '(number) -> number' });
      ce.assign(
        'a',
        ce.box(['Function', ['Block', ['Add', ['Multiply', 2, 't'], 1]], 't'])
      );
      const r = compile(ce.box(['Sum', ['a', 'i'], ['Limits', 'i', 0, 2]]), {
        to,
        fallback: true,
      } as any);
      expect(r?.success).toBe(true);
      if (to === 'javascript') expect((r as any).run({})).toBeCloseTo(9, 10);
    }
  );
});

// Tycho item 171, wave 2 — the SCALAR-POSITION adjacencies of the same
// 2026-08-12 ruling. The clause above closed the big-op BODY; the identical
// contradiction in an ordinary scalar-consuming position was still emitting
// garbage behind `success: true`. Measured BEFORE the gate, with `a` declared
// `(number) -> number` and assigned `t ↦ [cos t, sin t]`:
//
//   shape              javascript                        glsl
//   -----------------  --------------------------------  ---------------------
//   `a(u)`             CORRECT (the array is coerced)     `float _fn_a` returning
//                                                         `vec2` — see the
//                                                         residue note below
//   `a(u) + 1`         the STRING "0.955…,0.295…1"        same broken preamble
//   `2·a(u)`           `NaN`                              same
//   `sin(a(u))`        `NaN`                              same
//   `a(u)^2`           `NaN`                              same
//   `a(u) < 1`         the wrong scalar `false`           same
//   `a(u) = 1`         the wrong scalar `false`           same
//   `If(a(u)<1, 1, 2)` the WRONG branch (`2`)             same
//
// interval-js already declined all of them, for its own unrelated reason
// (no `List` lowering).
//
// The gate is ONE policy point — `BaseCompiler.assertNoContradictedScalarOperand`,
// in `compileExpr`, target-agnostic — because the contradiction is a property of
// the APPLICATION, not of any target. It sits AFTER the JavaScript broadcast
// attempt, so a shape that already had a value-safe `_SYS.bcast` route keeps it;
// the contradicted shapes are never NEWLY routed through `bcast` (the option the
// ruling rejected).
//
// A direct assignment of such a body is refused when it is made. The compiler
// declines are reached through a helper assigned later.
describe('a contradicted scalar declaration is refused, or declines in every scalar position through a helper assigned later (2026-08-12 ruling, wave 2)', () => {
  const ALL_TARGETS = ['javascript', 'glsl', 'interval-js'] as const;

  /** The wave-2 message: same two halves, its own second sentence. */

  /** `a` DECLARED scalar, ASSIGNED a list-constructing body. */
  const withDeclaration = (signature: string) => {
    const ce = new ComputeEngine();
    ce.declare('a', { signature });
    ce.assign(
      'a',
      ce.box(['Function', ['Block', ['List', ['Cos', 't'], ['Sin', 't']]], 't'])
    );
    ce.declare('u', 'number');
    return ce;
  };

  /** The six adjacency shapes, as MathJSON builders. */
  const ADJACENCIES: [string, any][] = [
    ['a(u) + 1', ['Add', ['a', 'u'], 1]],
    ['2·a(u)', ['Multiply', 2, ['a', 'u']]],
    ['a(u) < 1', ['Less', ['a', 'u'], 1]],
    ['sin(a(u))', ['Sin', ['a', 'u']]],
    ['a(u)^2', ['Power', ['a', 'u'], 2]],
    ['If(a(u) < 1, 1, 2)', ['If', ['Less', ['a', 'u'], 1], 1, 2]],
    // Not in the ruling's list but the same class, and it was ALSO wrong
    // (a scalar `false` where the interpreter broadcasts).
    ['a(u) = 1', ['Equal', ['a', 'u'], 1]],
  ];

  // The assignment of the list-constructing body under `(number) -> number`
  // is refused when it is made, so no scalar position can consume its value.
  test('the assignment of the list-constructing body is refused', () => {
    expect(() => withDeclaration('(number) -> number')).toThrow(
      /is not compatible with the type/
    );
  });

  /** `a` DECLARED `(number) -> number` and ASSIGNED `t ↦ h(t)`, then `h`
   * ASSIGNED a list-constructing body. The type of `h(t)` is not known when
   * `a` is assigned, so the assignment is accepted. */
  const withLaterList = () => {
    const ce = new ComputeEngine();
    ce.declare('a', { signature: '(number) -> number' });
    ce.assign('a', ce.box(['Function', ['h', 't'], 't']));
    ce.assign(
      'h',
      ce.box(['Function', ['List', ['Cos', 't'], ['Sin', 't']], 't'])
    );
    ce.declare('u', 'number');
    return ce;
  };

  test('javascript declines every scalar position when the list comes from a function assigned later', () => {
    for (const [name, mathjson] of ADJACENCIES) {
      const r = compile(withLaterList().box(mathjson), { fallback: true });
      expect([name, r?.success ?? false]).toEqual([name, false]);
      expect((r as any).error).toMatch(PIPELINE_DECLINE);
    }
  });

  test('every target declines `a(u) + 1` when the list comes from a function assigned later', () => {
    for (const to of ALL_TARGETS) {
      const r = compile(withLaterList().box(['Add', ['a', 'u'], 1]), {
        to,
        fallback: true,
      } as any);
      expect([to, r?.success ?? false]).toEqual([to, false]);
      // The interval mode has no body of `a` whose result has no stated type.
      if (to === 'interval-js') {
        expect((r as any).diagnostic?.code).toBe('outside-profile');
        expect((r as any).diagnostic?.operator).toBe('Function');
        continue;
      }
      // The GLSL fragment refuses the body before the emitter runs, with its
      // own message.
      expect((r as any).error).toMatch(PIPELINE_DECLINE);
    }
  });

  // The interpreter refuses a call of `a` with an `incompatible-type` error,
  // so the compiler declines every call of `a`. This includes the bare
  // application and the container positions.
  test.each([
    ['a(u)', ['a', 'u']],
    ['[a(u), 1]', ['List', ['a', 'u'], 1]],
    ['Block(a(u))', ['Block', ['a', 'u']]],
  ] as [string, any][])(
    '`%s` declines on JS when the list comes from a function assigned later',
    (_name, mathjson) => {
      const r = compile(withLaterList().box(mathjson), { fallback: true });
      expect(r?.success ?? false).toBe(false);
      expect((r as any).error).toMatch(PIPELINE_DECLINE);
    }
  );

  // CONTROL: a TRUTHFUL `-> number` head over a scalar body is the ordinary
  // case — no contradiction, so nothing changes anywhere.
  test('a truthful `-> number` scalar body still compiles and runs on JS', () => {
    const ce = new ComputeEngine();
    ce.declare('a', { signature: '(number) -> number' });
    ce.assign(
      'a',
      ce.box(['Function', ['Block', ['Add', ['Multiply', 2, 't'], 1]], 't'])
    );
    ce.declare('u', 'number');
    const r = compile(ce.box(['Add', ['a', 'u'], 1]), { fallback: true });
    expect(r?.success).toBe(true);
    expect((r as any).run({ u: 0.3 })).toBeCloseTo(2.6, 10);
  });
});

// Tycho item 171, wave 3 — the DEFINITION-SITE hole waves 1–2 could not reach.
// Waves 1–2 gate CONSUMING positions, so the one shape left was the bare
// application as the WHOLE compiled expression: no head consumes it, so nothing
// fired. Since CE-707 (the declared result binds the body) JavaScript
// and interval-js decline that call too, because the interpreter refuses it with
// an `incompatible-type` error. The shader targets keep the definition-emission
// gate below, because: the definition is still
// emitted, and its return type is synthesized from the body's DECLARED type
// while its `return` emits what the body actually builds. Measured BEFORE this
// gate, `compile(a(u))` reported `success: true` with the preamble
//
//     glsl:  float _fn_a(float t) { return vec2(cos(t), sin(t)); }
//
// — a `vec2` returned from a function declared scalar, i.e. shader source no
// driver accepts, shipped behind a reported success.
//
// The gate is the same shared static read from the other end
// (`isContradictedScalarFunctionBody`: the body's ascribed type says scalar, the
// shared look-through proves the body constructs a collection), placed in the
// shared emission path (`emitFunctionLiteralDefinition`) and keyed on a property
// the TARGET declares — `userFunctions.lowering.staticReturnType`. Only a
// lowering that synthesizes a static return type has the hole, so JavaScript and
// interval-js (untyped arrow form, no lowering) are structurally untouched.
//
// It runs AFTER `define`, so every more specific target diagnostic (the
// `no static GLSL type` return check, the `At` aggregate-index decline, the
// identifier checks) still wins; this speaks only for a definition that emitted
// cleanly.
//
// A direct assignment of such a body is refused when it is made. The compiler
// declines are reached through a helper assigned later.
describe('a contradicted scalar declaration is refused, or declines at DEFINITION emission through a helper assigned later (2026-08-12 ruling, wave 3)', () => {
  /** The wave-3 message: same two halves, its own second sentence. */

  /** `a` DECLARED scalar, ASSIGNED a list-constructing body. */
  const withDeclaration = (signature: string) => {
    const ce = new ComputeEngine();
    ce.declare('a', { signature });
    ce.assign(
      'a',
      ce.box(['Function', ['Block', ['List', ['Cos', 't'], ['Sin', 't']]], 't'])
    );
    ce.declare('u', 'number');
    return ce;
  };

  // The assignment of the list-constructing body under `(number) -> number`
  // is refused when it is made, so no definition is emitted for it.
  test('the assignment of the list-constructing body is refused', () => {
    expect(() => withDeclaration('(number) -> number')).toThrow(
      /is not compatible with the type/
    );
  });

  /** `a` DECLARED `(number) -> number` and ASSIGNED `t ↦ h(t)`, then `h`
   * ASSIGNED a list-constructing body. The type of `h(t)` is not known when
   * `a` is assigned, so the assignment is accepted. */
  const withLaterList = () => {
    const ce = new ComputeEngine();
    ce.declare('a', { signature: '(number) -> number' });
    ce.assign('a', ce.box(['Function', ['h', 't'], 't']));
    ce.assign(
      'h',
      ce.box(['Function', ['List', ['Cos', 't'], ['Sin', 't']], 't'])
    );
    ce.declare('u', 'number');
    return ce;
  };

  test.each(['glsl'] as const)(
    '%s declines the bare `a(u)` when the list comes from a function assigned later',
    (to) => {
      const r = compile(withLaterList().box(['a', 'u']), {
        to,
        fallback: true,
      } as any);
      expect(r?.success ?? false).toBe(false);
      // The GLSL fragment refuses the body before the emitter runs, with its
      // own message.
      expect((r as any).error).toMatch(PIPELINE_DECLINE);
      // No preamble with a scalar return over a vector ships behind the
      // decline.
      expect((r as any).preamble ?? '').not.toContain('_fn_a');
    }
  );
});

// Tycho item 171, wave 4 — the MULTI-CLAUSE hole waves 1–3 could not reach.
//
// A multi-clause function (function-polymorphism design §8) has no single
// `Function` literal: `DefineFunction` accumulates one literal per CLAUSE, so
// `BaseCompiler.userFunctionLiteral` answers `undefined` and the shared body
// look-through behind every earlier wave came back with NO evidence — measured,
// `isContradictedScalarDeclaration(a(u))` was `false` for a clause set whose
// every body builds `[cos t, sin t]` under a DECLARED `(number) -> number`.
// The waves therefore all silently passed such a call through. Measured BEFORE
// this arm, on JavaScript, behind `success: true`:
//
//     Σ_{i=0}^{2} a(i)  →  "1,00.5403…,0.8414…-0.4161…,0.9092…"  (a STRING)
//     a(u) + 1          →  "0.29552…,0.955336…1"                 (a STRING)
//     2·a(u)            →  NaN
//     sin(a(u))         →  NaN
//     a(u) < 1          →  false                     (a wrong scalar verdict)
//
// — the identical failure class waves 1–2 already gate for a single-literal
// function. The fix feeds the CLAUSE SET into the same shared body predicate
// (`isProvablyCollectionValuedClauseSet`) rather than adding a gate of its own,
// so wave 1 (big-op body), wave 2 (scalar-consuming positions) and the item-171
// `-> unknown` look-through all inherit it at once, on their own messages.
//
// Scope, measured: only JavaScript (and interval-js) ever reached the hole —
// `tryEmitMultiClauseFunction` declines every other target outright (§8), so a
// multi-clause application on GLSL already failed closed with its own
// "no lowering" diagnostic and wave 3's `staticReturnType` route is
// structurally unreachable for a clause set. The GPU declines below therefore
// only pin that it STAYS closed, whichever diagnostic speaks first.
//
// A clause whose body constructs a list under the declared scalar result is
// refused when it is defined. The compiler declines are reached through clause
// bodies that call a helper assigned after the clauses.
describe('a contradicted scalar declaration of a MULTI-CLAUSE function is refused, or declines through a helper assigned later (2026-08-12 ruling, wave 4)', () => {
  const p = (name: string, type: string) => ['Typed', name, { str: type }];

  const LIST_1 = ['List', ['Cos', 't'], ['Sin', 't']];
  const LIST_2 = ['List', ['Sin', 't'], ['Cos', 't']];
  const SCALAR = ['Add', ['Multiply', 2, 't'], 1];

  /**
   * `a` as a two-CLAUSE function (integer clause, then real clause) under an
   * explicit declaration. `kind` picks which clause bodies construct a list:
   * both ('lying'), only the real one ('mixed'), or neither ('truthful').
   */
  const withClauses = (
    signature: string,
    kind: 'lying' | 'mixed' | 'truthful'
  ) => {
    const ce = new ComputeEngine();
    ce.declare('a', { signature });
    const b1 = kind === 'lying' ? LIST_1 : SCALAR;
    const b2 = kind === 'truthful' ? SCALAR : LIST_2;
    ce.box([
      'DefineFunction',
      'a',
      ['Function', b1, p('t', 'integer')],
    ] as any).evaluate();
    ce.box([
      'DefineFunction',
      'a',
      ['Function', b2, p('t', 'real')],
    ] as any).evaluate();
    ce.declare('u', 'number');
    return ce;
  };

  // A clause whose body constructs a list under the declared
  // `(number) -> number` is refused when it is defined: `DefineFunction`
  // gives an `incompatible-type` error and does not add the clause. Thus a
  // lying clause set defines no clause, and a mixed clause set keeps only its
  // truthful `integer` clause. A call that no clause matches gives a
  // `no-matching-clause` error.
  test('a clause that constructs a list is refused when it is defined', () => {
    const ce = new ComputeEngine();
    ce.declare('a', { signature: '(number) -> number' });
    for (const [body, type] of [
      [LIST_1, 'integer'],
      [LIST_2, 'real'],
    ] as const) {
      const r = ce
        .box(['DefineFunction', 'a', ['Function', body, p('t', type)]] as any)
        .evaluate();
      expect(r.toString()).toMatch(/incompatible-type/);
    }

    const mixed = withClauses('(number) -> number', 'mixed');
    expect(mixed.box(['a', 3]).evaluate().re).toBe(7);
    expect(mixed.box(['a', 0.3]).evaluate().toString()).toMatch(
      /no-matching-clause/
    );
  });

  /**
   * `a` as a two-CLAUSE function under `(number) -> number`, whose list
   * clauses call a helper (`h` or `k`) that is assigned after the clauses.
   * The type of the helper call is not known when a clause is defined, so
   * the clause is accepted. `kind` picks which clauses call a helper: both
   * ('lying') or only the real one ('mixed').
   */
  const withLaterClauses = (kind: 'lying' | 'mixed') => {
    const ce = new ComputeEngine();
    ce.declare('a', { signature: '(number) -> number' });
    const b1 = kind === 'lying' ? ['h', 't'] : SCALAR;
    ce.box([
      'DefineFunction',
      'a',
      ['Function', b1, p('t', 'integer')],
    ] as any).evaluate();
    ce.box([
      'DefineFunction',
      'a',
      ['Function', ['k', 't'], p('t', 'real')],
    ] as any).evaluate();
    ce.assign('h', ce.box(['Function', LIST_1, 't'] as any));
    ce.assign('k', ce.box(['Function', LIST_2, 't'] as any));
    ce.declare('u', 'number');
    return ce;
  };

  const SCALAR_POSITIONS: [string, any][] = [
    ['a(u) + 1', ['Add', ['a', 'u'], 1]],
    ['2·a(u)', ['Multiply', 2, ['a', 'u']]],
    ['sin(a(u))', ['Sin', ['a', 'u']]],
    ['a(u) < 1', ['Less', ['a', 'u'], 1]],
  ];

  describe.each(['lying', 'mixed'] as const)(
    'a %s clause set with a helper assigned later',
    (kind) => {
      // In the MIXED set only the `real` clause contradicts the declaration.
      // The consuming position compiles once, for every clause, so the
      // clause that contradicts the declaration decides, and the compiler
      // declines.
      test.each(SCALAR_POSITIONS)(
        'declines `%s` on JavaScript',
        (_label, expr) => {
          const r = compile(withLaterClauses(kind).box(expr), {
            fallback: true,
          });
          expect(r?.success ?? false).toBe(false);
          expect((r as any).error).toMatch(PIPELINE_DECLINE);
        }
      );

      test('declines the big-op body `Σ a(i)` on JavaScript', () => {
        // `constantFold: false`: the sum has no free variables, so
        // compile-time constant folding would answer it from the
        // interpreter and report success, so the static decline under test
        // would not run.
        const r = compile(
          withLaterClauses(kind).box([
            'Sum',
            ['a', 'i'],
            ['Limits', 'i', 0, 2],
          ]),
          { fallback: true, constantFold: false }
        );
        expect(r?.success ?? false).toBe(false);
        expect((r as any).error).toMatch(PIPELINE_DECLINE);
      });

      test.each(['glsl'] as const)('stays closed on %s', (to) => {
        const r = compile(withLaterClauses(kind).box(['Add', ['a', 'u'], 1]), {
          to,
          fallback: true,
        } as any);
        expect(r?.success ?? false).toBe(false);
        // No preamble ships behind the decline.
        expect((r as any).preamble ?? '').not.toContain('_fn_a');
      });

      test('a container position `[a(u), 1]` declines on JavaScript', () => {
        const r = compile(withLaterClauses(kind).box(['List', ['a', 'u'], 1]), {
          fallback: true,
        });
        expect(r?.success ?? false).toBe(false);
        expect((r as any).error).toMatch(PIPELINE_DECLINE);
      });
    }
  );
});

// Tycho item 171, wave 5 — the MULTI-STATEMENT-BODY hole in the shared body
// look-through every earlier wave reads.
//
// `isProvablyCollectionValuedBody` unwrapped a `Block` only when it held EXACTLY
// ONE statement, so a lambda whose body does any work before building its result
// was invisible to all four waves. Measured BEFORE the fix, with `a` DECLARED
// `(number) -> number` and assigned `t ↦ { w := cos t; [w, sin t] }` — the same
// contradiction wave 1–3 already gate for the one-statement spelling:
//
//     JS   a(u) + 1     →  the STRING ",0.29552020666133955"   (success: true)
//     JS   2·a(u)       →  null
//     JS   sin(a(u))    →  null
//     JS   Σ a(i)       →  the STRING ",0,0.8414709848078965,0.9092974268256817"
//     glsl bare a(u)    →  float _fn_a(float t) { w = cos(t); return vec2(w, sin(t)); }
//
// The fix judges the LAST statement of any non-empty block — the block's VALUE —
// unwrapping the declaration's `Typed` ascription exactly as the single-statement
// path already did (the ascription wraps the LAST statement:
// `Block(Declare(…), Typed(List(…), 'number'))`).
//
// A `Return` anywhere in an EARLIER statement DISQUALIFIES the block: control may
// never reach the last statement, so it is not provably the value. This predicate
// is positive-evidence-only — its admission DECLINES a compile — so absence of
// proof must answer `false`, never "probably".
//
// A direct assignment of such a body is refused when it is made. The compiler
// declines are reached through a body whose last statement calls a helper
// assigned later.
describe('a contradicted scalar declaration is refused, or seen through a MULTI-STATEMENT body that calls a helper assigned later (2026-08-12 ruling, wave 5)', () => {
  const ALL_TARGETS = ['javascript', 'glsl', 'interval-js'] as const;

  /**
   * `a` DECLARED scalar, ASSIGNED a MULTI-statement body whose last statement
   * constructs a list. `w` (not `u`) is the local, so it cannot collide with the
   * outer variable the call sites use.
   */
  const withDeclaration = (signature: string) => {
    const ce = new ComputeEngine();
    // `scope` spliced into the declared signature. The scalar-vs-collection
    // contradiction under test is unaffected.
    ce.declare('a', { signature: signature.replace('->', 'scope ->') });
    ce.assign(
      'a',
      ce.box([
        'Function',
        [
          'Block',
          ['Declare', 'w', "'unknown'", ['Cos', 't']],
          ['List', 'w', ['Sin', 't']],
        ],
        't',
      ])
    );
    ce.declare('u', 'number');
    return ce;
  };

  // The assignment of a two-statement body whose last statement constructs a
  // list, under `(number) -> number`, is refused when it is made. The value
  // of the block is the value of its last statement.
  test('the assignment of the multi-statement list body is refused', () => {
    expect(() => withDeclaration('(number) -> number')).toThrow(
      /is not compatible with the type/
    );
  });

  /**
   * `a` DECLARED `(number) -> number` and ASSIGNED a two-statement body
   * whose last statement calls `h`, then `h` ASSIGNED a list-constructing
   * body. The type of `h(w)` is not known when `a` is assigned, so the
   * assignment is accepted.
   */
  const withLaterList = () => {
    const ce = new ComputeEngine();
    ce.declare('a', { signature: '(number) -> number' });
    ce.assign(
      'a',
      ce.box([
        'Function',
        ['Block', ['Declare', 'w', "'unknown'", ['Cos', 't']], ['h', 'w']],
        't',
      ])
    );
    ce.assign(
      'h',
      ce.box(['Function', ['List', ['Cos', 't'], ['Sin', 't']], 't'])
    );
    ce.declare('u', 'number');
    return ce;
  };

  test('the stored body is a two-statement block that ends in the helper call', () => {
    const literal = (withLaterList().lookupDefinition('a') as any)?.value
      ?.value;
    expect(literal.ops[0].operator).toEqual('Block');
    expect(literal.ops[0].nops).toEqual(2);
  });

  // The wave-2 shape matrix, over the multi-statement body.
  const ADJACENCIES: [string, any][] = [
    ['a(u) + 1', ['Add', ['a', 'u'], 1]],
    ['2·a(u)', ['Multiply', 2, ['a', 'u']]],
    ['a(u) < 1', ['Less', ['a', 'u'], 1]],
    ['sin(a(u))', ['Sin', ['a', 'u']]],
    ['a(u)^2', ['Power', ['a', 'u'], 2]],
    ['If(a(u) < 1, 1, 2)', ['If', ['Less', ['a', 'u'], 1], 1, 2]],
    ['a(u) = 1', ['Equal', ['a', 'u'], 1]],
  ];

  test.each(ADJACENCIES)('javascript declines `%s`', (_name, mathjson) => {
    const r = compile(withLaterList().box(mathjson), { fallback: true });
    expect(r?.success ?? false).toBe(false);
    expect((r as any).error).toMatch(PIPELINE_DECLINE);
  });

  test.each(ALL_TARGETS)('%s declines `a(u) + 1`', (to) => {
    const r = compile(withLaterList().box(['Add', ['a', 'u'], 1]), {
      to,
      fallback: true,
    } as any);
    expect(r?.success ?? false).toBe(false);
    // The interval mode has no body of `a` whose result has no stated type.
    if (to === 'interval-js') {
      expect((r as any).diagnostic?.code).toBe('outside-profile');
      expect((r as any).diagnostic?.operator).toBe('Function');
      return;
    }
    // The GLSL fragment refuses the body before the emitter runs, with its
    // own message.
    expect((r as any).error).toMatch(PIPELINE_DECLINE);
  });

  // The big-op body check reads the same predicate.
  test.each(ALL_TARGETS)('%s declines the big-op body `Σ a(i)`', (to) => {
    const r = compile(
      withLaterList().box(['Sum', ['a', 'i'], ['Limits', 'i', 0, 2]]),
      { to, fallback: true, constantFold: false } as any
    );
    expect(r?.success ?? false).toBe(false);
    // The GLSL fragment refuses the Sum before the emitter runs.
    if (to === 'glsl') {
      expect((r as any).diagnostic?.code).toBe('outside-profile');
      return;
    }
    if (to === 'interval-js') {
      expect((r as any).diagnostic?.code).toBe('outside-profile');
      expect((r as any).diagnostic?.operator).toBe('Function');
      return;
    }
    expect((r as any).error).toMatch(PIPELINE_DECLINE);
  });

  // The definition-emission check reads it too, so the bare call does not
  // ship `float _fn_a(float t) { … return vec2(…); }`.
  test.each(['glsl'] as const)(
    '%s declines the bare `a(u)` at definition emission',
    (to) => {
      const r = compile(withLaterList().box(['a', 'u']), {
        to,
        fallback: true,
      } as any);
      expect(r?.success ?? false).toBe(false);
      // The GLSL fragment refuses the body before the emitter runs, with its
      // own message.
      expect((r as any).error).toMatch(PIPELINE_DECLINE);
      expect((r as any).preamble ?? '').not.toContain('_fn_a');
    }
  );

  // The interpreter refuses a call of `a`, so bare `a(u)` declines on
  // JavaScript too.
  test('bare `a(u)` declines on JavaScript', () => {
    const r = compile(withLaterList().box(['a', 'u']), { fallback: true });
    expect(r?.success ?? false).toBe(false);
    expect((r as any).error).toMatch(PIPELINE_DECLINE);
  });

  // CONTROL: a TRUTHFUL multi-statement scalar body — no contradiction, so every
  // target compiles it exactly as before.
  test.each(['javascript', 'glsl'] as const)(
    '%s still compiles a TRUTHFUL multi-statement scalar body',
    (to) => {
      const ce = new ComputeEngine();
      // `scope` declared, as in `withDeclaration` above.
      ce.declare('a', { signature: '(number) scope -> number' });
      ce.assign(
        'a',
        ce.box([
          'Function',
          [
            'Block',
            ['Declare', 'w', "'unknown'", ['Multiply', 2, 't']],
            ['Add', 'w', 1],
          ],
          't',
        ])
      );
      ce.declare('u', 'number');
      const r = compile(ce.box(['Add', ['a', 'u'], 1]), {
        to,
        fallback: true,
      } as any);
      expect(r?.success).toBe(true);
    }
  );
});

// Tycho item 171, wave 6 — the BOOLEAN-declaration hole. Every gate above tested
// the declared type with `matches('number')`, so a head declared
// `(number) -> boolean` over a list-constructing body escaped ALL of them.
// Measured BEFORE the fix, with `b` declared `(number) -> boolean` and assigned
// `t ↦ [cos t, sin t]`, all behind `success: true`:
//
//   shape                   javascript                    glsl
//   ----------------------  ----------------------------  ------------------------
//   `If(b(u), 1, 2)`        `1` — the WRONG branch, off    `bool _fn_b(float t) {
//                           the truthiness of an ARRAY       return vec2(…); }`
//   `Which(b(u), 1, T, 2)`  `1` — same                     same broken preamble
//   `If(b(u), 1)`           same                          same
//   `Not(b(u))`             `false` — a wrong verdict      same
//   `And(b(u), True)`       the ARRAY, unguarded           same
//   `b(u) = True`           `false` — a wrong verdict      same
//
// The interpreter never takes a branch here at all: a condition must evaluate to
// `True`/`False`, and `b(0.3)` answers `[0.955…, 0.295…]`.
//
// Two changes, both minimal: the shared declared-type test becomes
// `isScalarDeclaredType` (`number` OR `boolean`), which every wave reads; and the
// CONDITION path gets the check, in `assertScalarCondition` — the shared guard
// `If` and `guardCondition` (Which) already funnel through, since `If`/
// `Which` are not in `assertNoContradictedScalarOperand`'s head
// classification.
//
// Exemption-safety: widening to `boolean` cannot touch the ruled item-121
// boolean exemption, because the gate ADDITIONALLY requires the body
// look-through to PROVE a collection constructor — which a genuine boolean body
// (a comparison) never produces. Pinned by the controls below.
//
// A direct assignment of a list body under a `boolean` result is refused when
// it is made. The compiler declines are reached through a helper assigned
// later.
describe('a contradicted BOOLEAN declaration is refused, or declines in every scalar position through a helper assigned later (2026-08-12 ruling, wave 6)', () => {
  const ALL_TARGETS = ['javascript', 'glsl', 'interval-js'] as const;

  /** `b` DECLARED `-> boolean`, ASSIGNED a list-constructing body. */
  const withBody = (body: any, signature = '(number) -> boolean') => {
    const ce = new ComputeEngine();
    ce.declare('b', { signature });
    ce.assign('b', ce.box(['Function', ['Block', body], 't']));
    ce.declare('u', 'number');
    return ce;
  };

  // Both spellings of the lying body: one whose ELEMENTS are booleans (the most
  // deceptive shape — every part of it reads boolean) and one that is plainly
  // numeric under a `boolean` head.
  const LYING_BODIES: [string, any][] = [
    ['[t < 1, t < 2]', ['List', ['Less', 't', 1], ['Less', 't', 2]]],
    ['[cos t, sin t]', ['List', ['Cos', 't'], ['Sin', 't']]],
  ];

  // The assignment of each lying body under `(number) -> boolean` is refused
  // when it is made: a list has no value in common with `boolean`.
  test.each(LYING_BODIES)(
    'the assignment of the `%s` body is refused',
    (_name, body) => {
      expect(() => withBody(body)).toThrow(/is not compatible with the type/);
    }
  );

  /**
   * The positions, as builders over the callee name so the genuine-boolean
   * CONTROL below can reuse exactly the same shapes.
   *
   * `If` (both forms) is `assertScalarCondition`'s callers on every target.
   * `Which` is listed separately: the GPU lowering is its OWN element-wise
   * entry and never reaches that guard, so glsl closes it one gate later
   * (the wave-3 DEFINITION backstop, now reading the same `boolean` arm), and
   * interval-js declines earlier still on its pre-existing "no `List` lowering".
   * Measured, not assumed.
   */
  const CONDITIONS = (f: string): [string, any][] => [
    [`If(${f}(u), 1, 2)`, ['If', [f, 'u'], 1, 2]],
    [`If(${f}(u), 1)`, ['If', [f, 'u'], 1]],
  ];
  const WHICH = (f: string): any => ['Which', [f, 'u'], 1, 'True', 2];

  /** The scalar-OPERAND positions — `assertNoContradictedScalarOperand`. */
  const OPERANDS = (f: string): [string, any][] => [
    [`Not(${f}(u))`, ['Not', [f, 'u']]],
    [`And(${f}(u), True)`, ['And', [f, 'u'], 'True']],
    [`${f}(u) = True`, ['Equal', [f, 'u'], 'True']],
  ];

  /** `b` DECLARED `(number) -> boolean` and ASSIGNED `t ↦ h(t)`, then `h`
   * ASSIGNED the list-constructing `body`. The type of `h(t)` is not known
   * when `b` is assigned, so the assignment is accepted. */
  const withLaterBody = (body: any) => {
    const ce = new ComputeEngine();
    ce.declare('b', { signature: '(number) -> boolean' });
    ce.assign('b', ce.box(['Function', ['h', 't'], 't']));
    ce.assign('h', ce.box(['Function', body, 't']));
    ce.declare('u', 'number');
    return ce;
  };

  describe.each(LYING_BODIES)(
    'with the `%s` body in a helper assigned later',
    (bodyName, body) => {
      test.each(ALL_TARGETS)('%s declines the CONDITION shapes', (to) => {
        for (const [label, mathjson] of CONDITIONS('b')) {
          const r = compile(withLaterBody(body).box(mathjson), {
            to,
            fallback: true,
          } as any);
          expect([label, r?.success ?? false]).toEqual([label, false]);
          // The GLSL fragment refuses the condition before the emitter runs.
          if (to === 'glsl') {
            expect((r as any).diagnostic?.code).toBe('outside-profile');
            continue;
          }
          // The interval mode has no list body of `h` in a scalar position.
          if (to === 'interval-js') {
            expect((r as any).diagnostic?.code).toBe('outside-profile');
            continue;
          }
          expect((r as any).error).toMatch(PIPELINE_DECLINE);
        }
      });

      // On glsl the definition check speaks first, because its
      // element-wise `Which` does not call `assertScalarCondition`. The
      // interval mode has no list body of `h` in a scalar position.
      test.each(ALL_TARGETS)('%s declines `Which(b(u), 1, True, 2)`', (to) => {
        const r = compile(withLaterBody(body).box(WHICH('b')), {
          to,
          fallback: true,
        } as any);
        expect(r?.success ?? false).toBe(false);
        const error = (r as any).error as string;
        // The GLSL fragment refuses the condition before the emitter runs.
        if (to === 'glsl')
          expect((r as any).diagnostic?.code).toBe('outside-profile');
        else if (to === 'interval-js')
          expect((r as any).diagnostic?.code).toBe('outside-profile');
        else expect(error).toMatch(PIPELINE_DECLINE);
      });

      test.each(ALL_TARGETS)('%s declines the scalar-OPERAND shapes', (to) => {
        for (const [label, mathjson] of OPERANDS('b')) {
          const r = compile(withLaterBody(body).box(mathjson), {
            to,
            fallback: true,
          } as any);
          expect([label, r?.success ?? false]).toEqual([label, false]);
          // The GLSL fragment refuses the operand before the emitter runs.
          if (to === 'glsl') {
            expect((r as any).diagnostic?.code).toBe('outside-profile');
            continue;
          }
          if (to === 'interval-js') {
            expect((r as any).diagnostic?.code).toBe('outside-profile');
            continue;
          }
          expect((r as any).error).toMatch(PIPELINE_DECLINE);
        }
      });

      // On the shader targets, the definition of `b` would declare a
      // `bool` return over a `vec2` value, so the compilation declines
      // when it emits the definition.
      test.each(['glsl'] as const)(
        '%s declines the bare `b(u)` at definition emission',
        (to) => {
          const r = compile(withLaterBody(body).box(['b', 'u']), {
            to,
            fallback: true,
          } as any);
          expect(r?.success ?? false).toBe(false);
          // The GLSL fragment refuses the list body of `h` first, but only a
          // list of booleans; the emitter refuses the other body.
          if (bodyName === '[t < 1, t < 2]')
            expect((r as any).diagnostic?.code).toBe('outside-profile');
          else expect((r as any).error).toMatch(PIPELINE_DECLINE);
          expect((r as any).preamble ?? '').not.toContain('_fn_b');
        }
      );

      test('bare `b(u)` declines on JavaScript', () => {
        const r = compile(withLaterBody(body).box(['b', 'u']), {
          fallback: true,
        });
        expect(r?.success ?? false).toBe(false);
        expect((r as any).error).toMatch(PIPELINE_DECLINE);
      });
    }
  );

  // EXEMPTION-SAFETY, the load-bearing control: a GENUINE boolean body produces
  // no collection evidence, so the widened gate is structurally unable to fire.
  describe('a genuine boolean body is untouched', () => {
    const genuine = () => {
      const ce = new ComputeEngine();
      ce.declare('p', { signature: '(number) -> boolean' });
      ce.assign('p', ce.box(['Function', ['Block', ['Greater', 't', 1]], 't']));
      ce.declare('u', 'number');
      return ce;
    };

    test('`If(p(u), 1, 2)` runs to the right branch on JS', () => {
      const r = compile(genuine().box(['If', ['p', 'u'], 1, 2]), {
        fallback: true,
      });
      expect(r?.success).toBe(true);
      expect((r as any).run({ u: 3 })).toEqual(1);
      expect((r as any).run({ u: 0 })).toEqual(2);
    });
  });
});

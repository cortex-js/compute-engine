import { expectTypeBetween } from '../utils';
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

  test('compile-then-define interleaving: the later Sum still compiles element-wise', () => {
    // The original witness sequence (corpus `neyret/iej4fjazoe` reduced): a
    // compile ran BEFORE the second definition, so the second definition's
    // binder rewrite used to re-validate the body and corrupt `a`.
    const ce = new ComputeEngine();
    ce.declare('t', 'real');
    ce.parse('a(t)\\coloneq\\left[\\cos t,\\sin t\\right]').evaluate();
    ce.parse('h(i)\\coloneq\\operatorname{mod}(10^4\\sin(10^4i),1)').evaluate();
    ce.parse(
      'A(t)\\coloneq\\sum_{i=0}^{6}h(i)\\frac{1}{1.4^i}a(2^it+2\\pi h(i+.5))'
    ).evaluate();
    const rA = compile(ce.parse('A(t)'), { functions: {} });
    ce.parse('B(t)\\coloneq\\sum_{i=0}^{6}\\frac{1}{1.4^i}a(it)').evaluate();
    const rB = compile(ce.parse('B(t)'), { functions: {} });

    expect(rA.success).toBe(true);
    expect(rB.success).toBe(true);
    const bCompiled = (rB as any).run({ t: 0.3 });
    // The defect returned NaN (or a concatenated string) here.
    expect(Array.isArray(bCompiled)).toBe(true);
    const bInterp = ce.parse('B(0.3)').N();
    const [x, y] = [...bInterp.each()].map((e) => e.re);
    expect(bCompiled[0]).toBeCloseTo(x, 10);
    expect(bCompiled[1]).toBeCloseTo(y, 10);

    const aCompiled = (rA as any).run({ t: 0.3 });
    expect(Array.isArray(aCompiled)).toBe(true);
    const aInterp = ce.parse('A(0.3)').N();
    const [ax, ay] = [...aInterp.each()].map((e) => e.re);
    expect(aCompiled[0]).toBeCloseTo(ax, 10);
    expect(aCompiled[1]).toBeCloseTo(ay, 10);
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

  test('numerically-accumulable bodies are NOT declined', () => {
    const ce = new ComputeEngine();
    ce.declare('q', 'real');
    // Wide/unknown types stay admitted — the decline needs positive evidence.
    const wide = jsCompile(ce, ce.parse('\\sum_{i=0}^{2}q', { strict: false }));
    expect(wide?.success).toBe(true);
    // Booleans coerce to 0/1 on the numeric targets: the counting idiom.
    const counting = jsCompile(
      ce,
      ce.parse('\\sum_{k=0}^{3}\\left(k>1\\right)', { strict: false })
    );
    expect(counting?.success).toBe(true);
    expect(counting!.run!({})).toBe(2);
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
  // The consumer registration shape: declare an open head, then assign the
  // lambda. It is what makes the declared result `unknown` rather than the
  // inferred `vector<2>`.
  const setup = (hBody: any) => {
    const ce = new ComputeEngine();
    ce.declare('t', 'real');
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

  test.each([
    ['identity', 'i'],
    ['affine', ['Add', 'i', 1]],
    [
      'mod(sin)',
      ['Mod', ['Multiply', 10000, ['Sin', ['Multiply', 10000, 'i']]], 1],
    ],
  ])(
    '`Sum a(h(i))` with h = %s agrees with the interpreter',
    (_label, hBody) => {
      const ce = setup(hBody);
      // The body is the lift-wrapped shape that used to slip the gate. Since
      // placeholder-signature refinement (2026-08-15) the declared `unknown`
      // results refine to the bodies' inferred types, so the shape is now
      // CONCRETELY vector-valued rather than `broadcastable<unknown>` — the
      // element-wise agreement below is what this test pins either way.
      const sumBody = (ce.box('A').value as any).ops[0].ops[0].ops[0];
      expectTypeBetween(sumBody, { atMost: 'list<number^2>' });

      const [x, y] = [...ce.parse('A(0.3)').N().each()].map((e) => e.re);
      {
        const r = compile(ce.parse('A(t)', { strict: false }), {
          fallback: true,
        });
        expect(r?.success).toBe(true);
        const v = (r as any).run({ t: 0.3 });
        // Was a JS string: `+` over the arrays `a` really returns.
        expect(typeof v).not.toEqual('string');
        expect(Array.isArray(v)).toBe(true);
        expect(v[0]).toBeCloseTo(x!, 10);
        expect(v[1]).toBeCloseTo(y!, 10);
      }
    }
  );

  test('the un-nested spellings are unchanged', () => {
    // `Σ a(t+i)` and `Σ a(i)` never had the lift wrapper and already compiled
    // element-wise — they must keep the same emitted code and value.
    for (const arg of [['Add', 't', 'i'], 'i'] as any[]) {
      const ce = setup('i');
      ce.assign(
        'A',
        ce.box([
          'Function',
          ['Block', ['Sum', ['a', arg], ['Limits', 'i', 0, 2]]],
          't',
        ])
      );
      const r = compile(ce.parse('A(t)', { strict: false }), {
        fallback: true,
      });
      expect(r?.success).toBe(true);
      const v = (r as any).run({ t: 0.3 });
      expect(Array.isArray(v)).toBe(true);
      const [x, y] = [...ce.parse('A(0.3)').N().each()].map((e) => e.re);
      expect(v[0]).toBeCloseTo(x!, 10);
      expect(v[1]).toBeCloseTo(y!, 10);
    }
  });

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
// routes the shape into the element-wise `_SYS.bcast` fold, but GLSL,
// Python and interval-js call `BaseCompiler.assertScalarBigOpBody` directly and
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
describe('list-valued big-op bodies decline on the non-JS targets (item 171 residue)', () => {
  const NON_JS = ['glsl', 'python', 'interval-js'] as const;

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
  test.each(NON_JS)('%s declines `Sum a(h(i))` (direct form)', (to) => {
    const ce = setup();
    const r = compile(
      ce.box(['Sum', ['a', ['h', 'i']], ['Limits', 'i', 0, 2]]),
      {
        to,
        fallback: true,
        constantFold: false,
      } as any
    );
    expect(r?.success ?? false).toBe(false);
    // The GLSL fragment refuses the Sum before the emitter runs.
    if (to === 'glsl') {
      expect((r as any).diagnostic?.code).toBe('outside-fragment');
      return;
    }
    expect((r as any).error).toMatch(
      /collection-valued body has no compiled form/
    );
  });

  test.each(NON_JS)('%s declines the `A(t)` wrapper form', (to) => {
    const ce = setup();
    // `A`'s body ignores `t`, so the Sum subtree is still constant: fold off.
    const r = compile(ce.parse('A(t)', { strict: false }), {
      to,
      fallback: true,
      constantFold: false,
    } as any);
    expect(r?.success ?? false).toBe(false);
    // The MESSAGE is pinned on the direct form above, not here: Python has no
    // user-function lowering at all, so the wrapper declines earlier, at the
    // outer `A` call ("Unknown operator `A`"), and never reaches the big-op
    // gate. That decline is pre-existing and independent of this fix.
    // The GLSL fragment refuses the untyped `t` first.
    if (to === 'glsl')
      expect((r as any).diagnostic?.code).toBe('outside-fragment');
    else if (to !== 'python')
      expect((r as any).error).toMatch(
        /collection-valued body has no compiled form/
      );
  });

  test('JavaScript is unaffected — it still takes the element-wise fold', () => {
    const ce = setup();
    const r = compile(
      ce.box(['Sum', ['a', ['h', 'i']], ['Limits', 'i', 0, 2]]),
      {
        fallback: true,
        constantFold: false,
      }
    );
    expect(r?.success).toBe(true);
    expect((r as any).code).toContain('_SYS.bcast');
    expect(Array.isArray((r as any).run({}))).toBe(true);
  });

  // The item-121 exemptions must survive on every target: the refinement adds
  // POSITIVE collection evidence, it does not narrow "absence of evidence".
  test.each(['javascript', ...NON_JS] as const)(
    '%s still compiles a boolean big-op body (the counting idiom)',
    (to) => {
      const ce = new ComputeEngine();
      const r = compile(
        ce.box(['Sum', ['Greater', 'i', 1], ['Limits', 'i', 1, 3]]),
        { to, fallback: true } as any
      );
      // The GLSL fragment refuses a boolean summand (an `Error` operand).
      if (to === 'glsl') {
        expect(r?.success).toBe(false);
        expect((r as any).diagnostic?.code).toBe('outside-fragment');
        return;
      }
      expect(r?.success).toBe(true);
    }
  );

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
      // collection-constructing body is new evidence. (Python is omitted: it
      // has no user-function lowering at all and declines with
      // "Unknown operator `q`" independently of this change.)
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
//   python      declined for an unrelated reason ("Unknown operator `a`")
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
  const ALL = ['javascript', 'glsl', 'python', 'interval-js'] as const;
  const CONTRADICTED =
    /says it returns a scalar .* but its body constructs a collection/;

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
        expect((r as any).diagnostic?.code).toBe('outside-fragment');
        continue;
      }
      // The message names both halves and suggests the fix.
      expect((r as any).error).toMatch(CONTRADICTED);
      expect((r as any).error).toMatch(/'a'/);
      expect((r as any).error).toMatch(/-> list<number>/);
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
      expect((r as any).error).toMatch(CONTRADICTED);
    }
  });

  // The `-> unknown` (item 171) and lying `-> number` shapes must not get
  // tangled: the first compiles CORRECTLY on JS and declines on the non-JS
  // targets with the OPEN-result-type message; the second declines everywhere
  // with the contradicted-declaration message.
  test('the `-> unknown` shape is unchanged — JS still folds element-wise', () => {
    const ce = new ComputeEngine();
    for (const id of ['h', 'a'])
      ce.declare(id, { signature: '(unknown) -> unknown' });
    ce.assign('h', ce.box(['Function', ['Block', 'i'], 'i']));
    ce.assign(
      'a',
      ce.box(['Function', ['Block', ['List', ['Cos', 't'], ['Sin', 't']]], 't'])
    );
    const expr = ce.box(['Sum', ['a', ['h', 'i']], ['Limits', 'i', 0, 2]]);
    const r = compile(expr, { fallback: true, constantFold: false });
    expect(r?.success).toBe(true);
    expect((r as any).code).toContain('_SYS.bcast');
    const v = (r as any).run({});
    const [x, y] = [...expr.N().each()].map((e) => e.re);
    expect(v[0]).toBeCloseTo(x!, 10);
    expect(v[1]).toBeCloseTo(y!, 10);
  });

  test.each(['glsl', 'python', 'interval-js'] as const)(
    '%s declines the (formerly open) collection shape on its OWN message, not the contradicted one',
    (to) => {
      const ce = new ComputeEngine();
      for (const id of ['h', 'a'])
        ce.declare(id, { signature: '(unknown) -> unknown' });
      ce.assign('h', ce.box(['Function', ['Block', 'i'], 'i']));
      ce.assign(
        'a',
        ce.box([
          'Function',
          ['Block', ['List', ['Cos', 't'], ['Sin', 't']]],
          't',
        ])
      );
      const r = compile(
        ce.box(['Sum', ['a', ['h', 'i']], ['Limits', 'i', 0, 2]]),
        { to, fallback: true, constantFold: false } as any
      );
      expect(r?.success ?? false).toBe(false);
      // Since placeholder-signature refinement (2026-08-15) this shape is no
      // longer open: `a`'s declared `unknown` result refines to the body's
      // `vector<…>`, so the STATIC collection-body decline fires (a sharper
      // message than the old "open result type" one, which needs a result
      // that STAYS open — a shape refinement makes rare by design). What must
      // not regress is the untangling: the decline is never the
      // contradicted-declaration message, which blames the author for a lie
      // they did not write.
      // The GLSL fragment refuses the Sum before the emitter runs.
      if (to === 'glsl') {
        expect((r as any).diagnostic?.code).toBe('outside-fragment');
        expect((r as any).error).not.toMatch(CONTRADICTED);
        return;
      }
      expect((r as any).error).toMatch(
        /collection-valued body has no compiled form/
      );
      expect((r as any).error).not.toMatch(CONTRADICTED);
    }
  );

  // A TRUTHFUL `-> number` head over a scalar body is the ordinary case and
  // must keep compiling. (Python is omitted: it has no user-function lowering
  // at all and declines with "Unknown operator `a`" independently of this
  // change — the same carve-out the exemption tests above use.)
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

  // A TRUTHFUL `-> list<number>` declaration keeps its PRE-EXISTING behavior,
  // measured here and pinned: JS folds element-wise, and the four non-JS
  // targets decline on `assertScalarBigOpBody`'s FIRST clause (the declared
  // type already matches `list`), never on the new one.
  const truthfulList = () => {
    const ce = new ComputeEngine();
    ce.declare('a', { signature: '(number) -> list<number>' });
    ce.assign(
      'a',
      ce.box(['Function', ['Block', ['List', ['Cos', 't'], ['Sin', 't']]], 't'])
    );
    return ce;
  };

  test('a truthful `-> list<number>` declaration still folds element-wise on JS', () => {
    const ce = truthfulList();
    const expr = ce.box(['Sum', ['a', 'i'], ['Limits', 'i', 0, 2]]);
    expectTypeBetween((expr as any).ops[0], { atMost: 'list<number>' });
    const r = compile(expr, { fallback: true, constantFold: false });
    expect(r?.success).toBe(true);
    expect((r as any).code).toContain('_SYS.bcast');
    const v = (r as any).run({});
    const [x, y] = [...expr.N().each()].map((e) => e.re);
    expect(v[0]).toBeCloseTo(x!, 10);
    expect(v[1]).toBeCloseTo(y!, 10);
  });

  test.each(['glsl', 'python', 'interval-js'] as const)(
    '%s declines a truthful `-> list<number>` on the FIRST clause',
    (to) => {
      const r = compile(
        truthfulList().box(['Sum', ['a', 'i'], ['Limits', 'i', 0, 2]]),
        { to, fallback: true, constantFold: false } as any
      );
      expect(r?.success ?? false).toBe(false);
      // The GLSL fragment refuses the Sum before the emitter runs.
      if (to === 'glsl') {
        expect((r as any).diagnostic?.code).toBe('outside-fragment');
        expect((r as any).error).not.toMatch(CONTRADICTED);
        return;
      }
      expect((r as any).error).toMatch(
        /collection-valued body has no compiled form/
      );
      expect((r as any).error).not.toMatch(CONTRADICTED);
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
// Python and interval-js already declined all of them, for their own unrelated
// reasons (no user-function lowering / no `List` lowering).
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
  const ALL_TARGETS = ['javascript', 'glsl', 'python', 'interval-js'] as const;

  /** The wave-2 message: same two halves, its own second sentence. */
  const CONTRADICTED_SCALAR_POSITION =
    /says it returns a scalar .* but its body constructs a collection.*this scalar position would consume a run-time collection as a number/s;

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
      expect((r as any).error).toMatch(CONTRADICTED_SCALAR_POSITION);
      expect((r as any).error).toMatch(/'a'/);
      expect((r as any).error).toMatch(/-> list<number>/);
    }
  });

  test('every target declines `a(u) + 1` when the list comes from a function assigned later', () => {
    for (const to of ALL_TARGETS) {
      const r = compile(withLaterList().box(['Add', ['a', 'u'], 1]), {
        to,
        fallback: true,
      } as any);
      expect([to, r?.success ?? false]).toEqual([to, false]);
      // The GLSL fragment refuses the body before the emitter runs, with its
      // own message.
      expect((r as any).error).toMatch(
        to === 'glsl' ? /The body of the function `a` contradicts its declared result type/ : CONTRADICTED_SCALAR_POSITION
      );
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
      expect((r as any).error).toMatch(
        /says it returns a scalar .* but its body constructs a collection/
      );
    }
  );

  // CONTROL: the honest `(unknown) -> unknown` spelling of the SAME body keeps
  // its current behavior on JS — every shape compiles element-wise.
  // `matches('number')` is false for it, so the gate is structurally unable to
  // fire. Two element-wise spellings appear: the run-time
  // `_SYS.bcast`/`_SYS.eq`/`_SYS.select` dispatch, and — where the assignment
  // refines the call's type to `vector<2>`, so the compiler can count the
  // components — one expression per component, which reads them as `[0]`/`[1]`.
  test.each(ADJACENCIES)(
    'the `-> unknown` control still compiles `%s` on JS',
    (_name, mathjson) => {
      const ce = withDeclaration('(unknown) -> unknown');
      const expr = ce.box(mathjson);
      const r = compile(expr, { fallback: true });
      expect(r?.success).toBe(true);
      expect((r as any).code).toMatch(/_SYS\.(bcast|eq|select)|\[0\]/);
      const v = (r as any).run({ u: 0.3 });
      expect(Array.isArray(v)).toBe(true);
      expect(v).toHaveLength(2);
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
// fired. Since CE-707 (the declared result binds the body) JavaScript, Python
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
// interval-js (untyped arrow form, no lowering) are structurally untouched, and
// Python — which has no user-function lowering at all — could only ever gain a
// dynamically-typed `def`, with no return type to contradict.
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
  const CONTRADICTED_DEFINITION =
    /says it returns a scalar .* but its body constructs a collection.*the emitted definition would declare a scalar return type over a collection return value/s;

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
      expect((r as any).error).toMatch(/The body of the function `a` contradicts its declared result type/);
      // No preamble with a scalar return over a vector ships behind the
      // decline.
      expect((r as any).preamble ?? '').not.toContain('_fn_a');
    }
  );

  // CONTROL: the HONEST `-> unknown` spelling of the SAME body. Its type is not
  // `matches('number')`, so the gate is structurally unable to fire. The body
  // is a `List`, and the shader targets substitute a call of a LIST-bodied
  // helper whose every argument is provably scalar by its type (`u` is
  // declared `number`) with the helper's body
  // (`inlineCollectionValuedCallsAtRoot` in `base-compiler.ts`, asked for
  // `list<any>` bodies): a shader function cannot return a run-time list, so
  // the call site receives the body's own `vec2` constructor and no `_fn_a`
  // definition is emitted.
  test.each(['glsl'] as const)(
    'the `-> unknown` control still compiles bare `a(u)` on %s',
    (to) => {
      const ce = withDeclaration('(unknown) -> unknown');
      const r = compile(ce.box(['a', 'u']), { to, fallback: true } as any);
      expect(r?.success).toBe(true);
      expect((r as any).code).toBe('vec2(_gpu_cos(u), _gpu_sin(u))');
      expect((r as any).preamble ?? '').not.toContain('_fn_a');
    }
  );

  // CONTROL: the same honest spelling over a TUPLE body. A point-valued helper
  // keeps its own shared definition on the shader targets, and its return type
  // is synthesized from the body — `vec2`, legal shader source.
  test.each(['glsl'] as const)(
    'the `-> unknown` control over a Tuple body emits a `vec2` definition on %s',
    (to) => {
      const ce = new ComputeEngine();
      ce.declare('a', { signature: '(unknown) -> unknown' });
      ce.assign(
        'a',
        ce.box([
          'Function',
          ['Block', ['Tuple', ['Cos', 't'], ['Sin', 't']]],
          't',
        ])
      );
      ce.declare('u', 'number');
      const r = compile(ce.box(['a', 'u']), { to, fallback: true } as any);
      expect(r?.success).toBe(true);
      expect((r as any).code).toBe('_fn_a(u)');
      expect((r as any).preamble).toMatch(/vec2 _fn_a\(float t\)/);
    }
  );

  // CONTROL: a TRUTHFUL `-> number` head over a scalar body — no contradiction,
  // so the scalar declaration is emitted exactly as before.
  test.each(['glsl'] as const)(
    'a truthful `-> number` scalar body still emits its scalar declaration on %s',
    (to) => {
      const ce = new ComputeEngine();
      ce.declare('a', { signature: '(number) -> number' });
      ce.assign(
        'a',
        ce.box(['Function', ['Block', ['Add', ['Multiply', 2, 't'], 1]], 't'])
      );
      ce.declare('u', 'number');
      const r = compile(ce.box(['a', 'u']), { to, fallback: true } as any);
      expect(r?.success).toBe(true);
      expect((r as any).preamble).toMatch(
        to === 'glsl' ? /float _fn_a\(float t\)/ : /fn _fn_a\(t: f32\) -> f32/
      );
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
  const CONTRADICTED_SCALAR_POSITION =
    /says it returns a scalar .* but its body constructs a collection.*this scalar position would consume a run-time collection as a number/s;

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
          expect((r as any).error).toMatch(CONTRADICTED_SCALAR_POSITION);
          expect((r as any).error).toMatch(/'a'/);
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
        expect((r as any).error).toMatch(
          /says it returns a scalar .* but its body constructs a collection.*the numeric accumulation would produce a wrong value/s
        );
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
        expect((r as any).error).toMatch(
          /says it returns a scalar .* but its body constructs a collection/
        );
      });
    }
  );

  // CONTROL: a TRUTHFUL `-> number` clause set — no contradiction, so every
  // scalar position compiles and runs exactly as before.
  test('a truthful multi-clause scalar declaration is untouched', () => {
    const ce = withClauses('(number) -> number', 'truthful');
    const r = compile(ce.box(['Add', ['a', 'u'], 1]), { fallback: true });
    expect(r?.success).toBe(true);
    expect((r as any).code).toEqual('_fn_a(_.u) + 1');
    expect((r as any).run({ u: 3 })).toBe(8);
    const rs = compile(ce.box(['Sum', ['a', 'i'], ['Limits', 'i', 0, 2]]), {
      fallback: true,
    });
    expect(rs?.success).toBe(true);
    expect((rs as any).run({})).toBe(9);
    // Interpreter parity on the truthful control, on BOTH clause branches
    // (2026-08-12 ruling — the `real` branch decides at a concrete 0.3).
    expect(ce.box(['Add', ['a', 3], 1]).evaluate().re).toBe(8);
    expect(ce.box(['Add', ['a', 0.3], 1]).N().re).toBeCloseTo(2.6, 10);
  });

  // CONTROL: the HONEST `-> unknown` spelling of the SAME clause bodies. Its
  // type is not `matches('number')`, so the gate is structurally unable to
  // fire and the item-171 element-wise `_SYS.bcast` route is preserved.
  test('the `-> unknown` multi-clause control keeps the element-wise route', () => {
    const ce = withClauses('(number) -> unknown', 'lying');
    const r = compile(ce.box(['Add', ['a', 'u'], 1]), { fallback: true });
    expect(r?.success).toBe(true);
    expect((r as any).code).toContain('_SYS.bcast');
    const v = (r as any).run({ u: 0.3 });
    expect(v[0]).toBeCloseTo(Math.sin(0.3) + 1, 10);
    expect(v[1]).toBeCloseTo(Math.cos(0.3) + 1, 10);
  });
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
// `Block(Assign(…), Typed(List(…), 'number'))`).
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
  const ALL_TARGETS = ['javascript', 'glsl', 'python', 'interval-js'] as const;

  const CONTRADICTED_SCALAR_POSITION =
    /says it returns a scalar .* but its body constructs a collection.*this scalar position would consume a run-time collection as a number/s;
  const CONTRADICTED_DEFINITION =
    /says it returns a scalar .* but its body constructs a collection.*the emitted definition would declare a scalar return type over a collection return value/s;

  /**
   * `a` DECLARED scalar, ASSIGNED a MULTI-statement body whose last statement
   * constructs a list. `w` (not `u`) is the local, so it cannot collide with the
   * outer variable the call sites use.
   */
  const withDeclaration = (signature: string) => {
    const ce = new ComputeEngine();
    // `scope` spliced into the declared signature: the body binds `w` by
    // bare assignment, which the default-`!scope` ceiling otherwise refuses
    // on a bare declaration (docs/EFFECTS-MODEL.md, "Scope is opt-in"). The
    // scalar-vs-collection contradiction under test is unaffected.
    ce.declare('a', { signature: signature.replace('->', 'scope ->') });
    ce.assign(
      'a',
      ce.box([
        'Function',
        ['Block', ['Assign', 'w', ['Cos', 't']], ['List', 'w', ['Sin', 't']]],
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
        ['Block', ['Assign', 'w', ['Cos', 't']], ['h', 'w']],
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
    expect((r as any).error).toMatch(CONTRADICTED_SCALAR_POSITION);
    expect((r as any).error).toMatch(/'a'/);
    expect((r as any).error).toMatch(/-> list<number>/);
  });

  test.each(ALL_TARGETS)('%s declines `a(u) + 1`', (to) => {
    const r = compile(withLaterList().box(['Add', ['a', 'u'], 1]), {
      to,
      fallback: true,
    } as any);
    expect(r?.success ?? false).toBe(false);
    // The GLSL fragment refuses the body before the emitter runs, with its
    // own message.
    expect((r as any).error).toMatch(
      to === 'glsl' ? /The body of the function `a` contradicts its declared result type/ : CONTRADICTED_SCALAR_POSITION
    );
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
      expect((r as any).diagnostic?.code).toBe('outside-fragment');
      return;
    }
    expect((r as any).error).toMatch(
      /says it returns a scalar .* but its body constructs a collection.*the numeric accumulation would produce a wrong value/s
    );
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
      expect((r as any).error).toMatch(/The body of the function `a` contradicts its declared result type/);
      expect((r as any).preamble ?? '').not.toContain('_fn_a');
    }
  );

  // The interpreter refuses a call of `a`, so bare `a(u)` declines on
  // JavaScript too.
  test('bare `a(u)` declines on JavaScript', () => {
    const r = compile(withLaterList().box(['a', 'u']), { fallback: true });
    expect(r?.success ?? false).toBe(false);
    expect((r as any).error).toMatch(
      /says it returns a scalar .* but its body constructs a collection/
    );
  });

  // POSITIVE-EVIDENCE-ONLY: a `Return` in an EARLIER statement means the last
  // statement is not provably the block's value, so the predicate must see NO
  // evidence and the compile is left exactly as it was.
  test('a `Return` before the last statement is not evidence — no decline', () => {
    const ce = new ComputeEngine();
    ce.declare('a', { signature: '(number) -> number' });
    ce.assign(
      'a',
      ce.box([
        'Function',
        ['Block', ['Return', 0], ['List', ['Cos', 't'], ['Sin', 't']]],
        't',
      ])
    );
    ce.declare('u', 'number');
    const r = compile(ce.box(['Add', ['a', 'u'], 1]), { fallback: true });
    expect(r?.success).toBe(true);
    expect((r as any).code).toEqual('_fn_a(_.u) + 1');
  });

  // CONTROL: a TRUTHFUL multi-statement scalar body — no contradiction, so every
  // target compiles it exactly as before.
  test.each(['javascript', 'glsl'] as const)(
    '%s still compiles a TRUTHFUL multi-statement scalar body',
    (to) => {
      const ce = new ComputeEngine();
      // `scope` declared: `w` is bound by bare assignment (see
      // `withDeclaration` above).
      ce.declare('a', { signature: '(number) scope -> number' });
      ce.assign(
        'a',
        ce.box([
          'Function',
          ['Block', ['Assign', 'w', ['Multiply', 2, 't']], ['Add', 'w', 1]],
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

  // CONTROL: the HONEST `-> unknown` spelling of the SAME multi-statement body
  // keeps the item-171 element-wise `_SYS.bcast` route on JS.
  test('the `-> unknown` control keeps the element-wise route on JS', () => {
    const ce = withDeclaration('(unknown) -> unknown');
    const r = compile(ce.box(['Add', ['a', 'u'], 1]), { fallback: true });
    expect(r?.success).toBe(true);
    expect((r as any).code).toContain('_SYS.bcast');
  });
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
  const ALL_TARGETS = ['javascript', 'glsl', 'python', 'interval-js'] as const;

  const CONTRADICTED_CONDITION =
    /says it returns a scalar .* but its body constructs a collection.*this branch condition would select on the truthiness of a run-time collection/s;
  const CONTRADICTED_SCALAR_POSITION =
    /says it returns a scalar .* but its body constructs a collection.*this scalar position would consume a run-time collection as a number/s;
  const CONTRADICTED_DEFINITION =
    /says it returns a scalar .* but its body constructs a collection.*the emitted definition would declare a scalar return type over a collection return value/s;

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
            expect((r as any).diagnostic?.code).toBe('outside-fragment');
            continue;
          }
          expect((r as any).error).toMatch(CONTRADICTED_CONDITION);
          expect((r as any).error).toMatch(/'b'/);
          expect((r as any).error).toMatch(/-> list<number>/);
        }
      });

      // On glsl the definition check speaks first, because its
      // element-wise `Which` does not call `assertScalarCondition`. The
      // interval target checks each `Which` condition with
      // `assertScalarCondition`, and gives the condition message like the
      // JavaScript target.
      test.each(ALL_TARGETS)('%s declines `Which(b(u), 1, True, 2)`', (to) => {
        const r = compile(withLaterBody(body).box(WHICH('b')), {
          to,
          fallback: true,
        } as any);
        expect(r?.success ?? false).toBe(false);
        const error = (r as any).error as string;
        // The GLSL fragment refuses the condition before the emitter runs.
        if (to === 'glsl')
          expect((r as any).diagnostic?.code).toBe('outside-fragment');
        else expect(error).toMatch(CONTRADICTED_CONDITION);
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
            expect((r as any).diagnostic?.code).toBe('outside-fragment');
            continue;
          }
          expect((r as any).error).toMatch(CONTRADICTED_SCALAR_POSITION);
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
            expect((r as any).diagnostic?.code).toBe('outside-fragment');
          else
            expect((r as any).error).toMatch(
              /The body of the function `b` contradicts its declared result type/
            );
          expect((r as any).preamble ?? '').not.toContain('_fn_b');
        }
      );

      test('bare `b(u)` declines on JavaScript', () => {
        const r = compile(withLaterBody(body).box(['b', 'u']), {
          fallback: true,
        });
        expect(r?.success ?? false).toBe(false);
        expect((r as any).error).toMatch(
          /says it returns a scalar .* but its body constructs a collection/
        );
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

    test.each(['javascript', 'glsl'] as const)(
      '%s still compiles the SAME condition and operand shapes',
      (to) => {
        for (const [label, mathjson] of [
          ...CONDITIONS('p'),
          [`Which(p(u), 1, True, 2)`, WHICH('p')] as [string, any],
          ...OPERANDS('p'),
        ]) {
          const r = compile(genuine().box(mathjson), {
            to,
            fallback: true,
          } as any);
          expect([label, r?.success ?? false]).toEqual([label, true]);
        }
      }
    );

    test('the item-121 counting idiom `Σ p(i)` still compiles and runs', () => {
      const r = compile(
        genuine().box(['Sum', ['p', 'i'], ['Limits', 'i', 0, 3]]),
        { fallback: true }
      );
      expect(r?.success).toBe(true);
      expect((r as any).run({})).toEqual(2);
    });

    test('the item-121 comparison summand `Σ (x_i > 0)` still compiles and runs', () => {
      const ce = new ComputeEngine();
      ce.declare('x', 'list<number>');
      const r = compile(
        ce.box([
          'Sum',
          ['Greater', ['At', 'x', 'i'], 0],
          ['Limits', 'i', 1, 3],
        ]),
        { fallback: true }
      );
      expect(r?.success).toBe(true);
      expect((r as any).run({ x: [1, -2, 3] })).toEqual(2);
    });

    test('`If(p(u), 1, 2)` runs to the right branch on JS', () => {
      const r = compile(genuine().box(['If', ['p', 'u'], 1, 2]), {
        fallback: true,
      });
      expect(r?.success).toBe(true);
      expect((r as any).run({ u: 3 })).toEqual(1);
      expect((r as any).run({ u: 0 })).toEqual(2);
    });
  });

  // CONTROL: the HONEST `-> unknown` spelling of the SAME list body — not a
  // scalar declaration, so the gate is structurally unable to fire and the
  // item-171 element-wise route survives. The route is the COMPONENT one: the
  // assignment refines the call's type to `vector<2>`, and a width the
  // compiler can count is emitted as one expression per component instead of
  // a `_SYS.bcast` dispatch.
  test('the `-> unknown` control keeps the element-wise route on JS', () => {
    const ce = withBody(
      ['List', ['Cos', 't'], ['Sin', 't']],
      '(unknown) -> unknown'
    );
    const r = compile(ce.box(['Add', ['b', 'u'], 1]), { fallback: true });
    expect(r?.success).toBe(true);
    expect((r as any).code).toMatch(/\[0\] \+ 1/);
    const v = (r as any).run({ u: 0.3 });
    expect(v).toHaveLength(2);
    expect(v[0]).toBeCloseTo(Math.cos(0.3) + 1, 10);
    expect(v[1]).toBeCloseTo(Math.sin(0.3) + 1, 10);
  });
});

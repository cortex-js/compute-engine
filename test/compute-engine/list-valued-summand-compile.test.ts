import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// Tycho item 121: the js compile of a Sum whose terms are list-valued emitted
// plain scalar `+`/`*` over arrays (string concatenation / NaN) behind
// `success: true`. Root cause: numeric-argument validation
// (`checkNumericArgs`) inferred the scalar numeric context (`real`) onto a
// possibly-collection operand — `a(i·t)` with inferred result signature
// `vector<finite_number^2>` — WIDENING the shared definition to
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
    ce.parse('a(t)\\coloneq\\left[\\cos t,\\sin t\\right]').evaluate();
    // Creates a global inferred `t` — the poison that forced the binder
    // rewrite of B's body.
    ce.parse('2t');
    ce.parse('B(t)\\coloneq\\sum_{i=0}^{6}\\frac{1}{1.4^i}a(it)').evaluate();
    const a: any = ce.lookupDefinition('a');
    const B: any = ce.lookupDefinition('B');
    expect(a?.operator?.signature?.toString()).toEqual(
      '(unknown) -> vector<finite_number^2>'
    );
    expect(B?.operator?.signature?.toString()).toEqual(
      '(unknown) -> vector<finite_number^2>'
    );
  });

  test('scalar numeric inference is not disturbed by the guard', () => {
    const ce = new ComputeEngine();
    // An unknown symbol in numeric context is still consumed as a number
    // (the guard exempts only possibly-collection operands).
    expect(ce.parse('2q_a').type.toString()).toEqual('finite_number');
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
    ce.parse('a(t)\\coloneq\\left[\\cos t,\\sin t\\right]').evaluate();
    ce.parse(
      'h(i)\\coloneq\\operatorname{mod}(10^4\\sin(10^4i),1)'
    ).evaluate();
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

  test('`realOnly: true` never returns a non-number', () => {
    // The overload is typed `compile(expr, {realOnly: true}):
    // CompilationResult<T, number>`; it used to return the string "ababab".
    const ce = new ComputeEngine();
    const r = jsCompile(ce, ce.box(['Sum', { str: 'ab' }, ['Limits', 'i', 0, 2]]), {
      realOnly: true,
    });
    expect(r?.success ?? false).toBe(false);
  });

  test('numerically-accumulable bodies are NOT declined', () => {
    const ce = new ComputeEngine();
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
    ce2.parse('a(t)\\coloneq\\lbrack t,2t\\rbrack', { strict: false }).evaluate();
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
// "1,00.5403…,0.8414…-0.4161…,0.9092…" behind `success: true`, including under
// `realOnly: true`.
//
// The type-`unknown` spellings of the same shape (`Σ_i a(i)`, `Σ_i a(t+i)` —
// no nested call, so no lift wrapper) went through the gate's unknown arm,
// which already applied the item-86 look-through and declined on the `List`
// body, taking the element-wise `_SYS.bcast` fold. The nested-call spelling
// now matches them exactly.
describe('a list-valued call inside a big-op body is element-wise, not scalar (item 171)', () => {
  // The consumer registration shape: declare an open head, then assign the
  // lambda. It is what makes the declared result `unknown` rather than the
  // inferred `vector<finite_number^2>`.
  const setup = (hBody: any) => {
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

  test.each([
    ['identity', 'i'],
    ['affine', ['Add', 'i', 1]],
    ['mod(sin)', ['Mod', ['Multiply', 10000, ['Sin', ['Multiply', 10000, 'i']]], 1]],
  ])('`Sum a(h(i))` with h = %s agrees with the interpreter', (_label, hBody) => {
    const ce = setup(hBody);
    // The body is the lift-wrapped shape that used to slip the gate. Since
    // placeholder-signature refinement (2026-08-15) the declared `unknown`
    // results refine to the bodies' inferred types, so the shape is now
    // CONCRETELY vector-valued rather than `broadcastable<unknown>` — the
    // element-wise agreement below is what this test pins either way.
    const sumBody = (ce.box('A').value as any).ops[0].ops[0].ops[0];
    expect(sumBody.type.toString()).toMatch(/vector<finite_number\^2>/);

    const [x, y] = [...ce.parse('A(0.3)').N().each()].map((e) => e.re);
    // Both option shapes — `realOnly` is irrelevant to the emission.
    for (const opts of [{ realOnly: true }, undefined] as const) {
      const r = compile(ce.parse('A(t)', { strict: false }), {
        fallback: true,
        ...(opts ?? {}),
      });
      expect(r?.success).toBe(true);
      const v = (r as any).run({ t: 0.3 });
      // Was a JS string: `+` over the arrays `a` really returns.
      expect(typeof v).not.toEqual('string');
      expect(Array.isArray(v)).toBe(true);
      expect(v[0]).toBeCloseTo(x!, 10);
      expect(v[1]).toBeCloseTo(y!, 10);
    }
  });

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
      const r = compile(ce.parse('A(t)', { strict: false }), { fallback: true });
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
// routes the shape into the element-wise `_SYS.bcast` fold, but GLSL/WGSL,
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
// not even compile. WGSL emitted the same shape.
//
// The fix is a third clause on `assertScalarBigOpBody`
// (`isCollectionValuedBigOpBodyByLookThrough`), sharing the JS look-through's
// mechanism: it fires ONLY where an exemption is doing the admitting, and ONLY
// on POSITIVE evidence — the operator names a user function whose
// `Function`-literal body has a type that MATCHES a collection. Absence of
// evidence stays admitted, per the item-121 closure.
describe('list-valued big-op bodies decline on the non-JS targets (item 171 residue)', () => {
  const NON_JS = ['glsl', 'wgsl', 'python', 'interval-js'] as const;

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
    const r = compile(ce.box(['Sum', ['a', ['h', 'i']], ['Limits', 'i', 0, 2]]), {
      to,
      fallback: true,
      constantFold: false,
    } as any);
    expect(r?.success ?? false).toBe(false);
    expect((r as any).error).toMatch(/collection-valued body does not compile/);
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
    if (to !== 'python')
      expect((r as any).error).toMatch(
        /collection-valued body does not compile/
      );
  });

  test('JavaScript is unaffected — it still takes the element-wise fold', () => {
    const ce = setup();
    const r = compile(ce.box(['Sum', ['a', ['h', 'i']], ['Limits', 'i', 0, 2]]), {
      fallback: true,
      constantFold: false,
    });
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

  test.each(['javascript', 'glsl', 'wgsl', 'interval-js'] as const)(
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
//   glsl/wgsl   the same shape → a `vec2` sum returned from a `float` function,
//               i.e. shader source that does not even compile
//   python      declined for an unrelated reason ("Unknown operator `a`")
//   interval-js declined for an unrelated reason (no `List` lowering)
//
// RULED: when the compiler can PROVE the declared return type is contradicted
// by the body, it declines (D6) on ALL targets INCLUDING JavaScript — "decline,
// run interpreted" over "compile what the body does". Declarations stay
// authoritative everywhere else; we only refuse to emit code we can prove wrong.
// This is the one place JS emission deliberately CHANGES (garbage → decline);
// the ruled item-121 exemptions are untouched, because `matches('number')` is
// disjoint from every one of them.
describe('a declaration contradicted by its body declines everywhere (2026-08-12 ruling)', () => {
  const ALL = ['javascript', 'glsl', 'wgsl', 'python', 'interval-js'] as const;
  const CONTRADICTED = /says it returns a scalar .* but its body constructs a collection/;

  /** `a` DECLARED scalar, ASSIGNED a list-constructing body. */
  const lying = () => {
    const ce = new ComputeEngine();
    ce.declare('a', { signature: '(number) -> number' });
    ce.assign(
      'a',
      ce.box(['Function', ['Block', ['List', ['Cos', 't'], ['Sin', 't']]], 't'])
    );
    return ce;
  };

  // `constantFold: false` on the probes below: every one of these Sums has no
  // free variables, so compile-time constant folding would answer it from the
  // interpreter and report success with a literal, short-circuiting both the
  // decline being pinned and the `_SYS.bcast` emission of the controls.
  test.each(ALL)('%s declines the lying-declaration Sum', (to) => {
    const ce = lying();
    const r = compile(ce.box(['Sum', ['a', 'i'], ['Limits', 'i', 0, 2]]), {
      to,
      fallback: true,
      constantFold: false,
    } as any);
    expect(r?.success ?? false).toBe(false);
    // The message names both halves and suggests the fix.
    expect((r as any).error).toMatch(CONTRADICTED);
    expect((r as any).error).toMatch(/'a'/);
    expect((r as any).error).toMatch(/-> list<number>/);
  });

  test('every JS lowering declines: unrolled, looped, Product, realOnly', () => {
    const ce = lying();
    ce.declare('n', 'number');
    for (const expr of [
      ce.box(['Sum', ['a', 'i'], ['Limits', 'i', 0, 2]]), // unrolled
      ce.box(['Sum', ['a', 'i'], ['Limits', 'i', 0, 'n']]), // looped
      ce.box(['Product', ['a', 'i'], ['Limits', 'i', 0, 2]]),
    ]) {
      for (const opts of [{}, { realOnly: true }]) {
        const r = compile(expr, {
          fallback: true,
          constantFold: false,
          ...opts,
        } as any);
        expect(r?.success ?? false).toBe(false);
        expect((r as any).error).toMatch(CONTRADICTED);
      }
    }
  });

  // The `-> unknown` (item 171) and lying `-> number` shapes must not get
  // tangled: the first compiles CORRECTLY on JS and declines on the non-JS
  // targets with the OPEN-result-type message; the second declines everywhere
  // with the contradicted-declaration message.
  test('the `-> unknown` shape is unchanged — JS still folds element-wise', () => {
    const ce = new ComputeEngine();
    for (const id of ['h', 'a']) ce.declare(id, { signature: '(unknown) -> unknown' });
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

  test.each(['glsl', 'wgsl', 'python', 'interval-js'] as const)(
    '%s declines the (formerly open) collection shape on its OWN message, not the contradicted one',
    (to) => {
      const ce = new ComputeEngine();
      for (const id of ['h', 'a'])
        ce.declare(id, { signature: '(unknown) -> unknown' });
      ce.assign('h', ce.box(['Function', ['Block', 'i'], 'i']));
      ce.assign(
        'a',
        ce.box(['Function', ['Block', ['List', ['Cos', 't'], ['Sin', 't']]], 't'])
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
      expect((r as any).error).toMatch(/collection-valued body does not compile/);
      expect((r as any).error).not.toMatch(CONTRADICTED);
    }
  );

  // A TRUTHFUL `-> number` head over a scalar body is the ordinary case and
  // must keep compiling. (Python is omitted: it has no user-function lowering
  // at all and declines with "Unknown operator `a`" independently of this
  // change — the same carve-out the exemption tests above use.)
  test.each(['javascript', 'glsl', 'wgsl', 'interval-js'] as const)(
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
    expect((expr as any).ops[0].type.toString()).toEqual('list<number>');
    const r = compile(expr, { fallback: true, constantFold: false });
    expect(r?.success).toBe(true);
    expect((r as any).code).toContain('_SYS.bcast');
    const v = (r as any).run({});
    const [x, y] = [...expr.N().each()].map((e) => e.re);
    expect(v[0]).toBeCloseTo(x!, 10);
    expect(v[1]).toBeCloseTo(y!, 10);
  });

  test.each(['glsl', 'wgsl', 'python', 'interval-js'] as const)(
    '%s declines a truthful `-> list<number>` on the FIRST clause',
    (to) => {
      const r = compile(
        truthfulList().box(['Sum', ['a', 'i'], ['Limits', 'i', 0, 2]]),
        { to, fallback: true, constantFold: false } as any
      );
      expect(r?.success ?? false).toBe(false);
      expect((r as any).error).toMatch(/collection-valued body does not compile/);
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
//   shape              javascript                        glsl / wgsl
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
describe('a contradicted scalar declaration declines in every scalar position (2026-08-12 ruling, wave 2)', () => {
  const ALL_TARGETS = [
    'javascript',
    'glsl',
    'wgsl',
    'python',
    'interval-js',
  ] as const;

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

  test.each(ADJACENCIES)('javascript declines `%s`', (_name, mathjson) => {
    const ce = withDeclaration('(number) -> number');
    const r = compile(ce.box(mathjson), { fallback: true });
    expect(r?.success ?? false).toBe(false);
    expect((r as any).error).toMatch(CONTRADICTED_SCALAR_POSITION);
    expect((r as any).error).toMatch(/'a'/);
    expect((r as any).error).toMatch(/-> list<number>/);
  });

  test.each(ALL_TARGETS)('%s declines `a(u) + 1`', (to) => {
    const ce = withDeclaration('(number) -> number');
    const r = compile(ce.box(['Add', ['a', 'u'], 1]), {
      to,
      fallback: true,
    } as any);
    expect(r?.success ?? false).toBe(false);
    expect((r as any).error).toMatch(CONTRADICTED_SCALAR_POSITION);
  });

  // The one shape the ruling protects: the application as the WHOLE compiled
  // expression is CORRECT on JavaScript today (the result coercion hands the
  // array back), so declining it would be a regression.
  test('bare `a(u)` still compiles and runs to the correct array on JS', () => {
    const ce = withDeclaration('(number) -> number');
    const expr = ce.box(['a', 'u']);
    const r = compile(expr, { fallback: true });
    expect(r?.success).toBe(true);
    expect((r as any).code).toEqual('_fn_a(_.u)');
    const v = (r as any).run({ u: 0.3 });
    expect(v[0]).toBeCloseTo(Math.cos(0.3), 10);
    expect(v[1]).toBeCloseTo(Math.sin(0.3), 10);
  });

  // Container / access positions do NOT consume their operand as a scalar and
  // are not in the head classification the gate uses. Probed correct today, so
  // they must keep compiling — this pins the gate's narrowness.
  test.each([
    ['[a(u), 1]', ['List', ['a', 'u'], 1]],
    ['Block(a(u))', ['Block', ['a', 'u']]],
  ] as [string, any][])('`%s` keeps compiling on JS', (_name, mathjson) => {
    const ce = withDeclaration('(number) -> number');
    const r = compile(ce.box(mathjson), { fallback: true });
    expect(r?.success).toBe(true);
    const v = (r as any).run({ u: 0.3 });
    const point = Array.isArray(v[0]) ? v[0] : v;
    expect(point[0]).toBeCloseTo(Math.cos(0.3), 10);
    expect(point[1]).toBeCloseTo(Math.sin(0.3), 10);
  });

  // CONTROL: the honest `(unknown) -> unknown` spelling of the SAME body keeps
  // its current behavior on JS — every shape compiles element-wise through
  // `_SYS.bcast`/`_SYS.eq`/`_SYS.select`. `matches('number')` is false for it,
  // so the gate is structurally unable to fire.
  test.each(ADJACENCIES)(
    'the `-> unknown` control still compiles `%s` on JS',
    (_name, mathjson) => {
      const ce = withDeclaration('(unknown) -> unknown');
      const expr = ce.box(mathjson);
      const r = compile(expr, { fallback: true });
      expect(r?.success).toBe(true);
      expect((r as any).code).toMatch(/_SYS\.(bcast|eq|select)/);
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
// fired. On JavaScript that is CORRECT and ruled KEPT (the result coercion hands
// the array back). On the shader targets it was not: the definition is still
// emitted, and its return type is synthesized from the body's DECLARED type
// while its `return` emits what the body actually builds. Measured BEFORE this
// gate, `compile(a(u))` reported `success: true` with the preamble
//
//     glsl:  float _fn_a(float t) { return vec2(cos(t), sin(t)); }
//     wgsl:  fn _fn_a(t: f32) -> f32 { return vec2f(cos(t), sin(t)); }
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
describe('a contradicted scalar declaration declines at DEFINITION emission (2026-08-12 ruling, wave 3)', () => {
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

  test.each(['glsl', 'wgsl'] as const)(
    '%s declines the bare `a(u)` instead of emitting a scalar-declared vec2 return',
    (to) => {
      const ce = withDeclaration('(number) -> number');
      const r = compile(ce.box(['a', 'u']), { to, fallback: true } as any);
      expect(r?.success ?? false).toBe(false);
      expect((r as any).error).toMatch(CONTRADICTED_DEFINITION);
      expect((r as any).error).toMatch(/'a'/);
      expect((r as any).error).toMatch(/-> list<number>/);
      // The whole point: no broken preamble ships behind the decline.
      expect((r as any).preamble ?? '').not.toContain('_fn_a');
    }
  );

  // INVARIANT (ruled KEPT): the same bare shape on JavaScript compiles and runs
  // to the correct array — byte-identical to before the gate.
  test('bare `a(u)` is untouched on JavaScript', () => {
    const ce = withDeclaration('(number) -> number');
    const r = compile(ce.box(['a', 'u']), { fallback: true });
    expect(r?.success).toBe(true);
    expect((r as any).code).toEqual('_fn_a(_.u)');
    const v = (r as any).run({ u: 0.3 });
    expect(v[0]).toBeCloseTo(Math.cos(0.3), 10);
    expect(v[1]).toBeCloseTo(Math.sin(0.3), 10);
  });

  // CONTROL: the HONEST `-> unknown` spelling of the SAME body. Its type is not
  // `matches('number')`, so the gate is structurally unable to fire, and the GPU
  // return type is then synthesized from the body — `vec2`, legal shader source.
  test.each(['glsl', 'wgsl'] as const)(
    'the `-> unknown` control still compiles bare `a(u)` on %s',
    (to) => {
      const ce = withDeclaration('(unknown) -> unknown');
      const r = compile(ce.box(['a', 'u']), { to, fallback: true } as any);
      expect(r?.success).toBe(true);
      expect((r as any).preamble).toMatch(
        to === 'glsl' ? /vec2 _fn_a\(float t\)/ : /fn _fn_a\(t: f32\) -> vec2f/
      );
    }
  );

  // CONTROL: a TRUTHFUL `-> number` head over a scalar body — no contradiction,
  // so the scalar declaration is emitted exactly as before.
  test.each(['glsl', 'wgsl'] as const)(
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

  // The decline is at EMISSION, so it also covers the consuming shapes wave 2
  // gates — whichever gate speaks first, nothing wrong is emitted.
  test.each(['glsl', 'wgsl'] as const)('%s still declines `a(u) + 1`', (to) => {
    const ce = withDeclaration('(number) -> number');
    const r = compile(ce.box(['Add', ['a', 'u'], 1]), {
      to,
      fallback: true,
    } as any);
    expect(r?.success ?? false).toBe(false);
    expect((r as any).error).toMatch(
      /says it returns a scalar .* but its body constructs a collection/s
    );
  });
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
// multi-clause application on GLSL/WGSL already failed closed with its own
// "no lowering" diagnostic and wave 3's `staticReturnType` route is
// structurally unreachable for a clause set. The GPU declines below therefore
// only pin that it STAYS closed, whichever diagnostic speaks first.
describe('a contradicted scalar declaration declines for a MULTI-CLAUSE function (2026-08-12 ruling, wave 4)', () => {
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

  const SCALAR_POSITIONS: [string, any][] = [
    ['a(u) + 1', ['Add', ['a', 'u'], 1]],
    ['2·a(u)', ['Multiply', 2, ['a', 'u']]],
    ['sin(a(u))', ['Sin', ['a', 'u']]],
    ['a(u) < 1', ['Less', ['a', 'u'], 1]],
  ];

  describe.each(['lying', 'mixed'] as const)(
    'a %s clause set',
    (kind) => {
      // MIXED is the design call: only the `real` clause contradicts, so the
      // declaration holds on the integer branch. Declining anyway is the
      // conservative, fail-closed direction AND what the measurement forces —
      // the consuming position compiles ONCE, statically, for every branch.
      // Measured before the gate, mixed `a(u) + 1` ran to `8` at `u = 3` and to
      // the string `"0.29552…,0.955336…1"` at `u = 0.3`: there is no per-branch
      // code to keep, so the branch that is wrong decides.
      test.each(SCALAR_POSITIONS)(
        'declines `%s` on JavaScript',
        (_label, expr) => {
          const ce = withClauses('(number) -> number', kind);
          const r = compile(ce.box(expr), { fallback: true });
          expect(r?.success ?? false).toBe(false);
          expect((r as any).error).toMatch(CONTRADICTED_SCALAR_POSITION);
          expect((r as any).error).toMatch(/'a'/);
        }
      );

      test('declines the big-op body `Σ a(i)` on JavaScript (wave-1 message)', () => {
        const ce = withClauses('(number) -> number', kind);
        // `constantFold: false`: the sum has no free variables, so
        // compile-time constant folding would answer it from the interpreter
        // and report success, bypassing the static decline under test.
        const r = compile(ce.box(['Sum', ['a', 'i'], ['Limits', 'i', 0, 2]]), {
          fallback: true,
          constantFold: false,
        });
        expect(r?.success ?? false).toBe(false);
        expect((r as any).error).toMatch(
          /says it returns a scalar .* but its body constructs a collection.*the numeric accumulation would produce a wrong value/s
        );
      });

      test.each(['glsl', 'wgsl'] as const)('stays closed on %s', (to) => {
        const ce = withClauses('(number) -> number', kind);
        const r = compile(ce.box(['Add', ['a', 'u'], 1]), {
          to,
          fallback: true,
        } as any);
        expect(r?.success ?? false).toBe(false);
        // No preamble ships behind the decline, whichever gate spoke.
        expect((r as any).preamble ?? '').not.toContain('_fn_a');
      });
    }
  );

  // INVARIANT (the wave-3 carve-out, unchanged here): the BARE application has
  // no consuming head, the JS result coercion hands the array back, and it runs
  // correctly — on BOTH branches of a mixed clause set.
  test('bare `a(u)` still compiles and dispatches correctly on JavaScript', () => {
    const ce = withClauses('(number) -> number', 'mixed');
    const r = compile(ce.box(['a', 'u']), { fallback: true });
    expect(r?.success).toBe(true);
    expect((r as any).code).toEqual('_fn_a(_.u)');
    // Integer branch: the truthful scalar clause.
    expect((r as any).run({ u: 3 })).toBe(7);
    // Real branch: the list-constructing clause, returned intact.
    const v = (r as any).run({ u: 0.3 });
    expect(v[0]).toBeCloseTo(Math.sin(0.3), 10);
    expect(v[1]).toBeCloseTo(Math.cos(0.3), 10);
    // The INTERPRETER agrees on both branches (USER RULING 2026-08-12: a
    // fully-known value never keeps dispatch inert — `a(0.3)` used to stay
    // inert because `0.3` against the `integer` clause was undecidable, so
    // this row could only be asserted compiled).
    expect(ce.box(['a', 3]).evaluate().re).toBe(7);
    const iv = [...ce.box(['a', 0.3]).N().each()].map((e) => e.re);
    expect(iv[0]).toBeCloseTo(Math.sin(0.3), 10);
    expect(iv[1]).toBeCloseTo(Math.cos(0.3), 10);
  });

  // INVARIANT: a CONTAINER position is not a scalar position (wave 2's ruled
  // carve-out), so it keeps compiling for a clause set too.
  test('a container position `[a(u), 1]` still compiles on JavaScript', () => {
    const ce = withClauses('(number) -> number', 'lying');
    const r = compile(ce.box(['List', ['a', 'u'], 1]), { fallback: true });
    expect(r?.success).toBe(true);
    expect((r as any).code).toEqual('[_fn_a(_.u), 1]');
  });

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
//     wgsl bare a(u)    →  fn _fn_a(t: f32) -> f32 { … return vec2f(w, sin(t)); }
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
describe('a contradicted scalar declaration is seen through a MULTI-STATEMENT body (2026-08-12 ruling, wave 5)', () => {
  const ALL_TARGETS = [
    'javascript',
    'glsl',
    'wgsl',
    'python',
    'interval-js',
  ] as const;

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

  test('the stored body really is a two-statement block ending in the list', () => {
    const ce = withDeclaration('(number) -> number');
    const literal = (ce.lookupDefinition('a') as any)?.value?.value;
    expect(literal.ops[0].operator).toEqual('Block');
    expect(literal.ops[0].nops).toEqual(2);
    // The declaration's ascription wraps the LAST statement, not the block.
    expect(literal.ops[0].ops[1].operator).toEqual('Typed');
    expect(literal.ops[0].ops[1].ops[0].operator).toEqual('List');
    // The interpreter does not coerce: `a` really answers a 2-list.
    const v = [...ce.box(['a', 0.3]).N().each()].map((e) => e.re);
    expect(v[0]).toBeCloseTo(Math.cos(0.3), 10);
    expect(v[1]).toBeCloseTo(Math.sin(0.3), 10);
  });

  // The wave-2 shape matrix, now over the multi-statement body.
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
    const ce = withDeclaration('(number) -> number');
    const r = compile(ce.box(mathjson), { fallback: true });
    expect(r?.success ?? false).toBe(false);
    expect((r as any).error).toMatch(CONTRADICTED_SCALAR_POSITION);
    expect((r as any).error).toMatch(/'a'/);
    expect((r as any).error).toMatch(/-> list<number>/);
  });

  test.each(ALL_TARGETS)('%s declines `a(u) + 1`', (to) => {
    const ce = withDeclaration('(number) -> number');
    const r = compile(ce.box(['Add', ['a', 'u'], 1]), {
      to,
      fallback: true,
    } as any);
    expect(r?.success ?? false).toBe(false);
    expect((r as any).error).toMatch(CONTRADICTED_SCALAR_POSITION);
  });

  // Wave 1 (the big-op body clause) reads the same predicate, so it inherits it.
  test.each(ALL_TARGETS)('%s declines the big-op body `Σ a(i)`', (to) => {
    const ce = withDeclaration('(number) -> number');
    const r = compile(ce.box(['Sum', ['a', 'i'], ['Limits', 'i', 0, 2]]), {
      to,
      fallback: true,
    } as any);
    expect(r?.success ?? false).toBe(false);
    expect((r as any).error).toMatch(
      /says it returns a scalar .* but its body constructs a collection.*the numeric accumulation would produce a wrong value/s
    );
  });

  // Wave 3 (the DEFINITION-emission backstop) reads it too, so the bare call no
  // longer ships `float _fn_a(float t) { … return vec2(…); }`.
  test.each(['glsl', 'wgsl'] as const)(
    '%s declines the bare `a(u)` at definition emission',
    (to) => {
      const ce = withDeclaration('(number) -> number');
      const r = compile(ce.box(['a', 'u']), { to, fallback: true } as any);
      expect(r?.success ?? false).toBe(false);
      expect((r as any).error).toMatch(CONTRADICTED_DEFINITION);
      expect((r as any).preamble ?? '').not.toContain('_fn_a');
    }
  );

  // INVARIANT (the ruled wave-3 carve-out): bare `a(u)` on JavaScript has no
  // consuming head and keeps compiling.
  test('bare `a(u)` still compiles on JavaScript', () => {
    const ce = withDeclaration('(number) -> number');
    const r = compile(ce.box(['a', 'u']), { fallback: true });
    expect(r?.success).toBe(true);
    expect((r as any).code).toEqual('_fn_a(_.u)');
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
  test.each(['javascript', 'glsl', 'wgsl'] as const)(
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
//   shape                   javascript                    glsl / wgsl
//   ----------------------  ----------------------------  ------------------------
//   `If(b(u), 1, 2)`        `1` — the WRONG branch, off    `bool _fn_b(float t) {
//                           the truthiness of an ARRAY       return vec2(…); }`
//   `Which(b(u), 1, T, 2)`  `1` — same                     same broken preamble
//   `When(1, b(u))`         same                           same
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
// `If` and `guardCondition` (Which/When) already funnel through, since `If`/
// `Which`/`When` are not in `assertNoContradictedScalarOperand`'s head
// classification.
//
// Exemption-safety: widening to `boolean` cannot touch the ruled item-121
// boolean exemption, because the gate ADDITIONALLY requires the body
// look-through to PROVE a collection constructor — which a genuine boolean body
// (a comparison) never produces. Pinned by the controls below.
describe('a contradicted BOOLEAN declaration declines in every scalar position (2026-08-12 ruling, wave 6)', () => {
  const ALL_TARGETS = [
    'javascript',
    'glsl',
    'wgsl',
    'python',
    'interval-js',
  ] as const;

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

  test.each(LYING_BODIES)(
    'the `%s` body really types `boolean` while answering a 2-list',
    (_name, body) => {
      const ce = withBody(body);
      expect(ce.box(['b', 'u']).type.toString()).toEqual('boolean');
      expect(ce.box(['b', 0.3]).evaluate().nops).toEqual(2);
    }
  );

  /**
   * The positions, as builders over the callee name so the genuine-boolean
   * CONTROL below can reuse exactly the same shapes.
   *
   * `If`/`When` are `assertScalarCondition`'s callers on every target.
   * `Which` is listed separately: the GPU lowering is its OWN element-wise
   * entry and never reaches that guard, so glsl/wgsl close it one gate later
   * (the wave-3 DEFINITION backstop, now reading the same `boolean` arm), and
   * interval-js declines earlier still on its pre-existing "no `List` lowering".
   * Measured, not assumed.
   */
  const CONDITIONS = (f: string): [string, any][] => [
    [`If(${f}(u), 1, 2)`, ['If', [f, 'u'], 1, 2]],
    [`When(1, ${f}(u))`, ['When', 1, [f, 'u']]],
  ];
  const WHICH = (f: string): any => ['Which', [f, 'u'], 1, 'True', 2];

  /** The scalar-OPERAND positions — `assertNoContradictedScalarOperand`. */
  const OPERANDS = (f: string): [string, any][] => [
    [`Not(${f}(u))`, ['Not', [f, 'u']]],
    [`And(${f}(u), True)`, ['And', [f, 'u'], 'True']],
    [`${f}(u) = True`, ['Equal', [f, 'u'], 'True']],
  ];

  describe.each(LYING_BODIES)('with the `%s` body', (_bodyName, body) => {
    test.each(ALL_TARGETS)('%s declines the CONDITION shapes', (to) => {
      for (const [label, mathjson] of CONDITIONS('b')) {
        const r = compile(withBody(body).box(mathjson), {
          to,
          fallback: true,
        } as any);
        expect([label, r?.success ?? false]).toEqual([label, false]);
        expect((r as any).error).toMatch(CONTRADICTED_CONDITION);
        expect((r as any).error).toMatch(/'b'/);
        expect((r as any).error).toMatch(/-> list<number>/);
      }
    });

    // `Which`, per the measured table: the same contradiction closes it on every
    // target, but on glsl/wgsl the DEFINITION backstop speaks first (their
    // element-wise `Which` entry bypasses `assertScalarCondition`), and on
    // interval-js the pre-existing no-`List`-lowering decline does.
    test.each(ALL_TARGETS)('%s declines `Which(b(u), 1, True, 2)`', (to) => {
      const r = compile(withBody(body).box(WHICH('b')), {
        to,
        fallback: true,
      } as any);
      expect(r?.success ?? false).toBe(false);
      const error = (r as any).error as string;
      if (to === 'glsl' || to === 'wgsl')
        expect(error).toMatch(CONTRADICTED_DEFINITION);
      else if (to === 'interval-js')
        expect(error).toMatch(/no lowering for it/);
      else expect(error).toMatch(CONTRADICTED_CONDITION);
    });

    test.each(ALL_TARGETS)('%s declines the scalar-OPERAND shapes', (to) => {
      for (const [label, mathjson] of OPERANDS('b')) {
        const r = compile(withBody(body).box(mathjson), {
          to,
          fallback: true,
        } as any);
        expect([label, r?.success ?? false]).toEqual([label, false]);
        expect((r as any).error).toMatch(CONTRADICTED_SCALAR_POSITION);
      }
    });

    // The wave-3 DEFINITION backstop, now reading the `boolean` arm: no
    // `bool _fn_b(float t) { return vec2(…); }` ships behind a reported success.
    test.each(['glsl', 'wgsl'] as const)(
      '%s declines the bare `b(u)` at definition emission',
      (to) => {
        const r = compile(withBody(body).box(['b', 'u']), {
          to,
          fallback: true,
        } as any);
        expect(r?.success ?? false).toBe(false);
        expect((r as any).error).toMatch(CONTRADICTED_DEFINITION);
        expect((r as any).preamble ?? '').not.toContain('_fn_b');
      }
    );
  });

  // INVARIANT (the ruled carve-out, measured): bare `b(u)` on JavaScript has no
  // consuming head, the result coercion hands the array back, and it is correct
  // today — so it must keep compiling.
  test('bare `b(u)` still compiles and runs to the array on JavaScript', () => {
    const ce = withBody(['List', ['Cos', 't'], ['Sin', 't']]);
    const r = compile(ce.box(['b', 'u']), { fallback: true });
    expect(r?.success).toBe(true);
    expect((r as any).code).toEqual('_fn_b(_.u)');
    const v = (r as any).run({ u: 0.3 });
    expect(v[0]).toBeCloseTo(Math.cos(0.3), 10);
    expect(v[1]).toBeCloseTo(Math.sin(0.3), 10);
  });

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

    test.each(['javascript', 'glsl', 'wgsl'] as const)(
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
        ce.box(['Sum', ['Greater', ['At', 'x', 'i'], 0], ['Limits', 'i', 1, 3]]),
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
  // item-171 element-wise route survives.
  test('the `-> unknown` control keeps the element-wise route on JS', () => {
    const ce = withBody(
      ['List', ['Cos', 't'], ['Sin', 't']],
      '(unknown) -> unknown'
    );
    const r = compile(ce.box(['Add', ['b', 'u'], 1]), { fallback: true });
    expect(r?.success).toBe(true);
    expect((r as any).code).toContain('_SYS.bcast');
  });
});

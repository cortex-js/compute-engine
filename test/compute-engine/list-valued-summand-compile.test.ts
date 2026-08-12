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
    // The body is the lift-wrapped shape that used to slip the gate.
    const sumBody = (ce.box('A').value as any).ops[0].ops[0].ops[0];
    expect(sumBody.type.toString()).toEqual('broadcastable<unknown>');

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

  test.each(NON_JS)('%s declines `Sum a(h(i))` (direct form)', (to) => {
    const ce = setup();
    const r = compile(ce.box(['Sum', ['a', ['h', 'i']], ['Limits', 'i', 0, 2]]), {
      to,
      fallback: true,
    } as any);
    expect(r?.success ?? false).toBe(false);
    expect((r as any).error).toMatch(/collection-valued body does not compile/);
  });

  test.each(NON_JS)('%s declines the `A(t)` wrapper form', (to) => {
    const ce = setup();
    const r = compile(ce.parse('A(t)', { strict: false }), {
      to,
      fallback: true,
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

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

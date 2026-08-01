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

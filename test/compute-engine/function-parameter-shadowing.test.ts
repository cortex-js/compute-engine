/**
 * Regression tests: a function parameter shadows whatever its name means in the
 * enclosing scope — a constant (`i`, `e`, `Pi`), an assigned variable, or
 * nothing. This is standard lexical scoping.
 *
 * Previously the body of a function literal was canonicalized *before* its
 * parameters were registered, so a parameter named like a constant was rewritten
 * to the constant and the binding was lost — e.g. `λi. 2·i` applied to 5
 * returned `2i` (the imaginary unit doubled) instead of 10.
 *
 * The fix records the parameter names on the engine's shadowed-parameter stack
 * while the body is canonicalized, so such a name resolves to an ordinary local
 * variable instead of the constant — without creating early value-defs, so the
 * closure-capture machinery is unaffected.
 */

import { ComputeEngine } from '../../src/compute-engine';

const apply = (ce: ComputeEngine, f: unknown, arg: number) =>
  ce.box(['Apply', f, arg] as any).evaluate();

describe('Function parameter shadows a same-named constant', () => {
  it('λi. 2·i — `i` is the parameter, not the imaginary unit', () => {
    const ce = new ComputeEngine();
    const f = ce.box(['Function', ['Multiply', 2, 'i'], 'i']);
    // The body keeps `i` as a variable instead of folding to 2i.
    expect(f.json).toEqual(['Function', ['Block', ['Multiply', 2, 'i']], 'i']);
    expect(apply(ce, f, 5).valueOf()).toBe(10);
  });

  it('λe. 2·e — `e` is the parameter, not Euler’s number', () => {
    const ce = new ComputeEngine();
    const f = ce.box(['Function', ['Multiply', 2, 'e'], 'e']);
    expect(apply(ce, f, 5).valueOf()).toBe(10);
  });

  it('λPi. Pi + 1 — the canonical constant symbol is shadowed too', () => {
    const ce = new ComputeEngine();
    const f = ce.box(['Function', ['Add', 'Pi', 1], 'Pi']);
    expect(apply(ce, f, 10).valueOf()).toBe(11);
  });

  it('λPi. Pi + 1 — the `ce.function` route, with an ALREADY canonical body', () => {
    // The body is canonicalized before the literal exists, so its `Pi` is the
    // constant when it arrives; only the parameter repair can make it the
    // parameter. It could not while it built the replacement with
    // `ce.symbol('Pi')` (which is the interned constant), and this returned
    // `1 + π`.
    const ce = new ComputeEngine();
    const f = ce.function('Function', [ce.parse('\\pi + 1'), ce.symbol('Pi')]);
    expect(apply(ce, f, 10).valueOf()).toBe(11);
  });

  it('LaTeX `\\pi \\mapsto 2\\pi` — `\\pi` maps to `Pi` in both positions', () => {
    const ce = new ComputeEngine();
    const f = ce.parse('\\pi \\mapsto 2\\pi');
    expect(f.json).toEqual(['Function', ['Block', ['Multiply', 2, 'Pi']], 'Pi']);
    expect(apply(ce, f, 5).valueOf()).toBe(10);
  });

  it('a parameter shadows an assigned variable of the same name', () => {
    const ce = new ComputeEngine();
    ce.assign('w', 5);
    const f = ce.box(['Function', ['Add', 'w', 1], 'w']);
    expect(apply(ce, f, 10).valueOf()).toBe(11);
  });
});

/**
 * An ANNOTATED parameter — `["Typed", name, type]`, and the signature-string
 * sugar that desugars into it — shields a constant-named parameter exactly as
 * the bare spelling does.
 *
 * Two defects made the annotated spelling lose the shield while the bare one
 * kept it:
 *
 * - The parameter declaration in `canonicalFunctionLiteralArguments` adopted
 *   the binding the body's references had auto-declared only for a BARE
 *   parameter. An annotated one always got a fresh binding, so when the first
 *   reference sat in a nested scope (the body of an inner lambda) the two
 *   differed, the parameter-repair rewrite re-boxed those occurrences, and a
 *   re-boxed `i` came back as the imaginary unit. `IdentityMatrix(1000000)`,
 *   whose lazy form is a nested `Tabulate` over row index `i`, evaluated to an
 *   all-zero matrix.
 * - `desugarSignatureString` built its parameter symbols canonically, and
 *   `ce.symbol('i')` is the imaginary-unit NUMBER literal, not a symbol — so
 *   `"'(i: integer) -> integer'"` reported `expected-a-symbol`.
 */
describe('An ANNOTATED parameter shadows a same-named constant too', () => {
  const typed = (name: string) => ['Typed', name, "'integer'"];

  // The row index of a nested lazy tabulation: the parameter's only reference
  // sits inside an inner lambda's body, which is the arrangement that broke.
  // The inner tabulation is long enough to stay lazy, so applying the outer
  // lambda returns a `Tabulate` whose cell still mentions the parameter.
  const nested = (name: string, param: unknown) => [
    'Function',
    ['Tabulate', ['Function', ['Add', name, 1000], 'j'], 1000000],
    param,
  ];

  it('λ(i: integer). … — a NESTED reference is the parameter, not the imaginary unit', () => {
    const ce = new ComputeEngine();
    const row = apply(ce, ce.box(nested('i', typed('i')) as any), 3);
    expect(ce.box(['At', row, 1]).evaluate().valueOf()).toBe(1003);
  });

  it('λi. … — the bare spelling still shields the same nested reference', () => {
    const ce = new ComputeEngine();
    const row = apply(ce, ce.box(nested('i', 'i') as any), 3);
    expect(ce.box(['At', row, 1]).evaluate().valueOf()).toBe(1003);
  });

  it('λ(e: integer). … — `e` is the parameter, not Euler’s number', () => {
    const ce = new ComputeEngine();
    const row = apply(ce, ce.box(nested('e', typed('e')) as any), 3);
    expect(ce.box(['At', row, 1]).evaluate().valueOf()).toBe(1003);
  });

  it('the signature-string sugar names an `i` parameter without error', () => {
    const ce = new ComputeEngine();
    const f = ce.box([
      'Function',
      ['Add', 'i', 1000],
      "'(i: integer) -> integer'",
    ]);
    expect(f.isValid).toBe(true);
    expect(apply(ce, f, 3).valueOf()).toBe(1003);
  });
});

describe('Constants are unaffected when not used as a parameter', () => {
  it('bare `i` is still the imaginary unit', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Multiply', 2, 'i']).json).toEqual(['Complex', 0, 2]);
  });

  it('a free `i` inside a function (not a parameter) stays the imaginary unit', () => {
    const ce = new ComputeEngine();
    // λz. z + i — here `i` is free, so it is the imaginary unit.
    const f = ce.box(['Function', ['Add', 'z', 'i'], 'z']);
    expect(apply(ce, f, 0).toString()).toBe('i');
  });

  it('Sum/Product with a constant-named index already worked', () => {
    const ce = new ComputeEngine();
    expect(
      ce.box(['Sum', 'i', ['Limits', 'i', 1, 3]]).evaluate().valueOf()
    ).toBe(6);
    expect(
      ce.box(['Product', 'i', ['Limits', 'i', 1, 4]]).evaluate().valueOf()
    ).toBe(24);
  });
});

describe('Closure capture is preserved (no early value-defs)', () => {
  it('normal currying: λy. λx. (x + y)', () => {
    const ce = new ComputeEngine();
    const add = ce.box(['Function', ['Function', ['Add', 'x', 'y'], 'x'], 'y']);
    const add4 = ce.function('Apply', [add, ce.number(4)]).evaluate();
    expect(ce.function('Apply', [add4, ce.number(3)]).evaluate().valueOf()).toBe(
      7
    );
  });

  it('a constant-named parameter is captured across nesting: λi. λz. (z + i)', () => {
    const ce = new ComputeEngine();
    // mk(i) returns λz. z + i, capturing i lexically.
    const mk = ce.box(['Function', ['Function', ['Add', 'z', 'i'], 'z'], 'i']);
    const inner = ce.function('Apply', [mk, ce.number(5)]).evaluate();
    // inner = λz. z + 5  →  inner(3) = 8
    expect(ce.function('Apply', [inner, ce.number(3)]).evaluate().valueOf()).toBe(
      8
    );
  });
});

/**
 * Tycho item 46 (2026-07-18): applying a user lambda to a SYMBOLIC argument
 * that mentions the parameter's own free name — `a(t + 1)` for
 * `a(t) := [cos t, sin t]` with `t` unbound in the caller — overflowed the
 * call stack under `.N()`: `BoxedSymbol.N()` recursed into the call-frame
 * value (`t → t+1 → t → …`; symbol values resolve BY NAME through the
 * current eval context). Plain `evaluate()` substitutes the context value
 * once, without recursing; `.N()` now does the same for a self-referential
 * context binding.
 */
describe('Symbolic argument mentioning the parameter’s own name (Tycho item 46)', () => {
  const defs = (ce: ComputeEngine) => {
    ce.parse('a(t)\\coloneq[\\cos t,\\sin t]').evaluate();
    ce.parse('h(i)\\coloneq\\operatorname{mod}(10^{4}\\sin(10^{4}i),1)').evaluate();
    ce.parse(
      'A(t)\\coloneq\\sum_{i=0}^{6}h(i)\\frac{1}{1.4^{i}}a(1.9^{i}t+h(i))'
    ).evaluate();
  };

  it('a(t+1) with unbound t substitutes once, correctly', () => {
    const ce = new ComputeEngine();
    ce.parse('a(t)\\coloneq[\\cos t,\\sin t]').evaluate();
    expect(ce.parse('a(t+1)').evaluate().json).toEqual([
      'List',
      ['Cos', ['Add', 't', 1]],
      ['Sin', ['Add', 't', 1]],
    ]);
    expect(ce.parse('a(2t)').evaluate().json).toEqual([
      'List',
      ['Cos', ['Multiply', 2, 't']],
      ['Sin', ['Multiply', 2, 't']],
    ]);
  });

  it('the filed PointList repro evaluates symbolically without overflowing', () => {
    const ce = new ComputeEngine();
    // This test guards against the item-46 stack overflow, not evaluation
    // speed; it runs unbounded (no enclosing span), with jest's per-test
    // timeout as the hang backstop.
    defs(ce);
    const sym = ce
      .parse('\\operatorname{PointList}(A(t)[1], A(t)[2])')
      .evaluate();
    expect(sym.isValid).toBe(true);
    // The symbolic result agrees with direct numeric evaluation at t = 0.7.
    const atPoint = sym.subs({ t: 0.7 }).N();
    const ce2 = new ComputeEngine();
    defs(ce2);
    ce2.assign('t', 0.7);
    const direct = ce2.parse('\\operatorname{PointList}(A(t)[1], A(t)[2])').N();
    expect(atPoint.op1.re).toBeCloseTo(direct.op1.re, 10);
    expect(atPoint.op2.re).toBeCloseTo(direct.op2.re, 10);
  });

  it('numeric evaluation with a bound t is unaffected', () => {
    const ce = new ComputeEngine();
    ce.parse('a(t)\\coloneq[\\cos t,\\sin t]').evaluate();
    ce.assign('t', 0.5);
    const r = ce.parse('a(t+1)').N();
    expect(r.op1.re).toBeCloseTo(Math.cos(1.5), 12);
    expect(r.op2.re).toBeCloseTo(Math.sin(1.5), 12);
  });
});

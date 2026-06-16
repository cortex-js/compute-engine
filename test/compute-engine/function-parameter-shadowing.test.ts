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

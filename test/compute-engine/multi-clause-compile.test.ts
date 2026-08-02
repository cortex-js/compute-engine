import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';

//
// Phase 3 of the function-polymorphism design
// (docs/plans/2026-08-01-function-polymorphism-design.md §8): a multi-clause
// function compiles (JavaScript target) to a guard chain — one helper per
// clause plus a dispatcher testing the clauses most-specific-first
// (declaration order breaking ties, the same total order as the runtime
// selector), throwing `no-matching-clause` (D7) when every clause refuses.
// A clause with a guard the target cannot express declines the WHOLE
// function (interpreted fallback); non-JS targets fail closed.
//

let ce: ComputeEngine;
beforeEach(() => {
  ce = new ComputeEngine();
});

function clause(name: string, fn: MathJsonExpression): void {
  ce.box(['DefineFunction', name, fn]).evaluate();
}

function p(name: string, type: string): MathJsonExpression {
  return ['Typed', name, { str: type }];
}

describe('MULTI-CLAUSE COMPILE — guard chain (spec §8)', () => {
  it('compiles recursive fib and agrees with the interpreter', () => {
    clause('fib', ['Function', 0, p('z', '0')]);
    clause('fib', ['Function', 1, p('o', '1')]);
    clause('fib', [
      'Function',
      ['Add', ['fib', ['Subtract', 'n', 1]], ['fib', ['Subtract', 'n', 2]]],
      p('n', 'integer'),
    ]);
    const r = compile(ce.box(['fib', 'y']));
    expect(r?.run?.({ y: 10 })).toBe(55);
    expect(r?.run?.({ y: 0 })).toBe(0);
    expect(ce.box(['fib', 10]).evaluate().re).toBe(55);
  });

  it('emits one helper per clause and a most-specific-first dispatcher', () => {
    clause('f', ['Function', 1, p('a', '0')]);
    clause('f', ['Function', ['Add', 'x', 1], p('x', 'integer')]);
    const r = compile(ce.box(['Function', ['f', 'y'], 'y']));
    expect(r?.code).toContain('_fn_f$c1');
    expect(r?.code).toContain('_fn_f$c2');
    expect(r?.code).toContain('no-matching-clause: f');
    // The value guard tests before the integer guard.
    const code = r!.code!;
    expect(code.indexOf('_$a[0] === 0')).toBeLessThan(
      code.indexOf('Number.isInteger(_$a[0])')
    );
  });

  it('linearizes by specificity even when the general clause is declared first', () => {
    clause('k', ['Function', ['Add', 'x', 1], p('x', 'integer')]);
    clause('k', ['Function', 999, p('a', '0')]);
    const r = compile(ce.box(['k', 'y']));
    expect(r?.run?.({ y: 0 })).toBe(999);
    expect(r?.run?.({ y: 3 })).toBe(4);
  });

  it('dispatches string and boolean value clauses', () => {
    clause('m', ['Function', 1, p('a', '"fast"')]);
    clause('m', ['Function', 2, p('b', '"slow"')]);
    clause('m', ['Function', 0, p('s', 'string')]);
    const r = compile(ce.box(['m', 'y']));
    expect(r?.run?.({ y: 'fast' })).toBe(1);
    expect(r?.run?.({ y: 'slow' })).toBe(2);
    expect(r?.run?.({ y: 'other' })).toBe(0);

    // A fresh argument symbol: `y` was just inferred `string` by the calls
    // above, and a boolean call over it would statically refute.
    clause('b', ['Function', 10, p('t', 'true')]);
    clause('b', ['Function', 20, p('u', 'false')]);
    const rb = compile(ce.box(['b', 'w']));
    expect(rb?.run?.({ w: true })).toBe(10);
    expect(rb?.run?.({ w: false })).toBe(20);
  });

  it('compiles numeric-range clauses to inclusive bound checks', () => {
    clause('r', ['Function', 1, p('a', 'integer<0..10>')]);
    clause('r', ['Function', 2, p('x', 'integer')]);
    const rr = compile(ce.box(['r', 'y']));
    expect(rr?.run?.({ y: 0 })).toBe(1);
    expect(rr?.run?.({ y: 10 })).toBe(1);
    expect(rr?.run?.({ y: 11 })).toBe(2);
    expect(rr?.run?.({ y: -1 })).toBe(2);
  });

  it('dispatches mixed-arity clause sets through the arity guard (D2)', () => {
    clause('v', ['Function', ['Add', 'x', 'y'], 'x', 'y']);
    clause('v', ['Function', 0, p('a', '0')]);
    const r = compile(ce.box(['Function', ['Add', ['v', 1, 2], ['v', 0]]]));
    expect(r?.run?.({})).toBe(3);
  });

  it('Infinity and NaN clauses compile with interpreter parity', () => {
    clause('g', ['Function', 1, p('a', 'oo')]);
    clause('g', ['Function', 2, p('b', '-oo')]);
    clause('g', ['Function', 3, p('c', 'nan')]);
    clause('g', ['Function', 0, p('x', 'number')]);
    const r = compile(ce.box(['g', 'w']));
    expect(r?.run?.({ w: Infinity })).toBe(1);
    expect(r?.run?.({ w: -Infinity })).toBe(2);
    expect(r?.run?.({ w: NaN })).toBe(3);
    expect(r?.run?.({ w: 7 })).toBe(0);
    // Interpreter agrees (the concrete-NaN admission is decisive, not
    // blocked — a fully-known value never keeps dispatch inert).
    expect(ce.box(['g', 'PositiveInfinity']).evaluate().re).toBe(1);
    expect(ce.box(['g', 'NegativeInfinity']).evaluate().re).toBe(2);
    expect(ce.box(['g', 'NaN']).evaluate().re).toBe(3);
    expect(ce.box(['g', 7]).evaluate().re).toBe(0);
  });

  it('a compiled miss throws no-matching-clause (D7)', () => {
    clause('f', ['Function', 1, p('a', '0')]);
    clause('f', ['Function', 2, p('b', '1')]);
    const r = compile(ce.box(['f', 'y']));
    expect(() => r?.run?.({ y: 7 })).toThrow('no-matching-clause: f');
    // NaN inhabits only the value type `nan` (amended D1) — it misses
    // every OTHER value clause.
    expect(() => r?.run?.({ y: NaN })).toThrow('no-matching-clause: f');
  });

  it('an untyped fallback clause admits anything (no guard)', () => {
    clause('g', ['Function', 1, p('a', '0')]);
    clause('g', ['Function', 99, 'x']);
    const r = compile(ce.box(['g', 'y']));
    expect(r?.run?.({ y: 0 })).toBe(1);
    expect(r?.run?.({ y: 'anything' })).toBe(99);
    expect(r?.run?.({ y: NaN })).toBe(99);
  });

  it('a higher-order use compiles to the shared dispatcher', () => {
    clause('f', ['Function', 100, p('a', '0')]);
    clause('f', ['Function', ['Add', 'x', 1], p('x', 'integer')]);
    const r = compile(ce.box(['Map', ['List', 0, 1, 2], 'f']));
    expect(r?.run?.({})).toEqual([100, 2, 3]);
  });
});

describe('MULTI-CLAUSE COMPILE — whole-function decline (spec §8)', () => {
  it('an inexpressible guard declines the whole function to the interpreter', () => {
    // `rational` has no faithful JS test — the WHOLE function falls back
    // (no partial compilation: it would change tie behavior).
    clause('q', ['Function', 1, p('a', 'rational')]);
    clause('q', ['Function', 2, p('x', 'integer')]);
    const r = compile(ce.box(['q', 'y']));
    // The fallback runner is interpreter-backed and still dispatches.
    expect(r?.run?.({ y: 5 })).toBe(2);
    expect(r?.code ?? '').not.toContain('_fn_q$');
  });

  it('the GLSL target fails closed', () => {
    clause('f', ['Function', 1, p('a', '0')]);
    clause('f', ['Function', 2, p('x', 'integer')]);
    const glsl = new GLSLTarget();
    expect(() => glsl.compile(ce.box(['f', 'u']))).toThrow(/fail closed/i);
  });
});

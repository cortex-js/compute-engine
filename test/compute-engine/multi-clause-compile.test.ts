import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';

//
// Phase 3 of the function-polymorphism design
// (docs/TYPE-SYSTEM.md §8): a multi-clause
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
    // The value guard tests before the integer guard. Guards test the
    // NORMALIZED arguments `_$n` (an exactly-real `{re, im: 0}` dispatches as
    // the real number it is); the helpers receive `_$a`.
    const code = r!.code!;
    expect(code.indexOf('_$n[0] === 0')).toBeLessThan(
      code.indexOf('Number.isInteger(_$n[0])')
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

  it('integer/real clauses agree between the guard chain and the interpreter', () => {
    // The §8/§9 agreement obligation on a clause set with NO value component:
    // the guard chain has always selected `real` at 0.3, and since the
    // 2026-08-12 ruling the interpreter decides it too (a fully-known value
    // never keeps dispatch inert).
    clause('a', ['Function', 1, p('t', 'integer')]);
    clause('a', ['Function', 2, p('t', 'real')]);
    const r = compile(ce.box(['a', 'y']));
    expect(r?.run?.({ y: 0.3 })).toBe(2);
    expect(r?.run?.({ y: 2 })).toBe(1);
    expect(ce.box(['a', 0.3]).evaluate().re).toBe(2);
    expect(ce.box(['a', 2]).evaluate().re).toBe(1);
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
    const r = compile(ce.box(['Map', 'f', ['List', 0, 1, 2]]));
    expect(r?.run?.({})).toEqual([100, 2, 3]);
  });
});

// ─── Complex-valued clause dispatch ─────────────────────────────────────────
//
// The JS calling convention represents a complex value as a `{re, im}` object
// and a real one as a plain number; both inhabit `complex`. A clause set over
// complex parameters therefore needs a guard accepting either shape, the
// call-boundary coercion of a real argument bound to a complex parameter, and
// one result convention across the clause bodies (Tycho item 60, here across
// clauses rather than `Which` arms).
//

describe('MULTI-CLAUSE COMPILE — complex-valued dispatch', () => {
  /** The Mandelbrot-ish iteration `J(0, z) = z; J(n, z) = J(n-1, z)² + c`. */
  function defineJ(base: MathJsonExpression): void {
    ce.declare('J', '(number, complex) -> complex');
    ce.box(['DefineFunction', 'J', base]).evaluate();
    clause('J', [
      'Function',
      [
        'Add',
        ['Square', ['J', ['Subtract', 'n', 1], 'z']],
        ['Complex', 0.1, 0.2],
      ],
      p('n', 'integer'),
      p('z', 'complex'),
    ]);
  }

  it('compiles a recursive complex clause set with interpreter parity', () => {
    defineJ(['Function', p('z', 'complex'), p('k', '0'), p('z', 'complex')]);
    // The lambda's `w` is annotated complex: it is handed a `{re, im}` at
    // run time, and an UNANNOTATED lambda parameter is wide — shaped real by
    // the strict discipline — so the runner's D3 entry check would refuse
    // the object (`docs/COMPILATION-MODEL.md` D3).
    const r = compile(
      ce.box(['Function', ['J', 'n', 'w'], 'n', p('w', 'complex')])
    );
    expect(r?.code).toContain('_fn_J$c1');
    for (const n of [0, 1, 2, 3]) {
      const got = r?.run?.(n, { re: 0.1, im: 0.2 }) as {
        re: number;
        im: number;
      };
      const want = ce.box(['J', n, ['Complex', 0.1, 0.2]]).N();
      expect(got.re).toBeCloseTo(want.re, 12);
      expect(got.im).toBeCloseTo(want.im, 12);
    }
  });

  it('coerces a provably-real ARGUMENT bound to a complex parameter', () => {
    // Without the coercion the seed reaches the body as a plain number and
    // `.re` NaN-poisons the whole iteration.
    defineJ(['Function', p('z', 'complex'), p('k', '0'), p('z', 'complex')]);
    const r = compile(ce.box(['J', 3, 0.5]));
    const got = r?.run?.({}) as { re: number; im: number };
    const want = ce.box(['J', 3, 0.5]).N();
    expect(got.re).toBeCloseTo(want.re, 12);
    expect(got.im).toBeCloseTo(want.im, 12);

    // Same coercion for an UNDECLARED clause set, whose stored signature is
    // an intersection: the parameter type comes from the clause set instead.
    clause('h', [
      'Function',
      ['Multiply', 'z', 2],
      p('k', '0'),
      p('z', 'complex'),
    ]);
    clause('h', [
      'Function',
      ['Add', 'z', 1],
      p('n', 'integer'),
      p('z', 'complex'),
    ]);
    // `constantFold: false`: the call site has no free variables, so
    // compile-time constant folding would emit its value (`1.5`) as a literal
    // and the argument coercion this test reads off the code would not be
    // emitted at all.
    const rh = compile(ce.box(['h', 1, 0.5]), { constantFold: false });
    expect(rh?.code).toContain('re: 0.5, im: 0');
    // `0.5 + 1` is real: the result convention (design §5) hands it back as
    // a plain number, never `{re: 1.5, im: 0}`.
    const v = rh?.run?.({});
    expect(typeof v).toBe('number');
    expect(v).toBeCloseTo(ce.box(['h', 1, 0.5]).N().re, 12);
  });

  it('coerces a provably-real clause BODY to the complex convention', () => {
    // The clause bodies are the ARMS of one dispatcher: a real-valued body
    // beside a complex-valued one must be coerced, or the consumer reads
    // `.re` off a plain number (NaN at every point).
    clause('f', ['Function', 0, p('k', '0'), p('z', 'complex')]);
    clause('f', [
      'Function',
      ['Add', 'z', 1],
      p('n', 'integer'),
      p('z', 'complex'),
    ]);
    // `w` annotated complex — see the D3 note in the recursive test above.
    const r = compile(
      ce.box([
        'Function',
        ['Add', ['f', 'n', 'w'], ['Complex', 0, 1]],
        'n',
        p('w', 'complex'),
      ])
    );
    expect(r?.code).toContain('re: 0, im: 0');
    for (const n of [0, 1]) {
      const got = r?.run?.(n, { re: 0.5, im: 0.25 }) as {
        re: number;
        im: number;
      };
      const want = ce
        .box(['Add', ['f', n, ['Complex', 0.5, 0.25]], ['Complex', 0, 1]])
        .N();
      expect(got.re).toBeCloseTo(want.re, 12);
      expect(got.im).toBeCloseTo(want.im, 12);
    }
  });

  it('the REAL twin is unchanged', () => {
    clause('R', ['Function', p('y', 'real'), p('k', '0'), p('y', 'real')]);
    clause('R', [
      'Function',
      ['Add', ['Square', ['R', ['Subtract', 'n', 1], 'y']], 0.1],
      p('n', 'integer'),
      p('y', 'real'),
    ]);
    const r = compile(ce.box(['R', 'n', 'yy']));
    expect(r?.run?.({ n: 3, yy: 0.1 })).toBeCloseTo(
      ce.box(['R', 3, 0.1]).N().re,
      12
    );
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

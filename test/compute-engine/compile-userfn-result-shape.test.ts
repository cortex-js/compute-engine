/**
 * The RESULT shape of a compiled user-function call, and what the emission
 * around it may assume.
 *
 * A user-defined function whose body yields a single scalar whenever its
 * parameters hold scalars returns a scalar, never a JavaScript array. When
 * every argument of a call is a scalar by CONSTRUCTION — a literal, an
 * explicitly declared scalar input, or scalar arithmetic over such values
 * (user ruling 2026-09-07) — the call itself is such a value, so the code
 * around it needs no run-time shape test: no `Array.isArray` guard at an
 * enclosing call, no `_SYS.bcast` around the arithmetic, and no run-time role
 * dispatch in a `PointList`.
 *
 * A body that CONSTRUCTS a collection (`m(t) := [t, 2t]`) or a point
 * (`p(t) := (t, t²)`) is not such a function, and every call of it keeps the
 * broadcast it had.
 *
 * Two more emissions of the same call boundary are pinned here:
 *
 *  - the runtime broadcast takes the callee itself when no argument needs a
 *    complex coercion, instead of an arrow that only eta-expands it;
 *  - inside an emitted body, a call that passes on a parameter whose type the
 *    author DECLARED scalar is a direct call. Every emitted call site of such
 *    a function hands that parameter a scalar: a call whose argument is not
 *    provably one is dispatched element-wise or guarded, so the body sees one
 *    element, and the only form that passes an argument straight through is
 *    the one an explicit caller declaration already exempts. A parameter whose
 *    scalar type was INFERRED from the body carries no such promise and keeps
 *    its dispatch.
 *
 * Every expected value is checked against the interpreter's own answer for the
 * same expression.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/** Compile without constant folding — a folded call site emits no call at
 * all, so a fold would hide the very emission under test. */
function build(ce: ComputeEngine, expr: any, options: any = {}) {
  return compile(ce.box(expr), { constantFold: false, ...options }) as any;
}

/** An engine with `u` declared `number` (the caller's input contract) and the
 * one-argument function `f: x ↦ x + 1`. */
function engineWithF(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('u', 'number');
  ce.assign('f', ce.box(['Function', ['Add', 'x', 1], 'x'] as any));
  return ce;
}

describe('a user-function result is a scalar by construction', () => {
  test('a scalar body: the enclosing call needs no Array.isArray guard', () => {
    const ce = engineWithF();
    ce.assign('g', ce.box(['Function', ['Add', ['Multiply', 2, 's'], 1], 's']));
    const r = build(ce, ['f', ['g', 'u']]);
    expect(r.code).toBe('_fn_f(_fn_g(_.u))');
    expect(r.code).not.toContain('Array.isArray');
    expect(r.run({ u: 4 })).toBe(10);
    expect(
      ce
        .box(['f', ['g', 4]])
        .evaluate()
        .toString()
    ).toBe('10');
  });

  test('a transcendental body (arctan ∘ cos) is scalar too', () => {
    const ce = engineWithF();
    ce.assign('T', ce.box(['Function', ['Arctan', ['Cos', 's']], 's']));
    const r = build(ce, ['f', ['T', 'u']]);
    expect(r.code).toBe('_fn_f(_fn_T(_.u))');
    expect(r.run({ u: 0.5 })).toBeCloseTo(
      ce.box(['f', ['T', 0.5]]).N().re as number,
      12
    );
  });

  test('a body that calls another user function is scalar', () => {
    const ce = engineWithF();
    ce.assign('h', ce.box(['Function', ['Multiply', 3, 's'], 's']));
    ce.assign('g', ce.box(['Function', ['Add', ['h', 's'], 1], 's']));
    const r = build(ce, ['f', ['g', 'u']]);
    expect(r.code).toBe('_fn_f(_fn_g(_.u))');
    expect(r.run({ u: 4 })).toBe(14);
    expect(
      ce
        .box(['f', ['g', 4]])
        .evaluate()
        .toString()
    ).toBe('14');
  });

  test('a reducing body (Sum over a bare parameter) has no compiled form', () => {
    const ce = engineWithF();
    ce.assign('k', ce.box(['Function', ['Sum', 'L'], 'L']));
    const r = build(ce, ['f', ['k', 'u']]);
    // `Sum` over a bare parameter names no indexing set, so the DEFINITION
    // declines and the whole artifact falls back to interpretation. The
    // result-shape question is never reached — the body's static type says
    // `number`, but there is no emitted call to spell either way.
    expect(r.success).toBe(false);
    expect(r.run({ u: 4 })).toBe(5);
    expect(
      ce
        .box(['f', ['k', 4]])
        .evaluate()
        .toString()
    ).toBe('5');
  });

  test('scalar arithmetic over the results is plain scalar code', () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'number');
    ce.assign('T_4', ce.box(['Function', ['Arctan', ['Cos', 's']], 's']));
    ce.assign('d', ce.box(['Function', ['Add', ['Square', 'v'], 1], 'v']));
    const e = ce.box([
      'Add',
      ['Multiply', -0.4, ['Sin', ['T_4', 't']], ['d', 't']],
      3,
    ]);
    const r = build(ce, e);
    expect(r.code).not.toContain('_SYS.bcast');
    expect(r.run({ t: 0.5 })).toBeCloseTo(
      e.subs({ t: 0.5 } as any).N().re as number,
      12
    );
  });

  test('a PointList of such results has no run-time shape dispatch', () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'number');
    ce.assign('T_4', ce.box(['Function', ['Arctan', ['Cos', 's']], 's']));
    ce.assign('d', ce.box(['Function', ['Add', ['Square', 'v'], 1], 'v']));
    const e = ce.box([
      'PointList',
      ['Multiply', -0.4, ['Sin', ['T_4', 't']]],
      ['d', 't'],
    ]);
    const r = build(ce, e);
    expect(r.code).not.toContain('Array.isArray');
    const value = r.run({ t: 0.5 }) as number[];
    const expected = e.subs({ t: 0.5 } as any).N();
    expect(value[0]).toBeCloseTo(expected.ops![0].re as number, 12);
    expect(value[1]).toBeCloseTo(expected.ops![1].re as number, 12);
  });
});

describe('a body that builds a collection keeps its broadcast', () => {
  test('a list-returning body still broadcasts, and agrees with the interpreter', () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'number');
    ce.assign(
      'm',
      ce.box(['Function', ['List', 't', ['Multiply', 2, 't']], 't'])
    );
    const r = build(ce, ['Multiply', 2, ['m', 't']]);
    expect(r.code).toContain('_SYS.bcast');
    expect(r.run({ t: 3 })).toEqual([6, 12]);
    expect(
      ce
        .box(['Multiply', 2, ['m', 3]])
        .evaluate()
        .toString()
    ).toBe('[6,12]');
  });

  test('a point-returning body still broadcasts', () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'number');
    ce.assign('p', ce.box(['Function', ['Tuple', 't', ['Square', 't']], 't']));
    const r = build(ce, ['Multiply', 2, ['p', 't']]);
    expect(r.code).toContain('_SYS.bcast');
    expect(r.run({ t: 3 })).toEqual([6, 18]);
    expect(
      ce
        .box(['Multiply', 2, ['p', 3]])
        .evaluate()
        .toString()
    ).toBe('(6, 18)');
  });

  test('an INFERRED-type argument keeps its guard and broadcasts', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.box(['Function', ['Multiply', 2, 's'], 's']));
    ce.assign('f', ce.box(['Function', ['Add', 'x', 1], 'x']));
    const r = build(ce, ['f', ['g', 'y']]);
    expect(r.code).toContain('Array.isArray');
    expect(r.run({ y: [1, 2] })).toEqual([3, 5]);
    expect(
      ce
        .box(['f', ['g', ['List', 1, 2]]])
        .evaluate()
        .toString()
    ).toBe('[3,5]');
  });

  test('a `vars`-mapped function name stays dispatched', () => {
    const ce = engineWithF();
    ce.assign('g', ce.box(['Function', ['Multiply', 2, 's'], 's']));
    // The caller claims `g` as a variable it supplies, so the compiler may not
    // read the engine's literal as the callee's body.
    const r = build(ce, ['f', ['g', 'u']], { vars: { g: '((z) => 3 * z)' } });
    expect(r.code).toContain('Array.isArray');
  });
});

describe('a symbol a body CAPTURES carries its own evidence', () => {
  /** `g: s ↦ 2s`, `f: t ↦ g(y)` — `f` ignores its own argument and answers a
   * broadcast over the captured `y`. `declareY` gives `y` an explicit scalar
   * type before the two literals are boxed. */
  function captured(declareY: boolean): ComputeEngine {
    const ce = new ComputeEngine();
    if (declareY) ce.declare('y', 'number');
    ce.assign('g', ce.box(['Function', ['Multiply', 2, 's'], 's'] as any));
    ce.assign('f', ce.box(['Function', ['g', 'y'], 't'] as any));
    return ce;
  }

  test('an INFERRED captured symbol keeps the enclosing guard', () => {
    // `y` is free and its numeric type was inferred from the body, so the
    // caller may still hand it a list. The body then answers a list, and the
    // enclosing call must map over it.
    const ce = captured(false);
    const r = build(ce, ['g', ['f', 1]]);
    expect(r.code).toContain('Array.isArray');
    expect(r.run({ y: [1, 2, 3] })).toEqual([4, 8, 12]);
    // The interpreter's own answer for the same list, on a separate engine so
    // that assigning `y` a value cannot change what the compiler above sees.
    const interp = captured(false);
    interp.assign('y', interp.box(['List', 1, 2, 3]));
    expect(
      interp
        .box(['g', ['f', 1]])
        .evaluate()
        .toString()
    ).toBe('[4,8,12]');
  });

  test('a DECLARED scalar captured symbol drops the guard', () => {
    const ce = captured(true);
    const r = build(ce, ['g', ['f', 1]]);
    expect(r.code).toBe('_fn_g(_fn_f(1))');
    expect(r.run({ y: 5 })).toBe(20);
  });

  test('a BUILT-IN broadcastable head over an inferred symbol keeps it', () => {
    // Only the emitted GUARD is pinned here. The `Multiply` lowering itself
    // does not map over a captured symbol that holds a list at run time, so
    // the value the body computes for a list is not comparable with the
    // interpreter's.
    const ce = new ComputeEngine();
    ce.assign('f', ce.box(['Function', ['Add', 'x', 1], 'x'] as any));
    ce.assign('k', ce.box(['Function', ['Multiply', 2, 'y'], 't'] as any));
    const r = build(ce, ['f', ['k', 1]]);
    expect(r.code).toContain('Array.isArray');
  });

  test('a REDUCING body over a captured list is still a scalar', () => {
    // `Sum` and `Length` answer one number for any operand, so their static
    // result type describes the shape even though the operand is a list.
    const ce = new ComputeEngine();
    ce.declare('y', 'list<real>');
    ce.assign('f', ce.box(['Function', ['Add', 'x', 1], 'x'] as any));
    ce.assign('k', ce.box(['Function', ['Sum', 'y'], 't'] as any));
    ce.assign('n', ce.box(['Function', ['Length', 'y'], 't'] as any));
    const sum = build(ce, ['f', ['k', 1]]);
    expect(sum.code).toBe('_fn_f(_fn_k(1))');
    expect(sum.run({ y: [1, 2, 3] })).toBe(7);
    const len = build(ce, ['f', ['n', 1]]);
    expect(len.code).toBe('_fn_f(_fn_n(1))');
    expect(len.run({ y: [1, 2, 3] })).toBe(4);
  });
});

describe('the runtime broadcast takes the callee itself', () => {
  test('no argument to coerce: `_SYS.bcastFn(_fn_g, …)`, not an eta-expansion', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.box(['Function', ['Multiply', 2, 's'], 's']));
    const r = build(ce, ['g', 'y']);
    expect(r.code).toBe('_SYS.bcastFn(_fn_g, _.y)');
    expect(r.run({ y: [1, 2, 3] })).toEqual([2, 4, 6]);
    expect(r.run({ y: 4 })).toBe(8);
    expect(
      ce
        .box(['g', ['List', 1, 2, 3]])
        .evaluate()
        .toString()
    ).toBe('[2,4,6]');
  });

  test('a complex-declared parameter keeps the coercing closure', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'c',
      ce.box(['Function', ['Add', 'x', 1], ['Typed', 'x', "'complex'"]])
    );
    const r = build(ce, ['c', 'y']);
    expect(r.code).toContain('=>');
    expect(r.code).toContain('_SYS.cplx');
  });
});

describe('a DECLARED scalar parameter is a scalar inside the body', () => {
  /** `r_e: (a, b) ↦ a + b`, plus `q: (x, y) ↦ r_e(x, y) + 1` declared as
   * `declaration` says. */
  function nested(declaration: 'none' | 'signature' | 'annotation') {
    const ce = new ComputeEngine();
    ce.assign('r_e', ce.box(['Function', ['Add', 'a', 'b'], 'a', 'b'] as any));
    const body = ['Add', ['r_e', 'x', 'y'], 1];
    if (declaration === 'signature') {
      ce.declare('q', '(number, number) -> number');
      ce.assign('q', ce.box(['Function', body, 'x', 'y'] as any));
    } else if (declaration === 'annotation') {
      ce.assign(
        'q',
        ce.box([
          'Function',
          body,
          ['Typed', 'x', "'number'"],
          ['Typed', 'y', "'number'"],
        ] as any)
      );
    } else {
      ce.assign('q', ce.box(['Function', body, 'x', 'y'] as any));
    }
    return ce;
  }

  test('a declared signature makes the inner call direct', () => {
    const ce = nested('signature');
    const r = build(ce, ['q', 'u', 2]);
    expect(r.preamble).toContain('const _fn_q = (x, y) => _fn_r_e(x, y) + 1;');
  });

  test('a `Typed` parameter annotation makes the inner call direct', () => {
    const ce = nested('annotation');
    const r = build(ce, ['q', 'u', 2]);
    expect(r.preamble).toContain('const _fn_q = (x, y) => _fn_r_e(x, y) + 1;');
  });

  test('an INFERRED parameter type keeps the inner dispatch', () => {
    const ce = nested('none');
    const r = build(ce, ['q', 'u', 2]);
    expect(r.preamble).toContain('_SYS.bcastFn(_fn_r_e, x, y)');
  });

  test('a list still broadcasts through a declared-parameter body', () => {
    const ce = nested('signature');
    const r = build(ce, ['q', 'u', 2]);
    // The CALLER's guard is what maps the body over the list, so the body
    // itself never sees an array.
    expect(r.run({ u: [1, 2, 3] })).toEqual([4, 5, 6]);
    expect(r.run({ u: 5 })).toBe(8);
    expect(
      ce
        .box(['q', ['List', 1, 2, 3], 2])
        .evaluate()
        .toString()
    ).toBe('[4,5,6]');
    expect(ce.box(['q', 5, 2]).evaluate().toString()).toBe('8');
  });
});

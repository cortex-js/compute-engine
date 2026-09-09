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
 *  - inside an emitted body, a call that passes on a parameter whose type in
 *    the function's signature is a scalar one is a direct call — the author
 *    wrote that type or the engine inferred it, which makes no difference
 *    (user ruling 2026-09-08). Every emitted call site of such a function
 *    hands that parameter a scalar: a call whose argument is not provably one
 *    is dispatched element-wise or guarded, so the body sees one element, and
 *    the only form that passes an argument straight through is the one an
 *    explicit caller declaration already exempts. A parameter typed
 *    `unknown`, `any` or a collection keeps its dispatch, because such a body
 *    may receive a list whole.
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

describe('a SCALAR-TYPED parameter is a scalar inside the body', () => {
  /** `r_e: (a, b) ↦ a + b`, plus `q: (x, y) ↦ r_e(x, y) + 1` typed as
   * `typing` says.
   *
   * `inferred-signature` gives `q` a scalar signature that is NOT the
   * author's contract: the definition keeps `inferredSignature: true`, the
   * state a host reaches by vouching for a name
   * (`ce.declare(h, { signature, inferredSignature: true })`) or by declaring
   * a function in a source language whose types the engine works out. The
   * signature is written after the assignment because assigning an
   * unannotated literal re-infers the signature from the body. */
  function nested(
    typing: 'none' | 'signature' | 'annotation' | 'inferred-signature'
  ) {
    const ce = new ComputeEngine();
    ce.assign('r_e', ce.box(['Function', ['Add', 'a', 'b'], 'a', 'b'] as any));
    const body = ['Add', ['r_e', 'x', 'y'], 1];
    if (typing === 'signature') {
      ce.declare('q', '(number, number) -> number');
      ce.assign('q', ce.box(['Function', body, 'x', 'y'] as any));
    } else if (typing === 'annotation') {
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
      if (typing === 'inferred-signature') {
        const def = (ce as any).lookupDefinition('q');
        def.operator._setSignature(() => ce.type('(number, number) -> number'));
      }
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

  test('an INFERRED scalar signature makes the inner call direct too', () => {
    const ce = nested('inferred-signature');
    const def = (ce as any).lookupDefinition('q');
    expect(def.operator.signature.toString()).toBe(
      '(number, number) -> number'
    );
    expect(def.operator.inferredSignature).toBe(true);
    const r = build(ce, ['q', 'u', 2]);
    expect(r.preamble).toContain('const _fn_q = (x, y) => _fn_r_e(x, y) + 1;');
    // The direct call is still safe for a list argument, because the CALL
    // SITE broadcasts: `u` is a free symbol here, so the whole call is
    // dispatched element-wise and the body sees one element at a time.
    expect(r.code).toContain('_SYS.bcastFn(_fn_q, _.u, 2)');
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

  test('an `unknown` parameter type keeps the inner dispatch', () => {
    const ce = nested('none');
    // Inference gives an unannotated literal `unknown` parameters — a use of
    // a parameter at a SCALAR parameter of another function narrows nothing,
    // because broadcasting admits a list there. So the body may receive a
    // list whole and the dispatch stays.
    const def = (ce as any).lookupDefinition('q');
    expect(def.operator.signature.toString()).toBe(
      '(unknown, unknown) -> number'
    );
    const r = build(ce, ['q', 'u', 2]);
    expect(r.preamble).toContain('_SYS.bcastFn(_fn_r_e, x, y)');
  });

  test('a COLLECTION parameter type keeps the inner dispatch', () => {
    // `qL(L: list<number>) := Sum(r_e(L, 2)) + 1` binds `L` whole, so the
    // inner call of the scalar-parameter `r_e` is what maps over it.
    const ce = new ComputeEngine();
    ce.assign('r_e', ce.box(['Function', ['Add', 'a', 'b'], 'a', 'b'] as any));
    ce.assign(
      'qL',
      ce.box([
        'Function',
        ['Add', ['Sum', ['r_e', 'L', 2]], 1],
        ['Typed', 'L', "'list<number>'"],
      ] as any)
    );
    const r = build(ce, ['qL', ['List', 1, 2, 3]]);
    expect(r.preamble).toContain('_SYS.bcastFn(_fn_r_e, L, 2)');
    expect(r.run({})).toBe(13);
    expect(
      ce
        .box(['qL', ['List', 1, 2, 3]])
        .evaluate()
        .toString()
    ).toBe('13');
  });

  test('a list still broadcasts through a scalar-parameter body', () => {
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

  test('a declared-number caller symbol keeps the direct top-level call', () => {
    const ce = nested('inferred-signature');
    ce.declare('u', 'number');
    const r = build(ce, ['q', 'u', 2]);
    // `ce.declare('u', 'number')` is the caller's input contract, so the top
    // level needs no shape test either.
    expect(r.code).toBe('_fn_q(_.u, 2)');
    expect(r.run({ u: 5 })).toBe(8);
  });
});

describe('a user function REFERENCED AS A VALUE takes a shape-aware wrapper', () => {
  /** The consumer of a function value hands the callee whatever element the
   * source holds, and an element can itself be a collection — a row of a
   * matrix. What the wrapper does with such an element is what the
   * INTERPRETER does at that callback: a function whose parameters are typed
   * `unknown` (every signature the engine infers) is applied element-wise, so
   * the wrapper broadcasts; a function whose parameters are typed as definite
   * scalars (a declared `(number) -> number`) is refused with an
   * incompatible-type error, so the wrapper answers NaN, the compiled
   * spelling of an error value. Without either, the whole row went into
   * scalar arithmetic behind `success: true`. */

  test('an INFERRED signature leaves the parameter open, and broadcasts', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.box(['Function', ['Multiply', 2, 't'], 't'] as any));
    ce.assign('f', ce.box(['Function', ['g', 'x'], 'x'] as any));
    // The engine infers an OPEN parameter, whatever the body computes with
    // it, and the interpreter broadcasts such a function over a row.
    const def = (ce as any).lookupDefinition('f');
    expect(def.operator.signature.toString()).toBe('(unknown) -> number');

    // The source is a caller input, so its element shape is unknown to the
    // emission — the run-time test in the wrapper is what decides.
    ce.declare('xs', 'list');
    const r = build(ce, ['Map', 'f', 'xs']);
    expect(r.code).toContain('_fn_f$b');
    expect(r.preamble).toContain(
      'const _fn_f$b = (_tv1) => Array.isArray(_tv1) ? ' +
        '_SYS.bcastFn(_fn_f, _tv1) : _fn_f(_tv1);'
    );
    expect(
      r.run({
        xs: [
          [1, 2],
          [3, 4],
        ],
      })
    ).toEqual([
      [2, 4],
      [6, 8],
    ]);
    // The interpreter's own answer for the same map.
    expect(
      ce
        .box(['Map', 'f', ['List', ['List', 1, 2], ['List', 3, 4]]])
        .evaluate()
        .toString()
    ).toBe('[[2,4],[6,8]]');
  });

  test('a DECLARED scalar parameter refuses a row instead of broadcasting', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.box(['Function', ['Multiply', 2, 't'], 't'] as any));
    ce.declare('f', '(number) -> number');
    ce.assign('f', ce.box(['Function', ['g', 'x'], 'x'] as any));

    // A row is not a number, so the interpreter puts an incompatible-type
    // error in the callback's place rather than mapping `f` over the row.
    expect(
      ce
        .box(['Map', 'f', ['List', ['List', 1, 2], ['List', 3, 4]]])
        .evaluate()
        .toString()
    ).toContain('incompatible-type');
    // That error is in the expression, which makes it invalid, so a source
    // whose elements are provably rows fails closed and the interpreter —
    // which reports the error — evaluates it.
    const declined = build(ce, [
      'Map',
      'f',
      ['List', ['List', 1, 2], ['List', 3, 4]],
    ]);
    expect(declined.success).toBe(false);

    // A caller-supplied source has no static element shape, so the refusal is
    // spelled at run time: an element that is an array projects to NaN, the
    // compiled spelling of an error value, and a scalar element is unchanged.
    ce.declare('xs', 'list');
    const r = build(ce, ['Map', 'f', 'xs']);
    expect(r.code).toContain('_fn_f$s');
    expect(r.preamble).toContain(
      'const _fn_f$s = (_tv1) => Array.isArray(_tv1) ? NaN : _fn_f(_tv1);'
    );
    expect(
      r.run({
        xs: [
          [1, 2],
          [3, 4],
        ],
      })
    ).toEqual([NaN, NaN]);
    expect(r.run({ xs: [1, 2] })).toEqual([2, 4]);

    // Applying such a function DIRECTLY still broadcasts, which is the
    // interpreter's own asymmetry between an application and a callback.
    expect(
      ce
        .box(['f', ['List', ['List', 1, 2], ['List', 3, 4]]])
        .evaluate()
        .toString()
    ).toBe('[[2,4],[6,8]]');
  });

  test('an UNANNOTATED body of scalar arithmetic broadcasts too', () => {
    // `f(x) := 2x` infers `(unknown) -> number`, which the interpreter still
    // broadcasts (an `unknown` parameter reads as scalar there), so the
    // emitted value reference does too.
    const ce = new ComputeEngine();
    ce.assign('f', ce.box(['Function', ['Multiply', 2, 'x'], 'x'] as any));
    const r = build(ce, ['Map', 'f', ['List', ['List', 1, 2], ['List', 3, 4]]]);
    expect(r.run({})).toEqual([
      [2, 4],
      [6, 8],
    ]);
    expect(
      ce
        .box(['Map', 'f', ['List', ['List', 1, 2], ['List', 3, 4]]])
        .evaluate()
        .toString()
    ).toBe('[[2,4],[6,8]]');
  });

  test('scalar elements are unchanged', () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.box(['Function', ['Multiply', 2, 'x'], 'x'] as any));
    const r = build(ce, ['Map', 'f', ['List', 1, 2, 3]]);
    expect(r.run({})).toEqual([2, 4, 6]);
    expect(
      ce
        .box(['Map', 'f', ['List', 1, 2, 3]])
        .evaluate()
        .toString()
    ).toBe('[2,4,6]');
  });

  test('an EMPTY element zips to an empty list, as applying the function does', () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.box(['Function', ['Multiply', 2, 'x'], 'x'] as any));
    ce.declare('xs', 'list');
    const r = build(ce, ['Map', 'f', 'xs']);
    expect(r.run({ xs: [[], [1, 2]] })).toEqual([[], [2, 4]]);
    expect(
      ce
        .box(['f', ['List']])
        .evaluate()
        .toString()
    ).toBe('[]');
  });

  test('a Filter predicate and a Reduce combiner take the wrapper too', () => {
    const ce = new ComputeEngine();
    ce.assign('p_1', ce.box(['Function', ['Greater', 'x', 1], 'x'] as any));
    const f = build(ce, ['Filter', ['List', 1, 2, 3], 'p_1']);
    expect(f.code).toContain('_fn_p_1$b');
    expect(f.run({})).toEqual([2, 3]);

    const ce2 = new ComputeEngine();
    ce2.assign(
      'r_c',
      ce2.box(['Function', ['Add', 'a', 'b'], 'a', 'b'] as any)
    );
    const r = build(ce2, ['Reduce', ['List', 1, 2, 3], 'r_c', 0]);
    expect(r.preamble).toContain(
      'const _fn_r_c$b = (_tv1, _tv2) => ' +
        'Array.isArray(_tv1) || Array.isArray(_tv2) ? ' +
        '_SYS.bcastFn(_fn_r_c, _tv1, _tv2) : _fn_r_c(_tv1, _tv2);'
    );
    expect(r.run({})).toBe(6);
  });

  test('a COLLECTION-parameter function keeps the bare reference', () => {
    // `k(L: list<number>) := Sum(L)` consumes a list whole, and the
    // interpreter does not broadcast it, so no wrapper is emitted.
    const ce = new ComputeEngine();
    ce.declare('k', '(list<number>) -> number');
    ce.assign('k', ce.box(['Function', ['Sum', 'L'], 'L'] as any));
    const r = build(ce, ['Map', 'k', ['List', ['List', 1, 2], ['List', 3, 4]]]);
    expect(r.code).toContain('(_fn_k)');
    expect(r.code).not.toContain('_fn_k$b');
    expect(r.run({})).toEqual([3, 7]);
    expect(
      ce
        .box(['Map', 'k', ['List', ['List', 1, 2], ['List', 3, 4]]])
        .evaluate()
        .toString()
    ).toBe('[3,7]');
  });
});

describe('a BUILT-IN operator name referenced as a callback broadcasts', () => {
  // `Map(Sin, xs)` eta-expands the operator into the shared local
  // `_fn_Sin = (_tv1) => Math.sin(_tv1)`, a SCALAR kernel, while the consumer
  // of that value hands it whatever element the collection holds. An element
  // that is itself a collection reached `Math.sin` whole, which coerces
  // through `Number` and answers NaN for `[1, 2]` and `0` for `[]`. The
  // interpreter applies the operator's own broadcast to such an element.
  //
  // The wrapper dispatches through `_SYS.bcast`, the OPERATOR broadcast: an
  // empty operator position is `Nothing` (`Sin([])` evaluates to `"Nothing"`),
  // which a real-valued target spells NaN — where a function literal applied
  // to `[]` zips zero elements into an empty list.

  test('an element that is a collection is broadcast, not coerced', () => {
    const ce = new ComputeEngine();
    ce.declare('xs', 'list');
    const r = build(ce, ['Map', 'Sin', 'xs']);
    expect(r.code).toContain('_fn_Sin$b');
    expect(r.preamble).toContain(
      'const _fn_Sin$b = (_tv2) => Array.isArray(_tv2) ? ' +
        '_SYS.bcast(_fn_Sin, _tv2) : _fn_Sin(_tv2);'
    );
    const out = r.run({ xs: [[1, 2], [3]] }) as number[][];
    expect(out[0][0]).toBeCloseTo(Math.sin(1), 12);
    expect(out[0][1]).toBeCloseTo(Math.sin(2), 12);
    expect(out[1][0]).toBeCloseTo(Math.sin(3), 12);
    // The interpreter's own answer for such an element.
    const interpreted = ce
      .box(['Sin', ['List', 1, 2]])
      .evaluate()
      .N();
    expect(interpreted.ops![0].re).toBeCloseTo(Math.sin(1), 12);
    expect(interpreted.ops![1].re).toBeCloseTo(Math.sin(2), 12);
  });

  test('an EMPTY element projects to NaN, as the empty operator position does', () => {
    const ce = new ComputeEngine();
    ce.declare('xs', 'list');
    const r = build(ce, ['Map', 'Sin', 'xs']);
    expect(r.run({ xs: [[]] })).toEqual([NaN]);
    expect(
      ce
        .box(['Sin', ['List']])
        .evaluate()
        .toString()
    ).toBe('"Nothing"');
  });

  test('a SCALAR element is unchanged', () => {
    const ce = new ComputeEngine();
    ce.declare('xs', 'list');
    const r = build(ce, ['Map', 'Sin', 'xs']);
    const out = r.run({ xs: [1, 2, 3] }) as number[];
    expect(out[0]).toBeCloseTo(Math.sin(1), 12);
    expect(out[1]).toBeCloseTo(Math.sin(2), 12);
    expect(out[2]).toBeCloseTo(Math.sin(3), 12);
  });

  test('a NON-broadcastable built-in keeps the bare name', () => {
    // `First` consumes its argument whole — the interpreter does not apply it
    // element by element — so a collection element must reach its kernel
    // intact.
    const ce = new ComputeEngine();
    ce.declare('xs', 'list');
    const r = build(ce, ['Map', 'First', 'xs']);
    expect(r.code).toContain('(_fn_First)');
    expect(r.code).not.toContain('_fn_First$b');
    expect(
      r.run({
        xs: [
          [1, 2],
          [3, 4],
        ],
      })
    ).toEqual([1, 3]);
    ce.assign('xs', ce.box(['List', ['List', 1, 2], ['List', 3, 4]]));
    expect(ce.box(['Map', 'First', 'xs']).evaluate().toString()).toBe('[1,3]');
  });
});

describe('an INLINE function literal in value position broadcasts', () => {
  // The spliced arrow's body is emitted for scalars only, so `Map((x) ↦ 2x,
  // xs)` multiplied a whole row as a number. The literal is bound to a name
  // once and handed out through the same `_SYS.bcastFn` wrapper a NAMED
  // scalar-parameter function gets, so the two spellings agree.
  const DOUBLE = ['Function', ['Multiply', 2, 'x'], 'x'];

  test('an element that is a collection is broadcast, not coerced', () => {
    const ce = new ComputeEngine();
    ce.declare('xs', 'list');
    const r = build(ce, ['Map', DOUBLE, 'xs']);
    expect(r.code).toContain('_SYS.bcastFn');
    expect(r.run({ xs: [[1, 2], [], [3]] })).toEqual([[2, 4], [], [6]]);
    expect(
      ce
        .box(['Map', DOUBLE, ['List', ['List', 1, 2], ['List'], ['List', 3]]])
        .evaluate()
        .toString()
    ).toBe('[[2,4],[],[6]]');
  });

  test('the arrow is bound ONCE, not rebuilt per element', () => {
    const ce = new ComputeEngine();
    ce.declare('xs', 'list');
    const r = build(ce, ['Map', DOUBLE, 'xs']);
    expect(r.code.split('2 * x').length - 1).toBe(1);
  });

  test('a SCALAR element is unchanged', () => {
    const ce = new ComputeEngine();
    ce.declare('xs', 'list');
    const r = build(ce, ['Map', DOUBLE, 'xs']);
    expect(r.run({ xs: [1, 2, 3] })).toEqual([2, 4, 6]);
    expect(
      ce
        .box(['Map', DOUBLE, ['List', 1, 2, 3]])
        .evaluate()
        .toString()
    ).toBe('[2,4,6]');
  });

  test('a COLLECTION-parameter literal keeps the bare arrow', () => {
    const ce = new ComputeEngine();
    ce.declare('xs', 'list');
    const literal = [
      'Function',
      ['Sum', 'L'],
      ['Typed', 'L', { str: 'list<number>' }],
    ];
    const r = build(ce, ['Map', literal, 'xs']);
    expect(r.code).not.toContain('_SYS.bcastFn');
    expect(
      r.run({
        xs: [
          [1, 2],
          [3, 4],
        ],
      })
    ).toEqual([3, 7]);
  });
});

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

  test('a reducing body over a parameter with no declared type declines', () => {
    // The type of `L` is inferred as `collection`: an element can be a
    // number or a list, and the compiled `Sum` would test its shape at run
    // time. The body declines, and so does the `Sum` of the number `u`,
    // which has no indexing set.
    const ce = engineWithF();
    ce.assign('k', ce.box(['Function', ['Sum', 'L'], 'L']));
    const r = build(ce, ['f', ['k', 'u']]);
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

describe('a body that builds a collection keeps its element-wise lowering', () => {
  // Both bodies state their width, so the element-wise lowering is the
  // component one — one expression per component — rather than the run-time
  // `_SYS.bcast` dispatch. The two differ in what the compiler can prove
  // about the CALL's result: a list-returning call is tested for its shape
  // first, while a point-returning call is proved a two-component array by
  // the point analysis and needs no test.
  test('a list-returning body still broadcasts, and agrees with the interpreter', () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'number');
    ce.assign(
      'm',
      ce.box(['Function', ['List', 't', ['Multiply', 2, 't']], 't'])
    );
    const r = build(ce, ['Multiply', 2, ['m', 't']]);
    // The call result is tested for its shape before its components are read,
    // so the `_SYS.bcast` dispatch survives as the ELSE branch of that test —
    // never on the path a correctly shaped result takes.
    expect(r.code.split('_SYS.bcast(').length).toBe(
      r.code.split(' : _SYS.bcast(').length
    );
    expect(r.code).toContain('[0]');
    expect(r.run({ t: 3 })).toEqual([6, 12]);
    expect(
      ce
        .box(['Multiply', 2, ['m', 3]])
        .evaluate()
        .toString()
    ).toBe('[6,12]');
  });

});

describe('a symbol a body CAPTURES carries its own evidence', () => {
  /** `g: s ↦ 2s`, `f: t ↦ g(y)` — `f` ignores its own argument and answers a
   * broadcast over the captured `y`. `declareY` gives `y` an explicit scalar
   * type before the two literals are boxed. */
  function captured(declareY: boolean): ComputeEngine {
    const ce = new ComputeEngine();
    if (declareY) ce.declare('y', 'number');
    else ce.declare('y', 'real | list<real>');
    ce.assign('g', ce.box(['Function', ['Multiply', 2, 's'], 's'] as any));
    ce.assign('f', ce.box(['Function', ['g', 'y'], 't'] as any));
    return ce;
  }

  test('a captured symbol declared with a union of shapes declines the enclosing call', () => {
    // `y` is declared `real | list<real>` and only the body of `f` reads it:
    // the pipeline refuses the input `y` of a union type.
    const ce = captured(false);
    const r = build(ce, ['g', ['f', 1]]);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/the function f reads the input y of type/);
  });

});

describe('a user function REFERENCED AS A VALUE takes the variant for the element shape', () => {
  /** The consumer of a function value hands the callee each element of the
   * source, and an element can itself be a collection — a row of a matrix.
   * The interpreter applies a function with scalar parameters element-wise
   * to such a row. The compiled reference is chosen from the STATIC element
   * type of the source: the function itself for a scalar element, and a
   * static map of it (`_fn_f$m1 = (_tv1) => _SYS.mapFn(_fn_f, [1], _tv1)`)
   * for an element that is a list. No code tests the shape of an element at
   * run time. An element type that does not settle one shape
   * (`expression`) declines with the code `unsettled-shape`, and the
   * interpreter evaluates the expression. */

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

});

describe('a BUILT-IN operator name referenced as a callback broadcasts', () => {
  // `Map(Sin, xs)` eta-expands the operator into the shared local
  // `_fn_Sin = (_tv1) => Math.sin(_tv1)`, a SCALAR kernel, while the consumer
  // of that value hands it each element of the collection. An element that
  // is itself a collection must not reach `Math.sin` whole: `Number` coerces
  // `[1, 2]` to NaN and `[]` to `0`. The interpreter applies the operator's
  // own broadcast to such an element.
  //
  // For a source whose static element type is a list, the reference is a
  // static map of the kernel, `_fn_Sin$m1`. A static map over an empty
  // element gives the EMPTY LIST, as `Sin([])` evaluates to `[]`. A source
  // with an element type of `expression` does not settle the shape and
  // declines.

  test('an EMPTY element answers the empty list, as the empty operator position does', () => {
    const ce = new ComputeEngine();
    ce.declare('xs', 'list<list<number>>');
    const r = build(ce, ['Map', 'Sin', 'xs']);
    expect(r.run({ xs: [[]] })).toEqual([[]]);
    expect(
      ce
        .box(['Sin', ['List']])
        .evaluate()
        .toString()
    ).toBe('[]');
  });

});


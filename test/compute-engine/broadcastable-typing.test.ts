import { ComputeEngine } from '../../src/compute-engine';
import type { BoxedExpression } from '../../src/compute-engine/global-types';

/**
 * Phase B of the `broadcastable<T>` prototype: `Add`/`Multiply` produce a
 * `broadcastable<T>` result when an operand's collection-ness is not statically
 * visible (a top `unknown`/`any`/`value` leaf such as an undeclared/unknown-
 * return function call, or an already-`broadcastable<…>` inner node), and
 * `At` + argument validation honor it.
 */

/** True when any node in the tree is an `Error` operand. */
function hasErrorOperand(expr: BoxedExpression): boolean {
  if (expr.operator === 'Error') return true;
  return (expr.ops ?? []).some((op) => hasErrorOperand(op));
}

describe('broadcastable<T> typing (phase B)', () => {
  test('unknown-return call: inner Multiply and outer Add are broadcastable<number>', () => {
    const ce = new ComputeEngine();
    ce.declare('h', '(number) -> unknown');

    const inner = ce.box(['Multiply', 2, ['h', 'x']]);
    expect(inner.type.toString()).toBe('broadcastable<number>');

    const e = ce.box(['Subtract', ['Multiply', 2, ['h', 'x']], 1]);
    expect(e.type.toString()).toBe('broadcastable<number>');

    // No `incompatible-type` (or other) Error baked in at canonicalization.
    expect(e.isValid).toBe(true);
    expect(hasErrorOperand(e)).toBe(false);
  });

  test('propagation: Add(broadcastable, scalar) and Multiply(broadcastable, broadcastable)', () => {
    const ce = new ComputeEngine();
    ce.declare('h', '(number) -> unknown');
    const b = ce.box(['Multiply', 2, ['h', 'x']]);
    expect(b.type.toString()).toBe('broadcastable<number>');

    expect(ce.box(['Add', b, 5]).type.toString()).toBe('broadcastable<number>');
    expect(ce.box(['Multiply', b, b]).type.toString()).toBe(
      'broadcastable<number>'
    );
  });

  test('At over a broadcastable base is a valid canonical `number`', () => {
    const ce = new ComputeEngine();
    ce.declare('h', '(number) -> unknown');
    const at = ce.parse('(2h(x)-1)[1]');
    expect(at.operator).toBe('At');
    expect(at.isValid).toBe(true);
    expect(hasErrorOperand(at)).toBe(false);
    expect(at.type.toString()).toBe('number');
  });

  test('runtime agreement: list-returning `f` broadcasts, scalar `g` stays scalar', () => {
    const ce = new ComputeEngine();
    // f is list-returning; `2f(3)` is list/tensor-typed via existing lifts, so
    // this is out of the broadcastable prototype's scope — assert evaluation.
    ce.assign('f', ce.parse('x \\mapsto \\lbrack x, x+1 \\rbrack'));
    const fExpr = ce.box(['Subtract', ['Multiply', 2, ['f', 3]], 1]);
    expect(fExpr.evaluate().toString()).toBe('[5,7]');

    // g is scalar-returning: its body `2x` types scalar (a bare symbol's
    // `unknown` is inference-pending, not possibly-a-collection — see
    // `isPossiblyCollectionTyped`), so the application stays honestly scalar.
    ce.assign('g', ce.parse('x \\mapsto 2x'));
    const gExpr = ce.box(['Subtract', ['Multiply', 2, ['g', 3]], 1]);
    expect(gExpr.type.matches('number')).toBe(true);
    expect(gExpr.evaluate().toString()).toBe('11');
  });

  test('non-interference with scalars and statically-visible collections', () => {
    const ce = new ComputeEngine();
    // Inferred-number symbol: NOT triggered.
    expect(ce.box(['Add', 2, 'x']).type.toString()).toBe('number');
    expect(ce.box(['Multiply', 2, 'x']).type.toString()).toBe('finite_number');
    // Statically-visible collection/tuple/wrapper branches keep today's typing.
    expect(ce.box(['Multiply', 2, ['List', 1, 2, 3]]).type.toString()).toBe(
      'vector<3>'
    );
    expect(
      ce.box(['Add', ['Tuple', 1, 2], ['Tuple', 3, 4]]).type.toString()
    ).toBe('tuple<finite_integer, finite_integer>');
    expect(ce.box(['Multiply', 2, ['Range', 1, 5]]).type.toString()).toBe(
      'list<integer>'
    );
  });

  test('subtype interop at the boxed level', () => {
    const ce = new ComputeEngine();
    ce.declare('h', '(number) -> unknown');
    const b = ce.box(['Multiply', 2, ['h', 'x']]);
    expect(b.type.matches('number')).toBe(false);
    expect(b.type.matches('broadcastable<number>')).toBe(true);
  });

  test('cold-engine symbol exclusion: bare unknown symbols do not trigger', () => {
    // A bare symbol's `unknown` type is inference-pending: on a COLD engine
    // (no prior inference) juxtaposition and arithmetic must stay scalar,
    // exactly as on a warm one. Regression: the trigger once fired on
    // unknown-typed symbols, flipping `2x` to `broadcastable<number>` and
    // mis-grouping `(b^3c^2d)(x^7y)` as `Tuple` via the invisible-operator
    // gate.
    let ce = new ComputeEngine();
    expect(ce.parse('2x').type.toString()).toBe('finite_number');
    ce = new ComputeEngine();
    const juxt = ce.parse('(b^3c^2d)(x^7y)');
    expect(juxt.operator).toBe('Multiply');
    expect(juxt.type.matches('number')).toBe(true);
  });

  test('union-typed operand contributes its unwrapped element', () => {
    // A declared `number | list<number>` return mixed with an unknown-return
    // call: the union operand's contribution is its scalar element, so the
    // element type stays clean (`number`), not `number | list<number>`. (The
    // generic wrapper then lifts the statically-visible list branch to
    // `list<number>`.)
    const ce = new ComputeEngine();
    ce.declare('h', '(number) -> unknown');
    ce.declare('g', '(number) -> number | list<number>');
    const e = ce.box(['Multiply', ['h', 1], ['g', 1]]);
    expect(e.type.toString()).toBe('list<number>');
  });

  test('point accessors over an atomic tuple stay scalar-typed', () => {
    // `(x, y)` types `tuple<unknown, unknown>` (no numeric inference in tuple
    // position), but a point accessor's result is an atomic tuple component —
    // never a broadcast collection — so it types `number`, and downstream
    // arithmetic stays scalar (the load-bearing case for compiled plot
    // bodies: no `_SYS.bcast` on the render path).
    const ce = new ComputeEngine();
    const px = ce.box(['PointX', ['Tuple', 'x', 'y']]);
    expect(px.type.toString()).toBe('number');
    expect(ce.box(['Power', px.json, 2]).type.toString()).toBe(
      'finite_number'
    );

    // But a POSSIBLY-collection APPLICATION component keeps its honest type:
    // `PointX((h(1), y))` returns `h(1)`, which may be a list at run time —
    // folding it to `number` would over-claim, and downstream arithmetic
    // correctly types broadcastable.
    ce.declare('h', '(number) -> unknown');
    const pxh = ce.box(['PointX', ['Tuple', ['h', 1], 'y']]);
    expect(pxh.type.toString()).toBe('unknown');
    expect(ce.box(['Power', pxh.json, 2]).type.toString()).toBe(
      'broadcastable<number>'
    );
  });

  test('invisible operator: juxtaposition with a broadcastable group multiplies', () => {
    const ce = new ComputeEngine();
    ce.declare('h', '(number) -> unknown');
    const e = ce.parse('2(2h(x)-1)');
    expect(e.operator).toBe('Multiply');
    expect(e.type.toString()).toBe('broadcastable<number>');
  });
});

/**
 * Phase C of the `broadcastable<T>` lift: the GENERIC broadcast-typing wrapper
 * in `boxed-function.ts` produces `broadcastable<E>` when a `broadcastable`
 * operator (`Sin`/`Cos`/`Sqrt`/`Power`/`Abs`/…) has an operand whose
 * collection-ness is not statically visible (`isPossiblyCollectionTyped`). This
 * covers all such operators without touching their per-operator handlers.
 */
describe('broadcastable<T> typing (phase C — generic wrapper)', () => {
  // `h(x)` in LaTeX with an undeclared `h` parses as multiplication; declare it
  // as an unknown-return call so the operand is possibly-collection typed.
  const mkEngine = () => {
    const ce = new ComputeEngine();
    ce.declare('h', '(number) -> unknown');
    return ce;
  };

  test('representative operators over a possibly-collection operand are broadcastable', () => {
    const ce = mkEngine();
    // arg = 2h(x)-1, which is broadcastable<number> (phase B).
    const arg = ['Subtract', ['Multiply', 2, ['h', 'x']], 1];
    expect(ce.box(['Sin', arg]).type.toString()).toBe('broadcastable<number>');
    expect(ce.box(['Sqrt', arg]).type.toString()).toBe('broadcastable<number>');
    expect(ce.box(['Power', arg, 2]).type.toString()).toBe(
      'broadcastable<number>'
    );
    expect(ce.box(['Abs', arg]).type.toString()).toBe('broadcastable<real>');
  });

  test('priority: a statically-visible collection operand still types list<…>', () => {
    const ce = mkEngine();
    // The statically-visible arm keeps priority: a concrete list/Range operand
    // gives the more precise `list<E>`, not `broadcastable<E>`.
    expect(ce.box(['Sin', ['Range', 1, 5]]).type.toString()).toBe(
      'list<number>'
    );
    expect(ce.box(['Sin', ['List', 0, 1]]).type.toString()).toBe(
      'list<finite_number>'
    );
  });

  test('idempotence: never broadcastable<broadcastable<…>>', () => {
    const ce = mkEngine();
    // Nested arithmetic over a broadcastable inner node stays single-layer.
    expect(ce.box(['Add', ['Sin', ['Multiply', 2, ['h', 'x']]], 1]).type
      .toString()).toBe('broadcastable<number>');
    expect(
      ce.box(['Sqrt', ['Sin', ['Multiply', 2, ['h', 'x']]]]).type.toString()
    ).toBe('broadcastable<number>');
  });

  test('non-interference: bare-symbol and literal operands stay scalar', () => {
    const ce = mkEngine();
    // A bare (inference-pending) symbol is NOT possibly-collection typed.
    expect(ce.box(['Sin', 'x']).type.toString()).toBe('finite_number');
    // A literal argument numericizes/stays scalar as before.
    expect(ce.box(['Sin', 0.5]).type.toString()).toBe('finite_real');
  });

  test('At over a phase-C broadcastable base is a valid `number`', () => {
    const ce = mkEngine();
    const at = ce.box(['At', ['Sin', ['Subtract', ['Multiply', 2, ['h', 'x']], 1]], 1]);
    expect(at.isValid).toBe(true);
    expect(hasErrorOperand(at)).toBe(false);
    expect(at.type.toString()).toBe('number');
  });
});

/**
 * Phase E of the `broadcastable<T>` lift: honest result typing at the
 * APPLICATION site of user function literals (the durable Tycho 19.2 fix).
 * Applying a scalar-parameter lambda to a collection (or possibly-collection)
 * argument broadcasts element-wise at evaluation, so its type must be
 * `list<E>` (a statically-visible collection argument) or `broadcastable<E>`
 * (a possibly-collection argument), not the scalar signature result. A
 * collection-typed PARAMETER binds its argument whole and keeps the scalar
 * result. Tuples are atomic (bound whole, never mapped).
 *
 * Note: `h(x)` in LaTeX with an UNDECLARED `h` parses as multiplication —
 * these cases build the possibly-collection argument via box form or a
 * declared `h`.
 */
describe('broadcastable<T> typing (phase E — application-site typing)', () => {
  test('scalar-param lambda applied to a List types list<E>, agreeing with the value', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.parse('x \\mapsto 2x'));
    const app = ce.box(['g', ['List', 1, 2, 3]]);
    // Honest element per g's return (`2x` body → finite_number).
    expect(app.type.toString()).toBe('list<finite_number>');
    // Type and value agree: evaluation broadcasts to a List.
    expect(app.evaluate().toString()).toBe('[2,4,6]');
  });

  test('scalar-param lambda applied to a possibly-collection argument types broadcastable<E>', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.parse('x \\mapsto 2x'));
    ce.declare('h', '(number) -> unknown');
    const arg = ce.box(['Multiply', 2, ['h', 1]]);
    expect(arg.type.toString()).toBe('broadcastable<number>');
    expect(ce.box(['g', arg]).type.toString()).toBe(
      'broadcastable<finite_number>'
    );
  });

  test('numeric-tuple argument of an inferred-signature lambda types `any`', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.parse('x \\mapsto 2x'));
    const app = ce.box(['g', ['Tuple', 1, 2]]);
    // The tuple binds WHOLE to the scalar parameter (atomic, never mapped), then
    // the body's arithmetic broadcasts it: `2·(1,2) = (2,4)` — a tuple, not the
    // scalar `finite_number` the inferred signature would report. Since the body
    // shape isn't statically knowable, the honest type is `any`.
    expect(app.type.toString()).toBe('any');
    expect(app.evaluate().toString()).toBe('(2, 4)');
  });

  test('declared collection-typed parameter binds whole: NO list-wrap', () => {
    const ce = new ComputeEngine();
    ce.declare('f', '(list<number>) -> number');
    ce.assign('f', ce.parse('v \\mapsto 5'));
    // paramsAreScalar is false (list<number> param) → scalar result preserved.
    expect(ce.box(['f', ['List', 1, 2]]).type.toString()).toBe('number');
    expect(ce.box(['f', ['List', 1, 2]]).evaluate().toString()).toBe('5');
  });

  test('scalar-to-scalar application typing is unchanged (non-interference)', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.parse('x \\mapsto 2x'));
    // A scalar argument: no broadcast. The finite-narrowing keeps today's type.
    expect(ce.box(['g', 3]).type.toString()).toBe('finite_integer');
    expect(ce.box(['g', 3]).evaluate().toString()).toBe('6');
  });

  test('collection-valued return: the element type is the return type VERBATIM', () => {
    // `f := x ↦ [x, -x]` maps EACH element to a 2-vector, so the application
    // over a list types as a list OF that return type — not its unwrapped
    // scalar element (`broadcastElementType` would have flattened it to
    // `list<number>`).
    const ce = new ComputeEngine();
    ce.assign('f', ce.parse('x \\mapsto \\lbrack x, -x \\rbrack'));
    const app = ce.box(['f', ['List', 1, 2]]);
    expect(app.type.toString()).toBe('list<vector<2>>');
    expect(app.evaluate().toString()).toBe('[[1,-1],[2,-2]]');
  });

  test('Tycho 19.2 chain: broadcastable argument flows through an application', () => {
    const ce = new ComputeEngine();
    ce.assign('m', ce.parse('x \\mapsto 2x - 1'));
    ce.declare('h', '(number) -> unknown');
    const p0 = ce.box(['Multiply', 2, ['h', 1]]);
    expect(p0.type.toString()).toBe('broadcastable<number>');

    const p1 = ce.box(['m', p0]);
    expect(p1.type.toString()).toBe('broadcastable<finite_number>');

    // `At(m(2h(1)), 1)` is valid with an element type from the return.
    const at = ce.box(['At', ['m', p0], 1]);
    expect(at.isValid).toBe(true);
    expect(hasErrorOperand(at)).toBe(false);
    expect(at.type.toString()).toBe('finite_number');

    // Chaining stays single-layer broadcastable (idempotent).
    expect(ce.box(['m', p1]).type.toString()).toBe(
      'broadcastable<finite_number>'
    );
  });
});

describe('post-evaluation lambda broadcast', () => {
  // A scalar-parameter user lambda applied to an argument that only EVALUATES
  // to a finite indexed collection must map the lambda element-wise, returning
  // a `List`, for ALL bodies — not only arithmetic bodies that broadcast
  // internally. This aligns evaluation with the `broadcastable<E>` application
  // typing (phase E).
  const makeEngine = () => {
    const ce = new ComputeEngine();
    // A real list-returning function: `lst(3)` evaluates to `[3, -3]`.
    ce.assign('lst', ce.parse('n \\mapsto \\lbrack n, -n \\rbrack'));
    return ce;
  };

  test('1. non-arithmetic body over an evaluated-collection arg maps element-wise', () => {
    const ce = makeEngine();
    ce.assign('k', ce.box(['Function', ['If', ['Greater', 'x', 0], 1, -1], 'x']));
    const r = ce.box(['k', ['lst', 3]]).evaluate();
    // Was inert (`If(0 < [3,-3], 1, -1)`); now broadcasts.
    expect(r.operator).toBe('List');
    expect(r.toString()).toBe('[1,-1]');
  });

  test('2. arithmetic body unchanged in value', () => {
    const ce = makeEngine();
    ce.assign('g', ce.parse('x \\mapsto 2x'));
    const r = ce.box(['g', ['lst', 3]]).evaluate();
    expect(r.operator).toBe('List');
    expect(r.toString()).toBe('[6,-6]');
  });

  test('3. direct visible collection still broadcasts (step 2b non-regression)', () => {
    const ce = makeEngine();
    ce.assign('k', ce.box(['Function', ['If', ['Greater', 'x', 0], 1, -1], 'x']));
    expect(ce.box(['k', ['List', 1, -2, 3]]).evaluate().toString()).toBe(
      '[1,-1,1]'
    );
  });

  test('4. tuples are atomic — never mapped', () => {
    const ce = makeEngine();
    ce.assign('g', ce.parse('x \\mapsto 2x'));
    const r = ce.box(['g', ['Tuple', 1, 2]]).evaluate();
    expect(r.operator).toBe('Tuple');
    expect(r.toString()).toBe('(2, 4)');
  });

  test('5. declared collection param binds whole (no per-element map)', () => {
    const ce = makeEngine();
    ce.declare('total', '(list<number>) -> number');
    ce.assign('total', ce.box(['Function', ['Sum', 'xs'], 'xs']));
    const r = ce.box(['total', ['lst', 3]]).evaluate();
    // Sum([3,-3]) = 0 — a scalar, NOT a list of per-element sums.
    expect(r.operator).not.toBe('List');
    expect(r.toString()).toBe('0');
    expect(ce.box(['total', ['List', 1, 2, 3]]).evaluate().toString()).toBe('6');
  });

  test('6. scalar arg → scalar result', () => {
    const ce = makeEngine();
    ce.assign('k', ce.box(['Function', ['If', ['Greater', 'x', 0], 1, -1], 'x']));
    expect(ce.box(['k', 5]).evaluate().toString()).toBe('1');
  });

  test('7. nested broadcast composes', () => {
    const ce = makeEngine();
    ce.assign('k', ce.box(['Function', ['If', ['Greater', 'x', 0], 1, -1], 'x']));
    const r = ce.box(['k', ['k', ['lst', 3]]]).evaluate();
    // Inner k(lst(3)) = [1,-1]; outer k([1,-1]) = [sign 1, sign -1] = [1,-1].
    expect(r.operator).toBe('List');
    expect(r.toString()).toBe('[1,-1]');
  });

  test('8. options threading: .N() numericizes broadcast elements', () => {
    // The body's exact and numeric forms must DIFFER, so this test actually
    // detects a dropped `options` in the per-element `evaluate(options)` call:
    // `√|x|` stays symbolic under evaluate() and numericizes under .N().
    const ce = makeEngine();
    ce.assign('s', ce.box(['Function', ['Sqrt', ['Abs', 'x']], 'x']));
    const exact = ce.box(['s', ['lst', 3]]).evaluate();
    expect(exact.operator).toBe('List');
    expect(exact.toString()).toBe('[sqrt(3),sqrt(3)]');
    const approx = ce.box(['s', ['lst', 3]]).N();
    expect(approx.operator).toBe('List');
    expect(approx.toString()).toMatch(/\[1\.732\d+,1\.732\d+\]/);
  });

  test('9. empty evaluated collection broadcasts to an empty List', () => {
    // The lambda-broadcast arm returns `List(results)` UNCONDITIONALLY (even
    // length 0), diverging from the sibling non-lambda branch which is
    // length-gated. Pinned so a future unification of the two branches can't
    // silently change the empty case.
    const ce = makeEngine();
    ce.assign('emptyf', ce.box(['Function', ['List'], 'n']));
    ce.assign('k', ce.box(['Function', ['If', ['Greater', 'x', 0], 1, -1], 'x']));
    const r = ce.box(['k', ['emptyf', 1]]).evaluate();
    expect(r.operator).toBe('List');
    expect(r.toString()).toBe('[]');
  });

  test('value-def route (declared scalar param) also broadcasts', () => {
    const ce = makeEngine();
    // A declared signature resolves through the value-def apply path
    // (`applyFunctionLiteral`), which evaluates its args before the broadcast
    // gate — so an evaluated-collection argument maps element-wise too.
    ce.declare('vf', '(any) -> any');
    ce.assign('vf', ce.box(['Function', ['If', ['Greater', 'y', 0], 1, -1], 'y']));
    expect(ce.box(['vf', ['lst', 3]]).evaluate().toString()).toBe('[1,-1]');
    expect(ce.box(['vf', ['List', 1, -2, 3]]).evaluate().toString()).toBe(
      '[1,-1,1]'
    );
  });

  test('Map over a list of lists with a scalar lambda is unchanged (no double-map)', () => {
    const ce = makeEngine();
    ce.assign('k', ce.box(['Function', ['If', ['Greater', 'x', 0], 1, -1], 'x']));
    // Map already maps; the inner element `[1,2]` is a visible collection
    // handled by step 2b, so nested-list behavior is unchanged.
    expect(
      ce
        .box(['Map', ['List', ['List', 1, 2], ['List', 3, 4]], 'k'])
        .evaluate()
        .toString()
    ).toBe('[[1,1],[1,1]]');
  });
});

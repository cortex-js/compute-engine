/**
 * A parameter of an emitted user-function body holds a run-time SCALAR when
 * no parameter of that function binds its argument whole — whatever the
 * parameter's own type says, `unknown` included (user ruling 2026-09-09).
 *
 * A nested call `g(x)` inside `f(x) := g(x) + 1` therefore emits the bare
 * `_fn_g(x)`, where it used to emit `_SYS.bcastFn(_fn_g, x)` for the sole
 * reason that inference leaves an unannotated parameter typed `unknown`. The
 * reason the bare call is sound is that the body never chooses what reaches
 * it: its call sites do, and every one of them is broadcast-aware. A caller
 * that hands `f` a list is dispatched element-wise (or guarded by
 * `Array.isArray`) at the CALLER's site, so the body runs once per element
 * with a scalar bound — which is what the body's own arithmetic already
 * assumes when it writes `x * x` for a product.
 *
 * This is the shape a Desmos macro chain has: a chain of small functions of
 * one or two variables, whose parameters cannot be annotated.
 *
 * The three exclusions are unchanged and pinned here as well: a
 * collection-typed parameter binds its argument whole and keeps the nested
 * dispatch; a tuple/point argument is atomic and never broadcast; and at the
 * ROOT, a free symbol whose scalar type was merely INFERRED still gets the
 * `Array.isArray` guard (user ruling 2026-08-30), while an explicitly
 * declared one gets the bare call (user ruling 2026-09-07).
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { executeEpsil } from '../../src/epsil/execute-epsil';

/** Compile without constant folding — a folded call site emits no call at
 * all, so a fold would hide the very emission under test. */
function build(ce: ComputeEngine, expr: unknown): any {
  return compile(ce.box(expr as any), { constantFold: false } as any);
}

/** The three-macro chain `f(x) := g(x) + 1`, `g(x) := 2·h(x)`,
 * `h(x) := x²`, with UNANNOTATED parameters. */
function macroChain(): ComputeEngine {
  const ce = new ComputeEngine();
  const def = (name: string, body: unknown) =>
    ce.box(['DefineFunction', name, ['Function', body, 'x']] as any).evaluate();
  def('h', ['Power', 'x', 2]);
  def('g', ['Multiply', ['h', 'x'], 2]);
  def('f', ['Add', ['g', 'x'], 1]);
  return ce;
}

describe('a nested call inside a scalar-parameter definition is direct', () => {
  test('the three-macro chain emits bare calls, with no dispatch and no guard', () => {
    const ce = macroChain();
    const r = build(ce, ['f', 'x']);
    expect(r.preamble).toContain('_fn_g(x)');
    expect(r.preamble).toContain('_fn_h(x)');
    expect(r.preamble).not.toContain('_SYS.bcastFn(');
    expect(r.preamble).not.toContain('Array.isArray(');
  });

  test('a list handed to the OUTER function still broadcasts through the chain', () => {
    const ce = macroChain();
    const r = build(ce, ['f', 'x']);
    // `x` is a free symbol at the root here, so the ROOT call is what
    // broadcasts; each body then sees one element at a time.
    expect(r.run({ x: 2 })).toBe(9);
    expect(r.run({ x: [1, 2, 3] })).toEqual([3, 9, 19]);
    expect(
      ce
        .box(['f', ['List', 1, 2, 3]] as any)
        .evaluate()
        .toString()
    ).toBe('[3,9,19]');
    // A NESTED list broadcasts one rank further, as the interpreter does.
    expect(r.run({ x: [[1, 2], [3]] })).toEqual([[3, 9], [19]]);
    expect(
      ce
        .box([
          'f',
          ['List', ['List', 1, 2], ['List', 3]],
        ] as any)
        .evaluate()
        .toString()
    ).toBe('[[3,9],[19]]');
  });

  test('scalar arithmetic over a parameter is a scalar argument too', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.box(['Function', ['Multiply', 2, 'x'], 'x'] as any));
    ce.assign(
      'f',
      ce.box(['Function', ['g', ['Add', ['Multiply', 3, 't'], 1]], 't'] as any)
    );
    const r = build(ce, ['f', 'u']);
    expect(r.preamble).toContain('_fn_g(');
    expect(r.preamble).not.toContain('_SYS.bcastFn(');
    expect(r.run({ u: 2 })).toBe(14);
    expect(r.run({ u: [1, 2] })).toEqual([8, 14]);
  });

  test('every clause of a MULTI-CLAUSE definition gets the same treatment', () => {
    const ce = new ComputeEngine();
    executeEpsil(
      ce,
      `function h(x) { x * x }\n` +
        `function f(x) { h(x) + 1 }\n` +
        `function f(x, y) { h(x) + h(y) }`
    );
    const r = build(ce, ['f', 'u']);
    expect(r.preamble).toContain('const _fn_f$c1 = (x) => _fn_h(x) + 1;');
    expect(r.preamble).toContain(
      'const _fn_f$c2 = (x, y) => _fn_h(x) + _fn_h(y);'
    );
    expect(r.preamble).not.toContain('_SYS.bcastFn(_fn_h');
    // The dispatcher, and both clauses, answer what the interpreter answers.
    expect(r.run({ u: 3 })).toBe(10);
    expect(ce.box(['f', 3] as any).evaluate().toString()).toBe('10');
    expect(r.run({ u: [1, 2] })).toEqual([2, 5]);
    expect(
      ce
        .box(['f', ['List', 1, 2]] as any)
        .evaluate()
        .toString()
    ).toBe('[2,5]');
  });
});

describe('what the ruling does NOT change', () => {
  test('a COLLECTION-typed parameter keeps the nested dispatch', () => {
    // `L` binds a whole list, so the nested call of the scalar-parameter `g`
    // is what maps over it. Nothing about this definition is recorded as a
    // scalar, and the emitted form is the one HEAD emitted.
    const ce = new ComputeEngine();
    ce.assign('g', ce.box(['Function', ['Multiply', 2, 'x'], 'x'] as any));
    ce.assign(
      'fL',
      ce.box([
        'Function',
        ['Add', ['Sum', 'L'], ['g', 'L']],
        ['Typed', 'L', "'list<number>'"],
      ] as any)
    );
    const r = build(ce, ['fL', ['List', 1, 2, 3]]);
    expect(r.preamble).toContain('_SYS.bcastFn(_fn_g, L)');
    expect(r.run({})).toEqual([8, 10, 12]);
    expect(
      ce
        .box(['fL', ['List', 1, 2, 3]] as any)
        .evaluate()
        .toString()
    ).toBe('[8,10,12]');
  });

  test('a TUPLE-typed parameter keeps its bare whole-value call', () => {
    // A point lowers to a JS array, so it must never be broadcast over; the
    // callee binds it whole and the call is direct for that reason, not for
    // the ruling's.
    const T = "'tuple<number, number>'";
    const ce = new ComputeEngine();
    ce.assign(
      'q',
      ce.box([
        'Function',
        ['Add', ['At', 'P', 1], ['At', 'P', 2]],
        ['Typed', 'P', T],
      ] as any)
    );
    ce.assign('p', ce.box(['Function', ['q', 'P'], ['Typed', 'P', T]] as any));
    const r = build(ce, ['p', ['Tuple', 3, 4]]);
    expect(r.preamble).toContain('const _fn_p = (P) => _fn_q(P);');
    expect(r.run({})).toBe(7);
  });

  test('a root free symbol whose scalar type was INFERRED keeps the guard', () => {
    const ce = new ComputeEngine();
    ce.declare('f', '(x: number) -> number');
    ce.assign(
      'f',
      ce.box(['Function', ['Add', ['Multiply', 2, 'x'], 1], 'x'] as any)
    );
    const r = build(ce, ['f', 'y']);
    expect(r.code).toContain('Array.isArray');
    expect(r.code).toContain('_SYS.bcastFn');
    expect(r.run({ y: 21 })).toBe(43);
    expect(r.run({ y: [1, 2, 3] })).toEqual([3, 5, 7]);
  });

  test('a root free symbol explicitly DECLARED scalar keeps the bare call', () => {
    const ce = new ComputeEngine();
    ce.declare('z', 'number');
    ce.declare('f', '(x: number) -> number');
    ce.assign(
      'f',
      ce.box(['Function', ['Add', ['Multiply', 2, 'x'], 1], 'x'] as any)
    );
    const r = build(ce, ['f', 'z']);
    expect(r.code).toContain('_fn_f(_.z)');
    expect(r.code).not.toContain('Array.isArray');
    expect(r.run({ z: 21 })).toBe(43);
  });
});

//
// AN ATOMIC ARGUMENT BESIDE ONE THAT MAY BE A COLLECTION.
//
// A tuple (a point) and a nominal value both reach the callee WHOLE: the
// interpreter binds them, never maps over them, and both lower to a JS array
// the runtime broadcast would otherwise descend into. That used to switch the
// broadcast off for the WHOLE call, which was harmless only as long as the
// callee's body dispatched on its own: with the direct call above, a sibling
// list argument reached a scalar body untouched.
//
describe('an ATOMIC argument does not switch off the sibling broadcast', () => {
  /** `g(x) := 2x` and `f(p, x) := g(x)`, with `a b u v` declared real. */
  function pointAndListEngine(): ComputeEngine {
    const ce = new ComputeEngine();
    for (const s of ['a', 'b', 'u', 'v']) ce.declare(s, 'real');
    ce.assign('g', ce.box(['Function', ['Multiply', 2, 'x'], 'x'] as any));
    ce.assign('f', ce.box(['Function', ['g', 'x'], 'p', 'x'] as any));
    return ce;
  }

  test('the point is HELD and the list is broadcast over', () => {
    const ce = pointAndListEngine();
    const expr = ['f', ['Tuple', 'a', 'b'], ['List', 'u', 'v']];
    const r = build(ce, expr);
    // The point is bound to a temporary and closed over, so the broadcast
    // never sees it as a source; the list is the only source.
    expect(r.code).toContain('_SYS.bcastFn(');
    expect(r.run({ a: 1, b: 2, u: 1, v: 2 })).toEqual([2, 4]);
    expect(
      ce
        .box(expr as any)
        .subs({ a: 1, b: 2, u: 1, v: 2 } as any)
        .evaluate()
        .toString()
    ).toBe('[2,4]');
  });

  test('with a provably scalar sibling the bare direct call stands', () => {
    const ce = pointAndListEngine();
    const expr = ['f', ['Tuple', 'a', 'b'], 'u'];
    const r = build(ce, expr);
    expect(r.code).toBe('_fn_f([_.a, _.b], _.u)');
    expect(r.run({ a: 1, b: 2, u: 3 })).toBe(6);
    expect(
      ce
        .box(expr as any)
        .subs({ a: 1, b: 2, u: 3 } as any)
        .evaluate()
        .toString()
    ).toBe('6');
  });

  test('a call whose every argument is atomic keeps its whole-value form', () => {
    // The `bag`/`size` case of `type-constructors-compile.test.ts`: a nominal
    // value is bound whole, and with no other argument there is nothing to
    // broadcast over, so the emitted call is unchanged.
    const ce = new ComputeEngine();
    const r0 = executeEpsil(
      ce,
      `type bag = list<number>\n` + `function size(b: bag) -> number { 42 }`
    );
    expect(r0.diagnostics.map((d) => String(d.message))).toEqual([]);
    const r = build(ce, ['size', ['bag', ['List', 1, 2, 3]]]);
    expect(r.code).toBe('_fn_size([1, 2, 3])');
    expect(r.code).not.toContain('bcastFn');
    expect(r.run({})).toBe(42);
  });

  test('the held argument is evaluated ONCE, however many elements map', () => {
    // A coordinate with a side effect — a random draw — must be drawn once
    // for the whole call, not once per element of the sibling list. The
    // emission is what settles it: the draw sits in the argument list of the
    // outer call, which binds it to a temporary before the broadcast runs,
    // and it appears nowhere inside the closure the broadcast applies.
    const ce = pointAndListEngine();
    const r = build(ce, ['f', ['Tuple', ['Random'], 0], ['List', 'u', 'v']]);
    const draws = r.code.match(/drawNextRandomNumber/g) ?? [];
    expect(draws).toHaveLength(1);
    // The one draw is in the OUTER argument list, at the end of the emitted
    // call, and the closure the broadcast applies per element holds only the
    // temporary the point was bound to.
    expect(r.code).toMatch(
      /\)\)\(\[_SYS\.drawNextRandomNumber\(\), 0\], \[_\.u, _\.v\]\)$/
    );
    expect(r.run({ u: 1, v: 2 })).toEqual([2, 4]);
  });
});

//
// A MULTI-CLAUSE FUNCTION REFERENCED AS A VALUE.
//
// A clause set has no single function literal, so the value reference used to
// hand out the bare dispatcher, and a consumer that holds collection elements
// — a matrix row — passed one whole to clause bodies that are scalar code.
//
describe('a MULTI-CLAUSE function value is shape-aware', () => {
  /** `h(x) := 3x`, `mc(x) := h(x) + 1`, `mc(x, y) := h(x) + h(y)`. */
  function clauseEngine(): ComputeEngine {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      `function h(x) { 3 * x }\n` +
        `function mc(x) { h(x) + 1 }\n` +
        `function mc(x, y) { h(x) + h(y) }`
    );
    expect(r.diagnostics.map((d) => String(d.message))).toEqual([]);
    return ce;
  }

  test('a row of a matrix is broadcast, as the interpreter broadcasts it', () => {
    const ce = clauseEngine();
    const expr = ['Map', 'mc', ['List', ['List', 1, 2], ['List', 3]]];
    const r = build(ce, expr);
    // The wrapper keeps a REST parameter: the dispatcher selects its clause
    // on the number of arguments.
    expect(r.preamble).toContain('const _fn_mc$b = (..._');
    expect(r.run({})).toEqual([[4, 7], [10]]);
    expect(ce.box(expr as any).evaluate().toString()).toBe('[[4,7],[10]]');
  });

  test('a flat source still reaches the dispatcher directly', () => {
    const ce = clauseEngine();
    const expr = ['Map', 'mc', ['List', 1, 2, 3]];
    const r = build(ce, expr);
    expect(r.run({})).toEqual([4, 7, 10]);
    expect(ce.box(expr as any).evaluate().toString()).toBe('[4,7,10]');
  });

  test('a clause parameter that binds a value whole keeps the bare reference', () => {
    // A nominal parameter is atomic (`signatureParamsLowerToScalars`), so no
    // broadcasting wrapper is emitted for such a clause set.
    //
    // The gate is unreachable through this route today: a clause parameter
    // of a type with no faithful JavaScript guard — a nominal, a tuple, a
    // collection — makes the whole multi-clause emission decline, and the
    // reference then falls back to a free-symbol read of the function's own
    // name, which is undefined at run time. That fall-through is a separate,
    // pre-existing defect (ROADMAP.md, "A user function that cannot be
    // emitted, referenced as a VALUE, compiles to a broken artifact"). What
    // this test pins is the part that is settled: such a function does not
    // get the broadcasting wrapper.
    const ce = new ComputeEngine();
    const r0 = executeEpsil(
      ce,
      `type meters = number\n` +
        `function w(d: meters) { 2 }\n` +
        `function w(x, y) { x + y }`
    );
    expect(r0.diagnostics.map((d) => String(d.message))).toEqual([]);
    const r = build(ce, ['Map', 'w', ['List', 1, 2, 3]]);
    expect(r.preamble ?? '').not.toContain('$b');
  });
});

//
// A POINT THROUGH AN UNTYPED PARAMETER — a pre-existing gap, pinned as it is.
//
// `p(P) := q(P)`, `q(P) := r(P)`, `r(P) := 2·P` called as `p((a, b))` binds a
// POINT to a parameter nothing types: inference reads parameter types from
// body uses, not from call sites, so `P` stays `unknown` and the body's `2·P`
// is emitted as scalar arithmetic over a JS array. The interpreter scales the
// point and answers `(2a, 2b)`; the compiled body answers NaN. That is what
// the DIRECT call `r((a, b))` has always answered, before this ruling and
// after it.
//
// Before the ruling the two nested calls of the chain emitted a broadcast,
// which MAPPED the body over the point's coordinates and so happened to agree
// with the interpreter for a body — like `2·P` — where scaling a point and
// scaling each coordinate are the same arithmetic. The agreement was
// accidental: measured at HEAD, the same chain over `P·P` answered `[9, 16]`
// where the interpreter reports `no-product-between-points`, and over `2P + 1`
// answered `[7, 9]` where the interpreter reports `incompatible-type`. The
// chain now answers what the direct call answers.
//
// A body that reads the point as a point — `PointX(P)` — types the parameter
// and is unaffected: the nested calls were already direct at HEAD, and the
// compiled answer matches the interpreter.
//
describe('a POINT bound to an untyped parameter (pre-existing gap)', () => {
  function chainEngine(body: unknown): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    ce.declare('b', 'real');
    const def = (name: string, b: unknown) =>
      ce.box(['DefineFunction', name, ['Function', b, 'P']] as any).evaluate();
    def('r', body);
    def('q', ['r', 'P']);
    def('p', ['q', 'P']);
    return ce;
  }

  test('`r(P) := 2P` through the chain answers what the direct call answers', () => {
    const ce = chainEngine(['Multiply', 2, 'P']);
    const chain = build(ce, ['p', ['Tuple', 'a', 'b']]);
    const direct = build(ce, ['r', ['Tuple', 'a', 'b']]);
    expect(chain.preamble).toContain('const _fn_q = (P) => _fn_r(P);');
    // NaN: the body's arithmetic applied to a JS array. The interpreter
    // answers the point `(6, 8)`.
    expect(chain.run({ a: 3, b: 4 })).toBeNaN();
    expect(direct.run({ a: 3, b: 4 })).toBeNaN();
    expect(
      ce
        .box(['p', ['Tuple', 'a', 'b']] as any)
        .subs({ a: 3, b: 4 } as any)
        .evaluate()
        .toString()
    ).toBe('(6, 8)');
  });

  test('`r(P) := PointX(P)` types the parameter and agrees with the interpreter', () => {
    const ce = chainEngine(['PointX', 'P']);
    const chain = build(ce, ['p', ['Tuple', 'a', 'b']]);
    const direct = build(ce, ['r', ['Tuple', 'a', 'b']]);
    expect(chain.run({ a: 3, b: 4 })).toBe(3);
    expect(direct.run({ a: 3, b: 4 })).toBe(3);
    expect(
      ce
        .box(['p', ['Tuple', 'a', 'b']] as any)
        .subs({ a: 3, b: 4 } as any)
        .evaluate()
        .toString()
    ).toBe('3');
  });
});

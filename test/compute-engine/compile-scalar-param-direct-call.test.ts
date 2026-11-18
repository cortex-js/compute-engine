/**
 * A parameter of an emitted user-function body holds a run-time SCALAR when
 * no parameter of that function binds its argument whole — whatever the
 * parameter's own type says, `unknown` included (user ruling 2026-09-09).
 *
 * A nested call `g(x)` inside `f(x) := g(x) + 1` therefore emits the bare
 * `_fn_g(x)`, where it used to emit `_SYS.bcastFn(_fn_g, x)` for the sole
 * reason that inference leaves an unannotated parameter typed `unknown`. The
 * reason the bare call is sound is that the body never chooses what reaches
 * it: its call sites do. A call whose argument has a list static type maps
 * the function over the list at the CALLER's site (`_SYS.mapFn`), so the
 * body runs once per element with a scalar bound — which is what the body's
 * own arithmetic already assumes when it writes `x * x` for a product.
 *
 * This is the shape a Desmos macro chain has: a chain of small functions of
 * one or two variables, whose parameters cannot be annotated.
 *
 * The three exclusions are unchanged and pinned here as well: a
 * collection-typed parameter binds its argument whole and keeps the nested
 * dispatch; a tuple/point argument is atomic and never broadcast. At the
 * ROOT, a free symbol whose scalar type is inferred or declared gets the
 * bare call: the static type is the contract
 * (`docs/plans/2026-10-31-static-shape-compilation.md`, R1 and R5), and a
 * list given for it is a value outside its type.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { executeEpsil } from '../../src/epsil/execute-epsil';

/** Compile without constant folding — a folded call site emits no call at
 * all, so a fold would hide the very emission under test. */
function build(ce: ComputeEngine, expr: unknown): any {
  return compile(ce.box(expr as any), { constantFold: false } as any);
}

describe('a nested call inside a scalar-parameter definition is direct', () => {

  test('every clause of a MULTI-CLAUSE definition gets the same treatment', () => {
    const multiClause = (): ComputeEngine => {
      const ce = new ComputeEngine();
      executeEpsil(
        ce,
        `function h(x) { x * x }\n` +
          `function f(x) { h(x) + 1 }\n` +
          `function f(x, y) { h(x) + h(y) }`
      );
      return ce;
    };
    // An argument typed `any` has no settled shape: the call declines, and
    // names the argument.
    const any = build(multiClause(), [
      'Function',
      ['f', 'u'],
      ['Typed', 'u', "'any'"],
    ]);
    expect(any.success).toBe(false);
    expect(any.unsupported).toContain('u');
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

  test('a clause parameter that binds a value whole keeps the bare reference', () => {
    // A nominal parameter is atomic (`signatureParamsLowerToScalars`), so no
    // static-map wrapper is emitted for such a clause set.
    //
    // The gate is unreachable through this route today: a clause parameter
    // of a type with no faithful JavaScript guard — a nominal, a tuple, a
    // collection — makes the whole multi-clause emission decline, and the
    // reference then falls back to a free-symbol read of the function's own
    // name, which is undefined at run time. That fall-through is a separate,
    // pre-existing defect (ROADMAP.md, "A user function that cannot be
    // emitted, referenced as a VALUE, compiles to a broken artifact"). What
    // this test pins is the part that is settled: such a function does not
    // get a static-map wrapper.
    const ce = new ComputeEngine();
    const r0 = executeEpsil(
      ce,
      `type meters = number\n` +
        `function w(d: meters) { 2 }\n` +
        `function w(x, y) { x + y }`
    );
    expect(r0.diagnostics.map((d) => String(d.message))).toEqual([]);
    const r = build(ce, ['Map', 'w', ['List', 1, 2, 3]]);
    expect(r.preamble ?? '').not.toContain('$m1');
  });
});

//
// Concrete point calls carry their width into shared helper definitions.
// Their original untyped contracts still admit scalar and list calls.
describe('a POINT bound to an untyped parameter specializes a shared helper', () => {
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

  /** Compile with no fallback, so a decline is visible as a throw. */
  const strict = (ce: ComputeEngine, expr: unknown, to = 'javascript'): any =>
    compile(ce.box(expr as any), {
      to,
      constantFold: false,
      fallback: false,
    } as any);

  test('a point built inside a DEFINITION body reaches the nested call as a point', () => {
    const ce = chainEngine(['Multiply', 2, 'P']);
    ce.box([
      'DefineFunction',
      'f',
      ['Function', ['p', ['Tuple', 'x', 'x']], 'x'],
    ] as any).evaluate();
    const r = strict(ce, ['f', 'a']);
    expect(r.preamble).not.toContain('_fn_p');
    expect(r.run({ a: 3 })).toEqual([6, 6]);
    expect(
      ce
        .box(['f', 3] as any)
        .evaluate()
        .toString()
    ).toBe('(6, 6)');
  });

  test('a body the interpreter rejects over a point fails closed instead of answering a list', () => {
    // `P·P` is `no-product-between-points` and `2P + 1` is
    // `incompatible-type` on the interpreter; the by-reference emission used
    // to answer `[9, 16]` and `[7, 9]` for them.
    for (const body of [
      ['Multiply', 'P', 'P'],
      ['Add', ['Multiply', 2, 'P'], 1],
    ]) {
      const ce = chainEngine(body);
      expect(() => strict(ce, ['p', ['Tuple', 'a', 'b']])).toThrow(
        /of a tuple: its value on a tuple is not its value on a list/
      );
      // The fallback route reports the decline and answers through the
      // interpreter, which has no number for an error expression.
      const fallback: any = compile(ce.box(['p', ['Tuple', 'a', 'b']] as any), {
        constantFold: false,
      } as any);
      expect(fallback.success).toBe(false);
      expect(fallback.error).toMatch(
        /of a tuple: its value on a tuple is not its value on a list/
      );
      expect(fallback.run({ a: 3, b: 4 })).toBeNaN();
    }
  });

  test('a shared helper evaluates an IMPURE point argument once', () => {
    const ce = chainEngine(['Multiply', 2, 'P']);
    const r = strict(ce, ['r', ['Tuple', ['Random'], 'b']]);
    expect(r.code.match(/_SYS.drawNextRandomNumber\(\)/g)).toHaveLength(1);
    const value = r.run({ b: 4 });
    expect(value[0]).toBeGreaterThanOrEqual(0);
    expect(value[0]).toBeLessThan(2);
    expect(value[1]).toBe(8);
  });

});

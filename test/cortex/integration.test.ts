import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { executeCortex } from '../../src/cortex/execute-cortex';

//
// Phase 4 "notebook integration" test (the DoD item in
// `roadmap/cortex/phase-4-semantics.md`). Unlike the per-feature cases in
// `execute.test.ts`, this drives ONE multi-statement program — a realistic
// notebook cell-chain — through `executeCortex` against a real engine, then
// (mirroring the notebook scope model: cells share the engine scope) inspects
// the resulting bindings on that same `ce`. Each construct required by the DoD
// appears and its result is asserted with a concrete value.
//

/** Inject the engine's own LaTeX parser for `$…$` islands, non-canonical so the
 * island is spliced structurally and canonicalized in program context (mirrors
 * the `parseLatex` wiring `execute.test.ts` documents). */
function makeParseLatex(ce: ComputeEngine) {
  return (latex: string): MathJsonExpression =>
    ce.parse(latex, { canonical: false }).json;
}

describe('CORTEX PHASE 4 — notebook integration', () => {
  test('a multi-statement program combining every v0 construct', () => {
    const ce = new ComputeEngine();
    const program = [
      'const k = 10', //                  const declaration
      'let r: real = 1.5', //             typed `let` declaration
      'f(x) = x + 1', //                  function definition …
      'let s = 0', //                     accumulator
      'for i in [1, 2, 3, 4] { s = s + i }', // for loop with a side effect
      'let w = 5',
      'while w > 0 { w = w - 1 }', //     while loop
      'let isl = $2 + 3$', //             $…$ LaTeX island
      'let sym = Ln(2)', //               symbolic result (stays symbolic)
      'let num = N(Ln(2))', //            numeric result via explicit N(…)
      'if s > 0 { f(k) + s + w + isl } else { 0 }', // if-expression as value + call
    ].join('\n');

    const { value, diagnostics } = executeCortex(ce, program, {
      parseLatex: makeParseLatex(ce),
    });

    // No *parse* problems: a clean notebook cell.
    expect(diagnostics).toEqual([]);

    // The program's final value is the `if`-expression:
    //   f(k) + s + w + isl = 11 + 10 + 0 + 5 = 26.
    expect(value.operator).toBe('Integer');
    expect(value.re).toBe(26);
    expect(value.json).toMatchInlineSnapshot(`26`);

    // The cell-chain's bindings persist in the shared engine scope. Assert each
    // construct's effect against `ce` (the notebook scope model).
    const read = (name: string) => ce.box(name).evaluate();

    // const + typed `let` declarations.
    expect(read('k').re).toBe(10);
    expect(read('r').re).toBe(1.5);

    // Function definition + call is exercised by the final value (f(10) = 11).
    expect(read('s').re).toBe(10); // for-loop accumulation: 1+2+3+4.
    expect(read('w').re).toBe(0); //  while-loop counted 5 → 0.
    expect(read('isl').re).toBe(5); // $2 + 3$ island.

    // Symbolic-by-default: `Ln(2)` of an exact argument stays symbolic.
    const sym = read('sym');
    expect(sym.operator).toBe('Ln');
    expect(sym.toString()).toBe('ln(2)');

    // Explicit `N(…)` numericizes.
    const num = read('num');
    expect(num.re).toBeCloseTo(Math.log(2), 12);
  });

  test('errors are values: a mid-program error does not halt later statements', () => {
    // Reassigning a `const` is a runtime error. It surfaces as a value (never a
    // throw), the offending binding is unchanged, and the statements after it
    // still execute. Because a mid-program statement's value is discarded,
    // the problem is additionally surfaced as a `runtime-error` diagnostic.
    const ce = new ComputeEngine();
    const program = ['const c = 1', 'c = 2', 'let d = 40', 'd + 2'].join('\n');

    const { value, diagnostics } = executeCortex(ce, program, {
      parseLatex: makeParseLatex(ce),
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message[0]).toBe('runtime-error');
    // The final statement (after the error) evaluated normally.
    expect(value.re).toBe(42);
    // The const kept its original value — the illegal reassignment was rejected.
    expect(ce.box('c').evaluate().re).toBe(1);
  });

  test('a one-step function definition inside a function body binds and applies', () => {
    // Regression: `sq(m) = m * m` inside an applied function body creates an
    // *operator* definition at runtime (via `ce.assign`), while the call
    // site's cached binding is the function-typed *value* placeholder from
    // the canonical pass. `applyFunctionLiteral` now falls back to the
    // operator definition instead of leaving the call symbolic.
    const forms = [
      'function outer(n) { sq(m) = m * m; sq(n) }\nouter(3)',
      'function outer(n) { let sq; sq(m) = m * m; sq(n) }\nouter(3)',
      'function outer(n) { let sq = m |-> m * m; sq(n) }\nouter(3)',
      'sq(m) = m * m\nsq(3)',
    ];
    for (const program of forms) {
      const ce = new ComputeEngine();
      const { value, diagnostics } = executeCortex(ce, program, {
        parseLatex: makeParseLatex(ce),
      });
      expect(diagnostics).toEqual([]);
      expect(value.re).toBe(9);
    }
    // A genuinely undefined function stays symbolic (no operator-def
    // fallback, no recursion).
    const ce = new ComputeEngine();
    const { value } = executeCortex(ce, 'gg(3)', {
      parseLatex: makeParseLatex(ce),
    });
    expect(value.toString()).toBe('gg(3)');
  });
});

//
// The remaining DoD behaviors — errors-are-values for a plain runtime/type
// error, `#env`/`#navigator` pragma gating (off by default, on with
// `allowHostPragmas`), `#error` → diagnostic, and the symbolic-vs-numeric
// `ln(2)` / `N(ln(2))` split — are already covered by `execute.test.ts`
// (describe blocks "errors are values", "pragma security", "exactness
// contract"). Not duplicated here.
//

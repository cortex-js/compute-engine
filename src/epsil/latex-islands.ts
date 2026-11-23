import type { MathJsonExpression } from '../math-json/types.js';
// Type-only: `src/epsil` reads the LaTeX syntax of the engine that the host
// passes, and imports no LaTeX parser itself.
import type { ComputeEngine } from '../compute-engine.js';

/**
 * The parser of the `$…$` islands of a program that a function with an
 * engine reads: the `parseLatex` option of the host when it gives one,
 * otherwise `ce.parse()` in the raw form, which reads the LaTeX with the
 * syntax of the engine (`ce.latexSyntax`) and the engine-wide LaTeX options
 * (`ce.latexOptions`). An engine of the core-only entry has no LaTeX syntax:
 * the result is then `undefined`, and each island is the diagnostic
 * `latex-parsing-unavailable`.
 *
 * `ce.parse()` and not `ce.latexSyntax.parse()`: the parse then knows the
 * functions of the engine, so `$f(x)$` with a declared `f` and
 * `$\operatorname{Gamma}(3)$` are calls and not products, and
 * `$\sin(x) \coloneq 5$` is the error `assignment-to-library-function`. The
 * raw form declares nothing on the engine: the program canonicalizes the
 * MathJSON.
 *
 * The program is parsed before its first statement runs, so an island sees
 * the declarations of the engine at that time, not the bindings of the
 * program: with a function `g` declared by the host, `let g = 5` then
 * `$g(3)$` reads the island as a call of `g`.
 */
export function islandParser(
  ce: ComputeEngine,
  parseLatex: ((latex: string) => MathJsonExpression) | undefined
): ((latex: string) => MathJsonExpression) | undefined {
  if (parseLatex) return parseLatex;
  if (!ce.latexSyntax) return undefined;
  // `ce.parse()` gives `null` when the LaTeX parser gives no expression.
  return (latex) => ce.parse(latex, { form: 'raw' })?.json ?? 'Nothing';
}

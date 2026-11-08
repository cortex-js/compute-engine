import type { Expression } from '../global-types.js';
import type { CompileTarget } from './types.js';
import { isFunction, isSymbol } from '../boxed-expression/type-guards.js';
import { scopeForRebuild } from '../boxed-expression/binding-sites.js';
import { isLibraryOperator } from './builtin-callback.js';

/**
 * Lower the heads of the Epsil `parallel for` construct to heads that the
 * JavaScript target compiles, before the other rewrites of a compilation run:
 *
 * - `ParallelLoop(body, Element(x, xs), …)` → `Loop(body, Element(x,
 *   ParallelDomain(xs)), …)`, and `ParallelComprehension(…)` →
 *   `Comprehension(…)` in the same way. A guard of the first clause is kept.
 *   `ParallelDomain` compiles to `_SYS.parallelPasses(xs)`, which gives the
 *   elements with the random frame of each pass installed
 *   (`docs/RANDOMNESS-MODEL.md` §3, "Pass frames"). The passes then run in
 *   order, and the compiled values are the interpreted ones. The rebuilt node
 *   keeps the scope of the original, where its indices are declared.
 * - `AddTo(s, e)` → `Assign(s, Add(s, e))`, and `AddTo(At(L, p…), e)` →
 *   `Assign(L, ReplaceAt(L, p…, Add(At(L, p…), e)))`: the form whose
 *   in-place update the compiled code already makes
 *   (`ownedLocalUpdateChains()`, `in-place-update.ts`). The positions are
 *   then emitted twice, so a position with an effect (`L[random(1..9)] +=
 *   1`) declines: the interpreter evaluates it once.
 *
 * Only a node whose operator is the library definition of the name is
 * rewritten (`isLibraryOperator()`): a call of a user function named
 * `AddTo` (`function AddTo(a, b) { a * b }`, then `AddTo(s, x)`) stays a
 * call of that function.
 *
 * The passes run in order in the compiled code, as in the interpreter, so a
 * pass that reads an accumulator gets the same value in both. That value is
 * unspecified: a target that runs the passes in parallel can give another
 * one.
 *
 * Only the JavaScript target calls this function. The other targets meet the
 * heads themselves and decline them (`compileExpr()` in
 * `compiler-core.ts`).
 */
export function lowerParallelHeads(expr: Expression): Expression {
  const ce = expr.engine;
  // A node can be shared by several parents: lower it once.
  const memo = new Map<Expression, Expression>();
  const walk = (e: Expression): Expression => {
    if (!isFunction(e)) return e;
    const known = memo.get(e);
    if (known !== undefined) return known;
    let changed = false;
    const ops = e.ops.map((op) => {
      const lowered = walk(op);
      if (lowered !== op) changed = true;
      return lowered;
    });
    const h = e.operator;
    const library =
      (h === 'ParallelLoop' ||
        h === 'ParallelComprehension' ||
        h === 'AddTo') &&
      isLibraryOperator(e, h);
    let result: Expression = e;
    if (
      library &&
      (h === 'ParallelLoop' || h === 'ParallelComprehension') &&
      ops.length >= 2 &&
      isFunction(ops[1], 'Element') &&
      ops[1].nops >= 2
    ) {
      const [binding, domain, ...guard] = ops[1].ops;
      const clause = ce._fn('Element', [
        binding,
        ce._fn('ParallelDomain', [domain]),
        ...guard,
      ]);
      const head = h === 'ParallelLoop' ? 'Loop' : 'Comprehension';
      const loweredOps = [ops[0], clause, ...ops.slice(2)];
      result = ce._fn(head, loweredOps, {
        scope: scopeForRebuild(e.localScope, ce, head, loweredOps),
      });
    } else if (library && h === 'AddTo' && ops.length === 2) {
      const [target, value] = ops;
      if (isSymbol(target))
        result = ce._fn('Assign', [target, ce._fn('Add', [target, value])]);
      else if (isFunction(target, 'At') && isSymbol(target.op1)) {
        const list = target.op1;
        const positions = target.ops.slice(1);
        const impure = positions.find((p) => !p.isPure);
        if (impure !== undefined)
          throw new Error(
            `Could not compile \`AddTo\`: the position \`${impure.toString()}\` ` +
              `has an effect, and the compiled assignment reads and writes ` +
              `the element at that position, so it would evaluate it twice. ` +
              `The interpreter evaluates it once.`
          );
        result = ce._fn('Assign', [
          list,
          ce._fn('ReplaceAt', [
            list,
            ...positions,
            ce._fn('Add', [ce._fn('At', [list, ...positions]), value]),
          ]),
        ]);
      }
    } else if (changed)
      result = ce._fn(h, ops, {
        scope: scopeForRebuild(e.localScope, ce, h, ops),
      });
    memo.set(e, result);
    return result;
  };
  return walk(expr);
}

/**
 * `body`, the body of a user function that the engine defines, with the
 * `parallel for` heads and `+=` lowered when the target is JavaScript
 * (`lowerParallelHeads()`). The JavaScript entry lowers only the expression
 * that it is handed (`prepareCompilation()` in `javascript-target.ts`), and
 * this body comes from the engine definition instead: without the lowering,
 * a `ParallelLoop` or an `AddTo` in it reaches the emitters, which do not
 * compile these heads. The emission of the body (`definitionBodyExpr()` and
 * `substitutedUserFunctionBody()` in `compile-cse.ts`) and the analysis of
 * its inputs (`analyzeReferences()` in `compile-references.ts`) both call
 * this function, so they read the same tree. The other targets keep the
 * heads and decline them.
 */
export function bodyWithParallelHeadsLowered(
  body: Expression,
  target: CompileTarget<Expression>
): Expression {
  return target.language === 'javascript' ? lowerParallelHeads(body) : body;
}

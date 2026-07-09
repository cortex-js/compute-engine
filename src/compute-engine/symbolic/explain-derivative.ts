/**
 * The `expr.explain('D')` driver.
 *
 * `differentiate()` (derivative.ts) records a `DerivativeTrace`: for each
 * rule application, the node being differentiated, the rule id, and the
 * rule's output template with inert `D(child, v)` placeholders for the
 * sub-derivatives. This module replays those records in traversal order
 * over a whole-expression state — starting from `D(f, v)`, each record
 * replaces its placeholder with its template — producing the standard
 * textbook presentation: the full derivative expression, refined step by
 * step as each sub-derivative resolves.
 *
 * This lives in symbolic/ (not boxed-expression/, where the rest of the
 * explain machinery is) because it needs `differentiate()` and the
 * layering rules forbid boxed-expression → symbolic imports. It registers
 * itself with explain.ts via `_setExplainDDriver` when the calculus
 * library loads.
 */
import type {
  Expression,
  ExplainOptions,
  Explanation,
  RuleSteps,
} from '../global-types.js';
import { differentiate, DerivativeTrace } from './derivative.js';
import {
  _setExplainDDriver,
  curateChain,
} from '../boxed-expression/explain.js';
import { isFunction, sym } from '../boxed-expression/type-guards.js';

function explainD(expr: Expression, options?: ExplainOptions): Explanation {
  const ce = expr.engine;
  const canonical = expr.canonical;

  // The variable of differentiation: explicit, or inferred when unambiguous
  let x = options?.variable;
  if (x === undefined) {
    const unknowns = canonical.unknowns.filter((u) => u !== '_');
    if (unknowns.length === 1) x = unknowns[0];
  }
  if (x === undefined) {
    throw new Error(
      'explain("D") requires the variable of differentiation: specify it with options.variable'
    );
  }

  // Mirror the D operator's unwrapping of function literals
  let f = canonical;
  if (isFunction(f, 'Function')) {
    const param = sym(f.ops[1]);
    if (param !== undefined && options?.variable === undefined) x = param;
    f = f.op1;
  }

  // Step 0: the derivative to compute
  const initial = ce._fn('D', [f, ce.symbol(x)]);

  // Record the trace. The result itself comes from evaluating the actual
  // `D` operator below — the exact pipeline a user's `D(f, x)` runs — so
  // the explanation can never disagree with it (the trace is pure
  // observation of the same deterministic `differentiate()`).
  const trace: DerivativeTrace = [];
  differentiate(f, x, 0, trace);

  const result = ce.function('D', [canonical, ce.symbol(x)]).evaluate();

  // Replay: thread each rule's template into the whole-expression state.
  let state: Expression = initial;
  const chain: RuleSteps = [];
  for (const rec of trace) {
    const needle = ce._fn('D', [rec.node, ce.symbol(x)]);
    const next = replaceFirst(state, needle, rec.template);
    if (next === null) continue; // placeholder not present — skip defensively
    state = next;
    chain.push({ value: state, because: rec.id });
  }

  // The states are the unfolded textbook forms; the actual computation
  // folds and simplifies as it goes. Close the chain with the final result.
  if (!state.isSame(result))
    chain.push({ value: result, because: 'derivative.simplify' });

  return {
    operation: 'D',
    initial,
    result,
    steps: curateChain(initial, chain, options?.verbosity ?? 'default'),
  };
}

/** Replace the first (pre-order) subexpression of `e` that is `isSame` as
 * `needle` with `replacement`. Returns `null` when `needle` does not occur. */
function replaceFirst(
  e: Expression,
  needle: Expression,
  replacement: Expression
): Expression | null {
  if (e.isSame(needle)) return replacement;
  if (!isFunction(e)) return null;
  const ops = [...e.ops];
  for (let i = 0; i < ops.length; i++) {
    const r = replaceFirst(ops[i], needle, replacement);
    if (r !== null) {
      ops[i] = r;
      return e.engine.function(e.operator, ops);
    }
  }
  return null;
}

_setExplainDDriver(explainD);

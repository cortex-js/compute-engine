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

  // Resolve `f` (the expression to differentiate) and `vars` (the sequence of
  // variables to differentiate by, applied left-to-right — the same order the
  // `D` operator uses, so `D(f, x, x)` is the second derivative and
  // `D(f, x, y)` a mixed partial).
  let f: Expression;
  let vars: string[];

  if (isFunction(canonical, 'D')) {
    // The receiver already encodes the differentiation sequence: take its
    // differentiand and trailing variable operands. `options.order` is
    // ignored in this form (the receiver supplies the whole sequence).
    f = canonical.op1;
    if (isFunction(f, 'Function')) f = f.op1;
    vars = [];
    for (const op of canonical.ops!.slice(1)) {
      const s = sym(op);
      if (s === undefined)
        throw new Error(
          'explain("D") requires the differentiation variables to be symbols'
        );
      vars.push(s);
    }
    if (vars.length === 0)
      throw new Error(
        'explain("D") requires the variable of differentiation: specify it with options.variable'
      );
  } else {
    // The variable of differentiation: explicit, or inferred when unambiguous
    let x = options?.variable;
    if (x === undefined) {
      const unknowns = canonical.unknowns.filter((u) => u !== '_');
      if (unknowns.length === 1) x = unknowns[0];
    }

    // Mirror the D operator's unwrapping of function literals
    f = canonical;
    if (isFunction(f, 'Function')) {
      const param = sym(f.ops[1]);
      if (param !== undefined && options?.variable === undefined) x = param;
      f = f.op1;
    }

    if (x === undefined) {
      throw new Error(
        'explain("D") requires the variable of differentiation: specify it with options.variable'
      );
    }

    // The order of the derivative: differentiate by `x` this many times.
    const order = options?.order ?? 1;
    if (!Number.isInteger(order) || order < 1)
      throw new Error(
        `explain("D") requires options.order to be a positive integer; got ${options?.order}`
      );
    vars = new Array(order).fill(x);
  }

  // Step 0: the derivative to compute, in the flat `D(f, v_1, …, v_n)` form
  // (matching the canonical shape of a `D(…)` receiver).
  const varSyms = vars.map((v) => ce.symbol(v));
  const initial = ce._fn('D', [f, ...varSyms]);

  // The result comes from evaluating the actual `D` operator on the full
  // sequence — the exact pipeline a user's `D(f, v_1, …, v_n)` runs — so the
  // explanation can never disagree with it (the trace below is pure
  // observation of the same deterministic `differentiate()`).
  const result = ce.function('D', [f, ...varSyms]).evaluate();

  // Differentiate one order at a time. Each stage replays the trace of a
  // single first-order derivative over a whole-expression state (the textbook
  // presentation), displaying that state wrapped in the *remaining*
  // differentiation operators. Between stages we fold to the simplified
  // derivative and continue from it (differentiate the simplified previous
  // order — the standard presentation).
  const chain: RuleSteps = [];
  let current: Expression = f;
  for (let i = 0; i < vars.length; i++) {
    const v = vars[i];
    const remaining = vars.slice(i + 1).map((r) => ce.symbol(r));
    const wrap = (state: Expression): Expression =>
      remaining.length === 0 ? state : ce._fn('D', [state, ...remaining]);

    const trace: DerivativeTrace = [];
    differentiate(current, v, 0, trace);

    // The folded/simplified first-order derivative of `current`.
    const folded = ce.function('D', [current, ce.symbol(v)]).evaluate();

    // Replay: thread each rule's template into the whole-expression state.
    let state: Expression = ce._fn('D', [current, ce.symbol(v)]);
    for (const rec of trace) {
      const needle = ce._fn('D', [rec.node, ce.symbol(v)]);
      const next = replaceFirst(state, needle, rec.template);
      if (next === null) continue; // placeholder not present — skip defensively
      state = next;
      chain.push({ value: wrap(state), because: rec.id });
    }

    // The states are the unfolded textbook forms; the actual computation folds
    // and simplifies as it goes. Close this stage with the folded derivative.
    if (!state.isSame(folded))
      chain.push({ value: wrap(folded), because: 'derivative.simplify' });

    current = folded;
  }

  // Close the chain with the final result (the real operator on the full
  // sequence may present it slightly differently than the stage-by-stage fold).
  if (!current.isSame(result))
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

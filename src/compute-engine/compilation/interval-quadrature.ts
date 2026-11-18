/**
 * The subdivision count of an interval enclosure of an integral, read by the
 * interval mode of the IR pipeline (`ir/lower.ts`).
 *
 * @module compilation/interval-quadrature
 */

import type { Expression } from '../global-types.js';
import { isFunction } from '../boxed-expression/type-guards.js';
import {
  INTERVAL_QUADRATURE_BUDGET,
  INTERVAL_QUADRATURE_SUBDIVISIONS,
} from '../interval/integrate.js';
import {
  closedFormIntegral,
  withCompilationBudgets,
} from './closed-form-integral.js';

/**
 * How much integration work a subtree can demand at run time, measured from
 * the tree: `paths` is the number of `Integrate` RUNS reachable per
 * evaluation of the subtree (an operand referenced twice runs twice, so
 * children's counts are SUMMED — path counting, which a per-distinct-node
 * memo computes in linear time), and `depth` is the deepest multiplicative
 * chain — integration levels (one per limit) accumulated through integrals
 * nested inside other integrals' integrands or bounds.
 *
 * `intervalQuadratureSize()` sizes every level's subdivision count from the
 * pair: an inner integral runs once per enclosing piece, so with a uniform
 * count n the subtree's total integrand evaluations are bounded by
 * ~paths·n^depth.
 *
 * The memo is sound unconditionally: both numbers are functions of the
 * expression tree alone (operator names and arity — no bindings, no
 * definitions), and boxed expressions are immutable. `paths` saturates at
 * a million — beyond that every sizing decision is already "decline", and
 * an unsaturated sum over a deeply shared tree would overflow.
 *
 * Composition through a FUNCTION CALL (`∫ g(x) dx` where `g`'s body
 * computes an integral) is invisible here — no `Integrate` node is in the
 * tree. That class is bounded at run time instead, by
 * `INTERVAL_NESTED_QUADRATURE_BUDGET` (`interval/integrate.ts`).
 */
type IntegrateStats = { paths: number; depth: number };

// One memo per value of `numeric`.
const INTEGRATE_STATS = [
  new WeakMap<Expression, IntegrateStats>(),
  new WeakMap<Expression, IntegrateStats>(),
];

const INTEGRATE_PATHS_SATURATION = 1_000_000;

/** `numeric`: an `NIntegrate` node counts as one level too. The interval
 *  mode of the IR pipeline compiles it as an enclosure. */
function integrateStats(expr: Expression, numeric: boolean): IntegrateStats {
  const memo = INTEGRATE_STATS[numeric ? 1 : 0];
  const cached = memo.get(expr);
  if (cached !== undefined) return cached;
  let paths = 0;
  let depth = 0;
  if (isFunction(expr)) {
    for (const op of expr.ops) {
      const s = integrateStats(op, numeric);
      paths = Math.min(INTEGRATE_PATHS_SATURATION, paths + s.paths);
      depth = Math.max(depth, s.depth);
    }
    if (
      expr.operator === 'Integrate' ||
      (numeric && expr.operator === 'NIntegrate')
    ) {
      // One integration level per limit clause (one for `NIntegrate(f, a,
      // b)`); a bare `Integrate(f)` (no clause) is indefinite and never
      // reaches the enclosure emitter, but count it as one level so the
      // estimate stays conservative.
      const levels =
        expr.operator === 'NIntegrate' ? 1 : Math.max(1, expr.nops - 1);
      paths = Math.min(INTEGRATE_PATHS_SATURATION, paths + 1);
      depth += levels;
    }
  }
  const stats = { paths, depth };
  memo.set(expr, stats);
  return stats;
}

/**
 * The subdivision count `n` of the OUTERMOST integral of a nest, whose
 * operands are `args` and which has `levels` limits, from the total budget
 * (see `INTERVAL_QUADRATURE_BUDGET`): the inner enclosure of a nested
 * integral runs once per outer piece, so the counts multiply across levels
 * — through this node's own limits AND through every `Integrate` node
 * visible in its subtree (a distinct node inside the integrand or a bound
 * runs once per enclosing piece just the same). The outermost integral
 * measures the whole subtree and picks one uniform count n with
 * paths·n^depth within the budget; every integral that it holds takes that
 * n rather than re-measuring its own smaller subtree, which would pick a
 * larger count and break the product bound. Everything here is a function
 * of the expression tree alone: no clock, same answer on every run.
 * `numeric`: `NIntegrate` nodes count too (`integrateStats()`).
 */
export function intervalQuadratureSize(
  args: ReadonlyArray<Expression>,
  levels: number,
  numeric = false
): { n: number; paths: number; depth: number } {
  let paths = 1;
  let depth = levels;
  for (const arg of args) {
    const s = integrateStats(arg, numeric);
    paths = Math.min(INTEGRATE_PATHS_SATURATION, paths + s.paths);
    depth = Math.max(depth, levels + s.depth);
  }
  const n = Math.min(
    INTERVAL_QUADRATURE_SUBDIVISIONS,
    Math.floor((INTERVAL_QUADRATURE_BUDGET / paths) ** (1 / depth))
  );
  return { n, paths, depth };
}

/**
 * The reason that an integral of the size `size` is not compiled, or
 * `undefined`. The floor is a DECLINE, not a clamp: below 4 pieces per
 * level the "enclosure" is as uninformative as `entire` while still costing
 * the whole budget, so an integral whose subtree is too deep or too branchy
 * to size honestly fails closed instead (the caller falls back — in a
 * two-lane consumer, to its scalar estimate).
 */
export function intervalQuadratureRefusal(size: {
  n: number;
  paths: number;
  depth: number;
}): string | undefined {
  if (size.n >= 4) return undefined;
  return (
    `an honest interval enclosure — this ` +
    `integral's subtree reaches ${size.paths} integral runs nested ` +
    `${size.depth} levels deep, and the evaluation budget ` +
    `(${INTERVAL_QUADRATURE_BUDGET} integrand evaluations) admits ` +
    `fewer than 4 subdivisions per level at that size, which is as ` +
    `uninformative as no bound at all. Evaluate ` +
    `numerically on the scalar target, or reduce the nesting.`
  );
}

const NUMERIC_INTEGRALS: ReadonlySet<string> = new Set(['NIntegrate']);

/**
 * The closed form of the integral of the operands `args`, for the IR
 * pipeline (the interval mode and JavaScript)
 * (`closedFormIntegral()`: the engine's antiderivative under the budgets of
 * the compilation, and no fold of a `vars` name that holds an engine value
 * or whose text is not a plain read). `vars`: the `vars` texts of the
 * compilation. With an angular unit other than
 * radians there is none: `closedFormIntegral()` reads operands written in
 * radians, and the
 * lowering scales the trigonometric functions of the closed form again.
 * There is none either when the operands reach an `NIntegrate`, directly
 * or through a definition.
 */
export function integralClosedForm(
  args: ReadonlyArray<Expression>,
  vars: Readonly<Record<string, string>>
): Expression | undefined {
  if (args[0].engine.angularUnit !== 'rad') return undefined;
  const names = Object.keys(vars);
  return closedFormIntegral(args, {
    varsKeys: names.length > 0 ? new Set(names) : undefined,
    var: (name) => vars[name],
    // The engine evaluates an `NIntegrate` to a number by quadrature, which
    // the closed form would hold as an exact constant: no closed form when
    // the operands reach one, also through the value of a symbol or the
    // body of a user function (`reachesExcludedName()`).
    foldExcludedOps: NUMERIC_INTEGRALS,
  });
}

/** A compilation of the IR pipeline, with the antiderivative budget of the
 *  outermost compilation in progress (`withCompilationBudgets()`). */
export const withIntegralClosedFormBudgets = withCompilationBudgets;

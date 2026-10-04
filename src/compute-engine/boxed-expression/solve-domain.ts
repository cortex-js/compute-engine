import type { Type } from '../../common/type/types.js';
import {
  collectionElementType,
  isBooleanOrBroadcastableBooleanType,
} from '../../common/type/utils.js';
import { checkDeadline } from '../../common/interruptible.js';
import {
  implicitCompile,
  implicitCompileNumeric,
} from '../implicit-compile.js';

import type {
  IComputeEngine as ComputeEngine,
  Expression,
} from '../global-types.js';
import { isFunction, sym } from './type-guards.js';
import {
  defaultUnknown,
  reduceTransformerHead,
  resolveBoundSymbols,
  reduceStructuralIndex,
  withValueShield,
} from './utils.js';
import { findUnivariateRoots } from './solve.js';
import { getPolynomialCoefficients, polynomialDegree } from './polynomials.js';
import { expand } from './expand.js';
import { interval } from '../numerics/interval.js';
import {
  tryDiophantineSolve,
  isIntegerDomain,
  freshParameters,
} from './diophantine.js';
import { contextAssumptions, isFactTrue } from './constraint-subject.js';
import { containsResidueClass } from './residue-class.js';
import { shadowsLibraryName } from '../library-shadowing.js';
import { halfTurnAngle } from './trigonometry.js';

/**
 * Inequality relational operators. A univariate `Solve` of one of these is
 * unsupported and stays inert rather than returning an empty (misleading)
 * root list. Mirrors the local list in `solve-system.ts`.
 */
const INEQUALITY_OPERATORS = ['Less', 'LessEqual', 'Greater', 'GreaterEqual'];

/**
 * Relational operators that mark a `Solve` constraint-set item as a *side
 * condition* (a filter on the solution set) rather than an equation to solve.
 * A boolean-typed non-`Equal` expression is treated the same way.
 */
const SIDE_CONDITION_OPERATORS = new Set([
  'Less',
  'LessEqual',
  'Greater',
  'GreaterEqual',
  'NotEqual',
]);

/**
 * Whether `item` is a side-condition predicate: a relational operator above, or
 * any boolean-typed expression that is not an `Equal` (an `Equal` defines the
 * equation to solve, never a filter). A `broadcastable<boolean>` expression
 * (a connective over a comparison whose operand may be a collection) is a
 * predicate too (`isBooleanOrBroadcastableBooleanType`).
 */
function isSideConditionPredicate(item: Expression): boolean {
  const op = item.operator;
  if (op && SIDE_CONDITION_OPERATORS.has(op)) return true;
  if (op === 'Equal') return false;
  return isBooleanOrBroadcastableBooleanType(item.type.type);
}

/**
 * Whether `item` of a `Solve` equation list is a plain expression that is
 * read as `item = 0`: an expression of type `number` that is not an `Equal`.
 * The single-equation case uses the same test on its equation. A relation or
 * a predicate has type `boolean`, so it is not a plain expression.
 */
function isPlainEquationExpression(item: Expression): boolean {
  return item.operator !== 'Equal' && item.type.matches('number');
}

/**
 * In a `List`, `Set` or `Tuple` of equations, read each plain expression `e`
 * (see `isPlainEquationExpression`) as the equation `e = 0`, as `Solve` does
 * when the expression is the only equation. The system solver accepts only
 * `Equal` items, and an `And` of the items accepts only boolean items. Thus
 * `Solve([x + y - 1, x - y], [x, y])` and `Solve([x + y = 1, x - y = 0],
 * [x, y])` have the same solution. A relation or another boolean item (an
 * inequality, a congruence, an `Element` domain constraint) is not a number
 * and is kept as written. Another expression is returned unchanged.
 */
function plainItemsAsEquations(ce: ComputeEngine, eq: Expression): Expression {
  if (
    !isFunction(eq, 'List') &&
    !isFunction(eq, 'Set') &&
    !isFunction(eq, 'Tuple')
  )
    return eq;
  const items = eq.ops;
  if (!items.some((item) => isPlainEquationExpression(item))) return eq;
  return ce.function(
    eq.operator,
    items.map((item) =>
      isPlainEquationExpression(item)
        ? ce.function('Equal', [item, ce.Zero])
        : item
    )
  );
}

/**
 * Evaluate the shared (multi-unknown) side-condition predicates at a concrete
 * substitution. Returns `false` only when some predicate reduces to a definite
 * `False` (the conservative Kleene posture: `True` and undecidable keep the
 * candidate).
 */
function passesSideConditions(
  sideConditions: ReadonlyArray<Expression>,
  subs: Record<string, Expression>
): boolean {
  for (const cond of sideConditions) {
    const v = cond.subs(subs).evaluate();
    if (sym(v) === 'False') return false;
  }
  return true;
}

/**
 * Keep a candidate tuple `values` (aligned with `specs`) unless a per-spec
 * `condition` or a shared side condition reduces to a definite `False`. Same
 * conservative posture as `passesSideConditions`.
 */
function keepUnderConditions(
  specs: ReadonlyArray<SolveSpec>,
  sideConditions: ReadonlyArray<Expression>,
  values: ReadonlyArray<Expression>
): boolean {
  const subs: Record<string, Expression> = {};
  for (let i = 0; i < specs.length; i++) subs[specs[i].unknown] = values[i];
  for (let i = 0; i < specs.length; i++) {
    const c = specs[i].condition;
    if (c && conditionValue(c, specs[i].unknown, values[i]) === false)
      return false;
  }
  return passesSideConditions(sideConditions, subs);
}

/**
 * Solving over a domain (Phase 1, univariate).
 *
 * `Solve(equation, Element(unknown, domain[, condition]))` restricts the
 * unknown to a collection (typically an integer `Range`). See
 * `ARCHITECTURE.md`.
 *
 * Strategy: symbolic solve first (for equations), then filter the roots to the
 * domain. When the symbolic solver comes up empty and the domain is finite and
 * affordable, enumerate — with a compiled predicate when possible, under the
 * engine deadline, and with an exact confirmation stage so a float sieve never
 * lies for large integers.
 */

// Enumeration budgets. A compiled (float) predicate is cheap enough to sweep a
// large range; the interpreted (substitute-and-evaluate) path is capped at the
// same limit as the numeric solver's iteration ceiling (`MAX_ITERATION`).
const MAX_SOLVE_ENUMERATION_COMPILED = 1_000_000;
const MAX_SOLVE_ENUMERATION_INTERPRETED = 10_000;

// Root-family expansion budget (Phase 2.2). When the domain span divided by the
// equation's period exceeds this, the family is too large to materialize (e.g.
// `sin(x) = 0` over `[0, 10^9]`). The principal roots alone are only a part of
// the roots in the domain, and a partial list is not an answer: the expansion
// gives no roots, and the `Solve` stays unevaluated (or a finite integer
// domain is enumerated).
const MAX_PERIODIC_EXPANSION = 1000;

// The numeric check that a periodic root list is complete samples the
// equation this many times over the shortest period of its trig terms.
const PERIODIC_SCAN_SAMPLES_PER_PERIOD = 256;

// The largest `n` tried when the solver looks for a root spacing `T/n` that is
// shorter than the period `T` of the equation (see `rootSetDivisor()`).
const MAX_ROOT_SET_DIVISOR = 12;

/** A validated `Solve` unknown specification. */
export interface SolveSpec {
  /** The unknown's symbol name. */
  unknown: string;
  /** The domain collection (canonical), if this spec is an `Element` form. */
  domain?: Expression;
  /** An optional boolean condition in `unknown` (3rd `Element` operand). */
  condition?: Expression;
}

/**
 * Canonicalize the operands of a `Solve` expression.
 *
 * The equation (`ops[0]`) is held lazily — it must NOT be canonicalized, or an
 * `Equal` collapses to a boolean before solving. Each remaining operand is a
 * *spec*: a bare symbol (today's behavior) or `Element(symbol, collection[,
 * condition])`. A spec that is neither becomes an `Error` operand.
 */
export function canonicalSolve(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>
): Expression {
  if (ops.length === 1) {
    // The unknown may be omitted (`Solve(eq)`, e.g. from `expr |> Solve`).
    // Default to the equation's single free variable, or to `x` when there
    // are several free variables and one of them is `x`.
    const unknown = defaultUnknown(ops[0]);
    if (unknown !== undefined)
      return ce._fn('Solve', [ops[0], ce.symbol(unknown)]);

    // A pipe topic placeholder means this is a deferred pipeline stage
    // (`\rhd Solve` → `Function(Solve(_), _)`): keep the arity-1 form so
    // inference re-runs at evaluation, once the topic value is bound.
    // Padding with a `missing` error here would make the stage invalid
    // before it is ever applied. Checked with `has` (not `unknowns`): when
    // the stage is applied, `_` is *bound* in the call scope (so it is no
    // longer an unknown) but the operand is still the `_` symbol.
    if (ops[0].has('_')) return ce._fn('Solve', [ops[0]]);

    // A collection/`And` first argument bundling `Element(symbol, collection)`
    // domain constraints (`Solve(\{eq, a ∈ 1..9, b ∈ 0..9\})`) carries its own
    // unknowns — the constrained symbols. `defaultUnknown` cannot pick one out
    // of several, so keep the arity-1 form here and let `evaluateSolve` lift
    // the `Element`s into specs, rather than padding with a `missing` error
    // (which would make the whole call inert).
    if (
      (isFunction(ops[0], 'Set') ||
        isFunction(ops[0], 'List') ||
        isFunction(ops[0], 'Tuple') ||
        isFunction(ops[0], 'And')) &&
      (ops[0].ops ?? []).some((op) => isFunction(op, 'Element'))
    )
      return ce._fn('Solve', [ops[0]]);
  }

  if (ops.length < 2) {
    // Reuse the standard arity padding (produces `missing` error operands).
    const padded = [...ops];
    while (padded.length < 2) padded.push(ce.error('missing'));
    return ce._fn('Solve', padded);
  }

  const eq = ops[0]; // keep lazy — do not canonicalize
  // A `List`/`Tuple`/`Set` spec operand (`Solve(eqs, [x, y])`,
  // `Solve(eq, \{a, b, c\})`) is a variable list: splat its elements into
  // individual specs. The splat is on the raw (non-canonical) operand, so the
  // written order — which defines the result-tuple order — is preserved.
  const specOps = ops
    .slice(1)
    .flatMap((spec) =>
      isFunction(spec, 'List') ||
      isFunction(spec, 'Tuple') ||
      isFunction(spec, 'Set')
        ? [...spec.ops]
        : [spec]
    );

  // Mathematica-style trailing bare domain-set spec (`Solve(eq, x, ℤ)`): the
  // LAST spec is not an unknown but a set naming the domain for ALL the
  // unknowns. Detect a bare symbol whose canonical form is a collection
  // (`Integers`, `Reals`, …), with at least one other spec preceding it, then
  // strip it and wrap every BARE-SYMBOL spec `s` as `Element(s, domain)`. A
  // spec that already carries an explicit `Element` domain keeps it (the
  // explicit domain wins — no intersection).
  if (specOps.length >= 2) {
    const last = specOps[specOps.length - 1];
    if (sym(last) !== undefined) {
      const domain = last.canonical;
      if (domain.isCollection) {
        const specs = specOps.slice(0, -1).map((spec) => {
          const s = sym(spec);
          const wrapped =
            s !== undefined
              ? ce.function('Element', [ce.symbol(s), domain])
              : spec;
          return canonicalSolveSpec(ce, wrapped);
        });
        return ce._fn('Solve', [eq, ...specs]);
      }
    }
  }

  const specs = specOps.map((spec) => canonicalSolveSpec(ce, spec));
  return ce._fn('Solve', [eq, ...specs]);
}

/** Validate/canonicalize a single `Solve` spec operand. */
function canonicalSolveSpec(ce: ComputeEngine, spec: Expression): Expression {
  // A bare symbol: exactly today's behavior.
  if (sym(spec) !== undefined) return spec;

  // `Element(symbol, collection[, condition])`.
  if (isFunction(spec, 'Element')) {
    const c = spec.canonical;
    if (isFunction(c, 'Element') && sym(c.op1) !== undefined) return c;
  }

  return ce.error(
    ['incompatible-type', `'symbol'`, spec.type.toString()],
    spec.toString()
  );
}

/**
 * Whether the values of the unknown `x` are restricted: by an assumption
 * about `x` alone (`assume(x > 0)`), or by a declared type narrower than
 * `number` (`x: integer`), the same types that `filterRootsByType()` in
 * `solve.ts` checks.
 */
function isRestrictedUnknown(ce: ComputeEngine, x: string): boolean {
  const type = ce.symbol(x).type.type;
  if (typeof type !== 'string' || (type !== 'number' && type !== 'unknown'))
    return true;
  for (const [fact, records] of contextAssumptions(ce).entries()) {
    if (!isFactTrue(records)) continue;
    if (fact.unknowns.includes(x)) return true;
  }
  return false;
}

/**
 * The answer of `Solve(equation, x)` when the root finder returned no root.
 *
 * - When the equation does not depend on `x` once it is expanded, it is an
 *   identity (`x = x`, `2(x + 1) = 2x + 2`, `0 = 0`) or a contradiction
 *   (`x + 1 = x + 2`, `1 = 0`). An identity is true for every value of `x`:
 *   the answer is a list with one fresh free parameter, `[t]`, the same form
 *   as the parametric answers of the congruence and diophantine solvers. A
 *   contradiction has no solution: `[]`. When the remaining constant has
 *   other unknowns (`a = 0`), the answer depends on them, and `Solve` stays
 *   unevaluated.
 * - When the root finder produced candidate roots and rejected all of them
 *   by a decided check, the empty list is a decision: `[]` (`√x = -1`),
 *   except when a candidate came from a root template that the host added
 *   (`stats.userRule`). When
 *   a rejection was not decided (the residual of the root of
 *   `√(x + a) = -x` cannot be proved zero for a free `a`), `Solve` stays
 *   unevaluated.
 * - When no strategy of the root finder applied, the empty list is not a
 *   proof: the equation can have roots that the solver cannot find
 *   (`a·x⁵ + x + 1 = 0`, `sin(x) = x³ + eˣ`). `Solve` stays unevaluated.
 *
 * The identity test is limited to equations whose two sides are both
 * polynomial in `x`: there `expand()` only distributes and collects terms,
 * so a residual free of `x` is free of `x` for every value of `x`. The sides
 * are tested, not their difference, because the difference already cancels
 * equal terms: `1/x = 1/x` has the residual `0`, but it is not defined at
 * `x = 0`. Such an equation, and a cancellation such as
 * `(x² − 1)/(x − 1) = x + 1` (not defined at `x = 1`), stay unevaluated.
 *
 * The single free parameter of an identity cannot express a restriction of
 * the unknown, so `Solve` also stays unevaluated when one applies: a side
 * condition (`conditioned`), an assumption about the unknown
 * (`assume(x > 0)`), or a declared type narrower than `number`
 * (`x: integer`).
 *
 * `expr.solve()`, `expr.explain('solve')` and the alternatives of an `Or`
 * (`solveOr()`) use the same answer: `undefined` there gives `null` (or an
 * explanation with no answer), not an empty list.
 */
export function emptyRootsAnswer(
  ce: ComputeEngine,
  equation: Expression,
  x: string,
  stats: { candidates: boolean; undecided: boolean; userRule?: boolean },
  conditioned: boolean
): Expression | undefined {
  const sides = isFunction(equation, 'Equal')
    ? [equation.op1, equation.op2]
    : [equation];
  if (sides.every((side) => polynomialDegree(side, x) >= 0)) {
    const residual = sides.length === 2 ? sides[0].sub(sides[1]) : sides[0];
    const constant = expand(residual);
    if (!constant.has(x)) {
      if (constant.isSame(0)) {
        if (conditioned || isRestrictedUnknown(ce, x)) return undefined;
        return ce.function('List', freshParameters(ce, equation, 1));
      }
      if (constant.isEqual(0) === false) return ce.function('List', []);
      return undefined;
    }
  }
  // A candidate of a root template that the host added to `ce.solveRules`
  // (`stats.userRule`) that the check rejected does not show that there is
  // no root: the template can be wrong.
  if (stats.candidates && !stats.undecided && !stats.userRule)
    return ce.function('List', []);
  return undefined;
}

/**
 * The roots that several equations in the one unknown `x` have in common.
 *
 * The candidates are the roots of one equation of the list (the source). A
 * candidate is kept when every other equation, with `x` replaced by the
 * candidate, evaluates to `True`, and it is rejected when one of them
 * evaluates to `False`.
 *
 * A polynomial equation is tried first, because the root finder gives all of
 * its roots. Its kept roots are a decision: the answer `[]` states that there
 * is no common root.
 *
 * For another equation, the root finder can give only the principal roots
 * (`sin(x) = 0` gives `[0, π]`), and a common root can be outside that list:
 * `[sin(2x) = 0, cos(x) = -1]` has the root `π`, which is not a principal
 * root of `sin(2x) = 0`. Thus each equation that is not a polynomial is a
 * source, and the answer is the union of their kept roots. The answer then
 * does not depend on the order of the equations. When this union is empty,
 * the answer is `'undecided'`, because a common root can be outside all the
 * principal root lists. The answer is also `'undecided'` when each source
 * that gives candidates gives only a part of its roots: the unknown is in a
 * function that the root finder cannot invert and that is not periodic, or
 * a factor of a product gave no root (`solveByZeroProduct()`).
 *
 * An equation whose root list is empty, or has a symbol that is not in the
 * equations (the parameter of a root family), gives no candidates.
 *
 * Returns `undefined` when no equation gives candidates; the caller then
 * uses the system solver. Returns `'undecided'` when an equation evaluates
 * to neither `True` nor `False` for a candidate: the caller stays inert,
 * because a list without that candidate could be wrong.
 */
function commonRoots(
  ce: ComputeEngine,
  equations: ReadonlyArray<Expression>,
  x: string
): Expression[] | 'undecided' | undefined {
  const symbols = new Set(equations.flatMap((eq) => eq.unknowns));
  const isPolynomial = (eq: Expression) =>
    isFunction(eq, 'Equal') &&
    polynomialDegree(eq.op1, x) >= 0 &&
    polynomialDegree(eq.op2, x) >= 0;
  // The sources whose candidates are only a part of their roots (see
  // `complete` below).
  const partialSources = new Set<Expression>();
  // The kept roots of `source`, `undefined` when it gives no candidates, or
  // `'undecided'`.
  const keptRoots = (
    source: Expression
  ): Expression[] | 'undecided' | undefined => {
    const stats = { candidates: false, undecided: false };
    const found = findUnivariateRoots(source, x, 0, undefined, stats);
    const candidates = filterRootsByAssumptions(ce, found, x);
    if (partialRootListReason(source, x, found, stats) !== undefined)
      partialSources.add(source);
    if (
      candidates.length === 0 ||
      !candidates.every((root) =>
        root.unknowns.every((u) => u !== x && symbols.has(u))
      )
    )
      return undefined;

    const others = equations.filter((eq) => eq !== source);
    const kept: Expression[] = [];
    for (const root of candidates) {
      let keep = true;
      for (const eq of others) {
        const value = sym(eq.subs({ [x]: root }).evaluate());
        if (value === 'False') {
          keep = false;
          break;
        }
        if (value !== 'True') return 'undecided';
      }
      if (keep) kept.push(root);
    }
    return kept;
  };

  for (const source of equations.filter((eq) => isPolynomial(eq))) {
    const kept = keptRoots(source);
    if (kept !== undefined) return kept;
  }

  // A common root is a root of each equation, thus the candidates of one
  // source that gives all its roots (its principal roots, for a periodic
  // equation) hold all the common roots. A source whose candidates are only
  // a part of its roots (`partialSources`) cannot show that: when no other
  // source gives all its roots, the answer is `'undecided'`.
  let hasCandidates = false;
  let complete = false;
  const union: Expression[] = [];
  for (const source of equations.filter((eq) => !isPolynomial(eq))) {
    const kept = keptRoots(source);
    if (kept === undefined) continue;
    if (kept === 'undecided') return 'undecided';
    hasCandidates = true;
    if (!partialSources.has(source)) complete = true;
    for (const root of kept)
      if (!union.some((r) => r.isSame(root))) union.push(root);
  }
  if (!hasCandidates) return undefined;
  if (!complete) return 'undecided';
  return union.length > 0 ? union : 'undecided';
}

/**
 * Evaluate a (canonical) `Solve` expression.
 *
 * Routing:
 * - no domain specs → existing symbolic path (`.solve()`), unchanged;
 * - some (but not all) specs carry a domain → inert (a free unknown has no
 *   univariate/enumeration path);
 * - exactly one domain spec → the univariate domain pipeline below;
 * - several domain specs → the multi-variable enumeration pipeline (Phase 2).
 */
export function evaluateSolve(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>
): Expression | undefined {
  const eq = ops[0];
  if (eq === undefined) return undefined;
  // An equation that holds a residue class is not solved: the solver works
  // in the numbers, and its check of a root reads the zero class
  // `ResidueClass(0, n)` as not 0, so it would report no solution.
  if (containsResidueClass(eq.canonical)) return undefined;

  // The held equation is non-canonical (`Solve` is lazy). Canonicalize it: an
  // `Equal`/predicate that still contains the free unknown stays symbolic (it
  // is *evaluation*, not canonicalization, that would collapse it), and the
  // downstream solver requires a canonical input.
  //
  // A transformer head (`Solve(Simplify(eq), x)`, e.g. from the pipeline
  // `eq |> Simplify |> Solve`) is then reduced so the solver sees the
  // transformed expression — the solver finds no roots in an expression
  // whose operator is `Simplify`. Full evaluation would be unsound here
  // (relational collapse, unknown-value substitution) — see
  // `reduceTransformerHead`.
  let specs = parseSolveSpecs(ops.slice(1));
  if (specs === undefined) return undefined; // invalid spec → stay inert

  // Reduce transformer heads (`Solve(Simplify(eq), x)`) before solving. A
  // nested transformer resolves the value-bound symbols in its operand, which
  // would substitute an unknown that also carries a global value (`x := 5`),
  // turning `Solve(Simplify(x - 2) = 0, x)` into `Solve(1 = 0, x)` → `[]`.
  // Protect each value-bound unknown by shadow-declaring it VALUELESS in a
  // temporary scope for the duration of the reduction: with no value in scope,
  // the nested transformer resolves the OTHER bound symbols but keeps the
  // unknown symbolic (`Simplify` no longer folds it, and neither does its
  // `resolveBoundSymbols`). This protects at the SOURCE — the binding — so it
  // also covers the doubly-contradictory case where the unknown both carries a
  // value AND is reintroduced by another bound symbol's value (`s := (9-w²)/4`,
  // `w := 9`): resolving `s` re-introduces `w`, which is still valueless here.
  let ceq = reduceWithUnknownsShielded(ce, eq, specs);

  // The canonical form of the held operand can contain an error, for example
  // a `Map` whose operands have the wrong types. Such an operand is not an
  // equation, and the solver finds no root in it: an empty root list would
  // state that there is no solution. Return the operand with its error.
  if (!ceq.isValid) return ce._fn('Solve', [ceq, ...ops.slice(1)]);

  // The first operand can be a collection only when it is written as a
  // `List`, `Set` or `Tuple` of equations, or as an `And` of equations. A
  // collection of other form is not an equation: a `Range`, a `Linspace`, a
  // `Map`, an `Interval` or a symbol that holds a list. The solver finds no
  // root in such a collection, and an empty root list would state that there
  // is no solution. Report an `incompatible-type` error on the operand. A
  // string is also a collection, but it is a literal value and not a
  // computed collection: `Solve` of a string stays unevaluated.
  if (
    !isFunction(ceq, 'List') &&
    !isFunction(ceq, 'Set') &&
    !isFunction(ceq, 'Tuple') &&
    !isFunction(ceq, 'And') &&
    ceq.isCollection &&
    !ceq.type.matches('string')
  )
    return ce._fn('Solve', [
      ce.typeError(
        { kind: 'union', types: ['boolean', 'number'] },
        ceq.type,
        ceq
      ),
      ...ops.slice(1),
    ]);

  // Shared (multi-unknown) side-condition predicates lifted out of a constraint
  // set (e.g. `a < b` in `Solve(\{a+b=5, a<b\}, \{a,b\})`). Single-unknown side
  // conditions merge into their spec's `condition` slot instead; these are the
  // ones that constrain several unknowns at once and so filter whole tuples.
  const sideConditions: Expression[] = [];

  // A collection-shaped (or `And`) first argument may bundle the equations/
  // predicates together with `Element(symbol, collection)` domain constraints
  // (e.g. `Solve(\{eq, a ∈ 1..9, b ∈ 0..9\}, \{a, b\})`). Lift the `Element`
  // items out onto the arg-position specs (spec order defines the result-tuple
  // order), and keep the remaining items as the equation/system to solve.
  //
  // This runs before the arity-1 `_`-inference below so the lifted domains can
  // supply the specs when there is no variable list — `defaultUnknown` cannot
  // pick a single unknown out of a multi-unknown constraint set. A bare `_`
  // pipeline placeholder is a plain symbol (never a collection head), so this
  // guard never intercepts it and the `_` handling stays intact.
  //
  // Each plain expression item is first changed to an equation, because the
  // items can be rebuilt below as an `And`, which accepts only boolean items.
  ceq = plainItemsAsEquations(ce, ceq);
  if (
    isFunction(ceq, 'Set') ||
    isFunction(ceq, 'List') ||
    isFunction(ceq, 'Tuple') ||
    isFunction(ceq, 'And')
  ) {
    // A `List` is rewritten only when it bundles domain constraints or, for a
    // single unknown, holds a single item or a side-condition predicate; an
    // ordinary `List` equation system (and `[x + y = 5]` in two unknowns,
    // whose answer is a parametric tuple) must reach the existing
    // `.solve(names)` path unchanged.
    // A list of one equation is that equation (`Solve([x^2 = 4], x)` is
    // `[-2, 2]`), and `[x^2 = 4, x > 0]` filters the roots as the `Set` and
    // `And` spellings do: the system solver found no root for either and
    // answered `[]`.
    const wasList = isFunction(ceq, 'List');
    const hadArgSpecs = specs.length > 0;

    const lifted: SolveSpec[] = [];
    const remaining: Expression[] = [];
    for (const item of ceq.ops ?? []) {
      // An `Element(symbol, collection[, condition])` item is a lifted domain
      // constraint. Validate it with the same posture as `parseSolveSpecs`:
      // op1 a symbol, op2 a collection, an optional non-`Nothing` 3rd operand
      // a per-candidate condition.
      if (isFunction(item, 'Element')) {
        const u = sym(item.op1);
        const domain = item.op2;
        if (u !== undefined && domain !== undefined && domain.isCollection) {
          const condition =
            item.nops >= 3 && sym(item.op3) !== 'Nothing'
              ? item.op3
              : undefined;
          lifted.push({ unknown: u, domain, condition });
          continue;
        }
      }
      remaining.push(item);
    }

    // A `List` with a domain spec in argument position is rewritten too: the
    // domain solvers accept one equation or predicate, not a `List`, so its
    // equations become an `And` that is tested for each candidate.
    if (
      lifted.length > 0 ||
      !wasList ||
      specs.some((s) => s.domain !== undefined) ||
      (specs.length === 1 &&
        (remaining.length === 1 ||
          remaining.some((item) => isSideConditionPredicate(item))))
    ) {
      if (lifted.length > 0) {
        if (!hadArgSpecs) {
          // No variable list: the lifted `Element`s ARE the specs, in
          // first-argument order.
          specs = lifted;
        } else {
          // Merge each lifted domain into its arg-position spec by unknown
          // name, preserving arg-position order.
          for (const lift of lifted) {
            const target = specs.find((s) => s.unknown === lift.unknown);
            // A lifted domain for an unknown NOT in the explicit variable list
            // would silently change the result-tuple arity → stay inert.
            if (target === undefined) return undefined;
            if (target.domain === undefined) {
              target.domain = lift.domain;
              if (lift.condition !== undefined)
                target.condition = lift.condition;
            } else {
              // The spec already fixes a domain for this unknown: rather than
              // replace it, And-merge the lifted membership (and its optional
              // condition) into the spec's `condition` slot. `conditionValue`
              // evaluates the condition per candidate, so both the arg-position
              // domain and the lifted membership must hold (their intersection).
              const parts: Expression[] = [
                ce.function('Element', [ce.symbol(lift.unknown), lift.domain!]),
              ];
              if (lift.condition !== undefined) parts.push(lift.condition);
              const liftConstraint =
                parts.length === 1 ? parts[0] : ce.function('And', parts);
              target.condition =
                target.condition !== undefined
                  ? ce.function('And', [target.condition, liftConstraint])
                  : liftConstraint;
            }
          }
        }
      }

      // Partition the remaining items into equations and side-condition
      // predicates (inequalities/disequalities/boolean predicates that are not
      // `Equal`). A side condition whose free variables are all spec unknowns
      // restricts the solution set rather than defining it: a single-unknown
      // predicate And-merges into that spec's `condition`; a multi-unknown one
      // (e.g. `a < b`) joins the shared post-filter applied to candidate
      // tuples. A predicate mentioning a non-spec symbol stays an equation
      // (there is nothing to filter it against) — the solver then decides it.
      //
      // Classify first WITHOUT merging: when no equation remains, the
      // predicates are not filters of anything — they ARE what is being solved
      // (`Solve(\{x ≡ 2 mod 5, x ∈ 1..20\}, x)`), so they all stay in the
      // equation slot and `classifyPredicate` routes them to the
      // predicate-enumeration path.
      const specNames = new Set(specs.map((s) => s.unknown));
      let equations: Expression[] = [];
      const sideCandidates: Expression[] = [];
      for (const item of remaining) {
        if (
          isSideConditionPredicate(item) &&
          item.unknowns.every((u) => specNames.has(u))
        )
          sideCandidates.push(item);
        else equations.push(item);
      }

      if (equations.length === 0) {
        equations = [...remaining];
      } else {
        for (const item of sideCandidates) {
          const free = item.unknowns;
          if (free.length === 1) {
            const target = specs.find((s) => s.unknown === free[0]);
            if (target !== undefined) {
              target.condition =
                target.condition !== undefined
                  ? ce.function('And', [target.condition, item])
                  : item;
              continue;
            }
          }
          // Multi-unknown (or constant) predicate: a shared post-filter.
          sideConditions.push(item);
        }
      }

      // The equations (side conditions removed) are what the solver sees.
      // Nothing at all left (a constraint-only set) → inert.
      if (equations.length === 0) return undefined;
      if (equations.length === 1) {
        ceq = equations[0];
      } else if (specs.some((s) => s.domain !== undefined)) {
        // Several equations with domains present: a conjunction tested per
        // candidate tuple (`classifyPredicate` routes a boolean `And` to the
        // predicate-enumeration path).
        ceq = ce.function('And', equations);
      } else {
        // A pure system with no domains anywhere, spelled as `Set`/`Tuple`/
        // `And`: rebuild as a `List` so it takes the existing multi-equation
        // `.solve(names)` path (fixing the Set-of-equations inertness).
        ceq = ce.function('List', equations);
      }
    }
  }

  // An arity-1 `Solve` is a deferred pipeline stage whose unknown-inference
  // was postponed at canonicalization (the operand contained the pipe topic
  // placeholder `_` — see `canonicalSolve`). If the stage has been applied,
  // `_` is bound in the evaluation scope: resolve it to the actual piped
  // expression, then infer the unknown from that. An unbound placeholder
  // stays inert. (Evaluating a bare bound `_` returns its stored value
  // without collapsing it — a symbolic `Equal` value survives. Note the
  // lambda machinery pre-evaluates arguments *before* binding, so an
  // `Equal` piped through the prefix form collapses to a boolean upstream
  // of this function; that pre-existing limitation makes such a stage
  // inert here — no unknown to infer from `False` — rather than wrong.)
  if (specs.length === 0) {
    if (ceq.has('_')) {
      const resolved = ceq.evaluate();
      if (resolved.has('_')) return undefined; // still unresolved → inert
      ceq = reduceTransformerHead(resolved.canonical);
    }
    const unknown = defaultUnknown(ceq);
    if (unknown === undefined) return undefined;
    specs = [{ unknown }];
  }

  // The `_` placeholder resolved above can give a new `List` of equations.
  ceq = plainItemsAsEquations(ce, ceq);

  // A symbol bound to an expression that *contains* the unknown hides it:
  // `Solve(s = 2, w)` with `s := (9 - w²)/4` saw an equation with no `w` and
  // returned `[]` — "proven no solutions". Resolve such bindings, protecting
  // the unknowns so the very variable being solved for is never substituted.
  ceq = resolveBoundSymbols(ceq, new Set(specs.map((spec) => spec.unknown)));

  // Indexing into a computed list hides the unknown the same way: project
  // `At(List(…), k)` structurally so the solver can see through `roots[1]`.
  ceq = reduceStructuralIndex(ceq);

  const domainSpecs = specs.filter((s) => s.domain !== undefined);

  // No domains: existing behavior.
  if (domainSpecs.length === 0) {
    const names = specs.map((s) => s.unknown);
    // A list of inequalities with no `Equal` has a region as its solution
    // set. A list of points cannot show a region: for a bounded region, the
    // list of its vertices is not the solution set. Thus `Solve` stays
    // unevaluated. When the list also has an `Equal`, the inequalities filter
    // the solutions of the equations, and that answer is a list of points.
    if (
      isFunction(ceq, 'List') &&
      !ceq.ops.some((item) => isFunction(item, 'Equal')) &&
      ceq.ops.some((item) => INEQUALITY_OPERATORS.includes(item.operator))
    )
      return undefined;
    // A single (string) unknown always yields the univariate root list
    // (`Expression[]`), never the system-solve `Record` shapes.
    if (names.length === 1) {
      // A univariate inequality (`Solve(x^2 < 4, x)`) has no root list.
      // `ceq.solve()` returns `[]`, which would serialize as "no solutions" —
      // misleading, since the request is simply unsupported. Stay inert
      // instead so the caller sees the unevaluated `Solve(...)`.
      if (INEQUALITY_OPERATORS.includes(ceq.operator ?? '')) return undefined;
      const conditioned =
        specs[0].condition !== undefined || sideConditions.length > 0;
      let roots: ReadonlyArray<Expression> | null;
      // Several equations in one unknown: the roots common to all of them.
      const common =
        isFunction(ceq, 'List') &&
        ceq.nops >= 2 &&
        ceq.ops.every((item) => isFunction(item, 'Equal'))
          ? commonRoots(ce, ceq.ops, names[0])
          : undefined;
      if (common === 'undecided') return undefined;
      if (common !== undefined) {
        roots = common;
      } else if (isFunction(ceq, 'Equal') || ceq.type.matches('number')) {
        // An equation (or a bare expression read as `= 0`): the same two
        // steps as `ceq.solve()`, with the candidate statistics kept. An
        // empty root list is a decision only in some cases, see
        // `emptyRootsAnswer()`.
        const stats = { candidates: false, undecided: false };
        const found = findUnivariateRoots(ceq, names[0], 0, undefined, stats);
        roots = filterRootsByAssumptions(ce, found, names[0]);
        // A list that is only a part of the roots is not an answer
        // (`partialRootListReason()`): the unknown is in a function that
        // the root finder cannot invert and that is not periodic
        // (`(x - 1)·BesselJ(0, x) = 0` gives only `1`), or a factor of a
        // product gave no root. The principal roots of a trig function are
        // the answer, as they represent its periodic families of roots.
        if (partialRootListReason(ceq, names[0], found, stats) !== undefined)
          return undefined;
        if (roots.length === 0)
          return emptyRootsAnswer(ce, ceq, names[0], stats, conditioned);
      } else {
        // For a `List` of equations, `ceq.solve()` uses the system solver,
        // which can return a record (`{x: 1}` for `[x = 1, 2x = 2]`) or an
        // array of records also for one unknown. Read the value of the
        // unknown from each record. A record without the unknown leaves the
        // unknown free, which a root list cannot show: stay inert.
        const sol = ceq.solve(names[0]);
        if (sol === null) roots = null;
        else {
          const items = Array.isArray(sol) ? sol : [sol];
          const values: Expression[] = [];
          for (const item of items) {
            if (isExpression(item)) values.push(item);
            else {
              const value = (item as Record<string, Expression>)[names[0]];
              if (value === undefined) return undefined;
              values.push(value);
            }
          }
          roots = values;
        }
      }
      // `null`: the solver does not handle this input, which does not prove
      // that there is no solution.
      if (roots === null) return undefined;
      // Apply any spec condition (a single-unknown side condition merged onto
      // the spec) and shared side conditions: drop a root only on a definite
      // `False` (keep `True`/undecidable). An empty result AFTER filtering is a
      // decision — roots were found and all excluded — not an inert solve.
      const kept = conditioned
        ? [...roots].filter((r) =>
            keepUnderConditions([specs[0]], sideConditions, [r.evaluate()])
          )
        : [...roots];
      return ce.function('List', kept);
    }
    // Phase 3: a single integer equation in several unknowns that are ALL
    // declared integer-typed has a symbolic diophantine solution — parametric
    // (fresh ℤ parameters) since the domains are unbounded. A plain untyped
    // unknown must NOT dispatch here (that is a real-domain solve): the type
    // check gates it. `undefined` (not a recognized form) keeps the existing
    // inert behavior below.
    if (
      names.length >= 2 &&
      isFunction(ceq, 'Equal') &&
      names.every((nm) => ce.symbol(nm).type.matches('integer')) &&
      // A condition/side-condition would have to filter the (possibly
      // parametric, unbounded) diophantine family, which substitution cannot
      // do — defer to the records path below, which filters concrete tuples.
      specs.every((s) => s.condition === undefined) &&
      sideConditions.length === 0
    ) {
      const dio = tryDiophantineSolve(ce, ceq, names, undefined);
      if (dio !== undefined) return ce.function('List', dio);
    }

    // Multi-symbol (no domains): the system solver returns `Record` shapes —
    // one record (linear, possibly parametric) or an array of records (e.g. a
    // polynomial system with several solutions). Shape them as a `List` of
    // `Tuple`s in variable order, the same contract as the multi-domain
    // enumeration path below. `null` stays inert: the solver conflates "no
    // solution" with "cannot solve", so an empty list (a *decision*) would
    // overclaim.
    const sol = ceq.solve(names);
    if (Array.isArray(sol) && sol.every((s) => isExpression(s)))
      return ce.function('List', sol as Expression[]);
    const records = Array.isArray(sol)
      ? (sol as Array<Record<string, Expression>>)
      : sol !== null && typeof sol === 'object'
        ? [sol as Record<string, Expression>]
        : null;
    if (records === null) return undefined;
    const tuples: Expression[] = [];
    for (const rec of records) {
      // An underdetermined system's record omits its free variables
      // (`{x: 5 − y}` for `x + y = 5`): a missing name IS the free variable,
      // so the parametric tuple is `(5 − y, y)`.
      const values = names.map((nm) => rec[nm] ?? ce.symbol(nm));
      // Drop a tuple only when a spec condition or shared side condition
      // reduces to a definite `False` (a parametric tuple stays undecidable and
      // is kept — the conservative posture).
      if (!keepUnderConditions(specs, sideConditions, values)) continue;
      tuples.push(ce.tuple(...values));
    }
    return ce.function('List', tuples);
  }

  // With domains present, EVERY spec must carry one. A bare-symbol spec mixed
  // in (e.g. `Solve(eq, x, Element(y, D))`) leaves `x` unconstrained — there is
  // no univariate or enumeration path for a free unknown — so stay inert.
  if (domainSpecs.length !== specs.length) return undefined;

  // Exactly one domain spec → Phase 1 univariate pipeline.
  if (specs.length === 1) {
    const result = solveOverDomain(ce, ceq, specs[0], sideConditions);
    if (result === undefined) return undefined; // undecidable → stay inert
    return ce.function('List', result);
  }

  // Several domain specs → Phase 2 multi-variable enumeration.
  const tuples = solveOverMultipleDomains(ce, ceq, specs, sideConditions);
  if (tuples === undefined) return undefined; // undecidable → stay inert
  return ce.function('List', tuples);
}

/**
 * Reduce the transformer heads in a held `Solve` equation while shielding the
 * value-bound unknowns.
 *
 * A nested transformer (`Simplify`/`Expand`/…) resolves and folds the
 * value-bound symbols in its operand — including an unknown that also carries a
 * global value, which erases the very variable being solved for (`x := 5` makes
 * `Solve(Simplify(x - 2) = 0, x)` reduce to `Solve(1 = 0, x)` → `[]`).
 *
 * Shield each such unknown by shadow-declaring it VALUELESS (with its current
 * type) in a temporary scope: with no value in scope it reduces as a genuine
 * unknown and stays symbolic. Protecting the *binding* also handles the case
 * where the unknown is reintroduced by another bound symbol's value
 * (`s := (9 - w²)/4`), which a name-level rename could not. Unknowns with no
 * value need no shield. Building `ceq` inside the scope is safe: the returned
 * expression references the unknowns by name, re-resolved against the restored
 * (value-carrying) binding once the scope is popped.
 */
function reduceWithUnknownsShielded(
  ce: ComputeEngine,
  eq: Expression,
  specs: ReadonlyArray<SolveSpec>
): Expression {
  const names = new Set(specs.map((spec) => spec.unknown));

  // §D: an arity-1 bundled solve carries its unknowns inside a collection-shaped
  // first argument as `Element(symbol, …)` items — visible on the canonical
  // equation here, but not yet lifted into `specs` (that happens later, AFTER
  // this reduction). Discover them now so a value-bound bundled unknown is
  // shielded too. Without this, `Solve(\{Simplify(9 - w²) = 8, w ∈ -3..3\})`
  // with `w := 9` reduced `Simplify(9 - w²)` to `-72` before learning `w` was
  // the solve target, and returned `[]`.
  const canonEq = eq.canonical;
  if (
    isFunction(canonEq, 'Set') ||
    isFunction(canonEq, 'List') ||
    isFunction(canonEq, 'Tuple') ||
    isFunction(canonEq, 'And')
  ) {
    for (const item of canonEq.ops ?? []) {
      if (isFunction(item, 'Element')) {
        const u = sym(item.op1);
        if (u !== undefined) names.add(u);
      }
    }
  }

  return withValueShield(ce, names, () => reduceTransformerHead(eq.canonical));
}

function isExpression(x: unknown): x is Expression {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as any).operator === 'string'
  );
}

/** Convert canonical `Solve` spec operands into `SolveSpec`s. */
function parseSolveSpecs(
  specOps: ReadonlyArray<Expression>
): SolveSpec[] | undefined {
  const out: SolveSpec[] = [];
  for (const spec of specOps) {
    const s = sym(spec);
    if (s !== undefined) {
      out.push({ unknown: s });
      continue;
    }
    if (isFunction(spec, 'Element')) {
      const u = sym(spec.op1);
      if (u === undefined) return undefined;
      const domain = spec.op2;
      // A domain we can neither filter nor enumerate (e.g. a type name like
      // `integer`, or an unbound symbol) is not a usable spec.
      if (domain === undefined || !domain.isCollection) return undefined;
      const condition =
        spec.nops >= 3 && sym(spec.op3) !== 'Nothing' ? spec.op3 : undefined;
      out.push({ unknown: u, domain, condition });
      continue;
    }
    return undefined;
  }
  return out;
}

/**
 * Solve `eq` for a single unknown constrained to `spec.domain`.
 *
 * Returns an array of solution VALUES (ascending domain order for the
 * enumeration path), or `undefined` when the problem cannot be decided (over
 * budget, or a non-enumerable domain with no symbolic solution). An empty
 * array is a *decision*: no solutions.
 */
export function solveOverDomain(
  ce: ComputeEngine,
  ceq: Expression,
  spec: SolveSpec,
  sideConditions: ReadonlyArray<Expression> = []
): Expression[] | undefined {
  const { unknown, domain, condition } = spec;
  if (domain === undefined) return undefined;

  // A shared side condition (usually empty for a single spec — single-unknown
  // conditions merge into `spec.condition`) drops a value only on a definite
  // `False`.
  const filterSide = (values: Expression[]): Expression[] =>
    sideConditions.length === 0
      ? values
      : values.filter((v) =>
          passesSideConditions(sideConditions, { [unknown]: v.evaluate() })
        );

  // `ceq` is the canonical equation/predicate. Classify it: an `Equal` (or a
  // bare numeric expression, read as `= 0`) is an equation and gets a
  // symbolic-first attempt; a boolean-valued expression (`Congruent`,
  // `Divides`, `Less`, `And`, …) goes straight to enumeration.
  const { predBody, isEquation } = classifyPredicate(ceq);

  // The element type of the domain refines the scratch unknown's type (an
  // integer `Range` → `integer`), so `filterRootsByType` discards non-integer
  // roots before any membership test.
  const elemType = collectionElementType(domain.type.type);
  const refinedType: Type = elemType ?? 'number';

  // 1. Symbolic solve (equations only), then membership filter.
  if (isEquation) {
    const stats = {
      candidates: false,
      undecided: false,
      partial: false,
      userRule: false,
    };
    const roots = symbolicRoots(ce, ceq, unknown, refinedType, stats);

    // Phase 2.2: the symbolic trig rules return principal values only. Over a
    // bounded domain, expand each principal root `x₀` into its full `x₀ + k·T`
    // family (and recover the scaled-argument roots the rules miss entirely).
    // `expandPeriodicRoots` returns `undefined` when the equation has no trig
    // function of the unknown, or the domain is unbounded — then the principal
    // roots are used as-is. It returns `null` when it cannot show that a list
    // holds all the roots in the domain: then the symbolic roots are not
    // used. A list it returns holds all the roots in the domain, thus an
    // empty list is a decision (no solutions).
    // When a factor of a product gave no root and is not shown to have no
    // root (`stats.partial`), the roots can be only a part of the roots
    // (`(x - 2)(x + e^x) = 0` gives only `2`). They are used only when the
    // numeric scan shows that the list is complete: a list from
    // `expandPeriodicRoots()` is checked by the scan, but with `undefined`
    // there was no check.
    // With `stats.partial`, the scan of `expandPeriodicRoots()` can reject
    // the list, but it accepts it only under strict conditions (see `strict`
    // in `rootListIsComplete()`).
    const checked = expandPeriodicRoots(
      ce,
      ceq,
      predBody,
      unknown,
      domain,
      roots,
      stats.userRule && roots.length > 0,
      stats.partial
    );
    const expanded = stats.partial && checked === undefined ? null : checked;
    const finalRoots = expanded === null ? [] : (expanded ?? roots);

    if (finalRoots.length > 0 || Array.isArray(expanded)) {
      // At least one root, or a list that is known to hold all the roots:
      // return the domain-filtered list and do NOT enumerate. Undecidable
      // membership (`undefined`) keeps the root.
      const inDomain = finalRoots.filter((r) =>
        keepInDomain(ce, domain, unknown, r, condition)
      );
      // Assumptions and the explicit domain restrict conjunctively: also drop
      // roots ruled out by an in-scope bound assumption on the unknown (e.g.
      // `assume(n > 3)` alongside `n ∈ -10..10`).
      return filterSide([...filterRootsByAssumptions(ce, inDomain, unknown)]);
    }

    // The type-refined solve found no roots in the domain's element type. For
    // an UNBOUNDED domain (enumeration impossible) a *polynomial* equation is
    // still decidable: its complete real root set is finite, so if none of
    // those roots lies in the domain the answer is a decision `[]`, not inert.
    // This resolves e.g. `Solve(2x=3, x, ℤ)` and `Solve(x²=2, x, ℤ)` → `[]`.
    // Restricted to polynomials so a solver that returns a *partial* root set
    // (transcendental equations) never over-claims "no solutions".
    const domainCount = domain.count;
    const unbounded =
      domainCount === undefined || !Number.isFinite(domainCount);
    if (unbounded && getPolynomialCoefficients(predBody, unknown)) {
      const realRoots = symbolicRoots(ce, ceq, unknown, 'number');
      if (realRoots.length > 0) {
        const inDomain = realRoots.filter((r) =>
          keepInDomain(ce, domain, unknown, r, condition)
        );
        return filterSide([...filterRootsByAssumptions(ce, inDomain, unknown)]);
      }
    }
  }

  // 2. Enumeration fallback.
  const count = domain.count;
  if (count === undefined || !Number.isFinite(count)) return undefined;

  // Compile the predicate as a lambda `unknown ↦ predBody`. Only a genuine
  // compilation (`success`) enables the larger budget and the float sieve; the
  // interpreter fallback (`success: false`) uses the exact path directly.
  const fnLit = ce.function('Function', [predBody, ce.symbol(unknown)]);
  const compiled = implicitCompile(ce, fnLit);
  const useCompiled =
    compiled !== undefined &&
    compiled.success === true &&
    (compiled as any).calling === 'lambda' &&
    typeof (compiled as any).run === 'function';
  const run = useCompiled
    ? ((compiled as any).run as (x: number) => unknown)
    : undefined;

  const budget = useCompiled
    ? MAX_SOLVE_ENUMERATION_COMPILED
    : MAX_SOLVE_ENUMERATION_INTERPRETED;
  if (count > budget) return undefined; // over budget → stay inert

  const tol = ce.tolerance;

  const results: Expression[] = [];
  let steps = 0;
  for (const item of domain.each()) {
    if ((++steps & 0x3ff) === 0) checkDeadline(ce._deadlineFrame);

    // Compiled (float) sieve: a fast, inexact pre-filter.
    if (run) {
      const r = run(item.re);
      const sievePass = isEquation
        ? typeof r === 'number' && Math.abs(r) <= tol
        : r === true;
      if (!sievePass) continue;
    }

    // Exact confirmation: every sieve-passing candidate (and every candidate at
    // all, on the interpreted path) is re-checked by exact engine evaluation —
    // floats lie for large integers (`2^53`).
    if (!confirmExact(predBody, isEquation, { [unknown]: item })) continue;

    // Optional condition (3rd `Element` operand): drop only on a definite
    // `False`, mirroring the symbolic membership filter.
    if (condition && conditionValue(condition, unknown, item) === false)
      continue;

    results.push(item);
  }
  // Apply any in-scope bound assumptions on the unknown conjunctively. This is a
  // post-pass over the (small) result set, NOT a per-candidate cost in the hot
  // enumeration loop: `filterRootsByAssumptions` no-ops when nothing constrains
  // the unknown, so the sweep above is unaffected. (Enumeration candidates are
  // concrete domain members, so an assumption like `n > 3` is usually already
  // implied by the domain — but not always, e.g. `n > 3` with `n ∈ 1..10`.)
  return filterSide([...filterRootsByAssumptions(ce, results, unknown)]);
}

/**
 * Classify a canonical equation/predicate for enumeration:
 * - an `Equal` (or a bare numeric expression read as `= 0`) is an *equation*
 *   whose residual body (`lhs - rhs`) is tested against zero;
 * - a boolean-valued expression (`Congruent`, `Divides`, `Less`, `And`, …) is a
 *   *predicate* tested against `True`.
 */
function classifyPredicate(ceq: Expression): {
  predBody: Expression;
  isEquation: boolean;
} {
  if (isFunction(ceq, 'Equal'))
    return { predBody: ceq.op1.sub(ceq.op2), isEquation: true };
  // A `broadcastable<boolean>` expression is a predicate as well
  // (`isBooleanOrBroadcastableBooleanType`), not a residual to test against 0.
  if (isBooleanOrBroadcastableBooleanType(ceq.type.type))
    return { predBody: ceq, isEquation: false };
  return { predBody: ceq, isEquation: true };
}

/**
 * Solve `ceq` for several unknowns, each constrained to a finite enumerable
 * domain, by sweeping the cartesian product of the domains.
 *
 * There is no symbolic path for a single equation in several unknowns (the
 * system solver needs several equations), so this is enumeration-only, per
 * design. Returns an array of `Tuple` VALUES in spec order, iterated in
 * lexicographic domain order (first spec outermost); or `undefined` when the
 * problem cannot be decided (a non-finite domain, or a product over budget).
 * An empty array is a *decision*: no solutions.
 */
export function solveOverMultipleDomains(
  ce: ComputeEngine,
  ceq: Expression,
  specs: SolveSpec[],
  sideConditions: ReadonlyArray<Expression> = []
): Expression[] | undefined {
  const { predBody, isEquation } = classifyPredicate(ceq);
  const unknowns = specs.map((s) => s.unknown);

  // Filter a candidate tuple (spec order) by the shared side conditions: drop
  // only on a definite `False`.
  const passesSide = (tuple: ReadonlyArray<Expression>): boolean => {
    if (sideConditions.length === 0) return true;
    const subs: Record<string, Expression> = {};
    for (let d = 0; d < unknowns.length; d++) subs[unknowns[d]] = tuple[d];
    return passesSideConditions(sideConditions, subs);
  };

  // Phase 3: symbolic diophantine dispatch. Before the enumeration budget check,
  // when the equation is an integer equation and every domain is integer-valued
  // (a bounded `Range` or the `Integers` set — not a half-bounded `Range` or a
  // real `Interval`) and carries no extra condition, try a closed-form integer
  // solve. It decides cases enumeration cannot reach (unbounded or over-budget
  // integer systems), returning concrete tuples over a bounded box, a parametric
  // family over ℤ, or an empty `List` for a proven-unsolvable equation. A return
  // of `undefined` (not a recognized diophantine form, or an instantiation over
  // the materialization cap) falls through to enumeration unchanged.
  if (
    isEquation &&
    sideConditions.length === 0 &&
    specs.every(
      (s) =>
        s.domain !== undefined &&
        s.condition === undefined &&
        isIntegerDomain(ce, s.domain)
    )
  ) {
    // The symbolic path bypasses the deadline-checked enumeration loop, so honor
    // the engine deadline here too — an already-elapsed deadline must abort.
    checkDeadline(ce._deadlineFrame);
    const dio = tryDiophantineSolve(
      ce,
      ceq,
      unknowns,
      specs.map((s) => s.domain)
    );
    if (dio !== undefined) return dio;
  }

  // Every domain must be finite; the PRODUCT of the counts bounds the sweep.
  // Accumulate and bail early once the product exceeds the largest budget, so an
  // over-budget request never materializes or sweeps anything.
  let product = 1;
  for (const s of specs) {
    if (s.domain === undefined) return undefined;
    const c = s.domain.count;
    if (c === undefined || !Number.isFinite(c)) return undefined;
    product *= c;
    if (product > MAX_SOLVE_ENUMERATION_COMPILED) return undefined;
  }
  // A zero-count factor (e.g. an empty `Range`) makes the product empty: a
  // decided "no solutions", not an error.
  if (product === 0) return [];

  // Compile the predicate as a multi-parameter lambda `(u₁, u₂, …) ↦ predBody`.
  // The compiled `run` is positional (`calling === 'lambda'`), its arguments in
  // spec order. Only a genuine compilation enables the larger budget and the
  // float sieve; the interpreter fallback uses the exact path directly.
  const fnLit = ce.function('Function', [
    predBody,
    ...unknowns.map((u) => ce.symbol(u)),
  ]);
  const compiled = implicitCompile(ce, fnLit);
  const useCompiled =
    compiled !== undefined &&
    compiled.success === true &&
    (compiled as any).calling === 'lambda' &&
    typeof (compiled as any).run === 'function';
  const run = useCompiled
    ? ((compiled as any).run as (...xs: number[]) => unknown)
    : undefined;

  const budget = useCompiled
    ? MAX_SOLVE_ENUMERATION_COMPILED
    : MAX_SOLVE_ENUMERATION_INTERPRETED;
  if (product > budget) return undefined; // over the interpreted budget

  // Materialize each domain's elements up front, then index the cartesian
  // product with a plain odometer. This is bounded and safe: each domain's
  // count individually divides the product (≤ budget), so the total stored is
  // ≤ n · budget. Materializing also sidesteps the cost/subtlety of restarting
  // a lazy `Range` iterator once per outer step.
  const elems: Expression[][] = specs.map((s) => [...s.domain!.each()]);
  const lens = elems.map((e) => e.length);
  const n = specs.length;

  const tol = ce.tolerance;
  const results: Expression[] = [];
  const idx = new Array<number>(n).fill(0);
  let steps = 0;

  // Odometer over the cartesian product. The LAST index advances fastest, so
  // the FIRST spec is the outermost (slowest) loop → lexicographic domain order
  // with the first spec varying slowest.
  for (;;) {
    if ((++steps & 0x3ff) === 0) checkDeadline(ce._deadlineFrame);

    const tuple = idx.map((k, d) => elems[d][k]);

    // Compiled (float) sieve: a fast, inexact pre-filter over the whole tuple.
    let sievePass = true;
    if (run) {
      const r = run(...tuple.map((v) => v.re));
      sievePass = isEquation
        ? typeof r === 'number' && Math.abs(r) <= tol
        : r === true;
    }

    if (sievePass) {
      const subs: Record<string, Expression> = {};
      for (let d = 0; d < n; d++) subs[unknowns[d]] = tuple[d];

      // Exact confirmation of the whole tuple — floats lie for large integers.
      if (confirmExact(predBody, isEquation, subs)) {
        // Per-spec conditions (3rd `Element` operand) apply to their OWN
        // variable; drop only on a definite `False`.
        let keep = true;
        for (let d = 0; d < n; d++) {
          const cond = specs[d].condition;
          if (cond && conditionValue(cond, unknowns[d], tuple[d]) === false) {
            keep = false;
            break;
          }
        }
        // Shared (multi-unknown) side conditions apply across the whole tuple.
        if (keep && passesSide(tuple)) results.push(ce.tuple(...tuple));
      }
    }

    // Advance the odometer (last position fastest); stop when it rolls over.
    let d = n - 1;
    for (; d >= 0; d--) {
      if (++idx[d] < lens[d]) break;
      idx[d] = 0;
    }
    if (d < 0) break;
  }

  return results;
}

//
// Phase 2.2 — root-family expansion for periodic equations over a bounded
// domain.
//
// The symbolic solver's trig rules (`UNIVARIATE_ROOTS`) return *principal*
// values only — `sin(x) = 1/2` yields `[π/6, 5π/6]`, one period's worth — and
// they do not fire at all on a scaled argument like `sin(2x)`. When the domain
// is bounded, we can turn a principal root `x₀` into the full family
// `x₀ + k·T` (T = the equation's period) that lands in the domain, and recover
// the scaled-argument roots via a linearizing substitution.
//
// Conservative by construction: we expand ONLY when the unknown appears solely
// inside trig functions of a *linear* argument (`a·x + b`, `a` a nonzero real),
// and every family member is confirmed by exact substitution before it is kept,
// so an imperfect period can never introduce a wrong answer.
//

// Trig heads and their base period (as a multiple of a half turn, which is π
// in radians): sin/cos and their reciprocals repeat every full turn (2π);
// tan/cot every half turn (π). The haversine `(1 - cos x)/2` repeats every
// full turn, as cos does.
const TRIG_2PI = new Set(['Sin', 'Cos', 'Sec', 'Csc', 'Haversine']);
const TRIG_PI = new Set(['Tan', 'Cot']);

// Heads that the root finder (`findUnivariateRoots()` in `solve.ts`) can
// invert when the unknown is in their operands: arithmetic, powers and
// radicals, exponentials and logarithms, the hyperbolic functions (which are
// made of exponentials), the inverse trig functions (which are monotonic on
// their domain) and `Abs`. A function of the unknown with another head
// (`BesselJ`, `Sinc`, `Gamma`, `Floor`, …) can have roots that the root
// finder does not give, and it can oscillate faster than the samples of the
// scan of `rootListIsComplete()`. The trig heads above are not in this set:
// the scan checks the roots of an equation with trig functions.
const INVERTIBLE_HEADS = new Set([
  'Add',
  'Subtract',
  'Negate',
  'Multiply',
  'Divide',
  'Power',
  'Square',
  'Sqrt',
  'Root',
  'Exp',
  'Ln',
  'Log',
  'Lb',
  'Lg',
  'Abs',
  'Sinh',
  'Cosh',
  'Tanh',
  'Coth',
  'Sech',
  'Csch',
  'Arcsin',
  'Arccos',
  'Arctan',
  'Arccot',
  'Arcsec',
  'Arccsc',
  'Arsinh',
  'Arcosh',
  'Artanh',
  'Arcoth',
  'Arsech',
  'Arcsch',
  // An inert display wrapper (`161_b` is `BaseForm(b² + 6b + 1, b)`): the
  // root finder removes it before it solves the equation.
  'BaseForm',
]);

/**
 * Return `true` when `unknown` is in an operand of a function that the root
 * finder cannot invert: a head that is not a trig head (`TRIG_2PI`,
 * `TRIG_PI`) and not in `INVERTIBLE_HEADS`, or a power whose base and
 * exponent both hold the unknown (`x^x`). For such an equation, the list of
 * the root finder can be a part of the roots, and no numeric scan can show
 * that it is complete.
 *
 * A trig function whose argument is not linear in the unknown
 * (`sin(x^2)`, `sin(e^x)`, `cos(2^x)`, `sin(1/x)`) is such a function too:
 * the equation is not periodic in the unknown, its roots do not form a
 * finite number of families, and the root finder gives only some of them
 * (`sin(x^2) = 0` has the roots `±√(kπ)` for each integer `k ≥ 0`).
 */
function hasNonInvertibleHead(node: Expression, unknown: string): boolean {
  if (!isFunction(node) || !node.has(unknown)) return false;
  const op = node.operator;
  if (!INVERTIBLE_HEADS.has(op) && !TRIG_2PI.has(op) && !TRIG_PI.has(op))
    return true;
  if (
    (TRIG_2PI.has(op) || TRIG_PI.has(op)) &&
    node.ops.some(
      (arg) => arg.has(unknown) && polynomialDegree(arg, unknown) !== 1
    )
  )
    return true;
  if (op === 'Power' && node.op1.has(unknown) && node.op2.has(unknown))
    return true;
  return node.ops.some((child) => hasNonInvertibleHead(child, unknown));
}

/**
 * `hasNonInvertibleHead()` for an equation `lhs = rhs` (each side is
 * examined), or for an expression that is read as `expr = 0`.
 */
function equationHasNonInvertibleHead(
  eq: Expression,
  unknown: string
): boolean {
  if (isFunction(eq, 'Equal'))
    return (
      hasNonInvertibleHead(eq.op1, unknown) ||
      hasNonInvertibleHead(eq.op2, unknown)
    );
  return hasNonInvertibleHead(eq, unknown);
}

/**
 * Why the roots that `findUnivariateRoots()` gave for the equation `eq` (an
 * `Equal`, or an expression read as `= 0`), with its `stats`, are only a part
 * of the roots, or `undefined` when they are not known to be:
 * - `'factor'`: a factor of a product gave no root, and it is not shown to
 *   have none (`(x - 2)(x + e^x) = 0` gives only `2`);
 * - `'non-invertible'`: the unknown is in a function that the root finder
 *   cannot invert and that is not periodic (`(x - 1)·BesselJ(0, x) = 0`
 *   gives only `1`). A root template that the host added to
 *   `ce.solveRules` is the host's claim of a solution: when one matched
 *   (`stats.userRule`) and `roots` (the result of the root finder) is not
 *   empty, the roots are accepted. A candidate of such a template that the
 *   check against the equation rejected does not show that there is no
 *   root, thus an empty list is not accepted.
 *
 * Every route that returns the roots of the root finder as an answer uses
 * this test (`Solve`, `expr.solve()`, `expr.explain('solve')`).
 */
export function partialRootListReason(
  eq: Expression,
  unknown: string,
  roots: ReadonlyArray<Expression>,
  stats: {
    candidates: boolean;
    undecided: boolean;
    partial?: boolean;
    userRule?: boolean;
  }
): 'factor' | 'non-invertible' | undefined {
  if (stats.partial) return 'factor';
  if (stats.userRule && roots.length > 0) return undefined;
  if (!isFunction(eq, 'Equal') && !eq.type.matches('number')) return undefined;
  return equationHasNonInvertibleHead(eq, unknown)
    ? 'non-invertible'
    : undefined;
}

/**
 * Return `true` when `domain` is the whole real line (`RealNumbers`, or an
 * interval from -∞ to +∞) or the complex numbers. For a periodic equation
 * over these domains, the answer is the list of the principal roots: this
 * is the documented convention of `Solve`. Over another domain that is not
 * bounded (`Integers`, a half-line, a union), the principal roots are not
 * all the roots in the domain, and there is no answer.
 */
function isPrincipalValueDomain(domain: Expression): boolean {
  const name = sym(domain);
  if (name === 'RealNumbers' || name === 'ComplexNumbers') return true;
  const int = interval(domain);
  return int !== undefined && int.start === -Infinity && int.end === Infinity;
}

/**
 * Return `true` when a user binding gives the name `Pi` another value
 * (`ce.declare('Pi', { value: 3 })`) and one of `roots` holds the symbol
 * `Pi`. A root written with the library π names `Pi` in its MathJSON, and
 * it has the user value when it is boxed again. Thus such a root is not an
 * answer.
 *
 * With `bounds`, a root whose numeric value is clearly outside
 * `[bounds.lo, bounds.hi]` is not examined: the caller removes it from the
 * answer (`(x - 1)·sin(x) = 0` over `[0.5, 2]` has the solver roots `1`,
 * `0` and `π`, and only `1` is in the domain).
 */
function rootsHoldShadowedPi(
  ce: ComputeEngine,
  roots: ReadonlyArray<Expression>,
  bounds?: { lo: number; hi: number }
): boolean {
  const inBounds = (r: Expression): boolean => {
    if (bounds === undefined) return true;
    const v = r.N().re;
    if (!Number.isFinite(v)) return true;
    const margin = 1e-9 * Math.max(1, Math.abs(v));
    return v >= bounds.lo - margin && v <= bounds.hi + margin;
  };
  return (
    roots.some((r) => r.has('Pi') && inBounds(r)) &&
    shadowsLibraryName(ce, 'Pi')
  );
}

/**
 * The numeric value of a half turn in the angular unit of the engine: π
 * (rad), 180 (deg), 200 (grad) or 1/2 (turn). A trig function reads its
 * argument in that unit, thus the periods of the trig terms of an equation
 * are multiples of this value.
 */
function halfTurnValue(ce: ComputeEngine): number {
  return halfTurnAngle(ce).N().re;
}

/** The shortest period of the trig terms `terms`. */
function shortestTermPeriod(ce: ComputeEngine, terms: TrigTerm[]): number {
  const halfTurn = halfTurnValue(ce);
  return Math.min(
    ...terms.map((t) => (t.baseMult * halfTurn) / Math.abs(t.aNum))
  );
}

/** A trig occurrence of the unknown with a linear argument `a·x + b`. */
interface TrigTerm {
  /**
   * Base period as a multiple of a half turn: 2 for sin/cos/sec/csc, 1 for
   * tan/cot.
   */
  baseMult: number;
  /** The linear coefficient `a` (exact). */
  aExpr: Expression;
  /** The numeric value of `a` (nonzero, finite). */
  aNum: number;
  /** The constant term `b` (exact, free of the unknown). */
  bExpr: Expression;
  /** The (shared) argument expression `a·x + b`. */
  arg: Expression;
}

function gcdInt(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

function lcmInt(a: number, b: number): number {
  return Math.abs(a * b) / gcdInt(a, b);
}

/**
 * Walk `node` and collect the trig occurrences of `unknown`.
 *
 * Returns:
 * - `[]` when `node` is free of the unknown (contributes no period);
 * - a list of `TrigTerm`s when every occurrence of the unknown sits inside a
 *   trig function of a *linear* argument;
 * - `undefined` when the unknown appears outside such a trig function (a bare
 *   `x`, a polynomial term, or a trig function of a non-linear argument) — the
 *   equation is then NOT a candidate for periodic expansion.
 */
function analyzePeriodic(
  node: Expression,
  unknown: string
): TrigTerm[] | undefined {
  if (!node.has(unknown)) return [];

  if (isFunction(node)) {
    const op = node.operator;
    const baseMult = TRIG_2PI.has(op) ? 2 : TRIG_PI.has(op) ? 1 : 0;
    if (baseMult !== 0 && node.nops === 1) {
      const arg = node.op1;
      // The argument must be linear in the unknown: `a·x + b`, degree exactly 1.
      const coeffs = getPolynomialCoefficients(arg, unknown);
      if (!coeffs || coeffs.length !== 2) return undefined;
      const aExpr = coeffs[1];
      const aNum = aExpr.N().re;
      if (!Number.isFinite(aNum) || Math.abs(aNum) < 1e-12) return undefined;
      return [{ baseMult, aExpr, aNum, bExpr: coeffs[0], arg }];
    }

    // A function containing the unknown but not itself a linear-argument trig:
    // its operands must each be well-behaved (free of `x`, or nested trig).
    const out: TrigTerm[] = [];
    for (const child of node.ops) {
      const r = analyzePeriodic(child, unknown);
      if (r === undefined) return undefined;
      out.push(...r);
    }
    return out;
  }

  // A non-function node containing the unknown is the bare symbol itself: the
  // unknown appears outside any trig function → not expandable.
  return undefined;
}

/**
 * The combined period of the collected trig terms, as an exact expression plus
 * its numeric value. A single distinct per-term period is used directly (valid
 * for any real `a`); several distinct periods are combined by the least common
 * multiple of their π-rational multiples, which requires integer `a` — if any
 * coefficient is irrational the periods may be incommensurable and we decline.
 *
 * The period is a multiple of a half turn in the angular unit of the engine
 * (`halfTurnAngle()`): the library constant `ce.Pi` in radians, 180 in
 * degrees, 200 in gradians and 1/2 in turns. A trig function reads its
 * argument in that unit, thus the period of `sin(x)` is 360 in degree mode.
 * In radians, the name `Pi` (`ce.symbol('Pi')`) is not used: it gives the
 * value of a user binding of `Pi`. The caller does not call this function
 * when a user binding shadows `Pi`.
 */
function combinedPeriod(
  ce: ComputeEngine,
  terms: TrigTerm[]
): { expr: Expression; value: number } | undefined {
  const halfTurn = halfTurnAngle(ce);
  const halfTurnNum = halfTurn.N().re;
  const tol = 1e-9;

  const periods = terms.map((t) => ({
    value: (t.baseMult * halfTurnNum) / Math.abs(t.aNum),
    baseMult: t.baseMult,
    aNum: t.aNum,
    aExpr: t.aExpr,
  }));

  // Distinct per-term periods (by numeric value).
  const distinct: typeof periods = [];
  for (const p of periods)
    if (
      !distinct.some(
        (d) => Math.abs(d.value - p.value) <= tol * Math.max(1, p.value)
      )
    )
      distinct.push(p);

  if (distinct.length === 1) {
    const p = distinct[0];
    // T = baseMult·π / |a|  (exact; e.g. 2π/2 → π). Evaluate to fold the `|a|`
    // and Divide away while staying symbolic in π.
    const expr = ce
      .function('Divide', [
        ce.function('Multiply', [ce.number(p.baseMult), halfTurn]),
        ce.function('Abs', [p.aExpr]),
      ])
      .evaluate();
    return { expr, value: p.value };
  }

  // Several distinct periods: T = lcm of the π-rational multiples. Each term's
  // period is (baseMult/|a|)·π; the lcm of rationals is lcm(numerators) /
  // gcd(denominators). Requires integer `a`.
  const fracs: Array<[num: number, den: number]> = [];
  for (const p of distinct) {
    const aInt = Math.round(p.aNum);
    if (Math.abs(p.aNum - aInt) > tol || aInt === 0) return undefined;
    let n = p.baseMult;
    let d = Math.abs(aInt);
    const g = gcdInt(n, d);
    n /= g;
    d /= g;
    fracs.push([n, d]);
  }
  const lcmNum = fracs.reduce((acc, [n]) => lcmInt(acc, n), 1);
  const gcdDen = fracs.reduce((acc, [, d]) => gcdInt(acc, d), fracs[0][1]);
  const value = (lcmNum / gcdDen) * halfTurnNum;
  const expr = ce
    .function('Divide', [
      ce.function('Multiply', [ce.number(lcmNum), halfTurn]),
      ce.number(gcdDen),
    ])
    .evaluate();
  return { expr, value };
}

/**
 * Finite `[lo, hi]` bounding range of a domain, or `undefined` for an unbounded
 * or non-numeric one. Both `Range` (integer/real) and `Interval` (real) are
 * supported; known interval-like sets (`RealNumbers`, …) fall through
 * `interval()` and are rejected for having an infinite endpoint.
 */
function domainBoundingRange(
  domain: Expression
): { lo: number; hi: number } | undefined {
  if (isFunction(domain, 'Range')) {
    let lo: number;
    let hi: number;
    if (domain.nops >= 2) {
      lo = domain.op1.N().re;
      hi = domain.op2.N().re;
    } else {
      lo = 1;
      hi = domain.op1.N().re;
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return undefined;
    return { lo: Math.min(lo, hi), hi: Math.max(lo, hi) };
  }

  const int = interval(domain);
  if (int === undefined) return undefined;
  if (!Number.isFinite(int.start) || !Number.isFinite(int.end))
    return undefined;
  return { lo: Math.min(int.start, int.end), hi: Math.max(int.start, int.end) };
}

/**
 * Recover principal roots for a scaled-argument equation the symbolic trig
 * rules miss (they only match `Sin(x)`, never `Sin(2x)`). When every trig term
 * shares ONE linear argument `L = a·x + b`, the substitution `x = (u − b)/a`
 * turns each `trig(L)` into `trig(u)`, which the solver DOES handle; its
 * `u`-roots map back to `x = (u₀ − b)/a`. Returns `undefined` when the terms do
 * not share a single argument (no clean linearizing substitution). `stats`
 * gets the statistics of the root finder for the equation in `u`.
 */
function substitutionRoots(
  ce: ComputeEngine,
  ceq: Expression,
  unknown: string,
  terms: TrigTerm[],
  stats?: {
    candidates: boolean;
    undecided: boolean;
    partial?: boolean;
    userRule?: boolean;
  }
): Expression[] | undefined {
  const arg0 = terms[0].arg;
  if (!terms.every((t) => t.arg.isSame(arg0))) return undefined;

  const a = terms[0].aExpr;
  const b = terms[0].bExpr;

  ce.pushScope();
  try {
    const uName = '_periodic_u';
    ce.declare(uName, 'real');
    const u = ce.symbol(uName);
    // x = (u − b)/a  →  every `trig(a·x + b)` collapses to `trig(u)`.
    const xExpr = ce.function('Divide', [ce.function('Subtract', [u, b]), a]);
    const subEq = ceq.subs({ [unknown]: xExpr });
    // The substitution must have eliminated the original unknown entirely.
    if (subEq.has(unknown)) return undefined;
    const uRoots = findUnivariateRoots(subEq, uName, 0, undefined, stats);
    if (!uRoots || uRoots.length === 0) return undefined;
    // Map each `u`-root back: x = (u₀ − b)/a (exact).
    return uRoots.map((u0) =>
      ce.function('Divide', [ce.function('Subtract', [u0, b]), a]).evaluate()
    );
  } finally {
    ce.popScope();
  }
}

/**
 * Expand the principal roots of a periodic equation into the full root family
 * that lands in a bounded domain.
 *
 * Returns `undefined` when the equation has no trig function of the unknown,
 * or the domain is the whole real line or the complex numbers
 * (`isPrincipalValueDomain()`) — the caller then uses the principal roots
 * as-is. Otherwise returns the exact family members, sorted ascending and
 * de-duplicated (membership + condition filtering is applied by the caller).
 * The list holds all the roots in the domain: an empty list is a decision
 * (the equation has no root in the domain).
 *
 * Returns `null` (no answer) when the list cannot be shown to hold all the
 * roots in the domain. The caller then enumerates a finite domain, or leaves
 * the `Solve` unevaluated. This is the case:
 * - when the domain is not bounded, and it is not the whole real line or the
 *   complex numbers (`Integers`, a half-line, a union): the principal roots
 *   are only a part of the roots in the domain (`sin(πx) = 0` has a root at
 *   each integer, and the solver gives only `0`);
 * - when the unknown is in a function that the root finder cannot invert
 *   (`hasNonInvertibleHead()`): `(x - 1)·BesselJ(0, x) = 0` gives only `1`,
 *   and the scan cannot check such a function (see `rootListIsComplete()`).
 *   This is also the result over the whole real line and the complex
 *   numbers: such a function is not periodic, and principal roots do not
 *   represent its roots;
 * - when the family would be larger than `MAX_PERIODIC_EXPANSION` periods:
 *   the principal roots alone are only a part of the roots in the domain, and
 *   a partial list is not an answer;
 * - when the numeric values of two principal roots cannot show whether they
 *   give the same family or two families (`sameRootFamily()`);
 * - when a numeric scan of the domain finds a root that is not in the list,
 *   or cannot show that it found all the roots (`rootListIsComplete()`).
 *
 * When the solver finds no root, the result is `[]` if the scan finds no root
 * in the domain, else `null`. When the periods of the trig terms have no
 * common multiple, there is no family, and the result is the principal roots
 * if the scan finds no other root, else `null`.
 *
 * When the unknown also appears outside a trig function of a linear argument
 * (`x·sin(x) = 0`), there is no family to expand. The result is then the
 * principal roots when a numeric scan shows that they are all the roots in
 * the domain, else `null` (see `checkNonPeriodicRoots()`).
 *
 * Returns `null` when a user binding gives the name `Pi` another value
 * (`ce.declare('Pi', { value: 3 })`), and the half turn of the angular unit
 * or a root of the result holds `Pi` (`rootsHoldShadowedPi()`). In radians,
 * the period is a multiple of the library π, and an exact root written with
 * π would name `Pi` in its MathJSON and have the user value when it is boxed
 * again. The principal roots alone are not used: they are not all the roots
 * in the domain, and when none of them is in the domain the answer would be
 * the empty list. With no roots, the caller enumerates a finite domain, or
 * leaves the `Solve` unevaluated. In degrees, grads and turns, the half turn
 * is a number (180, 200, 1/2), and a root list that does not hold `Pi` is an
 * answer.
 */
function expandPeriodicRoots(
  ce: ComputeEngine,
  ceq: Expression,
  predBody: Expression,
  unknown: string,
  domain: Expression,
  symbolicRootList: ReadonlyArray<Expression>,
  userRule = false,
  strict = false
): Expression[] | null | undefined {
  // The principal roots are the answer over the whole real line or the
  // complex numbers, but not over another domain that has no bounds.
  const principalOrNone = (): undefined | null =>
    isPrincipalValueDomain(domain) && !rootsHoldShadowedPi(ce, symbolicRootList)
      ? undefined
      : null;

  // A function that the root finder cannot invert is not periodic, and its
  // roots are not represented by principal roots: no answer, also over the
  // whole real line. When a root template that the host added to
  // `ce.solveRules` gave the roots (`userRule`), they are the host's claim of
  // a solution, and they are used.
  if (!userRule && hasNonInvertibleHead(predBody, unknown)) return null;

  // Detect the periodic structure on the residual `f(x) = lhs − rhs`.
  const terms = analyzePeriodic(predBody, unknown);
  if (terms === undefined)
    return checkNonPeriodicRoots(
      ce,
      predBody,
      unknown,
      domain,
      symbolicRootList,
      strict
    );
  if (terms.length === 0) return undefined;

  const bounds = domainBoundingRange(domain);
  if (bounds === undefined) return principalOrNone(); // cannot expand

  // In radians, the period is a multiple of the library π (see the comment
  // of this function).
  if (halfTurnAngle(ce).has('Pi') && shadowsLibraryName(ce, 'Pi')) return null;

  // A period that is not a finite positive number gives no family. The
  // principal roots alone are not known to be all the roots in the domain.
  const period = combinedPeriod(ce, terms);
  if (
    period !== undefined &&
    (!Number.isFinite(period.value) || period.value <= 0)
  )
    return null;

  // Principal roots: the symbolic solver's (a = 1, direct-argument) roots when
  // it found any, else the scaled-argument substitution.
  let principal: Expression[] = [...symbolicRootList];
  if (principal.length === 0) {
    const subStats = {
      candidates: false,
      undecided: false,
      partial: false,
      userRule: false,
    };
    principal = substitutionRoots(ce, ceq, unknown, terms, subStats) ?? [];
    // The roots of the substituted equation are only a part of its roots:
    // the scan must use its strict conditions.
    if (subStats.partial) strict = true;
  }

  // The principal roots are not always all the roots in one period: for
  // `sin x + cos x = 0` the solver gives only `-π/4`, and `3π/4` is a root
  // too. A numeric scan of the domain checks the final list. When the scan
  // finds a root that is not in the list, the result is `null`, and the
  // caller leaves the `Solve` unevaluated (or enumerates a finite domain).
  // The shortest period of a trig term sets the density of the scan.
  const termPeriod = shortestTermPeriod(ce, terms);
  const fn = realFunction(ce, predBody, unknown);
  const complete = (
    roots: Expression[],
    periodNum?: number
  ): Expression[] | null =>
    !rootsHoldShadowedPi(ce, roots, bounds) &&
    rootListIsComplete(ce, fn, bounds, termPeriod, roots, periodNum, strict)
      ? roots
      : null;

  // The solver found no root (`sin x = 2`). When the scan finds no root
  // either, the equation has no root in the domain, and the empty list is
  // the answer.
  if (principal.length === 0) return complete([]);

  // The periods of the trig terms have no common multiple (an irrational
  // ratio): there is no family to expand, and the principal roots are the
  // answer only when the scan finds no other root.
  if (period === undefined) return complete(principal);
  const { expr: T, value: Tnum } = period;

  // Safety cap: never materialize a very large family (a `[0, 10^9]` domain
  // must not generate ~10^8 roots). The principal roots alone are a partial
  // list, thus there is no answer: the `Solve` stays unevaluated (or the
  // caller enumerates a finite integer domain).
  const span = bounds.hi - bounds.lo;
  if (span / Tnum > MAX_PERIODIC_EXPANSION) return null;

  // The roots repeat with the period `T` of the equation, but often also with
  // a shorter spacing `T/n`: `sin x + cos x` has the period 2π, and its roots
  // are π apart because `f(x + π) = -f(x)`. Expand each principal root with
  // this shorter spacing.
  const divisor = rootSetDivisor(fn.f, bounds.lo, Tnum);
  const spacing =
    divisor === 1
      ? T
      : ce.function('Divide', [T, ce.number(divisor)]).evaluate();
  const spacingNum = Tnum / divisor;

  const tol = ce.tolerance;
  const out: Expression[] = [];
  // The principal roots expanded so far, with their numeric values. Two
  // principal roots give the same family when their difference is an exact
  // multiple of the spacing.
  const families: Array<{ root: Expression; value: number }> = [];
  for (const x0 of principal) {
    const x0num = x0.N().re;
    if (!Number.isFinite(x0num)) {
      // A symbolic/non-finite principal root cannot be positioned in the
      // domain; keep it as-is and let membership filtering decide.
      out.push(x0);
      continue;
    }
    const same = families.map((f) =>
      sameRootFamily(ce, f.root, f.value, x0, x0num, spacing, spacingNum)
    );
    // The numeric values cannot show whether `x0` gives a new family: a
    // family can be lost, thus there is no answer.
    if (same.some((s) => s === undefined)) return null;
    if (same.some((s) => s === true)) continue;
    families.push({ root: x0, value: x0num });
    const kmin = Math.ceil((bounds.lo - x0num) / spacingNum - tol);
    const kmax = Math.floor((bounds.hi - x0num) / spacingNum + tol);
    // Above 2^53, `k + 1` is not always a different float: the loop would
    // not end (`sin x = 0` over `[10^17, 10^17 + 64]`), and the float `k` is
    // not the exact index of the root. There is no answer.
    if (!Number.isSafeInteger(kmin) || !Number.isSafeInteger(kmax)) return null;
    for (let k = kmin; k <= kmax; k++) {
      const member =
        k === 0
          ? x0
          : ce
              .function('Add', [
                x0,
                ce.function('Multiply', [ce.number(k), spacing]),
              ])
              .evaluate();
      // Confirm by exact substitution — guards an imperfect period and never
      // admits a wrong answer.
      if (
        predBody
          .subs({ [unknown]: member })
          .evaluate()
          .isIdenticallyEqual(0) !== true
      )
        continue;
      out.push(member);
    }
  }

  // Sort ascending by numeric value, then drop duplicates. The members of two
  // different families are different values, thus only a value that is the
  // same expression is a duplicate. Two values that are nearer than the
  // tolerance can be two roots (`(sin x - 1/2)(sin x - 1/2 - 10^-10) = 0`).
  out.sort((p, q) => p.N().re - q.N().re);
  const deduped: Expression[] = [];
  for (const e of out) {
    const last = deduped[deduped.length - 1];
    if (last && last.isSame(e)) continue;
    deduped.push(e);
  }
  return complete(deduped, Tnum);
}

/**
 * Compare the families `a + k·spacing` and `b + k·spacing` of two principal
 * roots `a` and `b` (`aNum` and `bNum` are their numeric values).
 *
 * Returns `true` when `b - a` is an exact integer multiple of `spacing`:
 * the two roots give the same family. Returns `false` when the numeric
 * values show that it is not. Returns `undefined` when the difference does
 * not simplify to 0 but is too small for its numeric value to show that it
 * is not 0.
 *
 * Two roots can be very near each other: `sin(x) = 1/2` and
 * `sin(x) = 1/2 + 10^-10` have roots `1.15·10^-10` apart. A comparison of
 * the numeric values only would merge them, and a root would be lost.
 */
function sameRootFamily(
  ce: ComputeEngine,
  a: Expression,
  aNum: number,
  b: Expression,
  bNum: number,
  spacing: Expression,
  spacingNum: number
): boolean | undefined {
  const q = (bNum - aNum) / spacingNum;
  const k = Math.round(q);
  // The rounding error of `q` is much smaller than this limit.
  if (Math.abs(q - k) > 1e-6) return false;
  const diff = ce
    .function('Subtract', [
      b,
      ce.function('Add', [a, ce.function('Multiply', [ce.number(k), spacing])]),
    ])
    .evaluate();
  if (diff.isSame(0)) return true;
  // The numeric value of the exact difference has an error of a few units
  // of `|x|·ε`. A value much larger than that is not 0.
  const d = diff.N().re;
  const scale = Math.max(1, Math.abs(aNum), Math.abs(bNum));
  if (Number.isFinite(d) && Math.abs(d) > 1e-12 * scale) return false;
  return undefined;
}

/**
 * The trig functions of `unknown` in `node`, each with a linear argument
 * `a·x + b`. The unknown can also appear outside a trig function: those
 * occurrences are ignored. Returns `undefined` when a trig function of the
 * unknown has an argument that is not linear in the unknown (`sin(x^2)`).
 */
function trigTerms(node: Expression, unknown: string): TrigTerm[] | undefined {
  if (!isFunction(node) || !node.has(unknown)) return [];
  const op = node.operator;
  if ((TRIG_2PI.has(op) || TRIG_PI.has(op)) && node.nops === 1)
    return analyzePeriodic(node, unknown);
  const out: TrigTerm[] = [];
  for (const child of node.ops) {
    const r = trigTerms(child, unknown);
    if (r === undefined) return undefined;
    out.push(...r);
  }
  return out;
}

/**
 * Check the root list of an equation that is not periodic because the
 * unknown is not only in trig functions of a linear argument (`x·sin(x) = 0`,
 * `(x - 1)·sin(x) = 0`, `sin(x^2) = 0`). Such an equation has no root family
 * to expand, and the root finder often gives only some of its roots: for
 * `x·sin(x) = 0` it gives `0` and `π`, but each `k·π` is a root.
 *
 * Returns `undefined` when the equation has no trig function of the unknown,
 * or the domain is the whole real line or the complex numbers
 * (`isPrincipalValueDomain()`), or the domain is bounded and `roots` is
 * empty: the caller then uses `roots` as they are. Returns `null` (no
 * answer) for another domain that is not bounded (`Integers`, a half-line):
 * the roots of the solver are only a part of the roots there.
 *
 * Over a bounded domain, returns `roots` when a numeric scan of the domain
 * finds no other root (`rootListIsComplete()`), else `null`. The scan
 * samples each trig function at a density set by its period, thus a trig
 * function of an argument that is not linear (`sin(x^2)`) has no such
 * density and also gives `null`. With `null`, the caller enumerates a finite
 * domain, or leaves the `Solve` unevaluated.
 *
 * Also returns `null` when a user binding gives the name `Pi` another value
 * and a root holds `Pi` (`rootsHoldShadowedPi()`).
 *
 * When `predBody` is a product, each factor that is periodic (the unknown is
 * only in trig functions of a linear argument) gives its family of roots in
 * the domain (`expandPeriodicRoots()` on that factor), and the scan checks
 * the union of the families and of `roots`: `(x - 1)·cos(x) = 0` over
 * `[0, 5]` gives `1`, `π/2` and `3π/2`. `strict` is passed to the scan (see
 * `rootListIsComplete()`).
 */
function checkNonPeriodicRoots(
  ce: ComputeEngine,
  predBody: Expression,
  unknown: string,
  domain: Expression,
  roots: ReadonlyArray<Expression>,
  strict = false
): Expression[] | null | undefined {
  const terms = trigTerms(predBody, unknown);
  if (terms !== undefined && terms.length === 0) return undefined;
  const bounds = domainBoundingRange(domain);
  if (rootsHoldShadowedPi(ce, roots, bounds)) return null;
  if (bounds === undefined)
    return isPrincipalValueDomain(domain) ? undefined : null;
  if (roots.length === 0) return undefined;
  if (terms === undefined) return null;
  const all = withFactorFamilies(ce, predBody, unknown, domain, roots);
  const termPeriod = shortestTermPeriod(ce, terms);
  const fn = realFunction(ce, predBody, unknown);
  return rootListIsComplete(ce, fn, bounds, termPeriod, all, undefined, strict)
    ? all
    : null;
}

/**
 * The roots `roots` of the product `predBody`, with the family of roots in
 * the bounded `domain` of each factor that is periodic in `unknown` (the
 * unknown is only in trig functions of a linear argument): for
 * `(x - 1)·cos(x)` over `[0, 5]`, the roots `1`, `π/2` and `-π/2` of the
 * root finder, and the family `π/2`, `3π/2` of `cos(x)`. A factor `fⁿ` with
 * a positive constant `n` gives the family of `f`. The values are sorted
 * when a family adds one, and a value that is equal to a value of the list
 * is not added.
 *
 * Returns `roots` when `predBody` is not a product. A factor whose family
 * cannot be shown to be complete (`expandPeriodicRoots()` gives `null`)
 * adds no value: the caller scans the whole product, and the scan rejects a
 * list that misses a root.
 */
function withFactorFamilies(
  ce: ComputeEngine,
  predBody: Expression,
  unknown: string,
  domain: Expression,
  roots: ReadonlyArray<Expression>
): Expression[] {
  const out = [...roots];
  if (!isFunction(predBody, 'Multiply')) return out;
  let added = false;
  for (const factor of predBody.ops) {
    const base =
      isFunction(factor, 'Power') &&
      !factor.op2.has(unknown) &&
      factor.op2.isPositive === true
        ? factor.op1
        : factor;
    const terms = analyzePeriodic(base, unknown);
    if (terms === undefined || terms.length === 0) continue;
    const stats = {
      candidates: false,
      undecided: false,
      partial: false,
      userRule: false,
    };
    const factorRoots = findUnivariateRoots(base, unknown, 0, undefined, stats);
    const family = expandPeriodicRoots(
      ce,
      base,
      base,
      unknown,
      domain,
      factorRoots,
      false,
      stats.partial
    );
    // No family: the scan of the whole product still checks the list.
    if (family === null || family === undefined) continue;
    for (const r of family) {
      if (out.some((o) => o.isSame(r) || o.isEqual(r) === true)) continue;
      out.push(r);
      added = true;
    }
  }
  if (added) out.sort((p, q) => p.N().re - q.N().re);
  return out;
}

/**
 * A numeric version of the real function `body` of `unknown`, for the checks
 * of `expandPeriodicRoots()`. It is compiled when possible. Otherwise each
 * call substitutes the value and evaluates `body` numerically, which is much
 * slower: `compiled` tells the caller which version it has. A value that is
 * not a finite real number (a pole, a complex value, a free symbol) is `NaN`.
 */
function realFunction(
  ce: ComputeEngine,
  body: Expression,
  unknown: string
): { f: (x: number) => number; compiled: boolean } {
  const run = implicitCompileNumeric(ce, body);
  if (run !== undefined) {
    return {
      f: (x) => {
        try {
          return run({ [unknown]: x });
        } catch {
          return NaN;
        }
      },
      compiled: true,
    };
  }
  return {
    f: (x) => {
      const v = body.subs({ [unknown]: ce.number(x) }).N();
      return Math.abs(v.im) > 1e-12 ? NaN : v.re;
    },
    compiled: false,
  };
}

/**
 * The largest `n` (at most `MAX_ROOT_SET_DIVISOR`) such that the roots of
 * `f` repeat every `period / n`, or 1 when no such `n` is found.
 *
 * `period` is a period of `f`. When `f(x + period/n)` is `f(x)` or `-f(x)`
 * for all `x`, each root of `f` gives another root `period/n` away. The test
 * compares the two values at a few sample points, so it is not a proof. The
 * caller confirms each root it makes with this spacing by exact substitution,
 * and checks the final list with `rootListIsComplete()`.
 */
function rootSetDivisor(
  f: (x: number) => number,
  start: number,
  period: number
): number {
  // Sample points at irregular fractions of the period, so that they do not
  // fall on a pattern of the function.
  const fractions = [0.1234, 0.2718, 0.3142, 0.4142, 0.5772, 0.6931, 0.866];
  for (let n = MAX_ROOT_SET_DIVISOR; n >= 2; n--) {
    const shift = period / n;
    let same = true;
    let opposite = true;
    let count = 0;
    for (const t of fractions) {
      const x = start + t * period;
      const a = f(x);
      const b = f(x + shift);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      count += 1;
      const tol = 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
      if (Math.abs(b - a) > tol) same = false;
      if (Math.abs(b + a) > tol) opposite = false;
    }
    if (count >= 4 && (same || opposite)) return n;
  }
  return 1;
}

/**
 * Return `true` when a numeric scan of `[bounds.lo, bounds.hi]` finds no real
 * root of `fn.f` that is not in `roots`.
 *
 * The scan samples `f` `PERIODIC_SCAN_SAMPLES_PER_PERIOD` times per
 * `termPeriod` (the shortest period of a trig term of `f`). It finds a root
 * where the sign of `f` changes (refined by bisection), and a root where `f`
 * touches zero without a sign change (a local minimum of `|f|`, refined by a
 * golden-section search). A sign change at a pole (`tan x` at `π/2`) is not a
 * root: there `|f|` becomes very large.
 *
 * The search for a minimum of `|f|` also examines the first and the last
 * cell of the scan (between an end of the window and the sample next to it):
 * a root that touches zero there (`sin(13x)^2·cos(x)` at `6π/13`, just
 * after `lo = 1.4499`) does not show as a local minimum of the samples.
 *
 * The scan also finds a root at the edge of a region where `f` is not real
 * (`x·√(cos(x) + 0.99)` is not real between `arccos(-0.99)` and
 * `2π - arccos(-0.99)`, and it is 0 at both ends of that region). Between
 * each sample that is a finite number and a sample that is `NaN`, a bisection
 * finds the edge. A value of `|f|` at the edge that is close to zero is a
 * root: the list must hold it.
 *
 * A value found by the scan matches a value of the list when they are
 * closer than a tolerance. The tolerance grows with `|x|`, because the
 * rounding error of a root grows with `|x|`, but it stays much smaller than
 * the distance between two samples. A larger tolerance at a large `|x|`
 * (near `10^8`) would let a root that is not in the list match a near root
 * that is in the list.
 *
 * A root where `f` touches zero can be flat: near the root `π` of
 * `sin(x)^10`, `|f|` is less than `10^-16` on an interval of width 0.05, and
 * a sample in that interval is not the position of the root. For a sample
 * where `|f|` is close to zero, or a minimum of `|f|` that is close to zero,
 * the scan does not record a point. Bisections find the interval around it
 * where `|f|` stays below the threshold, and the list must hold a value in
 * that interval (to the tolerance above). For a simple root, the interval
 * is very small. For a root of high multiplicity, it is wider: the
 * multiplicity makes the position of the root less certain. An interval
 * longer than 1/8 of `termPeriod` is not clear: `f` is then close to zero
 * on a large part of the domain.
 *
 * What the scan can and cannot show. The density of the samples comes only
 * from the periods of the trig terms. Thus the scan can check an equation
 * whose other parts (polynomials, radicals, exponentials, logarithms) do not
 * oscillate faster than its trig terms. A function that can oscillate
 * faster (`BesselJ(0, 50x)`, `Sinc`, a trig function of an argument that is
 * not linear) can have roots between two samples. The callers do not call
 * the scan for such an equation: `expandPeriodicRoots()` returns no answer
 * when the unknown is in a function that the root finder cannot invert
 * (`hasNonInvertibleHead()`), and `checkNonPeriodicRoots()` when a trig
 * function has an argument that is not linear. Also, the scan cannot tell
 * apart two roots that are in one interval where `|f|` is close to zero, or
 * that are in one cell of the scan with no sign change of `f` at the
 * samples: it finds only one of them. This occurs near a double root (a
 * near tangency, `sin(x) = 1 - 10^-18`). The caller makes sure that two
 * principal roots that are near each other are both expanded
 * (`sameRootFamily()`).
 *
 * When `period` (a period of `f`) is given and the domain is longer than it,
 * the scan covers only the first period `[lo, lo + period]`. Each root of `f`
 * in the domain is then a root of that window plus a multiple of `period`, so
 * the list must also hold `r + period` for each of its roots `r` when
 * `r + period` is in the domain. This keeps the cost of the scan independent
 * of the length of the domain.
 *
 * The result is `false` (the list cannot be shown to be complete) when:
 * - the list does not hold `r + period` for one of its roots `r`;
 * - the scan needs more samples than the budget (the enumeration budgets of
 *   `Solve`, compiled or interpreted);
 * - more than a tenth of the samples are not finite real numbers;
 * - a refined point is neither clearly a root nor clearly not a root;
 * - the rounding error of `x` at the largest `|x|` of the domain is not much
 *   smaller than the tolerance: the scan cannot tell two near roots apart.
 *
 * With `strict`, the list is known to be only a part of the roots of the
 * root finder (a factor of a product gave no root: `stats.partial`). A root
 * that the root finder did not find can then be very near a root of the
 * list: `sin(x)·(x + e^x - 1 - 10^-8) = 0` has the roots `0` and about
 * `5·10^-9`, and the tolerance above matches both to `0`. The result is
 * `true` only when each root that the scan finds is a crossing of zero (a
 * change of sign of `f`) that is located to less than `10^-9·max(1, |x|)`,
 * and it matches exactly one value of the list, which no other root that
 * the scan finds matches. A root where `f` touches zero without a change of
 * sign, or a zone where `|f|` is close to zero that is wider than that, can
 * hide two roots: the result is then `false`. The scan still cannot tell an
 * odd number of roots in one cell of the scan (three roots in a cell show as
 * one change of sign) from one root.
 */
function rootListIsComplete(
  ce: ComputeEngine,
  fn: { f: (x: number) => number; compiled: boolean },
  bounds: { lo: number; hi: number },
  termPeriod: number,
  roots: ReadonlyArray<Expression>,
  period?: number,
  strict = false
): boolean {
  const { f } = fn;
  const values = roots
    .map((r) => r.N().re)
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);

  const step = termPeriod / PERIODIC_SCAN_SAMPLES_PER_PERIOD;
  if (!(step > 0)) return false;
  // Two values closer than `matchTol(x)` are the same root (see above).
  const matchTol = (x: number): number =>
    Math.min(1e-6 * Math.max(1, Math.abs(x)), step / 16);
  // The rounding error of a value near `x` is about 3 units of `|x|·ε`: the
  // float of an exact root, a root refined by bisection to two adjacent
  // floats, and the rounding of `x` and of the argument `a·x + b`. When it is
  // larger than the tolerance at the largest `|x|` of the domain, a match
  // cannot tell two near roots apart (near `10^17`, two adjacent floats are
  // farther apart than the roots of `sin(x)`).
  const xMax = Math.max(Math.abs(bounds.lo), Math.abs(bounds.hi));
  if (4 * Number.EPSILON * Math.max(1, xMax) > matchTol(xMax)) return false;

  // True if the list holds a value in `[l, r]` (to the precision of the
  // scan).
  const listHolds = (l: number, r: number): boolean => {
    const start = l - matchTol(l);
    // Binary search for the first value `>= start`.
    let a = 0;
    let b = values.length;
    while (a < b) {
      const m = (a + b) >> 1;
      if (values[m] < start) a = m + 1;
      else b = m;
    }
    return a < values.length && values[a] <= r + matchTol(r);
  };
  // True if the list holds a value at `x` (to the precision of the scan).
  const inList = (x: number): boolean => listHolds(x, x);

  const { lo } = bounds;
  let { hi } = bounds;
  if (period !== undefined && lo + period < hi) {
    const edge = hi - matchTol(hi);
    for (const v of values)
      if (v + period <= edge && !inList(v + period)) return false;
    hi = lo + period;
  }

  const budget = fn.compiled
    ? MAX_SOLVE_ENUMERATION_COMPILED
    : MAX_SOLVE_ENUMERATION_INTERPRETED;
  const n = Math.max(1, Math.ceil((hi - lo) / step));
  if (n > budget) return false;

  const xs = new Float64Array(n + 1);
  const ys = new Float64Array(n + 1);
  let finiteCount = 0;
  for (let i = 0; i <= n; i++) {
    if ((i & 0x3ff) === 0x3ff) checkDeadline(ce._deadlineFrame);
    xs[i] = i === n ? hi : lo + ((hi - lo) * i) / n;
    ys[i] = f(xs[i]);
    if (Number.isFinite(ys[i])) finiteCount += 1;
  }
  if (finiteCount < 0.9 * (n + 1)) return false;

  // The median of `|f|` is the scale for the thresholds below. The median is
  // used, not the maximum, because a sample near a pole is very large.
  const mags = Array.from(ys)
    .filter((y) => Number.isFinite(y))
    .map((y) => Math.abs(y))
    .sort((a, b) => a - b);
  const scale = mags[mags.length >> 1] || 1;
  const zeroTol = 1e-12 * scale;
  const isZero = (y: number) => Math.abs(y) <= zeroTol;

  // The interval around `[l, r]` where `|f| <= t` (see the comment of this
  // function). `|f| <= t` at `l` and `r`, and `a <= l <= r <= b`. A
  // bisection between `a` and `l` finds the left end, and a bisection
  // between `r` and `b` the right end. Returns `undefined` when `|f| <= t`
  // also at `a` or `b`, and that point is not an end of the window: the
  // interval then goes past the cells of the scan next to it, and the scan
  // cannot locate the root. Also returns `undefined` when the interval is
  // longer than 1/8 of `termPeriod`.
  const zeroInterval = (
    a: number,
    l: number,
    r: number,
    b: number,
    t: number
  ): [number, number] | undefined => {
    // A value that is not a finite number is outside the interval.
    const outside = (x: number): boolean => !(Math.abs(f(x)) <= t);
    const end = (out: number, inside: number): number | undefined => {
      if (out === inside) return out;
      if (!outside(out))
        return out === xs[0] || out === xs[n] ? out : undefined;
      for (let k = 0; k < 100; k++) {
        const m = inside + (out - inside) / 2;
        if (m === inside || m === out) break;
        if (outside(m)) out = m;
        else inside = m;
      }
      return out;
    };
    const left = end(a, l);
    const right = end(b, r);
    if (left === undefined || right === undefined) return undefined;
    if (right - left > termPeriod / 8) return undefined;
    return [left, right];
  };

  // Each root found by the scan is an interval that holds it: a point for a
  // root where `f` changes sign.
  const found: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const y = ys[i];
    if (!Number.isFinite(y)) continue;
    if (isZero(y)) {
      // A run of samples `i..j` where `|f|` is close to zero holds a root.
      // Find the interval around the run where `|f|` stays close to zero.
      let j = i;
      while (j < n && Number.isFinite(ys[j + 1]) && isZero(ys[j + 1])) j++;
      // With `strict`, the zone must be a crossing of zero: the samples next
      // to it have opposite signs. Otherwise, it can hide two roots.
      if (strict) {
        const before = i > 0 ? ys[i - 1] : NaN;
        const after = j < n ? ys[j + 1] : NaN;
        if (
          !Number.isFinite(before) ||
          !Number.isFinite(after) ||
          isZero(before) ||
          isZero(after) ||
          before > 0 === after > 0
        )
          return false;
      }
      const zone = zeroInterval(
        xs[i > 0 ? i - 1 : 0],
        xs[i],
        xs[j],
        xs[j < n ? j + 1 : n],
        zeroTol
      );
      if (zone === undefined) return false;
      found.push(zone);
      i = j;
      continue;
    }

    // A sign change between this sample and the next one: bisect.
    const y1 = i < n ? ys[i + 1] : NaN;
    if (Number.isFinite(y1) && !isZero(y1) && y > 0 !== y1 > 0) {
      let a = xs[i];
      let b = xs[i + 1];
      let fa = y;
      let fb = y1;
      for (let k = 0; k < 100 && b - a > 0; k++) {
        const m = a + (b - a) / 2;
        if (m <= a || m >= b) break;
        const fm = f(m);
        if (Number.isNaN(fm)) return false;
        // An infinite value is a pole, not a root.
        if (!Number.isFinite(fm)) {
          fa = fm;
          fb = fm;
          break;
        }
        if (fm > 0 === fa > 0) [a, fa] = [m, fm];
        else [b, fb] = [m, fm];
      }
      const [x, fx] = Math.abs(fa) <= Math.abs(fb) ? [a, fa] : [b, fb];
      // A crossing root refines to the rounding error of `f`, and a pole
      // refines to a very large value. Any other value (a jump of `f` across
      // zero) is not clear.
      if (Math.abs(fx) <= 1e-6 * scale) found.push([x, x]);
      else if (Math.abs(fx) <= 1e6 * scale) return false;
      continue;
    }

    // A local minimum of `|f|` with no sign change: `f` can touch zero
    // (`sin(x)^2 = 1` at `π/2`). Search the minimum of `|f|` in the two cells
    // next to the sample. The first and the last sample have only one cell in
    // the window: when `|f|` decreases toward the end of the window, the
    // minimum is in that cell or at the end, and the search examines it.
    let a: number;
    let b: number;
    if (i === 0 || i === n) {
      const j = i === 0 ? 1 : n - 1;
      const yj = ys[j];
      if (!Number.isFinite(yj) || yj > 0 !== y > 0) continue;
      if (Math.abs(y) > Math.abs(yj)) continue;
      [a, b] = i === 0 ? [xs[0], xs[1]] : [xs[n - 1], xs[n]];
    } else {
      const y0 = ys[i - 1];
      if (!Number.isFinite(y0) || !Number.isFinite(y1)) continue;
      if (y0 > 0 !== y > 0 || y1 > 0 !== y > 0) continue;
      if (Math.abs(y) > Math.abs(y0) || Math.abs(y) > Math.abs(y1)) continue;
      [a, b] = [xs[i - 1], xs[i + 1]];
    }
    const [cellStart, cellEnd] = [a, b];
    const g = (Math.sqrt(5) - 1) / 2;
    let c = b - g * (b - a);
    let d = a + g * (b - a);
    let fc = Math.abs(f(c));
    let fd = Math.abs(f(d));
    for (let k = 0; k < 100 && b - a > 0; k++) {
      if (fc <= fd) {
        b = d;
        d = c;
        fd = fc;
        c = b - g * (b - a);
        fc = Math.abs(f(c));
      } else {
        a = c;
        c = d;
        fc = fd;
        d = a + g * (b - a);
        fd = Math.abs(f(d));
      }
    }
    const [x, fx] = fc <= fd ? [c, fc] : [d, fd];
    if (!Number.isFinite(fx)) return false;
    // A minimum close to zero is a root. The list must hold a value in the
    // interval around it where `|f|` stays close to zero: for a flat root,
    // the position `x` of the minimum is not precise. A minimum too close to
    // zero to tell a root from a near miss is not clear.
    if (fx <= 1e-9 * scale) {
      // With `strict`, a root where `f` touches zero can be two near roots.
      if (strict) return false;
      const zone = zeroInterval(
        cellStart,
        x,
        x,
        cellEnd,
        Math.max(zeroTol, 2 * fx)
      );
      if (zone === undefined) return false;
      found.push(zone);
    } else if (fx < 1e-6 * scale) return false;
  }

  // A root at the edge of a region where `f` is not real: `f` can go to zero
  // at the edge (`√u` where `u` goes to 0), with no sign change and no
  // local minimum of the samples. Between a finite sample and a `NaN` sample,
  // bisect to the last point where `f` is finite. A value of `|f|` there
  // that is close to zero is a root, and the list must hold it. A value
  // that is small, but not clearly a root (the edge of `u^(1/8)`), is not
  // clear.
  for (let i = 0; i < n; i++) {
    let a: number;
    let b: number;
    if (Number.isFinite(ys[i]) && Number.isNaN(ys[i + 1]))
      [a, b] = [xs[i], xs[i + 1]];
    else if (Number.isNaN(ys[i]) && Number.isFinite(ys[i + 1]))
      [a, b] = [xs[i + 1], xs[i]];
    else continue;
    checkDeadline(ce._deadlineFrame);
    // `a` is on the side where `f` is finite, `b` on the other side.
    let fa = f(a);
    for (let k = 0; k < 100; k++) {
      const m = a + (b - a) / 2;
      if (m === a || m === b) break;
      const fm = f(m);
      if (Number.isFinite(fm)) [a, fa] = [m, fm];
      else b = m;
    }
    if (Math.abs(fa) <= 1e-6 * scale) found.push([a, a]);
    else if (Math.abs(fa) < 1e-2 * scale) return false;
  }

  if (!strict) return found.every(([l, r]) => listHolds(l, r));

  // `strict`: each root found matches exactly one value of the list, at a
  // tolerance much smaller than `matchTol`, and no two roots found match
  // the same value (see the comment of this function).
  const strictTol = (x: number): number => 1e-9 * Math.max(1, Math.abs(x));
  const used = new Set<number>();
  for (const [l, r] of found) {
    if (r - l > strictTol(l)) return false;
    const matches: number[] = [];
    for (let k = 0; k < values.length; k++)
      if (values[k] >= l - strictTol(l) && values[k] <= r + strictTol(r))
        matches.push(k);
    if (matches.length !== 1 || used.has(matches[0])) return false;
    used.add(matches[0]);
  }
  return true;
}

/**
 * Run the symbolic univariate solver with the unknown's type refined to
 * `refinedType`, so `findUnivariateRoots` → `filterRootsByType` drops roots of
 * the wrong numeric kind (e.g. the irrational root of a quadratic when the
 * domain is integer). With `stats`, `stats.partial` tells when the roots are
 * known to be only a part of the roots (see `findUnivariateRoots()`).
 */
function symbolicRoots(
  ce: ComputeEngine,
  eq: Expression,
  unknown: string,
  refinedType: Type,
  stats?: {
    candidates: boolean;
    undecided: boolean;
    partial?: boolean;
    userRule?: boolean;
  }
): ReadonlyArray<Expression> {
  ce.pushScope();
  try {
    ce.declare(unknown, refinedType);
    return findUnivariateRoots(eq, unknown, 0, undefined, stats);
  } finally {
    ce.popScope();
  }
}

// Assumption operators that carry a filterable constraint on a single symbol.
// Bound assumptions are stored *normalized* to `Less`/`LessEqual` (with the
// subject on the lhs and `0` on the rhs — `assume.ts`), disequalities as
// `NotEqual`, and inert set memberships as `Element`/`NotElement`; equalities
// (`Equal`) are intentionally excluded (they assign a value, not a filter, and
// `verify()` has known quirks with assumed equalities — repo memory).
const FILTERABLE_ASSUMPTION_OPS = new Set([
  'Less',
  'LessEqual',
  'Greater',
  'GreaterEqual',
  'NotEqual',
  'Element',
  'NotElement',
]);

/**
 * Drop roots that a stored assumption definitely rules out.
 *
 * For each assumption in the current context whose ONLY free symbol is
 * `unknown` and whose operator is a filterable constraint (inequality,
 * disequality, or set membership), substitute each root and evaluate; a root is
 * dropped ONLY on a definite `False`. `True` and undecidable (anything that does
 * not reduce to `False`) keep the root — the same conservative Kleene posture as
 * `keepInDomain`/`validateRoots`, so an undecidable bound (e.g. a symbolic root
 * whose sign the engine cannot settle) never silently loses a valid solution.
 *
 * Assumptions mentioning any other free symbol are skipped: substituting the
 * root would leave them symbolic (undecidable), so they can never decide a drop.
 *
 * This reads whatever assumptions are in effect at call time; because
 * assumptions are lexically scoped (`pushScope`/`popScope`), a popped assumption
 * is simply not seen here — no explicit teardown is needed.
 */
export function filterRootsByAssumptions(
  ce: ComputeEngine,
  roots: ReadonlyArray<Expression>,
  unknown: string
): ReadonlyArray<Expression> {
  const assumptions = contextAssumptions(ce);

  // Collect (once) the assumptions that constrain ONLY the unknown.
  const relevant: Expression[] = [];
  for (const [a, records] of assumptions.entries()) {
    if (!isFactTrue(records)) continue;
    const op = a.operator;
    if (!op || !FILTERABLE_ASSUMPTION_OPS.has(op)) continue;
    const free = a.unknowns;
    if (free.length !== 1 || free[0] !== unknown) continue;
    relevant.push(a);
  }
  if (relevant.length === 0) return roots;

  return roots.filter((root) => {
    const value = root.evaluate();
    for (const a of relevant) {
      const v = a.subs({ [unknown]: value }).evaluate();
      if (sym(v) === 'False') return false; // definite contradiction → drop
    }
    return true;
  });
}

/**
 * Keep a symbolic root if the domain membership is `True` or undecidable
 * (`undefined`); drop it only on a definite `False`. Same conservative posture
 * as `validateRoots`. If a condition is present, apply it the same way.
 */
function keepInDomain(
  ce: ComputeEngine,
  domain: Expression,
  unknown: string,
  root: Expression,
  condition: Expression | undefined
): boolean {
  const value = root.evaluate();
  let contained = domain.contains(value);
  // A concrete-valued root that the (exact) membership test cannot decide —
  // e.g. an expanded periodic root `2π` against an integer `Range`'s step grid,
  // which `contains` leaves `undefined` for a symbolic target — is decided
  // numerically. The numeric fallback only flips an `undefined` when the value
  // is a finite real number; a truly symbolic value (with free variables) still
  // yields `NaN` and stays kept, per the conservative posture.
  if (contained === undefined) {
    const n = value.N();
    if (Number.isFinite(n.re) && n.im === 0) contained = domain.contains(n);
  }
  if (contained === false) return false;
  if (condition && conditionValue(condition, unknown, value) === false)
    return false;
  return true;
}

/**
 * Exact confirmation of a candidate: substitute the unknown(s) and evaluate
 * with the engine (not the compiled float). For an equation, the residual must
 * be exactly zero; for a boolean predicate, it must evaluate to `True`. The
 * substitution is a record so the same check serves the univariate path (one
 * unknown) and the multi-variable path (a whole candidate tuple at once).
 */
function confirmExact(
  predBody: Expression,
  isEquation: boolean,
  subs: Record<string, Expression>
): boolean {
  const v = predBody.subs(subs).evaluate();
  if (isEquation) return v.isIdenticallyEqual(0) === true;
  return sym(v) === 'True';
}

/**
 * Evaluate a condition predicate at a concrete value. Returns `true`/`false`
 * for a decided boolean, `undefined` when it does not reduce to a boolean.
 */
function conditionValue(
  condition: Expression,
  unknown: string,
  value: Expression
): boolean | undefined {
  const c = condition.subs({ [unknown]: value }).evaluate();
  const s = sym(c);
  if (s === 'True') return true;
  if (s === 'False') return false;
  return undefined;
}

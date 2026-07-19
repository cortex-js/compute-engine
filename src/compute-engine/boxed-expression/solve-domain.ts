import type { Type } from '../../common/type/types.js';
import { collectionElementType } from '../../common/type/utils.js';
import { checkDeadline } from '../../common/interruptible.js';
import { implicitCompile } from '../implicit-compile.js';

import type {
  IComputeEngine as ComputeEngine,
  Expression,
} from '../global-types.js';
import { isFunction, sym } from './type-guards.js';
import { defaultUnknown, reduceTransformerHead } from './utils.js';
import { findUnivariateRoots } from './solve.js';
import { getPolynomialCoefficients } from './polynomials.js';
import { interval } from '../numerics/interval.js';
import { tryDiophantineSolve, isIntegerDomain } from './diophantine.js';

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
 * equation to solve, never a filter).
 */
function isSideConditionPredicate(item: Expression): boolean {
  const op = item.operator;
  if (op && SIDE_CONDITION_OPERATORS.has(op)) return true;
  if (op === 'Equal') return false;
  return item.type.matches('boolean');
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
 * `docs/plans/2026-07-04-solve-domain-design.md`.
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
// `sin(x) = 0` over `[0, 10^9]`): staying inert would LOSE the principal roots
// we already have, so the honest degradation is to return the (unexpanded)
// principal roots and let the normal membership filter apply.
const MAX_PERIODIC_EXPANSION = 1000;

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
  let ceq = reduceTransformerHead(eq.canonical);

  let specs = parseSolveSpecs(ops.slice(1));
  if (specs === undefined) return undefined; // invalid spec → stay inert

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
  if (
    isFunction(ceq, 'Set') ||
    isFunction(ceq, 'List') ||
    isFunction(ceq, 'Tuple') ||
    isFunction(ceq, 'And')
  ) {
    // Only a `List` that actually bundles domain constraints is rewritten; an
    // ordinary `List` equation system (no `Element` items) must reach the
    // existing `.solve(names)` path unchanged.
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

    if (lifted.length > 0 || !wasList) {
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

  const domainSpecs = specs.filter((s) => s.domain !== undefined);

  // No domains: existing behavior.
  if (domainSpecs.length === 0) {
    const names = specs.map((s) => s.unknown);
    // A single (string) unknown always yields the univariate root list
    // (`Expression[]`), never the system-solve `Record` shapes.
    if (names.length === 1) {
      // A univariate inequality (`Solve(x^2 < 4, x)`) has no root list.
      // `ceq.solve()` returns `[]`, which would serialize as "no solutions" —
      // misleading, since the request is simply unsupported. Stay inert
      // instead so the caller sees the unevaluated `Solve(...)`. (Linear
      // inequality *systems* are handled by the multi-variable path.)
      if (INEQUALITY_OPERATORS.includes(ceq.operator ?? '')) return undefined;
      const roots = ceq.solve(names[0]) as ReadonlyArray<Expression> | null;
      if (roots === null) return ce.function('List', []);
      // Apply any spec condition (a single-unknown side condition merged onto
      // the spec) and shared side conditions: drop a root only on a definite
      // `False` (keep `True`/undecidable). An empty result AFTER filtering is a
      // decision — roots were found and all excluded — not an inert solve.
      const kept =
        specs[0].condition !== undefined || sideConditions.length > 0
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
    const roots = symbolicRoots(ce, ceq, unknown, refinedType);

    // Phase 2.2: the symbolic trig rules return principal values only. Over a
    // bounded domain, expand each principal root `x₀` into its full `x₀ + k·T`
    // family (and recover the scaled-argument roots the rules miss entirely).
    // `expandPeriodicRoots` returns `undefined` when the equation is not a
    // periodic one amenable to expansion — then the principal roots are used
    // as-is (today's behavior).
    const expanded = expandPeriodicRoots(
      ce,
      ceq,
      predBody,
      unknown,
      domain,
      roots
    );
    const finalRoots = expanded ?? roots;

    if (finalRoots.length > 0) {
      // At least one root: return the domain-filtered list and do NOT
      // enumerate. Undecidable membership (`undefined`) keeps the root.
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
    if ((++steps & 0x3ff) === 0) checkDeadline(ce._deadline);

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
  if (ceq.type.matches('boolean')) return { predBody: ceq, isEquation: false };
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
    checkDeadline(ce._deadline);
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
    if ((++steps & 0x3ff) === 0) checkDeadline(ce._deadline);

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

// Trig heads and their base period (as a rational multiple of π): sin/cos and
// their reciprocals repeat every 2π; tan/cot every π.
const TRIG_2PI = new Set(['Sin', 'Cos', 'Sec', 'Csc']);
const TRIG_PI = new Set(['Tan', 'Cot']);

/** A trig occurrence of the unknown with a linear argument `a·x + b`. */
interface TrigTerm {
  /** Base period as a multiple of π: 2 for sin/cos/sec/csc, 1 for tan/cot. */
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
 */
function combinedPeriod(
  ce: ComputeEngine,
  terms: TrigTerm[]
): { expr: Expression; value: number } | undefined {
  const Pi = ce.symbol('Pi');
  const tol = 1e-9;

  const periods = terms.map((t) => ({
    value: (t.baseMult * Math.PI) / Math.abs(t.aNum),
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
        ce.function('Multiply', [ce.number(p.baseMult), Pi]),
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
  const value = (lcmNum / gcdDen) * Math.PI;
  const expr = ce
    .function('Divide', [
      ce.function('Multiply', [ce.number(lcmNum), Pi]),
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
 * not share a single argument (no clean linearizing substitution).
 */
function substitutionRoots(
  ce: ComputeEngine,
  ceq: Expression,
  unknown: string,
  terms: TrigTerm[]
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
    const uRoots = findUnivariateRoots(subEq, uName);
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
 * Returns `undefined` when the equation is not a candidate for expansion (the
 * unknown appears outside a linear-argument trig function, the domain is
 * unbounded, or the period is indeterminable) — the caller then uses the
 * principal roots as-is. Otherwise returns the exact family members, sorted
 * ascending and de-duplicated (membership + condition filtering is applied by
 * the caller). If the family would be larger than `MAX_PERIODIC_EXPANSION`, the
 * (unexpanded) principal roots are returned instead — the honest degradation,
 * since staying inert would lose the roots we already have.
 */
function expandPeriodicRoots(
  ce: ComputeEngine,
  ceq: Expression,
  predBody: Expression,
  unknown: string,
  domain: Expression,
  symbolicRootList: ReadonlyArray<Expression>
): Expression[] | undefined {
  // Detect the periodic structure on the residual `f(x) = lhs − rhs`.
  const terms = analyzePeriodic(predBody, unknown);
  if (terms === undefined || terms.length === 0) return undefined;

  const bounds = domainBoundingRange(domain);
  if (bounds === undefined) return undefined; // unbounded → cannot expand

  const period = combinedPeriod(ce, terms);
  if (period === undefined) return undefined;
  const { expr: T, value: Tnum } = period;
  if (!Number.isFinite(Tnum) || Tnum <= 0) return undefined;

  // Principal roots: the symbolic solver's (a = 1, direct-argument) roots when
  // it found any, else the scaled-argument substitution.
  let principal: Expression[] = [...symbolicRootList];
  if (principal.length === 0) {
    principal = substitutionRoots(ce, ceq, unknown, terms) ?? [];
    if (principal.length === 0) return undefined;
  }

  // Safety cap: never materialize an unbounded family (a `[0, 10^9]` domain
  // must not generate ~10^8 roots). Degrade to the principal roots.
  const span = bounds.hi - bounds.lo;
  if (span / Tnum > MAX_PERIODIC_EXPANSION) return principal;

  const tol = ce.tolerance;
  const out: Expression[] = [];
  for (const x0 of principal) {
    const x0num = x0.N().re;
    if (!Number.isFinite(x0num)) {
      // A symbolic/non-finite principal root cannot be positioned in the
      // domain; keep it as-is and let membership filtering decide.
      out.push(x0);
      continue;
    }
    const kmin = Math.ceil((bounds.lo - x0num) / Tnum - tol);
    const kmax = Math.floor((bounds.hi - x0num) / Tnum + tol);
    for (let k = kmin; k <= kmax; k++) {
      const member =
        k === 0
          ? x0
          : ce
              .function('Add', [x0, ce.function('Multiply', [ce.number(k), T])])
              .evaluate();
      // Confirm by exact substitution — guards an imperfect period and never
      // admits a wrong answer.
      if (
        predBody
          .subs({ [unknown]: member })
          .evaluate()
          .isEqual(0) !== true
      )
        continue;
      out.push(member);
    }
  }

  // Sort ascending by numeric value, then drop duplicates (e.g. two principal
  // roots that coincide modulo the period).
  out.sort((p, q) => p.N().re - q.N().re);
  const deduped: Expression[] = [];
  for (const e of out) {
    const last = deduped[deduped.length - 1];
    if (last && (last.isSame(e) || Math.abs(last.N().re - e.N().re) <= tol))
      continue;
    deduped.push(e);
  }
  return deduped;
}

/**
 * Run the symbolic univariate solver with the unknown's type refined to
 * `refinedType`, so `findUnivariateRoots` → `filterRootsByType` drops roots of
 * the wrong numeric kind (e.g. the irrational root of a quadratic when the
 * domain is integer).
 */
function symbolicRoots(
  ce: ComputeEngine,
  eq: Expression,
  unknown: string,
  refinedType: Type
): ReadonlyArray<Expression> {
  ce.pushScope();
  try {
    ce.declare(unknown, refinedType);
    return findUnivariateRoots(eq, unknown);
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
  const assumptions = ce.context?.assumptions;
  if (!assumptions) return roots;

  // Collect (once) the assumptions that constrain ONLY the unknown.
  const relevant: Expression[] = [];
  for (const [a, truth] of assumptions.entries()) {
    if (truth !== true) continue;
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
  if (isEquation) return v.isEqual(0) === true;
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

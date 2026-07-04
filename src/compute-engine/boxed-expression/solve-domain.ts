import type { Type } from '../../common/type/types';
import { collectionElementType } from '../../common/type/utils';
import { checkDeadline } from '../../common/interruptible';

import type { IComputeEngine as ComputeEngine, Expression } from '../global-types';
import { isFunction, sym } from './type-guards';
import { findUnivariateRoots } from './solve';

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
  if (ops.length < 2) {
    // Reuse the standard arity padding (produces `missing` error operands).
    const padded = [...ops];
    while (padded.length < 2) padded.push(ce.error('missing'));
    return ce._fn('Solve', padded);
  }

  const eq = ops[0]; // keep lazy — do not canonicalize
  const specs = ops.slice(1).map((spec) => canonicalSolveSpec(ce, spec));
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
 * - exactly one domain spec → the univariate domain pipeline below;
 * - multiple domain specs → return `undefined` (stays inert; Phase 2).
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
  const ceq = eq.canonical;

  const specs = parseSolveSpecs(ops.slice(1));
  if (specs === undefined) return undefined; // invalid spec → stay inert

  const domainSpecs = specs.filter((s) => s.domain !== undefined);

  // No domains: existing behavior.
  if (domainSpecs.length === 0) {
    const names = specs.map((s) => s.unknown);
    // A single (string) unknown always yields the univariate root list
    // (`Expression[]`), never the system-solve `Record` shapes.
    if (names.length === 1) {
      const roots = ceq.solve(names[0]) as ReadonlyArray<Expression> | null;
      if (roots === null) return ce.function('List', []);
      return ce.function('List', [...roots]);
    }
    // Multi-symbol (no domains): only wrap plain value lists; leave the
    // system-solve `Record` shapes unevaluated (not value-shaped in Phase 1).
    const sol = ceq.solve(names);
    if (Array.isArray(sol) && sol.every((s) => isExpression(s)))
      return ce.function('List', sol as Expression[]);
    return undefined;
  }

  // Multiple domain specs → Phase 2.
  if (domainSpecs.length > 1) return undefined;

  // Exactly one domain spec. Phase 1 is univariate: any extra symbol-only spec
  // would make the problem multivariate, which is not yet supported.
  if (specs.length !== 1) return undefined;

  const result = solveOverDomain(ce, ceq, domainSpecs[0]);
  if (result === undefined) return undefined; // undecidable → stay inert
  return ce.function('List', result);
}

function isExpression(x: unknown): x is Expression {
  return (
    typeof x === 'object' && x !== null && typeof (x as any).operator === 'string'
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
  spec: SolveSpec
): Expression[] | undefined {
  const { unknown, domain, condition } = spec;
  if (domain === undefined) return undefined;

  // `ceq` is the canonical equation/predicate. Classify it: an `Equal` (or a
  // bare numeric expression, read as `= 0`) is an equation and gets a
  // symbolic-first attempt; a boolean-valued expression (`Congruent`,
  // `Divides`, `Less`, `And`, …) goes straight to enumeration.
  let numericBody: Expression | null = null;
  let boolPred: Expression | null = null;
  if (isFunction(ceq, 'Equal')) numericBody = ceq.op1.sub(ceq.op2);
  else if (ceq.type.matches('boolean')) boolPred = ceq;
  else numericBody = ceq;

  // The element type of the domain refines the scratch unknown's type (an
  // integer `Range` → `integer`), so `filterRootsByType` discards non-integer
  // roots before any membership test.
  const elemType = collectionElementType(domain.type.type);
  const refinedType: Type = elemType ?? 'number';

  // 1. Symbolic solve (equations only), then membership filter.
  if (numericBody !== null) {
    const roots = symbolicRoots(ce, ceq, unknown, refinedType);
    if (roots.length > 0) {
      // At least one symbolic root: return the domain-filtered list and do NOT
      // enumerate. Undecidable membership (`undefined`) keeps the root.
      return roots.filter((r) =>
        keepInDomain(ce, domain, unknown, r, condition)
      );
    }
  }

  // 2. Enumeration fallback.
  const count = domain.count;
  if (count === undefined || !Number.isFinite(count)) return undefined;

  const predBody = numericBody ?? boolPred;
  if (predBody === null) return undefined;

  // Compile the predicate as a lambda `unknown ↦ predBody`. Only a genuine
  // compilation (`success`) enables the larger budget and the float sieve; the
  // interpreter fallback (`success: false`) uses the exact path directly.
  const fnLit = ce.function('Function', [predBody, ce.symbol(unknown)]);
  const compiled = ce._compile(fnLit);
  const useCompiled =
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

  const isEquation = numericBody !== null;
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
    if (!confirmExact(predBody, isEquation, unknown, item)) continue;

    // Optional condition (3rd `Element` operand): drop only on a definite
    // `False`, mirroring the symbolic membership filter.
    if (condition && conditionValue(condition, unknown, item) === false) continue;

    results.push(item);
  }
  return results;
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
  if (domain.contains(value) === false) return false;
  if (condition && conditionValue(condition, unknown, value) === false)
    return false;
  return true;
}

/**
 * Exact confirmation of a candidate value: substitute and evaluate with the
 * engine (not the compiled float). For an equation, the residual must be
 * exactly zero; for a boolean predicate, it must evaluate to `True`.
 */
function confirmExact(
  predBody: Expression,
  isEquation: boolean,
  unknown: string,
  value: Expression
): boolean {
  const v = predBody.subs({ [unknown]: value }).evaluate();
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

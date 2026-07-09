import type {
  Expression,
  IComputeEngine as ComputeEngine,
  RuleSteps,
} from '../global-types.js';
import { isSymbol } from './type-guards.js';
import {
  solveLinearSystem,
  solvePolynomialSystem,
  solveLinearInequalitySystem,
} from './solve-linear-system.js';
import { congruenceResidue } from './solve-congruence.js';
import { freshParameters } from './diophantine.js';
import { chineseRemainder, lcm } from '../numerics/numeric-bigint.js';

/** Solve a system of equations or inequalities given as an array of
 * expressions (from List or And). Returns null if no solution found.
 *
 * The optional `trace` accumulator is pure observation for
 * `expr.explain('solve')`: when present, the equality strategies record
 * their steps into a provisional local trace that is spliced into `trace`
 * only when that strategy produces the answer (failed strategies leave no
 * steps). The plain `solve()` path passes no accumulator and allocates
 * nothing. */
export function solveSystem(
  ce: ComputeEngine,
  equations: ReadonlyArray<Expression>,
  varNames: string[],
  trace?: RuleSteps
): null | Record<string, Expression> | Array<Record<string, Expression>> {
  if (equations && equations.every((eq) => eq.operator === 'Equal')) {
    // Try linear system first
    const linTrace: RuleSteps | undefined = trace ? [] : undefined;
    const linearResult = solveLinearSystem([...equations], varNames, linTrace);
    if (linearResult && filterSolutionByTypes(ce, varNames, linearResult)) {
      if (trace && linTrace) trace.push(...linTrace);
      return linearResult;
    }

    // Try polynomial system (non-linear)
    const polyTrace: RuleSteps | undefined = trace ? [] : undefined;
    const polyResult = solvePolynomialSystem(
      [...equations],
      varNames,
      polyTrace
    );
    if (polyResult) {
      const filtered = polyResult.filter((s) =>
        filterSolutionByTypes(ce, varNames, s)
      );
      if (filtered.length > 0) {
        if (trace && polyTrace) trace.push(...polyTrace);
        return filtered;
      }
    }
  }

  // System of simultaneous linear congruences in a single unknown, combined
  // via the Chinese Remainder Theorem (moduli need not be coprime). Each
  // congruence must reduce to a single residue class `x ≡ rᵢ (mod mᵢ)`; the
  // merged solution is `x ≡ x₀ (mod lcm(mᵢ))`, emitted as a parametric family
  // `x₀ + M·t`. Any congruence that declines falls through to the paths below.
  if (
    equations &&
    varNames.length === 1 &&
    equations.length > 0 &&
    equations.every((eq) => eq.operator === 'Congruent')
  ) {
    const residues: bigint[] = [];
    const moduli: bigint[] = [];
    let declined = false;
    for (const eq of equations) {
      const res = congruenceResidue(eq, varNames[0]);
      if (res === undefined) {
        declined = true;
        break;
      }
      if (res === 'none') return null; // a congruence with no solution
      residues.push(res.r);
      moduli.push(res.m);
    }
    if (!declined) {
      const combined = chineseRemainder(residues, moduli);
      if (combined === null) return null; // inconsistent system
      let M = 1n;
      for (const mm of moduli) M = lcm(M, mm);
      const container = ce.function('List', [...equations]);
      const t = freshParameters(ce, container, 1)[0];
      const root =
        M === 1n
          ? t
          : ce.function('Add', [
              ce.number(combined),
              ce.function('Multiply', [ce.number(M), t]),
            ]);
      return { [varNames[0]]: root };
    }
  }

  // Check for inequality systems (Less, LessEqual, Greater, GreaterEqual)
  const inequalityOps = ['Less', 'LessEqual', 'Greater', 'GreaterEqual'];
  if (
    equations &&
    equations.every((eq) => inequalityOps.includes(eq.operator ?? ''))
  ) {
    const inequalityResult = solveLinearInequalitySystem(
      [...equations],
      varNames
    );
    if (inequalityResult) {
      const filtered = inequalityResult.filter((s) =>
        filterSolutionByTypes(ce, varNames, s)
      );
      if (filtered.length > 0) return filtered;
    }
  }

  // Mixed equality + inequality system
  if (equations) {
    const equalities = equations.filter((eq) => eq.operator === 'Equal');
    const inequalities = equations.filter((eq) =>
      inequalityOps.includes(eq.operator ?? '')
    );

    // Only handle if all equations are equalities or inequalities (no unknowns)
    if (
      equalities.length > 0 &&
      inequalities.length > 0 &&
      equalities.length + inequalities.length === equations.length
    ) {
      // Solve equalities first
      const linearResult = solveLinearSystem([...equalities], varNames);
      if (linearResult) {
        // Single parametric solution — check against inequalities
        if (satisfiesInequalities(linearResult, inequalities))
          return filterSolutionByTypes(ce, varNames, linearResult)
            ? linearResult
            : null;
      }

      // Try polynomial system
      const polyResult = solvePolynomialSystem([...equalities], varNames);
      if (polyResult) {
        const filtered = polyResult.filter(
          (s) =>
            satisfiesInequalities(s, inequalities) &&
            filterSolutionByTypes(ce, varNames, s)
        );
        if (filtered.length > 0) return filtered;
      }
    }
  }

  return null;
}

/** Check whether a solution record satisfies all inequality constraints.
 * Substitutes the solution into each inequality and evaluates. */
function satisfiesInequalities(
  solution: Record<string, Expression>,
  inequalities: ReadonlyArray<Expression>
): boolean {
  return inequalities.every((ineq) => {
    const substituted = ineq.subs(solution, { canonical: true }).evaluate();
    return isSymbol(substituted, 'True');
  });
}

/** Solve an Or expression by solving each operand independently and merging
 * results. For univariate: collects Expression[], deduplicates via JSON.
 * For multivariate: collects Record[], deduplicates similarly. */
export function solveOr(
  operands: ReadonlyArray<Expression>,
  varNames: string[]
): null | ReadonlyArray<Expression> | Array<Record<string, Expression>> {
  if (varNames.length === 1) {
    // Univariate: collect all roots, deduplicate
    const seen = new Set<string>();
    const results: Expression[] = [];
    for (const op of operands) {
      const sol = op.solve(varNames) as ReadonlyArray<Expression> | null;
      if (!sol || !Array.isArray(sol)) continue;
      for (const s of sol) {
        const key = JSON.stringify(s.json);
        if (!seen.has(key)) {
          seen.add(key);
          results.push(s);
        }
      }
    }
    return results.length > 0 ? results : null;
  }

  // Multivariate: collect Record solutions, deduplicate
  const seen = new Set<string>();
  const results: Array<Record<string, Expression>> = [];
  for (const op of operands) {
    const sol = op.solve(varNames);
    if (!sol) continue;
    // Single Record result
    if (!Array.isArray(sol)) {
      const rec = sol as Record<string, Expression>;
      const key = JSON.stringify(
        Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, v.json]))
      );
      if (!seen.has(key)) {
        seen.add(key);
        results.push(rec);
      }
      continue;
    }
    // Array of Records
    for (const s of sol as Array<Record<string, Expression>>) {
      const key = JSON.stringify(
        Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.json]))
      );
      if (!seen.has(key)) {
        seen.add(key);
        results.push(s);
      }
    }
  }
  return results.length > 0 ? results : null;
}

/** Filter a multivariate solution by the declared types of the variables.
 * Returns true if the solution satisfies all type constraints.
 * Uses `=== false` instead of `!== true` so that symbolic/parametric
 * solutions (where type predicates return `undefined`) pass through. */
export function filterSolutionByTypes(
  ce: ComputeEngine,
  variables: string[],
  solution: Record<string, Expression>
): boolean {
  for (const v of variables) {
    const varTypeObj = ce.symbol(v).type;
    const vt = varTypeObj.type;
    if (typeof vt !== 'string' || vt === 'number' || vt === 'unknown') continue;
    const val = solution[v]?.evaluate();
    if (!val) continue;
    if (varTypeObj.matches('integer') && val.isInteger === false) return false;
    if (varTypeObj.matches('rational') && val.isRational === false)
      return false;
    if (varTypeObj.matches('real') && val.isReal === false) return false;
  }
  return true;
}

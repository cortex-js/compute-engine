// Leaf types for the analytic function-properties store. Kept free of any
// import from `types-engine.ts` so that `IComputeEngine` can reference
// `FunctionProperties` (for `ce.functionProperties()`) without creating a
// type-layer cycle.

import type { Expression, ExpressionInput } from '../types-expression.js';

/** A single analytic-property record for an operator. The MathJSON fields are
 * raw (as translated from Fungrim); box them with `ce.expr` to query. */
export interface FunctionPropertyRecord {
  /** The Fungrim entry id (provenance). */
  readonly id: string;
  /** One of `Poles`, `Zeros`, `BranchPoints`, `BranchCuts`, `Residue`,
   * `EssentialSingularities`, `IsHolomorphic`, `IsMeromorphic`,
   * `AnalyticContinuation`, `Solutions`, `ComplexZeroMultiplicity`. */
  readonly property: string;
  /** The distinguished variable the property is stated in (e.g. `z`). */
  readonly var: string | null;
  /** Index of `var` among the operator's arguments, or null when there is no
   * single argument position (parametric / composite). */
  readonly argIndex: number | null;
  readonly expr: ExpressionInput | null;
  readonly domain: ExpressionInput | null;
  readonly point: ExpressionInput | null;
  readonly condition: ExpressionInput | null;
  readonly value: ExpressionInput | null;
  readonly assumptions: ExpressionInput | null;
}

/** Queryable analytic properties of an operator, returned by
 * `ce.functionProperties(name)`. The set-valued accessors return a boxed set
 * (e.g. `NonPositiveIntegers`) for the unconditional record of that kind, or
 * `undefined` when no such record exists. Parametric / conditional records
 * (e.g. residues that depend on parameters) are available via `entries`. */
export interface FunctionProperties {
  readonly operator: string;
  /** All analytic-property records for this operator. */
  readonly entries: readonly FunctionPropertyRecord[];
  readonly poles: Expression | undefined;
  readonly zeros: Expression | undefined;
  readonly branchPoints: Expression | undefined;
  readonly branchCuts: Expression | undefined;
  readonly essentialSingularities: Expression | undefined;
  /** The domain on which the function is holomorphic. */
  readonly holomorphicDomain: Expression | undefined;
  /** Whether the function is meromorphic, when the corpus records it. */
  readonly isMeromorphic: boolean | undefined;
}

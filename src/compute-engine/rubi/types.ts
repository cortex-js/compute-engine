// Shared data types for the Rubi integration rule driver. These describe the
// translated-corpus shape produced by the build-time tooling in
// `scripts/rubi/` (the WL parser + rule extractor) and consumed at runtime by
// the compiler/driver here. They live in `src` so the shippable runtime does
// not depend on `scripts/`; the tooling imports them back from here.

import type {
  Expression as BoxedExpression,
  FunctionInterface,
  SymbolInterface,
  NumberLiteralInterface,
} from '../types-expression.js';

/** A boxed expression with the function/symbol/number member interfaces folded
 * in as optional. The base `Expression` exposes `.operator` but keeps `.ops`,
 * `.op1`, `.symbol`, `.re`, … behind `isFunction`/`isSymbol`/`isNumber`
 * narrowing; the rubi driver reads them structurally (guarding with `if (!x.ops)`
 * etc.), so it operates on this widened view rather than narrowing at every
 * site. `.ops`/`.op1`/`.op2`/`.op3` are retyped to `Expr` so the widening
 * carries recursively through the operand tree. Assignable to and from the base
 * `Expression` (the extra members are optional). */
export type Expr = BoxedExpression &
  Partial<Omit<FunctionInterface, 'ops' | 'op1' | 'op2' | 'op3'>> &
  Partial<SymbolInterface> &
  Partial<NumberLiteralInterface> & {
    readonly ops?: ReadonlyArray<Expr>;
    readonly op1?: Expr;
    readonly op2?: Expr;
    readonly op3?: Expr;
  };

/** A MathJSON-like value as emitted by the WL → MathJSON translator: a number,
 * a symbol/string, or a function as `[head, ...args]`. */
export type Json = number | string | Json[];

/** A single translated Rubi rule (one integration rule from the corpus). */
export type RubiRule = {
  /** 1-based position among the live rules of the file (= priority) */
  index: number;
  /** integrand pattern (first argument of `Int`), with Blank/BlankOptional nodes */
  lhs: Json;
  /** name of the integration variable (from `x_Symbol`) */
  variable: string;
  /** rule body, with conditions and local bindings stripped */
  rhs: Json;
  /** outer `/;` condition (over pattern variables), or null */
  condition: Json | null;
  /** With/Module local bindings, in order; value null for bare Module locals */
  bindings: { name: string; value: Json | null }[];
  scoped: 'with' | 'module' | null;
  /** `/;` condition inside the With/Module scope (may reference bindings) */
  innerCondition: Json | null;
  /** Original WL cell text. Optional: kept by the build-time tooling (used by
   * the benchmark/triage `RUBI_DEBUG_FIRE` traces) but stripped from the
   * shipped bundle, where it is runtime-dead. */
  source?: string;
};

/** One corpus file's worth of translated rules (the unit the compiler
 * consumes; the bundled corpus is an ordered array of these). */
export type RubiRuleDoc = {
  file: string;
  rules: RubiRule[];
};

import type {
  Expression,
  OperatorDefinition,
  ValueDefinition,
  IComputeEngine as ComputeEngine,
  BoxedDefinition,
  TaggedValueDefinition,
  TaggedOperatorDefinition,
  BoxedOperatorDefinition,
  BoxedValueDefinition,
  DictionaryInterface,
} from '../global-types.js';

import { MACHINE_PRECISION } from '../numerics/numeric.js';
import { Type } from '../../common/type/types.js';
import { NumericValue } from '../numeric-value/types.js';
import { _BoxedOperatorDefinition } from './boxed-operator-definition.js';
import { _BoxedValueDefinition } from './boxed-value-definition.js';
import { _BoxedExpression } from './abstract-boxed-expression.js';
import { isNumber, isFunction, isSymbol, numericValue } from './type-guards.js';

/**
 * Check if an expression contains symbolic transcendental functions of constants
 * (like ln(2), sin(1), etc.) that should not be evaluated numerically.
 *
 * This excludes transcendentals that simplify to exact values, such as:
 * - ln(e) -> 1
 * - sin(0) -> 0
 * - cos(0) -> 1
 */
export function hasSymbolicTranscendental(expr: Expression): boolean {
  const op = expr.operator;
  // Transcendental functions applied to numeric constants
  const transcendentals = [
    'Ln',
    'Log',
    'Log2',
    'Log10',
    'Sin',
    'Cos',
    'Tan',
    'Exp',
  ];
  if (
    transcendentals.includes(op) &&
    isFunction(expr) &&
    expr.op1?.isConstant
  ) {
    // Check if this transcendental simplifies to an exact rational value
    // (e.g., ln(e) = 1, sin(0) = 0). If so, it's not truly a
    // "symbolic transcendental" that needs to be preserved.
    const simplified = expr.simplify();
    // If the simplified result is exact (integer or rational),
    // it doesn't need symbolic preservation
    if (simplified.isRational) {
      return false;
    }
    return true;
  }
  // Recursively check sub-expressions
  if (isFunction(expr)) {
    for (const child of expr.ops) {
      if (hasSymbolicTranscendental(child)) return true;
    }
  }
  return false;
}

export function isDictionary(expr: unknown): expr is DictionaryInterface {
  return (
    expr !== null &&
    expr !== undefined &&
    expr instanceof _BoxedExpression &&
    expr.type.matches('dictionary')
  );
}

export function isExpression(x: unknown): x is Expression {
  return x instanceof _BoxedExpression;
}

function isRecord(x: unknown): x is Record<PropertyKey, unknown> {
  return x !== null && typeof x === 'object';
}

function isIterable(x: unknown): x is Iterable<unknown> {
  return (
    x !== null &&
    x !== undefined &&
    typeof (x as { [Symbol.iterator]?: unknown })[Symbol.iterator] ===
      'function'
  );
}

/**
 * For any numeric result, if `bignumPreferred()` is true, calculate using
 * bignums. If `bignumPreferred()` is false, calculate using machine numbers
 */
export function bignumPreferred(ce: ComputeEngine): boolean {
  return ce.precision > MACHINE_PRECISION;
}

// export function getMeta(expr: Expression): Partial<Metadata> {
//   const result: Partial<Metadata> = {};
//   if (expr.verbatimLatex !== undefined) result.latex = expr.verbatimLatex;
//   if (expr.wikidata !== undefined) result.latex = expr.wikidata;
//   return result;
// }

export function hashCode(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++)
    hash = (Math.imul(31, hash) + s.charCodeAt(i)) | 0; // | 0 to convert to 32-bit int

  return Math.abs(hash);
}

/**
 * The default unknown/variable for an operator whose variable argument was
 * omitted (`Solve(eq)`, `D(expr)`, `PolynomialDegree(poly)`, …): the single
 * free variable of the expression(s), or `x` when there are several free
 * variables and one of them is `x`. `undefined` when no default can be
 * inferred (no free variable, or several free variables without `x`).
 *
 * Works on lazily-held (non-canonical) operands: `unknowns` resolves symbol
 * definitions by name, not through binding.
 */
export function defaultUnknown(
  ...exprs: ReadonlyArray<Expression>
): string | undefined {
  const names = new Set<string>();
  // The pipe topic placeholder `_` is never a valid unknown: in a deferred
  // pipeline stage (`\rhd Solve` → `Function(Solve(_), _)`) the operand IS
  // the placeholder at canonicalization time. Inferring it would bake `_`
  // into the unknown slot, so applying the stage computes
  // `Solve(expr, expr)` instead of `Solve(expr, x)`. Skipping it defers
  // inference until the topic value has been substituted.
  for (const e of exprs)
    for (const n of e.unknowns) if (n !== '_') names.add(n);
  if (names.size === 1) return names.values().next().value;
  if (names.size > 1 && names.has('x')) return 'x';
  return undefined;
}

/**
 * Operator heads whose evaluation is a pure expression-transformation step:
 * the result is an expression in the same free variables — no symbol-value
 * substitution, no relational collapse.
 *
 * A structural algorithm that *holds* its expression operand (`Solve`,
 * `Integrate`, `Limit`, …) should reduce such a head before running:
 * `Solve(Simplify(eq), x)` means "simplify, then solve", not "solve an
 * expression whose operator is `Simplify`" (which finds no roots). This is
 * how a multi-stage pipeline (`expr |> Simplify |> Solve`) reaches the
 * algorithm.
 *
 * Deliberately NOT included:
 * - `Evaluate` / `N`: they substitute assigned symbol values, which would
 *   replace the very unknown being solved for;
 * - relational/boolean heads: evaluating an `Equal` collapses it to a
 *   boolean before the solver sees it;
 * - `CanonicalForm`: taking `.canonical` already handles it.
 */
const TRANSFORMER_HEADS = new Set([
  'Simplify',
  'Expand',
  'ExpandAll',
  'Factor',
  'Together',
  'Distribute',
  'TrigExpand',
]);

/**
 * Reduce a held (already canonical) operand whose head is an
 * expression-transformer (see `TRANSFORMER_HEADS`) so that a structural
 * algorithm sees the transformed expression rather than the transformer
 * call. Any other expression is returned unchanged.
 */
export function reduceTransformerHead(expr: Expression): Expression {
  if (!TRANSFORMER_HEADS.has(expr.operator)) return expr;
  return expr.evaluate();
}

export function normalizedUnknownsForSolve(
  syms:
    | string
    | Iterable<string>
    | Expression
    | Iterable<Expression>
    | null
    | undefined
): string[] {
  if (syms === null || syms === undefined) return [];
  if (typeof syms === 'string') return [syms];
  if (isExpression(syms))
    return normalizedUnknownsForSolve(isSymbol(syms) ? syms.symbol : undefined);
  if (isIterable(syms)) {
    const result: string[] = [];
    for (const s of syms) {
      if (typeof s === 'string') result.push(s);
      else if (isExpression(s) && isSymbol(s)) result.push(s.symbol);
      else result.push('');
    }
    return result;
  }
  return [];
}

/** Return the local variables in the expression.
 *
 * A local variable is a symbol that is declared with a `Declare`
 * expression in a `Block` expression.
 *
 */
export function getLocalVariables(expr: Expression): string[] {
  if (expr.localScope) return [...expr.localScope?.bindings.keys()];
  return [];
}

export function domainToType(expr: Expression): Type {
  if (!isSymbol(expr)) return 'unknown';
  // if (expr.symbol === 'Booleans') return 'boolean';
  // if (expr.symbol === 'Strings') return 'string';
  if (expr.symbol === 'Numbers') return 'number';
  if (expr.symbol === 'ComplexNumbers') return 'complex';
  if (expr.symbol === 'ImaginaryNumbers') return 'imaginary';
  if (expr.symbol === 'RealNumbers') return 'real';
  if (expr.symbol === 'RationalNumbers') return 'rational';
  if (expr.symbol === 'Integers') return 'integer';
  return 'unknown';
}

function angleToRadians(x: Expression | undefined): Expression | undefined {
  if (!x) return x;
  const ce = x.engine;
  const angularUnit = ce.angularUnit;
  if (angularUnit === 'rad') return x;

  if (angularUnit === 'deg') x = x.mul(ce.Pi).div(180);
  if (angularUnit === 'grad') x = x.mul(ce.Pi).div(200);
  if (angularUnit === 'turn') x = x.mul(ce.Pi).mul(2);
  return x;
}

/**
 * Return the angle in the range [0, 2π) that is equivalent to the given angle.
 *
 * @param x
 * @returns
 */
export function canonicalAngle(
  x: Expression | undefined
): Expression | undefined {
  if (!x) return x;
  const theta = angleToRadians(x);
  if (!theta) return undefined;

  if (theta.N().im !== 0) return theta;

  const ce = theta.engine;

  // Get k, t such that theta = k * π + t
  const [k, t] = getPiTerm(theta);

  if (k.isZero) return ce.number(t);

  const k2 = ce._numericValue(k.bignumRe ? k.bignumRe.mod(2) : k.re % 2);
  const piMulK2N = ce.Pi.mul(k2).N();
  return ce.number(t.add(numericValue(piMulK2N) ?? 0));
}

/**
 * Return a multiple of the imaginary unit, e.g.
 * - 'ImaginaryUnit'  -> 1
 * - ['Negate', 'ImaginaryUnit']  -> -1
 * - ['Negate', ['Multiply', 3, 'ImaginaryUnit']] -> -3
 * - ['Multiply', 5, 'ImaginaryUnit'] -> 5
 * - ['Multiply', 'ImaginaryUnit', 5] -> 5
 * - ['Divide', 'ImaginaryUnit', 2] -> 0.5
 *
 */
export function getImaginaryFactor(
  expr: number | Expression
): Expression | undefined {
  if (typeof expr === 'number') return undefined;
  const ce = expr.engine;
  if (isSymbol(expr, 'ImaginaryUnit')) return ce.One;

  if (expr.re === 0) return ce.number(expr.im!);

  if (isFunction(expr, 'Negate')) return getImaginaryFactor(expr.op1)?.neg();

  if (isFunction(expr, 'Complex')) {
    if (expr.op1.isSame(0) && !isNaN(expr.op2.re))
      return ce.number(expr.op2.re);
    return undefined;
  }

  if (isFunction(expr, 'Multiply') && expr.nops === 2) {
    const [op1, op2] = expr.ops;
    if (isSymbol(op1, 'ImaginaryUnit')) return op2;
    if (isSymbol(op2, 'ImaginaryUnit')) return op1;

    // c * (bi)
    if (isNumber(op2) && op2.re === 0 && op2.im !== 0) return op1.mul(op2.im!);

    // (bi) * c
    if (isNumber(op1) && op1.re === 0 && op1.im !== 0) return op2.mul(op1.im!);
  }

  if (isFunction(expr, 'Divide')) {
    const denom = expr.op2;
    if (denom.isSame(0)) return undefined;
    return getImaginaryFactor(expr.op1)?.div(denom);
  }

  return undefined;
}

/**
 * `true` if expr is a number with imaginary part 1 and real part 0, or a symbol with a definition
 * matching this. Does not bind expr if a symbol.
 *
 * @export
 * @param expr
 * @returns
 */
export function isImaginaryUnit(expr: Expression): boolean {
  const { engine } = expr;
  // Shortcut: boxed engine imaginary unit
  if (expr === engine.I) return true;

  if (isNumber(expr)) return expr.re === 0 && expr.im === 1;

  // !note: use 'isSame' instead of checking identity with 'I', to account for potential,
  // non-default definition of the imaginary unit
  if (isSymbol(expr)) return expr.canonical.isSame(engine.I);

  // function/string/...
  return false;
}

/*
 * Return k and t such that expr = k * pi + t.
 * If no pi factor is found, or k or t are not numeric values, return [0, 0].
 */
export function getPiTerm(
  expr: Expression
): [k: NumericValue, t: NumericValue] {
  const ce = expr.engine;
  if (isSymbol(expr, 'Pi')) return [ce._numericValue(1), ce._numericValue(0)];

  if (isFunction(expr, 'Negate')) {
    const [k, t] = getPiTerm(expr.ops[0]);
    return [k.neg(), t.neg()];
  }

  if (isFunction(expr, 'Add') && expr.nops === 2) {
    const [k1, t1] = getPiTerm(expr.op1);
    const [k2, t2] = getPiTerm(expr.op2);
    return [k1.add(k2), t1.add(t2)];
  }

  if (isFunction(expr, 'Multiply') && expr.nops === 2) {
    if (isNumber(expr.op1)) {
      const [k, t] = getPiTerm(expr.op2);
      const n = expr.op1.numericValue;
      return [k.mul(n), t.mul(n)];
    }
    if (isNumber(expr.op2)) {
      const [k, t] = getPiTerm(expr.op1);
      const n = expr.op2.numericValue;
      return [k.mul(n), t.mul(n)];
    }
  }

  if (isFunction(expr, 'Divide')) {
    if (isNumber(expr.op2)) {
      const [k1, t1] = getPiTerm(expr.op1);
      const d = expr.op2.numericValue;
      return [k1.div(d), t1.div(d)];
    }
  }

  const nVal = expr.N();
  return [ce._numericValue(0), ce._numericValue(numericValue(nVal) ?? 0)];
}

export function isValidOperatorDef(
  def: unknown
): def is Partial<OperatorDefinition> {
  if (!isRecord(def)) return false;
  if (isExpression(def)) return false;
  if ('signature' in def || 'complexity' in def) {
    if ('constant' in def) {
      throw new Error(
        'Operator definition cannot have a `constant` field and value definition cannot have a `signature` field.'
      );
    }
  }
  if (
    !('evaluate' in def) &&
    !('signature' in def) &&
    !('sgn' in def) &&
    !('complexity' in def) &&
    !('canonical' in def)
  )
    return false;

  if (
    'type' in def &&
    def.type !== undefined &&
    typeof def.type !== 'function'
  ) {
    throw new Error(
      'The `type` field of an operator definition should be a function'
    );
  }
  if ('sgn' in def && def.sgn !== undefined && typeof def.sgn !== 'function') {
    throw new Error(
      'The `sgn` field of an operator definition should be a function'
    );
  }
  return true;
}

export function isValidValueDef(def: unknown): def is Partial<ValueDefinition> {
  if (!isRecord(def)) return false;

  if (isExpression(def)) return false;

  if (
    'value' in def ||
    'constant' in def ||
    'inferred' in def ||
    'subscriptEvaluate' in def
  ) {
    // If the `type` field is a function, it's an operator definition
    if ('type' in def && typeof def.type === 'function') return false;

    if ('signature' in def) {
      throw new Error(
        'Value definition cannot have a `signature` field. Use a `type` field instead.'
      );
    }

    if ('sgn' in def) {
      throw new Error(
        'Value definition cannot have a `sgn` field. Use a `flags.sgn` field instead.'
      );
    }

    return true;
  }

  if (
    'type' in def &&
    def.type !== undefined &&
    typeof def.type !== 'function'
  ) {
    return true;
  }

  if ('description' in def) {
    // A def that carries operator-shaped fields (e.g. a spread of an existing
    // boxed operator definition, `{ ...ce.lookupDefinition('At').operator }`)
    // is not a value definition — let the operator classifier claim it rather
    // than throwing on the missing `type`/`value` field. A bare
    // `{ description }` (no operator-shaped fields) still gets the helpful error.
    if (
      'evaluate' in def ||
      'signature' in def ||
      'canonical' in def ||
      'complexity' in def ||
      ('type' in def && typeof (def as { type: unknown }).type === 'function')
    )
      return false;
    throw new Error('Definitions should have a `type` or `value` field.');
  }

  return false;
}

export function isValueDef(
  def: BoxedDefinition | undefined
): def is TaggedValueDefinition {
  return def !== undefined && 'value' in def;
}

export function isOperatorDef(
  def: BoxedDefinition | undefined
): def is TaggedOperatorDefinition {
  return def !== undefined && 'operator' in def;
}

export function updateDef(
  ce: ComputeEngine,
  name: string,
  def: BoxedDefinition,
  newDef:
    | Partial<OperatorDefinition>
    | BoxedOperatorDefinition
    | Partial<ValueDefinition>
    | BoxedValueDefinition
): void {
  const mutableDef = def as {
    value?: BoxedValueDefinition;
    operator?: BoxedOperatorDefinition;
  };

  if (newDef instanceof _BoxedValueDefinition) {
    delete mutableDef.operator;
    mutableDef.value = newDef;
  } else if (isValidValueDef(newDef)) {
    delete mutableDef.operator;
    mutableDef.value = new _BoxedValueDefinition(ce, name, newDef);
  } else if (newDef instanceof _BoxedOperatorDefinition) {
    delete mutableDef.value;
    mutableDef.operator = newDef;
  } else if (isValidOperatorDef(newDef)) {
    delete mutableDef.value;
    mutableDef.operator = new _BoxedOperatorDefinition(ce, name, newDef);
  }
}

export function placeholderDef(
  ce: ComputeEngine,
  name: string
): BoxedDefinition {
  return {
    value: new _BoxedValueDefinition(ce, name, { type: 'function' }),
  };
}

import type {
  Expression,
  ExpressionInput,
  IComputeEngine as ComputeEngine,
  Metadata,
  Scope,
} from '../global-types.js';
import type { MathJsonExpression } from '../../math-json/types.js';
import { operands, operator } from '../../math-json/utils.js';
import { canonicalAdd } from './arithmetic-add.js';
import { canonicalMultiply, canonicalDivide } from './arithmetic-mul-div.js';
import { canonicalPower, canonicalRoot } from './arithmetic-power.js';
import { canonicalNegate } from './negate.js';
import { checkArity, checkNumericArgs } from './validate.js';
import { isExpression, isFunction, isNumber } from './type-guards.js';
import { registerNumericCanonicalHandler } from './numeric-canonical-registry.js';
import { readJuxtaposition } from './invisible-operator.js';
import { productMayHaveMatrix } from './matrix-operand.js';
import { shadowsLibraryName } from '../library-shadowing.js';
import { logOperandMayThread } from './logarithm.js';

/**
 * The operators whose canonical form `canonicalNumericOperator` computes.
 * `makeNumericFunction` (`box.ts`) calls it by name for these operators
 * without looking up their definition, and each of their library definitions
 * has a `canonical` handler that calls it too (`numericCanonicalHandler`).
 */
export const NUMERIC_CANONICAL_NAMES: ReadonlySet<string> = new Set([
  'Add',
  'Multiply',
  'Negate',
  'Square',
  'Sqrt',
  'Exp',
  'Ln',
  'Log',
  'Power',
  'Root',
  'Divide',
]);

/**
 * The canonical operands of a product whose operands `ops` are not canonical
 * yet, with the factors of each nested product put in its place:
 * `['Multiply', 'A', ['Multiply', g(x), k(x), g(x)]]` gives the operands
 * `A, g(x), k(x), g(x)`. Return `undefined` when no operand is a nested
 * product: the caller then makes the operands canonical as usual.
 *
 * A nested product is a raw `Multiply`, a juxtaposition that is a product
 * (`A\cdot(g(x)k(x))`, a raw `InvisibleOperator`, read by
 * `readJuxtaposition()` in `invisible-operator.ts`), the negation of a
 * nested product (`-(g(x)k(x))`, spliced as the factor `-1` and the factors
 * of the product), or the quotient of a nested product by an integer literal
 * (`(g(x)k(x))/2`, spliced with the factor `1/2`). Each may be in
 * parentheses (a `Delimiter` with one operand).
 *
 * The factors are put in place BEFORE they are sorted. A nested product
 * that is made canonical on its own is sorted when it has no matrix, and
 * this loses the written order of factors that can be matrices: with `A` a
 * matrix and `g`, `k` functions that were not declared, the nested product
 * `g(x)·k(x)·g(x)` became `k(x)·g(x)·g(x)` before the outer product saw the
 * matrix. After the splice, the outer product sorts all the factors at once
 * (`sortProductOperands()` in `order.ts`), so it keeps the order of the
 * factors that can be matrices. The matrix product is associative, so the
 * splice does not change the value.
 *
 * The splice is done only when the product can have a matrix factor
 * (`productMayHaveMatrix()`). Otherwise each nested product is made
 * canonical on its own, as before.
 *
 * A canonical or structural nested product is not changed: its operands
 * already have their final order. Nothing is spliced in a product that holds
 * an ellipsis (`ContinuationPlaceholder`) anywhere: the operands of such a
 * product are fold barriers (see `isFoldBarrierProduct()` in
 * `type-guards.ts`). A nested `Negate`, `Divide`, `Delimiter` or
 * `InvisibleOperator` is not read when the library definition of that
 * operator is replaced (`shadowsLibraryName()`).
 */
export function canonicalProductOperands(
  ce: ComputeEngine,
  ops: ReadonlyArray<ExpressionInput | Expression>,
  scope: Scope | undefined
): ReadonlyArray<Expression> | undefined {
  if (!ops.some(mayBeNestedProduct)) return undefined;
  // A product with an ellipsis (`2·4·…·2n`) is not changed: the operands on
  // each side of the ellipsis are read as the terms of a pattern, so a
  // nested product such as `2n` must stay one operand.
  if (ops.some(mentionsEllipsis)) return undefined;
  const nodes = ops.map((x) => factorNode(ce, x, scope));
  const factors = nodes.flatMap((node) => spliceList(ce, node, scope));
  if (productMayHaveMatrix(factors)) return factors;
  return nodes.map((node) => nodeCanonical(ce, node, scope));
}

/**
 * An operand of a product, read before the product is made canonical (see
 * `canonicalProductOperands()`). The canonical form of a `leaf` is computed
 * once, when it is first needed, and kept in `value`.
 */
type FactorNode =
  | { kind: 'leaf'; input: ExpressionInput | Expression; value?: Expression }
  | { kind: 'product'; children: FactorNode[] }
  | {
      kind: 'juxtaposition';
      factors: ReadonlyArray<Expression>;
      value: Expression;
    }
  | { kind: 'negate'; child: FactorNode }
  | { kind: 'divide'; child: FactorNode; divisor: number };

/** The operator and the operands of `x` when it is a function expression
 * that is not canonical yet (MathJSON, or a raw boxed expression). */
function rawParts(
  x: ExpressionInput | Expression
):
  | { name: string; ops: ReadonlyArray<ExpressionInput | Expression> }
  | undefined {
  if (isExpression(x)) {
    if (x.isCanonical || x.isStructural || !isFunction(x)) return undefined;
    return { name: x.operator, ops: x.ops };
  }
  if (typeof x !== 'object' || x === null) return undefined;
  const name = operator(x as MathJsonExpression);
  if (name === '') return undefined;
  return { name, ops: operands(x as MathJsonExpression) };
}

const NESTED_PRODUCT_OPERATORS = new Set([
  'Multiply',
  'InvisibleOperator',
  'Negate',
  'Divide',
  'Delimiter',
]);

/** A quick test: can `x` be a nested product (see `nestedProductNode()`)? */
function mayBeNestedProduct(x: ExpressionInput | Expression): boolean {
  const parts = rawParts(x);
  return parts !== undefined && NESTED_PRODUCT_OPERATORS.has(parts.name);
}

function factorNode(
  ce: ComputeEngine,
  x: ExpressionInput | Expression,
  scope: Scope | undefined
): FactorNode {
  return nestedProductNode(ce, x, scope) ?? { kind: 'leaf', input: x };
}

/**
 * The node of `x` when it is a nested product (see
 * `canonicalProductOperands()`), or a juxtaposition that is read as
 * something else (then a `leaf` with its canonical form). Otherwise,
 * `undefined`.
 */
function nestedProductNode(
  ce: ComputeEngine,
  x: ExpressionInput | Expression,
  scope: Scope | undefined
): FactorNode | undefined {
  let parts = rawParts(x);
  if (parts?.name === 'Delimiter' && parts.ops.length === 1) {
    if (shadowsLibraryName(ce, 'Delimiter')) return undefined;
    parts = rawParts(parts.ops[0]);
  }
  if (parts === undefined) return undefined;
  if (parts.name === 'Multiply')
    return {
      kind: 'product',
      children: parts.ops.map((op) => factorNode(ce, op, scope)),
    };
  if (parts.name === 'InvisibleOperator') {
    const reading = readJuxtaposition(
      ce,
      isExpression(x) ? x : ce.expr(x, { form: 'raw', scope })
    );
    if (reading === undefined) return undefined;
    if (reading.factors === undefined)
      return { kind: 'leaf', input: x, value: reading.canonical };
    return {
      kind: 'juxtaposition',
      factors: reading.factors,
      value: reading.canonical,
    };
  }
  if (
    parts.name === 'Negate' &&
    parts.ops.length === 1 &&
    !shadowsLibraryName(ce, 'Negate')
  ) {
    const child = nestedProductNode(ce, parts.ops[0], scope);
    if (child === undefined) return undefined;
    if (child.kind === 'leaf')
      return {
        kind: 'leaf',
        input: x,
        value: canonicalOperation(ce, 'Negate', [
          nodeCanonical(ce, child, scope),
        ]),
      };
    return { kind: 'negate', child };
  }
  if (
    parts.name === 'Divide' &&
    parts.ops.length === 2 &&
    !shadowsLibraryName(ce, 'Divide')
  ) {
    const divisor = integerLiteral(parts.ops[1]);
    if (divisor === undefined) return undefined;
    const child = nestedProductNode(ce, parts.ops[0], scope);
    if (child === undefined) return undefined;
    if (child.kind === 'leaf')
      return {
        kind: 'leaf',
        input: x,
        value: canonicalOperation(ce, 'Divide', [
          nodeCanonical(ce, child, scope),
          ce.number(divisor),
        ]),
      };
    return { kind: 'divide', child, divisor };
  }
  return undefined;
}

/** The value of `x` when it is an exact integer literal other than 0. */
function integerLiteral(x: ExpressionInput | Expression): number | undefined {
  if (isExpression(x)) {
    if (!isNumber(x) || !x.isExact || x.isInteger !== true) return undefined;
    const n = x.re;
    return Number.isSafeInteger(n) && n !== 0 ? n : undefined;
  }
  return typeof x === 'number' && Number.isSafeInteger(x) && x !== 0
    ? x
    : undefined;
}

/** The canonical factors of `node`, with each nested product spliced. */
function spliceList(
  ce: ComputeEngine,
  node: FactorNode,
  scope: Scope | undefined
): Expression[] {
  switch (node.kind) {
    case 'leaf':
      return [leafValue(ce, node, scope)];
    case 'product':
      return node.children.flatMap((child) => spliceList(ce, child, scope));
    case 'juxtaposition':
      return [...node.factors];
    case 'negate':
      return [ce.NegativeOne, ...spliceList(ce, node.child, scope)];
    case 'divide':
      return [
        ...spliceList(ce, node.child, scope),
        ce.number([1, node.divisor]),
      ];
  }
}

/** The canonical form of `node`: a nested product is spliced only when it
 * can have a matrix factor, as `canonicalProductOperands()` does. */
function nodeCanonical(
  ce: ComputeEngine,
  node: FactorNode,
  scope: Scope | undefined
): Expression {
  switch (node.kind) {
    case 'leaf':
      return leafValue(ce, node, scope);
    case 'juxtaposition':
      return node.value;
    case 'product': {
      const factors = spliceList(ce, node, scope);
      return canonicalOperation(
        ce,
        'Multiply',
        productMayHaveMatrix(factors)
          ? factors
          : node.children.map((child) => nodeCanonical(ce, child, scope))
      );
    }
    case 'negate':
      return canonicalOperation(ce, 'Negate', [
        nodeCanonical(ce, node.child, scope),
      ]);
    case 'divide':
      return canonicalOperation(ce, 'Divide', [
        nodeCanonical(ce, node.child, scope),
        ce.number(node.divisor),
      ]);
  }
}

function leafValue(
  ce: ComputeEngine,
  node: { input: ExpressionInput | Expression; value?: Expression },
  scope: Scope | undefined
): Expression {
  return (node.value ??= ce.expr(node.input, { scope }));
}

/** The canonical form of `name` applied to the canonical operands `ops`. */
function canonicalOperation(
  ce: ComputeEngine,
  name: string,
  ops: ReadonlyArray<Expression>
): Expression {
  return canonicalNumericOperator(ce, name, ops) ?? ce.function(name, [...ops]);
}

/** True when the symbol `ContinuationPlaceholder` (an ellipsis) appears
 * anywhere in `x`. */
function mentionsEllipsis(x: ExpressionInput | Expression): boolean {
  if (isExpression(x)) return x.has('ContinuationPlaceholder');
  if (typeof x !== 'string' && (typeof x !== 'object' || x === null))
    return false;
  return mentionsSymbol(x as MathJsonExpression, 'ContinuationPlaceholder');
}

/** True when the symbol `name` appears anywhere in the MathJSON `expr`. */
function mentionsSymbol(expr: MathJsonExpression, name: string): boolean {
  if (typeof expr === 'string') return expr === name;
  if (typeof expr !== 'object' || expr === null) return false;
  if (Array.isArray(expr)) return expr.some((x) => mentionsSymbol(x, name));
  if ('sym' in expr) return expr.sym === name;
  if ('fn' in expr) return expr.fn.some((x) => mentionsSymbol(x, name));
  return false;
}

/**
 * The canonical form of the arithmetic operator `name` applied to `ops`,
 * which must already be canonical.
 *
 * Returns `null` when `name` is not one of `NUMERIC_CANONICAL_NAMES`, and
 * when an operand is a `Spread` (`Add(...t)`): the arity checks and the
 * folding below assume the final positional operands, which exist only when
 * the spread splices at evaluation.
 *
 * The operands are checked as numeric (`checkNumericArgs`); an invalid
 * operand gives a canonical, invalid expression with the operator `name`.
 */
export function canonicalNumericOperator(
  ce: ComputeEngine,
  name: string,
  canonicalOps: ReadonlyArray<Expression>,
  metadata?: Metadata
): Expression | null {
  let ops: ReadonlyArray<Expression> = [];
  if (name === 'Add' || name === 'Multiply')
    ops = checkNumericArgs(ce, canonicalOps, { flatten: name });
  else if (
    name === 'Negate' ||
    name === 'Square' ||
    name === 'Sqrt' ||
    name === 'Exp'
  )
    ops = checkNumericArgs(ce, canonicalOps, 1);
  else if (name === 'Ln' || name === 'Log') {
    ops = checkNumericArgs(ce, canonicalOps);
    if (ops.length === 0) ops = [ce.error('missing')];
    // The base is optional, so `Ln` and `Log` take one or two operands
    // (`Ln(a, b)` is `Log(a, b)`). An operand after the base is an
    // `unexpected-argument` error in strict mode. In non-strict mode it is
    // kept: the non-strict `checkNumericArgs` does not check for extra
    // operands, and the aliases `Lb` and `Lg` keep theirs too (`Lb(8, 3)`
    // is `Log(8, 2, 3)`). Evaluation reads only the first two operands.
    else if (ops.length > 2 && ce.strict) ops = checkArity(ce, ops, 2);
  } else if (name === 'Power' || name === 'Root')
    ops = checkNumericArgs(ce, canonicalOps, 2);
  else if (name === 'Divide') {
    // Note: Divide can have more than one argument, i.e.
    // Divide(a, b, c) = a / b / c
    // But it needs at least two arguments
    ops = checkNumericArgs(ce, canonicalOps);
    if (ops.length === 0) ops = [ce.error('missing'), ce.error('missing')];
    if (ops.length === 1) ops = [ops[0], ce.error('missing')];
  } else return null;

  // A `Spread` operand (`Add(...t)`) defers the whole numeric route to the
  // generic operator route: the canonical constructors below (the
  // single-operand `Add`/`Multiply` unwrap, eager folding) and the arity
  // padding above assume the FINAL positional operands, which only exist
  // once the spread splices at evaluation (step 0 of the evaluate path).
  if (ops.some((x) => x.operator === 'Spread')) return null;

  // If some of the arguments are not valid, we're done
  // (note: the result is canonical, but not valid)
  if (!ops.every((x) => x.isValid))
    return ce._fn(name, ops, { metadata, canonical: true });

  if (name === 'Add') return canonicalAdd(ce, ops);
  if (name === 'Negate') return canonicalNegate(ops[0]);
  if (name === 'Multiply') return canonicalMultiply(ce, ops);
  if (name === 'Divide') {
    if (ops.length === 2)
      return canonicalDivide(...(ops as [Expression, Expression]));
    return ops.slice(1).reduce((a, b) => canonicalDivide(a, b), ops[0]);
  }
  if (name === 'Exp') return canonicalPower(ce.E, ops[0]);
  if (name === 'Square') return canonicalPower(ops[0], ce.number(2));
  if (name === 'Power') return canonicalPower(ops[0], ops[1]);
  if (name === 'Root') return canonicalRoot(ops[0], ops[1]);
  if (name === 'Sqrt') return canonicalRoot(ops[0], 2);

  // Ln or Log
  if (ops.length > 0) {
    // Ln(1) -> 0, Log(1) -> 0 — literal only: `.isSame(1)` follows symbol
    // value bindings, and a mutable symbol's transient value must not fold
    // into canonical structure (`Ln(x)` while `x` holds 1 stays `Ln(x)`).
    // Not for a literal base of 1 or NaN: `Log(1, 1)` is the quotient
    // `0/0 = NaN` and `Log(1, NaN)` propagates the NaN — both are the
    // evaluate route's answers (`logarithmAtExceptionalPoint`). A
    // SYMBOLIC scalar base does fold: `Log(1, b) = 0` is the generic-point
    // convention, the same one that folds `1^x` to 1 without assuming
    // the exceptional exponent — the value `b` may later take is not
    // assumed to be 1.
    const base = ops[1];
    const baseIsOneOrNaN =
      base !== undefined && isNumber(base) && (base.isSame(1) || base.isNaN);
    // Only an EXACT `1` with an exact or symbolic base folds: `Ln(1.0)`
    // and `Log(1, 2.0)` stay, and evaluate to the float `0`, as a float
    // operand gives a float result.
    const baseIsFloat = base !== undefined && isNumber(base) && !base.isExact;
    // A base that could be a collection threads element-wise at evaluation,
    // so the fold is withheld: `Log(1, [-10, e, 27])` is `[0, 0, 0]`, not
    // the scalar `0`. This includes a union such as `real | list<real>`,
    // since the base may hold a list when the expression is evaluated.
    const baseIsCollection = base !== undefined && logOperandMayThread(base);
    if (
      isNumber(ops[0]) &&
      ops[0].isExact &&
      ops[0].isSame(1) &&
      !baseIsOneOrNaN &&
      !baseIsFloat &&
      !baseIsCollection
    )
      return ce.Zero;
    // Ln(a) -> Ln(a), Log(a) -> Log(a)
    if (ops.length === 1)
      return ce._fn(name, ops, { metadata, canonical: true });
  }
  // Ln(a,b) -> Log(a, b)
  return ce._fn('Log', ops, { metadata, canonical: true });
}

/**
 * The `canonical` handler of the library definition of the arithmetic
 * operator `name` (one of `NUMERIC_CANONICAL_NAMES`).
 *
 * Boxing does not call it for the library definition itself:
 * `makeNumericFunction` (`box.ts`) computes the same canonical form by name,
 * which avoids the definition lookup. The handler exists so that a copy of
 * the definition (`ce.declare('Sqrt', { ...ce.lookupDefinition('Sqrt')
 * .operator, evaluate })`) takes the canonical form along with it. The
 * handler is registered (`numeric-canonical-registry.ts`), and
 * `makeNumericFunction` uses its by-name route for a definition that holds
 * it, so a copy that changes no field gives the same results as the library
 * operator.
 *
 * When the generic route does call it (a named-argument call, a `Spread`
 * operand): the operands of the lazy `Add` and `Multiply` arrive as they were
 * written, not canonical, so the handler makes them canonical first. With a
 * `Spread` operand the handler keeps the operands as they arrived, as the
 * generic route did before these definitions had a handler.
 */
export function numericCanonicalHandler(
  name: string
): (
  ops: ReadonlyArray<Expression>,
  options: { engine: ComputeEngine; scope: Scope | undefined }
) => Expression | null {
  return registerNumericCanonicalHandler(name, (ops, { engine, scope }) => {
    const spliced =
      name === 'Multiply'
        ? canonicalProductOperands(engine, ops, scope)
        : undefined;
    const xs =
      spliced ??
      (ops.every((x) => x.isCanonical)
        ? ops
        : ops.map((x) => (x.isCanonical ? x : engine.expr(x, { scope }))));
    return (
      canonicalNumericOperator(engine, name, xs) ??
      engine._fn(name, ops, { canonical: true, scope })
    );
  });
}

/**
 * The DISPATCH of the arithmetic of the value kinds
 * (`docs/plans/2026-10-26-value-kinds.md`, section 4.4): the step that asks
 * the hooks of the `arithmetic` field of the kind heads for the value of a
 * sum, a product, a negation, a quotient or a power whose operands hold kind
 * values, and for the value of a call at an APPLY SITE (`kindApply()`: an
 * operator such as `Sin` or `Mean` that admits a kind value through the
 * carrier of the kind). The comparisons are dispatched by `kind-compare.ts`,
 * which also holds the operand helpers that this module reads.
 *
 * The `Add`, `Multiply`, `Negate`, `Divide`, `Power`, `Sqrt` and `Root`
 * handlers of `library/arithmetic.ts` call it on their evaluated operands, and
 * the arithmetic methods of an expression (`.add()`, `.mul()`, `.div()`,
 * `.pow()`, `.inv()`, `.root()`, `.sqrt()`) call it through
 * `kindArithmetic()` on the operands they are given, which they do not
 * evaluate.
 *
 * A KIND among the operands is the arithmetic of the bound definition of the
 * head of an operand (`arithmeticOf()`, `value-kinds.ts`): a call of a head
 * that declares a value kind. The kinds are listed in the order of their
 * first occurrence among the operands, and the arithmetic object identifies a
 * kind (two heads that share one object are asked once).
 */

import type {
  ArithmeticContext,
  Expression,
  IComputeEngine as ComputeEngine,
  KindFold,
} from '../global-types.js';
import {
  isExpression,
  isFunction,
  isNumber,
  isString,
  nanOperandAnswer,
} from './type-guards.js';
import { holdsKindValue } from './residue-class.js';
import {
  kindOfValue,
  kindOperand,
  kindOperands,
  kindsAmong,
} from './kind-compare.js';

//
// The operands as written, under `simplify()`
//

/**
 * The operands as they were written before the simplification of a node,
 * by the operand that the simplification made, while `simplify()` evaluates
 * that node through the hooks of the kinds (`withOperandsWrittenBefore()`).
 * `undefined` at every other time.
 */
let operandsWrittenBefore: ReadonlyMap<Expression, Expression> | undefined;

/**
 * Run `fn` with `pairs` as the written form of the operands it gives: each
 * key is an operand made by the simplification of a node, and its value is
 * the operand as it was written before that simplification.
 *
 * A hook reads in `ops.written[i]` the operand as it was written before the
 * evaluation: under `evaluate()` and `.N()` it is the operand of the node.
 * `simplify()` simplifies the operands of a node before it evaluates the
 * node through the hooks of the kinds (`simplifyExpression()`,
 * `simplify.ts`), and the simplification evaluates a constant operand: the
 * term `Negate(Celsius(5))` of `Celsius(20) − Celsius(5)` becomes
 * `Celsius(-5)` when the kind gives a value for the negation. In `fn`, the
 * hooks receive the simplified operand in `evaluated` and the operand before
 * the simplification in `written`, as under `evaluate()`. The keys are
 * compared by identity; the caller gives only operands that hold a kind
 * value, so a number literal or a symbol that another expression shares is
 * never a key.
 */
export function withOperandsWrittenBefore<T>(
  pairs: ReadonlyMap<Expression, Expression>,
  fn: () => T
): T {
  const previous = operandsWrittenBefore;
  operandsWrittenBefore = pairs;
  try {
    return fn();
  } finally {
    operandsWrittenBefore = previous;
  }
}

/** The operand `x` as it was written (`withOperandsWrittenBefore()`). */
function asWritten(x: Expression | undefined): Expression | undefined {
  if (x === undefined || operandsWrittenBefore === undefined) return x;
  return operandsWrittenBefore.get(x) ?? x;
}

//
// `Add` and `Multiply`
//

/**
 * The operands of a sum (`hook` is `add`) or a product (`multiply`) after
 * one pass over the kinds among `evaluated` (`docs/plans/
 * 2026-10-26-value-kinds.md`, section 4.4, step 3).
 *
 * Each kind's hook receives the operands that are left: the operands not yet
 * folded, and the values that the folds of the kinds before it made (with no
 * written form). Its folds replace the operands they name: the value of a
 * fold takes the place of the first operand it names, and the other operands
 * it names are removed. A kind is asked once, and only when one of its values
 * is still among the operands (a fold of an earlier kind can absorb it). A
 * fold value of a kind that is not in the list is placed without another
 * pass.
 *
 * A hook that throws propagates its error. A fold that names no operand, an
 * index out of range, or an operand that another fold of the same answer
 * names, is an error in the definition of the kind, and throws an error that
 * names the head of the kind.
 */
function foldKindOperands(
  ce: ComputeEngine,
  hook: 'add' | 'multiply',
  evaluated: ReadonlyArray<Expression>,
  written: ReadonlyArray<Expression | undefined>,
  numericApproximation: boolean
): { values: Expression[]; written: (Expression | undefined)[] } {
  let values = [...evaluated];
  let writ = written.map(asWritten);
  // The memo of `exact(i)`, aligned with `values`: it moves with its operand
  // when a fold removes the operands before it.
  let memo: (Expression | undefined)[] = values.map(() => undefined);
  const context: ArithmeticContext = { engine: ce, numericApproximation };

  for (const kind of kindsAmong(evaluated)) {
    const fn = kind.arithmetic[hook];
    if (fn === undefined) continue;
    if (!values.some((x) => kindOfValue(x) === kind.arithmetic)) continue;

    const frozenValues = values;
    const frozenWritten = writ;
    const frozenMemo = memo;
    const n = frozenValues.length;
    const ops = kindOperands(
      kind.name,
      frozenValues,
      frozenWritten,
      frozenMemo,
      numericApproximation
    );

    const folds = fn.call(kind.arithmetic, ops, context);
    if (folds === undefined || folds.length === 0) continue;
    validateFolds(kind.name, hook, folds, n);

    // The position of each operand: kept, replaced by the value of a fold,
    // or removed.
    const replacement: (Expression | undefined)[] = new Array(n);
    const removed = new Array<boolean>(n).fill(false);
    for (const fold of folds) {
      const first = Math.min(...fold.operands);
      for (const i of fold.operands) removed[i] = true;
      replacement[first] = fold.value;
    }
    const nextValues: Expression[] = [];
    const nextWritten: (Expression | undefined)[] = [];
    const nextMemo: (Expression | undefined)[] = [];
    for (let i = 0; i < n; i++) {
      const value = replacement[i];
      if (value !== undefined) {
        nextValues.push(value);
        nextWritten.push(undefined);
        nextMemo.push(value);
      } else if (!removed[i]) {
        nextValues.push(frozenValues[i]);
        nextWritten.push(frozenWritten[i]);
        nextMemo.push(frozenMemo[i]);
      }
    }
    values = nextValues;
    writ = nextWritten;
    memo = nextMemo;
  }
  return { values, written: writ };
}

/** Throw when the folds `folds`, the answer of the `hook` hook of the kind
 * of the head `name` to `n` operands, are not well formed. */
function validateFolds(
  name: string,
  hook: string,
  folds: ReadonlyArray<KindFold>,
  n: number
): void {
  const seen = new Set<number>();
  const prefix = `Value kind of "${name}": the \`${hook}\` hook returned a fold`;
  for (const fold of folds) {
    if (
      fold === null ||
      typeof fold !== 'object' ||
      !isExpression(fold.value) ||
      !Array.isArray(fold.operands)
    )
      throw new Error(
        `${prefix} that is not an object with a \`value\` expression and an \`operands\` list`
      );
    if (fold.operands.length === 0)
      throw new Error(`${prefix} that names no operand`);
    for (const i of fold.operands) {
      if (!Number.isInteger(i) || i < 0 || i >= n)
        throw new Error(
          `${prefix} that names the operand index ${i}, which is out of range (the hook received ${n} operands)`
        );
      if (seen.has(i))
        throw new Error(
          `${prefix} that names the operand index ${i}, which another fold of the same answer also names`
        );
      seen.add(i);
    }
  }
}

/**
 * The value of a sum (`operator` is `Add`) or a product (`Multiply`) whose
 * operands `evaluated` hold kind values (`docs/plans/
 * 2026-10-26-value-kinds.md`, section 4.4, steps 2 to 5). `written` holds
 * the operands as they were written, aligned with `evaluated` (`undefined`
 * for an operand with no written form).
 *
 * After one pass over the kinds (`foldKindOperands()`), the operands that
 * hold no kind value (`holdsKindValue()`, the non-strict reading), and every
 * fold value that holds none (a plain number), are combined by `combine`, the
 * ordinary numeric sum or product of the caller, as ONE sub-sum:
 * `x + x + ResidueClass(1, 5)` is `2x + ResidueClass(1, 5)`. The sub-sum runs
 * whether or not a hook folded. The operands that hold a kind value (a fold
 * value, a value that no hook folded, a symbol declared with a kind type
 * that has no value) are placed beside the sub-sum, in their order, with no
 * other fold: no like terms are combined with them, no reciprocal cancels
 * against them, and a zero or an infinity does not absorb them. Only a
 * sub-sum that is the exact neutral element (`0` in a sum, `1` in a product)
 * is left out, since it does not change the value in any kind.
 *
 * `combine` receives the written forms and the values of the operands of
 * the sub-sum (a fold value is its own written form), and at least two of
 * them.
 */
export function kindSumOrProduct(
  ce: ComputeEngine,
  operator: 'Add' | 'Multiply',
  evaluated: ReadonlyArray<Expression>,
  written: ReadonlyArray<Expression | undefined>,
  numericApproximation: boolean,
  combine: (
    written: ReadonlyArray<Expression>,
    evaluated: ReadonlyArray<Expression>
  ) => Expression
): Expression {
  const folded = foldKindOperands(
    ce,
    operator === 'Add' ? 'add' : 'multiply',
    evaluated,
    written,
    numericApproximation
  );
  const freeWritten: Expression[] = [];
  const freeValues: Expression[] = [];
  const kindTerms: Expression[] = [];
  folded.values.forEach((x, i) => {
    if (holdsKindValue(x)) kindTerms.push(x);
    else {
      freeValues.push(x);
      freeWritten.push(folded.written[i] ?? x);
    }
  });

  let sub: Expression | undefined =
    freeValues.length === 0
      ? undefined
      : freeValues.length === 1
        ? freeValues[0]
        : combine(freeWritten, freeValues);
  if (kindTerms.length === 0) return sub ?? ce.function(operator, []);
  if (
    sub !== undefined &&
    isNumber(sub) &&
    sub.isExact &&
    sub.isSame(operator === 'Add' ? 0 : 1)
  )
    sub = undefined;
  const terms = sub === undefined ? kindTerms : [sub, ...kindTerms];
  return terms.length === 1 ? terms[0] : ce.function(operator, terms);
}

//
// `Negate`, `Divide`, `Power` (and `Sqrt`, `Root`, `Square` through `power`)
//

/**
 * The value of a negation (`hook` is `negate`, one operand), a quotient
 * (`divide`, two operands) or a power (`power`, the base and the exponent)
 * whose operands hold kind values (`docs/plans/2026-10-26-value-kinds.md`,
 * section 4.4). The kinds of the operands are asked in order of first
 * occurrence; the first answer wins, and `undefined` passes to the next kind.
 * `undefined` when no kind answers: the expression stays as it is.
 *
 * `written` holds the operands as they were written, aligned with
 * `evaluated`, or `undefined` when they are not known (an operand with no
 * written form reads its value as its exact value). `Sqrt(x)` is asked as
 * `power` with the exponent `1/2`, `Root(x, n)` with `1/n` and `Square(x)`
 * with `2`.
 */
export function kindOperation(
  ce: ComputeEngine,
  hook: 'negate' | 'divide' | 'power',
  evaluated: ReadonlyArray<Expression>,
  written: ReadonlyArray<Expression | undefined> | undefined,
  numericApproximation: boolean
): Expression | undefined {
  const kinds = kindsAmong(evaluated);
  if (kinds.length === 0) return undefined;
  const operands = evaluated.map((x, i) =>
    kindOperand(x, asWritten(written?.[i]), numericApproximation)
  );
  const context: ArithmeticContext = { engine: ce, numericApproximation };
  for (const kind of kinds) {
    let result: Expression | undefined;
    if (hook === 'negate') {
      const fn = kind.arithmetic.negate;
      if (fn === undefined) continue;
      result = fn.call(kind.arithmetic, operands[0], context);
    } else {
      const fn = kind.arithmetic[hook];
      if (fn === undefined) continue;
      result = fn.call(kind.arithmetic, operands[0], operands[1], context);
    }
    if (result === undefined) continue;
    if (!isExpression(result))
      throw new Error(
        `Value kind of "${kind.name}": the \`${hook}\` hook returned a value that is not an expression`
      );
    return result;
  }
  return undefined;
}

//
// The arithmetic methods
//

/**
 * The result of an arithmetic method of an expression (`.add()`, `.mul()`,
 * `.div()`, `.inv()`, `.pow()`, `.root()`, `.sqrt()`) and of the shared
 * numeric functions behind them (`add()`, `mul()`, `div()`, `pow()`,
 * `root()`), when an operand holds a kind value (`holdsKindValue()`).
 * `undefined` when no operand holds one: the numeric rules apply.
 *
 * The numeric rules do not know the arithmetic of a kind: they read `c/c` as
 * 1 when the class `c` has no inverse, `c - c` as the integer 0, `0·c` as 0
 * and `c + ∞` as `∞`. So only the hooks of the kinds apply here, with the
 * rules of the `evaluate` handlers (`kindSumOrProduct()`, `kindOperation()`),
 * on the operands as they are given: the methods do not evaluate their
 * operands, so the written form of each operand is the operand itself.
 *
 * `combine` is the ordinary sum or product of the caller, for the operands of
 * a sum or a product that hold no kind value; without it, those operands are
 * kept as they are. An operation that no hook answers is built with the
 * canonical form, which keeps an expression with a kind value as it is
 * written. A root of index 2 is written `Sqrt`, as the canonical form writes
 * it.
 */
export function kindArithmetic(
  ce: ComputeEngine,
  operator: 'Add' | 'Multiply' | 'Divide' | 'Power' | 'Root',
  ops: ReadonlyArray<Expression>,
  combine?: (ops: ReadonlyArray<Expression>) => Expression
): Expression | undefined {
  if (!ops.some(holdsKindValue)) return undefined;
  // A `NaN` or `Indeterminate` operand decides the result, as for any other
  // operand (`nanOperandAnswer()`): `c^NaN` is `NaN`, `c/Indeterminate` is
  // `Indeterminate`.
  if (ops.some((x) => isNumber(x) && x.isNaN)) return nanOperandAnswer(ce, ops);
  if (operator === 'Add' || operator === 'Multiply') {
    // A nested sum (product) is flattened, as the canonical form of the
    // operator flattens it, so that `(x + c1).add(c2)` folds the two classes
    // as `Add(x, c1, c2)` does.
    const terms = ops.flatMap((x) => (isFunction(x, operator) ? x.ops : [x]));
    return kindSumOrProduct(ce, operator, terms, terms, false, (_, values) =>
      combine !== undefined ? combine(values) : ce.function(operator, values)
    );
  }
  if (operator === 'Divide')
    return (
      kindOperation(ce, 'divide', ops, ops, false) ?? ce.function('Divide', ops)
    );
  if (operator === 'Power')
    return (
      kindOperation(ce, 'power', ops, ops, false) ?? ce.function('Power', ops)
    );
  const [radicand, index] = ops;
  const isSqrt = isNumber(index) && index.isExact && index.isSame(2);
  const exponent = isSqrt
    ? ce.Half
    : ce.function('Divide', [ce.One, index]).evaluate();
  return (
    kindOperation(
      ce,
      'power',
      [radicand, exponent],
      [radicand, undefined],
      false
    ) ?? (isSqrt ? ce.function('Sqrt', [radicand]) : ce.function('Root', ops))
  );
}

//
// `apply`
//

/**
 * The answer of the `apply` dispatch at an apply site (`kindApply()`):
 * - `{ value }`: the result of the call, given by an `apply` hook (an
 *   `Error` expression included);
 * - `'unevaluated'`: every kind that declares `apply` answered `undefined`,
 *   and the call stays as it is;
 * - `{ operands }`: no kind answers for the call, and the operator's own
 *   handler runs with these operands, in which each collection operand that
 *   the dispatch enumerated is replaced by a list of its elements (the
 *   snapshot), so that the elements of a lazy collection are not computed
 *   twice.
 */
export type KindApplyAnswer =
  | { readonly value: Expression }
  | 'unevaluated'
  | { readonly operands: ReadonlyArray<Expression> };

/**
 * The `apply` dispatch at an APPLY SITE (`isApplySiteCall()`,
 * `apply-site.ts`; `docs/plans/2026-10-26-value-kinds.md`, sections 4.3 and
 * 4.4), on the evaluated operands `evaluated` of the call of `operator`.
 * `written` holds the operands as they were written, aligned with
 * `evaluated`, or `undefined` when they are not known.
 *
 * A threadable operator has already mapped its collection operands (the
 * generic broadcast does it before the handler), so its operands here are
 * scalars. For an operator whose PARAMETER is a collection type (`Mean`,
 * `Median`), `collectionOperands` gives the indices of the operands at such
 * a parameter: the elements of each of them are enumerated ONCE into a
 * snapshot, which the hook reads as `ops.elements(i)`, when the operand is a
 * finite collection whose count is known and at most
 * `engine.maxCollectionSize`. A collection of unknown or infinite count, or
 * larger than that, is not enumerated: no kind value is looked for in it.
 *
 * The kinds of the values among the operands and the elements of the
 * snapshots are asked in order of first occurrence; the first `apply` that
 * answers wins. `undefined` when no kind value is found and no collection
 * was enumerated: the caller runs the operator's handler as usual.
 *
 * A hook that throws propagates its error, as an `evaluate` handler does
 * (the caller calls this function where it calls the handler). A hook that
 * answers something that is not an expression throws an error that names
 * the head of the kind.
 */
export function kindApply(
  ce: ComputeEngine,
  operator: string,
  evaluated: ReadonlyArray<Expression>,
  written: ReadonlyArray<Expression | undefined> | undefined,
  numericApproximation: boolean,
  collectionOperands: ReadonlyArray<number>
): KindApplyAnswer | undefined {
  const elements: (ReadonlyArray<Expression> | undefined)[] = evaluated.map(
    () => undefined
  );
  let enumerated = false;
  for (const i of collectionOperands) {
    const snapshot = boundedElements(ce, evaluated[i]);
    if (snapshot === undefined) continue;
    elements[i] = snapshot;
    enumerated = true;
  }
  // The cells of an enumerated element that is a literal row (a `List` or a
  // `Tuple`) are candidates too: the elements of a matrix are its rows, and
  // a kind value is a cell of a row.
  const candidates = evaluated.flatMap((x, i) =>
    elements[i] === undefined ? [x] : literalCells(elements[i]!)
  );
  const kinds = kindsAmong(candidates);
  // The operands the handler receives when no kind answers: a collection
  // that was enumerated is given as the list of its elements.
  const handlerOperands = (): KindApplyAnswer | undefined =>
    enumerated
      ? {
          operands: evaluated.map((x, i) => {
            const snapshot = elements[i];
            if (snapshot === undefined) return x;
            return ce.function(isFunction(x, 'Set') ? 'Set' : 'List', [
              ...snapshot,
            ]);
          }),
        }
      : undefined;
  if (kinds.length === 0) return handlerOperands();
  const ops = kindOperands(
    kinds[0].name,
    evaluated,
    evaluated.map((x, i) => asWritten(written?.[i])),
    evaluated.map(() => undefined),
    numericApproximation,
    elements
  );
  const context: ArithmeticContext = { engine: ce, numericApproximation };
  let asked = false;
  for (const kind of kinds) {
    const fn = kind.arithmetic.apply;
    if (fn === undefined) continue;
    asked = true;
    const result = fn.call(kind.arithmetic, operator, ops, context);
    if (result === undefined) continue;
    if (!isExpression(result))
      throw new Error(
        `Value kind of "${kind.name}": the \`apply\` hook returned a value that is not an expression`
      );
    return { value: result };
  }
  return asked ? 'unevaluated' : handlerOperands();
}

/**
 * The values `xs`, with each literal `List` or `Tuple` among them replaced
 * by its cells, at every depth up to 8 (the rows of a matrix, the rows of a
 * tensor of rank 3, …). A collection that is not a literal (a `Range`, a
 * lazy collection) is kept as it is: it is not enumerated here.
 */
function literalCells(
  xs: ReadonlyArray<Expression>,
  depth = 0
): ReadonlyArray<Expression> {
  if (depth >= 8) return xs;
  if (!xs.some((x) => isFunction(x, 'List') || isFunction(x, 'Tuple')))
    return xs;
  return xs.flatMap((x) =>
    isFunction(x, 'List') || isFunction(x, 'Tuple')
      ? literalCells(x.ops, depth + 1)
      : [x]
  );
}

/**
 * The elements of the collection `x`, enumerated once, when `x` is a finite
 * collection whose count is known and at most `engine.maxCollectionSize`;
 * else `undefined` (no enumeration). A string is not enumerated: its
 * elements are characters, never kind values.
 */
function boundedElements(
  ce: ComputeEngine,
  x: Expression
): ReadonlyArray<Expression> | undefined {
  if (x.isCollection !== true || x.isFiniteCollection !== true)
    return undefined;
  if (isString(x)) return undefined;
  const n = x.count;
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
  if (n > ce.maxCollectionSize) return undefined;
  const result: Expression[] = [];
  for (const element of x.each()) {
    result.push(element);
    if (result.length > n) return undefined;
  }
  return result;
}

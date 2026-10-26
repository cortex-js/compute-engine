/**
 * The operands of the hooks of the value kinds, and the dispatch of the
 * COMPARISONS to the `compare` hooks and the `eq` handlers of the kind heads
 * (`docs/plans/2026-10-26-value-kinds.md`, sections 4.3 and 4.4).
 *
 * The six relational operators, `Max`, `Min`, `Sort`, `Clamp`, the
 * comparison methods (`isEqual()`, `isLess()`, …), `exactOrder()` and
 * `.is()` call `kindCompare()` or `kindEqual()` on a pair of values. The
 * arithmetic dispatch (`kind-dispatch.ts`) reads the operand helpers of this
 * module.
 *
 * This module does not import `residue-class.ts`: `compare.ts` imports it,
 * and `residue-class.ts` reaches `compare.ts` through the boxed expression
 * classes, so the import would be a cycle.
 */

import type {
  ArithmeticContext,
  ArithmeticDefinition,
  Expression,
  KindOperand,
  KindOperands,
} from '../global-types.js';
import { isFunction, isNumber, isString } from './type-guards.js';
import {
  arithmeticOf,
  engineHasKindValues,
  kindTypeHasHook,
  kindTypesOfHead,
} from './value-kinds.js';
import { isTransitivelyPure } from './transitive-purity.js';
import { provablyDisjoint } from '../../common/type/subtype.js';

/** A kind among the operands: its arithmetic, and the name of the head of
 * the first operand of the kind, for the error messages. */
export interface KindEntry {
  readonly arithmetic: ArithmeticDefinition;
  readonly name: string;
}

/**
 * The arithmetic of the head of `expr` when `expr` is a VALUE of a kind: a
 * call of a head whose bound definition declares a value kind. `undefined`
 * for anything else, including an expression that only holds a kind value
 * (`x + c`, a symbol declared with a kind type). An engine that has made no
 * kind value (`engineHasKindValues()`) answers `undefined` at once.
 */
export function kindOfValue(
  expr: Expression
): ArithmeticDefinition | undefined {
  if (!isFunction(expr) || !engineHasKindValues(expr.engine)) return undefined;
  const def = expr.operatorDefinition;
  return def === undefined ? undefined : arithmeticOf(expr.engine, def);
}

/** The kinds of the values among `values`, in order of first occurrence. */
export function kindsAmong(values: ReadonlyArray<Expression>): KindEntry[] {
  const result: KindEntry[] = [];
  for (const x of values) {
    const arithmetic = kindOfValue(x);
    if (arithmetic === undefined) continue;
    if (result.some((k) => k.arithmetic === arithmetic)) continue;
    result.push({ arithmetic, name: x.operator });
  }
  return result;
}

/**
 * The exact value of an operand: `value` outside `.N()`. Under `.N()`, the
 * operand as written evaluated again without the numeric approximation when
 * evaluating it again cannot run a side effect twice (`isTransitivelyPure()`),
 * else `value`. An operand with no written form (a value that a fold made)
 * is its value. A kind whose values are exact (a residue class) reads the
 * exact value, so that `(c + 1/3).N()` is a class and not a sum with
 * `0.333…`.
 */
export function exactValue(
  value: Expression,
  written: Expression | undefined,
  numericApproximation: boolean
): Expression {
  if (!numericApproximation || written === undefined) return value;
  return isTransitivelyPure(written) ? written.evaluate() : value;
}

/** One operand of a `negate`, `divide` or `power` hook. `exact()` is
 * computed once. */
export function kindOperand(
  value: Expression,
  written: Expression | undefined,
  numericApproximation: boolean
): KindOperand {
  let exact: Expression | undefined;
  return {
    evaluated: value,
    written,
    exact: () => (exact ??= exactValue(value, written, numericApproximation)),
  };
}

/**
 * The operands of an `add`, `multiply` or `apply` hook of the kind of the
 * head `name`. `values` are the evaluated operands and `written` the
 * operands as they were written, aligned with them. `memo` holds the exact
 * value of each operand once `exact(i)` computed it, aligned with `values`;
 * the caller keeps it so that the memo of an operand survives a fold.
 * `elements[i]` is the snapshot of the elements of the collection operand
 * `i`, when the dispatch enumerated it (`kindApply()`); `undefined` for any
 * other operand. An index out of range throws an error that names the head.
 */
export function kindOperands(
  name: string,
  values: ReadonlyArray<Expression>,
  written: ReadonlyArray<Expression | undefined>,
  memo: (Expression | undefined)[],
  numericApproximation: boolean,
  elements?: ReadonlyArray<ReadonlyArray<Expression> | undefined>
): KindOperands {
  const n = values.length;
  const checkIndex = (i: number): void => {
    if (!Number.isInteger(i) || i < 0 || i >= n)
      throw new RangeError(
        `Value kind of "${name}": operand index ${i} is out of range (the hook received ${n} operands)`
      );
  };
  return {
    evaluated: values,
    written,
    exact: (i: number) => {
      checkIndex(i);
      return (memo[i] ??= exactValue(
        values[i],
        written[i],
        numericApproximation
      ));
    },
    elements: (i: number) => {
      checkIndex(i);
      return elements?.[i];
    },
  };
}

//
// The comparisons
//

/** True when `expr` is a VALUE of a kind: a call of a head whose bound
 * definition declares a value kind (`arithmetic`). An expression that only
 * holds a kind value (`x + c`, a symbol declared with a kind type) is not. */
export function isKindValue(expr: Expression): boolean {
  return kindOfValue(expr) !== undefined;
}

/** True when `expr` is a value of a kind whose kind TYPE has `compare`: a
 * registered head of the type declares the hook (the reading per type,
 * `docs/plans/2026-10-26-value-kinds.md`, section 4.5). */
export function isComparableKindValue(expr: Expression): boolean {
  if (!isFunction(expr) || !engineHasKindValues(expr.engine)) return false;
  const def = expr.operatorDefinition;
  if (def === undefined) return false;
  const ce = expr.engine;
  const types = kindTypesOfHead(ce, def);
  return types?.some((t) => kindTypeHasHook(ce, t, 'compare')) === true;
}

/**
 * The order of a pair of values given by the `compare` hooks of the kinds
 * (`docs/plans/2026-10-26-value-kinds.md`, sections 4.3 and 4.4).
 *
 * `undefined` when the dispatch does not apply: neither `a` nor `b` is a
 * value of a kind whose kind type has `compare` (`isComparableKindValue()`),
 * and the caller compares the pair as it does without kinds. Else the order
 * is decided here, and the caller does not use another rule:
 *
 * - two identical values (`isSame`) are a tie, `0`, for every kind; under
 *   `.N()`, only when their exact values are identical too;
 * - the kinds of `a` and `b` that declare `compare` are asked in order of
 *   first occurrence, and the first answer (`-1`, `0`, `1`) decides;
 * - when every kind answers `undefined`, the pair is `'incomparable'`: an
 *   order comparison of it stays unevaluated, and a comparison method
 *   answers `undefined`.
 *
 * `written` holds the operands as they were written, for `exact()` under
 * `.N()` (`numericApproximation`). A hook that throws propagates its error;
 * a hook that answers a value other than `-1`, `0`, `1` or `undefined`
 * throws an error that names the head of the kind.
 */
export function kindCompare(
  a: Expression,
  b: Expression,
  options?: {
    written?: readonly [Expression | undefined, Expression | undefined];
    numericApproximation?: boolean;
  }
): -1 | 0 | 1 | 'incomparable' | undefined {
  if (!isComparableKindValue(a) && !isComparableKindValue(b)) return undefined;
  const numericApproximation = options?.numericApproximation ?? false;
  const x = kindOperand(a, options?.written?.[0], numericApproximation);
  const y = kindOperand(b, options?.written?.[1], numericApproximation);
  if (a.isSame(b)) {
    // Under `.N()`, two written operands with different exact values can
    // have identical approximate values: `UserMeasurement(1/3, 0.1)` and
    // `UserMeasurement(1/3 + 10⁻³⁰, 0.1)`. They are a tie only when their
    // exact values (`exact()`) are identical too; else the exact values are
    // compared, as `evaluate()` compares them. Outside `.N()`, or with no
    // written operands, `exact()` is the value, and the pair is a tie.
    const u = x.exact();
    const v = y.exact();
    if (u.isSame(v)) return 0;
    return kindCompare(u, v) ?? 'incomparable';
  }
  const context: ArithmeticContext = {
    engine: a.engine,
    numericApproximation,
  };
  for (const kind of kindsAmong([a, b])) {
    const fn = kind.arithmetic.compare;
    if (fn === undefined) continue;
    const order = fn.call(kind.arithmetic, x, y, context);
    if (order === undefined) continue;
    if (order !== -1 && order !== 0 && order !== 1)
      throw new Error(
        `Value kind of "${kind.name}": the \`compare\` hook returned ${String(order)}, which is not -1, 0, 1 or undefined`
      );
    return order;
  }
  return 'incomparable';
}

/**
 * The equality of a pair of values of which at least one is a kind value
 * (`isKindValue()`), for `Equal`, `NotEqual`, `isEqual()` and `.is()`
 * (`docs/plans/2026-10-26-value-kinds.md`, section 4.4). `'not-applicable'`
 * when neither `a` nor `b` is a kind value: the caller compares the pair as
 * it does without kinds. Else, in this order:
 *
 * 1. two identical values (`isSame`) are equal; under `.N()`, only when
 *    their exact values are identical too;
 * 2. when a kind of the pair declares `compare` and the pair is comparable
 *    (`kindCompare()`), they are equal when the order is `0`;
 * 3. else the `eq` handlers of the definitions of the heads of `a` and `b`
 *    are asked, in operand order; the first `eq` that exists decides, also
 *    when it answers `undefined` (`Equal(ResidueClass(1, 5), 2)` stays
 *    unevaluated);
 * 4. else, when no head has an `eq`: two values with no unknowns whose
 *    types are provably disjoint are not equal (`Equal(GF8(1), "abc")` is
 *    `False`); any other pair is undecided (`undefined`). Two values of one
 *    kind type that are not identical are undecided, since a kind can have
 *    two forms of one value (`MyMod(7, 5)` and `MyMod(2, 5)`).
 *
 * `prover` is passed to the `eq` handlers (the tier of `isIdenticallyEqual()`).
 */
export function kindEqual(
  a: Expression,
  b: Expression,
  options?: {
    prover?: boolean;
    written?: readonly [Expression | undefined, Expression | undefined];
    numericApproximation?: boolean;
  }
): boolean | undefined | 'not-applicable' {
  if (!isKindValue(a) && !isKindValue(b)) return 'not-applicable';
  if (a.isSame(b)) {
    // Two identical approximate values are equal only when their exact
    // values are identical too: see the tie in `kindCompare()`. Else the
    // exact values are compared, as `evaluate()` compares them.
    const numericApproximation = options?.numericApproximation ?? false;
    const u = exactValue(a, options?.written?.[0], numericApproximation);
    const v = exactValue(b, options?.written?.[1], numericApproximation);
    if (u.isSame(v)) return true;
    const exact = kindEqual(u, v, { prover: options?.prover });
    return exact === 'not-applicable' ? undefined : exact;
  }
  const order = kindCompare(a, b, options);
  if (order !== undefined && order !== 'incomparable') return order === 0;
  for (const [x, y] of [
    [a, b],
    [b, a],
  ] as const) {
    const eq = isFunction(x) ? x.operatorDefinition?.eq : undefined;
    if (eq === undefined) continue;
    return eq(x, y, options?.prover ?? false);
  }
  if (
    a.unknowns.length === 0 &&
    b.unknowns.length === 0 &&
    provablyDisjoint(a.type.type, b.type.type)
  )
    return false;
  return undefined;
}

/**
 * True when `a` and `b` are both VALUES (a kind value, a number literal or a
 * string) and at least one of them is a kind value: the pairs that the
 * equality of the kinds can decide before any evaluation. An expression
 * that a kind value could be the value of (a sum of classes, a symbol) is
 * evaluated first by the callers.
 */
export function isKindValuePair(a: Expression, b: Expression): boolean {
  if (!isKindValue(a) && !isKindValue(b)) return false;
  const isValue = (x: Expression): boolean =>
    isKindValue(x) || isNumber(x) || isString(x);
  return isValue(a) && isValue(b);
}

/**
 * The answer of `.is()` for `a` and `other` when one of them is a value of a
 * value kind and the other is a value too (a kind value, a number literal, a
 * string, a symbol with no value is not one), or `undefined` (the caller
 * goes on with its own rules, and evaluates an operand that is not a value
 * before it asks again) (`docs/plans/2026-10-26-value-kinds.md`, section
 * 4.4). When the kind type of a side declares `compare`, the answer is the
 * `Equal` of the two (`kindEqual()`, symmetric in the order of the
 * operands); else it is `isSame`. A JavaScript `number` or `bigint` is
 * boxed. A tolerance does not apply: the `compare` hook has its own.
 */
export function kindIs(
  a: Expression,
  other: Expression | number | bigint | boolean | string
): boolean | undefined {
  // An engine that has made no kind value does not box `other`.
  if (!engineHasKindValues(a.engine)) return undefined;
  const b =
    typeof other === 'number' || typeof other === 'bigint'
      ? a.engine.number(other)
      : typeof other === 'object' && other !== null
        ? other
        : undefined;
  if (b === undefined || !isKindValuePair(a, b)) return undefined;
  if (isComparableKindValue(a) || isComparableKindValue(b))
    return kindEqual(a, b) === true;
  return a.isSame(b);
}

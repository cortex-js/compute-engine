/**
 * Residue classes: the elements of ℤ/nℤ, `ResidueClass(k, n)`.
 *
 * A class is held as a pair of integers `k` in [0, n) and `n ≥ 1`, in
 * `bigint`, so a modulus past 2^53 stays exact. Every function here works on
 * that pair; the arithmetic handlers of `Add`, `Multiply`, `Divide`, `Power`
 * and `Negate` call the `residue*` functions on their evaluated operands.
 *
 * Arithmetic is defined inside one ring only. Classes of different moduli do
 * not combine: `ResidueClass(2, 4) + ResidueClass(1, 6)` stays unevaluated,
 * with no error. An exact integer, or an exact rational whose denominator is
 * a unit, is read in the ring of the classes beside it:
 * `ResidueClass(5, 7) + 3` is `ResidueClass(1, 7)`. A float is never read as
 * an integer here: `7.0` is an approximation, so `ResidueClass(7.0, 5)` and
 * `ResidueClass(2, 5) + 3.0` stay unevaluated.
 */

import type {
  Expression,
  IComputeEngine as ComputeEngine,
  OperandDescriptor,
  PureEngineView,
} from '../global-types.js';
import { asBigint, asRational } from './numerics.js';
import {
  isExpression,
  isFunction,
  isNumber,
  isSymbol,
  nanOperandAnswer,
  sym,
} from './type-guards.js';
import { modularInverse } from '../numerics/numeric-bigint.js';
import { modPow } from '../numerics/primes.js';
import { isSubtype } from '../../common/type/subtype.js';
import { setSymbolValueHook } from './residue-class-value-hook.js';

/** A class `k + nℤ`, with `0 ≤ k < n`. */
export interface Residue {
  readonly k: bigint;
  readonly n: bigint;
}

const mod = (a: bigint, n: bigint): bigint => ((a % n) + n) % n;

/**
 * The integer value of an EXACT integer literal, or `null`. A float with an
 * integer value (`7.0`, `1e30`) is `null`: its value is an approximation,
 * and its residue would be a guess.
 */
function exactInteger(expr: Expression): bigint | null {
  if (!isNumber(expr) || !expr.isExact) return null;
  return asBigint(expr);
}

/** The class of the rational `num/den` in ℤ/nℤ, if `den` is a unit mod `n`. */
export function residueOfRational(
  num: bigint,
  den: bigint,
  n: bigint
): Residue | undefined {
  if (n < 1n) return undefined;
  if (den === 1n) return { k: mod(num, n), n };
  const inverse = modularInverse(den, n);
  return inverse === null ? undefined : { k: mod(num * inverse, n), n };
}

/**
 * The class of an exact integer or rational literal in ℤ/nℤ. `undefined` for
 * anything else: a float, a symbol, or a rational with a denominator that is
 * not a unit (`1/2` mod 4).
 */
export function residueOfLiteral(
  expr: Expression,
  n: bigint
): Residue | undefined {
  if (!isNumber(expr) || !expr.isExact) return undefined;
  const integer = asBigint(expr);
  if (integer !== null) return { k: mod(integer, n), n };
  const q = asRational(expr);
  if (q === undefined) return undefined;
  return residueOfRational(BigInt(q[0]), BigInt(q[1]), n);
}

/** `ResidueClass(k, n)` with exact integer operands, read as a pair. */
export function residueOf(expr: Expression | undefined): Residue | undefined {
  if (!isFunction(expr, 'ResidueClass') || expr.nops !== 2) return undefined;
  const k = exactInteger(expr.op1);
  const n = exactInteger(expr.op2);
  if (k === null || n === null || n < 1n || k < 0n || k >= n) return undefined;
  return { k, n };
}

export function isResidueClass(expr: Expression | undefined): boolean {
  return residueOf(expr) !== undefined;
}

/**
 * An operand that holds a residue class, as a type handler sees it: a
 * `ResidueClass(…)` call, an arithmetic application with one among its
 * operands at any depth (`(x·c)^2`, `2^c`), or a symbol whose value holds
 * one. Such an operand does not have a number type. `engine` is the engine
 * of the type handler: in an engine that has never made a class (see
 * `containsResidueClass()`), the answer is `false` without a walk.
 */
export function isResidueClassOperand(
  d: OperandDescriptor,
  engine: PureEngineView
): boolean {
  if (!enginesWithClasses.has(engine)) return false;
  return describesClass(d, engine);
}

function describesClass(d: OperandDescriptor, engine: PureEngineView): boolean {
  // An operand that holds a class is never typed as a number (the type
  // handlers of the arithmetic operators answer `value` for it), so a
  // number type ends the walk at once: this is the usual operand.
  if (isSubtype(d.type, 'number')) return false;
  const s = d.structureOf?.();
  if (s?.kind === 'symbol') {
    if (!enginesWithClassValues.has(engine)) return false;
    const value = engine.lookupDefinition(s.name)?.value?.value;
    return value !== undefined && containsResidueClass(value);
  }
  if (s?.kind !== 'application') return false;
  if (s.head === 'ResidueClass') return true;
  return (
    RESIDUE_ARITHMETIC.includes(s.head) &&
    s.children.some((x) => describesClass(x, engine))
  );
}

/**
 * The arithmetic operators. The simplification barrier (`simplify.ts`)
 * stops at an expression with one of them as its operator when it holds a
 * class, and the type handlers look for a class through them
 * (`isResidueClassOperand()`).
 */
export const RESIDUE_ARITHMETIC: ReadonlyArray<string> = [
  'Add',
  'Subtract',
  'Multiply',
  'Divide',
  'Negate',
  'Power',
  'Square',
  'Sqrt',
  'Root',
];

/**
 * The engines that have made at least one `ResidueClass(…)` call. The
 * `BoxedFunction` constructor adds its engine here when it makes one
 * (`noteResidueClass()`). In an engine that has never made one, no
 * expression can contain a class, and `containsResidueClass()` answers
 * without a walk of the expression: the arithmetic of an engine that does
 * not use classes does not pay for them.
 */
const enginesWithClasses = new WeakSet<object>();

/** Record that `ce` has made a `ResidueClass(…)` call. */
export function noteResidueClass(ce: object): void {
  enginesWithClasses.add(ce);
}

/**
 * The engines in which a symbol has been given a value that holds a class.
 * The value definition adds its engine here when it stores such a value
 * (`noteResidueClassValue()`). In an engine that is not in this set, no
 * symbol value holds a class, and the tests below do not read the values of
 * symbols. The set only grows: a later assignment of another value does not
 * remove the engine, which is safe (the values are then read for nothing).
 */
const enginesWithClassValues = new WeakSet<object>();

/**
 * Record that a symbol of `ce` now has the value `value`. The value
 * definition calls it through `noteSymbolValue()`
 * (`residue-class-value-hook.ts`).
 */
export function noteResidueClassValue(ce: object, value: unknown): void {
  if (!isExpression(value) || !enginesWithClasses.has(ce)) return;
  if (enginesWithClassValues.has(ce)) return;
  if (containsResidueClass(value)) enginesWithClassValues.add(ce);
}

setSymbolValueHook(noteResidueClassValue);

/**
 * True when a `ResidueClass(…)` call is in the function expression `expr`,
 * at any depth and through any operator. Computed once per node and kept in
 * `CLASS_FACTS`: an expression does not change, so neither does the answer.
 */
const CLASS_FACTS = new WeakMap<Expression, boolean>();

function hasClassCall(expr: Expression): boolean {
  let result = CLASS_FACTS.get(expr);
  if (result !== undefined) return result;
  result =
    expr.operator === 'ResidueClass' ||
    (isFunction(expr) &&
      expr.ops.some((op) => isFunction(op) && hasClassCall(op)));
  CLASS_FACTS.set(expr, result);
  return result;
}

/**
 * The symbols in the function expression `expr`, at any depth. A symbol's
 * value can change, so the symbols are kept with the expression, and their
 * values are read when they are used. They are computed only in an engine
 * where a symbol value holds a class (`enginesWithClassValues`).
 */
const CLASS_SYMBOLS = new WeakMap<Expression, ReadonlyArray<Expression>>();

function classSymbols(expr: Expression): ReadonlyArray<Expression> {
  let result = CLASS_SYMBOLS.get(expr);
  if (result !== undefined) return result;
  const found = new Map<string, Expression>();
  if (isFunction(expr)) {
    for (const op of expr.ops) {
      if (isSymbol(op)) found.set(op.symbol, op);
      else if (isFunction(op))
        for (const x of classSymbols(op)) found.set(sym(x)!, x);
    }
  }
  result = [...found.values()];
  CLASS_SYMBOLS.set(expr, result);
  return result;
}

/**
 * True when `expr` holds a class, following the values of symbols
 * transitively. `visited` holds the names of the symbols already followed,
 * so that a cycle of values (`a := b`, `b := a`) ends; it is made when the
 * first symbol is followed.
 */
function holds(expr: Expression, visited?: Set<string>): boolean {
  if (isSymbol(expr)) return symbolHolds(expr, visited);
  if (!isFunction(expr)) return false;
  if (hasClassCall(expr)) return true;
  if (!enginesWithClassValues.has(expr.engine)) return false;
  visited ??= new Set();
  return classSymbols(expr).some((x) => symbolHolds(x, visited));
}

function symbolHolds(expr: Expression, visited?: Set<string>): boolean {
  if (!enginesWithClassValues.has(expr.engine)) return false;
  const name = sym(expr)!;
  visited ??= new Set();
  if (visited.has(name)) return false;
  visited.add(name);
  const value = expr.value;
  return value !== undefined && value !== expr && holds(value, visited);
}

/**
 * True when `expr` holds a residue class: a `ResidueClass(…)` call is in it
 * at any depth, through any operator (`c + 1`, `Max(c, x)`, `At([c], 1)`,
 * `Sum(ResidueClass(k, 4), k, 1, 3)`). The call does not have to be a class
 * yet: `ResidueClass(k, 4)` with a symbol `k` counts too. A symbol whose
 * value holds a class counts too (`q := ResidueClass(2, 4)`, and
 * `r := q + y` through `q`): values are followed transitively, and a cycle
 * of values ends the walk. A class that only a function call returns
 * (`g(2)` with `g := k ↦ ResidueClass(k, 4)`) is not seen.
 *
 * The test is syntactic, not on the type: the type of a class is `value`,
 * which many expressions that are not classes have too (a symbol of unknown
 * type), so a type test would stop the numeric rules for them. The walk of a
 * function expression is done once and kept with the expression
 * (`hasClassCall()`), so a test on a large expression is a lookup. The same
 * test is used by every rule that checks for a class, in canonicalization,
 * evaluation and simplification: when two rules used different tests, one
 * built what the other then rebuilt, without end.
 *
 * The arithmetic of a class is defined only by the residue rules (the
 * `residue*` functions). The generic rules of canonicalization, evaluation
 * and simplification do not know the ring, and give wrong answers for an
 * expression for which this is true: they read `c/c` as 1 when the class
 * `c` has no inverse, `c - c` as the integer 0, `c + ∞` as `∞`, and
 * `(c^{2/3})^3` as `c^2`. So these rules check this first, and keep the
 * expression as it is.
 */
export function containsResidueClass(expr: Expression): boolean {
  if (!enginesWithClasses.has(expr.engine)) return false;
  if (!isSymbol(expr) && !isFunction(expr)) return false;
  return holds(expr);
}

/**
 * What a transformation that does not apply to an expression with a class
 * (`Expand`, `Factor`, `Together`) gives for `expr`, which holds one: the
 * residue fold of `expr` when it is pure and every symbol in it is a
 * constant (`Expand(c + c)` is the class `2c`), else `expr` as it is.
 */
export function residueFoldOrKeep(expr: Expression): Expression {
  return expr.isPure === true && expr.isConstant ? expr.evaluate() : expr;
}

/**
 * True when evaluating `expr` again cannot run a side effect twice: `expr`
 * and every subexpression are pure, and so are the values of its symbols,
 * followed transitively. `isPure` of a symbol is `true` even when its value
 * is an impure call, so the values are read here.
 */
export function isPureThroughValues(
  expr: Expression,
  visited: Set<string> = new Set()
): boolean {
  if (isSymbol(expr)) {
    if (visited.has(expr.symbol)) return true;
    visited.add(expr.symbol);
    const value = expr.value;
    return (
      value === undefined ||
      value === expr ||
      isPureThroughValues(value, visited)
    );
  }
  if (expr.isPure !== true) return false;
  return (
    !isFunction(expr) || expr.ops.every((x) => isPureThroughValues(x, visited))
  );
}

export function residueExpression(ce: ComputeEngine, x: Residue): Expression {
  return ce._fn('ResidueClass', [ce.number(x.k), ce.number(x.n)]);
}

/**
 * `ResidueClass(k, n)` in canonical form: `k` reduced into [0, n). `undefined`
 * when `n` is not an exact integer literal ≥ 1, or `k` is not an exact
 * integer or a rational literal that is a unit mod `n`: the call stays as it
 * is.
 */
export function residueClassOf(
  ce: ComputeEngine,
  k: Expression,
  n: Expression
): Expression | undefined {
  const modulus = exactInteger(n);
  if (modulus === null || modulus < 1n) return undefined;
  const r = residueOfLiteral(k, modulus);
  return r === undefined ? undefined : residueExpression(ce, r);
}

//
// Arithmetic on pairs of one modulus
//

const add = (x: Residue, y: Residue): Residue => ({
  k: mod(x.k + y.k, x.n),
  n: x.n,
});

const multiply = (x: Residue, y: Residue): Residue => ({
  k: mod(x.k * y.k, x.n),
  n: x.n,
});

const negate = (x: Residue): Residue => ({ k: mod(-x.k, x.n), n: x.n });

/** x⁻¹, or `undefined` when gcd(k, n) ≠ 1. */
const inverse = (x: Residue): Residue | undefined => {
  const k = modularInverse(x.k, x.n);
  return k === null ? undefined : { k, n: x.n };
};

/** xᵉ; a negative exponent inverts first, so it needs a unit. */
const power = (x: Residue, e: bigint): Residue | undefined => {
  const base = e < 0n ? inverse(x) : x;
  if (base === undefined) return undefined;
  return { k: modPow(base.k, e < 0n ? -e : e, x.n), n: x.n };
};

//
// Operands
//

/**
 * The class that `op` is: a class, or the negation of a class
 * (`-ResidueClass(2, 5)` is `ResidueClass(3, 5)`).
 */
function classOf(op: Expression): Residue | undefined {
  if (isFunction(op, 'Negate')) {
    const r = residueOf(op.op1);
    return r === undefined ? undefined : negate(r);
  }
  return residueOf(op);
}

/**
 * The modulus of the `ResidueClass(…)` calls among `ops`, also under a
 * negation. `undefined` when
 * there is none, `null` when they do not share one ring: a call that is not
 * a class yet (a symbolic `k`), or classes of different moduli.
 */
function ringOf(ops: ReadonlyArray<Expression>): bigint | null | undefined {
  let ring: bigint | undefined = undefined;
  for (const op of ops) {
    const call = isFunction(op, 'Negate') ? op.op1 : op;
    if (call.operator !== 'ResidueClass') continue;
    const r = residueOf(call);
    if (r === undefined) return null;
    if (ring !== undefined && ring !== r.n) return null;
    ring = r.n;
  }
  return ring;
}

/**
 * The result of `residueFold()`: `value` is the class that the class
 * operands and the literals that read in their ring make together, and
 * `rest` holds the indexes of the operands that are not part of it.
 */
export interface ResidueFold {
  readonly value: Expression;
  readonly rest: ReadonlyArray<number>;
}

/**
 * Fold the operands of a sum or a product that are in one ring: the classes,
 * and the exact integer or rational literals that read in their ring. The
 * other operands (a symbol, a float, an infinity, an expression with a class
 * inside it such as `1/c`) are not part of the fold; their indexes are in
 * `rest`, and the caller keeps them as they are, beside the class:
 * `ResidueClass(1, 5) + ResidueClass(2, 5) + x` is `x + ResidueClass(3, 5)`.
 *
 * `undefined` when there is nothing to fold: no class among `ops`, classes
 * of different moduli, or a `ResidueClass(…)` call that is not a class yet.
 */
export function residueFold(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>,
  operation: 'add' | 'multiply'
): ResidueFold | undefined {
  const ring = ringOf(ops);
  if (ring === undefined || ring === null) return undefined;
  const step = operation === 'add' ? add : multiply;
  let acc: Residue | undefined = undefined;
  const rest: number[] = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    const r = classOf(op) ?? residueOfLiteral(op, ring);
    if (r === undefined) {
      rest.push(i);
      continue;
    }
    acc = acc === undefined ? r : step(acc, r);
  }
  return acc === undefined
    ? undefined
    : { value: residueExpression(ce, acc), rest };
}

export function residueNegate(
  ce: ComputeEngine,
  x: Expression
): Expression | undefined {
  const r = residueOf(x);
  return r === undefined ? undefined : residueExpression(ce, negate(r));
}

/**
 * `num / den` in one ring: `undefined` when the operands are not both in the
 * ring of a class (a class of another modulus, a symbol, a float), or when
 * `den` is not a unit.
 */
export function residueDivide(
  ce: ComputeEngine,
  num: Expression,
  den: Expression
): Expression | undefined {
  const ring = ringOf([num, den]);
  if (ring === undefined || ring === null) return undefined;
  const a = residueOf(num) ?? residueOfLiteral(num, ring);
  const b = residueOf(den) ?? residueOfLiteral(den, ring);
  if (a === undefined || b === undefined) return undefined;
  const b1 = inverse(b);
  return b1 === undefined ? undefined : residueExpression(ce, multiply(a, b1));
}

/**
 * `x ^ e` for an exact integer exponent: `undefined` for a negative one on a
 * non-unit.
 */
export function residuePower(
  ce: ComputeEngine,
  x: Expression,
  e: Expression
): Expression | undefined {
  const r = residueOf(x);
  const exponent = exactInteger(e);
  if (r === undefined || exponent === null) return undefined;
  const p = power(r, exponent);
  return p === undefined ? undefined : residueExpression(ce, p);
}

/**
 * The result of an arithmetic operation of the shared numeric functions
 * (`add()`, `mul()`, `div()`, `pow()`, `root()`) and of the arithmetic
 * methods of an expression, when an operand holds a residue class
 * (`containsResidueClass()`). `undefined` when no operand holds one: the
 * numeric rules apply.
 *
 * The numeric rules do not know the ring of a class: they read `c/c` as 1
 * when `c` has no inverse, `c - c` as the integer 0, `0·c` as 0, and
 * `c + ∞` as `∞`. So only the residue rules apply here. The classes of one
 * ring and the exact literals that read in it fold to a class
 * (`residueFold()`); every other operand is kept as it is, and the result
 * is built with the canonical form, which keeps an expression with a class
 * as it is written.
 */
export function residueArithmetic(
  ce: ComputeEngine,
  operator: 'Add' | 'Multiply' | 'Divide' | 'Power' | 'Root',
  ops: ReadonlyArray<Expression>
): Expression | undefined {
  if (!ops.some(containsResidueClass)) return undefined;
  // A `NaN` or `Indeterminate` operand decides the result, as for any other
  // operand (`nanOperandAnswer()`): `c^NaN` is `NaN`, `c/Indeterminate` is
  // `Indeterminate`.
  if (ops.some((x) => isNumber(x) && x.isNaN)) return nanOperandAnswer(ce, ops);
  if (operator === 'Add' || operator === 'Multiply') {
    const fold = residueFold(ce, ops, operator === 'Add' ? 'add' : 'multiply');
    if (fold === undefined) return ce.function(operator, ops);
    if (fold.rest.length === 0) return fold.value;
    return ce.function(operator, [fold.value, ...fold.rest.map((i) => ops[i])]);
  }
  if (operator === 'Divide')
    return residueDivide(ce, ops[0], ops[1]) ?? ce.function('Divide', ops);
  if (operator === 'Power')
    return residuePower(ce, ops[0], ops[1]) ?? ce.function('Power', ops);
  // A root of index 2 is written `Sqrt`, as the canonical form writes it.
  const [radicand, index] = ops;
  if (isNumber(index) && index.isExact && index.isSame(2))
    return ce.function('Sqrt', [radicand]);
  return ce.function('Root', ops);
}

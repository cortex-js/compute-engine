import type { Expression } from '../types-expression.js';
import { isFunction, isNumber, isSymbol } from './type-guards.js';
import { isExactNonInteger, machineNumberOf } from './machine-number.js';
import { MACHINE_PRECISION } from '../numerics/numeric.js';
import { checkDeadline } from '../../common/interruptible.js';

/**
 * A loop over doubles checks the evaluation deadline once every
 * `DEADLINE_STRIDE + 1` elements. The element loop of the interpreter checks
 * it every 256 elements; an iteration here is about a thousand times cheaper,
 * so the stride is longer, and a list of ten million doubles is still
 * interrupted within a fraction of a millisecond of the deadline.
 */
export const DEADLINE_STRIDE = 0xffff;

/**
 * Element-wise arithmetic over lists of machine numbers, computed on doubles.
 *
 * Above a hundred elements a broadcast answers a lazy `Map`, and every
 * element of that `Map` is a function application in the interpreter, a few
 * microseconds each, paid again by each evaluation. That form is for a source
 * that is itself lazy or very large (a `Map` over a long `Range`). A `List` of
 * machine numbers is already in memory, its doubles are one array read away
 * (`array`), and the arithmetic over ten thousand doubles costs microseconds.
 * For such operands the broadcast is computed at once and answered as a list
 * that holds its numbers unboxed (`ce.list()`).
 *
 * The rule that decides every case below: the doubles are used only when they
 * are the SAME values the interpreter computes element by element. When that
 * is not certain the function answers `undefined` and the caller takes the
 * route it took before.
 *
 * - **Operands.** Each operand is a `List` of machine numbers
 *   (`isMachineNumeric`: no exact rational such as `1/2`, no radical, no
 *   complex number, no symbol, no nested list), a symbol whose value is such a
 *   list, or a machine number. All the lists have the same length (the caller
 *   reported a length disagreement before). Every value is finite, so that no
 *   `0 · ∞`, `∞ − ∞` or `NaN` is decided here.
 * - **Machine precision only.** A cell with a float operand is computed by
 *   the interpreter in the arithmetic of the engine's precision, and only at
 *   machine precision is that the arithmetic of doubles. Above machine
 *   precision the function declines for integers too: there a broadcast of
 *   integers over a symbol keeps the lazy `Map` that the exact compiled tier
 *   reads (`library/map-auto-compile.ts`). Each float must also be STORED as
 *   a double: a float made at a higher precision keeps its decimal digits
 *   when the engine is later set to machine precision, and the interpreter
 *   multiplies those digits (`0.1 · 3` is `0.3` for such a `0.1`, where the
 *   doubles give `0.30000000000000004`).
 * - **Integers stay exact.** When every operand of a cell is an integer, the
 *   interpreter answers an exact integer. The double is that integer when the
 *   operands and the result are safe integers; otherwise the function
 *   declines.
 * - **Heads.** `Add` and `Multiply` of exactly two operands, and `Negate`.
 *   One addition or one multiplication of two doubles is one correctly
 *   rounded operation, in any order. A sum or a product of three or more
 *   operands is not: the interpreter adds the exact operands apart from the
 *   floats, and the rounding depends on that order.
 */
export function machineBroadcast(
  ce: Expression['engine'],
  operator: string,
  ops: ReadonlyArray<Expression>
): Expression | undefined {
  const kernel = KERNELS[operator];
  if (kernel === undefined || ops.length !== kernel.arity) return undefined;

  // The operator must be the library's own: a redefined `Add` has its own
  // element function.
  if (!isLibraryOperator(ce, operator)) return undefined;

  if (!atMachinePrecision(ce)) return undefined;

  let length: number | undefined = undefined;
  const columns: (readonly number[] | number)[] = [];
  for (const op of ops) {
    const list = machineListOf(op);
    if (list !== undefined) {
      const values = list.array;
      if (values === undefined) return undefined;
      if (length !== undefined && values.length !== length) return undefined;
      length = values.length;
      if (!holdsDoubles(list)) return undefined;
      columns.push(values);
      continue;
    }
    const k = machineNumberOf(op);
    if (k === undefined || !Number.isFinite(k) || isExactNonInteger(op, k))
      return undefined;
    if (!isStoredAsDouble(op)) return undefined;
    columns.push(k);
  }
  if (length === undefined || length === 0) return undefined;

  const out = new Array<number>(length);
  const a = columns[0];
  const b = columns[1];
  for (let i = 0; i < length; i++) {
    if ((i & DEADLINE_STRIDE) === DEADLINE_STRIDE)
      checkDeadline(ce._deadlineFrame);
    const x = typeof a === 'number' ? a : a[i];
    const y = b === undefined ? 0 : typeof b === 'number' ? b : b[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
    const r = kernel.apply(x, y);
    if (!Number.isFinite(r)) return undefined;
    // An integer past the safe range: `ce.number()` makes it an exact big
    // integer, which is not the value the interpreter holds when an operand
    // was a float, and the double may not be the exact sum or product when
    // both operands were integers.
    if (Number.isInteger(r) && !Number.isSafeInteger(r)) return undefined;
    if (
      Number.isInteger(x) &&
      Number.isInteger(y) &&
      !(Number.isSafeInteger(x) && Number.isSafeInteger(y))
    )
      return undefined;
    // `-0` is stored as `0`, as the `array` of a list stores it.
    out[i] = r === 0 ? 0 : r;
  }
  return ce.list(out);
}

/** Does the engine compute a float as a double? The test is the one
 * `bignumPreferred()` makes (`boxed-expression/utils.ts`); that module cannot
 * be imported here, because it imports, through the operator definitions,
 * the module that imports this one. */
function atMachinePrecision(ce: Expression['engine']): boolean {
  return ce.precision <= MACHINE_PRECISION;
}

interface MachineKernel {
  arity: 1 | 2;
  /** The second argument is `0` for a kernel of arity 1. */
  apply: (x: number, y: number) => number;
}

const KERNELS: Record<string, MachineKernel> = {
  Add: { arity: 2, apply: (x, y) => x + y },
  Multiply: { arity: 2, apply: (x, y) => x * y },
  Negate: { arity: 1, apply: (x) => -x },
};

/** Is the definition of `operator` that evaluation uses the one the standard
 * library declared? A host can declare its own `Add` in a scope; its element
 * function is then unknown to this module. */
function isLibraryOperator(
  ce: Expression['engine'],
  operator: string
): boolean {
  const def = ce.lookupDefinition(operator);
  if (def === undefined) return false;
  let scope = ce.context.lexicalScope;
  while (scope.parent) scope = scope.parent;
  return scope.bindings.get(operator) === def;
}

/**
 * The `List` of machine numbers that `x` is, or that the symbol `x` holds, or
 * `undefined`.
 *
 * The value of a symbol is READ (`value`), never evaluated. A list of machine
 * numbers is written-out data, which evaluates to itself, so reading it is
 * the same as evaluating it. Any other value is not this function's to
 * evaluate: the caller then takes the route it took before, which evaluates
 * the symbol, and an evaluation made here would be a second one (work done
 * twice, and an effect run twice if the value has one). A symbol that holds
 * another symbol is followed, a few steps at most, so that a cycle ends.
 */
export function machineListOf(x: Expression): Expression | undefined {
  let list: Expression | undefined = x;
  for (let hops = 0; list !== undefined && isSymbol(list); hops++) {
    if (hops === 4) return undefined;
    list = list.value;
  }
  if (list === undefined) return undefined;
  if (!isFunction(list, 'List') || list.isMachineNumeric !== true)
    return undefined;
  return list;
}

/**
 * Is this number stored in a form whose arithmetic is that of doubles: a
 * machine number, or an exact value? `false` for a float that holds decimal
 * digits (a big-number float), whose arithmetic is decimal whatever the
 * precision of the engine is now.
 */
export function isStoredAsDouble(x: Expression): boolean {
  if (!isNumber(x)) return false;
  const value = x.numericValue;
  if (typeof value === 'number' || value.isExact) return true;
  return typeof (value as { decimal?: unknown }).decimal === 'number';
}

/**
 * The list that holds `elements` unboxed (`ce.list()`), when that list is the
 * same list: the engine is at machine precision, and every element is a
 * machine number that `ce.number()` of its double reproduces, exactness
 * included (no exact rational such as `1/2`), and that computes as a double
 * ({@link isStoredAsDouble}). `undefined` otherwise, and for no element.
 *
 * A list built this way answers `array`, `isMachineNumeric` and its type
 * without a walk of its elements, which an ordinary `List` of ten thousand
 * boxed numbers pays (about 10 ms) each time a new one is made.
 */
export function machineListFrom(
  ce: Expression['engine'],
  elements: ReadonlyArray<Expression>
): Expression | undefined {
  const n = elements.length;
  if (n === 0 || !atMachinePrecision(ce)) return undefined;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    if ((i & DEADLINE_STRIDE) === DEADLINE_STRIDE)
      checkDeadline(ce._deadlineFrame);
    const el = elements[i];
    const x = machineNumberOf(el);
    if (x === undefined || isExactNonInteger(el, x) || !isStoredAsDouble(el))
      return undefined;
    // `ce.number()` makes an integer past the safe range an exact big
    // integer, which the element may not be (a float with an integer value).
    if (Number.isInteger(x) && !Number.isSafeInteger(x)) return undefined;
    out[i] = x === 0 ? 0 : x;
  }
  return ce.list(out);
}

/** The answer of {@link holdsDoubles} for a list, which does not change: the
 * operands of a boxed list are immutable. */
const holdsDoublesMemo = new WeakMap<Expression, boolean>();

/** Is every element of this machine-numeric list stored as a double
 * ({@link isStoredAsDouble})? A list that holds its numbers unboxed is, by
 * construction. */
export function holdsDoubles(list: Expression): boolean {
  if (!isFunction(list)) return false;
  if (list._numericStore !== undefined) return true;
  let answer = holdsDoublesMemo.get(list);
  if (answer === undefined) {
    answer = list.ops.every(isStoredAsDouble);
    holdsDoublesMemo.set(list, answer);
  }
  return answer;
}

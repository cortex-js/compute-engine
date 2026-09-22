import type { Expression } from '../types-expression.js';
import { isFunction, isNumber, isSymbol } from './type-guards.js';
import { isExactNonInteger, machineNumberOf } from './machine-number.js';
import { MACHINE_PRECISION, roundHalfAway } from '../numerics/numeric.js';
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
 * - **Heads.** `Add` and `Multiply` of two or more operands, `Negate`, and
 *   the functions of one machine number that {@link FUNCTION_KERNELS} and
 *   {@link powerKernel} list, each with the inputs it must decline. A sum or
 *   a product of two doubles is one correctly rounded operation, in any
 *   order. With three or more operands the interpreter combines the exact
 *   operands (the integers) first and then adds the floats, and the fold
 *   here does the same, so that a cancellation among the integers is exact
 *   (`1e15 + 1e-5 − 1e15` is `1e-5`, not `0`); the floats are then added
 *   left to right, and the last digit of a cell can differ from the
 *   element-by-element value. A change in the last digit of a float is
 *   accepted for the performance (user decision, 2026-09-21); an exact value
 *   is never changed.
 */
export function machineBroadcast(
  ce: Expression['engine'],
  operator: string,
  ops: ReadonlyArray<Expression>,
  numericApproximation = false
): Expression | undefined {
  if (!atMachinePrecision(ce)) return undefined;

  const kernel = KERNELS[operator];
  if (kernel === undefined) {
    if (!isLibraryOperator(ce, operator)) return undefined;
    return machineFunctionBroadcast(ce, operator, ops, numericApproximation);
  }
  if (kernel.arity === 1 ? ops.length !== 1 : ops.length < 2) return undefined;

  // The operator must be the library's own: a redefined `Add` has its own
  // element function.
  if (!isLibraryOperator(ce, operator)) return undefined;

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
  const cell = new Array<number>(columns.length);
  for (let i = 0; i < length; i++) {
    if ((i & DEADLINE_STRIDE) === DEADLINE_STRIDE)
      checkDeadline(ce._deadlineFrame);
    for (let c = 0; c < columns.length; c++) {
      const column = columns[c];
      const x = typeof column === 'number' ? column : column[i];
      if (!Number.isFinite(x)) return undefined;
      // An integer past the safe range is an exact big integer in the
      // interpreter, which the double does not hold.
      if (Number.isInteger(x) && !Number.isSafeInteger(x)) return undefined;
      cell[c] = x;
    }
    const r =
      kernel.arity === 1
        ? kernel.apply(cell[0], 0)
        : foldExactFirst(kernel, cell);
    // A `NaN` or an infinite result, and an integer result past the safe
    // range (an exact big integer in the interpreter when every operand is
    // an integer, and not the value it holds when one is a float), are
    // decided by the interpreter.
    if (r === undefined || !Number.isFinite(r)) return undefined;
    if (Number.isInteger(r) && !Number.isSafeInteger(r)) return undefined;
    // `-0` is stored as `0`, as the `array` of a list stores it.
    out[i] = r === 0 ? 0 : r;
  }
  return ce.list(out);
}

/**
 * A function of one machine number, computed on doubles for a whole list.
 *
 * `apply` is the primitive the interpreter's scalar route calls for a
 * machine number, measured bit for bit on 3,000 random floats per head under
 * `evaluate()` and under `N()`; a kernel whose head takes another route on
 * some input declines that input:
 *
 * - `routes`: `'N'` for a head whose `evaluate()` recognizes special
 *   arguments and answers an exact value for them: the inverse trigonometric
 *   functions (`Arcsin(0.5)` is `π/6`), and a power of `e` (`√e` for the
 *   exponent `0.5`). Under `N()` every such head computes the primitive.
 * - `avoid`: the arguments that `evaluate()` recognizes, for a head that
 *   computes the primitive on every other argument. The trigonometric
 *   functions answer an exact value for a float within `1e-12` of a special
 *   angle (`Sin(3.141592653589793)` is `0`, `Cos(π/3)` is `1/2`, and a tiny
 *   argument is a special angle too: `Sin(1e-300)` is `0`): see
 *   `nearSpecialAngle`.
 * - `integers`: whether an integer element is admitted under `evaluate()`.
 *   `Sinh(1)` and `Sqrt(2)` are exact there, `|−3|`, `⌊2.5⌋` and `3^2`
 *   are the integers the primitive gives. Under `N()` an integer element is
 *   admitted by every kernel: the interpreter numericizes it, and where it
 *   answers an exact value (`Sqrt(4)`, `Sinh(0)`) that value is the double.
 * - `domain`: the arguments with a finite real value. A negative argument of
 *   `Sqrt` or `Ln` has a complex value; `Arcsin` outside `[−1, 1]` too.
 * - `bound`: `Tan` and its three relatives answer the pole `~oo` when the
 *   primitive's value passes a million in magnitude.
 * - The trigonometric heads read `ce.angularUnit`: in another unit than
 *   radians the argument is converted first, which the kernel does not do.
 */
interface MachineFunctionKernel {
  apply: (x: number) => number;
  routes: 'both' | 'N';
  integers: boolean;
  domain?: (x: number) => boolean;
  avoid?: (x: number) => boolean;
  bound?: number;
  angle?: boolean;
}

const POLE_BOUND = 1e6;

/**
 * Is `x` an angle (in radians) that `evaluate()` of a trigonometric function
 * may answer an exact value for?
 *
 * The recognizer (`constructibleValues`, `boxed-expression/trigonometry.ts`)
 * reduces the angle to `[0, π/2)` with the two remainders below, and answers
 * an exact value when the remainder is within `1e-12` of `π·n/d` for a
 * fraction `n/d` of its table, whose denominators all divide 120. The test
 * here is the same reduction, followed by the distance to the nearest
 * multiple of `π/120` with a tolerance a thousand times wider: every angle
 * the recognizer answers is within it, and an angle that is within it and
 * that the recognizer does not answer takes the general route, which
 * computes the same primitive.
 */
function nearSpecialAngle(x: number): boolean {
  const theta = Math.abs(x % (2 * Math.PI)) % (Math.PI / 2);
  const step = Math.PI / 120;
  const r = theta % step;
  return r <= 1e-9 || step - r <= 1e-9;
}

const FUNCTION_KERNELS: Record<string, MachineFunctionKernel> = {
  Sin: {
    apply: Math.sin,
    routes: 'both',
    integers: false,
    angle: true,
    avoid: nearSpecialAngle,
  },
  Cos: {
    apply: Math.cos,
    routes: 'both',
    integers: false,
    angle: true,
    avoid: nearSpecialAngle,
  },
  Tan: {
    apply: Math.tan,
    routes: 'both',
    integers: false,
    angle: true,
    avoid: nearSpecialAngle,
    bound: POLE_BOUND,
  },
  Cot: {
    apply: (x) => 1 / Math.tan(x),
    routes: 'both',
    integers: false,
    angle: true,
    avoid: nearSpecialAngle,
    bound: POLE_BOUND,
  },
  Sec: {
    apply: (x) => 1 / Math.cos(x),
    routes: 'both',
    integers: false,
    angle: true,
    avoid: nearSpecialAngle,
    bound: POLE_BOUND,
  },
  Csc: {
    apply: (x) => 1 / Math.sin(x),
    routes: 'both',
    integers: false,
    angle: true,
    avoid: nearSpecialAngle,
    bound: POLE_BOUND,
  },
  Arctan: { apply: Math.atan, routes: 'N', integers: false, angle: true },
  Arcsin: {
    apply: Math.asin,
    routes: 'N',
    integers: false,
    angle: true,
    domain: (x) => x >= -1 && x <= 1,
  },
  Arccos: {
    apply: Math.acos,
    routes: 'N',
    integers: false,
    angle: true,
    domain: (x) => x >= -1 && x <= 1,
  },
  Sinh: { apply: Math.sinh, routes: 'both', integers: false },
  Cosh: { apply: Math.cosh, routes: 'both', integers: false },
  Tanh: { apply: Math.tanh, routes: 'both', integers: false },
  Ln: {
    apply: Math.log,
    routes: 'both',
    integers: false,
    domain: (x) => x > 0,
  },
  // `Math.log10` and `Math.log2` are the primitives of the `N()` route and
  // of the compiled code; `evaluate()` of a scalar computes the logarithm
  // another way and differs from them in the last digit on about half of
  // the arguments, which is accepted (see the note on the heads above).
  Log: {
    apply: Math.log10,
    routes: 'both',
    integers: false,
    domain: (x) => x > 0,
  },
  Lb: {
    apply: Math.log2,
    routes: 'both',
    integers: false,
    domain: (x) => x > 0,
  },
  Sqrt: {
    apply: Math.sqrt,
    routes: 'both',
    integers: false,
    domain: (x) => x >= 0,
  },
  Abs: { apply: Math.abs, routes: 'both', integers: true },
  Floor: { apply: Math.floor, routes: 'both', integers: true },
  Ceil: { apply: Math.ceil, routes: 'both', integers: true },
  // A half rounds AWAY FROM ZERO at every precision (`Round(-0.5)` is `-1`,
  // `Round(2.5)` is `3`; user decision, 2026-09-21), which is what the scalar
  // route answers. JavaScript `Math.round` rounds a half toward `+∞`, so the
  // kernel is `roundHalfAway`, not the bare primitive.
  Round: { apply: roundHalfAway, routes: 'both', integers: true },
};

/**
 * The kernel of `Power` with a machine-number exponent `k`, or of a power
 * of `e` with a list exponent, as {@link machineFunctionBroadcast} applies it.
 *
 * A power of a machine float is `x ** k` (`Math.pow`), measured bit for bit
 * against the scalar route for `k` from −5 to 7 (an exponent of −1 never
 * arrives: `Power(x, −1)` is canonically `Divide(1, x)`). An integer element
 * is admitted only for a positive integer `k`, where the interpreter answers
 * the exact integer the primitive gives; a negative `k` gives an exact
 * rational, and a non-integer `k` a value the interpreter may keep exact. A
 * non-integer `k` needs a non-negative base (a negative base has a complex
 * value), and a negative `k` a non-zero base (the pole is `~oo`). A power of `e` is `Math.exp` (the same primitive as
 * `Exp(x).evaluate()`), under `N()` only: `evaluate()` keeps `e^2` and
 * answers `√e` for `e^0.5`.
 */
function powerKernel(
  ce: Expression['engine'],
  ops: ReadonlyArray<Expression>,
  numericApproximation: boolean
): [MachineFunctionKernel, Expression] | undefined {
  if (ops.length !== 2) return undefined;
  const [base, exponent] = ops;
  if (numericApproximation && base === ce.E.N())
    return [{ apply: Math.exp, routes: 'N', integers: true }, exponent];
  const k = machineNumberOf(exponent);
  if (
    k === undefined ||
    !Number.isFinite(k) ||
    k === 0 ||
    isExactNonInteger(exponent, k) ||
    !isStoredAsDouble(exponent)
  )
    return undefined;
  if (Number.isInteger(k)) {
    if (k > 0)
      return [{ apply: (x) => x ** k, routes: 'both', integers: true }, base];
    return [
      {
        apply: (x) => x ** k,
        routes: 'both',
        integers: false,
        domain: (x) => x !== 0,
      },
      base,
    ];
  }
  return [
    {
      apply: (x) => x ** k,
      routes: 'both',
      integers: false,
      domain: (x) => x >= 0,
    },
    base,
  ];
}

/**
 * `operator` applied to every element of a `List` of machine numbers, on
 * doubles, when a kernel exists for it ({@link FUNCTION_KERNELS},
 * {@link powerKernel}) and every element is one the kernel gives the
 * interpreter's value for; `undefined` otherwise. The result of every
 * element must be finite (a `NaN` or an infinite result means a value the
 * interpreter decides another way), and an integer result past the safe
 * range declines as in {@link machineBroadcast}.
 */
function machineFunctionBroadcast(
  ce: Expression['engine'],
  operator: string,
  ops: ReadonlyArray<Expression>,
  numericApproximation: boolean
): Expression | undefined {
  let kernel: MachineFunctionKernel | undefined;
  let operand: Expression | undefined;
  if (operator === 'Power') {
    const found = powerKernel(ce, ops, numericApproximation);
    if (found === undefined) return undefined;
    [kernel, operand] = found;
  } else if (operator === 'Log' && ops.length === 2) {
    // `Lb(x)` is canonically `Log(x, 2)`. A base of 2 or 10 has its own
    // primitive on the scalar route (`Math.log2`, `Math.log10`); another base
    // is a quotient of two logarithms and has no kernel.
    const base = machineNumberOf(ops[1]);
    if (base !== 2 && base !== 10) return undefined;
    kernel = FUNCTION_KERNELS[base === 2 ? 'Lb' : 'Log'];
    operand = ops[0];
  } else {
    if (ops.length !== 1) return undefined;
    kernel = FUNCTION_KERNELS[operator];
    operand = ops[0];
  }
  if (kernel === undefined) return undefined;
  if (kernel.routes === 'N' && !numericApproximation) return undefined;
  if (kernel.angle && ce.angularUnit !== 'rad') return undefined;

  const list = machineListOf(operand);
  if (list === undefined || !holdsDoubles(list)) return undefined;
  const values = list.array;
  if (values === undefined || values.length === 0) return undefined;

  const admitsIntegers = numericApproximation || kernel.integers;
  const out = new Array<number>(values.length);
  for (let i = 0; i < values.length; i++) {
    if ((i & DEADLINE_STRIDE) === DEADLINE_STRIDE)
      checkDeadline(ce._deadlineFrame);
    const x = values[i];
    if (!Number.isFinite(x)) return undefined;
    if (!admitsIntegers && Number.isInteger(x)) return undefined;
    if (kernel.domain !== undefined && !kernel.domain(x)) return undefined;
    if (!numericApproximation && kernel.avoid !== undefined && kernel.avoid(x))
      return undefined;
    const r = kernel.apply(x);
    if (!Number.isFinite(r)) return undefined;
    if (kernel.bound !== undefined && Math.abs(r) > kernel.bound)
      return undefined;
    if (Number.isInteger(r) && !Number.isSafeInteger(r)) return undefined;
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

/**
 * The fold of one cell of an `Add` or a `Multiply` over `values`, in the
 * interpreter's order: the integers first (an exact partial result, which
 * declines past the safe range), then the floats from left to right.
 * `undefined` when an exact partial result leaves the safe range.
 */
function foldExactFirst(
  kernel: MachineKernel,
  values: readonly number[]
): number | undefined {
  let exact: number | undefined = undefined;
  for (const x of values) {
    if (!Number.isInteger(x)) continue;
    exact = exact === undefined ? x : kernel.apply(exact, x);
    if (!Number.isSafeInteger(exact)) return undefined;
  }
  let r = exact;
  for (const x of values) {
    if (Number.isInteger(x)) continue;
    r = r === undefined ? x : kernel.apply(r, x);
  }
  return r;
}

interface MachineKernel {
  /** One operand, or two or more: the integers first, then the floats. */
  arity: 1 | 'n';
  /** The second argument is `0` for a kernel of arity 1. */
  apply: (x: number, y: number) => number;
}

const KERNELS: Record<string, MachineKernel> = {
  Add: { arity: 'n', apply: (x, y) => x + y },
  Multiply: { arity: 'n', apply: (x, y) => x * y },
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

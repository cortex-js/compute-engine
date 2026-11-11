/**
 * The structured representation of a program of scalars and lists that it
 * reads and makes: its values, regions, operations and effect facts. The representation names no target: a
 * target gives each value a representation (a string that the target
 * chooses, such as `number` on JavaScript or `float` on GLSL), and the
 * verifier (`structured-verify.ts`) checks the representations against the
 * policy of that target.
 *
 * A program is lowered by a target from the prepared root and its
 * annotation (`javascript-structured-lower.ts` for JavaScript) after the
 * representation of each value is chosen. Each value is defined once and
 * has an id that is unique in its program. A write to a local makes a new
 * value; no operation writes a named variable. Operations are ordered in
 * regions. A region ends in one `yield`, whose operands are the values of
 * the region. A value that a region defines is visible in that region,
 * after its definition, and in the regions nested in it; a value of a
 * branch leaves the branch only through its `yield`: an `if` whose branches
 * write locals has one result per merged local.
 *
 * A `loop` runs its body region once per integer of a range. The body has
 * parameters: the index, and one parameter per value that an iteration
 * gives to the next one (a carried value). The body yields the next value
 * of each carried value, and the loop has one result per carried value.
 *
 * A region is open or closed (`isClosedRegion()`). An open region ends in
 * its yield. A closed region ends in an `exit` (`IRExit`), which leaves the
 * innermost loop, or in an `if` whose two branches are closed; it has no
 * yield. Only a branch of an `if` can be closed.
 *
 * There is no common-subexpression pass, no reordering and no collection:
 * each occurrence of a prepared node gives its own operations, in the order
 * of the prepared tree.
 *
 * The design is `docs/plans/2026-11-09-js-structured-scalar-emitter.md`,
 * "Representation and verifier" and "Effects are part of the prepared
 * contract", and the objectives of
 * `docs/plans/2026-11-09-js-compiler-status-and-plan.md`, "Objectives for
 * the representation".
 */
import type { Expression } from '../global-types.js';

/**
 * What the evaluation of an operation can do besides giving its value.
 * `pure`: nothing. `effectful`: an effect that the definition states (an
 * impurity label); the operation names the states that it touches
 * (`IRState`). `unknown`: the definition does not state its effects.
 * `unknown` never permits a reordering or a merge.
 */
export type EffectFact = 'pure' | 'effectful' | 'unknown';

/**
 * A state outside the program that an `effectful` operation reads or
 * changes, by the name of the impurity label of its definition. `random` is
 * the random stream of the runtime, which a `draw` reads and advances: one
 * state, not one per generator, because which generator a draw uses (the
 * frame of a `seeded` region, the frame of a caller, or the live source) is
 * decided when the code runs. A test operation names the labels that its
 * declaration states (`console`).
 */
export type IRState = string;

/** The semantic type of a scalar value. */
export type ScalarKind = 'real' | 'integer' | 'boolean' | 'complex';

/** A list of elements of one scalar kind. The length is not part of the
 *  type: two lists of the same element type and different lengths have one
 *  type. A list is a value: no operation changes a list. */
export type ListType = `list<${ScalarKind}>`;

/** The semantic type of a value: a scalar or a list. */
export type ValueType = ScalarKind | ListType;

/** The kind of the elements of `type`, or `undefined` when `type` is not a
 *  list type. */
export function elementOf(type: ValueType): ScalarKind | undefined {
  return type.startsWith('list<')
    ? (type.slice(5, -1) as ScalarKind)
    : undefined;
}

/** The name of a representation of a target (`RepresentationPolicy`). */
export type Representation = string;

export type IRValue = {
  /** The program that defines the value (`IRProgram.owner`). */
  readonly owner: object;
  readonly revision: number;
  /** Unique in the program. */
  readonly id: number;
  readonly type: ValueType;
  readonly representation: Representation;
};

type OperationBase = {
  readonly result: IRValue;
  /** The values that the operation reads, evaluated before it. */
  readonly operands: readonly IRValue[];
  readonly effect: EffectFact;
  /** The states that the evaluation touches (`IRState`), sorted, with no
   *  duplicate; absent when there is none. An `effectful` operation with no
   *  region and no call names at least one; a `pure` operation, and an
   *  `unknown` one with no region and no call, name none. An operation that
   *  evaluates a region or calls a function names the states of that region
   *  or of the body of that function too, so a summary keeps the named
   *  states apart from `unknown`. */
  readonly touches?: readonly IRState[];
  /** The prepared node that the operation comes from. */
  readonly origin: Expression;
};

/** A number, a boolean or a complex number. */
export type IRLiteral = OperationBase & {
  readonly kind: 'literal';
  readonly value:
    number | boolean | { readonly re: number; readonly im: number };
};

/** A read of the input `IRProgram.inputs[input]` at this position. */
export type IRInputRead = OperationBase & {
  readonly kind: 'input';
  readonly input: number;
};

/** An operation of the operands, which are already in the representation
 *  of the operation. `sqrt` is the principal square root of its one
 *  operand: a real result for a real operand (not a number for a negative
 *  one), a complex result for a complex operand. The rule of the target
 *  decides which of the two an occurrence is, and a real operand of a
 *  complex `sqrt` is converted first.
 *
 *  `add` of a complex result has at least one complex operand; a real
 *  operand of it is not converted, and adds to the real part only.
 *  `multiply` of a complex result has two operands, at least one of them
 *  complex. A real operand `a` of it is not converted: the product of `a`
 *  and a complex `b` is `(a·b.re, a·b.im)`, where the product of the
 *  converted `a + 0i` would add the terms `0·b.im` and `0·b.re`, which are
 *  not a number for an infinite part. Two complex operands give
 *  `(a.re·b.re - a.im·b.im, a.re·b.im + a.im·b.re)`. `mod` is the
 *  floored remainder: its result has the sign of the divisor, as the
 *  interpreter gives it (`Mod(-7, 3)` is `2`, `Mod(7, -3)` is `-2`,
 *  `Mod(-7.5, 2)` is `0.5`), and a zero divisor gives not a number.
 *  `floor` has an integer result. `divide` has a real result for real
 *  operands, also for integer operands, and a complex result exactly when
 *  an operand is complex; a complex `divide` has two operands, and a real
 *  operand of it is not converted. Its value for a real divisor `b` is the
 *  quotient of each part of the dividend by `b`. For a complex divisor it
 *  is the quotient of the interpreter (`complexQuotient()` in
 *  `numerics/numeric-complex.ts`): the textbook formula
 *  `((a.re·b.re + a.im·b.im) / d, (a.im·b.re - a.re·b.im) / d)` with
 *  `d = b.re² + b.im²`, where that formula is accurate, and a scaled
 *  quotient, a pole or not a number elsewhere. A real dividend `a` reads as
 *  the parts `a` and `0` in the test of accuracy, and its products are
 *  `a·b.re` and `-a·b.im`. `not` is the negation of one boolean operand.
 *  `not-equal` is the negation of `equal`: true when an operand is not a
 *  number. */
export type IRArithmetic = OperationBase & {
  readonly kind:
    | 'add'
    | 'negate'
    | 'not'
    | 'multiply'
    | 'less'
    | 'less-equal'
    | 'equal'
    | 'not-equal'
    | 'min'
    | 'max'
    | 'sqrt'
    | 'mod'
    | 'floor'
    | 'divide';
};

/**
 * The functions of one operand that the representation names, by an
 * identifier that names no target. Each is defined on the real and the
 * complex numbers:
 *
 * - `exp`, `sin`, `cos` and `tanh`: a real result for a real operand, a
 *   complex result for a complex operand.
 * - `ln`: the natural logarithm. A real result for a real operand (not a
 *   number for a negative operand, minus infinity for 0), the principal
 *   complex logarithm for a complex operand. As for `sqrt`, the rule of the
 *   target decides which of the two an occurrence is, and a real operand of
 *   a complex `ln` is converted first.
 * - `abs`: the absolute value, or the modulus of a complex operand. The
 *   result is real; it is an integer for an integer operand.
 * - `cbrt`: the cube root. The real cube root for a real operand, negative
 *   for a negative operand (`cbrt(-8)` is `-2`), the principal complex cube
 *   root for a complex operand. As for `ln`, the rule of the target decides
 *   which of the two an occurrence is.
 * - `tan`, `cot`, `sec`, `csc`, `sinh`, `cosh`, `atan`, `asinh`, `gamma`
 *   (the gamma function Γ) and `sign` (`-1`, `0` or `1` for a real
 *   operand, `z/|z|` for a complex one): as `exp`.
 * - `conjugate`: the complex conjugate `a - bi` of `a + bi`, as `exp`; a
 *   real operand is its own conjugate.
 * - `asin`, `acos`, `acosh` and `atanh`: as `ln`, the rule of the target
 *   decides whether an occurrence with a real operand is real (`NaN` off
 *   the real domain) or complex (the principal value, the real operand
 *   converted first).
 * - `log10` and `log2`: the logarithms in base 10 and 2, as `ln`.
 * - `erf`, `erfc` (`1 - erf`), `digamma` (the derivative of `ln Γ`),
 *   `haversine` (`(1 - cos x) / 2`), `sinpi`, `cospi` and `tanpi` (the sine,
 *   cosine and tangent of `π·x`, exact at the integers and the halves of
 *   integers: `sinpi(1)` is `0`): a real operand and a real result.
 * - `ceil` (the least integer not less than the operand) and
 *   `round-ties-away` (the nearest integer, a tie away from zero:
 *   `-2.5` gives `-3`): a real operand and a real result whose value is an
 *   integer, `NaN` or infinite.
 *
 * Only `abs` has an integer result, and only for an integer operand.
 */
export type UnaryFunctionName =
  | 'exp'
  | 'ln'
  | 'sin'
  | 'cos'
  | 'tanh'
  | 'abs'
  | 'cbrt'
  | 'tan'
  | 'cot'
  | 'sec'
  | 'csc'
  | 'sinh'
  | 'cosh'
  | 'atan'
  | 'asinh'
  | 'gamma'
  | 'sign'
  | 'conjugate'
  | 'asin'
  | 'acos'
  | 'acosh'
  | 'atanh'
  | 'log10'
  | 'log2'
  | 'erf'
  | 'erfc'
  | 'digamma'
  | 'haversine'
  | 'sinpi'
  | 'cospi'
  | 'tanpi'
  | 'ceil'
  | 'round-ties-away';

/**
 * The functions of two operands that the representation names, by an
 * identifier that names no target. Each has two real operands and a real
 * result, except `complex`, and `pow` of complex operands:
 *
 * - `atan2(y, x)` is the angle of the point `(x, y)` from the positive first
 *   axis, in `[-π, π]`.
 * - `pow(b, e)` is the power `b^e` with the convention of the interpreter
 *   for a real base and a real exponent: `0^0` is not a number; a negative
 *   base with an exponent that is not an integer has the real root when the
 *   interpreter reads the exponent as a rational `p/q` with an odd `q`
 *   (`|b|^e`, negative when `p` is odd: `(-8)^(1/3)` is `-2`), and is not a
 *   number for another exponent; every other pair has the power of the
 *   real numbers (`(-2)^3` is `-8`, `0^(-1)` is infinity). For two complex
 *   operands the result is complex, and continues the real convention:
 *   `0^w` is `0` for `Re w > 0`, the pole for a negative real `w`, and not
 *   a number otherwise; two operands whose imaginary parts are zero have the
 *   real value of the real `pow` where it has one (`(-8)^(1/3)` is `-2`);
 *   every other pair has the principal value `exp(w·ln b)`.
 * - `complex(re, im)` is the complex number of the real part `re` and the
 *   imaginary part `im`: two real operands, a complex result.
 * - `abs-pow(b, e)` is `|b|^e`, the power of the absolute value of `b`, with
 *   `|b|^0 = 1` also for `b = 0`.
 * - `signed-pow(b, e)` is `|b|^e` when `b` is not negative, and `-(|b|^e)`
 *   when `b < 0`: `-0` gives `0^e`.
 * - `real-pow(b, e)` is the power `b^e` of floating-point numbers, with the
 *   special values of the `pow` function of IEEE 754 for a finite `e`:
 *   `b^0 = 1` for every `b`; a negative finite base with an exponent that
 *   is not an integer is not a number (unlike `pow`, it takes no real
 *   root); `0^e` is infinity for a negative `e`, with the sign of the base
 *   for an odd integer `e` (`(-0)^(-3)` is minus infinity). The value for
 *   an exponent that is not finite is not defined here: the rules of the
 *   targets write `real-pow` only for a constant, finite exponent.
 * - `root(x, n)` is the real `n`-th root with the convention of the
 *   interpreter: for a negative `x`, `-(|x|^(1/n))` when `n` is an odd
 *   integer (`root(-8, 3)` is `-2`), the real root of `pow` when the
 *   interpreter reads `1/n` as a rational with an odd denominator, and not
 *   a number otherwise; `real-pow(x, 1/n)` for every other `x`.
 *
 * `abs-pow` and `signed-pow` are the real-root convention of the
 * interpreter for a constant exponent `e = p/q` with an odd `q` (`p` even
 * and `p` odd), decided when the program is made: the rule of the target
 * chooses one of them from the exponent.
 */
export type BinaryFunctionName =
  | 'atan2'
  | 'pow'
  | 'abs-pow'
  | 'signed-pow'
  | 'real-pow'
  | 'root'
  | 'complex';

/**
 * An application of a function of one operand (`unary`) or two operands
 * (`binary`) that `fn` names. One operation kind serves every such
 * function: the core checks the types of the operands and of the result by
 * the rule of the identifier (`UnaryFunctionName`, `BinaryFunctionName`),
 * the policy of a target says which identifiers it has and in which
 * representations, and the emitter of the target writes the code of each
 * identifier. A function of this kind is `pure`.
 */
export type IRUnaryFunction = OperationBase & {
  readonly kind: 'unary';
  readonly fn: UnaryFunctionName;
};

export type IRBinaryFunction = OperationBase & {
  readonly kind: 'binary';
  readonly fn: BinaryFunctionName;
};

/**
 * A read of a list. Both are `pure`: a list is a value, and no operation
 * changes it.
 *
 * - `at`: the operands are a list and an integer index, counted from 1 as in
 *   the language; a negative index counts from the end (`-1` is the last
 *   element). The result has the type of an element. An index out of range
 *   (0, beyond the length, or beyond the length from the end) gives the
 *   absent value of the target for the element type: every other operation
 *   applied to that value is unspecified (`docs/COMPILATION-MODEL.md`,
 *   "Caveats of compiled code").
 * - `length`: the operand is a list; the result is the number of its
 *   elements, an integer.
 */
export type IRListRead = OperationBase & {
  readonly kind: 'at' | 'length';
};

/**
 * A list that the program makes. Both are `pure` when their regions are: a
 * list is a value, and the result is a new list value.
 *
 * - `build`: the operands are `from` and `to`, two integers evaluated once,
 *   before the first element. The body region has one parameter, the
 *   index, and yields one element, a real or an integer. The body is
 *   evaluated once per integer from `from` to `to`, both included, in
 *   steps of 1, or of -1 when `to` is less than `from`, as the interpreter
 *   iterates `Range(from, to)`: a range always has at least one element
 *   (`Range(1, 0)` has the elements 1 and 0). The result is the list of the
 *   elements in that order; it is a list of integers only when the body
 *   yields an integer. A `build` does not count passes of the iteration
 *   budget: the interpreter and the existing compiler count the passes of
 *   a `Loop`, not the elements of a `Comprehension`
 *   (`docs/COMPILATION-MODEL.md`, "Not covered" of the iteration budget).
 * - `replace-at`: the operands are a list, an integer index and an element.
 *   The result is a new list, equal to the list but for the element at the
 *   index, counted from 1; a negative index counts from the end. An index
 *   out of range (0, beyond the length) has no value: the interpreter keeps
 *   the expression unevaluated, and compiled code throws
 *   (`docs/COMPILATION-MODEL.md`, "Caveats of compiled code"). The result
 *   is a list of integers only when the list and the element are integers.
 *   The operand list is not changed. An emitter can write the result into
 *   the array of the operand when no later code reads that array
 *   (`inPlaceUpdates()` in `structured-in-place.ts`).
 */
export type IRBuild = OperationBase & {
  readonly kind: 'build';
  readonly body: IRRegion;
};

export type IRReplaceAt = OperationBase & {
  readonly kind: 'replace-at';
};

/**
 * A read of the captured binding `IRProgram.captures[capture]`: a binding
 * of the engine that the program reads and does not bind (not an input, a
 * parameter or a local). The operation carries the identity of the binding
 * (`binding`, the object of the engine that holds it), not only its name,
 * and the value that the read gives (`snapshot`).
 *
 * A read of a snapshot is `pure`: the value is fixed when the program is
 * compiled, and the read does not read the binding when the code runs. A
 * later change of the binding has no effect on the compiled code; a new
 * compilation reads the new value.
 *
 * Not implemented, and what each would add:
 *
 * - A read of a LIVE binding (the value of the binding when the code runs)
 *   would not be pure with respect to a write of that binding. It would add
 *   a read set to the operation: the bindings that it reads. Each region
 *   would carry the union of the read sets of its operations, and an
 *   operation that calls a function the read set of the body of the
 *   function. Two operations could then be reordered, or run at the same
 *   time, only when the read set of each is disjoint from the write set of
 *   the other.
 * - A WRITE of a captured binding would be an operation of its own, with a
 *   write set (the bindings that it writes), summarized per region and per
 *   function as the read sets are. Its effect fact would be `effectful`,
 *   and the write set would tell which reads it orders.
 */
export type IRCaptureRead = OperationBase & {
  readonly kind: 'capture';
  readonly capture: number;
  readonly binding: object;
  readonly snapshot: number;
};

/** A conversion that changes the representation, or the type of a value
 *  that a local of a wider type holds (an integer as a real). An identity
 *  conversion of an operand has no operation. The policy of the target
 *  names the conversions that it has (`RepresentationPolicy.conversions`). */
export type IRConvert = OperationBase & {
  readonly kind: 'convert';
  readonly conversion: string;
};

/**
 * The operand is the condition. Only the region that the condition selects
 * is evaluated. Each region yields one value per result, in the order of
 * `results`; the result `i` is the value `i` of the selected region.
 *
 * An `if` that is a value has one result. An `if` that is a statement has
 * one result per local that a branch writes and that is read after the
 * `if`: the merged value of the local. A branch that does not write the
 * local yields the value of the local before the `if`. Such an `if` can
 * have no result, when its branches write no local that is read later.
 *
 * A branch can be closed (`isClosedRegion()`): it ends in an `exit`, and
 * the code after the `if` does not run when it is selected. An `if` with
 * one closed branch takes its results from the open branch only; the closed
 * branch yields nothing. An `if` with two closed branches has no result, is
 * closed itself, and is the last operation of its region.
 */
export type IRIf =Omit<OperationBase, 'result'> & {
  readonly kind: 'if';
  readonly result?: undefined;
  readonly results: readonly IRValue[];
  readonly then: IRRegion;
  readonly else: IRRegion;
};

/**
 * A loop over the integers from `from` to `to`, both included, in steps of
 * 1, or of -1 when `to` is less than `from`, as the interpreter iterates
 * `Range(from, to)`: the range from 1 to 0 has the two elements 1 and 0.
 * The operands are `from`, `to` and the initial value of each carried
 * value, evaluated once, before the first iteration.
 *
 * The parameters of the body region are the index, then one parameter per
 * carried value, in the order of `results`. Each iteration evaluates the
 * body with the index and the values that the previous iteration yielded
 * (the initial values for the first iteration). The body yields the next
 * value of each carried value, in the same order. The result `i` is the
 * value of the carried value `i` after the last iteration, or its initial
 * value when the range has no element.
 *
 * An `exit` in the body (`IRExit`) ends the loop before the end of its
 * range: the result `i` is then the operand `i` of that `exit`. The body
 * itself is open: a body that always exits is not a loop of the
 * representation.
 *
 * `iterationBudget` is the iteration budget of the compilation, or
 * `undefined` when it has none. A target writes its own check of the
 * budget, with the rule of the existing compiler of that target.
 *
 * A loop with a budget can abort: over the budget, the call of the
 * compiled code ends with an error. An abort is not an effect: it changes
 * no state that the program reads, so the effect of the loop is the effect
 * of its body, and a pure value can move across the loop (computed before
 * or after it gives the same value when the loop does not abort, and no
 * value when it does). The region that holds such a loop records that it
 * can abort (`IRRegion.canAbort`). A transformation must not delete an
 * operation that can abort, run it when the program would not, or run it
 * more times than the program does: each changes whether the call aborts.
 */
export type IRLoop = Omit<OperationBase, 'result'> & {
  readonly kind: 'loop';
  readonly result?: undefined;
  readonly results: readonly IRValue[];
  readonly body: IRRegion;
  readonly iterationBudget?: number;
};

/**
 * `and` and `or`. The operand is the first operand of the source. Each
 * region of `rest` is the next operand: it is evaluated only when the
 * earlier operands do not decide the result (`false` for `and`, `true` for
 * `or`), as JavaScript `&&` and `||` do.
 */
export type IRShortCircuit = OperationBase & {
  readonly kind: 'and' | 'or';
  readonly rest: readonly IRRegion[];
};

/** A call of `IRProgram.functions[function]`. The operands are the
 *  arguments, evaluated once, in order, before the call. The effect of the
 *  call includes the effect of the body of the function, which includes the
 *  effect of each call in that body: the effect of a call is the effect of
 *  every function that it reaches. */
export type IRCall = OperationBase & {
  readonly kind: 'call';
  readonly function: number;
};

/** An operation that exists only for tests. Its effect is the one that its
 *  declaration states; `trace` names it in the trace that an emitter
 *  writes. */
export type IRTrace = OperationBase & {
  readonly kind: 'trace';
  readonly trace: string;
};

/**
 * The next number of the random stream of the runtime: no operand, a real
 * result in `[0, 1)`. It is `effectful` and touches exactly the state
 * `random`: it reads the stream and advances it. Which generator gives the
 * number is decided when the code runs: the frame of the innermost
 * `seeded` region, else the frame of the code that called the compiled
 * function (an interpreted `WithRandomSeed`), else the live source of the
 * engine. A random number of a literal domain is pure arithmetic around one
 * `draw`.
 */
export type IRDraw = OperationBase & {
  readonly kind: 'draw';
};

/**
 * A region evaluated once with a new frame of the random stream, seeded by
 * the seed: the structured form of `WithRandomSeed(seed, body)`. The seed is
 * the one operand (a real, or a complex in the `complex` mode), or, with no
 * operand, the literal `seed` (a finite number or a string). The body is an
 * open region with no parameter that yields one scalar value, the result.
 * The frame of the caller is in place again after the body, also when the
 * body throws.
 *
 * The effect of a `seeded` operation is the effect of its body without the
 * state `random` (the region discharges it): `pure` when the body touches no
 * other state and has no operation of `unknown` effect. An `unknown` body is
 * never discharged. A draw in the seed is an operation of the region that
 * holds the `seeded`, with its own effect. A seed that is not a literal can
 * be invalid, which throws: such a `seeded` can abort
 * (`operationCanAbort()`).
 */
export type IRSeeded = OperationBase & {
  readonly kind: 'seeded';
  readonly seed?: number | string;
  readonly body: IRRegion;
};

/** The last operation of an open region: its operands are the values of
 *  the region. A region of an `if` yields one value per result of the `if`,
 *  and the body of a `loop` one value per result of the `loop`; every other
 *  region yields one value. A closed region has no yield
 *  (`isClosedRegion()`). */
export type IRYield = {
  readonly kind: 'yield';
  readonly result?: undefined;
  readonly operands: readonly IRValue[];
  readonly effect: EffectFact;
  readonly touches?: undefined;
  readonly origin: Expression;
};

/**
 * The second way to end a region: the last operation of a closed region,
 * which ends the innermost `loop` that holds it. Its operands are the value,
 * at this point, of each carried value of that loop, in the order of the
 * results of the loop: the result `i` of the loop is the operand `i`. An
 * `exit` defines no value and has no effect (`pure`).
 *
 * Between the `exit` and the body of its loop there are only branches of
 * `if` operations: no region of a `build`, of an `and`, an `or` or a
 * `seeded`, and no body of a function. The `exit` passes values to the
 * results of the loop as the yield of the body does, so each value keeps
 * one definition.
 */
export type IRExit = {
  readonly kind: 'exit';
  readonly result?: undefined;
  readonly operands: readonly IRValue[];
  readonly effect: EffectFact;
  readonly touches?: undefined;
  readonly origin: Expression;
};

export type IROperation =
  | IRLiteral
  | IRInputRead
  | IRCaptureRead
  | IRArithmetic
  | IRUnaryFunction
  | IRBinaryFunction
  | IRListRead
  | IRBuild
  | IRReplaceAt
  | IRConvert
  | IRIf
  | IRLoop
  | IRShortCircuit
  | IRCall
  | IRTrace
  | IRDraw
  | IRSeeded
  | IRYield
  | IRExit;

export type IRRegion = {
  /** The values that the region defines at its entry, before its first
   *  operation: the parameters of the body of a `loop`, and the index of
   *  the body of a `build`. Each is visible in
   *  the region and in the regions nested in it. The body of a function
   *  has none: the parameters of a function are `IRFunction.parameters`,
   *  which the verifier defines at the entry of its body in the same way. */
  readonly parameters?: readonly IRValue[];
  readonly operations: readonly IROperation[];
  /** True when the evaluation of the region can abort
   *  (`operationCanAbort()` for one of its operations); absent otherwise.
   *  A region that can abort is never removed, also when it is `pure`. */
  readonly canAbort?: true;
  /** The join of the effects of the operations (`joinEffects()`). */
  readonly effect: EffectFact;
  /** The union of the states that the operations touch (`unionStates()`);
   *  absent when there is none. */
  readonly touches?: readonly IRState[];
};

export type IRInput = {
  readonly name: string;
  readonly type: ValueType;
  readonly representation: Representation;
  /** For a list input: the spelling of the element type that the program
   *  declares (`finite_real` for `list<finite_real>`), which the type
   *  `list<real>` does not keep. A label for a target that names the
   *  element type in its code or its messages; no check reads it. */
  readonly elementLabel?: string;
  /** A complex input that the host can give as a number or as a complex
   *  value (`{ re, im }`): a name with no declared type in the `complex`
   *  mode. Each read converts the value to a complex value, as the existing
   *  emitter does (`_SYS.cplx`, which keeps a complex value as it is). */
  readonly lifted?: true;
};

/** A binding that the program reads as a snapshot (`IRCaptureRead`). */
export type IRCapture = {
  /** The identity of the binding: the object of the engine that holds it.
   *  Two captures of a program have different bindings. */
  readonly binding: object;
  /** The name of the binding, for a message. */
  readonly name: string;
  readonly type: ScalarKind;
  readonly representation: Representation;
  /** The value of the binding when the program was compiled. */
  readonly snapshot: number;
};

/** A resolved helper, written once as a function of the program. A helper
 *  can call another helper; the body of a helper reads its parameters and
 *  the captures of the program, and no input. */
export type IRFunction = {
  readonly name: string;
  /** Defined at the entry of the body. */
  readonly parameters: readonly IRValue[];
  /** For each list parameter, the spelling of the element type that the
   *  helper declares (`IRInput.elementLabel`); `undefined` for another
   *  parameter. */
  readonly parameterElementLabels?: readonly (string | undefined)[];
  /** A scalar, or a list: the body of a helper can make a list. */
  readonly result: {
    readonly type: ValueType;
    readonly representation: Representation;
  };
  readonly body: IRRegion;
  readonly origin: Expression;
};

export type IRProgram = {
  /** Each lowering makes a new owner: a value of another program has
   *  another owner. */
  readonly owner: object;
  /** A transformation of the program makes a new revision. */
  readonly revision: number;
  readonly inputs: readonly IRInput[];
  /** The compile mode of the compilation. */
  readonly numericPolicy: 'strict' | 'complex';
  /** The bindings that the program reads as snapshots, in the root or in
   *  a function (`IRCaptureRead`). */
  readonly captures: readonly IRCapture[];
  readonly functions: readonly IRFunction[];
  readonly root: IRRegion;
};

const EFFECT_RANK: Readonly<Record<EffectFact, number>> = {
  pure: 0,
  effectful: 1,
  unknown: 2,
};

/** Whether the effect `a` is weaker than the effect `b` (`joinEffects()`
 *  orders them). */
export function weakerEffect(a: EffectFact, b: EffectFact): boolean {
  return EFFECT_RANK[a] < EFFECT_RANK[b];
}

/**
 * The effect of evaluating operations of the effects `effects`: the most
 * restrictive one. `unknown` includes `effectful`: an operation whose
 * effects are not stated can have any effect. Both forbid every
 * transformation (a merge, a duplication, a removal or a reordering). A
 * summary keeps the states that its `effectful` operations name apart
 * (`unionStates()`), so a region of the effect `unknown` still names them,
 * and a pass that removes a state (`seeded`, `dischargedEffect()`) can tell
 * a region whose only effects are named from a region with an `unknown`
 * operation.
 */
export function joinEffects(...effects: readonly EffectFact[]): EffectFact {
  let result: EffectFact = 'pure';
  for (const e of effects) if (EFFECT_RANK[e] > EFFECT_RANK[result]) result = e;
  return result;
}

/** The union of the states `states`, sorted, with no duplicate, or
 *  `undefined` when it is empty (`OperationBase.touches`). */
export function unionStates(
  ...states: readonly (readonly IRState[] | undefined)[]
): readonly IRState[] | undefined {
  const all = new Set<IRState>();
  for (const list of states) for (const s of list ?? []) all.add(s);
  return all.size === 0 ? undefined : [...all].sort();
}

/** `{ touches }` when `states` is not empty, else `{}`: the field of an
 *  operation or a region that touches `states` (`unionStates()`). */
export function touchesField(
  ...states: readonly (readonly IRState[] | undefined)[]
): { readonly touches?: readonly IRState[] } {
  const touches = unionStates(...states);
  return touches === undefined ? {} : { touches };
}

/**
 * The effect and the states of a `seeded` operation whose body has the
 * effect `effect` and the states `touches` (`IRSeeded`): the state `random`
 * is removed; an `effectful` body with no other state gives `pure`; an
 * `unknown` body stays `unknown`, since an operation whose effects are not
 * stated can touch any state.
 */
export function dischargedEffect(
  effect: EffectFact,
  touches: readonly IRState[] | undefined
): { readonly effect: EffectFact; readonly touches?: readonly IRState[] } {
  const rest = touchesField((touches ?? []).filter((s) => s !== 'random'));
  if (effect === 'unknown') return { effect, ...rest };
  return { effect: rest.touches === undefined ? 'pure' : effect, ...rest };
}

/** The values that `op` defines: the results of an `if` or a `loop`, the
 *  result of every other operation but a yield. */
export function definedValues(op: IROperation): readonly IRValue[] {
  if (op.kind === 'if' || op.kind === 'loop') return op.results;
  return op.result === undefined ? [] : [op.result];
}

/** Whether the evaluation of `op` can abort: a `loop` with an iteration
 *  budget, a `seeded` whose seed is not a literal (an invalid seed throws),
 *  an operation whose region can abort, or a call of a function whose body
 *  can abort (`IRLoop`). `functions`: the functions of the program. */
export function operationCanAbort(
  op: IROperation,
  functions: readonly IRFunction[]
): boolean {
  if (op.kind === 'loop' && op.iterationBudget !== undefined) return true;
  if (op.kind === 'seeded' && op.operands.length > 0) return true;
  if (op.kind === 'call' && functions[op.function]?.body.canAbort === true)
    return true;
  return regionsOf(op).some((region) => region.canAbort === true);
}

/** The regions that `op` evaluates. */
export function regionsOf(op: IROperation): readonly IRRegion[] {
  if (op.kind === 'if') return [op.then, op.else];
  if (op.kind === 'loop' || op.kind === 'build' || op.kind === 'seeded')
    return [op.body];
  if (op.kind === 'and' || op.kind === 'or') return op.rest;
  return [];
}

/** Whether `region` is closed: its last operation is an `exit`, or an `if`
 *  whose two branches are closed. Every other region is open and ends in a
 *  yield. */
export function isClosedRegion(region: IRRegion): boolean {
  const last = region.operations[region.operations.length - 1];
  if (last === undefined) return false;
  if (last.kind === 'exit') return true;
  return (
    last.kind === 'if' && isClosedRegion(last.then) && isClosedRegion(last.else)
  );
}

/** The operands of the yield of `region`, the last operation of an open
 *  region that the verifier accepted. A closed region yields no value: the
 *  result is empty. */
export function yieldedValues(region: IRRegion): readonly IRValue[] {
  if (isClosedRegion(region)) return [];
  return region.operations[region.operations.length - 1].operands;
}

/** The `exit` operations that end `loop`: in its body, or in a branch of an
 *  `if` there, at any depth of branches. An `exit` in the body of an inner
 *  loop ends that loop, and is not one of these. */
export function exitsOf(loop: IRLoop): IRExit[] {
  return exitsIn(loop.body);
}

/** The `exit` operations in `region` that leave the loop that encloses
 *  `region`: those of the region and of the branches of its `if`
 *  operations, at any depth, and not those of a loop in it. A region that
 *  holds one changes which operations run after it, also when its effect
 *  is `pure` and it yields nothing, so it is never removed. */
export function exitsIn(region: IRRegion): IRExit[] {
  const exits: IRExit[] = [];
  const visit = (r: IRRegion) => {
    for (const op of r.operations) {
      if (op.kind === 'exit') exits.push(op);
      if (op.kind === 'if') {
        visit(op.then);
        visit(op.else);
      }
    }
  };
  visit(region);
  return exits;
}

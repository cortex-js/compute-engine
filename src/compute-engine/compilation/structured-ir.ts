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

/** A list of elements of one type: a scalar kind, a tuple type (a list of
 *  points), or a list type (a list of lists, nested to the depth that the
 *  type states: `list<list<real>>` has rank 2). The length is not part of
 *  the type, at any depth: two lists of the same element type and different
 *  lengths have one type, the rows of a list of lists can have different
 *  lengths, and the elements of a list of tuples all have the length of the
 *  tuple type. A list is a value: no operation changes a list. A list type
 *  is an interned object (`listType()`): two list types of one element type
 *  are the same object, so `===` compares them, as it compares two scalar
 *  kinds. Its text (`toString()`) is `list<real>`,
 *  `list<tuple<real, real>>`, `list<list<integer>>`. */
export type ListType = {
  readonly kind: 'list';
  readonly element: ScalarKind | TupleType | ListType;
  toString(): string;
};

/** A tuple: a fixed number of elements, each of the scalar kind of its
 *  position. The length is part of the type. A point is a tuple. A tuple
 *  type is interned, as a list type is (`tupleType()`); its text is
 *  `tuple<real, real>`. A tuple is a value: no operation changes it. */
export type TupleType = {
  readonly kind: 'tuple';
  readonly elements: readonly ScalarKind[];
  toString(): string;
};

/** The semantic type of a value: a scalar, a list or a tuple. */
export type ValueType = ScalarKind | ListType | TupleType;

const LIST_TYPES = new Map<ScalarKind | TupleType | ListType, ListType>();
const TUPLE_TYPES = new Map<string, TupleType>();

/** The list type of elements of the type `element` (a scalar kind, or an
 *  interned tuple or list type), interned. */
export function listType(
  element: ScalarKind | TupleType | ListType
): ListType {
  let type = LIST_TYPES.get(element);
  if (type === undefined) {
    const text = `list<${String(element)}>`;
    type = Object.freeze({ kind: 'list', element, toString: () => text });
    LIST_TYPES.set(element, type);
  }
  return type;
}

/** The tuple type of the elements of the kinds `elements`, interned. */
export function tupleType(elements: readonly ScalarKind[]): TupleType {
  const text = `tuple<${elements.join(', ')}>`;
  let type = TUPLE_TYPES.get(text);
  if (type === undefined) {
    type = Object.freeze({
      kind: 'tuple',
      elements: Object.freeze([...elements]),
      toString: () => text,
    });
    TUPLE_TYPES.set(text, type);
  }
  return type;
}

/** Whether `type` is a list type. */
export function isListType(type: ValueType): type is ListType {
  return typeof type === 'object' && type.kind === 'list';
}

/** Whether `type` is a tuple type. */
export function isTupleType(type: ValueType): type is TupleType {
  return typeof type === 'object' && type.kind === 'tuple';
}

/** The type of the elements of `type` (a scalar kind, a tuple type for a
 *  list of tuples, a list type for a list of lists), or `undefined` when
 *  `type` is not a list type. */
export function elementOf(
  type: ValueType
): ScalarKind | TupleType | ListType | undefined {
  return isListType(type) ? type.element : undefined;
}

/** The scalar kind of the elements of `type`, or `undefined` when `type` is
 *  not a list of scalars. */
export function scalarElementOf(type: ValueType): ScalarKind | undefined {
  const element = elementOf(type);
  return typeof element === 'string' ? element : undefined;
}

/** The name of a representation of a target (`RepresentationPolicy`). */
export type Representation = string;

/**
 * How the evaluation of an operation can end the call of the compiled code
 * before the program has a value (an abort, `IRRegion.canAbort`):
 *
 * - `no-value`: the operation has no value for its operands (an integer
 *   operation of `IRIntegerFunction` at a pole, `IRNoValue`). The call
 *   gives the value that the target holds for a program with no value
 *   (`IRProgram.noValueResult`): no other operation receives a value of
 *   the operation.
 * - `error`: the call ends with an error (a result above the size limit of
 *   the target, an `exact` quotient with a remainder, an iteration budget
 *   that runs out).
 *
 * The policy of a target states the kinds of each operation
 * (`RepresentationPolicy.aborts`): a target whose integer is a bounded
 * float holds a pole as a value, and the same operation does not abort
 * there.
 */
export type AbortKind = 'error' | 'no-value';

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
  /** The value is computed at the position of the operation, also when it
   *  has one use: a target does not move its evaluation, or the reads of
   *  the inputs that it makes, to that use. Absent: the target may write
   *  a pure value at its use. */
  readonly atDefinition?: true;
  /** The states that the evaluation touches (`IRState`), sorted, with no
   *  duplicate; absent when there is none. An `effectful` operation with no
   *  region and no call names at least one; a `pure` operation, and an
   *  `unknown` one with no region and no call, name none. An operation that
   *  evaluates a region or calls a function names the states of that region
   *  or of the body of that function too, so a summary keeps the named
   *  states apart from `unknown`. */
  readonly touches?: readonly IRState[];
  /** The kinds of abort of the evaluation of the operation itself, not of a
   *  region that it evaluates or of a function that it calls (`AbortKind`):
   *  sorted, with no duplicate, and absent when there is none. The policy of
   *  the target states them (`RepresentationPolicy.aborts`). A `loop` with
   *  an iteration budget and a `seeded` with a seed operand abort with an
   *  error, and have no such field (`operationCanAbort()`). */
  readonly aborts?: readonly AbortKind[];
  /** The prepared node that the operation comes from. */
  readonly origin: Expression;
};

/** A number, a boolean or a complex number. A `bigint` is an exact integer
 *  of any size, a value of the type `integer`: the value of the compiler,
 *  not a value of a target, which holds it in its own representation. */
export type IRLiteral = OperationBase & {
  readonly kind: 'literal';
  readonly value:
    number | bigint | boolean | { readonly re: number; readonly im: number };
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
 * - `acot`, `acsc`, `asec`, `acoth`, `asech` and `acsch`: the inverse
 *   cotangent (in `(0, π)` for a real operand), cosecant, secant,
 *   hyperbolic cotangent, secant and cosecant; `coth`, `sech` and `csch`:
 *   the hyperbolic cotangent, secant and cosecant. As `asin`: the rule of
 *   the target decides whether an occurrence with a real operand is real or
 *   complex.
 * - `factorial` (`x!`, `Γ(x + 1)` for a real `x` that is not an integer,
 *   infinity for a negative integer), `factorial2` (the double factorial),
 *   `trunc` (the integer part, toward zero) and `fract` (`x - floor(x)`): a
 *   real operand and a real result.
 * - `mod-one`: the floored remainder of the division by 1,
 *   `(x - floor(x)) mod 1`, in `[0, 1)`, or not a number for an operand
 *   that is infinite or not a number: `x - floor(x)` rounds up to `1` for a
 *   tiny negative `x`, and the remainder gives `0` there. A real operand
 *   and a real result.
 * - The special functions of a real operand with a real result, `NaN` where
 *   the value of the interpreter is not real or where the kernel has no
 *   value: `heaviside` (`0` for a negative operand, `1/2` at `0`, `1` for a
 *   positive one), `ln-gamma` (`ln |Γ(x)|`), `sinc` (`sin(x)/x`, `1` at
 *   `0`), `erfi` (the imaginary error function `-i·erf(i·x)`), `erf-inv`
 *   (the inverse of `erf`), `trigamma` (the derivative of `digamma`),
 *   `fresnel-s` and `fresnel-c` (the Fresnel integrals of `sin(π t²/2)` and
 *   `cos(π t²/2)`), `sin-integral` and `cos-integral` (`Si`, `Ci`),
 *   `exp-integral-ei` (`Ei`), `log-integral` (`li`), `dirichlet-eta` and
 *   `dirichlet-beta` (η and β), `zeta` (the Riemann ζ), `stieltjes` (the
 *   Stieltjes constant `γₙ` of the order `n`), `lambert-w` (the branch 0 of
 *   W, `NaN` below `-1/e`), `elliptic-k` and `elliptic-e` (the complete
 *   elliptic integrals `K(m)` and `E(m)` of the parameter `m`, `NaN` for
 *   `m > 1`).
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
  | 'round-ties-away'
  | 'acot'
  | 'acsc'
  | 'asec'
  | 'acoth'
  | 'asech'
  | 'acsch'
  | 'coth'
  | 'sech'
  | 'csch'
  | 'factorial'
  | 'factorial2'
  | 'trunc'
  | 'fract'
  | 'mod-one'
  | 'heaviside'
  | 'ln-gamma'
  | 'sinc'
  | 'erfi'
  | 'erf-inv'
  | 'trigamma'
  | 'fresnel-s'
  | 'fresnel-c'
  | 'sin-integral'
  | 'cos-integral'
  | 'exp-integral-ei'
  | 'log-integral'
  | 'dirichlet-eta'
  | 'dirichlet-beta'
  | 'zeta'
  | 'stieltjes'
  | 'lambert-w'
  | 'elliptic-k'
  | 'elliptic-e';

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
 * - `hypot(a, b)` is `√(a² + b²)`, infinity when an operand is infinite
 *   (also with a `NaN` operand).
 * - The special functions of two real operands with a real result, `NaN`
 *   where the value of the interpreter is not real or where the kernel has
 *   no value: `gamma-q(a, z)` (the regularized upper incomplete gamma
 *   `Q(a, z)`), `gamma-upper(s, z)` (the upper incomplete gamma `Γ(s, z)`),
 *   `beta(a, b)`, `real-binomial(n, k)` (the binomial coefficient of reals,
 *   through Γ), `clausen(s, x)` (the Clausen function `Clₛ(x)`),
 *   `elliptic-f(φ, m)` and `elliptic-e-incomplete(φ, m)` (the incomplete
 *   elliptic integrals), `elliptic-pi(n, m)` (the complete elliptic
 *   integral `Π(n | m)`), `bessel-j`, `bessel-y`, `bessel-i` and `bessel-k`
 *   of the order and the argument, `agm(a, b)` (the arithmetic-geometric
 *   mean), `polygamma(n, x)` (`ψ⁽ⁿ⁾(x)`), `zeta-generalized(s, a)` (the sum
 *   of `|k + a|^(-s)` over `k ≥ 0`), `stieltjes-generalized(n, a)` (the
 *   Stieltjes constant `γₙ(a)`), `hurwitz-zeta(s, a)`, `polylog(s, z)`
 *   (`Liₛ(z)`) and `lambert-w-branch(x, k)` (the branch `k` of W).
 * - `chop(x, t)` is `x`, or `0` when `|x|` is less than the tolerance `t`.
 * - `real-remainder(a, b)` is `a - b·round(a/b)`, the quotient rounded to
 *   the nearest integer with a tie toward `+∞`; `real-gcd(a, b)` and
 *   `real-lcm(a, b)` are the greatest common divisor and the least common
 *   multiple of two reals as the interpreter extends them to rationals
 *   (`real-gcd(2.5, 6)` is `0.5`). The three have no value for an operand
 *   that is infinite or beyond the integers that a double holds exactly: a
 *   target may stop the evaluation there.
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
  | 'complex'
  | 'hypot'
  | 'gamma-q'
  | 'gamma-upper'
  | 'beta'
  | 'real-binomial'
  | 'clausen'
  | 'elliptic-f'
  | 'elliptic-e-incomplete'
  | 'elliptic-pi'
  | 'bessel-j'
  | 'bessel-y'
  | 'bessel-i'
  | 'bessel-k'
  | 'agm'
  | 'polygamma'
  | 'zeta-generalized'
  | 'stieltjes-generalized'
  | 'hurwitz-zeta'
  | 'polylog'
  | 'lambert-w-branch'
  | 'real-remainder'
  | 'real-gcd'
  | 'real-lcm'
  | 'chop';

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
 * The functions of exact integers that the representation names, by an
 * identifier that names no target. Each has integer operands and an
 * integer result (a boolean for `is-prime`), and denotes the exact integer
 * of its operands. Where that integer does not exist, the operation has no
 * value: it is `undefined` (the `NaN` of the interpreter) or `infinite`
 * (its `~oo`), as `IRNoValue` names them. A policy whose integer is exact
 * (`RepresentationPolicy.aborts`) aborts there with `no-value`; it can also
 * abort with `error` past a size limit of its own.
 *
 * - `remainder(a, b)`: `a - b·k`, where `k` is the integer nearest to
 *   `a/b`, a tie rounded toward `+∞` (`remainder(-7, 3)` is `-1`,
 *   `remainder(5, 2)` is `-1`); undefined for `b = 0`.
 * - `quotient(a, b)`: `a/b` rounded by `rounding` (`IntegerRounding`);
 *   for `b = 0`, undefined when `a = 0` and infinite otherwise. With the
 *   rounding `exact`, a quotient that is not an integer is an `error`: the
 *   program promised an integer (`Typed(n/2, integer)`).
 * - `isqrt(t)`: the square root of `t` rounded by `rounding` (not
 *   `exact`; `floor` and `truncate` agree), undefined for `t < 0`.
 * - `rounded-pow(a, e)`: `a^e` for any integer `e`, rounded by `rounding`:
 *   the quotient of `1` by `a^(-e)` for `e < 0`; undefined for `0^0`,
 *   infinite for `0^e` with `e < 0`.
 * - `int-pow(a, e)`: `a^e` for `e ≥ 0`, undefined for `0^0`. The rule of
 *   the target writes it only for an exponent that the program proves not
 *   negative: the value for a negative `e` is not defined here.
 * - `neg-one-pow(k)`: `(-1)^k`, `1` for an even `k` and `-1` for an odd
 *   one, also for a negative `k`.
 * - `gcd` and `lcm` of one operand or more: not negative; `gcd(0, 0)` is
 *   `0`, `lcm(0, n)` is `0`.
 * - `factorial(n)`: `n!`, infinite for `n < 0`. `factorial2(n)`: `n!!`,
 *   for `n ≥ 0` (the rule of the target writes it only for an operand that
 *   the program proves not negative).
 * - `binomial(n, k)`: the binomial coefficient, extended to negative
 *   operands as the interpreter extends it (`Binomial(-1, 2)` is `1`,
 *   `Binomial(5, 7)` is `0`).
 * - `fibonacci(n)`: `F(n)`, with `F(-n) = (-1)^(n+1)·F(n)`.
 * - `is-prime(n)`: whether `n` is a prime: a boolean.
 *
 * Every integer function is `pure`: an abort is not an effect.
 */
export type IntegerFunctionName =
  | 'remainder'
  | 'quotient'
  | 'isqrt'
  | 'rounded-pow'
  | 'int-pow'
  | 'neg-one-pow'
  | 'gcd'
  | 'lcm'
  | 'factorial'
  | 'factorial2'
  | 'binomial'
  | 'fibonacci'
  | 'is-prime';

/** The rounding of a `quotient`, an `isqrt` and a `rounded-pow`: toward
 *  `-∞`, toward `+∞`, to the nearest integer with a tie away from zero
 *  (`-5/2` gives `-3`), toward zero, or `exact` (the value must be an
 *  integer). */
export type IntegerRounding =
  'floor' | 'ceil' | 'round-ties-away' | 'truncate' | 'exact';

/** The integer functions that have a rounding (`IntegerFunctionName`). */
export const ROUNDED_INTEGER_FUNCTIONS: ReadonlySet<IntegerFunctionName> =
  new Set(['quotient', 'isqrt', 'rounded-pow']);

/** An application of the integer function `fn` (`IntegerFunctionName`),
 *  with the rounding `rounding` for a function that has one. */
export type IRIntegerFunction = OperationBase & {
  readonly kind: 'integer';
  readonly fn: IntegerFunctionName;
  readonly rounding?: IntegerRounding;
};

/** An operation that has no value: no operand, an integer result that it
 *  never gives, and the abort `no-value` where it is evaluated. `value`
 *  names the missing value: `undefined` (the `NaN` of the interpreter) or
 *  `infinite` (its `~oo`). It is a constant of the program whose value is
 *  not finite (`(-1)!`, a folded pole): a branch that does not run does
 *  not abort. `pure`. */
export type IRNoValue = OperationBase & {
  readonly kind: 'no-value';
  readonly value: 'undefined' | 'infinite';
};

/**
 * A read of a list or a tuple. Both are `pure`: a list and a tuple are
 * values, and no operation changes them.
 *
 * - `at`: the operands are a list, or a tuple whose elements have one kind,
 *   and an integer index, counted from 1 as in the language; a negative
 *   index counts from the end (`-1` is the last element). The result has
 *   the type of an element. An index out of range (0, beyond the length, or
 *   beyond the length from the end) gives the absent value of the target
 *   for the element type: every other operation applied to that value is
 *   unspecified (`docs/COMPILATION-MODEL.md`, "Caveats of compiled code").
 *   A policy whose integer is exact holds no absent integer: the operation
 *   has no value there, and aborts with `no-value` (`AbortKind`).
 * - `length`: the operand is a list or a tuple; the result is the number of
 *   its elements, an integer.
 */
export type IRListRead = OperationBase & {
  readonly kind: 'at' | 'length';
  /** On `at`: the index is in range by construction (the index of a
   *  `build` over the length of the list, or of a list of that length), so
   *  the read has no absent value. */
  readonly inRange?: boolean;
};

/**
 * A value that the program makes from its elements. Both are `pure`, and
 * the result is a new value.
 *
 * - `list`: the operands are the elements, in order, each of the element
 *   kind of the result (an integer is a valid element of a list of reals);
 *   there can be none (the empty list).
 * - `tuple`: the operands are the elements, one per position of the
 *   result, each of the kind of its position (an integer is a valid real).
 */
export type IRMake = OperationBase & {
  readonly kind: 'list' | 'tuple';
};

/** The element of a tuple at the literal `position`, counted from 1, in
 *  the range of the tuple: one operand, the tuple; the result has the kind
 *  of that position. `pure`. */
export type IRGet = OperationBase & {
  readonly kind: 'get';
  readonly position: number;
};

/** A new list, the list of the first operand with the second operand, an
 *  element, after its last element. The element has the element kind of
 *  the result (an integer is a valid element of a list of reals); the
 *  result is a list of integers only when the list and the element are
 *  integers. `pure`: the operand list is not changed. An emitter can write
 *  the element into the array of the operand when no later code reads that
 *  array (`inPlaceUpdates()` in `structured-in-place.ts`). */
export type IRAppend = OperationBase & {
  readonly kind: 'append';
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
 *   (`Range(1, 0)` has the elements 1 and 0). With `ascending`, the steps
 *   are always 1 and there is no element when `to` is less than `from`: the
 *   build over the elements of a list, from 1 to its length, makes the
 *   empty list for an empty list. A build of more than 2^32 - 1 elements
 *   has no value: compiled code throws before the first element, as the
 *   existing emitter does. The result is the list of the elements in that
 *   order; it is a list of integers only when the body
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
  /** No element when `to` is less than `from`; absent: the steps of
   *  `Range(from, to)`. */
  readonly ascending?: true;
  /** The bound `to` is a count that the program computes (`Tabulate(f,
   *  n)`), not the length of a list: a target that holds a list in an array
   *  of a largest length tests the count before the first element, as for a
   *  build that is not `ascending` (a JavaScript array holds at most 2^32 - 1
   *  elements: the code throws for more, and evaluates no element). */
  readonly counted?: true;
};

export type IRReplaceAt = OperationBase & {
  readonly kind: 'replace-at';
};

/**
 * A copy of a list: one operand, the list; the result has its type and its
 * representation and the same elements. The result is a new array, and so
 * is each of its rows when `levels` is 2 (a list of lists); the arrays
 * below `levels` are the arrays of the operand. An absent row (the value of
 * an `at` out of range, `IRListRead`) gives the absent value. `pure`: the
 * operand is not changed.
 *
 * The lowering writes no copy. `withOwnedCopies()` (`structured-in-place.ts`)
 * puts one before a loop whose carried list starts from a value that the
 * program does not own (an input, a constant, a row read): the loop then
 * updates the copy in place (`inPlaceUpdates()`), where each pass would
 * copy the list.
 */
export type IRCopy = OperationBase & {
  readonly kind: 'copy';
  /** 1, or 2 for a list of lists. */
  readonly levels: 1 | 2;
};

/**
 * The functions of lists that the representation names, by an identifier
 * that names no target (`IRCollection`). A list operand is a list of reals
 * or of integers; where a tuple is allowed, it is a tuple of reals or of
 * integers. Each is `pure`, and each result is a number or a new list: no
 * result is, or holds, the array of an operand.
 *
 * - `norm`: one list or tuple; the Euclidean norm, a real (`0` for an empty
 *   list, `+∞` when an element is infinite, also beside a `NaN`).
 * - `mean`, `median`, `variance`: one list or tuple; the arithmetic mean,
 *   the median and the sample variance of the elements, a real (not a
 *   number for an empty list, and the variance of one element).
 * - `dot`: two lists; the sum of the products of the elements at each
 *   position, a real (`0` for two empty lists, not a number for lists of
 *   different lengths).
 * - `take`, `drop`: a list and an integer count `n`. `take` gives the first
 *   `n` elements, or the last `-n` for a negative `n`; `drop` gives the list
 *   without them. A count beyond the length takes, or drops, every element.
 *   A real count is rounded to the nearest integer, a half up (`2.5` is 3,
 *   `-2.5` is -2), as the interpreter rounds it.
 *   A count that is not a number has no value: the interpreter keeps the
 *   expression unevaluated, and the result is the absent value of the
 *   target (`docs/COMPILATION-MODEL.md`, "Caveats of compiled code").
 * - `reverse`: one list, its elements in the other order.
 * - `rotate-left`, `rotate-right`: a list and an integer shift `k`; the
 *   list of its elements moved `k` places to the left (to the right), each
 *   element leaving one end entering at the other, as the interpreter's
 *   `RotateLeft(L, k)` and `RotateRight(L, k)`: the shift is taken modulo
 *   the length, a negative shift moves to the other side, and an empty list
 *   gives the empty list.
 * - `sort`: one list, its elements in ascending order, a `NaN` after every
 *   number.
 * - `join`: two or more lists, their elements in order.
 * - `range`: two integers `a` and `b`, the list of the integers from `a`
 *   to `b`, in steps of 1, or of -1 when `b < a`, as the interpreter's
 *   `Range(a, b)` (`Range(1, 0)` is `[1, 0]`); its first element is `a`
 *   itself (`-0` for `a = -0`). With a third operand `s`, the step: the
 *   numbers `a + i·s` for `i` from 0 to the count of `rangeCount()`
 *   (`numerics/range-count.ts`) less 1, none for `s = 0` or for a step
 *   whose sign is not the sign of `b - a`, as the interpreter's
 *   `Range(a, b, s)`; the three are reals or integers, and the list is a
 *   list of integers only when the three are integers. A range of more
 *   than 2^32 - 1 elements has no value: compiled code throws, as the
 *   existing emitter does.
 *
 * The matrix functions read a list of lists of rank 2 (a matrix) of reals
 * or of integers; their list results are new lists whose rows are new
 * (`docs/plans/2026-11-11-structured-nested-lists-and-matrices.md`,
 * section 4):
 *
 * - `determinant`, `trace`: one matrix; its determinant (`NaN` when it is
 *   not square) and the sum of its diagonal, a real.
 * - `transpose`: one matrix; the matrix of its columns, with its elements.
 *   The transpose of the empty list is the empty list, which can be the
 *   operand itself.
 * - `row-reduce`: one matrix; its reduced row echelon form, a matrix of
 *   reals.
 * - `inverse`: one square matrix; its inverse, a matrix of reals.
 * - `matrix-power`: a square matrix and an integer exponent; the power, a
 *   matrix of reals (the identity for 0; the power of the inverse for a
 *   negative exponent; the matrix for 1, square or not).
 * - `matrix-multiply`: a matrix and a matrix, a matrix and a list, or a
 *   list and a matrix; the matrix product, of rank 2 for two matrices and
 *   a list of reals otherwise. A matrix and a list of another length give a
 *   list of `NaN` elements.
 * - `matrix-product`: the same operands and the same product, as
 *   `Multiply` of a matrix computes it; dimensions that do not agree give
 *   no value.
 * - `diagonal`: a matrix, the list of its diagonal; or a list, the square
 *   matrix with the list on its diagonal and zeros elsewhere.
 * - `flatten`: a list of any rank; the list of its numbers, in order.
 * - `norm` also reads a list of lists of any rank (the Frobenius norm), and
 *   with a second operand, a real order `p` (the `p`-norm of a list; the
 *   operator norm of the order 1, 2 or `+∞` of a matrix).
 *
 * A list result of `inverse` (a singular matrix), of `matrix-power`, of
 * `row-reduce` and of `matrix-multiply` and `matrix-product` (dimensions
 * that do not agree) can
 * have no value: the operation then carries `absent`, and the value is the
 * absent value of the target in place of the list (`IRCollection.absent`).
 *
 * The functions of flat lists of numbers (the census of declines,
 * `docs/plans/2026-11-11-js-profile-decline-census.md`, row 3):
 *
 * - `population-variance`, `standard-deviation`,
 *   `population-standard-deviation`, `skewness`, `kurtosis`, `mode`,
 *   `interquartile-range`: one list or tuple; the statistic of the elements
 *   of the interpreter's head of that name, a real (not a number for an
 *   empty list or for an element that is not a number).
 * - `covariance`, `correlation`: two lists; the sample covariance and the
 *   correlation coefficient of the pairs of elements, a real.
 * - `ordering`: one list; the positions 1 to n of its elements in the order
 *   of `sort` (a stable order: two equal elements keep the order of their
 *   positions, `-0` equals `0`), a list of integers.
 * - `index-of`: a list and a number `x`; the first position whose element
 *   is `x` (`-0` is `0`, and a `NaN` is a `NaN`), or 0 for none, an integer.
 * - `contains`: a list and a number; whether an element is that number, by
 *   the rule of `index-of`, a boolean.
 * - `unique`: one list; its elements without the later repetitions of each
 *   value (by the rule of `index-of`), in order; `0` and `-0` are one value,
 *   written `0`.
 * - `repeat`: a number and an integer count `n`; the list of `n` copies of
 *   the number, empty for `n` less than 1.
 * - `linspace`: two finite numbers `a` and `b` and an integer count `n`; the
 *   list of `n` numbers from `a` to `b` in equal steps (`[a]` for `n = 1`,
 *   empty for `n` less than 1), a list of reals.
 * - `slice`: a list and two numbers `a` and `b` (integers or reals, rounded
 *   to the nearest integer, a half up); the elements from the position `a`
 *   to the position `b`, both included, a negative position counted from the
 *   end, each position clamped to the list (empty when `a` is after `b` or
 *   after the end).
 * - `at-real`: a list of numbers and a real index; the element at the
 *   index when the index is an integer position of the list (as `at`), and
 *   the absent value of the element otherwise (a fraction, not a number, an
 *   infinity, 0, out of range).
 * - `gather`: a list of numbers and a list of indexes (integers or reals);
 *   the list of the elements of `at-real` at each index, in the order of the
 *   indexes.
 *
 * A list result has the elements of its operands: it is a list of integers
 * only when every list operand is one. The list results of `ordering`,
 * `unique`, `repeat`, `linspace`, `slice` and `gather` are new arrays of
 * numbers (`new`).
 */
export type CollectionFunctionName =
  | 'norm'
  | 'mean'
  | 'median'
  | 'variance'
  | 'dot'
  | 'take'
  | 'drop'
  | 'reverse'
  | 'sort'
  | 'join'
  | 'range'
  | 'rotate-left'
  | 'rotate-right'
  | 'determinant'
  | 'trace'
  | 'transpose'
  | 'row-reduce'
  | 'inverse'
  | 'matrix-power'
  | 'matrix-multiply'
  | 'matrix-product'
  | 'diagonal'
  | 'flatten'
  | 'population-variance'
  | 'standard-deviation'
  | 'population-standard-deviation'
  | 'skewness'
  | 'kurtosis'
  | 'mode'
  | 'interquartile-range'
  | 'covariance'
  | 'correlation'
  | 'ordering'
  | 'index-of'
  | 'contains'
  | 'unique'
  | 'repeat'
  | 'linspace'
  | 'slice'
  | 'at-real'
  | 'gather';

/**
 * An application of a function of lists that `fn` names
 * (`CollectionFunctionName`). One operation kind serves every such
 * function, as `unary` serves the functions of one number: the core checks
 * the types of the operands and of the result by the rule of the
 * identifier, the policy of a target says which identifiers it has, and the
 * emitter of the target writes each one (a runtime helper of the target).
 * `pure`.
 */
/**
 * What the array of the list result of a function of lists (`IRCollection`)
 * is, a fact of the target's helper for the function:
 *
 * - `new`: a new array at every depth (`_SYS.matmul`, `_SYS.inv`: new rows
 *   too).
 * - `copy`: a new outer array whose elements are the elements of the
 *   operands (`take`, `join`): for a list of lists, the rows of an operand.
 * - `operand`: it can be the array of an operand itself
 *   (`_SYS.transpose([])` is its operand).
 *
 * A `new` or a `copy` result is unique for `inPlaceUpdates()`; an
 * `operand` result is not. A row of a `copy` result can be held by an
 * operand: a write into a row copies it (a row read is never unique).
 */
export type CollectionResultArray = 'new' | 'copy' | 'operand';

export type IRCollection = OperationBase & {
  readonly kind: 'collection';
  readonly fn: CollectionFunctionName;
  /** The array of a list result (`CollectionResultArray`), from the policy
   *  of the target (`OperationRule.resultArray` of the function): read by
   *  `inPlaceUpdates()`. Absent: the result can be the array of an
   *  operand, and is never unique. */
  readonly resultArray?: CollectionResultArray;
  /** The list result can have no value: its value is then the absent value
   *  of the target in place of the list (a number in JavaScript, `NaN` for
   *  a singular inverse), or a list of absent values of a lower rank
   *  (`MatrixMultiply(A, Inverse(B))` with `B` singular is `[NaN, NaN]` in
   *  JavaScript). Only a matrix function with a list result carries
   *  it. The verifier admits such a value only as the value of the program
   *  (a yield of the root), as the operand of a matrix function that reads
   *  it (`ABSENT_MATRIX_READERS`, `structured-verify.ts`), and as the list
   *  of an `at`; a matrix function with a list result and such an operand
   *  carries it too. */
  readonly absent?: true;
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
  readonly snapshot: CaptureSnapshot;
};

/**
 * A read of the constant `IRProgram.constants[constant]`: a list that the
 * program holds once, made from its literal elements when the compiled
 * function is made, and shared by every call and every function of the
 * program. The read gives that one array, as a read of a list input gives
 * the array of the host: the value is never unique (`inPlaceUpdates()`), so
 * no update writes it, and a target that gives the array of the value of
 * the program to the host gives a copy of it (`rootYieldsUnique()`). The
 * read is pure: the constant is fixed when the program is compiled.
 */
export type IRConstantRead = OperationBase & {
  readonly kind: 'constant';
  readonly constant: number;
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
export type IRIf = Omit<OperationBase, 'result'> & {
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
 * With `ascending`, the steps are always 1 and the loop runs no iteration
 * when `to` is less than `from`: a fold over the elements of a list, from 1
 * to its length, gives its initial value for an empty list.
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
  /** No iteration when `to` is less than `from` (`IRBuild.ascending`). */
  readonly ascending?: true;
  /** A loop with no end, `Loop(body)` of the language: it runs until an
   *  `exit`, until the iteration budget aborts the call, or for ever. The
   *  operands `from` and `to` are still there and are not read, and no
   *  operation reads the index. It may not terminate: like an abort, it
   *  makes its region `canAbort` (`operationCanAbort()`), so that no
   *  transformation removes it, moves it or runs it more times. */
  readonly unbounded?: true;
  /** Before the first iteration, a range of more than 2^32 − 1 integers
   *  throws, as the existing emitter's loop over a `Range` clause of a
   *  `Loop` or a `Comprehension` does where it writes that test
   *  (`compileCountedRange()`). The index has the representation `number`
   *  (the verifier checks it). */
  readonly checksCount?: true;
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

/**
 * The numeric routines that the representation names, by an identifier
 * that names no target (`IRRoutine`):
 *
 * - `integrate`: two real operands, the lower and the upper bound (an
 *   integer fits, and a bound can be infinite). The result is a real that
 *   approximates the integral of the body over the interval between the
 *   bounds, negated when the upper bound is less than the lower one, or not
 *   a number when the routine finds no value (a divergent integral with no
 *   sign, an integrand with no real value on a part of the interval). With
 *   `initialPanels`, the routine starts from that number of equal panels.
 * - `integrate-sampled`: the operands and the result of `integrate`; the
 *   routine estimates the integral from the values of the body at points
 *   that it draws from a random source of the runtime.
 * - `limit`: one or two real operands, the point and the direction. The
 *   result approximates the limit of the body at the point (which can be
 *   infinite), from above for a direction 1 or absent, from below for -1,
 *   and from both sides for 0, or is not a number when the routine finds
 *   no value.
 * - `derivative`: one real operand, the point. The result approximates the
 *   derivative of the order `order` of the body at the point, or is not a
 *   number.
 *
 * With an `alternative` region (`integrate`, `integrate-sampled`), a value
 * of the body that is not a number or is infinite is replaced, at the same
 * point, by the value of the alternative when that is finite, or when the
 * first is not a number and the alternative's is.
 */
export type RoutineName =
  | 'integrate'
  | 'integrate-sampled'
  | 'limit'
  | 'derivative';

/**
 * An application of a numeric routine that `fn` names (`RoutineName`) to
 * the body region: the structured form of a definite integral, of a limit
 * and of a derivative computed numerically. The
 * operands are evaluated once, in order, before the routine runs. The body
 * (and the `alternative`, when there is one)
 * is an open region with one parameter, a `real`, that yields one real or
 * integer value; it runs zero or more times, each time with the parameter
 * bound to a number that the routine chooses, in an order that the routine
 * chooses. The body reads its parameter and the values of the regions
 * around it, which no operation changes while the routine runs. No `exit`
 * leaves the body. A `pure` routine (the policy states it) whose body is
 * pure is still run where the program runs it, once per occurrence: a pass
 * neither shares two occurrences nor moves one, so the body runs the number
 * of times, and in the order, that the program states.
 *
 * The policy of the target states the facts of each routine
 * (`RepresentationPolicy.routines`): the operation has the effect of the
 * routine joined with the effect of its body, the states of both, and the
 * abort kinds of the routine. A routine that keeps state between calls (a
 * count of the routines in progress, a budget of evaluations), or that
 * samples a random source of the runtime, is `effectful`, so no pass shares,
 * removes or moves it. A routine whose body runs at many points is never
 * hoisted out of a loop and is never merged with another occurrence.
 */
export type IRRoutine = OperationBase & {
  readonly kind: 'routine';
  readonly fn: RoutineName;
  readonly body: IRRegion;
  /** The number of equal panels from which `integrate` starts: a positive
   *  integer. Absent: the default of the target. */
  readonly initialPanels?: number;
  /** The order of a `derivative`: a positive integer. */
  readonly order?: number;
  /** The second body of an `integrate` or an `integrate-sampled`: an open
   *  region with one `real` parameter that yields one real value, run at a
   *  point where the value of the body is not a number or is infinite
   *  (`RoutineName`). */
  readonly alternative?: IRRegion;
};

/**
 * A call of code that the host of the compilation supplies
 * (`IRProgram.hosts[host]`): a function of the host called with the
 * operands, or, with no operand, a value of the host read at this position.
 * The operands are scalars, evaluated once, in order, before the call; the
 * result is a scalar of the type that the binding states.
 *
 * The effect is `pure` when the host declared the function pure
 * (`IRHostBinding.pure`), and `unknown` otherwise: the code of the host can
 * do anything. A host operation names no state. The host can count its
 * calls, so a transformation never removes a host operation, never merges
 * two, never runs one more or fewer times than the program does, and never
 * changes the order of two host operations or of a host operation and an
 * operation that is not pure; this holds also for a `pure` one.
 */
export type IRHostCall = OperationBase & {
  readonly kind: 'host';
  readonly host: number;
};

/** A binding of the host that the program reads or calls (`IRHostCall`). */
export type IRHostBinding = {
  /** The name of the binding in the source program: the head of a call, or
   *  the name of a symbol that is read. */
  readonly name: string;
  /** `call`: a function of the host, called with operands; `read`: a value
   *  of the host, read with no operand. */
  readonly form: 'call' | 'read';
  /** The type of the value of each call or read. */
  readonly result: ScalarKind;
  /** The host declared the function pure. A read is never pure. */
  readonly pure: boolean;
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
  readonly aborts?: undefined;
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
 * `if` operations: no region of a `build`, of an `and`, an `or`, a
 * `seeded` or a `routine`, and no body of a function. The `exit` passes values to the
 * results of the loop as the yield of the body does, so each value keeps
 * one definition.
 */
export type IRExit = {
  readonly kind: 'exit';
  readonly result?: undefined;
  readonly operands: readonly IRValue[];
  readonly effect: EffectFact;
  readonly touches?: undefined;
  readonly aborts?: undefined;
  readonly origin: Expression;
};

export type IROperation =
  | IRLiteral
  | IRInputRead
  | IRCaptureRead
  | IRConstantRead
  | IRArithmetic
  | IRUnaryFunction
  | IRBinaryFunction
  | IRIntegerFunction
  | IRNoValue
  | IRListRead
  | IRMake
  | IRGet
  | IRAppend
  | IRBuild
  | IRReplaceAt
  | IRCopy
  | IRCollection
  | IRConvert
  | IRIf
  | IRLoop
  | IRShortCircuit
  | IRCall
  | IRTrace
  | IRDraw
  | IRSeeded
  | IRRoutine
  | IRHostCall
  | IRYield
  | IRExit;

export type IRRegion = {
  /** The values that the region defines at its entry, before its first
   *  operation: the parameters of the body of a `loop`, and the index of
   *  the body of a `build`, and the real parameter of the body of a
   *  `routine`. Each is visible in
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
  /** An input that the host can give in another representation than the
   *  one of the input, which the target converts: a boundary rule of the
   *  input, not an operation of the program. A complex input that the host
   *  can give as a number or as a complex value (`{ re, im }`), a name with
   *  no declared type in the `complex` mode: each read converts the value
   *  to a complex value, as the existing emitter does (`_SYS.cplx`, which
   *  keeps a complex value as it is). An integer input of an exact policy
   *  that the host can give as a `number`: the value is converted once, at
   *  the entry. */
  readonly lifted?: true;
  /** A parameter of the root function that the program never reads: it
   *  keeps its position in the signature of the function, whatever value
   *  the host gives there, and no operation reads it (the verifier checks
   *  it). Its type and representation are those of a real number, which no
   *  check of a value reads. */
  readonly unread?: true;
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
  /** The value of the binding when the program was compiled: a number, or
   *  the two parts of a complex number for the type `complex`. */
  readonly snapshot: CaptureSnapshot;
};

/** The value of a captured binding (`IRCapture.snapshot`): a finite number,
 *  or the finite parts of a complex number. */
export type CaptureSnapshot =
  | number
  | { readonly re: number; readonly im: number };

/** A list that the program holds once (`IRConstantRead`): the value of a
 *  captured binding when the program was compiled. */
export type IRConstant = {
  /** The identity of the binding: the object of the engine that holds it.
   *  Two constants of a program have different bindings. */
  readonly binding: object;
  /** The name of the binding, for a message. */
  readonly name: string;
  /** A list of reals or of integers, or a list of such lists (rank 2). */
  readonly type: ListType;
  readonly representation: Representation;
  /** The elements, each a finite number (an integer for a list of
   *  integers); for a list of lists, the rows, each an array of such
   *  numbers, of any length. */
  readonly elements: readonly number[] | readonly (readonly number[])[];
};

/** A resolved helper, written once as a function of the program. A helper
 *  can call another helper; the body of a helper reads its parameters, the
 *  captures of the program, and the inputs that `inputs` lists. */
export type IRFunction = {
  readonly name: string;
  /** Defined at the entry of the body. */
  readonly parameters: readonly IRValue[];
  /** The inputs of the program (indexes in `IRProgram.inputs`) that the
   *  body reads, in increasing order, each once: an `input` operation of
   *  the body, or of a region nested in it, reads one of them, and each of
   *  them is read so. A read gives the value of the input when the read
   *  runs, as a read of the root does; the inputs are the values of the
   *  call of the program, so the function is still pure when no operation
   *  of the program can change them. Absent when the body reads none. */
  readonly inputs?: readonly number[];
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
  readonly numericPolicy: 'strict' | 'complex' | 'bigint';
  /** The representation of the value that a call gives when its evaluation
   *  aborts with `no-value` (`AbortKind`): the representation that the
   *  policy of the target names (`RepresentationPolicy.noValueResult`),
   *  which is not the representation of a value of the program. Present
   *  exactly when an operation of the program can abort with `no-value`. */
  readonly noValueResult?: Representation;
  /** The bindings that the program reads as snapshots, in the root or in
   *  a function (`IRCaptureRead`). */
  readonly captures: readonly IRCapture[];
  /** The lists that the program holds once (`IRConstantRead`); absent when
   *  there is none. */
  readonly constants?: readonly IRConstant[];
  readonly functions: readonly IRFunction[];
  /** The bindings of the host that the program reads or calls
   *  (`IRHostCall`); absent when there is none. */
  readonly hosts?: readonly IRHostBinding[];
  readonly root: IRRegion;
  /** The ids of the values that a local holds, or that the existing
   *  emitter writes as a variable: a value that a `Declare` or an `Assign`
   *  writes, and the value of a block operand (`x + { b0 ⩴ 1; i }`, which
   *  it writes as a called function). The existing emitter writes such a
   *  value as a name, so a target that writes a literal operand as a
   *  constant (the parts of a complex sum, a term `0` that it drops) writes
   *  such a value as a value. Absent when there is none. No check reads it. */
  readonly localValues?: ReadonlySet<number>;
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

/** The states `states` in a message: their names, or `none`. */
export function statesText(states: readonly IRState[] | undefined): string {
  return states === undefined ? 'none' : states.join(', ');
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

/** Whether the evaluation of `op` can abort: an operation with an abort
 *  kind of its own (`OperationBase.aborts`), a `loop` with an iteration
 *  budget, a `loop` with no end (it may not terminate), a `seeded` whose seed is not a literal (an invalid seed throws),
 *  an operation whose region can abort, or a call of a function whose body
 *  can abort (`IRLoop`). `functions`: the functions of the program. */
export function operationCanAbort(
  op: IROperation,
  functions: readonly IRFunction[]
): boolean {
  if (op.aborts !== undefined) return true;
  if (op.kind === 'loop' && op.iterationBudget !== undefined) return true;
  // A loop with no end may not terminate: a call that never returns, which
  // a transformation must not remove, move or run more times, as an abort.
  if (op.kind === 'loop' && op.unbounded === true) return true;
  if (op.kind === 'seeded' && op.operands.length > 0) return true;
  if (op.kind === 'call' && functions[op.function]?.body.canAbort === true)
    return true;
  return regionsOf(op).some((region) => region.canAbort === true);
}

/** The answer of `reachesHost()` for each region, once per region object. */
const REGION_REACHES_HOST = new WeakMap<IRRegion, boolean>();

/** Whether the evaluation of `op` runs a host operation (`IRHostCall`): `op`
 *  is one, a region that it evaluates holds one, or it calls a function
 *  whose body reaches one. `functions`: the functions of the program. Such
 *  an operation is never shared or removed, also when it is `pure`. */
export function reachesHost(
  op: IROperation,
  functions: readonly IRFunction[]
): boolean {
  if (op.kind === 'host') return true;
  const regions: IRRegion[] = [...regionsOf(op)];
  if (op.kind === 'call') {
    const body = functions[op.function]?.body;
    if (body !== undefined) regions.push(body);
  }
  return regions.some((region) => regionReachesHost(region, functions));
}

/**
 * Whether `op` runs a routine (`IRRoutine`): it is one, a region of it
 * holds an operation that runs one, or it calls a function whose body
 * does. A pure `limit` or `derivative` evaluates its body at its own
 * points where the program runs it, so such an operation is neither shared
 * nor moved (the memo of the lowering, the order of the emitter).
 * `visiting` holds the functions that the walk has entered: a call cycle
 * (the verifier accepts one) reads a function once, and the answer comes
 * from the other operations.
 */
export function runsRoutine(
  op: IROperation,
  functions: readonly IRFunction[],
  visiting: Set<number> = new Set()
): boolean {
  if (op.kind === 'routine') return true;
  const regions: IRRegion[] = [...regionsOf(op)];
  if (op.kind === 'call' && !visiting.has(op.function)) {
    visiting.add(op.function);
    const body = functions[op.function]?.body;
    if (body !== undefined) regions.push(body);
  }
  return regions.some((region) =>
    region.operations.some((inner) => runsRoutine(inner, functions, visiting))
  );
}

/** The regions that `regionReachesHost()` is answering, with their depth. */
const REGIONS_IN_PROGRESS = new Map<IRRegion, number>();
/** The least depth of a region in progress that the current walk read. */
let lowestInProgress = Infinity;

/**
 * Whether `region` reaches a host operation. A call cycle (the verifier
 * accepts one) reaches a region again while it is being answered: that
 * read answers `false`, and the answer of the cycle comes from its other
 * operations. An answer is remembered only when it is `true`, or when the
 * walk read no region in progress outside `region` (the outermost region of
 * the cycle has seen all of it); otherwise it depends on a region whose
 * answer is not known yet.
 */
function regionReachesHost(
  region: IRRegion,
  functions: readonly IRFunction[]
): boolean {
  const known = REGION_REACHES_HOST.get(region);
  if (known !== undefined) return known;
  const open = REGIONS_IN_PROGRESS.get(region);
  if (open !== undefined) {
    lowestInProgress = Math.min(lowestInProgress, open);
    return false;
  }
  const depth = REGIONS_IN_PROGRESS.size;
  REGIONS_IN_PROGRESS.set(region, depth);
  const outer = lowestInProgress;
  lowestInProgress = Infinity;
  let result: boolean;
  try {
    result = region.operations.some((op) => reachesHost(op, functions));
  } finally {
    REGIONS_IN_PROGRESS.delete(region);
  }
  const complete = lowestInProgress >= depth;
  if (result || complete) REGION_REACHES_HOST.set(region, result);
  lowestInProgress = Math.min(outer, complete ? Infinity : lowestInProgress);
  return result;
}

/** The regions that `op` evaluates. */
export function regionsOf(op: IROperation): readonly IRRegion[] {
  if (op.kind === 'if') return [op.then, op.else];
  if (
    op.kind === 'loop' ||
    op.kind === 'build' ||
    op.kind === 'seeded'
  )
    return [op.body];
  if (op.kind === 'routine')
    return op.alternative === undefined
      ? [op.body]
      : [op.body, op.alternative];
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

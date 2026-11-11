/**
 * The emitter of the structured representation of the internal scalar
 * JavaScript fragment target (`structured-ir.ts`): from a
 * verified program to JavaScript statements, a final value, function
 * definitions and the dependencies of that code.
 *
 * The emitter reads only the program. It does not read an expression, a
 * type of the engine or a fact of the compiler, and it calls no part of the
 * existing emitter. The assembly of the result (`compileToTarget()` in
 * `javascript-target.ts`) gives the names: the source of a read of each
 * input and a fresh name for each local.
 *
 * Rules:
 *
 * - Each operation is written once. A literal has no evaluation: its text is
 *   written at each use.
 * - The value of an operation is written at its use, as a part of the
 *   expression of the use, when all of these are true: the operation is
 *   `pure`; the value has exactly one use; that use is in the region of the
 *   definition, not in a nested region; every operation between the
 *   definition and the use is `pure`; and, when the code of the value can
 *   abort with a kind that the policy states (`statesAbort()`, also of an
 *   operand written into it: not an iteration budget or a seed), the
 *   code of no operation between the two can. The evaluation of the value
 *   then moves from its definition to its use, and only across pure
 *   operations, so no effect changes its order, and the first abort of a
 *   call is the one of the program. A read of an input is `pure`: compiled code
 *   treats an input as a value, and the order and the number of the reads of
 *   a getter of the vars object are unspecified. Neither the entry check of
 *   `run()` nor `rawCall` makes a snapshot of the vars object, so a getter
 *   runs at each read that the code makes.
 * - Every other value binds a `const` (or a `let` for an `if`, an `and` and
 *   an `or` written as statements) at the position of its operation. An
 *   operation whose effect is `effectful` or `unknown` is always such a
 *   statement, so the statements keep the order of the effects of the
 *   program.
 * - A value that the code reads twice (a complex operand of a complex sum,
 *   whose text is written once per component, an operand of a complex
 *   product or quotient) counts as two uses, so it is evaluated once, into a
 *   `const`.
 * - A region whose statements are all written into its value is one
 *   expression. An `if` whose two regions are expressions is the conditional
 *   operator `c ? a : b`, and an `and` or an `or` whose regions after the
 *   first operand are expressions is `&&` or `||`: JavaScript evaluates a
 *   branch or an operand only when it is selected, as the program does.
 *   Otherwise the `and` or `or` is a chain of `if` statements, with a block
 *   for each region, and the `if` an `if` statement: one `let` per result,
 *   assigned at the end of each branch. An `if` of several results, or of
 *   none (the merged values of locals that branches write), is always an
 *   `if` statement. A closed branch (`isClosedRegion()`) assigns no result:
 *   the results of an `if` with one closed branch are assigned in the open
 *   branch only.
 * - An `exit` assigns each carried variable of its loop its operand, with
 *   the order rule of the end of a loop body (below), then writes
 *   `break;`. The `exit` is in branches of `if` statements of the body of
 *   its loop only, so the `break` leaves that `for` statement.
 * - Parentheses come from the precedence of the JavaScript operators. A
 *   negative number literal, `-0` and `-Infinity` have the precedence of a
 *   unary minus. The operand of a unary minus is in parentheses unless it is
 *   a name, a literal that is not negative, or a call, so that `-(-x)` and
 *   `-(-1)` are never `--x` and `--1`. The operands after
 *   the first of a left-associative operator are in parentheses when their
 *   precedence is the same: `a + (b + c)` keeps the order of a floating-point
 *   sum.
 * - A `loop` is a `for` statement with one `let` per result, declared
 *   before it with the initial value; the parameter of a carried value in
 *   the body is that variable too. The bounds are read once each before the
 *   first iteration (a bound that is not a name or a literal is bound to a
 *   `const` first, because the code reads its text more than once). The
 *   index goes from `from` to `to`, in steps of 1, or of -1 when `to` is
 *   less than `from`: the step and the number of passes are `const`
 *   values before the `for`, whose counter goes from 0, and the first
 *   statement of the body computes the index from the counter, as the
 *   existing emitter writes a range (`compileCountedRange()` in
 *   `compile-loops.ts`). At the end of the body, each
 *   carried variable is assigned its next value; when more than one changes,
 *   each next value that could read a carried variable is first bound to a
 *   `const`, so that every next value reads the values of the iteration
 *   that ends. With an iteration budget, each iteration first calls
 *   `_SYS.countLoopPass()` with the floored budget, as the existing emitter
 *   writes it (`loopPassCount()` in `compile-loops.ts`), and the assembly of
 *   the result starts each call with `_SYS.resetLoopPasses()`. A value of
 *   the body is never written outside it, and a value defined before the
 *   loop that the body uses is a name or a literal (the rule above: its use
 *   is in a nested region).
 * - A conversion is written where its operation is, in its region.
 * - A helper is one JavaScript function declaration, called with values.
 *   Its body reads its parameters and the snapshots of captured bindings,
 *   and can call another helper: a declaration is hoisted, so the order of
 *   the definitions does not matter.
 * - A read of a captured binding is its snapshot, written as a number
 *   literal at each use, as the existing emitter writes the stored value.
 * - Numbers are JavaScript numbers and complex numbers are `{re, im}`
 *   objects, as in the existing emitter. A complex sum is written per
 *   component, with the real operands in the real part only, as the
 *   existing emitter writes it, a complex negation calls the runtime helper `_SYS.cneg`, a
 *   real square root is `Math.sqrt` and a complex one calls `_SYS.csqrt`,
 *   a complex product is written per component, with a real operand as a
 *   factor of each part, `mod` calls `_SYS.floorMod`, `floor` is
 *   `Math.floor` and `divide` is `/`, as the existing emitter does. A
 *   complex quotient is the guarded text of the existing emitter: three
 *   `const` statements and a conditional that calls `_SYS.cdivedge` where
 *   the textbook formula is not accurate (`complexQuotient()`). `complex(a,
 *   b)` is `({ re: a, im: b })`, and `pow` of complex operands
 *   `_SYS.cpow`. An object literal is in parentheses, so that it is never
 *   read as a block.
 * - In the mode `bigint` (`IRProgram.numericPolicy`), an integer is a
 *   JavaScript `bigint`: a literal is `123n`, `add`, `negate`, `multiply`
 *   and the comparisons are the operators of `bigint` values, and `mod`,
 *   `min`, `max`, `abs`, `sign` and each integer function
 *   (`IRIntegerFunction`) call the helper of `bigint-runtime.ts` that the
 *   bigint emitter of the existing compiler calls (`BIGINT_CODE`). A
 *   `no-value` is the throw of a `_SYS.NonFiniteValue`. The code of the
 *   program is in the wrapper of the entry of that emitter
 *   (`entryWrapper()`): each lifted input read once into a local, and one
 *   catch of the `NonFiniteValue` of a pole; a helper has no catch of its
 *   own, so a pole in it ends the call, as in that emitter. A list of
 *   integers is an array of `bigint` values: `at` is `_SYS.bat(list, i)`,
 *   `length` is `_SYS.toBigint(list.length)`, `replace-at` is
 *   `_SYS.breplaceAt(list, i, v)`, which copies (the mode has no update in
 *   place), and `take`, `drop` and `range` are `_SYS.btake`, `_SYS.bdrop`
 *   and `_SYS.brange`. A loop with a `bigint` index is
 *   `for (let k = from; k <= to; k++)`, the `for` statement of that emitter.
 * - A list and a tuple are a JavaScript array of numbers. `list` and
 *   `tuple` are the array literal `[a, b, …]`, and `get` of the position
 *   `i` is `t[i - 1]`, as the existing emitter writes a list literal, a
 *   tuple and a term of the sum of a tuple. `at` calls the runtime helper
 *   `_SYS.atNumeric(list, index, element type)`, or `_SYS.at(tuple, index)`
 *   for a tuple, and `length` reads
 *   `list.length`, as the existing emitter writes a read of a list input or
 *   parameter (`At` and `Length` in `javascript-target.ts`). The helper
 *   returns the element at an integer index in range, counts a negative
 *   index from the end, returns `NaN` for an index out of range, and throws
 *   when the element is an array. The third argument names the element
 *   type in the message of that throw: the element type that the program
 *   declares for the list input or parameter (`IRInput.elementLabel`), as
 *   the existing emitter writes it.
 * - A `build` is `const r = [];` and a `for` statement over its range, with
 *   the header of a `loop`, whose body ends with `r.push(element)`: one
 *   array, filled in the order of the index, as the existing emitter writes
 *   a comprehension over a range (`compileComprehension()` in
 *   `compile-loops.ts`). Like the existing emitter, it counts no pass of the
 *   iteration budget. A `build` or a `loop` with `ascending` counts up from
 *   `from` to `to`, and runs no pass when `to` is less than `from`.
 * - An `append` is `(r.push(x), r)` when `inPlaceUpdates()` admits it: the
 *   array of the operand gets the element and is the result, as the
 *   `result.push()` of the guarded comprehension of the existing emitter;
 *   otherwise it is the copy `[...r, x]`. The in-place form reads the text
 *   of the list twice, which is bound to a name (`usesOf()`).
 * - A `replace-at` calls `_SYS.replaceAt(list, index, value)`, which copies
 *   the array, or `_SYS.replaceAtInPlace(list, index, value)`, which writes
 *   the array of the operand and returns it, when `inPlaceUpdates()`
 *   (`structured-in-place.ts`) admits the operation. These are the helpers
 *   of the existing emitter, so the values and the throw of an index out of
 *   range agree. A value is not moved to its use across an operation that
 *   writes in place (`mutatesInPlace()`), as across an effect: it can read
 *   the array before the write.
 * - `not` is `!x`.
 * - A `draw` is `_SYS.drawNextRandomNumber()`, as the existing emitter
 *   writes `Random()`. It is `effectful`, so it is a `const` at its
 *   position, and the order of the draws is the order of the operations,
 *   the order of the prepared tree. A pure value is never moved across a
 *   draw (the rule of the value written at its use); it touches no state,
 *   and no other code reads the random stream, so moving it would not change
 *   what it reads: the rule only keeps the order of the code that of the
 *   program. A branch, an operand of `and` or `or` and a term that draws
 *   have a `const` statement, so their region is not an expression: the
 *   `if` is a statement, the `and` a chain of `if` statements, and a draw
 *   runs only when its region runs.
 * - A host operation (`IRHostCall`) is the source that the assembly gives
 *   for its binding (`StructuredEmitOptions.host`): the call `f(a, b)` of a
 *   `functions` or `operators` entry, or the text of a `vars` source. It is
 *   a `const` at its position, also when it is `pure`, and no value is moved
 *   across it, so the host sees its calls and reads in the order and the
 *   number of the program.
 * - A `seeded` is `_SYS.withRandomSeed(seed, () => { …; return value; })`,
 *   the closure of the existing emitter: the helper installs a frame of the
 *   random stream, runs the body once, and installs the frame of the caller
 *   again, also when the body throws. It is a `const` at its position, also
 *   when it is pure; the seed is evaluated before the frame is installed. A
 *   literal seed is a number literal or a string literal.
 * - A function of one or two operands (`unary`, `binary`) is the call that
 *   the existing emitter writes for the same operand (`FUNCTION_CODE`):
 *   `Math.exp`, `Math.log`, `Math.sin`, `Math.cos`, `Math.tanh`,
 *   `Math.abs` and `Math.atan2` of numbers, and the runtime helpers
 *   `_SYS.cexp`, `_SYS.cln`, `_SYS.csin`, `_SYS.ccos`, `_SYS.ctanh` and
 *   `_SYS.cabs` of an `{re, im}` object; the same for the trigonometric,
 *   hyperbolic and special functions (`_SYS.tan`, `Math.asin`,
 *   `_SYS.erf`, …, and `_SYS.ctan`, `_SYS.casin`, …). The powers and roots
 *   (`PowerFunctionName`) are the code of the `Power` and `Root` handlers:
 *   `_SYS.pow(b, e)`, `Math.pow(b, e)` (`real-pow`),
 *   `Math.pow(Math.abs(b), e)` and its signed form (`abs-pow`,
 *   `signed-pow`), `Math.cbrt(x)` and `_SYS.root(x, n)`. `haversine` and
 *   `round-ties-away` are the expressions of their handlers
 *   (`TemplateFunctionName`), and so is the real code of `acot`, `acsc`,
 *   `asec`, `acoth`, `asech`, `acsch`, `coth` and `fract`
 *   (`REAL_TEMPLATES`). `haversine` of an operand that is not the
 *   read of an input written `_.x` fails in a parent that needs
 *   parentheses around it: the existing emitter writes that code in its
 *   parent with no parentheses (`Source.bare`).
 *
 * The design is `docs/plans/2026-11-09-js-structured-scalar-emitter.md`,
 * "Integration with existing JavaScript compilation".
 */
import {
  elementOf,
  isClosedRegion,
  isTupleType,
  reachesHost,
  regionsOf,
  yieldedValues,
  type IRExit,
  type IRFunction,
  type IRHostBinding,
  type IRLoop,
  type IROperation,
  type IRProgram,
  type IRRegion,
  type IRValue,
  type BinaryFunctionName,
  type IntegerFunctionName,
  type IntegerRounding,
  type UnaryFunctionName,
} from './structured-ir.js';
import { inPlaceUpdates, mutatesInPlace } from './structured-in-place.js';

/**
 * The helpers of `bigint-runtime.ts` that the bigint emitter of the existing
 * compiler calls for each integer function (`compile-bigint-emit.ts`): a
 * name of `_SYS`, or a name per rounding. `rounded-pow` is the division
 * helper of its rounding applied to `_SYS.bpowRational(a, e)`, the exact
 * quotient of the power; `isqrt` with the rounding `floor` or `truncate` is
 * `_SYS.bisqrt`.
 */
const BIGINT_CODE: Readonly<
  Record<
    Exclude<IntegerFunctionName, 'quotient' | 'isqrt' | 'rounded-pow'>,
    string
  >
> = {
  'remainder': 'bremainder',
  'int-pow': 'bpow',
  'neg-one-pow': 'bnegOnePow',
  'gcd': 'bgcd',
  'lcm': 'blcm',
  'factorial': 'bfactorial',
  'factorial2': 'bfactorial2',
  'binomial': 'bbinomial',
  'fibonacci': 'bfibonacci',
  'is-prime': 'isPrimeBigint',
};

/** The division helper of each rounding (`bfloorDiv`, …, `bexactDiv`). */
const BIGINT_DIVISION: Readonly<Record<IntegerRounding, string>> = {
  'floor': 'bfloorDiv',
  'ceil': 'bceilDiv',
  'round-ties-away': 'broundDiv',
  'truncate': 'btruncDiv',
  'exact': 'bexactDiv',
};

/** The integer square root of each rounding; `exact` has none. */
const BIGINT_SQRT: Readonly<Partial<Record<IntegerRounding, string>>> = {
  'floor': 'bisqrt',
  'truncate': 'bisqrt',
  'ceil': 'bceilSqrt',
  'round-ties-away': 'broundSqrt',
};

/**
 * The JavaScript code of each function of the representation: the function
 * for operands of the representation `number`, and the runtime helper (a
 * name of `_SYS`) for an operand of the representation `complex`, or
 * `undefined` when the policy has no complex operand for it
 * (`JAVASCRIPT_POLICY.functions`). These are the calls of the handlers of
 * the existing emitter (`Exp`, `Ln`, `Sin`, `Cos`, `Tanh`, `Abs`,
 * `Arctan2`, and the trigonometric, hyperbolic and special functions in
 * `javascript-target.ts`); the rules of the structured route
 * refuse the operands for which those handlers write other code.
 */
const FUNCTION_CODE: Readonly<
  Record<
    Exclude<
      UnaryFunctionName | BinaryFunctionName,
      PowerFunctionName | TemplateFunctionName
    >,
    { readonly real?: string; readonly complex?: string }
  >
> = {
  exp: { real: 'Math.exp', complex: 'cexp' },
  ln: { real: 'Math.log', complex: 'cln' },
  sin: { real: 'Math.sin', complex: 'csin' },
  cos: { real: 'Math.cos', complex: 'ccos' },
  tanh: { real: 'Math.tanh', complex: 'ctanh' },
  abs: { real: 'Math.abs', complex: 'cabs' },
  atan2: { real: 'Math.atan2' },
  // The heads of `javascript-target.ts` that write one call for a real
  // operand and one runtime helper for an `{re, im}` object.
  tan: { real: '_SYS.tan', complex: 'ctan' },
  cot: { real: '_SYS.cot', complex: 'ccot' },
  sec: { real: '_SYS.sec', complex: 'csec' },
  csc: { real: '_SYS.csc', complex: 'ccsc' },
  sinh: { real: 'Math.sinh', complex: 'csinh' },
  cosh: { real: 'Math.cosh', complex: 'ccosh' },
  atan: { real: 'Math.atan', complex: 'catan' },
  asinh: { real: 'Math.asinh', complex: 'casinh' },
  gamma: { real: '_SYS.gamma', complex: 'cgamma' },
  sign: { real: 'Math.sign', complex: 'csign' },
  // A real operand of `Conjugate` is the operand itself (the form
  // `identity` of the lowering): no real call.
  conjugate: { complex: 'cconj' },
  asin: { real: 'Math.asin', complex: 'casin' },
  acos: { real: 'Math.acos', complex: 'cacos' },
  acosh: { real: 'Math.acosh', complex: 'cacosh' },
  atanh: { real: 'Math.atanh', complex: 'catanh' },
  log10: { real: 'Math.log10', complex: 'clog10' },
  log2: { real: 'Math.log2', complex: 'clog2' },
  erf: { real: '_SYS.erf' },
  erfc: { real: '_SYS.erfc' },
  digamma: { real: '_SYS.digamma' },
  sinpi: { real: '_SYS.sinpi' },
  cospi: { real: '_SYS.cospi' },
  tanpi: { real: '_SYS.tanpi' },
  ceil: { real: 'Math.ceil' },
  acot: { complex: 'cacot' },
  acsc: { complex: 'cacsc' },
  asec: { complex: 'casec' },
  acoth: { complex: 'cacoth' },
  asech: { complex: 'casech' },
  acsch: { complex: 'cacsch' },
  coth: { complex: 'ccoth' },
  sech: { complex: 'csech' },
  csch: { complex: 'ccsch' },
  factorial: { real: '_SYS.factorial' },
  factorial2: { real: '_SYS.factorial2' },
  trunc: { real: 'Math.trunc' },
  // The real code of `fract` is a template (`REAL_TEMPLATES`).
  fract: {},
  hypot: { real: 'Math.hypot' },
};

/**
 * The real code of the functions whose handler writes an expression, not
 * one call, for a real operand `x` (`Arccot`, `Arccsc`, `Arcsec`,
 * `Arcoth`, `Arsech`, `Arcsch` in `javascript-target.ts`): the text, and
 * its precedence. `coth` is `(Math.cosh(x) / Math.sinh(x))` and `fract`
 * `x - Math.floor(x)`, with the operand read twice (`usesOf()`).
 */
const REAL_TEMPLATES: Readonly<
  Partial<
    Record<
      UnaryFunctionName,
      (x: string) => { text: string; precedence: number }
    >
  >
> = {
  acot: (x) => ({ text: `(Math.PI / 2 - Math.atan(${x}))`, precedence: CALL }),
  acsc: (x) => ({ text: `Math.asin(1 / (${x}))`, precedence: CALL }),
  asec: (x) => ({ text: `Math.acos(1 / (${x}))`, precedence: CALL }),
  acoth: (x) => ({ text: `Math.atanh(1 / (${x}))`, precedence: CALL }),
  asech: (x) => ({ text: `Math.acosh(1 / (${x}))`, precedence: CALL }),
  acsch: (x) => ({ text: `Math.asinh(1 / (${x}))`, precedence: CALL }),
  coth: (x) => ({
    text: `(Math.cosh(${x}) / Math.sinh(${x}))`,
    precedence: CALL,
  }),
  fract: (x) => ({ text: `${x} - Math.floor(${x})`, precedence: ADDITIVE }),
};

/** The functions whose code is not one call: `haversine` is
 *  `(1 - Math.cos(x)) / 2`, as the handler of `Haversine` writes it,
 *  `round-ties-away` is `(Math.sign(x) * Math.round(Math.abs(x)))`, as the
 *  handler of `Round` writes it for `ce.roundingTies` `'away-from-zero'`
 *  (`jsRoundToInteger()`), with the operand read twice, and `complex` is
 *  the object `({ re: a, im: b })`. */
type TemplateFunctionName = 'haversine' | 'round-ties-away' | 'complex';

/** The powers and the roots of numbers (`BinaryFunctionName`, and `cbrt`
 *  of `UnaryFunctionName`), which the emitter writes as the `Power` and
 *  `Root` handlers of the existing emitter write them. */
type PowerFunctionName =
  'pow' | 'abs-pow' | 'signed-pow' | 'real-pow' | 'root' | 'cbrt';

const isPowerFunction = (fn: string): fn is PowerFunctionName =>
  fn === 'pow' ||
  fn === 'abs-pow' ||
  fn === 'signed-pow' ||
  fn === 'real-pow' ||
  fn === 'root' ||
  fn === 'cbrt';

/** The names that the assembly of the result gives to the emitter. */
export type StructuredEmitNames = {
  /** The source of a read of the input `name` of the program. */
  readonly input: (name: string) => string;
  /** A name that no other name of the compilation uses. */
  readonly fresh: () => string;
};

export type StructuredEmitOptions = {
  /**
   * For tests only: the source of the operation that exists only for tests,
   * from its trace id and the sources of its operands. Without it, a
   * program with such an operation throws.
   */
  readonly trace?: (id: string, operands: readonly string[]) => string;
  /**
   * The source of a host operation (`IRHostCall`) of the binding `binding`,
   * from the sources of its operands: the code that the existing emitter
   * writes for the `functions`, `operators` or `vars` entry of its name. The
   * source is a call, a member access or a name, or is in parentheses, so a
   * parent reads it as one operand. Without it, a program with a host
   * operation throws.
   */
  readonly host?: (
    binding: IRHostBinding,
    operands: readonly string[]
  ) => string;
};

/** The code of a program. */
export type StructuredEmission = {
  /** One JavaScript function per helper, in the order of the program. Each
   *  reads its parameters and the snapshots of captured bindings. */
  readonly definitions: readonly string[];
  /** The statements of the root region, in order. */
  readonly statements: readonly string[];
  /** The source of the value of the program, after the statements. */
  readonly value: string;
  /** The names of the inputs that the statements read. */
  readonly inputs: ReadonlySet<string>;
  /** The helpers of the runtime object `_SYS` that the code calls. */
  readonly runtime: ReadonlySet<string>;
};

const fail = (message: string): never => {
  throw new Error(`JS structured emission: ${message}`);
};

/**
 * The precedence of the JavaScript operators that the emitter writes, from
 * the loosest to the tightest. `ATOM` is a name, a literal, or an
 * expression in parentheses.
 */
const CONDITIONAL = 2;
const OR = 3;
const AND = 4;
const EQUALITY = 8;
const RELATIONAL = 9;
const ADDITIVE = 11;
const MULTIPLICATIVE = 12;
const UNARY = 14;
const CALL = 17;
const ATOM = 20;

/** The text of an expression and the precedence of its outermost
 *  operator. `bare`: the existing emitter writes this text in its parent
 *  with no parentheses, and the emission fails with this message where the
 *  parent needs them (`haversine`). */
type Source = {
  readonly text: string;
  readonly precedence: number;
  readonly bare?: string;
};

const atom = (text: string): Source => ({ text, precedence: ATOM });

/** The text of `source` as an operand that needs at least the precedence
 *  `min`. */
function operand(source: Source, min: number): string {
  if (source.precedence >= min) return source.text;
  if (source.bare !== undefined) fail(source.bare);
  return `(${source.text})`;
}

/** The operands of a left-associative operator of precedence `p`: the first
 *  at `p`, the others above it. */
function leftAssociative(
  operands: readonly Source[],
  p: number,
  symbol: string
): Source {
  return {
    text: operands
      .map((s, i) => operand(s, i === 0 ? p : p + 1))
      .join(` ${symbol} `),
    precedence: p,
  };
}

/**
 * The source of the number `n`. JavaScript reads a negative number, `-0` and
 * `-Infinity` as a unary minus applied to a literal, so they have the
 * precedence of a unary operator: `x + -1`, `-1 * x`, and `-(-1)`.
 */
function numberSource(n: number): Source {
  if (Number.isNaN(n)) return atom('NaN');
  const text = Object.is(n, -0)
    ? '-0'
    : n === -Infinity
      ? '-Infinity'
      : String(n);
  return text.startsWith('-') ? { text, precedence: UNARY } : atom(text);
}

/** The source of the exact integer `n` as a JavaScript `bigint` literal
 *  (`123n`); a negative one has the precedence of a unary minus, as a
 *  negative number has (`numberSource()`). */
function bigintSource(n: bigint): Source {
  const text = `${String(n)}n`;
  return n < 0n ? { text, precedence: UNARY } : atom(text);
}

/** Write the code of `program`, which `verifyProgram()` accepted. */
export function emitStructuredProgram(
  program: IRProgram,
  names: StructuredEmitNames,
  options: StructuredEmitOptions = {}
): StructuredEmission {
  const emitter = new Emitter(program, names, options);
  const definitions = program.functions.map((fn, i) =>
    emitter.definition(fn, i)
  );
  const statements: string[] = [];
  const value = emitter.openRegion(program.root, statements, true)[0].text;
  if (
    program.numericPolicy === 'bigint' &&
    (program.noValueResult !== undefined || emitter.lifted.size > 0)
  )
    return {
      definitions,
      statements: [],
      value: emitter.entryWrapper(statements, value),
      inputs: emitter.inputs,
      runtime: emitter.runtime,
    };
  return {
    definitions,
    statements,
    value,
    inputs: emitter.inputs,
    runtime: emitter.runtime,
  };
}

/** The one value that `op` defines and that `Emitter.operation()` can
 *  write as an expression: an `if` of one result, or the result of any
 *  other operation but a yield. */
function singleResult(op: IROperation): IRValue | undefined {
  if (op.kind === 'if')
    return op.results.length === 1 ? op.results[0] : undefined;
  return op.result;
}

/** Where a value is used: the number of reads that the code makes of it,
 *  and the region and the position of its last use. */
type Use = { count: number; region: IRRegion; index: number };

/** The uses of each value of `program`, by its id. */
function usesOf(program: IRProgram): Map<number, Use> {
  const uses = new Map<number, Use>();
  const visit = (region: IRRegion) => {
    region.operations.forEach((op, index) => {
      // The text of a complex operand of a complex sum is written twice,
      // once per component (a real operand once: it has no imaginary part).
      // The text of an operand of a complex product is written four times
      // when both operands are complex, and twice when one is real; the text
      // of an operand of a complex quotient at least twice. The code of a
      // loop reads the text of each of its bounds more than once.
      const complex = op.result?.representation === 'complex';
      const readsOf = (i: number) =>
        op.kind === 'add' && complex
          ? op.operands[i].representation === 'complex'
            ? 2
            : 1
          : op.kind === 'multiply' && complex
            ? op.operands.every((v) => v.representation === 'complex')
              ? 4
              : 2
            : (op.kind === 'divide' && complex) ||
                ((op.kind === 'loop' || op.kind === 'build') && i <= 1) ||
                (op.kind === 'append' && i === 0) ||
                (op.kind === 'binary' && op.fn === 'signed-pow') ||
                (op.kind === 'unary' &&
                  (op.fn === 'round-ties-away' ||
                    op.fn === 'coth' ||
                    op.fn === 'fract'))
              ? 2
              : 1;
      for (const [i, value] of op.operands.entries()) {
        const reads = readsOf(i);
        const use = uses.get(value.id);
        if (use === undefined)
          uses.set(value.id, { count: reads, region, index });
        else {
          use.count += reads;
          use.region = region;
          use.index = index;
        }
      }
      for (const inner of regionsOf(op)) visit(inner);
    });
  };
  for (const fn of program.functions) visit(fn.body);
  visit(program.root);
  return uses;
}

class Emitter {
  /** The source of each value, by its id: a name, the text of a literal, or
   *  the expression of a value written at its use. */
  private readonly sources = new Map<number, Source>();
  /** The name of the JavaScript function of each helper, by its index. */
  private readonly functionNames: string[] = [];
  private readonly uses: Map<number, Use>;
  /** The values whose source is a name that the emitter binds, or a
   *  literal: a source that reads no variable that a loop assigns, other
   *  than its own name. */
  private readonly plain = new Set<number>();
  /** The value of each complex literal, by the id of its value: a complex
   *  sum writes its two parts as constants. */
  private readonly complexLiterals = new Map<
    number,
    { readonly re: number; readonly im: number }
  >();
  readonly inputs = new Set<string>();
  readonly runtime = new Set<string>();
  /** The name of the local of each `bigint` input that the host can give as
   *  a `number` (`IRInput.lifted`), by the name of the input: the input is
   *  read once, at the entry (`entryWrapper()`). */
  readonly lifted = new Map<string, string>();
  /** The values that are reads of an input, by their ids (`haversine`). */
  private readonly inputValues = new Set<number>();
  /** The declared element type of each list value that is an input or a
   *  parameter, by its id (`IRInput.elementLabel`). */
  private readonly elementLabels = new Map<number, string>();
  /** The `replace-at` operations that write in place (`inPlaceUpdates()`). */
  private readonly inPlace: ReadonlySet<IROperation>;
  /** The variables of the carried values of each loop whose body is being
   *  written, the innermost last: an `exit` assigns those of the last. */
  private readonly loops: (readonly string[])[] = [];

  constructor(
    private readonly program: IRProgram,
    private readonly names: StructuredEmitNames,
    private readonly options: StructuredEmitOptions
  ) {
    this.uses = usesOf(program);
    // The runtime of the mode `bigint` has no update in place: a
    // `replace-at` copies, as `_SYS.breplaceAt` of the existing emitter does.
    this.inPlace =
      program.numericPolicy === 'bigint' ? new Set() : inPlaceUpdates(program);
  }

  /**
   * The JavaScript function of the helper of index `index`. The names of all
   * the helpers are given before any body is written, so that a body can
   * call a helper of a higher index, or its own helper: a function
   * declaration is hoisted.
   */
  definition(fn: IRFunction, index: number): string {
    if (this.functionNames.length === 0)
      this.functionNames.push(
        ...this.program.functions.map(() => this.names.fresh())
      );
    const name = this.functionNames[index];
    fn.parameters.forEach((p, i) => {
      const label = fn.parameterElementLabels?.[i];
      if (label !== undefined) this.elementLabels.set(p.id, label);
    });
    const parameters = fn.parameters.map((p) => this.bind(p));
    const statements: string[] = [];
    const [value] = this.openRegion(fn.body, statements, false);
    return `function ${name}(${parameters.join(', ')}) { ${[
      ...statements,
      `return ${value.text};`,
    ].join(' ')} }`;
  }

  /**
   * The code of a program of the mode `bigint` (`emitStructuredProgram()`),
   * whose root has the statements `statements` and the value `value`, in
   * the wrapper of the entry of the existing emitter (`entryWrapper()` in
   * `compile-bigint-emit.ts`): each lifted input is read once into its
   * local, a `number` converted with `_SYS.toBigint`, a `bigint` kept; one
   * `try`/`catch` around the code returns the `number` of the
   * `_SYS.NonFiniteValue` that a pole throws (`IRProgram.noValueResult`),
   * and throws every other error again.
   */
  entryWrapper(statements: readonly string[], value: string): string {
    const lifts = [...this.lifted]
      .map(([name, id]) => {
        const read = this.names.input(name);
        return `const ${id} = typeof ${read} === 'number' ? _SYS.toBigint(${read}) : ${read}; `;
      })
      .join('');
    if (this.lifted.size > 0) this.runtime.add('toBigint');
    this.runtime.add('NonFiniteValue');
    const e = this.names.fresh();
    return `(() => { ${lifts}try { ${[...statements, `return ${value};`].join(' ')} } catch (${e}) { if (${e} instanceof _SYS.NonFiniteValue) return ${e}.value; throw ${e}; } })()`;
  }

  /** `region()` of a region that is open. */
  openRegion(region: IRRegion, out: string[], readsInputs: boolean): Source[] {
    return (
      this.region(region, out, readsInputs) ??
      fail('a closed region yields no value')
    );
  }

  /**
   * Append the statements of `region` to `out` and return the sources of
   * the values that it yields, or `undefined` for a closed region
   * (`isClosedRegion()`), which yields none. `readsInputs` is false in the
   * body of a helper.
   */
  region(
    region: IRRegion,
    out: string[],
    readsInputs: boolean
  ): Source[] | undefined {
    const operations = region.operations;
    // `impure[k]`: the number of operations before position `k` that are
    // not `pure`, that write an array in place (`mutatesInPlace()`), or that
    // run code of the host (`reachesHost()`): a value is not moved across
    // them.
    const impure = [0];
    for (const op of operations)
      impure.push(
        impure[impure.length - 1] +
          (op.effect === 'pure' &&
          !mutatesInPlace(op, this.inPlace) &&
          !reachesHost(op, this.program.functions)
            ? 0
            : 1)
      );
    // `abortsHere[k]`: whether the code of the operation at position `k` can
    // abort as it is written, with an abort kind that the policy states
    // (`statesAbort()`: an iteration budget and a seed are not such aborts,
    // and the code of the `strict` and `complex` modes does not depend on
    // this rule), or an operand that can be written into this code can (an operand that
    // an earlier operation of the region defines and that has one use, there:
    // a loop, a build and a seeded are statements, and their results are
    // names). `aborting[k]`: the number of operations before position `k`
    // whose code can abort. A value whose code can abort is not moved across
    // another one: the abort that ends the call would change.
    const abortsHere: boolean[] = [];
    const definedAt = new Map<number, number>();
    for (const [k, op] of operations.entries()) {
      const writtenInto = (v: IRValue) => {
        const at = definedAt.get(v.id);
        const use = this.uses.get(v.id);
        return (
          at !== undefined &&
          abortsHere[at] &&
          use?.count === 1 &&
          use.region === region
        );
      };
      abortsHere.push(
        statesAbort(op, this.program.functions) || op.operands.some(writtenInto)
      );
      if (op.kind !== 'loop' && op.kind !== 'build' && op.kind !== 'seeded')
        for (const v of op.kind === 'if'
          ? op.results
          : op.result
            ? [op.result]
            : [])
          definedAt.set(v.id, k);
    }
    const aborting = [0];
    for (const aborts of abortsHere)
      aborting.push(aborting[aborting.length - 1] + (aborts ? 1 : 0));
    for (const [index, op] of operations.entries()) {
      if (op.kind === 'yield') return op.operands.map((v) => this.source(v));
      if (op.kind === 'exit') {
        this.exit(op, out);
        return undefined;
      }
      const code = this.operation(op, out, readsInputs);
      if (code === undefined) continue;
      const result = singleResult(op)!;
      if (
        this.writtenAtUse(result, op, region, index, impure, {
          here: abortsHere[index],
          before: aborting,
        })
      )
        this.define(result, code);
      else out.push(`const ${this.bind(result)} = ${code.text};`);
    }
    // An `if` whose two branches are closed ends the region.
    if (isClosedRegion(region)) return undefined;
    return fail('a region has no yield');
  }

  /** The assignments of the carried variables of the innermost loop, then
   *  `break;`. */
  private exit(op: IRExit, out: string[]): void {
    const names = this.loops[this.loops.length - 1];
    if (names === undefined) return fail('an exit outside a loop');
    this.assignCarried(
      names,
      op.operands,
      op.operands.map((v) => this.source(v)),
      out
    );
    out.push('break;');
  }

  /**
   * Append to `out` the assignment of each carried variable `names[i]` whose
   * next value, `values[i]` of the source `sources[i]`, is not the variable
   * itself: at the end of a loop body and before the `break` of an `exit`.
   * Each next value is read before any carried variable is assigned: the
   * last one is assigned first, and every other one that could read a
   * carried variable is first bound to a `const`.
   */
  private assignCarried(
    names: readonly string[],
    values: readonly IRValue[],
    sources: readonly Source[],
    out: string[]
  ): void {
    // The carried values whose next value is not the variable itself.
    const changed = names.flatMap((name, i) =>
      sources[i].text === name ? [] : [i]
    );
    const carried = new Set(names);
    const assignments: string[] = [];
    const last = changed[changed.length - 1];
    const later: string[] = [];
    for (const i of changed) {
      if (i === last) {
        assignments.push(`${names[i]} = ${sources[i].text};`);
        continue;
      }
      if (this.plain.has(values[i].id) && !carried.has(sources[i].text)) {
        later.push(`${names[i]} = ${sources[i].text};`);
        continue;
      }
      const temporary = this.names.fresh();
      out.push(`const ${temporary} = ${sources[i].text};`);
      later.push(`${names[i]} = ${temporary};`);
    }
    out.push(...assignments, ...later);
  }

  /**
   * True when the value `result` of `op`, at the position `index` of
   * `region`, is written at its use: `op` is pure and runs no code of the
   * host (`reachesHost()`: the host can count its calls and their order), its
   * value has one use, in `region`, and every operation between the two is
   * pure; and, when the code of `op` can abort (`aborts.here`), the code of
   * no operation between the two can (`aborts.before`, `region()`).
   */
  private writtenAtUse(
    result: IRValue,
    op: IROperation,
    region: IRRegion,
    index: number,
    impure: readonly number[],
    aborts: { readonly here: boolean; readonly before: readonly number[] }
  ): boolean {
    if (op.effect !== 'pure' || reachesHost(op, this.program.functions))
      return false;
    const use = this.uses.get(result.id);
    if (use === undefined || use.count !== 1 || use.region !== region)
      return false;
    if (
      aborts.here &&
      aborts.before[use.index] - aborts.before[index + 1] !== 0
    )
      return false;
    return impure[use.index] - impure[index + 1] === 0;
  }

  /** A fresh name for `value`. */
  private bind(value: IRValue): string {
    const name = this.names.fresh();
    this.define(value, atom(name));
    this.plain.add(value.id);
    return name;
  }

  private define(value: IRValue, source: Source): void {
    if (this.sources.has(value.id))
      fail(`the value ${value.id} is defined twice`);
    this.sources.set(value.id, source);
  }

  private source(value: IRValue): Source {
    const source = this.sources.get(value.id);
    if (source === undefined)
      return fail(`the value ${value.id} has no source`);
    return source;
  }

  /**
   * The expression of the value of `op`, which `region()` writes at its use
   * or binds to a `const`. Undefined when `op` defines the source of its
   * values itself: a literal, and an `if`, `and` or `or` written as
   * statements in `out`.
   */
  private operation(
    op: IROperation,
    out: string[],
    readsInputs: boolean
  ): Source | undefined {
    const operands = op.operands.map((v) => this.source(v));
    const call = (fn: string, args: readonly Source[]): Source => ({
      text: `${fn}(${args.map((a) => operand(a, CONDITIONAL)).join(', ')})`,
      precedence: CALL,
    });
    switch (op.kind) {
      case 'literal': {
        this.plain.add(op.result.id);
        const value = op.value;
        if (typeof value === 'object')
          this.complexLiterals.set(op.result.id, value);
        this.define(
          op.result,
          typeof value === 'boolean'
            ? atom(String(value))
            : typeof value === 'number'
              ? numberSource(value)
              : typeof value === 'bigint'
                ? bigintSource(value)
                : atom(
                    `({ re: ${numberSource(value.re).text}, im: ${numberSource(value.im).text} })`
                  )
        );
        return undefined;
      }
      case 'capture':
        // The snapshot is written as a number literal at each use, as the
        // existing emitter writes the stored value of a captured binding.
        this.plain.add(op.result.id);
        this.define(op.result, numberSource(op.snapshot));
        return undefined;
      case 'input': {
        if (!readsInputs) fail('the body of a helper reads an input');
        const input = this.program.inputs[op.input];
        if (input === undefined) fail(`no input ${op.input}`);
        this.inputs.add(input.name);
        if (input.elementLabel !== undefined)
          this.elementLabels.set(op.result.id, input.elementLabel);
        this.inputValues.add(op.result.id);
        // A lifted `bigint` input is read once, at the entry, into a local
        // (`entryWrapper()`), as the bigint emitter of the existing compiler
        // reads it.
        if (input.lifted && input.representation === 'bigint') {
          let id = this.lifted.get(input.name);
          if (id === undefined) {
            id = this.names.fresh();
            this.lifted.set(input.name, id);
          }
          return atom(id);
        }
        // A lifted complex input is converted at each read, as the existing
        // emitter writes a wide name in the `complex` mode.
        return atom(
          input.lifted
            ? `_SYS.cplx(${this.names.input(input.name)})`
            : this.names.input(input.name)
        );
      }
      case 'add': {
        if (op.result.representation !== 'complex')
          return leftAssociative(operands, ADDITIVE, '+');
        // The text of the existing emitter (`Add` in `javascript-target.ts`):
        // the real parts of every operand, then the imaginary parts of the
        // complex operands only, each in the order of the operands; a complex
        // literal gives its two parts as constants, and a term that is the
        // constant `0` is dropped. So `z + 1` is `{ re: z.re + 1, im: z.im }`
        // and `x + 2i` is `{ re: x, im: 2 }`: a `-0` part stays `-0`. A value
        // that a local holds (`IRProgram.localValues`) is the name of the
        // local there, never a constant: its parts are read, and no term of
        // it is dropped: `(0.5 - i)·a + t` with `t = 0` is
        // `{ re: p.re + 0, im: p.im }`, `+0` where the part `p.re` is `-0`.
        const re: string[] = [];
        const im: string[] = [];
        const kept = new Set<number>();
        op.operands.forEach((v, i) => {
          const local = this.program.localValues?.has(v.id) === true;
          const literal = local ? undefined : this.complexLiterals.get(v.id);
          if (local) kept.add(re.length);
          if (literal !== undefined) {
            re.push(String(literal.re));
            im.push(String(literal.im));
          } else if (v.representation === 'complex') {
            if (local) kept.add(-1 - im.length);
            re.push(`${operand(operands[i], CALL)}.re`);
            im.push(`${operand(operands[i], CALL)}.im`);
          } else {
            // The existing emitter writes the code of a real operand as one
            // term: a conditional and a sum (`Sum`, the identity of
            // `Conjugate` or `Abs` of a sum, the arithmetic of a draw from a
            // literal domain, `z + Random(Interval(0, 2))`) in parentheses,
            // or as an immediately called function, and a local as its name.
            // The route writes a real operand of additive precedence (a sum
            // or a conditional) in parentheses, which gives the same double.
            re.push(operand(operands[i], ADDITIVE + 1));
          }
        });
        // `kept`: the index `k` of each real part, and `-1 - k` of each
        // imaginary part, of a value that a local holds.
        const sum = (terms: readonly string[], key: (k: number) => number) => {
          const nonZero = terms.filter((t, k) => t !== '0' || kept.has(key(k)));
          return nonZero.length === 0 ? '0' : nonZero.join(' + ');
        };
        return atom(
          `({ re: ${sum(re, (k) => k)}, im: ${sum(im, (k) => -1 - k)} })`
        );
      }
      case 'negate':
        if (op.result.representation !== 'complex')
          return { text: `-${operand(operands[0], CALL)}`, precedence: UNARY };
        this.runtime.add('cneg');
        return call('_SYS.cneg', operands);
      case 'multiply': {
        if (op.result.representation !== 'complex')
          return leftAssociative(operands, MULTIPLICATIVE, '*');
        // The texts of the existing emitter (`Multiply` in
        // `javascript-target.ts`): `(a.re b.re - a.im b.im) + i (a.re b.im +
        // a.im b.re)` for two complex operands, `a b.re + i a b.im` for a
        // real `a`, and `a.re b + i a.im b` for a real `b`. A part of a
        // complex literal is its constant (`parts()`).
        const [ca, cb] = op.operands.map((v) => v.representation === 'complex');
        if (ca && cb) {
          const [ar, ai] = this.parts(op.operands[0], operands[0]);
          const [br, bi] = this.parts(op.operands[1], operands[1]);
          return atom(
            `({ re: ${ar} * ${br} - ${ai} * ${bi}, im: ${ar} * ${bi} + ${ai} * ${br} })`
          );
        }
        if (cb) {
          const a = operand(operands[0], MULTIPLICATIVE);
          const [br, bi] = this.parts(op.operands[1], operands[1]);
          return atom(`({ re: ${a} * ${br}, im: ${a} * ${bi} })`);
        }
        const [ar, ai] = this.parts(op.operands[0], operands[0]);
        const b = operand(operands[1], MULTIPLICATIVE + 1);
        return atom(`({ re: ${ar} * ${b}, im: ${ai} * ${b} })`);
      }
      case 'divide':
        if (op.result.representation !== 'complex')
          return leftAssociative(operands, MULTIPLICATIVE, '/');
        return this.complexQuotient(op.operands, operands, out);
      case 'mod':
        if (op.result.representation === 'bigint') {
          this.runtime.add('bfloorMod');
          return call('_SYS.bfloorMod', operands);
        }
        this.runtime.add('floorMod');
        return call('_SYS.floorMod', operands);
      case 'floor':
        return call('Math.floor', operands);
      case 'less':
        return leftAssociative(operands, RELATIONAL, '<');
      case 'less-equal':
        return leftAssociative(operands, RELATIONAL, '<=');
      case 'equal':
        return leftAssociative(operands, EQUALITY, '===');
      case 'not-equal':
        return leftAssociative(operands, EQUALITY, '!==');
      case 'sqrt':
        if (op.result.representation !== 'complex')
          return call('Math.sqrt', operands);
        this.runtime.add('csqrt');
        return call('_SYS.csqrt', operands);
      case 'unary':
      case 'binary': {
        const fn = op.fn;
        if (isPowerFunction(fn)) {
          // `Power` in `javascript-target.ts`: `_SYS.pow(b, e)` for an
          // exponent that is not a literal, `Math.pow(b, e)` for a constant
          // exponent (`real-pow`), and the real root of a float literal
          // exponent, `Math.pow(Math.abs(b), e)`, negated for a negative `b`
          // when the recovered numerator is odd. The base of `signed-pow` is
          // read twice, and is bound to a name (`usesOf()`). `Root`:
          // `Math.cbrt(x)` for the degree 3, `_SYS.root(x, n)` for a degree
          // that is not a literal.
          // `_SYS.cpow(b, e)` for complex operands.
          if (fn === 'pow' && op.result.representation === 'complex') {
            this.runtime.add('cpow');
            return call('_SYS.cpow', operands);
          }
          if (fn === 'pow' || fn === 'root') {
            this.runtime.add(fn);
            return call(`_SYS.${fn}`, operands);
          }
          if (fn === 'real-pow') return call('Math.pow', operands);
          if (fn === 'cbrt') return call('Math.cbrt', operands);
          const [b, e] = operands.map((o) => operand(o, CONDITIONAL));
          const magnitude = `Math.pow(Math.abs(${b}), ${e})`;
          return fn === 'abs-pow'
            ? { text: magnitude, precedence: CALL }
            : atom(`(${b} < 0 ? -${magnitude} : ${magnitude})`);
        }
        if (fn === 'haversine') {
          // The handler of `Haversine` binds an operand whose code is not a
          // name or digits in a function that it calls, whose value is this
          // code in parentheses. It writes the code of another operand (a
          // parameter, a local, a literal, a node that it writes as its
          // operand) in its parent with no parentheses
          // (`inlineExpression()`): `a / Haversine(x)` with a parameter `x`
          // is `a / (1 - Math.cos(x)) / 2`, `(a / (1 - cos x)) / 2`. So
          // where its parent needs the parentheses, the code is written only
          // for the read of an input, which the existing emitter writes
          // `_.x`, as this emitter does, and not for a parameter, which both
          // write as a name (`operand()`).
          return {
            text: `(1 - Math.cos(${operand(operands[0], CONDITIONAL)})) / 2`,
            precedence: MULTIPLICATIVE,
            ...(this.inputValues.has(op.operands[0].id) &&
            !/^[\p{L}_][\p{L}\p{N}_]*$|^[0-9]+$/u.test(operands[0].text)
              ? {}
              : {
                  bare:
                    'Haversine of an operand that is not an input, in a parent ' +
                    'that needs parentheses around it: the existing emitter ' +
                    'writes it with no parentheses',
                }),
          };
        }
        if (fn === 'round-ties-away') {
          // The operand is read twice, and is bound to a name (`usesOf()`).
          const x = operand(operands[0], CONDITIONAL);
          return atom(`(Math.sign(${x}) * Math.round(Math.abs(${x})))`);
        }
        if (fn === 'complex') {
          const [re, im] = operands.map((o) => operand(o, CONDITIONAL));
          return atom(`({ re: ${re}, im: ${im} })`);
        }
        // `_SYS.babs` and `_SYS.bsign` of a `bigint`.
        if (op.operands[0].representation === 'bigint') {
          const helper =
            fn === 'abs'
              ? 'babs'
              : fn === 'sign'
                ? 'bsign'
                : fail(`the function ${fn} has a bigint operand`);
          this.runtime.add(helper);
          return call(`_SYS.${helper}`, operands);
        }
        const code = FUNCTION_CODE[fn];
        if (!op.operands.some((v) => v.representation === 'complex')) {
          const template =
            op.kind === 'unary' ? REAL_TEMPLATES[op.fn] : undefined;
          if (template !== undefined)
            return template(
              operand(
                operands[0],
                op.fn === 'fract' ? MULTIPLICATIVE : CONDITIONAL
              )
            );
          const real = code.real;
          if (real === undefined)
            return fail(`the function ${op.fn} has a real operand`);
          if (real.startsWith('_SYS.'))
            this.runtime.add(real.slice('_SYS.'.length));
          return call(real, operands);
        }
        if (code.complex === undefined)
          return fail(`the function ${op.fn} has a complex operand`);
        this.runtime.add(code.complex);
        return call(`_SYS.${code.complex}`, operands);
      }
      case 'at':
        // `_SYS.bat(list, i)` of an array of `bigint` values: a pole carrying
        // `NaN` for an index out of range.
        if (op.result.representation === 'bigint') {
          this.runtime.add('bat');
          return call('_SYS.bat', operands);
        }
        if (isTupleType(op.operands[0].type)) {
          this.runtime.add('at');
          return call('_SYS.at', operands);
        }
        // An element of a list of tuples: `_SYS.atPoint(L, i, n)`, a tuple of
        // `n` `NaN` for an index out of range, as the existing emitter reads
        // a list of points.
        {
          const element = elementOf(op.operands[0].type);
          if (element !== undefined && isTupleType(element)) {
            this.runtime.add('atPoint');
            return call('_SYS.atPoint', [
              ...operands,
              atom(String(element.elements.length)),
            ]);
          }
          this.runtime.add('atNumeric');
          return call('_SYS.atNumeric', [
            ...operands,
            atom(
              JSON.stringify(
                this.elementLabels.get(op.operands[0].id) ?? element
              )
            ),
          ]);
        }
      case 'length':
        if (op.result.representation === 'bigint') {
          this.runtime.add('toBigint');
          return {
            text: `_SYS.toBigint(${operand(operands[0], CALL)}.length)`,
            precedence: CALL,
          };
        }
        return {
          text: `${operand(operands[0], CALL)}.length`,
          precedence: CALL,
        };
      case 'not':
        return { text: `!${operand(operands[0], UNARY)}`, precedence: UNARY };
      case 'list':
      case 'tuple':
        return atom(
          `[${operands.map((o) => operand(o, CONDITIONAL)).join(', ')}]`
        );
      case 'get':
        return {
          text: `${operand(operands[0], CALL)}[${op.position - 1}]`,
          precedence: CALL,
        };
      case 'append': {
        const [list, element] = operands;
        if (!this.inPlace.has(op))
          return atom(
            `[...${operand(list, CONDITIONAL)}, ${operand(element, CONDITIONAL)}]`
          );
        const name = operand(list, CALL);
        return atom(
          `(${name}.push(${operand(element, CONDITIONAL)}), ${name})`
        );
      }
      case 'replace-at': {
        const helper =
          op.result.representation === 'bigint-array'
            ? 'breplaceAt'
            : this.inPlace.has(op)
              ? 'replaceAtInPlace'
              : 'replaceAt';
        this.runtime.add(helper);
        return call(`_SYS.${helper}`, operands);
      }
      case 'collection':
        return this.collection(op, operands, call);
      case 'build': {
        // `const r = []; for (…) { …; r.push(element); }`: one array, filled
        // in the order of the index, as the existing emitter writes a
        // comprehension.
        const [from, to] = operands;
        const [index] = op.body.parameters ?? [];
        if (index === undefined) return fail('a build has no index');
        const name = this.bind(op.result);
        const k = this.bind(index);
        const range = this.rangeHeader(k, from, to, op.ascending === true);
        // The existing emitter tests the count of a comprehension over a
        // range before its loop (`_SYS.rangeCount()`): no array holds more
        // than 2^32 - 1 elements. An ascending build runs over the elements
        // of a list, which has fewer.
        if (op.ascending !== true)
          range.before.push(
            `if (${range.last} > 4294967294) ` +
              `throw new RangeError('Invalid array length');`
          );
        const body: string[] = [range.index];
        const [element] = this.openRegion(op.body, body, readsInputs);
        body.push(`${name}.push(${operand(element, CONDITIONAL)});`);
        out.push(
          `const ${name} = [];`,
          ...range.before,
          `${range.header} { ${body.join(' ')} }`
        );
        return undefined;
      }
      case 'min':
      case 'max':
        if (op.result.representation === 'bigint') {
          const helper = op.kind === 'min' ? 'bmin' : 'bmax';
          this.runtime.add(helper);
          return call(`_SYS.${helper}`, operands);
        }
        return call(op.kind === 'min' ? 'Math.min' : 'Math.max', operands);
      case 'integer': {
        // The helper of `bigint-runtime.ts` that the existing emitter calls.
        const fn = op.fn;
        if (fn === 'quotient' || fn === 'rounded-pow') {
          const division = BIGINT_DIVISION[op.rounding ?? 'exact'];
          this.runtime.add(division);
          if (fn === 'quotient') return call(`_SYS.${division}`, operands);
          this.runtime.add('bpowRational');
          const [a, e] = operands.map((o) => operand(o, CONDITIONAL));
          return {
            text: `_SYS.${division}(..._SYS.bpowRational(${a}, ${e}))`,
            precedence: CALL,
          };
        }
        const helper =
          fn === 'isqrt'
            ? (BIGINT_SQRT[op.rounding ?? 'exact'] ??
              fail(`an isqrt with the rounding ${String(op.rounding)}`))
            : BIGINT_CODE[fn];
        this.runtime.add(helper);
        return call(`_SYS.${helper}`, operands);
      }
      case 'no-value':
        // The throw of a folded pole, as the existing emitter writes it.
        this.runtime.add('NonFiniteValue');
        return {
          text: `(() => { throw new _SYS.NonFiniteValue(${op.value === 'undefined' ? 'NaN' : 'Infinity'}); })()`,
          precedence: CALL,
        };
      case 'convert':
        // An identity conversion of a write to a local of a wider type is
        // the text of its operand: a literal or a name is written at each
        // use, as the operand would be.
        if (op.conversion !== 'real-to-complex') {
          if (!this.plain.has(op.operands[0].id)) return operands[0];
          this.define(op.result, operands[0]);
          this.plain.add(op.result.id);
          return undefined;
        }
        return atom(`({ re: ${operand(operands[0], CONDITIONAL)}, im: 0 })`);
      case 'if': {
        const thenStatements: string[] = [];
        const thenValues = this.region(op.then, thenStatements, readsInputs);
        const elseStatements: string[] = [];
        const elseValues = this.region(op.else, elseStatements, readsInputs);
        if (
          op.results.length === 1 &&
          thenValues !== undefined &&
          elseValues !== undefined &&
          thenStatements.length === 0 &&
          elseStatements.length === 0
        )
          return {
            text: `${operand(operands[0], OR)} ? ${operand(thenValues[0], CONDITIONAL)} : ${operand(elseValues[0], CONDITIONAL)}`,
            precedence: CONDITIONAL,
          };
        // One `let` per result, assigned at the end of each open branch. A
        // closed branch ends in `break;` and assigns none.
        const names = op.results.map((result) => this.bind(result));
        const block = (
          statements: string[],
          values: readonly Source[] | undefined
        ) =>
          `{ ${[...statements, ...(values === undefined ? [] : names.map((name, i) => `${name} = ${values[i].text};`))].join(' ')} }`;
        const test = `if (${operands[0].text}) ${block(thenStatements, thenValues)}`;
        const otherwise =
          elseStatements.length === 0 && names.length === 0
            ? ''
            : ` else ${block(elseStatements, elseValues)}`;
        out.push(
          names.length === 0
            ? `${test}${otherwise}`
            : `let ${names.join(', ')}; ${test}${otherwise}`
        );
        return undefined;
      }
      case 'loop':
        out.push(...this.loop(op, operands, readsInputs));
        return undefined;
      case 'and':
      case 'or': {
        const regions = op.rest.map((region) => {
          const statements: string[] = [];
          const [value] = this.openRegion(region, statements, readsInputs);
          return { statements, value };
        });
        if (regions.every((r) => r.statements.length === 0))
          return leftAssociative(
            [operands[0], ...regions.map((r) => r.value)],
            op.kind === 'and' ? AND : OR,
            op.kind === 'and' ? '&&' : '||'
          );
        // `let t = a; if (t) { …; t = b; if (t) { …; t = c; } }` for `and`,
        // with `!t` for `or`: each region runs only when the operands before
        // it do not decide the result.
        const name = this.bind(op.result);
        const test = op.kind === 'and' ? name : `!${name}`;
        const chain = (i: number): string[] => {
          if (i === regions.length) return [];
          const { statements, value } = regions[i];
          return [
            `if (${test}) { ${[...statements, `${name} = ${value.text};`, ...chain(i + 1)].join(' ')} }`,
          ];
        };
        out.push(`let ${name} = ${operands[0].text};`, ...chain(0));
        return undefined;
      }
      case 'call': {
        const fn = this.functionNames[op.function];
        if (fn === undefined) return fail(`no function ${op.function}`);
        return call(fn, operands);
      }
      case 'draw':
        // Effectful: `region()` binds it to a `const` at its position.
        return { text: '_SYS.drawNextRandomNumber()', precedence: CALL };
      case 'seeded': {
        // `_SYS.withRandomSeed(seed, () => { …; return value; })`, bound to a
        // `const` at its position, also when it is pure: the body runs once,
        // in the closure, and only its value leaves it.
        const seed =
          op.operands.length > 0
            ? operand(operands[0], CONDITIONAL)
            : typeof op.seed === 'string'
              ? JSON.stringify(op.seed)
              : numberSource(op.seed ?? NaN).text;
        const body: string[] = [];
        const [value] = this.openRegion(op.body, body, readsInputs);
        const name = this.bind(op.result);
        out.push(
          `const ${name} = _SYS.withRandomSeed(${seed}, () => { ${[...body, `return ${value.text};`].join(' ')} });`
        );
        return undefined;
      }
      case 'trace': {
        const trace = this.options.trace;
        if (trace === undefined)
          return fail('a trace operation, and no trace source');
        // The source of the test operation is a call.
        const args = operands.map((a) => operand(a, CONDITIONAL));
        return { text: trace(op.trace, args), precedence: CALL };
      }
      case 'host': {
        // Bound to a `const` at its position (`writtenAtUse()`), so the host
        // operations run in the order of the program.
        const host = this.options.host;
        if (host === undefined)
          return fail('a host operation, and no host source');
        const binding = this.program.hosts?.[op.host];
        if (binding === undefined) return fail(`no host binding ${op.host}`);
        const args = operands.map((a) => operand(a, CONDITIONAL));
        return { text: host(binding, args), precedence: CALL };
      }
      default:
        return fail(
          `no emission for the operation ${(op as { kind: string }).kind}`
        );
    }
  }

  /**
   * The code of a function of lists (`IRCollection`), whose operands have
   * the sources `operands`: the code of the existing emitter for the head of
   * an array of numbers (`javascript-target.ts`). `norm`, `mean`, `median`
   * and `variance` call the runtime helper of the head; `dot` calls
   * `_SYS.matmul`, as `Dot` of two lists. `take` and `drop` of a count that
   * is an integer literal are `L.slice(0, n)` and `L.slice(n)` (`slice(n)`
   * and `slice(0, n)` for a negative `n`), and of another count the
   * function of `takeDropSlice()`, which reads `undefined` for a count that
   * is not a number: `((_a, _n) => Number.isNaN(_n) ? undefined : …)(L,
   * Math.round(n))`. `reverse` and `sort` copy the array first:
   * `L.slice().reverse()` and `L.slice().sort(cmp)` with the comparator of
   * the existing emitter, which puts a `NaN` after every number. `join` is
   * `[...L, ...M]`. `range` is the call of the existing emitter,
   * `((_a, _b) => _SYS.range(_a, _b, _b >= _a ? 1 : -1))(a, b)`, or
   * `_SYS.range(a, b, step)` with a step: the runtime throws for more than
   * 2^32 - 1 elements, and its first element is `a` itself. Each operand is
   * read once.
   */
  private collection(
    op: Extract<IROperation, { kind: 'collection' }>,
    operands: readonly Source[],
    call: (fn: string, args: readonly Source[]) => Source
  ): Source {
    const method = (text: string): Source => ({
      text: `${operand(operands[0], CALL)}.${text}`,
      precedence: CALL,
    });
    // An array of `bigint` values: the helpers of `bigint-runtime.ts` that
    // the existing emitter calls (`_SYS.btake`, `_SYS.bdrop`,
    // `_SYS.brange`), with a `bigint` count or bound.
    if (op.result.representation === 'bigint-array') {
      const helper =
        op.fn === 'take'
          ? 'btake'
          : op.fn === 'drop'
            ? 'bdrop'
            : op.fn === 'range'
              ? 'brange'
              : fail(`the function of lists ${op.fn} of bigint values`);
      this.runtime.add(helper);
      return call(`_SYS.${helper}`, operands);
    }
    switch (op.fn) {
      case 'norm':
      case 'mean':
      case 'median':
      case 'variance':
        this.runtime.add(op.fn);
        return call(`_SYS.${op.fn}`, operands);
      case 'dot':
        this.runtime.add('matmul');
        return call('_SYS.matmul', operands);
      case 'take':
      case 'drop': {
        const count = operands[1].text;
        const take = op.fn === 'take';
        if (this.plain.has(op.operands[1].id) && /^-?[0-9]+$/.test(count)) {
          const negative = count.startsWith('-');
          return method(
            take === negative ? `slice(${count})` : `slice(0, ${count})`
          );
        }
        const [before, after] = take
          ? ['_a.slice(_n)', '_a.slice(0, _n)']
          : ['_a.slice(0, _n)', '_a.slice(_n)'];
        return {
          text: `((_a, _n) => Number.isNaN(_n) ? undefined : _n < 0 ? ${before} : ${after})(${operand(operands[0], CONDITIONAL)}, Math.round(${operand(operands[1], CONDITIONAL)}))`,
          precedence: CALL,
        };
      }
      case 'reverse':
        return method('slice().reverse()');
      // The runtime helpers of `RotateLeft` and `RotateRight`, a new array:
      // the shift is rounded and taken modulo the length.
      case 'rotate-left':
        this.runtime.add('rotl');
        return call('_SYS.rotl', operands);
      case 'rotate-right':
        this.runtime.add('rotr');
        return call('_SYS.rotr', operands);
      case 'sort':
        return method(
          'slice().sort((_a, _b) => _a === _a ? (_b === _b ? _a - _b : -1) : (_b === _b ? 1 : 0))'
        );
      case 'join':
        return atom(
          `[${operands.map((o) => `...${operand(o, CALL)}`).join(', ')}]`
        );
      case 'range':
        this.runtime.add('range');
        // With a step, the call of the existing emitter for
        // `Range(a, b, step)`.
        if (operands.length === 3) return call('_SYS.range', operands);
        return {
          text:
            `((_a, _b) => _SYS.range(_a, _b, _b >= _a ? 1 : -1))` +
            `(${operand(operands[0], CONDITIONAL)}, ` +
            `${operand(operands[1], CONDITIONAL)})`,
          precedence: CALL,
        };
    }
  }

  /**
   * The texts of the real and the imaginary part of the complex value
   * `value`, whose source is `source`: `source.re` and `source.im`, or, for
   * a complex literal, its two constants, so that a product or a quotient
   * does not write the object of the literal at each read of a part, as the
   * existing emitter binds it once. A constant has the double of the part,
   * `-0` included (`numberSource()`); a negative constant has the
   * precedence of a unary minus, which every place of a part admits (a
   * factor, a divisor, an argument).
   */
  private parts(value: IRValue, source: Source): [string, string] {
    const literal = this.complexLiterals.get(value.id);
    if (literal !== undefined)
      return [numberSource(literal.re).text, numberSource(literal.im).text];
    const text = operand(source, CALL);
    return [`${text}.re`, `${text}.im`];
  }

  /**
   * The value of a complex `divide` of `values`, whose sources are
   * `sources`: the text of the existing emitter (`Divide` in
   * `javascript-target.ts`). For a real divisor `b`, the quotient of each
   * part, `{ re: a.re / b, im: a.im / b }`. For a complex divisor, three
   * `const` statements in `out` (the squared modulus `d` of the divisor and
   * the two parts `nr`, `ni` of the numerator), then the conditional that
   * reads the quotient from `_SYS.cdivedge` where the textbook formula is
   * not accurate, the test of `complexQuotient()` in
   * `numerics/numeric-complex.ts`: `d` is subnormal, zero or infinite, a
   * part of the numerator is not finite or is subnormal, or one of the
   * products of the parts is not an exact zero and not a normal double
   * (`_SYS.cprodok`). A real dividend `a` has the products `a * b.re` and
   * `-a * b.im`, and is the parts `a` and `0` of `_SYS.cdivedge`. Each
   * operand is read several times, and is bound to a name (`usesOf()`).
   */
  private complexQuotient(
    values: readonly IRValue[],
    sources: readonly Source[],
    out: string[]
  ): Source {
    const [ca, cb] = values.map((v) => v.representation === 'complex');
    if (!cb) {
      const [ar, ai] = this.parts(values[0], sources[0]);
      const divisor = operand(sources[1], MULTIPLICATIVE + 1);
      return atom(`({ re: ${ar} / ${divisor}, im: ${ai} / ${divisor} })`);
    }
    const [br, bi] = this.parts(values[1], sources[1]);
    const d = this.names.fresh();
    const nr = this.names.fresh();
    const ni = this.names.fresh();
    const min = '2.2250738585072014e-308';
    let tests: string;
    let edge: string;
    if (ca) {
      const [ar, ai] = this.parts(values[0], sources[0]);
      out.push(
        `const ${d} = ${br} * ${br} + ${bi} * ${bi};`,
        `const ${nr} = ${ar} * ${br} + ${ai} * ${bi};`,
        `const ${ni} = ${ai} * ${br} - ${ar} * ${bi};`
      );
      tests = `!_SYS.cprodok(${ar}, ${br}) || !_SYS.cprodok(${ai}, ${bi}) || !_SYS.cprodok(${ai}, ${br}) || !_SYS.cprodok(${ar}, ${bi})`;
      edge = `_SYS.cdivedge(${ar}, ${ai}, ${br}, ${bi})`;
    } else {
      const real = operand(sources[0], CONDITIONAL);
      out.push(
        `const ${d} = ${br} * ${br} + ${bi} * ${bi};`,
        `const ${nr} = ${operand(sources[0], MULTIPLICATIVE)} * ${br};`,
        `const ${ni} = -${operand(sources[0], CALL)} * ${bi};`
      );
      tests = `!_SYS.cprodok(${real}, ${br}) || !_SYS.cprodok(${real}, ${bi})`;
      edge = `_SYS.cdivedge(${real}, 0, ${br}, ${bi})`;
    }
    this.runtime.add('cprodok');
    this.runtime.add('cdivedge');
    return atom(
      `(${d} < ${min} || ${d} === Infinity || ${nr} - ${nr} !== 0 || ${ni} - ${ni} !== 0 || (${nr} !== 0 && Math.abs(${nr}) < ${min}) || (${ni} !== 0 && Math.abs(${ni}) < ${min}) || ${tests} ? ${edge} : { re: ${nr} / ${d}, im: ${ni} / ${d} })`
    );
  }

  /**
   * The statements of `op`, whose operands have the sources `operands`:
   * the `let` of each carried value, then the `for` statement.
   */
  private loop(
    op: IRLoop,
    operands: readonly Source[],
    readsInputs: boolean
  ): string[] {
    const [from, to, ...initial] = operands;
    const [index, ...parameters] = op.body.parameters ?? [];
    if (index === undefined) return fail('a loop has no index');
    // One variable per carried value: the parameter in the body, the
    // result after the loop.
    const names = op.results.map((result) => this.bind(result));
    parameters.forEach((p, i) => {
      this.define(p, atom(names[i]));
      this.plain.add(p.id);
    });
    const k = this.bind(index);
    // A `bigint` index is the counter of the `for` statement, as the bigint
    // emitter of the existing compiler writes a `Sum` (`loop()` in
    // `compile-bigint-emit.ts`): `for (let k = from; k <= to; k++)`, no pass
    // when `to` is less than `from`. The lowering of the mode writes only
    // ascending loops.
    if (index.representation === 'bigint' && op.ascending !== true)
      return fail('a loop with a bigint index that is not ascending');
    const range =
      index.representation === 'bigint'
        ? {
            before: [],
            header: `for (let ${k} = ${operand(from, CONDITIONAL)}; ${k} <= ${operand(to, RELATIONAL + 1)}; ${k}++)`,
            index: undefined,
          }
        : this.rangeHeader(k, from, to, op.ascending === true);
    const body: string[] = range.index === undefined ? [] : [range.index];
    if (op.iterationBudget !== undefined)
      body.push(`_SYS.countLoopPass(${Math.floor(op.iterationBudget)});`);
    this.loops.push(names);
    let next: Source[];
    try {
      next = this.openRegion(op.body, body, readsInputs);
    } finally {
      this.loops.pop();
    }
    // At the end of the body, the next value of each carried variable.
    this.assignCarried(names, yieldedValues(op.body), next, body);
    const declarations =
      names.length === 0
        ? []
        : [
            `let ${names.map((name, i) => `${name} = ${operand(initial[i], CONDITIONAL)}`).join(', ')};`,
          ];
    return [
      ...declarations,
      ...range.before,
      `${range.header} { ${body.join(' ')} }`,
    ];
  }

  /**
   * A loop whose index `k` visits each integer from `from` to `to`, both
   * included, in steps of 1, or of -1 when `to` is less than `from`:
   * `before`, two `const` statements that compute the step and the last
   * value of the counter, then `header`, a `for` statement whose counter
   * goes from 0 to that last value, and `index`, the first statement of the
   * body, which computes `k` from the counter. This is the form of the
   * existing emitter (`compileCountedRange()` in `compile-loops.ts`): V8
   * runs a loop whose counter is the only variable that the header changes
   * faster than a loop that changes the index and a count of the passes
   * left, by a variable step, in its header
   * (`docs/plans/2026-11-09-js-structured-pilot-measure.md`, "The loop
   * header revised"). The index is `from - counter` or `from + counter`,
   * not `from + step * counter`: for the step -1 and the counter 0 the
   * product is `-0`, after which V8 computes the index as a double, not as
   * a small integer, and a short loop that counts down runs slower (the
   * `loop-sum` fixture of `benchmarks/js-structured-pilot.ts`). The texts
   * of `from` and `to` are each read more than
   * once. A bound that is not finite, or a range of more than 2^32 − 1
   * elements, is not refused: the loop runs until the iteration budget
   * stops it, or for ever without one, where the existing emitter throws a
   * `RangeError`. With `ascending`, the step is 1 and there is no pass when
   * `to` is less than `from` (the last value of the counter is negative):
   * the pass over the elements of a list, from 1 to its length.
   */
  private rangeHeader(
    k: string,
    from: Source,
    to: Source,
    ascending = false
  ): { before: string[]; header: string; index: string; last: string } {
    const step = ascending ? '' : this.names.fresh();
    const last = this.names.fresh();
    const counter = this.names.fresh();
    if (ascending)
      return {
        before: [
          `const ${last} = ${operand(to, ADDITIVE)} - ${operand(from, ADDITIVE + 1)};`,
        ],
        header: `for (let ${counter} = 0; ${counter} <= ${last}; ${counter}++)`,
        index: `const ${k} = ${operand(from, ADDITIVE)} + ${counter};`,
        last,
      };
    return {
      before: [
        `const ${step} = ${operand(to, RELATIONAL + 1)} < ${operand(from, RELATIONAL + 1)} ? -1 : 1;`,
        `const ${last} = ${step} * (${operand(to, ADDITIVE)} - ${operand(from, ADDITIVE + 1)});`,
      ],
      header: `for (let ${counter} = 0; ${counter} <= ${last}; ${counter}++)`,
      index: `const ${k} = ${step} < 0 ? ${operand(from, ADDITIVE)} - ${counter} : ${operand(from, ADDITIVE)} + ${counter};`,
      last,
    };
  }
}

/** The answer of `statesAbort()` for each region, once per region object. */
const REGION_STATES_ABORT = new WeakMap<IRRegion, boolean>();

/** Whether the evaluation of `op` can abort with an abort kind that the
 *  policy states (`OperationBase.aborts`): `op` has one, a region that it
 *  evaluates holds such an operation, or it calls a function whose body
 *  holds one. `functions`: the functions of the program. */
function statesAbort(
  op: IROperation,
  functions: readonly IRFunction[]
): boolean {
  if (op.aborts !== undefined) return true;
  const regions: IRRegion[] = [...regionsOf(op)];
  if (op.kind === 'call') {
    const body = functions[op.function]?.body;
    if (body !== undefined) regions.push(body);
  }
  return regions.some((region) => {
    let answer = REGION_STATES_ABORT.get(region);
    if (answer === undefined) {
      // A function that calls itself reaches its body again: false meanwhile.
      REGION_STATES_ABORT.set(region, false);
      answer = region.operations.some((o) => statesAbort(o, functions));
      REGION_STATES_ABORT.set(region, answer);
    }
    return answer;
  });
}

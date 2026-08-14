import type {
  Expression,
  FunctionInterface,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import type { MathJsonSymbol } from '../../math-json/types.js';
import {
  isSymbol,
  isNumber,
  isFunction,
  isString,
} from '../boxed-expression/type-guards.js';
import { functionLiteralParameterName } from '../boxed-expression/function-literal.js';
import { Complex } from 'complex-esm';
import {
  tryGetConstant,
  negativeBaseRealPow,
  principalComplexPow,
} from './constant-folding.js';
import {
  collectionElementType,
  isNonRealNumber,
  resolveTypeForCompilation,
  stripMissingFromType,
} from '../../common/type/utils.js';
import { couldMatch, isSubtype } from '../../common/type/subtype.js';
import type { Type } from '../../common/type/types.js';

/**
 * The type a compile-time **representation** question about `expr` is answered
 * from: a `type alias` / nominal `type` reference unfolds to its definition
 * (compilation is type erasure — nominal-types design §4.6 step 1). Identity
 * for every other type. Kept local (not imported from `base-compiler`) for the
 * module-init ordering reason noted on `isIndexedCollectionOperand`.
 */
function jsType(expr: Expression): Type {
  return resolveTypeForCompilation(expr.type.type);
}

import {
  chop,
  ROUNDOFF_TOLERANCE,
  factorial,
  factorial2,
  realGcd as gcd,
  realLcm as lcm,
  limit,
  centeredDiffHigherOrder,
} from '../numerics/numeric.js';
import {
  parseColor,
  rgbToOklch,
  oklchToRgb,
  rgbToOklab,
  oklabToOklch,
  oklchToOklab,
  rgbToHsl,
  hslToRgb,
  rgbToHsv,
  hsvToRgb,
  oklabDeltaE,
  apca,
  contrastingColor,
  SEQUENTIAL_PALETTES,
  CATEGORICAL_PALETTES,
  DIVERGING_PALETTES,
} from '@arnog/colors';
import type { HexColor } from '@arnog/colors';
import {
  gamma,
  gammaln,
  erf,
  erfc,
  erfInv,
  beta,
  digamma,
  trigamma,
  polygamma,
  zeta,
  lambertW,
  besselJ,
  besselY,
  besselI,
  besselK,
  airyAi,
  airyBi,
  airyAiPrime,
  airyBiPrime,
  fresnelS,
  fresnelC,
  sinc,
  sinIntegral,
  cosIntegral,
  expIntegralEi,
  logIntegral,
  erfi,
  agm,
  ellipticK,
  ellipticE,
  ellipticEIncomplete,
  ellipticF,
  ellipticPiComplete,
  ellipticPiIncomplete,
  hypergeometric2F1,
  hypergeometric1F1,
  gammaQ,
  betaRegularized,
} from '../numerics/special-functions.js';
import { choose } from '../boxed-expression/expand.js';
import {
  correlation,
  covariance,
  interquartileRange,
  kurtosis,
  mean,
  median,
  mode,
  populationCovariance,
  populationStandardDeviation,
  populationVariance,
  quartiles,
  skewness,
  standardDeviation,
  variance,
} from '../numerics/statistics.js';
import { monteCarloEstimate } from '../numerics/monte-carlo.js';
import {
  adaptiveQuadrature,
  quadratureBeatsMonteCarlo,
} from '../numerics/gauss-kronrod.js';
import { MAX_RANDOM_ELEMENT_COUNT } from '../numerics/random.js';
import { interval } from '../numerics/interval.js';
import { withRandomSeedFrame } from '../boxed-expression/utils.js';
import { checkDeadline } from '../../common/interruptible.js';

import {
  BaseCompiler,
  couldBeCollectionParticipant,
  isFlatAllStringComparisonParticipant,
  isNumericTupleParticipant,
  isProvablyStringComparisonParticipant,
  isProvablyStringOperand,
  isProvablyTupleParticipant,
  pointHasBroadcastComponent,
  unfaithfulComparisonAggregate,
} from './base-compiler.js';
import { rewriteAngularUnit } from './angular-unit.js';
import type {
  CompileTarget,
  CompiledOperators,
  CompiledFunctions,
  LanguageTarget,
  CompilationOptions,
  CompilationResult,
  CompiledRunner,
  ComplexResult,
  OperandCompiler,
  TargetSource,
} from './types.js';

/**
 * JavaScript operator mappings
 */
const JAVASCRIPT_OPERATORS: CompiledOperators = {
  Add: ['+', 11],
  Negate: ['-', 14], // Unary operator
  Subtract: ['-', 11],
  Multiply: ['*', 12],
  Divide: ['/', 13],
  // Equal / NotEqual are NOT operators: a raw `===` is exact, but the
  // interpreter compares numbers within `engine.tolerance`. They are handled as
  // function forms (see `compileJSEquality`) so `0.1 + 0.2 === 0.3` matches the
  // interpreter's `True`.
  LessEqual: ['<=', 9],
  GreaterEqual: ['>=', 9],
  Less: ['<', 9],
  Greater: ['>', 9],
  And: ['&&', 4],
  Or: ['||', 3],
  Not: ['!', 14], // Unary operator
};

/**
 * Fail closed (D6) when EQUALITY (or the `IndexOf` element test) has a provably
 * string-valued operand — fully closed on any string evidence.
 *
 * Both lowerings are NUMERIC: equality is `Math.abs(a - b) <= tol`, which for
 * strings is `NaN <= tol` → a silent `false`, so a compiled `"a" == "a"`
 * answered `false` where the interpreter answers `True`. `IndexOf` uses the same
 * tolerance test, so a string needle was never found (0 instead of the
 * interpreter's 1-based index). String equality was never correct compiled, so
 * admitting it is a separate tier, not a soundness fix.
 *
 * The ORDERINGS are governed by the narrower `assertNoMixedStringOrdering`:
 * they emit a raw `<`, which the interpreter agrees with for strings.
 *
 * Evidence is tested per PARTICIPANT, not per operand: the `_SYS.eq`/`_SYS.neq`
 * runtime dispatch compares a list against a scalar ELEMENT-WISE and two lists
 * with the same tolerance test, so a `list<string>` operand puts strings on the
 * numeric path even though its own type is not a subtype of `string`. That hole
 * let `Equal(["a"], ["a"])` compile to `false` where the interpreter answers
 * `True`.
 */
function assertNoStringOperand(
  kind: string,
  args: ReadonlyArray<Expression>
): void {
  if (args.some(isProvablyStringComparisonParticipant))
    throw new Error(
      `${kind}: cannot compile — string-valued operands are not supported by ` +
        `this target (the lowering is numeric: a tolerance test on the ` +
        `difference, which is NaN for strings). ` +
        `Fail closed (D6) — the interpreter evaluates it.`
    );
}

/**
 * True when the operand's own type PROVES a number — the disqualifier for the
 * scalar string-equality admission below. `unknown` is not proof (nothing is
 * known), and neither is `never`.
 */
function isProvablyNumericOperand(x: Expression): boolean {
  const t = jsType(x);
  return t !== 'never' && isSubtype(t, 'number');
}

/**
 * The ADMISSION side of the string-equality rule (tier 2, 2026-08-08): a BINARY
 * `Equal`/`NotEqual` that lowers to a strict `===` / `!==` instead of declining
 * on `assertNoStringOperand`.
 *
 * Strict equality is the interpreter's own string semantics: `compare.ts`
 * compares two strings with `a.string === b.string`, with NO tolerance. It is
 * the same inner the §3.F Kleene-guarded `string | missing` form already emits
 * (`base-compiler.ts`, shipped 2026-08-08); this generalizes that precedent to
 * the unguarded scalar case.
 *
 * The rule — every clause is load-bearing:
 *
 *  - **at least one participant is provably string**. Nothing without string
 *    evidence changes: a plot equality (`x^2 + y^2 = 4`, `Equal(xq, 4)`) has
 *    none, so it keeps the numeric tolerance codegen BYTE-IDENTICALLY. Every
 *    shape this admits was DECLINING before, so no compiling shape moves.
 *  - **no participant is provably a NUMBER**. Probed, `Equal("a", 1)` is
 *    `False` in the interpreter (equality is total across sorts, unlike the
 *    orderings, which stay inert) and `"a" === 1` agrees — but the mixed
 *    string/number shape is ruled fail-closed for now, as in tier 0.
 *  - **no participant may be a COLLECTION at run time**
 *    (`couldBeCollectionParticipant`, which reads a UNION arm — a subtype test
 *    such as `.matches('collection')` is blind to `string | list<string>`),
 *    and none is an unfaithful aggregate: `Equal(["a","b"], "a")` broadcasts
 *    element-wise in the interpreter, which a scalar `===` cannot express.
 *    Those shapes go to the `_SYS.eq` route instead (see there), or fail
 *    closed when they are not provably flat all-string.
 *  - **BINARY only**. The chained form would need the impure-operand temp
 *    binding the numeric path has, for no known consumer; it stays closed.
 *
 * An `unknown`-typed participant opposite a provable string IS admitted, and
 * that is the deliberate widening over "both provably string": the realistic
 * consumer is a character scanner whose predicate parameter is inferred
 * (`isWs(c) = c == " " || c == "\t"` types `c` as `unknown`). It is faithful
 * for every scalar run-time value — a string compares exactly, and a number,
 * boolean or tuple answers `false`, which is the interpreter's `False`. The one
 * residual is a run-time ARRAY in the `unknown` slot, where the interpreter
 * broadcasts; that is the identical, settled hole the numeric fast path already
 * has for a bare unknown symbol (`Equal(xq, 4)` → `Math.abs(xq - 4) <= tol`),
 * not a new class.
 *
 * ACCEPTED RESIDUAL (flagged for ruling, 2026-08-08): the interpreter
 * NFC-normalizes every string at boxing time (`BoxedString`), so it answers
 * `True` for a decomposed/precomposed pair (`"é"` vs `"é"`), whereas
 * the emitted `===` compares the raw UTF-16 the HOST passed in. String
 * LITERALS are unaffected (they are boxed, hence NFC, before codegen), and
 * `_SYS.chars` normalizes so `Characters(s)[i] == "é"` is faithful too — only a
 * raw non-NFC string handed to a compiled parameter diverges. Closing it would
 * mean a `.normalize()` on both sides of every comparison, in the hottest loop
 * these lowerings exist for. The ORDERINGS shipped with the same residual (raw
 * `<`), as did the §3.F guarded `===`.
 */
function isStringScalarEquality(args: ReadonlyArray<Expression>): boolean {
  if (args.length !== 2) return false;
  if (!args.some(isProvablyStringOperand)) return false;
  if (args.some(isProvablyNumericOperand)) return false;
  if (args.some((a) => unfaithfulComparisonAggregate(a) !== null)) return false;
  return !args.some(
    (a) => couldBeCollectionParticipant(a) || isPossiblyCollectionTypedJS(a)
  );
}

/**
 * The ADMISSION side of the string-COLLECTION equality rule (tier 2,
 * 2026-08-08): a BINARY `Equal`/`NotEqual` whose every participant is a
 * provably FLAT all-string value (`isFlatAllStringComparisonParticipant`) and
 * at least one of which is a collection. It lowers to the `_SYS.eq`/`_SYS.neq`
 * dispatch, whose scalar leaf now compares two strings with `===` (see
 * `eqTensor`) — so both interpreter shapes come out right:
 * `Equal(["a","b"], ["a","b"])` is the whole-collection `True`, and
 * `Equal(["a","b"], "a")` the element-wise `[True, False]` (both probed).
 *
 * This is the JavaScript mirror of the Python target's `_ce_eqcoll` all-string
 * admission, and closes a documented JS/Python divergence. The admission side
 * is deliberately the same NARROW flat predicate Python uses: a MIXED
 * (`list<string | number>`) or NESTED all-string participant fails closed even
 * though the kernel was probed faithful on it, and a numeric participant
 * (`Equal(["a","b"], 1)`) fails closed under the tier-0 mixed ruling.
 */
function isStringCollectionEquality(args: ReadonlyArray<Expression>): boolean {
  return (
    args.length === 2 &&
    args.every(isFlatAllStringComparisonParticipant) &&
    args.some(
      (a) => couldBeCollectionParticipant(a) || isPossiblyCollectionTypedJS(a)
    )
  );
}

/**
 * Fail closed (D6) when a COMPARISON participant is an aggregate whose
 * whole-value comparison neither kernel can reproduce — a `dictionary`, a
 * `record`, or a `tuple` (`unfaithfulComparisonAggregate`).
 *
 * The interpreter compares such an aggregate as ONE value; both compiled
 * kernels see its JavaScript representation as something to look inside:
 *
 *  - `_SYS.eq`/`_SYS.neq` reduce to the numeric tolerance test, which for two
 *    EQUAL `dictionary<integer>` / `record<…>` values is `Math.abs(obj - obj)`
 *    → `NaN <= tol` → `false`, where the interpreter answers `True`;
 *  - a `tuple` lowers to a JS array, so `Equal(Tuple(1, 2), 1)` ran ELEMENT-WISE
 *    to `[true, false]` and `Equal(Tuple(1, 2), List(1, 2))` to `true`, where
 *    the interpreter answers `False` to both (a point binds atomically);
 *  - `IndexOf`'s element test is the same tolerance test, so a tuple needle was
 *    never found — `IndexOf([[1,2],[3,4]], Tuple(3,4))` ran to `0` against the
 *    interpreter's `2`.
 *
 * These shapes were declining ALREADY, but for the wrong reason: the
 * string-evidence walk read the synthesized `tuple<string, V>` dictionary/record
 * entry — the always-string KEY — as string evidence, so `Equal(d1, d2)` over
 * `dictionary<integer>` reported "string-valued operands" with no string in
 * sight. With that key no longer counted, this gate is what keeps them closed,
 * and it says why.
 *
 * The ORDERINGS reach it too (via `compileJSCollectionBoolean`), where it
 * precedes the broader "no element-wise runtime dispatch" refusal that had been
 * catching the same shapes.
 *
 * ONE carve-out, applied by the caller and not here: a BINARY `Equal`/`NotEqual`
 * whose EVERY participant is provably tuple-typed with provably NUMERIC
 * components skips this gate — see `compileJSEquality`,
 * `isProvablyTupleParticipant` and `isNumericTupleParticipant`. The orderings and
 * `IndexOf` never take it.
 */
function assertComparableAggregate(
  kind: string,
  args: ReadonlyArray<Expression>
): void {
  for (const a of args) {
    const aggregate = unfaithfulComparisonAggregate(a);
    if (aggregate === null) continue;
    throw new Error(
      `${kind}: cannot compile — a ${aggregate} participant. The interpreter ` +
        `compares it as ONE value, whereas the compiled kernels look inside ` +
        `its JavaScript representation: the numeric tolerance test answers ` +
        `\`false\` for two EQUAL dictionaries or records (\`Math.abs(obj - ` +
        `obj)\` is NaN), and a tuple's JS array is mapped over element-wise ` +
        `(\`Equal(Tuple(1, 2), 1)\` → \`[true, false]\`) where a point binds ` +
        `atomically. Fail closed (D6) — the interpreter evaluates it.`
    );
  }
}

/**
 * True when an ORDERING (`Less`/`LessEqual`/`Greater`/`GreaterEqual`) over these
 * operands must fail closed: at least one operand is provably string, but NOT
 * every operand is.
 *
 * All-string is SOUND and keeps compiling. The interpreter compares two strings
 * with the same raw JavaScript `<` this target emits (`compare.ts`:
 * `a.string < b.string ? '<' : '>'`), so `"Z" < "a"`, `"10" < "9"`,
 * `"ä" < "b"` and `"abc" < "abd"` all agree — verified against interpretation,
 * and pinned in `compile-string-fail-closed.test.ts`.
 *
 * The MIXED pair is the silently-wrong one: the interpreter leaves
 * `Less("a", 1)` SYMBOLIC (inert), whereas `"a" < 1` is a plausible-looking
 * `false`. An operand of unknown type alongside a string counts as
 * POSSIBLY-mixed and declines too — it is not provable string evidence, so it
 * could be the number that makes the pair mixed at run time.
 *
 * Chained (n-ary) orderings follow the same rule: `every`/`some` range over all
 * the operands, so an all-string chain compiles and any other declines.
 *
 * Evidence is tested per PARTICIPANT, like `assertNoStringOperand`: this handler
 * broadcasts a collection operand element-wise (`_SYS.bcast`), so a
 * `list<string>` / `broadcastable<string>` operand puts strings on the emitted
 * `<` even though its own type is not a subtype of `string` — the hole that let
 * `Less(1, L)` (`L: broadcastable<string>`) compile to `[false, false]` where
 * the interpreter leaves both comparisons inert. The ADMISSION side stays the
 * narrower flat test, so only the verified all-string shapes keep compiling.
 */
function isMixedStringOrdering(args: ReadonlyArray<Expression>): boolean {
  return (
    args.some(isProvablyStringComparisonParticipant) &&
    !args.every(isFlatAllStringComparisonParticipant)
  );
}

/** Fail closed (D6) on a mixed / possibly-mixed string ordering. */
function assertNoMixedStringOrdering(
  kind: string,
  args: ReadonlyArray<Expression>
): void {
  if (isMixedStringOrdering(args))
    throw new Error(
      `${kind}: cannot compile — an ordering that mixes a string operand with ` +
        `an operand that is not provably a string. The interpreter leaves such ` +
        `a comparison symbolic (\`Less("a", 1)\` stays inert), whereas the ` +
        `emitted JavaScript \`<\` coerces and answers a plausible-looking ` +
        `\`false\`. An ordering whose operands are ALL provably strings does ` +
        `compile — the interpreter compares strings with the same \`<\`. ` +
        `Fail closed (D6) — the interpreter evaluates it.`
    );
}

/**
 * Emit a JavaScript equality test with the engine's numeric tolerance baked in
 * at compile time. The interpreter treats two numbers as equal when
 * `|a − b| <= engine.tolerance` (default 1e-10) — so `0.1 + 0.2 === 0.3` is
 * *true* — whereas a raw `===` is exact and would disagree. `kind` selects
 * Equal (`<=`) vs NotEqual (`>`). Complex operands compare on the modulus of
 * the difference (`_SYS.cabs`). Chained (N-ary) forms conjoin pairwise with
 * `&&`.
 */
function compileJSEquality(
  kind: 'Equal' | 'NotEqual',
  args: ReadonlyArray<Expression>,
  compile: (e: Expression) => string,
  target: CompileTarget<Expression>
): string {
  if (args.length < 2)
    throw new Error(`${kind}: expected at least two arguments`);
  // Ahead of BOTH lowerings below: the `_SYS.eq`/`_SYS.neq` runtime dispatch
  // compares scalars tolerantly too, so a string operand is as wrong there as
  // on the scalar tolerance path.
  //
  // The one carve-out in the aggregate gate (maintainer-ruled): a BINARY
  // equality whose EVERY participant is provably tuple-typed
  // (`isProvablyTupleParticipant`) with provably NUMERIC components
  // (`isNumericTupleParticipant`) keeps the `_SYS.eq`/`_SYS.neq` lowering it
  // had before the gate existed. Its array-vs-array branch is whole-value
  // equality, which is exactly the interpreter's atomic point comparison — at
  // equal arity and at unequal arity (a length mismatch is `false`, and so is
  // the interpreter's answer). Only the MIXED shapes were wrong, and those
  // still decline: one non-tuple participant and `every` fails. The CHAINED
  // (n-ary) form is excluded — it keeps failing closed here, as it does below.
  //
  // The numeric-component requirement mirrors the Python target's and closes
  // that helper's numeric element leaf: its tolerance test coerces a boolean
  // (`Math.abs(true - 1)` is 0), so `Equal(Tuple(True, 2), Tuple(1, 2))` ran to
  // `true` and `NotEqual` of the same to `false`, against the interpreter's
  // `False`/`True`. A boolean, `unknown` or otherwise non-numeric component now
  // declines and the interpreter answers.
  //
  // Gate ORDER is load-bearing: `assertNoStringOperand` runs unconditionally
  // AFTER this, so a NON-tuple participant with string evidence still declines
  // on it. A tuple with a string component
  // (`Equal(Tuple(1, "a"), Tuple(1, "a"))`) is now caught one step earlier, by
  // the numeric-component requirement — the tolerance test is NaN on that
  // component, so `_SYS.eq` would answer `false` where the interpreter answers
  // `True` either way.
  const tupleEquality =
    args.length === 2 &&
    args.every(isProvablyTupleParticipant) &&
    args.every(isNumericTupleParticipant);
  if (!tupleEquality) assertComparableAggregate(kind, args);
  // The two string carve-outs (tier 2, 2026-08-08) — see
  // `isStringScalarEquality` and `isStringCollectionEquality` for the rules and
  // the probe evidence. Everything else with string evidence still declines.
  const stringScalar = isStringScalarEquality(args);
  const stringCollection = !stringScalar && isStringCollectionEquality(args);
  if (!stringScalar && !stringCollection) assertNoStringOperand(kind, args);
  if (stringScalar) {
    // Strict, NOT the tolerance test: the interpreter compares strings exactly.
    const op = kind === 'Equal' ? '===' : '!==';
    return `((${compile(args[0])}) ${op} (${compile(args[1])}))`;
  }
  // Equality over a (possibly-)collection operand: a raw `Math.abs(a - b)`
  // over a list silently coerces (`[1,2,3] - 2` → NaN), so the scalar codegen
  // below would return a wrong boolean behind a `success: true`. The BINARY
  // form lowers to the interpreter-faithful runtime dispatch `_SYS.eq`/
  // `_SYS.neq` instead (Tycho item 41, the item-34 treatment): scalar
  // operands compare tolerantly, an array-vs-scalar pair is element-wise, an
  // array-vs-array pair is whole-collection equality — see `eqTensor`. The
  // gate uses the declared type (not `.isCollection`, which is false for a
  // `list<finite_number>` such as `Power(L, 2)`), plus
  // `isPossiblyCollectionTypedJS` (a `broadcastable<T>` node or a top-typed
  // application such as `h(x)` — `broadcastable<T>` is NOT a subtype of
  // `collection`, so it needs its own test). A bare unknown SYMBOL is
  // excluded by the predicate, so plot equalities (`x^2 + y^2 = 4`) stay on
  // the scalar fast path below.
  //
  // The CHAINED (n-ary) form keeps failing closed (D6), and was NOT relaxed
  // with the orderings and connectives (2026-07-27, Tycho item 86). It is not
  // a pairwise conjunction the way `a < b < c` is: the interpreter's n-ary
  // `Equal` switches SHAPE on how many operands are collections at run time —
  // `Equal([1,2,3], 3, 3)` is element-wise `[False,False,True]`, while
  // `Equal([1,2,3], [1,2,3], 3)` is the SCALAR `False` (whole-collection
  // equality wins, and it does not broadcast the way `And(False, <list>)`
  // would, which answers `[False,False,False]`). Reproducing that means
  // reimplementing the n-ary dispatch in `_SYS`, not conjoining `_SYS.eq`
  // calls — and a conjunction of them is demonstrably a different value. No
  // faithful runtime dispatch, so no relaxation.
  const tol = args[0]?.engine?.tolerance ?? 1e-10;
  const collectionish = (a: Expression): boolean =>
    a.type.matches('collection') || isPossiblyCollectionTypedJS(a);
  if (args.some(collectionish)) {
    if (args.length === 2) {
      const helper = kind === 'Equal' ? 'eq' : 'neq';
      return `_SYS.${helper}((${compile(args[0])}), (${compile(args[1])}), ${tol})`;
    }
    throw new Error(
      `${kind}: cannot compile — chained (n-ary) comparison over an operand ` +
        `that may be a collection at run time (collection-valued or ` +
        `possibly-collection-typed). Materialize the collection first. ` +
        `Fail closed (D6).`
    );
  }
  const cmp = kind === 'Equal' ? '<=' : '>';
  // An IMPURE operand (the Random family) must be evaluated exactly once — the
  // interpreter evaluates each operand once. Two positions splice an operand
  // MORE than once: a COMPLEX operand is spliced twice by `part()` (once for
  // `.re`, once for `.im`), and a MIDDLE operand of a chained (n-ary) form
  // appears in the two comparisons that straddle it. So `Equal(Random()·i, …)`
  // and `Equal(0.1, Random(), 0.9)` each consumed TWO draws. When any operand
  // is spliced more than once, bind EVERY impure operand — in argument order,
  // so the draw order matches the interpreter's — to an IIFE const, and splice
  // the const instead. Pure operands keep the direct emission byte-identical.
  const multiSpliced = (i: number): boolean =>
    (i >= 1 && i <= args.length - 2) || BaseCompiler.isComplexValued(args[i]);
  const bind = args.some((a, i) => a.isPure === false && multiSpliced(i));
  const bindings: string[] = [];
  const codes = args.map((a, _i) => {
    if (!bind || a.isPure !== false) return undefined;
    const t = BaseCompiler.tempVar(target);
    bindings.push(`${t} = ${compile(a)}`);
    return t;
  });
  const code = (i: number): string => codes[i] ?? compile(args[i]);
  const distance = (i: number, j: number): string => {
    const a = args[i];
    const b = args[j];
    const anyComplex =
      BaseCompiler.isComplexValued(a) || BaseCompiler.isComplexValued(b);
    if (!anyComplex) return `Math.abs((${code(i)}) - (${code(j)}))`;
    // Promote each operand to `{ re, im }` and take the modulus of the
    // difference. A real operand contributes `re = code`, `im = 0`.
    const part = (e: Expression, c: string): { re: string; im: string } =>
      BaseCompiler.isComplexValued(e)
        ? { re: `(${c}).re`, im: `(${c}).im` }
        : { re: `(${c})`, im: '0' };
    const pa = part(a, code(i));
    const pb = part(b, code(j));
    return `_SYS.cabs({ re: ${pa.re} - ${pb.re}, im: ${pa.im} - ${pb.im} })`;
  };
  const pair = (i: number, j: number): string =>
    `(${distance(i, j)} ${cmp} ${tol})`;
  let body: string;
  if (args.length === 2) body = pair(0, 1);
  else {
    const parts: string[] = [];
    for (let i = 0; i < args.length - 1; i++) parts.push(pair(i, i + 1));
    body = `(${parts.join(' && ')})`;
  }
  if (bindings.length === 0) return body;
  return `(() => { const ${bindings.join(', ')}; return ${body}; })()`;
}

/** JavaScript infix spelling of each ordering relation. */
const JS_ORDERING_OPERATORS = {
  Less: '<',
  LessEqual: '<=',
  Greater: '>',
  GreaterEqual: '>=',
} as const;

/**
 * Codegen for the ordering relations and logical connectives when an operand
 * may be a COLLECTION at run time.
 *
 * The raw infix path in `BaseCompiler` is silently wrong on an array. JS
 * stringifies it for a comparison — `0 < [1, 0, 1]` compares against
 * `"1,0,1"` and yields the scalar `false` — and an array is TRUTHY, so
 * `m1 && m2` returns a whole operand and `!m` returns `false`. The
 * interpreter broadcasts element-wise in all of these, so each was a wrong
 * answer behind a `success: true`. The base compiler therefore declines the
 * infix path for these heads when an operand is collection-TYPED
 * (`.isCollection` is false for a computed `list<real>` such as `|L - k|`,
 * which is why this went unnoticed) and dispatches here.
 *
 * This used to fail closed (D6) for every such operand. It now emits the
 * RUNTIME dispatch `_SYS.bcast` over the head's scalar closure instead
 * (relaxed 2026-07-27, Tycho item 86): `bcast` applies the closure directly
 * when no argument turns out to be an array, recurses per POSITION otherwise
 * (so an empty or mismatched position never poisons a sibling), and projects a
 * length mismatch to NaN — the same substrate `tryCompileBroadcast` uses for
 * the provable-array case, which is what makes the two lowerings agree. The
 * connectives additionally get `guardConnectiveAbsence`, since `!`/`&&`/`||`
 * coerce an absent (NaN) position to a plain — and wrong — truth value.
 *
 * Three shapes keep failing closed, each because no faithful runtime dispatch
 * exists (admission is the dangerous direction):
 *  - a TUPLE operand: a point is atomic, and the interpreter leaves
 *    `Less(Tuple(1,2), 3)` inert; `bcast` would map over its components;
 *  - a non-INDEXED collection (`Set`, dictionary, string): it has no
 *    positional JS-array lowering, so `bcast` would silently treat it as a
 *    scalar;
 *  - chained `Equal`/`NotEqual`, which never reach here (see
 *    `compileJSEquality`).
 */
function compileJSCollectionBoolean(
  kind: string,
  args: ReadonlyArray<Expression>,
  compile: OperandCompiler<Expression>,
  target: CompileTarget<Expression>
): string {
  // Operand indices are threaded through every position (`OperandCompiler`):
  // `And`/`Or` operands after the first, and the comparisons of a chained
  // relation, are the shared inventory's conditionally-evaluated positions, so
  // the CSE pass must push the region harvest opened for them. A position that
  // opened no region compiles exactly as before.
  //
  // A MIXED / possibly-mixed string ordering is diverted here from the infix
  // path in `BaseCompiler` expressly to fail closed (D6); an ALL-string ordering
  // never reaches here (it keeps the raw infix lowering, which the interpreter
  // agrees with). Reachable independently when a string operand sits alongside a
  // collection one — `Less("a", [1, 2])` — which the interpreter answers with a
  // list of INERT comparisons, not the `[false, false]` a broadcast would give.
  // The connectives are not gated: they consume booleans, not strings.
  if (kind in JS_ORDERING_OPERATORS) {
    // The aggregate gate first: it names the real reason (a dictionary/record/
    // tuple participant), where the broad refusal at the bottom of this
    // function would otherwise catch the same shapes under "no element-wise
    // runtime dispatch".
    assertComparableAggregate(kind, args);
    assertNoMixedStringOrdering(kind, args);
  }
  // SCALAR operands still lower normally. This handler is also reached from
  // INSIDE the `_SYS.bcast` closure that `BaseCompiler.tryCompileBroadcast`
  // emits for a provable array operand (`Not([True, False])` becomes
  // `_SYS.bcast((_1) => !(_1), [true, false])`), where each element is a
  // scalar — the broadcast lowering below must not fire there.
  const collectionish = (a: Expression): boolean =>
    a.isCollection ||
    a.type.matches('collection') ||
    isPossiblyCollectionTypedJS(a);
  if (!args.some(collectionish)) {
    if (kind === 'Not') {
      if (args.length !== 1)
        throw new Error(`Not: expected exactly one argument`);
      return `!(${compile(args[0], 0)})`;
    }
    if (kind === 'And' || kind === 'Or') {
      const op = kind === 'And' ? '&&' : '||';
      return `(${args.map((a, i) => `(${compile(a, i)})`).join(` ${op} `)})`;
    }
    if (args.length === 2) {
      const op =
        JS_ORDERING_OPERATORS[kind as keyof typeof JS_ORDERING_OPERATORS];
      return `((${compile(args[0], 0)}) ${op} (${compile(args[1], 1)}))`;
    }
    // A chained scalar comparison reaches the infix path in `BaseCompiler`,
    // which binds the shared middle operands to temporaries; there is nothing
    // to reproduce that here, and it cannot occur without a collection operand
    // having diverted us in the first place.
  } else if (args.every(admitsRuntimeBroadcast)) {
    // Bind one element parameter per operand and build the scalar body from
    // them. A chained ordering becomes ONE closure over all the operands
    // (`(a < b) && (b < c)`), which also evaluates each operand exactly once —
    // the `bindExpr` temporaries the scalar chained path needs are unnecessary
    // here, since every operand is already an argument of the call.
    const params = args.map(() => BaseCompiler.tempVar(target));
    const body = BaseCompiler.guardConnectiveAbsence(
      kind,
      params,
      compileScalarBooleanBody(kind, params)
    );
    const operands = args.map((a, i) => `(${compile(a, i)})`).join(', ');
    return `_SYS.bcast((${params.join(', ')}) => ${body}, ${operands})`;
  }
  throw new Error(
    `${kind}: cannot compile a comparison or logical connective over an ` +
      `operand that may be a collection at run time — the JavaScript ` +
      `operators do not broadcast element-wise (an array stringifies in a ` +
      `comparison and is truthy in a connective), and this operand has no ` +
      `element-wise runtime dispatch (a tuple binds atomically; a set, ` +
      `dictionary or string has no positional lowering), so the result would ` +
      `silently disagree with interpretation. Fail closed (D6). Materialize ` +
      `the collection with evaluate() and compile a scalar element function ` +
      `instead.`
  );
}

/**
 * Codegen for `Which`/`If` (clauses in `Which` shape) when a CONDITION may be
 * an indexed collection at run time: the element-wise selection lowering
 * (`_SYS.select`, R1–R4 of
 * `docs/plans/2026-07-27-elementwise-which-design.md`).
 *
 * Each clause is emitted as a THUNK so the runtime helper owns evaluation
 * order: conditions in clause order, an arm only if selection reaches it, and
 * then exactly once (R2). The helper also handles the case where every
 * condition turns out SCALAR at run time — it returns the selected arm whole —
 * so routing a merely-possibly-collection condition here is value-safe.
 *
 * Returns `null` when every condition is provably scalar: the base compiler
 * then emits its ternary chain, unchanged.
 *
 * Declines (fail closed, D6) when a value arm is complex-valued: the compiled
 * complex convention is a `{ re, im }` object, and a selection array mixing
 * those with real cells has no settled rendering. Scalar complex
 * `Which`/`If` is untouched — it never reaches here.
 */
function compileJSSelection(
  args: ReadonlyArray<Expression>,
  compile: OperandCompiler<Expression>
): string | null {
  const conds = args.filter((_x, i) => i % 2 === 0);
  const collectionish = (a: Expression): boolean =>
    a.isCollection ||
    a.type.matches('collection') ||
    isPossiblyCollectionTypedJS(a);
  if (!conds.some(collectionish)) return null;
  const arms = args.filter((_x, i) => i % 2 === 1);
  if (arms.some((a) => BaseCompiler.isComplexValued(a)))
    throw new Error(
      `Which: cannot compile an element-wise selection with a complex-valued ` +
        `branch — a compiled complex value is a \`{ re, im }\` object, which ` +
        `has no cell convention inside a selection array. Fail closed (D6).`
    );
  // Every clause is a thunk the runtime helper owns the evaluation of, so each
  // position after the first condition is a conditionally-evaluated operand:
  // pass its index, and the CSE pass pushes the matching region instance
  // (`OperandCompiler`, design §5.1).
  return `_SYS.select(${args
    .map((x, i) => `() => (${compile(x, i)})`)
    .join(', ')})`;
}

/**
 * True when an operand of an ordering/connective can be handed to `_SYS.bcast`
 * — a scalar, an INDEXED collection (which lowers to a JS array), or an operand
 * whose collection-ness is unprovable (`bcast` dispatches on the runtime
 * shape). A tuple (atomic point) and a non-indexed collection (`Set`,
 * dictionary, string) are excluded: see `compileJSCollectionBoolean`.
 */
function admitsRuntimeBroadcast(a: Expression): boolean {
  const t = jsType(a);
  if ((typeof t !== 'string' && t.kind === 'tuple') || isFunction(a, 'Tuple'))
    return false;
  if (!a.isCollection && !a.type.matches('collection')) return true;
  return isIndexedCollectionOperand(a);
}

/** The scalar body of an ordering/connective over bare element parameters. */
function compileScalarBooleanBody(
  kind: string,
  params: ReadonlyArray<string>
): string {
  if (kind === 'Not') {
    if (params.length !== 1) throw new Error(`Not: expected one argument`);
    return `!(${params[0]})`;
  }
  if (kind === 'And' || kind === 'Or')
    return `(${params.join(kind === 'And' ? ' && ' : ' || ')})`;
  const op = JS_ORDERING_OPERATORS[kind as keyof typeof JS_ORDERING_OPERATORS];
  if (op === undefined || params.length < 2)
    throw new Error(`${kind}: expected at least two arguments`);
  const pairs: string[] = [];
  for (let i = 0; i < params.length - 1; i++)
    pairs.push(`(${params[i]} ${op} ${params[i + 1]})`);
  return pairs.length === 1 ? pairs[0] : `(${pairs.join(' && ')})`;
}

/**
 * True when `e` compiles to a JavaScript array that supports index access and
 * `.length` — an indexed collection (list / vector / range) or a `list`-typed
 * expression (e.g. `Power(L, 2)`, which types as `list<finite_number>` but is
 * not reported by `.isCollection`). Dictionaries and strings are excluded: they
 * are collections but do not lower to a JS array with count/positional access.
 *
 * Uses the declared type rather than `isFiniteIndexedCollection` from
 * `collection-utils`: importing that module here reorders module init and
 * breaks a runtime binding in the arithmetic broadcast path.
 */
function isIndexedCollectionOperand(e: Expression): boolean {
  const t = e.type;
  return t.matches('list') || t.matches('indexed_collection');
}

/**
 * True when `e`'s static type ADMITS an indexed collection without proving one
 * — a union with an indexed-collection arm. The witness is a lambda parameter
 * indexed in its body: `At` narrows it to `indexed_collection | dictionary`,
 * which matches neither `list` nor `indexed_collection`, so
 * `isIndexedCollectionOperand` (the "provably" test) refuses it and every
 * `v[1]`-shaped user function failed to compile.
 *
 * Admitting it is the runtime-projection rule (see the index note on the `At`
 * handler): declared types here are routinely wider than the runtime value, and
 * `_SYS.at` already dispatches on the RUNTIME shape and yields `NaN` for a
 * non-collection base — exactly what the interpreter's `Nothing` projects to.
 * A top type (`unknown`/`any`/`value`) is deliberately NOT admitted: that is
 * "nothing is known", not "a collection is possible" (a free plot variable
 * types `unknown` until inference refines it scalar), and it is what
 * `isPossiblyCollectionTypedJS` governs.
 */
function couldBeIndexedCollectionOperand(e: Expression): boolean {
  const t = jsType(e);
  if (t === 'unknown' || t === 'any' || t === 'value') return false;
  if (typeof t === 'object' && t.kind === 'union')
    return t.types.some((m) => isSubtype(m, 'indexed_collection'));
  return isSubtype(t, 'indexed_collection');
}

/**
 * True when `e`'s static type PROVES a numeric index — the only index shape a
 * base admitted by `couldBeIndexedCollectionOperand` may carry. Such a base can
 * be a DICTIONARY at run time (the union arm the "could be" test tolerates),
 * and the interpreter's `At` answers a keyed lookup there, while `_SYS.at`
 * dispatches on the runtime shape and answers `NaN` for every non-array base.
 * A keyed access would therefore compile to a silent `NaN` behind
 * `success: true`, so it fails closed (D6) instead. A base that is PROVABLY an
 * indexed collection is not subject to this test: no dictionary reaches it, and
 * its index gate stays the interpreter-matching runtime one.
 */
function isNumericIndexOperand(e: Expression): boolean {
  return isSubtype(jsType(e), 'number');
}

/**
 * Inline of `isPossiblyCollectionTyped` (collection-utils): an operand whose
 * collection-ness is not statically visible and so may be a JS array at run
 * time — a `broadcastable<T>` node, or a top-typed application
 * (`unknown`/`any`/`value` call such as `h(x)`). A bare unknown SYMBOL is
 * deliberately excluded (a free plot variable types `unknown` only until
 * inference refines it scalar). Inlined rather than imported: importing
 * `collection-utils` here reorders module init and breaks a runtime binding in
 * the arithmetic broadcast path (see `isIndexedCollectionOperand`).
 */
function isPossiblyCollectionTypedJS(e: Expression): boolean {
  const t = jsType(e);
  // A top-typed APPLICATION is a genuine possibly-collection signal only when
  // bound: an UNBOUND (non-canonical, non-structural) arithmetic subexpression
  // (e.g. the `{ canonical: false }` grouping-preservation path) types
  // `unknown` merely because binding was skipped, not because its
  // collection-ness is unknown — so it must not fail closed here. A
  // `broadcastable<T>` operand is an explicit declared type, reliable on any
  // node.
  if (t === 'unknown' || t === 'any' || t === 'value') {
    if (!isFunction(e) || (!e.isCanonical && !e.isStructural)) return false;
    // Item-86 look-through (Tycho): an application of a USER function whose
    // body is provably scalar under scalar arguments is NOT
    // possibly-collection, even when its declared return type is open
    // (`(unknown) -> unknown`, the shape consumers use so list-broadcasting
    // keeps working). `q(x) < y` with `q(t) = n·t+1` compiles; `q(L) < y`
    // with a collection-ish `L` still fails closed at the argument check.
    return !isProvablyScalarApplication(
      e,
      new Set(),
      (a) => !a.type.matches('collection') && !isPossiblyCollectionTypedJS(a)
    );
  }
  if (typeof t !== 'string' && t.kind === 'broadcastable') {
    // A `broadcastable<T>`-typed APPLICATION means "T, or a list-nesting of
    // T, depending on the operand shapes." When every operand is provably
    // NOT collection-ish (recursively, so the item-86 look-through applies
    // to an operand like `q(x)`), the lift cannot fire at run time and the
    // result is the plain scalar `T` — e.g. `q(x) < y` types
    // `broadcastable<boolean>` only because `q`'s return is open, yet with
    // scalar operands it is a scalar boolean. A broadcastable-typed
    // non-application (a declared symbol) keeps the conservative answer.
    if (isFunction(e) && (e.ops ?? []).length > 0) {
      // "The lift cannot fire, so the result is the plain scalar `T`" holds
      // only when the operator's own BASE result is scalar. For a builtin
      // broadcastable operator that is true by definition of the lift. For a
      // USER function it is not: the `broadcastable<T>` wrapper carries the
      // DECLARED result, and under the open `(unknown) -> unknown` head the
      // consumers use, `T` is `unknown` no matter what the body returns —
      // `a(t) = [cos t, sin t]` applied to a SCALAR is still a list. So a
      // user-function application takes the item-86 look-through instead,
      // which reads the body and declines on a collection constructor
      // (Tycho item 171: `Σ_i a(h(i))` reached the scalar accumulation arm
      // and `+`-concatenated the arrays into a string, where the
      // type-`unknown` spellings `Σ_i a(i)` / `Σ_i a(t+i)` took the
      // element-wise `_SYS.bcast` fold).
      if (userFunctionLiteral(e) !== undefined)
        return !isProvablyScalarApplication(
          e,
          new Set(),
          (a) =>
            !a.type.matches('collection') && !isPossiblyCollectionTypedJS(a)
        );
      return (e.ops ?? []).some(
        (a) => a.type.matches('collection') || isPossiblyCollectionTypedJS(a)
      );
    }
    return true;
  }
  return false;
}

/**
 * The `Function`-literal value of `e`'s operator when `e` is an application of
 * a USER-defined function (a symbol whose value is a `Function` literal), and
 * `undefined` otherwise — builtin operators have their own compile handlers and
 * no body to look through.
 */
function userFunctionLiteral(
  e: Expression
): (Expression & FunctionInterface) | undefined {
  if (!isFunction(e)) return undefined;
  const op = e.operator;
  if (typeof op !== 'string') return undefined;
  const value = e.engine.box(op).value;
  return isFunction(value, 'Function') ? value : undefined;
}

/**
 * Item-86 look-through: is `e` an application of a user function whose result
 * is provably scalar — every actual argument accepted by `argIsScalar`, and
 * the function's body mapping scalar parameters to a scalar result?
 *
 * The body analysis is a conservative WHITELIST: its only permitted failure
 * mode is *declining* (the caller then keeps the fail-closed path), never
 * unsound admission — the inverse discipline of the usual "static gates
 * over-fire" rule, because here admission is the dangerous direction.
 *
 * - the actual arguments are judged by the caller-supplied `argIsScalar` (at
 *   the top level: the gate's own convention, where a bare unknown symbol is
 *   a plot variable and scalar; inside a body: the enclosing analysis);
 * - a parameter is scalar by assumption;
 * - a captured (non-parameter) symbol must have a provably-scalar declared
 *   type (`number`/`boolean`/`string`) — unlike a plot variable, a captured
 *   document symbol is routinely assigned a list later, so `unknown` is not
 *   trusted here;
 * - an application must be of a `broadcastable` operator (whose base
 *   signature is scalar → scalar by definition of the lift) over
 *   scalar-if-scalar operands, or of another user function passing this same
 *   analysis — self/mutual recursion declines via `visited`;
 * - everything else declines: `List`/`Range`/collection constructors (not
 *   broadcastable), multi-statement `Block` bodies, arity mismatches,
 *   non-symbol parameters.
 */
function isProvablyScalarApplication(
  e: Expression,
  visited: Set<string>,
  argIsScalar: (a: Expression) => boolean
): boolean {
  if (!isFunction(e)) return false;
  const op = e.operator;
  if (visited.has(op)) return false;
  // Only a USER function — a symbol whose value is a `Function` literal — is
  // looked through; built-in operators have their own compile handlers.
  const fnVal = userFunctionLiteral(e);
  if (fnVal === undefined) return false;
  const fnOps = fnVal.ops;
  const params = fnOps
    .slice(1)
    .map((p: Expression) => functionLiteralParameterName(p));
  const args = e.ops;
  if (params.length !== args.length) return false;
  if (params.some((p: string) => !p)) return false;
  if (!args.every(argIsScalar)) return false;
  const nextVisited = new Set(visited);
  nextVisited.add(op);
  // Canonical parse wraps a lambda body in `Block`; unwrap only the
  // single-statement form (a multi-statement body declines below — `Block`
  // is not a broadcastable operator).
  let body: Expression | undefined = fnOps[0];
  if (body === undefined) return false;
  while (isFunction(body, 'Block') && body.nops === 1) body = body.ops[0];
  return scalarIfScalarBody(body, new Set(params), nextVisited);
}

/** See `isProvablyScalarApplication` — the body half of the whitelist. */
function scalarIfScalarBody(
  x: Expression,
  params: Set<string>,
  visited: Set<string>
): boolean {
  if (isNumber(x) || isString(x)) return true;
  if (isSymbol(x)) {
    if (params.has(x.symbol)) return true;
    const t = x.type;
    return t.matches('number') || t.matches('boolean') || t.matches('string');
  }
  if (!isFunction(x)) return false;
  const op = x.operator;
  if (typeof op === 'string') {
    const def = x.engine.lookupDefinition(op);
    if (def && (def as any).operator?.broadcastable === true)
      return (x.ops ?? []).every((o) => scalarIfScalarBody(o, params, visited));
  }
  // A nested user-function application: same look-through, with its
  // arguments judged under THIS body's scalar assumptions.
  return isProvablyScalarApplication(x, visited, (a) =>
    scalarIfScalarBody(a, params, visited)
  );
}

/**
 * Compile a point-coordinate accessor (`.x`/`.y`/`.z` → PointX/PointY/PointZ),
 * `idx` is the 0-based coordinate. On a single point (a tuple, compiled to a JS
 * array) it indexes the coordinate; on a list of points it broadcasts, mapping
 * the coordinate over the array — matching the interpreter's `pointComponentAt`
 * and Desmos semantics. The tuple case is checked first because a tuple type
 * also matches `indexed_collection`.
 *
 * An out-of-range coordinate (`PointZ` over 2-arity points) answers `NaN`, not
 * `undefined`: the interpreter answers the `NaN` absence marker there (verified
 * for both the single-point and list-of-points routes), and `undefined` would
 * leak a JS-ism into the compiled ABI. That marker is NUMERIC, though, so it is
 * only emitted when the accessed coordinate could hold a number — see
 * `pointComponentAbsence`.
 */
function compilePointComponent(
  arg: Expression,
  idx: number,
  compile: (e: Expression) => string
): string {
  const compiled = compile(arg);
  const t = jsType(arg);
  // A single point (tuple): index the coordinate directly.
  if (typeof t !== 'string' && t.kind === 'tuple')
    return `(${compiled}[${idx}]${pointComponentAbsence(tupleElementType(t, idx))})`;
  // A list of points broadcasts the coordinate — but only when the operand is
  // confirmably a list of points, matching the interpreter's `pointComponentAt`
  // (which inspects concrete elements rather than trusting the declared element
  // type). Any other collection is element-indexing, like First/Second/Third,
  // which is the same `[idx]` access as the single-point case.
  const eltType = collectionElementType(t);
  if (isPointListOperand(arg) || isCoordinateRowListOperand(arg)) {
    const coord =
      eltType !== undefined && typeof eltType !== 'string'
        ? tupleElementType(eltType, idx)
        : undefined;
    return `(${compiled}).map((_pt) => _pt[${idx}]${pointComponentAbsence(coord)})`;
  }
  return `(${compiled}[${idx}]${pointComponentAbsence(eltType)})`;
}

/** The type of a tuple's `idx`-th element, or `undefined` when `t` is not a
 *  parameterized tuple or the index is out of range. */
function tupleElementType(t: Type, idx: number): Type | undefined {
  if (typeof t === 'string' || t.kind !== 'tuple') return undefined;
  return t.elements[idx]?.type;
}

/**
 * The absence suffix for a coordinate access, by the coordinate's DOMAIN.
 *
 * `NaN` is the ABI's absence marker (matching the interpreter's
 * `pointComponentAt`), but it is a *numeric* value: on an object-domain
 * coordinate — a `tuple<string, string>` point — `NaN` would be the leak the
 * marker exists to prevent, and the ABI's absence value there is `undefined`,
 * i.e. the bare access. So the coalesce is emitted unless the coordinate type
 * is statically known AND provably non-numeric; an unknown or indeterminate
 * coordinate type keeps `?? NaN`.
 */
function pointComponentAbsence(coord: Type | undefined): string {
  if (coord !== undefined && !couldMatch(coord, 'number')) return '';
  return ' ?? NaN';
}

/**
 * True when `e` is (confirmably) a list of points, so a coordinate accessor
 * broadcasts. Mirrors the interpreter's `pointComponentAt` decision in
 * `collections.ts`: a symbolic operand whose declared element type is a tuple,
 * or a literal collection whose first element is a point. Kept as a local
 * predicate (rather than importing from `collections.ts`) to avoid the
 * module-init reordering hazard noted on `isIndexedCollectionOperand`.
 */
function isPointListOperand(e: Expression): boolean {
  const elt = collectionElementType(jsType(e));
  // `'tuple'` (the bare, unparameterized type name) is a plain string, not a
  // `{ kind: 'tuple' }` node — and it is exactly what the `PointList` type
  // handler answers (`list<tuple>`), so both spellings must read as a point.
  if (
    elt !== undefined &&
    (elt === 'tuple' || (typeof elt !== 'string' && elt.kind === 'tuple'))
  )
    return true;
  if (e.isFiniteCollection) {
    const first = e.at(1);
    if (first === undefined) return false;
    const ft = jsType(first);
    return (
      (typeof ft !== 'string' && ft.kind === 'tuple') ||
      first.operator === 'Tuple'
    );
  }
  return false;
}

/**
 * True when `e` is a list of coordinate ROWS — the list-of-lists spelling of a
 * point list (`[[0,0],[3,4]]`, what a data import produces). Mirrors the row
 * arm of the interpreter's `isPointLike`, and is admitted ONLY by the
 * point-ONLY accessors (`PointX`/`PointY`/`PointZ`), which have no competing
 * matrix meaning: `Norm`/`Abs` keep reading the same value as a matrix.
 */
function isCoordinateRowListOperand(e: Expression): boolean {
  const t = jsType(e);
  // A rank ≥ 2 numeric tensor (`matrix<number^(3x2)>`) is a list of rows: its
  // `elements` is the SCALAR type, so the dimensions carry the shape.
  if (typeof t !== 'string' && t.kind === 'list') {
    if ((t.dimensions?.length ?? 0) > 1) return true;
    const elt = t.elements;
    if (
      typeof elt !== 'string' &&
      elt.kind === 'list' &&
      isSubtype(collectionElementType(elt) ?? 'any', 'number')
    )
      return true;
  }
  if (e.isFiniteCollection) {
    const first = e.at(1);
    if (first === undefined) return false;
    if (first.isIndexedCollection !== true) return false;
    const elt = collectionElementType(jsType(first));
    return elt !== undefined && isSubtype(elt, 'number');
  }
  return false;
}

/**
 * True when a `PointList` component is a *source* — a zip participant, rather
 * than a per-point scalar slot.
 *
 * THE shared source predicate: an `indexed_collection` type that is neither a
 * tuple (a tuple is a single point, and a tuple type also matches
 * `indexed_collection`) nor a union (statically ambiguous role). Kept local
 * here — not imported — for the module-init reordering hazard noted on
 * `isPointListOperand` above.
 *
 * DELIBERATE DIVERGENCE from the `PointList` TYPE handler's `isListType`
 * (`library/collections.ts`): that predicate reads a bare `tuple` and a union
 * whose members all match `indexed_collection` (`list<number> |
 * tuple<number, number>`) as sources. Narrowing it there is
 * interpreter-visible, so the compile route narrows on its own: both shapes
 * fall to the retained decline below (per-point value not statically known),
 * matching the spec's Shared-predicate table.
 */
function isPointListSource(e: Expression): boolean {
  const t = jsType(e);
  // `'tuple'` (the bare, unparameterized name) is a plain string, not a
  // `{ kind: 'tuple' }` node — both spellings are a single point.
  if (t === 'tuple') return false;
  if (typeof t !== 'string' && (t.kind === 'tuple' || t.kind === 'union'))
    return false;
  return e.type.matches('indexed_collection');
}

/**
 * A type that is provably a collection — directly, or through any member of a
 * union. Mirrors the guard in the `PointList` definition handler
 * (`library/collections.ts`): such a component is not a scalar slot.
 */
function isProvablyNonScalarType(t: Type): boolean {
  if (typeof t !== 'string' && t.kind === 'union')
    return t.types.some(isProvablyNonScalarType);
  return isSubtype(t, 'collection');
}

/**
 * Lower a `PointList` with one or more list SOURCES to the zipped list of
 * points — an array of arrays, exactly the value an evaluated `PointList`
 * compiles to when it is reached the other way round. Reached only when the
 * definition handler declined (it keeps the all-scalar, `Tuple`-identical
 * path); see `docs/plans/2026-07-31-pointlist-compile-design.md` § D1.
 *
 * ```js
 * (() => { const _tv2 = <source>; const _tv3 = <slot>;
 *          const _tv4 = Math.min(_tv2.length); const _tv5 = new Array(_tv4);
 *          for (let _tv1 = 0; _tv1 < _tv4; _tv1++) _tv5[_tv1] = [_tv2[_tv1], _tv3];
 *          return _tv5; })()
 * ```
 *
 * - **Shortest zip** falls out of `Math.min` — the ratified PAIRING-family
 *   contract (`docs/BROADCAST-MODEL.md`; Tycho item 52), not the strict
 *   LIFTED-broadcast length rule.
 * - **Every component is hoisted and evaluated exactly once, in operand
 *   order** — sources and slots alike — matching the interpreter (a non-lazy
 *   handler receives evaluated operands) and keeping an impure component from
 *   being re-run per point or per splice.
 * - An **opaque** slot (`unknown`/`value`) that holds an array at run time
 *   yields `NaN` components — the self-describing absence marker — rather than
 *   splicing a whole array into every point. Divergence, deliberate: the
 *   interpreter would transpose that slot as a source; the compiled form
 *   cannot know to, and silently-wrong points are worse than `NaN`.
 * - A **statically infinite** source and a component that is neither a source
 *   nor a scalar slot (tuple/set/map, or a union with a collection member)
 *   throw: they have no per-point value. Fail closed (D6).
 * - `target.iterationBudget`, when set, joins the `Math.min` (floored — the
 *   option validator admits fractional values and `new Array(2.5)` throws), so
 *   the zip length is capped. It bounds the zip only: materializing the
 *   sources is the source lowering's own, pre-existing behavior. Truncation
 *   semantics all the way down: a budget below 1 (`0.5`) floors to `0`, so the
 *   compiled point list is empty.
 * - Each hoisted source is checked with `Array.isArray` and throws a loud
 *   `RangeError` naming the component when it is not an array: a `vars`-splice
 *   type-contract breach fails fast, deliberately unmasked. (`Math.min` alone
 *   does not catch it — a string or an array-like has a `.length` and would
 *   zip into garbage.)
 */
function compileJSPointList(
  args: ReadonlyArray<Expression>,
  compile: (e: Expression) => string,
  target: CompileTarget<Expression>
): string {
  const idx = BaseCompiler.tempVar(target);
  const bindings: string[] = [];
  const sources: string[] = [];
  // The per-point component expressions, in operand order.
  const parts: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (isPointListSource(a)) {
      if (a.isCollection && a.isFiniteCollection === false)
        throw new Error(
          `PointList: source component ${i + 1} is an infinite collection — ` +
            `an infinite point list has no compiled value. Fail closed (D6).`
        );
      const name = BaseCompiler.tempVar(target);
      bindings.push(`const ${name} = ${compile(a)};`);
      // A source MUST be an array: a string (or any array-like) has a
      // `.length`, so `Math.min` would happily zip it into garbage. Check once
      // per call, right after hoisting, and fail loudly instead.
      bindings.push(
        `if (!Array.isArray(${name})) throw new RangeError('PointList: ` +
          `source component ${i + 1} is not an array at run time');`
      );
      sources.push(name);
      parts.push(`${name}[${idx}]`);
      continue;
    }
    if (isProvablyNonScalarType(jsType(a)))
      throw new Error(
        `PointList: cannot compile — component ${i + 1} (type ` +
          `\`${a.type.toString()}\`) is neither a scalar slot nor a list ` +
          `source; its per-point value cannot be determined at compile time. ` +
          `Fail closed (D6).`
      );
    const name = BaseCompiler.tempVar(target);
    if (a.type.matches('number')) {
      // Provably scalar numeric: the slot value, verbatim.
      bindings.push(`const ${name} = ${compile(a)};`);
    } else {
      // Opaque (`unknown`, `value`, any other non-collection type): guarded.
      const raw = BaseCompiler.tempVar(target);
      bindings.push(`const ${raw} = ${compile(a)};`);
      bindings.push(`const ${name} = Array.isArray(${raw}) ? NaN : ${raw};`);
    }
    parts.push(name);
  }

  // No source: the definition handler owns the all-scalar path, so this is
  // unreachable today. Emit the plain point anyway rather than invalid source —
  // through the IIFE, since `parts` names the temporaries `bindings` declares.
  if (sources.length === 0)
    return `(() => { ${bindings.join(' ')} return [${parts.join(', ')}]; })()`;

  const lengths = sources.map((s) => `${s}.length`);
  const budget = target.iterationBudget;
  if (budget !== undefined) lengths.push(String(Math.floor(budget)));
  const n = BaseCompiler.tempVar(target);
  const out = BaseCompiler.tempVar(target);
  return (
    `(() => { ${bindings.join(' ')} ` +
    `const ${n} = Math.min(${lengths.join(', ')}); ` +
    `const ${out} = new Array(${n}); ` +
    `for (let ${idx} = 0; ${idx} < ${n}; ${idx}++) ` +
    `${out}[${idx}] = [${parts.join(', ')}]; ` +
    `return ${out}; })()`
  );
}

/**
 * Codegen shared by `Characters` and its synonym `GraphemeClusters` — see the
 * `Characters` entry in `JAVASCRIPT_FUNCTIONS` for the semantics.
 */
function compileJSCharacters(
  kind: string,
  args: ReadonlyArray<Expression>,
  compile: (e: Expression) => string
): string {
  const arg = args[0];
  if (arg === null || arg === undefined)
    throw new Error(`${kind}: missing argument`);
  if (args.length !== 1 || !isProvablyStringOperand(arg))
    throw new Error(
      `${kind}: cannot compile — the operand must be provably a string. The ` +
        `interpreter leaves a non-string operand unevaluated (or reports an ` +
        `\`incompatible-type\` error). ` +
        `Fail closed (D6) — the interpreter evaluates it.`
    );
  return `_SYS.chars(${compile(arg)})`;
}

/**
 * JavaScript function implementations
 */
const JAVASCRIPT_FUNCTIONS: CompiledFunctions<Expression> = {
  // Tolerance-aware equality (see compileJSEquality). Not operators — a raw
  // `===` is exact and disagrees with the interpreter's tolerant compare.
  Equal: (args, compile, target) =>
    compileJSEquality('Equal', args, compile, target),
  NotEqual: (args, compile, target) =>
    compileJSEquality('NotEqual', args, compile, target),
  // The ordering relations and logical connectives normally lower to raw JS
  // infix in `BaseCompiler`. These handlers are reached ONLY when that path
  // declines — i.e. when an operand may be a collection at run time — and
  // they fail closed, because the JS operators do not broadcast element-wise.
  Less: (args, compile, target) =>
    compileJSCollectionBoolean('Less', args, compile, target),
  LessEqual: (args, compile, target) =>
    compileJSCollectionBoolean('LessEqual', args, compile, target),
  Greater: (args, compile, target) =>
    compileJSCollectionBoolean('Greater', args, compile, target),
  GreaterEqual: (args, compile, target) =>
    compileJSCollectionBoolean('GreaterEqual', args, compile, target),
  And: (args, compile, target) =>
    compileJSCollectionBoolean('And', args, compile, target),
  Or: (args, compile, target) =>
    compileJSCollectionBoolean('Or', args, compile, target),
  Not: (args, compile, target) =>
    compileJSCollectionBoolean('Not', args, compile, target),
  // Note: `Abs` of a fixed-arity point never reaches this handler — the
  // shared compiler rewrites `Abs(Tuple)` → `Norm` (base-compiler.ts) so the
  // point compiles through the `Norm` codegen below (Tycho item 74).
  Abs: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_SYS.cabs(${compile(args[0])})`;
    if (BaseCompiler.isNonNegative(args[0])) return compile(args[0]);
    return `Math.abs(${compile(args[0])})`;
  },
  Add: (args, compile, target) => {
    if (args.length === 1) return compile(args[0]);
    const anyComplex = args.some((a) => BaseCompiler.isComplexValued(a));
    if (!anyComplex) {
      // Try full constant fold
      const constants = args.map(tryGetConstant);
      if (constants.every((c) => c !== undefined))
        return String(constants.reduce((a, b) => a! + b!, 0));
      // Filter out zero-valued operands
      const nonZero = args.filter((a) => tryGetConstant(a) !== 0);
      if (nonZero.length === 0) return '0';
      if (nonZero.length === 1) return compile(nonZero[0]);
      return `(${nonZero.map((x) => compile(x)).join(' + ')})`;
    }

    // A complex operand's code is spliced once per `.re`/`.im` slot. For a
    // compound operand that would DUPLICATE the whole subexpression — code
    // size and runtime double per nesting level (`((z²+c)²+c)…` compiled to
    // hundreds of KB at depth 10; Tycho item 59) — so bind each compound
    // complex operand to a const, emitted exactly once. Symbols and number
    // literals stay inline (free to duplicate; keeps simple shapes
    // byte-identical to the previous emission).
    const bindings: Array<[name: string, value: string]> = [];
    const parts = args.map((a) => {
      const code = compile(a);
      const isComplex = BaseCompiler.isComplexValued(a);
      if (isComplex && !isSymbol(a) && !isNumber(a)) {
        const name = BaseCompiler.tempVar(target);
        bindings.push([name, code]);
        return { code: name, isComplex, bound: true };
      }
      return { code, isComplex, bound: false };
    });
    const reTerms = parts.map((p) =>
      p.isComplex ? (p.bound ? `${p.code}.re` : `(${p.code}).re`) : p.code
    );
    const imTerms = parts
      .filter((p) => p.isComplex)
      .map((p) => (p.bound ? `${p.code}.im` : `(${p.code}).im`));
    const body = `({ re: ${reTerms.join(' + ')}, im: ${imTerms.join(' + ')} })`;
    if (bindings.length === 0) return body;
    return `(() => { const ${bindings
      .map(([n, v]) => `${n} = ${v}`)
      .join(', ')}; return ${body}; })()`;
  },
  Arccos: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_SYS.cacos(${compile(args[0])})`;
    // Real operand, complex result (`Arccos(2)`, or `Arccos(x)` for a real
    // symbol of unknown magnitude): the node is typed `finite_complex`, so the
    // parent emits `{re, im}` arithmetic and `Math.acos` — a `NaN` number —
    // must not be the lowering. See `resultIsComplexValued`.
    if (resultIsComplexValued('Arccos', args))
      return `_SYS.cacos(${complexOperandCode(args[0], compile)})`;
    return `Math.acos(${compile(args[0])})`;
  },
  Arcosh: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_SYS.cacosh(${compile(args[0])})`;
    if (resultIsComplexValued('Arcosh', args))
      return `_SYS.cacosh(${complexOperandCode(args[0], compile)})`;
    return `Math.acosh(${compile(args[0])})`;
  },
  Arccot: ([x], compile) => {
    if (x === null) throw new Error('Arccot: no argument');
    if (BaseCompiler.isComplexValued(x)) return `_SYS.cacot(${compile(x)})`;
    // `Math.atan(1/x)` returns the wrong branch for x < 0 (range (-π/2, 0)
    // instead of the interpreter's (0, π)). `π/2 - atan(x)` is branch-free and
    // gives the full (0, π) range for all real x.
    return `(Math.PI / 2 - Math.atan(${compile(x)}))`;
  },
  Arcoth: ([x], compile) => {
    if (x === null) throw new Error('Arcoth: no argument');
    if (BaseCompiler.isComplexValued(x)) return `_SYS.cacoth(${compile(x)})`;
    if (resultIsComplexValued('Arcoth', [x]))
      return `_SYS.cacoth(${complexOperandCode(x, compile)})`;
    return `Math.atanh(1 / (${compile(x)}))`;
  },
  Arccsc: ([x], compile) => {
    if (x === null) throw new Error('Arccsc: no argument');
    if (BaseCompiler.isComplexValued(x)) return `_SYS.cacsc(${compile(x)})`;
    if (resultIsComplexValued('Arccsc', [x]))
      return `_SYS.cacsc(${complexOperandCode(x, compile)})`;
    return `Math.asin(1 / (${compile(x)}))`;
  },
  Arcsch: ([x], compile) => {
    if (x === null) throw new Error('Arcsch: no argument');
    if (BaseCompiler.isComplexValued(x)) return `_SYS.cacsch(${compile(x)})`;
    return `Math.asinh(1 / (${compile(x)}))`;
  },
  Arcsec: ([x], compile) => {
    if (x === null) throw new Error('Arcsec: no argument');
    if (BaseCompiler.isComplexValued(x)) return `_SYS.casec(${compile(x)})`;
    if (resultIsComplexValued('Arcsec', [x]))
      return `_SYS.casec(${complexOperandCode(x, compile)})`;
    return `Math.acos(1 / (${compile(x)}))`;
  },
  Arsech: ([x], compile) => {
    if (x === null) throw new Error('Arsech: no argument');
    if (BaseCompiler.isComplexValued(x)) return `_SYS.casech(${compile(x)})`;
    if (resultIsComplexValued('Arsech', [x]))
      return `_SYS.casech(${complexOperandCode(x, compile)})`;
    return `Math.acosh(1 / (${compile(x)}))`;
  },
  Arcsin: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_SYS.casin(${compile(args[0])})`;
    if (resultIsComplexValued('Arcsin', args))
      return `_SYS.casin(${complexOperandCode(args[0], compile)})`;
    return `Math.asin(${compile(args[0])})`;
  },
  Arsinh: 'Math.asinh',
  Arctan: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_SYS.catan(${compile(args[0])})`;
    return `Math.atan(${compile(args[0])})`;
  },
  Artanh: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_SYS.catanh(${compile(args[0])})`;
    if (resultIsComplexValued('Artanh', args))
      return `_SYS.catanh(${complexOperandCode(args[0], compile)})`;
    return `Math.atanh(${compile(args[0])})`;
  },
  Ceil: (args, compile) => {
    if (BaseCompiler.isIntegerValued(args[0])) return compile(args[0]);
    return `Math.ceil(${compile(args[0])})`;
  },
  // Bake the engine's configured tolerance, like compiled `Equal`
  // (`compileJSEquality`): a bare `_SYS.chop(x)` fell back to the static
  // default (1e-10) and diverged from the interpreter's `Chop` at any
  // non-default `ce.tolerance`.
  Chop: (args, compile) =>
    `_SYS.chop(${compile(args[0])}, ${args[0]?.engine?.tolerance ?? 1e-10})`,
  Cos: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_SYS.ccos(${compile(args[0])})`;
    return `Math.cos(${compile(args[0])})`;
  },
  Cosh: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_SYS.ccosh(${compile(args[0])})`;
    return `Math.cosh(${compile(args[0])})`;
  },
  Cot: ([x], compile, target) => {
    if (x === null) throw new Error('Cot: no argument');
    if (BaseCompiler.isComplexValued(x)) return `_SYS.ccot(${compile(x)})`;
    return BaseCompiler.inlineExpression(
      target,
      'Math.cos(${x}) / Math.sin(${x})',
      compile(x)
    );
  },
  Coth: ([x], compile, target) => {
    if (x === null) throw new Error('Coth: no argument');
    if (BaseCompiler.isComplexValued(x)) return `_SYS.ccoth(${compile(x)})`;
    return BaseCompiler.inlineExpression(
      target,
      '(Math.cosh(${x}) / Math.sinh(${x}))',
      compile(x)
    );
  },
  Csc: ([x], compile) => {
    if (x === null) throw new Error('Csc: no argument');
    if (BaseCompiler.isComplexValued(x)) return `_SYS.ccsc(${compile(x)})`;
    return `1 / Math.sin(${compile(x)})`;
  },
  Csch: ([x], compile) => {
    if (x === null) throw new Error('Csch: no argument');
    if (BaseCompiler.isComplexValued(x)) return `_SYS.ccsch(${compile(x)})`;
    return `1 / Math.sinh(${compile(x)})`;
  },
  Exp: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_SYS.cexp(${compile(args[0])})`;
    return `Math.exp(${compile(args[0])})`;
  },
  First: (args, compile) => `${compile(args[0])}[0]`,
  Floor: (args, compile) => {
    if (BaseCompiler.isIntegerValued(args[0])) return compile(args[0]);
    return `Math.floor(${compile(args[0])})`;
  },
  Fract: ([x], compile, target) => {
    if (x === null) throw new Error('Fract: no argument');
    return BaseCompiler.inlineExpression(
      target,
      '${x} - Math.floor(${x})',
      compile(x)
    );
  },
  Gamma: '_SYS.gamma',
  // n-ary GCD/LCM. The `_SYS.gcd`/`_SYS.lcm` runtime helpers are BINARY with a
  // third `eps` (tolerance) argument, so a bare `_SYS.gcd(a, b, c)` string map
  // would silently consume the third *operand* `c` as the tolerance. Instead
  // fold pairwise so no operand can ever land in the `eps` slot, and handle
  // list-valued operands by spread-and-reduce (mirroring `compileExtremum`).
  GCD: (args, compile) => compileGcdLcm('GCD', args, compile),
  Integrate: (args, compile, target) => compileIntegrate(args, compile, target),
  LCM: (args, compile) => compileGcdLcm('LCM', args, compile),
  Product: (args, compile, target) =>
    compileSumProduct('Product', args, compile, target),
  Sum: (args, compile, target) =>
    compileSumProduct('Sum', args, compile, target),
  Limit: (args, compile) =>
    `_SYS.limit(${compile(args[0])}, ${compile(args[1])})`,
  Ln: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_SYS.cln(${compile(args[0])})`;
    // PROVABLY negative real operand, complex result (`Ln(-2)`, or `a := -2`
    // → `Ln(a)` is `finite_complex`): the parent emits `{re, im}` arithmetic,
    // so `Math.log` — a `NaN` number — must not be the lowering. An operand
    // of merely UNKNOWN sign keeps the real kernel (pinned; see the
    // `isComplexValued` Sqrt/Ln/Log carve-out, which makes the parent agree).
    if (args[0]?.isNegative === true && resultIsComplexValued('Ln', args))
      return `_SYS.cln(${complexOperandCode(args[0], compile)})`;
    return `Math.log(${compile(args[0])})`;
  },
  List: (args, compile) => `[${args.map((x) => compile(x)).join(', ')}]`,
  // Matrix wraps List(List(...), ...) — compile the body (first arg) which
  // is the nested List structure; remaining args are delimiters/column spec
  Matrix: (args, compile) => compile(args[0]),
  // Tuple compiles identically to List
  Tuple: (args, compile) => `[${args.map((x) => compile(x)).join(', ')}]`,
  // Element count of a compiled collection. Only an indexed collection lowers
  // to a JS array; a dictionary or string operand fails closed (D6).
  Length: (args, compile) => {
    const arg = args[0];
    if (arg === null || arg === undefined)
      throw new Error('Length: no argument');
    if (!isIndexedCollectionOperand(arg))
      throw new Error(
        `Length: cannot compile — operand is not an indexed collection ` +
          `(list/vector/range). Fail closed (D6).`
      );
    return `(${compile(arg)}).length`;
  },
  // Positional access. CE `At` is 1-based and supports negative indices from
  // the end. The index may be a scalar, a list of integers (gather), or a
  // boolean mask — `_SYS.at` dispatches on its runtime shape, since an index
  // expression (e.g. `p[X-1]`) is not always statically provably a collection.
  // A scalar out-of-range or zero index yields NaN (matching the interpreter's
  // `Nothing`, projected to NaN on a real target); a gather drops out-of-range
  // entries; a non-integer entry in a collection index makes the interpreter
  // decline, projected as a scalar NaN for the whole result. Only the
  // single-index form over an indexed collection compiles; nested/multi-index
  // access and non-collection operands fail closed (D6).
  At: (args, compile) => {
    const coll = args[0];
    const index = args[1];
    if (
      coll === null ||
      coll === undefined ||
      index === null ||
      index === undefined
    )
      throw new Error('At: missing argument');
    if (args.length !== 2)
      throw new Error(
        `At: only the single-index form compiles; multi-index (nested) ` +
          `access is not supported. Fail closed (D6).`
      );
    const provablyIndexed = isIndexedCollectionOperand(coll);
    if (!provablyIndexed && !couldBeIndexedCollectionOperand(coll))
      throw new Error(
        `At: cannot compile — first operand is not an indexed collection ` +
          `(list/vector/range). Fail closed (D6).`
      );
    // A base admitted only by the "could be" path may be a dictionary at run
    // time, and keyed access has no compiled equivalent (`_SYS.at` answers NaN
    // for a non-array base, where the interpreter returns the stored value).
    // Require a provably numeric index there rather than emit a silent NaN.
    if (!provablyIndexed && !isNumericIndexOperand(index))
      throw new Error(
        `At: cannot compile — the first operand is not provably an indexed ` +
          `collection (type \`${coll.type.toString()}\`) and the index is not ` +
          `provably numeric, so a keyed (dictionary) access cannot be ruled ` +
          `out. Fail closed (D6).`
      );
    // A COMPLEX index needs no compile-time gate: the interpreter validates an
    // index through its `.re` (so `p[1+2i]` selects `p[1]`, the imaginary part
    // silently dropped), and `_SYS.at` reproduces that at RUN time. A static
    // gate was tried and reverted — the index's declared type is routinely far
    // wider than its runtime value (a comprehension variable types as
    // `boolean | indexed_collection | number | string`), so refusing on
    // "not provably real" declined ordinary compilable code such as `P[n]`
    // inside a comprehension. Matching the interpreter beats refusing.
    const base = `_SYS.at(${compile(coll)}, ${compile(index)})`;
    // `_SYS.at` marks an out-of-band SCALAR access with `NaN` (the numeric
    // absence marker). For an OBJECT-domain collection (non-numeric elements),
    // absence must instead be the target null (`undefined`, I6) so the object
    // discharge (`Coalesce`, `IsMissing`) sees it — map the marker across. Only
    // the scalar-index case: a gather yields an array, handled position-wise.
    // The extracted element type can itself be a reference (`list<maybe_n>`
    // with `maybe_n = number | missing`) — unfold it before the missing-strip,
    // or the strip is a no-op and the axis test misclassifies the domain.
    const eltT = collectionElementType(jsType(coll));
    const scalarIndex =
      !isIndexedCollectionOperand(index) && !index.type.matches('collection');
    const objectDomain =
      eltT !== undefined &&
      eltT !== 'unknown' &&
      eltT !== 'any' &&
      !isSubtype(
        stripMissingFromType(resolveTypeForCompilation(eltT)),
        'number'
      );
    if (objectDomain && scalarIndex)
      return `((_v) => (typeof _v === 'number' && Number.isNaN(_v)) ? undefined : _v)(${base})`;
    return base;
  },
  // Fold a collection. CE `Reduce` canonicalizes `\sum_{i=d}^{d} d` to
  // `Reduce(d, Add, 0)`. The Add/Multiply/Min/Max folds compile, as does a
  // custom combiner (`Function` literal or function-valued symbol, compiled
  // as a lambda like `Map`/`Filter`) — but a custom combiner requires an
  // explicit initial value: without one the interpreter folds from `Nothing`
  // (whose effect depends on the combiner and has no numeric equivalent),
  // while a native seedless reduce starts from the first element — those
  // diverge for non-commutative combiners. Anything else fails closed (D6).
  // `Fold(f, init, coll)` canonicalizes to `Reduce(coll, f, init)`, so this
  // handler covers it too.
  Reduce: (args, compile, target) => {
    const coll = args[0];
    const op = args[1];
    const init = args[2];
    if (coll === null || coll === undefined || op === null || op === undefined)
      throw new Error('Reduce: missing argument');
    if (!isIndexedCollectionOperand(coll))
      throw new Error(
        `Reduce: cannot compile — first operand is not an indexed collection ` +
          `(list/vector/range). Fail closed (D6).`
      );
    let combiner = builtinCombiner(op);
    if (
      combiner === undefined &&
      (isFunction(op, 'Function') || isSymbol(op))
    ) {
      if (init === undefined || init === null)
        throw new Error(
          `Reduce: a custom combiner compiles only with an explicit ` +
            `initial value. Fail closed (D6).`
        );
      // The combiner is `(accumulator, element)`: the accumulator's type is
      // not provable here (it is the fold's own result), so an annotation on
      // that position always declines.
      BaseCompiler.assertCallbackAnnotations('Reduce', op, [
        undefined,
        BaseCompiler.collectionElementTypeOf(coll),
      ]);
      combiner = customCombiner(op, compile, target);
    }
    if (combiner === undefined)
      throw new Error(
        `Reduce: the combiner does not compile to a function — only ` +
          `Add/Multiply/Min/Max folds, function literals, and user-defined ` +
          `functions compile on the JavaScript target. Fail closed (D6).`
      );
    const collCode = compile(coll);
    // With an initial value, seed the reduce; without one, the native reduce
    // uses the first element as the seed (matching the interpreter, which
    // returns the sole/first element for a singleton and folds pairwise). A
    // seedless native `reduce` throws on an empty array, whereas the
    // interpreter returns `Nothing` (numeric projection NaN) — so guard the
    // empty case to yield NaN instead of throwing at runtime.
    if (init !== undefined && init !== null)
      return `(${collCode}).reduce(${combiner}, ${compile(init)})`;
    return `((_l) => _l.length === 0 ? NaN : _l.reduce(${combiner}))(${collCode})`;
  },
  // --- List-shaped collection operators ---------------------------------
  // Each lowers to a native array operation. Only an indexed collection
  // (list/vector/range) lowers to a JS array; other operands fail closed (D6),
  // matching `Length`/`At`/`Reduce`.
  //
  // `Last` is the last element (`At(coll, -1)`); an empty collection yields NaN
  // (the interpreter's `Nothing` projected onto a real target).
  Last: (args, compile) => `_SYS.at(${collArg('Last', args[0], compile)}, -1)`,
  // All-but-first / all-but-first-n / first-n. `Take`/`Drop` clamp the count to
  // ≥ 0 so a negative count matches the interpreter (`Take(xs, -2) = []`,
  // `Drop(xs, -2) = xs`), and JS `slice` already clamps a count past the end.
  Rest: (args, compile) => `(${collArg('Rest', args[0], compile)}).slice(1)`,
  Take: (args, compile) => {
    if (args[1] == null) throw new Error('Take: missing count');
    // A statically infinite operand (`Take(Map(f, 1..∞), n)`) compiles as a
    // lazy stream, materialized here — the one place (with `TakeWhile`) an
    // infinite pipeline becomes finite. The count may be a runtime value;
    // `takeIter` normalizes it. A count that is STATICALLY non-finite
    // (`Take(1..∞, ∞)`) can never bound the stream, so it fails closed at
    // compile time — the same rule the `Range` handler applies to its bounds
    // — rather than compiling successfully and producing takeIter's
    // indeterminate [] at run time.
    if (isLazyStream(args[0])) {
      if (isNonFiniteBound(args[1]))
        throw new Error(
          `Take: a non-finite count (\`${args[1].toString()}\`) cannot bound ` +
            `an infinite collection. Fail closed (D6).`
        );
      return `_SYS.takeIter(${emitLazyStream(args[0]!, compile)}, ${compile(args[1])})`;
    }
    const coll = collArg('Take', args[0], compile);
    return `(${coll}).slice(0, ${clampedSliceCount(args[1], compile)})`;
  },
  Drop: (args, compile) => {
    const coll = collArg('Drop', args[0], compile);
    if (args[1] == null) throw new Error('Drop: missing count');
    return `(${coll}).slice(${clampedSliceCount(args[1], compile)})`;
  },
  // Reverse and (ascending, numeric) Sort — copy first so the source array is
  // not mutated. A custom `Sort` comparator is not lowered (fails closed).
  Reverse: (args, compile) =>
    `(${collArg('Reverse', args[0], compile)}).slice().reverse()`,
  Sort: (args, compile) => {
    const coll = collArg('Sort', args[0], compile);
    if (args.length > 1)
      throw new Error(
        `Sort: a custom comparator does not compile; only the default ` +
          `ascending numeric sort is supported. Fail closed (D6).`
      );
    return `(${coll}).slice().sort((_a, _b) => _a - _b)`;
  },
  // Flat concatenation of the (top-level) elements of each collection operand.
  Join: (args, compile) => {
    if (args.length === 0) return '[]';
    return `[${args
      .map((a, i) => `...(${collArg('Join', a, compile, i + 1)})`)
      .join(', ')}]`;
  },
  // Split a string into a list of user-perceived characters. The interpreter
  // segments GRAPHEME CLUSTERS (UAX #29 via `Intl.Segmenter`, `library/core.ts`
  // `splitGraphemeClusters`) — NOT code points and NOT UTF-16 units, so neither
  // `[...s]` nor `s.split('')` is faithful: probed, `Characters` answers 1
  // element for a ZWJ family emoji and for a regional-indicator flag (5 and 2
  // code points), and 1 for a decomposed `"e" + U+0301`. `_SYS.chars` runs the
  // same segmenter. A non-string operand leaves the interpreter's `Characters`
  // inert (or an `incompatible-type` error), so it fails closed (D6).
  Characters: (args, compile) =>
    compileJSCharacters('Characters', args, compile),
  // Shipped synonym of `Characters` (v0.30), same interpreter handler.
  GraphemeClusters: (args, compile) =>
    compileJSCharacters('GraphemeClusters', args, compile),
  // String concatenation. Two interpreter shapes compile (probed):
  //  - VARIADIC, every operand a string — `StringJoin("a", "b")` → `"ab"`, and
  //    the nullary form is the empty string;
  //  - a SINGLE indexed collection of strings — `StringJoin(Characters(s))`.
  // Everything else fails closed, because the interpreter leaves it
  // UNEVALUATED rather than coercing: a non-string operand (`StringJoin("a", 1)`
  // is an `incompatible-type` error, not `"a1"` — that is `String`, a different
  // operator) and, notably, the MIXED arity form `StringJoin("a", ["b","c"])`,
  // which stays inert even though every leaf is a string.
  //
  // The result is `.normalize()`d because the interpreter's `engine.string()`
  // stores every string in Unicode NFC: joining `"e"` and `U+0301` yields the
  // single precomposed `"é"` there, and a raw `+` would not.
  StringJoin: (args, compile) => {
    if (args.length === 0) return '""';
    if (args.length === 1 && !isProvablyStringOperand(args[0])) {
      const coll = args[0];
      const elt = collectionElementType(jsType(coll));
      // `never` is the element type of the EMPTY literal `[]`: no element can
      // fail to be a string, and `[].join("")` is the interpreter's `""`.
      if (
        !isIndexedCollectionOperand(coll) ||
        elt === undefined ||
        (elt !== 'never' && !isSubtype(elt, 'string'))
      )
        throw new Error(
          `StringJoin: cannot compile — the single-operand form requires an ` +
            `indexed collection whose elements are provably strings ` +
            `(\`list<string>\`); a non-string operand or element leaves the ` +
            `interpreter's \`StringJoin\` unevaluated. ` +
            `Fail closed (D6) — the interpreter evaluates it.`
        );
      return `((${compile(coll)}).join("").normalize())`;
    }
    if (!args.every(isProvablyStringOperand))
      throw new Error(
        `StringJoin: cannot compile — every operand of the variadic form must ` +
          `be provably a string. The interpreter leaves the expression ` +
          `UNEVALUATED on a non-string operand, and a collection operand ` +
          `alongside another operand (\`StringJoin("a", ["b", "c"])\`) stays ` +
          `inert too. Fail closed (D6) — the interpreter evaluates it.`
      );
    const parts = args.map((a) => `(${compile(a)})`).join(' + ');
    return `((${parts}).normalize())`;
  },
  // 1-based index of the first element equal to `value`, or 0 if not found.
  // The element test is EXACT, matching the interpreter's `.isSame()`, which
  // has no numeric tolerance (`IndexOf([0], 5e-11)` and
  // `IndexOf([0.30000000000000004], 0.3)` both answer 0, probe-verified) —
  // NOT the tolerance test `compileJSEquality` uses for `Equal`. It is not
  // `Array.indexOf` either, because of NaN (below). `findIndex` is 0-based and
  // returns -1 when absent, so `+ 1` maps both. The value is hoisted into an
  // IIFE parameter so it is evaluated once.
  //
  // ACCEPTED RESIDUAL (exactness loss, unclosable): a needle COMPUTED at
  // runtime to a near-miss f64 (`0.1 + 0.2` → `0.30000000000000004`) is not
  // found in a `[0.3]` haystack, where the interpreter folds `Add(0.1, 0.2)`
  // exactly to `0.3` and does find it. That is the ordinary exactness loss of
  // compiling to f64 arithmetic — no element test can recover the exact sum,
  // and a tolerance leaf would only trade it for wrong answers on genuinely
  // distinct nearby numbers.
  IndexOf: (args, compile) => {
    const coll = collArg('IndexOf', args[0], compile);
    if (args[1] == null) throw new Error('IndexOf: missing value');
    // An AGGREGATE needle is invisible to the element test — `===` on two
    // distinct arrays is reference identity, so
    // `IndexOf([[1,2],[3,4]], Tuple(3,4))` ran to 0 where the interpreter
    // answers 2. The string gates below are RETAINED for the same fail-closed
    // reason they were introduced (pinned in this file's suite), even though
    // the exact `===` leaf would now compare strings faithfully: relaxing them
    // is a separate decision, not part of the exactness fix.
    assertComparableAggregate('IndexOf', [args[1]]);
    assertNoStringOperand('IndexOf', [args[1]]);
    const elt = collectionElementType(jsType(args[0]));
    if (elt !== undefined && elt !== 'never' && isSubtype(elt, 'string'))
      throw new Error(
        `IndexOf: cannot compile — the collection has string elements, which ` +
          `are not supported by this target (the element test is a numeric ` +
          `tolerance comparison, NaN for strings). Fail closed (D6) — the ` +
          `interpreter evaluates it.`
      );
    // Strict `===` is the whole element test, plus one departure: NaN.
    // `NaN === NaN` is false, so a NaN needle would never be found, where the
    // interpreter's structural `.isSame()` answers 1 — hence the both-NaN
    // short-circuit. BOOLEAN-ness needs no guard: `true === 1` is false
    // natively (it was the earlier `Math.abs(true - 1) <= tol` leaf that found
    // a boolean needle in a numeric haystack, and a numeric needle in a
    // boolean one, where the interpreter answers 0).
    return `((_v) => (${coll}).findIndex((_x) => (_x !== _x && _v !== _v) || _x === _v) + 1)(${compile(
      args[1]
    )})`;
  },
  // Higher-order: the mapping/predicate operand is compiled as a lambda
  // (`Function` literal → `(x) => …`), hoisted into an IIFE parameter so it
  // is instantiated once (not once per element), and invoked with a fixed
  // unary arity — the native callbacks pass `(x, index, array)` and the
  // extra arguments must not leak into the lambda's parameters (the
  // interpreter passes exactly `(x)`). A mapping operand that does not
  // compile to a lambda fails closed.
  Map: (args, compile) => {
    // The multi-collection (zipWith) form is not compiled; fail closed so the
    // engine reports success:false and falls back to the interpreter.
    if (args.length > 2)
      throw new Error('Map: multi-collection form is not compiled');
    if (args[1] == null) throw new Error('Map: missing source collection');
    const coll = collArg('Map', args[1], compile);
    return `((_f) => (${coll}).map((_x) => _f(_x)))(${fnArg('Map', args[0], args[1], compile)})`;
  },
  Filter: (args, compile) => {
    const coll = collArg('Filter', args[0], compile);
    if (args[1] == null) throw new Error('Filter: missing predicate');
    return `((_f) => (${coll}).filter((_x) => _f(_x)))(${fnArg('Filter', args[1], args[0], compile)})`;
  },
  // Number of elements satisfying the predicate.
  CountIf: (args, compile) => {
    const coll = collArg('CountIf', args[0], compile);
    if (args[1] == null) throw new Error('CountIf: missing predicate');
    return `((_f) => (${coll}).filter((_x) => _f(_x)).length)(${fnArg('CountIf', args[1], args[0], compile)})`;
  },
  // First element satisfying the predicate; none → NaN (the interpreter's
  // `Nothing` projected onto a real target, matching `Last`).
  Find: (args, compile) => {
    const coll = collArg('Find', args[0], compile);
    if (args[1] == null) throw new Error('Find: missing predicate');
    return `((_f) => ((${coll}).find((_x) => _f(_x)) ?? NaN))(${fnArg('Find', args[1], args[0], compile)})`;
  },
  // 1-based index of the first element satisfying the predicate, or 0 if
  // none — `findIndex` is 0-based and returns -1, so `+ 1` maps both.
  IndexWhere: (args, compile) => {
    const coll = collArg('IndexWhere', args[0], compile);
    if (args[1] == null) throw new Error('IndexWhere: missing predicate');
    return `((_f) => (${coll}).findIndex((_x) => _f(_x)) + 1)(${fnArg('IndexWhere', args[1], args[0], compile)})`;
  },
  // List of the 1-based indexes of the elements satisfying the predicate.
  Position: (args, compile) => {
    const coll = collArg('Position', args[0], compile);
    if (args[1] == null) throw new Error('Position: missing predicate');
    return `((_f) => (${coll}).flatMap((_x, _i) => _f(_x) ? [_i + 1] : []))(${fnArg('Position', args[1], args[0], compile)})`;
  },
  // Apply the function to 1-based indexes: 1-D `Tabulate(f, n)` → list;
  // 2-D `Tabulate(f, m, n)` → m×n nested list with the first dimension
  // outermost, matching the interpreter (and `Table`, which canonicalizes
  // to `Tabulate` or to `Map` over `Range`). The function and the dimensions
  // are hoisted into IIFE parameters so each is evaluated once (an impure
  // dimension must not be re-evaluated per row), and a *dynamic* dimension is
  // normalized at runtime like the interpreter's `toInteger`: rounded to the
  // nearest integer and clamped to ≥ 0 (a NaN dimension yields an empty list).
  // A *statically* non-positive dimension (a literal ≤ 0) is inert in the
  // interpreter (it stays symbolic, e.g. `Tabulate(f, 0)`), so it fails closed
  // (D6) here rather than compiling to `[]` behind `success: true` — mirroring
  // the `Range`/`Table` step-0 precedent.
  Tabulate: (args, compile) => {
    if (args[0] == null || args[1] == null)
      throw new Error('Tabulate: missing argument');
    if (args.length > 3)
      throw new Error(
        `Tabulate: only the 1-D and 2-D forms compile. Fail closed (D6).`
      );
    for (let i = 1; i < args.length; i++) {
      const dim = tryGetConstant(args[i]!);
      if (dim !== undefined && Math.round(dim) <= 0)
        throw new Error(
          `Tabulate: a statically non-positive dimension (${dim}) is inert ` +
            `in the interpreter. Fail closed (D6).`
        );
    }
    // The emitted lowering passes 1-based integer indexes, so an annotated
    // index parameter is admitted exactly when `integer` satisfies it.
    BaseCompiler.assertCallbackAnnotations('Tabulate', args[0], [
      'integer',
      'integer',
    ]);
    const f = compile(args[0]);
    const n = compile(args[1]);
    if (args.length === 2)
      return `((_f, _n) => Array.from({ length: Math.max(0, Math.round(_n)) }, (_, _i) => _f(_i + 1)))(${f}, ${n})`;
    const m = compile(args[2]);
    return `((_f, _n, _m) => Array.from({ length: Math.max(0, Math.round(_n)) }, (_, _i) => Array.from({ length: Math.max(0, Math.round(_m)) }, (_, _j) => _f(_i + 1, _j + 1))))(${f}, ${n}, ${m})`;
  },
  // `Fill(f, (rows, cols))` → rows×cols nested list of `f(i, j)` with
  // 1-based row/column indexes, matching the interpreter. Same hoisting and
  // dimension normalization as `Tabulate`.
  Fill: (args, compile) => {
    const dims = args[1];
    if (args[0] == null || dims == null)
      throw new Error('Fill: missing argument');
    if (!isFunction(dims) || dims.ops.length !== 2)
      throw new Error(
        `Fill: only the (function, (rows, cols)) form compiles. ` +
          `Fail closed (D6).`
      );
    BaseCompiler.assertCallbackAnnotations('Fill', args[0], [
      'integer',
      'integer',
    ]);
    const f = compile(args[0]);
    const rows = compile(dims.ops[0]);
    const cols = compile(dims.ops[1]);
    return `((_f, _r, _c) => Array.from({ length: Math.max(0, Math.round(_r)) }, (_, _i) => Array.from({ length: Math.max(0, Math.round(_c)) }, (_, _j) => _f(_i + 1, _j + 1))))(${f}, ${rows}, ${cols})`;
  },
  // `Repeat(x, n)` → a list of n copies of x. The VALUE is hoisted into an
  // IIFE parameter so it is evaluated exactly ONCE, matching the interpreter:
  // `Repeat(Random(), 3)` is three copies of a SINGLE draw, and the draw
  // happens even when the count is ≤ 0. Splicing the compiled value into a
  // per-element callback instead would re-draw an impure operand once per
  // element.
  // The count is normalized like `Tabulate`'s dimension — rounded, and a
  // non-positive one yields [] (unlike `Tabulate`, `Repeat(x, 0)` is NOT
  // inert in the interpreter: it evaluates to []).
  // A *statically* non-finite count (a `±∞` literal, or an operand typed
  // `non_finite_number`) is inert in the interpreter (`toInteger` answers
  // null), so it fails closed (D6) rather than compiling to `[]` behind
  // `success: true`. A *dynamic* count that is non-finite only at run time
  // still projects to [] — the Chunk/RotateLeft precedent, and the
  // documented divergence: the interpreter stays inert there while the
  // compiled form yields [] rather than attempting an unbounded allocation.
  // The 1-argument form is an INFINITE lazy sequence with no compiled
  // representation, and a statically non-integer count is a type error in the
  // interpreter — both fail closed (D6).
  Repeat: (args, compile) => {
    if (args[0] == null) throw new Error('Repeat: missing value');
    if (args.length !== 2)
      throw new Error(
        `Repeat: only the (value, count) form compiles — the 1-argument ` +
          `form is an infinite sequence. Fail closed (D6).`
      );
    if (isNonFiniteBound(args[1]!))
      throw new Error(
        `Repeat: a statically non-finite count (${args[1]!.toString()}) is ` +
          `inert in the interpreter. Fail closed (D6).`
      );
    const nConst = tryGetConstant(args[1]!);
    if (nConst !== undefined && !Number.isInteger(nConst))
      throw new Error(
        `Repeat: a non-integer count (${nConst}) is a type error in the ` +
          `interpreter. Fail closed (D6).`
      );
    return `((_v, _n) => { _n = Math.round(_n); if (!(Number.isFinite(_n) && _n > 0)) return []; return Array.from({ length: _n }, () => _v); })(${compile(args[0])}, ${compile(args[1]!)})`;
  },
  // Add one or more elements at the end. `Append` is variadic
  // (`docs/plans/2026-08-09-lazy-collection-evaluate-design.md`, Change 2):
  // every trailing operand becomes one element, in order.
  Append: (args, compile) => {
    const coll = collArg('Append', args[0], compile);
    // No trailing values: the 1-ary identity form (valid in non-strict mode).
    // Emit the spread with zero appended values rather than throwing, which
    // would silently fall back to the interpreter.
    const values = args.slice(1).map((a) => compile(a));
    return `[...(${coll})${values.map((v) => `, ${v}`).join('')}]`;
  },
  // All but the last element; an empty or singleton collection yields [].
  Most: (args, compile) =>
    `(${collArg('Most', args[0], compile)}).slice(0, -1)`,
  // 1-based inclusive range. Mirrors the interpreter's Slice collection
  // handler exactly: indexes are rounded (`toInteger`); a start/end < 1 is
  // counted from the end (so a start of 0 resolves PAST the end → empty);
  // start past the end → empty; end clamped to [1, len].
  Slice: (args, compile) => {
    const coll = collArg('Slice', args[0], compile);
    if (args[1] == null || args[2] == null)
      throw new Error('Slice: missing index');
    return `((_l, _s, _e) => { _s = Math.round(_s); if (!Number.isFinite(_s)) _s = 1; _e = Math.round(_e); if (!Number.isFinite(_e)) _e = _l.length; if (_s < 1) _s = _l.length + 1 + _s; if (_s < 1) _s = 1; if (_s > _l.length) return []; if (_e < 1) _e = _l.length + 1 + _e; if (_e < 1) _e = 1; if (_e > _l.length) _e = _l.length; return _l.slice(_s - 1, _e); })(${coll}, ${compile(args[1])}, ${compile(args[2])})`;
  },
  IsEmpty: (args, compile) =>
    `((${collArg('IsEmpty', args[0], compile)}).length === 0)`,
  // Number of elements — same as `Length` for an indexed collection.
  Count: (args, compile) => `(${collArg('Count', args[0], compile)}).length`,
  // Membership via SameValueZero (`includes`) — value equality only for
  // primitive elements, so compound element types fail closed.
  Contains: (args, compile) => {
    if (args[0]) requirePrimitiveElements('Contains', args[0]);
    const coll = collArg('Contains', args[0], compile);
    if (args[1] == null) throw new Error('Contains: missing value');
    return `(${coll}).includes(${compile(args[1])})`;
  },
  // Unique elements in first-occurrence order (`Set` preserves insertion
  // order and uses SameValueZero — value equality only for primitive
  // elements, so compound element types fail closed).
  Unique: (args, compile) => {
    if (args[0]) requirePrimitiveElements('Unique', args[0]);
    return `[...new Set(${collArg('Unique', args[0], compile)})]`;
  },
  // Rotate left/right by n positions (default 1). The shift is rounded and
  // normalized modulo the length, matching the interpreter; a non-finite
  // shift falls back to the default 1 (the interpreter's `toInteger` treats
  // it as missing); an empty collection yields [].
  RotateLeft: (args, compile) => {
    const coll = collArg('RotateLeft', args[0], compile);
    const n = args[1] == null ? '1' : compile(args[1]);
    return `((_l, _n) => { if (_l.length === 0) return []; _n = Math.round(_n); if (!Number.isFinite(_n)) _n = 1; _n = ((_n % _l.length) + _l.length) % _l.length; return [..._l.slice(_n), ..._l.slice(0, _n)]; })(${coll}, ${n})`;
  },
  RotateRight: (args, compile) => {
    const coll = collArg('RotateRight', args[0], compile);
    const n = args[1] == null ? '1' : compile(args[1]);
    return `((_l, _n) => { if (_l.length === 0) return []; _n = Math.round(_n); if (!Number.isFinite(_n)) _n = 1; _n = ((-_n % _l.length) + _l.length) % _l.length; return [..._l.slice(_n), ..._l.slice(0, _n)]; })(${coll}, ${n})`;
  },
  // Element-wise combination: a list of tuples (compiled as arrays), with
  // the length of the shortest input.
  Zip: (args, compile) => {
    if (args.length === 0) return '[]';
    const colls = args.map((a, i) => collArg('Zip', a, compile, i + 1));
    return `((..._ls) => Array.from({ length: Math.min(..._ls.map((_l) => _l.length)) }, (_, _i) => _ls.map((_l) => _l[_i])))(${colls.join(', ')})`;
  },
  // Evenly spaced numbers, both endpoints included. Defaults mirror the
  // interpreter: `Linspace(end)` → start 1; count defaults to 50 — also for
  // a non-finite runtime count, like the interpreter — and is floored (not
  // rounded) and clamped to ≥ 0; a count of 1 yields [start].
  Linspace: (args, compile) => {
    if (args[0] == null) throw new Error('Linspace: missing argument');
    const start = args[1] == null ? '1' : compile(args[0]);
    const end = args[1] == null ? compile(args[0]) : compile(args[1]);
    const count = args[2] == null ? '50' : compile(args[2]);
    return `((_s, _e, _c) => { _c = Math.floor(_c); if (!Number.isFinite(_c)) _c = 50; _c = Math.max(0, _c); if (_c === 1) return [_s]; return Array.from({ length: _c }, (_, _i) => _s + ((_e - _s) * _i) / (_c - 1)); })(${start}, ${end}, ${count})`;
  },
  // Split into k chunks of ceil(len/k) elements — mirroring the interpreter
  // exactly, including k > len producing trailing empty chunks. A statically
  // invalid k (literal ≤ 0) is inert in the interpreter, so it fails closed
  // (D6) at compile time; a *dynamic* k that is non-positive or non-finite
  // at runtime projects to [].
  Chunk: (args, compile) => {
    const coll = collArg('Chunk', args[0], compile);
    if (args[1] == null) throw new Error('Chunk: missing count');
    const kConst = tryGetConstant(args[1]);
    if (kConst !== undefined && !(Math.round(kConst) > 0))
      throw new Error(
        `Chunk: a statically non-positive chunk count (${kConst}) is inert ` +
          `in the interpreter. Fail closed (D6).`
      );
    return `((_l, _k) => { _k = Math.round(_k); if (!(Number.isFinite(_k) && _k > 0)) return []; const _sz = Math.ceil(_l.length / _k); return Array.from({ length: _k }, (_, _i) => _l.slice(_i * _sz, (_i + 1) * _sz)); })(${coll}, ${compile(args[1])})`;
  },
  // Integer form yields chunks of SIZE n (trailing chunk may be shorter);
  // with a step, complete sliding windows only — mirroring the interpreter.
  // The predicate form yields [[matching], [non-matching]]. The predicate is
  // hoisted and called unary, like the other higher-order operators.
  Partition: (args, compile) => {
    const coll = collArg('Partition', args[0], compile);
    const arg = args[1];
    if (arg == null) throw new Error('Partition: missing operand');
    if (arg.type.matches('number')) {
      const nConst = tryGetConstant(arg);
      if (nConst !== undefined && !(Math.round(nConst) > 0))
        throw new Error(
          `Partition: a statically non-positive chunk size (${nConst}) is ` +
            `inert in the interpreter. Fail closed (D6).`
        );
      const step = args[2];
      if (step !== undefined) {
        const stepConst = tryGetConstant(step);
        if (stepConst !== undefined && !(Math.round(stepConst) > 0))
          throw new Error(
            `Partition: a statically non-positive step (${stepConst}) is ` +
              `inert in the interpreter. Fail closed (D6).`
          );
        return `((_l, _n, _s) => { _n = Math.round(_n); _s = Math.round(_s); if (!(Number.isFinite(_n) && _n > 0 && Number.isFinite(_s) && _s > 0)) return []; const _r = []; for (let _i = 0; _i + _n <= _l.length; _i += _s) _r.push(_l.slice(_i, _i + _n)); return _r; })(${coll}, ${compile(arg)}, ${compile(step)})`;
      }
      return `((_l, _n) => { _n = Math.round(_n); if (!(Number.isFinite(_n) && _n > 0)) return []; const _r = []; for (let _i = 0; _i < _l.length; _i += _n) _r.push(_l.slice(_i, _i + _n)); return _r; })(${coll}, ${compile(arg)})`;
    }
    if (
      isFunction(arg, 'Function') ||
      (isSymbol(arg) &&
        BaseCompiler.userFunctionLiteral(arg.engine, arg.symbol) !== undefined)
    )
      return `((_f, _l) => { const _t = [], _u = []; for (const _x of _l) (_f(_x) ? _t : _u).push(_x); return [_t, _u]; })(${fnArg('Partition', arg, args[0], compile)}, ${coll})`;
    throw new Error(
      `Partition: the second operand must be an integer or a function ` +
        `literal. Fail closed (D6).`
    );
  },
  // 1-based indexes that sort the collection ascending; ties keep their
  // original order (native sort is stable, matching the interpreter). A
  // custom ordering function does not compile, matching `Sort`.
  Ordering: (args, compile) => {
    const coll = collArg('Ordering', args[0], compile);
    if (args.length > 1)
      throw new Error(
        `Ordering: a custom ordering function does not compile; only the ` +
          `default ascending numeric order is supported. Fail closed (D6).`
      );
    return `((_l) => Array.from({ length: _l.length }, (_, _i) => _i + 1).sort((_a, _b) => _l[_a - 1] - _l[_b - 1]))(${coll})`;
  },
  // Unbiased Fisher–Yates shuffle on a copy (`_SYS.shuffle`), consuming its
  // `n − 1` draws through the frame-aware `_SYS.drawNextRandomNumber()` in the
  // same order as the interpreter (`library/collections.ts`), so a framed
  // shuffle replays and leaves the frame's counter where the interpreter does.
  // A permutation needs every element, so materializing the source is inherent
  // here (it is in the interpreter too) — unlike the sampling operators, whose
  // domains stay descriptors.
  RandomShuffle: (args, compile) => {
    const coll = collArg('RandomShuffle', args[0], compile);
    if (args.length > 1)
      throw new Error(
        `RandomShuffle: expected exactly one argument. Fail closed (D6).`
      );
    return `_SYS.shuffle(${coll})`;
  },
  // True if the predicate holds for at least one / every element (vacuously
  // False / True on an empty collection, like `.some`/`.every`). Only the
  // predicate form compiles: without a predicate the elements must be
  // booleans, which a numeric collection cannot prove — the interpreter
  // stays inert there.
  Any: (args, compile) => {
    const coll = collArg('Any', args[0], compile);
    if (args[1] == null)
      throw new Error(
        `Any: only the predicate form compiles. Fail closed (D6).`
      );
    return `((_f) => (${coll}).some((_x) => _f(_x)))(${fnArg('Any', args[1], args[0], compile)})`;
  },
  All: (args, compile) => {
    const coll = collArg('All', args[0], compile);
    if (args[1] == null)
      throw new Error(
        `All: only the predicate form compiles. Fail closed (D6).`
      );
    return `((_f) => (${coll}).every((_x) => _f(_x)))(${fnArg('All', args[1], args[0], compile)})`;
  },
  // Longest prefix satisfying the predicate / the rest after that prefix.
  TakeWhile: (args, compile) => {
    if (args[1] == null) throw new Error('TakeWhile: missing predicate');
    // A statically infinite operand compiles as a lazy stream, scanned until
    // the predicate first fails (see `takeWhileIter` for the
    // never-false-predicate caveat).
    if (isLazyStream(args[0]))
      return `_SYS.takeWhileIter(${emitLazyStream(args[0]!, compile)}, ${fnArg('TakeWhile', args[1], args[0], compile)})`;
    const coll = collArg('TakeWhile', args[0], compile);
    return `((_f, _l) => { const _i = _l.findIndex((_x) => !_f(_x)); return _i < 0 ? _l.slice() : _l.slice(0, _i); })(${fnArg('TakeWhile', args[1], args[0], compile)}, ${coll})`;
  },
  DropWhile: (args, compile) => {
    const coll = collArg('DropWhile', args[0], compile);
    if (args[1] == null) throw new Error('DropWhile: missing predicate');
    return `((_f, _l) => { const _i = _l.findIndex((_x) => !_f(_x)); return _i < 0 ? [] : _l.slice(_i); })(${fnArg('DropWhile', args[1], args[0], compile)}, ${coll})`;
  },
  // Map + flatten one level. Native `flatMap` matches the interpreter for
  // both shapes: a collection-valued mapping is spliced, a scalar result is
  // kept as-is.
  FlatMap: (args, compile) => {
    const coll = collArg('FlatMap', args[0], compile);
    if (args[1] == null) throw new Error('FlatMap: missing mapping function');
    return `((_f) => (${coll}).flatMap((_x) => _f(_x)))(${fnArg('FlatMap', args[1], args[0], compile)})`;
  },
  // Running fold: the accumulator AFTER each element; the initial value is
  // not emitted. Without an initial value the first element seeds the
  // accumulator and is emitted as-is — unlike `Reduce`, both interpreter
  // forms are deterministic, so both compile.
  Scan: (args, compile, target) => {
    const coll = args[0];
    const op = args[1];
    const init = args[2];
    if (coll == null || op == null) throw new Error('Scan: missing argument');
    if (!isIndexedCollectionOperand(coll))
      throw new Error(
        `Scan: cannot compile — first operand is not an indexed collection ` +
          `(list/vector/range). Fail closed (D6).`
      );
    const builtin = builtinCombiner(op);
    // As `Reduce`: the combiner is `(accumulator, element)` and only the
    // element's type is provable, so an annotated accumulator declines.
    if (builtin === undefined)
      BaseCompiler.assertCallbackAnnotations('Scan', op, [
        undefined,
        BaseCompiler.collectionElementTypeOf(coll),
      ]);
    const combiner =
      builtin ??
      (isFunction(op, 'Function') || isSymbol(op)
        ? customCombiner(op, compile, target)
        : undefined);
    if (combiner === undefined)
      throw new Error(
        `Scan: the combiner does not compile to a function — only ` +
          `Add/Multiply/Min/Max folds, function literals, and user-defined ` +
          `functions compile on the JavaScript target. Fail closed (D6).`
      );
    const collCode = compile(coll);
    if (init !== undefined && init !== null)
      return `((_f, _l, _a) => _l.map((_x) => (_a = _f(_a, _x))))(${combiner}, ${collCode}, ${compile(init)})`;
    return `((_f, _l) => { let _a; return _l.map((_x, _i) => (_a = _i === 0 ? _x : _f(_a, _x))); })(${combiner}, ${collCode})`;
  },
  // --- Core scalar operators ---------------------------------------------
  // Iverson bracket: 1 if the boolean argument is true, 0 if false. A
  // provably-boolean condition compiles bare; otherwise the `_SYS.cond`
  // guard rethrows on a non-boolean at runtime (the interpreter stays
  // symbolic for an undetermined predicate — no numeric equivalent).
  Boole: (args, compile) => {
    if (args[0] == null) throw new Error('Boole: missing argument');
    const c = compile(args[0]);
    if (BaseCompiler.isBooleanValued(args[0])) return `((${c}) ? 1 : 0)`;
    return `(_SYS.cond(${c}) ? 1 : 0)`;
  },
  // δ: 1 when all arguments are equal — a single argument compares to 0 —
  // else 0, using the same tolerance as compiled `Equal`. Arguments are
  // hoisted into IIFE parameters so each is evaluated once.
  KroneckerDelta: (args, compile) => {
    if (args.length === 0 || args[0] == null)
      throw new Error('KroneckerDelta: missing argument');
    const tol = args[0].engine.tolerance ?? 1e-10;
    if (args.length === 1)
      return `(Math.abs(${compile(args[0])}) <= ${tol} ? 1 : 0)`;
    return `((..._v) => _v.every((_x) => Math.abs(_x - _v[0]) <= ${tol}) ? 1 : 0)(${args.map((a) => compile(a)).join(', ')})`;
  },
  // Membership of a value in an indexed collection — `Contains` with the
  // operands flipped. Same primitive-element restriction; a domain (e.g.
  // `Element(x, Integers)`) is not an indexed collection and fails closed.
  Element: (args, compile) => {
    if (args[0] == null || args[1] == null)
      throw new Error('Element: missing argument');
    requirePrimitiveElements('Element', args[1]);
    const coll = collArg('Element', args[1], compile);
    return `(${coll}).includes(${compile(args[0])})`;
  },
  Identity: (args, compile) => {
    if (args[0] == null) throw new Error('Identity: missing argument');
    return compile(args[0]);
  },
  // Apply a function literal to arguments. (`Apply` with a *symbol* head
  // canonicalizes to a direct call, so only the function-literal form
  // reaches this handler.)
  Apply: (args, compile) => {
    if (args[0] == null) throw new Error('Apply: missing function');
    return `(${compile(args[0])})(${args
      .slice(1)
      .map((a) => compile(a))
      .join(', ')})`;
  },
  // --- Linear algebra ------------------------------------------------------
  // `Dot` and `MatrixMultiply` share the interpreter's dimensionality
  // dispatch: vector·vector → scalar, matrix·vector / vector·matrix →
  // vector, matrix·matrix → matrix. Dimension mismatches yield NaN.
  Dot: (args, compile) => {
    if (args[0] == null || args[1] == null)
      throw new Error('Dot: missing argument');
    return `_SYS.matmul(${collArg('Dot', args[0], compile, 1)}, ${collArg('Dot', args[1], compile, 2)})`;
  },
  MatrixMultiply: (args, compile) => {
    if (args[0] == null || args[1] == null)
      throw new Error('MatrixMultiply: missing argument');
    return `_SYS.matmul(${collArg('MatrixMultiply', args[0], compile, 1)}, ${collArg('MatrixMultiply', args[1], compile, 2)})`;
  },
  Cross: (args, compile) => {
    if (args[0] == null || args[1] == null)
      throw new Error('Cross: missing argument');
    return `_SYS.cross(${collArg('Cross', args[0], compile, 1)}, ${collArg('Cross', args[1], compile, 2)})`;
  },
  // Norm accepts a scalar (absolute value) or a collection: 2-norm /
  // Frobenius by default, vector p-norm or matrix 1-/∞-operator norm with a
  // numeric second operand (`"Frobenius"` is the default; any other named
  // norm fails closed).
  Norm: (args, compile) => {
    if (args[0] == null) throw new Error('Norm: missing argument');
    // A point with a broadcasting (non-tuple collection) component zips into
    // one norm per element at evaluation; `_SYS.norm` would flatten it into a
    // single scalar that silently disagrees with the interpreter and with the
    // declared `list<number>` type. Fail closed (D6) so the engine falls back
    // to interpretation, which broadcasts correctly.
    if (pointHasBroadcastComponent(args[0]))
      throw new Error(
        'Norm: cannot compile a point with a broadcasting component. ' +
          'Fail closed (D6).'
      );
    // A LIST of points: one norm per point, matching the interpreter (a point
    // binds atomically, so `_SYS.norm` — which FLATTENS — would return a
    // single scalar behind `success: true`). Tycho item 138. A list of numeric
    // LISTS is a matrix and keeps the Frobenius/operator norms below.
    if (isPointListOperand(args[0])) {
      let ord = '';
      if (args[1] != null) {
        if (isString(args[1])) {
          if (args[1].string !== 'Frobenius')
            throw new Error(
              `Norm: the "${args[1].string}" norm does not compile. ` +
                `Fail closed (D6).`
            );
        } else ord = `, ${compile(args[1])}`;
      }
      return `(${compile(args[0])}).map((_pt) => _SYS.norm(_pt${ord}))`;
    }
    if (args[1] != null) {
      if (isString(args[1])) {
        if (args[1].string === 'Frobenius')
          return `_SYS.norm(${compile(args[0])})`;
        throw new Error(
          `Norm: the "${args[1].string}" norm does not compile. ` +
            `Fail closed (D6).`
        );
      }
      return `_SYS.norm(${compile(args[0])}, ${compile(args[1])})`;
    }
    return `_SYS.norm(${compile(args[0])})`;
  },
  // Explicit axis operands (rank > 2 tensor forms) do not compile.
  Transpose: (args, compile) => {
    if (args.length > 1)
      throw new Error(
        `Transpose: explicit axes do not compile. Fail closed (D6).`
      );
    return `_SYS.transpose(${collArg('Transpose', args[0], compile)})`;
  },
  Determinant: (args, compile) =>
    `_SYS.det(${collArg('Determinant', args[0], compile)})`,
  // A singular matrix yields NaN (the interpreter stays inert — no numeric
  // equivalent on a real target).
  Inverse: (args, compile) =>
    `_SYS.inv(${collArg('Inverse', args[0], compile)})`,
  Trace: (args, compile) => {
    if (args.length > 1)
      throw new Error(`Trace: explicit axes do not compile. Fail closed (D6).`);
    return `_SYS.trace(${collArg('Trace', args[0], compile)})`;
  },
  // Transpose + element-wise complex conjugate. Explicit axes do not compile.
  ConjugateTranspose: (args, compile) => {
    if (args.length > 1)
      throw new Error(
        `ConjugateTranspose: explicit axes do not compile. Fail closed (D6).`
      );
    return `_SYS.conjTranspose(${collArg('ConjugateTranspose', args[0], compile)})`;
  },
  // Rank-dispatched: matrix → main-diagonal vector; vector → diagonal matrix.
  // The offset/multi-argument forms do not compile.
  Diagonal: (args, compile) => {
    if (args.length > 1)
      throw new Error(
        `Diagonal: the offset/banded form does not compile. Fail closed (D6).`
      );
    return `_SYS.diagonal(${collArg('Diagonal', args[0], compile)})`;
  },
  // Integer matrix power (`M^0` identity, negative → inverse). A non-integer
  // exponent or non-square matrix yields NaN at run time.
  MatrixPower: (args, compile) => {
    if (args[0] == null || args[1] == null)
      throw new Error('MatrixPower: missing argument');
    return `_SYS.matpow(${collArg('MatrixPower', args[0], compile)}, ${compile(
      args[1]
    )})`;
  },
  // Reduced row echelon form (Gauss–Jordan).
  RowReduce: (args, compile) =>
    `_SYS.rref(${collArg('RowReduce', args[0], compile)})`,
  // CE `Rank` is the TENSOR rank — the number of axes (scalar 0, vector 1,
  // matrix 2, …), NOT the linear-algebra (row) rank. It is the nesting depth of
  // the compiled value, so it lowers for any operand (a scalar gives 0).
  Rank: (args, compile) => {
    if (args[0] == null) throw new Error('Rank: missing argument');
    return `(_SYS.shape(${compile(args[0])}).length)`;
  },
  Shape: (args, compile) => {
    if (args[0] == null) throw new Error('Shape: missing argument');
    return `_SYS.shape(${compile(args[0])})`;
  },
  // Flatten to a flat list (native `.flat`), or by an explicit number of
  // levels when a depth operand is given.
  Flatten: (args, compile) => {
    const coll = collArg('Flatten', args[0], compile);
    if (args[1] != null) return `(${coll}).flat(${compile(args[1])})`;
    return `(${coll}).flat(Infinity)`;
  },
  // Reshape with cyclic padding, matching the interpreter. Only the 1-D and
  // 2-D target shapes compile.
  Reshape: (args, compile) => {
    const coll = collArg('Reshape', args[0], compile);
    const dims = args[1];
    if (dims == null) throw new Error('Reshape: missing shape');
    if (!isFunction(dims) || dims.ops.length === 0 || dims.ops.length > 2)
      throw new Error(
        `Reshape: only a 1-D or 2-D target shape compiles. Fail closed (D6).`
      );
    return `_SYS.reshape(${coll}, [${dims.ops.map((d) => compile(d)).join(', ')}])`;
  },
  // `Log(x)` is base 10; `Log(x, b)` is base `b`. `Log2`/`Log10`/`Lb`
  // canonicalize into this head, so this is the only place they are lowered.
  Log: (args, compile, target) => {
    // Complex either because an operand is, or because the RESULT is complex
    // from a PROVABLY negative argument (`Log(-2)`, or `a := -2` making
    // `Log(a)` `finite_complex`). Either way the enclosing expression reads
    // `{re, im}`, so `Math.log10` — a `NaN` number — must not be the
    // lowering. An operand of merely UNKNOWN sign keeps the real kernel
    // (pinned; the `isComplexValued` Sqrt/Ln/Log carve-out makes the parent
    // agree on the real shape).
    if (
      args.some((a) => BaseCompiler.isComplexValued(a)) ||
      (args.some((a) => a.isNegative === true) &&
        resultIsComplexValued('Log', args))
    ) {
      const n = BaseCompiler.tempVar(target);
      const num = `const ${n} = _SYS.cln(${complexOperandCode(args[0], compile)});`;
      if (args.length === 1)
        return `(() => { ${num} return { re: ${n}.re / Math.LN10, im: ${n}.im / Math.LN10 }; })()`;
      // `ln(x) / ln(b)`, as a complex quotient: the base may itself be complex,
      // or real-but-negative (whose own `ln` is complex).
      const d = BaseCompiler.tempVar(target);
      const m = BaseCompiler.tempVar(target);
      return (
        `(() => { ${num} const ${d} = _SYS.cln(${complexOperandCode(args[1], compile)}); ` +
        `const ${m} = ${d}.re * ${d}.re + ${d}.im * ${d}.im; ` +
        `return { re: (${n}.re * ${d}.re + ${n}.im * ${d}.im) / ${m}, im: (${n}.im * ${d}.re - ${n}.re * ${d}.im) / ${m} }; })()`
      );
    }
    if (args.length === 1) return `Math.log10(${compile(args[0])})`;
    return `(Math.log(${compile(args[0])}) / Math.log(${compile(args[1])}))`;
  },
  GammaLn: '_SYS.lngamma',
  Lb: 'Math.log2',
  // Element-wise binary max/min and clamp. These are the scalar codegen; a
  // collection operand is handled by `tryCompileBroadcast` (they are
  // `broadcastable`), which wraps this body in `_SYS.bcast`.
  ElementMax: (args, compile) =>
    `Math.max(${args.map((x) => compile(x)).join(', ')})`,
  ElementMin: (args, compile) =>
    `Math.min(${args.map((x) => compile(x)).join(', ')})`,
  Clamp: (args, compile) =>
    `Math.min(Math.max(${compile(args[0])}, ${compile(args[1])}), ${compile(
      args[2]
    )})`,
  Max: (args, compile) => compileExtremum('Max', args, compile),
  Mean: (args, compile) => {
    if (args.length === 0) return 'NaN';
    if (args.length === 1) return `_SYS.mean(${compile(args[0])})`;
    return `_SYS.mean([${args.map((x) => compile(x)).join(', ')}])`;
  },
  Median: (args, compile) => {
    if (args.length === 0) return 'NaN';
    if (args.length === 1) return `_SYS.median(${compile(args[0])})`;
    return `_SYS.median([${args.map((x) => compile(x)).join(', ')}])`;
  },
  Variance: (args, compile) => {
    if (args.length === 0) return 'NaN';
    if (args.length === 1) return `_SYS.variance(${compile(args[0])})`;
    return `_SYS.variance([${args.map((x) => compile(x)).join(', ')}])`;
  },
  PopulationVariance: (args, compile) => {
    if (args.length === 0) return 'NaN';
    if (args.length === 1)
      return `_SYS.populationVariance(${compile(args[0])})`;
    return `_SYS.populationVariance([${args
      .map((x) => compile(x))
      .join(', ')}])`;
  },
  StandardDeviation: (args, compile) => {
    if (args.length === 0) return 'NaN';
    if (args.length === 1) return `_SYS.standardDeviation(${compile(args[0])})`;
    return `_SYS.standardDeviation([${args
      .map((x) => compile(x))
      .join(', ')}])`;
  },
  PopulationStandardDeviation: (args, compile) => {
    if (args.length === 0) return 'NaN';
    if (args.length === 1)
      return `_SYS.populationStandardDeviation(${compile(args[0])})`;
    return `_SYS.populationStandardDeviation([${args
      .map((x) => compile(x))
      .join(', ')}])`;
  },
  Kurtosis: (args, compile) => {
    if (args.length === 0) return 'NaN';
    if (args.length === 1) return `_SYS.kurtosis(${compile(args[0])})`;
    return `_SYS.kurtosis([${args.map((x) => compile(x)).join(', ')}])`;
  },
  Skewness: (args, compile) => {
    if (args.length === 0) return 'NaN';
    if (args.length === 1) return `_SYS.skewness(${compile(args[0])})`;
    return `_SYS.skewness([${args.map((x) => compile(x)).join(', ')}])`;
  },
  Mode: (args, compile) => {
    if (args.length === 0) return 'NaN';
    if (args.length === 1) return `_SYS.mode(${compile(args[0])})`;
    return `_SYS.mode([${args.map((x) => compile(x)).join(', ')}])`;
  },
  Quartiles: (args, compile) => {
    if (args.length === 0) return 'NaN';
    if (args.length === 1) return `_SYS.quartiles(${compile(args[0])})`;
    return `_SYS.quartiles([${args.map((x) => compile(x)).join(', ')}])`;
  },
  InterquartileRange: (args, compile) => {
    if (args.length === 0) return 'NaN';
    if (args.length === 1)
      return `_SYS.interquartileRange(${compile(args[0])})`;
    return `_SYS.interquartileRange([${args
      .map((x) => compile(x))
      .join(', ')}])`;
  },
  // Covariance/Correlation compile only for the two-collection form; the
  // one-collection-of-pairs form fails closed (per compile policy).
  Covariance: (args, compile) => {
    if (args.length !== 2)
      throw new Error(
        'Covariance: expected two collection arguments to compile'
      );
    return `_SYS.covariance(${compile(args[0])}, ${compile(args[1])})`;
  },
  PopulationCovariance: (args, compile) => {
    if (args.length !== 2)
      throw new Error(
        'PopulationCovariance: expected two collection arguments to compile'
      );
    return `_SYS.populationCovariance(${compile(args[0])}, ${compile(args[1])})`;
  },
  Correlation: (args, compile) => {
    if (args.length !== 2)
      throw new Error(
        'Correlation: expected two collection arguments to compile'
      );
    return `_SYS.correlation(${compile(args[0])}, ${compile(args[1])})`;
  },
  Min: (args, compile) => compileExtremum('Min', args, compile),
  Power: (args, compile, target) => {
    const base = args[0];
    const exp = args[1];
    if (base === null) throw new Error('Power: no argument');
    if (
      BaseCompiler.isComplexValued(base) ||
      BaseCompiler.isComplexValued(exp)
    ) {
      // Small literal integer power of a complex base: inline a
      // square-and-multiply chain instead of the polar-form `_SYS.cpow` — an
      // order of magnitude faster in iterated-map loops. The square is
      // digit-exact with the interpreter (which multiplies); for exponents
      // ≥ 3 the interpreter itself goes through transcendental pow, so both
      // routes differ by ~1 ulp and the multiply chain loses nothing.
      // The base is always bound once: even a symbol may be `vars`-mapped to
      // arbitrary target source, and `cpow` evaluated it exactly once. The
      // squared imaginary term is `2 * (re·im)` — `(2·re)·im` would overflow
      // the intermediate for |re| > MAX_VALUE/2 where the multiply order
      // doesn't.
      const eInt = tryGetConstant(exp);
      if (
        BaseCompiler.isComplexValued(base) &&
        eInt !== undefined &&
        Number.isInteger(eInt) &&
        eInt >= 2 &&
        eInt <= 8
      ) {
        const t = BaseCompiler.tempVar(target);
        const stmts: string[] = [`const ${t} = ${compile(base)};`];
        let n = 0;
        const sq = (src: string): string => {
          const v = `${t}_${++n}`;
          stmts.push(
            `const ${v} = { re: ${src}.re * ${src}.re - ${src}.im * ${src}.im, im: 2 * (${src}.re * ${src}.im) };`
          );
          return v;
        };
        const mulBase = (a: string): string => {
          const v = `${t}_${++n}`;
          stmts.push(
            `const ${v} = { re: ${a}.re * ${t}.re - ${a}.im * ${t}.im, im: ${a}.re * ${t}.im + ${a}.im * ${t}.re };`
          );
          return v;
        };
        const pow = (k: number): string =>
          k === 1 ? t : k % 2 === 0 ? sq(pow(k / 2)) : mulBase(pow(k - 1));
        const result = pow(eInt);
        return `(() => { ${stmts.join(' ')} return ${result}; })()`;
      }
      return `_SYS.cpow(${compile(base)}, ${compile(exp)})`;
    }
    const bConst = tryGetConstant(base);
    const eConst = tryGetConstant(exp);
    if (bConst !== undefined && eConst !== undefined) {
      const r = Math.pow(bConst, eConst);
      // `Math.pow` is NaN for every negative base with a non-integer exponent —
      // narrower than CE's branch convention. WHICH value is folded is decided
      // by the node's TYPE (see `NO_REAL_VALUE_FOLD`): an even
      // reduced-rational denominator is the complex branch and the node is
      // typed `finite_complex`, so it folds to the principal complex value; an
      // ODD denominator has a real root (`(−8)^(2/3) = 4`) that `Math.pow`
      // misses; anything unprovable keeps the `NaN` fold.
      if (Number.isNaN(r)) {
        if (resultIsComplexValued('Power', args))
          return complexPowLiteral(bConst, eConst);
        const real = negativeBaseRealPow(bConst, exp, eConst);
        if (real !== undefined) return String(real);
        return NO_REAL_VALUE_FOLD;
      }
      return String(r);
    }
    // The operands are real-emitted but the RESULT is typed complex (a
    // negative base on the even-denominator branch, e.g. `a^{0.3}` with
    // `a ⩴ -2`). The enclosing expression reads `{re, im}` off this node, so
    // the real `Math.pow` lowering — a `NaN` *number* — would NaN-poison it.
    // See `resultIsComplexValued`.
    if (resultIsComplexValued('Power', args))
      return `_SYS.cpow(${complexOperandCode(base, compile)}, ${complexOperandCode(exp, compile)})`;
    if (eConst === 0) return '1';
    if (eConst === 1) return compile(base);
    if (eConst === 2 && (isSymbol(base) || isNumber(base))) {
      const code = compile(base);
      return `(${code} * ${code})`;
    }
    if (eConst === -1) return `(1 / (${compile(base)}))`;
    if (eConst === 0.5) return `Math.sqrt(${compile(base)})`;
    if (eConst === 1 / 3) return `Math.cbrt(${compile(base)})`;
    if (eConst === -0.5) return `(1 / Math.sqrt(${compile(base)}))`;
    // Constant nonzero exponent: `Math.pow` matches the interpreter (0^k = 0
    // for k > 0, etc.). A *variable* exponent could be 0 at run time against a
    // 0 base — a genuine 0^0 — where `Math.pow` yields 1 but the interpreter
    // yields NaN; route those through `_SYS.pow` to align (D6, CO-P2-24).
    if (eConst === undefined)
      return `_SYS.pow(${compile(base)}, ${compile(exp)})`;
    return `Math.pow(${compile(base)}, ${compile(exp)})`;
  },
  Range: (args, compile) => {
    if (args.length === 0) return '[]';
    // A non-finite bound never materializes to an array — historically this
    // emitted `Array.from({length: Infinity})`, which compiles cleanly and
    // throws a RangeError at run time. An infinite range compiles only as a
    // lazy stream under a bounding consumer (`Take`/`TakeWhile`, via
    // `emitLazyStream`, which never routes through this handler); reached
    // eagerly, it fails closed at compile time so the caller falls back to
    // the interpreter (the `Repeat` 1-argument precedent).
    if (args.some((a) => a != null && isNonFiniteBound(a)))
      throw new Error(
        `Range: a non-finite bound (\`${args.find((a) => a != null && isNonFiniteBound(a))!.toString()}\`) does not materialize — an infinite ` +
          `range compiles only under \`Take\`/\`TakeWhile\`. Fail closed (D6).`
      );
    // `Range(n)` is 1..n inclusive (matching the interpreter and the Python
    // target) — not 0..n-1. Canonicalization normally rewrites the
    // 1-argument form to `Range(1, n)`, so this branch is a rarely-reached
    // fallback for non-canonical input.
    if (args.length === 1)
      return `Array.from({length: ${compile(args[0])}}, (_e, i) => i + 1)`;

    let start = compile(args[0]);
    let stop = compile(args[1]);
    const step = args[2] ? compile(args[2]) : '1';
    if (start === null) throw new Error('Range: no start');
    if (stop === null) {
      stop = start;
      start = '1';
    }
    if (step === '0') throw new Error('Range: step cannot be zero');
    if (args[2] === undefined || args[2] === null) {
      // No explicit step: like the interpreter, the range auto-descends when
      // stop < start (`Range(5, 1)` → [5,4,3,2,1]); the implicit step is
      // ±1, never a fixed +1 (which silently compiled a descending range
      // to []).
      const fStop = parseFloat(stop);
      const fStart = parseFloat(start);

      // `parseFloat` returns NaN (never null) for symbolic bounds, so a
      // `!== null` guard would always pass and emit `Array.from({length: NaN})`
      // — silently yielding `[]` for any symbolic Range. Test for numeric
      // constants with `!isNaN`; symbolic bounds fall through to the runtime
      // length branch below.
      if (!isNaN(fStop) && !isNaN(fStart)) {
        const dir = fStop >= fStart ? 1 : -1;
        const len = Math.floor(Math.abs(fStop - fStart)) + 1;
        if (len < 50) {
          return `[${Array.from({ length: len }, (_, i) => fStart + dir * i).join(', ')}]`;
        }
        return `Array.from({length: ${len}}, (_e, i) => ${start} ${dir === 1 ? '+' : '-'} i)`;
      }

      // Symbolic bounds — the direction is resolved at runtime. The map
      // callback's throwaway element parameter must not be named `_`: the
      // compiled function binds its argument object to `_`, and a symbolic
      // bound compiles to a member access like `_.a`. A `_` callback param
      // would shadow the argument object, so `_.a` in the body would read
      // from the (undefined) array element. Use `_e` for the unused element.
      return `((_a, _b) => Array.from({length: Math.floor(Math.abs(_b - _a)) + 1}, (_e, _i) => _b >= _a ? _a + _i : _a - _i))(${start}, ${stop})`;
    }
    // An IMPURE operand (the Random family) must be evaluated exactly once:
    // `start` and `step` are each spliced twice, and the SECOND splice is
    // inside the `Array.from` callback — so a spliced draw is re-drawn once
    // per element, and the length is computed from a different value than the
    // elements (`Range(Random(), 10, 2)` consumed a draw for the length and
    // one more per element). Bind the three bounds to IIFE parameters (the
    // shape the symbolic 2-argument branch above uses); pure operands keep the
    // direct emission byte-identical.
    if (args.slice(0, 3).some((a) => a?.isPure === false))
      return `((_a, _b, _s) => Array.from({length: Math.floor((_b - _a) / _s) + 1}, (_e, _i) => _a + _i * _s))(${start}, ${stop}, ${step})`;
    return `Array.from({length: Math.floor((${stop} - ${start}) / ${step}) + 1}, (_e, i) => ${start} + i * ${step})`;
  },
  Root: ([arg, exp], compile, target) => {
    if (arg === null) throw new Error('Root: no argument');
    if (exp === null) return `Math.sqrt(${compile(arg)})`;
    const aConst = tryGetConstant(arg);
    const nConst = tryGetConstant(exp);
    if (aConst !== undefined && nConst !== undefined && nConst !== 0) {
      const r = Math.pow(aConst, 1 / nConst);
      if (Number.isNaN(r)) {
        // Negative base. WHICH value is folded is decided by the node's TYPE
        // — see `NO_REAL_VALUE_FOLD`. An ODD integer degree has a real root
        // (the interpreter's convention, e.g. Root(-8, 3) = -2) and stays
        // `finite_number`. An EVEN degree is the complex branch: as of the
        // 2026-07-30 ruling the node is typed `finite_complex`, so it folds to
        // the principal complex value the interpreter returns
        // (`Root(-8, 4)` → `1.1892… + 1.1892…i`) rather than to `NaN` — the
        // enclosing expression reads `{re, im}` off it. (A canonical even root
        // of a negative already folds to an exact complex literal before
        // compile: `√-4` → `2i`.)
        if (Number.isInteger(nConst) && nConst % 2 !== 0 && aConst < 0)
          return String(-Math.pow(-aConst, 1 / nConst));
        if (resultIsComplexValued('Root', [arg, exp]))
          return complexPowLiteral(aConst, 1 / nConst);
        return NO_REAL_VALUE_FOLD;
      }
      return String(r);
    }
    // Real-emitted operands but a complex RESULT type (an even degree over a
    // negative base, e.g. `\sqrt[4]{a}` with `a ⩴ -2`). The parent reads
    // `{re, im}` off this node. See `resultIsComplexValued`.
    if (resultIsComplexValued('Root', [arg, exp]))
      return `_SYS.cpow(${complexOperandCode(arg, compile)}, (1 / (${compile(exp)})))`;
    if (nConst === 2) return `Math.sqrt(${compile(arg)})`;
    if (nConst === 3) return `Math.cbrt(${compile(arg)})`;
    // Odd integer degree: `Math.pow` is NaN for a negative base, but the real
    // root exists. Emit the sign-corrected form `sign(x)·|x|^(1/n)`.
    if (nConst !== undefined && Number.isInteger(nConst) && nConst % 2 !== 0)
      return BaseCompiler.inlineExpression(
        target,
        `(Math.sign(\${x}) * Math.pow(Math.abs(\${x}), ${1 / nConst}))`,
        compile(arg)
      );
    if (nConst !== undefined) return `Math.pow(${compile(arg)}, ${1 / nConst})`;
    return `Math.pow(${compile(arg)}, 1 / (${compile(exp)}))`;
  },
  // EXACTLY ONE draw, for every domain kind.
  //
  // The draw is ALWAYS `_SYS.drawNextRandomNumber()` — one emission, no
  // compile-time framed/unframed branch. Whether a `WithRandomSeed` frame is
  // active is a CALL-time property (the same compiled function may later be
  // invoked from inside an interpreted frame), and the helper is what
  // branches. Emitting a bare `Math.random()` because no frame existed at
  // compile time would turn dynamic scope into lexical scope silently — see
  // `docs/plans/2026-07-25-random-signature-redesign.md` §4/§7.
  //
  // Domains lower to DESCRIPTORS, never to compiled collections: a literal
  // `Interval`/`Range` folds to inline closed-form arithmetic, and a symbolic
  // one builds a runtime descriptor. Compiling the domain as a collection
  // would route a `Range` through the JS `Range` handler, which materializes
  // via `Array.from` — a million-element allocation for one draw.
  Random: (args, compile) => {
    if (args.length === 0) return '_SYS.drawNextRandomNumber()';
    if (args.length !== 1)
      throw new Error(
        `Random: expected at most one domain operand. Fail closed (D6).`
      );
    const domain = args[0];

    // Literal `Interval(lo, hi)` → `lo + u·(hi − lo)`, endpoints inlined.
    if (isFunction(domain, 'Interval')) {
      const int = interval(domain);
      if (int !== undefined) {
        assertDrawableInterval('Random', int.start, int.end);
        return `(${int.start} + _SYS.drawNextRandomNumber() * ${int.end - int.start})`;
      }
    }

    // Literal `Range(…)` → `first + step·⌊u·n⌋` over the NORMALIZED
    // parameters, folded at compile time.
    if (isFunction(domain, 'Range')) {
      const p = literalRangeParams(domain);
      if (p !== undefined) {
        assertDrawableRange('Random', p.n);
        return `(${p.first} + ${p.step} * Math.floor(_SYS.drawNextRandomNumber() * ${p.n}))`;
      }
    }

    return `_SYS.randomPick(${randomDomain('Random', domain, compile, true)})`;
  },
  // `k` independent draws from a domain, WITH replacement. Exactly `k` draws,
  // in output order — the same order and count as the interpreter
  // (`library/core.ts`), so the frame's counter lands in the same place.
  RandomChoice: (args, compile) => {
    if (args.length !== 2)
      throw new Error(
        `RandomChoice: expected exactly two arguments. Fail closed (D6).`
      );
    const domain = randomDomain('RandomChoice', args[0], compile, true);
    return `_SYS.randomChoice(${domain}, ${compile(args[1])})`;
  },
  // `k` elements WITHOUT replacement, by the same sparse Fisher-Yates as the
  // interpreter (`library/statistics.ts`): `k` draws, one per step, in the
  // same order. The domain gate is `indexed_collection`, so an `Interval`
  // fails closed.
  RandomSample: (args, compile) => {
    if (args.length !== 2)
      throw new Error(
        `RandomSample: expected exactly two arguments. Fail closed (D6).`
      );
    const domain = randomDomain('RandomSample', args[0], compile, false);
    return `_SYS.randomSample(${domain}, ${compile(args[1])})`;
  },
  Round: (args, compile, target) => {
    // The interpreter rounds half away from zero (Round(-2.5) = -3); JS
    // `Math.round` rounds half toward +∞ (Round(-2.5) = -2). Reconstruct
    // half-away as `sign(x)·round(|x|)`.
    if (args.length < 2) {
      if (BaseCompiler.isIntegerValued(args[0])) return compile(args[0]);
      return BaseCompiler.inlineExpression(
        target,
        '(Math.sign(${x}) * Math.round(Math.abs(${x})))',
        compile(args[0])
      );
    }
    // Round(x, n) = Round(x·10ⁿ)/10ⁿ — round to `n` decimal places
    // (Desmos/spreadsheet form). Bind both operands once.
    const xv = BaseCompiler.tempVar(target);
    const fv = BaseCompiler.tempVar(target);
    return (
      `(() => { const ${fv} = Math.pow(10, ${compile(args[1])}); ` +
      `const ${xv} = ${compile(args[0])} * ${fv}; ` +
      `return (Math.sign(${xv}) * Math.round(Math.abs(${xv}))) / ${fv}; })()`
    );
  },
  Square: (args, compile) => {
    const arg = args[0];
    if (arg === null) throw new Error('Square: no argument');
    const c = tryGetConstant(arg);
    if (c !== undefined) return String(c * c);
    if (isSymbol(arg)) {
      const code = compile(arg);
      return `(${code} * ${code})`;
    }
    return `Math.pow(${compile(arg)}, 2)`;
  },
  Sec: (args, compile) => {
    const arg = args[0];
    if (arg === null) throw new Error('Sec: no argument');
    if (BaseCompiler.isComplexValued(arg)) return `_SYS.csec(${compile(arg)})`;
    return `1 / Math.cos(${compile(arg)})`;
  },
  Sech: (args, compile) => {
    const arg = args[0];
    if (arg === null) throw new Error('Sech: no argument');
    if (BaseCompiler.isComplexValued(arg)) return `_SYS.csech(${compile(arg)})`;
    return `1 / Math.cosh(${compile(arg)})`;
  },
  Second: (args, compile) => `${compile(args[0])}[1]`,
  Heaviside: '_SYS.heaviside',
  Sign: 'Math.sign',
  Sinc: '_SYS.sinc',
  FresnelS: '_SYS.fresnelS',
  FresnelC: '_SYS.fresnelC',
  Sin: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_SYS.csin(${compile(args[0])})`;
    return `Math.sin(${compile(args[0])})`;
  },
  Sinh: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_SYS.csinh(${compile(args[0])})`;
    return `Math.sinh(${compile(args[0])})`;
  },
  Sqrt: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_SYS.csqrt(${compile(args[0])})`;
    const c = tryGetConstant(args[0]);
    if (c !== undefined) {
      const r = Math.sqrt(c);
      // A negative constant has no real square root. `Sqrt(negative)` is typed
      // `complex`, so fold to the complex principal value the interpreter
      // returns (`√-2` → `1.414…i`) rather than decline; under `realOnly` the
      // runtime wrapper projects it to `NaN`. See `NO_REAL_VALUE_FOLD`.
      if (Number.isNaN(r)) return complexSqrtLiteral(c);
      return String(r);
    }
    // The operand is real-emitted but PROVABLY negative, so the result is
    // complex (`a := -2` → `Sqrt(a)` is `finite_complex`). The enclosing
    // expression reads `{re, im}` off this node, so `Math.sqrt` — which
    // yields a `NaN` *number* there — would NaN-poison it. An operand of
    // merely UNKNOWN sign keeps `Math.sqrt` (pinned; the `isComplexValued`
    // Sqrt/Ln/Log carve-out makes the parent agree on the real shape).
    if (args[0]?.isNegative === true && resultIsComplexValued('Sqrt', args))
      return `_SYS.csqrt(${complexOperandCode(args[0], compile)})`;
    return `Math.sqrt(${compile(args[0])})`;
  },
  Tan: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_SYS.ctan(${compile(args[0])})`;
    return `Math.tan(${compile(args[0])})`;
  },
  Tanh: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_SYS.ctanh(${compile(args[0])})`;
    return `Math.tanh(${compile(args[0])})`;
  },
  Third: (args, compile) => `${compile(args[0])}[2]`,
  PointX: (args, compile) => compilePointComponent(args[0], 0, compile),
  PointY: (args, compile) => compilePointComponent(args[0], 1, compile),
  PointZ: (args, compile) => compilePointComponent(args[0], 2, compile),
  // Reached only when the `PointList` definition handler declines — i.e. for
  // every shape but the all-scalar plain point (which it lowers itself,
  // byte-identically to `Tuple`). See `compileJSPointList`.
  PointList: (args, compile, target) =>
    compileJSPointList(args, compile, target),
  Mod: ([a, b], compile, target) => {
    if (a === null || b === null) throw new Error('Mod: missing argument');
    // An IMPURE operand (the Random family) must be evaluated exactly once:
    // the floored-modulo template splices `b` three times, so a spliced draw
    // re-draws at run time (`Mod(x, Random())` consumed three draws). Bind
    // both operands to temps, preserving the interpreter's a-then-b draw
    // order. Pure operands keep the direct emission byte-identical.
    const impure = a.isPure === false || b.isPure === false;
    const ta = impure ? BaseCompiler.tempVar(target) : '';
    const tb = impure ? BaseCompiler.tempVar(target) : '';
    // `compile()` emits sub-expressions without outer parentheses (`x + 29`),
    // and `%` binds tighter than `+` — wrap before splicing next to `%`.
    const ca = impure ? ta : `(${compile(a)})`;
    const cb = impure ? tb : `(${compile(b)})`;
    // For non-negative integers, plain % is correct Euclidean modulo
    const core =
      BaseCompiler.isIntegerValued(a) &&
      BaseCompiler.isIntegerValued(b) &&
      BaseCompiler.isNonNegative(a)
        ? `(${ca} % ${cb})`
        : `(((${ca} % ${cb}) + ${cb}) % ${cb})`;
    if (!impure) return core;
    return `(() => { const ${ta} = ${compile(a)}, ${tb} = ${compile(b)}; return ${core}; })()`;
  },
  Truncate: (args, compile) => {
    if (BaseCompiler.isIntegerValued(args[0])) return compile(args[0]);
    return `Math.trunc(${compile(args[0])})`;
  },
  Remainder: ([a, b], compile, target) => {
    if (a === null || b === null)
      throw new Error('Remainder: missing argument');
    // An IMPURE operand must be evaluated exactly once: both operands are
    // spliced twice by the template, so a spliced draw re-draws at run time
    // (`Remainder(Random(), 2)` consumed two draws). Bind to temps; pure
    // operands keep the direct emission byte-identical (see `Mod`).
    if (a.isPure === false || b.isPure === false) {
      const ta = BaseCompiler.tempVar(target);
      const tb = BaseCompiler.tempVar(target);
      return `(() => { const ${ta} = ${compile(a)}, ${tb} = ${compile(b)}; return (${ta} - ${tb} * Math.round(${ta} / ${tb})); })()`;
    }
    // `compile()` emits sub-expressions without outer parentheses, and
    // `*`/`/` bind tighter than `+` — wrap before splicing.
    const ca = `(${compile(a)})`;
    const cb = `(${compile(b)})`;
    return `(${ca} - ${cb} * Math.round(${ca} / ${cb}))`;
  },

  // No Subtract function handler — Subtract canonicalizes to Add+Negate.
  // The operator entry in JAVASCRIPT_OPERATORS handles any edge cases.
  Divide: ([a, b], compile) => {
    if (a === null || b === null) throw new Error('Divide: missing argument');
    const ac = BaseCompiler.isComplexValued(a);
    const bc = BaseCompiler.isComplexValued(b);
    if (!ac && !bc) {
      const ca = tryGetConstant(a);
      const cb = tryGetConstant(b);
      if (ca !== undefined && cb !== undefined && cb !== 0)
        return String(ca / cb);
      if (cb === 1) return compile(a);
      // `compile()` emits sub-expressions without outer parentheses — wrap
      // before splicing next to `/`.
      return `((${compile(a)}) / (${compile(b)}))`;
    }

    if (ac && bc) {
      return `(() => { const _a = ${compile(a)}, _b = ${compile(
        b
      )}, _d = _b.re * _b.re + _b.im * _b.im; return { re: (_a.re * _b.re + _a.im * _b.im) / _d, im: (_a.im * _b.re - _a.re * _b.im) / _d }; })()`;
    }
    if (ac && !bc) {
      return `(() => { const _a = ${compile(a)}, _r = ${compile(
        b
      )}; return { re: _a.re / _r, im: _a.im / _r }; })()`;
    }
    return `(() => { const _r = ${compile(a)}, _b = ${compile(
      b
    )}, _d = _b.re * _b.re + _b.im * _b.im; return { re: _r * _b.re / _d, im: -_r * _b.im / _d }; })()`;
  },
  Negate: ([x], compile) => {
    if (x === null) throw new Error('Negate: no argument');
    if (!BaseCompiler.isComplexValued(x)) {
      const c = tryGetConstant(x);
      if (c !== undefined) return String(-c);
      return `(-(${compile(x)}))`;
    }
    return `_SYS.cneg(${compile(x)})`;
  },
  Multiply: (args, compile) => {
    if (args.length === 1) return compile(args[0]);
    const anyComplex = args.some((a) => BaseCompiler.isComplexValued(a));
    if (!anyComplex) {
      // Short-circuit on zero
      if (args.some((a) => tryGetConstant(a) === 0)) return '0';
      // Try full constant fold
      const constants = args.map(tryGetConstant);
      if (constants.every((c) => c !== undefined))
        return String(constants.reduce((a, b) => a! * b!, 1));
      // Filter out identity (1) operands
      const nonOne = args.filter((a) => tryGetConstant(a) !== 1);
      if (nonOne.length === 0) return '1';
      if (nonOne.length === 1) return compile(nonOne[0]);
      return `(${nonOne.map((x) => compile(x)).join(' * ')})`;
    }

    if (args.length === 2) {
      // Optimize: single IIFE for 2 operands
      const ac = BaseCompiler.isComplexValued(args[0]);
      const bc = BaseCompiler.isComplexValued(args[1]);
      const ca = compile(args[0]);
      const cb = compile(args[1]);

      if (ac && bc) {
        return `(() => { const _a = ${ca}, _b = ${cb}; return { re: _a.re * _b.re - _a.im * _b.im, im: _a.re * _b.im + _a.im * _b.re }; })()`;
      }
      if (ac && !bc) {
        return `(() => { const _a = ${ca}, _r = ${cb}; return { re: _a.re * _r, im: _a.im * _r }; })()`;
      }
      // !ac && bc
      return `(() => { const _r = ${ca}, _b = ${cb}; return { re: _r * _b.re, im: _r * _b.im }; })()`;
    }

    // 3+ operands: single IIFE, sequential accumulation
    const parts: string[] = [];
    const temps: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const t = `_v${i}`;
      temps.push(t);
      parts.push(`const ${t} = ${compile(args[i])}`);
    }

    // Accumulate with intermediate variables
    const firstIsComplex = BaseCompiler.isComplexValued(args[0]);
    parts.push(`let _re = ${firstIsComplex ? `${temps[0]}.re` : temps[0]}`);
    parts.push(`let _im = ${firstIsComplex ? `${temps[0]}.im` : '0'}`);

    for (let i = 1; i < args.length; i++) {
      const t = temps[i];
      const tIsComplex = BaseCompiler.isComplexValued(args[i]);
      const tRe = tIsComplex ? `${t}.re` : t;
      const tIm = tIsComplex ? `${t}.im` : '0';
      parts.push(`const _nre${i} = _re * ${tRe} - _im * ${tIm}`);
      parts.push(`const _nim${i} = _re * ${tIm} + _im * ${tRe}`);
      parts.push(`_re = _nre${i}`);
      parts.push(`_im = _nim${i}`);
    }

    return `(() => { ${parts.join('; ')}; return { re: _re, im: _im }; })()`;
  },

  // Factorial and double factorial
  Factorial: '_SYS.factorial',
  Factorial2: '_SYS.factorial2',

  // Additional logarithmic functions
  Exp2: ([x], compile) => {
    if (x === null) throw new Error('Exp2: no argument');
    return `Math.pow(2, ${compile(x)})`;
  },
  Log2: 'Math.log2',
  Log10: 'Math.log10',
  Lg: 'Math.log10',

  // Trigonometric
  Arctan2: 'Math.atan2',
  Hypot: 'Math.hypot',
  Degrees: ([x], compile) => {
    if (x === null) throw new Error('Degrees: no argument');
    return `(${compile(x)} * Math.PI / 180)`;
  },
  Haversine: ([x], compile, target) => {
    if (x === null) throw new Error('Haversine: no argument');
    return BaseCompiler.inlineExpression(
      target,
      '(1 - Math.cos(${x})) / 2',
      compile(x)
    );
  },
  InverseHaversine: ([x], compile) => {
    if (x === null) throw new Error('InverseHaversine: no argument');
    // Same complex discipline as the Arcsin family: hav⁻¹ = 2·arcsin(√z) is
    // complex outside [0, 1], and the node's TYPE (which the enclosing
    // expression's codegen reads) claims complex for an unconstrained real.
    if (BaseCompiler.isComplexValued(x)) return `_SYS.cinvhav(${compile(x)})`;
    if (resultIsComplexValued('InverseHaversine', [x]))
      return `_SYS.cinvhav(${complexOperandCode(x, compile)})`;
    return `(2 * Math.asin(Math.sqrt(${compile(x)})))`;
  },

  // Error functions
  Erf: '_SYS.erf',
  Erfc: '_SYS.erfc',
  ErfInv: '_SYS.erfInv',
  Erfi: '_SYS.erfi',

  // Special functions
  Beta: '_SYS.beta',
  // Regularized incomplete gamma/beta. Argument order matches the kernels
  // directly (GammaRegularized(a, z) = Q(a, z); BetaRegularized(x, a, b) =
  // I_x(a, b)), so a plain name mapping suffices.
  GammaRegularized: '_SYS.gammaQ',
  BetaRegularized: '_SYS.betaRegularized',
  Digamma: '_SYS.digamma',
  Trigamma: '_SYS.trigamma',
  PolyGamma: (args, compile) =>
    `_SYS.polygamma(${compile(args[0])}, ${compile(args[1])})`,
  Zeta: '_SYS.zeta',
  LambertW: '_SYS.lambertW',

  // Bessel functions
  BesselJ: (args, compile) =>
    `_SYS.besselJ(${compile(args[0])}, ${compile(args[1])})`,
  BesselY: (args, compile) =>
    `_SYS.besselY(${compile(args[0])}, ${compile(args[1])})`,
  BesselI: (args, compile) =>
    `_SYS.besselI(${compile(args[0])}, ${compile(args[1])})`,
  BesselK: (args, compile) =>
    `_SYS.besselK(${compile(args[0])}, ${compile(args[1])})`,

  // Airy functions
  AiryAi: '_SYS.airyAi',
  AiryBi: '_SYS.airyBi',
  AiryAiPrime: '_SYS.airyAiPrime',
  AiryBiPrime: '_SYS.airyBiPrime',

  // Exponential / trigonometric / logarithmic integrals. These are the closed
  // forms the antiderivative engine emits (e.g. ∫sin x/x dx = SinIntegral(x)),
  // so an "evaluate then compile" pipeline must be able to lower them.
  SinIntegral: '_SYS.sinIntegral',
  CosIntegral: '_SYS.cosIntegral',
  ExpIntegralEi: '_SYS.expIntegralEi',
  LogIntegral: '_SYS.logIntegral',

  // Arithmetic-geometric mean and elliptic integrals (parameter convention
  // m = k², as in the library). `AGM`, `EllipticE`, and `EllipticPi` are
  // arity-overloaded — the handlers mirror the library's evaluate dispatch.
  AGM: (args, compile) =>
    args.length === 1
      ? `_SYS.agm(1, ${compile(args[0])})`
      : `_SYS.agm(${compile(args[0])}, ${compile(args[1])})`,
  EllipticK: '_SYS.ellipticK',
  EllipticE: (args, compile) =>
    args.length === 2
      ? `_SYS.ellipticEIncomplete(${compile(args[0])}, ${compile(args[1])})`
      : `_SYS.ellipticE(${compile(args[0])})`,
  EllipticF: (args, compile) =>
    `_SYS.ellipticF(${compile(args[0])}, ${compile(args[1])})`,
  EllipticPi: (args, compile) =>
    args.length === 3
      ? `_SYS.ellipticPiIncomplete(${compile(args[0])}, ${compile(
          args[1]
        )}, ${compile(args[2])})`
      : `_SYS.ellipticPiComplete(${compile(args[0])}, ${compile(args[1])})`,

  // Hypergeometric functions.
  Hypergeometric2F1: (args, compile) =>
    `_SYS.hypergeometric2F1(${compile(args[0])}, ${compile(args[1])}, ${compile(
      args[2]
    )}, ${compile(args[3])})`,
  Hypergeometric1F1: (args, compile) =>
    `_SYS.hypergeometric1F1(${compile(args[0])}, ${compile(args[1])}, ${compile(
      args[2]
    )})`,

  // Combinatorics
  Mandelbrot: ([c, maxIter], compile) => {
    if (c === null || maxIter === null)
      throw new Error('Mandelbrot: missing arguments');
    return `_SYS.mandelbrot(${compile(c)}, ${compile(maxIter)})`;
  },
  Julia: ([z, c, maxIter], compile) => {
    if (z === null || c === null || maxIter === null)
      throw new Error('Julia: missing arguments');
    return `_SYS.julia(${compile(z)}, ${compile(c)}, ${compile(maxIter)})`;
  },

  Binomial: (args, compile) =>
    `_SYS.binomial(${compile(args[0])}, ${compile(args[1])})`,
  // Choose(n, k) is the binomial coefficient — same runtime helper.
  Choose: (args, compile) =>
    `_SYS.binomial(${compile(args[0])}, ${compile(args[1])})`,
  Fibonacci: '_SYS.fibonacci',

  // Complex-specific functions
  Real: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `(${compile(args[0])}).re`;
    return compile(args[0]);
  },
  Imaginary: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `(${compile(args[0])}).im`;
    return '0';
  },
  Argument: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_SYS.carg(${compile(args[0])})`;
    return `(${compile(args[0])} >= 0 ? 0 : Math.PI)`;
  },
  Conjugate: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_SYS.cconj(${compile(args[0])})`;
    return compile(args[0]);
  },

  // Color functions
  Color: ([color], compile) => {
    if (color === null) throw new Error('Color: no argument');
    return `_SYS.color(${compile(color)})`;
  },
  ColorToString: (args, compile) => {
    if (args.length === 0) throw new Error('ColorToString: no argument');
    if (args.length >= 2)
      return `_SYS.colorToString(${compile(args[0])}, ${compile(args[1])})`;
    return `_SYS.colorToString(${compile(args[0])})`;
  },
  ColorMix: (args, compile) => {
    if (args.length < 2) throw new Error('ColorMix: need two colors');
    if (args.length >= 3)
      return `_SYS.colorMix(${compile(args[0])}, ${compile(args[1])}, ${compile(
        args[2]
      )})`;
    return `_SYS.colorMix(${compile(args[0])}, ${compile(args[1])})`;
  },
  ColorContrast: ([bg, fg], compile) => {
    if (bg === null || fg === null)
      throw new Error('ColorContrast: need two colors');
    return `_SYS.colorContrast(${compile(bg)}, ${compile(fg)})`;
  },
  ContrastingColor: (args, compile) => {
    if (args.length === 0) throw new Error('ContrastingColor: no argument');
    if (args.length >= 3)
      return `_SYS.contrastingColor(${compile(args[0])}, ${compile(
        args[1]
      )}, ${compile(args[2])})`;
    return `_SYS.contrastingColor(${compile(args[0])})`;
  },
  ColorToColorspace: ([color, space], compile) => {
    if (color === null || space === null)
      throw new Error('ColorToColorspace: need color and space');
    return `_SYS.colorToColorspace(${compile(color)}, ${compile(space)})`;
  },
  ColorFromColorspace: ([components, space], compile) => {
    if (components === null || space === null)
      throw new Error('ColorFromColorspace: need components and space');
    return `_SYS.colorFromColorspace(${compile(components)}, ${compile(
      space
    )})`;
  },
  Colormap: (args, compile) => {
    if (args.length === 0) throw new Error('Colormap: no argument');
    if (args.length >= 2)
      return `_SYS.colormap(${compile(args[0])}, ${compile(args[1])})`;
    return `_SYS.colormap(${compile(args[0])})`;
  },

  // -----------------------------------------------------------------------
  // Color constructor heads. All compile to OKLCh arrays at runtime — the
  // canonical color representation in this target. The constructors take
  // their own colorspace's components and convert internally.
  // (Mirrors the GPU target's design: color values are vec3 OKLCh.)
  // -----------------------------------------------------------------------
  Rgb: (args, compile) => {
    if (args.length < 3) throw new Error('Rgb: need 3 components');
    return `_SYS.rgb(${args.map(compile).join(', ')})`;
  },
  Hsv: (args, compile) => {
    if (args.length < 3) throw new Error('Hsv: need 3 components');
    return `_SYS.hsv(${args.map(compile).join(', ')})`;
  },
  Hsl: (args, compile) => {
    if (args.length < 3) throw new Error('Hsl: need 3 components');
    return `_SYS.hsl(${args.map(compile).join(', ')})`;
  },
  Oklab: (args, compile) => {
    if (args.length < 3) throw new Error('Oklab: need 3 components');
    return `_SYS.oklab(${args.map(compile).join(', ')})`;
  },
  Oklch: (args, compile) => {
    if (args.length < 3) throw new Error('Oklch: need 3 components');
    return `_SYS.oklch(${args.map(compile).join(', ')})`;
  },

  // -----------------------------------------------------------------------
  // As* converters. Compile-time output convention matches the engine and
  // the GPU target: each returns components in the named space as a 3- or
  // 4-element array. `AsRgb` uses 0-1 sRGB channels (consistent across all
  // layers). `AsOklch` is the identity (canonical form).
  // -----------------------------------------------------------------------
  AsRgb: ([c], compile) => {
    if (c === null) throw new Error('AsRgb: no argument');
    return `_SYS.asRgb(${compile(c)})`;
  },
  AsHsv: ([c], compile) => {
    if (c === null) throw new Error('AsHsv: no argument');
    return `_SYS.asHsv(${compile(c)})`;
  },
  AsHsl: ([c], compile) => {
    if (c === null) throw new Error('AsHsl: no argument');
    return `_SYS.asHsl(${compile(c)})`;
  },
  AsOklab: ([c], compile) => {
    if (c === null) throw new Error('AsOklab: no argument');
    return `_SYS.asOklab(${compile(c)})`;
  },
  AsOklch: ([c], compile) => {
    if (c === null) throw new Error('AsOklch: no argument');
    return compile(c); // identity — already in canonical form
  },

  // Perceptual color difference (ΔE_OK).
  ColorDelta: ([a, b], compile) => {
    if (a === null || b === null)
      throw new Error('ColorDelta: need two colors');
    return `_SYS.colorDelta(${compile(a)}, ${compile(b)})`;
  },

  // Euclidean distance between two tuples (any positive dimension).
  // The GPU target maps `Distance` to the GLSL/WGSL `distance()` builtin
  // (vec-only); this JS handler works on plain arrays of any length.
  Distance: ([a, b], compile) => {
    if (a === null || b === null) throw new Error('Distance: need two points');
    return `_SYS.distance(${compile(a)}, ${compile(b)})`;
  },
  // Block-scoped seeding. A prologue pushes a frame onto the SAME per-engine
  // stack the interpreter uses, and a `finally` pops it — literally
  // `withRandomSeedFrame(ce, seed, fn)`, reached through the `_SYS` bundle's
  // engine binding. Compiled callees (and interpreted code reached from them)
  // therefore see the frame, which is what dynamic scoping requires.
  //
  // The seed expression is emitted in argument position, so it is evaluated
  // ONCE per frame entry, never per draw.
  WithRandomSeed: (args, compile) => {
    if (args.length !== 2)
      throw new Error(
        `WithRandomSeed: expected exactly two arguments. Fail closed (D6).`
      );
    return `_SYS.withRandomSeed(${compile(args[0])}, () => ${compile(args[1])})`;
  },
};

/** Convert a Complex instance to a plain {re, im} object */
function toRI(c: Complex): { re: number; im: number } {
  return { re: c.re, im: c.im };
}

/**
 * Folding a constant that has NO REAL VALUE (`√-2`, `(-2)^0.3`).
 *
 * Policy (2026-07-30): such a constant is FOLDED, never refused. Fail-closed
 * (D6) exists to prevent silently WRONG output, not to prevent a non-real
 * one. `NaN` is the correct, self-describing answer for "no real value", it
 * is what every sibling head already returns (`Ln(-2)` → `Math.log(-2)`,
 * `Arcsin(2)` → `Math.asin(2)`), and it is what the SAME expression returns
 * when the operand is a variable (`Sqrt(x)` at `x = -2`, `Sqrt(a)` with
 * `a ⩴ -2`). Refusing only the provable-constant case bought no safety: the
 * runtime-variable case cannot be caught in principle, so the caller must
 * handle `NaN` either way.
 *
 * WHICH value is folded is decided by the node's TYPE, not by the ruling:
 * `BaseCompiler.isComplexValued` — a type query — is what makes the enclosing
 * expression emit real (`a + b`) or complex (`{re, im}`) arithmetic, so the
 * emitted constant must agree with it.
 * - A canonical `Sqrt(negative)` is typed `complex`, so it folds to the
 *   complex principal value (`√-2` → `1.414…i`, matching the interpreter) —
 *   `complexSqrtLiteral` below.
 * - A `Power`/`Root` on the COMPLEX branch of a negative base — the exponent's
 *   reduced-rational denominator is even (`(−2)^0.3`), or the root degree is
 *   even (`Root(−8, 4)`) — is typed `finite_complex` as of the 2026-07-30
 *   ruling, so it folds to the principal complex value (`complexPowLiteral`).
 *   It previously folded to `NaN` on the (then-true) grounds that the type was
 *   the coarser `finite_number`; once the type narrowed, that fold became a
 *   regression — the parent emits `{re, im}` arithmetic and read `.re`/`.im`
 *   off a `NaN` *number*, yielding `{re: NaN, im: undefined}`.
 * - A `Power`/`Root` on the REAL branch of a negative base — an ODD
 *   reduced-rational denominator or root degree, where a real principal root
 *   exists (`(−8)^(2/3) = 4`, `Root(−8, 3) = −2`) — stays `finite_number` and
 *   folds to that real value, which `Math.pow` alone misses. See
 *   `negativeBaseRealPow`.
 * - Only when the branch is UNPROVABLE (a float exponent with no faithful
 *   rational reconstruction) does a `Power`/`Root` fold to `NaN` — exactly what
 *   its own `Math.pow` lowering yields once the base is a runtime variable. A
 *   `{re, im}` object there would be consumed as a number by the enclosing real
 *   arithmetic (`1 + {…}` → `"1[object Object]"`).
 */
const NO_REAL_VALUE_FOLD = 'NaN';

/**
 * The complex principal square root of a negative real constant, as a JS
 * complex-object literal. `Complex.sqrt` (not the polar `pow`) so the folded
 * constant is digit-exact with `_SYS.csqrt` and the interpreter — `pow(x, 0.5)`
 * leaves ~1e-16 of real dust on a pure-imaginary result.
 */
function complexSqrtLiteral(c: number): string {
  const r = new Complex(c, 0).sqrt();
  return `({ re: ${r.re}, im: ${r.im} })`;
}

/**
 * The principal complex power of two real constants, as a JS complex-object
 * literal — the fold for a `Power`/`Root` node whose TYPE is complex (a
 * negative base whose reduced-rational exponent has an even denominator).
 *
 * `Complex.pow` is the same routine `_SYS.cpow` and the interpreter's numeric
 * path use, so the folded constant is digit-identical with the value the
 * uncompiled expression produces.
 */
function complexPowLiteral(base: number, exp: number): string {
  const r = principalComplexPow(base, exp);
  return `({ re: ${r.re}, im: ${r.im} })`;
}

/**
 * Whether applying `head` to `args` produces a complex value — the SAME signal
 * `BaseCompiler.isComplexValued` reports to the ENCLOSING expression for this
 * node.
 *
 * A handler that picks its real-vs-complex lowering from the ARGUMENT alone can
 * disagree with its own parent. With `a := -2`, `Sqrt(a)` is typed `complex`
 * (the type handler reads the assigned value's sign) while the operand `a` is
 * typed `integer`: the parent emits `{re, im}` arithmetic around a
 * `Math.sqrt(-2)` — a `NaN` *number* — and reads `.re`/`.im` off it
 * (`{re: NaN, im: undefined}` behind `success: true`).
 *
 * The node is rebuilt STRUCTURALLY (bound, not canonicalized) so its head and
 * operands are the ones being lowered, and its type is therefore the type the
 * parent read. Mirrors the function branch of `isComplexValued`: a wide result
 * type (`number`, as `Power`/`Root`/`Arcsin` have) is NOT complex — those fold
 * to `NaN`, which is what their real lowering yields anyway.
 */
function resultIsComplexValued(
  head: MathJsonSymbol,
  args: ReadonlyArray<Expression>
): boolean {
  const engine = args[0]?.engine;
  if (engine === undefined) return false;
  try {
    const t = engine.function(head, [...args], { form: 'structural' }).type;
    return isNonRealNumber(t.type);
  } catch {
    return false;
  }
}

/**
 * An operand as complex-object source, lifting a real-emitted operand to
 * `{ re, im: 0 }`. The `_SYS.c…` helpers read `.re`/`.im`, so handing one a
 * plain number silently yields `NaN`.
 */
function complexOperandCode(
  x: Expression,
  compile: OperandCompiler<Expression>
): string {
  if (BaseCompiler.isComplexValued(x)) return compile(x);
  return `({ re: ${compile(x)}, im: 0 })`;
}

/**
 * Canonicalize an alpha value. Returns `undefined` for undefined, non-finite,
 * or effectively-1 inputs so downstream sites can use a simple
 * `alpha !== undefined` check to decide whether to emit it. Mirrors the
 * helper of the same name in `library/colors.ts` so the interpreted and
 * compiled paths agree on alpha semantics.
 */
function normalizeAlpha(a: number | undefined): number | undefined {
  if (a === undefined) return undefined;
  if (!Number.isFinite(a)) return undefined;
  if (Math.abs(a - 1) < 1e-9) return undefined;
  return a;
}

/**
 * Normalize a color input to an `RgbColor` (0-255 channels).
 *
 * Strings are parsed as CSS colors; arrays are interpreted as Oklch
 * `[L, C, H]` (or `[L, C, H, alpha]`) — the canonical compiled-runtime
 * representation produced by `_SYS.color`, `_SYS.colorMix`, etc. Arrays
 * cross the sRGB gamut clip via `oklchToRgb` here.
 */
function toRgb255(input: string | number[]): {
  r: number;
  g: number;
  b: number;
  alpha?: number;
} {
  if (typeof input === 'string') {
    const c = parseColor(input);
    const rgb: { r: number; g: number; b: number; alpha?: number } = {
      r: (c >>> 24) & 0xff,
      g: (c >>> 16) & 0xff,
      b: (c >>> 8) & 0xff,
    };
    const alpha = normalizeAlpha((c & 0xff) / 255);
    if (alpha !== undefined) rgb.alpha = alpha;
    return rgb;
  }
  const rgb = oklchToRgb({ L: input[0], C: input[1], H: input[2] }) as {
    r: number;
    g: number;
    b: number;
    alpha?: number;
  };
  if (input.length >= 4) {
    const alpha = normalizeAlpha(input[3]);
    if (alpha !== undefined) rgb.alpha = alpha;
  }
  return rgb;
}

/** Resolve any color input to Oklch components, preserving alpha if present. */
function toOklch(input: string | number[]): {
  L: number;
  C: number;
  H: number;
  alpha?: number;
} {
  if (typeof input === 'string') {
    const c = parseColor(input);
    const r = (c >>> 24) & 0xff;
    const g = (c >>> 16) & 0xff;
    const b = (c >>> 8) & 0xff;
    const oklch = rgbToOklch({ r, g, b }) as {
      L: number;
      C: number;
      H: number;
      alpha?: number;
    };
    const alpha = normalizeAlpha((c & 0xff) / 255);
    if (alpha !== undefined) oklch.alpha = alpha;
    return oklch;
  }
  return {
    L: input[0],
    C: input[1],
    H: input[2],
    alpha: input.length >= 4 ? normalizeAlpha(input[3]) : undefined,
  };
}

/** Packed 0xRRGGBBAA integer to Oklch `[L, C, H]` or `[L, C, H, alpha]`. */
function packedToOklch(c: number): number[] {
  const r = (c >>> 24) & 0xff;
  const g = (c >>> 16) & 0xff;
  const b = (c >>> 8) & 0xff;
  const oklch = rgbToOklch({ r, g, b });
  const alpha = normalizeAlpha((c & 0xff) / 255);
  return alpha !== undefined
    ? [oklch.L, oklch.C, oklch.H, alpha]
    : [oklch.L, oklch.C, oklch.H];
}

/** Color runtime helpers shared by both SYS objects. */
const colorHelpers = {
  color(input: string): number[] {
    return packedToOklch(parseColor(input));
  },
  colorToString(input: string | number[], format?: string): string {
    const rgb = toRgb255(input);
    const fmt = (format ?? 'hex').toLowerCase();
    switch (fmt) {
      case 'hex': {
        const r = Math.round(Math.max(0, Math.min(255, rgb.r)));
        const g = Math.round(Math.max(0, Math.min(255, rgb.g)));
        const b = Math.round(Math.max(0, Math.min(255, rgb.b)));
        let hex = `#${r.toString(16).padStart(2, '0')}${g
          .toString(16)
          .padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
        if (rgb.alpha !== undefined) {
          const a = Math.round(Math.max(0, Math.min(255, rgb.alpha * 255)));
          hex += a.toString(16).padStart(2, '0');
        }
        return hex;
      }
      case 'rgb': {
        const r = Math.round(rgb.r);
        const g = Math.round(rgb.g);
        const b = Math.round(rgb.b);
        if (rgb.alpha !== undefined)
          return `rgb(${r} ${g} ${b} / ${rgb.alpha})`;
        return `rgb(${r} ${g} ${b})`;
      }
      case 'hsl': {
        const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
        const h = Math.round(hsl.h * 10) / 10;
        const s = Math.round(hsl.s * 1000) / 10;
        const l = Math.round(hsl.l * 1000) / 10;
        if (rgb.alpha !== undefined)
          return `hsl(${h} ${s}% ${l}% / ${rgb.alpha})`;
        return `hsl(${h} ${s}% ${l}%)`;
      }
      case 'oklch': {
        const c = rgbToOklch(rgb);
        const L = Math.round(c.L * 1000) / 1000;
        const C = Math.round(c.C * 1000) / 1000;
        const H = Math.round(c.H * 10) / 10;
        if (rgb.alpha !== undefined)
          return `oklch(${L} ${C} ${H} / ${rgb.alpha})`;
        return `oklch(${L} ${C} ${H})`;
      }
      default:
        throw new Error(`Unknown color format: ${fmt}`);
    }
  },
  colorMix(
    input1: string | number[],
    input2: string | number[],
    ratio = 0.5
  ): number[] {
    const c1 = toOklch(input1);
    const c2 = toOklch(input2);
    ratio = Math.max(0, Math.min(1, ratio));

    // Achromatic-aware shortest-arc hue interpolation: when one endpoint has
    // C ≈ 0 its hue is undefined, so use the other endpoint's hue throughout.
    const c1Achromatic = c1.C < 1e-6;
    const c2Achromatic = c2.C < 1e-6;
    let H: number;
    if (c1Achromatic && c2Achromatic) H = c1.H;
    else if (c1Achromatic) H = c2.H;
    else if (c2Achromatic) H = c1.H;
    else {
      let dh = c2.H - c1.H;
      if (dh > 180) dh -= 360;
      if (dh < -180) dh += 360;
      H = c1.H + dh * ratio;
      if (H < 0) H += 360;
      if (H >= 360) H -= 360;
    }

    const L = c1.L + (c2.L - c1.L) * ratio;
    const C = c1.C + (c2.C - c1.C) * ratio;
    const a1 = c1.alpha ?? 1;
    const a2 = c2.alpha ?? 1;
    const alpha = normalizeAlpha(a1 + (a2 - a1) * ratio);
    return alpha !== undefined ? [L, C, H, alpha] : [L, C, H];
  },
  colorContrast(bg: string | number[], fg: string | number[]): number {
    return apca(toRgb255(bg), toRgb255(fg));
  },
  contrastingColor(
    bg: string | number[],
    fg1?: string | number[],
    fg2?: string | number[]
  ): number[] {
    const bgRgb = toRgb255(bg);
    if (fg1 !== undefined && fg2 !== undefined) {
      return packedToOklch(
        contrastingColor({ bg: bgRgb, fg1: toRgb255(fg1), fg2: toRgb255(fg2) })
      );
    }
    return packedToOklch(contrastingColor(bgRgb));
  },
  colorToColorspace(input: string | number[], space: string): number[] {
    const rgb = toRgb255(input);
    const alpha = rgb.alpha;
    let result: number[];
    switch (space.toLowerCase()) {
      case 'rgb':
        result = [rgb.r / 255, rgb.g / 255, rgb.b / 255];
        break;
      case 'hsl': {
        const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
        result = [hsl.h, hsl.s, hsl.l];
        break;
      }
      case 'oklch': {
        const c = rgbToOklch(rgb);
        result = [c.L, c.C, c.H];
        break;
      }
      case 'oklab':
      case 'lab': {
        const lab = rgbToOklab(rgb);
        result = [lab.L, lab.a, lab.b];
        break;
      }
      default:
        throw new Error(`Unknown color space: ${space}`);
    }
    if (alpha !== undefined) result.push(alpha);
    return result;
  },
  colormap(name: string, arg?: number): number[] | number[][] {
    const allPalettes = {
      ...SEQUENTIAL_PALETTES,
      ...CATEGORICAL_PALETTES,
      ...DIVERGING_PALETTES,
    };
    const palette = allPalettes[name as keyof typeof allPalettes];
    if (!palette) throw new Error(`Unknown palette: ${name}`);

    // Each palette stop is stored as Oklch [L, C, H] for perceptually-uniform
    // interpolation and to match the compiled-runtime color representation.
    const colors = (palette as readonly string[]).map((hex: HexColor) =>
      packedToOklch(parseColor(hex))
    );

    // No second arg → return full palette
    if (arg === undefined) return colors;

    // Integer n >= 2 → resample to n evenly spaced colors
    if (Number.isInteger(arg) && arg >= 2) {
      const n = arg;
      const result: number[][] = [];
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : i / (n - 1);
        result.push(this._interpolatePalette(colors, t));
      }
      return result;
    }

    // Float t in [0, 1] → interpolate at position t
    const t = Math.max(0, Math.min(1, arg));
    return this._interpolatePalette(colors, t);
  },

  _interpolatePalette(colors: number[][], t: number): number[] {
    if (colors.length === 0) return [0, 0, 0];
    if (t <= 0) return [...colors[0]];
    if (t >= 1) return [...colors[colors.length - 1]];

    const pos = t * (colors.length - 1);
    const i = Math.floor(pos);
    const frac = pos - i;

    if (frac === 0 || i >= colors.length - 1)
      return [...colors[Math.min(i, colors.length - 1)]];

    // Interpolate directly in Oklch (palette stops are already Oklch).
    const [L1, C1, H1] = colors[i];
    const [L2, C2, H2] = colors[i + 1];

    const c1Achromatic = C1 < 1e-6;
    const c2Achromatic = C2 < 1e-6;
    let H: number;
    if (c1Achromatic && c2Achromatic) H = H1;
    else if (c1Achromatic) H = H2;
    else if (c2Achromatic) H = H1;
    else {
      let dh = H2 - H1;
      if (dh > 180) dh -= 360;
      if (dh < -180) dh += 360;
      H = H1 + dh * frac;
      if (H < 0) H += 360;
      if (H >= 360) H -= 360;
    }

    return [L1 + (L2 - L1) * frac, C1 + (C2 - C1) * frac, H];
  },

  colorFromColorspace(components: number[], space: string): number[] {
    const c0 = components[0];
    const c1 = components[1];
    const c2 = components[2];
    const alpha = components.length >= 4 ? components[3] : undefined;
    let oklch: { L: number; C: number; H: number };
    switch (space.toLowerCase()) {
      case 'rgb':
        oklch = rgbToOklch({ r: c0 * 255, g: c1 * 255, b: c2 * 255 });
        break;
      case 'hsl': {
        const rgb = hslToRgb(c0, c1, c2);
        oklch = rgbToOklch(rgb);
        break;
      }
      case 'oklch':
        oklch = { L: c0, C: c1, H: c2 };
        break;
      case 'oklab':
      case 'lab':
        oklch = oklabToOklch({ L: c0, a: c1, b: c2 });
        break;
      default:
        throw new Error(`Unknown color space: ${space}`);
    }
    return alpha !== undefined
      ? [oklch.L, oklch.C, oklch.H, alpha]
      : [oklch.L, oklch.C, oklch.H];
  },

  // -----------------------------------------------------------------------
  // Color constructors. Each accepts components in its colorspace's natural
  // units and returns the canonical OKLCh array `[L, C, H]` (or with alpha).
  // -----------------------------------------------------------------------
  rgb(r: number, g: number, b: number, alpha?: number): number[] {
    // Inputs are 0-1 sRGB; `rgbToOklch` expects 0-255 channels.
    const c = rgbToOklch({ r: r * 255, g: g * 255, b: b * 255 });
    const a = normalizeAlpha(alpha);
    return a !== undefined ? [c.L, c.C, c.H, a] : [c.L, c.C, c.H];
  },
  hsv(h: number, s: number, v: number, alpha?: number): number[] {
    const rgb = hsvToRgb(h, s, v);
    const c = rgbToOklch(rgb);
    const a = normalizeAlpha(alpha);
    return a !== undefined ? [c.L, c.C, c.H, a] : [c.L, c.C, c.H];
  },
  hsl(h: number, s: number, l: number, alpha?: number): number[] {
    const rgb = hslToRgb(h, s, l);
    const c = rgbToOklch({ r: rgb.r, g: rgb.g, b: rgb.b });
    const a = normalizeAlpha(alpha);
    return a !== undefined ? [c.L, c.C, c.H, a] : [c.L, c.C, c.H];
  },
  oklab(L: number, a: number, b: number, alpha?: number): number[] {
    const c = oklabToOklch({ L, a, b });
    const al = normalizeAlpha(alpha);
    return al !== undefined ? [c.L, c.C, c.H, al] : [c.L, c.C, c.H];
  },
  oklch(L: number, C: number, H: number, alpha?: number): number[] {
    const a = normalizeAlpha(alpha);
    return a !== undefined ? [L, C, H, a] : [L, C, H];
  },

  // -----------------------------------------------------------------------
  // As* converters. Inputs are anything `toOklch` accepts (string, packed
  // int, or OKLCh array). Outputs are 3- or 4-element arrays in the named
  // space. sRGB-based outputs (asRgb/asHsv/asHsl) use 0-1 channels for
  // consistency with the GPU target's shader convention.
  // -----------------------------------------------------------------------
  asRgb(input: string | number[]): number[] {
    const rgb = toRgb255(input);
    const r = rgb.r / 255;
    const g = rgb.g / 255;
    const b = rgb.b / 255;
    return rgb.alpha !== undefined ? [r, g, b, rgb.alpha] : [r, g, b];
  },
  asHsv(input: string | number[]): number[] {
    const rgb = toRgb255(input);
    const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    return rgb.alpha !== undefined
      ? [hsv.h, hsv.s, hsv.v, rgb.alpha]
      : [hsv.h, hsv.s, hsv.v];
  },
  asHsl(input: string | number[]): number[] {
    const rgb = toRgb255(input);
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    return rgb.alpha !== undefined
      ? [hsl.h, hsl.s, hsl.l, rgb.alpha]
      : [hsl.h, hsl.s, hsl.l];
  },
  asOklab(input: string | number[]): number[] {
    const c = toOklch(input);
    const lab = oklchToOklab({ L: c.L, C: c.C, H: c.H });
    return c.alpha !== undefined
      ? [lab.L, lab.a, lab.b, c.alpha]
      : [lab.L, lab.a, lab.b];
  },
  // asOklch is identity — handled at compile time as a pass-through

  // Perceptual color difference (ΔE_OK).
  colorDelta(a: string | number[], b: string | number[]): number {
    const labA = oklchToOklab(toOklch(a));
    const labB = oklchToOklab(toOklch(b));
    return oklabDeltaE(labA, labB);
  },

  // Euclidean distance between two points, broadcasting over a list of
  // points. Plain numeric — not a color operation despite living in the same
  // helpers block.
  //
  // A point is a flat numeric array (both the `Tuple` and the `List`
  // spellings compile to one); a LIST of points is an array of those. A point
  // against a list of points maps the distance over the list; two lists zip
  // pairwise and must have the same length (the lifted-operator convention —
  // no truncation to the shortest), mirroring the interpreter's `Distance`
  // broadcast (Tycho items 130/138).
  distance(a: unknown, b: unknown): number | number[] {
    if (!Array.isArray(a) || !Array.isArray(b))
      throw new Error('Distance: expected two arrays');
    // An EMPTY array reads as an empty list of points (a 0-dimensional point
    // has no distance), matching the interpreter's `Distance([], p) → []`.
    const aList = a.length === 0 || Array.isArray(a[0]);
    const bList = b.length === 0 || Array.isArray(b[0]);
    if (!aList && !bList) return colorHelpers.pointDistance(a, b);
    if (aList && bList) {
      if (a.length !== b.length)
        throw new Error('Distance: dimension mismatch');
      return a.map((p, i) => colorHelpers.pointDistance(p, b[i]));
    }
    if (aList) return a.map((p) => colorHelpers.pointDistance(p, b));
    return b.map((p) => colorHelpers.pointDistance(a, p));
  },

  // The scalar leg of `distance`: the Euclidean distance between two points,
  // each a flat numeric array.
  pointDistance(a: unknown, b: unknown): number {
    if (!Array.isArray(a) || !Array.isArray(b))
      throw new Error('Distance: expected points (flat numeric arrays)');
    if (a.length !== b.length || a.length === 0)
      throw new Error('Distance: dimension mismatch');
    let sumSq = 0;
    for (let i = 0; i < a.length; i++) {
      if (typeof a[i] !== 'number' || typeof b[i] !== 'number')
        throw new Error('Distance: expected points (flat numeric arrays)');
      const d = a[i] - b[i];
      sumSq += d * d;
    }
    return Math.sqrt(sumSq);
  },
};

/** A compiled numeric value: a scalar, a complex `{re,im}`, or a (possibly
 * nested) array of these. */
type BcastValue = number | { re: number; im: number } | BcastValue[];

/**
 * Element-wise broadcast of a scalar function `f` over its arguments (the
 * runtime side of the compile target's list broadcasting — see
 * `tryCompileBroadcast` and `bcast`/`bcastFn` below). Any array argument makes
 * the result an array; a length MISMATCH among the array arguments projects to
 * NaN (the real-target rendering of the interpreter's
 * `incompatible-dimensions` — no truncation to the shortest), a scalar
 * argument is reused for every element, and nested arrays recurse. When no
 * argument is an array, `f` is applied directly. `f` therefore only ever sees
 * scalar (or complex) operands.
 */
/**
 * The numeric value an `At` index entry contributes, mirroring the
 * interpreter's use of the boxed index's `.re`: a plain number passes through,
 * a compiled complex `{ re, im }` yields its real part (the imaginary part is
 * dropped, exactly as interpretation does), and anything else — a boolean, a
 * string, `undefined` — yields NaN so the caller declines.
 */
function indexValue(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && v !== null && 're' in v) {
    const re = (v as { re: unknown }).re;
    if (typeof re === 'number') return re;
  }
  return NaN;
}

function bcast(
  f: (...xs: BcastValue[]) => BcastValue,
  ...args: BcastValue[]
): BcastValue {
  return bcastWith(false, f, args);
}

/**
 * `bcast` for a USER-FUNCTION application (`q(L)` — see
 * `tryCompileUserFunction`). Identical except at an empty position: applying a
 * function literal to an empty collection zips zero elements and answers the
 * EMPTY LIST in the interpreter (`q([])` → `[]`), where an empty OPERATOR
 * position answers `Nothing` (NaN — see `bcastWith`).
 */
function bcastFn(
  f: (...xs: BcastValue[]) => BcastValue,
  ...args: BcastValue[]
): BcastValue {
  return bcastWith(true, f, args);
}

/**
 * Shared implementation of `bcast`/`bcastFn`. `emptyIsList` selects what an
 * empty broadcast position produces, and is carried into the nested positions
 * so a `[[], [1]]` argument projects consistently at every depth.
 */
function bcastWith(
  emptyIsList: boolean,
  f: (...xs: BcastValue[]) => BcastValue,
  args: BcastValue[]
): BcastValue {
  let n = -1;
  for (const a of args) {
    if (!Array.isArray(a)) continue;
    if (n < 0) n = a.length;
    // Length mismatch: the interpreter answers `incompatible-dimensions`
    // (2026-07-24 ruling — no truncation, no recycling), which projects onto a
    // real target as NaN, exactly as `matmul` projects a dimension mismatch.
    // Truncating to the shortest operand is what used to make compiled
    // `Less([1,2,3],[2,2])` answer `[true,false]` where interpretation errors.
    else if (a.length !== n) return NaN;
  }
  if (n < 0) return f(...args);
  // An EMPTY position broadcasts to `Nothing` in the interpreter, not to an
  // empty list — `Not([])` is `Nothing` (NaN here), and in a nested operand
  // (`Not([[], [True]])` → `[Nothing, [False]]`) only that position is
  // projected. Recursing per position is what keeps a sibling from being
  // poisoned by it. A user-function application instead zips zero elements
  // into an empty list (`emptyIsList` — a fresh array per position, never a
  // shared instance).
  if (n === 0) return emptyIsList ? [] : NaN;
  const out: BcastValue[] = new Array(n);
  for (let i = 0; i < n; i++)
    out[i] = bcastWith(
      emptyIsList,
      f,
      args.map((a) => (Array.isArray(a) ? a[i] : a))
    );
  return out;
}

/**
 * Element-wise conditional selection — the runtime side of a compiled
 * `Which`/`If` whose condition may be an indexed collection (`np.select`
 * semantics, R1–R4 of
 * `docs/plans/2026-07-27-elementwise-which-design.md`; the interpreter side is
 * `evaluateElementwiseSelection` in `library/control-structures.ts`).
 *
 * The clauses arrive as THUNKS, in `Which` order (condition, arm, …), so this
 * helper owns evaluation: conditions run in clause order and at most once, and
 * an arm runs only if selection reaches it somewhere — then exactly once, as a
 * WHOLE value (R2), cached for every position that selected it.
 *
 * - a scalar `true` condition captures every not-yet-decided position and ends
 *   the walk (later conditions are never evaluated); a scalar `false` captures
 *   none; an array condition captures its `true` cells;
 * - if EVERY condition turns out scalar, this is an ordinary scalar `Which`:
 *   the selected arm's value is returned WHOLE (it may itself be an array —
 *   `Which(True, [1,2])` is `[1,2]`, not an indexed cell);
 * - element-wise, all array participants (conditions AND selected arms) must
 *   share one length; a mismatch is the interpreter's `incompatible-dimensions`
 *   projected to NaN, as everywhere in `bcastWith` (R3). A scalar arm lifts to
 *   its positions, an array arm is indexed at each;
 * - a position no clause matched is NaN (R4). So is a position whose condition
 *   cell is absent (NaN — how a real target renders `Missing`): the position is
 *   CONSUMED, never offered to a later clause, matching the interpreter's
 *   positioned "condition is absent" error cell (R4′);
 * - a scalar condition that is neither boolean nor an array fails closed with
 *   the same message as `_SYS.cond`, so a conditional that is scalar at run
 *   time behaves exactly like the ternary chain it replaced.
 */
function select(...clauses: Array<() => unknown>): unknown {
  // 1/ The conditions, in clause order.
  const selectors: Array<true | 'absent' | unknown[]> = [];
  const armThunks: Array<() => unknown> = [];
  for (let k = 0; k + 1 < clauses.length; k += 2) {
    const c = clauses[k]();
    if (c === false) continue;
    armThunks.push(clauses[k + 1]);
    if (c === true) {
      selectors.push(true);
      break;
    }
    if (Array.isArray(c)) {
      selectors.push(c);
      continue;
    }
    if (c === undefined || c === null || c !== c) {
      // A lifted ABSENT condition (NaN — the real-target rendering of
      // `Missing`, which the interpreter answers with a whole-expression
      // "condition is absent" error) decides nothing anywhere, and no later
      // clause may decide what absence left undecided: stop, exactly as a
      // lifted `true` does.
      selectors.push('absent');
      break;
    }
    throw new Error('Condition must evaluate to "True" or "False".');
  }

  // 2/ The common length of the array participants.
  let n = -1;
  for (const s of selectors) {
    if (!Array.isArray(s)) continue;
    if (n < 0) n = s.length;
    else if (s.length !== n) return NaN;
  }
  if (n < 0) {
    const last = selectors[selectors.length - 1];
    if (last !== true) return NaN;
    return armThunks[armThunks.length - 1]();
  }

  // 3/ Selection: the first clause that is `true` at each position (`-1`: no
  // match), and the positions whose condition cell is absent.
  const selection = new Int32Array(n).fill(-1);
  const absent = new Uint8Array(n);
  let undecided = n;
  for (let k = 0; k < selectors.length && undecided > 0; k++) {
    const cells = selectors[k];
    for (let j = 0; j < n; j++) {
      if (selection[j] >= 0 || absent[j] === 1) continue;
      const v =
        cells === true ? true : cells === 'absent' ? undefined : cells[j];
      if (v === true) {
        selection[j] = k;
        undecided -= 1;
      } else if (v === false) {
        continue;
      } else if (v === undefined || v === null || v !== v) {
        // An ABSENT cell (NaN — how a real target renders `Missing`, and how a
        // `Missing` symbol lowers through the vars object). Undecidable, and
        // the position is CONSUMED so no later clause decides it (R4′).
        absent[j] = 1;
        undecided -= 1;
      } else {
        // Any other cell is not a condition value at all: the interpreter
        // throws rather than picking a branch (`Which([10,20], …)`), and so
        // does the scalar guard `_SYS.cond`.
        throw new Error('Condition must evaluate to "True" or "False".');
      }
    }
  }

  // 4/ Each REACHED arm once, whole (R2), in clause order.
  const reached = new Set<number>();
  for (let j = 0; j < n; j++) if (selection[j] >= 0) reached.add(selection[j]);
  const values: unknown[] = new Array(selectors.length);
  for (let k = 0; k < selectors.length; k++) {
    if (!reached.has(k)) continue;
    const v = armThunks[k]();
    // A list-valued arm is a length participant too (R3).
    if (Array.isArray(v) && v.length !== n) return NaN;
    values[k] = v;
  }

  // 5/ Assemble, position by position.
  const out: unknown[] = new Array(n);
  for (let j = 0; j < n; j++) {
    if (absent[j] === 1 || selection[j] < 0) {
      out[j] = NaN;
      continue;
    }
    const v = values[selection[j]];
    out[j] = Array.isArray(v) ? v[j] : v;
  }
  return out;
}

/**
 * Product dispatch on dimensionality, mirroring the interpreter's
 * `Dot`/`MatrixMultiply`: vector·vector → scalar, matrix·vector → vector,
 * vector·matrix → vector, matrix·matrix → matrix. Real, nested-array
 * representation; a dimension mismatch yields NaN (the interpreter's
 * error/inert result projected onto a real target).
 */
function matmul(a: any, b: any): any {
  const aM = Array.isArray(a?.[0]);
  const bM = Array.isArray(b?.[0]);
  if (!aM && !bM) {
    if (a.length !== b.length) return NaN;
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }
  if (aM && !bM)
    return a.map((row: number[]) =>
      row.length === b.length
        ? row.reduce((s: number, v: number, i: number) => s + v * b[i], 0)
        : NaN
    );
  if (!aM && bM) {
    if (a.length !== b.length) return NaN;
    const n = b[0].length;
    const out = new Array(n).fill(0);
    for (let i = 0; i < a.length; i++)
      for (let j = 0; j < n; j++) out[j] += a[i] * b[i][j];
    return out;
  }
  const m = a.length;
  const k = a[0].length;
  if (b.length !== k) return NaN;
  const n = b[0].length;
  const out: number[][] = [];
  for (let i = 0; i < m; i++) {
    const row = new Array(n).fill(0);
    for (let p = 0; p < k; p++) {
      const v = a[i][p];
      for (let j = 0; j < n; j++) row[j] += v * b[p][j];
    }
    out.push(row);
  }
  return out;
}

/**
 * Interpreter-faithful `Multiply` over a mix of scalars and (possibly nested)
 * real arrays — the runtime side of the compile target's tensor-Multiply
 * lowering for operands whose collection-ness is not statically provable (a
 * `broadcastable<T>` node or a top-typed application such as `h(x)`); see
 * `tryCompileBroadcast`'s ≥2-possibly-collection branch.
 *
 * Mirrors `mulTensors` (`arithmetic-mul-div.ts`): scalar factors combine into a
 * single factor that scales the tensor result; two rank-1 vectors take the
 * element-wise (Hadamard) product — inert (NaN) on a length mismatch — while any
 * rank-≥2 operand contracts via the matrix product (`matmul`), so no runtime
 * shape (vector·vector, matrix·vector, matrix·matrix) silently diverges from the
 * interpreter. Real-only, matching the scalar Multiply codegen it replaces;
 * complex operands are deferred to the fail-closed path at compile time.
 */
function mulTensor(...args: BcastValue[]): BcastValue {
  const tensors: BcastValue[][] = [];
  let scalar = 1;
  for (const x of args) {
    if (Array.isArray(x)) tensors.push(x);
    else scalar *= x as number;
  }
  if (tensors.length === 0) return scalar;
  let product: BcastValue[] = tensors[0];
  for (let i = 1; i < tensors.length; i++) {
    const next = tensors[i];
    const pRank1 = !Array.isArray(product[0]);
    const nRank1 = !Array.isArray(next[0]);
    if (pRank1 && nRank1) {
      // Two rank-1 vectors: Hadamard (element-wise), inert on a length
      // mismatch — matching the interpreter (Issue #29), NOT the dot product.
      if (product.length !== next.length) return NaN;
      const out: BcastValue[] = new Array(product.length);
      for (let k = 0; k < product.length; k++)
        out[k] = (product[k] as number) * (next[k] as number);
      product = out;
    } else {
      // A rank-≥2 operand contracts via the matrix product. `matmul` returns a
      // bare number only on a dimension mismatch (NaN) here — stay inert.
      const r = matmul(product, next);
      if (typeof r === 'number') return r;
      product = r as BcastValue[];
    }
  }
  if (scalar !== 1)
    product = bcast((v) => (v as number) * scalar, product) as BcastValue[];
  return product;
}

/**
 * Interpreter-faithful `Equal` over operands whose collection-ness is not
 * statically provable (a `broadcastable<T>` node or a top-typed application
 * such as `q(x)`) — the runtime side of `compileJSEquality`'s
 * possibly-collection lowering (Tycho item 41). Mirrors the interpreter's
 * dispatch, probe-verified shape by shape:
 * - scalar = scalar → tolerant boolean (`|a − b| <= tol`; a complex operand
 *   compares on the modulus of the difference)
 * - array = scalar (either order) → element-wise array of booleans
 *   (`[1,4,4] = 4` → `[false, true, true]`), recursing into nested arrays
 * - array = array → a single boolean: equal lengths and every element pair
 *   equal (recursive, so matrices compare element-wise; a length mismatch or
 *   an element-shape mismatch is `false`) — collection equality, not a
 *   broadcast
 *
 * The scalar leaf has a STRING branch (tier 2, 2026-08-08): when either side is
 * a string the comparison is a strict `===`, the interpreter's own string
 * semantics (`compare.ts`, no tolerance). Without it the leaf fell through to
 * `Math.hypot(NaN, …) <= tol` → `false`, so two EQUAL string lists answered
 * `false`. It is the mirror of the Python target's `_ce_eqcoll` string leaf, and
 * it is faithful for a MIXED leaf pair too (`Equal("a", 1)` is `False` in the
 * interpreter, and `"a" === 1` is `false`) — though only the all-string shapes
 * are ADMITTED at compile time (`isStringCollectionEquality`).
 */
function eqTensor(
  a: unknown,
  b: unknown,
  tol: number
): boolean | (boolean | unknown[])[] {
  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr && bArr) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++)
      if (eqTensor(a[i], b[i], tol) !== true) return false;
    return true;
  }
  if (aArr) return a.map((x) => eqTensor(x, b, tol)) as (boolean | unknown[])[];
  if (bArr) return b.map((y) => eqTensor(a, y, tol)) as (boolean | unknown[])[];
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  const part = (v: unknown): { re: number; im: number } =>
    typeof v === 'object' && v !== null && 're' in v
      ? (v as { re: number; im: number })
      : { re: v as number, im: 0 };
  const pa = part(a);
  const pb = part(b);
  return Math.hypot(pa.re - pb.re, pa.im - pb.im) <= tol;
}

/**
 * Interpreter-faithful `NotEqual` (see `eqTensor`): element-wise negation for
 * an array-vs-scalar pair, a single negated boolean for array-vs-array and
 * scalar-vs-scalar.
 */
function neqTensor(
  a: unknown,
  b: unknown,
  tol: number
): boolean | (boolean | unknown[])[] {
  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr && bArr) return eqTensor(a, b, tol) !== true;
  if (aArr)
    return a.map((x) => neqTensor(x, b, tol)) as (boolean | unknown[])[];
  if (bArr)
    return b.map((y) => neqTensor(a, y, tol)) as (boolean | unknown[])[];
  return eqTensor(a, b, tol) !== true;
}

/**
 * Inverse by Gauss–Jordan with partial pivoting; a non-square or singular input
 * yields NaN (the interpreter stays inert for a singular matrix). Standalone so
 * `matpow` can reuse it for a negative exponent.
 */
function matinv(m: number[][]): number[][] | number {
  const n = m?.length;
  if (!n || m.some((row) => !Array.isArray(row) || row.length !== n))
    return NaN;
  const a = m.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ]);
  for (let i = 0; i < n; i++) {
    let piv = i;
    for (let r = i + 1; r < n; r++)
      if (Math.abs(a[r][i]) > Math.abs(a[piv][i])) piv = r;
    if (a[piv][i] === 0) return NaN;
    if (piv !== i) [a[i], a[piv]] = [a[piv], a[i]];
    const f = a[i][i];
    for (let c = 0; c < 2 * n; c++) a[i][c] /= f;
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const g = a[r][i];
      if (g === 0) continue;
      for (let c = 0; c < 2 * n; c++) a[r][c] -= g * a[i][c];
    }
  }
  return a.map((row) => row.slice(n));
}

/**
 * Conjugate transpose: transpose the matrix and complex-conjugate every element
 * (a real element is unchanged; a `{re,im}` element flips the sign of `im`). A
 * vector conjugates in place (transpose of a rank-1 vector is itself), matching
 * the interpreter and `_SYS.transpose`.
 */
function conjTranspose(m: any): any {
  const conj = (v: any): any =>
    v && typeof v === 'object' && 'im' in v ? { re: v.re, im: -v.im } : v;
  if (!Array.isArray(m)) return m;
  if (!Array.isArray(m[0])) return m.map(conj);
  return m[0].map((_: unknown, j: number) =>
    m.map((row: any[]) => conj(row[j]))
  );
}

/**
 * `Diagonal` dispatches on rank, matching the interpreter: a MATRIX yields its
 * main-diagonal vector (length `min(rows, cols)`); a VECTOR yields the square
 * matrix with that vector on the diagonal and zeros elsewhere.
 */
function diagonal(m: any): any {
  if (!Array.isArray(m)) return NaN;
  if (Array.isArray(m[0])) {
    const n = Math.min(m.length, m[0].length);
    const out: any[] = [];
    for (let i = 0; i < n; i++) out.push(m[i][i]);
    return out;
  }
  const n = m.length;
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? m[i] : 0))
  );
}

/**
 * Integer matrix power, mirroring the interpreter: `M^0` is the identity, `M^n`
 * folds `n` matrix products, and a negative power inverts first (`M^-n =
 * (M^-1)^n`). A non-square matrix, a singular matrix under a negative power, or
 * a non-integer exponent yields NaN (the interpreter errors / stays inert).
 */
function matpow(m: number[][], p: number): number[][] | number {
  if (!Array.isArray(m) || !Array.isArray(m[0])) return NaN;
  const n = m.length;
  if (m.some((r) => !Array.isArray(r) || r.length !== n)) return NaN;
  if (!Number.isInteger(p)) return NaN;
  let base: number[][] = m.map((r) => r.slice());
  let e = p;
  if (e < 0) {
    const inv = matinv(m);
    if (!Array.isArray(inv)) return NaN;
    base = inv as number[][];
    e = -e;
  }
  let result: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))
  );
  for (let k = 0; k < e; k++) result = matmul(result, base) as number[][];
  return result;
}

/**
 * Reduced row echelon form (Gauss–Jordan with partial pivoting), matching the
 * interpreter's `RowReduce`. A non-matrix operand yields NaN. Float arithmetic:
 * pivots are compared with an exact zero test (the same convention as `det`/
 * `inv`), so near-singular inputs with floating-point noise may pivot
 * differently than the exact interpreter.
 */
function rref(m: number[][]): number[][] | number {
  if (!Array.isArray(m) || !Array.isArray(m[0])) return NaN;
  const rows = m.length;
  const cols = m[0].length;
  const a = m.map((r) => r.slice());
  let r = 0;
  for (let c = 0; c < cols && r < rows; c++) {
    let piv = r;
    for (let i = r + 1; i < rows; i++)
      if (Math.abs(a[i][c]) > Math.abs(a[piv][c])) piv = i;
    if (a[piv][c] === 0) continue;
    if (piv !== r) [a[piv], a[r]] = [a[r], a[piv]];
    const lv = a[r][c];
    for (let j = 0; j < cols; j++) a[r][j] /= lv;
    for (let k = 0; k < rows; k++) {
      if (k === r) continue;
      const f = a[k][c];
      if (f === 0) continue;
      for (let j = 0; j < cols; j++) a[k][j] -= f * a[r][j];
    }
    r++;
  }
  return a;
}

/** Lazily built, then reused by every `_SYS.chars` call — see there. */
let graphemeSegmenter: Intl.Segmenter | undefined = undefined;

/**
 * Runtime helpers injected as `_SYS` into compiled JavaScript functions.
 * Shared by both ComputeEngineFunction and ComputeEngineFunctionLiteral.
 */
const SYS_HELPERS = {
  bcast,
  bcastFn,
  // Element-wise addition, mirroring the interpreter's `Add` broadcast
  // (`addTensors`/`broadcastOverIndexedCollections`): scalar+scalar is ordinary
  // addition; over (possibly nested) arrays it recurses element-wise. Used as
  // the `Sum` collection-reduce combiner on the possibly-collection path, where
  // the elements may themselves be vectors/matrices at run time.
  add: (a: BcastValue, b: BcastValue): BcastValue =>
    bcast((x, y) => (x as number) + (y as number), a, b),
  chop,
  // `x! = Γ(x+1)`, matching the interpreter's `Factorial` evaluate handler.
  // The shared `factorial()` helper is integer-only (it returns NaN for a
  // non-integer), so a non-integer argument goes through Γ instead —
  // `(-1/2)! = Γ(1/2) = √π`, not NaN (Tycho item 99). The non-negative
  // integer fast path is unchanged (`n > 170 → Infinity`; `170!` itself is
  // the largest double-representable factorial and stays finite).
  // A negative *integer* is a pole of Γ(x+1): the interpreter returns
  // ComplexInfinity, which a real target projects to NaN (the same value
  // compiled `~oo` yields), so poles stay NaN.
  factorial: (x: number): number =>
    Number.isInteger(x) ? (x < 0 ? NaN : factorial(x)) : gamma(x + 1),
  factorial2,
  gamma,
  gcd,
  // Numeric-differentiation fallback (item 177): `_SYS.nd(f, k)` returns the
  // function x ↦ (numeric k-th derivative of f at x). Emitted by
  // `compileDerivative` (library/calculus.ts) when the symbolic closed form
  // is unavailable (the differentiation growth budget tripped, or the head
  // stayed unresolved). The implementation is the SAME exported function the
  // interpreter's fallback calls (`centeredDiffHigherOrder`,
  // numerics/numeric.ts), so compiled and interpreted values are
  // bit-identical — Tycho's route-parity requirement.
  nd:
    (f: (x: number) => number, order: number) =>
    (x: number): number =>
      centeredDiffHigherOrder(f, x, order),
  // Power with the interpreter's 0^0 = NaN convention. `Math.pow(0, 0)` is 1,
  // but the interpreter treats a genuine 0^0 as indeterminate (NaN). Used only
  // on the variable-exponent path — where the exponent could be 0 at run time
  // (a constant nonzero exponent stays on the plain `Math.pow` fast path). See
  // finding CO-P2-24.
  pow: (base: number, exp: number): number =>
    base === 0 && exp === 0 ? NaN : Math.pow(base, exp),
  // Fail-closed Which/When condition guard. The interpreter requires a
  // condition to evaluate to True/False and throws otherwise; a compiled
  // ternary would silently treat a non-boolean (notably NaN) as falsy and take
  // the default branch. Rethrow to match the interpreter (D6, CO-P2-24).
  cond: (c: unknown): boolean => {
    if (c === true || c === false) return c;
    throw new Error('Condition must evaluate to "True" or "False".');
  },
  // Element-wise `Which`/`If` selection over a condition that may be a
  // collection at run time — see `select` and `compileJSSelection`.
  select,
  heaviside: (x: number) => (x < 0 ? 0 : x === 0 ? 0.5 : 1),
  // `Characters`/`GraphemeClusters`: the interpreter's own decomposition —
  // UAX #29 grapheme clusters via `Intl.Segmenter` (`splitGraphemeClusters` in
  // `library/core.ts`), with the NFC normalization `engine.string()` applies to
  // the input and to every element. Deliberately not `[...s]` (code points) nor
  // `s.split('')` (UTF-16 units): both disagree with the interpreter on a
  // combining sequence, a ZWJ emoji or a flag. The segmenter is built once —
  // constructing one per call dominates the cost in a scanner loop.
  chars: (s: unknown): string[] => {
    if (typeof s !== 'string')
      throw new Error('Characters: expected a string operand');
    graphemeSegmenter ??= new Intl.Segmenter('en', { granularity: 'grapheme' });
    return Array.from(graphemeSegmenter.segment(s.normalize()), (seg) =>
      seg.segment.normalize()
    );
  },
  // --- Lazy infinite-collection streams ---------------------------------
  // A STATICALLY infinite collection (`Range(1, ∞)` and the Map/Filter/Drop/
  // Rest pipeline over it) has no array representation, so it compiles to a
  // lazy iterator instead, materialized by a bounding consumer
  // (`takeIter`/`takeWhileIter`). These helpers are emitted ONLY by
  // `emitLazyStream` — the eager collection lowering never produces or
  // consumes them, and an infinite pipeline that never reaches `Take`/
  // `TakeWhile` fails closed at compile time (see the `Range` handler and
  // `collArg`). Only the two non-scanning helpers live here; the four
  // SCANNING helpers (`filterIter`/`dropIter`/`takeIter`/`takeWhileIter`)
  // need the owning engine's iteration limit, so they are bound per compiled
  // artifact by `makeLazyStreamHelpers(ce)` below, like the random helpers.
  rangeIter: function* (start: number, step: number): Generator<number> {
    for (let x = start; ; x += step) yield x;
  },
  mapIter: function* (
    it: Iterable<unknown>,
    f: (x: unknown) => unknown
  ): Generator<unknown> {
    for (const x of it) yield f(x);
  },
  // NOTE: the random helpers (`drawNextRandomNumber`, `withRandomSeed`, the
  // `domain*` descriptor builders, `randomPick`/`randomChoice`/
  // `randomSample`/`shuffle`) are deliberately NOT defined here: they need the
  // OWNING ENGINE, so they are bound per compiled artifact by
  // `makeSysHelpers(ce)` below. A shared instance would have to reach a
  // module-level slot — a process singleton cross-contaminating engines.
  // --- Linear algebra (real, nested-array representation) ----------------
  // Dimension mismatches yield NaN (the interpreter's error/inert result
  // projected onto a real target).
  //
  // Product dispatch on dimensionality, mirroring the interpreter's
  // `Dot`/`MatrixMultiply`: vector·vector → scalar, matrix·vector → vector,
  // vector·matrix → vector, matrix·matrix → matrix.
  matmul,
  // Interpreter-faithful `Multiply` over a mix of scalars and (possibly
  // nested) real arrays whose collection-ness was not statically provable —
  // see `tryCompileBroadcast`'s ≥2-possibly-collection branch.
  mul: mulTensor,
  // Interpreter-faithful `Equal`/`NotEqual` over operands whose
  // collection-ness was not statically provable — see `compileJSEquality`'s
  // possibly-collection lowering (Tycho item 41).
  eq: eqTensor,
  neq: neqTensor,
  cross: (a: number[], b: number[]): number[] | number =>
    a.length === 3 && b.length === 3
      ? [
          a[1] * b[2] - a[2] * b[1],
          a[2] * b[0] - a[0] * b[2],
          a[0] * b[1] - a[1] * b[0],
        ]
      : NaN,
  // Norm: |x| for a scalar; the 2-norm (Frobenius for a matrix) by default.
  // With an explicit p: for a vector the p-norm (Σ|xᵢ|^p)^(1/p), p =
  // Infinity → max |xᵢ|; for a matrix the operator norms the interpreter
  // implements — p = 1 → max column abs sum, p = Infinity → max row abs
  // sum. Other matrix p-norms (e.g. the spectral 2-norm, which needs an
  // SVD) yield NaN.
  norm: (x: unknown, p?: number): number => {
    if (typeof x === 'number') return Math.abs(x);
    if (!Array.isArray(x)) return NaN;
    if (Array.isArray(x[0]) && p !== undefined) {
      const m = x as number[][];
      if (p === 1) {
        let best = 0;
        for (let j = 0; j < m[0].length; j++) {
          let s = 0;
          for (let i = 0; i < m.length; i++) s += Math.abs(m[i][j]);
          best = Math.max(best, s);
        }
        return best;
      }
      if (p === Infinity) {
        let best = 0;
        for (const row of m) {
          let s = 0;
          for (const v of row) s += Math.abs(v);
          best = Math.max(best, s);
        }
        return best;
      }
      return NaN;
    }
    const flat = x.flat(Infinity) as number[];
    if (p === Infinity) {
      let m = 0;
      for (const v of flat) m = Math.max(m, Math.abs(v));
      return m;
    }
    if (p === undefined || p === 2) {
      let s = 0;
      for (const v of flat) s += v * v;
      return Math.sqrt(s);
    }
    let s = 0;
    for (const v of flat) s += Math.pow(Math.abs(v), p);
    return Math.pow(s, 1 / p);
  },
  // Transpose of a 2D matrix; a vector (or scalar) is returned unchanged,
  // like the interpreter.
  transpose: (m: any): any => {
    if (!Array.isArray(m) || !Array.isArray(m[0])) return m;
    return m[0].map((_: unknown, j: number) =>
      m.map((row: number[]) => row[j])
    );
  },
  // Determinant by Gaussian elimination with partial pivoting; a non-square
  // input yields NaN.
  det: (m: number[][]): number => {
    const n = m?.length;
    if (!n || m.some((row) => !Array.isArray(row) || row.length !== n))
      return NaN;
    const a = m.map((row) => row.slice());
    let d = 1;
    for (let i = 0; i < n; i++) {
      let piv = i;
      for (let r = i + 1; r < n; r++)
        if (Math.abs(a[r][i]) > Math.abs(a[piv][i])) piv = r;
      if (a[piv][i] === 0) return 0;
      if (piv !== i) {
        [a[i], a[piv]] = [a[piv], a[i]];
        d = -d;
      }
      d *= a[i][i];
      for (let r = i + 1; r < n; r++) {
        const f = a[r][i] / a[i][i];
        for (let c = i; c < n; c++) a[r][c] -= f * a[i][c];
      }
    }
    return d;
  },
  // Inverse by Gauss–Jordan with partial pivoting; a non-square or singular
  // input yields NaN (the interpreter stays inert for a singular matrix).
  inv: matinv,
  // Conjugate transpose, diagonal (rank-dispatched), integer matrix power, and
  // reduced row echelon form — see the standalone helpers above.
  conjTranspose,
  diagonal,
  matpow,
  rref,
  trace: (m: number[][]): number => {
    if (!Array.isArray(m) || !Array.isArray(m[0])) return NaN;
    let s = 0;
    for (let i = 0; i < Math.min(m.length, m[0].length); i++) {
      // A rank > 2 tensor has array diagonal entries — adding one would
      // string-concatenate. Only a numeric diagonal sums; anything else is
      // NaN.
      if (typeof m[i][i] !== 'number') return NaN;
      s += m[i][i];
    }
    return s;
  },
  // Dimensions of a (regular) nested array, measured along first elements.
  shape: (x: unknown): number[] => {
    const dims: number[] = [];
    let cur = x;
    while (Array.isArray(cur)) {
      dims.push(cur.length);
      cur = cur[0];
    }
    return dims;
  },
  // Reshape with cyclic padding (Mathematica-style, matching the
  // interpreter): the source is flattened, then elements fill the new shape,
  // wrapping around when the source is shorter. 1-D and 2-D shapes.
  reshape: (x: unknown[], dims: number[]): unknown => {
    const flat = x.flat(Infinity);
    if (flat.length === 0) return NaN;
    const at = (i: number) => flat[i % flat.length];
    if (dims.length === 1)
      return Array.from({ length: Math.max(0, dims[0]) }, (_, i) => at(i));
    if (dims.length === 2)
      return Array.from({ length: Math.max(0, dims[0]) }, (_, i) =>
        Array.from({ length: Math.max(0, dims[1]) }, (_, j) =>
          at(i * dims[1] + j)
        )
      );
    return NaN;
  },
  // Positional access for compiled `At`. CE `At` is 1-based; a negative index
  // counts from the end. A zero or out-of-range index yields NaN (the
  // interpreter returns `Nothing`, projected to NaN on a real target).
  //
  // A COMPLEX index value arrives as an `{ re, im }` object; the interpreter
  // reads its `.re` and ignores the imaginary part, so `indexValue` does the
  // same. Doing this at RUN time rather than gating at compile time is
  // deliberate: the index's declared type is routinely far wider than its
  // runtime value (a comprehension variable types as
  // `boolean | indexed_collection | number | string`), so a static
  // "provably real" gate rejected ordinary compilable code.
  //
  // The index may itself be a collection at run time (a literal list, or the
  // array a `_SYS.bcast` index expression such as `p[X-1]` produces), so
  // dispatch on its shape here rather than at compile time. A collection index
  // mirrors the interpreter's `At` Case B:
  //  - boolean mask (EVERY entry a boolean — an empty index is a mask, since
  //    `every` on an empty array is true): keep element i where mask[i] is
  //    true, 1-based; mask entries past the end contribute nothing;
  //  - integer gather: select each indexed element, negative entries counting
  //    from the end (same normalization as the scalar path). POSITION-
  //    PRESERVING: an out-of-range entry contributes NaN in place (the
  //    interpreter's absence marker), so the result always has the same
  //    length as the index list.
  // A non-integer entry makes the interpreter decline — `At` stays unevaluated
  // and produces no value at all — so the WHOLE result is NaN (the projection
  // of "no value" on a real target), not a per-slot NaN, which would invent an
  // element the interpreter never produces.
  at: (arr: unknown, i: number | unknown[]): number | unknown[] => {
    if (!Array.isArray(arr)) return NaN;
    const n = arr.length;
    if (Array.isArray(i)) {
      const picked: unknown[] = [];
      // A boolean MASK is a filter, but its length must EQUAL the collection
      // length (BREAKING — was a silent prefix). A mismatch makes the
      // interpreter decline (an error), projected here as a whole-result NaN.
      // An EMPTY index is a gather that yields the empty list (not a mask —
      // `every` on an empty array is true), so guard the length explicitly.
      if (i.length > 0 && i.every((m) => typeof m === 'boolean')) {
        if (i.length !== n) return NaN;
        i.forEach((m, k) => {
          if (m === true) picked.push(arr[k]);
        });
        return picked;
      }
      for (const m of i) {
        const mv = indexValue(m);
        if (!Number.isInteger(mv)) return NaN;
        const idx = mv > 0 ? mv - 1 : n + mv;
        // Out-of-range (or zero) index: keep the position, mark the absence
        // (POSITION-PRESERVING gather — matches the interpreter, whose
        // out-of-band access yields the absence marker, `NaN` for a numeric
        // collection). The result always has the same length as the index list.
        if (mv === 0 || idx < 0 || idx >= n) picked.push(NaN);
        else picked.push(arr[idx]);
      }
      return picked;
    }
    // Scalar index. The interpreter's Case C reads the index's `.re` and
    // accepts it only if that is an INTEGER, otherwise declining (`At` stays
    // unevaluated, producing no value) — so anything else projects to NaN.
    // Guard explicitly rather than falling into index arithmetic: JS coercion
    // would silently invent a value — `true` would index slot 0 (`true > 0`,
    // `true - 1 === 0`) and a fractional or NaN index would read a
    // non-existent property and yield `undefined`.
    const iv = indexValue(i);
    if (!Number.isInteger(iv)) return NaN;
    const idx = iv > 0 ? iv - 1 : n + iv;
    if (i === 0 || idx < 0 || idx >= n) return NaN;
    return arr[idx] as number;
  },
  // Definite integral via deterministic adaptive Gauss–Kronrod (GK15) — near
  // machine precision on smooth integrands, µs-scale. On non-convergence
  // (pathological integrand), fall back to the Monte-Carlo estimator — but only
  // when sampling could actually improve on the quadrature bound
  // (`quadratureBeatsMonteCarlo`): an inner level of an iterated integral pays
  // this fallback once per OUTER node, so 1e7 samples of a stalled-but-accurate
  // result is minutes spent making the answer worse. See `compileIntegrate`.
  integrate: (f: (x: number) => number, a: number, b: number) => {
    const r = adaptiveQuadrature(f, a, b);
    // A diagnosed divergence has no finite value, and sampling it would only
    // launder the divergence into a plausible-looking number.
    if (r.divergent) return NaN;
    if (r.converged || quadratureBeatsMonteCarlo(r, 10e6)) return r.estimate;
    return monteCarloEstimate(f, a, b, 10e6).estimate;
  },
  // Definite integral via Monte-Carlo (1e7 uniform samples). STOCHASTIC and
  // approximate (~1e-4 typical error, ~200 ms/call). Emitted when
  // `quadrature: 'monte-carlo'` is requested — see `compileIntegrate`.
  integrateMC: (f: (x: number) => number, a: number, b: number) =>
    monteCarloEstimate(f, a, b, 10e6).estimate,
  lcm,
  lngamma: gammaln,
  limit,
  mean,
  median,
  variance,
  populationVariance,
  standardDeviation,
  populationStandardDeviation,
  kurtosis,
  skewness,
  mode,
  quartiles,
  interquartileRange,
  covariance,
  populationCovariance,
  correlation,
  erf,
  erfc,
  erfInv,
  beta,
  gammaQ,
  betaRegularized,
  digamma,
  trigamma,
  polygamma,
  zeta,
  lambertW,
  besselJ,
  besselY,
  besselI,
  besselK,
  airyAi,
  airyBi,
  airyAiPrime,
  airyBiPrime,
  sinc,
  fresnelS,
  fresnelC,
  sinIntegral,
  cosIntegral,
  expIntegralEi,
  logIntegral,
  erfi,
  agm,
  ellipticK,
  ellipticE,
  ellipticEIncomplete,
  ellipticF,
  ellipticPiComplete,
  ellipticPiIncomplete,
  hypergeometric2F1,
  hypergeometric1F1,
  mandelbrot: (c: number | { re: number; im: number }, maxIter: number) => {
    let zx = 0,
      zy = 0;
    const cx = typeof c === 'number' ? c : c.re;
    const cy = typeof c === 'number' ? 0 : c.im;
    const n = Math.round(maxIter);
    for (let i = 0; i < n; i++) {
      const newZx = zx * zx - zy * zy + cx;
      zy = 2 * zx * zy + cy;
      zx = newZx;
      const mag2 = zx * zx + zy * zy;
      if (mag2 > 4) {
        const smooth = (i - Math.log2(Math.log2(mag2)) + 4.0) / n;
        return Math.max(0, Math.min(1, smooth));
      }
    }
    return 1.0;
  },
  julia: (
    z: number | { re: number; im: number },
    c: number | { re: number; im: number },
    maxIter: number
  ) => {
    let zx = typeof z === 'number' ? z : z.re;
    let zy = typeof z === 'number' ? 0 : z.im;
    const cx = typeof c === 'number' ? c : c.re;
    const cy = typeof c === 'number' ? 0 : c.im;
    const n = Math.round(maxIter);
    for (let i = 0; i < n; i++) {
      const newZx = zx * zx - zy * zy + cx;
      zy = 2 * zx * zy + cy;
      zx = newZx;
      const mag2 = zx * zx + zy * zy;
      if (mag2 > 4) {
        const smooth = (i - Math.log2(Math.log2(mag2)) + 4.0) / n;
        return Math.max(0, Math.min(1, smooth));
      }
    }
    return 1.0;
  },
  binomial: choose,
  fibonacci,
  // Complex helpers
  csin: (z: ComplexResult) => toRI(new Complex(z.re, z.im).sin()),
  ccos: (z: ComplexResult) => toRI(new Complex(z.re, z.im).cos()),
  ctan: (z: ComplexResult) => toRI(new Complex(z.re, z.im).tan()),
  casin: (z: ComplexResult) => toRI(new Complex(z.re, z.im).asin()),
  cacos: (z: ComplexResult) => toRI(new Complex(z.re, z.im).acos()),
  catan: (z: ComplexResult) => toRI(new Complex(z.re, z.im).atan()),
  csinh: (z: ComplexResult) => toRI(new Complex(z.re, z.im).sinh()),
  ccosh: (z: ComplexResult) => toRI(new Complex(z.re, z.im).cosh()),
  ctanh: (z: ComplexResult) => toRI(new Complex(z.re, z.im).tanh()),
  csqrt: (z: ComplexResult) => toRI(new Complex(z.re, z.im).sqrt()),
  // hav⁻¹(z) = 2·arcsin(√z), continued to the complex plane
  cinvhav: (z: ComplexResult) =>
    toRI(new Complex(z.re, z.im).sqrt().asin().mul(2)),
  cexp: (z: ComplexResult) => toRI(new Complex(z.re, z.im).exp()),
  cln: (z: ComplexResult) => toRI(new Complex(z.re, z.im).log()),
  cpow: (z: number | ComplexResult, w: number | ComplexResult) => {
    const zz =
      typeof z === 'number' ? new Complex(z, 0) : new Complex(z.re, z.im);
    const ww =
      typeof w === 'number' ? new Complex(w, 0) : new Complex(w.re, w.im);
    return toRI(zz.pow(ww));
  },
  ccot: (z: ComplexResult) => toRI(new Complex(z.re, z.im).cot()),
  csec: (z: ComplexResult) => toRI(new Complex(z.re, z.im).sec()),
  ccsc: (z: ComplexResult) => toRI(new Complex(z.re, z.im).csc()),
  ccoth: (z: ComplexResult) => toRI(new Complex(z.re, z.im).coth()),
  csech: (z: ComplexResult) => toRI(new Complex(z.re, z.im).sech()),
  ccsch: (z: ComplexResult) => toRI(new Complex(z.re, z.im).csch()),
  cacot: (z: ComplexResult) => toRI(new Complex(z.re, z.im).acot()),
  casec: (z: ComplexResult) => toRI(new Complex(z.re, z.im).asec()),
  cacsc: (z: ComplexResult) => toRI(new Complex(z.re, z.im).acsc()),
  cacoth: (z: ComplexResult) => toRI(new Complex(z.re, z.im).acoth()),
  casech: (z: ComplexResult) => toRI(new Complex(z.re, z.im).asech()),
  cacsch: (z: ComplexResult) => toRI(new Complex(z.re, z.im).acsch()),
  cacosh: (z: ComplexResult) => toRI(new Complex(z.re, z.im).acosh()),
  catanh: (z: ComplexResult) => toRI(new Complex(z.re, z.im).atanh()),
  cabs: (z: ComplexResult) => new Complex(z.re, z.im).abs(),
  carg: (z: ComplexResult) => new Complex(z.re, z.im).arg(),
  cconj: (z: ComplexResult) => toRI(new Complex(z.re, z.im).conjugate()),
  cneg: (z: ComplexResult) => ({ re: -z.re, im: -z.im }),
  // Color helpers
  ...colorHelpers,
};

/**
 * A compiled random domain, built (and validated) at RUN time by the
 * `_SYS.domain*` builders. `continuous` is an `Interval`; everything else is
 * an indexed domain of `n` elements addressed by a 0-based `at`.
 */
type RandomDomainDescriptor =
  | { continuous: true; lo: number; hi: number }
  | { continuous: false; n: number; at: (i: number) => unknown };

/** The engine-bound half of the `_SYS` bundle: the random family. */
type RandomSysHelpers = {
  drawNextRandomNumber: () => number;
  withRandomSeed: <T>(seed: unknown, body: () => T) => T;
  domainInterval: (
    op: string,
    lo: number,
    hi: number
  ) => RandomDomainDescriptor;
  domainRange: (
    op: string,
    a: number,
    b: number,
    s?: number
  ) => RandomDomainDescriptor;
  domainList: (op: string, xs: unknown) => RandomDomainDescriptor;
  randomPick: (d: RandomDomainDescriptor) => unknown;
  randomChoice: (d: RandomDomainDescriptor, k: unknown) => unknown[];
  randomSample: (d: RandomDomainDescriptor, k: unknown) => unknown[];
  shuffle: (xs: unknown[]) => unknown[];
};

/** The `_SYS` bundle injected into a compiled JavaScript function. */
type LazyStreamSysHelpers = {
  filterIter: (
    it: Iterable<unknown>,
    p: (x: unknown) => unknown
  ) => Generator<unknown>;
  dropIter: (it: Iterable<unknown>, n: number) => Generator<unknown>;
  takeIter: (it: Iterable<unknown>, n: number) => unknown[];
  takeWhileIter: (
    it: Iterable<unknown>,
    p: (x: unknown) => unknown
  ) => unknown[];
};

type SysHelpers = typeof SYS_HELPERS & RandomSysHelpers & LazyStreamSysHelpers;

/**
 * The random family of `_SYS`, bound to the engine that compiled the artifact.
 *
 * The binding is an ENGINE REFERENCE, not a frame handle: there is exactly one
 * `WithRandomSeed` frame stack per engine, and both the interpreter and
 * compiled code reach it through the engine. So a compiled function called
 * from inside an interpreted frame draws from that frame (dynamic scoping
 * across the compile boundary), two engines never share frames, and a call
 * made outside any evaluation sees an empty stack and draws live.
 *
 * Compiled code cannot raise the interpreter's structured errors, so every
 * validation failure here is a plain `Error` naming the operator — never a
 * silent `NaN` or a reversed draw.
 *
 * Every draw goes through `ce._random()`, the SAME primitive the interpreter
 * uses, so interpreted/compiled parity for framed draws is by construction
 * rather than by two implementations kept in agreement. Draw ORDER and COUNT
 * are equally load-bearing (the frame's counter is shared), so each loop below
 * mirrors its interpreted counterpart step for step.
 */
function makeRandomHelpers(ce: ComputeEngine): RandomSysHelpers {
  const cap = MAX_RANDOM_ELEMENT_COUNT;

  /** The `k` operand, rounded and validated — the compiled half of
   * `randomCount` (`library/random-utils.ts`). `toInteger` rounds half toward
   * `+∞`, which is what `Math.round` does. */
  const count = (op: string, k: unknown): number => {
    const v = typeof k === 'number' ? Math.round(k) : NaN;
    if (!Number.isSafeInteger(v) || v < 0 || v > cap)
      throw new Error(`${op}: expected a count in 0..${cap}, got ${k}`);
    return v;
  };

  /** The uniform-driven element of an indexed descriptor. */
  const pick = (d: RandomDomainDescriptor, u: number): unknown =>
    d.continuous ? d.lo + u * (d.hi - d.lo) : d.at(Math.floor(u * d.n));

  return {
    // The one primitive: `ce._random()` already branches at CALL time —
    // innermost frame → `hash(seed, n)` and advance; no frame → live.
    drawNextRandomNumber: () => ce._random(),

    withRandomSeed: <T>(seed: unknown, body: () => T): T => {
      if (
        (typeof seed !== 'number' || !Number.isFinite(seed)) &&
        typeof seed !== 'string'
      )
        throw new Error(
          `WithRandomSeed: expected a finite real number or a string seed, got ${String(seed)}`
        );
      return withRandomSeedFrame(ce, seed as number | string, body);
    },

    domainInterval: (op, lo, hi) => {
      if (!Number.isFinite(lo) || !Number.isFinite(hi))
        throw new Error(
          `${op}: expected a bounded Interval, got (${lo}, ${hi})`
        );
      if (!(hi > lo))
        throw new Error(
          `${op}: expected a non-empty Interval, got (${lo}, ${hi})`
        );
      return { continuous: true, lo, hi };
    },

    domainRange: (op, a, b, s) => {
      // The normalization of `range()` + the `Range` handler's `count`
      // (`library/collections.ts`): a two-operand range descends when
      // `b < a`, and a zero or sign-mismatched step is empty.
      const step = s === undefined ? (b >= a ? 1 : -1) : s;
      const n =
        step === 0
          ? 0
          : !Number.isFinite(a) || !Number.isFinite(b)
            ? Infinity
            : Math.max(0, Math.floor((b - a) / step) + 1);
      if (!Number.isFinite(n) || n <= 0)
        throw new Error(
          `${op}: expected a finite, non-empty Range, got Range(${a}, ${b}, ${step})`
        );
      return { continuous: false, n, at: (i) => a + step * i };
    },

    domainList: (op, xs) => {
      if (!Array.isArray(xs))
        throw new Error(`${op}: expected a finite indexed collection`);
      if (xs.length === 0)
        throw new Error(`${op}: expected a non-empty collection`);
      return { continuous: false, n: xs.length, at: (i) => xs[i] };
    },

    // `Random(domain)` — exactly ONE draw, for every domain kind.
    randomPick: (d) => pick(d, ce._random()),

    // `RandomChoice(domain, k)` — exactly `k` draws, WITH replacement, in
    // output order.
    randomChoice: (d, k) => {
      const n = count('RandomChoice', k);
      const out: unknown[] = new Array(n);
      for (let i = 0; i < n; i++) {
        if ((i & 0x3ff) === 0) checkDeadline(ce._deadlineFrame);
        out[i] = pick(d, ce._random());
      }
      return out;
    },

    // `RandomSample(domain, k)` — exactly `k` draws, WITHOUT replacement, by
    // the same SPARSE Fisher-Yates over the index space as the interpreter
    // (`library/statistics.ts`): only the touched positions are held, so
    // `RandomSample(Range(1, 10^6), 3)` never materializes the domain.
    randomSample: (d, k) => {
      if (d.continuous)
        throw new Error(
          `RandomSample: an Interval is not an indexed collection`
        );
      const n = count('RandomSample', k);
      // Unlike `RandomChoice`, `k` may not exceed the domain size.
      if (n > d.n)
        throw new Error(
          `RandomSample: expected a count in 0..${d.n}, got ${n}`
        );
      const swapped = new Map<number, number>();
      const at = (i: number): number => swapped.get(i) ?? i;
      const out: unknown[] = new Array(n);
      for (let i = 0; i < n; i++) {
        if ((i & 0x3ff) === 0) checkDeadline(ce._deadlineFrame);
        const j = i + Math.floor(ce._random() * (d.n - i));
        const vi = at(i);
        const vj = at(j);
        swapped.set(i, vj);
        swapped.set(j, vi);
        out[i] = d.at(vj);
      }
      return out;
    },

    // `RandomShuffle(xs)` — unbiased Fisher-Yates on a copy, consuming
    // exactly `n − 1` draws in the interpreter's order and direction
    // (`library/collections.ts`).
    shuffle: (xs: unknown[]): unknown[] => {
      if (xs.length > cap)
        throw new Error(
          `RandomShuffle: expected a collection of at most ${cap} elements`
        );
      const l = xs.slice();
      for (let i = l.length - 1; i > 0; i--) {
        if ((i & 0x3ff) === 0) checkDeadline(ce._deadlineFrame);
        const j = Math.floor(ce._random() * (i + 1));
        [l[i], l[j]] = [l[j], l[i]];
      }
      return l;
    },
  };
}

/**
 * Build the `_SYS` bundle for ONE compiled function.
 *
 * The stateless helpers are shared through the prototype chain (no per-compile
 * copying); the random family gets own bindings over the OWNING ENGINE, so
 * `_SYS.drawNextRandomNumber()` resolves that engine's active
 * `WithRandomSeed` frame at call time.
 */
/**
 * The four SCANNING lazy-stream helpers, bound to the owning engine so each
 * source walk is capped at `ce.iterationLimit` (read at call time, so later
 * assignments to the property apply). The interpreter enforces the same
 * guard on the corresponding walks — the `Filter`/`TakeWhile` iterators in
 * `library/collections.ts` throw `iteration-limit-exceeded` — and without it
 * a predicate that never matches on an infinite source
 * (`Take(Filter(1..∞, x → False), 1)`) would lock the caller's thread.
 * `rangeIter`/`mapIter` need no cap of their own: they advance exactly one
 * step per pull, and every pull chain terminates in one of these capped
 * scanners (only `takeIter`/`takeWhileIter` materialize).
 */
function makeLazyStreamHelpers(ce: ComputeEngine): LazyStreamSysHelpers {
  // The interpreter's integer-count contract (`toInteger`,
  // `boxed-expression/numerics.ts`): round to the nearest integer; a
  // non-finite count, or one outside the safe-integer range (|n| > 2^53), does
  // NOT resolve. An unresolved count is a PRESENT-but-invalid parameter, which
  // the interpreter's collection handlers route to their indeterminate
  // channel — an EMPTY walk (`integerParam`, `library/collections.ts`) — never
  // to a substituted default. So `Take(1..∞, NaN)` is `[]` because the walk is
  // indeterminate, `Drop(1..∞, NaN)` under a `Take` contributes NO elements
  // (not "drops nothing"), and a count like `1e100` yields the empty walk
  // instead of a loop that can never finish over an infinite source.
  const intCount = (n: number): number | null => {
    if (!Number.isFinite(n)) return null;
    const k = Math.round(n);
    return Number.isSafeInteger(k) ? k : null;
  };
  const exceeded = (op: string): Error =>
    new Error(
      `Iteration limit of ${ce.iterationLimit} exceeded while evaluating ${op}()`
    );
  return {
    // Predicate TRUTHINESS, matching the eager `Filter` lowering
    // (`.filter((_x) => _f(_x))`).
    filterIter: function* (it, p) {
      let pulls = 0;
      for (const x of it) {
        if (++pulls > ce.iterationLimit) throw exceeded('Filter');
        if (p(x)) yield x;
      }
    },
    // A negative count drops nothing (`Drop(xs, -2)` is `xs`, matching the
    // eager lowering's clamp and the interpreter).
    dropIter: function* (it, n) {
      const k = intCount(n);
      if (k === null) return;
      let dropped = 0;
      let pulls = 0;
      for (const x of it) {
        if (++pulls > ce.iterationLimit) throw exceeded('Drop');
        if (dropped < k) {
          dropped++;
          continue;
        }
        yield x;
      }
    },
    // Materialize the first k elements of a (possibly infinite) stream — one
    // of the two points where a lazy pipeline becomes an array. A negative or
    // invalid count yields [].
    takeIter: (it, n) => {
      const k = intCount(n);
      if (k === null || k <= 0) return [];
      const out: unknown[] = [];
      let pulls = 0;
      for (const x of it) {
        if (++pulls > ce.iterationLimit) throw exceeded('Take');
        out.push(x);
        if (out.length >= k) break;
      }
      return out;
    },
    // Longest satisfying prefix of a (possibly infinite) stream. A predicate
    // that never turns false does not produce a prefix; the iteration cap
    // turns that into the interpreter's iteration-limit error instead of a
    // hang.
    takeWhileIter: (it, p) => {
      const out: unknown[] = [];
      let pulls = 0;
      for (const x of it) {
        if (++pulls > ce.iterationLimit) throw exceeded('TakeWhile');
        if (!p(x)) break;
        out.push(x);
      }
      return out;
    },
  };
}

function makeSysHelpers(ce: ComputeEngine): SysHelpers {
  const sys = Object.create(SYS_HELPERS) as SysHelpers;
  Object.assign(sys, makeRandomHelpers(ce), makeLazyStreamHelpers(ce));
  return sys;
}

/**
 * JavaScript-specific function extension that provides system functions
 */
export class ComputeEngineFunction extends Function {
  SYS: SysHelpers;

  constructor(ce: ComputeEngine, body: string, preamble = '') {
    super(
      '_SYS',
      '_',
      preamble ? `${preamble};return ${body}` : `return ${body}`
    );
    this.SYS = makeSysHelpers(ce);
    return new Proxy(this, {
      apply: (target, thisArg, argumentsList) =>
        super.apply(thisArg, [this.SYS, ...argumentsList]),
      get: (target, prop) => {
        if (prop === 'toString') return (): string => body;
        if (prop === 'isCompiled') return true;
        return Reflect.get(target, prop);
      },
    });
  }
}

/**
 * JavaScript function literal with parameters
 */
export class ComputeEngineFunctionLiteral extends Function {
  SYS: SysHelpers;

  constructor(ce: ComputeEngine, body: string, args: string[], preamble = '') {
    super(
      '_SYS',
      ...args,
      preamble ? `${preamble}return ${body}` : `return ${body}`
    );
    this.SYS = makeSysHelpers(ce);
    return new Proxy(this, {
      apply: (target, thisArg, argumentsList) =>
        super.apply(thisArg, [this.SYS, ...argumentsList]),
      get: (target, prop) => {
        if (prop === 'toString')
          return (): string =>
            preamble
              ? `(${args.join(', ')}) => { ${preamble}return ${body}; }`
              : `(${args.join(', ')}) => ${body}`;
        if (prop === 'isCompiled') return true;
        return Reflect.get(target, prop);
      },
    });
  }
}

/**
 * JavaScript language target implementation
 */
export class JavaScriptTarget implements LanguageTarget<Expression> {
  getOperators(): CompiledOperators {
    return JAVASCRIPT_OPERATORS;
  }

  getFunctions(): CompiledFunctions<Expression> {
    return JAVASCRIPT_FUNCTIONS;
  }

  createTarget(
    options: Partial<CompileTarget<Expression>> = {}
  ): CompileTarget<Expression> {
    return {
      language: 'javascript',
      operators: (op) => JAVASCRIPT_OPERATORS[op],
      functions: (id) => JAVASCRIPT_FUNCTIONS[id],
      var: (id) => {
        const result = {
          Pi: 'Math.PI',
          ExponentialE: 'Math.E',
          // The boolean literals are constants, not free symbols: otherwise a
          // literal mask (e.g. `p[[False, True, True]]`) compiles to a dangling
          // `_.False`/`_.True` vars-object lookup and throws at run time.
          True: 'true',
          False: 'false',
          NaN: 'Number.NaN',
          ImaginaryUnit: '({ re: 0, im: 1 })',
          Half: '0.5',
          MachineEpsilon: 'Number.EPSILON',
          GoldenRatio: '((1 + Math.sqrt(5)) / 2)',
          CatalanConstant: '0.91596559417721901',
          EulerGamma: '0.57721566490153286',
        }[id];
        return result;
      },
      string: (str) => JSON.stringify(str),
      number: (n) => n.toString(),
      complex: (re, im) => `({ re: ${re}, im: ${im} })`,
      // Evaluate shared middle operands of a chained relation exactly once
      // (matching the interpreter) by binding them in an IIFE.
      bindExpr: (bindings, body) =>
        `((${bindings.map((b) => b[0]).join(', ')}) => ${body})(${bindings
          .map((b) => b[1])
          .join(', ')})`,
      // Dependency-ordered CSE temporaries: a sequential-`const` IIFE, so a
      // later right-hand side — and the body — can reference an earlier temp.
      // Flat: no nesting growth with the candidate count.
      cseBind: (bindings, body) =>
        `(() => { ${bindings
          .map(([name, code]) => `const ${name} = ${code};`)
          .join(' ')} return ${body}; })()`,
      // A non-boolean Which/When condition (e.g. NaN) fails closed at run time,
      // matching the interpreter's throw (D6).
      assertBoolean: (code) => `_SYS.cond(${code})`,
      // Element-wise `Which`/`If` selection over a collection-valued condition.
      selection: (args, compile) => compileJSSelection(args, compile),
      // Absence capability (§3.F): numeric absence is `NaN`; the object axis is
      // `undefined`. Consumed by `IsMissing`/`Coalesce`/Kleene `Equal` (P3).
      absence: {
        numeric: {
          make: () => 'Number.NaN',
          isAbsent: (x) => `Number.isNaN(${x})`,
          coalesce: (x, d) => `((_c) => Number.isNaN(_c) ? ${d} : _c)(${x})`,
        },
        object: {
          nullLiteral: 'undefined',
          isAbsent: (x) => `(${x} === undefined)`,
          coalesce: (x, d) => `(${x} ?? ${d})`,
        },
      },
      indent: 0,
      ws: (s?: string) => s ?? '',
      preamble: '',
      // Per-compilation naming state for generated temporaries. Created here —
      // `createTarget()` is called once per compilation — so `tempVar()` numbers
      // `_tv1, _tv2, …` deterministically and two compiles of one expression
      // emit byte-identical source. A boundary that knows the expression passes
      // a context seeded with its collision inventory through `options`.
      naming: { counter: 0, usedNames: new Set<string>() },
      ...options,
    };
  }

  compile(
    expr: Expression,
    options: CompilationOptions<Expression> = {}
  ): CompilationResult<'javascript'> {
    try {
      return this.compileOrThrow(expr, options);
    } catch (e) {
      // By default a failure throws (the low-level contract). When the caller
      // opts in with `fallback: true`, surface the documented `success: false`
      // shape with an interpreter-backed `run` instead of throwing.
      if (options.fallback !== true) throw e;
      const error = (e as Error).message;
      console.warn(
        `Compilation fallback for "${expr.operator}" (target: javascript): ${error}`
      );
      return BaseCompiler.buildInterpreterFallback(
        expr,
        error,
        'javascript',
        this.createTarget(),
        options.vars ? new Set(Object.keys(options.vars)) : undefined
      );
    }
  }

  private compileOrThrow(
    expr: Expression,
    options: CompilationOptions<Expression> = {}
  ): CompilationResult<'javascript'> {
    // Compiled code is radian-based: reproduce the engine's `angularUnit`
    // semantics (scaled trig args, scaled inverse-trig results) so compiled
    // output agrees with evaluate().
    expr = rewriteAngularUnit(expr);
    const {
      operators,
      functions,
      vars,
      imports = [],
      preamble,
      realOnly,
      iterationBudget,
      quadrature,
    } = options;
    const unknowns = expr.unknowns;

    // Process imports
    let preambleImports = imports
      .map((x) => {
        if (typeof x === 'function') return x.toString();
        throw new Error(`Unsupported import \`${x}\``);
      })
      .join('\n');

    // Process custom functions
    const namedFunctions: { [k: string]: string } = {};

    if (functions) {
      for (const [k, v] of Object.entries(functions)) {
        if (typeof v === 'function') {
          if (isTrulyNamed(v)) {
            preambleImports += `${v.toString()};\n`;
            namedFunctions[k] = v.name;
          } else {
            preambleImports += `const ${k} = ${v.toString()};\n`;
            namedFunctions[k] = k;
          }
        } else if (typeof v === 'string') {
          // Function is referenced by name (should be in imports)
          namedFunctions[k] = v;
        }
      }
    }

    // Create operator lookup function
    const customOperator = (op: MathJsonSymbol) => {
      if (!operators) return undefined;
      return typeof operators === 'function'
        ? operators(op)
        : operators[op as keyof typeof operators];
    };
    const operatorLookup = (op: MathJsonSymbol) => {
      // Check custom operators first
      const customOp = customOperator(op);
      if (customOp) return customOp;
      // Fall back to default JavaScript operators
      return JAVASCRIPT_OPERATORS[op];
    };

    // Free symbols emitted as `_.<id>` vars-object lookups (see
    // `CompileTarget.varsObjectRefs`). Recorded here, checked by
    // `compileToTarget` before it wraps a lambda, which has no `_` in scope.
    // The caller may supply the set to read it back after a declined compile.
    const varsObjectRefs = options.varsObjectRefs ?? new Set<MathJsonSymbol>();

    // Constant folding must never evaluate through an operator the caller
    // overrode: a custom `functions` entry (and a record-form `operators`
    // entry) replaces the emission, so a fold through the ENGINE's definition
    // could disagree with the caller's runtime implementation. A function-form
    // `operators` is opaque — its covered names cannot be enumerated — so it
    // disables folding outright.
    const foldExcludedOps = new Set<MathJsonSymbol>([
      ...(functions ? Object.keys(functions) : []),
      ...(operators && typeof operators !== 'function'
        ? Object.keys(operators)
        : []),
    ]);
    const constantFold =
      typeof operators === 'function' ? false : options.constantFold;

    const target = this.createTarget({
      constantFold,
      foldExcludedOps: foldExcludedOps.size > 0 ? foldExcludedOps : undefined,
      operators: operatorLookup,
      varsObjectRefs,
      functions: (id) =>
        namedFunctions?.[id] ? namedFunctions[id] : JAVASCRIPT_FUNCTIONS[id],
      var: (id) => {
        // A string `vars` value is JS source spliced in as-is (the live-path
        // contract: `{ s: '_.s' }` keeps `s` a runtime argument even when it
        // has an assigned value). A non-string value is a constant to bake.
        if (vars && id in vars) {
          const v = vars[id];
          return typeof v === 'string' ? v : JSON.stringify(v);
        }
        // `Nothing` is the engine's ERASURE marker, not a variable (contrast
        // `Missing`/`NaN`, which are position-preserving). Reaching here means
        // some emitter is about to splice it in as an ordinary operand, where
        // the `_.Nothing` vars-object lookup reads `undefined` at run time and
        // silently degrades: an indefinite integral's missing bounds made
        // quadrature "converge" to 0, an unbounded `Sum` bound makes the trip
        // count NaN so the loop returns its identity. Fail closed (D6) instead.
        // (A caller that genuinely pins a variable named `Nothing` in `vars` is
        // served by the lookup above, which runs first.)
        if (id === 'Nothing')
          throw new Error(
            'Nothing: the erasure marker is not a value and cannot be compiled as a variable reference. Fail closed (D6).'
          );
        const result = {
          Pi: 'Math.PI',
          ExponentialE: 'Math.E',
          // The boolean literals are constants, not free symbols: otherwise a
          // literal mask (e.g. `p[[False, True, True]]`) compiles to a dangling
          // `_.False`/`_.True` vars-object lookup and throws at run time.
          True: 'true',
          False: 'false',
          NaN: 'Number.NaN',
          ImaginaryUnit: '({ re: 0, im: 1 })',
          Half: '0.5',
          MachineEpsilon: 'Number.EPSILON',
          GoldenRatio: '((1 + Math.sqrt(5)) / 2)',
          CatalanConstant: '0.91596559417721901',
          EulerGamma: '0.57721566490153286',
        }[id];
        if (result !== undefined) return result;
        if (unknowns.includes(id)) {
          varsObjectRefs.add(id);
          return `_.${id}`;
        }
        // An assigned value / declared constant: returning `undefined` lets
        // BaseCompiler fold it (the way evaluate() does) rather than emitting a
        // bare `a` global, which would throw `ReferenceError` at run time.
        if (expr.engine._getSymbolValue(id) !== undefined) return undefined;
        // No value: a genuinely free symbol. It may be reachable only through a
        // folded value (e.g. `c` in `b = c + 1`), so `unknowns` — computed on
        // the surface expression — can miss it. Emit the vars-object lookup
        // anyway, not a bare global. (`freeSymbols` on the result lists it.)
        varsObjectRefs.add(id);
        return `_.${id}`;
      },
      preamble: (preamble ?? '') + preambleImports,
      iterationBudget,
      quadrature,
      varsKeys: vars ? new Set(Object.keys(vars)) : undefined,
      // Opt in to compiling calls to user-defined function literals (`f(x) :=
      // …`) as named local functions collected into the preamble.
      userFunctions: { defs: new Map(), compiling: new Set() },
      // Capture-set collector for implicit-compilation callers (see
      // `CompileTarget.symbolDeps`).
      symbolDeps: options.symbolDeps,
      // Root compilation boundary: fresh, deterministic numbering for the
      // generated temporaries, seeded with the names this compilation must not
      // reuse — the expression's own symbols and any `_tv`/`_cse` token in the
      // source the caller splices in. Covers BOTH routes of `compileToTarget`
      // (expression and `Function` literal): they share this target.
      naming: BaseCompiler.newNamingContext(expr, [
        preamble,
        preambleImports,
        ...Object.values(namedFunctions),
        ...(vars ? Object.values(vars) : []),
      ]),
    });
    // The compilation root: a user-function definition body is emitted into the
    // preamble, so it compiles against THIS target plus its own parameters —
    // never against whichever nested target requested the emission (see
    // `CompileTarget.userFunctions.root`).
    target.userFunctions!.root = target;

    // Common-subexpression elimination (design §4.2). Harvest the SAME tree
    // the emitters walk (post `rewriteAngularUnit`). The G1b provenance
    // predicates are built from the RAW options here — the resolver closures
    // above cannot tell a caller-supplied entry from a built-in one.
    BaseCompiler.openCseSession(expr, target, {
      enabled: options.cse,
      isOverriddenOperator: (name) =>
        Object.prototype.hasOwnProperty.call(namedFunctions, name) ||
        customOperator(name) !== undefined,
      isStringVar: (name) =>
        vars !== undefined && typeof vars[name] === 'string',
      isVarsKey: (name) =>
        vars !== undefined && Object.prototype.hasOwnProperty.call(vars, name),
    });

    const result = compileToTarget(expr, target, realOnly);
    return BaseCompiler.withReferences(
      result,
      expr,
      target,
      vars ? new Set(Object.keys(vars)) : undefined
    );
  }
}

/**
 * Wrap a compiled result so non-real values are projected to a real number or,
 * when they are not representable as one, `NaN` (fail closed, D6):
 * - A complex `{ re, im }` collapses to `re` when the imaginary part chops to
 *   zero at the roundoff scale (`ROUNDOFF_TOLERANCE`), else `NaN`.
 * - A boolean is NOT a real number — the interpreter never numericizes a
 *   boolean-valued expression to 0/1 (`True.N()` stays `True`) — so it maps to
 *   `NaN` rather than silently passing through as a non-number (CO-P2-25).
 */
function wrapRealOnly(
  result: CompilationResult<'javascript'>
): CompilationResult<'javascript', number> {
  const origRun = result.run;
  // Recurses into arrays: a tuple/list result carries its components in
  // number slots, so a `{ re, im }` there must be coerced too. This is the
  // ONLY `realOnly` component check — a provably-complex component is folded
  // like any other and projected here, exactly as a component that only
  // becomes complex when the compiled function is called.
  // Only complex values are coerced inside a collection: a boolean ELEMENT is
  // a legitimate result (`Equal` over a collection yields `[false, …]`), so
  // the top-level boolean → NaN rule below must not recurse.
  //
  // The imaginary part is CHOPPED, not compared to zero exactly, at the
  // kernel-roundoff scale — matching `apply.ts`'s complex-result chop, NOT
  // `ce.tolerance` (kernel dust is a property of the arithmetic; using the
  // user tolerance both re-broke this under a tightened tolerance and, being
  // snapshotted at compile time, diverged from the interpreter after a
  // tolerance change). An exact test was a REGRESSION source (2026-07-30):
  // the bounded inverse trig / inverse hyperbolic heads type as `complex` for
  // an argument of unknown magnitude, so an IN-domain call is routed through
  // `_SYS.casin` & co., and `Complex(0.5, 0).asin()` returns `im: 5.55e-17` —
  // dust from the complex log/sqrt formulation. Projected exactly, that dust
  // made `y = arcsin(x)` compile to `NaN` at every point of its domain. A
  // genuinely complex value is nowhere near the roundoff scale (`arcsin(2)`
  // has `im = -1.317`) and still fails closed to `NaN`.
  const coerceComponents = (r: unknown): unknown => {
    if (Array.isArray(r)) return r.map(coerceComponents);
    if (typeof r === 'object' && r !== null && 'im' in r)
      return chop((r as ComplexResult).im, ROUNDOFF_TOLERANCE) === 0
        ? (r as ComplexResult).re
        : NaN;
    return r;
  };
  const realRun = ((...args: unknown[]) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    const r = (origRun as Function)(...args);
    if (typeof r === 'boolean') return NaN;
    return coerceComponents(r);
  }) as unknown as CompiledRunner<number>;
  return {
    ...result,
    run: realRun,
  } as CompilationResult<'javascript', number>;
}

function compileToTarget(
  expr: Expression,
  target: CompileTarget<Expression>,
  realOnly?: boolean
): CompilationResult<'javascript'> {
  // A provably complex tuple/list COMPONENT used to be refused here (Tycho
  // item 62). Retired 2026-07-30: `wrapRealOnly`'s `coerceComponents`
  // recurses into array results, so `(1, i)` now runs to `[1, NaN]` — the
  // same answer `(t, √t)` already gives at `t = -4`, where nothing can be
  // caught statically. Fail-closed (D6) is about silently WRONG output, not
  // about `NaN`.

  if (isFunction(expr, 'Function')) {
    const args = expr.ops;
    const params = args
      .slice(1)
      .map((x) => functionLiteralParameterName(x) || '_');
    const lambdaTarget: CompileTarget<Expression> = {
      ...target,
      var: (id) => (params.includes(id) ? id : target.var(id)),
      boundVars: BaseCompiler.withBoundNames(target, params),
    };
    // The lambda BODY is the bindable region here (the root region holds only
    // the `Function` node itself), pushed under the lambda's own target so any
    // temporaries land inside the emitted arrow function.
    //
    // Compile under the literal's enforced-parameter frame, exactly like the
    // emitted-definition route (`emitFunctionLiteralDefinition`): a
    // destructuring assign onto an ANNOTATED parameter must fail closed here
    // too — without the frame, `(x: integer, y: integer) ↦ do { (x, y) :=
    // (7, 4.5); … }` compiled and wrote both leaves where the interpreter
    // atomically declines.
    const body = BaseCompiler.withEnforcedParams(
      expr as Expression & FunctionInterface,
      () =>
        BaseCompiler.compileCseRoot(expr, target, 0, () =>
          BaseCompiler.compileOp(expr, 0, lambdaTarget, 0, args[0].canonical)
        )
    );
    // A lambda body may call user-defined functions (`t ↦ f(t)`); emit their
    // definitions as a preamble inside the lambda's own body.
    const userDefs = BaseCompiler.userFunctionsPreamble(target);
    // A compiled lambda is called with its declared parameters only — there is
    // no vars object in scope — so a free symbol emitted as `_.<id>` (here or
    // in the user-function preamble, which shares this target) would throw
    // `ReferenceError: _ is not defined` at call time instead of producing a
    // value (Tycho item 131; reached via quadrature, which compiles the
    // integrand as a lambda). Decline: the low-level contract is to throw, so
    // `implicitCompile` degrades to the interpreter and the expression stays
    // symbolic — which is the right answer for a body with a free variable.
    const dangling = target.varsObjectRefs;
    if (dangling && dangling.size > 0)
      throw new Error(
        `Cannot compile a function literal whose body has unbound free ${
          dangling.size === 1 ? 'symbol' : 'symbols'
        } ${[...dangling].map((s) => `"${s}"`).join(', ')}: a compiled lambda takes only its declared parameters, so there is no value to bind them to. Assign a value, or pass one via \`vars\`.`
      );
    const fn = new ComputeEngineFunctionLiteral(
      expr.engine,
      body,
      params,
      userDefs
    );
    const result = {
      target: 'javascript' as const,
      success: true,
      code: userDefs
        ? `(${params.join(', ')}) => { ${userDefs}return ${body}; }`
        : `(${params.join(', ')}) => ${body}`,
      calling: 'lambda' as const,
      run: fn as unknown as CompiledRunner,
    };
    return realOnly ? wrapRealOnly(result) : result;
  }

  if (isSymbol(expr)) {
    const op = target.operators?.(expr.symbol);
    if (op) {
      const fn = new ComputeEngineFunctionLiteral(expr.engine, `a ${op[0]} b`, [
        'a',
        'b',
      ]);
      const result = {
        target: 'javascript' as const,
        success: true,
        code: `(a, b) => a ${op[0]} b`,
        calling: 'lambda' as const,
        run: fn as unknown as CompiledRunner,
      };
      return realOnly ? wrapRealOnly(result) : result;
    }
  }

  const js = BaseCompiler.compileCseRoot(expr, target);
  // Collect any user-defined function definitions accumulated while compiling
  // `expr` (a symbol with a `Function`-literal definition used as an operator)
  // and prepend them to the preamble so their named local functions are in
  // scope for the compiled body.
  const userDefs = BaseCompiler.userFunctionsPreamble(target);
  const preamble = userDefs
    ? target.preamble
      ? `${target.preamble}\n${userDefs}`
      : userDefs
    : target.preamble;
  const fn = new ComputeEngineFunction(expr.engine, js, preamble);
  const result = {
    target: 'javascript' as const,
    success: true,
    code: js,
    calling: 'expression' as const,
    run: fn as unknown as CompiledRunner,
  };
  return realOnly ? wrapRealOnly(result) : result;
}

/**
 * Maximum number of terms to unroll in a Sum/Product.
 * Beyond this threshold a loop is emitted instead.
 */
const UNROLL_LIMIT = 100;

/**
 * Extract index, lower, and upper from a Limits expression.
 * Returns the raw Expression nodes so they can be compiled (not just evaluated
 * to numbers). Also provides numeric values when bounds are constant.
 */
function extractLimits(limitsExpr: Expression): {
  index: string;
  lowerExpr: Expression;
  upperExpr: Expression;
  lowerNum: number | undefined;
  upperNum: number | undefined;
} {
  console.assert(limitsExpr.operator === 'Limits');
  const fn = limitsExpr as Expression & {
    op1: Expression;
    op2: Expression;
    op3: Expression;
  };
  const index = isSymbol(fn.op1) ? fn.op1.symbol : '_';
  const lowerExpr = fn.op2;
  const upperExpr = fn.op3;
  // A bound mentioning a compile-bound name (a user function's parameter, an
  // enclosing binder's index) is NOT a compile-time constant — see
  // `BaseCompiler.bigOpBoundConstant`, which fails that read closed so the
  // loop arm below emits the bound as code instead of folding against the
  // shadowed engine symbol's value.
  return {
    index,
    lowerExpr,
    upperExpr,
    lowerNum: BaseCompiler.bigOpBoundConstant(lowerExpr),
    upperNum: BaseCompiler.bigOpBoundConstant(upperExpr),
  };
}

/**
 * Whether an operand (a Sum/Product bound, a `Repeat` count) is KNOWN at
 * compile time not to be a finite number: a `±∞`/`NaN` literal, or an
 * expression typed `non_finite_number`.
 *
 * Such a bound cannot be lowered to a counted loop — `i <= Infinity` never
 * fails, and `-Infinity + 1 === -Infinity` never advances the counter — so the
 * compiled function would lock the caller's thread with no timeout and no way
 * out. A symbolic bound (`n`) is not decided here: it is guarded at run time
 * (see `emitSumProduct`).
 */
export function isNonFiniteBound(expr: Expression): boolean {
  if (isNumber(expr) && !Number.isFinite(expr.re)) return true;
  return expr.type.matches('non_finite_number');
}

/**
 * Fail closed (D6) on a Sum/Product bound that is statically non-finite, so
 * `compile()` reports failure and the caller falls back to the interpreter
 * (which evaluates a convergent series symbolically/numerically) instead of
 * running a loop that cannot terminate.
 *
 * EXEMPT under an explicit `iterationBudget`: the budget guard emitted at loop
 * entry (`!(_upper - i < budget)`) is false for an infinite or NaN bound, so
 * the loop returns NaN without running — the terminating behavior the numeric
 * limit ladder opts into (see `COMPILE Sum - iterationBudget` in
 * `compile-sum-product.test.ts`).
 */
function assertFiniteBound(
  kind: 'Sum' | 'Product',
  expr: Expression,
  which: 'lower' | 'upper',
  target: CompileTarget<Expression>
): void {
  if (target.iterationBudget !== undefined) return;
  if (!isNonFiniteBound(expr)) return;
  throw new Error(
    `${kind}: the ${which} bound \`${expr.toString()}\` is not a finite ` +
      `number — an infinite or NaN bound has no terminating loop. ` +
      `Fail closed (D6).`
  );
}

/**
 * Compile a bound expression to JavaScript code.
 * For numeric constants, emits the number directly.
 * For symbolic expressions, compiles using Math.floor() to ensure integer bounds.
 */
function compileBound(
  expr: Expression,
  numVal: number | undefined,
  target: CompileTarget<Expression>
): string {
  if (numVal !== undefined) return String(numVal);
  return `Math.floor(${BaseCompiler.compile(expr, target)})`;
}

/**
 * Compile Sum or Product.
 *
 * When both bounds are constant integers, small ranges (<=UNROLL_LIMIT terms)
 * are unrolled into explicit additions/multiplications. Larger ranges or
 * symbolic bounds emit a while-loop wrapped in an IIFE.
 *
 * Multi-index forms — `Sum(body, Limits(i,…), Limits(j,…), …)` — are compiled
 * as nested single-index sums (`Σ_i Σ_j body`), so every indexing-set clause is
 * honored. (Previously only the first clause was read, leaving the trailing
 * indices dangling in the generated code.)
 */
function compileSumProduct(
  kind: 'Sum' | 'Product',
  args: ReadonlyArray<Expression>,
  _compile: (expr: Expression) => string,
  target: CompileTarget<Expression>
): string {
  if (!args[0]) throw new Error(`${kind}: no body`);
  if (!args[1]) {
    // Collection form: `Sum(collection)` / `Product(collection)` with no
    // indexing set — this is what `.total` (→ `Sum`) and a bare list product
    // canonicalize to. Reduce over the elements. A statically indexed
    // collection lowers to a bare `.reduce`; a possibly-collection operand (a
    // `broadcastable<T>` node or a top-typed application such as `h(x)`, e.g. a
    // Tycho document helper typed `(number) -> unknown`) may be a scalar OR an
    // array at run time, so it reduces under an `Array.isArray` guard (a runtime
    // scalar returns itself, matching the interpreter's `Sum(scalar) = scalar`).
    // A dictionary/string/statically-scalar operand fails closed (D6), matching
    // `Length`/`At`/`Reduce`.
    if (isIndexedCollectionOperand(args[0]))
      return emitCollectionReduce(kind, args[0], target, false);
    if (isPossiblyCollectionTypedJS(args[0]))
      return emitCollectionReduce(kind, args[0], target, true);
    throw new Error(`${kind}: no indexing set`);
  }
  return emitSumProduct(kind, args[0], args.slice(1), target);
}

/**
 * The compiled count operand of a `Take`/`Drop` slice. The interpreter
 * normalizes counts with `Math.round` (`Take([1,2,3,4], 2.5)` takes THREE
 * elements), while `slice` truncates its argument — so a count that is not
 * statically a literal integer is wrapped in `Math.round`. A literal-integer
 * count keeps the bare emission, byte-identical to the historical output.
 * (`Math.round(NaN)` is NaN, so the NaN-count behavior — slice from/to 0 —
 * is unchanged.)
 */
function sliceCount(
  count: Expression,
  compile: (expr: Expression) => string
): string {
  const n = tryGetConstant(count);
  if (n !== undefined && Number.isInteger(n)) return compile(count);
  return `Math.round(${compile(count)})`;
}

/**
 * The `Take`/`Drop` count as a `slice` argument: non-negative and rounded (the
 * interpreter's `toInteger` count contract — `Take([…], 2.5)` keeps 3
 * elements). A compile-time-constant count is normalized NOW and emitted as a
 * bare literal (`Take(xs, 10)` → `.slice(0, 10)`, a negative count → `0`);
 * only a runtime count pays the emitted `Math.max(0, Math.round(…))` guard. A
 * non-finite literal (`NaN`, `±∞`) is not a constant to `tryGetConstant` and
 * stays on the runtime-guard path, preserving its existing semantics.
 */
function clampedSliceCount(
  count: Expression,
  compile: (expr: Expression) => string
): string {
  const n = tryGetConstant(count);
  if (n !== undefined) return `${Math.max(0, Math.round(n))}`;
  return `Math.max(0, ${sliceCount(count, compile)})`;
}

/**
 * The step of a STATICALLY infinite, lazily-compilable `Range`, or
 * `undefined` when the range is not one: the stop must be a literal `±∞`,
 * the start anything not statically non-finite (a literal or a runtime
 * value — the stream iterates from wherever it lands, so
 * `Take(Map(f, Range(n, ∞)), 10)` with a declared `n` compiles), and the
 * step a literal finite number whose sign matches
 * the stop's direction (a 2-operand range implies step `±1`, following the
 * auto-descend convention). A sign-mismatched step (`Range(1, ∞, -2)`) is
 * INERT in the interpreter, so it is not lazily compilable either — it fails
 * closed and the caller falls back to the interpreter.
 *
 * A symbolic step is excluded even though the stream could iterate it: with
 * the stop at `+∞` a runtime-negative step means an EMPTY range, and the
 * stream cannot decide that lazily — it would yield a descending infinite
 * sequence instead. Literal steps keep the decision static.
 */
function infiniteRangeStep(expr: Expression): number | undefined {
  if (!isFunction(expr, 'Range')) return undefined;
  const ops = expr.ops;
  if (ops.length < 2 || ops.length > 3) return undefined;
  const stop = ops[1];
  if (!isNumber(stop) || stop.im !== 0) return undefined;
  if (stop.re !== Infinity && stop.re !== -Infinity) return undefined;
  const dir = stop.re === Infinity ? 1 : -1;
  if (ops[0] === undefined || isNonFiniteBound(ops[0])) return undefined;
  if (ops.length === 2) return dir;
  const step = literalReal(ops[2]);
  if (step === undefined || step === 0) return undefined;
  return Math.sign(step) === dir ? step : undefined;
}

/**
 * Whether an operand compiles as a LAZY infinite stream: a statically
 * infinite `Range`, or a `Map`/`Filter`/`Drop`/`Rest` pipeline over one.
 * This predicate and `emitLazyStream` must cover exactly the same shapes —
 * a bounding consumer (`Take`/`TakeWhile`) uses the predicate to decide
 * whether to lower its operand via `emitLazyStream` instead of `collArg`.
 *
 * `DropWhile` is deliberately absent: over an infinite source the
 * interpreter leaves it INERT (it would have to scan an unbounded prefix),
 * so compiling it lazily would diverge from that; it fails closed instead.
 */
function isLazyStream(expr: Expression | undefined): boolean {
  if (!expr || !isFunction(expr)) return false;
  const op = expr.operator;
  if (op === 'Range') return infiniteRangeStep(expr) !== undefined;
  // `Map` is callback-FIRST (`Map(f, xs)`); `Filter` is source-first.
  if (op === 'Map') return expr.nops === 2 && isLazyStream(expr.ops[1]);
  if (op === 'Filter') return expr.nops === 2 && isLazyStream(expr.ops[0]);
  // A STATICALLY non-finite drop count (`Drop(1..∞, ∞)`) is an unresolvable
  // parameter in the interpreter (an indeterminate walk, `integerParam` in
  // `library/collections.ts`); excluding it here makes the whole pipeline
  // fail closed to the interpreter instead of compiling to a stream that
  // silently yields nothing.
  if (op === 'Drop')
    return (
      expr.nops === 2 &&
      !isNonFiniteBound(expr.ops[1]) &&
      isLazyStream(expr.ops[0])
    );
  if (op === 'Rest') return expr.nops === 1 && isLazyStream(expr.ops[0]);
  return false;
}

/**
 * Lower a statically infinite pipeline (see `isLazyStream`) to lazy `_SYS`
 * iterator code. Only a bounding consumer calls this; the eager handlers for
 * the same operators never produce iterator code, so array-consuming
 * lowerings never receive one.
 */
function emitLazyStream(
  expr: Expression,
  compile: (expr: Expression) => string
): string {
  if (!isFunction(expr))
    throw new Error('emitLazyStream: not a lazily-compilable collection');
  const op = expr.operator;
  if (op === 'Range') {
    const step = infiniteRangeStep(expr);
    if (step === undefined)
      throw new Error('Range: not a lazily-compilable infinite range');
    return `_SYS.rangeIter(${compile(expr.ops[0])}, ${step})`;
  }
  // `Map` is callback-FIRST (`Map(f, xs)`); every other stream operator
  // keeps its source at operand 0.
  if (op === 'Map') {
    const mapSource = expr.ops[1];
    return `_SYS.mapIter(${emitLazyStream(mapSource, compile)}, ${fnArg('Map', expr.ops[0], mapSource, compile)})`;
  }
  const source = expr.ops[0];
  if (op === 'Filter')
    return `_SYS.filterIter(${emitLazyStream(source, compile)}, ${fnArg('Filter', expr.ops[1], source, compile)})`;
  if (op === 'Drop')
    return `_SYS.dropIter(${emitLazyStream(source, compile)}, ${compile(expr.ops[1])})`;
  if (op === 'Rest')
    return `_SYS.dropIter(${emitLazyStream(source, compile)}, 1)`;
  throw new Error(`${op}: not a lazily-compilable infinite collection`);
}

/**
 * Compile a collection operand, failing closed (D6) if it is not an indexed
 * collection (list/vector/range) — shared by the list-shaped collection
 * operators. `position` labels the operand in the error (e.g. for `Join`).
 */
function collArg(
  kind: string,
  arg: Expression | undefined,
  compile: (expr: Expression) => string,
  position?: number
): string {
  if (!arg || !isIndexedCollectionOperand(arg))
    throw new Error(
      `${kind}: ${position !== undefined ? `operand ${position}` : 'operand'} ` +
        `is not an indexed collection (list/vector/range). Fail closed (D6).`
    );
  // An infinite pipeline cannot materialize to an array; only `Take`/
  // `TakeWhile` bound one (they lower it via `emitLazyStream` before ever
  // reaching this funnel). Everything else fails closed here — at compile
  // time, with the bounding fix named — instead of emitting
  // `Array.from({length: Infinity})` and throwing a RangeError at run time.
  if (isLazyStream(arg))
    throw new Error(
      `${kind}: ${position !== undefined ? `operand ${position}` : 'operand'} ` +
        `is an infinite collection — bound it with \`Take\` or \`TakeWhile\` ` +
        `to compile. Fail closed (D6).`
    );
  return compile(arg);
}

/**
 * Compile an ELEMENT-consuming callback operand (a predicate, a mapping
 * function), failing closed (D6) when a parameter annotation the emitted
 * lowering cannot enforce is not provably satisfied by `source`'s element type
 * — see `BaseCompiler.assertCallbackAnnotations`. `extraArgTypes` prefixes the
 * element position for a combiner-shaped callback (`Reduce`/`Scan`, whose
 * first parameter is the accumulator).
 */
function fnArg(
  kind: string,
  callback: Expression | undefined,
  source: Expression | undefined,
  compile: (expr: Expression) => string,
  extraArgTypes: ReadonlyArray<Type | undefined> = []
): string {
  BaseCompiler.assertCallbackAnnotations(kind, callback, [
    ...extraArgTypes,
    BaseCompiler.collectionElementTypeOf(source),
  ]);
  return compile(callback!);
}

//
// ─── Random domains ─────────────────────────────────────────────────────────
//
// A `Random`/`RandomChoice`/`RandomSample` domain compiles to a DESCRIPTOR —
// closed-form arithmetic when its parameters are literal, a runtime
// `_SYS.domain*` object otherwise — and NEVER to a compiled collection. The
// JS `Range` collection handler materializes via `Array.from`, so compiling
// the domain would allocate a million elements to draw three
// (`docs/plans/2026-07-25-random-signature-redesign.md` §7).
//

/** Reject a domain the interpreter would refuse (an unbounded or empty
 * `Interval`) at COMPILE time, so `fallback: true` drops to the interpreter
 * and its structured error rather than emitting a NaN draw. */
function assertDrawableInterval(op: string, lo: number, hi: number): void {
  if (!Number.isFinite(lo) || !Number.isFinite(hi))
    throw new Error(
      `${op}: an unbounded Interval has no uniform draw. Fail closed (D6).`
    );
  if (!(hi > lo))
    throw new Error(`${op}: an empty Interval has no draw. Fail closed (D6).`);
}

/** As `assertDrawableInterval`, for a `Range`'s normalized element count. */
function assertDrawableRange(op: string, n: number): void {
  if (!Number.isFinite(n) || n <= 0)
    throw new Error(
      `${op}: expected a finite, non-empty Range. Fail closed (D6).`
    );
}

/** A finite real literal operand, or `undefined`. */
function literalReal(x: Expression | undefined): number | undefined {
  if (x === undefined || !isNumber(x) || x.im !== 0) return undefined;
  return Number.isFinite(x.re) ? x.re : undefined;
}

/**
 * The NORMALIZED `(first, step, count)` of a `Range` whose bounds are all
 * literal, or `undefined` when any bound is symbolic (the runtime
 * `_SYS.domainRange` descriptor handles those).
 *
 * Mirrors `range()` and the `Range` collection handler's `count`
 * (`library/collections.ts`): a two-operand range infers a descending step,
 * and a zero or sign-mismatched step yields an empty range.
 */
function literalRangeParams(
  expr: Expression
): { first: number; step: number; n: number } | undefined {
  if (!isFunction(expr)) return undefined;
  const ops = expr.ops;
  if (ops.length === 0 || ops.length > 3) return undefined;
  const bounds = ops.map(literalReal);
  if (bounds.some((b) => b === undefined)) return undefined;
  const [first, upper, step] =
    ops.length === 1
      ? [1, bounds[0]!, 1]
      : [bounds[0]!, bounds[1]!, ops.length > 2 ? bounds[2]! : undefined];
  const s = step ?? (upper >= first ? 1 : -1);
  const n = s === 0 ? 0 : Math.max(0, Math.floor((upper - first) / s) + 1);
  return { first, step: s, n };
}

/** Strip an `Open`/`Closed` endpoint marker: a float draw cannot respect an
 * open endpoint, so the markers are ignored (§4). */
function intervalEndpoint(x: Expression): Expression {
  if (isFunction(x, 'Open') || isFunction(x, 'Closed')) return x.op1;
  return x;
}

/**
 * Compile a random domain operand to a runtime descriptor expression.
 *
 * `continuousOk` is false for `RandomSample`, whose domain gate is
 * `indexed_collection` — an `Interval` is invalid there, as in the
 * interpreter.
 */
function randomDomain(
  op: string,
  domain: Expression | undefined,
  compile: (expr: Expression) => string,
  continuousOk: boolean
): string {
  if (domain === undefined)
    throw new Error(`${op}: expected a domain operand. Fail closed (D6).`);
  const name = JSON.stringify(op);

  if (isFunction(domain, 'Interval')) {
    if (!continuousOk)
      throw new Error(
        `${op}: an Interval is not an indexed collection. Fail closed (D6).`
      );
    if (domain.nops !== 2)
      throw new Error(`${op}: expected Interval(lo, hi). Fail closed (D6).`);
    const lo = compile(intervalEndpoint(domain.op1));
    const hi = compile(intervalEndpoint(domain.op2));
    return `_SYS.domainInterval(${name}, ${lo}, ${hi})`;
  }

  if (isFunction(domain, 'Range')) {
    const ops = domain.ops;
    if (ops.length === 0 || ops.length > 3)
      throw new Error(`${op}: expected Range(…). Fail closed (D6).`);
    if (ops.length === 1)
      return `_SYS.domainRange(${name}, 1, ${compile(ops[0])}, 1)`;
    const bounds = `${compile(ops[0])}, ${compile(ops[1])}`;
    // No explicit step: the descriptor infers ±1 at run time, exactly as
    // `range()` does — never a fixed +1, which would make a descending range
    // silently empty.
    if (ops.length === 2) return `_SYS.domainRange(${name}, ${bounds})`;
    return `_SYS.domainRange(${name}, ${bounds}, ${compile(ops[2])})`;
  }

  // Any other domain is compiled as an indexed collection — a literal list
  // compiles to the JS array it already is. `collArg` fails closed on
  // anything that is not one.
  return `_SYS.domainList(${name}, ${collArg(op, domain, compile)})`;
}

/**
 * The built-in `Reduce`/`Scan` combiners: the four associative folds that
 * compile without an initial value (their seedless native fold agrees with
 * the interpreter).
 */
function builtinCombiner(op: Expression): string | undefined {
  if (!isSymbol(op)) return undefined;
  switch (op.symbol) {
    case 'Add':
      return '(_a, _b) => _a + _b';
    case 'Multiply':
      return '(_a, _b) => _a * _b';
    case 'Min':
      return '(_a, _b) => Math.min(_a, _b)';
    case 'Max':
      return '(_a, _b) => Math.max(_a, _b)';
  }
  return undefined;
}

/**
 * Compile a custom `Reduce`/`Scan` combiner, or `undefined` if it is not
 * admissible. Only accept a combiner that is structurally callable AND
 * binary: a `Function` literal or a function-valued symbol whose arity is
 * exactly 2 (arity is statically knowable — `nops − 1` params — so a
 * unary/ternary combiner fails closed at compile time rather than silently
 * dropping or fabricating an argument at runtime, where the interpreter
 * raises an arity error); or an operator symbol, which lowers to a binary
 * lambda only for the binary arithmetic operators (checked here with
 * `BaseCompiler.isBinaryInfixValueOperator` — every OTHER operator symbol
 * now lowers to its eta-expanded wrapper at its own arity, e.g. the unary
 * `_fn_Negate`, which is a valid `Map` callback but not a combiner). A
 * value-bound or dangling symbol fails closed too.
 *
 * The result is wrapped to a fixed binary arity: native `reduce`/`map` pass
 * extra arguments (index, array) that must not leak into the combiner's
 * parameters (the interpreter passes exactly `(acc, x)`), and hoisted so it
 * is instantiated once.
 */
function customCombiner(
  op: Expression,
  compile: (e: Expression) => string,
  target: CompileTarget<Expression>
): string | undefined {
  let callable = false;
  if (isFunction(op, 'Function')) {
    callable = op.nops - 1 === 2;
  } else if (isSymbol(op)) {
    const literal = BaseCompiler.userFunctionLiteral(op.engine, op.symbol);
    if (literal !== undefined) callable = literal.nops - 1 === 2;
    else
      callable =
        target.operators?.(op.symbol) !== undefined &&
        BaseCompiler.isBinaryInfixValueOperator(op.symbol);
  }
  if (!callable) return undefined;
  return `((_f) => (_a, _b) => _f(_a, _b))(${compile(op)})`;
}

/**
 * Fail closed (D6) unless the collection's elements compile to JS primitives
 * with value equality. `includes`/`Set` use SameValueZero, which is reference
 * identity for compound elements (nested lists compile to arrays, tuples and
 * complex numbers to objects), diverging from the interpreter's structural
 * equality. Structural element types (tuple/list/vector) and declared-complex
 * element types are rejected by the type check; a numeric collection reports
 * the generic `number` element type whether its elements are real or complex,
 * so complex *content* is caught by `isComplexValued` (which inspects literal
 * operands).
 */
export function requirePrimitiveElements(kind: string, arg: Expression): void {
  const elt = collectionElementType(jsType(arg));
  const primitive =
    elt !== undefined &&
    (elt === 'number' ||
      isSubtype(elt, 'real') ||
      isSubtype(elt, 'boolean') ||
      isSubtype(elt, 'string'));
  if (primitive && !BaseCompiler.isComplexValued(arg)) return;
  throw new Error(
    `${kind}: cannot compile — the interpreter compares elements ` +
      `structurally, but only real/boolean/string elements compare by ` +
      `value on the JavaScript target. Fail closed (D6).`
  );
}

/**
 * Compile `Max`/`Min`. Two shapes:
 *   - a single indexed-collection operand (`[3,4,5].max`, `Max(range)`) reduces
 *     over the elements. A reduce (not `Math.max(...spread)`) is used so a large
 *     list can't overflow the call-stack argument limit. An EMPTY input yields
 *     `NaN`, matching the interpreter (missing-value typing, §3.C: `Max([])` /
 *     `Min([])` are `NaN`, was `∓∞`). The empty case is guarded explicitly
 *     rather than seeded with `NaN` — a `NaN` seed would poison a non-empty
 *     fold (`Math.max(NaN, 1) = NaN`).
 *   - the scalar variadic form (`Max(a, b, c)`) lowers to `Math.max(a, b, c)`.
 * A non-collection single operand takes the variadic path (`Math.max(x)` = x).
 */
function compileExtremum(
  kind: 'Max' | 'Min',
  args: ReadonlyArray<Expression>,
  compile: (expr: Expression) => string
): string {
  const fn = kind === 'Max' ? 'Math.max' : 'Math.min';
  const identity = kind === 'Max' ? '-Infinity' : 'Infinity';
  // Reduce with the identity seed, but map an empty input to `NaN` (interpreter
  // parity). The seed is safe for non-empty folds; `NaN` is not, so it is only
  // returned on the empty branch.
  const guardedReduce = (arrayCode: string): string =>
    `((_l) => _l.length === 0 ? NaN : _l.reduce((_a, _b) => ${fn}(_a, _b), ${identity}))(${arrayCode})`;
  if (args.length === 1 && args[0] && isIndexedCollectionOperand(args[0])) {
    return guardedReduce(compile(args[0]));
  }
  // A single operand that is not PROVABLY scalar but not provably a collection
  // either — its type admits an indexed-collection arm (`number |
  // list<number>`, e.g. `Distance(S, p)` over a base declared with the bare
  // `indexed_collection` type). The scalar arm `Math.min(<array>)` is `NaN` at
  // run time, a silent wrong behind `success: true` (Tycho item 143), so
  // project on the RUNTIME shape instead — the house idiom (see `_SYS.at`) —
  // which matches the interpreter both ways. The operand is bound once, so an
  // impure operand is still evaluated exactly once.
  if (
    args.length === 1 &&
    args[0] &&
    couldBeIndexedCollectionOperand(args[0])
  ) {
    return `((_v) => Array.isArray(_v) ? ${guardedReduce('_v')} : ${fn}(_v))(${compile(args[0])})`;
  }
  // Mixed scalars + collection operand(s): `Max`/`Min` REDUCE — fold the
  // scalars and every collection's elements into a single scalar (matching
  // `evaluateMinMax`, which flattens collection operands). Spreading a
  // collection into a plain `Math.max(...)` call would pass an array as one
  // argument → `NaN`; instead spread each collection into a combined array and
  // reduce it. An all-empty combined array yields `NaN` (interpreter parity).
  // An operand that is only POSSIBLY an indexed collection takes the same
  // runtime projection as the single-operand arm above, per operand: spread it
  // when it is an array at run time, contribute it as a single element when it
  // is a scalar. Without it, `Min(Distance(S, p), 100)` lowered to
  // `Math.min(<array>, 100)` → a silent `NaN` (Tycho item 143). Each operand's
  // code appears once, so an impure operand is still evaluated exactly once.
  if (
    args.some(
      (a) =>
        a &&
        (isIndexedCollectionOperand(a) || couldBeIndexedCollectionOperand(a))
    )
  ) {
    const parts = args.map((a) => {
      if (isIndexedCollectionOperand(a)) return `...(${compile(a)})`;
      if (couldBeIndexedCollectionOperand(a))
        return `...((_v) => Array.isArray(_v) ? _v : [_v])(${compile(a)})`;
      return compile(a);
    });
    return guardedReduce(`[${parts.join(', ')}]`);
  }
  return `${fn}(${args.map((x) => compile(x)).join(', ')})`;
}

/**
 * Compile `GCD`/`LCM`. The runtime helpers `_SYS.gcd`/`_SYS.lcm` are BINARY
 * (with a third `eps` tolerance argument), so the operands are folded PAIRWISE
 * — a variadic `_SYS.gcd(a, b, c)` would silently pass the third operand `c` as
 * the tolerance (finding A1).
 *
 * Shapes handled, matching `evaluateGcdLcm` (which flattens collection operands
 * and folds pairwise):
 *   - scalar variadic (`GCD(a, b, c)`) and list/mixed operands
 *     (`GCD([a, b], c)`) are combined into a single array — each indexed
 *     collection is spread, each scalar passed through — and reduced with the
 *     binary helper. Folding from the first element (no seed) matches the
 *     interpreter for a singleton (`LCM([2.5]) = 2.5`, not `lcm(1, 2.5)`); the
 *     empty case falls back to the identity (`GCD([]) = 0`, `LCM([]) = 1`).
 *   - an operand that is a collection but NOT an indexed collection
 *     (dictionary / string / set) has no array lowering, so fail closed (D6)
 *     rather than emit code that silently NaNs (finding A3).
 */
function compileGcdLcm(
  kind: 'GCD' | 'LCM',
  args: ReadonlyArray<Expression>,
  compile: (expr: Expression) => string
): string {
  const helper = kind === 'GCD' ? '_SYS.gcd' : '_SYS.lcm';
  const identity = kind === 'GCD' ? '0' : '1';
  const parts = args.map((a) => {
    if (isIndexedCollectionOperand(a)) return `...(${compile(a)})`;
    if (a.isCollection || a.type.matches('collection'))
      throw new Error(
        `${kind}: cannot compile — operand is a collection but not an indexed ` +
          `collection (list/vector/range). Fail closed (D6).`
      );
    return compile(a);
  });
  return `((_a) => _a.length ? _a.reduce((_x, _y) => ${helper}(_x, _y)) : ${identity})([${parts.join(
    ', '
  )}])`;
}

/**
 * Compile the collection form of `Sum`/`Product` — a reduce over the elements
 * of an indexed collection (e.g. `[3,4,5].total` → `Sum([3,4,5])`). The
 * identity seed (`0` for Sum, `1` for Product) makes the empty collection agree
 * with the interpreter (`Sum([]) = 0`, `Product([]) = 1`). Real-valued reduce,
 * consistent with the `Reduce` handler (complex-element folds are not lowered).
 */
function emitCollectionReduce(
  kind: 'Sum' | 'Product',
  coll: Expression,
  target: CompileTarget<Expression>,
  guarded: boolean
): string {
  const code = BaseCompiler.compile(coll, target);
  // A statically indexed collection has provably scalar elements (a
  // `list<number>`/`vector<n>`), so it folds with the bare scalar operator and
  // is always an array — no runtime guard.
  if (!guarded) {
    const op = kind === 'Sum' ? '+' : '*';
    const identity = kind === 'Sum' ? '0' : '1';
    return `(${code}).reduce((_a, _b) => _a ${op} _b, ${identity})`;
  }
  // A possibly-collection operand (`broadcastable<T>` / top-typed application)
  // may be a scalar OR an array whose elements are themselves vectors/matrices
  // at run time. Fold with the element-wise-aware combiner so a nested result
  // matches the interpreter (`Add` broadcasts element-wise → `_SYS.add`;
  // `Multiply` dispatches on rank → `_SYS.mul`, Hadamard for vectors and matrix
  // product for matrices) rather than string-concatenating arrays under a bare
  // `+`. Guard the scalar case so a runtime scalar returns itself (interpreter's
  // `Sum(scalar) = scalar`).
  const combiner = kind === 'Sum' ? '_SYS.add' : '_SYS.mul';
  const identity = kind === 'Sum' ? '0' : '1';
  return `((_c) => Array.isArray(_c) ? _c.reduce((_a, _b) => ${combiner}(_a, _b), ${identity}) : _c)(${code})`;
}

/**
 * Emit one indexing-set clause of a Sum/Product, recursing into the remaining
 * clauses for the innermost body. The "term" accumulated by this clause is the
 * body itself for the last clause, or the nested sum/product over the remaining
 * clauses otherwise.
 */
/**
 * Whether the indexed big-op body takes the element-wise accumulation arm:
 * list/indexed-collection typed, or POSSIBLY a collection at run time (a
 * `broadcastable<T>` body such as `2·b`, or a top-typed application — with
 * the item-86 look-through, so a provably-scalar wide-declared helper keeps
 * the bare scalar loop). Routing the possibly-collection case through the
 * `_SYS.bcast` fold is value-safe — the fold dispatches on runtime shape, so
 * a scalar body accumulates as a scalar — and closes the hole where such a
 * body slipped BOTH this gate and `assertScalarBigOpBody` (their predicates
 * were identical) into the bare `+` loop, which string-concatenates arrays.
 * The base-compiler assert is deliberately NOT widened the same way: on the
 * GPU targets a wide-declared helper application in a Sum body is common and
 * scalar-at-runtime by construction (shader values are static), so widening
 * would break working shaders.
 *
 * Excluded: tuples (atomic — no element-wise accumulation exists) and
 * complex-valued bodies (the `{re, im}` fold is the scalar loop's job).
 * Complex CELLS inside a list share the scalar arm's known blind spot (a
 * `{re, im}` object reaching `+` — same class as complex values in compiled
 * scalar comparisons, tracked in ROADMAP).
 */
function isElementwiseBigOpBody(body: Expression): boolean {
  if (isFunction(body, 'Tuple')) return false;
  const tt = jsType(body);
  if (typeof tt !== 'string' && tt.kind === 'tuple') return false;
  if (BaseCompiler.isComplexValued(body)) return false;
  return (
    body.type.matches('list') ||
    body.type.matches('indexed_collection') ||
    isPossiblyCollectionTypedJS(body)
  );
}

function emitSumProduct(
  kind: 'Sum' | 'Product',
  body: Expression,
  clauses: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): string {
  // A collection-valued body: element-wise accumulation (the interpreter's
  // zip-broadcast big op — `Σ_k (L + k)` over a 3-list is a 3-list). The body
  // is evaluated WHOLE each iteration and folded through `_SYS.bcast`, so a
  // scalar-at-runtime body stays scalar, cells zip position-wise, and a
  // length mismatch projects to NaN. An empty range answers the scalar
  // identity (0 / 1), matching the interpreter; a BARE collection body never
  // reaches here (it canonicalizes to the `Reduce` collection-reduce form).
  // Everything else keeps the fail-closed assert (Tycho item 45).
  const elementwiseBody = isElementwiseBigOpBody(body);
  if (!elementwiseBody) BaseCompiler.assertScalarBigOpBody(kind, body);

  const { index, lowerExpr, upperExpr, lowerNum, upperNum } = extractLimits(
    clauses[0]
  );

  // Before ANY lowering decision: a statically non-finite bound fails closed.
  // This precedes the unroll path too — `lowerNum`/`upperNum` are `undefined`
  // for a non-finite literal, so it would otherwise fall through to the loop
  // arm and emit `while (i <= Infinity)`.
  assertFiniteBound(kind, lowerExpr, 'lower', target);
  assertFiniteBound(kind, upperExpr, 'upper', target);

  const rest = clauses.slice(1);
  const isSum = kind === 'Sum';
  const op = isSum ? '+' : '*';
  const identity = isSum ? '0' : '1';
  // Complexity is a property of the innermost body — a nested inner sum of a
  // complex body is itself complex, so this stays consistent at every level.
  const bodyIsComplex = BaseCompiler.isComplexValued(body);

  // Compile the term this clause accumulates, under a target that binds this
  // clause's index. For the last clause that's the body; otherwise it's the
  // nested sum/product over the remaining clauses.
  //
  // The body is the binder's own bindable region (design §5.1(a)). Each
  // invocation pushes a FRESH instance of it — which is what makes the UNROLLED
  // form correct: the same body node objects are compiled once per index value
  // (only the index `var` mapping differs), so a node-keyed reuse would emit
  // iteration 1's temporary for every later iteration (§6.1, silent wrong
  // values). The node the region hangs off is the `Sum`/`Product` being
  // lowered — this handler is handed only the operand list.
  const sumNode = BaseCompiler.cseParentNode();
  const compileTerm = (innerTarget: CompileTarget<Expression>): string =>
    rest.length > 0
      ? emitSumProduct(kind, body, rest, innerTarget)
      : BaseCompiler.compileOp(sumNode, 0, innerTarget, 0, body);

  const bothConstant = lowerNum !== undefined && upperNum !== undefined;

  // Empty range (only knowable when both bounds are constant)
  if (bothConstant && lowerNum > upperNum) return identity;

  // Unroll when both bounds are constant and range is small. The element-wise
  // arm never unrolls: joining array terms with the bare scalar operator
  // would string-concatenate them — it always takes the `_SYS.bcast` fold
  // loop below.
  if (bothConstant && !elementwiseBody) {
    const termCount = upperNum - lowerNum + 1;
    if (termCount <= UNROLL_LIMIT) {
      const terms: string[] = [];
      for (let k = lowerNum; k <= upperNum; k++) {
        const innerTarget: CompileTarget<Expression> = {
          ...target,
          var: (id) => (id === index ? String(k) : target.var(id)),
          boundVars: BaseCompiler.withBoundNames(target, [index]),
        };
        terms.push(`(${compileTerm(innerTarget)})`);
      }

      if (!bodyIsComplex) {
        return `(${terms.join(` ${op} `)})`;
      }

      const temps = terms.map((_, i) => `_t${i}`);
      const assignments = terms
        .map((t, i) => `const ${temps[i]} = ${t}`)
        .join('; ');

      if (isSum) {
        const reSum = temps.map((t) => `${t}.re`).join(' + ');
        const imSum = temps.map((t) => `${t}.im`).join(' + ');
        return `(() => { ${assignments}; return { re: ${reSum}, im: ${imSum} }; })()`;
      }

      let acc = temps[0];
      const parts = [assignments];
      for (let i = 1; i < temps.length; i++) {
        const prev = acc;
        acc = `_p${i}`;
        parts.push(
          `const ${acc} = { re: ${prev}.re * ${temps[i]}.re - ${prev}.im * ${temps[i]}.im, im: ${prev}.re * ${temps[i]}.im + ${prev}.im * ${temps[i]}.re }`
        );
      }
      return `(() => { ${parts.join('; ')}; return ${acc}; })()`;
    }
  }

  // Emit a loop (either large constant range or symbolic bounds)
  const lowerCode = compileBound(lowerExpr, lowerNum, target);
  const upperCode = compileBound(upperExpr, upperNum, target);

  const bodyCode = compileTerm({
    ...target,
    var: (id) => (id === index ? index : target.var(id)),
    boundVars: BaseCompiler.withBoundNames(target, [index]),
  });

  const acc = BaseCompiler.tempVar(target);

  // Iteration-budget guard (see CompileTarget.iterationBudget): a trip count
  // over the budget — including infinite or NaN bounds, for which the negated
  // comparison also fails — evaluates to NaN instead of running the loop.
  // At the guard point `index` holds the lower bound, so the trip count is
  // `_upper - index + 1`.
  //
  // With no budget, a SYMBOLIC bound still gets a finiteness guard: it can be
  // `±∞`/`NaN` at run time, which would make the loop guard never fail
  // (`i <= Infinity`) or the counter never advance (`-Infinity + 1` is
  // `-Infinity`) — a hung caller thread. The guard runs once at loop entry
  // (never per iteration) and rejects no finite range however large, so it
  // imposes no trip-count policy. Constant bounds are statically finite by
  // `assertFiniteBound` above and emit no guard at all: their code is
  // unchanged.
  const budget = target.iterationBudget;
  const symbolicBound = lowerNum === undefined || upperNum === undefined;
  const guardNaN = (nan: string): string => {
    if (budget !== undefined)
      return `if (!(_upper - ${index} < ${budget})) return ${nan}; `;
    if (symbolicBound)
      return `if (!Number.isFinite(_upper) || !Number.isFinite(${index})) return ${nan}; `;
    return '';
  };

  if (elementwiseBody) {
    const val = BaseCompiler.tempVar(target);
    // The seed slices an array body (SHALLOW — the guarantee covers only the
    // top-level array; rank-≥2 cells stay shared with the caller) so a
    // single-iteration loop does not hand the caller's own array object back;
    // later iterations allocate fresh arrays through `_SYS.bcast` anyway. A
    // runtime-empty range leaves the accumulator unseeded and answers the
    // scalar identity, like the interpreter.
    //
    // The scalar-NaN LATCH: a length mismatch collapses the `bcast` fold to a
    // scalar NaN; without the latch the NEXT iteration would broadcast that
    // NaN back over the new term's shape, so whether the result was a scalar
    // NaN or an array of NaNs depended on which shape came last. The latch
    // short-circuits to the stable scalar NaN — the same mismatch projection
    // as `_SYS.select`. (At this ABI an error and a legitimate NaN are
    // indistinguishable, so a genuinely-NaN scalar term followed by array
    // terms also latches — the standing error-vs-NaN seam, tracked in
    // ROADMAP. `${acc} !== ${acc}` is false for an array, true only for NaN.)
    return `(() => { let ${acc} = null; let ${index} = ${lowerCode}; const _upper = ${upperCode}; ${guardNaN('NaN')}while (${index} <= _upper) { const ${val} = ${bodyCode}; ${acc} = ${acc} === null ? (Array.isArray(${val}) ? ${val}.slice() : ${val}) : _SYS.bcast((_a, _b) => _a ${op} _b, ${acc}, ${val}); if (${acc} !== ${acc}) return NaN; ${index}++; } return ${acc} === null ? ${identity} : ${acc}; })()`;
  }

  if (bodyIsComplex) {
    const val = BaseCompiler.tempVar(target);
    const guard = guardNaN('{ re: NaN, im: NaN }');
    if (isSum) {
      return `(() => { let ${acc} = { re: 0, im: 0 }; let ${index} = ${lowerCode}; const _upper = ${upperCode}; ${guard}while (${index} <= _upper) { const ${val} = ${bodyCode}; ${acc} = { re: ${acc}.re + ${val}.re, im: ${acc}.im + ${val}.im }; ${index}++; } return ${acc}; })()`;
    }
    return `(() => { let ${acc} = { re: 1, im: 0 }; let ${index} = ${lowerCode}; const _upper = ${upperCode}; ${guard}while (${index} <= _upper) { const ${val} = ${bodyCode}; ${acc} = { re: ${acc}.re * ${val}.re - ${acc}.im * ${val}.im, im: ${acc}.re * ${val}.im + ${acc}.im * ${val}.re }; ${index}++; } return ${acc}; })()`;
  }

  return `(() => { let ${acc} = ${identity}; let ${index} = ${lowerCode}; const _upper = ${upperCode}; ${guardNaN('NaN')}while (${index} <= _upper) { ${acc} ${op}= ${bodyCode}; ${index}++; } return ${acc}; })()`;
}

/**
 * Compile integration to a call to the runtime Monte-Carlo estimator
 * `_SYS.integrate(f, a, b)`.
 *
 * The integrand (`args[0]`) is either a bare expression in the integration
 * variable or — the common LaTeX `\int x^2 dx` parse shape — a `Function`
 * expression `Function(body, param)`. We compile the *body* directly into a
 * single-argument lambda: compiling the `Function` itself would already lower
 * it to a lambda, and wrapping that again would produce a double-lambda
 * `(x) => ((x) => x*x)` whose inner function is never called, so the estimator
 * received a function-returning function and returned `NaN`.
 *
 * The bounds are passed through as their real values. `extractLimits` floors
 * the bounds (correct for the discrete `Sum`/`Product` counters it also
 * serves, wrong for a continuous integral — it collapsed e.g. `∫₀^0.5` to
 * `∫₀^0`), so we compile the bound expressions directly instead.
 */
/**
 * Whether any operand of the integral references a `vars`-mapped symbol — one
 * the caller pinned to a runtime input. Such a symbol must not be folded, so
 * the antiderivative-first path is skipped when the integral touches one.
 */
function referencesVarsSymbol(
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): boolean {
  const keys = target.varsKeys;
  if (!keys || keys.size === 0) return false;
  for (const k of keys) if (args.some((a) => a.has(k))) return true;
  return false;
}

/**
 * Wall-clock budget for one `Integrate` node's antiderivative-first attempt.
 *
 * The attempt is an **optimization** — every integral it declines still
 * compiles, via the quadrature emitter below — so it must never be able to
 * stall a compilation. Compilation establishes no deadline of its own, and
 * since `ce.timeLimit` was retired (`docs/TIMEOUT-MODEL.md` §5) work outside a
 * span runs unbounded: relying on "the enclosing span, if any" meant the
 * default (no span) case could spin forever. So the attempt arms its own span.
 *
 * Per §3.4 nesting is `min()`, so an enclosing consumer span that is tighter
 * still preempts this budget — this can only shorten, never extend, a caller's
 * bound.
 *
 * Sized against the slowest symbolic resolution in the compile-integrate
 * suite (~200 ms on a warm engine), with ~10× headroom for slow CI, so no
 * integral that legitimately closes is pushed onto quadrature.
 */
const ANTIDERIVATIVE_ATTEMPT_BUDGET_MS = 2000;

/**
 * Compile `Integrate(f, (x, a, b))`.
 *
 * **Antiderivative-first.** The integral is first resolved symbolically via
 * `evaluate()` (the provider/Rubi + built-in antiderivative + FTC). If it
 * closes to a form free of any residual `Integrate` — e.g. a plotted
 * `∫₀ˣ f(t) dt` whose closed form is a function of the free bound `x` — that
 * straight-line expression is compiled directly, so each sample costs ~µs
 * instead of a full quadrature. The symbolic attempt runs under its own
 * `ANTIDERIVATIVE_ATTEMPT_BUDGET_MS` span (tightened further by an enclosing
 * span, never extended), so a non-elementary integrand degrades to quadrature
 * rather than hanging. Skipped when the integral references a `vars`-mapped
 * symbol, which must survive to run time as a live input (the vars contract)
 * rather than be folded into a baked closed form.
 *
 * **Quadrature fallback.** Otherwise the compiled definite integral defaults to
 * **deterministic adaptive Gauss–Kronrod (GK15)**: near machine precision on
 * smooth integrands and µs-scale, so a compiled `Integrate` returns the same
 * value on every call. Infinite bounds are handled by a smooth variable
 * transform. Monte-Carlo survives as the automatic non-convergence fallback
 * (pathological integrands) and can be forced with the
 * `quadrature: 'monte-carlo'` option, in which case `_SYS.integrateMC` (the
 * legacy stochastic estimator, ~1e-4 error) is emitted instead.
 */
function compileIntegrate(
  args: ReadonlyArray<Expression>,
  compile: (expr: Expression) => TargetSource,
  target: CompileTarget<Expression>
): string {
  // Antiderivative-first: compile a closed form when the integral resolves to
  // one (and does not reference a `vars`-mapped symbol, which must not fold).
  if (!referencesVarsSymbol(args, target)) {
    const engine = args[0].engine;
    let closed: Expression | undefined;
    // Isolation scope — a child of the caller's scope, so everything the
    // caller declared stays visible; only what this attempt declares is
    // confined, and discarded on the way out. Without it, an integrand with a
    // free single-uppercase-letter symbol (`∫ D x² dx`) devolves the unapplied
    // operator into a variable and shadows the builtin in the caller's engine
    // for good. The node must be BUILT inside the scope, not merely evaluated:
    // `Integrate` is a binder, and its evaluate handler re-enters the parent of
    // the scope its integrand literal owns — the scope fixed when that literal
    // was canonicalized (`rebindEscapingCurrentScope`). Re-boxing the operands
    // from MathJSON is what re-roots them here; `_fn` of the already-canonical
    // operands would keep the caller's scope. The closed form outlives the
    // scope: `compile()` below resolves its free symbols by name against the
    // target's bindings.
    engine.pushScope();
    try {
      const ops = args.map((x) => x.json);
      closed = engine.withTimeLimit(
        {
          ms: ANTIDERIVATIVE_ATTEMPT_BUDGET_MS,
          label: 'compile:antiderivative',
        },
        () => engine.function('Integrate', ops).evaluate()
      );
    } catch {
      // Non-elementary / deadline: fall through to quadrature below.
    } finally {
      engine.popScope();
    }
    if (
      closed !== undefined &&
      !closed.has('Integrate') &&
      closed.isValid &&
      closed.isNaN !== true
    ) {
      try {
        // Parenthesize: the closed form can be a low-precedence expression
        // (e.g. an `Add`), whereas the caller splices this handler's result as
        // an atomic operand (like the `_SYS.integrate(…)` call it replaces).
        return `(${compile(closed)})`;
      } catch {
        // Unlowerable head: fall through to quadrature below.
      }
    }
  }

  const limits = args.slice(1).map(extractLimits);

  // An INDEFINITE integral (`\int f dx` — the `Limits` clause carries `Nothing`
  // for its bounds) that did not close to an antiderivative above has no
  // numeric value at a point: it denotes a function, not a number. The
  // quadrature emitter below would compile the `Nothing` bounds like any other
  // free symbol, to a `vars`-object lookup (`_.Nothing`), and at run time
  // `adaptiveQuadrature(f, undefined, undefined)` reports "converged" and
  // yields `0` for every input — a silent wrong value. Fail closed (D6) so the
  // caller falls back to the interpreter, which keeps the integral symbolic.
  const isUnbounded = (e: Expression | undefined) =>
    e === undefined || isSymbol(e, 'Nothing');
  if (limits.some((l) => isUnbounded(l.lowerExpr) || isUnbounded(l.upperExpr)))
    throw new Error(
      'Integrate: an indefinite integral with no closed-form antiderivative is a function, not a number — it has no value to compute at a point, and quadrature needs bounds. Fail closed (D6). Provide bounds for a definite integral, or evaluate symbolically instead.'
    );

  // Unwrap a `Function(body, …params)` integrand to its body, binding the
  // lambdas to the function's own parameters (one per limit, in limit order,
  // as the canonical handler builds them); otherwise the integrand is a bare
  // expression in the limits' index variables.
  let lambdaVars = limits.map((l) => l.index);
  let bodyExpr = args[0];
  if (isFunction(args[0], 'Function')) {
    const names = args[0].ops
      .slice(1)
      .map((p) => functionLiteralParameterName(p));
    if (names.length === limits.length && names.every((n) => n !== undefined))
      lambdaVars = names as string[];
    bodyExpr = args[0].ops[0];
  }

  const scoped = (names: string[]): CompileTarget<Expression> => ({
    ...target,
    var: (id) => (names.includes(id) ? id : target.var(id)),
    boundVars: BaseCompiler.withBoundNames(target, names),
  });

  const f = BaseCompiler.compile(bodyExpr, scoped(lambdaVars));

  // Multiple limits nest, innermost last (Mathematica iterator convention:
  // the FIRST limit is the OUTERMOST integral). A bound of limit d may
  // reference the outer lambda variables 0..d−1 — at its nesting depth they
  // are in scope, so dependent bounds (∫₀¹dx ∫₀ˣdy) compile naturally.
  const fn =
    target.quadrature === 'monte-carlo' ? '_SYS.integrateMC' : '_SYS.integrate';
  let code = f;
  for (let d = limits.length - 1; d >= 0; d--) {
    const outer = lambdaVars.slice(0, d);
    const boundTarget = outer.length > 0 ? scoped(outer) : target;
    const lo = BaseCompiler.compile(limits[d].lowerExpr, boundTarget);
    const hi = BaseCompiler.compile(limits[d].upperExpr, boundTarget);
    code = `${fn}((${lambdaVars[d]}) => (${code}), ${lo}, ${hi})`;
  }
  return code;
}

/**
 * Check if function has a true name (not anonymous)
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
function isTrulyNamed(func: Function): boolean {
  const source = func.toString();
  if (source.includes('=>')) return false;
  return source.startsWith('function ') && source.includes(func.name);
}

/**
 * Compute the nth Fibonacci number using iterative doubling.
 */
function fibonacci(n: number): number {
  if (!Number.isInteger(n)) return NaN;
  if (n < 0) return n % 2 === 0 ? -fibonacci(-n) : fibonacci(-n);
  if (n <= 1) return n;
  let a = 0;
  let b = 1;
  for (let i = 2; i <= n; i++) {
    const next = a + b;
    a = b;
    b = next;
  }
  return b;
}

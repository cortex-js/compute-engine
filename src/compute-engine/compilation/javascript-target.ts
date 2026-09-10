import type {
  Expression,
  FunctionInterface,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { typeToString } from '../../common/type/serialize.js';
import type { MathJsonSymbol } from '../../math-json/types.js';
import { normalizeDeprecatedCompileOptions } from './deprecation-warnings.js';
import { entryIsPure, entrySource } from './function-purity.js';
import { isCallerMapped } from './cse.js';
import { javascriptStatements } from './javascript-statements.js';
import { compileNumericSelection } from './javascript-selection-fusion.js';
import {
  canIndexArrayDirectly,
  isConstructedScalar,
  numericArrayCells,
  recordIntegerRange,
} from './javascript-value-facts.js';
import { compileWithAutoEscalation } from './auto-escalation.js';
import { resolveStorageHints } from './storage-hints.js';
import {
  isSymbol,
  isNumber,
  isFunction,
  isString,
} from '../boxed-expression/type-guards.js';
import {
  functionLiteralBoundNames,
  functionLiteralParameterName,
} from '../boxed-expression/function-literal.js';
import { Complex } from 'complex-esm';
import {
  tryGetConstant,
  negativeBaseRealPow,
  principalComplexPow,
  foldEmittedJavaScriptCode,
  callerSpliceSources,
} from './constant-folding.js';
import {
  collectionElementType,
  containsBroadcastableType,
  finitePartOfType,
  isNonRealNumber,
  resolveTypeAlias,
  resolveTypeForCompilation,
  stripMissingFromType,
} from '../../common/type/utils.js';
import { couldMatch, isSubtype } from '../../common/type/subtype.js';
import type { Type } from '../../common/type/types.js';
import { parseType } from '../../common/type/parse.js';
import {
  COLLECTION_SHAPE_TYPE,
  INDEXED_COLLECTION_SHAPE_TYPE,
} from '../../common/type/primitive.js';

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

/**
 * Does this operand's TYPE say it is a point with a collection-shaped
 * component — `tuple<list<number>, number>` — without the point being
 * written out as a `Tuple` literal (a symbol bound to `([10, 20], 3)`, a
 * declared parameter)? Such a point is one point PER ELEMENT at evaluation,
 * so its norm is a list, and the literal-only emission (`pointHasBroadcastComponent`,
 * which reads the `Tuple` node) cannot see its components. `_SYS.norm` would
 * flatten the nested array to one wrong number (`Norm(p)` answered 22.56 for
 * `[10.44, 20.22]`), so a lowering that consumes a point through `_SYS.norm`
 * must fail closed on it. A nested tuple component is one leg of the norm,
 * not a collection here.
 */
function isUnwrittenPointWithCollectionComponent(expr: Expression): boolean {
  if (isFunction(expr, 'Tuple')) return false;
  const t = jsType(expr);
  if (typeof t === 'string' || t.kind !== 'tuple') return false;
  const collectionShape = parseType('indexed_collection<any>');
  return t.elements.some((el) => {
    const et = resolveTypeForCompilation(el.type);
    if (et === 'tuple' || (typeof et !== 'string' && et.kind === 'tuple'))
      return false;
    return isSubtype(et, collectionShape);
  });
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
  SMALL_INTEGER,
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
  initialPanelsForDimensions,
  quadratureBeatsMonteCarlo,
} from '../numerics/gauss-kronrod.js';
import { MAX_RANDOM_ELEMENT_COUNT } from '../numerics/random.js';
import {
  MAX_CHUNK_COUNT,
  MAX_COLORMAP_SAMPLES,
  MAX_MATRIX_POWER_EXPONENT,
} from '../numerics/value-scaled-caps.js';
import { interval } from '../numerics/interval.js';
import { withRandomSeedFrame } from '../boxed-expression/utils.js';
import { checkDeadline } from '../../common/interruptible.js';

import {
  BaseCompiler,
  compilationType,
  couldBeCollectionParticipant,
  isFlatAllStringComparisonParticipant,
  isNumericTupleParticipant,
  isProvablyCharacterOperand,
  isProvablyStringComparisonParticipant,
  isProvablyStringOperand,
  isProvablyNonTupleCollectionParticipant,
  isProvablyTupleParticipant,
  installUnrolledBigOpLane,
  pointHasBroadcastComponent,
  unfaithfulComparisonAggregate,
  unionAdmitsIndexedCollection,
} from './base-compiler.js';
import { rewriteAngularUnit } from './angular-unit.js';
import {
  overriddenCompilationHeads,
  unrollFixedWidthCollections,
} from './fixed-width-unroll.js';
import { compileDiagnosticOf } from './diagnostics.js';
import { colorSpaceOf, isColorValued } from './color-space-fact.js';
import type {
  CompileMode,
  CompileTarget,
  CompiledOperators,
  CompiledFunctions,
  LanguageTarget,
  CompilationOptions,
  CompilationResult,
  CompiledColor,
  CompiledColorSpace,
  CompiledRunner,
  CompiledValue,
  ComplexResult,
  OperandCompiler,
  TargetSource,
} from './types.js';

/**
 * JavaScript operator mappings
 */
/**
 * Mathematical constants the JavaScript target bakes into the emitted code,
 * keyed by MathJSON symbol.
 *
 * Consulted by the target's `var` resolver (both the fast path and the main
 * path) and, through `constant`, by the reference analysis that computes
 * `freeSymbols` — a symbol spelled here is inlined, so it is never an input
 * the caller has to supply.
 *
 * Null-prototype so a lookup answers only for a key the table actually
 * declares. A plain object literal inherits `Object.prototype`, so indexing it
 * with an ordinary symbol named `toString`, `constructor` or `valueOf` returns
 * an inherited function rather than `undefined` — which the reference analysis
 * would read as "the target inlines this" and drop a genuine input from
 * `freeSymbols`.
 */
/**
 * The source that reads free symbol `id` off the vars object at run time.
 *
 * Normally a plain member access (`_.x`). A symbol whose NAME collides with an
 * `Object.prototype` member needs an own-property guard: the vars object is
 * supplied by the caller and is an ordinary object, so a missing `toString`
 * reads the INHERITED function instead of `undefined` — `toString + 1`
 * evaluated to the string "function toString() { [native code] }1" where every
 * other missing symbol yields `NaN`. The guard restores that behavior; it is
 * emitted only for the colliding names, so ordinary symbols keep the bare
 * access.
 */
function varsObjectAccess(id: string): string {
  if (!Object.hasOwn(Object.prototype, id)) return `_.${id}`;
  // `Object.prototype.hasOwnProperty.call`, not `Object.hasOwn`: this text
  // becomes part of the emitted `.code` artifact, which the caller may run on
  // a host far older than the Node that compiled it (`Object.hasOwn` is
  // ES2022). The compiler's OWN lookups use `Object.hasOwn` freely.
  return `(Object.prototype.hasOwnProperty.call(_, ${JSON.stringify(
    id
  )}) ? _.${id} : undefined)`;
}

const JAVASCRIPT_CONSTANTS: Record<string, string> = {
  __proto__: null as never,
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
};

/**
 * Identifiers this target bakes into emitted source as literal tokens, which a
 * function parameter must therefore not be emitted under. `_SYS` is the
 * runtime helper namespace every `_SYS.…` lowering names; see
 * `CompileTarget.reservedEmittedNames`. (The vars object `_` is handled
 * separately — `varsObjectName` — because it needs a narrower rename rule.)
 */
const JS_RESERVED_EMITTED_NAMES: ReadonlySet<string> = new Set([
  '_SYS',
  // The arrow parameter an `If`/`Which` binds its condition to when the
  // condition must be inspected twice — once against `true`, once against
  // `false` (`BaseCompiler.exactSelect`). A user parameter of the same name
  // inside an arm would be shadowed by it, so it is renamed on the way in.
  '_CND',
]);

/**
 * The compile modes the JavaScript target offers (`CompileMode`): all three.
 * Its emitters implement the complex lowering (`_SYS.c*`), so `'complex'` and
 * `'auto'` are deliverable; the effective default is therefore `'auto'`.
 */
const JS_SUPPORTED_MODES: readonly CompileMode[] = [
  'strict',
  'complex',
  'auto',
];

/**
 * A value computed after some local `const` bindings: the statement sink's
 * form when this compilation has one (so the bindings become plain statements
 * at a statement position), and an immediately-invoked arrow function
 * otherwise. `bindings` is one or more complete statements, `value` the
 * expression they feed.
 */
function boundJSResult(
  target: CompileTarget<Expression>,
  bindings: string,
  value: string
): string {
  return (
    javascriptStatements(target)?.expression(
      (exit) => `${bindings} ${exit(value)}`
    ) ?? `(() => { ${bindings} return ${value}; })()`
  );
}

// Null-prototype: this table is indexed by an OPERATOR or SYMBOL NAME, and a
// name is arbitrary user text. A plain object literal inherits
// `Object.prototype`, so a name such as `toString`, `constructor` or
// `valueOf` reads the inherited member instead of missing — and because that
// value is a truthy function, the caller treats the symbol as though the
// target defined it. That made `Add(toString, 1)` refuse to compile as a
// bogus "built-in operator with no fixed arity" instead of compiling
// `toString` as an ordinary free symbol.
const JAVASCRIPT_OPERATORS: CompiledOperators = {
  __proto__: null as never,
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
 * True when the operand is a SCALAR piece of text: provably a `string` or
 * provably a `character`.
 *
 * `character` and `string` are disjoint siblings in the type lattice, so
 * `isProvablyStringOperand` alone answers "no" for a character and every
 * text-accepting lowering has to ask both questions. A character lowers to the
 * one-cluster JS string it denotes, so wherever a string operand is
 * concatenated or compared by value, a character operand is handled by exactly
 * the same emitted code — which is why the two are admitted together by
 * `StringJoin`/`String`, the operators whose interpreter counterparts take
 * either kind.
 */
function isProvablyTextOperand(x: Expression): boolean {
  return isProvablyStringOperand(x) || isProvablyCharacterOperand(x);
}

/**
 * True when the ELEMENTS a collection operand yields may be text at run time:
 * the operand is provably a `string` (which `elementsArg` segments into
 * one-cluster strings), or its element type OVERLAPS `string`/`character` — a
 * `list<string>` proves it, a `list<number | string>` admits it.
 *
 * The "overlap" direction (`couldMatch`, which distributes over unions) is what
 * a value-equality lowering needs: an element that is text at run time must go
 * through the interpreter's text conditioning even when the static type only
 * allows it. Call sites are element-comparison lowerings (`Contains`,
 * `Unique`) that have already run `requirePrimitiveElements`, so a top-typed
 * element type — for which `couldMatch` also answers true — has failed closed
 * before reaching this test.
 */
function hasPossiblyTextElements(e: Expression | undefined): boolean {
  if (e === undefined) return false;
  if (isProvablyStringOperand(e)) return true;
  const elt = collectionElementType(jsType(e));
  if (elt === undefined) return false;
  return couldMatch(elt, 'string') || couldMatch(elt, 'character');
}

/**
 * True when `e`'s static type admits text without proving it: a union with an
 * arm that is a subtype of `string` or `character`, e.g. `string | list<number>`
 * (an alias is resolved first, by `jsType`).
 *
 * Such an operand is invisible to `isProvablyStringOperand` (the union is not a
 * subtype of `string`) yet is a subtype of `indexed_collection` — string and
 * list both are — so `isIndexedCollectionOperand` admits it and the list
 * lowerings would run `.slice()`, `.reverse()` and `...` spread over a JS
 * string at run time, operating on UTF-16 code units behind `success: true`
 * (`Reverse` on a decomposed `"é"` would split the base letter from its
 * combining mark). `elementsArg` cannot rescue it either: segmenting is gated
 * on PROOF of a string, so the union is passed through unsegmented. The
 * collection funnels therefore fail closed on it.
 */
export function couldBeStringOperand(e: Expression): boolean {
  const t = jsType(e);
  if (typeof t !== 'object' || t.kind !== 'union') return false;
  return t.types.some(
    (m) =>
      m !== 'never' && (isSubtype(m, 'string') || isSubtype(m, 'character'))
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
 * Whether a binary `Equal` or `NotEqual` can use scalar text equality instead
 * of declining in `assertNoStringOperand`.
 *
 * Text equality uses no numeric tolerance. At least one participant must be
 * provably text, none may be provably numeric or an unfaithful aggregate, and
 * neither may be collection-valued at run time. Collection equality has a
 * separate lowering.
 *
 * An `unknown` scalar opposite provable text is admitted because `_SYS.eqt`
 * conditions text operands and otherwise uses strict equality. A possibly
 * collection-valued unknown is excluded because the interpreter broadcasts it.
 */
function isStringScalarEquality(args: ReadonlyArray<Expression>): boolean {
  if (args.length !== 2) return false;
  // A character is text evidence too, on the same footing as a string: it
  // lowers to the one-cluster JS string it denotes, and the interpreter's
  // equality bridges the two kinds (`compare.ts` / `BoxedCharacter.isSame` —
  // a character and a one-cluster string with the same NFC content are equal),
  // so the strict `===` is faithful for a character/character and a
  // character/string pair alike. Without this clause a two-character `Equal`
  // would otherwise have no text evidence and fall through to numeric tolerance
  // lowering, which is `Math.abs("a" - "a") <= tol` — `NaN <= tol` — so
  // `CharacterFrom("a") == CharacterFrom("a")` compiled to `false` where the
  // interpreter answers `True`.
  if (
    !args.some(
      (a) => isProvablyStringOperand(a) || isProvablyCharacterOperand(a)
    )
  )
    return false;
  if (args.some(isProvablyNumericOperand)) return false;
  if (args.some((a) => unfaithfulComparisonAggregate(a) !== null)) return false;
  return !args.some(
    (a) => couldBeCollectionParticipant(a) || isPossiblyCollectionTypedJS(a)
  );
}

/**
 * Whether binary collection equality can use `_SYS.eq` or `_SYS.neq`: every
 * participant must be a provably flat all-string value
 * (`isFlatAllStringComparisonParticipant`) and
 * at least one of which is a collection. It lowers to the `_SYS.eq`/`_SYS.neq`
 * dispatch, whose scalar leaf now compares two strings with `===` (see
 * `eqTensor`) — so both interpreter shapes come out right:
 * `Equal(["a","b"], ["a","b"])` is the whole-collection `True`, and
 * `Equal(["a","b"], "a")` the element-wise `[True, False]` (both probed).
 *
 * This mirrors the Python target's `_ce_eqcoll` admission. The deliberately
 * narrow predicate excludes a mixed
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
 * Fail closed when a comparison participant is an aggregate whose
 * whole-value comparison neither kernel can reproduce — a `dictionary`, a
 * `record`, or a `tuple` (`unfaithfulComparisonAggregate`).
 *
 * The interpreter compares such an aggregate as one value; both compiled
 * kernels see its JavaScript representation as something to look inside:
 *
 *  - `_SYS.eq`/`_SYS.neq` reduce to the numeric tolerance test, which for two
 *    equal `dictionary<integer>` / `record{…}` values is `Math.abs(obj - obj)`
 *    → `NaN <= tol` → `false`, where the interpreter answers `True`;
 *  - a `tuple` lowers to a JS array, so `Equal(Tuple(1, 2), 1)` runs element-wise
 *    to `[true, false]` and `Equal(Tuple(1, 2), List(1, 2))` to `true`, where
 *    the interpreter answers `False` to both (a point binds atomically);
 *  - `IndexOf`'s element test is the same tolerance test, so a tuple needle was
 *    never found — `IndexOf([[1,2],[3,4]], Tuple(3,4))` ran to `0` against the
 *    interpreter's `2`.
 *
 * The ORDERINGS reach it too (via `compileJSCollectionBoolean`), where it
 * precedes the broader "no element-wise runtime dispatch" refusal that had been
 * catching the same shapes.
 *
 * One carve-out, applied by the caller and not here: a binary `Equal`/`NotEqual`
 * whose every participant is provably tuple-typed with provably numeric
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
 * True when an ordering (`Less`/`LessEqual`/`Greater`/`GreaterEqual`) over these
 * operands must fail closed: at least one operand is provably string, but NOT
 * every operand is.
 *
 * All-string is sound and keeps compiling. The interpreter compares two strings
 * with the same raw JavaScript `<` this target emits (`compare.ts`:
 * `a.string < b.string ? '<' : '>'`), so `"Z" < "a"`, `"10" < "9"`,
 * `"ä" < "b"` and `"abc" < "abd"` all agree — verified against interpretation,
 * and pinned in `compile-string-fail-closed.test.ts`.
 *
 * A mixed pair is silently wrong: the interpreter leaves
 * `Less("a", 1)` symbolic, whereas `"a" < 1` is a plausible-looking
 * `false`. An operand of unknown type alongside a string counts as
 * possibly mixed and declines too: it is not provable string evidence, so it
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

/** Fail closed on a mixed or possibly mixed string ordering. */
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
 * May the `operands` of an equality be compared with the exact `===`/`!==`
 * instead of the tolerance test on their difference?
 *
 * Yes when every one of them is PROVABLY integer-valued and none is
 * complex-shaped. Two distinct integers differ by at least 1, and equal
 * integers differ by exactly 0, so for any tolerance below 1 the tolerance
 * test and `===` accept exactly the same pairs — while `===` needs neither a
 * subtraction nor a `Math.abs` call. A tolerance of 1 or more is a deliberate
 * coarsening the user asked for (it makes 3 and 4 equal), so the exact form is
 * not used there.
 *
 * An operand whose type carries a `nan` arm beside the integer one is admitted
 * as well. `NaN` is what an out-of-range element read (`P[i]`) or a `0/0`
 * answers, and both forms agree with the interpreter on it: `Equal(NaN, 3)` is
 * `False` there, and `NaN === 3` is `false` while the tolerance form's two
 * tests (`NaN === 3` and `Math.abs(NaN - 3) <= tol`) are both `false` too;
 * `NotEqual(NaN, 3)` is `True` there, which `NaN !== 3` reports and which the
 * tolerance form reports as the negation of the same `Equal` test. The two
 * forms agree on the two signed zeros as well: `-0 === 0` is true, and so is
 * `Math.abs(-0 - 0) <= tol`.
 *
 * The heads that carry an `integer` result type — and so take this form — are
 * `Sign`, `Floor`, `Ceil`, `Round`, `Length`, an integer literal, a
 * `Sum`/`Product` index, and an index a comprehension binds over an integer
 * range. The Tycho code-generation audit of 2026-09-08 measured 49 tolerance
 * tests between such operands.
 */
function exactIntegerComparison(
  operands: ReadonlyArray<Expression>,
  tolerance: number
): boolean {
  const integerOrNaN = (a: Expression): boolean =>
    BaseCompiler.isIntegerValued(a) || a.type?.matches('integer | nan') === true;
  return (
    tolerance < 1 &&
    operands.every((a) => integerOrNaN(a) && !BaseCompiler.isComplexValued(a))
  );
}

/**
 * Emit a JavaScript equality test with the engine's numeric tolerance baked in
 * at compile time. The interpreter treats two numbers as equal when
 * `|a − b| <= engine.tolerance` (default 1e-10) — so `0.1 + 0.2 === 0.3` is
 * *true* — whereas a raw `===` is exact and would disagree. `kind` selects
 * Equal (`a === b || |a − b| <= tol`) vs NotEqual (the NEGATION of that same
 * test, not `|a − b| > tol`). Complex operands compare component-wise for
 * exactness and on the modulus of the difference (`_SYS.cabs`) for tolerance.
 * Chained (N-ary) forms conjoin pairwise with `&&`.
 *
 * Two details keep the emission faithful where the difference of the operands
 * is `NaN` — that is, when an operand is `NaN`, and when both operands are
 * infinities of the SAME sign. Every comparison against `NaN` is false, so the
 * bare tolerance test answers `false` for BOTH of those pairs:
 *
 *  - the EXACT pre-test (`exact`) rescues the matching infinities, which the
 *    interpreter answers `Equal(oo, oo)` → `True`;
 *  - `NotEqual` is the NEGATION of the whole `Equal` test, not `|a − b| > tol`.
 *    The `>` form answered `false` on a `NaN` operand — the compiled function
 *    reported that `NaN` EQUALS 3 — while `!(NaN-test)` answers `true`, which
 *    is both the IEEE 754 convention and what the interpreter answers
 *    (`NotEqual(NaN, 3)` is `True`).
 */
function compileJSEquality(
  kind: 'Equal' | 'NotEqual',
  args: ReadonlyArray<Expression>,
  compile: (e: Expression) => string,
  target: CompileTarget<Expression>
): string {
  if (args.length < 2)
    throw new Error(`${kind}: expected at least two arguments`);
  // Check before both lowerings: the `_SYS.eq`/`_SYS.neq` runtime dispatch
  // compares scalars tolerantly too, so a string operand is as wrong there as
  // on the scalar tolerance path.
  //
  // A binary equality whose every participant is provably tuple-typed
  // (`isProvablyTupleParticipant`) with provably numeric components
  // (`isNumericTupleParticipant`) may use `_SYS.eq`/`_SYS.neq`. Its
  // array-vs-array branch is whole-value
  // equality, which is exactly the interpreter's atomic point comparison — at
  // equal or unequal arity. Mixed shapes still decline because one non-tuple
  // participant makes `every` fail. Chained forms are excluded.
  //
  // The numeric-component requirement mirrors the Python target's and closes
  // that helper's numeric element leaf: its tolerance test coerces a boolean
  // (`Math.abs(true - 1)` is 0), so `Equal(Tuple(True, 2), Tuple(1, 2))` ran to
  // `true` and `NotEqual` of the same to `false`, against the interpreter's
  // `False`/`True`. A boolean, `unknown` or otherwise non-numeric component now
  // declines and the interpreter answers.
  //
  // Gate order matters: `assertNoStringOperand` runs unconditionally after
  // this, so a non-tuple participant with string evidence still declines
  // on it. A tuple with a string component
  // (`Equal(Tuple(1, "a"), Tuple(1, "a"))`) is now caught one step earlier, by
  // the numeric-component requirement — the tolerance test is NaN on that
  // component, so `_SYS.eq` would answer `false` where the interpreter answers
  // `True` either way.
  const tupleEquality =
    args.length === 2 &&
    args.every(isProvablyTupleParticipant) &&
    args.every(isNumericTupleParticipant);
  // A point against a non-tuple collection is a CONSTANT: the interpreter
  // compares a point atomically and a list never equals one
  // (`Equal([1,0], Tuple(1,0))` is `False` for literals, and `[1,0] = P` with
  // `P` declared `tuple<number, number>` is `False` once `P` is bound, whatever
  // its coordinates). The literal pair already folds before compilation; a
  // tuple-typed SYMBOL cannot, and declined through the aggregate gate below —
  // a decline that read as a literal-vs-symbol inconsistency (Tycho item 215).
  // Emit the interpreter's constant rather than a structural `_SYS.eq`, which
  // would answer `true` for `[1,0]` against a point at `(1, 0)`.
  if (
    args.length === 2 &&
    ((isProvablyTupleParticipant(args[0]) &&
      isProvablyNonTupleCollectionParticipant(args[1])) ||
      (isProvablyNonTupleCollectionParticipant(args[0]) &&
        isProvablyTupleParticipant(args[1])))
  )
    return kind === 'Equal' ? 'false' : 'true';
  if (!tupleEquality) assertComparableAggregate(kind, args);
  // See `isStringScalarEquality` and `isStringCollectionEquality` for the two
  // text-specific admissions. Everything else with string evidence declines.
  const stringScalar = isStringScalarEquality(args);
  const stringCollection = !stringScalar && isStringCollectionEquality(args);
  if (!stringScalar && !stringCollection) assertNoStringOperand(kind, args);
  if (stringScalar) {
    // Content equality uses no tolerance. `_SYS.eqt`
    // (`compare.ts` compares `a.string === b.string`) — emitted as `_SYS.eqt`.
    //
    // puts a string/string pair through the same ingress conditioning the
    // interpreter applies when it boxes a string or a character (NFC, then the
    // lone-surrogate replacement) before comparing, which a bare `===` does
    // not: `===` answers `false` for a decomposed host string bound to a
    // parameter that the interpreter reads as equal to its precomposed literal.
    // Literals are already conditioned during boxing.
    //
    // Every other pair falls back to strict `===` inside `eqt`, which is what
    // keeps the admitted possibly-text participants honest: this lowering also
    // takes a bare `unknown` operand, and stringifying it would make
    // `Equal(anyq, "1")` answer `true` for the NUMBER 1, where the interpreter
    // answers `False`. That is why the character arm uses `eqt` too rather
    // than the `_SYS.cmpc` comparator the character ORDERINGS use — the two
    // agree on every text pair, since `cmpc` conditions its operands
    // identically.
    const eq = `_SYS.eqt(${compile(args[0])}, ${compile(args[1])})`;
    return kind === 'Equal' ? `(${eq})` : `(!${eq})`;
  }
  // Equality over a (possibly-)collection operand: a raw `Math.abs(a - b)`
  // over a list silently coerces (`[1,2,3] - 2` → NaN), so the scalar codegen
  // below would return a wrong boolean behind a `success: true`. The binary
  // form lowers to the interpreter-faithful runtime dispatch `_SYS.eq`/
  // `_SYS.neq` instead: scalar
  // operands compare tolerantly, an array-vs-scalar pair is element-wise, an
  // array-vs-array pair is whole-collection equality — see `eqTensor`. The
  // gate uses the declared type (not `.isCollection`, which is false for a
  // `list<number>` such as `Power(L, 2)`), plus
  // `isPossiblyCollectionTypedJS` (a `broadcastable<T>` node or a top-typed
  // application such as `h(x)` — `broadcastable<T>` is NOT a subtype of
  // `collection`, so it needs its own test). A bare unknown SYMBOL is
  // excluded by the predicate, so plot equalities (`x^2 + y^2 = 4`) stay on
  // the scalar fast path below.
  //
  // The chained form fails closed. It is not
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
    a.type.matches('collection<any>') || isPossiblyCollectionTypedJS(a);
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
  // Which adjacent pairs take the EXACT `===`/`!==` form rather than the
  // tolerance form? The tolerance form splices both of its operands twice (the
  // exact pre-test and the difference), the exact form only once, so the
  // impure-operand rule below needs the answer per pair.
  const exactPair = (i: number, j: number): boolean =>
    exactIntegerComparison([args[i], args[j]], tol);
  // An IMPURE operand (the Random family) must be evaluated exactly once — the
  // interpreter evaluates each operand once. Three positions splice an operand
  // MORE than once: an operand of a TOLERANCE-form pair appears both in the
  // exact pre-test and in the difference, a COMPLEX operand is spliced twice
  // more by `part()` (once for `.re`, once for `.im`), and a MIDDLE operand of
  // a chained (n-ary) form appears in the two comparisons that straddle it. So
  // `Equal(Random()·i, …)` and `Equal(0.1, Random(), 0.9)` each consumed TWO
  // draws. When any operand is spliced more than once, bind EVERY impure
  // operand — in argument order, so the draw order matches the interpreter's —
  // to an IIFE const, and splice the const instead. Pure operands keep the
  // direct emission byte-identical.
  const multiSpliced = (i: number): boolean =>
    (i >= 1 && i <= args.length - 2) ||
    BaseCompiler.isComplexValued(args[i]) ||
    (i > 0 && !exactPair(i - 1, i)) ||
    (i < args.length - 1 && !exactPair(i, i + 1));
  const bind = args.some((a, i) => a.isPure === false && multiSpliced(i));
  const bindings: string[] = [];
  const codes = args.map((a, _i) => {
    if (!bind || a.isPure !== false) return undefined;
    const t = BaseCompiler.tempVar(target);
    bindings.push(`${t} = ${compile(a)}`);
    return t;
  });
  const code = (i: number): string => codes[i] ?? compile(args[i]);
  const anyComplex = (i: number, j: number): boolean =>
    BaseCompiler.isComplexValued(args[i]) ||
    BaseCompiler.isComplexValued(args[j]);
  // Promote an operand to `{ re, im }`. A real operand contributes
  // `re = code`, `im = 0`.
  const part = (e: Expression, c: string): { re: string; im: string } =>
    BaseCompiler.isComplexValued(e)
      ? { re: `(${c}).re`, im: `(${c}).im` }
      : { re: `(${c})`, im: '0' };
  const distance = (i: number, j: number): string => {
    if (!anyComplex(i, j)) return `Math.abs((${code(i)}) - (${code(j)}))`;
    // The modulus of the difference of the two `{ re, im }` promotions.
    const pa = part(args[i], code(i));
    const pb = part(args[j], code(j));
    return `_SYS.cabs({ re: ${pa.re} - ${pb.re}, im: ${pa.im} - ${pb.im} })`;
  };
  // Bit-exact equality, tested BEFORE the tolerance test. The difference of two
  // infinities of the same sign is `NaN`, and every comparison against `NaN` is
  // false, so the tolerance test alone reports a matching pair of infinities
  // UNEQUAL where the interpreter answers `Equal(oo, oo)` → `True`. The exact
  // test rescues that pair and changes nothing else: two values it accepts have
  // a difference of exactly 0, which the tolerance test accepts as well. It is
  // the shape the Python `_ce_eqcoll` collection helper already used. `NaN`
  // fails both tests, which is again the interpreter's answer.
  // The real arm also checks that the left operand IS a number: a caller
  // variable that is absent reads `undefined`, and two absent operands are
  // `===` to each other, which would report two unknown values EQUAL where
  // the numeric difference (`NaN`) reports them not equal. One check on the
  // left suffices — an absent right operand never equals a number.
  const exact = (i: number, j: number): string => {
    if (!anyComplex(i, j))
      return `(typeof (${code(i)}) === 'number' && (${code(i)}) === (${code(j)}))`;
    const pa = part(args[i], code(i));
    const pb = part(args[j], code(j));
    return `(${pa.re} === ${pb.re} && ${pa.im} === ${pb.im})`;
  };
  const pair = (i: number, j: number): string => {
    if (exactPair(i, j))
      return `((${code(i)}) ${kind === 'Equal' ? '===' : '!=='} (${code(j)}))`;
    const equal = `${exact(i, j)} || ${distance(i, j)} <= ${tol}`;
    return kind === 'Equal' ? `(${equal})` : `(!(${equal}))`;
  };
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
// Null-prototype: this table is indexed by an OPERATOR or SYMBOL NAME, and a
// name is arbitrary user text. A plain object literal inherits
// `Object.prototype`, so a name such as `toString`, `constructor` or
// `valueOf` reads the inherited member instead of missing — and because that
// value is a truthy function, the caller treats the symbol as though the
// target defined it. That made `Add(toString, 1)` refuse to compile as a
// bogus "built-in operator with no fixed arity" instead of compiling
// `toString` as an ordinary free symbol.
const JS_ORDERING_OPERATORS = {
  __proto__: null as never,
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
 * `m1 && m2` returns a whole operand and `!m` returns `false`. The interpreter
 * broadcasts these operators element-wise. The base compiler therefore
 * declines the infix path when an operand has a collection type and dispatches
 * here.
 *
 * This emits the runtime dispatch `_SYS.bcast` over the head's scalar closure:
 * `bcast` applies the closure directly when no argument is an array, recurses
 * per position otherwise
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
    // A CHARACTER participant is diverted here from the infix path in
    // `BaseCompiler` (`orderingOverCharacter`), because a raw `<` on the
    // one-cluster JS strings characters lower to compares UTF-16 code UNITS,
    // which sorts every astral character below U+E000–U+FFFF. The interpreter
    // orders characters by their code-point SEQUENCE (`compare.ts`, decision
    // D8), which is what `_SYS.cmpc` reproduces.
    //
    // BINARY all-character only. A chained character ordering would need the
    // evaluate-each-operand-once temporaries the infix chain path binds, and a
    // character MIXED with anything else fails closed for the same reason a
    // mixed string ordering does: the interpreter leaves
    // `Less(CharacterFrom("a"), 1)` symbolic, whereas an emitted comparison
    // answers a plausible-looking boolean. A character/one-cluster-string pair
    // does compare in the interpreter, but it lands on the mixed-string gate
    // below, which keeps it closed until that widening is decided.
    // (`docs/STRING_ROADMAP.md`, decision D13.)
    if (args.some(isProvablyCharacterOperand)) {
      if (args.length === 2 && args.every(isProvablyCharacterOperand)) {
        const op =
          JS_ORDERING_OPERATORS[kind as keyof typeof JS_ORDERING_OPERATORS];
        return `(_SYS.cmpc(${compile(args[0], 0)}, ${compile(
          args[1],
          1
        )}) ${op} 0)`;
      }
      throw new Error(
        `${kind}: cannot compile — an ordering that mixes a character ` +
          `operand with an operand that is not provably a character (or a ` +
          `chained character ordering). A BINARY all-character ordering does ` +
          `compile, through the code-point comparator the interpreter uses. ` +
          `Fail closed (D6) — the interpreter evaluates it.`
      );
    }
    assertNoMixedStringOrdering(kind, args);
    // A BINARY ALL-STRING ordering is diverted here from the infix path in
    // `BaseCompiler` so that both operands can be put through the same ingress
    // conditioning the interpreter applies when it boxes a string — Unicode
    // NFC normalization, then the lone-surrogate → U+FFFD replacement
    // (`_SYS.ct`, see `conditionText`). The COMPARISON stays the raw infix
    // `<`/`<=`/`>`/`>=`: the interpreter compares two strings with JavaScript's
    // own `<` on their already-conditioned content (`compare.ts`), i.e. UTF-16
    // code-unit order AFTER normalization, so the faithful lowering conditions
    // the operands and keeps the operator. (Not `_SYS.cmpc`, the character
    // comparator: it orders by CODE POINT, which would place every astral
    // character above U+E000–U+FFFF instead of below it, disagreeing with the
    // interpreter on strings.) Without the conditioning, a decomposed
    // `"e" + U+0301` bound to a string parameter compared as LESS than the
    // precomposed `"é"` literal, where the interpreter reads the two as the
    // same string. Maintainer ruling, 2026-08-16.
    //
    // A string LITERAL is left unwrapped: it was conditioned when it was boxed,
    // so `_SYS.ct` on it is a no-op, and skipping it keeps a literal/literal
    // comparison emitting exactly what it emitted before.
    //
    // BINARY only, and the divert in `BaseCompiler` matches: a CHAINED
    // all-string ordering stays on the infix path there, which binds
    // temporaries so that each operand is evaluated exactly once and the
    // comparisons short-circuit — neither of which this arm reproduces.
    if (args.length === 2 && args.every(isProvablyStringOperand)) {
      const op =
        JS_ORDERING_OPERATORS[kind as keyof typeof JS_ORDERING_OPERATORS];
      const conditioned = (i: 0 | 1): string =>
        isString(args[i])
          ? `(${compile(args[i], i)})`
          : `_SYS.ct(${compile(args[i], i)})`;
      return `(${conditioned(0)} ${op} ${conditioned(1)})`;
    }
  }
  // SCALAR operands still lower normally. This handler is also reached from
  // INSIDE the `_SYS.bcast` closure that `BaseCompiler.tryCompileBroadcast`
  // emits for a provable array operand (`Not([True, False])` becomes
  // `_SYS.bcast((_1) => !(_1), [true, false])`), where each element is a
  // scalar — the broadcast lowering below must not fire there.
  const collectionish = (a: Expression): boolean =>
    a.isCollection ||
    a.type.matches('collection<any>') ||
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
 * an indexed collection at run time: the `_SYS.select` element-wise lowering.
 *
 * Each clause is emitted as a thunk so the runtime helper owns evaluation
 * order: conditions in clause order, an arm only if selection reaches it, and
 * then exactly once. The helper also handles the case where every
 * condition turns out scalar at run time: it returns the selected arm whole,
 * so routing a merely-possibly-collection condition here is value-safe.
 *
 * Returns `null` when every condition is provably scalar: the base compiler
 * then emits its ternary chain, unchanged.
 *
 * A COMPLEX-valued arm needs nothing special here. The cell convention it was
 * once said to lack is the one every compiled array already uses: the complex
 * helpers return a plain number when the result is real and a `{ re, im }`
 * object otherwise, so `Sqrt(Negate(List(4, 9, 16)))` on its own compiles to
 * `[{re: 0, im: 2}, {re: 0, im: 3}, {re: 0, im: 4}]`, and a list whose cells
 * are a mix of numbers and complex objects is what the interpreter's own
 * element-wise selection produces. `select` never inspects a cell — it copies
 * `v[j]` through verbatim — and it distinguishes a per-element array arm from
 * an arm lifted whole with `Array.isArray`, which a `{ re, im }` OBJECT fails,
 * so a scalar complex arm broadcasts to its selected positions correctly. An
 * arm therefore compiles exactly as it would outside the selection, and the
 * assembled array agrees with interpretation cell by cell.
 */
function compileJSSelection(
  args: ReadonlyArray<Expression>,
  compile: OperandCompiler<Expression>,
  target?: CompileTarget<Expression>,
  compileUnder?: (
    derived: CompileTarget<Expression>
  ) => OperandCompiler<Expression>
): string | null {
  const conds = args.filter((_x, i) => i % 2 === 0);
  const collectionish = (a: Expression): boolean =>
    a.isCollection ||
    a.type.matches('collection<any>') ||
    isPossiblyCollectionTypedJS(a);
  if (!conds.some(collectionish)) return null;
  if (target) {
    // The generic branch behind the fused loop's guard keeps the operand
    // indices (`compileUnder`), so its lazy positions get their CSE region
    // instances and a subexpression shared by a condition and an arm is still
    // bound once. A caller that hands no factory compiles the branch without
    // indices, which inlines such a subexpression at each position.
    const fused = compileNumericSelection(
      args,
      target,
      (fallbackTarget) =>
        compileJSSelection(
          args,
          compileUnder?.(fallbackTarget) ??
            ((expr) => BaseCompiler.compileValueOperand(expr, fallbackTarget))
        )!
    );
    if (fused !== undefined) return fused;
  }
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
  if (!a.isCollection && !a.type.matches('collection<any>')) return true;
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
 * expression (e.g. `Power(L, 2)`, which types as `list<number>` but is
 * not reported by `.isCollection`). Dictionaries and strings are excluded: they
 * are collections but do not lower to a JS array with count/positional access.
 *
 * Uses the declared type rather than `isFiniteIndexedCollection` from
 * `collection-utils`: importing that module here reorders module init and
 * breaks a runtime binding in the arithmetic broadcast path.
 */
export function isIndexedCollectionOperand(e: Expression): boolean {
  const t = e.type;
  // A STRING is an indexed collection of its grapheme clusters in the type
  // lattice, so it MATCHES `indexed_collection` — but it does not lower to a
  // JS array, and the generic lowerings would be wrong on it in ways that look
  // right: `Length` would emit `.length`, which counts UTF-16 code units, not
  // characters. Exclude it explicitly so string
  // operations fail closed here until the grapheme-aware lowerings exist.
  if (t.matches('string')) return false;
  // This is a SHAPE question — "does this lower to a JS array?" — so it is
  // asked against the absence-admitting family tops `list<any>` /
  // `indexed_collection<any>`: a `list<any>` is array-shaped even though it
  // is not a subtype of the values-only bare `list` (= `list<unknown>`,
  // user ruling 2026-08-17).
  return t.matches('list<any>') || t.matches('indexed_collection<any>');
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
export function couldBeIndexedCollectionOperand(e: Expression): boolean {
  const t = jsType(e);
  if (t === 'unknown' || t === 'any' || t === 'value') return false;
  // A string is not an array-shaped operand — see `isIndexedCollectionOperand`.
  if (t === 'string') return false;
  // Shape question, so asked against the family top `indexed_collection<any>`
  // — see `isIndexedCollectionOperand` above.
  if (typeof t === 'object' && t.kind === 'union')
    return t.types.some((m) => isSubtype(m, INDEXED_COLLECTION_SHAPE_TYPE));
  return isSubtype(t, INDEXED_COLLECTION_SHAPE_TYPE);
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
export function isNumericIndexOperand(e: Expression): boolean {
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
      (a) =>
        !a.type.matches('collection<any>') && !isPossiblyCollectionTypedJS(a)
    );
  }
  // A scalar-or-collection union (`integer | vector<integer^2>`) is a scalar
  // OR a JS array at run time, and code generation has no per-branch path,
  // so the scalar codegen paths must not claim it either. This disjunct is
  // the ONE deliberate divergence from the typing-side twin
  // `isPossiblyCollectionTyped` (`collection-utils.ts`), which types such a
  // union per branch instead — see `unionAdmitsIndexedCollection`
  // (`base-compiler.ts`), shared with `isBoundPossiblyCollectionTyped` so
  // the two compile-side predicates agree.
  if (unionAdmitsIndexedCollection(e.type.type)) return true;
  // A `broadcastable<…>` branch INSIDE a union counts exactly like a bare
  // `broadcastable<…>` type: the operand may hold the collection half of the
  // lift at runtime (`b: number | broadcastable<number>`), so the scalar
  // codegen paths must not claim it. This mirrors the same union arm in
  // `isPossiblyCollectionTyped` (`collection-utils.ts`) — the two predicates
  // are deliberate twins and, apart from the scalar-or-collection union
  // above, must gain disjuncts together.
  const broadcastableKind =
    typeof t !== 'string' &&
    (t.kind === 'broadcastable' ||
      (t.kind === 'union' &&
        t.types.some((branch) => {
          const b = resolveTypeAlias(branch);
          return typeof b !== 'string' && b.kind === 'broadcastable';
        })));
  if (broadcastableKind) {
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
            !a.type.matches('collection<any>') &&
            !isPossiblyCollectionTypedJS(a)
        );
      return (e.ops ?? []).some(
        (a) =>
          a.type.matches('collection<any>') || isPossiblyCollectionTypedJS(a)
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
 * The emitted code for the `idx`-th component of a SYNTACTIC point
 * constructor — `PointList`, `Tuple`, or the flat `List` spelling of a point
 * — or `undefined` when the operand is not one of those, has too few
 * components, or holds work that must still run.
 *
 * `PointX(PointList(a, b))` built the whole point and then indexed the literal
 * array straight back out of it — `([_SYS.pointSlot(_.a), _SYS.pointSlot(_.b)]
 * [0] ?? NaN)`, measured at sixteen sites by the Tycho code-generation audit
 * of 2026-09-09. The component is right there in the operand, so emit it.
 *
 * Three properties of the long form are kept. `PointList` wraps a component
 * whose type does not prove it is a number in `_SYS.pointSlot`, which answers
 * `NaN` when the value turns out to be an array; that guard belongs to the
 * component, so the shortcut keeps it. The interpreter evaluates every operand
 * of the constructor, so a component this shortcut would drop may not carry an
 * observable evaluation — an impure component (a `Random()` draw), or one
 * mentioning a symbol the caller re-mapped through `vars` (whose source this
 * compiler never sees and cannot judge), stands the shortcut down. And the
 * `?? NaN` absence suffix is kept for whatever the long form would have given
 * it (`pointComponentAbsence`, keyed on the coordinate's domain): the
 * component may itself evaluate to `undefined` — a `vars` entry the caller
 * left out of a `run()` call — and `NaN` is the ABI's absence marker. A
 * component that is a number literal cannot be absent and takes no suffix.
 *
 * The shortcut also stands down when the caller supplied its own
 * implementation of the constructor's head: the point is then built by source
 * this compiler never sees, and reading a component off the operand list is
 * not what that source does.
 */
function pointConstructorComponent(
  arg: Expression,
  idx: number,
  compile: (e: Expression) => string,
  target: CompileTarget<Expression>,
  coord: Type | undefined
): string | undefined {
  if (!isFunction(arg)) return undefined;
  const h = arg.operator;
  if (h !== 'PointList' && h !== 'Tuple' && h !== 'List') return undefined;
  if (isCallerMapped(arg, target.cse?.harvestOptions)) return undefined;
  const ops = arg.ops;
  if (ops.length <= idx) return undefined;
  const dropped = ops.filter((_o, i) => i !== idx);
  if (dropped.some((o) => o.isPure === false)) return undefined;
  if (target.varsKeys !== undefined && target.varsKeys.size > 0)
    for (const o of dropped)
      for (const s of o.symbols) if (target.varsKeys.has(s)) return undefined;
  const code = compile(ops[idx]);
  const guarded =
    h === 'PointList' && !ops[idx].type.matches('number')
      ? `_SYS.pointSlot(${code})`
      : code;
  const absence = isNumber(ops[idx]) ? '' : pointComponentAbsence(coord);
  return absence === '' ? guarded : `(${guarded}${absence})`;
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
  compile: (e: Expression) => string,
  target: CompileTarget<Expression>
): string {
  const t = jsType(arg);
  // The operand's own code, compiled at most once and only on a route that
  // needs it: the constructor shortcut emits one component instead and must
  // not pay for building the point that component is read back out of.
  let operandCode: string | undefined;
  const compiled = (): string => (operandCode ??= compile(arg));
  // A single point (tuple): index the coordinate directly.
  if (typeof t !== 'string' && t.kind === 'tuple') {
    const direct = pointConstructorComponent(
      arg,
      idx,
      compile,
      target,
      tupleElementType(t, idx)
    );
    if (direct !== undefined) return direct;
    return `(${compiled()}[${idx}]${pointComponentAbsence(tupleElementType(t, idx))})`;
  }
  // A list of points broadcasts the coordinate — but only when the operand is
  // confirmably a list of points, matching the interpreter's `pointComponentAt`
  // (which inspects concrete elements rather than trusting the declared element
  // type). Any other collection is element-indexing, like First/Second/Third,
  // which is the same `[idx]` access as the single-point case.
  const eltType = collectionElementType(t);
  if (isPointListOperand(arg) || isCoordinateRowListOperand(arg)) {
    // `PointZ` over points whose arity the type does not state: the
    // interpreter measures the first point and errors on the WHOLE
    // application when it is 2-D (`runtimePointArity`), so the run-time
    // helper decides — a per-point `NaN` is not that answer. A stated arity
    // below three never reaches here: the `PointZ` canonical handler already
    // rejected it.
    if (idx === 2 && staticPointArityOf(t) === undefined)
      return `_SYS.pointComponent(${compiled()}, ${idx})`;
    const coord =
      eltType !== undefined && typeof eltType !== 'string'
        ? tupleElementType(eltType, idx)
        : undefined;
    return `(${compiled()}).map((_pt) => _pt[${idx}]${pointComponentAbsence(coord)})`;
  }
  // The static type settles NEITHER reading: an `unknown`-typed operand, or a
  // type that admits a list of points beside a single point — the parameter
  // type a function literal infers from a `PointX(v)` use is
  // `collection<any> | tuple` (`f(v) := PointX(v) + 1`), and a call `f(P)`
  // may hand it one point or a list of them. The interpreter's
  // `pointComponentAt` decides at the VALUE, so the emitted code does too
  // (`_SYS.pointComponent`). Reading such an operand as one point took the
  // first POINT of the list for its x coordinate — the minimal
  // `PointX(v) + 1` over a two-point list answered `[2, 3, 4]` where the
  // interpreter answers `[2, 5]`, and a `PointList` body threw at run time
  // (Tycho item 238).
  if (mayBePointList(t)) return `_SYS.pointComponent(${compiled()}, ${idx})`;
  const direct = pointConstructorComponent(arg, idx, compile, target, eltType);
  if (direct !== undefined) return direct;
  return `(${compiled()}[${idx}]${pointComponentAbsence(eltType)})`;
}

/**
 * The point arity a collection type states for its elements, or `undefined`
 * when it states none: the element count of a parameterized tuple element
 * type, or the last dimension of a rank-2 numeric list (the coordinate-row
 * spelling). Mirrors the interpreter's `staticPointArity`
 * (`library/collections.ts`) for the list shapes the point accessors take.
 */
function staticPointArityOf(t: Type): number | undefined {
  if (typeof t === 'string') return undefined;
  if (t.kind === 'list' && (t.dimensions?.length ?? 0) > 1) {
    const inner = t.dimensions![t.dimensions!.length - 1];
    return inner > 0 ? inner : undefined;
  }
  const elt = collectionElementType(t);
  if (elt !== undefined && typeof elt !== 'string' && elt.kind === 'tuple')
    return elt.elements?.length;
  return undefined;
}

/**
 * Could a value of type `t` be a LIST OF POINTS as well as a single point, so
 * that a coordinate accessor over it has to dispatch at run time? True for an
 * untyped operand and for any type that admits an indexed collection whose
 * element type is not provably a scalar number — a union such as
 * `collection<any> | tuple`, a bare `list`, a `list<any>`. A `list<number>`
 * is a single point spelled flat (`PointX([3, 4])` is `3`) and answers false,
 * as does every non-collection type.
 */
function mayBePointList(t: Type): boolean {
  if (t === 'unknown' || t === 'any') return true;
  if (!couldMatch(t, INDEXED_COLLECTION_SHAPE_TYPE)) return false;
  const elt = collectionElementType(t);
  return elt === undefined || !isSubtype(elt, 'number');
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
  // `{ kind: 'tuple' }` node — and it is what a `list<tuple>` DECLARATION
  // reports (the `PointList` type handler itself answers the parameterized
  // `list<tuple<…>>`), so both spellings must read as a point.
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
  // A STRING matches `indexed_collection` (its elements are its grapheme
  // clusters) but is NOT a zip source: it lowers to a JS string, which has a
  // `.length` and so would zip into garbage, and the runtime `PointList`
  // treats it atomically too. It is a scalar SLOT — the same value in every
  // point.
  if (t === 'string') return false;
  return e.type.matches('indexed_collection<any>');
}

/**
 * A type that is provably a collection — directly, or through any member of a
 * union. Mirrors the guard in the `PointList` definition handler
 * (`library/collections.ts`): such a component is not a scalar slot.
 */
function isProvablyNonScalarType(t: Type): boolean {
  if (typeof t !== 'string' && t.kind === 'union')
    return t.types.some(isProvablyNonScalarType);
  // A string occupies a SCALAR slot — see `isPointListSource` and the mirror
  // guard in the `PointList` definition handler.
  if (t === 'string') return false;
  return isSubtype(t, COLLECTION_SHAPE_TYPE);
}

/**
 * Lower a `PointList` with one or more list SOURCES to the zipped list of
 * points — an array of arrays, exactly the value an evaluated `PointList`
 * compiles to when it is reached the other way round. Reached only when the
 * definition handler declined (it keeps the all-scalar, `Tuple`-identical
 * path); see `docs/COLLECTIONS-MODEL.md`
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
  // Components whose type is `broadcastable<T>`: a source or a scalar slot,
  // decided at run time by `Array.isArray`.
  const maybeSources: string[] = [];
  // The per-point component expressions, in operand order.
  const parts: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    // A component the emission proves scalar by CONSTRUCTION — an explicitly
    // declared scalar input, scalar arithmetic over such values, or a call of
    // a user function whose body yields a scalar under scalar parameters — is
    // a slot, whatever its static type says. It is decided before the type
    // reading below because a top-typed (`unknown`) component would otherwise
    // read as a zip SOURCE (`matches` answers "could be a collection" for a
    // top type).
    const constructedScalarSlot = isConstructedScalar(a, target);
    if (!constructedScalarSlot && isPointListSource(a)) {
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
    if (!constructedScalarSlot && isProvablyNonScalarType(jsType(a)))
      throw new Error(
        `PointList: cannot compile — component ${i + 1} (type ` +
          `\`${a.type.toString()}\`) is neither a scalar slot nor a list ` +
          `source; its per-point value cannot be determined at compile time. ` +
          `Fail closed (D6).`
      );
    const name = BaseCompiler.tempVar(target);
    const t = jsType(a);
    if (a.type.matches('number') || constructedScalarSlot) {
      // Provably scalar numeric: the slot value, verbatim. A constructed
      // scalar cannot hold an array either, so it needs neither the run-time
      // `Array.isArray` role dispatch below nor the guard that projects an
      // array to NaN. (The Tycho code-generation audit of 2026-09-08 measured
      // 43 point lists ending in such a run-time role dispatch.)
      bindings.push(`const ${name} = ${compile(a)};`);
    } else if (containsBroadcastableType(t)) {
      // A `broadcastable<T>` component is a `T` OR an indexed collection of
      // `T`, and — unlike an opaque slot — the type says exactly that, so the
      // role is decided at run time: an array is a zip SOURCE, anything else
      // a scalar slot. `2·PointX(v)` inside a function literal has this type
      // when the parameter `v` may be a point or a list of points; the opaque
      // route below turned its list value into `NaN` (Tycho item 238). The
      // predicate is the one the `PointList` definition handler routes by,
      // so a union arm or an alias reaches here whenever it was declined
      // there.
      bindings.push(`const ${name} = ${compile(a)};`);
      maybeSources.push(name);
      parts.push(`(Array.isArray(${name}) ? ${name}[${idx}] : ${name})`);
      continue;
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
  if (sources.length === 0 && maybeSources.length === 0)
    return `(() => { ${bindings.join(' ')} return [${parts.join(', ')}]; })()`;

  const lengths = sources.map((s) => `${s}.length`);
  // A run-time source joins the shortest-zip length only when it IS an array;
  // as a scalar it contributes no bound.
  for (const s of maybeSources)
    lengths.push(`(Array.isArray(${s}) ? ${s}.length : Infinity)`);
  const budget = target.iterationBudget;
  if (budget !== undefined) lengths.push(String(Math.floor(budget)));
  const n = BaseCompiler.tempVar(target);
  const out = BaseCompiler.tempVar(target);
  // With no static source and every run-time source a scalar, there is
  // nothing to zip: the value is the single point, as the interpreter's
  // all-scalar `PointList` is. Decided on the sources themselves, not on the
  // zip length, which an iteration budget would bound even then.
  const allScalar =
    sources.length === 0
      ? `if (![${maybeSources.join(', ')}].some(Array.isArray)) ` +
        `{ const ${idx} = 0; return [${parts.join(', ')}]; } `
      : '';
  return (
    `(() => { ${bindings.join(' ')} ` +
    allScalar +
    `const ${n} = Math.min(${lengths.join(', ')}); ` +
    `const ${out} = new Array(${n}); ` +
    `for (let ${idx} = 0; ${idx} < ${n}; ${idx}++) ` +
    `${out}[${idx}] = [${parts.join(', ')}]; ` +
    `return ${out}; })()`
  );
}

/**
 * Is this `Join` operand one ELEMENT of the result rather than a collection
 * to splice? Mirrors the interpreter's `isAtomicJoinOperand`
 * (`library/collections.ts`): a tuple — through an alias, and a union whose
 * every arm is a tuple (`isProvablyTupleParticipant`) — or an operand whose
 * static type proves it is not a collection. An `unknown`-typed operand keeps
 * the collection route, where `collArg` fails closed.
 */
function isAtomicJSJoinOperand(a: Expression): boolean {
  if (isProvablyTupleParticipant(a)) return true;
  return !couldMatch(jsType(a), COLLECTION_SHAPE_TYPE);
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
// Null-prototype: this table is indexed by an OPERATOR or SYMBOL NAME, and a
// name is arbitrary user text. A plain object literal inherits
// `Object.prototype`, so a name such as `toString`, `constructor` or
// `valueOf` reads the inherited member instead of missing — and because that
// value is a truthy function, the caller treats the symbol as though the
// target defined it. That made `Add(toString, 1)` refuse to compile as a
// bogus "built-in operator with no fixed arity" instead of compiling
// `toString` as an ordinary free symbol.

/** The compiled operand `x` of a list or tuple literal, spread when it is a
 * name bound to a sequence (`target.sequenceVars`): the `...rest` of a list
 * pattern is a JavaScript array standing for a run of elements, not one
 * element. The name must still resolve to the rest's accessor — a binder
 * inside the case body that shadows it (a lambda parameter, a block local)
 * resolves it to an ordinary value. */
function spreadIfSequence(
  x: Expression,
  compile: (expr: Expression) => string,
  target: CompileTarget<Expression> | undefined
): string {
  const code = compile(x);
  if (
    isSymbol(x) &&
    target !== undefined &&
    target.sequenceVars?.get(x.symbol) === target.var(x.symbol)
  )
    return `...${code}`;
  return code;
}

/**
 * The compiled operand of an IDENTITY lowering — a head whose emitted value is
 * simply its operand's, such as `Abs` of a provably non-negative value, or
 * `Real`/`Conjugate` of a real one — parenthesized when the operand emits an
 * INFIX expression.
 *
 * The compiler splices a function head's emission into its parent WITHOUT
 * parentheses, because a call binds tighter than every operator. An identity
 * lowering breaks that assumption: it hands back the operand's own code, which
 * may be a sum. `3·Re(x + 1)` was emitted as `3 * _.x + 1` and ran as
 * `3x + 1`. The heads whose emission is infix are the ones this target lists
 * in `JAVASCRIPT_OPERATORS`, plus any head the CALLER maps to an infix form
 * through the `operators` compilation option; the caller's mapping wins where
 * both name a head, because it is the mapping the emission used.
 */
function identityPassthrough(
  x: Expression,
  compile: (e: Expression) => string,
  target: CompileTarget<Expression> | undefined
): string {
  return parenthesizeIdentity(x, compile(x), target);
}

/**
 * The already-compiled form of `identityPassthrough`, for a caller that has
 * to compile its operand through a helper of its own and so cannot hand the
 * operand over. Same rule: parenthesize `code` when the head of `x` has an
 * infix spelling on this target.
 */
function parenthesizeIdentity(
  x: Expression,
  code: string,
  target: CompileTarget<Expression> | undefined
): string {
  if (!isFunction(x)) return code;
  const op =
    target?.operators?.(x.operator) ?? JAVASCRIPT_OPERATORS[x.operator];
  return op === undefined ? code : `(${code})`;
}

/**
 * The real and imaginary parts of a complex-valued expression as two pieces of
 * JavaScript source, or `undefined` when the expression cannot be taken apart
 * structurally.
 *
 * `Argument`, `Abs`, `Real` and `Imaginary` each read ONE scalar off a complex
 * value. When the value is built in the expression — the shape
 * `a + i·b` that `Complex(a, b)` and an authored `x + iy` both canonicalize to
 * — the emitter can read that scalar straight from the parts and never build
 * the `{ re, im }` object: `Math.atan2(b, a)` in place of
 * `_SYS.carg({ re: a, im: b })`. The GPU target has done this for the same
 * shape all along (it emits `atan(v.y, v.x)`).
 *
 * Recognized: a real sub-expression (imaginary part zero), a number literal,
 * the imaginary unit, a product with exactly one purely-imaginary factor and
 * real remaining factors, and a sum of those. Anything else — an opaque complex
 * call such as `Sin(z)`, a complex-typed symbol, a product of two complex
 * factors — returns `undefined` and the caller keeps its object-building
 * lowering.
 *
 * Every operand is compiled exactly once, and each contributes its code to
 * only one of the two parts, so no sub-expression is duplicated. An operand
 * with observable effects declines the split: the parts are emitted
 * imaginary-first in `Math.atan2`, which would run the effects in an order the
 * interpreter does not.
 *
 * Each part is parenthesized unless it is a single symbol or number, so a part
 * is safe to splice into any surrounding expression.
 */
function tryGetJSComplexParts(
  expr: Expression,
  compile: (e: Expression) => string
): { re: string; im: string } | undefined {
  if (expr.isPure === false) return undefined;
  const join = (terms: ReadonlyArray<string>, separator: string): string =>
    terms.length === 1 ? terms[0] : `(${terms.join(separator)})`;
  if (!BaseCompiler.isComplexValued(expr)) {
    const code = compile(expr);
    return {
      re: isSymbol(expr) || isNumber(expr) ? code : `(${code})`,
      im: '0',
    };
  }
  if (isNumber(expr)) return { re: String(expr.re), im: String(expr.im) };
  if (isSymbol(expr, 'ImaginaryUnit')) return { re: '0', im: '1' };
  if (isFunction(expr, 'Multiply')) {
    // The one purely-imaginary factor: the `ImaginaryUnit` symbol, or the
    // number literal `Complex(0, k)` that canonicalization puts in its place.
    const ops = expr.ops;
    const scaleOf = (op: Expression): number | undefined =>
      isSymbol(op, 'ImaginaryUnit')
        ? 1
        : isNumber(op) && op.re === 0 && op.im !== 0
          ? op.im
          : undefined;
    const i = ops.findIndex((op) => scaleOf(op) !== undefined);
    if (i < 0) return undefined;
    const rest = ops.filter((_op, k) => k !== i);
    if (rest.some((op) => BaseCompiler.isComplexValued(op))) return undefined;
    const scale = scaleOf(ops[i])!;
    const factors = rest.map((op) =>
      isSymbol(op) || isNumber(op) ? compile(op) : `(${compile(op)})`
    );
    if (scale !== 1) factors.unshift(String(scale));
    return {
      re: '0',
      im: factors.length === 0 ? '1' : join(factors, ' * '),
    };
  }
  if (isFunction(expr, 'Add')) {
    const reTerms: string[] = [];
    const imTerms: string[] = [];
    for (const op of expr.ops) {
      const p = tryGetJSComplexParts(op, compile);
      if (p === undefined) return undefined;
      if (p.re !== '0') reTerms.push(p.re);
      if (p.im !== '0') imTerms.push(p.im);
    }
    return {
      re: reTerms.length === 0 ? '0' : join(reTerms, ' + '),
      im: imTerms.length === 0 ? '0' : join(imTerms, ' + '),
    };
  }
  return undefined;
}

/** The five typed color heads. Their operands are components in their own
 *  color space. */
const COLOR_HEADS = new Set(['Rgb', 'Hsv', 'Hsl', 'Oklab', 'Oklch']);

/**
 * The color-space conversions own a possibly-collection operand themselves —
 * see `CompileTarget.collectionAwareHeads` and `tryCompileColorBroadcast`.
 * They are the only heads on this target that do: every other color operator
 * takes its color operand whole in the interpreter too (none of them is
 * `broadcastable`), so the base compiler's list gates never applied to them.
 */
const JS_COLLECTION_AWARE_HEADS: ReadonlySet<string> = new Set([
  'AsRgb',
  'AsHsv',
  'AsHsl',
  'AsOklab',
  'AsOklch',
]);

/**
 * Compile an operand that sits at a COLOR position.
 *
 * A bare tuple written at a color position denotes 0-1 sRGB components on
 * every route, so `ColorMix((1, 0, 0), (0, 0, 1), 0.5)` mixes red with blue
 * exactly as the interpreter does. A tuple is a bare array of numbers with no
 * color space on it, so it is converted here with the same conversion
 * `Rgb(r, g, b)` takes. Without it the compiled routes read that tuple as a
 * color value and answered a different color than the interpreter for the
 * same expression.
 *
 * A tuple that reaches this position any OTHER way — a tuple-typed variable,
 * or `ColorToColorspace`, whose value is components in the space it names —
 * is DECLINED. Its compiled value is a bare array, which this target reads as
 * a list and never as a color, so passing it through emitted code that threw
 * the color-shape `TypeError` at every run: a compile-time-provable failure
 * reported as `success: true`. Declining hands the expression to the
 * interpreter instead, which is where its answer — an `incompatible-type`
 * error for a valueless variable, a color for a components tuple it can read
 * — comes from. Write `AsRgb(components)` to build a color from 0-1 sRGB
 * components, or `ColorFromColorspace(components, space)` for another space.
 *
 * A `List` written at a color position is refused; only an operand of unknown
 * shape keeps the canonical reading. The interpreter's signatures say `tuple`
 * and it answers `incompatible-type` for a list, so a compiled route must not
 * quietly read as a color what the engine calls an error. A literal tuple of
 * any width other than 3 or 4 is refused for the same reason.
 *
 * An operand that is itself a color CONVERSION needs no special handling: a
 * color value carries its own space, and every helper that consumes a color
 * reads that space (`toOklch`), so a nested conversion answers the
 * interpreter's color. `head` names the head in the diagnostics below.
 */
function compileColorOperand(
  head: string,
  color: Expression,
  compile: (expr: Expression) => string
): string {
  if (isFunction(color, 'List')) refuseColorList();
  if (!isFunction(color, 'Tuple')) {
    if (isProvablyTupleParticipant(color)) refuseColorComponents(head);
    return compile(color);
  }
  const ops = color.ops;
  if (ops.length < 3 || ops.length > 4) refuseColorTupleWidth(ops.length);
  // A component that is provably not a scalar is not a color channel. The
  // interpreter refuses such a tuple (`extractRgb` reads a finite number off
  // each of the first three components), so `((1, 2), 0, 0)` must not compile
  // to a color that comes out as NaN at run time.
  for (const op of ops)
    if (BaseCompiler.isNonScalarShape(op))
      throw new Error(
        'A color channel must be a scalar — a tuple/list component is not a ' +
          'color channel. Fail closed (D6).'
      );
  return `_SYS.rgb(${ops.map((op) => compile(op)).join(', ')})`;
}

/**
 * Compile the operand of an ENTRY function — one of the five `As*`
 * conversions, or `ColorToColorspace` — which takes components as well as a
 * color.
 *
 * These heads are the way a caller turns components into a color, so a tuple
 * at their operand is legitimate input whichever way it arrives. A tuple
 * written literally is read as 0-1 sRGB by `compileColorOperand`. A tuple
 * that arrives through a variable, or from a head that answers components
 * such as `ColorToColorspace`, has no shape at compile time, so the reading
 * is done at run time by `_SYS.colorFromSrgbComponents`: it answers the color
 * of a 3- or 4-element numeric array read as 0-1 sRGB, and refuses any other
 * shape, which is the interpreter's `incompatible-type` for such an operand.
 *
 * Every other color head CONSUMES a color and declines the same operand
 * (`refuseColorComponents`).
 */
function compileColorEntryOperand(
  head: string,
  color: Expression,
  compile: (expr: Expression) => string
): string {
  if (!isFunction(color, 'Tuple') && isProvablyTupleParticipant(color)) {
    // A width the TYPE states is checked here rather than left to the run-time
    // throw, for the same reason a literal tuple's width is: a tuple of two
    // components can never be a color, so the failure is proved now.
    const width = BaseCompiler.aggregateComponentCount(color);
    if (width !== undefined && width !== 3 && width !== 4)
      refuseColorTupleWidth(width);
    return `_SYS.colorFromSrgbComponents(${compile(color)})`;
  }
  return compileColorOperand(head, color, compile);
}

/**
 * The color-space conversions (`AsRgb`, `AsHsv`, `AsHsl`, `AsOklab`,
 * `AsOklch`) are `broadcastable`, so a LIST of colors at their operand is one
 * conversion per element. Emit that map when the operand may be a list at run
 * time; answer `undefined` when it is one color and the caller's ordinary
 * `compileColorOperand` route applies.
 *
 * The map is `_SYS.bcastColor`, not the generic `_SYS.bcast`: it recurses to
 * any depth, as the interpreter's broadcast does, and it answers the
 * non-finite color at an absent position — see that helper.
 *
 * Four operand shapes keep the one-color reading and answer `undefined`. A
 * literal `Tuple` is one color in 0-1 sRGB, which is the shape the
 * definitions exempt from broadcasting (`broadcastExemptions: ['tuples']`). A
 * provably TUPLE-TYPED operand is the same shape reaching the position
 * through a variable or from a head that answers components, and the
 * exemption is about the tuple, not about where it was written: it is one set
 * of components, which the caller lowers through
 * `compileColorEntryOperand`. A provably STRING operand is one CSS color, not
 * a list of its grapheme clusters. And an operand that is not
 * collection-shaped at all is one color by its type.
 *
 * An operand that MAY be a list at run time must prove that every leaf it
 * holds is a color, and the proof is the type matching
 * `NESTED_COLOR_BROADCAST_TYPE`. Without that proof the shape fails closed
 * (D6): a list of plain numbers is what the run-time dispatch cannot tell
 * from one color, and the interpreter answers an `incompatible-type` error
 * for it rather than a color.
 */
/**
 * The type an operand of a color conversion must match for the color-aware
 * broadcast to be sound.
 *
 * `broadcastable<T>` admits a scalar `T` and a LIST of `T`, but not a list of
 * lists of `T`: the nesting has to be spelled out one wrapper per level. The
 * interpreter broadcasts to any depth, and `_SYS.bcastColor` recurses to any
 * depth, so the type is written with several wrappers. Each wrapper only ADDS
 * shapes — `broadcastable<broadcastable<color>>` still admits a bare `color`
 * — so one test at the deepest spelling answers every shallower one. The
 * depth is finite because the spelling must be; a declared color collection
 * nested deeper than this is refused rather than guessed at.
 */
const NESTED_COLOR_BROADCAST_TYPE =
  'broadcastable<broadcastable<broadcastable<broadcastable<color>>>>';

function tryCompileColorBroadcast(
  head: string,
  color: Expression,
  element: (temp: string) => string,
  compile: (expr: Expression) => string,
  target: CompileTarget<Expression>
): string | undefined {
  if (isFunction(color, 'Tuple')) return undefined;
  if (isProvablyTupleParticipant(color)) return undefined;
  if (color.type.matches('string')) return undefined;
  const mayBeList =
    color.isCollection ||
    color.type.matches('collection<any>') ||
    isPossiblyCollectionTypedJS(color);
  if (!mayBeList) return undefined;
  if (!color.type.matches(NESTED_COLOR_BROADCAST_TYPE)) {
    if (isFunction(color, 'List')) refuseColorList();
    throw new Error(
      `${head}: cannot compile a color conversion over an operand that may ` +
        'be a collection at run time and whose type does not prove a color ' +
        'at every element position, at every depth — a list of plain numbers ' +
        'there is a list of errors in the interpreter, and the compiled map ' +
        'would throw at the first element instead. Fail closed (D6).'
    );
  }
  const temp = BaseCompiler.tempVar(target);
  return `_SYS.bcastColor((${temp}) => ${element(temp)}, ${compile(color)})`;
}

/** Decline a `List` written where a color is expected. */
function refuseColorList(): never {
  throw new Error(
    'A list is not a color — a color operand must be a color, a color ' +
      'string or a tuple of 3 or 4 components. Fail closed (D6).'
  );
}

/**
 * Decline a tuple-TYPED operand at a color position — a tuple-typed variable,
 * or a head that answers components such as `ColorToColorspace`.
 *
 * A tuple is COMPONENTS. Its compiled value on this target is a bare array,
 * which every color helper reads as a list and refuses, so the emitted code
 * threw at run time on every input. The message names the two spellings that
 * build a color from components.
 *
 * Only a head that CONSUMES a color reaches here — `ColorMix`, `ColorDelta`,
 * `ColorContrast`, `ContrastingColor`, `ColorToString`. The heads that take
 * components in their own signature (the five `As*` conversions and
 * `ColorToColorspace`) read such an operand as 0-1 sRGB components instead,
 * through `compileColorEntryOperand`, so the message can tell the caller to
 * write one of them.
 */
function refuseColorComponents(head: string): never {
  throw new Error(
    `${head}: this operator takes a COLOR, and a tuple is color COMPONENTS, ` +
      'not a color. Build a color from the components first — ' +
      '`AsRgb((r, g, b))` reads them as 0-1 sRGB, and ' +
      '`ColorFromColorspace(components, space)` reads them in any named ' +
      'space. Fail closed (D6).'
  );
}

/** Decline a literal tuple that is too narrow or too wide to be a color. */
function refuseColorTupleWidth(n: number): never {
  throw new Error(
    `A tuple of ${n} components is not a color — a color tuple has 3 ` +
      'components, or 4 with the fourth read as alpha. Fail closed (D6).'
  );
}

/**
 * Compile an operand that is read as color COMPONENTS rather than as a color
 * value (`ColorFromColorspace`'s first argument).
 *
 * A typed color head compiles to a canonical OKLCh color value, so passing
 * that value on to a routine that converts FROM the named space applied the
 * conversion a second time: `ColorFromColorspace(Rgb(1, 0, 0), 'rgb')` read
 * the OKLCh channels of red back as sRGB channels and answered a color that
 * was not red at all. The interpreter takes the head's components verbatim at
 * this position, so emit them the same way.
 *
 * A `List` written here is refused, not read as components: the interpreter's
 * signature is `(color | tuple, string)` and it answers `incompatible-type`
 * for a list. Only an operand of unknown shape keeps the canonical reading.
 */
function compileColorComponents(
  components: Expression,
  compile: (expr: Expression) => string
): string {
  if (isFunction(components) && COLOR_HEADS.has(components.operator))
    return `[${components.ops.map((op) => compile(op)).join(', ')}]`;
  if (isFunction(components, 'List')) refuseColorList();
  return compile(components);
}

const JAVASCRIPT_FUNCTIONS: CompiledFunctions<Expression> = {
  __proto__: null as never,
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
  Abs: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0])) {
      // A modulus read off a sum of a real and an imaginary part is
      // `Math.hypot` of the two parts — no `{ re, im }` object is built. See
      // `tryGetJSComplexParts`.
      const parts = tryGetJSComplexParts(args[0], compile);
      if (parts !== undefined) return `Math.hypot(${parts.re}, ${parts.im})`;
      return `_SYS.cabs(${compile(args[0])})`;
    }
    if (BaseCompiler.isNonNegative(args[0]))
      return identityPassthrough(args[0], compile, target);
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
    // symbol of unknown magnitude): the node is typed `complex`, so the
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
  Ceil: (args, compile, target) => {
    if (BaseCompiler.isIntegerValued(args[0]))
      return identityPassthrough(args[0], compile, target);
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
  // A STRING source is SEGMENTED first: `"s"[0]` selects a UTF-16 code unit,
  // which for an astral character is half a surrogate pair and for a decomposed
  // sequence only the base letter, where the interpreter yields the whole
  // grapheme cluster (`docs/STRING_ROADMAP.md`,
  // decision D13).
  First: (args, compile) =>
    isProvablyStringOperand(args[0])
      ? `_SYS.chars(${compile(args[0])})[0]`
      : `${compile(args[0])}[0]`,
  Floor: (args, compile, target) => {
    if (BaseCompiler.isIntegerValued(args[0]))
      return identityPassthrough(args[0], compile, target);
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
  // Symbolic-first: a CONSTANT limit is evaluated symbolically at compile
  // time and its closed value emitted. A plain `evaluate()` of a `Limit`
  // runs ONLY the exact `symbolicLimit` route (the numeric Richardson
  // fallback is gated behind `numericApproximation`), so the attempt is
  // deterministic — no wall-clock participates in the decision — and an
  // undecided limit comes back as an inert `Limit`. Its work is bounded by
  // structure, not by a time span: recursion depth is capped (14), each
  // internal `simplify()` is step-capped, and the eligibility gate below
  // caps the operand size — a deliberate contrast with `closedFormIntegral`'s
  // wall-clock budget pool, which trades determinism for latency and is
  // exactly the trade the constant-fold determinism ruling removed. This
  // recovers the folding of convergent constant limits — `lim_{x→0}
  // sin x / x` emits `1` — which the fold's deterministic eligibility gate
  // declines wholesale, because it cannot statically separate the
  // convergent case from the oscillatory one whose NUMERIC fallback is a
  // million-evaluation extrapolation. An undecided or free-variable limit
  // emits the `_SYS.limit` runtime call, where the caller's deadline
  // governs.
  Limit: (args, compile, target) => {
    const [f, x, dir] = args;
    if (f == null || x == null) throw new Error('Limit: missing argument');
    if (symbolicLimitAttemptAllowed(f, x, dir, target)) {
      const engine = f.engine;
      // Isolation scope, as `closedFormIntegral` uses for the analogous
      // compile-time `Integrate` evaluation: `symbolicLimit`'s
      // infinite-point helpers call `ce.symbol(name)`, which auto-declares
      // an undeclared name in the CURRENT scope — without the push, merely
      // compiling a constant limit at infinity could leave a stray binding
      // in the caller's engine for good.
      engine.pushScope();
      try {
        const v = engine
          ._fn('Limit', dir == null ? [f, x] : [f, x, dir])
          .evaluate();
        if (v.isValid && !v.has('Limit') && v.unknowns.length === 0) {
          // The emission bakes whatever engine values the evaluation read:
          // record every symbol of the node in the capture set, so a
          // consumer keyed on `symbolDeps` recompiles when one is
          // re-assigned. Over-recording (a symbol read but not baked) only
          // makes invalidation conservative.
          if (target.symbolDeps)
            for (const op of [f, x, dir])
              if (op != null)
                for (const s of op.symbols) target.symbolDeps.add(s);
          return `(${compile(v)})`;
        }
      } catch (e) {
        // An ordinary evaluation error degrades to the runtime call — but a
        // cancellation raised because the AMBIENT deadline expired must
        // keep cancelling the whole compilation, not be swallowed as a
        // missed fold (the same rule as `tryConstantFold`'s catch).
        if (!engine._shouldContinueExecution()) throw e;
      } finally {
        engine.popScope();
      }
    }
    // The direction operand rides along when present — it used to be
    // dropped, so a compiled one-sided limit (`lim_{x→0⁻}`) silently
    // computed the right-sided limit (`_SYS.limit`'s `dir` defaults to 1,
    // like the interpreter's own unspecified-direction default).
    return `_SYS.limit(${compile(f)}, ${compile(x)}${
      dir == null ? '' : `, ${compile(dir)}`
    })`;
  },
  Ln: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0])) {
      // The operand may be complex only by WIDENESS (the complex discipline
      // lifted it): that is a promotion for the `promoted` report, and the
      // predicate below records it (its lowering is the same kernel).
      BaseCompiler.recordPromotion('Ln', args);
      return `_SYS.cln(${compile(args[0])})`;
    }
    // Real-emitted operand with a complex result — a PROVABLY negative operand
    // (`Ln(-2)`, or `a := -2` → `Ln(a)` is `complex`), or an
    // unknown-sign one under the caller's `complexPromotion` opt-in. The
    // parent emits `{re, im}` arithmetic, so `Math.log` — a `NaN` number —
    // must not be the lowering. Without the opt-in an unknown-sign operand
    // keeps the real kernel (pinned; `promotesToComplexLane` mirrors the
    // `isComplexValued` Sqrt/Ln/Log carve-out, which makes the parent agree).
    if (promotesToComplexLane('Ln', args))
      return `_SYS.cln(${complexOperandCode(args[0], compile)})`;
    return `Math.log(${compile(args[0])})`;
  },
  // A name bound to a SEQUENCE (the `...rest` of a list pattern,
  // `target.sequenceVars`) splices into the literal, as its interpreter
  // `Sequence` value does: `[h, ...t] => [t]` is the tail itself.
  List: (args, compile, target) =>
    `[${args.map((x) => spreadIfSequence(x, compile, target)).join(', ')}]`,
  // Matrix wraps List(List(...), ...) — compile the body (first arg) which
  // is the nested List structure; remaining args are delimiters/column spec
  Matrix: (args, compile) => compile(args[0]),
  // Tuple compiles identically to List
  Tuple: (args, compile, target) =>
    `[${args.map((x) => spreadIfSequence(x, compile, target)).join(', ')}]`,
  // Element count of a compiled collection. Only an indexed collection lowers
  // to a JS array; a dictionary or string operand fails closed (D6).
  Length: (args, compile) => {
    const arg = args[0];
    if (arg === null || arg === undefined)
      throw new Error('Length: no argument');
    // A STRING's length is its GRAPHEME-CLUSTER count, which is what the
    // interpreter's `BoxedString.count` reports. Never `.length` on the JS
    // string: that counts UTF-16 code units, so a ZWJ family emoji would
    // measure 8 and a decomposed `"é"` 2, where the interpreter answers 1.
    // (`docs/STRING_ROADMAP.md`, decision D13.)
    if (isProvablyStringOperand(arg))
      return `_SYS.chars(${compile(arg)}).length`;
    if (!isIndexedCollectionOperand(arg))
      throw new Error(
        `Length: cannot compile — operand is not an indexed collection ` +
          `(list/vector/range). Fail closed (D6).`
      );
    // A union with a text arm (`string | list<number>`) is a subtype of
    // `indexed_collection` — a string is one — and so passes the test above,
    // but `.length` on the JS string it may hold at run time counts UTF-16
    // code units, not the grapheme clusters the interpreter counts. Refused
    // (D6); see `couldBeStringOperand`.
    if (couldBeStringOperand(arg))
      throw new Error(
        `Length: cannot compile — operand may be text at run time (its type ` +
          `has a string arm), and \`.length\` counts UTF-16 code units, not ` +
          `characters. Fail closed (D6) — the interpreter evaluates it.`
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
  At: (args, compile, target) => {
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
    // A STRING base is indexed by GRAPHEME CLUSTER, so it is segmented first
    // and `_SYS.at` then applies the ordinary 1-based / negative-from-the-end
    // convention to the cluster array — which is exactly what the interpreter's
    // `BoxedString.at` does (`boxed-string.ts`: a negative index resolves to
    // `count + index + 1`, and anything out of range yields no value). Indexing
    // the JS string directly would select UTF-16 code units and hand back half
    // a surrogate pair.
    // (`docs/STRING_ROADMAP.md`, decision D13.)
    const stringBase = isProvablyStringOperand(coll);
    const provablyIndexed = stringBase || isIndexedCollectionOperand(coll);
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
    // A positive integer needs only the 1-based offset. The nullish fallback
    // preserves absent positions without a helper call or explicit bounds test.
    if (canIndexArrayDirectly(coll, index, target)) {
      const indexCode = compile(index);
      // The index is often a COMPILE-TIME CONSTANT even though the tree says
      // otherwise: a `Sum` that unrolls substitutes its index at the emitted-
      // VARIABLE level, so the operand here is still the bound symbol while
      // its compiled code is the literal turn number. Read the code, then,
      // rather than the tree — this is the only place the constant is
      // visible. The whole-subtree fold cannot do it: it declines any
      // expression that mentions a compile-bound name, which the operand
      // still does before the unroll.
      //
      // With the cell list and the offset both known, the read has one value.
      // Emitting that value drops the array reference, and with it the
      // preamble local that would hold the list when no other site reads it
      // (a 53-term Game-of-Life seed compiled to 53 reads of a 53-element
      // literal list; the Tycho code-generation audit of 2026-09-08 measured
      // the emitted list at 15.7 KB).
      //
      // Baking the cell is a constant fold, so the caller's opt-out
      // (`constantFold: false`, which the code-generation tests use to
      // inspect the access itself) suppresses it like any other.
      const offset = Number(indexCode);
      if (
        target.constantFold !== false &&
        Number.isSafeInteger(offset) &&
        offset > 0
      ) {
        const cells = numericArrayCells(coll, target);
        // Past the end reads no cell. `?? NaN` is what the array form yields
        // there — the numeric absence marker — so fold to it directly.
        if (cells !== undefined)
          return offset <= cells.length ? compile(cells[offset - 1]) : 'NaN';
      }
      return `((${compile(coll)})[(${indexCode}) - 1] ?? NaN)`;
    }
    const base = `_SYS.at(${stringBase ? `_SYS.chars(${compile(coll)})` : compile(coll)}, ${compile(index)})`;
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
      !isIndexedCollectionOperand(index) &&
      !index.type.matches('collection<any>');
    const numericElement =
      eltT !== undefined &&
      isSubtype(
        stripMissingFromType(resolveTypeForCompilation(eltT)),
        'number'
      );
    const objectDomain =
      eltT !== undefined &&
      eltT !== 'unknown' &&
      eltT !== 'any' &&
      !numericElement;
    if (objectDomain && scalarIndex)
      return `((_v) => (typeof _v === 'number' && Number.isNaN(_v)) ? undefined : _v)(${base})`;
    // A NUMERIC element type is trusted by every consumer of this read: the
    // arithmetic around `xs[1]` is emitted as scalar JavaScript. When the
    // value handed to the kernel contradicts that type — a matrix where a
    // list of numbers was declared or inferred — the scalar `+` on the row
    // would silently produce a concatenated string (`"1,21"`), where the
    // interpreter broadcasts and returns the row plus one. The read checks
    // the run-time shape and fails loudly instead (ruled 2026-09-05; see the
    // `inferOperandTypes` contract in `types-definitions.ts` for why an
    // inferred element type can be numeric). Only a base that reads a value
    // from OUTSIDE the kernel — a free symbol (a `run()` argument) or a
    // function parameter — can contradict its static type; a closed base
    // (`[1, 4, 9][k]`, a constant-folded `Map` over a `Range`) is computed
    // by the engine itself, and its cells are what the type says. A TUPLE
    // base is not checked either: its slots are positional, not a broadcast
    // shape, and the destructuring lowering reads a tuple-valued call result
    // back through `At` on a compiler temporary. The check runs on the
    // RUN-TIME index shape (`_SYS.atNumeric`), not on the static one: an
    // index typed `integer | list<integer>` may be a gather at run time,
    // whose array result is legitimate — what must not be an array is a
    // scalar read's value, or any element of a gathered list.
    const baseType = resolveTypeForCompilation(jsType(coll));
    const tupleBase = typeof baseType !== 'string' && baseType.kind === 'tuple';
    if (numericElement && !tupleBase && coll.unknowns.length > 0)
      return `_SYS.atNumeric(${stringBase ? `_SYS.chars(${compile(coll)})` : compile(coll)}, ${compile(index)}, ${JSON.stringify(typeToString(eltT!))})`;
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
    // A STRING source folds over its CHARACTERS — see `elementsArg`. The gate
    // runs here, ahead of the combiner checks, so the order in which the two
    // diagnostics are reported is unchanged; the operand itself is compiled
    // below, where it was.
    if (!isProvablyStringOperand(coll) && !isIndexedCollectionOperand(coll))
      throw new Error(
        `Reduce: cannot compile — first operand is not an indexed collection ` +
          `(list/vector/range). Fail closed (D6).`
      );
    let combiner = builtinCombiner(
      op,
      BaseCompiler.foldLaneIsComplex(coll, init)
    );
    // The seed's code when the accumulator lane is complex and the seed is
    // real (`combinerPlan.coerceSeed`); `undefined` = compile `init` as-is.
    let seed: string | undefined;
    // The four builtin folds are ARITHMETIC, and the interpreter refuses to
    // apply them to characters: `Reduce("abc", Add)` is an
    // `incompatible-type` error there (probed), whereas the emitted
    // `(_a, _b) => _a + _b` over one-cluster strings CONCATENATES and would
    // answer `"abc"` behind `success: true`. A CUSTOM combiner is unaffected —
    // whatever it does to a character, it does the same thing compiled.
    // (`docs/STRING_ROADMAP.md`, decision D13.)
    if (combiner !== undefined && isProvablyStringOperand(coll))
      throw new Error(
        `Reduce: cannot compile — an ${(op as Expression & { symbol?: string }).symbol ?? 'arithmetic'} ` +
          `fold over a string folds over its CHARACTERS, which the ` +
          `interpreter rejects with an \`incompatible-type\` error rather ` +
          `than combining. Fail closed (D6) — the interpreter evaluates it.`
      );
    if (
      combiner === undefined &&
      (isFunction(op, 'Function') || isSymbol(op))
    ) {
      if (init === undefined || init === null)
        throw new Error(
          `Reduce: a custom combiner compiles only with an explicit ` +
            `initial value. Fail closed (D6).`
        );
      // The combiner is `(accumulator, element)`. The accumulator's type is
      // the fold's own result, which `combinerPlan` decides: an accumulator
      // annotated `complex` is satisfied when the plan puts the accumulator
      // in the complex lane (a real seed is then lifted), and declines
      // otherwise; any other annotation on that position declines.
      const plan = BaseCompiler.combinerPlan(coll, op, init);
      BaseCompiler.assertCallbackAnnotations('Reduce', op, [
        plan?.accComplex ? 'complex' : undefined,
        BaseCompiler.collectionElementTypeOf(coll),
      ]);
      // ACCUMULATOR and ELEMENT lanes (`combinerPlan`): the combiner is
      // compiled with its two parameters bound to the lanes the fold actually
      // runs — the element's from the source, the accumulator's from the seed
      // widened by the body's own result — and a real seed into a complex
      // accumulator lane is lifted to `{re, im: 0}`. Before this, only the
      // element lane was modelled and every accumulator was a plain number:
      // `Reduce(L, (a,x) => a + 2x, 0)` over `[1+2i, i]` answered
      // `{re: "[object Object]0", im: 2}` behind `success: true` where the
      // interpreter gives `2+6i`; a complex seed, a seedless `Scan`, and a
      // bare user-function combiner were wrong the same way.
      combiner = customCombinerWithLanes(op, plan, compile, target);
      seed = plan?.coerceSeed ? `_SYS.cplx(${compile(init)})` : undefined;
    }
    if (combiner === undefined)
      throw new Error(
        `Reduce: the combiner does not compile to a function — only ` +
          `Add/Multiply/Min/Max folds, function literals, and user-defined ` +
          `functions compile on the JavaScript target. Fail closed (D6).`
      );
    const collCode = elementsArg('Reduce', coll, compile);
    // With an initial value, seed the reduce; without one, the native reduce
    // uses the first element as the seed (matching the interpreter, which
    // returns the sole/first element for a singleton and folds pairwise). A
    // seedless native `reduce` throws on an empty array, whereas the
    // interpreter returns `Nothing` (numeric projection NaN) — so guard the
    // empty case to yield NaN instead of throwing at runtime.
    if (init !== undefined && init !== null)
      return `(${collCode}).reduce(${combiner}, ${seed ?? compile(init)})`;
    return `((_l) => _l.length === 0 ? NaN : _l.reduce(${combiner}))(${collCode})`;
  },
  // --- List-shaped collection operators ---------------------------------
  // Each lowers to a native array operation. Only an indexed collection
  // (list/vector/range) lowers to a JS array; other operands fail closed (D6),
  // matching `Length`/`At`/`Reduce`.
  //
  // `Last` is the last element (`At(coll, -1)`); an empty collection yields NaN
  // (the interpreter's `Nothing` projected onto a real target).
  Last: (args, compile) =>
    `_SYS.at(${elementsArg('Last', args[0], compile)}, -1)`,
  // All-but-first / all-but-first-n / first-n. `Take`/`Drop` clamp the count to
  // ≥ 0 so a negative count matches the interpreter (`Take(xs, -2) = []`,
  // `Drop(xs, -2) = xs`), and JS `slice` already clamps a count past the end.
  Rest: (args, compile) =>
    joinIfString(
      args[0],
      `(${elementsArg('Rest', args[0], compile)}).slice(1)`
    ),
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
    const coll = elementsArg('Take', args[0], compile);
    return joinIfString(
      args[0],
      `(${coll}).slice(0, ${clampedSliceCount(args[1], compile)})`
    );
  },
  Drop: (args, compile) => {
    const coll = elementsArg('Drop', args[0], compile);
    if (args[1] == null) throw new Error('Drop: missing count');
    return joinIfString(
      args[0],
      `(${coll}).slice(${clampedSliceCount(args[1], compile)})`
    );
  },
  // Reverse and (ascending, numeric) Sort — copy first so the source array is
  // not mutated. A custom `Sort` comparator is not lowered (fails closed).
  Reverse: (args, compile) =>
    joinIfString(
      args[0],
      `(${elementsArg('Reverse', args[0], compile)}).slice().reverse()`
    ),
  Sort: (args, compile) => {
    const coll = elementsArg('Sort', args[0], compile);
    if (args.length > 1)
      throw new Error(
        `Sort: a custom comparator does not compile; only the default ` +
          `ascending numeric sort is supported. Fail closed (D6).`
      );
    // A STRING source sorts its CHARACTERS, which are ordered by code-point
    // sequence, not numerically: the numeric comparator below would answer NaN
    // for every pair and leave the array in source order. `_SYS.cmpc` is the
    // interpreter's own character order (`compare.ts`, decision D8).
    if (isProvablyStringOperand(args[0]))
      return joinIfString(args[0], `(${coll}).slice().sort(_SYS.cmpc)`);
    return `(${coll}).slice().sort((_a, _b) => _a - _b)`;
  },
  // Flat concatenation of the (top-level) elements of each collection operand.
  //
  // The string-preserving arm comes first: when every operand is provably a
  // string, `Join` is variadic concatenation and answers a `string`, not a
  // `list<character>` (`Join("ab", "cd")` is `"abcd"`, probed). Spreading the
  // operands into an array would answer `["a","b","c","d"]` instead, and would
  // spread UTF-16 code units at that. Each operand goes through the
  // interpreter's ingress conditioning (`_SYS.ct`) and the concatenation is
  // NFC-normalized, since `engine.string()` stores every string in NFC.
  // A mixed call (`Join("ab", ["c"])`) takes the generic arm in the
  // interpreter and answers a `list<character | string>`; here it keeps
  // failing closed, because `collArg` refuses a string operand — a string does
  // not lower to a JS array.
  Join: (args, compile) => {
    if (args.length === 0) return '[]';
    if (args.every(isProvablyStringOperand))
      return `([${args
        .map((a) => `_SYS.ct(${compile(a)})`)
        .join(', ')}].join("").normalize())`;
    // An ATOMIC operand — a tuple (a point is one value, never spliced) or
    // a scalar whose type proves it is not a collection — is one element,
    // as the interpreter's `isAtomicJoinOperand` reads it: `Join([1, 2], 3)`
    // is `[1, 2, 3]`. A tuple used to be spread into its components here.
    return `[${args
      .map((a, i) =>
        isAtomicJSJoinOperand(a)
          ? compile(a)
          : `...(${collArg('Join', a, compile, i + 1)})`
      )
      .join(', ')}]`;
  },
  // Split a string into a list of user-perceived characters. The interpreter
  // segments grapheme clusters (UAX #29 via `Intl.Segmenter`, `library/core.ts`
  // `splitGraphemeClusters`), not code points or UTF-16 units, so neither
  // `[...s]` nor `s.split('')` is faithful: probed, `Characters` answers 1
  // element for a ZWJ family emoji and for a regional-indicator flag (5 and 2
  // code points), and 1 for a decomposed `"e" + U+0301`. `_SYS.chars` runs the
  // same segmenter. A non-string operand leaves the interpreter's `Characters`
  // inert (or an `incompatible-type` error), so it fails closed.
  Characters: (args, compile) =>
    compileJSCharacters('Characters', args, compile),
  // Shipped synonym of `Characters` (v0.30), same interpreter handler.
  GraphemeClusters: (args, compile) =>
    compileJSCharacters('GraphemeClusters', args, compile),
  // `StringJoin(xs, sep?)` — join ONE collection of strings/characters, with
  // `sep` between consecutive elements. Once a string is itself a collection
  // of characters,
  // collection of characters, "a collection and a separator" and "two strings
  // to concatenate" are the same shape and cannot both be supported. So a
  // two-string call now means the SEPARATOR form, exactly as Python's
  // `"-".join("abc")` is `"a-b-c"`; variadic concatenation is `Join(a, b, …)`.
  //
  // Two subject shapes compile:
  //  - a provably string subject, whose elements are its grapheme clusters, so
  //    it is segmented with `_SYS.chars` first — indexing the JS string
  //    directly would join UTF-16 code units and cut a ZWJ family apart;
  //  - an indexed collection whose elements are provably strings or characters
  //    (`list<string>`, `list<character>`), which lowers to a JS array of
  //    one-cluster-or-longer strings.
  //
  // Everything else fails closed, because the interpreter leaves it
  // unevaluated or reports a type error rather than coercing: a non-text
  // element (`StringJoin([1, 2])` is inert — coercion is `String`, a different
  // operator), a non-string separator, and a SCALAR `character` subject, which
  // is an `incompatible-type` error against the `collection<string |
  // character>` parameter (a character is one element, not a collection of
  // them).
  //
  // The elements and the separator go through the interpreter's ingress
  // conditioning (`_SYS.ct`: NFC normalization then the lone-surrogate
  // replacement) because the interpreter joins the content of ALREADY-BOXED
  // strings.
  // Everything `_SYS.chars` produces is conditioned already, so that branch
  // needs no `map`. The result is `.normalize()`d because `engine.string()`
  // stores every string in Unicode NFC: joining `"e"` and `U+0301` yields the
  // single precomposed `"é"` there, and a raw concatenation would not.
  StringJoin: (args, compile) => {
    if (args.length < 1 || args.length > 2)
      throw new Error(
        `StringJoin: cannot compile — the operator takes a collection and an ` +
          `optional separator (\`StringJoin(xs, sep)\`); the variadic ` +
          `concatenation form was removed in Phase 2 (use \`Join(a, b, …)\`). ` +
          `Fail closed (D6) — the interpreter evaluates it.`
      );
    let separator = '""';
    if (args.length === 2) {
      if (!isProvablyStringOperand(args[1]))
        throw new Error(
          `StringJoin: cannot compile — the separator must be provably a ` +
            `string; the interpreter leaves the expression unevaluated on any ` +
            `other operand. Fail closed (D6) — the interpreter evaluates it.`
        );
      separator = `_SYS.ct(${compile(args[1])})`;
    }
    const subject = args[0];
    let elements: string;
    if (isProvablyStringOperand(subject))
      elements = `_SYS.chars(${compile(subject)})`;
    else {
      const elt = collectionElementType(jsType(subject));
      // `never` is the element type of the EMPTY literal `[]`: no element can
      // fail to be a string, and `[].join(sep)` is the interpreter's `""`.
      // `character` elements are admitted alongside `string` ones: a character
      // is exactly one grapheme cluster and lowers to a one-cluster JS string,
      // so joining an array of them is the same `join`. That is the element
      // type `Characters(s)` reports, and the interpreter's `StringJoin`
      // accepts either kind.
      if (
        !isIndexedCollectionOperand(subject) ||
        elt === undefined ||
        (elt !== 'never' &&
          !isSubtype(elt, 'string') &&
          !isSubtype(elt, 'character'))
      )
        throw new Error(
          `StringJoin: cannot compile — the subject must be a string or an ` +
            `indexed collection whose elements are provably strings or ` +
            `characters (\`list<string>\`, \`list<character>\`); a ` +
            `non-collection or non-text operand leaves the interpreter's ` +
            `\`StringJoin\` unevaluated or reports a type error. ` +
            `Fail closed (D6) — the interpreter evaluates it.`
        );
      // Through `collArg`, not `compile`, so the two refusals it owns still
      // apply: an operand whose type merely ADMITS text (`string |
      // list<string>`) would reach this array lowering as a JS string, and an
      // INFINITE pipeline (`Map(Range(1, oo), n -> "a")`) cannot materialize to
      // an array at all — the interpreter declines both.
      elements = `(${collArg('StringJoin', subject, compile)}).map(_SYS.ct)`;
    }
    return `((${elements}).join(${separator}).normalize())`;
  },
  // Textual rendering. Only the TEXT-IN shape compiles: every operand provably
  // a string or a character, which the interpreter concatenates verbatim
  // (probed: `String("a", CharacterFrom("b"))` is `"ab"`). A character is one
  // grapheme cluster and lowers to the one-cluster JS string it denotes, so
  // `String(c)` is that string — the round-trip law
  // `CharacterFrom(String(c)) == c`.
  //
  // Everything else fails closed (D6), and two shapes deserve naming: a NUMBER
  // operand, whose interpreter rendering follows the engine's number-formatting
  // options rather than JS `toString` (`String(0.1 + 0.2)` is not
  // `"0.30000000000000004"`); and the single-COLLECTION join carve-out
  // (`String(Characters(s))` evaluates to `s`), whose declared result type is
  // still `list<character>` rather than `string`, so compiling it would pin a
  // shape whose static contract is unsettled.
  // (`docs/STRING_ROADMAP.md`, decision D13.)
  String: (args, compile) => {
    if (args.length === 0) return '""';
    if (
      !args.every(
        (a) => isProvablyStringOperand(a) || isProvablyCharacterOperand(a)
      )
    )
      throw new Error(
        `String: cannot compile — every operand must be provably a string or ` +
          `a character. Rendering any other value reproduces the engine's ` +
          `number- and expression-formatting options, which this target does ` +
          `not carry. Fail closed (D6) — the interpreter evaluates it.`
      );
    if (args.length === 1) return `(${compile(args[0])})`;
    // `.normalize()` because the interpreter stores every string in NFC
    // (`engine.string()`), so concatenating a base letter and a combining mark
    // must compose, exactly as `StringJoin` does it.
    return `((${args.map((a) => `(${compile(a)})`).join(' + ')}).normalize())`;
  },

  // ── The SEQUENCE-SEARCH family ────────────────────────────────────────────
  //
  // Contiguous-subsequence search over an indexed collection, character-wise on
  // a string. Both operands are lowered to their ELEMENT arrays by
  // `elementsArg` — a string is segmented with `_SYS.chars`, so no comparison
  // can straddle a grapheme-cluster boundary and a `list<character>` needle
  // matches a string subject — and the element test is `_SYS.eqt` inside
  // `_SYS.seqat`/`_SYS.seqidx`, the interpreter's tolerance-free `.isSame()`.
  // A subject or needle whose type merely ADMITS a string (`string |
  // list<number>`) is refused by `collArg`, since the list lowering would walk
  // UTF-16 code units.
  //
  // `_SYS.eqt` compares text with conditioned equality and everything else with
  // `===`, which is REFERENCE identity for a compound element: a nested list
  // lowers to a JS array and a complex number to an object, so two structurally
  // equal elements would compare unequal and the search would answer `false`
  // where the interpreter's `.isSame()` answers `True`. Both operands therefore
  // go through `requirePrimitiveElements`, which admits only real/boolean/
  // string/character elements (and rejects complex CONTENT in a collection that
  // merely reports the generic `number` element type).
  // (`docs/STRING_ROADMAP.md`, decision D8.)

  // The 1-based inclusive index SPAN of the first occurrence, or the
  // interpreter's `Nothing`. `Range(a, b)` lowers to the JS array
  // `[a, …, b]`, so the span is built as that array; absence is `undefined`,
  // the projection an OBJECT-domain `Nothing` already takes on this target
  // (see the `At` handler's out-of-band mapping).
  RangeOf: (args, compile) => {
    if (args.length < 2 || args.length > 3)
      throw new Error(
        `RangeOf: cannot compile — expected \`RangeOf(xs, needle, from?)\`. ` +
          `Fail closed (D6).`
      );
    requirePrimitiveElements('RangeOf', args[0]);
    requirePrimitiveElements('RangeOf', args[1]);
    const subject = elementsArg('RangeOf', args[0], compile, 1);
    // An EMPTY needle is an interpreter ERROR value here, not a span: an empty
    // span is not representable, because `Range(1, 0)` is the DESCENDING range
    // [1, 0] rather than an empty one. A PROVABLY empty needle therefore
    // declines — a known-bad call should not compile — while a needle whose
    // emptiness is only known at run time compiles and carries the
    // `_SYS.domne` guard below.
    if (args[1].isEmptyCollection === true)
      throw new Error(
        `RangeOf: cannot compile — the needle is provably empty, and an ` +
          `empty needle is an error value in the interpreter (an empty span ` +
          `has no \`Range\` representation), which a compiled artifact ` +
          `cannot return. Fail closed (D6) — the interpreter evaluates it.`
      );
    // `elementsArg` yields an ARRAY for both kinds of needle — the grapheme
    // clusters of a string, or the materialized elements of a list — so one
    // length guard covers both. Emitted only when emptiness is undecided at
    // compile time; see `guardedIntegerArg` for the contract this shares with
    // the other domain guards (interpreter returns an error VALUE, compiled
    // code throws — a visible failure, never a wrong value).
    let needle = elementsArg('RangeOf', args[1], compile, 2);
    if (args[1].isEmptyCollection !== false)
      needle =
        `_SYS.domne(${needle}, ` +
        `${JSON.stringify('RangeOf: the needle must not be empty')})`;
    // `from` is 1-based and `_SYS.seqidx` scans from a 0-based offset. A
    // literal in domain becomes that offset now; a COMPUTED `from` compiles
    // and the emitted `_SYS.domi` guard throws when it is below 1 (see
    // `guardedIntegerArg` for why that divergence is the intended one).
    let start = '0';
    if (args.length === 3) {
      const from = literalInteger(args[2]);
      start =
        from !== undefined && from >= 1
          ? `${from - 1}`
          : `(${guardedIntegerArg(
              'RangeOf',
              args[2],
              compile,
              1,
              '`from` must be an integer of 1 or more',
              // No upper bound: the interpreter reads `from` with `toInteger`,
              // not `asSmallInteger`, so a large `from` is not an error value
              // — just a search that starts past the end and answers `Nothing`.
              Number.POSITIVE_INFINITY
            )} - 1)`;
    }
    // The from-offset is a PARAMETER of the IIFE, not inlined in its body, for
    // two reasons. JavaScript evaluates call arguments left to right, so this
    // order fires the `from` guard before the needle guard — the interpreter's
    // order, which checks `start < 1` before the empty needle (`RangeOf` in
    // `library/collections.ts`). And a compiled subexpression inlined in the
    // body would sit inside the scope binding `_s`/`_p`, where a free symbol
    // of either name would be captured.
    return (
      `((_f, _s, _p) => { const _i = _SYS.seqidx(_s, _p, _f); ` +
      `return _i < 0 ? undefined : ` +
      `Array.from({length: _p.length}, (_e, _k) => _i + 1 + _k); })` +
      `(${start}, ${subject}, ${needle})`
    );
  },
  // `True` when the needle occurs as a contiguous subsequence. An EMPTY needle
  // answers `True` — the empty sequence is a subsequence of everything —
  // which `_SYS.seqidx` yields for free by finding it at offset 0. That is the
  // deliberate divergence from `RangeOf`, which must reject an empty needle
  // because it has no representable span; a boolean needs no span.
  ContainsSequence: (args, compile) => {
    if (args.length !== 2)
      throw new Error(
        `ContainsSequence: cannot compile — expected ` +
          `\`ContainsSequence(xs, needle)\`. Fail closed (D6).`
      );
    requirePrimitiveElements('ContainsSequence', args[0]);
    requirePrimitiveElements('ContainsSequence', args[1]);
    const subject = elementsArg('ContainsSequence', args[0], compile, 1);
    const needle = elementsArg('ContainsSequence', args[1], compile, 2);
    return `(_SYS.seqidx(${subject}, ${needle}, 0) >= 0)`;
  },
  // Anchored at the START. A prefix longer than the subject is `False`, and an
  // empty prefix matches everything (following `ContainsSequence`'s rule).
  StartsWith: (args, compile) => {
    if (args.length !== 2)
      throw new Error(
        `StartsWith: cannot compile — expected \`StartsWith(xs, prefix)\`. ` +
          `Fail closed (D6).`
      );
    requirePrimitiveElements('StartsWith', args[0]);
    requirePrimitiveElements('StartsWith', args[1]);
    const subject = elementsArg('StartsWith', args[0], compile, 1);
    const prefix = elementsArg('StartsWith', args[1], compile, 2);
    return (
      `((_s, _p) => _p.length <= _s.length && _SYS.seqat(_s, _p, 0))` +
      `(${subject}, ${prefix})`
    );
  },
  // Anchored at the END — the member that needs the subject's LENGTH, which
  // the materialized element array supplies.
  EndsWith: (args, compile) => {
    if (args.length !== 2)
      throw new Error(
        `EndsWith: cannot compile — expected \`EndsWith(xs, suffix)\`. ` +
          `Fail closed (D6).`
      );
    requirePrimitiveElements('EndsWith', args[0]);
    requirePrimitiveElements('EndsWith', args[1]);
    const subject = elementsArg('EndsWith', args[0], compile, 1);
    const suffix = elementsArg('EndsWith', args[1], compile, 2);
    return (
      `((_s, _p) => _p.length <= _s.length && ` +
      `_SYS.seqat(_s, _p, _s.length - _p.length))(${subject}, ${suffix})`
    );
  },

  // ── String-specific operations ────────────────────────────────────────────
  //
  // Each runs on GRAPHEME CLUSTERS and re-joins once, exactly as the
  // interpreter does (`library/core.ts`), so a combining sequence, a ZWJ emoji
  // family or a regional-indicator flag is never cut in half.
  //
  // The operands whose value decides between a result and an interpreter ERROR
  // VALUE — an empty replace target, an empty pad, a negative count — are
  // decided at COMPILE time when they are literals (an out-of-domain literal
  // declines with its reason named: a known-bad call should not compile) and
  // guarded at RUN time when they are computed, so `PadStart(s, width)` with a
  // computed width compiles. A compiled artifact has no representation for an
  // error value, so the guard THROWS naming the operator and the violated rule:
  // the interpreter returns an error VALUE, compiled code throws — a visible
  // failure, never a wrong value. This follows the `Slice` lowering in this
  // file, whose non-literal span argument likewise compiles and throws at run
  // time when it is not an ascending index range. See `guardedIntegerArg` and
  // `guardedNonEmptyStringArg`.
  // (User ruling 2026-08-16;
  // `docs/STRING_ROADMAP.md`, decision D8.)

  // --- Regular expressions ------------------------------------------------
  // A `regexp` VALUE is the `RegExp(pattern, flags)` expression itself, so a
  // lowering reads its pattern and flag TEXT straight off the operands. Both
  // must be literal strings: a computed pattern has no text at compile time,
  // and emitting `new RegExp(<expr>)` would move a construction error the
  // interpreter reports at canonicalization into the compiled artifact.
  //
  // NOT lowered, deliberately, and it is a coverage boundary rather than a
  // dialect one (the dialect ruling put no limits on patterns): `StringMatch`
  // and `StringMatchAll` report a match RECORD whose `range` is in GRAPHEME
  // CLUSTERS, and a function replacement receives that same record. Compiled
  // code has no record value and no cluster-index translation, so those fail
  // closed with a diagnostic rather than silently reporting code-unit
  // offsets, which would disagree with the interpreter. Absent from the
  // Python and shader targets for the same reason those targets have no
  // string surface at all.
  RegExp: () => {
    throw new Error(
      `RegExp: cannot compile — a compiled pattern is not a value on this ` +
        `target; use it directly in \`IsMatch\` or \`StringReplace\`. ` +
        `Fail closed (D6).`
    );
  },
  IsMatch: (args, compile) => {
    if (args.length !== 2)
      throw new Error(
        `IsMatch: cannot compile — expected \`IsMatch(subject, pattern)\`. ` +
          `Fail closed (D6).`
      );
    const subject = stringArg('IsMatch', args[0], compile, 'the subject');
    const { source, flags } = literalPatternArg('IsMatch', args[1]);
    return `_SYS.reis(${subject}, ${source}, ${flags})`;
  },
  StringReplace: (args, compile) => {
    if (args.length < 3 || args.length > 4)
      throw new Error(
        `StringReplace: cannot compile — expected ` +
          `\`StringReplace(s, target, replacement, count?)\`. Fail closed (D6).`
      );
    const subject = stringArg('StringReplace', args[0], compile, 'the subject');
    // A PATTERN target takes the regex kernel. Only a string replacement is
    // lowered: a function replacement is called with the match record, which
    // this target cannot build (see the note above `RegExp`).
    if (isRegExpOperand(args[1])) {
      const { source, flags } = literalPatternArg('StringReplace', args[1]);
      const repl = stringArg(
        'StringReplace',
        args[2],
        compile,
        'the replacement'
      );
      let n = 'Infinity';
      if (args.length === 4)
        n = guardedIntegerArg(
          'StringReplace',
          args[3],
          compile,
          1,
          `\`count\` must be a positive integer of at most ${SMALL_INTEGER}`
        );
      return `_SYS.rerep(${subject}, ${source}, ${flags}, ${repl}, ${n})`;
    }
    // An EMPTY target is an error value in the interpreter (the "insert at
    // every boundary" behaviour is deliberately not inherited), and it would
    // make `_SYS.srep`'s scan advance by zero and never terminate — so the
    // guard has to hold before the kernel runs, not inside it.
    const needle = guardedNonEmptyStringArg(
      'StringReplace',
      args[1],
      stringArg('StringReplace', args[1], compile, 'the target'),
      'the target must not be empty'
    );
    const replacement = stringArg(
      'StringReplace',
      args[2],
      compile,
      'the replacement'
    );
    let limit = 'Infinity';
    if (args.length === 4)
      limit = guardedIntegerArg(
        'StringReplace',
        args[3],
        compile,
        1,
        `\`count\` must be a positive integer of at most ${SMALL_INTEGER}`
      );
    return `_SYS.srep(${subject}, ${needle}, ${replacement}, ${limit})`;
  },
  Trim: (args, compile) => compileJSTrim('Trim', args, compile, true, true),
  TrimStart: (args, compile) =>
    compileJSTrim('TrimStart', args, compile, true, false),
  TrimEnd: (args, compile) =>
    compileJSTrim('TrimEnd', args, compile, false, true),
  // `n` copies, concatenated and re-segmented once — so a string whose last
  // character combines with its first can yield fewer characters than
  // `n · Length(s)`. That is inherent to joining text, and the interpreter
  // re-segments the same way.
  StringRepeat: (args, compile) => {
    if (args.length !== 2)
      throw new Error(
        `StringRepeat: cannot compile — expected \`StringRepeat(s, n)\`. ` +
          `Fail closed (D6).`
      );
    const subject = stringArg('StringRepeat', args[0], compile, 'the subject');
    const n = guardedIntegerArg(
      'StringRepeat',
      args[1],
      compile,
      0,
      `\`n\` must be a non-negative integer of at most ${SMALL_INTEGER}`
    );
    return `(_SYS.ct(${subject}).repeat(${n}).normalize())`;
  },
  PadStart: (args, compile) => compileJSPad('PadStart', args, compile, true),
  PadEnd: (args, compile) => compileJSPad('PadEnd', args, compile, false),

  // ── Case mapping and comparison ───────────────────────────────────────────
  //
  // `ToUpperCase`/`ToLowerCase` are the interpreter's own JS calls on the same
  // conditioned input, NFC-normalized afterwards as `engine.string()` does —
  // faithful by construction, contextual behaviour (final sigma) and
  // count-changing mappings (`"ß"` → `"SS"`) included. `CaseFold` is
  // `_SYS.cfold`, the same upper→lower round trip with the final sigma
  // restored to medial.
  ToUpperCase: (args, compile) => {
    if (args.length !== 1)
      throw new Error(
        `ToUpperCase: cannot compile — expected \`ToUpperCase(s)\`. ` +
          `Fail closed (D6).`
      );
    const s = stringArg('ToUpperCase', args[0], compile, 'the operand');
    return `(_SYS.ct(${s}).toUpperCase().normalize())`;
  },
  ToLowerCase: (args, compile) => {
    if (args.length !== 1)
      throw new Error(
        `ToLowerCase: cannot compile — expected \`ToLowerCase(s)\`. ` +
          `Fail closed (D6).`
      );
    const s = stringArg('ToLowerCase', args[0], compile, 'the operand');
    return `(_SYS.ct(${s}).toLowerCase().normalize())`;
  },
  CaseFold: (args, compile) => {
    if (args.length !== 1)
      throw new Error(
        `CaseFold: cannot compile — expected \`CaseFold(s)\`. Fail closed (D6).`
      );
    return `_SYS.cfold(${stringArg('CaseFold', args[0], compile, 'the operand')})`;
  },
  // `-1 | 0 | 1` for the two strings' NFC Unicode SCALAR sequences, compared
  // code point by code point. `_SYS.cmpc` is exactly that comparator — the one
  // the character orderings already use — and it returns the same exact
  // integers the interpreter does. NOT `<` on JS strings, which compares UTF-16
  // code UNITS and sorts every astral character below U+E000–U+FFFF.
  StringCompare: (args, compile) => {
    if (args.length !== 2)
      throw new Error(
        `StringCompare: cannot compile — expected \`StringCompare(a, b)\`. ` +
          `Fail closed (D6).`
      );
    const a = stringArg('StringCompare', args[0], compile, 'the first operand');
    const b = stringArg(
      'StringCompare',
      args[1],
      compile,
      'the second operand'
    );
    return `_SYS.cmpc(${a}, ${b})`;
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
    const coll = elementsArg('IndexOf', args[0], compile);
    if (args[1] == null) throw new Error('IndexOf: missing value');
    // Text is admitted on both sides. `_SYS.eqt` provides content equality
    // with no numeric tolerance, matching the interpreter's own `isSame` for a
    // string or character. The
    // interpreter's `BoxedString.contains`/`indexWhere` walk the same grapheme
    // clusters `_SYS.chars` produces. So `IndexOf(["a","b"], "b")` and
    // `IndexOf(Characters("abc"), "c")` compile and agree with interpretation.
    // The test is `_SYS.eqt`, not a bare `===`: it puts a text pair through the
    // interpreter's own ingress conditioning (NFC, then the lone-surrogate
    // replacement) before comparing, so a decomposed needle bound to a compiled
    // parameter is found in a haystack of precomposed literals. Every non-text
    // pair falls back to `===` unchanged.
    if (isProvablyStringOperand(args[0])) {
      assertComparableAggregate('IndexOf', [args[1]]);
      return `((_v) => (${coll}).findIndex((_x) => _SYS.eqt(_x, _v)) + 1)(${compile(
        args[1]
      )})`;
    }
    // An AGGREGATE needle is invisible to the element test — `===` on two
    // distinct arrays is reference identity, so
    // `IndexOf([[1,2],[3,4]], Tuple(3,4))` ran to 0 where the interpreter
    // answers 2.
    assertComparableAggregate('IndexOf', [args[1]]);
    // A needle that is a SCALAR piece of text compares faithfully with `===`
    // and is let through. What the string gate still closes is a needle whose
    // text evidence is NESTED — a `list<string>`, which `===` would compare by
    // reference identity, never finding it where the interpreter compares the
    // lists structurally. `assertNoStringOperand` is the recursive
    // (evidence-anywhere) predicate, which is why it has to be skipped rather
    // than narrowed for the scalar case.
    if (!isProvablyTextOperand(args[1])) {
      assertNoStringOperand('IndexOf', [args[1]]);
      // The same reference-identity failure applies to ANY collection-typed
      // needle, text or not: `IndexOf(xs, n)` with `n: list<number>` compiled
      // to a `findIndex` whose `===` never matches a distinct array, so it
      // ran to 0 where the interpreter compares the lists structurally and
      // answers the position (probe: `xs = [[1],[2]]`, `n = [1]` → 0 vs 1).
      // `assertComparableAggregate` above only closes dictionaries, records
      // and tuples; this closes the remaining collection kinds. A text needle
      // (a `string`, which is now itself a collection type) is excluded by
      // the guard on this block, since `===` IS its faithful test.
      if (
        !(args[1].type.type === 'unknown' || args[1].type.type === 'any') &&
        args[1].type.matches('collection<any>')
      )
        throw new Error(
          `IndexOf: cannot compile — the needle is a collection, which the ` +
            `compiled element test compares by reference identity, never ` +
            `finding it where the interpreter compares element-wise. Fail ` +
            `closed (D6) — the interpreter evaluates it.`
        );
    }
    // No element-type gate: the only shapes the removed one closed were the
    // wholly-text element types (`isSubtype(elt, 'string' | 'character')`),
    // which the `===` leaf now handles faithfully. A MIXED element type such as
    // `number | string` never satisfied that subtype test, so it was never
    // closed here — and needs no closing, since `===` is exact for every
    // element sort (see the boolean note below).
    //
    // `_SYS.eqt` is the whole element test: strict `===` for every non-text
    // pair, and conditioned (NFC, well-formed) content equality for a text
    // pair, which is what the interpreter compares. Plus one departure: NaN.
    // `NaN === NaN` is false, so a NaN needle would never be found, where the
    // interpreter's structural `.isSame()` answers 1 — hence the both-NaN
    // short-circuit. BOOLEAN-ness needs no guard: `true === 1` is false
    // natively (it was the earlier `Math.abs(true - 1) <= tol` leaf that found
    // a boolean needle in a numeric haystack, and a numeric needle in a
    // boolean one, where the interpreter answers 0).
    return `((_v) => (${coll}).findIndex((_x) => (_x !== _x && _v !== _v) || _SYS.eqt(_x, _v)) + 1)(${compile(
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
  Map: (args, compile, target) => {
    if (args[1] == null) throw new Error('Map: missing source collection');
    // The multi-collection (zipWith) form: `Map(f, xs, ys)` is
    // `[f(x1, y1), f(x2, y2), …]`, as long as the SHORTEST source — the
    // interpreter's `count` is the minimum over the sources, and `Zip`
    // truncates the same way. Each source is materialized once and the
    // callback is called with one element from each, positionally, so an
    // annotation on parameter `i` is checked against source `i`'s element
    // type (`zipFnArg`). The sources' runtime lengths are what the length
    // reads, so a source over a symbolic bound (`1..N` with `N` a free input)
    // compiles like the unary form does; with literal bounds the constant
    // fold has usually already replaced the whole `Map` by its value.
    if (args.length > 2) {
      const sources = args.slice(1);
      // The mapping is operand 1, so the first source is operand 2.
      BaseCompiler.assertLockstepSourcesPure('Map', sources, 2);
      const colls = sources.map((a, i) =>
        elementsArg('Map', a, compile, i + 2)
      );
      const fn = zipFnArg('Map', args[0], sources, compile, target);
      return `((_f, ..._ls) => Array.from({ length: Math.min(..._ls.map((_l) => _l.length)) }, (_, _i) => _f(..._ls.map((_l) => _l[_i]))))(${fn}, ${colls.join(', ')})`;
    }
    const coll = elementsArg('Map', args[1], compile);
    return `((_f) => (${coll}).map((_x) => _f(_x)))(${fnArg('Map', args[0], args[1], compile, [], target)})`;
  },
  Filter: (args, compile, target) => {
    const coll = elementsArg('Filter', args[0], compile);
    if (args[1] == null) throw new Error('Filter: missing predicate');
    return joinIfString(
      args[0],
      `((_f) => (${coll}).filter((_x) => _f(_x)))(${fnArg('Filter', args[1], args[0], compile, [], target)})`
    );
  },
  // Number of elements satisfying the predicate.
  CountIf: (args, compile, target) => {
    const coll = elementsArg('CountIf', args[0], compile);
    if (args[1] == null) throw new Error('CountIf: missing predicate');
    return `((_f) => (${coll}).filter((_x) => _f(_x)).length)(${fnArg('CountIf', args[1], args[0], compile, [], target)})`;
  },
  // First element satisfying the predicate; none → NaN (the interpreter's
  // `Nothing` projected onto a real target, matching `Last`).
  Find: (args, compile, target) => {
    const coll = elementsArg('Find', args[0], compile);
    if (args[1] == null) throw new Error('Find: missing predicate');
    return `((_f) => ((${coll}).find((_x) => _f(_x)) ?? NaN))(${fnArg('Find', args[1], args[0], compile, [], target)})`;
  },
  // 1-based index of the first element satisfying the predicate, or 0 if
  // none — `findIndex` is 0-based and returns -1, so `+ 1` maps both.
  IndexWhere: (args, compile, target) => {
    const coll = elementsArg('IndexWhere', args[0], compile);
    if (args[1] == null) throw new Error('IndexWhere: missing predicate');
    return `((_f) => (${coll}).findIndex((_x) => _f(_x)) + 1)(${fnArg('IndexWhere', args[1], args[0], compile, [], target)})`;
  },
  // List of the 1-based indexes of the elements satisfying the predicate.
  Position: (args, compile, target) => {
    const coll = elementsArg('Position', args[0], compile);
    if (args[1] == null) throw new Error('Position: missing predicate');
    return `((_f) => (${coll}).flatMap((_x, _i) => _f(_x) ? [_i + 1] : []))(${fnArg('Position', args[1], args[0], compile, [], target)})`;
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
  Tabulate: (args, compile, target) => {
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
    const f = hoistedCallbackLambda(args[0], compile, target);
    const n = compile(args[1]);
    if (args.length === 2)
      return `((_f, _n) => Array.from({ length: Math.max(0, Math.round(_n)) }, (_, _i) => _f(_i + 1)))(${f}, ${n})`;
    const m = compile(args[2]);
    return `((_f, _n, _m) => Array.from({ length: Math.max(0, Math.round(_n)) }, (_, _i) => Array.from({ length: Math.max(0, Math.round(_m)) }, (_, _j) => _f(_i + 1, _j + 1))))(${f}, ${n}, ${m})`;
  },
  // `Fill(f, (rows, cols))` → rows×cols nested list of `f(i, j)` with
  // 1-based row/column indexes, matching the interpreter. Same hoisting and
  // dimension normalization as `Tabulate`.
  Fill: (args, compile, target) => {
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
    const f = hoistedCallbackLambda(args[0], compile, target);
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
  // `infinity` or `nan`) never produces a list in the interpreter — the
  // declared `integer` parameter means a FINITE integer, so such a count is
  // rejected at the signature — so it fails closed (D6) rather than
  // compiling to `[]` behind `success: true`. A count that the signature
  // cannot decide statically and that is non-finite only at run time
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
  // (`docs/COLLECTIONS-MODEL.md`, Change 2):
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
    joinIfString(
      args[0],
      `(${elementsArg('Most', args[0], compile)}).slice(0, -1)`
    ),
  // 1-based inclusive range. Mirrors the interpreter's Slice collection
  // handler exactly: indexes are rounded (`toInteger`); a start/end < 1 is
  // counted from the end (so a start of 0 resolves PAST the end → empty);
  // start past the end → empty; end clamped to [1, len].
  Slice: (args, compile) => {
    const coll = elementsArg('Slice', args[0], compile);
    // The `(indexed_collection<T>, range)` arm: `Slice(xs, r)` is
    // `Slice(xs, First(r), Last(r))`. The `range` type guarantees an
    // ascending, step-1 span with `first ≥ 1`, so only the end needs
    // clamping — `Array.prototype.slice` does that itself — and a start past
    // the end yields `[]` for free. Gate on the STATIC type, not the operand's
    // head: a symbol declared/inferred `range` compiles through this arm just
    // as a literal `Range` does. A collection operand of any wider type never
    // validated, so it cannot reach here; fail closed anyway rather than
    // reading `_r[0]` off an arbitrary array as a bound.
    //
    // The static type does NOT vouch for the VALUE a `range` symbol receives
    // at run time (`run({ r: [5, 2] })` hands the compiled function an
    // arbitrary array), so the emitted code re-checks the span invariant —
    // every position holds `first + k`, `first ≥ 1` — exactly as the
    // interpreter's `spanBounds` (`library/collections.ts`) does, and fails
    // LOUDLY on a violation (the `PointList` precedent above: a `RangeError`
    // at run time) rather than silently slicing a stepped `[2, 4]` as `2..4`
    // or a descending `[5, 2]` as `[]`. The interpreter declines by leaving
    // the expression unevaluated; compiled code has no inert value to return,
    // so throwing is its fail-closed. The walk is O(span length), no more than
    // the slice it guards.
    if (args.length === 2 && args[1] != null) {
      if (!args[1].type.matches('range'))
        throw new Error(
          'Slice: the two-argument form takes an ascending index span (`range`)'
        );
      return joinIfString(
        args[0],
        `((_l, _r) => { if (!Array.isArray(_r) || _r.length === 0 || !Number.isInteger(_r[0]) || _r[0] < 1) throw new RangeError('Slice: the span argument is not an ascending index range at run time'); for (let _k = 1; _k < _r.length; _k++) if (_r[_k] !== _r[0] + _k) throw new RangeError('Slice: the span argument is not an ascending index range at run time'); return _l.slice(_r[0] - 1, _r[_r.length - 1]); })(${coll}, ${compile(args[1])})`
      );
    }
    if (args[1] == null || args[2] == null)
      throw new Error('Slice: missing index');
    return joinIfString(
      args[0],
      `((_l, _s, _e) => { _s = Math.round(_s); if (!Number.isFinite(_s)) _s = 1; _e = Math.round(_e); if (!Number.isFinite(_e)) _e = _l.length; if (_s < 1) _s = _l.length + 1 + _s; if (_s < 1) _s = 1; if (_s > _l.length) return []; if (_e < 1) _e = _l.length + 1 + _e; if (_e < 1) _e = 1; if (_e > _l.length) _e = _l.length; return _l.slice(_s - 1, _e); })(${coll}, ${compile(args[1])}, ${compile(args[2])})`
    );
  },
  IsEmpty: (args, compile) =>
    `((${elementsArg('IsEmpty', args[0], compile)}).length === 0)`,
  // Number of elements — same as `Length` for an indexed collection.
  //
  // Only the 1-arg cardinality form. `Count(xs, v)` counts the elements equal
  // to `v` and `Count(xs, p)` the elements satisfying the predicate `p`
  // (`library/collections.ts`); `.length` answers neither, so compiling the
  // 2-arg forms this way returned the whole size and diverged from the
  // interpreter with no diagnostic. Decline instead, as `At` does for its
  // multi-index form (D6 fail-closed): the interpreted fallback still
  // evaluates them.
  Count: (args, compile) => {
    if (args.length !== 1)
      throw new Error(
        `Count: only the single-argument cardinality form compiles; the ` +
          `value and predicate forms (\`Count(xs, v)\`, \`Count(xs, p)\`) are ` +
          `not supported. Fail closed (D6).`
      );
    return `(${elementsArg('Count', args[0], compile)}).length`;
  },
  // Membership via SameValueZero (`includes`) — value equality only for
  // primitive elements, so compound element types fail closed.
  Contains: (args, compile) => {
    if (args[0]) requirePrimitiveElements('Contains', args[0]);
    const coll = elementsArg('Contains', args[0], compile);
    if (args[1] == null) throw new Error('Contains: missing value');
    // A TEXT membership test cannot be the raw SameValueZero of `includes`:
    // the interpreter compares strings by their CONDITIONED content (NFC, then
    // the lone-surrogate replacement), so a decomposed `"e" + U+0301` needle
    // bound to a compiled parameter must be found in a haystack of precomposed
    // literals — which `includes` misses, since the two are different
    // code-unit sequences. `_SYS.eqt` is the same element test `IndexOf` uses,
    // and it falls back to strict `===` for every non-text pair. The
    // both-NaN disjunct keeps `includes`'s SameValueZero verdict on NaN, which
    // `===` alone would lose.
    if (hasPossiblyTextElements(args[0]) || isProvablyTextOperand(args[1]))
      return `((_v) => (${coll}).some((_x) => (_x !== _x && _v !== _v) || _SYS.eqt(_x, _v)))(${compile(
        args[1]
      )})`;
    return `(${coll}).includes(${compile(args[1])})`;
  },
  // Unique elements in first-occurrence order (`Set` preserves insertion
  // order and uses SameValueZero — value equality only for primitive
  // elements, so compound element types fail closed).
  Unique: (args, compile) => {
    if (args[0]) requirePrimitiveElements('Unique', args[0]);
    const elements = elementsArg('Unique', args[0], compile);
    // TEXT elements are de-duplicated on their CONDITIONED content, because
    // that is what the interpreter's boxed strings hold: a decomposed
    // `"e" + U+0301` and a precomposed `"é"` supplied at run time are ONE
    // element there, and two distinct keys in a raw `Set`. `_SYS.uniqt`
    // conditions each string element before the `Set` and yields the
    // conditioned form (again matching the interpreter's boxed content); the
    // numeric path keeps the bare `Set` byte-identically.
    if (hasPossiblyTextElements(args[0]))
      return joinIfString(args[0], `_SYS.uniqt(${elements})`);
    return joinIfString(args[0], `[...new Set(${elements})]`);
  },
  // Rotate left/right by n positions (default 1). The shift is rounded and
  // normalized modulo the length, matching the interpreter; a non-finite
  // shift falls back to the default 1 (the interpreter's `toInteger` treats
  // it as missing); an empty collection yields []. The rotation itself is the
  // runtime helper `_SYS.rotl`/`_SYS.rotr` (see `rotl`); a rotation that is
  // consumed element-wise by a broadcast is emitted as an in-place view
  // instead (`_SYS.rotv`, `BaseCompiler.tryCompileBroadcast`).
  RotateLeft: (args, compile) => {
    const coll = elementsArg('RotateLeft', args[0], compile);
    const n = args[1] == null ? '1' : compile(args[1]);
    return joinIfString(args[0], `_SYS.rotl(${coll}, ${n})`);
  },
  RotateRight: (args, compile) => {
    const coll = elementsArg('RotateRight', args[0], compile);
    const n = args[1] == null ? '1' : compile(args[1]);
    return joinIfString(args[0], `_SYS.rotr(${coll}, ${n})`);
  },
  // Element-wise combination: a list of tuples (compiled as arrays), with
  // the length of the shortest input.
  Zip: (args, compile) => {
    if (args.length === 0) return '[]';
    BaseCompiler.assertLockstepSourcesPure('Zip', args, 1);
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
    // A literal count past the cap stays symbolic in the interpreter, so it
    // fails closed here; a run-time count past it answers NaN, the compiled
    // spelling for "no value".
    if (kConst !== undefined && Math.round(kConst) > MAX_CHUNK_COUNT)
      throw new Error(
        `Chunk: a chunk count past ${MAX_CHUNK_COUNT} stays symbolic in the ` +
          `interpreter. Fail closed (D6).`
      );
    return `((_l, _k) => { _k = Math.round(_k); if (!(Number.isFinite(_k) && _k > 0)) return []; if (_k > ${MAX_CHUNK_COUNT}) return NaN; const _sz = Math.ceil(_l.length / _k); return Array.from({ length: _k }, (_, _i) => _l.slice(_i * _sz, (_i + 1) * _sz)); })(${coll}, ${compile(args[1])})`;
  },
  // Integer form yields chunks of SIZE n (trailing chunk may be shorter);
  // with a step, complete sliding windows only — mirroring the interpreter.
  // The predicate form yields [[matching], [non-matching]]. The predicate is
  // hoisted and called unary, like the other higher-order operators.
  Partition: (args, compile, target) => {
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
      return `((_f, _l) => { const _t = [], _u = []; for (const _x of _l) (_f(_x) ? _t : _u).push(_x); return [_t, _u]; })(${fnArg('Partition', arg, args[0], compile, [], target)}, ${coll})`;
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
  //
  // A string source is segmented into its characters, shuffled and rejoined:
  // a permutation of a string's own characters is a string (the
  // string-preservation rule for element-preserving list-out operators.
  // Re-segmentation caveat, shared with the interpreter: rejoining the
  // permuted characters can merge or split clusters, so the result may hold a
  // different number of characters than the source.
  RandomShuffle: (args, compile) => {
    const coll = elementsArg('RandomShuffle', args[0], compile);
    if (args.length > 1)
      throw new Error(
        `RandomShuffle: expected exactly one argument. Fail closed (D6).`
      );
    return joinIfString(args[0], `_SYS.shuffle(${coll})`);
  },
  // True if the predicate holds for at least one / every element (vacuously
  // False / True on an empty collection, like `.some`/`.every`). Only the
  // predicate form compiles: without a predicate the elements must be
  // booleans, which a numeric collection cannot prove — the interpreter
  // stays inert there.
  Any: (args, compile, target) => {
    const coll = elementsArg('Any', args[0], compile);
    if (args[1] == null)
      throw new Error(
        `Any: only the predicate form compiles. Fail closed (D6).`
      );
    return `((_f) => (${coll}).some((_x) => _f(_x)))(${fnArg('Any', args[1], args[0], compile, [], target)})`;
  },
  All: (args, compile, target) => {
    const coll = elementsArg('All', args[0], compile);
    if (args[1] == null)
      throw new Error(
        `All: only the predicate form compiles. Fail closed (D6).`
      );
    return `((_f) => (${coll}).every((_x) => _f(_x)))(${fnArg('All', args[1], args[0], compile, [], target)})`;
  },
  // Longest prefix satisfying the predicate / the rest after that prefix.
  TakeWhile: (args, compile, target) => {
    if (args[1] == null) throw new Error('TakeWhile: missing predicate');
    // A statically infinite operand compiles as a lazy stream, scanned until
    // the predicate first fails (see `takeWhileIter` for the
    // never-false-predicate caveat). The predicate is compiled without the
    // loop-invariant hoist (no `target` is passed to `fnArg`) for the reason
    // `emitLazyStream` states: the stream yields one element at a time, so an
    // upstream stage's callback runs between two calls of this predicate, and
    // an upstream body that assigns a variable of the enclosing scope would
    // leave the predicate reading a binding cached before that assignment.
    if (isLazyStream(args[0]))
      return `_SYS.takeWhileIter(${emitLazyStream(args[0]!, compile)}, ${fnArg('TakeWhile', args[1], args[0], compile)})`;
    const coll = elementsArg('TakeWhile', args[0], compile);
    return joinIfString(
      args[0],
      `((_f, _l) => { const _i = _l.findIndex((_x) => !_f(_x)); return _i < 0 ? _l.slice() : _l.slice(0, _i); })(${fnArg('TakeWhile', args[1], args[0], compile, [], target)}, ${coll})`
    );
  },
  DropWhile: (args, compile, target) => {
    const coll = elementsArg('DropWhile', args[0], compile);
    if (args[1] == null) throw new Error('DropWhile: missing predicate');
    return joinIfString(
      args[0],
      `((_f, _l) => { const _i = _l.findIndex((_x) => !_f(_x)); return _i < 0 ? [] : _l.slice(_i); })(${fnArg('DropWhile', args[1], args[0], compile, [], target)}, ${coll})`
    );
  },
  // Map + flatten one level. Native `flatMap` matches the interpreter for
  // both shapes: a collection-valued mapping is spliced, a scalar result is
  // kept as-is.
  FlatMap: (args, compile, target) => {
    const coll = collArg('FlatMap', args[0], compile);
    if (args[1] == null) throw new Error('FlatMap: missing mapping function');
    return `((_f) => (${coll}).flatMap((_x) => _f(_x)))(${fnArg('FlatMap', args[1], args[0], compile, [], target)})`;
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
    const builtin = builtinCombiner(
      op,
      BaseCompiler.foldLaneIsComplex(coll, init)
    );
    // As `Reduce`: the accumulator's annotation is judged against the lane
    // `combinerPlan` chose.
    const plan =
      builtin === undefined
        ? BaseCompiler.combinerPlan(coll, op, init)
        : undefined;
    if (builtin === undefined)
      BaseCompiler.assertCallbackAnnotations('Scan', op, [
        plan?.accComplex ? 'complex' : undefined,
        BaseCompiler.collectionElementTypeOf(coll),
      ]);
    // Accumulator and element lanes as for `Reduce` above (`combinerPlan`).
    // `Scan` was wrong the same way from the SECOND element on — over
    // `[1+2i, i]` it answered `[{re:2,im:4}, {re:"[object Object]0",im:2}]`
    // where the interpreter gives `[2+4i, 2+6i]` — and a seedless `Scan`
    // over complex elements from the first: its accumulator IS the first
    // element, so its lane is the element's.
    const combiner =
      builtin ??
      (isFunction(op, 'Function') || isSymbol(op)
        ? customCombinerWithLanes(op, plan, compile, target)
        : undefined);
    if (combiner === undefined)
      throw new Error(
        `Scan: the combiner does not compile to a function — only ` +
          `Add/Multiply/Min/Max folds, function literals, and user-defined ` +
          `functions compile on the JavaScript target. Fail closed (D6).`
      );
    const collCode = compile(coll);
    if (init !== undefined && init !== null) {
      const seed = plan?.coerceSeed
        ? `_SYS.cplx(${compile(init)})`
        : compile(init);
      return `((_f, _l, _a) => _l.map((_x) => (_a = _f(_a, _x))))(${combiner}, ${collCode}, ${seed})`;
    }
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
    // All-integer arguments compare exactly, for the reason given in
    // `exactIntegerComparison`: integers are one apart or identical, so below
    // a tolerance of 1 the two tests accept the same pairs, and they agree on
    // `NaN` as well. The single-argument form compares against the integer 0.
    const exact = exactIntegerComparison(args, tol);
    if (args.length === 1)
      return exact
        ? `(${compile(args[0])} === 0 ? 1 : 0)`
        : `(Math.abs(${compile(args[0])}) <= ${tol} ? 1 : 0)`;
    const test = exact ? '_x === _v[0]' : `Math.abs(_x - _v[0]) <= ${tol}`;
    return `((..._v) => _v.every((_x) => ${test}) ? 1 : 0)(${args.map((a) => compile(a)).join(', ')})`;
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
  Identity: (args, compile, target) => {
    if (args[0] == null) throw new Error('Identity: missing argument');
    return identityPassthrough(args[0], compile, target);
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
  Norm: (args, compile, target) => {
    if (args[0] == null) throw new Error('Norm: missing argument');
    // A point with a broadcasting (non-tuple collection) component is one
    // point per element in the interpreter — `([1, 2], 3)` is `(1, 3)` and
    // `(2, 3)` — so its norm is one number per element, and the application
    // declares `list<number>`. `_SYS.norm` would flatten the point into a
    // single scalar, so the point is broadcast over its list components
    // instead: each list component is a source of `_SYS.bcast`, the point is
    // rebuilt inside the closure from the element parameters, and the other
    // components are bound once outside it so that an impure component draws
    // once (the interpreter's evaluate-once rule). Lists of different
    // lengths answer NaN from `_SYS.bcast`, the compiled spelling of the
    // interpreter's `incompatible-dimensions` error. Only a component that
    // provably holds NUMBERS is a source: a component that is a list of
    // points would make `_SYS.bcast` descend into each point, so that shape
    // fails closed (D6) and the interpreter answers.
    if (isUnwrittenPointWithCollectionComponent(args[0]))
      throw new Error(
        'Norm: cannot compile a point with a collection component that is ' +
          'not written out as a Tuple literal. Fail closed (D6).'
      );
    if (pointHasBroadcastComponent(args[0])) {
      if (
        args[1] != null &&
        isString(args[1]) &&
        args[1].string !== 'Frobenius'
      )
        throw new Error(
          `Norm: the "${args[1].string}" norm does not compile. ` +
            `Fail closed (D6).`
        );
      const point = args[0];
      if (!isFunction(point, 'Tuple'))
        throw new Error(
          'Norm: cannot compile a point with a broadcasting component. ' +
            'Fail closed (D6).'
        );
      const bound: string[] = [];
      const values: string[] = [];
      const bind = (code: string): string => {
        const v = BaseCompiler.tempVar(target);
        bound.push(v);
        values.push(code);
        return v;
      };
      const params: string[] = [];
      const sources: string[] = [];
      const components = point.ops.map((c) => {
        // The same component test as `pointHasBroadcastComponent`, with the
        // tuple exclusion read off the type: a nested point is one leg of
        // the norm, never a source (this module does not import
        // `collection-utils`, see `isNumericTupleParticipant` below).
        const ct = jsType(c);
        const isPoint =
          ct === 'tuple' || (typeof ct !== 'string' && ct.kind === 'tuple');
        const broadcasts =
          !isPoint &&
          (c.isCollection || c.type.matches('indexed_collection<any>'));
        if (!broadcasts) return bind(compile(c));
        if (!c.type.matches('indexed_collection<number>'))
          throw new Error(
            'Norm: cannot compile a point whose component is a collection ' +
              'of non-scalars. Fail closed (D6).'
          );
        const p = BaseCompiler.tempVar(target);
        params.push(p);
        sources.push(bind(compile(c)));
        return p;
      });
      const ord =
        args[1] != null && !isString(args[1])
          ? `, ${bind(compile(args[1]))}`
          : '';
      return (
        `((${bound.join(', ')}) => _SYS.bcast((${params.join(', ')}) => ` +
        `_SYS.norm([${components.join(', ')}]${ord}), ${sources.join(', ')}))` +
        `(${values.join(', ')})`
      );
    }
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
  // Integer matrix power (`M^0` identity, negative → inverse). A non-square
  // matrix yields NaN at run time; a non-integer exponent never reaches run
  // time (see the guard below).
  MatrixPower: (args, compile) => {
    if (args[0] == null || args[1] == null)
      throw new Error('MatrixPower: missing argument');
    // `_SYS.matpow` computes integer powers only, but the interpreter also
    // answers a HALF-integer power of an exact 2×2 positive-semidefinite
    // matrix through the principal matrix square root
    // (`library/linear-algebra.ts`). Emitting `_SYS.matpow(m, 0.5)` there
    // would return NaN behind `success: true` — a silently wrong value, not
    // a missing one.
    //
    // So the lowering is emitted only when the exponent is STATICALLY
    // PROVEN an integer: a literal integer, or an operand whose type is
    // `integer`. Anything else fails closed (D6) and the engine falls back
    // to interpretation. Proving it on the literal alone is not enough — a
    // `real`-typed symbol holding 0.5 at run time reaches `_SYS.matpow` and
    // returns NaN for a case the interpreter answers.
    const exponentIsInteger =
      (isNumber(args[1]) && args[1].isInteger === true) ||
      args[1].type.matches('integer');
    if (!exponentIsInteger)
      throw new Error(
        'MatrixPower: an exponent that is not statically an integer may be ' +
          'the principal matrix square root in the interpreter, which ' +
          '`_SYS.matpow` does not compute. Fail closed (D6).'
      );
    // A literal exponent past the cap stays symbolic in the interpreter, so
    // it fails closed here; a run-time exponent past it answers NaN in
    // `_SYS.matpow`.
    const pConst = tryGetConstant(args[1]);
    if (pConst !== undefined && Math.abs(pConst) > MAX_MATRIX_POWER_EXPONENT)
      throw new Error(
        `MatrixPower: an exponent past ${MAX_MATRIX_POWER_EXPONENT} stays ` +
          'symbolic in the interpreter. Fail closed (D6).'
      );
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
    // Complex either because an operand is, or because the RESULT is complex —
    // from a PROVABLY negative argument (`Log(-2)`, or `a := -2` making
    // `Log(a)` `complex`), or from an unknown-sign argument under the
    // caller's `complexPromotion` opt-in. Either way the enclosing expression
    // reads `{re, im}`, so `Math.log10` — a `NaN` number — must not be the
    // lowering. Without the opt-in an unknown-sign operand keeps the real
    // kernel (pinned; `promotesToComplexLane` mirrors the `isComplexValued`
    // Sqrt/Ln/Log carve-out, which makes the parent agree on the shape).
    //
    // ONE KERNEL PER BASE. Base 10 (the one-argument form) and base 2 have
    // a dedicated, correctly rounded kernel on this target — `Math.log10`,
    // `Math.log2` — and the interpreter folds a constant argument through
    // the same kernel. Spelling a RUNTIME `Log(x)` as `ln(x) / ln(10)`
    // instead put the two paths one ulp apart: `log(x) / log(2)` at `x = 4`
    // ran to `1.9999999999999996` while the fold of `log(2)` was exact, so a
    // Desmos "power of two" selector (`log(i)/log(2) mod 1 = 0`) kept only
    // `i = 1` (Tycho item 240). The complex lane goes through `_SYS.clog10`
    // / `_SYS.clog2`, whose real part is the same kernel applied to the
    // modulus, so the two lanes agree on the real axis as well. Any other
    // base keeps the `ln(x) / ln(b)` quotient, which is also how the
    // interpreter folds it at machine precision.
    const base = BaseCompiler.fixedLogBase(args);
    if (
      args.some((a) => BaseCompiler.isComplexValued(a)) ||
      promotesToComplexLane('Log', args)
    ) {
      // Recorded for the `promoted` report when the operand is complex only
      // by wideness (a no-op otherwise; the lowering below is the same).
      BaseCompiler.recordPromotion('Log', args);
      if (base !== undefined)
        return `_SYS.clog${base}(${complexOperandCode(args[0], compile)})`;
      const n = BaseCompiler.tempVar(target);
      const num = `const ${n} = _SYS.cln(${complexOperandCode(args[0], compile)});`;
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
    if (base !== undefined) return `Math.log${base}(${compile(args[0])})`;
    return `(Math.log(${compile(args[0])}) / Math.log(${compile(args[1])}))`;
  },
  GammaLn: '_SYS.lngamma',
  Lb: 'Math.log2',
  // Element-wise binary max/min and clamp. These are the scalar codegen; a
  // collection operand is handled by `tryCompileBroadcast` (they are
  // `broadcastable`), which wraps this body in `_SYS.bcast`.
  ElementMax: (args, compile) => `Math.max(${args.map(compile).join(', ')})`,
  ElementMin: (args, compile) => `Math.min(${args.map(compile).join(', ')})`,
  Clamp: (args, compile) =>
    `Math.min(Math.max(${compile(args[0])}, ${compile(args[1])}), ${compile(
      args[2]
    )})`,
  Max: (args, compile) => compileExtremum('Max', args, compile),
  Mean: (args, compile) => {
    if (args.length === 0) return 'NaN';
    if (args.length === 1) return `_SYS.mean(${compile(args[0])})`;
    return `_SYS.mean([${args.map(compile).join(', ')}])`;
  },
  Median: (args, compile) => {
    if (args.length === 0) return 'NaN';
    if (args.length === 1) return `_SYS.median(${compile(args[0])})`;
    return `_SYS.median([${args.map(compile).join(', ')}])`;
  },
  Variance: (args, compile) => {
    if (args.length === 0) return 'NaN';
    if (args.length === 1) return `_SYS.variance(${compile(args[0])})`;
    return `_SYS.variance([${args.map(compile).join(', ')}])`;
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
    return `_SYS.kurtosis([${args.map(compile).join(', ')}])`;
  },
  Skewness: (args, compile) => {
    if (args.length === 0) return 'NaN';
    if (args.length === 1) return `_SYS.skewness(${compile(args[0])})`;
    return `_SYS.skewness([${args.map(compile).join(', ')}])`;
  },
  Mode: (args, compile) => {
    if (args.length === 0) return 'NaN';
    if (args.length === 1) return `_SYS.mode(${compile(args[0])})`;
    return `_SYS.mode([${args.map(compile).join(', ')}])`;
  },
  Quartiles: (args, compile) => {
    if (args.length === 0) return 'NaN';
    if (args.length === 1) return `_SYS.quartiles(${compile(args[0])})`;
    return `_SYS.quartiles([${args.map(compile).join(', ')}])`;
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
      // A base complex only by WIDENESS with a non-integer exponent is a
      // promotion for the `promoted` report (see `promotesRadicalToComplex`).
      BaseCompiler.recordPromotion('Power', args);
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
      // typed `complex`, so it folds to the principal complex value; an
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
    // …or PROMOTED (the `auto`/`complex` disciplines): an unknown-sign base
    // with a provably non-integer exponent takes the complex kernel too,
    // agreeing with `isComplexValued`'s report to the parent
    // (`promotesRadicalToComplex`).
    if (
      resultIsComplexValued('Power', args) ||
      promotesToComplexLane('Power', args)
    )
      return `_SYS.cpow(${complexOperandCode(base, compile)}, ${complexOperandCode(exp, compile)})`;
    if (eConst === 0) return '1';
    if (eConst === 1) return compile(base);
    const radical = realRadicalPower(base, eConst, compile, target);
    if (radical !== undefined) return radical;
    if (
      eConst === 2 &&
      (isSymbol(base) || isNumber(base)) &&
      !(isSymbol(base) && target.varsKeys?.has(base.symbol))
    ) {
      const code = compile(base);
      return `(${code} * ${code})`;
    }
    if (isSymbol(base, 'ExponentialE') && compile(base) === 'Math.E')
      return `Math.exp(${compile(exp)})`;
    if (
      eConst !== undefined &&
      eConst >= 2 &&
      eConst <= 5 &&
      Number.isInteger(eConst)
    )
      return `_SYS.pow${eConst}(${compile(base)})`;
    if (eConst === -1) return `(1 / (${compile(base)}))`;
    if (
      eConst === -2 &&
      (isSymbol(base) || isNumber(base)) &&
      !(isSymbol(base) && target.varsKeys?.has(base.symbol))
    ) {
      // A reciprocal square is two divisions — much cheaper than the
      // transcendental `Math.pow`, and the same value on every base. The
      // divisions must be SEPARATE: `1 / (t * t)` squares first, and the
      // square overflows to `Infinity` for a base above about 1.3e154, where
      // the reciprocal is then 0 instead of the subnormal `Math.pow`
      // returns (at `t = 1e155` the true value is 1e-310). Dividing twice
      // scales down between the two steps and keeps that value. The two
      // spellings also agree on the poles: a base of 0 or -0 gives
      // `Infinity` both ways, and a base small enough to overflow the
      // reciprocal gives `Infinity` both ways.
      //
      // Only a SYMBOL or a NUMBER may be spliced twice: any other base is a
      // sub-expression whose code would be duplicated, and a `vars`-mapped
      // symbol may itself expand to arbitrary target source. Those keep the
      // `Math.pow(base, -2)` emission of the general branch below, which
      // splices the base once. Same guard as the `Power(x, 2)` expansion
      // above.
      const code = compile(base);
      return `(1 / ${code} / ${code})`;
    }
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
    // A non-finite bound never materializes to an array. An infinite range
    // compiles only as a
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
    // A bound that is provably not a number — a collection, a string, a
    // boolean — has no range: the interpreter leaves `Range(Range(1, 10),
    // 2)` (the chained `1..10..2` spelling) inert, while the arithmetic
    // below would coerce the array to NaN and emit an EMPTY range behind
    // `success: true`. Fail closed instead, on every operand count. A bound
    // of unknown type stays a run-time matter, as before.
    for (const a of args) {
      const t = compilationType(a);
      if (!couldMatch(t, 'number'))
        throw new Error(
          `Range: the bound \`${a.toString()}\` is a \`${typeToString(t)}\`, not a number, so the range never materializes. Fail closed (D6).`
        );
    }
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
      // `Number`, NOT `parseFloat`. Both reject a purely symbolic bound, but
      // `parseFloat` reads a LEADING NUMERIC PREFIX and ignores the rest, so
      // it accepts a symbolic bound whose compiled form merely STARTS with a
      // number and reports that prefix as the bound. `Length(L)/3` compiles
      // to `0.3333333333333333 * (_.L).length`, which `parseFloat` read as
      // 0.333: against a start of 1 that computed a DESCENDING range of
      // length `floor(|0.333 - 1|) + 1 = 1`, so the range was emitted as the
      // single-element literal `[1]` and the rest of it silently vanished —
      // a wrong VALUE behind `success: true` (Tycho item 187; their witness
      // was `[… for i = (1..(Length(L)/3))-1]` yielding one element). `Number`
      // requires the WHOLE string to be numeric, so any expression falls
      // through to the runtime-length branch below, which is correct for both
      // symbolic and computed bounds.
      //
      // Only a bound the compiler emitted as a bare literal is constant-folded
      // here; everything else defers its length to run time.
      const fStop = Number(stop);
      const fStart = Number(start);
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
        // `number`. An EVEN degree is the complex branch: as of the
        // 2026-07-30 ruling the node is typed `complex`, so it folds to
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
  // `docs/RANDOMNESS-MODEL.md` §4/§7.
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
  //
  // A STRING domain is segmented into its characters, sampled and re-joined: a
  // sample drawn from a string's own characters is a string (the
  // string-preservation rule, promoted in Phase 2 alongside `RandomShuffle` —
  // `docs/STRING_ROADMAP.md` item 8). The
  // domain descriptor is built here rather than by `randomDomain`, whose
  // `collArg` funnel is shared with `Random`/`RandomChoice` and refuses a
  // string on purpose.
  RandomSample: (args, compile) => {
    if (args.length !== 2)
      throw new Error(
        `RandomSample: expected exactly two arguments. Fail closed (D6).`
      );
    if (args[0] !== undefined && isProvablyStringOperand(args[0]))
      return joinIfString(
        args[0],
        `_SYS.randomSample(_SYS.domainList("RandomSample", ` +
          `_SYS.chars(${compile(args[0])})), ${compile(args[1])})`
      );
    const domain = randomDomain('RandomSample', args[0], compile, false);
    return `_SYS.randomSample(${domain}, ${compile(args[1])})`;
  },
  Round: (args, compile, target) => {
    // The interpreter rounds half away from zero (Round(-2.5) = -3); JS
    // `Math.round` rounds half toward +∞ (Round(-2.5) = -2). Reconstruct
    // half-away as `sign(x)·round(|x|)`.
    if (args.length < 2) {
      if (BaseCompiler.isIntegerValued(args[0]))
        return identityPassthrough(args[0], compile, target);
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
  Square: (args, compile, target) => {
    const arg = args[0];
    if (arg === null) throw new Error('Square: no argument');
    const c = tryGetConstant(arg);
    if (c !== undefined) return String(c * c);
    if (isSymbol(arg) && !target.varsKeys?.has(arg.symbol)) {
      const code = compile(arg);
      return `(${code} * ${code})`;
    }
    return `_SYS.pow2(${compile(arg)})`;
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
  /** A string source is segmented first — see `First`. */
  Second: (args, compile) =>
    isProvablyStringOperand(args[0])
      ? `_SYS.chars(${compile(args[0])})[1]`
      : `${compile(args[0])}[1]`,
  Heaviside: '_SYS.heaviside',
  // A complex operand takes the complex sign `z/|z|` (`_SYS.csign`), the
  // interpreter's reading off the real line; a real one keeps `Math.sign`.
  Sign: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_SYS.csign(${compile(args[0])})`;
    return `Math.sign(${compile(args[0])})`;
  },
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
    if (BaseCompiler.isComplexValued(args[0])) {
      // The operand may be complex only by WIDENESS (the complex discipline
      // lifted it): that is a promotion for the `promoted` report, and the
      // predicate below records it (its lowering is the same kernel).
      BaseCompiler.recordPromotion('Sqrt', args);
      return `_SYS.csqrt(${compile(args[0])})`;
    }
    const c = tryGetConstant(args[0]);
    if (c !== undefined) {
      const r = Math.sqrt(c);
      // A negative constant has no real square root. `Sqrt(negative)` is typed
      // `complex`, so fold to the complex principal value the interpreter
      // returns (`√-2` → `1.414…i`) rather than decline. See
      // `NO_REAL_VALUE_FOLD`.
      if (Number.isNaN(r)) return complexSqrtLiteral(c);
      return String(r);
    }
    // The operand is real-emitted but the result is complex — because the
    // operand is PROVABLY negative (`a := -2` → `Sqrt(a)` is `complex`),
    // or because the caller opted in to promoting an unknown-sign operand
    // (`complexPromotion`). The enclosing expression reads `{re, im}` off this
    // node, so `Math.sqrt` — which yields a `NaN` *number* there — would
    // NaN-poison it. Without the opt-in an unknown-sign operand keeps
    // `Math.sqrt` (pinned; `promotesToComplexLane` mirrors the
    // `isComplexValued` Sqrt/Ln/Log carve-out so the parent agrees).
    if (promotesToComplexLane('Sqrt', args))
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
  /** A string source is segmented first — see `First`. */
  Third: (args, compile) =>
    isProvablyStringOperand(args[0])
      ? `_SYS.chars(${compile(args[0])})[2]`
      : `${compile(args[0])}[2]`,
  PointX: (args, compile, target) =>
    compilePointComponent(args[0], 0, compile, target),
  PointY: (args, compile, target) =>
    compilePointComponent(args[0], 1, compile, target),
  PointZ: (args, compile, target) =>
    compilePointComponent(args[0], 2, compile, target),
  // Reached only when the `PointList` definition handler declines — i.e. for
  // every shape but the all-scalar plain point (which it lowers itself,
  // byte-identically to `Tuple`). See `compileJSPointList`.
  PointList: (args, compile, target) =>
    compileJSPointList(args, compile, target),
  Mod: ([a, b], compile, target) => {
    if (a === null || b === null) throw new Error('Mod: missing argument');
    // For non-negative integers, plain `%` is correct Euclidean modulo, and it
    // splices each operand once. Every other pair needs the floored-modulo
    // template, which splices the DIVISOR three times.
    const fastPath =
      BaseCompiler.isIntegerValued(a) &&
      BaseCompiler.isIntegerValued(b) &&
      BaseCompiler.isNonNegative(a);
    // An IMPURE operand (the Random family) must be evaluated exactly once:
    // a spliced draw re-draws at run time (`Mod(x, Random())` consumed three
    // draws).
    const impure = a.isPure === false || b.isPure === false;
    // Dividing by one leaves the fractional part of the dividend under the
    // floored convention, and `a - Math.floor(a)` computes it in two
    // operations instead of the template's three.
    //
    // That subtraction can round UP to exactly `1` for a tiny negative
    // dividend — no double holds `1 - 1e-20`, so `-1e-20 - Math.floor(-1e-20)`
    // is `1` — which is outside the floored modulo's codomain `[0, 1)`. A
    // palette index such as `Floor(Mod(x, 1) · n)` then reads one element past
    // the end. The trailing `% 1` maps that rounded `1` back to `0` and is
    // exact everywhere else on `[0, 1)`, where it returns its operand
    // unchanged; `NaN` and the infinities still give `NaN`.
    //
    // The dividend is spliced twice by the inline form, so that form is used
    // only when repeating it is free: a number literal, or a symbol the
    // caller did NOT re-map through `vars` (a re-mapped name splices
    // caller-supplied source — `_.draw()`, say — which must run exactly
    // once). Any other dividend — a call, an arithmetic sub-expression, an
    // impure operand — goes through the `_SYS.fract` helper, which computes
    // the same `((x - Math.floor(x)) % 1)` on its one argument. A temporary
    // bound in an immediately invoked function was the alternative, but that
    // allocates a closure per evaluation at every such site (the Tycho
    // corpus has about a thousand of them, nearly all with a call as the
    // dividend), where the helper call is a plain call the engine inlines.
    if (!fastPath && isNumber(b) && b.re === 1 && b.im === 0) {
      const spliceableDividend =
        isNumber(a) || (isSymbol(a) && !target.varsKeys?.has(a.symbol));
      if (impure || !spliceableDividend) return `_SYS.fract(${compile(a)})`;
      const ca = compile(a);
      return `((${ca} - Math.floor(${ca})) % 1)`;
    }
    // A divisor the floored template splices three times is also COMPUTED
    // three times when it is spliced directly. A symbol reference and a
    // number literal cost nothing to repeat; anything else — a call such as
    // `Mod(2, Sin(0.2·theta))`, an arithmetic sub-expression — is bound to a
    // temporary so the emitted code evaluates it once. The Tycho
    // code-generation audit of 2026-09-08 found the three-times shape in the
    // emitted JavaScript of a plotted curve.
    const repeatedDivisor =
      !fastPath && !isSymbol(b) && !isNumber(b) && !impure;
    const bind = impure || repeatedDivisor;
    // The dividend is spliced once by both templates, so it needs a temporary
    // only to keep the interpreter's a-then-b evaluation order. That order is
    // at risk as soon as EITHER operand is impure: the divisor is then bound
    // to a temporary, and the binding runs it before the spliced dividend.
    // Binding the dividend as well puts the two back in order.
    const bindA = impure;
    const ta = bindA ? BaseCompiler.tempVar(target) : '';
    const tb = bind ? BaseCompiler.tempVar(target) : '';
    // `compile()` emits sub-expressions without outer parentheses (`x + 29`),
    // and `%` binds tighter than `+` — wrap before splicing next to `%`.
    const ca = bindA ? ta : `(${compile(a)})`;
    const cb = bind ? tb : `(${compile(b)})`;
    const core = fastPath
      ? `(${ca} % ${cb})`
      : `(((${ca} % ${cb}) + ${cb}) % ${cb})`;
    if (!bind) return core;
    const bindings = [
      ...(bindA ? [`${ta} = ${compile(a)}`] : []),
      `${tb} = ${compile(b)}`,
    ];
    return boundJSResult(target, `const ${bindings.join(', ')};`, core);
  },
  Truncate: (args, compile, target) => {
    if (BaseCompiler.isIntegerValued(args[0]))
      return identityPassthrough(args[0], compile, target);
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
  Multiply: (args, compile, target) => {
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

    const boundResult = (bindings: string, value: string): string =>
      boundJSResult(target, bindings, value);

    if (args.length === 2) {
      const ac = BaseCompiler.isComplexValued(args[0]);
      const bc = BaseCompiler.isComplexValued(args[1]);
      const ca = compile(args[0]);
      const cb = compile(args[1]);

      if (ac && bc) {
        return boundResult(
          `const _a = ${ca}, _b = ${cb};`,
          '{ re: _a.re * _b.re - _a.im * _b.im, im: _a.re * _b.im + _a.im * _b.re }'
        );
      }
      if (ac && !bc) {
        return boundResult(
          `const _a = ${ca}, _r = ${cb};`,
          '{ re: _a.re * _r, im: _a.im * _r }'
        );
      }
      // !ac && bc
      return boundResult(
        `const _r = ${ca}, _b = ${cb};`,
        '{ re: _r * _b.re, im: _r * _b.im }'
      );
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
      if (!tIsComplex) {
        // A REAL factor scales the two components. The full complex step below
        // would instead emit four multiplications and two temporaries per
        // factor to compute an imaginary half that is known to be zero — the
        // shape a plotted expression with one promoted radical and several
        // real factors per term has.
        //
        // The accumulation stays SEQUENTIAL and in argument order, so the
        // ROUNDING ORDER is preserved: each factor multiplies the running
        // product, exactly as the interpreter's left-to-right product does.
        // Collecting the real factors into one product first and scaling by it
        // once would re-associate that arithmetic — for `z · a · b` with
        // `z = {re: 1e-200, im: 1e-200}` and `a = b = 1e200`, `a * b`
        // overflows to infinity while the stepwise product stays finite.
        parts.push(`_re = _re * ${t}`);
        parts.push(`_im = _im * ${t}`);
        continue;
      }
      parts.push(`const _nre${i} = _re * ${t}.re - _im * ${t}.im`);
      parts.push(`const _nim${i} = _re * ${t}.im + _im * ${t}.re`);
      parts.push(`_re = _nre${i}`);
      parts.push(`_im = _nim${i}`);
    }

    return boundResult(`${parts.join('; ')};`, '{ re: _re, im: _im }');
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
  // A point operand is one leg of the hypotenuse, not a pair of legs: it
  // enters the sum of squares through its own norm, so `Hypot((3, 4), 1)` is
  // √(‖(3,4)‖² + 1²) = √26. That is what the interpreter computes — its
  // `Hypot` handler builds `Square(Norm(point))` (`library/trigonometry.ts`)
  // — and passing the point's norm as a leg reproduces it, because
  // `Math.hypot(‖p‖, y)` is √(‖p‖² + y²).
  //
  // The norm is computed by `_SYS.norm` rather than by splicing the point's
  // components into the call, for two reasons: it also serves an operand
  // typed as a point without being a literal one, and it already treats an
  // infinite component as dominating a NaN one. `Math.hypot` treats the
  // remaining legs the same way, so the two agree — `Hypot((+∞, NaN), 5)` is
  // `+∞` and `Hypot((NaN, 3), 5)` is NaN.
  //
  // A point reaches this handler only when no leg broadcasts:
  // `BaseCompiler.tryCompileBroadcast` leaves a point beside scalar legs
  // alone, and rewrites the point to its `Norm` when a list leg or a list
  // component is present, so that the norms broadcast like any list operand.
  // Under a broadcast this handler is invoked on the closure's element
  // parameters instead, which are plain numbers, and it produces an ordinary
  // `Math.hypot(...)` call.
  Hypot: (args, compile) => {
    const leg = (a: Expression): string => {
      const t = jsType(a);
      const code = compile(a);
      if (typeof t === 'string' || t.kind !== 'tuple') return code;
      // A point whose component is itself a collection produces one point per
      // element at evaluation, and therefore one hypotenuse per element. The
      // call below computes a single number, which would disagree with both
      // the interpreter and the `list<number>` type this application declares.
      // Refuse to compile it, exactly as `Norm` refuses the same operand, so
      // the engine falls back to interpretation. Compiling it needs the nested
      // broadcast that keeps a point atomic, which `Add` and `Multiply` use
      // for a point summed with a list of points.
      if (
        pointHasBroadcastComponent(a) ||
        isUnwrittenPointWithCollectionComponent(a)
      )
        throw new Error(
          'Hypot: cannot compile a point with a broadcasting component. ' +
            'Fail closed (D6).'
        );
      return `_SYS.norm(${code})`;
    };
    return `Math.hypot(${args.map(leg).join(', ')})`;
  },
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
  // `Real`, `Imaginary` and `Argument` each read one scalar off a complex
  // value. When the value is a sum of a real part and an imaginary part, that
  // scalar is one of the two parts (or `Math.atan2` of them), so the
  // `{ re, im }` object is never built. See `tryGetJSComplexParts`.
  Real: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0])) {
      const parts = tryGetJSComplexParts(args[0], compile);
      if (parts !== undefined) return parts.re;
      return `(${compile(args[0])}).re`;
    }
    return identityPassthrough(args[0], compile, target);
  },
  Imaginary: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0])) {
      const parts = tryGetJSComplexParts(args[0], compile);
      if (parts !== undefined) return parts.im;
      return `(${compile(args[0])}).im`;
    }
    return '0';
  },
  Argument: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0])) {
      // `_SYS.carg` is `Math.atan2(im, re)` — the argument order is
      // imaginary part first, as in every `atan2`.
      const parts = tryGetJSComplexParts(args[0], compile);
      if (parts !== undefined) return `Math.atan2(${parts.im}, ${parts.re})`;
      return `_SYS.carg(${compile(args[0])})`;
    }
    return `(${compile(args[0])} >= 0 ? 0 : Math.PI)`;
  },
  Conjugate: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_SYS.cconj(${compile(args[0])})`;
    return identityPassthrough(args[0], compile, target);
  },

  // Color functions
  Color: ([color], compile) => {
    if (color === null) throw new Error('Color: no argument');
    return `_SYS.color(${compile(color)})`;
  },
  ColorToString: (args, compile) => {
    if (args.length === 0) throw new Error('ColorToString: no argument');
    const c = compileColorOperand('ColorToString', args[0], compile);
    if (args.length >= 2)
      return `_SYS.colorToString(${c}, ${compile(args[1])})`;
    return `_SYS.colorToString(${c})`;
  },
  ColorMix: (args, compile) => {
    if (args.length < 2) throw new Error('ColorMix: need two colors');
    const c1 = compileColorOperand('ColorMix', args[0], compile);
    const c2 = compileColorOperand('ColorMix', args[1], compile);
    if (args.length >= 3)
      return `_SYS.colorMix(${c1}, ${c2}, ${compile(args[2])})`;
    return `_SYS.colorMix(${c1}, ${c2})`;
  },
  ColorContrast: ([bg, fg], compile) => {
    if (bg === null || fg === null)
      throw new Error('ColorContrast: need two colors');
    return `_SYS.colorContrast(${compileColorOperand(
      'ColorContrast',
      bg,
      compile
    )}, ${compileColorOperand('ColorContrast', fg, compile)})`;
  },
  ContrastingColor: (args, compile) => {
    if (args.length === 0) throw new Error('ContrastingColor: no argument');
    const bg = compileColorOperand('ContrastingColor', args[0], compile);
    if (args.length >= 3)
      return `_SYS.contrastingColor(${bg}, ${compileColorOperand(
        'ContrastingColor',
        args[1],
        compile
      )}, ${compileColorOperand('ContrastingColor', args[2], compile)})`;
    return `_SYS.contrastingColor(${bg})`;
  },
  ColorToColorspace: ([color, space], compile) => {
    if (color === null || space === null)
      throw new Error('ColorToColorspace: need color and space');
    return `_SYS.colorToColorspace(${compileColorEntryOperand(
      'ColorToColorspace',
      color,
      compile
    )}, ${compile(space)})`;
  },
  ColorFromColorspace: ([components, space], compile) => {
    if (components === null || space === null)
      throw new Error('ColorFromColorspace: need components and space');
    return `_SYS.colorFromColorspace(${compileColorComponents(
      components,
      compile
    )}, ${compile(space)})`;
  },
  Colormap: (args, compile) => {
    if (args.length === 0) throw new Error('Colormap: no argument');
    if (args.length >= 2) {
      // A literal sample count past the cap stays symbolic in the
      // interpreter, so it fails closed here; a run-time count past it
      // answers NaN in `_SYS.colormap`.
      const nConst = tryGetConstant(args[1]);
      if (nConst !== undefined && nConst > MAX_COLORMAP_SAMPLES)
        throw new Error(
          `Colormap: a sample count past ${MAX_COLORMAP_SAMPLES} stays ` +
            'symbolic in the interpreter. Fail closed (D6).'
        );
      return `_SYS.colormap(${compile(args[0])}, ${compile(args[1])})`;
    }
    return `_SYS.colormap(${compile(args[0])})`;
  },

  // -----------------------------------------------------------------------
  // Color constructor heads. All compile to a color VALUE in the canonical
  // OKLCh space — the object `{ space, c0, c1, c2, alpha }`. The constructors
  // take their own colorspace's components and convert internally.
  // (The GPU target keeps the same canonical space in a bare `vec3`.)
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
  // As* converters. Each answers a color VALUE tagged with the space it
  // names, so a conversion result reaching a second color operator is
  // understood rather than misread as OKLCh. `AsRgb` uses 0-1 sRGB channels
  // (consistent across all layers). `AsOklch` is the identity for an operand
  // the compiler can see is already canonical.
  // -----------------------------------------------------------------------
  // Each converter is `broadcastable`, so an operand that may be a LIST of
  // colors at run time takes the color-aware map instead of the direct call
  // (`tryCompileColorBroadcast`). The base compiler's list gates stand aside
  // for these five heads and leave the shape to them — see
  // `CompileTarget.collectionAwareHeads`.
  AsRgb: ([c], compile, target) => {
    if (c === null) throw new Error('AsRgb: no argument');
    const list = tryCompileColorBroadcast(
      'AsRgb',
      c,
      (t) => `_SYS.asRgb(${t})`,
      compile,
      target
    );
    return (
      list ?? `_SYS.asRgb(${compileColorEntryOperand('AsRgb', c, compile)})`
    );
  },
  AsHsv: ([c], compile, target) => {
    if (c === null) throw new Error('AsHsv: no argument');
    const list = tryCompileColorBroadcast(
      'AsHsv',
      c,
      (t) => `_SYS.asHsv(${t})`,
      compile,
      target
    );
    return (
      list ?? `_SYS.asHsv(${compileColorEntryOperand('AsHsv', c, compile)})`
    );
  },
  AsHsl: ([c], compile, target) => {
    if (c === null) throw new Error('AsHsl: no argument');
    const list = tryCompileColorBroadcast(
      'AsHsl',
      c,
      (t) => `_SYS.asHsl(${t})`,
      compile,
      target
    );
    return (
      list ?? `_SYS.asHsl(${compileColorEntryOperand('AsHsl', c, compile)})`
    );
  },
  AsOklab: ([c], compile, target) => {
    if (c === null) throw new Error('AsOklab: no argument');
    const list = tryCompileColorBroadcast(
      'AsOklab',
      c,
      (t) => `_SYS.asOklab(${t})`,
      compile,
      target
    );
    return (
      list ?? `_SYS.asOklab(${compileColorEntryOperand('AsOklab', c, compile)})`
    );
  },
  AsOklch: ([c], compile, target) => {
    if (c === null) throw new Error('AsOklch: no argument');
    // The element of a color list goes through `_SYS.asOklch` rather than
    // through the identity below: an element may be a color STRING, and the
    // identity would hand that string back where the interpreter answers an
    // OKLCh color value.
    const list = tryCompileColorBroadcast(
      'AsOklch',
      c,
      (t) => `_SYS.asOklch(${t})`,
      compile,
      target
    );
    if (list !== undefined) return list;
    // A provably STRING operand is a CSS color spelling, not a color value,
    // so the identity below would answer the string itself where the
    // interpreter answers the OKLCh color it names — measured on a
    // `string`-declared symbol, which emitted the bare `_.s`.
    if (c.type.matches('string')) return `_SYS.asOklch(${compile(c)})`;
    // The identity holds only for an operand the compiler can SEE is both a
    // color VALUE and already in the canonical space. A conversion
    // (`AsRgb(c)`) answers a color tagged with its own space, and a symbol or
    // a `vars` input may hold one at run time, so those go through the
    // converter, which reads the tag. `ColorToColorspace(c, "oklch")` has the
    // canonical space but answers bare COMPONENTS, which the identity would
    // hand on as though they were a color. A literal tuple is sRGB components
    // and is converted by `compileColorOperand`, whose `_SYS.rgb(…)` value is
    // canonical.
    const operand = compileColorEntryOperand('AsOklch', c, compile);
    const canonical =
      isFunction(c, 'Tuple') ||
      (colorSpaceOf(c) === 'oklch' && isColorValued(c));
    if (!canonical) return `_SYS.asOklch(${operand})`;
    // The identity case hands the parent the OPERAND's own code, which may be
    // an infix expression, so it is parenthesized like every other identity
    // lowering (`identityPassthrough`).
    return parenthesizeIdentity(c, operand, target);
  },

  // Perceptual color difference (ΔE_OK).
  ColorDelta: ([a, b], compile) => {
    if (a === null || b === null)
      throw new Error('ColorDelta: need two colors');
    return `_SYS.colorDelta(${compileColorOperand(
      'ColorDelta',
      a,
      compile
    )}, ${compileColorOperand('ColorDelta', b, compile)})`;
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

/**
 * Convert a Complex instance produced by a TRANSCENDENTAL kernel (`csqrt`,
 * `cexp`, `casin`, …) to a plain `{re, im}` object, chopping each component
 * at the kernel-roundoff scale (`ROUNDOFF_TOLERANCE`, 1e-14) — exactly the
 * chop `apply.ts` applies to the interpreter's complex results, and for the
 * same reason: `Complex(0.5, 0).asin()` returns `im: 5.55e-17`, dust from
 * the complex log/sqrt formulation, and `Exp(Ln(-2))` leaves `im =
 * 2.449e-16`. The dust is removed WHERE IT IS CREATED so that the runner's
 * result convention can test `im !== 0` EXACTLY (a value whose imaginary
 * part is exactly zero comes back as a plain `number`) without chopping at
 * the boundary — ARCHITECTURE.md's rule is never to chop in ring arithmetic
 * or constructors (`1 + 1e-12i` is a legitimate value and stays one), and
 * the ring helpers (`cplx`, the emitted `cadd`/`cmul` closures, `cneg`,
 * `cconj`) do not go through this function.
 */
function toRI(c: Complex): { re: number; im: number } {
  return {
    re: chop(c.re, ROUNDOFF_TOLERANCE),
    im: chop(c.im, ROUNDOFF_TOLERANCE),
  };
}

/**
 * `|z|`. A purely real `z` reads `Math.abs` rather than `Math.hypot(x, 0)`,
 * which is not guaranteed to return `|x|` to the last bit — and the base-10
 * and base-2 complex logarithms (`_SYS.clog10`, `_SYS.clog2`) need the exact
 * real argument so that their real-axis value matches the real lane's.
 */
function complexModulus(z: ComplexResult): number {
  return z.im === 0 ? Math.abs(z.re) : Math.hypot(z.re, z.im);
}

/**
 * Folding a constant that has no real value (`√-2`, `(-2)^0.3`).
 *
 * Such a constant is folded rather than refused. Failing closed prevents
 * silently wrong output; it does not prohibit a non-real
 * one. `NaN` is the correct, self-describing answer for "no real value", it
 * is what every sibling head already returns (`Ln(-2)` → `Math.log(-2)`,
 * `Arcsin(2)` → `Math.asin(2)`), and it is what the SAME expression returns
 * when the operand is a variable (`Sqrt(x)` at `x = -2`, `Sqrt(a)` with
 * `a ⩴ -2`). Refusing only the provable-constant case bought no safety: the
 * runtime-variable case cannot be caught in principle, so the caller must
 * handle `NaN` either way.
 *
 * The node's type decides which value is folded:
 * `BaseCompiler.isComplexValued` — a type query — is what makes the enclosing
 * expression emit real (`a + b`) or complex (`{re, im}`) arithmetic, so the
 * emitted constant must agree with it.
 * - A canonical `Sqrt(negative)` is typed `complex`, so it folds to the
 *   complex principal value (`√-2` → `1.414…i`, matching the interpreter) —
 *   `complexSqrtLiteral` below.
 * - A `Power`/`Root` on the complex branch of a negative base — the exponent's
 *   reduced-rational denominator is even (`(−2)^0.3`), or the root degree is
 *   even (`Root(−8, 4)`) — is typed `complex`, so it folds to the
 *   principal complex value (`complexPowLiteral`). Returning a numeric `NaN`
 *   would violate the parent expression's `{re, im}` representation.
 * - A `Power`/`Root` on the real branch of a negative base — an odd
 *   reduced-rational denominator or root degree, where a real principal root
 *   exists (`(−8)^(2/3) = 4`, `Root(−8, 3) = −2`) — stays `number` and
 *   folds to that real value, which `Math.pow` alone misses. See
 *   `negativeBaseRealPow`.
 * - Only when the branch is unprovable (a float exponent with no faithful
 *   rational reconstruction) does a `Power`/`Root` fold to `NaN` — exactly what
 *   its own `Math.pow` lowering yields once the base is a runtime variable. A
 *   `{re, im}` object there would be consumed as a number by the enclosing real
 *   arithmetic (`1 + {…}` → `"1[object Object]"`).
 */
const NO_REAL_VALUE_FOLD = 'NaN';

/**
 * A `Power` whose exponent is a small rational with a root in it, lowered to
 * that root and an integer power instead of `Math.pow` — or `undefined` when
 * the node is not one of those shapes.
 *
 * `Math.pow` takes the logarithm of the base and exponentiates it back, so a
 * root it could have taken exactly is lost. Measured against the value the
 * engine computes at 60 digits, over bases from 1e-100 to 1e150:
 *
 * - `a^(3/2)`: `a * Math.sqrt(a)` stays within 0.82 ulp, `Math.pow(a, 1.5)`
 *   reaches 0.93 ulp, and cubing the square root — the shape `(√a)³` emitted
 *   before this — reaches 1.64 ulp.
 * - `x^(2/3)`: squaring the cube root stays within 1.49 ulp while
 *   `Math.pow(Math.abs(x), 2/3)` reaches 77 ulp at a base of 1e200.
 *
 * The cube root is SQUARED rather than taken of the square: `Math.cbrt(x * x)`
 * is the more accurate of the two in the ordinary range, but `x * x` overflows
 * to infinity for `|x|` above about 1.3e154, where the true value is only
 * about 1e103 — a silently wrong answer this must not introduce.
 *
 * A square-root base is read through, so `(√u)^k` is treated as `u^(k/2)`: the
 * radicand is the value to take the integer power of.
 *
 * Two conditions restrict the square-root routes. The base must be provably
 * non-negative, because `Math.sqrt` of a negative value is `NaN`. And where
 * the emitted form names the base twice it must be a symbol or a number
 * literal, so that repeating it costs nothing and cannot duplicate arbitrary
 * target source — the same guard the `Power(x, 2)` expansion uses. The cube
 * root needs neither: it names the base once and is defined for a negative
 * base, where it gives the real root the engine's own branch convention picks.
 *
 * Both look-throughs — dropping the `Abs` and reading the radicand out of a
 * `Sqrt` — rewrite the base on the strength of what those heads MEAN. That
 * holds only while they emit their built-in lowering: a caller who supplied an
 * implementation of `Abs` through `functions`/`operators` decides what
 * `Abs(x)` returns, so the identity "squaring removes the sign" is no longer
 * about that value. Such a head is compiled whole instead.
 */
function realRadicalPower(
  base: Expression,
  eConst: number | undefined,
  compile: (e: Expression) => string,
  target: CompileTarget<Expression>
): string | undefined {
  if (eConst === undefined) return undefined;
  // Squaring removes the sign, so an `Abs` under the two-thirds power is work
  // the cube root does not need.
  if (eConst === 2 / 3) {
    const inner =
      isFunction(base, 'Abs') &&
      base.ops.length === 1 &&
      base.ops[0].type.matches('real') &&
      !isCallerMapped(base, target.cse?.harvestOptions)
        ? base.ops[0]
        : base;
    return `_SYS.pow2(Math.cbrt(${compile(inner)}))`;
  }
  let radicand = base;
  let e = eConst;
  if (
    isFunction(base, 'Sqrt') &&
    base.ops.length === 1 &&
    Number.isInteger(e) &&
    e >= 2 &&
    !isCallerMapped(base, target.cse?.harvestOptions)
  ) {
    radicand = base.ops[0];
    e = e / 2;
  }
  if (e !== 1 && e !== 1.5 && e !== 2 && e !== 2.5) return undefined;
  if (radicand === base && Number.isInteger(e)) return undefined;
  if (!BaseCompiler.assumedRealNonNegative(radicand)) return undefined;
  if (e === 1) return compile(radicand);
  if (e === 2) return `_SYS.pow2(${compile(radicand)})`;
  const spliceable =
    isNumber(radicand) ||
    (isSymbol(radicand) && !target.varsKeys?.has(radicand.symbol));
  if (!spliceable) return undefined;
  const code = compile(radicand);
  return e === 1.5
    ? `(${code} * Math.sqrt(${code}))`
    : `(_SYS.pow2(${code}) * Math.sqrt(${code}))`;
}

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
 *
 * THREE SITES MUST STAY IN AGREEMENT, because they answer the same question
 * for the same node and a disagreement is a silent value-shape mismatch (a
 * `{re, im}`/`vec2` consumer reading a scalar, or the reverse):
 * `BaseCompiler.isComplexValued` (base-compiler.ts) is what a PARENT consults,
 * this function is the JavaScript emitters' copy, and
 * `gpuResultIsComplexValued` (gpu-target.ts) is the GPU emitters' copy. Change
 * one, change all three.
 */
function resultIsComplexValued(
  head: MathJsonSymbol,
  args: ReadonlyArray<Expression>
): boolean {
  const engine = args[0]?.engine;
  if (engine === undefined) return false;
  try {
    const t = engine.function(head, [...args], { form: 'structural' }).type;
    // The infinite branches are dropped first, exactly as the mirrored
    // branch of `isComplexValued` does: a head whose value can blow up
    // claims a union such as `complex | +oo | -oo`, and only its
    // finite part decides the lane.
    return isNonRealNumber(finitePartOfType(t.type));
  } catch {
    return false;
  }
}

/**
 * Whether a `Sqrt`/`Ln`/`Log` application takes the COMPLEX lane on account of
 * its result rather than its operands (an operand that is itself complex is
 * handled before this, by `isComplexValued`).
 *
 * Mirrors the `Sqrt`/`Ln`/`Log` branch of `BaseCompiler.isComplexValued`
 * exactly, and must keep doing so: that branch is what the ENCLOSING
 * expression consults to decide whether to read `{re, im}` off this node, and
 * a parent reading `{re, im}` around a child that emitted a bare number is
 * `NaN` everywhere. So both sides apply the same two conditions — a PROVABLY
 * negative operand always promotes, and an operand of merely UNKNOWN sign
 * promotes only when the caller opted in with `complexPromotion`.
 */
function promotesToComplexLane(
  head: MathJsonSymbol,
  args: ReadonlyArray<Expression>
): boolean {
  // The caller's opt-in, decided by the same predicate `isComplexValued` uses
  // — never by the node's type, which is the wide `number` for exactly
  // the unknown-sign operands the option targets.
  if (BaseCompiler.promotesRadicalToComplex(head, args)) return true;
  // The default: only a PROVABLY negative operand promotes, and only when the
  // result type confirms it.
  if (!args.some((a) => a?.isNegative === true)) return false;
  return resultIsComplexValued(head, args);
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

/** Are all three color channels finite numbers? The interpreter's
 * `readColorExpr` (`library/colors.ts`) admits a color only when they are. */
function finiteChannels(c0: number, c1: number, c2: number): boolean {
  return Number.isFinite(c0) && Number.isFinite(c1) && Number.isFinite(c2);
}

/**
 * Build a color value.
 *
 * The five keys are always written in this order, so every color on this
 * target shares one hidden class and a channel read from a mixed stream of
 * colors stays monomorphic. `alpha` is present and `undefined` for a color
 * that carries no alpha; it is never omitted.
 */
function mkColor(
  space: CompiledColorSpace,
  c0: number,
  c1: number,
  c2: number,
  alpha: number | undefined
): CompiledColor {
  return { space, c0, c1, c2, alpha };
}

/** The five color spaces a compiled color value can carry. */
const COMPILED_COLOR_SPACES: ReadonlySet<string> = new Set([
  'oklch',
  'rgb',
  'hsv',
  'hsl',
  'oklab',
]);

/**
 * Is `v` a color VALUE (not a color string, and not a list)?
 *
 * The `space` must be one of the five spellings, not merely a string: the
 * readers below switch on it, and an unrecognized spelling — `srgb` from a
 * `vars` input, say — would take the OKLCh arm and answer a plausible but
 * wrong color. An object with some other `space` is not a color at all and
 * `asCompiledColor` refuses it by name.
 */
function isCompiledColor(v: unknown): v is CompiledColor {
  return (
    typeof v === 'object' &&
    v !== null &&
    COMPILED_COLOR_SPACES.has((v as CompiledColor).space)
  );
}

/** The shape a color helper accepts, named in the `TypeError` it throws for
 * anything else. */
const COLOR_SHAPE =
  "a color value — an object `{ space, c0, c1, c2, alpha }` with `space` one of 'oklch', " +
  "'rgb', 'hsv', 'hsl', 'oklab' — or a CSS color string. A bare numeric array is a LIST, " +
  'not a color.';

/** The compiled value of a color with a non-finite channel: the `NaN`
 * channels, the numeric projection of the interpreter's `incompatible-type`
 * error, in the space the answering helper names and keeping the alpha slot
 * when one was given. */
function nonFiniteColor(
  alpha: number | undefined,
  space: CompiledColorSpace = 'oklch'
): CompiledColor {
  return mkColor(space, NaN, NaN, NaN, normalizeAlpha(alpha));
}

/**
 * Resolve any accepted color input to a color VALUE.
 *
 * A CSS color string is parsed to the canonical OKLCh form. A color value
 * passes through unchanged, whatever its space — this is the single point
 * where a consumer learns the space of the color it was handed.
 *
 * A NON-FINITE number is the absent-position sentinel of a broadcast
 * (`_SYS.bcastColor` maps a `NaN` element through the same conversion as a
 * color), and it answers the non-finite color, which is what the
 * interpreter's per-position `incompatible-type` error projects to on this
 * target.
 *
 * Anything else throws. A bare numeric array reaches here from a `vars` input
 * or from a consumer that still passes the pre-2026-09 array representation,
 * and reading it as a color would answer a plausible but wrong value, so it
 * fails closed at run time with a message that names the shape. An object
 * that carries an unrecognized `space` fails the same way, and the message
 * names the offending spelling: the readers switch on the space, so a color
 * tagged `srgb` would silently take the OKLCh arm.
 */
function asCompiledColor(input: unknown): CompiledColor {
  if (typeof input === 'string')
    return packedToColor(parseColorStringOrThrow(input));
  if (isCompiledColor(input)) return input;
  if (typeof input === 'number' && !Number.isFinite(input))
    return nonFiniteColor(undefined);
  if (
    typeof input === 'object' &&
    input !== null &&
    typeof (input as CompiledColor).space === 'string'
  )
    throw new TypeError(
      `Not a color: "${(input as CompiledColor).space}" is not a color ` +
        `space. Expected ${COLOR_SHAPE}`
    );
  throw new TypeError(`Not a color. Expected ${COLOR_SHAPE}`);
}

/**
 * Normalize any color input to an `RgbColor` (0-255 channels).
 *
 * The conversion is chosen from the value's own space: a color already in
 * sRGB is scaled, never routed through OKLCh, so `AsRgb(AsRgb(c))` answers
 * `AsRgb(c)` channel for channel instead of taking a second gamut clip.
 */
function toRgb255(input: unknown): {
  r: number;
  g: number;
  b: number;
  alpha?: number;
} {
  if (typeof input === 'string') {
    const c = parseColorStringOrThrow(input);
    const rgb: { r: number; g: number; b: number; alpha?: number } = {
      r: (c >>> 24) & 0xff,
      g: (c >>> 16) & 0xff,
      b: (c >>> 8) & 0xff,
    };
    const alpha = normalizeAlpha((c & 0xff) / 255);
    if (alpha !== undefined) rgb.alpha = alpha;
    return rgb;
  }
  const c = asCompiledColor(input);
  const alpha = c.alpha;
  // A non-finite color stays non-finite. The conversions below compute a hue
  // from `max`/`min` comparisons, and every comparison with `NaN` is false,
  // so without this test an HSV `NaN` color came back as a finite red.
  if (!finiteChannels(c.c0, c.c1, c.c2))
    return alpha !== undefined
      ? { r: NaN, g: NaN, b: NaN, alpha }
      : { r: NaN, g: NaN, b: NaN };
  let rgb: { r: number; g: number; b: number };
  switch (c.space) {
    case 'rgb':
      rgb = { r: c.c0 * 255, g: c.c1 * 255, b: c.c2 * 255 };
      break;
    case 'hsv':
      rgb = hsvToRgb(c.c0, c.c1, c.c2);
      break;
    case 'hsl':
      rgb = hslToRgb(c.c0, c.c1, c.c2);
      break;
    case 'oklab':
      rgb = oklchToRgb(oklabToOklch({ L: c.c0, a: c.c1, b: c.c2 }));
      break;
    case 'oklch':
      rgb = oklchToRgb({ L: c.c0, C: c.c1, H: c.c2 });
      break;
    default:
      // Unreachable: `asCompiledColor` admits only the five spellings, each
      // of which has an arm above. An arm is missing if this ever throws —
      // never a color read in a space it is not in.
      throw new TypeError(`Not a color: unhandled color space "${c.space}"`);
  }
  return alpha !== undefined
    ? { r: rgb.r, g: rgb.g, b: rgb.b, alpha }
    : { r: rgb.r, g: rgb.g, b: rgb.b };
}

/** Resolve any color input to Oklch components, preserving alpha if present.
 *
 * This is the ONE reader every color-consuming helper goes through: it reads
 * the value's `space` and converts from it, so a color produced by an
 * explicit conversion (`AsRgb`, `AsHsv`, …) is understood as the space it
 * names rather than misread as OKLCh. */
function toOklch(input: unknown): {
  L: number;
  C: number;
  H: number;
  alpha?: number;
} {
  const c = asCompiledColor(input);
  const alpha = c.alpha;
  if (!finiteChannels(c.c0, c.c1, c.c2))
    return { L: NaN, C: NaN, H: NaN, alpha };
  let oklch: { L: number; C: number; H: number };
  switch (c.space) {
    case 'oklab':
      oklch = oklabToOklch({ L: c.c0, a: c.c1, b: c.c2 });
      break;
    case 'rgb':
      oklch = rgbToOklch({ r: c.c0 * 255, g: c.c1 * 255, b: c.c2 * 255 });
      break;
    case 'hsv':
      oklch = rgbToOklch(hsvToRgb(c.c0, c.c1, c.c2));
      break;
    case 'hsl':
      oklch = rgbToOklch(hslToRgb(c.c0, c.c1, c.c2));
      break;
    case 'oklch':
      oklch = { L: c.c0, C: c.c1, H: c.c2 };
      break;
    default:
      // Unreachable: `asCompiledColor` admits only the five spellings, each
      // of which has an arm above. An arm is missing if this ever throws —
      // never a color read in a space it is not in.
      throw new TypeError(`Not a color: unhandled color space "${c.space}"`);
  }
  return { L: oklch.L, C: oklch.C, H: oklch.H, alpha };
}

/**
 * A `#` color with exactly 3, 4, 6 or 8 hexadecimal digits. `parseColor()`
 * does not check the digits of a `#` form — it reads `#gg0000` as opaque
 * black — so the shape is checked here.
 */
const HEX_COLOR_FORM = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/;

/** A `#` color with exactly 4 hexadecimal digits (`#rgba`). */
const FOUR_DIGIT_HEX_FORM = /^#[0-9a-f]{4}$/;

/**
 * Expand a four-digit `#rgba` spelling to the eight-digit `#rrggbbaa` form by
 * doubling each digit. Returns `undefined` for any other spelling.
 *
 * `parseColor()` reads a `#` form of 3, 6 or 8 digits only and answers its
 * zero sentinel for every other length, so `#f00f` — opaque red in CSS — was
 * read as transparent black. The expansion is done before the call so the
 * parser sees a length it handles.
 */
function expandFourDigitHex(spelling: string): string | undefined {
  if (!FOUR_DIGIT_HEX_FORM.test(spelling)) return undefined;
  return `#${[...spelling.slice(1)].map((d) => d + d).join('')}`;
}

/**
 * A COMPLETE functional color notation: one of the spellings `parseColor()`
 * understands, with a non-empty argument list closed by a parenthesis.
 *
 * Measured against `@arnog/colors`, not assumed: `hsla(`, `lab(`, `lch(`,
 * `hwb(` and `color(` are NOT among them and are refused like any other
 * unknown spelling.
 *
 * The whole form is anchored, not just the opening prefix: an unterminated or
 * empty spelling (`rgb(255,0,0`, `rgba()`) also packs to the parser's zero
 * sentinel, and reading it as transparent black turned a typing mistake into
 * a color. An alpha written inside the parentheses (`rgb(0 0 0 / 0)`) is part
 * of the argument list, so the form still admits it.
 */
const COLOR_FUNCTION_FORM = /^(rgba?|hsl|oklch|oklab)\s*\(\s*[^()]+\s*\)$/;

/**
 * Parse a CSS-style color string to a packed `0xRRGGBBAA` integer. This is
 * the same predicate the interpreter applies (`parseColorString`,
 * `library/colors.ts`), which the GPU target calls directly, so a string is a
 * color on every route or on none of them.
 *
 * `parseColor()` answers 0 both for a string that is not a color and for
 * transparent black, whose packing is 0. The two are told apart by the
 * SPELLING: a well-formed color notation that lands on 0 is transparent
 * black, so `#00000000` and `rgba(0, 0, 0, 0)` are colors just as the keyword
 * `transparent` is. A COMPUTED color with a zero alpha is a color value, not
 * a string, and never reaches this predicate.
 *
 * A string that names no color throws, which is how the neighbouring helpers
 * already report an unusable name ("Unknown palette", "Unknown color
 * space"). Reading it as transparent black instead made a misspelled color
 * compile to a silent, plausible-looking value where the interpreter answered
 * `incompatible-type`.
 */
function parseColorStringOrThrow(input: string): number {
  const spelling = input.trim().toLowerCase();
  const refuse = (): never => {
    throw new Error(`Unknown color: ${input}`);
  };
  if (spelling.startsWith('#') && !HEX_COLOR_FORM.test(spelling)) refuse();
  let c: number;
  try {
    c = parseColor((expandFourDigitHex(spelling) ?? input) as HexColor);
  } catch {
    // A malformed functional notation throws inside the parser.
    return refuse();
  }
  if (c !== 0) return c;
  if (spelling === 'transparent' || spelling.startsWith('#')) return 0;
  if (COLOR_FUNCTION_FORM.test(spelling)) return 0;
  return refuse();
}

/** Packed 0xRRGGBBAA integer to a canonical OKLCh color value. */
function packedToColor(c: number): CompiledColor {
  const r = (c >>> 24) & 0xff;
  const g = (c >>> 16) & 0xff;
  const b = (c >>> 8) & 0xff;
  const oklch = rgbToOklch({ r, g, b });
  return mkColor(
    'oklch',
    oklch.L,
    oklch.C,
    oklch.H,
    normalizeAlpha((c & 0xff) / 255)
  );
}

/** Color runtime helpers shared by both SYS objects. */
const colorHelpers = {
  color(input: unknown): CompiledColor {
    const c = toOklch(input);
    return mkColor('oklch', c.L, c.C, c.H, c.alpha);
  },
  colorToString(input: unknown, format?: string): string {
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
        // Read the OKLCh components directly rather than through the sRGB
        // form above: an OKLCh color value already holds these components,
        // and routing it through sRGB clipped any chroma outside that gamut. The
        // interpreter keeps the same wide-gamut path for this format, so
        // `ColorToString(Oklch(0.6, 0.25, 29), 'oklch')` answered
        // `oklch(0.6 0.246 29)` here and `oklch(0.6 0.25 29)` there.
        const c = toOklch(input);
        const L = Math.round(c.L * 1000) / 1000;
        const C = Math.round(c.C * 1000) / 1000;
        const H = Math.round(c.H * 10) / 10;
        if (c.alpha !== undefined) return `oklch(${L} ${C} ${H} / ${c.alpha})`;
        return `oklch(${L} ${C} ${H})`;
      }
      default:
        throw new Error(`Unknown color format: ${fmt}`);
    }
  },
  colorMix(input1: unknown, input2: unknown, ratio = 0.5): CompiledColor {
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
    return mkColor('oklch', L, C, H, alpha);
  },
  colorContrast(bg: unknown, fg: unknown): number {
    return apca(toRgb255(bg), toRgb255(fg));
  },
  contrastingColor(bg: unknown, fg1?: unknown, fg2?: unknown): CompiledColor {
    const bgRgb = toRgb255(bg);
    if (fg1 !== undefined && fg2 !== undefined) {
      // Answer the CHOSEN candidate itself, in this target's canonical OKLCh
      // form. The library routine answers a packed 0xRRGGBBAA integer, so
      // taking the color back from it quantized to 8 bits per channel a
      // candidate the caller passed as an exact color — the same loss the
      // interpreter no longer takes, where the chosen operand is answered
      // verbatim in the color space it was written in.
      //
      // `ContrastingColor` is a color-PRODUCING operator, so its value is
      // canonical whatever space the chosen candidate was written in. That is
      // the space `colorSpaceOf` reports for this head, and it is what makes
      // `AsOklch(ContrastingColor(bg, AsRgb(a), AsRgb(b)))` skip a conversion
      // it would otherwise need: answering the candidate in its own space
      // made that skip read sRGB channels as OKLCh.
      //
      // The comparison is the library's: the larger ABSOLUTE APCA contrast
      // wins, with the candidate as the FIRST argument of the contrast (APCA
      // is not symmetric in its two arguments).
      const rgb1 = toRgb255(fg1);
      const rgb2 = toRgb255(fg2);
      const chosen =
        Math.abs(apca(rgb1, bgRgb)) >= Math.abs(apca(rgb2, bgRgb)) ? fg1 : fg2;
      const c = toOklch(chosen);
      return mkColor('oklch', c.L, c.C, c.H, c.alpha);
    }
    // Default: the better of the built-in white and black. Neither is a
    // caller value, so there is no color space to preserve.
    return packedToColor(contrastingColor(bgRgb));
  },
  // `ColorToColorspace` answers COMPONENTS, not a color: its interpreter
  // signature is `-> tuple` and consumers index the result
  // (`At(ColorToColorspace(c, "rgb"), 1)`). So the compiled value is a plain
  // array of three channels, four with the alpha, which is the same array a
  // folded call emits for the interpreter's `Tuple`.
  colorToColorspace(input: unknown, space: string): number[] {
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
      case 'hsv': {
        const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
        result = [hsv.h, hsv.s, hsv.v];
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
    // A non-finite color converts to non-finite components. The hue
    // conversions above read the hue off `max`/`min` comparisons, and every
    // comparison with `NaN` is false, so they answered a hue of zero — red —
    // where every `As*` conversion answers `NaN` for the same input. The
    // components are replaced after the switch so an unknown space still
    // throws for a non-finite color, as it does for a finite one.
    if (!finiteChannels(rgb.r, rgb.g, rgb.b)) result = [NaN, NaN, NaN];
    if (alpha !== undefined) result.push(alpha);
    return result;
  },
  colormap(
    name: string,
    arg?: number
  ): CompiledColor | CompiledColor[] | number {
    const allPalettes = {
      ...SEQUENTIAL_PALETTES,
      ...CATEGORICAL_PALETTES,
      ...DIVERGING_PALETTES,
    };
    const palette = allPalettes[name as keyof typeof allPalettes];
    if (!palette) throw new Error(`Unknown palette: ${name}`);

    // Each palette stop is stored as an OKLCh color value for
    // perceptually-uniform interpolation and to match the compiled-runtime
    // color representation.
    const colors = (palette as readonly string[]).map((hex: HexColor) =>
      packedToColor(parseColor(hex))
    );

    // No second arg → return full palette
    if (arg === undefined) return colors;

    // Integer n >= 2 → resample to n evenly spaced colors. Past the cap the
    // interpreter stays symbolic; the compiled spelling for that is NaN.
    if (Number.isInteger(arg) && arg >= 2) {
      const n = arg;
      if (n > MAX_COLORMAP_SAMPLES) return NaN;
      const result: CompiledColor[] = [];
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : i / (n - 1);
        result.push(this._interpolatePalette(colors, t));
      }
      return result;
    }

    // A non-finite position (NaN from upstream real arithmetic, ±∞ — e.g. a
    // real-only guard's failing branch, or plain `√(-1)` in strict mode)
    // cannot index the palette: `colors[NaN]` is `undefined` and the
    // destructuring in `_interpolatePalette` throws "undefined is not
    // iterable" at run time. NaN-in/NaN-out, like compiled real arithmetic.
    if (!Number.isFinite(arg)) return nonFiniteColor(undefined);

    // Float t in [0, 1] → interpolate at position t
    const t = Math.max(0, Math.min(1, arg));
    return this._interpolatePalette(colors, t);
  },

  _interpolatePalette(colors: CompiledColor[], t: number): CompiledColor {
    const copy = (c: CompiledColor): CompiledColor =>
      mkColor(c.space, c.c0, c.c1, c.c2, c.alpha);
    if (colors.length === 0) return mkColor('oklch', 0, 0, 0, undefined);
    if (t <= 0) return copy(colors[0]);
    if (t >= 1) return copy(colors[colors.length - 1]);

    const pos = t * (colors.length - 1);
    const i = Math.floor(pos);
    const frac = pos - i;

    if (frac === 0 || i >= colors.length - 1)
      return copy(colors[Math.min(i, colors.length - 1)]);

    // Interpolate directly in Oklch (palette stops are already Oklch).
    const { c0: L1, c1: C1, c2: H1 } = colors[i];
    const { c0: L2, c1: C2, c2: H2 } = colors[i + 1];

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

    return mkColor(
      'oklch',
      L1 + (L2 - L1) * frac,
      C1 + (C2 - C1) * frac,
      H,
      undefined
    );
  },

  colorFromColorspace(components: unknown, space: string): CompiledColor {
    // The operand is raw COMPONENTS in the named space. A tuple compiles to a
    // numeric array; a typed color head reaches here as a color VALUE, and
    // the interpreter reads such a head's channels as components too
    // (`ColorFromColorspace`, `library/colors.ts`), so its channels are used
    // as they are and its own space is ignored.
    let c0: number, c1: number, c2: number;
    let alpha: number | undefined;
    if (Array.isArray(components)) {
      c0 = components[0];
      c1 = components[1];
      c2 = components[2];
      alpha = components.length >= 4 ? components[3] : undefined;
    } else {
      const c = asCompiledColor(components);
      c0 = c.c0;
      c1 = c.c1;
      c2 = c.c2;
      alpha = c.alpha;
    }
    // The channels are KEPT in the space they were given in, and the value is
    // tagged with it. The interpreter answers the color head of that space
    // (`ColorFromColorspace((0.5, 0.1, 20), "oklch")` is `Oklch(0.5, 0.1,
    // 20)`), so tagging rather than converting is what makes a caller that
    // reads `space`, or a channel, see the same color on both routes. Every
    // helper that consumes a color reads the tag (`toOklch`), so the
    // conversion happens where the color is used.
    const name = space.toLowerCase();
    const tag = name === 'lab' ? 'oklab' : name;
    if (!COMPILED_COLOR_SPACES.has(tag))
      throw new Error(`Unknown color space: ${space}`);
    if (!finiteChannels(c0, c1, c2))
      return nonFiniteColor(alpha, tag as CompiledColorSpace);
    return mkColor(tag as CompiledColorSpace, c0, c1, c2, normalizeAlpha(alpha));
  },

  // -----------------------------------------------------------------------
  // Color constructors. Each accepts components in its colorspace's natural
  // units and returns a color value in the canonical OKLCh space.
  //
  // A NON-FINITE channel yields the `NaN` color. The interpreter's
  // `readColorExpr` (`library/colors.ts`) rejects an infinite or `NaN`
  // channel with `incompatible-type`, and `NaN` is that error's projection
  // on a numeric target. An infinite value or saturation used to be CLAMPED
  // into `[0, 1]` by the sRGB conversion, so `Hsv(90, 1, ~oo)` compiled to
  // the same finite color as `Hsv(90, 1, 1)` while the interpreter refused
  // it (Tycho item 243). A finite out-of-range channel still clamps, on
  // both routes. Alpha is separate: a non-finite alpha reads as opaque on
  // both routes (`normalizeAlpha`).
  // -----------------------------------------------------------------------
  rgb(r: number, g: number, b: number, alpha?: number): CompiledColor {
    if (!finiteChannels(r, g, b)) return nonFiniteColor(alpha);
    // Inputs are 0-1 sRGB; `rgbToOklch` expects 0-255 channels.
    const c = rgbToOklch({ r: r * 255, g: g * 255, b: b * 255 });
    return mkColor('oklch', c.L, c.C, c.H, normalizeAlpha(alpha));
  },
  hsv(h: number, s: number, v: number, alpha?: number): CompiledColor {
    if (!finiteChannels(h, s, v)) return nonFiniteColor(alpha);
    const rgb = hsvToRgb(h, s, v);
    const c = rgbToOklch(rgb);
    return mkColor('oklch', c.L, c.C, c.H, normalizeAlpha(alpha));
  },
  hsl(h: number, s: number, l: number, alpha?: number): CompiledColor {
    if (!finiteChannels(h, s, l)) return nonFiniteColor(alpha);
    const rgb = hslToRgb(h, s, l);
    const c = rgbToOklch({ r: rgb.r, g: rgb.g, b: rgb.b });
    return mkColor('oklch', c.L, c.C, c.H, normalizeAlpha(alpha));
  },
  oklab(L: number, a: number, b: number, alpha?: number): CompiledColor {
    if (!finiteChannels(L, a, b)) return nonFiniteColor(alpha);
    const c = oklabToOklch({ L, a, b });
    return mkColor('oklch', c.L, c.C, c.H, normalizeAlpha(alpha));
  },
  oklch(L: number, C: number, H: number, alpha?: number): CompiledColor {
    if (!finiteChannels(L, C, H)) return nonFiniteColor(alpha);
    return mkColor('oklch', L, C, H, normalizeAlpha(alpha));
  },

  /**
   * Read color COMPONENTS as a color, in 0-1 sRGB, with a 4th component read
   * as alpha.
   *
   * A tuple's compiled value on this target is a bare array, and a tuple at
   * the operand of an ENTRY function — one of the five `As*` conversions, or
   * `ColorToColorspace` — is 0-1 sRGB components, exactly as a tuple written
   * literally there is. The array is only visible at run time when it reaches
   * the position through a variable or from a head that answers components,
   * so the width and the channels are checked here and the conversion is the
   * one `_SYS.rgb` performs (`compileColorEntryOperand`).
   *
   * Any other shape throws the color-shape `TypeError`: the interpreter
   * answers `incompatible-type` for an operand it cannot read three channels
   * off, and a plausible color built from a wrong shape would be worse than a
   * throw.
   */
  colorFromSrgbComponents(input: unknown): CompiledColor {
    if (
      Array.isArray(input) &&
      (input.length === 3 || input.length === 4) &&
      input.every((v) => typeof v === 'number')
    )
      return colorHelpers.rgb(input[0], input[1], input[2], input[3]);
    throw new TypeError(
      'Not a color: color components are 3 numbers, or 4 with the fourth ' +
        `read as alpha. Expected ${COLOR_SHAPE}`
    );
  },

  // -----------------------------------------------------------------------
  // As* converters. Inputs are anything `toOklch` accepts (a color value in
  // any space, or a color string). Each output is a color value TAGGED with
  // the space it names, so a conversion result reaching a second color
  // operator is understood rather than misread as OKLCh. sRGB-based outputs
  // (asRgb/asHsv/asHsl) use 0-1 channels for consistency with the GPU
  // target's shader convention.
  // -----------------------------------------------------------------------
  asRgb(input: unknown): CompiledColor {
    const rgb = toRgb255(input);
    return mkColor('rgb', rgb.r / 255, rgb.g / 255, rgb.b / 255, rgb.alpha);
  },
  // `rgbToHsv` and `rgbToHsl` compute the hue from `max`/`min` comparisons,
  // and every comparison with `NaN` is false, so a non-finite color came out
  // of `asHsv` as `[0, NaN, NaN]` — a hue of zero, which is red. The four
  // other conversions answer the `NaN` triple for the same input, and that
  // triple is what the interpreter's `incompatible-type` rejection projects
  // to on this target, so the guard is explicit here rather than left to the
  // comparisons.
  asHsv(input: unknown): CompiledColor {
    const rgb = toRgb255(input);
    if (!finiteChannels(rgb.r, rgb.g, rgb.b))
      return nonFiniteColor(rgb.alpha, 'hsv');
    const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    return mkColor('hsv', hsv.h, hsv.s, hsv.v, rgb.alpha);
  },
  asHsl(input: unknown): CompiledColor {
    const rgb = toRgb255(input);
    if (!finiteChannels(rgb.r, rgb.g, rgb.b))
      return nonFiniteColor(rgb.alpha, 'hsl');
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    return mkColor('hsl', hsl.h, hsl.s, hsl.l, rgb.alpha);
  },
  asOklab(input: unknown): CompiledColor {
    const c = toOklch(input);
    if (!finiteChannels(c.L, c.C, c.H)) return nonFiniteColor(c.alpha, 'oklab');
    const lab = oklchToOklab({ L: c.L, C: c.C, H: c.H });
    return mkColor('oklab', lab.L, lab.a, lab.b, c.alpha);
  },
  // `AsOklch` of a color VALUE is the identity, and the compile-time
  // pass-through covers it. This helper is for the element of a color
  // BROADCAST (`_SYS.bcastColor`), where the element may be a color STRING
  // that the pass-through would hand back unconverted.
  asOklch(input: unknown): CompiledColor {
    const c = toOklch(input);
    return mkColor('oklch', c.L, c.C, c.H, c.alpha);
  },

  // Perceptual color difference (ΔE_OK).
  colorDelta(a: unknown, b: unknown): number {
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
      // An infinite coordinate difference makes the distance `+∞` whatever
      // the other differences are, a NaN one included. Every Euclidean norm
      // follows that rule, and `Math.hypot(Infinity, NaN)` answers `Infinity`
      // for the same reason. The test must be explicit because the sum below
      // cannot express it: `Infinity² + NaN²` is `NaN`, so without this line
      // `Distance((∞, NaN), (0, 0))` is `NaN` and disagrees with the
      // interpreter. Summing the squares by hand rather than calling
      // `Math.hypot` is deliberate — this helper runs once per point over a
      // point cloud, and the loop is cheaper. `_SYS.norm` repeats the same
      // test for the same reason.
      if (d === Infinity || d === -Infinity) return Infinity;
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

/**
 * Adapt a statistics reducer so a SINGLE DATUM is accepted, not just a
 * collection of them.
 *
 * `Mean(x)` is a legal expression whatever `x` is, and the interpreter answers
 * it by treating one datum exactly as a one-element list — measured head by
 * head at `x = 4`, the scalar and the `[4]` columns agree everywhere:
 * `Mean`/`Median`/`Mode` are `4`, `Variance`/`StandardDeviation`/`Kurtosis`/
 * `Skewness`/`InterquartileRange` are `NaN` (the sample forms divide by
 * `n − 1 = 0`), the population forms are `0`, and `Quartiles` is
 * `(NaN, 4, NaN)`. The reducers in `numerics/statistics.ts` reproduce every one
 * of those from `[x]`, so wrapping is all that is needed — no per-head special
 * case, and no divergence to keep in sync.
 *
 * Without this the compiled code threw at RUN TIME behind `success: true`:
 * `Mean(x)` emitted `_SYS.mean(4)` and the reducer's `for…of` raised
 * "values is not iterable", where the interpreter answers `4`. Wrapping happens
 * here rather than in `numerics/statistics.ts` because those reducers are
 * shared with the interpreter, which reaches them through its own
 * collection-shaped call path and must keep its stricter contract.
 *
 * The static type is no help at the emission site — a bare symbol can be bound
 * to a number OR an array at call time — so the test is on the runtime value.
 */
function oneDatumOk<T>(
  reduce: (values: Iterable<number>) => T
): (values: Iterable<number> | number) => T {
  return (values) =>
    typeof values === 'number' ? reduce([values]) : reduce(values);
}

function bcast(
  f: (...xs: BcastValue[]) => BcastValue,
  ...args: unknown[]
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
  ...args: unknown[]
): BcastValue {
  return bcastWith(true, f, args);
}

/**
 * `bcast` for a head that consumes a COLOR VALUE whole — the color-space
 * conversions `AsRgb`, `AsHsv`, `AsHsl`, `AsOklab` and `AsOklch`. Applies `f`
 * to one color, and maps over a list of colors.
 *
 * The generic `_SYS.bcast` cannot serve here, because it descends into any
 * array and would then apply `f` to each element of a nested list twice over.
 * The test this helper makes is the one the color representation allows: a
 * color VALUE is an OBJECT carrying its space (or a CSS color STRING), and an
 * ARRAY is always a LIST, at any depth. So an array maps element by element
 * and the map recurses — a nested list of colors stays nested, as the
 * interpreter's broadcast does.
 *
 * An empty array is the empty list, and the interpreter answers `Nothing` for
 * a broadcast over an empty operand (`AsRgb([])` measured); this target
 * spells that `NaN`, which is also what `_SYS.bcast` answers at an empty
 * position.
 *
 * An upstream broadcast spells an absent position `NaN`, so a ragged operand
 * reaches this helper with a number and a color side by side: `AsRgb(Hsv(u,
 * 0.5, 0.5))` with `u = [[], [20]]` hands over `[NaN, [color]]`. A `NaN`
 * element goes through `f` like any other element, and the converters answer
 * the non-finite color for it (`asCompiledColor`) — the same projection the
 * interpreter's per-position `incompatible-type` error takes on this target.
 *
 * A list of plain NUMBERS at a color position is a list of errors in the
 * interpreter, and each element reaches `f` here and throws the color-shape
 * `TypeError`. The static gates refuse such an operand first
 * (`NESTED_COLOR_BROADCAST_TYPE`, `refuseColorList`); the throw is the
 * run-time backstop for a value that arrives through `vars`.
 */
function bcastColor(f: (c: unknown) => unknown, v: unknown): unknown {
  if (!Array.isArray(v)) return f(v);
  if (v.length === 0) return NaN;
  return v.map((e) => bcastColor(f, e));
}

/**
 * A rotated READ of a flat array, handed to `bcast` in place of a rotated
 * COPY. `_SYS.rotv(base, shift, ±1)` is emitted only as a DIRECT operand of a
 * `_SYS.bcast` call (see `BaseCompiler.tryCompileBroadcast`), so a view never
 * escapes into a value position: the broadcast reads `base[(i + shift) mod n]`
 * inside its element loop instead of allocating and copying the whole
 * rotation first. A stencil that sums eight rotations of a 40 000-element
 * board allocated eight full copies per evaluation before this (Tycho item
 * 262).
 *
 * `shift` is already normalized to `0 ≤ shift < base.length` by `rotv`, with
 * the `RotateLeft`/`RotateRight` rounding, default and modulo rules applied
 * (`normalizeRotation`), so a view denotes exactly the array `rotl`/`rotr`
 * would have produced.
 */
class RotView {
  constructor(
    readonly base: BcastValue[],
    readonly shift: number
  ) {}
}

/**
 * The shift a `RotateLeft` (`dir = 1`) or `RotateRight` (`dir = -1`) of a
 * length-`n` collection applies, as a non-negative offset below `n`: rounded,
 * a non-finite shift falls back to the default 1 (the interpreter's
 * `toInteger` treats it as missing), then reduced modulo `n`. `n` must be
 * positive.
 */
function normalizeRotation(shift: number, dir: 1 | -1, n: number): number {
  let k = Math.round(shift);
  if (!Number.isFinite(k)) k = 1;
  return (((dir * k) % n) + n) % n;
}

/** `RotateLeft` over an already-evaluated array: an empty array stays empty.
 * The two halves are joined with `concat`, never spread into a literal:
 * spreading a large `slice` walks it element by element through the iterator
 * protocol, and on a 40 000-element list that cost more than the broadcast
 * the rotation fed (Tycho item 262). */
function rotl<T>(l: T[], shift: number): T[] {
  if (l.length === 0) return [];
  const k = normalizeRotation(shift, 1, l.length);
  return l.slice(k).concat(l.slice(0, k));
}

/** `RotateRight` over an already-evaluated array; see `rotl`. */
function rotr<T>(l: T[], shift: number): T[] {
  if (l.length === 0) return [];
  const k = normalizeRotation(shift, -1, l.length);
  return l.slice(k).concat(l.slice(0, k));
}

/**
 * A rotation operand of a broadcast: a `RotView` over an array base, or —
 * for a base that is not an array — whatever the materializing rotation
 * answers, so the two spellings never disagree. An EMPTY base materializes
 * too (to `[]`): a view needs a positive length to normalize its shift, and
 * `bcast` answers the empty position from the array's length anyway.
 */
function rotv(base: unknown, shift: number, dir: 1 | -1): unknown {
  if (!Array.isArray(base) || base.length === 0)
    return dir === 1
      ? rotl(base as unknown[], shift)
      : rotr(base as unknown[], shift);
  return new RotView(
    base as BcastValue[],
    normalizeRotation(shift, dir, base.length)
  );
}

/** The value of broadcast operand `a` at position `i` (`a` is an array or a
 * view; a scalar operand is never asked). */
function bcastCell(a: BcastValue[] | RotView, i: number): BcastValue {
  if (a instanceof RotView) {
    let p = i + a.shift;
    const n = a.base.length;
    if (p >= n) p -= n;
    return a.base[p];
  }
  return a[i];
}

/**
 * One element loop per operand SHAPE: a generated function that reads each
 * operand the way its kind requires — `a` an array cell, `v` a rotation view
 * cell, `s` the scalar itself — and applies the closure to the cells, with
 * the operand reads written out explicitly for that arity.
 *
 * A single generic loop over an operand buffer (`for (j < k) cell[j] = …`)
 * cost 3.5× the explicit form on an 8-operand broadcast of 40 000 elements,
 * and the closure call itself was not the cost (Tycho item 264, measured
 * 2026-09-06). Generating the loop per shape is how a runtime helper gets the
 * explicit form for every arity; the same `Function` constructor already
 * builds every compiled artifact, so this adds no capability the artifact
 * did not need. Shapes are cached by signature; a host that forbids dynamic
 * code (the constructor throws) is remembered, and every broadcast then takes
 * the generic loop.
 *
 * The loop returns `-1` when every position was scalar, or the first position
 * whose cell is itself an array: positions before it are complete, and the
 * caller resumes there with the recursive projection.
 */
type BcastKernel = (
  f: (...xs: BcastValue[]) => BcastValue,
  out: BcastValue[],
  n: number,
  ...operands: unknown[]
) => number;

const BCAST_KERNELS = new Map<string, BcastKernel>();
const BCAST_KERNEL_CACHE_LIMIT = 256;
let bcastKernelsDisabled = false;

function bcastKernel(signature: string): BcastKernel | undefined {
  if (bcastKernelsDisabled) return undefined;
  const cached = BCAST_KERNELS.get(signature);
  if (cached !== undefined) return cached;
  if (BCAST_KERNELS.size >= BCAST_KERNEL_CACHE_LIMIT) return undefined;
  const params: string[] = [];
  const reads: string[] = [];
  const nested: string[] = [];
  const cells: string[] = [];
  for (let j = 0; j < signature.length; j++) {
    const kind = signature[j];
    params.push(`_o${j}`);
    if (kind === 's') {
      cells.push(`_o${j}`);
      continue;
    }
    if (kind === 'v') {
      // `_o${j}` is the view's base array, `_k${j}` its shift: both are
      // passed separately so the loop reads a plain array element.
      params.push(`_k${j}`);
      reads.push(
        `let _p${j} = _i + _k${j}; if (_p${j} >= _n) _p${j} -= _n; ` +
          `const _x${j} = _o${j}[_p${j}];`
      );
    } else reads.push(`const _x${j} = _o${j}[_i];`);
    nested.push(`Array.isArray(_x${j})`);
    cells.push(`_x${j}`);
  }
  const body =
    `for (let _i = 0; _i < _n; _i++) { ${reads.join(' ')} ` +
    (nested.length > 0 ? `if (${nested.join(' || ')}) return _i; ` : '') +
    `_out[_i] = _f(${cells.join(', ')}); } return -1;`;
  let kernel: BcastKernel;
  try {
    kernel = new Function('_f', '_out', '_n', ...params, body) as BcastKernel;
  } catch {
    bcastKernelsDisabled = true;
    return undefined;
  }
  BCAST_KERNELS.set(signature, kernel);
  return kernel;
}

/**
 * Shared implementation of `bcast`/`bcastFn`. `emptyIsList` selects what an
 * empty broadcast position produces, and is carried into the nested positions
 * so a `[[], [1]]` argument projects consistently at every depth.
 *
 * An operand is a scalar, an array, or a rotation view (`RotView`, read in
 * place — see `rotv`). The array and view operands must share one length;
 * a mismatch projects the interpreter's `incompatible-dimensions` result to
 * NaN. Do not truncate or recycle operands.
 */
function bcastWith(
  emptyIsList: boolean,
  f: (...xs: BcastValue[]) => BcastValue,
  args: unknown[]
): BcastValue {
  const k = args.length;
  let n = -1;
  let signature = '';
  for (let j = 0; j < k; j++) {
    const a = args[j];
    let len: number;
    if (Array.isArray(a)) {
      signature += 'a';
      len = a.length;
    } else if (a instanceof RotView) {
      signature += 'v';
      len = a.base.length;
    } else {
      signature += 's';
      continue;
    }
    if (n < 0) n = len;
    else if (len !== n) return NaN;
  }
  if (n < 0) return f(...(args as BcastValue[]));
  // An EMPTY position broadcasts to `Nothing` in the interpreter, not to an
  // empty list — `Not([])` is `Nothing` (NaN here), and in a nested operand
  // (`Not([[], [True]])` → `[Nothing, [False]]`) only that position is
  // projected. Recursing per position is what keeps a sibling from being
  // poisoned by it. A user-function application instead zips zero elements
  // into an empty list (`emptyIsList` — a fresh array per position, never a
  // shared instance).
  if (n === 0) return emptyIsList ? [] : NaN;
  const out: BcastValue[] = new Array(n);

  // Flat fast path: every position whose cells are all scalars is one direct
  // application, through the explicit-read loop generated for this operand
  // shape. It stops at the first position holding a nested array, and the
  // recursive projection below finishes from there — so matrices, ragged
  // operands and a lone nested cell all keep the per-position semantics.
  let from = 0;
  const kernel = bcastKernel(signature);
  if (kernel !== undefined) {
    const operands: unknown[] = [];
    for (let j = 0; j < k; j++) {
      const a = args[j];
      if (a instanceof RotView) operands.push(a.base, a.shift);
      else operands.push(a);
    }
    from = kernel(f, out, n, ...operands);
    if (from < 0) return out;
  }

  const cell: BcastValue[] = new Array(k);
  for (let i = from; i < n; i++) {
    let nested = false;
    for (let j = 0; j < k; j++) {
      const a = args[j];
      const x =
        signature[j] === 's'
          ? (a as BcastValue)
          : bcastCell(a as BcastValue[] | RotView, i);
      if (Array.isArray(x)) nested = true;
      cell[j] = x;
    }
    // The recursive call keeps its operand array (it reads it after this loop
    // has moved on), so it gets a copy; the direct call consumes the buffer
    // before the next position overwrites it.
    out[i] = nested ? bcastWith(emptyIsList, f, cell.slice()) : f(...cell);
  }
  return out;
}

/**
 * Element-wise conditional selection — the runtime side of a compiled
 * `Which`/`If` whose condition may be an indexed collection (`np.select`
 * semantics, R1–R4 of
 * `docs/BROADCAST-MODEL.md`; the interpreter side is
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
  // match), and the positions whose condition cell is absent. A lifted
  // scalar selector decides every undecided position the same way, so it is
  // applied without reading a cell.
  const selection = new Int32Array(n).fill(-1);
  const absent = new Uint8Array(n);
  const reached = new Uint8Array(selectors.length);
  let undecided = n;
  for (let k = 0; k < selectors.length && undecided > 0; k++) {
    const cells = selectors[k];
    if (cells === true || cells === 'absent') {
      const lifted = cells === true;
      for (let j = 0; j < n; j++) {
        if (selection[j] >= 0 || absent[j] === 1) continue;
        if (lifted) selection[j] = k;
        else absent[j] = 1;
      }
      if (lifted) reached[k] = 1;
      undecided = 0;
      break;
    }
    for (let j = 0; j < n; j++) {
      if (selection[j] >= 0 || absent[j] === 1) continue;
      const v = cells[j];
      if (v === true) {
        selection[j] = k;
        reached[k] = 1;
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
  const values: unknown[] = new Array(selectors.length);
  for (let k = 0; k < selectors.length; k++) {
    if (reached[k] === 0) continue;
    const v = armThunks[k]();
    // A list-valued arm is a length participant too (R3).
    if (Array.isArray(v) && v.length !== n) return NaN;
    values[k] = v;
  }

  // 5/ Assemble, position by position. Whether an arm is indexed or lifted
  // whole is a property of the arm, decided once outside the loop.
  const indexed: boolean[] = new Array(values.length);
  for (let k = 0; k < values.length; k++) indexed[k] = Array.isArray(values[k]);
  const out: unknown[] = new Array(n);
  for (let j = 0; j < n; j++) {
    const k = selection[j];
    if (absent[j] === 1 || k < 0) {
      out[j] = NaN;
      continue;
    }
    out[j] = indexed[k] ? (values[k] as unknown[])[j] : values[k];
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
 * - scalar = scalar → tolerant boolean (`a === b || |a − b| <= tol`; a complex
 *   operand compares component-wise for exactness and on the modulus of the
 *   difference for tolerance)
 * - array = scalar (either order) → element-wise array of booleans
 *   (`[1,4,4] = 4` → `[false, true, true]`), recursing into nested arrays
 * - array = array → a single boolean: equal lengths and every element pair
 *   equal (recursive, so matrices compare element-wise; a length mismatch or
 *   an element-shape mismatch is `false`) — collection equality, not a
 *   broadcast
 *
 * The scalar leaf has a STRING branch (tier 2, 2026-08-08): when either side is
 * a string the comparison is content equality with no tolerance, the
 * interpreter's own string semantics (`compare.ts`). Without it the leaf fell
 * through to `Math.hypot(NaN, …) <= tol` → `false`, so two EQUAL string lists
 * answered `false`. It is the mirror of the Python target's `_ce_eqcoll` string
 * leaf, and it is faithful for a MIXED leaf pair too (`Equal("a", 1)` is
 * `False` in the interpreter, and `eqText("a", 1)` is `false`) — though only the
 * all-string shapes are ADMITTED at compile time
 * (`isStringCollectionEquality`). It compares CONDITIONED content (`eqText`),
 * not raw UTF-16, because the interpreter's strings are NFC and well-formed by
 * the time it compares them.
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
  // Array-vs-scalar with a NUMBER on the scalar side: one tolerance test per
  // element, with the `{re, im}` projection and the string branch reserved
  // for the elements that need them. The generic per-element recursion
  // allocated two projection objects per cell and re-probed the scalar's kind
  // at every position; over a 40 000-element list that was the larger half of
  // a compiled `Equal(list, 3)` (Tycho item 264).
  if (aArr !== bArr) {
    const arr = (aArr ? a : b) as unknown[];
    const scalar = aArr ? b : a;
    const out: (boolean | unknown[])[] = new Array(arr.length);
    if (typeof scalar === 'number') {
      for (let i = 0; i < arr.length; i++) {
        const x = arr[i];
        out[i] =
          typeof x === 'number'
            ? x === scalar || Math.abs(x - scalar) <= tol
            : eqTensor(x, scalar, tol);
      }
      return out;
    }
    for (let i = 0; i < arr.length; i++)
      out[i] = aArr ? eqTensor(arr[i], b, tol) : eqTensor(a, arr[i], tol);
    return out;
  }
  if (typeof a === 'string' || typeof b === 'string') return eqText(a, b);
  const part = (v: unknown): { re: number; im: number } =>
    typeof v === 'object' && v !== null && 're' in v
      ? (v as { re: number; im: number })
      : { re: v as number, im: 0 };
  const pa = part(a);
  const pb = part(b);
  // Bit-exact equality first, as `compileJSEquality`'s scalar form does and as
  // the Python `_ce_eqcoll` helper does: the difference of two infinities of
  // the same sign is `NaN`, so `Math.hypot(NaN, 0) <= tol` would report a
  // matching pair of infinities UNEQUAL where the interpreter answers `True`.
  // A pair the exact test accepts has a difference of exactly 0, which the
  // tolerance test accepts too, so nothing else changes; `NaN` fails both,
  // which is again the interpreter's answer.
  // An absent operand reads `undefined` and is promoted to `{ re: undefined,
  // im: 0 }`; two of them would be `===` on both parts, so the exact test
  // also requires a real number on the left.
  if (typeof pa.re === 'number' && pa.re === pb.re && pa.im === pb.im)
    return true;
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
 * Integer matrix power, mirroring the interpreter: `M^0` is the identity,
 * `M^n` is computed by exponentiation by squaring (O(log n) products, as
 * the interpreter does), and a negative power inverts first (`M^-n =
 * (M^-1)^n`). A non-square matrix, a singular matrix under a negative power,
 * or a non-integer exponent yields NaN (the interpreter errors / stays
 * inert), and so does an exponent past `MAX_MATRIX_POWER_EXPONENT`, where
 * the interpreter stays symbolic.
 */
function matpow(m: number[][], p: number): number[][] | number {
  if (!Array.isArray(m) || !Array.isArray(m[0])) return NaN;
  const n = m.length;
  if (m.some((r) => !Array.isArray(r) || r.length !== n)) return NaN;
  if (!Number.isInteger(p)) return NaN;
  if (Math.abs(p) > MAX_MATRIX_POWER_EXPONENT) return NaN;
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
  for (; e > 0; e = Math.floor(e / 2)) {
    if (e % 2 === 1) result = matmul(result, base) as number[][];
    if (e > 1) base = matmul(base, base) as number[][];
  }
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
 * Put a value through the SAME ingress conditioning the interpreter applies
 * when it boxes a string or a character — Unicode NFC normalization, then the
 * lone-surrogate → U+FFFD replacement (`boxed-string.ts`, `boxed-character.ts`)
 * — and return the resulting text.
 *
 * Every text comparison in a compiled artifact goes through it, because the
 * interpreter's own text comparisons (`a.string === b.string`) run on already-
 * conditioned content: without it the decomposed `"e" + U+0301` and the
 * precomposed `"é"` are different code-unit sequences here and compare unequal,
 * where the interpreter answers equal. Literals and everything `_SYS.chars`
 * produces are already conditioned, so this only changes a raw host string
 * bound to a compiled parameter.
 */
/** The code-unit width of the code POINT starting at `i` — 2 for a surrogate
 * pair, 1 otherwise.
 *
 * Used to step past a zero-width regex match. The obvious spelling,
 * `[...s.slice(i)][0].length`, copies the entire remaining suffix and expands
 * all of its code points just to look at the first one, which makes a pattern
 * that matches everywhere (`(?:)`) quadratic in the subject length. */
function codePointWidthAt(s: string, i: number): number {
  const cp = s.codePointAt(i);
  return cp !== undefined && cp > 0xffff ? 2 : 1;
}

function conditionText(x: unknown): string {
  const s = String(x).normalize();
  // `toWellFormed` is Node ≥ 20 / ES2024; older hosts keep the raw string,
  // which only matters for the lone surrogates they cannot replace anyway.
  return (
    (s as unknown as { toWellFormed?: () => string }).toWellFormed?.() ?? s
  );
}

/**
 * The interpreter's element/scalar equality for text: two strings are equal
 * when their CONDITIONED content is identical (see {@link conditionText}), and
 * anything else falls back to strict identity.
 *
 * The fallback keeps every non-text shape byte-for-byte as it was: a number, a
 * boolean and an array compare exactly as `===` did, and a string paired with a
 * non-string is `false` either way (`Equal("1", 1)` is `False` in the
 * interpreter). Only a string/string pair changes, and only when one side is
 * not already NFC.
 */
function eqText(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return a === b;
  return conditionText(a) === conditionText(b);
}

/**
 * `Unique` over a collection whose elements may be TEXT.
 *
 * Each string element is put through the interpreter's ingress conditioning
 * (see {@link conditionText}) before it becomes a `Set` key, so a decomposed
 * `"e" + U+0301` and a precomposed `"é"` supplied at run time collapse to the
 * single element the interpreter answers, instead of surviving as two distinct
 * code-unit sequences. The CONDITIONED form is what comes out, matching the
 * content the interpreter's boxed strings hold. Non-string elements are keyed
 * and returned unchanged, so a mixed collection keeps `Set`'s SameValueZero
 * verdict (NaN included) on every non-text element.
 */
function uniqueText(l: unknown[]): unknown[] {
  return [
    ...new Set(l.map((x) => (typeof x === 'string' ? conditionText(x) : x))),
  ];
}

/**
 * True when two ELEMENTS of a sequence-search operand are the same value, by
 * the interpreter's own element test.
 *
 * The interpreter compares elements with `.isSame()` — the exact structural
 * check, with no numeric tolerance (`matchesSequenceAt` in
 * `library/collections.ts`). {@link eqText} reproduces it for every sort a
 * compiled artifact can hold: strict `===` for a number, a boolean or an array
 * reference, and conditioned (NFC, well-formed) content equality for a text
 * pair — which is what a string subject segmented by `_SYS.chars` yields, and
 * what bridges a `list<character>` needle against a string subject (a
 * character and a one-cluster string with the same content are the same value
 * to `.isSame()`). NaN needs the extra disjunct because `NaN === NaN` is false
 * while `.isSame()` answers true; `IndexOf`'s emitted element test already
 * carries the identical disjunct.
 */
function sameSequenceElement(a: unknown, b: unknown): boolean {
  return (a !== a && b !== b) || eqText(a, b);
}

/**
 * True when `p` occurs in `xs` starting at the 0-based offset `off` — the
 * anchored test behind `StartsWith` and `EndsWith`, mirroring
 * `matchesSequenceAt` (`library/collections.ts`). The caller has already
 * checked that the window fits. An EMPTY `p` matches at any offset, which is
 * what makes the boolean members of the family answer `True` on an empty
 * needle.
 */
function matchesSequenceAtJS(
  xs: unknown[],
  p: unknown[],
  off: number
): boolean {
  for (let k = 0; k < p.length; k++)
    if (!sameSequenceElement(xs[off + k], p[k])) return false;
  return true;
}

/**
 * The 0-based index of the first occurrence of `p` in `xs` at or after `from`,
 * or `-1` when there is none.
 *
 * The naive O(n·m) scan is the interpreter's own (`RangeOf` /
 * `ContainsSequence` in `library/collections.ts`; accepted for v1 by decision
 * D3 of `docs/STRING_ROADMAP.md`). An empty `p`
 * is found at `from`, which is `ContainsSequence`'s empty-needle `True`.
 * `RangeOf` — whose empty needle is an ERROR value, not a span — never reaches
 * here with one: its lowering admits only a provably non-empty needle.
 */
function findSequenceJS(xs: unknown[], p: unknown[], from: number): number {
  for (let i = Math.max(0, from); i + p.length <= xs.length; i++)
    if (matchesSequenceAtJS(xs, p, i)) return i;
  return -1;
}

/**
 * The Unicode White_Space property as a single-character test — the set
 * `Trim`/`TrimStart`/`TrimEnd` strip when no `chars` operand is given.
 *
 * The code points are spelled out (U+0009..U+000D, U+0020, U+0085, U+00A0,
 * U+1680, U+2000..U+200A, U+2028, U+2029, U+202F, U+205F, U+3000) rather than
 * written `\s`, so a compiled artifact's notion of whitespace does not depend
 * on the host regex engine. This duplicates `UNICODE_WHITESPACE` in
 * `library/core.ts` — the operator library is deliberately not imported by the
 * compilation layer, and the two must be kept in step (the parity tests in
 * `test/compute-engine/compile-string-operations.test.ts` compare compiled and
 * interpreted trims on the non-ASCII members of the set).
 */
const JS_UNICODE_WHITESPACE_CHARACTER =
  /^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/;

/**
 * `StringReplace(s, target, replacement, count)` over GRAPHEME CLUSTERS, the
 * interpreter's algorithm verbatim (`library/core.ts`): the scan walks the
 * ORIGINAL subject's cluster sequence and skips past each match's span, so a
 * replacement's own content is never re-matched (`StringReplace("aa", "a",
 * "aa")` is `"aaaa"`, not an infinite expansion), matches are non-overlapping
 * and taken left to right, and re-segmentation happens ONCE when the pieces are
 * joined.
 *
 * `limit` is `Infinity` for the count-less form. An EMPTY `target` would make
 * the scan advance by zero and never terminate; the interpreter answers an
 * error value for it, and the lowering keeps it away from here — an empty
 * literal declines to compile and a computed target is wrapped in a
 * `_SYS.doms` guard that throws before this runs.
 */
function replaceText(
  s: unknown,
  target: unknown,
  replacement: unknown,
  limit: number
): string {
  const subject = SYS_HELPERS.chars(s);
  const needle = SYS_HELPERS.chars(target);
  const rep = conditionText(replacement);
  const out: string[] = [];
  let i = 0;
  let done = 0;
  while (i < subject.length) {
    if (
      done < limit &&
      i + needle.length <= subject.length &&
      needle.every((c, k) => subject[i + k] === c)
    ) {
      out.push(rep);
      i += needle.length;
      done += 1;
    } else {
      out.push(subject[i]);
      i += 1;
    }
  }
  return out.join('').normalize();
}

/**
 * `Trim`/`TrimStart`/`TrimEnd` — `s` with the leading (`start`) and/or trailing
 * (`end`) characters that belong to `chars` removed, walking GRAPHEME CLUSTERS
 * so a cluster is never cut in half (`trimClusters`, `library/core.ts`).
 *
 * `chars === undefined` selects the default Unicode White_Space set. Otherwise
 * `chars` is a SET of characters, never a literal substring: a string operand
 * contributes each of ITS characters, and a collection operand contributes each
 * of its elements' characters — so `Trim("xyhiyx", "xy")` strips any mix of the
 * two.
 */
function trimText(
  s: unknown,
  chars: unknown,
  start: boolean,
  end: boolean
): string {
  const cs = SYS_HELPERS.chars(s);
  let strip: (c: string) => boolean;
  if (chars === undefined)
    strip = (c) => JS_UNICODE_WHITESPACE_CHARACTER.test(c);
  else {
    const set = new Set<string>();
    const add = (t: unknown): void => {
      for (const g of SYS_HELPERS.chars(t)) set.add(g);
    };
    if (Array.isArray(chars)) for (const c of chars) add(c);
    else add(chars);
    strip = (c) => set.has(c);
  }
  let i = 0;
  let j = cs.length;
  if (start) while (i < j && strip(cs[i])) i += 1;
  if (end) while (j > i && strip(cs[j - 1])) j -= 1;
  return cs.slice(i, j).join('').normalize();
}

/**
 * `PadStart`/`PadEnd` — `s` padded to `n` CHARACTERS by repeating `pad`, with
 * the padding placed at the start (`atStart`) or the end (`padClusters`,
 * `library/core.ts`).
 *
 * The padding is built from `pad`'s own grapheme clusters, cycled, so the final
 * copy is truncated ON A CHARACTER BOUNDARY (`PadStart("a", 4, "xy")` is
 * `"xyxa"`). A string that already has `n` or more characters comes back
 * unchanged. An empty `pad` and a negative `n` — both error values in the
 * interpreter — never reach here: an out-of-domain literal declines to
 * compile, and a computed operand is wrapped in a `_SYS.domi`/`_SYS.doms`
 * guard that throws first.
 */
function padText(
  s: unknown,
  n: number,
  pad: unknown,
  atStart: boolean
): string {
  const text = conditionText(s);
  const cs = SYS_HELPERS.chars(text);
  if (cs.length >= n) return text;
  const ps = SYS_HELPERS.chars(pad);
  const fill: string[] = [];
  for (let i = 0; i < n - cs.length; i += 1) fill.push(ps[i % ps.length]);
  return (atStart ? fill.join('') + text : text + fill.join('')).normalize();
}

/**
 * `CaseFold(s)` — the interpreter's v1 approximation of Unicode full case
 * folding, byte for byte (`library/core.ts`): `toUpperCase()` then
 * `toLowerCase()` (the round trip through upper case is what collapses the
 * pairs a single `toLowerCase()` leaves apart, `"ß"` → `"SS"` → `"ss"`), with
 * the Greek FINAL sigma U+03C2 mapped back to the medial U+03C3 so that
 * `CaseFold("ΟΔΟΣ") == CaseFold("οδοσ")` holds. Faithful by construction: the
 * same JS calls run on the same conditioned input, then NFC-normalized as
 * `engine.string()` does.
 */
function caseFoldText(s: unknown): string {
  return conditionText(s)
    .toUpperCase()
    .toLowerCase()
    .replace(/ς/g, 'σ')
    .normalize();
}

/**
 * A compiled scalar callback as the REAL function the numeric kernels
 * (`_SYS.integrate`, `_SYS.nd`, `_SYS.limit`, the Monte-Carlo estimator)
 * consume: those kernels are real-only, and under the promoting disciplines
 * (`auto`, `complex`) a compiled body may hand back a `{re, im}` object —
 * `y^{3/2}` in an integrand promotes to `_SYS.cpow`, which yields `{re: …, im:
 * 0}` on the real axis. The value is projected exactly as the D2 rule
 * projects a real-only head's operand: a plain number passes; an object with
 * an EXACTLY zero imaginary part is its real part; anything else — a genuinely
 * complex value, where the kernel's real result is meaningless — is `NaN`. A
 * plain-number-returning callback costs one `typeof` per evaluation.
 */
function realFn(f: (x: number) => unknown): (x: number) => number {
  return (x: number): number => {
    const v = f(x);
    if (typeof v === 'number') return v;
    if (
      typeof v === 'object' &&
      v !== null &&
      typeof (v as ComplexResult).re === 'number' &&
      (v as ComplexResult).im === 0
    )
      return (v as ComplexResult).re;
    return NaN;
  };
}

/**
 * Runtime integrand-evaluation budget for DYNAMICALLY nested quadrature —
 * integrals entered from inside another integral's integrand at run time.
 *
 * An inner integral runs one full quadrature per evaluation of the enclosing
 * integrand, so every level of nesting MULTIPLIES the work: the adaptive GK15
 * emitter starts from 16 panels of 15 points, so a smooth integrand costs 240
 * evaluations at one level, 5.76·10⁴ at two (measured 6 ms), 1.39·10⁷ at three
 * (measured ~1 s), and ~3.3·10⁹ at four — minutes to hours of synchronous work
 * that never yields to the caller's thread. The quadrature's own deadline check
 * does not bound this: it stops subdividing only when a deadline is armed, and
 * a compiled artifact called outside an engine span (`ce.withTimeLimit`) has
 * none — and a synchronous call cannot be interrupted from outside either.
 *
 * Nesting written into one `Integrate` node's limits is visible to the
 * compiler, but nesting reached BY REFERENCE is not: `∫ g(x) dx` where the
 * compiled `g` computes an integral of its own shows no nested `Integrate` node
 * anywhere in the tree, and a macro-expanded iteration can stack six such
 * levels. No tree walk can see that composition, because it happens per RUNTIME
 * call.
 *
 * So the runtime enforces its own cap: each OUTERMOST `_SYS.integrate` entry
 * (one with no integral already running) re-arms this budget, and every
 * integrand evaluation performed by a NESTED integral consumes one unit. Once
 * it is gone, a nested integral answers `NaN` — the scalar target's "no value"
 * spelling — on entry or mid-accumulation, which propagates outward through the
 * enclosing quadratures instead of spinning, and the caller falls back to the
 * interpreter. The cap is PER OUTERMOST INTEGRAL, so integrals started after
 * the exhausted one completes get a full budget again.
 *
 * Sized so the nesting the compiler DOES emit stays untouched: a triple
 * integral's inner two levels consume ~1.4·10⁷ evaluations for a smooth
 * integrand, and hard-but-legitimate double integrals measured up to 4.7·10⁵
 * (`∫₀¹∫₀¹ √(xy)`, 20 ms), so 2²⁵ ≈ 3.4·10⁷ leaves a double integral two
 * orders of magnitude of headroom and a smooth triple a factor of two, while a
 * runaway dynamic composition is cut after a few seconds rather than never.
 */
const NESTED_QUADRATURE_BUDGET = 1 << 25;

/** Number of `_SYS.integrate` activations currently on the call stack. Zero at
 *  every outermost entry — module state is safe here because compiled code runs
 *  synchronously on one thread. */
let activeIntegrals = 0;

/** Remaining nested-integrand-evaluation budget for the current outermost
 *  integral — see {@link NESTED_QUADRATURE_BUDGET}. Negative once exhausted,
 *  which is what tells an enclosing quadrature its estimate is incomplete. */
let nestedEvalsLeft = 0;

/**
 * `f` wrapped so that each evaluation made on behalf of a NESTED integral (one
 * running inside another integral's integrand) consumes budget, and answers
 * `NaN` once the budget is exhausted — which the quadrature carries into its
 * estimate, ending the nested integral with no value.
 */
function budgetedIntegrand(f: (x: number) => number): (x: number) => number {
  return (x: number): number => {
    if (activeIntegrals > 1 && --nestedEvalsLeft < 0) return NaN;
    return f(x);
  };
}

/**
 * Open one integral activation: re-arm the nested budget at an outermost entry,
 * or refuse a nested entry whose budget is already gone. Returns `false` when
 * the caller must answer `NaN` without integrating; `true` when it may proceed,
 * and must then run its work inside `try { … } finally { activeIntegrals--; }`.
 */
function enterIntegral(): boolean {
  if (activeIntegrals === 0) nestedEvalsLeft = NESTED_QUADRATURE_BUDGET;
  else if (nestedEvalsLeft <= 0) return false;
  activeIntegrals++;
  return true;
}

/**
 * Runtime helpers injected as `_SYS` into compiled JavaScript functions.
 * Shared by both ComputeEngineFunction and ComputeEngineFunctionLiteral.
 */
const SYS_HELPERS = {
  bcast,
  bcastFn,
  bcastColor,
  // Establish the representation used by the fused numeric selection loop.
  // Scan every cell: a declaration alone cannot exclude nested or absent cells.
  numericSelectionInputs: (...arrays: unknown[]): boolean => {
    const first = arrays[0];
    if (!Array.isArray(first) || first.length === 0) return false;
    for (const array of arrays) {
      if (!Array.isArray(array) || array.length !== first.length) return false;
      for (let i = 0; i < array.length; i++)
        if (typeof array[i] !== 'number') return false;
    }
    return true;
  },
  // `RotateLeft`/`RotateRight` over an evaluated array, and the in-place
  // rotated READ a broadcast consumes instead of a copy (see `RotView`).
  rotl,
  rotr,
  rotv,
  // Element/scalar equality that is faithful for text — see `eqText`. Emitted
  // by `IndexOf`'s element test, where the elements and the needle may be text
  // or anything else; the equality LOWERINGS reach the same verdict through
  // `cmpc`, which conditions its operands identically.
  eqt: eqText,
  // The interpreter's ingress conditioning for text — NFC normalization, then
  // the lone-surrogate replacement (see `conditionText`) — as a standalone
  // helper. Emitted by the all-string ORDERINGS, which compare the conditioned
  // operands with the raw infix `<`/`<=`/`>`/`>=` the interpreter itself uses
  // on strings; the equality lowerings reach the same conditioning inside
  // `eqt`/`cmpc` instead.
  ct: conditionText,
  // `Unique` over possibly-text elements — see `uniqueText`.
  uniqt: uniqueText,
  // Coerce a value to the `{ re, im }` complex representation, idempotently.
  //
  // A user function whose signature declares a `complex` PARAMETER compiles
  // its body in the complex lane, so the callee reads `.re`/`.im` off that
  // parameter and the call site owes it an object. When the argument is
  // provably real the wrap is emitted statically (`({ re: x, im: 0 })`, no
  // runtime cost); when its realness is not decidable at compile time — an
  // untyped free symbol supplied at `run()` time, the commonest shape — the
  // caller may hand over either a plain number or an already-complex object,
  // and only a runtime test can tell. Passing a number through unwrapped made
  // the callee compute `x.re` on a number; wrapping an object unconditionally
  // would nest it as `{ re: { re, im }, im: 0 }`. This does neither.
  cplx: (x: unknown): { re: number; im: number } =>
    typeof x === 'number'
      ? { re: x, im: 0 }
      : (x as { re: number; im: number }),
  // The exact runtime realness test of a value that may be a plain number or
  // a `{re, im}` object: true when the imaginary part is exactly zero. The
  // `complexIsReal` hook of this target (`CompileTarget.complexIsReal`); the
  // test is exact because the transcendental kernels chop their own roundoff
  // dust (`toRI`).
  cisreal: (x: unknown): boolean =>
    typeof x === 'number' || (x as { im: number }).im === 0,
  // Shape-agnostic SCALAR add / multiply: two numbers combine as numbers; a
  // `{re, im}` in either position combines as complex (the other operand
  // lifted). The fold combiner of a collection `Sum`/`Product` whose elements
  // are not provably real (`emitCollectionReduce`), so a promoted or complex
  // element never reaches the raw `+`.
  sadd: (a: unknown, b: unknown): number | { re: number; im: number } => {
    if (typeof a === 'number' && typeof b === 'number') return a + b;
    const p = typeof a === 'number' ? { re: a, im: 0 } : (a as ComplexResult);
    const q = typeof b === 'number' ? { re: b, im: 0 } : (b as ComplexResult);
    return { re: p.re + q.re, im: p.im + q.im };
  },
  smul: (a: unknown, b: unknown): number | { re: number; im: number } => {
    if (typeof a === 'number' && typeof b === 'number') return a * b;
    const p = typeof a === 'number' ? { re: a, im: 0 } : (a as ComplexResult);
    const q = typeof b === 'number' ? { re: b, im: 0 } : (b as ComplexResult);
    return {
      re: p.re * q.re - p.im * q.im,
      im: p.re * q.im + p.im * q.re,
    };
  },
  // The exactly-real complex object `{re, im: 0}` AS the real number `re`;
  // any other value passes through. Used by the emitted DISPATCHERS
  // (multi-clause guard chains, protocol receiver guards) to test their
  // guards on the value the interpreter would see — a `complex`-typed symbol
  // is lifted to `{re, im: 0}` at `run()` entry (D3), and a value-literal
  // guard (`_$a[0] === 0`) or a `real` guard must still select the clause the
  // interpreter selects for the real number `0`.
  creal: (x: unknown): unknown =>
    typeof x === 'object' &&
    x !== null &&
    (x as { im: unknown }).im === 0 &&
    typeof (x as { re: unknown }).re === 'number'
      ? (x as { re: number }).re
      : x,
  // The ELEMENT-WISE real projection (`CompileTarget.complexRealElements`):
  // an array — nested arrays recursed — with every exactly-real element
  // (`cisreal`) replaced by its real part and every other element by NaN; a
  // scalar takes the same rule whole. The element-wise form of the D2/D6
  // runtime rule (`BaseCompiler.realOperandGuard`) hands a real-only head's
  // array operand through this, so the real lowering that follows sees plain
  // numbers and answers NaN (or `false`, for an ordering) exactly at the
  // complex positions: `⌊√L⌋` at `L = [4, -1]` is `[2, NaN]`.
  crealElements: function crealElements(x: unknown): unknown {
    if (Array.isArray(x)) return x.map(crealElements);
    if (typeof x === 'number') return x;
    return typeof x === 'object' &&
      x !== null &&
      (x as { im: unknown }).im === 0 &&
      typeof (x as { re: unknown }).re === 'number'
      ? (x as { re: number }).re
      : NaN;
  },
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
  // ComplexInfinity, whose float projection is `Infinity` (pole-encoding
  // ruling 2026-08-28 — the magnitude survives, the missing direction does
  // not), the same value an embedded `~oo` literal compiles to.
  factorial: (x: number): number =>
    Number.isInteger(x) ? (x < 0 ? Infinity : factorial(x)) : gamma(x + 1),
  factorial2,
  // Γ has a pole at every non-positive integer; the shared numeric helper
  // answers `NaN` there, but the compiled lane spells a pole as `Infinity`
  // (the float projection of the interpreter's `~oo`), the same value a
  // folded `Gamma(-2)` embeds — so the runtime and folded routes agree. A
  // non-integer or non-finite argument (`-Infinity` is not a pole) still
  // goes to the helper unchanged.
  gamma: (z: number): number =>
    Number.isInteger(z) && z <= 0 ? Infinity : gamma(z),
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
      centeredDiffHigherOrder(realFn(f), x, order),
  // Fixed exponents avoid repeated base evaluation and the general power
  // kernel. Keep multiplication order explicit for small real powers.
  pow2: (x: number) => x * x,
  pow3: (x: number) => x * x * x,
  // The fractional part under the floored convention, the value of
  // `Mod(x, 1)`. The trailing `% 1` maps the one case where the subtraction
  // rounds up to exactly `1` (a tiny negative `x`) back into `[0, 1)`; it
  // is exact everywhere else on that range. NaN and the infinities give NaN.
  fract: (x: number) => (x - Math.floor(x)) % 1,
  pow4: (x: number) => {
    const s = x * x;
    return s * s;
  },
  pow5: (x: number) => {
    const s = x * x;
    return s * s * x;
  },

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
  // NaN propagates (Contract B `propagate` default, ratified 2026-08-27):
  // without the leading arm both comparisons are false for NaN and the
  // kernel answered the final arm's `1` — a fail-closed violation.
  heaviside: (x: number) =>
    Number.isNaN(x) ? NaN : x < 0 ? 0 : x === 0 ? 0.5 : 1,
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
    // `conditionText`, not a bare `.normalize()`: the interpreter conditions a
    // string at INGRESS — NFC normalization AND the lone-surrogate → U+FFFD
    // replacement of `String.prototype.toWellFormed` (`BoxedString`'s
    // constructor) — so a raw host string bound to a compiled parameter must go
    // through the same two steps here. Without the second one, a lone surrogate
    // reaching `Characters`, indexing, iteration or a string-preserving
    // operator would be segmented as itself, where the interpreter has already
    // replaced it with U+FFFD.
    return Array.from(graphemeSegmenter.segment(conditionText(s)), (seg) =>
      seg.segment.normalize()
    );
  },
  // Order two CHARACTERS (each a one-cluster string) the way the interpreter
  // does: by their Unicode SCALAR sequence, comparing code point against code
  // point and, on a common prefix, the shorter cluster first
  // (`compare.ts`, decision D8).
  //
  // Not `a < b`: `String.prototype.<` compares UTF-16 code UNITS, so every
  // astral character — U+10000 and above, encoded as a surrogate pair whose
  // lead unit is 0xD800–0xDBFF — sorts BELOW the private-use and specials
  // block U+E000–U+FFFF. `"\u{10000}" < ""` is `true` under the raw operator
  // and `False` in the interpreter. `Array.from` iterates CODE POINTS (not
  // code units), which is what makes the surrogate pair one comparison.
  //
  // Returns the usual −1/0/1, so it doubles as the comparator for a
  // character `Sort`.
  //
  // Each operand is put through the SAME ingress conditioning the interpreter
  // applies when it boxes a character — Unicode NFC normalization, then the
  // lone-surrogate → U+FFFD replacement of `String.prototype.toWellFormed`
  // (`boxed-character.ts`). Without it the decomposed `"e" + U+0301` and the
  // precomposed `"é"` are different code-point sequences here and compare
  // unequal, where the interpreter — which normalized both at boxing time —
  // answers equal. Literals and everything `_SYS.chars` produces are already
  // conditioned, so this only changes a raw host string bound to a compiled
  // parameter.
  cmpc: (a: unknown, b: unknown): number => {
    const sa = Array.from(conditionText(a), (c) => c.codePointAt(0)!);
    const sb = Array.from(conditionText(b), (c) => c.codePointAt(0)!);
    const n = Math.min(sa.length, sb.length);
    for (let i = 0; i < n; i++)
      if (sa[i] !== sb[i]) return sa[i] < sb[i] ? -1 : 1;
    return sa.length === sb.length ? 0 : sa.length < sb.length ? -1 : 1;
  },
  // --- Sequence search and string operations ----------------------------
  // The kernels behind `StartsWith`/`EndsWith` (`seqat`, the anchored test),
  // `ContainsSequence`/`RangeOf` (`seqidx`, the scan) and the string-specific
  // operators. Each is the interpreter's own algorithm over the same element
  // sequence: a string operand reaches them already segmented into grapheme
  // clusters by `chars`, so no comparison can straddle a cluster boundary.
  // See `matchesSequenceAtJS`, `findSequenceJS`, `replaceText`, `trimText`,
  // `padText` and `caseFoldText`.
  // (`docs/STRING_ROADMAP.md`, decision D8.)
  // --- Regular expressions (Strings Phase 3) ----------------------------
  // The dialect is the HOST's, by user ruling 2026-08-17 — no feature subset
  // and no caps — which is exactly what makes compiled code and the
  // interpreter agree here: both hand the same pattern text to the same
  // `RegExp` implementation, so there is no second engine to diverge from.
  //
  // `rerep` compiles its own `g`-flagged object per call rather than reusing
  // one. A `g`-flagged `RegExp` carries its scan position in `lastIndex`, so
  // a shared instance corrupts two live loops; the interpreter learned this
  // the hard way when a replacement callback re-entered the same pattern and
  // hung. Compiled code has the same hazard. `reis` is NOT global — `.test()`
  // on a plain pattern neither reads nor writes `lastIndex` — so its per-call
  // construction is only a small allocation, not a correctness requirement.
  // `conditionText` + the non-string rejection, exactly as `chars` does: the
  // interpreter conditions a string at INGRESS (NFC normalization AND the
  // lone-surrogate → U+FFFD repair of `BoxedString`'s constructor), so a raw
  // host string bound to a compiled parameter must go through the same steps
  // or the two surfaces disagree. Measured before this: the NFD spelling of
  // `é` (`e` + U+0301) matched `/é/` in the interpreter and NOT in compiled
  // code. Rejecting a non-string is the same contract too — `test()` would
  // otherwise coerce `42` to `\"42\"` and answer.
  reis: (s: unknown, src: string, flags: string) => {
    if (typeof s !== 'string')
      throw new Error('IsMatch: expected a string subject');
    return new RegExp(src, flags).test(conditionText(s));
  },
  // Conditioned on both the subject and the replacement, for the reason given
  // on `reis`: the interpreter has already conditioned both by the time it
  // builds a result, so compiled code must too.
  rerep: (
    sRaw: unknown,
    src: string,
    flags: string,
    replacementRaw: unknown,
    limit: number
  ) => {
    if (typeof sRaw !== 'string' || typeof replacementRaw !== 'string')
      throw new Error('StringReplace: expected string operands');
    const s = conditionText(sRaw);
    const replacement = conditionText(replacementRaw);
    const re = new RegExp(src, flags.includes('g') ? flags : flags + 'g');
    const out: string[] = [];
    let from = 0;
    let done = 0;
    re.lastIndex = 0;
    for (;;) {
      if (done >= limit) break;
      const m = re.exec(s);
      if (m === null) break;
      out.push(s.slice(from, m.index), replacement);
      from = m.index + m[0].length;
      done += 1;
      if (m[0].length === 0) {
        const step = codePointWidthAt(s, re.lastIndex);
        out.push(s.slice(from, from + step));
        from += step;
        re.lastIndex += step;
        if (re.lastIndex > s.length) break;
      }
    }
    out.push(s.slice(from));
    // NFC-normalize the JOIN, as `replaceText` (the literal-target kernel) and
    // the interpreter's `ce.string(out.join(''))` both do. Re-segmentation
    // happens once, when the pieces are joined, so a replacement whose
    // trailing edge composes with the character following it must combine:
    // replacing `q` with `e` in `q` + U+0301 is the single character `é`
    // (U+E9), not `e` + U+0301. Without this the compiled result had a
    // different `Length()` from the interpreted one.
    return out.join('').normalize();
  },
  seqat: matchesSequenceAtJS,
  seqidx: findSequenceJS,
  srep: replaceText,
  strim: trimText,
  spad: padText,
  cfold: caseFoldText,
  // Run-time DOMAIN guards for the operands whose out-of-domain value the
  // interpreter answers with an ERROR VALUE — `RangeOf`'s `from` and needle,
  // `StringReplace`'s `count` and `target`, `StringRepeat`'s and
  // `PadStart`/`PadEnd`'s `n` and `pad`. A compiled artifact has no error
  // value to hand back, so the emitted code THROWS with the operator and the
  // violated rule named: the interpreter returns an error VALUE, compiled
  // code throws — a visible failure, never a wrong value. Same contract as
  // the `Slice` lowering's run-time span check, which throws on a span
  // argument that is not an ascending index range.
  //
  // Emitted only for a COMPUTED operand: a literal is decided at compile
  // time, where an out-of-domain one declines instead (see
  // `guardedIntegerArg`). Each returns its operand so it can wrap the value
  // in place.
  // `max` is the UPPER bound the interpreter's own reader imposes: the string
  // operators read their count through `asSmallInteger` (`library/core.ts`),
  // which answers `null` — hence an error value — for a magnitude above
  // `SMALL_INTEGER` (1000000). Without it, `StringRepeat(s, 2000001)` would
  // build a multi-megabyte string where the interpreter errors. `RangeOf`'s
  // `from` reads through `toInteger` instead and has no such ceiling, so it
  // passes `Infinity`. A lower bound below `-SMALL_INTEGER` needs no separate
  // test: every caller's `min` is 0 or 1.
  domi: (v: unknown, min: number, max: number, message: string): number => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max)
      throw new RangeError(message);
    return v;
  },
  doms: (v: unknown, message: string): string => {
    if (typeof v !== 'string' || v === '') throw new RangeError(message);
    return v;
  },
  // The needle of `RangeOf`, which must be a NON-EMPTY sequence: an empty
  // needle has no representable span (`Range(1, 0)` is the DESCENDING range
  // [1, 0], not an empty one), so the interpreter answers an error value for
  // it. Both kinds of needle reach here as an array — a string's grapheme
  // clusters or a list's elements — so the length test covers both.
  domne: <T extends ArrayLike<unknown>>(v: T, message: string): T => {
    if (v.length === 0) throw new RangeError(message);
    return v;
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
  // `Abs` over a value whose static type admits BOTH a point and a point
  // list (the `list<tuple<…>> | tuple<…>` union a point-consuming document
  // function declares): the shape is only known at run time, so dispatch on
  // it here the way `evaluate()` dispatches on the operand's kind — a number
  // is `Math.abs`, a complex object its modulus, an array of numbers a POINT
  // (its norm), and an array of arrays a point list (one norm per point). An
  // EMPTY array is an empty point LIST — the interpreter answers the empty
  // list for it, not the norm of no components (which is 0).
  //
  // A compiled array carries no tuple-versus-list tag, so a flat numeric
  // array is read as a point. That is the only reading the operands which
  // reach this helper admit: the compiler sends an operand here only when
  // its type has no flat-numeric-list arm, or when it is a point SUM, for
  // which the interpreter refuses a flat list of numbers. A NESTED array is
  // read as a point list, never as a matrix, for the same reason: the
  // operand types that reach this helper have no legitimate matrix value —
  // a point-list union refuses a matrix at the call gate, and where the
  // declaration does accept one the point subtraction errors at every
  // element (Tycho item 253).
  absShape: (x: unknown): unknown => {
    if (typeof x === 'number') return Math.abs(x);
    if (Array.isArray(x)) {
      if (x.length === 0) return [];
      if (x.every((v) => typeof v === 'number')) return SYS_HELPERS.norm(x);
      return x.map((v) => SYS_HELPERS.absShape(v));
    }
    if (
      typeof x === 'object' &&
      x !== null &&
      typeof (x as { re?: unknown }).re === 'number'
    )
      return SYS_HELPERS.cabs(x as ComplexResult);
    return NaN;
  },
  // Norm: |x| for a scalar; the 2-norm (Frobenius for a matrix) by default.
  // With an explicit p: for a vector the p-norm (Σ|xᵢ|^p)^(1/p), p =
  // Infinity → max |xᵢ|; for a matrix the operator norms the interpreter
  // implements — p = 1 → max column abs sum, p = Infinity → max row abs
  // sum. Other matrix p-norms (e.g. the spectral 2-norm, which needs an
  // SVD) yield NaN.
  norm: (x: unknown, p?: number): number => {
    if (typeof x === 'number') return Math.abs(x);
    if (!Array.isArray(x)) return NaN;
    const flat = x.flat(Infinity) as number[];
    // An infinite entry makes the norm `+∞` whatever the other entries are, a
    // NaN entry included: `|±∞|` is `+∞`, and it dominates every sum and every
    // maximum below. The test must be explicit because the accumulators cannot
    // express it — `Infinity² + NaN²` is `NaN`, and `Math.max(Infinity, NaN)`
    // is `NaN` — so without it the result is `NaN` where the interpreter and
    // `Math.hypot(Infinity, NaN)` both answer `Infinity`. It applies to the
    // matrix operator norms too, so that the column or row carrying the
    // infinity never decides the answer on its own. Each order consults it
    // only after accepting the order, so that an entry cannot turn an order
    // this helper does not implement into one it answers. The rule is recorded
    // in `docs/ERROR-MODEL.md`.
    const hasInfiniteEntry = flat.some(
      (v) => v === Infinity || v === -Infinity
    );
    if (Array.isArray(x[0]) && p !== undefined) {
      const m = x as number[][];
      // The matrix orders below are the max column sum and the max row sum;
      // any other one is NaN whatever the entries are.
      if (p !== 1 && p !== Infinity) return NaN;
      if (hasInfiniteEntry) return Infinity;
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
    // The vector orders this helper implements are the L∞ maximum and the
    // p-norms for `p > 0`; with no `p` the order is 2. Any other order —
    // `p = 0`, a negative `p`, a NaN `p` — has no value here, so the result is
    // NaN, which is how compiled code spells an absent number. An unsupported
    // matrix order above answers the same way. The interpreter is stricter
    // there: a non-positive order violates `Norm`'s declared precondition and
    // answers an `evaluation-error` (the `requires` clause,
    // `library/linear-algebra.ts`), while an order it merely does not compute
    // for the operand's rank — a matrix p-norm for `p ∉ {1, 2, ∞}` — leaves
    // the application unevaluated. An `Error` has no float representation, so
    // the compiled lane degrades both to NaN. Without this line the general
    // accumulator
    // returns whatever `(Σ|xᵢ|^p)^(1/p)` happens to produce, which for `p = 0`
    // is `+∞` on a two-element vector and for a negative `p` an ordinary
    // number.
    //
    // The order is checked before the infinite-entry test above, for the same
    // reason the matrix branch checks it first: otherwise the data would be
    // what makes an unsupported order answer, and `norm([+∞], 0)` would be
    // `+∞` while `norm([1], 0)` is NaN.
    if (p !== undefined && !(p === Infinity || p > 0)) return NaN;
    if (hasInfiniteEntry) return Infinity;
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
  // One component slot of an all-scalar compiled `PointList` whose static type
  // did not prove it a number (`unknown`, `value` — the type a free plot
  // variable carries).
  //
  // Such a slot is admitted statically because a per-pixel plot body is parsed
  // LaTeX whose free variables are `unknown` and are scalars at run time. When
  // one turns out to hold a LIST instead, the point would otherwise get a
  // whole array spliced into a component — `PointList(u, v)` with `v` bound to
  // `[10, 20]` produced `[1, [10, 20]]` — and no consumer of a point can read
  // that. The array becomes NaN, a self-describing absence marker, which is
  // the convention the ZIPPED lowering of `PointList` (`compileJSPointList`)
  // already applies to its own opaque slots.
  //
  // Deliberate divergence from the interpreter, shared with that zip guard:
  // the interpreter re-reads such a component as a list SOURCE and transposes
  // it, which the compiled form cannot know to do, and a silently-wrong point
  // is worse than an absent one.
  pointSlot: (v: unknown): unknown => (Array.isArray(v) ? NaN : v),
  /**
   * Coordinate `k` (0-based) of a point-shaped value whose static type did
   * not settle whether it is ONE point or a LIST of points. Mirrors the
   * interpreter's `pointComponentAt` and `runtimePointArity`
   * (`library/collections.ts`) under the JavaScript erasure, where a tuple
   * and a list are both arrays:
   *
   *  - a list whose first element is a NUMERIC coordinate row (an array that
   *    is empty or starts with a number or a `{ re, im }`) is a list of
   *    points and yields the list of coordinates. A row of strings is not a
   *    point in the interpreter (`isPointLike` admits numeric rows and
   *    tuples), so such a list is indexed like `First`/`Second`/`Third`
   *    instead; the tuple-of-strings spelling is erased to the same array and
   *    takes the same reading;
   *  - the third coordinate of a point (or of a list whose first point) has
   *    fewer than three components is the interpreter's `incompatible-
   *    dimensions` error, projected to a single `NaN` for the whole
   *    application — never a `NaN` per point;
   *  - an absent coordinate otherwise, an empty list, and a non-array value
   *    (the interpreter's `incompatible-type` error) answer `NaN`.
   */
  pointComponent: (v: unknown, k: number): unknown => {
    if (!Array.isArray(v)) return NaN;
    const first = v[0];
    const rows =
      Array.isArray(first) &&
      (first.length === 0 ||
        typeof first[0] === 'number' ||
        (typeof first[0] === 'object' &&
          first[0] !== null &&
          're' in first[0]));
    if (k === 2 && (rows ? first.length : v.length) < 3) return NaN;
    if (rows) return v.map((p) => (Array.isArray(p) ? (p[k] ?? NaN) : NaN));
    return v[k] ?? NaN;
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
  // `at` for a base whose STATIC element type is numeric and whose value
  // comes from outside the kernel (a `run()` argument, a function
  // parameter). Every consumer of the read was compiled for a number, so a
  // row where a number was expected — a matrix handed to a kernel compiled
  // for a list of numbers — would make the scalar `+` concatenate strings.
  // The check dispatches on the run-time index shape: a scalar read must not
  // yield an array, and a gather or mask must not yield a list with an array
  // in it. Throw with the remedy: declare the collection with its nested
  // element type, or evaluate with the interpreter, which broadcasts.
  atNumeric: (
    arr: unknown,
    i: number | unknown[],
    elementType: string
  ): number | unknown[] => {
    const v = SYS_HELPERS.at(arr, i);
    const nested = Array.isArray(i)
      ? Array.isArray(v) && v.some((x) => Array.isArray(x))
      : Array.isArray(v);
    if (!nested) return v;
    throw new Error(
      `At: the element read is a list at run time, but its static element ` +
        `type is \`${elementType}\`, so the compiled code treats it as a ` +
        `number. Declare the collection with its nested element type ` +
        `(for example \`list<list<number>>\` or \`matrix\`), or evaluate ` +
        `with the interpreter.`
    );
  },
  // Positional access WITHOUT the from-the-end convention: the index must be
  // an integer in `1..length`, and every other index — zero, negative,
  // fractional, past the end, a non-number — reads the collection's absence
  // marker. It exists for a HOST that replaces the `At` lowering because its
  // own source language has no from-the-end indexing: there a computed
  // negative index means "undefined", and `_SYS.at` would hand back a real
  // element from the far end instead. `_SYS.at` stays the lowering the
  // compiler itself emits, and the two differ in four ways: this one takes no
  // negative index, reads no boolean mask, marks each out-of-band position of
  // a LIST index rather than refusing the whole read, and ignores the `.re` of
  // a complex index instead of indexing through it.
  //
  // The absence marker is decided at RUN time, from the first cell: `NaN` for
  // a numeric collection (and for an empty one, where every read is out of
  // band anyway and `NaN` propagates where `null` would coerce to 0),
  // `undefined` for any other domain — the target null the object discharge
  // (`Coalesce`, `IsMissing`) reads. The compiled `At` decides the same thing
  // from the static element type; a host lowering has no such type for a
  // symbolic base, and `matrix<number>` matches `list<number>` yet holds its
  // absences as `Missing`, so the type test would misclassify it.
  //
  // A base that is not an array has no elements to index, so it reads `NaN`.
  // The guard is load-bearing rather than defensive: a STRING has both
  // `.length` and `[k - 1]`, so without it an accidental string base would
  // silently answer CHARACTERS.
  atNoWrap: (arr: unknown, i: unknown): unknown => {
    if (!Array.isArray(arr)) return NaN;
    const hole =
      arr.length === 0 || typeof arr[0] === 'number' ? NaN : undefined;
    const pick = (k: unknown): unknown =>
      Number.isInteger(k) && (k as number) >= 1 && (k as number) <= arr.length
        ? arr[(k as number) - 1]
        : hole;
    return Array.isArray(i) ? i.map((k) => pick(k)) : pick(i);
  },
  // Definite integral via deterministic adaptive Gauss–Kronrod (GK15) — near
  // machine precision on smooth integrands, µs-scale. On non-convergence
  // (pathological integrand), fall back to the Monte-Carlo estimator — but only
  // when sampling could actually improve on the quadrature bound
  // (`quadratureBeatsMonteCarlo`): an inner level of an iterated integral pays
  // this fallback once per OUTER node, so 1e7 samples of a stalled-but-accurate
  // result is minutes spent making the answer worse. See `compileIntegrate`.
  integrate: (
    fn: (x: number) => number,
    a: number,
    b: number,
    // Equal panels the adaptive loop starts from. The emitter passes this for
    // an integral whose tree shows nesting: one full inner quadrature runs per
    // outer panel node, so the starting count multiplies across levels and a
    // per-level default of 16 costs 16^depth before any refinement. Omitted for
    // a single integral, which keeps the quadrature default.
    initialPanels?: number
  ) => {
    // Dynamic nesting is bounded by a shared evaluation budget — see
    // `NESTED_QUADRATURE_BUDGET`. A nested entry that finds it gone has no
    // value to report.
    if (!enterIntegral()) return NaN;
    try {
      const f = budgetedIntegrand(realFn(fn));
      const r = adaptiveQuadrature(f, a, b, { initialPanels });
      // A diagnosed divergence has no finite value, and sampling it would only
      // launder the divergence into a plausible-looking number.
      if (r.divergent) return NaN;
      // The budget ran out somewhere below this level, so the panels this
      // quadrature accumulated rest on refused evaluations: the estimate is not
      // an estimate of anything. Answer `NaN` directly rather than falling
      // through — the Monte-Carlo fallback would spend 1e7 samples on the same
      // exhausted integrand.
      if (nestedEvalsLeft < 0) return NaN;
      if (r.converged || quadratureBeatsMonteCarlo(r, 10e6)) return r.estimate;
      return monteCarloEstimate(f, a, b, 10e6).estimate;
    } finally {
      activeIntegrals--;
    }
  },
  // Definite integral via Monte-Carlo (1e7 uniform samples). STOCHASTIC and
  // approximate (~1e-4 typical error, ~200 ms/call). Emitted when
  // `quadrature: 'monte-carlo'` is requested — see `compileIntegrate`.
  integrateMC: (fn: (x: number) => number, a: number, b: number) => {
    // Monte Carlo joins the same activation accounting as `integrate`, so that
    // an integral reached from inside THIS one's integrand is nested and pays
    // budget. Without the activation, every sample looked like an outermost
    // entry and re-armed the budget, leaving that composition unbounded.
    // The sample count itself is free at the OUTERMOST level: `budgetedIntegrand`
    // charges an evaluation only while another integral is already running, so a
    // plain Monte-Carlo integral spends none of its 2²⁵ budget on its own 1e7
    // samples — exactly how the deterministic path treats depth. A Monte-Carlo
    // integral running INSIDE another integral does charge per sample, which
    // exhausts the budget within a few calls; that is the intent, since one such
    // level costs 1e7 evaluations of an integrand that is itself a quadrature.
    if (!enterIntegral()) return NaN;
    try {
      const f = budgetedIntegrand(realFn(fn));
      const estimate = monteCarloEstimate(f, a, b, 10e6).estimate;
      // The budget ran out below this level, so an unknown share of the samples
      // were refused rather than evaluated: the mean of what is left is not an
      // estimate of this integral.
      if (nestedEvalsLeft < 0) return NaN;
      return estimate;
    } finally {
      activeIntegrals--;
    }
  },
  lcm,
  lngamma: gammaln,
  limit: (f: (x: number) => number, x: number, dir?: number): number =>
    limit(realFn(f), x, dir),
  mean: oneDatumOk(mean),
  median: oneDatumOk(median),
  variance: oneDatumOk(variance),
  populationVariance: oneDatumOk(populationVariance),
  standardDeviation: oneDatumOk(standardDeviation),
  populationStandardDeviation: oneDatumOk(populationStandardDeviation),
  kurtosis: oneDatumOk(kurtosis),
  skewness: oneDatumOk(skewness),
  mode: oneDatumOk(mode),
  quartiles: oneDatumOk(quartiles),
  interquartileRange: oneDatumOk(interquartileRange),
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
  // The complex sign `z/|z|`: the point of the unit circle in the direction
  // of `z`, and `0` for `0` — the interpreter's `Sign` off the real line. A
  // real value in `{re, im: 0}` form reads its modulus as `Math.abs`
  // (`complexModulus`), so its sign is exactly ±1; otherwise the components
  // are scaled by the larger one first, so a direction near the top of the
  // double range is not lost to an overflowing modulus.
  csign: (z: ComplexResult): ComplexResult => {
    if (Number.isNaN(z.re) || Number.isNaN(z.im)) return { re: NaN, im: NaN };
    if (z.im === 0) {
      const m = complexModulus(z);
      return m === 0 ? { re: 0, im: 0 } : { re: z.re / m, im: 0 };
    }
    const s = Math.max(Math.abs(z.re), Math.abs(z.im));
    const a = z.re / s;
    const b = z.im / s;
    const m = Math.hypot(a, b);
    return { re: a / m, im: b / m };
  },
  // Base-10 and base-2 complex logarithms. The real part is `Math.log10` /
  // `Math.log2` of the MODULUS rather than `ln|z| / ln(b)`: on the real axis
  // the modulus is the argument itself, so this lane, the real lane's
  // `Math.log10(x)` and the interpreter's constant fold agree bit for bit
  // (Tycho item 240). The imaginary part is the argument of `z` rescaled,
  // exactly as `cln(z).im / ln(b)` was. A purely real operand reads its
  // modulus as `Math.abs` — `Math.hypot(x, 0)` is not guaranteed to return
  // `|x|` exactly.
  clog10: (z: ComplexResult) => ({
    re: Math.log10(complexModulus(z)),
    im: Math.atan2(z.im, z.re) / Math.LN10,
  }),
  clog2: (z: ComplexResult) => ({
    re: Math.log2(complexModulus(z)),
    im: Math.atan2(z.im, z.re) / Math.LN2,
  }),
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
  // Ring operation, not a kernel: no roundoff chop (see `toRI`).
  cconj: (z: ComplexResult) => ({ re: z.re, im: -z.im }),
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
  // Which helpers get the iteration cap, and what it counts.
  //
  // The cap exists to turn a walk that can NEVER FINISH into the interpreter's
  // iteration-limit error instead of a hang. That danger is a property of the
  // helper, not of the source being infinite, and it comes in two shapes:
  //
  //  - A helper that can spin WITHOUT EMITTING. `filterIter` advances its
  //    source until the predicate matches, so an infinite source with a
  //    predicate that never matches loops inside `filterIter` forever. Capped
  //    — but on pulls SINCE THE LAST YIELD, not on pulls in total: a filter
  //    that keeps yielding has proved it is not stuck, and is bounded by
  //    whatever consumes it. Counting productive pulls made
  //    `Take(Filter(1..∞, _ > 0), 1025)` throw at the default limit of 1024
  //    for a walk that rejects nothing.
  //  - A helper that MATERIALIZES an unbounded result. `takeWhileIter` builds
  //    an array and stops only when the predicate turns false, so a predicate
  //    that never does yields forever into memory. Nothing else bounds it —
  //    unlike `takeIter` it has no count — so it is capped on TOTAL pulls, and
  //    that total is what limits the size of the result it returns.
  //  - `takeIter` pulls at most `k` elements, and `dropIter` skips exactly `k`
  //    before yielding. `k` is a resolved SAFE INTEGER (`intCount` above has
  //    already rejected non-finite and out-of-range counts, which return the
  //    empty walk), so both loops provably terminate. NOT capped: `k` is the
  //    caller's explicit, finite request, and the interpreter honours it in
  //    full — `Sum(Take(Map(_ ↦ _², 1..∞), 100000))` answers 333338333350000
  //    there, where a capped `takeIter` threw at the default limit of 1024,
  //    and `Take(Drop(1..∞, 2000), 3)` answers [2001, 2002, 2003] where a
  //    capped `dropIter` threw. An unbounded stage UPSTREAM of either still
  //    fails as it should, because that stage carries its own cap.
  return {
    // Predicate TRUTHINESS, matching the eager `Filter` lowering
    // (`.filter((_x) => _f(_x))`).
    filterIter: function* (it, p) {
      // Counted since the last element was YIELDED, not in total — see the
      // note above `intCount`. Only an unbroken run of rejections is a walk
      // that can never finish; a filter that keeps yielding is bounded by its
      // consumer, and counting its productive pulls made
      // `Take(Filter(1..∞, _ > 0), 1025)` throw at the default limit of 1024
      // for a walk that rejects nothing. Mirrors the interpreter's `Filter`
      // iterator (`library/collections.ts`).
      let sinceYield = 0;
      for (const x of it) {
        if (p(x)) {
          sinceYield = 0;
          yield x;
        } else if (++sinceYield > ce.iterationLimit) throw exceeded('Filter');
      }
    },
    // A negative count drops nothing (`Drop(xs, -2)` is `xs`, matching the
    // eager lowering's clamp and the interpreter).
    dropIter: function* (it, n) {
      const k = intCount(n);
      if (k === null) return;
      let dropped = 0;
      for (const x of it) {
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
      for (const x of it) {
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
/**
 * The D3 ENTRY CHECK of a compiled JavaScript runner (design §8 D3,
 * `docs/COMPILATION-MODEL.md`): the one runtime input the
 * static analysis cannot see is the value a caller binds at `run()` time, so
 * each free symbol (expression route) or positional parameter (lambda route)
 * is checked against the SHAPE the compilation analyzed it as:
 *
 * - analyzed REAL: a `{re, im}` object THROWS a `TypeError` naming the symbol
 *   — the compiled code reads it as a number, and every arithmetic on it
 *   would be silently wrong (`NaN`, or `"[object Object]1"` under `+`). The
 *   one exception is the unsigned pole `~oo`, which is PROJECTED to
 *   `Infinity` instead of throwing (see `isUnsignedPole` below);
 * - analyzed COMPLEX (a `complex`-typed symbol or annotated parameter): a
 *   plain number is LIFTED to `{re, im: 0}` — a real IS a complex, and the
 *   compiled code reads `.re`/`.im` off it;
 * - analyzed as a LIST (a binding whose declared type proves a JS array): a
 *   plain `Array` passes as it is, with no copy, and a numeric typed array
 *   (`Float64Array`, `Int32Array`, ...) is COPIED into a fresh plain `Array`,
 *   because the compiled body reads plain arrays only. Any other value passes
 *   UNTOUCHED and the lowerings dispatch on its runtime shape, as before: a
 *   scalar there is not an error, because the declared type is routinely wider
 *   than the value a caller binds and several lowerings project on the runtime
 *   shape. The element-wise big-operator lane is the witness — a `list`-typed
 *   summand bound to a number gives the scalar sum, not `NaN` (see
 *   `test/compute-engine/compile-elementwise-bigop.test.ts`). Carrier contract:
 *   `docs/plans/2026-09-07-numeric-list-store-and-typed-array-boundary.md`;
 * - anything else (a string, a boolean, an array, `undefined`) is left to
 *   today's behavior.
 *
 * One `typeof` per checked binding per call. The vars object is never mutated
 * (a lifted copy is built only when a lift or a typed-array copy is needed).
 */
type EntryPlan =
  | { kind: 'vars'; real: string[]; complex: string[]; lists: string[] }
  | { kind: 'args'; real: number[]; complex: number[]; lists: number[] };

const isComplexObject = (v: unknown): v is ComplexResult =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as ComplexResult).re === 'number' &&
  typeof (v as ComplexResult).im === 'number';

/**
 * Whether a `{re, im}`-shaped value is the interpreter's UNSIGNED pole `~oo`
 * (`ComplexInfinity`) rather than a genuine complex number. The interpreter
 * carries `~oo` as a complex value with an infinite part and a NON-ZERO
 * imaginary part — `ComplexInfinity` itself reads `{re: ∞, im: ∞}`, and any
 * complex it builds with an infinite part collapses to `~oo` as well
 * (`Complex(3, ∞)` types `~oo`). A signed real infinity keeps `im === 0` and
 * so is not matched here; neither is a finite complex such as `3 + 4i`.
 *
 * This mirrors the `isInfinity && im !== 0` test the compiler already uses to
 * recognize `~oo` when it FOLDS a constant subtree (`tryConstantFold` in
 * base-compiler.ts), so the two routes agree on what counts as a pole.
 */
const isUnsignedPole = (v: ComplexResult): boolean =>
  v.im !== 0 &&
  (v.re === Infinity ||
    v.re === -Infinity ||
    v.im === Infinity ||
    v.im === -Infinity);

function entryCheckError(binding: string): TypeError {
  return new TypeError(
    `${binding} was compiled as a real number but received a complex {re, im} value. Declare it complex, or compile with \`mode: 'complex'\`.`
  );
}

/**
 * The brands (`Object.prototype.toString` tags) of the typed arrays whose
 * elements read as JavaScript numbers. A `DataView` is not listed (it has no
 * indexed elements at all) and neither are the two `BigInt` views (their
 * elements read as `bigint`, which the compiled arithmetic cannot mix with
 * numbers).
 */
const NUMERIC_TYPED_ARRAY_BRANDS = new Set([
  '[object Int8Array]',
  '[object Uint8Array]',
  '[object Uint8ClampedArray]',
  '[object Int16Array]',
  '[object Uint16Array]',
  '[object Int32Array]',
  '[object Uint32Array]',
  '[object Float16Array]',
  '[object Float32Array]',
  '[object Float64Array]',
]);

/**
 * Whether `v` is a typed array of NUMBERS — a view on an `ArrayBuffer` whose
 * elements read as JavaScript numbers. The test is the object's brand, not
 * `instanceof`: a view built in another realm (an iframe, a Node `vm`
 * context) has a different constructor, so `instanceof DataView` would let
 * a foreign `DataView` or `BigInt64Array` through as numeric.
 */
const isNumericTypedArray = (v: unknown): v is ArrayLike<number> =>
  ArrayBuffer.isView(v) &&
  NUMERIC_TYPED_ARRAY_BRANDS.has(Object.prototype.toString.call(v));

/**
 * A fresh plain `Array` holding the elements of a numeric typed array.
 *
 * The copy is an index loop on purpose: `Array.from` on a typed array goes
 * through the iterator protocol, and on a 40 000-element `Float64Array` it
 * measured about nine times slower than this loop.
 */
function copyToPlainArray(x: ArrayLike<number>): number[] {
  const n = x.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = x[i];
  return out;
}

function checkEntry(plan: EntryPlan, argumentsList: unknown[]): unknown[] {
  if (plan.kind === 'vars') {
    const vars = argumentsList[0];
    if (typeof vars !== 'object' || vars === null) return argumentsList;
    const v = vars as Record<string, unknown>;
    let lifted: Record<string, unknown> | undefined;
    // A `~oo` argument is PROJECTED to `Infinity` rather than refused: the
    // compiled body has no value for the unsigned pole, and `Infinity` is the
    // spelling it already gives a pole it PRODUCES itself, so projecting here
    // gives one pole one spelling on both routes. The projection keeps the
    // magnitude and drops the direction `~oo` never had — the same trade the
    // constant-folding path makes for an embedded `~oo` literal. Every other
    // complex value still throws: reading `3 + 4i` as a number would be
    // silently wrong, while reading `~oo` as `Infinity` is the documented
    // float encoding of it.
    for (const id of plan.real) {
      const x = v[id];
      if (!isComplexObject(x)) continue;
      if (!isUnsignedPole(x)) throw entryCheckError(`"${id}"`);
      lifted ??= { ...v };
      lifted[id] = Infinity;
    }
    for (const id of plan.complex) {
      const x = v[id];
      if (typeof x === 'number') {
        lifted ??= { ...v };
        lifted[id] = { re: x, im: 0 };
      }
    }
    // A numeric typed array on a list-declared symbol is copied into a plain
    // one, which is what the compiled body reads. Every other value passes
    // untouched, including a scalar: the lowerings dispatch on the runtime
    // shape, so a narrower declaration is not enforced here.
    for (const id of plan.lists) {
      const x = v[id];
      if (!isNumericTypedArray(x)) continue;
      lifted ??= { ...v };
      lifted[id] = copyToPlainArray(x);
    }
    return lifted === undefined ? argumentsList : [lifted];
  }
  let lifted: unknown[] | undefined;
  // The positional-parameter route makes the same `~oo` projection as the
  // free-symbol route above.
  for (const i of plan.real) {
    const x = argumentsList[i];
    if (!isComplexObject(x)) continue;
    if (!isUnsignedPole(x)) throw entryCheckError(`argument ${i + 1}`);
    lifted ??= [...argumentsList];
    lifted[i] = Infinity;
  }
  for (const i of plan.complex) {
    const x = argumentsList[i];
    if (typeof x === 'number') {
      lifted ??= [...argumentsList];
      lifted[i] = { re: x, im: 0 };
    }
  }
  // The positional-parameter route applies the same list rule as the
  // free-symbol route above.
  for (const i of plan.lists) {
    const x = argumentsList[i];
    if (!isNumericTypedArray(x)) continue;
    lifted ??= [...argumentsList];
    lifted[i] = copyToPlainArray(x);
  }
  return lifted ?? argumentsList;
}

/**
 * The compiled JavaScript runner's RESULT CONVENTION (design §5,
 * `docs/COMPILATION-MODEL.md`), applied at the boundary
 * of every `run()` call: a value whose imaginary part is EXACTLY zero comes
 * back as a plain `number`; otherwise as `{re, im}`. Both directions are
 * guaranteed — a returned `ComplexResult` always has `im !== 0`, and a real
 * value is never returned as `{re, im: 0}` — so a consumer's per-sample test
 * is the single `typeof v === 'number'`, and a `{re, im}` with a non-zero
 * imaginary part tells "outside the real domain" from a genuine `NaN`.
 * Booleans pass through (never coerced), and so does anything else; a
 * collection is normalized element by element (a fresh array — the compiled
 * value may alias caller data).
 *
 * The test is EXACT, not a chop: the transcendental kernels remove their own
 * roundoff dust (`toRI`), and chopping here would violate the "never chop in
 * ring arithmetic" rule (`1 + 1e-12i` is `{re: 1, im: 1e-12}`).
 */
function normalizeRunResult(r: unknown): unknown {
  if (typeof r === 'number' || typeof r === 'boolean') return r;
  if (Array.isArray(r)) {
    // A number or boolean element copies through as it is; only another
    // shape is normalized recursively. The recursive `map` this replaced
    // was a full pass through a function call per element, which on a
    // 40 000-element result cost as much as the computation it followed
    // (Tycho item 264).
    const n = r.length;
    const out: unknown[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const x = r[i];
      out[i] =
        typeof x === 'number' || typeof x === 'boolean'
          ? x
          : normalizeRunResult(x);
    }
    return out;
  }
  if (
    typeof r === 'object' &&
    r !== null &&
    typeof (r as ComplexResult).re === 'number' &&
    typeof (r as ComplexResult).im === 'number' &&
    (r as ComplexResult).im === 0
  )
    return (r as ComplexResult).re;
  // A complex cell is returned as a FRESH object: the value may be part of a
  // definition the runner evaluated once and keeps for every later call
  // (`twoStageRunner`), and a caller writing to the returned object's `re`
  // must not change what the next call answers.
  if (isComplexObject(r)) return { re: r.re, im: r.im };
  return r;
}

/**
 * A pattern that matches the emitted identifier `name` as a whole word: not
 * preceded by an identifier character or a `.` (so a member `obj.name` and
 * a longer identifier `_name` do not match) and not followed by an
 * identifier character (so `name$b`, the broadcast wrapper of `name`, does
 * not match either). Textual, like every test in this preamble analysis: an
 * emitted definition is a string by the time it is classified.
 */
function identifierPattern(name: string, flags = 'u'): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w$.])${escaped}(?![\\w$])`, flags);
}

/** A read of the vars object, `_.<id>` — the one spelling the emitted code
 * uses for a per-call binding on the expression route (`varsObjectAccess`). */
const VARS_OBJECT_READ = /(?<![\w$])_\.(?=[\p{L}_$])/u;

/**
 * The smallest emitted body, in characters, that a last-call memo wraps.
 *
 * Below this size the memo LOSES: the JavaScript engine inlines a small
 * definition at each call site and then shares its pure subexpressions
 * across the two inlined copies itself, while the wrapper's closure state
 * and branches keep it from inlining at all. Measured 2026-09-09 on
 * `g(x) := f(x) + 1` with `g(x) + f(x)` at the root, `f` a sum of `k` sine
 * terms, per sample through the compiled runner (through a module-level
 * splice in parentheses): a 346-character body 155 → 256 ns (96 → 147)
 * with the memo; a 682-character body 472 → 412 ns (421 → 285); a 1354-
 * character body 1394 → 673 ns (1191 → 540); the 2 456-character
 * nine-distance block the memo exists for, 3.4 → 2.7 µs on its row. The
 * emitted length stands in for the engine's inlining budget, which is what
 * actually decides; it is the signal this pass has. The vars-object reads a
 * key carries (`memoizedDefinition`) cost one type test and one comparison
 * each and do not move the threshold: with four slider reads, a 710-
 * character body went 351 → 229 ns and a 1382-character body 672 → 389 ns
 * on a quiet box (same shape, 2026-09-09).
 */
const MEMO_MIN_BODY_LENGTH = 600;

/**
 * Wrap, in place in `registry.defs`, every emitted user-function definition
 * that a LAST-CALL MEMO can serve: a closure that remembers the arguments
 * and the result of its most recent call and answers a repeated call with
 * the same arguments from that record. The definition is recorded as a
 * candidate when it is emitted (`userFunctions.memoizable`: pure body,
 * scalar parameters, real lane — `BaseCompiler.lastCallMemoEligible`); this
 * pass adds the two conditions that need the whole artifact.
 *
 * The artifact must call the definition from inside ANOTHER definition, and
 * from two or more places in all — counted as occurrences of its name in
 * the emitted text: the root code, and the definitions other than the
 * definition itself and its own call-site shims (`<name>$b`, `<name>$v`,
 * …). Two calls with the same arguments inside one region are already
 * merged by common-subexpression elimination, which admits pure user-
 * function applications; what CSE cannot merge is a call inside one
 * definition and the same call in the code that also calls that definition
 * — `m(x, y)` inside `m2`, and again in the row that calls `m2(x, y)` —
 * and that is the shape the memo answers. A definition called from the
 * root only, or only by itself, is emitted exactly as before: for it the
 * memo would add its checks to every call and answer none. So is a
 * definition whose emitted body is shorter than `MEMO_MIN_BODY_LENGTH`:
 * a hit on it could not save more than a miss costs.
 *
 * And the record must be keyed on everything the definition's value depends
 * on. The memo state lives in the definition's closure, so it lives as long
 * as the preamble does: once per call of a compiled runner, but as long as
 * the module when a consumer splices `preamble` at module level and calls
 * `code` many times. A body that reads the vars object (`_.<id>` on the
 * expression route — a Desmos slider reaches a compiled row this way) could
 * then answer a call from a record made under a different value of that
 * binding. So every vars-object read the definition makes, directly or
 * through a definition it calls, joins the record's key next to the
 * arguments: one more comparison per read, and a slider moved between two
 * calls — or reassigned by a compiled `Assign` between two calls of the same
 * artifact — misses the record. A read whose value is not a number, a
 * string or a boolean bypasses the memo like such an argument does. A
 * lambda parameter (the function-literal route) has no such key: a folded
 * symbol value that reads one is per-call by construction, and a
 * definition that references such a value is left alone. Both dependencies
 * are found textually, the same way `splitPreambleDefs` classifies a
 * definition as per-call, and closed through other definitions by
 * iterating to a fixed point, because a mutually recursive pair is emitted
 * in an order where the earlier one references the later one. (A folded
 * symbol value that reads no per-call binding, `_val_<id>`, is emitted into
 * the same preamble as the memo, so the two are always evaluated together
 * and cannot disagree.)
 *
 * The wrapper keeps the definition's name, arity, and `const` declaration
 * — every call site, broadcast dispatch (`_SYS.bcastFn(_fn_f, …)`), and
 * value-position use is unchanged. Its private names carry a `$memo`
 * suffix; `$` cannot appear in a MathJSON symbol, so they collide with no
 * emitted name.
 */
function memoizeSharedDefinitions(
  registry: NonNullable<CompileTarget<Expression>['userFunctions']>,
  rootCode: string,
  perCallIdentifiers: ReadonlyArray<string>,
  varsObject: boolean,
  statements: ReturnType<typeof javascriptStatements>
): void {
  const memoizable = registry.memoizable;
  if (memoizable === undefined || memoizable.size === 0) return;
  const defs = registry.defs;
  // A user-function definition (every name allocated under the `_fn_`
  // prefix: a definition, a call-site shim, an eta-expanded built-in) is
  // compiled against the root target and can never read a lambda parameter;
  // only a folded symbol value (`_val_<id>`) can, and then only on the
  // function-literal route, whose preamble sits inside the lambda body.
  // Testing a definition's text against the parameter names would mark
  // `f(x) := …` varying under `x ↦ f(x)` because of its own parameter `x`.
  const userFunctionNames = new Set<string>();
  for (const [key, name] of registry.names ?? [])
    if (key.startsWith('_fn_')) userFunctionNames.add(name);
  const parameterReaders = perCallIdentifiers.map((n) => identifierPattern(n));
  const readsLambdaParameter = (name: string, code: string): boolean =>
    !userFunctionNames.has(name) && parameterReaders.some((r) => r.test(code));
  const patterns = new Map<string, RegExp>();
  for (const name of defs.keys()) patterns.set(name, identifierPattern(name));
  // Per definition, the vars-object bindings its value depends on, and the
  // definitions whose value depends on a lambda parameter — each closed under
  // "references such a definition".
  const varsReads = new Map<string, Set<string>>();
  for (const [name, code] of defs)
    varsReads.set(name, varsObject ? varsObjectReads(code) : new Set());
  const varying = new Set<string>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const [name, code] of defs) {
      if (!varying.has(name)) {
        const reads =
          readsLambdaParameter(name, code) ||
          [...varying].some((v) => patterns.get(v)!.test(code));
        if (reads) {
          varying.add(name);
          changed = true;
        }
      }
      const own = varsReads.get(name)!;
      for (const [other, theirs] of varsReads) {
        if (other === name || theirs.size === 0) continue;
        if (!patterns.get(other)!.test(code)) continue;
        for (const id of theirs)
          if (!own.has(id)) {
            own.add(id);
            changed = true;
          }
      }
    }
  }
  const count = (text: string, pattern: RegExp): number =>
    (text.match(pattern) ?? []).length;
  for (const [name, entry] of memoizable) {
    if (!defs.has(name) || varying.has(name)) continue;
    if (entry.body.length < MEMO_MIN_BODY_LENGTH) continue;
    const pattern = identifierPattern(name, 'gu');
    let inDefinitions = 0;
    for (const [other, code] of defs) {
      if (other === name || other.startsWith(`${name}$`)) continue;
      inDefinitions += count(code, pattern);
    }
    if (inDefinitions === 0) continue;
    if (inDefinitions + count(rootCode, pattern) < 2) continue;
    defs.set(
      name,
      memoizedDefinition(name, entry, statements, [
        ...varsReads.get(name)!,
      ])
    );
  }
}

/**
 * The names read off the vars object in emitted `code` — every `_.<id>`,
 * the spelling `varsObjectAccess` emits (its guarded form for a name that
 * collides with an `Object.prototype` member contains the same member
 * access). In first-occurrence order, so the record's key is stable.
 *
 * The name is a whole JavaScript identifier name — `ID_Start` then
 * `ID_Continue` characters, plus `$` and the zero-width joiners the language
 * admits — because that is what the emitter wrote after `_.`. A MathJSON
 * symbol may carry a combining mark (`q̇` is `q` and U+0307, an
 * `ID_Continue` character that `\w` does not match); a match that stopped
 * there would key `_.q̇` on `_.q`.
 */
function varsObjectReads(code: string): Set<string> {
  const names = new Set<string>();
  for (const m of code.matchAll(
    /(?<![\w$])_\.([\p{ID_Start}_$][\p{ID_Continue}$\u200c\u200d]*)/gu
  ))
    names.add(m[1]);
  return names;
}

/**
 * The emitted text of the last-call memo around a definition (see
 * `memoizeSharedDefinitions`). The body is emitted INSIDE the wrapper, not
 * as an inner function it calls: the call indirection alone cost as much as
 * the memo's checks (measured on `f(x) := 2x + 1`, 2026-09-09). On a call:
 *
 *  - an argument that is not a number, a string or a boolean — an array (a
 *    broadcast element, a point, a collection) or a `{re, im}` record, which
 *    compare by identity and may be mutated by the runtime helpers, and
 *    `undefined`, which the empty record would match — bypasses the memo:
 *    the body runs and nothing is recorded (one `typeof` per argument on a
 *    number, the common case);
 *  - the arguments are compared to the recorded ones by value, with `NaN`
 *    matching `NaN` (a `NaN` input recurs in plotting, and `===` alone
 *    would silently defeat the memo there) and `0` NOT matching `-0` (`1/x`
 *    differs on them; the sign is tested only once `===` has matched a
 *    zero, so a miss pays nothing for it);
 *  - a result that is an object or a function is not recorded either, for
 *    the same identity reason (a function may carry properties its consumer
 *    adds), so the record only ever holds a number, a boolean, a string or
 *    `undefined`.
 *
 * The vars-object bindings the definition's value depends on (`reads`, see
 * `memoizeSharedDefinitions`) are part of the key exactly like the
 * arguments: read through `varsObjectAccess`, tested for the same three
 * primitive kinds, compared the same way, recorded with the arguments. The
 * wrapper reads each of them once at entry, on every call, whether or not
 * the body would read it on that call (a binding read only in an
 * unselected branch is read all the same) — the same one read per binding
 * per call the runner's entry check performs (`CompileOptions.entryChecks`).
 *
 * The record is written only after the body has produced its value, so a
 * recursive definition never reads a half-written record: a self-call sees
 * the record of the last call that COMPLETED, which is a correct answer for
 * its arguments. The recorded arguments start `undefined`, which never
 * matches a number, so no flag is needed for "no record yet".
 *
 * A multi-statement body (CSE temporaries in a block, a `Block` body) is
 * registered with the statement emitter; its exits — every `return` — are
 * rewritten to record before returning, through the same `exit` mechanism
 * that turns the body into a function body. Every local of the wrapper is
 * declared with `let`: a test that counts `const <name>` occurrences must
 * keep counting one.
 */
function memoizedDefinition(
  name: string,
  entry: { params: ReadonlyArray<string>; body: string },
  statements: ReturnType<typeof javascriptStatements>,
  reads: ReadonlyArray<string>
): string {
  const params = entry.params.join(', ');
  // The key: the arguments, then the vars-object bindings the value depends
  // on. A binding is read once into a local so the test and the record see
  // the same value.
  const bindings = reads.map((id, i) => `${name}$memo_b${i}`);
  const keyed = [...entry.params, ...bindings];
  const keys = keyed.map((_, i) => `${name}$memo_k${i}`);
  const value = `${name}$memo_v`;
  const scalar = `${name}$memo_s`;
  const result = `${name}$memo_r`;
  const bind = reads
    .map((id, i) => `let ${bindings[i]} = ${varsObjectAccess(id)}; `)
    .join('');
  const isScalar = keyed
    .map(
      (p) =>
        `(typeof ${p} === 'number' || typeof ${p} === 'string' || typeof ${p} === 'boolean')`
    )
    .join(' && ');
  const hit = keyed
    .map(
      (p, i) =>
        `(${p} === ${keys[i]} ? (${p} !== 0 || 1 / ${p} === 1 / ${keys[i]}) : ` +
        `(${p} !== ${p} && ${keys[i]} !== ${keys[i]}))`
    )
    .join(' && ');
  const record = keyed.map((p, i) => `${keys[i]} = ${p}; `).join('');
  const exit = (v: string): string =>
    `{ let ${result} = ${v}; ` +
    `if (${scalar} && typeof ${result} !== 'object' && typeof ${result} !== 'function') { ${record}${value} = ${result}; } ` +
    `return ${result}; }`;
  const body = statements?.has(entry.body)
    ? statements.emit(entry.body, exit)
    : exit(entry.body);
  return (
    `const ${name} = (() => { let ${[...keys, value].join(', ')}; ` +
    `return (${params}) => { ${bind}let ${scalar} = ${isScalar}; ` +
    `if (${scalar} && ${hit}) return ${value}; ` +
    `${body} }; })();`
  );
}

/**
 * The preamble definitions of a compilation split into the ones the runner
 * may evaluate ONCE per compiled artifact (`hoisted`) and the ones that must
 * run on every call (`perCall`), each in emission order.
 *
 * A definition is hoisted when all of the following hold: the compiler
 * recorded it as built from its own lowerings only
 * (`userFunctions.hoistable` — a folded symbol value with no caller-supplied
 * source and no string-valued `vars` mapping in it; a user-function
 * definition is never on that set and always stays per call); its code reads
 * no per-call binding — on the expression route the vars object, which the
 * emitted code reads only as `_.<id>` (`varsObjectAccess`, the one spelling
 * looked for when `varsObject` is set); on the lambda route a parameter,
 * read as a bare identifier (`perCallIdentifiers`, which may include a
 * parameter literally named `_`); and it references no per-call definition
 * by name. Definitions are emitted after everything they reference, so
 * walking them in order settles the dependency, and the two lists keep
 * their relative order. A false positive of a textual test only keeps a
 * definition per call, which is the behavior every definition had before.
 *
 * Rebuilding a call-invariant value per call repeated its whole
 * construction: a board built by a 22 500-element comprehension was rebuilt
 * on every sampled pixel of a plot that only indexed into it.
 */
function splitPreambleDefs(
  registry: NonNullable<CompileTarget<Expression>['userFunctions']>,
  perCallIdentifiers: ReadonlyArray<string>,
  varsObject: boolean
): { hoisted: string; perCall: string } {
  const defs = registry.defs;
  if (defs.size === 0) return { hoisted: '', perCall: '' };
  const identifier = (name: string): RegExp => identifierPattern(name);
  const readers = perCallIdentifiers.map(identifier);
  if (varsObject) readers.push(VARS_OBJECT_READ);
  const perCallDefNames: RegExp[] = [];
  const hoisted: string[] = [];
  const perCall: string[] = [];
  for (const [name, code] of defs) {
    const stays =
      registry.hoistable?.has(name) !== true ||
      readers.some((r) => r.test(code)) ||
      perCallDefNames.some((r) => r.test(code));
    if (stays) {
      perCall.push(code);
      perCallDefNames.push(identifier(name));
    } else hoisted.push(code);
  }
  return {
    hoisted: hoisted.length > 0 ? hoisted.join('\n') + '\n' : '',
    perCall: perCall.length > 0 ? perCall.join('\n') + '\n' : '',
  };
}

/**
 * The two-stage form of a compiled runner. `hoisted` is evaluated ONCE, when
 * the runner is built, in a scope that sees `_SYS` and nothing per call; the
 * inner function it returns runs on every call with the per-call preamble
 * and the body. A folded symbol value that reads no per-call binding is the
 * same on every call (`splitPreambleDefs`), and a plot that sampled `S[k]`
 * once per pixel rebuilt the whole 22 500-element `S` on each sample before
 * the split. Any error the hoisted stage raises is raised here, at
 * construction, instead of on the first call. The caller's own `preamble`
 * option is never part of `hoisted`: it is arbitrary source that may read
 * the vars object under another spelling, draw randomness, or hold per-call
 * state, so it keeps running on every call.
 */
function twoStageRunner(
  sys: SysHelpers,
  hoisted: string,
  params: string[],
  perCallCode: string
): (...args: unknown[]) => unknown {
  const stage = new Function(
    '_SYS',
    `${hoisted}return function (${params.join(', ')}) { ${perCallCode} };`
  ) as (sys: SysHelpers) => (...args: unknown[]) => unknown;
  return stage(sys);
}

export class ComputeEngineFunction extends Function {
  SYS: SysHelpers;

  constructor(
    ce: ComputeEngine,
    body: string,
    perCall = '',
    entry?: EntryPlan,
    hoisted = '',
    statementBody?: string
  ) {
    const perCallCode = `${perCall}${perCall ? ';' : ''}${statementBody ?? `return ${body}`}`;
    super('_SYS', '_', perCallCode);
    this.SYS = makeSysHelpers(ce);
    const inner = hoisted
      ? twoStageRunner(this.SYS, hoisted, ['_'], perCallCode)
      : undefined;
    return new Proxy(this, {
      apply: (target, thisArg, argumentsList) => {
        const args = entry ? checkEntry(entry, argumentsList) : argumentsList;
        return normalizeRunResult(
          inner !== undefined
            ? inner.apply(thisArg, args)
            : super.apply(thisArg, [this.SYS, ...args])
        );
      },
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

  constructor(
    ce: ComputeEngine,
    body: string,
    args: string[],
    perCall = '',
    entry?: EntryPlan,
    hoisted = '',
    statementBody?: string
  ) {
    const perCallCode = `${perCall}${statementBody ?? `return ${body}`}`;
    super('_SYS', ...args, perCallCode);
    this.SYS = makeSysHelpers(ce);
    const inner = hoisted
      ? twoStageRunner(this.SYS, hoisted, args, perCallCode)
      : undefined;
    // The serialized form is self-contained: every definition, hoisted or
    // not, in emission order inside the single body.
    const preamble = hoisted + perCall;
    return new Proxy(this, {
      apply: (target, thisArg, argumentsList) => {
        const callArgs = entry
          ? checkEntry(entry, argumentsList)
          : argumentsList;
        return normalizeRunResult(
          inner !== undefined
            ? inner.apply(thisArg, callArgs)
            : super.apply(thisArg, [this.SYS, ...callArgs])
        );
      },
      get: (target, prop) => {
        if (prop === 'toString')
          return (): string =>
            statementBody
              ? `(${args.join(', ')}) => { ${preamble}${statementBody} }`
              : preamble
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
    const target: CompileTarget<Expression> = {
      language: 'javascript',
      operators: (op) => JAVASCRIPT_OPERATORS[op],
      functions: (id) => JAVASCRIPT_FUNCTIONS[id],
      constant: (id) => JAVASCRIPT_CONSTANTS[id],
      collectionAwareHeads: JS_COLLECTION_AWARE_HEADS,
      // Free symbols read through the vars object bound to `_` (see the
      // `_.<id>` emissions below), so a lambda parameter spelled `_` must not
      // shadow it — see `CompileTarget.varsObjectName`.
      varsObjectName: '_',
      // Baked as a literal token by every helper lowering; a parameter
      // spelled this way shadows it for its whole body — see
      // `CompileTarget.reservedEmittedNames`.
      reservedEmittedNames: JS_RESERVED_EMITTED_NAMES,
      var: (id) => {
        const result = JAVASCRIPT_CONSTANTS[id];
        return result;
      },
      string: (str) => JSON.stringify(str),
      // A character lowers to the one-cluster JS string it denotes. This target
      // can honour the rest of the character contract too: `_SYS.chars`
      // segments a string into clusters and `_SYS.cmpc` orders two of them by
      // code-point sequence, so declaring the capability here is not merely
      // "it has string literals".
      character: (str) => JSON.stringify(str),
      number: (n) => n.toString(),
      complex: (re, im) => `({ re: ${re}, im: ${im} })`,
      // Keep an expression spelling for consumers that need one, together
      // with a statement form for function bodies and local initializers.
      bindExpr: (bindings, body) =>
        javascriptStatements(target)?.parameters(bindings, body) ??
        `((${bindings.map(([name]) => name).join(', ')}) => ${body})(${bindings.map(([, code]) => code).join(', ')})`,
      // Dependency-ordered CSE temporaries: a sequential-`const` IIFE, so a
      // later right-hand side — and the body — can reference an earlier temp.
      // Flat: no nesting growth with the candidate count.
      cseBind: (bindings, body) =>
        javascriptStatements(target)?.bindings(bindings, body) ??
        `(() => { ${bindings.map(([name, code]) => `const ${name} = ${code};`).join(' ')} return ${body}; })()`,
      // Bind an index-free scalar subexpression of a `Sum`/`Product` body once
      // ahead of the loop (or ahead of the unrolled terms) instead of
      // recomputing it per iteration — see `CompileTarget`. A loop body reading
      // `Math.sin(_.x)` at every step evaluated it once per iteration; an
      // unrolled body repeated it once per term.
      hoistScalarInvariants: true,
      // A non-boolean Which/When condition (e.g. NaN) fails closed at run time,
      // matching the interpreter's throw (D6).
      assertBoolean: (code) => `_SYS.cond(${code})`,
      // Element-wise `Which`/`If` selection over a collection-valued condition.
      selection: (args, compile, target, compileUnder) =>
        compileJSSelection(args, compile, target, compileUnder),
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
      // The compile modes this target offers (`CompileMode`), and the two
      // lowering hooks the complex discipline is emitted through: the
      // idempotent number → complex lift (`_SYS.cplx`) and the exact runtime
      // realness test. See `CompileTarget.supportedModes`.
      supportedModes: JS_SUPPORTED_MODES,
      complexLift: (code) => `_SYS.cplx(${code})`,
      complexIsReal: (code) => `_SYS.cisreal(${code})`,
      complexReal: (code) => `_SYS.creal(${code})`,
      complexRealElements: (code) => `_SYS.crealElements(${code})`,
      realGuard: (guards, body, kind) =>
        guards.length === 0
          ? `(${body})`
          : `((${guards.join(' && ')}) ? (${body}) : ${
              kind === 'boolean'
                ? 'false'
                : kind === 'color'
                  ? // The non-finite color, spelled inline with the same five
                    // keys in the same order every color value has, so the
                    // guarded and the failing branch share one hidden class.
                    "{ space: 'oklch', c0: NaN, c1: NaN, c2: NaN, alpha: undefined }"
                  : 'NaN'
            })`,
      // Per-compilation naming state for generated temporaries. Created here —
      // `createTarget()` is called once per compilation — so `tempVar()` numbers
      // `_tv1, _tv2, …` deterministically and two compiles of one expression
      // emit byte-identical source. A boundary that knows the expression passes
      // a context seeded with its collision inventory through `options`.
      naming: { counter: 0, usedNames: new Set<string>() },
      ...options,
    };
    // Fold the literal arithmetic the EMISSION creates, which the tree-level
    // fold cannot see: an unrolled `Sum` substitutes its index at the variable
    // level, so every term carries `(1 + -0.5)` and `_SYS.pow2(0.025 * (1 +
    // -0.5))`. Installed after the spread so a caller's `constantFold: false`
    // — which promises the structural lowering of every constant, and which
    // the code-generation tests rely on — turns this fold off as well.
    if (
      target.constantFold !== false &&
      target.foldEmittedConstant === undefined
    ) {
      const splices = callerSpliceSources(target.varsKeys, target.var);
      target.foldEmittedConstant = (_expr, code) =>
        foldEmittedJavaScriptCode(code, splices);
    }
    return target;
  }

  compile(
    expr: Expression,
    options: CompilationOptions<Expression> = {}
  ): CompilationResult<'javascript'> {
    // A caller reaching a target through `ce._getCompilationTarget(name)` and
    // invoking this method never passes through the standalone `compile()`
    // export, which is where the deprecated pre-`mode` options used to be
    // warned about AND resolved. The options kept WORKING on this route, so
    // the omission was silent — and this is the route an integration takes
    // once it needs a specific target, i.e. the callers with the most sites to
    // migrate. Normalizing here as well is what makes the warning's wording
    // true on this route: it maps
    // `complexPromotion: true` onto `mode: 'complex'` and clears the alias, so
    // the flag can no longer reach `BaseCompiler`'s legacy promotion latch and
    // promote under an explicit `mode: 'strict'`. Warning is once-per-process
    // per key, so a call that also goes through the standalone entry still
    // produces exactly one.
    options = normalizeDeprecatedCompileOptions(
      options,
      JS_SUPPORTED_MODES.includes('complex')
    ).options;
    // The `storage` hints describe shader storage and are IGNORED by this
    // target's lowering — but validated here all the same, outside the
    // fallback `try`: an unknown storage kind or a hint naming something that
    // is not a free symbol is an option-contract error on every target, since
    // off the shader targets the hint leaves no other trace. Guarded so the
    // analysis target is built only when there is something to validate.
    if (options.storage !== undefined)
      resolveStorageHints(options.storage, [expr], this.createTarget(), {
        vars: options.vars,
        functions: options.functions,
      });
    const requestedMode = options.mode;
    try {
      // Under `auto` — requested, or this target's default — a lane mismatch
      // in the strict attempt redoes the compilation under the complex
      // discipline. The escalation sits INSIDE this method, not in the
      // standalone `compile()` export, so both routes into a compilation get
      // it (`auto-escalation.ts`). It wraps `compileOrThrow`, which throws on
      // a decline, so the mismatch reaches the retry rather than being
      // wrapped into the `success: false` fallback built below. Each attempt
      // builds its own target in `compileOrThrow`, so the retry starts from
      // clean per-compilation state.
      return compileWithAutoEscalation(requestedMode, JS_SUPPORTED_MODES, (m) =>
        this.compileOrThrow(
          expr,
          m === requestedMode ? options : { ...options, mode: m }
        )
      );
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
        options.vars ? new Set(Object.keys(options.vars)) : undefined,
        compileDiagnosticOf(e, error)
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
    // Turn a collection whose WIDTH is known at compile time into straight-line
    // scalar code, so this target sees the shape the interpreter computes
    // rather than a runtime array (`fixed-width-unroll.ts`). A head the caller
    // overrode is withheld from the pass: the caller's implementation replaces
    // the emission and receives the node's own operands, which an unroll would
    // change.
    const unrollSkipHeads = overriddenCompilationHeads(
      options.operators,
      options.functions
    );
    expr = unrollFixedWidthCollections(expr, { skipHeads: unrollSkipHeads });
    const {
      operators,
      functions,
      vars,
      imports = [],
      preamble,
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
    // Null-prototype: this table collects CALLER-supplied function overrides
    // and is then indexed by an arbitrary operator name. A plain `{}` would
    // answer for every inherited `Object.prototype` member, so a head named
    // `toString` would read as a user override that the caller never wrote.
    // `Object.values` below is unaffected — it returns own properties only.
    const namedFunctions: { [k: string]: string } = Object.create(null);
    // The subset of `namedFunctions` whose implementation has no observable
    // effect beyond its return value, so an emission that calls it may be
    // skipped at run time (`BaseCompiler.isEmissionSkippable`). Declared by
    // the caller or inferred from the source; see `function-purity.ts`. Null
    // prototype for the same reason `namedFunctions` has one.
    const pureFunctions = new Set<string>();

    if (functions) {
      for (const [k, entry] of Object.entries(functions)) {
        const v = entrySource(entry);
        if (entryIsPure(entry)) pureFunctions.add(k);
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
      // `Object.hasOwn` on the record form: `operators` is CALLER-supplied, so
      // it cannot be given a null prototype, and a bare index would answer
      // with an inherited `Object.prototype` member for a head named after
      // one.
      if (typeof operators === 'function') return operators(op);
      return Object.hasOwn(operators, op)
        ? operators[op as keyof typeof operators]
        : undefined;
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
      complexPromotion: options.complexPromotion,
      // The caller's requested compile mode; validated against
      // `supportedModes` and latched by `BaseCompiler.compile` at depth 0.
      mode: options.mode,
      foldExcludedOps: foldExcludedOps.size > 0 ? foldExcludedOps : undefined,
      // See `CompileTarget.unrollSkipHeads`: the same answer the entry above
      // used, for the definition bodies this entry never sees.
      unrollSkipHeads,
      operators: operatorLookup,
      varsObjectRefs,
      // See `CompileTarget.varsObjectName`: free symbols read as `_.<id>`, so
      // a lambda parameter spelled `_` must not shadow the vars object.
      varsObjectName: '_',
      // See `CompileTarget.reservedEmittedNames`.
      reservedEmittedNames: JS_RESERVED_EMITTED_NAMES,
      constant: (id) => JAVASCRIPT_CONSTANTS[id],
      functions: (id) =>
        namedFunctions?.[id] ? namedFunctions[id] : JAVASCRIPT_FUNCTIONS[id],
      var: (id) => {
        // A string `vars` value is JS source spliced in as-is (the live-path
        // contract: `{ s: '_.s' }` keeps `s` a runtime argument even when it
        // has an assigned value). A non-string value is a constant to bake.
        // Own-property test, not `in`: a caller's `vars` map is an ordinary
        // object, so `in` also finds `Object.prototype` members. A symbol
        // named `toString` would then take this branch with the inherited
        // FUNCTION as its value and splice `undefined` into the emitted
        // source (`JSON.stringify` of a function), instead of falling
        // through to the free-symbol lookup below.
        if (vars && Object.hasOwn(vars, id)) {
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
        const result = JAVASCRIPT_CONSTANTS[id];
        if (result !== undefined) return result;
        if (unknowns.includes(id)) {
          varsObjectRefs.add(id);
          return varsObjectAccess(id);
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
        return varsObjectAccess(id);
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
      // Purity of the ACTIVE lowering, not of the name. An `operators` entry
      // outranks a `functions` entry at emission, so a name claimed by both
      // emits the operator mapping — about which nothing is known — and must
      // not inherit the function entry's purity.
      isPureOverriddenOperator: (name) =>
        pureFunctions.has(name) && customOperator(name) === undefined,
      isStringVar: (name) =>
        vars !== undefined && typeof vars[name] === 'string',
      isVarsKey: (name) =>
        vars !== undefined && Object.prototype.hasOwnProperty.call(vars, name),
    });

    const result = compileToTarget(expr, target, options.entryChecks !== false);
    return BaseCompiler.withReferences(
      result,
      expr,
      target,
      vars ? new Set(Object.keys(vars)) : undefined
    );
  }
}

/**
 * True when a declared type PROVES the caller's value is a JS array, and so
 * names a binding whose typed-array value the D3 entry check copies to a plain
 * array.
 *
 * The shape question is the one `isIndexedCollectionOperand` asks — does this
 * lower to a JS array? — asked against the absence-admitting family tops
 * `list<any>` / `indexed_collection<any>`, and it must hold for the WHOLE
 * declared type: a union such as `number | list<number>` admits a scalar, so
 * it is not a list binding.
 *
 * A type that a STRING inhabits is excluded, because a string is a legitimate
 * caller value there and the string lowerings read it as a string, not as an
 * array of numbers. Two types are excluded for this reason: `string` itself,
 * and the bare `indexed_collection` (a string is an indexed collection of its
 * grapheme clusters in the type lattice). `indexed_collection<number>` and
 * every `list<...>` keep the check — no string inhabits them.
 */
function isListEntryType(t: Type): boolean {
  if (isSubtype('string', t)) return false;
  return (
    isSubtype(t, 'list<any>') || isSubtype(t, INDEXED_COLLECTION_SHAPE_TYPE)
  );
}

/**
 * The D3 entry plan of the LAMBDA route: parameter `i` is list-shaped when its
 * annotation proves a JS array, complex-shaped when its annotation is a
 * non-real number type, real-shaped otherwise (an unannotated parameter is
 * wide, which the analysis shapes real).
 */
function lambdaEntryPlan(
  literalParams: ReadonlyArray<Expression>,
  mode: CompileMode
): EntryPlan {
  const real: number[] = [];
  const complex: number[] = [];
  const lists: number[] = [];
  literalParams.forEach((p, i) => {
    let t: Type | undefined;
    if (isFunction(p, 'Typed')) {
      const src = p.ops[1];
      const text = isString(src)
        ? src.string
        : isSymbol(src)
          ? src.symbol
          : undefined;
      if (text !== undefined) {
        try {
          t = parseType(text);
        } catch {
          t = undefined;
        }
      }
    }
    if (t !== undefined && isListEntryType(t)) {
      lists.push(i);
      return;
    }
    // Under the complex discipline an unannotated (wide) parameter is
    // complex-shaped too — a number is lifted at entry, an object accepted.
    const isComplex =
      t !== undefined
        ? isNonRealNumber(t) ||
          (mode === 'complex' && BaseCompiler.wideNumericType(t))
        : mode === 'complex';
    (isComplex ? complex : real).push(i);
  });
  return { kind: 'args', real, complex, lists };
}

/**
 * The D3 entry plan of the EXPRESSION route: each free symbol emitted as a
 * vars-object lookup (`target.varsObjectRefs`) is list-shaped when its
 * declared type proves a JS array, complex-shaped when the analysis says so
 * — from its declared type — and real-shaped otherwise.
 * (A `vars`-option splice binds source text, never passes through `run()`,
 * and is not in the set: it is the caller's responsibility by contract.)
 */
function varsEntryPlan(
  engine: ComputeEngine,
  refs: ReadonlySet<string> | undefined,
  mode: CompileMode
): EntryPlan | undefined {
  if (refs === undefined || refs.size === 0) return undefined;
  const real: string[] = [];
  const complex: string[] = [];
  const lists: string[] = [];
  for (const id of refs) {
    const sym = engine.symbol(id);
    // A symbol whose declared type proves an array is classed as a list
    // instead of as a number: the real/complex rules read the value as a
    // scalar, which an array is not.
    const declared = sym.type?.type;
    if (declared !== undefined && isListEntryType(declared)) {
      lists.push(id);
      continue;
    }
    // Built OUTSIDE the compilation (the mode latch has been restored), so
    // the complex discipline's wide rule is applied here explicitly.
    const isComplex =
      BaseCompiler.isComplexValued(sym) ||
      (mode === 'complex' && BaseCompiler.wideNumericType(sym.type?.type));
    (isComplex ? complex : real).push(id);
  }
  return { kind: 'vars', real, complex, lists };
}

function compileToTarget(
  expr: Expression,
  target: CompileTarget<Expression>,
  entryChecks = true
): CompilationResult<'javascript'> {
  // The discipline this compilation runs under, for the D3 entry plans built
  // after the compilation proper (when `BaseCompiler.mode` is restored).
  const mode = BaseCompiler.resolveCompileMode(target);

  if (isFunction(expr, 'Function')) {
    const args = expr.ops;
    BaseCompiler.assertNoDestructuringParams(args.slice(1));
    BaseCompiler.assertNoRestParams(args.slice(1));
    const params = args
      .slice(1)
      .map((x) => functionLiteralParameterName(x) || '_');
    const lambdaTarget: CompileTarget<Expression> = {
      ...target,
      var: (id) => (params.includes(id) ? id : target.var(id)),
      boundVars: BaseCompiler.withBoundNames(target, params),
    };
    // The emitted definitions land inside the lambda body (below), where the
    // parameters are in scope: a folded symbol value that mentions one is
    // bound there rather than re-emitted at every reference.
    if (target.userFunctions) target.userFunctions.valueRoot = lambdaTarget;
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
    // definitions as a preamble inside the lambda's own body. A pure
    // definition the artifact calls from two or more places is wrapped in a
    // last-call memo first (`memoizeSharedDefinitions`), so that both the
    // spliced `code` and the runner below carry the same definitions.
    if (target.userFunctions)
      memoizeSharedDefinitions(
        target.userFunctions,
        body,
        params,
        false,
        javascriptStatements(target)
      );
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
    // The definitions that read no lambda parameter are evaluated once per
    // artifact; the rest stay inside the per-call body (see
    // `splitPreambleDefs`). `toString()` and `code` keep the single-body form.
    const split = target.userFunctions
      ? splitPreambleDefs(target.userFunctions, params, false)
      : { hoisted: '', perCall: '' };
    const statements = javascriptStatements(target);
    const statementBody = statements?.has(body)
      ? statements.functionBody(body)
      : undefined;
    const fn = new ComputeEngineFunctionLiteral(
      expr.engine,
      body,
      params,
      split.perCall,
      entryChecks ? lambdaEntryPlan(args.slice(1), mode) : undefined,
      split.hoisted,
      statementBody
    );
    return {
      target: 'javascript' as const,
      success: true,
      code: statementBody
        ? `(${params.join(', ')}) => { ${userDefs}${statementBody} }`
        : userDefs
          ? `(${params.join(', ')}) => { ${userDefs}return ${body}; }`
          : `(${params.join(', ')}) => ${body}`,
      calling: 'lambda' as const,
      run: fn as unknown as CompiledRunner<
        CompiledValue,
        number | ComplexResult
      >,
    };
  }

  if (isSymbol(expr)) {
    const op = target.operators?.(expr.symbol);
    if (op) {
      const fn = new ComputeEngineFunctionLiteral(expr.engine, `a ${op[0]} b`, [
        'a',
        'b',
      ]);
      return {
        target: 'javascript' as const,
        success: true,
        code: `(a, b) => a ${op[0]} b`,
        calling: 'lambda' as const,
        run: fn as unknown as CompiledRunner<
          CompiledValue,
          number | ComplexResult
        >,
      };
    }
  }

  const js = BaseCompiler.compileCseRoot(expr, target);
  // Collect any user-defined function definitions accumulated while compiling
  // `expr` (a symbol with a `Function`-literal definition used as an operator)
  // and prepend them to the preamble so their named local functions are in
  // scope for the compiled body. A pure definition the artifact calls from
  // two or more places is wrapped in a last-call memo first
  // (`memoizeSharedDefinitions`), so that the spliced `preamble` and the
  // runner below carry the same definitions.
  if (target.userFunctions)
    memoizeSharedDefinitions(
      target.userFunctions,
      js,
      [],
      true,
      javascriptStatements(target)
    );
  const userDefs = BaseCompiler.userFunctionsPreamble(target);
  const preamble = userDefs
    ? target.preamble
      ? `${target.preamble}\n${userDefs}`
      : userDefs
    : target.preamble;
  // The runner evaluates once per artifact the definitions that read no
  // per-call binding (`splitPreambleDefs`); the caller's own preamble and
  // every other definition run on every call, as before. A hoisted
  // definition never references a name the caller's preamble defines: a
  // value reaching caller-supplied source is not on `userFunctions.hoistable`.
  // `preamble` above, the text a consumer splices itself, keeps the
  // single-body form.
  const split = target.userFunctions
    ? splitPreambleDefs(target.userFunctions, [], true)
    : { hoisted: '', perCall: '' };
  const perCall = target.preamble
    ? `${target.preamble}\n${split.perCall}`
    : split.perCall || undefined;
  const fn = new ComputeEngineFunction(
    expr.engine,
    js,
    perCall,
    entryChecks
      ? varsEntryPlan(expr.engine as ComputeEngine, target.varsObjectRefs, mode)
      : undefined,
    split.hoisted,
    javascriptStatements(target)?.functionBody(js)
  );
  return {
    target: 'javascript' as const,
    success: true,
    code: js,
    // The helper preamble plus the emitted definitions (`_fn_*` user
    // functions, `_val_*` bound symbol values), which `code` reads by name.
    ...(preamble ? { preamble } : {}),
    calling: 'expression' as const,
    run: fn as unknown as CompiledRunner<CompiledValue, number | ComplexResult>,
  };
}

/**
 * Maximum number of terms to unroll in a Sum/Product.
 * Beyond this threshold a loop is emitted instead.
 */
const UNROLL_LIMIT = 100;

/**
 * Term count from which an unrolled Sum/Product is emitted as a sequence of
 * accumulating STATEMENTS inside an IIFE rather than as one flat `a + b + c`
 * chain.
 *
 * A flat chain has nowhere to put a statement, and that costs the unrolled
 * form two things a loop gets for free. The accumulator cannot be tested
 * between terms, so a term that makes the running total NaN does not stop the
 * remaining ones — every one is evaluated to reach an answer already
 * determined. And there is no place to bind a value, so an operand that does
 * not depend on the index is re-emitted, and re-evaluated, once per term. The
 * statement form recovers both.
 *
 * Below the threshold the flat chain is kept. A two- or three-term chain can
 * skip at most one or two terms by exiting early, which does not pay for the
 * closure the statement form introduces, and the flat chain is the more
 * readable emission for the trivial sums that dominate that size.
 */
const UNROLL_STATEMENT_MIN_TERMS = 4;

/**
 * Extract index, lower, and upper from a Limits expression.
 * Returns the raw Expression nodes so they can be compiled (not just evaluated
 * to numbers).
 */
function extractLimits(limitsExpr: Expression): {
  index: string;
  lowerExpr: Expression;
  upperExpr: Expression;
} {
  // This lowering is the counted loop `for (i = lower; i <= upper; i++)`, so
  // it can only read a `Limits` clause. The other indexing-set shape a big
  // operator accepts — `Element(i, collection)`, which the interpreter
  // iterates — has no lower and upper bound to read: reading `op2`/`op3` off
  // it answered the `Nothing` erasure marker, and the emission failed several
  // steps later with a message about that marker rather than about the clause.
  // Decline here instead, with the clause named.
  if (limitsExpr.operator !== 'Limits')
    throw new Error(
      `${limitsExpr.operator === 'Element' ? 'Element' : limitsExpr.operator}` +
        ` indexing set: a Sum/Product over a COLLECTION is not lowered to ` +
        `JavaScript — this emitter builds a counted loop from a \`Limits\` ` +
        `clause and has no bounds to read. Fail closed (D6) — the ` +
        `interpreter evaluates it.`
    );
  const fn = limitsExpr as Expression & {
    op1: Expression;
    op2: Expression;
    op3: Expression;
  };
  const index = isSymbol(fn.op1) ? fn.op1.symbol : '_';
  const lowerExpr = fn.op2;
  const upperExpr = fn.op3;
  return {
    index,
    lowerExpr,
    upperExpr,
  };
}

/**
 * Whether an operand (a Sum/Product bound, a `Repeat` count) is KNOWN at
 * compile time not to be a finite number: a `±∞`/`NaN` literal, or an
 * expression typed `infinity` or `nan`.
 *
 * Such a bound cannot be lowered to a counted loop — `i <= Infinity` never
 * fails, and `-Infinity + 1 === -Infinity` never advances the counter — so the
 * compiled function would lock the caller's thread with no timeout and no way
 * out. A symbolic bound (`n`) is not decided here: it is guarded at run time
 * (see `emitSumProduct`).
 */
export function isNonFiniteBound(expr: Expression): boolean {
  if (isNumber(expr) && !Number.isFinite(expr.re)) return true;
  // Both non-finite tiers, not just the signed pair: `infinity` also holds
  // the unsigned `~oo`, and NaN types `nan`. A bound of either kind has no
  // terminating loop, and neither is a subtype of `+oo | -oo`.
  return expr.type.matches('infinity') || expr.type.matches('nan');
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
 * From `UNROLL_STATEMENT_MIN_TERMS` terms on, the unrolled form is emitted not
 * as a flat `a + b + c` chain but as an IIFE accumulating in statements. That
 * buys two things the chain has nowhere to put: index-invariant collection
 * operands are bound once ahead of the terms instead of being rebuilt by each
 * one, and the accumulator is tested between terms so that a NaN — which
 * absorbs both `+` and `*` — returns immediately instead of evaluating terms
 * that cannot change the answer. The NaN exit is emitted only when skipping
 * those terms is unobservable; a term that splices caller-supplied source
 * keeps the statement form without the exits.
 *
 * The SCALAR loop arm carries the same exit, under the same gate, once per
 * iteration rather than once per term. The complex arms of both forms are
 * excluded on purpose: a complex accumulator with a finite imaginary part does
 * not absorb, so exiting on `acc !== acc` there could change the answer.
 *
 * Multi-index forms — `Sum(body, Limits(i,…), Limits(j,…), …)` — are compiled
 * as nested single-index sums (`Σ_i Σ_j body`), so every indexing-set clause is
 * honored.
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
    // Tycho document helper typed `(number) -> unknown`, or an operand whose
    // static type is a scalar-or-collection UNION such as the `Which` returning
    // a 2-element list or `-1`, Tycho item 249) may be a scalar OR an array at
    // run time, so it reduces under an `Array.isArray` guard (a runtime scalar
    // returns itself, matching the interpreter's `Sum(scalar) = scalar`).
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
 *
 * The callbacks of the `Map`/`Filter` stages are compiled WITHOUT the
 * loop-invariant hoist of `hoistedCallbackLambda` (no `target` is passed to
 * `fnArg`). A stage of a lazy stream pulls one element at a time
 * (`_SYS.mapIter` is `for (const x of it) yield f(x)`), so the callback of an
 * UPSTREAM stage runs BETWEEN two calls of this stage's callback. An upstream
 * body that assigns a variable of the enclosing scope therefore changes, in
 * the middle of this stage's iteration, a value this stage treats as
 * invariant: the hoist binds that value on the first call and every later
 * element would read the stale binding. The candidate analysis cannot see
 * that assignment — `BaseCompiler.loopInvariantHoistCandidates` scans only
 * the body it is given. The eager lowerings of the same operators are safe
 * because their source collection is fully materialized before the callback
 * is called even once.
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
  // A union with a text arm (`string | list<number>`) passes the test above —
  // a string IS an indexed collection in the type lattice — but may be a JS
  // string at run time, where `.slice()`/`.reverse()`/spread walk UTF-16 code
  // units instead of the grapheme clusters the interpreter walks. Proof of a
  // string is what `elementsArg` segments on, so this operand would reach the
  // array lowering unsegmented. Refused here (D6). See `couldBeStringOperand`.
  if (couldBeStringOperand(arg))
    throw new Error(
      `${kind}: ${position !== undefined ? `operand ${position}` : 'operand'} ` +
        `may be text at run time (its type has a string arm), which the ` +
        `compiled list lowering would walk as UTF-16 code units rather than ` +
        `characters. Fail closed (D6) — the interpreter evaluates it.`
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
 * Compile a collection operand that MAY be a string, as the array of its
 * elements.
 *
 * A string is an indexed collection of its grapheme clusters, but it lowers to
 * a JS string, which is not array-shaped: `.length` counts UTF-16 code units,
 * `.slice` cuts between them, and `for … of` walks code points — every one of
 * them disagreeing with the interpreter on a combining sequence, a ZWJ emoji
 * family or a regional-indicator flag. So a string source is SEGMENTED first,
 * with `_SYS.chars` (the interpreter's own `Intl.Segmenter` decomposition), and
 * the existing list lowering then runs over the resulting array of one-cluster
 * strings, which faithfully models the interpreter's `list<character>`.
 *
 * Used only by the operators whose interpreter behaviour over a string source
 * is the element walk this reproduces. Anything else keeps calling `collArg`
 * and keeps failing closed on a string — notably the linear-algebra operators,
 * where the interpreter treats a string as a rank-0 leaf.
 * (`docs/STRING_ROADMAP.md`, decision D13.)
 */
function elementsArg(
  kind: string,
  arg: Expression | undefined,
  compile: (expr: Expression) => string,
  position?: number
): string {
  if (arg !== undefined && isProvablyStringOperand(arg))
    return `_SYS.chars(${compile(arg)})`;
  // Segmenting is gated on PROOF of a string, so an operand that merely MAY be
  // text (`string | list<number>`) is not segmented here — it would reach the
  // array lowering as a JS string. `collArg` refuses it (see
  // `couldBeStringOperand`), which is why this funnel needs no test of its own.
  return collArg(kind, arg, compile, position);
}

/**
 * Re-assemble the STRING result of a string-preserving operator.
 *
 * `Reverse`, `Take`, `Sort` and their kin answer a `string` for a `string`
 * source (the "string preservation rule", `docs/STRING_ROADMAP.md`), so the
 * array of clusters `elementsArg` produced — and the array operation ran over —
 * is joined back into one string. `.normalize()` because the interpreter stores
 * every string in NFC (`engine.string()`), so a joined pair of clusters that
 * composes must come out composed, exactly as `StringJoin` does it.
 *
 * The result may have a DIFFERENT character count than the source: joining
 * clusters can compose or reorder combining marks into new clusters
 * (`Reverse("é")` puts the combining acute first). That is inherent to the
 * operation, and the interpreter re-segments the same way.
 *
 * A non-string source is returned untouched, so each call site keeps its
 * existing list lowering byte-identically.
 */
function joinIfString(source: Expression | undefined, code: string): string {
  if (source === undefined || !isProvablyStringOperand(source)) return code;
  return `(${code}).join("").normalize()`;
}

/**
 * Compile a STRING operand of a string-specific operator, failing closed (D6)
 * when it is not provably a `string`.
 *
 * `character` is deliberately NOT admitted even though it lowers to a
 * one-cluster JS string: every operator using this funnel declares a `string`
 * parameter, so a character operand is an `incompatible-type` error in the
 * interpreter, and compiling it would answer a value where interpretation
 * answers an error. `position` labels the operand in the diagnostic.
 */
/** Is this operand a compiled pattern — a `RegExp(...)` node or a
 * `regexp`-typed value? */
function isRegExpOperand(arg: Expression | undefined): boolean {
  return arg !== undefined && arg.type.matches('regexp');
}

/** The pattern source and flag text of a `RegExp(...)` operand, as JS string
 * literals ready to embed.
 *
 * Both must be LITERAL: a computed pattern has no text at compile time, and
 * emitting `new RegExp(<expr>)` would move a construction error that the
 * interpreter reports at canonicalization into the compiled artifact, where
 * it becomes a run-time throw instead of a visible error value.
 *
 * A Unicode mode is added exactly as the interpreter's `hostFlags` does, so
 * compiled code and the interpreter compile the SAME pattern — `u` rather
 * than `v`, since `v` rejects patterns `u` accepts.
 *
 * ⚠️ This is a SECOND COPY of that rule: the other is `hostFlags()` in
 * `compute-engine/library/regexp.ts`, and `compilation/` does not import from
 * `library/`, so nothing mechanically keeps them in step. The whole safety
 * argument for compiling a regex is that the same pattern text reaches the
 * same `RegExp`, and the flag string is the one input where that can quietly
 * stop holding — so change both together, and see the compiled/interpreted
 * parity tests in `test/compute-engine/regexp.test.ts`, which cover an
 * explicit `u` and none.
 *
 * It also does not re-apply `ACCEPTED_FLAGS`. That is safe only because
 * canonicalization rejects `g`/`y`/unknown/duplicate flags before any node
 * can reach compilation — a non-local invariant, stated here because this
 * function does not enforce it itself. */
function literalPatternArg(
  operator: string,
  arg: Expression | undefined
): { source: string; flags: string } {
  const re = arg !== undefined && isFunction(arg, 'RegExp') ? arg : undefined;
  if (re === undefined || !isString(re.op1))
    throw new Error(
      `${operator}: cannot compile — the pattern must be a literal ` +
        `\`RegExp("...")\`. Fail closed (D6).`
    );
  const flagText = re.nops >= 2 && isString(re.op2) ? re.op2.string : '';
  if (re.nops >= 2 && !isString(re.op2))
    throw new Error(
      `${operator}: cannot compile — the flags must be a literal string. ` +
        `Fail closed (D6).`
    );
  const withUnicode =
    flagText.includes('u') || flagText.includes('v')
      ? flagText
      : flagText + 'u';
  return {
    source: JSON.stringify(re.op1.string),
    flags: JSON.stringify(withUnicode),
  };
}

function stringArg(
  kind: string,
  arg: Expression | undefined,
  compile: (expr: Expression) => string,
  position: string
): string {
  if (arg === undefined || !isProvablyStringOperand(arg))
    throw new Error(
      `${kind}: cannot compile — ${position} is not provably a string ` +
        `(type \`${arg === undefined ? 'missing' : arg.type.toString()}\`). ` +
        `Fail closed (D6) — the interpreter evaluates it.`
    );
  return compile(arg);
}

/**
 * The value of an operand that is a NUMBER LITERAL holding an integer, or
 * `undefined` for anything else (a computed expression, a free symbol, a
 * non-integer).
 *
 * Used by the string operators whose out-of-domain counts produce an interpreter
 * ERROR VALUE rather than a number — `StringRepeat(s, -1)`, `PadStart(s, -1)`,
 * `StringReplace(s, t, r, 0)`, `RangeOf(xs, needle, 0)`. Their literal operands
 * are decided at COMPILE time by {@link guardedIntegerArg}; a computed one gets
 * a run-time guard instead.
 */
function literalInteger(x: Expression | undefined): number | undefined {
  if (x === undefined || !isNumber(x) || x.im !== 0) return undefined;
  const n = x.re;
  return Number.isInteger(n) ? n : undefined;
}

/**
 * The content of an operand that is a string LITERAL, or `undefined` for
 * anything else. Companion to {@link literalInteger} for the operands whose
 * EMPTINESS decides between a value and an interpreter error value — the
 * `target` of `StringReplace` and the `pad` of `PadStart`/`PadEnd`.
 */
function literalStringContent(x: Expression | undefined): string | undefined {
  if (x === undefined || !isString(x)) return undefined;
  return x.string;
}

/**
 * The emitted JavaScript for an integer operand whose out-of-domain values the
 * interpreter answers with an ERROR VALUE: `RangeOf`'s `from` (an integer of 1
 * or more — past the END of the subject is deliberately NOT an error, just
 * `Nothing`), `StringReplace`'s `count` (a positive integer),
 * `StringRepeat`'s and `PadStart`/`PadEnd`'s `n` (a non-negative integer).
 * `min` is that lower bound and `rule` states it for the reader of a run-time
 * failure (e.g. "`n` must be a non-negative integer").
 *
 * `max` is the matching UPPER bound. The string operators read their count with
 * `asSmallInteger` (`library/core.ts`), which answers `null` — so the
 * interpreter answers an error value — above `SMALL_INTEGER` (1000000); hence
 * that default. `RangeOf`'s `from` goes through `toInteger` instead, which has
 * no such ceiling, so it passes `Infinity`.
 *
 * A LITERAL is decided now: in domain it is emitted as a bare number, out of
 * domain the call DECLINES to compile — a known-bad call should not compile,
 * and the diagnostic names the reason. A COMPUTED operand the engine can
 * already PROVE out of domain declines the same way. Otherwise it compiles and
 * carries a `_SYS.domi` guard that THROWS at run time when the value is out of
 * domain.
 * The contract that divergence rests on: the interpreter returns an error
 * VALUE, compiled code throws — a visible failure, never a wrong value. That
 * is the precedent the `Slice` lowering in this file already sets, where a
 * non-literal span compiles and the emitted code throws a `RangeError` on a
 * span that is not an ascending index range.
 * (User ruling 2026-08-16; `docs/STRING_ROADMAP.md`,
 * decision D8.)
 */
function guardedIntegerArg(
  kind: string,
  arg: Expression,
  compile: (expr: Expression) => string,
  min: number,
  rule: string,
  max: number = SMALL_INTEGER
): string {
  const n = literalInteger(arg);
  if (n !== undefined && n >= min && n <= max) return `${n}`;
  if (isNumber(arg))
    throw new Error(
      `${kind}: cannot compile — ${rule}, and this operand is the literal ` +
        `\`${arg.toString()}\`, which the interpreter answers with an error ` +
        `value. Fail closed (D6).`
    );
  // A computed operand can still be PROVABLY below the bound — `Negate(k)` for
  // a `k` known positive — and a known-bad call should not compile. Only the
  // lower bound has such a proof available: `isPositive`/`isNonNegative` are
  // the sign facets, and there is no facet for "at most 1000000", so an
  // oversized computed value is left to the run-time guard.
  const provablyBelow =
    min >= 1 ? arg.isPositive === false : arg.isNonNegative === false;
  if (provablyBelow)
    throw new Error(
      `${kind}: cannot compile — ${rule}, and this operand is provably ` +
        `outside that domain, which the interpreter answers with an error ` +
        `value. Fail closed (D6).`
    );
  return `_SYS.domi(${compile(arg)}, ${min}, ${max}, ${JSON.stringify(
    `${kind}: ${rule}`
  )})`;
}

/**
 * The emitted JavaScript for a string operand that must be NON-EMPTY — the
 * `target` of `StringReplace` and the `pad` of `PadStart`/`PadEnd`, both of
 * which the interpreter answers with an ERROR VALUE when empty. `js` is the
 * already-compiled operand.
 *
 * Same split as {@link guardedIntegerArg}: an empty literal — or a computed
 * operand the engine can already PROVE empty — declines to compile, a
 * non-empty literal is emitted bare, and any other computed operand carries a
 * `_SYS.doms` guard that throws at run time. Interpreter returns an error
 * VALUE, compiled code throws — a visible failure, never a wrong value (the
 * `Slice` precedent, see {@link guardedIntegerArg}).
 */
function guardedNonEmptyStringArg(
  kind: string,
  arg: Expression,
  js: string,
  rule: string
): string {
  const literal = literalStringContent(arg);
  if (literal !== undefined && literal !== '') return js;
  if (literal === '')
    throw new Error(
      `${kind}: cannot compile — ${rule}, and this operand is the empty ` +
        `string literal, which the interpreter answers with an error value. ` +
        `Fail closed (D6).`
    );
  // Not spelled as a literal, but still provably empty — a symbol assigned
  // `""`, say. Same rule as `RangeOf`'s needle: a known-bad call should not
  // compile, while an operand whose emptiness is only known at run time gets
  // the guard below.
  if (arg.isEmptyCollection === true)
    throw new Error(
      `${kind}: cannot compile — ${rule}, and this operand is provably ` +
        `empty, which the interpreter answers with an error value. ` +
        `Fail closed (D6).`
    );
  return `_SYS.doms(${js}, ${JSON.stringify(`${kind}: ${rule}`)})`;
}

/**
 * `Trim` / `TrimStart` / `TrimEnd` — strip the characters of a SET from the
 * start (`start`) and/or the end (`end`) of a string, over grapheme clusters.
 *
 * The optional second operand is a SET of characters, never a literal
 * substring: a string operand contributes each of ITS characters, and a
 * collection operand each of its elements'. Absent, the default is the Unicode
 * White_Space set (`JS_UNICODE_WHITESPACE_CHARACTER`). Any other operand shape
 * leaves the interpreter's handler unevaluated (`trimCharacterSet` answers
 * `undefined`), so it fails closed here.
 */
function compileJSTrim(
  kind: string,
  args: ReadonlyArray<Expression>,
  compile: (expr: Expression) => string,
  start: boolean,
  end: boolean
): string {
  if (args.length < 1 || args.length > 2)
    throw new Error(
      `${kind}: cannot compile — expected \`${kind}(s, chars?)\`. ` +
        `Fail closed (D6).`
    );
  const subject = stringArg(kind, args[0], compile, 'the subject');
  let chars = 'undefined';
  if (args.length === 2) {
    const set = args[1];
    if (isProvablyStringOperand(set)) chars = compile(set);
    else {
      const elt = collectionElementType(jsType(set));
      if (
        !isIndexedCollectionOperand(set) ||
        elt === undefined ||
        (elt !== 'never' &&
          !isSubtype(elt, 'string') &&
          !isSubtype(elt, 'character'))
      )
        throw new Error(
          `${kind}: cannot compile — \`chars\` must be a string or an indexed ` +
            `collection whose elements are provably strings or characters; ` +
            `the interpreter leaves the expression unevaluated on anything ` +
            `else. Fail closed (D6) — the interpreter evaluates it.`
        );
      // Through `collArg`, not `compile`: it refuses an operand whose type
      // merely ADMITS text (it would arrive as a JS string, not an array) and
      // an INFINITE collection (which cannot materialize to an array). The
      // interpreter declines both.
      chars = collArg(kind, set, compile);
    }
  }
  return `_SYS.strim(${subject}, ${chars}, ${start}, ${end})`;
}

/**
 * `PadStart` / `PadEnd` — pad a string to `n` CHARACTERS (not code units, not
 * display columns) by repeating `pad`, whose final copy is truncated on a
 * character boundary.
 *
 * A negative `n` and an empty `pad` are both interpreter ERROR VALUES, which a
 * compiled artifact cannot return: an out-of-domain LITERAL declines to
 * compile, while a computed `n` or `pad` compiles with a run-time guard that
 * throws (see {@link guardedIntegerArg} and {@link guardedNonEmptyStringArg}).
 */
function compileJSPad(
  kind: string,
  args: ReadonlyArray<Expression>,
  compile: (expr: Expression) => string,
  atStart: boolean
): string {
  if (args.length < 2 || args.length > 3)
    throw new Error(
      `${kind}: cannot compile — expected \`${kind}(s, n, pad?)\`. ` +
        `Fail closed (D6).`
    );
  const subject = stringArg(kind, args[0], compile, 'the subject');
  const width = guardedIntegerArg(
    kind,
    args[1],
    compile,
    0,
    `\`n\` must be a non-negative integer of at most ${SMALL_INTEGER}`
  );
  let pad = '" "';
  if (args.length === 3)
    pad = guardedNonEmptyStringArg(
      kind,
      args[2],
      stringArg(kind, args[2], compile, 'the padding'),
      '`pad` must be a non-empty string'
    );
  return `_SYS.spad(${subject}, ${width}, ${pad}, ${atStart})`;
}

/**
 * Compile a callback `Function` literal with the LOOP-INVARIANT
 * subexpressions of its body bound once, outside the per-element lambda.
 *
 * Every callback lowering of this target instantiates the lambda once and
 * calls it per element (`((_f) => (coll).map((_x) => _f(_x)))(lambda)`), but
 * the lambda BODY is emitted whole, so a subexpression that mentions none of
 * the lambda's parameters was recomputed for every element. A call to a
 * user-defined function of the ENCLOSING parameters is the expensive case:
 * `Map((_) ↦ Which(_ = m(x, y), …), d(x, y))` over a nine-element list called
 * `m(x, y)` nine times, and `m` rebuilds the whole list it reduces.
 * `BaseCompiler.hoistLoopInvariants` finds the subexpressions that qualify —
 * pure, admissible to emit once, and free of the lambda's parameters — and
 * rewrites the body to read a name instead of recomputing them.
 *
 * The names are declared next to the lambda, where the enclosing scope's
 * variables are still visible and the lambda's parameters are not, and are
 * ASSIGNED on the FIRST call of the lambda, behind a flag. A collection may
 * be empty, and the interpreter then evaluates no part of the body:
 * assigning at instantiation time would evaluate a subexpression the
 * unhoisted code never reached, so an error it raises would be new. The
 * first call also keeps the assignments AFTER the source collection is
 * built, which is the order the unhoisted body ran in. The flag costs one
 * boolean read per element. `BaseCompiler.compileComprehension` initializes
 * its own hoisted bindings on the first iteration for the same two reasons.
 *
 * A callback that is not a `Function` literal — a bare user-function symbol,
 * an operator symbol — has no body to rewrite here and compiles unchanged.
 *
 * The element-consuming callbacks reach this through `fnArg`/`zipFnArg` and
 * the `Tabulate`/`Fill` lowerings. A `Reduce`/`Scan` COMBINER reaches it
 * through `customCombinerWithLanes`, which passes a `compile` that wraps the
 * emission in `BaseCompiler.compileCombinerLiteral`: the literal's own
 * compilation then runs inside the fold's local shape frame, while the
 * bindings are compiled and declared outside it. A combiner binds two
 * parameters — the accumulator and the element — and both are varying, which
 * `functionLiteralBoundNames` reports from the parameter operands.
 */
function hoistedCallbackLambda(
  callback: Expression,
  compile: (expr: Expression) => string,
  target: CompileTarget<Expression> | undefined
): string {
  if (
    target === undefined ||
    target.language !== 'javascript' ||
    !isFunction(callback, 'Function') ||
    callback.ops[0] === undefined
  )
    return compile(callback);

  // The body as the `Function` lowering compiles it, so the hoist scans the
  // very node objects the emission will reach: it rewrites an occurrence by
  // installing a code override keyed on the NODE.
  //
  // A function literal canonicalizes its body into a `Block`, which is a
  // SCOPE, and the candidate pass never descends into a scope: a name the
  // scope declares does not exist where the bindings are emitted. A block of
  // ONE statement declares nothing before that statement, so the statement
  // itself is what is scanned. A block of several statements may declare a
  // local that a later statement reads, so it is left whole and nothing is
  // hoisted out of it.
  const block = callback.ops[0].canonical;
  const body =
    isFunction(block, 'Block') && block.nops === 1 ? block.ops[0] : block;
  // Every name the parameter list BINDS is varying. A destructuring pattern
  // binds its leaf names and has no name of its own, so
  // `functionLiteralBoundNames` — not `functionLiteralParameterName`, which
  // answers `''` for a pattern — is what the hoist must be told: a body that
  // reads a leaf of `((p, q)) ↦ p + q` reads a value that changes with every
  // element, and binding it once would freeze the first element's components.
  const varying = functionLiteralBoundNames(callback.ops.slice(1));

  const { bindings, result: lambda } = BaseCompiler.hoistLoopInvariants(
    body,
    varying,
    target,
    () => compile(callback)
  );
  if (bindings.length === 0) return lambda;

  // An emitter that REBUILDS the literal before it compiles the body — the
  // ground-signature repair a generic literal takes in the `Function`
  // lowering — compiles different node objects, which no override reaches.
  // The bindings would then be declared and never read. Emit them only when
  // the compiled lambda names one of them.
  const named = new RegExp(
    `(?<![\\w$])(?:${bindings.map(([name]) => name).join('|')})(?![\\w$])`
  );
  if (!named.test(lambda)) return lambda;

  const statements = javascriptStatements(target);
  const flag = BaseCompiler.tempVar(target);
  const held = BaseCompiler.tempVar(target);
  // The shim forwards exactly the lambda's own parameter count: the native
  // callbacks pass `(x, index, array)`, and the extra arguments must not
  // reach the lambda (the interpreter passes exactly the element). The count
  // is the number of parameter OPERANDS, which is not the number of names
  // they bind: a destructuring pattern is ONE parameter that binds a name per
  // leaf of the pattern, and a `_` leaf binds no name at all.
  const args = callback.ops.slice(1).map(() => BaseCompiler.tempVar(target));
  const declarations = `let ${flag} = false; let ${bindings
    .map(([name]) => name)
    .join(', ')}; `;
  // In DEPENDENCY order, as `hoistLoopInvariants` returns them: a later
  // right-hand side may read an earlier name.
  const assignments = bindings
    .map(
      ([name, code]) =>
        statements?.consume(code, (value) => `${name} = ${value};`) ??
        `${name} = ${code};`
    )
    .join(' ');
  const shim =
    `(${args.join(', ')}) => { if (!${flag}) { ${flag} = true; ` +
    `${assignments} } return ${held}(${args.join(', ')}); }`;
  const holder =
    statements?.initialize(held, lambda) ?? `const ${held} = ${lambda};`;
  return (
    statements?.expression(
      (exit) => `${declarations}${holder} ${exit(shim)}`
    ) ?? `(() => { ${declarations}${holder} return ${shim}; })()`
  );
}

/**
 * Compile an ELEMENT-consuming callback operand (a predicate, a mapping
 * function), failing closed (D6) when a parameter annotation the emitted
 * lowering cannot enforce is not provably satisfied by `source`'s element type
 * — see `BaseCompiler.assertCallbackAnnotations`. `extraArgTypes` prefixes the
 * element position for a combiner-shaped callback (`Reduce`/`Scan`, whose
 * first parameter is the accumulator).
 *
 * `target` enables the loop-invariant hoist of `hoistedCallbackLambda`; a
 * caller that has no target compiles the callback unchanged.
 */
function fnArg(
  kind: string,
  callback: Expression | undefined,
  source: Expression | undefined,
  compile: (expr: Expression) => string,
  extraArgTypes: ReadonlyArray<Type | undefined> = [],
  target?: CompileTarget<Expression>
): string {
  BaseCompiler.assertCallbackAnnotations(kind, callback, [
    ...extraArgTypes,
    BaseCompiler.collectionElementTypeOf(source),
  ]);
  // STRICT shapes: a bare user-function symbol with a WIDE parameter over
  // complex ELEMENTS is a lane mismatch (the one emission of the function is
  // real-shaped) — a decline under `strict`, an escalation to complex mode
  // under `auto`. Unary callbacks only: a combiner-shaped callback (an
  // accumulator prefix) is planned by `combinerPlan`.
  if (extraArgTypes.length === 0)
    BaseCompiler.assertCallbackLaneMatch(callback, source);
  // A single-uppercase built-in operator name is exempt from the shared
  // value-position refusal because an un-applied one reads as a caller
  // variable; in CALLBACK position it is applied, so the exemption would ship
  // a `_.D` that throws at run time.
  BaseCompiler.assertBuiltinCallbackUsable(kind, callback);
  // A bare BUILT-IN operator symbol over complex ELEMENTS compiles its
  // synthesized parameter in the real lane and silently answers `NaN`. Hand
  // the compiler the annotated eta-expansion instead, so the body takes the
  // complex lane the inline-literal callback route already takes.
  if (extraArgTypes.length === 0) {
    const eta = BaseCompiler.complexElementCallbackEta(callback, source);
    if (eta !== undefined) return compile(eta);
  }
  return hoistedCallbackLambda(callback!, compile, target);
}

/**
 * `fnArg` for a callback that receives one element from EACH of several
 * sources (the zipWith form of `Map`): parameter `i` is fed source `i`'s
 * elements, so an annotation on it is checked against that source's element
 * type, position by position. Every source must supply real scalars
 * (`zipCallbackArgTypes`), because the callback's parameters are compiled
 * bare and its body treats them as real numbers. No lane-match check:
 * `assertCallbackLaneMatch` covers a bare user-function symbol with a SINGLE
 * wide parameter over complex elements, and complex elements are refused
 * here before it could apply.
 *
 * A bare `Add`/`Subtract`/`Multiply`/`Divide` symbol as the mapping lowers to
 * a TWO-parameter lambda (`(a, b) => a + b`), whatever the source count; the
 * interpreter applies the variadic operator to one element from each source,
 * so `Map(Add, xs, ys, zs)` sums three. A JavaScript arrow silently ignores
 * the third argument, so that spelling is refused unless the count is two.
 */
function zipFnArg(
  kind: string,
  callback: Expression | undefined,
  sources: ReadonlyArray<Expression | undefined>,
  compile: (expr: Expression) => string,
  target?: CompileTarget<Expression>
): string {
  if (
    isSymbol(callback) &&
    BaseCompiler.isBinaryInfixValueOperator(callback.symbol) &&
    sources.length !== 2
  )
    throw new Error(
      `${kind}: the operator symbol '${callback.symbol}' used as the ` +
        `mapping compiles to a two-argument function, and ${sources.length} ` +
        `collections supply ${sources.length} arguments per call. Fail ` +
        `closed (D6) — the interpreter evaluates it.`
    );
  BaseCompiler.assertCallbackAnnotations(
    kind,
    callback,
    BaseCompiler.zipCallbackArgTypes(kind, sources, 2)
  );
  BaseCompiler.assertBuiltinCallbackUsable(kind, callback);
  return hoistedCallbackLambda(callback!, compile, target);
}

//
// ─── Random domains ─────────────────────────────────────────────────────────
//
// A `Random`/`RandomChoice`/`RandomSample` domain compiles to a DESCRIPTOR —
// closed-form arithmetic when its parameters are literal, a runtime
// `_SYS.domain*` object otherwise — and NEVER to a compiled collection. The
// JS `Range` collection handler materializes via `Array.from`, so compiling
// the domain would allocate a million elements to draw three
// (`docs/RANDOMNESS-MODEL.md` §7).
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
function builtinCombiner(
  op: Expression,
  /**
   * The fold runs in the COMPLEX lane — its elements are complex scalars, or
   * its seed is complex-shaped. `Add`/`Multiply` then combine through the
   * complex kernels (each operand lifted by the idempotent `_SYS.cplx`, so a
   * real seed or a real element mixes correctly); before this, `Scan(L, Add,
   * 0)` over `[1+2i, i]` concatenated `"0[object Object]"` behind
   * `success: true`. `Min`/`Max` have no meaning over complex values — the
   * interpreter declines them — so they fail closed here.
   */
  complexLane = false
): string | undefined {
  if (!isSymbol(op)) return undefined;
  switch (op.symbol) {
    case 'Add':
      return complexLane
        ? '(_a, _b) => { const _p = _SYS.cplx(_a), _q = _SYS.cplx(_b); return { re: _p.re + _q.re, im: _p.im + _q.im }; }'
        : '(_a, _b) => _a + _b';
    case 'Multiply':
      return complexLane
        ? '(_a, _b) => { const _p = _SYS.cplx(_a), _q = _SYS.cplx(_b); return { re: _p.re * _q.re - _p.im * _q.im, im: _p.re * _q.im + _p.im * _q.re }; }'
        : '(_a, _b) => _a * _b';
    case 'Min':
      if (complexLane)
        throw new Error(
          `Min: a fold over complex values has no ordering. Fail closed (D6).`
        );
      return '(_a, _b) => Math.min(_a, _b)';
    case 'Max':
      if (complexLane)
        throw new Error(
          `Max: a fold over complex values has no ordering. Fail closed (D6).`
        );
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
 * `customCombiner`, with the combiner compiled under the accumulator and
 * element LANES of `plan` (`BaseCompiler.combinerPlan`, computed ONCE by the
 * caller and shared with its seed decision): an inline lambda under a local
 * shape frame binding its parameters to the lanes, a bare user-function
 * symbol through its typed eta-expansion when a lane is complex. Combiners
 * the plan cannot see (`plan === undefined`: an infix operator symbol) keep
 * the plain `customCombiner` route.
 *
 * The emitted wrapper LIFTS each operand whose lane is complex through the
 * idempotent `_SYS.cplx`, so the body always receives the shape it was
 * compiled for even when the value that arrives is a plain number: a
 * `list<complex>` lowers its elements verbatim and may hold a real entry, and
 * a seedless `Scan` whose accumulator widens starts from the RAW first
 * element (`Scan([1, 2], (a, x) ↦ a + i·x)` answered `[1, {re: null}]`
 * without the lift).
 *
 * An inline combiner also takes the loop-invariant hoist of
 * {@link hoistedCallbackLambda}: a fold calls its combiner once per element,
 * so a subexpression of the body that mentions neither the accumulator nor
 * the element was recomputed on every step. The hoist scans the body and
 * declares the bindings OUTSIDE the local shape frame, while
 * `BaseCompiler.compileCombinerLiteral` still pushes that frame around the
 * emission of the literal itself. A binding is invariant, so it names neither
 * parameter, and the frame describes nothing else: compiling it outside the
 * frame gives the same code the unhoisted body emitted.
 */
function customCombinerWithLanes(
  op: Expression,
  plan: ReturnType<typeof BaseCompiler.combinerPlan>,
  compile: (e: Expression) => string,
  target: CompileTarget<Expression>
): string | undefined {
  if (plan === undefined) return customCombiner(op, compile, target);
  const fn = isSymbol(plan.op)
    ? compile(plan.op)
    : hoistedCallbackLambda(
        plan.op,
        (e) => BaseCompiler.compileCombinerLiteral({ ...plan, op: e }, compile),
        target
      );
  const a = plan.accComplex ? '_SYS.cplx(_a)' : '_a';
  const b = plan.eltComplex ? '_SYS.cplx(_b)' : '_b';
  return `((_f) => (_a, _b) => _f(${a}, ${b}))(${fn})`;
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
      isSubtype(elt, 'string') ||
      // A character lowers to a one-cluster JS string, so it compares by
      // value with `===` exactly as a string does.
      isSubtype(elt, 'character'));
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
  return `${fn}(${args.map(compile).join(', ')})`;
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
/**
 * Node count of an expression tree, capped: the walk stops once `cap` is
 * exceeded, so the counter can never become the expense it guards.
 */
function nodeCountCapped(e: Expression, cap: number): number {
  let count = 1;
  if (isFunction(e))
    for (const op of e.ops) {
      count += nodeCountCapped(op, cap - count);
      if (count > cap) return count;
    }
  return count;
}

/**
 * Largest operand tree (in nodes) for which the `Limit` lowering attempts a
 * compile-time symbolic evaluation. `symbolicLimit`'s work scales with the
 * body it rewrites (differentiation, step-capped simplification, at
 * recursion depth ≤ 14), so a structural size cap is the deterministic
 * bound on the attempt — a real-world convergent limit's body is a handful
 * of nodes, while a pathological one is exactly what should go to the
 * `_SYS.limit` runtime call.
 */
const SYMBOLIC_LIMIT_MAX_NODES = 128;

/**
 * Whether the `Limit` lowering may attempt a compile-time SYMBOLIC
 * evaluation of this limit. The attempt evaluates on the expression's own
 * engine, so every gate that protects `tryConstantFold`'s compile-time
 * evaluation applies here too:
 *
 * - all operands constant (a free symbol reads its runtime value);
 * - `constantFold: false` disables every compile-time evaluation;
 * - a `vars`-mapped symbol is the caller's live binding and must never be
 *   folded through (checked against ALL symbols of the operands — a bound
 *   parameter sharing a mapped name over-declines, which is safe);
 * - a caller-overridden operator (`foldExcludedOps`) evaluates differently
 *   at run time than the engine definition would at compile time;
 * - an impure body must re-evaluate per call, never bake one sample;
 * - a non-radian angular unit would evaluate the ALREADY-REWRITTEN body
 *   (`rewriteAngularUnit`) under a second conversion — `tryConstantFold`
 *   neutralizes the unit around its evaluation; here the rare degree-mode
 *   case simply declines;
 * - the operand size cap (`SYMBOLIC_LIMIT_MAX_NODES`) bounds the attempt's
 *   work deterministically.
 */
function symbolicLimitAttemptAllowed(
  f: Expression,
  x: Expression,
  dir: Expression | null | undefined,
  target: CompileTarget<Expression>
): boolean {
  if (target.constantFold === false) return false;
  const ops = dir == null ? [f, x] : [f, x, dir];
  for (const op of ops) if (op.unknowns.length > 0) return false;
  if (f.engine.angularUnit !== 'rad') return false;
  if (f.isPure !== true) return false;
  if (target.varsKeys !== undefined && target.varsKeys.size > 0)
    for (const op of ops)
      for (const s of op.symbols) if (target.varsKeys.has(s)) return false;
  if (target.foldExcludedOps !== undefined)
    for (const name of target.foldExcludedOps)
      for (const op of ops) if (op.has(name)) return false;
  let nodes = 0;
  for (const op of ops) {
    nodes += nodeCountCapped(op, SYMBOLIC_LIMIT_MAX_NODES - nodes);
    if (nodes > SYMBOLIC_LIMIT_MAX_NODES) return false;
  }
  return true;
}

function compileGcdLcm(
  kind: 'GCD' | 'LCM',
  args: ReadonlyArray<Expression>,
  compile: (expr: Expression) => string
): string {
  const helper = kind === 'GCD' ? '_SYS.gcd' : '_SYS.lcm';
  const identity = kind === 'GCD' ? '0' : '1';
  const parts = args.map((a) => {
    if (isIndexedCollectionOperand(a)) return `...(${compile(a)})`;
    if (a.isCollection || a.type.matches('collection<any>'))
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
  // `list<number>`/`vector<n>`) and is always an array — no runtime guard.
  // Elements PROVABLY real fold with the raw operator; anything else — a
  // `list<number>` (wide elements), a `Map` whose callback promotes
  // (`Map(Ln, xs)` under `auto`), a list with a complex cell — folds with the
  // shape-agnostic scalar combiner (`_SYS.sadd`/`_SYS.smul`: numbers add as
  // numbers, a `{re, im}` in either position adds as complex), so a complex
  // element never reaches `+` and string-concatenates. One `typeof` per
  // element on the wide path; the runner's result convention hands an
  // exactly-real total back as a plain number.
  if (!guarded) {
    const identity = kind === 'Sum' ? '0' : '1';
    // The SAME predicate `isComplexValued` answers the parent from
    // (`collectionFoldsReal`), so the fold's shape and its report agree: a
    // raw fold yields a number; the agnostic fold, wrapped in the complex
    // lift, always yields a `{re, im}` (the parent reads it as complex).
    if (BaseCompiler.collectionFoldsReal(coll)) {
      const op = kind === 'Sum' ? '+' : '*';
      return `(${code}).reduce((_a, _b) => _a ${op} _b, ${identity})`;
    }
    const combiner = kind === 'Sum' ? '_SYS.sadd' : '_SYS.smul';
    return `_SYS.cplx((${code}).reduce(${combiner}, ${identity}))`;
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
function isElementwiseBigOpBody(
  body: Expression,
  indices: ReadonlyArray<string>
): boolean {
  if (isFunction(body, 'Tuple')) return false;
  const tt = jsType(body);
  if (typeof tt !== 'string' && tt.kind === 'tuple') return false;
  if (BaseCompiler.isComplexValuedUnderIndices(body, indices)) return false;
  // A STRING body is NOT element-wise. It matches `indexed_collection` in the
  // lattice (its elements are its grapheme clusters) but lowers to a JS
  // string, so the `_SYS.bcast` fold would concatenate rather than accumulate
  // — `Σ_{i=0}^{2} "ab"` running to `"ababab"` behind `success: true`, which
  // is exactly the item-121 garbage `assertScalarBigOpBody` declines. Falling
  // through to that assertion is what keeps the decline.
  if (isProvablyStringOperand(body)) return false;
  return (
    body.type.matches('list<any>') ||
    body.type.matches('indexed_collection<any>') ||
    isPossiblyCollectionTypedJS(body)
  );
}

/**
 * The lane an UNROLLED `Sum`/`Product` clause takes: `false` when the
 * index-masked analysis calls the body complex while EVERY term is real under
 * its own index value, `undefined` otherwise.
 *
 * An unrolled term binds the index at the emitted-CODE level, so the analysis
 * reads a body in which the index is still free and cannot decide the sign of
 * a radicand such as `1 − 0.025²(i − 0.5)²`. With the term's own value the
 * radicand is a closed constant, and the terms are real arithmetic instead of
 * `_SYS.csqrt` over `{re, im}` pairs.
 *
 * The verdict is adopted only when every term AGREES, because the terms feed
 * one accumulator, which holds plain numbers or `{re, im}` objects and never a
 * mix.
 *
 * Answering only `false`-or-`undefined` is what keeps this in step with the
 * emitter's other unroll conditions: `isElementwiseBigOpBody` is false
 * whenever the masked verdict is complex, so a clause this function decides
 * can never be the element-wise one, and the remaining conditions (constant
 * bounds, term count, iteration budget) are tested here with the same
 * helpers the emitter uses.
 *
 * Both `emitSumProduct` and `BaseCompiler.isComplexValued` — the parent's
 * question about the whole `Sum` — come through here, so the emitted terms
 * and the shape the enclosing expression expects cannot drift apart.
 */
function unrolledClauseLane(
  body: Expression,
  indices: ReadonlyArray<string>,
  index: string,
  lowerNum: number,
  upperNum: number,
  target: CompileTarget<Expression>
): boolean | undefined {
  const termCount = upperNum - lowerNum + 1;
  if (termCount < 1 || termCount > UNROLL_LIMIT) return undefined;
  const budget = target.iterationBudget;
  if (budget !== undefined && !(upperNum - lowerNum < budget)) return undefined;
  if (!BaseCompiler.isComplexValuedUnderIndices(body, indices))
    return undefined;
  for (let k = lowerNum; k <= upperNum; k++) {
    const complex = BaseCompiler.withUnrolledIndexValues(
      new Map([[index, k]]),
      () => BaseCompiler.isComplexValuedUnderIndices(body, indices)
    );
    if (complex) return undefined;
  }
  return false;
}

/**
 * {@link unrolledClauseLane} for a whole `Sum`/`Product` NODE, as
 * `BaseCompiler.isComplexValued` asks it. Restricted to a single indexing
 * set: a multi-clause node's inner clauses are unrolled or looped by their
 * own nested emission, which this reading does not model.
 */
function unrolledBigOpLane(expr: Expression): boolean | undefined {
  if (!isFunction(expr) || expr.ops.length !== 2) return undefined;
  if (expr.operator !== 'Sum' && expr.operator !== 'Product') return undefined;
  const target = BaseCompiler.oracleFoldTarget;
  if (target === undefined) return undefined;
  const limits = expr.ops[1];
  if (!isFunction(limits, 'Limits')) return undefined;
  const { index, lowerExpr, upperExpr } = extractLimits(limits);
  if (index === '_') return undefined;
  const lowerNum = BaseCompiler.bigOpBoundConstant(lowerExpr, target);
  const upperNum = BaseCompiler.bigOpBoundConstant(upperExpr, target);
  if (lowerNum === undefined || upperNum === undefined) return undefined;
  return unrolledClauseLane(
    expr.ops[0],
    [index],
    index,
    lowerNum,
    upperNum,
    target
  );
}

installUnrolledBigOpLane(unrolledBigOpLane);

function emitSumProduct(
  kind: 'Sum' | 'Product',
  body: Expression,
  clauses: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  /** `false` for the nested invocation of a multi-clause node's inner
   * clauses, whose lane the whole-node reading above does not model. */
  isRootClause = true
): string {
  const statements = javascriptStatements(target);
  const expression = (
    build: (exit: (value: string) => string) => string
  ): string =>
    statements?.expression(build) ??
    `(() => { ${build((v) => `return ${v};`)} })()`;
  const initialize = (name: string, value: string): string =>
    statements?.initialize(name, value) ?? `const ${name} = ${value};`;
  // A collection-valued body: element-wise accumulation (the interpreter's
  // zip-broadcast big op — `Σ_k (L + k)` over a 3-list is a 3-list). The body
  // is evaluated WHOLE each iteration and folded through `_SYS.bcast`, so a
  // scalar-at-runtime body stays scalar, cells zip position-wise, and a
  // length mismatch projects to NaN. An empty range answers the scalar
  // identity (0 / 1), matching the interpreter; a BARE collection body never
  // reaches here (it canonicalizes to the `Reduce` collection-reduce form).
  // Everything else keeps the fail-closed assert (Tycho item 45).
  // The body is analyzed with every clause's index bound (Tycho item 252):
  // this emitter runs before the index is bound in the compile target, and
  // an unmasked analysis resolves an index named `i` through the ENGINE,
  // where `i` is the imaginary unit. The constant fold then evaluated
  // `k[i]` to `NaN`, a plain real, and the fold-before-shape override
  // reported the radical `√(9.81 / k[i])` real — so the terms were emitted
  // complex (each term is compiled with the index bound) and joined with
  // the real `+`, which string-concatenates `{re, im}` objects. The same
  // mask is what `isComplexValued` applies to the whole `Sum`, so the
  // emitter and the enclosing expression agree on the accumulator's shape.
  const indices = clauses.map((c) => extractLimits(c).index);
  const elementwiseBody = isElementwiseBigOpBody(body, indices);
  if (!elementwiseBody) BaseCompiler.assertScalarBigOpBody(kind, body);

  const { index, lowerExpr, upperExpr } = extractLimits(clauses[0]);
  const lowerNum = BaseCompiler.bigOpBoundConstant(lowerExpr, target);
  const upperNum = BaseCompiler.bigOpBoundConstant(upperExpr, target);

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
  const bodyIsComplex = BaseCompiler.isComplexValuedUnderIndices(body, indices);

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
      ? emitSumProduct(kind, body, rest, innerTarget, false)
      : BaseCompiler.compileOp(sumNode, 0, innerTarget, 0, body);

  const bothConstant = lowerNum !== undefined && upperNum !== undefined;
  const budget = target.iterationBudget;
  const withinBudget =
    budget === undefined || (bothConstant && upperNum - lowerNum < budget);

  // Empty range (only knowable when both bounds are constant)
  if (bothConstant && withinBudget && lowerNum > upperNum) return identity;

  // Unroll when both bounds are constant and range is small. The element-wise
  // arm never unrolls: joining array terms with the bare scalar operator
  // would string-concatenate them — it always takes the `_SYS.bcast` fold
  // loop below.
  if (bothConstant && withinBudget && !elementwiseBody) {
    const termCount = upperNum - lowerNum + 1;
    if (termCount <= UNROLL_LIMIT) {
      // `bodyIsComplex` above read the body with the index merely MASKED. The
      // unrolled terms bind it to a literal integer, which can settle a sign
      // the masked reading cannot — see `unrolledClauseLane`, which
      // `BaseCompiler.isComplexValued` reads for the whole node as well, so
      // the terms and the shape the enclosing expression expects agree. Only
      // the ROOT clause of a single-indexing-set node is decided this way.
      const indexValues = (k: number): ReadonlyMap<string, number> =>
        new Map([[index, k]]);
      const lane =
        isRootClause && rest.length === 0
          ? unrolledClauseLane(body, indices, index, lowerNum, upperNum, target)
          : undefined;
      const useIndexValues = lane !== undefined;
      const unrolledIsComplex = lane ?? bodyIsComplex;
      const emitTerms = (): string[] => {
        const terms: string[] = [];
        for (let k = lowerNum; k <= upperNum; k++) {
          const innerTarget: CompileTarget<Expression> = {
            ...target,
            var: (id) => (id === index ? String(k) : target.var(id)),
            boundVars: BaseCompiler.withBoundNames(target, [index]),
          };
          recordIntegerRange(innerTarget, index, k, k);
          const term = useIndexValues
            ? BaseCompiler.withUnrolledIndexValues(indexValues(k), () =>
                compileTerm(innerTarget)
              )
            : compileTerm(innerTarget);
          terms.push(statements?.parenthesize(term) ?? `(${term})`);
        }
        return terms;
      };

      // Every index the unrolled terms vary — this clause's plus the nested
      // clauses', which the terms unroll or loop over in turn.
      const indexNames = [index, ...rest.map((c) => extractLimits(c).index)];

      // Only the INNERMOST clause hoists (`rest` empty): its terms are the
      // body itself, and an unrolled clause runs every one of them, so a
      // binding emitted before the terms is evaluated exactly when the body
      // is. An outer clause's terms are nested sums whose own ranges may be
      // empty at run time, so a binding hoisted above them could be
      // evaluated when the body never runs — an error it raises would be
      // new. The nested clause hoists for itself, once per outer term.
      const asStatements = termCount >= UNROLL_STATEMENT_MIN_TERMS;
      const { bindings, result: terms } =
        asStatements && rest.length === 0
          ? BaseCompiler.hoistLoopInvariants(body, [index], target, emitTerms)
          : { bindings: [], result: emitTerms() };

      const hoisted = bindings
        .map(([name, code]) => `const ${name} = ${code}; `)
        .join('');

      if (!unrolledIsComplex) {
        if (!asStatements) return `(${terms.join(` ${op} `)})`;

        // May the accumulation stop at the first NaN? Only if skipping the
        // remaining terms is unobservable — a term with an observable effect
        // can count its own calls or mutate shared state, so it has to run as
        // many times as the flat chain ran it. The question is EFFECTS, not
        // who supplied the code: `isEmissionSkippable` asks each spelling's
        // purity oracle (a `functions` entry's declared or inferred purity,
        // the definition behind a caller `compile` handler, `isPure` for
        // everything else) and refuses a spelling no oracle can answer for.
        // The trees a term emits are the body plus the bounds of the nested
        // clauses it unrolls or loops over.
        //
        // The exit is an OPTIMIZATION, never a correctness device: NaN absorbs
        // both `+` and `*`, so the accumulator ends at the same NaN whether or
        // not the remaining terms run. It therefore earns its per-term test
        // only when a term can carry NaN, and two facts together say it
        // cannot. The body's TYPE must be a `real` subtype — a `real` in this
        // lattice is finite, with no NaN and no infinity — which is the value
        // contract. The emitted terms must also be free of the NaN marker,
        // which is what catches the lowerings that answer NaN from a
        // NaN-free type: an undecided branch condition, a read past the end
        // of a collection. Only the INNERMOST clause is asked (`rest` empty),
        // where the term is the body itself; an outer clause's term is a
        // nested big operator, whose own bounds guard can answer NaN from a
        // body that never could.
        const termsExcludeNaN =
          rest.length === 0 &&
          body.type.matches('real') &&
          !terms.some((t) => t.includes('NaN'));
        const canExitEarly =
          !termsExcludeNaN &&
          BaseCompiler.isEmissionSkippable(
            [
              body,
              ...rest.flatMap((c) => {
                const l = extractLimits(c);
                return [l.lowerExpr, l.upperExpr];
              }),
            ],
            indexNames,
            target
          );

        // Accumulate in statements so the accumulator can be tested between
        // terms. Once it is NaN no remaining term can change the answer and
        // evaluating them is pure cost — the same exit the element-wise fold
        // loop below takes, in the same place (after each accumulation, before
        // the next term is reached). The test after the LAST accumulation is
        // omitted: `return` hands back the same NaN either way. Without
        // `canExitEarly` the statement form is still emitted — the hoisted
        // bindings need it — but every term runs.
        const acc = BaseCompiler.tempVar(target);
        return expression((exit) => {
          const stmts = [
            statements?.initialize(acc, terms[0], 'let') ??
              `let ${acc} = ${terms[0]};`,
          ];
          for (let i = 1; i < terms.length; i++) {
            if (canExitEarly)
              stmts.push(`if (${acc} !== ${acc}) ${exit('NaN')}`);
            stmts.push(
              statements?.consume(
                terms[i],
                (value) => `${acc} ${op}= ${value};`
              ) ?? `${acc} ${op}= ${terms[i]};`
            );
          }
          return `${hoisted}${stmts.join(' ')} ${exit(acc)}`;
        });
      }

      // One hygienic temporary per term: a fixed spelling such as `_t0`
      // is re-declared by an unrolled complex Sum nested inside another one
      // (the inner block shadows the outer term before the outer sum reads
      // it, and the emitted code throws reading `.re` of `undefined`).
      const temps = terms.map(() => BaseCompiler.tempVar(target));
      const assignments = (): string =>
        terms.map((term, i) => initialize(temps[i], term)).join(' ');

      if (isSum) {
        const reSum = temps.map((t) => `${t}.re`).join(' + ');
        const imSum = temps.map((t) => `${t}.im`).join(' + ');
        return expression(
          (exit) =>
            `${hoisted}${assignments()} ${exit(`{ re: ${reSum}, im: ${imSum} }`)}`
        );
      }

      let acc = temps[0];
      const parts: string[] = [];
      for (let i = 1; i < temps.length; i++) {
        const prev = acc;
        acc = `_p${i}`;
        parts.push(
          `const ${acc} = { re: ${prev}.re * ${temps[i]}.re - ${prev}.im * ${temps[i]}.im, im: ${prev}.re * ${temps[i]}.im + ${prev}.im * ${temps[i]}.re };`
        );
      }
      return expression(
        (exit) => `${hoisted}${assignments()} ${parts.join(' ')} ${exit(acc)}`
      );
    }
  }

  // Emit a loop (either large constant range or symbolic bounds)
  const lowerCode = compileBound(lowerExpr, lowerNum, target);
  const upperCode = compileBound(upperExpr, upperNum, target);

  // Loop-invariant subexpressions of the body — a collection it rebuilds, a
  // reduction over one (`Min(P)`, `Length(P)`) — are computed once before
  // the loop, not once per iteration (Tycho item 248: a body reading
  // `Min(P_0)` at every iteration ran a full pass over the 10 000-element
  // list per iteration, so the loop was quadratic). A subexpression free of
  // this clause's index has the same value in every iteration.
  //
  // Only the INNERMOST clause hoists (`rest` empty). Its empty-range return
  // below is exactly the test for "the body runs zero times", so a binding
  // placed after it is evaluated exactly when the body is. An outer clause's
  // term is a nested sum whose own range may be empty at run time, so a
  // binding hoisted above it could be evaluated when the body never runs —
  // an error it raises would be new. The nested clause hoists for itself,
  // once per outer iteration; an expression invariant in every index is then
  // recomputed once per outer iteration, never per innermost one.
  const innerTarget: CompileTarget<Expression> = {
    ...target,
    var: (id) => (id === index ? index : target.var(id)),
    boundVars: BaseCompiler.withBoundNames(target, [index]),
  };
  if (BaseCompiler.isEmissionSkippable([body], indices, target)) {
    // Inspect only a complete numeric spelling, optionally floored by
    // compileBound; a numeric prefix of runtime code is not a constant.
    const bound = (code: string): number =>
      Math.floor(Number(code.replace(/^Math\.floor\(([^()]*)\)$/, '$1')));
    recordIntegerRange(innerTarget, index, bound(lowerCode), bound(upperCode));
  }
  const { bindings: hoistedBindings, result: bodyCode } =
    rest.length === 0
      ? BaseCompiler.hoistLoopInvariants(body, [index], target, () =>
          compileTerm(innerTarget)
        )
      : { bindings: [], result: compileTerm(innerTarget) };
  // The bindings follow the loop-entry guard and an EMPTY-RANGE return: a
  // range that runs zero iterations never evaluated the body, so it must not
  // evaluate the body's subexpressions either (an error they raise would be
  // new). `empty` is what the loop answers for an empty range — its identity,
  // in the arm's own shape. With no bindings the emission is unchanged.
  const hoistPrelude = (
    empty: string,
    exit: (value: string) => string
  ): string =>
    hoistedBindings.length === 0
      ? ''
      : `if (!(${index} <= _upper)) ${exit(empty)} ` +
        hoistedBindings
          .map(([name, code]) => `${initialize(name, code)} `)
          .join('');

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
  const guardNaN = (nan: string, exit: (value: string) => string): string => {
    if (budget !== undefined)
      return `if (!(_upper - ${index} < ${budget})) ${exit(nan)} `;
    const checks = [
      ...(upperNum === undefined ? ['!Number.isFinite(_upper)'] : []),
      ...(lowerNum === undefined ? [`!Number.isFinite(${index})`] : []),
    ];
    return checks.length > 0 ? `if (${checks.join(' || ')}) ${exit(nan)} ` : '';
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
    // projects to the stable scalar NaN — the same mismatch projection as
    // `_SYS.select`. (At this ABI an error and a legitimate NaN are
    // indistinguishable, so a genuinely-NaN scalar term followed by array
    // terms also latches — the standing error-vs-NaN seam, tracked in
    // ROADMAP. `${acc} !== ${acc}` is false for an array, true only for NaN.)
    //
    // The latch has two separable jobs, and only one of them may skip work.
    // Projecting the SHAPE is unconditional — it is what makes the result
    // independent of which term came last. STOPPING the loop is an
    // optimization, and it is only sound when the terms it skips have no
    // observable effect, exactly as the two scalar arms above ask through
    // `isEmissionSkippable`. So an effectful body keeps iterating and
    // remembers the mismatch in a flag, answering the same scalar NaN at the
    // end: `Sum(Random()·[1,1], n=1..31)` draws 31 times either way, while a
    // pure body still exits at the first NaN. The gate is the same call the
    // loop arm makes below, on the same trees.
    const elementwiseExit = BaseCompiler.isEmissionSkippable(
      [
        body,
        ...rest.flatMap((c) => {
          const l = extractLimits(c);
          return [l.lowerExpr, l.upperExpr];
        }),
      ],
      [index, ...rest.map((c) => extractLimits(c).index)],
      target
    );
    const fold = `${acc} = ${acc} === null ? (Array.isArray(${val}) ? ${val}.slice() : ${val}) : _SYS.bcast((_a, _b) => _a ${op} _b, ${acc}, ${val});`;
    if (elementwiseExit)
      return expression(
        (exit) =>
          `let ${acc} = null; let ${index} = ${lowerCode}; const _upper = ${upperCode}; ${guardNaN('NaN', exit)}${hoistPrelude(identity, exit)}while (${index} <= _upper) { ${initialize(val, bodyCode)} ${fold} if (${acc} !== ${acc}) ${exit('NaN')} ${index}++; } ${exit(`${acc} === null ? ${identity} : ${acc}`)}`
      );
    // The flag, not the accumulator, carries the verdict to the end: once the
    // fold has collapsed to a scalar NaN the following iteration broadcasts it
    // back over the next term's shape, so `${acc}` is an array again by the
    // time the loop finishes and cannot be re-tested for it.
    const latched = BaseCompiler.tempVar(target);
    return expression(
      (exit) =>
        `let ${acc} = null; let ${latched} = false; let ${index} = ${lowerCode}; const _upper = ${upperCode}; ${guardNaN('NaN', exit)}${hoistPrelude(identity, exit)}while (${index} <= _upper) { ${initialize(val, bodyCode)} ${fold} if (${acc} !== ${acc}) ${latched} = true; ${index}++; } ${exit(`${latched} ? NaN : (${acc} === null ? ${identity} : ${acc})`)}`
    );
  }

  if (bodyIsComplex) {
    const val = BaseCompiler.tempVar(target);
    if (isSum) {
      return expression(
        (exit) =>
          `let ${acc} = { re: 0, im: 0 }; let ${index} = ${lowerCode}; const _upper = ${upperCode}; ${guardNaN('{ re: NaN, im: NaN }', exit)}${hoistPrelude('{ re: 0, im: 0 }', exit)}while (${index} <= _upper) { ${initialize(val, bodyCode)} ${acc} = { re: ${acc}.re + ${val}.re, im: ${acc}.im + ${val}.im }; ${index}++; } ${exit(acc)}`
      );
    }
    return expression(
      (exit) =>
        `let ${acc} = { re: 1, im: 0 }; let ${index} = ${lowerCode}; const _upper = ${upperCode}; ${guardNaN('{ re: NaN, im: NaN }', exit)}${hoistPrelude('{ re: 1, im: 0 }', exit)}while (${index} <= _upper) { ${initialize(val, bodyCode)} ${acc} = { re: ${acc}.re * ${val}.re - ${acc}.im * ${val}.im, im: ${acc}.re * ${val}.im + ${acc}.im * ${val}.re }; ${index}++; } ${exit(acc)}`
    );
  }

  // The scalar loop's NaN exit, the same one the unrolled statement form and
  // the element-wise fold carry: NaN absorbs both `+` and `*`, so once the
  // accumulator is NaN no remaining iteration can change the answer and
  // running them is pure cost — unbounded cost, since this arm is reached
  // precisely when the trip count is large or symbolic. Gated exactly as the
  // unroll arm's exit is: an iteration with an observable effect can count its
  // own calls or mutate shared state, so it has to run as many times as the
  // unguarded loop ran it. The trees an iteration emits are the body
  // plus the bounds of the nested clauses it loops over (evaluated per outer
  // iteration); this clause's own bounds are computed once, outside the loop.
  const loopExit = BaseCompiler.isEmissionSkippable(
    [
      body,
      ...rest.flatMap((c) => {
        const l = extractLimits(c);
        return [l.lowerExpr, l.upperExpr];
      }),
    ],
    [index, ...rest.map((c) => extractLimits(c).index)],
    target
  );

  return expression((exit) => {
    const term =
      statements?.consume(bodyCode, (value) => `${acc} ${op}= ${value};`) ??
      `${acc} ${op}= ${bodyCode};`;
    return `let ${acc} = ${identity}; let ${index} = ${lowerCode}; const _upper = ${upperCode}; ${guardNaN('NaN', exit)}${hoistPrelude(identity, exit)}while (${index} <= _upper) { ${term} ${loopExit ? `if (${acc} !== ${acc}) ${exit('NaN')} ` : ''}${index}++; } ${exit(acc)}`;
  });
}

/**
 * Deepest chain of `Integrate` nodes in `expr`'s tree, counted in integration
 * LEVELS: one per limit clause of each node, accumulated through integrals
 * nested inside other integrals' integrands or bounds (an inner integral runs
 * once per enclosing panel node, so those levels multiply).
 *
 * `compileIntegrate` sizes each level's starting-panel count from this depth.
 * Composition through a FUNCTION CALL (`∫ g(x) dx` where `g`'s body computes an
 * integral) is invisible here — no `Integrate` node is in the tree — and is
 * bounded at run time instead, by `NESTED_QUADRATURE_BUDGET`.
 *
 * The memo is sound unconditionally: the depth is a function of the expression
 * tree alone (operator names and arity — no bindings, no definitions), and
 * boxed expressions are immutable.
 */
const INTEGRATE_DEPTH = new WeakMap<Expression, number>();

function integrateDepth(expr: Expression): number {
  const cached = INTEGRATE_DEPTH.get(expr);
  if (cached !== undefined) return cached;
  let depth = 0;
  if (isFunction(expr)) {
    for (const op of expr.ops) depth = Math.max(depth, integrateDepth(op));
    // One integration level per limit clause; a bare `Integrate(f)` (no clause)
    // is indefinite and never reaches the quadrature emitter, but count it as
    // one level so the estimate stays conservative.
    if (expr.operator === 'Integrate') depth += Math.max(1, expr.nops - 1);
  }
  INTEGRATE_DEPTH.set(expr, depth);
  return depth;
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
 * Compile `Integrate(f, (x, a, b))`.
 *
 * **Antiderivative-first.** The integral is first resolved symbolically via
 * `evaluate()` (the provider/Rubi + built-in antiderivative + FTC). If it
 * closes to a form free of any residual `Integrate` — e.g. a plotted
 * `∫₀ˣ f(t) dt` whose closed form is a function of the free bound `x` — that
 * straight-line expression is compiled directly, so each sample costs ~µs
 * instead of a full quadrature. The attempt itself lives in
 * `BaseCompiler.closedFormIntegral` (shared with the interval target, which
 * runs the same step ahead of its own enclosure emitter): it is bounded by its
 * own wall-clock span, so a non-elementary integrand degrades to quadrature
 * rather than hanging, and it declines outright when the integral references a
 * `vars`-mapped symbol, which must survive to run time as a live input (the
 * vars contract) rather than be folded into a baked closed form.
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
  const closed = BaseCompiler.closedFormIntegral(args, target);
  if (closed !== undefined) {
    try {
      // Parenthesize: the closed form can be a low-precedence expression
      // (e.g. an `Add`), whereas the caller splices this handler's result as
      // an atomic operand (like the `_SYS.integrate(…)` call it replaces).
      return `(${compile(closed)})`;
    } catch {
      // Unlowerable head: fall through to quadrature below.
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

  // The integrand as a body in the limits' index variables: a `Function`
  // integrand is unwrapped, its parameters matched to the limits by name (a
  // mismatch fails closed — see `BaseCompiler.integrandLambda`).
  const { lambdaVars, bodyExpr } = BaseCompiler.integrandLambda(
    args[0],
    limits.map((l) => l.index)
  );

  // Starting-panel count per level, sized by the nesting depth the TREE shows
  // — this node's own limits plus the deepest chain of `Integrate` nodes
  // inside its integrand or bounds. One full inner quadrature runs per outer
  // panel node, so a per-level count of N costs N^depth evaluations before any
  // refinement: the quadrature default of 16 panels makes a smooth triple
  // integral cost 1.4·10⁷ integrand evaluations (~1 s) where 3 panels per
  // level cost ~10⁵ and refine to the same tolerance. This mirrors the
  // interpreter, which seeds `initialPanelsForDimensions(limits.length)`
  // (`library/calculus.ts`), and the interval target, which sizes its
  // subdivision count the same way (`compileIntervalIntegrate`).
  //
  // The OUTERMOST integral of a nest measures the whole subtree and every
  // inner lowering inherits its count through `target.quadratureInitialPanels`
  // rather than re-measuring its own shallower subtree, which would pick a
  // larger count and break the product bound. Composition reached BY REFERENCE
  // (a compiled function whose body integrates) is invisible to this walk and
  // stays covered by the runtime budget — see `NESTED_QUADRATURE_BUDGET`.
  const panels =
    target.quadratureInitialPanels ??
    initialPanelsForDimensions(
      limits.length + Math.max(0, ...args.map(integrateDepth))
    );

  // Everything compiled within this integral — the integrand and every bound —
  // inherits the chosen count.
  const sized: CompileTarget<Expression> = {
    ...target,
    quadratureInitialPanels: panels,
  };

  const scoped = (names: string[]): CompileTarget<Expression> => ({
    ...sized,
    var: (id) => (names.includes(id) ? id : target.var(id)),
    boundVars: BaseCompiler.withBoundNames(target, names),
  });

  const f = BaseCompiler.compile(bodyExpr, scoped(lambdaVars));

  // Multiple limits nest, innermost last (Mathematica iterator convention:
  // the FIRST limit is the OUTERMOST integral). A bound of limit d may
  // reference the outer lambda variables 0..d−1 — at its nesting depth they
  // are in scope, so dependent bounds (∫₀¹dx ∫₀ˣdy) compile naturally.
  const isMC = target.quadrature === 'monte-carlo';
  const fn = isMC ? '_SYS.integrateMC' : '_SYS.integrate';
  // The Monte-Carlo estimator has no panels to seed, and a single integral
  // seeds the quadrature default — in both cases the argument would say
  // nothing, so leave it off and keep the emitted call as it was.
  const panelArg =
    isMC || panels === initialPanelsForDimensions(1) ? '' : `, ${panels}`;
  let code = f;
  for (let d = limits.length - 1; d >= 0; d--) {
    const outer = lambdaVars.slice(0, d);
    const boundTarget = outer.length > 0 ? scoped(outer) : sized;
    const lo = BaseCompiler.compile(limits[d].lowerExpr, boundTarget);
    const hi = BaseCompiler.compile(limits[d].upperExpr, boundTarget);
    code = `${fn}((${lambdaVars[d]}) => (${code}), ${lo}, ${hi}${panelArg})`;
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

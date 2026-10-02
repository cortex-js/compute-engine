import { derivativeClosedForm } from './derivative-closed-form.js';
import {
  makeSysHelpers,
  normalizeRunResult,
  isComplexObject,
  isUnsignedPole,
  isNumericTypedArray,
  copyToPlainArray,
  setNestedQuadratureBudget,
  RUNTIME_VERSION,
  type RuntimeSource,
  type SysHelpers,
} from './javascript-runtime.js';
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
  provenPointWidth,
  canIndexArrayDirectly,
  isConstructedScalar,
  isScalarValue,
  isDecidedLoopIndex,
  numericArrayCells,
  recordIntegerRange,
  recordScalarParams,
} from './javascript-value-facts.js';
import { compileWithAutoEscalation } from './auto-escalation.js';
import { withVarsValuesHidden } from './vars-inputs.js';
import {
  assertAccumulatorFitsStep,
  inPlaceUpdateChains,
  isDefinitelyCollectionType,
} from './in-place-update.js';
import { resolveStorageHints } from './storage-hints.js';
import {
  isExpression,
  isSymbol,
  isNumber,
  isFunction,
  isString,
} from '../boxed-expression/type-guards.js';
import {
  functionLiteralBoundNames,
  functionLiteralParameterName,
} from '../boxed-expression/function-literal.js';
import {
  provableApplicationKind,
  provableTopLevelKind,
  userFunctionLiteral,
} from './provable-kind.js';
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
  functionResult,
  containsBroadcastableType,
  finitePartOfType,
  isNonRealNumber,
  isPointElementType,
  resolveTypeAlias,
  resolveTypeForCompilation,
  stripMissingFromType,
  typeContainsMissing,
  unfoldAliasOnDescent,
  type AliasDescent,
} from '../../common/type/utils.js';
import { couldMatch, isSubtype } from '../../common/type/subtype.js';
import type { Type, TupleType } from '../../common/type/types.js';
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

/**
 * Does this operand's TYPE say it is a LIST OF POINTS — `list<tuple<…>>`,
 * which `PointList(1, L)` with a collection component reports and which a
 * literal `[(1, 2), (3, 4)]` reports too?
 *
 * Read from the type alone, because that is what the emitted shape follows: a
 * list of points compiles to an array of arrays, and the `Dot` lowering must
 * decide which of its two operands is the list BEFORE either is compiled. A
 * matrix (`list<list<number>>`) is excluded, because its element type is a
 * list and not a tuple, so it keeps the matrix product.
 *
 * A TUPLE is excluded as well, even when its own coordinates are tuples: the
 * interpreter reads `((1, 2), (3, 4))` as ONE point with nested coordinates,
 * which `Norm` flattens and `PointX` indexes, so it is not a list of points
 * here either.
 */
function isPointListOperandType(expr: Expression): boolean {
  if (isPointOperandType(expr)) return false;
  const elt = collectionElementType(jsType(expr));
  if (elt === undefined) return false;
  const r = resolveTypeForCompilation(elt);
  return r === 'tuple' || (typeof r !== 'string' && r.kind === 'tuple');
}

/**
 * Does this `Distance` operand's TYPE say it is a LIST of points, once its
 * `missing` arms are removed? This is the test that the interpreter's
 * `Distance` type handler applies (`isPointListType` in
 * `library/arithmetic.ts`), so the compiled absence marker agrees with the
 * interpreter's result type: `undefined` (the run-time spelling of
 * `Missing`) for a list of distances, `NaN` for one distance.
 *
 * A list of points is a list whose elements are tuples, a list whose
 * elements are numeric lists (each row is one point), or a numeric matrix,
 * whose element type is the scalar and whose dimensions give the rows. A
 * tuple is always ONE point, even when its coordinates are collections. A
 * list whose element type is unknown gives `false`: the interpreter does not
 * type it as a list either.
 */
function isDistancePointListOperand(expr: Expression): boolean {
  const t = resolveTypeForCompilation(stripMissingFromType(jsType(expr)));
  if (typeof t !== 'string' && t.kind === 'tuple') return false;
  if (t === 'tuple') return false;
  if (
    typeof t !== 'string' &&
    t.kind === 'list' &&
    (t.dimensions?.length ?? 0) >= 2
  )
    return true;
  const elt = collectionElementType(t);
  if (elt === undefined) return false;
  const e = resolveTypeAlias(elt);
  if (
    e === 'unknown' ||
    e === 'any' ||
    e === 'missing' ||
    e === 'never' ||
    e === 'nothing'
  )
    return false;
  return isSubtype(elt, INDEXED_COLLECTION_SHAPE_TYPE);
}

/** Does this operand's TYPE say it is a POINT — a tuple, of any width? */
function isPointOperandType(expr: Expression): boolean {
  const t = jsType(expr);
  return t === 'tuple' || (typeof t !== 'string' && t.kind === 'tuple');
}

/**
 * The COORDINATE TYPES of a `Dot` operand that is a point or a list of
 * points — every alternative's every component — or `undefined` when the
 * operand's type does not name them (a bare `tuple`, a nominal reference, a
 * union with a non-tuple arm).
 *
 * The point-list broadcast multiplies coordinate by coordinate, so this is
 * what says whether the emitted `*` and `+` are the right operators for the
 * values that will arrive.
 */
function pointOperandCoordinateTypes(expr: Expression): Type[] | undefined {
  const t = jsType(expr);
  const point = isPointListOperandType(expr) ? collectionElementType(t) : t;
  if (point === undefined) return undefined;
  const arms = pointTypeAlternatives(point);
  if (arms === undefined) return undefined;
  return arms.flatMap((arm) => arm.elements.map((e) => e.type));
}

/**
 * Is every value of this coordinate type a NUMBER — so that the emitted `*`
 * and `+` are the operators the interpreter would apply?
 *
 * A union answers only when every arm does. A string, a list and an open type
 * (`unknown`) all answer `false`: the interpreter's point-list broadcast
 * requires every component to be a number literal and leaves the product
 * symbolic otherwise (`pointListDotProduct`, `library/linear-algebra.ts`),
 * while `"1" * "2"` in JavaScript quietly answers `2`.
 *
 * This is the numeric half of the test
 * `BaseCompiler.compileBroadcastInnerProduct` applies to the TUPLE spelling
 * of the same product, narrowed: that path admits a coordinate that is a
 * collection of numbers, because it broadcasts the coordinate itself, and
 * this one does not.
 */
function isNumberCoordinateType(t: Type): boolean {
  const r = resolveTypeForCompilation(t);
  if (typeof r !== 'string' && r.kind === 'union')
    return r.types.every(isNumberCoordinateType);
  return isSubtype(r, 'number');
}

/**
 * The tuple alternatives of a POINT-typed operand: one for a tuple type, one
 * per arm for a union whose every arm is a tuple, `undefined` for anything
 * else (a scalar, a list, a union with a non-tuple arm). Aliases are
 * resolved; a nominal reference stays opaque.
 */
function pointTypeAlternatives(t: Type): TupleType[] | undefined {
  const r = resolveTypeForCompilation(t);
  if (typeof r === 'string') return undefined;
  if (r.kind === 'tuple') return [r];
  if (r.kind !== 'union') return undefined;
  const arms: TupleType[] = [];
  for (const arm of r.types) {
    const a = resolveTypeForCompilation(arm);
    if (typeof a === 'string' || a.kind !== 'tuple') return undefined;
    arms.push(a);
  }
  return arms.length > 0 ? arms : undefined;
}

/**
 * How the `Norm` lowering reads one coordinate of an UNWRITTEN point, decided
 * from the coordinate's static type:
 *
 * - `'scalar'` — provably a scalar: read as is.
 * - `'point'` — a tuple: a nested point, read whole (its components join the
 *   vector, as the interpreter flattens it).
 * - `'source'` — every other type: a collection (`list<number>`,
 *   `broadcastable<number>`, `list<number> | number`), or an open type
 *   (`unknown`, `indexed_collection<number>`). The interpreter reads a point
 *   with a list coordinate as one point per element, so the coordinate is a
 *   source of `_SYS.bcast` and the norm is computed once per element.
 *
 * A compiled array carries no tuple-versus-list tag, so a value of an OPEN
 * coordinate type is read the way every other compiled array is — as a list.
 * The compiled arithmetic already reads it so (`_SYS.bcast` descends into a
 * nested array whatever the interpreter called it), and the one value where
 * the interpreter reads differently, a nested point at a coordinate typed
 * `unknown` (`((1, 2), 3)`, flattened into one norm there), is not a value
 * the plotting consumers produce; declining every untyped point parameter
 * to guard it would refuse the commonest shape a document function has
 * (user ruling 2026-09-11, recorded in `docs/COMPILATION-MODEL.md`,
 * "Collections").
 */
type PointCoordinateKind = 'scalar' | 'point' | 'source' | 'refused';

/**
 * A `'refused'` coordinate is a collection whose ELEMENTS are known not to
 * be scalars (`list<tuple<number, number>>`, `broadcastable<list<number>>`):
 * `_SYS.bcast` would descend into each element, reading a point inside the
 * list as a list of its own. The written-`Tuple` lowering refuses the same
 * shape ("a collection of non-scalars"), and so does this one (fail closed,
 * D6). A collection whose element type is open (`list<unknown>`) is read
 * the way an open coordinate is.
 */
function pointCoordinateKind(elementType: Type): PointCoordinateKind {
  const et = resolveTypeForCompilation(elementType);
  if (isSubtype(et, 'scalar')) return 'scalar';
  if (et === 'tuple' || (typeof et !== 'string' && et.kind === 'tuple'))
    return 'point';
  if (
    typeof et !== 'string' &&
    (et.kind === 'list' ||
      et.kind === 'set' ||
      et.kind === 'collection' ||
      et.kind === 'indexed_collection' ||
      et.kind === 'broadcastable')
  ) {
    const el = resolveTypeForCompilation(et.elements);
    const open = el === 'unknown' || el === 'any' || el === 'value';
    if (!open && !isSubtype(el, 'scalar')) return 'refused';
  }
  return 'source';
}

/**
 * The coordinate kinds of an UNWRITTEN point-typed operand — one entry per
 * coordinate, combined across the arms of a union of tuples — or `undefined`
 * when the operand is not such a point (a written `Tuple`/`PointList`, a
 * scalar, a list) or its arms disagree on the width, which no fixed
 * component list can read. Across arms a coordinate that is a source in any
 * arm is a source (`_SYS.bcast` takes a scalar source as is, and a nested
 * point is read as a list, as `pointCoordinateKind` explains); one that is a
 * point in some arm and a scalar elsewhere is read whole.
 */
function unwrittenPointCoordinateKinds(
  expr: Expression
): PointCoordinateKind[] | undefined {
  if (isFunction(expr, 'Tuple') || isFunction(expr, 'PointList'))
    return undefined;
  const arms = pointTypeAlternatives(jsType(expr));
  if (arms === undefined) return undefined;
  const width = arms[0].elements.length;
  if (arms.some((arm) => arm.elements.length !== width)) return undefined;
  const kinds: PointCoordinateKind[] = [];
  for (let i = 0; i < width; i++) {
    const seen = new Set(
      arms.map((arm) => pointCoordinateKind(arm.elements[i].type))
    );
    kinds.push(
      seen.has('refused')
        ? 'refused'
        : seen.has('source')
          ? 'source'
          : seen.has('point')
            ? 'point'
            : 'scalar'
    );
  }
  return kinds;
}

/**
 * May this operand's TYPE hold a point with a list at a coordinate —
 * `tuple<list<number>, number>`, `tuple<broadcastable<number>, …>`,
 * `tuple<unknown, unknown>`, a union of tuples one of which does — without
 * the point being written out as a `Tuple` literal
 * (`unwrittenPointCoordinateKinds` has a `'source'` entry)?
 *
 * The interpreter reads such a point as several points, one per element of
 * the list coordinate, and answers one norm per point. A written `Tuple`
 * decides that per component at compile time
 * (`pointHasBroadcastComponent`); an unwritten point (a parameter, a
 * difference of points) is read at run time by `broadcastPointNorm`. The
 * narrower `isUnwrittenPointWithCollectionComponent` — a coordinate PROVABLY
 * a collection — is what `Dot` fails closed on; read here it missed
 * `broadcastable` and `unknown` coordinates, and `_SYS.norm` then flattened
 * `[[−3, −2], 3]` into one norm behind `success: true`.
 */
function unwrittenPointMayBroadcast(expr: Expression): boolean {
  const kinds = unwrittenPointCoordinateKinds(expr);
  return kinds !== undefined && kinds.includes('source');
}

/**
 * Fail closed on an unwritten point one of whose coordinates is a
 * collection of non-scalars (`'refused'` in `unwrittenPointCoordinateKinds`).
 */
function assertPointCoordinatesBroadcastable(
  head: string,
  expr: Expression
): void {
  const kinds = unwrittenPointCoordinateKinds(expr);
  if (kinds !== undefined) {
    if (!kinds.includes('refused')) return;
    throw new Error(
      `Could not compile \`${head}\`: a point whose coordinate is a collection of ` +
        `non-scalars (a list of points): the run-time broadcast would ` +
        `descend into each element.`
    );
  }
  // A union of tuples of DIFFERENT widths has no fixed component list to
  // read, and `_SYS.norm` on the whole value would flatten a list
  // coordinate. Such a union with a list coordinate in any arm fails closed;
  // one whose every coordinate is a scalar or a nested point keeps the plain
  // norm, which flattens exactly as the interpreter does for those.
  if (isFunction(expr, 'Tuple') || isFunction(expr, 'PointList')) return;
  const arms = pointTypeAlternatives(jsType(expr));
  if (arms === undefined) return;
  const readable = arms.every((arm) =>
    arm.elements.every((el) => {
      const kind = pointCoordinateKind(el.type);
      return kind === 'scalar' || kind === 'point';
    })
  );
  if (readable) return;
  throw new Error(
    `Could not compile \`${head}\`: a point typed as a union of tuples of ` +
      `different widths with a collection coordinate: no fixed component ` +
      `list reads it, and the whole-value norm would flatten the ` +
      `coordinate.`
  );
}

/**
 * The norm of an unwritten point `pointCode` with a list coordinate
 * (`unwrittenPointMayBroadcast`), decided at run time: the point is bound
 * once, each `'source'` coordinate feeds `_SYS.bcast`, and the closure
 * rebuilds the point from the element parameters and the other coordinates
 * read off the bound point, so a scalar coordinate is one number and a
 * nested point contributes its Euclidean magnitude (`_SYS.norm` of it) —
 * what the interpreter's flattening amounts to for the default norm, and
 * what it does under an explicit order, where `_SYS.norm` given a nested
 * array would read the point as a matrix. `_SYS.bcast` applies the
 * scalar norm once when every source holds a number and once per element
 * otherwise (sources of different lengths answer NaN, the compiled spelling
 * of `incompatible-dimensions`). `_SYS.norm` on the point itself would
 * FLATTEN a list coordinate into the vector. The order (`orderCode`, a
 * p-norm's `p`) is bound once too, so an impure operand draws once.
 */
function broadcastPointNorm(
  pointCode: string,
  kinds: ReadonlyArray<PointCoordinateKind>,
  target: CompileTarget<Expression>,
  orderCode?: string
): string {
  const v = BaseCompiler.tempVar(target);
  const params: string[] = [];
  const sources: string[] = [];
  const components = kinds.map((kind, i) => {
    if (kind === 'point') return `_SYS.norm(${v}[${i}])`;
    if (kind !== 'source') return `${v}[${i}]`;
    const p = BaseCompiler.tempVar(target);
    params.push(p);
    sources.push(`${v}[${i}]`);
    return p;
  });
  const o = orderCode === undefined ? undefined : BaseCompiler.tempVar(target);
  const bound = o === undefined ? v : `${v}, ${o}`;
  const values = o === undefined ? pointCode : `${pointCode}, ${orderCode}`;
  const ord = o === undefined ? '' : `, ${o}`;
  return (
    `((${bound}) => _SYS.bcast((${params.join(', ')}) => ` +
    `_SYS.norm([${components.join(', ')}]${ord}), ` +
    `${sources.join(', ')}))(${values})`
  );
}

import { SMALL_INTEGER } from '../numerics/numeric.js';
import { readColorGamut } from '../numerics/color-conversion.js';
import { rangeCount } from '../numerics/range-count.js';
import { initialPanelsForDimensions } from '../numerics/gauss-kronrod.js';
import {
  MAX_CHUNK_COUNT,
  MAX_COLORMAP_SAMPLES,
  MAX_MATRIX_POWER_EXPONENT,
} from '../numerics/value-scaled-caps.js';
import { interval } from '../numerics/interval.js';
import { throwIfCallerCancellation } from '../../common/interruptible.js';

import {
  BaseCompiler,
  compilationType,
  couldBeCollectionParticipant,
  isFlatAllStringComparisonParticipant,
  isGatedIndexedCollection,
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
  type LoopInvariantBinding,
} from './base-compiler.js';
import { rewriteAngularUnit } from './angular-unit.js';
import { compileJetDerivative, jetDerivativeTarget } from './jet-derivative.js';
import {
  MIN_UNROLLED_WIDTH,
  overriddenCompilationHeads,
  unrollFixedWidthCollections,
} from './fixed-width-unroll.js';
import { compileDiagnosticOf } from './diagnostics.js';
import { colorSpaceOf, isColorValued } from './color-space-fact.js';
import type {
  CompileMode,
  CompileTarget,
  CompiledOperators,
  CompiledFunction,
  CompiledFunctions,
  LanguageTarget,
  CompilationOptions,
  CompilationResult,
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
  // The exact indeterminate form has only the IEEE `NaN` as a machine value.
  Indeterminate: 'Number.NaN',
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

/**
 * One `const` binding of an operand that has already been compiled.
 *
 * When the operand is itself a value computed after local bindings
 * (`boundJSResult`), the statement sink knows its statements and lays them out
 * in the enclosing block; the operand then contributes no closure of its own.
 * Anything else is bound with a plain `const`. A chain of such bindings is
 * therefore one block of straight-line statements however deeply the
 * expression nests.
 *
 * `name` must be a FRESH temporary (`BaseCompiler.tempVar`): the spliced form
 * opens a nested block, so a spelling that two levels share would let the
 * inner block's own `const` shadow the outer binding being assigned to, and
 * the assignment would throw at run time.
 */
function jsBinding(
  target: CompileTarget<Expression>,
  name: string,
  code: string
): string {
  return (
    javascriptStatements(target)?.initialize(name, code) ??
    `const ${name} = ${code};`
  );
}

/**
 * Prepare compiled operands for splicing into one emitted block.
 *
 * An operand that is a value computed after local bindings (`boundJSResult`)
 * would otherwise be nested inside the block as an immediately invoked
 * function. Here it is bound to a temporary whose statements come first, and
 * the caller splices the NAME.
 *
 * Evaluation order is the order of `codes`: every operand up to the last one
 * that needs lifting is bound, so none of them is left to be evaluated inside
 * an expression that runs after the lifted statements. Operands after that one
 * are passed through unchanged, which keeps the emission byte-identical when
 * nothing needs lifting at all.
 */
function liftJSOperands(
  target: CompileTarget<Expression>,
  codes: ReadonlyArray<string>
): { prelude: string; values: ReadonlyArray<string> } {
  const statements = javascriptStatements(target);
  let last = -1;
  if (statements !== undefined)
    codes.forEach((c, i) => {
      if (statements.has(c)) last = i;
    });
  if (last < 0) return { prelude: '', values: codes };
  const names = codes.map((c, i) =>
    i <= last ? BaseCompiler.tempVar(target) : c
  );
  return {
    prelude: codes
      .slice(0, last + 1)
      .map((c, i) => jsBinding(target, names[i], c))
      .join(' '),
    values: names,
  };
}

/**
 * Splice compiled operands into `build`, which uses each of them exactly once.
 *
 * The operands are lifted out of `build` (`liftJSOperands`) so a chain of
 * complex operations stays one block of straight-line statements instead of
 * gaining a closure at every level. A single operand needs no temporary at
 * all: its statements end on a value expression, and `build` is applied to
 * that expression directly.
 *
 * `build` must only assemble source: the statement sink renders a registered
 * form once for its expression spelling and again at every statement position
 * it reaches, so `build` is applied more than once. Compile any other operand
 * BEFORE the call and splice the resulting string.
 */
function spliceJSValues(
  target: CompileTarget<Expression>,
  codes: ReadonlyArray<string>,
  build: (values: ReadonlyArray<string>) => string
): string {
  const statements = javascriptStatements(target);
  if (statements === undefined || !codes.some((c) => statements.has(c)))
    return build(codes);
  if (codes.length === 1)
    return statements.expression((exit) =>
      statements.emit(codes[0], (value) => exit(build([value])))
    );
  const { prelude, values } = liftJSOperands(target, codes);
  return boundJSResult(target, prelude, build(values));
}

/**
 * A `_SYS.c…` runtime helper applied to one complex operand.
 *
 * The operand goes through the statement sink (`spliceJSValues`), so an
 * operand that is itself a chain of complex operations contributes its `const`
 * temporaries to the enclosing block instead of nesting a closure inside the
 * call argument. An operand that is an ordinary expression — a symbol, a
 * literal, `({ re: x, im: 0 })` — is spliced unchanged.
 */
function complexUnary(
  target: CompileTarget<Expression>,
  helper: string,
  code: string
): string {
  return spliceJSValues(target, [code], ([z]) => `${helper}(${z})`);
}

/**
 * A piece of source safe to prefix a member read (`.re`) to: parenthesized
 * unless it is already a single identifier.
 */
function jsAtom(code: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(code) ? code : `(${code})`;
}

/**
 * The two components of a complex operand whose value is known at compile
 * time — the imaginary unit, or a finite complex number literal — as numbers.
 * `undefined` for anything else.
 *
 * A product with such a factor scales its other operand by two CONSTANTS, so
 * the object holding those constants never has to be built and the two
 * multiplications fold (see the `Multiply` complex arm).
 */
function complexLiteralParts(
  x: Expression
): { re: number; im: number } | undefined {
  if (isSymbol(x, 'ImaginaryUnit')) return { re: 0, im: 1 };
  if (isNumber(x) && Number.isFinite(x.re) && Number.isFinite(x.im))
    return { re: x.re, im: x.im };
  return undefined;
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
  // Equal / NotEqual are NOT operators: they need the string, tuple and
  // collection gates and the absence guard of `compileJSEquality`, which
  // emits the exact `===`/`!==` for the scalar pairs that pass them.
  LessEqual: ['<=', 9],
  GreaterEqual: ['>=', 9],
  Less: ['<', 9],
  Greater: ['>', 9],
  And: ['&&', 4],
  Or: ['||', 3],
  Not: ['!', 14], // Unary operator
};

/**
 * Fail closed when EQUALITY (or the `IndexOf` element test) has a provably
 * string-valued operand — fully closed on any string evidence.
 *
 * Both lowerings are NUMERIC: equality is a raw `===` on the host values,
 * which skips the content conditioning (NFC, well-formed surrogates) the
 * interpreter applies before it compares text, and cannot bridge a character
 * against a one-cluster string (`_SYS.eqt` does both). An earlier tolerance
 * lowering (`Math.abs(a - b) <= tol`) was `NaN <= tol` on strings, so a
 * compiled `"a" == "a"` answered `false` and a string needle was never found
 * by `IndexOf`. String equality was never correct compiled, so admitting it is
 * a separate tier, not a soundness fix.
 *
 * The ORDERINGS are governed by the narrower `assertNoMixedStringOrdering`:
 * they emit a raw `<`, which the interpreter agrees with for strings.
 *
 * Evidence is tested per PARTICIPANT, not per operand: the `_SYS.eq`/`_SYS.neq`
 * runtime dispatch compares a list against a scalar ELEMENT-WISE and two lists
 * with the same numeric leaf, so a `list<string>` operand puts strings on the
 * numeric path even though its own type is not a subtype of `string`. That hole
 * let `Equal(["a"], ["a"])` compile to `false` (under the tolerance leaf of
 * the time) where the interpreter answers `True`.
 */
function assertNoStringOperand(
  kind: string,
  args: ReadonlyArray<Expression>
): void {
  if (args.some(isProvablyStringComparisonParticipant))
    throw new Error(
      `Could not compile \`${kind}\`: string-valued operands are not supported by ` +
        `this target (the lowering is numeric: a host \`===\` that skips the ` +
        `interpreter's text conditioning). The interpreter evaluates it instead.`
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
  // would otherwise have no text evidence and fall through to the numeric
  // lowering, which skips the interpreter's content conditioning (NFC), so
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
 *  - `_SYS.eq`/`_SYS.neq` reduce to the numeric leaf, which for two equal
 *    `dictionary<integer>` / `record{…}` values compares two distinct objects
 *    by identity → `false`, where the interpreter answers `True`;
 *  - a `tuple` lowers to a JS array, so `Equal(Tuple(1, 2), 1)` runs element-wise
 *    to `[true, false]` and `Equal(Tuple(1, 2), List(1, 2))` to `true`, where
 *    the interpreter answers `False` to both (a point binds atomically);
 *  - `IndexOf`'s element test compares by identity too, so a tuple needle is
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
      `Could not compile \`${kind}\`: a ${aggregate} participant. The interpreter ` +
        `compares it as ONE value, whereas the compiled kernels look inside ` +
        `its JavaScript representation: the numeric leaf answers \`false\` ` +
        `for two EQUAL dictionaries or records (two distinct objects are ` +
        `never \`===\`), and a tuple's JS array is mapped over element-wise ` +
        `(\`Equal(Tuple(1, 2), 1)\` → \`[true, false]\`) where a point binds ` +
        `atomically. The interpreter evaluates it instead.`
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
      `Could not compile \`${kind}\`: an ordering that mixes a string operand with ` +
        `an operand that is not provably a string. The interpreter leaves such ` +
        `a comparison symbolic (\`Less("a", 1)\` stays inert), whereas the ` +
        `emitted JavaScript \`<\` coerces and answers a plausible-looking ` +
        `\`false\`. An ordering whose operands are ALL provably strings does ` +
        `compile — the interpreter compares strings with the same \`<\`. The interpreter evaluates it instead.`
    );
}

/**
 * Operator heads whose JavaScript lowering always produces a NUMBER (a `NaN`
 * included) and never the absent value `undefined`. A free symbol read
 * (`_.x`) answers `undefined` when the caller omits it, and so may a user
 * function whose body returns a bare parameter, or an element read over a
 * generic list; an arithmetic or elementary head applied to such an operand
 * still answers a number, because JavaScript arithmetic on `undefined` is
 * `NaN`. `compileJSEquality` uses this to decide whether an exact `===`
 * needs an absence guard: two absent operands are `===` to each other, and
 * the interpreter answers `Missing` for `Equal(Missing, Missing)`, not `True`.
 */
const JS_ALWAYS_NUMBER_HEADS = new Set([
  'Add',
  'Subtract',
  'Multiply',
  'Divide',
  'Negate',
  'Power',
  'Square',
  'Sqrt',
  'Root',
  'Abs',
  'Floor',
  'Ceil',
  'Round',
  'Sign',
  'Mod',
  'Min',
  'Max',
  'Sum',
  'Product',
  'Length',
  'Exp',
  'Ln',
  'Log',
  'Sin',
  'Cos',
  'Tan',
  'Arctan',
  'Arctan2',
  'Arcsin',
  'Arccos',
  'Sinh',
  'Cosh',
  'Tanh',
  'Dot',
  'Norm',
  'Hypot',
  'Gamma',
  'Factorial',
  'Random',
  'RandomInteger',
]);

/** A JavaScript numeric literal as the compiler spells one (`3`, `-0.5`,
 * `1e-7`, `Infinity`, `NaN`). */
const JS_NUMERIC_LITERAL =
  /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$|^-?Infinity$|^NaN$/i;

/**
 * May this operand read the absent value `undefined` at run time? Never for:
 * a number literal; an application of a head in `JS_ALWAYS_NUMBER_HEADS`;
 * an operand whose EMITTED code is a numeric literal (an unrolled `Sum`
 * substitutes its index at the emitted-code level, so the node is still the
 * index symbol while the code is `1`); and a loop index the emitted loop
 * itself binds (`isDecidedLoopIndex`). Every other shape — a free symbol read
 * `_.x`, a user function call, an element read, a `Which` arm — is treated as
 * possibly absent. The answer only decides whether an equality carries the
 * `typeof` guard, so a conservative `true` costs one type test and never a
 * wrong value.
 */
function mayReadUndefinedJS(
  e: Expression,
  code: string,
  target: CompileTarget<Expression>
): boolean {
  if (isNumber(e)) return false;
  if (JS_NUMERIC_LITERAL.test(code)) return false;
  if (isSymbol(e) && isDecidedLoopIndex(e.symbol, target.boundVars))
    return false;
  if (isFunction(e) && typeof e.operator === 'string')
    return !JS_ALWAYS_NUMBER_HEADS.has(e.operator);
  return true;
}

/**
 * Emit a JavaScript equality test. Compiled `Equal`/`NotEqual` on numeric
 * operands is EXACT (`===`/`!==`), the IEEE 754 comparison: `0.1 + 0.2 = 0.3`
 * compiles to `false`, two infinities of the same sign are equal, and `NaN`
 * equals nothing. This differs from the interpreter, which compares numbers
 * within `engine.tolerance`; the compiled lanes serve plot kernels, where a
 * tolerance test on every comparison (a subtraction, an absolute value and a
 * compare per sample) is not acceptable and where the exact answer is the
 * one the reference graphing calculators give (user ruling of 2026-09-09,
 * `docs/COMPILATION-MODEL.md`).
 *
 * `NotEqual` is the NEGATION of the `Equal` test (`!==`), which is `true` on
 * a `NaN` operand as the interpreter answers (`NotEqual(NaN, 3)` is `True`).
 * Complex operands compare component-wise. Chained (N-ary) forms conjoin
 * pairwise with `&&`.
 *
 * One guard survives: an absent operand reads `undefined`, and two absent
 * operands are `===` to each other, where the interpreter answers `Missing`
 * (never `True`) for `Equal(Missing, Missing)`. When BOTH operands may read
 * `undefined` (`mayReadUndefinedJS`), the left operand is tested with
 * `typeof … === 'number'` first, so the pair answers `false` for `Equal`
 * and `true` for `NotEqual`. A pair with a literal or an arithmetic result
 * on either side needs no guard: `undefined === 5` is already `false`.
 *
 * The SCALAR answer is therefore always a genuine boolean, which the branch
 * machinery depends on (`BRANCH_RELATIONS` in `base-compiler.ts`, and the
 * negation inside `kleeneRelationLeaf`). Only the ELEMENT-WISE runtime is
 * three-valued: `eqTensor` marks an absent CELL with `NaN`, which the
 * selection runtime reads as an undecided position. Making the scalar answer
 * undecided as well was measured and declined: it reaches the fused selection
 * lane, the value-position connectives, the operand-binding rules and the
 * chain's short-circuit order, which is a far wider change than the cell-level
 * defect it would fix.
 */
function compileJSEquality(
  kind: 'Equal' | 'NotEqual',
  args: ReadonlyArray<Expression>,
  compile: (e: Expression) => string,
  target: CompileTarget<Expression>
): string {
  if (args.length < 2)
    throw new Error(
      `Could not compile \`${kind}\`: expected at least two arguments`
    );
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
  // gate is `isCollectionEqualityOperandJS`, which the target also declares
  // so the branch-decidedness analysis classifies these operands identically
  // (`CompileTarget.collectionEqualityOperand`).
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
  if (args.some(isCollectionEqualityOperandJS)) {
    if (args.length === 2) {
      const helper = kind === 'Equal' ? 'eq' : 'neq';
      return `_SYS.${helper}((${compile(args[0])}), (${compile(args[1])}))`;
    }
    throw new Error(
      `Could not compile \`${kind}\`: chained (n-ary) comparison over an operand ` +
        `that may be a collection at run time (collection-valued or ` +
        `possibly-collection-typed). Materialize the collection first.`
    );
  }
  // Each operand is compiled exactly once, here: the direct emission is what
  // the absence predicate reads, and what the pair splices or binds below.
  const direct = args.map((a) => compile(a));
  // Does the pair (i, j) carry the absence guard? Only when both operands may
  // read `undefined` — see `mayReadUndefinedJS`.
  const guardedPair = (i: number, j: number): boolean =>
    mayReadUndefinedJS(args[i], direct[i], target) &&
    mayReadUndefinedJS(args[j], direct[j], target);
  // An IMPURE operand (the Random family) must be evaluated exactly once — the
  // interpreter evaluates each operand once. Three positions splice an operand
  // MORE than once: the LEFT operand of a guarded pair appears in the `typeof`
  // test and in the comparison, a COMPLEX operand is spliced twice by
  // `part()` (once for `.re`, once for `.im`), and a MIDDLE operand of a
  // chained (n-ary) form appears in the two comparisons that straddle it. So
  // `Equal(Random()·i, …)` and `Equal(0.1, Random(), 0.9)` each consumed TWO
  // draws. When any operand is spliced more than once, bind EVERY impure
  // operand — in argument order, so the draw order matches the interpreter's —
  // to an IIFE const, and splice the const instead. Pure operands keep the
  // direct emission byte-identical.
  const multiSpliced = (i: number): boolean =>
    (i >= 1 && i <= args.length - 2) ||
    BaseCompiler.isComplexValued(args[i]) ||
    (i < args.length - 1 && guardedPair(i, i + 1));
  // An operand can also be spliced where it is CONDITIONALLY evaluated, which
  // costs a draw just as surely as splicing it twice. The absence guard of a
  // pair tests the left operand with `typeof` and joins it with `&&`, so the
  // RIGHT operand of a guarded pair is never evaluated when the left one
  // reads `undefined`. The interpreter evaluates both operands whatever they
  // hold, so a skipped draw of the Random family would move every later draw
  // of a seeded sequence.
  const conditionallySpliced = (i: number): boolean =>
    i >= 1 && guardedPair(i - 1, i);
  const bind = args.some(
    (a, i) => a.isPure === false && (multiSpliced(i) || conditionallySpliced(i))
  );
  const bindings: string[] = [];
  const codes = args.map((a, i) => {
    if (!bind || a.isPure !== false) return undefined;
    const t = BaseCompiler.tempVar(target);
    bindings.push(`${t} = ${direct[i]}`);
    return t;
  });
  const code = (i: number): string => codes[i] ?? direct[i];
  const anyComplex = (i: number, j: number): boolean =>
    BaseCompiler.isComplexValued(args[i]) ||
    BaseCompiler.isComplexValued(args[j]);
  // Promote an operand to `{ re, im }`. A real operand contributes
  // `re = code`, `im = 0`.
  const part = (e: Expression, c: string): { re: string; im: string } =>
    BaseCompiler.isComplexValued(e)
      ? { re: `(${c}).re`, im: `(${c}).im` }
      : { re: `(${c})`, im: '0' };
  const pair = (i: number, j: number): string => {
    if (anyComplex(i, j)) {
      const pa = part(args[i], code(i));
      const pb = part(args[j], code(j));
      const equal = `(${pa.re} === ${pb.re} && ${pa.im} === ${pb.im})`;
      return kind === 'Equal' ? equal : `(!${equal})`;
    }
    if (guardedPair(i, j)) {
      const equal = `(typeof (${code(i)}) === 'number' && (${code(i)}) === (${code(j)}))`;
      return kind === 'Equal' ? equal : `(!${equal})`;
    }
    return `((${code(i)}) ${kind === 'Equal' ? '===' : '!=='} (${code(j)}))`;
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
  // path in `BaseCompiler` expressly to fail closed; an ALL-string ordering
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
        `Could not compile \`${kind}\`: an ordering that mixes a character ` +
          `operand with an operand that is not provably a character (or a ` +
          `chained character ordering). A BINARY all-character ordering does ` +
          `compile, through the code-point comparator the interpreter uses. The interpreter evaluates it instead.`
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
        throw new Error(
          `Could not compile \`Not\`: expected exactly one argument`
        );
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
    `Could not compile \`${kind}\`: a comparison or logical connective over an ` +
      `operand that may be a collection at run time — the JavaScript ` +
      `operators do not broadcast element-wise (an array stringifies in a ` +
      `comparison and is truthy in a connective), and this operand has no ` +
      `element-wise runtime dispatch (a tuple binds atomically; a set, ` +
      `dictionary or string has no positional lowering), so the result would ` +
      `silently disagree with interpretation. Materialize ` +
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
 *
 * A POINT arm is the one value that test gets wrong: a point is an array at
 * this ABI, and the interpreter lifts it whole — `Which([T, F, F], (1, 2))`
 * is `[(1, 2), NaN, NaN]`, where the helper read the two-element array as a
 * list arm of the wrong length and answered `NaN`. An arm whose TYPE may be
 * a point (`mayBePointArm`) is therefore wrapped (`_SYS.wholeArm`), and the
 * helper lifts the wrapped value whole.
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
    const fused = compileNumericSelection(args, target, (fallbackTarget) =>
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
  // An arm the type proves to be one POINT is an array at this ABI, exactly
  // like a list arm, so the helper could not tell which to index and which
  // to lift whole; the wrapper says so (`WholeArm`).
  return `_SYS.select(${args
    .map((x, i) =>
      i % 2 === 1 && mayBePointArm(x.type.type)
        ? `() => _SYS.wholeArm(${compile(x, i)})`
        : `() => (${compile(x, i)})`
    )
    .join(', ')})`;
}

/**
 * May a selection arm of this type be one POINT at run time? A point type
 * (`isPointElementType`: a tuple, or a union of tuples), or a union that
 * holds a point arm beside SCALAR arms — `integer | tuple<integer, integer>`,
 * the type of a nested selection whose branches disagree — but no arm that
 * is a collection other than a point: such a value would have to be
 * indexed, and the run-time selection cannot both lift an arm whole and
 * index it. Wrapping a scalar is harmless — the helper lifts a scalar whole
 * in any case — so the union is wrapped as a whole.
 */
function mayBePointArm(t: Type): boolean {
  if (isPointElementType(t)) return true;
  const resolved = resolveTypeAlias(t);
  if (typeof resolved === 'string' || resolved.kind !== 'union') return false;
  return (
    resolved.types.some((arm) => isPointElementType(arm)) &&
    resolved.types.every(
      (arm) => isPointElementType(arm) || !isSubtype(arm, 'collection<any>')
    )
  );
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
    if (params.length !== 1)
      throw new Error(`Could not compile \`Not\`: expected one argument`);
    return `!(${params[0]})`;
  }
  if (kind === 'And' || kind === 'Or')
    return `(${params.join(kind === 'And' ? ' && ' : ' || ')})`;
  const op = JS_ORDERING_OPERATORS[kind as keyof typeof JS_ORDERING_OPERATORS];
  if (op === undefined || params.length < 2)
    throw new Error(
      `Could not compile \`${kind}\`: expected at least two arguments`
    );
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
export function isIndexedCollectionOperand(
  e: Expression,
  target?: CompileTarget<Expression>
): boolean {
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
  if (t.matches('list<any>') || t.matches('indexed_collection<any>'))
    return true;
  // A join over collections that are checked to be arrays at run time is an
  // array, although its type is `collection<T>` (`compilesToCheckedArray`).
  // The target, when the caller has one, lets a seeded fold's block-local
  // combiner be resolved (`BaseCompiler.callbackLiteral`).
  return compilesToCheckedArray(e, new Set(), target);
}

/**
 * The compiled code of a SYMBOL whose static type says "a collection" without
 * proving an indexed one, checked at run time to be a JavaScript array; or
 * `undefined` when `e` is not such an operand.
 *
 * The witness is a parameter of a user function that the body only counts or
 * searches: in `function seen(acc, c) { count(acc, e => …) > 0 }` the use
 * narrows `acc` to the bare `collection`, which also admits a set or a
 * dictionary, so the "provably indexed" test (`isIndexedCollectionOperand`)
 * refused it and no program that passes a list to such a function compiled.
 * The declared type is wider than the run-time value here, as it is for the
 * base of an element read (`couldBeIndexedCollectionOperand`). `_SYS.arr`
 * returns the value when it is an array and throws a `RangeError` otherwise,
 * so a set or a dictionary that does arrive stops the run instead of being
 * walked as if it were a list.
 *
 * A top type (`unknown`, `any`, `value`) is not admitted: it says nothing is
 * known, not that a collection is expected. A DECLARED collection type is not
 * admitted either: only a type inferred from the uses is wider than the
 * author meant. (An operator that only visits the elements, in any order,
 * uses `iterableCollectionCode` instead, which admits a declared type.)
 * A type with a text arm is not
 * admitted either (see `couldBeStringOperand`). The set, dictionary and
 * tuple tests below remove only the cases the static type shows. For every
 * other value the run-time check is the one guard: a value that is not an
 * array stops the compiled run, where the interpreter would have answered.
 */
function runtimeCheckedArrayCode(
  kind: string,
  e: Expression | undefined,
  compile: (expr: Expression) => string
): string | undefined {
  if (e === undefined || !admitsRuntimeCheckedArray(e)) return undefined;
  return `_SYS.arr(${compile(e)}, ${JSON.stringify(kind)})`;
}

/** Whether `e` is an operand that `runtimeCheckedArrayCode` compiles with a
 * run-time array check: see there. */
function admitsRuntimeCheckedArray(e: Expression): boolean {
  if (!isSymbol(e)) return false;
  const t = jsType(e);
  if (t === 'unknown' || t === 'any' || t === 'value') return false;
  if (!e.type.matches('collection<any>')) return false;
  // Only a type the engine INFERRED from the uses. A declared
  // `collection<number>` is a contract that admits a set, and the program
  // then declines, so that the interpreter evaluates it.
  if (e.valueDefinition?.inferredType !== true) return false;
  if (couldBeStringOperand(e)) return false;
  if (
    e.type.matches('set<any>') ||
    e.type.matches('dictionary<any>') ||
    e.type.matches('tuple')
  )
    return false;
  return true;
}

/**
 * The compiled code of a SYMBOL typed as an abstract collection, for an
 * operator that only visits each element once, in any order: `Max`, `Min`,
 * `Length`, `Count`, and the collection form of `Sum` and `Product`. The
 * result is `undefined` when `e` is not such an operand.
 *
 * Such an operator needs no index and no order, so a parameter typed
 * `collection` or `collection<integer>` compiles, whether the type was
 * declared or inferred from the uses (issue #385: `Max(w)` with `w` declared
 * `collection` compiled to `Math.max(w)`, which is `NaN` for an array).
 * `_SYS.elts` reads an array as it is and a JavaScript `Set` as the array of
 * its elements, and throws a `RangeError` for any other value, so a value
 * that is neither stops the run instead of giving a wrong answer. When the
 * type was inferred, it also reads a single value as a collection of one
 * element, because the interpreter accepts one there (`k(4)` is `4` for
 * `k(L) := Sum(L)`): a number or a complex value for `Sum` and `Product`, a
 * number for `Max` and `Min` (complex values have no order). `Length` and
 * `Count` refuse a single value, and so does a parameter DECLARED
 * `collection`, which the interpreter checks. For the same four operators, a
 * type with a number arm (`collection<any> | number`) is admitted too, and
 * reads a single value the same way.
 *
 * An operator that reads positions or order (`At`, `Reverse`, `Take`, …)
 * does not use this: a set has neither, so a declared abstract collection
 * stays refused there (`runtimeCheckedArrayCode`).
 *
 * Not admitted: a top type (`unknown`, `any`, `value`), which says nothing
 * is known; a type with a text arm (see `couldBeStringOperand`); a
 * dictionary, whose elements are its entries and not values to compare or
 * add; and a tuple.
 */
function iterableCollectionCode(
  kind: string,
  e: Expression | undefined,
  compile: (expr: Expression) => string
): string | undefined {
  if (e === undefined || !isSymbol(e)) return undefined;
  const t = jsType(e);
  if (t === 'unknown' || t === 'any' || t === 'value') return undefined;
  const reducer =
    kind === 'Sum' || kind === 'Product' || kind === 'Max' || kind === 'Min';
  // A type such as `collection<any> | number` admits a single number, which
  // these four operators read as one element, as the interpreter does. A
  // type whose collection arms are all indexed (`list<number> | number`)
  // keeps the run-time `Array.isArray` projection of its callers.
  const numberArm =
    reducer &&
    !e.type.matches('collection<any>') &&
    // A number type (`nan | real`) also matches the union: require an arm
    // that is a collection.
    !e.type.matches('number') &&
    e.type.matches('collection<any> | number') &&
    !couldBeIndexedCollectionOperand(e);
  if (!numberArm && !e.type.matches('collection<any>')) return undefined;
  if (couldBeStringOperand(e)) return undefined;
  if (e.type.matches('dictionary<any>') || isPointOperandType(e))
    return undefined;
  // A single value is read as one element when the type has a number arm,
  // or when the type was inferred from the uses. The interpreter refuses a
  // number at a parameter DECLARED `collection` (`incompatible-type`).
  const inferred = e.valueDefinition?.inferredType === true;
  const scalar =
    !reducer || (!inferred && !numberArm)
      ? undefined
      : kind === 'Sum' || kind === 'Product'
        ? 'complex'
        : 'real';
  const real = kind === 'Max' || kind === 'Min';
  const extra = real
    ? `, ${scalar ? JSON.stringify(scalar) : 'undefined'}, true`
    : scalar
      ? `, ${JSON.stringify(scalar)}`
      : '';
  return `_SYS.elts(${compile(e)}, ${JSON.stringify(kind)}${extra})`;
}

/**
 * Whether `e` compiles to a JavaScript array although its static type is an
 * abstract collection (`collection<T>`, which also admits a set) or another
 * type that `isIndexedCollectionOperand` does not read as an array.
 *
 * A `Join` or an `Append` over an operand whose type is an abstract
 * collection is typed `collection<T>`: in the interpreter, such an operand
 * can hold a set, and the join is then a set. The compiled `Join`, `ListJoin`
 * and `Append` build a JavaScript array literal, and each of their
 * collection operands is compiled by `collArg`, which admits an operand only
 * when it is provably an array or when it is checked to be an array at run
 * time (`runtimeCheckedArrayCode`, which throws for a set or a dictionary).
 * So when every collection operand (every operand that is not one element,
 * and only the first operand of an `Append`) is admitted by one of these
 * tests, the compiled value of the node is an array, and a consumer of the
 * node (`Length`, `Sum`, a spread in a list literal) can read it as one. The
 * witness is the parameter `a` of `f(a) = Join(a, [0])`: its type is
 * inferred as `collection<any>` from the use, so the join is typed
 * `collection<any>`, and `Length(Join(a, [0]))` must still compile.
 *
 * A call of a user function whose body is such a node compiles to the same
 * array, so the call is admitted too: `Length(f(b))` with `f` defined as
 * above. `visited` holds the user functions being looked through, so a
 * recursive definition answers `false` instead of looping.
 *
 * A SEEDED FOLD whose seed is an array source and whose combiner returns
 * such a node compiles to the combiner's last value, an array, so it is
 * admitted too. The witness is the list-building fold
 * `Fold((acc, i) => Join(acc, [2 p[i]]), [], 1..n)` (issue #369): the
 * engine types it `collection<any>` (the bare accumulator is inferred
 * `collection<any>` from its use in `Join`), so `Length` and `At` of the
 * fold refused it as "not an indexed collection" while the fold itself
 * compiled. The combiner's accumulator parameter is an inferred-type
 * symbol, which `admitsRuntimeCheckedArray` admits, so the body's `Join` is
 * a checked array. A seedless fold is not admitted: its accumulator starts
 * as the first element, whose shape this test does not read.
 */
function compilesToCheckedArray(
  e: Expression,
  visited: Set<string>,
  target?: CompileTarget<Expression>
): boolean {
  // A seeded fold whose combiner is a BLOCK-LOCAL function
  // (`function step(acc, i) { … }` in the compiled block) is typed `unknown`,
  // because the lazy `Reduce` never binds the combiner symbol and so cannot
  // read its result type; such a fold is read from its seed and its combiner
  // (below) whatever its static type says. A fold typed `unknown` for any
  // other reason keeps failing the type test.
  const blockLocalFold =
    isFunction(e, 'Reduce') &&
    e.nops === 3 &&
    isSymbol(e.ops[1]) &&
    target?.localFunctions?.has(e.ops[1].symbol) === true;
  if (!blockLocalFold && !e.type.matches('collection<any>')) return false;
  if (e.type.matches('set<any>') || e.type.matches('dictionary<any>'))
    return false;
  const isArraySource = (op: Expression): boolean =>
    (!op.type.matches('string') &&
      (op.type.matches('list<any>') ||
        op.type.matches('indexed_collection<any>'))) ||
    admitsRuntimeCheckedArray(op) ||
    compilesToCheckedArray(op, visited, target);
  if (isFunction(e, 'Join') || isFunction(e, 'ListJoin'))
    return (
      e.nops > 0 &&
      e.ops.every((op) => isAtomicJSJoinOperand(op) || isArraySource(op))
    );
  if (isFunction(e, 'Append')) return e.nops > 0 && isArraySource(e.ops[0]);
  if (isFunction(e, 'Reduce') && e.nops === 3) {
    const combiner = e.ops[1];
    const name = isSymbol(combiner) ? combiner.symbol : undefined;
    if (name !== undefined && visited.has(name)) return false;
    const literal = BaseCompiler.callbackLiteral(combiner, target);
    if (literal === undefined || literal.nops !== 3) return false;
    // The value of a block body is its last statement. A body whose earlier
    // statements are all declarations (`let v = …`) whose initializers
    // mention no `Return` has no other exit, so its last statement is read;
    // any other earlier statement (a `Return` inside an `If`, a loop, an
    // assignment) could give the fold another value, and the body is then
    // not read.
    let body: Expression | undefined = literal.ops[0];
    while (
      isFunction(body, 'Block') &&
      body.nops > 0 &&
      body.ops
        .slice(0, -1)
        .every((s) => isFunction(s, 'Declare') && !s.has('Return'))
    )
      body = body.ops[body.nops - 1];
    if (body === undefined || !isArraySource(e.ops[2])) return false;
    const inner = name === undefined ? visited : new Set([...visited, name]);
    return (
      (!body.type.matches('string') &&
        (body.type.matches('list<any>') ||
          body.type.matches('indexed_collection<any>'))) ||
      admitsRuntimeCheckedArray(body) ||
      compilesToCheckedArray(body, inner, target)
    );
  }
  // The literal of a user function: the value of the symbol, or the literal
  // a `function` definition installed on the operator definition the call is
  // bound to (a definition local to a block has no symbol value).
  const literal = isFunction(e)
    ? e.operatorDefinition?._lambdaLiteral
    : undefined;
  const fn = isFunction(literal, 'Function') ? literal : userFunctionLiteral(e);
  const name = e.operator;
  if (fn === undefined || typeof name !== 'string' || visited.has(name))
    return false;
  // The value of a one-statement block is that statement. A body with more
  // statements is not read: a `Return` in an earlier statement could give
  // the call another value.
  let body: Expression | undefined = fn.ops[0];
  while (isFunction(body, 'Block') && body.nops === 1) body = body.ops[0];
  if (body === undefined) return false;
  return compilesToCheckedArray(body, new Set([...visited, name]), target);
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
 * `success: true`, so it fails closed instead. A base that is PROVABLY an
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
    // Look through an application of a USER function: when the body analysis
    // proves the result is ONE NUMBER under these arguments, the application
    // is NOT possibly-collection, even though its declared return type is open
    // (`(unknown) -> unknown`, the shape consumers use so list-broadcasting
    // keeps working). `q(x) < y` with `q(t) = n·t+1` compiles; `q(L) < y`
    // with a collection-ish `L` still fails closed at the argument check.
    // A body the analysis proves to be a POINT keeps the fail-closed answer
    // here: a point is a JavaScript array at run time, so it IS a collection
    // for the paths this predicate guards.
    // Provenance: Tycho item 86.
    return (
      provableApplicationKind(e, new Set(), (a) =>
        provableTopLevelKind(a, topLevelArgIsScalar)
      ) !== 'scalar'
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
      // user-function application takes the body look-through instead, which
      // reads the body and declines on a collection constructor, and answers
      // "possibly collection" for a body that builds a POINT — a point is a
      // JavaScript array at run time (Tycho item 171: `Σ_i a(h(i))` reached
      // the scalar accumulation arm and `+`-concatenated the arrays into a
      // string, where the type-`unknown` spellings `Σ_i a(i)` / `Σ_i a(t+i)`
      // took the element-wise `_SYS.bcast` fold).
      if (userFunctionLiteral(e) !== undefined)
        return (
          provableApplicationKind(e, new Set(), (a) =>
            provableTopLevelKind(a, topLevelArgIsScalar)
          ) !== 'scalar'
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
 * Does this operand make an `Equal`/`NotEqual` lower to the collection-aware
 * runtime dispatch (`_SYS.eq`/`_SYS.neq`) instead of a scalar comparison?
 *
 * The declared type answers for a statically visible collection — not
 * `.isCollection`, which is false for a `list<number>` such as `Power(L, 2)`
 * — and `isPossiblyCollectionTypedJS` for the operands whose collection-ness
 * is not statically visible: a `broadcastable<T>` node, or a top-typed
 * application such as `h(x)`. (`broadcastable<T>` is NOT a subtype of
 * `collection`, so it needs its own test.) A bare unknown SYMBOL is excluded
 * by that predicate, so plot equalities (`x^2 + y^2 = 4`) stay scalar.
 *
 * Declared on the target as `collectionEqualityOperand` as well, because the
 * branch-decidedness analysis has to classify these operands exactly as the
 * emitter does: the dispatch answers the absence marker rather than a
 * boolean, and only a condition that may carry the marker is read off its
 * own value.
 */
function isCollectionEqualityOperandJS(a: Expression): boolean {
  return a.type.matches('collection<any>') || isPossiblyCollectionTypedJS(a);
}

/**
 * The scalar test the two `isPossiblyCollectionTypedJS` look-through gates
 * hand to `provableTopLevelKind`: an ACTUAL ARGUMENT is one number at run time
 * when its type is not collection-shaped and this predicate does not call it
 * possibly-collection. A bare `unknown` symbol passes — at the top level it is
 * a free plot variable, not a captured document symbol.
 */
function topLevelArgIsScalar(a: Expression): boolean {
  return !a.type.matches('collection<any>') && !isPossiblyCollectionTypedJS(a);
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
 * The element at 0-based position `idx` of `arg`, for the compiled
 * `First`/`Second`/`Third`.
 *
 * An out-of-range position answers what the interpreter answers
 * (`absenceMarker()` in `library/collections.ts`): `NaN` when the elements,
 * less their `missing` arm, are numbers, and `Missing` otherwise, whose
 * run-time spelling is `undefined`. So `Third((1, Missing))` is `NaN` on both
 * routes. Before, every out-of-range read was the bare JavaScript read, which
 * is `undefined`, also for a list of numbers.
 *
 * - A STRING source is segmented first: `"s"[0]` selects a UTF-16 code
 *   unit, where the interpreter yields the whole grapheme cluster
 *   (`docs/STRING_ROADMAP.md`, decision D13).
 * - Elements that are not numbers (strings, points, lists): the bare read,
 *   whose `undefined` out of range is the spelling of `Missing`.
 * - Elements that are numbers, in a collection that has no absent cell and
 *   cannot be absent as a whole: `(xs[k] ?? NaN)`.
 * - Otherwise `_SYS.nth`, which reads the length instead: `?? NaN` would
 *   also replace an absent cell INSIDE the collection (`First((Missing, 1))`
 *   is `Missing`, `undefined` at run time). A collection that is absent as a
 *   whole (a restricted operand whose condition is false) reads `NaN` when
 *   the element type is numeric and `undefined` otherwise, as the
 *   interpreter answers. When the element type does not decide the domain
 *   (`unknown`), `_SYS.nth` looks at the cells, as the interpreter does.
 */
function compileNthElement(
  arg: Expression,
  idx: number,
  compile: (e: Expression) => string
): string {
  if (isProvablyStringOperand(arg))
    return `_SYS.chars(${compile(arg)})[${idx}]`;
  const read = absentRead(arg);
  const collT = stripMissingFromType(jsType(arg));
  const eltT = collectionElementType(collT);
  const present =
    eltT === undefined
      ? undefined
      : stripMissingFromType(resolveTypeForCompilation(eltT));
  const decided =
    present !== undefined &&
    present !== 'unknown' &&
    present !== 'any' &&
    present !== 'never';
  if (decided && !isSubtype(present, 'number'))
    return `${compile(arg)}${read}[${idx}]`;
  if (decided && read === '' && !typeContainsMissing(eltT!))
    return `(${compile(arg)}[${idx}] ?? NaN)`;
  return `_SYS.nth(${compile(arg)}, ${idx}${decided ? ', true' : ''})`;
}

/**
 * The element read of an operand that may be absent: `?.` when its type has
 * a `missing` arm, so that a restricted operand whose condition is false,
 * which is `undefined` at run time, answers `undefined` (the run-time
 * spelling of `Missing`, the value the interpreter answers) instead of
 * throwing a `TypeError`. Empty otherwise.
 */
function absentRead(arg: Expression): string {
  return typeContainsMissing(arg.type.type) ? '?.' : '';
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
  if (
    isPointListOperand(arg) ||
    isCoordinateRowListOperand(arg) ||
    isEmptyCollectionOperand(arg)
  ) {
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
    // A point of the list may be absent (the `undefined` of a restricted
    // point whose condition is false, `[(1, 2), P {c}]`): its coordinate is
    // absent too, not a `TypeError` thrown by reading `undefined[idx]`.
    return `(${compiled()}).map((_pt) => _pt${absentRead(arg)}[${idx}]${pointComponentAbsence(coord)})`;
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
  if (mayBePointList(t)) {
    // Both readings see the same `[]`, so an EMPTY value at run time is the one
    // question the dispatch cannot answer from the value. The declared element
    // type answers it — the same evidence the interpreter uses when there is no
    // element to look at (`elementTypeBroadcastsWhenEmpty`) — so it is carried
    // into the helper. The broadcast reading is the helper's default, and is
    // left unspoken to keep the emitted call short.
    const emptyReading = elementTypeBroadcastsWhenEmpty(eltType)
      ? ''
      : ', false';
    return `_SYS.pointComponent(${compiled()}, ${idx}${emptyReading})`;
  }
  const direct = pointConstructorComponent(arg, idx, compile, target, eltType);
  if (direct !== undefined) return direct;
  // An operand that may be absent (the `Missing` symbol, `undefined` at run
  // time) has an absent coordinate, not a `TypeError` thrown by reading
  // `undefined[idx]`: `PointX(Missing)` is `NaN`, as in the interpreter.
  return `(${compiled()}${absentRead(arg)}[${idx}]${pointComponentAbsence(eltType)})`;
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
 * The element types that PROVE a collection is not a list of points, because
 * no value of them is one: the scalars. A `string` element type belongs here
 * for the same reason a `number` one does — `PointX(["a", "b"])` is `"a"` —
 * and `character` is what a `string` OPERAND reports as its element type.
 */
const NON_POINT_ELEMENT_TYPE = 'boolean | character | number | string';

/**
 * The types that PROVE a coordinate ROW is not a point: the scalars that are
 * not numbers. A row is a point only when every one of its cells holds a
 * number — the interpreter's `isPointLike` admits a row whose element type is
 * a subtype of `number` — so a row whose cells are proved non-numeric is no
 * point. These are the members of `NON_POINT_ELEMENT_TYPE` except `number`,
 * which is a coordinate one level down and a non-point one level up.
 */
const NON_COORDINATE_TYPE = 'boolean | character | string';

/**
 * Could a value of type `t` be a LIST OF POINTS as well as a single point, so
 * that a coordinate accessor over it has to dispatch at run time? This is the
 * NON-EMPTY question, and it fails OPEN: the interpreter's `pointComponentAt`
 * decides it from the concrete elements, so the compiled code may only settle
 * it statically when the type PROVES one reading. Every other type keeps the
 * run-time dispatch.
 *
 * A type answers false only when it admits no indexed collection at all, when
 * its element type is one of the scalars, which no point is
 * (`NON_POINT_ELEMENT_TYPE`), or when its element type is a ROW whose cells
 * are proved non-numeric (`NON_COORDINATE_TYPE`), which no point is either: a
 * `list<number>` is a single point spelled flat (`PointX([3, 4])` is `3`), a
 * `list<string>` element-indexes, and so does a `list<list<string>>`, whose
 * rows hold no coordinates. Everything else answers true — an untyped
 * operand, a bare `list`, a `list<any>`, a union such as
 * `collection<any> | tuple`, and a nested element type whose rows can hold
 * numbers (`list<list<any>>`, `list<list<number>>`,
 * `list<number | tuple<number, number>>`).
 *
 * Failing closed here reads a list of points as one point: `PointX(L)` over
 * `[[1, 2], [3, 4]]` answered the first ROW, `[1, 2]`, where the interpreter
 * broadcasts and answers `[1, 3]`.
 *
 * This is a DIFFERENT question from the one an EMPTY operand asks — see
 * `elementTypeBroadcastsWhenEmpty`, which the caller consults separately. An
 * empty collection has no element for either route to look at, so its reading
 * comes from the declared element type alone, and that rule is stricter: a
 * `list<list<any>>` broadcasts when it holds numeric rows but element-indexes
 * when it is empty.
 */
export function mayBePointList(t: Type): boolean {
  if (t === 'unknown' || t === 'any') return true;
  if (!couldMatch(t, INDEXED_COLLECTION_SHAPE_TYPE)) return false;
  const elt = collectionElementType(t);
  // The bottom element type `never` (what the literal `[]` and `Set()` carry)
  // is a subtype of every scalar, but it proves the collection holds nothing
  // at all rather than proving anything about points.
  if (elt === undefined || elt === 'never') return true;
  if (isSubtype(elt, NON_POINT_ELEMENT_TYPE)) return false;
  // A nested element type is a row of cells. The row is a point only when its
  // cells hold numbers, so an inner type proved non-numeric proves the whole
  // collection element-indexes, exactly as a scalar element type does one
  // level up. Without this arm a `list<list<string>>` kept the run-time
  // dispatch, whose EMPTY answer is a flat `NaN`, where the direct route
  // answers the `undefined` its non-numeric coordinate calls for — the marker
  // the interpreter and the flat `list<string>` case already agree on.
  // A TUPLE element type is a point whatever its components hold — the
  // interpreter's `isPointLike` admits every tuple — and a tuple is a subtype
  // of the indexed-collection shape, so it must be let through ahead of the
  // row test below, which would read `list<tuple<string, string>>` as a list
  // of non-numeric rows. A union of tuple spellings is a point element too
  // (see `isPointElementType`).
  const isTupleType = isPointElementType(elt);
  if (!isTupleType && isSubtype(elt, INDEXED_COLLECTION_SHAPE_TYPE)) {
    const inner = collectionElementType(elt);
    // `never` is a subtype of every scalar, but an empty ROW says nothing
    // about points, for the reason the element-type test above gives.
    if (
      inner !== undefined &&
      inner !== 'never' &&
      isSubtype(inner, NON_COORDINATE_TYPE)
    )
      return false;
  }
  return true;
}

/** The type of a tuple's `idx`-th element, or `undefined` when `t` is not a
 *  parameterized tuple or the index is out of range. */
export function tupleElementType(t: Type, idx: number): Type | undefined {
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
export function isPointListOperand(e: Expression): boolean {
  const elt = collectionElementType(jsType(e));
  // `'tuple'` (the bare, unparameterized type name) is a plain string, not a
  // `{ kind: 'tuple' }` node — and it is what a `list<tuple>` DECLARATION
  // reports (the `PointList` type handler itself answers the parameterized
  // `list<tuple<…>>`), so both spellings must read as a point. A union whose
  // arms are all tuple spellings — what a list literal of two differently
  // typed points infers — is a point element as well; see
  // `isPointElementType`.
  if (isPointElementType(elt)) return true;
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
 * True when `e` is a LIST of points once its absence arms are removed: the
 * type without its `missing` arms is a list whose elements are points. This
 * is the type of a restricted list of points (`missing | list<tuple<…>>`)
 * and of a list that holds absent or restricted points
 * (`list<missing | tuple<…>>`), which `isPointListOperand` does not read as
 * a list of points.
 */
function isAbsentablePointListOperand(e: Expression): boolean {
  const t = jsType(e);
  if (!typeContainsMissing(t)) return false;
  const elt = collectionElementType(
    resolveTypeForCompilation(stripMissingFromType(t))
  );
  return elt !== undefined && isPointElementType(elt);
}

/**
 * True when `e` is a collection the compiler can prove holds NO elements (the
 * literal `[]`, an empty `Set()`) AND its declared element type calls for the
 * BROADCAST reading. A coordinate accessor then broadcasts over zero points
 * and answers the empty list, for every accessor position.
 *
 * The element-type rule is the local `elementTypeBroadcastsWhenEmpty` below,
 * which mirrors the interpreter's function of the same name
 * (`library/collections.ts`). In short: an element type that is point-shaped,
 * the bottom `never` (what the literal `[]` and `Set()` carry), or unknown
 * broadcasts; every other element type element-INDEXES when non-empty and so
 * indexes when empty, answering the absence marker. Kept as a local predicate,
 * rather than imported from `collections.ts`, for the module-init reordering
 * reason `isPointListOperand` gives.
 *
 * An operand that indexes falls through to the routes below, which answer the
 * marker for it: the direct `[idx]` access, whose absence value is this
 * target's projection of the marker — `NaN` for a coordinate that could hold a
 * number, and the bare access otherwise (see `pointComponentAbsence`) — or the
 * run-time dispatch with the indexing reading stated, when the element type is
 * one whose non-empty reading only the value settles (`mayBePointList`).
 * A STRING is refused ahead of the element type, as
 * the interpreter refuses it: the accessors element-INDEX a string
 * (`PointX("abc")` is `"a"`).
 */
export function isEmptyCollectionOperand(e: Expression): boolean {
  if (e.isFiniteCollection !== true || e.count !== 0) return false;
  if (e.type.matches('string')) return false;
  return elementTypeBroadcastsWhenEmpty(collectionElementType(jsType(e)));
}

/**
 * Which reading a coordinate accessor takes over an EMPTY collection: true to
 * BROADCAST over zero points, which answers the empty list; false to
 * element-INDEX, which answers the absence marker. An empty collection has no
 * element to look at, so the declared ELEMENT type is the only evidence, and
 * this is the question it answers. Mirrors the interpreter's
 * `elementTypeBroadcastsWhenEmpty` (`library/collections.ts`), which states
 * the rule in full:
 *
 *  - a point-shaped element broadcasts, in both spellings — a tuple element,
 *    and the coordinate-ROW spelling whose rows are numeric;
 *  - the bottom element type `never` (what the literal `[]` and `Set()` carry)
 *    broadcasts: it proves the collection is empty and says nothing about
 *    points;
 *  - an element type nothing is known about (`unknown`, `any`, or none at all)
 *    broadcasts;
 *  - every other element type element-INDEXES. A numeric one because the
 *    collection is ONE point spelled flat (`PointX([3, 4])` is `3`); a string
 *    or boolean one because its elements are not points (`PointX(["a", "b"])`
 *    is `"a"`); a nested one because a row of non-numbers is not a point
 *    either (`PointX([["a"], ["b"]])` is `["a"]`).
 *
 * This is STRICTER than the non-empty question `mayBePointList` asks, and the
 * two must not be merged. `mayBePointList` fails open, because the non-empty
 * reading is decided from the concrete elements; this one is decided from the
 * type alone, so a `list<list<any>>` answers true there (its rows may be
 * points) and false here. Where the two disagree, the compiled operand takes
 * the run-time dispatch AND carries this answer into it — see the third
 * argument of `_SYS.pointComponent`.
 */
export function elementTypeBroadcastsWhenEmpty(elt: Type | undefined): boolean {
  if (elt === undefined) return true;
  if (elt === 'never' || elt === 'unknown' || elt === 'any') return true;
  // Both tuple spellings, and a union of them, are point elements; see
  // `isPointElementType`.
  if (isPointElementType(elt)) return true;
  if (isSubtype(elt, INDEXED_COLLECTION_SHAPE_TYPE)) {
    const inner = collectionElementType(elt);
    return inner !== undefined && isSubtype(inner, 'number');
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
export function isCoordinateRowListOperand(e: Expression): boolean {
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
 * Whether `e` is a `PointList` source that may be absent: its type has a
 * `missing` arm, and its present part is an indexed collection (not a tuple,
 * not a string), such as `list<real> | missing` for the restricted list
 * `A\{0 < t\}`. The twin of `isAbsentablePointListSourceType` in
 * `library/collections.ts`.
 */
function isAbsentablePointListSource(e: Expression): boolean {
  const t = jsType(e);
  if (!typeContainsMissing(t)) return false;
  const present = stripMissingFromType(t);
  if (present === 'never' || present === 'string' || present === 'tuple')
    return false;
  if (typeof present !== 'string' && present.kind === 'tuple') return false;
  return isSubtype(present, INDEXED_COLLECTION_SHAPE_TYPE);
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
 *   throw: they have no per-point value. Fail closed.
 * - `target.iterationBudget`, when set, joins the `Math.min` (floored — the
 *   option validator admits fractional values and `new Array(2.5)` throws), so
 *   the zip length is capped. It bounds the zip only: materializing the
 *   sources is the source lowering's own, pre-existing behavior. Truncation
 *   semantics all the way down: a budget below 1 (`0.5`) floors to `0`, so the
 *   compiled point list is empty.
 * - A source that **may be absent** (a restricted list `A\{0 < t\}`, typed
 *   `list<real> | missing`) makes the whole point list absent when its value
 *   is `undefined` (the JavaScript form of `Missing`): the IIFE returns
 *   `undefined`, as the interpreter's `PointList` answers `Missing`.
 * - A source not proven to be a constructed array is checked with
 *   `Array.isArray` and throws a `RangeError` naming the component when it is
 *   not an array: a `vars`-splice
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
  const widths: (number | undefined)[] = [];
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
    // A source that may be absent (`list<real> | missing`): an absent value
    // makes the whole point list absent, as in the interpreter.
    const absentableSource =
      !constructedScalarSlot && isAbsentablePointListSource(a);
    if (absentableSource) {
      const name = BaseCompiler.tempVar(target);
      bindings.push(`const ${name} = ${compile(a)};`);
      bindings.push(`if (${name} === undefined) return undefined;`);
      bindings.push(
        `if (!Array.isArray(${name})) throw new RangeError('PointList: ` +
          `source component ${i + 1} is not an array at run time');`
      );
      widths.push(undefined);
      sources.push(name);
      parts.push(`${name}[${idx}]`);
      continue;
    }
    if (!constructedScalarSlot && isPointListSource(a)) {
      if (a.isCollection && a.isFiniteCollection === false)
        throw new Error(
          `Could not compile \`PointList\`: source component ${i + 1} is an infinite collection — ` +
            `an infinite point list has no compiled value.`
        );
      const name = BaseCompiler.tempVar(target);
      bindings.push(`const ${name} = ${compile(a)};`);
      const width = provenPointWidth(a, target);
      // Constructed arrays need no type check. Runtime sources still fail
      // loudly rather than letting a string or array-like object zip as data.
      if (width === undefined)
        bindings.push(
          `if (!Array.isArray(${name})) throw new RangeError('PointList: ` +
            `source component ${i + 1} is not an array at run time');`
        );
      widths.push(width);
      sources.push(name);
      parts.push(`${name}[${idx}]`);
      continue;
    }
    if (!constructedScalarSlot && isProvablyNonScalarType(jsType(a)))
      throw new Error(
        `Could not compile \`PointList\`: component ${i + 1} (type ` +
          `\`${a.type.toString()}\`) is neither a scalar slot nor a list ` +
          `source; its per-point value cannot be determined at compile time.`
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

  // Later operands may mutate a source through an alias. Use constant widths
  // only when evaluating all operands preserves the arrays; otherwise read
  // their lengths after every operand has run, as the runtime zip does.
  const fixedWidthsSafe =
    widths.some((w) => w !== undefined) &&
    BaseCompiler.isEmissionSkippable(args, [], target);
  const lengths: (number | string)[] = sources.map((s, i) =>
    fixedWidthsSafe && widths[i] !== undefined ? widths[i]! : `${s}.length`
  );
  // A run-time source joins the shortest-zip length only when it IS an array;
  // as a scalar it contributes no bound.
  for (const s of maybeSources)
    lengths.push(`(Array.isArray(${s}) ? ${s}.length : Infinity)`);
  const budget = target.iterationBudget;
  if (budget !== undefined) lengths.push(Math.floor(budget));
  const length = lengths.every((n): n is number => typeof n === 'number')
    ? String(Math.min(...lengths))
    : `Math.min(${lengths.join(', ')})`;
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
    `const ${n} = ${length}; ` +
    `const ${out} = new Array(${n}); ` +
    `for (let ${idx} = 0; ${idx} < ${n}; ${idx}++) ` +
    `${out}[${idx}] = [${parts.join(', ')}]; ` +
    `return ${out}; })()`
  );
}

/**
 * Compile a `Join`, or a `ListJoin` (the list literal with a spread): a flat
 * concatenation of the (top-level) elements of each collection operand.
 *
 * The string-preserving arm applies to `Join` only: when every operand is
 * provably a string, `Join` is variadic concatenation and answers a
 * `string`, not a `list<character>` (`Join("ab", "cd")` is `"abcd"`,
 * probed). Spreading the operands into an array would answer
 * `["a","b","c","d"]` instead, and would spread UTF-16 code units at that.
 * Each operand goes through the interpreter's ingress conditioning
 * (`_SYS.ct`) and the concatenation is NFC-normalized, since
 * `engine.string()` stores every string in NFC. A mixed call
 * (`Join("ab", ["c"])`) takes the generic arm in the interpreter and answers
 * a `list<character | string>`; here it keeps failing closed, because
 * `collArg` refuses a string operand — a string does not lower to a JS array.
 */
function compileJSJoin(
  head: 'Join' | 'ListJoin',
  args: ReadonlyArray<Expression>,
  compile: (expr: Expression) => string
): string {
  if (args.length === 0) return '[]';
  // An absent operand (`Missing`, `Undefined`) is an absent collection, and
  // the interpreter answers `Missing` for the whole join (user decision
  // 2026-09-26). The scalar arm below compiled it as one `undefined`
  // element (`[undefined, 3]`), so the call fails closed.
  const absent = args.findIndex(
    (a) => isSymbol(a, 'Missing') || isSymbol(a, 'Undefined')
  );
  if (absent >= 0)
    throw new Error(
      `Could not compile \`${head}\`: operand ${absent + 1} is absent, and the ` +
        `interpreter answers \`Missing\` for the whole join. The interpreter ` +
        `evaluates it instead.`
    );
  if (head === 'Join' && args.every(isProvablyStringOperand))
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
        : `...(${collArg(head, a, compile, i + 1)})`
    )
    .join(', ')}]`;
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
    throw new Error(`Could not compile \`${kind}\`: missing argument`);
  if (args.length !== 1 || !isProvablyStringOperand(arg))
    throw new Error(
      `Could not compile \`${kind}\`: the operand must be provably a string. The ` +
        `interpreter leaves a non-string operand unevaluated (or reports an ` +
        `\`incompatible-type\` error). The interpreter evaluates it instead.`
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
  if (isSymbol(x) && target !== undefined) {
    // Both readings must name the SAME accessor, and that accessor must
    // exist. A symbol the target resolves to an inlined literal — a declared
    // real symbol holding `2.41` — has no accessor at all, so both readings
    // are `undefined` and an equality test alone would call them equal and
    // spread the literal: `(⌊x⌋, ⌊y⌋, s)` was emitted as
    // `[…, ...2.41]`, which throws "2.41 is not iterable" at run time.
    const accessor = target.sequenceVars?.get(x.symbol);
    if (accessor !== undefined && accessor === target.var(x.symbol))
      return `...${code}`;
  }
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
        : isNumber(op) && op.re === 0 && op.isComplex
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
 * The heads this target lowers with a real-only FUNCTION codegen, beyond the
 * heads that are real-only on every target
 * (`BaseCompiler.REAL_ONLY_BY_DEFINITION`). The special functions have a
 * complex extension in the interpreter, but their lowerings here compute with
 * real numbers only: `Haversine` is `(1 - Math.cos(x)) / 2` and `BesselJ`
 * calls `_SYS.besselJ`, which ran to NaN on a `{re, im}` operand even when
 * its imaginary part was zero at run time. `Hypot` is `Math.hypot`, spelled
 * as a function so that it can take a point operand as one leg. The heads
 * this target maps to a plain helper name (`Erf: '_SYS.erf'`,
 * `Gamma: '_SYS.gamma'`) are real-only by that mapping
 * (`BaseCompiler.stringHelperIsRealOnly`); several of them are listed here as
 * well, so the set names every special function without complex lowering.
 * `Mean`, `Variance` and `StandardDeviation` have a complex value in the
 * interpreter, but the `_SYS` reducers behind them sum plain numbers.
 */
const JS_REAL_ONLY_LOWERINGS: ReadonlySet<string> = new Set([
  'Mean',
  'Variance',
  'StandardDeviation',
  'Hypot',
  'Arctan2',
  'Haversine',
  'GammaLn',
  'Beta',
  'Erf',
  'Erfc',
  'ErfInv',
  'Heaviside',
  'Sinc',
  'FresnelC',
  'FresnelS',
  'BesselJ',
  'Zeta',
  'HurwitzZeta',
  // `PolyGamma` has a complex kernel in the interpreter (`polygammaComplex`,
  // cortex-js/compute-engine#340), but `_SYS.polygamma` below is the
  // real-valued kernel: a function-codegen lowering, so
  // `stringHelperIsRealOnly` does not catch it the way it does
  // `Digamma`/`Trigamma`'s plain-name mappings.
  'PolyGamma',
  'LerchPhi',
  'PolyLog',
  'DirichletEta',
  'DirichletBeta',
  'StieltjesGamma',
  'ClausenCl',
]);

/** `CompileTarget.isRealOnlyLowering` of this target. */
function jsIsRealOnlyLowering(
  head: string,
  lowering: CompiledFunction<Expression> | undefined
): boolean {
  return (
    BaseCompiler.REAL_ONLY_BY_DEFINITION.has(head) ||
    JS_REAL_ONLY_LOWERINGS.has(head) ||
    BaseCompiler.stringHelperIsRealOnly(head, lowering)
  );
}

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
        'Could not compile the color: a color channel must be a scalar — a tuple/list component is not a ' +
          'color channel.'
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

/**
 * The forward-mode automatic-differentiation lowering of
 * `Apply(Derivative(f, n), x)`, or `undefined` when this application keeps
 * the symbolic closed form (`compileDerivative`, library/calculus.ts).
 *
 * Declines, in order: a shape that is not a single-order derivative applied
 * to one argument; a callee that does not resolve to a pure univariate user
 * function literal; the complex discipline, where the value shape is decided
 * by the discipline rather than by the body this lowering reads it from; an
 * order or a body small enough that the closed form is the better code; and
 * finally a body containing a head with no coefficient recurrence
 * (`jet-derivative.ts` reports that by returning `undefined`).
 */
function tryCompileJetDerivative(
  args: ReadonlyArray<Expression>,
  compile: (expr: Expression) => string,
  target: CompileTarget<Expression>
): string | undefined {
  const engine = args[0]?.engine;
  if (engine === undefined) return undefined;
  const claim = jetDerivativeTarget(
    args,
    (id) => BaseCompiler.userFunctionLiteral(engine, id),
    target.mode === 'complex'
  );
  if (claim === undefined) return undefined;
  return compileJetDerivative(
    claim.literal,
    claim.order,
    args[1],
    compile,
    () => BaseCompiler.tempVar(target),
    BaseCompiler.isComplexValued
  );
}

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
      `Could not compile \`${head}\`: a color conversion over an operand that may ` +
        'be a collection at run time and whose type does not prove a color ' +
        'at every element position, at every depth — a list of plain numbers ' +
        'there is a list of errors in the interpreter, and the compiled map ' +
        'would throw at the first element instead.'
    );
  }
  const temp = BaseCompiler.tempVar(target);
  return `_SYS.bcastColor((${temp}) => ${element(temp)}, ${compile(color)})`;
}

/** Decline a `List` written where a color is expected. */
function refuseColorList(): never {
  throw new Error(
    'Could not compile the color: a list is not a color — a color operand must be a color, a color ' +
      'string or a tuple of 3 or 4 components.'
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
    `Could not compile \`${head}\`: this operator takes a COLOR, and a tuple is color COMPONENTS, ` +
      'not a color. Build a color from the components first — ' +
      '`AsRgb((r, g, b))` reads them as 0-1 sRGB, and ' +
      '`ColorFromColorspace(components, space)` reads them in any named ' +
      'space.'
  );
}

/** Decline a literal tuple that is too narrow or too wide to be a color. */
function refuseColorTupleWidth(n: number): never {
  throw new Error(
    `Could not compile the color: a tuple of ${n} components is not a color — a color tuple has 3 ` +
      'components, or 4 with the fourth read as alpha.'
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
      return complexUnary(target, '_SYS.cabs', compile(args[0]));
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
      // A complex operand whose value is known at compile time — the
      // imaginary unit, or a complex literal — contributes its two components
      // as constants, so the object holding them is never built and never
      // read back (`x + i` is `{ re: x, im: 1 }`).
      const literal = BaseCompiler.isComplexValued(a)
        ? complexLiteralParts(a)
        : undefined;
      if (literal !== undefined)
        return { re: String(literal.re), im: String(literal.im) };
      const code = compile(a);
      const isComplex = BaseCompiler.isComplexValued(a);
      if (isComplex && !isSymbol(a) && !isNumber(a)) {
        const name = BaseCompiler.tempVar(target);
        bindings.push([name, code]);
        return { re: `${name}.re`, im: `${name}.im` };
      }
      if (isComplex) return { re: `(${code}).re`, im: `(${code}).im` };
      return { re: code, im: undefined };
    });
    // A component spelled as the constant `0` adds nothing to its sum and is
    // dropped, the way the real arm above drops an operand whose value is
    // zero. Only a component known at compile time is ever spelled that way,
    // and it comes from a purely imaginary literal, whose real part is `0`.
    //
    // The one divergence this creates is the SIGN of a zero result: `x + i`
    // emits `{ re: _.x, im: 1 }`, so a run-time `x` of `-0` keeps its negative
    // zero, where the retained `_.x + 0` would answer `+0`. No literal can
    // carry a negative zero into this arm — the engine normalizes it away when
    // it boxes the number — so the divergence needs a value supplied at run
    // time.
    const sum = (terms: ReadonlyArray<string>): string => {
      const nonZero = terms.filter((t) => t !== '0');
      return nonZero.length === 0 ? '0' : nonZero.join(' + ');
    };
    const body = `({ re: ${sum(parts.map((p) => p.re))}, im: ${sum(
      parts.flatMap((p) => (p.im === undefined ? [] : [p.im]))
    )} })`;
    if (bindings.length === 0) return body;
    return boundJSResult(
      target,
      bindings.map(([n, v]) => jsBinding(target, n, v)).join(' '),
      body
    );
  },
  Arccos: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return complexUnary(target, '_SYS.cacos', compile(args[0]));
    // Real operand, complex result (`Arccos(2)`, or `Arccos(x)` for a real
    // symbol of unknown magnitude): the node is typed `complex`, so the
    // parent emits `{re, im}` arithmetic and `Math.acos` — a `NaN` number —
    // must not be the lowering. See `resultIsComplexValued`.
    if (resultIsComplexValued('Arccos', args))
      return complexUnary(
        target,
        '_SYS.cacos',
        complexOperandCode(args[0], compile)
      );
    return `Math.acos(${compile(args[0])})`;
  },
  Arcosh: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return complexUnary(target, '_SYS.cacosh', compile(args[0]));
    if (resultIsComplexValued('Arcosh', args))
      return complexUnary(
        target,
        '_SYS.cacosh',
        complexOperandCode(args[0], compile)
      );
    return `Math.acosh(${compile(args[0])})`;
  },
  Arccot: ([x], compile, target) => {
    if (x === null) throw new Error('Could not compile `Arccot`: no argument');
    if (BaseCompiler.isComplexValued(x))
      return complexUnary(target, '_SYS.cacot', compile(x));
    // `Math.atan(1/x)` returns the wrong branch for x < 0 (range (-π/2, 0)
    // instead of the interpreter's (0, π)). `π/2 - atan(x)` is branch-free and
    // gives the full (0, π) range for all real x.
    return `(Math.PI / 2 - Math.atan(${compile(x)}))`;
  },
  Arcoth: ([x], compile, target) => {
    if (x === null) throw new Error('Could not compile `Arcoth`: no argument');
    if (BaseCompiler.isComplexValued(x))
      return complexUnary(target, '_SYS.cacoth', compile(x));
    if (resultIsComplexValued('Arcoth', [x]))
      return complexUnary(
        target,
        '_SYS.cacoth',
        complexOperandCode(x, compile)
      );
    return `Math.atanh(1 / (${compile(x)}))`;
  },
  Arccsc: ([x], compile, target) => {
    if (x === null) throw new Error('Could not compile `Arccsc`: no argument');
    if (BaseCompiler.isComplexValued(x))
      return complexUnary(target, '_SYS.cacsc', compile(x));
    if (resultIsComplexValued('Arccsc', [x]))
      return complexUnary(target, '_SYS.cacsc', complexOperandCode(x, compile));
    return `Math.asin(1 / (${compile(x)}))`;
  },
  Arcsch: ([x], compile, target) => {
    if (x === null) throw new Error('Could not compile `Arcsch`: no argument');
    if (BaseCompiler.isComplexValued(x))
      return complexUnary(target, '_SYS.cacsch', compile(x));
    return `Math.asinh(1 / (${compile(x)}))`;
  },
  Arcsec: ([x], compile, target) => {
    if (x === null) throw new Error('Could not compile `Arcsec`: no argument');
    if (BaseCompiler.isComplexValued(x))
      return complexUnary(target, '_SYS.casec', compile(x));
    if (resultIsComplexValued('Arcsec', [x]))
      return complexUnary(target, '_SYS.casec', complexOperandCode(x, compile));
    return `Math.acos(1 / (${compile(x)}))`;
  },
  Arsech: ([x], compile, target) => {
    if (x === null) throw new Error('Could not compile `Arsech`: no argument');
    if (BaseCompiler.isComplexValued(x))
      return complexUnary(target, '_SYS.casech', compile(x));
    if (resultIsComplexValued('Arsech', [x]))
      return complexUnary(
        target,
        '_SYS.casech',
        complexOperandCode(x, compile)
      );
    return `Math.acosh(1 / (${compile(x)}))`;
  },
  Arcsin: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return complexUnary(target, '_SYS.casin', compile(args[0]));
    if (resultIsComplexValued('Arcsin', args))
      return complexUnary(
        target,
        '_SYS.casin',
        complexOperandCode(args[0], compile)
      );
    return `Math.asin(${compile(args[0])})`;
  },
  Arsinh: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return complexUnary(target, '_SYS.casinh', compile(args[0]));
    return `Math.asinh(${compile(args[0])})`;
  },
  Arctan: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return complexUnary(target, '_SYS.catan', compile(args[0]));
    return `Math.atan(${compile(args[0])})`;
  },
  Artanh: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return complexUnary(target, '_SYS.catanh', compile(args[0]));
    if (resultIsComplexValued('Artanh', args))
      return complexUnary(
        target,
        '_SYS.catanh',
        complexOperandCode(args[0], compile)
      );
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
  Cos: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return complexUnary(target, '_SYS.ccos', compile(args[0]));
    return `Math.cos(${compile(args[0])})`;
  },
  Cosh: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return complexUnary(target, '_SYS.ccosh', compile(args[0]));
    return `Math.cosh(${compile(args[0])})`;
  },
  Cot: ([x], compile, target) => {
    if (x === null) throw new Error('Could not compile `Cot`: no argument');
    if (BaseCompiler.isComplexValued(x))
      return complexUnary(target, '_SYS.ccot', compile(x));
    return `_SYS.cot(${compile(x)})`;
  },
  Coth: ([x], compile, target) => {
    if (x === null) throw new Error('Could not compile `Coth`: no argument');
    if (BaseCompiler.isComplexValued(x))
      return complexUnary(target, '_SYS.ccoth', compile(x));
    return BaseCompiler.inlineExpression(
      target,
      '(Math.cosh(${x}) / Math.sinh(${x}))',
      compile(x)
    );
  },
  Csc: ([x], compile, target) => {
    if (x === null) throw new Error('Could not compile `Csc`: no argument');
    if (BaseCompiler.isComplexValued(x))
      return complexUnary(target, '_SYS.ccsc', compile(x));
    return `_SYS.csc(${compile(x)})`;
  },
  Csch: ([x], compile, target) => {
    if (x === null) throw new Error('Could not compile `Csch`: no argument');
    if (BaseCompiler.isComplexValued(x))
      return complexUnary(target, '_SYS.ccsch', compile(x));
    return `1 / Math.sinh(${compile(x)})`;
  },
  Exp: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return complexUnary(target, '_SYS.cexp', compile(args[0]));
    return `Math.exp(${compile(args[0])})`;
  },
  // A STRING source is SEGMENTED first: `"s"[0]` selects a UTF-16 code unit,
  // which for an astral character is half a surrogate pair and for a decomposed
  // sequence only the base letter, where the interpreter yields the whole
  // grapheme cluster (`docs/STRING_ROADMAP.md`,
  // decision D13).
  First: (args, compile) => compileNthElement(args[0], 0, compile),
  Floor: (args, compile, target) => {
    if (BaseCompiler.isIntegerValued(args[0]))
      return identityPassthrough(args[0], compile, target);
    return `Math.floor(${compile(args[0])})`;
  },
  Fract: ([x], compile, target) => {
    if (x === null) throw new Error('Could not compile `Fract`: no argument');
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
    if (f == null || x == null)
      throw new Error('Could not compile `Limit`: missing argument');
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
  Ln: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0])) {
      // The operand may be complex only by WIDENESS (the complex discipline
      // lifted it): that is a promotion for the `promoted` report, and the
      // predicate below records it (its lowering is the same kernel).
      BaseCompiler.recordPromotion('Ln', args);
      return complexUnary(target, '_SYS.cln', compile(args[0]));
    }
    // Real-emitted operand with a complex result — a PROVABLY negative operand
    // (`Ln(-2)`, or `a := -2` → `Ln(a)` is `complex`), or an
    // unknown-sign one under the caller's `complexPromotion` opt-in. The
    // parent emits `{re, im}` arithmetic, so `Math.log` — a `NaN` number —
    // must not be the lowering. Without the opt-in an unknown-sign operand
    // keeps the real kernel (pinned; `promotesToComplexLane` mirrors the
    // `isComplexValued` Sqrt/Ln/Log carve-out, which makes the parent agree).
    if (promotesToComplexLane('Ln', args))
      return complexUnary(
        target,
        '_SYS.cln',
        complexOperandCode(args[0], compile)
      );
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
  // to a JS array; a dictionary or string operand fails closed.
  Length: (args, compile, target) => {
    const arg = args[0];
    if (arg === null || arg === undefined)
      throw new Error('Could not compile `Length`: no argument');
    // A STRING's length is its GRAPHEME-CLUSTER count, which is what the
    // interpreter's `BoxedString.count` reports. Never `.length` on the JS
    // string: that counts UTF-16 code units, so a ZWJ family emoji would
    // measure 8 and a decomposed `"é"` 2, where the interpreter answers 1.
    // (`docs/STRING_ROADMAP.md`, decision D13.)
    if (isProvablyStringOperand(arg))
      return `_SYS.chars(${compile(arg)}).length`;
    if (!isIndexedCollectionOperand(arg, target)) {
      // Counting needs no positions or order, so an abstract collection
      // (declared or inferred) is read through `_SYS.elts`, which accepts an
      // array or a JavaScript `Set` (`iterableCollectionCode`).
      const checked = iterableCollectionCode('Length', arg, compile);
      if (checked !== undefined) return `(${checked}).length`;
      throw new Error(
        `Could not compile \`Length\`: operand is not an indexed collection ` +
          `(list/vector/range).`
      );
    }
    // A union with a text arm (`string | list<number>`) is a subtype of
    // `indexed_collection` — a string is one — and so passes the test above,
    // but `.length` on the JS string it may hold at run time counts UTF-16
    // code units, not the grapheme clusters the interpreter counts. Refused
    // (D6); see `couldBeStringOperand`.
    if (couldBeStringOperand(arg))
      throw new Error(
        `Could not compile \`Length\`: operand may be text at run time (its type ` +
          `has a string arm), and \`.length\` counts UTF-16 code units, not ` +
          `characters. The interpreter evaluates it instead.`
      );
    // `Length(Filter(1..n, p))` counts the selected elements in a loop over
    // the range instead of building the range and the filtered list
    // (`emitPredicateRangeWalk`, issue #373).
    if (isWalkableRangeFilter(arg, target))
      return emitPredicateRangeWalk(
        'Filter',
        arg.ops[0],
        arg.ops[1],
        compile,
        target,
        countingWalkPlan(target)
      );
    // A positional gather (a range, a literal list of indices, or a `Join`
    // of those) is POSITION-PRESERVING — an out-of-band index contributes an
    // absence marker in place rather than being dropped — so its length is
    // the number of indices the pieces hold, and no slice has to be built to
    // count them. The source is still read, and still tested
    // for being an array: `Length` of a gather over a non-array answers the
    // same NaN the gather itself would.
    const loop = emitRangeGatherReduction(
      arg,
      target,
      '0',
      undefined,
      (_acc, count) => count
    );
    return loop ?? `(${compile(arg)}).length`;
  },
  // Positional access. CE `At` is 1-based and supports negative indices from
  // the end. The index may be a scalar, a list of integers (gather), or a
  // boolean mask — `_SYS.at` dispatches on its runtime shape, since an index
  // expression (e.g. `p[X-1]`) is not always statically provably a collection.
  // A scalar out-of-range or zero index yields NaN (matching the interpreter's
  // `Nothing`, projected to NaN on a real target); a gather is
  // position-preserving, so an out-of-range or zero index contributes NaN in
  // place and the gathered length is the number of indices, not the number
  // of hits; a non-integer entry in a collection index makes the interpreter
  // decline, projected as a scalar NaN for the whole result. Only the
  // single-index form over an indexed collection compiles; nested/multi-index
  // access and non-collection operands fail closed.
  At: (args, compile, target) => {
    const coll = args[0];
    const index = args[1];
    if (
      coll === null ||
      coll === undefined ||
      index === null ||
      index === undefined
    )
      throw new Error('Could not compile `At`: missing argument');
    if (args.length !== 2)
      throw new Error(
        `Could not compile \`At\`: only the single-index form compiles; multi-index (nested) ` +
          `access is not supported.`
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
    // A SYMBOL whose inferred type says "a collection" without proving an
    // indexed one and without an indexed arm to admit it below
    // (`let q = Fold((acc, i) => Join(acc, [p[i]]), [], 1..n)` infers
    // `q: collection<any>`) is read through the run-time array check
    // `_SYS.arr`, as `Length` and the list operators read it (issue #369): a
    // set or a dictionary that does arrive throws instead of reading as a
    // silent `NaN`. The index must be provably numeric, as for a base
    // admitted by the "could be" test: such a base may hold a dictionary at
    // run time, where the interpreter answers a keyed lookup, and a keyed
    // access must decline here so that the interpreter evaluates it.
    const checkedBase =
      isIndexedCollectionOperand(coll, target) ||
      couldBeIndexedCollectionOperand(coll) ||
      !isNumericIndexOperand(index)
        ? undefined
        : runtimeCheckedArrayCode('At', coll, compile);
    const provablyIndexed =
      stringBase ||
      checkedBase !== undefined ||
      isIndexedCollectionOperand(coll, target);
    if (!provablyIndexed && !couldBeIndexedCollectionOperand(coll))
      throw new Error(
        `Could not compile \`At\`: first operand is not an indexed collection ` +
          `(list/vector/range).`
      );
    const collCode = (): string => checkedBase ?? compile(coll);
    // A base admitted only by the "could be" path may be a dictionary at run
    // time, and keyed access has no compiled equivalent (`_SYS.at` answers NaN
    // for a non-array base, where the interpreter returns the stored value).
    // Require a provably numeric index there rather than emit a silent NaN.
    if (!provablyIndexed && !isNumericIndexOperand(index))
      throw new Error(
        `Could not compile \`At\`: the first operand is not provably an indexed ` +
          `collection (type \`${coll.type.toString()}\`) and the index is not ` +
          `provably numeric, so a keyed (dictionary) access cannot be ruled ` +
          `out.`
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
      return `((${collCode()})[(${indexCode}) - 1] ?? NaN)`;
    }
    const base = `_SYS.at(${stringBase ? `_SYS.chars(${collCode()})` : collCode()}, ${compile(index)})`;
    // `_SYS.at` marks an out-of-band SCALAR access with `NaN` (the numeric
    // absence marker). For an OBJECT-domain collection (non-numeric elements),
    // absence must instead be the target null (`undefined`, I6) so the object
    // discharge (`Coalesce`, `IsMissing`) sees it — map the marker across. Only
    // the scalar-index case: a gather yields an array, handled position-wise.
    // The extracted element type can itself be a reference (`list<maybe_n>`
    // with `maybe_n = number | missing`) — unfold it before the missing-strip,
    // or the strip is a no-op and the axis test misclassifies the domain.
    // A base that can be absent as a whole (a restricted collection, typed
    // `missing | list<…>`) is read through its present arm: the element
    // domain is that arm's, and `_SYS.at` answers `NaN` for the absent base,
    // which the object-domain mapping below turns into `undefined`. So a row
    // read of a restricted matrix whose condition is false is `undefined`
    // (the interpreter's `Missing`), and a number read is `NaN`.
    const eltT = collectionElementType(stripMissingFromType(jsType(coll)));
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
      return `_SYS.atNumeric(${stringBase ? `_SYS.chars(${collCode()})` : collCode()}, ${compile(index)}, ${JSON.stringify(typeToString(eltT!))})`;
    return base;
  },
  // Fold a collection. CE `Reduce` canonicalizes `\sum_{i=d}^{d} d` to
  // `Reduce(d, Add, 0)`. The Add/Multiply/Min/Max folds compile, as does a
  // custom combiner (`Function` literal or function-valued symbol, compiled
  // as a lambda like `Map`/`Filter`) — but a custom combiner requires an
  // explicit initial value: without one the interpreter folds from `Nothing`
  // (whose effect depends on the combiner and has no numeric equivalent),
  // while a native seedless reduce starts from the first element — those
  // diverge for non-commutative combiners. Anything else fails closed.
  // `Fold(f, init, coll)` canonicalizes to `Reduce(coll, f, init)`, so this
  // handler covers it too.
  Reduce: (args, compile, target) => {
    const coll = args[0];
    const op = args[1];
    const init = args[2];
    if (coll === null || coll === undefined || op === null || op === undefined)
      throw new Error('Could not compile `Reduce`: missing argument');
    // A STRING source folds over its CHARACTERS — see `elementsArg`. The gate
    // runs here, ahead of the combiner checks, so the order in which the two
    // diagnostics are reported is unchanged; the operand itself is compiled
    // below, where it was.
    if (!isProvablyStringOperand(coll) && !isIndexedCollectionOperand(coll))
      throw new Error(
        `Could not compile \`Reduce\`: first operand is not an indexed collection ` +
          `(list/vector/range).`
      );
    // Product's canonical collection form is Reduce(Map(...), Multiply, 1).
    if (
      isSymbol(op) &&
      (op.symbol === 'Add' || op.symbol === 'Multiply') &&
      isNumber(init) &&
      init.isSame(op.symbol === 'Add' ? 0 : 1) &&
      BaseCompiler.collectionFoldsReal(coll)
    ) {
      const mapped = emitMappedReduction(
        op.symbol === 'Add' ? 'Sum' : 'Product',
        coll,
        target
      );
      if (mapped !== undefined) return mapped;
    }
    let combiner =
      nestedElementCombiner('Reduce', coll, op) ??
      builtinCombiner(op, BaseCompiler.foldLaneIsComplex(coll, init));
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
        `Could not compile \`Reduce\`: an ${(op as Expression & { symbol?: string }).symbol ?? 'arithmetic'} ` +
          `fold over a string folds over its CHARACTERS, which the ` +
          `interpreter rejects with an \`incompatible-type\` error rather ` +
          `than combining. The interpreter evaluates it instead.`
      );
    if (
      combiner === undefined &&
      (isFunction(op, 'Function') || isSymbol(op))
    ) {
      if (init === undefined || init === null)
        throw new Error(
          `Could not compile \`Reduce\`: a custom combiner compiles only with an explicit ` +
            `initial value.`
        );
      // The combiner is `(accumulator, element)`. The accumulator's type is
      // the fold's own result: when `combinerPlan` puts the accumulator in
      // the complex lane (a real seed is then lifted) an annotation is
      // judged against `complex`; otherwise against the join of the seed's
      // type and the combiner's result type
      // (`BaseCompiler.foldAccumulatorArgType`), which is what an annotated
      // accumulator provably receives on every step.
      const plan = BaseCompiler.combinerPlan(coll, op, init, target);
      BaseCompiler.assertCallbackAnnotations('Reduce', op, [
        plan?.accComplex
          ? 'complex'
          : BaseCompiler.foldAccumulatorArgType(coll, op, init, target),
        BaseCompiler.collectionElementTypeOf(coll),
      ]);
      assertAccumulatorFitsStep('Reduce', op, init);
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
      // An accumulator that only the fold can see is updated in place when
      // the step allows it (`inPlaceUpdateChains`). The seed is then copied
      // once, so the fold owns the one array that every step updates.
      const chains = plan?.coerceSeed ? undefined : inPlaceUpdateChains(op);
      for (const ops of chains ?? []) IN_PLACE_UPDATE_OPS.add(ops);
      try {
        combiner = customCombinerWithLanes(op, plan, compile, target);
      } finally {
        for (const ops of chains ?? []) IN_PLACE_UPDATE_OPS.delete(ops);
      }
      seed = plan?.coerceSeed
        ? `_SYS.cplx(${compile(init)})`
        : chains !== undefined
          ? `_SYS.ownedCopy(${compile(init)})`
          : undefined;
    }
    if (combiner === undefined)
      throw new Error(
        `Could not compile \`Reduce\`: the combiner has no compiled function form — only ` +
          `Add/Multiply/Min/Max folds, function literals, and user-defined ` +
          `functions compile on the JavaScript target.`
      );
    // Over a finite range, fold each element as the range is walked, without
    // building the range (`emitPredicateRangeWalk`, issue #387). The
    // combiner is called with `(accumulator, element)`, in range order, as
    // the native `reduce` below calls it; without a seed the first element
    // is the seed, and an empty range answers NaN, as below.
    if (isWalkableRange(coll, target)) {
      const acc = BaseCompiler.tempVar(target);
      if (init !== undefined && init !== null) {
        const seedCode = seed ?? compile(init);
        return emitPredicateRangeWalk(
          'Reduce',
          coll,
          { code: combiner },
          compile,
          target,
          {
            init: `let ${acc} = ${seedCode};`,
            body: (element, _selected, _exit, f) =>
              `${acc} = ${f}(${acc}, ${element});`,
            result: acc,
          }
        );
      }
      const started = BaseCompiler.tempVar(target);
      return emitPredicateRangeWalk(
        'Reduce',
        coll,
        { code: combiner },
        compile,
        target,
        {
          init: `let ${acc} = NaN; let ${started} = false;`,
          body: (element, _selected, _exit, f) =>
            `if (${started}) ${acc} = ${f}(${acc}, ${element}); ` +
            `else { ${acc} = ${element}; ${started} = true; }`,
          result: acc,
        }
      );
    }
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
  // (list/vector/range) lowers to a JS array; other operands fail closed,
  // matching `Length`/`At`/`Reduce`.
  //
  // `Last` is the last element (`At(coll, -1)`); an empty collection yields NaN
  // (the interpreter's `Nothing` projected onto a real target).
  //
  // A collection that can be absent as a whole (typed `missing | list<…>`: a
  // row read of a list of lists, a restricted list) is lowered as the read
  // `At(coll, -1)`. The `At` lowering reads such a base through its present
  // type and answers the marker of the element domain when the base is
  // absent: `NaN` for numbers, `undefined` for any other element, as the
  // interpreter answers `NaN` and `Missing`. `elementsArg` refuses the
  // operand, because its type has a `missing` arm.
  Last: (args, compile) => {
    const coll = args[0];
    if (coll != null && isGatedIndexedCollection(coll))
      return compile(coll.engine._fn('At', [coll, coll.engine.number(-1)]));
    return `_SYS.at(${elementsArg('Last', coll, compile)}, -1)`;
  },
  // All-but-first / all-but-first-n / first-n. `Take`/`Drop` clamp the count to
  // ≥ 0 so a negative count matches the interpreter (`Take(xs, -2) = []`,
  // `Drop(xs, -2) = xs`), and JS `slice` already clamps a count past the end.
  Rest: (args, compile) =>
    joinIfString(
      args[0],
      `(${elementsArg('Rest', args[0], compile)}).slice(1)`
    ),
  Take: (args, compile) => {
    if (args[1] == null)
      throw new Error('Could not compile `Take`: missing count');
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
          `Could not compile \`Take\`: a non-finite count (\`${args[1].toString()}\`) cannot bound ` +
            `an infinite collection.`
        );
      return `_SYS.takeIter(${emitLazyStream(args[0]!, compile)}, ${compileRealOperand(args[1], compile)})`;
    }
    const coll = elementsArg('Take', args[0], compile);
    return joinIfString(
      args[0],
      `(${coll}).slice(0, ${clampedSliceCount(args[1], compile)})`
    );
  },
  Drop: (args, compile) => {
    const coll = elementsArg('Drop', args[0], compile);
    if (args[1] == null)
      throw new Error('Could not compile `Drop`: missing count');
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
        `Could not compile \`Sort\`: a custom comparator is not supported; only the default ascending numeric sort is.`
      );
    // A STRING source sorts its CHARACTERS, which are ordered by code-point
    // sequence, not numerically: the numeric comparator below would answer NaN
    // for every pair and leave the array in source order. `_SYS.cmpc` is the
    // interpreter's own character order (`compare.ts`, decision D8).
    if (isProvablyStringOperand(args[0]))
      return joinIfString(args[0], `(${coll}).slice().sort(_SYS.cmpc)`);
    // An absent cell (`undefined` at run time) needs no comparator case:
    // `Array.prototype.sort` puts every `undefined` element after the others
    // without calling the comparator, which is where the interpreter puts an
    // absent cell (after `NaN`).
    assertNumericSortElements('Sort', args[0]!);
    return `(${coll}).slice().sort(${NAN_LAST_COMPARATOR})`;
  },
  // Flat concatenation of the (top-level) elements of each collection operand
  // (`compileJSJoin`).
  Join: (args, compile) => compileJSJoin('Join', args, compile),
  // The list literal with a spread, `[...xs, v]`. It compiles as `Join`,
  // except that an all-string call is not a string concatenation: the
  // literal is a list whatever its operands are, and a string operand, which
  // does not lower to a JavaScript array, fails closed in `collArg`.
  ListJoin: (args, compile) => compileJSJoin('ListJoin', args, compile),
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
        `Could not compile \`StringJoin\`: the operator takes a collection and an ` +
          `optional separator (\`StringJoin(xs, sep)\`); the variadic ` +
          `concatenation form was removed in Phase 2 (use \`Join(a, b, …)\`). The interpreter evaluates it instead.`
      );
    let separator = '""';
    if (args.length === 2) {
      if (!isProvablyStringOperand(args[1]))
        throw new Error(
          `Could not compile \`StringJoin\`: the separator must be provably a ` +
            `string; the interpreter leaves the expression unevaluated on any ` +
            `other operand. The interpreter evaluates it instead.`
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
          `Could not compile \`StringJoin\`: the subject must be a string or an ` +
            `indexed collection whose elements are provably strings or ` +
            `characters (\`list<string>\`, \`list<character>\`); a ` +
            `non-collection or non-text operand leaves the interpreter's ` +
            `\`StringJoin\` unevaluated or reports a type error. The interpreter evaluates it instead.`
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
  // Everything else fails closed, and two shapes deserve naming: a NUMBER
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
        `Could not compile \`String\`: every operand must be provably a string or ` +
          `a character. Rendering any other value reproduces the engine's ` +
          `number- and expression-formatting options, which this target does ` +
          `not carry. The interpreter evaluates it instead.`
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
        `Could not compile \`RangeOf\`: expected \`RangeOf(xs, needle, from?)\`.`
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
        `Could not compile \`RangeOf\`: the needle is provably empty, and an ` +
          `empty needle is an error value in the interpreter (an empty span ` +
          `has no \`Range\` representation), which a compiled artifact ` +
          `cannot return. The interpreter evaluates it instead.`
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
        `Could not compile \`ContainsSequence\`: expected ` +
          `\`ContainsSequence(xs, needle)\`.`
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
        `Could not compile \`StartsWith\`: expected \`StartsWith(xs, prefix)\`.`
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
        `Could not compile \`EndsWith\`: expected \`EndsWith(xs, suffix)\`.`
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
      `Could not compile \`RegExp\`: a compiled pattern is not a value on this ` +
        `target; use it directly in \`IsMatch\` or \`StringReplace\`.`
    );
  },
  IsMatch: (args, compile) => {
    if (args.length !== 2)
      throw new Error(
        `Could not compile \`IsMatch\`: expected \`IsMatch(subject, pattern)\`.`
      );
    const subject = stringArg('IsMatch', args[0], compile, 'the subject');
    const { source, flags } = literalPatternArg('IsMatch', args[1]);
    return `_SYS.reis(${subject}, ${source}, ${flags})`;
  },
  StringReplace: (args, compile) => {
    if (args.length < 3 || args.length > 4)
      throw new Error(
        `Could not compile \`StringReplace\`: expected ` +
          `\`StringReplace(s, target, replacement, count?)\`.`
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
        `Could not compile \`StringRepeat\`: expected \`StringRepeat(s, n)\`.`
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
        `Could not compile \`ToUpperCase\`: expected \`ToUpperCase(s)\`.`
      );
    const s = stringArg('ToUpperCase', args[0], compile, 'the operand');
    return `(_SYS.ct(${s}).toUpperCase().normalize())`;
  },
  ToLowerCase: (args, compile) => {
    if (args.length !== 1)
      throw new Error(
        `Could not compile \`ToLowerCase\`: expected \`ToLowerCase(s)\`.`
      );
    const s = stringArg('ToLowerCase', args[0], compile, 'the operand');
    return `(_SYS.ct(${s}).toLowerCase().normalize())`;
  },
  CaseFold: (args, compile) => {
    if (args.length !== 1)
      throw new Error(
        `Could not compile \`CaseFold\`: expected \`CaseFold(s)\`.`
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
        `Could not compile \`StringCompare\`: expected \`StringCompare(a, b)\`.`
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
  // `IndexOf([0.30000000000000004], 0.3)` both answer 0, probe-verified),
  // the same exact comparison `compileJSEquality` emits for `Equal`. It is not
  // `Array.indexOf` either, because text is compared with `_SYS.eqt`
  // (below). `findIndex` is 0-based and returns -1 when absent, so `+ 1` maps
  // both. The value is hoisted into an IIFE parameter so it is evaluated
  // once.
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
    if (args[1] == null)
      throw new Error('Could not compile `IndexOf`: missing value');
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
      return compileSearchedValue(
        'IndexOf',
        args[1],
        args[0],
        compile,
        (v) =>
          `((_v) => (${coll}).findIndex((_x) => _SYS.eqt(_x, _v)) + 1)(${v})`
      );
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
          `Could not compile \`IndexOf\`: the needle is a collection, which the ` +
            `compiled element test compares by reference identity, never ` +
            `finding it where the interpreter compares element-wise. The interpreter evaluates it instead.`
        );
    }
    // No element-type gate: the only shapes the removed one closed were the
    // wholly-text element types (`isSubtype(elt, 'string' | 'character')`),
    // which the `===` leaf now handles faithfully. A MIXED element type such as
    // `number | string` never satisfied that subtype test, so it was never
    // closed here — and needs no closing, since `===` is exact for every
    // element sort (see the boolean note below).
    //
    // `_SYS.eqt` is the whole element test: SameValueZero for every non-text
    // pair (so a `NaN` needle is found where `NaN` sits, and an absent needle,
    // `undefined`, where an absent cell sits, as the interpreter's structural
    // search finds them), and conditioned (NFC, well-formed) content equality
    // for a text pair, which is what the interpreter compares. BOOLEAN-ness
    // needs no guard: `true === 1`
    // is false natively (it was an earlier tolerance leaf, `Math.abs(true - 1) <= tol`, that found
    // a boolean needle in a numeric haystack, and a numeric needle in a
    // boolean one, where the interpreter answers 0).
    return compileSearchedValue(
      'IndexOf',
      args[1],
      args[0],
      compile,
      (v) => `((_v) => (${coll}).findIndex((_x) => _SYS.eqt(_x, _v)) + 1)(${v})`
    );
  },
  // Higher-order: the mapping/predicate operand is compiled as a lambda
  // (`Function` literal → `(x) => …`), hoisted into an IIFE parameter so it
  // is instantiated once (not once per element), and invoked with a fixed
  // unary arity — the native callbacks pass `(x, index, array)` and the
  // extra arguments must not leak into the lambda's parameters (the
  // interpreter passes exactly `(x)`). A mapping operand that does not
  // compile to a lambda fails closed.
  Map: (args, compile, target) => {
    if (args[1] == null)
      throw new Error('Could not compile `Map`: missing source collection');
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
    // Over a finite range, push each mapped element into the result as the
    // range is walked, instead of building the range and mapping it into a
    // second array (`emitPredicateRangeWalk`, issue #387). The callback is
    // compiled by `fnArg` either way, and called with the element alone.
    if (isWalkableRange(args[1], target)) {
      const out = BaseCompiler.tempVar(target);
      return emitPredicateRangeWalk('Map', args[1], args[0], compile, target, {
        init: `const ${out} = [];`,
        body: (_element, mapped) => `${out}.push(${mapped});`,
        result: out,
      });
    }
    const coll = elementsArg('Map', args[1], compile);
    return `((_f) => (${coll}).map((_x) => _f(_x)))(${fnArg('Map', args[0], args[1], compile, [], target)})`;
  },
  Filter: (args, compile, target) => {
    // Over a finite range, push the selected elements into one list as the
    // range is walked, instead of building the range and filtering it into
    // a second array (`emitPredicateRangeWalk`). The source is compiled by
    // whichever lowering runs, and once.
    const walk = isWalkableRange(args[0], target);
    const coll = walk ? '' : elementsArg('Filter', args[0], compile);
    if (args[1] == null)
      throw new Error('Could not compile `Filter`: missing predicate');
    if (walk) {
      const out = BaseCompiler.tempVar(target);
      return emitPredicateRangeWalk(
        'Filter',
        args[0],
        args[1],
        compile,
        target,
        {
          init: `const ${out} = [];`,
          body: (element, selected) =>
            `if (${selected}) ${out}.push(${element});`,
          result: out,
        }
      );
    }
    return joinIfString(
      args[0],
      `((_f) => (${coll}).filter((_x) => _f(_x)))(${fnArg('Filter', args[1], args[0], compile, [], target)})`
    );
  },
  // Number of elements satisfying the predicate.
  CountIf: (args, compile, target) => {
    // Over a finite range, count in a loop instead of building the range
    // and the filtered list (`emitPredicateRangeWalk`, issue #373).
    const walk = isWalkableRange(args[0], target);
    const coll = walk ? '' : elementsArg('CountIf', args[0], compile);
    if (args[1] == null)
      throw new Error('Could not compile `CountIf`: missing predicate');
    if (walk)
      return emitPredicateRangeWalk(
        'CountIf',
        args[0],
        args[1],
        compile,
        target,
        countingWalkPlan(target)
      );
    return `((_f) => (${coll}).filter((_x) => _f(_x)).length)(${fnArg('CountIf', args[1], args[0], compile, [], target)})`;
  },
  // First element satisfying the predicate; none → NaN (the interpreter's
  // `Nothing` projected onto a real target, matching `Last`).
  Find: (args, compile, target) => {
    const coll = elementsArg('Find', args[0], compile);
    if (args[1] == null)
      throw new Error('Could not compile `Find`: missing predicate');
    return `((_f) => ((${coll}).find((_x) => _f(_x)) ?? NaN))(${fnArg('Find', args[1], args[0], compile, [], target)})`;
  },
  // 1-based index of the first element satisfying the predicate, or 0 if
  // none — `findIndex` is 0-based and returns -1, so `+ 1` maps both.
  IndexWhere: (args, compile, target) => {
    const coll = elementsArg('IndexWhere', args[0], compile);
    if (args[1] == null)
      throw new Error('Could not compile `IndexWhere`: missing predicate');
    return `((_f) => (${coll}).findIndex((_x) => _f(_x)) + 1)(${fnArg('IndexWhere', args[1], args[0], compile, [], target)})`;
  },
  // List of the 1-based indexes of the elements satisfying the predicate.
  Position: (args, compile, target) => {
    const coll = elementsArg('Position', args[0], compile);
    if (args[1] == null)
      throw new Error('Could not compile `Position`: missing predicate');
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
      throw new Error('Could not compile `Tabulate`: missing argument');
    if (args.length > 3)
      throw new Error(
        `Could not compile \`Tabulate\`: only the 1-D and 2-D forms compile.`
      );
    for (let i = 1; i < args.length; i++) {
      const dim = tryGetConstant(args[i]!);
      if (dim !== undefined && Math.round(dim) <= 0)
        throw new Error(
          `Could not compile \`Tabulate\`: a statically non-positive dimension (${dim}) is inert ` +
            `in the interpreter.`
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
      throw new Error('Could not compile `Fill`: missing argument');
    if (!isFunction(dims) || dims.ops.length !== 2)
      throw new Error(
        `Could not compile \`Fill\`: only the (function, (rows, cols)) form compiles.`
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
  // rejected at the signature — so it fails closed rather than
  // compiling to `[]` behind `success: true`. A count that the signature
  // cannot decide statically and that is non-finite only at run time
  // still projects to [] — the Chunk/RotateLeft precedent, and the
  // documented divergence: the interpreter stays inert there while the
  // compiled form yields [] rather than attempting an unbounded allocation.
  // The 1-argument form is an INFINITE lazy sequence with no compiled
  // representation, and a statically non-integer count is a type error in the
  // interpreter — both fail closed.
  Repeat: (args, compile) => {
    if (args[0] == null)
      throw new Error('Could not compile `Repeat`: missing value');
    if (args.length !== 2)
      throw new Error(
        `Could not compile \`Repeat\`: only the (value, count) form compiles — the 1-argument ` +
          `form is an infinite sequence.`
      );
    if (isNonFiniteBound(args[1]!))
      throw new Error(
        `Could not compile \`Repeat\`: a statically non-finite count (${args[1]!.toString()}) is ` +
          `inert in the interpreter.`
      );
    const nConst = tryGetConstant(args[1]!);
    if (nConst !== undefined && !Number.isInteger(nConst))
      throw new Error(
        `Could not compile \`Repeat\`: a non-integer count (${nConst}) is a type error in the ` +
          `interpreter.`
      );
    return `((_v, _n) => { _n = Math.round(_n); if (!(Number.isFinite(_n) && _n > 0)) return []; return Array.from({ length: _n }, () => _v); })(${compile(args[0])}, ${compileRealOperand(args[1]!, compile)})`;
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
  // A copy with one element replaced, removed or inserted, through the
  // `_SYS` helpers, which apply the interpreter's index rules and throw a
  // `RangeError` for an index the interpreter does not accept. A string
  // source is walked as its characters (`elementsArg`). The interpreter
  // answers a list of characters for `ReplaceAt` and `Insert` on a string,
  // and a string for `DeleteAt` (the string preservation rule), so only
  // `DeleteAt` joins the characters again.
  ReplaceAt: (args, compile) => {
    if (args[1] == null || args[2] == null)
      throw new Error('Could not compile `ReplaceAt`: missing argument');
    if (IN_PLACE_UPDATE_OPS.has(args))
      return compileInPlaceUpdateChain(args, compile);
    const coll = elementsArg('ReplaceAt', args[0], compile);
    return `_SYS.replaceAt(${coll}, ${compile(args[1])}, ${compile(args[2])})`;
  },
  DeleteAt: (args, compile) => {
    if (args[1] == null)
      throw new Error('Could not compile `DeleteAt`: missing index');
    const coll = elementsArg('DeleteAt', args[0], compile);
    return joinIfString(args[0], `_SYS.deleteAt(${coll}, ${compile(args[1])})`);
  },
  Insert: (args, compile) => {
    if (args[1] == null || args[2] == null)
      throw new Error('Could not compile `Insert`: missing argument');
    const coll = elementsArg('Insert', args[0], compile);
    return `_SYS.insert(${coll}, ${compile(args[1])}, ${compile(args[2])})`;
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
          'Could not compile `Slice`: the two-argument form takes an ascending index span (`range`)'
        );
      return joinIfString(
        args[0],
        `((_l, _r) => { if (!Array.isArray(_r) || _r.length === 0 || !Number.isInteger(_r[0]) || _r[0] < 1) throw new RangeError('Slice: the span argument is not an ascending index range at run time'); for (let _k = 1; _k < _r.length; _k++) if (_r[_k] !== _r[0] + _k) throw new RangeError('Slice: the span argument is not an ascending index range at run time'); return _l.slice(_r[0] - 1, _r[_r.length - 1]); })(${coll}, ${compile(args[1])})`
      );
    }
    if (args[1] == null || args[2] == null)
      throw new Error('Could not compile `Slice`: missing index');
    return joinIfString(
      args[0],
      `((_l, _s, _e) => { _s = Math.round(_s); if (!Number.isFinite(_s)) _s = 1; _e = Math.round(_e); if (!Number.isFinite(_e)) _e = _l.length; if (_s < 1) _s = _l.length + 1 + _s; if (_s < 1) _s = 1; if (_s > _l.length) return []; if (_e < 1) _e = _l.length + 1 + _e; if (_e < 1) _e = 1; if (_e > _l.length) _e = _l.length; return _l.slice(_s - 1, _e); })(${coll}, ${compileRealOperand(args[1], compile)}, ${compileRealOperand(args[2], compile)})`
    );
  },
  IsEmpty: (args, compile) =>
    `((${elementsArg('IsEmpty', args[0], compile)}).length === 0)`,
  // Number of elements — same as `Length` for an indexed collection.
  //
  // Two forms compile. The one-argument form, `Count(xs)`, is the number of
  // elements. The predicate form, `Count(xs, p)` with a function-typed `p`,
  // is the number of elements the predicate admits. The value form,
  // `Count(xs, v)`, counts the elements equal to `v` with the interpreter's
  // element equality, which is structural on compound elements; the
  // JavaScript `===` does not give that equality, so the value form is
  // refused with an error rather than compiled to code that could silently
  // give a different count. The interpreted fallback still evaluates it, as
  // it does for the multi-index form of `At`, which is refused the same way.
  Count: (args, compile, target) => {
    if (args.length === 1) {
      // `Count(Filter(1..n, p))` counts in a loop over the range instead of
      // building the range and the filtered list (`emitPredicateRangeWalk`,
      // issue #373). The predicate is compiled under the `Filter` label, as
      // the `Filter` handler would compile it, so a refusal reads the same.
      if (isWalkableRangeFilter(args[0], target))
        return emitPredicateRangeWalk(
          'Filter',
          args[0].ops[0],
          args[0].ops[1],
          compile,
          target,
          countingWalkPlan(target)
        );
      return `(${countSourceCode(args[0], compile, target)}).length`;
    }
    // The predicate form uses the same lowering as `CountIf` and `Filter`:
    // an element is counted when the compiled predicate returns a truthy
    // value. When the elements of `xs` are themselves functions, a
    // function-typed second operand could be a value to count as well as a
    // predicate, so that case is refused too.
    const elt = collectionElementType(jsType(args[0]));
    const functionValued = (t: Type): boolean => {
      const r = resolveTypeAlias(t);
      if (typeof r !== 'string' && r.kind === 'union')
        return r.types.some(functionValued);
      return r !== 'never' && r !== 'nothing' && isSubtype(r, 'function');
    };
    if (
      args.length === 2 &&
      args[1] != null &&
      args[1].type.matches('function') &&
      (elt === undefined || !functionValued(elt))
    ) {
      if (isWalkableRange(args[0], target))
        return emitPredicateRangeWalk(
          'Count',
          args[0],
          args[1],
          compile,
          target,
          countingWalkPlan(target)
        );
      const coll = countSourceCode(args[0], compile, target);
      return `((_f) => (${coll}).filter((_x) => _f(_x)).length)(${fnArg('Count', args[1], args[0], compile, [], target)})`;
    }
    throw new Error(
      `Could not compile \`Count\`: only the single-argument cardinality form and the ` +
        `predicate form (\`Count(xs, p)\`) compile; the value form (\`Count(xs, v)\`) is ` +
        `not supported, and neither is a function operand over a collection of functions, ` +
        `which could be either form.`
    );
  },
  // Membership via SameValueZero (`includes`) — value equality only for
  // primitive elements, so compound element types fail closed.
  Contains: (args, compile) => {
    if (args[0]) requirePrimitiveElements('Contains', args[0]);
    const coll = elementsArg('Contains', args[0], compile);
    if (args[1] == null)
      throw new Error('Could not compile `Contains`: missing value');
    // A TEXT membership test cannot be the raw SameValueZero of `includes`:
    // the interpreter compares strings by their CONDITIONED content (NFC, then
    // the lone-surrogate replacement), so a decomposed `"e" + U+0301` needle
    // bound to a compiled parameter must be found in a haystack of precomposed
    // literals — which `includes` misses, since the two are different
    // code-unit sequences. `_SYS.eqt` is the same element test `IndexOf` uses,
    // and it falls back to SameValueZero for every non-text pair, so a `NaN`
    // or absent needle is found where the same marker sits, as `includes`
    // finds it (`compileSearchedValue`).
    if (hasPossiblyTextElements(args[0]) || isProvablyTextOperand(args[1]))
      return compileSearchedValue(
        'Contains',
        args[1],
        args[0],
        compile,
        (v) => `((_v) => (${coll}).some((_x) => _SYS.eqt(_x, _v)))(${v})`
      );
    return compileSearchedValue(
      'Contains',
      args[1],
      args[0],
      compile,
      (v) => `(${coll}).includes(${v})`
    );
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
    if (args[0] == null)
      throw new Error('Could not compile `Linspace`: missing argument');
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
    if (args[1] == null)
      throw new Error('Could not compile `Chunk`: missing count');
    const kConst = tryGetConstant(args[1]);
    if (kConst !== undefined && !(Math.round(kConst) > 0))
      throw new Error(
        `Could not compile \`Chunk\`: a statically non-positive chunk count (${kConst}) is inert ` +
          `in the interpreter.`
      );
    // A literal count past the cap stays symbolic in the interpreter, so it
    // fails closed here; a run-time count past it answers NaN, the compiled
    // spelling for "no value".
    if (kConst !== undefined && Math.round(kConst) > MAX_CHUNK_COUNT)
      throw new Error(
        `Could not compile \`Chunk\`: a chunk count past ${MAX_CHUNK_COUNT} stays symbolic in the ` +
          `interpreter.`
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
    if (arg == null)
      throw new Error('Could not compile `Partition`: missing operand');
    if (arg.type.matches('number')) {
      const nConst = tryGetConstant(arg);
      if (nConst !== undefined && !(Math.round(nConst) > 0))
        throw new Error(
          `Could not compile \`Partition\`: a statically non-positive chunk size (${nConst}) is ` +
            `inert in the interpreter.`
        );
      const step = args[2];
      if (step !== undefined) {
        const stepConst = tryGetConstant(step);
        if (stepConst !== undefined && !(Math.round(stepConst) > 0))
          throw new Error(
            `Could not compile \`Partition\`: a statically non-positive step (${stepConst}) is ` +
              `inert in the interpreter.`
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
      `Could not compile \`Partition\`: the second operand must be an integer or a function ` +
        `literal.`
    );
  },
  // 1-based indexes that sort the collection ascending; ties keep their
  // original order (native sort is stable, matching the interpreter). A
  // custom ordering function does not compile, matching `Sort`.
  Ordering: (args, compile) => {
    const coll = collArg('Ordering', args[0], compile);
    if (args.length > 1)
      throw new Error(
        `Could not compile \`Ordering\`: a custom ordering function is not supported; only the default ascending numeric order is.`
      );
    // The comparator sees the CELLS here (it sorts indexes), so a cell that
    // may be absent needs its own case: `ABSENT_LAST_COMPARATOR`.
    const comparator = assertNumericSortElements('Ordering', args[0]!)
      ? ABSENT_LAST_COMPARATOR
      : NAN_LAST_COMPARATOR;
    return `((_l, _c) => Array.from({ length: _l.length }, (_, _i) => _i + 1).sort((_a, _b) => _c(_l[_a - 1], _l[_b - 1])))(${coll}, ${comparator})`;
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
        `Could not compile \`RandomShuffle\`: expected exactly one argument.`
      );
    return joinIfString(args[0], `_SYS.shuffle(${coll})`);
  },
  // True if the predicate holds for at least one / every element (vacuously
  // False / True on an empty collection, like `.some`/`.every`). Only the
  // predicate form compiles: without a predicate the elements must be
  // booleans, which a numeric collection cannot prove — the interpreter
  // stays inert there.
  Any: (args, compile, target) => {
    // Over a finite range, walk it and stop at the first selected element,
    // as `some` stops, with no range built (`emitPredicateRangeWalk`).
    const walk = isWalkableRange(args[0], target);
    const coll = walk ? '' : elementsArg('Any', args[0], compile);
    if (args[1] == null)
      throw new Error(
        `Could not compile \`Any\`: only the predicate form compiles.`
      );
    refuseKleeneQuantifier('Any', args[0], args[1]);
    if (walk)
      return emitPredicateRangeWalk('Any', args[0], args[1], compile, target, {
        init: '',
        body: (_element, selected, exit) => `if (${selected}) ${exit('true')}`,
        result: 'false',
      });
    return `((_f) => (${coll}).some((_x) => _f(_x)))(${fnArg('Any', args[1], args[0], compile, [], target)})`;
  },
  All: (args, compile, target) => {
    // Over a finite range, walk it and stop at the first element the
    // predicate rejects, as `every` stops (`emitPredicateRangeWalk`).
    const walk = isWalkableRange(args[0], target);
    const coll = walk ? '' : elementsArg('All', args[0], compile);
    if (args[1] == null)
      throw new Error(
        `Could not compile \`All\`: only the predicate form compiles.`
      );
    refuseKleeneQuantifier('All', args[0], args[1]);
    if (walk)
      return emitPredicateRangeWalk('All', args[0], args[1], compile, target, {
        init: '',
        body: (_element, selected, exit) =>
          `if (!(${selected})) ${exit('false')}`,
        result: 'true',
      });
    return `((_f) => (${coll}).every((_x) => _f(_x)))(${fnArg('All', args[1], args[0], compile, [], target)})`;
  },
  // Longest prefix satisfying the predicate / the rest after that prefix.
  TakeWhile: (args, compile, target) => {
    if (args[1] == null)
      throw new Error('Could not compile `TakeWhile`: missing predicate');
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
    if (args[1] == null)
      throw new Error('Could not compile `DropWhile`: missing predicate');
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
    if (args[1] == null)
      throw new Error('Could not compile `FlatMap`: missing mapping function');
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
    if (coll == null || op == null)
      throw new Error('Could not compile `Scan`: missing argument');
    if (!isIndexedCollectionOperand(coll))
      throw new Error(
        `Could not compile \`Scan\`: first operand is not an indexed collection ` +
          `(list/vector/range).`
      );
    const builtin =
      nestedElementCombiner('Scan', coll, op) ??
      builtinCombiner(op, BaseCompiler.foldLaneIsComplex(coll, init));
    // As `Reduce`: the accumulator's annotation is judged against the lane
    // `combinerPlan` chose, or else against the join of the seed's type (the
    // first element's, for a seedless scan) and the combiner's result type.
    const plan =
      builtin === undefined
        ? BaseCompiler.combinerPlan(coll, op, init, target)
        : undefined;
    if (builtin === undefined)
      BaseCompiler.assertCallbackAnnotations('Scan', op, [
        plan?.accComplex
          ? 'complex'
          : BaseCompiler.foldAccumulatorArgType(coll, op, init, target),
        BaseCompiler.collectionElementTypeOf(coll),
      ]);
    assertAccumulatorFitsStep('Scan', op, init);
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
        `Could not compile \`Scan\`: the combiner has no compiled function form — only ` +
          `Add/Multiply/Min/Max folds, function literals, and user-defined ` +
          `functions compile on the JavaScript target.`
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
    if (args[0] == null)
      throw new Error('Could not compile `Boole`: missing argument');
    const c = compile(args[0]);
    if (BaseCompiler.isBooleanValued(args[0])) return `((${c}) ? 1 : 0)`;
    return `(_SYS.cond(${c}) ? 1 : 0)`;
  },
  // δ: 1 when all arguments are equal — a single argument compares to 0 —
  // else 0. The comparison is EXACT (`===`), as compiled `Equal` is (see
  // `compileJSEquality`): a `NaN` argument answers 0. Arguments are hoisted
  // into IIFE parameters so each is evaluated once.
  //
  // The variadic form tests the first argument for absence before comparing.
  // An absent value reads as `undefined` on the object axis of this target,
  // and `undefined === undefined` is true, so two absent arguments would
  // otherwise answer 1 — where the interpreter answers `Missing` and a
  // compiled `Equal` of the same two operands answers false. Numeric absence
  // is `NaN`, which already fails the comparison against itself and so needs
  // no test of its own.
  KroneckerDelta: (args, compile) => {
    if (args.length === 0 || args[0] == null)
      throw new Error('Could not compile `KroneckerDelta`: missing argument');
    if (args.length === 1) return `(${compile(args[0])} === 0 ? 1 : 0)`;
    // A complex operand is a `{ re, im }` object, which `===` compares by
    // reference; compare it component-wise, as `compileJSEquality` does.
    if (args.some((a) => BaseCompiler.isComplexValued(a))) {
      const part = (e: Expression, c: string): string =>
        BaseCompiler.isComplexValued(e) ? c : `({ re: ${c}, im: 0 })`;
      return `((..._v) => _v[0] !== undefined && _v.every((_x) => _x.re === _v[0].re && _x.im === _v[0].im) ? 1 : 0)(${args.map((a) => part(a, compile(a))).join(', ')})`;
    }
    return `((..._v) => _v[0] !== undefined && _v.every((_x) => _x === _v[0]) ? 1 : 0)(${args.map((a) => compile(a)).join(', ')})`;
  },
  // Membership of a value in an indexed collection — `Contains` with the
  // operands flipped. Same primitive-element restriction; a domain (e.g.
  // `Element(x, Integers)`) is not an indexed collection and fails closed.
  Element: (args, compile) => {
    if (args[0] == null || args[1] == null)
      throw new Error('Could not compile `Element`: missing argument');
    requirePrimitiveElements('Element', args[1]);
    const coll = collArg('Element', args[1], compile);
    // An absent value is an element where the same marker sits (see
    // `compileSearchedValue`).
    return compileSearchedValue(
      'Element',
      args[0],
      args[1],
      compile,
      (v) => `(${coll}).includes(${v})`
    );
  },
  Identity: (args, compile, target) => {
    if (args[0] == null)
      throw new Error('Could not compile `Identity`: missing argument');
    return identityPassthrough(args[0], compile, target);
  },
  // Apply a function literal to arguments. (`Apply` with a *symbol* head
  // canonicalizes to a direct call, so only the function-literal form
  // reaches this handler.)
  Apply: (args, compile, target) => {
    if (args[0] == null)
      throw new Error('Could not compile `Apply`: missing function');
    // `Apply(Derivative(f, n), x)` — the parse of `f''(x)` — would otherwise
    // compile its callee through `compileDerivative`, which differentiates
    // `f`'s body n times at compile time. That closed form multiplies out,
    // so a nested composition costs tens of seconds and hundreds of
    // kilobytes of emitted code. Evaluate the body in Taylor-jet arithmetic
    // instead: one walk of the body, code that does not grow with `n`
    // (`jet-derivative.ts`). The jet route declines — falling back to the
    // closed form below — for order 1, for a small body whose closed form
    // stays compact, and for any head with no coefficient recurrence.
    const jet = tryCompileJetDerivative(args, compile, target);
    if (jet !== undefined) return jet;
    if (isFunction(args[0], 'Derivative') && args.length === 2) {
      const literal = derivativeClosedForm('Derivative', args[0].ops);
      if (isFunction(literal, 'Function') && literal.nops === 2) {
        const callee = BaseCompiler.withDerivativeArgument(
          literal,
          args[1],
          () => compile(literal)
        );
        return `(${callee})(${compile(args[1])})`;
      }
    }
    // A function literal with an annotated parameter checks an argument that
    // may be absent, as a call of a named function does
    // (`BaseCompiler.absentArgumentChecks`).
    const checks = isFunction(args[0], 'Function')
      ? BaseCompiler.absentArgumentChecks(
          '(function)',
          args[0],
          args.slice(1),
          target
        )
      : [];
    // When every argument is a run-time scalar by construction — the same
    // proof that lets a call of a named function skip its broadcast dispatch
    // (`isConstructedScalar`) — the literal is applied as a bare arrow,
    // without the broadcast wrapper and the closure that binds it, which were
    // otherwise built again at every evaluation of the application.
    const literal = args[0];
    const callee =
      isFunction(literal, 'Function') &&
      literal.nops === args.length &&
      args.slice(1).every((a) => isConstructedScalar(a, target))
        ? BaseCompiler.withScalarFedLiteral(literal, 'scalar', () =>
            compile(literal)
          )
        : compile(args[0]);
    return `(${callee})(${args
      .slice(1)
      .map((a, i) => BaseCompiler.presentCheckedCode(compile(a), checks[i]))
      .join(', ')})`;
  },
  // --- Linear algebra ------------------------------------------------------
  // `Dot` and `MatrixMultiply` share the interpreter's dimensionality
  // dispatch: vector·vector → scalar, matrix·vector / vector·matrix →
  // vector, matrix·matrix → matrix. Dimension mismatches yield NaN.
  Dot: (args, compile, target) => {
    if (args[0] == null || args[1] == null)
      throw new Error('Could not compile `Dot`: missing argument');
    const broadcast = BaseCompiler.compileBroadcastInnerProduct(args, target);
    if (broadcast !== undefined) return broadcast;
    // A LIST OF POINTS against a point, or against another list of points:
    // one inner product per point (user ruling of 2026-09-22). This is the
    // `PointList` spelling of the tuple broadcast above, and it answers the
    // same list. `_SYS.matmul` cannot serve it: an array of points and an
    // array of rows look alike at run time, so matrix multiplication happens
    // to be right for `Dot(P, q)` and is the wrong contraction for `Dot(q, P)`
    // and for two point lists. `_SYS.pointdot` is told which operand is the
    // list and broadcasts.
    if (args.some(isPointListOperandType)) {
      // The broadcast is defined for a point list against a POINT and for two
      // point lists, and for nothing else. A point list against a plain
      // vector or a matrix has no arm in the interpreter — it types `value`
      // and stays symbolic — so emitting a list here would make the compiled
      // route answer something the type does not describe. Fail closed.
      if (
        !args.every((a) => isPointListOperandType(a) || isPointOperandType(a))
      )
        throw new Error(
          'Could not compile `Dot`: a list of points is defined against a point or another list ' +
            'of points only; the other operand is neither, and the ' +
            'interpreter leaves this product unevaluated.'
        );
      // The product is computed coordinate by coordinate, so every
      // coordinate on both sides must be a value the emitted `*` and `+`
      // multiply and add. A pair of STRING coordinates would otherwise
      // answer a number (`"1" * "2"` is `2`) where the interpreter leaves
      // `Dot([("1", "2")], (3, 4))` symbolic, and a COMPLEX coordinate would
      // answer NaN with nothing to say why. The sibling tuple broadcast
      // (`BaseCompiler.compileBroadcastInnerProduct`) declines complex
      // coordinates with the same message.
      const coordinates: Type[] = [];
      for (const arg of args) {
        const cs = pointOperandCoordinateTypes(arg);
        if (cs === undefined)
          throw new Error(
            'Could not compile `Dot`: a list of points is multiplied coordinate by coordinate, ' +
              'and this operand does not name its coordinate types, so they ' +
              'cannot be proved numbers.'
          );
        coordinates.push(...cs);
      }
      if (!coordinates.every(isNumberCoordinateType))
        throw new Error(
          'Could not compile `Dot`: a list of points is multiplied coordinate by coordinate, and ' +
            'a coordinate here is not a number (a string, a nested ' +
            'collection, or a type too open to tell); the interpreter leaves ' +
            'such a product unevaluated.'
        );
      // The lane of the coordinates selects the helper, and the parent reads
      // the value with the same answer (`BaseCompiler.linearAlgebraLane`):
      // `_SYS.complexPointdot` returns `{re, im}` inner products, and
      // `_SYS.pointdot` real ones. A wide coordinate type
      // (`list<tuple<number, number>>`) is read as real in `strict` and
      // `auto` mode.
      const helper = linearAlgebraHelper(
        'Dot',
        'pointdot',
        'complexPointdot',
        args
      );
      // Which operand is the list is decided HERE, from the static type, and
      // passed to the helper. Read from the run-time value instead — by
      // testing whether the first element is an array — an EMPTY point list
      // is indistinguishable from a single point, and `Dot(P, q)` with
      // `P = []` answered NaN where the interpreter answers `[]`.
      const listFlags = args.map(isPointListOperandType);
      const operand = (arg: Expression, position: number) =>
        listFlags[position - 1]
          ? collArg('Dot', arg, compile, position)
          : compile(arg);
      return (
        `${helper}(${operand(args[0], 1)}, ${operand(args[1], 2)}, ` +
        `${listFlags[0]}, ${listFlags[1]})`
      );
    }
    // Tuple coordinates with numeric list components use the broadcast path
    // above. Other point-list spellings have no faithful component expansion;
    // passing their nested arrays to matrix multiplication changes the result.
    for (const arg of [args[0], args[1]])
      if (
        isUnwrittenPointWithCollectionComponent(arg) ||
        (!isFunction(arg, 'List') && pointHasBroadcastComponent(arg))
      )
        throw new Error(
          'Could not compile `Dot`: a point operand with a collection ' +
            'component.'
        );
    // Two points or vectors of one static width are written out as the sum of
    // their component products; every other shape takes the run-time
    // dispatch (`compileStaticInnerProduct`).
    const inner = BaseCompiler.compileStaticInnerProduct(args, target);
    if (inner !== undefined) return inner;
    // `compileStaticInnerProduct` declines a complex operand;
    // `_SYS.complexMatmul` computes with complex entries.
    return `${linearAlgebraHelper('Dot', 'matmul', 'complexMatmul', args)}(${collArg('Dot', args[0], compile, 1)}, ${collArg('Dot', args[1], compile, 2)})`;
  },
  MatrixMultiply: (args, compile) => {
    if (args[0] == null || args[1] == null)
      throw new Error('Could not compile `MatrixMultiply`: missing argument');
    return `${linearAlgebraHelper('MatrixMultiply', 'matmul', 'complexMatmul', args)}(${collArg('MatrixMultiply', args[0], compile, 1)}, ${collArg('MatrixMultiply', args[1], compile, 2)})`;
  },
  Cross: (args, compile) => {
    if (args[0] == null || args[1] == null)
      throw new Error('Could not compile `Cross`: missing argument');
    return `${linearAlgebraHelper('Cross', 'cross', 'complexCross', args)}(${collArg('Cross', args[0], compile, 1)}, ${collArg('Cross', args[1], compile, 2)})`;
  },
  // Norm accepts a scalar (absolute value) or a collection: 2-norm /
  // Frobenius by default, vector p-norm or matrix 1-/∞-operator norm with a
  // numeric second operand (`"Frobenius"` is the default; any other named
  // norm fails closed). The order 2 of a matrix is the spectral norm, which
  // `_SYS.norm` computes at run time, so the order can be a run-time value.
  Norm: (args, compile, target) => {
    if (args[0] == null)
      throw new Error('Could not compile `Norm`: missing argument');
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
    // fails closed and the interpreter answers.
    assertPointCoordinatesBroadcastable('Norm', args[0]);
    if (unwrittenPointMayBroadcast(args[0])) {
      if (
        args[1] != null &&
        isString(args[1]) &&
        args[1].string !== 'Frobenius'
      )
        throw new Error(
          `Could not compile \`Norm\`: the "${args[1].string}" norm has no compiled form.`
        );
      return broadcastPointNorm(
        compile(args[0]),
        unwrittenPointCoordinateKinds(args[0])!,
        target,
        args[1] != null && !isString(args[1]) ? compile(args[1]) : undefined
      );
    }
    // A `PointList` with a list component is a LIST of points (zipped to the
    // shortest source, as the interpreter zips it), not a point whose
    // components broadcast: it takes the list-of-points branch below, which
    // computes one norm per zipped point. `(A, B)` with `A`, `B` lists is
    // canonicalized to this form.
    if (
      pointHasBroadcastComponent(args[0]) &&
      !isFunction(args[0], 'PointList')
    ) {
      if (
        args[1] != null &&
        isString(args[1]) &&
        args[1].string !== 'Frobenius'
      )
        throw new Error(
          `Could not compile \`Norm\`: the "${args[1].string}" norm has no compiled form.`
        );
      const point = args[0];
      if (!isFunction(point, 'Tuple'))
        throw new Error(
          'Could not compile `Norm`: a point with a broadcasting component.'
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
            'Could not compile `Norm`: a point whose component is a collection ' +
              'of non-scalars.'
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
    //
    // The list is also read through its absence arms
    // (`isAbsentablePointListOperand`): a restricted list of points
    // `L {c}` is `undefined` when `c` is false, and `?.map` answers that
    // `undefined`, the run-time spelling of the interpreter's `Missing`. A
    // cell that is an absent or restricted point is `undefined` too, and
    // `_SYS.norm(undefined)` is `NaN`, the interpreter's answer for it.
    // Read as a matrix, such a list had its Frobenius norm taken: one wrong
    // scalar where the interpreter answers one norm per point.
    if (isPointListOperand(args[0]) || isAbsentablePointListOperand(args[0])) {
      let ord = '';
      if (args[1] != null) {
        if (isString(args[1])) {
          if (args[1].string !== 'Frobenius')
            throw new Error(
              `Could not compile \`Norm\`: the "${args[1].string}" norm has no compiled form.`
            );
        } else ord = `, ${compile(args[1])}`;
      }
      const read = absentRead(args[0]) === '' ? '.' : '?.';
      return `(${compile(args[0])})${read}map((_pt) => _SYS.norm(_pt${ord}))`;
    }
    if (args[1] != null) {
      if (isString(args[1])) {
        if (args[1].string === 'Frobenius')
          return `_SYS.norm(${compile(args[0])})`;
        throw new Error(
          `Could not compile \`Norm\`: the "${args[1].string}" norm has no compiled form.`
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
        `Could not compile \`Transpose\`: explicit axes do not compile.`
      );
    return `_SYS.transpose(${collArg('Transpose', args[0], compile)})`;
  },
  Determinant: (args, compile) =>
    `${linearAlgebraHelper('Determinant', 'det', 'complexDet', args)}(${collArg('Determinant', args[0], compile)})`,
  // A singular matrix yields NaN (the interpreter stays inert — no numeric
  // equivalent on a real target).
  Inverse: (args, compile) =>
    `${linearAlgebraHelper('Inverse', 'inv', 'complexInv', args)}(${collArg('Inverse', args[0], compile)})`,
  Trace: (args, compile) => {
    if (args.length > 1)
      throw new Error(
        `Could not compile \`Trace\`: explicit axes do not compile.`
      );
    return `${linearAlgebraHelper('Trace', 'trace', 'complexTrace', args)}(${collArg('Trace', args[0], compile)})`;
  },
  // Transpose + element-wise complex conjugate. Explicit axes do not compile.
  ConjugateTranspose: (args, compile) => {
    if (args.length > 1)
      throw new Error(
        `Could not compile \`ConjugateTranspose\`: explicit axes do not compile.`
      );
    return `_SYS.conjTranspose(${collArg('ConjugateTranspose', args[0], compile)})`;
  },
  // Rank-dispatched: matrix → main-diagonal vector; vector → diagonal matrix.
  // The offset/multi-argument forms do not compile.
  Diagonal: (args, compile) => {
    if (args.length > 1)
      throw new Error(
        `Could not compile \`Diagonal\`: the offset/banded form has no compiled form.`
      );
    return `_SYS.diagonal(${collArg('Diagonal', args[0], compile)})`;
  },
  // Integer matrix power (`M^0` identity, negative → inverse). A non-square
  // matrix yields NaN at run time; a non-integer exponent never reaches run
  // time (see the guard below).
  MatrixPower: (args, compile) => {
    if (args[0] == null || args[1] == null)
      throw new Error('Could not compile `MatrixPower`: missing argument');
    // `_SYS.matpow` computes integer powers only, but the interpreter also
    // answers a HALF-integer power of an exact 2×2 positive-semidefinite
    // matrix through the principal matrix square root
    // (`library/linear-algebra.ts`). Emitting `_SYS.matpow(m, 0.5)` there
    // would return NaN behind `success: true` — a silently wrong value, not
    // a missing one.
    //
    // So the lowering is emitted only when the exponent is STATICALLY
    // PROVEN an integer: a literal integer, or an operand whose type is
    // `integer`. Anything else fails closed and the engine falls back
    // to interpretation. Proving it on the literal alone is not enough — a
    // `real`-typed symbol holding 0.5 at run time reaches `_SYS.matpow` and
    // returns NaN for a case the interpreter answers.
    const exponentIsInteger =
      (isNumber(args[1]) && args[1].isInteger === true) ||
      args[1].type.matches('integer');
    if (!exponentIsInteger)
      throw new Error(
        'Could not compile `MatrixPower`: an exponent that is not statically an integer may be ' +
          'the principal matrix square root in the interpreter, which ' +
          '`_SYS.matpow` does not compute.'
      );
    // A literal exponent past the cap stays symbolic in the interpreter, so
    // it fails closed here; a run-time exponent past it answers NaN in
    // `_SYS.matpow`.
    const pConst = tryGetConstant(args[1]);
    if (pConst !== undefined && Math.abs(pConst) > MAX_MATRIX_POWER_EXPONENT)
      throw new Error(
        `Could not compile \`MatrixPower\`: an exponent past ${MAX_MATRIX_POWER_EXPONENT} stays ` +
          'symbolic in the interpreter.'
      );
    return `${linearAlgebraHelper('MatrixPower', 'matpow', 'complexMatpow', [args[0]])}(${collArg('MatrixPower', args[0], compile)}, ${compile(
      args[1]
    )})`;
  },
  // Reduced row echelon form (Gauss–Jordan).
  //
  // The interpreter computes no reduced row echelon form of a matrix with a
  // complex entry (it leaves `RowReduce` unevaluated), so there is no value
  // for the compiled code to match: an operand whose entries are complex, or
  // are complex under `mode: 'complex'`, fails closed. An operand whose
  // type does not say whether its entries are real (`matrix<number>`, an
  // undeclared matrix) is read as real in `strict` and `auto` mode, as the
  // other linear-algebra heads read it (`linearAlgebraOperandLane`).
  RowReduce: (args, compile) => {
    if (args[0] === undefined)
      throw new Error('Could not compile `RowReduce`: missing argument');
    const lane = BaseCompiler.linearAlgebraLane([args[0]]);
    if (lane === 'complex')
      throw new Error(
        'Could not compile `RowReduce`: the interpreter computes no reduced row echelon form of ' +
          'a matrix with a complex entry, so the compiled code has no value ' +
          'to match.'
      );
    return `_SYS.rref(${collArg('RowReduce', args[0], compile)})`;
  },
  // CE `Rank` is the TENSOR rank — the number of axes (scalar 0, vector 1,
  // matrix 2, …), NOT the linear-algebra (row) rank. It is the nesting depth of
  // the compiled value, so it lowers for any operand (a scalar gives 0).
  Rank: (args, compile) => {
    if (args[0] == null)
      throw new Error('Could not compile `Rank`: missing argument');
    return `(_SYS.shape(${compile(args[0])}).length)`;
  },
  Shape: (args, compile) => {
    if (args[0] == null)
      throw new Error('Could not compile `Shape`: missing argument');
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
    if (dims == null)
      throw new Error('Could not compile `Reshape`: missing shape');
    if (!isFunction(dims) || dims.ops.length === 0 || dims.ops.length > 2)
      throw new Error(
        `Could not compile \`Reshape\`: only a 1-D or 2-D target shape compiles.`
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
        return complexUnary(
          target,
          `_SYS.clog${base}`,
          complexOperandCode(args[0], compile)
        );
      // `ln(x) / ln(b)`, as a complex quotient: the base may itself be complex,
      // or real-but-negative (whose own `ln` is complex).
      const n = BaseCompiler.tempVar(target);
      const d = BaseCompiler.tempVar(target);
      const m = BaseCompiler.tempVar(target);
      // An operand that is itself a chain of complex operations joins this
      // block instead of nesting a closure in the `_SYS.cln` argument.
      const lifted = liftJSOperands(target, [
        complexOperandCode(args[0], compile),
        complexOperandCode(args[1], compile),
      ]);
      return boundJSResult(
        target,
        [
          lifted.prelude,
          `const ${n} = _SYS.cln(${lifted.values[0]});`,
          `const ${d} = _SYS.cln(${lifted.values[1]});`,
          `const ${m} = ${d}.re * ${d}.re + ${d}.im * ${d}.im;`,
        ]
          .filter((s) => s !== '')
          .join(' '),
        `{ re: (${n}.re * ${d}.re + ${n}.im * ${d}.im) / ${m}, im: (${n}.im * ${d}.re - ${n}.re * ${d}.im) / ${m} }`
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
  Max: (args, compile, target) => compileExtremum('Max', args, compile, target),
  Mean: (args, compile, target) => {
    if (args.length === 0) return 'NaN';
    refuseNestedData('Mean', args);
    if (args.length === 1) {
      // `_SYS.mean` is `sum / count` over the materialized elements; over a
      // positional gather (a range, a literal list of indices, or a `Join` of
      // those) the counted loop computes the same two numbers in the same
      // order without building the slice.
      const loop = emitRangeGatherReduction(
        args[0],
        target,
        '0',
        (acc, element) => `${acc} += ${element};`,
        (acc, count) => `${acc} / ${count}`
      );
      return loop ?? `_SYS.mean(${compile(args[0])})`;
    }
    return `_SYS.mean([${args.map(compile).join(', ')}])`;
  },
  Median: (args, compile) => {
    if (args.length === 0) return 'NaN';
    refuseNestedData('Median', args);
    if (args.length === 1) return `_SYS.median(${compile(args[0])})`;
    return `_SYS.median([${args.map(compile).join(', ')}])`;
  },
  Variance: (args, compile) => {
    if (args.length === 0) return 'NaN';
    refuseNestedData('Variance', args);
    if (args.length === 1) return `_SYS.variance(${compile(args[0])})`;
    return `_SYS.variance([${args.map(compile).join(', ')}])`;
  },
  PopulationVariance: (args, compile) => {
    if (args.length === 0) return 'NaN';
    refuseNestedData('PopulationVariance', args);
    if (args.length === 1)
      return `_SYS.populationVariance(${compile(args[0])})`;
    return `_SYS.populationVariance([${args
      .map((x) => compile(x))
      .join(', ')}])`;
  },
  StandardDeviation: (args, compile) => {
    if (args.length === 0) return 'NaN';
    refuseNestedData('StandardDeviation', args);
    if (args.length === 1) return `_SYS.standardDeviation(${compile(args[0])})`;
    return `_SYS.standardDeviation([${args
      .map((x) => compile(x))
      .join(', ')}])`;
  },
  PopulationStandardDeviation: (args, compile) => {
    if (args.length === 0) return 'NaN';
    refuseNestedData('PopulationStandardDeviation', args);
    if (args.length === 1)
      return `_SYS.populationStandardDeviation(${compile(args[0])})`;
    return `_SYS.populationStandardDeviation([${args
      .map((x) => compile(x))
      .join(', ')}])`;
  },
  Kurtosis: (args, compile) => {
    if (args.length === 0) return 'NaN';
    refuseNestedData('Kurtosis', args);
    if (args.length === 1) return `_SYS.kurtosis(${compile(args[0])})`;
    return `_SYS.kurtosis([${args.map(compile).join(', ')}])`;
  },
  Skewness: (args, compile) => {
    if (args.length === 0) return 'NaN';
    refuseNestedData('Skewness', args);
    if (args.length === 1) return `_SYS.skewness(${compile(args[0])})`;
    return `_SYS.skewness([${args.map(compile).join(', ')}])`;
  },
  Mode: (args, compile) => {
    if (args.length === 0) return 'NaN';
    refuseNestedData('Mode', args);
    if (args.length === 1) return `_SYS.mode(${compile(args[0])})`;
    return `_SYS.mode([${args.map(compile).join(', ')}])`;
  },
  Quartiles: (args, compile) => {
    if (args.length === 0) return 'NaN';
    refuseNestedData('Quartiles', args);
    if (args.length === 1) return `_SYS.quartiles(${compile(args[0])})`;
    return `_SYS.quartiles([${args.map(compile).join(', ')}])`;
  },
  InterquartileRange: (args, compile) => {
    if (args.length === 0) return 'NaN';
    refuseNestedData('InterquartileRange', args);
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
        'Could not compile `Covariance`: expected two collection arguments to compile'
      );
    return `_SYS.covariance(${compile(args[0])}, ${compile(args[1])})`;
  },
  PopulationCovariance: (args, compile) => {
    if (args.length !== 2)
      throw new Error(
        'Could not compile `PopulationCovariance`: expected two collection arguments to compile'
      );
    return `_SYS.populationCovariance(${compile(args[0])}, ${compile(args[1])})`;
  },
  Correlation: (args, compile) => {
    if (args.length !== 2)
      throw new Error(
        'Could not compile `Correlation`: expected two collection arguments to compile'
      );
    return `_SYS.correlation(${compile(args[0])}, ${compile(args[1])})`;
  },
  Min: (args, compile, target) => compileExtremum('Min', args, compile, target),
  Power: (args, compile, target) => {
    const base = args[0];
    const exp = args[1];
    if (base === null)
      throw new Error('Could not compile `Power`: no argument');
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
        // The base is bound through the statement sink, so a base that is
        // itself a complex operation adds its `const` temporaries to this
        // block rather than nesting a closure inside it (`jsBinding`).
        const stmts: string[] = [jsBinding(target, t, compile(base))];
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
        return boundJSResult(target, stmts.join(' '), result);
      }
      return spliceJSValues(
        target,
        [compile(base), compile(exp)],
        ([b, e]) => `_SYS.cpow(${b}, ${e})`
      );
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
    const realPower = BaseCompiler.realPowerExponent(args);
    if (realPower !== undefined) {
      const optimized = realRadicalPower(
        base,
        realPower.value,
        compile,
        target
      );
      if (optimized !== undefined) return optimized;
      const value = BaseCompiler.tempVar(target);
      const magnitude = `Math.pow(Math.abs(${value}), ${realPower.value})`;
      return boundJSResult(
        target,
        jsBinding(target, value, compile(base)),
        realPower.oddNumerator
          ? `(${value} < 0 ? -${magnitude} : ${magnitude})`
          : magnitude
      );
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
      return spliceJSValues(
        target,
        [complexOperandCode(base, compile), complexOperandCode(exp, compile)],
        ([b, e]) => `_SYS.cpow(${b}, ${e})`
      );
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
        `Could not compile \`Range\`: a non-finite bound (\`${args.find((a) => a != null && isNonFiniteBound(a))!.toString()}\`) does not materialize — an infinite ` +
          `range compiles only under \`Take\`/\`TakeWhile\`.`
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
          `Could not compile \`Range\`: the bound \`${a.toString()}\` is a \`${typeToString(t)}\`, not a number, so the range never materializes.`
        );
    }
    // A bound or step on the complex lane is read through its real part
    // (`compileRealOperand`), as the interpreter reads it: `Range(1, 5, 2+i)`
    // is `[1, 3, 5]`.
    const operand = (a: Expression): string => compileRealOperand(a, compile);
    if (args.length === 1) return `_SYS.range(1, ${operand(args[0])}, 1)`;

    let start = operand(args[0]);
    let stop = operand(args[1]);
    const step = args[2] ? operand(args[2]) : '1';
    if (start === null) throw new Error('Could not compile `Range`: no start');
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
        const len = rangeCount(fStart, fStop, dir);
        if (len < 50) {
          return `[${Array.from({ length: len }, (_, i) => fStart + dir * i).join(', ')}]`;
        }
        return `_SYS.range(${start}, ${stop}, ${dir})`;
      }

      // Symbolic bounds — the direction is resolved at runtime. The bounds
      // are the arguments of a small arrow function, so each is evaluated
      // once, and the arrow's parameters are `_a` and `_b`, never `_`: the
      // compiled function binds its argument object to `_`, and a symbolic
      // bound compiles to a member access like `_.a`.
      return `((_a, _b) => _SYS.range(_a, _b, _b >= _a ? 1 : -1))(${start}, ${stop})`;
    }
    // Every operand is passed as an ARGUMENT of the run-time helper
    // `_SYS.range` (`materializeRange`), which builds the elements in a
    // counted loop. The shape carries two guarantees:
    //
    // - No callback name can capture a user variable. The direct emission
    //   `Array.from({length: …}, (_e, i) => start + i * step)` spliced the
    //   compiled `start` and `step` INTO the callback, where the index `i`
    //   (or the element `_e`) shadowed a user variable of the same name: a
    //   `Map` over `i` whose body ranged over `Range(i + 1, n)` read the
    //   ARRAY INDEX instead of `i`, so every inner range started at
    //   index + 1 and `Count(Filter(...))` answered 0 where the interpreter
    //   answered 1 (issue #367). Here `start` and `step` are evaluated in
    //   the argument list, whatever they are named.
    // - An IMPURE operand (the Random family) is evaluated exactly once. In
    //   the direct emission `start` and `step` were each spliced twice, the
    //   second time inside the callback, so a spliced draw was re-drawn once
    //   per element, and the length was computed from a different value than
    //   the elements (`Range(Random(), 10, 2)` consumed a draw for the length
    //   and one more per element).
    //
    // The same shape also makes parentheses unnecessary: a step compiled as
    // the sum `_.d + -498` is passed whole (Tycho item 324 was the direct
    // emission reading it as `0 + i * _.d + -498`).
    //
    // The length is `rangeCount`, the interpreter's own count
    // (`numerics/range-count.ts`): 0 for a zero step or a step that points
    // away from the stop, and an end point on the step grid in exact
    // arithmetic is counted even when the float quotient falls one rounding
    // error short of it (`Range(0, 0.3, 0.1)` has 4 elements).
    return `_SYS.range(${start}, ${stop}, ${step})`;
  },
  Root: ([arg, exp], compile, target) => {
    if (arg === null) throw new Error('Could not compile `Root`: no argument');
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
    //
    // An even degree over an operand of merely UNKNOWN sign takes the same
    // lowering under a promoting discipline: `Math.pow(x, 0.25)` is `NaN`
    // for a negative `x` where the interpreter answers the principal complex
    // root. `promotesRadicalToComplex` is what the enclosing expression's
    // analysis asks, so this emission must ask the same question.
    // A COMPLEX radicand or degree takes `_SYS.croot`: the real lowerings
    // below (`Math.cbrt`, `Math.pow`) read a `{re, im}` object as NaN. The
    // node's type does not select this branch: `Root(x + iy, 3)` types
    // `number`, while the enclosing expression's analysis reads the operands
    // (`BaseCompiler.isComplexValued`) and expects `{re, im}` from this node.
    if (BaseCompiler.isComplexValued(arg) || BaseCompiler.isComplexValued(exp))
      return spliceJSValues(
        target,
        [compile(arg), compile(exp)],
        ([z, n]) => `_SYS.croot(${z}, ${n})`
      );
    if (
      resultIsComplexValued('Root', [arg, exp]) ||
      BaseCompiler.promotesRadicalToComplex('Root', [arg, exp])
    ) {
      // Both operands are compiled ONCE, here: the callback below is applied
      // again each time the statement sink renders this form.
      const radicand = complexOperandCode(arg, compile);
      const degree = compile(exp);
      return spliceJSValues(
        target,
        [radicand],
        ([z]) => `_SYS.cpow(${z}, (1 / (${degree})))`
      );
    }
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
        `Could not compile \`Random\`: expected at most one domain operand.`
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
  //
  // A STRING domain is segmented into its characters, drawn from and
  // re-joined: the draws are the source string's own characters, so the
  // result is a string (the string-preservation rule, ruled 2026-09-22 —
  // `docs/STRING_ROADMAP.md`). The domain descriptor is built here rather
  // than by `randomDomain`, whose `collArg` funnel is shared with `Random`
  // and refuses a string on purpose. Same shape as `RandomSample` below.
  RandomChoice: (args, compile) => {
    if (args.length !== 2)
      throw new Error(
        `Could not compile \`RandomChoice\`: expected exactly two arguments.`
      );
    if (args[0] !== undefined && isProvablyStringOperand(args[0]))
      return joinIfString(
        args[0],
        `_SYS.randomChoice(_SYS.domainList("RandomChoice", ` +
          `_SYS.chars(${compile(args[0])})), ${compileRealOperand(args[1], compile)})`
      );
    const domain = randomDomain('RandomChoice', args[0], compile, true);
    return `_SYS.randomChoice(${domain}, ${compileRealOperand(args[1], compile)})`;
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
        `Could not compile \`RandomSample\`: expected exactly two arguments.`
      );
    if (args[0] !== undefined && isProvablyStringOperand(args[0]))
      return joinIfString(
        args[0],
        `_SYS.randomSample(_SYS.domainList("RandomSample", ` +
          `_SYS.chars(${compile(args[0])})), ${compileRealOperand(args[1], compile)})`
      );
    const domain = randomDomain('RandomSample', args[0], compile, false);
    return `_SYS.randomSample(${domain}, ${compileRealOperand(args[1], compile)})`;
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
    if (arg === null)
      throw new Error('Could not compile `Square`: no argument');
    const c = tryGetConstant(arg);
    if (c !== undefined) return String(c * c);
    if (isSymbol(arg) && !target.varsKeys?.has(arg.symbol)) {
      const code = compile(arg);
      return `(${code} * ${code})`;
    }
    return `_SYS.pow2(${compile(arg)})`;
  },
  Sec: (args, compile, target) => {
    const arg = args[0];
    if (arg === null) throw new Error('Could not compile `Sec`: no argument');
    if (BaseCompiler.isComplexValued(arg))
      return complexUnary(target, '_SYS.csec', compile(arg));
    return `_SYS.sec(${compile(arg)})`;
  },
  Sech: (args, compile, target) => {
    const arg = args[0];
    if (arg === null) throw new Error('Could not compile `Sech`: no argument');
    if (BaseCompiler.isComplexValued(arg))
      return complexUnary(target, '_SYS.csech', compile(arg));
    return `1 / Math.cosh(${compile(arg)})`;
  },
  /** A string source is segmented first — see `First`. */
  Second: (args, compile) => compileNthElement(args[0], 1, compile),
  Heaviside: '_SYS.heaviside',
  // A complex operand takes the complex sign `z/|z|` (`_SYS.csign`), the
  // interpreter's reading off the real line; a real one keeps `Math.sign`.
  Sign: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return complexUnary(target, '_SYS.csign', compile(args[0]));
    return `Math.sign(${compile(args[0])})`;
  },
  Sinc: '_SYS.sinc',
  FresnelS: '_SYS.fresnelS',
  FresnelC: '_SYS.fresnelC',
  Sin: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return complexUnary(target, '_SYS.csin', compile(args[0]));
    return `Math.sin(${compile(args[0])})`;
  },
  Sinh: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return complexUnary(target, '_SYS.csinh', compile(args[0]));
    return `Math.sinh(${compile(args[0])})`;
  },
  Sqrt: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0])) {
      // The operand may be complex only by WIDENESS (the complex discipline
      // lifted it): that is a promotion for the `promoted` report, and the
      // predicate below records it (its lowering is the same kernel).
      BaseCompiler.recordPromotion('Sqrt', args);
      return complexUnary(target, '_SYS.csqrt', compile(args[0]));
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
      return complexUnary(
        target,
        '_SYS.csqrt',
        complexOperandCode(args[0], compile)
      );
    return `Math.sqrt(${compile(args[0])})`;
  },
  Tan: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return complexUnary(target, '_SYS.ctan', compile(args[0]));
    return `_SYS.tan(${compile(args[0])})`;
  },
  Tanh: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return complexUnary(target, '_SYS.ctanh', compile(args[0]));
    return `Math.tanh(${compile(args[0])})`;
  },
  /** A string source is segmented first — see `First`. */
  Third: (args, compile) => compileNthElement(args[0], 2, compile),
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
    if (a === null || b === null)
      throw new Error('Could not compile `Mod`: missing argument');
    // For non-negative integers, plain `%` is correct Euclidean modulo, and it
    // splices each operand once. Every other pair needs the floored modulo,
    // `_SYS.floorMod`. The DIVISOR must be non-negative too: for a negative
    // divisor the floored modulo takes the sign of the divisor, and `%` the
    // sign of the dividend (`Mod(7, -3)` is `-2`, `7 % -3` is `1`). A zero
    // divisor gives `NaN` on both.
    const fastPath =
      BaseCompiler.isIntegerValued(a) &&
      BaseCompiler.isIntegerValued(b) &&
      BaseCompiler.isNonNegative(a) &&
      BaseCompiler.isNonNegative(b);
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
    if (!fastPath && isNumber(b) && b.re === 1 && !b.isComplex) {
      const spliceableDividend =
        isNumber(a) || (isSymbol(a) && !target.varsKeys?.has(a.symbol));
      if (impure || !spliceableDividend) return `_SYS.fract(${compile(a)})`;
      const ca = compile(a);
      return `((${ca} - Math.floor(${ca})) % 1)`;
    }
    // Every other pair calls `_SYS.floorMod`, the function the interpreter
    // uses on doubles (`floorModDouble`). It adds the divisor to the
    // truncated remainder only when their signs differ. The inline template
    // `((a % b) + b) % b` always added it, and that sum is rounded when it is
    // larger than 2^53: `Mod(2, 2^53 - 1)` ran to `1`. A call evaluates each
    // operand once, in order, so an impure operand (the Random family) or a
    // computed divisor needs no temporary.
    if (!fastPath) return `_SYS.floorMod(${compile(a)}, ${compile(b)})`;
    // `compile()` emits sub-expressions without outer parentheses (`x + 29`),
    // and `%` binds tighter than `+` — wrap before splicing next to `%`.
    // An impure operand is bound to a temporary, so that the dividend and
    // the divisor are each evaluated once, in order.
    if (!impure) return `((${compile(a)}) % (${compile(b)}))`;
    const ta = BaseCompiler.tempVar(target);
    const tb = BaseCompiler.tempVar(target);
    return boundJSResult(
      target,
      `const ${ta} = ${compile(a)}, ${tb} = ${compile(b)};`,
      `(${ta} % ${tb})`
    );
  },
  Truncate: (args, compile, target) => {
    if (BaseCompiler.isIntegerValued(args[0]))
      return identityPassthrough(args[0], compile, target);
    return `Math.trunc(${compile(args[0])})`;
  },
  Remainder: ([a, b], compile, target) => {
    if (a === null || b === null)
      throw new Error('Could not compile `Remainder`: missing argument');
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
  Divide: ([a, b], compile, target) => {
    if (a === null || b === null)
      throw new Error('Could not compile `Divide`: missing argument');
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

    // Each operand is bound through the statement sink, so an operand that is
    // itself a complex operation adds its `const` temporaries to this block
    // rather than nesting a closure inside it (`jsBinding`).
    const ta = BaseCompiler.tempVar(target);
    const tb = BaseCompiler.tempVar(target);
    const bindings = `${jsBinding(target, ta, compile(a))} ${jsBinding(target, tb, compile(b))}`;
    // The quotient formula divides by the squared modulus `d` of the divisor,
    // and it is wrong where `d` is zero or infinite. A divisor that is exactly
    // zero makes both parts `0 / 0`: the formula answers `NaN + NaN·i` for
    // `1 / (0·i)`, where the interpreter answers the unsigned pole `~oo`,
    // whose absolute value is `+∞`. A divisor with an infinite part — `~oo`
    // itself, which the first case produces — makes both parts `∞ / ∞`, where
    // the interpreter answers `0`. And the squares of a very small or very
    // large FINITE divisor underflow (to zero, or to a subnormal number that
    // has lost precision) or overflow to `∞`, where the quotient is an
    // ordinary number. And the numerator parts of a very large dividend
    // overflow to `∞` (or become `NaN`) where the quotient is an ordinary
    // number: `(1e308 + 1e308·i) / (1 + i)` is `1e308`. The quotient is read
    // from `_SYS.cdivedge` in those cases, which scales the operands first.
    // `x - x !== 0` is true exactly when `x` is `±∞` or `NaN`. A numerator
    // part that is subnormal but not zero has lost digits, and a product of
    // two non-zero parts that underflowed (`_SYS.cprodok` is false) can leave
    // a numerator part reading as an exact `0`; both take the scaled route
    // too. This is the test `complexQuotient()` in
    // `numerics/numeric-complex.ts` makes, and the two must stay the same so
    // that the interpreter and the compiled code take the same branch for
    // the same operands. 2.2250738585072014e-308 is the smallest normal
    // double.
    if (ac && bc) {
      const d = BaseCompiler.tempVar(target);
      const nr = BaseCompiler.tempVar(target);
      const ni = BaseCompiler.tempVar(target);
      return boundJSResult(
        target,
        `${bindings} const ${d} = ${tb}.re * ${tb}.re + ${tb}.im * ${tb}.im; ` +
          `const ${nr} = ${ta}.re * ${tb}.re + ${ta}.im * ${tb}.im; ` +
          `const ${ni} = ${ta}.im * ${tb}.re - ${ta}.re * ${tb}.im;`,
        `(${d} < 2.2250738585072014e-308 || ${d} === Infinity || ${nr} - ${nr} !== 0 || ${ni} - ${ni} !== 0 || (${nr} !== 0 && Math.abs(${nr}) < 2.2250738585072014e-308) || (${ni} !== 0 && Math.abs(${ni}) < 2.2250738585072014e-308) || !_SYS.cprodok(${ta}.re, ${tb}.re) || !_SYS.cprodok(${ta}.im, ${tb}.im) || !_SYS.cprodok(${ta}.im, ${tb}.re) || !_SYS.cprodok(${ta}.re, ${tb}.im) ? _SYS.cdivedge(${ta}.re, ${ta}.im, ${tb}.re, ${tb}.im) : { re: ${nr} / ${d}, im: ${ni} / ${d} })`
      );
    }
    if (ac && !bc) {
      return boundJSResult(
        target,
        bindings,
        `{ re: ${ta}.re / ${tb}, im: ${ta}.im / ${tb} }`
      );
    }
    const d = BaseCompiler.tempVar(target);
    const nr = BaseCompiler.tempVar(target);
    const ni = BaseCompiler.tempVar(target);
    return boundJSResult(
      target,
      `${bindings} const ${d} = ${tb}.re * ${tb}.re + ${tb}.im * ${tb}.im; ` +
        `const ${nr} = ${ta} * ${tb}.re; const ${ni} = -${ta} * ${tb}.im;`,
      `(${d} < 2.2250738585072014e-308 || ${d} === Infinity || ${nr} - ${nr} !== 0 || ${ni} - ${ni} !== 0 || (${nr} !== 0 && Math.abs(${nr}) < 2.2250738585072014e-308) || (${ni} !== 0 && Math.abs(${ni}) < 2.2250738585072014e-308) || !_SYS.cprodok(${ta}, ${tb}.re) || !_SYS.cprodok(${ta}, ${tb}.im) ? _SYS.cdivedge(${ta}, 0, ${tb}.re, ${tb}.im) : { re: ${nr} / ${d}, im: ${ni} / ${d} })`
    );
  },
  Negate: ([x], compile, target) => {
    if (x === null) throw new Error('Could not compile `Negate`: no argument');
    if (!BaseCompiler.isComplexValued(x)) {
      const c = tryGetConstant(x);
      if (c !== undefined) return String(-c);
      return `(-(${compile(x)}))`;
    }
    return complexUnary(target, '_SYS.cneg', compile(x));
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

    // Each operand is bound through the statement sink, so an operand that is
    // itself a complex operation contributes its own `const` temporaries to
    // this block instead of a nested closure. Every name is a fresh temporary
    // for the same reason (`jsBinding`).
    const boundResult = (
      bindings: ReadonlyArray<readonly [name: string, code: string]>,
      value: string
    ): string =>
      boundJSResult(
        target,
        bindings.map(([n, c]) => jsBinding(target, n, c)).join(' '),
        value
      );

    if (args.length === 2) {
      const ac = BaseCompiler.isComplexValued(args[0]);
      const bc = BaseCompiler.isComplexValued(args[1]);
      const ca = compile(args[0]);
      const cb = compile(args[1]);

      // A complex factor whose value is known at compile time — the imaginary
      // unit, or a complex literal — scales the real operand by two CONSTANTS.
      // Multiplying by them at run time builds an object holding `0` and `1`
      // only to read the two fields back, so the constants are applied here:
      // `i · b` is `{ re: 0, im: b }`, not `{ re: 0 * b, im: 1 * b }`.
      // The real operand is spliced when the fold leaves it with EXACTLY one
      // use, and bound to a temporary otherwise — so it is evaluated once
      // whatever the two constants are, and an operand with an effect (a draw
      // of the `Random` family) is never dropped or repeated.
      //
      // At least one of the two constants is non-zero, so the fold never
      // discards the real operand the way a `0` factor would: this arm is
      // entered only when `BaseCompiler.isComplexValued` reports the factor
      // complex, and that predicate on a number literal IS `im !== 0` (the
      // imaginary unit answers with `im = 1`). A complex literal whose value
      // is exactly zero cannot reach here at all — the engine boxes
      // `Complex(0, 0)` as the real number `0`, which takes the real arm and
      // keeps `0 · x` a multiplication, so `0 · NaN` stays `NaN`.
      const literalScale = (
        literal: { re: number; im: number },
        real: Expression,
        code: string
      ): string => {
        const scale = (k: number, v: string): string =>
          k === 0 ? '0' : k === 1 ? v : `${k} * ${v}`;
        const uses = (literal.re !== 0 ? 1 : 0) + (literal.im !== 0 ? 1 : 0);
        if (uses === 1) {
          const v = isSymbol(real) || isNumber(real) ? code : `(${code})`;
          return `({ re: ${scale(literal.re, v)}, im: ${scale(literal.im, v)} })`;
        }
        const t = BaseCompiler.tempVar(target);
        return boundResult(
          [[t, code]],
          `{ re: ${scale(literal.re, t)}, im: ${scale(literal.im, t)} }`
        );
      };
      if (ac && !bc) {
        const literal = complexLiteralParts(args[0]);
        if (literal !== undefined) return literalScale(literal, args[1], cb);
      } else if (!ac && bc) {
        const literal = complexLiteralParts(args[1]);
        if (literal !== undefined) return literalScale(literal, args[0], ca);
      }

      const ta = BaseCompiler.tempVar(target);
      const tb = BaseCompiler.tempVar(target);
      if (ac && bc) {
        return boundResult(
          [
            [ta, ca],
            [tb, cb],
          ],
          `{ re: ${ta}.re * ${tb}.re - ${ta}.im * ${tb}.im, im: ${ta}.re * ${tb}.im + ${ta}.im * ${tb}.re }`
        );
      }
      if (ac && !bc) {
        return boundResult(
          [
            [ta, ca],
            [tb, cb],
          ],
          `{ re: ${ta}.re * ${tb}, im: ${ta}.im * ${tb} }`
        );
      }
      // !ac && bc
      return boundResult(
        [
          [ta, ca],
          [tb, cb],
        ],
        `{ re: ${ta} * ${tb}.re, im: ${ta} * ${tb}.im }`
      );
    }

    // 3+ operands: one block, sequential accumulation
    const bindings: Array<[name: string, code: string]> = [];
    const parts: string[] = [];
    const temps: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const t = BaseCompiler.tempVar(target);
      temps.push(t);
      bindings.push([t, compile(args[i])]);
    }
    const re = BaseCompiler.tempVar(target);
    const im = BaseCompiler.tempVar(target);

    // Accumulate with intermediate variables
    const firstIsComplex = BaseCompiler.isComplexValued(args[0]);
    parts.push(`let ${re} = ${firstIsComplex ? `${temps[0]}.re` : temps[0]};`);
    parts.push(`let ${im} = ${firstIsComplex ? `${temps[0]}.im` : '0'};`);

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
        parts.push(`${re} = ${re} * ${t};`);
        parts.push(`${im} = ${im} * ${t};`);
        continue;
      }
      const nre = BaseCompiler.tempVar(target);
      const nim = BaseCompiler.tempVar(target);
      parts.push(`const ${nre} = ${re} * ${t}.re - ${im} * ${t}.im;`);
      parts.push(`const ${nim} = ${re} * ${t}.im + ${im} * ${t}.re;`);
      parts.push(`${re} = ${nre};`);
      parts.push(`${im} = ${nim};`);
    }

    return boundJSResult(
      target,
      `${bindings.map(([n, c]) => jsBinding(target, n, c)).join(' ')} ${parts.join(' ')}`,
      `{ re: ${re}, im: ${im} }`
    );
  },

  // Factorial and double factorial
  Factorial: '_SYS.factorial',
  Factorial2: '_SYS.factorial2',

  // Additional logarithmic functions
  Exp2: ([x], compile) => {
    if (x === null) throw new Error('Could not compile `Exp2`: no argument');
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
  Hypot: (args, compile, target) => {
    // A leg whose coordinates may hold a list is one norm PER ELEMENT at
    // evaluation (`broadcastPointNorm`), so the hypotenuse then broadcasts
    // over its legs; a written point with a collection component still
    // declines, as `Norm` decides that shape per component and this handler
    // does not.
    let broadcasts = false;
    const leg = (a: Expression): string => {
      const t = jsType(a);
      const code = compile(a);
      assertPointCoordinatesBroadcastable('Hypot', a);
      if (unwrittenPointMayBroadcast(a)) {
        broadcasts = true;
        return broadcastPointNorm(
          code,
          unwrittenPointCoordinateKinds(a)!,
          target
        );
      }
      if (typeof t === 'string' || t.kind !== 'tuple') return code;
      if (pointHasBroadcastComponent(a))
        throw new Error(
          'Could not compile `Hypot`: a point with a broadcasting component.'
        );
      return `_SYS.norm(${code})`;
    };
    const legs = args.map(leg);
    if (!broadcasts) return `Math.hypot(${legs.join(', ')})`;
    const params = legs.map(() => BaseCompiler.tempVar(target));
    return `_SYS.bcast((${params.join(', ')}) => Math.hypot(${params.join(', ')}), ${legs.join(', ')})`;
  },
  // Degrees → radians. Only reached in radian mode: in the other angular
  // units `rewriteAngularUnit` replaces the `Degrees` node before codegen.
  Degrees: ([x], compile) => {
    if (x === null) throw new Error('Could not compile `Degrees`: no argument');
    return `(${compile(x)} * Math.PI / 180)`;
  },
  Haversine: ([x], compile, target) => {
    if (x === null)
      throw new Error('Could not compile `Haversine`: no argument');
    return BaseCompiler.inlineExpression(
      target,
      '(1 - Math.cos(${x})) / 2',
      compile(x)
    );
  },
  InverseHaversine: ([x], compile, target) => {
    if (x === null)
      throw new Error('Could not compile `InverseHaversine`: no argument');
    // Same complex discipline as the Arcsin family: hav⁻¹ = 2·arcsin(√z) is
    // complex outside [0, 1], and the node's TYPE (which the enclosing
    // expression's codegen reads) claims complex for an unconstrained real.
    if (BaseCompiler.isComplexValued(x))
      return complexUnary(target, '_SYS.cinvhav', compile(x));
    if (resultIsComplexValued('InverseHaversine', [x]))
      return complexUnary(
        target,
        '_SYS.cinvhav',
        complexOperandCode(x, compile)
      );
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
  // The two-argument form is Wolfram's generalized `Zeta[s, a]`: the Hurwitz
  // zeta for a > 0, but real |k + a|^(−s) terms and no pole for a ≤ 0, as the
  // interpreter's `evaluateGeneralizedZeta` computes it — so it lowers to
  // `_SYS.zetaGeneralized`, not to `_SYS.hurwitzZeta`. `_SYS.zeta` is the
  // one-argument Riemann ζ only. Both are real-only lowerings
  // (`JS_REAL_ONLY_LOWERINGS`).
  Zeta: (args, compile) => {
    if (args.length === 1) return `_SYS.zeta(${compile(args[0])})`;
    if (args.length === 2)
      return `_SYS.zetaGeneralized(${compile(args[0])}, ${compile(args[1])})`;
    throw new Error('Could not compile `Zeta`: it takes one or two operands');
  },
  // The three-operand form `HurwitzZeta(s, a, n)` is a derivative the
  // interpreter leaves symbolic, so it declines here.
  HurwitzZeta: (args, compile) => {
    if (args.length !== 2)
      throw new Error(
        'Could not compile `HurwitzZeta`: only the two-operand form `HurwitzZeta(s, a)` compiles'
      );
    return `_SYS.hurwitzZeta(${compile(args[0])}, ${compile(args[1])})`;
  },
  // Real-only (`JS_REAL_ONLY_LOWERINGS`): `_SYS.lerchPhi` (`lerchPhiReal`)
  // runs the interpreter's machine kernel, the continuation past |z| = 1
  // included, and is NaN wherever the value is genuinely complex (real
  // z > 1 is on the branch cut, a < 0 with a non-integer s) or the kernel
  // declines.
  LerchPhi: (args, compile) => {
    if (args.length !== 3)
      throw new Error(
        'Could not compile `LerchPhi`: it takes exactly three operands'
      );
    return `_SYS.lerchPhi(${compile(args[0])}, ${compile(args[1])}, ${compile(args[2])})`;
  },
  // Real-only (`JS_REAL_ONLY_LOWERINGS`): `_SYS.polyLog` is
  // `polylogOrderReal` (`numerics/polylog.ts`), which answers every order
  // the way the interpreter does (the closed forms and the dedicated
  // integer-order kernel first) and is NaN for a complex value or where
  // the interpreter's kernel declines.
  PolyLog: (args, compile) => {
    if (args.length !== 2)
      throw new Error(
        'Could not compile `PolyLog`: it takes exactly two operands'
      );
    return `_SYS.polyLog(${compile(args[0])}, ${compile(args[1])})`;
  },
  // Real-only (`JS_REAL_ONLY_LOWERINGS`): η and β on the machine kernels,
  // which sum the alternating series next to s = 1 as the interpreter does.
  DirichletEta: '_SYS.dirichletEta',
  DirichletBeta: '_SYS.dirichletBeta',
  // Real-only (`JS_REAL_ONLY_LOWERINGS`): `_SYS.stieltjesGamma` is the
  // interpreter's double kernel; NaN where the value is complex (a < 0, not
  // an integer) or the order is past `STIELTJES_MAX_ORDER`.
  StieltjesGamma: (args, compile) =>
    args.length === 1
      ? `_SYS.stieltjesGamma(${compile(args[0])})`
      : `_SYS.stieltjesGamma(${compile(args[0])}, ${compile(args[1])})`,
  // Real-only (`JS_REAL_ONLY_LOWERINGS`): `_SYS.clausen` is the interpreter's
  // double-precision kernel, NaN where it declines.
  ClausenCl: (args, compile) => {
    if (args.length !== 2)
      throw new Error(
        'Could not compile `ClausenCl`: it takes exactly two operands'
      );
    return `_SYS.clausen(${compile(args[0])}, ${compile(args[1])})`;
  },
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
      throw new Error('Could not compile `Mandelbrot`: missing arguments');
    return `_SYS.mandelbrot(${compile(c)}, ${compile(maxIter)})`;
  },
  Julia: ([z, c, maxIter], compile) => {
    if (z === null || c === null || maxIter === null)
      throw new Error('Could not compile `Julia`: missing arguments');
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
  //
  // Otherwise the value is read off the operand's own emission. That operand
  // is often a chain of complex operations, which the statement sink lays out
  // as `const` temporaries; `spliceJSValues` appends the read to those
  // statements so the chain is not wrapped in a closure just to read one
  // field of its result.
  Real: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0])) {
      const parts = tryGetJSComplexParts(args[0], compile);
      if (parts !== undefined) return parts.re;
      return spliceJSValues(
        target,
        [compile(args[0])],
        ([z]) => `${jsAtom(z)}.re`
      );
    }
    return identityPassthrough(args[0], compile, target);
  },
  Imaginary: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0])) {
      const parts = tryGetJSComplexParts(args[0], compile);
      if (parts !== undefined) return parts.im;
      return spliceJSValues(
        target,
        [compile(args[0])],
        ([z]) => `${jsAtom(z)}.im`
      );
    }
    return '0';
  },
  Argument: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0])) {
      // `_SYS.carg` is `Math.atan2(im, re)` — the argument order is
      // imaginary part first, as in every `atan2`.
      const parts = tryGetJSComplexParts(args[0], compile);
      if (parts !== undefined) return `Math.atan2(${parts.im}, ${parts.re})`;
      return complexUnary(target, '_SYS.carg', compile(args[0]));
    }
    return `(${compile(args[0])} >= 0 ? 0 : Math.PI)`;
  },
  Conjugate: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return complexUnary(target, '_SYS.cconj', compile(args[0]));
    return identityPassthrough(args[0], compile, target);
  },

  // Color functions
  Color: ([color], compile) => {
    if (color === null)
      throw new Error('Could not compile `Color`: no argument');
    return `_SYS.color(${compile(color)})`;
  },
  ColorToString: (args, compile) => {
    if (args.length === 0)
      throw new Error('Could not compile `ColorToString`: no argument');
    const c = compileColorOperand('ColorToString', args[0], compile);
    if (args.length >= 2)
      return `_SYS.colorToString(${c}, ${compile(args[1])})`;
    return `_SYS.colorToString(${c})`;
  },
  GamutMap: (args, compile) => {
    if (args.length === 0)
      throw new Error('Could not compile `GamutMap`: no argument');
    const c = compileColorOperand('GamutMap', args[0], compile);
    const gamut = args[1];
    if (gamut === undefined || gamut === null) return `_SYS.gamutMap(${c})`;
    // A literal gamut the interpreter does not know answers
    // `expected-value` there, so it fails closed here at compile time. A
    // gamut computed at run time is checked by `_SYS.gamutMap`, which throws.
    if (isString(gamut) && readColorGamut(gamut.string) === undefined)
      throw new Error(
        `Could not compile \`GamutMap\`: unknown gamut "${gamut.string}" — the gamut is "srgb" ` +
          `or "display-p3"`
      );
    return `_SYS.gamutMap(${c}, ${compile(gamut)})`;
  },
  ColorMix: (args, compile) => {
    if (args.length < 2)
      throw new Error('Could not compile `ColorMix`: need two colors');
    const c1 = compileColorOperand('ColorMix', args[0], compile);
    const c2 = compileColorOperand('ColorMix', args[1], compile);
    if (args.length >= 3)
      return `_SYS.colorMix(${c1}, ${c2}, ${compile(args[2])})`;
    return `_SYS.colorMix(${c1}, ${c2})`;
  },
  ColorContrast: ([bg, fg], compile) => {
    if (bg === null || fg === null)
      throw new Error('Could not compile `ColorContrast`: need two colors');
    return `_SYS.colorContrast(${compileColorOperand(
      'ColorContrast',
      bg,
      compile
    )}, ${compileColorOperand('ColorContrast', fg, compile)})`;
  },
  ContrastingColor: (args, compile) => {
    if (args.length === 0)
      throw new Error('Could not compile `ContrastingColor`: no argument');
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
      throw new Error(
        'Could not compile `ColorToColorspace`: need color and space'
      );
    return `_SYS.colorToColorspace(${compileColorEntryOperand(
      'ColorToColorspace',
      color,
      compile
    )}, ${compile(space)})`;
  },
  ColorFromColorspace: ([components, space], compile) => {
    if (components === null || space === null)
      throw new Error(
        'Could not compile `ColorFromColorspace`: need components and space'
      );
    return `_SYS.colorFromColorspace(${compileColorComponents(
      components,
      compile
    )}, ${compile(space)})`;
  },
  Colormap: (args, compile) => {
    if (args.length === 0)
      throw new Error('Could not compile `Colormap`: no argument');
    if (args.length >= 2) {
      // A literal sample count past the cap stays symbolic in the
      // interpreter, so it fails closed here; a run-time count past it
      // answers NaN in `_SYS.colormap`.
      const nConst = tryGetConstant(args[1]);
      if (nConst !== undefined && nConst > MAX_COLORMAP_SAMPLES)
        throw new Error(
          `Could not compile \`Colormap\`: a sample count past ${MAX_COLORMAP_SAMPLES} stays ` +
            'symbolic in the interpreter.'
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
    if (args.length < 3)
      throw new Error('Could not compile `Rgb`: need 3 components');
    return `_SYS.rgb(${args.map(compile).join(', ')})`;
  },
  Hsv: (args, compile) => {
    if (args.length < 3)
      throw new Error('Could not compile `Hsv`: need 3 components');
    return `_SYS.hsv(${args.map(compile).join(', ')})`;
  },
  Hsl: (args, compile) => {
    if (args.length < 3)
      throw new Error('Could not compile `Hsl`: need 3 components');
    return `_SYS.hsl(${args.map(compile).join(', ')})`;
  },
  Oklab: (args, compile) => {
    if (args.length < 3)
      throw new Error('Could not compile `Oklab`: need 3 components');
    return `_SYS.oklab(${args.map(compile).join(', ')})`;
  },
  Oklch: (args, compile) => {
    if (args.length < 3)
      throw new Error('Could not compile `Oklch`: need 3 components');
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
    if (c === null) throw new Error('Could not compile `AsRgb`: no argument');
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
    if (c === null) throw new Error('Could not compile `AsHsv`: no argument');
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
    if (c === null) throw new Error('Could not compile `AsHsl`: no argument');
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
    if (c === null) throw new Error('Could not compile `AsOklab`: no argument');
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
    if (c === null) throw new Error('Could not compile `AsOklch`: no argument');
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
      throw new Error('Could not compile `ColorDelta`: need two colors');
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
    if (a === null || b === null)
      throw new Error('Could not compile `Distance`: need two points');
    // The distance is a real number for real and complex coordinates alike,
    // so the lane decides only whether the coordinates may be `{re, im}`
    // objects: `_SYS.distanceAny` reads either representation, and a wide
    // coordinate type needs no decline.
    const helper =
      BaseCompiler.linearAlgebraLane([a, b]) === 'real'
        ? '_SYS.distance'
        : '_SYS.distanceAny';
    // An operand that may be absent as a whole (a restricted point or list of
    // points, `undefined` at run time when its condition is false) answers
    // the absence marker of the codomain, as the interpreter does: `NaN` for
    // the distance between two points, and `undefined`, the run-time
    // spelling of `Missing`, for the distances of a list of points. The
    // result is a list when EITHER operand is a list of points, including a
    // list that cannot be absent beside a restricted point, and a matrix or
    // a list of numeric lists, whose rows are the points
    // (`isDistancePointListOperand`).
    if (typeContainsMissing(a.type.type) || typeContainsMissing(b.type.type)) {
      const list = [a, b].some(isDistancePointListOperand);
      return (
        `((_a, _b) => (_a == null || _b == null) ? ${list ? 'undefined' : 'NaN'} : ` +
        `${helper}(_a, _b))(${compile(a)}, ${compile(b)})`
      );
    }
    return `${helper}(${compile(a)}, ${compile(b)})`;
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
        `Could not compile \`WithRandomSeed\`: expected exactly two arguments.`
      );
    return `_SYS.withRandomSeed(${compile(args[0])}, () => ${compile(args[1])})`;
  },
};

// `ApplyWhole` (engine-internal, `library/core.ts`) applies a function to
// arguments bound whole, which is what the `Apply` lowering emits: the call
// `(fn)(args)` binds each argument as given. The lazy `Map` of a declared
// `broadcastable<T>` map builds its per-element call with it.
JAVASCRIPT_FUNCTIONS.ApplyWhole = JAVASCRIPT_FUNCTIONS.Apply;

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
 * Compile an operand the lowering uses as a REAL number — a bound, a step, a
 * count or a position. When the compiler emits the operand on the complex
 * lane (a `{ re, im }` object, as for `\sqrt{K}` with `K` not provably
 * non-negative), the code reads its real part through `_SYS.realPart`: the
 * interpreter reads a complex bound, count or position the same way, with
 * the imaginary part ignored (`Take([10,20,30,40], 2+i)` is `[10, 20]`).
 * Without it the object reached `Math.round`, `rangeCount` or the element
 * arithmetic, which read it as NaN, and `Take(L, \sqrt{K})` at `K = 4` was
 * `[]`. A real operand compiles as it is.
 */
function compileRealOperand(
  a: Expression,
  compile: (expr: Expression) => string
): string {
  const code = compile(a);
  return BaseCompiler.isComplexValued(a) ? `_SYS.realPart(${code})` : code;
}

/**
 * The operand arrays (`Expression.ops`) of the `ReplaceAt` nodes that compile
 * to an in-place update. The `Reduce` lowering adds the outermost node of each
 * chain that `inPlaceUpdateChains` accepts, for the time it compiles the
 * step, and the `ReplaceAt` lowering, which receives that array as `args`,
 * tests it. The key is the node's own array, not the name of the
 * accumulator, so a `ReplaceAt` in another function whose parameter has the
 * same name keeps the copying form. If the compiler passes a different array,
 * the update keeps the copying form, which is slower but correct.
 */
const IN_PLACE_UPDATE_OPS = new WeakSet<ReadonlyArray<Expression>>();

/**
 * Compile a chain of `ReplaceAt` accepted by `inPlaceUpdateChains`, given the
 * operands of its outermost node, to one `_SYS.replaceAtInPlace` call. The
 * indexes and values are listed innermost first, which is the order the
 * interpreter applies them in.
 */
function compileInPlaceUpdateChain(
  args: ReadonlyArray<Expression>,
  compile: (expr: Expression) => string
): string {
  const updates: string[] = [];
  let node: ReadonlyArray<Expression> = args;
  for (;;) {
    updates.unshift(compile(node[1]), compile(node[2]));
    const inner = node[0];
    if (!isFunction(inner, 'ReplaceAt')) break;
    node = inner.ops;
  }
  return `_SYS.replaceAtInPlace(${compile(node[0])}, ${updates.join(', ')})`;
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
 * - analyzed as a collection whose ENTRIES are read on the real lane (a
 *   declared type with a collection member and no complex leaf, in `strict`
 *   or `auto` mode, or a type that proves every entry real, in any mode —
 *   `BaseCompiler.realLaneEntryCheck`): when the value is a plain `Array`,
 *   every entry is visited, through nested arrays, and a `{re, im}` entry
 *   THROWS a `TypeError` that names the binding and the entry. When the type
 *   proves every entry a number, any other entry that is not a number (a
 *   string, `null`) throws too, except `undefined`, an absent cell. The linear-algebra heads read a
 *   `matrix<number>` operand as real in these modes, and would otherwise
 *   give `NaN` or a wrong number for a complex entry;
 * - anything else (a string, a boolean, an array, `undefined`) is left to
 *   today's behavior.
 *
 * One `typeof` per checked binding per call, plus one per entry of each
 * collection whose entries are checked. The vars object is never mutated (a
 * lifted copy is built only when a lift or a typed-array copy is needed).
 */
type EntryPlan =
  | {
      kind: 'vars';
      real: string[];
      complex: string[];
      lists: string[];
      entries: Map<string, RealEntryCheck>;
    }
  | {
      kind: 'args';
      real: number[];
      complex: number[];
      lists: number[];
      entries: Map<number, RealEntryCheck>;
    };

/**
 * The entry check of one collection-valued binding read on the real lane,
 * keyed in `EntryPlan.entries` by the name of the free symbol or the index
 * of the parameter: `numbers` is whether every entry must be a number
 * (otherwise only a `{re, im}` entry is refused), and `label` the binding
 * and its declared type as the diagnostic shows them. Every key of
 * `entries` is also in `real`, `complex` or `lists`, and the check runs in
 * that loop, on the value it has read: the vars object is read once per
 * binding (a getter on it runs once).
 */
type RealEntryCheck = { numbers: boolean; depth: number; label: string };

/**
 * Run the entry check `check` of a binding on its value `x`, when `x` is a
 * plain array, and return the value the compiled code reads: `x` itself, or,
 * when an entry of `x` at any depth is a numeric typed array (a
 * `Float64Array` row of a matrix), a copy of `x` in which each such typed
 * array is replaced by a plain `Array`. The compiled code reads plain arrays
 * only: the `det` helper, for one, answers `NaN` for a typed-array row. A
 * top-level typed array is not an `Array` and is returned unchanged; the
 * list rule of `checkEntry` copies it.
 */
function checkBindingEntries(
  check: RealEntryCheck | undefined,
  x: unknown
): unknown {
  if (check === undefined || !Array.isArray(x)) return x;
  sawTypedArrayEntry = false;
  checkRealEntries(x, check.numbers, check.depth, check.label);
  return sawTypedArrayEntry ? copyNestedTypedArrays(x) : x;
}

/**
 * Set by `realEntryAdmitted` when it admits a numeric typed array as an
 * entry, and reset by `checkBindingEntries` before each walk. A flag, and
 * not a return value of the walk, so that the walk of an array of numbers
 * (the common case) does no extra work.
 */
let sawTypedArrayEntry = false;

/** A copy of the array `x` in which each numeric typed array, at any depth,
 * is a plain `Array`. A hole of `x` stays a hole. */
function copyNestedTypedArrays(x: unknown[]): unknown[] {
  return x.map((e) =>
    Array.isArray(e)
      ? copyNestedTypedArrays(e)
      : isNumericTypedArray(e)
        ? copyToPlainArray(e)
        : e
  );
}

/**
 * Throw when an entry of the array `x`, at any depth, is a `{re, im}` object
 * or, when `numbers` is set, anything that is not a number or `undefined`
 * (`realEntryAdmitted`). `label` names the binding. The walk goes into an
 * array at ANY depth and never refuses one: a declared type constrains what
 * the engine assigns, not what a caller supplies, and a caller may pass a
 * matrix where a point was declared (the compiled code then hands the value
 * to the run-time helper, which reads its rank; pinned in
 * `compile-static-point-components.test.ts`). `depth` is kept for the
 * diagnostic path only.
 *
 * The walk is split in two functions that call each other, one for the
 * arrays at an even depth and one for the arrays at an odd depth, so that
 * the element read of each function sees one kind of array in a vector or a
 * matrix: the outer array of a matrix holds arrays, and its rows hold
 * numbers. A single recursive function that read both kinds made the `det`
 * helper that ran next on the same matrix more than twice as slow (100×100:
 * 320 → 720 µs, measured 2026-09-24 on Node, reproducible in a separate
 * process), while this form leaves it at 320 µs and walks the matrix in
 * about 1.4 µs. The entry path of the diagnostic is found by a second walk
 * (`realEntryError`), only when the check fails.
 */
function checkRealEntries(
  x: unknown[],
  numbers: boolean,
  depth: number,
  label: string
): void {
  if (!realEntriesEven(x, numbers, depth))
    throw realEntryError(x, numbers, depth, label);
}

function realEntriesEven(
  x: unknown[],
  numbers: boolean,
  depth: number
): boolean {
  const n = x.length;
  for (let i = 0; i < n; i++) {
    const e = x[i];
    if (typeof e === 'number') continue;
    if (Array.isArray(e)) {
      if (!realEntriesOdd(e, numbers, depth - 1)) return false;
    } else if (!realEntryAdmitted(e, numbers)) return false;
  }
  return true;
}

function realEntriesOdd(
  x: unknown[],
  numbers: boolean,
  depth: number
): boolean {
  const n = x.length;
  for (let i = 0; i < n; i++) {
    const e = x[i];
    if (typeof e === 'number') continue;
    if (Array.isArray(e)) {
      if (!realEntriesEven(e, numbers, depth - 1)) return false;
    } else if (!realEntryAdmitted(e, numbers)) return false;
  }
  return true;
}

/** Whether an entry that is neither a number nor an array is admitted: never
 * a `{re, im}` object; `undefined` always, because an absent cell (a hole,
 * or a written `Missing`) is read by the lowerings that accept one (the
 * numeric selection fusion tests every cell for it); a typed array of
 * numbers at any depth, recorded in `sawTypedArrayEntry` so that the value
 * is copied to plain arrays; anything else only when `numbers` is not
 * set. */
function realEntryAdmitted(e: unknown, numbers: boolean): boolean {
  if (e === undefined) return true;
  if (isComplexObject(e)) return false;
  if (isNumericTypedArray(e)) {
    sawTypedArrayEntry = true;
    return true;
  }
  return !numbers;
}

/** The diagnostic of `checkRealEntries`: the first entry of `x` that is not
 * admitted, with its path (`[1][0]`). */
function realEntryError(
  x: unknown[],
  numbers: boolean,
  depth: number,
  label: string,
  path = ''
): TypeError {
  for (let i = 0; i < x.length; i++) {
    const e = x[i];
    if (typeof e === 'number') continue;
    const at = `${path}[${i}]`;
    if (Array.isArray(e)) {
      const error = realEntryError(e, numbers, depth - 1, label, at);
      if (error.message !== '') return error;
      continue;
    }
    if (isComplexObject(e))
      return new TypeError(
        `${label} was compiled with real entries, but its entry ${at} is a complex {re, im} value. Declare complex entries (for example \`matrix<complex>\` or \`list<complex>\`), or compile with \`mode: 'complex'\`.`
      );
    if (!realEntryAdmitted(e, numbers))
      return new TypeError(
        `${label} was compiled with number entries, but its entry ${at} is ${e === null ? 'null' : typeof e === 'object' ? 'an object' : `a ${typeof e}`}, not a number.`
      );
  }
  return new TypeError('');
}

function entryCheckError(binding: string): TypeError {
  return new TypeError(
    `${binding} was compiled as a real number but received a complex {re, im} value. Declare it complex, or compile with \`mode: 'complex'\`.`
  );
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
      const read = checkBindingEntries(plan.entries.get(id), x);
      if (read !== x) {
        lifted ??= { ...v };
        lifted[id] = read;
        continue;
      }
      if (!isComplexObject(x)) continue;
      if (!isUnsignedPole(x)) throw entryCheckError(`"${id}"`);
      lifted ??= { ...v };
      lifted[id] = Infinity;
    }
    for (const id of plan.complex) {
      const x = v[id];
      const read = checkBindingEntries(plan.entries.get(id), x);
      if (read !== x) {
        lifted ??= { ...v };
        lifted[id] = read;
      } else if (typeof x === 'number') {
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
      const read = checkBindingEntries(plan.entries.get(id), x);
      if (read !== x) {
        lifted ??= { ...v };
        lifted[id] = read;
        continue;
      }
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
    const read = checkBindingEntries(plan.entries.get(i), x);
    if (read !== x) {
      lifted ??= [...argumentsList];
      lifted[i] = read;
      continue;
    }
    if (!isComplexObject(x)) continue;
    if (!isUnsignedPole(x)) throw entryCheckError(`argument ${i + 1}`);
    lifted ??= [...argumentsList];
    lifted[i] = Infinity;
  }
  for (const i of plan.complex) {
    const x = argumentsList[i];
    const read = checkBindingEntries(plan.entries.get(i), x);
    if (read !== x) {
      lifted ??= [...argumentsList];
      lifted[i] = read;
    } else if (typeof x === 'number') {
      lifted ??= [...argumentsList];
      lifted[i] = { re: x, im: 0 };
    }
  }
  // The positional-parameter route applies the same list rule as the
  // free-symbol route above.
  for (const i of plan.lists) {
    const x = argumentsList[i];
    const read = checkBindingEntries(plan.entries.get(i), x);
    if (read !== x) {
      lifted ??= [...argumentsList];
      lifted[i] = read;
      continue;
    }
    if (!isNumericTypedArray(x)) continue;
    lifted ??= [...argumentsList];
    lifted[i] = copyToPlainArray(x);
  }
  return lifted ?? argumentsList;
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
  return BaseCompiler.identifierPattern(name, flags);
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
  for (let changed = true; changed;) {
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
      memoizedDefinition(name, entry, statements, [...varsReads.get(name)!])
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

/**
 * What the engine-bound helpers of `_SYS` read from `ce` each time they run:
 * the same helpers as a standalone runtime (`createJavaScriptRuntime`), over
 * the engine's own random frame, entropy handler, iteration limit and
 * deadline.
 */
function engineRuntimeSource(ce: ComputeEngine): RuntimeSource {
  return {
    random: () => ce._liveRandom(),
    draw: () => ce._random(),
    frame: () => ce._randomFrame,
    setFrame: (frame) => {
      ce._randomFrame = frame;
    },
    iterationLimit: () => ce.iterationLimit,
    deadline: () => ce._deadlineFrame,
  };
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
    this.SYS = makeSysHelpers(engineRuntimeSource(ce));
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
    this.SYS = makeSysHelpers(engineRuntimeSource(ce));
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
  /**
   * Set the nested-quadrature evaluation budget, or restore the default
   * (`NESTED_QUADRATURE_BUDGET`) when called with no argument. For tests only:
   * a test that the budget is enforced, shared and re-armed must use it up,
   * and with the default size that takes tens of seconds. The new value
   * applies from the next outermost integral, also in functions that were
   * compiled before the call.
   *
   * @internal
   */
  static setNestedQuadratureBudgetForTesting(evaluations?: number): void {
    setNestedQuadratureBudget(evaluations);
  }

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
      isRealOnlyLowering: jsIsRealOnlyLowering,
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
      // The operands that send an `Equal`/`NotEqual` to `_SYS.eq`/`_SYS.neq`,
      // whose answer is the absence marker when an element pair has none.
      // The SAME predicate the equality emitter gates on
      // (`compileJSEquality`), so the branch-decidedness analysis reads such a
      // condition off its value and every other one off its operands.
      collectionEqualityOperand: isCollectionEqualityOperandJS,
      // Absence capability (§3.F): numeric absence is `NaN`; the object axis is
      // `undefined`. Consumed by `IsMissing`/`Coalesce`/Kleene `Equal` (P3).
      //
      // The numeric test reads `undefined` as absent as well as `NaN`
      // (2026-09-22). Two kinds of absent read reach it: a WRITTEN absence
      // symbol, which lowers to the object null `undefined` so that an absent
      // list cell stays distinct from a `NaN` cell (see the absence-symbol
      // branch of `BaseCompiler._compileInner`), and a `vars` key the caller
      // left out, which reads `undefined` too. `Number.isNaN(undefined)` is
      // `false`, so the operand is coalesced to `NaN` before the test; the
      // operand is parenthesized because `??` may not be mixed with an
      // unparenthesized `&&`/`||` and it is spliced from arbitrary code.
      absence: {
        numeric: {
          make: () => 'Number.NaN',
          isAbsent: (x) => `Number.isNaN((${x}) ?? Number.NaN)`,
          coalesce: (x, d) =>
            `((_c) => Number.isNaN(_c ?? Number.NaN) ? ${d} : _c)(${x})`,
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
      // A `vars`-mapped symbol is compiled as the valueless input of its
      // declared type: its engine value is hidden for both attempts
      // (`withVarsValuesHidden`).
      return withVarsValuesHidden(expr, options.vars, () =>
        compileWithAutoEscalation(requestedMode, JS_SUPPORTED_MODES, (m) =>
          this.compileOrThrow(
            expr,
            m === requestedMode ? options : { ...options, mode: m }
          )
        )
      );
    } catch (e) {
      // By default a failure throws (the low-level contract). When the caller
      // opts in with `fallback: true`, surface the documented `success: false`
      // shape with an interpreter-backed `run` instead of throwing.
      // A cancellation that is not a timeout (an abort, an iteration or
      // recursion limit), or a timeout of an expired enclosing span, belongs
      // to the caller: it is thrown again, not changed into a fallback
      // (docs/TIMEOUT-MODEL.md §2).
      throwIfCallerCancellation(e, expr.engine._deadlineFrame);
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
    expr = unrollFixedWidthCollections(expr, {
      skipHeads: unrollSkipHeads,
      iterationBudget: options.iterationBudget,
      readsLiveSource: (name) => typeof options.vars?.[name] === 'string',
    });
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
        // count NaN so the loop returns its identity. Fail closed instead.
        // (A caller that genuinely pins a variable named `Nothing` in `vars` is
        // served by the lookup above, which runs first.)
        if (id === 'Nothing')
          throw new Error(
            'Could not compile `Nothing`: the erasure marker is not a value, so it cannot be read as a variable.'
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
 * The run-time entry check of a binding with the type `t`, or `undefined`
 * when the entries are not checked (`BaseCompiler.realLaneEntryCheck`).
 * `label` names the binding in the diagnostic.
 */
function realEntryCheckOf(
  t: Type,
  complexMode: boolean,
  label: string
): RealEntryCheck | undefined {
  const check = BaseCompiler.realLaneEntryCheck(t, complexMode);
  if (check === undefined) return undefined;
  const numbers = check === 'numbers';
  return {
    numbers,
    depth: numbers ? entryArrayDepth(t) : Infinity,
    label: `${label} (type \`${BaseCompiler.declaredTypeText(t)}\`)`,
  };
}

/**
 * The number of array levels below the top-level array of a value of type
 * `t`, when every entry type of `t` is at the same level: 0 for a
 * `vector<real>`, 1 for a `matrix<real>` or a `list<tuple<number, number>>`.
 * `Infinity` when the levels differ (`list<number | vector<number>>`), or
 * when the type does not fix them: a bare `list`, a self-referential alias,
 * or a list of scalars with no dimensions (`list<number>`,
 * `indexed_collection<real>`). The engine reads a list of numbers with no
 * dimensions as a tensor of any rank: `Norm` over a `list<number>` symbol
 * bound to a matrix is the matrix norm. The entry check then accepts any
 * depth.
 */
function entryArrayDepth(t: Type): number {
  const depths = new Set<number>();
  entryLeafDepths(t, 0, false, depths, undefined);
  return depths.size === 1 ? [...depths][0] : Infinity;
}

/** Add to `out` the depth of each entry type of `t`, where `level` is the
 * number of array levels above `t` (the walk of
 * `BaseCompiler.arrayEntryLeaves`) and `anyRank` is whether `t` is the
 * element type of a list with no dimensions: an entry there may be an
 * array of any depth. */
function entryLeafDepths(
  t: Type,
  level: number,
  anyRank: boolean,
  out: Set<number>,
  seen: AliasDescent
): void {
  const unfolded = unfoldAliasOnDescent(t, seen);
  if (unfolded === undefined) {
    out.add(Infinity);
    return;
  }
  const r = unfolded.type;
  seen = unfolded.seen;
  if (r === 'list' || r === 'tuple') {
    out.add(Infinity);
    return;
  }
  if (typeof r !== 'string') {
    if (r.kind === 'union') {
      for (const m of r.types) entryLeafDepths(m, level, anyRank, out, seen);
      return;
    }
    if (r.kind === 'tuple') {
      for (const e of r.elements)
        entryLeafDepths(e.type, level + 1, false, out, seen);
      return;
    }
    if (r.kind === 'list' || r.kind === 'indexed_collection') {
      const elt = collectionElementType(r);
      const open = r.kind !== 'list' || r.dimensions === undefined;
      entryLeafDepths(elt ?? 'unknown', level + 1, open, out, seen);
      return;
    }
  }
  if (level > 0) out.add(anyRank ? Infinity : level - 1);
}

/**
 * The D3 entry plan of the LAMBDA route: parameter `i` is list-shaped when its
 * annotation proves a JS array, complex-shaped when its annotation is a
 * non-real number type, real-shaped otherwise (an unannotated parameter is
 * wide, which the analysis shapes real).
 *
 * The entries of a collection-valued parameter are checked when the
 * parameter is read on the real lane (`realEntryCheckOf`). The type of this
 * check is the annotation when there is one, and otherwise the type the
 * engine inferred for the parameter from its uses in the body: in
 * `(M) ↦ det(M)` the parameter `M` is inferred `matrix`, and the body reads
 * it with the real `det` helper, so a `{re, im}` entry must throw here as it
 * does for `(M: matrix<real>) ↦ det(M)`, not give `NaN`. The inferred type
 * decides the entry check only: an unannotated parameter keeps the
 * real/complex shape rule above.
 */
function lambdaEntryPlan(
  literalParams: ReadonlyArray<Expression>,
  mode: CompileMode
): EntryPlan {
  const real: number[] = [];
  const complex: number[] = [];
  const lists: number[] = [];
  const entries = new Map<number, RealEntryCheck>();
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
    const checkType = t ?? (isSymbol(p) ? p.type.type : undefined);
    const check =
      checkType === undefined
        ? undefined
        : realEntryCheckOf(checkType, mode === 'complex', `argument ${i + 1}`);
    if (check !== undefined) entries.set(i, check);
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
  return { kind: 'args', real, complex, lists, entries };
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
  const entries = new Map<string, RealEntryCheck>();
  for (const id of refs) {
    const sym = engine.symbol(id);
    // A symbol whose declared type proves an array is classed as a list
    // instead of as a number: the real/complex rules read the value as a
    // scalar, which an array is not.
    const declared = sym.type?.type;
    const check =
      declared === undefined
        ? undefined
        : realEntryCheckOf(declared, mode === 'complex', `"${id}"`);
    if (check !== undefined) entries.set(id, check);
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
  return { kind: 'vars', real, complex, lists, entries };
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
    if (target.userFunctions) {
      BaseCompiler.pruneUnreferencedVariantBases(target.userFunctions, body);
      memoizeSharedDefinitions(
        target.userFunctions,
        body,
        params,
        false,
        javascriptStatements(target)
      );
    }
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
        `Could not compile a function literal whose body has unbound free ${
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
      runtimeVersion: RUNTIME_VERSION,
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
        runtimeVersion: RUNTIME_VERSION,
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
  if (target.userFunctions) {
    BaseCompiler.pruneUnreferencedVariantBases(target.userFunctions, js);
    memoizeSharedDefinitions(
      target.userFunctions,
      js,
      [],
      true,
      javascriptStatements(target)
    );
  }
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
    runtimeVersion: RUNTIME_VERSION,
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
      `Could not compile the \`${limitsExpr.operator}\` indexing set: a Sum/Product over a COLLECTION is not lowered to ` +
        `JavaScript — this emitter builds a counted loop from a \`Limits\` ` +
        `clause and has no bounds to read. The interpreter evaluates it instead.`
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
 * Fail closed on a Sum/Product bound that is statically non-finite, so
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
    `Could not compile \`${kind}\`: the ${which} bound \`${expr.toString()}\` is not a finite ` +
      `number — an infinite or NaN bound has no terminating loop.`
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
  if (!args[0]) throw new Error(`Could not compile \`${kind}\`: no body`);
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
    // A dictionary/string/statically-scalar operand fails closed, matching
    // `Length`/`At`/`Reduce`.
    if (isIndexedCollectionOperand(args[0])) {
      // Elements that are themselves collections (a list of points, the rows
      // of a matrix or of a list of lists) are combined element-wise, as the
      // interpreter combines them: `Sum([(1, 2), (3, 4)])` is `(4, 6)` and
      // `Sum([[1, 2], [3, 4]])` is `[4, 6]`. The scalar fold below adds with
      // `+` or with the number-or-complex combiner, which reads an array
      // operand as a number: the sum of a `list<tuple<real, real>>` compiled
      // to `{ re: NaN, im: NaN }`. The element-wise combiners of the guarded
      // fold (`_SYS.add`, `_SYS.mul`) are used instead.
      const elt = collectionElementType(
        resolveTypeForCompilation(jsType(args[0]))
      );
      const element =
        elt === undefined ? undefined : resolveTypeForCompilation(elt);
      // The same test `isComplexValued` reads for the shape of the value.
      if (
        element !== undefined &&
        BaseCompiler.foldsCollectionElements(args[0])
      ) {
        // The interpreter has no product between two points (its answer is
        // the error `no-product-between-points`), and `_SYS.mul` would
        // multiply the coordinates.
        if (
          kind === 'Product' &&
          (element === 'tuple' ||
            (typeof element !== 'string' && element.kind === 'tuple'))
        )
          throw new Error(
            'Could not compile `Product`: the elements are points, and there is no product between two points. ' +
              'The interpreter reports the error instead.'
          );
        requireShapedFold(kind, args[0]);
        return emitCollectionReduce(kind, args[0], target, true);
      }
      // An element typed as an abstract collection (`collection<real>`,
      // `set<integer>`) can be a list at run time, but no fold here reads
      // it as one: the scalar fold gave `NaN` for `[[1, 2], [3, 4]]`, where
      // the interpreter adds the rows element-wise.
      if (
        element !== undefined &&
        element !== 'never' &&
        !isSubtype(element, 'string') &&
        isSubtype(element, COLLECTION_SHAPE_TYPE)
      )
        throw new Error(
          `Could not compile \`${kind}\`: the elements are collections whose ` +
            `shape is not known (an abstract collection).`
        );
      // An element typed `broadcastable<T>` is a number or a list at run
      // time. The scalar fold read two list elements as numbers and gave
      // `NaN`, where the interpreter adds them element-wise: the guarded fold
      // dispatches on each element (`foldLane` is `wide` here). The type of
      // the fold is `broadcastable<T>` (`shapedSumType`), so a parent
      // dispatches on the run-time shape too.
      if (
        element !== undefined &&
        typeof element !== 'string' &&
        element.kind === 'broadcastable'
      )
        return emitCollectionReduce(kind, args[0], target, true);
      return emitCollectionReduce(kind, args[0], target, false);
    }
    if (isPossiblyCollectionTypedJS(args[0]))
      return emitCollectionReduce(kind, args[0], target, true);
    // A symbol typed as an abstract collection (declared or inferred): adding
    // or multiplying the elements needs no positions or order, so it is read
    // through `_SYS.elts`, which accepts an array or a JavaScript `Set` at run
    // time (`iterableCollectionCode`). The element type is not known to be
    // scalar, so the elements combine with `elementwiseFoldCombiner`, as in
    // the guarded fold of `emitCollectionReduce`.
    const elements = iterableCollectionCode(kind, args[0], (e) =>
      BaseCompiler.compile(e, target)
    );
    if (elements !== undefined) {
      requireShapedFold(kind, args[0]);
      return `(${elements}).reduce(${elementwiseFoldCombiner(kind, foldLane(args[0]))}, ${kind === 'Sum' ? '0' : '1'})`;
    }
    throw new Error(`Could not compile \`${kind}\`: no indexing set`);
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
  return `Math.round(${compileRealOperand(count, compile)})`;
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
  if (!isNumber(stop) || stop.isComplex) return undefined;
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
    throw new Error(
      'Could not compile the collection: it is not lazily compilable'
    );
  const op = expr.operator;
  if (op === 'Range') {
    const step = infiniteRangeStep(expr);
    if (step === undefined)
      throw new Error(
        'Could not compile `Range`: not a lazily-compilable infinite range'
      );
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
    return `_SYS.dropIter(${emitLazyStream(source, compile)}, ${compileRealOperand(expr.ops[1], compile)})`;
  if (op === 'Rest')
    return `_SYS.dropIter(${emitLazyStream(source, compile)}, 1)`;
  throw new Error(
    `Could not compile \`${op}\`: not a lazily-compilable infinite collection`
  );
}

/**
 * The `_SYS` helper of the linear-algebra head `head` over the collection
 * operands `operands`: `real`, which does real arithmetic only, when the
 * lane of the operands is real, and `complex`, which computes with complex
 * entries and returns `{re, im}` values, when it is complex. The lane is
 * `BaseCompiler.linearAlgebraLane`, which is also what a parent expression
 * reads the value of the head with (`BaseCompiler.isComplexValued`), so the
 * helper and its parent always agree on the representation of the value.
 *
 * An operand whose type admits real and complex entries (`matrix<number>`)
 * has the lane `'wide'` in `strict` and `auto` mode, and is read as real: the
 * real helper is emitted, and the compiled runner checks the entries of each
 * collection-valued binding when it is called (`realLaneEntryCheck`), so a
 * `{re, im}` entry throws instead of reading as NaN.
 */
function linearAlgebraHelper(
  _head: string,
  real: string,
  complex: string,
  operands: ReadonlyArray<Expression | undefined>
): string {
  const ops = operands.filter((a): a is Expression => a !== undefined);
  return BaseCompiler.linearAlgebraLane(ops) === 'complex'
    ? `_SYS.${complex}`
    : `_SYS.${real}`;
}

/**
 * Compile a collection operand, failing closed if it is not an indexed
 * collection (list/vector/range) — shared by the list-shaped collection
 * operators. `position` labels the operand in the error (e.g. for `Join`).
 */
function collArg(
  kind: string,
  arg: Expression | undefined,
  compile: (expr: Expression) => string,
  position?: number,
  target?: CompileTarget<Expression>
): string {
  if (!arg || !isIndexedCollectionOperand(arg, target)) {
    const checked = runtimeCheckedArrayCode(kind, arg, compile);
    if (checked !== undefined) return checked;
    throw new Error(
      `Could not compile \`${kind}\`: ${position !== undefined ? `operand ${position}` : 'operand'} ` +
        `is not an indexed collection (list/vector/range).`
    );
  }
  // A union with a text arm (`string | list<number>`) passes the test above —
  // a string IS an indexed collection in the type lattice — but may be a JS
  // string at run time, where `.slice()`/`.reverse()`/spread walk UTF-16 code
  // units instead of the grapheme clusters the interpreter walks. Proof of a
  // string is what `elementsArg` segments on, so this operand would reach the
  // array lowering unsegmented. Refused here (D6). See `couldBeStringOperand`.
  if (couldBeStringOperand(arg))
    throw new Error(
      `Could not compile \`${kind}\`: ${position !== undefined ? `operand ${position}` : 'operand'} ` +
        `may be text at run time (its type has a string arm), which the ` +
        `compiled list lowering would walk as UTF-16 code units rather than ` +
        `characters. The interpreter evaluates it instead.`
    );
  // An infinite pipeline cannot materialize to an array; only `Take`/
  // `TakeWhile` bound one (they lower it via `emitLazyStream` before ever
  // reaching this funnel). Everything else fails closed here — at compile
  // time, with the bounding fix named — instead of emitting
  // `Array.from({length: Infinity})` and throwing a RangeError at run time.
  if (isLazyStream(arg))
    throw new Error(
      `Could not compile \`${kind}\`: ${position !== undefined ? `operand ${position}` : 'operand'} ` +
        `is an infinite collection — bound it with \`Take\` or \`TakeWhile\` ` +
        `to compile.`
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
/**
 * Compile the search of `Contains`, `IndexOf` or `Element` for the searched
 * value `needle`. The search is STRUCTURAL, as in the interpreter: a marker is
 * found where the same marker sits (user decision 2026-09-26,
 * `SEARCHED_VALUE_POLICY` in `library/collections.ts`). A `NaN` needle is
 * found in a list that holds `NaN`, and a written `Missing`, which lowers to
 * `undefined`, is found where a written `Missing` sits. The element tests the
 * lowerings emit are SameValueZero: `includes`, and `_SYS.eqt` (see `eqText`),
 * so no run-time absence test is needed. `search(v)` emits the search for the
 * compiled value `v`.
 *
 * A needle that may be a COMPUTED NUMERIC absence — its type has a `missing`
 * arm beside a numeric arm, and it is not the written symbol — fails closed.
 * The interpreter keeps `Missing` apart from `NaN`, so
 * `IndexOf([1, NaN], Which(c, 1))` is `0` when no branch is selected; this
 * target spells an unselected numeric `Which` as `NaN`, and the compiled
 * search would find it at position 2. The written symbol keeps compiling: it
 * lowers to `undefined`, which is a different value from `NaN` here too. So
 * does a needle whose present arms are not numeric (`character | missing`, a
 * character read that may be out of range): its absence lowers to
 * `undefined`, never to `NaN`, so the element test stays faithful.
 * (`pySearchedValue` is the Python counterpart, which must also refuse the
 * written symbol.)
 *
 * The written symbol is refused in one case: when the COLLECTION's element
 * type has a `missing` arm. `Missing` and `Undefined` both lower to
 * `undefined` here, while the interpreter keeps them apart
 * (`IndexOf([1, Missing], Undefined)` is `0`, since `Unique([Missing,
 * Undefined])` keeps both), so a written symbol searched in a list that may
 * hold either one could be found where the other sits. Against a list whose
 * elements cannot be absent the written symbol is never found on either
 * route, and compiles.
 */
function compileSearchedValue(
  operator: string,
  needle: Expression,
  collection: Expression | undefined,
  compile: (expr: Expression) => string,
  search: (v: string) => string
): string {
  const t = resolveTypeForCompilation(needle.type.type);
  const written = isSymbol(needle, 'Missing') || isSymbol(needle, 'Undefined');
  if (
    !written &&
    typeContainsMissing(t) &&
    couldMatch(stripMissingFromType(t), 'number')
  )
    throw new Error(
      `Could not compile \`${operator}\`: the searched value may be a computed absence (\`Missing\`), ` +
        `which this target may spell as \`NaN\` and would then find where a \`NaN\` element sits. ` +
        `The interpreter evaluates it instead.`
    );
  if (written && collectionMayHoldAbsentCell(collection))
    throw new Error(
      `Could not compile \`${operator}\`: the searched value is \`${needle.toString()}\` and an element ` +
        `of the collection may be absent; this target spells \`Missing\` and \`Undefined\` alike, ` +
        `where the interpreter keeps them apart. The interpreter evaluates it instead.`
    );
  return search(compile(needle));
}

/** True when the element type of `collection` has a `missing` arm, so a cell
 * may be `Missing` or `Undefined` at run time. */
export function collectionMayHoldAbsentCell(
  collection: Expression | undefined
): boolean {
  if (collection === undefined) return false;
  const elt = collectionElementType(
    resolveTypeForCompilation(collection.type.type)
  );
  return elt !== undefined && typeContainsMissing(elt);
}

/**
 * Fail closed for `Any`/`All` when a predicate answer may be absent: the
 * collection's elements may be absent (an element type with a `missing` arm,
 * on which a comparison answers `Missing`), or the predicate's own result type
 * has a `missing` arm (`x ↦ If(x > 0, Missing, False)` over present
 * elements). The interpreter combines such answers by Kleene logic, so
 * `Any([1, Missing], x ↦ x > 2)` is `Missing` (user decision 2026-09-26,
 * `evaluateQuantifier` in `library/collections.ts`). The compiled predicate
 * has no third value: an absent element lowers to `undefined`, `undefined > 2`
 * is `false`, and `some`/`every` would answer a confident `false` where the
 * interpreter is undecided. A `NaN` element needs no refusal: it compares
 * `false` in both. `Filter`, `CountIf`, `Position`, `IndexWhere` and `Find`
 * need none either, since there "not decidedly true" is "not selected" on
 * both routes (`selectionVerdict`, `library/collections.ts`). Shared by the
 * JavaScript and Python targets.
 */
export function refuseKleeneQuantifier(
  operator: string,
  collection: Expression | undefined,
  predicate: Expression | undefined
): void {
  if (collectionMayHoldAbsentCell(collection))
    throw new Error(
      `Could not compile \`${operator}\`: an element of the collection may be absent (\`Missing\`), ` +
        `and the interpreter then answers \`Missing\` by Kleene logic, which the compiled ` +
        `\`some\`/\`every\` cannot. The interpreter evaluates it instead.`
    );
  if (predicate === undefined) return;
  const result = functionResult(resolveTypeForCompilation(predicate.type.type));
  if (result !== undefined && typeContainsMissing(result))
    throw new Error(
      `Could not compile \`${operator}\`: the predicate may answer \`Missing\`, which the interpreter ` +
        `combines by Kleene logic and the compiled \`some\`/\`every\` cannot. ` +
        `The interpreter evaluates it instead.`
    );
}

/**
 * The source of `Count`: as `elementsArg`, except that a symbol typed as an
 * abstract collection (declared or inferred) is read through `_SYS.elts`,
 * which accepts an array or a JavaScript `Set` at run time
 * (`iterableCollectionCode`). Counting needs no positions or order.
 */
function countSourceCode(
  arg: Expression | undefined,
  compile: (expr: Expression) => string,
  target: CompileTarget<Expression>
): string {
  if (
    arg !== undefined &&
    !isProvablyStringOperand(arg) &&
    !isIndexedCollectionOperand(arg, target)
  ) {
    const checked = iterableCollectionCode('Count', arg, compile);
    if (checked !== undefined) return checked;
  }
  return elementsArg('Count', arg, compile);
}

function elementsArg(
  kind: string,
  arg: Expression | undefined,
  compile: (expr: Expression) => string,
  position?: number,
  target?: CompileTarget<Expression>
): string {
  if (arg !== undefined && isProvablyStringOperand(arg))
    return `_SYS.chars(${compile(arg)})`;
  // Segmenting is gated on PROOF of a string, so an operand that merely MAY be
  // text (`string | list<number>`) is not segmented here — it would reach the
  // array lowering as a JS string. `collArg` refuses it (see
  // `couldBeStringOperand`), which is why this funnel needs no test of its own.
  return collArg(kind, arg, compile, position, target);
}

/**
 * The comparator of the compiled `Sort`/`Ordering`: ascending numeric order,
 * with NaN LAST. `x === x` is false only for NaN. Two NaN tie, and the native
 * sort is stable, so they keep their order in the input. The interpreter
 * gives the same order (`nanLastOrder` in `library/collections.ts`): NaN is
 * after every real number and after both infinities. The plain `a - b`
 * comparator that was used before answers NaN for every pair with a NaN, and
 * `Array.prototype.sort` reads that as a tie, so the result depended on the
 * position of the NaN in the input.
 */
const NAN_LAST_COMPARATOR =
  '(_a, _b) => _a === _a ? (_b === _b ? _a - _b : -1) : (_b === _b ? 1 : 0)';

/**
 * `NAN_LAST_COMPARATOR` with an absent cell (`undefined`, the run-time
 * spelling of `Missing`) after every other cell, `NaN` included, and two
 * absent cells tied (the sort is stable, so they keep their order). This is
 * the interpreter's order (user decision of 2026-09-25). Used by the compiled
 * `Ordering` when the element type has a `missing` arm; the compiled `Sort`
 * does not need it, because `Array.prototype.sort` already puts every
 * `undefined` element last.
 */
const ABSENT_LAST_COMPARATOR =
  '(_a, _b) => _a === undefined ? (_b === undefined ? 0 : 1) : _b === undefined ? -1 : _a === _a ? (_b === _b ? _a - _b : -1) : (_b === _b ? 1 : 0)';

/**
 * Fail closed when the elements of a `Sort`/`Ordering` source are not
 * provably numbers.
 *
 * The compiled comparator orders numbers only. The interpreter leaves a sort
 * of booleans, tuples, lists or symbols unevaluated, because it has no order
 * for them, while the comparator would coerce a boolean to 0 or 1 and read
 * every pair of arrays as a tie. So an element type that admits any value that
 * is not a number (`boolean`, `tuple<…>`, `list<…>`, `any`, `unknown`)
 * does not compile, and the two routes never give different answers.
 *
 * An absent cell (`Missing` or `Undefined`, typed `missing`) is allowed: the
 * interpreter sorts it after every other cell (user decision of 2026-09-25),
 * and at run time it is `undefined`, which the compiled sort puts last too.
 * So the test is on the element type less its `missing` arm. Returns `true`
 * when the element type has a `missing` arm, that is, when a cell can be
 * absent.
 */
function assertNumericSortElements(kind: string, arg: Expression): boolean {
  const declared = collectionElementType(arg.type.type);
  const absent = declared !== undefined && typeContainsMissing(declared);
  const elt = absent ? stripMissingFromType(declared) : declared;
  // A complex value has no order: the interpreter leaves such a sort
  // unevaluated, and the comparator would read a `{re, im}` pair as a tie.
  // A complex value that arrives at run time under a `number` element type
  // is caught by the entry check of the binding; a written complex element
  // (`Sort([3, 1 + 2i, 1])`) or a `complex` element type is refused here.
  // (`real` is a subtype of `complex` in this lattice, so the element type
  // is refused only when it is complex AND not real.)
  if (
    elt !== undefined &&
    ((isSubtype(elt, 'complex') && !isSubtype(elt, 'real')) ||
      (isFunction(arg, 'List') &&
        arg.ops.some((x) => BaseCompiler.isComplexValued(x))))
  )
    throw new Error(
      `Could not compile \`${kind}\`: an element is a complex value, which has no order; the ` +
        `interpreter leaves the sort unevaluated.`
    );
  if (elt !== undefined && (elt === 'never' || isSubtype(elt, 'number')))
    return absent;
  throw new Error(
    `Could not compile \`${kind}\`: the elements (type \`${declared === undefined ? 'unknown' : typeToString(declared)}\`) ` +
      `are not provably numbers; the compiled sort orders numbers only, ` +
      `and the interpreter leaves a sort of booleans, tuples or symbols ` +
      `unevaluated.`
  );
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
 * Compile a STRING operand of a string-specific operator, failing closed
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
      `Could not compile \`${operator}\`: the pattern must be a literal ` +
        `\`RegExp("...")\`.`
    );
  const flagText = re.nops >= 2 && isString(re.op2) ? re.op2.string : '';
  if (re.nops >= 2 && !isString(re.op2))
    throw new Error(
      `Could not compile \`${operator}\`: the flags must be a literal string.`
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
      `Could not compile \`${kind}\`: ${position} is not provably a string ` +
        `(type \`${arg === undefined ? 'missing' : arg.type.toString()}\`). The interpreter evaluates it instead.`
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
  if (x === undefined || !isNumber(x) || x.isComplex) return undefined;
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
      `Could not compile \`${kind}\`: ${rule}, and this operand is the literal ` +
        `\`${arg.toString()}\`, which the interpreter answers with an error ` +
        `value.`
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
      `Could not compile \`${kind}\`: ${rule}, and this operand is provably ` +
        `outside that domain, which the interpreter answers with an error ` +
        `value.`
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
      `Could not compile \`${kind}\`: ${rule}, and this operand is the empty ` +
        `string literal, which the interpreter answers with an error value.`
    );
  // Not spelled as a literal, but still provably empty — a symbol assigned
  // `""`, say. Same rule as `RangeOf`'s needle: a known-bad call should not
  // compile, while an operand whose emptiness is only known at run time gets
  // the guard below.
  if (arg.isEmptyCollection === true)
    throw new Error(
      `Could not compile \`${kind}\`: ${rule}, and this operand is provably ` +
        `empty, which the interpreter answers with an error value.`
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
      `Could not compile \`${kind}\`: expected \`${kind}(s, chars?)\`.`
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
          `Could not compile \`${kind}\`: \`chars\` must be a string or an indexed ` +
            `collection whose elements are provably strings or characters; ` +
            `the interpreter leaves the expression unevaluated on anything ` +
            `else. The interpreter evaluates it instead.`
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
      `Could not compile \`${kind}\`: expected \`${kind}(s, n, pad?)\`.`
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

  // The shim forwards exactly the lambda's own parameter count: the native
  // callbacks pass `(x, index, array)`, and the extra arguments must not
  // reach the lambda (the interpreter passes exactly the element). The count
  // is the number of parameter OPERANDS, which is not the number of names
  // they bind: a destructuring pattern is ONE parameter that binds a name per
  // leaf of the pattern, and a `_` leaf binds no name at all.
  return firstCallBoundLambda(
    lambda,
    callback.ops.length - 1,
    bindings,
    target
  );
}

/**
 * Wrap the compiled lambda `lambda` so that the loop-invariant `bindings`
 * its body reads are declared next to it and assigned on its FIRST call,
 * behind a flag. The shim forwards `arity` arguments to the held lambda.
 * `bindings` are in dependency order, as `hoistLoopInvariants` returns them:
 * a later right-hand side may read an earlier name. Shared by the callback
 * lowerings (`hoistedCallbackLambda`) and the quadrature lowering
 * (`compileIntegrate`), which spells its lambda itself.
 */
function firstCallBoundLambda(
  lambda: string,
  arity: number,
  bindings: ReadonlyArray<LoopInvariantBinding>,
  target: CompileTarget<Expression>
): string {
  const statements = javascriptStatements(target);
  const flag = BaseCompiler.tempVar(target);
  const held = BaseCompiler.tempVar(target);
  const args = Array.from({ length: arity }, () =>
    BaseCompiler.tempVar(target)
  );
  const declarations = `let ${flag} = false; let ${bindings
    .map(([name]) => name)
    .join(', ')}; `;
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
 * function), failing closed when a parameter annotation the emitted
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
  // A one-parameter literal fed the elements of a range whose start and step
  // are finite literals receives a finite number at every call. It needs no
  // broadcast wrapper, and its body needs no NaN test on its parameter.
  if (
    extraArgTypes.length === 0 &&
    target !== undefined &&
    isFunction(callback, 'Function') &&
    callback.nops === 2 &&
    isFiniteLiteralRange(source, target)
  )
    return BaseCompiler.withScalarFedLiteral(callback, 'finite', () =>
      hoistedCallbackLambda(callback, compile, target)
    );
  return hoistedCallbackLambda(callback!, compile, target);
}

/**
 * True when `source` is a `Range` whose every element is a finite number by
 * construction: its start and its step are finite real literals (a
 * one-operand range starts at 1, and a two-operand range steps by 1 or −1).
 * The upper bound does not matter: element `i` is `start + i × step` for
 * every count the bound gives, and a `NaN` bound gives no elements. The
 * same rule makes an emitted loop index a decided value
 * (`recordDecidedLoopIndex`). A source the caller maps to its own code
 * (`isCallerMapped`) is excluded, because the elements are then the caller's.
 */
function isFiniteLiteralRange(
  source: Expression | undefined,
  target: CompileTarget<Expression>
): boolean {
  if (!isFunction(source, 'Range')) return false;
  if (
    target.cse?.harvestOptions === undefined ||
    isCallerMapped(source, target.cse.harvestOptions)
  )
    return false;
  const finite = (x: Expression | undefined): boolean =>
    isNumber(x) && !x.isComplex && Number.isFinite(x.re);
  if (source.nops === 1) return true;
  if (!finite(source.ops[0])) return false;
  return source.nops === 2 || finite(source.ops[2]);
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
      `Could not compile \`${kind}\`: the operator symbol '${callback.symbol}' used as the ` +
        `mapping compiles to a two-argument function, and ${sources.length} ` +
        `collections supply ${sources.length} arguments per call. The interpreter evaluates it instead.`
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
      `Could not compile \`${op}\`: an unbounded Interval has no uniform draw.`
    );
  if (!(hi > lo))
    throw new Error(
      `Could not compile \`${op}\`: an empty Interval has no draw.`
    );
}

/** As `assertDrawableInterval`, for a `Range`'s normalized element count. */
function assertDrawableRange(op: string, n: number): void {
  if (!Number.isFinite(n) || n <= 0)
    throw new Error(
      `Could not compile \`${op}\`: expected a finite, non-empty Range.`
    );
}

/** A finite real literal operand, or `undefined`. */
function literalReal(x: Expression | undefined): number | undefined {
  if (x === undefined || !isNumber(x) || x.isComplex) return undefined;
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
  const n = rangeCount(first, upper, s);
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
    throw new Error(`Could not compile \`${op}\`: expected a domain operand.`);
  const name = JSON.stringify(op);

  if (isFunction(domain, 'Interval')) {
    if (!continuousOk)
      throw new Error(
        `Could not compile \`${op}\`: an Interval is not an indexed collection.`
      );
    if (domain.nops !== 2)
      throw new Error(
        `Could not compile \`${op}\`: expected Interval(lo, hi).`
      );
    const lo = compile(intervalEndpoint(domain.op1));
    const hi = compile(intervalEndpoint(domain.op2));
    return `_SYS.domainInterval(${name}, ${lo}, ${hi})`;
  }

  if (isFunction(domain, 'Range')) {
    const ops = domain.ops;
    if (ops.length === 0 || ops.length > 3)
      throw new Error(`Could not compile \`${op}\`: expected Range(…).`);
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
 * The combiner of a `Reduce`/`Scan` with a built-in `Add`/`Multiply` over
 * elements that are collections (the rows of a list of lists): the
 * element-wise one (`elementwiseFoldCombiner`), as for a `Sum`. The scalar
 * `(_a, _b) => _a + _b` that `builtinCombiner` gives joins two arrays as a
 * string: `Sum(acc)` in the step of a fold over a list of lists, which is
 * `Reduce(acc, Add, 0)`, answered `"01,23,4"` where the interpreter answers
 * `[4, 6]`. Only list rows are combined this way; `Min`/`Max` over rows, and
 * every built-in fold over points, strings, sets or dictionaries, fail
 * closed, as `Max` of a list of lists does (`refuseNestedData`). `undefined`
 * for every other combiner and element type, so `builtinCombiner` decides.
 */
function nestedElementCombiner(
  operator: string,
  coll: Expression,
  op: Expression
): string | undefined {
  if (!isSymbol(op)) return undefined;
  const elt = BaseCompiler.collectionElementTypeOf(coll);
  if (elt === undefined || !isDefinitelyCollectionType(elt)) return undefined;
  if (!['Add', 'Multiply', 'Min', 'Max'].includes(op.symbol)) return undefined;
  // Only list rows are combined element-wise. A point (a tuple) is not:
  // the compiled array would be read as a list by an enclosing operator, so
  // `Reduce(pts, Add) + 1` broadcast the 1 where the interpreter answers an
  // `incompatible-type` error. A string, a set or a dictionary has no
  // element-wise sum either; the interpreter answers an error.
  if (isSubtype(resolveTypeForCompilation(elt), 'list<any>')) {
    if (op.symbol === 'Add')
      return elementwiseFoldCombiner('Sum', foldLane(coll));
    if (op.symbol === 'Multiply')
      return elementwiseFoldCombiner('Product', foldLane(coll));
  }
  throw new Error(
    `Could not compile \`${operator}\`: a \`${op.symbol}\` fold over elements of type ` +
      `\`${typeToString(elt)}\` has no compiled form. The interpreter evaluates it instead.`
  );
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
          `Could not compile \`Min\`: a fold over complex values has no ordering.`
        );
      return '(_a, _b) => Math.min(_a, _b)';
    case 'Max':
      if (complexLane)
        throw new Error(
          `Could not compile \`Max\`: a fold over complex values has no ordering.`
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
    // A block-local function (`function add(a, x) { … }` in the compiled
    // block) is found through the compiler's registry, an engine definition
    // through the engine (`BaseCompiler.callbackLiteral`).
    const literal = BaseCompiler.callbackLiteral(op, target);
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
 * Fail closed unless the collection's elements compile to JS primitives
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
      // The extended reals: `Set` and `includes` use SameValueZero, under
      // which `Infinity`, `-Infinity` and `NaN` each equal themselves, as
      // they do for the interpreter's `isSame`. A host that declares
      // `list<real | signed_infinity | nan>` (a plot axis) was refused while
      // the wider `list<number>` was admitted.
      isSubtype(elt, 'real | signed_infinity | nan') ||
      isSubtype(elt, 'boolean') ||
      isSubtype(elt, 'string') ||
      // A character lowers to a one-cluster JS string, so it compares by
      // value with `===` exactly as a string does.
      isSubtype(elt, 'character'));
  if (primitive && !BaseCompiler.isComplexValued(arg)) return;
  throw new Error(
    `Could not compile \`${kind}\`: the interpreter compares elements ` +
      `structurally, but only real/boolean/string elements compare by ` +
      `value on the JavaScript target.`
  );
}

/**
 * Fail closed when the data of a statistics operator (`Mean`, `Median`,
 * `Variance`, `Max`, `Min`, …) is a list of lists: one operand whose
 * elements are collections, or several operands of which one is a
 * collection. The compiled helpers read each datum as a number and answered
 * `null`, `NaN` or a wrong list, while the interpreter answers an
 * `incompatible-type` error (`Mean([[1, 2], [3, 5]])`), the statistic of all
 * the elements of several list operands (`Mean([2, 3], [5, 7])` is 17/4), or,
 * for `Max` and `Min`, the extremum of all the elements
 * (`Max([[1, 2], [3, 5]])` is 5).
 * Refusing lets the interpreter answer. Only a type that is definitely a
 * collection is refused, so a wide or unknown element type compiles as
 * before.
 */
function refuseNestedData(
  operator: string,
  args: ReadonlyArray<Expression | undefined>,
  spreadsListOperands = false
): void {
  const isCollection = isDefinitelyCollectionType;
  const hasCollectionElements = (a: Expression | undefined): boolean =>
    a !== undefined && isCollection(collectionElementType(a.type.type));
  // With one operand, the data is its elements. With several, a lowering
  // that spreads each list operand into the data (`compileExtremum`, so
  // `Max(w, 5)` over a list `w` compiles) is refused only for an operand
  // whose elements are collections; the other statistics pass the operands
  // as one array, so any list operand would be read as a number.
  const nested =
    args.length === 1 || spreadsListOperands
      ? args.some(hasCollectionElements)
      : args.some((a) => isCollection(a?.type.type));
  if (nested)
    throw new Error(
      `Could not compile \`${operator}\`: an element of the data is a collection (a list, ` +
        `a string, a set or a dictionary), which the compiled code would read as a number. ` +
        `The interpreter evaluates it instead.`
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
  compile: (expr: Expression) => string,
  target: CompileTarget<Expression>
): string {
  refuseNestedData(kind, args, true);
  const fn = kind === 'Max' ? 'Math.max' : 'Math.min';
  const identity = kind === 'Max' ? '-Infinity' : 'Infinity';
  // Reduce with the identity seed, but map an empty input to `NaN` (interpreter
  // parity). The seed is safe for non-empty folds; `NaN` is not, so it is only
  // returned on the empty branch.
  const guardedReduce = (arrayCode: string): string =>
    `((_l) => _l.length === 0 ? NaN : _l.reduce((_a, _b) => ${fn}(_a, _b), ${identity}))(${arrayCode})`;
  if (args.length === 1 && args[0] && isIndexedCollectionOperand(args[0])) {
    // A positional gather walks its positions with a counted loop rather
    // than building the slice. A gather the loop takes always holds at least
    // one position, because `rangeGatherSource` declines a gather with no
    // position at all, so the empty-input branch above has no counterpart
    // there.
    const loop = emitRangeGatherReduction(
      args[0],
      target,
      identity,
      (acc, element) => `${acc} = ${fn}(${acc}, ${element});`
    );
    return loop ?? guardedReduce(compile(args[0]));
  }
  // An operand typed as an abstract collection (`collection`,
  // `collection<integer>`, a set) is not an indexed collection, and none of
  // the arms below reads it as one: the scalar arm compiled `Max(w)` to
  // `Math.max(w)`, which is `NaN` for an array behind `success: true` (issue
  // #385). `Max` and `Min` need neither positions nor order, so a symbol of
  // such a type is read through `_SYS.elts`, which accepts an array or a
  // JavaScript `Set` at run time and throws for any other value
  // (`iterableCollectionCode`). Any other operand that is a collection but
  // not an indexed one (a dictionary, an expression typed as a set) fails
  // closed, as in `GCD`.
  const checkedArray = args.map((a) =>
    iterableCollectionCode(kind, a, compile)
  );
  for (const [i, a] of args.entries()) {
    if (
      checkedArray[i] === undefined &&
      !isIndexedCollectionOperand(a) &&
      !couldBeIndexedCollectionOperand(a) &&
      (a.isCollection || a.type.matches('collection<any>'))
    )
      throw new Error(
        `Could not compile \`${kind}\`: operand is a collection but not an ` +
          `indexed collection (list/vector/range).`
      );
  }
  if (args.length === 1 && checkedArray[0] !== undefined)
    return guardedReduce(checkedArray[0]);
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
      (a, i) =>
        a &&
        (isIndexedCollectionOperand(a) ||
          couldBeIndexedCollectionOperand(a) ||
          checkedArray[i] !== undefined)
    )
  ) {
    const parts = args.map((a, i) => {
      if (isIndexedCollectionOperand(a)) return `...(${compile(a)})`;
      if (checkedArray[i] !== undefined) return `...(${checkedArray[i]})`;
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
 *     (dictionary / string / set) has no array lowering, so fail closed
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
  // The attempt evaluates through the engine, so a `vars`-mapped input or a
  // caller-overridden function reached through an assigned value or a
  // user-function body declines it too (`reachesExcludedName`).
  for (const op of ops)
    if (BaseCompiler.reachesExcludedName(op, target)) return false;
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
        `Could not compile \`${kind}\`: operand is a collection but not an indexed ` +
          `collection (list/vector/range).`
      );
    return compile(a);
  });
  return `((_a) => _a.length ? _a.reduce((_x, _y) => ${helper}(_x, _y)) : ${identity})([${parts.join(
    ', '
  )}])`;
}

/**
 * The most listed indices a positional gather may carry and still take the
 * counted-loop lowering (see `rangeGatherSource`); in the same order as the
 * common-subexpression binding cap, since both bound the size of the emitted
 * artifact.
 */
const GATHER_LISTED_INDEX_LIMIT = 32;

/**
 * One piece of a positional gather's index list: a `Range(lo, hi)` walked
 * with a counted loop, or the scalar indices of a literal `List`, read one by
 * one. `Join` concatenates pieces (`P[Join([m+n], (m+n+15)...(m+n+60))]`, the
 * pixel-art spelling of "this cell and the sixty after it").
 */
type GatherSegment =
  | { kind: 'range'; range: Expression; lo: Expression; hi: Expression }
  | { kind: 'points'; list: Expression; indices: ReadonlyArray<Expression> };

/**
 * The source and index segments of a positional gather — `P[a...b]`
 * (`At(P, Range(a, b))`), `P[[i, j]]` (`At(P, List(i, j))`), and a `Join` of
 * such pieces — when a reduction over it can be walked with a counted loop
 * instead of being materialized. `undefined` for every other operand.
 *
 * Three conditions make the loop reproduce the gather EXACTLY:
 *  - a range carries no explicit step, so its step is the auto-directed ±1
 *    and its k-th index is `lo + k` (ascending) or `lo − k` (descending);
 *  - every bound and every listed index is integer-typed, so every index the
 *    gather yields is an integer. That is what lets the loop read element by
 *    element: the interpreter refuses a gather whose index list holds a
 *    NON-integer for the whole read at once, which a per-element walk cannot
 *    reproduce;
 *  - the source is a provably indexed collection whose elements are numbers,
 *    which is what makes each read a numeric one. A string source is excluded
 *    — it is indexed by grapheme cluster and has to be segmented first — and
 *    so is a tuple, whose slots are positional rather than homogeneous cells.
 */
function rangeGatherSource(coll: Expression):
  | {
      base: Expression;
      index: Expression;
      segments: ReadonlyArray<GatherSegment>;
      elementType: Type;
    }
  | undefined {
  if (!isFunction(coll, 'At') || coll.ops.length !== 2) return undefined;
  const index = coll.ops[1];
  const segments = gatherSegments(index);
  if (segments === undefined) return undefined;
  // A listed index is unrolled — one temporary, one integer test and one
  // read each — so the emitted code grows with the list where the range
  // path does not. Past this many listed indices the materializing lowering
  // is the smaller artifact; the limit is about emitted-code size, not
  // correctness.
  if (
    segments.reduce(
      (n, seg) => n + (seg.kind === 'points' ? seg.indices.length : 0),
      0
    ) > GATHER_LISTED_INDEX_LIMIT
  )
    return undefined;
  // A gather with no position at all (`P[[]]`, or a `Join` of empty lists)
  // is left to the materializing lowering, whose extrema answer NaN for an
  // empty collection where the counted fold would answer its seed
  // (`-Infinity` for `Max`).
  if (!segments.some((seg) => seg.kind === 'range' || seg.indices.length > 0))
    return undefined;
  const base = coll.ops[0];
  if (
    !isIndexedCollectionOperand(base) ||
    isProvablyStringOperand(base) ||
    couldBeStringOperand(base)
  )
    return undefined;
  const elementType = collectionElementType(jsType(base));
  if (elementType === undefined) return undefined;
  if (
    !isSubtype(
      stripMissingFromType(resolveTypeForCompilation(elementType)),
      'number'
    )
  )
    return undefined;
  const baseType = resolveTypeForCompilation(jsType(base));
  if (typeof baseType !== 'string' && baseType.kind === 'tuple')
    return undefined;
  return { base, index, segments, elementType };
}

/**
 * The segments of a gather index (see {@link GatherSegment}), or `undefined`
 * when the index is not a `Range` without a step, a literal `List` of
 * integer-typed scalars, or a `Join` of those (or a `ListJoin`, the list
 * literal with a spread, `[...r1, ...r2]`). An empty `List` is a zero-length
 * segment; a `Join` with no admissible operand is not a gather.
 */
function gatherSegments(
  index: Expression
): ReadonlyArray<GatherSegment> | undefined {
  if (isFunction(index, 'Range') && index.ops.length === 2) {
    const [lo, hi] = index.ops;
    if (!BaseCompiler.isIntegerValued(lo) || !BaseCompiler.isIntegerValued(hi))
      return undefined;
    return [{ kind: 'range', range: index, lo, hi }];
  }
  if (isFunction(index, 'List')) {
    if (!index.ops.every((i) => BaseCompiler.isIntegerValued(i)))
      return undefined;
    // An empty list is kept as a zero-length segment rather than dropped:
    // the caller-mapping check of the emitter has to see every index
    // application, and a mapped `List` lowering may answer indices of its
    // own.
    return [{ kind: 'points', list: index, indices: index.ops }];
  }
  if (
    (isFunction(index, 'Join') || isFunction(index, 'ListJoin')) &&
    index.ops.length > 0
  ) {
    const out: GatherSegment[] = [];
    for (const op of index.ops) {
      const piece = gatherSegments(op);
      if (piece === undefined) return undefined;
      out.push(...piece);
    }
    return out;
  }
  return undefined;
}

/**
 * A reduction over a positional gather (see {@link rangeGatherSource}) — a
 * range, a literal list of indices, or a `Join` of those — as a counted walk,
 * or `undefined` when the operand is not that shape.
 *
 * Without it `total(P[a...b])` allocates the index list, then the gathered
 * slice, then folds the slice through a callback — three passes and two arrays
 * for a walk of `b − a + 1` cells. The loop reads each element straight from
 * the source with the same `_SYS.atNumeric` call the INDEXED form of the same
 * reduction emits (`Σ_{k=a}^{b} P[k]`), so nothing is allocated.
 *
 * The pieces are walked in the order the index lists them, and a range in ITS
 * OWN direction — `P[4...2]` reads elements 4, 3, 2 — because a
 * floating-point fold depends on the order of its terms.
 *
 * `fold` accumulates one element; omit it for a reduction that reads only the
 * element count. `result` turns the accumulator and the count into the
 * answer; it defaults to the accumulator itself.
 */
function emitRangeGatherReduction(
  coll: Expression,
  target: CompileTarget<Expression>,
  identity: string,
  fold: ((acc: string, element: string) => string) | undefined,
  result: (acc: string, count: string) => string = (acc) => acc
): string | undefined {
  // A source whose elements may be `{re, im}` objects is the complex fold's
  // business: this loop accumulates with real JavaScript arithmetic.
  if (!BaseCompiler.collectionFoldsReal(coll)) return undefined;
  const source = rangeGatherSource(coll);
  if (source === undefined) return undefined;

  // The loop reads the source array element by element, so neither the `At`
  // nor the index application (`Range`, `List`, `Join`) is ever emitted. A
  // caller that re-maps any of those names — through the `functions`/
  // `operators` options — supplies its own lowering, which is free to answer
  // something a positional walk cannot reproduce (an `At` mapping that
  // returns a fixed one-element list makes the gather one element long
  // whatever the bounds say). Such an operand goes to the materializing
  // lowering below, which builds the index list and the slice through every
  // operator handler.
  // The top-level index is checked as well as each piece: a `Join` node is
  // not itself a segment.
  const harvestOptions = target.cse?.harvestOptions;
  if (
    isCallerMapped(coll, harvestOptions) ||
    isCallerMapped(source.index, harvestOptions) ||
    source.segments.some((seg) =>
      isCallerMapped(
        seg.kind === 'range' ? seg.range : seg.list,
        harvestOptions
      )
    )
  )
    return undefined;

  const statements = javascriptStatements(target);
  const expression = (
    build: (exit: (value: string) => string) => string
  ): string =>
    statements?.expression(build) ??
    `(() => { ${build((v) => `return ${v};`)} })()`;

  const arr = BaseCompiler.tempVar(target);
  // A reduction that reads only the count declares neither of these.
  const acc = fold === undefined ? '' : BaseCompiler.tempVar(target);
  const turn = fold === undefined ? '' : BaseCompiler.tempVar(target);

  // The element read, exactly as the `At` handler emits it for a scalar
  // index: `_SYS.at` applies the 1-based, negative-from-the-end convention and
  // marks an out-of-band position with NaN, and the `atNumeric` wrapper adds
  // the run-time check that a base coming from OUTSIDE the kernel really does
  // hold numbers where its declared element type says so.
  const at = (idx: string): string =>
    source.base.unknowns.length > 0
      ? `_SYS.atNumeric(${arr}, ${idx}, ${JSON.stringify(typeToString(source.elementType))})`
      : `_SYS.at(${arr}, ${idx})`;

  // Compile every operand ONCE, before the statement sink is asked for a
  // body: `JavaScriptStatements.expression` runs the body it is given more
  // than once — once to register the source text, again whenever that text is
  // re-emitted at a statement position — and `BaseCompiler.compile` is not a
  // pure function of its argument. It mints temporaries and advances the
  // common-subexpression bookkeeping, so a second call on the same operand
  // would consume an occurrence for a body that is then discarded. The
  // callback below closes over the finished text instead. Every bound and
  // every listed index gets a temporary of its own, bound in the prologue.
  const baseCode = BaseCompiler.compile(source.base, target);
  type Bound = { name: string; code: string };
  const bound = (e: Expression): Bound => ({
    name: BaseCompiler.tempVar(target),
    code: BaseCompiler.compile(e, target),
  });
  const pieces = source.segments.map((seg) =>
    seg.kind === 'range'
      ? {
          kind: 'range' as const,
          lo: bound(seg.lo),
          hi: bound(seg.hi),
          step: BaseCompiler.tempVar(target),
          count: BaseCompiler.tempVar(target),
        }
      : { kind: 'points' as const, indices: seg.indices.map(bound) }
  );
  const bounds: Bound[] = pieces.flatMap((piece) =>
    piece.kind === 'range' ? [piece.lo, piece.hi] : piece.indices
  );

  // The run-time facts the loop rests on, tested once. A non-array source
  // has no elements to read (`_SYS.at`'s own rule), and a bound or a listed
  // index that is not an integer at run time — which the declared type does
  // not guarantee, since a caller's `vars` object is not type-checked — is a
  // gather the interpreter refuses outright, so both answer NaN for the whole
  // reduction rather than per element. The integer test also rejects `±∞` and
  // NaN, so every counted loop below terminates.
  // Two occurrences of one bound expression get a temporary each (a bound
  // is compiled once per occurrence, which is what the common-subexpression
  // accounting expects), but the integer test is a pure re-test of the same
  // value, so it runs once per distinct expression text.
  const seen = new Set<string>();
  const guard = [
    `!Array.isArray(${arr})`,
    ...bounds
      .filter((b) => !seen.has(b.code) && seen.add(b.code))
      .map((b) => `!Number.isInteger(${b.name})`),
  ].join(' || ');
  // The element count of the whole gather: each range contributes
  // `|hi − lo| + 1` (integer bounds and a ±1 step, so no clamp and no floor),
  // each listed index one. An empty list piece stays in `pieces` for the
  // caller-mapping check but adds nothing here. `rangeGatherSource` declines
  // a gather with no position, so at least one count remains. Parenthesized
  // when it is a sum, because `result` splices it into an expression of its
  // own (`acc / count` for `Mean`).
  const counts = pieces.flatMap((piece) =>
    piece.kind === 'range'
      ? [piece.count]
      : piece.indices.length === 0
        ? []
        : [String(piece.indices.length)]
  );
  const total = counts.length === 1 ? counts[0] : `(${counts.join(' + ')})`;

  return expression((exit) => {
    let prologue =
      `const ${arr} = ${baseCode}; ` +
      bounds.map((b) => `const ${b.name} = ${b.code}; `).join('') +
      `if (${guard}) ${exit('NaN')} `;
    for (const piece of pieces)
      if (piece.kind === 'range')
        prologue +=
          `const ${piece.step} = ${piece.hi.name} >= ${piece.lo.name} ? 1 : -1; ` +
          `const ${piece.count} = (${piece.hi.name} - ${piece.lo.name}) * ${piece.step} + 1; `;
    if (fold === undefined) return `${prologue}${exit(result('', total))}`;
    // NaN absorbs every fold this loop serves (`+`, `*`, `Math.max`,
    // `Math.min`), so once the accumulator is NaN no later element can change
    // the answer. The elements are reads of an array bound before the loop,
    // which have no observable effect, so stopping early is unobservable.
    const exitOnNaN = `if (${acc} !== ${acc}) ${exit('NaN')} `;
    let body = `${prologue}let ${acc} = ${identity}; `;
    for (const piece of pieces) {
      if (piece.kind === 'range')
        body +=
          `for (let ${turn} = 0; ${turn} < ${piece.count}; ${turn}++) { ` +
          `${fold(acc, at(`${piece.lo.name} + ${piece.step} * ${turn}`))} ` +
          `${exitOnNaN}} `;
      else
        for (const idx of piece.indices)
          body += `${fold(acc, at(idx.name))} ${exitOnNaN}`;
    }
    return `${body}${exit(result(acc, total))}`;
  });
}

/**
 * Fold a pure mapped collection in one traversal without its intermediate
 * array. Native reduce preserves the source's order and skips sparse holes,
 * as map followed by reduce does. Shared maps stay materialized so several
 * consumers do not repeat the callback's work.
 */
function emitMappedReduction(
  kind: 'Sum' | 'Product',
  coll: Expression,
  target: CompileTarget<Expression>
): string | undefined {
  if (
    !isFunction(coll, 'Map') ||
    coll.nops !== 2 ||
    isCallerMapped(coll, target.cse?.harvestOptions) ||
    BaseCompiler.hasSharedExpression(coll, target)
  )
    return undefined;
  const mapping = coll.ops[0];
  // Parameter annotations are syntax, not executable operator calls. Check a
  // literal's body with those names bound, rather than treating its Typed
  // parameter nodes as opaque computations.
  const pure = isFunction(mapping, 'Function')
    ? !isCallerMapped(mapping, target.cse?.harvestOptions) &&
      BaseCompiler.isEmissionSkippable([coll.ops[1]], [], target) &&
      BaseCompiler.isEmissionSkippable(
        [mapping.ops[0]],
        functionLiteralBoundNames(mapping.ops.slice(1)),
        target
      )
    : BaseCompiler.isEmissionSkippable([coll], [], target);
  if (!pure) return undefined;
  const element = BaseCompiler.collectionElementTypeOf(coll);
  if (element === undefined || !isSubtype(element, 'number')) return undefined;
  const compile = (expr: Expression): string =>
    BaseCompiler.compile(expr, target);
  const identity = kind === 'Sum' ? '0' : '1';
  const real = BaseCompiler.collectionFoldsReal(coll);
  // Over a finite range, fold each mapped element as the range is walked:
  // neither the range nor the mapped list is built (issue #387). The terms
  // are folded in the same order, with the same operation, as the `reduce`
  // below.
  if (isWalkableRange(coll.ops[1], target)) {
    const acc = BaseCompiler.tempVar(target);
    const walk = emitPredicateRangeWalk(
      'Map',
      coll.ops[1],
      coll.ops[0],
      compile,
      target,
      {
        init: `let ${acc} = ${identity};`,
        body: (_element, mapped) =>
          real
            ? `${acc} ${kind === 'Sum' ? '+' : '*'}= ${mapped};`
            : `${acc} = _SYS.${kind === 'Sum' ? 'sadd' : 'smul'}(${acc}, ${mapped});`,
        result: acc,
      }
    );
    return real ? walk : `_SYS.cplx(${walk})`;
  }
  const source = elementsArg('Map', coll.ops[1], compile);
  const callback = fnArg('Map', coll.ops[0], coll.ops[1], compile, [], target);
  const step = real
    ? `_a ${kind === 'Sum' ? '+' : '*'} _f(_x)`
    : `_SYS.${kind === 'Sum' ? 'sadd' : 'smul'}(_a, _f(_x))`;
  const result = `((_f) => (${source}).reduce((_a, _x) => ${step}, ${identity}))(${callback})`;
  return real ? result : `_SYS.cplx(${result})`;
}

/**
 * Whether `range` is a finite `Range` operand that a consumer may WALK in a
 * counted loop instead of materializing it with the `Range` handler
 * (`emitPredicateRangeWalk`). The test reads no code and compiles nothing, so
 * a caller may ask it before it commits to the loop: `BaseCompiler.compile`
 * mints temporaries and advances the common-subexpression accounting, so an
 * operand must be compiled once, by the emitter that uses the result.
 *
 * The loop declines, and the consumer keeps its array lowering, when:
 *
 * - the operand is not a `Range` of one to three operands;
 * - a bound is statically non-finite (`Range(1, +oo)`): the `Range` handler
 *   fails closed on it, so the whole consumer falls back to the interpreter,
 *   as before, while a loop over it would never end;
 * - a bound is provably not a number (a collection, a string): the `Range`
 *   handler fails closed on it too;
 * - the step is the literal `0`, which the `Range` handler refuses;
 * - the caller re-mapped `Range` through the `functions`/`operators` options:
 *   the caller's lowering is free to answer a different collection, and the
 *   loop would never emit it;
 * - the `Range` value is shared by common-subexpression elimination: it is
 *   materialized once for every consumer, and the loop would compute a
 *   second copy of it.
 */
function isWalkableRange(
  range: Expression | undefined,
  target: CompileTarget<Expression>
): range is Expression & FunctionInterface {
  if (range === undefined || !isFunction(range, 'Range')) return false;
  if (range.nops === 0 || range.nops > 3) return false;
  if (range.ops.some((a) => isNonFiniteBound(a))) return false;
  if (range.ops.some((a) => !couldMatch(compilationType(a), 'number')))
    return false;
  if (range.nops === 3 && tryGetConstant(range.ops[2]) === 0) return false;
  if (isCallerMapped(range, target.cse?.harvestOptions)) return false;
  if (BaseCompiler.hasSharedExpression(range, target)) return false;
  return true;
}

/**
 * Whether `filter` is `Filter(range, predicate)` over a range
 * {@link isWalkableRange} accepts, and the `Filter` node itself may be
 * bypassed: not re-mapped by the caller (a caller-supplied `Filter` lowering
 * must run) and not shared by common-subexpression elimination (a shared
 * filtered list is built once and read by every consumer).
 */
function isWalkableRangeFilter(
  filter: Expression | undefined,
  target: CompileTarget<Expression>
): filter is Expression & FunctionInterface {
  return (
    filter !== undefined &&
    isFunction(filter, 'Filter') &&
    filter.nops === 2 &&
    !isCallerMapped(filter, target.cse?.harvestOptions) &&
    !BaseCompiler.hasSharedExpression(filter, target) &&
    isWalkableRange(filter.ops[0], target)
  );
}

/**
 * What a consumer does with each element of a walked range
 * (`emitPredicateRangeWalk`). `exit` is the statement that answers the whole
 * expression early (`Any` answers `true` at the first selected element).
 */
type RangeWalkPlan = {
  /** Declarations before the loop: the accumulator, the output list. */
  init: string;
  /**
   * The statements run for one element. `element` names the element,
   * `selected` is the compiled predicate applied to it, as a JavaScript
   * expression. `callback` names the compiled predicate (or the callback
   * given as code), for a plan that calls it with other arguments.
   */
  body: (
    element: string,
    selected: string,
    exit: (value: string) => string,
    callback: string
  ) => string;
  /** The answer once the loop has walked every element. */
  result: string;
};

/**
 * Apply `predicate` to each element of a finite `Range` in a counted loop,
 * without materializing the range.
 *
 * `Count(Filter(1..n, p))` is the common shape of a combinatorics statistic:
 * count the `k` in `1..n` with some property. Its array lowering built the
 * whole range with `Array.from`, filtered it into a second array through the
 * predicate, and read the length: at `n = 10⁶` that ran in about 27 ms where
 * a loop that counts runs in under 2 ms (issue #373). The same walk serves
 * `Length(Filter(…))`, `Count(range, p)`, `CountIf`, `Any`, `All`, the
 * collection form of `Sum`/`Product` over a filtered range, and a bare
 * `Filter` over a range, which pushes the selected elements into one list
 * instead of building two.
 *
 * The values are the array lowering's, element for element:
 *
 * - the element count is `_SYS.rangeCount`, the interpreter's own count
 *   (`numerics/range-count.ts`), so an empty, reversed, zero-step or `NaN`
 *   bound answers exactly what the materialized range answered;
 * - element `i` is `start + i × step`, the `Range` handler's formula, and
 *   element 0 is `start` itself, so an infinite step gives `start` there
 *   and not `0 × ∞ = NaN`, as in the interpreter; a
 *   two-operand range resolves its direction at run time (`stop >= start ?
 *   1 : -1`), as the handler does, and `start + i × (−1)` is exactly
 *   `start − i` in floating point;
 * - the predicate is compiled by `fnArg`, exactly as the array lowering
 *   compiles it — same annotation checks, same loop-invariant hoist, same
 *   broadcast wrapper — and called with the element alone, as the array
 *   callbacks `(_x) => _f(_x)` called it;
 * - the operands are evaluated once each and in the array lowering's order:
 *   the predicate first (it was the argument of the outer arrow), then the
 *   start, the stop and the step (the arguments of the `Range` arrow).
 *
 * Every name the loop declares is a fresh temporary, so no compiled operand
 * can be captured by a loop variable (the `Range` handler's issue #367
 * lesson: a callback index named `i` shadowed a user's `i`). Where the target
 * has a statement sink the loop is emitted as statements, otherwise as an
 * immediately applied arrow. Every operand is compiled BEFORE the sink is
 * asked for the body, because the sink may run the body more than once
 * (`emitRangeGatherReduction` explains the constraint).
 */
function emitPredicateRangeWalk(
  kind: string,
  range: Expression,
  /**
   * The callback to call on each element: an expression that `fnArg`
   * compiles, or `{ code }`, a callback the caller has already compiled (the
   * combiner of a `Reduce`, which `fnArg` does not compile).
   */
  predicate: Expression | { code: string },
  compile: (expr: Expression) => string,
  target: CompileTarget<Expression>,
  plan: RangeWalkPlan
): string {
  // The callers test `isWalkableRange` first; this re-test only narrows the
  // type, since the answer of that test cannot be carried in a boolean.
  if (!isFunction(range, 'Range'))
    throw new Error(`Could not compile \`${kind}\`: expected a \`Range\`.`);
  const fn = isExpression(predicate)
    ? fnArg(kind, predicate, range, compile, [], target)
    : predicate.code;
  const operand = (a: Expression): string => compileRealOperand(a, compile);
  const bounds: string[] =
    range.nops === 1
      ? ['1', operand(range.ops[0])]
      : range.ops.map((a) => operand(a));
  const [start, stop] = bounds as [string, string];
  const step: string | undefined = range.nops === 3 ? bounds[2] : undefined;

  const f = BaseCompiler.tempVar(target);
  const a = BaseCompiler.tempVar(target);
  const b = BaseCompiler.tempVar(target);
  const s = BaseCompiler.tempVar(target);
  const n = BaseCompiler.tempVar(target);
  const i = BaseCompiler.tempVar(target);
  const x = BaseCompiler.tempVar(target);

  // A one-operand range (`Range(n)`) is `1..n`, step 1; a two-operand range
  // auto-descends when the stop is below the start, as the interpreter's
  // does (`Range(5, 1)` is `[5, 4, 3, 2, 1]`).
  const stepCode =
    step !== undefined
      ? step
      : range.nops === 1
        ? '1'
        : `${b} >= ${a} ? 1 : -1`;

  // A bound that is infinite at RUN time (`n = Infinity` handed to a
  // symbolic bound) gives an infinite count: `_SYS.rangeCount` answers
  // `Infinity` for a non-finite bound. The array lowering threw there, since
  // `Array.from` refuses a length above 2³² − 1, where this loop would never
  // return. The same limit, tested the same way, keeps that refusal; a `NaN`
  // count fails the test and walks nothing, as `Array.from` built nothing.
  const build = (exit: (value: string) => string): string =>
    `const ${f} = ${fn}; const ${a} = ${start}; const ${b} = ${stop}; ` +
    `const ${s} = ${stepCode}; const ${n} = _SYS.rangeCount(${a}, ${b}, ${s}); ` +
    `if (${n} > 4294967295) throw new RangeError('Range: the element count exceeds the array limit'); ` +
    (plan.init === '' ? '' : `${plan.init} `) +
    `for (let ${i} = 0; ${i} < ${n}; ${i}++) { ` +
    `const ${x} = ${i} === 0 ? ${a} : ${a} + ${i} * ${s}; ${plan.body(x, `${f}(${x})`, exit, f)} } ` +
    exit(plan.result);

  return (
    javascriptStatements(target)?.expression(build) ??
    `(() => { ${build((v) => `return ${v};`)} })()`
  );
}

/** The {@link RangeWalkPlan} that counts the selected elements. */
function countingWalkPlan(target: CompileTarget<Expression>): RangeWalkPlan {
  const count = BaseCompiler.tempVar(target);
  return {
    init: `let ${count} = 0;`,
    body: (_element, selected) => `if (${selected}) ${count}++;`,
    result: count,
  };
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
  if (!guarded) {
    const mapped = emitMappedReduction(kind, coll, target);
    if (mapped !== undefined) return mapped;
    // `Sum(Filter(1..n, p))` walks the range and folds the selected elements
    // as it goes, with neither the range nor the filtered list built. Only a
    // fold whose elements are provably real (`collectionFoldsReal`): this
    // loop accumulates with the raw JavaScript operator, and a source that
    // may hold a `{re, im}` takes the shape-agnostic fold below.
    if (
      isWalkableRangeFilter(coll, target) &&
      BaseCompiler.collectionFoldsReal(coll)
    ) {
      const acc = BaseCompiler.tempVar(target);
      const compile = (expr: Expression): string =>
        BaseCompiler.compile(expr, target);
      return emitPredicateRangeWalk(
        'Filter',
        coll.ops[0],
        coll.ops[1],
        compile,
        target,
        {
          init: `let ${acc} = ${kind === 'Sum' ? '0' : '1'};`,
          body: (element, selected) =>
            `if (${selected}) ${acc} ${kind === 'Sum' ? '+' : '*'}= ${element};`,
          result: acc,
        }
      );
    }
    // `total(P[a...b])`, `total(P[Join([i], a...b)])` and their `Product`
    // twins walk the gathered positions with a counted loop instead of
    // building the index list and the slice.
    const loop = emitRangeGatherReduction(
      coll,
      target,
      kind === 'Sum' ? '0' : '1',
      (acc, element) => `${acc} ${kind === 'Sum' ? '+' : '*'}= ${element};`
    );
    if (loop !== undefined) return loop;
  }
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
      const reduce = (read: string): string =>
        `(${read}).reduce((_a, _b) => _a ${op} _b, ${identity})`;
      // A NARROW collection whose width the type states is folded term by
      // term: the `reduce` closure and its per-element calls buy nothing when
      // the terms can be written out. The identity is kept as the first term,
      // so the grouping is the left fold's, down to the sign of a `-0` term.
      // The width bound is `MIN_UNROLLED_WIDTH`, the boundary the whole
      // fixed-width machinery uses: from five terms up the `reduce` fold is
      // both the shorter and the faster spelling.
      const width = BaseCompiler.staticCollectionWidth(coll);
      if (width !== undefined && width >= 1 && width < MIN_UNROLLED_WIDTH) {
        const terms = (read: string): string => {
          const parts = [identity];
          for (let k = 0; k < width; k++) parts.push(`${read}[${k}]`);
          return `(${parts.join(` ${op} `)})`;
        };
        // Constructors, helper bodies, and arithmetic can prove the emitted
        // width. Declared runtime inputs still need the fallback below.
        if (provenPointWidth(coll, target) === width)
          return BaseCompiler.withRepeatableSource(code, target, terms);
        // Every other source takes the width from its DECLARED type, which
        // constrains what the ENGINE may assign, not what a caller may put in
        // the kernel's `vars` object: a `list<real^3>` input can arrive
        // absent, shorter, longer, or as a plain number. Test the shape once
        // and hand every other shape to the `reduce` fold, which answers it
        // the way the same reduction over a width-less `list<real>` does.
        const source = BaseCompiler.tempVar(target);
        return (
          `((${source}) => Array.isArray(${source}) && ` +
          `${source}.length === ${width} ? ${terms(source)} : ` +
          `${reduce(source)})(${code})`
        );
      }
      return reduce(code);
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
  const identity = kind === 'Sum' ? '0' : '1';
  return `((_c) => Array.isArray(_c) ? _c.reduce(${elementwiseFoldCombiner(kind, foldLane(coll))}, ${identity}) : _c)(${code})`;
}

/**
 * Refuse a `Sum`/`Product` fold whose elements are collections
 * (`BaseCompiler.foldsCollectionElements`) when its static type is still a
 * number. The value of such a fold is a point, a row or a matrix, and a
 * parent compiled from the type `number` reads it as one number (a raw `+`
 * over an array gives a string). The type gives a shape for lists and
 * abstract collections of points, rows and matrices (`shapedSumType`,
 * `shapedProductType` in `library/type-handlers.ts`); it stays `number`
 * for `Product` of matrices known not to be square, which the interpreter
 * leaves unevaluated.
 */
function requireShapedFold(kind: 'Sum' | 'Product', coll: Expression): void {
  if (!BaseCompiler.foldsCollectionElements(coll)) return;
  const type = coll.engine.function(kind, [coll]).type;
  if (type.matches('number'))
    throw new Error(
      `Could not compile \`${kind}\`: the elements are collections, but the ` +
        `shape of the result is not known.`
    );
}

/**
 * The lane of the element-wise `Sum`/`Product` fold over `coll`. When its
 * elements are collections (`BaseCompiler.foldsCollectionElements`), the
 * lane is complex exactly when `BaseCompiler.linearAlgebraLane` says so, and
 * real otherwise: a `number` entry (the `wide` lane) is read as real, as it
 * is by `Dot` and by every other wide binding, and `isComplexValued` reads
 * the fold the same way, so the parent reads the value with the shape the
 * fold gives it. When the elements are not known to be collections (an
 * operand whose shape is known only at run time, or an abstract
 * collection), the fold is the dispatching form `wide`, whose entries are
 * numbers or `{re, im}` as the run-time values are.
 */
function foldLane(coll: Expression): 'real' | 'complex' | 'wide' {
  if (!BaseCompiler.foldsCollectionElements(coll)) return 'wide';
  return BaseCompiler.linearAlgebraLane([coll]) === 'complex'
    ? 'complex'
    : 'real';
}

/**
 * The combiner of a `Sum`/`Product` fold whose elements may be numbers,
 * complex values `{re, im}`, or arrays (points, rows, matrices). Two arrays
 * combine element-wise (`Sum`) or by the tensor product (`Product`), with
 * the form of the helper chosen by the lane (`foldLane`): the real-only
 * `_SYS.add`/`_SYS.mul` for a real lane, the complex `_SYS.cadd`/`_SYS.cmul`
 * (every entry `{re, im}`) for a complex lane, and the dispatching
 * `_SYS.addAny`/`_SYS.mulAny` otherwise. The choice is made when the code
 * is compiled, as for the other linear-algebra helpers. Two values that are
 * not arrays combine with `_SYS.sadd`/`_SYS.smul`, which add and multiply a
 * complex value as complex: the sum of `[1+2i, 3+4i]` was the string
 * `"0[object Object][object Object]"`.
 */
function elementwiseFoldCombiner(
  kind: 'Sum' | 'Product',
  // The dispatching form is the default: it is correct for any entries, and
  // a caller that knows the operand passes `foldLane(coll)` for the faster
  // real-only form.
  lane: 'real' | 'complex' | 'wide' = 'wide'
): string {
  const tensor =
    kind === 'Sum'
      ? { real: '_SYS.add', complex: '_SYS.cadd', wide: '_SYS.addAny' }[lane]
      : { real: '_SYS.mul', complex: '_SYS.cmul', wide: '_SYS.mulAny' }[lane];
  const scalar = kind === 'Sum' ? '_SYS.sadd' : '_SYS.smul';
  return `(_a, _b) => Array.isArray(_a) || Array.isArray(_b) ? ${tensor}(_a, _b) : ${scalar}(_a, _b)`;
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
 * A non-negative loop index can keep radicals and logarithms real even when
 * the upper bound is supplied at runtime. Adopt that fact only when the whole
 * body becomes real; otherwise its complex accumulator still needs complex
 * terms. A body with effects could change the counter, invalidating the bound.
 */
function realLoopClauseLane(
  body: Expression,
  index: string,
  lower: number | undefined,
  target: CompileTarget<Expression>
): false | undefined {
  if (
    BaseCompiler.oracleFoldTarget === undefined ||
    lower === undefined ||
    lower < 0 ||
    !Number.isSafeInteger(lower) ||
    !BaseCompiler.isEmissionSkippable([body], [index], target) ||
    !BaseCompiler.isComplexValuedUnderIndices(body, [index])
  )
    return undefined;
  return BaseCompiler.withLoopIndexLowerBound(index, lower, () =>
    BaseCompiler.isComplexValuedUnderIndices(body, [index]) ? undefined : false
  );
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
  if (
    lowerNum === undefined ||
    upperNum === undefined ||
    upperNum - lowerNum + 1 > UNROLL_LIMIT ||
    (target.iterationBudget !== undefined &&
      !(upperNum - lowerNum < target.iterationBudget))
  )
    return realLoopClauseLane(expr.ops[0], index, lowerNum, target);
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
        termCount > 1 && rest.length === 0
          ? BaseCompiler.hoistLoopInvariants(body, [index], target, emitTerms)
          : { bindings: [], result: emitTerms() };

      const hoisted = bindings
        .map(([name, code]) => `const ${name} = ${code}; `)
        .join('');

      if (!unrolledIsComplex) {
        if (!asStatements) {
          const sum = `(${terms.join(` ${op} `)})`;
          return bindings.length === 0
            ? sum
            : expression((exit) => `${hoisted}${exit(sum)}`);
        }

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

  // Keep the body, accumulator and parent on the same real representation.
  const loopLane =
    isRootClause && rest.length === 0
      ? realLoopClauseLane(body, index, lowerNum, target)
      : undefined;
  const loopIsComplex = loopLane ?? bodyIsComplex;
  const compileLoopTerm = (innerTarget: CompileTarget<Expression>): string =>
    loopLane === false
      ? BaseCompiler.withLoopIndexLowerBound(index, lowerNum!, () =>
          compileTerm(innerTarget)
        )
      : compileTerm(innerTarget);

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

  // The counter stays numeric unless the body writes it. Declining on any
  // same-named assignment also conservatively covers nested binder scopes.
  const writesCounter = (expr: Expression): boolean => {
    if (!isFunction(expr)) return false;
    const options = target.cse?.harvestOptions;
    if (options === undefined || isCallerMapped(expr, options)) return true;
    if (
      ['Assign', 'Declare'].includes(expr.operator) &&
      (!isSymbol(expr.ops[0]) || expr.ops[0].symbol === index)
    )
      return true;
    return expr.ops.some(writesCounter);
  };
  if (!writesCounter(body)) recordScalarParams(innerTarget, new Set([index]));
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
          compileLoopTerm(innerTarget)
        )
      : { bindings: [], result: compileLoopTerm(innerTarget) };
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
    // Retained helper bodies can still have a collection-capable static
    // type after their actual return values are proven scalar. Keep this
    // branch's first-term seed (including signed zero), order and NaN policy,
    // while omitting array dispatch for an innermost scalar term.
    const scalarTerm = rest.length === 0 && isScalarValue(body, innerTarget);
    const fold = scalarTerm
      ? `${acc} = ${acc} === null ? ${val} : ${acc} ${op} ${val};`
      : `${acc} = ${acc} === null ? (Array.isArray(${val}) ? ${val}.slice() : ${val}) : _SYS.bcast((_a, _b) => _a ${op} _b, ${acc}, ${val});`;
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

  if (loopIsComplex) {
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
    } catch (e) {
      // Unlowerable head: fall through to quadrature below.
      // A cancellation that is not a timeout (an abort, an iteration or
      // recursion limit), or a timeout of an expired enclosing span, belongs
      // to the caller: it is thrown again, not changed into a fallback
      // (docs/TIMEOUT-MODEL.md §2).
      throwIfCallerCancellation(e, closed.engine._deadlineFrame);
    }
  }

  const limits = args.slice(1).map(extractLimits);

  // An INDEFINITE integral (`\int f dx` — the `Limits` clause carries `Nothing`
  // for its bounds) that did not close to an antiderivative above has no
  // numeric value at a point: it denotes a function, not a number. The
  // quadrature emitter below would compile the `Nothing` bounds like any other
  // free symbol, to a `vars`-object lookup (`_.Nothing`), and at run time
  // `adaptiveQuadrature(f, undefined, undefined)` reports "converged" and
  // yields `0` for every input — a silent wrong value. Fail closed so the
  // caller falls back to the interpreter, which keeps the integral symbolic.
  const isUnbounded = (e: Expression | undefined) =>
    e === undefined || isSymbol(e, 'Nothing');
  if (limits.some((l) => isUnbounded(l.lowerExpr) || isUnbounded(l.upperExpr)))
    throw new Error(
      'Could not compile `Integrate`: an indefinite integral with no closed-form antiderivative is a function, not a number — it has no value to compute at a point, and quadrature needs bounds. Provide bounds for a definite integral, or evaluate symbolically instead.'
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

  // The integrand runs once per quadrature sample, so a subexpression of it
  // that mentions none of the integration variables is a loop invariant:
  // `Gamma(k/2)·√2^k` in the denominator of a chi-square tail was computed at
  // every one of the 300 samples of one integral (Tycho corpus document
  // `thpezd39zq`). Such subexpressions are bound once, next to the lambda,
  // and assigned on its FIRST call — quadrature may request no sample at all
  // (an empty range), and the unhoisted integrand then evaluated nothing.
  //
  // A `Function` integrand's body is a `Block`, a scope the candidate pass
  // never descends into; a block of ONE statement declares nothing before it,
  // so that statement is what is scanned (the same reading
  // `hoistedCallbackLambda` takes). The block itself is still what compiles,
  // and its statement is the very node the scan rewrote.
  const bodyTarget = scoped(lambdaVars);
  const scanned =
    isFunction(bodyExpr, 'Block') && bodyExpr.nops === 1
      ? bodyExpr.ops[0]
      : bodyExpr;
  const { bindings, result: f } = BaseCompiler.hoistLoopInvariants(
    scanned,
    lambdaVars,
    bodyTarget,
    () => BaseCompiler.compile(bodyExpr, bodyTarget)
  );

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
    // The innermost lambda carries the invariant bindings. In a nest it sits
    // inside the outer lambdas, where every name the body reads is in
    // scope; the bindings mention no integration variable, so an outer
    // sample recomputes them once, which is what the unhoisted body did per
    // inner sample.
    const plain = `(${lambdaVars[d]}) => (${code})`;
    const lambda =
      d === limits.length - 1 && bindings.length > 0
        ? firstCallBoundLambda(plain, 1, bindings, target)
        : plain;
    code = `${fn}(${lambda}, ${lo}, ${hi}${panelArg})`;
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

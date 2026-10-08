import { BoxedType } from '../../common/type/boxed-type.js';
import { joinLatex } from '../latex-syntax/tokenizer.js';
import { activeRollbackFrame } from '../inference-rollback.js';
import {
  callbackArity,
  declaresPhrase,
} from '../boxed-expression/callback-arity.js';
import {
  effectsContractStateOf,
  recordEffectsTransition,
} from '../boxed-expression/effects-provenance.js';
import {
  parse as parseLatex,
  serialize as serializeLatex,
} from '../latex-syntax/latex-syntax.js';

import {
  checkType,
  checkArity,
  expectsCharacterNotString,
} from '../boxed-expression/validate.js';
import {
  collectTuplePattern,
  tuplePatternNames,
} from '../boxed-expression/tuple-pattern.js';
import { instantiatedResultTypeOverActuals } from '../boxed-expression/generic-instantiation.js';
import { actualOfDescriptor } from '../boxed-expression/derive-application-type.js';
import {
  describeBoundSymbol,
  describeType,
} from '../boxed-expression/operand-descriptor.js';
import { canonicalForm } from '../boxed-expression/canonical.js';
import { isInferredTypedParameter } from '../boxed-expression/inferred-annotations.js';
import { isTransitivelyPure } from '../boxed-expression/transitive-purity.js';
import { asSmallInteger, toInteger } from '../boxed-expression/numerics.js';
import { MACHINE_PRECISION, SMALL_INTEGER } from '../numerics/numeric.js';
import type { BigNum } from '../numerics/types.js';
import {
  displayDigits,
  setDisplayDigits,
} from '../numeric-value/big-numeric-value.js';
import {
  addSequenceBaseCase,
  addSequenceRecurrence,
  addMultiIndexBaseCase,
  addMultiIndexRecurrence,
  containsSelfReference,
  extractIndexVariable,
} from '../sequence.js';

import {
  apply,
  canonicalFunctionLiteral,
  canonicalFunctionLiteralOperands,
  canonicalWithFreshPlaceholders,
  captureNestedLocals,
} from '../function-utils.js';
import { freeAnonymousSlots } from '../boxed-expression/function-literal.js';

import { flatten, flattenSequence } from '../boxed-expression/flatten.js';
import { listedBroadcastCells } from '../boxed-expression/listed-element.js';

import { fromDigits } from '../numerics/strings.js';
import { MAX_RANDOM_ELEMENT_COUNT } from '../numerics/random.js';
import { rangeCount } from '../numerics/range-count.js';
import { exactArithmeticRange } from './range-closed-form.js';
import { randomCount } from './random-utils.js';
import {
  coarsenEvidenceType,
  joinEvidenceTypes,
  isDeclaredLocal,
  isEvidenceLost,
  markEvidenceLost,
  registerEvidenceSite,
} from './assignment-evidence.js';
import { isRingConstant } from './ring-constructions.js';
import { RING_CONSTANTS } from '../latex-syntax/utils.js';
import {
  operandLiteralValue,
  quotientRingType,
  storedComponentTypeD,
} from './type-handlers.js';
import {
  settleTypeText,
  settledTypeText,
  isPolytype,
  isValueForm,
  dynamicTypeTest,
} from './type-value-utils.js';
import { interval, literalIntervalEndpoints } from '../numerics/interval.js';
import {
  fieldAssignmentVerdict,
  fieldStoreRefusal,
  objectLayoutOwnsField,
  objectFieldStore,
  literalRange,
  joinCharacters,
  range,
  rangeLast,
} from './collections.js';
import { checkDeadline } from '../../common/interruptible.js';
import { typeToString } from '../../common/type/serialize.js';

import { randomExpression } from './random-expression.js';
import { canonicalInvisibleOperator } from '../boxed-expression/invisible-operator.js';
import {
  collectionElementType,
  functionResult,
  isValidType,
  signatureArms,
  stripMissingFromType,
  widen,
  containsSignatureArm,
  resolveTypeAlias,
  broadcastResultType,
  broadcastShapedResultType,
  nestedBroadcastResultType,
} from '../../common/type/utils.js';
import {
  COLLECTION_SHAPE_TYPE,
  INDEXED_COLLECTION_SHAPE_TYPE,
} from '../../common/type/primitive.js';
import { signatureParamsAreScalar } from '../boxed-expression/callback-broadcast-admission.js';
import {
  parseType,
  parseTypeParameterClause,
} from '../../common/type/parse.js';
import { canonicalMultiply } from '../boxed-expression/arithmetic-mul-div.js';
import {
  canonicalSolve,
  evaluateSolve,
} from '../boxed-expression/solve-domain.js';
import { findRoot } from '../nonlinear-fit.js';
import { BLOCK_DEFINITION } from './control-structures.js';
// BoxedDictionary will be dynamically imported to avoid circular dependency
import type {
  IComputeEngine as ComputeEngine,
  BoxedOperatorDefinition,
  BoxedValueDefinition,
  Expression,
  OperandDescriptor,
  OperandStructure,
  TypeHandlerContext,
  ValueDefinition,
  SymbolDefinitions,
  DictionaryInterface,
  CanonicalForm,
  ProtocolMembersInput,
  Tri,
} from '../global-types.js';
import type { EvaluateHandlerOptions } from '../types-definitions.js';
import { awaitAsyncOnlyDescendants } from '../boxed-expression/async-only-descendants.js';
import { runWithEvaluationEffects } from '../effects-registry.js';
import type { EffectHandlers } from '../types-effects.js';
import type { FunctionInterface } from '../types-expression.js';
import type {
  Type,
  TypeParameter,
  DeclarationOrigin,
} from '../../common/type/types.js';
import { isSubtype, provablyDisjoint } from '../../common/type/subtype.js';
import {
  freeTypeVariables,
  isPolymorphicType,
  substituteTypeVariables,
} from '../../common/type/instantiate.js';
import type { Rule } from '../types-evaluation.js';
import { canonical } from '../boxed-expression/canonical-utils.js';
import {
  isDictionary,
  isValueDef,
  isOperatorDef,
  assignedVariableNames,
  withValueShield,
  withRandomSeedFrame,
  withDrawRollback,
  updateDef,
  boxBignumResult,
} from '../boxed-expression/utils.js';
import {
  checkTypeConstructorNamespace,
  installConstructorFunction,
  isMintedConstructor,
  loosenMintedConstructor,
} from '../type-constructors.js';
import {
  ClauseDefinitionError,
  clauseListing,
  declaredSignatureOf,
  declareLocalClauseTarget,
  defineFunctionClause,
  canonInstallSkipped,
  isGenericClauseLiteral,
  isGenericTarget,
  noteCanonInstallSkipped,
  loosenForClauseDefinition,
  type ClauseAttributes,
} from '../multi-clause.js';
import {
  ascribeDeclaredParameterTypes,
  assertAssignable,
  assignValueAsOperatorDef,
  declareSumType,
  // Called directly rather than through `ce.declareType()`: the redefinition
  // stamp is a STATEMENT-route concern and is deliberately absent from the
  // host API's options, which is what keeps host declarations unstamped.
  declareType,
} from '../engine-declarations.js';
import type { SumTypeVariant } from '../engine-declarations.js';
import { RedefinitionError } from '../declaration-origin.js';
import {
  canonicalProtocolMember,
  declareConformance,
  declareProtocolImpl,
  evaluateProtocolMember,
  evaluateProtocolPropertyOperator,
  isProtocolDispatcher,
  protocolMemberResultType,
  protocolNamedPropertyRefusal,
  protocolPropertyStore,
  protocolPropertyWriteRefusal,
  protocolsWithProperty,
  protocolPropertyResultType,
  typePrimitiveConformanceProblem,
} from '../engine-protocols.js';
import { errorValue } from '../boxed-expression/error-value.js';
import {
  effectContractErrorValue,
  isEffectContractError,
  matchesDeclaredTypeAxes,
  signatureEffects,
} from '../boxed-expression/effects-inference.js';
import {
  declaredTypeError,
  isTypeCompatibilityError,
  typeCompatibilityErrorValue,
} from '../boxed-expression/type-compatibility-error.js';
import {
  operatorDefinitionOf,
  shallowApplicationEffects,
  valueContainerCells,
} from '../boxed-expression/effects-of.js';
import { hasDeclaredEffectLabel } from '../../common/type/effects.js';
import {
  canEnumerateOperand,
  isEnumerableSource,
  isPointListReading,
  isTupleShapedType,
  broadcastLengthMismatch,
  isBroadcastableCollection,
  lazyBroadcastMapIfNeeded,
  zipBroadcast,
  isWalkableFiniteCollection,
} from '../collection-utils.js';
import { abstractCollectionCell } from '../boxed-expression/broadcast-lift-type.js';
import { validatedLiteralApplicationOperands } from '../boxed-expression/box.js';
import {
  annotateBroadcastErrors,
  declaredScalarParams,
  declaredScalarTupleCells,
  declaredScalarTupleType,
  isDeclaredScalarType,
  isUnresolvedMappableOperand,
  refusedLiteralArgumentError,
} from '../boxed-expression/boxed-function.js';
import { numericDerivativeOfApply } from './calculus.js';
import {
  isNumber,
  isSymbol,
  isFunction,
  isString,
  isCharacter,
  isAbsentValue,
  isAbsentSymbol,
  sym,
} from '../boxed-expression/type-guards.js';
import {
  isSingleGraphemeCluster,
  narrowStringLiteralToCharacter,
} from '../boxed-expression/boxed-character.js';
import { splitGraphemeClusters } from '../../common/grapheme-splitter.js';
import { splitByPattern, replaceByPattern } from './regexp.js';
import {
  journalCheckpointMapEntry,
  journalCheckpointField,
} from '../checkpoint-journal.js';
import {
  journalDefinitionRecord,
  widenAssignedType,
} from '../boxed-expression/boxed-value-definition.js';
import { reduceType } from '../../common/type/reduce.js';
import { smallCount } from '../boxed-expression/collection-count.js';

/**
 * Literal narrowing at a typed declaration or assignment: the character a
 * string literal denotes when it is stored into a name whose declared
 * type expects a character and refuses a string. Returns `undefined` when no
 * narrowing applies, so every call site reads
 * `narrowDeclaredCharacter(...) ?? <its existing behavior>`.
 *
 * Epsil has no character literal — `"a"` is a string — so without this a
 * `character`-typed name could never be initialized or written from spelled-
 * out text (`let c: character = "a"`). This is the same conversion argument
 * validation performs at a `character` parameter, reached through the same two
 * helpers (`expectsCharacterNotString`, `narrowStringLiteralToCharacter`), so
 * the declaration and the call site cannot disagree about which literals
 * narrow or which declared types accept a narrowing.
 *
 * Keyed on the raw, unevaluated right-hand operand on purpose: only a
 * syntactic literal narrows. A symbol that happens to hold a one-cluster
 * string does not implicitly convert and must be written `CharacterFrom(s)`.
 * An empty or multi-cluster
 * literal narrows to nothing and falls through to the ordinary
 * `incompatible-type` declared-type diagnostic.
 */
/**
 * The absence markers: `Nothing` (an operand to drop), `Missing` (an absent
 * value with a position) and `Undefined` (an absent value of unknown type).
 * They cannot be rebound (user decision 2026-09-27): the engine recognizes
 * each one by its NAME in many places — `Nothing` is erased from operand
 * lists, and arithmetic reads a `Missing` or `Undefined` operand as absent
 * whatever it is bound to — so a user binding of one of these names could
 * never behave like the value it holds. A declaration, an assignment or a
 * function definition of one of them evaluates to the
 * `absence-marker-binding` error; the Epsil static pass reports every other
 * binding form (a parameter, a loop variable, a match pattern) as well.
 */
const ABSENCE_MARKERS: ReadonlySet<string> = new Set([
  'Nothing',
  'Missing',
  'Undefined',
]);

/** The `absence-marker-binding` error when `name` is an absence marker. */
function absenceMarkerBindingError(
  ce: ComputeEngine,
  name: string | undefined
): Expression | undefined {
  return name !== undefined && ABSENCE_MARKERS.has(name)
    ? ce.error(['absence-marker-binding', name])
    : undefined;
}

function narrowDeclaredCharacter(
  ce: ComputeEngine,
  declared: Type | undefined,
  rawValue: Expression | undefined
): Expression | undefined {
  if (declared === undefined || rawValue === undefined) return undefined;
  if (!isString(rawValue)) return undefined;
  if (!expectsCharacterNotString(declared)) return undefined;
  return narrowStringLiteralToCharacter(ce, rawValue);
}

/**
 * The type `name` was declared with, or `undefined` when the name is unbound,
 * is not a value binding, or carries only an inferred type.
 *
 * The inferred case is excluded because an inferred type is a summary of what
 * has been stored so far, not a contract the next store must satisfy: widening
 * it is the normal outcome, so treating it as a narrowing target would convert
 * values the binding never promised to hold.
 */
function declaredTypeOfSymbol(
  ce: ComputeEngine,
  name: string
): Type | undefined {
  const def = ce.lookupDefinition(name);
  if (def === undefined || !isValueDef(def)) return undefined;
  if (def.value.inferredType) return undefined;
  return def.value.type?.type;
}

/** A `Pipe` right operand that is statically refutable as a function: a bare
 * number, string, or boolean (`True`/`False`) literal. Such an operand can
 * never become applicable, so `Pipe` rejects it early. A general symbol is NOT
 * refutable — its definition may arrive later (deferral). */
function isRefutablePipeTarget(f: Expression): boolean {
  return (
    isNumber(f) || isString(f) || isSymbol(f, 'True') || isSymbol(f, 'False')
  );
}

/**
 * Implicit topic argument: a pipe stage written as a CALL that is missing
 * required arguments receives the piped value as its implicit first
 * argument — `xs |> Take(10)` means `xs |> Take(_, 10)`. Returns the stage
 * with a `_` placeholder inserted first (raw, like the held operand it
 * replaces), or `undefined` when the sugar does not apply.
 *
 * Deliberately narrow: the implicit `_` fills a hole; it never rewrites a
 * complete call:
 * - the stage must be a call `F(…)` on an operator with a known signature;
 * - it must mention no placeholder of its own (an explicit `_`/`_1`…`_9`
 *   already says where the topic goes, e.g. `Take(_, 10)`, `Map(f, _)`);
 * - the written argument count must be below every signature arm's minimum
 *   arity — required parameters plus a one-or-more variadic's minimum (the
 *   call is incomplete however it is read) — and the completed count must
 *   fit some arm's arity.
 *
 * The placeholder fills a slot that qualifies twice over: its declared type
 * is one the topic provably satisfies, and the written arguments still fit
 * the slots they are displaced into (those before the slot stay put, those
 * from it on shift one right). Among the qualifying slots the last one wins
 * — the one that displaces the fewest written arguments, since a stage
 * missing an argument is most naturally missing its trailing one. So a
 * collection piped into `Take(10)` goes first (`Take(_, 10)`: slot 1 is
 * `n: integer`, and `10` fits its shifted slot), one piped into the
 * callback-first `Map(f)` goes second (`Map(f, _)`), and one piped into
 * `Fold(f, 10)` goes third (`Fold(f, 10, _)`: the list also fits `initial:
 * value`, but `10` cannot fit the collection slot it would be pushed into).
 * When no slot qualifies — an unknown-typed topic that satisfies nothing
 * provably — it defaults to first.
 *
 * A complete call keeps its existing meaning — `5 |> Max(3)` still applies
 * the value of `Max(3)` — so this sugar only gives meaning to stages that
 * were previously arity errors. A type mismatch surfaces from the completed
 * call (`5 |> Take(10)` reports `Take`'s collection parameter), which names
 * the actual problem better than an `Apply` fallback would.
 */
function pipeStageWithImplicitTopic(
  ce: ComputeEngine,
  rhs: Expression,
  topic: Expression
): Expression | undefined {
  if (!isFunction(rhs)) return undefined;
  const name = rhs.operator;
  if (name === 'Function') return undefined;
  // A slot inside a nested `Function` literal belongs to that literal, so a
  // stage such as `["Map", ["Function", ["Add", "_", 1]]]` has no slot of its
  // own and still receives the topic as its missing operand.
  if (freeAnonymousSlots(rhs).size > 0) return undefined;
  const def = ce.lookupDefinition(name);
  const opDef =
    def !== undefined && 'operator' in def ? def.operator : undefined;
  const arms = signatureArms(opDef?.signature.type);
  if (arms === undefined) return undefined;
  const n = rhs.nops;
  const minArity = (a: (typeof arms)[number]): number =>
    (a.args?.length ?? 0) +
    (a.variadicArg !== undefined ? (a.variadicMin ?? 0) : 0);
  // Complete under some arm: the written call already means something.
  if (arms.some((a) => n >= minArity(a))) return undefined;
  const fits = arms.some((a) => {
    const req = a.args?.length ?? 0;
    const max =
      a.variadicArg !== undefined ? Infinity : req + (a.optArgs?.length ?? 0);
    return n + 1 <= max;
  });
  if (!fits) return undefined;

  // Placement: first slot (across the arms, in order) whose declared
  // parameter type the topic provably satisfies, bounded by the written
  // argument count (the topic can at most be appended). The declared type is
  // grounded for the test: a free type variable (`collection<T>`) is
  // substituted with `any` — the question here is "could the topic belong in
  // this slot", not the solve itself.
  // An arrow-typed slot admits callbacks by compatibility, so for placement —
  // "could this belong here" — any function-shaped candidate
  // fits an arrow slot. Strict contravariant `matches` refused the very
  // stages the sugar exists for once `Map`'s slot became an honest arrow:
  // the lambda of `xs |> Map(n => n^2)` types `(unknown) -> number`, which
  // is not a SUBTYPE of the grounded `(any) any -> any`.
  const couldBeCallbackAt = (t: Type, p: Type): boolean =>
    signatureArms(p) !== undefined &&
    // Top types are excluded: an `unknown`/`any` candidate is not
    // function-shaped evidence, and admitting it here would let an
    // ambiguous topic outcompete its semantically right slot; such
    // candidates keep the ordinary placement rules.
    t !== 'unknown' &&
    t !== 'any' &&
    freeTypeVariables(t).size === 0 &&
    !provablyDisjoint(t, 'function');
  const slotAccepts = (param: Type): boolean => {
    let p = param;
    const vars = freeTypeVariables(p);
    if (vars.size > 0) {
      const bindings: Record<string, Type> = Object.create(null);
      for (const v of vars) bindings[v] = 'any';
      p = substituteTypeVariables(p, bindings);
    }
    if (couldBeCallbackAt(topic.type.type, p)) return true;
    return topic.type.matches(p);
  };
  // …AND whose written arguments still fit the slots they are displaced
  // into. Without the second half, `xs |> Fold(f, 10)` put the list at slot 1
  // (`initial: value` — a list is a value) and pushed `10` into the
  // collection slot, an inert `Fold(f, xs, 10)`; the third slot is the one
  // where everything fits. A written argument whose type cannot be read yet
  // (a held, unbound operand reads `unknown`) is taken to fit — the question
  // is placement, not validation, which the canonical call performs after.
  const argAccepts = (arg: Expression, param: Type): boolean => {
    if (arg.type.isUnknown) return true;
    let p = param;
    const vars = freeTypeVariables(p);
    if (vars.size > 0) {
      const bindings: Record<string, Type> = Object.create(null);
      for (const v of vars) bindings[v] = 'any';
      p = substituteTypeVariables(p, bindings);
    }
    // Compatibility placement at an arrow slot — see `couldBeCallbackAt`.
    if (couldBeCallbackAt(arg.type.type, p)) return true;
    return arg.type.matches(p);
  };
  //
  // Among the slots that fit, the LAST one wins — the one that displaces the
  // fewest written arguments. The natural reading of a stage that is missing
  // an argument is that the missing one is the TRAILING one; shifting the
  // written arguments right is only for a topic that belongs first
  // (`xs |> Take(10)`, where slot 1 is `n: integer` and cannot take a
  // list). Under the first-fit rule `xs |> Fold(Join, "H;")` chose slot 1
  // (a string is a collection, so `"H;"` "fit" the collection slot it was
  // pushed into) and produced an inert `Fold(Join, xs, "H;")`.
  let at = 0;
  placement: for (const a of arms) {
    const params = [
      ...(a.args ?? []).map((p) => p.type),
      ...(a.optArgs ?? []).map((p) => p.type),
      ...(a.variadicArg !== undefined ? [a.variadicArg.type] : []),
    ];
    for (let i = Math.min(params.length - 1, n); i >= 0; i--) {
      if (!slotAccepts(params[i])) continue;
      // The written arguments before `i` stay put; those from `i` on shift
      // one slot right (a variadic tail absorbs any overflow).
      const last = params.length - 1;
      const displacedFit = rhs.ops.every((arg, k) => {
        const slot = k < i ? k : k + 1;
        const param =
          slot <= last
            ? params[slot]
            : a.variadicArg !== undefined
              ? a.variadicArg.type
              : undefined;
        return param !== undefined && argAccepts(arg, param);
      });
      if (!displacedFit) continue;
      at = i;
      break placement;
    }
  }

  const args = [...rhs.ops];
  args.splice(at, 0, ce.symbol('_', { canonical: false }));
  return ce._fn(name, args, { canonical: false });
}

/**
 * Does every parameter of the function-literal signature `sig` map over a
 * collection argument? A scalar parameter does (`signatureParamsAreScalar`,
 * the rule of the named route). So does a TUPLE-typed parameter, the type a
 * destructuring pattern `((p, q)) ↦ …` infers: a point is atomic, so a list
 * of points maps point by point, and binding the list whole to a tuple
 * parameter would be a type error. A generic signature binds whole.
 *
 * The shader targets use the same test for an `Apply` they compile
 * (`gpuAppliedBody` in `compilation/gpu-target.ts`), so that the compiled
 * code and the interpreter give a result of the same shape.
 */
export function literalParamsMap(sig: Type): boolean {
  if (typeof sig !== 'object' || sig.kind !== 'signature') return false;
  if (isPolymorphicType(sig)) return false;
  const params = [
    ...(sig.args ?? []),
    ...(sig.optArgs ?? []),
    ...(sig.variadicArg ? [sig.variadicArg] : []),
  ];
  return params.every(
    (p) =>
      isTupleShapedType(p.type) ||
      signatureParamsAreScalar({
        kind: 'signature',
        args: [p],
        result: sig.result,
      })
  );
}

/**
 * Does `Apply(fn, …args)` map element by element over its collection
 * arguments, as a call of a named user function with the same body does?
 * True when `fn` is a function literal whose parameters are all scalar by
 * its signature (`signatureParamsAreScalar`, the rule the named route uses
 * through `paramsAreScalar`) and at least one argument is an indexed
 * collection that is not a tuple (a point stays atomic) nor a string. A
 * known-infinite source (`Range(1, +∞)`, `Cycle`), a large one, or one of
 * unknown length maps lazily (`applyLiteralMapped`), as on the named route:
 * `Apply(x ↦ (x, x), Range(1, +∞))` is the infinite list `[(1, 1), (2, 2),
 * …]`, the value the type handler (`applyLiteralMapType`) describes. An
 * infinite source used to be bound whole, which gave the tuple
 * `(Range(1, +∞), Range(1, +∞))` under a `list<tuple<…>>` type.
 *
 * User decision 2026-09-26 (Tycho item 327): a function literal applied to a
 * list maps like a named user function, on every route. It used to bind each
 * argument whole, so `Apply(i ↦ Sum(Cos(n), Limits(n, 1, i)), [1, 2, 3])`
 * was an `incompatible-type` error while `X([1, 2, 3])` with
 * `X := i ↦ …` mapped, and the compiled code of the literal mapped as well.
 * A literal whose parameter is a collection by its signature
 * (`x ↦ Length(x)` infers `x: collection`) still binds the argument whole.
 */
function applyLiteralMaps(
  fn: Expression,
  args: ReadonlyArray<Expression>
): boolean {
  if (!isFunction(fn, 'Function')) return false;
  // A generic literal (`(x: T) -> T where T`) binds its argument whole, as
  // on the named route: its type parameter is solved against the whole
  // argument (`literalParamsMap`).
  if (!literalParamsMap(fn.type.type)) return false;
  // A collection argument with no value yet (a symbol declared
  // `list<real>`) also takes this route, and `applyLiteralMapped` holds the
  // application. The type handler (`applyLiteralMapType`) types the call as
  // the mapped collection, so binding the symbol whole would give a value
  // of a different shape: `Apply(u ↦ 7, v)` gave `7`. A set or a
  // dictionary is never mapped over, so an argument of such a type does not
  // take this route (`isUnresolvedMappableOperand`).
  return args.some(
    (a) => isBroadcastableCollection(a) || isUnresolvedMappableOperand(a)
  );
}

/**
 * The type of one cell of a mapped application of a one-parameter function
 * literal `fn` over one collection argument: the literal's body typed with
 * the parameter bound to the collection's leaf element type (a broadcast of
 * a scalar-parameter function binds its parameter to the leaves), through
 * `pipeStageBodyType`. `undefined` when there is no handler context, more
 * than one argument, a leaf that is not a single element type (a ragged
 * union), or a body the derivation cannot type.
 */
function literalCellType(
  fn: OperandDescriptor,
  collections: ReadonlyArray<OperandDescriptor>,
  args: ReadonlyArray<OperandDescriptor>,
  context: TypeHandlerContext | undefined
): Type | undefined {
  if (context === undefined || args.length !== 1 || collections.length !== 1)
    return undefined;
  const st = fn.structureOf?.();
  if (st?.kind !== 'function-literal') return undefined;
  const param = pipeStageParameter(st);
  if (param === undefined) return undefined;
  let leaf: Type | undefined = collections[0].type;
  for (let k = 0; k < 8; k++) {
    const r = resolveTypeAlias(leaf);
    if (typeof r === 'object' && r.kind === 'tuple') break;
    if (isSubtype(r, 'string')) break;
    if (!isSubtype(r, INDEXED_COLLECTION_SHAPE_TYPE)) break;
    leaf = collectionElementType(r);
    if (leaf === undefined) return undefined;
  }
  const r = resolveTypeAlias(leaf);
  if (typeof r === 'object' && r.kind === 'union') return undefined;
  // A parameter with a declared type is bound to that type, as the named
  // routes type each cell with the signature of the function: with
  // `(u: integer) ↦ u + 1` over a list of reals, each cell is `integer` (or
  // the error that a non-integer element gives).
  return pipeStageBodyType(
    context,
    st.body,
    param.name,
    param.annotated ?? leaf
  );
}

/**
 * The static type of `Apply(fn, …args)` when it maps (`applyLiteralMaps`),
 * read from operand descriptors; `undefined` otherwise. The gate is the
 * evaluate-time one: a function-literal callee whose parameters are scalar
 * by its signature, and an argument typed as an indexed collection that is
 * neither a tuple nor a string.
 */
function applyLiteralMapType(
  fn: OperandDescriptor,
  args: ReadonlyArray<OperandDescriptor>,
  context?: TypeHandlerContext
): Type | undefined {
  const st = fn.structureOf?.();
  if (st?.kind !== 'function-literal') return undefined;
  // A tuple argument at a parameter declared as a scalar maps over its
  // components, as at evaluation (`declaredScalarTupleCells`), whatever the
  // other parameters are: the call is typed as the tuple of the results
  // (`declaredScalarTupleType`).
  const tupleMapped = declaredScalarTupleType(
    (i) => isDeclaredScalarType(st.parameters[i]?.annotated),
    args.map((a) => a.type),
    functionResult(fn.type) ?? 'unknown',
    literalParamsMap(fn.type)
  );
  if (tupleMapped !== undefined) return tupleMapped;
  if (!literalParamsMap(fn.type)) return undefined;
  const mapsOver = (t: Type): boolean =>
    isSubtype(t, INDEXED_COLLECTION_SHAPE_TYPE) &&
    !isSubtype(t, 'string') &&
    !(typeof t === 'object' && t.kind === 'tuple');
  // A numeric tuple binds whole (in every cell, beside a collection), and
  // the body decides the shape (`x·y` with a point `y` gives a point), so
  // a scalar result does not describe the cell: `any`, as on the named route
  // (`lambdaBroadcastType`).
  const perElement0 = functionResult(fn.type) ?? 'unknown';
  if (
    args.some((a) => {
      const t = resolveTypeAlias(a.type);
      return (
        typeof t === 'object' &&
        t.kind === 'tuple' &&
        t.elements.every((e) => isSubtype(e.type, 'number'))
      );
    }) &&
    (perElement0 === 'unknown' || isSubtype(perElement0, 'number'))
  )
    return 'any';
  const collections = args.filter((a) => mapsOver(a.type));
  if (collections.length === 0) {
    // A scalar-or-list argument (`u: number | list<number>`) maps when it
    // holds a list and binds when it holds a scalar: the call is either
    // shape, as on the named route (`loneUnionBroadcastResultType` in
    // `boxed-function.ts`).
    const union = args.find((a) => {
      const t = resolveTypeAlias(a.type);
      return (
        typeof t === 'object' &&
        t.kind === 'union' &&
        t.types.some((m) => mapsOver(m))
      );
    });
    if (union === undefined) {
      // An argument of an abstract collection type (`collection<real>`) or
      // of a `broadcastable<T>` type can hold a list, which the call maps
      // over, or a value it does not map over (a set, a scalar). The call
      // is typed `broadcastable<R>`, as on the named routes
      // (`lambdaBroadcastType` in `boxed-function.ts`).
      const maybeMapped = args.some((a) => {
        const t = resolveTypeAlias(a.type);
        const broadcastable = (x: Type) => {
          const r = resolveTypeAlias(x);
          return typeof r === 'object' && r.kind === 'broadcastable';
        };
        return (
          broadcastable(t) ||
          (typeof t === 'object' &&
            t.kind === 'union' &&
            t.types.some(broadcastable)) ||
          abstractCollectionCell(t) !== undefined
        );
      });
      if (!maybeMapped) return undefined;
      return {
        kind: 'broadcastable',
        elements: functionResult(fn.type) ?? 'unknown',
      };
    }
    const cell = functionResult(fn.type) ?? 'unknown';
    return reduceType({
      kind: 'union',
      types: [cell, broadcastResultType(cell)],
    });
  }
  // As the named route types a lambda broadcast (`lambdaBroadcastType` in
  // `boxed-function.ts`): a collection-valued per-element result nests
  // (`x ↦ (x, x)` over a list is a list of tuples), a scalar one takes the
  // source's shape. The per-element result is the literal's body typed with
  // its parameter bound to the collection's LEAF element type, when there is
  // one parameter and one collection (`x ↦ x^2` over integers gives
  // `integer<0..>` cells), and the literal's signature result otherwise.
  const perElement =
    literalCellType(fn, collections, args, context) ??
    functionResult(fn.type) ??
    'unknown';
  if (isSubtype(perElement, COLLECTION_SHAPE_TYPE))
    return nestedBroadcastResultType(
      collections.map((a) => a.type),
      perElement
    );
  return broadcastShapedResultType(
    collections.map((a) => a.type),
    perElement
  );
}

/**
 * The value of `Apply(fn, …args)` when it maps (`applyLiteralMaps`), built as
 * the named route builds the broadcast of a scalar-parameter user function
 * (`BoxedFunction` evaluation, step 4b): collections of different lengths
 * are the `incompatible-dimensions` error; a large source, or one of unknown
 * length (a `Filter`), gives the lazy `Map` form
 * (`lazyBroadcastMapIfNeeded`); otherwise the mapped arguments are
 * zipped and `Apply(fn, …row)` is evaluated per cell, a scalar argument, a
 * tuple (a point) or a string repeated whole in every cell. The per-cell
 * `Apply` maps again over a cell that is itself a collection, as the named
 * route does, so a nested list is mapped at every depth.
 */
function applyLiteralMapped(
  ce: ComputeEngine,
  fn: Expression,
  args: ReadonlyArray<Expression>,
  numericApproximation: boolean | undefined
): Expression | undefined {
  const mapped = (x: Expression) => isBroadcastableCollection(x);
  const mismatch = broadcastLengthMismatch(ce, args.filter(mapped));
  if (mismatch) return mismatch;
  // A collection argument with no value yet (a symbol declared `list<…>`)
  // holds the application, as the named route does: mapping now would lift
  // it whole into every cell, and assigning it later could not recover the
  // element-wise result. This is also true when that argument is the only
  // collection: binding it whole would give a value of a different shape
  // than the mapped type of the call. Evaluating the held application again
  // after the symbol has a value maps it.
  if (args.some((x) => !mapped(x) && isUnresolvedMappableOperand(x)))
    return ce._fn('Apply', [fn, ...args]);
  const lazy = lazyBroadcastMapIfNeeded(
    ce,
    'Apply',
    [fn, ...args],
    (x, i) => i > 0 && mapped(x),
    numericApproximation === true
  );
  if (lazy) return lazy;
  const rows = zipBroadcast(args, mapped);
  const results: Expression[] = [];
  while (true) {
    const { done, value } = rows.next();
    if (done) break;
    results.push(
      ce._fn('Apply', [fn, ...value]).evaluate({ numericApproximation })
    );
  }
  // An element that fails says that the application was element-wise, as
  // on the named routes (`annotateBroadcastErrors`).
  return ce._fn(
    'List',
    annotateBroadcastErrors(
      'Apply',
      listedBroadcastCells(ce, results, numericApproximation)
    )
  );
}

/**
 * The value of `Apply(fn, …args)` when `fn` is a function literal with a
 * parameter declared as a scalar and the argument there is a TUPLE: the
 * tuple of the values of `Apply(fn, …)` at each component
 * (`declaredScalarTupleCells`). A symbol with no value and a tuple type at
 * such a parameter holds the application. `undefined` when the
 * application does not map over a tuple.
 */
function applyLiteralOverTuples(
  ce: ComputeEngine,
  fn: Expression,
  args: ReadonlyArray<Expression>,
  numericApproximation: boolean | undefined
): Expression | undefined {
  if (!isFunction(fn, 'Function')) return undefined;
  const isScalarParam = declaredScalarParams(fn);
  if (isScalarParam === undefined) return undefined;
  const cells = declaredScalarTupleCells(ce, isScalarParam, args);
  if (cells === undefined) return undefined;
  if (cells === 'hold') return ce._fn('Apply', [fn, ...args]);
  if (!Array.isArray(cells)) return cells;
  return ce._fn(
    'Tuple',
    annotateBroadcastErrors(
      'Apply',
      listedBroadcastCells(
        ce,
        cells.map((cell) =>
          ce._fn('Apply', [fn, ...cell]).evaluate({ numericApproximation })
        ),
        numericApproximation
      )
    )
  );
}

/**
 * The canonical form of a pipe STAGE that is a unary function literal: a
 * written literal with one parameter, or the shorthand spelling (a literal
 * with no parameter list whose body mentions exactly one placeholder, `_` or
 * `_1`, the first argument, the only one a pipe supplies), either one
 * possibly parenthesized (`Delimiter`). `undefined` for any other stage.
 * The literal is canonicalized in a fresh placeholder scope, so a global
 * named `_` or `_1` cannot capture its parameter.
 */
function pipeLiteralStage(
  ce: ComputeEngine,
  stage: Expression
): Expression | undefined {
  while (isFunction(stage, 'Delimiter') && stage.nops === 1) stage = stage.op1;
  if (!isFunction(stage, 'Function')) return undefined;
  if (stage.nops === 1) {
    // Only the FREE slots of the body count: a slot that a nested literal
    // binds is not a parameter of this stage (`freeAnonymousSlots`).
    const slots = freeAnonymousSlots(stage.op1);
    const usesUnderscore = slots.has('_');
    const usesFirst = slots.has('_1');
    if (usesUnderscore === usesFirst || slots.size !== 1) return undefined;
    // Give the shorthand literal its parameter explicitly.
    stage = ce._fn(
      'Function',
      [stage.op1, ce.symbol(usesUnderscore ? '_' : '_1', { canonical: false })],
      { canonical: false }
    );
  } else if (stage.nops !== 2) return undefined; // body + one parameter
  return canonicalWithFreshPlaceholders(stage);
}

/**
 * The value of a pipe whose stage is a unary function literal:
 * `Apply(stage, topic)`, which is `stage(topic)`. A function literal with
 * scalar (or tuple) parameters maps over a list topic at every rank, and
 * binds any other topic, or a collection parameter, whole, exactly as the
 * same literal called directly or under a name (`applyLiteralMaps`, user
 * decision 2026-09-26: the pipe route is consistent with them). Every such
 * stage takes this route, whatever the topic's static type, so a topic that
 * only becomes a list when evaluated (`g() |> x ↦ 0`) maps as `Apply` maps
 * it. It used to be `Map(stage, topic)`, which mapped one rank, mapped a
 * literal whose parameter is a collection (`xs |> x ↦ Length(x)`), and
 * mapped a set. Returns `undefined` when the stage is not such a literal,
 * or the topic is the written `Nothing` (erased by the caller).
 */
function pipeImplicitMap(
  ce: ComputeEngine,
  topic: Expression,
  stageForMap: Expression
): Expression | undefined {
  if (isSymbol(topic, 'Nothing')) return undefined;
  const stage =
    isFunction(stageForMap, 'Function') && stageForMap.isCanonical
      ? stageForMap
      : pipeLiteralStage(ce, stageForMap);
  if (!isFunction(stage, 'Function') || stage.nops !== 2) return undefined;
  return ce.function('Apply', [stage, topic]);
}

/**
 * The arity check on a pipe STAGE: a pipe hands its stage exactly one value,
 * always, so a stage whose parameter count is statically readable and never 1
 * can never be applied. Returns the `Error` to put in the stage's place, or
 * `undefined` when the arity fits or cannot be decided.
 *
 * This is the same reasoning that wires the collection operators into
 * `callbackArityError`, and it reuses that module's reading of an operand's
 * arity — but it is deliberately NOT that error:
 *
 * - a pipe stage is not a "callback". Nothing here is an operator-owned slot
 *   taking a helper function; `x |> f` is an application whose argument
 *   happens to be written to the left. `callback-arity`'s wording ("`Pipe`
 *   calls its callback with 1 argument") describes a mechanism the language
 *   does not have at this spelling, so the code is `pipe-stage-arity` and the
 *   sentence is about the pipe.
 * - the REMEDY differs, which is the practical half. A collection operator
 *   points at a tuple pattern, because its callback receives an element that
 *   may need taking apart. A pipe points at the CALL form — `xs |> Fold(f, 0,
 *   _)` — because that is how the language spells a stage with more than one
 *   argument (`src/epsil/docs/operators.md`, "Pipe"). Offering the
 *   tuple-pattern rewrite here would be wrong whenever the topic is not a
 *   collection of tuples, and the canonical handler cannot tell: the topic is
 *   a held, unbound operand at this point.
 *
 * The check reads the RAW stage, which is what `callbackArity` is built for:
 * a function literal is counted structurally and a symbol through
 * `lookupDefinition`, neither of which needs the held operand bound.
 */
function pipeStageArityError(stage: Expression): Expression | undefined {
  const arity = callbackArity(stage);
  if (arity === undefined) return undefined;
  if (arity.required <= 1 && arity.max >= 1) return undefined;

  // A symbol is quoted by NAME: `toString()` is the ASCII-math spelling, which
  // double-quotes a multi-character symbol and would read as a string inside
  // the sentence. (Same reasoning as `callbackArityError`.)
  const spelled = isSymbol(stage) ? stage.symbol : stage.toString();
  return stage.engine.error([
    'pipe-stage-arity',
    `A pipe passes its stage exactly 1 value; \`${spelled}\` ${declaresPhrase(
      arity
    )}. A stage that takes several arguments is written as a call, with \`_\` in the piped value's slot: \`xs |> Fold(f, 0, _)\``,
  ]);
}

/** The absence-admitting collection family top, the shape gate the implicit
 * `Map` of a pipe stage asks against: bare `collection` is the values-only
 * `collection<unknown>` synonym. */
const PIPE_COLLECTION_SHAPE_TYPE = parseType('collection<any>')!;

/**
 * The static type of a `Pipe` whose stage is a unary function literal, or
 * `undefined` when this derivation does not decide it (the caller then
 * falls back to the stage's result type).
 *
 * A pipe with such a stage is `Apply(stage, topic)` (`pipeImplicitMap`, user
 * decision 2026-09-26), so when the stage is CANONICAL — the canonical
 * handler canonicalizes a unary literal stage, and a chained topic — its
 * signature is known and the type is `Apply`'s own (`applyLiteralMapType`):
 * a list topic mapped at every rank, and `undefined` when the topic binds
 * whole (a set, a tuple, a string, a collection parameter).
 *
 * A RAW stage (a pipe read from a held form that was never canonicalized)
 * has no signature: the older derivation below types the mapping body over
 * the topic's element type and wraps it back in the topic's shape, through
 * `context.derive`, without canonicalizing anything.
 *
 * `Pipe` is `lazy` and its `canonical` handler leaves the TOPIC unbound, so
 * the topic's own type is `unknown` and its collection facts are undecided.
 * {@link heldOperandType} recovers a held operand's type from pure sources.
 */
function pipeImplicitMapType(
  context: TypeHandlerContext,
  topic: OperandDescriptor | undefined,
  stage: OperandDescriptor
): Type | undefined {
  if (topic === undefined) return undefined;
  const st = stage.structureOf?.();
  if (st?.kind !== 'function-literal') return undefined;

  const param = pipeStageParameter(st);
  if (param === undefined) return undefined;
  // A canonical stage (the canonical handler canonicalizes a unary literal
  // stage, and a chained topic) carries its signature: the pipe is
  // `Apply(stage, topic)` and is typed by `Apply`'s own rule, which maps a
  // list topic at every rank, binds a set, a tuple, a string or a
  // collection parameter whole, and keeps both shapes of a scalar-or-list
  // topic (`applyLiteralMapType`). `undefined` there means the topic binds
  // whole: the pipe then takes the stage's result type.
  const sig = stage.type;
  if (typeof sig === 'object' && sig.kind === 'signature')
    return applyLiteralMapType(
      stage,
      [describeType(heldOperandType(context, topic))],
      context
    );

  const topicType = heldOperandType(context, topic);
  if (isSubtype(topicType, 'string')) return undefined;
  if (!(
    topic.facts.collection === true ||
    isSubtype(topicType, PIPE_COLLECTION_SHAPE_TYPE)
  ))
    return undefined;
  if (param.annotated !== undefined && isSubtype(topicType, param.annotated))
    return undefined;

  const elementType =
    topic.facts.elementType ?? collectionElementType(topicType) ?? 'unknown';
  // Once the stage is known to map, the result is ALWAYS the mapped
  // collection: a body the structural derivation cannot type (a literal, a
  // tuple, a list, a nested function literal) takes the stage's own
  // declared result type as its cell, and `unknown` when there is none.
  const cell =
    pipeStageBodyType(context, st.body, param.name, elementType) ??
    functionResult(stage.type) ??
    'unknown';
  return pipeMapResultType(topicType, cell);
}

/**
 * The static type of a `Pipe` whose stage is a raw APPLICATION mentioning
 * the topic placeholder — `xs |> Take(_, 2)`, `xs |> Fold(f, 0, _)`, and,
 * on the LaTeX route, the operator shorthand `[1, 2, 3] |> \_^2`, which
 * that parser leaves as the application `Power(_, 2)` (the Epsil parser
 * wraps it as a function literal, the mapped case above). Returns
 * `undefined` for any other stage, and for a stage this derivation cannot
 * type; the pipe then keeps the stage's declared result type, or `unknown`.
 * Without this, `[1, 2, 3] |> \_^2` typed `unknown` while it evaluates to
 * a `vector<integer^3>`.
 *
 * The evaluate route lifts the stage into a function literal whose
 * parameter type is inferred from the body, binds the piped value to it,
 * and applies it. A parameter the body uses as a SCALAR (`_^2`, `_ + 1`)
 * broadcasts over a collection argument element-wise, all the way down:
 * `[[1, 2], [3, 4]] |> \_^2` is `[[1, 4], [9, 16]]`, where the matrix
 * power `M^2` would be the product. A parameter the body hands to a
 * whole-collection operator (`Length(_)`, `Take(_, 2)`, `Add(Length(_), 1)`)
 * is inferred a collection and bound whole. So:
 *
 * - when the placeholder reaches the head through BROADCASTABLE operators
 *   only, the pipe is typed like the mapped stage: the body over the topic's
 *   scalar ELEMENT type, wrapped back in the topic's collection shape;
 * - otherwise the body is typed over the topic's whole type, the derivation
 *   `pipeStageBodyType` performs for the mapped case with the topic in the
 *   place of its element; an inner broadcastable application over the
 *   placeholder (`Length(_^2)`) is lifted by the derivation itself.
 *
 * Left undecided: a top-typed topic, which gives the body nothing to type
 * against (the derivation would answer a handler's fallback for an unknown
 * operand); a tuple topic, which broadcasts component-wise through a scalar
 * head in a shape the mapped typing does not name; and a nested list under a
 * broadcastable head, whose per-row cell does not fit the topic's full
 * shape.
 *
 * Only `_` and `_1` name the first argument, the one a pipe supplies; a
 * stage mentioning another placeholder, or several, is not decided here.
 */
function pipeShorthandApplicationType(
  context: TypeHandlerContext,
  topic: OperandDescriptor | undefined,
  stage: OperandDescriptor
): Type | undefined {
  if (topic === undefined) return undefined;
  const st = stage.structureOf?.();
  if (st?.kind !== 'application') return undefined;
  const placeholders = new Set<string>();
  collectPlaceholderNames(st, placeholders);
  if (placeholders.size !== 1) return undefined;
  const name = [...placeholders][0];
  if (name !== '_' && name !== '_1') return undefined;

  const topicType = heldOperandType(context, topic);
  if (topicType === 'unknown' || topicType === 'any') return undefined;
  if (isTupleShapedType(topicType)) return undefined;
  const collectionTopic =
    topic.facts.collection === true ||
    isSubtype(topicType, PIPE_COLLECTION_SHAPE_TYPE);
  if (!collectionTopic || isSubtype(topicType, 'string'))
    return pipeStageBodyType(context, st, name, topicType);

  if (
    isBroadcastableHead(context, st.head) &&
    placeholderUnderBroadcastableHeads(context, st, name)
  ) {
    const elementType =
      topic.facts.elementType ?? collectionElementType(topicType) ?? 'unknown';
    // An element that is itself a collection (a nested list) is not typed
    // here: the map re-wraps the cell in the topic's full shape, which a
    // per-row cell does not fit.
    if (!isSubtype(elementType, 'number')) return undefined;
    const cell = pipeStageBodyType(context, st, name, elementType);
    return cell === undefined ? undefined : pipeMapResultType(topicType, cell);
  }
  return pipeStageBodyType(context, st, name, topicType);
}

/** Whether the operator named `head` broadcasts element-wise over a
 * collection operand. */
function isBroadcastableHead(
  context: TypeHandlerContext,
  head: string
): boolean {
  return (
    context.engine.lookupDefinition(head)?.operator?.broadcastable === true
  );
}

/**
 * Whether every application between `st`'s head and each occurrence of the
 * placeholder `name` has a broadcastable head, so that the lifted stage's
 * parameter is used as a scalar and a collection bound to it broadcasts. An
 * operand that does not mention the placeholder does not matter.
 */
function placeholderUnderBroadcastableHeads(
  context: TypeHandlerContext,
  st: OperandStructure & { kind: 'application' },
  name: string
): boolean {
  return st.children.every((child) => {
    const cs = child.structureOf?.();
    if (cs?.kind === 'symbol') return true;
    const inner = new Set<string>();
    collectPlaceholderNames(cs, inner);
    if (!inner.has(name)) return true;
    return (
      cs?.kind === 'application' &&
      isBroadcastableHead(context, cs.head) &&
      placeholderUnderBroadcastableHeads(context, cs, name)
    );
  });
}

/**
 * The single parameter of a pipe stage, or `undefined` when the stage is not
 * unary.
 *
 * A written parameter (`x ↦ x^2`) is in the literal's parameter list. The
 * SHORTHAND spelling (`_^2`, `_1^2`) has an empty parameter list until
 * canonicalization supplies one, so the placeholders mentioned in the body
 * are counted instead: exactly one distinct placeholder makes the stage
 * unary, and only `_`/`_1` name the FIRST argument, which is the only one a
 * pipe supplies.
 */
function pipeStageParameter(
  st: OperandStructure & { kind: 'function-literal' }
): { name: string; annotated?: Type } | undefined {
  if (st.parameters.length === 1) return st.parameters[0];
  if (st.parameters.length > 1) return undefined;
  const placeholders = new Set<string>();
  collectPlaceholderNames(st.body, placeholders);
  if (placeholders.size !== 1) return undefined;
  const name = [...placeholders][0];
  return name === '_' || name === '_1' ? { name } : undefined;
}

/** Every shorthand placeholder symbol (`_`, `_1`, `_2`, …) mentioned in a
 * stage body, without descending into a nested function literal, whose own
 * placeholders belong to it. */
function collectPlaceholderNames(
  structure: OperandStructure | undefined,
  out: Set<string>
): void {
  if (structure === undefined) return;
  switch (structure.kind) {
    case 'symbol':
      if (/^_[0-9]*$/.test(structure.name)) out.add(structure.name);
      return;
    case 'application':
      for (const c of structure.children)
        collectPlaceholderNames(c.structureOf?.(), out);
      return;
    case 'tuple':
    case 'list-literal':
      for (const c of structure.elements)
        collectPlaceholderNames(c.structureOf?.(), out);
      return;
    default:
      return;
  }
}

/**
 * The type of a mapping body with its parameter bound to `elementType`, or
 * `undefined` when the body has no derivable type here — a body that is
 * neither an application, the parameter itself, a symbol with a declared
 * type, nor a tuple or list of such bodies. The caller then falls back on
 * the stage's declared result type.
 */
function pipeStageBodyType(
  context: TypeHandlerContext,
  body: OperandStructure,
  param: string,
  elementType: Type
): Type | undefined {
  if (body.kind === 'symbol') {
    if (body.name === param) return elementType;
    const t = context.engine.lookupDefinition(body.name)?.value?.type.type;
    return t === undefined || t === 'unknown' ? undefined : t;
  }
  if (body.kind === 'string') return 'string';
  if (body.kind === 'tuple' || body.kind === 'list-literal') {
    // A composite body's type is a stored contract: a number literal cell
    // contributes its tier, never its literal type (`storedComponentTypeD`),
    // and only a non-literal cell is typed with the parameter bound.
    const cells = body.elements.map((e) => {
      const s = e.structureOf?.();
      return s?.kind === 'number'
        ? s.tier
        : bindStageParameter(context, e, param, elementType).type;
    });
    if (body.kind === 'tuple')
      return { kind: 'tuple', elements: cells.map((type) => ({ type })) };
    return { kind: 'list', elements: widen(...cells) };
  }
  if (body.kind !== 'application') return undefined;
  // A canonical literal wraps its body in a one-statement `Block` (the pipe
  // canonicalizes a literal stage): the body is that statement.
  if (body.head === 'Block' && body.children.length === 1) {
    const inner = body.children[0].structureOf?.();
    if (inner !== undefined)
      return pipeStageBodyType(context, inner, param, elementType);
  }
  return context.derive(
    body.head,
    body.children.map((c) => bindStageParameter(context, c, param, elementType))
  );
}

/**
 * The descriptor of an application re-derived from substituted children:
 * its type is the derived type, and it is CLOSED exactly when every child
 * is (a handler that widens a closed operand at a possible pole, such as the
 * circular reciprocals at `π/2`, must see that a constant body stays
 * constant after substitution).
 */
function describeDerived(
  type: Type,
  children: ReadonlyArray<OperandDescriptor>
): OperandDescriptor {
  const closed: Tri = children.every((c) => c.facts.closed === true)
    ? true
    : children.some((c) => c.facts.closed === false)
      ? false
      : undefined;
  return describeType(type, closed);
}

/**
 * `d` with every free occurrence of the stage parameter replaced by an
 * operand of the element type. A nested application is re-derived from its
 * substituted children, so the substitution reaches any depth; a nested
 * function literal is left as it stands, since its own parameters shadow.
 */
function bindStageParameter(
  context: TypeHandlerContext,
  d: OperandDescriptor,
  param: string,
  elementType: Type
): OperandDescriptor {
  const s = d.structureOf?.();
  if (s?.kind === 'symbol')
    return s.name === param
      ? describeBoundSymbol(elementType, param)
      : d.type === 'unknown'
        ? describeType(heldOperandType(context, d))
        : d;
  if (s?.kind === 'application') {
    const children = s.children.map((c) =>
      bindStageParameter(context, c, param, elementType)
    );
    return describeDerived(
      context.derive(s.head, children) ?? 'unknown',
      children
    );
  }
  return d;
}

/**
 * The type of a HELD operand — one a `lazy` operator received unbound, whose
 * descriptor therefore carries `unknown` where a bound operand would carry a
 * real type.
 *
 * Every branch is a pure read: a symbol's own binding through
 * `lookupDefinition`, a literal's structural view, an application's derived
 * type. An operand that already carries a type (the `ce.function` route boxes
 * its arguments first) is reported as it stands.
 */
function heldOperandType(
  context: TypeHandlerContext,
  d: OperandDescriptor | undefined
): Type {
  if (d === undefined) return 'unknown';
  if (d.type !== 'unknown') return d.type;
  const s = d.structureOf?.();
  if (s === undefined) return 'unknown';
  switch (s.kind) {
    case 'symbol': {
      const def = context.engine.lookupDefinition(s.name);
      if (def?.value !== undefined) return def.value.type.type;
      if (def?.operator !== undefined) return def.operator.signature.type;
      return 'unknown';
    }
    case 'string':
      return 'string';
    case 'number':
    case 'function-literal':
      return d.type;
    // A held tuple or list literal is typed as a stored contract: a number
    // literal component contributes its tier, never its literal type
    // (`storedComponentTypeD`); any other component is typed as a held
    // operand in its own right.
    case 'tuple':
      return {
        kind: 'tuple',
        elements: s.elements.map((e) => ({
          type: heldComponentType(context, e),
        })),
      };
    case 'list-literal': {
      let elements: Type = widen(
        ...s.elements.map((e) => heldComponentType(context, e))
      );
      // A shape of rank r > 1 (`[[1, 2], [3, 4]]` is 2×2) puts the LEAF type
      // in `elements`: the components are rows, so descend r − 1 ranks. The
      // row type in a 2×2 shape counted the inner rank twice
      // (`list<vector<integer^2>^(2x2)>`).
      for (let k = 1; k < s.shape.length; k++)
        elements = collectionElementType(elements) ?? 'unknown';
      return s.shape.length > 0
        ? { kind: 'list', elements, dimensions: [...s.shape] }
        : { kind: 'list', elements };
    }
    case 'application':
      return context.derive(s.head, s.children) ?? 'unknown';
  }
}

/** The type a component of a HELD tuple or list literal contributes to the
 * literal's stored type: a number literal's tier, otherwise the component's
 * own held-operand type. */
function heldComponentType(
  context: TypeHandlerContext,
  d: OperandDescriptor
): Type {
  const s = d.structureOf?.();
  return s?.kind === 'number' ? s.tier : heldOperandType(context, d);
}

/**
 * A mapped collection's type: the source's shape carrying the mapping's
 * result as its element type. Mirrors the shaping `Map`'s own type handler
 * performs (`mapResultType`, `library/collections.ts`): a dimensioned list
 * keeps its dimensions, an index span yields a `list` (a `range` is
 * unparameterized, its elements are indices by definition, and a mapped
 * span is no longer a span), a string yields a `list` even for a
 * character-valued mapping, and anything else yields a plain `collection`.
 */
function pipeMapResultType(source: Readonly<Type>, elementType: Type): Type {
  if (typeof source === 'string') {
    if (source === 'list' || source === 'string' || source === 'range')
      return { kind: 'list', elements: elementType };
    if (source === 'set') return { kind: 'set', elements: elementType };
    if (source === 'indexed_collection' || source === 'collection')
      return { kind: source, elements: elementType };
    return { kind: 'collection', elements: elementType };
  }
  if (source.kind === 'list')
    return source.dimensions !== undefined
      ? { kind: 'list', elements: elementType, dimensions: source.dimensions }
      : { kind: 'list', elements: elementType };
  if (
    source.kind === 'indexed_collection' ||
    source.kind === 'set' ||
    source.kind === 'collection'
  )
    return { kind: source.kind, elements: elementType };
  return { kind: 'collection', elements: elementType };
}

/**
 * The operator definition an operand of `Signature` names, resolved on EVERY
 * route.
 *
 * `Signature` is `lazy` and has no `canonical` handler, so its operand arrives
 * UNBOUND on the `ce.box`/parse routes (the held-operand trap in CLAUDE.md):
 * reading `.operatorDefinition` off it answers `undefined` there, and only the
 * `ce.function` route — which boxes its arguments before the call — worked.
 * The name is therefore looked up directly when the operand is an unbound
 * symbol.
 *
 * `.canonical` would bind it too, but at the cost of a scope side effect: it
 * DECLARES an unknown symbol, so `Signature(nosuchthing)` would leave a
 * declaration behind. A lookup is read-only.
 */
function operatorDefinitionOfHeldSymbol(
  ce: ComputeEngine,
  x: Expression | undefined
): BoxedOperatorDefinition | undefined {
  if (x === undefined) return undefined;
  if (x.operatorDefinition) return x.operatorDefinition;
  if (!isSymbol(x)) return undefined;
  const def = ce.lookupDefinition(x.symbol);
  return def && 'operator' in def ? def.operator : undefined;
}

/** The symbol names named by a `HoldValues` subset spec: a single symbol,
 * or the symbol members of a `List`/`Set`/`Tuple`. Non-symbol members are
 * ignored. */
function holdValuesShieldNames(spec: Expression): string[] {
  if (isSymbol(spec)) return [spec.symbol];
  if (
    isFunction(spec, 'List') ||
    isFunction(spec, 'Set') ||
    isFunction(spec, 'Tuple')
  ) {
    const names: string[] = [];
    for (const op of spec.ops) if (isSymbol(op)) names.push(op.symbol);
    return names;
  }
  return [];
}

/**
 * Whether a partially evaluated `WithRandomSeed` body still depends on its
 * seed frame. A surviving node participates when it draws from the stream,
 * delimits a nested seed frame, or reads the frame for an estimator. General
 * impurity does not count, and an `any` effect does not pin a frame forever.
 *
 * Quoted content is inert. A lazy collection returned as a completed value
 * draws when it is materialized, so its body is skipped; beneath any other
 * surviving eager application, function bodies are scanned because that work
 * was expected to finish during the current evaluation. The cells of a
 * literal container (a list, a tuple, a dictionary — `valueContainerCells`)
 * keep the position of the container itself.
 */
function hasPendingImpureApplication(
  expr: Expression,
  underEagerSurvivor = false
): boolean {
  if (!isFunction(expr)) {
    // A canonical dictionary is not an application, but it is a literal
    // container: each of its values keeps the position of the dictionary.
    // `{"a" -> ListFrom(Map(u ↦ Random(), Range(1, n)))}` with `n` unbound
    // still owes its draws to the frame, while `{"a" -> Map(u ↦ Random(),
    // xs)}` returns a lazy view that draws at materialization. A dictionary
    // never invokes a value, so a `Function` literal stored in it is a
    // completed value — the same rule as a non-invoking position below.
    const cells = valueContainerCells(expr);
    return (
      cells !== undefined &&
      cells.some(
        (cell) =>
          !isFunction(cell, 'Function') &&
          hasPendingImpureApplication(cell, underEagerSurvivor)
      )
    );
  }
  const h = expr.operator;
  const def = operatorDefinitionOf(expr);
  // A quote position is never evaluated by its operator, so nothing beneath it
  // is owed to this frame.
  if (def?.holdClass === 'quote') return false;
  if (h === 'Function' && !underEagerSurvivor) return false;
  // Modes 1–3. `drawsRandom` covers an explicit `random` label, the frame
  // protocol of a nested `WithRandomSeed`, and the inference's
  // positively-observed-draw bridge for a symbol-headed application whose
  // effect set collapsed to `any`; `readsRandomFrame` is the reader mode — an
  // estimator that could not finish (`NIntegrate(f, 0, n)` with `n` unbound)
  // would otherwise be completed later against a live stream, the same silent
  // seeded→unseeded conversion for estimates that item 104 fixed for draws.
  if (def?.drawsRandom === true || def?.readsRandomFrame === true) return true;
  // Value position propagates through a lazy view and through the literal
  // containers; every other surviving application puts its whole subtree —
  // lambdas included — in eager-survivor position. The container set is the
  // one `valueContainerCells` defines, shared with the effect channel's
  // frame-escape classifier so the two readings of §2 cannot drift.
  const isValueNode =
    !underEagerSurvivor &&
    (expr.isLazyCollection || valueContainerCells(expr) !== undefined);
  const under = underEagerSurvivor || !isValueNode;
  // Mode 1, the LATENT half: a surviving application that INVOKES a
  // function-valued operand which draws (`Map(randomF, xs)` beneath an
  // unfinished consumer, `Apply(randomF, x)`) still owes those draws. Only in
  // eager-survivor position: a lazy view in VALUE position draws at
  // materialization instead (§6), which is the same reason its `Function`
  // subtree is skipped above. The node's own effects, not its subtree's — the
  // recursion below is what visits the operands, with these exceptions.
  if (
    under &&
    hasDeclaredEffectLabel(shallowApplicationEffects(expr), 'random')
  )
    return true;
  // A binder lazy view in value position: only the clause operands are
  // scanned; the body is per-element work performed at materialization.
  if (!under && expr.isLazyCollection) {
    const clauses = binderClauseOperands(expr);
    if (clauses)
      return expr.ops.some(
        (op, i) => clauses.has(i) && hasPendingImpureApplication(op, under)
      );
  }
  return expr.ops.some((op, i) => {
    // A function LITERAL in a NON-INVOKING position is a completed value, not
    // work this evaluation owed the frame: the operator stores, selects or
    // returns it (`If(c, x ↦ Random(), …)`, `Block(x ↦ Random())`,
    // `List(x ↦ Random())`), so its body draws at whatever later APPLIES it,
    // under whatever frame is active then — the same §6 value-position ruling
    // that skips a lazy view's `Function` subtree above. Without this, the
    // walk contradicted the projection channel and split on spelling: a
    // named callback (`If(c, rf, …)`) released the frame while the very same
    // lambda written inline pinned it.
    //
    // Deliberately narrow. It applies only to a `Function` VALUE: an
    // application operand in the same position keeps scanning, because a
    // non-invoking operator still EVALUATES it under itself
    // (`If(c, Random(), 0)`, a `Block` statement). And it applies only where
    // the definition says the position does not invoke: `invokesAt` defaults
    // TRUE for a missing map index, and an unresolved head has no definition
    // at all, so both fall through to the conservative descend — which is
    // what keeps the item-104 case (`ListFrom(Map(x ↦ Random(), u))`) pinned.
    if (def?.invokesAt(i) === false && isFunction(op, 'Function')) return false;
    return hasPendingImpureApplication(op, under);
  });
}

/**
 * The operand indices of a binder node that are its CLAUSES — the operands
 * carrying the syntactic bound variables the node declares. Everything else
 * is body. `undefined` when the node is not a binder with syntactic bound
 * variables (a plain `scoped: true` operator, or any non-binder).
 */
function binderClauseOperands(
  expr: Expression & FunctionInterface
): Set<number> | undefined {
  const sites = expr.operatorDefinition?.bindingSites?.(expr.ops, 'post');
  if (sites === undefined || sites.length === 0) return undefined;
  return new Set(sites.map((site) => site.path[0]));
}

// The Unicode White_Space property, spelled out code point by code point so
// the definition of "whitespace" used by `StringSplit` does not depend on
// the host's interpretation of `\s`:
// U+0009..U+000D (tab, LF, VT, FF, CR), U+0020 (space), U+0085 (NEL),
// U+00A0 (no-break space), U+1680 (Ogham space mark), U+2000..U+200A
// (en quad..hair space), U+2028 (line sep), U+2029 (para sep), U+202F
// (narrow no-break space), U+205F (medium mathematical space),
// U+3000 (ideographic space).
const UNICODE_WHITESPACE =
  /[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/;

// True when the whole of `c` — one user-perceived character (grapheme
// cluster) — is Unicode White_Space. `UNICODE_WHITESPACE` above matches RUNS
// of whitespace because it is used as a `String.split` separator; the trim
// operators need the same set as a per-character test, so the code points are
// shared by construction rather than repeated.
const UNICODE_WHITESPACE_CHARACTER = new RegExp(
  `^(?:${UNICODE_WHITESPACE.source})$`
);

/**
 * The text of `op` when it is a string or a character, otherwise `undefined`.
 *
 * A character is accepted wherever a string is: a character and the
 * one-character string with the same content are the same value (`isSame`
 * treats them as equal), so a string operator reads a character operand's
 * text exactly as it reads a string's, and its result is the result for the
 * one-character string.
 */
function textOf(op: Expression | undefined): string | undefined {
  return isString(op) || isCharacter(op) ? op.string : undefined;
}

/** True when `op` is a string or a character, the operands `textOf` reads. */
function isText(op: Expression): boolean {
  return isString(op) || isCharacter(op);
}

/**
 * The error for an absent element (`Missing`, or `Undefined`, which a list
 * types as a `missing` cell) that a text operator reads from a collection of
 * text values: `StringJoin`'s operand, the `chars` set of `Trim`.
 *
 * Argument validation admits a collection typed `collection<string |
 * missing>` at a `collection<string | character>` parameter (a `Map` over
 * dictionary lookups is typed so, although every lookup may succeed), so the
 * check that each element exists is made here, when the element is read. The
 * error is the one a scalar absent operand of a text operator gets:
 * `ToUpperCase(Missing)` is "expected `character | string`, got `missing`".
 */
function absentTextElementError(element: Expression): Expression {
  return element.engine.typeError(
    { kind: 'union', types: ['character', 'string'] },
    'missing',
    element
  );
}

/**
 * The set of characters that `Trim`/`TrimStart`/`TrimEnd` strip, decoded from
 * the optional second operand.
 *
 * - `null`: no operand was given — the caller uses the default Unicode
 *   White_Space set (`UNICODE_WHITESPACE_CHARACTER`).
 * - a `Set`: the characters to strip. A STRING operand means the SET OF ITS
 *   CHARACTERS, never a literal substring (`Trim("xxhixx", "x")` and
 *   `Trim("xyhiyx", "xy")` both strip any mix of those characters); a
 *   collection operand contributes each of its elements' characters.
 * - `undefined`: the operand is neither text nor a finite collection of text,
 *   so the caller leaves the expression unevaluated (the house rule for a
 *   non-string operand of a string operator).
 * - an error: an element of the collection is absent, and the caller answers
 *   this error (`absentTextElementError`).
 */
function trimCharacterSet(
  chars: Expression | undefined
): Set<string> | null | undefined | Expression {
  if (chars === undefined) return null;
  if (isString(chars) || isCharacter(chars))
    return new Set(splitGraphemeClusters(chars.string));
  if (!chars.isCollection || !isWalkableFiniteCollection(chars))
    return undefined;
  const set = new Set<string>();
  for (const c of chars.each()) {
    // An absent element is an error that names it, which the caller returns
    // — see `absentTextElementError`.
    if (isAbsentSymbol(c)) return absentTextElementError(c);
    if (!isString(c) && !isCharacter(c)) return undefined;
    for (const g of splitGraphemeClusters(c.string)) set.add(g);
  }
  return set;
}

/**
 * `s` with the leading (`start`) and/or trailing (`end`) characters that
 * belong to `set` removed. Trimming walks GRAPHEME CLUSTERS, so it can never
 * cut a cluster in half; `set === null` selects the default Unicode
 * White_Space set.
 */
function trimClusters(
  s: string,
  set: Set<string> | null,
  start: boolean,
  end: boolean
): string {
  const cs = splitGraphemeClusters(s);
  const strip = (c: string): boolean =>
    set === null ? UNICODE_WHITESPACE_CHARACTER.test(c) : set.has(c);
  let i = 0;
  let j = cs.length;
  if (start) while (i < j && strip(cs[i])) i += 1;
  if (end) while (j > i && strip(cs[j - 1])) j -= 1;
  return cs.slice(i, j).join('');
}

/**
 * `s` padded to `n` characters by repeating `pad`, with the padding placed at
 * the start (`atStart`) or the end. The padding is built from `pad`'s own
 * grapheme clusters, cycled, so the final copy ends on a character boundary
 * (`PadStart("a", 4, "xy")` is `"xyxa"`). The caller has already
 * rejected an empty `pad` and a negative or non-integer `n`.
 *
 * The pieces are concatenated once and the result
 * is segmented afresh, so a pad whose last character combines with `s`'s
 * first character can yield fewer than `n` characters. That is inherent to
 * joining text, not a defect.
 */
function padClusters(
  s: string,
  n: number,
  pad: string,
  atStart: boolean
): string {
  const cs = splitGraphemeClusters(s);
  if (cs.length >= n) return s;
  const ps = splitGraphemeClusters(pad);
  const fill: string[] = [];
  for (let i = 0; i < n - cs.length; i += 1) fill.push(ps[i % ps.length]);
  return atStart ? fill.join('') + s : s + fill.join('');
}

/**
 * `a` compared to `b` as NFC Unicode scalar sequences, code point by code
 * point: `-1`, `0` or `1`. This is not JavaScript `<` on strings: `<` compares
 * UTF-16 code units, which sorts every astral character (U+10000 and above,
 * encoded as a surrogate pair starting at U+D800) below U+E000–U+FFFF. The two orders
 * therefore differ only for an astral character against one in
 * U+E000–U+FFFF; `<` is left as it is, and `StringCompare` is the operator
 * that answers the scalar order.
 */
function compareScalarSequences(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  if (a.length === b.length) return 0;
  return a.length < b.length ? -1 : 1;
}

// The grammar `NumberFrom(s)` accepts for a base-10 numeral: an optional sign,
// then ASCII digits with an optional `.` fraction and an
// optional `e`/`E` exponent. ASCII digits ONLY — other Unicode decimal digits
// are rejected, since silently accepting them invites homoglyph confusion.
// The integer part is optional when a fraction is present, so
// `".5"`, `"-.5"` and `".5e2"` are accepted and mean 0.5, -0.5 and 50 — the
// leading-zero-less spelling is common in hand-entered data and denotes
// exactly one number. A trailing dot with no fraction digits (`"5."`) is
// rejected: it carries no information the bare `"5"` does not, and accepting
// it would mean accepting a numeral whose last character is a separator with
// nothing after it, which is far more often a truncation than an intent.
//
// Anchored, so a numeric prefix such as `"12abc"` is a rejection, never a
// partial parse the way `parseFloat` would read it.
const NUMBER_FROM_DECIMAL =
  /^[+-]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/;

// An integer numeral for `NumberFrom(s, base)`: an optional sign then
// alphanumeric digits. Whether each digit belongs to the requested base is
// decided by `fromDigits`, which reports the first one that does not.
//
// A leading `0x`/`0b` is rejected (the negative lookahead). `fromDigits`
// treats those two spellings as a radix prefix that overrides the base it was
// handed — `fromDigits("0x10", 10)` is 16, not 0 — and here the `base`
// operand is the only authority on the radix, so a numeral that looks like a
// prefix cannot be read at all. This also matches the base-less form, which
// rejects `"0x1f"` outright. The cost is that a numeral such as `"0b1"`,
// legitimate in base 12 and above, is refused rather than misread; there is
// no spelling that reads it correctly today, so refusing is the honest
// answer. Both cases are excluded, since `"0X10"` reads as a prefix to a
// human even though `fromDigits` only special-cases the lowercase spelling.
const NUMBER_FROM_BASE_INTEGER = /^[+-]?(?!0[xXbB])[0-9a-zA-Z]+$/;

// The `base` operand of `NumberFrom`/`DigitsFrom` may be written as a STRING
// (`NumberFrom("101", "2")`). That string is a numeral for the base itself,
// so it must be read whole: `Number.parseInt` accepts a numeric prefix and
// would silently read `"16abc"` as base 16. Text that is not entirely ASCII
// digits yields `NaN` here, which is what makes the caller's
// `unexpected-base` error fire.
function baseFromString(s: string): number {
  const text = s.trim();
  if (!/^[0-9]+$/.test(text)) return NaN;
  return Number.parseInt(text, 10);
}

//
// ─── Random domains ─────────────────────────────────────────────────────────
//
// `Random` and `RandomChoice` share one domain analysis. Domain validity is
// decided by kind, never by `count`: a bounded `Interval` reports
// `count: Infinity` (and `Interval(1,0)`/`Interval(1,1)` do too, though they
// are empty), so a count test would silently draw from a degenerate interval.
//
// Validation completes before the first draw, so an invalid domain consumes
// zero draws.
//

/** How `Random`/`RandomChoice` draw from a domain, once its kind is known. */
type RandomDomainPlan =
  /** An invalid domain: a structured error, ready to return. */
  | { kind: 'error'; error: Expression }
  /** The domain is not resolved (an unassigned symbol…): stay symbolic. */
  | { kind: 'symbolic' }
  /** A bounded, non-empty `Interval`: draws are `lo + u·(hi − lo)`, `[lo, hi)`.
   * Endpoint open/closed markers are ignored — a float draw cannot respect an
   * open endpoint. */
  | { kind: 'continuous'; lo: number; hi: number }
  /** A finite, non-empty `Range`: draws are `first + step·⌊u·n⌋` over the
   * range's NORMALIZED parameters (`range()` in `collections.ts`). */
  | { kind: 'arithmetic'; first: number; step: number; n: number }
  /** A finite, non-empty indexed collection: draws are `xs.at(1 + ⌊u·n⌋)`.
   * NEVER materialized. */
  | { kind: 'indexed'; xs: Expression; n: number }
  /** A finite, non-empty non-indexed collection (a `Set`…): the count is
   * obtained first (consuming no draws), then the drawn positions are picked
   * out by a single `each()` pass. */
  | { kind: 'sequential'; xs: Expression; n: number };

/** An `out-of-range` error naming the offending domain kind. */
function randomDomainError(
  ce: ComputeEngine,
  expected: string,
  domain: Expression
): RandomDomainPlan {
  return {
    kind: 'error',
    error: ce.error(['out-of-range', expected, domain.toString()]),
  };
}

/**
 * Count a collection whose `count` is not directly available, by ONE pass over
 * `each()`. Counting consumes no random draws (CE collections are re-iterable
 * views), which is what lets `Random`/`RandomChoice` promise a fixed number of
 * draws on a non-indexed domain instead of reservoir-sampling.
 *
 * Returns `undefined` past `MAX_RANDOM_ELEMENT_COUNT` — an unbounded pass is
 * an uncatchable hang, so refuse rather than walk it.
 */
function countByTraversal(
  ce: ComputeEngine,
  xs: Expression
): number | undefined {
  let n = 0;
  for (const _x of xs.each()) {
    if ((n & 0x3ff) === 0) checkDeadline(ce._deadlineFrame);
    n += 1;
    if (n > MAX_RANDOM_ELEMENT_COUNT) return undefined;
  }
  return n;
}

/** Classify a `Random`/`RandomChoice` domain operand. */
function analyzeRandomDomain(
  ce: ComputeEngine,
  domain: Expression
): RandomDomainPlan {
  // 1. `Interval` — a closed form, short-circuited before any collection
  //    machinery. Endpoints must be finite reals spanning a non-zero width;
  //    neither `count` nor `isEmptyCollection` decides that (see below).
  if (isFunction(domain, 'Interval')) {
    const int = interval(domain);
    // Symbolic endpoints: stay symbolic rather than claim an error.
    if (!int) return { kind: 'symbolic' };
    if (!Number.isFinite(int.start) || !Number.isFinite(int.end))
      return randomDomainError(ce, 'a bounded Interval', domain);
    // A continuous draw needs positive WIDTH, which is a different question
    // from set-emptiness: `Interval(1, 1)` is the non-empty set {1}, and its
    // `contains(1)` says so, but draws come from the half-open span
    // `[start, end)`, which is empty when the endpoints coincide — no uniform
    // distribution exists on it. Reading `isEmptyCollection` here worked only
    // while that handler wrongly called `[1, 1]` empty. This is the same test
    // the compiled path applies (`domainInterval` in
    // `compilation/javascript-target.ts` checks `!(hi > lo)`), so interpreter
    // and compiler agree.
    if (!(int.start < int.end))
      return randomDomainError(ce, 'a non-empty Interval', domain);
    return { kind: 'continuous', lo: int.start, hi: int.end };
  }

  // 2. `Range` — closed form over the normalized `(first, step, count)`.
  //    `range()` already infers a descending step for `Range(7, 2)` and
  //    reports an empty range for a zero or sign-mismatched step.
  if (isFunction(domain, 'Range')) {
    const n = smallCount(domain);
    // Symbolic bounds (e.g. `Range(1, n)`): the count is indeterminate.
    if (n === undefined) return { kind: 'symbolic' };
    if (!Number.isFinite(n))
      return randomDomainError(ce, 'a finite Range', domain);
    if (n === 0) return randomDomainError(ce, 'a non-empty Range', domain);
    const [first, , step] = range(domain);
    return { kind: 'arithmetic', first, step, n };
  }

  // A domain that is not (yet) a resolved collection — an unassigned symbol
  // of collection type, an error operand — stays symbolic.
  if (!domain.isCollection) return { kind: 'symbolic' };

  if (domain.isFiniteCollection === false)
    return randomDomainError(ce, 'a finite collection', domain);

  // A collection whose elements cannot be computed (`Linspace(a, 1, 3)` with
  // a symbolic `a`) can know its count, but it has no element to choose: a
  // positional read or a walk of it gives nothing. It stays symbolic.
  if (domain.isEnumerableCollection === false) return { kind: 'symbolic' };

  if (domain.isIndexedCollection) {
    const n = smallCount(domain);
    if (n === undefined) return { kind: 'symbolic' };
    if (!Number.isFinite(n))
      return randomDomainError(ce, 'a finite collection', domain);
    if (n === 0) return randomDomainError(ce, 'a non-empty collection', domain);
    return { kind: 'indexed', xs: domain, n };
  }

  // Non-indexed: the count when it is known, otherwise ONE counting pass.
  // A count that is not a safe integer (a `bigint`) is far above the limit
  // that the counting pass applies, so the domain is refused without the
  // pass.
  const count = domain.count;
  if (typeof count === 'bigint')
    return randomDomainError(
      ce,
      `a collection of at most ${MAX_RANDOM_ELEMENT_COUNT} elements`,
      domain
    );
  let n = count;
  if (n === undefined || !Number.isFinite(n)) n = countByTraversal(ce, domain);
  if (n === undefined)
    return randomDomainError(
      ce,
      `a collection of at most ${MAX_RANDOM_ELEMENT_COUNT} elements`,
      domain
    );
  if (n === 0) return randomDomainError(ce, 'a non-empty collection', domain);
  return { kind: 'sequential', xs: domain, n };
}

/** The element of `plan` selected by the uniform `u` ∈ [0, 1), for every plan
 * kind that can be indexed in O(1). `sequential` is handled by its callers,
 * which batch their positions into a single traversal. */
function selectRandomElement(
  ce: ComputeEngine,
  plan: RandomDomainPlan,
  u: number
): Expression | undefined {
  if (plan.kind === 'continuous')
    return ce.number(plan.lo + u * (plan.hi - plan.lo));
  if (plan.kind === 'arithmetic')
    return ce.number(plan.first + plan.step * Math.floor(u * plan.n));
  if (plan.kind === 'indexed') return plan.xs.at(1 + Math.floor(u * plan.n));
  return undefined;
}

/**
 * Pick the elements at the given 0-based `positions` (with multiplicity, in
 * output order) out of a non-indexed collection, by a SINGLE `each()` pass.
 */
function pickPositions(
  ce: ComputeEngine,
  xs: Expression,
  positions: number[]
): Expression[] {
  const slots = new Map<number, number[]>();
  positions.forEach((p, i) => {
    const bucket = slots.get(p);
    if (bucket === undefined) slots.set(p, [i]);
    else bucket.push(i);
  });
  const out: Expression[] = new Array(positions.length);
  let i = 0;
  for (const x of xs.each()) {
    if ((i & 0x3ff) === 0) checkDeadline(ce._deadlineFrame);
    const bucket = slots.get(i);
    if (bucket !== undefined) for (const slot of bucket) out[slot] = x;
    i += 1;
  }
  return out;
}

/**
 * The type NAME an operand spells, for the `Typed` ascription: a string
 * literal's text, or a type-name symbol's name. `undefined` for anything
 * else, which leaves the ascription unresolved.
 */
function typeTextOf(d: OperandDescriptor): string | undefined {
  const s = d.structureOf?.();
  if (s?.kind === 'string') return s.text;
  if (s?.kind === 'symbol') return s.name;
  return undefined;
}

/** The absence-admitting dictionary family top, the gate `isDictionary`
 * (`boxed-expression/utils.ts`) asks against: bare `dictionary` is the
 * values-only `dictionary<unknown>` synonym, and an attributes bag whose
 * entry values carry an absence arm is still a dictionary. */
const DICTIONARY_SHAPE_TYPE = parseType('dictionary<any>')!;

/**
 * Is this operand a dictionary — the shape `Declare` reads as its trailing
 * attributes bag rather than as a value?
 *
 * The descriptor twin of `isDictionary` (`boxed-expression/utils.ts`), which
 * is a TYPE test, not a value-kind test: any operand whose type is below the
 * dictionary family top is one, a record type included.
 */
function isDictionaryOperand(d: OperandDescriptor): boolean {
  return isSubtype(d.type, DICTIONARY_SHAPE_TYPE);
}

/**
 * Is this operand one of the blackboard-bold ring constants as bound by the
 * standard library (the `Subscript` reading `ℤ_n = ℤ/nℤ`)?
 *
 * The expression-shape test compares the operand's own value definition with
 * the one the SYSTEM scope holds, so that a scope shadowing `Integers` with a
 * user collection keeps the ordinary indexing reading. A descriptor carries
 * the symbol's name but not its binding, so the test here is the name, the
 * constness the library constants have (`facts.closed`), and the set-shaped
 * type they declare. What that misses is a shadowing binding that is itself a
 * constant of set type; such a binding reads as the ring constant here where
 * the expression shape read it as a user collection.
 */
function isRingConstantOperand(d: OperandDescriptor | undefined): boolean {
  const s = d?.structureOf?.();
  // The binding-identity test `isRingConstant` makes on an expression: the
  // symbol must resolve to the library definition, so a scope that shadows
  // `Integers` keeps the ordinary reading.
  return (
    s?.kind === 'symbol' && RING_CONSTANTS.has(s.name) && s.system === true
  );
}

/**
 * The small non-negative integer an operand's handler-visible type carries,
 * or `null`. The bound mirrors `asSmallInteger`, the value reader of the
 * expression shape: a value outside it names no numeral base and no compound
 * symbol part.
 */
function smallIntegerOperandValue(
  d: OperandDescriptor | undefined
): number | null {
  const v = d === undefined ? undefined : operandLiteralValue(d);
  if (v === undefined || !Number.isInteger(v)) return null;
  return v >= -SMALL_INTEGER && v <= SMALL_INTEGER ? v : null;
}

/** A symbol's name, or a small integer's decimal spelling — the two operand
 * shapes that fold into a compound symbol name. */
function nameOrSmallInteger(
  d: OperandDescriptor | undefined
): string | undefined {
  const s = d?.structureOf?.();
  if (s?.kind === 'symbol') return s.name;
  return compoundIndexDigits(smallIntegerOperandValue(d));
}

/**
 * The digits a small-integer subscript contributes to a compound symbol name,
 * or `undefined` for a negative one: `x_{-2}` cannot fold, because `x_-2` is
 * not a valid symbol name (the `-` is refused), and folding it produced an
 * `Error` node where a symbolic `Subscript(x, -2)` is the right answer.
 */
function compoundIndexDigits(n: number | null | undefined): string | undefined {
  if (n === null || n === undefined || n < 0) return undefined;
  return n.toString();
}

/**
 * The name a symbol contributes to a compound symbol, as it is WRITTEN: the
 * canonical symbols `ExponentialE` and `ImaginaryUnit` are spelled `e` and
 * `i`, so that `e_{k+1}` with `k := 3` resolves to `e_4` — the symbol the
 * literal `e_4` canonicalizes to (its canonical handler keeps the raw base
 * name for exactly this reason) — and not to `ExponentialE_4`. Every other
 * symbol contributes its own name.
 */
function writtenSymbolName(
  expr: Parameters<typeof sym>[0]
): string | undefined {
  const name = sym(expr);
  if (name === 'ExponentialE') return 'e';
  if (name === 'ImaginaryUnit') return 'i';
  return name;
}

/** The text a subscript operand contributes to a compound symbol name: a
 * string literal's text (which may be empty), a symbol's name, or a small
 * integer's spelling. */
function compoundSymbolPart(
  d: OperandDescriptor | undefined
): string | undefined {
  const s = d?.structureOf?.();
  if (s?.kind === 'string') return s.text;
  return nameOrSmallInteger(d);
}

/**
 * The element type of a `Random` DOMAIN, which is the type of one draw from
 * it.
 *
 * The domain's own element type answers directly. It used to be narrowed to a
 * `finite_*` counterpart for `Interval` and `Range`, because those two
 * reported an element type that admitted ±∞: a bare numeric name was then the
 * ∞-ADMITTING tier. Since the finite-by-default flip a bare name is finite,
 * and both constructors report elements only — an infinite endpoint marks
 * unbounded extent and is never an element — so the element type is already
 * as narrow as the draw. Precision here is not just tidiness: an imprecise
 * element type pushes comparisons over a framed draw off the compile path.
 */
function randomElementType(domain: OperandDescriptor): Type {
  return collectionElementType(domain.type) ?? 'any';
}

/** `list<T^k>` from a domain's element type, or the unshaped `list<T>`.
 * A zero count stays unshaped: a `^0` dimension reduces to the unit type,
 * which would misdispatch the (valid) empty-list result.
 *
 * The element type is the SAME as `Random` gives a single draw
 * (`randomElementType`) — a `RandomChoice` cell is a `Random` draw, so
 * `RandomChoice(Interval(0,1), 3)` is `list<real^3>`.
 *
 * A STRING domain answers `string` instead (ruled 2026-09-22): the draws come
 * from the string's own characters, so the result is a string, exactly as
 * `Take("abc", 2)` is (`docs/STRING_ROADMAP.md`, "String preservation rule").
 * The string result carries NO length dimension, even for a literal count:
 * rejoining the drawn grapheme clusters can compose or split clusters, so the
 * character count of the result is not always `k`. */
function randomListType(
  domain: OperandDescriptor | undefined,
  kOp: OperandDescriptor | undefined
): Type {
  if (domain !== undefined && isSubtype(domain.type, 'string')) return 'string';
  // Built STRUCTURALLY, not by serializing the element type into a `list<…>`
  // string and reparsing it: the element type may name a user-declared type,
  // which a resolver-less `parseType()` cannot read back.
  const elt: Type = domain ? randomElementType(domain) : 'any';
  // The count comes from the literal's handler-visible type — the only value
  // channel a descriptor carries. A count that no machine number represents
  // (an exact rational, a bigint past the double range) and a symbolic count
  // both decline, and the result is then the unshaped `list<T>`.
  const litCount = kOp ? operandLiteralValue(kOp) : undefined;
  const count =
    litCount !== undefined && Number.isInteger(litCount) ? litCount : null;
  if (count !== null && count > 0 && count <= MAX_RANDOM_ELEMENT_COUNT)
    return { kind: 'list', elements: elt, dimensions: [count] };
  return { kind: 'list', elements: elt };
}

/**
 * The value an assignment STATEMENT (`Assign`, `Declare` with an initial
 * value) stores for `value`, the evaluated right-hand side (user decision
 * 2026-09-30).
 *
 * A lazy collection (`Filter`, `Map`, `Scan`, `TakeWhile`, a comprehension)
 * evaluates to itself, and keeps by NAME each variable it reads. Stored as it
 * is, it is a live view: after `let ys = filter(xs, p)`, a later `xs = [7, 8]`
 * changed `ys`; `xs = filter(xs, p)` made `xs` read itself, so every later
 * read was the same unevaluated expression (`xs = [f(c) for c in xs]`
 * overflowed the stack); and a predicate written in a loop kept the loop
 * variable by name after the loop had ended. An assignment is a statement
 * of a sequential program: it stores what the right-hand side is worth NOW.
 * So a lazy collection that is FINITE and reads a variable is replaced by
 * the list (or the set) of its elements, computed with the values the
 * variables hold at this statement. This is also what compiled code does,
 * where a filter is an array. A callback with an effect therefore runs for
 * every element at the assignment, once, and not at each later read.
 *
 * Left as they are:
 *
 * - a collection that is not known to be finite (`filter(1..oo, p)` cannot
 *   be listed, and stays a live view of the variables it reads);
 * - a lazy collection that reads no variable (a range, a `Map` over a range:
 *   nothing can change under it, and listing a range of a million elements
 *   would cost memory for no gain);
 * - a lazy collection that is neither indexed (a list) nor typed as a set:
 *   a `Filter` over a dictionary is a dictionary, and listing it would
 *   store a list of key-value pairs, which no keyed read understands. It
 *   stays a live view;
 * - a collection whose elements could not be listed: the enumeration threw
 *   (a predicate that does not answer a boolean) or did not answer a list or
 *   a set. The lazy value is stored, and the failure is reported when the
 *   collection is read, as before.
 *
 * A lazy collection that is an element of a list or tuple literal
 * (`let r = [Map(h, xs)]`) is replaced in the same way, at every depth of
 * nested list and tuple literals. Without this, `h = g` after the statement
 * changed `r[1]`, while the compiled code and the same list written with
 * calls (`[[h(1), h(2)]]`) keep the values computed with the first `h`.
 * The evaluation of the literal itself already lists each finite lazy
 * element, within a budget of `ce.maxCollectionSize` elements
 * (`listedLiteralElements()` in `boxed-expression/listed-element.ts`), so most literals
 * arrive here with no lazy element. This function still lists an element
 * that the literal kept lazy because it is above that budget, when the
 * element reads a variable.
 *
 * The host function `ce.assign()` is not changed: a host that defines one
 * name from another with an expression wants the live view.
 */
function assignedValue(ce: ComputeEngine, value: Expression): Expression {
  if (
    value.isValid &&
    (isFunction(value, 'List') || isFunction(value, 'Tuple')) &&
    !value.isLazyCollection &&
    value._numericStore === undefined
  ) {
    const ops = value.ops;
    const next = ops.map((op) => assignedValue(ce, op));
    if (next.every((op, i) => op === ops[i])) return value;
    return ce.function(value.operator, next);
  }
  if (!value.isValid || !value.isLazyCollection) return value;
  if (!isWalkableFiniteCollection(value)) return value;
  // The kind of the stored value: a list for an indexed collection, read
  // from the VALUE (the type of a `Filter` over a local whose type was
  // inferred `collection<any>` does not say `list`), and a set for a value
  // typed as a set. Anything else is left lazy.
  const isSet = !value.isIndexedCollection && value.type.matches('set<any>');
  if (!isSet && !value.isIndexedCollection) return value;
  if (!readsVariable(ce, value)) return value;
  try {
    const listed = ce
      .function(isSet ? 'SetFrom' : 'ListFrom', [value])
      .evaluate();
    return isFunction(listed, isSet ? 'Set' : 'List') ? listed : value;
  } catch {
    return value;
  }
}

/**
 * Whether `expr` reads a VARIABLE: a name with a value definition that is
 * not a constant (a `let`, a parameter of the function being applied, a loop
 * variable, a function held as a value), as an operand or as the head of a
 * call (`c => f(c)` with `f` a variable). A library operator and a constant
 * do not count.
 *
 * A user function defined with `function` does not count either. A program
 * cannot define it twice (the second definition is a `function-redefinition`
 * error), so it cannot change under the collection. And counting it would
 * list every lazy collection whose callback is a user function, also over a
 * literal source: the callback then runs for every element at the
 * assignment, where the documented contract is that it runs only for the
 * elements a consumer reads (`test/compute-engine/lazy-callback-count.test.ts`).
 *
 * A parameter of a function literal INSIDE `expr` (`c` in `c => c > k`) has
 * no definition in this scope, unless a variable of the same name exists:
 * the answer is then `true` although the literal reads its own parameter,
 * and the caller lists a collection that did not need it, which is harmless.
 */
function readsVariable(ce: ComputeEngine, expr: Expression): boolean {
  const isVariable = (name: string): boolean => {
    const def = ce.lookupDefinition(name);
    return def !== undefined && isValueDef(def) && !def.value.isConstant;
  };
  if (isSymbol(expr)) return isVariable(expr.symbol);
  if (!isFunction(expr)) return false;
  if (isVariable(expr.operator)) return true;
  return expr.ops.some((op) => readsVariable(ce, op));
}

/**
 * Record ASSIGNMENT EVIDENCE at canonicalization time: the binding `name`,
 * when it is an inferred, valueless, non-constant one — the hoisted
 * block-local `canonicalBlock` creates, or an auto-declared symbol — takes
 * the JOIN of its recorded type and the widened type of the value assigned
 * to it. `Assign` only writes its binding at evaluation time, so without this
 * a block-local bound by assignment (`Block(Assign(d, [4,5,4]), Length(d))`)
 * stays `unknown`-typed on every route that never evaluates — compilation in
 * particular, whose operand type gates then fail closed on a local whose type
 * is manifest in the program (Tycho item 235).
 *
 * The recorded type is the join over every `Assign` canonicalized against
 * this binding (each pass widens through the same `widenAssignedType` table
 * the evaluation-time assignment uses), so a read placed between two
 * assignments of different kinds sees a type that admits both — reads resolve
 * the binding lazily, so every read in the block observes the final joined
 * type, including re-reads in a loop body after a reassignment. The binding
 * stays `inferred` and valueless: evaluation still creates the runtime
 * binding afresh and type-checks the assigned value there. Shared by the
 * plain-symbol and the destructuring targets of the `Assign` canonical
 * handler, the latter calling it once per pattern leaf, and by the `Declare`
 * canonical handler for an untyped `let` with an initial value.
 *
 * `assignedType` returns the CURRENT static type of the assigned value, or
 * `undefined` when the value is invalid or `unknown`-typed (nothing is
 * recorded then). It is a function because the enclosing block reads it again
 * after the whole block is canonicalized.
 *
 * With `currentScopeOnly`, the target is the binding of `name` in the
 * CURRENT lexical scope, and nothing is recorded when that scope does not
 * bind the name. A `let` uses it: at run time `Declare` creates (or
 * upgrades) the binding in the current scope only, so a lookup through the
 * scope chain could reach an OUTER binding of the same name (an
 * auto-declared free symbol, a local of an enclosing block) that the `let`
 * never writes, and record a type on it. An `Assign` writes the binding the
 * name resolves to, and looks it up through the scope chain.
 */
function joinAssignmentEvidence(
  ce: ComputeEngine,
  name: string,
  assignedType: () => Type | undefined,
  options?: { currentScopeOnly?: boolean }
): void {
  const def = options?.currentScopeOnly
    ? ce.context.lexicalScope.bindings.get(name)
    : ce.lookupDefinition(name);
  if (
    !def ||
    !isValueDef(def) ||
    !def.value.inferredType ||
    def.value.isConstant ||
    def.value.value !== undefined
  )
    return;
  const target = def.value;
  // Any assignment ends the aliasing of an initializer (`let out = acc`):
  // after `out = g(x)` the local no longer holds `acc`'s value, whatever
  // the type of `g(x)` (an `unknown`-typed value records no evidence, so the
  // type alone cannot tell). The `let` that records the alias calls this
  // first and sets the alias after it.
  target._initializerAlias = undefined;
  const first = assignedType();
  if (first !== undefined) joinEvidenceOnBinding(ce, target, first);
  // The value's type is read NOW, but a read in the value of a local that a
  // later statement widens (through a loop's back edge) makes it too narrow.
  // The enclosing block canonicalization joins the value's type again after
  // every statement is canonicalized, until no recorded type changes (see
  // `withEvidenceSession`, `library/assignment-evidence.ts`). A block local
  // with a declared type is excluded: its declared type is the contract,
  // and a use of it (a call with a `list<real>` parameter) narrows it back
  // after the first join, which a second join must not undo.
  if (isDeclaredLocal(target)) return;
  // Whether a read of the value's type has succeeded. A value whose type
  // could not be read on the first read gave no information, and the site
  // records nothing until a read succeeds. A value whose type could be read
  // before but not now (its type became `unknown`, or a destructured leaf
  // is no longer found in the value's tuple type) has LOST information: the
  // type recorded from the earlier read may be too narrow for what the
  // value now holds, so the site writes `unknown` on the binding, which is
  // wide and therefore sound, and marks the binding so that no other site
  // narrows it again in this session (`markEvidenceLost`).
  let hasRead = first !== undefined;
  registerEvidenceSite(ce, {
    rejoin: (coarse) => {
      if (isEvidenceLost(ce, target)) return false;
      const t = assignedType();
      if (t === undefined) {
        if (!hasRead) return false;
        markEvidenceLost(ce, target);
        if (target.type.isUnknown) return false;
        writeEvidenceType(ce, target, 'unknown');
        return true;
      }
      hasRead = true;
      return joinEvidenceOnBinding(ce, target, t, coarse);
    },
    reset: () => writeEvidenceType(ce, target, 'unknown'),
  });
}

/** Join `assignedType` (widened) with the recorded type of the binding
 * `target`. Return `true` when the recorded type changed. With `coarse`, the
 * join is bounded in height by `coarsenEvidenceType`. */
function joinEvidenceOnBinding(
  ce: ComputeEngine,
  target: BoxedValueDefinition,
  assignedType: Type,
  coarse = false
): boolean {
  // A binding whose evidence was lost in this session stays `unknown`.
  if (isEvidenceLost(ce, target)) return false;
  // A value typed `never` claims no value, so it is no evidence. `never` is
  // the bottom type and matches every type, so the widening table below read
  // it as an integer, and the binding gained an `integer` member that no
  // assignment gives it: with `circles` a list of points, a first read of
  // `circles = g(gap[1], 2, circles)` inside a `for` loop, taken before the
  // types of the loop settled, typed the call `never`, `circles` became
  // `integer | list<…>`, and the JavaScript target declined `Length(circles)`.
  if (assignedType === 'never') return false;
  const widened = widenAssignedType(ce, assignedType);
  const recorded = target.type;
  const joined = recorded.isUnknown
    ? widened
    : joinEvidenceTypes(recorded.type, widened);
  if (joined === undefined) return false;
  const next = coarse ? coarsenEvidenceType(joined) : joined;
  if (!recorded.isUnknown && isSubtype(next, recorded.type)) return false;
  writeEvidenceType(ce, target, next);
  return true;
}

/** Write the type `next` on the binding `target`, journaled for rollback. */
function writeEvidenceType(
  ce: ComputeEngine,
  target: BoxedValueDefinition,
  next: Type
): void {
  // Rollback journal (family 1), as in the `Function` branch of the `Assign`
  // canonical handler: the binding may pre-exist the rollback frame, and the
  // static checking pass must be able to undo the write.
  const frame = activeRollbackFrame(ce);
  if (frame !== undefined) {
    const slots = target._typeSlotSnapshot();
    frame.record({ undo: () => target._restoreTypeSlots(slots) });
  }
  const wasCallable = containsSignatureArm(target.type.type);
  target._setType(() => ce.type(next));
  // The `_type` expression caches key on the engine's `any` axis, which a
  // `_setType()` write does not advance: without the event, an
  // expression typed before this join — a lambda body canonicalized earlier
  // in the same block — keeps its stale narrower type for the rest of the
  // generation.
  ce._noteStateEvent({
    kind: 'type-write',
    callableBefore: wasCallable,
    callableAfter: containsSignatureArm(target.type.type),
  });
}

/**
 * The static type of each leaf of the destructuring pattern `pattern` (a
 * `Tuple` of names, `_` and nested patterns), read from the matching
 * position of the tuple type `t`. A nested pattern descends into the nested
 * tuple type; `_` and `Nothing` bind nothing; a leaf whose component type is
 * `unknown` is left out. A union type is read arm by arm: the arms that are
 * tuples of the pattern's shape are read, the other arms are skipped (a value
 * of such an arm fails the destructuring at run time and writes no leaf), and
 * each leaf's types from the read arms are joined; a leaf left out by one
 * arm is left out of the join. The result is `undefined` when `t` (or, for a
 * union, every arm) is not a tuple of the pattern's shape at some level,
 * since the run-time destructuring is atomic: a shape mismatch anywhere in
 * the pattern writes no leaf at all (`bindTuplePattern`).
 */
function tuplePatternLeafTypes(
  pattern: Expression,
  t: Type
): Map<string, Type> | undefined {
  if (!isFunction(pattern, 'Tuple')) return undefined;
  const rt = resolveTypeAlias(t);
  if (typeof rt !== 'string' && rt.kind === 'union') {
    const armLeaves: Map<string, Type>[] = [];
    for (const arm of rt.types) {
      const leaves = tuplePatternLeafTypes(pattern, arm);
      if (leaves !== undefined) armLeaves.push(leaves);
    }
    if (armLeaves.length === 0) return undefined;
    const joined = new Map<string, Type>();
    for (const name of armLeaves[0].keys()) {
      const types = armLeaves.map((leaves) => leaves.get(name));
      if (types.some((x) => x === undefined)) continue;
      const join = reduceType({ kind: 'union', types: types as Type[] });
      if (join !== undefined) joined.set(name, join);
    }
    return joined;
  }
  if (typeof rt === 'string' || rt.kind !== 'tuple') return undefined;
  if (rt.elements.length !== pattern.nops) return undefined;
  const leaves = new Map<string, Type>();
  for (let i = 0; i < pattern.nops; i++) {
    const leaf = pattern.ops[i];
    const leafType = rt.elements[i].type;
    if (isFunction(leaf, 'Tuple')) {
      const nested = tuplePatternLeafTypes(leaf, leafType);
      if (nested === undefined) return undefined;
      for (const [name, type] of nested) leaves.set(name, type);
      continue;
    }
    const name = sym(leaf);
    if (name === undefined) return undefined;
    if (name === '_' || name === 'Nothing') continue;
    if (leafType !== 'unknown') leaves.set(name, leafType);
  }
  return leaves;
}

/**
 * Record assignment evidence on each leaf of the destructuring pattern
 * `pattern` from the value type `valueType()` (`tuplePatternLeafTypes`),
 * one evidence site per leaf. Nothing is recorded when the first read of
 * the value type does not fit the pattern. Each site reads the value type
 * again when the enclosing block re-runs the sites, so a leaf that is no
 * longer found in a later read loses its evidence (`joinAssignmentEvidence`).
 * `options` is passed to `joinAssignmentEvidence` for each leaf.
 */
function recordPatternEvidence(
  ce: ComputeEngine,
  pattern: Expression,
  valueType: () => Type,
  options?: { currentScopeOnly?: boolean }
): void {
  const first = tuplePatternLeafTypes(pattern, valueType());
  if (first === undefined) return;
  for (const name of first.keys())
    joinAssignmentEvidence(
      ce,
      name,
      () => tuplePatternLeafTypes(pattern, valueType())?.get(name),
      options
    );
}

/**
 * Bind a destructuring `Tuple` pattern, invoking `bindOne` at every named
 * position. Shared by the two destructuring routes: the `let (x, y) = v`
 * declaration (`Declare`) and the `(x, y) := v` assignment (`Assign`).
 *
 * Two phases: the whole pattern is matched first ({@link collectTuplePattern}),
 * and only a fully-matched pattern writes. So a shape mismatch anywhere —
 * including one nested under a sibling that would have bound — writes nothing
 * at all.
 *
 * An optional `validateOne` extends that fail-fast to failures a match cannot
 * see: it runs over EVERY collected position — read-only, before the first
 * write — so a leaf it rejects also leaves zero bindings installed. The
 * destructuring `let` uses it to hold each leaf value to a positional declared
 * type; the destructuring assignment uses it to hold each leaf to its target's
 * EXISTING binding (`assertAssignable`).
 *
 * A `bindOne` that itself fails is a different matter: a `const` target or a
 * declared-type violation `validateOne` did not pre-check is discovered only by
 * attempting the write, so earlier positions in the same pattern have already
 * been written and stay written. The walk stops at the first such position.
 *
 * Returns `null` when every position bound, otherwise the `Error` value.
 */
function bindTuplePattern(
  ce: ComputeEngine,
  pattern: Expression,
  v: Expression,
  bindOne: (name: string, value: Expression) => Expression | null,
  validateOne?: (name: string, value: Expression) => Expression | null
): Expression | null {
  const pairs: [name: string, value: Expression][] = [];
  const err = collectTuplePattern(pattern, v, pairs);
  if (err) return err;
  if (validateOne) {
    for (const [name, value] of pairs) {
      const e = validateOne(name, value);
      if (e) return e;
    }
  }
  for (const [name, value] of pairs) {
    const e = bindOne(name, value);
    if (e) return e;
  }
  return null;
}

/**
 * Runtime identity for a `Declare*` statement: the compilation unit and the
 * statement within it.
 *
 * `anchor` is the statement's raw (uncanonicalized) name operand. Two
 * properties make it the identity token:
 *
 * - **Distinct per statement.** Boxing does not intern raw operands, so two
 *   `type Dup = …` statements — even byte-identical ones — hold two different
 *   objects.
 * - Stable across the registrations one statement performs. The canonical
 *   handler keeps the name operand raw and hands the very same object to
 *   `ce._fn(…)`, so the evaluate handler that runs afterwards sees the
 *   identical object. (The static pre-pass boxes the statement independently
 *   and therefore mints a different token — which is harmless because the
 *   pre-pass rolls its registrations, stamp included, back.)
 *
 * Use the name operand rather than the body or members because every declaration
 * has one. `protocol Marker {}` carries no members operand, so a
 * members-anchored token would be `undefined` for two different member-less
 * protocol statements and their collision would go unseen.
 *
 * Returns `undefined` unless the caller is on the Epsil statement route —
 * `onStatementRoute`, read from `ce._epsilDeclarationRoute` by
 * {@link withStatementRoute} — and a batch is live. The batch id alone is not
 * enough: it is ambient for the whole `executeEpsil` extent, so a
 * `ce.box(["DeclareType", …]).evaluate()` performed re-entrantly from a host
 * operator's evaluate handler would otherwise be stamped as a statement of the
 * running program, and the program's own declaration of that name would then
 * falsely report `type-redefinition`. A box-route declaration runs under no
 * compilation unit of its own, so it has nothing to collide with. The host API
 * (`ce.declareType()`) is unstamped for a different and stronger reason — it
 * never calls this function at all, so it throws its already-defined error even
 * when a batch happens to be live around it.
 */
function statementOrigin(
  ce: ComputeEngine,
  anchor: Expression | undefined,
  onStatementRoute: boolean
): DeclarationOrigin | undefined {
  if (!onStatementRoute) return undefined;
  const batch = ce._epsilBatchId;
  if (batch === undefined || anchor === undefined) return undefined;
  const origin: DeclarationOrigin = { batch, statementId: anchor };
  // The name's source range, for the "first declared here" site of a
  // diagnostic built from the stamp. Absent on a hand-built MathJSON operand.
  if (anchor.sourceOffsets !== undefined)
    origin.firstRange = anchor.sourceOffsets;
  return origin;
}

/**
 * Run one `Declare*` handler's body, telling it whether it was reached on the
 * Epsil statement route and clearing the marker for the duration of the call.
 *
 * The Epsil interpreter raises `ce._epsilDeclarationRoute` around the statement
 * it canonicalizes and evaluates (`src/epsil/execute-epsil.ts`,
 * `src/epsil/static-diagnostics.ts`). Clearing it here — the ambient-cause
 * save/restore pattern — closes the inner leak path: anything a declaration's
 * own processing goes on to declare re-entrantly through the box route is NOT
 * this statement and must stay unstamped. The marker is restored, never
 * consumed, because the same statement registers up to three times per batch
 * (pre-pass canonicalize, eval-loop canonicalize, evaluate) and every one of
 * those registrations needs the stamp — an unstamped third registration would
 * be indistinguishable from a second declaration of the name.
 */
function withStatementRoute<T>(
  ce: ComputeEngine,
  body: (onStatementRoute: boolean) => T
): T {
  const onStatementRoute = ce._epsilDeclarationRoute;
  ce._epsilDeclarationRoute = false;
  try {
    return body(onStatementRoute);
  } finally {
    ce._epsilDeclarationRoute = onStatementRoute;
  }
}

/**
 * Register the type declared by a `DeclareType` statement in the engine-level
 * type registry. Returns an `Error` value on failure, `null` on success.
 *
 * Called from both the canonical and the evaluate handler: the canonical pass
 * makes the type visible to the statements canonicalized after it (a `Block`
 * canonicalizes its statements in order, in the scope that is also the
 * runtime frame), and the evaluate pass makes it visible on routes that skip
 * canonicalization. Both passes are idempotent thanks to the
 * `fromStatement` replace rule in `ce.declareType()`.
 *
 * Types are engine-global, so a `DeclareType` statement is legal only at the
 * top level of a program —
 * inside a `do` block, a function body, an `if` branch or a loop it is a hard
 * error (no hoisting). A registration from a nested scope would still write
 * global state; the error keeps "a block mutated the engine's type namespace"
 * from ever being something a reader has to consider. The Epsil parser
 * enforces the same rule statically (`type-declaration-not-top-level`); this
 * check covers the box route and non-Epsil MathJSON programs.
 */
function declareTypeStatement(
  ce: ComputeEngine,
  nameOp: Expression | undefined,
  typeOp: Expression | undefined,
  attrs: Expression | undefined,
  /** Whether this call came from an Epsil `type` STATEMENT — see
   * {@link withStatementRoute}, which is how every caller obtains it. */
  onStatementRoute: boolean,
  /**
   * Out-param: when the type operand was FUNCTION-shaped — the only operand
   * shape this function EVALUATES — `typeText` is set to the settled canonical
   * text of the resulting type value. The canonical handler rebuilds its node
   * from that text, so the evaluate pass re-settles a literal instead of
   * running the computation a second time. Only meaningful when the call
   * returned `null` (success).
   */
  settled?: { typeText?: string }
): Expression | null {
  // The name and the type are read off the RAW operands: a symbol or a string.
  const name = nameOp
    ? ((isString(nameOp) ? nameOp.string : sym(nameOp)) ?? undefined)
    : undefined;
  if (!name)
    return ce.error(['invalid-type-declaration', 'Expected a type name']);

  // Top-level only: the current lexical scope must be the engine's global
  // scope (`_evalContextStack[1]` — `[0]` is the system scope). A `Block` or
  // `Function` body canonicalizes AND evaluates its statements inside its own
  // scope (`canonicalBlock` runs them under `ce._inScope(scope, …)`), so both
  // routes are caught by the same comparison. The executeEpsil program
  // wrapper unwraps its top-level `Block`, so genuine top-level statements
  // run directly in the global scope. An engine without a global frame yet
  // (bootstrap) never routes statements through here.
  //
  // One frame is a TOP-LEVEL SURROGATE: the Epsil static pre-pass
  // (`src/epsil/static-diagnostics.ts`) canonicalizes each top-level
  // statement inside a single pushed frame — named 'epsil:static-check' AND
  // guarded by the engine's `_staticTypeCheckDepth` counter, so a host
  // `pushScope` with the same public name cannot forge it — to keep binding
  // side-effects out of the program scope. Statements boxed directly in that
  // frame are top-level by construction, and registering there is what lets
  // later statements of the same cell (and a statement-replace re-run) check
  // against the NEW definition. A nested `DeclareType` under it still
  // errors: the enclosing `Block` pushes its own (anonymous) frame on top.
  const globalScope = ce._evalContextStack[1]?.lexicalScope;
  const ctx = ce.context;
  const inSurrogate =
    ce._staticTypeCheckDepth > 0 && ctx.name === 'epsil:static-check';
  if (
    globalScope !== undefined &&
    ctx.lexicalScope !== globalScope &&
    !inSurrogate
  )
    return ce.error(
      [
        'invalid-type-declaration',
        'Type declarations must be at the top level of a program, not inside a block or function body',
      ],
      name
    );

  let typeStr = typeOp
    ? ((isString(typeOp) ? typeOp.string : sym(typeOp)) ?? undefined)
    : undefined;
  // A TYPE VALUE operand (the reverse direction of the plan's string
  // acceptance, phase 3): a FUNCTION-shaped operand — `TypeFrom("…")`, a
  // `Type(x)` call — is not a type name, so evaluating it cannot
  // auto-declare anything; it must produce a type value, whose canonical
  // text becomes the declared body. A SYMBOL operand still names a TYPE
  // first (unchanged behavior); only when the name resolves to no type does
  // the symbol's held VALUE get a look — turning what was an unknown-type
  // error into the documented `let t = Type(x); DeclareType("a", t)` form.
  if (typeStr === undefined && typeOp !== undefined && isFunction(typeOp)) {
    // Errors are values, here as everywhere in this handler: evaluating the
    // operand runs arbitrary built-in handlers, some of which THROW, and the
    // guard that converts a throw into an error value on the box route sits in
    // `box.ts`'s canonical dispatch — which a node built directly in
    // structural form never passes through. Catching here is what keeps
    // `DeclareType` from letting an operand's throw escape to the host.
    let v: Expression;
    try {
      v = typeOp.canonical.evaluate();
    } catch (e) {
      return ce.error(
        [
          'invalid-type-declaration',
          e instanceof Error ? e.message : String(e),
        ],
        name
      );
    }
    typeStr = settledTypeText(v);
    if (typeStr === undefined)
      return ce.error(
        [
          'invalid-type-declaration',
          'Expected a type expression, a type name, or a type value',
        ],
        name
      );
    // Report the settled text back, so the caller can rebuild its node with a
    // value instead of the computation that produced it — see the `settled`
    // parameter.
    if (settled !== undefined) settled.typeText = typeStr;
  } else if (
    typeStr !== undefined &&
    !isString(typeOp!) &&
    ce._typeRegistry[typeStr] === undefined &&
    !isValidType(typeStr as any)
  ) {
    // A bare symbol that names no type: consult its value binding WITHOUT
    // boxing the symbol (boxing an unknown symbol would auto-declare it).
    const def = ce.lookupDefinition(typeStr);
    const held =
      def !== undefined && isValueDef(def) ? def.value.value : undefined;
    const tt = held !== undefined ? settledTypeText(held) : undefined;
    if (tt !== undefined) typeStr = tt;
  }
  if (!typeStr)
    return ce.error(
      ['invalid-type-declaration', 'Expected a type expression'],
      name
    );

  // Nominal by default (mirrors `ce.declareType()`); `alias -> True` makes it
  // a structural alias. The `{dict: …}` shorthand boxes an unquoted `True`
  // as a STRING, the operator `Dictionary` encoding as the symbol — read both,
  // exactly as the `typeParams` clause below does.
  const hasAttrs = attrs !== undefined && isDictionary(attrs);
  const aliasOp = hasAttrs ? attrs.get('alias') : undefined;
  const alias =
    aliasOp !== undefined &&
    (isString(aliasOp) ? aliasOp.string : sym(aliasOp)) === 'True';

  // A GENERIC alias carries its type-parameter clause as TEXT (A1). This
  // handler is the box/parse-route choke point — it runs for BOTH the
  // canonical and the evaluate pass — so the clause must be read and threaded
  // here, not only on the Epsil statement route.
  let typeParams: TypeParameter[] | undefined;
  if (hasAttrs) {
    const clauseOp = attrs.get('typeParams');
    const clauseText = clauseOp
      ? ((isString(clauseOp) ? clauseOp.string : sym(clauseOp)) ?? undefined)
      : undefined;
    if (clauseText !== undefined) {
      // Both forms take a clause: a generic ALIAS (expanded eagerly) and a
      // parameterized NOMINAL type (kept as an application). The clause is the
      // source text WITHOUT the enclosing angle brackets, so a variance marker
      // is just more clause text (`"out T"`).
      const parsed = parseTypeParameterClause(clauseText, ce._typeResolver);
      if ('error' in parsed)
        return ce.error(
          [
            'invalid-type-declaration',
            `Invalid type parameter clause: ${parsed.error.message}`,
          ],
          name
        );
      typeParams = parsed.params;
    }
  }

  // Errors are values: an invalid name, a malformed type expression or a
  // conflict with a host declaration must not throw to the host.
  try {
    declareType(ce, name, typeStr, {
      alias,
      fromStatement: true,
      typeParams,
      origin: statementOrigin(ce, nameOp, onStatementRoute),
    });
  } catch (e) {
    // A within-unit redefinition carries its own code, the SAME one the static
    // pass reports (`docs/TYPE-SYSTEM.md`), so
    // one problem reads identically on both tiers.
    if (e instanceof RedefinitionError)
      return ce.error([e.code, e.message], e.declaredName);
    return ce.error(
      ['invalid-type-declaration', e instanceof Error ? e.message : String(e)],
      name
    );
  }
  return null;
}

/** The name a `DeclareSumType` operand holds — a symbol or a string, the two
 * spellings every declaration operand is read in. */
function declarationName(op: Expression | undefined): string | undefined {
  if (op === undefined) return undefined;
  return (isString(op) ? op.string : sym(op)) ?? undefined;
}

/**
 * Register the sum type declared by a `DeclareSumType` statement: the N
 * nominal variants plus the transparent union naming them
 * (`docs/plans/2026-08-12-sum-type-sugar-and-compilation.md` §A). Returns an
 * `Error` value on failure, `null` on success.
 *
 * The shape mirrors `DeclareType` in every respect — called from BOTH the
 * canonical and the evaluate handler, idempotent through the `fromStatement`
 * replace rule, top-level only because types are engine-global — with one
 * difference forced by the variadic variant list: the optional attributes
 * dictionary rides at operand 1, AHEAD of the variants, and is told apart from
 * a variant by its head (a variant is a `Tuple`).
 */
function declareSumTypeStatement(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>,
  /** See `declareTypeStatement`'s parameter of the same name. */
  onStatementRoute: boolean
): Expression | null {
  const name = declarationName(ops[0]);
  if (!name)
    return ce.error(['invalid-type-declaration', 'Expected a type name']);

  // Top-level only — the identical rule (and the identical static-pre-pass
  // surrogate exemption) as `declareTypeStatement`; see its comment.
  const globalScope = ce._evalContextStack[1]?.lexicalScope;
  const ctx = ce.context;
  const inSurrogate =
    ce._staticTypeCheckDepth > 0 && ctx.name === 'epsil:static-check';
  if (
    globalScope !== undefined &&
    ctx.lexicalScope !== globalScope &&
    !inSurrogate
  )
    return ce.error(
      [
        'invalid-type-declaration',
        'Type declarations must be at the top level of a program, not inside a block or function body',
      ],
      name
    );

  let rest = ops.slice(1);

  // The attributes bag, when present: anything at operand 1 that is not a
  // variant `Tuple`.
  let typeParams: TypeParameter[] | undefined;
  if (rest.length > 0 && !isFunction(rest[0], 'Tuple')) {
    const attrs = rest[0];
    rest = rest.slice(1);
    if (!isDictionary(attrs))
      return ce.error(
        ['invalid-type-declaration', 'Expected an attributes dictionary'],
        name
      );
    const clauseText = declarationName(attrs.get('typeParams'));
    if (clauseText !== undefined) {
      const parsed = parseTypeParameterClause(clauseText, ce._typeResolver);
      if ('error' in parsed)
        return ce.error(
          [
            'invalid-type-declaration',
            `Invalid type parameter clause: ${parsed.error.message}`,
          ],
          name
        );
      typeParams = parsed.params;
    }
  }

  const variants: SumTypeVariant[] = [];
  for (const op of rest) {
    if (!isFunction(op, 'Tuple') || op.nops !== 2)
      return ce.error(
        [
          'invalid-type-declaration',
          'Expected a variant as `["Tuple", name, payload type]`',
        ],
        name
      );
    const variantName = declarationName(op.ops[0]);
    const payload = declarationName(op.ops[1]);
    if (!variantName || !payload)
      return ce.error(
        [
          'invalid-type-declaration',
          'Expected a variant name and payload type',
        ],
        name
      );
    variants.push({ name: variantName, payload });
  }
  if (variants.length === 0)
    return ce.error(
      ['invalid-type-declaration', 'Expected at least one variant'],
      name
    );

  // Errors are values, exactly as for `DeclareType`.
  try {
    declareSumType(ce, name, variants, {
      typeParams,
      fromStatement: true,
      // ONE origin for all N+1 registrations: the statement owns every name it
      // declares, so a collision on any of them is one collision.
      origin: statementOrigin(ce, ops[0], onStatementRoute),
    });
  } catch (e) {
    if (e instanceof RedefinitionError)
      return ce.error([e.code, e.message], e.declaredName);
    return ce.error(
      ['invalid-type-declaration', e instanceof Error ? e.message : String(e)],
      name
    );
  }
  return null;
}

/**
 * The top-level gate shared by every DECLARATION statement: protocols, like
 * types, are engine-global, so a declaration is legal only at the top level of
 * a program. The Epsil static pre-pass frame is a top-level SURROGATE,
 * recognized by frame name AND `_staticTypeCheckDepth` (the name alone is
 * host-forgeable) — the identical rule as `declareTypeStatement`; see its
 * comment for the full reasoning.
 */
function notAtTopLevel(ce: ComputeEngine): boolean {
  const globalScope = ce._evalContextStack[1]?.lexicalScope;
  const ctx = ce.context;
  const inSurrogate =
    ce._staticTypeCheckDepth > 0 && ctx.name === 'epsil:static-check';
  return (
    globalScope !== undefined &&
    ctx.lexicalScope !== globalScope &&
    !inSurrogate
  );
}

/**
 * The entries of a RAW `["Dictionary", ["KeyValuePair", key, value], …]`
 * operand, or `null` when the operand is not that shape.
 *
 * Read from the raw structure rather than through `isDictionary`, which needs
 * a canonical operand: the implementation block of a `DeclareConformance`
 * carries function literals whose annotations mention `Self` — a token no type
 * resolver knows — so it must reach the handler UNCANONICALIZED (phase 2 owns
 * its validation).
 */
function rawDictionaryEntries(
  op: Expression | undefined
): [string, Expression][] | null {
  if (op === undefined || !isFunction(op, 'Dictionary')) return null;
  const entries: [string, Expression][] = [];
  for (const kv of op.ops) {
    if (!isFunction(kv, 'KeyValuePair') || kv.nops !== 2) return null;
    const key = declarationName(kv.ops[0]);
    if (key === undefined) return null;
    entries.push([key, kv.ops[1]]);
  }
  return entries;
}

/**
 * Register the protocol declared by a `DeclareProtocol` statement in the
 * ENGINE-LEVEL protocol registry. Returns an `Error` value on failure, `null`
 * on success — the `declareTypeStatement` contract in every respect (called
 * from BOTH the canonical and the evaluate handler, idempotent through the
 * statement-replace rule, top-level only because protocols are engine-global).
 *
 * The members ride as a dictionary of `member -> ["Pair", kind, signature]`,
 * with the signature as SOURCE TEXT parsed here (so `Self` handling stays
 * engine-side, P11/P12).
 */
function declareProtocolStatement(
  ce: ComputeEngine,
  nameOp: Expression | undefined,
  membersOp: Expression | undefined,
  /** See `declareTypeStatement`'s parameter of the same name. */
  onStatementRoute: boolean
): Expression | null {
  const name = declarationName(nameOp);
  if (!name)
    return ce.error(['protocol-name-expected', 'Expected a protocol name']);

  if (notAtTopLevel(ce))
    return ce.error(
      [
        'protocol-scope-invalid',
        'Protocol declarations must be at the top level of a program, not inside a block or function body',
      ],
      name
    );

  const members: ProtocolMembersInput = {};
  if (membersOp !== undefined) {
    const entries = rawDictionaryEntries(membersOp);
    if (entries === null)
      return ce.error(
        [
          'invalid-protocol-declaration',
          'Expected a dictionary of protocol members',
        ],
        name
      );
    const seen = new Set<string>();
    for (const [member, spec] of entries) {
      // The raw dictionary preserves duplicate keys, but a bucket does not —
      // two `function compare` entries would silently keep the last. Same
      // message shape as the cross-kind duplicate check in `engine-protocols`.
      if (seen.has(member))
        return ce.error(
          [
            'invalid-protocol-declaration',
            `The protocol "${name}" declares the member "${member}" twice`,
          ],
          name
        );
      seen.add(member);
      const kind = isFunction(spec, 'Pair')
        ? declarationName(spec.ops[0])
        : undefined;
      const text = isFunction(spec, 'Pair')
        ? declarationName(spec.ops[1])
        : undefined;
      if (
        text === undefined ||
        (kind !== 'function' && kind !== 'readonly' && kind !== 'readwrite')
      )
        return ce.error(
          [
            'invalid-protocol-declaration',
            `Expected the member \`${member}\` as \`["Pair", "function"|"readonly"|"readwrite", signature]\``,
          ],
          name
        );
      const slot = kind === 'function' ? 'functions' : kind;
      const bucket = (members[slot] ??= {});
      bucket[member] = text;
    }
  }

  // Errors are values: a malformed signature must not throw to the host.
  try {
    declareProtocolImpl(ce, name, members, {
      fromStatement: true,
      origin: statementOrigin(ce, nameOp, onStatementRoute),
    });
  } catch (e) {
    if (e instanceof RedefinitionError)
      return ce.error([e.code, e.message], e.declaredName);
    return ce.error(
      [
        'invalid-protocol-declaration',
        e instanceof Error ? e.message : String(e),
      ],
      name
    );
  }
  return null;
}

/**
 * Register the conformance declared by a `DeclareConformance` statement.
 * Returns an `Error` value on failure, `null` on success.
 *
 * `["DeclareConformance", {str: target}, ["List", P₁, …], where?, impl?]` — the
 * target rides as type-expression SOURCE (like `DeclareType`'s body) and the
 * implementation block, when present, is stored RAW (phase 2 validates it
 * against the protocol's requirements).
 *
 * The optional `where` operand is the trailing clause of a CONDITIONAL
 * conformance, as SOURCE TEXT (`{str: "where T is Comparable"}`) — the P11
 * pattern `DeclareType`'s `typeParams` attribute uses, re-parsed by the engine.
 * It is told apart from the implementation block by its HEAD: a clause is a
 * string, a block a `Dictionary` (the same by-head rule `DeclareSumType` uses
 * for its attributes bag).
 */
function declareConformanceStatement(
  ce: ComputeEngine,
  targetOp: Expression | undefined,
  protocolsOp: Expression | undefined,
  whereOrImplOp: Expression | undefined,
  implOp: Expression | undefined,
  /** See `declareTypeStatement`'s parameter of the same name. Threaded to
   * `declareConformance`'s same-block no-op, which must not fire for a
   * re-entrant box-route registration that merely runs while a batch is
   * ambient. */
  onStatementRoute: boolean
): Expression | null {
  const target = declarationName(targetOp);
  if (!target)
    return ce.error([
      'protocol-conformance-target-invalid',
      'Expected a conformance target type',
    ]);

  if (notAtTopLevel(ce))
    return ce.error(
      [
        'protocol-scope-invalid',
        'Conformance declarations must be at the top level of a program, not inside a block or function body',
      ],
      target
    );

  // The primitive `type` (a reified type expression) declares NO
  // conformances — see `typePrimitiveConformanceProblem`, which states the
  // ruling and which the HOST route (`ce.declareProtocolImplementation()`)
  // applies as well, so the invariant `Conforms` depends on holds however the
  // edge was declared. Errors are values on this route, so the message is
  // boxed rather than thrown.
  {
    const problem = typePrimitiveConformanceProblem(ce, target);
    if (problem !== null)
      return ce.error(['invalid-protocol-declaration', problem], target);
  }

  const names: string[] = [];
  if (protocolsOp !== undefined && isFunction(protocolsOp, 'List')) {
    for (const p of protocolsOp.ops) {
      const n = declarationName(p);
      if (n === undefined)
        return ce.error(
          ['protocol-unknown', 'Expected a protocol name'],
          target
        );
      names.push(n);
    }
  } else {
    const n = declarationName(protocolsOp);
    if (n === undefined)
      return ce.error(['protocol-unknown', 'Expected a protocol name'], target);
    names.push(n);
  }

  // A STRING at operand 2 is the `where` clause of a conditional conformance;
  // a `Dictionary` there is the implementation block (the pre-phase-5 shape).
  let where: string | undefined;
  if (whereOrImplOp !== undefined && isString(whereOrImplOp))
    where = whereOrImplOp.string;
  else if (whereOrImplOp !== undefined && implOp === undefined)
    implOp = whereOrImplOp;
  else if (whereOrImplOp !== undefined)
    return ce.error(
      [
        'invalid-protocol-declaration',
        'Expected the `where` clause of a conditional conformance as a string',
      ],
      target
    );

  let impl: Record<string, Expression> | undefined;
  if (implOp !== undefined) {
    const entries = rawDictionaryEntries(implOp);
    if (entries === null)
      return ce.error(
        [
          'invalid-protocol-declaration',
          'Expected a dictionary of implementation members',
        ],
        target
      );
    impl = Object.create(null) as Record<string, Expression>;
    const seen = new Set<string>();
    for (const [member, value] of entries) {
      // The raw dictionary preserves duplicate keys, but the block does not —
      // two `compare` entries would silently keep the last. Same message shape
      // as the duplicate check in `declareProtocolStatement`.
      if (seen.has(member))
        return ce.error(
          [
            'invalid-protocol-declaration',
            `The implementation of "${target}" declares the member "${member}" twice`,
          ],
          target
        );
      seen.add(member);
      impl[member] = value;
    }
  }

  // Errors are values: the overlap check reaches `reduceType`, which throws on
  // an unknown type kind, so a throw must not escape through the lazy
  // operator's canonical/evaluate handler (the `declareProtocolStatement`
  // contract).
  try {
    // `implOp` is the block's IDENTITY, which the P47 same-batch duplicate
    // rule keys on: this handler runs once per canonicalization AND once per
    // evaluation of the same statement, on the very same operand.
    return declareConformance(ce, target, names, impl, {
      where,
      block: implOp,
      fromStatementRoute: onStatementRoute,
    });
  } catch (e) {
    return ce.error(
      [
        'invalid-protocol-declaration',
        e instanceof Error ? e.message : String(e),
      ],
      target
    );
  }
}

/**
 * The attributes of a `DefineFunction` statement, decoded from its optional
 * third operand — a dictionary such as `{hold: True, bind: ["i"],
 * commutative: True, description: "…"}` (see `ClauseAttributes` in
 * `multi-clause.ts` for what each one means). Booleans are read in both
 * dictionary encodings, exactly as `DeclareType` reads its `alias` attribute:
 * the `{dict: …}` shorthand boxes an unquoted `True` as a STRING, the
 * operator `Dictionary` encoding as the SYMBOL. `bind` is a list of parameter
 * names (strings or symbols); `description` is a string.
 */
function definitionAttributes(attrs: Expression | undefined): ClauseAttributes {
  if (attrs === undefined) return {};
  const dict = attrs.canonical;
  if (!isDictionary(dict)) return {};
  const flag = (key: string): boolean => {
    const v = dict.get(key);
    return v !== undefined && (isString(v) ? v.string : sym(v)) === 'True';
  };
  const out: ClauseAttributes = {};
  if (flag('hold')) out.hold = true;
  for (const f of [
    'commutative',
    'associative',
    'idempotent',
    'involution',
  ] as const)
    if (flag(f)) out[f] = true;
  const bind = dict.get('bind');
  if (bind !== undefined) {
    const items = isFunction(bind, 'List') ? bind.ops : [bind];
    const names = items
      .map((x) => (isString(x) ? x.string : sym(x)))
      .filter((x): x is string => x !== undefined);
    if (names.length > 0) out.bind = names;
  }
  const description = dict.get('description');
  if (description !== undefined && isString(description))
    out.description = description.string;
  return out;
}

/**
 * The expression a held operand of `Head`/`Tail` stands for.
 *
 * Both operators are structural, but they are NOT value-blind: a symbol
 * operand is resolved through its BINDING — the expression the symbol is
 * bound to, chased through symbol-to-symbol bindings — without EVALUATING
 * that expression. With `x := a + 1`, `Head(x)` is `Add` whether or not `a`
 * has a value, exactly as `Head(a + 1)` written directly is `Add`. This is
 * what makes `Head(e)`/`Tail(e)` inside a `hold` function report what the
 * caller wrote (`hold f(e) = Head(e); f(a + 1)` → `Add`), and it is why the
 * resolution is a lookup and not `.evaluate()` (which would answer `Integer`
 * once `a` is `3`, as Mathematica does).
 *
 * Only a symbol whose value substitutes at `evaluate` time is chased: a
 * numeric constant such as `Pi` (`holdUntil: 'N'`) and an operator name
 * (`Sin`) stay symbols with head `Symbol`. A self-referential binding
 * (`a := a + 1`) already reads as unbound through `BoxedSymbol.value`; a
 * symbol-to-symbol cycle created on a scope directly (`a := b; b := a`) is
 * caught by the visited set, and the chase then stops at the symbol where
 * the cycle closes — no arbitrary depth cap, so a long but honest chain is
 * never truncated to an intermediate answer.
 */
function boundExpression(x: Expression): Expression {
  let cur = x.canonical;
  const visited = new Set<string>();
  for (;;) {
    if (!isSymbol(cur)) return cur;
    const def = cur.valueDefinition;
    if (def === undefined || def.holdUntil !== 'evaluate') return cur;
    if (visited.has(cur.symbol)) return cur;
    visited.add(cur.symbol);
    const v = cur.value;
    if (v === undefined) return cur;
    cur = v;
  }
}

/** The names of the partial canonical forms that `canonicalForm()` applies
 * (the `CanonicalForm` type). */
const CANONICAL_FORM_NAMES: ReadonlySet<string> = new Set([
  'InvisibleOperator',
  'Number',
  'Multiply',
  'Add',
  'Power',
  'Divide',
  'Flatten',
  'Order',
]);

export const CORE_LIBRARY: SymbolDefinitions[] = [
  {
    // `Block` is in `core` because a function literal (`Function`, below)
    // is canonicalized with a `Block` body: without it, an engine whose
    // library list has `core` but not `control-structures` could not build
    // any function literal. Its handlers live in `control-structures.ts`.
    Block: BLOCK_DEFINITION,

    // The sole member of the unit type, `nothing`
    Nothing: {
      description: 'The absence of a value; the sole member of the unit type.',
      type: 'nothing',
      examples: ['[1, Nothing, 2]'],
    },

    // The sole member of the unit type, `missing`.
    //
    // `Nothing` and `Missing` are complementary absence markers:
    // - `Nothing` is an ERASURE marker (an empty-sequence splice): it is
    //   elided from operator argument lists (`Nothing + 1` → `1`) and from
    //   collection literals (`[12, Nothing, 34]` → `[12, 34]`).
    // - `Missing` is a POSITION-PRESERVING marker: "a position exists, its
    //   value is absent" (Julia `missing`, R `NA`). It is never elided, and
    //   it propagates through numeric operations (`Missing + 1` → `NaN`)
    //   and through data-consuming aggregates.
    Missing: {
      description:
        'A value that is absent but whose position is preserved (Julia `missing`, R `NA`); the sole member of the `missing` type.',
      type: 'missing',
      examples: ['Missing + 1'],
    },
  },

  //
  // Inert functions
  //
  {
    /**
     * ### THEORY OF OPERATIONS: SEQUENCES
     *
     * There are three similar functions used to represent sequences of
     * expressions:
     *
     * - `InvisibleOperator` represent a sequence of expressions
     *  that are syntactically juxtaposed without any separator or
     *  operators combining them.
     *
     *  For example, `2x` is represented as `["InvisibleOperator", 2, "x"]`.
     *  `InvisibleOperator` gets transformed into `Multiply` (or some other
     *  semantic operation) during canonicalization.
     *
     * - `Sequence` is used to represent a sequence of expressions
     *   at a semantic level. It is a collection, but it is handled
     *   specially when canonicalizing expressions, for example it
     *   is automatically flattened and hoisted to the top level of the
     *   argument list.
     *
     *   For example:
     *
     *     `["Add", "a", ["Sequence", "b", "c"]]`
     *
     *   is canonicalized to
     *
     *     `["Add", "a", "b", "c"]`.
     *
     *   The empty `Sequence` expression (i.e. `["Sequence"]`) is ignored
     *   but it can be used to represent an "empty" expression. It is a
     *   synonym for `Nothing`.
     *
     * - `Delimiter` is used to represent a group of expressions
     *   with an open and close delimiter and a separator.
     *
     *   They capture the input syntax, and can get transformed into other
     *   expressions during boxing and canonicalization.
     *
     *   The first argument is a function expression, such as `List`
     *   or `Sequence`. The arguments of that expression are represented
     *   with a separator between them and delimiters around the whole
     *   group.
     *
     *   If the first argument is a `Sequence` with a single element,
     *   the `Sequence` can be omitted.
     *
     *   The second argument specify the separator and delimiters. If not
     *   specified, the default is the string `"(,)"`
     *
     * Examples:
     * - `f(x)` ->
     *    `["InvisibleOperator",
     *        "f",
     *        ["Delimiter", "x"]
     *     ]`
     *
     * - `1, 2; 3, 4` ->
     *    `["Delimiter",
     *      ["Sequence",
     *        ["Delimiter", ["Sequence", 1, 2], "','"],
     *        ["Delimiter", ["Sequence", 3, 4], "','"],
     *      ],
     *     "';'"
     *    ]`
     *
     * - `2x` -> `["InvisibleOperator", 2, "x"]`
     *
     * - `2+` -> `["InvisibleOperator", 2,
     *              ["Error", "'unexpected-operator'", "+"]]`
     *
     *
     *
     *
     */
    InvisibleOperator: {
      description:
        'Implicit operator used for juxtapositions such as function application or multiplication.',
      complexity: 9000,
      lazy: true,
      signature: 'function',
      examples: ['InvisibleOperator(2, x)'],
      // Note: since the canonical form will be a different operator,
      // no need to calculate the result type
      canonical: (x, { engine }) => {
        // `canonicalInvisibleOperator` only decides *which operator* the
        // juxtaposition is; it does not canonicalize the operator it turns
        // into. So when it answers `Multiply`, run that operator's own
        // canonicalization here — this is what drops the unit factor and
        // folds exact numerics, e.g. `1(2+3)` → `5`. It is also the only
        // route by which the product gets flattened, since `Multiply` has no
        // `canonical` handler of its own (see `canonicalMultiply`).
        const y = canonicalInvisibleOperator(x, { engine });
        if (!y) return engine.Nothing;
        if (isFunction(y, 'Multiply')) return canonicalMultiply(engine, y.ops);
        return y;
      },
    },

    /** See above for a theory of operations */
    Sequence: {
      description: 'Ordered sequence of expressions.',
      lazy: true,
      signature: 'function',
      examples: ['[0, Sequence(1, 2), 3]'],
      type: (args, context) => {
        if (args.length === 0)
          return BoxedType.forResult('nothing', context.engine._typeResolver);
        if (args.length === 1)
          return BoxedType.forResult(
            args[0].type,
            context.engine._typeResolver
          );
        // Built STRUCTURALLY: serializing the operand types into a
        // `tuple<…>` string and reparsing it loses any user-declared type
        // name (a resolver-less `parseType()` cannot read it back). Each
        // slot carries the operand's stored-contract type — a number
        // literal's tier, never its literal type (`storedComponentTypeD`).
        return BoxedType.forResult(
          {
            kind: 'tuple',
            elements: args.map((a) => ({ type: storedComponentTypeD(a) })),
          },
          context.engine._typeResolver
        );
      },
      canonical: (args, { engine: ce }) => {
        const xs = flatten(args);
        if (xs.length === 0) return ce.Nothing;
        if (xs.length === 1) return xs[0];
        return ce._fn('Sequence', xs);
      },
    },

    /** See above for a theory of operations */
    Delimiter: {
      description: 'Group expressions with explicit delimiters.',
      // Use to represent groups of expressions.
      // Named after https://en.wikipedia.org/wiki/Delimiter
      complexity: 9000,
      lazy: true,
      signature: '(any, string?) -> any',
      examples: ['Delimiter(1 + 2)'],
      // Echoes the body operand's type; nothing but the type is read.
      type: (args, context) => {
        if (args.length === 0)
          return BoxedType.forResult('nothing', context.engine._typeResolver);
        return BoxedType.forResult(args[0].type, context.engine._typeResolver);
      },

      canonical: (args, { engine: ce }) => {
        // During parsing, no interpretation is made of the delimiters.
        // This gives more option to this handler, or handler of
        // other functions that use `Delimiter` as a parameter.

        // An empty delimiter, i.e. `()` is an empty tuple.
        // Note: this codepath is not hit by `f()`, which is
        // handled in `InvisibleOperator`.
        if (args.length === 0) return ce._fn('Tuple', []);

        // The Delimiter function can have:
        // - a single argument, which is a sequence of expressions
        // - two arguments, the first is a sequence of expressions
        //   and the second is a delimiter string
        if (args.length > 2)
          return ce._fn('Delimiter', checkArity(ce, args, 2));

        // A Delimiter with no delimiter string or with parentheses returns
        // its canonical body unchanged (see below). When that body is itself
        // a non-canonical Delimiter, the result is therefore the canonical
        // form of the inner Delimiter. Peel such wrappers in a loop instead of
        // recursing through `body.canonical`: a chain of nested parentheses
        // (`((((1))))`, built by code thousands of levels deep) would
        // otherwise overflow the call stack inside this handler.
        while (args.length > 0 && args.length <= 2) {
          const outer = isString(args[1]) ? args[1].string : undefined;
          if (outer && !(outer.startsWith('(') && outer.endsWith(')'))) break;
          const inner = args[0];
          if (!isFunction(inner, 'Delimiter') || inner.isCanonical) break;
          args = inner.ops;
        }
        if (args.length === 0) return ce._fn('Tuple', []);
        if (args.length > 2)
          return ce._fn('Delimiter', checkArity(ce, args, 2));

        let body = args[0];

        // If the body is a sequence, turn it into a Tuple
        // We'll have a sequence when there is a delimiter inside
        // the sequence, like `(a, b, c)`. The sequence is used to group
        // the arguments, so it needs to be preserved.
        // If there is a single element, unpack it.
        //
        // A parenthesized list with at least one LIST coordinate (a finite
        // indexed collection of numbers, see `isPointListCoordinateSource`)
        // and only number coordinates otherwise (`isPointListReading`) is a
        // LIST OF POINTS, the Desmos reading: `(A, B)` with
        // `A = [1, 2, 3]` and `B = [10, 20, 30]` is the points `(1, 10),
        // (2, 20), (3, 30)`. It is canonicalized to `PointList(…)`, so its
        // value, its type, its compiled code and every operator that reads
        // it (`+`, `Length`, `Norm`, `PointX`…) see the same list of points.
        // The pairing is therefore the `PointList` one: a scalar coordinate
        // is repeated at every point (`(A, 0)` is the points `(aᵢ, 0)`), and
        // sources of unequal lengths stop at the SHORTEST one. That rule was
        // chosen so that `(A, B)` and `PointList(A, B)` are the same value.
        //
        // The reading is decided ONCE, when the expression is canonicalized,
        // from the operand types known at that moment: a symbol declared or
        // assigned a list of numbers before that makes it a point list. A
        // symbol of unknown type, or one declared a bare `list` (whose
        // elements are not known to be numbers), keeps it a plain `Tuple`,
        // and that reading stays even if the symbol is assigned a list of
        // numbers later. A host that assigns values after parsing re-parses
        // the expression to get the point-list reading (a document manager
        // that declares every head before parsing, and re-parses every row
        // after a change, always sees the current types).
        //
        // A coordinate that is not a number or a list of numbers (a string,
        // a set, a boolean, a matrix, a point list) is not in scope: that
        // list stays a `Tuple` whose coordinates are kept whole.
        //
        // Only this LaTeX surface form, with no delimiter or with
        // parentheses, is read this way. A MathJSON `Tuple` (the box route,
        // an Epsil tuple literal, the result of `Tally` or `Eigen`) holds
        // several values side by side and stays a `Tuple`, and so does a
        // list with other delimiters (`Delimiter(Sequence(A, B), "[,]")`).
        //
        // Otherwise this site builds the `Tuple` DIRECTLY (`_fn` does not run
        // `Tuple`'s canonical handler), so it has to apply the same two
        // operand-list rules that handler applies, or the two routes to a
        // tuple disagree: a `Sequence` operand is SPLICED (it is the
        // engine-wide "these operands, inlined here" marker and must never be
        // stored as an element) and `Nothing` is ERASED, so `(1, Nothing, 3)`
        // is the 2-tuple `(1, 3)`. Both are what `flatten` does. In practice
        // the enclosing `Sequence` has already flattened recursively by the
        // time it gets here, so the splice half is defensive; the erasure
        // half is load-bearing.
        const delim = isString(args[1]) ? args[1].string : undefined;

        if (isFunction(body, 'Sequence')) {
          const xs = flatten(canonical(ce, body.ops));
          if (
            (delim === undefined || delim === '(,)') &&
            isPointListReading(xs)
          )
            return ce._fn('PointList', xs);
          return ce._fn('Tuple', xs);
        }

        body = body.canonical;

        // If we have a single argument and parentheses, i.e. `(2)`, return
        // the argument
        if (!delim || (delim.startsWith('(') && delim.endsWith(')')))
          return body;

        if ((delim?.length ?? 0) > 3) {
          return ce._fn('Delimiter', [
            body,
            ce.error('invalid-delimiter', args[1].toString()),
          ]);
        }

        return ce._fn('Delimiter', [args[0], checkType(ce, args[1], 'string')]);
      },
      evaluate: (ops, options) => {
        const ce = options.engine;
        if (ops.length === 0) return ce.Nothing;

        const op1 = ops[0];

        if (
          (op1.operator === 'Sequence' || op1.operator === 'Delimiter') &&
          isFunction(ops[0])
        )
          ops = flattenSequence(ops[0].ops);

        if (ops.length === 1) return ops[0].evaluate(options);

        return ce._fn(
          'Tuple',
          ops.map((x) => x.evaluate(options))
        );
      },
    },

    Error: {
      description: 'Represent an error expression.',
      /**
       * - The first argument is either a string or an `["ErrorCode"]`
       * expression indicating the nature of the error.
       * - The second argument, if present, indicates the context/location
       * of the error. If the error occur while parsing a LaTeX string,
       * for example, the argument will be a `Latex` expression.
       */
      lazy: true,
      complexity: 500,
      signature: '((string|expression<ErrorCode>), expression?) -> nothing',
      examples: ['[1, RuntimeError("zero")]'],
      // To make a canonical expression, don't canonicalize the args
      canonical: (args, { engine: ce }) => ce._fn('Error', args),
    },

    ErrorCode: {
      description: 'Structured error code with optional arguments.',
      complexity: 500,
      lazy: true,
      signature: '(string, any*) -> error',
      examples: ['[1, RuntimeError(ErrorCode("out-of-range", 5))]'],
      canonical: (args, { engine: ce }) => {
        const checked = checkType(ce, args[0], 'string');
        const code = isString(checked) ? checked.string : undefined;
        if (code === 'incompatible-type') {
          return ce._fn('ErrorCode', [ce.string(code), args[1], args[2]]);
        }
        return ce._fn('ErrorCode', args);
      },
    },

    // The runtime counterpart of a written `Error(…)`. A written `Error` node
    // is a STATIC diagnostic: it makes every tree above it invalid, so a
    // function whose body spells `Error("neg")` never gets a function type
    // and its declaration never takes effect. `RuntimeError("neg")` is an
    // ordinary, VALID application whose EVALUATION produces the `Error`
    // value — the same value shape `Length(5)` produces — so it flows through
    // application, `match`, and Epsil's `if let v: !error = …` like any
    // engine-raised failure. The result type is `never`: a signature describes
    // the successes (Contract B, `docs/ERROR-MODEL.md` §4), and this operator
    // has none, so `If(x > 0, x, RuntimeError("neg"))` types as `x` does.
    // Only the code is taken — the `where` operand of `Error` names the
    // offending sub-expression of a static diagnostic, which a runtime
    // failure does not have (user ruling 2026-09-03).
    RuntimeError: {
      description:
        'Construct an error value when evaluated: the runtime counterpart ' +
        'of a written `Error(…)`, which is a static diagnostic node. ' +
        'Evaluates to `Error(code)`.',
      complexity: 500,
      signature: '(string|expression<ErrorCode>) -> never',
      examples: ['IsError(RuntimeError("oops"))'],
      evaluate: ([code], { engine: ce }) => {
        if (code === undefined) return undefined;
        if (isString(code)) return ce.error(code.string);
        if (isFunction(code, 'ErrorCode')) return ce._fn('Error', [code]);
        // A symbolic code (an unbound symbol) has no value yet: stay inert.
        return undefined;
      },
    },

    Unevaluated: {
      description: 'Prevent an expression from being evaluated',
      // Unlike Hold, the argument is canonicalized
      lazy: true,
      signature: '(any) -> unknown',
      type: ([x], context) =>
        BoxedType.forResult(x.type, context.engine._typeResolver),
      canonical: (args, { engine: ce, scope }) =>
        ce._fn('Unevaluated', canonical(ce, args, scope)),
      evaluate: ([x], options) => x.evaluate(options),
    },

    IsMissing: {
      description:
        'True if the value is ABSENT — the `Missing` or `Undefined` symbol, ' +
        'or a `NaN` number (regardless of provenance). R’s `is.na` (`TRUE` ' +
        'for both `NA` and `NaN`). There is no NaN-specific test operator ' +
        '(R’s `is.nan`). `Indeterminate`, the exact answer to an ' +
        'indeterminate form such as `0/0`, is a value and is not absent.',
      complexity: 500,
      signature: '(any) -> boolean',
      examples: ['[IsMissing(Missing), IsMissing(NaN), IsMissing(0)]'],
      evaluate: ([x], { engine: ce }) =>
        x !== undefined && isAbsentValue(x) ? ce.True : ce.False,
    },

    Coalesce: {
      description:
        'Return the first operand that is not ABSENT (`Missing`, ' +
        '`Undefined` or `NaN`), evaluated left-to-right. If every operand ' +
        'is absent, the last operand’s value is returned verbatim (still ' +
        'absent). `Indeterminate` is a value and is not absent.',
      complexity: 500,
      // Lazy so operands are evaluated on demand (short-circuit) rather than
      // all up front. Per the documented lazy-operator trap, a lazy operator
      // with NO `canonical` handler is inert on the box/parse routes (held
      // operands arrive UNBOUND) — the `canonical` handler below canonicalizes
      // each held operand (value-safe: `.canonical` binds structure without
      // substituting assigned symbol values).
      lazy: true,
      // Selects among its operands, so an error in an operand it does not
      // choose does not bubble (`docs/ERROR-MODEL.md` §3).
      selectsOperands: true,
      // Accept absence into any operand position (a `Missing` operand is the
      // whole point) — declared `handle`, stripping every position (§3.A).
      missingBehavior: 'handle',
      signature: '(any+) -> unknown',
      examples: ['Coalesce(Missing, NaN, 3, 4)'],
      // Result type `T₁° | … | Tₙ₋₁° | Tₙ` (§3.D): every operand but the last
      // contributes its stripped type (its `| missing` arm removed), the last
      // its full type. An arm-free final operand yields an arm-free result
      // type — but that never promises presence (`NaN ∈ number`, I6).
      //
      // `'types'`-shape handler: reads operand descriptors, never operand
      // expressions, so the derivation cannot touch engine state.
      type: (operands, context) => {
        if (operands.length === 0)
          return BoxedType.forResult('nothing', context.engine._typeResolver);
        const arms = operands.map((op, i) =>
          i < operands.length - 1 ? stripMissingFromType(op.type) : op.type
        );
        return BoxedType.forResult(
          widen(...arms) as Type,
          context.engine._typeResolver
        );
      },
      canonical: (args, { engine: ce, scope }) => {
        if (args.length === 0) return ce.error('missing');
        return ce._fn('Coalesce', canonical(ce, args, scope));
      },
      evaluate: (ops, { engine: ce, numericApproximation }) => {
        if (ops.length === 0) return ce.error('missing');
        let last: Expression | undefined = undefined;
        for (let i = 0; i < ops.length; i++) {
          const v = ops[i].evaluate({ numericApproximation });
          last = v;
          // Skip an absent operand (`Missing`, `Undefined` or `NaN`).
          if (isAbsentValue(v)) continue;
          // An operand whose absence cannot be decided (it still carries free
          // variables) leaves the expression partially unevaluated from here
          // on: return `Coalesce` of this operand and the remaining tail —
          // with the tail left UNEVALUATED. `Coalesce` short-circuits, so an
          // operand past an undecided one may never be needed; evaluating it
          // here would run its effects (and surface its errors) on a path the
          // decided case never takes. It also makes the nested form
          // `Coalesce(a, Coalesce(b, c))` and the flat `Coalesce(a, b, c)`
          // observationally equal, which is what lets `a ?? b ?? c` be
          // flattened.
          if (v.freeVariables.length > 0) {
            const tail = [v, ...ops.slice(i + 1)];
            return tail.length === 1 ? tail[0] : ce._fn('Coalesce', tail);
          }
          // A decided, non-absent value: this is the result.
          return v;
        }
        // Every operand was absent: return the last operand's value verbatim
        // (still absent).
        return last!;
      },
    },

    Hold: {
      description:
        'Hold an expression, preventing it from being canonicalized or evaluated until `ReleaseHold` is applied to it',
      lazy: true,
      // QUOTE, not may-evaluate: `Hold` never evaluates its content, so the
      // content contributes NO effects — `effectsOf(Hold(Random()))` is the
      // empty set and `Hold(Random())` is pure (`docs/EFFECTS-MODEL.md`, the
      // held-operand clause; `RANDOMNESS-MODEL.md` §2's inert-content ruling).
      // The effects resurface at `ReleaseHold`, which evaluates the content
      // under whatever frame is active then. The pending-draw walk's `Hold`
      // exception is DERIVED from this flag.
      holdClass: 'quote',
      // An observer: `Hold` never looks INSIDE its operand, so a failed one is
      // held like any other (rung 3 would otherwise bubble it away on the
      // routes that hand over an already-canonical operand — `("a" + 1) |>
      // Hold`, `Apply(Hold, …)`). Audited: the handler is `engine.hold(x)`,
      // total on any operand.
      inspectsErrors: true,
      signature: '(any) -> unknown',
      examples: ['Hold(1 + 2)'],
      // Note: the operator is lazy and doesn't have a canonical handler:
      // the argument is not canonicalized. The `'types'`-shape handler reads
      // the operand's raw structure through its descriptor — the same
      // as-written view the expressions shape read with the `isSymbol`/
      // `isString`/`isNumber`/`isFunction` guards. Every application kind
      // (compound, tuple, list literal, function literal) lands in the
      // default arm, mirroring the old `isFunction` branch.
      type: ([x], context) => {
        const s = x?.structureOf?.();
        if (s === undefined)
          return BoxedType.forResult('unknown', context.engine._typeResolver);
        switch (s.kind) {
          case 'symbol':
            return BoxedType.forResult('symbol', context.engine._typeResolver);
          case 'string':
            return BoxedType.forResult('string', context.engine._typeResolver);
          case 'number':
            return BoxedType.forResult(x.type, context.engine._typeResolver);
          default:
            return BoxedType.forResult(
              functionResult(x.type) ?? 'unknown',
              context.engine._typeResolver
            );
        }
      },
      // When comparing hold expressions, consider them equal if their
      // arguments are structurally equal.
      eq: (a, b) => {
        if (isFunction(b, 'Hold')) b = b.ops[0];
        if (!isFunction(a)) return false;
        return a.ops[0].isSame(b);
      },
      evaluate: ([x], { engine }) => engine.hold(x),
    },

    ReleaseHold: {
      description: 'Release an expression held by `Hold`',
      lazy: true,
      // FORCES a quote: the effects `Hold` deferred resurface here (the
      // held-operand clause of `docs/EFFECTS-MODEL.md`), so the projection
      // strips one `Hold` layer and recurses into the content —
      // `effectsOf(ReleaseHold(Hold(Random())))` is `{random}` while
      // `effectsOf(Hold(Random()))` is empty.
      holdClass: 'release',
      signature: '(any) -> unknown',
      examples: ['ReleaseHold(Hold(1 + 2))'],
      // The result type of releasing a literal `Hold` is its content's type
      // (the descriptor of the held operand's first child); anything else
      // keeps its own type. `'nothing'` for the degenerate argument-less
      // `Hold()`, matching what the expressions shape read off `op1`.
      type: ([x], context) => {
        const s = x?.structureOf?.();
        if (s?.kind === 'application' && s.head === 'Hold')
          return BoxedType.forResult(
            s.children[0]?.type ?? 'nothing',
            context.engine._typeResolver
          );
        return BoxedType.forResult(
          x?.type ?? 'unknown',
          context.engine._typeResolver
        );
      },
      // Note: the operator is lazy and doesn't have a canonical handler:
      // the argument is not canonicalized.
      evaluate: ([x], options) => {
        if (isFunction(x, 'Hold')) return x.op1.canonical.evaluate(options);
        // The operand is not a literal `Hold`: evaluate it, and if the RESULT
        // is a held expression (e.g. a symbol whose value is a `Hold`),
        // release that — one layer, like Mathematica's `ReleaseHold`.
        const v = x.canonical.evaluate(options);
        if (isFunction(v, 'Hold')) return v.op1.canonical.evaluate(options);
        return v;
      },
      // The asynchronous twin: the released expression is evaluated with
      // `evaluateAsync`, so that a long one yields to the event loop and
      // honours the abort signal (GitHub issue #392).
      evaluateAsync: async (
        [x],
        { numericApproximation, signal, effects, _contextStack }
      ) => {
        const opts = {
          numericApproximation,
          signal,
          _effects: effects,
          _contextStack,
        };
        if (isFunction(x, 'Hold')) return x.op1.canonical.evaluateAsync(opts);
        const v = await x.canonical.evaluateAsync(opts);
        if (isFunction(v, 'Hold')) return v.op1.canonical.evaluateAsync(opts);
        return v;
      },
    },

    HorizontalSpacing: {
      description: 'Horizontal spacing annotation.',
      signature: '(number) -> nothing',
      canonical: (args, { engine: ce }) => {
        if (args.length === 2) return args[0].canonical;
        // Returning `Nothing` will make the expression be ignored
        return ce.Nothing;
      },
    },

    Annotated: {
      description: 'Attach metadata or style annotations to an expression.',
      signature: '(expression, dictionary<any>) -> expression',
      examples: ['Annotated(x^2, {"color" -> "blue"})'],
      // Transparent to the type system: the annotated expression's own type.
      type: ([x], context) =>
        BoxedType.forResult(x.type, context.engine._typeResolver),
      complexity: 9000,
      lazy: true,
      canonical: (ops, { engine: ce }) => {
        // A missing operand is an `Error("missing")` operand, as for the
        // other operators (`checkArity()`).
        if (ops.length < 2)
          return ce._fn(
            'Annotated',
            checkArity(
              ce,
              ops.map((x) => x.canonical),
              2
            )
          );
        let [x, style] = ops;
        x = x.canonical;
        style = style.canonical;

        // Is the style dictionary empty?
        if (!isDictionary(style) || style.keys.length === 0) return x;

        return ce._fn('Annotated', [x, style]);
      },
      evaluate: ([x, _style], options) => x.evaluate(options),
      // Annotated is transparent at run time; a custom compile handler could
      // lower it to its value: `compile: (args, compile) => compile(args[0])`.
    },

    Typed: {
      description:
        'Ascribe a type to an expression. The type is asserted for the type ' +
        'system (ascription, not a check); evaluation is transparent. Used to ' +
        'annotate `Function` literal parameters and return types.',
      complexity: 9000,
      // `lazy` so the type operand stays raw (a type-name symbol such as `real`
      // is not auto-declared as a variable).
      lazy: true,
      // An ascription never applies its operand: `Typed(x => Random(), T)`
      // only states a type for the literal. Without this flag both effect
      // channels read the first operand as an invoking position (the default
      // for an operator that declares nothing) and project the literal's
      // latent effects onto the enclosing function. The parser puts a return
      // marker on a body's LAST statement, so every ascribed function whose
      // result is a lambda was read as having that lambda's effects —
      // `function make() -> ((number) random -> number) { x => Random() * x }`
      // typed `() random -> …`, and the same body under a `pure` contract
      // was rejected.
      invokes: false,
      signature: '(any, string | symbol) -> unknown',
      examples: ['Typed(2 + 3, "integer")'],
      // The ascribed type is read from the second operand's inert structure —
      // a string literal's text, or a type-name symbol's name — and resolved
      // with the engine's type resolver, which is a pure read.
      type: ([x, t], { engine: ce }) => {
        if (!t)
          return BoxedType.forResult(x?.type ?? 'unknown', ce._typeResolver);
        const s = typeTextOf(t);
        let parsed: Type | undefined;
        try {
          parsed = parseType(s, ce._typeResolver);
        } catch {
          parsed = undefined;
        }
        return BoxedType.forResult(
          parsed ?? x?.type ?? 'unknown',
          ce._typeResolver
        );
      },
      canonical: ([x, t], { engine: ce }) => {
        if (t === undefined) return x?.canonical ?? ce.Nothing;
        // Normalize the type operand to a string WITHOUT canonicalizing it
        // (so a type-name symbol such as `real` is not auto-declared as a
        // variable), mirroring how `Declare` keeps its type operand raw.
        // An operand that is already a string is kept as the SAME node: the
        // inference mark of a parameter annotation is keyed on it (see
        // `isInferredTypedParameter`, `boxed-expression/inferred-annotations.ts`).
        const s = sym(t);
        const typeOp = isString(t) ? t : s !== undefined ? ce.string(s) : t;
        return ce._fn('Typed', [x.canonical, typeOp]);
      },
      // Ascription is transparent at evaluation.
      evaluate: ([x], options) => x?.evaluate(options),
    },

    Object: {
      description:
        'Provenance head for the snapshot of a mutable object: ' +
        '`["Object", <record>, "\'TypeName\'"]`. The record holds the ' +
        "object's stored fields at the moment it was serialized; the second " +
        'operand names the nominal type the object had. Not a constructor ' +
        'and not an ascription — it wraps data, it does not make an object.',
      complexity: 9000,
      // The type-name operand is a STRING (`"'Person'"` in MathJSON), the
      // shape the object walk emits, so nothing here risks auto-declaring a
      // type name as a variable and this definition needs no `lazy`/canonical
      // handler. It is optional: the form stays valid without it.
      signature: '(any, string?) -> unknown',
      // The head is PROVENANCE, not an ascription: the static type is the
      // wrapped record's, never the named nominal object type. Reporting the
      // object type would be the `Typed` mistake the spec review killed — a
      // reloaded snapshot would statically be a `Person` while the value is a
      // record, admitting object-only dispatch and property stores that then
      // fail or corrupt at runtime. (`docs/TYPE_SYSTEM_ROADMAP.md`
      // Appendix B, "Serialization".)
      //
      // What makes that contract say something is the SHAPE of the body the
      // object walk emits: the `["Dictionary", ["KeyValuePair", …], …]`
      // operator form, which re-boxes as a `BoxedDictionary` typed from its
      // keys (`record{name: string, age: integer}`). A body with no
      // operator definition — `["Record", …]`, which no library declares —
      // would re-box as an inert application typed `unknown`, and this
      // handler would report `unknown` for every snapshot.
      type: ([x], context) =>
        BoxedType.forResult(x?.type ?? 'unknown', context.engine._typeResolver),
      // Transparent: it yields the wrapped record. Reconstruction is
      // deliberately NOT the evaluation semantics — a snapshot must never
      // silently mint a fresh object, so this handler never constructs one
      // (`ce._object()` is the only path that does). Re-boxing an object's
      // `.json` is a ONE-WAY door: what comes back is data.
      evaluate: ([x], options) => x?.evaluate(options),
    },

    Text: {
      description:
        'A sequence of strings, annotated expressions and other Text expressions',
      signature: '(any*) -> string',
      examples: ['Text("Total: ", 42)'],
      evaluate: (ops, { engine: ce }) => {
        if (ops.length === 0) return ce.string('');
        const parts: string[] = [];
        for (const op of ops) {
          // Unwrap Annotated (strip style annotations)
          const unwrapped = isFunction(op, 'Annotated') ? op.op1 : op;
          if (isString(unwrapped)) parts.push(unwrapped.string);
          else {
            const evaluated = unwrapped;
            if (isString(evaluated)) parts.push(evaluated.string);
            else parts.push(evaluated.toString());
          }
        }
        return ce.string(parts.join(''));
      },
    },
  },
  {
    //
    // Structural operations that can be applied to non-canonical expressions
    //
    About: {
      description:
        'Return information about an expression as a dictionary: its kind ' +
        '(symbol, constant, function, number, string, expression), its ' +
        'static type and, when applicable, its name, value, signature, ' +
        'clause listing, attributes (the algebraic flags and `lazy`), ' +
        'description, examples, keywords, wikidata and url.',
      lazy: true,
      // `dictionary<any>`, not bare `dictionary` (≡ `dictionary<unknown>`,
      // values only): a `value` entry may legitimately be an absence marker
      // such as `Missing`.
      signature: '(any) -> dictionary<any>',
      examples: ['About(Pi)'],
      evaluate: ([x], { engine: ce }) => {
        // Entries are collected in display order, then assembled into a
        // `Dictionary` expression (the documented contract: `About` yields a
        // dictionary, so its parts are addressable — `About(f)["type"]` —
        // rather than baked into one display string).
        const entries: [key: string, value: Expression][] = [];
        const add = (key: string, value: Expression | string): void => {
          entries.push([
            key,
            typeof value === 'string' ? ce.string(value) : value,
          ]);
        };
        // A list of strings, for the multi-valued entries.
        const addList = (key: string, values: readonly string[]): void => {
          if (values.length > 0)
            add(
              key,
              ce.function(
                'List',
                values.map((v) => ce.string(v))
              )
            );
        };
        // The `attributes` entry of an operator: its algebraic flags, then
        // `lazy` when its arguments are passed to it unevaluated (a `hold`
        // function, `Hold`, but also `Add` and `Multiply`, which
        // canonicalize their own arguments).
        const addAttributes = (op: BoxedOperatorDefinition): void => {
          const flags: string[] = (
            ['commutative', 'associative', 'idempotent', 'involution'] as const
          ).filter((f) => op[f] === true);
          if (op.lazy === true) flags.push('lazy');
          addList('attributes', flags);
        };

        if (isString(x)) {
          add('kind', 'string');
          add('type', 'string');
          add('value', x);
        } else if (isSymbol(x)) {
          // A held symbol operand is unbound: name it directly rather than
          // through its (quoted, raw) serialization.
          add('name', x.symbol);
          // A multi-clause function: list the clause set — signature per
          // clause, declaration order, with overlap/coverage annotations
          // (function-polymorphism design §4.6). This is the `methods(f)`
          // equivalent: "what does `f` currently dispatch to?".
          const clauses = clauseListing(ce, x.symbol);
          if (clauses !== undefined) {
            // ≥2 clauses by construction (§4.2): a single clause installs
            // as an ordinary function and has no clause listing — EXCEPT a
            // `hold` function, which always lives in clause storage as its
            // lone clause (see `FunctionClause.hold`, multi-clause.ts).
            const fnDef = ce.lookupDefinition(x.symbol);
            if (
              clauses.length === 1 &&
              fnDef !== undefined &&
              isOperatorDef(fnDef) &&
              fnDef.operator.lazy === true
            )
              add('kind', 'hold function (arguments are bound unevaluated)');
            else
              add('kind', `multi-clause function (${clauses.length} clauses)`);
            add(
              'clauses',
              ce.function(
                'List',
                clauses.map((c) => ce.string(c))
              )
            );
            if (fnDef !== undefined && isOperatorDef(fnDef)) {
              const op = fnDef.operator;
              addAttributes(op);
              // The doc-comment description; the auto-generated clause-storage
              // description ("Multi-clause function (…)", "Hold function (…)")
              // is already conveyed by the `kind` entry above.
              const d = op.description;
              if (
                typeof d === 'string' &&
                !d.startsWith('Multi-clause function') &&
                !d.startsWith('Hold function')
              )
                add('description', d);
            }
          } else {
            // Look the name up in the current scope chain rather than
            // through `x.canonical.valueDefinition`: a constant declared
            // `holdUntil: 'never'` (`Half`, `ImaginaryUnit`) is SUBSTITUTED
            // by its value at canonicalization, so its canonical form is a
            // number literal with no value definition and the lookup is the
            // only route to its metadata.
            const symDef = ce.lookupDefinition(x.symbol);
            if (symDef !== undefined && isValueDef(symDef)) {
              const def = symDef.value;

              add('kind', def.isConstant ? 'constant' : 'symbol');
              // Canonicalizing binds the held symbol (`op.canonical` is
              // value-safe — for a substituted constant it yields the value
              // itself, whose type is the right report).
              const xc = x.canonical;
              add('type', xc.type.toString());
              // The value, when the symbol resolves to one distinct from
              // itself (a constant such as `Pi` evaluates to itself, so an
              // identical `value` entry would be noise). Compare by NAME:
              // `v.isSame(x)` is unreliably false here because `x` is the
              // raw held symbol while `v` is its bound canonical form.
              const v = xc.evaluate();
              if (!isSymbol(v) || v.symbol !== x.symbol) add('value', v);

              if (typeof def.description === 'string')
                add('description', def.description);
              else if (Array.isArray(def.description))
                add('description', def.description.join('\n'));
              addList('examples', def.examples ?? []);
              addList('keywords', def.keywords ?? []);
              if (def.wikidata) add('wikidata', def.wikidata);
              if (def.url) add('url', def.url);
            } else if (symDef !== undefined && isOperatorDef(symDef)) {
              // A FUNCTION name: a user-defined function (or a library
              // operator) reports its signature, its description — for a
              // user function, the doc comment written before the
              // definition — and its algebraic attributes.
              const op = symDef.operator;
              add('kind', 'function');
              add('signature', op.signature.toString());
              addAttributes(op);
              if (typeof op.description === 'string')
                add('description', op.description);
              else if (Array.isArray(op.description))
                add('description', op.description.join('\n'));
              addList('examples', op.examples ?? []);
              addList('keywords', op.keywords ?? []);
              if (op.wikidata) add('wikidata', op.wikidata);
              if (op.url) add('url', op.url);
            } else {
              add('kind', 'symbol');
              // Canonicalizing binds the held symbol without substituting
              // its value (`op.canonical` is value-safe), so the static
              // type is the declared/inferred one — the same report as
              // `Type(x)`.
              const xc = x.canonical;
              add('type', xc.type.toString());
              // Compare by NAME (see the value-definition branch above).
              const v = xc.evaluate();
              if (!isSymbol(v) || v.symbol !== x.symbol) add('value', v);
            }
          }
        } else if (isNumber(x)) {
          add('kind', 'number');
          add('type', x.type.toString());
          add('value', x);
        } else if (isFunction(x)) {
          add('kind', 'expression');
          // The held operand arrives non-canonical on the box/parse routes,
          // where its own `.type` is uninformative: report the type of the
          // canonical form, as `Type` does.
          add('type', x.canonical.type.toString());
        } else add('kind', 'unknown');

        // Evaluate the assembled expression: a `Dictionary` whose values are
        // not all literals (a symbolic `value`, say) only re-boxes as an
        // actual dictionary once its values are evaluated.
        return ce
          .function(
            'Dictionary',
            entries.map(([k, v]) =>
              ce.function('KeyValuePair', [ce.string(k), v])
            )
          )
          .evaluate();
      },
    },

    Head: {
      description: 'Return the head of an expression, the name of the operator',
      lazy: true,
      signature: '(any) -> symbol',
      examples: ['Head(x^2)'],
      canonical: (args, { engine: ce }) => {
        // **IMPORTANT** Head should work on non-canonical expressions
        if (args.length !== 1) return null;
        const op1 = args[0];
        // A symbol operand is NOT folded here: `Head(x)` reports the head of
        // the value bound to `x` at evaluation time (`x := a + 1` → `Add`),
        // so folding it to `Symbol` at canonicalization would be value-blind
        // — and would freeze `f(e) = Head(e)` to the literal `Symbol` at
        // definition time. Only an unbound symbol has head `Symbol`, and only
        // evaluation can tell.
        if (isSymbol(op1)) return ce._fn('Head', canonical(ce, args));
        return ce.expr(op1.operator);
      },
      evaluate: ([x], { engine: ce }) => {
        if (x === undefined) return ce.symbol('Undefined');
        return ce.symbol(boundExpression(x).operator);
      },
    },

    Tail: {
      description:
        'Return the tail of an expression, the operands of the expression',
      lazy: true,
      signature: '(any) -> collection',
      examples: ['[Tail(Max(a, b, c))]'],
      canonical: (args, { engine: ce }) => {
        if (args.length !== 1) return null;
        const op1 = args[0];
        if (isFunction(op1)) return ce._fn('Sequence', op1.ops);
        return ce._fn('Tail', canonical(ce, args));
      },
      // **IMPORTANT** Tail should work on non-canonical expressions
      evaluate: ([x], { engine: ce }) => {
        x = boundExpression(x);
        return isFunction(x) ? ce._fn('Sequence', x.ops) : ce.Nothing;
      },
    },

    Spread: {
      description: [
        'Spread(t): splice the elements of the tuple `t` into the enclosing',
        'argument list (Epsil surface syntax: `f(...t)`).',
        'A literal tuple splices at canonicalization; a symbolic argument is',
        'spliced by the enclosing call at evaluation (step 0 of the evaluate',
        'path), which re-validates the resulting arity.',
      ],
      lazy: true,
      signature: '(any) -> unknown',
      examples: ['Max(...(4, 9, 2))'],
      canonical: (args, { engine: ce }) => {
        if (args.length !== 1) return null;
        // `op.canonical` is value-safe: it binds structure but does not
        // substitute assigned symbol values, so `f(...p)` keeps `p` intact
        // until evaluation.
        const op1 = args[0].canonical;
        if (isFunction(op1, 'Tuple')) return ce._fn('Sequence', [...op1.ops]);
        return ce._fn('Spread', [op1]);
      },
      // Normally consumed by the enclosing call before its own evaluation; a
      // bare `Spread(t)` evaluated directly resolves to a `Sequence`, which
      // splices if it lands in an argument list.
      evaluate: ([x], { engine: ce }) => {
        const v = x.canonical.evaluate();
        if (isFunction(v, 'Tuple')) return ce._fn('Sequence', [...v.ops]);
        return undefined;
      },
    },

    NamedArgument: {
      description: [
        'NamedArgument(name, value): one named argument of a call (Epsil',
        'surface syntax: `f(rate: 0.05)`).',
        'A parse-level carrier, like `Spread`, but one that never survives:',
        'the enclosing call consumes it at canonicalization, permuting the',
        'written arguments into the order its callee declares.',
        'Reaching this definition therefore means the carrier was NOT',
        'consumed — the callee supplied no parameter names to match — which',
        'is the `argument-names-unavailable` error.',
      ],
      lazy: true,
      signature: '(string, any) -> nothing',
      examples: ['((x, y) => x - y)(y: 2, x: 10)'],
      // Consumed by `makeCanonicalFunction` (see
      // `boxed-expression/named-arguments.ts`) before this handler could run,
      // for every callee whose declaration supplies parameter names — a single
      // signature or an overload set, whose arms are permuted individually.
      // What is left is the set of callees that supply none: an unknown or
      // forward-referenced name, a value declared with the bare `function`
      // wildcard, a non-symbol callee applied through `Apply` (sub-ruling R4),
      // and a carrier written outside any call. All four report the same
      // thing — the names could not be checked — so one handler covers them.
      //
      // MUST stay: a `lazy` operator with no `canonical` handler is inert on
      // the box and parse routes, and the carrier would then survive into a
      // canonical expression instead of erroring.
      canonical: (args, { engine: ce }) => {
        const nameOp = args[0];
        const name =
          nameOp !== undefined && isString(nameOp)
            ? (nameOp.string ?? undefined)
            : undefined;
        return ce.error([
          'argument-names-unavailable',
          name ?? '',
          'the callee has no declaration with parameter names to match; call it with positional arguments',
        ]);
      },
    },

    Identity: {
      description: 'Return the argument unchanged',
      signature: '(T) -> T where T',
      examples: ['Identity(x + 1)'],
      evaluate: ([x]) => x,
    },
  },
  {
    Apply: {
      description: 'Apply a function to a list of arguments',
      // An application route: it decides what an `Error` argument means
      // (rung 2 — `apply()` bubbles it) instead of freezing with it.
      inspectsErrors: true,
      // The callee may be a named function, a function literal, or — the
      // constant-nullary shorthand `Apply(3, 5)` is `3`, and an expression
      // is a shorthand literal (`Apply(x + 1, 2)` is `3`) — any expression
      // at all (`apply()`, `boxed-expression/function-utils.ts`). The
      // declared parameter says so, because the boxing validation seam
      // checks a canonical-handler head against its declaration. The
      // arguments are `any` as well: an argument that only EVALUATES to
      // `Nothing` (a call typed `nothing`) is bound, never erased — erasure
      // is a rule on the WRITTEN argument.
      signature: '(name:any, arguments:any*) -> unknown',
      examples: ['Apply(Sqrt, 16)'],
      // An ANONYMOUS application instantiates its callee's `where` clause here
      // (generic-function-literals design §2.5). This is the one application
      // seam that crosses NO symbol/definition boundary — the callee is an
      // expression, so neither the operator-def nor the value-def arm of
      // `boxed-function.ts`'s `type()` runs — and `functionResult` of a polytype
      // hands back the OPEN result, which must never escape as a `.type` (§4.2).
      // Left alone it degraded to `unknown`: `Apply(x => x, 5)` typed
      // `unknown` while `f(5)` under the same signature typed `integer`. The
      // application-head spelling `[⟨literal⟩, 5]` canonicalizes to `Apply`, so
      // it is covered by the same line.
      // Same solver as the value-definition arm, but NOT its `threadable`
      // gate: a GENERIC callee binds each argument WHOLE — `T` binds the
      // collection itself, and there is no wrap on this route to put a rank
      // back — so no position is lift-admitted here and the D10 element
      // bind (§4.4) must not fire. A ground function literal with scalar
      // parameters maps over a collection argument instead, like a named
      // user function (`applyLiteralMaps`, user decision 2026-09-26):
      // `Apply(x ↦ (x, x), [1, 2])` is `[(1, 1), (2, 2)]`. A ground callee
      // that does not map yields `undefined` here and falls through to
      // `functionResult`.
      //
      // The solve runs over the descriptors' solver view
      // (`actualOfDescriptor`), which answers the same five reads off a
      // descriptor that the expression route answers off an operand
      // expression (`instantiatedResultTypeOverActuals`,
      // `boxed-expression/generic-instantiation.ts`).
      type: ([fn, ...args], context) => {
        const { engine } = context;
        const t = fn.type;
        // A function literal with scalar parameters maps over a collection
        // argument (`applyLiteralMaps`): the call is typed as the mapped
        // collection (`applyLiteralMapType`).
        const mapped = applyLiteralMapType(fn, args, context);
        if (mapped !== undefined)
          return BoxedType.forResult(mapped, engine._typeResolver);
        return BoxedType.forResult(
          instantiatedResultTypeOverActuals(t, args.map(actualOfDescriptor), {
            threadable: false,
            resolver: engine._typeResolver,
          }) ??
            functionResult(t) ??
            'unknown',
          engine._typeResolver
        );
      },
      canonical: (args, { engine: ce }) => {
        // A missing callee is an `Error("missing")` operand (`checkArity()`).
        if (args.length === 0) return ce._fn('Apply', checkArity(ce, args, 1));
        const s = sym(args[0]);
        if (s) return ce.function(s, args.slice(1));
        // `Nothing` is ERASED from the call argument list, uniformly on every
        // application route (error-propagation design §4): `Apply(f, Nothing)`
        // is `f()`. The `f(Nothing)` route erases at canonicalization
        // (`flattenOps`); this is the same ruling for a callee that is not a
        // bare symbol (a `Function` literal), which never reaches that path.
        //
        // Erasure belongs HERE, on the written argument, not in `evaluate`:
        // `Apply` is strict, so by evaluation time an argument that merely
        // *evaluated* to `Nothing` (`Apply(f, g())`) is indistinguishable
        // from a literal one, and erasing it would make `Apply(f, g())` —
        // and therefore `g() |> f`, which `Pipe` holds — differ from
        // `f(g())`, which binds it. §3 pins `x |> f ≡ f(x)`.
        const callArgs = args.slice(1).filter((x) => !isSymbol(x, 'Nothing'));
        // An argument that certainly does not match a parameter the literal
        // annotates is its `incompatible-type` error, as for a call of a
        // named function assigned the same literal
        // (`validatedLiteralApplicationOperands`).
        return ce._fn('Apply', [
          args[0],
          ...(validatedLiteralApplicationOperands(ce, args[0], callArgs) ??
            callArgs),
        ]);
      },
      evaluate: (ops, { numericApproximation, engine }) => {
        // A function literal with scalar parameters maps over a collection
        // argument, like a named user function (`applyLiteralMaps`). An
        // error callee or argument bubbles first, as `apply()` does; an
        // error inside a collection's cell is not an error argument
        // (`errorValue` stops at a collection literal) and stays in its cell.
        if (applyLiteralMaps(ops[0], ops.slice(1))) {
          const err =
            errorValue(ops[0]) ??
            ops
              .slice(1)
              .map((a) => errorValue(a))
              .find((e) => e !== undefined);
          if (err !== undefined) return err;
          const mapped = applyLiteralMapped(
            engine,
            ops[0],
            ops.slice(1),
            numericApproximation
          );
          if (mapped !== undefined) return mapped;
        }
        // An argument of a function literal that is an error (refused when
        // the call was boxed, `validatedLiteralApplicationOperands`, or an
        // error when evaluated) is the value of the application, with the
        // breadcrumb frame of this `Apply` and the position of the argument,
        // as a call of a named function gives it (`ErrorFrame('h', 1)`).
        if (isFunction(ops[0], 'Function')) {
          for (let k = 1; k < ops.length; k++) {
            const err = errorValue(ops[k], { operator: 'Apply', index: k + 1 });
            if (err !== undefined) return err;
          }
        }
        // A function literal maps over a TUPLE argument at a parameter
        // declared as a scalar, as the named routes do
        // (`declaredScalarTupleCells`, user decision 2026-10-03):
        // `Apply((u: real) ↦ 2u, (a, b))` is `(2a, 2b)`.
        const tupleMapped = applyLiteralOverTuples(
          engine,
          ops[0],
          ops.slice(1),
          numericApproximation
        );
        if (tupleMapped !== undefined) return tupleMapped;
        const result = apply(ops[0], ops.slice(1));
        // An argument that the literal refuses (a parameter declared `real`
        // and a string argument) is the value of the application, as for a
        // call of a named function (`_refusedArgumentError` in
        // `boxed-function.ts`). `apply()` marks the argument with the error
        // in an inert `Apply`, and that form is not kept here.
        const refused = refusedLiteralArgumentError(
          result,
          ops.slice(1),
          'Apply',
          1
        );
        if (refused !== undefined) return refused;
        if (!numericApproximation) return result;
        // N(f(x)) = N of the applied result: without this, e.g.
        // `Apply(Derivative(LambertW), 0.5).N()` returned the symbolic
        // derivative with `LambertW(0.5)` unevaluated. Guard: when the
        // application stayed symbolic (unresolved symbolic derivative,
        // returned as an `Apply` expression), re-entering N() here would
        // recurse forever.
        if (isFunction(result, 'Apply')) {
          // An application of a `Derivative` with no symbolic closed form
          // (the differentiation growth budget tripped on a deeply-nested
          // body, the head stayed unresolved, or the closed form was
          // incomplete and the `Derivative` handler kept the node inert)
          // numericizes through the stencil fallback — the SAME
          // `centeredDiffHigherOrder` the compiled javascript target emits
          // as `_SYS.nd`, so the two routes agree bit-for-bit (Tycho item
          // 177, user-ruled shared-budget fallback 2026-08-14). Only under
          // `numericApproximation`: plain `evaluate()` returned above,
          // keeping the exactness contract (symbolic, unchanged).
          return numericDerivativeOfApply(result) ?? result;
        }
        return result.N();
      },
    },

    // Engine-internal: apply a function to arguments, each bound WHOLE. The
    // per-element call of a declared `broadcastable<T>` map uses it (the
    // eager loop, `declaredBroadcastElement` in `boxed-function.ts`, and the
    // lazy `Map`, `lazyBroadcastMap` in `collection-utils.ts`): its element is
    // bound whole by the declaration, whatever its shape, while `Apply` maps
    // a function literal with scalar parameters over a collection argument
    // (`applyLiteralMaps`, user decision 2026-09-26). `(broadcastable<value>)
    // -> unknown` assigned `x ↦ (x, x)` and called with `[[1, 2], [3, 4, 5]]`
    // is `[([1,2], [1,2]), ([3,4,5], [3,4,5])]` for any size of the source.
    ApplyWhole: {
      description:
        'Apply a function to arguments, each bound whole (engine-internal).',
      inspectsErrors: true,
      signature: '(name:any, arguments:any*) -> unknown',
      type: ([fn], { engine }) =>
        BoxedType.forResult(
          (fn && functionResult(fn.type)) ?? 'unknown',
          engine._typeResolver
        ),
      evaluate: (ops, { numericApproximation }) => {
        const result = apply(ops[0], ops.slice(1));
        return numericApproximation ? result.N() : result;
      },
    },

    // Pipeline application: `Pipe(x, f)` evaluates to `f(x)`. The right
    // operand may be a function symbol (`Pipe(5, Sin)` → `Sin(5)`), a
    // `Function` literal, or anything else applicable. Chains produced by the
    // Epsil `|>`/`~>` operators arrive left-associated
    // (`Pipe(Pipe(a, f), g)`) and reduce naturally, inner stage first.
    Pipe: {
      description:
        'Apply a function to a value: `Pipe(x, f)` evaluates to `f(x)`.',
      // Hold the operands. `x |> f` must behave exactly like `f(x)`, so it is
      // `f` that decides whether `x` is evaluated: a lazy `f` (`Solve`,
      // `Simplify`, `JacobianMatrix`, …) needs `x` unevaluated. Evaluating `x`
      // eagerly here broke `F |> JacobianMatrix` — a bare function `F` came
      // through stripped of its definition.
      lazy: true,
      // An application route, like `Apply`: it decides what an `Error` topic
      // means (rung 2 — `apply()` bubbles it) instead of freezing with it.
      inspectsErrors: true,
      signature: '(value, function) -> unknown',
      examples: ['Pipe([3, 1, 2], Sort)', '16 |> Sqrt'],
      // `Pipe(x, f)` is `f(x)`, so its type is `f`'s result type — EXCEPT when
      // the stage implicitly maps (`pipeImplicitMapType`), where the pipe is a
      // collection of that result rather than the result itself.
      type: ([x, f], context) =>
        BoxedType.forResult(
          f
            ? (pipeImplicitMapType(context, x, f) ??
                pipeShorthandApplicationType(context, x, f) ??
                functionResult(f.type) ??
                'unknown')
            : undefined,
          context.engine._typeResolver
        ),
      canonical: (ops, { engine: ce }) => {
        if (ops.length !== 2) return ce._fn('Pipe', checkArity(ce, ops, 2));
        // Reject early only a statically-refutable rhs: a bare number, string,
        // or boolean literal can never become applicable, so wrap it in an
        // `incompatible-type` error (mirroring non-lazy signature validation).
        // Deferral is correct for everything else: definitions may arrive
        // between canonicalization and evaluation, held operands are
        // deliberately unbound per the lazy contract, and a non-refutable type
        // is accepted under overlap-deferred validation (§D6.2). We do not
        // bind/canonicalize the non-literal operands here.
        if (ce.strict && isRefutablePipeTarget(ops[1]))
          return ce._fn('Pipe', [
            ops[0],
            ce.typeError('function', ops[1].type, ops[1].toString()),
          ]);
        // A stage that cannot take exactly one value is refused here rather
        // than left to `apply()`, whose currying is a designed feature of an
        // ordinary positional call but in a pipeline silently answered a
        // residual closure: `xs |> (p, q) => p && q` evaluated to `(_) => …`
        // and reported nothing. See `pipeStageArityError` for the wording and
        // for why this is not the `callback-arity` error.
        const arityError = pipeStageArityError(ops[1]);
        if (arityError !== undefined)
          return ce._fn('Pipe', [ops[0], arityError]);
        // A unary function-literal stage (`xs |> x ↦ …`, the shorthand
        // `xs |> _^2`, or either one parenthesized) is canonicalized here, so
        // its signature, parameter types inferred from the body included, is
        // known to the type handler: `xs |> f` is `f(xs)`, and whether a
        // literal maps over `xs` or binds it whole depends on that signature
        // (`applyLiteralMaps`, user decision 2026-09-26).
        const literal = pipeLiteralStage(ce, ops[1]);
        // A chained topic (`a |> f |> g` is `Pipe(Pipe(a, f), g)`) is
        // canonicalized too, so its own literal stage carries its signature
        // when this pipe's type reads the inner pipe's type. The evaluate
        // handler treats a chained topic as plumbing already.
        const topic = isFunction(ops[0], 'Pipe') ? ops[0].canonical : ops[0];
        if (literal !== undefined) return ce._fn('Pipe', [topic, literal]);
        if (topic !== ops[0]) return ce._fn('Pipe', [topic, ops[1]]);
        return ce._fn('Pipe', ops);
      },
      evaluate: (ops, { engine: ce, numericApproximation }) => {
        // The held operands arrive UNBOUND; `.canonical` binds their operator
        // definitions (without substituting values). Canonicalizing keeps a
        // bare function reference intact — it is *evaluation*, not binding,
        // that strips it.
        //
        // The right operand is the pipe STAGE, and a shorthand-lambda
        // placeholder in it (`Map(f, _1)`) is that stage's parameter, not a
        // reference to whatever `_1` happens to name in the caller's scope:
        // canonicalize it with the placeholders freshly bound, so a global
        // `_1` — a valued one in particular — cannot capture them.
        let x = ops[0]?.canonical;
        const rawStage = ops[1];
        if (x === undefined || rawStage === undefined) return undefined;

        // A chained topic (`a |> g |> f` parses to `Pipe(Pipe(a, g), f)`) is
        // plumbing: the inner pipe is `g(a)`, whose VALUE flows on. Evaluate it
        // before handing it to `f`, so a lazy `f` (e.g. a trailing `Simplify`)
        // receives that value rather than an unreduced `Pipe`. A non-`Pipe`
        // topic — a bare function `F`, or `x^2 - 1` — is passed as-is, letting
        // `f` decide whether to evaluate it.
        if (isFunction(x, 'Pipe')) x = x.evaluate({ numericApproximation });

        // Implicit topic argument: `xs |> Take(10)` fills the missing
        // argument slot with `_`, i.e. `xs |> Take(_, 10)` — and for a
        // callback-first operator, `xs |> Map(f)` is `xs |> Map(f, _)` (see
        // `pipeStageWithImplicitTopic` for the gate and slot placement). The
        // rewritten stage is raw, exactly like the held operand, so the
        // shorthand machinery below binds the topic to the placeholder as
        // usual.
        const stageForMap =
          pipeStageWithImplicitTopic(ce, rawStage, x) ?? rawStage;

        // A unary function-literal stage is a call: `xs |> x ↦ x^2` and
        // `xs |> _^2` are `Apply(x ↦ x^2, xs)`, which maps over a list or
        // binds whole as the same call does (`pipeImplicitMap`). The stage
        // is canonical when this pipe was canonicalized, raw when it is
        // evaluated from a held form.
        const mapped = pipeImplicitMap(ce, x, stageForMap);
        if (mapped !== undefined)
          return mapped.evaluate({ numericApproximation });

        const f = canonicalWithFreshPlaceholders(stageForMap);

        // The right operand must be applicable. A statically-refutable rhs — a
        // literal number, string, or boolean — can never be a function, so
        // return an `incompatible-type` error (covering the non-strict route
        // and an rhs that evaluated to a bare literal at runtime). This check
        // stays here rather than in the type system, which cannot validate the
        // held (lazy) operands, and rather than in `apply()`, whose
        // constant-nullary shorthand (`Apply(3, 5)` → `3`, a documented
        // `Apply` behavior with its own pins) must be preserved: `Pipe` is
        // deliberately stricter than `Apply`. Anything else non-applicable
        // stays inert (returns `undefined`).
        if (isRefutablePipeTarget(f))
          return ce.typeError('function', f.type, f.toString());

        // A stage that `apply()` would lift to a CONSTANT function — one that
        // is not a function literal, a symbol, or an expression that denotes
        // a function, and that has neither a slot (`_`, `_1`…`_9`) nor a
        // free unknown to become a parameter (`5 |> y + 1` is `y ↦ y + 1`) —
        // ignores the piped value: `[1,2] |> 10 + [3,4][1]` gave `13`. Such
        // a stage is evaluated instead, and its VALUE is the function to
        // apply. A value that is provably not a function is the same
        // `incompatible-type` error as a literal stage (`[1,2] |> 10 + 3`),
        // because a stage that ignores the piped value is almost certainly a
        // mistake (user decision 2026-09-30). The explicit spelling of a
        // constant function, a nullary literal (`() => 7`), is a function
        // literal and is not affected. A value whose type can still be a
        // function (an unknown function such as `Compose(Sqrt, Sqrt)`, typed
        // `unknown`) leaves the pipe unevaluated, as a stage that is an
        // undefined symbol does: it can evaluate once the function is
        // defined.
        let callee = f;
        if (!isSymbol(f) && !isFunction(f, 'Function')) {
          const lifted = canonicalFunctionLiteral(f);
          // A stage whose free unknowns became parameters is applied as
          // lifted here, so that `apply()` does not lift it a second time.
          if (isFunction(lifted, 'Function') && lifted.nops > 1)
            callee = lifted;
          if (isFunction(lifted, 'Function') && lifted.nops === 1) {
            callee = f.evaluate();
            if (isRefutablePipeTarget(callee))
              return ce.typeError('function', callee.type, callee.toString());
            if (
              !isSymbol(callee) &&
              !isFunction(callee, 'Function') &&
              !isFunction(callee, 'Error') &&
              !callee.type.matches('function')
            ) {
              const t = callee.type.type;
              if (
                freeTypeVariables(t).size === 0 &&
                provablyDisjoint(t, 'function')
              )
                return ce.typeError('function', callee.type, callee.toString());
              return undefined;
            }
          }
        }

        // `Nothing` is ERASED from the call argument list, uniformly on every
        // application route (error-propagation design §4): `Nothing |> f` is
        // `f()`, exactly like `f(Nothing)`. Erasure is a rule on the WRITTEN
        // argument (like `flattenOps` on the direct route and `Apply`'s
        // canonical handler): a topic that merely *evaluates* to `Nothing` is
        // bound, as it is by `f(g())`.
        const result = apply(callee, isSymbol(x, 'Nothing') ? [] : [x]);

        if (!numericApproximation) return result;
        // Mirror `Apply`: under N(), numericize the applied result unless it
        // stayed symbolic as an `Apply` expression (re-entering N() there
        // would recurse forever).
        if (isFunction(result, 'Apply')) return result;
        return result.N();
      },
    },

    DefineFunction: {
      description:
        'Define one clause of a (possibly multi-clause) function: ' +
        '`DefineFunction(f, Function(body, params…))`. Unlike `Assign` — ' +
        'which replaces the binding wholesale — `DefineFunction` ' +
        'ACCUMULATES: a clause with the same parameter domain replaces the ' +
        'earlier clause in place, any other clause is appended, and calls ' +
        'dispatch to the most specific clause admitting the arguments.',
      lazy: true,
      signature: '(symbol, function, dictionary<any>?) scope -> nothing',
      examples: ['fact(0) = 1\nfact(n) = n * fact(n - 1)\nfact(5)'],
      invokes: false,
      canonical: (args, { engine: ce }) => {
        if (args.length !== 2 && args.length !== 3) return null;
        const symbol = isSymbol(args[0])
          ? args[0]
          : checkType(ce, args[0], 'symbol');
        // The optional third operand carries the definition's ATTRIBUTES as a
        // dictionary — today the single key `hold` (`{hold: True}`, the Epsil
        // `hold f(e) = …` prefix): the function's arguments are bound to its
        // parameters unevaluated. Read here and on the evaluate route alike,
        // since both routes install the clause. Passed through unchanged so
        // the two routes and the serializer see the same node.
        const attrs = args[2] !== undefined ? [args[2].canonical] : [];
        const attributes = definitionAttributes(args[2]);
        // An absence marker cannot be rebound: install nothing (the install
        // below runs at canonicalization, so an evaluate-time refusal alone
        // left `function Undefined(x) { x }` callable), and let the evaluate
        // handler return the `absence-marker-binding` error.
        const markerName = sym(symbol);
        if (markerName !== undefined && ABSENCE_MARKERS.has(markerName))
          return ce._fn('DefineFunction', [
            symbol,
            args[1].canonical,
            ...attrs,
          ]);
        // The clause operand must be an explicit `Function` literal — the
        // shorthand lift (`canonicalFunctionLiteral(5)` → constant lambda)
        // must NOT apply here, or any value would silently become a clause.
        if (!isFunction(args[1], 'Function'))
          return ce._fn('DefineFunction', [
            symbol,
            args[1].canonical,
            ...attrs,
          ]);
        // Constructor precedence (function-polymorphism §4.7): a same-scope
        // NOMINAL type declaration owns the name — the definition statement
        // is a smart-CONSTRUCTOR definition (nominal-types v2), handled
        // below with the same canonical-time recognition as `Assign`. An
        // ALIAS's same-name function is an ordinary function (nominal spec
        // §4.5): it takes the clause path, with the minted identity
        // constructor replaced by the FIRST definition (alias block below).
        const symbolName = sym(symbol);
        const ctorScope = ce.context.lexicalScope;
        const ctorType =
          symbolName !== undefined ? ce._typeRegistry[symbolName] : undefined;
        const isCtorTarget =
          ctorType?.def !== undefined && ctorType.alias !== true;
        const isAliasTarget =
          ctorType?.def !== undefined && ctorType.alias === true;

        // §4.3a, PARAMETER half — capture the author-DECLARED signature while
        // it is still readable, so a BARE clause parameter can be ascribed
        // before the body canonicalizes below.
        //
        // The capture has to happen HERE, ahead of everything that follows:
        // the recursion knot immediately retypes the target to the wildcard
        // `function`, and `loosenForClauseDefinition` loosens it further, so by
        // the time the body canonicalizes the declaration is no longer on the
        // binding to read.
        //
        // Why the body and not just the stored signature: a bare parameter
        // infers `unknown`, and everything computed from it widens. Under
        // `let fact: (integer) -> integer`, the body of `fact(n) = n * fact(n-1)`
        // canonicalized `n - 1` as `number`, so the recursive self-call failed
        // against the very declaration that was written to make it check, and
        // the clause was left holding an `incompatible-type` error. Ascribing
        // at clause-install time is too late — the error is already baked into
        // the canonical body — which is why this sits before `args[1].canonical`
        // rather than in `defineFunctionClause`.
        const declaredForParams =
          symbolName === undefined
            ? undefined
            : declaredSignatureOf(ce.lookupDefinition(symbolName));

        // Tie the recursion knot (same as `Assign`): pre-declare the target
        // as function-typed so a self-reference in the body binds here.
        // A visible SYSTEM-SCOPE builtin is pre-shadowed with a
        // current-scope shell first: `defineFunctionClause` will shadow the
        // builtin at install, and without the shell a recursive clause's
        // self-call would canonicalize against — and keep — the builtin.
        // A protocol DISPATCHER inherited from an OUTER scope is pre-shadowed
        // for the same reason (protocols design P13/P33): `defineFunctionClause`
        // shadows it rather than replacing it, so every LATER call in this
        // scope — the recursive self-call and the block's own bare calls —
        // must canonicalize against the shell, not against the dispatcher.
        // A same-scope dispatcher is REPLACED, so it needs no shell.
        if (symbolName !== undefined && !isCtorTarget) {
          const existing = ce.lookupDefinition(symbolName);
          const systemScope = ce.contextStack[0]?.lexicalScope;
          const isBuiltin =
            existing !== undefined &&
            systemScope !== undefined &&
            systemScope.bindings.get(symbolName) === existing &&
            ce.context.lexicalScope !== systemScope;
          const isInheritedDispatcher =
            isProtocolDispatcher(existing) &&
            ce.context.lexicalScope.bindings.get(symbolName) !== existing;
          if (existing === undefined) ce.symbol(symbolName);
          else if (isBuiltin || isInheritedDispatcher)
            ce.declare(symbolName, 'function');
          const def = ce.lookupDefinition(symbolName);
          if (def && isValueDef(def) && def.value.inferredType) {
            // Rollback journal (family 1): this canonical-time recursion-knot
            // retype can land on a PRE-EXISTING inferred binding from an
            // enclosing scope (a previous cell's auto-declared symbol), so a
            // rollback frame — the Epsil static checking pass — must be able
            // to undo it, like every other inference-driven type write.
            const frame = activeRollbackFrame(ce);
            if (frame !== undefined) {
              const target = def.value;
              const slots = target._typeSlotSnapshot();
              frame.record({ undo: () => target._restoreTypeSlots(slots) });
            }
            const wasCallable = containsSignatureArm(def.value.type.type);
            def.value._setType(() => ce.type('function'));
            // Report the write, as the same retype on the `Assign` route
            // does: `_setType()` advances no cache axis, so without the
            // event an expression typed before this write keeps its
            // outdated type.
            ce._noteStateEvent({
              kind: 'type-write',
              callableBefore: wasCallable,
              callableAfter: true,
            });
          }
        }
        // Loosen the target while the clause body canonicalizes: a recursive
        // clause's self-call must not validate against the PREVIOUS clauses'
        // signature (the new intersection does not exist yet) — nor, for a
        // constructor definition, against the strict pre-install minted
        // signature (§4.5b D13/D15).
        let restoreClause: (() => void) | undefined = undefined;
        if (symbolName !== undefined) {
          const binding = ctorScope.bindings.get(symbolName);
          const stillMinted =
            binding !== undefined && isMintedConstructor(binding);
          restoreClause =
            isCtorTarget || (isAliasTarget && stillMinted)
              ? loosenMintedConstructor(ce, ctorScope, symbolName)
              : loosenForClauseDefinition(ce, symbolName);
        }
        let canonFn: Expression;
        // While the body canonicalizes, a self-call types `unknown`
        // (`_recursionKnotNames`, read by the application typing in
        // `boxed-function.ts`), unless the author declared the signature,
        // which the self-call is then typed against (§4.3a).
        const knotName =
          symbolName !== undefined && declaredForParams === undefined
            ? symbolName
            : undefined;
        if (knotName !== undefined) {
          const knot = ce._recursionKnots.get(knotName);
          if (knot !== undefined) knot.depth += 1;
          else {
            const binding = ce.lookupDefinition(knotName);
            if (binding !== undefined)
              ce._recursionKnots.set(knotName, { depth: 1, binding });
          }
        }
        try {
          // The parameter ascription canonicalizes the rebuilt literal itself,
          // so it must run INSIDE the loosened window like the plain
          // canonicalization it replaces — a recursive self-call in the body
          // still has to bind to the loosened target. It returns the literal
          // UNCHANGED (and uncanonicalized) when there is nothing to ascribe,
          // which is the ordinary path.
          const ascribed =
            declaredForParams === undefined
              ? args[1]
              : ascribeDeclaredParameterTypes(ce, args[1], declaredForParams, {
                  includeScalar: true,
                });
          canonFn = ascribed === args[1] ? args[1].canonical : ascribed;
        } finally {
          restoreClause?.();
        }
        // The knot name stays registered until the clause is installed
        // below: the clause's signature is assembled from the literal's type,
        // and a self-call typed between the end of the canonicalization and
        // the install would get the broadcast guess the marker exists to
        // prevent.
        try {
          // §4.5b D13 (nominal-types design) — constructor-function recognition
          // must ALSO run at canonicalization time (mirrors `Assign`): the
          // static pre-pass canonicalizes LATER statements before anything
          // evaluates, and their calls must validate against the constructor's
          // overload signature, not the auto-minted one. The evaluate route
          // re-runs the same installation idempotently (via `ce.assign`).
          if (
            isCtorTarget &&
            symbolName !== undefined &&
            isFunction(canonFn, 'Function')
          ) {
            try {
              checkTypeConstructorNamespace(
                ctorScope,
                symbolName,
                'constructor-function'
              );
              installConstructorFunction(
                ce,
                ctorScope,
                symbolName,
                ctorType!,
                canonFn
              );
            } catch {
              // A conflict (D5 collision, D14a overlap) is diagnosed on the
              // evaluate route, which runs the same recognition and throws
              // with the full message; canonicalization stays silent.
            }
          }
          // An alias's same-name function is an ordinary function (nominal
          // §4.5); its FIRST definition replaces the minted identity
          // constructor early so later statements' arities are honest.
          // Later definitions accumulate as ordinary clauses (evaluate
          // route) — the binding is no longer minted, so this is a no-op.
          if (
            isAliasTarget &&
            symbolName !== undefined &&
            isFunction(canonFn, 'Function')
          ) {
            const binding = ctorScope.bindings.get(symbolName);
            if (binding !== undefined && isMintedConstructor(binding)) {
              const fnDef = assignValueAsOperatorDef(ce, canonFn);
              if (fnDef !== undefined) {
                updateDef(ce, symbolName, binding, fnDef);
                // A minted constructor is callable on both sides of the swap.
                ce._noteStateEvent({
                  kind: 'redefine',
                  callableBefore: true,
                  callableAfter: true,
                });
              }
            }
          }
          // Install the clause NOW, not only when the definition evaluates, so
          // that a later statement's calls validate against the real signature.
          // Without this the target keeps the loosened `function` type set
          // above — the top type, which promises no arity — so `foo("hello")`
          // against `function foo(x: string, n: integer)` type-checks
          // vacuously. That is invisible when a program runs (the definition
          // has evaluated by the time the call does), but the Epsil static
          // pre-pass canonicalizes EVERY statement before anything runs, so
          // there it is the difference between `epsil check` catching a wrong
          // call to a user-defined function and passing it clean.
          //
          // Same reason — and the same canonicalization-time timing — as the
          // constructor-function recognition above (§4.5b D13).
          //
          // Placement is load-bearing twice over: after `args[1].canonical`, so
          // the recursion knot above still holds while the body canonicalizes;
          // and after `restoreClause()`, so the install lands on the restored
          // binding rather than the loosened one.
          //
          // The evaluate route runs `defineFunctionClause` again on this same
          // clause. For an ordinary clause that is a no-op rather than a
          // duplicate arm: a clause whose parameter domain matches an installed
          // one replaces it in place.
          //
          // ANYTHING GENERIC is excluded, because that no-op does not hold for
          // it. `defineFunctionClause` refuses ANY clause onto an
          // already-generic definition (rule G2: generic functions are
          // single-clause), and that gate runs before the replace logic — so an
          // install here would make the evaluate route reject its own
          // re-installation with `generic-clause-unsupported`. Both directions
          // have to be excluded: a generic CLAUSE (`function f<T>(x: T) { … }`)
          // would make the target generic, and a plain clause onto a target
          // that is ALREADY generic (`ce.declare('k', '(T) -> T where T')` then
          // `function k(x) { … }`) installs through the generic boundary and
          // leaves it generic just the same. The cost is that calls to a
          // generic function are still not argument-checked until it has
          // evaluated; closing that needs the two routes to agree on which one
          // owns the install, which is a larger change than this one.
          if (
            !isCtorTarget &&
            !isAliasTarget &&
            symbolName !== undefined &&
            isFunction(canonFn, 'Function')
          ) {
            const target = ce.lookupDefinition(symbolName);
            if (
              isGenericClauseLiteral(canonFn) ||
              isGenericTarget(target) ||
              canonInstallSkipped(target)
            ) {
              // Skipping one clause of a name obliges us to skip the rest of
              // them; `canonInstallSkipped` explains why.
              noteCanonInstallSkipped(target);
            } else {
              try {
                // REDEFINITION DISCIPLINE — anchored on the RAW name operand,
                // the same token the evaluate route below reads, so this
                // statement's up-to-three installs (static pre-pass
                // canonicalize, eval-loop canonicalize, evaluate) all carry ONE
                // identity and cannot collide with themselves. The install runs
                // INSIDE `withStatementRoute` so that anything the clause body
                // declares re-entrantly through the box route stays unstamped.
                withStatementRoute(ce, (route) =>
                  defineFunctionClause(
                    ce,
                    symbolName,
                    canonFn,
                    statementOrigin(ce, args[0], route),
                    attributes
                  )
                );
              } catch (e) {
                // A malformed or conflicting clause is diagnosed on the
                // evaluate route, which runs the same installation and turns
                // the failure into an error VALUE with the full message;
                // canonicalization stays silent, exactly as the constructor
                // branch does. The target keeps whatever it had, so nothing
                // downstream validates against a half-built signature.
                //
                // A REDEFINITION refusal is the exception, and must NOT mark the
                // target. The marker is sticky for the life of the definition
                // record — it exists to keep canonicalization from building a
                // picture of a definition the program will not actually have —
                // but a refused duplicate leaves the EARLIER clause installed and
                // entirely valid, so there is no divergence to protect against.
                // Marking here made the refusal poison every later compilation
                // unit: once one cell wrote a duplicate clause, the static
                // collector stopped recording that name's clauses for good, and a
                // later clean cell silently lost the `function-redefinition`
                // diagnostic it was promised (`src/epsil/static-diagnostics.ts`,
                // `clauseRedefinitionDiagnostic`).
                if (!(e instanceof RedefinitionError))
                  noteCanonInstallSkipped(target);
              }
            }
          }
          return ce._fn('DefineFunction', [symbol, canonFn, ...attrs]);
        } finally {
          if (knotName !== undefined) {
            const knot = ce._recursionKnots.get(knotName);
            if (knot !== undefined && knot.depth > 1) knot.depth -= 1;
            else ce._recursionKnots.delete(knotName);
          }
        }
      },
      evaluate: ([op1, op2, op3], { engine: ce }) => {
        const name = sym(op1);
        const refused = absenceMarkerBindingError(ce, name);
        if (refused !== undefined) return refused;
        const attributes = definitionAttributes(op3);
        if (name === undefined)
          return ce._fn('Error', [
            ce.string('invalid-clause-definition'),
            op1 ?? ce.Nothing,
          ]);
        try {
          // A definition evaluated inside a call frame or a block binds
          // THERE: it shadows a same-named outer function instead of
          // overwriting it, and dies with the frame. The clause installation
          // below writes through the scope chain, so the local binding it
          // installs onto has to exist first.
          declareLocalClauseTarget(ce, name);
          // Same anchor and same route discipline as the canonical handler
          // above — `op1` is the raw name operand it threaded through.
          withStatementRoute(ce, (route) =>
            defineFunctionClause(
              ce,
              name,
              op2,
              statementOrigin(ce, op1, route),
              attributes
            )
          );
        } catch (e) {
          if (e instanceof RedefinitionError)
            return ce._fn('Error', [ce.string(e.code), ce.string(e.message)]);
          if (e instanceof ClauseDefinitionError)
            return ce._fn('Error', [ce.string(e.code), ce.string(e.message)]);
          // The single-clause and constructor paths delegate to the host
          // `ce.assign`, which THROWS on a violated definition contract;
          // for a program those are error VALUES — the same conversion as
          // the `Assign` operator's evaluate.
          if (isEffectContractError(e)) return effectContractErrorValue(ce, e);
          if (isTypeCompatibilityError(e))
            return typeCompatibilityErrorValue(ce, e);
          throw e;
        }
        return ce.Nothing;
      },
    },

    Assign: {
      description:
        'Assign a value to a symbol or define a sequence. The RHS is evaluated ' +
        'immediately and `ce.assign(name, val)` mutates the binding in the ' +
        'current scope chain. When used inside a `Block`, the assignment is ' +
        'visible to subsequent statements in the block (sequential semantics).',
      lazy: true,
      // Mutates a binding that outlives the application: the `scope` label,
      // assigned explicitly (the `pure: false` sugar it replaces would only
      // have said "unclassified impurity"). Impure, but owing the random
      // stream nothing — a surviving `Assign` must not pin a seed frame.
      signature: '(symbol | expression, any) scope -> any',
      examples: ['let x = 3\nx = x + 1\nx'],
      // A STORING writer: the target is written, the value is stored, and
      // neither position ever applies a function-valued operand. So
      // `Assign(f, randomLambda)` is `{scope}`, not `{scope, random}` — the
      // draw fires at whatever later invokes `f`. The operand's PRODUCTION
      // effects still count: `Assign(x, Random())` stays `{random, scope}`.
      invokes: false,
      // The type of the assignment expression is the type of what it stores.
      type: ([_symbol, value], context) =>
        BoxedType.forResult(value.type, context.engine._typeResolver),
      canonical: (args, { engine: ce }) => {
        if (args.length !== 2) return null;

        // Check if LHS is a Subscript expression (for sequence definitions)
        // e.g., ['Subscript', 'L', 0] or ['Subscript', 'a', 'n']
        // Preserve both LHS and RHS as non-canonical to avoid single-letter
        // symbols being canonicalized to known constants (e.g., "G" →
        // "CatalanConstant", "i" → "ImaginaryUnit"). The evaluate handler
        // needs the raw symbol names for sequence registration and
        // self-reference detection.
        const lhs = args[0];
        if (isFunction(lhs, 'Subscript')) {
          return ce._fn('Assign', [lhs, args[1]]);
        }

        // The QUALIFIED property write — `p.(Nameable.name) = v`, which the
        // Epsil parser lowers to `Assign(ProtocolProperty(P, name, p), v)` —
        // keeps that shape here and is performed by the evaluate handler. It is
        // deliberately NOT folded into the four-operand `ProtocolProperty` node
        // at canonicalization: that operator is not lazy, so its operands would
        // evaluate before it could refuse, and `p.(P.name) = bump()` on a
        // `readonly` property would fire `bump()` before reporting the refusal.
        // The evaluate handler runs the value-independent refusals first, the
        // same order the unqualified spelling uses.
        if (isFunction(lhs, 'ProtocolProperty')) return ce._fn('Assign', args);

        // A PROPERTY STORE — `p.age = 43`. Assignment through a `Field` target
        // is a store into a mutable object and is legal on nothing else
        // (Appendix B, "Assigning to a property"), so a `Field` LHS never
        // reaches the `checkType(lhs, 'symbol')` refusal below: it either
        // defers to `evaluate`, where a real receiver settles it, or carries
        // the one refusal that cannot change at runtime.
        //
        // The question asked FIRST: does the receiver's own object layout
        // declare this field? If so it is a slot store, even when a `readwrite`
        // protocol declares a property of the same name — and the answer is
        // settled at evaluation, by the instance's own pinned layout, so a
        // layout-owned name simply defers without asking anything else.
        const layoutOwned = objectLayoutOwnsField(ce, lhs);

        // Everything else asks the one static question whose answer cannot
        // change at runtime: is the receiver's type settled, and settled as
        // something that is not an object? Object types have no subtypes and no
        // value of another type is ever an object, so that refusal is safe to
        // make here — and it is the diagnostic a reader of `d.id = "456"` on a
        // record needs. Anything less settled defers to `evaluate`, which asks
        // the object layout and then the protocol properties.
        const store = layoutOwned
          ? ('defer' as const)
          : fieldAssignmentVerdict(ce, lhs);
        if (store !== undefined && store !== 'defer') return store;
        const deferStore = layoutOwned || store === 'defer';

        // Note: we can't use checkType() because it canonicalized/bind the argument.
        // As in `Declare`, a `Tuple` first operand is a destructuring pattern
        // (`(x, y) := v`) and is kept raw: canonicalizing it would fold a
        // single-letter target into the constant of that name (`(i, j) := …`
        // would write `ImaginaryUnit`).
        let symbol = lhs;
        if (!deferStore && !isSymbol(symbol) && !isFunction(symbol, 'Tuple')) {
          // If the argument was not a symbol literal, see if we can evaluate it to a symbol
          symbol = checkType(ce, lhs, 'symbol');
        }

        // If the RHS is a Function definition, pre-declare the target symbol
        // as a function-typed symbol BEFORE canonicalizing the body. This ties
        // the recursion knot: a self-reference in the body (e.g. `f(n) = n *
        // f(n-1)`) then resolves to this symbol rather than to an unbound /
        // stale binding. It also lets subsequent parsing recognize it as a
        // function (e.g., `2f(x)` parses as `2 * f(x)`). Mirrors what an
        // explicit `Declare`/`let f` does.
        const symbolName = sym(symbol);
        if (symbolName && isFunction(args[1], 'Function')) {
          // Trigger auto-declaration if the symbol isn't declared yet
          if (!ce.lookupDefinition(symbolName)) ce.symbol(symbolName);
          const def = ce.lookupDefinition(symbolName);
          // A recorded type that already admits a function — a signature the
          // block's `Declare` hoisted (`let f: (integer) -> integer`), or the
          // wildcard `function` itself — already ties the recursion knot, and
          // replacing it with the wildcard would ERASE the declared signature
          // for every read on the canonical routes. Only a non-callable
          // recorded type (unknown, or stale scalar evidence from an earlier
          // assignment) is retyped.
          if (
            def &&
            isValueDef(def) &&
            def.value.inferredType &&
            !def.value.type.matches('function')
          ) {
            // Rollback journal (family 1): same as `DefineFunction`'s
            // recursion-knot retype above — the binding may pre-exist the
            // rollback frame (an outer scope's inferred symbol), and the
            // static checking pass must be able to undo the write.
            const frame = activeRollbackFrame(ce);
            if (frame !== undefined) {
              const target = def.value;
              const slots = target._typeSlotSnapshot();
              frame.record({ undo: () => target._restoreTypeSlots(slots) });
            }
            const wasCallable = containsSignatureArm(def.value.type.type);
            def.value._setType(() => ce.type('function'));
            // The `_type` expression caches key on the engine's `any` axis,
            // which a `_setType()` write does not advance: without
            // the event, an expression typed before this write keeps its
            // stale type for the rest of the generation.
            ce._noteStateEvent({
              kind: 'type-write',
              callableBefore: wasCallable,
              callableAfter: true,
            });
          }
        }

        // §4.5b D13/D15: loosen a minted constructor while the literal body
        // canonicalizes — a constructor-function body's SELF-call must not
        // validate against the strict pre-install signature (see
        // `loosenMintedConstructor`). Restored immediately after; the install
        // below then replaces the definition.
        let restoreCtor: (() => void) | undefined = undefined;
        if (symbolName !== undefined && isFunction(args[1], 'Function')) {
          const scope = ce.context.lexicalScope;
          if (ce._typeRegistry[symbolName]?.def !== undefined)
            restoreCtor = loosenMintedConstructor(ce, scope, symbolName);
        }

        let canonRhs: Expression;
        try {
          canonRhs = args[1].canonical;
        } finally {
          restoreCtor?.();
        }

        // §4.5b D13 (nominal-types design) — constructor-function recognition
        // must ALSO run at canonicalization time, mirroring `DeclareType`'s
        // canonical-time registration: the static pre-pass (and Block
        // canonicalization) canonicalizes LATER statements before anything
        // evaluates, and their calls must validate against the constructor's
        // overload signature, not the auto-minted one. The evaluate-time
        // assign path re-runs the same installation idempotently.
        if (symbolName !== undefined && isFunction(canonRhs, 'Function')) {
          const scope = ce.context.lexicalScope;
          const t = ce._typeRegistry[symbolName];
          if (t?.def !== undefined) {
            try {
              if (t.alias !== true) {
                checkTypeConstructorNamespace(
                  scope,
                  symbolName,
                  'constructor-function'
                );
                installConstructorFunction(ce, scope, symbolName, t, canonRhs);
              } else {
                // An alias's same-name function is an ordinary function
                // (§4.5); replacing the minted identity constructor early
                // keeps later statements' arities honest.
                const binding = scope.bindings.get(symbolName);
                if (binding !== undefined && isMintedConstructor(binding)) {
                  const fnDef = assignValueAsOperatorDef(ce, canonRhs);
                  if (fnDef !== undefined) {
                    updateDef(ce, symbolName, binding, fnDef);
                    ce._noteStateEvent({
                      kind: 'redefine',
                      callableBefore: true,
                      callableAfter: true,
                    });
                  }
                }
              }
            } catch {
              // A conflict (D5 collision, D14a overlap) is diagnosed on the
              // evaluate route, which runs the same recognition and throws
              // with the full message; canonicalization stays silent.
            }
          }
        }

        // A DATA-valued RHS records assignment evidence on the target's
        // binding at canonicalization time (`joinAssignmentEvidence`, which
        // owns the join rule), mirroring the `Function`-valued branch above.
        if (
          symbolName !== undefined &&
          !isFunction(canonRhs, 'Function') &&
          canonRhs.isValid
        )
          joinAssignmentEvidence(ce, symbolName, () =>
            canonRhs.type.isUnknown ? undefined : canonRhs.type.type
          );
        // A destructuring target `(x, y) := v` records the same evidence on
        // each pattern leaf, from the matching position of the RHS's static
        // tuple type: `(xs, n) := ([1, 2, 3], 2)` types `xs` a list and `n` an
        // integer, so `Length(xs)` later in the block compiles. Nested
        // patterns descend into nested tuple types; a `_` position binds
        // nothing. The evaluation-time write is atomic — a shape mismatch
        // anywhere in the pattern writes no leaf at all (`bindTuplePattern`)
        // — and so is the evidence: the pairs are collected over the whole
        // pattern first, and an RHS type that is not a tuple of the pattern's
        // arity at any level (a symbol of unknown type, an arity mismatch the
        // evaluation will report) records nothing, leaving every leaf
        // `unknown`. A union RHS type is read arm by arm
        // (`tuplePatternLeafTypes`).
        if (isFunction(symbol, 'Tuple') && canonRhs.isValid)
          recordPatternEvidence(ce, symbol, () => canonRhs.type.type);

        const result = ce._fn('Assign', [symbol, canonRhs]);

        return result;
      },
      evaluate: ([op1, op2], { engine: ce, numericApproximation }) => {
        // Every name the assignment binds: the symbol target, each leaf of a
        // destructuring tuple (`(a, Missing) := t`), and the base of a
        // sequence definition (`Missing_0 := 1`).
        const boundNames = isFunction(op1, 'Tuple')
          ? tuplePatternNames(op1)
          : isFunction(op1, 'Subscript')
            ? [sym(op1.op1)]
            : [sym(op1)];
        for (const name of boundNames) {
          const refused = absenceMarkerBindingError(ce, name);
          if (refused !== undefined) return refused;
        }
        //
        // Check for Subscript LHS (sequence definition)
        // e.g., Subscript(L, 0) := 1  OR  Subscript(a, n) := a_{n-1} + 1
        // Also handles multi-index: Subscript(P, Sequence(n, k)) := ...
        //
        if (isFunction(op1, 'Subscript') && sym(op1.op1)) {
          const seqName = sym(op1.op1)!;
          const subscript = op1.op2;

          // Declared-name precedence governs the Assign LHS too (user ruling
          // 2026-08-15, second half of the subscripted-assignment round): a
          // subscripted LHS whose JOINED name is declared assigns to THAT
          // symbol — `declare('l_P')` then `l_{P} := P²+1` binds `l_P`, and
          // must NOT define a family on the base letter `l` (documents use
          // `f` and `f_x` as unrelated names; the Desmos importer measured a
          // real base-letter clobber from the family reading). This mirrors
          // the expression-position rule pinned in
          // `subscript-declared-name-precedence.test.ts`: declaration
          // presence is the disambiguator. It also resolves the
          // lambda-assignment ambiguity handled below — with a declaration
          // present the author's intent is stated, so a function-literal RHS
          // binds the declared symbol here instead of erroring. Sequence
          // recurrences are unaffected: defining `a_1 := 1` or
          // `a_n := a_{n-1}+1` registers NO `a_1`/`a_n` symbol definitions
          // (verified), so re-running those rows never trips this branch.
          const joinedName = isSymbol(subscript)
            ? `${seqName}_${subscript.symbol}`
            : isNumber(subscript) && Number.isInteger(subscript.re)
              ? `${seqName}_${subscript.re}`
              : undefined;
          if (
            joinedName !== undefined &&
            ce.lookupDefinition(joinedName) != null
          ) {
            const val = op2.evaluate();
            // Errors surface as VALUES on this route, exactly as on the
            // regular symbol-assignment path below.
            try {
              ce.assign(joinedName, val);
            } catch (e) {
              if (isEffectContractError(e))
                return effectContractErrorValue(ce, e);
              if (isTypeCompatibilityError(e))
                return typeCompatibilityErrorValue(ce, e);
              throw e;
            }
            return val;
          }

          // A FUNCTION LITERAL on the right of a subscripted-name assignment
          // is refused outright (user ruling 2026-08-15, option (d) of the
          // subscripted-lambda entry in ROADMAP.md; the declared-name check
          // above already took the unambiguous cases, so this is the
          // UNDECLARED joined name only). The notation is
          // genuinely ambiguous — `l_P := P ↦ body` reads either as defining
          // a function NAMED `l_P` (Desmos treats the subscript as pure
          // spelling, and documents routinely use `f` and `f_x` as unrelated
          // names) or as defining a FAMILY `l` whose P-th member is the
          // lambda (`T_n := x ↦ cos(n·arccos x)`) — and before this check
          // every reading fell into the sequence-definition machinery below,
          // which defined nothing usable and reported nothing: the
          // assignment silently vanished. Field-verified corpus-safe: the
          // Desmos importer only ever emits head-application assignments
          // (`l_P(P) := …`), never this spelling. The error names both
          // working spellings so the author can say which they meant.
          if (isFunction(op2, 'Function')) {
            return ce.error(
              [
                'ambiguous-assignment',
                `Assigning a function literal to the subscripted name ` +
                  `"${seqName}_${subscript.toString()}" is ambiguous. To ` +
                  `define a function named "${seqName}_${subscript.toString()}", ` +
                  `write "${seqName}_${subscript.toString()}(…) := ⟨body⟩". To ` +
                  `define a family of functions indexed by ` +
                  `"${subscript.toString()}", assign an expression in ` +
                  `"${subscript.toString()}" instead of a function literal.`,
              ],
              op2.toString()
            );
          }

          //
          // Check for multi-index subscript: P_{n,k}
          // Parser produces: Subscript(P, Sequence(n, k))
          // When non-canonical, it may be wrapped in Delimiter:
          //   Subscript(P, Delimiter(Sequence(n, k), ","))
          //
          let multiSub = subscript;
          if (isFunction(multiSub, 'Delimiter')) multiSub = multiSub.op1;
          if (isFunction(multiSub, 'Sequence')) {
            const subscript = multiSub;
            const indices = subscript.ops;

            // Case M1: All numeric → multi-index base case
            // e.g., P_{0,0} := 1
            if (
              indices.every((op) => isNumber(op) && Number.isInteger(op.re))
            ) {
              const key = indices.map((op) => op.re).join(',');
              addMultiIndexBaseCase(ce, seqName, key, op2.evaluate());
              return ce.Nothing;
            }

            // Extract variable names from indices
            // For symbols: use the symbol name
            // For numbers: use the number as string
            // For expressions: try to extract the variable
            const indexVars: string[] = [];
            let hasSymbols = false;
            let allValid = true;

            for (const idx of indices) {
              if (isSymbol(idx)) {
                indexVars.push(idx.symbol);
                hasSymbols = true;
              } else if (isNumber(idx) && Number.isInteger(idx.re)) {
                indexVars.push(String(idx.re));
              } else {
                // Complex expression - try to extract variable
                const v = extractIndexVariable(idx);
                if (v) {
                  indexVars.push(v);
                  hasSymbols = true;
                } else {
                  allValid = false;
                  break;
                }
              }
            }

            if (allValid && indexVars.length === indices.length) {
              if (containsSelfReference(op2, seqName)) {
                // Case M2: Recurrence with self-reference
                // e.g., P_{n,k} := P_{n-1,k-1} + P_{n-1,k}
                // Only use symbol variables for the recurrence
                const recurrenceVars = indices
                  .map((idx) => sym(idx))
                  .filter((s): s is string => s !== undefined);

                if (recurrenceVars.length > 0) {
                  addMultiIndexRecurrence(ce, seqName, recurrenceVars, op2);
                  return ce.Nothing;
                }
              } else if (hasSymbols) {
                // Case M3: Pattern base case (no self-reference)
                // e.g., P_{n,0} := 1 or P_{n,n} := 1
                const key = indexVars.join(',');
                addMultiIndexBaseCase(ce, seqName, key, op2.evaluate());
                return ce.Nothing;
              }
            }

            // Fallback for multi-index: if we couldn't handle it, continue
          }

          // Case 1: Numeric subscript → base case
          // e.g., L_0 := 1, F_1 := 1
          if (isNumber(subscript) && Number.isInteger(subscript.re)) {
            const index = subscript.re;
            const value = op2.evaluate();
            addSequenceBaseCase(ce, seqName, index, value);
            return ce.Nothing;
          }

          // Case 2: Symbol subscript → check for self-reference
          // e.g., a_n := a_{n-1} + 1  vs  f_n := 2*n + 1
          if (isSymbol(subscript)) {
            const indexVar = subscript.symbol;

            if (containsSelfReference(op2, seqName)) {
              // Sequence recurrence definition
              addSequenceRecurrence(ce, seqName, indexVar, op2);
              return ce.Nothing;
            } else {
              // Function definition (no self-reference)
              // Convert to: f(n) := expr
              const fnDef = ce.function('Function', [op2, ce.symbol(indexVar)]);
              ce.assign(seqName, fnDef);
              return ce.Nothing;
            }
          }

          // Case 3: Complex subscript → check for self-reference
          // e.g., a_{n+1} := a_n + 1
          if (containsSelfReference(op2, seqName)) {
            const indexVar = extractIndexVariable(subscript!);
            if (indexVar) {
              addSequenceRecurrence(ce, seqName, indexVar, op2);
              return ce.Nothing;
            }
          }

          // Fallback: treat as regular assignment to compound symbol
          // This shouldn't normally happen with well-formed input
        }

        //
        // `Assign((x, y), v)` — a destructuring assignment (`(x, y) := v`).
        // The same pattern grammar as the destructuring `let` (a raw Tuple of
        // bare symbols, `_` to skip a position, nested tuple patterns), but it
        // WRITES the targets rather than declaring them, so an existing
        // binding keeps its identity and its declared type.
        //
        // The RHS is evaluated ONCE, up front, before any target is written —
        // that is what makes the swap `(a, b) := (b, a)` mean what it reads.
        //
        // The write is ATOMIC, like the destructuring `let`'s: every leaf is
        // pre-validated against its target's existing binding (`assertAssignable`
        // — a `const` target, a value that does not fit a declared type) in a
        // read-only pass over the whole pattern, so a rejection on a LATER leaf
        // no longer leaves an earlier one written. Assignment failure preserves
        // the prior values (unlike `let`, where the names stay unbound).
        //
        if (isFunction(op1, 'Tuple')) {
          const val = op2.evaluate();
          const err = bindTuplePattern(
            ce,
            op1,
            val,
            (name, el) => {
              // As in the scalar path below: a violated effect contract or a
              // declared-type mismatch is not installed and surfaces as an
              // error VALUE, even though the host `ce.assign` throws. Still
              // reached for the residuals `assertAssignable` leaves to the
              // install (a function literal, an operator-slot target).
              try {
                // Each leaf is stored as a plain assignment stores it
                // (`assignedValue`).
                ce.assign(name, assignedValue(ce, el));
              } catch (e) {
                if (isEffectContractError(e))
                  return effectContractErrorValue(ce, e);
                if (isTypeCompatibilityError(e))
                  return typeCompatibilityErrorValue(ce, e);
                throw e;
              }
              return null;
            },
            (name, el) => {
              try {
                assertAssignable(ce, name, el);
              } catch (e) {
                if (isEffectContractError(e))
                  return effectContractErrorValue(ce, e);
                if (isTypeCompatibilityError(e))
                  return typeCompatibilityErrorValue(ce, e);
                // Any other rejection — the `const` target's plain `Error` —
                // propagates exactly as the sequential write's did, but now
                // before any target was written.
                throw e;
              }
              return null;
            }
          );
          return err ?? val;
        }

        //
        // A `Field` LHS that reached evaluation: a store into the object's own
        // layout, a store through a protocol's `set` accessor, or a refusal.
        //
        //
        // A `ProtocolProperty` LHS: the QUALIFIED property write
        // `p.(Nameable.name) = v`, a store restricted to the protocol named.
        //
        if (isFunction(op1, 'ProtocolProperty') && op1.ops.length === 3) {
          const parts = qualifiedWriteOperands(op1);
          if (parts === undefined) return undefined;
          // The receiver is evaluated exactly once, and BEFORE the value:
          // ruling B8's left-to-right order, and the guarantee that a receiver
          // carrying effects fires them once however the write resolves.
          const receiver = parts.base.evaluate();
          if (!receiver.isValid) return receiver;
          // Everything that can refuse the write WITHOUT looking at the value
          // is asked here, so a refused write costs the right-hand side
          // nothing: `p.(P.name) = bump()` on a `readonly` property, or on a
          // receiver nothing can be stored into, never calls `bump()`.
          const refused =
            protocolNamedPropertyRefusal(ce, parts.protocol, parts.name) ??
            protocolPropertyWriteRefusal(
              ce,
              receiver,
              parts.name,
              ce._protocolRegistry[parts.protocol]
            );
          if (refused !== undefined) return refused;
          const rhs = op2.evaluate();
          if (!rhs.isValid) return rhs;
          // The write itself is the four-operand operator, applied to operands
          // that are already evaluated — so nothing fires twice — and it owns
          // every remaining verdict (a missing implementation, ambiguity, the
          // value-fit check, and staying symbolic for a receiver whose value is
          // not an object yet).
          return ce
            .function('ProtocolProperty', [
              ce.string(parts.protocol),
              ce.string(parts.name),
              receiver,
              rhs,
            ])
            .evaluate({ numericApproximation });
        }

        if (isFunction(op1, 'Field')) {
          // The RECEIVER is evaluated exactly once, here, and the same value is
          // handed to every route tried below. A receiver is an arbitrary
          // expression and may carry effects (`nextItem().field = v`), so each
          // route deriving it from `op1` for itself would fire them once per
          // route — including on the refusal path, which merely needs its type
          // to phrase the error. Evaluating it BEFORE the value is also ruling
          // B8's left-to-right order.
          const receiver = op1.ops[0]?.evaluate();

          // The property STORE comes first: an object's own stored fields are
          // its layout's, and a name in the layout is a store even if some
          // protocol also declares a property by that name. `objectFieldStore`
          // evaluates the value only once it is committed to storing, so a
          // decline (`undefined`) costs the RHS nothing and leaves the protocol
          // route below to evaluate it exactly once itself.
          const stored = objectFieldStore(ce, op1, op2, receiver);
          if (stored !== undefined) return stored;

          // REFUSE BEFORE EVALUATING THE VALUE where the refusal is already
          // certain. The store route has declined, so the only remaining
          // candidate is a protocol property — and if no protocol declares
          // this name at all, none ever will. Asking that cheap question here
          // keeps the promise the store route makes one line above: a target
          // no route can serve costs the right-hand side nothing, so
          // `n.x = bump()` on a number does not fire `bump()` before reporting
          // that `n` cannot be stored into. (The full resolution below cannot
          // stand in for this check: it needs the CONCRETE value, so asking it
          // first would be the very evaluation being avoided.)
          const fieldName = isString(op1.ops[1])
            ? op1.ops[1].string
            : undefined;
          if (
            fieldName !== undefined &&
            protocolsWithProperty(ce, fieldName).length === 0
          )
            return fieldStoreRefusal(ce, op1, receiver);

          // The COMPUTED property route: a name the object's layout has no slot
          // for, answered by a protocol's `set` accessor.
          //
          // A refusal that does NOT depend on the value comes first, so it
          // keeps the promise the store route makes above — a target no route
          // can serve costs the right-hand side nothing. Writing a `readonly`
          // property is that refusal: `b.name = bump()` must report it without
          // firing `bump()`.
          if (fieldName !== undefined && receiver !== undefined) {
            const refused = protocolPropertyWriteRefusal(
              ce,
              receiver,
              fieldName
            );
            if (refused !== undefined) return refused;
          }

          // Now the value, because the value-fit check inside
          // `protocolPropertyStore` must see the CONCRETE value. The static type
          // of a raw RHS is often wider than the property's declared type
          // (`10 * i` in a loop body types `number` against an `integer`
          // property), and the false refusal it produced was DISCARDED in
          // statement position — a silent no-op write, diverging from the
          // compiled tier, which performs it.
          const rhs = op2.evaluate();
          if (!rhs.isValid) return rhs;
          if (fieldName !== undefined && receiver !== undefined) {
            const set = protocolPropertyStore(ce, receiver, fieldName, rhs, {
              numericApproximation,
            });
            if (set !== undefined) return set;
          }

          // Every route has declined: the receiver did not evaluate to an
          // object, or it did and no protocol property of that name applies to
          // it. The target cannot be stored into, and that is the value of the
          // statement — falling through would evaluate the `Field` and return
          // `undefined`, swallowing the refusal entirely.
          return fieldStoreRefusal(ce, op1, receiver);
        }

        // Regular symbol assignment
        // The LHS is held RAW on purpose: it is a NAME, not a reference. Read
        // the name directly; `evaluate()` is only the fallback for a non-symbol
        // LHS that computes one. (A raw symbol now evaluates through its
        // canonical form — see `BoxedSymbol._canonicalToEvaluate()` — so
        // evaluating a symbol LHS would read its VALUE and the assignment would
        // silently vanish.)
        const symbol = isSymbol(op1) ? op1 : op1.evaluate();
        const symbolName = sym(symbol);
        if (!symbolName) return undefined;
        // `c = "a"` where `c` was declared `character` — see
        // `narrowDeclaredCharacter`. The narrowed character IS the assigned
        // value, so it replaces the evaluation of the operand. The `isString`
        // test is repeated here so that the scope-chain walk
        // `declaredTypeOfSymbol` performs is skipped for every assignment
        // whose right-hand side is not a literal string, which is nearly all
        // of them (`x = x + 1` in a loop body).
        const val =
          (isString(op2)
            ? narrowDeclaredCharacter(
                ce,
                declaredTypeOfSymbol(ce, symbolName),
                op2
              )
            : undefined) ?? assignedValue(ce, op2.evaluate());
        // A property write in VALUE position — `x = ProtocolProperty(P, "n",
        // p, v)`, which a hand-built expression can spell — that was REFUSED
        // (a readonly property, a non-object receiver, a missing
        // implementation) must not be stored under `x`: the error is the value
        // of the statement, exactly as on the field-target route above.
        if (!val.isValid && isFunction(op2, 'ProtocolProperty')) return val;
        // A violated definition-annotation contract (an explicit effect
        // annotation the body's inferred effects do not fit) is not installed
        // and surfaces as an `incompatible-type` error VALUE — the same shape
        // and channel as the call-boundary type check. See "Definition-
        // annotation check" in `docs/EFFECTS-MODEL.md`.
        //
        // A declared-TYPE mismatch (and the minted-constructor guard) takes
        // the same channel: errors are values for a program, even though the
        // host `ce.assign` keeps throwing.
        try {
          ce.assign(symbolName, val);
        } catch (e) {
          if (isEffectContractError(e)) return effectContractErrorValue(ce, e);
          if (isTypeCompatibilityError(e))
            return typeCompatibilityErrorValue(ce, e);
          throw e;
        }
        return val;
      },
    },

    Assume: {
      description:
        'Record an assumption about a symbol. Evaluates to the outcome as ' +
        'a string: "ok", "tautology", "contradiction", "not-a-predicate" ' +
        'or "internal-error".',
      lazy: true,
      // Writes the assumptions of a scope that outlives the application: the
      // `scope` label (see `Assign`).
      // A string, not a symbol: two of the outcomes ("not-a-predicate",
      // "internal-error") are not valid symbol names, so a symbol result
      // rendered as an invalid-symbol Error for exactly the failure cases.
      signature: '(any) scope -> string',
      examples: ['Assume(x > 0)'],
      evaluate: (ops, { engine: ce }) => ce.string(ce.assume(ops[0])),
    },

    Declare: {
      description:
        'Declare a symbol in the current scope, optionally assigning a type ' +
        'and an initial value. An optional trailing attributes dictionary ' +
        '(with keys `type`, `value`, `constant` and `holdUntil`) can further ' +
        'describe the definition, e.g. to declare a constant. With a value, ' +
        'evaluates to that value; otherwise evaluates to `Nothing`.',
      lazy: true,
      // Introduces a binding in a scope that outlives the application: the
      // `scope` label (see `Assign`).
      // The attributes bag's entry VALUES are arbitrary expressions — a
      // `value` entry can be typed `range | nothing`, say — so the parameter
      // is the absence-admitting `dictionary<any>`, not the values-only bare
      // `dictionary` (= `dictionary<unknown>` since the bare-synonym ruling,
      // 2026-08-17, which went inert on exactly that `let`).
      signature:
        '(symbol, type: (string | symbol)?, value: any?, attributes: dictionary<any>?) scope -> any',
      examples: ['let x: integer = 5\nx + 1'],
      // A STORING writer, like `Assign`: no position applies a function-valued
      // operand, so `Declare(f, "function", randomLambda)` is `{scope}`. The
      // value's PRODUCTION effects still count.
      invokes: false,
      // With a positional value operand, `Declare` evaluates to the value;
      // otherwise to `Nothing`. (A trailing dictionary operand is the
      // attributes bag, not a value.)
      type: (ops, context) =>
        BoxedType.forResult(
          ops[2] && !isDictionaryOperand(ops[2]) ? ops[2].type : 'nothing',
          context.engine._typeResolver
        ),
      canonical: (args, { engine: ce }) => {
        // Note: we can't use checkType() because it canonicalized/bind the argument.
        // A `Tuple` first operand is a destructuring pattern (`let (x, y) = v`):
        // kept raw — canonicalizing it would bind the about-to-be-declared
        // names to any existing outer definitions.
        let symbolExpr = args[0];
        if (!isSymbol(symbolExpr) && !isFunction(symbolExpr, 'Tuple')) {
          // If the argument was not a symbol literal, see if we can evaluate it to a symbol
          symbolExpr = checkType(ce, args[0], 'symbol');
        }

        if (args.length === 1) return ce._fn('Declare', [symbolExpr]);

        // A `let` with an initial value and no declared type is an
        // assignment for typing purposes: the initializer's static type is
        // recorded on the hoisted binding as assignment evidence
        // (`joinAssignmentEvidence`, the rule `Assign` uses), so a later read
        // of the local in the block — and the compile route, which never
        // runs the `Declare` — sees the type the program gives it. Without
        // this only a closed literal initializer typed the local (through
        // the `Block` hoist), and `let cands = fourth(a, b)` or
        // `let gap = queue[i]` stayed `unknown`, so `filter(cands, …)` and
        // `gap[1]` failed the compiler's shape gates although the callee's
        // declared result type and the list's element type were known (Tycho
        // item 332, program a). A declared type is the contract and takes no
        // evidence; a `Function` value goes through the function-definition
        // route; an invalid or unknown-typed value records nothing. A
        // destructuring `let (a, b) = v` records evidence on each leaf, as
        // `(a, b) := v` does (`recordPatternEvidence`). The target of each
        // write is the binding in the CURRENT scope only, the one the `let`
        // creates at run time (see `joinAssignmentEvidence`).
        const recordInitializerEvidence = (
          typeOp: Expression | undefined,
          value: Expression | undefined
        ): void => {
          if (typeOp !== undefined || value === undefined) return;
          if (!value.isValid) return;
          if (isFunction(value, 'Function')) return;
          if (isFunction(symbolExpr, 'Tuple')) {
            recordPatternEvidence(ce, symbolExpr, () => value.type.type, {
              currentScopeOnly: true,
            });
            return;
          }
          if (!isSymbol(symbolExpr)) return;
          joinAssignmentEvidence(
            ce,
            symbolExpr.symbol,
            () => (value.type.isUnknown ? undefined : value.type.type),
            { currentScopeOnly: true }
          );
          // An initializer that is a bare untyped symbol (`let out = acc`
          // with `acc` a bare parameter) records nothing above, since its
          // type is `unknown`. The local remembers it instead, so that a use
          // that narrows the local before any assignment to it narrows the
          // initializer too (`_initializerAlias`, read by
          // `BoxedSymbol._inferWithoutFacts` in `boxed-symbol.ts`; every
          // later assignment to the local clears it, see
          // `joinAssignmentEvidence`).
          if (!isSymbol(value)) return;
          const source = value.valueDefinition;
          if (
            source === undefined ||
            !source.inferredType ||
            source.isConstant ||
            source.value !== undefined ||
            !source.type.isUnknown
          )
            return;
          const local = ce.context.lexicalScope.bindings.get(symbolExpr.symbol);
          if (local !== undefined && isValueDef(local))
            local.value._initializerAlias = value;
        };

        if (args.length === 2) {
          // The second operand is either a type (kept raw, so that a
          // type-name symbol such as `real` is not auto-declared as a
          // variable) or a trailing attributes dictionary (canonicalized so
          // that its `.get(...)` accessor works during evaluation).
          const op =
            args[1].operator === 'Dictionary' ? args[1].canonical : args[1];
          if (isDictionary(op) && op.get('type') === undefined)
            recordInitializerEvidence(undefined, op.get('value'));
          return ce._fn('Declare', [symbolExpr, op]);
        }

        if (args.length === 3) {
          const value = args[2].canonical;
          recordInitializerEvidence(args[1], value);
          return ce._fn('Declare', [symbolExpr, args[1], value]);
        }

        if (args.length === 4)
          return ce._fn('Declare', [
            symbolExpr,
            args[1],
            args[2].canonical,
            args[3].canonical,
          ]);

        return null;
      },
      evaluate: (ops, { engine: ce }) => {
        for (const name of isFunction(ops[0], 'Tuple')
          ? tuplePatternNames(ops[0])
          : [sym(ops[0])]) {
          const refused = absenceMarkerBindingError(ce, name);
          if (refused !== undefined) return refused;
        }
        // Separate an optional trailing attributes dictionary. When the last
        // operand (with arity ≥ 2) is a `Dictionary`, it carries definition
        // attributes (`type`, `value`, `constant`, `holdUntil`); the
        // remaining operands after the symbol are the positional
        // `[type?, value?]`.
        const rest = ops.slice(1);
        let attrs: DictionaryInterface | undefined;
        const last = rest[rest.length - 1];
        if (last !== undefined && isDictionary(last)) {
          attrs = last;
          rest.pop();
        }
        const typeOp = rest[0];
        const valueOp = rest[1];

        // Resolve the effective type spec: a positional type wins over the
        // attributes `type`.
        const typeSource = typeOp ?? attrs?.get('type');
        const hasType = typeSource !== undefined;
        let type: Type | undefined;
        // Effects-axis provenance (`docs/EFFECTS-MODEL.md`, "Annotation
        // provenance"): the statement is in the TYPE — a non-empty specifier,
        // or the stated-empty `effects: []` that `pure` builds.
        let effectsDeclared = false;
        if (hasType) {
          const t = typeSource!.canonical.evaluate();
          const source =
            (isString(t) ? t.string : undefined) ?? sym(t) ?? undefined;
          if (source === undefined) return undefined;
          // Parse WITH the resolver: the source is user-supplied and may name
          // a user-declared type (`ce.declareType()` / `DeclareType`).
          const parsed = parseType(source, ce._typeResolver);
          if (!isValidType(parsed)) return undefined;
          type = parsed;
          effectsDeclared = signatureEffects(parsed) !== undefined;
        }

        // A binding this statement created on a PREVIOUS run of its block —
        // a loop body on its second turn, a re-run program — is HIDDEN while
        // the initializer is evaluated, so `let t = t * 2` reads the OUTER
        // `t`, as it did on the first run, and not its own stale value
        // (measured: `let t = 1; for k in 1..3 { let t = t * 2; xs =
        // Append(xs, t) }` collected 2, 4, 8 where every turn computes 2).
        // The binding is put back once the initializer has a value, and the
        // statement-redeclare path of `declareOne` below replaces it only
        // when the declaration succeeds: a declaration that then fails — a
        // destructuring shape mismatch, a declared-type mismatch — leaves the
        // previous binding in place, as it did before. Both map writes are
        // journaled for `checkpoint()`/`restore()`.
        const currentScopeBindings = ce.context.lexicalScope.bindings;
        type Binding = NonNullable<ReturnType<typeof currentScopeBindings.get>>;
        const hiddenStatementBindings: [string, Binding][] = [];
        const hideStaleStatementBinding = (symbolName: string): void => {
          const existing = currentScopeBindings.get(symbolName);
          if (
            existing === undefined ||
            (existing as { _declaredByStatement?: boolean })
              ._declaredByStatement !== true
          )
            return;
          journalCheckpointMapEntry(
            ce,
            currentScopeBindings,
            symbolName,
            symbolName,
            'declare'
          );
          currentScopeBindings.delete(symbolName);
          hiddenStatementBindings.push([symbolName, existing]);
        };
        if (isFunction(ops[0], 'Tuple'))
          for (const leaf of tuplePatternNames(ops[0]))
            hideStaleStatementBinding(leaf);
        else if (isSymbol(ops[0])) hideStaleStatementBinding(ops[0].symbol);

        // Resolve the effective value: a positional value wins over the
        // attributes `value`.
        const valueSource = valueOp ?? attrs?.get('value');
        const hasValue = valueSource !== undefined;
        // `let c: character = "a"` — see `narrowDeclaredCharacter`. The
        // narrowed character IS the declared value, so it replaces the
        // evaluation of the operand rather than being applied after it.
        let value: Expression | undefined;
        try {
          // A lazy collection that reads a variable is stored as the list
          // of its elements (`assignedValue`).
          value =
            narrowDeclaredCharacter(ce, type, valueSource) ??
            (hasValue ? assignedValue(ce, valueSource!.evaluate()) : undefined);
        } finally {
          for (const [symbolName, def] of hiddenStatementBindings) {
            journalCheckpointMapEntry(
              ce,
              currentScopeBindings,
              symbolName,
              symbolName,
              'declare'
            );
            currentScopeBindings.set(symbolName, def);
          }
        }

        // Resolve the remaining attributes. Both flags are read in EITHER
        // encoding, as `declareTypeStatement` reads `alias`: the `{dict: …}`
        // shorthand boxes an unquoted `True`/`never` as a STRING, the operator
        // `Dictionary` form carries the SYMBOL.
        const constantOp = attrs?.get('constant');
        const isConstant =
          constantOp !== undefined &&
          (isString(constantOp) ? constantOp.string : sym(constantOp)) ===
            'True';
        const holdOp = attrs?.get('holdUntil')?.evaluate();
        const holdUntil = (
          holdOp
            ? ((isString(holdOp) ? holdOp.string : sym(holdOp)) ?? undefined)
            : undefined
        ) as 'never' | 'evaluate' | 'N' | undefined;

        // Declare ONE name with the resolved type/constant/holdUntil.
        //
        // A symbol may already exist in the current scope as an *inferred*
        // binding with no value — typically because the block's canonical
        // pass hoisted it (see `canonicalBlock`), or an earlier statement in
        // this Block (e.g. `Assign(x, ...)`) auto-declared it during the
        // canonical pass. In that case, `ce.declare(...)` would throw
        // "already declared in this scope." Treat that case as an upgrade
        // instead: keep the binding, clear the inferred flag, and (if a
        // type is provided) tighten the type.
        //
        // Bindings that carry a value — e.g. function-argument bindings,
        // or an outer explicit declaration — are NOT upgraded; the
        // original "already declared" error is preserved for them.
        //
        // Exception: a binding this handler itself created or upgraded on a
        // *previous* evaluation (marked `_declaredByStatement`). A scope is
        // re-entered whenever the same Block expression is re-evaluated — a
        // Loop body on its second iteration, or a warmed engine re-running a
        // program — and re-executing the Declare must reset the local, not
        // conflict with its own earlier run.
        const declareOne = (
          symbolName: string,
          boundValue: Expression | undefined
        ): void => {
          const boundHasValue = boundValue !== undefined;
          const currentScope = ce.context.lexicalScope;
          let existing = currentScope.bindings.get(symbolName);
          if (
            existing &&
            (existing as { _declaredByStatement?: boolean })
              ._declaredByStatement === true
          ) {
            // Checkpoint journal (funnel 4): the statement-redeclare path
            // drops the previous statement-scoped binding by direct map
            // surgery.
            journalCheckpointMapEntry(
              ce,
              currentScope.bindings,
              symbolName,
              symbolName,
              'declare'
            );
            currentScope.bindings.delete(symbolName);
            existing = undefined;
          }
          const existingValueDef =
            existing && isValueDef(existing) ? existing : undefined;
          const isAutoDeclareHere =
            !!existingValueDef &&
            existingValueDef.value.inferredType &&
            existingValueDef.value.value === undefined;

          if (isAutoDeclareHere && existingValueDef) {
            // Checkpoint journal (funnel 5): this branch rewrites the record
            // in place — `holdUntil`, `_isConstant` and, when the declaration
            // is untyped, nothing that goes through a journaled setter. One
            // whole-record snapshot covers every field it can touch.
            journalDefinitionRecord(ce, existingValueDef.value, 'declare');
            // `_declaredByStatement` lives on the BINDING record, not on
            // either half, so it needs its own entry.
            journalCheckpointField(
              ce,
              existingValueDef as { _declaredByStatement?: boolean },
              '_declaredByStatement',
              (existingValueDef as { _declaredByStatement?: boolean })
                ._declaredByStatement,
              'declare'
            );
            // Upgrade the existing auto-declared binding in place.
            (
              existingValueDef as { _declaredByStatement?: boolean }
            )._declaredByStatement = true;
            if (hasType) {
              // State event (§2c): a typed `let` with no initializer has no
              // accompanying value write, so the retype must emit its own
              // zero-mask `type-write`.
              ce._noteStateEvent({
                kind: 'type-write',
                callableBefore: containsSignatureArm(
                  existingValueDef.value.type?.type
                ),
                callableAfter: containsSignatureArm(parseType(type!)),
              });
              // Effects-axis provenance (W3 of
              // `docs/EFFECTS-MODEL.md`): the
              // upgrade can turn the effects annotation into a CONTRACT
              // (`let f: (n) pure -> n` over an auto-declared `f`); a bare
              // typed `let` moves nothing (false→false, same spelling) and
              // records nothing.
              const effectsBefore = effectsContractStateOf(
                existingValueDef.value
              );
              existingValueDef.value._setType(() => ce.type(type!));
              existingValueDef.value.inferredType = false;
              existingValueDef.value.effectsDeclared = effectsDeclared;
              recordEffectsTransition(
                ce,
                existingValueDef.value,
                effectsBefore,
                effectsContractStateOf(existingValueDef.value),
                existingValueDef.value.type,
                ce._inferenceCause?.expr ?? undefined
              );
            }
            if (holdUntil) existingValueDef.value.holdUntil = holdUntil;
            if (boundHasValue) ce.assign(symbolName, boundValue!); // assign while mutable
            if (isConstant)
              // Freeze AFTER assigning the value. There is no public setter to
              // turn an existing definition into a constant, so set the backing
              // flag directly. This is safe here: the value was just assigned
              // (so the binding holds a concrete `_value`), and the config-change
              // listener / `_defValue` recomputation that the constructor sets up
              // is only needed for precision-dependent constants (`Pi`), which
              // cannot be expressed through `Declare`.
              (
                existingValueDef.value as unknown as {
                  _isConstant: boolean;
                }
              )._isConstant = true;
          } else {
            // Fresh declaration.
            const def: Partial<ValueDefinition> = {};
            if (hasType) {
              def.type = type;
              // Only ever set it TRUE: `ce.declare` reads a non-empty
              // specifier off the type itself, and an explicit `false` here
              // would suppress that.
              if (effectsDeclared)
                (def as { effectsDeclared?: boolean }).effectsDeclared = true;
            } else if (!boundHasValue) {
              // Preserve the bare-declare default (inferred `unknown`). When a
              // value is present without a type, leave the type unset so
              // `ce.declare` infers it from the value.
              def.inferred = true;
              def.type = 'unknown';
            }
            if (boundHasValue) def.value = boundValue;
            if (holdUntil) def.holdUntil = holdUntil;
            if (isConstant) (def as { isConstant?: boolean }).isConstant = true;
            ce.declare(symbolName, def);
            const created = ce.context.lexicalScope.bindings.get(symbolName);
            if (created)
              (
                created as { _declaredByStatement?: boolean }
              )._declaredByStatement = true;
          }
        };

        // Would declaring `symbolName` with `boundValue` be rejected by the
        // positional type? Answered WITHOUT writing anything, so a
        // destructuring pattern can validate every leaf before it declares the
        // first one.
        //
        // The verdict is the one both `declareOne` branches ultimately reach —
        // the per-axis `matchesDeclaredTypeAxes` (the fresh branch through the
        // value-definition constructor, the upgrade branch through
        // `ce.assign`) — with the same arguments and the same error value, so
        // the diagnostic is unchanged: same code, same blamed name.
        const validateOne = (
          symbolName: string,
          boundValue: Expression
        ): Expression | null => {
          if (!hasType) return null;
          const declaredType = ce.type(type!);
          // Both install branches skip the check for an unknown declared type
          // — and `"unknown"` is exactly the filler the positional-value form
          // puts in the type slot when there is no annotation, so this is the
          // untyped path.
          if (declaredType.isUnknown) return null;
          // A `Function` literal is RECONCILED against a declared signature
          // before being checked (`ce.declare()` ascribes the declared return
          // type onto a literal that lacks one). Checking it here, ahead of
          // that, could reject a value the install path accepts, so leave
          // literals to the install path.
          if (isFunction(boundValue, 'Function')) return null;
          if (
            matchesDeclaredTypeAxes(
              ce,
              boundValue.type,
              declaredType,
              effectsDeclared,
              boundValue,
              symbolName
            )
          )
            return null;
          return typeCompatibilityErrorValue(
            ce,
            declaredTypeError(symbolName, boundValue, declaredType)
          );
        };

        //
        // `Declare((x, y), {value -> t})` — a destructuring declaration
        // (`let (x, y) = t`). The pattern is a raw Tuple of symbols (`_`
        // skips a position) or nested tuple patterns — irrefutable in FORM;
        // a runtime shape mismatch is an Error value. Requires a value. Each
        // name declares in the current scope (constant for `const`);
        // evaluates to the tuple value.
        //
        // The value is the one resolved above — the POSITIONAL operand
        // (`Declare((x, y), "unknown", t)`) or the attributes `value`, with
        // the same precedence as for a symbol name. The two forms read the
        // operands through the single resolution above so they cannot drift:
        // the positional value used to be invisible here, and the
        // declaration silently bound nothing.
        //
        // A positional type is passed through to each name, as it is for a
        // symbol name (`declareOne` closes over it). The Epsil surface has no
        // spelling for it — a `:` annotation on a destructuring `let` is a
        // parse diagnostic, and `"unknown"` is the no-annotation filler the
        // positional value form needs in the type slot.
        //
        if (isFunction(ops[0], 'Tuple')) {
          if (!hasValue) return undefined;
          // A per-name failure surfaces as an error value, exactly as it does
          // for a symbol name below — but it must not leave the pattern half
          // declared: a leaf value that does not fit the positional type is
          // rejected in a read-only pre-pass over EVERY position (see
          // `bindTuplePattern`), so nothing is installed, exactly as for a
          // shape mismatch. Without it,
          // `Declare((x, y), "integer", (3, 4.5))` bound `x` and then errored
          // on `y`.
          try {
            return (
              bindTuplePattern(
                ce,
                ops[0],
                value!,
                (name, el) => {
                  // Each leaf is stored as a plain declaration stores it
                  // (`assignedValue`).
                  declareOne(name, assignedValue(ce, el));
                  return null;
                },
                validateOne
              ) ?? value!
            );
          } catch (e) {
            if (isEffectContractError(e))
              return effectContractErrorValue(ce, e);
            if (isTypeCompatibilityError(e))
              return typeCompatibilityErrorValue(ce, e);
            throw e;
          }
        }

        // As in `Assign`: the declared operand is a NAME held raw, so read it
        // directly rather than evaluating it (which would resolve it to a
        // value and make the declaration vanish).
        const symbolName = sym(isSymbol(ops[0]) ? ops[0] : ops[0].evaluate());
        if (!symbolName) return undefined;

        // See the `Assign` handler: a violated definition-annotation contract
        // — or a declared-type mismatch — is not installed and surfaces as an
        // `incompatible-type` error value.
        try {
          declareOne(symbolName, hasValue ? value : undefined);
        } catch (e) {
          if (isEffectContractError(e)) return effectContractErrorValue(ce, e);
          if (isTypeCompatibilityError(e))
            return typeCompatibilityErrorValue(ce, e);
          throw e;
        }
        return hasValue ? value : ce.Nothing;
      },
    },

    DeclareType: {
      description:
        'Declare a type. Types are engine-global (not lexically scoped), so ' +
        'this is only valid at the top level of a program — inside a block ' +
        'or function body it is an error. The name is a symbol (or a ' +
        'string) and the type a string holding a type expression, e.g. ' +
        '`"tuple<x: integer, y: integer>"`. The type is nominal by default; ' +
        'an optional trailing attributes dictionary with `alias -> True` ' +
        'makes it a structural alias instead, and an additional ' +
        '`typeParams -> "T, U: number"` entry makes it a GENERIC alias whose ' +
        'uses must be applied (`Pair<integer>`). The declaration also mints a ' +
        'value constructor of the same name — `["point", 1, 2]`, an inert ' +
        'tagged value for a nominal type, a checked identity for an alias — ' +
        'except for a `record` body, which mints none. Evaluates to ' +
        '`Nothing`.',
      lazy: true,
      // Introduces a type binding in a scope that outlives the application:
      // the `scope` label (see `Declare`).
      signature:
        '(symbol|string, type: string|symbol|type, attributes: dictionary<any>?) scope -> nothing',
      examples: ['type point = tuple<x: number, y: number>\npoint(1, 2)'],
      // A STORING writer, like `Declare`: no position applies a
      // function-valued operand.
      invokes: false,
      canonical: (args, { engine: ce }) => {
        // The name and type operands are kept RAW: canonicalizing the name
        // would auto-declare it as a variable (or bind a library constant),
        // and canonicalizing the type would do the same to a type-name symbol
        // such as `real`. Only a trailing attributes dictionary is
        // canonicalized, so that its `.get(...)` accessor works.
        const attrs = args[2]?.canonical;

        // Register during the canonical pass, so that the statements
        // canonicalized after this one (in the same `Block`) see the type.
        const settled: { typeText?: string } = {};
        const err = withStatementRoute(ce, (route) =>
          declareTypeStatement(ce, args[0], args[1], attrs, route, settled)
        );
        if (err) return err;

        // A FUNCTION-shaped type operand (`Type(x)`, a computed `TypeFrom`)
        // was EVALUATED by the registration above. Keeping the raw operand
        // would make the evaluate handler — which runs the same registration
        // again — evaluate it a SECOND time, so an impure operand could
        // declare a different type than this pass just did. Carry the settled
        // type VALUE instead: re-settling an already-canonical text is a
        // no-op, which makes the evaluate pass idempotent by construction. A
        // name operand stays raw (canonicalizing it would auto-declare it).
        const typeOp =
          settled.typeText !== undefined
            ? ce._fn('TypeFrom', [ce.string(settled.typeText)])
            : args[1];
        const ops = [args[0], typeOp];
        if (attrs) ops.push(attrs);
        return ce._fn('DeclareType', ops);
      },
      evaluate: (ops, { engine: ce }) => {
        // Idempotent: the canonical pass normally already registered the type
        // in this same scope object, and `fromStatement` lets us replace our
        // own record (with a possibly edited body).
        return (
          withStatementRoute(ce, (route) =>
            declareTypeStatement(ce, ops[0], ops[1], ops[2], route)
          ) ?? ce.Nothing
        );
      },
    },

    DeclareSumType: {
      description:
        'Declare a SUM TYPE: N nominal variants plus the transparent union ' +
        'that names them, in one statement — the lowering of the Epsil sugar ' +
        '`type node = lit(num: number) | plus(op1: node, op2: node)`. The ' +
        'name is a symbol (or a string); each variant is a ' +
        '`["Tuple", name, payload]` pair whose payload is a type string ' +
        '(`"nothing"` for a nullary variant). An optional attributes ' +
        'dictionary at operand 1 — ahead of the variants — carries ' +
        '`typeParams -> "T"` for a generic sum, whose parameters are ' +
        'distributed to each variant by usage. The sum name is ' +
        'forward-registered before the variants are declared, so a payload ' +
        'may name it bare. A variant name that already names a type, is ' +
        'reserved, or is a builtin is rejected and NOTHING is declared. ' +
        'Types are engine-global, so this is only valid at the top level of ' +
        'a program. Evaluates to `Nothing`.',
      lazy: true,
      // Introduces type bindings (and their constructors) in a scope that
      // outlives the application: the `scope` label, as `DeclareType`.
      signature: '(symbol|string, any*) scope -> nothing',
      examples: [
        'type shape = circle(r: number) | square(s: number)\nmatch square(3) {\n  circle(r) => pi * r^2\n  square(s) => s^2\n}',
      ],
      // A STORING writer, like `DeclareType`.
      invokes: false,
      canonical: (args, { engine: ce }) => {
        // The name and the variant tuples are kept RAW — canonicalizing them
        // would auto-declare the names as variables. Only an attributes
        // dictionary is canonicalized, so that its `.get(…)` accessor works.
        const ops = [...args];
        if (ops.length > 1 && !isFunction(ops[1], 'Tuple'))
          ops[1] = ops[1].canonical;

        // Register during the canonical pass, so that the statements
        // canonicalized after this one see the sum and its variants.
        const err = withStatementRoute(ce, (route) =>
          declareSumTypeStatement(ce, ops, route)
        );
        if (err) return err;
        return ce._fn('DeclareSumType', ops);
      },
      evaluate: (ops, { engine: ce }) =>
        withStatementRoute(ce, (route) =>
          declareSumTypeStatement(ce, ops, route)
        ) ?? ce.Nothing,
    },

    DeclareProtocol: {
      description:
        'Declare a PROTOCOL: a set of function and property requirements a ' +
        'type may declare itself to satisfy. Protocols are engine-global ' +
        '(not lexically scoped) and are NOT types, so this is only valid at ' +
        'the top level of a program. The name is a symbol (or a string); the ' +
        'optional members ride as a dictionary of ' +
        '`member -> ["Pair", "function"|"readonly"|"readwrite", signature]`, ' +
        'with the signature as a type-expression string. A `function` ' +
        "member's first parameter must be typed `Self`, the substitution " +
        'token standing for the conforming type. A protocol with no members ' +
        'is a SEMANTIC protocol (a marker). Evaluates to `Nothing`.',
      lazy: true,
      // Introduces an engine-global declaration that outlives the
      // application: the `scope` label (see `DeclareType`).
      signature: '(symbol|string, members: dictionary<any>?) scope -> nothing',
      examples: [
        'protocol Area { function area(self: Self) -> number }\ntype square = tuple<side: number> is Area {\n  function area(self: square) -> number { self.side^2 }\n}\narea(square(3))',
      ],
      // A STORING writer, like `DeclareType`: no position applies a
      // function-valued operand.
      invokes: false,
      canonical: (args, { engine: ce }) => {
        // Every operand is kept RAW: canonicalizing the name would
        // auto-declare it as a variable, and the members dictionary carries
        // `Self`-typed signatures no type resolver knows.
        const err = withStatementRoute(ce, (route) =>
          declareProtocolStatement(ce, args[0], args[1], route)
        );
        if (err) return err;
        return ce._fn('DeclareProtocol', args);
      },
      evaluate: (ops, { engine: ce }) =>
        withStatementRoute(ce, (route) =>
          declareProtocolStatement(ce, ops[0], ops[1], route)
        ) ?? ce.Nothing,
    },

    DeclareConformance: {
      description:
        'Declare that a type CONFORMS to one or more protocols — the ' +
        'lowering of the Epsil `type string is Hashable & Comparable` ' +
        'statement. The target rides as a type-expression string and must be ' +
        'named and ground (not a union, an anonymous structural type or a ' +
        '`type alias` name); the protocols ride as a `List` of names. An ' +
        'optional trailing dictionary carries the implementation block, ' +
        'member name -> function literal (property handlers under the ' +
        'mangled keys `__get__x` / `__set__x`); it may only accompany a ' +
        'SINGLE protocol. A CONDITIONAL conformance carries, ahead of that ' +
        'block, the source text of its trailing `where` clause as a string: ' +
        'the target is then a head pattern naming the variables the clause ' +
        'binds (`list<T>` with `"where T is Comparable"`). Conformance is ' +
        'monotone — it can be added but ' +
        'never removed — and a re-declaration is a no-op. Evaluates to ' +
        '`Nothing`.',
      lazy: true,
      signature:
        '(target: string|symbol, protocols: any, whereClauseOrImplementation: any?, implementation: dictionary<any>?) scope -> nothing',
      examples: [
        'protocol Copyable {}\ntype string is Copyable\n"abc" is Copyable',
      ],
      invokes: false,
      canonical: (args, { engine: ce }) => {
        const err = withStatementRoute(ce, (route) =>
          declareConformanceStatement(
            ce,
            args[0],
            args[1],
            args[2],
            args[3],
            route
          )
        );
        if (err) return err;
        return ce._fn('DeclareConformance', args);
      },
      evaluate: (ops, { engine: ce }) =>
        withStatementRoute(ce, (route) =>
          declareConformanceStatement(ce, ops[0], ops[1], ops[2], ops[3], route)
        ) ?? ce.Nothing,
    },

    ProtocolMember: {
      description:
        'Invoke a protocol member on a value — the lowering of a QUALIFIED ' +
        'protocol call (`Comparable.compare(x, y)` in Epsil, whose parse, a ' +
        '`MemberCall` on the protocol name, canonicalizes to ' +
        '`Apply(Field(Comparable, "compare"), x, y)`). The first two operands ' +
        'name the protocol and the member; the rest are the call arguments. ' +
        'Dispatch is dynamic and restricted to the named protocol: the most ' +
        'specific conformance implementation for the runtime type of the ' +
        'first argument is invoked. Several equally specific implementations ' +
        'are `protocol-call-ambiguous`; none is ' +
        '`protocol-implementation-missing`; an argument whose type cannot ' +
        'decide the question leaves the call symbolic.',
      signature:
        '(protocol: string, member: string, arguments: any*) -> unknown',
      examples: [
        'protocol Negatable { function negated(self: Self) -> Self }\ntype number is Negatable { function negated(self) -> number { -self } }\nNegatable.negated(5)',
      ],
      canonical: (ops, { engine: ce }) => canonicalProtocolMember(ce, ops),
      // The handler reads the operands' names and types only, through the
      // read-only engine view's protocol registry.
      type: (ops, { engine: ce }) =>
        BoxedType.forResult(
          protocolMemberResultType(ce, ops),
          ce._typeResolver
        ),
      evaluate: (ops, options) =>
        evaluateProtocolMember(options.engine, ops, options),
    },

    // Deliberately NOT `lazy`: the operands are evaluated before the handler
    // runs, which is what guarantees a `set` handler — an author's, or one the
    // engine synthesized for a field-backed property — receives the EVALUATED
    // value rather than the unevaluated right-hand side. A store must write
    // what its right-hand side evaluates to, exactly as assignment to an
    // identifier does, and holding the operands would break that on every
    // route that reaches a setter through this operator.
    // (`docs/TYPE_SYSTEM_ROADMAP.md` Appendix B, "A store writes the
    // evaluated value".)
    //
    // A SET through this operator (the FOUR-operand form) carries the `state`
    // effect, and the signature below does not spell it: three operands are a
    // READ and four are a WRITE, so one declared arrow cannot describe both.
    // The label is applied per call site instead, by `mutationEffects()` in
    // `boxed-expression/effects-of.ts` on the runtime channel and by the
    // `ProtocolProperty` arm of `boxed-expression/effects-inference.ts` on the
    // inference channel. What justifies labelling every set rather than asking
    // the registry what the selected handler does: a writable property is
    // meaningful only on a mutable object
    // (`docs/TYPE_SYSTEM_ROADMAP.md` Appendix B, "Which types can conform"),
    // so a set is a heap store by definition — an author's `set` handler
    // storing into a field, or the accessor the engine synthesizes for a
    // field-backed property.
    ProtocolProperty: {
      // Neither half invokes a function-valued operand: a READ loads or
      // computes the property and a SET hands the value to the setter, and in
      // both the operands are the protocol name, the property name, the
      // receiver and the value — never a callback this operator applies. The
      // flag makes the two effect channels agree on that: the runtime
      // projection stops consulting `invokesAt`, and the `ProtocolProperty`
      // arm of `effects-inference.ts` correspondingly skips `projectOperands`.
      invokes: false,
      description:
        'Read (or write) a protocol PROPERTY through a NAMED protocol — the ' +
        'lowering of the qualified field form `person.(Nameable.name)` ' +
        '(protocols design P6, amending the D16 field grammar). The first ' +
        'two operands name the protocol and the property; the third is the ' +
        'receiver. A fourth operand makes it a property STORE — the qualified ' +
        'write `person.(Nameable.name) = v` — which invokes the `set` ' +
        'accessor against the receiver, discards what it returns, and ' +
        'evaluates to the value assigned; a receiver that is not an object is ' +
        '`immutable-value-assignment`. Dispatch is dynamic and restricted to ' +
        'the named protocol: the most specific conformance implementation for ' +
        'the runtime type of the receiver is invoked.',
      signature:
        '(protocol: string, property: string, receiver: any, value: any?) -> unknown',
      examples: [
        'protocol Signed { readonly sign: string }\ntype number is Signed {\n  get sign(self) -> string { if (self < 0) { "-" } else { "+" } }\n}\nlet x = -12\nx.(Signed.sign)',
      ],
      // See `ProtocolMember`: names and types only, no operand expression.
      type: (ops, { engine: ce }) =>
        BoxedType.forResult(
          protocolPropertyResultType(ce, ops),
          ce._typeResolver
        ),
      evaluate: (ops, options) =>
        evaluateProtocolPropertyOperator(options.engine, ops, options),
    },

    /** Return the type of an expression */
    Type: {
      description:
        'The STATIC type of an expression, as a type value: ' +
        '`Type(3)` is `TypeFrom("integer")`. The observer does not ' +
        'evaluate its operand. Recover the text with `StringFrom(Type(x))`; ' +
        'in a string interpolation a type value renders as its text ' +
        'directly. BREAKING (2026-08-19, ruling R3 of ' +
        '`docs/TYPE-SYSTEM.md`): the result used to ' +
        'be a STRING, and `Type(x) == "some text"` is now always `False` — ' +
        'use `x is T`, `Subtype(Type(x), u)`, or compare `StringFrom` text.',
      lazy: true,
      // An observer: `Type("a" + 1)` is the `error` type value. Holding the
      // operand is what makes that work on the box/parse routes (the raw
      // operand carries no `Error` node yet); the flag makes it work on the
      // routes that hand over an already-canonical operand —
      // `("a" + 1) |> Type`, `Apply(Type, …)`.
      inspectsErrors: true,
      signature: '(any) -> type',
      examples: ['Type("hi")', 'Type([1, 2, 3])'],
      // `inspectsErrors` deliberately lets a well-formed `Type(Error(...))`
      // observe the operand instead of propagating it. It also lets the
      // evaluate handler see Error nodes inserted by arity validation, so
      // reject malformed arity before those can be mistaken for the operand.
      canonical: (ops, { engine: ce }) => {
        // A `Sequence` operand contributes its own operands to the argument
        // list, so the effective arity is only known after lifting them:
        // `Type(Sequence(a, b))` arrives as one operand but supplies two
        // arguments, and would otherwise skip arity validation entirely.
        const args = flattenSequence(ops);
        if (args.length === 1) return ce._fn('Type', args);

        const xs = checkArity(ce, args, 1);
        // Report the marker arity validation INTRODUCED, never merely the
        // first `Error` in the list: since `inspectsErrors` lets a
        // well-formed operand be an `Error` itself, `Type(Error("boom"), 2)`
        // must surface the extra argument rather than the operand's own
        // error. `checkArity` puts its markers at the positions the expected
        // arity does not cover — a `missing` pad from `args.length` up, or an
        // `unexpected-argument` from index 1 (the arity) up — so the search
        // starts at the first such position.
        const marker = xs
          .slice(Math.min(1, args.length))
          .find((x) => isFunction(x, 'Error'));
        return marker ?? ce._fn('Type', xs);
      },
      // The operand is lazy (Type reports the static type, without
      // evaluating), but a *non-canonical* expression has no type — a lazy
      // operand is not canonicalized, so `Type(y)` reported "unknown" even
      // for a symbol bound to an integer. Canonicalize, don't evaluate.
      evaluate: ([x], { engine: ce }) => {
        const text = x.canonical.type.toString() ?? 'unknown';
        // Settle the observed text like any other construction. The text
        // came from the engine's own serializer, so a parse failure here is
        // an engine bug — surfaced, not hidden. A generic function's
        // quantified signature is admissible (polytype VALUES are legal;
        // only the comparison operators reject them).
        const settled = settleTypeText(ce, text);
        if ('error' in settled)
          return ce.error(['invalid-value', settled.error], x.toString());
        return ce._fn('TypeFrom', [ce.string(settled.canonicalText)]);
      },
    },

    /** A type expression reified as a first-class value. */
    TypeFrom: {
      description:
        'A type expression as a first-class value, constructed from its ' +
        'text: `TypeFrom("list<integer>")`. The value SETTLES at ' +
        'construction — the text is parsed, reduced, and stored back as its ' +
        'canonical form — so two values built from equivalent spellings ' +
        '(`"integer|real"`, `"real|integer"`) are the same value. `==` ' +
        'between two type values is mutual subtyping (it also equates an ' +
        'alias with its body); `==` between a type value and anything else, ' +
        'a string included, is `False`. Construction never touches the type ' +
        'registry: a forward reference (`type X`) or an unknown name is an ' +
        'error, not a registration.',
      // A settled node IS the value (like `RegExp`), but unlike `RegExp` a
      // COMPUTED operand cannot stay inert: identity compares the stored
      // canonical text, so an unsettled node is a pending construction, and
      // evaluation is what settles it. A literal operand settles at
      // canonicalization instead, surfacing a typo at the author's line.
      signature: '(text: string) -> type',
      examples: ['TypeFrom("integer | real") == TypeFrom("real")'],
      invokes: false,
      canonical: (ops, { engine: ce }) => {
        const xs = checkArity(ce, ops, 1);
        // Surface an arity failure BEFORE the literal fast path below, which
        // rebuilds the node from the first operand alone: `checkArity` reports
        // a surplus operand by APPENDING an `unexpected-argument` Error node
        // (and pads a missing one with `Error("missing")`), so a fast path
        // that keeps only the first operand would drop the report and let
        // `TypeFrom("integer", "typo")` canonicalize clean.
        const err = xs.find((x) => isFunction(x, 'Error'));
        if (err !== undefined) return err;
        const [text] = xs;
        if (text !== undefined && isString(text)) {
          const settled = settleTypeText(ce, text.string);
          if ('error' in settled)
            return ce.error(['invalid-value', settled.error], text.toString());
          return ce._fn('TypeFrom', [ce.string(settled.canonicalText)]);
        }
        return ce._fn('TypeFrom', xs);
      },
      evaluate: ([text], { engine: ce }) => {
        // A literal operand was already settled by the canonical handler, and
        // settling is idempotent — re-settling a canonical text is a no-op
        // that rebuilds the same node. Only a COMPUTED operand does real work
        // here: it has evaluated to a string by now (the operand is strict),
        // and settling it completes the construction.
        if (text === undefined || !isString(text)) return undefined;
        const settled = settleTypeText(ce, text.string);
        if ('error' in settled)
          return ce.error(['invalid-value', settled.error], text.toString());
        return ce._fn('TypeFrom', [ce.string(settled.canonicalText)]);
      },
      // The `Equal` tier of type values: MUTUAL SUBTYPING, against the
      // CURRENT registry — it equates what reduction cannot see (an alias
      // name and its body), while `isSame` stays the immutable canonical-text
      // identity. A settled type value never equals a non-type value — in
      // particular `t == "integer"` is False, never a text comparison (plan
      // ruling R8).
      eq: (a: Expression, b: Expression) => {
        const ta = settledTypeText(a);
        if (ta === undefined) return undefined;
        const tb = settledTypeText(b);
        if (tb === undefined) {
          // `b` is not a settled type value. Decide on its STATIC type: a
          // value that cannot be a type value is definitively unequal — in
          // particular `t == "integer"` is False, never a text comparison,
          // and so is `t == True`. Only an operand that could still hold a
          // type value stays undecided; `couldMatch` is the predicate for
          // that (it answers "could a value of this type be a `type`?", so
          // `unknown`, `any` and a union such as `type | nothing` all remain
          // undecided, where `matches()` would wrongly rule them out).
          return b.type.couldMatch('type') ? undefined : false;
        }
        const ce = a.engine;
        return (
          ce.type(ta).matches(ce.type(tb)) && ce.type(tb).matches(ce.type(ta))
        );
      },
    },

    /** The subtype relation between two types, as a predicate */
    Subtype: {
      description:
        'True iff the FIRST operand is a subtype of the second — ' +
        '`Subtype("integer", "number")` is `True`, `Subtype("number", ' +
        '"integer")` is `False`. This is the same compatibility relation ' +
        'annotations and signatures use. Operands are type values or type ' +
        'text; a quantified (`where`) type is not comparable and errors.',
      signature: '(subtype: string|type, supertype: string|type) -> boolean',
      examples: ['Subtype("integer", "number")'],
      canonical: (ops, { engine: ce }) => {
        const xs = checkArity(ce, ops, 2);
        // Rewrite a LITERAL string operand to a settled type value, so a typo
        // errors at the author's line — the plan's per-operator string
        // acceptance (`docs/TYPE-SYSTEM.md`,
        // "String acceptance"). A computed operand stays as written and is
        // parsed at evaluation.
        const rewritten = xs.map((op) => {
          if (!isString(op)) return op;
          const settled = settleTypeText(ce, op.string);
          if ('error' in settled)
            return ce.error(['invalid-value', settled.error], op.toString());
          return ce._fn('TypeFrom', [ce.string(settled.canonicalText)]);
        });
        const err = rewritten.find((x) => isFunction(x, 'Error'));
        if (err !== undefined) return err;
        return ce._fn('Subtype', rewritten);
      },
      evaluate: ([a, b], { engine: ce }) => {
        // Each operand is a settled type value, or a string that computed at
        // evaluation time (settle it now — same forwarding-disabled parse as
        // construction, so no route mutates the registry). Anything else
        // stays symbolic. Settling happens EXACTLY ONCE per operand: the
        // parsed `Type` is kept next to the canonical text, so the polytype
        // check and the comparison below reuse it instead of re-parsing.
        // Settling an already-settled value's stored text is a no-op on the
        // text (settling is idempotent) and is what produces its `Type`.
        const types: Type[] = [];
        for (const op of [a, b]) {
          const text = settledTypeText(op) ?? (isString(op) ? op.string : null);
          if (text === null) return undefined;
          const settled = settleTypeText(ce, text);
          if ('error' in settled)
            return ce.error(['invalid-value', settled.error], op.toString());
          types.push(settled.type);
        }
        const [pa, pb] = types;
        if (isPolytype(pa) || isPolytype(pb))
          return ce.error(
            [
              'polytype-comparison-unsupported',
              'a quantified ("where") type cannot be compared with Subtype',
            ],
            (isPolytype(pa) ? a : b).toString()
          );
        return ce.type(pa).matches(ce.type(pb)) ? ce.True : ce.False;
      },
    },

    /** The dynamic type test: does this VALUE inhabit this type? */
    MatchesType: {
      description:
        'True iff the first operand, EVALUATED, is a value of the given ' +
        'type — the engine form of the Epsil `x is T` test and of `match` ' +
        'type patterns, which both lower here. The subject is never ' +
        'unwrapped: a type VALUE is a value like any other, so ' +
        '`MatchesType(TypeFrom("integer"), "number")` is `False` while ' +
        '`MatchesType(TypeFrom("integer"), "type")` is `True`; the ' +
        'type-to-type question is `Subtype`. A settled subject is decided ' +
        'both ways; a valueless or unresolved subject answers from its ' +
        'static type when that decides it, and stays symbolic otherwise.',
      // An OBSERVER, like `IsError`: the subject is held so an `Error` value
      // can be inspected (`err is error` → True) instead of propagating away
      // before the test runs, and `inspectsErrors` extends that to the routes
      // that hand over an already-canonical operand. The handler
      // canonicalizes and evaluates the held subject exactly once.
      lazy: true,
      inspectsErrors: true,
      signature: '(subject: any, type: string|type) -> boolean',
      examples: ['MatchesType([1, 2], "list<integer>")'],
      canonical: (ops, { engine: ce }) => {
        const xs = checkArity(ce, ops, 2);
        const err = xs.find((x) => isFunction(x, 'Error'));
        // Arity errors only: a malformed call must surface its own problem.
        // A well-formed call whose SUBJECT is an error value must NOT — the
        // whole point of the observer contract is to test such a subject.
        if (err !== undefined && xs.length !== 2) return err;
        // The subject stays RAW (held); only the TYPE operand is normalized:
        // a literal string settles to a type value here, at the author's
        // line (§3.1's per-operator string acceptance).
        const t = xs[1];
        if (t !== undefined && isString(t)) {
          const settled = settleTypeText(ce, t.string);
          if ('error' in settled)
            return ce.error(['invalid-value', settled.error], t.toString());
          return ce._fn('MatchesType', [
            xs[0],
            ce._fn('TypeFrom', [ce.string(settled.canonicalText)]),
          ]);
        }
        return ce._fn('MatchesType', xs);
      },
      evaluate: ([subject, t], { engine: ce }) => {
        if (subject === undefined || t === undefined) return undefined;
        // `lazy: true` holds BOTH operands, so the type operand arrives raw
        // too: a symbol bound to a type value, or a computed string, resolves
        // only once evaluated (without this it would stay symbolic forever).
        // Canonicalize first, for the same reason the subject does: a held
        // operand arrives unbound on the box/parse routes.
        const tv = t.canonical.evaluate();
        // Only the SUBJECT is inspected (that is the observer's point); an
        // Error in the TYPE operand is the caller's mistake and propagates.
        if (isFunction(tv, 'Error')) return tv;
        // Resolve the TYPE operand: a settled type value, or a string that
        // computed at evaluation (same forwarding-disabled parse as
        // construction — no route mutates the registry).
        const tText =
          settledTypeText(tv) ?? (isString(tv) ? tv.string : undefined);
        if (tText === undefined) return undefined;
        const settled = settleTypeText(ce, tText);
        if ('error' in settled)
          return ce.error(['invalid-value', settled.error], tv.toString());
        if (isPolytype(settled.type))
          return ce.error(
            [
              'polytype-comparison-unsupported',
              'a quantified ("where") type cannot be the target of a type test',
            ],
            tv.toString()
          );
        // The single evaluation of the held subject: canonicalize (a held
        // operand arrives unbound on the box/parse routes), then evaluate.
        const v = subject.canonical.evaluate();
        const verdict = dynamicTypeTest(ce, v, settled.type);
        if (verdict === undefined) return undefined;
        return verdict ? ce.True : ce.False;
      },
    },

    /** Protocol conformance test */
    Conforms: {
      description:
        'True iff the subject conforms to EVERY named protocol. A `type` ' +
        'VALUE subject asks whether that type conforms (the branch is ' +
        'unambiguous because the `type` primitive itself declares no ' +
        'conformances); any other subject is evaluated once and its precise ' +
        'type is asked. This is the lowering of the Epsil ' +
        '`x is Hashable & Comparable` test. A valueless or unresolved ' +
        'subject stays symbolic; an unknown protocol name is an error; an ' +
        'Error-valued subject answers `False` (the `error` type declares no ' +
        'conformances). Conformance is monotone but late-bound: the answer ' +
        'reflects the registry at the moment of evaluation.',
      // An OBSERVER, exactly like `MatchesType` (all `is` lowerings share
      // the contract, so `err is Hashable` and `err is error` route the same
      // way).
      lazy: true,
      inspectsErrors: true,
      signature: '(subject: any, protocols: string+) -> boolean',
      examples: [
        'protocol Copyable {}\ntype string is Copyable\nConforms("abc", "Copyable")',
      ],
      canonical: (ops, { engine: ce }) => {
        if (ops.length < 2) {
          const xs = checkArity(ce, ops, 2);
          return (
            xs.find((x) => isFunction(x, 'Error')) ?? ce._fn('Conforms', xs)
          );
        }
        return ce._fn('Conforms', ops);
      },
      evaluate: (ops, { engine: ce }) => {
        const [subject, ...protocols] = ops;
        if (subject === undefined || protocols.length === 0) return undefined;
        // Resolve every protocol NAME first: an unknown protocol is an error
        // regardless of the subject (the internal `conformsTo` oracle answers
        // `false` for an unknown name, but a name that does not exist is a
        // mistake to surface, not a clean `False`).
        const names: string[] = [];
        for (const p of protocols) {
          const pv = p.canonical.evaluate();
          // Only the SUBJECT is inspected; an Error in a protocol operand is
          // the caller's mistake and propagates.
          if (isFunction(pv, 'Error')) return pv;
          if (!isString(pv)) return undefined;
          if (ce._protocolRegistry[pv.string] === undefined)
            return ce.error(
              ['unknown-protocol', `there is no protocol named "${pv.string}"`],
              p.toString()
            );
          names.push(pv.string);
        }
        const conformsTo = ce._typeResolver.conformsTo;
        if (conformsTo === undefined) return undefined;
        // The single evaluation of the held subject.
        const v = subject.canonical.evaluate();
        // A type-value subject asks about the HELD type; anything else asks
        // about the subject's own precise type — but only when that type is
        // EXACT (a value form). A valueless symbol's declared type cannot
        // answer soundly yet: `True` needs the downward-inheritance property
        // of `conformsTo` verified, and `False`-now can flip when a
        // conformance is declared later in the program — so the unsettled
        // case stays symbolic this round
        // (`docs/TYPE-SYSTEM.md`, outcome
        // matrix).
        const heldText = settledTypeText(v);
        let asked: Type;
        if (heldText !== undefined) {
          const settled = settleTypeText(ce, heldText);
          if ('error' in settled)
            return ce.error(['invalid-value', settled.error], v.toString());
          asked = settled.type;
          // A polytype VALUE is admissible, but asking whether a quantified
          // signature conforms would engage the existential matching machinery
          // the plan defers — the same rejection `Subtype` and `MatchesType`
          // make (`docs/TYPE-SYSTEM.md`, "Polytypes").
          if (isPolytype(asked))
            return ce.error(
              [
                'polytype-comparison-unsupported',
                'a quantified ("where") type cannot be tested for conformance',
              ],
              v.toString()
            );
        } else if (isValueForm(ce, v)) {
          asked = v.type.type;
        } else {
          return undefined;
        }
        for (const name of names) if (!conformsTo(asked, name)) return ce.False;
        return ce.True;
      },
    },

    /** True if an expression is (or embeds) an error value */
    IsError: {
      description:
        'True if the expression is an `Error` value, or a frozen expression ' +
        'embedding one (`"a" + 1`). False otherwise. Total.',
      // Holds its operand — the whole point: a strict position would bubble
      // the error away before it could be inspected (error-propagation design
      // §2, rung 1). `inspectsErrors` extends that to the routes that hand
      // over an already-canonical operand (`("a" + 1) |> IsError`), so
      // `IsError(err)` and `err |> IsError` agree.
      lazy: true,
      inspectsErrors: true,
      // Purity follows the `N`/`Evaluate` convention for lazy evaluating
      // wrappers: neither declares `pure`, so both take the definition default
      // (`pure: true`) even though they evaluate their held operand. `IsError`
      // mirrors that verbatim rather than inventing a third rule.
      signature: '(any) -> boolean',
      examples: ['IsError(Ln("a"))', 'IsError(1 + 1)'],
      canonical: (ops, { engine: ce }) => {
        // Arity is enforced HERE, not by the signature: `inspectsErrors` makes
        // the evaluate handler run even on an invalid node, so `IsError()`
        // would otherwise answer a boolean ABOUT ITS OWN missing-operand
        // marker (`True`). Surface the arity error itself instead of wrapping
        // it. Only the malformed-arity case is inspected — a well-formed
        // `IsError(<already-invalid operand>)` must still report `True`.
        if (ops.length !== 1) {
          const xs = checkArity(ce, ops, 1);
          return (
            xs.find((x) => isFunction(x, 'Error')) ?? ce._fn('IsError', xs)
          );
        }
        return ce._fn('IsError', ops);
      },
      // Canonicalize the held operand (like `Type`: a raw operand carries no
      // `Error` node yet — the validation error is minted BY canonicalization),
      // then evaluate it, so a failure that only happens at evaluation
      // (`match-no-case`) is reported too.
      evaluate: ([x], { engine: ce }) =>
        x !== undefined && errorValue(x.canonical.evaluate()) !== undefined
          ? ce.True
          : ce.False,
    },

    Evaluate: {
      description: 'Evaluate an expression.',
      lazy: true,
      signature: '(any) -> unknown',
      examples: ['Evaluate(x + x)'],
      type: ([x], context) =>
        BoxedType.forResult(x.type, context.engine._typeResolver),
      canonical: (ops, { engine: ce }) => {
        const xs = checkArity(ce, ops, 1);
        // Redundant nesting: evaluating an `Evaluate` or `N` node is exactly
        // that node's own evaluation, so keep the INNER node (the mirror of
        // `N`'s collapse, where the outer `N` carries the numericization).
        if (xs.length === 1) {
          const h = xs[0].operator;
          if (h === 'Evaluate' || h === 'N') return xs[0];
        }
        return ce._fn('Evaluate', xs);
      },
      evaluate: ([x], options) => x.evaluate(options),
      // The asynchronous twin: the operand is evaluated with `evaluateAsync`,
      // so that a long operand yields to the event loop and honours the abort
      // signal (GitHub issue #392).
      evaluateAsync: (
        [x],
        { numericApproximation, signal, effects, _contextStack }
      ) =>
        x.evaluateAsync({
          numericApproximation,
          signal,
          _effects: effects,
          _contextStack,
        }),
    },

    // Evaluate an expression at a specific point, potentially symbolically
    // i.e. it's the `f|_{a}` notation
    EvaluateAt: {
      description: 'Evaluate a function at one point or between two bounds.',
      lazy: true,
      signature: '(function, lower:expression, upper:expression) -> unknown',
      examples: ['EvaluateAt(x => x^2, 1, 3)'],
      type: ([x], context) =>
        BoxedType.forResult(
          functionResult(x.type) ?? 'number',
          context.engine._typeResolver
        ),
      canonical: (ops, { engine: ce }) => {
        if (ops.length === 0) return null;
        const fn = canonicalFunctionLiteral(ops[0]);
        if (!fn) return null;
        return ce._fn('EvaluateAt', [
          fn,
          ...ops.slice(1).map((x) => x.canonical),
        ]);
      },
      // EvaluateAt(F, a, b) = F(b) - F(a); it is how a definite integral applies
      // its limits. See ../latex-syntax/dictionary/README.md (integral subsystem).
      evaluate: ([f, lower, upper], options) => {
        const ce = options.engine;
        // The operator is `lazy`, so its arguments are not validated against
        // the signature: `EvaluateAt(f)` with no point arrives here, and
        // applying `f` to a missing argument threw a TypeError. It stays
        // unevaluated.
        if (lower === undefined) return undefined;
        // Defense in depth (see CORRECTNESS_FINDINGS P0-1): never beta-reduce
        // a function whose body still contains an inert `Integrate` (an
        // unresolved antiderivative). Substituting a bound for the parameter
        // would capture the integration variable and collapse the integral to
        // a wrong finite value. Keep the `EvaluateAt` form symbolic instead.
        // The definite-integral evaluator no longer produces such a form, but
        // any other caller is protected here too.
        if (f.has('Integrate'))
          return upper === undefined
            ? ce._fn('EvaluateAt', [f, lower])
            : ce._fn('EvaluateAt', [f, lower, upper]);

        if (upper === undefined) {
          //
          // f|_a
          //
          // Let's try to evaluate the function
          const result = apply(f, [lower]);

          // Return the reduced value, including symbolic results (e.g. with
          // free variables). Only keep the symbolic `EvaluateAt` form when the
          // application stalled on an unresolved antiderivative (its body still
          // contains an inert `Integrate`).
          if (result && !result.has('Integrate')) return result;

          // Fallback: return unevaluated symbolic form
          return ce._fn('EvaluateAt', [f, lower]);
        }

        //
        // f|_a^b = f(b) - f(a)
        //
        // Let's try to evaluate the function
        const fLower = apply(f, [lower]);
        const fUpper = apply(f, [upper]);
        // Reduce to `f(b) - f(a)` whenever both applications succeed and
        // neither stalled on an unresolved antiderivative. The result may be
        // symbolic — e.g. `7/2·k` when integrating `k·x`, or the outer
        // variable of a nested integral (`∫∫ x·y dx dy`) — which is exactly
        // what definite integration of a parametric integrand should yield.
        if (
          fLower &&
          fUpper &&
          !fLower.has('Integrate') &&
          !fUpper.has('Integrate')
        ) {
          // Build the difference with `ce.function('Subtract', …)`, not the
          // `.sub()` method: `.sub()` folds two exact numbers into a machine
          // float, so `√5 − 2` became `0.236…` and a definite integral with an
          // irrational bound, such as `∫₂^√5 4 dx`, lost its exact value.
          // The difference is evaluated so that the special values that the
          // definite-integral evaluator tests for are folded: `∞ − ∞` is
          // `Indeterminate` (a NaN), and `~∞ − 1` is `~∞`. The options of the
          // caller are passed on: under `.N()` the difference is a float, and
          // a cancellation signal also stops this evaluation.
          return ce.function('Subtract', [fUpper, fLower]).evaluate(options);
        }
        // Fallback: return unevaluated symbolic form
        return ce._fn('EvaluateAt', [f, lower, upper]);
      },
    },

    BuiltinFunction: {
      description: 'Return a built-in function symbol by name.',
      complexity: 9876,
      lazy: true,
      signature: '(symbol | string) -> symbol',
      examples: ['BuiltinFunction("Sqrt")(16)'],
      canonical: ([symbolArg], { engine: ce }) =>
        ce.symbol(
          sym(symbolArg) ??
            (isString(symbolArg) ? symbolArg.string : undefined) ??
            'Undefined'
        ),
    },

    Function: {
      description: 'A function literal',
      complexity: 9876,
      lazy: true,
      // A parameter is a bare symbol or an annotated `["Typed", symbol, type]`
      // expression, so parameters are `symbol | function`.
      signature: '(expression, (symbol | function)*) -> function',
      examples: ['(x => x^2 + 1)(3)'],
      // No `type` handler, deliberately: a `Function` literal's arrow —
      // parameters, result and effect specifier — is built by
      // `functionLiteralSignatureType`
      // (`boxed-expression/effects-inference.ts`), which `type()` in
      // `boxed-function.ts` calls directly for every expression whose
      // operator is `Function`, before any definition handler is consulted.
      // A handler here would be unreachable, and a second builder is what the
      // single construction seam forbids
      // (`test/compute-engine/effects-seam.test.ts`).
      canonical: (args, { engine }) =>
        canonicalFunctionLiteralOperands(engine, args) ?? null,

      evaluate: (_args, { engine, expression }) => {
        // "evaluating" a function literal is not the same as applying
        // arguments to it.
        // See `function apply()` for that.
        //
        // Evaluating the literal creates a closure. When the literal is
        // written in a nested block of a running function or loop, the
        // closure captures the bindings of that block now: a later
        // application or iteration writes to the same nested scopes (see
        // `captureNestedLocals`). Otherwise the literal is its own value.
        return captureNestedLocals(engine, expression) ?? undefined;
      },
    },

    Rule: {
      description: 'Pattern replacement rule.',
      lazy: true,
      signature:
        '(match: expression, replace: expression, predicate: function?) -> expression',
      examples: ['ReplaceAll(x + y, Rule(x, 2))'],
      evaluate: ([_match, _replace, _predicate], { engine: _ce }) => {
        return undefined;
      },
    },

    Simplify: {
      description: [
        'Simplify(expr): simplify an expression.',
        'Simplify(expr, assumptions): simplify under one or more boolean',
        'assumptions (e.g. `x > 0`), or a `List`/`And` of them. The assumptions',
        'hold only for the duration of the simplification.',
      ],
      lazy: true,
      // A transformer, not a strict consumer: it reports on the expression it
      // is given. Without the flag it would bubble on the routes that hand
      // over an already-canonical operand (`("a" + 1) |> Simplify`) while
      // running on the direct one, the §8a route-divergence residue. Audited:
      // the handler evaluates the operand (which bubbles on its own terms) and
      // simplifies the result — no throw, no assert.
      inspectsErrors: true,
      signature: '(any, any?) -> expression',
      examples: ['Simplify(Sin(x)^2 + Cos(x)^2)', 'Simplify(Sqrt(x^2), x > 0)'],
      // Simplification is type-preserving in the handler's view: report the
      // operand's own type.
      type: ([x], context) =>
        BoxedType.forResult(x?.type ?? undefined, context.engine._typeResolver),
      canonical: (ops, { engine: ce }) => {
        if (ops.length === 0) return ce._fn('Simplify', checkArity(ce, ops, 1));
        if (ops.length > 2) return ce._fn('Simplify', checkArity(ce, ops, 2));
        // Keep the assumption held (lazy): `x > 0` must not collapse to a
        // boolean before it is asserted in the simplification scope.
        return ce._fn('Simplify', ops);
      },
      evaluate: (ops, { engine: ce }) => {
        const raw = ops[0];
        if (raw === undefined) return undefined;
        // The `Simplify` operator evaluates its argument first, then applies
        // the simplification rules to the result — the operator counterpart of
        // the `evaluate().simplify()` recipe. Evaluation substitutes assigned
        // symbol values (`let x = 5; Simplify(x^2 + x)` → `30`) and subsumes the
        // producer-head/lambda/index/value reductions `reduceTransformerOperand`
        // performs for the other, reduce-not-evaluate transformers. The held
        // operand arrives UNBOUND, so `.canonical` first — `.evaluate()` on an
        // unbound expression does not resolve its operator definition.
        const x = raw.canonical.evaluate();
        const assumptions = ops[1];
        if (assumptions === undefined) return x.simplify() ?? undefined;
        // A `List`/`And`/`Set` bundles several assumptions; a bare predicate is
        // one. Each is asserted in a temporary scope so the assumptions do not
        // leak past this call.
        const conjuncts =
          isFunction(assumptions, 'List') ||
          isFunction(assumptions, 'And') ||
          isFunction(assumptions, 'Set')
            ? [...assumptions.ops]
            : [assumptions];
        ce.pushScope();
        try {
          for (const a of conjuncts) ce.assume(a);
          return x.simplify() ?? undefined;
        } finally {
          ce.popScope();
        }
      },
    },

    HoldValues: {
      description: [
        'HoldValues(body): evaluate `body` with its assigned free symbols',
        'shielded — each such symbol becomes a pure symbol (its declared type',
        'and in-scope assumptions apply, its assigned value does NOT) for the',
        'duration. The value-blind counterpart of evaluating `body` directly;',
        "analogous to Mathematica's `Block[{x}, …]`.",
        'HoldValues(body, [x, y]): shield only the listed symbols (a List,',
        'Set, Tuple, or a single symbol); every other symbol resolves normally.',
        'Constants (`Pi`, `ExponentialE`, …) are never shielded, assumptions',
        'survive the shield, and the global values are intact afterwards.',
      ],
      // Hold the body: it must NOT evaluate before the shield exists, or a
      // same-named assigned value would substitute first.
      lazy: true,
      signature: '(any, any?) -> expression',
      examples: [
        'let x = 5\nlet y = 2\n(x + y, HoldValues(x + y), HoldValues(x + y, [y]))',
      ],
      type: ([x], context) =>
        BoxedType.forResult(x?.type ?? undefined, context.engine._typeResolver),
      canonical: (rawOps, { engine: ce }) => {
        // The held operands arrive UNBOUND on the box/parse routes, so a
        // `type` handler reading `body.type` would see `unknown`. `.canonical`
        // binds their structure; it is value-safe (it does NOT substitute
        // assigned symbol values), so the shield still sees the symbols.
        const ops = rawOps.map((op) => op.canonical);
        if (ops.length === 0)
          return ce._fn('HoldValues', checkArity(ce, ops, 1));
        if (ops.length > 2) return ce._fn('HoldValues', checkArity(ce, ops, 2));
        return ce._fn('HoldValues', ops);
      },
      evaluate: (ops, { engine: ce, numericApproximation }) => {
        const raw = ops[0];
        if (raw === undefined) return undefined;
        // The held operand arrives UNBOUND on the box/parse routes; `.canonical`
        // binds its structure. `.canonical` is value-safe — it does NOT
        // substitute assigned symbol values, so the shield names computed below
        // still see the symbols.
        const body = raw.canonical;
        // Compute the shield names from the (canonical) body, THEN evaluate
        // inside the shield: an explicit list/set/tuple/symbol restricts the
        // shield to those names; otherwise every assigned, non-constant free
        // symbol of the body is shielded.
        const spec = ops[1];
        const names =
          spec === undefined
            ? assignedVariableNames(body)
            : holdValuesShieldNames(spec.canonical);
        return withValueShield(ce, names, () =>
          body.evaluate({ numericApproximation })
        );
      },
    },

    // Block-scoped seeding. See
    // `docs/RANDOMNESS-MODEL.md`: the n-th draw of a
    // frame is `hash(seed, n)`, a pure function of the seed and the draw
    // index, so a frame replays exactly while repeated draws inside it still
    // differ.
    WithRandomSeed: {
      description: [
        'WithRandomSeed(seed, body): evaluate `body` with a random seed frame',
        'seeded by `seed` (a finite real or a string). The block replays',
        'identically, while repeated draws WITHIN the frame differ (the n-th',
        'draw is hash(seed, n)).',
        'Scoping is dynamic: the frame is active through user-function calls,',
        'not just lexically inside `body`. Frames nest and the innermost wins.',
        'Counters are per-frame, so a nested frame does not perturb its',
        "parent's subsequent draws.",
        'Outside any frame, draws are live (non-deterministic).',
      ],
      // DELIMITS the seed frame rather than drawing from it: the runtime role
      // is the kind-valued `frameProtocol` field, not the `random` label —
      // that conflation is exactly what `docs/EFFECTS-MODEL.md` unpicks. The
      // derived `drawsRandom` getter reads `frameProtocol === 'seed'`, so the
      // pending-draw walk keeps working unchanged.
      frameProtocol: 'seed',
      // The canonical DISCHARGER (`docs/EFFECTS-MODEL.md`, "Projection and
      // discharge"). Its OWN effects are empty: it draws nothing, it delimits.
      // The held body position (operand 1) has a bound of `{any}` and
      // discharges `random`, so `WithRandomSeed(42, Random())` computes the
      // empty set — referentially transparent, as it truly is — while
      // `WithRandomSeed(42, Block(Assign(x, 1), Random()))` computes `{scope}`:
      // the frame absorbs the draws, not the scope write. Discharging from an
      // opaque `{any}` body computes the internal co-finite value ¬{random} —
      // provably not-random (so the frame gate can release) yet still impure.
      discharges: { 1: ['random'] },
      // Hold the body: it must NOT evaluate before the frame exists.
      lazy: true,
      signature: '(real | string, any) -> expression',
      examples: [
        'WithRandomSeed(42, [Random(1..6), Random(1..6), Random(1..6)])',
      ],
      // Carry the body's type through. Load-bearing, not cosmetic: a bare
      // `expression` makes a framed draw opaque, and a comparison over an
      // operand that might be a collection is declined by the compiler
      // (fail-closed), so `WithRandomSeed(s, Random()) < y` would silently
      // leave the compile path.
      type: ([, body], context) =>
        BoxedType.forResult(
          body?.type ?? undefined,
          context.engine._typeResolver
        ),
      canonical: (rawOps, { engine: ce }) => {
        // The held operands arrive UNBOUND on the box/parse routes; without
        // this the `type` handler above would read `unknown`. `.canonical`
        // binds their structure and is value-safe (it substitutes no values).
        const ops = rawOps.map((op) => op.canonical);
        if (ops.length !== 2)
          return ce._fn('WithRandomSeed', checkArity(ce, ops, 2));
        return ce._fn('WithRandomSeed', ops);
      },
      evaluate: (ops, { engine: ce, numericApproximation }) => {
        const [rawSeed, rawBody] = ops;
        if (rawSeed === undefined || rawBody === undefined) return undefined;

        // The seed is evaluated ONCE per frame entry, never per draw.
        const seedValue = rawSeed.canonical.evaluate();
        let seed: number | string;
        if (isString(seedValue)) seed = seedValue.string;
        else if (isNumber(seedValue)) {
          // A non-finite or non-real seed is a structured error, never a
          // shared zero-seed stream.
          if (seedValue.isComplex || !Number.isFinite(seedValue.re))
            return ce.error([
              'out-of-range',
              'a finite real number or a string',
              seedValue.toString(),
            ]);
          seed = seedValue.re;
        } else {
          // A seed that does not reduce to a literal (a symbol, an error…)
          // leaves the whole expression unevaluated.
          return undefined;
        }

        return withRandomSeedFrame(ce, seed, () => {
          const result = rawBody.canonical.evaluate({ numericApproximation });
          // A structured error passes through: by the draw-consumption
          // contract an error consumed zero draws, and hiding it behind an
          // inert `WithRandomSeed` would mask the diagnostic.
          if (isFunction(result, 'Error')) return result;
          // PARTIAL evaluation — the body still carries an unevaluated impure
          // application (e.g. `RandomShuffle(Range(1, n))` with `n` unbound):
          // returning the partial result would strip the seed frame and turn
          // seeded randomness into live draws (Tycho item 104). Stay
          // unevaluated as a WHOLE instead: replay is deterministic from
          // draw 0, so a later evaluation of the intact expression (after the
          // free symbol binds) reproduces the draws that did complete and is
          // exactly the single-evaluation stream.
          if (hasPendingImpureApplication(result)) return undefined;
          return result;
        });
      },
    },

    Solve: {
      description: [
        'Solve(equation, unknown): the list of solutions of an equation for the',
        'unknown. The equation may be an `Equal` expression or a bare expression',
        '(read as `= 0`), e.g. `Solve(x^2 - 1 == 0, x)` or `Solve(x^2 - 1, x)`.',
        "The unknown may be omitted: it defaults to the equation's single free",
        'variable, or to `x` when there are several and one of them is `x`.',
        'Solve([eq1, eq2, …], [x, y, …]): solve a system of equations; each',
        'solution is a tuple of values in the order of the variable list, e.g.',
        'Solve([x + y == 3, x - y == 1], [x, y]) → [(2, 1)].',
      ],
      keywords: ['roots', 'zeros'],
      // Hold the arguments: the equation must NOT be pre-evaluated, or an
      // `Equal` collapses to a boolean (`x^2 = 1` → `False`) before solving.
      lazy: true,
      // Variadic: `Solve(equation, spec₁, spec₂, …)` where each spec is a
      // symbol or `Element(symbol, collection[, condition])` (a domain). The
      // specs may be omitted entirely (the unknown is then inferred from the
      // equation). See `boxed-expression/solve-domain.ts`.
      signature: '(any, any*) -> list',
      examples: [
        'Solve(x^2 - 1 == 0, x)',
        'Solve([x + y == 3, x - y == 1], [x, y])',
      ],
      canonical: (ops, { engine: ce }) => canonicalSolve(ce, ops),
      evaluate: (ops, { engine: ce }) => evaluateSolve(ce, ops),
    },

    FindRoot: {
      description: [
        'FindRoot(equations, params): numerically find parameter values that',
        'zero the residuals. `equations` is an equation (`lhs == rhs`), a bare',
        'residual expression (read as `= 0`), or a list of either. `params` is',
        'a list of specs (a bare symbol, `(a, a0)`, or `(a, a0, lo, hi)` with',
        'box constraints), matching `FindFit`. Returns a record',
        '{parameters, converged, residualNorm, iterations}.',
      ],
      keywords: ['roots', 'zeros'],
      // Hold the arguments: an `Equal` must not collapse to a boolean, and a
      // parameter symbol may carry a seeded value that must not be substituted
      // before solving.
      lazy: true,
      signature: '(any, any) -> dictionary',
      examples: ['FindRoot(x^2 - 2, [(x, 1)])'],
      evaluate: (ops, { engine: ce }) => findRoot(ce, ops),
    },

    ReplaceAll: {
      description: [
        'ReplaceAll(expr, rules): apply one or more replacement rules to `expr`,',
        'then evaluate the result (Mathematica `expr /. rules`).',
        'A rule is `Rule(lhs, rhs)`, or `lhs -> rhs` in LaTeX (parsed as `To`;',
        'in Epsil `->` builds a dictionary entry, which is not a rule). Several',
        'rules may be given as extra arguments or as a `List`/`Set` of rules;',
        'they are applied simultaneously in a single pass.',
      ],
      // Hold the arguments: the target must not evaluate before substitution,
      // and the rules carry raw `To`/`Rule` forms.
      lazy: true,
      signature: '(any, any+) -> any',
      examples: ['ReplaceAll(x^2 + x, Rule(x, 3))'],
      canonical: (ops, { engine: ce }) => {
        if (ops.length < 2) return ce._fn('ReplaceAll', checkArity(ce, ops, 2));
        return ce._fn('ReplaceAll', ops);
      },
      evaluate: (ops, { engine: _ce }) => {
        const target = ops[0]?.canonical;
        if (target === undefined) return undefined;

        // Gather the rule operands: the 2nd and any further arguments, plus the
        // members of a `List`/`Set` of rules.
        const ruleOps: Expression[] = [];
        for (const op of ops.slice(1)) {
          if (
            isFunction(op, 'List') ||
            isFunction(op, 'Set') ||
            isFunction(op, 'Sequence')
          )
            ruleOps.push(...op.ops);
          else ruleOps.push(op);
        }

        // Split into simple symbol substitutions (applied simultaneously with a
        // single `.subs`, so rule order does not matter) and pattern rules
        // (applied with the rule machinery).
        const substitution: Record<string, Expression> = {};
        const patternRules: Rule[] = [];
        for (const r of ruleOps) {
          if (!isFunction(r, 'To') && !isFunction(r, 'Rule')) return undefined;
          const lhs = r.op1;
          const rhs = r.op2;
          const s = sym(lhs);
          if (s !== undefined) substitution[s] = rhs.canonical;
          else
            patternRules.push({ match: lhs.canonical, replace: rhs.canonical });
        }

        let result = target;
        if (Object.keys(substitution).length > 0)
          result = result.subs(substitution);
        if (patternRules.length > 0)
          result = result.replace(patternRules) ?? result;

        return result.evaluate();
      },
    },

    CanonicalForm: {
      description: [
        'Return the canonical form of an expression',
        'Can be used to sort arguments of an expression.',
        'Sorting arguments of commutative functions is a weak form of canonicalization that can be useful in some cases, for example to accept "x+1" and "1+x" while rejecting "x+1" and "2x-x+1"',
      ],
      complexity: 8200,
      lazy: true,
      signature: '(any, symbol*) -> any',
      examples: ['CanonicalForm(Hold(1 + x), "Order")'],
      // Do not canonicalize the arguments, we want to preserve
      // the original form before modifying it
      canonical: (ops, { engine: ce }) => {
        // A missing operand is an `Error("missing")` operand (`checkArity()`).
        if (ops.length === 0)
          return ce._fn('CanonicalForm', checkArity(ce, ops, 1));
        if (ops.length === 1) return ops[0].canonical;

        const forms = ops
          .slice(1)
          .map((x) => sym(x) ?? (isString(x) ? x.string : undefined))
          .filter((x) => x !== undefined) as CanonicalForm[];
        // A name that is not a canonical form is an error operand: given to
        // `canonicalForm()`, it throws.
        if (forms.some((form) => !CANONICAL_FORM_NAMES.has(form)))
          return ce._fn('CanonicalForm', [
            ops[0],
            ...ops.slice(1).map((x) => {
              const form = sym(x) ?? (isString(x) ? x.string : undefined);
              return form !== undefined && CANONICAL_FORM_NAMES.has(form)
                ? x
                : ce.error('unexpected-argument', x.toString());
            }),
          ]);
        return canonicalForm(ops[0], forms);
      },
    },

    N: {
      description: [
        'N(expr): numerically evaluate an expression',
        'N(expr, precision): evaluate to `precision` significant digits',
        'N(expr, [precision, accuracy]): evaluate with a precision goal and an accuracy goal',
      ],
      lazy: true,
      signature: '(any, (integer | list<number>)?) -> unknown',
      examples: ['N(Pi)', 'N(1/3, 4)', 'N(Exp(100), [PositiveInfinity, 20])'],
      type: ([x], context) =>
        BoxedType.forResult(x.type, context.engine._typeResolver),
      canonical: (ops, { engine: ce }) => {
        // Accept one or two arguments: N(expr) or N(expr, precision).
        if (ops.length === 0) return ce._fn('N', checkArity(ce, ops, 1));
        if (ops.length > 2) return ce._fn('N', checkArity(ce, ops, 2));

        // `lazy` keeps the operand from being EVALUATED before the handler
        // runs, but the held operand must still be canonicalized (bound) here:
        // `op.canonical` is value-safe, and an unbound operand breaks
        // consumers that read the node structurally — the map-fusion lowering
        // reads the body of a user-written `N` in a `Map` mapping function,
        // and binding is what makes it canonicalize inside the function
        // literal's parameter scope rather than at first evaluation. (The
        // `.N()` method of a lazy `Map` wraps the body in the engine-internal
        // `NumericApproximation` instead, which binds its operand the same
        // way.)
        const xs = ops.map((op) => op.canonical);

        // An inner `Evaluate` is subsumed by `N` (`x.N()` already evaluates),
        // for either arity: keep the OUTER `N` — collapsing to the `Evaluate`
        // node would drop the numericization.
        if (isFunction(xs[0], 'Evaluate') && xs[0].nops === 1)
          xs[0] = xs[0].op1;

        // Collapse nested `N(N(x))` for the single-arg form. (Not for
        // `N(N(x), p)`: the inner `N` computes at the engine's precision, the
        // outer rounds to `p` — a different result from `N(x, p)`.)
        if (xs.length === 1 && xs[0].operator === 'N') return xs[0];

        // A written goal `[p, a]` (`N(x, [p, a])`) has two elements, and
        // each element is a number: a list of another length, or an element
        // of another type (a string), is a type error. A value that is not
        // a valid goal (`[-1, 5]`) is found when the call is evaluated. A
        // set is also a type error: the elements of a set have no order,
        // and `\{30, 5\}` does not tell which one is the precision goal.
        if (isFunction(xs[1], 'Set'))
          xs[1] = ce.typeError(
            parseType('tuple<number, number>')!,
            xs[1].type,
            xs[1]
          );
        else if (isFunction(xs[1], 'List') || isFunction(xs[1], 'Tuple')) {
          const goal = xs[1];
          if (goal.nops !== 2)
            xs[1] = ce.typeError(
              parseType('tuple<number, number>')!,
              goal.type,
              goal
            );
          else if (goal.ops.some((op) => !op.type.matches('number')))
            xs[1] = ce._fn(
              goal.operator,
              goal.ops.map((op) => checkType(ce, op, 'number'))
            );
        }

        return ce._fn('N', xs);
      },
      evaluate: evaluateN,
      evaluateAsync: evaluateNAsync,
    },

    // Engine-internal: the numeric marker of a lazy `Map`. When the `.N()`
    // method is applied to a lazy `Map`, it puts this operator around the
    // body of the mapping function (`lazyBroadcastMap` and
    // `lazyMapNumericApproximation` in `collection-utils.ts`), so that each
    // element is evaluated numerically when it is read. The marker evaluates
    // its operand with the `.N()` method, and gives the same result: an
    // integer stays exact (`.N()` of the element `Sec(0)` is the exact `1`).
    // The `N` operator is different: its result is always inexact
    // (`inexactResult()`). Thus a user-written `N` in a `Map` body is not
    // this marker, and the marker is not a user-written `N`.
    NumericApproximation: {
      description:
        'Numerically evaluate an expression, as the `.N()` method does (engine-internal).',
      lazy: true,
      signature: '(any) -> unknown',
      type: ([x], context) =>
        BoxedType.forResult(x.type, context.engine._typeResolver),
      canonical: (ops, { engine: ce }) => {
        if (ops.length !== 1)
          return ce._fn('NumericApproximation', checkArity(ce, ops, 1));
        // `lazy` keeps the operand from being evaluated before the handler
        // runs, but the operand must be canonicalized (bound) here. The
        // map-fusion lowering reads the body under the marker
        // (`lazyBroadcastMap`), and binding makes the body canonicalize in
        // the parameter scope of the function literal.
        return ce._fn('NumericApproximation', [ops[0].canonical]);
      },
      // The operand is held unbound: `.N()` of an unbound expression does
      // nothing, so canonicalize (bind) it first.
      evaluate: ([x]) => x.canonical.N(),
    },

    // One draw from a DOMAIN. There is no seed argument anywhere in the
    // random family: seeding is `WithRandomSeed`. See
    // `docs/RANDOMNESS-MODEL.md` §4.
    Random: {
      description: [
        'Random(): non-deterministic real in [0, 1)',
        'Random(Interval(a, b)): a real in [a, b) (endpoint markers ignored)',
        'Random(Range(...)): an element of the range',
        'Random(xs): an element of the finite collection `xs`',
      ],
      // One plain signature: it accepts `Random()` and `Random(xs)`, and
      // rejects `Random(5)` and `Random(5, 7)`. The `random` specifier is the
      // effect set: it consumes draws from the ambient seeded stream, hence
      // impure (the derived `pure`/`drawsRandom` getters read it).
      signature: '((collection<any> | set<real>)?) random -> any',
      examples: ['Random()', 'Random(1..6)'],
      type: ([domain], context) => {
        if (domain === undefined)
          return BoxedType.forResult('real', context.engine._typeResolver);
        return BoxedType.forResult(
          randomElementType(domain),
          context.engine._typeResolver
        );
      },
      // Derived from the DOMAIN's endpoints. (The old handler read
      // `ops.every(x => x.isNonNegative)` against numeric bounds that no
      // longer exist — `Range(1, 10).isNonNegative` is `undefined`.)
      //
      // Endpoints are read through the pure literal readers only
      // (`literalIntervalEndpoints`/`literalRange`: number literals and
      // symbols with held numeric values), never evaluated: `sgn` handlers
      // are dispatched from the type path, which must not change engine
      // state — evaluating a compound bound (`Range(1, Sum(...))`) pushes
      // scopes and advances the invalidation axes (open item O7 of
      // `docs/plans/2026-08-22-type-handlers-on-types.md`). A compound
      // endpoint therefore answers `undefined` where an evaluating reader
      // could decide. A domain that `analyzeRandomDomain` provably rejects
      // (a non-positive-width or unbounded Interval, an empty Range)
      // evaluates to an error, not a draw, so no sign is claimed for it.
      sgn: ([domain]) => {
        // No-arg `Random()` ∈ [0, 1).
        if (domain === undefined) return 'non-negative';
        if (isFunction(domain, 'Interval')) {
          // Draws lie in [start, end): non-negative when the low endpoint is,
          // negative when the (excluded) high endpoint is at or below zero.
          // Each endpoint reads independently (a NaN comparison is false),
          // so `Interval(0, 50π)` still answers from its literal start.
          const [start, end] = literalIntervalEndpoints(domain);
          // A literally infinite endpoint, or a provably non-positive
          // width, is a rejected domain.
          if (!Number.isNaN(start) && !Number.isFinite(start)) return undefined;
          if (!Number.isNaN(end) && !Number.isFinite(end)) return undefined;
          if (!Number.isNaN(start) && !Number.isNaN(end) && !(start < end))
            return undefined;
          if (start >= 0) return 'non-negative';
          if (end <= 0) return 'negative';
          return undefined;
        }
        if (isFunction(domain, 'Range')) {
          const [first, upper, step] = literalRange(domain);
          // A NaN bound (symbolic or compound) is indeterminate.
          if (Number.isNaN(first) || Number.isNaN(upper) || Number.isNaN(step))
            return undefined;
          // Mirror the `Range` count arithmetic (its collection `count`
          // handler in `collections.ts`): an empty range — zero step or
          // sign-mismatched bounds — and a non-finite (hence rejected)
          // range yield an error, not a draw.
          if (step === 0) return undefined;
          if (!Number.isFinite(first) || !Number.isFinite(upper))
            return undefined;
          // Exact rational operands use the exact count, as the `count`
          // handler does: `Range(0, 9999999999999/10^12, 1)` ends at 9, and
          // the machine count `rangeCount()` would count 10 as an element.
          // Only number literals are read (`evaluateOperands` false), so the
          // engine state does not change.
          const count =
            exactArithmeticRange(domain, false)?.n ??
            rangeCount(first, upper, step);
          if (count === 0 || count === 0n) return undefined;
          const last = rangeLast([first, upper, step], count);
          if (first >= 0 && last >= 0) return 'non-negative';
          if (first <= 0 && last <= 0) return 'non-positive';
        }
        return undefined;
      },
      evaluate: (ops, { engine: ce }) => {
        // 1. No operand: one draw from the ambient frame (live if unframed).
        if (ops.length === 0) return ce.number(ce._random());

        // 2–6. Domain-directed. Validation completes before the draw, so an
        // invalid domain consumes NO draw.
        const plan = analyzeRandomDomain(ce, ops[0]);
        if (plan.kind === 'error') return plan.error;
        if (plan.kind === 'symbolic') return undefined;

        // Exactly ONE draw, for every domain kind — and zero if the selection
        // bails. Branches 4/5 read the domain AFTER drawing (`at()`, a
        // position pick), so a lazy view that shrank between the count and the
        // access yields `undefined` with the counter already advanced;
        // `withDrawRollback` puts it back (§5: symbolic/error consumes 0).
        return withDrawRollback(ce, () => {
          const u = ce._random();

          if (plan.kind === 'sequential')
            return pickPositions(ce, plan.xs, [Math.floor(u * plan.n)])[0];

          return selectRandomElement(ce, plan, u);
        });
      },
    },

    // `k` independent draws from a domain, WITH replacement — the twin of
    // `RandomSample` (without replacement). The source domain is never
    // materialized; only the `k` drawn elements are.
    RandomChoice: {
      description: [
        'RandomChoice(domain, k): a list of k independent draws from ' +
          '`domain`, with replacement. `k` may exceed the size of the ' +
          'domain — that is what replacement means. Choosing from a string ' +
          'yields a string.',
      ],
      // `k` is typed `number`, not `integer`: a caller who computes a count
      // (`Count(xs)/2`, a fitted value, `4N` for a slider `N`) should not have
      // to round it first. It is rounded on evaluation.
      //
      // The LEADING arm is the string-preservation rule (ruled 2026-09-22):
      // every draw is one of the source string's own characters, so the
      // result is a string, exactly as `Take("abc", 2)` is
      // (`docs/STRING_ROADMAP.md`, "String preservation rule"). Replacement
      // makes the result a MULTISET over those characters rather than a
      // subset, which changes nothing here: the elements are still the
      // source's own. Re-segmentation caveat: rejoining the drawn characters
      // can merge or split grapheme clusters, so the result may hold a
      // different number of characters than `k`.
      //
      // Spelled as a BOUNDED type variable (`T where T: string`), never the
      // ground type `string`: an `unknown`- or `any`-typed operand refutes no
      // arm, so a ground `string` parameter would win most-specific-wins on
      // every untyped operand and claim `string` for a call that usually
      // returns a list. A bounded variable with no call-site binding does not.
      // Same spelling as `RandomSample` (`library/statistics.ts`).
      signature:
        '((T, number) random -> T where T: string) & ((collection<any> | set<real>, number) random -> list<any>)',
      examples: ['RandomChoice(["a", "b", "c"], 5)'],
      type: ([domain, k], context) =>
        BoxedType.forResult(
          randomListType(domain, k),
          context.engine._typeResolver
        ),
      // IMPURE producer: decline-only, from the domain operand's facet alone
      // — zero draws, never `true` (the `at()` materialize fallback is
      // pure-only and could not honor it). Mirrors `RandomShuffle`.
      canEnumerate: (expr) => {
        if (!isFunction(expr)) return undefined;
        return expr.op1.isEnumerableCollection === false ? false : undefined;
      },
      evaluate: ([domain, kOp], { engine: ce }) => {
        // Domain validity is checked FIRST, by KIND, before any `k` test.
        const plan = analyzeRandomDomain(ce, domain);
        if (plan.kind === 'error') return plan.error;
        if (plan.kind === 'symbolic') return undefined;

        const k = randomCount(ce, kOp);
        if (k === null) return undefined;
        if (typeof k !== 'number') return k;
        // The string arm, here and at the return below: the draws are the
        // source string's own characters, so the result is a string (ruled
        // 2026-09-22; `docs/STRING_ROADMAP.md`, "String preservation rule").
        // `RandomChoice` is eager and has no lazy collection handlers, so the
        // join happens here rather than in
        // `evaluateStringPreservingCollection`. Drawing nothing from a string
        // is the EMPTY STRING, not an empty list.
        if (k === 0)
          return isString(domain) ? ce.string('') : ce.function('List', []);

        // EXACTLY `k` draws, in output order — and zero if the selection bails
        // after drawing (a lazy view that shrank makes `at()` return
        // `undefined`); `withDrawRollback` restores the counter so a symbolic
        // result still consumes nothing (§5).
        return withDrawRollback(ce, () => {
          if (plan.kind === 'sequential') {
            const positions: number[] = [];
            for (let i = 0; i < k; i++) {
              if ((i & 0x3ff) === 0) checkDeadline(ce._deadlineFrame);
              positions.push(Math.floor(ce._random() * plan.n));
            }
            return ce.function('List', pickPositions(ce, plan.xs, positions));
          }

          const elements: Expression[] = [];
          for (let i = 0; i < k; i++) {
            if ((i & 0x3ff) === 0) checkDeadline(ce._deadlineFrame);
            const x = selectRandomElement(ce, plan, ce._random());
            if (x === undefined) return undefined;
            elements.push(x);
          }
          // A string source is an INDEXED collection, so it reaches this arm
          // and never the `sequential` one above. Its drawn characters are
          // rejoined into a string (see the `k === 0` comment).
          if (isString(domain)) return joinCharacters(ce, elements);
          return ce.function('List', elements);
        });
      },
    },

    // The Random-redesign tombstones (`RandomInteger`, `RandomList`,
    // `RandomSeed`, `Sample`, `Shuffle`) lived here for the one release
    // promised by the redesign's §9 (0.95.0) and were deleted afterwards.
    // Those heads are now ordinary unrecognized operators — valid, inert
    // expressions — like any other unknown head.

    // @todo: need review
    Signature: {
      description: 'Return the signature string of an operator.',
      lazy: true,
      signature: '(symbol) -> string | nothing',
      examples: ['Signature(StringRepeat)'],
      evaluate: ([x], { engine: ce }) => {
        const def = operatorDefinitionOfHeldSymbol(ce, x);
        if (!def) return ce.Nothing;

        // The signature prints faithfully: an arrow slot IS the contract
        // under compatibility admission (Design E §8), so there is no
        // display projection.
        return ce.string(typeToString(def.signature.type));
      },
    },

    Subscript: {
      description: 'Subscript notation for indexing or compound symbols.',
      /**
       * The `Subscript` function can take several forms:
       *
       * If `op1` is a string, the string is interpreted as a number in
       * base `op2` (2 to 36).
       *
       * If `op1` is an indexable collection, `x`:
       * - `x_*` -> `At(x, *)`
       *
       * Otherwise:
       * - `x_0` -> Symbol "x_0"
       * - `x_n` -> Symbol "x_n"
       * - `x_{\text{max}}` -> Symbol `x_max`
       * - `x_{(n+1)}` -> `At(x, n+1)`
       * - `x_{n+1}` ->  `Subscript(x, n+1)`
       */

      // The last (subscript) argument can include a delimiter that
      // needs to be interpreted. Without the hold, it would get
      // removed during canonicalization.
      lazy: true,

      signature: '(collection<any>, any) -> any',
      examples: ['Subscript([10, 20, 30], 2)'],
      // Everything the handler needs is in the operands' types and their
      // inert structure (is the base a string literal? a symbol? is the
      // subscript a small integer, a name, or an `InvisibleOperator` of
      // those?), so it is declared on the descriptor shape.
      type: ([op1, op2], { engine: ce }) => {
        const base1 = op1?.structureOf?.();
        // A string base is read as a NUMERAL in base `op2` — the whole
        // string branch of the `canonical` handler below, never the
        // collection-element reading further down. Mirroring the same test
        // here matters now that a string is an indexed collection of
        // characters: a subscript that is not a usable base (`"abc"_x`) fell
        // through and reported `character`, while `canonical` produced the
        // `Baseform(…, Error("invalid-base"))` node — an error, not a
        // character.
        if (base1?.kind === 'string') {
          // The base's value comes from the literal's handler-visible type,
          // the only value channel a descriptor carries.
          const base = smallIntegerOperandValue(op2);
          return BoxedType.forResult(
            base !== null && base > 1 && base <= 36 ? 'integer' : 'error',
            ce._typeResolver
          );
        }

        // A subscript on a blackboard-bold RING constant canonicalizes to the
        // quotient ring `ℤ_n = ℤ/nℤ` (see the `canonical` handler below), so
        // report the same type it does. Without this, a STRUCTURAL
        // `Subscript(Integers, n)` — which never reaches `canonical` — fell
        // through to `collectionElementType` and claimed `integer`:
        // the element type of ℤ, not the type of the quotient RING.
        if (isRingConstantOperand(op1))
          return BoxedType.forResult(
            quotientRingType([op1, op2]),
            ce._typeResolver
          );

        if (op1?.facts.indexed === true)
          return BoxedType.forResult(
            collectionElementType(op1.type) ?? 'any',
            ce._typeResolver
          );

        // Check if the symbol is declared as a collection type
        const op1Name = base1?.kind === 'symbol' ? base1.name : undefined;
        if (op1Name) {
          const eltType = collectionElementType(op1!.type);
          if (eltType) return BoxedType.forResult(eltType, ce._typeResolver);
        }

        // For symbol bases with complex subscripts (like a_{n+1}), return 'unknown'
        // to allow type inference in arithmetic contexts. Simple subscripts
        // (like a_n) are converted to compound symbols during canonicalization
        // and won't reach this type function.
        if (op1Name) {
          // If the base symbol has subscriptEvaluate, the result will be a number
          // (or undefined, which keeps it as Subscript)
          const symbolDef = ce.lookupDefinition(op1Name);
          if (symbolDef?.value?.subscriptEvaluate)
            return BoxedType.forResult('number', ce._typeResolver);
          // Check if this would become a compound symbol (simple subscript)
          const sub = compoundSymbolPart(op2);
          if (sub) return BoxedType.forResult('symbol', ce._typeResolver);
          // Check for InvisibleOperator of symbols/numbers (also becomes compound symbol)
          const sub2 = op2?.structureOf?.();
          if (
            sub2?.kind === 'application' &&
            sub2.head === 'InvisibleOperator'
          ) {
            const parts = sub2.children.map((x) => nameOrSmallInteger(x));
            if (parts.every((p) => p !== undefined && p !== null))
              return BoxedType.forResult('symbol', ce._typeResolver);
          }
          // Complex subscript - return 'unknown' to allow numeric inference
          return BoxedType.forResult('unknown', ce._typeResolver);
        }
        return BoxedType.forResult('expression', ce._typeResolver);
      },

      canonical: (ops, { engine: ce }) => {
        // A missing operand is an `Error("missing")` operand, as for the
        // other operators (`checkArity()`).
        if (ops.length < 2)
          return ce._fn(
            'Subscript',
            checkArity(
              ce,
              ops.map((x) => x.canonical),
              2
            )
          );
        let [op1] = ops;
        const op2 = ops[1];
        // Save the raw symbol name BEFORE canonicalization, so that
        // `i` stays `i` (not `ImaginaryUnit`) and `e` stays `e`
        // (not `ExponentialE`) when creating compound symbols. A symbol in
        // parentheses is the symbol: `(x)_0` is `x_0`, as `x_0` is.
        const rawName =
          sym(op1) ??
          (isFunction(op1, 'Delimiter') && op1.nops === 1
            ? sym(op1.op1)
            : undefined);

        op1 = op1.canonical;
        // Is it a string in a base form:
        // `"deadbeef"_{16}` `"0101010"_2?
        if (isString(op1)) {
          const base = asSmallInteger(op2.canonical);
          if (base !== null && base > 1 && base <= 36) {
            const [value, rest] = fromDigits(op1.string, base);
            if (rest) {
              return ce.error(['unexpected-digit', rest[0]], op1.toString());
            }
            return ce.number(value);
          }
          return ce._fn('Baseform', [
            op1,
            ce.error(['invalid-base', op2.toString()]),
          ]);
        }

        // A subscript on a blackboard-bold RING constant is the quotient ring
        // `ℤ_n = ℤ/nℤ`, not an index into ℤ (a set is not an indexed
        // collection, so the `At` reading below produced a type error and a
        // bracket reserialization that no longer parsed — the
        // `at-over-declared-set-base` round-trip defect).
        // Sign-restricted spellings (`\Z_+`, `\R_{\ge0}`, …) never reach here:
        // they are matched by their own LaTeX triggers and resolve directly to
        // `PositiveIntegers` & co.
        if (isRingConstant(op1))
          return ce._fn('QuotientRing', [op1, op2.canonical]);

        // Is it a collection expression (like a list literal)?
        if (op1.isIndexedCollection) return ce._fn('At', [op1, op2.canonical]);

        // Is it a symbol declared as a collection type?
        // If so, convert to At() for indexing
        const op1Name = sym(op1);
        if (op1Name && collectionElementType(op1.type.type)) {
          // For multi-index subscripts (Sequence/Tuple), pass each index as separate arg
          if (
            (op2.operator === 'Sequence' || op2.operator === 'Tuple') &&
            isFunction(op2)
          )
            return ce._fn('At', [op1, ...op2.ops.map((x) => x.canonical)]);
          return ce._fn('At', [op1, op2.canonical]);
        }

        // If the base symbol has a subscriptEvaluate handler, keep as Subscript
        // so the evaluate handler can call it (don't create compound symbol)
        if (op1Name) {
          const symbolDef = ce.lookupDefinition(op1Name);
          if (isValueDef(symbolDef) && symbolDef.value.subscriptEvaluate) {
            return ce._fn('Subscript', [op1, op2.canonical]);
          }
        }

        // Is it a compound symbol `x_\operatorname{max}`, `\mu_0`
        // Use rawName (pre-canonical) so `i_A` doesn't become `ImaginaryUnit_A`.
        // A base that canonicalizes to a symbol is a symbol base too:
        // `Subscript(Subscript(x, 2), 1)` is `x_2_1`. The type handler above
        // reads the canonical base, and gives the type `symbol` for each of
        // these. A `Subscript` kept with that type was not a number, so
        // `(x)_0·y` became a `Tuple` and `x2_1 + y` a type error.
        const baseName = rawName ?? op1Name;
        if (baseName) {
          const subStr =
            (isString(op2) ? op2.string : undefined) ??
            sym(op2) ??
            compoundIndexDigits(asSmallInteger(op2));

          if (subStr) return ce.symbol(baseName + '_' + subStr);

          // If subscript is an InvisibleOperator of symbols/numbers (not wrapped
          // in a Delimiter), concatenate them to form a compound symbol name.
          // e.g., `A_{CD}` -> `A_CD`, `x_{ij}` -> `x_ij`, `T_{max}` -> `T_max`
          // Use parentheses for expressions: `A_{(CD)}` remains as subscript expression.
          if (isFunction(op2, 'InvisibleOperator')) {
            const parts = op2.ops.map(
              (x) => sym(x) ?? compoundIndexDigits(asSmallInteger(x))
            );
            if (parts.every((p) => p !== undefined && p !== null)) {
              return ce.symbol(baseName + '_' + parts.join(''));
            }
          }
        }

        // Unwrap Delimiter (parentheses) from the subscript expression
        // e.g., `A_{(n+1)}` -> `["Subscript", "A", ["Add", "n", 1]]`
        let sub = op2;
        if (isFunction(op2, 'Delimiter')) sub = op2.op1.canonical;

        return ce._fn('Subscript', [op1, sub]);
      },

      evaluate: (ops, { engine: ce, numericApproximation }) => {
        const [base, subscript] = ops;

        // Check if base is a symbol with a subscriptEvaluate handler
        if (isSymbol(base)) {
          const def = base.valueDefinition;
          if (def?.subscriptEvaluate) {
            // Evaluate the subscript first
            const evalSubscript = subscript.evaluate({ numericApproximation });

            // Call the custom handler
            const result = def.subscriptEvaluate(evalSubscript, {
              engine: ce,
              numericApproximation,
            });

            // If handler returned a result, use it. A handler that declines
            // keeps the expression symbolic: the base's indices are the
            // handler's to define, so none of them is a compound symbol.
            return result;
          }

          // A compound subscript on a plain symbol — `x_{k+1}`, kept as a
          // `Subscript` at canonicalization because its index is an
          // expression — names the same family of symbols the simple form
          // names: once the index is known, `x_{k+1}` with `k := 3` IS the
          // symbol `x_4`, exactly as the written `x_4` would have
          // canonicalized. So the index is evaluated, and an index that
          // comes out as a string, a symbol or a non-negative small integer
          // (the three spellings the canonical handler folds into a compound
          // name) resolves to that compound symbol, which then evaluates to
          // its value if one is assigned. The base and a symbol index use
          // their WRITTEN names (`writtenSymbolName`). Any other index keeps
          // the expression symbolic, with the evaluated index:
          // `Subscript(x, 3.5)` for `k := 2.5`, `Subscript(x, -2)` for
          // `k := -3`.
          const evaluated = subscript.evaluate({ numericApproximation });
          const part =
            (isString(evaluated) ? evaluated.string : undefined) ??
            writtenSymbolName(evaluated) ??
            compoundIndexDigits(asSmallInteger(evaluated));
          if (part !== undefined && part !== '')
            return ce
              .symbol(`${writtenSymbolName(base)}_${part}`)
              .evaluate({ numericApproximation });
          if (!evaluated.isSame(subscript))
            return ce._fn('Subscript', [base, evaluated]);
        }

        // Fallback: return undefined to keep expression symbolic
        return undefined;
      },
    },

    Symbol: {
      complexity: 500,
      description:
        'Construct a new symbol with a name formed by concatenating the arguments',
      broadcastable: true,
      lazy: true,
      signature: 'function',
      examples: ['Symbol("x", 2)'],
      // Arity is all the handler reads.
      type: (args, context) => {
        if (args.length === 0)
          return BoxedType.forResult('nothing', context.engine._typeResolver);
        return BoxedType.forResult('symbol', context.engine._typeResolver);
      },
      canonical: (ops, { engine: ce }) => {
        if (ops.length === 0) return ce.Nothing;

        // Do not canonicalized any symbol, i.e.
        // ["Symbol", "x"] should not cause the symbol "x" to be
        // declared in the current context.
        return ce._fn(
          'Symbol',
          ops.map((x) => (isSymbol(x) ? x : x.canonical))
        );
      },
      evaluate: (ops, { engine: ce }) => {
        console.assert(ops.length > 0);
        const arg = ops
          .map(
            (x) =>
              sym(x) ??
              (isString(x) ? x.string : undefined) ??
              asSmallInteger(x)?.toString() ??
              ''
          )
          .join('');

        // We canonicalize the symbol in the current
        // context. This allows the symbol to be interpreted as if dynamically scoped, not lexically scoped (lexical vs dynamic scoping)
        // let x = 5;
        // f := () => x
        // {
        //  x := 10;
        //  f()
        // }
        // This will return 5. But:
        // let x = 5;
        // f := () => Symbol(x)
        // {
        //  x := 10;
        //  f()
        // }
        // will return 10;
        return ce.symbol(arg);
      },
    },

    Timing: {
      description:
        '`Timing(expr)` evaluates `expr` and returns a pair: the time the evaluation took, in microseconds, then the value; read them as `Timing(expr)[1]` and `Timing(expr)[2]`. `Timing(expr, n)` evaluates `expr` n times (at least 3), drops the fastest and the slowest run, and returns the mean time of the others',
      // An unnamed tuple: the handler builds `Tuple(time, value)`, and a
      // tuple value carries no element names, so a declared
      // `tuple<time: …, result: …>` promised a `.result` field access that
      // failed with `incompatible-type`.
      signature: '(value, repeat: integer?) -> tuple<number, value>',
      examples: ['Timing(2 + 2)[2]'],
      // `lazy` so the handler receives the RAW operand: `Timing` must time
      // the evaluation itself. As a non-lazy operator the driver evaluated
      // the operand *before* the handler, so the handler was timing a
      // redundant re-walk of an already-evaluated result.
      lazy: true,
      evaluate: (ops, { engine: ce }) => {
        // `lazy` operands arrive RAW: canonicalize explicitly, outside the
        // timed region, so the timer measures pure evaluation.
        const expr = ops[0].canonical;
        const repeat = ops[1]?.canonical.evaluate();
        if (repeat === undefined || sym(repeat) === 'Nothing') {
          // Evaluate once
          const start = globalThis.performance.now();
          const result = expr.evaluate();
          const timing = 1000 * (globalThis.performance.now() - start);

          return ce.tuple(ce.number(timing), result);
        }

        // Evaluate multiple times
        let n = Math.max(3, toInteger(repeat) ?? 3);

        let timings: number[] = [];
        let result: Expression;
        while (n > 0) {
          const start = globalThis.performance.now();
          result = expr.evaluate();
          timings.push(1000 * (globalThis.performance.now() - start));
          n -= 1;
        }

        const max = Math.max(...timings);
        const min = Math.min(...timings);
        timings = timings.filter((x) => x > min && x < max);
        const sum = timings.reduce((acc, v) => acc + v, 0);

        if (sum === 0) return ce.tuple(ce.number(max), result!);
        return ce.tuple(ce.number(sum / timings.length), result!);
      },
    },
  },

  //
  // Wildcards
  //
  {
    Wildcard: {
      description: 'Single-expression pattern wildcard.',
      signature: '(symbol) -> symbol',
      examples: ['Wildcard(x)'],
      canonical: (args, { engine: ce }) => {
        if (args.length !== 1) return ce.symbol('_');
        return ce.symbol('_' + (sym(args[0]) ?? ''));
      },
    },
    WildcardSequence: {
      description: 'Pattern wildcard matching one or more expressions.',
      signature: '(symbol) -> symbol',
      examples: ['WildcardSequence(x)'],
      canonical: (args, { engine: ce }) => {
        if (args.length !== 1) return ce.symbol('__');
        return ce.symbol('__' + (sym(args[0]) ?? ''));
      },
    },
    WildcardOptionalSequence: {
      description: 'Pattern wildcard matching zero or more expressions.',
      signature: '(symbol) -> symbol',
      examples: ['WildcardOptionalSequence(x)'],
      canonical: (args, { engine: ce }) => {
        if (args.length !== 1) return ce.symbol('___');
        return ce.symbol('___' + (sym(args[0]) ?? ''));
      },
    },
  },

  //
  // LaTeX-related
  //
  {
    LatexString: {
      description:
        'Value preserving type conversion/tag indicating the string is a LaTeX string',
      signature: '(string) -> string',
      examples: ['Parse(LatexString(#"\\frac{1}{2}"#))'],
      evaluate: ([s]) => s,
    },

    Latex: {
      description: 'Serialize an expression to LaTeX',
      signature: '(any+) -> string',
      examples: ['Latex(Sqrt(x) / 2)'],
      evaluate: (ops, { engine: ce }) =>
        ce.expr([
          'LatexString',
          ce.string(joinLatex(ops.map((x) => serializeLatex(x.json)))),
        ]),
    },

    Parse: {
      description:
        'Parse a LaTeX string and evaluate to a corresponding expression',
      signature: '(string) -> any',
      examples: ['Parse(#"\\frac{\\pi}{2}"#)'],
      evaluate: ([s], { engine: ce }) =>
        ce.expr(parseLatex(isString(s) ? s.string : '') ?? 'Nothing'),
    },
  },

  //
  // String
  //
  {
    // This is a string interpolation function
    String: {
      description:
        'A string created by joining its arguments. The arguments are converted to their default string representation.',
      broadcastable: true,
      // A LONE collection argument is consumed whole by the evaluate handler
      // (its elements are JOINED — what makes `String(Characters(s)) == s`
      // hold), never mapped over. Multi-argument calls keep the
      // coercing-join-with-broadcast semantics.
      broadcastExemptions: ['single-collection-join'],
      signature: '(any*) -> string',
      examples: ['String("x", 2)'],
      evaluate: (ops, { engine }) => {
        if (ops.length === 0) return engine.string('');
        // SINGLE-COLLECTION JOIN. `String` is `broadcastable`, and a
        // `list<character>` is an ordinary broadcast-eligible list, so without
        // this carve-out `String(Characters(s))` would map element-wise and
        // return a `list<string>` — breaking the conversion law
        // `String(Characters(s)) == s`. One argument that is a collection
        // (and not itself text) therefore JOINS that collection's elements.
        // This mirrors the identical branch `StringJoin` already implements.
        // A NON-FINITE collection stays symbolic: there is nothing to join.
        // Multi-argument calls are unchanged.
        if (
          ops.length === 1 &&
          !isString(ops[0]) &&
          !isCharacter(ops[0]) &&
          ops[0].isCollection
        ) {
          if (!isWalkableFiniteCollection(ops[0])) return undefined;
          return engine.string(
            [...ops[0].each()]
              .map((x) =>
                isString(x) || isCharacter(x)
                  ? x.string
                  : (settledTypeText(x) ?? x.toString())
              )
              .join('')
          );
        }
        // Join the *values*: a string (or character) operand contributes its
        // content — `.toString()` on a string is its serialized form, with
        // quotes, which used to leak into the result (`String("x = ", 3)`
        // produced the content `"x = "3`). A TYPE VALUE likewise contributes
        // its canonical TEXT, not its constructor form: the interpolation
        // idiom `"x has type \(Type(x))"` must read "… has type integer",
        // never "… has type TypeFrom(\"integer\")".
        return engine.string(
          ops
            .map((x) =>
              isString(x) || isCharacter(x)
                ? x.string
                : (settledTypeText(x) ?? x.toString())
            )
            .join('')
        );
      },
    },

    // Join the elements of ONE collection of strings/characters into a
    // string, with `separator` between consecutive elements. This is the
    // inverse of `StringSplit`: `StringJoin(StringSplit(s, sep), sep) == s`
    // whenever `sep` occurs in `s` only as a separator. Precedents: Python's
    // `sep.join(xs)` and Mathematica's `StringRiffle`.
    //
    // The VARIADIC form (`StringJoin("ab", "cd")` for `"abcd"`) was REMOVED
    // in Phase 2 of the strings work: once a string is itself a collection of
    // characters, "a collection and a separator" and "two strings to
    // concatenate" are the same shape and cannot both be supported. Variadic
    // concatenation is `Join(a, b, …)`, or `"\(a)\(b)"` interpolation in
    // Epsil. A two-string call is therefore still well-typed and means the
    // separator form: `StringJoin("abc", "-")` is `"a-b-c"`, exactly as
    // Python's `"-".join("abc")` is.
    //
    // Unlike `String` (which coerces any operand to its default string
    // representation), `StringJoin` is strict: a non-string, non-character
    // ELEMENT leaves the expression unevaluated, as does a non-finite
    // collection (there is nothing to join). See `docs/STRING_ROADMAP.md`,
    // "`Join` vs. `StringJoin`".
    StringJoin: {
      description: [
        'StringJoin(xs): join the elements of the finite collection `xs` ' +
          '(strings or characters) into a string.',
        'StringJoin(xs, sep): the same, with `sep` between consecutive ' +
          'elements. The inverse of StringSplit. An empty collection joins ' +
          'to "", a one-element collection to that element. A non-text ' +
          'element, or a non-finite collection, leaves the expression ' +
          'unevaluated. For variadic concatenation use Join(a, b, …) or ' +
          'string interpolation.',
      ],
      // The element type admits `character` as well as `string`: the elements
      // of a string, and of `Characters(s)`, are characters, so both
      // `StringJoin(Characters(s))` and `StringJoin(s)` must type-check.
      signature:
        '(collection<string | character>, separator: (string | character)?) -> string',
      examples: ['StringJoin(["a", "b", "c"], "-")'],
      evaluate: ([xs, separator], { engine }) => {
        if (xs === undefined) return undefined;
        let sep = '';
        if (separator !== undefined) {
          const text = textOf(separator);
          if (text === undefined) return undefined;
          sep = text;
        }
        // A lazy collection (e.g. a `Map` result) is materialized via
        // `.each()`; a non-finite one stays symbolic. A string subject is a
        // collection of its own characters, so it needs no special case.
        if (!xs.isCollection || !isWalkableFiniteCollection(xs))
          return undefined;
        const parts: string[] = [];
        for (const op of xs.each()) {
          // An absent element is an error that names it — see
          // `absentTextElementError`.
          if (isAbsentSymbol(op)) return absentTextElementError(op);
          // A CHARACTER contributes its content just as a string does — the
          // elements of a string, and of `Characters(s)`, are characters, so
          // `StringJoin(Characters(s))` must round-trip.
          if (!isString(op) && !isCharacter(op)) return undefined;
          parts.push(op.string);
        }
        return engine.string(parts.join(sep));
      },
    },

    // Build a character — exactly one user-perceived character — from a
    // string. Follows the house `XFrom` conversion convention (`StringFrom`,
    // `ListFrom`, …). This is also the WIRE FORM of a character value:
    // `BoxedCharacter.json` is `["CharacterFrom", "'x'"]`, and the `canonical`
    // handler below is what makes `box(json(c))` the identical character.
    CharacterFrom: {
      description: [
        'CharacterFrom(s): the character `s` denotes. `s` must be exactly ' +
          'one user-perceived character (one grapheme cluster) after NFC ' +
          'normalization; an empty or multi-character string is an error.',
      ],
      // A character operand is accepted too, as for every string operator, and
      // is its own result.
      signature: '(string | character) -> character',
      examples: ['CharacterFrom("é")'],
      canonical: (ops, { engine: ce }) => {
        const xs = flatten(ops);
        // A one-cluster string LITERAL becomes the character value right here.
        // The round-trip law `box(json(c)) === c` depends on it: the wire form
        // must canonicalize back to the value it came from, not to a call that
        // merely evaluates to it.
        //
        // A string LITERAL that is NOT one cluster is decided here too, as the
        // same error value `evaluate` would produce. Its verdict cannot change
        // between canonicalization and evaluation — the text is written in the
        // source — so deciding it now is what lets `epsil check` report
        // `CharacterFrom("ab")` without running the program, exactly as it
        // already reports a multi-cluster literal passed to a `character`
        // parameter. Any NON-literal operand (a symbol, a call) keeps the call
        // form, and `evaluate` decides once the text is known.
        if (xs.length === 1 && isCharacter(xs[0])) return xs[0];
        if (xs.length === 1 && isString(xs[0])) {
          if (isSingleGraphemeCluster(xs[0].string))
            return ce.character(xs[0].string);
          return ce.error(
            ['incompatible-type', 'character', 'string'],
            xs[0].toString()
          );
        }
        return ce._fn('CharacterFrom', checkArity(ce, xs, 1));
      },
      evaluate: ([s], { engine }) => {
        if (isCharacter(s)) return s;
        if (!isString(s)) return undefined;
        if (!isSingleGraphemeCluster(s.string))
          // The operand's TYPE is fine — `string` is what the signature asks
          // for — but its VALUE is not one character. Reported with the same
          // code the literal-narrowing failure uses at a `character`-typed
          // parameter, so both spellings of "this text is not one character"
          // surface identically.
          return engine.error(
            ['incompatible-type', 'character', 'string'],
            s.toString()
          );
        return engine.character(s.string);
      },
    },

    // Split a string into a list of user-perceived characters — grapheme
    // clusters (UAX #29) — so a combining-mark sequence or a ZWJ emoji is a
    // single element. For stable, Unicode-version-independent decompositions
    // use `UnicodeScalars` (code points as integers) or `Utf8`/`Utf16` (code
    // units). A non-string argument leaves the expression unevaluated,
    // mirroring `StringJoin`.
    Characters: {
      description: [
        'Characters(s): split a string into a list of user-perceived ' +
          'characters (grapheme clusters). Synonym: GraphemeClusters. For ' +
          'stable integer decompositions see UnicodeScalars, Utf8 and Utf16. ' +
          'A non-string argument leaves the expression unevaluated.',
      ],
      signature: '(string | character) -> list<character>',
      examples: ['Characters("héllo")'],
      // The evaluate guard (`textOf`) is a complete precondition, exposed
      // for the enumerability facet — see `canEnumerate` (types-definitions).
      canEnumerate: (expr) =>
        isFunction(expr) ? canEnumerateOperand(expr.op1, isText) : undefined,
      evaluate: ([s], { engine }) => {
        const text = textOf(s);
        if (text === undefined) return undefined;
        return engine.function(
          'List',
          splitGraphemeClusters(text).map((c) => engine.character(c))
        );
      },
    },

    // Split a string into a list of substrings. With no separator, split on
    // runs of whitespace — the Unicode White_Space set spelled out in
    // `UNICODE_WHITESPACE`, not `\s`, so the behavior does not depend on the
    // host regex engine — dropping empty parts. With a non-empty separator
    // string, use JS `String.split` semantics (empty parts are kept). With an
    // EMPTY separator, split into grapheme clusters — never into UTF-16 code
    // units, which would shatter surrogate pairs into lone `�` halves
    // (JS `split('')` does exactly that). A non-string argument leaves the
    // expression unevaluated.
    StringSplit: {
      description: [
        'StringSplit(s): split a string on runs of whitespace (the Unicode ' +
          'White_Space code points), dropping empty parts.',
        'StringSplit(s, sep): split a string on the separator string `sep` ' +
          '(empty parts are kept). An empty separator splits into ' +
          'user-perceived characters (grapheme clusters), like Characters. ' +
          'A non-string argument leaves the expression unevaluated.',
        'StringSplit(s, pattern): split on each match of a regular ' +
          "expression, with the host dialect's own semantics — including " +
          'splitting at a zero-width match. Captures are not interleaved ' +
          'into the result; use StringMatchAll for those.',
      ],
      // The `regexp` arm is spelled as a separate ground arm rather than by
      // widening the separator to `string | regexp`: the two have different
      // SEMANTICS (a literal separator is matched cluster-wise, a pattern is
      // matched by the host), and keeping them apart makes the signature say
      // so. `regexp` and `string` are disjoint, so the arms cannot both apply,
      // and both return `list<string>`, so an `unknown` separator gets the
      // same result type whichever arm most-specific-wins picks.
      signature:
        '((string | character, (string | character)?) -> list<string>) & ' +
        '((string | character, regexp) -> list<string>)',
      examples: [
        'StringSplit("a,b,c", ",")',
        'StringSplit("  one two  three ")',
      ],
      // Complete precondition: op1 must be a string; a PRESENT separator must
      // be a string or a compiled pattern (an absent separator selects the
      // whitespace split).
      canEnumerate: (expr) => {
        if (!isFunction(expr)) return undefined;
        const s = canEnumerateOperand(expr.ops[0], isText);
        if (s !== true) return s;
        if (expr.ops[1] === undefined) return true;
        if (expr.ops[1].type.matches('regexp')) return true;
        return canEnumerateOperand(expr.ops[1], isText);
      },
      evaluate: ([s, sep], { engine }) => {
        const subject = textOf(s);
        if (subject === undefined) return undefined;
        let parts: string[];
        // A PATTERN separator splits on each match, host semantics. An empty
        // match would not advance, so `splitByPattern` steps past it; see
        // there.
        const bySplitPattern =
          sep !== undefined ? splitByPattern(subject, sep) : undefined;
        if (bySplitPattern !== undefined)
          return engine.function(
            'List',
            bySplitPattern.map((x) => engine.string(x))
          );
        if (sep === undefined) {
          parts = subject.split(UNICODE_WHITESPACE).filter((p) => p.length > 0);
        } else {
          const separator = textOf(sep);
          if (separator === undefined) return undefined;
          // An empty separator means "split into characters": segment into
          // grapheme clusters. JS `split('')` would cut between UTF-16 code
          // units, shattering surrogate pairs — never do that.
          if (separator === '') parts = splitGraphemeClusters(subject);
          else parts = subject.split(separator);
        }
        return engine.function(
          'List',
          parts.map((p) => engine.string(p))
        );
      },
    },

    // Replace occurrences of `target` in `s` with `replacement`.
    //
    // With a STRING target, occurrences are found by CHARACTER-WISE matching
    // over grapheme clusters — the same semantics as sequence search — so a
    // match can never start or end inside a cluster. The scan walks the
    // ORIGINAL subject's character sequence and skips past each match's span,
    // so a replacement's own content is never re-matched:
    // `StringReplace("aa", "a", "aa")` is `"aaaa"`, not an infinite
    // expansion. Matches are non-overlapping, taken left to right.
    // Re-segmentation happens ONCE, when the pieces are joined to build the
    // result (design constraint 3 of `docs/STRING_ROADMAP.md`), so a
    // replacement whose edge combines with a neighbouring character yields
    // one merged cluster.
    //
    // With a `regexp` target (Strings Phase 3) the host does the matching, so
    // the cluster-wise promise above does NOT hold: a pattern can match a
    // code point that is only part of a character, and replacing it can leave
    // a combining mark attached to whatever now precedes it. That is inherent
    // to handing matching to the host, which the dialect ruling did
    // deliberately; `replaceByPattern` in `library/regexp.ts` owns that arm.
    // The `replacement` may then also be a FUNCTION, called with the match
    // record.
    //
    // Every other operand is still string-only: splicing forces join +
    // re-segmentation, which is where strings genuinely diverge from lists,
    // and a non-string operand leaves the expression unevaluated.
    StringReplace: {
      description: [
        'StringReplace(s, target, replacement): replace every ' +
          'non-overlapping occurrence of `target` in `s`, scanning left to ' +
          'right over whole characters.',
        'StringReplace(s, target, replacement, count): replace at most ' +
          '`count` occurrences, from the left. An empty `target` is an ' +
          'error (the "insert at every boundary" behavior is deliberately ' +
          'not inherited); an empty `replacement` means deletion. `count` ' +
          'must be a positive integer.',
        'StringReplace(s, pattern, replacement, count?): `target` may be a ' +
          'regular expression, matched with the host dialect. `$1`-style ' +
          'templates are NOT expanded in `replacement`.',
        'StringReplace(s, pattern, f, count?): `replacement` may be a ' +
          'function, called with the same match record StringMatch returns, ' +
          'so each replacement can be computed from its captures.',
      ],
      // Regex arms, kept separate from the literal-target ones for the same
      // reason as `StringSplit`'s: a literal target is matched cluster-wise,
      // a pattern is matched by the host. The third arm takes a FUNCTION
      // replacement, called with the match record `StringMatch` returns, so a
      // caller can compute each replacement from its captures.
      signature:
        '((string | character, string | character, string | character, count: integer?) -> string) & ' +
        '((string | character, regexp, string | character, count: integer?) -> string) & ' +
        '((string | character, regexp, function, count: integer?) -> string)',
      examples: [
        'StringReplace("banana", "a", "o")',
        'StringReplace("banana", "a", "o", 1)',
      ],
      evaluate: ([s, target, replacement, count], { engine: ce }) => {
        const text = textOf(s);
        if (text === undefined) return undefined;
        // A PATTERN target: `replaceByPattern` owns the whole call, including
        // the `count` guard, because its notion of an occurrence is the
        // host's rather than a cluster run.
        if (target !== undefined && target.type.matches('regexp')) {
          return replaceByPattern(ce, text, target, replacement, count);
        }
        const needleText = textOf(target);
        const replacementText = textOf(replacement);
        if (needleText === undefined || replacementText === undefined)
          return undefined;
        if (needleText === '')
          return ce.error(
            'unexpected-argument',
            'StringReplace: the target must not be empty'
          );
        let limit = Infinity;
        if (count !== undefined) {
          const n = asSmallInteger(count);
          if (n === null || n < 1)
            return ce.error(
              'unexpected-argument',
              'StringReplace: count must be a positive integer'
            );
          limit = n;
        }
        const subject = splitGraphemeClusters(text);
        const needle = splitGraphemeClusters(needleText);
        const out: string[] = [];
        let i = 0;
        let done = 0;
        while (i < subject.length) {
          if (
            done < limit &&
            i + needle.length <= subject.length &&
            needle.every((c, k) => subject[i + k] === c)
          ) {
            out.push(replacementText);
            i += needle.length;
            done += 1;
          } else {
            out.push(subject[i]);
            i += 1;
          }
        }
        return ce.string(out.join(''));
      },
    },

    // Strip characters from both ends of a string. The default set is the
    // same Unicode White_Space set `StringSplit` uses (`UNICODE_WHITESPACE`),
    // so "whitespace" means the same thing across the string operators. The
    // optional `chars` argument is a SET of characters to strip, never a
    // literal substring: a string argument contributes each of ITS
    // characters. Stripping walks grapheme clusters, so it can never cut a
    // cluster in half.
    Trim: {
      description: [
        'Trim(s): remove leading and trailing whitespace (the Unicode ' +
          'White_Space characters).',
        'Trim(s, chars): remove leading and trailing characters that belong ' +
          'to `chars` — a SET of characters, given as a character, a string ' +
          "(meaning the set of that string's characters) or a collection " +
          'whose elements each contribute their own characters.',
      ],
      signature:
        '(string | character, chars: (string | character | collection<string | character>)?) -> string',
      examples: ['Trim("  hi  ")', 'Trim("--hi--", "-")'],
      evaluate: ([s, chars], { engine }) => {
        const text = textOf(s);
        if (text === undefined) return undefined;
        const set = trimCharacterSet(chars);
        if (set === undefined) return undefined;
        if (set !== null && !(set instanceof Set)) return set;
        return engine.string(trimClusters(text, set, true, true));
      },
    },

    TrimStart: {
      description: [
        'TrimStart(s): remove leading whitespace (the Unicode White_Space ' +
          'characters).',
        'TrimStart(s, chars): remove leading characters that belong to ' +
          '`chars` — a SET of characters, as for Trim.',
      ],
      signature:
        '(string | character, chars: (string | character | collection<string | character>)?) -> string',
      examples: ['TrimStart("007", "0")'],
      evaluate: ([s, chars], { engine }) => {
        const text = textOf(s);
        if (text === undefined) return undefined;
        const set = trimCharacterSet(chars);
        if (set === undefined) return undefined;
        if (set !== null && !(set instanceof Set)) return set;
        return engine.string(trimClusters(text, set, true, false));
      },
    },

    TrimEnd: {
      description: [
        'TrimEnd(s): remove trailing whitespace (the Unicode White_Space ' +
          'characters).',
        'TrimEnd(s, chars): remove trailing characters that belong to ' +
          '`chars` — a SET of characters, as for Trim.',
      ],
      signature:
        '(string | character, chars: (string | character | collection<string | character>)?) -> string',
      examples: ['TrimEnd("hi!!", "!")'],
      evaluate: ([s, chars], { engine }) => {
        const text = textOf(s);
        if (text === undefined) return undefined;
        const set = trimCharacterSet(chars);
        if (set === undefined) return undefined;
        if (set !== null && !(set instanceof Set)) return set;
        return engine.string(trimClusters(text, set, false, true));
      },
    },

    // `n` copies of `s`, concatenated and re-segmented once (design
    // constraint 3 of `docs/STRING_ROADMAP.md`), so a string whose last
    // character combines with its first can yield fewer characters than
    // `n * Length(s)`. The name is `StringRepeat` because `Repeat` is taken:
    // that is the infinite lazy collection constructor.
    StringRepeat: {
      description: [
        'StringRepeat(s, n): `n` copies of the string `s`, concatenated. ' +
          'StringRepeat(s, 0) is "". A negative or non-integer `n` is an ' +
          'error.',
      ],
      signature: '(string | character, n: integer) -> string',
      examples: ['StringRepeat("ab", 3)'],
      evaluate: ([s, n], { engine: ce }) => {
        const text = textOf(s);
        if (text === undefined) return undefined;
        const count = asSmallInteger(n);
        if (count === null || count < 0)
          return ce.error(
            'unexpected-argument',
            'StringRepeat: n must be a non-negative integer'
          );
        return ce.string(text.repeat(count));
      },
    },

    // Pad a string to `n` CHARACTERS (not code units, not display columns —
    // aligning to terminal width is an explicit non-goal). A string that
    // already has `n` or more characters is returned unchanged. A
    // multi-character `pad` repeats and its final copy is truncated on a
    // character boundary, so `PadStart("a", 4, "xy")` is `"xyxa"` — JS
    // `padStart` semantics lifted from code units to characters.
    PadStart: {
      description: [
        'PadStart(s, n, pad=" "): `s` padded at the START to `n` ' +
          'characters by repeating `pad` (its final copy truncated on a ' +
          'character boundary). Returned unchanged when `s` already has `n` ' +
          'or more characters. `n` must be a non-negative integer; an empty ' +
          '`pad` is an error; a non-string `pad` leaves the expression ' +
          'unevaluated.',
      ],
      signature:
        '(string | character, n: integer, pad: (string | character)?) -> string',
      examples: ['PadStart("42", 5, "0")'],
      evaluate: ([s, n, pad], { engine: ce }) => {
        const text = textOf(s);
        if (text === undefined) return undefined;
        const width = asSmallInteger(n);
        if (width === null || width < 0)
          return ce.error(
            'unexpected-argument',
            'PadStart: n must be a non-negative integer'
          );
        const fill = pad === undefined ? ' ' : textOf(pad);
        if (fill === undefined) return undefined;
        if (fill === '')
          return ce.error(
            'unexpected-argument',
            'PadStart: the padding must not be empty'
          );
        return ce.string(padClusters(text, width, fill, true));
      },
    },

    PadEnd: {
      description: [
        'PadEnd(s, n, pad=" "): `s` padded at the END to `n` characters by ' +
          'repeating `pad` (its final copy truncated on a character ' +
          'boundary). Returned unchanged when `s` already has `n` or more ' +
          'characters. `n` must be a non-negative integer; an empty `pad` ' +
          'is an error; a non-string `pad` leaves the expression ' +
          'unevaluated.',
      ],
      signature:
        '(string | character, n: integer, pad: (string | character)?) -> string',
      examples: ['PadEnd("abc", 6, ".")'],
      evaluate: ([s, n, pad], { engine: ce }) => {
        const text = textOf(s);
        if (text === undefined) return undefined;
        const width = asSmallInteger(n);
        if (width === null || width < 0)
          return ce.error(
            'unexpected-argument',
            'PadEnd: n must be a non-negative integer'
          );
        const fill = pad === undefined ? ' ' : textOf(pad);
        if (fill === undefined) return undefined;
        if (fill === '')
          return ce.error(
            'unexpected-argument',
            'PadEnd: the padding must not be empty'
          );
        return ce.string(padClusters(text, width, fill, false));
      },
    },

    // Unicode default (locale-independent) case mapping of the WHOLE string.
    // These are not per-character maps: full-string case mapping is
    // contextual (a final Greek sigma uppercases and lowercases differently
    // from a medial one) and can change the character count (`"ß"`
    // uppercases to `"SS"`). No locale parameter in v1 — the Turkish
    // dotless-i problem is documented, not solved — and the argument tail is
    // deliberately left free so a future `locale` appends without breaking
    // any call (`docs/STRING_ROADMAP.md`, "Shape rules adopted now", rule 1).
    ToUpperCase: {
      description: [
        'ToUpperCase(s): the string `s` mapped to upper case using the ' +
          'Unicode default (locale-independent) mappings. The character ' +
          'count can change ("ß" uppercases to "SS").',
      ],
      signature: '(string | character) -> string',
      examples: ['ToUpperCase("straße")'],
      evaluate: ([s], { engine }) => {
        const text = textOf(s);
        if (text === undefined) return undefined;
        return engine.string(text.toUpperCase());
      },
    },

    ToLowerCase: {
      description: [
        'ToLowerCase(s): the string `s` mapped to lower case using the ' +
          'Unicode default (locale-independent) mappings.',
      ],
      signature: '(string | character) -> string',
      examples: ['ToLowerCase("Hello World")'],
      evaluate: ([s], { engine }) => {
        const text = textOf(s);
        if (text === undefined) return undefined;
        return engine.string(text.toLowerCase());
      },
    },

    // Case folding — the correct primitive for case-insensitive comparison
    // (`CaseFold(a) == CaseFold(b)`), rather than comparing `ToLowerCase`
    // results.
    //
    // V1 APPROXIMATION, and what it deviates from. JS exposes no case-folding
    // API, so this is `toUpperCase()` then `toLowerCase()`: the round trip
    // through upper case is what collapses the pairs a single `toLowerCase()`
    // leaves apart (`"ß"` → `"SS"` → `"ss"`, matching a literal `"ss"`).
    // Lower-casing `"Σ"` in final position yields the final sigma `"ς"`
    // (U+03C2), which is a DIFFERENT code point from the medial `"σ"`
    // (U+03C3), so the final sigma is mapped back to the medial form — that
    // is exactly what makes `CaseFold("ΟΔΟΣ") == CaseFold("οδοσ")` hold.
    // Against UAX #44 `CaseFolding.txt` this still differs for the Cherokee
    // block (whose full folding is to UPPER case, not lower) and for the
    // Turkic and Lithuanian special cases (which are locale-tailored
    // foldings the default mappings do not apply). Those deviations are
    // accepted for v1; a full folding table would be the fix.
    CaseFold: {
      description: [
        'CaseFold(s): a case-folded form of `s`, for case-insensitive ' +
          'comparison — `CaseFold(a) == CaseFold(b)` tests equality ' +
          'ignoring case. An approximation of Unicode full case folding.',
      ],
      signature: '(string | character) -> string',
      examples: [
        'CaseFold("Straße")',
        'CaseFold("Hello") == CaseFold("HELLO")',
      ],
      evaluate: ([s], { engine }) => {
        const text = textOf(s);
        if (text === undefined) return undefined;
        return engine.string(
          text
            .toUpperCase()
            .toLowerCase()
            // GREEK SMALL LETTER FINAL SIGMA → GREEK SMALL LETTER SIGMA.
            .replace(/ς/g, 'σ')
        );
      },
    },

    // Three-valued comparison of two strings under the engine's default
    // order: their NFC Unicode SCALAR sequences, compared code point by code
    // point (see `compareScalarSequences`). This is a comparator primitive
    // for user-written sorts, and the natural future home of an optional
    // `collation` argument — which is why the argument tail is left free
    // (`docs/STRING_ROADMAP.md`, "Shape rules adopted now", rule 1). The
    // results are exact integers.
    StringCompare: {
      description: [
        'StringCompare(a, b): -1 when `a` sorts before `b`, 0 when they are ' +
          'equal, 1 when `a` sorts after `b`. The order compares Unicode ' +
          'scalar sequences code point by code point (NOT UTF-16 code ' +
          'units, which would sort astral characters below U+E000..U+FFFF).',
      ],
      signature: '(string | character, string | character) -> integer',
      examples: ['StringCompare("apple", "banana")'],
      evaluate: ([a, b], { engine }) => {
        if (
          !(isString(a) || isCharacter(a)) ||
          !(isString(b) || isCharacter(b))
        )
          return undefined;
        return engine.number(
          compareScalarSequences(a.unicodeScalars, b.unicodeScalars)
        );
      },
    },
    // Converts arguments interpreted in a specified format to a string.
    StringFrom: {
      description:
        'StringFrom(value, format?): create a string from `value`. With no ' +
        'format, a number or a list of numbers is read as Unicode scalar ' +
        'values (`StringFrom(65)` is `"A"`), and any other value is printed ' +
        '(`StringFrom(True)` is `"True"`). The formats are `"default"` ' +
        '(print the value), `"unicode-scalars"`, `"utf-8"` and `"utf-16"`.',
      signature: '(any, format:string?) -> string',
      examples: ['StringFrom(65)', 'StringFrom([72, 105])'],
      evaluate: ([value, format], { engine }) => {
        if (value === undefined) return engine.string('');
        let fmt = (isString(format) ? format.string : undefined) ?? 'default';

        // When the caller gives NO format operand, a number or a list of
        // numbers is read as Unicode scalar values instead of being printed:
        // `StringFrom(65)` is `"A"` and `StringFrom([127467, 127479])` is the
        // flag of France. Every other value — a string, a boolean, a symbol,
        // an expression, a type value — keeps the printed form. An explicit
        // format, `"default"` included, is not affected, so
        // `StringFrom(128287, "default")` is still `"128287"`. A format
        // operand that is not a string also keeps the printed form.
        // (User decision of 2026-09-22.)
        if (format === undefined && isUnicodeScalarSource(value))
          fmt = 'unicode-scalars';

        if (fmt === 'default') {
          // A TYPE VALUE converts to its canonical text — the inverse of
          // `TypeFrom`: `TypeFrom(StringFrom(t))` is `isSame`-identical to
          // `t` (the text is already settled).
          const typeText = settledTypeText(value);
          if (typeText !== undefined) return engine.string(typeText);
          // A string or a character is already text: its content, not its
          // printed form, which carries the quotes (`StringFrom("a")` was
          // `"\"a\""`). The printed form of some symbols is their name in
          // quotes (`True.toString()` is `"True"` with the quotes, and so is a
          // name that spells a type, such as `integer`): those drop the
          // quotes, as the description promises for `StringFrom(True)`.
          // Every other symbol keeps its printed form, which is not always
          // its name (`Pi` prints `pi`, `ExponentialE` prints `e`).
          if (isString(value) || isCharacter(value))
            return engine.string(value.string);
          const printed = value.toString();
          if (isSymbol(value) && printed === `"${value.symbol}"`)
            return engine.string(value.symbol);
          return engine.string(printed);
        }

        /**
         * The integer code units `value` supplies, or `undefined` when it
         * supplies none — the caller then reports the
         * `indexed_collection<integer>` type error.
         *
         * A STRING is refused outright, even though a string IS an indexed
         * collection now: its elements are CHARACTERS, not integers, so
         * decoding one as code units yielded a U+FFFD REPLACEMENT CHARACTER
         * per character (`StringFrom("abc", "utf-8")` answered `"���"`).
         * That was a clean type error before strings became collections, and
         * it stays one. Any other element that is not an integer is refused
         * for the same reason: substituting U+FFFD for it hides the mistake
         * inside a plausible-looking string.
         */
        const codeUnits = (): number[] | undefined => {
          if (isString(value) || !value.isIndexedCollection) return undefined;
          const units: number[] = [];
          for (const x of value.each()) {
            const n = toInteger(x);
            if (n === null) return undefined;
            units.push(n);
          }
          return units;
        };

        if (fmt === 'utf-8') {
          const units = codeUnits();
          if (units === undefined) {
            return engine.typeError(
              parseType('indexed_collection<integer>'),
              value.type
            );
          }
          return engine.string(
            new TextDecoder('utf-8').decode(new Uint8Array(units))
          );
        }

        if (fmt === 'utf-16') {
          const units = codeUnits();
          if (units === undefined) {
            return engine.typeError(
              parseType('indexed_collection<integer>'),
              value.type
            );
          }
          return engine.string(
            new TextDecoder('utf-16').decode(new Uint16Array(units))
          );
        }

        if (fmt === 'unicode-scalars') {
          const cp = toInteger(value);
          if (cp !== null) return engine.string(String.fromCodePoint(cp));

          const units = codeUnits();
          if (units === undefined) {
            return engine.typeError(
              parseType('indexed_collection<integer>|integer'),
              value.type
            );
          }
          return engine.string(String.fromCodePoint(...units));
        }

        return engine.string(value.toString());
      },
    },

    Utf8: {
      description: 'A collection of UTF-8 code units from a string.',
      signature: '(string | character) -> list<integer>',
      examples: ['Utf8("A€")'],
      // The evaluate guard (`isText`) is a complete precondition, exposed
      // for the enumerability facet — see `canEnumerate` (types-definitions).
      canEnumerate: (expr) =>
        isFunction(expr) ? canEnumerateOperand(expr.op1, isText) : undefined,
      evaluate: ([str], { engine }) => {
        // A string caches its UTF-8 encoding (`buffer`); a character does not
        // carry one, so its text is encoded here.
        const utf8Buffer = isString(str)
          ? str.buffer
          : isCharacter(str)
            ? new TextEncoder().encode(str.string)
            : undefined;
        if (utf8Buffer === undefined) return undefined;
        // Convert the Uint8Array to a list of integers
        return engine.function(
          'List',
          Array.from(utf8Buffer, (code) => engine.number(code))
        );
      },
    },

    Utf16: {
      description: 'A collection of UTF-16 code units from a string.',
      signature: '(string | character) -> list<integer>',
      examples: ['Utf16("A😀")'],
      // The evaluate guard (`textOf`) is a complete precondition, exposed
      // for the enumerability facet — see `canEnumerate` (types-definitions).
      canEnumerate: (expr) =>
        isFunction(expr) ? canEnumerateOperand(expr.op1, isText) : undefined,
      evaluate: ([str], { engine }) => {
        const text = textOf(str);
        if (text === undefined) return undefined;
        const utf16Values: number[] = [];
        // Convert the string to a list of Unicode scalars
        for (let i = 0; i < text.length; i++) {
          const codePoint = text.charCodeAt(i)!;
          utf16Values.push(codePoint);
        }
        return engine.function(
          'List',
          utf16Values.map((cp) => engine.number(cp!))
        );
      },
    },

    UnicodeScalars: {
      description:
        'A collection of Unicode scalars from a string, same as UTF-32',
      signature: '(string | character) -> list<integer>',
      examples: ['UnicodeScalars("A😀")'],
      // The evaluate guard (`isText`) is a complete precondition, exposed
      // for the enumerability facet — see `canEnumerate` (types-definitions).
      canEnumerate: (expr) =>
        isFunction(expr) ? canEnumerateOperand(expr.op1, isText) : undefined,
      evaluate: ([str], { engine }) => {
        if (!isString(str) && !isCharacter(str)) return undefined;
        const codePoints = str.unicodeScalars;
        return engine.function(
          'List',
          codePoints.map((cp) => engine.number(cp))
        );
      },
    },

    // Synonym of `Characters` (which is the preferred name); kept for
    // compatibility (shipped since v0.30).
    GraphemeClusters: {
      description:
        'A collection of grapheme clusters from a string. Synonym of Characters.',
      signature: '(string | character) -> list<character>',
      examples: ['GraphemeClusters("héllo")'],
      // The evaluate guard (`textOf`) is a complete precondition, exposed
      // for the enumerability facet — see `canEnumerate` (types-definitions).
      canEnumerate: (expr) =>
        isFunction(expr) ? canEnumerateOperand(expr.op1, isText) : undefined,
      evaluate: ([str], { engine }) => {
        const text = textOf(str);
        if (text === undefined) return undefined;
        return engine.function(
          'List',
          splitGraphemeClusters(text).map((c) => engine.character(c))
        );
      },
    },

    BaseForm: {
      description: '`BaseForm(expr, base=10)`',
      complexity: 9000,
      signature: '(T, (string|number)?) -> T where T: number',
      evaluate: ([x]) => x,
    },

    DigitsFrom: {
      description: `Return an integer representation of the string \`s\` in base \`base\`.`,
      // @todo could accept `0xcafe`, `0b01010` or `(deadbeef)_16` as string formats
      // @todo could accept "roman"... as base
      // @todo could accept optional third parameter as the (padded) length of the output

      signature: '(string | character, (string|character|integer)?) -> integer',
      examples: ['DigitsFrom("ff", 16)', 'DigitsFrom("1010", 2)'],

      evaluate: (ops, { engine }) => {
        let op1str = textOf(ops[0]);
        const ce = engine;
        if (!op1str) return ce.typeError('string', ops[0]?.type, ops[0]);

        op1str = op1str.trim();

        if (op1str.startsWith('0x'))
          return ce.number(parseInt(op1str.slice(2), 16));

        if (op1str.startsWith('0b'))
          return ce.number(parseInt(op1str.slice(2), 2));

        const op2 = ops[1] ?? ce.Nothing;
        if (sym(op2) === 'Nothing')
          return ce.number(Number.parseInt(op1str, 10));

        // The declared signature admits the base as an INTEGER
        // (`DigitsFrom("101", 2)`) or as a numeric STRING
        // (`DigitsFrom("101", "2")`), so both are resolved to a number here
        // before the range check. Reading them separately is what made the
        // operand a no-op: the range check read `op2.re` (fine for an integer,
        // `NaN` for a string, hence `unexpected-base NaN`) while `fromDigits`
        // was handed `op2.string ?? sym(op2) ?? 10`, which is `10` for an
        // integer operand — so `DigitsFrom("101", 2)` parsed "101" in base TEN
        // and answered 101 instead of 5.
        const baseText = textOf(op2);
        const base =
          baseText !== undefined
            ? baseFromString(baseText)
            : (asSmallInteger(op2) ?? NaN);
        if (!Number.isInteger(base) || base < 2 || base > 36) {
          // An operand that resolves to no number at all (a free symbol) is
          // reported as written, since `NaN` names nothing the reader gave.
          const shown = Number.isNaN(base) ? op2.toString() : `${base}`;
          return ce.error(['unexpected-base', shown], op2.toString());
        }

        const [value, rest] = fromDigits(op1str, base);

        if (rest) return ce.error(['unexpected-digit', rest[0]], rest);

        return ce.number(value);
      },
    },

    // Parse a string as a number, following the house `XFrom` conversion
    // convention (`DigitsFrom`, `CharacterFrom`, …). `DigitsFrom` is
    // integer-only; this is the general one.
    //
    // The accepted grammar is fixed by `docs/STRING_ROADMAP.md`
    // ("Conversions") so implementations cannot drift: optional leading and
    // trailing Unicode White_Space, an optional sign, then either a decimal
    // numeral (ASCII digits with an optional `.` fraction and an optional
    // `e`/`E` exponent; the integer part may be omitted when a fraction is
    // present, so `".5"` reads as 0.5, but a trailing dot with no fraction
    // digits — `"5."` — is a reject; see `NUMBER_FROM_DECIMAL`) or one of the
    // exact spellings `oo`, `+oo`, `-oo`, `NaN`, `Indeterminate`. Anything else, INCLUDING the empty
    // string, is an ERROR value and never NaN: `NaN` is a legitimate parse
    // RESULT for the literal `"NaN"`, so it cannot double as the failure
    // signal. `"1/3"` is not accepted (use `DigitsFrom` or arithmetic).
    //
    // Exactness follows the engine's evaluate/N contract. A numeral is boxed
    // through the MathJSON number-string route (`{ num: … }`) — the same
    // route the LaTeX parser's numbers take — so `NumberFrom(t)` and the
    // literal `t` are the identical value: an integer numeral becomes an
    // exact integer of arbitrary size, and a fractional or exponent numeral
    // becomes a decimal that keeps every digit the engine's precision can
    // hold. Never `parseFloat`, which accepts a numeric PREFIX and would read
    // `"12abc"` as 12.
    NumberFrom: {
      description: [
        'NumberFrom(s): the number the string `s` denotes — optional ' +
          'surrounding whitespace, an optional sign, then ASCII digits with ' +
          'an optional "." fraction and an optional e/E exponent, or one of ' +
          '"oo", "+oo", "-oo", "NaN", "Indeterminate". The integer part may ' +
          'be omitted before ' +
          'a fraction (".5" is 0.5); a trailing "." with no fraction digits ' +
          '("5.") is not accepted. Any other text, including "", is an ' +
          'error value (never NaN).',
        'NumberFrom(s, base): the integer `s` denotes in `base` (2 to 36); ' +
          'only integer numerals are accepted.',
      ],
      signature:
        '(string | character, base: (string|character|integer)?) -> number',
      examples: ['NumberFrom("3.25")', 'NumberFrom("ff", 16)'],
      evaluate: ([s, baseArg], { engine: ce }) => {
        const source = textOf(s);
        if (source === undefined) return undefined;
        const invalid = (): Expression =>
          ce.error(['invalid-number', source], s.toString());

        // Unicode White_Space is allowed around the numeral, but nowhere
        // inside it — hence anchored trimming with the shared set rather than
        // `String.trim()`, whose notion of whitespace is the host's.
        const text = trimClusters(source, null, true, true);

        // Base other than 10: integer numerals only, `DigitsFrom` semantics.
        if (baseArg !== undefined && sym(baseArg) !== 'Nothing') {
          const baseText = textOf(baseArg);
          const base =
            baseText !== undefined
              ? baseFromString(baseText)
              : (asSmallInteger(baseArg) ?? NaN);
          if (!Number.isInteger(base) || base < 2 || base > 36) {
            // An operand that resolves to no number at all (a free symbol) is
            // reported as written, since `NaN` names nothing the reader gave.
            const shown = Number.isNaN(base) ? baseArg.toString() : `${base}`;
            return ce.error(['unexpected-base', shown], baseArg.toString());
          }
          if (!NUMBER_FROM_BASE_INTEGER.test(text)) return invalid();
          const [, rest] = fromDigits(text, base);
          // `fromDigits` reports the unconsumed tail; the same code
          // `DigitsFrom` uses names the offending digit.
          if (rest) return ce.error(['unexpected-digit', rest[0]], rest);
          // The VALUE `fromDigits` returns is discarded: it accumulates in a
          // float (`value = value * base + k`), so a numeral longer than 53
          // bits comes back rounded, which contradicts the exactness this
          // operator documents. An empty tail proves every character is a
          // digit of `base`, so the numeral is re-read here as a BigInt.
          // `parseInt(c, 36)` is the digit value of a single already-validated
          // character. (`fromDigits` itself is left alone — `DigitsFrom` keeps
          // its `-> integer` machine-number behavior.)
          const negative = text.startsWith('-');
          const digits = /^[+-]/.test(text) ? text.slice(1) : text;
          const radix = BigInt(base);
          let magnitude = 0n;
          for (const c of digits)
            magnitude = magnitude * radix + BigInt(Number.parseInt(c, 36));
          return ce.number(negative ? -magnitude : magnitude);
        }

        if (text === 'NaN') return ce.NaN;
        // The spelling `String(Indeterminate)` produces reads back as the
        // `Indeterminate` value, as `"NaN"` reads back as `NaN`.
        if (text === 'Indeterminate') return ce.Indeterminate;
        if (text === 'oo' || text === '+oo') return ce.PositiveInfinity;
        if (text === '-oo') return ce.NegativeInfinity;

        if (!NUMBER_FROM_DECIMAL.test(text)) return invalid();
        return ce.box({ num: text });
      },
    },

    IntegerString: {
      description: `\`IntegerString(n, base=10)\` \
      return a string representation of the integer \`n\` in base \`base\`.`,
      // @todo could accept `0xcafe`, `0b01010` or `(deadbeef)_16` as string formats
      // @todo could accept "roman"... as base
      // @todo could accept optional third parameter as the (padded) length of the output
      broadcastable: true,
      signature: '(integer, integer?) -> string',
      examples: ['IntegerString(255, 16)', 'IntegerString(10, 2)'],
      evaluate: (ops, { engine }) => {
        const ce = engine;
        const op1 = ops[0];
        if (!op1.isInteger) return ce.typeError('integer', op1.type, op1);

        const val = op1.re;
        if (!Number.isFinite(val))
          return ce.typeError('integer', op1.type, op1);

        // The sign is preserved (`IntegerString(-42)` is `"-42"`), so
        // `DigitsFrom(IntegerString(n))` round-trips for negative integers.
        const op2 = ops[1] ?? ce.Nothing;
        if (sym(op2) === 'Nothing') {
          if (op1.bignumRe !== undefined)
            return ce.string(op1.bignumRe.toString());
          return ce.string(val.toString());
        }

        const base = asSmallInteger(op2);
        if (base === null) return ce.typeError('integer', op2.type, op2);

        if (base < 2 || base > 36)
          return ce.error(
            ['out-of-range', '2', '36', base.toString()],
            op2.toString()
          );

        return ce.string(val.toString(base));
      },
    },
  },
  {
    RandomExpression: {
      description: 'Generate a random expression.',
      // Nondeterministic, like the rest of the random family: without this,
      // `isPure` — and therefore `isConstant` — is true for a generator that
      // returns something different on every call, making it a candidate for
      // common-subexpression elimination and for the `Map` lowering gate.
      // The label is `entropy`, NOT `random`: it samples the host's unseeded
      // source (the `entropy` handler of the capability registry) rather than
      // the `WithRandomSeed` frame, so it owes that frame nothing and nothing
      // promises it replays (the three-shapes taxonomy of
      // `docs/EFFECTS-MODEL.md`). `entropy` is an impurity, so `pure` is still
      // false, but `drawsRandom` is false and the frame is never pinned.
      signature: '() entropy -> expression',
      examples: ['RandomExpression()'],
      evaluate: (_ops, { engine, effects }) => {
        const entropy = effects.entropy;
        if (entropy === null) return capabilityDenied(engine, 'entropy');
        return engine.expr(randomExpression(() => entropy.random()));
      },
    },
  },

  // ---------------------------------------------------------------------------
  // Host console I/O — `Print` and `Input`. Epsil writes them `print` and
  // `input`, like every library name with a lowercase spelling; that spelling
  // is a property of the Epsil language (`src/epsil/library-names.ts`),
  // resolved before a program is boxed, and the engine has no binding for it.
  // Both carry the `console` effect label, and both reach the host only
  // through the `console` handler of the capability registry (`ce.effects`,
  // `docs/EFFECTS-MODEL.md`, "Host capabilities") — read from
  // `options.effects`, the registry this evaluation captured when it started.
  // A host replaces the handler to redirect the output or supply the input,
  // and sets it to `null` to deny console access: both operators then evaluate
  // to an `Error("capability-denied", "console")` value. The default handler
  // (`effects-registry.ts`) is the real console and the real terminal.
  // ---------------------------------------------------------------------------
  {
    Print: {
      description:
        'Print the operands to the host console, separated by spaces and ' +
        'followed by a newline. String operands print their content ' +
        '(without quotes); other expressions print their text form. ' +
        'Evaluates to `Nothing`. On a host without a console, prints ' +
        'nothing. When the host denies console access, evaluates to a ' +
        '`capability-denied` error.',
      signature: '(any*) console -> nothing',
      examples: ['Print("Hello", 42)'],
      evaluate: (ops, { engine: ce, effects }) => {
        const console_ = effects.console;
        if (console_ === null) return capabilityDenied(ce, 'console');
        console_.log(
          ops
            .map((op) =>
              isString(op) || isCharacter(op) ? op.string : op.toString()
            )
            .join(' ')
        );
        return ce.Nothing;
      },
    },

    Input: {
      description:
        'Read one line of text from the host: the terminal in a ' +
        'command-line host, the `prompt()` dialog in a browser. The ' +
        'optional operand is a prompt string, displayed before reading. ' +
        'Evaluates to the line read, without the trailing newline; to ' +
        '`Nothing` at end-of-input (or a canceled dialog). On a host with ' +
        'no interactive input, stays unevaluated. When the host denies ' +
        'console access, evaluates to a `capability-denied` error.',
      signature: '(prompt: string?) console -> string | nothing',
      evaluate: (ops, { engine: ce, effects }) => {
        const console_ = effects.console;
        if (console_ === null) return capabilityDenied(ce, 'console');
        const promptOp = ops[0];
        const line = console_.readLine(
          isString(promptOp) ? promptOp.string : undefined
        );
        if (line === undefined) return undefined;
        if (line === null) return ce.Nothing;
        return ce.string(line);
      },
    },
  },

  // ---------------------------------------------------------------------------
  // Opaque typed heads — registered so the names are in the standard set
  // (consumers can branch on the operator name); CE itself does not evaluate
  // them. Geometric primitives `Triangle`/`Sphere`/`Segment` and the action
  // arrow `To` (`a \to b`).
  // ---------------------------------------------------------------------------
  {
    Triangle: {
      description: 'Triangle primitive — opaque typed head.',
      signature: '(any+) -> expression',
      examples: ['Triangle(A, B, C)'],
    },
    GeometricVector: {
      description:
        'Geometric vector (directed segment between two points) — opaque typed head. Distinct from the column-vector `Vector` operator.',
      signature: '(any, any) -> expression',
      examples: ['GeometricVector(A, B)'],
    },
    Sphere: {
      description: 'Sphere primitive — opaque typed head.',
      signature: '(any+) -> expression',
      examples: ['Sphere(O, r)'],
    },
    Segment: {
      description: 'Segment primitive — opaque typed head.',
      signature: '(any+) -> expression',
      examples: ['Segment(A, B)'],
    },
    Polygon: {
      description: 'Polygon primitive — opaque typed head.',
      signature: '(any+) -> expression',
      examples: ['Polygon(A, B, C, D)'],
    },

    // Euclidean-geometry notation, transcribed as inert heads (no evaluator);
    // consumers use the structural parse to render figures. See
    // `latex-syntax/dictionary/definitions-other.ts`.
    Angle: {
      // Return type `number`: an angle is a measure, so it composes in
      // arithmetic and comparisons (`\angle ABC + \angle APC = 180^\circ`).
      description:
        'Angle mark / measure (`\\angle ABC`, `\\varangle XYZ`, `∠ABC`) — opaque typed head; not evaluated.',
      signature: '(any+) -> number',
      examples: ['Angle(A, B, C)'],
    },
    IndexedSequence: {
      // Scripted-brace sequence notation `\{a_n\}_{n=1}^{\infty}`:
      // `IndexedSequence(term, index, lower, upper?)`. Inert for now: it is
      // held (not evaluated) and stays symbolic — the `term` operand carries
      // the index in call form (`["a_", "n"]`) so the binding survives symbol
      // fusion. Typed `-> expression` rather than `collection`: it has no
      // collection handlers yet, so claiming `collection` would be dishonest.
      // `lazy` keeps the held term from being evaluated/canonicalized.
      description:
        'Indexed sequence `\\{a_n\\}_{n=1}^{\\infty}` — inert head `IndexedSequence(term, index, lower, upper?)`; not evaluated.',
      lazy: true,
      signature: '(any, symbol, any, any?) -> expression',
      examples: ['IndexedSequence(1/n, n, 1, oo)'],
    },
    Quadrilateral: {
      description:
        'Quadrilateral mark (`\\square ABCD`) — opaque typed head; not evaluated.',
      signature: '(any+) -> expression',
      examples: ['Quadrilateral(A, B, C, D)'],
    },
    Perpendicular: {
      description:
        'Perpendicularity relation (`AB \\perp CD`) — opaque typed head; not evaluated.',
      signature: '(any, any) -> expression',
      examples: ['Perpendicular(l, m)'],
    },
    Parallel: {
      description:
        'Parallelism relation (`AB \\parallel CD`) — opaque typed head; not evaluated.',
      signature: '(any, any) -> expression',
      examples: ['Parallel(l, m)'],
    },
    Arc: {
      // Return type `number`: an arc measure composes in arithmetic
      // (`\widehat{ABC} - \widehat{ATD} = \widehat{DAC}`).
      description:
        'Arc / wide-hat accent measure (`\\widehat{ABC}`) — opaque typed head; not evaluated.',
      signature: '(any+) -> number',
      examples: ['Arc(A, B, C)'],
    },
    OverParen: {
      description:
        'Over-paren accent (`\\overparen{BC}`) — opaque typed head; not evaluated.',
      signature: '(any+) -> expression',
      examples: ['OverParen(B, C)'],
    },
    To: {
      description: 'Action arrow / mapping (`a \\to b`) — opaque typed head.',
      signature: '(any, any) -> nothing',
      examples: ['ReplaceAll(x^2 + x, To(x, 3))'],
    },
    Colon: {
      description: 'Type annotation (`a : b`) — opaque typed head.',
      signature: '(any, any) -> expression',
    },
    Prime: {
      description:
        "Derivative or prime notation (`f'`, `f^{(n)}`) — opaque typed head until a derivative library handler runs.",
      // A primed entity denotes something of the same kind as its base:
      // `a'` on a number-valued symbol is another value (so `\sin a'`
      // type-checks), `f'` on a function is a function. Mirror the type.
      signature: '(T, integer?) -> T where T',
      examples: ['Prime(f)'],
    },
  },
];

/**
 * Make the exact number literals in a result of `N` inexact.
 *
 * `N` asks for a numeric approximation, thus a number that it returns is a
 * float, also when the value is an integer: `N(2)` is the float `2.0`, not
 * the exact integer `2`. Thus exact arithmetic does not use the value as
 * exact later: `N(2)/3` is `0.666…`, not `2/3`. Only the evaluate handler of
 * the `N` operator calls this function: the `.N()` method of a number literal
 * keeps an integer exact (`ce.box(6).N()` is the exact `6`).
 *
 * The elements of a `List` or `Tuple` result are made inexact in the same
 * way, also in nested lists and tuples.
 *
 * These results stay as they are:
 * - An infinity: it is an exact value and it has no different float form.
 * - A symbolic result, such as `x + 1`: the exact constants in it stay exact.
 *   (A float constant in a symbolic result, such as `x + 1.0`, is a larger
 *   change to canonicalization and arithmetic.)
 * - Any other result, such as a string or a boolean.
 *
 * A lazy indexed collection (`Range(1, 4)`, a lazy `Map`) is not walked: its
 * elements are computed when they are read, and the collection can be
 * infinite. The result is a lazy collection whose elements are computed by
 * `N` (`N(_1)`, or `N(_1, digits)` when `digits` is given) when they are
 * read (`lazyInexactElements()`): `N(Range(1, 4))/3` is
 * `[0.333…, 0.666…, 1.0, 1.333…]`, not a list of exact thirds. The body is
 * the `N` operator, not the internal marker `NumericApproximation` of the
 * `.N()` method, because the marker keeps an integer exact. `digits` is a
 * number of significant digits, or a goal `[p, a]` (`evaluateToGoal()`). A
 * lazy collection that is not indexed (a lazy set) is returned as it is.
 *
 * When `source` is given, it is the operand of `N` whose numeric value is
 * `value`. When `source` is a lazy indexed collection, the elements are
 * read from `source`, not from `value`: the elements of `source` are
 * computed with the precision of each read, also the constants in the
 * function of a lazy `Map` (`Map(x ↦ x·Sin(1.5), …)`), which `value` has as
 * floats of the first working precision of `N(x, [p, a])`.
 *
 * The float follows the working precision of the engine when this function
 * is called: a big decimal above machine precision, else a machine float.
 */
function inexactResult(
  ce: ComputeEngine,
  value: Expression,
  digits?: number | Expression,
  source?: Expression
): Expression {
  if (isNumber(value)) {
    if (!value.isExact || value.isFinite !== true) return value;
    const re = value.bignumRe ?? value.re;
    const im = value.im;
    return ce.number(
      ce._inexactNumericValue(im === 0 ? re : { re: value.re, im })
    );
  }
  if (isFunction(value, 'List') || isFunction(value, 'Tuple')) {
    // The operand that matches each element, when the operand is a list or
    // a tuple of the same length.
    const sources =
      source !== undefined &&
      isFunction(source) &&
      source.operator === value.operator &&
      source.nops === value.nops
        ? source.ops
        : undefined;
    let changed = false;
    const ops = value.ops.map((op, i) => {
      const result = inexactResult(ce, op, digits, sources?.[i]);
      if (result !== op) changed = true;
      return result;
    });
    return changed ? ce.function(value.operator, ops) : value;
  }
  if (value.isLazyCollection && value.isIndexedCollection)
    return lazyInexactElements(
      ce,
      source?.isLazyCollection && source.isIndexedCollection ? source : value,
      smallCount(value),
      digits
    );
  return value;
}

/**
 * The lazy collection of the elements of the lazy indexed collection `xs`,
 * each one computed by `N`: `Map(i ↦ N(e(i), digits), Range(1, n))`,
 * where `n` is `count`, the number of elements of `xs` (`+∞` for an
 * infinite collection), and `e(i)` is the element at `i` (`elementOf()`).
 *
 * `e(i)` is an operand of `N`, which is lazy: thus `N` computes the
 * element, with its own precision. The function of a lazy `Map`, and the
 * elements of any other lazy collection (`Reverse(Map(f, ys))`), are
 * computed with the digits of `N`, also when `N(x, p)` raised the precision
 * for `p` and restored it before the element is read. Each element is read
 * by its index, and `At` reads one element of a `Map` or of a `Range`
 * without the elements before it.
 *
 * When `xs` is a `Map` (also of `Map`s) whose sources are ranges with exact
 * bounds or lists of number literals, the elements of the sources do not
 * depend on the precision. The result is then `Map(_1 ↦ N(f(_1), digits),
 * ys)` for `xs = Map(f, ys)`: the sources are read directly, which is
 * faster than `At`.
 *
 * The parts of `xs` are put in the result as they are. They are not changed
 * to MathJSON and boxed again: the function of a `Map` can read a variable
 * of another scope (`Block(c := 5, Map(x ↦ x/c, …))`), and a function that
 * is boxed again in the current scope does not read that variable.
 *
 * When `count` is not known, the result is `Map(_1 ↦ N(_1, digits), xs)`:
 * the elements are computed with the precision in force when they are
 * read, and `N` rounds them.
 */
function lazyInexactElements(
  ce: ComputeEngine,
  xs: Expression,
  count: number | undefined,
  digits: number | Expression | undefined
): Expression {
  const goal =
    digits === undefined
      ? []
      : [typeof digits === 'number' ? ce.number(digits) : digits];
  // The parameters of the function are not symbols of `xs`, so that the
  // function does not bind a symbol that `xs` reads.
  const symbols = new Set(xs.symbols);
  let k = 0;
  const newParam = (): Expression => {
    do k += 1;
    while (symbols.has(`_${k}`));
    return ce.symbol(`_${k}`, { canonical: false });
  };
  // The body is not canonical: `ce.function('Function', …)` canonicalizes
  // it in the scope of the function, where the parameters are bound. The
  // parts of `xs` are canonical, and they are kept as they are.
  const map = (
    element: Expression,
    params: Expression[],
    sources: Expression[]
  ): Expression =>
    ce.function('Map', [
      ce.function('Function', [
        ce._fn('N', [element, ...goal], { canonical: false }),
        ...params,
      ]),
      ...sources,
    ]);

  if (count === undefined) {
    const param = newParam();
    return map(param, [param], [xs]);
  }

  const sources: Expression[] = [];
  if (sourcesOf(xs, sources).every(isFixedSource)) {
    const params: Expression[] = [];
    const element = elementOf(ce, xs, () => {
      const param = newParam();
      params.push(param);
      return param;
    });
    return map(element, params, sources);
  }

  const index = newParam();
  const element = elementOf(ce, xs, (ys) =>
    ce._fn('At', [ys, index], { canonical: false })
  );
  return map(
    element,
    [index],
    [
      ce.function('Range', [
        ce.One,
        count === Infinity ? ce.PositiveInfinity : ce.number(count),
      ]),
    ]
  );
}

/**
 * The element of the lazy indexed collection `xs`, as an expression that is
 * not canonical. When `xs` is `Map(f, ys₁, …, ysₖ)`, the element is
 * `Apply(f, e₁, …, eₖ)`, where `eᵢ` is the element of `ysᵢ` (also a `Map`).
 * The element of any other collection `ys` (a source) is `source(ys)`.
 *
 * The function `f` is applied in the body of `N`, and not read through
 * `At(Map(f, ys), i)`: the `.N()` method of a lazy `Map` makes its function
 * again from MathJSON, and a function made again does not read the
 * variables of the scope of `f`.
 *
 * A parameter type that inference wrote (`isInferredTypedParameter()`) is
 * removed from `f`: it is the type of the exact elements of the source
 * (`rational` for `Map(x ↦ x/2, Range(1, 3))`), and `N` applies `f` to a
 * float. The body of `f` is kept as it is, with its scope.
 */
function elementOf(
  ce: ComputeEngine,
  xs: Expression,
  source: (ys: Expression) => Expression
): Expression {
  if (isFunction(xs, 'Map') && xs.nops >= 2) {
    const fn = xs.op1;
    if (isSymbol(fn) || isFunction(fn, 'Function')) {
      const applied =
        isFunction(fn) && fn.ops.slice(1).some(isInferredTypedParameter)
          ? ce._fn('Function', [
              fn.op1,
              ...fn.ops
                .slice(1)
                .map((p) =>
                  isFunction(p) && isInferredTypedParameter(p) ? p.op1 : p
                ),
            ])
          : fn;
      return ce._fn(
        'Apply',
        [applied, ...xs.ops.slice(1).map((ys) => elementOf(ce, ys, source))],
        { canonical: false }
      );
    }
  }
  return source(xs);
}

/** Add to `sources` the sources of `xs` (see `elementOf()`), in the order of
 * `elementOf()`, and return `sources`. */
function sourcesOf(xs: Expression, sources: Expression[]): Expression[] {
  if (isFunction(xs, 'Map') && xs.nops >= 2) {
    const fn = xs.op1;
    if (isSymbol(fn) || isFunction(fn, 'Function')) {
      for (const ys of xs.ops.slice(1)) sourcesOf(ys, sources);
      return sources;
    }
  }
  sources.push(xs);
  return sources;
}

/** True when the elements of the collection `xs` do not depend on the
 * precision: a `Range` with exact bounds, or a `List` of number literals. */
function isFixedSource(xs: Expression): boolean {
  if (isFunction(xs, 'Range'))
    return xs.ops.every((op) => isNumber(op) && op.isExact);
  return isFunction(xs, 'List') && xs.ops.every((op) => isNumber(op));
}

/** A function that calls `fn` the first time only, and then gives the
 * value of that call. */
function once<T>(fn: () => T): () => T {
  let done = false;
  let value: T;
  return () => {
    if (!done) {
      value = fn();
      done = true;
    }
    return value;
  };
}

/**
 * The number of significant digits of the number literal `value`: the
 * larger number of the two parts of a complex value, without the trailing
 * zeros of the significand.
 */
function significantDigits(value: Expression): number {
  const ce = value.engine;
  const count = (v: BigNum): number => {
    if (v.isZero()) return 0;
    const significand = v.significand < 0n ? -v.significand : v.significand;
    return significand.toString().replace(/0+$/, '').length;
  };
  return Math.max(
    count(value.bignumRe ?? ce.bignum(value.re)),
    count(value.bignumIm ?? ce.bignum(value.im))
  );
}

/** True when the number literals `a` and `b` have the same value: the same
 * big decimal real part and the same big decimal imaginary part. */
function sameParts(a: Expression, b: Expression): boolean {
  const ce = a.engine;
  return (
    (a.bignumRe ?? ce.bignum(a.re)).eq(b.bignumRe ?? ce.bignum(b.re)) &&
    (a.bignumIm ?? ce.bignum(a.im)).eq(b.bignumIm ?? ce.bignum(b.im))
  );
}

/**
 * A new float with the value of the number literal `value`, displayed with
 * at least `digits` significant digits (`setDisplayDigits()`). The float is
 * always a new value: a value is immutable, and the digits of a shared
 * value would change the display of every expression that holds it. Call it
 * at a precision above machine precision, so that the float is a big
 * decimal (a machine float has no display digits).
 */
function withDisplayDigits(value: Expression, digits: number): Expression {
  const ce = value.engine;
  const re = value.bignumRe ?? ce.bignum(value.re);
  const im = value.bignumIm ?? ce.bignum(value.im);
  const result = ce._inexactNumericValue(im.isZero() ? re : { re, im });
  setDisplayDigits(result, digits);
  return ce.number(result);
}

/**
 * The value of `N(x, p)` (`value`, rounded to `p = digits` digits), with the
 * floats that `N` computed displayed with their `p` digits
 * (`withDisplayDigits()`). `p` is more than `precision`, the precision of
 * the engine. The function walks into lists, tuples and symbolic results
 * (`x + 3.14159…`), but not into a function literal, a `Hold`, or an
 * operator that binds a variable (`Sum`). A float in a symbolic result is
 * rounded to `p` digits.
 *
 * A float that does not depend on the precision is not given display
 * digits: its digits past the precision of the engine are not correct
 * digits of the value. This is a float of the operand (`N(x + 0.1, 50)`), a
 * stored float that was computed at a lower precision, or the value of a
 * kernel that computes with machine floats. Such a float is found when the
 * float of `reference` (the value of `x` at the precision of the engine) at
 * the same place has the same value after the same rounding. But the float
 * is given display digits when the exact value of `x` (`exact`, at the same
 * place) is an exact number: an exact value with a short decimal form
 * (`2^−80`) also has the same value at two precisions. The float of a
 * nested `N(y, q)` keeps its `q` display digits (at most `p`): it has the
 * same value at two precisions, and `q` correct digits.
 *
 * `reference` and `exact` are computed only when a float has more than
 * `precision` digits: a float with fewer digits is displayed with all its
 * digits. `reference` receives the number of significant digits of the
 * float, and it can return `undefined` when a float with that number of
 * digits does not need the comparison: the float is then displayed with
 * `digits` digits.
 */
function showComputedDigits(
  value: Expression,
  digits: number,
  precision: number,
  reference: (shown: number) => Expression | undefined,
  exact: (shown: number) => Expression | undefined
): Expression {
  const ce = value.engine;
  if (isNumber(value)) {
    if (value.isExact || value.isFinite !== true) return value;
    const rounded = roundToSignificantDigits(value, digits);
    if (!isNumber(rounded)) return value;
    const shown = significantDigits(rounded);
    if (shown <= precision) return sameParts(rounded, value) ? value : rounded;
    const ref = reference(shown);
    if (
      ref !== undefined &&
      isNumber(ref) &&
      ref.isFinite === true &&
      sameParts(rounded, roundToSignificantDigits(ref, digits))
    ) {
      // The float of a nested `N(y, q)` has the same value at each
      // precision, and it has `q` correct digits: its display digits.
      const v = ref.numericValue;
      const known = typeof v === 'number' ? undefined : displayDigits(v);
      if (known !== undefined && known > precision)
        return withDisplayDigits(rounded, Math.min(known, digits));
      const e = exact(shown);
      if (e === undefined || !isNumber(e) || !e.isExact) return rounded;
    }
    return withDisplayDigits(rounded, digits);
  }
  if (!isFunction(value) || isRoundingBoundary(value)) return value;
  // The operand of `reference` or of `exact` at the same place, when it has
  // the same operator and the same number of operands as `value`.
  const at =
    (whole: (shown: number) => Expression | undefined, i: number) =>
    (shown: number): Expression | undefined => {
      const r = whole(shown);
      return r !== undefined &&
        isFunction(r) &&
        r.operator === value.operator &&
        r.nops === value.nops
        ? r.ops[i]
        : undefined;
    };
  let changed = false;
  const ops = value.ops.map((op, i) => {
    const result = showComputedDigits(
      op,
      digits,
      precision,
      at(reference, i),
      at(exact, i)
    );
    if (result !== op) changed = true;
    return result;
  });
  if (!changed) return value;
  const operator = value.operator;
  return operator === 'List' || operator === 'Tuple'
    ? ce.function(operator, ops)
    : ce._fn(operator, ops);
}

/**
 * `value` with each float that has no display digits above the precision
 * of the engine made again as a float of the engine: a machine float at
 * machine precision. A float computed at a precision raised by
 * `_withTransientPrecision()` is a big decimal, also when it has no more
 * digits than the precision of the engine. The function walks into lists,
 * tuples and symbolic results (`x + 3.14159…`), as `showComputedDigits()`
 * does. Call it after the precision is restored.
 */
function followEnginePrecision(
  ce: ComputeEngine,
  value: Expression
): Expression {
  if (ce.precision > MACHINE_PRECISION) return value;
  if (isNumber(value)) {
    if (value.isExact || value.isFinite !== true) return value;
    if (value.bignumRe === undefined && value.bignumIm === undefined)
      return value;
    const v = value.numericValue;
    if (typeof v !== 'number' && (displayDigits(v) ?? 0) > ce.precision)
      return value;
    // A big decimal outside the range of a machine float is kept: as a
    // machine float, it is an infinity (`e^1000`, whose `re` is `Infinity`)
    // or `0` (`e^−1000`, whose `re` is `0`).
    const outOfRange = (part: number, big: BigNum | undefined): boolean =>
      !Number.isFinite(part) ||
      (part === 0 && big !== undefined && !big.isZero());
    if (
      outOfRange(value.re, value.bignumRe) ||
      outOfRange(value.im, value.bignumIm)
    )
      return value;
    return ce.number(
      ce._inexactNumericValue(
        value.im === 0 ? value.re : { re: value.re, im: value.im }
      )
    );
  }
  if (!isFunction(value) || isRoundingBoundary(value)) return value;
  let changed = false;
  const ops = value.ops.map((op) => {
    const result = followEnginePrecision(ce, op);
    if (result !== op) changed = true;
    return result;
  });
  if (!changed) return value;
  const operator = value.operator;
  return operator === 'List' || operator === 'Tuple'
    ? ce.function(operator, ops)
    : ce._fn(operator, ops);
}

/**
 * True when the floats in `value` are not changed by `N`: `value` is a
 * function literal, a `Hold`, an operator that binds a variable (`Sum`), or
 * a lazy collection. The floats of a function body or of a held expression
 * are computed when the function is applied or when the expression is
 * released, and the elements of a lazy collection when they are read.
 */
function isRoundingBoundary(value: Expression): boolean {
  return (
    value.operator === 'Function' ||
    value.operator === 'Hold' ||
    value.operatorDefinition?.scoped === true ||
    (value.isLazyCollection === true &&
      value.operator !== 'List' &&
      value.operator !== 'Tuple')
  );
}

/** The largest number of significant digits of a machine float. */
const MACHINE_FLOAT_DIGITS = 17;

/**
 * True when `expr` can read a float that was computed before the
 * evaluation, and that thus does not depend on the precision of the
 * evaluation: a float literal, a symbol that is not a symbol of the
 * library and that has a value, or a function that is not a function of
 * the library (its body can contain a float literal).
 */
function mayReadFixedFloat(expr: Expression): boolean {
  const ce = expr.engine;
  const library = ce.contextStack[0]?.lexicalScope;
  const isUserName = (name: string): boolean => {
    const def = ce.lookupDefinition(name);
    return def !== undefined && library?.bindings.get(name) !== def;
  };
  const visit = (e: Expression): boolean => {
    if (isNumber(e)) return !e.isExact;
    if (isSymbol(e))
      return (
        isUserName(e.symbol) &&
        (e.value !== undefined || e.operatorDefinition !== undefined)
      );
    if (!isFunction(e)) return false;
    if (isUserName(e.operator)) return true;
    return e.ops.some(visit);
  };
  return visit(expr);
}

/**
 * Round a numeric result to `p` significant digits at the *value* level, so
 * the returned number genuinely carries `p` digits (independent of whatever
 * precision a downstream consumer serializes at). Used by `N(expr, p)` when
 * the requested precision is at or below the engine's working precision.
 *
 * Each element of a `List` or `Tuple` result is rounded in the same way, also
 * in nested lists and tuples: `N([1/3, Pi], 4)` is `[0.3333, 3.142]`. Each
 * float of a symbolic result is rounded too: `N(x + Pi, 5)` is
 * `x + 3.1416`. An exact number in a symbolic result stays exact. The
 * function does not walk into a function literal, a `Hold`, an operator
 * that binds a variable, or a lazy collection (`isRoundingBoundary()`).
 * Other results (strings, booleans) are returned unchanged.
 */
function roundToSignificantDigits(value: Expression, p: number): Expression {
  const ce = value.engine;
  if (isFunction(value, 'List') || isFunction(value, 'Tuple')) {
    let changed = false;
    const ops = value.ops.map((op) => {
      const result = roundToSignificantDigits(op, p);
      if (result !== op) changed = true;
      return result;
    });
    return changed ? ce.function(value.operator, ops) : value;
  }
  // The floats of a function are rounded, and the function is kept. This is
  // also true for a function that has a numeric value, such as
  // `Measurement(v, δ)`, whose `re` is `v`: its value is rounded and it
  // keeps its uncertainty.
  if (isFunction(value)) {
    if (isRoundingBoundary(value)) return value;
    let changed = false;
    const ops = value.ops.map((op) => {
      if (isNumber(op) && op.isExact) return op;
      const result = roundToSignificantDigits(op, p);
      // A float with no more than `p` digits is kept as it is: a machine
      // float stays a machine float.
      if (isNumber(op) && isNumber(result) && sameParts(op, result)) return op;
      if (result !== op) changed = true;
      return result;
    });
    return changed ? ce._fn(value.operator, ops) : value;
  }
  const re = value.re;
  const im = value.im;
  // Only round concrete finite numbers; leave symbolic results / non-numbers
  // (where `re`/`im` are `NaN`) and infinities unchanged. A number literal is
  // finite when its big decimal parts are: a part can overflow a machine
  // float (`1.2e400`, whose `re` is `Infinity`) or underflow it (`1.2e-400`,
  // whose `re` is `0`).
  if (
    isNumber(value)
      ? value.isFinite !== true
      : !Number.isFinite(re) || !Number.isFinite(im)
  )
    return value;

  // `ce.bignum(re)` covers the machine-float case where there is no
  // `bignumRe`.
  const bigRe = value.bignumRe ?? ce.bignum(re);
  const bigIm = value.bignumIm ?? ce.bignum(im);

  // Complex: round each part as a big decimal. A part rounded as a machine
  // float had at most 17 correct digits, also with `p` above that.
  if (!bigIm.isZero()) {
    // The rounded value is a float, even when both its parts are integers
    return ce.number(
      ce._inexactNumericValue({
        re: bigRe.toPrecision(p),
        im: bigIm.toPrecision(p),
      })
    );
  }

  // Real: round the bignum to `p` significant digits (preserving large `p`).
  return boxBignumResult(ce, bigRe.toPrecision(p));
}

/**
 * The number of digits that `N(x, p)` adds to `p` for its working
 * precision: 5, or a tenth of `p` for a large `p`. The error of a numeric
 * evaluation is a few units in the last digit of its precision, and it
 * grows with the number of operations, which tends to grow with the
 * precision (more terms in a series).
 */
function guardDigits(p: number): number {
  return Math.max(5, Math.ceil(p / 10));
}

/**
 * The goals of `N(x, [p, a])`: the precision goal `p` (a number of
 * significant digits) and the accuracy goal `a` (a number of digits after
 * the decimal point). Either one can be `Infinity`, which means that there
 * is no goal of that kind, but not both.
 */
type NumericGoal = { precision: number; accuracy: number };

/**
 * The goals that the list `request` (the second operand of `N`, evaluated)
 * gives, or `undefined` when it is not a valid goal: a list of two real
 * numbers, a precision goal that is `+∞` or a number ≥ 1, an accuracy goal
 * that is `+∞` or a finite number, not both `+∞`. A negative accuracy goal
 * is valid: `a = −2` asks for an error below `100`. A precision goal is
 * truncated to an integer, as the precision of `N(x, p)` is. An accuracy
 * goal is rounded up to an integer, so that the error is below `10^−a`.
 */
function numericGoal(request: Expression): NumericGoal | undefined {
  if (!isFunction(request) || request.nops !== 2) return undefined;
  const [p, a] = request.ops;
  if (!isNumber(p) || !isNumber(a) || p.im !== 0 || a.im !== 0)
    return undefined;
  const precision = p.re;
  const accuracy = a.re;
  if (precision !== Infinity && !(Number.isFinite(precision) && precision >= 1))
    return undefined;
  if (accuracy !== Infinity && !Number.isFinite(accuracy)) return undefined;
  if (precision === Infinity && accuracy === Infinity) return undefined;
  return {
    precision: precision === Infinity ? Infinity : Math.trunc(precision),
    accuracy: accuracy === Infinity ? Infinity : Math.ceil(accuracy),
  };
}

/** The largest working precision of `evaluateToGoal()`, in digits. Past it,
 * `N(x, [p, a])` stays unevaluated. It is the largest precision of
 * `N(x, p)`, and the largest precision at which the trigonometric functions
 * are accurate. */
const GOAL_MAX_PRECISION = 1000;

/** `evaluateToGoal()` takes a number as the rounding noise of `0` when its
 * magnitude is below `10^−(d − ZERO_NOISE_MARGIN)` at the working precision
 * `d`... */
const ZERO_NOISE_MARGIN = 10;

/** ...for this number of successive working precisions. */
const ZERO_NOISE_COUNT = 3;

/** The digits that `evaluateToGoal()` adds to the goal for its first
 * working precision. */
const GOAL_GUARD_DIGITS = 10;

/**
 * The value of `N(x, [p, a])`: a numeric value of `x` with `p` correct
 * significant digits or with an absolute error below `10^−a`, whichever
 * comes first, or `undefined` (the call stays unevaluated) when the
 * working precision would have to be more than `GOAL_MAX_PRECISION` digits.
 *
 * This is the reading of Mathematica's `N[x, {p, a}]`, which "attempts to
 * give a result with precision at most p and accuracy at most a": the
 * evaluation stops when one of the two goals is met, and the result has the
 * smaller number of digits that the two goals give. `N[x, {Infinity, a}]`
 * thus asks for an absolute error below `10^−a`, however many significant
 * digits that takes.
 *
 * The method: `x` is evaluated at a working precision, which is then
 * doubled, until two successive values agree to within the goal with two
 * more digits: `10^−(a+2)` absolute, or `10^−(p+2)` relative to the
 * magnitude of the value. The agreement of two values is an estimate of the
 * error, not a bound: two values with the same wrong digits pass the test.
 * The last value is then rounded to `min(p, a + ⌊log10 |v|⌋ + 1)`
 * significant digits, for each part of a complex value. The last value has
 * guard digits for this rounding (see `guardDigits()`): it was computed at
 * twice the precision of the value before it, which already agreed with it
 * to two digits more than the goal. When the error of an evaluation goes
 * down with the precision, the last value thus has about twice as many
 * correct digits as the goal, less the digits lost to cancellation. A part whose
 * magnitude is below `10^−a` has no digit to keep, and it is `0`: with an
 * accuracy goal, `N(Sin(Pi), [PositiveInfinity, 20])` is `0`.
 *
 * This estimate is not valid for a value that does not change with the
 * working precision: a stored float that was computed at a lower
 * precision, or the value of a kernel that computes with machine floats
 * (`Sum(1/(k^2+1), k=1..∞)`). Two such values have the same digits at two
 * precisions, also the digits that are not correct. Thus, when a number
 * with at least `MACHINE_PRECISION` significant digits has the same value
 * at two successive working precisions, the goal keeps more digits than
 * the number has (at most the precision of the engine: see
 * `isPrecisionIndependent()`), and the exact value of `x` at the same place
 * (`x.evaluate()`) is not an exact number, the goal is not met, and the
 * call stays unevaluated (`isPrecisionIndependent()`). When the goal keeps
 * no more digits than the number has, the number is rounded to the goal:
 * `N(2y, [PositiveInfinity, 5])` for a machine float `y`. A number
 * with fewer digits is exact to its digits: `0.1`, or `1.25` for
 * `Cosh(Ln(2))`. An exact value with a short decimal form, such as `1/2`,
 * also has the same value at two precisions: it is not caught, because
 * its exact value is an exact number.
 *
 * A value that is `0` has approximations that are rounding errors: their
 * magnitude goes down with the working precision `d`, at about `10^−d`, and
 * two of them never agree relative to their magnitude. When a number is
 * below `10^−(d − ZERO_NOISE_MARGIN)` at `ZERO_NOISE_COUNT` successive
 * working precisions, and there is only a precision goal (a relative goal
 * cannot be met by `0`), the call stays unevaluated. With an accuracy goal,
 * the values agree to within `10^−(a+2)` when they are below it, and the
 * result is `0`. A float that is exactly `0` does not meet any goal, also
 * an accuracy goal, unless the exact value of `x` at the same place is the
 * number `0` (`hasInexactZero()`): the terms of a value can cancel at a
 * working precision (`e^(10^−100) − 1` is `0` below about 100 digits, and
 * `10^100·(e^(10^−100) − 1)`, which is about `1`, is then also `0`), and
 * the working precision is raised. The digits that a cancellation loses
 * are not known: when the float is still `0` at `GOAL_MAX_PRECISION`
 * digits, the call stays unevaluated.
 *
 * The first working precision is `min(p, a)` plus `GOAL_GUARD_DIGITS`.
 * When it is `GOAL_MAX_PRECISION` or more, the first value is computed at
 * half of `GOAL_MAX_PRECISION`, so that there are two values to compare.
 *
 * An impure operand (`Random()`) is evaluated one time only, at the first
 * working precision: a second evaluation gives another value. That value is
 * rounded to the goal, as `N(x, p)` does, with no estimate of its error.
 * Its exact value is not computed. An operand is impure also when a value
 * or a function body that it reads is impure (`isTransitivelyPure()`): a
 * symbol `r` whose value is the call `Random()`.
 *
 * Each evaluation is at a precision set with `_withTransientPrecision()`,
 * which restores the precision of the engine after it, also when the
 * evaluation throws. The result is displayed with its digits
 * (`roundToGoal()`). A number with no more digits than the precision of the
 * engine is a float of the kind that the engine makes
 * (`followEnginePrecision()`).
 *
 * Each number in a list or a tuple result has its own number of digits. In
 * a symbolic result, each float is compared with the float at the same
 * place in the previous value, and it is rounded to the goal:
 * `N(x + Pi, [PositiveInfinity, 5])` is `x + 3.14159`. An exact number of a
 * symbolic result stays exact. The two values must have the same structure
 * (`valuesAgree()`): when they never have it, the call stays unevaluated,
 * and no float is returned without a comparison. A result with no float
 * (`x`) is returned after one evaluation. A lazy collection result is a
 * lazy collection whose elements are computed by `N(_, [p, a])`
 * (`inexactResult()`): each element is computed to the goal when it is
 * read.
 *
 * `request` is the goal (the second operand of the call, evaluated), for the
 * body of that `Map`.
 */
function evaluateToGoal(
  x: Expression,
  goal: NumericGoal,
  request: Expression
): Expression | undefined {
  const ce = x.engine;
  // `isPure` of `x` does not read the stored value of a symbol: `r` is pure
  // also when its value is `Random()`, and each evaluation of `r` then
  // draws again. Thus the values and the function bodies that `x` reads are
  // checked too (`isTransitivelyPure()`).
  const pure = isTransitivelyPure(x);
  const enginePrecision = ce.precision;
  // The working precision is above machine precision: at machine precision,
  // a value is computed with machine floats, which overflow to an infinity
  // (`e^1000`) or underflow to `0` (`e^−1000`), and an infinity is an exact
  // value that needs no second evaluation.
  let digits = Math.min(
    GOAL_MAX_PRECISION,
    Math.max(
      ce.precision,
      MACHINE_PRECISION + 1,
      Math.min(goal.precision, goal.accuracy) + GOAL_GUARD_DIGITS
    )
  );
  // Two values are compared: when the first working precision is the
  // largest one, the first value is computed at half of it. An impure
  // operand is evaluated one time only, at the first working precision.
  if (pure && digits >= GOAL_MAX_PRECISION) digits = GOAL_MAX_PRECISION / 2;
  let previous: Expression | undefined = undefined;
  // The number of successive values that are the rounding noise of `0`
  let zeroNoise = 0;
  const exact = once(() => x.evaluate());
  const enclosingRequest = ce._requestedPrecision;
  try {
    while (true) {
      // The handlers that run inside the evaluation receive the working
      // precision as `options.precision`.
      ce._requestedPrecision = digits;
      // `null`: the call stays unevaluated. `undefined`: the next working
      // precision.
      const result = ce._withTransientPrecision(
        digits,
        (): Expression | null | undefined => {
          const value = x.N();
          // A value with no float (`N(2, [PositiveInfinity, 20])`, or `y`
          // for a symbol `y` with no value) needs no second evaluation. The
          // value of an impure operand (`Random()`) is not computed again: a
          // second evaluation gives another value.
          if (isExactValue(value) || !pure)
            return roundToGoal(value, goal, request, x) ?? null;
          if (goal.accuracy === Infinity) {
            zeroNoise = hasZeroNoise(value, digits) ? zeroNoise + 1 : 0;
            if (zeroNoise >= ZERO_NOISE_COUNT) return null;
          }
          // A float that is exactly `0` does not meet a goal, also an
          // accuracy goal, unless the exact value at the same place is the
          // number `0`: the terms of the value can cancel at this working
          // precision. `e^(10^−100) − 1` is `0` below about 100 digits, and
          // `10^100·(e^(10^−100) − 1)`, whose value is about `1`, is thus
          // also `0`. The digits lost to such a cancellation are not known,
          // so the zero is not compared with the previous value: the
          // working precision is raised until the float is not `0`, and at
          // `GOAL_MAX_PRECISION` digits the call stays unevaluated.
          if (hasInexactZero(value, exact, () => x)) {
            previous = value;
            return undefined;
          }
          if (previous !== undefined && valuesAgree(previous, value, goal)) {
            if (
              isPrecisionIndependent(
                previous,
                value,
                exact,
                goal,
                enginePrecision
              )
            )
              return null;
            return roundToGoal(value, goal, request, x) ?? null;
          }
          previous = value;
          return undefined;
        }
      );
      if (result === null) return undefined;
      if (result !== undefined) return followEnginePrecision(ce, result);
      if (digits >= GOAL_MAX_PRECISION) return undefined;
      digits = Math.min(GOAL_MAX_PRECISION, 2 * digits);
    }
  } finally {
    ce._requestedPrecision = enclosingRequest;
  }
}

/**
 * True when every number in `value` (a value of `evaluateToGoal()`) is
 * exact. A value that is not a number is exact when it has no float that
 * `N` computed: a symbol, a string, a function literal, a `Hold`, an
 * operator that binds a variable or a lazy collection
 * (`isRoundingBoundary()`), or a function whose operands are exact.
 */
function isExactValue(value: Expression): boolean {
  if (isNumber(value)) return value.isExact;
  if (!isFunction(value) || isRoundingBoundary(value)) return true;
  return value.ops.every(isExactValue);
}

/**
 * True when a number in `value` (a value of `evaluateToGoal()`, computed at
 * `digits` digits) is not `0` and its magnitude is below
 * `10^−(digits − ZERO_NOISE_MARGIN)`: it can be the rounding noise of a value
 * that is `0` (see `evaluateToGoal()`).
 */
function hasZeroNoise(value: Expression, digits: number): boolean {
  if (isNumber(value)) {
    if (value.isExact || value.isFinite !== true) return false;
    const ce = value.engine;
    const re = value.bignumRe ?? ce.bignum(value.re);
    const im = value.bignumIm ?? ce.bignum(value.im);
    if (re.isZero() && im.isZero()) return false;
    const bound = ce.bignum(`1e${-(digits - ZERO_NOISE_MARGIN)}`);
    return re.abs().lt(bound) && im.abs().lt(bound);
  }
  return (
    isFunction(value) &&
    !isRoundingBoundary(value) &&
    value.ops.some((op) => hasZeroNoise(op, digits))
  );
}

/**
 * The operand `i` of `whole()` (the exact value of a list or a tuple), when
 * it has the same operator and the same number of operands as `like`, else
 * `undefined`.
 */
function exactAt(
  whole: () => Expression | undefined,
  like: Expression,
  i: number
): () => Expression | undefined {
  return () => {
    const e = whole();
    return e !== undefined &&
      isFunction(e) &&
      isFunction(like) &&
      e.operator === like.operator &&
      e.nops === like.nops
      ? e.ops[i]
      : undefined;
  };
}

/**
 * True when a number of `value` (a value of `evaluateToGoal()`) is a float
 * whose two parts are `0`, and the exact value of the operand at the same
 * place is not a number that is `0`. Such a float can be the result of a
 * cancellation at the working precision (`e^(10^−100) − 1` is `0` below
 * about 100 digits), and it does not meet a goal (see `evaluateToGoal()`).
 *
 * The exact value at the same place is read from `exact`, the exact value
 * of the operand of `N`. When `exact` has another structure at that place,
 * it is the exact value of the part of `source`, the operand of `N`, at
 * that place: the exact value of `x + Sin(Pi)` is `x`, and its numeric
 * value is `x + 0`, whose `0` is at the place of `Sin(Pi)` in `source`. When
 * no part is at that place, the float is taken as a cancellation.
 */
function hasInexactZero(
  value: Expression,
  exact: () => Expression | undefined,
  source: () => Expression | undefined
): boolean {
  if (isNumber(value)) {
    if (value.isExact || !isZeroNumber(value)) return false;
    const e = exact() ?? source()?.evaluate();
    return e === undefined || !isNumber(e) || !isZeroNumber(e);
  }
  return (
    isFunction(value) &&
    !isRoundingBoundary(value) &&
    value.ops.some((op, i) =>
      hasInexactZero(op, exactAt(exact, value, i), exactAt(source, value, i))
    )
  );
}

/** True when the two parts of the number literal `value` are `0`. A big
 * decimal part is read as a big decimal: `1e−400` is not `0`. */
function isZeroNumber(value: Expression): boolean {
  if (!isNumber(value)) return false;
  const re = value.bignumRe;
  const im = value.bignumIm;
  return (
    (re !== undefined ? re.isZero() : value.re === 0) &&
    (im !== undefined ? im.isZero() : value.im === 0)
  );
}

/**
 * True when a float of `b` has the same value as the float of `a` at the
 * same place (`a` and `b` are two successive values of `evaluateToGoal()`),
 * the float has at least `MACHINE_PRECISION` significant digits, `goal`
 * keeps more digits than the float has (`goalDigits()`), and the exact
 * value of the operand at that place (`exact`) is not an exact number: the
 * float does not change with the working precision, and it does not have
 * the digits of the goal (see `evaluateToGoal()`).
 *
 * A float with fewer significant digits that has the same value at two
 * precisions is a value that is exact to its digits, such as `1.25` for
 * `Cosh(Ln(2))` or `0.5` for `Abs(-0.5)`: it meets the goal. A float that
 * is wrong past its digits has the digits of a precision, not this short
 * form: a machine float has about 17 significant digits.
 *
 * A float that has the digits of the goal meets it: the float is rounded
 * to the goal, as `N(x, p)` rounds it. A machine float `y` gives
 * `N(2y, [PositiveInfinity, 5])`, as `N(2y, 30)` gives the 16 digits of
 * `2y`. The digits of the float are its significant digits, but at most
 * `precision`, the precision of the engine: the big decimal of a float
 * computed at that precision can have more digits (the product of two
 * 21-digit numbers has 42 digits), and only about `precision` of them are
 * correct. `N(x, p)` also shows such a float with the precision of the
 * engine (`showComputedDigits()`).
 */
function isPrecisionIndependent(
  a: Expression,
  b: Expression,
  exact: () => Expression | undefined,
  goal: NumericGoal,
  precision: number
): boolean {
  if (isNumber(a) && isNumber(b)) {
    if (b.isExact || b.isFinite !== true || a.isFinite !== true) return false;
    if (!sameParts(a, b)) return false;
    const digits = significantDigits(b);
    if (digits < MACHINE_PRECISION) return false;
    const ce = b.engine;
    const needed = Math.max(
      goalDigits(b.bignumRe ?? ce.bignum(b.re), goal),
      goalDigits(b.bignumIm ?? ce.bignum(b.im), goal)
    );
    if (needed <= Math.min(digits, precision)) return false;
    const e = exact();
    return e === undefined || !isNumber(e) || !e.isExact;
  }
  if (
    !isFunction(a) ||
    !isFunction(b) ||
    a.nops !== b.nops ||
    isRoundingBoundary(b)
  )
    return false;
  return b.ops.some((op, i) =>
    isPrecisionIndependent(a.ops[i], op, exactAt(exact, b, i), goal, precision)
  );
}

/**
 * True when the values `a` and `b`, two successive values of
 * `evaluateToGoal()`, agree to within `goal`: each part of each finite
 * number of `b` differs from the part of `a` by at most `10^−(a+2)`, or by
 * at most `10^−(p+2)` times the magnitude of the number. An infinity or a
 * `NaN` must be the same in `a` and `b`.
 *
 * The numbers are compared at the same places: `a` and `b` must have the
 * same functions with the same numbers of operands (`x + 3.14159…`), and
 * the same parts that are not numbers (`x`). A function literal, a `Hold`,
 * an operator that binds a variable and a lazy collection
 * (`isRoundingBoundary()`) are not changed by the goal: they must be the
 * same in `a` and `b` (`isSame()`). When `a` and `b` do not agree, the
 * working precision is raised; when they never agree, the call stays
 * unevaluated: a float is never returned without a comparison.
 *
 * The big decimals are compared at the precision in force, which is the
 * precision of `b`. Their difference is exact (`BigDecimal.sub()`).
 */
function valuesAgree(a: Expression, b: Expression, goal: NumericGoal): boolean {
  if (isNumber(a) && isNumber(b)) {
    if (a.isFinite !== true || b.isFinite !== true) return a.isSame(b);
    const ce = b.engine;
    const parts = (v: Expression): [BigNum, BigNum] => [
      v.bignumRe ?? ce.bignum(v.re),
      v.bignumIm ?? ce.bignum(v.im),
    ];
    const [aRe, aIm] = parts(a);
    const [bRe, bIm] = parts(b);
    const magnitude = bRe.abs().gt(bIm.abs()) ? bRe.abs() : bIm.abs();
    let tolerance = ce.bignum(0);
    if (goal.accuracy !== Infinity)
      tolerance = ce.bignum(`1e${-(goal.accuracy + 2)}`);
    if (goal.precision !== Infinity) {
      const relative = magnitude.mul(ce.bignum(`1e${-(goal.precision + 2)}`));
      if (relative.gt(tolerance)) tolerance = relative;
    }
    return (
      bRe.sub(aRe).abs().lte(tolerance) && bIm.sub(aIm).abs().lte(tolerance)
    );
  }
  if (isNumber(a) || isNumber(b)) return false;
  if (
    isFunction(a) &&
    isFunction(b) &&
    a.operator === b.operator &&
    a.nops === b.nops
  ) {
    if (isRoundingBoundary(a) || isRoundingBoundary(b)) return a.isSame(b);
    return a.ops.every((op, i) => valuesAgree(op, b.ops[i], goal));
  }
  return a.isSame(b);
}

/**
 * The number of significant digits of the big decimal `v` that `goal`
 * keeps: `min(p, a + ⌊log10 |v|⌋ + 1)`. `0` for `v = 0`.
 */
function goalDigits(v: BigNum, goal: NumericGoal): number {
  if (v.isZero()) return 0;
  // `⌊log10 |v|⌋`: the number of digits of the significand, plus the
  // exponent, minus 1.
  const significand = v.significand < 0n ? -v.significand : v.significand;
  const magnitude = significand.toString().length + v.exponent - 1;
  return Math.min(goal.precision, goal.accuracy + magnitude + 1);
}

/**
 * Round each number of `value` (a value of `evaluateToGoal()`) to the digits
 * of `goal`: each part `v` of a finite number is rounded to
 * `min(p, a + ⌊log10 |v|⌋ + 1)` significant digits, and is `0` when that
 * number is less than 1. The numbers are new floats, and they are
 * displayed with their digits (`setDisplayDigits()`). Call it at the working precision of
 * `value`: a float made at machine precision is a machine float.
 *
 * The parts of an exact number are computed at the precision that the
 * rounding needs. The big decimal of an exact number (`bignumRe`) is
 * rounded to the precision in force, so at the working precision an
 * integer with more digits lost its last digits:
 * `N(123456789012345678901234567890, [PositiveInfinity, 5])` had an error
 * of `234567890`. When the goal keeps more than `GOAL_MAX_PRECISION`
 * digits of an exact number, the result is `undefined`, and the call stays
 * unevaluated: `[10^9, PositiveInfinity]` would compute at a billion
 * digits.
 *
 * Each element of a list or a tuple is rounded, and an exact element is a
 * float. In a symbolic result (`x + 3.14159…`), each float is rounded, and
 * an exact number stays exact (`symbolic`): the exponent of `x^2` is not a
 * float. The function does not walk into a function literal, a `Hold`, an
 * operator that binds a variable, or a lazy collection
 * (`isRoundingBoundary()`). A function is made again with its rounded
 * operands, and it is canonical: a float rounded to `0` is removed from a
 * sum (`x + 0` is `x`).
 *
 * A lazy indexed collection that is the value, or an element of a list or
 * a tuple value, is a lazy collection whose elements are computed by
 * `N(_, request)` when they are read (`inexactResult()`). `source` is the
 * operand of `N` at the same place.
 */
function roundToGoal(
  value: Expression,
  goal: NumericGoal,
  request?: Expression,
  source?: Expression,
  symbolic = false
): Expression | undefined {
  const ce = value.engine;
  if (!symbolic && (isFunction(value, 'List') || isFunction(value, 'Tuple'))) {
    // The operand that matches each element, when the operand is a list or
    // a tuple of the same length.
    const sources =
      source !== undefined &&
      isFunction(source) &&
      source.operator === value.operator &&
      source.nops === value.nops
        ? source.ops
        : undefined;
    const ops: Expression[] = [];
    for (const [i, op] of value.ops.entries()) {
      const result = roundToGoal(op, goal, request, sources?.[i]);
      if (result === undefined) return undefined;
      ops.push(result);
    }
    return ce.function(value.operator, ops);
  }
  if (!isNumber(value)) {
    if (!isFunction(value) || isRoundingBoundary(value))
      return symbolic ? value : inexactResult(ce, value, request, source);
    let changed = false;
    const ops: Expression[] = [];
    for (const op of value.ops) {
      let result =
        isNumber(op) && op.isExact
          ? op
          : roundToGoal(op, goal, request, undefined, true);
      if (result === undefined) return undefined;
      // A term of a sum that the goal rounds to `0` is removed: the
      // canonical form removes an exact `0` from a sum, but not a float `0`.
      if (value.operator === 'Add' && isZeroNumber(result)) result = ce.Zero;
      if (result !== op) changed = true;
      ops.push(result);
    }
    return changed ? ce.function(value.operator, ops) : value;
  }
  if (value.isFinite !== true) return inexactResult(ce, value);

  if (value.isExact) {
    // The digits that the goal keeps, from the magnitude of the parts at
    // the precision in force (it can be one less than the magnitude of
    // the exact value: the guard digits cover it).
    const needed = Math.max(
      goalDigits(value.bignumRe ?? ce.bignum(value.re), goal),
      goalDigits(value.bignumIm ?? ce.bignum(value.im), goal)
    );
    if (needed > GOAL_MAX_PRECISION) return undefined;
    const working = needed + guardDigits(needed);
    if (working > ce.precision)
      return ce._withTransientPrecision(working, () =>
        roundToGoal(value, goal)
      );
  }

  let shown = 0;
  const roundPart = (v: BigNum): BigNum => {
    if (v.isZero()) return v;
    const digits = goalDigits(v, goal);
    if (digits < 1) return ce.bignum(0);
    shown = Math.max(shown, digits);
    return v.toPrecision(digits);
  };
  const re = roundPart(value.bignumRe ?? ce.bignum(value.re));
  const im = roundPart(value.bignumIm ?? ce.bignum(value.im));
  // A new value: its display digits change the display of this result only
  const result = ce._inexactNumericValue(im.isZero() ? re : { re, im });
  if (shown > 0) setDisplayDigits(result, shown);
  return ce.number(result);
}

/**
 * The three operands of the `ProtocolProperty` left-hand side of a QUALIFIED
 * property write — `p.(Nameable.name) = v`, which the Epsil parser lowers to
 * `Assign(ProtocolProperty("Nameable", "name", p), v)`.
 *
 * The protocol and property names ride as string literals, or as bare symbols
 * after a round trip through a serializer that printed them unquoted.
 * `undefined` when the node is not that shape.
 */
function qualifiedWriteOperands(
  lhs: Expression & { ops: ReadonlyArray<Expression> }
): { protocol: string; name: string; base: Expression } | undefined {
  const nameOf = (op: Expression | undefined): string | undefined => {
    if (op === undefined) return undefined;
    return isString(op) ? op.string : sym(op);
  };
  const protocol = nameOf(lhs.ops[0]);
  const name = nameOf(lhs.ops[1]);
  const base = lhs.ops[2];
  if (protocol === undefined || name === undefined || base === undefined)
    return undefined;
  return { protocol, name, base };
}

/**
 * The value of an operator whose host capability the engine's registry denies
 * (`ce.effects.<capability>` is `null`): an `Error("capability-denied",
 * "<capability>")` expression. It is an error VALUE, not a thrown exception —
 * the denial is a fact about the program's environment that the program's
 * caller reads from the result, like any other evaluation error, and a host
 * that evaluates an expression it does not trust must not have to catch.
 */
function capabilityDenied(
  ce: ComputeEngine,
  capability: keyof EffectHandlers
): Expression {
  return ce.error(['capability-denied', capability]);
}

/**
 * True when `StringFrom` with NO format operand reads `expr` as Unicode
 * scalar values (code points) instead of printing it: a number, or a finite
 * list whose elements are all numbers. (User decision of 2026-09-22.)
 *
 * The collection test is on the LIST shape, not on `isIndexedCollection`: a
 * tuple carries the coordinates of a point in this engine, so a tuple of two
 * numbers must keep printing as `(65, 66)` and must not silently turn into
 * `"AB"`. A list with no finite count is refused as well, because the decode
 * reads every element.
 *
 * A list whose elements cannot be REACHED yet is refused too, and for the
 * same reason the materializer refuses one: a walk over a source that has no
 * elements available yields nothing, which is indistinguishable from a walk
 * over an empty list. `Take(xs, 2)` for a declared but unassigned `xs` is a
 * finite list by its type, so without the enumerability test
 * `StringFrom(Take(xs, 2))` answered the EMPTY STRING and lost the
 * unresolved expression. The walk is checked against the known element count
 * for the same reason: a walk that ends early did not supply the elements
 * either.
 *
 * Only a number that CAN be a code point takes the implicit default: a
 * finite integer that is not negative. `NaN`, an infinity, a non-integer and
 * a complex number are not code points, so with no format they keep the
 * printed form (`"NaN"`, `"1.5"`, `"(1 + 2i)"`). An integer above U+10FFFF
 * or a surrogate is handed to the `"unicode-scalars"` code all the same, so
 * the implicit default and the explicit format answer the same thing for it.
 */
function isUnicodeScalarSource(expr: Expression): boolean {
  if (isNumber(expr)) return isCodePointCandidate(expr);
  if (!expr.type.matches('list<any>')) return false;
  if (expr.isFiniteCollection !== true) return false;
  if (!isEnumerableSource(expr)) return false;
  let n = 0;
  for (const x of expr.each()) {
    if (!isNumber(x) || !isCodePointCandidate(x)) return false;
    n += 1;
  }
  const count = expr.count;
  if (count !== undefined && n < count) return false;
  return true;
}

/** A finite, non-negative integer: the only number that can be a code point. */
function isCodePointCandidate(x: Expression): boolean {
  return x.isInteger === true && x.isFinite === true && x.re >= 0;
}

/**
 * The second operand of `N`, resolved to a request: `plain` for no
 * request, or a request that is not a number of digits of 1 or more (the
 * value at the precision of the engine); `invalid` for a lazy collection
 * with a number of elements other than 2, or a goal that is not valid (the
 * call stays unevaluated); `goal` for a list `[p, a]` of a precision goal
 * and an accuracy goal; `digits` for a number of significant digits, capped
 * at 1000. The operand is given evaluated numerically (it may be `2 + 3`
 * or a bound symbol), by the caller.
 */
type NRequest =
  | { kind: 'plain' }
  | { kind: 'invalid' }
  | { kind: 'goal'; goal: NumericGoal; request: Expression }
  | { kind: 'digits'; p: number };

function resolveNRequest(ce: ComputeEngine, requested: Expression): NRequest {
  let request = requested;
  // A lazy indexed collection (`Range(30, 31)`, or a symbol whose value
  // is one) is a goal when it has two elements, as a list is: its
  // elements are read into a list.
  if (request.isLazyCollection && request.isIndexedCollection) {
    if (request.count !== 2) return { kind: 'invalid' };
    request = ce.function('List', [...request.each()]);
  }
  if (isFunction(request, 'List') || isFunction(request, 'Tuple')) {
    const goal = numericGoal(request);
    return goal === undefined
      ? { kind: 'invalid' }
      : { kind: 'goal', goal, request };
  }
  const p = request.re;
  if (!Number.isFinite(p) || p < 1) return { kind: 'plain' };
  return { kind: 'digits', p: Math.min(Math.trunc(p), 1000) };
}

/**
 * The `evaluate` handler of `N`: the numeric value of its operand, at the
 * precision of the engine or at the requested digits. The request is
 * resolved once (`resolveNRequest()`) and the value is computed by
 * `evaluateNResolved()`, which the asynchronous twin (`evaluateNAsync()`)
 * shares.
 */
function evaluateN(
  ops: ReadonlyArray<Expression>,
  { engine: ce }: EvaluateHandlerOptions
): Expression | undefined {
  // `N` is lazy, so its operand is held unbound. Calling `.N()` on an
  // unbound expression is a no-op (e.g. an unbound `Pi` symbol returns
  // itself), so canonicalize (bind) the operand first. This makes
  // `["N", expr]` equivalent to `expr.N()`.
  const source = ops[0].canonical;
  const request: NRequest =
    ops.length < 2
      ? { kind: 'plain' }
      : resolveNRequest(ce, ops[1].canonical.N());
  return evaluateNResolved(ce, source, request);
}

/** The value of `N(source, request)` for a resolved request. */
function evaluateNResolved(
  ce: ComputeEngine,
  source: Expression,
  request: NRequest
): Expression | undefined {
  if (request.kind === 'invalid') return undefined;
  if (request.kind === 'plain') return inexactResult(ce, source.N());
  if (request.kind === 'goal')
    return evaluateToGoal(source, request.goal, request.request);
  const p = request.p;

  // The requested digits reach every `evaluate` handler run inside this
  // call as `options.precision` (see `IComputeEngine._requestedPrecision`).
  // Restored after the call, so a nested `N(y, q)` applies to `y` only.
  const enclosingRequest = ce._requestedPrecision;
  ce._requestedPrecision = p;
  try {
    // The value is computed with guard digits, then rounded to `p`
    // digits: a value computed at `p` digits can have an error of a
    // few units in its last digit (`N(Exp(i), 30)` had a real part
    // that ended with ...444, not ...443). With the guard digits, a
    // digit is wrong only when the exact value is within that error
    // of a point halfway between two `p`-digit numbers.
    const global = ce.precision;
    const working = p + guardDigits(p);
    if (working <= global) {
      // The working precision of the engine has the guard digits:
      // round the value down to `p` significant digits. The precision
      // is not lowered (it has a machine-digit floor, so lowering it
      // can't reach a small `p`).
      return inexactResult(
        ce,
        roundToSignificantDigits(source.N(), p),
        p,
        source
      );
    }

    // Compute at `working` digits, then restore the precision of the
    // engine, also when the evaluation throws: `N(x, p)` does not
    // change `ce.precision` (GitHub issue #391). The precision is
    // raised without a reset of the engine
    // (`_withTransientPrecision`): the value of a constant such as
    // `Pi` is computed again at `working` digits, and is not read from
    // the value that the engine keeps at its precision. The handlers
    // receive `p` as `options.precision`: it is the number of digits
    // that the call requests.
    //
    // The result is rounded to `p` digits. When `p` is more than the
    // precision of the engine, each float that the window computed is
    // displayed with its `p` digits (`showComputedDigits()`), also a
    // float in a symbolic result (`x + 3.14159…`). An operation on the
    // result later computes at the precision of the engine, and its
    // result is displayed with that precision. The elements of a lazy
    // collection are read after the precision is restored: each one
    // is computed from the operand by its own `N(_, p)`
    // (`inexactResult()`).
    //
    // The value at the precision of the engine is computed only when
    // a float has more digits than that precision, and only for a pure
    // operand: a second evaluation of `Random()` would give another
    // value. It is also not computed for a float with more digits
    // than a machine float when the operand reads no float that is
    // already computed (`mayReadFixedFloat()`): such a float was
    // computed by the window, at its precision. Thus `N(Pi, 50)` or
    // `N(Integrate(…), 50)` evaluates the operand one time only.
    const referenceValue = once(() => {
      // `isPure` does not read the stored values: `r + Pi` is pure
      // also when `r` holds `Random()` (`isTransitivelyPure()`).
      if (!isTransitivelyPure(source)) return undefined;
      ce._requestedPrecision = enclosingRequest;
      try {
        return ce._withTransientPrecision(global, () => source.N());
      } finally {
        ce._requestedPrecision = p;
      }
    });
    const readsFixedFloat = once(() => mayReadFixedFloat(source));
    const reference = (shown: number): Expression | undefined =>
      shown <= MACHINE_FLOAT_DIGITS || readsFixedFloat()
        ? referenceValue()
        : undefined;
    const result = ce._withTransientPrecision(working, () => {
      const value = inexactResult(
        ce,
        roundToSignificantDigits(source.N(), p),
        p,
        source
      );
      if (p <= global) return value;
      return showComputedDigits(
        value,
        p,
        global,
        reference,
        once(() => source.evaluate())
      );
    });
    // A float with no more digits than the precision of the engine is
    // a float of the kind that the engine makes: a machine float at
    // machine precision (`N(1/3, 11)` is computed at 16 digits, which
    // makes a big decimal).
    return followEnginePrecision(ce, result);
  } finally {
    ce._requestedPrecision = enclosingRequest;
  }
}

/**
 * The asynchronous requests of digits that are in flight on an engine
 * (`evaluateNAsync()`). An asynchronous request sets
 * `ce._requestedPrecision` across an `await`, and two such requests on one
 * engine can finish in either order: a save-and-restore around each one
 * would leave the field set to the other's digits for the life of the
 * engine when the first to start finishes first. The field follows the
 * entries instead: the last entry still in flight, or the value the field
 * had before the first entry, once none is left.
 */
const activeAsyncDigitRequests = new WeakMap<
  ComputeEngine,
  { entries: { p: number }[]; base: number | undefined }
>();

/**
 * The asynchronous twin of `evaluateN()`: the operand is evaluated with
 * `evaluateAsync({ numericApproximation: true })`, so that a long operand
 * (a `Sum` over many terms) yields to the event loop and honours the abort
 * signal, where the synchronous handler ran it to the end (GitHub issue
 * #392). `N(x)` and `N(x, p)` for a `p` within the precision of the engine
 * are asynchronous, with the same rounding as the synchronous handler. The
 * forms that need a precision window (`N(x, p)` for a `p` above the
 * precision of the engine, and a goal `N(x, [p, a])`) keep the engine's
 * precision raised for the time of the computation, which cannot span an
 * `await` while other evaluations run: they are computed by the
 * synchronous `evaluateNResolved()`, after the asynchronous-only
 * applications of the operand are awaited (the driver skips that pre-pass
 * for an operator that has an asynchronous handler). A symbol or a number
 * operand keeps its own `N()` route, as in the synchronous handler (a
 * symbol's `N()` resolves the names of its value through the ambient
 * scope chain); a leaf has no asynchronous work.
 */
async function evaluateNAsync(
  ops: ReadonlyArray<Expression>,
  options: EvaluateHandlerOptions
): Promise<Expression | undefined> {
  const { engine: ce, signal, effects, _contextStack } = options;
  const opts = {
    numericApproximation: true,
    signal,
    _effects: effects,
    _contextStack,
  };
  const source = ops[0].canonical;
  // `numeric()` can run after an `await`: a symbol's `N()` reads its value
  // through the current scope, so it runs with this evaluation's context
  // stack (and registry) in place.
  const numeric = (): Promise<Expression> =>
    isFunction(source)
      ? source.evaluateAsync(opts)
      : Promise.resolve(
          runWithEvaluationEffects(ce, effects, () => source.N(), _contextStack)
        );
  const request: NRequest =
    ops.length < 2
      ? { kind: 'plain' }
      : resolveNRequest(ce, await ops[1].canonical.evaluateAsync(opts));
  if (request.kind === 'invalid') return undefined;
  if (request.kind === 'plain') return inexactResult(ce, await numeric());
  if (
    request.kind === 'goal' ||
    request.p + guardDigits(request.p) > ce.precision
  ) {
    const [resolved] = await awaitAsyncOnlyDescendants([source], {
      signal,
      _effects: effects,
      _contextStack,
    });
    // A synchronous evaluation after an `await` runs with this evaluation's
    // registry and context stack (`docs/EFFECTS-MODEL.md`, rule 3).
    return runWithEvaluationEffects(
      ce,
      effects,
      () => evaluateNResolved(ce, resolved, request),
      _contextStack
    );
  }

  // The working precision of the engine has the guard digits: the value is
  // rounded to `p` digits. The requested digits reach the handlers run by
  // the evaluation as `options.precision`, as in `evaluateNResolved()`;
  // the field follows the requests in flight (`activeAsyncDigitRequests`).
  const p = request.p;
  let active = activeAsyncDigitRequests.get(ce);
  if (active === undefined) {
    active = { entries: [], base: undefined };
    activeAsyncDigitRequests.set(ce, active);
  }
  if (active.entries.length === 0) active.base = ce._requestedPrecision;
  const entry = { p };
  active.entries.push(entry);
  ce._requestedPrecision = p;
  try {
    const value = await numeric();
    return runWithEvaluationEffects(
      ce,
      effects,
      () => inexactResult(ce, roundToSignificantDigits(value, p), p, source),
      _contextStack
    );
  } finally {
    const i = active.entries.indexOf(entry);
    if (i >= 0) active.entries.splice(i, 1);
    ce._requestedPrecision =
      active.entries.length === 0
        ? active.base
        : active.entries[active.entries.length - 1].p;
  }
}

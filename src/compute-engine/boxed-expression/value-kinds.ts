/**
 * The KIND REGISTRY of an engine: the value kinds declared by the
 * `arithmetic` field of operator definitions
 * (`docs/plans/2026-10-26-value-kinds.md`, sections 4.1 and 4.6).
 *
 * A value kind is a set of values with their own arithmetic (a residue
 * class, a measurement, an element of a finite field). It is declared on the
 * operator definition of the head that constructs its values, and the result
 * type of that head is the KIND TYPE: a kind primitive of the type language
 * (`residue`), or a nominal type whose definition is exactly `value`, declared
 * with `ce.declareType(name, 'value', { mint: false })`.
 *
 * The registry has two parts:
 *
 * - The TYPE part maps a kind type name to the fields that belong to the type
 *   (`admittedAs`, `resultType`, `compile.type`) and to the heads that
 *   declare a kind of that type. A symbol of a kind type has no head to ask,
 *   so these fields are kept under the type. The part is engine-level, like
 *   the type registry: popping the scope of a head does not remove its type.
 * - The DISPATCH part maps a bound operator DEFINITION (not the spelling of
 *   the head) to its arithmetic, so an expression keeps the hooks of the
 *   definition it was bound to.
 *
 * The registry has a generation counter, incremented by every registration,
 * replacement, removal and checkpoint restore. A cache of a recognition
 * result stores the generation it was computed under.
 *
 * The registry also holds three per-engine gates for each kind type, which
 * let an engine that never uses a kind skip the walks that look for its
 * values. A gate only opens; it is not restored by a checkpoint (an open gate
 * costs a walk, never a wrong answer).
 *
 * The registry is stored on the engine (`IComputeEngine._kindRegistry`) and
 * is read and written only through the functions of this module.
 */

import type {
  ArithmeticCompile,
  ArithmeticDefinition,
  BoxedOperatorDefinition,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import type {
  KindRegistryState,
  KindTypeRecord,
} from '../types-definitions.js';
import type { Type, TypeReference } from '../../common/type/types.js';
import { declarationOf } from '../../common/type/reference.js';
import { signatureArms, type KindTypeNames } from '../../common/type/utils.js';
import { typeToString } from '../../common/type/serialize.js';

/**
 * The kind primitives: the names of the type language that are kind types in
 * every engine. Only the library adds one, with an entry in the subtype table
 * of `common/type/subtype.ts` that lists no subtype and no supertype but
 * `value`.
 */
export const KIND_PRIMITIVES: ReadonlyArray<string> = [
  'residue',
  'measurement',
  'quantity',
  'enclosure',
];

/** The marker arms that may be added to the kind arms of a result type. */
const MARKER_ARMS: ReadonlyArray<string> = [
  'nan',
  'missing',
  'nothing',
  'error',
];

/** A new, empty kind registry. The engine constructor calls it. */
export function createKindRegistry(): KindRegistryState {
  return {
    types: new Map(),
    dispatch: new Map(),
    generation: 0,
    withValues: new Set(),
    withAssignedValues: new Set(),
    withDeclarations: new Set(),
  };
}

/** The registry of `ce`. The argument is typed `object` so that the
 * readers accept the engine view of a type handler (`PureEngineView`), which
 * is the engine itself at run time. */
function registryOf(ce: object): KindRegistryState {
  return (ce as ComputeEngine)._kindRegistry;
}

//
// The declaration check
//

/**
 * A registration that passed the declaration checks
 * ({@link prepareKindRegistration}) and is ready to be committed
 * ({@link commitKindRegistration}) once the definition is installed.
 */
export type KindRegistration = {
  readonly name: string;
  readonly arithmetic: ArithmeticDefinition;
  readonly kindTypes: ReadonlyArray<string>;
  readonly library: boolean;
  readonly supersedes: BoxedOperatorDefinition | undefined;
};

/** The options of a registration. */
export type KindRegistrationOptions = {
  /** True for a definition of a library, installed while the engine is being
   * constructed. */
  library?: boolean;
  /** The definition this one replaces in the SAME binding (a redeclaration
   * with `{ extend: true }`, a notebook cell run again). Its dispatch entry
   * is removed, and it does not count as another live head of the type. */
  supersedes?: BoxedOperatorDefinition;
};

function refuse(name: string, message: string): never {
  throw new Error(`Operator Definition "${name}": ${message}`);
}

/**
 * The kind type names of the result type `result` of an arm of the
 * signature of the head `name`, or a thrown error that names the rule.
 */
function kindArmsOfResult(name: string, result: Type, out: Set<string>): void {
  const arms: ReadonlyArray<Type> =
    typeof result === 'object' && result.kind === 'union'
      ? result.types
      : [result];
  for (const arm of arms) {
    if (typeof arm === 'string') {
      if (MARKER_ARMS.includes(arm)) continue;
      if (KIND_PRIMITIVES.includes(arm)) {
        out.add(arm);
        continue;
      }
      refuse(
        name,
        `a value kind (the \`arithmetic\` field) requires a result type that is a kind type, but the result type has the arm \`${arm}\`. A kind type is a kind primitive (${KIND_PRIMITIVES.map((p) => `\`${p}\``).join(', ')}) or a nominal type defined as exactly \`value\` and declared with \`{ mint: false }\`, with at most the arms ${MARKER_ARMS.map((m) => `\`${m}\``).join(', ')} beside it`
      );
    }
    if (arm.kind === 'reference') {
      const decl = declarationOf(arm);
      // A transparent alias is its definition.
      if (decl.alias) {
        if (decl.typeParams !== undefined || arm.args !== undefined)
          refuse(
            name,
            `the result type of a value kind cannot be the parameterized type \`${typeToString(arm)}\``
          );
        if (decl.def === undefined)
          refuse(
            name,
            `the result type \`${decl.name}\` of a value kind is not defined`
          );
        kindArmsOfResult(name, decl.def, out);
        continue;
      }
      if (decl.typeParams !== undefined || arm.args !== undefined)
        refuse(
          name,
          `the result type \`${typeToString(arm)}\` of a value kind is a parameterized nominal type, which cannot be a kind type: declare a nominal type without parameters, defined as exactly \`value\``
        );
      if (decl.def === undefined)
        refuse(
          name,
          `the result type \`${decl.name}\` of a value kind is not defined`
        );
      if (typeof decl.def === 'object' && decl.def.kind === 'reference')
        refuse(
          name,
          `the result type \`${decl.name}\` of a value kind is defined as another nominal type (\`${typeToString(decl.def)}\`), which cannot be a kind type: define it as exactly \`value\``
        );
      if (decl.def !== 'value')
        refuse(
          name,
          `the result type \`${decl.name}\` of a value kind is a nominal type defined as \`${typeToString(decl.def)}\`. A nominal kind type must be defined as exactly \`value\`, so that it is disjoint from the numbers and the other types`
        );
      if (decl._minted !== false)
        refuse(
          name,
          `the result type \`${decl.name}\` of a value kind was declared with a constructor of its own (the default of \`declareType()\`): the constructor would be a second head of the kind type with no arithmetic. Declare the type with \`ce.declareType('${decl.name}', 'value', { mint: false })\``
        );
      out.add(decl.name);
      continue;
    }
    refuse(
      name,
      `a value kind (the \`arithmetic\` field) requires a result type that is a kind type, but the result type has the arm \`${typeToString(arm)}\`. A kind type is a kind primitive (${KIND_PRIMITIVES.map((p) => `\`${p}\``).join(', ')}) or a nominal type defined as exactly \`value\` and declared with \`{ mint: false }\``
    );
  }
}

/**
 * The kind types of the result types of every arm of `signature`, the
 * signature of the head `name` that declares a value kind. Throws, with an
 * error that names the rule, when an arm has a result that is not a kind
 * type (or one of the marker arms `nan`, `missing`, `nothing`, `error`).
 */
export function kindTypesOfSignature(
  name: string,
  signature: Type
): ReadonlyArray<string> {
  const arms = signatureArms(signature);
  if (arms === undefined || arms.length === 0)
    refuse(
      name,
      `a value kind (the \`arithmetic\` field) requires a signature whose result type is a kind type, but the signature is \`${typeToString(signature)}\``
    );
  const out = new Set<string>();
  for (const arm of arms) {
    if (arm.typeParams !== undefined && arm.typeParams.length > 0)
      refuse(
        name,
        `a value kind (the \`arithmetic\` field) cannot have a generic signature (\`${typeToString(signature)}\`): its result type must be a kind type`
      );
    const before = out.size;
    kindArmsOfResult(name, arm.result, out);
    // An arm whose result has only marker arms (`-> nan`) names no kind.
    if (out.size === before && !hasKindArm(arm.result))
      refuse(
        name,
        `a value kind (the \`arithmetic\` field) requires a result type that is a kind type, but the result type is \`${typeToString(arm.result)}\``
      );
  }
  return [...out];
}

/** True when `t`, a result type that passed `kindArmsOfResult()`, has at
 * least one arm that is not a marker. */
function hasKindArm(t: Type): boolean {
  if (typeof t === 'string') return !MARKER_ARMS.includes(t);
  if (t.kind === 'union') return t.types.some(hasKindArm);
  if (t.kind === 'reference') {
    const decl = declarationOf(t);
    return decl.alias && decl.def !== undefined ? hasKindArm(decl.def) : true;
  }
  return true;
}

/**
 * Check that the head `name`, with the signature `signature`, can declare
 * the value kind `arithmetic`, and return the registration to commit once
 * the definition is installed. Throws, with an error that names the rule,
 * when a check fails. Changes nothing.
 *
 * The checks (`docs/plans/2026-10-26-value-kinds.md`, section 4.1.2):
 * - every arm of the result type of every signature arm is a kind type or
 *   one of the marker arms `nan`, `missing`, `nothing`, `error`;
 * - a head that gives `add` gives `negate`: `a - b` is canonically
 *   `Add(Negate(b), a)`, so without `negate` a difference never folds;
 * - the per-type agreement rule: for each kind type, another LIVE head of
 *   the type (one in the dispatch part, other than the definition this one
 *   replaces) must not have set `admittedAs`, `resultType` or `compile.type`
 *   to another value. `admittedAs` is compared by value, a head that leaves
 *   it out counting as `'none'` for the first head of a type; `resultType`
 *   and `compile.type` are compared by identity. A head can add a
 *   `resultType` or a `compile.type` that the live heads left out, except
 *   to a type that a library head registered.
 */
export function prepareKindRegistration(
  ce: ComputeEngine,
  name: string,
  signature: Type,
  arithmetic: ArithmeticDefinition,
  options: KindRegistrationOptions = {}
): KindRegistration {
  if (
    arithmetic === null ||
    typeof arithmetic !== 'object' ||
    Array.isArray(arithmetic)
  )
    refuse(name, 'the `arithmetic` field must be an object');

  if (arithmetic.add !== undefined && arithmetic.negate === undefined)
    refuse(
      name,
      'a value kind that gives `add` must also give `negate`: `a - b` is canonically `Add(Negate(b), a)`, so without `negate` a difference never folds'
    );

  const kindTypes = kindTypesOfSignature(name, signature);

  const registry = registryOf(ce);
  const supersedes = options.supersedes;
  const admittedAs = arithmetic.admittedAs;
  const resultType = arithmetic.resultType;
  const compileType = arithmetic.compile?.type;
  for (const typeName of kindTypes) {
    const rec = registry.types.get(typeName);
    if (rec === undefined) continue;

    // A LIBRARY type keeps the fields its library heads gave, and gets no
    // field they left out: a `compile.type` given by another head would set
    // the lowering of every free symbol of the type and of the library
    // head's own arithmetic.
    if (rec.library) {
      if (admittedAs !== undefined && admittedAs !== rec.admittedAs)
        refuse(
          name,
          `the kind type \`${typeName}\` is declared by the library with \`admittedAs: '${rec.admittedAs}'\`; another head of the type cannot give \`admittedAs: '${admittedAs}'\``
        );
      if (resultType !== undefined && resultType !== rec.resultType)
        refuse(
          name,
          rec.resultType === undefined
            ? `the kind type \`${typeName}\` is declared by the library without a \`resultType\`; another head of the type cannot add one`
            : `the kind type \`${typeName}\` is declared by the library with another \`resultType\`; a head of the type must give the same function or none`
        );
      if (compileType !== undefined && compileType !== rec.compileType)
        refuse(
          name,
          rec.compileType === undefined
            ? `the kind type \`${typeName}\` is declared by the library without a \`compile.type\`; another head of the type cannot add one`
            : `the kind type \`${typeName}\` is declared by the library with another \`compile.type\`; a head of the type must give the same object or none`
        );
      continue;
    }

    // No other live head: the fields of this head replace those of the type
    // when the registration is committed.
    let otherLiveHead = false;
    for (const head of rec.heads)
      if (head !== supersedes) {
        otherLiveHead = true;
        break;
      }
    if (!otherLiveHead) continue;

    if (admittedAs !== undefined && admittedAs !== rec.admittedAs)
      refuse(
        name,
        `another head of the kind type \`${typeName}\` is declared with \`admittedAs: '${rec.admittedAs}'\`; the heads of one kind type must give the same \`admittedAs\` or none`
      );
    if (
      resultType !== undefined &&
      rec.resultType !== undefined &&
      resultType !== rec.resultType
    )
      refuse(
        name,
        `another head of the kind type \`${typeName}\` gives another \`resultType\` function; the heads of one kind type must give the same function (the same object, not a copy) or none`
      );
    if (
      compileType !== undefined &&
      rec.compileType !== undefined &&
      compileType !== rec.compileType
    )
      refuse(
        name,
        `another head of the kind type \`${typeName}\` gives another \`compile.type\`; the heads of one kind type must give the same object or none`
      );
  }

  return {
    name,
    arithmetic,
    kindTypes,
    library: options.library === true,
    supersedes,
  };
}

/**
 * Record the registration `registration`, prepared by
 * {@link prepareKindRegistration}, for the installed definition `def`.
 *
 * Removes the dispatch entry of the definition it replaces, records the
 * fields of the types and the dispatch entry of `def`, and increments the
 * generation. A registration made after the library bootstrap opens the
 * gates of its kind types for the engine, so a value of the head boxed
 * before the registration is recognized without another event.
 */
export function commitKindRegistration(
  ce: ComputeEngine,
  def: BoxedOperatorDefinition,
  registration: KindRegistration
): void {
  const registry = registryOf(ce);
  if (registration.supersedes !== undefined)
    removeDispatchEntry(registry, registration.supersedes);
  // A definition registered again (an in-place update) leaves its old types.
  removeDispatchEntry(registry, def);

  const { arithmetic, kindTypes, library } = registration;
  const admittedAs = arithmetic.admittedAs;
  const resultType = arithmetic.resultType;
  const compileType = arithmetic.compile?.type;
  for (const typeName of kindTypes) {
    const rec = registry.types.get(typeName);
    if (rec === undefined) {
      registry.types.set(typeName, {
        admittedAs: admittedAs ?? 'none',
        resultType,
        compileType,
        heads: new Set([def]),
        library,
      });
      continue;
    }
    if (rec.heads.size === 0 && !rec.library) {
      // No live head remains: this head's fields REPLACE the type's.
      rec.admittedAs = admittedAs ?? 'none';
      rec.resultType = resultType;
      rec.compileType = compileType;
    } else {
      // The fields agree (checked by `prepareKindRegistration`); a field the
      // other heads left out is added.
      if (admittedAs !== undefined) rec.admittedAs = admittedAs;
      if (resultType !== undefined) rec.resultType = resultType;
      if (compileType !== undefined) rec.compileType = compileType;
    }
    rec.heads.add(def);
  }
  registry.dispatch.set(def, {
    arithmetic,
    kindTypes,
    name: registration.name,
  });
  registry.generation += 1;

  if (!library)
    for (const typeName of kindTypes) {
      registry.withValues.add(typeName);
      registry.withDeclarations.add(typeName);
    }
}

/**
 * Check and record the value kind of the installed definition `def` of the
 * head `name`, in one call. See {@link prepareKindRegistration} for the
 * checks. A route that can refuse before it installs the definition calls
 * the two steps separately instead.
 */
export function registerKind(
  ce: ComputeEngine,
  name: string,
  def: BoxedOperatorDefinition,
  options: KindRegistrationOptions = {}
): void {
  const arithmetic = def.arithmetic;
  if (arithmetic === undefined) return;
  commitKindRegistration(
    ce,
    def,
    prepareKindRegistration(ce, name, def.signature.type, arithmetic, options)
  );
}

function removeDispatchEntry(
  registry: KindRegistryState,
  def: BoxedOperatorDefinition
): boolean {
  const entry = registry.dispatch.get(def);
  if (entry === undefined) return false;
  registry.dispatch.delete(def);
  // The type part stays: the protection of a kind type, and its fields,
  // outlive the heads that declared it.
  for (const typeName of entry.kindTypes)
    registry.types.get(typeName)?.heads.delete(def);
  return true;
}

/**
 * Remove the dispatch entry of `def`: its head was redeclared in the same
 * binding without `arithmetic`. The kind types of `def` stay kind types, with
 * their fields. Returns `false`, and changes nothing, when `def` had no
 * entry.
 */
export function unregisterKind(
  ce: ComputeEngine,
  def: BoxedOperatorDefinition
): boolean {
  const registry = registryOf(ce);
  if (!removeDispatchEntry(registry, def)) return false;
  registry.generation += 1;
  return true;
}

//
// Readers
//

/** The names of the kind types registered in the engine. */
export function kindTypesOf(ce: ComputeEngine): ReadonlySet<string> {
  return new Set(registryOf(ce).types.keys());
}

/**
 * True when `t` itself is a registered kind type: a kind primitive or a
 * nominal reference registered by a head of the engine, or a transparent
 * alias of one. A union that has a kind arm is NOT a kind type (the readers
 * of arms are the recognition functions of later steps).
 */
export function isKindType(ce: ComputeEngine, t: Type): boolean {
  const registry = registryOf(ce);
  if (typeof t === 'string') return registry.types.has(t);
  if (t.kind !== 'reference' || t.args !== undefined) return false;
  const decl = declarationOf(t);
  if (decl.alias)
    return decl.def !== undefined && decl.typeParams === undefined
      ? isKindType(ce, decl.def)
      : false;
  // The registry of the engine holds the record by name; a record of another
  // engine with the same name is another type.
  if (ce._typeRegistry[decl.name] !== decl) return false;
  return registry.types.has(decl.name);
}

/**
 * The names of the kind types of `ce`, as the type functions that read a
 * kind arm take them (`hasKindArm()`, `withoutKindArms()`, …,
 * `common/type/utils.ts`): the kind primitives, and the kind types the
 * registry holds. A live view: it reads the registry on each query, so it
 * stays right after a registration or a checkpoint restore.
 *
 * The kind primitives are kind types in every engine, registered or not: a
 * primitive exists in the type language before any engine, and an engine
 * built without the library head of a primitive (`ResidueClass`) still
 * protects a symbol declared with it. A nominal type is matched by its name
 * (the engine has one type namespace).
 */
export function kindTypeNames(ce: object): KindTypeNames {
  let view = KIND_TYPE_NAMES.get(ce);
  if (view === undefined) {
    view = {
      has: (name: string) =>
        KIND_PRIMITIVES.includes(name) || registryOf(ce).types.has(name),
    };
    KIND_TYPE_NAMES.set(ce, view);
  }
  return view;
}

const KIND_TYPE_NAMES = new WeakMap<object, KindTypeNames>();

/**
 * The kind types of the registered heads named `name`, or `undefined` when
 * no registered head has that name. For an expression that is not bound to
 * a definition (a non-canonical `ResidueClass(…)` call), which has only its
 * name. The index is rebuilt when the generation moves.
 */
export function kindTypesOfHeadName(
  ce: object,
  name: string
): ReadonlyArray<string> | undefined {
  const registry = registryOf(ce);
  let index = HEAD_NAME_INDEX.get(registry);
  if (index === undefined || index.generation !== registry.generation) {
    const byName = new Map<string, string[]>();
    for (const entry of registry.dispatch.values()) {
      const types = byName.get(entry.name) ?? [];
      for (const t of entry.kindTypes) if (!types.includes(t)) types.push(t);
      byName.set(entry.name, types);
    }
    index = { generation: registry.generation, byName };
    HEAD_NAME_INDEX.set(registry, index);
  }
  return index.byName.get(name);
}

const HEAD_NAME_INDEX = new WeakMap<
  KindRegistryState,
  { generation: number; byName: Map<string, ReadonlyArray<string>> }
>();

/** The record of the kind type `name`, or `undefined` when it is not a
 * registered kind type. The record is the registry's own: do not change it. */
export function kindTypeInfo(
  ce: ComputeEngine,
  name: string
): Readonly<KindTypeRecord> | undefined {
  return registryOf(ce).types.get(name);
}

/** The arithmetic of the bound definition `def`: its entry in the dispatch
 * part of the registry, or `undefined` when it declares no value kind. */
export function arithmeticOf(
  ce: object,
  def: BoxedOperatorDefinition
): ArithmeticDefinition | undefined {
  return registryOf(ce).dispatch.get(def)?.arithmetic;
}

/** The kind types of the bound definition `def`, or `undefined` when it
 * declares no value kind. */
export function kindTypesOfHead(
  ce: ComputeEngine,
  def: BoxedOperatorDefinition
): ReadonlyArray<string> | undefined {
  return registryOf(ce).dispatch.get(def)?.kindTypes;
}

/** True when a registered head of the kind type `name` declares the hook
 * `hook` (a kind type "has `apply`" when any of its heads declares it). */
export function kindTypeHasHook(
  ce: ComputeEngine,
  name: string,
  hook: keyof ArithmeticDefinition | keyof ArithmeticCompile
): boolean {
  const registry = registryOf(ce);
  const rec = registry.types.get(name);
  if (rec === undefined) return false;
  for (const head of rec.heads) {
    const arithmetic = registry.dispatch.get(head)?.arithmetic;
    if (arithmetic === undefined) continue;
    if (hook === 'type') {
      if (arithmetic.compile?.type !== undefined) return true;
    } else if (hook === 'value') {
      if (arithmetic.compile?.value !== undefined) return true;
    } else if (arithmetic[hook] !== undefined) return true;
  }
  return false;
}

/** The generation of the registry: it moves on every registration,
 * replacement, removal and checkpoint restore. */
export function kindGeneration(ce: object): number {
  return registryOf(ce).generation;
}

/**
 * True when a registered kind type has `admittedAs` other than `'none'`, so
 * that a value of the kind can be admitted through its carrier and a call
 * can be an apply site, AND the engine may hold a value of that type: a
 * value of the type was made, or a symbol or a callable was declared with
 * it (the gates of `noteKindValue()` and `noteKindDeclaration()`). The
 * library kind `measurement` is admitted through the carrier `number`, but
 * an engine that has made no measurement and declared nothing with the type
 * cannot have a call with a measurement operand, so the apply-site readers
 * (`apply-site.ts`) return at once there. A user kind opens its gates when
 * it is registered.
 */
export function someKindAdmittedByCarrier(ce: object): boolean {
  return gatedKindTypeAmong(ce, kindFlags(ce).carrierTypes);
}

/**
 * True when a registered kind type has a `resultType` hook and the engine
 * may hold a value of that type (the gates, as for
 * {@link someKindAdmittedByCarrier}).
 */
export function someKindHasResultType(ce: object): boolean {
  return gatedKindTypeAmong(ce, kindFlags(ce).resultTypeTypes);
}

/** True when the value gate or the declaration gate of one of the kind
 * types `types` is open in the engine. */
function gatedKindTypeAmong(ce: object, types: ReadonlyArray<string>): boolean {
  if (types.length === 0) return false;
  const registry = registryOf(ce);
  return types.some(
    (t) => registry.withValues.has(t) || registry.withDeclarations.has(t)
  );
}

/** The kind types with a carrier and with a `resultType` hook of the
 * registry of `ce`, computed again when the generation moves (a
 * registration, a removal or a checkpoint restore). */
function kindFlags(ce: object): KindFlags {
  const registry = registryOf(ce);
  let flags = KIND_FLAGS.get(registry);
  if (flags === undefined || flags.generation !== registry.generation) {
    const carrierTypes: string[] = [];
    const resultTypeTypes: string[] = [];
    for (const [name, rec] of registry.types) {
      if (rec.admittedAs !== 'none') carrierTypes.push(name);
      if (rec.resultType !== undefined) resultTypeTypes.push(name);
    }
    flags = { generation: registry.generation, carrierTypes, resultTypeTypes };
    KIND_FLAGS.set(registry, flags);
  }
  return flags;
}

type KindFlags = {
  generation: number;
  carrierTypes: ReadonlyArray<string>;
  resultTypeTypes: ReadonlyArray<string>;
};

const KIND_FLAGS = new WeakMap<KindRegistryState, KindFlags>();

//
// The per-engine gates
//

/**
 * The kind types whose value gates were withheld while the libraries of an
 * engine were loaded ({@link deferKindValueGates}), by registry. An entry
 * exists only while the libraries load.
 */
const DEFERRED_GATES = new WeakMap<KindRegistryState, Set<string>>();

/**
 * Run `load`, the loading of the libraries of the engine `ce`, with the
 * value gates of the kind types closed, and return the kind types of the
 * values that were made meanwhile.
 *
 * A library can make a kind value while it loads: the value of a physical
 * constant (`SpeedOfLight`) is a quantity. That value alone would open the
 * value and assigned gates of `quantity` in every engine, and every engine
 * would then pay the walks of the recognition (`holdsKindValue()`), also an
 * engine that never uses a quantity (about 10% of the time of an ordinary
 * evaluation, measured 2026-10-26). So the gates stay closed here, and the
 * caller makes such a value again when it is first read (the constants
 * compute their value again then, `onConfigurationChange()`), which opens
 * the value gate at that time, in the `BoxedFunction` constructor.
 */
export function deferKindValueGates(
  ce: object,
  load: () => void
): ReadonlySet<string> {
  const registry = registryOf(ce);
  const deferred = new Set<string>();
  DEFERRED_GATES.set(registry, deferred);
  try {
    load();
  } finally {
    DEFERRED_GATES.delete(registry);
  }
  return deferred;
}

/** True when the value gates of `registry` are withheld
 * ({@link deferKindValueGates}); records `typeNames` as deferred then. */
function deferredGate(
  registry: KindRegistryState,
  typeNames: Iterable<string>
): boolean {
  const deferred = DEFERRED_GATES.get(registry);
  if (deferred === undefined) return false;
  for (const t of typeNames) deferred.add(t);
  return true;
}

/** Record that the engine constructed a value of the kind type `typeName`.
 * Gates every walk that looks for a value of the kind. */
export function noteKindValue(ce: object, typeName: string): void {
  const registry = registryOf(ce);
  if (deferredGate(registry, [typeName])) return;
  registry.withValues.add(typeName);
}

/** Record that the engine constructed a value of the head `def` (the
 * `BoxedFunction` constructor calls it for a head with `arithmetic`). */
export function noteKindHeadValue(
  ce: object,
  def: BoxedOperatorDefinition
): void {
  const registry = registryOf(ce);
  const entry = registry.dispatch.get(def);
  if (entry === undefined) return;
  if (deferredGate(registry, entry.kindTypes)) return;
  for (const typeName of entry.kindTypes) registry.withValues.add(typeName);
}

/** Record that a symbol of the engine was given a value of the kind type
 * `typeName`. Gates the walk of symbol values. */
export function noteKindValueAssigned(ce: object, typeName: string): void {
  const registry = registryOf(ce);
  if (deferredGate(registry, [typeName])) return;
  registry.withValues.add(typeName);
  registry.withAssignedValues.add(typeName);
}

/** Record that a symbol or a callable of the engine was declared with a type
 * that has an arm of the kind type `typeName`. Gates the read of declared
 * symbol types. */
export function noteKindDeclaration(ce: object, typeName: string): void {
  const registry = registryOf(ce);
  registry.withValues.add(typeName);
  registry.withDeclarations.add(typeName);
}

/** The kind types whose value gate is open in the engine
 * (`noteKindValue()`). The registry's own set: do not change it. */
export function kindTypesWithValues(ce: object): ReadonlySet<string> {
  return registryOf(ce).withValues;
}

/** True when the engine may hold a value of the kind type `typeName` (of any
 * kind type when `typeName` is omitted). */
export function engineHasKindValues(ce: object, typeName?: string): boolean {
  const gate = registryOf(ce).withValues;
  return typeName === undefined ? gate.size > 0 : gate.has(typeName);
}

/** True when a symbol of the engine may hold a value of the kind type
 * `typeName` (of any kind type when `typeName` is omitted). */
export function engineHasKindValuesAssigned(
  ce: object,
  typeName?: string
): boolean {
  const gate = registryOf(ce).withAssignedValues;
  return typeName === undefined ? gate.size > 0 : gate.has(typeName);
}

/** True when a symbol or a callable of the engine was declared with an arm
 * of the kind type `typeName` (of any kind type when `typeName` is
 * omitted). */
export function engineHasKindDeclarations(
  ce: object,
  typeName?: string
): boolean {
  const gate = registryOf(ce).withDeclarations;
  return typeName === undefined ? gate.size > 0 : gate.has(typeName);
}

//
// The checkpoint model
//

/**
 * Capture the TYPE and DISPATCH parts of the registry; the returned thunk
 * puts them back and increments the generation (never rewinds it). The type
 * records are copied, because a registration changes them in place. The
 * gates are not captured: they only open, and an open gate is safe.
 *
 * Used by `takeCheckpoint()` (`checkpoint.ts`): a restore puts the registry
 * back together with the definitions it refers to, which the checkpoint
 * journal restores.
 */
export function kindRegistryRollbackPoint(ce: ComputeEngine): () => void {
  const registry = registryOf(ce);
  const copyTypes = (
    types: ReadonlyMap<string, KindTypeRecord>
  ): Map<string, KindTypeRecord> =>
    new Map(
      [...types].map(([name, rec]) => [
        name,
        { ...rec, heads: new Set(rec.heads) },
      ])
    );
  const types = copyTypes(registry.types);
  const dispatch = new Map(registry.dispatch);
  return () => {
    registry.types = copyTypes(types);
    registry.dispatch = new Map(dispatch);
    registry.generation += 1;
  };
}

/** True when `decl`, a record of the type registry of `ce`, is a registered
 * kind type. Used by the type-declaration funnel (`declareType()`). */
export function isRegisteredKindTypeRecord(
  ce: ComputeEngine,
  decl: TypeReference
): boolean {
  return registryOf(ce).types.has(decl.name);
}

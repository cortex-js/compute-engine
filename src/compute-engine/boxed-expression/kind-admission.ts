/**
 * ADMISSION of the values of a value kind: the parameters at which an
 * operator accepts an operand whose type has an arm that is a kind type
 * (`docs/plans/2026-10-26-value-kinds.md`, section 4.2).
 *
 * A kind type is disjoint from every number type, so a parameter typed with
 * a number type does not admit a kind value by subtyping. A kind value is
 * admitted at three groups of parameters:
 *
 * 1. The operands of the arithmetic operators (`Add`, `Subtract`,
 *    `Multiply`, `Negate`, `Divide`, `Power`, `Sqrt`, `Root`, `Square`)
 *    admit every kind type for which a registered head of the type declares
 *    the matching hook (`add` for `Add` and `Subtract`, `multiply`,
 *    `negate`, `divide`, and `power` for the four power operators). The
 *    rule reads the kind registry, not the signature of the operator
 *    ({@link groupOneHookOf}, {@link kindTypeNamesWithHook}).
 * 2. A parameter typed `value`, `any`, `expression`, `unknown` or with the
 *    kind type admits the value by subtyping. Nothing here is needed for it.
 * 3. A kind type that declares `admittedAs: 'real'` or `'number'` is
 *    admitted at a parameter that admits its CARRIER: the operand check
 *    replaces each kind arm of the operand type by the narrowest carrier
 *    the parameter admits (`real` when the parameter admits `real`, else
 *    `number` for a `'number'` kind), in the cells of a collection type too,
 *    and checks the result against the parameter as usual
 *    ({@link withKindCarriers}, {@link admitsThroughCarrier}). This is a
 *    rule of the operand check only: a kind type is not a subtype of
 *    `real`, inference never reads a kind value as a number, and a symbol
 *    declared `real` refuses a kind value.
 *
 * A function with a body (a function literal, a `ce.declare` with a
 * MathJSON or LaTeX body) does not use the carrier rule: its parameter
 * admits a kind value only by type (section 4.2, decision B). The callers
 * apply that condition.
 *
 * An operator is an APPLY SITE for a kind when at least one of its kind
 * operands was admitted only through the carrier (group 3), and the operator
 * is not lazy and has an `evaluate` handler ({@link isApplySite}). The
 * dispatch calls the kind's `apply` hook at an apply site (section 4.3).
 */

import type {
  BoxedOperatorDefinition,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import type { FunctionSignature, Type } from '../../common/type/types.js';
import { extendedLibraryOperator } from '../library-shadowing.js';
import { isSubtype } from '../../common/type/subtype.js';
import { paramAt } from '../../common/type/instantiate.js';
import {
  collectionElementType,
  hasKindArm,
  isKindArm,
  resolveTypeAlias,
  stripMissingFromType,
  type KindTypeNames,
} from '../../common/type/utils.js';
import {
  KIND_PRIMITIVES,
  isKindType,
  kindGeneration,
  kindTypeHasHook,
  kindTypeInfo,
} from './value-kinds.js';

//
// Group 1: the arithmetic operators
//

/** The hook that an arithmetic operator of group 1 needs from a kind. */
export type GroupOneHook = 'add' | 'multiply' | 'negate' | 'divide' | 'power';

const GROUP_ONE_HOOK: Readonly<Record<string, GroupOneHook>> = {
  Add: 'add',
  Subtract: 'add',
  Multiply: 'multiply',
  Negate: 'negate',
  Divide: 'divide',
  Power: 'power',
  Sqrt: 'power',
  Root: 'power',
  Square: 'power',
};

/** The hook that the arithmetic operator `operator` needs from a kind for
 * a value of the kind to be an operand, or `undefined` when `operator` is
 * not one of the nine arithmetic operators of group 1.
 *
 * The name alone does not select the rule: the rule belongs to the LIBRARY
 * definitions of these operators. A site that has the definition at hand
 * asks {@link groupOneHookOfDefinition} instead. */
export function groupOneHookOf(
  operator: string | undefined
): GroupOneHook | undefined {
  return operator === undefined ? undefined : GROUP_ONE_HOOK[operator];
}

/**
 * True when `def`, a definition of the operator `name`, is the definition
 * that a library installed for that name, or an extension of it that keeps
 * its handlers (`ce.declare(name, patch, { extend: true })`,
 * `extendedLibraryOperator()`).
 *
 * The rules of the value kinds that are given by the name of an operator
 * (the admission of group 1 at `Add`, `Multiply`, …, the `compare` rule of
 * `Clamp`, and the operators that are never an apply site) belong to the
 * library definitions of these names. A host that declares its own `Add`
 * (`ce.declare('Add', { signature: '(real, real) -> real', evaluate })`
 * in a nested scope) declares an ordinary operator: a `GF8` value is
 * refused at its `real` parameters as at any other operator's.
 */
export function isLibraryKindOperator(
  ce: ComputeEngine,
  name: string | undefined,
  def: BoxedOperatorDefinition | undefined
): boolean {
  if (name === undefined || def === undefined) return false;
  const binding = ce._libraryProvenance.get(name)?.binding;
  const library =
    binding !== undefined && 'operator' in binding
      ? binding.operator
      : undefined;
  if (library === undefined) return false;
  return def === library || extendedLibraryOperator(def) === library;
}

/** The hook that the operator `def` named `name` needs from a kind for a
 * value of the kind to be an operand ({@link groupOneHookOf}), when `def`
 * is the library definition of one of the nine arithmetic operators of
 * group 1 ({@link isLibraryKindOperator}); else `undefined`. */
export function groupOneHookOfDefinition(
  ce: ComputeEngine,
  name: string | undefined,
  def: BoxedOperatorDefinition | undefined
): GroupOneHook | undefined {
  const hook = groupOneHookOf(name);
  if (hook === undefined || !isLibraryKindOperator(ce, name, def))
    return undefined;
  return hook;
}

/**
 * The kind types of `ce` for which a registered head declares `hook`, as the
 * type functions that read a kind arm take them (`hasKindArm()`, …). A live
 * view: it reads the registry again when the generation of the registry
 * moves, so a hook registered later is seen by an expression boxed later.
 */
export function kindTypeNamesWithHook(
  ce: ComputeEngine,
  hook: GroupOneHook | 'compare'
): KindTypeNames {
  let views = HOOK_VIEWS.get(ce);
  if (views === undefined) {
    views = new Map();
    HOOK_VIEWS.set(ce, views);
  }
  let view = views.get(hook);
  if (view === undefined) {
    let generation = -1;
    let names = new Set<string>();
    view = {
      has: (name: string) => {
        const g = kindGeneration(ce);
        if (g !== generation) {
          generation = g;
          names = new Set();
          for (const t of ce._kindRegistry.types.keys())
            if (kindTypeHasHook(ce, t, hook)) names.add(t);
        }
        return names.has(name);
      },
    };
    views.set(hook, view);
  }
  return view;
}

const HOOK_VIEWS = new WeakMap<
  object,
  Map<GroupOneHook | 'compare', KindTypeNames>
>();

//
// Group 3: the carrier
//

/** The kind types of `ce` whose `admittedAs` is `'real'` or `'number'`, as
 * a live view (read again when the generation of the registry moves). */
export function carrierKindTypeNames(ce: ComputeEngine): KindTypeNames {
  let view = CARRIER_VIEWS.get(ce);
  if (view === undefined) {
    let generation = -1;
    let names = new Set<string>();
    view = {
      has: (name: string) => {
        const g = kindGeneration(ce);
        if (g !== generation) {
          generation = g;
          names = new Set();
          for (const [t, rec] of ce._kindRegistry.types)
            if (rec.admittedAs !== 'none') names.add(t);
        }
        return names.has(name);
      },
    };
    CARRIER_VIEWS.set(ce, view);
  }
  return view;
}

const CARRIER_VIEWS = new WeakMap<object, KindTypeNames>();

/** `t` without its absence arms (`missing`, `nothing`). */
function withoutAbsence(t: Type): Type {
  const s = stripMissingFromType(t);
  if (typeof s !== 'object' || s.kind !== 'union') return s;
  const rest = s.types.filter((x) => x !== 'nothing');
  if (rest.length === s.types.length) return s;
  if (rest.length === 0) return 'never';
  return rest.length === 1 ? rest[0] : { kind: 'union', types: rest };
}

/**
 * True when the parameter `param` admits a kind value by type, or admits
 * any value, so that the carrier rule does not apply to it: `value`, `any`,
 * `expression`, `unknown`, or a kind type, with its absence arms removed.
 */
export function isCarrierExemptParameter(
  ce: ComputeEngine,
  param: Type
): boolean {
  const p = withoutAbsence(param);
  return (
    p === 'value' ||
    p === 'any' ||
    p === 'expression' ||
    p === 'unknown' ||
    isKindType(ce, p)
  );
}

/**
 * The narrowest carrier that the parameter `param` admits for a kind
 * declared with `admittedAs`: `real` when `param` admits `real`, else
 * `number` for a `'number'` kind. The cells of a collection parameter are
 * read when the parameter itself admits neither (`list<real>` gives
 * `real`). `undefined` for a `'real'` kind at a parameter that does not
 * admit `real` (`integer`): the kind arm is then left as it is, and the
 * check refuses it.
 */
function carrierAt(
  param: Type,
  admittedAs: 'real' | 'number',
  depth = 0
): 'real' | 'number' | undefined {
  const p = withoutAbsence(param);
  if (isSubtype('real', p)) return 'real';
  if (admittedAs === 'number' && isSubtype('number', p)) return 'number';
  if (depth < 8) {
    const r = resolveTypeAlias(p);
    const arms = typeof r === 'object' && r.kind === 'union' ? r.types : [r];
    for (const arm of arms) {
      const element = collectionElementType(arm);
      if (element === undefined || element === 'any' || element === 'unknown')
        continue;
      const c = carrierAt(element, admittedAs, depth + 1);
      if (c !== undefined) return c;
    }
  }
  return admittedAs === 'number' ? 'number' : undefined;
}

/** The name of a kind arm (a primitive name or a nominal reference). */
function kindArmName(t: Readonly<Type>): string {
  return typeof t === 'string' ? t : (t as { name: string }).name;
}

/**
 * The type `t` of an operand with each arm that is a kind type declared
 * with `admittedAs: 'real'` or `'number'` replaced by its carrier at the
 * parameter `param` (the narrowest carrier `param` admits, section 4.2,
 * group 3), at every level of a union, of the cells of a collection type
 * and of the components of a tuple type. `undefined` when the carrier rule
 * does not apply: `param` is exempt ({@link isCarrierExemptParameter}), or
 * `t` has no such arm.
 *
 * `integer | umeasurement` at `real` is `integer | real`;
 * `list<umeasurement>` at `list<real>` is `list<real>`;
 * `string | umeasurement` at `real` is `string | real`, which the check then
 * refuses through its `string` arm.
 */
export function withKindCarriers(
  ce: ComputeEngine,
  t: Type,
  param: Type
): Type | undefined {
  const kinds = carrierKindTypeNames(ce);
  if (!hasKindArm(t, kinds)) return undefined;
  if (isCarrierExemptParameter(ce, param)) return undefined;
  let realCarrier: 'real' | 'number' | undefined | null = null;
  let numberCarrier: 'real' | 'number' | undefined | null = null;
  const carrierOf = (name: string): Type | undefined => {
    const admittedAs = kindTypeInfo(ce, name)?.admittedAs;
    if (admittedAs === 'real') {
      if (realCarrier === null) realCarrier = carrierAt(param, 'real');
      return realCarrier;
    }
    if (admittedAs === 'number') {
      if (numberCarrier === null) numberCarrier = carrierAt(param, 'number');
      return numberCarrier;
    }
    return undefined;
  };
  const map = (x: Readonly<Type>, depth: number): Type => {
    if (isKindArm(x, kinds)) return carrierOf(kindArmName(x)) ?? (x as Type);
    if (typeof x === 'string' || depth > 16) return x as Type;
    switch (x.kind) {
      case 'union':
        return { ...x, types: x.types.map((y) => map(y, depth + 1)) };
      case 'list':
      case 'set':
      case 'collection':
      case 'indexed_collection':
      case 'broadcastable': {
        const elements = map(x.elements, depth + 1);
        return elements === x.elements ? (x as Type) : { ...x, elements };
      }
      case 'tuple':
        return {
          ...x,
          elements: x.elements.map((e) => ({
            ...e,
            type: map(e.type, depth + 1),
          })),
        };
      case 'reference': {
        // A transparent alias is its definition.
        const r = resolveTypeAlias(x);
        return r === x ? (x as Type) : map(r, depth + 1);
      }
      default:
        return x as Type;
    }
  };
  return map(t, 0);
}

/** The cell type of `t`: the elements of its collection levels, read down
 * to a type that is not a collection. `undefined` when `t` is not a
 * collection type. */
function cellTypeOf(t: Type): Type | undefined {
  let cell = collectionElementType(t);
  if (cell === undefined) return undefined;
  for (let depth = 0; depth < 8; depth++) {
    const next = collectionElementType(cell);
    if (next === undefined) break;
    cell = next;
  }
  return cell;
}

/**
 * True when an operand of type `t` is admitted at the parameter `param`
 * through the carrier rule of group 3 (section 4.2): {@link withKindCarriers}
 * gives a type that is a subtype of `param`. With `threadable`, the
 * parameter maps over a collection operand, and the cells of the
 * substituted type are checked instead (`Sin(L)` with
 * `L: list<umeasurement>`). With `stripMissing`, the operator admits an
 * absent operand at this parameter, and the absence arms of the
 * substituted type are removed first.
 *
 * Never true at a parameter that admits the kind by type: that admission
 * is not the carrier's ({@link isCarrierExemptParameter}).
 */
export function admitsThroughCarrier(
  ce: ComputeEngine,
  t: Type,
  param: Type,
  threadable = false,
  stripMissing = false
): boolean {
  let sub = withKindCarriers(ce, t, param);
  if (sub === undefined) return false;
  if (stripMissing) sub = stripMissingFromType(sub);
  if (isSubtype(sub, param)) return true;
  if (threadable) {
    const cell = cellTypeOf(sub);
    if (cell !== undefined && isSubtype(cell, param)) return true;
  }
  return false;
}

/**
 * True when an operand of type `t` at the parameter `param` is admitted
 * ONLY through the carrier rule: the type, or with `threadable` its cells,
 * is not a subtype of the parameter, and the substituted type is.
 */
export function admittedOnlyThroughCarrier(
  ce: ComputeEngine,
  t: Type,
  param: Type,
  threadable = false
): boolean {
  if (isSubtype(t, param)) return false;
  if (threadable) {
    const cell = cellTypeOf(t);
    if (cell !== undefined && isSubtype(cell, param)) return false;
  }
  return admitsThroughCarrier(ce, t, param, threadable, true);
}

//
// Apply sites
//

/**
 * The operators that are never an apply site: they handle a kind value
 * through `compare` (the comparisons, `Max`, `Min`, `Sort`, `Clamp`),
 * through the hooks of group 1, or they hold their operands.
 */
const NEVER_APPLY_SITES = new Set([
  'Equal',
  'NotEqual',
  'Less',
  'LessEqual',
  'Greater',
  'GreaterEqual',
  'Max',
  'Min',
  'Sort',
  'Clamp',
  ...Object.keys(GROUP_ONE_HOOK),
]);

/** True when the operator `def`, named `name`, handles a kind value
 * through the hooks of the kinds (the library definitions of the
 * arithmetic operators of group 1, the comparisons, `Max`, `Min`, `Sort`,
 * `Clamp`): it is never an apply site, and its result type is given by its
 * own rules for the kinds. A host definition with one of these names is an
 * ordinary operator ({@link isLibraryKindOperator}). */
export function handlesKindsByHooks(
  ce: ComputeEngine,
  name: string | undefined,
  def: BoxedOperatorDefinition | undefined
): boolean {
  return (
    name !== undefined &&
    NEVER_APPLY_SITES.has(name) &&
    isLibraryKindOperator(ce, name, def)
  );
}

/**
 * The indices of the operands, of types `operandTypes`, that the arm
 * `arm` of the operator `def` admits ONLY through the carrier rule of
 * group 3 (section 4.2): the parameter is not `value`, `any`, `expression`,
 * `unknown` or a kind type, the operand type is not a subtype of the
 * parameter, and the type with each kind arm replaced by its carrier is.
 * Empty for a function with a body (decision B: no carrier admission) and
 * for a lazy operator's operands that are not typed.
 */
export function kindCarrierOperands(
  ce: ComputeEngine,
  def: BoxedOperatorDefinition,
  arm: Type,
  operandTypes: ReadonlyArray<Type>
): number[] {
  if (def.isUserFunctionDefinition) return [];
  if (typeof arm !== 'object' || arm.kind !== 'signature') return [];
  const kinds = carrierKindTypeNames(ce);
  const out: number[] = [];
  for (let i = 0; i < operandTypes.length; i++) {
    const t = operandTypes[i];
    if (!hasKindArm(t, kinds)) continue;
    const param = paramAt(arm as FunctionSignature, i);
    if (param === undefined) continue;
    if (admittedOnlyThroughCarrier(ce, t, param, def.broadcastable === true))
      out.push(i);
  }
  return out;
}

/**
 * True when a call of the operator `def`, resolved to the signature arm
 * `arm`, with operands of types `operandTypes`, is an APPLY SITE for a
 * kind (section 4.3): at least one kind operand was admitted only through
 * the carrier rule ({@link kindCarrierOperands}), the operator is not lazy,
 * it has an `evaluate` handler, and it is not one of the operators that
 * handle a kind value by its hooks (the arithmetic operators of group 1,
 * the comparisons, `Max`, `Min`, `Sort`, `Clamp`). A function with a body
 * is never an apply site.
 */
export function isApplySite(
  ce: ComputeEngine,
  def: BoxedOperatorDefinition,
  arm: Type,
  operandTypes: ReadonlyArray<Type>
): boolean {
  if (def.lazy || def.evaluate === undefined) return false;
  if (def.isUserFunctionDefinition) return false;
  // The name of the operator: the boxed definition carries it, the public
  // interface does not declare it.
  const name = (def as { name?: string }).name;
  if (handlesKindsByHooks(ce, name, def)) return false;
  return kindCarrierOperands(ce, def, arm, operandTypes).length > 0;
}

/**
 * True when the overload arm `arm` admits each operand, of types
 * `operandTypes`, that has a kind arm of a carrier kind BY TYPE (no operand
 * of the arm is admitted only through the carrier). An overload set prefers
 * such an arm over an arm that admits a kind operand only through the
 * carrier (section 4.2): `(real | umeasurement) -> …` is chosen over
 * `(real) -> …` for an operand typed `umeasurement`.
 */
export function armAdmitsKindsByType(
  ce: ComputeEngine,
  arm: FunctionSignature,
  operandTypes: ReadonlyArray<Type>,
  threadable: (i: number) => boolean
): boolean {
  const kinds = carrierKindTypeNames(ce);
  for (let i = 0; i < operandTypes.length; i++) {
    const t = operandTypes[i];
    if (!hasKindArm(t, kinds)) continue;
    const param = paramAt(arm, i);
    if (param === undefined) continue;
    if (admittedOnlyThroughCarrier(ce, t, param, threadable(i))) return false;
  }
  return true;
}

/** True when an operand of type `t` has an arm of a kind type of `ce` that
 * declares `admittedAs: 'real'` or `'number'`. */
export function hasCarrierKindArm(ce: ComputeEngine, t: Type): boolean {
  return hasKindArm(t, carrierKindTypeNames(ce));
}

/**
 * The type of the arithmetic operator `name` of group 1 (`Add`, `Multiply`,
 * `Negate`, …) used as a FUNCTION VALUE (`Reduce(L, Multiply)`,
 * `Map(Negate, L)`), for the check of a callback slot: its signature
 * `signature` with each parameter widened by the kind types for which a
 * registered head declares the matching hook. A callback slot that supplies
 * a kind value (`(unknown, residue) -> unknown`) then admits the operator,
 * as its operand check does (section 4.2): the library signature names no
 * kind type. `signature` itself when `name` is not of group 1 or no kind
 * type declares the hook.
 *
 * Any other operator that can be an APPLY SITE (not lazy, with an
 * `evaluate` handler, not a function with a body, not an operator that
 * handles a kind through its hooks) admits a kind value as its operand
 * check does too: through the carrier of the kind (group 3). Each
 * parameter that admits the carrier of a kind declared with
 * `admittedAs: 'real'` or `'number'` (`admitsThroughCarrier()`) is widened
 * by that kind type, so that `Map(Sin, [U1, U2])` admits `Sin` as
 * `Sin(U1)` does. A kind declared with `admittedAs: 'none'` is never
 * added: `Map(Sin, [GF8(1)])` is refused.
 */
export function groupOneCallbackType(
  ce: ComputeEngine,
  name: string,
  signature: Type,
  def: BoxedOperatorDefinition | undefined
): Type {
  if (typeof signature !== 'object' || signature.kind !== 'signature')
    return signature;
  const hook = groupOneHookOfDefinition(ce, name, def);
  if (hook === undefined) return carrierCallbackType(ce, name, signature, def);
  const kinds: Type[] = [];
  for (const t of ce._kindRegistry.types.keys())
    if (kindTypeHasHook(ce, t, hook))
      kinds.push(KIND_PRIMITIVES.includes(t) ? (t as Type) : ceTypeOf(ce, t));
  if (kinds.length === 0) return signature;
  return widenParameters(signature, (p) => ({
    kind: 'union',
    types: [p, ...kinds],
  }));
}

/**
 * The signature `signature` of the operator `def`, named `name`, used as a
 * function value, with each parameter widened by the kind types whose
 * values the parameter admits through their carrier
 * ({@link groupOneCallbackType}). `signature` itself when the operator
 * cannot be an apply site or no parameter admits a carrier.
 */
function carrierCallbackType(
  ce: ComputeEngine,
  name: string,
  signature: FunctionSignature,
  def: BoxedOperatorDefinition | undefined
): Type {
  if (def === undefined) return signature;
  // The library `Exp` has no `evaluate` handler: its canonical form is
  // `Power(ExponentialE, x)`, and its operand check admits the value of a
  // kind through its carrier only when the kind declares a `power` hook
  // (`canonicalNumericOperator()`, `canonical-numeric.ts`).
  const libraryExp = name === 'Exp' && isLibraryKindOperator(ce, name, def);
  if (!libraryExp && (def.lazy || def.evaluate === undefined)) return signature;
  if (def.isUserFunctionDefinition) return signature;
  if (handlesKindsByHooks(ce, name, def)) return signature;
  const kinds: Type[] = [];
  for (const [t, rec] of ce._kindRegistry.types)
    if (
      rec.admittedAs !== 'none' &&
      (!libraryExp || kindTypeHasHook(ce, t, 'power'))
    )
      kinds.push(KIND_PRIMITIVES.includes(t) ? (t as Type) : ceTypeOf(ce, t));
  if (kinds.length === 0) return signature;
  return widenParameters(signature, (p) => {
    const admitted = kinds.filter((k) => admitsThroughCarrier(ce, k, p));
    return admitted.length === 0
      ? p
      : { kind: 'union', types: [p, ...admitted] };
  });
}

/** `signature` with the type of each parameter `p` replaced by
 * `widen(p)`. */
function widenParameters(
  signature: FunctionSignature,
  widen: (p: Type) => Type
): FunctionSignature {
  return {
    ...signature,
    args: signature.args?.map((a) => ({ ...a, type: widen(a.type) })),
    optArgs: signature.optArgs?.map((a) => ({ ...a, type: widen(a.type) })),
    variadicArg:
      signature.variadicArg === undefined
        ? undefined
        : { ...signature.variadicArg, type: widen(signature.variadicArg.type) },
  };
}

/** The type named `name` in `ce`: a kind primitive is its name, a nominal
 * kind type is a reference to its record. */
function ceTypeOf(ce: ComputeEngine, name: string): Type {
  return ce.type(name).type;
}

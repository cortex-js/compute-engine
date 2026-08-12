import type {
  FunctionSignature,
  NamedElement,
  RecordType,
  Type,
  TypeParameter,
  TypeReference,
} from '../common/type/types.js';
import { isSubtype, provablyDisjoint } from '../common/type/subtype.js';
import { CACHE_STATS, bumpShadowCallable } from '../common/cache-stats.js';
import { groundSkeleton } from '../common/type/instantiate.js';
import { applyTypeReference, declarationOf } from '../common/type/reference.js';
import { subtypingVarianceOf } from '../common/type/variance.js';

import type {
  BoxedDefinition,
  Expression,
  IComputeEngine,
  OperatorDefinition,
  Scope,
} from './global-types.js';

import { isDictionary, isFunction } from './boxed-expression/type-guards.js';
import { updateDef, defIsCallableShaped } from './boxed-expression/utils.js';
import { functionLiteralParameters } from './boxed-expression/function-literal.js';
import { apply } from './function-utils.js';

/**
 * Value constructors minted by a type declaration
 * (`docs/plans/2026-08-01-nominal-types-design.md`, §4.1/§4.1b/§4.1c, D4/D4b/
 * D5/D10).
 *
 * Declaring a type claims BOTH namespaces: the type record in the engine's
 * type registry (`ce._typeRegistry` — engine-level, not scoped), and a
 * value-level operator of the same name in `scope.bindings`. The operator
 * is what makes a nominal type inhabitable — `point(1, 2)` canonicalizes to,
 * and stays, the inert tagged application `["point", 1, 2]` whose `.type` is
 * the nominal reference. For a structural alias the same signature is minted
 * but the application is an *identity* (a checked cast): `pt(1, 2)` evaluates
 * to the plain tuple `(1, 2)`.
 *
 * Nothing here reaches into the library: registration goes through
 * `ce.declare()`, so this module depends only on the type layer and the engine
 * interface (zero-cycle budget).
 */

/** Marker set on a minted constructor's boxed operator definition. Only a
 * definition carrying it is ever removed by a statement re-run or by a
 * rollback — a user's own function of the same name is never touched.
 *
 * It lives on the INNER definition object (not the `BoxedDefinition` record),
 * which `updateDef()` replaces wholesale: assigning something else to the name
 * therefore drops the marker, and the binding stops being ours. */
const MINTED = '_mintedTypeConstructor';

interface MintedMarker {
  [MINTED]?: 'nominal' | 'alias' | 'constructor';
}

/** Does this scope's binding for `name` hold a constructor WE minted?
 *
 * Exported for the assignment guard in `assignFn()`: replacing a minted
 * constructor with a value (or another operator) drops the marker and leaves
 * the type half of the declaration resolving with nothing able to build a
 * value of it — the two namespaces a type declaration claims (D5) would
 * silently desynchronize. */
export function isMintedConstructor(def: BoxedDefinition | undefined): boolean {
  if (def === undefined || !('operator' in def)) return false;
  return (def.operator as unknown as MintedMarker)[MINTED] !== undefined;
}

/** Is `expr` a NOMINAL tagged value — an application of a minted nominal
 * constructor (auto-minted, or a user constructor function)? Used by the
 * constructors' `eq` handler (D9). */
function isNominalTaggedValue(expr: Expression): boolean {
  const def = expr.operatorDefinition;
  if (def === undefined) return false;
  const m = (def as unknown as MintedMarker)[MINTED];
  return m === 'nominal' || m === 'constructor';
}

/** D9 equality — constructor injectivity, shared by the auto-minted nominal
 * constructor and user constructor functions (§4.5b).
 *
 * The general equality machinery correctly leaves `foo(1, 2) == bar(1, 2)`
 * symbolic for arbitrary operators (they might agree pointwise). What it
 * cannot know is that a minted constructor is INJECTIVE — the tagged value
 * *is* its tag plus its operands, with no evaluation in between. So:
 * different tags are different values, and equal tags compare operand-wise.
 * Fires ONLY when both sides are minted nominal applications and defers
 * (`undefined`) otherwise, so nothing else in the equality story changes. */
function constructorEq(a: Expression, b: Expression): boolean | undefined {
  if (!isNominalTaggedValue(b)) return undefined;
  if (b.operator !== a.operator) return false;
  if (!isFunction(a) || !isFunction(b)) return undefined;
  const aOps = a.ops;
  const bOps = b.ops;
  if (aOps.length !== bOps.length) return false;
  let decided = true;
  for (let i = 0; i < aOps.length; i++) {
    const cmp = aOps[i].isEqual(bOps[i]);
    if (cmp === false) return false;
    if (cmp === undefined) decided = false;
  }
  return decided ? true : undefined;
}

/**
 * D5, atomicity half 1: does the current scope already bind `name` to
 * something a type declaration may not claim?
 *
 * Throws (before ANY mutation, so the registration is all-or-nothing) when the
 * scope has an explicit value/operator binding of that name. A binding that is
 * merely *inferred* (auto-declared from usage, no value) upgrades, mirroring
 * `ce.declare()`; a previously minted constructor is ours to replace; an outer
 * scope's binding is shadowed, not conflicted (only `scope.bindings` is
 * consulted, never the parent chain).
 */
export function checkTypeConstructorNamespace(
  scope: Scope,
  name: string,
  context: 'declare-type' | 'constructor-function' = 'declare-type'
): void {
  const existing = scope.bindings.get(name);
  if (existing === undefined) return;
  if (isMintedConstructor(existing)) return;

  // Mirrors the upgrade rule in `declareFn()` / the `Declare` handler: only a
  // value-LESS inferred binding is upgradable. The operator half is narrower
  // than `declareFn()`'s: an operator whose signature was merely *inferred*
  // may still be a real definition (an Epsil `function point(x) {…}` is an
  // operator def with an inferred signature and a body), and that is a genuine
  // collision. Only a handler-less shell — an auto-declaration from usage, or
  // a host `{signature, inferredSignature: true}` vouch — upgrades.
  const inferred =
    ('value' in existing &&
      existing.value.inferredType &&
      existing.value.value === undefined) ||
    ('operator' in existing &&
      existing.operator.inferredSignature &&
      existing.operator.evaluate === undefined &&
      existing.operator.canonical === undefined);
  if (inferred) return;

  throw Error(
    context === 'declare-type'
      ? `The symbol "${name}" is already declared in the current scope: a type declaration also declares a value constructor of the same name`
      : `The symbol "${name}" is already declared in the current scope: a function sharing a nominal type's name is its constructor, and cannot replace an existing binding`
  );
}

/** Remove a previously minted constructor for `name` from `scope`, if any.
 * A binding that is not ours is left alone. */
function removeMintedTypeConstructor(
  ce: IComputeEngine,
  scope: Scope,
  name: string
): void {
  if (!isMintedConstructor(scope.bindings.get(name))) return;
  scope.bindings.delete(name);
  // Removing a binding is a context change: invalidate the caches keyed on
  // the generation (a re-mint bumps it again through `ce.declare()`, but the
  // remove-only path — a body edited from a tuple to a record — would not).
  ce._noteStateEvent({ kind: 'binding-repair' });
  // Shadow 'callable' axis (CE_CACHE_STATS probe): a constructor (callable)
  // binding was removed — binding-repair event.
  if (CACHE_STATS) bumpShadowCallable();
}

/**
 * D4/D4b: the constructor signature derived from a type's definition body.
 *
 * - `tuple` body → n-ary, one parameter per slot; named slots become named
 *   parameters (`point: (x: number, y: number) -> point`).
 * - `record` body → `undefined`: record bodies auto-mint NOTHING (D4b). Their
 *   inhabitation story is user-defined constructor functions (§4.5, v2); the
 *   Epsil `type-not-callable` lint covers call sites meanwhile.
 * - a NAMED-field tuple body of an ALIAS → `undefined` too, for the same
 *   reason: the identity constructor returns a plain `Tuple`, whose
 *   synthesized type has UNNAMED elements, and the subtype rules reject that
 *   against the named-tuple alias. A checked identity constructor whose result
 *   fails its own type is worse than no constructor, so mint nothing (a
 *   NOMINAL named-tuple is unaffected: its value is tagged and its type comes
 *   from the `type` handler).
 * - a GENERIC type alias (`type alias Pair<T> = tuple<T, T>`) → `undefined`
 *   too. There is no one signature to mint: the body is open, and a
 *   constructor built from it would carry unquantified type variables — which
 *   `BoxedType`'s closedness check rejects, aborting the whole declaration.
 *   Generic aliases claim no value name, following the mint-nothing precedent
 *   of record-bodied aliases. (A plain-alias → generic-alias redeclaration
 *   still DROPS a previously minted constructor: `mintTypeConstructor` removes
 *   it before consulting this.)
 * - a parameterized NOMINAL type (`type tree<T> = tuple<value: T, …>`) → the
 *   same signature, `forall`-QUANTIFIED by the type's clause
 *   (`forall T. (T, list<tree<T>>) -> tree<T>`, parameterized-nominal design
 *   §5). The rank-1 call-site solver instantiates `T` per construction. The
 *   open body is legal here for exactly the reason it is not for an alias: the
 *   clause closes it.
 * - anything else (scalar, list, dictionary, union, signature, reference…) →
 *   unary.
 *
 * Built STRUCTURALLY, never through a type string: the body and the result may
 * name user-declared types that a resolver-less `parseType()` cannot read back.
 */
function deriveConstructorSignature(
  body: Type,
  result: Type,
  alias: boolean,
  typeParams: TypeParameter[] | undefined
): FunctionSignature | undefined {
  if (typeParams !== undefined && alias) return undefined;
  const close = (sig: FunctionSignature): FunctionSignature =>
    typeParams === undefined ? sig : { ...sig, typeParams };
  if (body === 'record') return undefined;
  if (typeof body === 'object') {
    if (body.kind === 'record') return undefined;
    if (body.kind === 'tuple') {
      if (alias && body.elements.some((x) => x.name !== undefined))
        return undefined;
      const args: NamedElement[] = body.elements.map((x) =>
        x.name === undefined ? { type: x.type } : { name: x.name, type: x.type }
      );
      return close({ kind: 'signature', args, result });
    }
  }
  return close({ kind: 'signature', args: [{ type: body }], result });
}

/** The result type of a nominal constructor: the reference itself, or — for a
 * parameterized nominal — the reference APPLIED to its own parameters
 * (`tree<T>`), which is what the solver instantiates. Never the bare `tree`,
 * which is an arity error at every use. */
function appliedNominalResult(ref: TypeReference): Type {
  const typeParams = ref.typeParams;
  if (typeParams === undefined) return ref;
  return applyTypeReference(
    ref,
    typeParams.map((p) => ({ kind: 'variable', name: p.name }) as Type)
  );
}

/**
 * Declare the value-level constructor for the type `name` just registered in
 * `scope` (§4.1). Idempotent with respect to a previously minted constructor
 * for the same name, which it removes first (statement re-run, D5).
 *
 * `ref` is the type record in the engine registry — the same mutable object the
 * resolver hands out, so the constructor's result type stays the nominal
 * reference even as its `def` is patched.
 *
 * Throws if the constructor cannot be declared; the caller rolls back the type
 * half so the registration stays atomic.
 */
export function mintTypeConstructor(
  ce: IComputeEngine,
  scope: Scope,
  name: string,
  ref: TypeReference,
  body: Type
): void {
  // A re-registration replaces both halves together: drop the previous minted
  // constructor even when the new body mints none (e.g. a body edited from a
  // tuple to a record).
  removeMintedTypeConstructor(ce, scope, name);

  // A nominal constructor's result is the nominal reference — this is the
  // single source of nominal-ness. An alias constructor is an identity: it
  // checks its operands and returns the plain structural value, so its result
  // is the definition body (D10).
  const alias = ref.alias === true;
  const typeParams = ref.typeParams;
  const signature = deriveConstructorSignature(
    body,
    alias ? body : appliedNominalResult(ref),
    alias,
    typeParams
  );
  // D4b: record bodies — named-field tuple bodies of an alias, and generic
  // aliases — mint nothing.
  if (signature === undefined) return;

  const nAry = typeof body === 'object' && body.kind === 'tuple';

  const def: OperatorDefinition = {
    description: alias
      ? `Checked identity constructor for the type alias \`${name}\``
      : `Constructor for the type \`${name}\``,
    // Construction neither reads nor writes anything: an empty effects slot.
    pure: true,
    // A pure container: it STORES its operands, and no position ever invokes a
    // function-valued one. (Same reading as `Tuple`/`KeyValuePair`.)
    invokes: false,
    lazy: false,
    complexity: 9000,
    signature,
    // Redundant with the signature's result, but explicit: the `type` handler
    // is where nominal-ness is answered from.
    //
    // A PARAMETERIZED nominal mints none: `def.type` runs AFTER the polytype
    // instantiation and OVERWRITES its result, so a handler returning the
    // declaration record would type every `tree(1, [])` as the bare `tree` and
    // discard the solve.
    ...(typeParams === undefined ? { type: () => (alias ? body : ref) } : {}),
  };

  if (alias) {
    // The identity: `pt(1, 2)` → the plain tuple `(1, 2)`; a unary body
    // returns the checked operand itself. Operands arrive evaluated
    // (`lazy: false`), and an invalid application never reaches here.
    def.evaluate = nAry
      ? (ops, { engine }) => engine.function('Tuple', ops)
      : (ops) => ops[0] as Expression | undefined;
  } else {
    // A nominal constructor has NO `evaluate` handler: the default path
    // evaluates the operands and rebuilds the application, which is exactly
    // the inert tagged value (the `Tuple` idiom).
    //
    // D9 says equality is "structural over the tag, no `eq` handler minted".
    // The general path does answer `point(1, 2) == point(1, 2)` (True, via
    // `isSame`) and `point(1, 2) == (1, 2)` (False). It does NOT answer
    // `polar(1, 2) == point(1, 2)` (the `False` D9 pins) nor
    // `point(1, 2) == point(1, 3)`: two applications of opaque operators are
    // undecidable in general (`foo(1, 2) == bar(1, 3)` is likewise left
    // symbolic — `foo` and `bar` might agree pointwise), so both stay
    // symbolic.
    //
    // The fact the general machinery cannot know is that a minted constructor
    // is INJECTIVE — see `constructorEq`, shared with user constructor
    // functions (§4.5b).
    def.eq = constructorEq;
  }

  // §4.6 / D11: compilation is type erasure. A constructor application compiles
  // exactly where the equivalent plain value compiles, to the same emission —
  // no more, no less. Unary (scalar/list/… bodies): the compiled operand
  // itself, zero cost. N-ary (tuple bodies): whatever the SAME-target `Tuple`
  // construction emits (JS pair, GLSL/WGSL `vecN`), by lowering an actual
  // `Tuple` node through the caller's `compile` callback — so a target/position
  // where `Tuple` fails closed declines identically, with that path's own
  // diagnostic. Both kinds erase: an alias identity constructor can appear
  // un-evaluated inside a compiled expression too.
  def.compile = (args, compile) => {
    if (args.length === 0) return undefined;
    if (!nAry) return args.length === 1 ? compile(args[0]) : undefined;
    return compile(args[0].engine.function('Tuple', args as Expression[]));
  };

  ce.declare(name, def);

  const binding = scope.bindings.get(name);
  if (binding !== undefined && 'operator' in binding)
    (binding.operator as unknown as MintedMarker)[MINTED] = alias
      ? 'alias'
      : 'nominal';
}

//
// ─── User constructor functions (§4.5 / §4.5b, D12–D15) ────────────────────
//

/** The automatic raw-injection arm (D12/D14): one application shape whose
 * operands already ARE the payload, checked and tagged with the user body
 * skipped. A tuple body spreads inline (n-ary — identical to the v1 auto-mint
 * signature); every other body, record included, is unary. */
function rawInjectionSignature(body: Type, result: Type): FunctionSignature {
  if (typeof body === 'object' && body.kind === 'tuple') {
    const args: NamedElement[] = body.elements.map((x) =>
      x.name === undefined ? { type: x.type } : { name: x.name, type: x.type }
    );
    return { kind: 'signature', args, result };
  }
  return { kind: 'signature', args: [{ type: body }], result };
}

/** The parameter type a signature accepts at position `i`, or `undefined`
 * past its maximal arity. */
function paramTypeAt(sig: FunctionSignature, i: number): Type | undefined {
  const req = sig.args ?? [];
  if (i < req.length) return req[i].type;
  const opt = sig.optArgs ?? [];
  if (i < req.length + opt.length) return opt[i - req.length].type;
  return sig.variadicArg?.type;
}

/** D14a — can a call ever inhabit both the user arm and the raw-injection
 * arm? Overlap = the raw arm's arity is admissible for the user arm AND no
 * common position is provably disjoint. Undecidable (an unannotated user
 * parameter types `unknown`) counts as overlap: reject, loudly.
 *
 * BOTH sides must be GROUND. `raw` already is (the caller grounds the body),
 * and the user arm is grounded here: a QUANTIFIED user arm (§5 —
 * `forall U. (x: U) -> pack<U>`) otherwise walks its own `U` into
 * `provablyDisjoint`, breaking the ground-inputs contract that only a
 * stripped-in-production `console.assert` guards. Each parameter is grounded
 * COVARIANTLY, as the domain it is: the position asks "which values could
 * reach here", so an open `U` reads `any` — undecidable, hence overlap — and
 * not the `never` a whole-signature grounding would put there (which is
 * disjoint from everything and would silently clear every generic user arm). */
function overlapsRawArm(user: Type, raw: FunctionSignature): boolean {
  if (typeof user !== 'object' || user.kind !== 'signature') return true;
  const rawArity = (raw.args ?? []).length;
  const req = (user.args ?? []).length;
  const max =
    user.variadicArg !== undefined
      ? Infinity
      : req + (user.optArgs ?? []).length;
  if (rawArity < req || rawArity > max) return false;
  for (let i = 0; i < rawArity; i++) {
    const p = paramTypeAt(user, i);
    const u = p === undefined ? undefined : groundSkeleton(p);
    const r = raw.args![i].type;
    if (u !== undefined && provablyDisjoint(u, r)) return false;
  }
  return true;
}

/**
 * MEMBERSHIP at an applied reference the §4.3 subtype rule reads INVARIANTLY —
 * an explicit `inout` parameter, or a declaration whose variance is not
 * verified yet (ruling C reads those as `inout` too).
 *
 * Such a position is inhabited by no OTHER application: `cell<integer> <:
 * cell<any>` is false under invariance. But `cell<any>` is what grounding
 * `cell<T>` produces, and that reading has to stay — it is the DISJOINTNESS
 * contract (§5: never derive disjointness from the type variable), which
 * `provablyDisjoint` and the D14a overlap check above depend on. Reading it as
 * a membership domain instead would make an `inout` (or still-deferred)
 * nominal impossible to use as a constructor argument of another
 * parameterized nominal — the payload would never be judged to inhabit the
 * body, and the construction would stay inert forever.
 *
 * So the two contracts split HERE, at the membership walk: any application of
 * the SAME declaration record inhabits the position, and the arguments are
 * decided where they can be — by the static gate, which sees the OPEN
 * parameter, solves it, and re-checks the operand against the INSTANTIATED
 * one. A non-application still falls through to the ordinary disjointness
 * test, so `w(5)` is refuted exactly as before.
 */
function admitsApplication(t: Type, target: Type): boolean {
  if (typeof target !== 'object' || target.kind !== 'reference') return false;
  const targetArgs = target.args;
  if (targetArgs === undefined) return false;
  if (!targetArgs.some((_, i) => subtypingVarianceOf(target, i) === 'inout'))
    return false;
  if (typeof t !== 'object' || t.kind !== 'reference') return false;
  if (t.name !== target.name || t.args?.length !== targetArgs.length)
    return false;
  return declarationOf(t) === declarationOf(target);
}

/** Tri-state value-membership verdict: does this VALUE inhabit the type?
 * `'maybe'` = undecidable from what is known (symbolic/unknown-typed operand)
 * — the caller stays inert rather than guessing. */
type Inhabits = 'yes' | 'no' | 'maybe';

function staticInhabits(t: Type, target: Type): Inhabits {
  if (t === 'unknown' || t === 'any') return 'maybe';
  if (isSubtype(t, target)) return 'yes';
  if (admitsApplication(t, target)) return 'yes';
  return provablyDisjoint(t, target) ? 'no' : 'maybe';
}

/** D14b — record payloads are checked value-shape-aware with an EXACT key
 * set: record subtyping is width-based (extra lhs keys pass), and a
 * dictionary literal with exotic keys synthesizes `dictionary<V>` with no
 * key names at all, so a pure type-level check either over-admits or cannot
 * decide. The actual keys are compared against the definition's field map;
 * the field TYPES go through the ordinary subtype relation. */
function recordInhabits(expr: Expression, target: RecordType): Inhabits {
  const fields = target.elements;
  const fieldCount = Object.keys(fields).length;

  if (isDictionary(expr)) {
    const keys = expr.keys;
    if (keys.length !== fieldCount) return 'no';
    let result: Inhabits = 'yes';
    for (const k of keys) {
      const ft = fields[k];
      if (ft === undefined) return 'no';
      const r = staticInhabits(expr.get(k)!.type.type, ft);
      if (r === 'no') return 'no';
      if (r === 'maybe') result = 'maybe';
    }
    return result;
  }

  // Not a dictionary VALUE — judge by static type. A record STATIC type has
  // an exact key set by definition, so the key comparison stays exact.
  const t = expr.type.type;
  if (typeof t === 'object' && t.kind === 'record') {
    const keys = Object.keys(t.elements);
    if (keys.length !== fieldCount) return 'no';
    let result: Inhabits = 'yes';
    for (const k of keys) {
      const ft = fields[k];
      if (ft === undefined) return 'no';
      const r = staticInhabits(t.elements[k], ft);
      if (r === 'no') return 'no';
      if (r === 'maybe') result = 'maybe';
    }
    return result;
  }
  if (t === 'unknown' || t === 'any') return 'maybe';
  return provablyDisjoint(t, target) ? 'no' : 'maybe';
}

/** Tuple bodies check POSITIONALLY, ignoring field names: a tuple's field
 * order is its semantics and the names are labels (D4) — the user body
 * naturally returns an UNNAMED tuple (`(r * Cos(theta), r * Sin(theta))`),
 * and the named-tuple subtype rule would reject it. */
function tupleInhabits(
  expr: Expression,
  elements: ReadonlyArray<NamedElement>
): Inhabits {
  let elementTypes: ReadonlyArray<Type> | undefined = undefined;
  if (isFunction(expr, 'Tuple'))
    elementTypes = expr.ops.map((op) => op.type.type);
  else {
    const t = expr.type.type;
    if (typeof t === 'object' && t.kind === 'tuple')
      elementTypes = t.elements.map((x) => x.type);
    else if (t === 'unknown' || t === 'any') return 'maybe';
    else
      return provablyDisjoint(t, { kind: 'tuple', elements: [...elements] })
        ? 'no'
        : 'maybe';
  }
  if (elementTypes.length !== elements.length) return 'no';
  let result: Inhabits = 'yes';
  for (let i = 0; i < elements.length; i++) {
    const r = staticInhabits(elementTypes[i], elements[i].type);
    if (r === 'no') return 'no';
    if (r === 'maybe') result = 'maybe';
  }
  return result;
}

function valueInhabits(expr: Expression, target: Type): Inhabits {
  if (typeof target === 'object') {
    if (target.kind === 'record') return recordInhabits(expr, target);
    if (target.kind === 'tuple') return tupleInhabits(expr, target.elements);
  }
  return staticInhabits(expr.type.type, target);
}

/** Do these operands inhabit the raw-injection arm? Per-position
 * value-membership; any `'no'` refutes, any `'maybe'` leaves the verdict
 * undecided. */
function rawArmMatch(
  ops: ReadonlyArray<Expression>,
  raw: FunctionSignature
): Inhabits {
  const args = raw.args ?? [];
  if (ops.length !== args.length) return 'no';
  let result: Inhabits = 'yes';
  for (let i = 0; i < args.length; i++) {
    const r = valueInhabits(ops[i], args[i].type);
    if (r === 'no') return 'no';
    if (r === 'maybe') result = 'maybe';
  }
  return result;
}

/**
 * §4.5b D13/D15 — loosen a minted constructor's signature to the wide
 * `'function'` for the duration of a constructor-function literal's
 * canonicalization, returning a restore thunk (or `undefined` when the
 * binding is not a minted constructor).
 *
 * Why: a constructor-function body may reference the constructor itself
 * (`function pt(k, flag) { if (k < 0) { pt(-k, flag) } else { … } }`). The
 * literal canonicalizes BEFORE the overload set can be derived from it, so
 * without this the self-call validates against the STRICT auto-minted
 * signature and bakes an `incompatible-type` error into the body. The wide
 * signature makes the self-call validate loosely — exactly how a plain
 * function's declare-then-assign knot behaves — and the real overload
 * signature takes over at install.
 */
export function loosenMintedConstructor(
  ce: IComputeEngine,
  scope: Scope,
  name: string
): (() => void) | undefined {
  const binding = scope.bindings.get(name);
  if (
    binding === undefined ||
    !('operator' in binding) ||
    !isMintedConstructor(binding)
  )
    return undefined;
  const saved = binding.operator;
  updateDef(ce, name, binding, { signature: 'function' });
  return () => {
    (binding as { operator: unknown }).operator = saved;
  };
}

/**
 * Install a user CONSTRUCTOR FUNCTION for the nominal type `name` (§4.5,
 * D12–D15): a function literal assigned to a name the current scope declares
 * as a nominal type. The minted operator becomes an overload set — the user
 * arm (the literal, whose body computes the *payload*) plus the automatic
 * raw-injection arm — and applications yield the payload-tagged value
 * `["name", ⟨payload⟩]` whose `.type` is the nominal reference.
 *
 * Throws (D14a) when the user arm's domain overlaps the raw-injection arm's:
 * the raw arm must win on its own domain or the D12 round-trip breaks, and a
 * silently shadowed user arm would be a validation bypass.
 *
 * The caller has already verified eligibility (same-scope nominal type;
 * namespace check passed).
 */
export function installConstructorFunction(
  ce: IComputeEngine,
  scope: Scope,
  name: string,
  ref: TypeReference,
  literal: Expression
): void {
  const body = ref.def;
  if (body === undefined) throw Error(`The type "${name}" is not defined`);

  const typeParams = ref.typeParams;
  const generic = typeParams !== undefined;

  // §5 — a parameterized nominal's body is OPEN, and `provablyDisjoint` (via
  // `overlapsRawArm`) plus every value-membership check below require GROUND
  // inputs. That requirement is guarded only by a `console.assert`, stripped in
  // the production build, and the assert catches a TOP-LEVEL bare variable
  // only — a nested `T` would sail through and decide overlap or inhabitation
  // from a variable. So the CHECKS run against the body's ground skeleton,
  // while the declared signature keeps the open body under the type's clause.
  const checkBody = generic ? groundSkeleton(body) : body;

  // The nominal result is the APPLIED reference (`tree<T>`) for a
  // parameterized type; `ref` itself otherwise.
  const result = appliedNominalResult(ref);
  const raw: FunctionSignature = generic
    ? { ...rawInjectionSignature(body, result), typeParams }
    : rawInjectionSignature(body, result);
  /** The raw arm read as a GROUND domain — the only form the overlap check and
   * the runtime membership checks may see. */
  const rawCheck = generic
    ? rawInjectionSignature(checkBody, groundSkeleton(result))
    : raw;

  // The user arm: the literal's (inferred or annotated) signature, with the
  // result replaced by the nominal reference — the constructor returns the
  // TAGGED value, not the bare payload the body computes. The arm's effects
  // specifier is dropped: it is inference-produced here, and the definition
  // carries the effects axis itself (below), so keeping it on the arm would
  // read as an author-stated contract.
  //
  // For a PARAMETERIZED nominal the result is an APPLICATION, and the
  // function's type-parameter clause is its own (§5): the names are
  // alpha-irrelevant and the type's clause is not in scope inside the
  // function, so nothing here may instantiate the application on the author's
  // behalf. The contract runs through the literal's DECLARED result, which is
  // kept verbatim when it already applies the nominal; without one there is
  // nothing to instantiate with and the ground application is the honest
  // answer.
  const litSig = literal.type.type;
  const nominalResult = (sig: FunctionSignature | undefined): Type => {
    if (!generic) return result;
    const declared = sig?.result;
    if (
      typeof declared === 'object' &&
      declared.kind === 'reference' &&
      declared.name === name
    )
      return declared;
    return groundSkeleton(result);
  };
  let userArm: FunctionSignature;
  if (typeof litSig === 'object' && litSig.kind === 'signature') {
    userArm = { ...litSig, result: nominalResult(litSig) };
    delete userArm.effects;
  } else {
    userArm = {
      kind: 'signature',
      variadicArg: { type: 'any' },
      variadicMin: 0,
      result: nominalResult(undefined),
    };
  }

  if (overlapsRawArm(userArm, rawCheck))
    throw Error(
      `The constructor function "${name}" overlaps the type's raw-injection constructor: a value that already satisfies the definition "${name}" must construct unchanged, so a constructor parameterization must be distinguishable from the payload itself. Use a different arity, or annotate the parameters with types disjoint from the definition body.`
    );

  const nAryRaw = typeof body === 'object' && body.kind === 'tuple';

  // Effects flow honestly (§4.5): the constructor's effects are the body's.
  const effects =
    typeof litSig === 'object' && litSig.kind === 'signature'
      ? litSig.effects
      : undefined;

  const def: OperatorDefinition = {
    description: `Constructor function for the type \`${name}\``,
    ...(effects !== undefined && (effects === 'any' || effects.length > 0)
      ? { effects }
      : { pure: true }),
    invokes: false,
    lazy: false,
    complexity: 9000,
    signature: { kind: 'intersection', types: [userArm, raw] },
    // The single source of nominal-ness (§4.1). A PARAMETERIZED nominal mints
    // no handler: `def.type` runs AFTER the resolved arm's instantiation and
    // would overwrite `tree<integer>` with the bare `tree`.
    ...(generic ? {} : { type: () => ref }),
    eq: constructorEq,
    evaluate: (ops, options) => {
      // Raw injection first (D14a): operands that already form the payload
      // tag directly — returning `undefined` leaves the application as the
      // inert tagged value. An undecided verdict (symbolic operands) also
      // stays inert: running the body on a possibly-raw payload would break
      // the D12 round-trip.
      const rawVerdict = rawArmMatch(ops, rawCheck);
      if (rawVerdict !== 'no') return undefined;

      // User arm. Arity outside the user arm (statically rejected already;
      // reachable when a width-subtyped payload passed the static gate but
      // failed the exact-key runtime check): report against the body.
      const req = (userArm.args ?? []).length;
      const max =
        userArm.variadicArg !== undefined
          ? Infinity
          : req + (userArm.optArgs ?? []).length;
      if (ops.length < req || ops.length > max) {
        const engine = ops[0]?.engine ?? ce;
        return ops.length === 1
          ? engine.typeError(checkBody, ops[0].type, ops[0])
          : undefined;
      }

      // The operands must inhabit the USER arm's domain before its body runs
      // — arity alone is not admission. Reachable when the static resolver
      // selected the raw arm (a width-subtyped record payload) but the
      // runtime exact-key check refuted it: falling through to a user arm a
      // position of which DEFINITELY refutes would silently run the body on
      // an argument it never admits. Blame the raw arm when the call has its
      // shape (the mistake is the payload — e.g. an extra key), the refuting
      // position otherwise. An undecided position proceeds: the static gate
      // admitted it.
      for (let i = 0; i < ops.length; i++) {
        // A generic user arm quantifies its own variables: membership is a
        // GROUND question, so the parameter is read at its skeleton (a no-op
        // for a closed one).
        const p = paramTypeAt(userArm, i);
        const g = p === undefined ? undefined : groundSkeleton(p);
        if (g !== undefined && valueInhabits(ops[i], g) === 'no') {
          const engine = ops[i].engine;
          if (ops.length === (rawCheck.args ?? []).length) {
            const r = rawCheck.args![i].type;
            return engine.typeError(r, ops[i].type, ops[i]);
          }
          return engine.typeError(g, ops[i].type, ops[i]);
        }
      }

      let payload = apply(literal, ops, {
        numericApproximation: options.numericApproximation,
      });
      if (!payload.isValid) return payload;

      // A recursive constructor body returns an ALREADY-TAGGED value — its
      // own recursive call (`if (k < 0) { pt(s, -k) } else { … }`). Pass it
      // through: it was checked and tagged when it was constructed; wrapping
      // it again would nest tags.
      if (payload.operator === name && isNominalTaggedValue(payload))
        return payload;

      // A dictionary is a VALUE: `apply` substitutes into its entries but its
      // own evaluation is the identity, so the entries arrive unevaluated
      // (`{n -> 2 / Gcd(2, 4), …}`). Evaluate them — the payload check needs
      // the entries' value types, and the tagged payload should carry values.
      if (isDictionary(payload)) {
        const engine = payload.engine;
        payload = engine.function(
          'Dictionary',
          payload.keys.map((k) =>
            engine.function('KeyValuePair', [
              engine.string(k),
              // Dictionary entries are stored RAW: canonicalize before
              // evaluating (`.canonical` is value-safe), or the evaluation
              // is a no-op.
              payload.get(k)!.canonical.evaluate({
                numericApproximation: options.numericApproximation,
              }),
            ])
          )
        );
      }

      // Defensive gate against a KNOWN pre-existing engine defect (recorded
      // in the design's §4.5b D15): a recursive body returning a dictionary
      // literal from an `if` branch can leak the RAW parameter symbol into
      // the payload (`{v -> x}` instead of `{v -> 3}`). Inside the body the
      // parameter names shadow everything, so a payload that still REFERENCES
      // one is never a legitimate symbolic construction — stay inert rather
      // than tagging a value that dangles.
      const paramNames = new Set(
        functionLiteralParameters(literal).map((p) => p.name)
      );
      const leaks = (x: Expression): boolean =>
        x.symbols.some((s) => paramNames.has(s));
      if (isDictionary(payload)) {
        for (const k of payload.keys)
          if (leaks(payload.get(k)!)) return undefined;
      } else if (leaks(payload)) return undefined;

      const verdict = valueInhabits(payload, checkBody);
      if (verdict === 'maybe') return undefined;
      if (verdict === 'no')
        return payload.engine.typeError(checkBody, payload.type, payload);

      // Tag the checked payload (D12): tuple payloads spread inline, matching
      // the auto-mint shape; every other payload is a single operand.
      const engine = payload.engine;
      if (nAryRaw && isFunction(payload, 'Tuple'))
        return engine._fn(name, [...payload.ops]);
      return engine._fn(name, [payload]);
    },
    // §4.6: the tag erases. A raw-shaped application compiles exactly where
    // the equivalent plain value compiles; a user-arm application compiles as
    // an ordinary application of the user's function literal (the body
    // computes the payload, whose representation IS the erased value). An
    // undecidable shape declines.
    compile: (args, compile) => {
      if (args.length === 0) return undefined;
      const engine = args[0].engine;
      const verdict = rawArmMatch(args as ReadonlyArray<Expression>, rawCheck);
      if (verdict === 'yes') {
        if (!nAryRaw) return args.length === 1 ? compile(args[0]) : undefined;
        return compile(engine.function('Tuple', args as Expression[]));
      }
      if (verdict === 'no')
        return compile(
          engine.function('Apply', [literal, ...(args as Expression[])])
        );
      return undefined;
    },
  };

  // Install: update the existing binding IN PLACE when this scope has one
  // (the auto-minted constructor being overridden, or the shell the
  // recursion knot-tying pre-declared) — a fresh record would strand the
  // self-references already bound to the old one — and declare otherwise.
  const existing = scope.bindings.get(name);
  if (existing !== undefined) {
    const callableBefore = defIsCallableShaped(existing);
    updateDef(ce, name, existing, def);
    ce._noteStateEvent({
      kind: 'redefine',
      callableBefore,
      callableAfter: true,
    });
  } else {
    ce.declare(name, def);
  }

  const binding = scope.bindings.get(name);
  if (binding !== undefined && 'operator' in binding)
    (binding.operator as unknown as MintedMarker)[MINTED] = 'constructor';
}

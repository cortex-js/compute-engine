import type {
  FunctionSignature,
  NamedElement,
  Type,
  TypeReference,
} from '../common/type/types.js';

import type {
  BoxedDefinition,
  Expression,
  IComputeEngine,
  OperatorDefinition,
  Scope,
} from './global-types.js';

import { isFunction } from './boxed-expression/type-guards.js';

/**
 * Value constructors minted by a type declaration
 * (`docs/plans/2026-08-01-nominal-types-design.md`, §4.1/§4.1b/§4.1c, D4/D4b/
 * D5/D10).
 *
 * Declaring a type claims BOTH namespaces: the type record in `scope.types`,
 * and a value-level operator of the same name in `scope.bindings`. The operator
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
  [MINTED]?: 'nominal' | 'alias';
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
 * constructor? Used by the constructors' `eq` handler (D9). */
function isNominalTaggedValue(expr: Expression): boolean {
  const def = expr.operatorDefinition;
  return (
    def !== undefined && (def as unknown as MintedMarker)[MINTED] === 'nominal'
  );
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
  name: string
): void {
  const existing = scope.bindings.get(name);
  if (existing === undefined) return;
  if (isMintedConstructor(existing)) return;

  // Mirrors the upgrade rule in `declareFn()` / the `Declare` handler: only a
  // value-LESS inferred binding is upgradable. The operator half is narrower
  // than `declareFn()`'s: an operator whose signature was merely *inferred*
  // may still be a real definition (a Cortex `function point(x) {…}` is an
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
    `The symbol "${name}" is already declared in the current scope: a type declaration also declares a value constructor of the same name`
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
  ce._generation += 1;
}

/**
 * D4/D4b: the constructor signature derived from a type's definition body.
 *
 * - `tuple` body → n-ary, one parameter per slot; named slots become named
 *   parameters (`point: (x: number, y: number) -> point`).
 * - `record` body → `undefined`: record bodies auto-mint NOTHING (D4b). Their
 *   inhabitation story is user-defined constructor functions (§4.5, v2); the
 *   Cortex `type-not-callable` lint covers call sites meanwhile.
 * - a NAMED-field tuple body of an ALIAS → `undefined` too, for the same
 *   reason: the identity constructor returns a plain `Tuple`, whose
 *   synthesized type has UNNAMED elements, and the subtype rules reject that
 *   against the named-tuple alias. A checked identity constructor whose result
 *   fails its own type is worse than no constructor, so mint nothing (a
 *   NOMINAL named-tuple is unaffected: its value is tagged and its type comes
 *   from the `type` handler).
 * - anything else (scalar, list, dictionary, union, signature, reference…) →
 *   unary.
 *
 * Built STRUCTURALLY, never through a type string: the body and the result may
 * name user-declared types that a resolver-less `parseType()` cannot read back.
 */
function deriveConstructorSignature(
  body: Type,
  result: Type,
  alias: boolean
): FunctionSignature | undefined {
  if (body === 'record') return undefined;
  if (typeof body === 'object') {
    if (body.kind === 'record') return undefined;
    if (body.kind === 'tuple') {
      if (alias && body.elements.some((x) => x.name !== undefined))
        return undefined;
      const args: NamedElement[] = body.elements.map((x) =>
        x.name === undefined ? { type: x.type } : { name: x.name, type: x.type }
      );
      return { kind: 'signature', args, result };
    }
  }
  return { kind: 'signature', args: [{ type: body }], result };
}

/**
 * Declare the value-level constructor for the type `name` just registered in
 * `scope` (§4.1). Idempotent with respect to a previously minted constructor
 * for the same name, which it removes first (statement re-run, D5).
 *
 * `ref` is the type record in `scope.types` — the same mutable object the
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
  const signature = deriveConstructorSignature(body, alias ? body : ref, alias);
  // D4b: record bodies — and named-field tuple bodies of an alias — mint
  // nothing.
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
    type: () => (alias ? body : ref),
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
    // is INJECTIVE — the tagged value *is* its tag plus its operands, with no
    // evaluation in between. So: different tags are different values, and
    // equal tags compare operand-wise. The handler fires ONLY when both sides
    // are minted nominal applications and defers (`undefined`) otherwise, so
    // nothing else in the equality story changes.
    def.eq = (a, b) => {
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
    };
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

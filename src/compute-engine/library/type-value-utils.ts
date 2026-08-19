import type { IComputeEngine, Expression } from '../global-types.js';
import type { Type, TypeResolver } from '../../common/type/types.js';
import { parseType } from '../../common/type/parse.js';
import { reduceType } from '../../common/type/reduce.js';
import { typeToString } from '../../common/type/serialize.js';
import { isPolymorphicType } from '../../common/type/instantiate.js';
import {
  isFunction,
  isString,
  isNumber,
  isCharacter,
  isSymbol,
  isDictionary,
} from '../boxed-expression/type-guards.js';

/**
 * First-class type values (`TypeFrom`, `Subtype` — plan:
 * `docs/plans/2026-08-18-first-class-types.md`).
 *
 * A type value SETTLES at construction: its text is parsed, reduced, and
 * re-serialized, and the node becomes `TypeFrom("<reduced canonical text>")`.
 * The stored operand IS the canonical text, so `isSame`/hash are ordinary
 * structural comparison — plain text equality, registry-independent, and
 * immune to later type redeclarations. Semantic operations (`Subtype`, `==`)
 * re-parse that text against the CURRENT registry, so they see a
 * redeclared name's new meaning while the value's identity never moves.
 */

/**
 * The engine resolver with forwarding DISABLED. Parsing a type value must
 * never mutate the type registry, and the resolver's `forward()` registers a
 * placeholder record as a side effect — so inside a type value the
 * forward-reference spelling `type X` is an error, not a registration.
 * Throwing (rather than returning `undefined`, which would yield a dangling
 * unresolved reference node) surfaces the rejection through the parser's
 * ordinary error path, with this message.
 */
function noForwardResolver(resolver: TypeResolver): TypeResolver {
  return {
    get names() {
      return resolver.names;
    },
    resolve: (name) => resolver.resolve(name),
    forward: () => {
      throw new Error(
        'A forward reference ("type X") is not allowed in a type value'
      );
    },
    conformsTo: resolver.conformsTo
      ? (t, p) => resolver.conformsTo!(t, p)
      : undefined,
  };
}

/**
 * Parse, reduce and re-serialize a type text — the SETTLING step of type
 * value construction. Returns the reduced `Type` and its canonical text, or
 * the parse/validation failure as a message for an `invalid-value` error.
 * Settling is idempotent: settling a canonical text yields that same text.
 */
export function settleTypeText(
  ce: IComputeEngine,
  text: string
): { canonicalText: string; type: Type } | { error: string } {
  try {
    const parsed = parseType(text, noForwardResolver(ce._typeResolver));
    const reduced = reduceType(parsed);
    return { canonicalText: typeToString(reduced), type: reduced };
  } catch (e) {
    const err = e as { rawMessage?: string };
    return {
      error:
        err.rawMessage ?? (e instanceof Error ? e.message : String(e)),
    };
  }
}

/** The stored canonical text of a SETTLED type value, or `undefined` for
 * anything else (an unsettled computed construction, a non-type operand). */
export function settledTypeText(x: Expression): string | undefined {
  if (isFunction(x, 'TypeFrom') && x.nops === 1 && isString(x.op1))
    return x.op1.string;
  return undefined;
}

/**
 * A POLYTYPE: a `where`-quantified signature, or an INTERSECTION with at
 * least one such arm (an overload set one of whose arms is generic is itself
 * a polytype, and testing only the top level would let it slip through as an
 * ordinary comparison). Delegates to the type system's own predicate so both
 * cases stay in one place.
 *
 * Polytype VALUES are legal (`Type` on a generic function must observe its
 * static type honestly), but the comparison operators reject them — comparing
 * quantified types engages the existential matching machinery, deferred by
 * the plan's "Polytypes" section
 * (`docs/plans/2026-08-18-first-class-types.md`).
 */
export function isPolytype(t: Type): boolean {
  return isPolymorphicType(t);
}

/** The heads of container expressions that ARE their value: a node with one
 * of these operators and value-form operands is itself a value form. `Range`
 * and other lazy collections are deliberately absent — they are values, but
 * their precise types are not derived element-by-element from literal
 * structure, so they take the three-way regime instead (a deliberate
 * conservative reading of ruling R9; see `isValueForm`).
 *
 * `Dictionary` is absent because a dictionary never reaches here as a
 * FUNCTION node: canonicalization turns `["Dictionary", …]` into a boxed
 * dictionary (or throws on a malformed entry list), and every caller of
 * `isValueForm` inspects an already-canonical, already-evaluated expression.
 * Dictionaries are handled by their own branch in `isValueForm`. */
const VALUE_CONTAINER_HEADS: ReadonlySet<string> = new Set([
  'List',
  'Tuple',
  'Set',
  'RegExp',
  'TypeFrom',
  'Error',
]);

/**
 * A VALUE FORM: a node whose precise type derives from its own literal
 * structure, so the type is EXACT and a failed `matches()` against it is a
 * definitive `False` (ruling R9,
 * `docs/plans/2026-08-18-first-class-types.md` §5). Number, string,
 * character and boolean literals; `Nothing` and `Missing` (both absence
 * markers are values whose type is exactly themselves); error values; settled
 * type values; regexp values; collection literals — lists, tuples, sets and
 * dictionaries — whose elements (a dictionary's VALUES) are all value forms
 * (one non-value-form element makes the collection's element type inferred,
 * so the whole falls back to the three-way regime); and nominal constructor
 * values (their head names a registered nominal type, and the nominal type IS
 * the precise type regardless of the payload).
 *
 * Two deliberate exclusions, both in the CONSERVATIVE direction (a value
 * wrongly excluded answers symbolically instead of a definitive `False` —
 * never the reverse):
 * - FUNCTION LITERALS: ruling R9's ratified text lists them as value forms,
 *   but an unannotated literal's signature is inference-widened
 *   (`(x) -> x + 1` types looser than any one arrow), so a failed `matches`
 *   does NOT refute the value — `fn is (integer) -> integer` must stay
 *   symbolic, not answer `False`. Revisit when literal signatures become
 *   precise-by-construction.
 * - LAZY COLLECTIONS (`Range`, lazy `Map` results): per the ruling itself.
 */
export function isValueForm(ce: IComputeEngine, x: Expression): boolean {
  if (isNumber(x) || isString(x) || isCharacter(x)) return true;
  if (
    isSymbol(x, 'True') ||
    isSymbol(x, 'False') ||
    isSymbol(x, 'Nothing') ||
    isSymbol(x, 'Missing')
  )
    return true;
  // A dictionary is a value form iff all its VALUES are (its keys are literal
  // strings by construction). Tested BEFORE the function gate below: a boxed
  // dictionary is its own expression kind, not a function node, so the head
  // set could never reach it.
  if (isDictionary(x)) return x.values.every((v) => isValueForm(ce, v));
  if (!isFunction(x)) return false;
  const h = x.operator;
  if (h === 'Error') return true;
  if (h === 'TypeFrom') return settledTypeText(x) !== undefined;
  if (h === 'RegExp') return true;
  if (VALUE_CONTAINER_HEADS.has(h))
    return x.ops.every((op) => isValueForm(ce, op));
  // A nominal constructor value: the head names a registered NOMINAL type
  // with a definition, and a nominal type is opaque (ruling R4) — the head
  // alone IS the precise type, so the payload does not matter. The two other
  // record shapes must NOT qualify: an ALIAS mints no opaque type (a generic
  // alias mints no constructor at all), and a record without a definition is
  // an unfulfilled forward reference. In either case an ordinary function
  // application whose head happens to collide with the name would be read as
  // an exact nominal value and answer a wrong definitive `False`, where R9
  // requires it to stay symbolic.
  const rec = ce._typeRegistry[h];
  if (rec !== undefined && rec.def !== undefined && rec.alias !== true)
    return true;
  return false;
}

/**
 * The R9 decision regime of the dynamic type test, over an ALREADY-EVALUATED
 * subject: a value form is decided both ways (its precise type is exact); any
 * other form is three-way on its static type — subtype of `T` → `true`,
 * PROVABLY disjoint from `T` → `false`, otherwise `undefined` (the test stays
 * symbolic). `isDisjointFrom` is conservative in exactly the right direction:
 * unproven disjointness answers "may overlap", never a wrong `False` (the
 * empty list is a real witness that `list<integer>` and `list<string>`
 * overlap, so element-disjoint collection types stay symbolic here — by
 * design).
 */
export function dynamicTypeTest(
  ce: IComputeEngine,
  subject: Expression,
  t: Type
): boolean | undefined {
  const boxedT = ce.type(t);
  if (subject.type.matches(boxedT)) return true;
  if (isValueForm(ce, subject)) return false;
  if (subject.type.isDisjointFrom(boxedT)) return false;
  return undefined;
}

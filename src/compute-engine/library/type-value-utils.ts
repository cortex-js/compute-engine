import type { IComputeEngine, Expression } from '../global-types.js';
import type { Type, TypeResolver } from '../../common/type/types.js';
import { parseType } from '../../common/type/parse.js';
import { reduceType } from '../../common/type/reduce.js';
import { typeToString } from '../../common/type/serialize.js';
import { isPolymorphicType } from '../../common/type/instantiate.js';
import { isFunction, isString } from '../boxed-expression/type-guards.js';

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

import { deepEraseCallbackTypes } from './callback.js';
import {
  freeTypeVariableOccurrences,
  substituteTypeVariables,
  validateDeclaredType,
} from './instantiate.js';
import { reduceType } from './reduce.js';
import { typeToString } from './serialize.js';
import type { FunctionSignature, Type, TypeResolver } from './types.js';

/**
 * The resolver `groundedDisplayType` validates its projection through.
 *
 * A projection is a PRINTING device: what it re-validates is that the
 * variables it KEPT still form a declarable clause, and a protocol constraint
 * has no bearing on that question — the type was already accepted, by the
 * engine's own resolver, where it was declared. Answering `true` keeps the
 * `is` slot from turning a legitimate projection into a fallback.
 */
const DISPLAY_RESOLVER: TypeResolver = {
  get names(): string[] {
    return [];
  },
  forward: () => undefined,
  resolve: () => undefined,
  conformsTo: () => true,
};

/**
 * The GROUND display form of a type (Design D, R-D5, ruled 2026-08-09).
 *
 * A converted operator's declared signature is a polytype over a contextual
 * callback slot — `(collection<T>, predicate: callback<(T) -> boolean>)
 * -> integer where T`. Neither half of that is information a caller can act
 * on: `callback<S>` admits exactly what the primitive `function` admits
 * (contract clause 1), and `T` is solved per application. Displaying it says
 * the operator got stricter when nothing about admission changed.
 *
 * So RUNTIME display grounds it back to the spelling the operator carried
 * before the conversion:
 *
 * - every `callback<S>` erases to `function`, at any depth (clause 1);
 * - every quantified variable the erasure left VACUOUS — occurring at most
 *   once in the erased signature — is instantiated to its ground skeleton
 *   (`any`, or its declared bound), and the `where` clause drops with the
 *   last of them. `reduceType` then normalizes `collection<any>` back to the
 *   bare `collection`, which is the pre-conversion wording. (The same "ground
 *   skeleton" device `validate.ts` uses for the expected type in an
 *   `incompatible-type` message.)
 *
 * The vacuity test is what keeps the projection HONEST for an operator that
 * was already generic before Design D touched it: `Partition`'s
 * `(collection<T>, integer | callback<(T) -> boolean>, integer?) ->
 * list<list<T>> where T` still relates its source's elements to its result after the
 * erasure, so `T` is a pre-existing declared contract — not a conversion
 * artifact — and it is kept, on exactly the rationale that keeps a user's own
 * polytype below. A variable left in a single position relates nothing and
 * says only what its bound already says, which is why the converted operators
 * whose polytype the conversion INTRODUCED ground away completely.
 *
 * DISPLAY ONLY, and STRINGIFICATION-ONLY. Internal serialization keeps the
 * constructor and the clause intact for round-tripping and de-duplication
 * (clause 5) — `typeToString` and `typeToDedupKey` are untouched. The projected
 * AST is never BOXED and never reaches a subtype query: the one consumer that
 * used to hand it to `new BoxedType(…)` — a boxed symbol's `.type` — now
 * returns the FAITHFUL type carrying a display-string override
 * ({@linkcode BoxedType.withDisplayString}), so `.matches`, `.isPolymorphic`
 * and every subtype answer read the definition's own type. Everything else here
 * ends in {@linkcode typeToString}.
 *
 * SCOPED TO A CONVERSION. The presence of a `callback<S>` is what identifies a
 * signature this mechanism rewrote, and it is the whole trigger: a type with no
 * callback anywhere is returned BY REFERENCE, `where` clause and all. A user's own
 * generic function keeps its polytype display (`(x: T) -> T where T`) —
 * that is its declared contract, not a conversion artifact, and it is pinned
 * in `generic-function-literals.test.ts`.
 */
export function groundedDisplayType(t: Type): Type {
  const erased = deepEraseCallbackTypes(t);
  if (erased === t) return t;

  // An OVERLOAD SET is projected ARM BY ARM and REBUILT — never re-reduced.
  // `reduceType` on an intersection folds its members through the meet, and two
  // signatures that are not mutually subtypes annihilate to `nothing`: running
  // it here printed a user's callback-bearing overload set as the empty type.
  // The arms are what an overload set has to show.
  if (typeof erased === 'object' && erased.kind === 'intersection')
    return { ...erased, types: erased.types.map(groundedArm) };

  return groundedArm(erased);
}

/** The projection of ONE (already callback-erased) arm. Never throws: a
 * projection is a printing device, and a getter that prints must not be able to
 * fail. The erasure can leave a quantified variable occurring only result-side
 * (`(callback<(T) -> boolean>) -> tuple<T, T> where T` erases to
 * `(function) -> tuple<T, T>`), which is not a declarable polytype — so the
 * grounded form is validated here and, if it does not stand on its own, the
 * erased-but-`where`-kept spelling is shown instead. */
function groundedArm(erased: Type): Type {
  try {
    return reduceType(groundVacuousVariables(erased));
  } catch {
    return erased;
  }
}

function groundVacuousVariables(erased: Type): Type {
  const typeParams =
    typeof erased === 'object' && erased.kind === 'signature'
      ? erased.typeParams
      : undefined;
  if (typeParams === undefined || typeParams.length === 0) return erased;

  // Count occurrences in the OPEN signature (its own clause removed), so the
  // variables it quantifies read as free.
  const open: FunctionSignature = { ...(erased as FunctionSignature) };
  delete open.typeParams;
  const occurrences = freeTypeVariableOccurrences(open);

  const bindings: Record<string, Type> = Object.create(null);
  for (const p of typeParams)
    if ((occurrences.get(p.name) ?? 0) <= 1)
      // An unbounded variable grounds as `unknown` — the identity bound
      // since the bare-synonym ruling (2026-08-17) — so `collection<T>`
      // displays as the bare `collection` (which `reduceType` collapses),
      // not as the wider `collection<any>`.
      bindings[p.name] = p.bound ?? 'unknown';
  const grounded = substituteTypeVariables(erased, bindings);
  // The variables the projection KEPT must still form a declarable clause.
  // `validateDeclaredType` throws when they do not; the caller falls back.
  validateDeclaredType(grounded, DISPLAY_RESOLVER);
  return grounded;
}

/** {@linkcode groundedDisplayType}, serialized — the string a runtime
 * signature-display consumer shows. */
export function typeToDisplayString(t: Type): string {
  return typeToString(groundedDisplayType(t));
}

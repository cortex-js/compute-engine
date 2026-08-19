import { signatureArms } from './utils.js';
import { freeTypeVariables } from './instantiate.js';
import { provablyDisjoint } from './subtype.js';
import type { FunctionSignature, Type } from './types.js';

/**
 * The DISJOINTNESS half of **compatibility admission** for callback operands
 * (Design E §3, `docs/TYPE-SYSTEM.md`
 * — rules 1, 3 and 4).
 *
 * A callback operand at an arrow-typed parameter slot is admitted unless it
 * is *provably unusable*: reject-only-on-proof, so every "cannot tell" path
 * ADMITS and the runtime stays the honest party. This module is pure type
 * algebra — it knows nothing about expressions or engines. The relation's
 * other rules live elsewhere by design:
 *
 * - rule 2 (arity) is the shipped `callbackArityError`
 *   (`src/compute-engine/boxed-expression/callback-arity.ts`);
 * - rule 5 (effects) is the existing effect-subset check at the call
 *   boundary (`docs/EFFECTS-MODEL.md`);
 * - the engine's planning pass (Design E §6) sequences all three and decides
 *   WHICH operands are checked at all — in particular, an absent optional
 *   callback (the `Nothing` marker) never reaches this function, whose
 *   honest answer for the `nothing` type is "not callable".
 *
 * The `supply` is the slot's **supply arrow** (Design E §3): the declared
 * arrow instantiated from the data operands, or — for a slot whose operator
 * supplies arguments differently than the declared arrow states, like `Map`'s
 * zip form — one parameter per actually-supplied argument. Only its required
 * `args` describe supplied positions; `optArgs`/`variadicArg` on a supply
 * arrow are ignored. The caller is expected to have grounded it (unsolved
 * variables to the `any` sentinel); any position that still carries a free
 * type variable, on either side, is skipped rather than judged
 * (`provablyDisjoint` requires ground types, and genericity alone must never
 * reject).
 */

/** A proof that the operand cannot work at the slot — `undefined` means
 * ADMITTED. `expected` is the slot's (supply) side, `actual` the operand's,
 * ready for an `incompatible-type` diagnostic. */
export type CallbackIncompatibility =
  | { rule: 'not-callable'; actual: Type }
  | {
      rule: 'disjoint-parameter';
      /** 0-based position among the supplied arguments. */
      position: number;
      expected: Type;
      actual: Type;
    }
  | { rule: 'disjoint-result'; expected: Type; actual: Type };

/**
 * Rules 1/3/4 of Design E §3 (see the module comment for what deliberately
 * is NOT here). Returns the first proof of unusability, or `undefined` for
 * ADMITTED.
 *
 * Operand shapes (Design E §3 notes): a UNION is admitted if any callable
 * arm is compatible (rule 1 rejects only when the whole union is provably
 * disjoint from `function`); an INTERSECTION (overload set) likewise — the
 * runtime selects the applicable arm per call, so one usable arm suffices; a
 * POLYMORPHIC arm is judged at its skeleton (variable-bearing positions
 * skip); an alias REFERENCE is unfolded by `provablyDisjoint` itself for
 * rule 1 and unfolded here for arm collection; anything opaque (nominal
 * reference, negation, `unknown`, `any`, bare `function`) admits.
 */
export function callbackIncompatibility(
  supply: Readonly<FunctionSignature>,
  operand: Readonly<Type>
): CallbackIncompatibility | undefined {
  const f = operand as Type;

  // Rule 1 — not callable. `provablyDisjoint` distributes over unions, so a
  // union with any possibly-callable arm passes. Guard the ground-type
  // requirement: an operand carrying type variables is never judged here.
  if (freeTypeVariables(f).size === 0 && provablyDisjoint(f, 'function'))
    return { rule: 'not-callable', actual: f };

  const arms = collectSignatureArms(f);
  // A wildcard-callable shape (bare `function`, `unknown`, `any`, a type
  // variable, an opaque reference…) somewhere in the operand: nothing to
  // refute — admitted.
  if (arms === undefined) return undefined;

  // Admitted if ANY arm survives rules 3–4; otherwise report the FIRST
  // arm's proof (stable, and for the common single-arm operand it is the
  // only one).
  let firstProof: CallbackIncompatibility | undefined = undefined;
  for (const arm of arms) {
    const proof = armIncompatibility(supply, arm);
    if (proof === undefined) return undefined;
    firstProof ??= proof;
  }
  return firstProof;
}

/**
 * The operand's checkable signature arms, flattened through unions,
 * intersections and alias references. `undefined` means a wildcard-callable
 * member was found and the operand must be ADMITTED without arm checks.
 * Non-callable members of a mixed union contribute nothing (rule 1 already
 * judged the union as a whole).
 */
function collectSignatureArms(
  t: Type
): ReadonlyArray<FunctionSignature> | undefined {
  if (typeof t === 'string')
    return t === 'function' || t === 'unknown' || t === 'any' ? undefined : [];
  switch (t.kind) {
    case 'signature':
      return [t];
    case 'variable':
      return undefined;
    case 'union':
    case 'intersection': {
      // Same collection either way: a union arm MIGHT be the value's shape,
      // an intersection (overload-set) arm IS one of its call shapes — in
      // both cases one compatible arm is enough to admit, and a mixed
      // non-callable member proves nothing on its own.
      const arms: FunctionSignature[] = [];
      for (const member of t.types) {
        const inner = collectSignatureArms(member);
        if (inner === undefined) return undefined;
        arms.push(...inner);
      }
      return arms;
    }
    case 'reference':
      // A transparent alias IS its definition; a nominal reference is opaque
      // to this walk — conservative wildcard, rule 1 already had its say.
      if (t.alias === true && t.def !== undefined)
        return collectSignatureArms(t.def);
      return undefined;
    default:
      // Composite kinds (collections, tuples, records, negations, …): a
      // member PROVABLY disjoint from `function` contributes no arm — as a
      // UNION member it must not read as a wildcard, or
      // `list<number> | ((string) -> boolean)` would be admitted on the
      // list arm's opacity while its only callable arm is disjoint (rule 1
      // judges the union as a whole and passes it on the callable arm).
      // Anything not provably non-callable stays the conservative wildcard.
      if (freeTypeVariables(t).size === 0 && provablyDisjoint(t, 'function'))
        return [];
      return undefined;
  }
}

/** Rules 3–4 against one concrete arm. */
function armIncompatibility(
  supply: Readonly<FunctionSignature>,
  arm: FunctionSignature
): CallbackIncompatibility | undefined {
  const supplied = supply.args ?? [];
  for (let i = 0; i < supplied.length; i++) {
    const p = supplied[i].type;
    // Bottom supply positions are VACUOUS (Design E §3 notes): a supply type
    // of `never` — the element type of an empty collection — means the
    // callback is never invoked with any value, so the call cannot go wrong.
    // (`nothing` rides along per the ruled spec text; it is a unit type, but
    // a slot supplying only the `Nothing` marker proves nothing useful.)
    if (p === 'never' || p === 'nothing') continue;
    const q = armParamAt(arm, i);
    // Beyond the arm's parameters with no variadic tail: an ARITY matter —
    // rule 2's business (`callbackArityError`), never judged here.
    if (q === undefined) continue;
    if (freeTypeVariables(p).size > 0 || freeTypeVariables(q).size > 0)
      continue;
    if (provablyDisjoint(p, q))
      return {
        rule: 'disjoint-parameter',
        position: i,
        expected: p,
        actual: q,
      };
  }

  // Rule 4, with the OPERAND-side bottom carve-out only: a `never` operand
  // result is a callback that never returns normally, which satisfies every
  // result contract. The carve-out is deliberately NOT symmetric (the ruled
  // spec grants it to the operand side alone): a slot REQUIRING `-> never`
  // or `-> nothing` is a real contract, and a callback declared to return an
  // ordinary value provably violates it — `provablyDisjoint` then fires
  // exactly as it should.
  const r = supply.result;
  const s = arm.result;
  if (s === 'never') return undefined;
  if (freeTypeVariables(r).size > 0 || freeTypeVariables(s).size > 0)
    return undefined;
  if (provablyDisjoint(r, s))
    return { rule: 'disjoint-result', expected: r, actual: s };
  return undefined;
}

/** The arm's parameter type at supplied position `i`, walking
 * required → optional → variadic; `undefined` beyond a non-variadic arm's
 * last parameter. */
function armParamAt(arm: FunctionSignature, i: number): Type | undefined {
  const req = arm.args ?? [];
  if (i < req.length) return req[i].type;
  const opt = arm.optArgs ?? [];
  if (i - req.length < opt.length) return opt[i - req.length].type;
  return arm.variadicArg?.type;
}

/**
 * True when the operand's declared arity range provably cannot accept `n`
 * arguments — the decline condition that routes the diagnostic to the
 * `callback-arity` machinery (rule 2) instead of the disjointness rules —
 * shared by the eager gate (`validate.ts`) and the lazy canonical route
 * (`library/collections.ts`). Conservative:
 * a shape with no readable arity (bare `function`, mixed unions) answers
 * `false` and stays with the gate.
 */
export function arityProvablyIncapable(opType: Type, n: number): boolean {
  const arms = signatureArms(opType);
  if (arms === undefined) return false;
  for (const arm of arms) {
    const required = arm.args?.length ?? 0;
    const max =
      arm.variadicArg !== undefined
        ? Infinity
        : required + (arm.optArgs?.length ?? 0);
    if (n >= required && n <= max) return false;
  }
  return true;
}

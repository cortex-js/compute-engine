import type { Type } from './types.js';
import { isSubtype } from './subtype.js';
import { reduceType } from './reduce.js';
import { subtypingVarianceOf } from './variance.js';

/**
 * Widen every numeric VALUE type in a type-handler result to its ordinary
 * tier, so a literal type never leaks into a stored expression type.
 *
 * Number literals reach type handlers with value-carrying types (`21`,
 * `0.5` — see `_literalType` on `BoxedNumber` and `handlerTypeOf()` in
 * `library/type-handlers.ts`). A handler that echoes such a type into its
 * result would store an over-specific contract nobody wrote (`tuple<1, 2>`
 * as the type of a tuple the user built from variables). This walker runs
 * once on every handler result, at the single place that result is stored
 * (`boxed-function.ts`), and rewrites:
 *
 * - a numeric value node to its tier: an integer value to `finite_integer`,
 *   any other finite value to `finite_real` (the lattice deliberately does
 *   not class a bare numeric value as rational), `±∞` to
 *   `non_finite_number`, `NaN` to `number`;
 * - only in COVARIANT positions. Widening is "the new type is a supertype
 *   of the old", which reverses under contravariance: in a function
 *   PARAMETER a literal is left as written, since widening it would make
 *   the whole signature narrower, not wider. Signature parameters (and the
 *   optional/variadic slots) flip the polarity; a negation flips it; the
 *   signature result and type-parameter bounds keep it.
 *
 * String and boolean value nodes are leaves: they have no numeric tier to
 * widen to, and no handler manufactures them from an operand literal.
 *
 * OPEN ranges (`kind: 'numeric'`, e.g. `finite_real<0..>`) are handler
 * claims, not literals, and pass through unchanged — a ranged handler
 * result such as `Abs`'s `finite_real<0..>` is exactly what this walker
 * must preserve. A SINGLETON range on the rational tier
 * (`finite_rational<0.5..0.5>`) is the exact-rational literal
 * representation (ruling O9) and widens to its tier like a value node;
 * singleton ranges on other tiers are author/derivation narrowings and
 * pass through. A literal's SIGN range (`(finite_real<0..>) & !0` for √2)
 * is shape-identical to a deliberate handler claim (`Exp`'s result), so
 * this walker cannot tell them apart and keeps both — call sites that
 * store an OPERAND's type distinguish by the operand (`_literalType`
 * defined) and project literal cargo through `stripNumericRanges` instead
 * (see `solveArm`, `receiverType`, `storedCellType`,
 * `functionLiteralSignatureType`).
 *
 * The walk descends STRUCTURAL nodes only: `list`, `set`, `tuple`,
 * `collection`/`indexed_collection`, `dictionary`, `broadcastable`,
 * `union`/`intersection`, `negation` and `signature`. `reference`,
 * `object` and `record` nodes are returned by identity: their field types
 * are an author's declaration rather than a handler product, they are
 * compared by identity downstream (protocol property lookups), and a
 * recursive record reaches its own body only through a `reference` — so
 * treating them as leaves is also what makes the walk cycle-free.
 * (Rebuilding them broke both properties when the 2026-08-22 experiment
 * tried; see `docs/plans/2026-08-22-type-handlers-on-types.md` §2.2.)
 * Shared sub-nodes are rewritten once, through a per-call memo.
 *
 * A rebuilt union or intersection is re-reduced (`reduceType`), which is
 * safe because the rebuilt node is acyclic by construction.
 */
export function widenValueTypes(t: Type): Type {
  // One memo per polarity: a node SHARED between a covariant and a
  // contravariant position (a value type used as both a parameter and the
  // result of one signature) must not reuse the other polarity's rewrite.
  const memo: PolarityMemos = {
    co: new Map<object, Type>(),
    contra: new Map<object, Type>(),
  };
  const out = widen(t, true, memo);
  // Widening must never narrow: the original type must be a subtype of the
  // result. (`isSubtype` is pure; the assert is stripped from the
  // production build.)
  console.assert(
    out === t || isSubtype(t, out),
    'widenValueTypes(): result is not a supertype of its input'
  );
  return out;
}

type PolarityMemos = { co: Map<object, Type>; contra: Map<object, Type> };

function widen(t: Type, covariant: boolean, memo: PolarityMemos): Type {
  if (typeof t === 'string') return t;

  const m = covariant ? memo.co : memo.contra;
  const cached = m.get(t);
  if (cached !== undefined) return cached;

  const result = widenNode(t, covariant, memo);
  m.set(t, result);
  return result;
}

function widenNode(
  t: Exclude<Type, string>,
  covariant: boolean,
  memo: PolarityMemos
): Type {
  switch (t.kind) {
    case 'value': {
      if (!covariant) return t;
      const v = t.value;
      if (typeof v !== 'number') return t; // string/boolean values: leaves
      if (Number.isNaN(v)) return 'number';
      if (!Number.isFinite(v)) return 'non_finite_number';
      return Number.isInteger(v) ? 'finite_integer' : 'finite_real';
    }

    case 'union':
    case 'intersection': {
      const types = t.types.map((x) => widen(x, covariant, memo));
      if (types.every((x, i) => x === t.types[i])) return t;
      return reduceType({ ...t, types });
    }

    case 'negation': {
      const inner = widen(t.type, !covariant, memo);
      return inner === t.type ? t : { ...t, type: inner };
    }

    case 'list':
    case 'set':
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable': {
      const elements = widen(t.elements, covariant, memo);
      return elements === t.elements ? t : { ...t, elements };
    }

    case 'dictionary': {
      const values = widen(t.values, covariant, memo);
      return values === t.values ? t : { ...t, values };
    }

    case 'tuple': {
      const elements = t.elements.map((el) => {
        const type = widen(el.type, covariant, memo);
        return type === el.type ? el : { ...el, type };
      });
      if (elements.every((el, i) => el === t.elements[i])) return t;
      return { ...t, elements };
    }

    case 'signature': {
      // Parameters are CONTRAVARIANT; the result and the type-parameter
      // bounds are covariant. Adjuncts (`effects`, `variadicMin`, …) ride
      // along through the spread.
      const flip = !covariant;
      const mapParams = (
        els: typeof t.args
      ): { changed: boolean; els: typeof t.args } => {
        if (!els) return { changed: false, els };
        const next = els.map((el) => {
          const type = widen(el.type, flip, memo);
          return type === el.type ? el : { ...el, type };
        });
        return { changed: next.some((el, i) => el !== els[i]), els: next };
      };
      const args = mapParams(t.args);
      const optArgs = mapParams(t.optArgs);
      const variadicType = t.variadicArg
        ? widen(t.variadicArg.type, flip, memo)
        : undefined;
      const result = widen(t.result, covariant, memo);
      const typeParams = t.typeParams?.map((p) => {
        if (p.bound === undefined) return p;
        const bound = widen(p.bound, covariant, memo);
        return bound === p.bound ? p : { ...p, bound };
      });
      const typeParamsChanged =
        typeParams !== undefined &&
        typeParams.some((p, i) => p !== t.typeParams![i]);
      if (
        !args.changed &&
        !optArgs.changed &&
        (t.variadicArg === undefined || variadicType === t.variadicArg.type) &&
        result === t.result &&
        !typeParamsChanged
      )
        return t;
      return {
        ...t,
        ...(args.els !== undefined ? { args: args.els } : {}),
        ...(optArgs.els !== undefined ? { optArgs: optArgs.els } : {}),
        ...(t.variadicArg !== undefined
          ? { variadicArg: { ...t.variadicArg, type: variadicType! } }
          : {}),
        ...(typeParams !== undefined ? { typeParams } : {}),
        result,
      };
    }

    case 'reference': {
      // A reference is a leaf for its BODY (`def` is never descended —
      // that is what makes a recursive type cycle-free here). The type
      // ARGUMENTS of an applied parameterized nominal (`tree<integer>`)
      // follow the declaration's per-parameter variance: an `out` slot is
      // an ordinary covariant position, an `in` slot flips the polarity,
      // and an `inout` (invariant) slot is left by identity — widening it
      // would break `original <: widened`, which needs argument EQUALITY
      // there. Rebuild only when an argument actually changed, so an
      // untouched reference keeps its identity.
      if (!t.args) return t;
      const args = t.args.map((x, i) => {
        const variance = subtypingVarianceOf(t, i);
        if (variance === 'inout') return x;
        return widen(x, variance === 'out' ? covariant : !covariant, memo);
      });
      if (args.every((x, i) => x === t.args![i])) return t;
      return { ...t, args };
    }

    case 'numeric': {
      // An OPEN range (`finite_real<0..>` from `Abs`) is a handler's claim
      // and passes through. A SINGLETON range on the RATIONAL tier
      // (`finite_rational<0.5..0.5>`) is a literal's exact-rational
      // representation — the lattice has no value node that keeps the
      // rational tier, and no other tier spells a literal as a singleton
      // range — so at a storage position it is literal cargo exactly like a
      // value node, and widens to its tier (covariant positions only, same
      // polarity rule as `value`). A singleton range on any OTHER tier
      // (`finite_integer<5..5>`) is an author's or a derivation's narrowing
      // and passes through like an open range.
      if (
        covariant &&
        t.type === 'finite_rational' &&
        typeof t.lower === 'number' &&
        t.lower === t.upper &&
        Number.isFinite(t.lower)
      )
        return t.type;
      return t;
    }

    // Leaves. `object` and `record` are
    // identity-bearing declarations (rebuilding them broke protocol
    // property lookups and recursed on recursive records in the §2.2
    // experiment); the rest carry no nested type a handler could have
    // built from a literal.
    case 'object':
    case 'record':
    case 'variable':
    case 'symbol':
    case 'expression':
      return t;

    default: {
      // Compile-time exhaustiveness: adding a Type kind without deciding
      // its widening rule must fail the build (and the runtime fallback is
      // the sound identity).
      const _exhaustive: never = t;
      return _exhaustive as Type;
    }
  }
}

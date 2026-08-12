import { withTypeArguments } from './reference.js';
import type {
  CallbackType,
  FunctionSignature,
  NamedElement,
  Type,
} from './types.js';

/**
 * The `callback<S>` constructor's SEMANTIC-ERASURE half (Design D §4, contract
 * clause 1): everywhere the type system decides admission, `callback<S>` is
 * the primitive `function` and nothing else.
 *
 * Kept in its own LEAF module — it imports only the type declarations and the
 * `reference.js` rebuild helper `withTypeArguments`, neither of which reaches
 * back into the type algebra — so both the type algebra (`subtype.ts`) and the
 * engine's argument validation can reach it without closing an import cycle.
 */

/** True when `t` is the contextual-callback constructor. O(1). */
export function isCallbackType(t: Readonly<Type>): t is CallbackType {
  return typeof t === 'object' && t.kind === 'callback';
}

/**
 * `t` with a TOP-LEVEL `callback<S>` erased to the primitive `function`
 * (clause 1). Every other type is returned by identity.
 *
 * Deliberately SHALLOW, and correct only where the caller itself recurses:
 * the structural subtype predicates re-enter their own entry point for every
 * child, so erasing at that entry covers a nested occurrence for free. A
 * caller that consumes the type WHOLE — serializing it, comparing dedup key
 * strings, printing it in a diagnostic — must use
 * {@linkcode deepEraseCallbackTypes} instead; a nested occurrence is otherwise
 * retained (the engine writes the constructor as a whole parameter slot, but
 * a USER-declared signature may nest it anywhere).
 */
export function eraseCallbackType(t: Type): Type {
  return isCallbackType(t) ? 'function' : t;
}

/**
 * `t` with EVERY occurrence of `callback<S>`, at any depth, erased to the
 * primitive `function` (clause 1).
 *
 * Pure rebuild, no mutation, identity-preserving: a subtree that contains no
 * callback constructor is returned by reference, so the common case allocates
 * nothing. (Types are interned and deep-frozen by `parseType()`, so rebuilding
 * — never writing in place — is mandatory.)
 *
 * Used where a type is consumed as a WHOLE rather than walked structurally:
 * the polytype α-equivalence dedup-key comparison in `subtype.ts` (clause 1
 * must hold for `where`-quantified arms too) and the argument-validation surfaces that
 * print or infer a parameter type.
 */
export function deepEraseCallbackTypes(t: Type): Type {
  if (typeof t === 'string') return t;
  switch (t.kind) {
    case 'callback':
      return 'function';
    case 'signature': {
      const args = eraseElements(t.args);
      const optArgs = eraseElements(t.optArgs);
      const variadicArg =
        t.variadicArg === undefined ? undefined : eraseElement(t.variadicArg);
      const result = deepEraseCallbackTypes(t.result);
      if (
        args === t.args &&
        optArgs === t.optArgs &&
        variadicArg === t.variadicArg &&
        result === t.result
      )
        return t;
      const next: FunctionSignature = { ...t, result };
      if (args !== undefined) next.args = args;
      if (optArgs !== undefined) next.optArgs = optArgs;
      if (variadicArg !== undefined) next.variadicArg = variadicArg;
      return next;
    }
    case 'union':
    case 'intersection': {
      const types = eraseAll(t.types);
      return types === t.types ? t : { ...t, types };
    }
    case 'negation': {
      const type = deepEraseCallbackTypes(t.type);
      return type === t.type ? t : { ...t, type };
    }
    case 'list':
    case 'set':
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable': {
      const elements = deepEraseCallbackTypes(t.elements);
      return elements === t.elements ? t : { ...t, elements };
    }
    case 'tuple': {
      const elements = eraseElements(t.elements);
      return elements === t.elements ? t : { ...t, elements: elements! };
    }
    case 'dictionary': {
      const values = deepEraseCallbackTypes(t.values);
      return values === t.values ? t : { ...t, values };
    }
    case 'record': {
      let changed = false;
      const elements: Record<string, Type> = {};
      for (const [key, value] of Object.entries(t.elements)) {
        const next = deepEraseCallbackTypes(value);
        if (next !== value) changed = true;
        elements[key] = next;
      }
      return changed ? { ...t, elements } : t;
    }
    case 'reference': {
      // Reach INTO a type application's arguments, but never through the
      // reference itself (its definition is shared, and unfolding here would
      // change what the reference means).
      if (t.args === undefined) return t;
      const args = eraseAll(t.args);
      // `withTypeArguments`, not a spread: a reference's `def` is an ACCESSOR
      // and its back-pointers are non-enumerable.
      return args === t.args ? t : withTypeArguments(t, args);
    }
    default:
      return t;
  }
}

function eraseAll(types: Type[]): Type[] {
  let changed = false;
  const result = types.map((x) => {
    const next = deepEraseCallbackTypes(x);
    if (next !== x) changed = true;
    return next;
  });
  return changed ? result : types;
}

function eraseElement(el: NamedElement): NamedElement {
  const type = deepEraseCallbackTypes(el.type);
  return type === el.type ? el : { ...el, type };
}

function eraseElements(
  elements: NamedElement[] | undefined
): NamedElement[] | undefined {
  if (elements === undefined) return undefined;
  let changed = false;
  const result = elements.map((el) => {
    const next = eraseElement(el);
    if (next !== el) changed = true;
    return next;
  });
  return changed ? result : elements;
}

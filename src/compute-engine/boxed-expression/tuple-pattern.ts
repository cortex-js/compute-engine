import type { Expression } from '../global-types.js';
import { parseType } from '../../common/type/parse.js';
import { isFunction, sym } from './type-guards.js';

/**
 * Every name a destructuring `Tuple` pattern binds, in pattern order: the
 * pattern's leaf symbols, nested patterns included, with the `_` positions —
 * which bind nothing — dropped.
 */
export function tuplePatternNames(pattern: Expression): string[] {
  const names: string[] = [];
  const walk = (p: Expression): void => {
    if (isFunction(p, 'Tuple')) {
      for (const el of p.ops) walk(el);
      return;
    }
    const n = sym(p);
    if (n !== undefined && n !== '_') names.push(n);
  };
  walk(pattern);
  return names;
}

/**
 * Match a destructuring `Tuple` pattern against a value, returning the
 * `(name, value)` pairs to bind — in pattern order, `_` positions dropped — or
 * an `Error` value if the shapes do not match.
 *
 * The pattern is irrefutable in FORM (a raw `Tuple` of bare symbols, `_`, or
 * nested tuple patterns), so the only way to fail is a runtime SHAPE mismatch:
 * the value is not a tuple, or its arity differs from the pattern's. A tuple is
 * required specifically — an indexed collection of the right length does NOT
 * destructure (the rule `let (a, b) = v` established, 2026-08-07).
 *
 * The ENTIRE tree is matched here, before the caller binds anything: a mismatch
 * nested under an already-matched sibling — `(a, (b, c))` against `(1, 5)` —
 * must not leave `a` bound. (It did when matching and binding shared one pass:
 * the nested level's shape was only checked once the walk reached it.)
 *
 * Shared by the three destructuring routes so they report the SAME error for
 * the same mismatch: the `let (x, y) = v` declaration and the `(x, y) := v`
 * assignment (`Declare`/`Assign`, `library/core.ts`), and a lambda's
 * destructuring parameter (`((p, q)) => …`, bound by `makeLambda` in
 * `function-utils.ts`).
 */
export function collectTuplePattern(
  pattern: Expression,
  v: Expression,
  out: [name: string, value: Expression][]
): Expression | null {
  const ce = pattern.engine;
  if (!isFunction(pattern, 'Tuple'))
    return ce.typeError('tuple', pattern.type, pattern.toString());
  if (!isFunction(v, 'Tuple'))
    return ce.typeError('tuple', v.type, v.toString());
  if (v.nops !== pattern.nops)
    return ce.typeError(
      parseType(`tuple<${Array(pattern.nops).fill('unknown').join(', ')}>`)!,
      v.type,
      v.toString()
    );
  for (let i = 0; i < pattern.nops; i++) {
    const p = pattern.ops[i];
    const el = v.ops[i];
    if (isFunction(p, 'Tuple')) {
      const err = collectTuplePattern(p, el.evaluate(), out);
      if (err) return err;
      continue;
    }
    const name = sym(p);
    if (!name) return ce.typeError('symbol', p.type, p.toString());
    if (name === '_') continue;
    out.push([name, el]);
  }
  return null;
}

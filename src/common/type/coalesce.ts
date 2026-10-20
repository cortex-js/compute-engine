import { reduceType } from './reduce.js';
import { resolveTypeAlias } from './utils.js';
import type { Type } from './types.js';

/** Successful outcomes of a whole-value absence check, without changing cells. */
export function presentType(
  type: Type,
  seen: ReadonlySet<Type> = new Set()
): Type {
  const t = resolveTypeAlias(type);
  if (seen.has(t)) return type;
  // An unresolved type is not evidence for a concrete present content type.
  if (t === 'unknown' || (typeof t === 'object' && t.kind === 'variable'))
    return t;
  if (typeof t === 'object' && t.kind === 'union') {
    const next = new Set(seen).add(t);
    return reduceType({
      kind: 'union',
      types: t.types.map((arm) => presentType(arm, next)),
    });
  }
  return reduceType({
    kind: 'intersection',
    types: [
      t,
      { kind: 'negation', type: { kind: 'union', types: ['missing', 'nan'] } },
    ],
  });
}

/** The final fallback is returned even when absent; earlier operands are not. */
export function coalesceResultType(types: ReadonlyArray<Type>): Type {
  if (types.length === 0) return 'nothing';
  // A type union preserves `nothing` and unresolved arms that the evidence
  // join `widen()` deliberately absorbs.
  const outcomes: Type[] = [];
  for (let i = 0; i < types.length; i++) {
    // Once a demanded operand cannot return, later fallbacks are unreachable.
    if (resolveTypeAlias(types[i]) === 'never') break;
    outcomes.push(i === types.length - 1 ? types[i] : presentType(types[i]));
  }
  return reduceType({ kind: 'union', types: outcomes });
}

import { joinLatex } from './tokenizer.js';
import { DEFINITIONS_INEQUALITIES } from './dictionary/definitions-relational-operators.js';

export function isLatexString(s: unknown): s is string {
  if (typeof s === 'string') return s.startsWith('$') && s.endsWith('$');
  return false;
}

export function asLatexString(s: unknown): string | null {
  if (typeof s === 'number') return s.toString();
  if (typeof s === 'string') {
    const str = s.trim();

    if (str.startsWith('$$') && str.endsWith('$$')) return str.slice(2, -2);
    if (str.startsWith('$') && str.endsWith('$')) return str.slice(1, -1);
  }
  if (Array.isArray(s)) {
    // Check after 'string', since a string is also an array...
    return asLatexString(joinLatex(s));
  }
  return null;
}

/**
 * The standard-library blackboard-bold constants that name a **ring** (or a
 * field, which is a ring).
 *
 * These are the only bases for which the ring-construction notations
 * `\mathbb{Z}[\sqrt2]` (adjunction — `Adjoin`) and `\mathbb{Z}_n` /
 * `\mathbb{Z}/n\mathbb{Z}` (quotient — `QuotientRing`) are recognized. The
 * list is explicit rather than derived from the type of the operand: "is a
 * ring" is an algebraic property the type lattice does not model (a
 * `set<integer>` type is carried by `PositiveIntegers` too, which is not a
 * ring), and keeping the dispatch narrow leaves `At`/`Subscript` over every
 * other set-typed base exactly as it was.
 *
 * It lives here — the lowest layer that both consumers can reach — so the
 * LaTeX parselets (`dictionary/definitions-sets.ts`) and the canonical
 * dispatch (`library/ring-constructions.ts`, which cannot be imported from
 * this layer) share ONE list. Same arrangement as `isRelationalOperator`
 * below, which `library/relational-operator.ts` consumes.
 */
export const RING_CONSTANTS: ReadonlySet<string> = new Set([
  'Integers',
  'RationalNumbers',
  'RealNumbers',
  'ComplexNumbers',
]);

export function isRelationalOperator(name: string | undefined): boolean {
  if (typeof name !== 'string') return false;
  return DEFINITIONS_INEQUALITIES.some((x) => x.name === name);
}

export function isInequalityOperator(operator: string | undefined): boolean {
  if (typeof operator !== 'string') return false;
  return ['Less', 'LessEqual', 'Greater', 'GreaterEqual'].includes(operator);
}

export function isEquationOperator(operator: string | undefined): boolean {
  if (typeof operator !== 'string') return false;
  return ['Equal', 'NotEqual'].includes(operator);
}

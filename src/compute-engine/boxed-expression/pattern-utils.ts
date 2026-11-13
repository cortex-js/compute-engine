/**
 * Leaf module for wildcard pattern utility functions.
 *
 * These are extracted from boxed-patterns.ts to break circular dependencies:
 * match.ts needs these functions, but boxed-patterns.ts
 * has dependencies that create cycles through boxed-symbol.ts.
 */

import type { Expression } from '../global-types.js';
import { isFunction, isSymbol } from './type-guards.js';

/**
 * Check if an expression is a wildcard (universal, sequence, or optional sequence).
 *
 * @param expr - The expression to check
 * @returns `true` if the expression is any type of wildcard
 */
export function isWildcard(expr: Expression): boolean {
  return (
    (isSymbol(expr) && expr.symbol.startsWith('_')) ||
    expr.operator === 'Wildcard' ||
    expr.operator === 'WildcardSequence' ||
    expr.operator === 'WildcardOptionalSequence'
  );
}

/**
 * Get the string representation of a wildcard expression.
 *
 * Returns the wildcard symbol including its name (if any):
 * - `'_'` for anonymous universal wildcard
 * - `'_a'` for named universal wildcard
 * - `'__'` for anonymous sequence wildcard
 * - `'__args'` for named sequence wildcard
 * - `'___'` for anonymous optional sequence wildcard
 * - `'___rest'` for named optional sequence wildcard
 *
 * @param expr - The expression to get the wildcard name from
 * @returns The wildcard string, or `null` if not a wildcard
 */
export function wildcardName(expr: Expression): string | null {
  if (isSymbol(expr) && expr.symbol.startsWith('_')) return expr.symbol;

  if (isFunction(expr) && expr.nops === 1) {
    const arg = expr.op1;
    if (expr.operator === 'Wildcard') return `_${arg}`;
    if (expr.operator === 'WildcardSequence') return `__${arg}`;
    if (expr.operator === 'WildcardOptionalSequence') return `___${arg}`;
  }

  if (expr.operator === 'Wildcard') return '_';
  if (expr.operator === 'WildcardSequence') return '__';
  if (expr.operator === 'WildcardOptionalSequence') return '___';

  return null;
}

/**
 * Determine the type of wildcard.
 *
 * @param expr - A Expression or wildcard symbol string
 * @returns
 * - `'Wildcard'` - Universal wildcard (`_` or `_name`), matches exactly one element
 * - `'Sequence'` - Sequence wildcard (`__` or `__name`), matches one or more elements
 * - `'OptionalSequence'` - Optional sequence (`___` or `___name`), matches zero or more elements
 * - `null` - Not a wildcard
 */
export function wildcardType(
  expr: Expression | string
): 'Wildcard' | 'Sequence' | 'OptionalSequence' | null {
  if (typeof expr === 'string') {
    if (expr.startsWith('_')) {
      if (expr.startsWith('__')) {
        if (expr.startsWith('___')) return 'OptionalSequence';
        return 'Sequence';
      }
      return 'Wildcard';
    }
    return null;
  }

  if (isSymbol(expr)) {
    const symbol = expr.symbol;
    if (!symbol.startsWith('_')) return null;
    if (!symbol.startsWith('__')) return 'Wildcard';
    return symbol.startsWith('___') ? 'OptionalSequence' : 'Sequence';
  }

  if (isFunction(expr)) {
    if (expr.operator === 'Wildcard') return 'Wildcard';
    if (expr.operator === 'WildcardSequence') return 'Sequence';
    if (expr.operator === 'WildcardOptionalSequence') return 'OptionalSequence';
  }

  return null;
}

/**
 * Whether a number-literal pattern matches a number-literal subject.
 *
 * Numbers compare by mathematical equality (`isEqual`), so `1.0` matches `1`.
 * `isEqual` follows IEEE for a value with no number (`NaN` is not equal to
 * itself), so a pattern or a subject that is `NaN`
 * compares structurally (`isSame`) instead: `NaN` matches `NaN` and no
 * other number.
 */
export function numberPatternMatches(
  pattern: Expression,
  subject: Expression
): boolean {
  if (pattern.isNaN === true || subject.isNaN === true)
    return pattern.isSame(subject);
  return pattern.isEqual(subject) === true;
}

/**
 * The names of the library symbols that box to a number literal (`NaN` boxes
 * to the `NaN` literal, `PositiveInfinity` to `+∞`, and so on). A raw pattern
 * keeps such a name as a symbol, but an evaluated subject is the number
 * literal, so a pattern symbol with one of these names must be compared as
 * that number literal.
 */
export const NUMBER_LITERAL_SYMBOLS: ReadonlySet<string> = new Set([
  'NaN',
  'Indeterminate',
  'PositiveInfinity',
  'NegativeInfinity',
  'ComplexInfinity',
]);

/** A capture: the wildcard substitution key (`_a`, `__terms`, `___rest`) and
 * the bare parameter name it lowers to in a case body (`a`, `terms`, `rest`). */
export interface Capture {
  key: string;
  name: string;
}

/**
 * Collect the named wildcards of `pattern` in first-occurrence order, deduped
 * by bare name. Anonymous wildcards (`_`, `__`, `___`) capture nothing and are
 * skipped. An operator-position wildcard (`["_f", …]`) is captured too.
 */
export function collectCaptures(pattern: Expression): Capture[] {
  const seen = new Set<string>();
  const result: Capture[] = [];

  const push = (key: string | null): void => {
    if (key === null) return;
    const name = key.replace(/^_+/, '');
    if (name.length === 0 || seen.has(name)) return;
    seen.add(name);
    result.push({ key, name });
  };

  const walk = (expr: Expression): void => {
    if (isWildcard(expr)) {
      push(wildcardName(expr));
      return;
    }
    if (isFunction(expr)) {
      // Pinned expressions are resolved values by now, but be defensive and do
      // not descend into a Pin marker (its content never binds).
      if (expr.operator === 'Pin') return;
      if (expr.operator.startsWith('_')) push(expr.operator);
      for (const op of expr.ops) walk(op);
    }
  };

  walk(pattern);
  return result;
}

/**
 * The external references a `Match` case pattern contributes, for the compiler's
 * reference analysis (`analyzeReferences`):
 * - `captures`: bare names the pattern binds (they shadow the guard/body's free
 *   symbols; not themselves free).
 * - `pinExprs`: the operand of every `["Pin", e]` node — `e` is evaluated in the
 *   enclosing scope at match time, so its free symbols ARE external references.
 */
export function matchPatternReferences(pattern: Expression): {
  captures: string[];
  pinExprs: Expression[];
} {
  const captures = collectCaptures(pattern).map((c) => c.name);
  const pinExprs: Expression[] = [];
  const walk = (e: Expression): void => {
    if (isFunction(e, 'Pin')) {
      if (e.op1 !== undefined) pinExprs.push(e.op1);
      return;
    }
    if (isFunction(e)) for (const op of e.ops) walk(op);
  };
  walk(pattern);
  return { captures, pinExprs };
}

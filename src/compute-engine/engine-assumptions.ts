import type {
  Expression,
  BoxedSubstitution,
  IComputeEngine,
  AssumeResult,
} from './global-types';

import type { MathJsonSymbol } from '../math-json/types';

import { isWildcard, wildcardName } from './boxed-expression/pattern-utils';
import { isSymbol, isFunction } from './boxed-expression/type-guards';

import {
  assume as assumeImpl,
  getInequalityBoundsFromAssumptions,
} from './assume';

import { isLatexString } from './latex-syntax/utils';

export function ask(
  ce: IComputeEngine,
  pattern: Expression
): BoxedSubstitution[] {
  const pat = ce.box(pattern, { form: 'raw' });
  const result: BoxedSubstitution[] = [];

  const patternHasWildcards = (expr: Expression): boolean => {
    if (expr.operator?.startsWith('_')) return true;
    if (isWildcard(expr)) return true;
    if (isFunction(expr)) return expr.ops.some(patternHasWildcards);
    return false;
  };

  const pushResult = (m: BoxedSubstitution) => {
    const keys = Object.keys(m).sort();
    for (const prev of result) {
      const prevKeys = Object.keys(prev).sort();
      if (prevKeys.length !== keys.length) continue;
      let same = true;
      for (let i = 0; i < keys.length; i++) {
        if (prevKeys[i] !== keys[i]) {
          same = false;
          break;
        }
        const k = keys[i]!;
        if (!m[k]!.isSame(prev[k]!)) {
          same = false;
          break;
        }
      }
      if (same) return;
    }
    result.push(m);
  };

  const assumptions = ce.context.assumptions;

  const candidatesFromAssumptions = (): string[] => {
    const candidates = new Set<string>();
    for (const [assumption, val] of assumptions) {
      if (val !== true) continue;
      for (const s of assumption.symbols) candidates.add(s);
    }
    return [...candidates];
  };

  const normalizedInequalityPatterns = (
    expr: Expression
  ): Array<{ pattern: Expression; matchPermutations?: boolean }> => {
    const op = expr.operator;
    if (
      op !== 'Less' &&
      op !== 'LessEqual' &&
      op !== 'Greater' &&
      op !== 'GreaterEqual'
    )
      return [{ pattern: expr }];

    if (!isFunction(expr)) return [{ pattern: expr }];
    const lhs = op === 'Greater' || op === 'GreaterEqual' ? expr.op2 : expr.op1;
    const rhs = op === 'Greater' || op === 'GreaterEqual' ? expr.op1 : expr.op2;
    const normalizedOp =
      op === 'Less' || op === 'Greater' ? 'Less' : 'LessEqual';

    // Normalize to Less/LessEqual with RHS = 0, matching how assumptions are stored:
    //   Greater(a, b) -> Less(b - a, 0)
    //   Less(a, b)    -> Less(a - b, 0)
    const diff = ce.box(['Add', lhs, ['Negate', rhs]], {
      form: 'raw',
    });
    return [
      { pattern: expr },
      // For the normalized form, disable permutations: for commutative
      // subexpressions (notably Add), allowing permutations can lead to
      // ambiguous wildcard bindings and duplicate, surprising matches.
      {
        pattern: ce.box([normalizedOp, diff, 0], { form: 'raw' }),
        matchPermutations: false,
      },
    ];
  };

  // B1: Element(x, _T) can be answered from the declared/inferred type of x
  if (pat.operator === 'Element' && isFunction(pat)) {
    const patOp1 = pat.op1;
    const patOp2 = pat.op2;
    if (isSymbol(patOp1) && isWildcard(patOp2)) {
      const typeWildcard = wildcardName(patOp2);
      if (typeWildcard && !typeWildcard.startsWith('__')) {
        const symbolType = ce.box(patOp1.symbol).type;
        if (!symbolType.isUnknown) {
          pushResult({
            [typeWildcard]: ce.box(symbolType.toString(), {
              form: 'raw',
            }),
          });
        }
      }
    }
  }

  // B2: Inequality bound queries, e.g. Greater(x, _k) -> {_k: lowerBound}
  if (
    (pat.operator === 'Greater' ||
      pat.operator === 'GreaterEqual' ||
      pat.operator === 'Less' ||
      pat.operator === 'LessEqual') &&
    isFunction(pat) &&
    isWildcard(pat.op2)
  ) {
    const boundWildcard = wildcardName(pat.op2);
    if (boundWildcard && !boundWildcard.startsWith('__')) {
      const isLower =
        pat.operator === 'Greater' || pat.operator === 'GreaterEqual';
      const isStrict = pat.operator === 'Greater' || pat.operator === 'Less';

      // Symbol on LHS: Greater(x, _k)
      const patOp1B2 = pat.op1;
      if (isSymbol(patOp1B2)) {
        const bounds = getInequalityBoundsFromAssumptions(ce, patOp1B2.symbol);
        const bound = isLower ? bounds.lowerBound : bounds.upperBound;
        const strictOk = isLower ? bounds.lowerStrict : bounds.upperStrict;
        if (bound !== undefined && (!isStrict || strictOk === true))
          pushResult({ [boundWildcard]: bound });
      }

      // Wildcard on LHS: Greater(_x, _k)
      if (isWildcard(patOp1B2)) {
        const symbolWildcard = wildcardName(patOp1B2);
        if (symbolWildcard && !symbolWildcard.startsWith('__')) {
          for (const s of candidatesFromAssumptions()) {
            const bounds = getInequalityBoundsFromAssumptions(ce, s);
            const bound = isLower ? bounds.lowerBound : bounds.upperBound;
            const strictOk = isLower ? bounds.lowerStrict : bounds.upperStrict;
            if (bound === undefined || (isStrict && strictOk !== true))
              continue;
            pushResult({
              [symbolWildcard]: ce.box(s, { form: 'canonical' }),
              [boundWildcard]: bound,
            });
          }
        }
      }
    }
  }

  const patternsToTry = normalizedInequalityPatterns(pat);
  for (const [assumption, val] of assumptions) {
    if (val !== true) continue;
    for (const { pattern: p, matchPermutations } of patternsToTry) {
      const m = assumption.match(p, {
        useVariations: true,
        matchPermutations,
      });
      if (m !== null) pushResult(m);
    }
  }

  // B3: For closed predicates (no wildcards), fall back to verify().
  // This makes `ask()` useful for "is this known?" queries even when the
  // fact is not explicitly stored in the assumptions DB (e.g. declarations).
  //
  // IMPORTANT: Skip this if we're already inside a verify() call to prevent
  // infinite recursion. The recursion occurs when:
  //   verify(Equal(x,0)) → Equal.evaluate() → eq() → ask(NotEqual(x,0)) → verify()
  // By checking _isVerifying, we break this cycle.
  if (result.length === 0 && !patternHasWildcards(pat) && !ce._isVerifying) {
    // Use the canonical form so symbol declarations/definitions are visible
    // to the evaluator.
    const verified = verify(ce, ce.box(pattern, { form: 'canonical' }));
    if (verified === true) pushResult({});
  }

  return result;
}

export function verify(
  ce: IComputeEngine,
  query: Expression
): boolean | undefined {
  // Prevent recursive verify() -> ask() -> verify() loops
  if (ce._isVerifying) return undefined;

  ce._isVerifying = true;
  try {
    const boxed = isLatexString(query)
      ? ce.parse(query, { form: 'raw' })
      : ce.box(query, { form: 'raw' });

    const expr = boxed.evaluate();
    if (isSymbol(expr)) {
      if (expr.symbol === 'True') return true;
      if (expr.symbol === 'False') return false;
    }

    const op = expr.operator;

    if (op === 'Not' && isFunction(expr)) {
      const result = verify(ce, expr.op1);
      if (result === undefined) return undefined;
      return !result;
    }

    if (op === 'And' && isFunction(expr)) {
      // Kleene 3-valued logic:
      // - if any operand is false, the result is false
      // - if all operands are true, the result is true
      // - otherwise the result is unknown
      let hasUnknown = false;
      for (const x of expr.ops) {
        const r = verify(ce, x);
        if (r === false) return false;
        if (r === undefined) hasUnknown = true;
      }
      return hasUnknown ? undefined : true;
    }

    if (op === 'Or' && isFunction(expr)) {
      // Kleene 3-valued logic:
      // - if any operand is true, the result is true
      // - if all operands are false, the result is false
      // - otherwise the result is unknown
      let hasUnknown = false;
      for (const x of expr.ops) {
        const r = verify(ce, x);
        if (r === true) return true;
        if (r === undefined) hasUnknown = true;
      }
      return hasUnknown ? undefined : false;
    }

    return undefined;
  } finally {
    ce._isVerifying = false;
  }
}

export function assumeFn(
  ce: IComputeEngine,
  predicate: Expression
): AssumeResult {
  try {
    const pred = isLatexString(predicate)
      ? ce.parse(predicate, { form: 'raw' })
      : ce.box(predicate, { form: 'raw' });

    // The new assumption could affect existing expressions
    ce._generation += 1;

    return assumeImpl(pred);
  } catch (e) {
    console.error(e.message.toString());
    throw e;
  }
}

export function forget(
  ce: IComputeEngine,
  symbol: undefined | MathJsonSymbol | MathJsonSymbol[]
): void {
  //
  // ## THEORY OF OPERATIONS
  //
  // When forgeting we need to preserve existing definitions for symbols,
  // as some expressions may be pointing to them. Instead, we
  // reset the value of those definitions, but don't change the domain.
  //

  if (symbol === undefined) {
    ce.context.assumptions?.clear();

    // The removed assumptions could affect existing expressions
    ce._generation += 1;

    return;
  }

  if (Array.isArray(symbol)) {
    for (const x of symbol) forget(ce, x);
    return;
  }

  if (typeof symbol === 'string') {
    // Remove any assumptions that make a reference to this symbol
    // (note that when a scope is created, any assumptions from the
    // parent scope are copied over, so this effectively removes any
    // reference to this symbol, even if there are assumptions about
    // it in a parent scope. However, when the current scope exits,
    // any previous assumptions about the symbol will be restored).
    for (const [assumption, _val] of ce.context.assumptions) {
      if (assumption.has(symbol)) ce.context.assumptions.delete(assumption);
    }

    // Also clear any values that were set for this symbol in the evaluation context.
    // Values can be stored in any frame of the context stack, so we need to check all of them.
    for (const ctx of ce._evalContextStack) {
      if (symbol in ctx.values) {
        delete ctx.values[symbol];
      }
    }
  }
  // The removed assumptions could affect existing expressions
  ce._generation += 1;
}

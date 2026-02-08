import { isSubtype } from '../common/type/subtype';
import { functionResult } from '../common/type/utils';
import { BoxedType } from '../common/type/boxed-type';

import {
  AssumeResult,
  BoxedExpression,
  IComputeEngine as ComputeEngine,
  Sign,
} from './global-types';

import { findUnivariateRoots } from './boxed-expression/solve';
import {
  domainToType,
  isValueDef,
  isOperatorDef,
} from './boxed-expression/utils';
import { isInequalityOperator } from './latex-syntax/utils';

/**
 * Infer a promoted type from a value expression.
 * This promotes specific types to more general ones suitable for symbols:
 * - finite_integer -> integer
 * - rational -> real
 * - finite_real_number -> real
 * - complex/imaginary -> number
 */
function inferTypeFromValue(
  ce: ComputeEngine,
  value: BoxedExpression
): BoxedType {
  // finite_integer, integer, etc. -> integer
  if (value.type.matches('integer')) return ce.type('integer');

  // rational -> real
  if (value.type.matches('rational')) return ce.type('real');

  // finite_real_number, real -> real
  if (value.type.matches('real')) return ce.type('real');

  // complex, imaginary -> number
  if (value.type.matches('complex')) return ce.type('number');
  return value.type;
}

/**
 * Add an assumption, in the form of a predicate, for example:
 *
 * - `x = 5`
 * - `x ∈ ℕ`
 * - `x > 3`
 * - `x + y = 5`
 *
 * Assumptions that represent a value definition (equality to an expression,
 * membership to a type, >0, <=0, etc...) are stored directly in the current
 * scope's symbols dictionary, and an entry for the symbol is created if
 * necessary.
 *
 * Predicates that involve multiple symbols are simplified (for example
 * `x + y = 5` becomes `x + y - 5 = 0`), then stored in the `assumptions`
 * record of the current context.
 *
 * New assumptions can 'refine' previous assumptions, if they don't contradict
 * previous assumptions.
 *
 * To set new assumptions that contradict previous ones, you must first
 * `forget` about any symbols in the new assumption.
 *
 */

export function assume(proposition: BoxedExpression): AssumeResult {
  if (proposition.operator === 'Element') return assumeElement(proposition);
  if (proposition.operator === 'Equal') return assumeEquality(proposition);
  if (isInequalityOperator(proposition.operator))
    return assumeInequality(proposition);

  throw new Error(
    'Unsupported assumption. Use `Element`, `Equal` or an inequality'
  );
}

function assumeEquality(proposition: BoxedExpression): AssumeResult {
  console.assert(proposition.operator === 'Equal');
  // Four cases:
  // 1/ proposition contains no unknowns
  //    e.g. `2 + 1 = 3`, `\pi + 1 = \pi`
  //    => evaluate and return
  //
  // 2/ lhs is a single unknown and `rhs` does not contain `lhs`
  //    e.g. `x = 2`, `x = 2\pi`
  //    => if `lhs` has a definition, set its value to `rhs`, otherwise
  //          declare a new symbol with a value of `rhs`
  //
  // 3/ proposition contains a single unknown
  //    => solve for the unknown, create new def or set value of the
  //      unknown with the root(s) as value
  //
  // 4/ proposition contains multiple unknowns
  //    => add (lhs - rhs = 0) to assumptions DB

  // Case 1
  const unknowns = proposition.unknowns;
  if (unknowns.length === 0) {
    const val = proposition.evaluate();
    if (val.symbol === 'True') return 'tautology';
    if (val.symbol === 'False') return 'contradiction';
    console.log(proposition.canonical.evaluate());
    return 'not-a-predicate';
  }

  const ce = proposition.engine;

  // Case 2
  // @todo: this is dubious. Should we allow this?
  // i.e. `ce.assume(ce.parse("x = 3"))`
  // that's not really an assumption, that's an assignment.
  // Assumptions are meant to be complementary to declarations, not replacing
  // them, i.e. `ce.assume(ce.parse("x > 0"))`
  const lhs = proposition.op1.symbol;
  if (lhs && !hasValue(ce, lhs) && !proposition.op2.has(lhs)) {
    const val = proposition.op2.evaluate();
    if (!val.isValid) return 'not-a-predicate';
    const def = ce.lookupDefinition(lhs);
    if (!def || !isValueDef(def)) {
      ce.declare(lhs, { value: val });
      return 'ok';
    }
    if (def.value.type && !val.type.matches(def.value.type))
      if (!def.value.inferredType) return 'contradiction';

    // Set the value for the symbol with an existing definition.
    // Use _setCurrentContextValue so the value is scoped to the current context
    // and will be automatically removed when the scope is popped.
    ce._setCurrentContextValue(lhs, val);
    // If the type was inferred, update it based on the value.
    // Use inferTypeFromValue to promote specific types (e.g., finite_integer -> integer)
    if (def.value.inferredType) def.value.type = inferTypeFromValue(ce, val);
    return 'ok';
  }

  // Case 3
  if (unknowns.length === 1) {
    const lhs = unknowns[0];
    const sols = findUnivariateRoots(proposition, lhs);
    if (sols.length === 0) {
      ce.context.assumptions.set(
        ce.function('Equal', [proposition.op1.sub(proposition.op2), 0]),
        true
      );
    }

    const val = sols.length === 1 ? sols[0] : ce.function('List', sols);
    const def = ce.lookupDefinition(lhs);
    if (!def || !isValueDef(def)) {
      ce.declare(lhs, { value: val });
      return 'ok';
    }
    if (
      def.value.type &&
      !sols.every((sol) => !sol.type || val.type.matches(sol.type))
    )
      return 'contradiction';
    // Set the value for the symbol with an existing definition.
    // Use _setCurrentContextValue so the value is scoped to the current context
    // and will be automatically removed when the scope is popped.
    ce._setCurrentContextValue(lhs, val);
    // If the type was inferred, update it based on the value.
    // Use inferTypeFromValue to promote specific types (e.g., finite_integer -> integer)
    if (def.value.inferredType) def.value.type = inferTypeFromValue(ce, val);
    return 'ok';
  }

  ce.context.assumptions.set(proposition, true);
  return 'ok';
}

function assumeInequality(proposition: BoxedExpression): AssumeResult {
  //
  // 1/ lhs is a single **undefined** free var e.g. "x < 0"
  //    => define a new var, if the domain can be inferred set it, otherwise
  // RealNumbers and add to assumptions (e.g. x < 5)
  // 2/ (lhs - rhs) is an expression with no free vars
  //  e.g. "\pi < 5"
  //  => evaluate
  // 3/ (lhs - rhs) is an expression with a single **undefined** free var
  //    e.g. "x + 1 < \pi"
  //    => add def as RealNumbers, add to assumptions
  // 4/ (lhs - rhs) is an expression with multiple free vars
  //    e.g. x + y < 0
  //    => add to assumptions

  const ce = proposition.engine;
  // Case 1
  // if (proposition.op1!.symbol && !hasDef(ce, proposition.op1!.symbol)) {
  //   if (proposition.op2.is(0)) {
  //     if (proposition.operator === 'Less') {
  //       // x < 0
  //       ce.defineSymbol(proposition.op1.symbol, {
  //         type: 'real',
  //         flags: { sgn: 'negative' },
  //       });
  //     } else if (proposition.operator === 'LessEqual') {
  //       // x <= 0
  //       ce.defineSymbol(proposition.op1.symbol, {
  //         type: 'real',
  //         flags: { sgn: 'non-positive' },
  //       });
  //     } else if (proposition.operator === 'Greater') {
  //       // x > 0
  //       ce.defineSymbol(proposition.op1.symbol, {
  //         type: 'real',
  //         flags: { sgn: 'positive' },
  //       });
  //     } else if (proposition.operator === 'GreaterEqual') {
  //       // x >= 0
  //       ce.defineSymbol(proposition.op1.symbol, {
  //         type: 'real',
  //         flags: { sgn: 'non-negative' },
  //       });
  //     }
  //   } else {
  //     ce.defineSymbol(proposition.op1.symbol, { type: 'real' });
  //     ce.context.assumptions.set(proposition, true);
  //   }
  //   return 'ok';
  // }
  // // @todo: handle if proposition.op1 *has* a def (and no value)

  // Normalize to Less, LessEqual
  let op = '';
  let lhs: BoxedExpression;
  let rhs: BoxedExpression;
  if (proposition.operator === 'Less') {
    lhs = proposition.op1;
    rhs = proposition.op2;
    op = '<';
  } else if (proposition.operator === 'LessEqual') {
    lhs = proposition.op1;
    rhs = proposition.op2;
    op = '<=';
  } else if (proposition.operator === 'Greater') {
    lhs = proposition.op2;
    rhs = proposition.op1;
    op = '<';
  } else if (proposition.operator === 'GreaterEqual') {
    lhs = proposition.op2;
    rhs = proposition.op1;
    op = '<=';
  }
  if (!op) return 'internal-error';
  const p = lhs!.sub(rhs!);

  // Case 2
  const result = ce.box([op === '<' ? 'Less' : 'LessEqual', p, 0]).evaluate();

  if (result.symbol === 'True') return 'tautology';
  if (result.symbol === 'False') return 'contradiction';

  const unknowns = result.unknowns;
  if (unknowns.length === 0) return 'not-a-predicate';

  // Check if the new inequality is implied by or contradicts existing bounds
  // (for single-symbol inequalities)
  if (unknowns.length === 1) {
    const symbol = unknowns[0];
    const bounds = getInequalityBoundsFromAssumptions(ce, symbol);

    // The normalized form is Less(p, 0) or LessEqual(p, 0) where p = lhs - rhs
    // For a simple symbol case like "x > k", this becomes Less(-x + k, 0) meaning k - x < 0, i.e., x > k
    // For "x < k", this becomes Less(x - k, 0) meaning x - k < 0, i.e., x < k

    // Check if this is a simple "symbol > value" or "symbol < value" case
    const originalOp = proposition.operator;
    const isSymbolOnLeft = proposition.op1.symbol === symbol;
    const otherSide = isSymbolOnLeft ? proposition.op2 : proposition.op1;

    // Only do bounds checking for simple comparisons like "x > k" where k is numeric
    if (otherSide.numericValue !== null) {
      const k = otherSide.numericValue;

      if (typeof k === 'number' && isFinite(k)) {
        // Determine the EFFECTIVE relationship based on operator and symbol position
        // Less(a, b) means a < b:
        //   - if a is symbol: symbol < b, effective is "less"
        //   - if b is symbol: a < symbol, so symbol > a, effective is "greater"
        // Greater(a, b) means a > b:
        //   - if a is symbol: symbol > b, effective is "greater"
        //   - if b is symbol: a > symbol, so symbol < a, effective is "less"
        let effectiveOp: 'greater' | 'greaterEqual' | 'less' | 'lessEqual';
        if (originalOp === 'Greater') {
          effectiveOp = isSymbolOnLeft ? 'greater' : 'less';
        } else if (originalOp === 'GreaterEqual') {
          effectiveOp = isSymbolOnLeft ? 'greaterEqual' : 'lessEqual';
        } else if (originalOp === 'Less') {
          effectiveOp = isSymbolOnLeft ? 'less' : 'greater';
        } else {
          // LessEqual
          effectiveOp = isSymbolOnLeft ? 'lessEqual' : 'greaterEqual';
        }

        // Check for tautologies and contradictions based on existing bounds
        if (effectiveOp === 'greater' || effectiveOp === 'greaterEqual') {
          // We're asserting symbol > k or symbol >= k
          const isStrict = effectiveOp === 'greater';

          if (bounds.lowerBound !== undefined) {
            const lowerVal = bounds.lowerBound.numericValue;
            if (typeof lowerVal === 'number' && isFinite(lowerVal)) {
              // We already know symbol > lowerVal (or >=)
              if (isStrict) {
                // Assuming symbol > k: tautology if existing lower bound implies this
                // If lowerVal > k, then symbol > lowerVal > k, so symbol > k (tautology)
                // If lowerVal == k and bound is strict, then symbol > lowerVal = k (tautology)
                if (lowerVal > k) return 'tautology';
                if (bounds.lowerStrict && lowerVal >= k) return 'tautology';
              } else {
                // Assuming symbol >= k: tautology if lowerVal >= k (with strict bound) or lowerVal > k
                if (lowerVal > k) return 'tautology';
                if (bounds.lowerStrict && lowerVal >= k) return 'tautology';
                if (!bounds.lowerStrict && lowerVal >= k) return 'tautology';
              }
            }
          }

          if (bounds.upperBound !== undefined) {
            const upperVal = bounds.upperBound.numericValue;
            if (typeof upperVal === 'number' && isFinite(upperVal)) {
              // We know symbol < upperVal (or <=), now checking symbol > k
              if (isStrict) {
                // Contradiction if upperVal <= k
                if (upperVal < k) return 'contradiction';
                if (bounds.upperStrict && upperVal <= k) return 'contradiction';
                if (!bounds.upperStrict && upperVal <= k)
                  return 'contradiction';
              } else {
                // symbol >= k: contradiction if upperVal < k
                if (upperVal < k) return 'contradiction';
                if (bounds.upperStrict && upperVal <= k) return 'contradiction';
              }
            }
          }
        } else {
          // effectiveOp is 'less' or 'lessEqual'
          // We're asserting symbol < k or symbol <= k
          const isStrict = effectiveOp === 'less';

          if (bounds.upperBound !== undefined) {
            const upperVal = bounds.upperBound.numericValue;
            if (typeof upperVal === 'number' && isFinite(upperVal)) {
              // We already know symbol < upperVal (or <=)
              if (isStrict) {
                // Assuming symbol < k: tautology if existing upper bound implies this
                if (upperVal < k) return 'tautology';
                if (bounds.upperStrict && upperVal <= k) return 'tautology';
              } else {
                // symbol <= k: tautology if upperVal <= k
                if (upperVal < k) return 'tautology';
                if (upperVal <= k) return 'tautology';
              }
            }
          }

          if (bounds.lowerBound !== undefined) {
            const lowerVal = bounds.lowerBound.numericValue;
            if (typeof lowerVal === 'number' && isFinite(lowerVal)) {
              // We know symbol > lowerVal (or >=), now checking symbol < k
              if (isStrict) {
                // Contradiction if lowerVal >= k
                if (lowerVal > k) return 'contradiction';
                if (bounds.lowerStrict && lowerVal >= k) return 'contradiction';
                if (!bounds.lowerStrict && lowerVal >= k)
                  return 'contradiction';
              } else {
                // symbol <= k: contradiction if lowerVal > k
                if (lowerVal > k) return 'contradiction';
                if (bounds.lowerStrict && lowerVal > k) return 'contradiction';
              }
            }
          }
        }
      }
    }
  }

  // Case 3: single unknown - ensure the symbol has type 'real'
  // (inequalities imply the symbol is a real number)
  if (unknowns.length === 1) {
    const symbol = unknowns[0];
    const def = ce.lookupDefinition(symbol);
    if (!def) {
      // Symbol not defined yet - declare with type 'real'
      ce.declare(symbol, { type: 'real' });
    } else if (isValueDef(def) && def.value.inferredType) {
      // Symbol was auto-declared with inferred type - update to 'real'
      def.value.type = ce.type('real');
    }
  }

  // Case 3, 4
  console.assert(result.operator === 'Less' || result.operator === 'LessEqual');
  ce.context.assumptions.set(result, true);
  return 'ok';
}

function assumeElement(proposition: BoxedExpression): AssumeResult {
  console.assert(proposition.operator === 'Element');

  // Four cases:
  // 1/ lhs is a single free variable with no definition
  //    e.g. `x \in \R`
  //    => define a new var with the specified domain
  //
  // 2/ lhs is a symbol with a definition
  //    => update domain, if compatible
  //
  // 3/ lhs is an expression with some free variables with no definition
  //    => add to assumptions DB
  //
  // 4/ otherwise  (expression)
  //    e.g. `x+2 \in \R`
  //    => evaluate and return result (contradiction or tautology)

  const ce = proposition.engine;
  // Note: this is not 'unknowns' because proposition is not canonical (so all symbols are "unknowns")
  const undefs = undefinedIdentifiers(proposition.op1);
  // Case 1
  if (undefs.length === 1) {
    const dom = proposition.op2.evaluate();
    if (!dom.isValid) return 'not-a-predicate';

    const type = domainToType(dom);
    if (type === 'unknown')
      throw new Error(`Invalid domain "${dom.toString()}"`);

    ce.declare(undefs[0], type);
    return 'ok';
  }

  // Case 2
  if (proposition.op1.symbol && hasDef(ce, proposition.op1.symbol)) {
    const domain = proposition.op2.evaluate();
    if (!domain.isValid) return 'not-a-predicate';
    const type = domainToType(domain);

    if (!ce.context?.lexicalScope?.bindings.has(proposition.op1.symbol))
      ce.declare(proposition.op1.symbol, domainToType(domain));

    const def = ce.lookupDefinition(proposition.op1.symbol);
    if (isValueDef(def)) {
      if (def.value.type && !isSubtype(type, def.value.type.type))
        return 'contradiction';
      def.value.type = new BoxedType(type, ce._typeResolver);
      return 'ok';
    }
    if (isOperatorDef(def)) {
      if (!isSubtype(type, functionResult(def.operator.signature.type)!))
        return 'contradiction';

      return 'ok';
    }
    return 'not-a-predicate';
  }

  // Case 3
  if (undefs.length > 0) {
    ce.context.assumptions.set(proposition, true);
    return 'ok';
  }

  // Case 4
  const val = proposition.evaluate();
  if (val.symbol === 'True') return 'tautology';
  if (val.symbol === 'False') return 'contradiction';
  return 'not-a-predicate';
}

function hasDef(ce: ComputeEngine, s: string): boolean {
  return ce.lookupDefinition(s) !== undefined;
}

function undefinedIdentifiers(expr: BoxedExpression): string[] {
  return expr.symbols.filter((x) => !hasDef(expr.engine, x));
}

function hasValue(ce: ComputeEngine, s: string): boolean {
  const def = ce.lookupDefinition(s);
  if (!def) return false;

  if (isValueDef(def) && def.value.isConstant) return true;

  if (ce._getSymbolValue(s) !== undefined) return true;
  return false;
}

/**
 * Query assumptions to determine the sign of a symbol.
 *
 * Examines inequality assumptions in the current context to determine
 * if a symbol's sign can be inferred. Assumptions are stored in normalized
 * form (Less or LessEqual with lhs-rhs compared to 0), so:
 * - `x > 0` is stored as `Less(-x, 0)` meaning `-x < 0`
 * - `x >= 0` is stored as `LessEqual(-x, 0)` meaning `-x <= 0`
 * - `x < 0` is stored as `Less(x, 0)` meaning `x < 0`
 * - `x <= 0` is stored as `LessEqual(x, 0)` meaning `x <= 0`
 *
 * @param ce - The compute engine instance
 * @param symbol - The symbol name to query
 * @returns The inferred sign, or undefined if no relevant assumptions found
 */
export function getSignFromAssumptions(
  ce: ComputeEngine,
  symbol: string
): Sign | undefined {
  const assumptions = ce.context?.assumptions;
  if (!assumptions) return undefined;

  for (const [assumption, _] of assumptions.entries()) {
    const op = assumption.operator;
    if (!op) continue;

    // Assumptions are normalized to Less or LessEqual
    if (op !== 'Less' && op !== 'LessEqual') continue;

    const ops = assumption.ops;
    if (!ops || ops.length !== 2) continue;

    const [lhs, rhs] = ops;

    // Check if RHS is 0 (normalized form: expr < 0 or expr <= 0)
    if (!rhs.is(0)) continue;

    // Case 1: Direct symbol comparison
    // x < 0 means x is negative
    // x <= 0 means x is non-positive
    if (lhs.symbol === symbol) {
      if (op === 'Less') return 'negative';
      if (op === 'LessEqual') return 'non-positive';
    }

    // Case 2: Negated symbol comparison
    // -x < 0 means x > 0 (positive)
    // -x <= 0 means x >= 0 (non-negative)
    if (lhs.operator === 'Negate' && lhs.op1?.symbol === symbol) {
      if (op === 'Less') return 'positive';
      if (op === 'LessEqual') return 'non-negative';
    }

    // Case 3: Symbol with subtraction from constant
    // a - x < 0 means x > a, so if a >= 0, x is positive
    // x - a < 0 means x < a, so if a <= 0, x is negative
    if (lhs.operator === 'Subtract') {
      const [a, b] = lhs.ops ?? [];
      if (a && b) {
        // a - x < 0 => x > a
        if (b.symbol === symbol && a.isNonNegative === true) {
          if (op === 'Less') return 'positive';
        }
        // x - a < 0 => x < a
        if (a.symbol === symbol && b.isNonPositive === true) {
          if (op === 'Less') return 'negative';
        }
      }
    }

    // Case 4: Addition form (canonical form of subtraction)
    // x + (-a) < 0 means x < a, so if a <= 0, x is negative
    // -x + a < 0 means -x < -a means x > a, so if a >= 0, x is positive
    if (lhs.operator === 'Add' && lhs.ops) {
      for (const term of lhs.ops) {
        // Direct symbol in sum: check if other terms give us bounds
        if (term.symbol === symbol) {
          // x + ... < 0, check if other terms are all non-negative
          // That would mean x < -(sum of others), so x < non-positive = negative
          const otherTerms = lhs.ops.filter((t) => t !== term);
          if (
            otherTerms.length > 0 &&
            otherTerms.every((t) => t.isNonNegative === true)
          ) {
            if (op === 'Less') return 'negative';
            if (op === 'LessEqual') return 'non-positive';
          }
        }
        // Negated symbol in sum: -x + ... < 0
        if (term.operator === 'Negate' && term.op1?.symbol === symbol) {
          // -x + ... < 0 means x > ...
          const otherTerms = lhs.ops.filter((t) => t !== term);
          if (
            otherTerms.length > 0 &&
            otherTerms.every((t) => t.isNonPositive === true)
          ) {
            if (op === 'Less') return 'positive';
            if (op === 'LessEqual') return 'non-negative';
          }
        }
      }
    }
  }

  return undefined;
}

// Re-export from its new home for backward compatibility
import { getInequalityBoundsFromAssumptions } from './boxed-expression/inequality-bounds';
export { getInequalityBoundsFromAssumptions };

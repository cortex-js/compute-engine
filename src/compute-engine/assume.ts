import { isSubtype } from '../common/type/subtype';
import { functionResult } from '../common/type/utils';
import { BoxedType } from '../common/type/boxed-type';
import type { Type } from '../common/type/types';

import {
  AssumeResult,
  Expression,
  IComputeEngine as ComputeEngine,
  IntervalBounds,
  Sign,
} from './global-types';

import { findUnivariateRoots } from './boxed-expression/solve';
import {
  domainToType,
  isValueDef,
  isOperatorDef,
} from './boxed-expression/utils';
import { isInequalityOperator } from './latex-syntax/utils';
import {
  isFunction,
  isSymbol,
  isNumber,
  isString,
} from './boxed-expression/type-guards';
import {
  type Subject,
  subjectOf,
  toSubject,
  matchesSubject,
  boundsFromNormalizedInequality,
} from './boxed-expression/constraint-subject';

/**
 * Infer a promoted type from a value expression.
 * This promotes specific types to more general ones suitable for symbols:
 * - finite_integer -> integer
 * - rational -> real
 * - finite_real_number -> real
 * - complex/imaginary -> number
 */
function inferTypeFromValue(ce: ComputeEngine, value: Expression): BoxedType {
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

export function assume(proposition: Expression): AssumeResult {
  const op = proposition.operator;
  if (op === 'Element') return assumeElement(proposition);
  if (op === 'NotElement') return assumeNotElement(proposition);
  if (op === 'Equal') return assumeEquality(proposition);
  if (op === 'NotEqual') return assumeNotEqual(proposition);
  if (op === 'And') return assumeConjunction(proposition);
  if (isInequalityOperator(op)) return assumeInequality(proposition);

  // Well-formed predicate shapes that the assumptions layer cannot
  // represent (disjunctions, quantifiers...): return 'not-a-predicate'
  // instead of throwing, so callers (e.g. the Fungrim loader) can probe
  // guard dischargeability in bulk (design §4.1, §9).
  if (UNSUPPORTED_PREDICATE_OPERATORS.has(op)) return 'not-a-predicate';

  // Outright malformed input (not a predicate operator at all) still throws.
  throw new Error(
    'Unsupported assumption. Use `Element`, `NotElement`, `Equal`, `NotEqual`, `And` or an inequality'
  );
}

/**
 * Predicate operators that are syntactically valid assumptions but that the
 * structural-predicate layer cannot represent (docs/fungrim/FUNGRIM-PLAN-3-ASSUMPTIONS.md
 * §7 non-goals). `assume()` reports these as `'not-a-predicate'`.
 */
const UNSUPPORTED_PREDICATE_OPERATORS = new Set<string>([
  'Or',
  'Not',
  'Implies',
  'Equivalent',
  'Xor',
  'Nand',
  'Nor',
  'ForAll',
  'Exists',
  'ExistsUnique',
  'ForElement',
]);

/**
 * Assume a conjunction: each conjunct is assumed independently
 * (design §3.2, "shallow saturation").
 *
 * Result: `'contradiction'` if any conjunct contradicts,
 * `'not-a-predicate'` if any conjunct is unsupported, `'tautology'` if
 * every conjunct was already known, `'ok'` otherwise.
 */
function assumeConjunction(proposition: Expression): AssumeResult {
  console.assert(proposition.operator === 'And');
  if (!isFunction(proposition)) return 'not-a-predicate';

  let sawOk = false;
  let sawNotAPredicate = false;
  for (const conjunct of proposition.ops) {
    const result = assume(conjunct);
    if (result === 'contradiction' || result === 'internal-error')
      return result;
    if (result === 'not-a-predicate') sawNotAPredicate = true;
    else if (result === 'ok') sawOk = true;
  }
  if (sawNotAPredicate) return 'not-a-predicate';
  return sawOk ? 'ok' : 'tautology';
}

/**
 * Assume a disequality `NotEqual(x, v)` or `NotEqual(Part(x), v)`
 * (design §4.1; stored in the §3.2 normal form `NotEqual(subject, v)`).
 */
function assumeNotEqual(proposition: Expression): AssumeResult {
  console.assert(proposition.operator === 'NotEqual');
  if (!isFunction(proposition) || proposition.ops.length !== 2)
    return 'not-a-predicate';
  return storeNotEqual(proposition.engine, proposition.op1, proposition.op2);
}

/**
 * Store a `NotEqual(lhs, rhs)` fact in the assumptions DB.
 *
 * Contradiction scope (design §4.3): if neither side has unknowns (e.g.
 * the symbol has an assigned value), the disequality is decided now and
 * yields `'tautology'`/`'contradiction'` instead of being stored.
 */
function storeNotEqual(
  ce: ComputeEngine,
  lhs: Expression,
  rhs: Expression
): AssumeResult {
  const fact = ce.function('NotEqual', [lhs, rhs]);
  if (!fact.isValid) return 'not-a-predicate';

  if (fact.unknowns.length === 0) {
    const val = fact.evaluate();
    if (isSymbol(val, 'True')) return 'tautology';
    if (isSymbol(val, 'False')) return 'contradiction';
  }

  ce.context.assumptions.set(fact, true);
  return 'ok';
}

/**
 * Assume `NotElement(x, S)`: store an exclusion fact (design §4.1).
 */
function assumeNotElement(proposition: Expression): AssumeResult {
  console.assert(proposition.operator === 'NotElement');
  if (!isFunction(proposition) || proposition.ops.length !== 2)
    return 'not-a-predicate';
  const ce = proposition.engine;
  const dom = proposition.op2.evaluate();
  if (!dom.isValid) return 'not-a-predicate';
  return storeNotElement(ce, proposition.op1, dom);
}

/**
 * Store a `NotElement(x, setExpr)` exclusion fact in the assumptions DB.
 * If `x` has a value, the exclusion is decided by evaluation instead.
 */
function storeNotElement(
  ce: ComputeEngine,
  x: Expression,
  setExpr: Expression
): AssumeResult {
  const fact = ce.function('NotElement', [x, setExpr]);
  if (!fact.isValid) return 'not-a-predicate';

  const xSymbol = isSymbol(x) ? x.symbol : undefined;
  if (xSymbol === undefined || hasValue(ce, xSymbol)) {
    const val = fact.evaluate();
    if (isSymbol(val, 'True')) return 'tautology';
    if (isSymbol(val, 'False')) return 'contradiction';
  }

  ce.context.assumptions.set(fact, true);
  return 'ok';
}

function assumeEquality(proposition: Expression): AssumeResult {
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
    if (isSymbol(val, 'True')) return 'tautology';
    if (isSymbol(val, 'False')) return 'contradiction';
    return 'not-a-predicate';
  }

  const ce = proposition.engine;

  // Case 2
  // @todo: this is dubious. Should we allow this?
  // i.e. `ce.assume(ce.parse("x = 3"))`
  // that's not really an assumption, that's an assignment.
  // Assumptions are meant to be complementary to declarations, not replacing
  // them, i.e. `ce.assume(ce.parse("x > 0"))`
  if (!isFunction(proposition)) return 'not-a-predicate';
  const lhsExpr = proposition.op1;
  const lhs = isSymbol(lhsExpr) ? lhsExpr.symbol : undefined;
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

    // Set the value for the symbol, scoped to the current context so the
    // assumed value is automatically reverted when this scope is popped.
    // If lhs is declared in a parent scope, shadow it in the current scope
    // so we don't permanently mutate the parent definition.
    if (!ce.context.lexicalScope.bindings.has(lhs)) {
      ce.declare(lhs, { value: val });
    } else {
      // Set the (inferred) type *before* the value. The `set type` accessor
      // resets `_value` when the new type is `unknown` (which `inferTypeFromValue`
      // yields for a free-symbol rhs like `a = b`); doing it after
      // `_setSymbolValue` would silently wipe the assigned value. Setting the
      // value last guarantees it survives.
      if (def.value.inferredType) def.value.type = inferTypeFromValue(ce, val);
      ce._setSymbolValue(lhs, val);
    }
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
    // Set the value for the symbol, scoped to the current context so the
    // assumed value is automatically reverted when this scope is popped.
    if (!ce.context.lexicalScope.bindings.has(lhs)) {
      ce.declare(lhs, { value: val });
    } else {
      // Set the (inferred) type before the value: see the note in Case 2. A
      // `set type(unknown)` would otherwise wipe the value assigned just below.
      if (def.value.inferredType) def.value.type = inferTypeFromValue(ce, val);
      ce._setSymbolValue(lhs, val);
    }
    return 'ok';
  }

  ce.context.assumptions.set(proposition, true);
  return 'ok';
}

function assumeInequality(proposition: Expression): AssumeResult {
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
  if (!isFunction(proposition)) return 'internal-error';
  let op = '';
  let lhs: Expression;
  let rhs: Expression;
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
  // The proposition is boxed `{ form: 'raw' }` (engine-assumptions.ts), so its
  // operands are non-canonical. Arithmetic (`.sub()`, and the `.neg()` it calls)
  // must run on canonical operands — otherwise a canonical `Negate` ends up
  // wrapping a non-canonical symbol, tripping the `isCanonical` assert in
  // `BoxedSymbol.toNumericValue` once the difference is numerically compared.
  const p = lhs!.canonical.sub(rhs!.canonical);

  // Case 2
  const result = ce.expr([op === '<' ? 'Less' : 'LessEqual', p, 0]).evaluate();

  if (isSymbol(result, 'True')) return 'tautology';
  if (isSymbol(result, 'False')) return 'contradiction';

  const unknowns = result.unknowns;
  if (unknowns.length === 0) return 'not-a-predicate';

  //
  // Part-subject inequalities (design §4.2), e.g. `Re(s) > 1` normalized to
  // `Less(1 - Real(s), 0)`: the normalized lhs is ±Part(x) plus an optional
  // numeric constant, where Part ∈ {Real, Imaginary, Abs, Argument}.
  //
  const normalizedLhs = isFunction(result) ? result.op1 : undefined;
  const partSubject =
    normalizedLhs !== undefined ? partBoundSubject(normalizedLhs) : undefined;
  if (partSubject !== undefined) {
    const newBounds = boundsFromNormalizedInequality(result, partSubject);

    // Bounds-level tautology/contradiction check against existing bounds on
    // the *same* subject (design §4.3; cross-subject consistency is out of
    // scope).
    if (newBounds !== undefined) {
      const existing = getInequalityBoundsFromAssumptions(ce, partSubject);
      const status = checkBoundsAgainst(existing, newBounds);
      if (status !== undefined) return status;
    }

    // Type side-effect (design §3.3): a part-predicate over
    // Real/Imaginary/Abs/Argument(x) implies at most `x: number` — never
    // `x: real` — and only when the type is currently unknown/inferred.
    // Exception: a finite upper bound on `Abs(x)` implies `x` is finite
    // (design §3.2), so refine to `finite_number` in that case.
    const impliedType: Type =
      partSubject.part === 'abs' &&
      newBounds !== undefined &&
      numericBoundValue(newBounds.upper) !== undefined
        ? 'finite_number'
        : 'number';
    refineTypeIfUnknown(ce, partSubject.symbol, impliedType);

    // Store the normalized part-bound (normal form §3.2)
    ce.context.assumptions.set(result, true);

    // Derived facts (design §3.2), stored alongside — never inferred at
    // query time: `Imaginary(x)` bounded away from 0 implies `x ∉ ℝ` and
    // `x ≠ 0`.
    if (
      partSubject.part === 'im' &&
      newBounds !== undefined &&
      boundsExcludeZero(newBounds)
    ) {
      storeNotElement(
        ce,
        ce.symbol(partSubject.symbol),
        ce.symbol('RealNumbers')
      );
      storeNotEqual(ce, ce.symbol(partSubject.symbol), ce.Zero);
    }

    return 'ok';
  }

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
    const propOp1 = proposition.op1;
    const propOp2 = proposition.op2;
    const isSymbolOnLeft = isSymbol(propOp1, symbol);
    const otherSide = isSymbolOnLeft ? propOp2 : propOp1;

    // Only do bounds checking for simple comparisons like "x > k" where k is numeric
    const otherNumericValue = isNumber(otherSide)
      ? otherSide.numericValue
      : undefined;
    if (otherNumericValue !== undefined) {
      const k = otherNumericValue;

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

          if (bounds.lower !== undefined) {
            const lowerVal = isNumber(bounds.lower)
              ? bounds.lower.numericValue
              : undefined;
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

          if (bounds.upper !== undefined) {
            const upperVal = isNumber(bounds.upper)
              ? bounds.upper.numericValue
              : undefined;
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

          if (bounds.upper !== undefined) {
            const upperVal = isNumber(bounds.upper)
              ? bounds.upper.numericValue
              : undefined;
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

          if (bounds.lower !== undefined) {
            const lowerVal = isNumber(bounds.lower)
              ? bounds.lower.numericValue
              : undefined;
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
  // (inequalities imply the symbol is a real number).
  //
  // EXCEPT when the inequality involves a part term (Real/Imaginary/Abs/
  // Argument of a symbol): `Re(s) + Im(s) < 0` does not imply `s: real`
  // (design §4.2, case 4 — this was the `Re(s) > 1` destructive-retype bug).
  if (
    unknowns.length === 1 &&
    (normalizedLhs === undefined || !containsPartTerm(normalizedLhs))
  ) {
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

function assumeElement(proposition: Expression): AssumeResult {
  console.assert(proposition.operator === 'Element');

  // Cases:
  // 1/ lhs is a bare symbol
  //    => decompose the set per the design §3.2 table
  //       (`assumeElementOfSet`): type refinement, bound facts, exclusion
  //       facts, membership facts
  //
  // 2/ lhs is an expression with some free variables with no definition
  //    e.g. `x+2 \in \R`
  //    => declare the single undefined var if the domain maps to a type
  //       (historical behavior), otherwise add to assumptions DB
  //
  // 3/ otherwise (expression with no undefined vars)
  //    => evaluate and return result (contradiction or tautology)

  const ce = proposition.engine;
  if (!isFunction(proposition)) return 'not-a-predicate';

  const dom = proposition.op2.evaluate();
  if (!dom.isValid) return 'not-a-predicate';

  // Case 1: bare symbol — decompose the set
  const propOp1 = proposition.op1;
  if (isSymbol(propOp1)) return assumeElementOfSet(ce, propOp1.symbol, dom);

  // Case 2: compound lhs
  // Note: this is not 'unknowns' because proposition is not canonical (so
  // all symbols are "unknowns")
  const undefs = undefinedIdentifiers(propOp1);
  if (undefs.length === 1) {
    const type = domainToType(dom);
    if (type !== 'unknown') {
      ce.declare(undefs[0], type);
      return 'ok';
    }
    // The domain does not map to a type: fall through to storing the
    // assumption verbatim (used to throw "Invalid domain")
  }
  if (undefs.length > 0) {
    ce.context.assumptions.set(proposition, true);
    return 'ok';
  }

  // Case 3
  const val = proposition.evaluate();
  if (isSymbol(val, 'True')) return 'tautology';
  if (isSymbol(val, 'False')) return 'contradiction';
  return 'not-a-predicate';
}

/**
 * Assume `symbol ∈ setExpr`, decomposing structured sets into independent
 * stored facts plus type refinements ("shallow saturation", design §3.2):
 *
 * | Set shape | Action |
 * |---|---|
 * | primitive number set (ℂ, ℝ, ℤ…) | type refinement (historical behavior) |
 * | `Range(a, b)` | `integer` refinement + bound facts `a ≤ x ≤ b` |
 * | `Interval(a, b)` (with `Open` markers) | `real` refinement + bound facts |
 * | `SetMinus(S, Set(e1…en))` | recurse on `S` + `NotEqual(x, ei)` facts |
 * | `SetMinus(S, T)`, non-finite `T` | recurse on `S` + `NotElement(x, T)` fact |
 * | inert/unknown set | stored membership fact (used to throw) |
 *
 * Infinite or non-numeric interval endpoints are skipped (no bound fact).
 */
function assumeElementOfSet(
  ce: ComputeEngine,
  symbol: string,
  setExpr: Expression
): AssumeResult {
  // 1. Primitive number sets → pure type refinement
  const type = domainToType(setExpr);
  if (type !== 'unknown') return refineSymbolType(ce, symbol, type);

  // 2. Range(lo, hi[, step]): integer-valued (`ZZGreaterEqual(1)`
  //    translates to Range(1, +∞))
  if (isFunction(setExpr, 'Range') && setExpr.ops.length >= 2) {
    const result = refineSymbolType(ce, symbol, 'integer');
    if (result === 'contradiction') return result;

    let [lo, hi] = setExpr.ops;
    const step = setExpr.ops[2];
    if (step !== undefined && step.isSame(-1)) [lo, hi] = [hi, lo];
    // For non-unit steps only the type refinement is kept
    if (step !== undefined && !step.isSame(1) && !step.isSame(-1)) return 'ok';

    if (assumeBound(ce, symbol, 'GreaterEqual', lo) === 'contradiction')
      return 'contradiction';
    if (assumeBound(ce, symbol, 'LessEqual', hi) === 'contradiction')
      return 'contradiction';
    return 'ok';
  }

  // 3. Interval(lo, hi), endpoints possibly wrapped in `Open`
  if (isFunction(setExpr, 'Interval') && setExpr.ops.length === 2) {
    const result = refineSymbolType(ce, symbol, 'real');
    if (result === 'contradiction') return result;

    let [lo, hi] = setExpr.ops;
    let loStrict = false;
    let hiStrict = false;
    if (isFunction(lo, 'Open')) {
      loStrict = true;
      lo = lo.op1;
    }
    if (isFunction(hi, 'Open')) {
      hiStrict = true;
      hi = hi.op1;
    }

    if (
      assumeBound(ce, symbol, loStrict ? 'Greater' : 'GreaterEqual', lo) ===
      'contradiction'
    )
      return 'contradiction';
    if (
      assumeBound(ce, symbol, hiStrict ? 'Less' : 'LessEqual', hi) ===
      'contradiction'
    )
      return 'contradiction';
    return 'ok';
  }

  // 4. SetMinus(S, T): recurse on S, then store exclusions
  if (isFunction(setExpr, 'SetMinus') && setExpr.ops.length === 2) {
    const [base, excluded] = setExpr.ops;
    const result = assumeElementOfSet(ce, symbol, base.evaluate());
    if (result === 'contradiction' || result === 'internal-error')
      return result;

    if (isFunction(excluded, 'Set')) {
      // Finite exclusion set: store a disequality per element
      for (const e of excluded.ops) {
        if (storeNotEqual(ce, ce.symbol(symbol), e) === 'contradiction')
          return 'contradiction';
      }
      return 'ok';
    }
    // Non-finite exclusion: store a NotElement fact
    const r = storeNotElement(ce, ce.symbol(symbol), excluded);
    return r === 'tautology' ? 'ok' : r;
  }

  // 5. Union of intervals/ranges: refine the type only; the membership
  //    fact is stored verbatim (a union yields a disjunction of bounds,
  //    which the fact layer does not represent)
  if (isFunction(setExpr, 'Union') && setExpr.ops.length > 0) {
    if (setExpr.ops.every((s) => isFunction(s, 'Range'))) {
      if (refineSymbolType(ce, symbol, 'integer') === 'contradiction')
        return 'contradiction';
    } else if (
      setExpr.ops.every(
        (s) => isFunction(s, 'Interval') || isFunction(s, 'Range')
      )
    ) {
      if (refineSymbolType(ce, symbol, 'real') === 'contradiction')
        return 'contradiction';
    }
    // ...fall through to store the membership fact
  }

  // 6. Inert/unknown set: store a membership fact (design §4.1 — this used
  //    to throw "Invalid domain")
  if (isNumber(setExpr) || isString(setExpr)) return 'not-a-predicate';
  const fact = ce.function('Element', [ce.symbol(symbol), setExpr]);
  if (!fact.isValid) return 'not-a-predicate';
  ce.context.assumptions.set(fact, true);
  return 'ok';
}

/**
 * Narrow the declared type of `symbol` to `type` from an `Element`
 * assumption (historical cases 1 & 2 of `assumeElement`, merged).
 */
function refineSymbolType(
  ce: ComputeEngine,
  symbol: string,
  type: Type
): AssumeResult {
  if (!hasDef(ce, symbol)) {
    ce.declare(symbol, type);
    return 'ok';
  }

  // Shadow a parent-scope declaration in the current scope so the
  // assumption is reverted when the scope is popped.
  if (!ce.context?.lexicalScope?.bindings.has(symbol)) ce.declare(symbol, type);

  const def = ce.lookupDefinition(symbol);
  if (isValueDef(def)) {
    if (
      def.value.type &&
      !def.value.type.isUnknown &&
      !def.value.inferredType &&
      !isSubtype(type, def.value.type.type)
    )
      return 'contradiction';
    def.value.type = new BoxedType(type, ce._typeResolver);
    // The type was explicitly asserted: it is no longer an inferred type
    // (so a subsequent bare-symbol inequality won't widen it to 'real')
    def.value.inferredType = false;
    return 'ok';
  }
  if (isOperatorDef(def)) {
    if (!isSubtype(type, functionResult(def.operator.signature.type)!))
      return 'contradiction';
    return 'ok';
  }
  return 'not-a-predicate';
}

/**
 * Assume `symbol <op> bound` by delegating to `assumeInequality` (which
 * performs the §4.3 consistency checks and stores the normalized fact).
 *
 * Non-numeric or infinite bounds are skipped: membership in
 * `Range(1, +∞)` yields only the lower bound fact.
 */
function assumeBound(
  ce: ComputeEngine,
  symbol: string,
  op: 'Less' | 'LessEqual' | 'Greater' | 'GreaterEqual',
  bound: Expression
): AssumeResult {
  if (!isNumber(bound) || bound.isFinite !== true) return 'ok';
  // Canonical boxing normalizes the operator to Less/LessEqual (possibly
  // swapping the operands), which `assumeInequality` handles directly.
  return assumeInequality(ce.function(op, [ce.symbol(symbol), bound]));
}

/**
 * Recognize a normalized-inequality lhs of the form `±Part(x) + k` where
 * `Part ∈ {Real, Imaginary, Abs, Argument}` and `k` is an optional numeric
 * constant. Returns the (non-self) subject, or `undefined`.
 *
 * Deliberately stricter than `boundsFromNormalizedInequality`: an lhs with
 * a non-numeric extra term (e.g. `Re(s) + Im(s)`) is *not* a part-bound and
 * is stored opaque instead.
 */
function partBoundSubject(lhs: Expression): Subject | undefined {
  const partOf = (term: Expression): Subject | undefined => {
    const inner =
      isFunction(term, 'Negate') && term.ops.length === 1 ? term.op1 : term;
    const s = subjectOf(inner);
    return s !== undefined && s.part !== 'self' ? s : undefined;
  };

  const direct = partOf(lhs);
  if (direct !== undefined) return direct;

  if (!isFunction(lhs, 'Add')) return undefined;
  let subject: Subject | undefined = undefined;
  for (const term of lhs.ops) {
    const s = partOf(term);
    if (s !== undefined) {
      if (subject !== undefined) return undefined; // more than one part term
      subject = s;
    } else if (!isNumber(term)) {
      return undefined; // non-numeric extra term
    }
  }
  return subject;
}

/** True if `expr` contains a part term (`Real/Imaginary/Abs/Argument` of a
 * bare symbol) anywhere. */
function containsPartTerm(expr: Expression): boolean {
  if (!isFunction(expr)) return false;
  const s = subjectOf(expr);
  if (s !== undefined && s.part !== 'self') return true;
  return expr.ops.some(containsPartTerm);
}

/** The numeric (finite, real) value of a bound expression, or undefined. */
function numericBoundValue(b: Expression | undefined): number | undefined {
  if (b === undefined || !isNumber(b)) return undefined;
  const v = b.numericValue;
  const n = typeof v === 'number' ? v : v?.re;
  return typeof n === 'number' && isFinite(n) ? n : undefined;
}

/**
 * Check a candidate bound against the existing bounds for the same subject
 * (design §4.3 — bounds-level consistency only, per subject).
 *
 * Returns `'tautology'` if the new bound is already implied,
 * `'contradiction'` if it is incompatible, `undefined` otherwise (store it).
 */
function checkBoundsAgainst(
  existing: IntervalBounds,
  candidate: IntervalBounds
): 'tautology' | 'contradiction' | undefined {
  // New lower bound: subject > k (strict) or subject >= k
  const newLower = numericBoundValue(candidate.lower);
  if (newLower !== undefined) {
    const strict = candidate.lowerStrict === true;
    const upper = numericBoundValue(existing.upper);
    if (upper !== undefined) {
      if (upper < newLower) return 'contradiction';
      if (upper === newLower && (strict || existing.upperStrict === true))
        return 'contradiction';
    }
    const lower = numericBoundValue(existing.lower);
    if (lower !== undefined) {
      if (lower > newLower) return 'tautology';
      if (lower === newLower && (existing.lowerStrict === true || !strict))
        return 'tautology';
    }
  }

  // New upper bound: subject < k (strict) or subject <= k
  const newUpper = numericBoundValue(candidate.upper);
  if (newUpper !== undefined) {
    const strict = candidate.upperStrict === true;
    const lower = numericBoundValue(existing.lower);
    if (lower !== undefined) {
      if (lower > newUpper) return 'contradiction';
      if (lower === newUpper && (strict || existing.lowerStrict === true))
        return 'contradiction';
    }
    const upper = numericBoundValue(existing.upper);
    if (upper !== undefined) {
      if (upper < newUpper) return 'tautology';
      if (upper === newUpper && (existing.upperStrict === true || !strict))
        return 'tautology';
    }
  }

  return undefined;
}

/** True if the bounds imply the subject is non-zero (e.g. `Im(x) > 0`). */
function boundsExcludeZero(bounds: IntervalBounds): boolean {
  const lower = numericBoundValue(bounds.lower);
  if (
    lower !== undefined &&
    (lower > 0 || (lower === 0 && bounds.lowerStrict === true))
  )
    return true;
  const upper = numericBoundValue(bounds.upper);
  if (
    upper !== undefined &&
    (upper < 0 || (upper === 0 && bounds.upperStrict === true))
  )
    return true;
  return false;
}

/**
 * Narrow the type of `symbol` to `type` only when its current type is
 * unknown, or inferred and `type` actually narrows it. Never widens, and
 * never overrides an explicit declaration (design §3.3).
 */
function refineTypeIfUnknown(
  ce: ComputeEngine,
  symbol: string,
  type: Type
): void {
  const def = ce.lookupDefinition(symbol);
  if (!def) {
    ce.declare(symbol, type);
    return;
  }
  if (!isValueDef(def) || def.value.isConstant) return;
  const current = def.value.type;
  if (!current || current.isUnknown) {
    def.value.type = ce.type(type);
    return;
  }
  if (def.value.inferredType && isSubtype(type, current.type))
    def.value.type = ce.type(type);
}

function hasDef(ce: ComputeEngine, s: string): boolean {
  return ce.lookupDefinition(s) !== undefined;
}

function undefinedIdentifiers(expr: Expression): string[] {
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
 * Query assumptions to determine the sign of a subject.
 *
 * The subject may be a bare symbol (pass the symbol name, or a `Subject`
 * with `part: 'self'`) or a part-extractor of a symbol, e.g.
 * `{ symbol: 's', part: 're' }` for facts about `Real(s)` (see
 * `boxed-expression/constraint-subject.ts`).
 *
 * Examines inequality assumptions in the current context to determine
 * if the subject's sign can be inferred. Assumptions are stored in
 * normalized form (Less or LessEqual with lhs-rhs compared to 0), so:
 * - `x > 0` is stored as `Less(-x, 0)` meaning `-x < 0`
 * - `x >= 0` is stored as `LessEqual(-x, 0)` meaning `-x <= 0`
 * - `x < 0` is stored as `Less(x, 0)` meaning `x < 0`
 * - `x <= 0` is stored as `LessEqual(x, 0)` meaning `x <= 0`
 * - `Re(s) > 1` is stored as `Less(Add(Negate(Real(s)), 1), 0)`
 *
 * @param ce - The compute engine instance
 * @param subject - The symbol name or `Subject` to query
 * @returns The inferred sign, or undefined if no relevant assumptions found
 */
export function getSignFromAssumptions(
  ce: ComputeEngine,
  subject: string | Subject
): Sign | undefined {
  const assumptions = ce.context?.assumptions;
  if (!assumptions) return undefined;

  const subj = toSubject(subject);

  for (const [assumption, _] of assumptions.entries()) {
    const op = assumption.operator;
    if (!op) continue;

    // Assumptions are normalized to Less or LessEqual
    if (op !== 'Less' && op !== 'LessEqual') continue;

    if (!isFunction(assumption)) continue;
    const ops = assumption.ops;
    if (ops.length !== 2) continue;

    const [lhs, rhs] = ops;

    // Check if RHS is 0 (normalized form: expr < 0 or expr <= 0)
    if (!rhs.isSame(0)) continue;

    // Case 1: Direct subject comparison
    // x < 0 means x is negative
    // x <= 0 means x is non-positive
    if (matchesSubject(lhs, subj)) {
      if (op === 'Less') return 'negative';
      if (op === 'LessEqual') return 'non-positive';
    }

    // Case 2: Negated subject comparison
    // -x < 0 means x > 0 (positive)
    // -x <= 0 means x >= 0 (non-negative)
    if (isFunction(lhs, 'Negate') && matchesSubject(lhs.op1, subj)) {
      if (op === 'Less') return 'positive';
      if (op === 'LessEqual') return 'non-negative';
    }

    // Case 3: Subject with subtraction from constant
    // a - x < 0 means x > a, so if a >= 0, x is positive
    // x - a < 0 means x < a, so if a <= 0, x is negative
    if (isFunction(lhs, 'Subtract')) {
      const [a, b] = lhs.ops;
      if (a && b) {
        // a - x < 0 => x > a
        if (matchesSubject(b, subj) && a.isNonNegative === true) {
          if (op === 'Less') return 'positive';
        }
        // x - a < 0 => x < a
        if (matchesSubject(a, subj) && b.isNonPositive === true) {
          if (op === 'Less') return 'negative';
        }
      }
    }

    // Case 4: Addition form (canonical form of subtraction)
    // x + (-a) < 0 means x < a, so if a <= 0, x is negative
    // -x + a < 0 means -x < -a means x > a, so if a >= 0, x is positive
    if (isFunction(lhs, 'Add')) {
      for (const term of lhs.ops) {
        // Direct subject in sum: check if other terms give us bounds
        if (matchesSubject(term, subj)) {
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
        // Negated subject in sum: -x + ... < 0
        if (isFunction(term, 'Negate') && matchesSubject(term.op1, subj)) {
          // -x + ... < 0 means x > (sum of others), so if the other terms
          // are all non-negative, x > non-negative = positive
          const otherTerms = lhs.ops.filter((t) => t !== term);
          if (
            otherTerms.length > 0 &&
            otherTerms.every((t) => t.isNonNegative === true)
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

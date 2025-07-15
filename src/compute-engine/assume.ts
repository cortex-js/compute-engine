import { isSubtype } from '../common/type/subtype';
import { functionResult } from '../common/type/utils';
import { BoxedType } from '../common/type/boxed-type';

import {
  AssumeResult,
  Assumption,
  BoxedExpression,
  ComputeEngine,
} from './global-types';

import { findUnivariateRoots } from './boxed-expression/solve';
import {
  domainToType,
  isValueDef,
  isOperatorDef,
} from './boxed-expression/utils';
import { MathJsonSymbol } from '../math-json';
import { isInequalityOperator } from './latex-syntax/utils';

/**
 * An assumption is a predicate that is added to the current context.
 *
 * The predicate can take the form of:
 * - `x = 5` implies that `x` is a number
 * - `x ∈ ℕ`
 * - `x > 3`  implies that `x ∈ ℕ`
 * - `x ∈ {0, 2, 5}`
 * - `x ≠ 0`
 *
 * In general, the predicate is about the value and the type of a symbol.
 *
 */
class _Assumption implements Assumption {
  _type: BoxedType | undefined;

  _excludedValue: BoxedExpression | undefined;
  _includedValue: BoxedExpression | undefined;

  _minValue: BoxedExpression | undefined;
  _maxValue: BoxedExpression | undefined;
  _minOpen: boolean;
  _maxOpen: boolean;

  constructor(x: string, predicate: BoxedExpression) {
    this._type = undefined;
    this._excludedValue = undefined;
    this._includedValue = undefined;
    this._minValue = undefined;
    this._maxValue = undefined;
    this._minOpen = false;
    this._maxOpen = false;
  }

  toExpression(ce: ComputeEngine, x: MathJsonSymbol): BoxedExpression {
    return ce.Nothing;
  }

  // > 0
  get isPositive() {
    if (this._minValue === undefined) return undefined;
    if (this._minValue.is(0)) return !this._minOpen;
    return this._minValue.isPositive;
  }

  // Same as <0
  get isNegative() {
    if (this._maxValue === undefined) return undefined;
    if (this._maxValue.is(0)) return this._maxOpen;
    return this._maxValue.isNegative;
  }

  // The value of this expression is >= 0
  get isNonNegative() {
    if (this._minValue === undefined) return undefined;
    if (this._minValue.is(0)) return this._minOpen;
    return this._minValue.isNonNegative;
  }
  // >=0
  get isNonPositive() {
    if (this._maxValue === undefined) return undefined;
    if (this._maxValue.is(0)) return this._maxOpen;
    return this._maxValue.isNonPositive;
  }
  get isZero() {
    return undefined;
  }

  get isNumber() {
    if (this._type === undefined) return undefined;
    return this._type.matches('number');
  }
  get isInteger() {
    if (this._type === undefined) return undefined;
    return this._type.matches('integer');
  }
  get isRational() {
    if (this._type === undefined) return undefined;
    return this._type.matches('rational');
  }
  get isReal() {
    if (this._type === undefined) return undefined;
    return this._type.matches('real');
  }
  get isComplex() {
    if (this._type === undefined) return undefined;
    return this._type.matches('complex');
  }
  get isImaginary() {
    if (this._type === undefined) return undefined;
    return this._type.matches('imaginary');
  }

  get isFinite() {
    return undefined;
  }
  get isInfinite() {
    return undefined;
  }
  get isNaN() {
    return undefined;
  }

  matches(type: BoxedType): boolean | undefined {
    if (this._type === undefined) return undefined;
    if (typeof type === 'string') return this._type.matches(type);
    return this._type.matches(type);
  }

  isGreater(other: BoxedExpression): boolean | undefined {
    const result = this.isLess(other);
    if (result === undefined) return undefined;
    return !result;
  }
  isLess(other: BoxedExpression): boolean | undefined {
    return undefined;
  }
  isGreaterEqual(other: BoxedExpression): boolean | undefined {
    const result = this.isLessEqual(other);
    if (result === undefined) return undefined;
    return !result;
  }
  isLessEqual(other: BoxedExpression): boolean | undefined {
    const result = this.isLess(other);
    if (result === undefined) return this.isEqual(other);
    return result;
  }
  isEqual(other: BoxedExpression): boolean | undefined {
    return undefined;
  }
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

    // def.symbol.value = val;
    // if (def.symbol.inferredType) def.symbol.type = val.type;
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
    // def.symbol.value = val;
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

  // Case 3
  if (unknowns.length === 1) {
    if (!ce.lookupDefinition(unknowns[0]))
      ce.declare(unknowns[0], { type: 'real' });
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

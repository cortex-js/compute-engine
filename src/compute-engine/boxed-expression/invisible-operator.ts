import { flatten } from './flatten';
import { isImaginaryUnit, isOperatorDef } from './utils';
import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types';
import { isFunction, isSymbol, isString, isNumber } from './type-guards';

export function canonicalInvisibleOperator(
  ops: ReadonlyArray<Expression>,
  { engine: ce }: { engine: ComputeEngine }
): Expression | null {
  if (ops.length === 0) return null;

  const lhs = ops[0];
  if (ops.length === 1) return lhs.canonical;

  if (ops.length === 2) {
    //
    // Is it an implicit addition/mixed fraction, e.g. "3 1/4"
    // Note: the numerators and denominators are limited to 999
    //
    const lhsInteger = asInteger(lhs);
    if (!Number.isNaN(lhsInteger)) {
      const rhs = ops[1];
      if (
        (rhs.operator === 'Divide' || rhs.operator === 'Rational') &&
        isFunction(rhs)
      ) {
        const [n, d] = [rhs.op1.canonical.re, rhs.op2.canonical.re];
        if (
          n > 0 &&
          n <= 1000 &&
          d > 1 &&
          d <= 1000 &&
          Number.isInteger(n) &&
          Number.isInteger(d)
        ) {
          let frac = rhs.canonical;
          if (lhsInteger < 0) frac = frac.neg();

          return ce._fn('Add', [lhs.canonical, frac]);
        }
      }
    }

    //
    // Is it a complex (imaginary) number, i.e. "2i"?
    //
    const rhs = ops[1];
    if (!Number.isNaN(lhsInteger) && isImaginaryUnit(rhs)) {
      return ce.number(ce.complex(0, lhsInteger));
    }

    //
    // Is it a function application: symbol with a function
    // definition followed by delimiter
    //
    // Note: lhs might be a Subscript (e.g., f_\text{a}) which canonicalizes
    // to a symbol (f_a). Canonicalize first to handle this case.
    const lhsCanon = lhs.canonical;
    if (isSymbol(lhsCanon) && rhs.operator === 'Delimiter' && isFunction(rhs)) {
      // We have encountered something like `f(a+b)`, where `f` is not
      // defined. But it also could be `x(x+1)` where `x` is a number.
      // So, start with boxing the arguments and see if it makes sense.

      // No arguments, i.e. `f()`? It's definitely a function call.
      if (rhs.nops === 0) {
        const def = ce.lookupDefinition(lhsCanon.symbol);
        if (def) {
          if (isOperatorDef(def)) {
            // It's a known operator, all good (the canonicalization
            // will check the arity)
            return ce.box([lhsCanon.symbol]);
          }

          if (def.value.type.isUnknown) {
            lhsCanon.infer('function');
            return ce.box([lhsCanon.symbol]);
          }

          if (def.value.type.matches('function'))
            return ce.box([lhsCanon.symbol]);

          // Uh. Oh. It's a symbol with a value that is not a function.
          return ce.typeError('function', def.value.type, lhsCanon);
        }
        ce.declare(lhsCanon.symbol, 'function');
        return ce.box([lhsCanon.symbol]);
      }

      // Parse the arguments first, in case they reference lhsCanon.symbol
      // i.e. `x(x+1)`.
      let args =
        isFunction(rhs.op1) && rhs.op1.operator === 'Sequence'
          ? rhs.op1.ops
          : [rhs.op1];
      args = flatten(args);

      const def = ce.lookupDefinition(lhsCanon.symbol);
      if (!def) {
        // Symbol not defined, so it's a function call - declare and return
        ce.declare(lhsCanon.symbol, 'function');
        return ce.function(lhsCanon.symbol, args);
      }

      // Symbol is defined - check if it's a function or has unknown type
      // (unknown type means it was auto-declared and should be treated as function)
      if (isOperatorDef(def) || def.value?.type?.matches('function')) {
        return ce.function(lhsCanon.symbol, args);
      }

      if (def.value?.type?.isUnknown) {
        // Type is unknown - infer as function and return function call
        lhsCanon.infer('function');
        return ce.function(lhsCanon.symbol, args);
      }

      // Symbol is defined but not as a function - fall through to check
      // if it might be multiplication (e.g., x(x+1) where x is a number)
    }

    // Is is an index operation, i.e. "v[1,2]"?
    if (
      isSymbol(lhsCanon) &&
      rhs.operator === 'Delimiter' &&
      isFunction(rhs) &&
      isString(rhs.op2) &&
      (rhs.op2.string === '[,]' || rhs.op2.string === '[;]')
    ) {
      const args =
        isFunction(rhs.op1) && rhs.op1.operator === 'Sequence'
          ? rhs.op1.ops
          : [rhs.op1];
      return ce.function('At', [lhsCanon, ...args]);
    }
  }

  // Lift any nested invisible operators
  // (we do it explicitly here instead of via flatten to avoid
  //  boxing the arguments)
  ops = flattenInvisibleOperator(ops);

  // Only call flatten here, because it will bind (auto-declare) the arguments
  ops = flatten(ops);

  //
  // Is it an invisible multiplication?
  // (are all argument numeric or indexable collections?)
  //
  if (
    ops.every(
      (x) =>
        x.isValid &&
        (x.type.isUnknown ||
          x.type.matches('number') ||
          (x.isIndexedCollection && !isString(x)))
    )
  ) {
    // Note: we don't want to use canonicalMultiply here, because
    // invisible operator canonicalization should not affect multiplication,
    // i.e. `1(2+3)` should not be simplified to `2+3`.
    //
    return ce._fn('Multiply', ops);
  }

  //
  // If some of the elements are not numeric (or of unknown domain)
  // group them as a Tuple
  //
  return ce._fn('Tuple', ops);
}

function flattenInvisibleOperator(
  ops: ReadonlyArray<Expression>
): Expression[] {
  const ys: Expression[] = [];
  for (const x of ops) {
    if (x.operator === 'InvisibleOperator' && isFunction(x))
      ys.push(...flattenInvisibleOperator(x.ops));
    else ys.push(x);
  }
  return ys;
}

function asInteger(expr: Expression): number {
  if (isNumber(expr)) {
    const n = expr.re;
    if (Number.isInteger(n)) return n;
  }
  if (expr.operator === 'Negate' && isFunction(expr)) {
    const n = asInteger(expr.op1);
    if (!Number.isNaN(n)) return -n;
  }
  return Number.NaN;
}

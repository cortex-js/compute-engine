import type { IComputeEngine, BoxedExpression } from '../public';

import { flatten } from '../boxed-expression/flatten';
import { isIndexableCollection } from '../collection-utils';
import { canonicalMultiply } from './arithmetic-multiply';

export function canonicalInvisibleOperator(
  ce: IComputeEngine,
  ops: ReadonlyArray<BoxedExpression>
): BoxedExpression | null {
  if (ops.length === 0) return null;

  const lhs = ops[0];
  if (ops.length === 1) return lhs.canonical;

  if (ops.length === 2) {
    //
    // Is it an implicit addition/mixed fraction, e.g. "3 1/4"
    // Note: the numerators and denominators are limited to 999
    //
    const lhsNumber = lhs.canonical.re ?? NaN;
    if (Number.isInteger(lhsNumber)) {
      const rhs = ops[1];
      if (rhs.operator === 'Divide' || rhs.operator === 'Rational') {
        const [n, d] = [
          rhs.op1.canonical.re ?? NaN,
          rhs.op2.canonical.re ?? NaN,
        ];
        if (
          n > 0 &&
          n <= 1000 &&
          d > 1 &&
          d <= 1000 &&
          Number.isInteger(n) &&
          Number.isInteger(d)
        ) {
          let frac = rhs.canonical;
          if (lhsNumber < 0) frac = frac.neg();

          return ce._fn('Add', [lhs.canonical, frac]);
        }
      }
    }

    //
    // Is it a complex number, i.e. "2i"?
    //
    const rhs = ops[1];
    if (!isNaN(lhsNumber) && rhs.canonical.symbol === 'ImaginaryUnit')
      return ce.number(ce.complex(0, lhsNumber));

    //
    // Is it a function application: symbol with a function
    // definition followed by delimiter
    //
    if (
      lhs.symbol &&
      rhs.operator === 'Delimiter' &&
      !ce.lookupSymbol(lhs.symbol)
    ) {
      // @fixme: should use symbol table to check if it's a function
      // We have encountered something like `f(a+b)`, where `f` is not
      // defined. But it also could be `x(x+1)` where `x` is a number.
      // So, start with boxing the arguments and see if it makes sense.

      // No arguments, i.e. `f()`? It's a function call.
      if (rhs.nops === 0) {
        if (!ce.lookupFunction(lhs.symbol)) ce.declare(lhs.symbol, 'Functions');
        return ce.box([lhs.symbol]);
      }

      // Parse the arguments first, in case they reference lhs.symbol
      // i.e. `x(x+1)`.
      let args = rhs.op1.operator === 'Sequence' ? rhs.op1.ops! : [rhs.op1];
      args = flatten(args);
      if (!ce.lookupSymbol(lhs.symbol)) {
        // Still not a symbol (i.e. wasn't used as a symbol in the
        // subexpression), so it's a function call.
        if (!ce.lookupFunction(lhs.symbol)) ce.declare(lhs.symbol, 'Functions');
        return ce.function(lhs.symbol, args);
      }
    }

    // Is is an index operation, i.e. "v[1,2]"?
    if (
      lhs.symbol &&
      rhs.operator === 'Delimiter' &&
      (rhs.op2.string === '[,]' || rhs.op2.string === '[;]')
    ) {
      const args = rhs.op1.operator === 'Sequence' ? rhs.op1.ops! : [rhs.op1];
      return ce.function('At', [lhs, ...args]);
    }
  }
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
        (!x.domain ||
          x.domain.isNumeric ||
          (isIndexableCollection(x) && !x.string))
    )
  ) {
    return canonicalMultiply(ce, ops);
  }

  //
  // If some of the elements are not numeric (or of unknown domain)
  // group them as a Tuple
  //
  return ce._fn('Tuple', ops);
}

import { getNumberValue } from '../common/utils';
import { Expression } from '../public';
import { nextDown, nextUp } from './numeric';
import { ComputeEngine } from './public';

export function domain(
  _engine: ComputeEngine,
  expr: Expression
): Expression | null {
  // @todo

  //
  // 1. Is it a number?
  //
  const numVal = getNumberValue(expr);
  if (numVal === 0) return 'NumberZero';
  if (numVal !== null && !isNaN(numVal)) {
    if (!isFinite(numVal)) return 'SignedInfinity';

    // 1.1 Is it an integer?
    if (Number.isInteger(numVal)) return ['Range', numVal, numVal];
    return ['Interval', nextDown(numVal), nextUp(numVal)];
  }

  //
  // 2. Is it a symbol?
  //

  // 2.1 Do we have an assumption about this symbol
  // 2.2 Does the symbol definition have a domain?

  //
  // 3. Is it a function?
  //

  // 3.1 Evaluate the head of the function
  // 3.2 Does the definition have a domain or domain function?
  // 3.3 Calculate the domain of each argument

  //
  // 4. It's something else: collection, etc...
  //

  return null;
}

// export function isSubdomainOf(
//   dict: Dictionary,
//   lhs: Domain,
//   rhs: Domain
// ): boolean {
//   if (lhs === rhs) return true;
//   if (typeof lhs !== 'string') return false;
//   const def = dict[lhs];
//   if (!isSetDefinition(def)) return false;

//   for (const parent of def.supersets) {
//     if (isSubdomainOf(dict, parent, rhs)) return true;
//   }

//   return false;
// }

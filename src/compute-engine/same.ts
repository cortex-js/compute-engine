import { Expression } from '../public';
import {
  getArg,
  getArgCount,
  getDictionary,
  getFunctionHead,
  getNumberValue,
  getStringValue,
  getSymbolName,
  isNumberObject,
  isStringObject,
} from '../common/utils';
import { chop } from './numeric';

/**
 * Compare two expressions and return if they are structurally identical,
 * ignoring any difference in representation, i.e.
 * `3` and `{num: 3}` are the same.
 * Metadata is ignored, except for Wikidata:
 * `{ sym: 'Pi', wikidata: 'Q168' }`
 * `{ sym: 'Pi', wikidata: 'Q167' }`
 * are not the same (greek letter vs. 3.1415...)
 *
 * Compare with `equalExpr()` which does not ignore differences in
 * representation.
 */
export function same(lhs: Expression | null, rhs: Expression | null): boolean {
  if (lhs === null || rhs == null) return false;
  if (
    typeof lhs === 'object' &&
    typeof rhs === 'object' &&
    'wikidata' in lhs &&
    'wikidata' in rhs
  ) {
    // @todo: if only one of the objects have a wikidata property,
    // could check if the other's definition have one and compare that.
    if (lhs.wikidata !== rhs.wikidata) return false;
  }
  //
  // Number
  //
  if (
    (typeof lhs === 'number' || isNumberObject(lhs)) &&
    (typeof rhs === 'number' || isNumberObject(rhs))
  ) {
    // Two numbers are considered the same if they are close in value
    // (< 10^(-10) by default).
    return (
      chop((getNumberValue(lhs) ?? NaN) - (getNumberValue(rhs) ?? NaN)) === 0
    );
  }

  //
  // Symbol
  //
  const lhSymbol = getSymbolName(lhs);
  if (lhSymbol !== null) return lhSymbol === getSymbolName(rhs);

  //
  // String
  //
  if (isStringObject(lhs) && isStringObject(rhs!)) {
    return getStringValue(lhs) === getStringValue(rhs!);
  }

  //
  // Dictionary
  //
  const lhsDict = getDictionary(lhs);
  if (lhsDict !== null) {
    const rhsDict = getDictionary(rhs);
    if (!rhsDict) return false;
    const keys = Object.keys(lhsDict);
    if (Object.keys(rhsDict).length !== keys.length) return false;
    for (const key of keys) {
      if (!same(lhsDict[key], rhsDict[key])) return false;
    }
    return true;
  }

  //
  // Function
  //
  const lhsHead = getFunctionHead(lhs);
  if (lhsHead === null) return false;
  const rhsHead = getFunctionHead(rhs);
  if (rhsHead === null) return false;
  if (!same(lhsHead, rhsHead)) return false;

  const lhsArgCount = getArgCount(lhs);
  const rhsArgCount = getArgCount(rhs);
  if (lhsArgCount !== rhsArgCount) return false;
  let i = 1;
  while (i <= lhsArgCount) {
    if (!same(getArg(lhs, i), getArg(rhs, i))) return false;
    i += 1;
  }
  return true;
}

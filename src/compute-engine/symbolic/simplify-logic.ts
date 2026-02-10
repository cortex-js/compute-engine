import type { Expression } from '../global-types';
import { isFunction } from '../boxed-expression/type-guards';
import {
  evaluateAnd,
  evaluateOr,
  evaluateNot,
  evaluateEquivalent,
  evaluateImplies,
  evaluateXor,
  evaluateNand,
  evaluateNor,
} from './logic-utils';

export function simplifyLogicFunction(
  x: Expression
): { value: Expression; because: string } | undefined {
  const fn = {
    And: evaluateAnd,
    Or: evaluateOr,
    Not: evaluateNot,
    Equivalent: evaluateEquivalent,
    Implies: evaluateImplies,
    Xor: evaluateXor,
    Nand: evaluateNand,
    Nor: evaluateNor,
  }[x.operator];

  if (!fn || !isFunction(x)) return undefined;

  const value = fn(x.ops, { engine: x.engine });
  if (!value) return undefined;

  return { value, because: 'logic' };
}

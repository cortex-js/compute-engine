import type { BoxedExpression } from '../global-types';
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
  x: BoxedExpression
): { value: BoxedExpression; because: string } | undefined {
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

  if (!fn || !x.ops) return undefined;

  const value = fn(x.ops, { engine: x.engine });
  if (!value) return undefined;

  return { value, because: 'logic' };
}

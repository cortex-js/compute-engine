import { Expression } from '../public';
import { match, substitute } from './patterns';
import { ComputeEngine, Numeric, Rule, RuleSet } from './public';

// Generator functions

// export function fixPoint(rule: Rule);
// export function chain(rules: RuleSet);

export function applyRule<T extends number = Numeric>(
  ce: ComputeEngine<T>,
  [pattern, subsequent, condition]: Rule<T>,
  expr: Expression<T>
): Expression<T> | null {
  const sub = match(pattern, expr);
  if (sub === null) return null;

  if (typeof condition === 'function' && !condition(ce, sub)) return null;

  return substitute<T>(subsequent, sub);
}

/**
 * Repeatedely apply rules in the ruleset until no rules apply
 */
export function replace<T extends number = Numeric>(
  ce: ComputeEngine,
  rules: RuleSet,
  expr: Expression<T>
): Expression<T> | null {
  let done = false;
  while (!done) {
    done = true;
    for (const rule of rules) {
      const result = applyRule(ce, rule, expr);
      if (result !== null) {
        done = false;
        expr = result;
      }
    }
  }
  return expr;
}

// @todo ['Alternatives', ...]:
// @todo: ['Condition',...] : Conditional match
// @todo: ['Repeated',...] : repeating match
// @todo _x:Head or _x:RealNumber
// replace() -> replace matching patterns with another expression
// replaceAll(), replaceRepeated()

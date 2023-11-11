import {
  BoxedExpression,
  BoxedRule,
  IComputeEngine,
  Rule,
  BoxedRuleSet,
  ReplaceOptions,
  BoxedSubstitution,
  PatternConditionFunction,
} from './public';
import { latexString } from './boxed-expression/utils';

/**
 * Go through all the rules in the rule set, and for all the rules that match
 * return the rhs of the rule applied to `expr`.
 * @param rules
 */
export function matchRules(
  expr: BoxedExpression,
  rules: BoxedRuleSet,
  sub: BoxedSubstitution
): BoxedExpression[] {
  const result: BoxedExpression[] = [];
  for (const rule of rules) {
    const r = applyRule(rule, expr, sub);
    if (r !== null) result.push(r);
  }
  return result;
}

// @future Generator functions
// export function fixPoint(rule: Rule);
// export function chain(rules: RuleSet);

// @future load rules from JSONC
// - describe conditions with a condition expression:
//    "x.isInteger && y.isFreeOf('x')"
//  or"x:integer && y:freeOf(x)"
// function parseCondition(s:string, lhs: (sub)=> boolean) =>
//    [rest: string, fn: (sub) => boolean]

// @future: priority for rules, sort and apply rules by priority

export function boxRules(ce: IComputeEngine, rs: Iterable<Rule>): BoxedRuleSet {
  const result = new Set<BoxedRule>();
  for (const { match, replace, condition, priority, id } of rs) {
    // Normalize the condition to a function
    let condFn: undefined | PatternConditionFunction;
    if (typeof condition === 'string') {
      const latex = latexString(condition);
      if (latex) {
        // Substitute any unbound vars in the condition to a wildcard
        const condPattern = ce.pattern(latex);
        condFn = (x: BoxedSubstitution, _ce: IComputeEngine): boolean =>
          condPattern.subs(x).evaluate()?.symbol === 'True';
      }
    } else condFn = condition;

    result.add({
      match: ce.pattern(match),
      replace: typeof replace === 'function' ? replace : ce.pattern(replace),
      priority: priority ?? 0,
      condition: condFn,
      // id:
      //   id ??
      //   ce.box(match, { canonical: false }).toString() +
      //     (typeof replace === 'function'
      //       ? '  ->  function'
      //       : '  ->  ' + ce.box(replace, { canonical: false }).toString()),
    });
  }
  return result;
}

function applyRule(
  { match, replace, condition, id }: BoxedRule,
  expr: BoxedExpression,
  substitution: BoxedSubstitution,
  options?: ReplaceOptions
): BoxedExpression | null {
  // console.info('applyRule', id);

  const sub = match.match(expr, { substitution, ...options });
  // If the `expr` does not match the pattern, the rule doesn't apply
  if (sub === null) return null;

  // If the condition doesn't match, the rule doesn't apply
  if (typeof condition === 'function' && !condition(sub, expr.engine))
    return null;

  // @debug
  // if (typeof replace === 'function')
  //   console.info('Applying rule ', match.toString(), '->', 'function');
  // else
  //   console.info('Applying rule ', match.toString(), '->', replace.toString());
  // console.info(
  //   'with substitution',
  //   Object.entries(sub)
  //     .map(([k, v]) => `${k} -> ${v.toString()}`)
  //     .join(', ')
  // );
  // console.info(
  //   'applying rule',
  //   id,
  //   'to',
  //   expr.toString(),
  //   'with',
  //   Object.keys(sub)
  //     .map((x) => `${x} -> ${sub[x].toString()}`)
  //     .join(', ')
  // );
  if (typeof replace === 'function') return replace(expr, sub);
  return replace.subs(sub, { canonical: true });
}

/**
 * Apply the rules in the ruleset and return a modified expression.
 *
 * If no rule applied, return `null`.
 */
export function replace(
  expr: BoxedExpression,
  ruleSet: BoxedRuleSet,
  options?: ReplaceOptions
): BoxedExpression | null {
  const iterationLimit = options?.iterationLimit ?? 1;
  let iterationCount = 0;
  const once = options?.once ?? false;

  let done = false;
  let atLeastOneRule = false;
  try {
    while (!done && iterationCount < iterationLimit) {
      done = true;
      for (const rule of ruleSet) {
        const result = applyRule(rule, expr, {}, options);
        if (result !== null && result !== expr) {
          // If once flag is set, bail on first matching rule
          if (once) return result;
          done = false;
          atLeastOneRule = true;
          expr = result;
        }
      }
      iterationCount += 1;
    }
  } catch (e) {
    console.error(e);
  }
  return atLeastOneRule ? expr : null;
}

// @todo ['Alternatives', ...]:
// @todo: ['Condition',...] : Conditional match
// @todo: ['Repeated',...] : repeating match
// @todo _x:Head or _x:RealNumbers

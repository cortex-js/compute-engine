import {
  BoxedExpression,
  BoxedRule,
  IComputeEngine,
  Rule,
  BoxedRuleSet,
  ReplaceOptions,
  BoxedSubstitution,
  PatternConditionFunction,
  SemiBoxedExpression,
  PatternReplaceFunction,
} from './public';
import { asLatexString } from './boxed-expression/utils';

/**
 * For each rules in the rule set that match, return the `replace` of the rule
 *
 * @param rules
 */
export function matchRules(
  expr: BoxedExpression,
  rules: BoxedRuleSet,
  sub: BoxedSubstitution
): BoxedExpression[] {
  const results: BoxedExpression[] = [];
  for (const rule of rules) {
    const r = applyRule(rule, expr, sub);
    if (r === null) continue;
    // Verify that the results are unique
    if (results.some((x) => x.isSame(r))) continue;
    results.push(r);
  }

  return results;
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

/**
 * Create a boxed rule set from a non-boxed rule set
 * @param ce
 * @param rs
 * @returns
 */
export function boxRules(ce: IComputeEngine, rs: Iterable<Rule>): BoxedRuleSet {
  const result: BoxedRule[] = [];

  for (const rule of rs) result.push(normalizeRule(ce, rule));

  return result.sort((a, b) => b.priority - a.priority);
}

function normalizeLatexRule(
  ce: IComputeEngine,
  rule?: string | SemiBoxedExpression | PatternReplaceFunction
): BoxedExpression | undefined {
  if (rule === undefined || typeof rule === 'function') return undefined;
  if (typeof rule === 'string') {
    let expr = ce.parse(rule, { canonical: false });
    expr = expr.map(
      (x) => {
        // Only transform single character symbols. Avoid \pi, \imaginaryUnit, etc..
        if (x.symbol && x.symbol.length === 1) return ce.symbol('_' + x.symbol);
        return x;
      },
      { canonical: false }
    );
    return expr;
  }
  return ce.box(rule, { canonical: false });
}

function normalizeStringRule(ce: IComputeEngine, rule: string): BoxedRule {
  const [lhs, rhs] = rule.split(/->|\\to/).map((x) => x.trim());
  return normalizeRule(ce, {
    match: normalizeLatexRule(ce, lhs),
    replace: normalizeLatexRule(ce, rhs)!,
    priority: 0,
    condition: undefined,
    id: lhs + ' -> ' + rhs,
  });
}

function normalizeRule(ce: IComputeEngine, rule: Rule): BoxedRule {
  if (typeof rule === 'string') return normalizeStringRule(ce, rule);

  const { match, replace, condition, priority, id } = rule;

  // Normalize the condition to a function
  let condFn: undefined | PatternConditionFunction;
  if (typeof condition === 'string') {
    const latex = asLatexString(condition);
    if (latex) {
      // Substitute any unbound vars in the condition to a wildcard
      const condPattern = ce.parse(latex, { canonical: false });
      condFn = (x: BoxedSubstitution, _ce: IComputeEngine): boolean =>
        condPattern.subs(x).evaluate()?.symbol === 'True';
    }
  } else condFn = condition;

  const matchExpr = normalizeLatexRule(ce, match);
  const replaceExpr = normalizeLatexRule(ce, replace);
  return {
    match: matchExpr,
    replace: replaceExpr ?? (replace as PatternReplaceFunction),
    priority: priority ?? 0,
    condition: condFn,
    exact: rule.exact ?? true,
    id: id ?? (matchExpr?.latex ?? '') + ' -> ' + replaceExpr?.latex ?? '',
  };
}

/**
 * Apply a rule to an expression, assuming an incoming substitution
 * @param rule the rule to apply
 * @param expr the expression to apply the rule to
 * @param substitution an incoming substitution
 * @param options
 * @returns A transformed expression, if the rule matched. `null` otherwise.
 */
function applyRule(
  rule: BoxedRule,
  expr: BoxedExpression,
  substitution: BoxedSubstitution,
  options?: ReplaceOptions
): BoxedExpression | null {
  const { match, replace, condition, id } = rule;

  let changed = false;
  if (expr.ops && options?.recursive) {
    // Apply the rule to the operands of the expression
    const ce = expr.engine;
    const ops = expr.ops;
    const newOps = ops.map((op) => {
      const subExpr = applyRule(rule, op, {}, options);
      if (subExpr) changed = true;
      return subExpr ?? op;
    });
    if (changed) expr = ce.function(expr.head, newOps, { canonical: false });
  }

  const exact = rule.exact ?? true;
  const sub = match
    ? expr.match(match, { substitution, ...options, exact })
    : {};

  // If the `expr` does not match the pattern, the rule doesn't apply
  if (sub === null) return changed ? expr : null;

  // If the condition doesn't match, the rule doesn't apply
  if (typeof condition === 'function' && !condition(sub, expr.engine))
    return null;

  // console.trace('apply rule ', id, 'to', expr.toString());
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
  if (typeof replace === 'function') return replace(expr, sub) ?? null;
  return replace.subs(sub, { canonical: expr.isCanonical });
}

/**
 * Apply the rules in the ruleset and return a modified expression.
 *
 * If no rule applied, return `null`.
 */
export function replace(
  expr: BoxedExpression,
  ruleSet: BoxedRuleSet | Rule | Rule[],
  options?: ReplaceOptions
): BoxedExpression | null {
  const iterationLimit = options?.iterationLimit ?? 1;
  let iterationCount = 0;
  const once = options?.once ?? false;

  if (!(ruleSet instanceof Set))
    ruleSet = expr.engine.rules(
      Array.isArray(ruleSet) ? ruleSet : [ruleSet as Rule]
    );

  let done = false;
  let atLeastOneRule = false;
  try {
    while (!done && iterationCount < iterationLimit) {
      done = true;
      const appliedRules: string[] = [];
      for (const rule of ruleSet) {
        const result = applyRule(rule, expr, {}, options);
        if (result !== null && result !== expr) {
          // If once flag is set, bail on first matching rule
          if (once) return result;
          // If the rule has already been applied, skip it
          if (appliedRules.includes(rule.id)) {
            console.error(
              'Rule cycle detected',
              appliedRules.reduce((a, b) => a + ' -> ' + b, '')
            );
          }
          appliedRules.push(rule.id);
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

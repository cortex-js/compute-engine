import {
  BoxedExpression,
  BoxedRule,
  IComputeEngine,
  Rule,
  BoxedRuleSet,
  Substitution,
  ReplaceOptions,
} from './public';
import { getVars, isLatexString, latexString } from './boxed-expression/utils';

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
  for (const [rawLhs, rawRhs, options] of rs) {
    // Any unbound variables in the `lhs` is used as a wildcard
    let lhs = ce.pattern(rawLhs);
    const wildcards = {};
    for (const v of getVars(lhs)) wildcards[v] = ce.symbol('_' + v);
    lhs = lhs.subs(wildcards);

    // Normalize the condition to a function
    let cond: undefined | ((x: Substitution) => boolean);
    const latex = latexString(options?.condition);
    if (latex) {
      // Substitute any unbound vars in the condition to a wildcard
      const condPattern = ce.parse(latex)!.subs(wildcards);
      cond = (x: Substitution): boolean =>
        condPattern.subs(x).value?.symbol === 'True';
    } else cond = options?.condition as (x: Substitution) => boolean;

    const rhs = isLatexString(rawRhs) ? ce.parse(rawRhs) : ce.box(rawRhs);
    if (!rhs) {
      console.error('Invalid rhs');
      continue;
    }
    result.add([lhs, rhs.subs(wildcards), options?.priority ?? 0, cond]);
  }
  return result;
}

function applyRule(
  [lhs, rhs, _priority, condition]: BoxedRule,
  expr: BoxedExpression,
  options?: ReplaceOptions
): BoxedExpression | null {
  const sub = lhs.match(expr, options);
  // If the `expr` does not match the pattern, the rule doesn't apply
  if (sub === null) return null;

  // If the condition doesn't match, the rule doesn't apply
  if (typeof condition === 'function' && !condition(sub)) return null;

  // @debug
  // console.log('Applying rule ', lhs.latex, '->', rhs.latex);

  return rhs.subs(sub);
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
        const result = applyRule(rule, expr, options);
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

/**
 * Substitute some symbols with an expression.
 *
 * This is applied recursively to all subexpressions.
 *
 * While `replace()` applies a rule which may include expressions in
 * its `lhs` to an expression, `substitute` is a specialized version
 * that only apply rules that have a `lhs` made of a symbol.
 */
// export function substitute(
//   expr: BoxedExpression,
//   substitution: Substitution
// ): Pattern {
//   //
//   // Symbol
//   //
//   const symbol = expr.symbol;
//   if (symbol !== null) return expr.engine.pattern(substitution[symbol] ?? expr);

//   const ce = expr.engine;

//   //
//   // Dictionary
//   //
//   const keys = expr.keys;
//   if (keys !== null) {
//     const result = {};
//     for (const key of keys) result[key] = substitute(keys[key], substitution);

//     return ce.pattern({ dict: result });
//   }

//   // Not a function (or a dictionary or a symbol) => atomic
//   if (expr.ops === null) return ce.pattern(expr);

//   //
//   // Function
//   //
//   const tail: SemiBoxedExpression = [];
//   for (const arg of expr.ops) {
//     const symbol = arg.symbol;
//     if (symbol !== null && symbol.startsWith('__')) {
//       // Wildcard sequence: `__` or `___`
//       const seq = substitution[getWildcardName(symbol)];
//       if (seq === undefined || seq.head !== 'Sequence') {
//         tail.push(symbol);
//       } else {
//         tail.push(...seq.ops!);
//       }
//     } else {
//       tail.push(substitute(arg, substitution));
//     }
//   }

//   return ce.pattern(ce.fn(substitute(ce.box(expr.head), substitution), tail));
// }

export function getWildcardName(s: string): string {
  const m = s.match(/^__?_?([a-zA-Z0-9]+)/);
  if (m === null) return '';
  return m[1];
}

// @todo ['Alternatives', ...]:
// @todo: ['Condition',...] : Conditional match
// @todo: ['Repeated',...] : repeating match
// @todo _x:Head or _x:RealNumber

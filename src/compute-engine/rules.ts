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
import {
  asLatexString,
  isInequality,
  isRelationalOperator,
} from './boxed-expression/utils';
import { isCollection } from './collection-utils';
import { Parser } from './latex-syntax/public';
import { isPrime } from './library/arithmetic';

// @todo ['Alternatives', ...]:
// @todo: ['Condition',...] : Conditional match
// @todo: ['Repeated',...] : repeating match
// @todo _x:Head or _x:RealNumbers
// @todo Generator functions
// export function fixPoint(rule: Rule);
// export function chain(rules: RuleSet);

// Conditions:
// :boolean       - a boolean value, True or False
// :string        - a string of characters
// :number        - a number literal
// :symbol
// :expression

// :numeric       - an expression that has a numeric value, i.e. 2√3, 1/2, 3.14
// :integer       - an integer value, -2, -1, 0, 1, 2, 3, ...
// :natural       - a natural number, 0, 1, 2, 3, ...
// :\Z^-          - a negative integer, -1, -2, -3, ...
// :\Z^+          - a positive integer, 1, 2, 3, ...
// :real          - real numbers, including integers
// :imaginary     - imaginary numbers, i.e. 2i, 3√-1  (not including real numbers)
// :complex       - complex numbers, including real and imaginary
// :rational      - rational numbers, 1/2, 3/4, 5/6, ...
// :irrational    - irrational numbers, √2, √3, π, ...
// :algebraic     - algebraic numbers, rational and irrational
// :transcendental  - transcendental numbers, π, e, ...

// :positive      - positive real numbers, > 0
// :negative      - negative real numbers, < 0
// :nonnegative   - nonnegative real numbers, >= 0
// :nonpositive   - nonpositive real numbers, <= 0

// :even          - even integers, 0, 2, 4, 6, ...
// :odd           - odd integers, 1, 3, 5, 7, ...

// :prime         :A000040 - prime numbers, 2, 3, 5, 7, 11, ...
// :composite     :A002808 - composite numbers, 4, 6, 8, 9, 10, ...

// :notzero       - a value that is not zero
// :notone        - a value that is not one

// :finite        - a finite value, not infinite
// :infinite

// :constant
// :variable

// :function

// :operator
// :relation      - an equation or inequality
// :equation
// :inequality    -

// :vector        - a tensor of rank 1
// :matrix        - a tensor of rank 2
// :list          - a collection of values
// :set           - a collection of unique values
// :tuple         - a fixed length list
// :single        - a tuple of length 1
// :pair          - a tuple of length 2
// :triple        - a tuple of length 3
// :collection    - a list, set, or tuple
// :tensor        - a nested list of values of the same type
// :scalar        - not a tensor or list

// :unit
// :dimension
// :angle
// :polynomial    - an expression that is a sum of terms
// :A000000       - a number belonging to a sequence in the OEIS

export const ConditionParent = {
  boolean: '',
  string: '',
  expression: '',

  numeric: 'expression',
  number: 'numeric',
  symbol: 'expression',

  complex: 'number',
  imaginary: 'complex',
  real: 'complex',
  integer: 'real',
  rational: 'real',
  irrational: 'real',

  notzero: 'number',
  notone: 'number',

  finite: 'number',
  infinite: 'number',

  positive: 'real',
  negative: 'real',
  nonnegative: 'real',
  nonpositive: 'real',

  even: 'integer',
  odd: 'integer',

  prime: 'integer',
  composite: 'integer',

  constant: 'expression',
  variable: 'expression',

  function: 'expression',

  operator: 'expression',
  relation: 'operator',
  equation: 'relation',
  inequality: 'relation',

  collection: 'expression',
  list: 'collection',
  set: 'collection',

  tuple: 'collection',
  single: 'tuple',
  pair: 'tuple',
  triple: 'tuple',

  tensor: 'collection',
  vector: 'tensor',
  matrix: 'tensor',
  scalar: 'expression',

  unit: 'expression',
  dimension: 'expression',
  angle: 'expression',
  polynomial: 'expression',
};

export const CONDITIONS = {
  boolean: (x: BoxedExpression) => x.domain?.isCompatible('Booleans'), // @fixme: x.type === 'boolean'
  string: (x: BoxedExpression) => x.string !== null,
  number: (x: BoxedExpression) => x.isNumberLiteral,
  symbol: (x: BoxedExpression) => x.symbol !== null,
  expression: (x: BoxedExpression) => true,

  numeric: (x: BoxedExpression) => {
    const [c, term] = x.toNumericValue();
    return term.isOne;
  },
  integer: (x: BoxedExpression) => x.isInteger,
  real: (x: BoxedExpression) => x.isReal,
  complex: (x: BoxedExpression) => x.isComplex,
  imaginary: (x: BoxedExpression) => x.isImaginary,
  rational: (x: BoxedExpression) => x.isRational,
  irrational: (x: BoxedExpression) => x.domain?.isRational === false,

  positive: (x: BoxedExpression) => x.isPositive,
  negative: (x: BoxedExpression) => x.isNegative,
  nonnegative: (x: BoxedExpression) => x.isNonNegative,
  nonpositive: (x: BoxedExpression) => x.isNonPositive,

  even: (x: BoxedExpression) => x.isEven,
  odd: (x: BoxedExpression) => x.isOdd,

  prime: (x: BoxedExpression) => isPrime(x) === true,
  composite: (x: BoxedExpression) => isPrime(x) === false,

  notzero: (x: BoxedExpression) => x.isNotZero,
  notone: (x: BoxedExpression) => !x.isOne,

  finite: (x: BoxedExpression) => x.isFinite,
  infinite: (x: BoxedExpression) => !x.isFinite,

  constant: (x: BoxedExpression) => x.symbol !== null && x.isConstant,
  variable: (x: BoxedExpression) =>
    x.symbol !== null && !x.domain?.isFunction && !x.isConstant,
  function: (x: BoxedExpression) => x.symbol !== null && x.domain?.isFunction,

  relation: (x: BoxedExpression) => isRelationalOperator(x.operator),
  equation: (x: BoxedExpression) => x.operator === 'Equal',
  inequality: (x: BoxedExpression) => isInequality(x),

  collection: (x: BoxedExpression) => isCollection(x),
  list: (x: BoxedExpression) => x.operator === 'List',
  set: (x: BoxedExpression) => x.operator === 'Set',
  tuple: (x: BoxedExpression) =>
    x.operator === 'Tuple' ||
    x.operator === 'Single' ||
    x.operator === 'Pair' ||
    x.operator === 'Triple',
  single: (x: BoxedExpression) => x.operator === 'Single',
  pair: (x: BoxedExpression) => x.operator === 'Pair',
  triple: (x: BoxedExpression) => x.operator === 'Triple',
  tensor: (x: BoxedExpression) => x.rank > 0,
  vector: (x: BoxedExpression) => x.rank === 1,
  matrix: (x: BoxedExpression) => x.rank === 2,
  scalar: (x: BoxedExpression) => x.rank === 0,

  unit: (x: BoxedExpression) => x.operator === 'Unit',
  dimension: (x: BoxedExpression) => x.operator === 'Dimension',
  angle: (x: BoxedExpression) => x.operator === 'Angle',
  polynomial: (x: BoxedExpression) => x.unknowns.length === 1,
};

function checkConditions(x: BoxedExpression, conditions: string[]): boolean {
  // Check for !== true, because result could also be undefined
  for (const cond of conditions) if (CONDITIONS[cond](x) !== true) return false;

  return true;
}

function tokenizeLaTeX(input: string): string[] {
  // Regular expression to match LaTeX tokens
  const regex = /\\[a-zA-Z]+|[{}]|[\d]+|[+\-*/^_=(),.;]|[a-zA-Z]/g;

  // Match the input string against the regular expression
  const tokens = input.match(regex);
  // If no tokens are found, return an empty array
  if (!tokens) return [];
  return tokens.filter((x) => x !== ' '); // Remove spaces;
}

function parseModifier(parser: Parser): string | null {
  // Is it a tagged modifier of the form `\mathrm{modifier}`?
  const next = parser.peek;
  let modifier: string | null = null;
  if (next === '\\mathrm') {
    parser.nextToken();
    modifier = parser.parseStringGroup();
  } else if (/^[a-z]$/.test(next)) {
    // We also accept unwrapped modifiers, i.e. `:modifier`
    modifier = parser.nextToken();
    while (/^[a-z]$/.test(parser.peek)) modifier += parser.nextToken();
  } else {
    // We accept some shortcuts for common conditions
    const shortcuts = {
      '>0': 'positive',
      '\\gt0': 'positive',
      '<0': 'negative',
      '\\lt0': 'negative',
      '>=0': 'nonnegative',
      '\\geq0': 'nonnegative',
      '<=0': 'nonpositive',
      '\\leq0': 'nonpositive',
      '!=0': 'notzero',
      '\\neq0': 'notzero',
      '\\neq1': 'notone',
      '!=1': 'notone',
      '\\in\\Z': 'integer',
      '\\in\\mathbb{Z}': 'integer',
      '\\in\\N': 'natural',
      '\\in\\mathbb{N}': 'natural',
      '\\in\\R': 'real',
      '\\in\\mathbb{R}': 'real',
      '\\in\\C': 'complex',
      '\\in\\mathbb{C}': 'complex',
      '\\in\\Q': 'rational',
      '\\in\\mathbb{Q}': 'rational',
      '\\in\\Z^+': 'integer,positive',
      '\\in\\Z^-': 'intger,negative',
      '\\in\\Z^*': 'nonzero',
      '\\in\\R^+': 'positive',
      '\\in\\R^-': 'negative',
      '\\in\\R^*': 'real,nonzero',
      '\\in\\N^*': 'integer,positive',
      '\\in\\N_0': 'integer,nonnegative',
      '\\in\\R\\backslash\\Q': 'irrational',
    };
    for (const shortcut in shortcuts) {
      const tokens = tokenizeLaTeX(shortcut);
      const start = parser.index;
      for (const token of tokens) {
        if (!parser.match(token)) {
          parser.index = start;
          break;
        }
        parser.skipSpace();
      }
      modifier = shortcuts[shortcut];
      break;
    }
  }

  if (!modifier) return null;
  if (!Object.keys(CONDITIONS).includes(modifier))
    throw new Error(`Unexpected condition ${modifier}`);
  return modifier;
}

function parserModifiers(parser: Parser): string {
  let modifiers = '';
  do {
    const modifier = parseModifier(parser);
    if (!modifier) break;
    modifiers += modifier;
  } while (parser.match(','));
  return modifiers;
}

// Look for a modifier expression of the form
// `:condition1,condition2,...`
// or `_{condition1,condition2,...}`
function parseModifierExpression(parser: Parser): string | null {
  let conditions: string | null = null;
  if (parser.match(':')) conditions = parserModifiers(parser);
  else if (parser.matchAll(['_', '<{>'])) {
    conditions = parserModifiers(parser);
    if (!parser.match('<}>')) return null;
  }
  return conditions;
}

function parseLatexRule(
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

/** A rule can be expressed as a string of the form
 * "<match> -> <replace>; <condition>"
 * where `<match>`, `<replace>` and `<condition>` are LaTeX expressions.
 */
function parseRule(ce: IComputeEngine, rule: string): BoxedRule {
  const makeWildcardEntry = (x: string) => {
    return {
      kind: 'symbol',
      latexTrigger: x,
      // domain: { kind: 'Any' },
      parse: (parser, until) => {
        // console.log(parser.peek);
        if (!wildcards[x]) wildcards[x] = `_${x}`;
        // conditions are `:condition` or `:condition1,condition2,...`
        // or `:\mathrm{condition}`
        const conditions = parseModifierExpression(parser);
        if (conditions === null) return null;
        if (!wildcardConditions[x]) wildcardConditions[x] = conditions;
        else wildcardConditions[x] += ',' + conditions;

        return wildcards[x];
      },
    };
  };

  // Setup custom dictionary entries for ...x, ...x?
  // mapping to wildcard sequence, wildcard optional sequence
  const previousDictionary = ce.latexDictionary;

  // A mapping from an identifier to a wildcard
  const wildcards: Record<string, string> = {};
  // A mapping from an identifier to a condition
  const wildcardConditions: Record<string, string> = {};

  // Add wildcard entries for all lowercase letters, execpt
  // for e (natural number), d (differential) and i (imaginary unit)
  ce.latexDictionary = [
    ...previousDictionary,
    {
      kind: 'prefix',
      precedence: 100,
      latexTrigger: '...',
      parse: (parser, until) => {
        const id = parser.nextToken();
        if (!'abcfghjklmnopqrstuvwxyz'.includes(id)) return null;
        let prefix = '__';
        // Optional wildcard sequence?
        if (parser.match('?')) prefix = '___';

        if (wildcards[id] && wildcards[id] !== `${prefix}${id}`)
          throw new Error(`Duplicate wildcard ${id}`);
        if (!wildcards[id]) wildcards[id] = `${prefix}${id}`;

        // Check for conditions
        const conditions = parseModifierExpression(parser);
        if (conditions === null) return null;

        if (!wildcardConditions[id]) wildcardConditions[id] = conditions;
        else wildcardConditions[id] += ',' + conditions;

        return `${prefix}${id}`;
      },
    },
    ...'abcfghjklmnopqrstuvwxyz'.split('').map(makeWildcardEntry),
    {
      kind: 'infix',
      precedence: 100,
      latexTrigger: '->',
      parse: (parser, lhs, until) => {
        const rhs = parser.parseExpression(until);
        if (rhs === null) return null;
        if (parser.match(';')) {
          // condition is either a predicate, or a sequence of wildcards + ":" + modifiers
          // Try the sequence of wildcards first
          let done = false;
          const start = parser.index;
          do {
            const id = parser.nextToken();
            if (wildcards[id]) {
              const conditions = parseModifierExpression(parser);
              if (conditions === null || !conditions) {
                done = true;
                parser.index = start;
                break;
              }
              if (!wildcardConditions[id]) wildcardConditions[id] = conditions;
              else wildcardConditions[id] += ',' + conditions;
            }
          } while (!done);
          if (!parser.atEnd) {
            parser.index = start;
            const condition = parser.parseExpression(until);
            if (condition !== null) return ['Rule', lhs, rhs, condition];
          }
        }
        // Check if we have some accumulated conditions
        const conditions: any[] = [];
        for (const id in wildcardConditions) {
          const xs = wildcardConditions[id].split(',');
          if (xs.length === 0) continue;
          if (xs.length === 1) {
            conditions.push(['Condition', wildcards[id], xs[0]]);
          } else conditions.push(['Condition', wildcards[id], ['List', ...xs]]);
        }

        if (conditions.length === 0) return ['Rule', lhs, rhs];
        if (conditions.length === 1) return ['Rule', lhs, rhs, conditions[0]];
        return ['Rule', lhs, rhs, ['List', ...conditions]];
      },
    },
  ];
  const expr = ce.parse(rule, { canonical: false });
  ce.latexDictionary = previousDictionary;

  if (expr.operator !== 'Rule') throw new Error(`Invalid rule ${rule}`);
  const [match, replace, condition] = expr.ops!;

  let condFn: undefined | PatternConditionFunction = undefined;
  if (condition !== null) {
    condFn = (sub: BoxedSubstitution, _ce: IComputeEngine): boolean => {
      for (const id of Object.keys(sub)) {
        // Map the id to a wildcard

        // Find a key in the wildcards that matches the id
        const idx =
          Object.keys(wildcards)[
            Object.values(wildcards).findIndex((x) => x === id)
          ];
        if (idx === undefined) continue;

        const wcCond = wildcardConditions[idx];
        if (!wcCond) continue;
        const conditions = wcCond.split(',');
        if (!checkConditions(sub[id], conditions)) return false;
      }
      return true;
    };
  }

  return boxRule(ce, {
    match,
    replace,
    priority: 0,
    condition: condFn,
    id: match.toString() + ' -> ' + replace.toString(),
  });
}

function boxRule(ce: IComputeEngine, rule: Rule): BoxedRule {
  if (typeof rule === 'string') return parseRule(ce, rule);

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

  const matchExpr = parseLatexRule(ce, match);
  const replaceExpr = parseLatexRule(ce, replace);
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
 * Create a boxed rule set from a collection of non-boxed rules
 */
export function boxRules(ce: IComputeEngine, rs: Iterable<Rule>): BoxedRuleSet {
  const result: BoxedRule[] = [];

  for (const rule of rs) result.push(boxRule(ce, rule));

  return result.sort((a, b) => b.priority - a.priority);
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
  const { match, replace, condition } = rule;

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
    if (changed)
      expr = ce.function(expr.operator, newOps, {
        canonical: expr.isCanonical,
      });
  }

  const exact = rule.exact ?? true;
  const sub = match
    ? expr.match(match, { substitution, ...options, exact })
    : {};

  // If the `expr` does not match the pattern, the rule doesn't apply
  if (sub === null) return changed ? expr : null;

  // If the condition doesn't match, the rule doesn't apply
  if (typeof condition === 'function' && !condition(sub, expr.engine))
    return changed ? expr : null;

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
  const result =
    typeof replace === 'function'
      ? replace(expr, sub)
      : replace.subs(sub, { canonical: expr.isCanonical });
  if (!result) return null;
  return expr.isCanonical ? result.canonical : result;
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

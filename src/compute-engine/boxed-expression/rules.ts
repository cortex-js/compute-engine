import type { Expression } from '../../math-json/types';

import type {
  BoxedRule,
  BoxedRuleSet,
  BoxedSubstitution,
  ComputeEngine,
  Rule,
  RuleConditionFunction,
  RuleFunction,
  RuleReplaceFunction,
  RuleStep,
  RuleSteps,
  BoxedExpression,
  ReplaceOptions,
  SemiBoxedExpression,
} from '../global-types';

import {
  asLatexString,
  isInequalityOperator,
  isRelationalOperator,
} from '../latex-syntax/utils';

import { Parser } from '../latex-syntax/types';

import { isPrime } from '../library/arithmetic';
// @todo:
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
  notreal: 'complex',
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
  boolean: (x: BoxedExpression) => x.type.matches('boolean'),
  string: (x: BoxedExpression) => x.string !== null,
  number: (x: BoxedExpression) => x.isNumberLiteral,
  symbol: (x: BoxedExpression) => x.symbol !== null,
  expression: (x: BoxedExpression) => true,

  numeric: (x: BoxedExpression) => {
    const [c, term] = x.toNumericValue();
    return term.is(1);
  },
  integer: (x: BoxedExpression) => x.isInteger,
  rational: (x: BoxedExpression) => x.isRational,
  irrational: (x: BoxedExpression) => x.isRational === false,
  real: (x: BoxedExpression) => x.isReal,
  notreal: (x: BoxedExpression) => !x.isReal,

  // number with a non-zero imaginary part:
  complex: (x: BoxedExpression) => x.type.matches('complex'),
  // number with a zero real part and non-zero imaginary part:
  imaginary: (x: BoxedExpression) => x.type.matches('imaginary'),

  positive: (x: BoxedExpression) => x.isPositive,
  negative: (x: BoxedExpression) => x.isNegative,
  nonnegative: (x: BoxedExpression) => x.isNonNegative,
  nonpositive: (x: BoxedExpression) => x.isNonPositive,

  even: (x: BoxedExpression) => x.isEven,
  odd: (x: BoxedExpression) => x.isOdd,

  prime: (x: BoxedExpression) => isPrime(x) === true,
  composite: (x: BoxedExpression) => isPrime(x) === false,

  notzero: (x: BoxedExpression) => x.is(0) === false,
  notone: (x: BoxedExpression) => x.is(1) === false,

  finite: (x: BoxedExpression) => x.isFinite,
  infinite: (x: BoxedExpression) => x.isFinite === false,

  constant: (x: BoxedExpression) => x.valueDefinition?.isConstant ?? false,
  variable: (x: BoxedExpression) => !(x.valueDefinition?.isConstant ?? true),
  function: (x: BoxedExpression) => x.operatorDefinition !== undefined,

  relation: (x: BoxedExpression) => isRelationalOperator(x.operator),
  equation: (x: BoxedExpression) => x.operator === 'Equal',
  inequality: (x: BoxedExpression) => isInequalityOperator(x.operator),

  collection: (x: BoxedExpression) => x.isCollection,
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

  scalar: (x: BoxedExpression) => x.rank === 0,
  tensor: (x: BoxedExpression) => x.rank > 0,
  vector: (x: BoxedExpression) => x.rank === 1,
  matrix: (x: BoxedExpression) => x.rank === 2,

  unit: (x: BoxedExpression) => x.operator === 'Unit',
  dimension: (x: BoxedExpression) => x.operator === 'Dimension',
  angle: (x: BoxedExpression) => x.operator === 'Angle',
  polynomial: (x: BoxedExpression) => x.unknowns.length === 1,
};

export function checkConditions(
  x: BoxedExpression,
  conditions: string[]
): boolean {
  // Check for !== true, because result could also be undefined
  for (const cond of conditions) if (CONDITIONS[cond](x) !== true) return false;

  return true;
}

function tokenizeLaTeX(input: string): string[] {
  // Regular expression to match LaTeX tokens
  const regex = /\\[a-zA-Z]+|[{}]|[\d]+|[+\-*/^_=()><,.;]|[a-zA-Z]/g;

  const tokens = input.match(regex);

  if (!tokens) return [];

  // Filter blank spaces
  return tokens.filter((x) => !/^[ \f\n\r\t\v\xA0\u2028\u2029]+$/.test(x));
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
      '\\in\\Z': 'integer',
      '\\in\\mathbb{Z}': 'integer',
      '\\in\\N': 'integer,nonnegative',
      '\\in\\mathbb{N}': 'integer,nonnegative',
      '\\in\\N^*': 'integer,positive',
      '\\in\\N_0': 'integer,nonnegative',
      '\\in\\R\\backslash\\Q': 'irrational',
    };
    for (const shortcut in shortcuts) {
      if (parser.matchAll(tokenizeLaTeX(shortcut))) {
        modifier = shortcuts[shortcut];
        break;
      }
    }
  }

  if (!modifier) return null;
  if (!Object.keys(CONDITIONS).includes(modifier))
    throw new Error(`Unexpected condition "${modifier}" in a rule`);
  return modifier;
}

function parserModifiers(parser: Parser): string {
  const modifiers: string[] = [];
  do {
    const modifier = parseModifier(parser);
    if (!modifier) break;
    modifiers.push(modifier);
  } while (parser.match(','));
  return modifiers.join(',');
}

// Look for a modifier expression of the form
// `:condition1,condition2,...` or `_{condition1,condition2,...}`
function parseModifierExpression(parser: Parser): string | null {
  let conditions: string | null = null;
  if (parser.match(':')) conditions = parserModifiers(parser);
  else if (parser.matchAll(['_', '<{>'])) {
    conditions = parserModifiers(parser);
    if (!parser.match('<}>')) return null;
  }
  return conditions;
}

/* Return an expression for a match/replace part of a rule if a LaTeX string
 or MathJSON expression
 */
function parseRulePart(
  ce: ComputeEngine,
  rule?: string | SemiBoxedExpression | RuleReplaceFunction | RuleFunction,
  options?: { canonical?: boolean }
): BoxedExpression | undefined {
  if (rule === undefined || typeof rule === 'function') return undefined;
  if (typeof rule === 'string') {
    let expr = ce.parse(rule, { canonical: options?.canonical ?? false });
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
  return ce.box(rule, { canonical: options?.canonical ?? false });
}

/** A rule can be expressed as a string of the form
 * `<match> -> <replace>; <condition>`
 * where `<match>`, `<replace>` and `<condition>` are LaTeX expressions.
 */
function parseRule(
  ce: ComputeEngine,
  rule: string,
  options?: { canonical?: boolean }
): BoxedRule {
  const makeWildcardEntry = (x: string) => {
    return {
      kind: 'symbol',
      latexTrigger: x,
      // domain: { kind: 'Any' },
      parse: (parser, until) => {
        if (!wildcards[x]) wildcards[x] = `_${x}`;
        // conditions are `:condition` or `:condition1,condition2,...`
        // or `:\mathrm{condition}`
        const conditions = parseModifierExpression(parser);
        if (conditions !== null) {
          if (!wildcardConditions[x]) wildcardConditions[x] = conditions;
          else wildcardConditions[x] += ',' + conditions;
        }
        return wildcards[x];
      },
    };
  };

  // Setup custom dictionary entries for ...x, ...x?
  // mapping to wildcard sequence, wildcard optional sequence
  const previousDictionary = ce.latexDictionary;

  // A mapping from a symbol to a wildcard
  const wildcards: Record<string, string> = {};

  // A mapping from a symbol to a condition
  const wildcardConditions: Record<string, string> = {};

  // Add wildcard entries for all lowercase letters, except
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
          throw new Error(`Duplicate wildcard "${id}"`);
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
        const rhs = parser.parseExpression({ ...until, minPrec: 20 });
        if (rhs === null) return null;

        //
        // Check if we have a condition part after a semicolon
        // i.e. "a + b -> c; a > 0"
        //
        let conditionPredicate: Expression | null = null;
        if (parser.match(';')) {
          // Condition is either a predicate, or a sequence of wildcards + ":" + modifiers
          // Try the sequence of wildcards first
          let done = false;
          const start = parser.index;
          do {
            parser.skipSpace();
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
          } while (!done && !parser.atEnd);

          // Is there a remaining predicate?
          conditionPredicate = parser.parseExpression(until);
        }

        //
        // Check if we have some accumulated conditions from inline modifiers
        // i.e. a:positive or a_{positive}
        //
        const conditions: any[] = [];
        for (const id in wildcardConditions) {
          const xs = wildcardConditions[id].split(',');
          if (xs.length === 0) continue;
          if (xs.length === 1) {
            conditions.push(['Condition', wildcards[id], xs[0]]);
          } else conditions.push(['Condition', wildcards[id], ['And', ...xs]]);
        }

        let conditionExpression: Expression | undefined = undefined;
        if (conditionPredicate && conditions.length > 0) {
          conditionExpression = ['And', conditionPredicate, ...conditions];
        } else if (conditionPredicate) conditionExpression = conditionPredicate;
        else if (conditions.length === 1) conditionExpression = conditions[0];
        else if (conditions.length > 1)
          conditionExpression = ['And', ...conditions];

        if (conditionExpression) return ['Rule', lhs, rhs, conditionExpression];
        return ['Rule', lhs, rhs];
      },
    },
  ];
  const canonical = options?.canonical ?? false;
  const expr = ce.parse(rule);
  ce.latexDictionary = previousDictionary;

  if (!expr.isValid || expr.operator !== 'Rule')
    throw new Error(
      `Invalid rule "${rule}"\n|   ${dewildcard(expr).toString()}\n|   A rule should be of the form:\n|   <match> -> <replace>; <condition>`
    );

  let [match, replace, condition] = expr.ops!;

  if (canonical) {
    match = match.canonical;
    replace = replace.canonical;
  }

  // Check that all the wildcards in the replace also appear in the match
  if (!includesWildcards(replace, match))
    throw new Error(
      `Invalid rule "${rule}"\n|   The replace expression contains wildcards not present in the match expression`
    );

  if (match.isSame(replace)) {
    throw new Error(
      `Invalid rule "${rule}"\n|   The match and replace expressions are the same.\n|   This may be because the rule is not necessary due to canonical simplification`
    );
  }

  let condFn: undefined | RuleConditionFunction = undefined;
  if (condition !== undefined) {
    // Verify that all the wildcards in the condition also appear in the match
    if (!includesWildcards(condition, match))
      throw new Error(
        `Invalid rule "${rule}"\n|   The condition expression contains wildcards not present in the match expression`
      );

    // Evaluate the condition as a predicate
    condFn = (sub: BoxedSubstitution): boolean =>
      condition.subs(sub).canonical.evaluate()?.symbol === 'True';
  }

  return boxRule(ce, { match, replace, condition: condFn, id: rule }, options);
}

function boxRule(
  ce: ComputeEngine,
  rule: Rule | BoxedRule,
  options?: { canonical?: boolean }
): BoxedRule {
  if (rule === undefined || rule === null)
    throw new Error('Expected a rule, not ' + rule);

  if (isBoxedRule(rule)) return rule;

  // If the rule is defined as a single string, parse it
  // e.g. `|x| -> x; x > 0`
  if (typeof rule === 'string') return parseRule(ce, rule, options);

  // If the rule is defined as a function, the function will be called
  // on every expression to process it.
  if (typeof rule === 'function')
    return {
      _tag: 'boxed-rule',
      match: undefined,
      replace: rule,
      condition: undefined,
      id: rule.toString().replace(/\n/g, ' '),
    };

  // eslint-disable-next-line prefer-const
  let { match, replace, condition, id, onMatch, onBeforeMatch } = rule;

  if (replace === undefined)
    throw new Error(
      `Invalid rule "${id ?? JSON.stringify(rule, undefined, 4)}"\n|   A rule must include at least a replace property`
    );

  // Normalize the condition to a function
  let condFn: undefined | RuleConditionFunction;
  if (typeof condition === 'string') {
    const latex = asLatexString(condition);
    if (latex) {
      // If the condition is a LaTeX string, it should be a predicate
      // (an expression with a Boolean value).
      const condPattern = ce.parse(latex, {
        canonical: options?.canonical ?? false,
      });

      // Substitute any unbound vars in the condition to a wildcard,
      // then evaluate the condition
      condFn = (x: BoxedSubstitution, _ce: ComputeEngine): boolean =>
        condPattern.subs(x).evaluate()?.symbol === 'True';
    }
  } else {
    if (condition !== undefined && typeof condition !== 'function')
      throw new Error(
        `Invalid rule ${id ?? JSON.stringify(rule, undefined, 4)}\n|   condition is not a valid function`
      );
    condFn = condition;
  }

  if (typeof match === 'function') {
    throw new Error(
      `Invalid rule ${id ?? JSON.stringify(rule, undefined, 4)}\n|   match is not a valid expression.\n|   Use a replace function instead to validate and replace the expression`
    );
  }

  ce.pushScope();
  const matchExpr = parseRulePart(ce, match, options);
  const replaceExpr = parseRulePart(ce, replace, options);
  ce.popScope();

  // Make up an id if none is provided
  if (!id) {
    if (typeof match === 'string') id = match;
    else id = JSON.stringify(match, undefined, 4);

    if (replace) {
      id += ' -> ';

      if (typeof replace === 'string') id += replace;
      else if (typeof replace === 'function')
        id += replace?.toString().replace(/\n/g, ' ');
      else id = JSON.stringify(replace, undefined, 4);
    }

    if (typeof condition === 'string') id += `; ${condition}`;
    else if (typeof condition === 'function')
      id += `; ${condition.toString().replace(/\n/g, ' ')}`;
  }

  if (matchExpr && !matchExpr.isValid) {
    throw new Error(
      `Invalid rule ${id}\n|   the match expression is not valid: ${matchExpr.toString()}`
    );
  }

  if (replaceExpr && !replaceExpr.isValid) {
    throw new Error(
      `Invalid rule ${id ?? JSON.stringify(rule, undefined, 4)}\n|   The replace expression is not valid: ${replaceExpr?.toString()}`
    );
  }

  if (!replaceExpr && typeof replace !== 'function')
    throw new Error(
      `Invalid rule ${id ?? JSON.stringify(rule, undefined, 4)}\n|   The replace expression could not be parsed`
    );

  return {
    _tag: 'boxed-rule',
    match: matchExpr,
    replace: replaceExpr ?? (replace as RuleReplaceFunction | RuleFunction),
    condition: condFn,
    useVariations: rule.useVariations,
    id,
    onMatch,
    onBeforeMatch,
  };
}

/**
 * Create a boxed rule set from a collection of non-boxed rules
 */
export function boxRules(
  ce: ComputeEngine,
  rs: Rule | ReadonlyArray<Rule | BoxedRule> | BoxedRuleSet | undefined | null,
  options?: { canonical?: boolean }
): BoxedRuleSet {
  if (!rs) return { rules: [] };

  if (typeof rs === 'object' && 'rules' in rs) return rs as BoxedRuleSet;

  if (!Array.isArray(rs)) rs = [rs as Rule | BoxedRule];

  const rules: BoxedRule[] = [];
  for (const rule of rs) {
    try {
      rules.push(boxRule(ce, rule, options));
    } catch (e) {
      // There was a problem with a rule, skip it and continue
      throw new Error(
        `\n${e.message}\n|   Skipping rule ${JSON.stringify(rule, undefined, 4)}\n\n`
      );
    }
  }
  return { rules };
}

/**
 * Apply a rule to an expression, assuming an incoming substitution
 * @param rule the rule to apply
 * @param expr the expression to apply the rule to
 * @param substitution an incoming substitution
 * @param options
 * @returns A transformed expression, if the rule matched. `null` otherwise.
 */
export function applyRule(
  rule: Readonly<BoxedRule>,
  expr: BoxedExpression,
  substitution: BoxedSubstitution,
  options?: Readonly<Partial<ReplaceOptions>>
): RuleStep | null {
  const canonical =
    options?.canonical ?? (expr.isCanonical || expr.isStructural);

  let operandsMatched = false;

  if (expr.ops && options?.recursive) {
    // Apply the rule to the operands of the expression
    const newOps = expr.ops.map((op) => {
      const subExpr = applyRule(rule, op, {}, options);
      if (!subExpr) return op;
      operandsMatched = true;
      return subExpr.value;
    });

    // At least one operand (directly or recursively) matched: but continue onwards to match against
    // the top-level expr., test against any 'condition', et cetera.
    if (operandsMatched)
      expr = expr.engine.function(expr.operator, newOps, { canonical });
  }

  // eslint-disable-next-line prefer-const
  let { match, replace, condition, id, onMatch, onBeforeMatch } = rule;
  const because = id ?? '';

  if (canonical && match) {
    const awc = getWildcards(match);
    const originalMatch = match;
    match = match.canonical;
    const bwc = getWildcards(match);
    if (!awc.every((x) => bwc.includes(x)))
      throw new Error(
        `\n|   Invalid rule "${rule.id}"\n|   The canonical form of ${dewildcard(originalMatch).toString()} is "${dewildcard(match).toString()}" and it does not contain all the wildcards of the original match.\n|   This could indicate that the match expression in canonical form is already simplified and this rule may not be necessary`
      );
  }

  const useVariations = rule.useVariations ?? options?.useVariations ?? false;

  // For debugging
  onBeforeMatch?.(rule, expr);

  const sub = match
    ? expr.match(match, { substitution, useVariations, recursive: false })
    : {};

  // If the `expr` does not match the pattern, the rule doesn't apply
  if (sub === null) return operandsMatched ? { value: expr, because } : null;

  // If the condition doesn't match, the rule doesn't apply
  if (typeof condition === 'function') {
    // The substitution includes wildcards. Transform wildcards to their
    // corresponding values.
    // So if `sub = {_a: 2, _b: 3}`, then the substitution will be
    // `{a: 2, b: 3, _a: 2, _b: 3}`

    // Because some substitution may be sequence wildcards (e.g. ...x)
    // or optional sequence wildcards (e.g. ...x?) we keep them in the substitution as well
    // @todo: shouldn't this check that the subs start with _?
    const conditionSub = {
      ...Object.fromEntries(
        Object.entries(sub).map(([k, v]) => [k.slice(1), v])
      ),
      ...sub,
    };

    try {
      if (!condition(conditionSub, expr.engine))
        return operandsMatched ? { value: expr, because } : null;
    } catch (e) {
      console.error(
        `\n|   Rule "${rule.id}"\n|   Error while checking condition\n|    ${e.message}`
      );
      return null;
    }
  }

  //@note: '.subs()' acts like an expr. 'clone' here (in case of an empty substitution)
  const result =
    typeof replace === 'function'
      ? replace(expr, sub)
      : replace.subs(sub, { canonical });

  if (!result) return null;

  // To aid in debugging, invoke onMatch when the rule matches
  onMatch?.(rule, expr, result);

  if (isRuleStep(result))
    return canonical ? { ...result, value: result.value.canonical } : result;

  return { value: canonical ? result.canonical : result, because };
}

/**
 * Apply the rules in the ruleset and return a modified expression
 * and the set of rules that were applied.
 *
 * The `replace` function can be used to apply a rule to a non-canonical
 * expression. @fixme: account for options.canonical
 *
 */
export function replace(
  expr: BoxedExpression,
  rules: Rule | (Rule | BoxedRule)[] | BoxedRuleSet,
  options?: Partial<ReplaceOptions>
): RuleSteps {
  if (!rules) throw new Error('replace(): Expected one or more rules');

  const iterationLimit = options?.iterationLimit ?? 1;
  let iterationCount = 0;
  const once = options?.once ?? false;

  // Normalize the ruleset
  let ruleSet: ReadonlyArray<BoxedRule>;
  if (typeof rules === 'object' && 'rules' in rules) ruleSet = rules.rules;
  else {
    ruleSet = expr.engine.rules(
      Array.isArray(rules) ? rules : [rules as Rule | BoxedRule]
    ).rules;
  }

  let done = false;
  const steps: RuleStep[] = [];
  while (!done && iterationCount < iterationLimit) {
    done = true;
    for (const rule of ruleSet) {
      try {
        const result = applyRule(rule, expr, {}, options);
        if (
          result !== null &&
          result.value !== expr &&
          !result.value.isSame(expr)
        ) {
          // If `once` flag is set, bail on first matching rule
          if (once) return [result];

          // If we have detected a loop, exit
          if (steps.some((x) => x.value.isSame(result.value))) return steps;

          steps.push(result);

          // We have a rule apply, so we'll want to continue iterating
          done = false;
          expr = result.value;
        }
      } catch (e) {
        console.error(`\n${expr.toString()}\n${rule.id}\n${e.message}`);
        return steps;
      }
    }
    iterationCount += 1;
  }
  return steps;
}

/**
 * For each rules in the rule set that match, return the `replace` of the rule
 *
 * @param rules
 */
export function matchAnyRules(
  expr: BoxedExpression,
  rules: BoxedRuleSet,
  sub: BoxedSubstitution,
  options?: Partial<ReplaceOptions>
): BoxedExpression[] {
  const results: BoxedExpression[] = [];
  for (const rule of rules.rules) {
    const r = applyRule(rule, expr, sub, options);

    // Verify that the results are unique
    if (r !== null && !results.some((x) => x.isSame(r.value)))
      results.push(r.value);
  }

  return results;
}

/**
 * Replace all occurrences of a wildcard in an expression with a the corresponding non-wildcard, e.g. `_x` -> `x`
 */
function dewildcard(expr: BoxedExpression): BoxedExpression {
  const symbol = expr.symbol;
  if (symbol) {
    if (symbol.startsWith('_')) return expr.engine.symbol(symbol.slice(1));
  }
  if (expr.ops) {
    const ops = expr.ops.map((x) => dewildcard(x));
    return expr.engine.function(expr.operator, ops, { canonical: false });
  }
  return expr;
}

function getWildcards(expr: BoxedExpression): string[] {
  const wildcards: string[] = [];
  if (expr.symbol && expr.symbol.startsWith('_')) wildcards.push(expr.symbol);
  if (expr.ops) expr.ops.forEach((x) => wildcards.push(...getWildcards(x)));
  return wildcards;
}

/** Return true if all the wildcards of a are included in b */
function includesWildcards(a: BoxedExpression, b: BoxedExpression): boolean {
  const awc = getWildcards(a);
  const bwc = getWildcards(b);
  return awc.every((x) => bwc.includes(x));
}

/** @category Rules */

function isRuleStep(x: any): x is RuleStep {
  return x && typeof x === 'object' && 'because' in x && 'value' in x;
}

/** @category Rules */
function isBoxedRule(x: any): x is BoxedRule {
  return x && typeof x === 'object' && x._tag === 'boxed-rule';
}

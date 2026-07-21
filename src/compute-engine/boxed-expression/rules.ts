import type { MathJsonExpression } from '../../math-json/types.js';

import {
  CancellationError,
  checkDeadline,
} from '../../common/interruptible.js';
import { _BoxedExpression } from './abstract-boxed-expression.js';
import type {
  BoxedRule,
  BoxedRuleSet,
  BoxedSubstitution,
  IComputeEngine as ComputeEngine,
  Rule,
  RuleConditionFunction,
  RuleFunction,
  RulePurpose,
  RuleReplaceFunction,
  RuleStep,
  RuleSteps,
  Expression,
  ReplaceOptions,
  ExpressionInput,
  FormOption,
} from '../global-types.js';

import {
  isInequalityOperator,
  isRelationalOperator,
} from '../latex-syntax/utils.js';

import type { Parser, Terminator } from '../latex-syntax/types.js';
import { LATEX_DICTIONARY } from '../latex-syntax/dictionary/default-dictionary.js';

import { isPrime } from './predicates.js';
import {
  isString,
  isNumber,
  isSymbol,
  isFunction,
  isTensor,
} from './type-guards.js';
import { getRuleIndex, candidateRules } from './rule-index.js';

/** Condition functions that already triggered the one-time "non-boolean
 * condition result" warning (see `applyRule`). */
const _warnedNonBooleanCondition = new WeakSet<RuleConditionFunction>();

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
  boolean: (x: Expression) => x.type.matches('boolean'),
  string: (x: Expression) => isString(x),
  number: (x: Expression) => isNumber(x),
  symbol: (x: Expression) => isSymbol(x),
  expression: (_x: Expression) => true,

  numeric: (x: Expression) => {
    const [_c, term] = x.toNumericValue();
    return term.isSame(1);
  },
  integer: (x: Expression) => x.isInteger,
  rational: (x: Expression) => x.isRational,
  // An irrational number is a *real* number that is not rational. Requiring
  // provable realness keeps this fail-closed for unknowns and prevents a
  // provably-complex value (`isRational === false`) from being misclassified.
  irrational: (x: Expression) => x.isReal === true && x.isRational === false,
  real: (x: Expression) => x.isReal,
  // Fail-closed: only when provably *not* real (an unknown `isReal` of
  // `undefined` must NOT satisfy `:notreal`).
  notreal: (x: Expression) => x.isReal === false,

  // number with a non-zero imaginary part:
  complex: (x: Expression) => x.type.matches('complex'),
  // number with a zero real part and non-zero imaginary part:
  imaginary: (x: Expression) => x.type.matches('imaginary'),

  positive: (x: Expression) => x.isPositive,
  negative: (x: Expression) => x.isNegative,
  nonnegative: (x: Expression) => x.isNonNegative,
  nonpositive: (x: Expression) => x.isNonPositive,

  even: (x: Expression) => x.isEven,
  odd: (x: Expression) => x.isOdd,

  prime: (x: Expression) => isPrime(x) === true,
  // A composite number is a positive integer greater than 1 that is not prime.
  // `isPrime(1) === false`, so the previous `isPrime(x) === false` test wrongly
  // classified 1 (and 0) as composite.
  composite: (x: Expression) =>
    x.isInteger === true &&
    x.isPositive === true &&
    x.isEqual(1) === false &&
    isPrime(x) === false,

  // Fail-closed, three-valued: only when *provably* not equal to 0 / 1. The
  // previous `isSame(0)` was a structural check, so an unknown symbol (never
  // structurally `0`) vacuously satisfied `:notzero`.
  notzero: (x: Expression) => x.isEqual(0) === false,
  notone: (x: Expression) => x.isEqual(1) === false,

  finite: (x: Expression) => x.isFinite,
  infinite: (x: Expression) => x.isFinite === false,

  constant: (x: Expression) => x.valueDefinition?.isConstant ?? false,
  variable: (x: Expression) => !(x.valueDefinition?.isConstant ?? true),
  function: (x: Expression) => x.operatorDefinition !== undefined,

  relation: (x: Expression) => isRelationalOperator(x.operator),
  equation: (x: Expression) => x.operator === 'Equal',
  inequality: (x: Expression) => isInequalityOperator(x.operator),

  collection: (x: Expression) => x.isCollection,
  list: (x: Expression) => x.operator === 'List',
  set: (x: Expression) => x.operator === 'Set',
  tuple: (x: Expression) =>
    x.operator === 'Tuple' ||
    x.operator === 'Single' ||
    x.operator === 'Pair' ||
    x.operator === 'Triple',
  single: (x: Expression) => x.operator === 'Single',
  pair: (x: Expression) => x.operator === 'Pair',
  triple: (x: Expression) => x.operator === 'Triple',

  // Guarded on `isTensor` (a shaped `List` tensor value), not bare `.rank`: since
  // honest List typing (tensor-unification Phase A) a plain `List` with a
  // shape-regular type (e.g. `list<tuple^2>`, `list<color^2>`) also reports
  // a nonzero rank, but these wildcard conditions mean a genuine tensor
  // value — same reasoning as the `serializeJson` tensor early-exit.
  scalar: (x: Expression) => !isTensor(x),
  tensor: (x: Expression) => isTensor(x),
  vector: (x: Expression) => isTensor(x) && x.rank === 1,
  matrix: (x: Expression) => isTensor(x) && x.rank === 2,

  unit: (x: Expression) => x.operator === 'Unit',
  dimension: (x: Expression) => x.operator === 'Dimension',
  angle: (x: Expression) => x.operator === 'Angle',
  polynomial: (x: Expression) => x.unknowns.length === 1,
};

export function checkConditions(x: Expression, conditions: string[]): boolean {
  // Check for !== true, because result could also be undefined
  for (const cond of conditions)
    if (CONDITIONS[cond as keyof typeof CONDITIONS](x) !== true) return false;

  return true;
}

/**
 * Evaluate a rule-condition predicate and report whether it discharges.
 *
 * Rule guards must be *fail-closed*: an unprovable predicate (e.g. `w ≠ 0` for
 * an unconstrained `w`) must NOT satisfy the guard. Plain `.evaluate()` applies
 * the pragmatic top-level collapse where `Equal`/`NotEqual` of an undecided
 * comparison return `False`/`True`, which would fire guards vacuously. Setting
 * `_isVerifying` for the duration of the evaluation keeps those operators
 * three-valued (unknown stays unknown), so the guard only discharges when the
 * predicate provably evaluates to `True`. Assumption- and bounds-derived facts
 * are still consulted (they read the fact index directly, independent of the
 * pragmatic collapse), so `; z ≠ 0` still fires under `assume(z > 0)`.
 */
function conditionHolds(ce: ComputeEngine, condition: Expression): boolean {
  const savedVerifying = ce._isVerifying;
  ce._isVerifying = true;
  try {
    return isSymbol(condition.evaluate(), 'True');
  } finally {
    ce._isVerifying = savedVerifying;
  }
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
      '\\in\\Z^-': 'integer,negative',
      '\\in\\Z^*': 'integer,notzero',
      '\\in\\R^+': 'positive',
      '\\in\\R^-': 'negative',
      '\\in\\R^*': 'real,notzero',
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
        modifier = shortcuts[shortcut as keyof typeof shortcuts];
        break;
      }
    }
  }

  if (!modifier) return null;
  // A shortcut may expand to several comma-separated conditions
  // (e.g. `\in\Z^+` → `integer,positive`). Validate each part individually
  // rather than looking up the whole comma-joined string as a single key.
  for (const part of modifier.split(',')) {
    if (!Object.keys(CONDITIONS).includes(part))
      throw new Error(`Unexpected condition "${part}" in a rule`);
  }
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

/**
 * `e` and `i` are declared with `holdUntil: 'never'` (see
 * `library/arithmetic.ts`): any *canonical* occurrence is eagerly resolved to
 * `ExponentialE` / `Complex(0, 1)`. Rule match/replace/condition patterns are
 * parsed **raw** (canonicalization would collapse pattern structure and
 * wildcards), which skips that definition lookup entirely — a bare `e` or
 * `i` typed in a rule stays a literal, unbound symbol and can never
 * structurally match (or serialize as) the canonical value real expressions
 * use (e.g. `'e^2 -> 7'` never fires because the match pattern holds the
 * literal symbol `e`, not `ExponentialE`). Both letters are deliberately
 * excluded from this file's auto-wildcard letter list (`d`/`e`/`i` are
 * skipped, see `parseRule`'s dictionary setup), so a literal `e`/`i` in a
 * rule always denotes the constant, never a pattern variable — resolving
 * them post-parse is therefore safe as well as necessary.
 */
function resolveRuleConstant(x: Expression): Expression {
  if (isSymbol(x, 'e'))
    return x.engine.symbol('ExponentialE', { canonical: false });
  if (isSymbol(x, 'i')) return x.engine.I;
  return x;
}

/** Rewrite literal `e` / `i` symbols anywhere in a raw (non-canonicalized)
 * rule expression to their canonical constant. See `resolveRuleConstant`. */
function normalizeRuleConstants(expr: Expression): Expression {
  return expr.map(resolveRuleConstant, { canonical: false });
}

/**
 * An explicit wildcard in a LaTeX match/replace string (e.g.
 * `{match: '_a + 1'}`) is not valid LaTeX: the lenient parser reads `_a` as
 * `InvisibleOperator('_', 'a')` and `__a` as `Subscript('_', 'a')`, so the
 * pattern silently never matches. Recover the intended wildcard symbol from
 * those two shapes. (A triple-underscore `___a` parses to a nested shape
 * that is not recovered here — use MathJSON patterns for those.)
 */
function resolveWildcardShorthand(x: Expression): Expression {
  if (isFunction(x, 'InvisibleOperator') && isSymbol(x.ops[0], '_')) {
    // `_a` → InvisibleOperator('_', 'a'); `_ab` → InvisibleOperator('_', 'a', 'b')
    const rest = x.ops.slice(1);
    if (rest.length > 0 && rest.every((op) => isSymbol(op)))
      return x.engine.symbol(
        '_' +
          rest
            .map((op) => (op as Expression & { symbol: string }).symbol)
            .join('')
      );
  }
  // `__a` → Subscript('_', 'a'): a sequence wildcard
  if (isFunction(x, 'Subscript') && isSymbol(x.op1, '_') && isSymbol(x.op2))
    return x.engine.symbol('__' + x.op2.symbol);
  return x;
}

/* Return an expression for a match/replace part of a rule if a LaTeX string
 or MathJSON expression.

 When `autoWildcard` is true (default for string rule parsing), single-character
 symbols are automatically converted to wildcards (e.g., 'a' -> '_a'). This is
 appropriate when parsing rule strings like "a*x -> 2*x" where pattern matching
 is expected.

 When `autoWildcard` is false (default for object rules), symbols are kept as
 literals. This allows `.replace({match: 'a', replace: 2})` to match the literal
 symbol 'a' rather than acting as a wildcard.
 */
function parseRulePart(
  ce: ComputeEngine,
  rule?: string | ExpressionInput | RuleReplaceFunction | RuleFunction,
  options?: { canonical?: boolean; autoWildcard?: boolean }
): Expression | undefined {
  if (rule === undefined || typeof rule === 'function') return undefined;
  if (typeof rule === 'string') {
    let expr =
      ce.parse(rule, {
        form: options?.canonical ? 'canonical' : 'raw',
      }) ?? ce.expr('Nothing');
    // Resolve literal `e` / `i` to their canonical constant (see
    // `resolveRuleConstant`). A no-op when `options.canonical` is true: in
    // that case `ce.parse` already canonicalized the constant at parse time.
    expr = normalizeRuleConstants(expr);
    // Recover explicit wildcards (`_a`, `__a`) that the lenient LaTeX parser
    // fragments into InvisibleOperator/Subscript shapes (see
    // `resolveWildcardShorthand`).
    expr = expr.map(resolveWildcardShorthand, { canonical: false });
    // Only auto-wildcard when explicitly requested (e.g., when parsing
    // rule strings like "a*x -> 2*x"). For object rules, keep symbols literal.
    if (options?.autoWildcard) {
      expr = expr.map(
        (x) => {
          // Only transform single character symbols. Avoid \pi, \imaginaryUnit, etc..
          if (isSymbol(x) && x.symbol.length === 1)
            return ce.symbol('_' + x.symbol);
          return x;
        },
        { canonical: false }
      );
    }
    return expr;
  }
  const canonical =
    options?.canonical ??
    (rule instanceof _BoxedExpression ? rule.isCanonical : false);
  return ce.expr(rule, { form: canonical ? 'canonical' : 'raw' });
}

/** A rule can be expressed as a string of the form
 * `<match> -> <replace>; <condition>`
 * where `<match>`, `<replace>` and `<condition>` are LaTeX expressions.
 */
function parseRule(
  ce: ComputeEngine,
  rule: string,
  options?: { canonical?: boolean; purpose?: RulePurpose }
): BoxedRule {
  const makeWildcardEntry = (x: string) => {
    return {
      kind: 'symbol',
      latexTrigger: x,
      // domain: { kind: 'Any' },
      parse: (parser: Parser, _until?: Readonly<Terminator>) => {
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

  // A mapping from a symbol to a wildcard
  const wildcards: Record<string, string> = {};

  // A mapping from a symbol to a condition
  const wildcardConditions: Record<string, string> = {};

  // Add wildcard entries for all lowercase letters, except
  // for e (natural number), d (differential) and i (imaginary unit)
  const ruleDict = [
    ...LATEX_DICTIONARY,
    {
      kind: 'prefix',
      precedence: 100,
      latexTrigger: '...',
      parse: (parser: Parser, _until?: Readonly<Terminator>) => {
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
        if (conditions === null) return `${prefix}${id}`;

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
      parse: (
        parser: Parser,
        lhs: MathJsonExpression,
        until: Readonly<Terminator>
      ) => {
        const rhs = parser.parseExpression({ ...until, minPrec: 20 });
        if (rhs === null) return null;

        //
        // Check if we have a condition part after a semicolon
        // i.e. "a + b -> c; a > 0"
        //
        let conditionPredicate: MathJsonExpression | null = null;
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
        const conditions: MathJsonExpression[] = [];
        for (const id in wildcardConditions) {
          const xs = wildcardConditions[id].split(',');
          if (xs.length === 0) continue;
          if (xs.length === 1) {
            conditions.push(['Condition', wildcards[id], xs[0]]);
          } else conditions.push(['Condition', wildcards[id], ['And', ...xs]]);
        }

        let conditionExpression: MathJsonExpression | undefined = undefined;
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

  // Use a standalone LatexSyntax instance with the custom dictionary.
  // Construct via the injected LatexSyntax class (avoids static import).
  const LatexSyntaxClass = ce._requireLatexSyntax().constructor as new (
    options?: Record<string, unknown>
  ) => InstanceType<
    typeof import('../latex-syntax/latex-syntax.js').LatexSyntax
  >;
  const ruleSyntax = new LatexSyntaxClass({
    dictionary: ruleDict as ReadonlyArray<
      Partial<import('../latex-syntax/types.js').LatexDictionaryEntry>
    >,
  });

  // Push a clean scope that only inherits from the system scope (index 0),
  // not from the global scope or user-defined scopes. This prevents user-defined
  // symbols (like `x` used as a function name in `x(y+z)`) from interfering with
  // rule parsing. The system scope contains all built-in definitions.
  const systemScope = ce.contextStack[0]?.lexicalScope;
  if (systemScope) {
    ce.pushScope({ parent: systemScope, bindings: new Map() });
  }

  let expr: Expression;
  try {
    expr = ce.expr(ruleSyntax.parse(rule) ?? 'Nothing');

    if (!expr.isValid || expr.operator !== 'Rule') {
      throw new Error(
        `Invalid rule "${rule}"\n|   ${dewildcard(
          expr
        ).toString()}\n|   A rule should be of the form:\n|   <match> -> <replace>; <condition>`
      );
    }

    if (!isFunction(expr)) {
      throw new Error(`Invalid rule "${rule}"`);
    }
    const [match_, replace_, condition_] = expr.ops;

    // `e` and `i` are excluded from this file's auto-wildcard letter list
    // (see the dictionary setup above) because they are reserved for the
    // constants `ExponentialE` / the imaginary unit, never pattern
    // variables. But match/replace/condition are parsed *raw* to preserve
    // wildcard structure, which skips the `holdUntil: 'never'` definition
    // lookup that normally resolves a bare `e`/`i` (see
    // `library/arithmetic.ts`); normalize them explicitly here so a literal
    // `e`/`i` in a rule structurally matches (and serializes as) the same
    // canonical value ordinary (canonical) parsing produces.
    let match = normalizeRuleConstants(match_);
    let replace = normalizeRuleConstants(replace_);
    const condition =
      condition_ !== undefined ? normalizeRuleConstants(condition_) : undefined;
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

      // Evaluate the condition as a predicate, under verification semantics so
      // an unprovable guard (e.g. `; w ≠ 0`) does not discharge vacuously.
      condFn = (sub: BoxedSubstitution): boolean =>
        conditionHolds(ce, condition.subs(sub).canonical);
    }

    return boxRule(
      ce,
      { match, replace, condition: condFn, id: rule },
      options
    );
  } finally {
    // Pop the clean scope AFTER canonicalization to avoid pollution
    if (systemScope) {
      ce.popScope();
    }
  }
}

function boxRule(
  ce: ComputeEngine,
  rule: Rule | BoxedRule,
  options?: { canonical?: boolean; purpose?: RulePurpose }
): BoxedRule {
  if (rule === undefined || rule === null)
    throw new Error('Expected a rule, not ' + rule);

  if (isBoxedRule(rule)) {
    // Apply the default purpose to already-boxed rules that don't carry
    // their own tag (a per-rule tag takes precedence).
    if (options?.purpose !== undefined && rule.purpose === undefined)
      return { ...rule, purpose: options.purpose };
    return rule;
  }

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
      purpose: options?.purpose,
      id: rule.toString().replace(/\n/g, ' '),
    };

  // eslint-disable-next-line prefer-const
  let { match, replace, condition, id, onMatch, onBeforeMatch, operators } =
    rule;

  // The per-rule purpose tag takes precedence over the per-ruleset default
  const purpose = rule.purpose ?? options?.purpose;

  if (replace === undefined)
    throw new Error(
      `Invalid rule "${
        id ?? JSON.stringify(rule, undefined, 4)
      }"\n|   A rule must include at least a replace property`
    );

  // Normalize the condition to a function
  let condFn: undefined | RuleConditionFunction;
  if (typeof condition === 'string') {
    // If the condition is a LaTeX string, it should be a predicate
    // (an expression with a Boolean value).
    const condPattern = ce.parse(condition) ?? ce.expr('Nothing');

    // Substitute any unbound vars in the condition to a wildcard, then evaluate
    // the condition under verification semantics (see `conditionHolds`) so an
    // unprovable predicate guard does not discharge vacuously.
    condFn = (x: BoxedSubstitution, _ce: ComputeEngine): boolean =>
      conditionHolds(ce, condPattern.subs(x));
  } else {
    if (condition !== undefined && typeof condition !== 'function')
      throw new Error(
        `Invalid rule ${
          id ?? JSON.stringify(rule, undefined, 4)
        }\n|   condition is not a valid function`
      );
    condFn = condition;
  }

  if (typeof match === 'function') {
    throw new Error(
      `Invalid rule ${
        id ?? JSON.stringify(rule, undefined, 4)
      }\n|   match is not a valid expression.\n|   Use a replace function instead to validate and replace the expression`
    );
  }

  // Ensure a clean scope (that only inherits from the system scope) before boxing or parsing:
  // preventing wildcards & user-defined from inheriting definitions in rules.
  pushSafeScope(ce);

  let matchExpr: Expression | undefined;
  let replaceExpr: Expression | RuleReplaceFunction | RuleFunction | undefined;
  try {
    // Match patterns should never be canonicalized - they need to preserve their
    // structure with wildcards for pattern matching. For example, ['Divide', '_a', '_a']
    // should remain as a Divide expression, not be simplified to 1.
    matchExpr = parseRulePart(ce, match, {
      canonical: false,
      autoWildcard: false,
    });
    replaceExpr =
      typeof replace === 'function'
        ? replace
        : parseRulePart(ce, replace, options);
  } finally {
    ce.popScope();
  }

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

  if (
    replaceExpr &&
    typeof replaceExpr !== 'function' &&
    !replaceExpr.isValid
  ) {
    throw new Error(
      `Invalid rule ${
        id ?? JSON.stringify(rule, undefined, 4)
      }\n|   The replace expression is not valid: ${replaceExpr?.toString()}`
    );
  }

  if (!replaceExpr && typeof replace !== 'function')
    throw new Error(
      `Invalid rule ${
        id ?? JSON.stringify(rule, undefined, 4)
      }\n|   The replace expression could not be parsed`
    );

  return {
    _tag: 'boxed-rule',
    match: matchExpr,
    replace: replaceExpr ?? (replace as RuleReplaceFunction | RuleFunction),
    condition: condFn,
    useVariations: rule.useVariations,
    operators,
    purpose,
    id,
    onMatch: onMatch as BoxedRule['onMatch'],
    onBeforeMatch: onBeforeMatch as BoxedRule['onBeforeMatch'],
  };
}

/**
 * Push a clean scope - safe for the boxing of rules - that only inherits from the system scope
 * (index 0), not from the global scope or user-defined scopes. This prevents user-defined symbols
 * (like `x` used as a function name in `x(y+z)`) from interfering with rule parsing. The system
 * scope contains all built-in definitions.
 *
 * This also crucially prevents wildcards from being given definitions where captured & bound.
 *
 * @param ce
 */
function pushSafeScope(ce: ComputeEngine) {
  const systemScope = ce.contextStack[0]?.lexicalScope;
  if (systemScope) {
    ce.pushScope({ parent: systemScope, bindings: new Map() });
  } else {
    ce.pushScope();
  }
}

/**
 * Create a boxed rule set from a collection of non-boxed rules
 */
export function boxRules(
  ce: ComputeEngine,
  rs: Rule | ReadonlyArray<Rule | BoxedRule> | BoxedRuleSet | undefined | null,
  options?: { canonical?: boolean; purpose?: RulePurpose }
): BoxedRuleSet {
  if (!rs) return { rules: [] };

  if (typeof rs === 'object' && 'rules' in rs) return rs as BoxedRuleSet;

  if (!Array.isArray(rs)) rs = [rs as Rule | BoxedRule];

  const rules: BoxedRule[] = [];
  for (const rule of rs) {
    try {
      rules.push(boxRule(ce, rule, options));
    } catch (e) {
      // There was a problem with a rule: log it, skip that one rule, and
      // continue boxing the rest. A single malformed rule must not take down
      // the entire ruleset (e.g. one bad entry in the default simplify set, or
      // an unsupported shortcut in a user ruleset). This matches the "Skipping
      // rule" wording that was already printed here — previously the error was
      // re-thrown despite the message, aborting the whole set.
      console.error(
        `\n${e instanceof Error ? e.message : e}\n|   Skipping rule ${JSON.stringify(
          rule,
          undefined,
          4
        )}\n\n`
      );
    }
  }
  return { rules };
}

/**
 * Memoized "the canonical form of the match pattern loses wildcards" check.
 *
 * The result depends only on the (immutable) match pattern, so it is
 * computed once per pattern rather than on every `applyRule()` call.
 * Keyed on the boxed pattern itself: patterns are shared through the boxed
 * rule, so the cache hits for every application of the same rule.
 */
const _canonicalMatchLosesWildcards = new WeakMap<Expression, boolean>();

function canonicalMatchLosesWildcards(match: Expression): boolean {
  let result = _canonicalMatchLosesWildcards.get(match);
  if (result === undefined) {
    const awc = getWildcards(match);
    const bwc = getWildcards(match.canonical);
    result = !awc.every((x) => bwc.includes(x));
    _canonicalMatchLosesWildcards.set(match, result);
  }
  return result;
}

function normalizeReplaceForm(
  options?: Readonly<Partial<ReplaceOptions>>
): FormOption | undefined {
  if (options?.canonical !== undefined && options?.form !== undefined)
    throw new Error(
      'replace(): options.canonical and options.form are mutually exclusive'
    );

  if (options?.canonical !== undefined) {
    if (options.canonical === true) return 'canonical';
    if (options.canonical === false) return 'raw';
    return options.canonical;
  }

  return options?.form;
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
  expr: Expression,
  substitution: BoxedSubstitution,
  options?: Readonly<Partial<ReplaceOptions>>
): RuleStep | null {
  if (!rule) return null;
  const requestedForm = normalizeReplaceForm(options);

  // eslint-disable-next-line prefer-const
  let { match, replace, condition, id, onMatch, onBeforeMatch, purpose } = rule;
  const because = id ?? '';

  const ce = expr.engine;

  const canonicalRequested =
    requestedForm !== undefined &&
    requestedForm !== 'raw' &&
    requestedForm !== 'structural';

  // If the canonical form of the match loses wildcards, this rule cannot match
  // canonical expressions (they would already be simplified). Skip this rule.
  if ((canonicalRequested || expr.isCanonical) && match) {
    if (canonicalMatchLosesWildcards(match)) return null;
  }

  let operandsMatched = false;

  if (isFunction(expr) && options?.recursive) {
    const direction = options?.direction ?? 'left-right';
    let newOps =
      direction === 'left-right' ? expr.ops : [...expr.ops].reverse();

    // Apply the rule to the operands of the expression
    newOps = newOps.map((op) => {
      const subExpr = applyRule(rule, op, {}, options);
      if (!subExpr) return op;
      operandsMatched = true;
      return subExpr.value;
    });

    if (direction === 'right-left') (newOps as Expression[]).reverse();

    // At least one operand (directly or recursively) matched: but continue onwards to match against
    // the top-level expr., test against any 'condition', et cetera.
    if (operandsMatched) {
      // 'options.form' applies to *replacements only* (allowing finer control
      // of replacement operations), so the input expression's form is not
      // consulted here. However, if all child operands share a form after
      // replacement, 'eagerly' assume that form for this expression. (If this
      // expression also matches at the top level below, its form may still be
      // updated according to 'options.form'.)
      // Check 'canonical' first: numbers may be jointly marked as structural
      // and canonical.
      let form: FormOption = 'raw';
      if (newOps.every((x) => x.isCanonical)) form = 'canonical';
      else if (newOps.every((x) => x.isStructural)) form = 'structural';

      expr = ce.function(expr.operator, newOps, { form });
    }
  }

  const useVariations = rule.useVariations ?? options?.useVariations ?? false;
  const matchPermutations = options?.matchPermutations ?? true;

  // For debugging
  onBeforeMatch?.(rule, expr);

  const sub = match
    ? expr.match(match, {
        substitution,
        useVariations,
        recursive: false,
        matchPermutations,
      })
    : {};

  // Stamp the purpose of the firing rule onto emitted steps
  const stepOf = (value: Expression): RuleStep =>
    purpose !== undefined ? { value, because, purpose } : { value, because };

  // If the `expr` does not match the pattern, the rule doesn't apply
  if (sub === null) return operandsMatched ? stepOf(expr) : null;

  // If the condition doesn't match, the rule doesn't apply
  if (typeof condition === 'function') {
    // The substitution includes wildcards. Also expose each capture under its
    // bare name (full wildcard prefix stripped) so conditions written with
    // plain symbols can read captures.
    // So if `sub = {_a: 2, __b: 3}`, the substitution will be
    // `{a: 2, b: 3, _a: 2, __b: 3}`
    //
    // The original wildcard keys are always kept and are authoritative:
    // `_x` and `__x` remain distinct keys. Previously the bare aliases were
    // computed with `k.slice(1)`, which turned the sequence wildcard `__x`
    // into `_x` — colliding with (and clobbering) a distinct single wildcard
    // `_x` captured by the same rule.
    //
    // If a rule captures wildcards of different arities with the same name
    // (e.g. both `_x` and `__x`), the *single* wildcard provides the bare
    // alias: aliases are added in decreasing prefix length, so the shortest
    // prefix (the most specific binding) wins.
    const conditionSub: BoxedSubstitution = { ...sub };
    const prefixLen = (k: string): number => /^_*/.exec(k)![0].length;
    for (const [k, v] of Object.entries(sub).sort(
      (a, b) => prefixLen(b[0]) - prefixLen(a[0])
    )) {
      const bare = k.slice(prefixLen(k));
      // Skip anonymous wildcards (nothing after the prefix) and any bare
      // name that would collide with an actual capture key.
      if (bare && !(bare in sub)) conditionSub[bare] = v;
    }

    // Evaluate the condition. Fail-closed and non-destructive:
    //
    // - `RuleConditionFunction` is typed to return a `boolean`: only an exact
    //   `true` — or, as a courtesy, the boxed symbol `True` (a common mistake
    //   when returning an evaluated predicate) — satisfies the condition.
    //   Anything else, *including truthy objects* (a boxed `False` is a
    //   truthy JS object!), means the rule does not apply. A one-time
    //   warning is emitted for non-boolean returns so a malformed condition
    //   doesn't silently always-fire or never-fire.
    //
    // - A *throw* while evaluating the condition means "this rule does not
    //   apply at this node" — exactly as if the condition returned `false`.
    //   In particular it must NOT discard operand-level replacements already
    //   performed by the recursive descent above (`operandsMatched`).
    let conditionSatisfied: boolean;
    try {
      const outcome = condition(conditionSub, ce) as unknown;
      if (typeof outcome === 'boolean') conditionSatisfied = outcome;
      else {
        if (!_warnedNonBooleanCondition.has(condition)) {
          _warnedNonBooleanCondition.add(condition);
          console.warn(
            `\n|   Rule "${rule.id}"\n|   The condition function returned a non-boolean value (${
              isExpression(outcome) ? outcome.toString() : String(outcome)
            }).\n|   A rule condition must return true or false.\n|   Only \`true\` (or the boxed symbol \`True\`) satisfies the condition.`
          );
        }
        conditionSatisfied = isExpression(outcome) && isSymbol(outcome, 'True');
      }
    } catch (e) {
      // Propagate deadline cancellations: timeouts must not be swallowed
      // as "the condition failed".
      if (e instanceof CancellationError) throw e;
      console.error(
        `\n|   Rule "${rule.id}"\n|   Error while checking condition\n|    ${
          e instanceof Error ? e.message : e
        }`
      );
      conditionSatisfied = false;
    }
    if (!conditionSatisfied) return operandsMatched ? stepOf(expr) : null;
  }

  /** The computed form value to be assumed by the *directly replaced* expression: assuming either an
  'enforced' value (options), or consultation to the form of the input expression */
  let formValue =
    requestedForm ??
    (expr.isStructural ? 'structural' : expr.isCanonical ? 'canonical' : 'raw');

  //  If `true`, then the form is not 'enforced' (via options) and therefore, the prior computed
  //  form only applies wherein the initially-produced replacement expression has a 'raw' form
  //  (else retaining whichever form of the replacement)
  const dynamicForm = requestedForm === undefined;

  /** Get the overall form type from *formValue* (raw/structural/canonical), accounting for
   * 'canonical' potentially assuming multiple values. */
  const getFormType = () =>
    formValue === 'structural'
      ? 'structural'
      : formValue === 'raw'
        ? 'raw'
        : 'canonical';

  // Have a (direct) match: in this case, consider the canonical-status of the replacement, too.
  if (
    formValue === 'raw' &&
    dynamicForm &&
    replace instanceof _BoxedExpression &&
    (replace.isCanonical || replace.isStructural)
  )
    formValue = replace.isCanonical ? 'canonical' : 'structural';

  //@note: '.subs()' acts like an expr. 'clone' here (in case of an empty substitution)
  // An exception thrown by a `replace` *function* is treated exactly like a
  // condition exception (see above): log it and skip this one rule, rather than
  // aborting the whole `replace()` pass. Deadline cancellations still propagate.
  let result: Expression | RuleStep | null | undefined;
  try {
    result =
      typeof replace === 'function'
        ? replace(expr, sub)
        : // @todo: 'expr.subs()' to eventually also assume a 'form' option
          // : replace.subs(sub, { form: dynamicForm ? undefined : formValue });
          replace.subs(sub, { canonical: getFormType() === 'canonical' });
  } catch (e) {
    if (e instanceof CancellationError) throw e;
    console.error(
      `\n|   Rule "${rule.id}"\n|   Error while applying replacement\n|    ${
        e instanceof Error ? e.message : e
      }`
    );
    return operandsMatched ? stepOf(expr) : null;
  }

  if (!result) return operandsMatched ? stepOf(expr) : null;

  // To aid in debugging, invoke onMatch when the rule matches
  onMatch?.(rule, expr, result);

  /** Return the final *expression* with the correctly computed form. */
  const computeValue = (result: Expression) => {
    // If 'raw', leave the expression as-is
    // (note that if result has produced a 'non-raw' form, this may not be 'undone'...)
    if (formValue === 'raw') return result;
    // Non option-enforced form; let replacement/result expression form override
    if (dynamicForm === true && (result.isStructural || result.isCanonical))
      return result;
    // Enforced form
    return getFormType() === 'canonical'
      ? result.isCanonical
        ? result
        : ce.expr(result, { form: formValue }) //Re-box (instead of 'x.canonical'), case of 'CanonicalForm'
      : result.structural;
  };

  // (Need to request a 'form' variant (canonical/structural) to account for case of a custom
  // replace: which may not have returned the same 'form' calculated here)
  if (isRuleStep(result)) {
    // A step purpose set by a rule function takes precedence over the
    // rule-level purpose tag
    if (getFormType() === 'raw')
      return purpose !== undefined && result.purpose === undefined
        ? { ...result, purpose }
        : result;
    return {
      ...result,
      value: computeValue(result.value),
      purpose: result.purpose ?? purpose,
    };
  }

  if (!isExpression(result)) {
    throw new Error(
      'Invalid rule replacement result: expected a Expression or RuleStep'
    );
  }

  return stepOf(computeValue(result));
}

/**
 * Apply the rules in the ruleset and return a modified expression
 * and the set of rules that were applied.
 *
 * The `replace` function can be used to apply a rule to a non-canonical
 * expression.
 *
 * **Error handling contract.** A single misbehaving rule never aborts the
 * whole pass. An exception thrown while checking a rule's `condition` or while
 * running its `replace` function is logged and that one rule is skipped; the
 * remaining rules are still tried (see `applyRule`). Only a
 * `CancellationError` (deadline/interrupt) propagates out, so timeouts are not
 * swallowed as "the rule failed".
 *
 * **Ordering contract** (SYMBOLIC P3-14). Rules are tried in declaration
 * order. Within a pass, after rule *k* fires, only rules with ordinal > k
 * are tried on the result — earlier rules do not see later rules' output
 * unless another iteration runs. The default `iterationLimit` is **1**, so
 * by default there is a single pass; pass a larger `iterationLimit` (or use
 * `simplify()`, which iterates to a fixed point with its own guards) when
 * rules are meant to feed each other.
 *
 * **Capture convention** (SYMBOLIC P3-13). When several distinct bindings
 * of a pattern's sequence wildcards would match, which one is produced is
 * operator-dependent: the commutative-anchor path and the plain
 * argument-list path resolve greedy-vs-lazy differently. Both results are
 * valid matches; replacements built from captures should not rely on a
 * specific split.
 */
export function replace(
  expr: Expression,
  rules: Rule | (Rule | BoxedRule)[] | BoxedRuleSet,
  options?: Partial<ReplaceOptions>
): RuleSteps {
  if (!rules) throw new Error('replace(): Expected one or more rules');

  const iterationLimit = options?.iterationLimit ?? 1;
  let iterationCount = 0;
  const once = options?.once ?? false;
  normalizeReplaceForm(options);

  // Normalize the ruleset
  let ruleSet: ReadonlyArray<BoxedRule>;
  if (typeof rules === 'object' && 'rules' in rules) ruleSet = rules.rules;
  else {
    ruleSet = expr.engine.rules(
      Array.isArray(rules) ? rules : [rules as Rule | BoxedRule]
    ).rules;
  }

  // Operator-indexed dispatch (see rule-index.ts): skip rules whose match
  // pattern can never apply to `expr`'s operator. With `recursive`,
  // `applyRule` visits operands of any head, so top-level head dispatch is
  // unsound — bypass the index and keep the linear scan. Small rule sets
  // (below the index threshold) also use the linear scan.
  const index = options?.recursive
    ? undefined
    : getRuleIndex(ruleSet, options?.useVariations === true);

  // Returns the step if the rule applied AND changed the expression,
  // `null` otherwise. Exceptions from `applyRule` propagate to the caller.
  const stepOf = (rule: BoxedRule): RuleStep | null => {
    const result = applyRule(rule, expr, {}, options);
    if (
      result !== null &&
      result.value !== expr &&
      (!result.value.isSame(expr) || varyingForm(expr, result.value))
    )
      return result;
    return null;
  };

  let done = false;
  const steps: RuleStep[] = [];
  while (!done && iterationCount < iterationLimit) {
    done = true;
    if (index === undefined) {
      //
      // Linear scan over every rule, in declaration order
      //
      for (const rule of ruleSet) {
        try {
          const result = stepOf(rule);
          if (result !== null) {
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
          // Propagate deadline cancellations: timeouts must not be
          // swallowed as "this rule failed".
          if (e instanceof CancellationError) throw e;
          return steps;
        }
      }
    } else {
      //
      // Indexed scan: only candidate rules for `expr`, in declaration order
      //
      let it = candidateRules(index, expr, -1);
      let next = it.next();
      while (!next.done) {
        const { rule, ordinal } = next.value;
        try {
          const result = stepOf(rule);
          if (result !== null) {
            if (once) return [result];

            if (steps.some((x) => x.value.isSame(result.value))) return steps;

            steps.push(result);

            done = false;
            expr = result.value;

            // Mid-pass re-seed: the linear scan keeps scanning the
            // *remaining* rules (ordinal > the firing rule's) against the
            // NEW expression. Reproduce that exactly: restart candidate
            // enumeration for the new expression from this rule's ordinal.
            it = candidateRules(index, expr, ordinal);
          }
        } catch (e) {
          // Propagate deadline cancellations: timeouts must not be
          // swallowed as "this rule failed".
          if (e instanceof CancellationError) throw e;
          return steps;
        }
        next = it.next();
      }
    }
    iterationCount += 1;
  }
  return steps;

  /*
   * Local f.
   */
  /**
   * Assuming *x* and *x2* are **structurally (symbolically) equivalent**, and considering
   * expression forms 'structural' and 'canonical':
   *
   * - If option 'recursive' equals `true` or `'functions-only'` (**default** = `'functions-only'`),
   * then, if either 'x' or 'x2', or one of the matching sub-expression pairs of these has a
   * differing 'structural' or 'canonical' status, then return `true`.
   * (if 'functions-only', then only function-expression operands are considered)
   *
   * - If 'recursive' === `false`, then this status comparison applies only to/between `x` and `x2`
   * directly.
   *
   * For both cases, if neither `x` nor `x2` (nor compared sub-expressions if recursive) is
   * structural or canonical, then return `false`.
   *
   * If `x` and `x2` turn out not to share an identical tree/branching structure (possible since
   * `isSame()` follows symbol value bindings), they are conservatively reported as differing
   * (return `true`).
   */
  function varyingForm(
    x: Expression,
    x2: Expression,
    {
      recursive = 'functions-only',
    }: { recursive?: boolean | 'functions-only' } = {}
  ): boolean {
    if (varies(x, x2)) return true;

    if (recursive === false) return false;

    if (isFunction(x) && isFunction(x2)) {
      if (x.ops.length !== x2.ops.length) return true;
      if (x.nops === 0) return false;

      return x.ops.some((op, index) =>
        recursive !== true && !isFunction(op) && !isFunction(x2.ops[index])
          ? false
          : varyingForm(op, x2.ops[index], { recursive })
      );
    } else if (isFunction(x) || isFunction(x2)) return true;

    return false;

    function varies(x: Expression, x2: Expression): boolean {
      if (x.isStructural || x.isCanonical) {
        if (x.isStructural) return !x2.isStructural;
        return !x2.isCanonical;
      }
      return x2.isStructural || x2.isCanonical ? true : false;
    }
  }
}

/**
 * For each rule in the rule set that matches, return the full `RuleStep`
 * (replacement value with its provenance: the rule id in `because`, plus
 * `purpose`). Used by callers that keep a step trace (`explain`).
 *
 * @param rules
 */
export function matchAnyRulesWithSteps(
  expr: Expression,
  rules: BoxedRuleSet,
  sub: BoxedSubstitution,
  options?: Partial<ReplaceOptions>
): RuleStep[] {
  const results: RuleStep[] = [];

  const collect = (rule: BoxedRule): void => {
    // Matching a single rule against a large expression (e.g. a
    // multinomial-expanded integrand with thousands of operands) can take
    // ~100 ms; scanning a rule set then runs for seconds. Checkpoint the
    // engine deadline once per rule so a runaway rule scan honors
    // `ce.timeLimit` (e.g. the compiler's symbolic-antiderivative attempt).
    checkDeadline(expr.engine._deadlineFrame);
    const r = applyRule(rule, expr, sub, options);

    // Verify that the results are unique
    if (r !== null && !results.some((x) => x.value.isSame(r.value)))
      results.push(r);
  };

  // Operator-indexed dispatch (see rule-index.ts). `expr` never changes
  // during the scan, so a single candidate pass preserves the declaration
  // order (and thus the dedup behavior) of the linear scan. With
  // `recursive`, head dispatch is unsound — keep the linear scan.
  const index = options?.recursive
    ? undefined
    : getRuleIndex(rules.rules, options?.useVariations === true);

  if (index === undefined) for (const rule of rules.rules) collect(rule);
  else for (const { rule } of candidateRules(index, expr, -1)) collect(rule);

  return results;
}

/**
 * For each rules in the rule set that match, return the `replace` of the rule
 *
 * @param rules
 */
export function matchAnyRules(
  expr: Expression,
  rules: BoxedRuleSet,
  sub: BoxedSubstitution,
  options?: Partial<ReplaceOptions>
): Expression[] {
  return matchAnyRulesWithSteps(expr, rules, sub, options).map((s) => s.value);
}

/**
 * Replace all occurrences of a wildcard in an expression with a the corresponding non-wildcard, e.g. `_x` -> `x`
 */
function dewildcard(expr: Expression): Expression {
  if (isSymbol(expr)) {
    if (expr.symbol.startsWith('_'))
      return expr.engine.symbol(expr.symbol.slice(1));
  }
  if (isFunction(expr)) {
    const ops = expr.ops.map((x) => dewildcard(x));
    return expr.engine.function(expr.operator, ops, { form: 'raw' });
  }
  return expr;
}

function getWildcards(expr: Expression): string[] {
  const wildcards: string[] = [];
  if (isSymbol(expr) && expr.symbol.startsWith('_'))
    wildcards.push(expr.symbol);
  if (isFunction(expr))
    expr.ops.forEach((x) => wildcards.push(...getWildcards(x)));
  return wildcards;
}

/** Return true if all the wildcards of a are included in b */
function includesWildcards(a: Expression, b: Expression): boolean {
  const awc = getWildcards(a);
  const bwc = getWildcards(b);
  return awc.every((x) => bwc.includes(x));
}

/** @category Rules */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRuleStep(x: unknown): x is RuleStep {
  return isRecord(x) && 'because' in x && isExpression(x.value);
}

/** @category Rules */
function isBoxedRule(x: unknown): x is BoxedRule {
  return isRecord(x) && x._tag === 'boxed-rule';
}

function isExpression(value: unknown): value is Expression {
  return value instanceof _BoxedExpression;
}

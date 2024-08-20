import { permutations } from '../../common/utils';
import { _BoxedExpression } from './abstract-boxed-expression';
import type {
  BoxedSubstitution,
  PatternMatchOptions,
  BoxedExpression,
} from './public';
import { isWildcard, wildcardName } from './boxed-patterns';

function hasWildcards(expr: string | BoxedExpression): boolean {
  if (typeof expr === 'string') return expr.startsWith('_');

  if (isWildcard(expr)) return true;

  if (expr.ops)
    return hasWildcards(expr.operator) || expr.ops.some(hasWildcards);

  return false;
}

function captureWildcard(
  wildcard: string,
  expr: BoxedExpression,
  substitution: BoxedSubstitution
): BoxedSubstitution | null {
  console.assert(wildcard.startsWith('_'));

  // If this is a universal wildcard, it always matches and no need to add it
  // to the substitution record.
  if (wildcard === '_' || wildcard === '__' || wildcard === '___')
    return substitution;

  if (wildcard in substitution) {
    // There was already a matching wildcard, make sure this one is identical
    if (!expr.isSame(substitution[wildcard])) return null;
    return substitution;
  }

  if (hasWildcards(expr)) return null;

  return { ...substitution, [wildcard]: expr };
}

/**
 * If `expr` matches pattern, given `substitution` (checks for inconsistency)
 * return `substitution`, amended with additional matched. Otherwise, `null`.
 *
 * When `acceptVariants` and `exact` ar `true`, the function will attempt to match the
 * expression to a variant of the pattern (e.g. `5` to `5+_`).
 *
 * Set `acceptVariants` to `false` to prevent recursive matching of variants.
 *
 */
function matchOnce(
  expr: BoxedExpression,
  pattern: BoxedExpression,
  substitution: BoxedSubstitution,
  options: PatternMatchOptions & {
    acceptVariants?: boolean;
  }
): BoxedSubstitution | null {
  //
  // Match a wildcard
  //
  if (isWildcard(pattern))
    return captureWildcard(wildcardName(pattern)!, expr, substitution);

  // Reset accept variant (we don't want to call it recursively for the same
  // expression, but we do want to call it for the arguments)
  const acceptVariants = options.acceptVariants ?? true;
  options = { ...options, acceptVariants: true };

  //
  // Match a number
  //
  if (pattern.numericValue !== null) {
    if (expr.numericValue === null) return null;
    if (pattern.isEqual(expr)) return substitution;

    // Attempt to match the expression to a variant of the pattern
    // (e.g. `5` to `5+_`).

    if (!acceptVariants) return null;
    return matchVariants(expr, pattern, substitution, options);
  }

  //
  // Match a string
  //
  const str = pattern.string;
  if (str !== null) return expr.string === str ? substitution : null;

  //
  // Match a symbol
  //
  const symbol = pattern.symbol;
  if (symbol !== null) {
    if (symbol === expr.symbol) return substitution;
    // Match the symbol to a variant of the pattern
    // (e.g. `x` to `0+x`).
    if (!acceptVariants) return null;
    return matchVariants(expr, pattern, substitution, options);
  }

  //
  // Match a function
  //

  if (pattern.ops) {
    const exact = options.exact ?? false;
    const ce = expr.engine;

    let result: BoxedSubstitution | null = null;

    const operator = pattern.operator;

    if (operator.startsWith('_')) {
      //
      // 1. The pattern operator is a wildcard
      //
      result = captureWildcard(operator, ce.box(expr.operator), substitution);
      if (result !== null)
        result = matchArguments(expr, pattern.ops, result, options);
    } else if (operator === expr.operator) {
      //
      // 2. Both heads are strings and they match
      //
      const def = ce.lookupFunction(operator);
      result = def?.commutative
        ? matchPermutation(expr, pattern, substitution, options)
        : matchArguments(expr, pattern.ops, substitution, options);
    } else if (!exact) {
      //
      // 3. Both heads are strings and they don't match
      //
      if (!acceptVariants) return null;
      result = matchVariants(expr, pattern, substitution, options);
    }

    if (result !== null) substitution = result;

    // If requested, try to match the pattern recursively
    if (options.recursive && expr.ops)
      result =
        matchRecursive(expr, pattern, substitution, {
          ...options,
          acceptVariants,
        }) ?? result;

    return result;
  }

  return null; // no match
}

/** Assuming expr is a function, attempts to match the patterns
 * to the arguments of the function.
 */
function matchRecursive(
  expr: BoxedExpression,
  pattern: BoxedExpression,
  substitution: BoxedSubstitution,
  options: PatternMatchOptions & {
    acceptVariants?: boolean;
  }
): BoxedSubstitution | null {
  console.assert(expr.ops !== null);
  let result: BoxedSubstitution | null = null;
  for (const op of expr.ops!) {
    const r = matchOnce(op, pattern, substitution, options);
    if (r !== null) {
      result = r;
      substitution = r;
    }
  }

  return result;
}

/** For some patterns, we accept "variants" to avoid having to
 * specify all possible forms of the pattern.
 *
 * For example, we accept `0+x` as a match for `x`, and
 * 'Square(x)' as a match for 'Power(x, 2)`.
 */
function matchVariants(
  expr: BoxedExpression,
  pattern: BoxedExpression,
  substitution: BoxedSubstitution,
  options: PatternMatchOptions
): BoxedSubstitution | null {
  if (options.exact) return null;
  const ce = expr.engine;
  const varOptions = { ...options, acceptVariants: false };

  const matchVariant = (op, ops) =>
    matchOnce(
      ce.function(op, ops, { canonical: false }),
      pattern,
      substitution,
      varOptions
    );

  const operator = pattern.operator;

  if (operator === 'Negate') {
    // 0 -> -x (if x=0)
    if (expr.isZero)
      return matchOnce(ce.Zero, pattern.op1, substitution, varOptions);
  }

  if (operator === 'Add') {
    // x -> 0+x
    let result = matchVariant('Add', [0, expr]);
    if (result !== null) return result;

    // a-b -> a+(-b)
    if (expr.operator === 'Subtract')
      result = matchVariant('Add', [expr.op1!, ['Negate', expr.op2!]]);

    if (result !== null) return result;
  }

  // The pattern is ['Subtract', a, b]
  if (operator === 'Subtract') {
    // a -> a-0
    let result = matchVariant('Subtract', [expr, 0]);
    if (result !== null) return result;

    // -a -> 0-a
    if (expr.operator === 'Negate')
      result = matchVariant('Subtract', [0, expr.op1!]);

    if (result !== null) return result;
  }

  // The pattern is ['Multiply', a, b]
  if (operator === 'Multiply') {
    // x -> 1*x
    let result = matchVariant('Multiply', [1, expr]);
    if (result !== null) return result;

    // -x -> -1*x
    if (expr.operator === 'Negate') {
      result = matchVariant('Multiply', [-1, expr.op1!]);
      if (result !== null) return result;
    }

    // x/a -> (1/a)*x
    if (expr.operator === 'Divide') {
      result = matchVariant('Multiply', [expr.op1!, ['Divide', 1, expr.op2!]]);
      if (result !== null) return result;
    }
  }

  if (operator === 'Divide') {
    // x/1 -> x
    const result = matchVariant('Divide', [expr, 1]);
    if (result !== null) return result;
  }

  if (operator === 'Square') {
    // Power(x, 2) -> Square(x)
    const result = matchVariant('Power', [expr, 2]);
    if (result !== null) return result;
  }

  if (operator === 'Exp') {
    // Power(E, x) -> Exp(x)
    const result = matchVariant('Power', [ce.E, expr]);
    if (result !== null) return result;
  }

  if (operator === 'Power') {
    if (pattern.op2.re === 2 && pattern.op2.im === 0) {
      const result = matchVariant('Square', [expr]);
      if (result !== null) return result;
    }
    if (pattern.op1.symbol === 'ExponentialE') {
      const result = matchVariant('Exp', [expr]);
      if (result !== null) return result;
    }
  }

  return null;
}

function matchPermutation(
  expr: BoxedExpression,
  pattern: BoxedExpression,
  substitution: BoxedSubstitution,
  options: PatternMatchOptions
): BoxedSubstitution | null {
  const patterns = permutations<BoxedExpression>(pattern.ops!);
  for (const pat of patterns) {
    const result = matchArguments(expr, pat, substitution, options);
    if (result !== null) return result;
  }
  return null;
}

function matchArguments(
  expr: BoxedExpression,
  patterns: ReadonlyArray<BoxedExpression>,
  substitution: BoxedSubstitution,
  options: PatternMatchOptions
): BoxedSubstitution | null {
  if (patterns.length === 0) {
    if (expr.ops && expr.ops.length === 0) return substitution;
    return null;
  }

  const ce = patterns[0].engine;
  let result: BoxedSubstitution | null = { ...substitution };

  // We're going to consume the ops array, so make a copy
  const ops = [...expr.ops!];

  let i = 0; // Index in pattern

  while (i < patterns.length) {
    const pat = patterns[i];
    const argName = wildcardName(pat);

    if (argName !== null) {
      if (argName.startsWith('__')) {
        // Match 0 or more expressions (__) or 1 or more (___)
        let j = 0; // Index in subject
        if (patterns[i + 1] === undefined) {
          // No more args in the pattern after, go till the end
          j = ops.length + 1;
        } else {
          // Capture till the next matching arg in the pattern
          let found = false;
          while (!found && j < ops.length) {
            found =
              matchOnce(ops[j], patterns[i + 1], result, options) !== null;
            j += 1;
          }
          if (!found && argName.startsWith('___')) return null;
        }

        // Unless we had a optional wildcard (matching 0 or more), we must have
        // found at least one match
        if (!argName.startsWith('___') && j <= 1) return null;

        // Determine the value to return for the wildcard
        let value: BoxedExpression;
        if (j <= 1) {
          if (expr.operator === 'Add') value = ce.Zero;
          else if (expr.operator === 'Multiply') value = ce.One;
          else value = ce.function('Sequence', []);
        } else if (j === 2) {
          // Capturing a single element
          if (ops.length === 0) return null;
          value = ops.shift()!;
        } else {
          const def = ce.lookupFunction(expr.operator);
          const args = ops.splice(0, j - 1);
          if (def?.associative) {
            value = ce.function(expr.operator, args, { canonical: false });
          } else {
            value = ce.function('Sequence', args, { canonical: false });
          }
        }
        result = captureWildcard(argName, value, result);
      } else if (argName.startsWith('_')) {
        // Match a single expression
        if (ops.length === 0) return null;
        result = captureWildcard(argName, ops.shift()!, result);
      } else {
        result = matchOnce(ops.shift()!, pat, result, options);
      }
    } else {
      const arg = ops.shift();
      if (!arg) return null;
      result = matchOnce(arg, pat, result, options);
    }

    if (result === null) return null;
    i += 1;
  }
  // If there are some arguments left in the subject that were not matched, it's
  // not a match
  if (ops.length > 0) return null;

  return result;
}

/**
 * The function attempts to match a subject expression to a
 * [pattern](/compute-engine/guides/patterns-and-rules/).
 *
 * If the match is successful, it returns a `Substitution` indicating how to
 * transform the pattern to become the subject.
 *
 * If the expression does not match the pattern, it returns `null`.
 *
 */
export function match(
  subject: BoxedExpression,
  pattern: BoxedExpression,
  options?: PatternMatchOptions
): BoxedSubstitution | null {
  pattern = pattern.structural;

  // Default options
  const opts = {
    recursive: options?.recursive ?? false,
    exact: options?.exact ?? false,
    acceptVariants: !(options?.exact ?? false),
  };
  const substitution = options?.substitution ?? {};

  // Use 'structural' form, because we want to be able to
  // match the numerator/denominator of a fraction, for example.

  return matchOnce(subject.structural, pattern.structural, substitution, opts);
}

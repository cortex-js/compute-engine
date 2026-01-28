import type {
  BoxedSubstitution,
  PatternMatchOptions,
  BoxedExpression,
} from '../global-types';

import { permutations } from '../../common/utils';

import { isWildcard, wildcardName, wildcardType } from './boxed-patterns';
import { isOperatorDef } from './utils';

function hasWildcards(expr: string | BoxedExpression): boolean {
  if (typeof expr === 'string') return expr.startsWith('_');

  if (isWildcard(expr)) return true;

  if (expr.ops)
    return hasWildcards(expr.operator) || expr.ops.some(hasWildcards);

  return false;
}

/**
 * Return a new substitution based on arg. `substitution`, but with wildcard (of value *expr*)
 * added.
 * Returns given *substitution* unchanged if wildcard is a unnamed, or is already present in
 * substitution.
 *
 * Returns `null` in cases either of attempting to an existing wildcard/substitution with a
 * different value, or if the given *expr* is, or contains, a wildcard expression.
 *
 * @param wildcard
 * @param expr
 * @param substitution
 * @returns
 */
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
 * When `acceptVariants` and `useVariations` are `true`, the function will
 * attempt to match the expression to a variations of the pattern
 * (e.g. `5` to `5+_`).
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
    return matchVariations(expr, pattern, substitution, options);
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
    return matchVariations(expr, pattern, substitution, options);
  }

  //
  // Match a function
  //

  if (pattern.ops) {
    const useVariations = options.useVariations ?? false;
    const ce = expr.engine;

    let result: BoxedSubstitution | null = null;

    const operator = pattern.operator;

    // Special case: Match a BoxedNumber rational against a Divide pattern
    // This allows patterns like ['Divide', '_num', '_den'] to match rationals like 3/2
    if (
      operator === 'Divide' &&
      expr.numericValue !== null &&
      !expr.denominator.is(1)
    ) {
      // Create a synthetic Divide expression to match against
      const divideExpr = ce.function(
        'Divide',
        [expr.numerator, expr.denominator],
        { canonical: false, structural: true }
      );
      return matchArguments(divideExpr, pattern.ops, substitution, options);
    }

    // Special case: Match Multiply(Rational(1, n), x) against a Divide pattern
    // This handles cases like x/2 which is canonicalized as x * (1/2)
    if (operator === 'Divide' && expr.operator === 'Multiply') {
      const ops = expr.ops!;
      for (let i = 0; i < ops.length; i++) {
        const op = ops[i];

        // Check if op is a rational number with numerator 1 (i.e., 1/n form)
        if (
          op.numericValue !== null &&
          op.numerator.is(1) &&
          !op.denominator.is(1)
        ) {
          // Collect all other operands
          const others = ops.filter((_, j) => j !== i);
          const numerator =
            others.length === 1
              ? others[0]
              : ce.function('Multiply', others, { canonical: false });

          // Create a synthetic Divide expression to match against
          const divideExpr = ce.function(
            'Divide',
            [numerator, op.denominator],
            { canonical: false, structural: true }
          );
          const result = matchArguments(
            divideExpr,
            pattern.ops,
            substitution,
            options
          );
          if (result !== null) return result;
        }
      }
    }

    if (operator.startsWith('_')) {
      //
      // 1. The pattern operator is a wildcard
      //
      result = captureWildcard(operator, ce.box(expr.operator), substitution);
      if (result !== null)
        result = matchArguments(expr, pattern.ops, result, options);
    } else if (operator === expr.operator) {
      //
      // 2. Both operator names match
      //
      // For commutative operators, try permutations unless matchPermutations is false
      const matchPerms = options.matchPermutations ?? true;
      result =
        pattern.operatorDefinition!.commutative && matchPerms
          ? matchPermutation(expr, pattern, substitution, options)
          : matchArguments(expr, pattern.ops, substitution, options);
    }

    if (result === null && useVariations) {
      //
      // 3. The operators may or may not match, try some variations
      //
      if (!acceptVariants) return null;
      result = matchVariations(expr, pattern, substitution, options);
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
function matchVariations(
  expr: BoxedExpression,
  pattern: BoxedExpression,
  substitution: BoxedSubstitution,
  options: PatternMatchOptions
): BoxedSubstitution | null {
  if (!options.useVariations) return null;
  const ce = expr.engine;
  const varOptions = { ...options, acceptVariants: false };

  const matchVariation = (op, ops) =>
    matchOnce(
      ce.function(op, ops, { canonical: false }),
      pattern,
      substitution,
      varOptions
    );

  const operator = pattern.operator;

  if (operator === 'Negate') {
    // 0 -> -x (if x=0)
    if (expr.is(0))
      return matchOnce(ce.Zero, pattern.op1, substitution, varOptions);
  }

  if (operator === 'Add') {
    // x -> 0+x
    let result = matchVariation('Add', [0, expr]);
    if (result !== null) return result;

    // a-b -> a+(-b)
    if (expr.operator === 'Subtract')
      result = matchVariation('Add', [expr.op1!, ['Negate', expr.op2!]]);

    if (result !== null) return result;
  }

  // The pattern is ['Subtract', a, b]
  if (operator === 'Subtract') {
    // a -> a-0
    let result = matchVariation('Subtract', [expr, 0]);
    if (result !== null) return result;

    // -a -> 0-a
    if (expr.operator === 'Negate')
      result = matchVariation('Subtract', [0, expr.op1!]);

    if (result !== null) return result;
  }

  // The pattern is ['Multiply', a, b]
  if (operator === 'Multiply') {
    // x -> 1*x
    let result = matchVariation('Multiply', [1, expr]);
    if (result !== null) return result;

    // -x -> -1*x
    if (expr.operator === 'Negate') {
      result = matchVariation('Multiply', [-1, expr.op1!]);
      if (result !== null) return result;
    }

    // x/a -> (1/a)*x
    if (expr.operator === 'Divide') {
      result = matchVariation('Multiply', [
        expr.op1!,
        ['Divide', 1, expr.op2!],
      ]);
      if (result !== null) return result;
    }
  }

  if (operator === 'Divide') {
    // x/1 -> x
    const result = matchVariation('Divide', [expr, 1]);
    if (result !== null) return result;
  }

  if (operator === 'Square') {
    // Power(x, 2) -> Square(x)
    const result = matchVariation('Power', [expr, 2]);
    if (result !== null) return result;
  }

  if (operator === 'Exp') {
    // Power(E, x) -> Exp(x)
    const result = matchVariation('Power', [ce.E, expr]);
    if (result !== null) return result;
  }

  if (operator === 'Power') {
    // Square(x) -> Power(x, 2)
    if (pattern.op2.re === 2 && pattern.op2.im === 0) {
      const result = matchVariation('Square', [expr]);
      if (result !== null) return result;
    }
    // Exp(x) -> Power(E, x)
    if (pattern.op1.symbol === 'ExponentialE') {
      const result = matchVariation('Exp', [expr]);
      if (result !== null) return result;
    }
    // x -> Power(x, 1)
    {
      const result = matchVariation('Power', [expr, 1]);
      if (result !== null) return result;
    }
  }

  return null;
}

/**
 *
 * Try all needed permutations of the operands of a pattern expression, against the operands of a
 * match target. Assumes that *expr* and *pattern* have the same operator.
 *
 * For patterns containing sequence wildcards (__) with anchor elements (non-wildcards),
 * uses anchor-based matching: anchors match against specific expression elements,
 * and sequence wildcards capture ALL remaining elements.
 *
 * @param expr
 * @param pattern
 * @param substitution
 * @param options
 * @returns
 */
function matchPermutation(
  expr: BoxedExpression,
  pattern: BoxedExpression,
  substitution: BoxedSubstitution,
  options: PatternMatchOptions
): BoxedSubstitution | null {
  console.assert(expr.operator === pattern.operator);

  const patternOps = pattern.ops!;

  // Check if we have sequence wildcards with anchors - use anchor-based matching
  const hasSequenceWildcard = patternOps.some((op) => {
    const wType = wildcardType(op);
    return wType === 'Sequence' || wType === 'OptionalSequence';
  });
  const hasAnchor = patternOps.some((op) => !isWildcard(op));

  if (hasSequenceWildcard && hasAnchor) {
    const result = matchCommutativeWithAnchors(
      expr,
      pattern,
      substitution,
      options
    );
    if (result !== null) return result;
  }

  // Fall back to permutation-based matching
  // Filter out invalid permutations with consecutive multi-element wildcards:
  // - Sequence followed by Sequence or OptionalSequence
  // - OptionalSequence followed by Sequence or OptionalSequence
  // Note: Sequence/OptionalSequence followed by universal Wildcard (_) is VALID
  // because the single-element wildcard provides an anchor point.
  const cond = (
    xs: ReadonlyArray<BoxedExpression> /* , generated: Set<string> */
  ) =>
    !xs.some((x, index) => {
      if (!isWildcard(x)) return false;
      const xType = wildcardType(x);
      if (xType !== 'Sequence' && xType !== 'OptionalSequence') return false;

      const next = xs[index + 1];
      if (!next || !isWildcard(next)) return false;

      const nextType = wildcardType(next);
      // Only exclude consecutive multi-element wildcards
      return nextType === 'Sequence' || nextType === 'OptionalSequence';
    });

  const patterns = permutations(patternOps, cond);

  for (const pat of patterns) {
    const result = matchArguments(expr, pat, substitution, options);
    if (result !== null) return result;
  }
  return null;
}

/**
 * Match pattern operands against expression operands using anchor-based matching.
 *
 * For commutative operators with sequence wildcards and anchors (non-wildcard elements),
 * this allows anchors to match anywhere in the expression, with ALL remaining elements
 * captured by sequence wildcards.
 *
 * This solves the case where permuting pattern operands alone isn't sufficient:
 * Pattern: ['Add', 1, '__a'] matching Expression: ['Add', 'x', 1, 2, 3, 5]
 * - Anchor `1` matches position 1 in the expression
 * - Sequence `__a` captures all remaining: ['x', 2, 3, 5] → ['Add', 'x', 2, 3, 5]
 */
// Maximum number of combinations to try before giving up (prevents exponential blowup)
const MAX_COMBINATIONS = 1000;

/**
 * Calculate anchor specificity for ordering.
 * Higher specificity = more constrained = should match first.
 * - Number literals: highest specificity (exact match)
 * - Symbols: high specificity
 * - Simple functions: medium specificity
 * - Complex expressions: lower specificity
 */
function anchorSpecificity(anchor: BoxedExpression): number {
  if (anchor.isNumberLiteral) return 100;
  if (anchor.symbol) return 80;
  if (anchor.string !== undefined) return 90;
  // Functions - specificity based on depth/complexity
  if (anchor.operator) {
    // More operands = more specific
    const opCount = anchor.nops ?? 0;
    // Count non-wildcard children for extra specificity
    let nonWildcardChildren = 0;
    if (anchor.ops) {
      for (const op of anchor.ops) {
        if (wildcardType(op) === null) nonWildcardChildren++;
      }
    }
    return 50 + opCount + nonWildcardChildren * 5;
  }
  return 0;
}

function matchCommutativeWithAnchors(
  expr: BoxedExpression,
  pattern: BoxedExpression,
  substitution: BoxedSubstitution,
  options: PatternMatchOptions
): BoxedSubstitution | null {
  const ce = expr.engine;
  const patternOps = pattern.ops!;
  const exprOps = [...expr.ops!];

  // Categorize pattern operands
  const anchors: BoxedExpression[] = [];
  const universalWildcards: BoxedExpression[] = [];
  const sequenceWildcards: BoxedExpression[] = [];
  const optionalSeqWildcards: BoxedExpression[] = [];

  for (const op of patternOps) {
    const wType = wildcardType(op);
    if (wType === null) {
      anchors.push(op);
    } else if (wType === 'Wildcard') {
      universalWildcards.push(op);
    } else if (wType === 'Sequence') {
      sequenceWildcards.push(op);
    } else {
      // OptionalSequence
      optionalSeqWildcards.push(op);
    }
  }

  // Early termination: check if we have enough elements
  const minNeeded =
    anchors.length + universalWildcards.length + sequenceWildcards.length;
  const maxAllowed =
    anchors.length +
    universalWildcards.length +
    (sequenceWildcards.length + optionalSeqWildcards.length > 0 ? Infinity : 0);

  if (exprOps.length < minNeeded) return null;
  if (
    sequenceWildcards.length === 0 &&
    optionalSeqWildcards.length === 0 &&
    exprOps.length > maxAllowed
  )
    return null;

  // Sort anchors by specificity (most specific first)
  // This reduces backtracking by pruning impossible branches early
  const sortedAnchors = [...anchors].sort(
    (a, b) => anchorSpecificity(b) - anchorSpecificity(a)
  );

  // Try to match anchors against expression elements using backtracking
  return tryMatchAnchors(0, exprOps, substitution);

  function tryMatchAnchors(
    anchorIndex: number,
    remainingOps: BoxedExpression[],
    sub: BoxedSubstitution
  ): BoxedSubstitution | null {
    // All anchors matched - now assign remaining ops to wildcards
    if (anchorIndex >= sortedAnchors.length) {
      return assignWildcards(remainingOps, sub);
    }

    // Early pruning: check if we have enough remaining elements
    const anchorsLeft = sortedAnchors.length - anchorIndex;
    const minWildcardNeeds =
      universalWildcards.length + sequenceWildcards.length;
    if (remainingOps.length < anchorsLeft + minWildcardNeeds) {
      return null;
    }

    const anchor = sortedAnchors[anchorIndex];

    // Find all positions where this anchor matches
    for (let i = 0; i < remainingOps.length; i++) {
      const matchResult = matchOnce(remainingOps[i], anchor, sub, options);
      if (matchResult !== null) {
        // Remove this element and try matching remaining anchors
        const newRemaining = [...remainingOps];
        newRemaining.splice(i, 1);
        const finalResult = tryMatchAnchors(
          anchorIndex + 1,
          newRemaining,
          matchResult
        );
        if (finalResult !== null) return finalResult;
      }
    }

    return null; // No position worked for this anchor
  }

  function assignWildcards(
    remainingOps: BoxedExpression[],
    sub: BoxedSubstitution
  ): BoxedSubstitution | null {
    const result: BoxedSubstitution | null = sub;

    // Calculate minimum required elements
    const neededForUniversal = universalWildcards.length;
    const minNeededForSequence = sequenceWildcards.length; // Each needs at least 1

    const totalNeeded = neededForUniversal + minNeededForSequence;

    if (remainingOps.length < totalNeeded) return null;

    // For multiple wildcards, we need to try different assignments
    // Use recursive backtracking to assign elements to wildcards
    return tryAssignWildcards(
      [...universalWildcards, ...sequenceWildcards, ...optionalSeqWildcards],
      remainingOps,
      result
    );
  }

  function tryAssignWildcards(
    wildcards: BoxedExpression[],
    remaining: BoxedExpression[],
    sub: BoxedSubstitution
  ): BoxedSubstitution | null {
    if (wildcards.length === 0) {
      // All wildcards assigned - remaining must be empty
      return remaining.length === 0 ? sub : null;
    }

    const [wc, ...restWildcards] = wildcards;
    const wcType = wildcardType(wc);
    const wcName = wildcardName(wc)!;

    if (wcType === 'Wildcard') {
      // Universal wildcard - try each remaining element
      for (let i = 0; i < remaining.length; i++) {
        const newSub = captureWildcard(wcName, remaining[i], sub);
        if (newSub !== null) {
          const newRemaining = [...remaining];
          newRemaining.splice(i, 1);
          const result = tryAssignWildcards(
            restWildcards,
            newRemaining,
            newSub
          );
          if (result !== null) return result;
        }
      }
      return null;
    }

    if (wcType === 'Sequence') {
      // Sequence wildcard needs at least 1 element
      // Try capturing different numbers of elements (greedy: start with all)
      const minCapture = 1;
      const maxCapture = remaining.length - countMinNeeded(restWildcards);

      for (let count = maxCapture; count >= minCapture; count--) {
        // Try capturing 'count' elements from any positions
        const combinations = getCombinations(remaining.length, count);
        for (const indices of combinations) {
          const captured = indices.map((i) => remaining[i]);
          const capturedExpr = wrapCaptured(captured);
          const newSub = captureWildcard(wcName, capturedExpr, sub);
          if (newSub !== null) {
            const newRemaining = remaining.filter(
              (_, i) => !indices.includes(i)
            );
            const result = tryAssignWildcards(
              restWildcards,
              newRemaining,
              newSub
            );
            if (result !== null) return result;
          }
        }
      }
      return null;
    }

    // OptionalSequence - can capture 0 or more elements
    const maxCapture = remaining.length - countMinNeeded(restWildcards);

    for (let count = maxCapture; count >= 0; count--) {
      if (count === 0) {
        // Capture identity element
        const identity =
          expr.operator === 'Add'
            ? ce.Zero
            : expr.operator === 'Multiply'
              ? ce.One
              : ce.Nothing;
        const newSub = captureWildcard(wcName, identity, sub);
        if (newSub !== null) {
          const result = tryAssignWildcards(restWildcards, remaining, newSub);
          if (result !== null) return result;
        }
      } else {
        const combinations = getCombinations(remaining.length, count);
        for (const indices of combinations) {
          const captured = indices.map((i) => remaining[i]);
          const capturedExpr = wrapCaptured(captured);
          const newSub = captureWildcard(wcName, capturedExpr, sub);
          if (newSub !== null) {
            const newRemaining = remaining.filter(
              (_, i) => !indices.includes(i)
            );
            const result = tryAssignWildcards(
              restWildcards,
              newRemaining,
              newSub
            );
            if (result !== null) return result;
          }
        }
      }
    }
    return null;
  }

  function countMinNeeded(wildcards: BoxedExpression[]): number {
    return wildcards.reduce((sum, wc) => {
      const wType = wildcardType(wc);
      if (wType === 'Wildcard') return sum + 1;
      if (wType === 'Sequence') return sum + 1;
      return sum; // OptionalSequence needs 0
    }, 0);
  }

  function wrapCaptured(captured: BoxedExpression[]): BoxedExpression {
    if (captured.length === 1) return captured[0];
    // For associative operators, wrap in the same operator
    const def = ce.lookupDefinition(expr.operator);
    if (def && isOperatorDef(def) && def.operator.associative) {
      return ce.function(expr.operator, captured, { canonical: false });
    }
    return ce.function('Sequence', captured, { canonical: false });
  }

  function getCombinations(n: number, k: number): number[][] {
    // Early check: if combinations would exceed limit, return empty
    // C(n,k) = n! / (k! * (n-k)!)
    // Use approximation to avoid computing large factorials
    if (n > 20 && k > 2 && k < n - 2) {
      // For large n and moderate k, combinations grow fast
      // Approximate: if n > 15 and k > 3, check more carefully
      let approxCount = 1;
      for (let i = 0; i < Math.min(k, n - k); i++) {
        approxCount = (approxCount * (n - i)) / (i + 1);
        if (approxCount > MAX_COMBINATIONS) return [];
      }
    }

    // Generate all combinations of k indices from 0..n-1
    const result: number[][] = [];
    const combo: number[] = [];

    function backtrack(start: number) {
      if (result.length >= MAX_COMBINATIONS) return; // Stop if limit reached
      if (combo.length === k) {
        result.push([...combo]);
        return;
      }
      for (let i = start; i < n; i++) {
        combo.push(i);
        backtrack(i + 1);
        combo.pop();
      }
    }

    backtrack(0);
    return result;
  }
}

/**
 * Match a list of patterns against operands of expression, appending wildcards (named) to
 * *substitution* (along the way). If a successful match, returns the new substitution (or the same
 * if no named wildcard), or *null* for no match.
 *
 * @param expr
 * @param patterns
 * @param substitution
 * @param options
 * @returns
 */
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

  // We're going to consume the ops array, so make a copy
  const ops = [...expr.ops!];

  return matchRemaining(patterns, substitution);

  /*
   * Local f().
   */
  /**
   * Match a list of patterns against *remaining* (locally scoped) `ops` and consume this list along
   * the way, whilst appending to `substitution`. If a complete/successful match, return this new
   * substitution; else return `null`.
   *
   * @note: calls recursively (permutations) for sequence wildcards
   *
   * @param patterns
   * @param substitution
   * @returns
   */
  function matchRemaining(
    patterns: ReadonlyArray<BoxedExpression>,
    substitution: BoxedSubstitution
  ): BoxedSubstitution | null {
    let result: BoxedSubstitution | null = { ...substitution };

    let i = 0; // Index in pattern

    while (i < patterns.length) {
      const pat = patterns[i];
      const argName = wildcardName(pat);

      if (argName !== null) {
        if (argName.startsWith('__')) {
          // Match 1 or more expressions (__) or 0 or more (___)
          const nextPattern = patterns[i + 1];

          const isOptionalSeq = argName.startsWith('___');

          if (nextPattern === undefined) {
            // No more args in the pattern after, go till the end
            if (ops.length === 0 && !isOptionalSeq) return null;
            result = captureWildcard(argName, captureOps(ops.length), result);
          } else {
            /** Total qty. of operands to be consumed by this sequence (of those remaining).
             * If a non-optional sequence, minimum must be 1.
             */
            let j = isOptionalSeq ? 0 : 1;

            // The next pattern should not be another required sequence wildcard
            // (^@todo?: validate beforehand; should never be permitted?)
            console.assert(
              !(
                isWildcard(nextPattern) &&
                wildcardType(nextPattern) === 'Sequence'
              )
            );

            // The next 'applicable' pattern.
            // If this sequence is qualified by one, or more optional-sequence wildcards, then these
            // should effectively be 'merged' with this sequence, and hence be marked as capturing
            // '0' operands. In this case, skip over these, arriving at the next applicable pattern,
            // and capture the optional wildcards subsequently.
            let nextAppPattern = nextPattern;
            let nextAppPatternIndex = i + 1;

            while (
              isWildcard(nextAppPattern) &&
              wildcardType(nextAppPattern) === 'OptionalSequence'
            ) {
              if (!patterns[nextAppPatternIndex + 1]) break;
              // @note: if pattern has been validated prior, the next should never be a '_'
              // (universal) or '__' (regular sequence) wildcard
              nextAppPattern = patterns[++nextAppPatternIndex];
            }

            // Set to `true` if there is at least one op. (remaining to be consumed) which matches
            // the next pattern.
            let found = false;
            while (!found && j < ops.length) {
              found =
                matchOnce(ops[j], nextAppPattern, result, options) !== null;
              if (!found) j += 1;
            }

            // The next pattern does not match against any of the remaining ops.
            if (!found) {
              // If not an optional-seq., can assume no overall match.
              if (!isOptionalSeq) return null;
              // Capture a 0-length match wildcard
              //(?Never?Must indicate being at end of ops. at this point...?)
              result = captureWildcard(argName, captureOps(0), result);
            } else {
              // If have encountered optional-sequences following this sequence wildcard, capture
              // these (i.e. as corresponding to 0 operands)
              if (nextAppPattern !== nextPattern) {
                // Index of pattern which is an optional-sequence Wildcard:
                let wildcardIndex = i + 1;
                while (wildcardIndex < nextAppPatternIndex && result !== null) {
                  result = captureWildcard(
                    wildcardName(patterns[wildcardIndex++])!,
                    captureOps(0),
                    result
                  );
                }
                // If capturing optional sequences failed, no match
                if (result === null) return null;
              }

              // A sequence wildcard has matched up until the *first* operand that the next (valid) pattern matches.
              // First try matching remaining ops. against remaining patterns with the sequence
              // only capturing the operands leading up to this...
              // Otherwise, continue to see if the next pattern matches (even) further ahead: and
              // allow this sequence wildcard to capture even more operands.
              // (^Necessary, for instance, if considering a pattern such as '...a + _n + b' matched
              // against '3 + 4 + x + b'...: the sequence will have initially captured just '3', but
              // this will result in a final overall no-match. In this case. allow the sequence to
              // capture '3 + 4' (finally permitting a 'total' match)
              // Save the substitution before entering the loop, so we can use it
              // for pattern matching checks even after matchRemaining returns null
              const savedSubstitution = result!;

              while (j <= ops.length) {
                // Attempt the match of remaining patterns against remaining ops. after considering
                // the total capture by this seq.-wildcard for this iteration.
                const capturedOps = ops.slice(0, j);

                result = matchRemaining(
                  patterns.slice(nextAppPatternIndex),
                  captureWildcard(argName, captureOps(j), savedSubstitution) ??
                    savedSubstitution
                );

                // A complete overall match with this sequence capturing 'j' operands.
                if (result) break;

                // No match: reset the potential modified ops. array
                ops.unshift(...capturedOps);

                j++;
                if (j >= ops.length) break;

                // If the next pattern matches yet another/subsequent operand, move to the next
                // iteration and try to match remaining patterns.
                // Use savedSubstitution since result may be null from the failed matchRemaining
                if (
                  !matchOnce(
                    ops[j - 1],
                    nextAppPattern,
                    savedSubstitution,
                    options
                  )
                )
                  break;
              }

              // If successful, have matched til' the end: else, the result will be 'null'
              return result;
            }
          }
          /*
           * End of seq. wildcard matching
           */
        } else if (argName.startsWith('_')) {
          // Match a single expression
          if (ops.length === 0) return null;
          result = captureWildcard(argName, ops.shift()!, result);
        } else {
          result = matchOnce(ops.shift()!, pat, result, options);
        }
        /*
         * ↓Must be *non-wildcard*
         */
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

    /*
     * Local f.
     */
    /**
     *
     * Capture *qty* of remaining expessions/operands from the beginning of `ops` & return an an
     * appropriate expression, considering the containing expression operator.
     *
     * (Assumes that, given a `qty` of 0, the match *must* have been from an optional
     * sequence-wildcard match.)
     *
     * @param qty
     * @returns
     */
    function captureOps(qty: number): BoxedExpression {
      let value: BoxedExpression;
      if (qty < 1) {
        // Otherwise must be an optional-sequence match: this is permitted.
        if (expr.operator === 'Add') value = ce.Zero;
        else if (expr.operator === 'Multiply') value = ce.One;
        else value = ce.Nothing;
      } else if (qty === 1) {
        // Capturing a single element/operand
        value = ops.shift()!;
      } else {
        // >1 operands captured
        const def = ce.lookupDefinition(expr.operator);
        const args = ops.splice(0, qty);
        if (def && isOperatorDef(def) && def.operator.associative) {
          value = ce.function(expr.operator, args, { canonical: false });
        } else {
          value = ce.function('Sequence', args, { canonical: false });
        }
      }

      return value;
    }
  }
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
 * <!--
 * @consider?
 * - pattern 'validation' (not quite the right term in this context) here? In a similar way to the
 * check/condition supplied in 'matchPermutation()'? (i.e. inspect for redundant sequences of
 * wildcard combinations).
 * -->
 *
 */
export function match(
  subject: BoxedExpression,
  pattern: BoxedExpression,
  options?: PatternMatchOptions
): BoxedSubstitution | null {
  pattern = pattern.structural;

  // Note: Pattern validation is available via validatePattern() for explicit checks,
  // but not called here because canonicalization may reorder operands, making valid
  // patterns appear invalid. The permutation filter handles ambiguous cases during matching.

  // Default options
  const useVariations = options?.useVariations ?? false;
  const opts = {
    recursive: options?.recursive ?? false,
    useVariations,
    acceptVariants: useVariations,
    matchPermutations: options?.matchPermutations ?? true,
  };
  const substitution = options?.substitution ?? {};

  // Use 'structural' form, because we want to be able to
  // match the numerator/denominator of a fraction, for example.

  return matchOnce(subject.structural, pattern.structural, substitution, opts);
}

import { Expression } from '../../math-json/math-json-format';
import { NUMERIC_TOLERANCE } from '../numerics/numeric';
import { _BoxedExpression } from './abstract-boxed-expression';
import {
  BoxedExpression,
  BoxedSubstitution,
  BoxedDomain,
  IComputeEngine,
  LatexString,
  Metadata,
  Pattern,
  PatternMatchOptions,
  SemiBoxedExpression,
  Substitution,
  BoxedFunctionDefinition,
} from '../public';
import { hashCode, isLatexString } from './utils';
import { serializeJsonFunction } from './serialize';
import { BoxedNumber } from './boxed-number';
import { permutations } from '../../common/utils';

export class BoxedPattern extends _BoxedExpression implements Pattern {
  _pattern: BoxedExpression;

  constructor(
    ce: IComputeEngine,
    pattern: LatexString | SemiBoxedExpression,
    metadata?: Metadata
  ) {
    super(ce, metadata);
    this._pattern = isLatexString(pattern)
      ? ce.parse(pattern, { canonical: false })!
      : ce.box(pattern, { canonical: false });
  }

  get hash(): number {
    return hashCode('Pattern') ^ this._pattern.hash;
  }

  reset(): void {
    this._pattern.reset();
  }

  get json(): Expression {
    return serializeJsonFunction(this.engine, 'Pattern', [this._pattern]);
  }

  get head(): string | BoxedExpression {
    return 'Pattern';
  }

  get domain(): BoxedDomain {
    return this.engine.domain('Values');
  }

  get isCanonical(): boolean {
    return true;
  }

  set isCanonical(_val: boolean) {
    return;
  }

  isSame(rhs: BoxedExpression): boolean {
    if (this === rhs) return true;
    return rhs instanceof BoxedPattern && this._pattern.isSame(rhs._pattern);
  }

  isEqual(rhs: BoxedExpression): boolean {
    return rhs instanceof BoxedPattern && this._pattern.isEqual(rhs._pattern);
  }

  match(
    expr: BoxedExpression,
    options?: PatternMatchOptions
  ): BoxedSubstitution | null {
    return match(expr, this._pattern, {
      recursive: options?.recursive ?? false,
      numericTolerance: options?.numericTolerance ?? 0,
      substitution: options?.substitution ?? {},
      exact: options?.exact ?? false,
    });
  }

  test(expr: BoxedExpression, options?: PatternMatchOptions): boolean {
    return this.match(expr, options) !== null;
  }

  count(
    exprs: Iterable<BoxedExpression>,
    options?: PatternMatchOptions
  ): number {
    let result = 0;
    for (const expr of exprs) {
      if (this.match(expr, options) !== null) result += 1;
    }
    return result;
  }

  subs(sub: Substitution, options?: { canonical: boolean }): BoxedExpression {
    return this._pattern.subs(sub, options);
  }
}

function hasWildcards(expr: string | BoxedExpression): boolean {
  if (typeof expr === 'string') return expr.startsWith('_');

  if (expr.symbol?.startsWith('_')) return true;

  if (expr.ops) return hasWildcards(expr.head) || expr.ops.some(hasWildcards);

  if (expr.keys)
    for (const key of expr.keys)
      if (hasWildcards(expr.getKey(key)!)) return true;

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
 * @param expr
 * @param pattern
 * @param substitution
 * @param options
 * @returns
 */
function matchOnce(
  expr: BoxedExpression,
  pattern: BoxedExpression,
  substitution: BoxedSubstitution,
  options: {
    numericTolerance: number;
    exact?: boolean;
  }
): BoxedSubstitution | null {
  const exact = options.exact ?? false;
  const ce = expr.engine;

  if (pattern.head === 'Pattern')
    return pattern.match(expr, { ...options, ...substitution });

  //
  // Match a number
  //
  if (pattern instanceof BoxedNumber) {
    if (!(expr instanceof BoxedNumber)) return null;
    if (options.numericTolerance === 0)
      return pattern.isSame(expr) ? substitution : null;
    return pattern.isEqualWithTolerance(expr, options.numericTolerance)
      ? substitution
      : null;
  }

  //
  // Match a string
  //
  const str = pattern.string;
  if (str !== null) return expr.string === str ? substitution : null;

  //
  // Match a symbol or wildcard
  //
  const symbol = pattern.symbol;
  if (symbol !== null) {
    if (symbol.startsWith('_'))
      return captureWildcard(symbol, expr, substitution);

    return symbol === expr.symbol ? substitution : null;
  }

  //
  // Match a dictionary
  //
  const keys = pattern.keys;
  if (keys !== null) {
    const exprKeys = expr.keys;
    if (exprKeys === null) return null; // A dictionary vs not a dictionary
    for (const key of keys) {
      const r = matchOnce(exprKeys[key], keys[key], substitution, options);
      if (r === null) return null;
      substitution = r;
    }
    return substitution;
  }

  //
  // Match a function
  //

  if (pattern.ops) {
    const head = pattern.head;

    // Match the function head
    if (typeof head === 'string' && head.startsWith('_'))
      return captureWildcard(head, ce.box(expr.head), substitution);

    let def: BoxedFunctionDefinition | undefined = undefined;
    if (typeof head === 'string' && typeof expr.head === 'string') {
      if (head !== expr.head) {
        // The heads did not match and we want an exact match: bail
        if (exact) return null;

        // Let's try some variants...

        if (head === 'Add') {
          // a+x -> x
          let result = matchOnce(
            ce.box(['Add', 0, expr], { canonical: false }),
            pattern,
            substitution,
            options
          );
          if (result !== null) return result;

          // a+x -> a-(-x)
          if (expr.head === 'Subtract') {
            result = matchOnce(
              ce.box(['Add', expr.op1!, ['Negate', expr.op2!]], {
                canonical: false,
              }),
              pattern,
              substitution,
              options
            );
          }
          if (result !== null) return result;
        }

        if (head === 'Subtract') {
          let result = matchOnce(
            ce.box(['Subtract', expr, 0], { canonical: false }),
            pattern,
            substitution,
            options
          );
          if (result !== null) return result;

          if (expr.head === 'Negate') {
            result = matchOnce(
              ce.box(['Subtract', 0, expr.op1!], { canonical: false }),
              pattern,
              substitution,
              options
            );
          }
          if (result !== null) return result;
        }

        if (head === 'Multiply') {
          // ax -> x
          let result = matchOnce(
            ce.box(['Multiply', 1, expr], { canonical: false }),
            pattern,
            substitution,
            options
          );
          if (result !== null) return result;

          // ax -> -x
          if (expr.head === 'Negate') {
            result = matchOnce(
              ce.box(['Multiply', -1, expr.op1!], { canonical: false }),
              pattern,
              substitution,
              options
            );
            if (result !== null) return result;
          }

          // ax -> x/a
          if (expr.head === 'Divide') {
            result = matchOnce(
              ce.box(['Multiply', expr.op1!, ['Divide', 1, expr.op2!]], {
                canonical: false,
              }),
              pattern,
              substitution,
              options
            );
            if (result !== null) return result;
          }
        }

        if (head === 'Divide') {
          const result = matchOnce(
            ce.box(['Divide', expr, 1], { canonical: false }),
            pattern,
            substitution,
            options
          );
          if (result !== null) return result;
        }

        return null;
      }
      def = ce.lookupFunction(head);
    } else {
      const r = matchOnce(
        ce.box(expr.head, { canonical: false }),
        ce.box(head, { canonical: false }),
        substitution,
        options
      );
      if (r === null) return null;
      substitution = r;
    }

    return def?.commutative
      ? matchPermutation(expr, pattern, substitution, options)
      : matchArguments(expr, pattern.ops, substitution, options);
  }

  return null; // no match
}

function matchPermutation(
  expr: BoxedExpression,
  pattern: BoxedExpression,
  substitution: BoxedSubstitution,
  options: { numericTolerance: number }
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
  patterns: BoxedExpression[],
  substitution: BoxedSubstitution,
  options: { numericTolerance: number }
): BoxedSubstitution | null {
  if (patterns.length === 0) return null;

  const ce = patterns[0].engine;
  let result: BoxedSubstitution | null = { ...substitution };

  // We're going to consume the ops array, so make a copy
  const ops = [...expr.ops!];

  let i = 0; // Index in pattern

  while (i < patterns.length) {
    const pat = patterns[i];
    const argName = pat.symbol;

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
          if (expr.head === 'Add') value = ce.Zero;
          else if (expr.head === 'Multiply') value = ce.One;
          else value = ce.box(['Sequence']);
        } else value = ce.box([expr.head, ...ops.splice(0, j - 1)]);

        result = captureWildcard(argName, value, result);
      } else if (argName.startsWith('_')) {
        // Match a single expression
        result = captureWildcard(argName, ops.shift()!, result);
      } else {
        result = matchOnce(ops.shift()!, pat, result, options);
        if (result === null) return null;
      }
    } else {
      const arg = ops.shift()!;
      if (!arg) return null;
      result = matchOnce(arg, pat, result, options);
      if (result === null) return null;
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
 * The function attempts to match a [pattern](http://cortexjs.io/compute-engine/guides/patterns-and-rules/)
 * with a subject expression.
 *
 * If the match is successful, it returns a `Substitution` indicating how to
 * transform the pattern to become the subject.
 *
 * If the pattern is not a match, it returns `null`.
 *
 */
function match(
  subject: BoxedExpression,
  pattern: BoxedExpression,
  options: PatternMatchOptions
): BoxedSubstitution | null {
  const substitution = matchOnce(subject, pattern, options.substitution ?? {}, {
    numericTolerance: options?.numericTolerance ?? NUMERIC_TOLERANCE,
  });
  if (substitution) {
    // console.info('match', subject.toString(), pattern.toString(), substitution);
    return substitution;
  }

  if (!options.recursive) return null;

  // Attempt to match recursively on the arguments of a function (or the keys
  // of a dictionary) @todo

  if (subject.ops) {
    const ops = subject.ops;
    const result = {};
    for (let i = 0; i < ops.length; i++) {
      const sub = match(ops[i], pattern, options);
      if (sub !== null) return sub;
    }
    return result;
  }

  return null;
}

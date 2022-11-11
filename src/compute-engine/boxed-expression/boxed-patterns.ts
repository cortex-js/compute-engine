import { Expression } from '../../math-json/math-json-format';
import { NUMERIC_TOLERANCE } from '../numerics/numeric';
import { getWildcardName } from '../rules';
import { AbstractBoxedExpression } from './abstract-boxed-expression';
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

export class BoxedPattern extends AbstractBoxedExpression implements Pattern {
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

  unbind(): void {
    this._pattern.unbind();
  }

  get json(): Expression {
    return serializeJsonFunction(this.engine, 'Pattern', [this._pattern]);
  }

  get head(): string | BoxedExpression {
    return 'Pattern';
  }

  get domain(): BoxedDomain {
    return this.engine.domain('Pattern');
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
  const name = getWildcardName(wildcard);

  // If this is a universal wildcard, it always matches and no need to add it
  // to the substitution record.
  if (name === '') return substitution;

  if (substitution[name] !== undefined) {
    // There was already a matching wildcard, make sure this one is identical
    if (!expr.isSame(substitution[name])) return null;
    return substitution;
  }

  if (hasWildcards(expr)) return null;

  return { ...substitution, [name]: expr };
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
  options: { numericTolerance: number }
): BoxedSubstitution | null {
  const ce = expr.engine;

  if (pattern.head === 'Pattern')
    return pattern.match(expr, { substitution, ...options });

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
  // Match a symbol or capture symbol
  //
  const symbol = pattern.symbol;
  if (symbol !== null) {
    if (symbol.startsWith('_'))
      return captureWildcard(symbol, expr, substitution);

    return symbol === expr.symbol ? substitution : null;
  }

  // If the number of operands or keys don't match, it's not a match
  if (pattern.nops !== expr.nops) return null;

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
      if (head !== expr.head) return null;
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
      ? matchCommutativeArguments(expr, pattern, substitution, options)
      : matchNonCommutativeArguments(expr, pattern, substitution, options);
  }

  return null; // no match
}

function matchPermutation(
  ce: IComputeEngine,
  ops: BoxedExpression[],
  patterns: BoxedExpression[],
  substitution: BoxedSubstitution,
  options: { numericTolerance: number }
): BoxedSubstitution | null {
  let result: BoxedSubstitution = { ...substitution };

  ops = [...ops];

  // Iterate over each argument in pattern
  let hasRest = false;
  for (const arg of patterns) {
    if (arg.symbol === '__') hasRest = true;
    else {
      let r: BoxedSubstitution | null = null;
      if (arg.symbol?.startsWith('_')) {
        for (let i = 0; i <= ops.length - 1; i++) {
          r = captureWildcard(arg.symbol, ops[i], result);
          if (r !== null) {
            // Found a matching argument, remove it
            ops.splice(i, 1);
            break;
          }
        }
      } else {
        for (let i = 0; i <= ops.length - 1; i++) {
          r = matchOnce(ops[i], arg, result, options);
          if (r !== null) {
            ops.splice(i, 1);
            break;
          }
        }
      }
      if (r === null) return null;
      result = r;
    }
  }

  // If not all ops matched, and we don't have a 'rest' capture, fail
  if (!hasRest && ops.length > 0) return null;

  //  If the pattern included a 'rest' pattern, use any remaining arguments
  if (result !== null && hasRest) result['__'] = ce._fn('Sequence', ops);

  return result;
}

function matchCommutativeArguments(
  expr: BoxedExpression,
  pattern: BoxedExpression,
  substitution: BoxedSubstitution,
  options: { numericTolerance: number }
): BoxedSubstitution | null {
  const patterns = permutations<BoxedExpression>(pattern.ops!);
  for (const pat of patterns) {
    const result = matchPermutation(
      expr.engine,
      expr.ops!,
      pat,
      substitution,
      options
    );
    if (result !== null) return result;
  }
  return null;
}

function matchNonCommutativeArguments(
  expr: BoxedExpression,
  pattern: BoxedExpression,
  substitution: BoxedSubstitution,
  options: { numericTolerance: number }
): BoxedSubstitution | null {
  const ce = expr.engine;
  const ops = [...expr.ops!];
  let result: BoxedSubstitution | null = { ...substitution };
  let i = 0; // Index in pattern
  const patterns = pattern.ops!; // pattern.ops!.map((x) => ce.pattern(x));
  while (i < pattern.nops) {
    const pat = patterns[i];
    const argName = pat.symbol;
    if (argName !== null) {
      if (argName.startsWith('__')) {
        // Match 0 or more expressions (__) or 1 or more (___)
        let j = 0; // Index in subject
        if (patterns[i + 1] === undefined) {
          // No more args after, go till the end
          j = ops.length + 1;
        } else {
          // Capture till the next matching arg
          let found = false;
          while (!found && j < ops.length) {
            found =
              matchOnce(ops[j], patterns[i + 1], result, options) !== null;
            j += 1;
          }
          if (!found) return null;
        }
        if (!argName.startsWith('___') && j <= 1) return null;
        result = captureWildcard(
          argName,
          ce.fn('Sequence', ops.splice(0, j - 1)),
          result
        );
      } else if (argName.startsWith('_')) {
        result = captureWildcard(argName, ops.shift()!, result);
      } else {
        const sub = matchOnce(ops.shift()!, pat, result, options);
        if (sub === null) return null;
        result = sub;
      }
    } else {
      const sub = matchOnce(ops.shift()!, pat, result, options);
      if (sub === null) return null;
      result = sub;
    }

    if (result === null) return null;
    i += 1;
  }

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
 * This function attempts the match purely structurally, without any
 * knowledge about commutative and associative properties of functions. To
 * account for those properties, use the canonical form of the pattern and
 * the subject.
 *
 */
function match(
  subject: BoxedExpression,
  pattern: BoxedExpression,
  options: {
    recursive: boolean;
    numericTolerance: number;
    substitution?: BoxedSubstitution;
  }
): BoxedSubstitution | null {
  const substitution = matchOnce(subject, pattern, options.substitution ?? {}, {
    numericTolerance: options?.numericTolerance ?? NUMERIC_TOLERANCE,
  });
  if (substitution) return substitution;

  if (!options.recursive) return null;

  // Attempt to match recursively on the arguments of a function (or the keys
  // of a dictionary) @todo

  return null;
}

// function boxedSubstitution(ce: IComputeEngine, sub: null): null;
// function boxedSubstitution(
//   ce: IComputeEngine,
//   sub: Substitution
// ): BoxedSubstitution;
// function boxedSubstitution(
//   ce: IComputeEngine,
//   sub: Substitution | null
// ): BoxedSubstitution | null;
// function boxedSubstitution(
//   ce: IComputeEngine,
//   sub: Substitution | null
// ): BoxedSubstitution | null {
//   if (sub === null) return null;
//   return Object.fromEntries(
//     Object.entries(sub).map(([k, v]) => [k, ce.box(v)])
//   );
// }

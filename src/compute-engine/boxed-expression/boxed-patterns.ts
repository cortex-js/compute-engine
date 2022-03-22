import { Expression } from '../../math-json/math-json-format';
import { NUMERICAL_TOLERANCE } from '../numerics/numeric';
import { getWildcardName } from '../rules';
import { AbstractBoxedExpression } from './abstract-boxed-expression';
import {
  BoxedExpression,
  IComputeEngine,
  LatexString,
  Metadata,
  Pattern,
  PatternMatchOption,
  SemiBoxedExpression,
  Substitution,
} from '../public';
import { hashCode, isLatexString } from './utils';
import { serializeJsonFunction } from './serialize';
import { BoxedNumber } from './boxed-number';

export class BoxedPattern extends AbstractBoxedExpression implements Pattern {
  _pattern: BoxedExpression;
  _canonicalPattern: BoxedExpression | undefined;
  constructor(
    ce: IComputeEngine,
    pattern: LatexString | SemiBoxedExpression,
    metadata?: Metadata
  ) {
    super(ce, metadata);
    this._pattern = isLatexString(pattern)
      ? ce.parse(pattern)!
      : ce.box(pattern);
    if (this._pattern.isCanonical) this._canonicalPattern = this._pattern;
  }

  get hash(): number {
    return hashCode('Pattern') ^ this._pattern.hash;
  }

  _purge(): undefined {
    this._pattern._purge();
    this._canonicalPattern?._purge();
    return undefined;
  }

  get json(): Expression {
    return serializeJsonFunction(this.engine, 'Pattern', [this._pattern]);
  }

  get head(): string | BoxedExpression {
    return 'Pattern';
  }

  get domain(): BoxedExpression {
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
    options?: PatternMatchOption
  ): Substitution | null {
    // console.assert(!hasWildcards(expr));

    let pattern = this._pattern;
    if (!(options?.exact ?? false)) {
      if (!this._canonicalPattern)
        this._canonicalPattern = this._pattern.canonical;
      pattern = this._canonicalPattern;
    }
    return match(expr, pattern, {
      recursive: options?.recursive ?? false,
      numericTolerance: options?.numericTolerance ?? 0,
    });
  }

  test(expr: BoxedExpression, options?: PatternMatchOption): boolean {
    return this.match(expr, options) !== null;
  }

  count(
    exprs: Iterable<BoxedExpression>,
    options?: PatternMatchOption
  ): number {
    let result = 0;
    for (const expr of exprs) {
      if (this.match(expr, options) !== null) result += 1;
    }
    return result;
  }

  subs(sub: Substitution): BoxedPattern {
    return new BoxedPattern(this.engine, this._pattern.subs(sub).canonical);
  }
}

function hasWildcards(expr: string | BoxedExpression): boolean {
  if (typeof expr === 'string') return expr.startsWith('_');
  if (expr.symbol?.startsWith('_')) return true;

  if (expr.ops) {
    return hasWildcards(expr.head) || expr.ops.some(hasWildcards);
  }

  if (expr.keys) {
    for (const key of expr.keys)
      if (hasWildcards(expr.getKey(key)!)) return true;
  }
  return false;
}

function captureWildcard(
  wildcard: string,
  expr: BoxedExpression,
  substitution: Substitution
): Substitution | null {
  // if (expr === null) return null;

  const name = getWildcardName(wildcard);

  // If this is a universal wildcard, it always matches and no need to add it
  // to the substitution record.
  if (name === '') return substitution;

  if (substitution[name]) {
    // There was already a matching wildcard, make sure this one is identical
    if (!expr.isSame(substitution[name])) return null;
    return substitution;
  } else {
    substitution[name] = expr;
  }
  return substitution;
}

function matchOnce(
  expr: BoxedExpression,
  pattern: BoxedExpression,
  substitution: Substitution,
  options: { numericTolerance: number }
): Substitution | null {
  const ce = expr.engine;
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
    else {
      const r = matchOnce(
        ce.box(expr.head),
        ce.pattern(head),
        substitution,
        options
      );
      if (r === null) return null;
      substitution = r;
    }

    // Match the arguments
    const exprArgs = expr.ops!;
    let result: Substitution | null = { ...substitution };
    let i = 0; // Index in pattern
    const patArgs = pattern.ops!.map((x) => ce.pattern(x));
    while (i < pattern.nops) {
      const arg = patArgs[i];
      const argName = arg.symbol;
      if (argName !== null) {
        if (argName.startsWith('__')) {
          // Match 0 or more expressions (__) or 1 or more (___)
          let j = 0; // Index in subject
          if (patArgs[i + 1] === undefined) {
            // No more args after, go till the end
            j = exprArgs.length + 1;
          } else {
            // Capture till the next matching arg
            let found = false;
            while (!found && j < exprArgs.length) {
              found =
                matchOnce(
                  exprArgs[j],
                  patArgs[i + 1],
                  substitution,
                  options
                ) !== null;
              j += 1;
            }
            if (!found) return null;
          }
          if (!argName.startsWith('___') && j <= 1) return null;
          result = captureWildcard(
            argName,
            ce.fn('Sequence', exprArgs.splice(0, j - 1)),
            result!
          );
        } else if (argName.startsWith('_')) {
          result = captureWildcard(argName, exprArgs.shift()!, result);
        } else {
          const sub = matchOnce(exprArgs.shift()!, arg, substitution, options);
          if (sub === null) return null;
          result = { ...result, ...sub };
        }
      } else {
        const sub = matchOnce(exprArgs.shift()!, arg, substitution, options);
        if (sub === null) return null;
        result = { ...result, ...sub };
      }

      if (result === null) return null;
      i += 1;
    }
    return result;
  }

  return null; // no match
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
  options: { recursive: boolean; numericTolerance: number }
): Substitution | null {
  console.assert(!hasWildcards(subject));
  console.assert(hasWildcards(pattern));
  const substitution = matchOnce(
    subject,
    pattern,
    {},
    {
      numericTolerance: options?.numericTolerance ?? NUMERICAL_TOLERANCE,
    }
  );
  if (substitution) return substitution;

  if (!options.recursive) return null;

  // Attempt to match recursively on the arguments of a function (or the keys
  // of a dictionary) @todo

  return null;
}

// export function match1(
//   expr: Expression,
//   pattern: Expression,
//   options: { numericTolerance: number }
// ): Expression | null {
//   const result = match(pattern, expr, options);
//   if (result === null) return null;
//   const keys = Object.keys(result);
//   if (keys.length !== 1) return null;
//   return result[keys[0]];
// }

// export function matchList(
//   ce: ComputeEngineInterface,
//   exprs: Iterable<BoxedExpression>,
//   pattern: BoxedPattern,
//   options: { numericTolerance: number }
// ): Substitution[] {
//   const result: Substitution[] = [];
//   for (const expr of exprs) {
//     const r = match(ce, expr, pattern, options);
//     if (r !== null) result.push(r);
//   }

//   return result;
// }

import {
  getDictionary,
  getFunctionHead,
  getFunctionName,
  getNumberValue,
  getStringValue,
  getSymbolName,
  getTail,
} from '../common/utils';
import { Expression } from '../public';

export type Substitution = { [symbol: string]: Expression };

function captureWildcard(
  wildcard: string,
  expr: Expression | null,
  substitution: Substitution
): Substitution | null {
  if (expr === null) return null;

  const name = getWildcardName(wildcard);

  // If this is a universal wildcard, it matches and no need to add it
  // to the substitution record.
  if (name === '') return substitution;

  if (substitution[name]) {
    // There was already a match, make sure this one is identical
    if (match(expr, substitution[name]) === null) return null;
    return substitution;
  } else {
    substitution[name] = expr;
  }
  return substitution;
}

export function matchRecursive(
  expr: Expression,
  pattern: Expression,
  substitution: Substitution
): Substitution | null {
  //
  // Match a number
  //
  const val = getNumberValue(pattern);
  if (val !== null) {
    if (getNumberValue(expr) === val) return substitution;
    return null;
  }

  //
  // Match a string
  //

  const str = getStringValue(pattern);
  if (str !== null) {
    if (getStringValue(expr) === str) return substitution;
    return null;
  }

  //
  // Match a dictionary
  //
  const dict = getDictionary(pattern);
  if (dict !== null) {
    const keys = Object.keys(dict);
    const exprDict = getDictionary(expr);
    if (exprDict === null) return null;
    if (Object.keys(exprDict).length !== keys.length) return null;
    for (const key of keys) {
      const r = matchRecursive(exprDict[key], dict[key], substitution);
      if (r === null) return null;
      substitution = r;
    }
  }

  //
  // Match a symbol or capture symbol
  //
  const symbol = getSymbolName(pattern);
  if (symbol !== null) {
    if (symbol.startsWith('_'))
      return captureWildcard(symbol, expr, substitution);

    if (symbol === getSymbolName(expr)) return substitution;
    return null;
  }

  //
  // Match a function
  //
  const head = getFunctionHead(pattern);
  if (head === null) return null;

  // Match the function head
  if (typeof head === 'string' && head.startsWith('_')) {
    return captureWildcard(head, getFunctionHead(expr), substitution);
  } else {
    const exprHead = getFunctionHead(expr);
    if (exprHead === null) return null;
    if (match(head, exprHead) === null) return null;
  }

  // Match the arguments
  const args = getTail(pattern);
  const exprArgs = getTail(expr);
  let result: Substitution | null = { ...substitution };
  let i = 0; // Index in pattern
  const count = args.length;
  while (i < count) {
    const arg = args[i];
    const argName = getSymbolName(arg);
    if (argName !== null) {
      if (argName.startsWith('__')) {
        // Match 0 or more expressions (__) or 1 or more (___)
        let j = 0; // Index in subject
        if (args[i + 1] === undefined) {
          // No more args after, go till the end
          j = exprArgs.length + 1;
        } else {
          // Capture till the next matching arg
          let found = false;
          while (!found && j < exprArgs.length) {
            found = match(args[i + 1], exprArgs[j]) !== null;
            j += 1;
          }
          if (!found) return null;
        }
        if (!argName.startsWith('___') && j <= 1) return null;
        result = captureWildcard(
          argName,
          ['Sequence', ...exprArgs.splice(0, j - 1)],
          result!
        );
      } else if (argName.startsWith('_')) {
        result = captureWildcard(argName, exprArgs.shift()!, result);
      } else {
        if (match(arg, exprArgs.shift()!) === null) return null;
      }
    } else {
      if (match(arg, exprArgs.shift()!) === null) return null;
    }

    if (result === null) return null;
    i += 1;
  }

  return result;
}

export function match(
  expr: Expression,
  pattern: Expression
): Substitution | null {
  return matchRecursive(expr, pattern, {});
}

export function match1(
  expr: Expression,
  pattern: Expression
): Expression | null {
  const result = match(pattern, expr);
  if (result === null) return null;
  const keys = Object.keys(result);
  if (keys.length !== 1) return null;
  return result[keys[0]];
}

export function count(
  exprs: Iterable<Expression>,
  pattern: Expression
): number {
  let result = 0;
  for (const expr of exprs) {
    if (match(expr, pattern) !== null) result += 1;
  }
  return result;
}

export function matchList(
  exprs: Iterable<Expression>,
  pattern: Expression
): Substitution[] {
  const result: Substitution[] = [];
  for (const expr of exprs) {
    const r = match(expr, pattern);
    if (r !== null) result.push(r);
  }

  return result;
}

export function substitute(
  expr: Expression,
  substitution: Substitution
): Expression {
  //
  // Symbol
  //
  const symbol = getSymbolName(expr);
  if (symbol !== null) {
    if (symbol.startsWith('_')) {
      return substitution[getWildcardName(symbol)] ?? expr;
    }
    return expr;
  }

  //
  // Dictionary
  //
  const dict = getDictionary(expr);
  if (dict !== null) {
    const result = {};
    for (const key of Object.keys(dict)) {
      result[key] = substitute(dict[key], substitution);
    }
    return { dict: result };
  }

  //
  // Function
  //
  const head = getFunctionHead(expr);
  if (head !== null) {
    let result: Expression = [substitute(head, substitution)];
    for (const arg of getTail(expr)) {
      const symbol = getSymbolName(arg);
      if (symbol !== null && symbol.startsWith('__')) {
        // Wildcard sequence: `__` or `___`
        const seq = substitution[getWildcardName(symbol)];
        if (seq === undefined || getFunctionName(seq) !== 'Sequence') {
          result.push(symbol);
        } else {
          result = result.concat(getTail(seq));
        }
      } else {
        result.push(substitute(arg, substitution));
      }
    }

    return result;
  }

  return expr;
}

function getWildcardName(s: string): string {
  const m = s.match(/^__?_?([a-zA-Z0-9]+)/);
  if (m === null) return '';
  return m[1];
}

// @todo ['Alternatives', ...]:
// @todo: ['Condition',...] : Conditional match
// @todo: ['Repeated',...] : repeating match
// @todo _x:Head or _x:RealNumber
// replace() -> replace matching patterns with another expression
// replaceAll(), replaceRepeated()
export function replace(
  expr: Expression,
  _rules: Iterable<[pattern: Expression, rule: Expression]>
): Expression {
  // for (const rule of rules) {
  // }

  return expr;
}

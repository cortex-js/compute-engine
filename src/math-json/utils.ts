import type {
  Expression,
  MathJsonFunction,
  MathJsonIdentifier,
  MathJsonNumber,
  MathJsonString,
  MathJsonSymbol,
} from './types';

export const MISSING: Expression = ['Error', "'missing'"];

export function isNumberExpression(
  expr: Expression | null
): expr is number | string | MathJsonNumber {
  if (typeof expr === 'number' || isNumberObject(expr)) return true;
  if (typeof expr === 'string' && /^[+-]?[0-9\.]/.test(expr)) return true;
  return false;
}

export function isNumberObject(
  expr: Expression | null
): expr is MathJsonNumber {
  return expr !== null && typeof expr === 'object' && 'num' in expr;
}

export function isSymbolObject(
  expr: Expression | null
): expr is MathJsonSymbol {
  return expr !== null && typeof expr === 'object' && 'sym' in expr;
}

export function isStringObject(
  expr: Expression | null
): expr is MathJsonString {
  return expr !== null && typeof expr === 'object' && 'str' in expr;
}

export function isFunctionObject(
  expr: Expression | null
): expr is MathJsonFunction {
  return expr !== null && typeof expr === 'object' && 'fn' in expr;
}

export function isDictionaryObject(expr: Expression): expr is MathJsonNumber {
  return expr !== null && typeof expr === 'object' && 'dict' in expr;
}

/**  If expr is a string literal, return it.
 *
 * A string literal is a JSON string that begins and ends with
 * **U+0027 APOSTROPHE** : **`'`** or an object literal with a `str` key.
 */
export function stringValue(
  expr: Expression | null | undefined
): string | null {
  if (expr === null || expr === undefined) return null;
  if (typeof expr === 'object' && 'str' in expr) return expr.str;
  if (typeof expr !== 'string') return null;
  if (expr.length < 2) return null;
  if (expr[0] !== "'" || expr[expr.length - 1] !== "'") return null;
  return expr.substring(1, expr.length - 1);
}

export function stripText(
  expr: Expression | null | undefined
): Expression | null {
  if (expr === null || expr === undefined || stringValue(expr) !== null)
    return null;

  const h = operator(expr);
  if (!h) return expr;
  return [
    h,
    ...operands(expr)
      .map((x) => stripText(x)!)
      .filter((x) => x !== null),
  ];
}

/**
 * The operator of a function is an identifier
 *
 * Return an empty string if the expression is not a function.
 *
 * Examples:
 * * `["Negate", 5]`  -> `"Negate"`
 */
export function operator(
  expr: Expression | null | undefined
): MathJsonIdentifier {
  if (Array.isArray(expr)) return expr[0];

  if (expr === null || expr === undefined) return '';

  if (isFunctionObject(expr)) return expr.fn[0];

  return '';
}

/**
 * Return the arguments of a function, or an empty array if not a function
 * or no arguments.
 */
export function operands(expr: Expression | null): Expression[] {
  if (Array.isArray(expr)) return expr.slice(1) as Expression[];
  if (expr !== undefined && isFunctionObject(expr)) return expr.fn.slice(1);

  return [];
}

/** Return the nth operand of a function expression */
export function operand(
  expr: Expression | null | undefined,
  n: number
): Expression | null {
  if (Array.isArray(expr)) return expr[n] ?? null;

  if (expr !== undefined && isFunctionObject(expr)) return expr.fn[n] ?? null;

  return null;
}

export function nops(expr: Expression | null | undefined): number {
  if (expr === null || expr === undefined) return 0;
  if (Array.isArray(expr)) return Math.max(0, expr.length - 1);
  if (isFunctionObject(expr)) return Math.max(0, expr.fn.length - 1);
  return 0;
}

export function unhold(expr: Expression | null | undefined): Expression | null {
  if (expr === null || expr === undefined) return null;
  if (operator(expr) === 'Hold') return operand(expr, 1);
  return expr;
}

export function symbol(expr: Expression | null | undefined): string | null {
  if (typeof expr === 'string') {
    // Is it a number?
    if (/^[+-]?[0-9\.]/.test(expr)) return null;
    // Is it a string literal?
    if (expr.length >= 2 && expr[0] === "'" && expr[expr.length - 1] === "'")
      return null;
    return expr;
  }

  if (expr === null || expr === undefined) return null;

  const s = isSymbolObject(expr) ? expr.sym : expr;
  if (typeof s !== 'string') return null;

  return s;
}

function keyValuePair(
  expr: Expression | null
): null | [key: string, value: Expression] {
  const h = operator(expr);
  if (h === 'KeyValuePair' || h === 'Tuple' || h === 'Pair') {
    const [k, v] = operands(expr);
    const key = stringValue(k);
    if (!key) return null;
    return [key, v ?? 'Nothing'];
  }

  return null;
}

export function dictionary(
  expr: Expression | null
): null | Record<string, Expression> {
  if (expr === null) return null;
  if (typeof expr === 'object' && 'dict' in expr) return expr.dict;

  const kv = keyValuePair(expr);
  if (kv) return { [kv[0]]: kv[1] };

  const h = operator(expr);
  if (h === 'Dictionary') {
    const result = {};
    for (let i = 1; i < nops(expr); i++) {
      const kv = keyValuePair(operand(expr, i));
      if (kv) result[kv[0]] = kv[1];
    }

    return result;
  }

  return null;
}

function machineValueOfString(s: string): number | null {
  s = s
    .toLowerCase()
    .replace(/[nd]$/, '')
    .replace(/[\u0009-\u000d\u0020\u00a0]/g, '');

  if (s === 'nan') return NaN;
  if (s === 'infinity' || s === '+infinity') return Infinity;
  if (s === '-infinity') return -Infinity;

  // Are there some repeating decimals?
  if (/\([0-9]+\)/.test(s)) {
    const [_, body, repeat, trail] = s.match(/(.+)\(([0-9]+)\)(.*)$/) ?? [];
    s = body + repeat.repeat(Math.ceil(16 / repeat.length)) + (trail ?? '');
  }
  // CAUTION: By using parseFloat, numbers with a precision greater than
  // machine range will be truncated. Numbers with an exponent outside of the
  // machine range will be returned as `Infinity` or `-Infinity`
  return parseFloat(s);
}

/**
 *  CAUTION: `machineValue()` will return a truncated value if the number
 *  has a precision outside of the machine range.
 */
export function machineValue(
  expr: Expression | null | undefined
): number | null {
  if (typeof expr === 'number') return expr;

  if (typeof expr === 'string') return machineValueOfString(expr);

  if (expr === null || expr === undefined) return null;

  // Stricly, expr.num should be a string, but we allow it to be a number
  if (isNumberObject(expr)) return machineValue(expr.num);

  return null;
}

/**
 * Return a rational (numer over denom) representation of the expression,
 * if possible, `null` otherwise.
 *
 * The expression can be:
 * - Some symbols: "Infinity", "Half"...
 * - ["Power", d, -1]
 * - ["Power", n, 1]
 * - ["Divide", n, d]
 *
 * The denominator is always > 0.
 */
export function rationalValue(
  expr: Expression | undefined | null
): [number, number] | null {
  if (expr === undefined || expr === null) return null;

  if (symbol(expr) === 'Half') return [1, 2];

  const h = operator(expr);
  if (!h) return null;

  let numer: number | null = null;
  let denom: number | null = null;

  if (h === 'Negate') {
    const r = rationalValue(operands(expr)[0]);
    if (r) return [-r[0], r[1]];
  }

  if (h === 'Rational' || h === 'Divide') {
    const [n, d] = operands(expr);
    numer = machineValue(n) ?? NaN;
    denom = machineValue(d) ?? NaN;
  }

  if (h === 'Power') {
    const [base, exp] = operands(expr);
    const exponent = machineValue(exp);
    if (exponent === 1) {
      numer = machineValue(base);
      denom = 1;
    } else if (exponent === -1) {
      numer = 1;
      denom = machineValue(base);
    }
  }

  if (h === 'Multiply') {
    const [op1, op2] = operands(expr);

    if (operator(op2) === 'Power') {
      const [op21, op22] = operands(op2);
      if (machineValue(op22) === -1) {
        numer = machineValue(op1);
        denom = machineValue(op21);
      }
    }
  }

  if (numer === null || denom === null) return null;

  if (Number.isInteger(numer) && Number.isInteger(denom)) return [numer, denom];

  return null;
}

export function subs(
  expr: Expression,
  s: { [symbol: string]: Expression }
): Expression {
  const h = operator(expr);
  if (h)
    return [
      subs(h, s) as MathJsonIdentifier,
      ...operands(expr).map((x) => subs(x, s)),
    ];

  const dict = dictionary(expr);
  if (dict !== null) {
    const keys = Object.keys(dict);
    const result = {};
    for (const key of keys) result[key] = subs(dict[key], s);
    return { dict: result };
  }

  const sym = symbol(expr);
  if (sym && s[sym]) return s[sym];

  return expr;
}

/**
 * Apply a function to the arguments of a function and return an array of T
 */
export function mapArgs<T>(expr: Expression, fn: (x: Expression) => T): T[] {
  let args: Expression[] | null = null;
  if (Array.isArray(expr)) args = expr;
  if (isFunctionObject(expr)) args = expr.fn;
  if (args === null) return [];
  let i = 1;
  const result: T[] = [];
  while (i < args.length) {
    result.push(fn(args[i]));
    i += 1;
  }

  return result;
}

/**
 * Assuming that op is an associative operator, fold lhs or rhs
 * if either are the same operator.
 */
export function foldAssociativeOperator(
  op: string,
  lhs: Expression,
  rhs: Expression
): Expression {
  const lhsName = operator(lhs);
  const rhsName = operator(rhs);

  if (lhsName === op && rhsName === op)
    return [op, ...operands(lhs), ...operands(rhs)];

  if (lhsName === op) return [op, ...operands(lhs), rhs];
  if (rhsName === op) return [op, lhs, ...operands(rhs)];
  return [op, lhs, rhs];
}

/** Return the elements of a sequence, or null if the expression is not a sequence. The sequence can be optionally enclosed by a`["Delimiter"]` expression  */
export function getSequence(expr: Expression | null): Expression[] | null {
  if (expr === null) return null;

  let h = operator(expr);
  if (h === 'Delimiter') {
    expr = operand(expr, 1);
    if (expr === null) return [];
    h = operator(expr);
    if (h !== 'Sequence') return [expr];
  }

  if (h !== 'Sequence') return null;

  return operands(expr);
}

export function isEmptySequence(expr: Expression | null): boolean {
  return operator(expr) === 'Sequence' && nops(expr) === 0;
}

export function missingIfEmpty(expr: Expression | null): Expression {
  if (isEmptySequence(expr)) return MISSING;
  return expr ?? MISSING;
}

function countFunctionLeaves(xs: Expression[]): number {
  if (xs[0] === 'Square') {
    // Square is synonym with Power(..., 2)
    return countFunctionLeaves(xs.slice(1)) + 2;
  }
  return xs.reduce<number>((acc, x) => acc + countLeaves(x), 0);
}

/** The number of leaves (atomic expressions) in the expression */
export function countLeaves(expr: Expression | null): number {
  if (expr === null) return 0;
  if (typeof expr === 'number' || typeof expr === 'string') return 1;
  if (isNumberExpression(expr) || isSymbolObject(expr) || isStringObject(expr))
    return 1;

  if (Array.isArray(expr)) return countFunctionLeaves(expr);
  if ('fn' in expr) return countFunctionLeaves(expr.fn);

  const dict = dictionary(expr);
  if (dict) {
    const keys = Object.keys(dict);
    return (
      1 +
      keys.length +
      keys.reduce<number>((acc, x) => acc + countLeaves(dict[x]), 0)
    );
  }

  return 0;
}

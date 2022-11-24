import {
  Expression,
  MathJsonFunction,
  MathJsonNumber,
  MathJsonString,
  MathJsonSymbol,
} from './math-json-format';

export function isNumberExpression(
  expr: Expression | null
): expr is number | string | MathJsonNumber {
  if (expr === null) return false;
  if (typeof expr === 'number') return true;
  if (isNumberObject(expr)) return true;
  if (typeof expr === 'string' && /^[+-]?[0-9]/.test(expr)) return true;
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

export function isValidIdentifier(s: string): boolean {
  // An identifier must not contain any of these characters
  if (/[\u0000-\u0020\u0022\u0060\ufffe\uffff]/.test(s)) return false;

  // A symbol name must not start with one these characters
  return !/^[\u0021\u0022\u0024-\u0029\u002e\u003a\u003f\u0040\u005b\u005d\u005e\u007b\u007d\u007e\+\-[0-9]]/.test(
    s
  );
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

  const h = head(expr);
  if (h !== null) {
    return [
      h,
      ...(ops(expr) ?? []).map((x) => stripText(x)!).filter((x) => x !== null),
    ];
  }
  return expr;
}

/**
 * The head of a function can be an identifier or an expression.
 *
 * Return `null` if the expression is not a function.
 *
 * Examples:
 * * `["Negate", 5]`  -> `"Negate"`
 * * `[["Prime", "f"], "x"]` -> `["Prime", "f"]`
 */
export function head(expr: Expression | null | undefined): Expression | null {
  if (expr === null || expr === undefined) return null;
  if (Array.isArray(expr)) {
    console.assert(
      expr.length > 0 &&
        (typeof expr[0] !== 'string' || isValidIdentifier(expr[0]))
    );
    return expr[0];
  }
  if (isFunctionObject(expr)) return expr.fn[0];
  return null;
}

/** Return the head of an expression, only if it's a string */
export function headName(expr: Expression | null): string {
  const h = head(expr);
  return typeof h === 'string' ? h : '';
}

/**
 * Return all the elements but the first one, i.e. the arguments of a
 * function.
 */
export function ops(expr: Expression | null | undefined): Expression[] | null {
  if (expr === null || expr === undefined) return null;

  if (Array.isArray(expr)) return expr.slice(1);

  if (isFunctionObject(expr)) return expr.fn.slice(1);

  return null;
}

/** Return the nth argument of a function expression */
export function op(
  expr: Expression | null | undefined,
  n: number
): Expression | null {
  if (expr === null || expr === undefined) return null;

  if (Array.isArray(expr)) return expr[n] ?? null;

  if (isFunctionObject(expr)) return expr.fn[n] ?? null;

  return null;
}

export function op1(expr: Expression | null | undefined): Expression | null {
  return op(expr, 1);
}

export function op2(expr: Expression | null | undefined): Expression | null {
  return op(expr, 2);
}

export function nops(expr: Expression | null | undefined): number {
  if (expr === null || expr === undefined) return 0;
  if (Array.isArray(expr)) return Math.max(0, expr.length - 1);
  if (isFunctionObject(expr)) return Math.max(0, expr.fn.length - 1);
  return 0;
}

export function symbol(expr: Expression | null | undefined): string | null {
  if (expr === null || expr === undefined) return null;

  if (typeof expr === 'string') {
    // Is it a number?
    if (/^[+\-\.0-9]/.test(expr)) return null;
    // Is it a string literal?
    if (expr.length >= 2 && expr[0] === "'" && expr[expr.length - 1] === "'")
      return null;
  }

  const s = isSymbolObject(expr) ? expr.sym : expr;
  if (typeof s !== 'string') return null;

  return s;
}

function keyValuePair(
  expr: Expression | null
): null | [key: string, value: Expression] {
  const h = head(expr);
  if (h === 'KeyValuePair' || h === 'Tuple' || h === 'Pair') {
    const key = stringValue(op1(expr));
    if (!key) return null;
    return [key, op2(expr) ?? 'Nothing'];
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

  const h = head(expr);
  if (h === 'Dictionary') {
    const result = {};
    for (let i = 1; i < nops(expr); i++) {
      const kv = keyValuePair(op(expr, i));
      if (kv) result[kv[0]] = kv[1];
    }

    return result;
  }

  return null;
}

function machineValueOfString(s: string): number | null {
  s = s
    .toLowerCase()
    .replace(/[nd]$/g, '')
    .replace(/[\u0009-\u000d\u0020\u00a0]/g, '');
  if (s === 'nan') return NaN;
  if (s === '+infinity') return Infinity;
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

// CAUTION: `machineValue()` will return a truncated value if the number has
// a precision outside of the machine range.
export function machineValue(
  expr: Expression | null | undefined
): number | null {
  if (expr === null || expr === undefined) return null;
  if (typeof expr === 'number') return expr;
  if (isNumberObject(expr)) return machineValueOfString(expr.num);
  if (typeof expr === 'string') return machineValueOfString(expr);

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

  const h = head(expr);
  if (!h) return null;

  let numer: number | null = null;
  let denom: number | null = null;

  if (h === 'Negate') {
    const r = rationalValue(op1(expr));
    if (r) return [-r[0], r[1]];
  }

  if (h === 'Rational' || h === 'Divide') {
    numer = machineValue(op1(expr)) ?? NaN;
    denom = machineValue(op2(expr)) ?? NaN;
  }

  if (h === 'Power') {
    const exponent = machineValue(op2(expr));
    if (exponent === 1) {
      numer = machineValue(op1(expr));
      denom = 1;
    } else if (exponent === -1) {
      numer = 1;
      denom = machineValue(op1(expr));
    }
  }

  if (
    h === 'Multiply' &&
    head(op2(expr)) === 'Power' &&
    machineValue(op2(op2(expr))) === -1
  ) {
    numer = machineValue(op1(expr));
    denom = machineValue(op1(op2(expr)));
  }

  if (numer === null || denom === null) return null;

  if (Number.isInteger(numer) && Number.isInteger(denom)) return [numer, denom];

  return null;
}

export function applyRecursively<T extends Expression = Expression>(
  expr: T,
  fn: (x: T) => T
): Expression {
  const h = head(expr);
  if (h !== null) {
    return [fn(h as T), ...(ops(expr) ?? []).map(fn)];
  }
  const dict = dictionary(expr);
  if (dict !== null) {
    const keys = Object.keys(dict);
    const result = {};
    for (const key of keys) result[key] = fn(dict[key] as T);
    return { dict: result };
  }
  return fn(expr);
}

export function subs(
  expr: Expression,
  s: { [symbol: string]: Expression }
): Expression {
  const h = head(expr);
  if (h !== null)
    return [subs(h, s), ...(ops(expr) ?? []).map((x) => subs(x, s))];

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
 * Apply the operator `op` to the left-hand-side and right-hand-side
 * expression. Applies the associativity rule specified by the definition,
 * i.e. 'op(a, op(b, c))` -> `op(a, b, c)`, etc...
 *
 */
export function applyAssociativeOperator(
  op: string,
  lhs: Expression,
  rhs: Expression,
  associativity: 'right' | 'left' | 'non' | 'both' = 'both'
): Expression {
  if (associativity === 'non') return [op, lhs, rhs];

  const lhsName = head(lhs);
  const rhsName = head(rhs);

  if (associativity === 'left') {
    if (lhsName === op) return [op, ...(ops(lhs) ?? []), rhs];
    return [op, lhs, rhs];
  }

  if (associativity === 'right') {
    if (rhsName === op) return [op, lhs, ...(ops(rhs) ?? [])];
    return [op, lhs, rhs];
  }

  // Associativity: 'both'
  if (lhsName === op && rhsName === op) {
    return [op, ...(ops(lhs) ?? []), ...(ops(rhs) ?? [])];
  }
  if (lhsName === op) return [op, ...(ops(lhs) ?? []), rhs];
  if (rhsName === op) return [op, lhs, ...(ops(rhs) ?? [])];
  return [op, lhs, rhs];
}

export function getSequence(expr: Expression | null): Expression[] | null {
  let h = head(expr);
  if (expr === null) return null;

  if (h === 'Delimiter') {
    expr = op(expr, 1);
    if (expr === null) return [];
    if (head(expr) !== 'Sequence') return [expr];
  }

  h = head(expr);
  if (h === 'Sequence') return ops(expr) ?? [];
  return null;
}

export function isEmptySequence(expr: Expression | null): boolean {
  if (expr === null) return false;
  if (head(expr) !== 'Sequence') return false;
  if (nops(expr) !== 0) return false;
  return true;
}

export function missingIfEmpty(expr: Expression | null): Expression {
  if (expr === null || isEmptySequence(expr)) return ['Error', "'missing'"];
  return expr;
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

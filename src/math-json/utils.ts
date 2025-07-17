import type {
  Expression,
  MathJsonFunctionObject,
  MathJsonSymbolObject,
  MathJsonNumberObject,
  MathJsonStringObject,
  MathJsonSymbol,
  MathJsonDictionaryObject,
  DictionaryValue,
} from './types';

export const MISSING: Expression = ['Error', "'missing'"];

export function isNumberExpression(
  expr: Expression | null
): expr is number | string | MathJsonNumberObject {
  if (typeof expr === 'number' || isNumberObject(expr)) return true;
  if (typeof expr === 'string' && matchesNumber(expr)) return true;
  return false;
}

export function isNumberObject(
  expr: Expression | null
): expr is MathJsonNumberObject {
  return expr !== null && typeof expr === 'object' && 'num' in expr;
}

export function isSymbolObject(
  expr: Expression | null
): expr is MathJsonSymbolObject {
  return expr !== null && typeof expr === 'object' && 'sym' in expr;
}

export function isStringObject(
  expr: Expression | null
): expr is MathJsonStringObject {
  return expr !== null && typeof expr === 'object' && 'str' in expr;
}

export function isDictionaryObject(
  expr: Expression | null
): expr is MathJsonDictionaryObject {
  return (
    expr !== null &&
    typeof expr === 'object' &&
    'dict' in expr &&
    typeof expr.dict === 'object' &&
    !Array.isArray(expr.dict) &&
    expr.dict !== null
  );
}

export function isFunctionObject(
  expr: Expression | null
): expr is MathJsonFunctionObject {
  return (
    expr !== null &&
    typeof expr === 'object' &&
    'fn' in expr &&
    Array.isArray(expr.fn) &&
    expr.fn.length > 0 &&
    typeof expr.fn[0] === 'string'
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
  if (expr.length >= 2 && expr.at(0) === "'" && expr.at(-1) === "'")
    return expr.substring(1, expr.length - 1);
  if (matchesNumber(expr) || matchesSymbol(expr)) return null;
  return expr;
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
 * The operator of a function is symbol.
 *
 * Return an empty string if the expression is not a function.
 *
 * Examples:
 * * `["Negate", 5]`  -> `"Negate"`
 */
export function operator(expr: Expression | null | undefined): MathJsonSymbol {
  if (Array.isArray(expr)) return expr[0];

  if (expr === null || expr === undefined) return '';

  if (isFunctionObject(expr)) return expr.fn[0];

  return '';
}

/**
 * Return the arguments of a function, or an empty array if not a function
 * or no arguments.
 */
export function operands(
  expr: Expression | null | undefined
): ReadonlyArray<Expression> {
  if (Array.isArray(expr)) return expr.slice(1) as Expression[];
  if (expr !== undefined && isFunctionObject(expr)) return expr.fn.slice(1);

  return [];
}

/** Return the nth operand of a function expression */
export function operand(
  expr: Expression | null,
  n: 1 | 2 | 3
): Expression | null {
  if (Array.isArray(expr)) return expr[n] ?? null;

  if (expr === null || !isFunctionObject(expr)) return null;

  return expr.fn[n] ?? null;
}

export function nops(expr: Expression | null | undefined): number {
  if (expr === null || expr === undefined) return 0;
  if (Array.isArray(expr)) return Math.max(0, expr.length - 1);
  if (isFunctionObject(expr)) return Math.max(0, expr.fn.length - 1);
  return 0;
}

export function unhold(expr: Expression | null): Expression | null {
  if (expr === null || expr === undefined) return null;
  if (operator(expr) === 'Hold') return operand(expr, 1);
  return expr;
}

export function symbol(expr: Expression | null | undefined): string | null {
  // Is it a symbol shorthand?
  if (typeof expr === 'string' && matchesSymbol(expr)) {
    if (expr.length >= 2 && expr.at(0) === '`' && expr.at(-1) === '`')
      return expr.slice(1, -1);
    return expr;
  }

  if (expr === null || expr === undefined) return null;

  if (isSymbolObject(expr)) return expr.sym;
  return null;
}

function keyValuePair(
  expr: Expression | null | undefined
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

// Parse the expression either as:
// - a `Dictionary` expression
// - a `KeyValuePair` or `Tuple` expression
export function dictionaryFromExpression(
  expr: Expression | null
): null | MathJsonDictionaryObject {
  if (expr === null) return null;

  if (isDictionaryObject(expr)) return expr as MathJsonDictionaryObject;

  // Is it a KeyValuePair or Tuple expression?
  const kv = keyValuePair(expr);
  if (kv) return { [kv[0]]: kv[1] } as unknown as MathJsonDictionaryObject;

  // Is it a Dictionary expression?
  if (operator(expr) === 'Dictionary') {
    const dict = {};
    const ops = operands(expr);
    for (let i = 1; i < nops(expr); i++) {
      const kv = keyValuePair(ops[i]);
      if (kv) {
        dict[kv[0]] = expressionToDictionaryValue(kv[1]) ?? 'Nothing';
      }
    }

    return { dict } as unknown as MathJsonDictionaryObject;
  }

  return null;
}

export function dictionaryFromEntries(
  dict: Record<string, Expression>
): Expression {
  const entries: Record<string, unknown> = Object.fromEntries(
    Object.entries(dict).map(([k, v]) => [
      k,
      jsValueToExpression(v) ?? 'Nothing',
    ])
  );
  return { dict: entries } as MathJsonDictionaryObject;
}

function machineValueOfString(s: string): number {
  s = s
    .toLowerCase()
    .replace(/[nd]$/, '')
    .replace(/[\u0009-\u000d\u0020\u00a0]/g, '');

  if (s === 'nan') return NaN;
  if (/^(infinity|\+infinity|oo|\+oo)$/i.test(s)) return Infinity;
  if (/^(-infinity|-oo)$/.test(s)) return -Infinity;

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

  if (typeof expr === 'string' && matchesNumber(expr))
    return machineValueOfString(expr);

  // Strictly, expr.num should be a string, but we allow it to be a number
  if (expr !== undefined && isNumberObject(expr)) return machineValue(expr.num);

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

/**
 * Apply a substitution to an expression.
 */
export function subs(
  expr: Expression,
  s: { [symbol: string]: Expression }
): Expression {
  const sym = symbol(expr);
  if (sym && s[sym]) return s[sym];

  const h = operator(expr);
  if (h)
    return [
      subs(h, s) as MathJsonSymbol,
      ...operands(expr).map((x) => subs(x, s)),
    ];

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
export function getSequence(
  expr: Expression | null | undefined
): ReadonlyArray<Expression> | null {
  if (expr === null || expr === undefined) return null;

  let h = operator(expr);
  if (h === 'Delimiter') {
    expr = operand(expr, 1);
    if (expr === null) return [];
    h = operator(expr);
    if (h !== 'Sequence') return [expr!];
  }

  if (h !== 'Sequence') return null;

  return operands(expr);
}

/** `Nothing` or the empty sequence (`["Sequence"]`) */
export function isEmptySequence(
  expr: Expression | null | undefined
): expr is null | undefined {
  if (expr === null || expr === undefined) return true;
  if (expr === 'Nothing') return true;
  return operator(expr) === 'Sequence' && nops(expr) === 0;
}

export function missingIfEmpty(
  expr: Expression | null | undefined
): Expression {
  return isEmptySequence(expr) ? MISSING : expr;
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

  const dict = dictionaryFromExpression(expr);
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

/** True if the string matches the expected pattern for a number */
export function matchesNumber(s: string): boolean {
  return (
    /^(nan|oo|\+oo|-oo|infinity|\+infinity|-infinity)$/i.test(s) ||
    /^[+-]?(0|[1-9][0-9]*)(\.[0-9]+)?(\([0-9]+\))?([eE][+-]?[0-9]+)?$/.test(s)
  );
}

/** True if the string matches the expected pattern for a symbol */
export function matchesSymbol(s: string): boolean {
  return (
    /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s) ||
    (s.length >= 2 && s[0] === '`' && s[s.length - 1] === '`')
  );
}

export function matchesString(s: string): boolean {
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") {
    return true;
  }

  return !matchesNumber(s) && !matchesSymbol(s);
}

function jsValueToExpression(v: any): Expression | null {
  if (typeof v === 'string') {
    return { str: v };
  } else if (typeof v === 'number') {
    return { num: v.toString() };
  } else if (typeof v === 'boolean') {
    return v ? 'True' : 'False';
  } else if (Array.isArray(v)) {
    return ['List', ...v.map((x) => jsValueToExpression(x) ?? 'Nothing')];
  } else if (v === null) {
    return null;
  } else if (typeof v === 'object') {
    const dict: Record<string, Expression> = {};
    for (const key in v) {
      dict[key] = jsValueToExpression(v[key]) ?? 'Nothing';
    }
    return { dict };
  }
  if (
    isFunctionObject(v) ||
    isSymbolObject(v) ||
    isNumberObject(v) ||
    isStringObject(v) ||
    isDictionaryObject(v)
  ) {
    return v as Expression;
  }
  return null;
}

function expressionToDictionaryValue(
  expr: Expression | null | undefined
): DictionaryValue | null {
  if (expr === null || expr === undefined) return null;
  if (isStringObject(expr)) return expr.str;
  if (isNumberObject(expr)) return parseFloat(expr.num);
  if (isSymbolObject(expr)) return expr.sym;

  if (typeof expr === 'string' || typeof expr === 'number') return expr;

  if (Array.isArray(expr)) return { fn: expr } as MathJsonFunctionObject;

  return expr;
}

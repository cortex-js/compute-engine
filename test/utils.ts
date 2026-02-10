import { MathJsonExpression as Expression } from '../src/math-json/types';
import { ParsingDiagnostic } from '../src/point-free-parser/parsers';
import { ComputeEngine } from '../src/compute-engine';

import { parseCortex } from '../src/cortex';
import { _BoxedExpression } from '../src/compute-engine/boxed-expression/abstract-boxed-expression';
import type { ExpressionInput } from '../src/compute-engine/global-types';

const MAX_LINE_LENGTH = 72;

let errors: string[] = [];

export const engine = new ComputeEngine();
engine.precision = 100; // Some arithmetic test cases assume a precision of at least 100

// Make sure that the symbol "f" is interpreted as a function in all test
// cases that use it.
engine.declare('f', 'function');

/**
 * Special printing utility for printing the *MathJson* representation - of either a boxed or
 * un-boxed expression.
 *
 * If a *BoxedExpression*, the **pretty** (prettified) MathJson representation is printed.
 *
 * Conveniently - prints on one line if expr. is less than local `MAX_LINE_LENGTH` (e.g. 72).
 *
 *
 *
 * @param expr
 * @param start
 * @returns
 */
function exprToStringRecursive(
  expr: ExpressionInput,
  start: number
): string {
  const indent = ' '.repeat(start);

  if (start > 50) return indent + '...';

  if (expr === null) return 'null';
  if (expr instanceof _BoxedExpression) {
    const ce = expr.engine;
    return exprToStringRecursive(
      ce.box(expr, { form: 'raw' }).toMathJson({ prettify: true }), // The default is 'prettify: true'
      start
    );
  }

  if (Array.isArray(expr)) {
    const elements = expr.map((x) => exprToStringRecursive(x, start + 2));
    const result = `[${elements.join(', ')}]`;
    if (start + result.length < MAX_LINE_LENGTH) return result;
    return `[\n${indent}  ${elements.join(`,\n${indent}  `)}\n${indent}]`;
  }
  if (typeof expr === 'object') {
    const elements = {};

    for (const key of Object.keys(expr)) {
      if (expr[key] instanceof _BoxedExpression) {
        elements[key] = exprToStringRecursive(
          expr[key] as ExpressionInput,
          start + 2
        );
      } else if (expr[key] === null) {
        elements[key] = 'null';
      } else if (expr[key] === undefined) {
        elements[key] = 'undefined';
      } else if (typeof expr[key] === 'object' && 'json' in expr[key]) {
        elements[key] = exprToStringRecursive(expr[key], start + 2);
      } else elements[key] = exprToStringRecursive(expr[key], start + 2);
    }

    const result = `{${Object.keys(expr)
      .map((key) => `${key}: ${elements[key]}`)
      .join('; ')}}`;
    if (start + result.length < MAX_LINE_LENGTH) return result;
    return (
      `{\n` +
      Object.keys(expr)
        .map((key) => `${indent}  ${key}: ${elements[key]}`)
        .join(`;\n${indent}`) +
      '\n' +
      indent +
      '}'
    );
  }
  if (typeof expr === 'string' && start === 0) return expr;
  if (typeof expr === 'string') return `"${expr}"`;

  return JSON.stringify(expr, null, 2);
}

export function exprToString(
  expr: ExpressionInput | null | undefined
): string {
  if (typeof expr === 'number') return expr.toString();
  if (!expr) return '';
  return exprToStringRecursive(expr, 0);
}

// export function parse(latex: string): string {
//   return exprToString(engine.parse(latex));
// }

export function evaluate(latex: string): string {
  return exprToString(engine.parse(latex)?.evaluate());
}

export function N(latex: string): string {
  return exprToString(engine.parse(latex)?.N());
}

export function simplify(latex: string): string {
  return exprToString(engine.parse(latex)?.simplify());
}

type ExprVariant =
  | 'box'
  | 'canonical'
  | 'simplify'
  | 'eval-auto'
  | 'eval-mach'
  | 'N-mach'
  | 'N-auto';

/**
 * Print various representations of the expression (non-canonical, canonical, various evaluated
 * forms...), formatted as **prettified** MathJson.
 *
 * \**Adjusts the precision*\*. For all representations aside from `eval-mach`, `N-mach`, exprs. are
 * printed with precision '*auto*' (may vary over time/depending on compute-engine version), else
 * '*machine*'.
 *
 * If the `canonical` variant is the same as `boxed` (non-canonical), or `simplify` equal to
 * `boxed`, then skip printing these variants.
 * Similarly, prints the `N-...` & `eval-...`variants only if they sufficiently differ from the
 * 'simplify' variant, or one-another.
 *
 * @export
 * @param inExpr
 * @param [variants]
 * @returns
 */
export function checkJson(
  inExpr: ExpressionInput | null,
  variants?: Array<ExprVariant>
): string {
  if (!inExpr) return 'null';
  const ce =
    inExpr instanceof _BoxedExpression
      ? inExpr.engine
      : engine; /* default test engine */
  const precision = ce.precision;
  try {
    ce.precision = 'auto';

    variants ??= [
      'box',
      'canonical',
      'simplify',
      'eval-auto',
      'eval-mach',
      'N-mach',
      'N-auto',
    ];

    const boxed = exprToString(ce.box(inExpr, { form: 'raw' }));

    const expr = ce.box(inExpr);

    if (!expr.isValid) return `invalid   =${exprToString(expr)}`;

    const canonical = exprToString(expr);

    const simplifyExpr = expr.simplify();
    const simplify = simplifyExpr.toString();
    const evalAuto = expr.evaluate().toString();
    const numEvalAuto = expr.N().toString();

    ce.precision = 'machine';
    const evalMachine = expr.evaluate().toString();
    const numEvalMachine = expr.N().toString();

    if (
      boxed === canonical &&
      simplifyExpr.isSame(expr) &&
      evalAuto === simplify &&
      evalAuto === evalMachine &&
      evalAuto === numEvalAuto &&
      evalAuto === numEvalMachine
    ) {
      return boxed;
    }

    const result: string[] = [];
    if (variants.includes('box')) result.push('box       = ' + boxed);

    if (canonical !== boxed && variants.includes('canonical'))
      result.push('canonical = ' + canonical);

    if (simplify !== expr.toString() && variants.includes('simplify'))
      result.push('simplify  = ' + simplify);

    if (
      (evalAuto !== simplify ||
        evalMachine !== evalAuto ||
        numEvalAuto !== evalAuto) &&
      variants.includes('eval-auto')
    )
      result.push('eval-auto = ' + evalAuto);

    if (
      evalMachine !== evalAuto ||
      (numEvalAuto !== evalAuto && variants.includes('eval-mach'))
    )
      result.push('eval-mach = ' + evalMachine);

    if (numEvalAuto !== evalAuto && variants.includes('N-auto'))
      result.push('N-auto    = ' + numEvalAuto);
    if (numEvalMachine !== evalMachine && variants.includes('N-mach'))
      result.push('N-mach    = ' + numEvalMachine);

    return result.join('\n');
  } finally {
    ce.precision = precision;
  }
}

export function check(latex: string, variants?: Array<ExprVariant>): string {
  return checkJson(engine.parse(latex, { form: 'raw' }), variants);
}

export function latex(expr: Expression | undefined | null): string {
  if (expr === undefined) return 'UNDEFINED';
  if (expr === null) return 'NULL';

  errors = [];
  let result = '';
  try {
    result = engine.box(expr)?.latex ?? 'NULL';
  } catch (e) {
    errors.push(e.toString());
  }
  if (result && errors.length !== 0) return result + '\n' + errors.join('\n');
  if (errors.length !== 0) return errors.join('\n');
  return result;
}

export function expressionError(latex: string): string | string[] {
  errors = [];
  engine.parse(latex);
  return errors.length === 1 ? errors[0] : errors;
}

function validJSONNumber(num: string | number) {
  if (typeof num === 'number') return num;
  const val = Number(num);
  if (num[0] === '+') num = num.slice(1);
  if (val.toString() === num) {
    // If the number roundtrips, it can be represented by a
    // JavaScript number
    // However, NaN and Infinity cannot be represented by JSON
    if (isNaN(val)) return 'NaN';
    if (!isFinite(val) && val < 0) return 'NegativeInfinity';
    if (!isFinite(val) && val > 0) return 'PositiveInfinity';
    return val;
  }
  return { num };
}

function strip(expr: Expression): Expression | null {
  if (typeof expr === 'number') return expr;
  if (typeof expr === 'string') {
    if (expr[0] === "'" && expr[expr.length - 1] === "'") {
      return { str: expr.slice(1, -1) };
    }
    return expr;
  }
  if (Array.isArray(expr))
    return expr.map(
      (x) => strip(x ?? 'Nothing') ?? 'Nothing'
    ) as any as Expression;

  if (typeof expr === 'object') {
    if ('num' in expr) return validJSONNumber(expr.num);
    if ('sym' in expr) return expr.sym;
    if ('fn' in expr) {
      return expr.fn.map(
        (x) => strip(x ?? 'Nothing') ?? 'Nothing'
      ) as any as Expression;
    }

    if ('str' in expr) return { str: expr.str };

    console.log('Unexpected object literal as an Expression');
  }

  return null;
}

function formatError(errors: ParsingDiagnostic[]): Expression {
  return [
    'Error',
    [
      'String',
      ...(errors.map((x) => {
        // If we have an array as the last element, it's the trace. Remove it.
        if (
          Array.isArray(x.message) &&
          Array.isArray(x.message[x.message.length - 1])
        ) {
          return x.message.slice(0, -1);
        }

        return x.message;
      }) as Expression[]),
    ],
  ];
}

export function validCortex(s: string): Expression | null {
  const [value, errors] = parseCortex(s);
  if (errors && errors.length > 0) return formatError(errors);
  return strip(value);
}

export function invalidCortex(s: string): Expression | null {
  const [value, errors] = parseCortex(s);
  if (errors && errors.length > 0) return formatError(errors);
  return ['UnexpectedSuccess', strip(value as Expression) ?? 'Missing'];
}

function memToString(n: number): string {
  if (n < 1024) return n.toFixed() + ' bytes';
  n /= 1024;
  if (n < 1024) return n.toFixed(1) + ' kB';
  n /= 1024;
  if (n < 1024) return n.toFixed(1) + ' MB';
  n /= 1024;
  if (n < 1024) return n.toFixed(1) + ' GB';
  n /= 1024;
  return n.toFixed(2) + ' TB';
}

function timeToString(t: number): string {
  if (t < 1000) return t.toFixed(2) + ' ms';
  t /= 1000;
  return t.toFixed(2) + ' s';
}

export function benchmark(
  fn: () => void,
  expected?: { time: number; mem: number; exprs: number }
) {
  const startMem = process.memoryUsage().heapUsed;
  const start = globalThis.performance.now();

  fn();

  const end = globalThis.performance.now();
  const endMem = process.memoryUsage().heapUsed;

  const delta = {
    time: end - start,
    mem: endMem - startMem,
  };
  if (!expected) {
    console.log('mem:', delta.mem, ', time:', delta.time.toFixed(2));
    return 1000;
  }

  // Memory is not a reliable measurement because of unpredictable GC
  const variance = delta.time / expected.time - 1;

  if (true || Math.abs(variance) > 0.1) {
    console.error(
      `\u001b[0mVariance ${(variance * 100).toFixed(1)}% (actual vs expected)`,
      `\n     mem ${emoji(delta.mem, expected.mem)}` +
        `${memToString(delta.mem)} (${memToString(expected.mem)} ${Number(
          (100 * delta.mem) / expected.mem
        ).toFixed(2)}%)` +
        `\n    time ${emoji(delta.time, expected.time)}`,
      `${timeToString(delta.time)} (${timeToString(expected.time)} ${Number(
        (100 * delta.time) / expected.time
      ).toFixed(2)}%)`
    );
  }
  return variance;
}

function emoji(a, b): string {
  if (a === b) return '✅';
  if (a < b) return '\u001b[32m\u25BC\u001b[0m'; // green up triangle
  return '\u001b[31m\u25B2\u001b[0m';
}

//
// Custom serializers for Jest
//

// beforeEach(() => {
//   jest.spyOn(console, 'assert').mockImplementation((assertion) => {
//     if (!assertion) debugger;
//   });
//   jest.spyOn(console, 'log').mockImplementation(() => {
//     debugger;
//   });
//   jest.spyOn(console, 'warn').mockImplementation(() => {
//     debugger;
//   });
//   jest.spyOn(console, 'info').mockImplementation(() => {
//     debugger;
//   });
// });

// Serializer for Boxed Expressions
expect.addSnapshotSerializer({
  // Is the value to serialize an instance of the BoxedExpression class?
  test: (val): boolean => val && val instanceof _BoxedExpression,

  serialize: (val, _config, _indentation, _depth, _refs, _printer): string =>
    exprToString(val),
});

// Serializer for strings: output without quotes
expect.addSnapshotSerializer({
  test: (val): boolean => typeof val === 'string',
  serialize: (val) => val,
});

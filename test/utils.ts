import type { Expression } from '../src/math-json/math-json-format';
import { ParsingDiagnostic } from '../src/point-free-parser/parsers';
import { ComputeEngine, SemiBoxedExpression } from '../src/compute-engine';

import { parseCortex } from '../src/cortex';
import { _BoxedExpression } from '../src/compute-engine/boxed-expression/abstract-boxed-expression';

const MAX_LINE_LENGTH = 72;

let errors: string[] = [];

export const engine = new ComputeEngine();
engine.precision = 100; // Some arithmetic test cases assume a precision of at least 100

engine.assume(['Element', 'f', 'Functions']);

function exprToStringRecursive(expr: SemiBoxedExpression, start: number) {
  const indent = ' '.repeat(start);

  if (start > 50) return indent + '...';

  if (expr === null) return 'null';
  if (expr instanceof _BoxedExpression) {
    return exprToStringRecursive(
      engine.box(expr, { canonical: false }).toMathJson(),
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
        elements[key] = exprToStringRecursive(expr[key], start + 2);
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
  expr: SemiBoxedExpression | null | undefined
): string {
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

export function checkJson(inExpr: SemiBoxedExpression | null): string {
  if (!inExpr) return 'null';
  try {
    const precision = engine.precision;
    engine.numericMode = 'auto';

    const boxed = exprToString(engine.box(inExpr, { canonical: false }));

    const expr = engine.box(inExpr);
    const canonical = exprToString(expr);
    const simplify = exprToString(expr.simplify());

    const evaluate = exprToString(expr.evaluate());
    const numEvalAuto = exprToString(expr.N());
    engine.numericMode = 'bignum';

    engine.precision = precision;
    const evalBignum = exprToString(engine.box(inExpr).evaluate());
    const numEvalBignum = exprToString(engine.box(inExpr).N());
    exprToString;
    engine.numericMode = 'machine';
    const evalMachine = exprToString(engine.box(inExpr).evaluate());
    const numEvalMachine = exprToString(engine.box(inExpr).N());

    engine.numericMode = 'complex';
    const evalComplex = exprToString(engine.box(inExpr).evaluate());
    const numEvalComplex = exprToString(engine.box(inExpr).N());

    engine.numericMode = 'auto';
    engine.precision = precision;

    if (
      boxed === canonical &&
      boxed === simplify &&
      boxed === evaluate &&
      evalMachine === evaluate &&
      evalBignum === evaluate &&
      evalComplex === evaluate &&
      boxed === numEvalAuto &&
      boxed === numEvalMachine &&
      boxed === numEvalBignum &&
      boxed === numEvalComplex
    ) {
      return boxed;
    }

    const result = ['box       = ' + boxed];

    if (canonical !== boxed) result.push('canonical = ' + canonical);
    if (simplify !== canonical) result.push('simplify  = ' + simplify);
    if (
      evaluate !== simplify ||
      evalMachine !== evaluate ||
      evalBignum !== evaluate ||
      evalComplex !== evaluate
    )
      result.push('evaluate  = ' + evaluate);
    if (numEvalAuto !== evaluate) result.push('N-auto    = ' + numEvalAuto);

    if (evalBignum !== evaluate) result.push('eval-big  = ' + evalBignum);
    if (numEvalBignum !== numEvalAuto && numEvalBignum !== evalBignum)
      result.push('N-big     = ' + numEvalBignum);

    if (evalMachine !== evaluate) result.push('eval-mach = ' + evalMachine);
    if (numEvalMachine !== numEvalBignum && numEvalMachine !== evalMachine)
      result.push('N-mach    = ' + numEvalMachine);

    if (evalComplex !== evalMachine) result.push('eval-cplx = ' + evalComplex);
    if (numEvalComplex !== numEvalMachine && numEvalComplex !== evalComplex)
      result.push('N-cplx    = ' + numEvalComplex);

    return result.join('\n');
  } catch (e) {
    return e.toString();
  }
}

export function check(latex: string): string {
  return checkJson(engine.parse(latex, { canonical: false }));
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
    return expr.map((x) => strip(x ?? 'Nothing') ?? 'Nothing') as Expression;

  if (typeof expr === 'object') {
    if ('num' in expr) return validJSONNumber(expr.num);
    if ('sym' in expr) return expr.sym;
    if ('fn' in expr) {
      return expr.fn.map(
        (x) => strip(x ?? 'Nothing') ?? 'Nothing'
      ) as Expression;
    }
    if ('dict' in expr) {
      return {
        dict: Object.fromEntries(
          Object.entries(expr.dict).map((keyValue) => {
            return [keyValue[0], strip(keyValue[1]) ?? 'Nothing'];
          })
        ),
      };
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
  const startHighwatermark = engine.stats.highwaterMark;
  const startMem = process.memoryUsage().heapUsed;
  const start = globalThis.performance.now();

  fn();

  const end = globalThis.performance.now();
  const endMem = process.memoryUsage().heapUsed;
  const stats = engine.stats;

  const delta = {
    time: end - start,
    mem: endMem - startMem,
    exprs: stats.highwaterMark - startHighwatermark,
  };
  if (!expected) {
    console.log(
      'mem:',
      delta.mem,
      ', time:',
      delta.time.toFixed(2),
      ', exprs:',
      delta.exprs
    );
    return 1000;
  }

  if (stats['_dupeSymbols'])
    console.log(
      'Dupe symbols\n',
      stats['_dupeSymbols'].map(([k, v]) => '  ' + k + ': ' + v).join('\n')
    );

  if (stats['_popularExpressions'])
    console.log(
      'Popular expressions\n',
      stats['_popularExpressions']
        .map(([k, v]) => '  ' + k + ': ' + v)
        .join('\n')
    );

  // Memory is not a reliable measurement because of unpredictable GC
  const variance =
    Math.max(delta.time / expected.time, delta.exprs / expected.exprs) - 1;

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
      ).toFixed(2)}%)` + `\n   exprs ${emoji(delta.exprs, expected.exprs)}`,
      `${delta.exprs} (${expected.exprs} ${Number(
        (100 * delta.exprs) / expected.exprs
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

import type { Expression } from '../src/math-json/math-json-format';
import { ParsingDiagnostic } from '../src/point-free-parser/parsers';
import { BoxedExpression, ComputeEngine } from '../src/compute-engine';
import { parseCortex } from '../src/cortex';
import { LatexSyntax } from '../src/compute-engine/latex-syntax/latex-syntax';
import { AbstractBoxedExpression } from '../src/compute-engine/boxed-expression/abstract-boxed-expression';

let errors: string[] = [];

export const engine = new ComputeEngine();

// const defaultLatex = new LatexSyntax({
//   onError: (warnings) => {
//     for (const warning of warnings) errors.push(warning.message.toString());
//   },
// });
const rawLatex = new LatexSyntax({
  computeEngine: engine,
  parseArgumentsOfUnknownLatexCommands: false,
  parseUnknownSymbol: () => 'symbol',
  applyInvisibleOperator: null,
  dictionary: [],
});

export function boxToJson(expr: Expression): Expression {
  return engine.box(expr).json;
}

export function parseToJson(latex: string): Expression {
  return engine.parse(latex).json;
}

export function canonicalToJson(latex: string): Expression {
  return engine.parse(latex).canonical.json;
}

export function evaluateToJson(latex: string): Expression {
  return engine.parse(latex).evaluate()?.json ?? 'NULL';
}

export function simplifyToJson(latex: string): Expression {
  return engine.parse(latex).simplify().json;
}

export function NToJson(latex: string): Expression {
  return engine.parse(latex).N()?.json ?? `NULL`;
}

export function expand(latex: string): Expression {
  const expr = engine.parse(latex);
  return engine.fn('Expand', [expr]).evaluate().json;
}

export function latexToJson(expr: Expression | undefined | null): Expression {
  if (expr === undefined) return 'UNDEFINED';
  if (expr === null) return 'NULL';

  errors = [];
  let result = '';
  try {
    result = engine.box(expr).latex ?? 'NULL';
  } catch (e) {
    errors.push(e.toString());
  }
  if (errors.length !== 0) return ['Error', errors.join('\n'), result];
  return result;
}

const MAX_LINE_LENGTH = 72;

function exprToStringRecursive(expr, start) {
  const indent = ' '.repeat(start);
  if (Array.isArray(expr)) {
    const elements = expr.map((x) => exprToStringRecursive(x, start + 2));
    const result = `[${elements.join(', ')}]`;
    if (start + result.length < MAX_LINE_LENGTH) return result;
    return `[\n${indent}  ${elements.join(`,\n${indent}  `)}\n${indent}]`;
  }
  if (expr === null) return 'null';
  if (typeof expr === 'object') {
    const elements = {};
    Object.keys(expr).forEach(
      (x) => (elements[x] = exprToStringRecursive(expr[x], start + 2))
    );
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

export function exprToString(expr: BoxedExpression | null): string {
  if (!expr) return '';
  return exprToStringRecursive(expr.json, 0);
}

export function box(expr: Expression): string {
  return exprToString(engine.box(expr));
}

export function parse(latex: string): string {
  return exprToString(engine.parse(latex));
}

export function canonical(latex: string): string {
  return exprToString(engine.parse(latex)?.canonical);
}

export function evaluate(latex: string): string {
  return exprToString(engine.parse(latex)?.evaluate());
}

export function N(latex: string): string {
  return exprToString(engine.parse(latex)?.N());
}

export function check(latex: string): string {
  try {
    const expr = engine.parse(latex);
    const boxed = printExpression(expr.json);
    const canonical = printExpression(expr.canonical.json);
    const simplify = printExpression(expr.simplify().json);
    const evaluate = printExpression(expr.evaluate().json);
    const numEval = printExpression(expr.N().json);

    if (
      boxed === canonical &&
      boxed === simplify &&
      boxed === evaluate &&
      boxed === numEval
    ) {
      return boxed;
    }

    const result = ['box      = ' + boxed];
    if (canonical !== boxed) result.push('canonical = ' + canonical);
    if (simplify !== canonical) result.push('simplify  = ' + simplify);
    if (evaluate !== simplify) result.push('evaluate  = ' + evaluate);
    if (numEval !== evaluate) result.push('N         = ' + numEval);
    return result.join('\n');
  } catch (e) {
    return e.toString();
  }
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

export function rawExpression(latex: string): Expression {
  errors = [];
  return JSON.stringify(engine.box(rawLatex.parse(latex)).json, null, 2);
}

export function printExpression(expr: Expression): string {
  return exprToStringRecursive(expr, 0);
}

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
expect.addSnapshotSerializer({
  // test: (val): boolean => Array.isArray(val) || typeof val === 'object',
  test: (_val): boolean => true,

  serialize: (val, _config, _indentation, _depth, _refs, _printer): string => {
    if (val instanceof AbstractBoxedExpression)
      return printExpression(val.json);
    return printExpression(val);
  },
});

function isValidJSONNumber(num: string): string | number {
  if (typeof num === 'string') {
    const val = Number(num);
    if (num[0] === '+') num = num.slice(1);
    if (val.toString() === num) {
      // If the number roundtrips, it can be represented by a
      // JavaScript number
      // However, NaN and Infinity cannot be represented by JSON
      if (isNaN(val)) return 'NaN';
      if (!isFinite(val) && val < 0) return '-Infinity';
      if (!isFinite(val) && val > 0) return '+Infinity';
      return val;
    }
  }
  return num;
}

export function strip(expr: Expression): Expression | null {
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
    if ('num' in expr) {
      const val = isValidJSONNumber(expr.num);
      if (typeof val === 'number') return val;
      return { num: val };
    } else if ('sym' in expr) {
      return expr.sym;
    } else if ('fn' in expr) {
      return expr.fn.map(
        (x) => strip(x ?? 'Nothing') ?? 'Nothing'
      ) as Expression;
    } else if ('dict' in expr) {
      return {
        dict: Object.fromEntries(
          Object.entries(expr.dict).map((keyValue) => {
            return [keyValue[0], strip(keyValue[1]) ?? 'Nothing'];
          })
        ),
      };
    } else if ('str' in expr) {
      return { str: expr.str };
    } else {
      console.log('Unexpected object literal as an Expression');
    }
  }

  return null;
}

export function formatError(errors: ParsingDiagnostic[]): Expression {
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
    1.0 - Math.max(delta.time / expected.time, delta.exprs / expected.exprs);

  if (true || Math.abs(variance) > 0.1) {
    console.error(
      `Variance ${(variance * 100).toFixed(1)}%`,
      '\n   mem:',
      `${memToString(delta.mem)} (${memToString(expected.mem)} ${Number(
        (100 * delta.mem) / expected.mem
      ).toFixed(2)} %)`,
      '\n   time:',
      `${timeToString(delta.time)} (${timeToString(expected.time)} ${Number(
        (100 * delta.time) / expected.time
      ).toFixed(2)} %)`,
      '\n   exprs:',
      `${delta.exprs} (${expected.exprs} ${Number(
        (100 * delta.exprs) / expected.exprs
      ).toFixed(2)} %)`
    );
  }
  return variance;
}

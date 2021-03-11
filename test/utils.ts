import type { Expression } from '../src/public';
import { LatexSyntax, ComputeEngine, parseCortex } from '../src/math-json';
import { Form } from '../src/compute-engine/public';

let errors: string[] = [];

const defaultLatex = new LatexSyntax({
  onError: (err) => errors.push(err.code + (err.arg ? ' ' + err.arg : '')),
});
const rawLatex = new LatexSyntax({
  invisibleOperator: '',
  parseArgumentsOfUnknownLatexCommands: false,
  invisiblePlusOperator: '',
  promoteUnknownSymbols: /./,
  dictionary: [],
});
export const engine = new ComputeEngine();
export function expression(
  latex: string,
  options?: { form: Form }
): Expression {
  errors = [];
  const result = engine.format(defaultLatex.parse(latex), options?.form);
  errors = errors.filter((x) => !/^unknown-symbol /.test(x));
  if (errors.length !== 0) return [result, ...errors];
  return result;
}

export function latex(expr: Expression): string {
  errors = [];
  const result = defaultLatex.serialize(expr);
  errors = errors.filter((x) => !/^unknown-symbol /.test(x));
  if (errors.length !== 0) return errors.join('\n');
  return result;
}

export function expressionError(latex: string): string | string[] {
  errors = [];
  defaultLatex.parse(latex);
  return errors.length === 1 ? errors[0] : errors;
}

export function rawExpression(latex: string): Expression {
  errors = [];
  return JSON.stringify(engine.format(rawLatex.parse(latex), ['full']));
}

export function printExpression(expr: Expression): string {
  if (Array.isArray(expr)) {
    return '[' + expr.map((x) => printExpression(x)).join(', ') + ']';
  }
  if (typeof expr === 'string') {
    if (!expr) return "''";
    return "'" + expr + "'";
  }
  if (typeof expr === 'undefined') {
    return 'undefined';
  }
  if (expr === null) {
    return 'null';
  }
  if (typeof expr === 'object') {
    return (
      '{' +
      Object.keys(expr)
        .map((x) => x + ': ' + printExpression(expr[x]))
        .join(', ') +
      '}'
    );
  }
  return expr.toString();
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
      if (isNaN(val) || !isFinite(val)) {
        return val.toString();
      }
      return val;
    }
  }
  return num;
}

export function strip(expr: Expression): Expression {
  if (typeof expr === 'number') return expr;
  if (typeof expr === 'string') {
    if (expr[0] === "'" && expr[expr.length - 1] === "'") {
      return { str: expr.slice(1, -1) };
    }
    return expr;
  }
  if (Array.isArray(expr)) return expr.map((x) => strip(x));

  if (typeof expr === 'object') {
    if ('num' in expr) {
      const val = isValidJSONNumber(expr.num);
      if (typeof val === 'number') return val;
      return { num: val };
    } else if ('sym' in expr) {
      return expr.sym;
    } else if ('fn' in expr) {
      return expr.fn.map((x) => strip(x));
    } else if ('dict' in expr) {
      return {
        dict: Object.fromEntries(
          Object.entries(expr.dict).map((keyValue) => {
            return [keyValue[0], strip(keyValue[1])];
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

export function validCortex(s: string): Expression {
  const [value, errors] = parseCortex(s);
  if (errors && errors.length > 0) {
    return ['Error', ...errors.map((x) => x.message)];
  }
  return strip(value);
}

export function invalidCortex(s: string): Expression {
  const [value, errors] = parseCortex(s);
  if (errors && errors.length > 0) {
    return ['Error', ...errors.map((x) => x.message)];
  }
  return ['UnexpectedSuccess', strip(value as Expression)];
}

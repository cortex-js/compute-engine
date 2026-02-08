import type { BoxedExpression } from '../global-types';
import type { MathJsonSymbol } from '../../math-json/types';
import { isBoxedSymbol, isBoxedFunction } from '../boxed-expression/type-guards';

import { chop, factorial, gcd, lcm, limit } from '../numerics/numeric';
import { gamma, gammaln } from '../numerics/special-functions';
import {
  interquartileRange,
  kurtosis,
  mean,
  median,
  mode,
  populationStandardDeviation,
  populationVariance,
  quartiles,
  skewness,
  standardDeviation,
  variance,
} from '../numerics/statistics';
import { monteCarloEstimate } from '../numerics/monte-carlo';
import { normalizeIndexingSet } from '../library/utils';

import { BaseCompiler } from './base-compiler';
import type {
  CompileTarget,
  CompiledOperators,
  CompiledFunctions,
  LanguageTarget,
  CompilationOptions,
  CompilationResult,
} from './types';

/**
 * JavaScript operator mappings
 */
const JAVASCRIPT_OPERATORS: CompiledOperators = {
  Add: ['+', 11],
  Negate: ['-', 14], // Unary operator
  Subtract: ['-', 11],
  Multiply: ['*', 12],
  Divide: ['/', 13],
  Equal: ['===', 8],
  NotEqual: ['!==', 8],
  LessEqual: ['<=', 9],
  GreaterEqual: ['>=', 9],
  Less: ['<', 9],
  Greater: ['>', 9],
  And: ['&&', 4],
  Or: ['||', 3],
  Not: ['!', 14], // Unary operator
};

/**
 * JavaScript function implementations
 */
const JAVASCRIPT_FUNCTIONS: CompiledFunctions = {
  Abs: 'Math.abs',
  Add: (args, compile) => {
    if (args.length === 1) return compile(args[0]);
    return `(${args.map((x) => compile(x)).join(' + ')})`;
  },
  Arccos: 'Math.acos',
  Arcosh: 'Math.acosh',
  Arccot: ([x], compile) => {
    if (x === null) throw new Error('Arccot: no argument');
    return `Math.atan(1 / (${compile(x)}))`;
  },
  Arcoth: ([x], compile) => {
    if (x === null) throw new Error('Arcoth: no argument');
    return `Math.atanh(1 / (${compile(x)}))`;
  },
  Arccsc: ([x], compile) => {
    if (x === null) throw new Error('Arccsc: no argument');
    return `Math.asin(1 / (${compile(x)}))`;
  },
  Arcsch: ([x], compile) => {
    if (x === null) throw new Error('Arcsch: no argument');
    return `Math.asinh(1 / (${compile(x)}))`;
  },
  Arcsec: ([x], compile) => {
    if (x === null) throw new Error('Arcsec: no argument');
    return `Math.acos(1 / (${compile(x)}))`;
  },
  Arsech: ([x], compile) => {
    if (x === null) throw new Error('Arsech: no argument');
    return `Math.acosh(1 / (${compile(x)}))`;
  },
  Arcsin: 'Math.asin',
  Arsinh: 'Math.asinh',
  Arctan: 'Math.atan',
  Artanh: 'Math.atanh',
  Ceil: 'Math.ceil',
  Chop: '_SYS.chop',
  Cos: 'Math.cos',
  Cosh: 'Math.cosh',
  Cot: ([x], compile) => {
    if (x === null) throw new Error('Cot: no argument');
    return BaseCompiler.inlineExpression(
      'Math.cos(${x}) / Math.sin(${x})',
      compile(x)
    );
  },
  Coth: ([x], compile) => {
    if (x === null) throw new Error('Coth: no argument');
    return BaseCompiler.inlineExpression(
      '(Math.cosh(${x}) / Math.sinh(${x}))',
      compile(x)
    );
  },
  Csc: ([x], compile) => {
    if (x === null) throw new Error('Csc: no argument');
    return `1 / Math.sin(${compile(x)})`;
  },
  Csch: ([x], compile) => {
    if (x === null) throw new Error('Csch: no argument');
    return `1 / Math.sinh(${compile(x)})`;
  },
  Exp: 'Math.exp',
  Floor: 'Math.floor',
  Fract: ([x], compile) => {
    if (x === null) throw new Error('Fract: no argument');
    return BaseCompiler.inlineExpression('${x} - Math.floor(${x})', compile(x));
  },
  Gamma: '_SYS.gamma',
  GCD: '_SYS.gcd',
  Integrate: (args, compile, target) => compileIntegrate(args, compile, target),
  LCM: '_SYS.lcm',
  Limit: (args, compile) =>
    `_SYS.limit(${compile(args[0])}, ${compile(args[1])})`,
  Ln: 'Math.log',
  List: (args, compile) => `[${args.map((x) => compile(x)).join(', ')}]`,
  Log: (args, compile) => {
    if (args.length === 1) return `Math.log10(${compile(args[0])})`;
    return `(Math.log(${compile(args[0])}) / Math.log(${compile(args[1])}))`;
  },
  GammaLn: '_SYS.lngamma',
  Lb: 'Math.log2',
  Max: 'Math.max',
  Mean: (args, compile) => {
    if (args.length === 0) return 'NaN';
    if (args.length === 1) return `_SYS.mean(${compile(args[0])})`;
    return `_SYS.mean([${args.map((x) => compile(x)).join(', ')}])`;
  },
  Median: (args, compile) => {
    if (args.length === 0) return 'NaN';
    if (args.length === 1) return `_SYS.median(${compile(args[0])})`;
    return `_SYS.median([${args.map((x) => compile(x)).join(', ')}])`;
  },
  Variance: (args, compile) => {
    if (args.length === 0) return 'NaN';
    if (args.length === 1) return `_SYS.variance(${compile(args[0])})`;
    return `_SYS.variance([${args.map((x) => compile(x)).join(', ')}])`;
  },
  PopulationVariance: (args, compile) => {
    if (args.length === 0) return 'NaN';
    if (args.length === 1)
      return `_SYS.populationVariance(${compile(args[0])})`;
    return `_SYS.populationVariance([${args.map((x) => compile(x)).join(', ')}])`;
  },
  StandardDeviation: (args, compile) => {
    if (args.length === 0) return 'NaN';
    if (args.length === 1) return `_SYS.standardDeviation(${compile(args[0])})`;
    return `_SYS.standardDeviation([${args.map((x) => compile(x)).join(', ')}])`;
  },
  PopulationStandardDeviation: (args, compile) => {
    if (args.length === 0) return 'NaN';
    if (args.length === 1)
      return `_SYS.populationStandardDeviation(${compile(args[0])})`;
    return `_SYS.populationStandardDeviation([${args.map((x) => compile(x)).join(', ')}])`;
  },
  Kurtosis: (args, compile) => {
    if (args.length === 0) return 'NaN';
    if (args.length === 1) return `_SYS.kurtosis(${compile(args[0])})`;
    return `_SYS.kurtosis([${args.map((x) => compile(x)).join(', ')}])`;
  },
  Skewness: (args, compile) => {
    if (args.length === 0) return 'NaN';
    if (args.length === 1) return `_SYS.skewness(${compile(args[0])})`;
    return `_SYS.skewness([${args.map((x) => compile(x)).join(', ')}])`;
  },
  Mode: (args, compile) => {
    if (args.length === 0) return 'NaN';
    if (args.length === 1) return `_SYS.mode(${compile(args[0])})`;
    return `_SYS.mode([${args.map((x) => compile(x)).join(', ')}])`;
  },
  Quartiles: (args, compile) => {
    if (args.length === 0) return 'NaN';
    if (args.length === 1) return `_SYS.quartiles(${compile(args[0])})`;
    return `_SYS.quartiles([${args.map((x) => compile(x)).join(', ')}])`;
  },
  InterquartileRange: (args, compile) => {
    if (args.length === 0) return 'NaN';
    if (args.length === 1)
      return `_SYS.interquartileRange(${compile(args[0])})`;
    return `_SYS.interquartileRange([${args.map((x) => compile(x)).join(', ')}])`;
  },
  Min: 'Math.min',
  Power: (args, compile) => {
    const arg = args[0];
    if (arg === null) throw new Error('Power: no argument');
    const exp = args[1].re;
    if (exp === 0.5) return `Math.sqrt(${compile(arg)})`;
    if (exp === 1 / 3) return `Math.cbrt(${compile(arg)})`;
    if (exp === 1) return compile(arg);
    if (exp === -1) return `(1 / (${compile(arg)}))`;
    if (exp === -0.5) return `(1 / Math.sqrt(${compile(arg)}))`;
    return `Math.pow(${compile(arg)}, ${compile(args[1])})`;
  },
  Range: (args, compile) => {
    if (args.length === 0) return '[]';
    if (args.length === 1)
      return `Array.from({length: ${compile(args[0])}}, (_, i) => i)`;

    let start = compile(args[0]);
    let stop = compile(args[1]);
    const step = args[2] ? compile(args[2]) : '1';
    if (start === null) throw new Error('Range: no start');
    if (stop === null) {
      stop = start;
      start = '1';
    }
    if (step === '0') throw new Error('Range: step cannot be zero');
    if (parseFloat(step) === 1.0) {
      const fStop = parseFloat(stop);
      const fStart = parseFloat(start);

      if (fStop !== null && fStart !== null) {
        if (fStop - fStart < 50) {
          return `[${Array.from(
            { length: fStop - fStart + 1 },
            (_, i) => fStart + i
          ).join(', ')}]`;
        }
        return `Array.from({length: ${fStop - fStart + 1} 
        }, (_, i) => ${start} + i)`;
      }

      return `Array.from({length: ${stop} - ${start} + 1
      }, (_, i) => ${start} + i)`;
    }
    return `Array.from({length: Math.floor((${stop} - ${start}) / ${step}) + 1}, (_, i) => ${start} + i * ${step})`;
  },
  Root: ([arg, exp], compile) => {
    if (arg === null) throw new Error('Root: no argument');
    if (exp === null) return `Math.sqrt(${compile(arg)})`;
    if (exp?.re === 2) return `Math.sqrt(${compile(arg)})`;
    if (exp?.re === 3) return `Math.cbrt(${compile(arg)})`;
    if (!isNaN(exp?.re)) return `Math.pow(${compile(arg)},  ${1 / exp.re})`;
    return `Math.pow(${compile(arg)}, 1 / (${compile(exp)}))`;
  },
  Random: 'Math.random',
  Round: 'Math.round',
  Square: (args, compile) => {
    const arg = args[0];
    if (arg === null) throw new Error('Square: no argument');
    return `Math.pow(${compile(arg)}, 2)`;
  },
  Sec: (args, compile) => {
    const arg = args[0];
    if (arg === null) throw new Error('Sec: no argument');
    return `1 / Math.cos(${compile(arg)})`;
  },
  Sech: (args, compile) => {
    const arg = args[0];
    if (arg === null) throw new Error('Sech: no argument');
    return `1 / Math.cosh(${compile(arg)})`;
  },
  Sign: 'Math.sign',
  Sin: 'Math.sin',
  Sinh: 'Math.sinh',
  Sqrt: 'Math.sqrt',
  Tan: 'Math.tan',
  Tanh: 'Math.tanh',
  Mod: ([a, b], compile) => {
    if (a === null || b === null) throw new Error('Mod: missing argument');
    const ca = compile(a);
    const cb = compile(b);
    return `((${ca} % ${cb}) + ${cb}) % ${cb}`;
  },
  Truncate: 'Math.trunc',
  Remainder: ([a, b], compile) => {
    if (a === null || b === null)
      throw new Error('Remainder: missing argument');
    return `(${compile(a)} - ${compile(b)} * Math.round(${compile(a)} / ${compile(b)}))`;
  },
};

/**
 * JavaScript-specific function extension that provides system functions
 */
export class ComputeEngineFunction extends Function {
  SYS = {
    chop: chop,
    factorial: factorial,
    gamma: gamma,
    gcd: gcd,
    integrate: (f, a, b) => monteCarloEstimate(f, a, b, 10e6).estimate,
    lcm: lcm,
    lngamma: gammaln,
    limit: limit,
    mean,
    median,
    variance,
    populationVariance,
    standardDeviation,
    populationStandardDeviation,
    kurtosis,
    skewness,
    mode,
    quartiles,
    interquartileRange,
  };

  constructor(body: string, preamble = '') {
    super(
      '_SYS',
      '_',
      preamble ? `${preamble};return ${body}` : `return ${body}`
    );
    return new Proxy(this, {
      apply: (target, thisArg, argumentsList) =>
        super.apply(thisArg, [this.SYS, ...argumentsList]),
      get: (target, prop) => {
        if (prop === 'toString') return (): string => body;
        if (prop === 'isCompiled') return true;
        return target[prop];
      },
    });
  }
}

/**
 * JavaScript function literal with parameters
 */
export class ComputeEngineFunctionLiteral extends Function {
  SYS = {
    chop: chop,
    factorial: factorial,
    gamma: gamma,
    gcd: gcd,
    integrate: (f, a, b) => monteCarloEstimate(f, a, b, 10e6).estimate,
    lcm: lcm,
    lngamma: gammaln,
    limit: limit,
    mean,
    median,
    variance,
    populationVariance,
    standardDeviation,
    populationStandardDeviation,
    kurtosis,
    skewness,
    mode,
    quartiles,
    interquartileRange,
  };

  constructor(body: string, args: string[]) {
    super('_SYS', ...args, `return ${body}`);
    return new Proxy(this, {
      apply: (target, thisArg, argumentsList) =>
        super.apply(thisArg, [this.SYS, ...argumentsList]),
      get: (target, prop) => {
        if (prop === 'toString')
          return (): string => `(${args.join(', ')}) => ${body}`;
        if (prop === 'isCompiled') return true;
        return target[prop];
      },
    });
  }
}

/**
 * JavaScript language target implementation
 */
export class JavaScriptTarget implements LanguageTarget {
  getOperators(): CompiledOperators {
    return JAVASCRIPT_OPERATORS;
  }

  getFunctions(): CompiledFunctions {
    return JAVASCRIPT_FUNCTIONS;
  }

  createTarget(options: Partial<CompileTarget> = {}): CompileTarget {
    return {
      language: 'javascript',
      operators: (op) => JAVASCRIPT_OPERATORS[op],
      functions: (id) => JAVASCRIPT_FUNCTIONS[id],
      var: (id) => {
        const result = {
          Pi: 'Math.PI',
          ExponentialE: 'Math.E',
          NaN: 'Number.NaN',
          ImaginaryUnit: 'Number.NaN',
          Half: '0.5',
          MachineEpsilon: 'Number.EPSILON',
          GoldenRatio: '((1 + Math.sqrt(5)) / 2)',
          CatalanConstant: '0.91596559417721901',
          EulerGamma: '0.57721566490153286',
        }[id];
        return result;
      },
      string: (str) => JSON.stringify(str),
      number: (n) => n.toString(),
      indent: 0,
      ws: (s?: string) => s ?? '',
      preamble: '',
      ...options,
    };
  }

  compile(
    expr: BoxedExpression,
    options: CompilationOptions = {}
  ): CompilationResult {
    const { operators, functions, vars, imports = [], preamble } = options;
    const unknowns = expr.unknowns;

    // Process imports
    let preambleImports = imports
      .map((x) => {
        if (typeof x === 'function') return x.toString();
        throw new Error(`Unsupported import \`${x}\``);
      })
      .join('\n');

    // Process custom functions
    const namedFunctions: { [k: string]: string } = {};

    if (functions) {
      for (const [k, v] of Object.entries(functions)) {
        if (typeof v === 'function') {
          if (isTrulyNamed(v)) {
            preambleImports += `${v.toString()};\n`;
            namedFunctions[k] = v.name;
          } else {
            preambleImports += `const ${k} = ${v.toString()};\n`;
            namedFunctions[k] = k;
          }
        } else if (typeof v === 'string') {
          // Function is referenced by name (should be in imports)
          namedFunctions[k] = v;
        }
      }
    }

    // Create operator lookup function
    const operatorLookup = (op: MathJsonSymbol) => {
      // Check custom operators first
      if (operators) {
        const customOp =
          typeof operators === 'function'
            ? operators(op)
            : operators[op as keyof typeof operators];
        if (customOp) return customOp;
      }
      // Fall back to default JavaScript operators
      return JAVASCRIPT_OPERATORS[op];
    };

    const target = this.createTarget({
      operators: operatorLookup,
      functions: (id) =>
        namedFunctions?.[id] ? namedFunctions[id] : JAVASCRIPT_FUNCTIONS[id],
      var: (id) => {
        if (vars && id in vars) return JSON.stringify(vars[id]);
        const result = {
          Pi: 'Math.PI',
          ExponentialE: 'Math.E',
          NaN: 'Number.NaN',
          ImaginaryUnit: 'Number.NaN',
          Half: '0.5',
          MachineEpsilon: 'Number.EPSILON',
          GoldenRatio: '((1 + Math.sqrt(5)) / 2)',
          CatalanConstant: '0.91596559417721901',
          EulerGamma: '0.57721566490153286',
        }[id];
        if (result !== undefined) return result;
        if (unknowns.includes(id)) return `_.${id}`;
        return undefined;
      },
      preamble: (preamble ?? '') + preambleImports,
    });

    return compileToTarget(expr, target);
  }
}

/**
 * Compile expression to JavaScript executable
 */
function compileToTarget(
  expr: BoxedExpression,
  target: CompileTarget
): CompilationResult {
  if (expr.operator === 'Function' && isBoxedFunction(expr)) {
    const args = expr.ops;
    const params = args.slice(1).map((x) => isBoxedSymbol(x) ? x.symbol : '_');
    const body = BaseCompiler.compile(args[0].canonical, {
      ...target,
      var: (id) => (params.includes(id) ? id : target.var(id)),
    });
    const fn = new ComputeEngineFunctionLiteral(body, params);
    return {
      target: 'javascript',
      success: true,
      code: `(${params.join(', ')}) => ${body}`,
      run: fn as unknown as (...args: any[]) => any,
    };
  }

  if (isBoxedSymbol(expr)) {
    const op = target.operators?.(expr.symbol);
    if (op) {
      const fn = new ComputeEngineFunctionLiteral(`a ${op[0]} b`, ['a', 'b']);
      return {
        target: 'javascript',
        success: true,
        code: `(a, b) => a ${op[0]} b`,
        run: fn as unknown as (...args: any[]) => any,
      };
    }
  }

  const js = BaseCompiler.compile(expr, target);
  const fn = new ComputeEngineFunction(js, target.preamble);
  return {
    target: 'javascript',
    success: true,
    code: js,
    run: fn as unknown as (...args: any[]) => any,
  };
}

/**
 * Compile integration function
 */
function compileIntegrate(args, _, target: CompileTarget): string {
  const { index, lower, upper } = normalizeIndexingSet(args[1]);
  const f = BaseCompiler.compile(args[0], {
    ...target,
    var: (id) => (id === index ? id : target.var(id)),
  });

  return `_SYS.integrate((${index}) => (${f}), ${lower}, ${upper})`;
}

/**
 * Check if function has a true name (not anonymous)
 */
// eslint-disable-next-line @typescript-eslint/ban-types
function isTrulyNamed(func: Function): boolean {
  const source = func.toString();
  if (source.includes('=>')) return false;
  return source.startsWith('function ') && source.includes(func.name);
}

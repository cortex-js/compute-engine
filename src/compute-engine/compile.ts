import type { MathJsonIdentifier } from '../math-json/types';

import type { BoxedExpression, IComputeEngine } from './public';

import { isRelationalOperator } from './boxed-expression/utils';
import { isFiniteIndexableCollection } from './collection-utils';
import { normalizeIndexingSet } from './library/utils';

import { monteCarloEstimate } from './numerics/monte-carlo';
import { chop, factorial, gcd, lcm, limit } from './numerics/numeric';
import { gamma, gammaln } from './numerics/special-functions';
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
} from './numerics/statistics';

export type CompiledType = boolean | number | string | object;

export type JSSource = string;

export type CompiledOperators = Record<
  MathJsonIdentifier,
  [op: string, prec: number]
>;

export type CompiledFunction =
  | string
  | ((
      args: ReadonlyArray<BoxedExpression>,
      compile: (expr: BoxedExpression) => JSSource,
      target: CompileTarget
    ) => JSSource);

export type CompiledFunctions = {
  [id: MathJsonIdentifier]: CompiledFunction;
};

const NATIVE_JS_OPERATORS: CompiledOperators = {
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
  // Xor: ['^', 6], // That's bitwise XOR, not logical XOR
  // Possible solution is to use `a ? !b : b` instead of `a ^ b`
};

const NATIVE_JS_FUNCTIONS: CompiledFunctions = {
  Abs: 'Math.abs',
  Add: (args, compile) => {
    if (args.length === 1) return compile(args[0]);
    // if (args.length > 2) {

    // }
    // const maxLength = Math.max(...args.map((x) => length(x) ?? 1));
    return `(${args.map((x) => compile(x)).join(' + ')})`;
  },
  Arccos: 'Math.acos',
  Arcosh: 'Math.acosh',
  Arccot: ([x], compile) => {
    if (x === null) throw new Error('Arccot: no argument');
    return `Math.atan(1 / (${compile(x)}))`;
  },
  Arccoth: ([x], compile) => {
    if (x === null) throw new Error('Arccoth: no argument');
    return `Math.atanh(1 / (${compile(x)}))`;
  },
  Arccsc: ([x], compile) => {
    if (x === null) throw new Error('Arccsc: no argument');
    return `Math.asin(1 / (${compile(x)}))`;
  },
  Arccsch: ([x], compile) => {
    if (x === null) throw new Error('Arccsch: no argument');
    return `Math.asinh(1 / (${compile(x)}))`;
  },
  Arcsec: ([x], compile) => {
    if (x === null) throw new Error('Arcsec: no argument');
    return `Math.acos(1 / (${compile(x)}))`;
  },
  Arcsech: ([x], compile) => {
    if (x === null) throw new Error('Arcsech: no argument');
    return `Math.acosh(1 / (${compile(x)}))`;
  },

  Arsin: 'Math.asin',
  Arsinh: 'Math.asinh',
  Arctan: 'Math.atan',
  Artanh: 'Math.atanh',
  // Math.cbrt
  Ceiling: 'Math.ceil',
  Chop: '_SYS.chop',
  Cos: 'Math.cos',
  Cosh: 'Math.cosh',
  Cot: ([x], compile) => {
    if (x === null) throw new Error('Cot: no argument');
    return inlineExpression('Math.cos(${x}) / Math.sin(${x})', compile(x));
  },

  Coth: ([x], compile) => {
    if (x === null) throw new Error('Coth: no argument');
    return inlineExpression('(Math.cosh(${x}) / Math.sinh(${x}))', compile(x));
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

  Gamma: '_SYS.gamma',

  GCD: '_SYS.gcd',

  // Math.hypot

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

  LogGamma: '_SYS.lngamma',

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
    // args could either be missing, or not a number
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
  Sgn: 'Math.sign',
  Sin: 'Math.sin',
  Sinh: 'Math.sinh',
  Sqrt: 'Math.sqrt',
  Tan: 'Math.tan',
  Tanh: 'Math.tanh',
  // Factorial: 'factorial',    // TODO: implement

  // Hallucinated by Copilot, but interesting ideas...
  // Gamma: 'Math.gamma',
  // Erf: 'Math.erf',
  // Erfc: 'Math.erfc',
  // Erfi: 'Math.erfi',
  // Zeta: 'Math.zeta',
  // PolyGamma: 'Math.polygamma',
  // HurwitzZeta: 'Math.hurwitzZeta', $$\zeta (s,a)=\sum _{n=0}^{\infty }{\frac {1}{(n+a)^{s}}}$$
  // DirichletEta: 'Math.dirichletEta',
  // Beta: 'Math.beta',
  // Binomial: 'Math.binomial',
  // Mod: 'Math.mod',
  // Quotient: 'Math.quotient',
  // Divisors: 'Math.divisors',
  // IsPrime: 'Math.isPrime',
  // PrimePi: 'Math.primePi',
  // Prime: 'Math.prime',
  // NextPrime: 'Math.nextPrime',
  // PreviousPrime: 'Math.prevPrime',
  // PrimePowerQ: 'Math.isPrimePower',
  // PrimePowerPi: 'Math.primePowerPi',
  // PrimePower: 'Math.primePower',
  // NextPrimePower: 'Math.nextPrimePower',
  // PreviousPrimePower: 'Math.prevPrimePower',
  // PrimeFactors: 'Math.primeFactors',
  // DivisorSigma: 'Math.divisorSigma',
  // DivisorCount: 'Math.divisorCount',
  // DivisorSum: 'Math.divisorSum',
  // MoebiusMu: 'Math.moebiusMu',
  // LiouvilleLambda: 'Math.liouvilleLambda',
  // CarmichaelLambda: 'Math.carmichaelLambda',
  // EulerPhi: 'Math.eulerPhi',
  // EulerPsi: 'Math.eulerPsi',
  // EulerGamma: 'Math.eulerGamma',
  // HarmonicNumber: 'Math.harmonicNumber',
  // BernoulliB: 'Math.bernoulliB',
  // StirlingS1: 'Math.stirlingS1',
  // StirlingS2: 'Math.stirlingS2',
  // BellB: 'Math.bellB',
  // BellNumber: 'Math.bellNumber',
  // LahS: 'Math.lahS',
  // LahL: 'Math.lahL',
};

export type CompileTarget = {
  operators?: (op: MathJsonIdentifier) => [op: string, prec: number];
  functions?: (id: MathJsonIdentifier) => CompiledFunction | undefined;
  var: (id: MathJsonIdentifier) => string | undefined;
  string: (str: string) => string;
  number: (n: number) => string;
  ws: (s?: string) => string; // White space
  preamble: string;
  indent: number;
  // @todo: add context or return compile as an array of statements
  // and let the caller decide how to wrap it in an IIFE.
  // The expression being compiled will be used:
  // - as the value of a variable declaration (LexicalDeclaration)
  // - as the body of a function (FunctionDeclaration)
  // context?: 'LexicalDeclaration' | 'ExpressionStatement' | 'ReturnStatement';
};

/** This is an extension of the Function class that allows us to pass
 * a custom scope for "global" functions. */
export class ComputeEngineFunction extends Function {
  private sys = {
    chop: chop,
    factorial: factorial,
    gamma: gamma,
    gcd: gcd,
    integrate: (f, a, b) => monteCarloEstimate(f, a, b, 10e6),
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
    super('_SYS', '_', `${preamble};return ${body}`);
    return new Proxy(this, {
      apply: (target, thisArg, argumentsList) =>
        super.apply(thisArg, [this.sys, ...argumentsList]),
      get: (target, prop) => {
        // Expose the `toString` method so that the JavaScript source can be
        // inspected
        if (prop === 'toString') return (): string => body;
        return target[prop];
      },
    });
  }
}

export function compileToTarget(
  expr: BoxedExpression,
  target: CompileTarget
): (_?: Record<string, CompiledType>) => CompiledType {
  const js = compile(expr, target);
  return new ComputeEngineFunction(
    js,
    target.preamble
  ) as unknown as () => CompiledType;
}

export function compileToJavascript(
  expr: BoxedExpression,
  functions?: Record<MathJsonIdentifier, JSSource | Function>,
  vars?: Record<MathJsonIdentifier, JSSource>,
  imports: unknown[] = [],
  preamble?: string
): (_?: Record<string, CompiledType>) => CompiledType {
  const unknowns = expr.unknowns;

  // For any import, turn it into a string
  let preambleImports = imports
    .map((x) => {
      if (typeof x === 'function') return x.toString();
      throw new Error(`Unsupported import \`${x}\``);
    })
    .join('\n');

  // @ts-ignore
  const namedFunctions: { [k: string]: string } = functions
    ? Object.fromEntries(
        Object.entries(functions).filter((k, v) => typeof v !== 'string')
      )
    : {};

  if (functions)
    for (const [k, v] of Object.entries(functions)) {
      if (typeof v === 'function') {
        // If a named function, turn it into a string
        // otherwise, declare it as a constant

        if (isTrulyNamed(v)) {
          preambleImports += `${v.toString()};\n`;
          namedFunctions[k] = v.name;
        } else {
          preambleImports += `const ${k} = ${v.toString()};\n`;
          namedFunctions[k] = k;
        }
      }
    }

  return compileToTarget(expr, {
    operators: (op) => NATIVE_JS_OPERATORS[op],
    functions: (id) =>
      namedFunctions?.[id] ? namedFunctions[id] : NATIVE_JS_FUNCTIONS[id],
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
    string: (str) => JSON.stringify(str),
    number: (n) => n.toString(),
    indent: 0,
    ws: (s?: string) => s ?? '',
    preamble: (preamble ?? '') + preambleImports,
  });
}

function compileExpr(
  engine: IComputeEngine,
  h: string,
  args: ReadonlyArray<BoxedExpression>,
  prec: number,
  target: CompileTarget
): JSSource {
  // No need to check for 'Rational': this has been handled as a number

  if (h === 'Error') throw new Error('Error');

  if (h === 'Sequence') {
    if (args.length === 0) return '';
    return `(${args.map((arg) => compile(arg, target, prec)).join(', ')})`;
  }

  // if (h === 'Negate') {
  //   const arg = args[0];
  //   if (arg === null) return '';
  //   return `-${compile(arg, target, 3)}`;
  // }

  if (h === 'Sum' || h === 'Product') return compileLoop(h, args, target);

  //
  // Is it an operator?
  //
  // Check that none of the arguments are collections
  // If they are, we'll treat it as a function call
  //

  if (args.every((x) => !x.isCollection)) {
    // See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Operator_precedence
    // for operator precedence in JavaScript
    const op = target.operators?.(h);

    if (isRelationalOperator(h) && args.length > 2 && op) {
      // JavaScript relational operators only take two arguments
      // We need to chain them
      const result: string[] = [];
      for (let i = 0; i < args.length - 1; i++)
        result.push(
          compileExpr(engine, h, [args[i], args[i + 1]], op[1], target)
        );

      return `(${result.join(') && (')})`;
    }

    if (op !== undefined) {
      if (args === null) return '';
      let resultStr: string;
      if (args.length === 1) {
        // Unary operator, assume prefix
        resultStr = `${op[0]}${compile(args[0], target, op[1])}`;
      } else {
        resultStr = args
          .map((arg) => compile(arg, target, op[1]))
          .join(` ${op[0]} `);
      }
      return op[1] < prec ? `(${resultStr})` : resultStr;
    }
  }

  if (h === 'Function') {
    // Anonymous function
    const params = args.slice(1).map((x) => x.symbol);
    return `((${params.join(', ')}) => ${compile(args[0].canonical, {
      ...target,
      var: (id) => (params.includes(id) ? id : target.var(id)),
    })})`;
  }

  if (h === 'Declare') return `let ${args[0].symbol}`;
  if (h === 'Assign') return `${args[0].symbol} = ${compile(args[1], target)}`;
  // @todo: that's incorrect: return should return from the function, not the block
  if (h === 'Return') return `return ${compile(args[0], target)}`;
  if (h === 'If') {
    if (args.length !== 3) throw new Error('If: wrong number of arguments');
    return `((${compile(args[0], target)}) ? (${compile(
      args[1],
      target
    )}) : (${compile(args[2], target)}))`;
  }

  if (h === 'Block') {
    // Get all the Declare statements
    const locals: string[] = [];
    for (const arg of args) {
      if (arg.operator === 'Declare') locals.push(arg.ops![0].symbol!);
    }

    if (args.length === 1 && locals.length === 0)
      return compile(args[0], target);

    const result = args.map((arg) =>
      compile(arg, {
        ...target,
        var: (id) => {
          if (locals.includes(id)) return id;
          return target.var(id);
        },
      })
    );
    // Add a return statement to the last expression
    result[result.length - 1] = `return ${result[result.length - 1]}`;
    return `(() => {${target.ws('\n')}${result.join(
      `;${target.ws('\n')}`
    )}${target.ws('\n')}})()`;
  }

  const fn = target.functions?.(h);
  if (!fn) throw new Error(`Unknown function \`${h}\``);
  if (typeof fn === 'function') {
    // Get function definition for h
    const def = engine.lookupFunction(h);

    if (
      def?.threadable &&
      args.length === 1 &&
      isFiniteIndexableCollection(args[0])
    ) {
      const v = tempVar();
      return `(${compile(args[0], target)}).map((${v}) => ${fn(
        [args[0].engine.box(v)],
        (expr) => compile(expr, target),
        target
      )})`;
    }
    return fn(args, (expr) => compile(expr, target), target);
  }

  if (args === null) return `${fn}()`;

  return `${fn}(${args.map((x) => compile(x, target)).join(', ')})`;
}

// Will throw an exception if the expression cannot be compiled
export function compile(
  expr: BoxedExpression | undefined,
  target: CompileTarget,
  prec = 0
): JSSource {
  if (expr === undefined) return '';
  if (!expr.isValid) {
    throw new Error(`Cannot compile invalid expression: "${expr.toString()}"`);
  }

  //
  // Is it a symbol?
  //
  const s = expr.symbol;
  if (s !== null) return target.var?.(s) ?? s;

  //
  // Is it a number?
  //
  const f = expr.re;
  if (!isNaN(f)) {
    if (expr.im !== 0) throw new Error('Complex numbers are not supported');
    return target.number(f);
  }

  // Is it a string?
  const str = expr.string;
  if (str !== null) return target.string(s!);

  // It must be a function expression...
  return compileExpr(expr.engine, expr.operator, expr.ops!, prec, target);
}

function compileLoop(
  h: string,
  args: ReadonlyArray<BoxedExpression>,
  target: CompileTarget
): string {
  if (args === null) throw new Error('Sum/Product: no arguments');
  if (!args[0]) throw new Error('Sum/Product: no body');
  // if (!args[1]) throw new Error('Sum/Product: no limits');

  const { index, lower, upper, isFinite } = normalizeIndexingSet(args[1]);

  const op = h === 'Sum' ? '+' : '*';

  if (!index) {
    // Loop over a collection
    const indexVar = tempVar();
    const acc = tempVar();
    const col = compile(args[0], target);
    return `${col}.reduce((${acc}, ${indexVar}) => ${acc} ${op} ${indexVar}, ${
      op === '+' ? '0' : '1'
    })`;
    //         return `(() => {
    //   let _acc = ${op === '+' ? '0' : '1'};
    //   for (const _x of ${col}) _acc ${op}= _x;
    //   return _acc;
    // })()`;
  }

  // @todo: if !isFinite, add tests for convergence to the generated code

  const fn = compile(args[0], {
    ...target,
    var: (id) => {
      if (id === index) return index;
      return target.var(id);
    },
  });

  // @todo: don't always need to wrap in an IIFE
  const indexVar = tempVar();
  const acc = tempVar();

  return `(() => {
  let ${acc} = ${op === '+' ? '0' : '1'};
  let ${index} = ${lower};
  const _fn = () => ${fn};
  while (${indexVar} <= ${upper}) {
    ${acc} ${op}= _fn();
    ${indexVar}++;
  }
  return ${acc};
})()`;
}

/**
 * Return either the inlined body or an IIFE that evaluates the body
 * depending on the complexity of the expression `x`.
 *
 * For example:
 *
 * ```javascript
 * const result1 = iifeExpression(`Math.sin(\${x}) / Math.cos(\${x})`, '12');
 * console.log(result1); // Outputs: Math.sin(12) / Math.cos(12)
 *
 * const result2 = iifeExpression(`Math.sin(\${x}) / Math.cos(\${x})`, 'a + b');
 * console.log(result2); // Outputs: (() => { const temp_7z1z = a + b; return Math.sin(temp_7z1z) / Math.cos(temp_7z1z); })()
 * ```
 *
 */

function inlineExpression(body: string, x: string): string {
  // Check if `x` is a simple value (like a number or a simple identifier)
  const isSimple = /^[\p{L}_][\p{L}\p{N}_]*$/u.test(x) || /^[0-9]+$/.test(x);

  if (isSimple) {
    // Inline the body if `x` is simple
    return new Function('x', `return \`${body}\`;`)(x);
  } else {
    // Generate an IIFE if `x` is a complex expression
    const t = tempVar();
    return new Function(
      'x',
      `return \`(() => { const ${t} = \${x}; return ${body.replace(/\\\${x}/g, t)}; })()\`;`
    )(x);
  }
}

function tempVar(): string {
  // Return a random variable name made up of a single underscore
  // followed by some digits and letters
  // Note: must skip at least the first two chars, since
  //`Math.random().toString(36)` will return a string like "0.dg26kZjalw"
  return `_${Math.random().toString(36).substring(4)}`;
}

function compileIntegrate(args, _, target: CompileTarget): string {
  const { index, lower, upper } = normalizeIndexingSet(args[1]);
  const f = compile(args[0], {
    ...target,
    var: (id) => (id === index ? id : target.var(id)),
  });

  return `_SYS.integrate((${index}) => (${f}), ${lower}, ${upper})`;
}

function isTrulyNamed(func: Function): boolean {
  const source = func.toString();

  // Check if it's an arrow function, which is always anonymous
  if (source.includes('=>')) return false;

  // Check if the function has a name in `.toString()`
  return source.startsWith('function ') && source.includes(func.name);
}

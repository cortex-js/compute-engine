import type { Expression } from '../global-types';
import type { MathJsonSymbol } from '../../math-json/types';
import { isSymbol, isFunction } from '../boxed-expression/type-guards';
import { Complex } from 'complex-esm';

import {
  chop,
  factorial,
  factorial2,
  gcd,
  lcm,
  limit,
} from '../numerics/numeric';
import {
  gamma,
  gammaln,
  erf,
  erfc,
  erfInv,
  beta,
  digamma,
  trigamma,
  polygamma,
  zeta,
  lambertW,
  besselJ,
  besselY,
  besselI,
  besselK,
  airyAi,
  airyBi,
} from '../numerics/special-functions';
import { choose } from '../boxed-expression/expand';
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
const JAVASCRIPT_FUNCTIONS: CompiledFunctions<Expression> = {
  Abs: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_SYS.cabs(${compile(args[0])})`;
    return `Math.abs(${compile(args[0])})`;
  },
  Add: (args, compile) => {
    if (args.length === 1) return compile(args[0]);
    const anyComplex = args.some((a) => BaseCompiler.isComplexValued(a));
    if (!anyComplex) return `(${args.map((x) => compile(x)).join(' + ')})`;

    const parts = args.map((a) => {
      const code = compile(a);
      return { code, isComplex: BaseCompiler.isComplexValued(a) };
    });
    const reTerms = parts.map((p) =>
      p.isComplex ? `(${p.code}).re` : p.code
    );
    const imTerms = parts
      .filter((p) => p.isComplex)
      .map((p) => `(${p.code}).im`);
    return `({ re: ${reTerms.join(' + ')}, im: ${imTerms.join(' + ')} })`;
  },
  Arccos: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_SYS.cacos(${compile(args[0])})`;
    return `Math.acos(${compile(args[0])})`;
  },
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
  Arcsin: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_SYS.casin(${compile(args[0])})`;
    return `Math.asin(${compile(args[0])})`;
  },
  Arsinh: 'Math.asinh',
  Arctan: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_SYS.catan(${compile(args[0])})`;
    return `Math.atan(${compile(args[0])})`;
  },
  Artanh: 'Math.atanh',
  Ceil: 'Math.ceil',
  Chop: '_SYS.chop',
  Cos: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_SYS.ccos(${compile(args[0])})`;
    return `Math.cos(${compile(args[0])})`;
  },
  Cosh: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_SYS.ccosh(${compile(args[0])})`;
    return `Math.cosh(${compile(args[0])})`;
  },
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
  Exp: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_SYS.cexp(${compile(args[0])})`;
    return `Math.exp(${compile(args[0])})`;
  },
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
  Ln: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_SYS.cln(${compile(args[0])})`;
    return `Math.log(${compile(args[0])})`;
  },
  List: (args, compile) => `[${args.map((x) => compile(x)).join(', ')}]`,
  // Matrix wraps List(List(...), ...) — compile the body (first arg) which
  // is the nested List structure; remaining args are delimiters/column spec
  Matrix: (args, compile) => compile(args[0]),
  // Tuple compiles identically to List
  Tuple: (args, compile) => `[${args.map((x) => compile(x)).join(', ')}]`,
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
    const base = args[0];
    const exp = args[1];
    if (base === null) throw new Error('Power: no argument');
    if (
      BaseCompiler.isComplexValued(base) ||
      BaseCompiler.isComplexValued(exp)
    ) {
      return `_SYS.cpow(${compile(base)}, ${compile(exp)})`;
    }
    const expVal = exp.re;
    if (expVal === 0.5) return `Math.sqrt(${compile(base)})`;
    if (expVal === 1 / 3) return `Math.cbrt(${compile(base)})`;
    if (expVal === 1) return compile(base);
    if (expVal === -1) return `(1 / (${compile(base)}))`;
    if (expVal === -0.5) return `(1 / Math.sqrt(${compile(base)}))`;
    return `Math.pow(${compile(base)}, ${compile(exp)})`;
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
  Sin: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_SYS.csin(${compile(args[0])})`;
    return `Math.sin(${compile(args[0])})`;
  },
  Sinh: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_SYS.csinh(${compile(args[0])})`;
    return `Math.sinh(${compile(args[0])})`;
  },
  Sqrt: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_SYS.csqrt(${compile(args[0])})`;
    return `Math.sqrt(${compile(args[0])})`;
  },
  Tan: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_SYS.ctan(${compile(args[0])})`;
    return `Math.tan(${compile(args[0])})`;
  },
  Tanh: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_SYS.ctanh(${compile(args[0])})`;
    return `Math.tanh(${compile(args[0])})`;
  },
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

  // Arithmetic operators handled as functions for completeness
  Subtract: ([a, b], compile) => {
    if (a === null || b === null) throw new Error('Subtract: missing argument');
    const ac = BaseCompiler.isComplexValued(a);
    const bc = BaseCompiler.isComplexValued(b);
    if (!ac && !bc) return `(${compile(a)} - ${compile(b)})`;

    const ca = compile(a);
    const cb = compile(b);
    const reA = ac ? `(${ca}).re` : ca;
    const imA = ac ? `(${ca}).im` : '0';
    const reB = bc ? `(${cb}).re` : cb;
    const imB = bc ? `(${cb}).im` : '0';
    return `({ re: ${reA} - ${reB}, im: ${imA} - ${imB} })`;
  },
  Divide: ([a, b], compile) => {
    if (a === null || b === null) throw new Error('Divide: missing argument');
    const ac = BaseCompiler.isComplexValued(a);
    const bc = BaseCompiler.isComplexValued(b);
    if (!ac && !bc) return `(${compile(a)} / ${compile(b)})`;

    if (ac && bc) {
      return `(() => { const _a = ${compile(a)}, _b = ${compile(b)}, _d = _b.re * _b.re + _b.im * _b.im; return { re: (_a.re * _b.re + _a.im * _b.im) / _d, im: (_a.im * _b.re - _a.re * _b.im) / _d }; })()`;
    }
    if (ac && !bc) {
      return `(() => { const _a = ${compile(a)}, _r = ${compile(b)}; return { re: _a.re / _r, im: _a.im / _r }; })()`;
    }
    return `(() => { const _r = ${compile(a)}, _b = ${compile(b)}, _d = _b.re * _b.re + _b.im * _b.im; return { re: _r * _b.re / _d, im: -_r * _b.im / _d }; })()`;
  },
  Negate: ([x], compile) => {
    if (x === null) throw new Error('Negate: no argument');
    if (!BaseCompiler.isComplexValued(x)) return `(-${compile(x)})`;
    return `_SYS.cneg(${compile(x)})`;
  },
  Multiply: (args, compile) => {
    if (args.length === 1) return compile(args[0]);
    const anyComplex = args.some((a) => BaseCompiler.isComplexValued(a));
    if (!anyComplex) return `(${args.map((x) => compile(x)).join(' * ')})`;

    let result = compile(args[0]);
    let resultIsComplex = BaseCompiler.isComplexValued(args[0]);

    for (let i = 1; i < args.length; i++) {
      const argCode = compile(args[i]);
      const argIsComplex = BaseCompiler.isComplexValued(args[i]);

      if (!resultIsComplex && !argIsComplex) {
        result = `(${result} * ${argCode})`;
      } else if (resultIsComplex && !argIsComplex) {
        result = `(() => { const _a = ${result}, _r = ${argCode}; return { re: _a.re * _r, im: _a.im * _r }; })()`;
        resultIsComplex = true;
      } else if (!resultIsComplex && argIsComplex) {
        result = `(() => { const _r = ${result}, _b = ${argCode}; return { re: _r * _b.re, im: _r * _b.im }; })()`;
        resultIsComplex = true;
      } else {
        result = `(() => { const _a = ${result}, _b = ${argCode}; return { re: _a.re * _b.re - _a.im * _b.im, im: _a.re * _b.im + _a.im * _b.re }; })()`;
      }
    }
    return result;
  },

  // Factorial and double factorial
  Factorial: '_SYS.factorial',
  Factorial2: '_SYS.factorial2',

  // Additional logarithmic functions
  Exp2: ([x], compile) => {
    if (x === null) throw new Error('Exp2: no argument');
    return `Math.pow(2, ${compile(x)})`;
  },
  Log2: 'Math.log2',
  Log10: 'Math.log10',
  Lg: 'Math.log10',

  // Trigonometric
  Arctan2: 'Math.atan2',
  Hypot: 'Math.hypot',
  Degrees: ([x], compile) => {
    if (x === null) throw new Error('Degrees: no argument');
    return `(${compile(x)} * Math.PI / 180)`;
  },
  Haversine: ([x], compile) => {
    if (x === null) throw new Error('Haversine: no argument');
    return BaseCompiler.inlineExpression(
      '(1 - Math.cos(${x})) / 2',
      compile(x)
    );
  },
  InverseHaversine: ([x], compile) => {
    if (x === null) throw new Error('InverseHaversine: no argument');
    return `(2 * Math.asin(Math.sqrt(${compile(x)})))`;
  },

  // Error functions
  Erf: '_SYS.erf',
  Erfc: '_SYS.erfc',
  ErfInv: '_SYS.erfInv',

  // Special functions
  Beta: '_SYS.beta',
  Digamma: '_SYS.digamma',
  Trigamma: '_SYS.trigamma',
  PolyGamma: (args, compile) =>
    `_SYS.polygamma(${compile(args[0])}, ${compile(args[1])})`,
  Zeta: '_SYS.zeta',
  LambertW: '_SYS.lambertW',

  // Bessel functions
  BesselJ: (args, compile) =>
    `_SYS.besselJ(${compile(args[0])}, ${compile(args[1])})`,
  BesselY: (args, compile) =>
    `_SYS.besselY(${compile(args[0])}, ${compile(args[1])})`,
  BesselI: (args, compile) =>
    `_SYS.besselI(${compile(args[0])}, ${compile(args[1])})`,
  BesselK: (args, compile) =>
    `_SYS.besselK(${compile(args[0])}, ${compile(args[1])})`,

  // Airy functions
  AiryAi: '_SYS.airyAi',
  AiryBi: '_SYS.airyBi',

  // Combinatorics
  Binomial: (args, compile) =>
    `_SYS.binomial(${compile(args[0])}, ${compile(args[1])})`,
  Fibonacci: '_SYS.fibonacci',

  // Complex-specific functions
  Re: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `(${compile(args[0])}).re`;
    return compile(args[0]);
  },
  Im: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `(${compile(args[0])}).im`;
    return '0';
  },
  Arg: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_SYS.carg(${compile(args[0])})`;
    return `(${compile(args[0])} >= 0 ? 0 : Math.PI)`;
  },
  Conjugate: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_SYS.cconj(${compile(args[0])})`;
    return compile(args[0]);
  },
};

/** Convert a Complex instance to a plain {re, im} object */
function toRI(c: Complex): { re: number; im: number } {
  return { re: c.re, im: c.im };
}

/**
 * JavaScript-specific function extension that provides system functions
 */
export class ComputeEngineFunction extends Function {
  SYS = {
    chop: chop,
    factorial: factorial,
    factorial2: factorial2,
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
    erf,
    erfc,
    erfInv,
    beta,
    digamma,
    trigamma,
    polygamma,
    zeta,
    lambertW,
    besselJ,
    besselY,
    besselI,
    besselK,
    airyAi,
    airyBi,
    binomial: choose,
    fibonacci: fibonacci,
    // Complex helpers
    csin: (z) => toRI(new Complex(z.re, z.im).sin()),
    ccos: (z) => toRI(new Complex(z.re, z.im).cos()),
    ctan: (z) => toRI(new Complex(z.re, z.im).tan()),
    casin: (z) => toRI(new Complex(z.re, z.im).asin()),
    cacos: (z) => toRI(new Complex(z.re, z.im).acos()),
    catan: (z) => toRI(new Complex(z.re, z.im).atan()),
    csinh: (z) => toRI(new Complex(z.re, z.im).sinh()),
    ccosh: (z) => toRI(new Complex(z.re, z.im).cosh()),
    ctanh: (z) => toRI(new Complex(z.re, z.im).tanh()),
    csqrt: (z) => toRI(new Complex(z.re, z.im).sqrt()),
    cexp: (z) => toRI(new Complex(z.re, z.im).exp()),
    cln: (z) => toRI(new Complex(z.re, z.im).log()),
    cpow: (z, w) => {
      const zz =
        typeof z === 'number' ? new Complex(z, 0) : new Complex(z.re, z.im);
      const ww =
        typeof w === 'number' ? new Complex(w, 0) : new Complex(w.re, w.im);
      return toRI(zz.pow(ww));
    },
    cabs: (z) => new Complex(z.re, z.im).abs(),
    carg: (z) => new Complex(z.re, z.im).arg(),
    cconj: (z) => toRI(new Complex(z.re, z.im).conjugate()),
    cneg: (z) => ({ re: -z.re, im: -z.im }),
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
    factorial2: factorial2,
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
    erf,
    erfc,
    erfInv,
    beta,
    digamma,
    trigamma,
    polygamma,
    zeta,
    lambertW,
    besselJ,
    besselY,
    besselI,
    besselK,
    airyAi,
    airyBi,
    binomial: choose,
    fibonacci: fibonacci,
    // Complex helpers
    csin: (z) => toRI(new Complex(z.re, z.im).sin()),
    ccos: (z) => toRI(new Complex(z.re, z.im).cos()),
    ctan: (z) => toRI(new Complex(z.re, z.im).tan()),
    casin: (z) => toRI(new Complex(z.re, z.im).asin()),
    cacos: (z) => toRI(new Complex(z.re, z.im).acos()),
    catan: (z) => toRI(new Complex(z.re, z.im).atan()),
    csinh: (z) => toRI(new Complex(z.re, z.im).sinh()),
    ccosh: (z) => toRI(new Complex(z.re, z.im).cosh()),
    ctanh: (z) => toRI(new Complex(z.re, z.im).tanh()),
    csqrt: (z) => toRI(new Complex(z.re, z.im).sqrt()),
    cexp: (z) => toRI(new Complex(z.re, z.im).exp()),
    cln: (z) => toRI(new Complex(z.re, z.im).log()),
    cpow: (z, w) => {
      const zz =
        typeof z === 'number' ? new Complex(z, 0) : new Complex(z.re, z.im);
      const ww =
        typeof w === 'number' ? new Complex(w, 0) : new Complex(w.re, w.im);
      return toRI(zz.pow(ww));
    },
    cabs: (z) => new Complex(z.re, z.im).abs(),
    carg: (z) => new Complex(z.re, z.im).arg(),
    cconj: (z) => toRI(new Complex(z.re, z.im).conjugate()),
    cneg: (z) => ({ re: -z.re, im: -z.im }),
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
export class JavaScriptTarget implements LanguageTarget<Expression> {
  getOperators(): CompiledOperators {
    return JAVASCRIPT_OPERATORS;
  }

  getFunctions(): CompiledFunctions<Expression> {
    return JAVASCRIPT_FUNCTIONS;
  }

  createTarget(
    options: Partial<CompileTarget<Expression>> = {}
  ): CompileTarget<Expression> {
    return {
      language: 'javascript',
      operators: (op) => JAVASCRIPT_OPERATORS[op],
      functions: (id) => JAVASCRIPT_FUNCTIONS[id],
      var: (id) => {
        const result = {
          Pi: 'Math.PI',
          ExponentialE: 'Math.E',
          NaN: 'Number.NaN',
          ImaginaryUnit: '({ re: 0, im: 1 })',
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
      complex: (re, im) => `({ re: ${re}, im: ${im} })`,
      indent: 0,
      ws: (s?: string) => s ?? '',
      preamble: '',
      ...options,
    };
  }

  compile(
    expr: Expression,
    options: CompilationOptions<Expression> = {}
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
          ImaginaryUnit: '({ re: 0, im: 1 })',
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
  expr: Expression,
  target: CompileTarget<Expression>
): CompilationResult {
  if (expr.operator === 'Function' && isFunction(expr)) {
    const args = expr.ops;
    const params = args.slice(1).map((x) => (isSymbol(x) ? x.symbol : '_'));
    const body = BaseCompiler.compile(args[0].canonical, {
      ...target,
      var: (id) => (params.includes(id) ? id : target.var(id)),
    });
    const fn = new ComputeEngineFunctionLiteral(body, params);
    return {
      target: 'javascript',
      success: true,
      code: `(${params.join(', ')}) => ${body}`,
      run: fn as unknown as (...args: number[]) => number,
    };
  }

  if (isSymbol(expr)) {
    const op = target.operators?.(expr.symbol);
    if (op) {
      const fn = new ComputeEngineFunctionLiteral(`a ${op[0]} b`, ['a', 'b']);
      return {
        target: 'javascript',
        success: true,
        code: `(a, b) => a ${op[0]} b`,
        run: fn as unknown as (...args: number[]) => number,
      };
    }
  }

  const js = BaseCompiler.compile(expr, target);
  const fn = new ComputeEngineFunction(js, target.preamble);
  return {
    target: 'javascript',
    success: true,
    code: js,
    run: fn as unknown as (...args: number[]) => number,
  };
}

/**
 * Compile integration function
 */
function compileIntegrate(args, _, target: CompileTarget<Expression>): string {
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

/**
 * Compute the nth Fibonacci number using iterative doubling.
 */
function fibonacci(n: number): number {
  if (!Number.isInteger(n)) return NaN;
  if (n < 0) return n % 2 === 0 ? -fibonacci(-n) : fibonacci(-n);
  if (n <= 1) return n;
  let a = 0;
  let b = 1;
  for (let i = 2; i <= n; i++) {
    const next = a + b;
    a = b;
    b = next;
  }
  return b;
}

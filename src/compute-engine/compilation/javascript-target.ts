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
  parseColor,
  rgbToOklch,
  oklchToRgb,
  rgbToOklab,
  oklabToRgb,
  rgbToHsl,
  hslToRgb,
  apca,
  contrastingColor,
  asRgb,
} from '../../color';
import { SEQUENTIAL_PALETTES } from '../../color/sequential';
import { CATEGORICAL_PALETTES } from '../../color/categorical';
import { DIVERGING_PALETTES } from '../../color/diverging-palettes';
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
  fresnelS,
  fresnelC,
  sinc,
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
    const reTerms = parts.map((p) => (p.isComplex ? `(${p.code}).re` : p.code));
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
    if (BaseCompiler.isComplexValued(x)) return `_SYS.cacot(${compile(x)})`;
    return `Math.atan(1 / (${compile(x)}))`;
  },
  Arcoth: ([x], compile) => {
    if (x === null) throw new Error('Arcoth: no argument');
    if (BaseCompiler.isComplexValued(x)) return `_SYS.cacoth(${compile(x)})`;
    return `Math.atanh(1 / (${compile(x)}))`;
  },
  Arccsc: ([x], compile) => {
    if (x === null) throw new Error('Arccsc: no argument');
    if (BaseCompiler.isComplexValued(x)) return `_SYS.cacsc(${compile(x)})`;
    return `Math.asin(1 / (${compile(x)}))`;
  },
  Arcsch: ([x], compile) => {
    if (x === null) throw new Error('Arcsch: no argument');
    if (BaseCompiler.isComplexValued(x)) return `_SYS.cacsch(${compile(x)})`;
    return `Math.asinh(1 / (${compile(x)}))`;
  },
  Arcsec: ([x], compile) => {
    if (x === null) throw new Error('Arcsec: no argument');
    if (BaseCompiler.isComplexValued(x)) return `_SYS.casec(${compile(x)})`;
    return `Math.acos(1 / (${compile(x)}))`;
  },
  Arsech: ([x], compile) => {
    if (x === null) throw new Error('Arsech: no argument');
    if (BaseCompiler.isComplexValued(x)) return `_SYS.casech(${compile(x)})`;
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
    if (BaseCompiler.isComplexValued(x)) return `_SYS.ccot(${compile(x)})`;
    return BaseCompiler.inlineExpression(
      'Math.cos(${x}) / Math.sin(${x})',
      compile(x)
    );
  },
  Coth: ([x], compile) => {
    if (x === null) throw new Error('Coth: no argument');
    if (BaseCompiler.isComplexValued(x)) return `_SYS.ccoth(${compile(x)})`;
    return BaseCompiler.inlineExpression(
      '(Math.cosh(${x}) / Math.sinh(${x}))',
      compile(x)
    );
  },
  Csc: ([x], compile) => {
    if (x === null) throw new Error('Csc: no argument');
    if (BaseCompiler.isComplexValued(x)) return `_SYS.ccsc(${compile(x)})`;
    return `1 / Math.sin(${compile(x)})`;
  },
  Csch: ([x], compile) => {
    if (x === null) throw new Error('Csch: no argument');
    if (BaseCompiler.isComplexValued(x)) return `_SYS.ccsch(${compile(x)})`;
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
  Product: (args, compile, target) =>
    compileSumProduct('Product', args, compile, target),
  Sum: (args, compile, target) =>
    compileSumProduct('Sum', args, compile, target),
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
    if (BaseCompiler.isComplexValued(arg)) return `_SYS.csec(${compile(arg)})`;
    return `1 / Math.cos(${compile(arg)})`;
  },
  Sech: (args, compile) => {
    const arg = args[0];
    if (arg === null) throw new Error('Sech: no argument');
    if (BaseCompiler.isComplexValued(arg)) return `_SYS.csech(${compile(arg)})`;
    return `1 / Math.cosh(${compile(arg)})`;
  },
  Heaviside: '_SYS.heaviside',
  Sign: 'Math.sign',
  Sinc: '_SYS.sinc',
  FresnelS: '_SYS.fresnelS',
  FresnelC: '_SYS.fresnelC',
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

    if (args.length === 2) {
      // Optimize: single IIFE for 2 operands
      const ac = BaseCompiler.isComplexValued(args[0]);
      const bc = BaseCompiler.isComplexValued(args[1]);
      const ca = compile(args[0]);
      const cb = compile(args[1]);

      if (ac && bc) {
        return `(() => { const _a = ${ca}, _b = ${cb}; return { re: _a.re * _b.re - _a.im * _b.im, im: _a.re * _b.im + _a.im * _b.re }; })()`;
      }
      if (ac && !bc) {
        return `(() => { const _a = ${ca}, _r = ${cb}; return { re: _a.re * _r, im: _a.im * _r }; })()`;
      }
      // !ac && bc
      return `(() => { const _r = ${ca}, _b = ${cb}; return { re: _r * _b.re, im: _r * _b.im }; })()`;
    }

    // 3+ operands: single IIFE, sequential accumulation
    const parts: string[] = [];
    const temps: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const t = `_v${i}`;
      temps.push(t);
      parts.push(`const ${t} = ${compile(args[i])}`);
    }

    // Accumulate with intermediate variables
    const firstIsComplex = BaseCompiler.isComplexValued(args[0]);
    parts.push(`let _re = ${firstIsComplex ? `${temps[0]}.re` : temps[0]}`);
    parts.push(`let _im = ${firstIsComplex ? `${temps[0]}.im` : '0'}`);

    for (let i = 1; i < args.length; i++) {
      const t = temps[i];
      const tIsComplex = BaseCompiler.isComplexValued(args[i]);
      const tRe = tIsComplex ? `${t}.re` : t;
      const tIm = tIsComplex ? `${t}.im` : '0';
      parts.push(`const _nre${i} = _re * ${tRe} - _im * ${tIm}`);
      parts.push(`const _nim${i} = _re * ${tIm} + _im * ${tRe}`);
      parts.push(`_re = _nre${i}`);
      parts.push(`_im = _nim${i}`);
    }

    return `(() => { ${parts.join('; ')}; return { re: _re, im: _im }; })()`;
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

  // Color functions
  Color: ([color], compile) => {
    if (color === null) throw new Error('Color: no argument');
    return `_SYS.color(${compile(color)})`;
  },
  ColorToString: (args, compile) => {
    if (args.length === 0) throw new Error('ColorToString: no argument');
    if (args.length >= 2)
      return `_SYS.colorToString(${compile(args[0])}, ${compile(args[1])})`;
    return `_SYS.colorToString(${compile(args[0])})`;
  },
  ColorMix: (args, compile) => {
    if (args.length < 2) throw new Error('ColorMix: need two colors');
    if (args.length >= 3)
      return `_SYS.colorMix(${compile(args[0])}, ${compile(args[1])}, ${compile(args[2])})`;
    return `_SYS.colorMix(${compile(args[0])}, ${compile(args[1])})`;
  },
  ColorContrast: ([bg, fg], compile) => {
    if (bg === null || fg === null)
      throw new Error('ColorContrast: need two colors');
    return `_SYS.colorContrast(${compile(bg)}, ${compile(fg)})`;
  },
  ContrastingColor: (args, compile) => {
    if (args.length === 0) throw new Error('ContrastingColor: no argument');
    if (args.length >= 3)
      return `_SYS.contrastingColor(${compile(args[0])}, ${compile(args[1])}, ${compile(args[2])})`;
    return `_SYS.contrastingColor(${compile(args[0])})`;
  },
  ColorToColorspace: ([color, space], compile) => {
    if (color === null || space === null)
      throw new Error('ColorToColorspace: need color and space');
    return `_SYS.colorToColorspace(${compile(color)}, ${compile(space)})`;
  },
  ColorFromColorspace: ([components, space], compile) => {
    if (components === null || space === null)
      throw new Error('ColorFromColorspace: need components and space');
    return `_SYS.colorFromColorspace(${compile(components)}, ${compile(space)})`;
  },
  Colormap: (args, compile) => {
    if (args.length === 0) throw new Error('Colormap: no argument');
    if (args.length >= 2)
      return `_SYS.colormap(${compile(args[0])}, ${compile(args[1])})`;
    return `_SYS.colormap(${compile(args[0])})`;
  },
};

/** Convert a Complex instance to a plain {re, im} object */
function toRI(c: Complex): { re: number; im: number } {
  return { re: c.re, im: c.im };
}

/**
 * Normalize a color input (string or [r, g, b, a?] array with 0-1 values)
 * to an RgbColor {r, g, b, alpha?} with 0-255 r/g/b values.
 */
function toRgb255(input: string | number[]): {
  r: number;
  g: number;
  b: number;
  alpha?: number;
} {
  if (typeof input === 'string') {
    const c = parseColor(input);
    return {
      r: (c >>> 24) & 0xff,
      g: (c >>> 16) & 0xff,
      b: (c >>> 8) & 0xff,
      alpha: (c & 0xff) / 255,
    };
  }
  const rgb: { r: number; g: number; b: number; alpha?: number } = {
    r: input[0] * 255,
    g: input[1] * 255,
    b: input[2] * 255,
  };
  if (input.length >= 4) rgb.alpha = input[3];
  return rgb;
}

/** Packed 0xRRGGBBAA integer to [r, g, b] or [r, g, b, a] with 0-1 values. */
function packedToArray(c: number): number[] {
  const r = ((c >>> 24) & 0xff) / 255;
  const g = ((c >>> 16) & 0xff) / 255;
  const b = ((c >>> 8) & 0xff) / 255;
  const a = (c & 0xff) / 255;
  return Math.abs(a - 1) < 1e-4 ? [r, g, b] : [r, g, b, a];
}

/** Color runtime helpers shared by both SYS objects. */
const colorHelpers = {
  color(input: string): number[] {
    return packedToArray(parseColor(input));
  },
  colorToString(input: string | number[], format?: string): string {
    const rgb = toRgb255(input);
    const fmt = (format ?? 'hex').toLowerCase();
    switch (fmt) {
      case 'hex': {
        const r = Math.round(Math.max(0, Math.min(255, rgb.r)));
        const g = Math.round(Math.max(0, Math.min(255, rgb.g)));
        const b = Math.round(Math.max(0, Math.min(255, rgb.b)));
        let hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
        if (rgb.alpha !== undefined && Math.abs(rgb.alpha - 1) > 1e-4) {
          const a = Math.round(Math.max(0, Math.min(255, rgb.alpha * 255)));
          hex += a.toString(16).padStart(2, '0');
        }
        return hex;
      }
      case 'rgb': {
        const r = Math.round(rgb.r);
        const g = Math.round(rgb.g);
        const b = Math.round(rgb.b);
        if (rgb.alpha !== undefined && Math.abs(rgb.alpha - 1) > 1e-4)
          return `rgb(${r} ${g} ${b} / ${rgb.alpha})`;
        return `rgb(${r} ${g} ${b})`;
      }
      case 'hsl': {
        const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
        const h = Math.round(hsl.h * 10) / 10;
        const s = Math.round(hsl.s * 1000) / 10;
        const l = Math.round(hsl.l * 1000) / 10;
        if (rgb.alpha !== undefined && Math.abs(rgb.alpha - 1) > 1e-4)
          return `hsl(${h} ${s}% ${l}% / ${rgb.alpha})`;
        return `hsl(${h} ${s}% ${l}%)`;
      }
      case 'oklch': {
        const c = rgbToOklch(rgb);
        const L = Math.round(c.L * 1000) / 1000;
        const C = Math.round(c.C * 1000) / 1000;
        const H = Math.round(c.H * 10) / 10;
        if (rgb.alpha !== undefined && Math.abs(rgb.alpha - 1) > 1e-4)
          return `oklch(${L} ${C} ${H} / ${rgb.alpha})`;
        return `oklch(${L} ${C} ${H})`;
      }
      default:
        throw new Error(`Unknown color format: ${fmt}`);
    }
  },
  colorMix(
    input1: string | number[],
    input2: string | number[],
    ratio = 0.5
  ): number[] {
    const rgb1 = toRgb255(input1);
    const rgb2 = toRgb255(input2);
    ratio = Math.max(0, Math.min(1, ratio));
    const c1 = rgbToOklch(rgb1);
    const c2 = rgbToOklch(rgb2);
    // Shorter arc hue interpolation
    let dh = c2.H - c1.H;
    if (dh > 180) dh -= 360;
    if (dh < -180) dh += 360;
    let H = c1.H + dh * ratio;
    if (H < 0) H += 360;
    if (H >= 360) H -= 360;
    const mixed = oklchToRgb({
      L: c1.L + (c2.L - c1.L) * ratio,
      C: c1.C + (c2.C - c1.C) * ratio,
      H,
    });
    const r = mixed.r / 255;
    const g = mixed.g / 255;
    const b = mixed.b / 255;
    const a1 = rgb1.alpha ?? 1;
    const a2 = rgb2.alpha ?? 1;
    const alpha = a1 + (a2 - a1) * ratio;
    return Math.abs(alpha - 1) > 1e-4 ? [r, g, b, alpha] : [r, g, b];
  },
  colorContrast(bg: string | number[], fg: string | number[]): number {
    return apca(toRgb255(bg), toRgb255(fg));
  },
  contrastingColor(
    bg: string | number[],
    fg1?: string | number[],
    fg2?: string | number[]
  ): number[] {
    const bgRgb = toRgb255(bg);
    if (fg1 !== undefined && fg2 !== undefined) {
      return packedToArray(
        contrastingColor({ bg: bgRgb, fg1: toRgb255(fg1), fg2: toRgb255(fg2) })
      );
    }
    return packedToArray(contrastingColor(bgRgb));
  },
  colorToColorspace(input: string | number[], space: string): number[] {
    const rgb = toRgb255(input);
    const alpha = rgb.alpha;
    let result: number[];
    switch (space.toLowerCase()) {
      case 'rgb':
        result = [rgb.r / 255, rgb.g / 255, rgb.b / 255];
        break;
      case 'hsl': {
        const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
        result = [hsl.h, hsl.s, hsl.l];
        break;
      }
      case 'oklch': {
        const c = rgbToOklch(rgb);
        result = [c.L, c.C, c.H];
        break;
      }
      case 'oklab':
      case 'lab': {
        const lab = rgbToOklab(rgb);
        result = [lab.L, lab.a, lab.b];
        break;
      }
      default:
        throw new Error(`Unknown color space: ${space}`);
    }
    if (alpha !== undefined && Math.abs(alpha - 1) > 1e-4) result.push(alpha);
    return result;
  },
  colormap(name: string, arg?: number): number[] | number[][] {
    const allPalettes = {
      ...SEQUENTIAL_PALETTES,
      ...CATEGORICAL_PALETTES,
      ...DIVERGING_PALETTES,
    };
    const palette = allPalettes[name as keyof typeof allPalettes];
    if (!palette) throw new Error(`Unknown palette: ${name}`);

    // Convert hex strings to [r, g, b] arrays (0-1)
    const colors = (palette as readonly string[]).map((hex: string) => {
      const rgb = asRgb(parseColor(hex));
      return [rgb.r / 255, rgb.g / 255, rgb.b / 255] as [
        number,
        number,
        number,
      ];
    });

    // No second arg → return full palette
    if (arg === undefined) return colors;

    // Integer n >= 2 → resample to n evenly spaced colors
    if (Number.isInteger(arg) && arg >= 2) {
      const n = arg;
      const result: number[][] = [];
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : i / (n - 1);
        result.push(this._interpolatePalette(colors, t));
      }
      return result;
    }

    // Float t in [0, 1] → interpolate at position t
    const t = Math.max(0, Math.min(1, arg));
    return this._interpolatePalette(colors, t);
  },

  _interpolatePalette(colors: [number, number, number][], t: number): number[] {
    if (colors.length === 0) return [0, 0, 0];
    if (t <= 0) return [...colors[0]];
    if (t >= 1) return [...colors[colors.length - 1]];

    const pos = t * (colors.length - 1);
    const i = Math.floor(pos);
    const frac = pos - i;

    if (frac === 0 || i >= colors.length - 1)
      return [...colors[Math.min(i, colors.length - 1)]];

    // Interpolate in OKLCh for perceptual uniformity
    const rgb1 = {
      r: colors[i][0] * 255,
      g: colors[i][1] * 255,
      b: colors[i][2] * 255,
    };
    const rgb2 = {
      r: colors[i + 1][0] * 255,
      g: colors[i + 1][1] * 255,
      b: colors[i + 1][2] * 255,
    };
    const c1 = rgbToOklch(rgb1);
    const c2 = rgbToOklch(rgb2);

    // Shorter arc hue interpolation
    let dh = c2.H - c1.H;
    if (dh > 180) dh -= 360;
    if (dh < -180) dh += 360;
    let H = c1.H + dh * frac;
    if (H < 0) H += 360;
    if (H >= 360) H -= 360;

    const mixed = oklchToRgb({
      L: c1.L + (c2.L - c1.L) * frac,
      C: c1.C + (c2.C - c1.C) * frac,
      H,
    });
    return [mixed.r / 255, mixed.g / 255, mixed.b / 255];
  },

  colorFromColorspace(components: number[], space: string): number[] {
    const c0 = components[0];
    const c1 = components[1];
    const c2 = components[2];
    const alpha = components.length >= 4 ? components[3] : undefined;
    let result: number[];
    switch (space.toLowerCase()) {
      case 'rgb':
        result = [c0, c1, c2];
        break;
      case 'hsl': {
        const r = hslToRgb(c0, c1, c2);
        result = [r.r / 255, r.g / 255, r.b / 255];
        break;
      }
      case 'oklch': {
        const r = oklchToRgb({ L: c0, C: c1, H: c2 });
        result = [r.r / 255, r.g / 255, r.b / 255];
        break;
      }
      case 'oklab':
      case 'lab': {
        const r = oklabToRgb({ L: c0, a: c1, b: c2 });
        result = [r.r / 255, r.g / 255, r.b / 255];
        break;
      }
      default:
        throw new Error(`Unknown color space: ${space}`);
    }
    if (alpha !== undefined && Math.abs(alpha - 1) > 1e-4) result.push(alpha);
    return result;
  },
};

/**
 * Runtime helpers injected as `_SYS` into compiled JavaScript functions.
 * Shared by both ComputeEngineFunction and ComputeEngineFunctionLiteral.
 */
const SYS_HELPERS = {
  chop,
  factorial,
  factorial2,
  gamma,
  gcd,
  heaviside: (x: number) => (x < 0 ? 0 : x === 0 ? 0.5 : 1),
  integrate: (f, a, b) => monteCarloEstimate(f, a, b, 10e6).estimate,
  lcm,
  lngamma: gammaln,
  limit,
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
  sinc,
  fresnelS,
  fresnelC,
  binomial: choose,
  fibonacci,
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
  ccot: (z) => toRI(new Complex(z.re, z.im).cot()),
  csec: (z) => toRI(new Complex(z.re, z.im).sec()),
  ccsc: (z) => toRI(new Complex(z.re, z.im).csc()),
  ccoth: (z) => toRI(new Complex(z.re, z.im).coth()),
  csech: (z) => toRI(new Complex(z.re, z.im).sech()),
  ccsch: (z) => toRI(new Complex(z.re, z.im).csch()),
  cacot: (z) => toRI(new Complex(z.re, z.im).acot()),
  casec: (z) => toRI(new Complex(z.re, z.im).asec()),
  cacsc: (z) => toRI(new Complex(z.re, z.im).acsc()),
  cacoth: (z) => toRI(new Complex(z.re, z.im).acoth()),
  casech: (z) => toRI(new Complex(z.re, z.im).asech()),
  cacsch: (z) => toRI(new Complex(z.re, z.im).acsch()),
  cabs: (z) => new Complex(z.re, z.im).abs(),
  carg: (z) => new Complex(z.re, z.im).arg(),
  cconj: (z) => toRI(new Complex(z.re, z.im).conjugate()),
  cneg: (z) => ({ re: -z.re, im: -z.im }),
  // Color helpers
  ...colorHelpers,
};

/**
 * JavaScript-specific function extension that provides system functions
 */
export class ComputeEngineFunction extends Function {
  SYS = SYS_HELPERS;

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
  SYS = SYS_HELPERS;

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
    const {
      operators,
      functions,
      vars,
      imports = [],
      preamble,
      realOnly,
    } = options;
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

    return compileToTarget(expr, target, realOnly);
  }
}

/**
 * Compile expression to JavaScript executable
 */
function wrapRealOnly(result: CompilationResult): CompilationResult {
  if (!result.run) return result;
  const origRun = result.run;
  result.run = ((...args: unknown[]) => {
    const r = origRun(...args);
    if (typeof r === 'object' && r !== null && 'im' in r)
      return r.im === 0 ? r.re : NaN;
    return r;
  }) as CompilationResult['run'];
  return result;
}

function compileToTarget(
  expr: Expression,
  target: CompileTarget<Expression>,
  realOnly?: boolean
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
      run: fn as unknown as CompilationResult['run'],
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
        run: fn as unknown as CompilationResult['run'],
      };
    }
  }

  const js = BaseCompiler.compile(expr, target);
  const fn = new ComputeEngineFunction(js, target.preamble);
  const result: CompilationResult = {
    target: 'javascript',
    success: true,
    code: js,
    run: fn as unknown as CompilationResult['run'],
  };
  return realOnly ? wrapRealOnly(result) : result;
}

/**
 * Maximum number of terms to unroll in a Sum/Product.
 * Beyond this threshold a loop is emitted instead.
 */
const UNROLL_LIMIT = 100;

/**
 * Extract index, lower, and upper from a Limits expression.
 * Returns the raw Expression nodes so they can be compiled (not just evaluated
 * to numbers). Also provides numeric values when bounds are constant.
 */
function extractLimits(limitsExpr: Expression): {
  index: string;
  lowerExpr: Expression;
  upperExpr: Expression;
  lowerNum: number | undefined;
  upperNum: number | undefined;
} {
  console.assert(limitsExpr.operator === 'Limits');
  const fn = limitsExpr as Expression & { op1: Expression; op2: Expression; op3: Expression };
  const index = isSymbol(fn.op1) ? fn.op1.symbol : '_';
  const lowerExpr = fn.op2;
  const upperExpr = fn.op3;
  const lowerRe = lowerExpr.re;
  const upperRe = upperExpr.re;
  return {
    index,
    lowerExpr,
    upperExpr,
    lowerNum: !isNaN(lowerRe) && Number.isFinite(lowerRe) ? Math.floor(lowerRe) : undefined,
    upperNum: !isNaN(upperRe) && Number.isFinite(upperRe) ? Math.floor(upperRe) : undefined,
  };
}

/**
 * Compile a bound expression to JavaScript code.
 * For numeric constants, emits the number directly.
 * For symbolic expressions, compiles using Math.floor() to ensure integer bounds.
 */
function compileBound(
  expr: Expression,
  numVal: number | undefined,
  target: CompileTarget<Expression>
): string {
  if (numVal !== undefined) return String(numVal);
  return `Math.floor(${BaseCompiler.compile(expr, target)})`;
}

/**
 * Compile Sum or Product.
 *
 * When both bounds are constant integers, small ranges (<=UNROLL_LIMIT terms)
 * are unrolled into explicit additions/multiplications. Larger ranges or
 * symbolic bounds emit a while-loop wrapped in an IIFE.
 */
function compileSumProduct(
  kind: 'Sum' | 'Product',
  args: ReadonlyArray<Expression>,
  _compile: (expr: Expression) => string,
  target: CompileTarget<Expression>
): string {
  if (!args[0]) throw new Error(`${kind}: no body`);
  if (!args[1]) throw new Error(`${kind}: no indexing set`);

  const { index, lowerExpr, upperExpr, lowerNum, upperNum } = extractLimits(args[1]);
  const isSum = kind === 'Sum';
  const op = isSum ? '+' : '*';
  const identity = isSum ? '0' : '1';
  const bodyIsComplex = BaseCompiler.isComplexValued(args[0]);

  const bothConstant = lowerNum !== undefined && upperNum !== undefined;

  // Empty range (only knowable when both bounds are constant)
  if (bothConstant && lowerNum > upperNum) return identity;

  // Unroll when both bounds are constant and range is small
  if (bothConstant) {
    const termCount = upperNum - lowerNum + 1;
    if (termCount <= UNROLL_LIMIT) {
      const terms: string[] = [];
      for (let k = lowerNum; k <= upperNum; k++) {
        const innerTarget: CompileTarget<Expression> = {
          ...target,
          var: (id) => (id === index ? String(k) : target.var(id)),
        };
        terms.push(`(${BaseCompiler.compile(args[0], innerTarget)})`);
      }

      if (!bodyIsComplex) {
        return `(${terms.join(` ${op} `)})`;
      }

      const temps = terms.map((_, i) => `_t${i}`);
      const assignments = terms
        .map((t, i) => `const ${temps[i]} = ${t}`)
        .join('; ');

      if (isSum) {
        const reSum = temps.map((t) => `${t}.re`).join(' + ');
        const imSum = temps.map((t) => `${t}.im`).join(' + ');
        return `(() => { ${assignments}; return { re: ${reSum}, im: ${imSum} }; })()`;
      }

      let acc = temps[0];
      const parts = [assignments];
      for (let i = 1; i < temps.length; i++) {
        const prev = acc;
        acc = `_p${i}`;
        parts.push(
          `const ${acc} = { re: ${prev}.re * ${temps[i]}.re - ${prev}.im * ${temps[i]}.im, im: ${prev}.re * ${temps[i]}.im + ${prev}.im * ${temps[i]}.re }`
        );
      }
      return `(() => { ${parts.join('; ')}; return ${acc}; })()`;
    }
  }

  // Emit a loop (either large constant range or symbolic bounds)
  const lowerCode = compileBound(lowerExpr, lowerNum, target);
  const upperCode = compileBound(upperExpr, upperNum, target);

  const bodyCode = BaseCompiler.compile(args[0], {
    ...target,
    var: (id) => (id === index ? index : target.var(id)),
  });

  const acc = BaseCompiler.tempVar();

  if (bodyIsComplex) {
    const val = BaseCompiler.tempVar();
    if (isSum) {
      return `(() => { let ${acc} = { re: 0, im: 0 }; let ${index} = ${lowerCode}; const _upper = ${upperCode}; while (${index} <= _upper) { const ${val} = ${bodyCode}; ${acc} = { re: ${acc}.re + ${val}.re, im: ${acc}.im + ${val}.im }; ${index}++; } return ${acc}; })()`;
    }
    return `(() => { let ${acc} = { re: 1, im: 0 }; let ${index} = ${lowerCode}; const _upper = ${upperCode}; while (${index} <= _upper) { const ${val} = ${bodyCode}; ${acc} = { re: ${acc}.re * ${val}.re - ${acc}.im * ${val}.im, im: ${acc}.re * ${val}.im + ${acc}.im * ${val}.re }; ${index}++; } return ${acc}; })()`;
  }

  return `(() => { let ${acc} = ${identity}; let ${index} = ${lowerCode}; const _upper = ${upperCode}; while (${index} <= _upper) { ${acc} ${op}= ${bodyCode}; ${index}++; } return ${acc}; })()`;
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

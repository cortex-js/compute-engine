import type { Expression } from '../global-types.js';
import type { MathJsonSymbol } from '../../math-json/types.js';
import {
  isSymbol,
  isNumber,
  isFunction,
} from '../boxed-expression/type-guards.js';
import { Complex } from 'complex-esm';
import { tryGetConstant } from './constant-folding.js';

import {
  chop,
  factorial,
  factorial2,
  gcd,
  lcm,
  limit,
} from '../numerics/numeric.js';
import {
  parseColor,
  rgbToOklch,
  oklchToRgb,
  rgbToOklab,
  oklabToOklch,
  oklchToOklab,
  rgbToHsl,
  hslToRgb,
  rgbToHsv,
  hsvToRgb,
  oklabDeltaE,
  apca,
  contrastingColor,
  SEQUENTIAL_PALETTES,
  CATEGORICAL_PALETTES,
  DIVERGING_PALETTES,
} from '@arnog/colors';
import type { HexColor } from '@arnog/colors';
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
  sinIntegral,
  cosIntegral,
  expIntegralEi,
  logIntegral,
  erfi,
  agm,
  ellipticK,
  ellipticE,
  ellipticEIncomplete,
  ellipticF,
  ellipticPiComplete,
  ellipticPiIncomplete,
  hypergeometric2F1,
  hypergeometric1F1,
  gammaQ,
  betaRegularized,
} from '../numerics/special-functions.js';
import { choose } from '../boxed-expression/expand.js';
import {
  correlation,
  covariance,
  interquartileRange,
  kurtosis,
  mean,
  median,
  mode,
  populationCovariance,
  populationStandardDeviation,
  populationVariance,
  quartiles,
  skewness,
  standardDeviation,
  variance,
} from '../numerics/statistics.js';
import { monteCarloEstimate } from '../numerics/monte-carlo.js';

import { BaseCompiler } from './base-compiler.js';
import { rewriteAngularUnit } from './angular-unit.js';
import type {
  CompileTarget,
  CompiledOperators,
  CompiledFunctions,
  LanguageTarget,
  CompilationOptions,
  CompilationResult,
  CompiledRunner,
  ComplexResult,
  TargetSource,
} from './types.js';

/**
 * JavaScript operator mappings
 */
const JAVASCRIPT_OPERATORS: CompiledOperators = {
  Add: ['+', 11],
  Negate: ['-', 14], // Unary operator
  Subtract: ['-', 11],
  Multiply: ['*', 12],
  Divide: ['/', 13],
  // Equal / NotEqual are NOT operators: a raw `===` is exact, but the
  // interpreter compares numbers within `engine.tolerance`. They are handled as
  // function forms (see `compileJSEquality`) so `0.1 + 0.2 === 0.3` matches the
  // interpreter's `True`.
  LessEqual: ['<=', 9],
  GreaterEqual: ['>=', 9],
  Less: ['<', 9],
  Greater: ['>', 9],
  And: ['&&', 4],
  Or: ['||', 3],
  Not: ['!', 14], // Unary operator
};

/**
 * Emit a JavaScript equality test with the engine's numeric tolerance baked in
 * at compile time. The interpreter treats two numbers as equal when
 * `|a − b| <= engine.tolerance` (default 1e-10) — so `0.1 + 0.2 === 0.3` is
 * *true* — whereas a raw `===` is exact and would disagree. `kind` selects
 * Equal (`<=`) vs NotEqual (`>`). Complex operands compare on the modulus of
 * the difference (`_SYS.cabs`). Chained (N-ary) forms conjoin pairwise with
 * `&&`.
 */
function compileJSEquality(
  kind: 'Equal' | 'NotEqual',
  args: ReadonlyArray<Expression>,
  compile: (e: Expression) => string
): string {
  if (args.length < 2)
    throw new Error(`${kind}: expected at least two arguments`);
  const tol = args[0]?.engine?.tolerance ?? 1e-10;
  const cmp = kind === 'Equal' ? '<=' : '>';
  const distance = (a: Expression, b: Expression): string => {
    const anyComplex =
      BaseCompiler.isComplexValued(a) || BaseCompiler.isComplexValued(b);
    if (!anyComplex) return `Math.abs((${compile(a)}) - (${compile(b)}))`;
    // Promote each operand to `{ re, im }` and take the modulus of the
    // difference. A real operand contributes `re = code`, `im = 0`.
    const part = (e: Expression): { re: string; im: string } => {
      const c = compile(e);
      return BaseCompiler.isComplexValued(e)
        ? { re: `(${c}).re`, im: `(${c}).im` }
        : { re: `(${c})`, im: '0' };
    };
    const pa = part(a);
    const pb = part(b);
    return `_SYS.cabs({ re: ${pa.re} - ${pb.re}, im: ${pa.im} - ${pb.im} })`;
  };
  const pair = (a: Expression, b: Expression): string =>
    `(${distance(a, b)} ${cmp} ${tol})`;
  if (args.length === 2) return pair(args[0], args[1]);
  const parts: string[] = [];
  for (let i = 0; i < args.length - 1; i++)
    parts.push(pair(args[i], args[i + 1]));
  return `(${parts.join(' && ')})`;
}

/**
 * JavaScript function implementations
 */
const JAVASCRIPT_FUNCTIONS: CompiledFunctions<Expression> = {
  // Tolerance-aware equality (see compileJSEquality). Not operators — a raw
  // `===` is exact and disagrees with the interpreter's tolerant compare.
  Equal: (args, compile) => compileJSEquality('Equal', args, compile),
  NotEqual: (args, compile) => compileJSEquality('NotEqual', args, compile),
  Abs: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_SYS.cabs(${compile(args[0])})`;
    if (BaseCompiler.isNonNegative(args[0])) return compile(args[0]);
    return `Math.abs(${compile(args[0])})`;
  },
  Add: (args, compile) => {
    if (args.length === 1) return compile(args[0]);
    const anyComplex = args.some((a) => BaseCompiler.isComplexValued(a));
    if (!anyComplex) {
      // Try full constant fold
      const constants = args.map(tryGetConstant);
      if (constants.every((c) => c !== undefined))
        return String(constants.reduce((a, b) => a! + b!, 0));
      // Filter out zero-valued operands
      const nonZero = args.filter((a) => tryGetConstant(a) !== 0);
      if (nonZero.length === 0) return '0';
      if (nonZero.length === 1) return compile(nonZero[0]);
      return `(${nonZero.map((x) => compile(x)).join(' + ')})`;
    }

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
    // `Math.atan(1/x)` returns the wrong branch for x < 0 (range (-π/2, 0)
    // instead of the interpreter's (0, π)). `π/2 - atan(x)` is branch-free and
    // gives the full (0, π) range for all real x.
    return `(Math.PI / 2 - Math.atan(${compile(x)}))`;
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
  Ceil: (args, compile) => {
    if (BaseCompiler.isIntegerValued(args[0])) return compile(args[0]);
    return `Math.ceil(${compile(args[0])})`;
  },
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
  First: (args, compile) => `${compile(args[0])}[0]`,
  Floor: (args, compile) => {
    if (BaseCompiler.isIntegerValued(args[0])) return compile(args[0]);
    return `Math.floor(${compile(args[0])})`;
  },
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
    return `_SYS.populationVariance([${args
      .map((x) => compile(x))
      .join(', ')}])`;
  },
  StandardDeviation: (args, compile) => {
    if (args.length === 0) return 'NaN';
    if (args.length === 1) return `_SYS.standardDeviation(${compile(args[0])})`;
    return `_SYS.standardDeviation([${args
      .map((x) => compile(x))
      .join(', ')}])`;
  },
  PopulationStandardDeviation: (args, compile) => {
    if (args.length === 0) return 'NaN';
    if (args.length === 1)
      return `_SYS.populationStandardDeviation(${compile(args[0])})`;
    return `_SYS.populationStandardDeviation([${args
      .map((x) => compile(x))
      .join(', ')}])`;
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
    return `_SYS.interquartileRange([${args
      .map((x) => compile(x))
      .join(', ')}])`;
  },
  // Covariance/Correlation compile only for the two-collection form; the
  // one-collection-of-pairs form fails closed (per compile policy).
  Covariance: (args, compile) => {
    if (args.length !== 2)
      throw new Error(
        'Covariance: expected two collection arguments to compile'
      );
    return `_SYS.covariance(${compile(args[0])}, ${compile(args[1])})`;
  },
  PopulationCovariance: (args, compile) => {
    if (args.length !== 2)
      throw new Error(
        'PopulationCovariance: expected two collection arguments to compile'
      );
    return `_SYS.populationCovariance(${compile(args[0])}, ${compile(args[1])})`;
  },
  Correlation: (args, compile) => {
    if (args.length !== 2)
      throw new Error(
        'Correlation: expected two collection arguments to compile'
      );
    return `_SYS.correlation(${compile(args[0])}, ${compile(args[1])})`;
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
    const bConst = tryGetConstant(base);
    const eConst = tryGetConstant(exp);
    if (bConst !== undefined && eConst !== undefined) {
      const r = Math.pow(bConst, eConst);
      // A NaN fold means the real-valued result does not exist (e.g. a negative
      // base with a fractional exponent → complex). Fail closed (D6) instead of
      // emitting a literal `NaN` program with `success: true`.
      if (Number.isNaN(r))
        throw new Error(
          `Power(${bConst}, ${eConst}) has no real value; cannot compile to a real target`
        );
      return String(r);
    }
    if (eConst === 0) return '1';
    if (eConst === 1) return compile(base);
    if (eConst === 2 && (isSymbol(base) || isNumber(base))) {
      const code = compile(base);
      return `(${code} * ${code})`;
    }
    if (eConst === -1) return `(1 / (${compile(base)}))`;
    if (eConst === 0.5) return `Math.sqrt(${compile(base)})`;
    if (eConst === 1 / 3) return `Math.cbrt(${compile(base)})`;
    if (eConst === -0.5) return `(1 / Math.sqrt(${compile(base)}))`;
    // Constant nonzero exponent: `Math.pow` matches the interpreter (0^k = 0
    // for k > 0, etc.). A *variable* exponent could be 0 at run time against a
    // 0 base — a genuine 0^0 — where `Math.pow` yields 1 but the interpreter
    // yields NaN; route those through `_SYS.pow` to align (D6, CO-P2-24).
    if (eConst === undefined)
      return `_SYS.pow(${compile(base)}, ${compile(exp)})`;
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

      // `parseFloat` returns NaN (never null) for symbolic bounds, so a
      // `!== null` guard would always pass and emit `Array.from({length: NaN})`
      // — silently yielding `[]` for any symbolic Range. Test for numeric
      // constants with `!isNaN`; symbolic bounds fall through to the runtime
      // length branch below.
      if (!isNaN(fStop) && !isNaN(fStart)) {
        if (fStop - fStart < 50) {
          return `[${Array.from(
            { length: fStop - fStart + 1 },
            (_, i) => fStart + i
          ).join(', ')}]`;
        }
        return `Array.from({length: ${fStop - fStart + 1} 
        }, (_, i) => ${start} + i)`;
      }

      // The map callback's throwaway element parameter must not be named `_`:
      // the compiled function binds its argument object to `_`, and a symbolic
      // bound compiles to a member access like `_.a`. A `_` callback param
      // would shadow the argument object, so `_.a` in the body would read from
      // the (undefined) array element. Use `_e` for the unused element.
      return `Array.from({length: ${stop} - ${start} + 1
      }, (_e, i) => ${start} + i)`;
    }
    return `Array.from({length: Math.floor((${stop} - ${start}) / ${step}) + 1}, (_e, i) => ${start} + i * ${step})`;
  },
  Root: ([arg, exp], compile) => {
    if (arg === null) throw new Error('Root: no argument');
    if (exp === null) return `Math.sqrt(${compile(arg)})`;
    const aConst = tryGetConstant(arg);
    const nConst = tryGetConstant(exp);
    if (aConst !== undefined && nConst !== undefined && nConst !== 0) {
      const r = Math.pow(aConst, 1 / nConst);
      if (Number.isNaN(r)) {
        // Negative base. An odd integer degree has a real root (the
        // interpreter's convention, e.g. Root(-8, 3) = -2); an even degree is
        // complex, so fail closed (D6).
        if (Number.isInteger(nConst) && nConst % 2 !== 0 && aConst < 0)
          return String(-Math.pow(-aConst, 1 / nConst));
        throw new Error(
          `Root(${aConst}, ${nConst}) has no real value; cannot compile to a real target`
        );
      }
      return String(r);
    }
    if (nConst === 2) return `Math.sqrt(${compile(arg)})`;
    if (nConst === 3) return `Math.cbrt(${compile(arg)})`;
    // Odd integer degree: `Math.pow` is NaN for a negative base, but the real
    // root exists. Emit the sign-corrected form `sign(x)·|x|^(1/n)`.
    if (nConst !== undefined && Number.isInteger(nConst) && nConst % 2 !== 0)
      return BaseCompiler.inlineExpression(
        `(Math.sign(\${x}) * Math.pow(Math.abs(\${x}), ${1 / nConst}))`,
        compile(arg)
      );
    if (nConst !== undefined) return `Math.pow(${compile(arg)}, ${1 / nConst})`;
    return `Math.pow(${compile(arg)}, 1 / (${compile(exp)}))`;
  },
  Random: (args, compile) => {
    if (args.length === 0) return 'Math.random()';
    if (args.length === 2) {
      // Random(m, n): integer in [m, n)
      const m = compile(args[0]);
      const n = compile(args[1]);
      return `((${m}) + Math.floor(Math.random() * ((${n}) - (${m}))))`;
    }
    // One arg — branch on the arg's type.
    const arg = args[0];
    if (BaseCompiler.isIntegerValued(arg)) {
      // Integer-bound: Random(n) → integer in [0, n)
      return `Math.floor(Math.random() * (${compile(arg)}))`;
    }
    // Real seed: deterministic float in [0, 1)
    // Inline the hash; no runtime helper is required.
    const a = compile(arg);
    return `(() => { const _s = (${a}) * 12.9898; const _v = Math.sin(_s) * 43758.5453; return _v - Math.floor(_v); })()`;
  },
  Round: (args, compile) => {
    if (BaseCompiler.isIntegerValued(args[0])) return compile(args[0]);
    // The interpreter rounds half away from zero (Round(-2.5) = -3); JS
    // `Math.round` rounds half toward +∞ (Round(-2.5) = -2). Reconstruct
    // half-away as `sign(x)·round(|x|)`.
    return BaseCompiler.inlineExpression(
      '(Math.sign(${x}) * Math.round(Math.abs(${x})))',
      compile(args[0])
    );
  },
  Square: (args, compile) => {
    const arg = args[0];
    if (arg === null) throw new Error('Square: no argument');
    const c = tryGetConstant(arg);
    if (c !== undefined) return String(c * c);
    if (isSymbol(arg)) {
      const code = compile(arg);
      return `(${code} * ${code})`;
    }
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
  Second: (args, compile) => `${compile(args[0])}[1]`,
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
    const c = tryGetConstant(args[0]);
    if (c !== undefined) {
      const r = Math.sqrt(c);
      // A negative constant has no real square root (interpreter returns a
      // complex value). Fail closed (D6) rather than fold to a literal `NaN`.
      if (Number.isNaN(r))
        throw new Error(
          `Sqrt(${c}) has no real value; cannot compile to a real target`
        );
      return String(r);
    }
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
  Third: (args, compile) => `${compile(args[0])}[2]`,
  Mod: ([a, b], compile) => {
    if (a === null || b === null) throw new Error('Mod: missing argument');
    const ca = compile(a);
    const cb = compile(b);
    // For non-negative integers, plain % is correct Euclidean modulo
    if (
      BaseCompiler.isIntegerValued(a) &&
      BaseCompiler.isIntegerValued(b) &&
      BaseCompiler.isNonNegative(a)
    )
      return `(${ca} % ${cb})`;
    return `((${ca} % ${cb}) + ${cb}) % ${cb}`;
  },
  Truncate: (args, compile) => {
    if (BaseCompiler.isIntegerValued(args[0])) return compile(args[0]);
    return `Math.trunc(${compile(args[0])})`;
  },
  Remainder: ([a, b], compile) => {
    if (a === null || b === null)
      throw new Error('Remainder: missing argument');
    return `(${compile(a)} - ${compile(b)} * Math.round(${compile(
      a
    )} / ${compile(b)}))`;
  },

  // No Subtract function handler — Subtract canonicalizes to Add+Negate.
  // The operator entry in JAVASCRIPT_OPERATORS handles any edge cases.
  Divide: ([a, b], compile) => {
    if (a === null || b === null) throw new Error('Divide: missing argument');
    const ac = BaseCompiler.isComplexValued(a);
    const bc = BaseCompiler.isComplexValued(b);
    if (!ac && !bc) {
      const ca = tryGetConstant(a);
      const cb = tryGetConstant(b);
      if (ca !== undefined && cb !== undefined && cb !== 0)
        return String(ca / cb);
      if (cb === 1) return compile(a);
      return `(${compile(a)} / ${compile(b)})`;
    }

    if (ac && bc) {
      return `(() => { const _a = ${compile(a)}, _b = ${compile(
        b
      )}, _d = _b.re * _b.re + _b.im * _b.im; return { re: (_a.re * _b.re + _a.im * _b.im) / _d, im: (_a.im * _b.re - _a.re * _b.im) / _d }; })()`;
    }
    if (ac && !bc) {
      return `(() => { const _a = ${compile(a)}, _r = ${compile(
        b
      )}; return { re: _a.re / _r, im: _a.im / _r }; })()`;
    }
    return `(() => { const _r = ${compile(a)}, _b = ${compile(
      b
    )}, _d = _b.re * _b.re + _b.im * _b.im; return { re: _r * _b.re / _d, im: -_r * _b.im / _d }; })()`;
  },
  Negate: ([x], compile) => {
    if (x === null) throw new Error('Negate: no argument');
    if (!BaseCompiler.isComplexValued(x)) {
      const c = tryGetConstant(x);
      if (c !== undefined) return String(-c);
      return `(-${compile(x)})`;
    }
    return `_SYS.cneg(${compile(x)})`;
  },
  Multiply: (args, compile) => {
    if (args.length === 1) return compile(args[0]);
    const anyComplex = args.some((a) => BaseCompiler.isComplexValued(a));
    if (!anyComplex) {
      // Short-circuit on zero
      if (args.some((a) => tryGetConstant(a) === 0)) return '0';
      // Try full constant fold
      const constants = args.map(tryGetConstant);
      if (constants.every((c) => c !== undefined))
        return String(constants.reduce((a, b) => a! * b!, 1));
      // Filter out identity (1) operands
      const nonOne = args.filter((a) => tryGetConstant(a) !== 1);
      if (nonOne.length === 0) return '1';
      if (nonOne.length === 1) return compile(nonOne[0]);
      return `(${nonOne.map((x) => compile(x)).join(' * ')})`;
    }

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
  Erfi: '_SYS.erfi',

  // Special functions
  Beta: '_SYS.beta',
  // Regularized incomplete gamma/beta. Argument order matches the kernels
  // directly (GammaRegularized(a, z) = Q(a, z); BetaRegularized(x, a, b) =
  // I_x(a, b)), so a plain name mapping suffices.
  GammaRegularized: '_SYS.gammaQ',
  BetaRegularized: '_SYS.betaRegularized',
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

  // Exponential / trigonometric / logarithmic integrals. These are the closed
  // forms the antiderivative engine emits (e.g. ∫sin x/x dx = SinIntegral(x)),
  // so an "evaluate then compile" pipeline must be able to lower them.
  SinIntegral: '_SYS.sinIntegral',
  CosIntegral: '_SYS.cosIntegral',
  ExpIntegralEi: '_SYS.expIntegralEi',
  LogIntegral: '_SYS.logIntegral',

  // Arithmetic-geometric mean and elliptic integrals (parameter convention
  // m = k², as in the library). `AGM`, `EllipticE`, and `EllipticPi` are
  // arity-overloaded — the handlers mirror the library's evaluate dispatch.
  AGM: (args, compile) =>
    args.length === 1
      ? `_SYS.agm(1, ${compile(args[0])})`
      : `_SYS.agm(${compile(args[0])}, ${compile(args[1])})`,
  EllipticK: '_SYS.ellipticK',
  EllipticE: (args, compile) =>
    args.length === 2
      ? `_SYS.ellipticEIncomplete(${compile(args[0])}, ${compile(args[1])})`
      : `_SYS.ellipticE(${compile(args[0])})`,
  EllipticF: (args, compile) =>
    `_SYS.ellipticF(${compile(args[0])}, ${compile(args[1])})`,
  EllipticPi: (args, compile) =>
    args.length === 3
      ? `_SYS.ellipticPiIncomplete(${compile(args[0])}, ${compile(
          args[1]
        )}, ${compile(args[2])})`
      : `_SYS.ellipticPiComplete(${compile(args[0])}, ${compile(args[1])})`,

  // Hypergeometric functions.
  Hypergeometric2F1: (args, compile) =>
    `_SYS.hypergeometric2F1(${compile(args[0])}, ${compile(args[1])}, ${compile(
      args[2]
    )}, ${compile(args[3])})`,
  Hypergeometric1F1: (args, compile) =>
    `_SYS.hypergeometric1F1(${compile(args[0])}, ${compile(args[1])}, ${compile(
      args[2]
    )})`,

  // Combinatorics
  Mandelbrot: ([c, maxIter], compile) => {
    if (c === null || maxIter === null)
      throw new Error('Mandelbrot: missing arguments');
    return `_SYS.mandelbrot(${compile(c)}, ${compile(maxIter)})`;
  },
  Julia: ([z, c, maxIter], compile) => {
    if (z === null || c === null || maxIter === null)
      throw new Error('Julia: missing arguments');
    return `_SYS.julia(${compile(z)}, ${compile(c)}, ${compile(maxIter)})`;
  },

  Binomial: (args, compile) =>
    `_SYS.binomial(${compile(args[0])}, ${compile(args[1])})`,
  // Choose(n, k) is the binomial coefficient — same runtime helper.
  Choose: (args, compile) =>
    `_SYS.binomial(${compile(args[0])}, ${compile(args[1])})`,
  Fibonacci: '_SYS.fibonacci',

  // Complex-specific functions
  Real: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `(${compile(args[0])}).re`;
    return compile(args[0]);
  },
  Imaginary: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `(${compile(args[0])}).im`;
    return '0';
  },
  Argument: (args, compile) => {
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
      return `_SYS.colorMix(${compile(args[0])}, ${compile(args[1])}, ${compile(
        args[2]
      )})`;
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
      return `_SYS.contrastingColor(${compile(args[0])}, ${compile(
        args[1]
      )}, ${compile(args[2])})`;
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
    return `_SYS.colorFromColorspace(${compile(components)}, ${compile(
      space
    )})`;
  },
  Colormap: (args, compile) => {
    if (args.length === 0) throw new Error('Colormap: no argument');
    if (args.length >= 2)
      return `_SYS.colormap(${compile(args[0])}, ${compile(args[1])})`;
    return `_SYS.colormap(${compile(args[0])})`;
  },

  // -----------------------------------------------------------------------
  // Color constructor heads. All compile to OKLCh arrays at runtime — the
  // canonical color representation in this target. The constructors take
  // their own colorspace's components and convert internally.
  // (Mirrors the GPU target's design: color values are vec3 OKLCh.)
  // -----------------------------------------------------------------------
  Rgb: (args, compile) => {
    if (args.length < 3) throw new Error('Rgb: need 3 components');
    return `_SYS.rgb(${args.map(compile).join(', ')})`;
  },
  Hsv: (args, compile) => {
    if (args.length < 3) throw new Error('Hsv: need 3 components');
    return `_SYS.hsv(${args.map(compile).join(', ')})`;
  },
  Hsl: (args, compile) => {
    if (args.length < 3) throw new Error('Hsl: need 3 components');
    return `_SYS.hsl(${args.map(compile).join(', ')})`;
  },
  Oklab: (args, compile) => {
    if (args.length < 3) throw new Error('Oklab: need 3 components');
    return `_SYS.oklab(${args.map(compile).join(', ')})`;
  },
  Oklch: (args, compile) => {
    if (args.length < 3) throw new Error('Oklch: need 3 components');
    return `_SYS.oklch(${args.map(compile).join(', ')})`;
  },

  // -----------------------------------------------------------------------
  // As* converters. Compile-time output convention matches the engine and
  // the GPU target: each returns components in the named space as a 3- or
  // 4-element array. `AsRgb` uses 0-1 sRGB channels (consistent across all
  // layers). `AsOklch` is the identity (canonical form).
  // -----------------------------------------------------------------------
  AsRgb: ([c], compile) => {
    if (c === null) throw new Error('AsRgb: no argument');
    return `_SYS.asRgb(${compile(c)})`;
  },
  AsHsv: ([c], compile) => {
    if (c === null) throw new Error('AsHsv: no argument');
    return `_SYS.asHsv(${compile(c)})`;
  },
  AsHsl: ([c], compile) => {
    if (c === null) throw new Error('AsHsl: no argument');
    return `_SYS.asHsl(${compile(c)})`;
  },
  AsOklab: ([c], compile) => {
    if (c === null) throw new Error('AsOklab: no argument');
    return `_SYS.asOklab(${compile(c)})`;
  },
  AsOklch: ([c], compile) => {
    if (c === null) throw new Error('AsOklch: no argument');
    return compile(c); // identity — already in canonical form
  },

  // Perceptual color difference (ΔE_OK).
  ColorDelta: ([a, b], compile) => {
    if (a === null || b === null)
      throw new Error('ColorDelta: need two colors');
    return `_SYS.colorDelta(${compile(a)}, ${compile(b)})`;
  },

  // Euclidean distance between two tuples (any positive dimension).
  // The GPU target maps `Distance` to the GLSL/WGSL `distance()` builtin
  // (vec-only); this JS handler works on plain arrays of any length.
  Distance: ([a, b], compile) => {
    if (a === null || b === null) throw new Error('Distance: need two points');
    return `_SYS.distance(${compile(a)}, ${compile(b)})`;
  },
};

/** Convert a Complex instance to a plain {re, im} object */
function toRI(c: Complex): { re: number; im: number } {
  return { re: c.re, im: c.im };
}

/**
 * Canonicalize an alpha value. Returns `undefined` for undefined, non-finite,
 * or effectively-1 inputs so downstream sites can use a simple
 * `alpha !== undefined` check to decide whether to emit it. Mirrors the
 * helper of the same name in `library/colors.ts` so the interpreted and
 * compiled paths agree on alpha semantics.
 */
function normalizeAlpha(a: number | undefined): number | undefined {
  if (a === undefined) return undefined;
  if (!Number.isFinite(a)) return undefined;
  if (Math.abs(a - 1) < 1e-9) return undefined;
  return a;
}

/**
 * Normalize a color input to an `RgbColor` (0-255 channels).
 *
 * Strings are parsed as CSS colors; arrays are interpreted as Oklch
 * `[L, C, H]` (or `[L, C, H, alpha]`) — the canonical compiled-runtime
 * representation produced by `_SYS.color`, `_SYS.colorMix`, etc. Arrays
 * cross the sRGB gamut clip via `oklchToRgb` here.
 */
function toRgb255(input: string | number[]): {
  r: number;
  g: number;
  b: number;
  alpha?: number;
} {
  if (typeof input === 'string') {
    const c = parseColor(input);
    const rgb: { r: number; g: number; b: number; alpha?: number } = {
      r: (c >>> 24) & 0xff,
      g: (c >>> 16) & 0xff,
      b: (c >>> 8) & 0xff,
    };
    const alpha = normalizeAlpha((c & 0xff) / 255);
    if (alpha !== undefined) rgb.alpha = alpha;
    return rgb;
  }
  const rgb = oklchToRgb({ L: input[0], C: input[1], H: input[2] }) as {
    r: number;
    g: number;
    b: number;
    alpha?: number;
  };
  if (input.length >= 4) {
    const alpha = normalizeAlpha(input[3]);
    if (alpha !== undefined) rgb.alpha = alpha;
  }
  return rgb;
}

/** Resolve any color input to Oklch components, preserving alpha if present. */
function toOklch(input: string | number[]): {
  L: number;
  C: number;
  H: number;
  alpha?: number;
} {
  if (typeof input === 'string') {
    const c = parseColor(input);
    const r = (c >>> 24) & 0xff;
    const g = (c >>> 16) & 0xff;
    const b = (c >>> 8) & 0xff;
    const oklch = rgbToOklch({ r, g, b }) as {
      L: number;
      C: number;
      H: number;
      alpha?: number;
    };
    const alpha = normalizeAlpha((c & 0xff) / 255);
    if (alpha !== undefined) oklch.alpha = alpha;
    return oklch;
  }
  return {
    L: input[0],
    C: input[1],
    H: input[2],
    alpha: input.length >= 4 ? normalizeAlpha(input[3]) : undefined,
  };
}

/** Packed 0xRRGGBBAA integer to Oklch `[L, C, H]` or `[L, C, H, alpha]`. */
function packedToOklch(c: number): number[] {
  const r = (c >>> 24) & 0xff;
  const g = (c >>> 16) & 0xff;
  const b = (c >>> 8) & 0xff;
  const oklch = rgbToOklch({ r, g, b });
  const alpha = normalizeAlpha((c & 0xff) / 255);
  return alpha !== undefined
    ? [oklch.L, oklch.C, oklch.H, alpha]
    : [oklch.L, oklch.C, oklch.H];
}

/** Color runtime helpers shared by both SYS objects. */
const colorHelpers = {
  color(input: string): number[] {
    return packedToOklch(parseColor(input));
  },
  colorToString(input: string | number[], format?: string): string {
    const rgb = toRgb255(input);
    const fmt = (format ?? 'hex').toLowerCase();
    switch (fmt) {
      case 'hex': {
        const r = Math.round(Math.max(0, Math.min(255, rgb.r)));
        const g = Math.round(Math.max(0, Math.min(255, rgb.g)));
        const b = Math.round(Math.max(0, Math.min(255, rgb.b)));
        let hex = `#${r.toString(16).padStart(2, '0')}${g
          .toString(16)
          .padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
        if (rgb.alpha !== undefined) {
          const a = Math.round(Math.max(0, Math.min(255, rgb.alpha * 255)));
          hex += a.toString(16).padStart(2, '0');
        }
        return hex;
      }
      case 'rgb': {
        const r = Math.round(rgb.r);
        const g = Math.round(rgb.g);
        const b = Math.round(rgb.b);
        if (rgb.alpha !== undefined)
          return `rgb(${r} ${g} ${b} / ${rgb.alpha})`;
        return `rgb(${r} ${g} ${b})`;
      }
      case 'hsl': {
        const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
        const h = Math.round(hsl.h * 10) / 10;
        const s = Math.round(hsl.s * 1000) / 10;
        const l = Math.round(hsl.l * 1000) / 10;
        if (rgb.alpha !== undefined)
          return `hsl(${h} ${s}% ${l}% / ${rgb.alpha})`;
        return `hsl(${h} ${s}% ${l}%)`;
      }
      case 'oklch': {
        const c = rgbToOklch(rgb);
        const L = Math.round(c.L * 1000) / 1000;
        const C = Math.round(c.C * 1000) / 1000;
        const H = Math.round(c.H * 10) / 10;
        if (rgb.alpha !== undefined)
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
    const c1 = toOklch(input1);
    const c2 = toOklch(input2);
    ratio = Math.max(0, Math.min(1, ratio));

    // Achromatic-aware shortest-arc hue interpolation: when one endpoint has
    // C ≈ 0 its hue is undefined, so use the other endpoint's hue throughout.
    const c1Achromatic = c1.C < 1e-6;
    const c2Achromatic = c2.C < 1e-6;
    let H: number;
    if (c1Achromatic && c2Achromatic) H = c1.H;
    else if (c1Achromatic) H = c2.H;
    else if (c2Achromatic) H = c1.H;
    else {
      let dh = c2.H - c1.H;
      if (dh > 180) dh -= 360;
      if (dh < -180) dh += 360;
      H = c1.H + dh * ratio;
      if (H < 0) H += 360;
      if (H >= 360) H -= 360;
    }

    const L = c1.L + (c2.L - c1.L) * ratio;
    const C = c1.C + (c2.C - c1.C) * ratio;
    const a1 = c1.alpha ?? 1;
    const a2 = c2.alpha ?? 1;
    const alpha = normalizeAlpha(a1 + (a2 - a1) * ratio);
    return alpha !== undefined ? [L, C, H, alpha] : [L, C, H];
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
      return packedToOklch(
        contrastingColor({ bg: bgRgb, fg1: toRgb255(fg1), fg2: toRgb255(fg2) })
      );
    }
    return packedToOklch(contrastingColor(bgRgb));
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
    if (alpha !== undefined) result.push(alpha);
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

    // Each palette stop is stored as Oklch [L, C, H] for perceptually-uniform
    // interpolation and to match the compiled-runtime color representation.
    const colors = (palette as readonly string[]).map((hex: HexColor) =>
      packedToOklch(parseColor(hex))
    );

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

  _interpolatePalette(colors: number[][], t: number): number[] {
    if (colors.length === 0) return [0, 0, 0];
    if (t <= 0) return [...colors[0]];
    if (t >= 1) return [...colors[colors.length - 1]];

    const pos = t * (colors.length - 1);
    const i = Math.floor(pos);
    const frac = pos - i;

    if (frac === 0 || i >= colors.length - 1)
      return [...colors[Math.min(i, colors.length - 1)]];

    // Interpolate directly in Oklch (palette stops are already Oklch).
    const [L1, C1, H1] = colors[i];
    const [L2, C2, H2] = colors[i + 1];

    const c1Achromatic = C1 < 1e-6;
    const c2Achromatic = C2 < 1e-6;
    let H: number;
    if (c1Achromatic && c2Achromatic) H = H1;
    else if (c1Achromatic) H = H2;
    else if (c2Achromatic) H = H1;
    else {
      let dh = H2 - H1;
      if (dh > 180) dh -= 360;
      if (dh < -180) dh += 360;
      H = H1 + dh * frac;
      if (H < 0) H += 360;
      if (H >= 360) H -= 360;
    }

    return [L1 + (L2 - L1) * frac, C1 + (C2 - C1) * frac, H];
  },

  colorFromColorspace(components: number[], space: string): number[] {
    const c0 = components[0];
    const c1 = components[1];
    const c2 = components[2];
    const alpha = components.length >= 4 ? components[3] : undefined;
    let oklch: { L: number; C: number; H: number };
    switch (space.toLowerCase()) {
      case 'rgb':
        oklch = rgbToOklch({ r: c0 * 255, g: c1 * 255, b: c2 * 255 });
        break;
      case 'hsl': {
        const rgb = hslToRgb(c0, c1, c2);
        oklch = rgbToOklch(rgb);
        break;
      }
      case 'oklch':
        oklch = { L: c0, C: c1, H: c2 };
        break;
      case 'oklab':
      case 'lab':
        oklch = oklabToOklch({ L: c0, a: c1, b: c2 });
        break;
      default:
        throw new Error(`Unknown color space: ${space}`);
    }
    return alpha !== undefined
      ? [oklch.L, oklch.C, oklch.H, alpha]
      : [oklch.L, oklch.C, oklch.H];
  },

  // -----------------------------------------------------------------------
  // Color constructors. Each accepts components in its colorspace's natural
  // units and returns the canonical OKLCh array `[L, C, H]` (or with alpha).
  // -----------------------------------------------------------------------
  rgb(r: number, g: number, b: number, alpha?: number): number[] {
    // Inputs are 0-1 sRGB; `rgbToOklch` expects 0-255 channels.
    const c = rgbToOklch({ r: r * 255, g: g * 255, b: b * 255 });
    const a = normalizeAlpha(alpha);
    return a !== undefined ? [c.L, c.C, c.H, a] : [c.L, c.C, c.H];
  },
  hsv(h: number, s: number, v: number, alpha?: number): number[] {
    const rgb = hsvToRgb(h, s, v);
    const c = rgbToOklch(rgb);
    const a = normalizeAlpha(alpha);
    return a !== undefined ? [c.L, c.C, c.H, a] : [c.L, c.C, c.H];
  },
  hsl(h: number, s: number, l: number, alpha?: number): number[] {
    const rgb = hslToRgb(h, s, l);
    const c = rgbToOklch({ r: rgb.r, g: rgb.g, b: rgb.b });
    const a = normalizeAlpha(alpha);
    return a !== undefined ? [c.L, c.C, c.H, a] : [c.L, c.C, c.H];
  },
  oklab(L: number, a: number, b: number, alpha?: number): number[] {
    const c = oklabToOklch({ L, a, b });
    const al = normalizeAlpha(alpha);
    return al !== undefined ? [c.L, c.C, c.H, al] : [c.L, c.C, c.H];
  },
  oklch(L: number, C: number, H: number, alpha?: number): number[] {
    const a = normalizeAlpha(alpha);
    return a !== undefined ? [L, C, H, a] : [L, C, H];
  },

  // -----------------------------------------------------------------------
  // As* converters. Inputs are anything `toOklch` accepts (string, packed
  // int, or OKLCh array). Outputs are 3- or 4-element arrays in the named
  // space. sRGB-based outputs (asRgb/asHsv/asHsl) use 0-1 channels for
  // consistency with the GPU target's shader convention.
  // -----------------------------------------------------------------------
  asRgb(input: string | number[]): number[] {
    const rgb = toRgb255(input);
    const r = rgb.r / 255;
    const g = rgb.g / 255;
    const b = rgb.b / 255;
    return rgb.alpha !== undefined ? [r, g, b, rgb.alpha] : [r, g, b];
  },
  asHsv(input: string | number[]): number[] {
    const rgb = toRgb255(input);
    const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    return rgb.alpha !== undefined
      ? [hsv.h, hsv.s, hsv.v, rgb.alpha]
      : [hsv.h, hsv.s, hsv.v];
  },
  asHsl(input: string | number[]): number[] {
    const rgb = toRgb255(input);
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    return rgb.alpha !== undefined
      ? [hsl.h, hsl.s, hsl.l, rgb.alpha]
      : [hsl.h, hsl.s, hsl.l];
  },
  asOklab(input: string | number[]): number[] {
    const c = toOklch(input);
    const lab = oklchToOklab({ L: c.L, C: c.C, H: c.H });
    return c.alpha !== undefined
      ? [lab.L, lab.a, lab.b, c.alpha]
      : [lab.L, lab.a, lab.b];
  },
  // asOklch is identity — handled at compile time as a pass-through

  // Perceptual color difference (ΔE_OK).
  colorDelta(a: string | number[], b: string | number[]): number {
    const labA = oklchToOklab(toOklch(a));
    const labB = oklchToOklab(toOklch(b));
    return oklabDeltaE(labA, labB);
  },

  // Euclidean distance between two tuples. Plain numeric — not a color
  // operation despite living in the same helpers block.
  distance(a: number[], b: number[]): number {
    if (!Array.isArray(a) || !Array.isArray(b))
      throw new Error('Distance: expected two arrays');
    if (a.length !== b.length) throw new Error('Distance: dimension mismatch');
    let sumSq = 0;
    for (let i = 0; i < a.length; i++) {
      const d = a[i] - b[i];
      sumSq += d * d;
    }
    return Math.sqrt(sumSq);
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
  // Power with the interpreter's 0^0 = NaN convention. `Math.pow(0, 0)` is 1,
  // but the interpreter treats a genuine 0^0 as indeterminate (NaN). Used only
  // on the variable-exponent path — where the exponent could be 0 at run time
  // (a constant nonzero exponent stays on the plain `Math.pow` fast path). See
  // finding CO-P2-24.
  pow: (base: number, exp: number): number =>
    base === 0 && exp === 0 ? NaN : Math.pow(base, exp),
  // Fail-closed Which/When condition guard. The interpreter requires a
  // condition to evaluate to True/False and throws otherwise; a compiled
  // ternary would silently treat a non-boolean (notably NaN) as falsy and take
  // the default branch. Rethrow to match the interpreter (D6, CO-P2-24).
  cond: (c: unknown): boolean => {
    if (c === true || c === false) return c;
    throw new Error('Condition must evaluate to "True" or "False".');
  },
  heaviside: (x: number) => (x < 0 ? 0 : x === 0 ? 0.5 : 1),
  // Definite integral via Monte-Carlo (1e7 uniform samples). STOCHASTIC and
  // approximate (~1e-4 typical error, ~200 ms/call) — see `compileIntegrate`.
  integrate: (f: (x: number) => number, a: number, b: number) =>
    monteCarloEstimate(f, a, b, 10e6).estimate,
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
  covariance,
  populationCovariance,
  correlation,
  erf,
  erfc,
  erfInv,
  beta,
  gammaQ,
  betaRegularized,
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
  sinIntegral,
  cosIntegral,
  expIntegralEi,
  logIntegral,
  erfi,
  agm,
  ellipticK,
  ellipticE,
  ellipticEIncomplete,
  ellipticF,
  ellipticPiComplete,
  ellipticPiIncomplete,
  hypergeometric2F1,
  hypergeometric1F1,
  mandelbrot: (c: number | { re: number; im: number }, maxIter: number) => {
    let zx = 0,
      zy = 0;
    const cx = typeof c === 'number' ? c : c.re;
    const cy = typeof c === 'number' ? 0 : c.im;
    const n = Math.round(maxIter);
    for (let i = 0; i < n; i++) {
      const newZx = zx * zx - zy * zy + cx;
      zy = 2 * zx * zy + cy;
      zx = newZx;
      const mag2 = zx * zx + zy * zy;
      if (mag2 > 4) {
        const smooth = (i - Math.log2(Math.log2(mag2)) + 4.0) / n;
        return Math.max(0, Math.min(1, smooth));
      }
    }
    return 1.0;
  },
  julia: (
    z: number | { re: number; im: number },
    c: number | { re: number; im: number },
    maxIter: number
  ) => {
    let zx = typeof z === 'number' ? z : z.re;
    let zy = typeof z === 'number' ? 0 : z.im;
    const cx = typeof c === 'number' ? c : c.re;
    const cy = typeof c === 'number' ? 0 : c.im;
    const n = Math.round(maxIter);
    for (let i = 0; i < n; i++) {
      const newZx = zx * zx - zy * zy + cx;
      zy = 2 * zx * zy + cy;
      zx = newZx;
      const mag2 = zx * zx + zy * zy;
      if (mag2 > 4) {
        const smooth = (i - Math.log2(Math.log2(mag2)) + 4.0) / n;
        return Math.max(0, Math.min(1, smooth));
      }
    }
    return 1.0;
  },
  binomial: choose,
  fibonacci,
  // Complex helpers
  csin: (z: ComplexResult) => toRI(new Complex(z.re, z.im).sin()),
  ccos: (z: ComplexResult) => toRI(new Complex(z.re, z.im).cos()),
  ctan: (z: ComplexResult) => toRI(new Complex(z.re, z.im).tan()),
  casin: (z: ComplexResult) => toRI(new Complex(z.re, z.im).asin()),
  cacos: (z: ComplexResult) => toRI(new Complex(z.re, z.im).acos()),
  catan: (z: ComplexResult) => toRI(new Complex(z.re, z.im).atan()),
  csinh: (z: ComplexResult) => toRI(new Complex(z.re, z.im).sinh()),
  ccosh: (z: ComplexResult) => toRI(new Complex(z.re, z.im).cosh()),
  ctanh: (z: ComplexResult) => toRI(new Complex(z.re, z.im).tanh()),
  csqrt: (z: ComplexResult) => toRI(new Complex(z.re, z.im).sqrt()),
  cexp: (z: ComplexResult) => toRI(new Complex(z.re, z.im).exp()),
  cln: (z: ComplexResult) => toRI(new Complex(z.re, z.im).log()),
  cpow: (z: number | ComplexResult, w: number | ComplexResult) => {
    const zz =
      typeof z === 'number' ? new Complex(z, 0) : new Complex(z.re, z.im);
    const ww =
      typeof w === 'number' ? new Complex(w, 0) : new Complex(w.re, w.im);
    return toRI(zz.pow(ww));
  },
  ccot: (z: ComplexResult) => toRI(new Complex(z.re, z.im).cot()),
  csec: (z: ComplexResult) => toRI(new Complex(z.re, z.im).sec()),
  ccsc: (z: ComplexResult) => toRI(new Complex(z.re, z.im).csc()),
  ccoth: (z: ComplexResult) => toRI(new Complex(z.re, z.im).coth()),
  csech: (z: ComplexResult) => toRI(new Complex(z.re, z.im).sech()),
  ccsch: (z: ComplexResult) => toRI(new Complex(z.re, z.im).csch()),
  cacot: (z: ComplexResult) => toRI(new Complex(z.re, z.im).acot()),
  casec: (z: ComplexResult) => toRI(new Complex(z.re, z.im).asec()),
  cacsc: (z: ComplexResult) => toRI(new Complex(z.re, z.im).acsc()),
  cacoth: (z: ComplexResult) => toRI(new Complex(z.re, z.im).acoth()),
  casech: (z: ComplexResult) => toRI(new Complex(z.re, z.im).asech()),
  cacsch: (z: ComplexResult) => toRI(new Complex(z.re, z.im).acsch()),
  cabs: (z: ComplexResult) => new Complex(z.re, z.im).abs(),
  carg: (z: ComplexResult) => new Complex(z.re, z.im).arg(),
  cconj: (z: ComplexResult) => toRI(new Complex(z.re, z.im).conjugate()),
  cneg: (z: ComplexResult) => ({ re: -z.re, im: -z.im }),
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
        return Reflect.get(target, prop);
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
        return Reflect.get(target, prop);
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
      // Evaluate shared middle operands of a chained relation exactly once
      // (matching the interpreter) by binding them in an IIFE.
      bindExpr: (bindings, body) =>
        `((${bindings.map((b) => b[0]).join(', ')}) => ${body})(${bindings
          .map((b) => b[1])
          .join(', ')})`,
      // A non-boolean Which/When condition (e.g. NaN) fails closed at run time,
      // matching the interpreter's throw (D6).
      assertBoolean: (code) => `_SYS.cond(${code})`,
      indent: 0,
      ws: (s?: string) => s ?? '',
      preamble: '',
      ...options,
    };
  }

  compile(
    expr: Expression,
    options: CompilationOptions<Expression> = {}
  ): CompilationResult<'javascript'> {
    // Compiled code is radian-based: reproduce the engine's `angularUnit`
    // semantics (scaled trig args, scaled inverse-trig results) so compiled
    // output agrees with evaluate().
    expr = rewriteAngularUnit(expr);
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
        // An assigned value / declared constant: returning `undefined` lets
        // BaseCompiler fold it (the way evaluate() does) rather than emitting a
        // bare `a` global, which would throw `ReferenceError` at run time.
        if (expr.engine._getSymbolValue(id) !== undefined) return undefined;
        // No value: a genuinely free symbol. It may be reachable only through a
        // folded value (e.g. `c` in `b = c + 1`), so `unknowns` — computed on
        // the surface expression — can miss it. Emit the vars-object lookup
        // anyway, not a bare global. (`freeSymbols` on the result lists it.)
        return `_.${id}`;
      },
      preamble: (preamble ?? '') + preambleImports,
    });

    const result = compileToTarget(expr, target, realOnly);
    return BaseCompiler.withReferences(
      result,
      expr,
      target,
      vars ? new Set(Object.keys(vars)) : undefined
    );
  }
}

/**
 * Wrap a compiled result so non-real values are projected to a real number or,
 * when they are not representable as one, `NaN` (fail closed, D6):
 * - A complex `{ re, im }` collapses to `re` when `im === 0`, else `NaN`.
 * - A boolean is NOT a real number — the interpreter never numericizes a
 *   boolean-valued expression to 0/1 (`True.N()` stays `True`) — so it maps to
 *   `NaN` rather than silently passing through as a non-number (CO-P2-25).
 */
function wrapRealOnly(
  result: CompilationResult<'javascript'>
): CompilationResult<'javascript', number> {
  const origRun = result.run;
  const realRun = ((...args: unknown[]) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    const r = (origRun as Function)(...args);
    if (typeof r === 'boolean') return NaN;
    if (typeof r === 'object' && r !== null && 'im' in r)
      return (r as ComplexResult).im === 0 ? (r as ComplexResult).re : NaN;
    return r;
  }) as unknown as CompiledRunner<number>;
  return {
    ...result,
    run: realRun,
  } as CompilationResult<'javascript', number>;
}

function compileToTarget(
  expr: Expression,
  target: CompileTarget<Expression>,
  realOnly?: boolean
): CompilationResult<'javascript'> {
  if (isFunction(expr, 'Function')) {
    const args = expr.ops;
    const params = args.slice(1).map((x) => (isSymbol(x) ? x.symbol : '_'));
    const body = BaseCompiler.compile(args[0].canonical, {
      ...target,
      var: (id) => (params.includes(id) ? id : target.var(id)),
    });
    const fn = new ComputeEngineFunctionLiteral(body, params);
    const result = {
      target: 'javascript' as const,
      success: true,
      code: `(${params.join(', ')}) => ${body}`,
      calling: 'lambda' as const,
      run: fn as unknown as CompiledRunner,
    };
    return realOnly ? wrapRealOnly(result) : result;
  }

  if (isSymbol(expr)) {
    const op = target.operators?.(expr.symbol);
    if (op) {
      const fn = new ComputeEngineFunctionLiteral(`a ${op[0]} b`, ['a', 'b']);
      const result = {
        target: 'javascript' as const,
        success: true,
        code: `(a, b) => a ${op[0]} b`,
        calling: 'lambda' as const,
        run: fn as unknown as CompiledRunner,
      };
      return realOnly ? wrapRealOnly(result) : result;
    }
  }

  const js = BaseCompiler.compile(expr, target);
  const fn = new ComputeEngineFunction(js, target.preamble);
  const result = {
    target: 'javascript' as const,
    success: true,
    code: js,
    calling: 'expression' as const,
    run: fn as unknown as CompiledRunner,
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
  const fn = limitsExpr as Expression & {
    op1: Expression;
    op2: Expression;
    op3: Expression;
  };
  const index = isSymbol(fn.op1) ? fn.op1.symbol : '_';
  const lowerExpr = fn.op2;
  const upperExpr = fn.op3;
  const lowerRe = lowerExpr.re;
  const upperRe = upperExpr.re;
  return {
    index,
    lowerExpr,
    upperExpr,
    lowerNum:
      !isNaN(lowerRe) && Number.isFinite(lowerRe)
        ? Math.floor(lowerRe)
        : undefined,
    upperNum:
      !isNaN(upperRe) && Number.isFinite(upperRe)
        ? Math.floor(upperRe)
        : undefined,
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
 *
 * Multi-index forms — `Sum(body, Limits(i,…), Limits(j,…), …)` — are compiled
 * as nested single-index sums (`Σ_i Σ_j body`), so every indexing-set clause is
 * honored. (Previously only the first clause was read, leaving the trailing
 * indices dangling in the generated code.)
 */
function compileSumProduct(
  kind: 'Sum' | 'Product',
  args: ReadonlyArray<Expression>,
  _compile: (expr: Expression) => string,
  target: CompileTarget<Expression>
): string {
  if (!args[0]) throw new Error(`${kind}: no body`);
  if (!args[1]) throw new Error(`${kind}: no indexing set`);
  return emitSumProduct(kind, args[0], args.slice(1), target);
}

/**
 * Emit one indexing-set clause of a Sum/Product, recursing into the remaining
 * clauses for the innermost body. The "term" accumulated by this clause is the
 * body itself for the last clause, or the nested sum/product over the remaining
 * clauses otherwise.
 */
function emitSumProduct(
  kind: 'Sum' | 'Product',
  body: Expression,
  clauses: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): string {
  const { index, lowerExpr, upperExpr, lowerNum, upperNum } = extractLimits(
    clauses[0]
  );
  const rest = clauses.slice(1);
  const isSum = kind === 'Sum';
  const op = isSum ? '+' : '*';
  const identity = isSum ? '0' : '1';
  // Complexity is a property of the innermost body — a nested inner sum of a
  // complex body is itself complex, so this stays consistent at every level.
  const bodyIsComplex = BaseCompiler.isComplexValued(body);

  // Compile the term this clause accumulates, under a target that binds this
  // clause's index. For the last clause that's the body; otherwise it's the
  // nested sum/product over the remaining clauses.
  const compileTerm = (innerTarget: CompileTarget<Expression>): string =>
    rest.length > 0
      ? emitSumProduct(kind, body, rest, innerTarget)
      : BaseCompiler.compile(body, innerTarget);

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
        terms.push(`(${compileTerm(innerTarget)})`);
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

  const bodyCode = compileTerm({
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
 * Compile integration to a call to the runtime Monte-Carlo estimator
 * `_SYS.integrate(f, a, b)`.
 *
 * The integrand (`args[0]`) is either a bare expression in the integration
 * variable or — the common LaTeX `\int x^2 dx` parse shape — a `Function`
 * expression `Function(body, param)`. We compile the *body* directly into a
 * single-argument lambda: compiling the `Function` itself would already lower
 * it to a lambda, and wrapping that again would produce a double-lambda
 * `(x) => ((x) => x*x)` whose inner function is never called, so the estimator
 * received a function-returning function and returned `NaN`.
 *
 * The bounds are passed through as their real values. `extractLimits` floors
 * the bounds (correct for the discrete `Sum`/`Product` counters it also
 * serves, wrong for a continuous integral — it collapsed e.g. `∫₀^0.5` to
 * `∫₀^0`), so we compile the bound expressions directly instead.
 */
/**
 * Compile `Integrate(f, (x, a, b))` to a call to the `_SYS.integrate` runtime
 * helper.
 *
 * NOTE — the compiled definite integral is a **Monte-Carlo estimate**, not an
 * exact/adaptive quadrature. `_SYS.integrate` draws 1e7 uniform samples over
 * `[a, b]`, so a compiled `Integrate` is **stochastic** (a different result
 * each call, unseeded), converges at only ~1/√N (typical error ~1e-4), and is
 * comparatively slow (~200 ms/call). It exists so that an expression containing
 * a definite integral can still be compiled to a self-contained numeric
 * function; callers needing a deterministic or high-accuracy value should use
 * the interpreter's `.N()` (adaptive quadrature) instead. Only real, finite,
 * constant bounds are meaningful; an unbounded or symbolic-bound integral is
 * out of scope for the compiled target.
 */
function compileIntegrate(
  args: ReadonlyArray<Expression>,
  _: (expr: Expression) => TargetSource,
  target: CompileTarget<Expression>
): string {
  const { index, lowerExpr, upperExpr } = extractLimits(args[1]);

  // Unwrap a `Function(body, param)` integrand to its body, binding the
  // lambda to the function's own parameter; otherwise the integrand is a bare
  // expression in the limits' index variable.
  let lambdaVar = index;
  let bodyExpr = args[0];
  if (isFunction(args[0], 'Function')) {
    const params = args[0].ops.slice(1).filter((x) => isSymbol(x));
    if (params.length >= 1 && isSymbol(params[0])) lambdaVar = params[0].symbol;
    bodyExpr = args[0].ops[0];
  }

  const f = BaseCompiler.compile(bodyExpr, {
    ...target,
    var: (id) => (id === lambdaVar ? id : target.var(id)),
  });

  const lo = BaseCompiler.compile(lowerExpr, target);
  const hi = BaseCompiler.compile(upperExpr, target);

  return `_SYS.integrate((${lambdaVar}) => (${f}), ${lo}, ${hi})`;
}

/**
 * Check if function has a true name (not anonymous)
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
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

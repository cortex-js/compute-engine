/**
 * JavaScript interval arithmetic compilation target
 *
 * Compiles mathematical expressions to JavaScript code using interval arithmetic
 * for reliable function evaluation with singularity detection.
 *
 * @module compilation/interval-javascript-target
 */

import type { Expression } from '../global-types';
import { isSymbol, isNumber } from '../boxed-expression/type-guards';

import { BaseCompiler } from './base-compiler';
import type {
  CompileTarget,
  CompiledOperators,
  CompiledFunctions,
  LanguageTarget,
  CompilationOptions,
  CompilationResult,
  CompiledRunner,
} from './types';
import { IntervalArithmetic } from '../interval';
import type { Interval, IntervalResult } from '../interval/types';

/**
 * Interval arithmetic operators mapped to _IA library calls.
 *
 * Unlike regular operators, these produce function calls instead of infix notation.
 */
const INTERVAL_JAVASCRIPT_OPERATORS: CompiledOperators = {
  // We use high precedence since these become function calls
  Add: ['_IA.add', 20],
  Negate: ['_IA.negate', 20],
  Subtract: ['_IA.sub', 20],
  Multiply: ['_IA.mul', 20],
  Divide: ['_IA.div', 20],
  // Comparisons return BoolInterval
  Equal: ['_IA.equal', 20],
  NotEqual: ['_IA.notEqual', 20],
  LessEqual: ['_IA.lessEqual', 20],
  GreaterEqual: ['_IA.greaterEqual', 20],
  Less: ['_IA.less', 20],
  Greater: ['_IA.greater', 20],
  And: ['_IA.and', 20],
  Or: ['_IA.or', 20],
  Not: ['_IA.not', 20],
};

/**
 * Interval arithmetic function implementations.
 */
const INTERVAL_JAVASCRIPT_FUNCTIONS: CompiledFunctions<Expression> = {
  // Basic arithmetic - using function call syntax
  Add: (args, compile) => {
    if (args.length === 0) return '_IA.point(0)';
    if (args.length === 1) return compile(args[0]);
    // Chain additions: (a + b) + c
    let result = compile(args[0]);
    for (let i = 1; i < args.length; i++) {
      result = `_IA.add(${result}, ${compile(args[i])})`;
    }
    return result;
  },
  Subtract: (args, compile) => {
    if (args.length === 0) return '_IA.point(0)';
    if (args.length === 1) return `_IA.negate(${compile(args[0])})`;
    if (args.length === 2)
      return `_IA.sub(${compile(args[0])}, ${compile(args[1])})`;
    let result = compile(args[0]);
    for (let i = 1; i < args.length; i++) {
      result = `_IA.sub(${result}, ${compile(args[i])})`;
    }
    return result;
  },
  Multiply: (args, compile) => {
    if (args.length === 0) return '_IA.point(1)';
    if (args.length === 1) return compile(args[0]);
    let result = compile(args[0]);
    for (let i = 1; i < args.length; i++) {
      result = `_IA.mul(${result}, ${compile(args[i])})`;
    }
    return result;
  },
  Divide: (args, compile) => {
    if (args.length === 0) return '_IA.point(1)';
    if (args.length === 1) return compile(args[0]);
    if (args.length === 2)
      return `_IA.div(${compile(args[0])}, ${compile(args[1])})`;
    let result = compile(args[0]);
    for (let i = 1; i < args.length; i++) {
      result = `_IA.div(${result}, ${compile(args[i])})`;
    }
    return result;
  },
  Negate: (args, compile) => `_IA.negate(${compile(args[0])})`,

  // Elementary functions
  Abs: (args, compile) => `_IA.abs(${compile(args[0])})`,
  Ceil: (args, compile) => `_IA.ceil(${compile(args[0])})`,
  Exp: (args, compile) => `_IA.exp(${compile(args[0])})`,
  Floor: (args, compile) => `_IA.floor(${compile(args[0])})`,
  Ln: (args, compile) => `_IA.ln(${compile(args[0])})`,
  Log: (args, compile) => {
    if (args.length === 1) return `_IA.log10(${compile(args[0])})`;
    // Log with custom base: log_b(x) = ln(x) / ln(b)
    return `_IA.div(_IA.ln(${compile(args[0])}), _IA.ln(${compile(args[1])}))`;
  },
  Lb: (args, compile) => `_IA.log2(${compile(args[0])})`,
  Max: (args, compile) => {
    if (args.length === 0) return '_IA.point(-Infinity)';
    if (args.length === 1) return compile(args[0]);
    let result = compile(args[0]);
    for (let i = 1; i < args.length; i++) {
      result = `_IA.max(${result}, ${compile(args[i])})`;
    }
    return result;
  },
  Min: (args, compile) => {
    if (args.length === 0) return '_IA.point(Infinity)';
    if (args.length === 1) return compile(args[0]);
    let result = compile(args[0]);
    for (let i = 1; i < args.length; i++) {
      result = `_IA.min(${result}, ${compile(args[i])})`;
    }
    return result;
  },
  Power: (args, compile) => {
    const base = args[0];
    const exp = args[1];
    if (base === null) throw new Error('Power: no argument');
    // Check if this is e^x (base is ExponentialE)
    if (isSymbol(base, 'ExponentialE')) {
      return `_IA.exp(${compile(exp)})`;
    }
    // Check if exponent is a constant number
    if (isNumber(exp) && exp.im === 0) {
      const expVal = exp.re;
      if (expVal === 0.5) return `_IA.sqrt(${compile(base)})`;
      if (expVal === 2) return `_IA.square(${compile(base)})`;
      return `_IA.pow(${compile(base)}, ${expVal})`;
    }
    // Variable exponent - use powInterval
    return `_IA.powInterval(${compile(base)}, ${compile(exp)})`;
  },
  Root: (args, compile) => {
    const [arg, exp] = args;
    if (arg === null) throw new Error('Root: no argument');
    if (exp === null) return `_IA.sqrt(${compile(arg)})`;
    if (exp?.re === 2) return `_IA.sqrt(${compile(arg)})`;
    // nth root = x^(1/n)
    if (isNumber(exp) && exp.im === 0) {
      return `_IA.pow(${compile(arg)}, ${1 / exp.re})`;
    }
    return `_IA.powInterval(${compile(arg)}, _IA.div(_IA.point(1), ${compile(exp)}))`;
  },
  Round: (args, compile) => `_IA.round(${compile(args[0])})`,
  Heaviside: (args, compile) => `_IA.heaviside(${compile(args[0])})`,
  Sign: (args, compile) => `_IA.sign(${compile(args[0])})`,
  Sqrt: (args, compile) => `_IA.sqrt(${compile(args[0])})`,
  Square: (args, compile) => `_IA.square(${compile(args[0])})`,

  // Trigonometric functions
  Sin: (args, compile) => `_IA.sin(${compile(args[0])})`,
  Cos: (args, compile) => `_IA.cos(${compile(args[0])})`,
  Tan: (args, compile) => `_IA.tan(${compile(args[0])})`,
  Cot: (args, compile) => `_IA.cot(${compile(args[0])})`,
  Sec: (args, compile) => `_IA.sec(${compile(args[0])})`,
  Csc: (args, compile) => `_IA.csc(${compile(args[0])})`,
  Arcsin: (args, compile) => `_IA.asin(${compile(args[0])})`,
  Arccos: (args, compile) => `_IA.acos(${compile(args[0])})`,
  Arctan: (args, compile) => `_IA.atan(${compile(args[0])})`,
  Arccot: (args, compile) => `_IA.acot(${compile(args[0])})`,
  Arccsc: (args, compile) => `_IA.acsc(${compile(args[0])})`,
  Arcsec: (args, compile) => `_IA.asec(${compile(args[0])})`,

  // Hyperbolic functions
  Sinh: (args, compile) => `_IA.sinh(${compile(args[0])})`,
  Cosh: (args, compile) => `_IA.cosh(${compile(args[0])})`,
  Tanh: (args, compile) => `_IA.tanh(${compile(args[0])})`,
  Coth: (args, compile) => `_IA.coth(${compile(args[0])})`,
  Csch: (args, compile) => `_IA.csch(${compile(args[0])})`,
  Sech: (args, compile) => `_IA.sech(${compile(args[0])})`,
  Arsinh: (args, compile) => `_IA.asinh(${compile(args[0])})`,
  Arcosh: (args, compile) => `_IA.acosh(${compile(args[0])})`,
  Artanh: (args, compile) => `_IA.atanh(${compile(args[0])})`,
  Arcoth: (args, compile) => `_IA.acoth(${compile(args[0])})`,
  Arcsch: (args, compile) => `_IA.acsch(${compile(args[0])})`,
  Arsech: (args, compile) => `_IA.asech(${compile(args[0])})`,

  // Cardinal sine
  Sinc: (args, compile) => `_IA.sinc(${compile(args[0])})`,

  // Fresnel integrals
  FresnelS: (args, compile) => `_IA.fresnelS(${compile(args[0])})`,
  FresnelC: (args, compile) => `_IA.fresnelC(${compile(args[0])})`,

  // Special functions
  Factorial: (args, compile) => `_IA.factorial(${compile(args[0])})`,
  Factorial2: (args, compile) => `_IA.factorial2(${compile(args[0])})`,
  Gamma: (args, compile) => `_IA.gamma(${compile(args[0])})`,
  GammaLn: (args, compile) => `_IA.gammaln(${compile(args[0])})`,
  Binomial: (args, compile) =>
    `_IA.binomial(${compile(args[0])}, ${compile(args[1])})`,
  GCD: (args, compile) => `_IA.gcd(${compile(args[0])}, ${compile(args[1])})`,
  LCM: (args, compile) => `_IA.lcm(${compile(args[0])}, ${compile(args[1])})`,
  Chop: (args, compile) => `_IA.chop(${compile(args[0])})`,
  Erf: (args, compile) => `_IA.erf(${compile(args[0])})`,
  Erfc: (args, compile) => `_IA.erfc(${compile(args[0])})`,
  Exp2: (args, compile) => `_IA.exp2(${compile(args[0])})`,
  Arctan2: (args, compile) =>
    `_IA.atan2(${compile(args[0])}, ${compile(args[1])})`,
  Hypot: (args, compile) =>
    `_IA.hypot(${compile(args[0])}, ${compile(args[1])})`,

  // Elementary
  Fract: (args, compile) => `_IA.fract(${compile(args[0])})`,
  Truncate: (args, compile) => `_IA.trunc(${compile(args[0])})`,

  // Mod / Remainder
  Mod: (args, compile) => `_IA.mod(${compile(args[0])}, ${compile(args[1])})`,
  Remainder: (args, compile) =>
    `_IA.remainder(${compile(args[0])}, ${compile(args[1])})`,

  // Sum / Product
  Sum: (args, compile, target) =>
    compileIntervalSumProduct('Sum', args, compile, target),
  Product: (args, compile, target) =>
    compileIntervalSumProduct('Product', args, compile, target),

  // Conditionals
  If: (args, compile) => {
    if (args.length !== 3) throw new Error('If: wrong number of arguments');
    // For interval arithmetic, we need to handle indeterminate conditions
    return `_IA.piecewise(
      ${compile(args[0])},
      () => ${compile(args[1])},
      () => ${compile(args[2])}
    )`;
  },
  Which: (args, compile) => {
    if (args.length < 2 || args.length % 2 !== 0)
      throw new Error(
        'Which: expected even number of arguments (condition/value pairs)'
      );
    // Build nested piecewise calls for each condition/value pair
    const buildPiecewise = (i: number): string => {
      if (i >= args.length) return `{ kind: 'empty' }`;
      const cond = args[i];
      const val = args[i + 1];
      // If condition is the symbol True, it's the default branch
      if (isSymbol(cond, 'True')) {
        return compile(val);
      }
      return `_IA.piecewise(
      ${compile(cond)},
      () => ${compile(val)},
      () => ${buildPiecewise(i + 2)}
    )`;
    };
    return buildPiecewise(0);
  },
  // Comparisons
  Equal: (args, compile) =>
    `_IA.equal(${compile(args[0])}, ${compile(args[1])})`,
  NotEqual: (args, compile) =>
    `_IA.notEqual(${compile(args[0])}, ${compile(args[1])})`,
  LessEqual: (args, compile) =>
    `_IA.lessEqual(${compile(args[0])}, ${compile(args[1])})`,
  GreaterEqual: (args, compile) =>
    `_IA.greaterEqual(${compile(args[0])}, ${compile(args[1])})`,
  Less: (args, compile) => `_IA.less(${compile(args[0])}, ${compile(args[1])})`,
  Greater: (args, compile) =>
    `_IA.greater(${compile(args[0])}, ${compile(args[1])})`,
  And: (args, compile) => `_IA.and(${compile(args[0])}, ${compile(args[1])})`,
  Or: (args, compile) => `_IA.or(${compile(args[0])}, ${compile(args[1])})`,
  Not: (args, compile) => `_IA.not(${compile(args[0])})`,
};

/**
 * Maximum number of terms to unroll in an interval Sum/Product.
 */
const INTERVAL_UNROLL_LIMIT = 100;

/**
 * Extract index, lower, and upper from a Limits expression.
 * Returns the raw Expression nodes so they can be compiled.
 */
function extractIntervalLimits(limitsExpr: Expression): {
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
 * Compile a bound expression to a scalar JavaScript value for use as a loop
 * counter. For the interval target, bounds must be plain numbers (not intervals).
 *
 * At runtime, compiled interval expressions produce {lo, hi} objects.
 * For integer loop bounds we extract the scalar via .hi (for point intervals
 * lo === hi so either works).
 */
function compileIntervalBound(
  expr: Expression,
  numVal: number | undefined,
  target: CompileTarget<Expression>
): string {
  if (numVal !== undefined) return String(numVal);
  // Compile the bound expression (produces interval at runtime), then
  // extract the scalar value via .hi for the loop counter.
  const compiled = BaseCompiler.compile(expr, target);
  return `Math.floor((${compiled}).hi)`;
}

/**
 * Compile Sum or Product for the interval arithmetic target.
 *
 * The iteration variable is substituted with `_IA.point(k)` so the
 * body compiles correctly as interval expressions.  Accumulation uses
 * `_IA.add` / `_IA.mul`.
 *
 * When bounds are symbolic, emits a loop with compiled bound expressions.
 */
function compileIntervalSumProduct(
  kind: 'Sum' | 'Product',
  args: ReadonlyArray<Expression>,
  _compile: (expr: Expression) => string,
  target: CompileTarget<Expression>
): string {
  if (!args[0]) throw new Error(`${kind}: no body`);
  if (!args[1]) throw new Error(`${kind}: no indexing set`);

  const { index, lowerExpr, upperExpr, lowerNum, upperNum } =
    extractIntervalLimits(args[1]);
  const isSum = kind === 'Sum';
  const iaOp = isSum ? '_IA.add' : '_IA.mul';
  const identity = isSum ? '_IA.point(0)' : '_IA.point(1)';

  const bothConstant = lowerNum !== undefined && upperNum !== undefined;

  // Empty range (only knowable when both bounds are constant)
  if (bothConstant && lowerNum > upperNum) return identity;

  // Unroll when both bounds are constant and range is small
  if (bothConstant) {
    const termCount = upperNum - lowerNum + 1;
    if (termCount <= INTERVAL_UNROLL_LIMIT) {
      const terms: string[] = [];
      for (let k = lowerNum; k <= upperNum; k++) {
        const innerTarget: CompileTarget<Expression> = {
          ...target,
          var: (id) => (id === index ? `_IA.point(${k})` : target.var(id)),
        };
        terms.push(BaseCompiler.compile(args[0], innerTarget));
      }

      let result = terms[terms.length - 1];
      for (let i = terms.length - 2; i >= 0; i--) {
        result = `${iaOp}(${terms[i]}, ${result})`;
      }
      return result;
    }
  }

  // Emit a loop (either large constant range or symbolic bounds)
  const lowerCode = compileIntervalBound(lowerExpr, lowerNum, target);
  const upperCode = compileIntervalBound(upperExpr, upperNum, target);

  const acc = BaseCompiler.tempVar();
  const bodyCode = BaseCompiler.compile(args[0], {
    ...target,
    var: (id) => (id === index ? `_IA.point(${index})` : target.var(id)),
  });

  return `(() => { let ${acc} = ${identity}; const _upper = ${upperCode}; for (let ${index} = ${lowerCode}; ${index} <= _upper; ${index}++) { ${acc} = ${iaOp}(${acc}, ${bodyCode}); } return ${acc}; })()`;
}

/**
 * JavaScript function that wraps compiled interval arithmetic code.
 *
 * Injects the _IA library and provides input conversion from various formats.
 */
export class ComputeEngineIntervalFunction extends Function {
  IA = IntervalArithmetic;

  constructor(body: string, preamble = '') {
    super(
      '_IA',
      '_',
      preamble ? `${preamble};return ${body}` : `return ${body}`
    );
    return new Proxy(this, {
      apply: (target, thisArg, argumentsList) => {
        try {
          // Process input arguments - convert to interval format
          const processedArgs = argumentsList.map(processInput);
          return super.apply(thisArg, [this.IA, ...processedArgs]);
        } catch {
          // Runtime error (e.g., missing _IA method) — return "entire"
          // to signal "cannot bound this" rather than crashing.
          return { kind: 'entire' };
        }
      },
      get: (target, prop) => {
        if (prop === 'toString') return (): string => body;
        if (prop === 'isCompiled') return true;
        return target[prop];
      },
    });
  }
}

/**
 * Process an input value to interval format.
 *
 * Accepts:
 * - { lo: number, hi: number } - Direct interval
 * - { x: {...}, y: {...} } - Object with interval-valued properties
 * - number - Convert to point interval
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function hasIntervalBounds(
  value: unknown
): value is { lo: unknown; hi: unknown } {
  return isRecord(value) && 'lo' in value && 'hi' in value;
}

function processInput(input: unknown): unknown {
  if (input === null || input === undefined) {
    return input;
  }

  // Already an interval
  if (hasIntervalBounds(input)) {
    return input;
  }

  // Object with properties - process recursively
  if (isRecord(input)) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      result[key] = processInput(value);
    }
    return result;
  }

  // Number - convert to point interval
  if (typeof input === 'number') {
    return { lo: input, hi: input };
  }

  return input;
}

/**
 * Interval arithmetic JavaScript target implementation.
 */
export class IntervalJavaScriptTarget implements LanguageTarget<Expression> {
  getOperators(): CompiledOperators {
    return INTERVAL_JAVASCRIPT_OPERATORS;
  }

  getFunctions(): CompiledFunctions<Expression> {
    return INTERVAL_JAVASCRIPT_FUNCTIONS;
  }

  createTarget(
    options: Partial<CompileTarget<Expression>> = {}
  ): CompileTarget<Expression> {
    return {
      language: 'interval-javascript',
      // Don't use operators - all arithmetic goes through functions
      // because interval arithmetic returns IntervalResult, not numbers
      operators: () => undefined,
      functions: (id) => INTERVAL_JAVASCRIPT_FUNCTIONS[id],
      var: (id) => {
        const result: Record<string, string> = {
          Pi: '_IA.point(Math.PI)',
          ExponentialE: '_IA.point(Math.E)',
          NaN: '{ lo: NaN, hi: NaN }',
          ImaginaryUnit: '{ lo: NaN, hi: NaN }',
          Half: '_IA.point(0.5)',
          MachineEpsilon: '_IA.point(Number.EPSILON)',
          GoldenRatio: '_IA.point((1 + Math.sqrt(5)) / 2)',
          CatalanConstant: '_IA.point(0.91596559417721901)',
          EulerGamma: '_IA.point(0.57721566490153286)',
        };
        return result[id];
      },
      string: (str) => JSON.stringify(str),
      number: (n) => `_IA.point(${n})`,
      indent: 0,
      ws: (s?: string) => s ?? '',
      preamble: '',
      ...options,
    };
  }

  compile(
    expr: Expression,
    options: CompilationOptions<Expression> = {}
  ): CompilationResult<'interval-js', IntervalResult | Interval> {
    const { functions, vars, preamble } = options;
    const unknowns = expr.unknowns;

    // Process custom functions
    const namedFunctions: { [k: string]: string } = {};
    let preambleImports = '';

    if (functions) {
      for (const [k, v] of Object.entries(functions)) {
        if (typeof v === 'function') {
          preambleImports += `const ${k} = ${v.toString()};\n`;
          namedFunctions[k] = k;
        } else if (typeof v === 'string') {
          namedFunctions[k] = v;
        }
      }
    }

    const target = this.createTarget({
      functions: (id) =>
        namedFunctions?.[id]
          ? namedFunctions[id]
          : INTERVAL_JAVASCRIPT_FUNCTIONS[id],
      var: (id) => {
        if (vars && id in vars) return vars[id] as string;
        const constants: Record<string, string> = {
          Pi: '_IA.point(Math.PI)',
          ExponentialE: '_IA.point(Math.E)',
          NaN: '{ lo: NaN, hi: NaN }',
          ImaginaryUnit: '{ lo: NaN, hi: NaN }',
          Half: '_IA.point(0.5)',
          MachineEpsilon: '_IA.point(Number.EPSILON)',
          GoldenRatio: '_IA.point((1 + Math.sqrt(5)) / 2)',
          CatalanConstant: '_IA.point(0.91596559417721901)',
          EulerGamma: '_IA.point(0.57721566490153286)',
        };
        if (id in constants) return constants[id];
        if (unknowns.includes(id)) return `_.${id}`;
        return undefined;
      },
      preamble: (preamble ?? '') + preambleImports,
    });

    return compileToIntervalTarget(expr, target);
  }
}

/**
 * Compile expression to interval JavaScript executable.
 */
function compileToIntervalTarget(
  expr: Expression,
  target: CompileTarget<Expression>
): CompilationResult<'interval-js', IntervalResult | Interval> {
  let js: string;
  try {
    js = BaseCompiler.compile(expr, target);
  } catch {
    // Expression contains operators/functions not supported by the interval
    // target. Report failure so the caller can fall back to another target.
    return {
      target: 'interval-js',
      success: false,
      code: '',
    } as CompilationResult<'interval-js', IntervalResult | Interval>;
  }
  const fn = new ComputeEngineIntervalFunction(js, target.preamble);
  return {
    target: 'interval-js',
    success: true,
    code: js,
    calling: 'expression',
    run: fn as unknown as CompiledRunner<IntervalResult | Interval>,
  };
}

import type { Expression } from '../global-types';
import {
  isFunction,
  isNumber,
  isString,
  isSymbol,
} from '../boxed-expression/type-guards';
import { parseColor, rgbToOklch } from '@arnog/colors';
import {
  tryGetConstant,
  foldTerms,
  tryGetComplexParts,
  formatFloat,
  parenthesizeFactor,
} from './constant-folding';

import type {
  CompileTarget,
  CompiledOperators,
  CompiledFunctions,
  LanguageTarget,
  CompilationOptions,
  CompilationResult,
} from './types';
import { BaseCompiler } from './base-compiler';

/**
 * GPU shader operators shared by GLSL and WGSL.
 *
 * Both languages use identical C-style operators for arithmetic,
 * comparison, and logical operations.
 */
export const GPU_OPERATORS: CompiledOperators = {
  Add: ['+', 11],
  Negate: ['-', 14],
  Subtract: ['-', 11], // Subtract canonicalizes to Add+Negate; kept as fallback
  Multiply: ['*', 12],
  Divide: ['/', 13],
  Equal: ['==', 8],
  NotEqual: ['!=', 8],
  LessEqual: ['<=', 9],
  GreaterEqual: ['>=', 9],
  Less: ['<', 9],
  Greater: ['>', 9],
  And: ['&&', 4],
  Or: ['||', 3],
  Not: ['!', 14],
};

/** Return the vec2 constructor name for the target language. */
function gpuVec2(target?: CompileTarget<Expression>): string {
  return target?.language === 'wgsl' ? 'vec2f' : 'vec2';
}

/** Return the vec3 constructor name for the target language. */
function gpuVec3(target?: CompileTarget<Expression>): string {
  return target?.language === 'wgsl' ? 'vec3f' : 'vec3';
}

/**
 * Emit a NaN literal valid for the target shader language.
 *
 * Neither GLSL nor WGSL has a `NaN` identifier (the base compiler's default
 * `If`/`Which`/`When` emit a bare `NaN`, which fails to compile on GPU). GLSL
 * evaluates `0.0 / 0.0` to NaN at runtime; WGSL rejects a constant `0.0 / 0.0`
 * during const-evaluation, so use a NaN bit pattern there.
 */
function gpuNaN(target?: CompileTarget<Expression>): string {
  return target?.language === 'wgsl'
    ? 'bitcast<f32>(0x7fc00000u)'
    : '(0.0 / 0.0)';
}

/**
 * Emit a conditional `cond ? whenTrue : whenFalse` for the target language.
 *
 * GLSL has the ternary operator; WGSL does not and uses
 * `select(false_value, true_value, condition)` instead.
 */
function gpuConditional(
  cond: string,
  whenTrue: string,
  whenFalse: string,
  target?: CompileTarget<Expression>
): string {
  if (target?.language === 'wgsl')
    return `select(${whenFalse}, ${whenTrue}, ${cond})`;
  return `((${cond}) ? (${whenTrue}) : (${whenFalse}))`;
}

/**
 * Extract a lowercase string literal from a boxed expression, or `null`
 * if it isn't a string literal. Operators that need to switch on a
 * colorspace name at compile time use this to peek at the argument.
 */
function readStringLiteral(expr: Expression): string | null {
  if (!isString(expr)) return null;
  return expr.string?.toLowerCase() ?? null;
}

/** Compile an expression as a GPU integer argument.
 *  Integer constants emit as plain literals (`200`); other expressions
 *  are wrapped in a cast (`int(...)` or `i32(...)`). */
function compileIntArg(
  expr: Expression,
  compile: (e: Expression) => string,
  target?: CompileTarget<Expression>
): string {
  const c = tryGetConstant(expr);
  if (c !== undefined && Number.isInteger(c)) return c.toString();
  const intCast = target?.language === 'wgsl' ? 'i32' : 'int';
  return `${intCast}(${compile(expr)})`;
}

/** Maximum range for inline unrolling of Sum/Product loops in GPU targets. */
const GPU_UNROLL_LIMIT = 100;

/**
 * Compile a Sum or Product expression for GPU targets.
 *
 * Two compilation strategies:
 * - **Unrolled** (constant bounds, range ≤ GPU_UNROLL_LIMIT): pure inline
 *   expression with no statements, usable as a subexpression.
 * - **For-loop** (large or symbolic bounds): multi-line statement block
 *   ending with `return <acc>`, suitable for `compileFunction`.
 *
 * Complex-valued bodies are not supported (would require vec2 accumulation
 * with complex preamble helpers) and throw at compile time.
 */
function compileGPUSumProduct(
  kind: 'Sum' | 'Product',
  args: ReadonlyArray<Expression>,
  _compile: (expr: Expression) => string,
  target: CompileTarget<Expression>
): string {
  if (!args[0]) throw new Error(`${kind}: no body`);
  if (!args[1]) throw new Error(`${kind}: no indexing set`);

  if (BaseCompiler.isComplexValued(args[0]))
    throw new Error(
      `${kind}: complex-valued body not supported in GPU targets`
    );

  const limitsExpr = args[1];
  if (!isFunction(limitsExpr, 'Limits'))
    throw new Error(`${kind}: expected Limits indexing set`);

  const limitsOps = limitsExpr.ops;
  const index = isSymbol(limitsOps[0]) ? limitsOps[0].symbol : '_';
  const lowerRe = limitsOps[1].re;
  const upperRe = limitsOps[2].re;
  const lowerNum =
    !isNaN(lowerRe) && Number.isFinite(lowerRe)
      ? Math.floor(lowerRe)
      : undefined;
  const upperNum =
    !isNaN(upperRe) && Number.isFinite(upperRe)
      ? Math.floor(upperRe)
      : undefined;

  const isSum = kind === 'Sum';
  const op = isSum ? '+' : '*';
  const identity = isSum ? '0.0' : '1.0';
  const isWGSL = target.language === 'wgsl';
  const bothConstant = lowerNum !== undefined && upperNum !== undefined;

  if (bothConstant && lowerNum > upperNum) return identity;

  // Unroll small constant ranges — pure inline expression
  if (bothConstant && upperNum - lowerNum + 1 <= GPU_UNROLL_LIMIT) {
    const terms: string[] = [];
    for (let k = lowerNum; k <= upperNum; k++) {
      const kStr = formatGPUNumber(k);
      const innerTarget: CompileTarget<Expression> = {
        ...target,
        var: (id) => (id === index ? kStr : target.var(id)),
      };
      terms.push(`(${BaseCompiler.compile(args[0], innerTarget)})`);
    }
    return `(${terms.join(` ${op} `)})`;
  }

  // For-loop block (multi-line) — usable as compileFunction body
  const acc = BaseCompiler.tempVar();
  const floatType = isWGSL ? 'f32' : 'float';
  const intType = isWGSL ? 'i32' : 'int';

  const bodyTarget: CompileTarget<Expression> = {
    ...target,
    var: (id) =>
      id === index
        ? isWGSL
          ? `f32(${index})`
          : `float(${index})`
        : target.var(id),
  };
  const body = BaseCompiler.compile(args[0], bodyTarget);

  const lowerStr =
    lowerNum !== undefined
      ? String(lowerNum)
      : BaseCompiler.compile(limitsOps[1], target);
  const upperStr =
    upperNum !== undefined
      ? String(upperNum)
      : BaseCompiler.compile(limitsOps[2], target);

  const accDecl = isWGSL ? `var ${acc}: ${floatType}` : `${floatType} ${acc}`;
  const indexDecl = isWGSL ? `var ${index}: ${intType}` : `${intType} ${index}`;

  const lines = [
    `${accDecl} = ${identity};`,
    `for (${indexDecl} = ${lowerStr}; ${index} <= ${upperStr}; ${index}++) {`,
    `  ${acc} ${op}= ${body};`,
    `}`,
    `return ${acc};`,
  ];
  return lines.join('\n');
}

/**
 * GPU shader functions shared by GLSL and WGSL.
 *
 * Both languages share identical built-in math functions. Language-specific
 * functions (inversesqrt naming, mod, vector constructors) are provided
 * by subclass overrides.
 *
 * Complex numbers are represented as vec2(re, im). Functions that can
 * operate on complex values check `BaseCompiler.isComplexValued()` and
 * dispatch to `_gpu_c*` helper functions from the complex preamble.
 */
export const GPU_FUNCTIONS: CompiledFunctions<Expression> = {
  // Variadic arithmetic (for function-call form, e.g., with vectors)
  Add: (args, compile, target) => {
    if (args.length === 0) return '0.0';
    if (args.length === 1) return compile(args[0]);
    const anyComplex = args.some((a) => BaseCompiler.isComplexValued(a));
    if (!anyComplex) {
      return foldTerms(
        args.map((x) => compile(x)),
        '0.0',
        '+'
      );
    }
    // Try to decompose all operands into re/im parts
    const parts = args.map((a) => tryGetComplexParts(a, compile));
    if (parts.some((p) => p === null)) {
      // Opaque complex operand — fall back to promote-and-add
      const v2 = gpuVec2(target);
      return args
        .map((a) => {
          const code = compile(a);
          return BaseCompiler.isComplexValued(a) ? code : `${v2}(${code}, 0.0)`;
        })
        .join(' + ');
    }
    // All decomposed — collect re and im parts, fold each
    const reParts: string[] = [];
    const imParts: string[] = [];
    for (const p of parts) {
      if (p!.re !== null) reParts.push(p!.re);
      if (p!.im !== null) imParts.push(p!.im);
    }
    const reSum = foldTerms(reParts, '0.0', '+');
    const imSum = foldTerms(imParts, '0.0', '+');
    return `${gpuVec2(target)}(${reSum}, ${imSum})`;
  },
  Multiply: (args, compile, target) => {
    if (args.length === 0) return '1.0';
    if (args.length === 1) return compile(args[0]);
    const anyComplex = args.some((a) => BaseCompiler.isComplexValued(a));
    if (!anyComplex) {
      return foldTerms(
        args.map((x) => compile(x)),
        '1.0',
        '*'
      );
    }
    // Special case: scalars * imaginary_factor → vec2(0.0, product)
    // Recognizes both ImaginaryUnit symbol and Complex(0, k) literals
    const iIndex = args.findIndex(
      (op) =>
        isSymbol(op, 'ImaginaryUnit') ||
        (isNumber(op) && op.re === 0 && op.im !== 0)
    );
    if (iIndex >= 0) {
      const iFactor = args[iIndex];
      const iScale = isSymbol(iFactor, 'ImaginaryUnit')
        ? 1
        : (iFactor as any).im;
      const realFactors = args.filter((_, i) => i !== iIndex);
      const v2 = gpuVec2(target);
      if (realFactors.length === 0) return `${v2}(0.0, ${formatFloat(iScale)})`;
      const factors = realFactors.map((f) => parenthesizeFactor(f, compile(f)));
      if (iScale !== 1) factors.unshift(formatFloat(iScale));
      const imCode = foldTerms(factors, '1.0', '*');
      return `${v2}(0.0, ${imCode})`;
    }
    // General complex multiply: separate real scalars and complex operands
    const realCodes: string[] = [];
    const complexCodes: string[] = [];
    for (const a of args) {
      if (BaseCompiler.isComplexValued(a)) complexCodes.push(compile(a));
      else realCodes.push(parenthesizeFactor(a, compile(a)));
    }
    const scalarCode = foldTerms(realCodes, '1.0', '*');
    // Pairwise reduce complex operands
    let result = complexCodes[0];
    for (let i = 1; i < complexCodes.length; i++) {
      result = `_gpu_cmul(${result}, ${complexCodes[i]})`;
    }
    // Apply scalar factor
    if (scalarCode !== '1.0') result = `(${scalarCode} * ${result})`;
    return result;
  },
  // No Subtract function handler — Subtract canonicalizes to Add+Negate.
  // The operator entry in GPU_OPERATORS handles any edge cases.
  Divide: (args, compile, target) => {
    if (args.length === 0) return '1.0';
    if (args.length === 1) return compile(args[0]);
    const ac = BaseCompiler.isComplexValued(args[0]);
    const bc = args.length >= 2 && BaseCompiler.isComplexValued(args[1]);
    if (!ac && !bc) {
      if (args.length === 2) {
        const a = tryGetConstant(args[0]);
        const b = tryGetConstant(args[1]);
        if (a !== undefined && b !== undefined && b !== 0)
          return formatFloat(a / b);
        if (b === 1) return compile(args[0]);
        return `${compile(args[0])} / ${compile(args[1])}`;
      }
      let result = compile(args[0]);
      for (let i = 1; i < args.length; i++)
        result = `${result} / ${compile(args[i])}`;
      return result;
    }
    // Complex division
    if (ac && bc) return `_gpu_cdiv(${compile(args[0])}, ${compile(args[1])})`;
    if (ac && !bc) return `(${compile(args[0])} / ${compile(args[1])})`;
    const v2 = gpuVec2(target);
    return `_gpu_cdiv(${v2}(${compile(args[0])}, 0.0), ${compile(args[1])})`;
  },
  Negate: ([x], compile, target) => {
    if (x === null) throw new Error('Negate: no argument');
    const c = tryGetConstant(x);
    if (c !== undefined) return formatFloat(-c);
    if (isNumber(x) && x.im !== 0) {
      return `${gpuVec2(target)}(${formatFloat(-x.re)}, ${formatFloat(-x.im)})`;
    }
    if (isSymbol(x, 'ImaginaryUnit')) return `${gpuVec2(target)}(0.0, -1.0)`;
    return `(-${compile(x)})`;
  },

  // Standard math functions with complex dispatch
  Abs: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `length(${compile(args[0])})`;
    if (BaseCompiler.isNonNegative(args[0])) return compile(args[0]);
    return `abs(${compile(args[0])})`;
  },
  Arccos: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_cacos(${compile(args[0])})`;
    return `acos(${compile(args[0])})`;
  },
  Arcsin: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_casin(${compile(args[0])})`;
    return `asin(${compile(args[0])})`;
  },
  Arctan: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_catan(${compile(args[0])})`;
    return `atan(${compile(args[0])})`;
  },
  Ceil: (args, compile) => {
    if (BaseCompiler.isIntegerValued(args[0])) return compile(args[0]);
    return `ceil(${compile(args[0])})`;
  },
  Clamp: 'clamp',
  Cos: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_ccos(${compile(args[0])})`;
    return `cos(${compile(args[0])})`;
  },
  // CE's `Degrees` converts degrees→radians (Degrees(180) = π), which is
  // GLSL's `radians()`. GLSL's `degrees()` is the inverse (rad→deg).
  Degrees: 'radians',
  Exp: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_cexp(${compile(args[0])})`;
    return `exp(${compile(args[0])})`;
  },
  Exp2: 'exp2',
  // Component access — assumes the argument compiles to a vec2/vec3/vec4
  // (the common case for 2D/3D points). For 5+-element tuples that compile
  // to `float[N]` arrays, swizzle access is invalid GLSL and the shader
  // will fail to compile; that's an edge case `First`/`Second`/`Third`
  // aren't designed for. Vec swizzles are identical between GLSL and WGSL.
  First: (args, compile) => `${compile(args[0])}.x`,
  Second: (args, compile) => `${compile(args[0])}.y`,
  Third: (args, compile) => `${compile(args[0])}.z`,
  Floor: (args, compile) => {
    if (BaseCompiler.isIntegerValued(args[0])) return compile(args[0]);
    return `floor(${compile(args[0])})`;
  },
  Fract: 'fract',
  Ln: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_cln(${compile(args[0])})`;
    return `log(${compile(args[0])})`;
  },
  Log2: 'log2',
  Max: 'max',
  Min: 'min',
  Mix: 'mix',
  // Control-flow forms — the base compiler's default emits a JS ternary and a
  // bare `NaN`, neither of which is valid GPU code (WGSL has no `?:`, and no
  // shader language has a `NaN` identifier). Emit `select(...)` for WGSL and a
  // language-appropriate NaN.
  If: (args, compile, target) => {
    if (args.length !== 3) throw new Error('If: wrong number of arguments');
    return gpuConditional(
      compile(args[0]),
      compile(args[1]),
      compile(args[2]),
      target
    );
  },
  When: (args, compile, target) => {
    if (args.length !== 2)
      throw new Error('When: expected exactly 2 arguments (expr, cond)');
    if (isSymbol(args[1], 'True')) return `(${compile(args[0])})`;
    if (isSymbol(args[1], 'False')) return gpuNaN(target);
    return gpuConditional(
      compile(args[1]),
      compile(args[0]),
      gpuNaN(target),
      target
    );
  },
  Which: (args, compile, target) => {
    if (args.length < 2 || args.length % 2 !== 0)
      throw new Error('Which: expected condition/value pairs');
    const build = (i: number): string => {
      if (i >= args.length) return gpuNaN(target);
      const cond = args[i];
      const val = args[i + 1];
      // `True` marks the default branch.
      if (isSymbol(cond, 'True')) return `(${compile(val)})`;
      return gpuConditional(compile(cond), compile(val), build(i + 2), target);
    };
    return build(0);
  },
  Power: (args, compile, target) => {
    const base = args[0];
    const exp = args[1];
    if (base === null) throw new Error('Power: no argument');
    if (
      BaseCompiler.isComplexValued(base) ||
      BaseCompiler.isComplexValued(exp)
    ) {
      if (isSymbol(base, 'ExponentialE')) return `_gpu_cexp(${compile(exp)})`;
      const v2 = gpuVec2(target);
      const bCode = BaseCompiler.isComplexValued(base)
        ? compile(base)
        : `${v2}(${compile(base)}, 0.0)`;
      const eCode = BaseCompiler.isComplexValued(exp)
        ? compile(exp)
        : `${v2}(${compile(exp)}, 0.0)`;
      return `_gpu_cpow(${bCode}, ${eCode})`;
    }
    const bConst = tryGetConstant(base);
    const eConst = tryGetConstant(exp);
    if (bConst !== undefined && eConst !== undefined)
      return formatFloat(Math.pow(bConst, eConst));
    if (eConst === 0) return '1.0';
    if (eConst === 1) return compile(base);
    if (eConst === 2 && (isSymbol(base) || isNumber(base))) {
      const code = compile(base);
      return `(${code} * ${code})`;
    }
    if (eConst === -1) return `(1.0 / ${compile(base)})`;
    if (eConst === 0.5) return `sqrt(${compile(base)})`;
    return `pow(${compile(base)}, ${compile(exp)})`;
  },
  Radians: 'radians',
  Round: (args, compile) => {
    if (BaseCompiler.isIntegerValued(args[0])) return compile(args[0]);
    return `round(${compile(args[0])})`;
  },
  Sign: 'sign',
  Sin: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_csin(${compile(args[0])})`;
    return `sin(${compile(args[0])})`;
  },
  Smoothstep: 'smoothstep',
  Sqrt: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_csqrt(${compile(args[0])})`;
    const c = tryGetConstant(args[0]);
    if (c !== undefined) return formatFloat(Math.sqrt(c));
    return `sqrt(${compile(args[0])})`;
  },
  Step: 'step',
  Tan: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_ctan(${compile(args[0])})`;
    return `tan(${compile(args[0])})`;
  },
  Truncate: (args, compile) => {
    if (BaseCompiler.isIntegerValued(args[0])) return compile(args[0]);
    return `trunc(${compile(args[0])})`;
  },

  // Complex-specific functions
  Real: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0])) return `(${compile(args[0])}).x`;
    return compile(args[0]);
  },
  Imaginary: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0])) return `(${compile(args[0])}).y`;
    return '0.0';
  },
  Argument: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0])) {
      const code = compile(args[0]);
      return `atan(${code}.y, ${code}.x)`;
    }
    return `(${compile(args[0])} >= 0.0 ? 0.0 : 3.14159265359)`;
  },
  Conjugate: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0])) {
      const v2 = gpuVec2(target);
      const code = compile(args[0]);
      return `${v2}(${code}.x, -${code}.y)`;
    }
    return compile(args[0]);
  },

  Remainder: ([a, b], compile) => {
    if (a === null || b === null)
      throw new Error('Remainder: missing argument');
    return `(${compile(a)} - ${compile(b)} * round(${compile(a)} / ${compile(
      b
    )}))`;
  },

  // Reciprocal trigonometric functions (no GPU built-ins)
  Cot: ([x], compile) => {
    if (x === null) throw new Error('Cot: no argument');
    if (BaseCompiler.isComplexValued(x))
      return `_gpu_cdiv(_gpu_ccos(${compile(x)}), _gpu_csin(${compile(x)}))`;
    const arg = compile(x);
    return `(cos(${arg}) / sin(${arg}))`;
  },
  Csc: ([x], compile, target) => {
    if (x === null) throw new Error('Csc: no argument');
    if (BaseCompiler.isComplexValued(x)) {
      const v2 = gpuVec2(target);
      return `_gpu_cdiv(${v2}(1.0, 0.0), _gpu_csin(${compile(x)}))`;
    }
    return `(1.0 / sin(${compile(x)}))`;
  },
  Sec: ([x], compile, target) => {
    if (x === null) throw new Error('Sec: no argument');
    if (BaseCompiler.isComplexValued(x)) {
      const v2 = gpuVec2(target);
      return `_gpu_cdiv(${v2}(1.0, 0.0), _gpu_ccos(${compile(x)}))`;
    }
    return `(1.0 / cos(${compile(x)}))`;
  },

  // Inverse trigonometric (reciprocal)
  Arccot: ([x], compile) => {
    if (x === null) throw new Error('Arccot: no argument');
    return `atan(1.0 / (${compile(x)}))`;
  },
  Arccsc: ([x], compile) => {
    if (x === null) throw new Error('Arccsc: no argument');
    return `asin(1.0 / (${compile(x)}))`;
  },
  Arcsec: ([x], compile) => {
    if (x === null) throw new Error('Arcsec: no argument');
    return `acos(1.0 / (${compile(x)}))`;
  },

  // Hyperbolic functions with complex dispatch
  Sinh: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_csinh(${compile(args[0])})`;
    return `sinh(${compile(args[0])})`;
  },
  Cosh: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_ccosh(${compile(args[0])})`;
    return `cosh(${compile(args[0])})`;
  },
  Tanh: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_ctanh(${compile(args[0])})`;
    return `tanh(${compile(args[0])})`;
  },

  // Reciprocal hyperbolic functions
  Coth: ([x], compile) => {
    if (x === null) throw new Error('Coth: no argument');
    if (BaseCompiler.isComplexValued(x))
      return `_gpu_cdiv(_gpu_ccosh(${compile(x)}), _gpu_csinh(${compile(x)}))`;
    const arg = compile(x);
    return `(cosh(${arg}) / sinh(${arg}))`;
  },
  Csch: ([x], compile, target) => {
    if (x === null) throw new Error('Csch: no argument');
    if (BaseCompiler.isComplexValued(x)) {
      const v2 = gpuVec2(target);
      return `_gpu_cdiv(${v2}(1.0, 0.0), _gpu_csinh(${compile(x)}))`;
    }
    return `(1.0 / sinh(${compile(x)}))`;
  },
  Sech: ([x], compile, target) => {
    if (x === null) throw new Error('Sech: no argument');
    if (BaseCompiler.isComplexValued(x)) {
      const v2 = gpuVec2(target);
      return `_gpu_cdiv(${v2}(1.0, 0.0), _gpu_ccosh(${compile(x)}))`;
    }
    return `(1.0 / cosh(${compile(x)}))`;
  },

  // Inverse hyperbolic functions with complex dispatch
  Arcosh: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_cacosh(${compile(args[0])})`;
    return `acosh(${compile(args[0])})`;
  },
  Arsinh: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_casinh(${compile(args[0])})`;
    return `asinh(${compile(args[0])})`;
  },
  Artanh: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_catanh(${compile(args[0])})`;
    return `atanh(${compile(args[0])})`;
  },

  // Inverse hyperbolic (reciprocal)
  Arcoth: ([x], compile) => {
    if (x === null) throw new Error('Arcoth: no argument');
    return `atanh(1.0 / (${compile(x)}))`;
  },
  Arcsch: ([x], compile) => {
    if (x === null) throw new Error('Arcsch: no argument');
    return `asinh(1.0 / (${compile(x)}))`;
  },
  Arsech: ([x], compile) => {
    if (x === null) throw new Error('Arsech: no argument');
    return `acosh(1.0 / (${compile(x)}))`;
  },

  // Trigonometric (additional)
  Arctan2: (args, compile) => {
    if (args.length < 2) throw new Error('Arctan2: need two arguments');
    return `atan(${compile(args[0])}, ${compile(args[1])})`;
  },
  Hypot: ([x, y], compile) => {
    if (x === null || y === null) throw new Error('Hypot: need two arguments');
    return `length(vec2(${compile(x)}, ${compile(y)}))`;
  },
  Haversine: ([x], compile) => {
    if (x === null) throw new Error('Haversine: no argument');
    return `((1.0 - cos(${compile(x)})) * 0.5)`;
  },
  InverseHaversine: ([x], compile) => {
    if (x === null) throw new Error('InverseHaversine: no argument');
    return `(2.0 * asin(sqrt(${compile(x)})))`;
  },

  // Special functions
  Gamma: ([x], compile) => {
    if (x === null) throw new Error('Gamma: no argument');
    return `_gpu_gamma(${compile(x)})`;
  },
  GammaLn: ([x], compile) => {
    if (x === null) throw new Error('GammaLn: no argument');
    return `_gpu_gammaln(${compile(x)})`;
  },
  Factorial: ([x], compile) => {
    if (x === null) throw new Error('Factorial: no argument');
    return `_gpu_gamma(${compile(x)} + 1.0)`;
  },
  Beta: ([a, b], compile) => {
    if (a === null || b === null) throw new Error('Beta: need two arguments');
    const ca = compile(a);
    const cb = compile(b);
    return `(_gpu_gamma(${ca}) * _gpu_gamma(${cb}) / _gpu_gamma(${ca} + ${cb}))`;
  },
  Erf: ([x], compile) => {
    if (x === null) throw new Error('Erf: no argument');
    return `_gpu_erf(${compile(x)})`;
  },
  Erfc: ([x], compile) => {
    if (x === null) throw new Error('Erfc: no argument');
    return `(1.0 - _gpu_erf(${compile(x)}))`;
  },
  ErfInv: ([x], compile) => {
    if (x === null) throw new Error('ErfInv: no argument');
    return `_gpu_erfinv(${compile(x)})`;
  },
  Heaviside: ([x], compile) => {
    if (x === null) throw new Error('Heaviside: no argument');
    return `_gpu_heaviside(${compile(x)})`;
  },
  Sinc: ([x], compile) => {
    if (x === null) throw new Error('Sinc: no argument');
    return `_gpu_sinc(${compile(x)})`;
  },
  FresnelC: ([x], compile) => {
    if (x === null) throw new Error('FresnelC: no argument');
    return `_gpu_fresnelC(${compile(x)})`;
  },
  FresnelS: ([x], compile) => {
    if (x === null) throw new Error('FresnelS: no argument');
    return `_gpu_fresnelS(${compile(x)})`;
  },
  BesselJ: ([n, x], compile, target) => {
    if (n === null || x === null)
      throw new Error('BesselJ: need two arguments');
    const intCast = target?.language === 'wgsl' ? 'i32' : 'int';
    return `_gpu_besselJ(${intCast}(${compile(n)}), ${compile(x)})`;
  },

  // Additional math functions
  Lb: 'log2',
  Log: (args, compile) => {
    if (args.length === 0) throw new Error('Log: no argument');
    if (args.length === 1) return `(log(${compile(args[0])}) / log(10.0))`;
    return `(log(${compile(args[0])}) / log(${compile(args[1])}))`;
  },
  Log10: ([x], compile) => {
    if (x === null) throw new Error('Log10: no argument');
    return `(log(${compile(x)}) * 0.4342944819032518)`;
  },
  Lg: ([x], compile) => {
    if (x === null) throw new Error('Lg: no argument');
    return `(log(${compile(x)}) * 0.4342944819032518)`;
  },
  Square: ([x], compile) => {
    if (x === null) throw new Error('Square: no argument');
    if (isSymbol(x) || isNumber(x)) {
      const arg = compile(x);
      return `(${arg} * ${arg})`;
    }
    return `pow(${compile(x)}, 2.0)`;
  },
  Root: ([x, n], compile) => {
    if (x === null) throw new Error('Root: no argument');
    if (n === null || n === undefined) return `sqrt(${compile(x)})`;
    const nConst = tryGetConstant(n);
    if (nConst === 2) return `sqrt(${compile(x)})`;
    const xConst = tryGetConstant(x);
    if (xConst !== undefined && nConst !== undefined)
      return formatFloat(Math.pow(xConst, 1 / nConst));
    return `pow(${compile(x)}, 1.0 / ${compile(n)})`;
  },

  // Color functions (pure-math, GPU-compilable)
  ColorMix: (args, compile) => {
    if (args.length < 2) throw new Error('ColorMix: need two colors');
    const c1 = compile(args[0]);
    const c2 = compile(args[1]);
    const ratio = args.length >= 3 ? compile(args[2]) : '0.5';
    return `_gpu_color_mix(${c1}, ${c2}, ${ratio})`;
  },
  ColorContrast: ([bg, fg], compile) => {
    if (bg === null || fg === null)
      throw new Error('ColorContrast: need two colors');
    return `_gpu_apca(${compile(bg)}, ${compile(fg)})`;
  },
  ContrastingColor: (args, compile, target) => {
    if (args.length === 0) throw new Error('ContrastingColor: no argument');
    const bg = compile(args[0]);
    if (args.length >= 3) {
      const fg1 = compile(args[1]);
      const fg2 = compile(args[2]);
      return `(abs(_gpu_apca(${bg}, ${fg1})) >= abs(_gpu_apca(${bg}, ${fg2})) ? ${fg1} : ${fg2})`;
    }
    // Default: pick black or white in OKLCh. Black is vec3(0); white is L=1
    // achromatic — vec3(1.0, 0.0, 0.0). Heuristic from the JS path: low-luma
    // backgrounds get white text and vice versa.
    const isWGSL = target?.language === 'wgsl';
    const v3 = isWGSL ? 'vec3f' : 'vec3';
    const black = `${v3}(0.0)`;
    const white = `${v3}(1.0, 0.0, 0.0)`;
    return `((_gpu_apca(${bg}, ${black}) > 50.0) ? ${black} : ${white})`;
  },
  ColorToColorspace: ([color, space], compile) => {
    if (color === null || space === null)
      throw new Error('ColorToColorspace: need color and space');
    // The input color is canonical OKLCh; route to the requested space.
    // The space arg must be a string literal so we can pick the helper
    // at compile time (no runtime branching in shader code).
    const spaceName = readStringLiteral(space);
    if (spaceName === null)
      throw new Error('ColorToColorspace: space must be a string literal');
    const c = compile(color);
    switch (spaceName) {
      case 'oklch':
        return c;
      case 'oklab':
      case 'lab':
        return `_gpu_oklch_to_oklab(${c})`;
      case 'rgb':
        return `_gpu_oklch_to_srgb(${c})`;
      case 'hsl':
        return `_gpu_rgb_to_hsl(_gpu_oklch_to_srgb(${c}))`;
      case 'hsv':
        return `_gpu_rgb_to_hsv(_gpu_oklch_to_srgb(${c}))`;
      default:
        throw new Error(
          `ColorToColorspace: unsupported space "${spaceName}" on GPU target`
        );
    }
  },
  ColorFromColorspace: ([components, space], compile) => {
    if (components === null || space === null)
      throw new Error('ColorFromColorspace: need components and space');
    // Components are in the named space; build a canonical OKLCh value.
    const spaceName = readStringLiteral(space);
    if (spaceName === null)
      throw new Error('ColorFromColorspace: space must be a string literal');
    const c = compile(components);
    switch (spaceName) {
      case 'oklch':
        return c;
      case 'oklab':
      case 'lab':
        return `_gpu_oklab_to_oklch(${c})`;
      case 'rgb':
        return `_gpu_srgb_to_oklch(${c})`;
      case 'hsl':
        return `_gpu_srgb_to_oklch(_gpu_hsl_to_rgb(${c}))`;
      case 'hsv':
        return `_gpu_srgb_to_oklch(_gpu_hsv_to_rgb(${c}))`;
      default:
        throw new Error(
          `ColorFromColorspace: unsupported space "${spaceName}" on GPU target`
        );
    }
  },

  // ---------------------------------------------------------------------------
  // Color literals. Each typed head compiles to a canonical OKLCh vec3.
  // Alpha (4th argument) is dropped — GPU color values are vec3 only. Pass
  // alpha as a separate uniform if it's needed at the framebuffer boundary.
  // ---------------------------------------------------------------------------

  Color: ([s], _compile, target) => {
    // Compile-time CSS-color-string parsing. Runtime parsing is impractical
    // in shader code, so the string must be a literal at compile time.
    if (s === null) throw new Error('Color: no argument');
    const str = readStringLiteral(s);
    if (str === null)
      throw new Error('Color: argument must be a string literal on GPU target');
    const packed = parseColor(str);
    if (packed === 0 && str.trim().toLowerCase() !== 'transparent')
      throw new Error(`Color: invalid color string "${str}"`);
    const r = (packed >>> 24) & 0xff;
    const g = (packed >>> 16) & 0xff;
    const b = (packed >>> 8) & 0xff;
    const oklch = rgbToOklch({ r, g, b });
    return `${gpuVec3(target)}(${formatFloat(oklch.L)}, ${formatFloat(oklch.C)}, ${formatFloat(oklch.H)})`;
  },

  Rgb: (args, compile, target) => {
    if (args.length < 3) throw new Error('Rgb: need 3 components');
    const v3 = gpuVec3(target);
    // Channels are 0-1 sRGB — no scaling needed.
    return `_gpu_srgb_to_oklch(${v3}(${compile(args[0])}, ${compile(args[1])}, ${compile(args[2])}))`;
  },

  Hsv: (args, compile, target) => {
    if (args.length < 3) throw new Error('Hsv: need 3 components');
    const v3 = gpuVec3(target);
    return `_gpu_srgb_to_oklch(_gpu_hsv_to_rgb(${v3}(${compile(args[0])}, ${compile(args[1])}, ${compile(args[2])})))`;
  },

  Hsl: (args, compile, target) => {
    if (args.length < 3) throw new Error('Hsl: need 3 components');
    const v3 = gpuVec3(target);
    return `_gpu_srgb_to_oklch(_gpu_hsl_to_rgb(${v3}(${compile(args[0])}, ${compile(args[1])}, ${compile(args[2])})))`;
  },

  Oklab: (args, compile, target) => {
    if (args.length < 3) throw new Error('Oklab: need 3 components');
    const v3 = gpuVec3(target);
    return `_gpu_oklab_to_oklch(${v3}(${compile(args[0])}, ${compile(args[1])}, ${compile(args[2])}))`;
  },

  Oklch: (args, compile, target) => {
    if (args.length < 3) throw new Error('Oklch: need 3 components');
    // Already in canonical form — no conversion needed.
    const v3 = gpuVec3(target);
    return `${v3}(${compile(args[0])}, ${compile(args[1])}, ${compile(args[2])})`;
  },

  // ---------------------------------------------------------------------------
  // As* operators. AsOklch is identity (canonical). The other As* return
  // components in the named space, equivalent to ColorToColorspace(c, 'x').
  // ---------------------------------------------------------------------------

  AsOklch: ([c], compile) => {
    if (c === null) throw new Error('AsOklch: no argument');
    return compile(c);
  },

  AsOklab: ([c], compile) => {
    if (c === null) throw new Error('AsOklab: no argument');
    return `_gpu_oklch_to_oklab(${compile(c)})`;
  },

  AsRgb: ([c], compile) => {
    if (c === null) throw new Error('AsRgb: no argument');
    return `_gpu_oklch_to_srgb(${compile(c)})`;
  },

  AsHsv: ([c], compile) => {
    if (c === null) throw new Error('AsHsv: no argument');
    return `_gpu_rgb_to_hsv(_gpu_oklch_to_srgb(${compile(c)}))`;
  },

  AsHsl: ([c], compile) => {
    if (c === null) throw new Error('AsHsl: no argument');
    return `_gpu_rgb_to_hsl(_gpu_oklch_to_srgb(${compile(c)}))`;
  },

  // Fractal functions
  Mandelbrot: ([c, maxIter], compile, target) => {
    if (c === null || maxIter === null)
      throw new Error('Mandelbrot: missing arguments');
    const iterCode = compileIntArg(maxIter, compile, target);
    return `_fractal_mandelbrot(${compile(c)}, ${iterCode})`;
  },
  Julia: ([z, c, maxIter], compile, target) => {
    if (z === null || c === null || maxIter === null)
      throw new Error('Julia: missing arguments');
    const iterCode = compileIntArg(maxIter, compile, target);
    return `_fractal_julia(${compile(z)}, ${compile(c)}, ${iterCode})`;
  },

  // Vector/Matrix operations
  Cross: 'cross',
  Distance: 'distance',
  Dot: 'dot',
  Length: 'length',
  Normalize: 'normalize',
  Reflect: 'reflect',
  Refract: 'refract',

  // Sum/Product — unrolled or for-loop
  Sum: (args, compile, target) =>
    compileGPUSumProduct('Sum', args, compile, target),
  Product: (args, compile, target) =>
    compileGPUSumProduct('Product', args, compile, target),

  // Range — inline constant array literal (bounds must be compile-time constants)
  Range: (args, _compile, target) => {
    if (args.length < 2 || args.length > 3) {
      throw new Error(
        'Range: GPU compile expects 2 or 3 arguments (lo, hi, step?)'
      );
    }
    const lo = args[0].re;
    const hi = args[1].re;
    const step = args.length === 3 ? args[2].re : 1;
    if (
      !Number.isFinite(lo) ||
      !Number.isFinite(hi) ||
      !Number.isFinite(step)
    ) {
      throw new Error(
        'Range: GPU compile requires constant numeric bounds' +
          ' (non-constant ranges must be materialized at JS host then uploaded as a uniform)'
      );
    }
    if (step === 0) throw new Error('Range: step cannot be zero');
    const count = Math.max(0, Math.floor((hi - lo) / step) + 1);
    if (count === 0) {
      throw new Error(
        'Range: empty range (lo > hi for positive step, or lo < hi for negative step)'
      );
    }
    if (count > 256) {
      throw new Error(
        `Range: GPU compile inlines ranges up to 256 elements (got ${count})`
      );
    }
    const values: number[] = [];
    for (let i = 0; i < count; i++) values.push(lo + i * step);
    const isWGSL = target.language === 'wgsl';
    const arrayType = isWGSL ? `array<f32, ${count}>` : `float[${count}]`;
    return `${arrayType}(${values.map(formatGPUNumber).join(', ')})`;
  },

  // Loop — GPU for-loop (no IIFE, no let)
  Loop: (args, _compile, target) => {
    if (!args[0]) throw new Error('Loop: no body');
    if (!args[1]) throw new Error('Loop: no indexing set');

    const indexing = args[1];
    if (!isFunction(indexing, 'Element'))
      throw new Error('Loop: expected Element(index, Range(lo, hi))');

    const indexExpr = indexing.ops[0];
    const rangeExpr = indexing.ops[1];

    if (!isSymbol(indexExpr)) throw new Error('Loop: index must be a symbol');
    if (!isFunction(rangeExpr, 'Range'))
      throw new Error('Loop: expected Range(lo, hi)');

    const index = indexExpr.symbol;
    const lower = Math.floor(rangeExpr.ops[0].re);
    const upper = Math.floor(rangeExpr.ops[1].re);

    if (!Number.isFinite(lower) || !Number.isFinite(upper))
      throw new Error('Loop: bounds must be finite numbers');

    const isWGSL = target.language === 'wgsl';
    const intType = isWGSL ? 'i32' : 'int';

    const bodyCode = BaseCompiler.compile(args[0], {
      ...target,
      var: (id) => (id === index ? index : target.var(id)),
    });

    const indexDecl = isWGSL
      ? `var ${index}: ${intType}`
      : `${intType} ${index}`;
    return `for (${indexDecl} = ${lower}; ${index} <= ${upper}; ${index}++) {\n  ${bodyCode};\n}`;
  },

  // Statistical functions

  /**
   * GCD of two scalar arguments.
   *
   * Uses a preamble helper `_gpu_gcd` (Euclidean algorithm via `mod`).
   * Only two-argument form is supported in GPU targets.
   */
  GCD: (args, compile) => {
    if (args.length < 2) throw new Error('GCD: need at least two arguments');
    if (args.length > 2)
      throw new Error('GCD: GPU target supports only two-argument GCD');
    const a = args[0];
    const b = args[1];
    if (a === null || b === null) throw new Error('GCD: missing argument');
    return `_gpu_gcd(${compile(a)}, ${compile(b)})`;
  },

  /**
   * Variance of a compile-time-known list.
   *
   * Accepts either a single `List(...)` argument or N scalar arguments.
   * Generates fully inline code: computes mean then sum of squared deviations,
   * divided by (N-1) for sample variance (matches JS `_SYS.variance`).
   */
  Variance: (args, compile) => {
    // Normalise: if single List arg, use its elements; else use args directly.
    let elems: ReadonlyArray<Expression>;
    if (args.length === 1 && isFunction(args[0], 'List')) {
      elems = args[0].ops;
    } else if (args.length >= 2) {
      elems = args;
    } else {
      throw new Error(
        'Variance: GPU target requires a List argument or at least 2 scalar arguments'
      );
    }
    const n = elems.length;
    if (n < 2) throw new Error('Variance: need at least 2 elements');
    const compiled = elems.map((e) => compile(e));
    // mean = (v0 + v1 + ... + vN-1) / N
    const sum = compiled.join(' + ');
    const mean = `((${sum}) / ${formatGPUNumber(n)})`;
    // sum of squared deviations: (v0 - mean)^2 + ...
    const sqDiffs = compiled
      .map((c) => `(${c} - ${mean}) * (${c} - ${mean})`)
      .join(' + ');
    // sample variance: sum / (N - 1)
    return `((${sqDiffs}) / ${formatGPUNumber(n - 1)})`;
  },

  /**
   * Median of a compile-time-known list.
   *
   * Accepts either a single `List(...)` argument or N scalar arguments.
   * For N ≤ 8: generates a fully unrolled inline sorting network followed by
   * a middle-element pick. For larger N, throws (too large to inline cleanly).
   *
   * The sorting network uses the "odd-even merge sort" comparator pattern
   * inlined as `min`/`max` calls — no GPU statements required.
   */
  Median: (args, compile) => {
    // Normalise to element list
    let elems: ReadonlyArray<Expression>;
    if (args.length === 1 && isFunction(args[0], 'List')) {
      elems = args[0].ops;
    } else if (args.length >= 1) {
      elems = args;
    } else {
      throw new Error(
        'Median: GPU target requires a List argument or at least 1 scalar argument'
      );
    }
    const n = elems.length;
    if (n === 0) throw new Error('Median: empty list');
    if (n > 8) {
      throw new Error(
        `Median: GPU target supports up to 8 elements via inline sorting network (got ${n}). ` +
          'For larger lists, compute on the CPU and pass the result as a uniform.'
      );
    }

    // Compile each element. We'll refer to them by variable names v0..vN-1.
    // Build a sequence of min/max comparators that sort the array in place.
    // Then return the middle element (or average of two middles for even N).
    const compiled = elems.map((e) => compile(e));

    // For N=1, median is the single element
    if (n === 1) return compiled[0];

    // Build a small inline sort using a Batcher odd-even sort network.
    // We represent the "array" as a mutable JS array of code strings.
    // Each "comparator" sorts a pair: (v[i], v[j]) → min then max.
    // We inline this as: new_i = min(a, b); new_j = max(a, b)
    // But since GLSL/WGSL have no statements in expressions, we encode
    // the full sorted sequence using nested min/max only when possible.
    //
    // Strategy: generate all comparator pairs for sorting network (as a list),
    // then materialise the sorted array as named sub-expressions via let-binding.
    // Since GPU compile() returns strings (not blocks), we use a different
    // approach: produce a comma-expression–style sequence using _gpu_median helper.
    //
    // Simpler approach that avoids preamble: for each position from 0..n-1,
    // compute the k-th order statistic inline using the formula:
    //   kth_element(k, v[]) = sum over all subsets S of size k+1 of (-1)^...
    // This is exponential. Instead use the "min of maxes" approach:
    //   sorted[k] = (k+1)-th smallest = min over all (k+1)-subsets of max(subset)
    // This is O(n choose k+1) — too expensive for n=8.
    //
    // Cleanest solution: call `_gpu_median_N` preamble function.
    // We emit a per-size preamble (GPU_MEDIAN_PREAMBLE_N_GLSL / WGSL)
    // and return a call to `_gpu_median_N(v0, v1, ..., vN-1)`.
    return `_gpu_median_${n}(${compiled.join(', ')})`;
  },

  /**
   * Deterministic pseudorandom for GPU.
   *
   * All emitted forms return a GLSL `float` (or WGSL `f32`) so the result
   * composes with surrounding float arithmetic without explicit casts. The
   * "integer-bound" forms return an integer-valued float (the result of
   * `floor`), matching the convention used by `Floor` and other ostensibly
   * integer-returning operators in this target.
   *
   * - 0 args (GLSL only): fall back to a fragment-coord-derived seed.
   *   Only meaningful in fragment shaders (gl_FragCoord is FS-only).
   * - 0 args (WGSL): throws — WGSL has no built-in fragment coordinate;
   *   caller must provide an explicit seed.
   * - 1 arg, real-typed: `_gpu_random(seed)` — deterministic float in [0, 1)
   * - 1 arg, integer-typed: `floor(_gpu_random(float(n)) * float(n))` —
   *   integer-valued float in {0, 1, ..., n-1}. The seed is derived from
   *   `n` itself, so the result is per-pixel-and-n deterministic in GLSL.
   * - 2 args (integer m, n): float in [m, n), seeded from gl_FragCoord.
   *
   * JS-side `Random` has matching semantics (see `library/core.ts`'s
   * polymorphic dispatch). JS↔GLSL parity is approximate — same seed yields
   * a similar value, not bit-identical, due to fp64 vs fp32 and platform
   * `sin` differences.
   */
  Random: (args, compile, target) => {
    if (args.length === 0) {
      if (target.language === 'wgsl') {
        throw new Error(
          'Random(): WGSL compile requires an explicit seed argument. ' +
            'WGSL has no gl_FragCoord built-in outside fragment entry points, ' +
            'so the no-arg fallback used in GLSL is unavailable. ' +
            'Use Random(seed) where seed is a deterministic per-invocation value.'
        );
      }
      // GLSL fragment-shader fallback: derive a per-pixel seed from the
      // fragment coordinates. The 1024.0 multiplier separates rows in seed
      // space; viewport widths > 1024 px will alias (two pixels can produce
      // the same seed). Acceptable for typical viewport sizes.
      return '_gpu_random(gl_FragCoord.x + gl_FragCoord.y * 1024.0)';
    }
    if (args.length === 1) {
      const arg = args[0];
      // Integer-typed → integer-valued float in {0, ..., n-1}. Emit `floor`
      // (returns float in GLSL) rather than `int(floor(...))` so the result
      // remains a float and composes with mixed-precision arithmetic.
      if (BaseCompiler.isIntegerValued(arg)) {
        const compiled = compile(arg);
        return `floor(_gpu_random(float(${compiled})) * float(${compiled}))`;
      }
      // Real-typed → seeded float (existing behavior).
      return `_gpu_random(${compile(arg)})`;
    }
    if (args.length === 2) {
      // Random(m, n) — integer-valued float in [m, n)
      if (target.language === 'wgsl') {
        throw new Error(
          'Random(m, n): WGSL compile requires explicit seeding. ' +
            'Use a seeded variant or compute the integer range manually.'
        );
      }
      const m = compile(args[0]);
      const n = compile(args[1]);
      // Seed the integer draw from gl_FragCoord (GLSL fragment-shader path).
      const seed = '_gpu_random(gl_FragCoord.x + gl_FragCoord.y * 1024.0)';
      return `(float(${m}) + floor(${seed} * float((${n}) - (${m}))))`;
    }
    throw new Error('Random: GPU compile expects 0, 1, or 2 arguments');
  },

  // Function (lambda) — not supported in GPU
  Function: () => {
    throw new Error(
      'Anonymous functions (Function) are not supported in GPU targets'
    );
  },
};

/**
 * Compile a Matrix expression to GPU-native types when possible.
 *
 * Handles two optimizations:
 * - Column vectors (Nx1): flatten to vecN instead of nested single-element arrays
 * - Square matrices (NxN, N=2,3,4): use native matN types with column-major transposition
 *
 * Falls back to compiling the nested List structure for other shapes.
 */
export function compileGPUMatrix(
  args: ReadonlyArray<Expression>,
  compile: (expr: Expression) => string,
  vecFn: (n: number) => string,
  matFn: (n: number) => string,
  arrayFn: (n: number) => string
): string {
  const body = args[0];
  if (!isFunction(body)) return compile(body);

  const rows = body.ops;
  if (rows.length === 0) return compile(body);

  const numRows = rows.length;
  const firstRow = rows[0];
  const numCols = isFunction(firstRow) ? firstRow.nops : 0;

  // Column vector (Nx1): flatten to vecN or array<f32, N>
  if (numCols === 1 && rows.every((row) => isFunction(row) && row.nops === 1)) {
    const elements = rows.map((row) =>
      compile(isFunction(row) ? row.ops[0] : row)
    );
    if (numRows >= 2 && numRows <= 4)
      return `${vecFn(numRows)}(${elements.join(', ')})`;
    return `${arrayFn(numRows)}(${elements.join(', ')})`;
  }

  // Square matrix NxN (N=2,3,4): use native matrix type
  // GPU matrices are column-major, our Matrix is row-major → transpose
  if (
    numRows === numCols &&
    numRows >= 2 &&
    numRows <= 4 &&
    rows.every((row) => isFunction(row) && row.nops === numCols)
  ) {
    const cols: string[] = [];
    for (let c = 0; c < numCols; c++) {
      const colElements = rows.map((row) =>
        compile(isFunction(row) ? row.ops[c] : row)
      );
      cols.push(`${vecFn(numRows)}(${colElements.join(', ')})`);
    }
    return `${matFn(numRows)}(${cols.join(', ')})`;
  }

  // Default: compile the nested list structure as-is
  return compile(body);
}

/**
 * GPU gamma function using Lanczos approximation (g=7, n=9 coefficients).
 *
 * Uses reflection formula for z < 0.5 and Lanczos for z >= 0.5.
 * GLSL syntax.
 */
export const GPU_GAMMA_PREAMBLE_GLSL = `
float _gpu_gamma(float z) {
  const float PI = 3.14159265358979;
  // For z < 0.5, use reflection formula with inlined Lanczos (non-recursive)
  float w = z;
  if (z < 0.5) w = 1.0 - z;
  w -= 1.0;
  float x = 0.99999999999980993;
  x += 676.5203681218851 / (w + 1.0);
  x += -1259.1392167224028 / (w + 2.0);
  x += 771.32342877765313 / (w + 3.0);
  x += -176.61502916214059 / (w + 4.0);
  x += 12.507343278686905 / (w + 5.0);
  x += -0.13857109526572012 / (w + 6.0);
  x += 9.9843695780195716e-6 / (w + 7.0);
  x += 1.5056327351493116e-7 / (w + 8.0);
  float t = w + 7.5;
  float g = sqrt(2.0 * PI) * pow(t, w + 0.5) * exp(-t) * x;
  if (z < 0.5) return PI / (sin(PI * z) * g);
  return g;
}

float _gpu_gammaln(float z) {
  // Stirling asymptotic expansion for ln(Gamma(z)), z > 0
  float z3 = z * z * z;
  return z * log(z) - z - 0.5 * log(z)
    + 0.5 * log(2.0 * 3.14159265358979)
    + 1.0 / (12.0 * z)
    - 1.0 / (360.0 * z3)
    + 1.0 / (1260.0 * z3 * z * z);
}
`;

/**
 * GPU Gamma function preamble (WGSL syntax). WGSL has no implicit GLSL-style
 * `float`/braceless-`if` syntax, so a `_WGSL` variant is required (the GLSL
 * preamble does not compile as WGSL).
 */
export const GPU_GAMMA_PREAMBLE_WGSL = `
fn _gpu_gamma(z: f32) -> f32 {
  let PI = 3.14159265358979;
  var w = z;
  if (z < 0.5) { w = 1.0 - z; }
  w = w - 1.0;
  var x = 0.99999999999980993;
  x = x + 676.5203681218851 / (w + 1.0);
  x = x + -1259.1392167224028 / (w + 2.0);
  x = x + 771.32342877765313 / (w + 3.0);
  x = x + -176.61502916214059 / (w + 4.0);
  x = x + 12.507343278686905 / (w + 5.0);
  x = x + -0.13857109526572012 / (w + 6.0);
  x = x + 9.9843695780195716e-6 / (w + 7.0);
  x = x + 1.5056327351493116e-7 / (w + 8.0);
  let t = w + 7.5;
  let g = sqrt(2.0 * PI) * pow(t, w + 0.5) * exp(-t) * x;
  if (z < 0.5) { return PI / (sin(PI * z) * g); }
  return g;
}

fn _gpu_gammaln(z: f32) -> f32 {
  let z3 = z * z * z;
  return z * log(z) - z - 0.5 * log(z)
    + 0.5 * log(2.0 * 3.14159265358979)
    + 1.0 / (12.0 * z)
    - 1.0 / (360.0 * z3)
    + 1.0 / (1260.0 * z3 * z * z);
}
`;

/**
 * GPU error function using Abramowitz & Stegun approximation.
 * Maximum error: |epsilon(x)| <= 1.5e-7. GLSL syntax.
 */
export const GPU_ERF_PREAMBLE_GLSL = `
float _gpu_erf(float x) {
  float ax = abs(x);
  float t = 1.0 / (1.0 + 0.3275911 * ax);
  float y = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  float result = 1.0 - y * exp(-ax * ax);
  return x < 0.0 ? -result : result;
}

float _gpu_erfinv(float x) {
  float pi = 3.14159265358979;
  float x2 = x * x;
  float x3 = x * x2;
  float x5 = x3 * x2;
  float x7 = x5 * x2;
  float x9 = x7 * x2;
  return sqrt(pi) * 0.5 * (x + (pi / 12.0) * x3 + (7.0 * pi * pi / 480.0) * x5 + (127.0 * pi * pi * pi / 40320.0) * x7 + (4369.0 * pi * pi * pi * pi / 5806080.0) * x9);
}
`;

/**
 * GPU error function preamble (WGSL syntax). See GPU_GAMMA_PREAMBLE_WGSL.
 */
export const GPU_ERF_PREAMBLE_WGSL = `
fn _gpu_erf(x: f32) -> f32 {
  let ax = abs(x);
  let t = 1.0 / (1.0 + 0.3275911 * ax);
  let y = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  let result = 1.0 - y * exp(-ax * ax);
  if (x < 0.0) { return -result; }
  return result;
}

fn _gpu_erfinv(x: f32) -> f32 {
  let pi = 3.14159265358979;
  let x2 = x * x;
  let x3 = x * x2;
  let x5 = x3 * x2;
  let x7 = x5 * x2;
  let x9 = x7 * x2;
  return sqrt(pi) * 0.5 * (x + (pi / 12.0) * x3 + (7.0 * pi * pi / 480.0) * x5 + (127.0 * pi * pi * pi / 40320.0) * x7 + (4369.0 * pi * pi * pi * pi / 5806080.0) * x9);
}
`;

/**
 * GPU Heaviside step function preamble (GLSL syntax).
 * Returns 0 for x<0, 0.5 at x=0, 1 for x>0.
 */
export const GPU_HEAVISIDE_PREAMBLE_GLSL = `
float _gpu_heaviside(float x) {
  if (x < 0.0) return 0.0;
  if (x > 0.0) return 1.0;
  return 0.5;
}
`;

/**
 * GPU Heaviside step function preamble (WGSL syntax).
 */
export const GPU_HEAVISIDE_PREAMBLE_WGSL = `
fn _gpu_heaviside(x: f32) -> f32 {
  if (x < 0.0) { return 0.0; }
  if (x > 0.0) { return 1.0; }
  return 0.5;
}
`;

/**
 * GPU sinc function preamble (GLSL syntax).
 * sinc(x) = sin(x)/x, sinc(0) = 1.
 */
export const GPU_SINC_PREAMBLE_GLSL = `
float _gpu_sinc(float x) {
  if (abs(x) < 1e-10) return 1.0;
  return sin(x) / x;
}
`;

/**
 * GPU sinc function preamble (WGSL syntax).
 */
export const GPU_SINC_PREAMBLE_WGSL = `
fn _gpu_sinc(x: f32) -> f32 {
  if (abs(x) < 1e-10) { return 1.0; }
  return sin(x) / x;
}
`;

/**
 * GPU Horner polynomial evaluation helper (GLSL syntax).
 * Shared by FresnelC and FresnelS preambles.
 */
export const GPU_POLEVL_PREAMBLE_GLSL = `
float _gpu_polevl(float x, float c[12], int n) {
  float ans = c[0];
  for (int i = 1; i < n; i++) ans = ans * x + c[i];
  return ans;
}
`;

/**
 * GPU Horner polynomial evaluation helper (WGSL syntax).
 */
export const GPU_POLEVL_PREAMBLE_WGSL = `
fn _gpu_polevl(x: f32, c: array<f32, 12>, n: i32) -> f32 {
  var ans = c[0];
  for (var i: i32 = 1; i < n; i++) { ans = ans * x + c[i]; }
  return ans;
}
`;

/**
 * GPU Fresnel cosine integral preamble (GLSL syntax).
 *
 * C(x) = integral from 0 to x of cos(pi*t^2/2) dt.
 * Uses rational Chebyshev approximation (Cephes/scipy) with three regions:
 * |x|<1.6, 1.6<=|x|<36, |x|>=36.
 * Requires _gpu_polevl preamble.
 */
export const GPU_FRESNELC_PREAMBLE_GLSL = `
float _gpu_fresnelC(float x_in) {
  float sgn = x_in < 0.0 ? -1.0 : 1.0;
  float x = abs(x_in);

  if (x < 1.6) {
    float x2 = x * x;
    float t = x2 * x2;
    float cn[6] = float[6](
      -4.98843114573573548651e-8, 9.50428062829859605134e-6,
      -6.45191435683965050962e-4, 1.88843319396703850064e-2,
      -2.05525900955013891793e-1, 9.99999999999999998822e-1
    );
    float cd[7] = float[7](
      3.99982968972495980367e-12, 9.15439215774657478799e-10,
      1.25001862479598821474e-7, 1.22262789024179030997e-5,
      8.68029542941784300606e-4, 4.12142090722199792936e-2, 1.0
    );
    return sgn * x * _gpu_polevl(t, cn, 6) / _gpu_polevl(t, cd, 7);
  }

  if (x < 36.0) {
    float x2 = x * x;
    float t = 3.14159265358979 * x2;
    float u = 1.0 / (t * t);
    float fn[10] = float[10](
      4.21543555043677546506e-1, 1.43407919780758885261e-1,
      1.15220955073585758835e-2, 3.450179397825740279e-4,
      4.63613749287867322088e-6, 3.05568983790257605827e-8,
      1.02304514164907233465e-10, 1.72010743268161828879e-13,
      1.34283276233062758925e-16, 3.76329711269987889006e-20
    );
    float fd[11] = float[11](
      1.0, 7.51586398353378947175e-1,
      1.16888925859191382142e-1, 6.44051526508858611005e-3,
      1.55934409164153020873e-4, 1.8462756734893054587e-6,
      1.12699224763999035261e-8, 3.60140029589371370404e-11,
      5.8875453362157841001e-14, 4.52001434074129701496e-17,
      1.25443237090011264384e-20
    );
    float gn[11] = float[11](
      5.04442073643383265887e-1, 1.97102833525523411709e-1,
      1.87648584092575249293e-2, 6.84079380915393090172e-4,
      1.15138826111884280931e-5, 9.82852443688422223854e-8,
      4.45344415861750144738e-10, 1.08268041139020870318e-12,
      1.37555460633261799868e-15, 8.36354435630677421531e-19,
      1.86958710162783235106e-22
    );
    float gd[12] = float[12](
      1.0, 1.47495759925128324529,
      3.37748989120019970451e-1, 2.53603741420338795122e-2,
      8.14679107184306179049e-4, 1.27545075667729118702e-5,
      1.04314589657571990585e-7, 4.60680728515232032307e-10,
      1.10273215066240270757e-12, 1.38796531259578871258e-15,
      8.39158816283118707363e-19, 1.86958710162783236342e-22
    );
    float f = 1.0 - u * _gpu_polevl(u, fn, 10) / _gpu_polevl(u, fd, 11);
    float g = (1.0 / t) * _gpu_polevl(u, gn, 11) / _gpu_polevl(u, gd, 12);
    float z = 1.5707963267948966 * x2;
    float c = cos(z);
    float s = sin(z);
    return sgn * (0.5 + (f * s - g * c) / (3.14159265358979 * x));
  }

  return sgn * 0.5;
}
`;

/**
 * GPU Fresnel cosine integral preamble (WGSL syntax).
 * Requires _gpu_polevl preamble.
 */
export const GPU_FRESNELC_PREAMBLE_WGSL = `
fn _gpu_fresnelC(x_in: f32) -> f32 {
  let sgn: f32 = select(1.0, -1.0, x_in < 0.0);
  let x = abs(x_in);

  if (x < 1.6) {
    let x2 = x * x;
    let t = x2 * x2;
    var cn = array<f32, 12>(
      -4.98843114573573548651e-8, 9.50428062829859605134e-6,
      -6.45191435683965050962e-4, 1.88843319396703850064e-2,
      -2.05525900955013891793e-1, 9.99999999999999998822e-1,
      0.0, 0.0, 0.0, 0.0, 0.0, 0.0
    );
    var cd = array<f32, 12>(
      3.99982968972495980367e-12, 9.15439215774657478799e-10,
      1.25001862479598821474e-7, 1.22262789024179030997e-5,
      8.68029542941784300606e-4, 4.12142090722199792936e-2, 1.0,
      0.0, 0.0, 0.0, 0.0, 0.0
    );
    return sgn * x * _gpu_polevl(t, cn, 6) / _gpu_polevl(t, cd, 7);
  }

  if (x < 36.0) {
    let x2 = x * x;
    let t = 3.14159265358979 * x2;
    let u = 1.0 / (t * t);
    var fn = array<f32, 12>(
      4.21543555043677546506e-1, 1.43407919780758885261e-1,
      1.15220955073585758835e-2, 3.450179397825740279e-4,
      4.63613749287867322088e-6, 3.05568983790257605827e-8,
      1.02304514164907233465e-10, 1.72010743268161828879e-13,
      1.34283276233062758925e-16, 3.76329711269987889006e-20,
      0.0, 0.0
    );
    var fd = array<f32, 12>(
      1.0, 7.51586398353378947175e-1,
      1.16888925859191382142e-1, 6.44051526508858611005e-3,
      1.55934409164153020873e-4, 1.8462756734893054587e-6,
      1.12699224763999035261e-8, 3.60140029589371370404e-11,
      5.8875453362157841001e-14, 4.52001434074129701496e-17,
      1.25443237090011264384e-20, 0.0
    );
    var gn = array<f32, 12>(
      5.04442073643383265887e-1, 1.97102833525523411709e-1,
      1.87648584092575249293e-2, 6.84079380915393090172e-4,
      1.15138826111884280931e-5, 9.82852443688422223854e-8,
      4.45344415861750144738e-10, 1.08268041139020870318e-12,
      1.37555460633261799868e-15, 8.36354435630677421531e-19,
      1.86958710162783235106e-22, 0.0
    );
    var gd = array<f32, 12>(
      1.0, 1.47495759925128324529,
      3.37748989120019970451e-1, 2.53603741420338795122e-2,
      8.14679107184306179049e-4, 1.27545075667729118702e-5,
      1.04314589657571990585e-7, 4.60680728515232032307e-10,
      1.10273215066240270757e-12, 1.38796531259578871258e-15,
      8.39158816283118707363e-19, 1.86958710162783236342e-22
    );
    let f = 1.0 - u * _gpu_polevl(u, fn, 10) / _gpu_polevl(u, fd, 11);
    let g = (1.0 / t) * _gpu_polevl(u, gn, 11) / _gpu_polevl(u, gd, 12);
    let z = 1.5707963267948966 * x2;
    let c = cos(z);
    let s = sin(z);
    return sgn * (0.5 + (f * s - g * c) / (3.14159265358979 * x));
  }

  return sgn * 0.5;
}
`;

/**
 * GPU Fresnel sine integral preamble (GLSL syntax).
 *
 * S(x) = integral from 0 to x of sin(pi*t^2/2) dt.
 * Uses rational Chebyshev approximation (Cephes/scipy) with three regions.
 * Requires _gpu_polevl preamble.
 */
export const GPU_FRESNELS_PREAMBLE_GLSL = `
float _gpu_fresnelS(float x_in) {
  float sgn = x_in < 0.0 ? -1.0 : 1.0;
  float x = abs(x_in);

  if (x < 1.6) {
    float x2 = x * x;
    float t = x2 * x2;
    float sn[6] = float[6](
      -2.99181919401019853726e3, 7.08840045257738576863e5,
      -6.29741486205862506537e7, 2.54890880573376359104e9,
      -4.42979518059697779103e10, 3.18016297876567817986e11
    );
    float sd[7] = float[7](
      1.0, 2.81376268889994315696e2, 4.55847810806532581675e4,
      5.1734388877009640073e6, 4.19320245898111231129e8, 2.2441179564534092094e10,
      6.07366389490084914091e11
    );
    return sgn * x * x2 * _gpu_polevl(t, sn, 6) / _gpu_polevl(t, sd, 7);
  }

  if (x < 36.0) {
    float x2 = x * x;
    float t = 3.14159265358979 * x2;
    float u = 1.0 / (t * t);
    float fn[10] = float[10](
      4.21543555043677546506e-1, 1.43407919780758885261e-1,
      1.15220955073585758835e-2, 3.450179397825740279e-4,
      4.63613749287867322088e-6, 3.05568983790257605827e-8,
      1.02304514164907233465e-10, 1.72010743268161828879e-13,
      1.34283276233062758925e-16, 3.76329711269987889006e-20
    );
    float fd[11] = float[11](
      1.0, 7.51586398353378947175e-1,
      1.16888925859191382142e-1, 6.44051526508858611005e-3,
      1.55934409164153020873e-4, 1.8462756734893054587e-6,
      1.12699224763999035261e-8, 3.60140029589371370404e-11,
      5.8875453362157841001e-14, 4.52001434074129701496e-17,
      1.25443237090011264384e-20
    );
    float gn[11] = float[11](
      5.04442073643383265887e-1, 1.97102833525523411709e-1,
      1.87648584092575249293e-2, 6.84079380915393090172e-4,
      1.15138826111884280931e-5, 9.82852443688422223854e-8,
      4.45344415861750144738e-10, 1.08268041139020870318e-12,
      1.37555460633261799868e-15, 8.36354435630677421531e-19,
      1.86958710162783235106e-22
    );
    float gd[12] = float[12](
      1.0, 1.47495759925128324529,
      3.37748989120019970451e-1, 2.53603741420338795122e-2,
      8.14679107184306179049e-4, 1.27545075667729118702e-5,
      1.04314589657571990585e-7, 4.60680728515232032307e-10,
      1.10273215066240270757e-12, 1.38796531259578871258e-15,
      8.39158816283118707363e-19, 1.86958710162783236342e-22
    );
    float f = 1.0 - u * _gpu_polevl(u, fn, 10) / _gpu_polevl(u, fd, 11);
    float g = (1.0 / t) * _gpu_polevl(u, gn, 11) / _gpu_polevl(u, gd, 12);
    float z = 1.5707963267948966 * x2;
    float c = cos(z);
    float s = sin(z);
    return sgn * (0.5 - (f * c + g * s) / (3.14159265358979 * x));
  }

  return sgn * 0.5;
}
`;

/**
 * GPU Fresnel sine integral preamble (WGSL syntax).
 * Requires _gpu_polevl preamble.
 */
export const GPU_FRESNELS_PREAMBLE_WGSL = `
fn _gpu_fresnelS(x_in: f32) -> f32 {
  let sgn: f32 = select(1.0, -1.0, x_in < 0.0);
  let x = abs(x_in);

  if (x < 1.6) {
    let x2 = x * x;
    let t = x2 * x2;
    var sn = array<f32, 12>(
      -2.99181919401019853726e3, 7.08840045257738576863e5,
      -6.29741486205862506537e7, 2.54890880573376359104e9,
      -4.42979518059697779103e10, 3.18016297876567817986e11,
      0.0, 0.0, 0.0, 0.0, 0.0, 0.0
    );
    var sd = array<f32, 12>(
      1.0, 2.81376268889994315696e2, 4.55847810806532581675e4,
      5.1734388877009640073e6, 4.19320245898111231129e8, 2.2441179564534092094e10,
      6.07366389490084914091e11,
      0.0, 0.0, 0.0, 0.0, 0.0
    );
    return sgn * x * x2 * _gpu_polevl(t, sn, 6) / _gpu_polevl(t, sd, 7);
  }

  if (x < 36.0) {
    let x2 = x * x;
    let t = 3.14159265358979 * x2;
    let u = 1.0 / (t * t);
    var fn = array<f32, 12>(
      4.21543555043677546506e-1, 1.43407919780758885261e-1,
      1.15220955073585758835e-2, 3.450179397825740279e-4,
      4.63613749287867322088e-6, 3.05568983790257605827e-8,
      1.02304514164907233465e-10, 1.72010743268161828879e-13,
      1.34283276233062758925e-16, 3.76329711269987889006e-20,
      0.0, 0.0
    );
    var fd = array<f32, 12>(
      1.0, 7.51586398353378947175e-1,
      1.16888925859191382142e-1, 6.44051526508858611005e-3,
      1.55934409164153020873e-4, 1.8462756734893054587e-6,
      1.12699224763999035261e-8, 3.60140029589371370404e-11,
      5.8875453362157841001e-14, 4.52001434074129701496e-17,
      1.25443237090011264384e-20, 0.0
    );
    var gn = array<f32, 12>(
      5.04442073643383265887e-1, 1.97102833525523411709e-1,
      1.87648584092575249293e-2, 6.84079380915393090172e-4,
      1.15138826111884280931e-5, 9.82852443688422223854e-8,
      4.45344415861750144738e-10, 1.08268041139020870318e-12,
      1.37555460633261799868e-15, 8.36354435630677421531e-19,
      1.86958710162783235106e-22, 0.0
    );
    var gd = array<f32, 12>(
      1.0, 1.47495759925128324529,
      3.37748989120019970451e-1, 2.53603741420338795122e-2,
      8.14679107184306179049e-4, 1.27545075667729118702e-5,
      1.04314589657571990585e-7, 4.60680728515232032307e-10,
      1.10273215066240270757e-12, 1.38796531259578871258e-15,
      8.39158816283118707363e-19, 1.86958710162783236342e-22
    );
    let f = 1.0 - u * _gpu_polevl(u, fn, 10) / _gpu_polevl(u, fd, 11);
    let g = (1.0 / t) * _gpu_polevl(u, gn, 11) / _gpu_polevl(u, gd, 12);
    let z = 1.5707963267948966 * x2;
    let c = cos(z);
    let s = sin(z);
    return sgn * (0.5 - (f * c + g * s) / (3.14159265358979 * x));
  }

  return sgn * 0.5;
}
`;

/**
 * GPU Bessel J function preamble (GLSL syntax).
 *
 * J_n(x) for integer order n. Uses three algorithms:
 * - Power series for small x (x < 5+n)
 * - Hankel asymptotic for large x (x > 25+n^2/2)
 * - Miller's backward recurrence for intermediate x
 */
export const GPU_BESSELJ_PREAMBLE_GLSL = `
float _gpu_factorial(int n) {
  float f = 1.0;
  for (int i = 2; i <= n; i++) f *= float(i);
  return f;
}

float _gpu_besselJ_series(int n, float x) {
  float halfX = x / 2.0;
  float negQ = -(x * x) / 4.0;
  float term = 1.0;
  for (int i = 1; i <= n; i++) term /= float(i);
  float s = term;
  for (int k = 1; k <= 60; k++) {
    term *= negQ / (float(k) * float(n + k));
    s += term;
    if (abs(term) < abs(s) * 1e-7) break;
  }
  return s * pow(halfX, float(n));
}

float _gpu_besselJ_asymptotic(int n, float x) {
  float mu = 4.0 * float(n) * float(n);
  float P = 1.0;
  float Q = 0.0;
  float ak = 1.0;
  float e8x = 8.0 * x;
  for (int k = 1; k <= 12; k++) {
    float twokm1 = float(2 * k - 1);
    ak *= mu - twokm1 * twokm1;
    float denom = _gpu_factorial(k) * pow(e8x, float(k));
    float contrib = ak / denom;
    if (k == 1 || k == 3 || k == 5 || k == 7 || k == 9 || k == 11) {
      // odd k: contributes to Q
      if (((k - 1) / 2) % 2 == 0) Q += contrib;
      else Q -= contrib;
    } else {
      // even k: contributes to P
      if ((k / 2) % 2 == 1) P -= contrib;
      else P += contrib;
    }
    if (abs(contrib) < 1e-7) break;
  }
  float chi = x - (float(n) / 2.0 + 0.25) * 3.14159265358979;
  return sqrt(2.0 / (3.14159265358979 * x)) * (P * cos(chi) - Q * sin(chi));
}

float _gpu_besselJ(int n, float x) {
  if (x == 0.0) return n == 0 ? 1.0 : 0.0;
  float sgn = 1.0;
  if (n < 0) {
    n = -n;
    if (n % 2 != 0) sgn = -1.0;
  }
  if (x < 0.0) {
    x = -x;
    if (n % 2 != 0) sgn *= -1.0;
  }
  if (x > 25.0 + float(n * n) / 2.0) return sgn * _gpu_besselJ_asymptotic(n, x);
  if (x < 5.0 + float(n)) return sgn * _gpu_besselJ_series(n, x);
  // Miller's backward recurrence
  int M = max(n + 20, int(ceil(x)) + 30);
  if (M > 200) return sgn * _gpu_besselJ_series(n, x);
  float vals[201];
  float jp1 = 0.0;
  float jk = 1.0;
  vals[M] = jk;
  for (int k = M; k >= 1; k--) {
    float jm1 = (2.0 * float(k) / x) * jk - jp1;
    jp1 = jk;
    jk = jm1;
    vals[k - 1] = jk;
  }
  float norm = vals[0];
  for (int k = 2; k <= M; k += 2) norm += 2.0 * vals[k];
  return sgn * vals[n] / norm;
}
`;

/**
 * GPU Bessel J function preamble (WGSL syntax).
 */
export const GPU_BESSELJ_PREAMBLE_WGSL = `
fn _gpu_factorial(n: i32) -> f32 {
  var f: f32 = 1.0;
  for (var i: i32 = 2; i <= n; i++) { f *= f32(i); }
  return f;
}

fn _gpu_besselJ_series(n_in: i32, x: f32) -> f32 {
  let halfX = x / 2.0;
  let negQ = -(x * x) / 4.0;
  var term: f32 = 1.0;
  for (var i: i32 = 1; i <= n_in; i++) { term /= f32(i); }
  var s = term;
  for (var k: i32 = 1; k <= 60; k++) {
    term *= negQ / (f32(k) * f32(n_in + k));
    s += term;
    if (abs(term) < abs(s) * 1e-7) { break; }
  }
  return s * pow(halfX, f32(n_in));
}

fn _gpu_besselJ_asymptotic(n_in: i32, x: f32) -> f32 {
  let mu = 4.0 * f32(n_in) * f32(n_in);
  var P: f32 = 1.0;
  var Q: f32 = 0.0;
  var ak: f32 = 1.0;
  let e8x = 8.0 * x;
  for (var k: i32 = 1; k <= 12; k++) {
    let twokm1 = f32(2 * k - 1);
    ak *= mu - twokm1 * twokm1;
    let denom = _gpu_factorial(k) * pow(e8x, f32(k));
    let contrib = ak / denom;
    if (k == 1 || k == 3 || k == 5 || k == 7 || k == 9 || k == 11) {
      if (((k - 1) / 2) % 2 == 0) { Q += contrib; }
      else { Q -= contrib; }
    } else {
      if ((k / 2) % 2 == 1) { P -= contrib; }
      else { P += contrib; }
    }
    if (abs(contrib) < 1e-7) { break; }
  }
  let chi = x - (f32(n_in) / 2.0 + 0.25) * 3.14159265358979;
  return sqrt(2.0 / (3.14159265358979 * x)) * (P * cos(chi) - Q * sin(chi));
}

fn _gpu_besselJ(n_in: i32, x_in: f32) -> f32 {
  var n = n_in;
  var x = x_in;
  if (x == 0.0) { return select(0.0, 1.0, n == 0); }
  var sgn: f32 = 1.0;
  if (n < 0) {
    n = -n;
    if (n % 2 != 0) { sgn = -1.0; }
  }
  if (x < 0.0) {
    x = -x;
    if (n % 2 != 0) { sgn *= -1.0; }
  }
  if (x > 25.0 + f32(n * n) / 2.0) { return sgn * _gpu_besselJ_asymptotic(n, x); }
  if (x < 5.0 + f32(n)) { return sgn * _gpu_besselJ_series(n, x); }
  // Miller's backward recurrence
  var M = max(n + 20, i32(ceil(x)) + 30);
  if (M > 200) { return sgn * _gpu_besselJ_series(n, x); }
  var vals: array<f32, 201>;
  var jp1: f32 = 0.0;
  var jk: f32 = 1.0;
  vals[M] = jk;
  for (var k: i32 = M; k >= 1; k--) {
    let jm1 = (2.0 * f32(k) / x) * jk - jp1;
    jp1 = jk;
    jk = jm1;
    vals[k - 1] = jk;
  }
  var norm = vals[0];
  for (var k2: i32 = 2; k2 <= M; k2 += 2) { norm += 2.0 * vals[k2]; }
  return sgn * vals[n] / norm;
}
`;

/**
 * Fractal preamble (GLSL syntax).
 *
 * Smooth escape-time iteration for Mandelbrot and Julia sets.
 * Both functions return a normalized float in [0, 1] with smooth coloring
 * (log2(log2(|z|²)) formula) to avoid banding.
 */
export const GPU_FRACTAL_PREAMBLE_GLSL = `
float _fractal_mandelbrot(vec2 c, int maxIter) {
  vec2 z = vec2(0.0, 0.0);
  for (int i = 0; i < maxIter; i++) {
    z = vec2(z.x*z.x - z.y*z.y + c.x, 2.0*z.x*z.y + c.y);
    if (dot(z, z) > 4.0)
      return clamp((float(i) - log2(log2(dot(z, z))) + 4.0) / float(maxIter), 0.0, 1.0);
  }
  return 1.0;
}

float _fractal_julia(vec2 z, vec2 c, int maxIter) {
  for (int i = 0; i < maxIter; i++) {
    z = vec2(z.x*z.x - z.y*z.y + c.x, 2.0*z.x*z.y + c.y);
    if (dot(z, z) > 4.0)
      return clamp((float(i) - log2(log2(dot(z, z))) + 4.0) / float(maxIter), 0.0, 1.0);
  }
  return 1.0;
}
`;

/**
 * Fractal preamble (WGSL syntax).
 */
export const GPU_FRACTAL_PREAMBLE_WGSL = `
fn _fractal_mandelbrot(c: vec2f, maxIter: i32) -> f32 {
  var z = vec2f(0.0, 0.0);
  for (var i: i32 = 0; i < maxIter; i++) {
    z = vec2f(z.x*z.x - z.y*z.y + c.x, 2.0*z.x*z.y + c.y);
    if (dot(z, z) > 4.0) {
      return clamp((f32(i) - log2(log2(dot(z, z))) + 4.0) / f32(maxIter), 0.0, 1.0);
    }
  }
  return 1.0;
}

fn _fractal_julia(z_in: vec2f, c: vec2f, maxIter: i32) -> f32 {
  var z = z_in;
  for (var i: i32 = 0; i < maxIter; i++) {
    z = vec2f(z.x*z.x - z.y*z.y + c.x, 2.0*z.x*z.y + c.y);
    if (dot(z, z) > 4.0) {
      return clamp((f32(i) - log2(log2(dot(z, z))) + 4.0) / f32(maxIter), 0.0, 1.0);
    }
  }
  return 1.0;
}
`;

// ─── Statistical preambles ────────────────────────────────────────────────────

/**
 * GPU GCD preamble (GLSL syntax).
 * Euclidean algorithm over floats; works for integer-valued inputs.
 */
export const GPU_GCD_PREAMBLE_GLSL = `
float _gpu_gcd(float a, float b) {
  a = abs(a); b = abs(b);
  for (int i = 0; i < 32; i++) {
    if (b < 0.5) break;
    float t = mod(a, b);
    a = b;
    b = t;
  }
  return a;
}
`;

/**
 * GPU GCD preamble (WGSL syntax).
 */
export const GPU_GCD_PREAMBLE_WGSL = `
fn _gpu_gcd(a_in: f32, b_in: f32) -> f32 {
  var a = abs(a_in); var b = abs(b_in);
  for (var i: i32 = 0; i < 32; i++) {
    if (b < 0.5) { break; }
    let t = a % b;
    a = b;
    b = t;
  }
  return a;
}
`;

/**
 * GPU Random preamble (GLSL syntax).
 *
 * Deterministic pseudorandom in [0, 1) from a float seed.
 * Standard fract-sin hash; reproducible across runs for the same seed.
 * Note: this hash exhibits visible banding near seed ≈ kπ for integer k.
 * For high-quality shader random, callers should use a more robust hash
 * (e.g. PCG or xxHash) and pre-seed it appropriately.
 */
export const GPU_RANDOM_PREAMBLE_GLSL = `
// Deterministic pseudorandom in [0, 1) from a float seed.
// Standard fract-sin hash; reproducible across runs for the same seed.
// Note: this hash exhibits visible banding near seed ≈ kπ for integer k.
// For high-quality shader random, callers should use a more robust hash
// (e.g. PCG or xxHash) and pre-seed it appropriately.
float _gpu_random(float seed) {
  return fract(sin(seed * 12.9898) * 43758.5453);
}
`;

/**
 * GPU Random preamble (WGSL syntax).
 *
 * Deterministic pseudorandom in [0, 1) from a float seed.
 * Standard fract-sin hash; reproducible across runs for the same seed.
 * Note: this hash exhibits visible banding near seed ≈ kπ for integer k.
 * For high-quality shader random, callers should use a more robust hash
 * (e.g. PCG or xxHash) and pre-seed it appropriately.
 */
export const GPU_RANDOM_PREAMBLE_WGSL = `
// Deterministic pseudorandom in [0, 1) from a float seed.
// Standard fract-sin hash; reproducible across runs for the same seed.
// Note: this hash exhibits visible banding near seed ≈ kπ for integer k.
// For high-quality shader random, callers should use a more robust hash
// (e.g. PCG or xxHash) and pre-seed it appropriately.
fn _gpu_random(seed: f32) -> f32 {
  return fract(sin(seed * 12.9898) * 43758.5453);
}
`;

/**
 * GPU Median preamble (GLSL syntax).
 *
 * One function per supported list size (2..8) using sorting networks.
 * Each function takes N float arguments and returns the median via a
 * Batcher odd-even merge sort encoded entirely as min/max calls.
 */
export const GPU_MEDIAN_PREAMBLE_GLSL = `
float _gpu_median_2(float a, float b) {
  return (a + b) * 0.5;
}
float _gpu_median_3(float a, float b, float c) {
  return max(min(a, b), min(max(a, b), c));
}
float _gpu_median_4(float a, float b, float c, float d) {
  float lo = max(min(a, b), min(c, d));
  float hi = min(max(a, b), max(c, d));
  return (lo + hi) * 0.5;
}
float _gpu_median_5(float a, float b, float c, float d, float e) {
  // 9-comparator Bose-Nelson sort; v2 holds the median.
  float t; float v0=a,v1=b,v2=c,v3=d,v4=e;
  t=min(v0,v1); v1=max(v0,v1); v0=t;
  t=min(v3,v4); v4=max(v3,v4); v3=t;
  t=min(v2,v4); v4=max(v2,v4); v2=t;
  t=min(v2,v3); v3=max(v2,v3); v2=t;
  t=min(v0,v3); v3=max(v0,v3); v0=t;
  t=min(v0,v2); v2=max(v0,v2); v0=t;
  t=min(v1,v4); v4=max(v1,v4); v1=t;
  t=min(v1,v3); v3=max(v1,v3); v1=t;
  t=min(v1,v2); v2=max(v1,v2); v1=t;
  return v2;
}
float _gpu_median_6(float a, float b, float c, float d, float e, float f) {
  float t; float v0=a,v1=b,v2=c,v3=d,v4=e,v5=f;
  t=min(v0,v1); v1=max(v0,v1); v0=t;
  t=min(v2,v3); v3=max(v2,v3); v2=t;
  t=min(v4,v5); v5=max(v4,v5); v4=t;
  t=min(v0,v2); v2=max(v0,v2); v0=t;
  t=min(v1,v3); v3=max(v1,v3); v1=t;
  t=min(v0,v4); v4=max(v0,v4); v0=t;
  t=min(v1,v5); v5=max(v1,v5); v1=t;
  t=min(v2,v4); v4=max(v2,v4); v2=t;
  t=min(v1,v2); v2=max(v1,v2); v1=t;
  t=min(v3,v5); v5=max(v3,v5); v3=t;
  t=min(v3,v4); v4=max(v3,v4); v3=t;
  return (v2 + v3) * 0.5;
}
float _gpu_median_7(float a, float b, float c, float d, float e, float f, float g) {
  float t; float v0=a,v1=b,v2=c,v3=d,v4=e,v5=f,v6=g;
  t=min(v0,v1); v1=max(v0,v1); v0=t;
  t=min(v2,v3); v3=max(v2,v3); v2=t;
  t=min(v4,v5); v5=max(v4,v5); v4=t;
  t=min(v0,v2); v2=max(v0,v2); v0=t;
  t=min(v1,v3); v3=max(v1,v3); v1=t;
  t=min(v4,v6); v6=max(v4,v6); v4=t;
  t=min(v0,v4); v4=max(v0,v4); v0=t;
  t=min(v1,v5); v5=max(v1,v5); v1=t;
  t=min(v2,v6); v6=max(v2,v6); v2=t;
  t=min(v1,v2); v2=max(v1,v2); v1=t;
  t=min(v3,v5); v5=max(v3,v5); v3=t;
  t=min(v2,v4); v4=max(v2,v4); v2=t;
  t=min(v3,v4); v4=max(v3,v4); v3=t;
  return v3;
}
float _gpu_median_8(float a, float b, float c, float d, float e, float f, float g, float h) {
  float t; float v0=a,v1=b,v2=c,v3=d,v4=e,v5=f,v6=g,v7=h;
  t=min(v0,v1); v1=max(v0,v1); v0=t;
  t=min(v2,v3); v3=max(v2,v3); v2=t;
  t=min(v4,v5); v5=max(v4,v5); v4=t;
  t=min(v6,v7); v7=max(v6,v7); v6=t;
  t=min(v0,v2); v2=max(v0,v2); v0=t;
  t=min(v1,v3); v3=max(v1,v3); v1=t;
  t=min(v4,v6); v6=max(v4,v6); v4=t;
  t=min(v5,v7); v7=max(v5,v7); v5=t;
  t=min(v0,v4); v4=max(v0,v4); v0=t;
  t=min(v1,v5); v5=max(v1,v5); v1=t;
  t=min(v2,v6); v6=max(v2,v6); v2=t;
  t=min(v3,v7); v7=max(v3,v7); v3=t;
  t=min(v1,v2); v2=max(v1,v2); v1=t;
  t=min(v3,v4); v4=max(v3,v4); v3=t;
  t=min(v5,v6); v6=max(v5,v6); v5=t;
  t=min(v3,v5); v5=max(v3,v5); v3=t;
  t=min(v2,v4); v4=max(v2,v4); v2=t;
  t=min(v3,v4); v4=max(v3,v4); v3=t;
  return (v3 + v4) * 0.5;
}
`;

/**
 * GPU Median preamble (WGSL syntax).
 *
 * Same sorting-network logic as the GLSL version with WGSL syntax.
 */
export const GPU_MEDIAN_PREAMBLE_WGSL = `
fn _gpu_median_2(a: f32, b: f32) -> f32 {
  return (a + b) * 0.5;
}
fn _gpu_median_3(a: f32, b: f32, c: f32) -> f32 {
  return max(min(a, b), min(max(a, b), c));
}
fn _gpu_median_4(a: f32, b: f32, c: f32, d: f32) -> f32 {
  let lo = max(min(a, b), min(c, d));
  let hi = min(max(a, b), max(c, d));
  return (lo + hi) * 0.5;
}
fn _gpu_median_5(a: f32, b: f32, c: f32, d: f32, e: f32) -> f32 {
  // 9-comparator Bose-Nelson sort; v2 holds the median.
  var v0=a; var v1=b; var v2=c; var v3=d; var v4=e; var t: f32;
  t=min(v0,v1); v1=max(v0,v1); v0=t;
  t=min(v3,v4); v4=max(v3,v4); v3=t;
  t=min(v2,v4); v4=max(v2,v4); v2=t;
  t=min(v2,v3); v3=max(v2,v3); v2=t;
  t=min(v0,v3); v3=max(v0,v3); v0=t;
  t=min(v0,v2); v2=max(v0,v2); v0=t;
  t=min(v1,v4); v4=max(v1,v4); v1=t;
  t=min(v1,v3); v3=max(v1,v3); v1=t;
  t=min(v1,v2); v2=max(v1,v2); v1=t;
  return v2;
}
fn _gpu_median_6(a: f32, b: f32, c: f32, d: f32, e: f32, f: f32) -> f32 {
  var v0=a; var v1=b; var v2=c; var v3=d; var v4=e; var v5=f; var t: f32;
  t=min(v0,v1); v1=max(v0,v1); v0=t;
  t=min(v2,v3); v3=max(v2,v3); v2=t;
  t=min(v4,v5); v5=max(v4,v5); v4=t;
  t=min(v0,v2); v2=max(v0,v2); v0=t;
  t=min(v1,v3); v3=max(v1,v3); v1=t;
  t=min(v0,v4); v4=max(v0,v4); v0=t;
  t=min(v1,v5); v5=max(v1,v5); v1=t;
  t=min(v2,v4); v4=max(v2,v4); v2=t;
  t=min(v1,v2); v2=max(v1,v2); v1=t;
  t=min(v3,v5); v5=max(v3,v5); v3=t;
  t=min(v3,v4); v4=max(v3,v4); v3=t;
  return (v2 + v3) * 0.5;
}
fn _gpu_median_7(a: f32, b: f32, c: f32, d: f32, e: f32, f: f32, g: f32) -> f32 {
  var v0=a; var v1=b; var v2=c; var v3=d; var v4=e; var v5=f; var v6=g; var t: f32;
  t=min(v0,v1); v1=max(v0,v1); v0=t;
  t=min(v2,v3); v3=max(v2,v3); v2=t;
  t=min(v4,v5); v5=max(v4,v5); v4=t;
  t=min(v0,v2); v2=max(v0,v2); v0=t;
  t=min(v1,v3); v3=max(v1,v3); v1=t;
  t=min(v4,v6); v6=max(v4,v6); v4=t;
  t=min(v0,v4); v4=max(v0,v4); v0=t;
  t=min(v1,v5); v5=max(v1,v5); v1=t;
  t=min(v2,v6); v6=max(v2,v6); v2=t;
  t=min(v1,v2); v2=max(v1,v2); v1=t;
  t=min(v3,v5); v5=max(v3,v5); v3=t;
  t=min(v2,v4); v4=max(v2,v4); v2=t;
  t=min(v3,v4); v4=max(v3,v4); v3=t;
  return v3;
}
fn _gpu_median_8(a: f32, b: f32, c: f32, d: f32, e: f32, f: f32, g: f32, h: f32) -> f32 {
  var v0=a; var v1=b; var v2=c; var v3=d; var v4=e; var v5=f; var v6=g; var v7=h; var t: f32;
  t=min(v0,v1); v1=max(v0,v1); v0=t;
  t=min(v2,v3); v3=max(v2,v3); v2=t;
  t=min(v4,v5); v5=max(v4,v5); v4=t;
  t=min(v6,v7); v7=max(v6,v7); v6=t;
  t=min(v0,v2); v2=max(v0,v2); v0=t;
  t=min(v1,v3); v3=max(v1,v3); v1=t;
  t=min(v4,v6); v6=max(v4,v6); v4=t;
  t=min(v5,v7); v7=max(v5,v7); v5=t;
  t=min(v0,v4); v4=max(v0,v4); v0=t;
  t=min(v1,v5); v5=max(v1,v5); v1=t;
  t=min(v2,v6); v6=max(v2,v6); v2=t;
  t=min(v3,v7); v7=max(v3,v7); v3=t;
  t=min(v1,v2); v2=max(v1,v2); v1=t;
  t=min(v3,v4); v4=max(v3,v4); v3=t;
  t=min(v5,v6); v6=max(v5,v6); v5=t;
  t=min(v3,v5); v5=max(v3,v5); v3=t;
  t=min(v2,v4); v4=max(v2,v4); v2=t;
  t=min(v3,v4); v4=max(v3,v4); v3=t;
  return (v3 + v4) * 0.5;
}
`;

// ─── Color preamble ────────────────────────────────────────────────────────────

/**
 * GPU color space conversion preamble (GLSL syntax).
 *
 * Canonical color value: vec3 OKLCh `(L, C, H_deg)` — same convention as the
 * interpreted/JS-runtime layer. Shaders that write to a sRGB framebuffer must
 * wrap the final color in `_gpu_oklch_to_srgb()` at the boundary.
 *
 * Hue is in degrees throughout (matching the boxed-expression convention).
 * `_gpu_color_mix` interpolates directly in OKLCh — no sRGB pinch — and
 * special-cases achromatic endpoints (C ≈ 0) so e.g. mixing red with white
 * preserves red's hue rather than drifting through arbitrary hues.
 *
 * WGSL targets must adapt syntax (vec3f, atan2→atan2, etc.).
 */
export const GPU_COLOR_PREAMBLE_GLSL = `
float _gpu_srgb_to_linear(float c) {
  if (c <= 0.04045) return c / 12.92;
  return pow((c + 0.055) / 1.055, 2.4);
}

float _gpu_linear_to_srgb(float c) {
  if (c <= 0.0031308) return 12.92 * c;
  return 1.055 * pow(c, 1.0 / 2.4) - 0.055;
}

vec3 _gpu_srgb_to_oklab(vec3 rgb) {
  float r = _gpu_srgb_to_linear(rgb.x);
  float g = _gpu_srgb_to_linear(rgb.y);
  float b = _gpu_srgb_to_linear(rgb.z);
  float l_ = pow(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b, 1.0 / 3.0);
  float m_ = pow(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b, 1.0 / 3.0);
  float s_ = pow(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b, 1.0 / 3.0);
  return vec3(
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_
  );
}

vec3 _gpu_oklab_to_srgb(vec3 lab) {
  float l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  float m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  float s_ = lab.x - 0.0894841775 * lab.y - 1.291485548 * lab.z;
  float l = l_ * l_ * l_;
  float m = m_ * m_ * m_;
  float s = s_ * s_ * s_;
  float r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  float g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  float b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return clamp(vec3(_gpu_linear_to_srgb(r), _gpu_linear_to_srgb(g), _gpu_linear_to_srgb(b)), 0.0, 1.0);
}

vec3 _gpu_oklab_to_oklch(vec3 lab) {
  float C = length(lab.yz);
  float H = atan(lab.z, lab.y) * (180.0 / 3.14159265359);
  if (H < 0.0) H += 360.0;
  return vec3(lab.x, C, H);
}

vec3 _gpu_oklch_to_oklab(vec3 lch) {
  float h_rad = lch.z * (3.14159265359 / 180.0);
  return vec3(lch.x, lch.y * cos(h_rad), lch.y * sin(h_rad));
}

vec3 _gpu_srgb_to_oklch(vec3 rgb) {
  return _gpu_oklab_to_oklch(_gpu_srgb_to_oklab(rgb));
}

vec3 _gpu_oklch_to_srgb(vec3 lch) {
  return _gpu_oklab_to_srgb(_gpu_oklch_to_oklab(lch));
}

// HSL conversion. Hue in degrees, saturation/lightness in 0-1.
vec3 _gpu_hsl_to_rgb(vec3 hsl) {
  float h = hsl.x;
  float s = hsl.y;
  float l = hsl.z;
  float c = (1.0 - abs(2.0 * l - 1.0)) * s;
  float h6 = h / 60.0;
  float x = c * (1.0 - abs(mod(h6, 2.0) - 1.0));
  float r = 0.0;
  float g = 0.0;
  float b = 0.0;
  if (h6 < 1.0)      { r = c; g = x; b = 0.0; }
  else if (h6 < 2.0) { r = x; g = c; b = 0.0; }
  else if (h6 < 3.0) { r = 0.0; g = c; b = x; }
  else if (h6 < 4.0) { r = 0.0; g = x; b = c; }
  else if (h6 < 5.0) { r = x; g = 0.0; b = c; }
  else               { r = c; g = 0.0; b = x; }
  float m = l - c / 2.0;
  return vec3(r + m, g + m, b + m);
}

vec3 _gpu_rgb_to_hsl(vec3 rgb) {
  float maxc = max(max(rgb.x, rgb.y), rgb.z);
  float minc = min(min(rgb.x, rgb.y), rgb.z);
  float l = (maxc + minc) / 2.0;
  float d = maxc - minc;
  if (d < 1e-6) return vec3(0.0, 0.0, l);
  float s = d / (1.0 - abs(2.0 * l - 1.0));
  float h;
  if (maxc == rgb.x)      h = mod((rgb.y - rgb.z) / d, 6.0);
  else if (maxc == rgb.y) h = (rgb.z - rgb.x) / d + 2.0;
  else                    h = (rgb.x - rgb.y) / d + 4.0;
  h *= 60.0;
  if (h < 0.0) h += 360.0;
  return vec3(h, s, l);
}

// HSV conversion. Hue in degrees, saturation/value in 0-1.
vec3 _gpu_hsv_to_rgb(vec3 hsv) {
  float h = hsv.x;
  float s = hsv.y;
  float v = hsv.z;
  float c = v * s;
  float h6 = h / 60.0;
  float x = c * (1.0 - abs(mod(h6, 2.0) - 1.0));
  float r = 0.0;
  float g = 0.0;
  float b = 0.0;
  if (h6 < 1.0)      { r = c; g = x; b = 0.0; }
  else if (h6 < 2.0) { r = x; g = c; b = 0.0; }
  else if (h6 < 3.0) { r = 0.0; g = c; b = x; }
  else if (h6 < 4.0) { r = 0.0; g = x; b = c; }
  else if (h6 < 5.0) { r = x; g = 0.0; b = c; }
  else               { r = c; g = 0.0; b = x; }
  float m = v - c;
  return vec3(r + m, g + m, b + m);
}

vec3 _gpu_rgb_to_hsv(vec3 rgb) {
  float maxc = max(max(rgb.x, rgb.y), rgb.z);
  float minc = min(min(rgb.x, rgb.y), rgb.z);
  float v = maxc;
  float d = maxc - minc;
  if (d < 1e-6) return vec3(0.0, 0.0, v);
  float s = (maxc < 1e-6) ? 0.0 : d / maxc;
  float h;
  if (maxc == rgb.x)      h = mod((rgb.y - rgb.z) / d, 6.0);
  else if (maxc == rgb.y) h = (rgb.z - rgb.x) / d + 2.0;
  else                    h = (rgb.x - rgb.y) / d + 4.0;
  h *= 60.0;
  if (h < 0.0) h += 360.0;
  return vec3(h, s, v);
}

vec3 _gpu_color_mix(vec3 lch1, vec3 lch2, float t) {
  float L = mix(lch1.x, lch2.x, t);
  float C = mix(lch1.y, lch2.y, t);
  bool a1 = lch1.y < 1e-6;
  bool a2 = lch2.y < 1e-6;
  float H;
  if (a1 && a2) {
    H = lch1.z;
  } else if (a1) {
    H = lch2.z;
  } else if (a2) {
    H = lch1.z;
  } else {
    float dh = lch2.z - lch1.z;
    if (dh > 180.0) dh -= 360.0;
    if (dh < -180.0) dh += 360.0;
    H = lch1.z + dh * t;
    if (H < 0.0) H += 360.0;
    if (H >= 360.0) H -= 360.0;
  }
  return vec3(L, C, H);
}

float _gpu_apca(vec3 lch_bg, vec3 lch_fg) {
  vec3 bg = _gpu_oklch_to_srgb(lch_bg);
  vec3 fg = _gpu_oklch_to_srgb(lch_fg);
  float bgR = _gpu_srgb_to_linear(bg.x);
  float bgG = _gpu_srgb_to_linear(bg.y);
  float bgB = _gpu_srgb_to_linear(bg.z);
  float fgR = _gpu_srgb_to_linear(fg.x);
  float fgG = _gpu_srgb_to_linear(fg.y);
  float fgB = _gpu_srgb_to_linear(fg.z);
  float bgY = 0.2126729 * bgR + 0.7151522 * bgG + 0.0721750 * bgB;
  float fgY = 0.2126729 * fgR + 0.7151522 * fgG + 0.0721750 * fgB;
  float bgC = pow(bgY, 0.56);
  float fgC = pow(fgY, 0.57);
  float contrast = (bgC - fgC) * 1.14;
  return contrast * 100.0;
}
`;

/**
 * GPU color space conversion preamble (WGSL syntax).
 *
 * Same convention as the GLSL preamble: canonical color value is `vec3f`
 * OKLCh `(L, C, H_deg)`. Shaders writing to a sRGB framebuffer must wrap
 * their final color in `_gpu_oklch_to_srgb()`.
 */
export const GPU_COLOR_PREAMBLE_WGSL = `
fn _gpu_srgb_to_linear(c: f32) -> f32 {
  if (c <= 0.04045) { return c / 12.92; }
  return pow((c + 0.055) / 1.055, 2.4);
}

fn _gpu_linear_to_srgb(c: f32) -> f32 {
  if (c <= 0.0031308) { return 12.92 * c; }
  return 1.055 * pow(c, 1.0 / 2.4) - 0.055;
}

fn _gpu_srgb_to_oklab(rgb: vec3f) -> vec3f {
  let r = _gpu_srgb_to_linear(rgb.x);
  let g = _gpu_srgb_to_linear(rgb.y);
  let b = _gpu_srgb_to_linear(rgb.z);
  let l_ = pow(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b, 1.0 / 3.0);
  let m_ = pow(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b, 1.0 / 3.0);
  let s_ = pow(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b, 1.0 / 3.0);
  return vec3f(
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_
  );
}

fn _gpu_oklab_to_srgb(lab: vec3f) -> vec3f {
  let l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  let m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  let s_ = lab.x - 0.0894841775 * lab.y - 1.291485548 * lab.z;
  let l = l_ * l_ * l_;
  let m = m_ * m_ * m_;
  let s = s_ * s_ * s_;
  let r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  let b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return clamp(vec3f(_gpu_linear_to_srgb(r), _gpu_linear_to_srgb(g), _gpu_linear_to_srgb(b)), vec3f(0.0), vec3f(1.0));
}

fn _gpu_oklab_to_oklch(lab: vec3f) -> vec3f {
  let C = length(lab.yz);
  var H = atan2(lab.z, lab.y) * (180.0 / 3.14159265359);
  if (H < 0.0) { H = H + 360.0; }
  return vec3f(lab.x, C, H);
}

fn _gpu_oklch_to_oklab(lch: vec3f) -> vec3f {
  let h_rad = lch.z * (3.14159265359 / 180.0);
  return vec3f(lch.x, lch.y * cos(h_rad), lch.y * sin(h_rad));
}

fn _gpu_srgb_to_oklch(rgb: vec3f) -> vec3f {
  return _gpu_oklab_to_oklch(_gpu_srgb_to_oklab(rgb));
}

fn _gpu_oklch_to_srgb(lch: vec3f) -> vec3f {
  return _gpu_oklab_to_srgb(_gpu_oklch_to_oklab(lch));
}

fn _gpu_hsl_to_rgb(hsl: vec3f) -> vec3f {
  let h = hsl.x;
  let s = hsl.y;
  let l = hsl.z;
  let c = (1.0 - abs(2.0 * l - 1.0)) * s;
  let h6 = h / 60.0;
  let x = c * (1.0 - abs((h6 - 2.0 * floor(h6 / 2.0)) - 1.0));
  var r: f32 = 0.0;
  var g: f32 = 0.0;
  var b: f32 = 0.0;
  if (h6 < 1.0)      { r = c; g = x; b = 0.0; }
  else if (h6 < 2.0) { r = x; g = c; b = 0.0; }
  else if (h6 < 3.0) { r = 0.0; g = c; b = x; }
  else if (h6 < 4.0) { r = 0.0; g = x; b = c; }
  else if (h6 < 5.0) { r = x; g = 0.0; b = c; }
  else               { r = c; g = 0.0; b = x; }
  let m = l - c / 2.0;
  return vec3f(r + m, g + m, b + m);
}

fn _gpu_rgb_to_hsl(rgb: vec3f) -> vec3f {
  let maxc = max(max(rgb.x, rgb.y), rgb.z);
  let minc = min(min(rgb.x, rgb.y), rgb.z);
  let l = (maxc + minc) / 2.0;
  let d = maxc - minc;
  if (d < 1e-6) { return vec3f(0.0, 0.0, l); }
  let s = d / (1.0 - abs(2.0 * l - 1.0));
  var h: f32;
  if (maxc == rgb.x) {
    let v = (rgb.y - rgb.z) / d;
    h = v - 6.0 * floor(v / 6.0);
  } else if (maxc == rgb.y) {
    h = (rgb.z - rgb.x) / d + 2.0;
  } else {
    h = (rgb.x - rgb.y) / d + 4.0;
  }
  h = h * 60.0;
  if (h < 0.0) { h = h + 360.0; }
  return vec3f(h, s, l);
}

fn _gpu_hsv_to_rgb(hsv: vec3f) -> vec3f {
  let h = hsv.x;
  let s = hsv.y;
  let v = hsv.z;
  let c = v * s;
  let h6 = h / 60.0;
  let x = c * (1.0 - abs((h6 - 2.0 * floor(h6 / 2.0)) - 1.0));
  var r: f32 = 0.0;
  var g: f32 = 0.0;
  var b: f32 = 0.0;
  if (h6 < 1.0)      { r = c; g = x; b = 0.0; }
  else if (h6 < 2.0) { r = x; g = c; b = 0.0; }
  else if (h6 < 3.0) { r = 0.0; g = c; b = x; }
  else if (h6 < 4.0) { r = 0.0; g = x; b = c; }
  else if (h6 < 5.0) { r = x; g = 0.0; b = c; }
  else               { r = c; g = 0.0; b = x; }
  let m = v - c;
  return vec3f(r + m, g + m, b + m);
}

fn _gpu_rgb_to_hsv(rgb: vec3f) -> vec3f {
  let maxc = max(max(rgb.x, rgb.y), rgb.z);
  let minc = min(min(rgb.x, rgb.y), rgb.z);
  let v = maxc;
  let d = maxc - minc;
  if (d < 1e-6) { return vec3f(0.0, 0.0, v); }
  var s: f32 = 0.0;
  if (maxc >= 1e-6) { s = d / maxc; }
  var h: f32;
  if (maxc == rgb.x) {
    let q = (rgb.y - rgb.z) / d;
    h = q - 6.0 * floor(q / 6.0);
  } else if (maxc == rgb.y) {
    h = (rgb.z - rgb.x) / d + 2.0;
  } else {
    h = (rgb.x - rgb.y) / d + 4.0;
  }
  h = h * 60.0;
  if (h < 0.0) { h = h + 360.0; }
  return vec3f(h, s, v);
}

fn _gpu_color_mix(lch1: vec3f, lch2: vec3f, t: f32) -> vec3f {
  let L = mix(lch1.x, lch2.x, t);
  let C = mix(lch1.y, lch2.y, t);
  let a1 = lch1.y < 1e-6;
  let a2 = lch2.y < 1e-6;
  var H: f32;
  if (a1 && a2) {
    H = lch1.z;
  } else if (a1) {
    H = lch2.z;
  } else if (a2) {
    H = lch1.z;
  } else {
    var dh = lch2.z - lch1.z;
    if (dh > 180.0) { dh = dh - 360.0; }
    if (dh < -180.0) { dh = dh + 360.0; }
    H = lch1.z + dh * t;
    if (H < 0.0) { H = H + 360.0; }
    if (H >= 360.0) { H = H - 360.0; }
  }
  return vec3f(L, C, H);
}

fn _gpu_apca(lch_bg: vec3f, lch_fg: vec3f) -> f32 {
  let bg = _gpu_oklch_to_srgb(lch_bg);
  let fg = _gpu_oklch_to_srgb(lch_fg);
  let bgR = _gpu_srgb_to_linear(bg.x);
  let bgG = _gpu_srgb_to_linear(bg.y);
  let bgB = _gpu_srgb_to_linear(bg.z);
  let fgR = _gpu_srgb_to_linear(fg.x);
  let fgG = _gpu_srgb_to_linear(fg.y);
  let fgB = _gpu_srgb_to_linear(fg.z);
  let bgY = 0.2126729 * bgR + 0.7151522 * bgG + 0.0721750 * bgB;
  let fgY = 0.2126729 * fgR + 0.7151522 * fgG + 0.0721750 * fgB;
  let bgC = pow(bgY, 0.56);
  let fgC = pow(fgY, 0.57);
  let contrast = (bgC - fgC) * 1.14;
  return contrast * 100.0;
}
`;

/**
 * Per-function complex arithmetic definitions with dependency metadata.
 *
 * Each entry maps a helper function name to its GLSL source, WGSL source,
 * and the list of other helper functions it calls. The preamble builder
 * uses this to emit only the functions actually referenced by compiled code,
 * in topological (dependency) order.
 *
 * Addition, subtraction, negation, and scalar multiplication use native
 * vec2 operators and do not need helper functions.
 */
interface ComplexFunctionDef {
  glsl: string;
  wgsl: string;
  deps: string[];
}

const GPU_COMPLEX_FUNCTIONS: Record<string, ComplexFunctionDef> = {
  _gpu_cmul: {
    deps: [],
    glsl: `vec2 _gpu_cmul(vec2 a, vec2 b) {
  return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}`,
    wgsl: `fn _gpu_cmul(a: vec2f, b: vec2f) -> vec2f {
  return vec2f(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}`,
  },
  _gpu_cdiv: {
    deps: [],
    glsl: `vec2 _gpu_cdiv(vec2 a, vec2 b) {
  float d = b.x * b.x + b.y * b.y;
  return vec2((a.x * b.x + a.y * b.y) / d, (a.y * b.x - a.x * b.y) / d);
}`,
    wgsl: `fn _gpu_cdiv(a: vec2f, b: vec2f) -> vec2f {
  let d = b.x * b.x + b.y * b.y;
  return vec2f((a.x * b.x + a.y * b.y) / d, (a.y * b.x - a.x * b.y) / d);
}`,
  },
  _gpu_cexp: {
    deps: [],
    glsl: `vec2 _gpu_cexp(vec2 z) {
  float e = exp(z.x);
  return vec2(e * cos(z.y), e * sin(z.y));
}`,
    wgsl: `fn _gpu_cexp(z: vec2f) -> vec2f {
  let e = exp(z.x);
  return vec2f(e * cos(z.y), e * sin(z.y));
}`,
  },
  _gpu_cln: {
    deps: [],
    glsl: `vec2 _gpu_cln(vec2 z) {
  return vec2(log(length(z)), atan(z.y, z.x));
}`,
    wgsl: `fn _gpu_cln(z: vec2f) -> vec2f {
  return vec2f(log(length(z)), atan2(z.y, z.x));
}`,
  },
  _gpu_cpow: {
    deps: ['_gpu_cexp', '_gpu_cmul', '_gpu_cln'],
    glsl: `vec2 _gpu_cpow(vec2 z, vec2 w) {
  return _gpu_cexp(_gpu_cmul(w, _gpu_cln(z)));
}`,
    wgsl: `fn _gpu_cpow(z: vec2f, w: vec2f) -> vec2f {
  return _gpu_cexp(_gpu_cmul(w, _gpu_cln(z)));
}`,
  },
  _gpu_csqrt: {
    deps: [],
    glsl: `vec2 _gpu_csqrt(vec2 z) {
  float r = length(z);
  float theta = atan(z.y, z.x);
  return sqrt(r) * vec2(cos(theta * 0.5), sin(theta * 0.5));
}`,
    wgsl: `fn _gpu_csqrt(z: vec2f) -> vec2f {
  let r = length(z);
  let theta = atan2(z.y, z.x);
  return sqrt(r) * vec2f(cos(theta * 0.5), sin(theta * 0.5));
}`,
  },
  _gpu_csin: {
    deps: [],
    glsl: `vec2 _gpu_csin(vec2 z) {
  return vec2(sin(z.x) * cosh(z.y), cos(z.x) * sinh(z.y));
}`,
    wgsl: `fn _gpu_csin(z: vec2f) -> vec2f {
  return vec2f(sin(z.x) * cosh(z.y), cos(z.x) * sinh(z.y));
}`,
  },
  _gpu_ccos: {
    deps: [],
    glsl: `vec2 _gpu_ccos(vec2 z) {
  return vec2(cos(z.x) * cosh(z.y), -sin(z.x) * sinh(z.y));
}`,
    wgsl: `fn _gpu_ccos(z: vec2f) -> vec2f {
  return vec2f(cos(z.x) * cosh(z.y), -sin(z.x) * sinh(z.y));
}`,
  },
  _gpu_ctan: {
    deps: ['_gpu_cdiv', '_gpu_csin', '_gpu_ccos'],
    glsl: `vec2 _gpu_ctan(vec2 z) {
  return _gpu_cdiv(_gpu_csin(z), _gpu_ccos(z));
}`,
    wgsl: `fn _gpu_ctan(z: vec2f) -> vec2f {
  return _gpu_cdiv(_gpu_csin(z), _gpu_ccos(z));
}`,
  },
  _gpu_csinh: {
    deps: [],
    glsl: `vec2 _gpu_csinh(vec2 z) {
  return vec2(sinh(z.x) * cos(z.y), cosh(z.x) * sin(z.y));
}`,
    wgsl: `fn _gpu_csinh(z: vec2f) -> vec2f {
  return vec2f(sinh(z.x) * cos(z.y), cosh(z.x) * sin(z.y));
}`,
  },
  _gpu_ccosh: {
    deps: [],
    glsl: `vec2 _gpu_ccosh(vec2 z) {
  return vec2(cosh(z.x) * cos(z.y), sinh(z.x) * sin(z.y));
}`,
    wgsl: `fn _gpu_ccosh(z: vec2f) -> vec2f {
  return vec2f(cosh(z.x) * cos(z.y), sinh(z.x) * sin(z.y));
}`,
  },
  _gpu_ctanh: {
    deps: ['_gpu_cdiv', '_gpu_csinh', '_gpu_ccosh'],
    glsl: `vec2 _gpu_ctanh(vec2 z) {
  return _gpu_cdiv(_gpu_csinh(z), _gpu_ccosh(z));
}`,
    wgsl: `fn _gpu_ctanh(z: vec2f) -> vec2f {
  return _gpu_cdiv(_gpu_csinh(z), _gpu_ccosh(z));
}`,
  },
  _gpu_casin: {
    deps: ['_gpu_csqrt', '_gpu_cln'],
    glsl: `vec2 _gpu_casin(vec2 z) {
  vec2 iz = vec2(-z.y, z.x);
  vec2 s = _gpu_csqrt(vec2(1.0 - z.x * z.x + z.y * z.y, -2.0 * z.x * z.y));
  vec2 l = _gpu_cln(iz + s);
  return vec2(l.y, -l.x);
}`,
    wgsl: `fn _gpu_casin(z: vec2f) -> vec2f {
  let iz = vec2f(-z.y, z.x);
  let s = _gpu_csqrt(vec2f(1.0 - z.x * z.x + z.y * z.y, -2.0 * z.x * z.y));
  let l = _gpu_cln(iz + s);
  return vec2f(l.y, -l.x);
}`,
  },
  _gpu_cacos: {
    deps: ['_gpu_casin'],
    glsl: `vec2 _gpu_cacos(vec2 z) {
  vec2 s = _gpu_casin(z);
  return vec2(1.5707963268 - s.x, -s.y);
}`,
    wgsl: `fn _gpu_cacos(z: vec2f) -> vec2f {
  let s = _gpu_casin(z);
  return vec2f(1.5707963268 - s.x, -s.y);
}`,
  },
  _gpu_catan: {
    deps: ['_gpu_cln'],
    glsl: `vec2 _gpu_catan(vec2 z) {
  vec2 iz = vec2(-z.y, z.x);
  vec2 a = _gpu_cln(vec2(1.0 - iz.x, -iz.y));
  vec2 b = _gpu_cln(vec2(1.0 + iz.x, iz.y));
  vec2 d = vec2(a.x - b.x, a.y - b.y);
  return vec2(-0.5 * d.y, 0.5 * d.x);
}`,
    wgsl: `fn _gpu_catan(z: vec2f) -> vec2f {
  let iz = vec2f(-z.y, z.x);
  let a = _gpu_cln(vec2f(1.0 - iz.x, -iz.y));
  let b = _gpu_cln(vec2f(1.0 + iz.x, iz.y));
  let d = vec2f(a.x - b.x, a.y - b.y);
  return vec2f(-0.5 * d.y, 0.5 * d.x);
}`,
  },
  _gpu_casinh: {
    deps: ['_gpu_csqrt', '_gpu_cln'],
    glsl: `vec2 _gpu_casinh(vec2 z) {
  vec2 z2 = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y);
  vec2 s = _gpu_csqrt(vec2(1.0 + z2.x, z2.y));
  return _gpu_cln(z + s);
}`,
    wgsl: `fn _gpu_casinh(z: vec2f) -> vec2f {
  let z2 = vec2f(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y);
  let s = _gpu_csqrt(vec2f(1.0 + z2.x, z2.y));
  return _gpu_cln(z + s);
}`,
  },
  _gpu_cacosh: {
    deps: ['_gpu_csqrt', '_gpu_cln'],
    glsl: `vec2 _gpu_cacosh(vec2 z) {
  vec2 z2 = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y);
  vec2 s = _gpu_csqrt(vec2(z2.x - 1.0, z2.y));
  return _gpu_cln(z + s);
}`,
    wgsl: `fn _gpu_cacosh(z: vec2f) -> vec2f {
  let z2 = vec2f(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y);
  let s = _gpu_csqrt(vec2f(z2.x - 1.0, z2.y));
  return _gpu_cln(z + s);
}`,
  },
  _gpu_catanh: {
    deps: ['_gpu_cln'],
    glsl: `vec2 _gpu_catanh(vec2 z) {
  vec2 a = _gpu_cln(vec2(1.0 + z.x, z.y));
  vec2 b = _gpu_cln(vec2(1.0 - z.x, -z.y));
  return vec2(0.5 * (a.x - b.x), 0.5 * (a.y - b.y));
}`,
    wgsl: `fn _gpu_catanh(z: vec2f) -> vec2f {
  let a = _gpu_cln(vec2f(1.0 + z.x, z.y));
  let b = _gpu_cln(vec2f(1.0 - z.x, -z.y));
  return vec2f(0.5 * (a.x - b.x), 0.5 * (a.y - b.y));
}`,
  },
};

/**
 * Build a minimal complex preamble containing only the helper functions
 * actually referenced by `code`, plus their transitive dependencies,
 * emitted in topological (dependency-first) order.
 */
function buildComplexPreamble(code: string, language: string): string {
  // 1. Find all _gpu_c* calls in the compiled code
  const needed = new Set<string>();
  for (const name of Object.keys(GPU_COMPLEX_FUNCTIONS)) {
    if (code.includes(name)) needed.add(name);
  }
  if (needed.size === 0) return '';

  // 2. Resolve transitive dependencies
  const resolved = new Set<string>();
  function resolve(name: string): void {
    if (resolved.has(name)) return;
    const def = GPU_COMPLEX_FUNCTIONS[name];
    if (!def) return;
    for (const dep of def.deps) resolve(dep);
    resolved.add(name);
  }
  for (const name of needed) resolve(name);

  // 3. `resolved` is already in topological order (deps before dependents)
  const lang = language === 'wgsl' ? 'wgsl' : 'glsl';
  const parts: string[] = [];
  for (const name of resolved) {
    parts.push(GPU_COMPLEX_FUNCTIONS[name][lang]);
  }
  return '\n' + parts.join('\n\n') + '\n';
}

/** Constants shared by both GLSL and WGSL */
const GPU_CONSTANTS: Record<string, string> = {
  Pi: '3.14159265359',
  ExponentialE: '2.71828182846',
  GoldenRatio: '1.61803398875',
  CatalanConstant: '0.91596559417',
  EulerGamma: '0.57721566490',
};

/**
 * Format a number as a GPU float literal.
 *
 * Both GLSL and WGSL require float literals to have a decimal point.
 */
function formatGPUNumber(n: number): string {
  // GLSL and WGSL have no infinity or NaN literals (WGSL forbids them in
  // const-expressions outright). Emitting `Infinity.0` / `NaN.0` produces a
  // shader that silently fails to compile on the GPU, so reject it here — the
  // error propagates to `compile()`, which surfaces a diagnostic / falls back
  // to interpretation instead of returning broken code with `success: true`.
  if (!Number.isFinite(n))
    throw new Error(
      `Cannot compile the non-finite value \`${n}\` to a GPU shader: GLSL/WGSL have no infinity or NaN literals.`
    );
  const str = n.toString();
  if (!str.includes('.') && !str.includes('e') && !str.includes('E')) {
    return `${str}.0`;
  }
  return str;
}

/**
 * Abstract base class for GPU shader compilation targets.
 *
 * Provides shared operators, math functions, constants, and number formatting
 * for both GLSL and WGSL. Subclasses implement language-specific details:
 * function naming differences, vector constructors, function declaration
 * syntax, and shader structure.
 */
export abstract class GPUShaderTarget implements LanguageTarget<Expression> {
  /** Language identifier (e.g., 'glsl', 'wgsl') */
  protected abstract readonly languageId: string;

  /**
   * Return language-specific function overrides.
   *
   * These are merged on top of the shared GPU_FUNCTIONS, allowing
   * subclasses to override specific entries (e.g., `Inversesqrt`, `Mod`, `List`).
   */
  protected abstract getLanguageSpecificFunctions(): CompiledFunctions<Expression>;

  /**
   * Create a complete function declaration in the target language.
   */
  abstract compileFunction(
    expr: Expression,
    functionName: string,
    returnType: string,
    parameters: Array<[name: string, type: string]>
  ): string;

  /**
   * Create a complete shader program in the target language.
   */
  abstract compileShader(options: Record<string, unknown>): string;

  getOperators(): CompiledOperators {
    return GPU_OPERATORS;
  }

  getFunctions(): CompiledFunctions<Expression> {
    return { ...GPU_FUNCTIONS, ...this.getLanguageSpecificFunctions() };
  }

  getConstants(): Record<string, string> {
    return GPU_CONSTANTS;
  }

  createTarget(
    options: Partial<CompileTarget<Expression>> = {}
  ): CompileTarget<Expression> {
    const functions = this.getFunctions();
    const constants = this.getConstants();
    const v2 = this.languageId === 'wgsl' ? 'vec2f' : 'vec2';
    return {
      language: this.languageId,
      operators: (op) => GPU_OPERATORS[op],
      functions: (id) => functions[id],
      var: (id) => {
        if (id === 'ImaginaryUnit') return `${v2}(0.0, 1.0)`;
        if (id in constants) return constants[id];
        // Returning `undefined` (rather than a bare `id`) lets BaseCompiler
        // fold an assigned value / declared constant — including on the
        // direct-target `compile(expr, { target })` path, which uses this raw
        // target — and fall back to a bare (declarable) identifier only for a
        // genuinely free symbol.
        return undefined;
      },
      string: (str) => JSON.stringify(str),
      number: formatGPUNumber,
      complex: (re, im) =>
        `${v2}(${formatGPUNumber(re)}, ${formatGPUNumber(im)})`,
      indent: 0,
      ws: (s?: string) => s ?? '',
      preamble: '',
      declare: (name, typeHint) => {
        const type = typeHint ?? (this.languageId === 'wgsl' ? 'f32' : 'float');
        return this.languageId === 'wgsl'
          ? `var ${name}: ${type}`
          : `${type} ${name}`;
      },
      block: (stmts) => {
        if (stmts.length === 0) return '';
        const last = stmts.length - 1;
        stmts[last] = `return ${stmts[last]}`;
        return stmts.join(';\n') + ';';
      },
      ...options,
    };
  }

  compile(
    expr: Expression,
    options: CompilationOptions<Expression> = {}
  ): CompilationResult {
    const { functions: userFunctions, vars } = options;
    const allFunctions = this.getFunctions();
    const constants = this.getConstants();

    const v2 = this.languageId === 'wgsl' ? 'vec2f' : 'vec2';
    const target = this.createTarget({
      functions: (id) => {
        if (userFunctions && id in userFunctions) {
          const fn = userFunctions[id];
          if (typeof fn === 'string') return fn;
          if (typeof fn === 'function') return fn.name || id;
        }
        return allFunctions[id];
      },
      var: (id) => {
        if (vars && id in vars) return vars[id] as string;
        if (id === 'ImaginaryUnit') return `${v2}(0.0, 1.0)`;
        if (id in constants) return constants[id];
        // Returning `undefined` lets BaseCompiler fold an assigned value /
        // declared constant the way evaluate() does — otherwise a symbol
        // omitted from `expr.unknowns` (because the engine considers it known)
        // would be emitted as a bare, undeclared identifier, i.e. a shader
        // that fails to compile on the GPU. A genuinely free symbol has no
        // value and falls back to the bare (vars-mappable, unknowns-listed)
        // identifier.
        return undefined;
      },
    });

    const code = BaseCompiler.compile(expr, target);
    const result: CompilationResult = {
      target: this.languageId,
      success: true,
      code,
    };
    let preamble = '';
    preamble += buildComplexPreamble(code, this.languageId);
    if (code.includes('_gpu_gamma'))
      preamble +=
        this.languageId === 'wgsl'
          ? GPU_GAMMA_PREAMBLE_WGSL
          : GPU_GAMMA_PREAMBLE_GLSL;
    if (code.includes('_gpu_erf'))
      preamble +=
        this.languageId === 'wgsl'
          ? GPU_ERF_PREAMBLE_WGSL
          : GPU_ERF_PREAMBLE_GLSL;
    if (code.includes('_gpu_heaviside'))
      preamble +=
        this.languageId === 'wgsl'
          ? GPU_HEAVISIDE_PREAMBLE_WGSL
          : GPU_HEAVISIDE_PREAMBLE_GLSL;
    if (code.includes('_gpu_sinc'))
      preamble +=
        this.languageId === 'wgsl'
          ? GPU_SINC_PREAMBLE_WGSL
          : GPU_SINC_PREAMBLE_GLSL;
    if (code.includes('_gpu_fresnel'))
      preamble +=
        this.languageId === 'wgsl'
          ? GPU_POLEVL_PREAMBLE_WGSL
          : GPU_POLEVL_PREAMBLE_GLSL;
    if (code.includes('_gpu_fresnelC'))
      preamble +=
        this.languageId === 'wgsl'
          ? GPU_FRESNELC_PREAMBLE_WGSL
          : GPU_FRESNELC_PREAMBLE_GLSL;
    if (code.includes('_gpu_fresnelS'))
      preamble +=
        this.languageId === 'wgsl'
          ? GPU_FRESNELS_PREAMBLE_WGSL
          : GPU_FRESNELS_PREAMBLE_GLSL;
    if (code.includes('_gpu_besselJ'))
      preamble +=
        this.languageId === 'wgsl'
          ? GPU_BESSELJ_PREAMBLE_WGSL
          : GPU_BESSELJ_PREAMBLE_GLSL;
    if (code.includes('_fractal_')) {
      preamble +=
        this.languageId === 'wgsl'
          ? GPU_FRACTAL_PREAMBLE_WGSL
          : GPU_FRACTAL_PREAMBLE_GLSL;
    }
    if (code.includes('_gpu_random'))
      preamble +=
        this.languageId === 'wgsl'
          ? GPU_RANDOM_PREAMBLE_WGSL
          : GPU_RANDOM_PREAMBLE_GLSL;
    if (code.includes('_gpu_gcd'))
      preamble +=
        this.languageId === 'wgsl'
          ? GPU_GCD_PREAMBLE_WGSL
          : GPU_GCD_PREAMBLE_GLSL;
    if (code.includes('_gpu_median_'))
      preamble +=
        this.languageId === 'wgsl'
          ? GPU_MEDIAN_PREAMBLE_WGSL
          : GPU_MEDIAN_PREAMBLE_GLSL;
    if (
      code.includes('_gpu_srgb_to') ||
      code.includes('_gpu_oklab') ||
      code.includes('_gpu_oklch') ||
      code.includes('_gpu_color_mix') ||
      code.includes('_gpu_apca')
    ) {
      preamble +=
        this.languageId === 'wgsl'
          ? GPU_COLOR_PREAMBLE_WGSL
          : GPU_COLOR_PREAMBLE_GLSL;
    }
    if (preamble) result.preamble = preamble;

    return result;
  }

  compileToSource(
    expr: Expression,
    _options: CompilationOptions<Expression> = {}
  ): string {
    const target = this.createTarget();
    return BaseCompiler.compile(expr, target);
  }
}

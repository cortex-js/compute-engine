/**
 * JavaScript interval arithmetic compilation target
 *
 * Compiles mathematical expressions to JavaScript code using interval arithmetic
 * for reliable function evaluation with singularity detection.
 *
 * @module compilation/interval-javascript-target
 */

import type { Expression } from '../global-types.js';
import {
  isSymbol,
  isNumber,
  isFunction,
} from '../boxed-expression/type-guards.js';

import { BaseCompiler, pointHasBroadcastComponent } from './base-compiler.js';
import { rewriteAngularUnit } from './angular-unit.js';
import type {
  CompileTarget,
  CompiledOperators,
  CompiledFunctions,
  LanguageTarget,
  CompilationOptions,
  CompilationResult,
  CompiledRunner,
  OperandCompiler,
} from './types.js';
import { IntervalArithmetic } from '../interval/index.js';
import type { Interval, IntervalResult } from '../interval/types.js';

/**
 * Interval arithmetic operators mapped to _IA library calls.
 *
 * Unlike regular operators, these produce function calls instead of infix notation.
 */
const INTERVAL_JAVASCRIPT_OPERATORS: CompiledOperators = {
  // We use high precedence since these become function calls
  Add: ['_IA.add', 20],
  Negate: ['_IA.negate', 20],
  Subtract: ['_IA.sub', 20], // Subtract canonicalizes to Add+Negate; kept as fallback
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
 * Emit the Euclidean (L2) norm of a fixed-arity point from its compiled
 * components: `hypot` for the 2-D case (tighter enclosure than the
 * sqrt-of-squares composition), √(Σ xᵢ²) otherwise.
 */
function compileIntervalPointNorm(
  components: ReadonlyArray<Expression>,
  compile: (expr: Expression) => string
): string {
  const comps = components.map((c) => compile(c));
  if (comps.length === 0) return '_IA.point(0)';
  if (comps.length === 1) return `_IA.abs(${comps[0]})`;
  if (comps.length === 2) return `_IA.hypot(${comps[0]}, ${comps[1]})`;
  let sum = `_IA.add(_IA.square(${comps[0]}), _IA.square(${comps[1]}))`;
  for (let i = 2; i < comps.length; i++)
    sum = `_IA.add(${sum}, _IA.square(${comps[i]}))`;
  return `_IA.sqrt(${sum})`;
}

/**
 * Compile an N-ary chained relation (`Less`, `Greater`, `Equal`, …) to the
 * conjunction of ALL pairwise comparisons, combined with the tri-state
 * `_IA.and`. The runtime `_IA.and` is strictly binary, so the conjunction is
 * nested. A 2-operand chain is a single comparison.
 */
function compileIntervalChain(
  op: string,
  args: ReadonlyArray<Expression>,
  compile: OperandCompiler<Expression>,
  target?: CompileTarget<Expression>
): string {
  if (args.length < 2)
    throw new Error(`${op}: expected at least two arguments`);
  // A MIDDLE operand appears in two comparisons (`a < m < b` → `and(a<m,
  // m<b)`). Emitting it twice evaluates it twice, diverging from the
  // interpreter — which evaluates each operand once — and doubling the work of
  // a non-trivial operand. Bind each non-trivial middle operand to a temporary
  // (the same treatment the scalar infix path in `BaseCompiler` gives them; a
  // symbol or number literal is safe to duplicate and stays inline).
  const bindings: Array<[name: string, value: string]> = [];
  const codes = args.map((arg, i) => {
    // Operands from index 2 on are the chained-relation lazy positions of the
    // shared inventory (`LAZY_OPERANDS`): pass the index so the CSE pass pushes
    // the region harvest opened for them. (This lowering is eager today —
    // `_IA.and` is a strict call — but the region must be pushed regardless, or
    // a later short-circuiting lowering would hoist a temp out of a position
    // that may not run.) A non-region index simply compiles as before.
    const code = compile(arg, i);
    const isMiddle = i >= 1 && i <= args.length - 2;
    if (
      target?.bindExpr !== undefined &&
      isMiddle &&
      !isSymbol(arg) &&
      !isNumber(arg)
    ) {
      const name = BaseCompiler.tempVar(target);
      bindings.push([name, code]);
      return name;
    }
    return code;
  });
  let result = `${op}(${codes[0]}, ${codes[1]})`;
  for (let i = 1; i < codes.length - 1; i++)
    result = `_IA.and(${result}, ${op}(${codes[i]}, ${codes[i + 1]}))`;
  if (bindings.length > 0 && target?.bindExpr !== undefined)
    return target.bindExpr(bindings, result);
  return result;
}

/**
 * Fold an N-ary `And`/`Or` over ALL operands. The runtime `_IA.and`/`_IA.or`
 * are strictly binary, so this is a left-nested fold.
 */
function compileIntervalFold(
  op: string,
  args: ReadonlyArray<Expression>,
  compile: OperandCompiler<Expression>
): string {
  if (args.length === 0)
    throw new Error(`${op}: expected at least one argument`);
  let result = compile(args[0], 0);
  // `And`/`Or` operands after the first are the inventory's short-circuit lazy
  // positions: pass the index so the harvested region is pushed. (`_IA.and` is
  // a strict call, so this lowering evaluates them eagerly today; the region
  // must still be pushed — see `compileIntervalChain`.)
  for (let i = 1; i < args.length; i++)
    result = `${op}(${result}, ${compile(args[i], i)})`;
  return result;
}

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
  // No Subtract handler — canonicalizes to Add+Negate before compilation.
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
  // Note: `Abs` of a fixed-arity point never reaches this handler — the
  // shared compiler rewrites `Abs(Tuple)` → `Norm` (base-compiler.ts) so
  // the point compiles through the `Norm` codegen below (Tycho item 74).
  Abs: (args, compile) => `_IA.abs(${compile(args[0])})`,
  // Euclidean (L2) norm of a fixed-arity point. Only the default L2 norm of
  // a structural `Tuple` is representable here; any other operand, an
  // explicit norm-type argument, or a broadcasting component throws to fail
  // closed to scalar JS.
  Norm: (args, compile) => {
    if (args.length > 1)
      throw new Error(
        'Norm: only the default L2 norm compiles on the interval target'
      );
    const arg = args[0];
    if (!isFunction(arg, 'Tuple'))
      throw new Error(
        'Norm: the interval target requires a fixed-arity point operand'
      );
    // A broadcasting component means one norm per zipped element — not
    // representable as a scalar interval. Fail closed (D6).
    if (pointHasBroadcastComponent(arg))
      throw new Error(
        'Norm: cannot compile a point with a broadcasting component. ' +
          'Fail closed (D6).'
      );
    return compileIntervalPointNorm(arg.ops, compile);
  },
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
  // Element-wise max/min and clamp. On the interval target every operand is a
  // scalar/interval (no collections), so `ElementMax`/`ElementMin` reduce to the
  // interval max/min fold, and `Clamp(x, lo, hi)` to `min(max(x, lo), hi)`.
  // Interval max/min/clamp are monotonic, so they map endpoint-wise — enabling
  // break detection for the common `Clamp(x, 0, 1)` line-series idiom.
  ElementMax: (args, compile) => {
    let result = compile(args[0]);
    for (let i = 1; i < args.length; i++)
      result = `_IA.max(${result}, ${compile(args[i])})`;
    return result;
  },
  ElementMin: (args, compile) => {
    let result = compile(args[0]);
    for (let i = 1; i < args.length; i++)
      result = `_IA.min(${result}, ${compile(args[i])})`;
    return result;
  },
  Clamp: (args, compile) =>
    `_IA.min(_IA.max(${compile(args[0])}, ${compile(args[1])}), ${compile(
      args[2]
    )})`,
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
      // Rational exponent p/q (in lowest terms) with an ODD denominator is real
      // for a negative base too (e.g. (-8)^(2/3) = 4). Route through
      // `powRational`, which applies the interpreter's real-root convention;
      // plain `_IA.pow` would return `empty` for the negative part.
      const p = exp.numerator?.re;
      const q = exp.denominator?.re;
      if (
        !Number.isInteger(expVal) &&
        Number.isInteger(p) &&
        Number.isInteger(q) &&
        q > 1 &&
        q % 2 !== 0
      ) {
        return `_IA.powRational(${compile(base)}, ${p}, ${q})`;
      }
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
    if (isNumber(exp) && exp.im === 0) {
      // Integer degree: `nthRoot` gives the real root for an odd degree over a
      // negative base (the interpreter's convention, e.g. Root(-8, 3) = -2);
      // an even degree reduces to x^(1/n) (no real value for a negative base).
      if (Number.isInteger(exp.re))
        return `_IA.nthRoot(${compile(arg)}, ${exp.re})`;
      // Non-integer degree: nth root = x^(1/n).
      return `_IA.pow(${compile(arg)}, ${1 / exp.re})`;
    }
    return `_IA.powInterval(${compile(arg)}, _IA.div(_IA.point(1), ${compile(
      exp
    )}))`;
  },
  Round: (args, compile) => {
    if (args.length < 2) return `_IA.round(${compile(args[0])})`;
    // Round(x, n) = Round(x·10ⁿ)/10ⁿ — round to `n` decimal places. Only the
    // constant-`n` form is representable here (the factor must be a point);
    // a non-constant precision throws to fail closed to scalar JS.
    const n = args[1];
    if (!isNumber(n) || n.im !== 0 || !Number.isInteger(n.re))
      throw new Error('Round: interval target requires a constant precision');
    const factor = `_IA.point(${Math.pow(10, n.re)})`;
    return `_IA.div(_IA.round(_IA.mul(${compile(args[0])}, ${factor})), ${factor})`;
  },
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
  // Tolerance baked at compile time from the engine, matching the
  // interpreter's `Chop` and the JS target (see `javascript-target.ts`).
  Chop: (args, compile) =>
    `_IA.chop(${compile(args[0])}, ${args[0]?.engine?.tolerance ?? 1e-10})`,
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
    // For interval arithmetic, we need to handle indeterminate conditions.
    // Both arms are thunks — conditionally evaluated — so their operand
    // indices are passed to the compile callback (`OperandCompiler`), which
    // opens the matching CSE region.
    return `_IA.piecewise(
      ${compile(args[0])},
      () => ${compile(args[1], 1)},
      () => ${compile(args[2], 2)}
    )`;
  },
  // Domain restriction: When(body, cond) → body where cond holds, empty
  // where it doesn't. Must NOT fall through to the generic JS ternary: the
  // interval comparisons return the tri-state string 'true'|'false'|'maybe',
  // which is always truthy, so a ternary guard would never mask.
  When: (args, compile) => {
    if (args.length !== 2)
      throw new Error('When: expected 2 arguments (value, condition)');
    // `When` is not a selection form: its condition must be a scalar boolean.
    BaseCompiler.assertScalarCondition(args[1]);
    // The VALUE is the conditional position (operand 0); the condition is
    // eager — matching the `When` entry of the lazy-operand inventory.
    return `_IA.restrict(${compile(args[1])}, () => ${compile(args[0], 0)})`;
  },
  Which: (args, compile) => {
    if (args.length < 2 || args.length % 2 !== 0)
      throw new Error(
        'Which: expected even number of arguments (condition/value pairs)'
      );
    // Build nested piecewise calls for each condition/value pair. Every value
    // arm, and every condition after the first, is conditionally evaluated —
    // pass its operand index so the CSE pass opens the matching region.
    const buildPiecewise = (i: number): string => {
      if (i >= args.length) return `{ kind: 'empty' }`;
      const cond = args[i];
      const val = args[i + 1];
      // If condition is the symbol True, it's the default branch
      if (isSymbol(cond, 'True')) {
        return compile(val, i + 1);
      }
      return `_IA.piecewise(
      ${i === 0 ? compile(cond) : compile(cond, i)},
      () => ${compile(val, i + 1)},
      () => ${buildPiecewise(i + 2)}
    )`;
    };
    return buildPiecewise(0);
  },
  // Epsil `Match`: structural pattern matching. An interval subject spanning
  // two cases' constants has the same discontinuity hazard as compiled `Which`,
  // but a faithful interval treatment (per-branch `singular` semantics for
  // structural equality dispatch) is an explicit v1 out (design §5). Fail closed
  // (D6) rather than invent it.
  Match: () => {
    throw new Error(
      'Match: pattern matching is not supported by the interval-js compile target in v1. Fail closed (D6).'
    );
  },
  // Comparisons. Chained (N-ary) relations conjoin ALL pairwise comparisons
  // with the tri-state `_IA.and` (e.g. `1 < x < 4` → less(1,x) ∧ less(x,4)).
  Equal: (args, compile, target) =>
    compileIntervalChain('_IA.equal', args, compile, target),
  NotEqual: (args, compile, target) =>
    compileIntervalChain('_IA.notEqual', args, compile, target),
  LessEqual: (args, compile, target) =>
    compileIntervalChain('_IA.lessEqual', args, compile, target),
  GreaterEqual: (args, compile, target) =>
    compileIntervalChain('_IA.greaterEqual', args, compile, target),
  Less: (args, compile, target) =>
    compileIntervalChain('_IA.less', args, compile, target),
  Greater: (args, compile, target) =>
    compileIntervalChain('_IA.greater', args, compile, target),
  And: (args, compile) => compileIntervalFold('_IA.and', args, compile),
  Or: (args, compile) => compileIntervalFold('_IA.or', args, compile),
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
 * Fail closed (D6) on a Sum/Product bound that is statically non-finite (a
 * `±∞`/`NaN` literal, or an expression typed `non_finite_number`), so
 * `compile()` reports failure and the caller falls back to the interpreter.
 * `for (i = 1; i <= Infinity; i++)` never terminates and `-Infinity + 1` never
 * advances, so such a bound would lock the caller's thread. Mirrors
 * `assertFiniteBound` in the JavaScript target.
 */
function assertFiniteIntervalBound(
  kind: 'Sum' | 'Product',
  expr: Expression,
  which: 'lower' | 'upper'
): void {
  const nonFinite =
    (isNumber(expr) && !Number.isFinite(expr.re)) ||
    expr.type.matches('non_finite_number');
  if (!nonFinite) return;
  throw new Error(
    `${kind}: the ${which} bound \`${expr.toString()}\` is not a finite ` +
      `number — an infinite or NaN bound has no terminating loop. ` +
      `Fail closed (D6).`
  );
}

/**
 * Compile a bound expression to a scalar JavaScript value for use as a loop
 * counter. For the interval target, bounds must be plain numbers (not intervals).
 *
 * At runtime, a compiled bound expression produces one of two shapes:
 * a bare `Interval` ({lo, hi}) — e.g. a plain input variable `_.n` — or an
 * `IntervalResult` wrapper ({kind, value: {lo, hi}}) returned by `_IA.*`
 * operators (e.g. a compound bound like `n + 2`). We extract the upper bound
 * from whichever shape is present (for point intervals lo === hi).
 */
function compileIntervalBound(
  expr: Expression,
  numVal: number | undefined,
  target: CompileTarget<Expression>
): string {
  if (numVal !== undefined) return String(numVal);
  // Compile the bound expression (produces an interval or an IntervalResult
  // wrapper at runtime), then extract the scalar upper bound for the loop
  // counter. Reading `.hi` directly off an IntervalResult is `undefined`
  // (→ NaN → the loop never runs), so unwrap `.value` when present.
  const compiled = BaseCompiler.compile(expr, target);
  return `Math.floor(((_b) => (_b && _b.value ? _b.value.hi : _b.hi))(${compiled}))`;
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

  // Reject a collection-valued body for the indexed form (see
  // `BaseCompiler.assertScalarBigOpBody`): interval scalar accumulation over
  // arrays would silently produce a wrong value. Reached only for the indexed
  // form (the `!args[1]` guard above rules out the reduce form).
  BaseCompiler.assertScalarBigOpBody(kind, args[0]);

  // Multi-index Sum/Product would drop the trailing indexing sets. Fail closed
  // (D6) rather than emit code with a dangling index.
  if (args.length > 2)
    throw new Error(
      `${kind}: multi-index (${args.length - 1} indexing sets) is not supported in the interval target`
    );

  const { index, lowerExpr, upperExpr, lowerNum, upperNum } =
    extractIntervalLimits(args[1]);

  // Before ANY lowering decision — the unroll path included, which a
  // non-finite bound would otherwise skip on its way to the loop arm.
  assertFiniteIntervalBound(kind, lowerExpr, 'lower');
  assertFiniteIntervalBound(kind, upperExpr, 'upper');

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
          boundVars: BaseCompiler.withBoundNames(target, [index]),
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

  const acc = BaseCompiler.tempVar(target);
  const bodyCode = BaseCompiler.compile(args[0], {
    ...target,
    var: (id) => (id === index ? `_IA.point(${index})` : target.var(id)),
    boundVars: BaseCompiler.withBoundNames(target, [index]),
  });

  // A SYMBOLIC bound can still be `±∞`/`NaN` at run time — the same
  // non-terminating loop. Guard once at loop entry (never per iteration);
  // `entire` is the interval target's "cannot bound this" answer. Constant
  // bounds are statically finite by `assertFiniteIntervalBound` above, so they
  // take the unguarded template and their code is unchanged.
  if (lowerNum === undefined || upperNum === undefined) {
    return `(() => { let ${acc} = ${identity}; const _upper = ${upperCode}; const _lower = ${lowerCode}; if (!Number.isFinite(_upper) || !Number.isFinite(_lower)) return { kind: 'entire' }; for (let ${index} = _lower; ${index} <= _upper; ${index}++) { ${acc} = ${iaOp}(${acc}, ${bodyCode}); } return ${acc}; })()`;
  }

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
        return Reflect.get(target, prop);
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

/**
 * Wrap an interpreter fallback result as an interval-shaped value honoring the
 * interval-js `run` contract. A scalar `v` becomes the degenerate interval
 * `{ lo: v, hi: v }`; a non-scalar (a collection materialized to an array)
 * cannot be bounded as a single interval, so it is reported as `entire` — the
 * same "cannot bound" signal the runtime proxy uses.
 */
function toIntervalResult(
  value: number | unknown[]
): IntervalResult | Interval {
  if (typeof value === 'number') return { lo: value, hi: value };
  return { kind: 'entire' };
}

/**
 * Collapse an interval-shaped fallback input (`{ lo, hi }`) to a representative
 * scalar — its midpoint — so the number-based interpreter can consume it. A
 * variables object has each interval-valued entry collapsed recursively; other
 * values pass through unchanged.
 */
function collapseIntervalInput(value: unknown): unknown {
  if (hasIntervalBounds(value))
    return (Number(value.lo) + Number(value.hi)) / 2;
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value))
      out[k] = collapseIntervalInput(v);
    return out;
  }
  return value;
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
      // The interval domain is scalar — one interval per quantity — so there is
      // no element-wise selection convention here. Decline a provably
      // collection-valued `Which`/`If` condition with a message that says so,
      // instead of the generic ``Unknown operator `List` `` the clause list used
      // to produce. Only PROVABLE collection-ness is tested: a wide-declared
      // condition (`q(x) < y` with `q: (unknown) -> unknown`) must keep
      // compiling unchanged — scalar curve/implicit plotting rides this target.
      selection: (args) => {
        for (let i = 0; i < args.length; i += 2) {
          const c = args[i];
          if (c.isCollection || c.type.matches('collection'))
            throw new Error(
              'Which: a collection-valued condition has no interval-js lowering — ' +
                'the interval domain is scalar (one interval per quantity), so there ' +
                'is no elementwise selection convention. Evaluate the expression ' +
                'instead, or compile a scalar per-element function. Fail closed (D6).'
            );
        }
        return null;
      },
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
      // Evaluate a shared middle operand of a chained relation exactly once
      // (matching the interpreter) by binding it in an IIFE. Net-new here: the
      // interval target used to inline every operand, so `a < m < b` evaluated
      // `m` twice.
      bindExpr: (bindings, body) =>
        `((${bindings.map((b) => b[0]).join(', ')}) => ${body})(${bindings
          .map((b) => b[1])
          .join(', ')})`,
      // Dependency-ordered CSE temporaries: a sequential-`const` IIFE (an
      // interval `{ lo, hi }` value is `const`-bindable like any other).
      cseBind: (bindings, body) =>
        `(() => { ${bindings
          .map(([name, code]) => `const ${name} = ${code};`)
          .join(' ')} return ${body}; })()`,
      // Absence capability (§3.F): numeric absence is a whole-NaN interval
      // (reusing the machinery already present for `NaN`); `isAbsent` tests the
      // lower endpoint. No object axis. Consumers land in P3.
      absence: {
        numeric: {
          make: () => '{ lo: NaN, hi: NaN }',
          isAbsent: (x) => `Number.isNaN((${x}).lo)`,
          coalesce: (x, d) => `((_c) => Number.isNaN(_c.lo) ? ${d} : _c)(${x})`,
        },
      },
      indent: 0,
      ws: (s?: string) => s ?? '',
      preamble: '',
      // Per-compilation naming state for generated temporaries (see the
      // JavaScript target).
      naming: { counter: 0, usedNames: new Set<string>() },
      ...options,
    };
  }

  compile(
    expr: Expression,
    options: CompilationOptions<Expression> = {}
  ): CompilationResult<'interval-js', IntervalResult | Interval> {
    let result: CompilationResult<'interval-js', IntervalResult | Interval>;
    try {
      result = this.compileOrThrow(expr, options);
    } catch (e) {
      // Default: throw. With `fallback: true`, return the documented
      // `success: false` shape with an interpreter-backed `run`.
      if (options.fallback !== true) throw e;
      return this.buildIntervalFallback(expr, (e as Error).message, options);
    }
    // The primary failure class never throws: `compileToIntervalTarget`
    // reports an operator with no interval kernel as `success: false` (see its
    // internal catch), so the `catch` above cannot build the fallback for it.
    // When the caller opted into the failure-shape contract, normalize that
    // `success: false` to the same interpreter-backed fallback, preserving the
    // captured error detail (synthesizing a message only if none survived).
    if (!result.success && options.fallback === true) {
      const error =
        result.error ??
        `Cannot compile \`${expr.operator}\` to the interval-js target`;
      return this.buildIntervalFallback(expr, error, options);
    }
    return result;
  }

  /**
   * Build the documented `success: false` fallback for the interval-js target:
   * an interpreter-backed `run` whose results honor the interval contract.
   *
   * `BaseCompiler.buildInterpreterFallback` produces a runner that returns plain
   * numbers (and nested arrays for collections), so its scalar output is wrapped
   * as a degenerate interval `{ lo: v, hi: v }`, and interval-shaped *inputs*
   * (`{ lo, hi }`) are collapsed to their midpoint before interpretation. A
   * non-scalar result cannot be bounded as a single interval, so it is reported
   * as `{ kind: 'entire' }` — the same "cannot bound" signal the runtime proxy
   * uses. Returning a properly interval-typed `run` lets the result carry the
   * target's real value type without a force cast.
   */
  private buildIntervalFallback(
    expr: Expression,
    error: string,
    options: CompilationOptions<Expression>
  ): CompilationResult<'interval-js', IntervalResult | Interval> {
    console.warn(
      `Compilation fallback for "${expr.operator}" (target: interval-js): ${error}`
    );
    const base = BaseCompiler.buildInterpreterFallback(
      expr,
      error,
      'interval-js',
      this.createTarget(),
      options.vars ? new Set(Object.keys(options.vars)) : undefined
    );
    // `run` is guaranteed present for an executable target (interval-js).
    const interpreterRun = base.run as (
      ...args: unknown[]
    ) => number | unknown[];
    const run: CompiledRunner<IntervalResult | Interval> = (
      ...args: unknown[]
    ): IntervalResult | Interval =>
      toIntervalResult(interpreterRun(...args.map(collapseIntervalInput)));
    return { ...base, run };
  }

  private compileOrThrow(
    expr: Expression,
    options: CompilationOptions<Expression> = {}
  ): CompilationResult<'interval-js', IntervalResult | Interval> {
    // Reproduce the engine's `angularUnit` semantics in radian-based code.
    expr = rewriteAngularUnit(expr);
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
        // An assigned value / declared constant: returning `undefined` lets
        // BaseCompiler fold it (see the JavaScript target) rather than emitting
        // a bare, dangling reference for a symbol that `expr.unknowns` omits.
        if (expr.engine._getSymbolValue(id) !== undefined) return undefined;
        // No value: a genuinely free symbol, possibly reachable only through a
        // folded value (so absent from `unknowns`). Emit the vars-object lookup
        // rather than a bare, dangling reference.
        return `_.${id}`;
      },
      preamble: (preamble ?? '') + preambleImports,
      // Opt in to compiling calls to user-defined function literals (`f(x) :=
      // …`) as named local functions collected into the preamble.
      userFunctions: { defs: new Map(), compiling: new Set() },
      // Root compilation boundary: fresh, deterministic numbering for the
      // generated temporaries (see the JavaScript target).
      naming: BaseCompiler.newNamingContext(expr, [
        preamble,
        preambleImports,
        ...Object.values(namedFunctions),
        ...(vars ? Object.values(vars) : []),
      ]),
    });
    // The compilation root: a user-function definition body compiles against
    // THIS target plus its own parameters, never against a nested requesting
    // one (see `CompileTarget.userFunctions.root`).
    target.userFunctions!.root = target;

    // Common-subexpression elimination (design §4.2), on the same
    // post-`rewriteAngularUnit` tree the emitters walk. The G1b provenance
    // predicates come from the RAW options (this target has no `operators`
    // override channel — `operators` always resolves to `undefined` here).
    BaseCompiler.openCseSession(expr, target, {
      enabled: options.cse,
      isOverriddenOperator: (name) =>
        Object.prototype.hasOwnProperty.call(namedFunctions, name),
      isStringVar: (name) =>
        vars !== undefined && typeof vars[name] === 'string',
      isVarsKey: (name) =>
        vars !== undefined && Object.prototype.hasOwnProperty.call(vars, name),
    });

    const result = compileToIntervalTarget(expr, target);
    return BaseCompiler.withReferences(
      result,
      expr,
      target,
      vars ? new Set(Object.keys(vars)) : undefined
    );
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
    js = BaseCompiler.compileCseRoot(expr, target);
  } catch (e) {
    // Expression contains operators/functions not supported by the interval
    // target. Report failure so the caller can fall back to another target,
    // preserving the reason so `compile()` can surface it (this path does not
    // throw, so the wrapper cannot recover the message otherwise).
    return {
      target: 'interval-js',
      success: false,
      code: '',
      error: (e as Error).message,
    } as CompilationResult<'interval-js', IntervalResult | Interval>;
  }
  // Prepend any user-defined function definitions accumulated while compiling
  // `expr` (a symbol with a `Function`-literal definition used as an operator)
  // to the preamble so their named local functions are in scope.
  const userDefs = BaseCompiler.userFunctionsPreamble(target);
  const preamble = userDefs
    ? target.preamble
      ? `${target.preamble}\n${userDefs}`
      : userDefs
    : target.preamble;
  const fn = new ComputeEngineIntervalFunction(js, preamble);
  return {
    target: 'interval-js',
    success: true,
    code: js,
    calling: 'expression',
    run: fn as unknown as CompiledRunner<IntervalResult | Interval>,
  };
}

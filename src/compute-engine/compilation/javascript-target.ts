import type { Expression } from '../global-types.js';
import type { MathJsonSymbol } from '../../math-json/types.js';
import {
  isSymbol,
  isNumber,
  isFunction,
  isString,
} from '../boxed-expression/type-guards.js';
import { functionLiteralParameterName } from '../boxed-expression/function-literal.js';
import { Complex } from 'complex-esm';
import { tryGetConstant } from './constant-folding.js';
import { collectionElementType } from '../../common/type/utils.js';
import { isSubtype } from '../../common/type/subtype.js';

import {
  chop,
  factorial,
  factorial2,
  realGcd as gcd,
  realLcm as lcm,
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
import { adaptiveQuadrature } from '../numerics/gauss-kronrod.js';
import { mulberry32 } from '../numerics/random.js';

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
  // Scalar equality over a collection-valued operand has no committed coverage
  // on the JavaScript target: a raw `Math.abs(a - b)` over a list silently
  // coerces (`[1,2,3] - 2` → NaN), so `Equal`/`NotEqual` would return a wrong
  // boolean behind a `success: true`. Fail closed (D6) with the offending head
  // so the engine-level `compile()` reports `success: false` and falls back to
  // the interpreter. Uses the declared type (not `.isCollection`, which is
  // false for a `list<finite_number>` such as `Power(L, 2)`).
  for (const a of args)
    if (a.type.matches('collection'))
      throw new Error(
        `${kind}: cannot compile — operand is a collection-valued expression. ` +
          `Materialize the collection first. Fail closed (D6).`
      );
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
 * True when `e` compiles to a JavaScript array that supports index access and
 * `.length` — an indexed collection (list / vector / range) or a `list`-typed
 * expression (e.g. `Power(L, 2)`, which types as `list<finite_number>` but is
 * not reported by `.isCollection`). Dictionaries and strings are excluded: they
 * are collections but do not lower to a JS array with count/positional access.
 *
 * Uses the declared type rather than `isFiniteIndexedCollection` from
 * `collection-utils`: importing that module here reorders module init and
 * breaks a runtime binding in the arithmetic broadcast path.
 */
function isIndexedCollectionOperand(e: Expression): boolean {
  const t = e.type;
  return t.matches('list') || t.matches('indexed_collection');
}

/**
 * Compile a point-coordinate accessor (`.x`/`.y`/`.z` → PointX/PointY/PointZ),
 * `idx` is the 0-based coordinate. On a single point (a tuple, compiled to a JS
 * array) it indexes the coordinate; on a list of points it broadcasts, mapping
 * the coordinate over the array — matching the interpreter's `pointComponentAt`
 * and Desmos semantics. The tuple case is checked first because a tuple type
 * also matches `indexed_collection`.
 */
function compilePointComponent(
  arg: Expression,
  idx: number,
  compile: (e: Expression) => string
): string {
  const compiled = compile(arg);
  const t = arg.type.type;
  // A single point (tuple): index the coordinate directly.
  if (typeof t !== 'string' && t.kind === 'tuple') return `${compiled}[${idx}]`;
  // A list of points broadcasts the coordinate — but only when the operand is
  // confirmably a list of points, matching the interpreter's `pointComponentAt`
  // (which inspects concrete elements rather than trusting the declared element
  // type). Any other collection is element-indexing, like First/Second/Third,
  // which is the same `[idx]` access as the single-point case.
  if (isPointListOperand(arg)) return `(${compiled}).map((_pt) => _pt[${idx}])`;
  return `${compiled}[${idx}]`;
}

/**
 * True when `e` is (confirmably) a list of points, so a coordinate accessor
 * broadcasts. Mirrors the interpreter's `pointComponentAt` decision in
 * `collections.ts`: a symbolic operand whose declared element type is a tuple,
 * or a literal collection whose first element is a point. Kept as a local
 * predicate (rather than importing from `collections.ts`) to avoid the
 * module-init reordering hazard noted on `isIndexedCollectionOperand`.
 */
function isPointListOperand(e: Expression): boolean {
  const elt = collectionElementType(e.type.type);
  if (elt !== undefined && typeof elt !== 'string' && elt.kind === 'tuple')
    return true;
  if (e.isFiniteCollection) {
    const first = e.at(1);
    if (first === undefined) return false;
    const ft = first.type.type;
    return (
      (typeof ft !== 'string' && ft.kind === 'tuple') ||
      first.operator === 'Tuple'
    );
  }
  return false;
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
  // n-ary GCD/LCM. The `_SYS.gcd`/`_SYS.lcm` runtime helpers are BINARY with a
  // third `eps` (tolerance) argument, so a bare `_SYS.gcd(a, b, c)` string map
  // would silently consume the third *operand* `c` as the tolerance. Instead
  // fold pairwise so no operand can ever land in the `eps` slot, and handle
  // list-valued operands by spread-and-reduce (mirroring `compileExtremum`).
  GCD: (args, compile) => compileGcdLcm('GCD', args, compile),
  Integrate: (args, compile, target) => compileIntegrate(args, compile, target),
  LCM: (args, compile) => compileGcdLcm('LCM', args, compile),
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
  // Element count of a compiled collection. Only an indexed collection lowers
  // to a JS array; a dictionary or string operand fails closed (D6).
  Length: (args, compile) => {
    const arg = args[0];
    if (arg === null || arg === undefined)
      throw new Error('Length: no argument');
    if (!isIndexedCollectionOperand(arg))
      throw new Error(
        `Length: cannot compile — operand is not an indexed collection ` +
          `(list/vector/range). Fail closed (D6).`
      );
    return `(${compile(arg)}).length`;
  },
  // Positional access. CE `At` is 1-based and supports negative indices from
  // the end; an out-of-range or zero index yields NaN (matching the
  // interpreter's `Nothing`, projected to NaN on a real target). Only the
  // single-index form over an indexed collection compiles; nested/multi-index
  // access and non-collection operands fail closed (D6).
  At: (args, compile) => {
    const coll = args[0];
    const index = args[1];
    if (
      coll === null ||
      coll === undefined ||
      index === null ||
      index === undefined
    )
      throw new Error('At: missing argument');
    if (args.length !== 2)
      throw new Error(
        `At: only the single-index form compiles; multi-index (nested) ` +
          `access is not supported. Fail closed (D6).`
      );
    if (!isIndexedCollectionOperand(coll))
      throw new Error(
        `At: cannot compile — first operand is not an indexed collection ` +
          `(list/vector/range). Fail closed (D6).`
      );
    return `_SYS.at(${compile(coll)}, ${compile(index)})`;
  },
  // Fold a collection. CE `Reduce` canonicalizes `\sum_{i=d}^{d} d` to
  // `Reduce(d, Add, 0)`. The Add/Multiply/Min/Max folds compile, as does a
  // custom combiner (`Function` literal or function-valued symbol, compiled
  // as a lambda like `Map`/`Filter`) — but a custom combiner requires an
  // explicit initial value: without one the interpreter folds from `Nothing`
  // (whose effect depends on the combiner and has no numeric equivalent),
  // while a native seedless reduce starts from the first element — those
  // diverge for non-commutative combiners. Anything else fails closed (D6).
  // `Fold(f, init, coll)` canonicalizes to `Reduce(coll, f, init)`, so this
  // handler covers it too.
  Reduce: (args, compile, target) => {
    const coll = args[0];
    const op = args[1];
    const init = args[2];
    if (coll === null || coll === undefined || op === null || op === undefined)
      throw new Error('Reduce: missing argument');
    if (!isIndexedCollectionOperand(coll))
      throw new Error(
        `Reduce: cannot compile — first operand is not an indexed collection ` +
          `(list/vector/range). Fail closed (D6).`
      );
    let combiner = builtinCombiner(op);
    if (
      combiner === undefined &&
      (isFunction(op, 'Function') || isSymbol(op))
    ) {
      if (init === undefined || init === null)
        throw new Error(
          `Reduce: a custom combiner compiles only with an explicit ` +
            `initial value. Fail closed (D6).`
        );
      combiner = customCombiner(op, compile, target);
    }
    if (combiner === undefined)
      throw new Error(
        `Reduce: the combiner does not compile to a function — only ` +
          `Add/Multiply/Min/Max folds, function literals, and user-defined ` +
          `functions compile on the JavaScript target. Fail closed (D6).`
      );
    const collCode = compile(coll);
    // With an initial value, seed the reduce; without one, the native reduce
    // uses the first element as the seed (matching the interpreter, which
    // returns the sole/first element for a singleton and folds pairwise). A
    // seedless native `reduce` throws on an empty array, whereas the
    // interpreter returns `Nothing` (numeric projection NaN) — so guard the
    // empty case to yield NaN instead of throwing at runtime.
    if (init !== undefined && init !== null)
      return `(${collCode}).reduce(${combiner}, ${compile(init)})`;
    return `((_l) => _l.length === 0 ? NaN : _l.reduce(${combiner}))(${collCode})`;
  },
  // --- List-shaped collection operators ---------------------------------
  // Each lowers to a native array operation. Only an indexed collection
  // (list/vector/range) lowers to a JS array; other operands fail closed (D6),
  // matching `Length`/`At`/`Reduce`.
  //
  // `Last` is the last element (`At(coll, -1)`); an empty collection yields NaN
  // (the interpreter's `Nothing` projected onto a real target).
  Last: (args, compile) => `_SYS.at(${collArg('Last', args[0], compile)}, -1)`,
  // All-but-first / all-but-first-n / first-n. `Take`/`Drop` clamp the count to
  // ≥ 0 so a negative count matches the interpreter (`Take(xs, -2) = []`,
  // `Drop(xs, -2) = xs`), and JS `slice` already clamps a count past the end.
  Rest: (args, compile) => `(${collArg('Rest', args[0], compile)}).slice(1)`,
  Take: (args, compile) => {
    const coll = collArg('Take', args[0], compile);
    if (args[1] == null) throw new Error('Take: missing count');
    return `(${coll}).slice(0, Math.max(0, ${compile(args[1])}))`;
  },
  Drop: (args, compile) => {
    const coll = collArg('Drop', args[0], compile);
    if (args[1] == null) throw new Error('Drop: missing count');
    return `(${coll}).slice(Math.max(0, ${compile(args[1])}))`;
  },
  // Reverse and (ascending, numeric) Sort — copy first so the source array is
  // not mutated. A custom `Sort` comparator is not lowered (fails closed).
  Reverse: (args, compile) =>
    `(${collArg('Reverse', args[0], compile)}).slice().reverse()`,
  Sort: (args, compile) => {
    const coll = collArg('Sort', args[0], compile);
    if (args.length > 1)
      throw new Error(
        `Sort: a custom comparator does not compile; only the default ` +
          `ascending numeric sort is supported. Fail closed (D6).`
      );
    return `(${coll}).slice().sort((_a, _b) => _a - _b)`;
  },
  // Flat concatenation of the (top-level) elements of each collection operand.
  Join: (args, compile) => {
    if (args.length === 0) return '[]';
    return `[${args
      .map((a, i) => `...(${collArg('Join', a, compile, i + 1)})`)
      .join(', ')}]`;
  },
  // 1-based index of the first element equal to `value`, or 0 if not found.
  // Uses the engine's numeric tolerance (like `compileJSEquality`), NOT a raw
  // `Array.indexOf` (`===`): the interpreter compares within `engine.tolerance`,
  // so `IndexOf([0.3], 0.1 + 0.2)` must find the element. `findIndex` is 0-based
  // and returns -1 when absent, so `+ 1` maps both. The value is hoisted into an
  // IIFE parameter so it is evaluated once.
  IndexOf: (args, compile) => {
    const coll = collArg('IndexOf', args[0], compile);
    if (args[1] == null) throw new Error('IndexOf: missing value');
    const tol = args[0]?.engine?.tolerance ?? 1e-10;
    return `((_v) => (${coll}).findIndex((_x) => Math.abs(_x - _v) <= ${tol}) + 1)(${compile(
      args[1]
    )})`;
  },
  // Higher-order: the mapping/predicate operand is compiled as a lambda
  // (`Function` literal → `(x) => …`), hoisted into an IIFE parameter so it
  // is instantiated once (not once per element), and invoked with a fixed
  // unary arity — the native callbacks pass `(x, index, array)` and the
  // extra arguments must not leak into the lambda's parameters (the
  // interpreter passes exactly `(x)`). A mapping operand that does not
  // compile to a lambda fails closed.
  Map: (args, compile) => {
    // The multi-collection (zipWith) form is not compiled; fail closed so the
    // engine reports success:false and falls back to the interpreter.
    if (args.length > 2)
      throw new Error('Map: multi-collection form is not compiled');
    const coll = collArg('Map', args[0], compile);
    if (args[1] == null) throw new Error('Map: missing mapping function');
    return `((_f) => (${coll}).map((_x) => _f(_x)))(${compile(args[1])})`;
  },
  Filter: (args, compile) => {
    const coll = collArg('Filter', args[0], compile);
    if (args[1] == null) throw new Error('Filter: missing predicate');
    return `((_f) => (${coll}).filter((_x) => _f(_x)))(${compile(args[1])})`;
  },
  // Number of elements satisfying the predicate.
  CountIf: (args, compile) => {
    const coll = collArg('CountIf', args[0], compile);
    if (args[1] == null) throw new Error('CountIf: missing predicate');
    return `((_f) => (${coll}).filter((_x) => _f(_x)).length)(${compile(args[1])})`;
  },
  // First element satisfying the predicate; none → NaN (the interpreter's
  // `Nothing` projected onto a real target, matching `Last`).
  Find: (args, compile) => {
    const coll = collArg('Find', args[0], compile);
    if (args[1] == null) throw new Error('Find: missing predicate');
    return `((_f) => ((${coll}).find((_x) => _f(_x)) ?? NaN))(${compile(args[1])})`;
  },
  // 1-based index of the first element satisfying the predicate, or 0 if
  // none — `findIndex` is 0-based and returns -1, so `+ 1` maps both.
  IndexWhere: (args, compile) => {
    const coll = collArg('IndexWhere', args[0], compile);
    if (args[1] == null) throw new Error('IndexWhere: missing predicate');
    return `((_f) => (${coll}).findIndex((_x) => _f(_x)) + 1)(${compile(args[1])})`;
  },
  // List of the 1-based indexes of the elements satisfying the predicate.
  Position: (args, compile) => {
    const coll = collArg('Position', args[0], compile);
    if (args[1] == null) throw new Error('Position: missing predicate');
    return `((_f) => (${coll}).flatMap((_x, _i) => _f(_x) ? [_i + 1] : []))(${compile(args[1])})`;
  },
  // Apply the function to 1-based indexes: 1-D `Tabulate(f, n)` → list;
  // 2-D `Tabulate(f, m, n)` → m×n nested list with the first dimension
  // outermost, matching the interpreter (and `Table`, which canonicalizes
  // to `Tabulate` or to `Map` over `Range`). The function and the dimensions
  // are hoisted into IIFE parameters so each is evaluated once (an impure
  // dimension must not be re-evaluated per row), and a *dynamic* dimension is
  // normalized at runtime like the interpreter's `toInteger`: rounded to the
  // nearest integer and clamped to ≥ 0 (a NaN dimension yields an empty list).
  // A *statically* non-positive dimension (a literal ≤ 0) is inert in the
  // interpreter (it stays symbolic, e.g. `Tabulate(f, 0)`), so it fails closed
  // (D6) here rather than compiling to `[]` behind `success: true` — mirroring
  // the `Range`/`Table` step-0 precedent.
  Tabulate: (args, compile) => {
    if (args[0] == null || args[1] == null)
      throw new Error('Tabulate: missing argument');
    if (args.length > 3)
      throw new Error(
        `Tabulate: only the 1-D and 2-D forms compile. Fail closed (D6).`
      );
    for (let i = 1; i < args.length; i++) {
      const dim = tryGetConstant(args[i]!);
      if (dim !== undefined && Math.round(dim) <= 0)
        throw new Error(
          `Tabulate: a statically non-positive dimension (${dim}) is inert ` +
            `in the interpreter. Fail closed (D6).`
        );
    }
    const f = compile(args[0]);
    const n = compile(args[1]);
    if (args.length === 2)
      return `((_f, _n) => Array.from({ length: Math.max(0, Math.round(_n)) }, (_, _i) => _f(_i + 1)))(${f}, ${n})`;
    const m = compile(args[2]);
    return `((_f, _n, _m) => Array.from({ length: Math.max(0, Math.round(_n)) }, (_, _i) => Array.from({ length: Math.max(0, Math.round(_m)) }, (_, _j) => _f(_i + 1, _j + 1))))(${f}, ${n}, ${m})`;
  },
  // `Fill(f, (rows, cols))` → rows×cols nested list of `f(i, j)` with
  // 1-based row/column indexes, matching the interpreter. Same hoisting and
  // dimension normalization as `Tabulate`.
  Fill: (args, compile) => {
    const dims = args[1];
    if (args[0] == null || dims == null)
      throw new Error('Fill: missing argument');
    if (!isFunction(dims) || dims.ops.length !== 2)
      throw new Error(
        `Fill: only the (function, (rows, cols)) form compiles. ` +
          `Fail closed (D6).`
      );
    const f = compile(args[0]);
    const rows = compile(dims.ops[0]);
    const cols = compile(dims.ops[1]);
    return `((_f, _r, _c) => Array.from({ length: Math.max(0, Math.round(_r)) }, (_, _i) => Array.from({ length: Math.max(0, Math.round(_c)) }, (_, _j) => _f(_i + 1, _j + 1))))(${f}, ${rows}, ${cols})`;
  },
  // Add one element at the end.
  Append: (args, compile) => {
    const coll = collArg('Append', args[0], compile);
    if (args[1] == null) throw new Error('Append: missing value');
    return `[...(${coll}), ${compile(args[1])}]`;
  },
  // All but the last element; an empty or singleton collection yields [].
  Most: (args, compile) =>
    `(${collArg('Most', args[0], compile)}).slice(0, -1)`,
  // 1-based inclusive range. Mirrors the interpreter's Slice collection
  // handler exactly: indexes are rounded (`toInteger`); a start/end < 1 is
  // counted from the end (so a start of 0 resolves PAST the end → empty);
  // start past the end → empty; end clamped to [1, len].
  Slice: (args, compile) => {
    const coll = collArg('Slice', args[0], compile);
    if (args[1] == null || args[2] == null)
      throw new Error('Slice: missing index');
    return `((_l, _s, _e) => { _s = Math.round(_s); if (!Number.isFinite(_s)) _s = 1; _e = Math.round(_e); if (!Number.isFinite(_e)) _e = _l.length; if (_s < 1) _s = _l.length + 1 + _s; if (_s < 1) _s = 1; if (_s > _l.length) return []; if (_e < 1) _e = _l.length + 1 + _e; if (_e < 1) _e = 1; if (_e > _l.length) _e = _l.length; return _l.slice(_s - 1, _e); })(${coll}, ${compile(args[1])}, ${compile(args[2])})`;
  },
  IsEmpty: (args, compile) =>
    `((${collArg('IsEmpty', args[0], compile)}).length === 0)`,
  // Number of elements — same as `Length` for an indexed collection.
  Count: (args, compile) => `(${collArg('Count', args[0], compile)}).length`,
  // Membership via SameValueZero (`includes`) — value equality only for
  // primitive elements, so compound element types fail closed.
  Contains: (args, compile) => {
    if (args[0]) requirePrimitiveElements('Contains', args[0]);
    const coll = collArg('Contains', args[0], compile);
    if (args[1] == null) throw new Error('Contains: missing value');
    return `(${coll}).includes(${compile(args[1])})`;
  },
  // Unique elements in first-occurrence order (`Set` preserves insertion
  // order and uses SameValueZero — value equality only for primitive
  // elements, so compound element types fail closed).
  Unique: (args, compile) => {
    if (args[0]) requirePrimitiveElements('Unique', args[0]);
    return `[...new Set(${collArg('Unique', args[0], compile)})]`;
  },
  // Rotate left/right by n positions (default 1). The shift is rounded and
  // normalized modulo the length, matching the interpreter; a non-finite
  // shift falls back to the default 1 (the interpreter's `toInteger` treats
  // it as missing); an empty collection yields [].
  RotateLeft: (args, compile) => {
    const coll = collArg('RotateLeft', args[0], compile);
    const n = args[1] == null ? '1' : compile(args[1]);
    return `((_l, _n) => { if (_l.length === 0) return []; _n = Math.round(_n); if (!Number.isFinite(_n)) _n = 1; _n = ((_n % _l.length) + _l.length) % _l.length; return [..._l.slice(_n), ..._l.slice(0, _n)]; })(${coll}, ${n})`;
  },
  RotateRight: (args, compile) => {
    const coll = collArg('RotateRight', args[0], compile);
    const n = args[1] == null ? '1' : compile(args[1]);
    return `((_l, _n) => { if (_l.length === 0) return []; _n = Math.round(_n); if (!Number.isFinite(_n)) _n = 1; _n = ((-_n % _l.length) + _l.length) % _l.length; return [..._l.slice(_n), ..._l.slice(0, _n)]; })(${coll}, ${n})`;
  },
  // Element-wise combination: a list of tuples (compiled as arrays), with
  // the length of the shortest input.
  Zip: (args, compile) => {
    if (args.length === 0) return '[]';
    const colls = args.map((a, i) => collArg('Zip', a, compile, i + 1));
    return `((..._ls) => Array.from({ length: Math.min(..._ls.map((_l) => _l.length)) }, (_, _i) => _ls.map((_l) => _l[_i])))(${colls.join(', ')})`;
  },
  // Evenly spaced numbers, both endpoints included. Defaults mirror the
  // interpreter: `Linspace(end)` → start 1; count defaults to 50 — also for
  // a non-finite runtime count, like the interpreter — and is floored (not
  // rounded) and clamped to ≥ 0; a count of 1 yields [start].
  Linspace: (args, compile) => {
    if (args[0] == null) throw new Error('Linspace: missing argument');
    const start = args[1] == null ? '1' : compile(args[0]);
    const end = args[1] == null ? compile(args[0]) : compile(args[1]);
    const count = args[2] == null ? '50' : compile(args[2]);
    return `((_s, _e, _c) => { _c = Math.floor(_c); if (!Number.isFinite(_c)) _c = 50; _c = Math.max(0, _c); if (_c === 1) return [_s]; return Array.from({ length: _c }, (_, _i) => _s + ((_e - _s) * _i) / (_c - 1)); })(${start}, ${end}, ${count})`;
  },
  // Split into k chunks of ceil(len/k) elements — mirroring the interpreter
  // exactly, including k > len producing trailing empty chunks. A statically
  // invalid k (literal ≤ 0) is inert in the interpreter, so it fails closed
  // (D6) at compile time; a *dynamic* k that is non-positive or non-finite
  // at runtime projects to [].
  Chunk: (args, compile) => {
    const coll = collArg('Chunk', args[0], compile);
    if (args[1] == null) throw new Error('Chunk: missing count');
    const kConst = tryGetConstant(args[1]);
    if (kConst !== undefined && !(Math.round(kConst) > 0))
      throw new Error(
        `Chunk: a statically non-positive chunk count (${kConst}) is inert ` +
          `in the interpreter. Fail closed (D6).`
      );
    return `((_l, _k) => { _k = Math.round(_k); if (!(Number.isFinite(_k) && _k > 0)) return []; const _sz = Math.ceil(_l.length / _k); return Array.from({ length: _k }, (_, _i) => _l.slice(_i * _sz, (_i + 1) * _sz)); })(${coll}, ${compile(args[1])})`;
  },
  // Integer form yields chunks of SIZE n (trailing chunk may be shorter);
  // with a step, complete sliding windows only — mirroring the interpreter.
  // The predicate form yields [[matching], [non-matching]]. The predicate is
  // hoisted and called unary, like the other higher-order operators.
  Partition: (args, compile) => {
    const coll = collArg('Partition', args[0], compile);
    const arg = args[1];
    if (arg == null) throw new Error('Partition: missing operand');
    if (arg.type.matches('number')) {
      const nConst = tryGetConstant(arg);
      if (nConst !== undefined && !(Math.round(nConst) > 0))
        throw new Error(
          `Partition: a statically non-positive chunk size (${nConst}) is ` +
            `inert in the interpreter. Fail closed (D6).`
        );
      const step = args[2];
      if (step !== undefined) {
        const stepConst = tryGetConstant(step);
        if (stepConst !== undefined && !(Math.round(stepConst) > 0))
          throw new Error(
            `Partition: a statically non-positive step (${stepConst}) is ` +
              `inert in the interpreter. Fail closed (D6).`
          );
        return `((_l, _n, _s) => { _n = Math.round(_n); _s = Math.round(_s); if (!(Number.isFinite(_n) && _n > 0 && Number.isFinite(_s) && _s > 0)) return []; const _r = []; for (let _i = 0; _i + _n <= _l.length; _i += _s) _r.push(_l.slice(_i, _i + _n)); return _r; })(${coll}, ${compile(arg)}, ${compile(step)})`;
      }
      return `((_l, _n) => { _n = Math.round(_n); if (!(Number.isFinite(_n) && _n > 0)) return []; const _r = []; for (let _i = 0; _i < _l.length; _i += _n) _r.push(_l.slice(_i, _i + _n)); return _r; })(${coll}, ${compile(arg)})`;
    }
    if (
      isFunction(arg, 'Function') ||
      (isSymbol(arg) &&
        BaseCompiler.userFunctionLiteral(arg.engine, arg.symbol) !== undefined)
    )
      return `((_f, _l) => { const _t = [], _u = []; for (const _x of _l) (_f(_x) ? _t : _u).push(_x); return [_t, _u]; })(${compile(arg)}, ${coll})`;
    throw new Error(
      `Partition: the second operand must be an integer or a function ` +
        `literal. Fail closed (D6).`
    );
  },
  // 1-based indexes that sort the collection ascending; ties keep their
  // original order (native sort is stable, matching the interpreter). A
  // custom ordering function does not compile, matching `Sort`.
  Ordering: (args, compile) => {
    const coll = collArg('Ordering', args[0], compile);
    if (args.length > 1)
      throw new Error(
        `Ordering: a custom ordering function does not compile; only the ` +
          `default ascending numeric order is supported. Fail closed (D6).`
      );
    return `((_l) => Array.from({ length: _l.length }, (_, _i) => _i + 1).sort((_a, _b) => _l[_a - 1] - _l[_b - 1]))(${coll})`;
  },
  // Unbiased Fisher–Yates shuffle on a copy (`_SYS.shuffle`). When the
  // engine's `randomSeed` is set at compile time, a per-node seed is baked
  // in (the same mixing scheme as `Random`) so the compiled permutation is
  // deterministic and reproducible; otherwise `Math.random` drives it. The
  // explicit seed-operand form does not compile — fail closed.
  Shuffle: (args, compile, target) => {
    const coll = collArg('Shuffle', args[0], compile);
    if (args.length > 1)
      throw new Error(
        `Shuffle: the seeded form does not compile. Fail closed (D6).`
      );
    const seed = target?.randomSeed;
    if (seed !== undefined && seed !== null) {
      const idx = target?.randomState ? target.randomState.counter++ : 0;
      const s = (seed ^ Math.imul(idx + 1, 0x9e3779b1)) >>> 0;
      return `_SYS.shuffle(${coll}, ${s})`;
    }
    return `_SYS.shuffle(${coll})`;
  },
  // True if the predicate holds for at least one / every element (vacuously
  // False / True on an empty collection, like `.some`/`.every`). Only the
  // predicate form compiles: without a predicate the elements must be
  // booleans, which a numeric collection cannot prove — the interpreter
  // stays inert there.
  Any: (args, compile) => {
    const coll = collArg('Any', args[0], compile);
    if (args[1] == null)
      throw new Error(
        `Any: only the predicate form compiles. Fail closed (D6).`
      );
    return `((_f) => (${coll}).some((_x) => _f(_x)))(${compile(args[1])})`;
  },
  All: (args, compile) => {
    const coll = collArg('All', args[0], compile);
    if (args[1] == null)
      throw new Error(
        `All: only the predicate form compiles. Fail closed (D6).`
      );
    return `((_f) => (${coll}).every((_x) => _f(_x)))(${compile(args[1])})`;
  },
  // Longest prefix satisfying the predicate / the rest after that prefix.
  TakeWhile: (args, compile) => {
    const coll = collArg('TakeWhile', args[0], compile);
    if (args[1] == null) throw new Error('TakeWhile: missing predicate');
    return `((_f, _l) => { const _i = _l.findIndex((_x) => !_f(_x)); return _i < 0 ? _l.slice() : _l.slice(0, _i); })(${compile(args[1])}, ${coll})`;
  },
  DropWhile: (args, compile) => {
    const coll = collArg('DropWhile', args[0], compile);
    if (args[1] == null) throw new Error('DropWhile: missing predicate');
    return `((_f, _l) => { const _i = _l.findIndex((_x) => !_f(_x)); return _i < 0 ? [] : _l.slice(_i); })(${compile(args[1])}, ${coll})`;
  },
  // Map + flatten one level. Native `flatMap` matches the interpreter for
  // both shapes: a collection-valued mapping is spliced, a scalar result is
  // kept as-is.
  FlatMap: (args, compile) => {
    const coll = collArg('FlatMap', args[0], compile);
    if (args[1] == null) throw new Error('FlatMap: missing mapping function');
    return `((_f) => (${coll}).flatMap((_x) => _f(_x)))(${compile(args[1])})`;
  },
  // Running fold: the accumulator AFTER each element; the initial value is
  // not emitted. Without an initial value the first element seeds the
  // accumulator and is emitted as-is — unlike `Reduce`, both interpreter
  // forms are deterministic, so both compile.
  Scan: (args, compile, target) => {
    const coll = args[0];
    const op = args[1];
    const init = args[2];
    if (coll == null || op == null) throw new Error('Scan: missing argument');
    if (!isIndexedCollectionOperand(coll))
      throw new Error(
        `Scan: cannot compile — first operand is not an indexed collection ` +
          `(list/vector/range). Fail closed (D6).`
      );
    const combiner =
      builtinCombiner(op) ??
      (isFunction(op, 'Function') || isSymbol(op)
        ? customCombiner(op, compile, target)
        : undefined);
    if (combiner === undefined)
      throw new Error(
        `Scan: the combiner does not compile to a function — only ` +
          `Add/Multiply/Min/Max folds, function literals, and user-defined ` +
          `functions compile on the JavaScript target. Fail closed (D6).`
      );
    const collCode = compile(coll);
    if (init !== undefined && init !== null)
      return `((_f, _l, _a) => _l.map((_x) => (_a = _f(_a, _x))))(${combiner}, ${collCode}, ${compile(init)})`;
    return `((_f, _l) => { let _a; return _l.map((_x, _i) => (_a = _i === 0 ? _x : _f(_a, _x))); })(${combiner}, ${collCode})`;
  },
  // --- Core scalar operators ---------------------------------------------
  // Iverson bracket: 1 if the boolean argument is true, 0 if false. A
  // provably-boolean condition compiles bare; otherwise the `_SYS.cond`
  // guard rethrows on a non-boolean at runtime (the interpreter stays
  // symbolic for an undetermined predicate — no numeric equivalent).
  Boole: (args, compile) => {
    if (args[0] == null) throw new Error('Boole: missing argument');
    const c = compile(args[0]);
    if (BaseCompiler.isBooleanValued(args[0])) return `((${c}) ? 1 : 0)`;
    return `(_SYS.cond(${c}) ? 1 : 0)`;
  },
  // δ: 1 when all arguments are equal — a single argument compares to 0 —
  // else 0, using the same tolerance as compiled `Equal`. Arguments are
  // hoisted into IIFE parameters so each is evaluated once.
  KroneckerDelta: (args, compile) => {
    if (args.length === 0 || args[0] == null)
      throw new Error('KroneckerDelta: missing argument');
    const tol = args[0].engine.tolerance ?? 1e-10;
    if (args.length === 1)
      return `(Math.abs(${compile(args[0])}) <= ${tol} ? 1 : 0)`;
    return `((..._v) => _v.every((_x) => Math.abs(_x - _v[0]) <= ${tol}) ? 1 : 0)(${args.map((a) => compile(a)).join(', ')})`;
  },
  // Membership of a value in an indexed collection — `Contains` with the
  // operands flipped. Same primitive-element restriction; a domain (e.g.
  // `Element(x, Integers)`) is not an indexed collection and fails closed.
  Element: (args, compile) => {
    if (args[0] == null || args[1] == null)
      throw new Error('Element: missing argument');
    requirePrimitiveElements('Element', args[1]);
    const coll = collArg('Element', args[1], compile);
    return `(${coll}).includes(${compile(args[0])})`;
  },
  Identity: (args, compile) => {
    if (args[0] == null) throw new Error('Identity: missing argument');
    return compile(args[0]);
  },
  // Apply a function literal to arguments. (`Apply` with a *symbol* head
  // canonicalizes to a direct call, so only the function-literal form
  // reaches this handler.)
  Apply: (args, compile) => {
    if (args[0] == null) throw new Error('Apply: missing function');
    return `(${compile(args[0])})(${args
      .slice(1)
      .map((a) => compile(a))
      .join(', ')})`;
  },
  // --- Linear algebra ------------------------------------------------------
  // `Dot` and `MatrixMultiply` share the interpreter's dimensionality
  // dispatch: vector·vector → scalar, matrix·vector / vector·matrix →
  // vector, matrix·matrix → matrix. Dimension mismatches yield NaN.
  Dot: (args, compile) => {
    if (args[0] == null || args[1] == null)
      throw new Error('Dot: missing argument');
    return `_SYS.matmul(${collArg('Dot', args[0], compile, 1)}, ${collArg('Dot', args[1], compile, 2)})`;
  },
  MatrixMultiply: (args, compile) => {
    if (args[0] == null || args[1] == null)
      throw new Error('MatrixMultiply: missing argument');
    return `_SYS.matmul(${collArg('MatrixMultiply', args[0], compile, 1)}, ${collArg('MatrixMultiply', args[1], compile, 2)})`;
  },
  Cross: (args, compile) => {
    if (args[0] == null || args[1] == null)
      throw new Error('Cross: missing argument');
    return `_SYS.cross(${collArg('Cross', args[0], compile, 1)}, ${collArg('Cross', args[1], compile, 2)})`;
  },
  // Norm accepts a scalar (absolute value) or a collection: 2-norm /
  // Frobenius by default, vector p-norm or matrix 1-/∞-operator norm with a
  // numeric second operand (`"Frobenius"` is the default; any other named
  // norm fails closed).
  Norm: (args, compile) => {
    if (args[0] == null) throw new Error('Norm: missing argument');
    if (args[1] != null) {
      if (isString(args[1])) {
        if (args[1].string === 'Frobenius')
          return `_SYS.norm(${compile(args[0])})`;
        throw new Error(
          `Norm: the "${args[1].string}" norm does not compile. ` +
            `Fail closed (D6).`
        );
      }
      return `_SYS.norm(${compile(args[0])}, ${compile(args[1])})`;
    }
    return `_SYS.norm(${compile(args[0])})`;
  },
  // Explicit axis operands (rank > 2 tensor forms) do not compile.
  Transpose: (args, compile) => {
    if (args.length > 1)
      throw new Error(
        `Transpose: explicit axes do not compile. Fail closed (D6).`
      );
    return `_SYS.transpose(${collArg('Transpose', args[0], compile)})`;
  },
  Determinant: (args, compile) =>
    `_SYS.det(${collArg('Determinant', args[0], compile)})`,
  // A singular matrix yields NaN (the interpreter stays inert — no numeric
  // equivalent on a real target).
  Inverse: (args, compile) =>
    `_SYS.inv(${collArg('Inverse', args[0], compile)})`,
  Trace: (args, compile) => {
    if (args.length > 1)
      throw new Error(`Trace: explicit axes do not compile. Fail closed (D6).`);
    return `_SYS.trace(${collArg('Trace', args[0], compile)})`;
  },
  Shape: (args, compile) => {
    if (args[0] == null) throw new Error('Shape: missing argument');
    return `_SYS.shape(${compile(args[0])})`;
  },
  // Flatten to a flat list (native `.flat`), or by an explicit number of
  // levels when a depth operand is given.
  Flatten: (args, compile) => {
    const coll = collArg('Flatten', args[0], compile);
    if (args[1] != null) return `(${coll}).flat(${compile(args[1])})`;
    return `(${coll}).flat(Infinity)`;
  },
  // Reshape with cyclic padding, matching the interpreter. Only the 1-D and
  // 2-D target shapes compile.
  Reshape: (args, compile) => {
    const coll = collArg('Reshape', args[0], compile);
    const dims = args[1];
    if (dims == null) throw new Error('Reshape: missing shape');
    if (!isFunction(dims) || dims.ops.length === 0 || dims.ops.length > 2)
      throw new Error(
        `Reshape: only a 1-D or 2-D target shape compiles. Fail closed (D6).`
      );
    return `_SYS.reshape(${coll}, [${dims.ops.map((d) => compile(d)).join(', ')}])`;
  },
  Log: (args, compile) => {
    if (args.length === 1) return `Math.log10(${compile(args[0])})`;
    return `(Math.log(${compile(args[0])}) / Math.log(${compile(args[1])}))`;
  },
  GammaLn: '_SYS.lngamma',
  Lb: 'Math.log2',
  // Element-wise binary max/min and clamp. These are the scalar codegen; a
  // collection operand is handled by `tryCompileBroadcast` (they are
  // `broadcastable`), which wraps this body in `_SYS.bcast`.
  ElementMax: (args, compile) =>
    `Math.max(${args.map((x) => compile(x)).join(', ')})`,
  ElementMin: (args, compile) =>
    `Math.min(${args.map((x) => compile(x)).join(', ')})`,
  Clamp: (args, compile) =>
    `Math.min(Math.max(${compile(args[0])}, ${compile(args[1])}), ${compile(
      args[2]
    )})`,
  Max: (args, compile) => compileExtremum('Max', args, compile),
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
  Min: (args, compile) => compileExtremum('Min', args, compile),
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
    if (args[2] === undefined || args[2] === null) {
      // No explicit step: like the interpreter, the range auto-descends when
      // stop < start (`Range(5, 1)` → [5,4,3,2,1]); the implicit step is
      // ±1, never a fixed +1 (which silently compiled a descending range
      // to []).
      const fStop = parseFloat(stop);
      const fStart = parseFloat(start);

      // `parseFloat` returns NaN (never null) for symbolic bounds, so a
      // `!== null` guard would always pass and emit `Array.from({length: NaN})`
      // — silently yielding `[]` for any symbolic Range. Test for numeric
      // constants with `!isNaN`; symbolic bounds fall through to the runtime
      // length branch below.
      if (!isNaN(fStop) && !isNaN(fStart)) {
        const dir = fStop >= fStart ? 1 : -1;
        const len = Math.floor(Math.abs(fStop - fStart)) + 1;
        if (len < 50) {
          return `[${Array.from({ length: len }, (_, i) => fStart + dir * i).join(', ')}]`;
        }
        return `Array.from({length: ${len}}, (_e, i) => ${start} ${dir === 1 ? '+' : '-'} i)`;
      }

      // Symbolic bounds — the direction is resolved at runtime. The map
      // callback's throwaway element parameter must not be named `_`: the
      // compiled function binds its argument object to `_`, and a symbolic
      // bound compiles to a member access like `_.a`. A `_` callback param
      // would shadow the argument object, so `_.a` in the body would read
      // from the (undefined) array element. Use `_e` for the unused element.
      return `((_a, _b) => Array.from({length: Math.floor(Math.abs(_b - _a)) + 1}, (_e, _i) => _b >= _a ? _a + _i : _a - _i))(${start}, ${stop})`;
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
  Random: (args, compile, target) => {
    // Bake path: when the engine has a random seed set at compile time, each
    // Random node compiles to a deterministic uniform derived from the seed
    // and the node's position, so every call of the compiled function returns
    // the same value for that call site (document-level "one draw per render").
    const seed = target?.randomSeed;
    const isRealSeedOverload =
      args.length === 1 && !BaseCompiler.isIntegerValued(args[0]);
    if (seed !== undefined && seed !== null && !isRealSeedOverload) {
      const idx = target?.randomState ? target.randomState.counter++ : 0;
      // Decorrelate per node: mix the seed with the node index, then draw one
      // mulberry32 value. Two different Random nodes get different constants;
      // the same expression + seed reproduces them.
      const u = mulberry32((seed ^ Math.imul(idx + 1, 0x9e3779b1)) >>> 0)();
      if (args.length === 0) return u.toString();
      if (args.length === 2) {
        // Random(m, n): integer in [m, n), argument-dependent but call-site
        // stable (the uniform `u` is baked).
        const m = compile(args[0]);
        const n = compile(args[1]);
        return `((${m}) + Math.floor(${u} * ((${n}) - (${m}))))`;
      }
      // Random(n): integer in [0, n) — the uniform `u` is baked.
      return `Math.floor(${u} * (${compile(args[0])}))`;
    }

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
    // The interpreter rounds half away from zero (Round(-2.5) = -3); JS
    // `Math.round` rounds half toward +∞ (Round(-2.5) = -2). Reconstruct
    // half-away as `sign(x)·round(|x|)`.
    if (args.length < 2) {
      if (BaseCompiler.isIntegerValued(args[0])) return compile(args[0]);
      return BaseCompiler.inlineExpression(
        '(Math.sign(${x}) * Math.round(Math.abs(${x})))',
        compile(args[0])
      );
    }
    // Round(x, n) = Round(x·10ⁿ)/10ⁿ — round to `n` decimal places
    // (Desmos/spreadsheet form). Bind both operands once.
    const xv = BaseCompiler.tempVar();
    const fv = BaseCompiler.tempVar();
    return (
      `(() => { const ${fv} = Math.pow(10, ${compile(args[1])}); ` +
      `const ${xv} = ${compile(args[0])} * ${fv}; ` +
      `return (Math.sign(${xv}) * Math.round(Math.abs(${xv}))) / ${fv}; })()`
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
  PointX: (args, compile) => compilePointComponent(args[0], 0, compile),
  PointY: (args, compile) => compilePointComponent(args[0], 1, compile),
  PointZ: (args, compile) => compilePointComponent(args[0], 2, compile),
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

/** A compiled numeric value: a scalar, a complex `{re,im}`, or a (possibly
 * nested) array of these. */
type BcastValue = number | { re: number; im: number } | BcastValue[];

/**
 * Element-wise broadcast of a scalar function `f` over its arguments (the
 * runtime side of the compile target's list broadcasting — see
 * `tryCompileBroadcast`). Any array argument makes the result an array; the
 * broadcast length is the shortest participating array (matching the
 * interpreter's `broadcastOverIndexedCollections`), a scalar argument is reused
 * for every element, and nested arrays recurse. When no argument is an array,
 * `f` is applied directly. `f` therefore only ever sees scalar (or complex)
 * operands.
 */
function bcast(
  f: (...xs: BcastValue[]) => BcastValue,
  ...args: BcastValue[]
): BcastValue {
  let n = -1;
  for (const a of args)
    if (Array.isArray(a)) n = n < 0 ? a.length : Math.min(n, a.length);
  if (n < 0) return f(...args);
  const out: BcastValue[] = new Array(n);
  for (let i = 0; i < n; i++)
    out[i] = bcast(f, ...args.map((a) => (Array.isArray(a) ? a[i] : a)));
  return out;
}

/**
 * Runtime helpers injected as `_SYS` into compiled JavaScript functions.
 * Shared by both ComputeEngineFunction and ComputeEngineFunctionLiteral.
 */
const SYS_HELPERS = {
  bcast,
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
  // Unbiased Fisher–Yates shuffle on a copy. With a seed (baked at compile
  // time when the engine's `randomSeed` is set), the permutation is
  // deterministic and reproducible across calls, matching the engine-level
  // determinism contract that `Random` honors.
  shuffle: (xs: unknown[], seed?: number): unknown[] => {
    const rnd = seed === undefined ? Math.random : mulberry32(seed >>> 0);
    const l = xs.slice();
    for (let i = l.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [l[i], l[j]] = [l[j], l[i]];
    }
    return l;
  },
  // --- Linear algebra (real, nested-array representation) ----------------
  // Dimension mismatches yield NaN (the interpreter's error/inert result
  // projected onto a real target).
  //
  // Product dispatch on dimensionality, mirroring the interpreter's
  // `Dot`/`MatrixMultiply`: vector·vector → scalar, matrix·vector → vector,
  // vector·matrix → vector, matrix·matrix → matrix.
  matmul: (a: any, b: any): any => {
    const aM = Array.isArray(a?.[0]);
    const bM = Array.isArray(b?.[0]);
    if (!aM && !bM) {
      if (a.length !== b.length) return NaN;
      let s = 0;
      for (let i = 0; i < a.length; i++) s += a[i] * b[i];
      return s;
    }
    if (aM && !bM)
      return a.map((row: number[]) =>
        row.length === b.length
          ? row.reduce((s: number, v: number, i: number) => s + v * b[i], 0)
          : NaN
      );
    if (!aM && bM) {
      if (a.length !== b.length) return NaN;
      const n = b[0].length;
      const out = new Array(n).fill(0);
      for (let i = 0; i < a.length; i++)
        for (let j = 0; j < n; j++) out[j] += a[i] * b[i][j];
      return out;
    }
    const m = a.length;
    const k = a[0].length;
    if (b.length !== k) return NaN;
    const n = b[0].length;
    const out: number[][] = [];
    for (let i = 0; i < m; i++) {
      const row = new Array(n).fill(0);
      for (let p = 0; p < k; p++) {
        const v = a[i][p];
        for (let j = 0; j < n; j++) row[j] += v * b[p][j];
      }
      out.push(row);
    }
    return out;
  },
  cross: (a: number[], b: number[]): number[] | number =>
    a.length === 3 && b.length === 3
      ? [
          a[1] * b[2] - a[2] * b[1],
          a[2] * b[0] - a[0] * b[2],
          a[0] * b[1] - a[1] * b[0],
        ]
      : NaN,
  // Norm: |x| for a scalar; the 2-norm (Frobenius for a matrix) by default.
  // With an explicit p: for a vector the p-norm (Σ|xᵢ|^p)^(1/p), p =
  // Infinity → max |xᵢ|; for a matrix the operator norms the interpreter
  // implements — p = 1 → max column abs sum, p = Infinity → max row abs
  // sum. Other matrix p-norms (e.g. the spectral 2-norm, which needs an
  // SVD) yield NaN.
  norm: (x: unknown, p?: number): number => {
    if (typeof x === 'number') return Math.abs(x);
    if (!Array.isArray(x)) return NaN;
    if (Array.isArray(x[0]) && p !== undefined) {
      const m = x as number[][];
      if (p === 1) {
        let best = 0;
        for (let j = 0; j < m[0].length; j++) {
          let s = 0;
          for (let i = 0; i < m.length; i++) s += Math.abs(m[i][j]);
          best = Math.max(best, s);
        }
        return best;
      }
      if (p === Infinity) {
        let best = 0;
        for (const row of m) {
          let s = 0;
          for (const v of row) s += Math.abs(v);
          best = Math.max(best, s);
        }
        return best;
      }
      return NaN;
    }
    const flat = x.flat(Infinity) as number[];
    if (p === Infinity) {
      let m = 0;
      for (const v of flat) m = Math.max(m, Math.abs(v));
      return m;
    }
    if (p === undefined || p === 2) {
      let s = 0;
      for (const v of flat) s += v * v;
      return Math.sqrt(s);
    }
    let s = 0;
    for (const v of flat) s += Math.pow(Math.abs(v), p);
    return Math.pow(s, 1 / p);
  },
  // Transpose of a 2D matrix; a vector (or scalar) is returned unchanged,
  // like the interpreter.
  transpose: (m: any): any => {
    if (!Array.isArray(m) || !Array.isArray(m[0])) return m;
    return m[0].map((_: unknown, j: number) =>
      m.map((row: number[]) => row[j])
    );
  },
  // Determinant by Gaussian elimination with partial pivoting; a non-square
  // input yields NaN.
  det: (m: number[][]): number => {
    const n = m?.length;
    if (!n || m.some((row) => !Array.isArray(row) || row.length !== n))
      return NaN;
    const a = m.map((row) => row.slice());
    let d = 1;
    for (let i = 0; i < n; i++) {
      let piv = i;
      for (let r = i + 1; r < n; r++)
        if (Math.abs(a[r][i]) > Math.abs(a[piv][i])) piv = r;
      if (a[piv][i] === 0) return 0;
      if (piv !== i) {
        [a[i], a[piv]] = [a[piv], a[i]];
        d = -d;
      }
      d *= a[i][i];
      for (let r = i + 1; r < n; r++) {
        const f = a[r][i] / a[i][i];
        for (let c = i; c < n; c++) a[r][c] -= f * a[i][c];
      }
    }
    return d;
  },
  // Inverse by Gauss–Jordan with partial pivoting; a non-square or singular
  // input yields NaN (the interpreter stays inert for a singular matrix).
  inv: (m: number[][]): number[][] | number => {
    const n = m?.length;
    if (!n || m.some((row) => !Array.isArray(row) || row.length !== n))
      return NaN;
    const a = m.map((row, i) => [
      ...row,
      ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
    ]);
    for (let i = 0; i < n; i++) {
      let piv = i;
      for (let r = i + 1; r < n; r++)
        if (Math.abs(a[r][i]) > Math.abs(a[piv][i])) piv = r;
      if (a[piv][i] === 0) return NaN;
      if (piv !== i) [a[i], a[piv]] = [a[piv], a[i]];
      const f = a[i][i];
      for (let c = 0; c < 2 * n; c++) a[i][c] /= f;
      for (let r = 0; r < n; r++) {
        if (r === i) continue;
        const g = a[r][i];
        if (g === 0) continue;
        for (let c = 0; c < 2 * n; c++) a[r][c] -= g * a[i][c];
      }
    }
    return a.map((row) => row.slice(n));
  },
  trace: (m: number[][]): number => {
    if (!Array.isArray(m) || !Array.isArray(m[0])) return NaN;
    let s = 0;
    for (let i = 0; i < Math.min(m.length, m[0].length); i++) {
      // A rank > 2 tensor has array diagonal entries — adding one would
      // string-concatenate. Only a numeric diagonal sums; anything else is
      // NaN.
      if (typeof m[i][i] !== 'number') return NaN;
      s += m[i][i];
    }
    return s;
  },
  // Dimensions of a (regular) nested array, measured along first elements.
  shape: (x: unknown): number[] => {
    const dims: number[] = [];
    let cur = x;
    while (Array.isArray(cur)) {
      dims.push(cur.length);
      cur = cur[0];
    }
    return dims;
  },
  // Reshape with cyclic padding (Mathematica-style, matching the
  // interpreter): the source is flattened, then elements fill the new shape,
  // wrapping around when the source is shorter. 1-D and 2-D shapes.
  reshape: (x: unknown[], dims: number[]): unknown => {
    const flat = x.flat(Infinity);
    if (flat.length === 0) return NaN;
    const at = (i: number) => flat[i % flat.length];
    if (dims.length === 1)
      return Array.from({ length: Math.max(0, dims[0]) }, (_, i) => at(i));
    if (dims.length === 2)
      return Array.from({ length: Math.max(0, dims[0]) }, (_, i) =>
        Array.from({ length: Math.max(0, dims[1]) }, (_, j) =>
          at(i * dims[1] + j)
        )
      );
    return NaN;
  },
  // Positional access for compiled `At`. CE `At` is 1-based; a negative index
  // counts from the end. A zero or out-of-range index yields NaN (the
  // interpreter returns `Nothing`, projected to NaN on a real target).
  at: (arr: unknown, i: number): number => {
    if (!Array.isArray(arr)) return NaN;
    const n = arr.length;
    const idx = i > 0 ? i - 1 : n + i;
    if (i === 0 || idx < 0 || idx >= n) return NaN;
    return arr[idx] as number;
  },
  // Definite integral via deterministic adaptive Gauss–Kronrod (GK15) — near
  // machine precision on smooth integrands, µs-scale. On non-convergence
  // (pathological integrand), fall back to the Monte-Carlo estimator. See
  // `compileIntegrate`.
  integrate: (f: (x: number) => number, a: number, b: number) => {
    const r = adaptiveQuadrature(f, a, b);
    if (r.converged) return r.estimate;
    return monteCarloEstimate(f, a, b, 10e6).estimate;
  },
  // Definite integral via Monte-Carlo (1e7 uniform samples). STOCHASTIC and
  // approximate (~1e-4 typical error, ~200 ms/call). Emitted when
  // `quadrature: 'monte-carlo'` is requested — see `compileIntegrate`.
  integrateMC: (f: (x: number) => number, a: number, b: number) =>
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

  constructor(body: string, args: string[], preamble = '') {
    super(
      '_SYS',
      ...args,
      preamble ? `${preamble}return ${body}` : `return ${body}`
    );
    return new Proxy(this, {
      apply: (target, thisArg, argumentsList) =>
        super.apply(thisArg, [this.SYS, ...argumentsList]),
      get: (target, prop) => {
        if (prop === 'toString')
          return (): string =>
            preamble
              ? `(${args.join(', ')}) => { ${preamble}return ${body}; }`
              : `(${args.join(', ')}) => ${body}`;
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
    try {
      return this.compileOrThrow(expr, options);
    } catch (e) {
      // By default a failure throws (the low-level contract). When the caller
      // opts in with `fallback: true`, surface the documented `success: false`
      // shape with an interpreter-backed `run` instead of throwing.
      if (options.fallback !== true) throw e;
      const error = (e as Error).message;
      console.warn(
        `Compilation fallback for "${expr.operator}" (target: javascript): ${error}`
      );
      return BaseCompiler.buildInterpreterFallback(
        expr,
        error,
        'javascript',
        this.createTarget(),
        options.vars ? new Set(Object.keys(options.vars)) : undefined
      );
    }
  }

  private compileOrThrow(
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
      iterationBudget,
      quadrature,
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
      iterationBudget,
      quadrature,
      varsKeys: vars ? new Set(Object.keys(vars)) : undefined,
      // When the engine has a random seed set, bake Random nodes to
      // deterministic, call-site-stable constants (see the `Random` handler).
      randomSeed: expr.engine._randomNumericSeed(),
      randomState: { counter: 0 },
      // Opt in to compiling calls to user-defined function literals (`f(x) :=
      // …`) as named local functions collected into the preamble.
      userFunctions: { defs: new Map(), compiling: new Set() },
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
    const params = args
      .slice(1)
      .map((x) => functionLiteralParameterName(x) || '_');
    const body = BaseCompiler.compile(args[0].canonical, {
      ...target,
      var: (id) => (params.includes(id) ? id : target.var(id)),
      boundVars: BaseCompiler.withBoundNames(target, params),
    });
    // A lambda body may call user-defined functions (`t ↦ f(t)`); emit their
    // definitions as a preamble inside the lambda's own body.
    const userDefs = BaseCompiler.userFunctionsPreamble(target);
    const fn = new ComputeEngineFunctionLiteral(body, params, userDefs);
    const result = {
      target: 'javascript' as const,
      success: true,
      code: userDefs
        ? `(${params.join(', ')}) => { ${userDefs}return ${body}; }`
        : `(${params.join(', ')}) => ${body}`,
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
  // Collect any user-defined function definitions accumulated while compiling
  // `expr` (a symbol with a `Function`-literal definition used as an operator)
  // and prepend them to the preamble so their named local functions are in
  // scope for the compiled body.
  const userDefs = BaseCompiler.userFunctionsPreamble(target);
  const preamble = userDefs
    ? target.preamble
      ? `${target.preamble}\n${userDefs}`
      : userDefs
    : target.preamble;
  const fn = new ComputeEngineFunction(js, preamble);
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
  if (!args[1]) {
    // Collection form: `Sum(collection)` / `Product(collection)` with no
    // indexing set — this is what `.total` (→ `Sum`) and a bare list product
    // canonicalize to. Reduce over the elements. Only an indexed collection
    // lowers to a JS array; a dictionary/string/scalar operand fails closed
    // (D6), matching `Length`/`At`/`Reduce`.
    if (isIndexedCollectionOperand(args[0]))
      return emitCollectionReduce(kind, args[0], target);
    throw new Error(`${kind}: no indexing set`);
  }
  return emitSumProduct(kind, args[0], args.slice(1), target);
}

/**
 * Compile a collection operand, failing closed (D6) if it is not an indexed
 * collection (list/vector/range) — shared by the list-shaped collection
 * operators. `position` labels the operand in the error (e.g. for `Join`).
 */
function collArg(
  kind: string,
  arg: Expression | undefined,
  compile: (expr: Expression) => string,
  position?: number
): string {
  if (!arg || !isIndexedCollectionOperand(arg))
    throw new Error(
      `${kind}: ${position !== undefined ? `operand ${position}` : 'operand'} ` +
        `is not an indexed collection (list/vector/range). Fail closed (D6).`
    );
  return compile(arg);
}

/**
 * The built-in `Reduce`/`Scan` combiners: the four associative folds that
 * compile without an initial value (their seedless native fold agrees with
 * the interpreter).
 */
function builtinCombiner(op: Expression): string | undefined {
  if (!isSymbol(op)) return undefined;
  switch (op.symbol) {
    case 'Add':
      return '(_a, _b) => _a + _b';
    case 'Multiply':
      return '(_a, _b) => _a * _b';
    case 'Min':
      return '(_a, _b) => Math.min(_a, _b)';
    case 'Max':
      return '(_a, _b) => Math.max(_a, _b)';
  }
  return undefined;
}

/**
 * Compile a custom `Reduce`/`Scan` combiner, or `undefined` if it is not
 * admissible. Only accept a combiner that is structurally callable AND
 * binary: a `Function` literal or a function-valued symbol whose arity is
 * exactly 2 (arity is statically knowable — `nops − 1` params — so a
 * unary/ternary combiner fails closed at compile time rather than silently
 * dropping or fabricating an argument at runtime, where the interpreter
 * raises an arity error); or an operator symbol, which lowers to a binary
 * lambda only for the binary arithmetic operators (enforced in
 * `BaseCompiler.compile`, which fails closed for unary/relational/logical
 * operator symbols). A value-bound or dangling symbol fails closed too.
 *
 * The result is wrapped to a fixed binary arity: native `reduce`/`map` pass
 * extra arguments (index, array) that must not leak into the combiner's
 * parameters (the interpreter passes exactly `(acc, x)`), and hoisted so it
 * is instantiated once.
 */
function customCombiner(
  op: Expression,
  compile: (e: Expression) => string,
  target: CompileTarget<Expression>
): string | undefined {
  let callable = false;
  if (isFunction(op, 'Function')) {
    callable = op.nops - 1 === 2;
  } else if (isSymbol(op)) {
    const literal = BaseCompiler.userFunctionLiteral(op.engine, op.symbol);
    if (literal !== undefined) callable = literal.nops - 1 === 2;
    else callable = target.operators?.(op.symbol) !== undefined;
  }
  if (!callable) return undefined;
  return `((_f) => (_a, _b) => _f(_a, _b))(${compile(op)})`;
}

/**
 * Fail closed (D6) unless the collection's elements compile to JS primitives
 * with value equality. `includes`/`Set` use SameValueZero, which is reference
 * identity for compound elements (nested lists compile to arrays, tuples and
 * complex numbers to objects), diverging from the interpreter's structural
 * equality. Structural element types (tuple/list/vector) and declared-complex
 * element types are rejected by the type check; a numeric collection reports
 * the generic `number` element type whether its elements are real or complex,
 * so complex *content* is caught by `isComplexValued` (which inspects literal
 * operands).
 */
export function requirePrimitiveElements(kind: string, arg: Expression): void {
  const elt = collectionElementType(arg.type.type);
  const primitive =
    elt !== undefined &&
    (elt === 'number' ||
      isSubtype(elt, 'real') ||
      isSubtype(elt, 'boolean') ||
      isSubtype(elt, 'string'));
  if (primitive && !BaseCompiler.isComplexValued(arg)) return;
  throw new Error(
    `${kind}: cannot compile — the interpreter compares elements ` +
      `structurally, but only real/boolean/string elements compare by ` +
      `value on the JavaScript target. Fail closed (D6).`
  );
}

/**
 * Compile `Max`/`Min`. Two shapes:
 *   - a single indexed-collection operand (`[3,4,5].max`, `Max(range)`) reduces
 *     over the elements. A reduce (not `Math.max(...spread)`) is used so a large
 *     list can't overflow the call-stack argument limit. The identity seed
 *     (`-Infinity`/`Infinity`) makes the empty collection agree with the
 *     interpreter (`Max([]) = -oo`, `Min([]) = +oo`).
 *   - the scalar variadic form (`Max(a, b, c)`) lowers to `Math.max(a, b, c)`.
 * A non-collection single operand takes the variadic path (`Math.max(x)` = x).
 */
function compileExtremum(
  kind: 'Max' | 'Min',
  args: ReadonlyArray<Expression>,
  compile: (expr: Expression) => string
): string {
  const fn = kind === 'Max' ? 'Math.max' : 'Math.min';
  const identity = kind === 'Max' ? '-Infinity' : 'Infinity';
  if (args.length === 1 && args[0] && isIndexedCollectionOperand(args[0])) {
    return `(${compile(args[0])}).reduce((_a, _b) => ${fn}(_a, _b), ${identity})`;
  }
  // Mixed scalars + collection operand(s): `Max`/`Min` REDUCE — fold the
  // scalars and every collection's elements into a single scalar (matching
  // `evaluateMinMax`, which flattens collection operands). Spreading a
  // collection into a plain `Math.max(...)` call would pass an array as one
  // argument → `NaN`; instead spread each collection into a combined array and
  // reduce it.
  if (args.some((a) => a && isIndexedCollectionOperand(a))) {
    const parts = args.map((a) =>
      isIndexedCollectionOperand(a) ? `...(${compile(a)})` : compile(a)
    );
    return `[${parts.join(', ')}].reduce((_a, _b) => ${fn}(_a, _b), ${identity})`;
  }
  return `${fn}(${args.map((x) => compile(x)).join(', ')})`;
}

/**
 * Compile `GCD`/`LCM`. The runtime helpers `_SYS.gcd`/`_SYS.lcm` are BINARY
 * (with a third `eps` tolerance argument), so the operands are folded PAIRWISE
 * — a variadic `_SYS.gcd(a, b, c)` would silently pass the third operand `c` as
 * the tolerance (finding A1).
 *
 * Shapes handled, matching `evaluateGcdLcm` (which flattens collection operands
 * and folds pairwise):
 *   - scalar variadic (`GCD(a, b, c)`) and list/mixed operands
 *     (`GCD([a, b], c)`) are combined into a single array — each indexed
 *     collection is spread, each scalar passed through — and reduced with the
 *     binary helper. Folding from the first element (no seed) matches the
 *     interpreter for a singleton (`LCM([2.5]) = 2.5`, not `lcm(1, 2.5)`); the
 *     empty case falls back to the identity (`GCD([]) = 0`, `LCM([]) = 1`).
 *   - an operand that is a collection but NOT an indexed collection
 *     (dictionary / string / set) has no array lowering, so fail closed (D6)
 *     rather than emit code that silently NaNs (finding A3).
 */
function compileGcdLcm(
  kind: 'GCD' | 'LCM',
  args: ReadonlyArray<Expression>,
  compile: (expr: Expression) => string
): string {
  const helper = kind === 'GCD' ? '_SYS.gcd' : '_SYS.lcm';
  const identity = kind === 'GCD' ? '0' : '1';
  const parts = args.map((a) => {
    if (isIndexedCollectionOperand(a)) return `...(${compile(a)})`;
    if (a.isCollection || a.type.matches('collection'))
      throw new Error(
        `${kind}: cannot compile — operand is a collection but not an indexed ` +
          `collection (list/vector/range). Fail closed (D6).`
      );
    return compile(a);
  });
  return `((_a) => _a.length ? _a.reduce((_x, _y) => ${helper}(_x, _y)) : ${identity})([${parts.join(
    ', '
  )}])`;
}

/**
 * Compile the collection form of `Sum`/`Product` — a reduce over the elements
 * of an indexed collection (e.g. `[3,4,5].total` → `Sum([3,4,5])`). The
 * identity seed (`0` for Sum, `1` for Product) makes the empty collection agree
 * with the interpreter (`Sum([]) = 0`, `Product([]) = 1`). Real-valued reduce,
 * consistent with the `Reduce` handler (complex-element folds are not lowered).
 */
function emitCollectionReduce(
  kind: 'Sum' | 'Product',
  coll: Expression,
  target: CompileTarget<Expression>
): string {
  const code = BaseCompiler.compile(coll, target);
  const op = kind === 'Sum' ? '+' : '*';
  const identity = kind === 'Sum' ? '0' : '1';
  return `(${code}).reduce((_a, _b) => _a ${op} _b, ${identity})`;
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
          boundVars: BaseCompiler.withBoundNames(target, [index]),
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
    boundVars: BaseCompiler.withBoundNames(target, [index]),
  });

  const acc = BaseCompiler.tempVar();

  // Iteration-budget guard (see CompileTarget.iterationBudget): a trip count
  // over the budget — including infinite or NaN bounds, for which the negated
  // comparison also fails — evaluates to NaN instead of running the loop.
  // At the guard point `index` holds the lower bound, so the trip count is
  // `_upper - index + 1`.
  const budget = target.iterationBudget;
  const guardNaN = (nan: string): string =>
    budget !== undefined
      ? `if (!(_upper - ${index} < ${budget})) return ${nan}; `
      : '';

  if (bodyIsComplex) {
    const val = BaseCompiler.tempVar();
    const guard = guardNaN('{ re: NaN, im: NaN }');
    if (isSum) {
      return `(() => { let ${acc} = { re: 0, im: 0 }; let ${index} = ${lowerCode}; const _upper = ${upperCode}; ${guard}while (${index} <= _upper) { const ${val} = ${bodyCode}; ${acc} = { re: ${acc}.re + ${val}.re, im: ${acc}.im + ${val}.im }; ${index}++; } return ${acc}; })()`;
    }
    return `(() => { let ${acc} = { re: 1, im: 0 }; let ${index} = ${lowerCode}; const _upper = ${upperCode}; ${guard}while (${index} <= _upper) { const ${val} = ${bodyCode}; ${acc} = { re: ${acc}.re * ${val}.re - ${acc}.im * ${val}.im, im: ${acc}.re * ${val}.im + ${acc}.im * ${val}.re }; ${index}++; } return ${acc}; })()`;
  }

  return `(() => { let ${acc} = ${identity}; let ${index} = ${lowerCode}; const _upper = ${upperCode}; ${guardNaN('NaN')}while (${index} <= _upper) { ${acc} ${op}= ${bodyCode}; ${index}++; } return ${acc}; })()`;
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
 * Whether any operand of the integral references a `vars`-mapped symbol — one
 * the caller pinned to a runtime input. Such a symbol must not be folded, so
 * the antiderivative-first path is skipped when the integral touches one.
 */
function referencesVarsSymbol(
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): boolean {
  const keys = target.varsKeys;
  if (!keys || keys.size === 0) return false;
  for (const k of keys) if (args.some((a) => a.has(k))) return true;
  return false;
}

/**
 * Compile `Integrate(f, (x, a, b))`.
 *
 * **Antiderivative-first.** The integral is first resolved symbolically via
 * `evaluate()` (the provider/Rubi + built-in antiderivative + FTC). If it
 * closes to a form free of any residual `Integrate` — e.g. a plotted
 * `∫₀ˣ f(t) dt` whose closed form is a function of the free bound `x` — that
 * straight-line expression is compiled directly, so each sample costs ~µs
 * instead of a full quadrature. The symbolic attempt is bounded by the engine
 * deadline (`ce.timeLimit`, default 2 s), so a non-elementary integrand
 * degrades to quadrature rather than hanging. Skipped when the integral
 * references a `vars`-mapped symbol, which must survive to run time as a live
 * input (the vars contract) rather than be folded into a baked closed form.
 *
 * **Quadrature fallback.** Otherwise the compiled definite integral defaults to
 * **deterministic adaptive Gauss–Kronrod (GK15)**: near machine precision on
 * smooth integrands and µs-scale, so a compiled `Integrate` returns the same
 * value on every call. Infinite bounds are handled by a smooth variable
 * transform. Monte-Carlo survives as the automatic non-convergence fallback
 * (pathological integrands) and can be forced with the
 * `quadrature: 'monte-carlo'` option, in which case `_SYS.integrateMC` (the
 * legacy stochastic estimator, ~1e-4 error) is emitted instead.
 */
function compileIntegrate(
  args: ReadonlyArray<Expression>,
  compile: (expr: Expression) => TargetSource,
  target: CompileTarget<Expression>
): string {
  // Antiderivative-first: compile a closed form when the integral resolves to
  // one (and does not reference a `vars`-mapped symbol, which must not fold).
  if (!referencesVarsSymbol(args, target)) {
    try {
      const closed = args[0].engine._fn('Integrate', [...args]).evaluate();
      if (!closed.has('Integrate') && closed.isValid && closed.isNaN !== true)
        // Parenthesize: the closed form can be a low-precedence expression
        // (e.g. an `Add`), whereas the caller splices this handler's result as
        // an atomic operand (like the `_SYS.integrate(…)` call it replaces).
        return `(${compile(closed)})`;
    } catch {
      // Non-elementary / deadline / unlowerable head: fall through to
      // quadrature below.
    }
  }

  const { index, lowerExpr, upperExpr } = extractLimits(args[1]);

  // Unwrap a `Function(body, param)` integrand to its body, binding the
  // lambda to the function's own parameter; otherwise the integrand is a bare
  // expression in the limits' index variable.
  let lambdaVar = index;
  let bodyExpr = args[0];
  if (isFunction(args[0], 'Function')) {
    const name = functionLiteralParameterName(args[0].ops[1]);
    if (name) lambdaVar = name;
    bodyExpr = args[0].ops[0];
  }

  const f = BaseCompiler.compile(bodyExpr, {
    ...target,
    var: (id) => (id === lambdaVar ? id : target.var(id)),
    boundVars: BaseCompiler.withBoundNames(target, [lambdaVar]),
  });

  const lo = BaseCompiler.compile(lowerExpr, target);
  const hi = BaseCompiler.compile(upperExpr, target);

  const fn =
    target.quadrature === 'monte-carlo' ? '_SYS.integrateMC' : '_SYS.integrate';
  return `${fn}((${lambdaVar}) => (${f}), ${lo}, ${hi})`;
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

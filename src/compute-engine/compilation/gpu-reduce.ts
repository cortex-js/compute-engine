// Collection reduction, fixed powers, binomials, loop bounds and counters.

import type { Expression } from '../global-types.js';
import { isCallerMapped } from './cse.js';
import {
  isFunction,
  isNumber,
  isString,
} from '../boxed-expression/type-guards.js';
import { tryGetConstant, formatFloat } from './constant-folding.js';
import type { CompileTarget, CompiledFunction } from './types.js';
import { BaseCompiler, type LoopInvariantBinding } from './base-compiler.js';
import {
  gpuOperandShape,
  gpuShapeName,
  gpuTopLevelCall,
} from './gpu-shapes.js';
import {
  GPU_AGGREGATE_CONSTRUCTOR,
  GPU_OPERATORS,
  formatGPUNumber,
  gpuIdentityPassthrough,
  gpuIsAtomicEmission,
  gpuVecType,
} from './gpu-emit.js';
import { gpuOperandOnce } from './gpu-draw-order.js';
import { gpuScalarComponents } from './gpu-extrema.js';
import { gpuTypeOfValue } from './gpu-declared-types.js';

/**
 * Extract a lowercase string literal from a boxed expression, or `null`
 * if it isn't a string literal. Operators that need to switch on a
 * colorspace name at compile time use this to peek at the argument.
 */
export function readStringLiteral(expr: Expression): string | null {
  if (!isString(expr)) return null;
  return expr.string?.toLowerCase() ?? null;
}

/** Compile an expression as a GPU integer argument.
 *  Integer constants emit as plain literals (`200`); other expressions
 *  are wrapped in a cast (`int(...)` or `i32(...)`). */
export function compileIntArg(
  head: string,
  expr: Expression,
  compile: (e: Expression) => string,
  target?: CompileTarget<Expression>
): string {
  const c = tryGetConstant(expr);
  if (c !== undefined && Number.isInteger(c)) return c.toString();
  // A complex value is a `vec2`, and `int(vec2(x, y))` is not a scalar: no
  // shader compiler accepts it where an `int` is expected (for example the
  // iteration count of `_fractal_mandelbrot`).
  if (BaseCompiler.isComplexValued(expr))
    throw new Error(
      `Could not compile \`${head}\`: the integer operand \`${expr.toString()}\` is complex, and a shader ` +
        `has no conversion from a complex value to an integer.`
    );
  const intCast = target?.language === 'wgsl' ? 'i32' : 'int';
  return `${intCast}(${compile(expr)})`;
}

/** Maximum range for inline unrolling of Sum/Product loops in GPU targets. */
export const GPU_UNROLL_LIMIT = 100;

/**
 * Fail closed on a Sum/Product bound that is statically non-finite (a
 * `±∞`/`NaN` literal, or an expression typed `infinity` or `nan`), so
 * `compile()` reports failure and the caller falls back to the interpreter.
 * `for (int i = 1; i <= _gpu_inf(); i++)` has no terminating condition (and is
 * a shader type error besides), so such a bound must never be emitted. Mirrors
 * `assertFiniteBound` in the JavaScript target.
 */
export function assertFiniteGPUBound(
  kind: 'Sum' | 'Product',
  expr: Expression,
  which: 'lower' | 'upper'
): void {
  const nonFinite =
    (isNumber(expr) && !Number.isFinite(expr.re)) ||
    expr.type.matches('infinity') ||
    expr.type.matches('nan');
  if (!nonFinite) return;
  throw new Error(
    `Could not compile \`${kind}\`: the ${which} bound \`${expr.toString()}\` is not a finite ` +
      `number — an infinite or NaN bound has no terminating loop.`
  );
}

/**
 * Maximum absolute exponent for inlining an integer `Power` as repeated
 * multiplication (`x*x*x`), for a *simple* base only (symbol or number, so the
 * base subexpression can be safely repeated). Larger exponents — or any
 * compound base — route through the `_gpu_powi` preamble helper instead, which
 * evaluates the base once and keeps the sign correct for a negative base.
 *
 * Eight multiplications of a variable are cheaper than the helper call the
 * exponent would otherwise reach, and the helper has no unrolled arm past 4:
 * it falls back to `pow(abs(x), n)` with a sign correction, which is a
 * transcendental pair on the hardware where the unroll is plain multiplies.
 */
export const GPU_POWI_INLINE_LIMIT = 8;

/** Keep small constant powers branch-free while evaluating the base once.
 * Invalid aggregate shapes retain the general helper and its shape diagnostic. */
export function gpuFixedPower(
  code: string,
  exponent: number,
  shape: ReturnType<typeof gpuOperandShape>
): string {
  const width = typeof shape === 'number' ? shape : undefined;
  if (
    (shape === 'scalar' || width !== undefined) &&
    exponent >= 2 &&
    exponent <= 4
  )
    return `_gpu_pow${exponent}${width === undefined ? '' : `_v${width}`}(${code})`;
  return `_gpu_powi${width ?? ''}(${code}, ${formatGPUNumber(exponent)})`;
}

/** Emit only the scalar/vector specializations actually called by the source. */
export function gpuFixedPowerPreamble(code: string, isWGSL: boolean): string {
  const names = new Set<string>();
  const calls = /(?<![\w$])(_gpu_pow([234])(?:_v([234]))?)\s*\(/g;
  let result = '';
  for (const match of code.matchAll(calls)) {
    const name = match[1];
    if (names.has(name)) continue;
    names.add(name);
    const type = match[3]
      ? gpuVecType(Number(match[3]), isWGSL)
      : isWGSL
        ? 'f32'
        : 'float';
    const body =
      match[2] === '2'
        ? 'return x * x;'
        : match[2] === '3'
          ? 'return x * x * x;'
          : `${isWGSL ? 'let' : type} s = x * x; return s * s;`;
    result += isWGSL
      ? `\nfn ${name}(x: ${type}) -> ${type} { ${body} }\n`
      : `\n${type} ${name}(${type} x) { ${body} }\n`;
  }
  return result;
}

/**
 * Largest literal `k` for which `Binomial(n, k)`/`Choose(n, k)` unrolls to its
 * explicit falling-factorial product on a GPU target. Every unit of `k` adds
 * one factor — and one splice of the compiled first operand — so keep the
 * unroll short. (The interpreter's own symbolic expansion cap,
 * `SYMBOLIC_EXPANSION_CAP` in `library/combinatorics.ts`, is larger; a shader
 * expression has no statement sink for a long product, so this cap is
 * tighter and a larger `k` fails closed.)
 */
const GPU_BINOMIAL_UNROLL_LIMIT = 8;

/**
 * `Binomial(n, k)` / `Choose(n, k)` for a literal non-negative integer `k`,
 * as the GENERALIZED binomial coefficient — the falling factorial
 * `n(n-1)…(n-k+1) / k!`. This is the same closed form the interpreter expands
 * to for a symbolic first operand (`Binomial(x, 2)` → `(x·(x-1))/2`), and it
 * agrees with the interpreter's numeric answers for a real or negative `n`
 * too (`Binomial(5.5, 2)` = 12.375, `Binomial(-1, 2)` = 1) — unlike the JS
 * target's `_SYS.binomial`, a Pascal-triangle table that is integer-only.
 *
 * Anything else declines (D6): a non-literal, negative or non-integer `k` is
 * inert in the interpreter, and a complex-valued `n` has no `vec2` lowering
 * here (the interpreter stays symbolic for it as well).
 */
export const gpuBinomial: CompiledFunction<Expression> = (
  [n, k],
  compile,
  target
) => {
  if (n === null || n === undefined || k === null || k === undefined)
    throw new Error('Could not compile `Binomial`: need two arguments');
  const kConst = tryGetConstant(k);
  if (kConst === undefined || !Number.isInteger(kConst) || kConst < 0)
    throw new Error(
      `Could not compile \`Binomial\`: only a literal non-negative integer second operand ` +
        `compiles — anything else is inert in the interpreter.`
    );
  if (kConst > GPU_BINOMIAL_UNROLL_LIMIT)
    throw new Error(
      `Could not compile \`Binomial\`: a second operand above ${GPU_BINOMIAL_UNROLL_LIMIT} would ` +
        `unroll to ${kConst} factors.`
    );
  if (BaseCompiler.isComplexValued(n))
    throw new Error(
      `Could not compile \`Binomial\`: a complex first operand has no GPU lowering.`
    );
  // A statically non-finite first operand declines. The interpreter answers
  // every infinite point from its own limit table — `C(±∞, 0) = 1`,
  // `C(+∞, k) = +∞`, `C(−∞, k) = (−1)^k·∞`, `C(~oo, k) = ~oo` — and NaN for a
  // NaN operand. The shader unroll cannot reproduce two of those: `~oo` has
  // no float spelling, and the `k = 0 → 1` fold below would emit `1.0` where
  // a NaN operand must propagate. Check before the `k` special cases so
  // neither fold can emit a value the interpreter does not give. Only a
  // STATICALLY provable non-finite
  // operand declines: a runtime ±∞ reaching a finite-typed binding still
  // unrolls (the documented static-assert class), as no runtime finite guard
  // is emitted — that would change every pure emission.
  if (
    (isNumber(n) && !Number.isFinite(n.re)) ||
    n.type.matches('infinity') ||
    n.type.matches('nan')
  )
    throw new Error(
      `Could not compile \`Binomial\`: a statically non-finite first operand evaluates to NaN in ` +
        `the interpreter, not a falling factorial.`
    );
  if (kConst === 0) {
    // `Binomial(x, 0)` is 1 — but the interpreter still EVALUATES the first
    // operand (probed: `Binomial(Random(), 0)` consumes exactly one draw).
    // Folding the operand away would skip the draw and shift every later
    // value in the shader, and there is no sink for a discarded temporary
    // here, so an impure operand declines instead.
    if (n.isPure === false)
      throw new Error(
        `Could not compile \`Binomial\`: a second operand of 0 discards the first, but an impure ` +
          `(Random) first operand is still drawn by the interpreter.`
      );
    return formatFloat(1, target.language);
  }
  // `Binomial(n, 1)` is `n`: an identity lowering, so the operand keeps its
  // grouping in an infix parent (`gpuIdentityPassthrough`). CE-251.1.
  if (kConst === 1) return gpuIdentityPassthrough(n, compile, target);
  // The operand is spliced `k` times — bind an impure (Random-family) one to
  // a hoisted temporary; a pure one compiles directly (byte-identical).
  const c = gpuOperandOnce('Binomial', n, compile, target);
  const factors = [`(${c})`];
  for (let i = 1; i < kConst; i++)
    factors.push(`((${c}) - ${formatFloat(i, target.language)})`);
  let fact = 1;
  for (let i = 2; i <= kConst; i++) fact *= i;
  return `((${factors.join(' * ')}) / ${formatFloat(fact, target.language)})`;
};

/**
 * The base of a SQUARE — the `b` of `b²`, written either as `Power(b, 2)` or
 * as `Square(b)` — or `undefined` when the expression is not a square.
 */
function gpuSquaredBase(expr: Expression): Expression | undefined {
  if (isFunction(expr, 'Square') && expr.ops.length === 1) return expr.ops[0];
  if (
    isFunction(expr, 'Power') &&
    expr.ops.length === 2 &&
    tryGetConstant(expr.ops[1]) === 2
  )
    return expr.ops[0];
  return undefined;
}

/**
 * Compile the COLLECTION (reduce) form of `Sum`/`Product` — no indexing set,
 * the operand itself is the collection (`Sum([3, 4, 5])`, `Sum(v)` for a
 * `vector<3>`). This is what `.total` and a bare list product canonicalize to,
 * and the JavaScript target has lowered it since Tycho item 237; on a shader
 * target the fold is the same one `Max`/`Min` already perform, over the same
 * statically known scalar components (`gpuScalarComponents`).
 *
 * A shader has no dynamic iteration, so everything without a compile-time
 * component list fails closed: an unknown-length list, a matrix, and a
 * fixed-length list whose elements are not shader floats. So does a
 * statically SCALAR operand — the interpreter answers `Sum(x) = x` for one,
 * but a value that is not a collection at all reaching a reduction is a shape
 * the caller did not mean, and the JavaScript target declines it too.
 *
 * The empty collection is the identity (`Sum([]) = 0`, `Product([]) = 1`),
 * matching the interpreter. It is recognized BEFORE the operand is compiled:
 * `[]` lowers to `float[0]()` / `array<f32, 0>()`, which
 * `assertGPUScalarComponents` refuses outright, so compiling it first would
 * decline the whole reduction — the same ordering `compileGPUExtremum` uses.
 */
export function compileGPUCollectionReduce(
  kind: 'Sum' | 'Product',
  operand: Expression,
  compile: (expr: Expression) => string,
  target: CompileTarget<Expression>
): string {
  const identity = kind === 'Sum' ? '0.0' : '1.0';
  const op = kind === 'Sum' ? ' + ' : ' * ';
  if (operand.isCollection && operand.count === 0) return identity;

  // Summing the components of a SQUARED vector is that vector's dot product
  // with itself: `v.x² + v.y²` is `dot(v, v)`, one builtin in both languages
  // where the component fold writes the square out and then reads each
  // component back out of it. Only a PURE base takes this route, because the
  // emission names the vector twice — a repeated draw from an impure one
  // would shift every later value in the shader — and the width is bounded at
  // 2–4 because WGSL declares `dot` over `vecN` alone.
  //
  // The rewrite reads the square STRUCTURALLY and then compiles the base
  // alone, so it is valid only while the square head still means the builtin
  // one. A caller that supplies its own `Square`/`Power` through `functions`,
  // or excludes that head from folding, keeps the ordinary component fold,
  // which calls the caller's implementation.
  const squared = kind === 'Sum' ? gpuSquaredBase(operand) : undefined;
  const squaredWidth =
    squared === undefined ? undefined : gpuOperandShape(squared);
  if (
    squared !== undefined &&
    squared.isPure &&
    typeof squaredWidth === 'number' &&
    !BaseCompiler.isComplexValued(operand) &&
    !isCallerMapped(operand, target.cse?.harvestOptions) &&
    !target.foldExcludedOps?.has(operand.operator)
  ) {
    let v = compile(squared);
    // A bare identifier is free to name twice. Anything else is bound to a
    // hoisted `vecN` temporary where there is a statement sink, so the vector
    // is built once; with no sink the pure source is written twice, which is
    // what the operand-once convention does everywhere else in this target.
    if (!gpuIsAtomicEmission(v) && BaseCompiler.canHoist(target)) {
      const tv = BaseCompiler.tempVar(target);
      const type =
        target.language === 'wgsl'
          ? `vec${squaredWidth}f`
          : `vec${squaredWidth}`;
      const decl =
        target.language === 'wgsl' ? `var ${tv}: ${type}` : `${type} ${tv}`;
      BaseCompiler.hoistStatement(target, `${decl} = ${v};`);
      v = tv;
    }
    return `dot(${v}, ${v})`;
  }

  const shape = gpuOperandShape(operand);
  const code = compile(operand);
  // Non-scalar by the shape analysis, OR by the emitted source: a `Range`
  // types only as `indexed_collection` (no `list` dimensions), which
  // `gpuOperandShape` reads as a scalar, but it lowers to an array
  // CONSTRUCTOR — and a constructor is exactly what a reduction can consume.
  // (The same reading `compileGPUExtremum` takes of its operands.)
  //
  // A COMPLEX value is excluded from that second reading, and the exclusion is
  // load-bearing: it lowers to `vec2(re, im)`, which matches the aggregate
  // constructor pattern while being a single NUMBER in the complex convention,
  // not a two-cell collection. Without this, `Sum(i)` folded the real and
  // imaginary parts into `(0.0 + 1.0)` and answered a real `1.0` where the
  // interpreter answers `i` — a silent disagreement, not a decline. (The
  // `Max`/`Min` reduction never saw this: a real-only guard rejects a complex
  // operand of those heads before the lowering runs.)
  const call = gpuTopLevelCall(code);
  const isAggregate =
    !BaseCompiler.isComplexValued(operand) &&
    (shape !== 'scalar' ||
      (call !== undefined && GPU_AGGREGATE_CONSTRUCTOR.test(call.callee)));
  if (!isAggregate)
    throw new Error(
      `Could not compile \`${kind}\`: the operand \`${operand.toString()}\` is not a collection ` +
        `(type \`${operand.type.toString()}\`), so there is nothing to ` +
        `reduce over — this is the collection form of ${kind}, which takes ` +
        `no indexing set.`
    );

  const comps = gpuScalarComponents(operand, code, target);
  if (comps === undefined)
    throw new Error(
      `Could not compile \`${kind}\`: the operand \`${operand.toString()}\` lowers to a shader ` +
        `${gpuShapeName(shape)} with no compile-time component list, so ` +
        `there is nothing for the reduction to fold over — a shader has no ` +
        `dynamic iteration here.`
    );
  // Each component is parenthesized, and so is the fold as a whole. A
  // component is a constructor ARGUMENT compiled at its own precedence, so its
  // source can be bare infix arithmetic (`float[2](x + 1.0, y)`), and the
  // result is spliced into whatever context the caller has. Joining the raw
  // texts let a neighbouring operator bind into a component: `Sum([x + 1])`
  // returned a bare `x + 1.0`, so `2·Sum([x + 1])` emitted `2.0 * x + 1.0` —
  // `2x + 1` where the interpreter computes `2(x + 1)`. A `Product` fold
  // reassociates the same way from the inside (`(a + b) * c` written as
  // `a + b * c`).
  //
  // `gpuScalarComponents` never answers an EMPTY list (a zero-argument
  // constructor answers `undefined` there), and the empty collection already
  // returned the identity above, so one component is the smallest fold.
  return `(${comps.map((c) => `(${c})`).join(op)})`;
}

/**
 * Fold a bound only when its literal has the same exact value in binary32
 * and in host arithmetic. Keep the counter and its final increment in i32
 * range; other values retain the existing shader floor/conversion path.
 */
export function gpuBoundConstant(
  expr: Expression,
  target: CompileTarget<Expression>
): number | undefined {
  const literal = BaseCompiler.bigOpBoundConstant(expr);
  if (literal !== undefined) return literal;
  const value = BaseCompiler.foldedRealNumber(expr, target);
  if (
    value === undefined ||
    !Number.isFinite(value) ||
    Math.fround(value) !== value
  )
    return undefined;
  const bound = Math.floor(value);
  return bound >= -(2 ** 31) && bound < 2 ** 31 - 1 ? bound : undefined;
}

/**
 * Is this compiled loop bound already ONE READ at run time, so that binding it
 * to a local would cost a line and save nothing?
 *
 * True for a numeric literal, a bare identifier, and any nesting of the
 * CONVERSION and ROUNDING spellings around one of those — `K`, `int(K)`,
 * `i32(K)`, `int(floor(K))`. Those are the spellings `boundCode` produces for
 * a caller-declared parameter or a bare symbolic bound; each is a register
 * read plus at most a conversion, which every driver folds.
 *
 * False as soon as the bound holds an operator, a second argument, or any
 * other call (`int(floor(K + -1.0))`, `int(floor(_fn_g(x)))`): the loop
 * condition would otherwise re-evaluate the whole expression on every
 * iteration.
 */
const GPU_BOUND_ONE_READ_CALLS = new Set([
  'int',
  'i32',
  'u32',
  'uint',
  'float',
  'f32',
  'floor',
]);

export function gpuBoundIsOneRead(code: string): boolean {
  const s = code.trim();
  if (/^-?\d+(?:\.\d*)?$/.test(s)) return true;
  if (/^[A-Za-z_]\w*$/.test(s)) return true;
  const call = /^([A-Za-z_]\w*)\((.*)\)$/.exec(s);
  if (call === null || !GPU_BOUND_ONE_READ_CALLS.has(call[1])) return false;
  // The matched parentheses must be the call's OWN: without this check
  // `int(a) + int(b)` would read as a call whose argument is `a) + int(b`.
  const inner = call[2];
  let depth = 0;
  for (const ch of inner) {
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      if (depth === 0) return false;
      depth -= 1;
    }
  }
  return depth === 0 && gpuBoundIsOneRead(inner);
}

/**
 * The loop-invariant bindings (`BaseCompiler.hoistLoopInvariants`) that some
 * code reads, in their original order.
 *
 * A binding can be left with no reader. The pass binds each class it hoists,
 * but the lowering of a later class may fold its operand away instead of
 * reading it: in `\sum_{i=1}^{200}(i x + \min([1,2,3]))` the list literal is
 * bound as its own class, and `Min` of the list then folds to `1.0` without
 * reading the binding. The declaration of such a binding is dead code. It is
 * valid source, but it is removed here so the emitted shader declares only
 * what it reads.
 *
 * `readers` is the code that runs after the declarations (the loop body, the
 * statements the body hoisted, the unrolled terms). A binding is kept when its
 * name occurs there or in the code of a LATER binding that is kept: the
 * bindings come in dependency order, so a binding reads only earlier ones.
 * CE-258.
 */
export function gpuReadInvariants(
  invariants: ReadonlyArray<LoopInvariantBinding>,
  readers: ReadonlyArray<string>
): LoopInvariantBinding[] {
  const kept: LoopInvariantBinding[] = [];
  const read = [...readers];
  for (let i = invariants.length - 1; i >= 0; i--) {
    const [name, code] = invariants[i];
    const ref = new RegExp(`(?<![\\w$])${name}(?![\\w$])`);
    if (!read.some((c) => ref.test(c))) continue;
    kept.unshift(invariants[i]);
    read.push(code);
  }
  return kept;
}

/**
 * The declaration of one loop-invariant binding
 * (`BaseCompiler.hoistLoopInvariants`) in the shader language.
 *
 * The type is read from the NODE the binding was compiled from, not guessed
 * from its code. `gpuTypeOfValue` answers `undefined` for a value with no
 * static shader shape; such a class is refused before a binding is minted (the
 * `accept` predicate the callers pass), so it never reaches here — the
 * fallback keeps the scalar spelling rather than emit nothing.
 */
export function gpuInvariantDeclaration(
  name: string,
  code: string,
  node: Expression,
  isWGSL: boolean
): string {
  const type = gpuTypeOfValue(node, isWGSL) ?? (isWGSL ? 'f32' : 'float');
  return isWGSL
    ? `let ${name}: ${type} = ${code};`
    : `${type} ${name} = ${code};`;
}

/**
 * Compile one operand of the `Multiply` lowering so that it binds as a single
 * factor next to a ` * `.
 *
 * The `compile` callback a `CompiledFunction` handler is handed carries no
 * precedence context — it compiles every sub-expression at precedence 0 — and
 * `foldTerms` then joins the resulting strings with a bare ` * `. A factor
 * whose own emission is a looser infix form was therefore spliced raw:
 * `Multiply(Add(t, 1), Tuple(x, 0))` emitted `t + 1.0 * vec2(x, 0.0)`, which
 * the shader reads as `t + (1.0 * vec2(x, 0.0))` — the float broadcast into
 * the vector, the wrong geometry, behind `success: true`.
 *
 * Compiling the operand at the binding power of `*` instead makes the shared
 * compiler add the parentheses itself, by the same `op[1] < prec` rule the
 * infix path applies to its own operands. Everything else about the call
 * matches the callback the handler was given: with no operand index, that
 * callback is exactly `BaseCompiler.compileValueOperand(expr, target)`, and
 * the `target` a handler receives is the one the callback closes over (an
 * element-wise broadcast hands the handler the same `innerTarget` its callback
 * uses), so no CSE or binding bookkeeping is skipped by calling it directly.
 */
export function gpuMultiplicativeFactor(
  operand: Expression,
  target: CompileTarget<Expression>
): string {
  return BaseCompiler.compileValueOperand(
    operand,
    target,
    GPU_OPERATORS.Multiply[1]
  );
}

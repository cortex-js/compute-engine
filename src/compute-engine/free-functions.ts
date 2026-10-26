import type {
  Expression,
  ExpressionInput,
  AssignValue,
  SymbolDefinitionInput,
  IComputeEngine,
  FormOption,
  Scope,
  SimplifyOptions,
} from './global-types.js';
import type { Type, TypeString } from '../common/type/types.js';
import type { LatexString, ParseLatexOptions } from './latex-syntax/types.js';
import { isExpression } from './boxed-expression/type-guards.js';
import {
  expand as expandExpr,
  expandAll as expandAllExpr,
} from './boxed-expression/expand.js';
import { factorPolynomial as factorExpr } from './boxed-expression/factor.js';
import { factorNumberFieldExpressionDetailed } from './polynomial/boxed-number-field.js';
import { factorRationalExpressionDetailed } from './polynomial/boxed-factor.js';
import {
  defaultUnknown,
  reduceTransformerOperand,
} from './boxed-expression/utils.js';
import type { FactorOptions, FactorizationResult } from './factoring-types.js';
import { isValidSymbol } from '../math-json/symbols.js';
import {
  compile as compileExpr,
  type CompileExpressionOptions,
} from './compilation/compile-expression.js';
import type {
  CompilationResult,
  DefaultRunnerResult,
} from './compilation/types.js';

let _defaultEngine: IComputeEngine | null = null;
let _defaultEngineFactory: (() => IComputeEngine) | null = null;

/** @internal Called by the entry point to register a factory that creates
 *  the default engine with LatexSyntax pre-configured. */
export function _setDefaultEngineFactory(factory: () => IComputeEngine): void {
  _defaultEngineFactory = factory;
}

export function getDefaultEngine(): IComputeEngine {
  if (!_defaultEngine) {
    if (!_defaultEngineFactory)
      throw new Error(
        'ComputeEngine factory not registered. Import from the main module.'
      );
    _defaultEngine = _defaultEngineFactory();
  }
  return _defaultEngine!;
}

/** Options accepted by the free functions that take a LaTeX/AsciiMath string. */
export interface FreeFunctionOptions {
  /** When `false` (the default for the free functions), the input string is
   *  parsed with the looser AsciiMath/Typst-like syntax (bare function names,
   *  multi-letter identifiers, `**`, unbraced multi-digit scripts, …). Set to
   *  `true` to restore the strict LaTeX grammar, where, for example, `x^23` is
   *  `3x²` (two adjacent scripts) rather than `x²³`. Ignored for non-string
   *  inputs. */
  strict?: boolean;
}

/** Convert a LatexString, Expression, or ExpressionInput to a boxed Expression.
 *  Strings are parsed as LaTeX. Parsing defaults to non-strict so the free
 *  functions accept the looser AsciiMath/Typst-like syntax documented for them
 *  — bare function names and multi-letter identifiers (`sqrt(5)`, `sin(alpha)`,
 *  `alpha`), and `**` for exponentiation — in addition to canonical LaTeX.
 *  Pass `{ strict: true }` to opt back into the strict LaTeX grammar. */
function toExpression(
  input: LatexString | ExpressionInput,
  options?: FreeFunctionOptions
): Expression {
  if (typeof input === 'string') {
    const ce = getDefaultEngine();
    return (
      ce.parse(input, { strict: options?.strict ?? false }) ??
      ce.expr('Nothing')
    );
  }
  if (isExpression(input)) return input;
  return getDefaultEngine().expr(input);
}

export function parse(
  latex: LatexString,
  options?: Partial<ParseLatexOptions> & { form?: FormOption }
): Expression {
  return getDefaultEngine().parse(latex, options);
}

export function expr(
  expr: ExpressionInput,
  options?: {
    form?: FormOption;
    scope?: Scope;
  }
): Expression {
  return getDefaultEngine().expr(expr, options);
}

export function simplify(
  expr: LatexString | ExpressionInput,
  options?: Partial<SimplifyOptions> & FreeFunctionOptions
): Expression {
  return toExpression(expr, options).simplify(options);
}

export function evaluate(
  expr: LatexString | ExpressionInput,
  options?: FreeFunctionOptions
): Expression {
  return toExpression(expr, options).evaluate();
}

export function N(
  expr: LatexString | ExpressionInput,
  options?: FreeFunctionOptions
): Expression {
  return toExpression(expr, options).N();
}

// Two `(id, …)` overloads: a `Type`/type string in the same union as the
// definition shapes would stop TypeScript from typing the parameters of an
// inline `type: (ops) => …` handler (see `IComputeEngine.declare`).
export function declare(id: string, type: Type | TypeString): void;
export function declare(id: string, def: SymbolDefinitionInput): void;
export function declare(symbols: {
  [id: string]: Type | TypeString | SymbolDefinitionInput;
}): void;
export function declare(
  arg1: string | { [id: string]: Type | TypeString | SymbolDefinitionInput },
  arg2?: Type | TypeString | SymbolDefinitionInput
): void {
  getDefaultEngine().declare(arg1 as any, arg2 as any);
}

export function assign(id: string, value: AssignValue): void;
export function assign(ids: { [id: string]: AssignValue }): void;
export function assign(
  arg1: string | { [id: string]: AssignValue },
  arg2?: AssignValue
): void {
  getDefaultEngine().assign(arg1 as any, arg2 as any);
}

export function expand(
  expr: LatexString | ExpressionInput,
  options?: FreeFunctionOptions
): Expression {
  return expandExpr(toExpression(expr, options));
}

export function solve(
  expr: LatexString | ExpressionInput,
  vars?: string | Iterable<string> | Expression | Iterable<Expression>,
  options?: FreeFunctionOptions
):
  | null
  | ReadonlyArray<Expression>
  | Record<string, Expression>
  | Array<Record<string, Expression>> {
  return toExpression(expr, options).solve(vars);
}

export function expandAll(
  expr: LatexString | ExpressionInput,
  options?: FreeFunctionOptions
): Expression {
  return expandAllExpr(toExpression(expr, options));
}

/** Factor an expression, optionally in a variable and an explicit number field. */
export function factor(
  expr: LatexString | ExpressionInput,
  options?: FactorOptions
): Expression {
  validateFactorOptions(options);
  const target = toExpression(expr, options);
  if (
    options &&
    Object.keys(options).some((k) => k.startsWith('max') || k === 'profile')
  )
    return factorDetailed(target, options).expression;
  if (options?.variable !== undefined) {
    const ce = target.engine;
    const ops = [target, ce.symbol(options.variable)];
    if (options.generator !== undefined)
      ops.push(factorGenerator(target, options));
    return ce.function('Factor', ops).evaluate();
  }
  return factorExpr(target);
}

/**
 * Certified univariate factoring with explicit completion information.
 * Structural/multivariate heuristics are not reported as complete factorizations.
 * Uses the input expression's engine; cancellation and engine deadlines propagate.
 */
export function factorDetailed(
  expr: LatexString | ExpressionInput,
  options: FactorOptions = {}
): FactorizationResult {
  validateFactorOptions(options);
  const input = toExpression(expr, options);
  const variable =
    options.variable ??
    defaultUnknown(reduceTransformerOperand(input.canonical)) ??
    'x';
  const protect = new Set([variable]);
  const target = reduceTransformerOperand(input.canonical, protect);
  if (options.generator !== undefined) {
    const generator = reduceTransformerOperand(
      factorGenerator(input, options).canonical,
      protect
    );
    return factorNumberFieldExpressionDetailed(
      target,
      variable,
      generator,
      options
    );
  }
  return factorRationalExpressionDetailed(target, variable, options);
}

function factorGenerator(
  input: Expression,
  options: FactorOptions
): Expression {
  const ce = input.engine,
    g = options.generator!;
  return typeof g === 'string'
    ? ce.parse(g, { strict: options.strict ?? false })
    : ce.expr(isExpression(g) ? g.json : g);
}

function validateFactorOptions(options: FactorOptions = {}): void {
  if (
    options.variable !== undefined &&
    (typeof options.variable !== 'string' || !isValidSymbol(options.variable))
  )
    throw new TypeError('Factoring variable must be a nonempty symbol name');
  if (options.generator !== undefined && options.variable === undefined)
    throw new TypeError('Explicit-field factoring requires a variable');
  for (const key of [
    'maxOperations',
    'maxDegree',
    'maxCoefficientBits',
    'maxIntermediateCoefficientBits',
    'maxNormDegree',
    'maxNumberFieldPrimes',
    'maxNumberFieldLifts',
  ] as const) {
    const n = options[key];
    if (
      n !== undefined &&
      (!Number.isSafeInteger(n) || n < (key.includes('Bits') ? 1 : 0))
    )
      throw new RangeError(`Invalid factoring option: ${key}`);
  }
}

// The signature mirrors `compileExpr`'s rather than deriving from it:
// expressing the return as `ReturnType<typeof compileExpr>` would instantiate
// the generic at its constraint — `CompilationResult<string>`, losing the call
// site's target — so the `T extends ExecutableTarget` conditional never sees a
// concrete target and `run` types optional even for `javascript`. The target
// name must flow through this wrapper's own type parameter instead.
export function compile<
  T extends string = 'javascript',
  R = DefaultRunnerResult<T>,
>(
  expr: LatexString | ExpressionInput,
  options?: CompileExpressionOptions<T> & FreeFunctionOptions
): CompilationResult<T, R> {
  return compileExpr<T, R>(toExpression(expr, options), options);
}

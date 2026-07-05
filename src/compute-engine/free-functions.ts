import type {
  Expression,
  ExpressionInput,
  AssignValue,
  SymbolDefinition,
  IComputeEngine,
  FormOption,
  Scope,
  SimplifyOptions,
} from './global-types';
import type { Type, TypeString } from '../common/type/types';
import type { LatexString, ParseLatexOptions } from './latex-syntax/types';
import { isExpression } from './boxed-expression/type-guards';
import {
  expand as expandExpr,
  expandAll as expandAllExpr,
} from './boxed-expression/expand';
import { factorPolynomial as factorExpr } from './boxed-expression/factor';
import { compile as compileExpr } from './compilation/compile-expression';

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

export function declare(
  id: string,
  def: Type | TypeString | Partial<SymbolDefinition>
): void;
export function declare(symbols: {
  [id: string]: Type | TypeString | Partial<SymbolDefinition>;
}): void;
export function declare(
  arg1:
    | string
    | { [id: string]: Type | TypeString | Partial<SymbolDefinition> },
  arg2?: Type | TypeString | Partial<SymbolDefinition>
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

export function factor(
  expr: LatexString | ExpressionInput,
  options?: FreeFunctionOptions
): Expression {
  return factorExpr(toExpression(expr, options));
}

export function compile<T extends string = 'javascript'>(
  expr: LatexString | ExpressionInput,
  options?: Parameters<typeof compileExpr>[1] & { to?: T } & FreeFunctionOptions
): ReturnType<typeof compileExpr> {
  return compileExpr(toExpression(expr, options), options);
}

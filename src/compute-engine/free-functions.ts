import type {
  Expression,
  ExpressionInput,
  AssignValue,
  SymbolDefinition,
  IComputeEngine,
} from './global-types';
import type { Type, TypeString } from '../common/type/types';
import type { LatexString } from './latex-syntax/types';
import { isExpression } from './boxed-expression/type-guards';
import {
  expand as expandExpr,
  expandAll as expandAllExpr,
} from './boxed-expression/expand';
import { factor as factorExpr } from './boxed-expression/factor';
import { compile as compileExpr } from './compilation/compile-expression';

let _defaultEngine: IComputeEngine | null = null;
let _defaultEngineFactory: (() => IComputeEngine) | null = null;

/** @internal Called by the entry point to register a factory that creates
 *  the default engine with LatexSyntax pre-configured. */
export function _setDefaultEngineFactory(
  factory: () => IComputeEngine
): void {
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

/** Convert a LatexString, Expression, or ExpressionInput to a boxed Expression.
 *  Strings are treated as LaTeX and parsed. */
function toExpression(input: LatexString | ExpressionInput): Expression {
  if (typeof input === 'string') {
    const ce = getDefaultEngine();
    return ce.parse(input) ?? ce.expr('Nothing');
  }
  if (isExpression(input)) return input;
  return getDefaultEngine().expr(input);
}

export function parse(latex: LatexString): Expression {
  const ce = getDefaultEngine();
  return ce.parse(latex) ?? ce.expr('Nothing');
}

export function expr(expr: ExpressionInput): Expression {
  return getDefaultEngine().expr(expr);
}

export function simplify(expr: LatexString | ExpressionInput): Expression {
  return toExpression(expr).simplify();
}

export function evaluate(expr: LatexString | ExpressionInput): Expression {
  return toExpression(expr).evaluate();
}

export function N(expr: LatexString | ExpressionInput): Expression {
  return toExpression(expr).N();
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

export function expand(expr: LatexString | ExpressionInput): Expression {
  return expandExpr(toExpression(expr));
}

export function solve(
  expr: LatexString | ExpressionInput,
  vars?: string | Iterable<string> | Expression | Iterable<Expression>
):
  | null
  | ReadonlyArray<Expression>
  | Record<string, Expression>
  | Array<Record<string, Expression>> {
  return toExpression(expr).solve(vars);
}

export function expandAll(expr: LatexString | ExpressionInput): Expression {
  return expandAllExpr(toExpression(expr));
}

export function factor(expr: LatexString | ExpressionInput): Expression {
  return factorExpr(toExpression(expr));
}

export function compile<T extends string = 'javascript'>(
  expr: LatexString | ExpressionInput,
  options?: Parameters<typeof compileExpr>[1] & { to?: T }
): ReturnType<typeof compileExpr> {
  return compileExpr(toExpression(expr), options);
}


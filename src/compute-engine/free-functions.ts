import type {
  Expression,
  ExpressionInput,
  AssignValue,
  IComputeEngine,
} from './global-types';
import type { LatexString } from './latex-syntax/types';
import { isExpression } from './boxed-expression/type-guards';
import {
  expand as expandExpr,
  expandAll as expandAllExpr,
} from './boxed-expression/expand';
import { factor as factorExpr } from './boxed-expression/factor';
import { compile as compileExpr } from './compilation/compile-expression';

let _defaultEngine: IComputeEngine | null = null;
let _ComputeEngineClass: (new () => IComputeEngine) | null = null;

/** @internal Called by index.ts to register the ComputeEngine class,
 *  avoiding a circular dependency (index.ts re-exports this file). */
export function _setComputeEngineClass(cls: new () => IComputeEngine): void {
  _ComputeEngineClass = cls;
}

export function getDefaultEngine(): IComputeEngine {
  if (!_defaultEngine) {
    if (!_ComputeEngineClass)
      throw new Error(
        'ComputeEngine class not registered. Import from the main module.'
      );
    _defaultEngine = new _ComputeEngineClass();
  }
  return _defaultEngine!;
}

/** Convert a LatexString, Expression, or ExpressionInput to a boxed Expression.
 *  Strings are treated as LaTeX and parsed. */
function toExpression(input: LatexString | ExpressionInput): Expression {
  if (typeof input === 'string')
    return getDefaultEngine().parse(input, { strict: false });
  if (isExpression(input)) return input;
  return getDefaultEngine().box(input);
}

export function parse(latex: LatexString): Expression {
  return getDefaultEngine().parse(latex, { strict: false });
}

export function simplify(
  expr: LatexString | ExpressionInput
): Expression {
  return toExpression(expr).simplify();
}

export function evaluate(
  expr: LatexString | ExpressionInput
): Expression {
  return toExpression(expr).evaluate();
}

export function N(expr: LatexString | ExpressionInput): Expression {
  return toExpression(expr).N();
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
  expr: LatexString | ExpressionInput
): Expression | null {
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

export function expandAll(
  expr: LatexString | ExpressionInput
): Expression | null {
  return expandAllExpr(toExpression(expr));
}

export function factor(
  expr: LatexString | ExpressionInput
): Expression {
  return factorExpr(toExpression(expr));
}

export function compile(
  expr: LatexString | ExpressionInput,
  options?: Parameters<typeof compileExpr>[1]
): ReturnType<typeof compileExpr> {
  return compileExpr(toExpression(expr), options);
}

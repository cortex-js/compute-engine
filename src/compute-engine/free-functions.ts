import type { Expression, AssignValue, IComputeEngine } from './global-types';
import type { LatexString } from './latex-syntax/types';
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

export function parse(latex: LatexString): Expression {
  return getDefaultEngine().parse(latex, { strict: false });
}

export function simplify(latex: LatexString | Expression): Expression {
  if (typeof latex === 'string')
    return getDefaultEngine().parse(latex, { strict: false }).simplify();
  return latex.simplify();
}

export function evaluate(latex: LatexString | Expression): Expression {
  if (typeof latex === 'string')
    return getDefaultEngine().parse(latex, { strict: false }).evaluate();
  return latex.evaluate();
}

export function N(latex: LatexString | Expression): Expression {
  if (typeof latex === 'string')
    return getDefaultEngine().parse(latex, { strict: false }).N();
  return latex.N();
}

export function assign(id: string, value: AssignValue): void;
export function assign(ids: { [id: string]: AssignValue }): void;
export function assign(
  arg1: string | { [id: string]: AssignValue },
  arg2?: AssignValue
): void {
  getDefaultEngine().assign(arg1 as any, arg2 as any);
}

export function expand(latex: LatexString | Expression): Expression | null {
  const expr =
    typeof latex === 'string'
      ? getDefaultEngine().parse(latex, { strict: false })
      : latex;
  return expandExpr(expr);
}

export function solve(
  latex: LatexString | Expression,
  vars?: string | Iterable<string> | Expression | Iterable<Expression>
):
  | null
  | ReadonlyArray<Expression>
  | Record<string, Expression>
  | Array<Record<string, Expression>> {
  const expr =
    typeof latex === 'string'
      ? getDefaultEngine().parse(latex, { strict: false })
      : latex;
  return expr.solve(vars);
}

export function expandAll(latex: LatexString | Expression): Expression | null {
  const expr =
    typeof latex === 'string'
      ? getDefaultEngine().parse(latex, { strict: false })
      : latex;
  return expandAllExpr(expr);
}

export function factor(latex: LatexString | Expression): Expression {
  const expr =
    typeof latex === 'string'
      ? getDefaultEngine().parse(latex, { strict: false })
      : latex;
  return factorExpr(expr);
}

export function compile(
  latex: LatexString | Expression,
  options?: Parameters<typeof compileExpr>[1]
): ReturnType<typeof compileExpr> {
  const expr =
    typeof latex === 'string'
      ? getDefaultEngine().parse(latex, { strict: false })
      : latex;
  return compileExpr(expr, options);
}

import type { BoxedExpression, AssignValue, IComputeEngine } from './global-types';
import type { LatexString } from './latex-syntax/types';

let _defaultEngine: IComputeEngine | null = null;

export function getDefaultEngine(): IComputeEngine {
  if (!_defaultEngine) {
    // Use indirect require to avoid circular dependency detected by madge
    // (index.ts re-exports this file, but getDefaultEngine is only called lazily)
    const m = './index';
    const { ComputeEngine } = require(m);
    _defaultEngine = new ComputeEngine();
  }
  return _defaultEngine!;
}

export function parse(latex: LatexString): BoxedExpression {
  return getDefaultEngine().parse(latex);
}

export function simplify(
  latex: LatexString | BoxedExpression
): BoxedExpression {
  if (typeof latex === 'string')
    return getDefaultEngine().parse(latex).simplify();
  return latex.simplify();
}

export function evaluate(
  latex: LatexString | BoxedExpression
): BoxedExpression {
  if (typeof latex === 'string')
    return getDefaultEngine().parse(latex).evaluate();
  return latex.evaluate();
}

export function N(latex: LatexString | BoxedExpression): BoxedExpression {
  if (typeof latex === 'string') return getDefaultEngine().parse(latex).N();
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

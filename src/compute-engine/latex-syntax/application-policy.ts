import type { MathJsonExpression } from '../../math-json/types.js';
import { getSequence, operator, operands } from '../../math-json/utils.js';
import type { ApplicationContext, ParseLatexOptions } from './types.js';
import { continuationRanges } from './range-provenance.js';

type Candidate = Omit<ApplicationContext, 'arguments' | 'ancestors'> & {
  group: MathJsonExpression;
  fallback: 'apply' | 'predicate' | 'juxtapose';
};
type Ancestors = ApplicationContext['ancestors'];

/** Retain ambiguity until the enclosing syntax is available. Candidates use
 * ordinary juxtaposition syntax so assignment parselets can consume defining
 * heads. Weak maps keep this bookkeeping out of public MathJSON. */
export class ApplicationPolicy {
  private readonly candidates = new WeakMap<object, Candidate>();
  private readonly suffixes = new WeakSet<object>();

  constructor(
    private readonly resolve: ParseLatexOptions['resolveApplication']
  ) {}

  has(expr: MathJsonExpression): boolean {
    return (
      typeof expr === 'object' && expr !== null && this.candidates.has(expr)
    );
  }

  add(candidate: Candidate): MathJsonExpression {
    const expr: MathJsonExpression = {
      fn: ['InvisibleOperator', candidate.head, candidate.group],
    };
    this.candidates.set(expr, candidate);
    return expr;
  }

  /** Record suffix attachment before deciding whether it belongs to the call
   * or to the multiplied group. Parentheses around the whole juxtaposition
   * terminate this chain: `(a(x))^2` squares the whole product. */
  suffix(before: MathJsonExpression, after: MathJsonExpression): void {
    if (before === after || typeof before !== 'object' || before === null)
      return;
    if (!this.candidates.has(before) && !this.suffixes.has(before)) return;
    // A single parselet may add several wrappers (for example ^2_1).
    // Mark the whole first-operand path, but only if it reaches our input.
    const chain: object[] = [];
    let cursor = after;
    while (cursor !== before && typeof cursor === 'object' && cursor !== null) {
      chain.push(cursor);
      const args = operands(cursor);
      if (args.length === 0) return;
      cursor = args[0];
    }
    if (cursor === before)
      for (const wrapper of chain) this.suffixes.add(wrapper);
  }

  decorated(before: object, after: object): void {
    const candidate = this.candidates.get(before);
    if (candidate) this.candidates.set(after, candidate);
    if (this.suffixes.has(before)) this.suffixes.add(after);
  }

  finish(expr: MathJsonExpression): MathJsonExpression {
    if (!this.resolve) return expr;
    return this.visit(expr, []);
  }

  private visit(
    expr: MathJsonExpression,
    ancestors: Ancestors
  ): MathJsonExpression {
    if (typeof expr !== 'object' || expr === null) return expr;
    const wrappers: MathJsonExpression[] = [];
    let base = expr;
    let context = ancestors;
    while (this.suffixes.has(base)) {
      const args = operands(base);
      if (args.length === 0 || typeof args[0] !== 'object' || args[0] === null)
        break;
      wrappers.push(base);
      context = [...context, { operator: operator(base), operandIndex: 1 }];
      base = args[0];
    }
    const candidate = this.candidates.get(base);
    if (candidate) {
      const group = this.visit(candidate.group, [
        ...context,
        { operator: 'InvisibleOperator', operandIndex: 2 },
      ]);
      const args = getSequence(group) ?? [group];
      const decision = this.resolve!({
        head: candidate.head,
        arguments: args,
        sourceOffsets: candidate.sourceOffsets,
        headSourceOffsets: candidate.headSourceOffsets,
        ancestors: context,
      });
      if (
        decision !== undefined &&
        decision !== 'apply' &&
        decision !== 'multiply'
      )
        throw new Error(
          'ce.parse(): resolveApplication() must return apply, multiply, or undefined'
        );

      const apply =
        decision === 'apply' ||
        (decision === undefined && candidate.fallback !== 'juxtapose');
      let result: MathJsonExpression = apply
        ? candidate.fallback === 'predicate' && decision === undefined
          ? ['Predicate', candidate.head, ...args]
          : [candidate.head, ...args]
        : group;
      for (let i = wrappers.length - 1; i >= 0; i--) {
        const wrapper = wrappers[i];
        result = replaceOperands(wrapper, [
          result,
          ...operands(wrapper)
            .slice(1)
            .map((arg, j) =>
              this.visit(arg, [
                ...ancestors,
                ...wrappers
                  .slice(0, i)
                  .map((w) => ({ operator: operator(w), operandIndex: 1 })),
                { operator: operator(wrapper), operandIndex: j + 2 },
              ])
            ),
        ]);
      }
      if (!apply)
        result = [
          decision === 'multiply' ? 'Multiply' : 'InvisibleOperator',
          candidate.head,
          result,
        ];
      // Keep source metadata on the whole occurrence, never its moved factor.
      if (
        !Array.isArray(expr) &&
        'fn' in expr &&
        Object.keys(expr).length > 1 &&
        Array.isArray(result)
      )
        return { ...expr, fn: result as [string, ...MathJsonExpression[]] };
      return result;
    }
    const op = operator(expr);
    if (!op) return expr;
    return replaceOperands(
      expr,
      operands(expr).flatMap((arg, i) => {
        const result = this.visit(arg, [
          ...ancestors,
          { operator: op, operandIndex: i + 1 },
        ]);
        return op === 'InvisibleOperator' && operator(result) === op
          ? operands(result)
          : [result];
      })
    );
  }
}

function replaceOperands(
  expr: MathJsonExpression,
  args: MathJsonExpression[]
): MathJsonExpression {
  const previous = operands(expr);
  if (
    args.length === previous.length &&
    args.every((arg, i) => arg === previous[i])
  )
    return expr;

  const fn: [string, ...MathJsonExpression[]] = [operator(expr), ...args];
  const result =
    !Array.isArray(expr) &&
    typeof expr === 'object' &&
    expr !== null &&
    'fn' in expr
      ? { ...expr, fn }
      : fn;
  // Range normalization runs after application resolution and needs to know
  // which nodes came from infix ellipses instead of explicit Range calls.
  if (typeof expr === 'object' && expr !== null && continuationRanges.has(expr))
    continuationRanges.add(result);
  return result;
}

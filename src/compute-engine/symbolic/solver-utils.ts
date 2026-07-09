import { isValueDef } from '../boxed-expression/utils.js';
import { isFunction, isSymbol } from '../boxed-expression/type-guards.js';
import type { Expression } from '../global-types.js';

export function collectSymbols(
  expr: Expression,
  symbols = new Set<string>()
): Set<string> {
  if (isSymbol(expr)) symbols.add(expr.symbol);
  if (isFunction(expr)) {
    for (const op of expr.ops) collectSymbols(op, symbols);
  }
  return symbols;
}

export function freshSymbolName(
  prefix: string,
  usedSymbols: Set<string>
): string {
  for (let i = 0; ; i++) {
    const name = i === 0 ? prefix : `${prefix}_${i}`;
    if (!usedSymbols.has(name)) return name;
  }
}

export function integrationConstants(
  equation: Expression,
  count: number
): Expression[] {
  const ce = equation.engine;
  const usedSymbols = collectSymbols(equation);
  const result: Expression[] = [];

  for (let i = 1; result.length < count; i++) {
    const name = `c_${i}`;
    if (usedSymbols.has(name)) continue;
    const def = ce.lookupDefinition(name);
    if (def && !(isValueDef(def) && def.value.inferredType)) continue;
    usedSymbols.add(name);
    result.push(ce.symbol(name));
  }

  return result;
}

export function characteristicPolynomial(
  coefficients: Map<number, Expression>,
  variable: string,
  ce: Expression['engine']
): Expression {
  const root = ce.symbol(variable);
  const terms: Expression[] = [];

  for (const [degree, coefficient] of coefficients) {
    const c = coefficient.simplify();
    if (c.isSame(0)) continue;
    if (degree === 0) terms.push(c);
    else if (degree === 1) terms.push(c.mul(root).simplify());
    else terms.push(c.mul(root.pow(degree)).simplify());
  }

  return terms.length === 0 ? ce.Zero : ce.function('Add', terms).simplify();
}

function isZeroAtRoot(
  expr: Expression,
  variable: string,
  root: Expression
): boolean {
  const value = expr.subs({ [variable]: root }).simplify();
  if (value.isSame(0)) return true;
  const numeric = value.N();
  return Math.hypot(numeric.re, numeric.im) < 1e-8;
}

export function rootMultiplicity(
  polynomial: Expression,
  variable: string,
  root: Expression,
  maxMultiplicity: number
): number {
  const ce = polynomial.engine;
  let multiplicity = 0;
  let derivative = polynomial;

  while (
    multiplicity < maxMultiplicity &&
    isZeroAtRoot(derivative, variable, root)
  ) {
    multiplicity += 1;
    derivative = ce
      .function('D', [derivative, ce.symbol(variable)])
      .evaluate()
      .simplify();
  }

  return multiplicity;
}

export function appendDistinctRoot(
  roots: Expression[],
  root: Expression,
  tolerance = 1e-8
): void {
  const rootValue = root.N();
  if (
    roots.some((other) => {
      if (root.isSame(other)) return true;
      const otherValue = other.N();
      return (
        Math.hypot(rootValue.re - otherValue.re, rootValue.im - otherValue.im) <
        tolerance
      );
    })
  )
    return;

  roots.push(root);
}

export function solutionRecord(
  result:
    | null
    | ReadonlyArray<Expression>
    | Record<string, Expression>
    | Array<Record<string, Expression>>
): Record<string, Expression> | undefined {
  if (!result) return undefined;
  if (!Array.isArray(result)) return result as Record<string, Expression>;
  const [first] = result;
  if (!first || 'operator' in first) return undefined;
  return first as Record<string, Expression>;
}

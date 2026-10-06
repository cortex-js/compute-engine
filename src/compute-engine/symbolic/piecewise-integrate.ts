import type { Expression, IComputeEngine } from '../global-types.js';
import { isFunction, isNumber, sym } from '../boxed-expression/type-guards.js';
import { boundVariableNamesInOperand } from '../boxed-expression/binders.js';
import { getPolynomialCoefficients } from '../boxed-expression/polynomials.js';
import { solveOverDomain } from '../boxed-expression/solve-domain.js';
import { isExactConstantExpression } from '../boxed-expression/compare.js';
import { differentiate } from './derivative.js';
import { exactSign } from './contour.js';
import { checkDeadline } from '../../common/interruptible.js';
import { shadowsLibraryName } from '../library-shadowing.js';

const PIECEWISE = new Set([
  'If',
  'Which',
  'Min',
  'Max',
  'Floor',
  'Ceil',
  'Fract',
]);
const COMPARISONS = new Set([
  'Less',
  'LessEqual',
  'Greater',
  'GreaterEqual',
  'Equal',
  'NotEqual',
]);
const MAX_CUTS = 128;
const MAX_NODES = 4096;
const MAX_SOLVES = 128;

function finiteReal(e: Expression): boolean {
  return (
    e.isValid &&
    e.isNaN !== true &&
    e.isFinite !== false &&
    e.type.matches('real')
  );
}

function sign(e: Expression): -1 | 0 | 1 | undefined {
  // The shared exact resolver must separate close constants, not identify
  // overlapping enclosures as equal at its precision limit.
  if (isExactConstantExpression(e) || (isNumber(e) && e.isExact))
    return exactSign(e);
  const value = e.evaluate();
  if (value.isSame(0)) return 0;
  if (value.isPositive === true) return 1;
  if (value.isNegative === true) return -1;
  return undefined;
}

function binds(e: Expression, index: number, variable: string): boolean {
  return boundVariableNamesInOperand(e, index).includes(variable);
}

/** Integrate finite real intervals by resolving branches on open cells.
 * `undefined` means no relevant piecewise expression; `inert` means the complete
 * partition or a cell integral could not be established. Point values at cuts
 * do not affect these ordinary integrals, but poles still reach Integrate's
 * one-sided endpoint checks when each resolved cell is evaluated. */
export function integratePiecewise(
  ce: IComputeEngine,
  integrand: Expression,
  variable: string,
  lower: Expression,
  upper: Expression
): Expression | 'inert' | undefined {
  if (!integrand.has([...PIECEWISE])) return undefined;
  let nodes = 0;
  let exhausted = false;
  const contains = (e: Expression): boolean => {
    if (++nodes > MAX_NODES) {
      exhausted = true;
      return false;
    }
    if (!isFunction(e)) return false;
    if (PIECEWISE.has(e.operator) && e.has(variable)) return true;
    return e.ops.some((op, i) => !binds(e, i, variable) && contains(op));
  };
  if (!contains(integrand)) return exhausted ? 'inert' : undefined;
  // Partitioning and resolving must observe the same function and bounds.
  if (!integrand.isPure || !lower.isPure || !upper.isPure) return 'inert';
  const a = lower.evaluate();
  const b = upper.evaluate();
  if (!finiteReal(a) || !finiteReal(b)) return 'inert';
  const direction = sign(b.sub(a));
  if (direction === undefined) return 'inert';
  if (direction === 0) return ce.Zero;
  const lo = direction > 0 ? a : b;
  const hi = direction > 0 ? b : a;
  const cuts: Expression[] = [];
  const domainChecks = new Set<Expression>();
  const rootCache = new Map<Expression, readonly Expression[] | undefined>();
  let solves = 0;

  const affine = (e: Expression): [Expression, Expression] | undefined => {
    if (!e.has(variable)) {
      const constant = e.evaluate();
      return finiteReal(constant) ? [constant, ce.Zero] : undefined;
    }
    const coefficients = getPolynomialCoefficients(e, variable);
    if (!coefficients || coefficients.length > 2) return undefined;
    const m = (coefficients[0] ?? ce.Zero).evaluate();
    const k = (coefficients[1] ?? ce.Zero).evaluate();
    return finiteReal(m) && finiteReal(k) ? [m, k] : undefined;
  };

  const addCut = (cut: Expression): boolean => {
    const left = sign(cut.sub(lo));
    const right = sign(hi.sub(cut));
    if (left === undefined || right === undefined) return false;
    if (left <= 0 || right <= 0) return true;
    for (let i = 0; i < cuts.length; i++) {
      const order = sign(cut.sub(cuts[i]));
      if (order === undefined) return false;
      if (order === 0) return true;
      if (order < 0) {
        if (cuts.length >= MAX_CUTS) return false;
        cuts.splice(i, 0, cut);
        return true;
      }
    }
    if (cuts.length >= MAX_CUTS) return false;
    cuts.push(cut);
    return true;
  };

  const roots = (e: Expression): readonly Expression[] | undefined => {
    if (++nodes > MAX_NODES) return undefined;
    const coefficients = affine(e);
    if (coefficients) {
      const [m, k] = coefficients;
      const slope = sign(k);
      if (slope === undefined) return undefined;
      return slope === 0 ? [] : [m.neg().div(k).evaluate()];
    }
    if (isFunction(e, 'Divide')) return roots(e.op1);
    if (isFunction(e, 'Power') && !e.op2.has(variable)) {
      const exponent = sign(e.op2);
      if (exponent === -1) return [];
      if (exponent === 1) return roots(e.op1);
    }
    if (
      isFunction(e, 'Exp') ||
      (isFunction(e, 'Power') && !e.op1.has(variable) && sign(e.op1) === 1)
    )
      return [];
    if (isFunction(e, 'Multiply')) {
      const result: Expression[] = [];
      for (const op of e.ops) {
        const factor = roots(op);
        if (factor === undefined) return undefined;
        result.push(...factor);
      }
      return result;
    }
    if (rootCache.has(e)) return rootCache.get(e);
    if (++solves > MAX_SOLVES) return undefined;
    checkDeadline(ce._deadlineFrame);
    // A bounded domain expands trig root families and rejects partial answers.
    // Keep the exact returned expressions, never numerical root approximations.
    const found = solveOverDomain(ce, e.canonical, {
      unknown: variable,
      domain: ce.function('Interval', [lo, hi]),
    });
    const result = found?.every(
      (r) =>
        finiteReal(r) &&
        (isNumber(r) ? r.isExact : isExactConstantExpression(r))
    )
      ? found
      : undefined;
    rootCache.set(e, result);
    return result;
  };

  const zero = (e: Expression): boolean => {
    const found = roots(e);
    return found !== undefined && found.every(addCut);
  };

  const integerPart = (
    value: Expression,
    ceiling = false
  ): Expression | undefined => {
    const n = ce.function(ceiling ? 'Ceil' : 'Floor', [value]).evaluate();
    if (!isNumber(n) || !n.isExact || n.isInteger !== true) return undefined;
    // Floor/Ceil may resolve an enclosure at their precision limit as a tie.
    // Partitioning requires strict separation from the adjacent integer.
    const lower = sign(value.sub(ceiling ? n.sub(ce.One) : n));
    const upper = sign((ceiling ? n : n.add(1)).sub(value));
    if (lower === undefined || upper === undefined) return undefined;
    return (ceiling ? lower > 0 && upper >= 0 : lower >= 0 && upper > 0)
      ? n
      : undefined;
  };

  // On each open cell these operations are continuous and real, provided their
  // domain checks hold. Poles and branch-domain endpoints are cuts too: zeros
  // alone do not suffice to classify a rational inequality or a logarithm.
  const continuous = (e: Expression): boolean => {
    if (++nodes > MAX_NODES) return false;
    if (sym(e) === variable) return true;
    if (!e.has(variable)) return finiteReal(e.evaluate());
    if (!isFunction(e)) return false;
    if (shadowsLibraryName(ce, e.operator)) return false;
    if (!e.ops.every(continuous)) return false;
    const op = e.operator;
    if (
      [
        'Add',
        'Subtract',
        'Multiply',
        'Negate',
        'Square',
        'Sin',
        'Cos',
        'Exp',
        'Sinh',
        'Cosh',
        'Tanh',
        'Arctan',
      ].includes(op)
    )
      return true;
    domainChecks.add(e);
    if (op === 'Divide') return zero(e.op2);
    if (op === 'Ln' || op === 'Sqrt') return zero(e.op1);
    if (op === 'Tan' || op === 'Sec') return zero(ce.function('Cos', [e.op1]));
    if (op === 'Cot' || op === 'Csc') return zero(ce.function('Sin', [e.op1]));
    if (op === 'Power') {
      const exponent = e.op2.evaluate();
      if (
        !e.op2.has(variable) &&
        isNumber(exponent) &&
        exponent.isInteger &&
        exponent.isPositive
      )
        return true;
      // A fixed positive base admits real exponents everywhere. Other powers
      // can change their real domain only where the base vanishes.
      if (!e.op1.has(variable) && sign(e.op1) === 1) return true;
      if (!e.op2.has(variable)) return zero(e.op1);
    }
    return false;
  };

  // Sampling chooses a branch only after all roots and domain boundaries of
  // its supported continuous operands have been accounted for.
  const condition = (e: Expression): boolean => {
    if (++nodes > MAX_NODES) return false;
    if (!e.has(variable)) {
      const value = sym(e.evaluate());
      return value === 'True' || value === 'False';
    }
    if (!isFunction(e)) return false;
    if (shadowsLibraryName(ce, e.operator)) return false;
    if (e.operator === 'Not' && e.nops === 1) return condition(e.op1);
    if (e.operator === 'And' || e.operator === 'Or')
      return e.ops.every(condition);
    return (
      COMPARISONS.has(e.operator) &&
      e.nops === 2 &&
      continuous(e.op1) &&
      continuous(e.op2) &&
      zero(e.op1.sub(e.op2))
    );
  };

  const collect = (e: Expression): boolean => {
    if (++nodes > MAX_NODES) return false;
    if (!isFunction(e) || !e.has(variable)) return true;
    if (shadowsLibraryName(ce, e.operator)) return false;
    if (e.operator === 'If' || e.operator === 'Which') {
      if (e.operator === 'If') {
        if (e.nops < 2 || e.nops > 3 || !condition(e.op1)) return false;
        const truth = !e.op1.has(variable) ? sym(e.op1.evaluate()) : undefined;
        if (truth === 'True') return collect(e.op2);
        if (truth === 'False') return e.nops === 3 && collect(e.op3);
        return e.ops.slice(1).every(collect);
      }
      if (e.nops % 2 !== 0) return false;
      for (let i = 0; i < e.nops; i += 2) {
        const predicate = e.ops[i];
        if (!condition(predicate)) return false;
        const truth = !predicate.has(variable)
          ? sym(predicate.evaluate())
          : undefined;
        if (truth === 'False') continue;
        if (!collect(e.ops[i + 1])) return false;
        if (truth === 'True') break;
      }
      return true;
    }
    if (e.operator === 'Min' || e.operator === 'Max') {
      if (e.nops === 0 || !e.ops.every(continuous)) return false;
      for (let i = 0; i < e.nops; i++)
        for (let j = 0; j < i; j++) {
          if (++nodes > MAX_NODES || !zero(e.ops[i].sub(e.ops[j])))
            return false;
        }
      return true;
    }
    if (
      e.operator === 'Floor' ||
      e.operator === 'Ceil' ||
      e.operator === 'Fract'
    ) {
      if (e.nops !== 1) return false;
      const coefficients = affine(e.op1);
      if (!coefficients) {
        if (!continuous(e.op1)) return false;
        const d = differentiate(e.op1.canonical, variable);
        if (d === undefined) return false;
        const critical = roots(d.evaluate());
        if (critical === undefined) return false;
        // All extrema of a smooth branch occur at endpoints or critical
        // points. Domain cuts are included; a pole there makes the range
        // unbounded and prevents a finite integer-level partition.
        const values = [lo, hi, ...cuts, ...critical].map((p) =>
          e.op1.subs({ [variable]: p }).evaluate()
        );
        if (!values.every(finiteReal)) return false;
        const levels = values.map((v) => integerPart(v));
        if (!levels.every((v) => v !== undefined && Number.isSafeInteger(v.re)))
          return false;
        const start = Math.min(...levels.map((v) => v!.re));
        const end = Math.max(...levels.map((v) => v!.re));
        if (end - start > MAX_CUTS) return false;
        // Include the lowest integer too: an attained minimum may be a jump
        // of Ceil, even though Floor takes its usual value there.
        for (let n = start; n <= end; n++)
          if (!zero(e.op1.sub(ce.number(n)))) return false;
        return true;
      }
      const [m, k] = coefficients;
      const slope = sign(k);
      if (slope === undefined) return false;
      if (slope === 0) return true;
      const first = integerPart(m.add(k.mul(lo)));
      const last = integerPart(m.add(k.mul(hi)));
      if (
        first === undefined ||
        last === undefined ||
        !Number.isSafeInteger(first.re) ||
        !Number.isSafeInteger(last.re)
      )
        return false;
      const start = Math.min(first.re, last.re);
      const end = Math.max(first.re, last.re);
      if (end - start > MAX_CUTS) return false;
      for (let n = start + 1; n <= end; n++)
        if (!addCut(ce.number(n).sub(m).div(k).evaluate())) return false;
      return true;
    }
    if ((e.operator === 'Abs' || e.operator === 'Sign') && e.nops === 1)
      return continuous(e.op1) && zero(e.op1);
    return e.ops.every((op, i) => binds(e, i, variable) || collect(op));
  };
  if (!collect(integrand)) return 'inert';

  const truthAt = (e: Expression, sample: Expression): boolean | undefined => {
    if (!e.has(variable)) {
      const value = sym(e.evaluate());
      return value === 'True' ? true : value === 'False' ? false : undefined;
    }
    if (!isFunction(e)) return undefined;
    if (e.operator === 'Not') {
      const truth = truthAt(e.op1, sample);
      return truth === undefined ? undefined : !truth;
    }
    if (e.operator === 'And' || e.operator === 'Or') {
      const values = e.ops.map((op) => truthAt(op, sample));
      const short = e.operator === 'Or';
      if (values.includes(short)) return short;
      return values.includes(undefined) ? undefined : !short;
    }
    const order = sign(e.op1.sub(e.op2).subs({ [variable]: sample }));
    if (order === undefined) return undefined;
    switch (e.operator) {
      case 'Less':
        return order < 0;
      case 'LessEqual':
        return order <= 0;
      case 'Greater':
        return order > 0;
      case 'GreaterEqual':
        return order >= 0;
      case 'Equal':
        return order === 0;
      case 'NotEqual':
        return order !== 0;
      default:
        return undefined;
    }
  };

  const resolve = (
    e: Expression,
    sample: Expression
  ): Expression | undefined => {
    if (!isFunction(e) || !e.has(variable)) return e;
    const at = (op: Expression) => op.subs({ [variable]: sample }).evaluate();
    if (e.operator === 'If') {
      const truth = truthAt(e.op1, sample);
      if (truth === true) return resolve(e.op2, sample);
      if (truth === false && e.nops === 3) return resolve(e.op3, sample);
      return undefined;
    }
    if (e.operator === 'Which') {
      for (let i = 0; i < e.nops; i += 2) {
        const truth = truthAt(e.ops[i], sample);
        if (truth === true) return resolve(e.ops[i + 1], sample);
        if (truth !== false) return undefined;
      }
      return undefined;
    }
    if (e.operator === 'Min' || e.operator === 'Max') {
      let best = e.op1;
      for (const op of e.ops.slice(1)) {
        const order = sign(at(op).sub(at(best)));
        if (order === undefined) return undefined;
        if (
          (e.operator === 'Min' && order < 0) ||
          (e.operator === 'Max' && order > 0)
        )
          best = op;
      }
      return best;
    }
    if (
      e.operator === 'Floor' ||
      e.operator === 'Ceil' ||
      e.operator === 'Fract'
    ) {
      const integer = integerPart(at(e.op1), e.operator === 'Ceil');
      if (integer === undefined) return undefined;
      return e.operator === 'Fract' ? e.op1.sub(integer) : integer;
    }
    if (e.operator === 'Abs' || e.operator === 'Sign') {
      const s = sign(at(e.op1));
      if (s === undefined) return undefined;
      return e.operator === 'Sign' ? ce.number(s) : s < 0 ? e.op1.neg() : e.op1;
    }
    const operands: Expression[] = [];
    for (let i = 0; i < e.nops; i++) {
      const op = binds(e, i, variable) ? e.ops[i] : resolve(e.ops[i], sample);
      if (op === undefined) return undefined;
      operands.push(op);
    }
    return operands.every((op, i) => op === e.ops[i])
      ? e
      : ce.function(e.operator, operands);
  };

  const points = [lo, ...cuts, hi];
  const values: Expression[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    checkDeadline(ce._deadlineFrame);
    const [left, right] = [points[i], points[i + 1]];
    const sample = left.add(right).div(2);
    if (
      ![...domainChecks].every((e) =>
        finiteReal(e.subs({ [variable]: sample }).evaluate())
      )
    )
      return 'inert';
    const body = resolve(integrand, sample);
    if (body === undefined) return 'inert';
    const value = ce
      .function('Integrate', [
        body,
        ce.function('Limits', [ce.symbol(variable), left, right]),
      ])
      .evaluate();
    if (value.has('Integrate')) return 'inert';
    values.push(value);
  }
  const total = ce.function('Add', values).evaluate();
  return direction > 0 ? total : total.neg().evaluate();
}

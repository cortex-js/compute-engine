// Rubi predicate and utility layer — the section-1.1.1 cut
// (docs/rubi/RUBI.md §4C), with semantics transcribed from
// Rubi/IntegrationUtilityFunctions.m (see per-function notes).
//
// Two entry points, both interpreting raw corpus MathJSON over a binding
// environment:
//   evalCondition(json, env)  — three-valued-collapsed-to-boolean,
//                               FAIL-CLOSED: can't decide ⇒ false
//   build(json, env)          — construct the (boxed) RHS value; throws
//                               RuleFail when a utility can't apply, which
//                               makes the driver try the next rule.

import type {
  ComputeEngine,
  Expression,
} from '../../src/compute-engine/global-types';
import { isNumber } from '../../src/compute-engine/boxed-expression/type-guards';

import { expand } from '../../src/compute-engine/boxed-expression/expand';

import type { Json } from './wl-parser';
import type { Env } from './match';
import { toTimesPower } from './normal-form';

export class RuleFail extends Error {
  constructor(reason: string) {
    super(reason);
  }
}

export type Hooks = {
  /** recursive integration; null = could not integrate */
  int: (integrand: Expression) => Expression | null;
};

export type Ctx = {
  ce: ComputeEngine;
  env: Env;
  /** integration variable name */
  x: string;
  hooks: Hooks;
  /** driver-scoped caches (zeroQ/simplify results recur across rules:
   * every (a+bx)^m(c+dx)^n rule re-tests the same b·c−a·d expressions) */
  caches?: { zeroQ: Map<string, boolean>; simplify: Map<string, Expression> };
};

const fail = (why: string): never => {
  throw new RuleFail(why);
};

// ---------------------------------------------------------------------------
// Builder: corpus MathJSON + bindings → BoxedExpression
// ---------------------------------------------------------------------------

export function build(json: Json, ctx: Ctx): Expression {
  const { ce, env } = ctx;
  if (typeof json === 'number') return ce.number(json);
  if (typeof json === 'string') {
    const bound = env.get(json);
    if (bound !== undefined) return bound;
    return ce.symbol(json);
  }
  const [head, ...args] = json;
  if (typeof head !== 'string') return fail('non-symbol head in RHS');

  switch (head) {
    case 'Int': {
      // Int[f, x] — recursive integration; an unsolved subproblem stays
      // inert (reduction formulas legitimately leave residual integrals).
      const f = build(args[0], ctx);
      return ctx.hooks.int(f) ?? ce._fn('Integrate', [f, ce.symbol(ctx.x)]);
    }
    case 'Subst': {
      // Subst[u, x, v]: integrate/transform u, then substitute x → v.
      // When u is itself Int[…], a failed inner integration fails the
      // rule (substituting into an inert integral is not useful).
      if (args.length !== 3) return fail('Subst arity');
      let u: Expression;
      if (Array.isArray(args[0]) && args[0][0] === 'Int') {
        const f = build((args[0] as Json[])[1], ctx);
        const F = ctx.hooks.int(f);
        // a residual inert Integrate inside F would have its integration
        // variable substituted too, producing a malformed integral
        if (F === null || F.has('Integrate'))
          return fail('Subst: inner Int unsolved');
        u = F;
      } else u = build(args[0], ctx);
      const v = build(args[2], ctx);
      return u.subs({ [ctx.x]: v }).evaluate();
    }
    case 'Rational':
      // NOTE: ce.number() does not accept a MathJSON array (spins) — box
      return ce.box(json as any);
    case 'List':
      return ce.function('List', args.map((a) => build(a, ctx)));
  }

  const valueFn = VALUE_FNS[head];
  if (valueFn) return valueFn(args, ctx);
  if (PRED_FNS[head] || head === 'And' || head === 'Or' || head === 'Not')
    return ce.symbol(evalCondition(json, ctx) ? 'True' : 'False');

  // ordinary mathematical head (already CE-named by the translator)
  return ce.function(head, args.map((a) => build(a, ctx)));
}

// ---------------------------------------------------------------------------
// numeric helpers
// ---------------------------------------------------------------------------

/** real machine value of an expression, or null if not a real number */
function realNum(e: Expression): number | null {
  const n = e.N();
  if (!isNumber(n)) return null;
  const re = n.re;
  const im = n.im;
  if (typeof re !== 'number' || typeof im !== 'number') return null;
  if (!Number.isFinite(re) || im !== 0) return null;
  return re;
}

// ---------------------------------------------------------------------------
// rational collapse
//
// Several Rubi normalization rules (e.g. 1.1.1.2 #46) rewrite coefficients
// into nested rationals like c′ = b·c/(b·c−a·d) and rely on Mathematica's
// automatic Together to collapse follow-up guards (b/(b·c′−a·d′) = 1) so
// the terminating rule fires. CE's simplify has no multivariate rational
// cancellation, so without this the normalization rule refires on its own
// output until the cycle guard kills it.
// ---------------------------------------------------------------------------

function asNumDen(e: Expression): { num: Expression; den: Expression } {
  const ce = e.engine;
  const ops = e.ops;
  switch (e.operator) {
    case 'Divide': {
      const u = asNumDen(ops![0]);
      const v = asNumDen(ops![1]);
      return { num: u.num.mul(v.den), den: u.den.mul(v.num) };
    }
    case 'Negate': {
      const u = asNumDen(ops![0]);
      return { num: u.num.neg(), den: u.den };
    }
    case 'Multiply': {
      let num = ce.One;
      let den = ce.One;
      for (const op of ops!) {
        const r = asNumDen(op);
        num = num.mul(r.num);
        den = den.mul(r.den);
      }
      return { num, den };
    }
    case 'Add': {
      const rs = ops!.map(asNumDen);
      let den = ce.One;
      for (const r of rs) den = den.mul(r.den);
      let num = ce.Zero;
      for (let i = 0; i < rs.length; i++) {
        let t = rs[i].num;
        for (let j = 0; j < rs.length; j++) if (j !== i) t = t.mul(rs[j].den);
        num = num.add(t);
      }
      return { num, den };
    }
    case 'Subtract': {
      const u = asNumDen(ops![0]);
      const v = asNumDen(ops![1]);
      return {
        num: u.num.mul(v.den).sub(v.num.mul(u.den)),
        den: u.den.mul(v.den),
      };
    }
    case 'Power': {
      const k = ops![1].re;
      if (
        ops![1].isInteger &&
        typeof k === 'number' &&
        Number.isInteger(k) &&
        k !== 0 &&
        Math.abs(k) <= 6
      ) {
        const r = asNumDen(ops![0]);
        if (k > 0) return { num: r.num.pow(k), den: r.den.pow(k) };
        return { num: r.den.pow(-k), den: r.num.pow(-k) };
      }
      return { num: e, den: ce.One };
    }
    default:
      return { num: e, den: ce.One };
  }
}

/** If e is identically a rational constant p/q (a multivariate rational
 * identity, e.g. b/(b·(bc/(bc−ad)) − a·(bd/(bc−ad))) = 1), return that
 * constant; else null. Sample-then-verify: a numeric sample guesses the
 * constant, polynomial expansion verifies the identity exactly. */
function ratConstant(e: Expression): number | null {
  if (e.isNumberLiteral || leafCount(e) > 300) return null;
  const ce = e.engine;
  const { num, den } = asNumDen(e);
  if (den.isSame(ce.One)) return null;
  const n = expand(num);
  const d = expand(den);
  if (n.isSame(d)) return 1;
  // guess the ratio at a fixed generic assignment of the free symbols
  const assign: Record<string, number> = {};
  let i = 0;
  const POINTS = [1.37, 2.11, 0.59, 3.23, 1.93, 0.83, 2.71, 1.13];
  for (const s of new Set([...n.symbols, ...d.symbols]))
    assign[s] = POINTS[i++ % POINTS.length];
  const nv = realNum(n.subs(assign));
  const dv = realNum(d.subs(assign));
  if (nv === null || dv === null || dv === 0) return null;
  const c = nv / dv;
  // accept only small rationals (Rubi guard collapses are simple ratios)
  for (let q = 1; q <= 12; q++) {
    const p = Math.round(c * q);
    if (Math.abs(p) > 1000 || Math.abs(c - p / q) > 1e-9 * Math.max(1, Math.abs(c)))
      continue;
    const diff = expand(n.mul(q).sub(d.mul(p)));
    if (diff.isSame(0)) return p / q;
    break;
  }
  return null;
}

// ---------------------------------------------------------------------------
// x-aware polynomial toolkit
//
// CE's polynomialDegree/getPolynomialCoefficients reject polynomials whose
// coefficients contain division by parameters (e.g. `d²/b·x²`), which is
// exactly what Rubi reduction RHSs produce. These versions treat any
// x-free subexpression as a coefficient.
// ---------------------------------------------------------------------------

export function polyDegreeX(u: Expression, x: string): number {
  if (!u.has(x)) return 0;
  if (u.symbol === x) return 1;
  const ops = u.ops;
  if (!ops) return -1;
  switch (u.operator) {
    case 'Add': {
      let m = 0;
      for (const t of ops) {
        const d = polyDegreeX(t, x);
        if (d < 0) return -1;
        m = Math.max(m, d);
      }
      return m;
    }
    case 'Multiply': {
      let s = 0;
      for (const t of ops) {
        const d = polyDegreeX(t, x);
        if (d < 0) return -1;
        s += d;
      }
      return s;
    }
    case 'Negate':
      return polyDegreeX(ops[0], x);
    case 'Subtract': {
      const d0 = polyDegreeX(ops[0], x);
      const d1 = polyDegreeX(ops[1], x);
      return d0 < 0 || d1 < 0 ? -1 : Math.max(d0, d1);
    }
    case 'Power': {
      const e = realNum(ops[1]);
      if (e === null || !Number.isInteger(e) || e < 0) return -1;
      const d = polyDegreeX(ops[0], x);
      return d < 0 ? -1 : d * e;
    }
    case 'Divide':
      return ops[1].has(x) ? -1 : polyDegreeX(ops[0], x);
  }
  return -1;
}

/** monomial decomposition: u = Σ coeff·x^deg, coefficients x-free.
 * Returns null when u is not a polynomial in x. */
function monomialsX(
  u: Expression,
  x: string
): [Expression, number][] | null {
  const ce = u.engine;
  if (!u.has(x)) return [[u, 0]];
  if (u.symbol === x) return [[ce.One, 1]];
  const ops = u.ops;
  if (!ops) return null;
  switch (u.operator) {
    case 'Add': {
      const out: [Expression, number][] = [];
      for (const t of ops) {
        const m = monomialsX(t, x);
        if (m === null) return null;
        out.push(...m);
      }
      return out;
    }
    case 'Negate': {
      const m = monomialsX(ops[0], x);
      return m === null ? null : m.map(([c, d]) => [c.neg(), d]);
    }
    case 'Subtract': {
      const m0 = monomialsX(ops[0], x);
      const m1 = monomialsX(ops[1], x);
      if (m0 === null || m1 === null) return null;
      return [...m0, ...m1.map(([c, d]) => [c.neg(), d] as [Expression, number])];
    }
    case 'Divide': {
      if (ops[1].has(x)) return null;
      const m = monomialsX(ops[0], x);
      return m === null ? null : m.map(([c, d]) => [c.div(ops[1]), d]);
    }
    case 'Power': {
      const e = realNum(ops[1]);
      if (e === null || !Number.isInteger(e) || e < 0) return null;
      if (ops[0].symbol === x) return [[ce.One, e]];
      // expand (base)^e and retry, guarding against non-expansion
      const ex = expand(u);
      if (ex.operator === 'Power' && ex.ops?.[0].isSame(ops[0])) return null;
      return monomialsX(ex, x);
    }
    case 'Multiply': {
      let acc: [Expression, number][] = [[ce.One, 0]];
      for (const f of ops) {
        const m = monomialsX(f, x);
        if (m === null) return null;
        const next: [Expression, number][] = [];
        for (const [c1, d1] of acc)
          for (const [c2, d2] of m) next.push([c1.mul(c2), d1 + d2]);
        if (next.length > 256) return null;
        acc = next;
      }
      return acc;
    }
  }
  return null;
}

/** ascending coefficient array, or null if not a polynomial in x */
export function polyCoeffsX(
  u: Expression,
  x: string
): Expression[] | null {
  const ce = u.engine;
  const ms = monomialsX(u, x);
  if (ms === null) return null;
  const deg = ms.reduce((m, [, d]) => Math.max(m, d), 0);
  const coeffs: Expression[] = new Array(deg + 1).fill(ce.Zero);
  for (const [c, d] of ms) coeffs[d] = coeffs[d].add(c);
  return coeffs.map((c) => c.evaluate());
}

/** effective degree after dropping provably-zero leading coefficients */
function trimZeros(coeffs: Expression[]): Expression[] {
  let last = coeffs.length - 1;
  while (last > 0 && zeroQ(coeffs[last])) last--;
  return coeffs.slice(0, last + 1);
}

/** long division P / L over symbolic coefficients → [quotient, remainder] */
export function polyDivideX(
  P: Expression,
  L: Expression,
  x: string
): [Expression, Expression] | null {
  const ce = P.engine;
  const pc0 = polyCoeffsX(P, x);
  const lc0 = polyCoeffsX(L, x);
  if (pc0 === null || lc0 === null) return null;
  const lc = trimZeros(lc0);
  if (lc.length === 1 && zeroQ(lc[0])) return null; // division by zero
  let pc = trimZeros(pc0);
  const q: Expression[] = new Array(
    Math.max(0, pc.length - lc.length + 1)
  ).fill(ce.Zero);
  while (pc.length >= lc.length && !(pc.length === 1 && zeroQ(pc[0]))) {
    const shift = pc.length - lc.length;
    const lead = safeSimplify(pc[pc.length - 1].div(lc[lc.length - 1]));
    q[shift] = q[shift].add(lead);
    for (let i = 0; i < lc.length; i++)
      pc[shift + i] = pc[shift + i].sub(lead.mul(lc[i]));
    pc = trimZeros(pc.slice(0, pc.length - 1));
  }
  const X = ce.symbol(x);
  const toExpr = (cs: Expression[]): Expression => {
    const terms = cs
      .map((c, i) => (zeroQ(c) ? null : safeSimplify(c).mul(X.pow(i))))
      .filter((t): t is Expression => t !== null);
    if (terms.length === 0) return ce.Zero;
    if (terms.length === 1) return terms[0];
    return ce.function('Add', terms);
  };
  return [toExpr(q), toExpr(pc)];
}

// simplify() now respects the engine deadline (ce.timeLimit), so runaway
// cases (radical-tower polynomial GCD) get interrupted instead of running
// for minutes. The cap is kept only as a fast-path skip for clearly
// oversized expressions (raised from the old correctness-trading 120).
const SIMPLIFY_LEAF_CAP = 500;

// module-level cache hooks, installed per top-level int() call by the
// driver (see installCaches); fall back to uncached when absent
let activeCaches: Ctx['caches'] | undefined;

export function installCaches(caches: Ctx['caches']): void {
  activeCaches = caches;
}

function safeSimplify(e: Expression): Expression {
  if (leafCount(e) > SIMPLIFY_LEAF_CAP) return e;
  const key = activeCaches ? e.toString() : '';
  const cached = activeCaches?.simplify.get(key);
  if (cached !== undefined) return cached;
  const t0 = Date.now();
  let r: Expression;
  try {
    r = e.simplify();
  } catch {
    // Deadline exceeded (CancellationError): fall back to the
    // unsimplified expression — same fail-closed behavior as the leaf cap.
    r = e;
  }
  const ms = Date.now() - t0;
  if (ms > 1000 && process.env.RUBI_DEBUG)
    console.error(`slow simplify ${ms}ms: ${e.toString().slice(0, 120)}`);
  activeCaches?.simplify.set(key, r);
  return r;
}

/** Rubi PossibleZeroQ: canonical zero, simplified zero, or numerically ~0 */
export function zeroQ(d: Expression): boolean {
  if (d.isSame(0)) return true;
  const key = activeCaches ? d.toString() : '';
  const cached = activeCaches?.zeroQ.get(key);
  if (cached !== undefined) return cached;
  let result = false;
  const s = safeSimplify(d);
  if (s.isSame(0)) result = true;
  else {
    const n = s.N();
    if (isNumber(n) && typeof n.re === 'number' && typeof n.im === 'number')
      result = Math.abs(n.re) < 1e-12 && Math.abs(n.im) < 1e-12;
  }
  activeCaches?.zeroQ.set(key, result);
  return result;
}

function isLiteralInteger(e: Expression): boolean {
  return isNumber(e) && e.isInteger === true;
}
function isLiteralRational(e: Expression): boolean {
  return isNumber(e) && e.isRational === true;
}

/** literal rational → [numerator, denominator] as machine numbers */
function ratParts(e: Expression): [number, number] | null {
  if (!isLiteralRational(e)) return null;
  const num = e.numerator.re;
  const den = e.denominator.re;
  if (typeof num !== 'number' || typeof den !== 'number') return null;
  return [num, den];
}

/** Rubi NumericFactor/NonnumericFactors split of a term: the leading
 * rational coefficient and the remaining (non-numeric) factors. */
function splitNumericFactor(u: Expression): {
  coef: number;
  rest: Expression;
} {
  const ce = u.engine;
  const r = ratParts(u);
  if (r) return { coef: r[0] / r[1], rest: ce.One };
  if (u.operator === 'Negate' && u.ops) {
    const inner = splitNumericFactor(u.ops[0]);
    return { coef: -inner.coef, rest: inner.rest };
  }
  if (u.operator === 'Multiply' && u.ops) {
    let coef = 1;
    const rest: Expression[] = [];
    for (const f of u.ops) {
      const fr = ratParts(f);
      if (fr) coef *= fr[0] / fr[1];
      else rest.push(f);
    }
    return {
      coef,
      rest:
        rest.length === 0
          ? ce.One
          : rest.length === 1
            ? rest[0]
            : ce.function('Multiply', rest),
    };
  }
  return { coef: 1, rest: u };
}

/** Rubi SumSimplerAuxQ — recursion over (expanded) sum terms:
 * - v a sum: every term of v is rational or aux-simpler wrt u
 * - u a sum: some term of u is aux-simpler wrt v
 * - both terms: v ≠ 0, same non-numeric factors, and the numeric-factor
 *   ratio nf(u)/nf(v) < −1/2 (or = −1/2 with nf(u) < 0) */
function sumSimplerAuxQ(u: Expression, v: Expression): boolean {
  if (v.operator === 'Add' && v.ops)
    return v.ops.every((t) => isLiteralRational(t) || sumSimplerAuxQ(u, t));
  if (u.operator === 'Add' && u.ops)
    return u.ops.some((t) => sumSimplerAuxQ(t, v));
  if (v.isSame(0)) return false;
  const su = splitNumericFactor(u);
  const sv = splitNumericFactor(v);
  if (!su.rest.isSame(sv.rest)) return false;
  const q = su.coef / sv.coef;
  return q < -0.5 || (q === -0.5 && su.coef < 0);
}

// ---------------------------------------------------------------------------
// Predicates — FAIL-CLOSED (undecidable ⇒ false)
// ---------------------------------------------------------------------------

type PredFn = (args: Json[], ctx: Ctx) => boolean;

export function evalCondition(json: Json, ctx: Ctx): boolean {
  if (typeof json === 'string') {
    if (json === 'True') return true;
    if (json === 'False') return false;
    // SimplifyFlag and friends — not in steps mode
    return fail(`bare symbol condition '${json}'`);
  }
  if (!Array.isArray(json)) return fail('non-predicate condition');
  const [head, ...args] = json;
  if (head === 'And') return args.every((a) => evalCondition(a, ctx));
  if (head === 'Or') return args.some((a) => evalCondition(a, ctx));
  if (head === 'Not') return !evalCondition(args[0], ctx);
  const f = PRED_FNS[head as string];
  if (!f) return fail(`unimplemented predicate ${head}`);
  return f(args, ctx);
}

/** Identify the first failing conjunct of a condition (for trace census).
 * Returns a short head-path like "Not(GtQ)" or "IntLinearQ". */
export function findFailingConjunct(json: Json, ctx: Ctx): string {
  try {
    if (Array.isArray(json)) {
      const [head, ...args] = json;
      if (head === 'And') {
        for (const a of args)
          if (!evalCondition(a, ctx)) return findFailingConjunct(a, ctx);
        return 'And(?)';
      }
      if (head === 'Or') {
        // all disjuncts failed; report the first's diagnosis
        return `Or(${args.length === 0 ? '?' : findFailingConjunct(args[0], ctx)})`;
      }
      if (head === 'Not') {
        const inner = args[0];
        const ih = Array.isArray(inner) ? String(inner[0]) : String(inner);
        return `Not(${ih})`;
      }
      return String(head);
    }
    return String(json);
  } catch (e) {
    return `throw:${String(e).slice(0, 40)}`;
  }
}

const PRED_FNS: Record<string, PredFn> = {
  // FreeQ[u, x] / FreeQ[{u1, u2, …}, x]
  FreeQ: (args, ctx) => {
    const targets =
      Array.isArray(args[0]) && args[0][0] === 'List'
        ? (args[0] as Json[]).slice(1)
        : [args[0]];
    return targets.every((t) => !build(t, ctx).has(ctx.x));
  },

  // EqQ[u, v] := PossibleZeroQ[u - v]; NeQ is its negation
  EqQ: (args, ctx) => zeroQ(build(args[0], ctx).sub(build(args[1], ctx))),
  NeQ: (args, ctx) => !zeroQ(build(args[0], ctx).sub(build(args[1], ctx))),

  // GtQ/LtQ/GeQ/LeQ: real-number comparisons (2- and 3-arg chained);
  // symbolic operands ⇒ false (Rubi's RealNumberQ gate, Refine omitted)
  GtQ: (args, ctx) => cmpChain(args, ctx, (a, b) => a > b),
  LtQ: (args, ctx) => cmpChain(args, ctx, (a, b) => a < b),
  GeQ: (args, ctx) => cmpChain(args, ctx, (a, b) => a >= b),
  LeQ: (args, ctx) => cmpChain(args, ctx, (a, b) => a <= b),

  IntegerQ: (args, ctx) => isLiteralInteger(build(args[0], ctx).evaluate()),
  IntegersQ: (args, ctx) =>
    args.every((a) => isLiteralInteger(build(a, ctx).evaluate())),
  // RationalQ: literal integer or rational (each argument)
  RationalQ: (args, ctx) =>
    args.every((a) => isLiteralRational(build(a, ctx).evaluate())),
  // FractionQ: literal Rational with denominator ≠ 1 (each argument)
  FractionQ: (args, ctx) =>
    args.every((a) => {
      const e = build(a, ctx).evaluate();
      return isLiteralRational(e) && e.isInteger === false;
    }),

  // IGtQ[u,n] := IntegerQ[u] && u > n, and family
  IGtQ: (args, ctx) => intCmp(args, ctx, (a, b) => a > b),
  ILtQ: (args, ctx) => intCmp(args, ctx, (a, b) => a < b),
  IGeQ: (args, ctx) => intCmp(args, ctx, (a, b) => a >= b),
  ILeQ: (args, ctx) => intCmp(args, ctx, (a, b) => a <= b),

  // PosQ/NegQ — sign heuristics (Rubi PosAux); symbols count as positive
  PosQ: (args, ctx) => posQ(safeSimplify(build(args[0], ctx))),
  NegQ: (args, ctx) => {
    const u = safeSimplify(build(args[0], ctx));
    return !posQ(u) && !zeroQ(u);
  },

  // PolyQ[u, x] / PolyQ[u, x, n]
  PolyQ: (args, ctx) => {
    const u = build(args[0], ctx);
    const deg = polyDegreeX(u, ctx.x);
    if (args.length === 2) return deg >= 0;
    const n = realNum(build(args[2], ctx));
    if (n === null || deg !== n) return false;
    const coeffs = polyCoeffsX(u, ctx.x);
    return coeffs !== null && !coeffs[deg].evaluate().isSame(0);
  },
  LinearQ: (args, ctx) => mapList(args[0], ctx, (u) => linearQ(u, ctx)),
  // LinearMatchQ: matches the *literal* form a. + b.*x (stricter than
  // LinearQ, which allows anything that simplifies to linear)
  LinearMatchQ: (args, ctx) =>
    mapList(args[0], ctx, (u) => linearMatchQ(u, ctx)),
  MonomialQ: (args, ctx) =>
    mapList(args[0], ctx, (u) => monomialQ(u, ctx)),

  // SimplerQ[u, v] — is u simpler than v (drives canonical swaps);
  // transcribed integer/fraction cases, leaf-count fallback
  SimplerQ: (args, ctx) =>
    simplerQ(build(args[0], ctx).evaluate(), build(args[1], ctx).evaluate()),

  // SumSimplerQ[u, v] — is u+v simpler than u (reduction direction);
  // exact transcription of Rubi's definition (rational case + the
  // SumSimplerAuxQ recursion over expanded sum terms), so symbolic
  // reductions like SumSimplerQ[-m-2, 1] hold (−m−1 is simpler)
  SumSimplerQ: (args, ctx) => {
    const u = build(args[0], ctx).evaluate();
    const v = build(args[1], ctx).evaluate();
    const ur = realNum(u);
    const vr = realNum(v);
    if (
      ur !== null &&
      vr !== null &&
      isLiteralRational(u) &&
      isLiteralRational(v)
    ) {
      if (vr === 0) return false;
      return vr > 0 ? ur < -1 : ur >= -vr;
    }
    return sumSimplerAuxQ(expand(u), expand(v));
  },

  // IntLinearQ[a,b,c,d,m,n,x] — gate for (a+bx)^m(c+dx)^n reductions:
  // IntegerQ[m] || IntegerQ[n] || IntegersQ[3m,3n] || IntegersQ[4m,4n] ||
  // IntegersQ[2m,2n] || IntegersQ[m+n] (Rubi 4.17 definition)
  IntLinearQ: (args, ctx) => {
    const m = build(args[4], ctx).evaluate();
    const n = build(args[5], ctx).evaluate();
    const ints = (k: number): boolean =>
      isLiteralInteger(m.mul(k).evaluate()) &&
      isLiteralInteger(n.mul(k).evaluate());
    return (
      isLiteralInteger(m) ||
      isLiteralInteger(n) ||
      ints(3) ||
      ints(4) ||
      ints(2) ||
      isLiteralInteger(m.add(n).evaluate())
    );
  },

  // MatchQ — single 1.1.1 use: Not[MatchQ[Fx, b_*Gx_ /; FreeQ[b,x]]],
  // i.e. "Fx is not a constant-times-product". Specialized accordingly.
  MatchQ: (args, ctx) => {
    const u = build(args[0], ctx);
    if (u.operator !== 'Multiply' || !u.ops) return false;
    return u.ops.some((op) => !op.has(ctx.x));
  },
};

function cmpChain(
  args: Json[],
  ctx: Ctx,
  cmp: (a: number, b: number) => boolean
): boolean {
  // numeric first; fall back to simplification (symbolic ratios like
  // b/(b·c−a·d) after a normalization step can simplify to a number —
  // several Rubi guards rely on this to stop rule refiring), then to
  // multivariate rational collapse (nested-rational identities that
  // Mathematica's automatic Together would have flattened)
  const vals = args.map((a) => {
    const e = build(a, ctx);
    return realNum(e) ?? realNum(safeSimplify(e)) ?? ratConstant(e);
  });
  for (let i = 0; i + 1 < vals.length; i++) {
    const a = vals[i];
    const b = vals[i + 1];
    if (a === null || b === null || !cmp(a, b)) return false;
  }
  return true;
}

function intCmp(
  args: Json[],
  ctx: Ctx,
  cmp: (a: number, b: number) => boolean
): boolean {
  const u = build(args[0], ctx).evaluate();
  if (!isLiteralInteger(u)) return false;
  const a = realNum(u);
  const b = realNum(build(args[1], ctx));
  return a !== null && b !== null && cmp(a, b);
}

// Rubi PosAux (sign heuristic): numbers by value; symbols positive;
// products multiply signs; sums take the first term; even powers positive.
function posAux(u: Expression): boolean {
  const r = realNum(u);
  if (r !== null) return r > 0;
  const n = u.N();
  if (isNumber(n) && typeof n.re === 'number' && typeof n.im === 'number') {
    return n.re !== 0 ? n.re > 0 : n.im > 0;
  }
  if (u.symbol) return true;
  if (u.operator === 'Power' && u.ops) {
    const e = u.ops[1];
    if (isLiteralInteger(e)) {
      const k = realNum(e);
      return k !== null && k % 2 === 0 ? true : posAux(u.ops[0]);
    }
    return true;
  }
  if (u.operator === 'Multiply' && u.ops)
    return u.ops.reduce((sign, op) => (posAux(op) ? sign : !sign), true);
  // Quotients follow the same sign algebra as products. Without this case
  // −1/b (canonical ["Divide", -1, "b"]) fell through to the default
  // `true`, so PosQ[a/b] mis-routed ∫1/(a+b·x²) to the ArcTan rule where
  // the ArcTanh rule applies — a SIGN-FLIPPED antiderivative (3 of the 4
  // "solved-wrong" results in the 1.1.1 sample).
  if (u.operator === 'Divide' && u.ops)
    return posAux(u.ops[0]) === posAux(u.ops[1]);
  if (u.operator === 'Negate' && u.ops) return !posAux(u.ops[0]);
  // Rubi: PosAux[u_ + v_] := PosAux[First[u]] — but First[] under
  // MATHEMATICA's Plus ordering: terms compare by their sorted symbol
  // sequence read from the END (reverse-lexicographic), constants first,
  // numeric coefficients ignored. Examples that pin this down: x + y + x·y
  // (y before x·y), and b·c − a·d ≡ Plus[b·c, −a·d] (b·c first, because
  // c < d at the last position) — which is why Rubi sources write the
  // discriminant as b·c − a·d and treat it as having "positive form".
  // CE's canonical order differs, which mis-routed branch-sensitive
  // rules (∫1/√(a+b·x⁴) NegQ vs PosQ chains).
  if (u.operator === 'Add' && u.ops) return posAux(mmaFirstTerm(u.ops));
  return true;
}

/** Rubi PosQ[u] := PosAux[TogetherSimplify[u]] — the Together step is
 * semantic, not cosmetic: PosAux[a − bc/d] has First = a (positive form)
 * while the together'd (a·d − b·c)/d has First = −b·c (negative form).
 * Emulated with the asNumDen/expand rational normalizer. */
function posQ(e: Expression): boolean {
  try {
    const { num, den } = asNumDen(e);
    if (den.isSame(e.engine.One)) return posAux(expand(num));
    return posAux(expand(num)) === posAux(expand(den));
  } catch {
    return posAux(e);
  }
}

function mmaFirstTerm(ops: readonly Expression[]): Expression {
  let best: Expression | null = null;
  let bestKey: string[] = [];
  for (const op of ops) {
    const key = mmaTermKey(op);
    if (best === null || mmaKeyLess(key, bestKey)) {
      best = op;
      bestKey = key;
    }
  }
  return best!;
}

/** sorted symbol leaves of a term, reversed (MMA compares monomials from
 * their trailing factor) */
function mmaTermKey(e: Expression): string[] {
  const syms: string[] = [];
  collectSymbolLeaves(e, syms);
  syms.sort();
  syms.reverse();
  return syms;
}

function mmaKeyLess(a: string[], b: string[]): boolean {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++)
    if (a[i] !== b[i]) return a[i] < b[i];
  return a.length < b.length;
}

function collectSymbolLeaves(e: Expression, out: string[]): void {
  if (e.symbol) {
    out.push(e.symbol);
    return;
  }
  // monomial degree matters: a·d² keys as [a,d,d] (else it compares
  // equal-prefix-shorter against b·c·d and steals First[] from it)
  if (e.operator === 'Power' && e.ops) {
    const k = e.ops[1].re;
    if (
      e.ops[1].isInteger &&
      typeof k === 'number' &&
      k > 1 &&
      k <= 16
    ) {
      const inner: string[] = [];
      collectSymbolLeaves(e.ops[0], inner);
      for (let i = 0; i < k; i++) out.push(...inner);
      return;
    }
  }
  if (e.ops) for (const op of e.ops) collectSymbolLeaves(op, out);
}

function mapList(
  arg: Json,
  ctx: Ctx,
  f: (u: Expression) => boolean
): boolean {
  const items =
    Array.isArray(arg) && arg[0] === 'List'
      ? (arg as Json[]).slice(1)
      : [arg];
  return items.every((a) => f(build(a, ctx)));
}

function linearQ(u: Expression, ctx: Ctx): boolean {
  return polyDegreeX(u, ctx.x) === 1;
}

// literal a. + b.*x shape (no Together-normalization)
function linearMatchQ(u: Expression, ctx: Ctx): boolean {
  const x = ctx.x;
  const isBX = (t: Expression): boolean => {
    if (t.symbol === x) return true;
    return (
      t.operator === 'Multiply' &&
      !!t.ops &&
      t.ops.filter((o) => o.symbol === x).length === 1 &&
      t.ops.every((o) => o.symbol === x || !o.has(x))
    );
  };
  if (!u.has(x)) return false;
  if (isBX(u)) return true;
  return (
    u.operator === 'Add' &&
    !!u.ops &&
    u.ops.filter((t) => !t.has(x)).length === u.ops.length - 1 &&
    u.ops.some((t) => isBX(t))
  );
}

function monomialQ(u: Expression, ctx: Ctx): boolean {
  const x = ctx.x;
  if (u.symbol === x) return true;
  if (u.operator === 'Power' && u.ops)
    return u.ops[0].symbol === x && !u.ops[1].has(x);
  if (u.operator === 'Multiply' && u.ops)
    return (
      u.ops.filter((o) => o.has(x)).length === 1 &&
      u.ops.every((o) => !o.has(x) || monomialQ(o, ctx))
    );
  return false;
}

// Rubi SimplerQ — integer < fraction < complex < everything; ties by
// magnitude; non-numbers by leaf count.
function simplerQ(u: Expression, v: Expression): boolean {
  if (isLiteralInteger(u)) {
    if (!isLiteralInteger(v)) return true;
    const a = realNum(u)!;
    const b = realNum(v)!;
    if (a === b) return false;
    if (a === -b) return b < 0;
    return Math.abs(a) < Math.abs(b);
  }
  if (isLiteralInteger(v)) return false;
  const ur = ratParts(u);
  const vr = ratParts(v);
  if (ur) {
    if (!vr) return true;
    if (ur[1] === vr[1]) return Math.abs(ur[0]) < Math.abs(vr[0]);
    return ur[1] < vr[1];
  }
  if (vr) return false;
  return leafCount(u) < leafCount(v);
}

function leafCount(e: Expression): number {
  if (!e.ops) return 1;
  return 1 + e.ops.reduce((s, op) => s + leafCount(op), 0);
}

// ---------------------------------------------------------------------------
// Value utilities
// ---------------------------------------------------------------------------

type ValueFn = (args: Json[], ctx: Ctx) => Expression;

const VALUE_FNS: Record<string, ValueFn> = {
  // Simp[u, x] — Rubi's local normalizer; approximated by simplify()
  Simp: (args, ctx) => safeSimplify(build(args[0], ctx)),
  Simplify: (args, ctx) => safeSimplify(build(args[0], ctx)),
  Identity: (args, ctx) => build(args[0], ctx),

  // Rt[u, n] := RtAux[TogetherSimplify[u], n] — canonical n-th root;
  // approximated by simplify + exact Power fold
  Rt: (args, ctx) => {
    const u = safeSimplify(build(args[0], ctx));
    const n = build(args[1], ctx);
    const r = u.pow(ctx.ce.One.div(n)).evaluate();
    if (process.env.RUBI_DEBUG_RT)
      console.error(
        `Rt[${u.toString().slice(0, 90)}, ${n.toString()}] -> ${r.toString().slice(0, 90)}`
      );
    return r;
  },

  // IntPart/FracPart: rational → integer/fractional part (toward zero);
  // sums map; otherwise 0 / u  (IntegrationUtilityFunctions.m)
  IntPart: (args, ctx) =>
    intFracPart(build(args[0], ctx).evaluate(), ctx.ce, 'int'),
  FracPart: (args, ctx) =>
    intFracPart(build(args[0], ctx).evaluate(), ctx.ce, 'frac'),

  // ExpandToSum[u, x] — expand to a sum of monomials with COLLECTED
  // coefficients (Mathematica: Σ Coeff[u,x,k]·x^k). The collection matters:
  // normalization rules like Int[u_^m_] := Int[ExpandToSum[u,x]^m,x] rely
  // on the result matching a_.+b_.*x_ afterwards, and rule RHSs emit
  // Divide-wrapped linear forms (e.g. (b·d·a²·x+d·a³)/b − a·b·c·x − c·a²)
  // that plain expansion leaves structurally unmatchable.
  // ExpandToSum[u, v, x] — distribute u over the expansion of v
  ExpandToSum: (args, ctx) => {
    if (args.length === 2) {
      const u = build(args[0], ctx);
      const coeffs = polyCoeffsX(u, ctx.x);
      if (coeffs !== null) {
        const X = ctx.ce.symbol(ctx.x);
        const terms: Expression[] = [];
        coeffs.forEach((c, k) => {
          if (!c.isSame(0)) terms.push(k === 0 ? c : c.mul(X.pow(k)));
        });
        if (terms.length === 0) return ctx.ce.Zero;
        return terms.length === 1 ? terms[0] : ctx.ce.function('Add', terms);
      }
      return expand(u);
    }
    const u = build(args[0], ctx);
    const v = expand(build(args[1], ctx));
    if (v.operator === 'Add' && v.ops)
      return ctx.ce.function(
        'Add',
        v.ops.map((t) => u.mul(t))
      );
    return u.mul(v);
  },

  // ExpandIntegrand[u, x] — partial-fraction/distribution expansion.
  // Covers: plain distribution, and P(x)·linⁿ (n a negative integer) via
  // repeated polynomial division (P·Lⁿ = r·Lⁿ + q·Lⁿ⁺¹). Other shapes
  // fail the rule (coverage gap measured by the harness).
  ExpandIntegrand: (args, ctx) => {
    if (args.length !== 2) return fail('ExpandIntegrand arity');
    const u = build(args[0], ctx);
    const e = expand(u);
    if (e.operator === 'Add') return e;
    return expandPolyOverLinear(u, ctx);
  },

  // RemoveContent[u, x] — drops a constant content factor; returning u
  // unchanged is antiderivative-safe (differs by a constant)
  RemoveContent: (args, ctx) => build(args[0], ctx),

  Coefficient: (args, ctx) => coeff(args, ctx),
  Coeff: (args, ctx) => coeff(args, ctx),
  // Expon[u, x] = degree; Expon[u, x, Min] = minimum exponent
  Expon: (args, ctx) => {
    const u = build(args[0], ctx);
    const d = polyDegreeX(u, ctx.x);
    if (d < 0) return fail('Expon: not a polynomial');
    if (args.length >= 3 && args[2] === 'Min') {
      const coeffs = polyCoeffsX(u, ctx.x);
      if (coeffs === null) return fail('Expon: not a polynomial');
      const min = coeffs.findIndex((c) => !c.evaluate().isSame(0));
      return ctx.ce.number(min < 0 ? 0 : min);
    }
    return ctx.ce.number(d);
  },
  PolynomialQuotient: (args, ctx) => polyDiv(args, ctx)[0],
  PolynomialRemainder: (args, ctx) => polyDiv(args, ctx)[1],
  Denominator: (args, ctx) => build(args[0], ctx).denominator,
  Numerator: (args, ctx) => build(args[0], ctx).numerator,

  D: (args, ctx) =>
    ctx.ce
      .function('D', [build(args[0], ctx), ctx.ce.symbol(ctx.x)])
      .evaluate(),

  IntegerPart: (args, ctx) => {
    const r = realNum(build(args[0], ctx));
    if (r === null) return fail('IntegerPart: not numeric');
    return ctx.ce.number(Math.trunc(r));
  },
  FractionalPart: (args, ctx) => {
    const r = realNum(build(args[0], ctx));
    if (r === null) return fail('FractionalPart: not numeric');
    return ctx.ce.number(r - Math.trunc(r));
  },

  // Rubi gives up explicitly — fail the rule; the driver then returns
  // its own inert form
  CannotIntegrate: () => fail('CannotIntegrate'),
  // Unintegrable[u, x] is Rubi's other give-up head (the integral is known
  // to have no closed form in terms of the supported functions). Letting it
  // through as an ordinary function node produces huge pseudo-results that
  // blow up verification — fail the rule instead.
  Unintegrable: () => fail('Unintegrable'),
};

function intFracPart(
  u: Expression,
  ce: ComputeEngine,
  part: 'int' | 'frac'
): Expression {
  const r = ratParts(u);
  if (r) {
    const [num, den] = r;
    const ip = Math.trunc(num / den);
    return part === 'int'
      ? ce.number(ip)
      : ce.box(['Rational', num - ip * den, den] as any).evaluate();
  }
  if (u.operator === 'Add' && u.ops)
    return ce.function(
      'Add',
      u.ops.map((t) => intFracPart(t, ce, part))
    );
  return part === 'int' ? ce.Zero : u;
}

// P(x) · L(x)ⁿ with n a literal non-natural exponent (negative integer or
// any rational) and L a polynomial: expand P in powers of L by repeated
// division — P·Lⁿ = r₀·Lⁿ + q₀·Lⁿ⁺¹ = r₀·Lⁿ + r₁·Lⁿ⁺¹ + … . This is the
// workhorse of Rubi's ExpandIntegrand for (a+bx)^m (c+dx)^n shapes.
function expandPolyOverLinear(u: Expression, ctx: Ctx): Expression {
  const ce = ctx.ce;
  const x = ctx.x;
  // canonical construction reintroduces Divide forms — re-normalize
  u = toTimesPower(ce, u);
  const factors = u.operator === 'Multiply' && u.ops ? [...u.ops] : [u];

  let divisor: Expression | null = null;
  let n: Expression | null = null;
  const polyParts: Expression[] = [];
  for (const f of factors) {
    // expandable divisor: L^e with e either a literal rational that is NOT
    // a non-negative integer (negative integer, or any fraction), or a
    // symbolic exponent free of x (Rubi's ExpandLinearProduct shape:
    // P(x)·(a+bx)^n expands by the same repeated division, with the
    // exponents n, n+1, … kept symbolic)
    const e = f.operator === 'Power' && f.ops ? f.ops[1] : null;
    const isExpandableBase =
      e !== null &&
      polyDegreeX(f.ops![0], x) >= 1 &&
      (isNumber(e)
        ? e.isRational === true &&
          !(e.isInteger === true && (realNum(e) ?? 0) >= 0)
        : !e.has(x));
    if (isExpandableBase) {
      if (divisor !== null) {
        // multiple denominators → partial fractions over linear factors
        return expandPartialFractions(u, ctx);
      }
      divisor = f.ops![0];
      n = f.ops![1];
    } else if (polyDegreeX(f, x) >= 0) polyParts.push(f);
    else return fail('ExpandIntegrand: non-polynomial factor');
  }
  if (divisor === null || n === null)
    return fail('ExpandIntegrand: no expansion shape');

  let P = expand(
    polyParts.length === 0
      ? ce.One
      : polyParts.length === 1
        ? polyParts[0]
        : ce.function('Multiply', polyParts)
  );
  if (polyDegreeX(P, x) < 0)
    return fail('ExpandIntegrand: numerator not a polynomial');

  const terms: Expression[] = [];
  let k = 0;
  for (let guard = 0; !P.isSame(0) && guard < 64; guard++) {
    const exponent = n.add(k).evaluate();
    if (polyDegreeX(P, x) < polyDegreeX(divisor, x)) {
      terms.push(P.mul(powOrOne(divisor, exponent)));
      P = ce.Zero;
      break;
    }
    const qr = polyDivideX(P, divisor, x);
    if (qr === null) return fail('ExpandIntegrand: division failed');
    const [q, r] = qr;
    if (!r.isSame(0)) terms.push(r.evaluate().mul(powOrOne(divisor, exponent)));
    P = q.evaluate();
    k++;
  }
  if (terms.length === 0) return ce.Zero;
  if (terms.length === 1) return terms[0];
  return ce.function('Add', terms);
}

function powOrOne(base: Expression, exp: Expression): Expression {
  if (exp.isSame(0)) return base.engine.One;
  if (exp.isSame(1)) return base;
  return base.pow(exp);
}

// P(x) / ∏ Lᵢ(x)^{kᵢ} with distinct linear factors Lᵢ = aᵢ + bᵢ·x and
// positive integer multiplicities kᵢ: classic partial fractions via the
// Heaviside derivative formula. Returns a sum of polynomial terms (from
// the leading division) and cᵢⱼ·Lᵢ^{−j} fraction terms.
function expandPartialFractions(u: Expression, ctx: Ctx): Expression {
  const ce = ctx.ce;
  const x = ctx.x;
  const X = ce.symbol(x);
  const factors = u.operator === 'Multiply' && u.ops ? [...u.ops] : [u];

  const divisors: { L: Expression; a: Expression; b: Expression; k: number }[] =
    [];
  const polyParts: Expression[] = [];
  for (const f of factors) {
    const e = f.operator === 'Power' && f.ops ? f.ops[1] : null;
    if (e !== null && isLiteralInteger(e) && (realNum(e) ?? 0) < 0) {
      const base = f.ops![0];
      if (polyDegreeX(base, x) !== 1)
        return fail('ExpandIntegrand: non-linear denominator factor');
      const coeffs = polyCoeffsX(base, x);
      if (coeffs === null) return fail('ExpandIntegrand: bad denominator');
      divisors.push({
        L: base,
        a: coeffs[0].evaluate(),
        b: coeffs[1].evaluate(),
        k: -(realNum(e) ?? 0),
      });
    } else if (polyDegreeX(f, x) >= 0) polyParts.push(f);
    else return fail('ExpandIntegrand: non-polynomial factor (pf)');
  }
  if (divisors.length < 2) return fail('ExpandIntegrand: pf needs ≥2 factors');

  // distinct roots: bᵢ·aₗ − bₗ·aᵢ ≠ 0 for every pair (fail-closed only on
  // a provable shared root; symbolic parameters are assumed distinct, the
  // calling rules guard with NeQ anyway)
  for (let i = 0; i < divisors.length; i++)
    for (let l = i + 1; l < divisors.length; l++) {
      const det = divisors[i].b
        .mul(divisors[l].a)
        .sub(divisors[l].b.mul(divisors[i].a))
        .evaluate();
      if (zeroQ(det)) return fail('ExpandIntegrand: repeated linear factor');
    }

  let P = expand(
    polyParts.length === 0
      ? ce.One
      : polyParts.length === 1
        ? polyParts[0]
        : ce.function('Multiply', polyParts)
  );
  if (polyDegreeX(P, x) < 0)
    return fail('ExpandIntegrand: numerator not a polynomial (pf)');

  const terms: Expression[] = [];

  // leading polynomial part: divide P by the full denominator
  const totalK = divisors.reduce((s, d) => s + d.k, 0);
  if (polyDegreeX(P, x) >= totalK) {
    let den: Expression = ce.One;
    for (const d of divisors) den = den.mul(d.L.pow(d.k));
    const qr = polyDivideX(P, expand(den), x);
    if (qr === null) return fail('ExpandIntegrand: pf division failed');
    const [q, r] = qr;
    const qx = expand(q.evaluate());
    if (qx.operator === 'Add' && qx.ops) terms.push(...qx.ops);
    else if (!qx.isSame(0)) terms.push(qx);
    P = r.evaluate();
  }

  // Heaviside coefficients: r̃ = P / ∏ bᵢ^{kᵢ} over monic factors
  let B: Expression = ce.One;
  for (const d of divisors) B = B.mul(d.b.pow(d.k));
  for (let i = 0; i < divisors.length; i++) {
    const di = divisors[i];
    const root = di.a.neg().div(di.b).evaluate();
    // gᵢ = (P/B) · ∏_{l≠i} (x − x_l)^{−k_l}
    let g = P.div(B);
    for (let l = 0; l < divisors.length; l++) {
      if (l === i) continue;
      const rl = divisors[l].a.neg().div(divisors[l].b).evaluate();
      g = g.mul(X.sub(rl).pow(-divisors[l].k));
    }
    let fact = 1;
    for (let m = 0; m < di.k; m++) {
      const j = di.k - m; // power of Lᵢ in this term
      const c = safeSimplify(
        g.subs({ [x]: root }).evaluate().div(fact)
      );
      if (!c.isSame(0))
        terms.push(c.mul(di.b.pow(j)).mul(powOrOne(di.L, ce.number(-j))));
      if (m + 1 < di.k) {
        g = ce.function('D', [g, X]).evaluate();
        fact *= m + 1;
      }
    }
  }
  if (terms.length === 0) return ce.Zero;
  if (terms.length === 1) return terms[0];
  return ce.function('Add', terms);
}

function coeff(args: Json[], ctx: Ctx): Expression {
  const u = build(args[0], ctx);
  const n =
    args.length >= 3 ? (realNum(build(args[2], ctx)) ?? NaN) : 1;
  if (!Number.isInteger(n)) return fail('Coefficient: non-integer degree');
  const coeffs = polyCoeffsX(u, ctx.x);
  if (coeffs === null) return fail('Coefficient: not a polynomial');
  return (coeffs[n] ?? ctx.ce.Zero).evaluate();
}

function polyDiv(args: Json[], ctx: Ctx): [Expression, Expression] {
  const q = polyDivideX(
    build(args[0], ctx),
    build(args[1], ctx),
    ctx.x
  );
  if (q === null) return fail('PolynomialQuotient: division failed');
  return q;
}

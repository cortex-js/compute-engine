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

import type { Expr as Expression, Json } from './types';
import type { IComputeEngine as ComputeEngine } from '../types-engine';
import { isNumber } from '../boxed-expression/type-guards';

import { expand } from '../boxed-expression/expand';

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
      return ce.expr(json as any);
    case 'List':
      return ce.function(
        'List',
        args.map((a) => build(a, ctx))
      );
  }

  const valueFn = VALUE_FNS[head];
  if (valueFn) return valueFn(args, ctx);
  if (PRED_FNS[head] || head === 'And' || head === 'Or' || head === 'Not')
    return ce.symbol(evalCondition(json, ctx) ? 'True' : 'False');

  // ordinary mathematical head (already CE-named by the translator)
  return ce.function(
    head,
    args.map((a) => build(a, ctx))
  );
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
    if (
      Math.abs(p) > 1000 ||
      Math.abs(c - p / q) > 1e-9 * Math.max(1, Math.abs(c))
    )
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
function monomialsX(u: Expression, x: string): [Expression, number][] | null {
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
      return [
        ...m0,
        ...m1.map(([c, d]) => [c.neg(), d] as [Expression, number]),
      ];
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
      const ex: Expression = expand(u);
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
export function polyCoeffsX(u: Expression, x: string): Expression[] | null {
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

/** Snapshot the currently-installed caches so a re-entrant driver call can
 * restore the outer call's warm caches after installing its own (see the
 * native-rational fallback re-entry in driver.ts). */
export function getActiveCaches(): Ctx['caches'] | undefined {
  return activeCaches;
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
  if (head === 'If') {
    const branch = evalCondition(args[0], ctx) ? args[1] : args[2];
    return branch === undefined ? false : evalCondition(branch, ctx);
  }
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

/** u − v for binary EqQ/NeQ, or just u for the unary form (compare to 0). */
function eqDelta(args: Json[], ctx: Ctx): Expression {
  const u = build(args[0], ctx);
  return args.length >= 2 ? u.sub(build(args[1], ctx)) : u;
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

  // InertTrigFreeQ[u] := FreeQ of every inert trig head (sin/cos/…). Gates the
  // Chapter-4 dispatch rules that must only fire on a fully inert working form.
  InertTrigFreeQ: (args, ctx) => !hasInertTrig(build(args[0], ctx)),

  // FalseQ[u] := u === False. A predicate sub-expression collapses to the
  // True/False symbol when built (build() dispatches PRED_FNS that way), so a
  // structural identity check suffices.
  FalseQ: (args, ctx) => build(args[0], ctx).symbol === 'False',

  // TrueQ[u] := u === True (WL: True only when u is literally the symbol True).
  // The Chapter-2 rules gate on TrueQ[$UseGamma]: $UseGamma is unset (a global
  // defaulting to False), so TrueQ[$UseGamma] is False and the
  // Not[TrueQ[$UseGamma]] ExpandIntegrand branch fires (the Gamma-form branch is
  // its $UseGamma=True counterpart). Without this the whole Px·Fᵛ
  // polynomial×exponential family fails closed on an unimplemented predicate.
  TrueQ: (args, ctx) => build(args[0], ctx).symbol === 'True',

  // InverseFunctionFreeQ[u, x] := u contains no inverse function, logarithm,
  // hypergeometric, or calculus head involving x.
  InverseFunctionFreeQ: (args, ctx) =>
    inverseFunctionFreeQ(build(args[0], ctx), ctx.x),

  // FunctionOfQ[v, u, x, pure?] — gates the trig-substitution rules 4.7.5
  // #15–#34: is u a (pure) function of the trig substitution variable v?
  // Restricted to the pure sin/cos/tan/cot targets this slice handles (the
  // 4-arg `…,True` form); declines (false) otherwise. See substFor below.
  FunctionOfQ: (args, ctx) => {
    const pure = args.length >= 4 && args[3] === 'True';
    return functionOfQ(
      ctx.ce,
      build(args[0], ctx),
      build(args[1], ctx),
      ctx.x,
      pure
    );
  },

  // FunctionOfExponentialQ[u, x] — u is a function of a single F^v (F constant,
  // v linear in x) with an explicit exponential present. Gates the master
  // exponential-substitution rule 2.3#97.
  FunctionOfExponentialQ: (args, ctx) =>
    functionOfExponentialQ(build(args[0], ctx), ctx.x),

  // HyperbolicQ[u] — u's head is a hyperbolic function (Sinh/Cosh/…). Used by
  // the Chapter-6 dispatch and the FunctionOfExponential hyperbolic branch.
  HyperbolicQ: (args, ctx) =>
    HYPERBOLIC_HEADS.has(build(args[0], ctx).operator),

  // EqQ[u, v] := PossibleZeroQ[u - v]; NeQ is its negation. Rubi also
  // defines the unary forms EqQ[u] := PossibleZeroQ[u] (test u == 0) and
  // NeQ[u] := !PossibleZeroQ[u], used e.g. by 1.2.1.4#11 (NeQ[e²−4df]) and
  // 1.2.4.2#4 (EqQ[m+1/2]) — handle the missing second operand as 0.
  EqQ: (args, ctx) => zeroQ(eqDelta(args, ctx)),
  NeQ: (args, ctx) => !zeroQ(eqDelta(args, ctx)),

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

  // PolyQ[u, x] / PolyQ[u, x, n] / PolyQ[u, x^k] — the x^k form means
  // "polynomial in x^k": only exponents divisible by k. (Treating it as
  // plain poly-in-x made 1.1.2.11#4 fire on −2b−K·x, whose tail the
  // PolynomialQuotient by x² then silently discarded — dropped ArcTanh
  // terms in the 1.1.1.6 #19/#38/#39 family.)
  PolyQ: (args, ctx) => {
    const u = build(args[0], ctx);
    const v = build(args[1], ctx);
    if (v.symbol === ctx.x) {
      const deg = polyDegreeX(u, ctx.x);
      if (args.length === 2) return deg >= 0;
      const n = realNum(build(args[2], ctx));
      if (n === null || deg !== n) return false;
      const coeffs = polyCoeffsX(u, ctx.x);
      return coeffs !== null && !coeffs[deg].evaluate().isSame(0);
    }
    if (v.operator === 'Power' && v.ops && v.ops[0].symbol === ctx.x) {
      const k = realNum(v.ops[1]);
      if (k === null || !Number.isInteger(k) || k < 1) return false;
      const coeffs = polyCoeffsX(u, ctx.x);
      if (coeffs === null) return false;
      if (!coeffs.every((c, i) => i % k === 0 || c.isSame(0) || zeroQ(c)))
        return false;
      if (args.length === 2) return true;
      const n = realNum(build(args[2], ctx));
      const t = trimZeros(coeffs);
      return n !== null && t.length - 1 === k * n;
    }
    // PolyQ[u, v] for an arbitrary expression v — unsupported, fail closed
    return false;
  },
  LinearQ: (args, ctx) => mapList(args[0], ctx, (u) => linearQ(u, ctx)),
  // LinearMatchQ: matches the *literal* form a. + b.*x (stricter than
  // LinearQ, which allows anything that simplifies to linear)
  LinearMatchQ: (args, ctx) =>
    mapList(args[0], ctx, (u) => linearMatchQ(u, ctx)),
  MonomialQ: (args, ctx) => mapList(args[0], ctx, (u) => monomialQ(u, ctx)),

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

  // --- binomial/trinomial form predicates (BinomialParts et al.) ---

  // BinomialQ[u, x] / BinomialQ[u, x, n] (first arg may be a List)
  BinomialQ: (args, ctx) =>
    mapList(args[0], ctx, (u) => {
      const p = binomialPartsX(u, ctx.x);
      if (p === null) return false;
      if (args.length < 3) return true;
      return zeroQ(p.n.sub(build(args[2], ctx)));
    }),
  TrinomialQ: (args, ctx) =>
    mapList(args[0], ctx, (u) => {
      if (trinomialPartsX(u, ctx.x) === null) return false;
      if (quadraticQX(u, ctx.x)) return false;
      // Not[MatchQ[u, w_^2 /; BinomialQ[w,x]]]
      if (
        u.operator === 'Power' &&
        u.ops &&
        realNum(u.ops[1]) === 2 &&
        binomialPartsX(u.ops[0], ctx.x) !== null
      )
        return false;
      return true;
    }),
  GeneralizedBinomialQ: (args, ctx) =>
    mapList(args[0], ctx, (u) => genBinomialPartsX(u, ctx.x) !== null),
  GeneralizedTrinomialQ: (args, ctx) =>
    mapList(args[0], ctx, (u) => genTrinomialPartsX(u, ctx.x) !== null),
  QuadraticQ: (args, ctx) =>
    mapList(args[0], ctx, (u) => quadraticQX(u, ctx.x)),
  PolynomialQ: (args, ctx) =>
    mapList(args[0], ctx, (u) => polyDegreeX(u, ctx.x) >= 0),

  BinomialMatchQ: (args, ctx) =>
    mapList(args[0], ctx, (u) => binomialMatchQ(u, ctx.x)),
  QuadraticMatchQ: (args, ctx) =>
    mapList(args[0], ctx, (u) => quadraticMatchQ(u, ctx.x)),
  TrinomialMatchQ: (args, ctx) =>
    mapList(args[0], ctx, (u) => trinomialMatchQ(u, ctx.x)),
  GeneralizedBinomialMatchQ: (args, ctx) =>
    mapList(args[0], ctx, (u) => genBinomialMatchQ(u, ctx.x)),
  GeneralizedTrinomialMatchQ: (args, ctx) =>
    mapList(args[0], ctx, (u) => genTrinomialMatchQ(u, ctx.x)),

  // LinearPairQ[u,v,x] — u,v linear, u ≠ x, u/v constant in x
  LinearPairQ: (args, ctx) => {
    const x = ctx.x;
    const u = build(args[0], ctx);
    const v = build(args[1], ctx);
    if (polyDegreeX(u, x) !== 1 || polyDegreeX(v, x) !== 1) return false;
    if (zeroQ(u.sub(ctx.ce.symbol(x)))) return false;
    const uc = polyCoeffsX(u, x);
    const vc = polyCoeffsX(v, x);
    if (uc === null || vc === null) return false;
    return zeroQ(uc[0].mul(vc[1]).sub(uc[1].mul(vc[0])));
  },

  PseudoBinomialQ: (args, ctx) =>
    pseudoBinomialPartsX(build(args[0], ctx), ctx.x) !== null,
  PseudoBinomialPairQ: (args, ctx) => {
    const p1 = pseudoBinomialPartsX(build(args[0], ctx), ctx.x);
    if (p1 === null) return false;
    const p2 = pseudoBinomialPartsX(build(args[1], ctx), ctx.x);
    if (p2 === null) return false;
    return (
      p1.n === p2.n &&
      (p1.c.isSame(p2.c) || zeroQ(p1.c.sub(p2.c))) &&
      (p1.d.isSame(p2.d) || zeroQ(p1.d.sub(p2.d)))
    );
  },

  // --- integrability gates (defined in the Rubi rule files) ---

  // IntBinomialQ — 3 arities: [a,b,c,n,m,p,x], [a,b,c,d,n,p,q,x],
  // [a,b,c,d,e,m,n,p,q,x]
  IntBinomialQ: (args, ctx) => {
    const ce = ctx.ce;
    const v = args.map((a) => build(a, ctx));
    const third = ce.expr(['Rational', 1, 3]) as Expression;
    const half = ce.expr(['Rational', 1, 2]) as Expression;
    if (args.length === 7) {
      const [, , , n, m, p] = v;
      return (
        igtQE(p, 0) ||
        (isLiteralRational(m.evaluate()) && intsQE(n, p.mul(2))) ||
        intQE(safeSimplify(m.add(1).div(n).add(p))) ||
        ((eqNum(n, 2) || eqNum(n, 4)) && intsQE(m.mul(2), p.mul(4))) ||
        (eqNum(n, 2) && intQE(p.mul(6)) && (intQE(m) || intQE(m.sub(p)))) ||
        (eqNum(n, 3) && intQE(m) && intQE(safeSimplify(m.add(1).div(n).add(p))))
      );
    }
    if (args.length === 8) {
      const [a, b, c, d, n, p, q] = v;
      return (
        intsQE(p, q) ||
        igtQE(p, 0) ||
        igtQE(q, 0) ||
        ((eqNum(n, 2) || eqNum(n, 4)) &&
          (intsQE(p, q.mul(4)) || intsQE(p.mul(4), q))) ||
        (eqNum(n, 2) &&
          (intsQE(p.mul(2), q.mul(2)) ||
            (intsQE(p.mul(3), q) && zeroQ(b.mul(c).add(a.mul(d).mul(3)))) ||
            (intsQE(p, q.mul(3)) && zeroQ(b.mul(c).mul(3).add(a.mul(d)))))) ||
        (eqNum(n, 3) && (intsQE(p.add(third), q) || intsQE(q.add(third), p))) ||
        (eqNum(n, 3) &&
          (intsQE(p.add(third.mul(2)), q) || intsQE(q.add(third.mul(2)), p)) &&
          zeroQ(b.mul(c).add(a.mul(d))))
      );
    }
    if (args.length === 10) {
      const [a, b, c, d, , m, n, p, q] = v;
      const bc = b.mul(c);
      const ad = a.mul(d);
      return (
        intsQE(p, q) ||
        igtQE(p, 0) ||
        igtQE(q, 0) ||
        (eqNum(n, 2) &&
          (intsQE(m, p.mul(2), q.mul(2)) ||
            intsQE(m.mul(2), p, q.mul(2)) ||
            intsQE(m.mul(2), p.mul(2), q))) ||
        (eqNum(n, 4) && (intsQE(m, p, q.mul(2)) || intsQE(m, p.mul(2), q))) ||
        (eqNum(n, 2) &&
          intsQE(m.div(2), p.add(third), q) &&
          (zeroQ(bc.add(ad.mul(3))) || zeroQ(bc.sub(ad.mul(9))))) ||
        (eqNum(n, 2) &&
          intsQE(m.div(2), q.add(third), p) &&
          (zeroQ(ad.add(bc.mul(3))) || zeroQ(ad.sub(bc.mul(9))))) ||
        (eqNum(n, 3) &&
          intsQE(m.add(-1).div(3), q, p.sub(half)) &&
          (zeroQ(bc.sub(ad.mul(4))) ||
            zeroQ(bc.add(ad.mul(8))) ||
            zeroQ(
              bc
                .pow(2)
                .sub(a.mul(b).mul(c).mul(d).mul(20))
                .sub(a.pow(2).mul(d.pow(2)).mul(8))
            ))) ||
        (eqNum(n, 3) &&
          intsQE(m.add(-1).div(3), p, q.sub(half)) &&
          (zeroQ(bc.mul(4).sub(ad)) ||
            zeroQ(bc.mul(8).add(ad)) ||
            zeroQ(
              bc
                .pow(2)
                .mul(8)
                .add(a.mul(b).mul(c).mul(d).mul(20))
                .sub(a.pow(2).mul(d.pow(2)))
            ))) ||
        (eqNum(n, 3) &&
          (intsQE(m, q, p.mul(3)) || intsQE(m, p, q.mul(3))) &&
          zeroQ(bc.add(ad))) ||
        (eqNum(n, 3) &&
          (intsQE(m.add(2).div(3), p.add(third.mul(2)), q) ||
            intsQE(m.add(2).div(3), q.add(third.mul(2)), p))) ||
        (eqNum(n, 3) &&
          (intsQE(m.div(3), p.add(third), q) ||
            intsQE(m.div(3), q.add(third), p)))
      );
    }
    return false;
  },

  // IntQuadraticQ[a,b,c,d,e,m,p,x] — (d+e·x)^m (a+b·x+c·x²)^p gate
  IntQuadraticQ: (args, ctx) => {
    const v = args.map((a) => build(a, ctx));
    const [a, b, c, d, e, m, p] = v;
    const third = ctx.ce.expr(['Rational', 1, 3]) as Expression;
    const k = (j: number, l: number, r: number) =>
      c
        .pow(2)
        .mul(d.pow(2))
        .add(b.mul(c).mul(d).mul(e).mul(j))
        .add(b.pow(2).mul(e.pow(2)).mul(l))
        .add(a.mul(c).mul(e.pow(2)).mul(r));
    return (
      intQE(p) ||
      igtQE(m, 0) ||
      intsQE(m.mul(2), p.mul(2)) ||
      intsQE(m, p.mul(4)) ||
      (intsQE(m, p.add(third)) && (zeroQ(k(-1, 1, -3)) || zeroQ(k(-1, -2, 9))))
    );
  },

  // --- sqrt-form predicates ---

  NiceSqrtQ: (args, ctx) => {
    const u = build(args[0], ctx).evaluate();
    if (isLiteralRational(u)) return (realNum(u) ?? 0) > 0;
    return niceSqrtAux(u);
  },
  FractionalPowerFactorQ: (args, ctx) => fracPowerFactorQ(build(args[0], ctx)),
  SimplerSqrtQ: (args, ctx) =>
    simplerSqrtQ(
      build(args[0], ctx).evaluate(),
      build(args[1], ctx).evaluate()
    ),

  // --- function-class predicates ---

  RationalFunctionQ: (args, ctx) => rationalFnQ(build(args[0], ctx), ctx.x),
  AlgebraicFunctionQ: (args, ctx) =>
    algebraicFnQ(
      build(args[0], ctx),
      ctx.x,
      args.length > 2 ? evalCondition(args[2], ctx) : false
    ),

  // --- WL structural/numeric builtins used in rule conditions ---

  SumQ: (args, ctx) => {
    const u = build(args[0], ctx);
    return u.operator === 'Add' || u.operator === 'Subtract';
  },
  NonsumQ: (args, ctx) => {
    const u = build(args[0], ctx);
    return u.operator !== 'Add' && u.operator !== 'Subtract';
  },
  AtomQ: (args, ctx) => !build(args[0], ctx).ops,
  OddQ: (args, ctx) => {
    const r = realNum(build(args[0], ctx).evaluate());
    return r !== null && Number.isInteger(r) && Math.abs(r % 2) === 1;
  },
  EvenQ: (args, ctx) => {
    const r = realNum(build(args[0], ctx).evaluate());
    return r !== null && Number.isInteger(r) && r % 2 === 0;
  },
  // raw relational heads (older Rubi guards; symbolic operands ⇒ false)
  Less: (args, ctx) => cmpChain(args, ctx, (a, b) => a < b),
  Greater: (args, ctx) => cmpChain(args, ctx, (a, b) => a > b),
  LessEqual: (args, ctx) => cmpChain(args, ctx, (a, b) => a <= b),
  GreaterEqual: (args, ctx) => cmpChain(args, ctx, (a, b) => a >= b),
  Equal: (args, ctx) => cmpChain(args, ctx, (a, b) => a === b),
  Unequal: (args, ctx) => cmpChain(args, ctx, (a, b) => a !== b),
};

// IntegerQ-style helpers over built expressions (IntBinomialQ/IntQuadraticQ)
function intQE(e: Expression): boolean {
  return isLiteralInteger(e.evaluate());
}
function intsQE(...es: Expression[]): boolean {
  return es.every(intQE);
}
function igtQE(e: Expression, k: number): boolean {
  const ev = e.evaluate();
  return isLiteralInteger(ev) && (realNum(ev) ?? -Infinity) > k;
}
function eqNum(e: Expression, k: number): boolean {
  const r = realNum(e.evaluate());
  return r !== null ? r === k : zeroQ(e.sub(e.engine.number(k)));
}

/** Rubi QuadraticQ (scalar case): PolyQ[u,x,2] and not a pure c·x² */
function quadraticQX(u: Expression, x: string): boolean {
  const c = polyCoeffsX(u, x);
  if (c === null) return false;
  const t = trimZeros(c);
  if (t.length !== 3) return false;
  return !(t[0].isSame(0) && t[1].isSame(0));
}

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
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] < b[i];
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
    if (e.ops[1].isInteger && typeof k === 'number' && k > 1 && k <= 16) {
      const inner: string[] = [];
      collectSymbolLeaves(e.ops[0], inner);
      for (let i = 0; i < k; i++) out.push(...inner);
      return;
    }
  }
  if (e.ops) for (const op of e.ops) collectSymbolLeaves(op, out);
}

function mapList(arg: Json, ctx: Ctx, f: (u: Expression) => boolean): boolean {
  const items =
    Array.isArray(arg) && arg[0] === 'List' ? (arg as Json[]).slice(1) : [arg];
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
// Binomial/trinomial decomposition (Rubi BinomialParts/TrinomialParts and
// the generalized/pseudo variants) — see IntegrationUtilityFunctions.m.
// All return null where Rubi returns False (fail-closed).
// ---------------------------------------------------------------------------

/** Rt[u, n] = RtAux[TogetherSimplify[u], n] — Rubi's canonical n-th root.
 * RtAux DISTRIBUTES the root over products/quotients and pairs sign flips
 * with negative-form sum factors. This composition is branch-unsound in
 * general; it is exactly Mathematica's principal-branch rendering, which
 * Rubi's rules rely on so that paired complex factors cancel phases (the
 * elliptic branch-phase cluster: e^{iπ/4} errors came from taking the root
 * of the whole quotient instead of the split). */
function rtExpr(u: Expression, n: number | Expression): Expression {
  const ce = u.engine;
  const nn = typeof n === 'number' ? ce.number(n) : n;
  const nv = realNum(nn);
  const v = safeSimplify(u); // ≈ TogetherSimplify
  if (nv === null || !Number.isInteger(nv) || nv < 1)
    return v.pow(ce.One.div(nn)).evaluate();
  return rtAux(v, nv);
}

/** literal principal root u^(1/n) (Rubi NthRoot) */
function nthRoot(u: Expression, n: number): Expression {
  const ce = u.engine;
  if (n === 1) return u;
  return u.pow(ce.expr(['Rational', 1, n]) as Expression).evaluate();
}

/** flatten Multiply/Divide/Negate into a factor list (denominator factors
 * become synthetic Power(f, −1) so the RtAux power/odd-exponent logic
 * sees them) */
function rtFactors(u: Expression): Expression[] {
  const ce = u.engine;
  const out: Expression[] = [];
  const walk = (e: Expression, inv: boolean): void => {
    if (e.operator === 'Multiply' && e.ops) {
      for (const f of e.ops) walk(f, inv);
      return;
    }
    if (e.operator === 'Divide' && e.ops) {
      walk(e.ops[0], inv);
      walk(e.ops[1], !inv);
      return;
    }
    if (e.operator === 'Negate' && e.ops) {
      out.push(ce.NegativeOne);
      walk(e.ops[0], inv);
      return;
    }
    // unit factors regenerate the same product after canonical mul
    // (1/(d·w) → [1, d⁻¹, w⁻¹] → pull 1 → rest re-canonicalizes to u) —
    // skip them in either position
    if (e.isSame(1)) return;
    if (!inv) {
      out.push(e);
      return;
    }
    if (e.operator === 'Power' && e.ops)
      out.push(ce._fn('Power', [e.ops[0], e.ops[1].neg()]));
    else out.push(ce._fn('Power', [e, ce.NegativeOne]));
  };
  walk(u, false);
  return out;
}

const productOf = (ce: ComputeEngine, fs: Expression[]): Expression =>
  fs.length === 0
    ? ce.One
    : fs.length === 1
      ? fs[0]
      : fs.reduce((p, f) => p.mul(f));

// Rubi NegQ[u] over a term (negative form per the PosAux heuristics)
function negFormQ(u: Expression): boolean {
  return !posQ(u) && !zeroQ(u);
}

/** sum terms of a base (Add/Subtract), through odd literal powers
 * (Rubi SumBaseQ companions); null when not a sum base */
function sumBaseTerms(u: Expression): Expression[] | null {
  if (u.operator === 'Add' || u.operator === 'Subtract') return sumTermsX(u);
  if (u.operator === 'Power' && u.ops) {
    const k = realNum(u.ops[1]);
    if (k !== null && Number.isInteger(k) && Math.abs(k % 2) === 1)
      return sumBaseTerms(u.ops[0]);
  }
  return null;
}
const sumBaseQ = (u: Expression): boolean => sumBaseTerms(u) !== null;
const negSumBaseQ = (u: Expression): boolean => {
  const ts = sumBaseTerms(u);
  return ts !== null && negFormQ(mmaFirstTerm(ts));
};
const allNegTermQ = (u: Expression): boolean => {
  const ts = sumBaseTerms(u);
  if (ts !== null) return ts.every(negFormQ);
  return negFormQ(u);
};
const someNegTermQ = (u: Expression): boolean => {
  const ts = sumBaseTerms(u);
  if (ts !== null) return ts.some(negFormQ);
  return negFormQ(u);
};
const atomBaseQ = (u: Expression): boolean => {
  if (!u.ops) return true;
  if (u.operator === 'Power' && u.ops) {
    const k = realNum(u.ops[1]);
    if (k !== null && Number.isInteger(k) && Math.abs(k % 2) === 1)
      return atomBaseQ(u.ops[0]);
  }
  return false;
};

/** Rubi RtAux[u, n] (TrigSquare and the complex-integer basis case
 * omitted — not exercised by Chapter 1) */
let rtAuxDepth = 0;
function rtAux(u: Expression, n: number): Expression {
  // recursion backstop: the WL definition recurses through rewritten
  // forms whose CE canonicalizations can re-create each other — fall
  // back to the literal principal root rather than overflow
  if (rtAuxDepth > 40) {
    if (process.env.RUBI_DEBUG_RT)
      console.error(`rtAux depth cap: ${u.toString().slice(0, 120)}`);
    return nthRoot(u, n);
  }
  rtAuxDepth++;
  try {
    return rtAuxBody(u, n);
  } finally {
    rtAuxDepth--;
  }
}

function rtAuxBody(u: Expression, n: number): Expression {
  const ce = u.engine;
  // PowerQ: base^(exp/n)
  if (u.operator === 'Power' && u.ops)
    return u.ops[0].pow(u.ops[1].div(n)).evaluate();
  if (u.operator === 'Sqrt' && u.ops)
    return u.ops[0]
      .pow((ce.expr(['Rational', 1, 2]) as Expression).div(n))
      .evaluate();
  if (u.operator === 'Root' && u.ops && realNum(u.ops[1]) !== null)
    return u.ops[0].pow(ce.One.div(u.ops[1]).div(n)).evaluate();

  const fs = rtFactors(u);
  if (fs.length > 1) {
    // GtQ/LtQ-style numeric value (covers exact irrationals like √2)
    const numVal = (f: Expression): number | null => {
      const r = realNum(f.evaluate());
      if (r !== null) return Number.isFinite(r) ? r : null;
      const nv = f.N();
      if (isNumber(nv) && typeof nv.re === 'number' && nv.im === 0)
        return Number.isFinite(nv.re) ? nv.re : null;
      return null;
    };
    // 1. pull a provably-positive factor out
    const iPos = fs.findIndex((f) => {
      const r = numVal(f);
      return r !== null && r > 0;
    });
    if (iPos >= 0)
      return rtAux(fs[iPos], n).mul(
        rtAux(
          productOf(
            ce,
            fs.filter((_, i) => i !== iPos)
          ),
          n
        )
      );
    // 2. a numeric-negative factor
    const iNeg = fs.findIndex((f) => {
      const r = numVal(f);
      return r !== null && r < 0;
    });
    if (iNeg >= 0) {
      const c = fs[iNeg];
      const rest = fs.filter((_, i) => i !== iNeg);
      if (c.isSame(-1)) {
        // single inverted power: -1/w^k → 1/RtAux[-w^(-k)] — push the
        // sign inside the inversion
        if (rest.length === 1 && rest[0].operator === 'Power' && rest[0].ops) {
          const [w, k] = rest[0].ops;
          const kv = realNum(k);
          if (kv !== null && kv < 0)
            return ce.One.div(rtAux(w.neg().pow(-kv).evaluate(), n));
        }
        if (rest.length > 1) {
          // pair the -1 with the best sum-base factor
          const pickBy = (...preds: ((f: Expression) => boolean)[]): number => {
            for (const p of preds) {
              const i = rest.findIndex(p);
              if (i >= 0) return i;
            }
            return -1;
          };
          let i = -1;
          if (rest.some(sumBaseQ))
            i = pickBy(
              (f) => sumBaseQ(f) && allNegTermQ(f),
              (f) => negSumBaseQ(f),
              (f) => sumBaseQ(f) && someNegTermQ(f),
              sumBaseQ
            );
          if (i < 0) i = pickBy(atomBaseQ);
          if (i < 0) i = 0;
          return rtAux(rest[i].neg().evaluate(), n).mul(
            rtAux(
              productOf(
                ce,
                rest.filter((_, j) => j !== i)
              ),
              n
            )
          );
        }
        // -1 · single non-power factor
        if (n % 2 === 1) return rtAux(productOf(ce, rest), n).neg();
        return nthRoot(u, n);
      }
      // c < 0, c ≠ -1: RtAux[-c]·RtAux[-rest]
      return rtAux(c.neg().evaluate(), n).mul(
        rtAux(productOf(ce, rest).neg().evaluate(), n)
      );
    }
    // 3./4. double sign-flip pairings across two sum-base factors
    const iAll = fs.findIndex((f) => sumBaseQ(f) && allNegTermQ(f));
    if (iAll >= 0 && fs.some((f, i) => i !== iAll && sumBaseQ(f))) {
      const rest = productOf(
        ce,
        fs.filter((_, i) => i !== iAll)
      );
      return rtAux(fs[iAll].neg().evaluate(), n).mul(
        rtAux(rest.neg().evaluate(), n)
      );
    }
    const iNegSum = fs.findIndex(negSumBaseQ);
    if (iNegSum >= 0 && fs.some((f, i) => i !== iNegSum && negSumBaseQ(f))) {
      const rest = productOf(
        ce,
        fs.filter((_, i) => i !== iNegSum)
      );
      return rtAux(fs[iNegSum].neg().evaluate(), n).mul(
        rtAux(rest.neg().evaluate(), n)
      );
    }
    // 5. distribute the root over every factor
    return productOf(
      ce,
      fs.map((f) => rtAux(f, n))
    );
  }

  // non-product
  const r = realNum(u);
  if (n % 2 === 1 && r !== null && r < 0)
    return rtAux(u.neg().evaluate(), n).neg();
  if (n % 2 === 1 && negFormQ(u) && posQ(safeSimplify(u.neg())))
    return rtAux(safeSimplify(u.neg()), n).neg();
  return nthRoot(u, n);
}

/** structural monomial split u = coef·x^exp (coef and exp x-free; exp may
 * be symbolic). No expansion — mirrors Mathematica's literal matching of
 * a_.*x_^n_. terms over CE canonical form (Divide/Negate/Sqrt present). */
function monoPartsX(
  u: Expression,
  x: string
): { coef: Expression; exp: Expression } | null {
  const ce = u.engine;
  if (!u.has(x)) return { coef: u, exp: ce.Zero };
  if (u.symbol === x) return { coef: ce.One, exp: ce.One };
  const ops = u.ops;
  if (!ops) return null;
  switch (u.operator) {
    case 'Power': {
      if (ops[1].has(x)) return null;
      if (ops[0].symbol === x) return { coef: ce.One, exp: ops[1] };
      const k = realNum(ops[1]);
      if (k !== null && Number.isInteger(k)) {
        const m = monoPartsX(ops[0], x);
        if (m !== null)
          return {
            coef: m.coef.pow(k).evaluate(),
            exp: m.exp.mul(k).evaluate(),
          };
      }
      return null;
    }
    case 'Sqrt':
      if (ops[0].symbol === x)
        return { coef: ce.One, exp: ce.expr(['Rational', 1, 2]) };
      return null;
    case 'Root': {
      if (ops[0].symbol === x && !ops[1].has(x))
        return { coef: ce.One, exp: ce.One.div(ops[1]).evaluate() };
      return null;
    }
    case 'Negate': {
      const m = monoPartsX(ops[0], x);
      return m === null ? null : { coef: m.coef.neg(), exp: m.exp };
    }
    case 'Multiply': {
      let coef = ce.One;
      let exp: Expression = ce.Zero;
      for (const f of ops) {
        if (!f.has(x)) {
          coef = coef.mul(f);
          continue;
        }
        const m = monoPartsX(f, x);
        if (m === null) return null;
        coef = coef.mul(m.coef);
        exp = exp.add(m.exp);
      }
      return { coef: coef.evaluate(), exp: exp.evaluate() };
    }
    case 'Divide': {
      const mn = monoPartsX(ops[0], x);
      const md = monoPartsX(ops[1], x);
      if (mn === null || md === null) return null;
      return {
        coef: mn.coef.div(md.coef).evaluate(),
        exp: mn.exp.sub(md.exp).evaluate(),
      };
    }
  }
  return null;
}

/** flatten a sum into its terms (Add/Subtract/Negate normalized) */
function sumTermsX(u: Expression): Expression[] {
  if (u.operator === 'Add' && u.ops) return u.ops.flatMap(sumTermsX);
  if (u.operator === 'Subtract' && u.ops)
    return [...sumTermsX(u.ops[0]), ...sumTermsX(u.ops[1]).map((t) => t.neg())];
  if (u.operator === 'Negate' && u.ops)
    return sumTermsX(u.ops[0]).map((t) => t.neg());
  return [u];
}

/** group the structural sum terms of u into (exponent → summed coefficient)
 * classes; null when some term is not a structural monomial in x */
function monoClassesX(
  u: Expression,
  x: string
): { exp: Expression; coef: Expression }[] | null {
  const classes: { exp: Expression; coef: Expression }[] = [];
  for (const t of sumTermsX(u)) {
    const m = monoPartsX(t, x);
    if (m === null) return null;
    const cls = classes.find(
      (c) => c.exp.isSame(m.exp) || zeroQ(c.exp.sub(m.exp))
    );
    if (cls) cls.coef = cls.coef.add(m.coef).evaluate();
    else classes.push({ exp: m.exp, coef: m.coef });
  }
  return classes.filter((c) => !c.coef.isSame(0));
}

type BinParts = { a: Expression; b: Expression; n: Expression };
type TriParts = {
  a: Expression;
  b: Expression;
  c: Expression;
  n: Expression;
};

/** Rubi BinomialParts[u,x] → {a,b,n} with u ≡ a + b·x^n (n ≠ 0, b ≠ 0) */
function binomialPartsX(u: Expression, x: string): BinParts | null {
  const ce = u.engine;
  if (!u.has(x)) return null;

  // polynomial branch (Rubi: Exponent/Coefficient, auto-expands; on
  // failure does NOT fall through to the structural branches)
  const coeffs = polyCoeffsX(u, x);
  if (coeffs !== null) {
    const nz: number[] = [];
    for (let i = 1; i < coeffs.length; i++)
      if (!coeffs[i].isSame(0) && !zeroQ(coeffs[i])) nz.push(i);
    if (nz.length !== 1) return null;
    return { a: coeffs[0], b: coeffs[nz[0]], n: ce.number(nz[0]) };
  }

  // structural monomial b·x^n (symbolic/fractional exponent)
  const m = monoPartsX(u, x);
  if (m !== null)
    return m.exp.isSame(0) ? null : { a: ce.Zero, b: m.coef, n: m.exp };

  const ops = u.ops;
  if (!ops) return null;
  switch (u.operator) {
    case 'Negate': {
      const p = binomialPartsX(ops[0], x);
      return p === null
        ? null
        : { a: p.a.neg().evaluate(), b: p.b.neg().evaluate(), n: p.n };
    }
    case 'Divide': {
      if (ops[1].has(x)) return null;
      const p = binomialPartsX(ops[0], x);
      return p === null
        ? null
        : {
            a: p.a.div(ops[1]).evaluate(),
            b: p.b.div(ops[1]).evaluate(),
            n: p.n,
          };
    }
    case 'Multiply': {
      let scale = ce.One;
      const parts: BinParts[] = [];
      for (const f of ops) {
        if (!f.has(x)) {
          scale = scale.mul(f);
          continue;
        }
        const p = binomialPartsX(f, x);
        if (p === null) return null;
        parts.push(p);
      }
      if (parts.length === 0) return null;
      let acc: BinParts | null = parts[0];
      for (let i = 1; i < parts.length && acc !== null; i++)
        acc = combineBinProduct(acc, parts[i]);
      if (acc === null) return null;
      return {
        a: scale.mul(acc.a).evaluate(),
        b: scale.mul(acc.b).evaluate(),
        n: acc.n,
      };
    }
    case 'Add':
    case 'Subtract': {
      let constA = ce.Zero;
      let acc: BinParts | null = null;
      for (const t of sumTermsX(u)) {
        if (!t.has(x)) {
          constA = constA.add(t);
          continue;
        }
        const p = binomialPartsX(t, x);
        if (p === null) return null;
        if (acc === null) acc = p;
        else if (zeroQ(acc.n.sub(p.n)))
          acc = {
            a: acc.a.add(p.a).evaluate(),
            b: acc.b.add(p.b).evaluate(),
            n: acc.n,
          };
        else return null;
      }
      if (acc === null) return null;
      return { a: acc.a.add(constA).evaluate(), b: acc.b, n: acc.n };
    }
  }
  return null;
}

/** Rubi BinomialParts product combination: (a+b·x^m)·(c+d·x^n) */
function combineBinProduct(p: BinParts, q: BinParts): BinParts | null {
  const aZ = p.a.isSame(0) || zeroQ(p.a);
  const cZ = q.a.isSame(0) || zeroQ(q.a);
  const { b, n: m } = p;
  const { b: d, n } = q;
  if (aZ && cZ)
    return {
      a: p.a.engine.Zero,
      b: b.mul(d).evaluate(),
      n: m.add(n).evaluate(),
    };
  if (aZ && zeroQ(m.add(n)))
    return { a: b.mul(d).evaluate(), b: b.mul(q.a).evaluate(), n: m };
  if (cZ && zeroQ(m.add(n)))
    return { a: b.mul(d).evaluate(), b: p.a.mul(d).evaluate(), n };
  if (zeroQ(m.sub(n)) && zeroQ(p.a.mul(d).add(b.mul(q.a))))
    return {
      a: p.a.mul(q.a).evaluate(),
      b: b.mul(d).evaluate(),
      n: m.mul(2).evaluate(),
    };
  return null;
}

/** Rubi TrinomialParts[u,x] → {a,b,c,n} with u ≡ a + b·x^n + c·x^(2n) */
function trinomialPartsX(u: Expression, x: string): TriParts | null {
  const ce = u.engine;
  if (!u.has(x)) return null;

  const coeffs0 = polyCoeffsX(u, x);
  if (coeffs0 !== null) {
    const coeffs = trimZeros(coeffs0);
    const L = coeffs.length;
    if (L < 3 || L % 2 === 0) return null;
    const mid = (L - 1) / 2;
    if (coeffs[mid].isSame(0) || zeroQ(coeffs[mid])) return null;
    for (let i = 1; i < L - 1; i++)
      if (i !== mid && !(coeffs[i].isSame(0) || zeroQ(coeffs[i]))) return null;
    return {
      a: coeffs[0],
      b: coeffs[mid],
      c: coeffs[L - 1],
      n: ce.number(mid),
    };
  }

  const ops = u.ops;
  if (!ops) return null;
  const scaleTri = (s: Expression, t: TriParts): TriParts => ({
    a: s.mul(t.a).evaluate(),
    b: s.mul(t.b).evaluate(),
    c: s.mul(t.c).evaluate(),
    n: t.n,
  });
  switch (u.operator) {
    case 'Power': {
      // w^2 with w a binomial (a ≠ 0) → (a + b·x^n)² trinomial
      if (realNum(ops[1]) !== 2) return null;
      const p = binomialPartsX(ops[0], x);
      if (p === null || p.a.isSame(0) || zeroQ(p.a)) return null;
      return {
        a: p.a.pow(2).evaluate(),
        b: p.a.mul(p.b).mul(2).evaluate(),
        c: p.b.pow(2).evaluate(),
        n: p.n,
      };
    }
    case 'Negate': {
      const t = trinomialPartsX(ops[0], x);
      return t === null ? null : scaleTri(ce.NegativeOne, t);
    }
    case 'Divide': {
      if (ops[1].has(x)) return null;
      const t = trinomialPartsX(ops[0], x);
      return t === null ? null : scaleTri(ce.One.div(ops[1]), t);
    }
    case 'Multiply': {
      let scale = ce.One;
      const dep: Expression[] = [];
      for (const f of ops) {
        if (!f.has(x)) scale = scale.mul(f);
        else dep.push(f);
      }
      if (dep.length === 1) {
        const t = trinomialPartsX(dep[0], x);
        return t === null ? null : scaleTri(scale, t);
      }
      if (dep.length === 2) {
        const p1 = binomialPartsX(dep[0], x);
        const p2 = binomialPartsX(dep[1], x);
        if (p1 === null || p2 === null || !zeroQ(p1.n.sub(p2.n))) return null;
        const mid = p1.a.mul(p2.b).add(p1.b.mul(p2.a)).evaluate();
        if (zeroQ(mid)) return null;
        return scaleTri(scale, {
          a: p1.a.mul(p2.a).evaluate(),
          b: mid,
          c: p1.b.mul(p2.b).evaluate(),
          n: p1.n,
        });
      }
      return null;
    }
    case 'Add':
    case 'Subtract': {
      // fold terms through a mixed binomial/trinomial accumulator,
      // transcribing the Rubi sum cases
      let constA = ce.Zero;
      type Acc =
        | { kind: 'bin'; p: BinParts }
        | { kind: 'tri'; p: TriParts }
        | null;
      let acc: Acc = null;
      for (const t of sumTermsX(u)) {
        if (!t.has(x)) {
          constA = constA.add(t);
          continue;
        }
        const tri = trinomialPartsX(t, x);
        const next: Acc = tri
          ? { kind: 'tri', p: tri }
          : ((): Acc => {
              const bin = binomialPartsX(t, x);
              return bin ? { kind: 'bin', p: bin } : null;
            })();
        if (next === null) return null;
        if (acc === null) {
          acc = next;
          continue;
        }
        acc = combineTriSum(acc, next);
        if (acc === null) return null;
      }
      if (acc === null || acc.kind !== 'tri') return null;
      return {
        a: acc.p.a.add(constA).evaluate(),
        b: acc.p.b,
        c: acc.p.c,
        n: acc.p.n,
      };
    }
  }
  return null;
}

function combineTriSum(
  u: { kind: 'bin'; p: BinParts } | { kind: 'tri'; p: TriParts },
  v: { kind: 'bin'; p: BinParts } | { kind: 'tri'; p: TriParts }
): { kind: 'bin'; p: BinParts } | { kind: 'tri'; p: TriParts } | null {
  // bin + bin → trinomial when one exponent doubles the other
  if (u.kind === 'bin' && v.kind === 'bin') {
    const { a: a3, b: b3, n: m } = u.p;
    const { a: a4, b: b4, n: k } = v.p;
    if (zeroQ(m.sub(k.mul(2))))
      return {
        kind: 'tri',
        p: { a: a3.add(a4).evaluate(), b: b4, c: b3, n: k },
      };
    if (zeroQ(k.sub(m.mul(2))))
      return {
        kind: 'tri',
        p: { a: a3.add(a4).evaluate(), b: b3, c: b4, n: m },
      };
    // same exponent merges to a binomial accumulator
    if (zeroQ(m.sub(k)))
      return {
        kind: 'bin',
        p: { a: a3.add(a4).evaluate(), b: b3.add(b4).evaluate(), n: m },
      };
    return null;
  }
  if (u.kind === 'bin' && v.kind === 'tri') return combineTriSum(v, u);
  if (u.kind === 'tri' && v.kind === 'bin') {
    const { a: a1, b: b1, c: c1, n } = u.p;
    const { a: a4, b: b4, n: k } = v.p;
    if (zeroQ(k.sub(n))) {
      const b = b1.add(b4).evaluate();
      if (zeroQ(b)) return null;
      return { kind: 'tri', p: { a: a1.add(a4).evaluate(), b, c: c1, n } };
    }
    if (zeroQ(k.sub(n.mul(2)))) {
      const c = c1.add(b4).evaluate();
      if (zeroQ(c)) return null;
      return { kind: 'tri', p: { a: a1.add(a4).evaluate(), b: b1, c, n } };
    }
    return null;
  }
  // tri + tri
  if (u.kind === 'tri' && v.kind === 'tri') {
    if (!zeroQ(u.p.n.sub(v.p.n))) return null;
    const b = u.p.b.add(v.p.b).evaluate();
    const c = u.p.c.add(v.p.c).evaluate();
    if (zeroQ(b) || zeroQ(c)) return null;
    return {
      kind: 'tri',
      p: { a: u.p.a.add(v.p.a).evaluate(), b, c, n: u.p.n },
    };
  }
  return null;
}

type GenBinParts = {
  a: Expression;
  b: Expression;
  n: Expression;
  q: Expression;
};
type GenTriParts = {
  a: Expression;
  b: Expression;
  c: Expression;
  n: Expression;
  q: Expression;
};

/** Rubi GeneralizedBinomialParts → {a,b,n,q}: u ≡ a·x^q + b·x^n, PosQ[n−q] */
function genBinomialPartsX(u: Expression, x: string): GenBinParts | null {
  if (!u.has(x)) return null;
  const classes = monoClassesX(u, x);
  if (classes !== null) {
    if (classes.length !== 2) return null;
    const [c1, c2] = classes;
    if (c1.exp.isSame(0) || c2.exp.isSame(0)) return null;
    // n is the "larger" exponent (PosQ[n−q])
    const nFirst = posQ(safeSimplify(c1.exp.sub(c2.exp)));
    const [qc, nc] = nFirst ? [c2, c1] : [c1, c2];
    return { a: qc.coef, b: nc.coef, n: nc.exp, q: qc.exp };
  }
  // unexpanded product s·x^m·v with v (generalized) binomial
  const split = splitMonoFactor(u, x);
  if (split === null) return null;
  const { scale, exp: mExp, rest } = split;
  if (rest === null) return null;
  const gp = genBinomialPartsX(rest, x);
  if (gp !== null) {
    const n = mExp.add(gp.n).evaluate();
    const q = mExp.add(gp.q).evaluate();
    if (zeroQ(n) || zeroQ(q)) return null;
    return {
      a: scale.mul(gp.a).evaluate(),
      b: scale.mul(gp.b).evaluate(),
      n,
      q,
    };
  }
  const bp = binomialPartsX(rest, x);
  if (bp !== null && !mExp.isSame(0)) {
    if (bp.a.isSame(0) || zeroQ(bp.a)) return null;
    const n = mExp.add(bp.n).evaluate();
    if (zeroQ(n)) return null;
    return {
      a: scale.mul(bp.a).evaluate(),
      b: scale.mul(bp.b).evaluate(),
      n,
      q: mExp,
    };
  }
  return null;
}

/** Rubi GeneralizedTrinomialParts → {a,b,c,n,q}:
 * u ≡ a·x^q + b·x^n + c·x^(2n−q) */
function genTrinomialPartsX(u: Expression, x: string): GenTriParts | null {
  if (!u.has(x)) return null;
  const classes = monoClassesX(u, x);
  if (classes !== null) {
    if (classes.length !== 3) return null;
    if (classes.some((c) => c.exp.isSame(0))) return null;
    // find the middle exponent n with 2n = q + r
    for (let i = 0; i < 3; i++) {
      const [j, k] = [0, 1, 2].filter((idx) => idx !== i);
      const ei = classes[i].exp;
      const ej = classes[j].exp;
      const ek = classes[k].exp;
      if (!zeroQ(ei.mul(2).sub(ej.add(ek)))) continue;
      // q is the smaller of the two outer exponents (Plus ordering)
      const jNum = realNum(ej);
      const kNum = realNum(ek);
      const jIsQ =
        jNum !== null && kNum !== null
          ? jNum < kNum
          : !posQ(safeSimplify(ej.sub(ek)));
      const [qc, rc] = jIsQ
        ? [classes[j], classes[k]]
        : [classes[k], classes[j]];
      return { a: qc.coef, b: classes[i].coef, c: rc.coef, n: ei, q: qc.exp };
    }
    return null;
  }
  const split = splitMonoFactor(u, x);
  if (split === null || split.rest === null) return null;
  const { scale, exp: mExp, rest } = split;
  const gt = genTrinomialPartsX(rest, x);
  if (gt !== null) {
    return {
      a: scale.mul(gt.a).evaluate(),
      b: scale.mul(gt.b).evaluate(),
      c: scale.mul(gt.c).evaluate(),
      n: mExp.add(gt.n).evaluate(),
      q: mExp.add(gt.q).evaluate(),
    };
  }
  const tp = trinomialPartsX(rest, x);
  if (tp !== null && !mExp.isSame(0)) {
    if (tp.a.isSame(0) || zeroQ(tp.a)) return null;
    return {
      a: scale.mul(tp.a).evaluate(),
      b: scale.mul(tp.b).evaluate(),
      c: scale.mul(tp.c).evaluate(),
      n: mExp.add(tp.n).evaluate(),
      q: mExp,
    };
  }
  return null;
}

/** split u = scale·x^m·rest where scale and m are x-free and rest is the
 * single non-monomial x-dependent factor (null when u has no such shape) */
function splitMonoFactor(
  u: Expression,
  x: string
): { scale: Expression; exp: Expression; rest: Expression | null } | null {
  const ce = u.engine;
  if (u.operator !== 'Multiply' || !u.ops) return null;
  let scale = ce.One;
  let exp: Expression = ce.Zero;
  let rest: Expression | null = null;
  for (const f of u.ops) {
    if (!f.has(x)) {
      scale = scale.mul(f);
      continue;
    }
    const m = monoPartsX(f, x);
    if (m !== null) {
      scale = scale.mul(m.coef);
      exp = exp.add(m.exp);
      continue;
    }
    if (rest !== null) return null;
    rest = f;
  }
  return { scale: scale.evaluate(), exp: exp.evaluate(), rest };
}

type PseudoBinParts = {
  a: Expression;
  b: Expression;
  c: Expression;
  d: Expression;
  n: number;
};

/** Rubi PseudoBinomialParts → {a,1,c,d,n}: u ≡ a + (c+d·x)^n, n > 2 */
function pseudoBinomialPartsX(u: Expression, x: string): PseudoBinParts | null {
  const ce = u.engine;
  const coeffs0 = polyCoeffsX(u, x);
  if (coeffs0 === null) return null;
  const coeffs = trimZeros(coeffs0);
  const n = coeffs.length - 1;
  if (n <= 2) return null;
  const d = rtExpr(coeffs[n], n);
  const c = coeffs[n - 1].div(ce.number(n).mul(d.pow(n - 1))).evaluate();
  const X = ce.symbol(x);
  const a = safeSimplify(u.sub(c.add(d.mul(X)).pow(n)));
  if (zeroQ(a) || a.has(x)) return null;
  return { a, b: ce.One, c, d, n };
}

/** Rubi FractionalPowerFactorQ: a factor of u is a complex constant or a
 * fractional power */
function fracPowerFactorQ(u: Expression): boolean {
  if (!u.ops) return isNumber(u) && typeof u.im === 'number' && u.im !== 0;
  switch (u.operator) {
    case 'Power': {
      const e = u.ops[1];
      return isLiteralRational(e) && e.isInteger === false;
    }
    case 'Sqrt':
      return true;
    case 'Root':
      return true;
    case 'Negate':
      return fracPowerFactorQ(u.ops[0]);
    case 'Multiply':
    case 'Divide':
      return u.ops.some(fracPowerFactorQ);
  }
  return false;
}

/** NiceSqrtQ body for non-rational u: would Rt[u,2] be free of fractional
 * powers and complex factors? Mathematica's RtAux extracts even powers
 * (Rt[b²,2] = b); CE's sound Power fold keeps √(b²), so test the even-power
 * structure directly instead of inspecting the folded root. */
function niceSqrtAux(u: Expression): boolean {
  if (isLiteralRational(u))
    return (realNum(u) ?? -1) > 0 && isLiteralRational(rtExpr(u, 2));
  if (u.operator === 'Power' && u.ops) {
    const k = realNum(u.ops[1]);
    return k !== null && Number.isInteger(k) && k % 2 === 0;
  }
  if (u.operator === 'Multiply' && u.ops) return u.ops.every(niceSqrtAux);
  return !fracPowerFactorQ(rtExpr(u, 2));
}

/** Rubi SimplerSqrtQ[u,v] — is √u simpler than √v */
function simplerSqrtQ(u: Expression, v: Expression): boolean {
  const ltZero = (e: Expression): boolean => {
    const r = realNum(e) ?? realNum(safeSimplify(e));
    return r !== null && r < 0;
  };
  if (ltZero(v) && !ltZero(u)) return true;
  if (ltZero(u) && !ltZero(v)) return false;
  const su = rtExpr(u, 2);
  const sv = rtExpr(v, 2);
  if (isLiteralInteger(su))
    return isLiteralInteger(sv) ? realNum(su)! < realNum(sv)! : true;
  if (isLiteralInteger(sv)) return false;
  if (isLiteralRational(su))
    return isLiteralRational(sv) ? realNum(su)! < realNum(sv)! : true;
  if (isLiteralRational(sv)) return false;
  if (posQ(u)) return posQ(v) ? leafCount(su) < leafCount(sv) : true;
  if (posQ(v)) return false;
  if (leafCount(su) < leafCount(sv)) return true;
  if (leafCount(sv) < leafCount(su)) return false;
  // ~ Not[OrderedQ[{v,u}]] — canonical-order tiebreak
  return u.toString() < v.toString();
}

/** Rubi RationalFunctionQ — u is a rational function of x */
export function rationalFnQ(u: Expression, x: string): boolean {
  if (!u.ops || !u.has(x)) return true;
  switch (u.operator) {
    case 'Power':
      return isLiteralInteger(u.ops[1]) && rationalFnQ(u.ops[0], x);
    case 'Add':
    case 'Subtract':
    case 'Negate':
    case 'Multiply':
    case 'Divide':
      return u.ops.every((o) => rationalFnQ(o, x));
  }
  return false;
}

/** Rubi AlgebraicFunctionQ — u is an algebraic function of x */
function algebraicFnQ(u: Expression, x: string, flag: boolean): boolean {
  if (!u.ops || !u.has(x)) return true;
  switch (u.operator) {
    case 'Power': {
      const e = u.ops[1];
      if (isLiteralRational(e.evaluate()) || (flag && !e.has(x)))
        return algebraicFnQ(u.ops[0], x, flag);
      return false;
    }
    case 'Sqrt':
      return algebraicFnQ(u.ops[0], x, flag);
    case 'Root':
      return !u.ops[1].has(x) && algebraicFnQ(u.ops[0], x, flag);
    case 'Add':
    case 'Subtract':
    case 'Negate':
    case 'Multiply':
    case 'Divide':
      return u.ops.every((o) => algebraicFnQ(o, x, flag));
  }
  return false;
}

// --- structural (MatchQ-style) form predicates: literal shape, no
// Together/expansion — these gate Rubi's normalization rules, whose point
// is exactly "equivalent to the form but not already in it"

function binomialMatchQ(u: Expression, x: string): boolean {
  const cls = monoClassesX(u, x);
  if (cls === null) return false;
  const nz = cls.filter((c) => !c.exp.isSame(0));
  return nz.length === 1 && cls.length <= 2;
}

function quadraticMatchQ(u: Expression, x: string): boolean {
  const cls = monoClassesX(u, x);
  if (cls === null) return false;
  const exps = cls.map((c) => realNum(c.exp));
  return exps.every((e) => e === 0 || e === 1 || e === 2) && exps.includes(2);
}

function trinomialMatchQ(u: Expression, x: string): boolean {
  const cls = monoClassesX(u, x);
  if (cls === null) return false;
  const nz = cls.filter((c) => !c.exp.isSame(0));
  if (nz.length !== 2 || cls.length - nz.length > 1) return false;
  const [e1, e2] = [nz[0].exp, nz[1].exp];
  return zeroQ(e2.sub(e1.mul(2))) || zeroQ(e1.sub(e2.mul(2)));
}

function genBinomialMatchQ(u: Expression, x: string): boolean {
  const cls = monoClassesX(u, x);
  return cls !== null && cls.length === 2 && cls.every((c) => !c.exp.isSame(0));
}

function genTrinomialMatchQ(u: Expression, x: string): boolean {
  const cls = monoClassesX(u, x);
  if (cls === null || cls.length !== 3) return false;
  if (cls.some((c) => c.exp.isSame(0))) return false;
  for (let i = 0; i < 3; i++) {
    const [j, k] = [0, 1, 2].filter((idx) => idx !== i);
    if (zeroQ(cls[i].exp.mul(2).sub(cls[j].exp.add(cls[k].exp)))) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Inert ↔ active trig bridge (docs/rubi/RUBI.md §1, the Chapter-4 "inert
// trig" machinery). Rubi's trig rules match against INERT lowercase heads
// (`sin`/`cos`/…) that its dispatcher produces from the user's ACTIVE
// `Sin`/`Cos` via DeactivateTrig, and converts results back with
// ActivateTrig[u] := ReplaceAll[u,{sin->Sin,…}]. CE preserves the
// inert/active split (it boxes `cos[x]` as a distinct `"cos"` head), so the
// bridge is a pure head-swap.
//
// This is the MINIMAL bridge: it swaps trig heads anywhere in the tree but
// does NOT implement Rubi's FixInertTrigFunction / UnifyInertTrigFunction
// argument-unification layer (needed for products/powers/shifted arguments
// in the broader chapter, measured separately). It is exact for the
// `(a+b cos+c sin)^n` family, whose trig arguments are already linear.
// ---------------------------------------------------------------------------

const TO_INERT: Record<string, string> = {
  Sin: 'sin',
  Cos: 'cos',
  Tan: 'tan',
  Cot: 'cot',
  Sec: 'sec',
  Csc: 'csc',
};
const TO_ACTIVE: Record<string, string> = {
  sin: 'Sin',
  cos: 'Cos',
  tan: 'Tan',
  cot: 'Cot',
  sec: 'Sec',
  csc: 'Csc',
};

/** True if any node carries an ACTIVE trig head (`Sin`/`Cos`/…). Lets the
 * driver gate the bridge to a strict no-op for trig-free integrands. */
export function hasActiveTrig(e: Expression): boolean {
  if (TO_INERT[e.operator] !== undefined) return true;
  return e.ops?.some(hasActiveTrig) ?? false;
}

/** True if any node carries an INERT trig head (`sin`/`cos`/…). Underlies
 * Rubi's `InertTrigFreeQ` (the working-form purity test that gates many
 * Chapter-4 dispatch rules). */
function hasInertTrig(e: Expression): boolean {
  if (TO_ACTIVE[e.operator] !== undefined) return true;
  return e.ops?.some(hasInertTrig) ?? false;
}

// Inverse functions (CE names: inverse trig `Arcsin…`, inverse hyperbolic
// `Arsinh…`, logarithms) + calculus heads. `InverseFunctionFreeQ[u, x]` is
// True when none of these appear with `x` inside — a guard Rubi uses to keep
// reduction rules from firing on already-integrated-looking subexpressions.
const INVERSE_FNS = new Set([
  'Arcsin',
  'Arccos',
  'Arctan',
  'Arccot',
  'Arcsec',
  'Arccsc',
  'Arsinh',
  'Arcosh',
  'Artanh',
  'Arcoth',
  'Arsech',
  'Arcsch',
  'Ln',
  'Log',
]);
const CALCULUS_FNS = new Set([
  'Integrate',
  'D',
  'Derivative',
  'Sum',
  'Product',
  'Limit',
]);
function inverseFunctionFreeQ(u: Expression, x: string): boolean {
  const op = u.operator;
  if (
    INVERSE_FNS.has(op) ||
    CALCULUS_FNS.has(op) ||
    op === 'Hypergeometric2F1' ||
    op === 'AppellF1'
  )
    return !u.has(x);
  return u.ops?.every((o) => inverseFunctionFreeQ(o, x)) ?? true;
}

/** Rewrite trig heads through `map`, preserving object identity wherever no
 * descendant changed (so trig-free subtrees pass through untouched and the
 * non-trig case is a true no-op). Rebuilt nodes are re-canonicalized, which
 * is what aligns the deactivated integrand with the canonically-boxed
 * inert-head patterns. */
function mapTrigHeads(
  ce: ComputeEngine,
  e: Expression,
  map: Record<string, string>
): Expression {
  const ops = e.ops;
  if (!ops || ops.length === 0) return e;
  const newOps = ops.map((o) => mapTrigHeads(ce, o, map));
  const newHead = map[e.operator] ?? e.operator;
  if (newHead === e.operator && newOps.every((o, i) => o === ops[i])) return e;
  return ce.function(newHead, newOps);
}

/** Active → inert: `Cos[x]` → `cos[x]`. Applied to integrands on driver entry. */
export function deactivateTrig(ce: ComputeEngine, e: Expression): Expression {
  return mapTrigHeads(ce, e, TO_INERT);
}

/** Inert → active: `cos[x]` → `Cos[x]`. Applied to results (RHSs already emit
 * active heads; this catches inert leaves carried over from the integrand). */
export function activateTrig(ce: ComputeEngine, e: Expression): Expression {
  return mapTrigHeads(ce, e, TO_ACTIVE);
}

// ---------------------------------------------------------------------------
// Cofunction deactivation shift (the runtime-faithful mirror of Rubi's
// DeactivateTrig — ReduceInertTrig ∘ UnifyInertTrigFunction, verified under
// wolframscript). Rubi authors the reciprocal-trig REDUCTION rules in ONE head
// of each cofunction pair — the sec/csc pair in inert `csc` (the "4.5 Secant"
// chapter), the tan/cot pair in inert `tan` (the "4.3 Tangent" chapter). It has
// NO Cosine/Cotangent/Cosecant reduction chapter. At integration time the OTHER
// head of each pair is reflected onto the authored one via a quarter-period
// argument shift — the "Cosecant to secant" / "Cotangent to tangent" sections
// of UnifyInertTrigFunction (IntegrationUtilityFunctions.m):
//
//   (a + b·sec[e+f·x])^n  →  (a + b·csc[e + π/2 + f·x])^n     (no sign flip)
//   (a + b·cot[e+f·x])^n  →  (a − b·tan[e + π/2 + f·x])^n     (sign flip on b)
//
// These are pure functional identities — `sec θ = csc(θ+π/2)` and
// `cot θ = −tan(θ+π/2)` — so they are value-exact for EVERY power (integer or
// fractional; no branch hazard), which lets a bare node-level rewrite compose
// correctly through Add / Multiply / Power: reflecting the `sec`/`cot` LEAF
// carries the shift (and, for cot, the −1) into whatever binomial/product/power
// context encloses it. So `(a+b·sec)^m (c+d·sec)^n → (a+b·csc[+π/2])^m
// (c+d·csc[+π/2])^n` with a COMMON shifted argument, exactly matching the csc
// rule family. Verified: DeactivateTrig[Sqrt[b*Sec[x]],x] → Sqrt[b*csc[π/2+x]].
//
// Only LINEAR arguments are reflected (Rubi's `LinearQ[u[[1]],x]` guard in
// DeactivateTrigAux); an x-free or nonlinear-argument sec/cot is left as-is.
//
// LIMITATION vs. Rubi: a MIXED cross-pair integrand (e.g. `csc·cot`, a sec/csc
// factor times a tan/cot factor) needs Rubi's per-clause ±π/2 choice to land
// both factors on a COMMON argument; the uniform +π/2 leaf reflection here can
// leave their arguments differing by π/2. Those cases (4.5.1.4 (d tan)^n(a+b
// sec)^m and the like) also require the not-yet-bundled 4.3 Tangent rules, so
// they decline cleanly rather than mis-routing.
//
// The shifted `csc[·+π/2]` / `tan[·+π/2]` RESULT reads back cleanly: results are
// re-activated and run through `simplifyTrig`, whose PI_HALF_PLUS table already
// folds `Csc(θ+π/2)→Sec(θ)` and `Tan(θ+π/2)→−Cot(θ)` (see driver `cleanTrig`).
//
// SCOPE (R11): only `sec→csc` is enabled by default. The `cot→tan` reflection
// is CORRECT but PREMATURE — it regresses the bundled 4.1 Sine `cot`-with-`sin`
// families (`(g·cot)^p (a+b·sin)^m`, 4.1.1.3), because those are MIXED cross-pair
// integrands: Rubi's UnifyInertTrigFunction reflects BOTH factors with a matched
// ±π/2 so they keep a common argument, whereas the uniform leaf reflection here
// turns `cot[θ]→-tan[θ+π/2]` while the `sin[θ]` stays at `θ`, so the product no
// longer matches the sine-chapter `(g cot)^p (a+b cos)^m` clause (`unifyInertTrig`)
// nor a `tan` rule. Enabling `cot→tan` waits on bundling 4.3 Tangent together
// with a mixed-argument reflection (the "Cotangent to tangent" product clauses).
// Behind the `RUBI_COFN_COT` toggle for that future rung / --rubi measurement.
const COFUNCTION_SHIFT_SEC: Record<string, { fn: string; sign: number }> = {
  sec: { fn: 'csc', sign: 1 },
};
const COFUNCTION_SHIFT_ALL: Record<string, { fn: string; sign: number }> = {
  sec: { fn: 'csc', sign: 1 },
  cot: { fn: 'tan', sign: -1 },
};
const COFN_COT = process.env.RUBI_COFN_COT !== undefined;
const COFUNCTION_SHIFT = COFN_COT
  ? COFUNCTION_SHIFT_ALL
  : COFUNCTION_SHIFT_SEC;

/** True if a shiftable (`sec`, and — when enabled — `cot`) inert head appears
 * anywhere (gates the shift to a strict no-op for integrands that carry none). */
function hasCofunctionTrig(e: Expression): boolean {
  if (COFUNCTION_SHIFT[e.operator] !== undefined) return true;
  return e.ops?.some(hasCofunctionTrig) ?? false;
}

// CROSS-pair heads that, if present, make the integrand a MIXED form for which
// the uniform leaf reflection would desynchronize arguments (see the block
// comment's LIMITATION): a co-present `sin`/`cos` (the 4.1 `(d·sin)^n
// (a+b·sec)^m` families) or `tan`/`cot` (4.5.1.4 `(d·tan)^n (a+b·sec)^m`) is
// left to `unifyInertTrig`'s matched-±π/2 product clauses and the bundled mixed
// rules — reflecting it here regresses those. The shift SOURCE(s) and TARGET(s)
// of the active pair(s) are excluded (a pure-sec integrand reflects cleanly, and
// its csc-bearing recursive subproblems still benefit — a large share of the
// 4.5 win is in the recursion).
const SHIFT_SOURCE_HEADS = new Set(Object.keys(COFUNCTION_SHIFT));
const SHIFT_TARGET_HEADS = new Set(
  Object.values(COFUNCTION_SHIFT).map((m) => m.fn)
);
const MIXED_TRIG_HEADS = new Set(
  ['sin', 'cos', 'tan', 'cot', 'sec', 'csc'].filter(
    (h) => !SHIFT_SOURCE_HEADS.has(h) && !SHIFT_TARGET_HEADS.has(h)
  )
);
function hasMixedPartnerTrig(e: Expression): boolean {
  if (MIXED_TRIG_HEADS.has(e.operator)) return true;
  return e.ops?.some(hasMixedPartnerTrig) ?? false;
}

/** Collect the (stringified) arguments of every shift-TARGET head (`csc`, and —
 * when cot enabled — `tan`) in the tree, into `out`. */
function collectTargetArgs(e: Expression, out: Set<string>): void {
  if (SHIFT_TARGET_HEADS.has(e.operator) && e.ops?.length === 1)
    out.add(e.ops[0].toString());
  if (e.ops) for (const o of e.ops) collectTargetArgs(o, out);
}

/** True if the tree carries a target head at 2+ DISTINCT arguments — the
 * signature of a desynchronized within-pair reflection (`csc[θ]·csc[θ+π/2]`
 * from `csc[θ]·sec[θ]`). A pure-source reflection lands every target on the SAME
 * `arg+π/2`, so this stays false; a genuine `csc·sec` mix trips it and the
 * reflection is reverted. */
function hasDesyncedTargetArgs(e: Expression): boolean {
  const args = new Set<string>();
  collectTargetArgs(e, args);
  return args.size >= 2;
}

function cofunctionShiftRec(
  ce: ComputeEngine,
  e: Expression,
  x: string
): Expression {
  const map = COFUNCTION_SHIFT[e.operator];
  if (map && e.ops?.length === 1 && polyDegreeX(e.ops[0], x) === 1) {
    const shifted = ce.function(map.fn, [e.ops[0].add(ce.Pi.div(2))]);
    return map.sign === 1 ? shifted : shifted.neg();
  }
  const ops = e.ops;
  if (!ops || ops.length === 0) return e;
  const newOps = ops.map((o) => cofunctionShiftRec(ce, o, x));
  if (newOps.every((o, i) => o === ops[i])) return e;
  return ce.function(e.operator, newOps);
}

/** Reflect an inert `sec` (and, under `RUBI_COFN_COT`, `cot`) onto the authored
 * `csc`/`tan` cofunction via the quarter-period shift (identity when none
 * appears). See the block comment. Runs at deactivation time, before
 * `reciprocalToPower`, so a fractional-power `sec` reflects to a `csc` that
 * survives to the 4.5 csc rule family. If the reflection would desynchronize a
 * within-pair `csc·sec` mix into a target head at two different arguments (the
 * 4.1.0 `Csc^2·(b·Sec)^(5/2)` case), it is reverted — leaving those to the
 * fractional-reciprocal freeze and the bundled mixed rules. */
export function cofunctionShift(
  ce: ComputeEngine,
  e: Expression,
  x: string
): Expression {
  if (!hasCofunctionTrig(e)) return e;
  if (hasMixedPartnerTrig(e)) return e; // mixed cross-pair: leave to unifyInertTrig
  const shifted = cofunctionShiftRec(ce, e, x);
  if (hasDesyncedTargetArgs(shifted)) return e; // within-pair arg desync: revert
  return shifted;
}

// Reciprocal inert heads → negative power of their base cofunction: `csc→1/sin`,
// `sec→1/cos`. Unlike Mathematica Rubi — which keeps `csc`/`sec` as distinct
// inert heads and carries a full parallel family of `(b·csc)^n`/`(b·sec)^n`
// rules — this port routes reciprocal-head integrands through the sine/cosine
// POWER rules, which already handle negative exponents (`∫sin·cos^-5` closes
// but `∫sin·sec^5` did not, because `sec` is an opaque head no `(d·cos)^n`
// pattern matches). Rewriting the reciprocal to a negative power collapses
// products like `sin·csc^5 → sin^-4` and exposes `cos·csc^5 → cos·sin^-5` to
// the odd-power substitution, so the whole `(g cos)^p (a+b sin)^m (c+d sin)^n`
// (§4.1.2.2) and bare `∫csc^n`/`∫sec^n` families close. Value-preserving.
const RECIP_BASE: Record<string, string> = { csc: 'sin', sec: 'cos' };

/** Rewrite one node. `frozen` is set inside the base of a NON-integer power:
 * there the reciprocal must NOT be converted, because `(b·sec[θ])^(1/2)` and
 * `(b·cos[θ]^-1)^(1/2)` disagree on the principal branch (the √ of a reciprocal
 * ≠ the reciprocal of the √ where the base is negative) — converting there
 * flips the sign on part of the real axis (observed as wrong magnitudes on the
 * half-integer `√(b·sec)` cases). Only integer powers of a reciprocal head are
 * branch-safe, and those still fold. */
function reciprocalToPowerRec(
  ce: ComputeEngine,
  e: Expression,
  frozen: boolean
): Expression {
  if (e.operator === 'Power' && e.ops?.length === 2) {
    const [base, exp] = e.ops;
    const expInt = isLiteralInteger(exp);
    const recip = RECIP_BASE[base.operator];
    if (!frozen && expInt && recip !== undefined && base.ops?.length === 1)
      return ce.function('Power', [
        ce.function(recip, [reciprocalToPowerRec(ce, base.ops[0], false)]),
        exp.neg(),
      ]);
    const newBase = reciprocalToPowerRec(ce, base, frozen || !expInt);
    const newExp = reciprocalToPowerRec(ce, exp, frozen);
    if (newBase === base && newExp === exp) return e;
    return ce.function('Power', [newBase, newExp]);
  }
  const recip = RECIP_BASE[e.operator];
  if (!frozen && recip !== undefined && e.ops?.length === 1)
    return ce.function('Power', [
      ce.function(recip, [reciprocalToPowerRec(ce, e.ops[0], false)]),
      ce.NegativeOne,
    ]);
  const ops = e.ops;
  if (!ops || ops.length === 0) return e;
  const newOps = ops.map((o) => reciprocalToPowerRec(ce, o, frozen));
  if (newOps.every((o, i) => o === ops[i])) return e;
  return ce.function(e.operator, newOps);
}

/** True if a `csc`/`sec` reciprocal head appears anywhere in the tree. */
function hasReciprocalTrig(e: Expression): boolean {
  if (RECIP_BASE[e.operator] !== undefined) return true;
  return e.ops?.some(hasReciprocalTrig) ?? false;
}

/** True if a `csc`/`sec` head appears raised to a NON-integer power (including
 * under `Sqrt`, or as `(coef·sec)^(1/2)`). Converting such a reciprocal to a
 * cosine/sine power is branch-unsafe — `√(b·sec) ≠ √(b/cos)` off the principal
 * branch — and even a branch-safe INTEGER `csc`/`sec` factor sharing the
 * integrand with such a half-integer reciprocal exposes it to elliptic rules
 * that return branch-wrong forms. So skip the whole rewrite for those
 * (R3 half-integer-power territory). A fractional power of a *plain* sin/cos
 * (with only integer csc/sec present) is unaffected — that conversion is safe
 * and closes real cases (e.g. `csc/(d·cos)^(7/2)`). */
function hasFractionalReciprocalTrig(e: Expression): boolean {
  if (e.operator === 'Sqrt')
    return e.ops?.[0] ? hasReciprocalTrig(e.ops[0]) : false;
  if (e.operator === 'Power' && e.ops?.length === 2) {
    const [base, exp] = e.ops;
    if (!isLiteralInteger(exp) && hasReciprocalTrig(base)) return true;
  }
  return e.ops?.some(hasFractionalReciprocalTrig) ?? false;
}

/** Rewrite inert reciprocal trig heads to negative powers: `csc[θ]→sin[θ]^-1`,
 * `sec[θ]→cos[θ]^-1` (identity when neither appears). See the block comment.
 * Only branch-safe (integer-exponent) occurrences are converted, and the whole
 * rewrite is skipped for integrands carrying a half-integer csc/sec power. */
export function reciprocalToPower(ce: ComputeEngine, e: Expression): Expression {
  if (hasFractionalReciprocalTrig(e)) return e;
  return reciprocalToPowerRec(ce, e, false);
}

// ---------------------------------------------------------------------------
// UnifyInertTrigFunction (cofunction-shift subset) — the last step of Rubi's
// DeactivateTrig pipeline (IntegrationUtilityFunctions.m). Rubi has NO Cosine
// chapter: a STANDALONE cosine is rewritten to a sine of a shifted argument so
// it routes to the sine rules. The clause (verified against Rubi via
// wolframscript, source line 6576):
//
//   (a + b·cos[e+f·x])^n  →  (a + b·sin[e + π/2 + f·x])^n   /; FreeQ[{a,b,e,f,n}]
//
// So bare `∫cos^n` becomes `∫sin[π/2+x]^n` → the bare-sine power rule 4.1.1.1#1,
// and `∫(a+b·cos)^n` routes to the sine-binomial rules. It fires ONLY when
// cosine is the sole x-dependent trig: a *mixed* sin·cos integrand keeps its
// cosine (handled by the `(g cos)^p (a+b sin)^m` rules), exactly as Rubi's
// `DeactivateTrig[(1+sin)·cos^4]` keeps `cos^4·(1+sin)`.
// ---------------------------------------------------------------------------

/** A term `(x-free coef)·cos[linear arg]` (or bare `cos[linear arg]`): returns
 * `{coef, arg}`, else null. */
function cosTermParts(
  t: Expression,
  x: string
): { coef: Expression; arg: Expression } | null {
  if (t.operator === 'cos' && t.ops) {
    return polyDegreeX(t.ops[0], x) === 1
      ? { coef: t.engine.One, arg: t.ops[0] }
      : null;
  }
  if (t.operator === 'Multiply' && t.ops) {
    const cosFactors = t.ops.filter((o) => o.operator === 'cos');
    const rest = t.ops.filter((o) => o.operator !== 'cos');
    if (cosFactors.length !== 1 || rest.some((o) => o.has(x))) return null;
    const c = cosFactors[0];
    if (!c.ops || polyDegreeX(c.ops[0], x) !== 1) return null;
    const coef =
      rest.length === 0
        ? t.engine.One
        : rest.length === 1
          ? rest[0]
          : t.engine.function('Multiply', rest);
    return { coef, arg: c.ops[0] };
  }
  return null;
}

/** `a + b·cos[arg]` → `a + b·sin[arg + π/2]` when the base's only x-dependence
 * is a single linear-argument cosine (the standalone-cosine clause); else null. */
function cosBaseToSin(
  ce: ComputeEngine,
  base: Expression,
  x: string
): Expression | null {
  const terms = base.operator === 'Add' && base.ops ? base.ops : [base];
  let a = ce.Zero;
  let cosCoef: Expression | null = null;
  let cosArg: Expression | null = null;
  for (const t of terms) {
    if (!t.has(x)) {
      a = a.add(t);
      continue;
    }
    const parts = cosTermParts(t, x);
    if (parts === null) return null; // an x-dependent non-cosine term ⇒ not standalone
    if (cosArg === null) {
      cosCoef = parts.coef;
      cosArg = parts.arg;
    } else {
      if (!cosArg.isSame(parts.arg)) return null;
      cosCoef = cosCoef!.add(parts.coef);
    }
  }
  if (cosArg === null) return null; // no cosine present
  const shifted = ce.function('sin', [cosArg.add(ce.Pi.div(2))]);
  const sinTerm = cosCoef!.isSame(1) ? shifted : cosCoef!.mul(shifted);
  return a.isSame(0) ? sinTerm : a.add(sinTerm);
}

// Inert trig heads (lowercase), as produced by DeactivateTrig.
const INERT_TRIG = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc']);

// A single trig monomial `coef·trig[arg]` (`{ head, coef, arg }`) or a binomial
// `a + b·trig[arg]` (`{ head, a, b, arg }`), as recognized inside a product
// factor's base. `coef`/`a`/`b` are x-free; `arg` is linear in x.
type TrigMono = { head: string; coef: Expression; arg: Expression };
type TrigBinom = { head: string; a: Expression; b: Expression; arg: Expression };

/** `coef·trig[linear arg]` (or bare `trig[linear arg]`) → `{head, coef, arg}`,
 * else null. `coef` must be x-free. */
function trigMonoParts(e: Expression, x: string): TrigMono | null {
  if (INERT_TRIG.has(e.operator) && e.ops) {
    return polyDegreeX(e.ops[0], x) === 1
      ? { head: e.operator, coef: e.engine.One, arg: e.ops[0] }
      : null;
  }
  if (e.operator === 'Multiply' && e.ops) {
    const trig = e.ops.filter((o) => INERT_TRIG.has(o.operator));
    const rest = e.ops.filter((o) => !INERT_TRIG.has(o.operator));
    if (trig.length !== 1 || rest.some((o) => o.has(x))) return null;
    const t = trig[0];
    if (!t.ops || polyDegreeX(t.ops[0], x) !== 1) return null;
    const coef =
      rest.length === 0
        ? e.engine.One
        : rest.length === 1
          ? rest[0]
          : e.engine.function('Multiply', rest);
    return { head: t.operator, coef, arg: t.ops[0] };
  }
  return null;
}

/** `a + b·trig[linear arg]` (x-free constant part `a`, single trig term) →
 * `{head, a, b, arg}`, else null. */
function trigBinomParts(
  ce: ComputeEngine,
  e: Expression,
  x: string
): TrigBinom | null {
  if (e.operator !== 'Add' || !e.ops) return null;
  let a: Expression = ce.Zero;
  let mono: TrigMono | null = null;
  for (const t of e.ops) {
    if (!t.has(x)) {
      a = a.add(t);
      continue;
    }
    if (mono !== null) return null; // a second x-dependent term ⇒ not a binomial
    mono = trigMonoParts(t, x);
    if (mono === null) return null;
  }
  if (mono === null) return null;
  return { head: mono.head, a, b: mono.coef, arg: mono.arg };
}

// A product factor `(base)^exp` classified as monomial or binomial. `exp` is
// x-free (default 1).
type Factor =
  | { kind: 'mono'; head: string; coef: Expression; arg: Expression; exp: Expression }
  | {
      kind: 'binom';
      head: string;
      a: Expression;
      b: Expression;
      arg: Expression;
      exp: Expression;
    };

/** Classify a single product factor into a trig monomial or binomial power,
 * else null. */
function classifyFactor(
  ce: ComputeEngine,
  f: Expression,
  x: string
): Factor | null {
  let exp: Expression = ce.One;
  let base = f;
  if (f.operator === 'Power' && f.ops) {
    if (f.ops[1].has(x)) return null; // exponent must be x-free
    exp = f.ops[1];
    base = f.ops[0];
  }
  const m = trigMonoParts(base, x);
  if (m) return { kind: 'mono', head: m.head, coef: m.coef, arg: m.arg, exp };
  const bi = trigBinomParts(ce, base, x);
  if (bi) return { kind: 'binom', head: bi.head, a: bi.a, b: bi.b, arg: bi.arg, exp };
  return null;
}

/** Build `(coef·head[arg])^exp` (dropping a unit coefficient / exponent). */
function buildMono(
  ce: ComputeEngine,
  coef: Expression,
  head: string,
  arg: Expression,
  exp: Expression
): Expression {
  const node = ce.function(head, [arg]);
  const base = coef.isSame(1) ? node : coef.mul(node);
  return exp.isSame(1) ? base : ce.function('Power', [base, exp]);
}

/** Build `(a + b·head[arg])^exp` (dropping a zero constant / unit exponent). */
function buildBinom(
  ce: ComputeEngine,
  a: Expression,
  b: Expression,
  head: string,
  arg: Expression,
  exp: Expression
): Expression {
  const node = ce.function(head, [arg]);
  const term = b.isSame(1) ? node : b.mul(node);
  const base = a.isSame(0) ? term : a.add(term);
  return exp.isSame(1) ? base : ce.function('Power', [base, exp]);
}

// Two-factor cofunction-shift clauses (IntegrationUtilityFunctions.m §1.0,
// 1.1.2, 1.1.3). Rubi has no Cosine chapter, so a cos *binomial* `(a+b·cos)` —
// or a cos/cofunction *monomial* product (cos·csc, cos·sec) with no sine —
// must be rewritten so the sine rules apply. The two factors share a single
// linear argument θ; the shift θ→θ±π/2 turns cos into sin (or sin into cos)
// while carrying the paired monomial along so both keep a common argument.
function unifyProductClauses(
  ce: ComputeEngine,
  f1: Expression,
  f2: Expression,
  x: string
): Expression | null {
  const c1 = classifyFactor(ce, f1, x);
  const c2 = classifyFactor(ce, f2, x);
  if (c1 === null || c2 === null) return null;
  if (!c1.arg.isSame(c2.arg)) return null;
  const argP = c1.arg.add(ce.Pi.div(2)); // θ + π/2
  const argM = c1.arg.sub(ce.Pi.div(2)); // θ − π/2

  for (const [g, h] of [
    [c1, c2],
    [c2, c1],
  ] as const) {
    if (g.kind === 'mono' && h.kind === 'mono') {
      // (a Cos)^m (b Csc)^n == (a Sin[θ+π/2])^m (-b Sec[θ+π/2])^n
      if (g.head === 'cos' && h.head === 'csc')
        return ce.function('Multiply', [
          buildMono(ce, g.coef, 'sin', argP, g.exp),
          buildMono(ce, h.coef.neg(), 'sec', argP, h.exp),
        ]);
      // (a Cos)^m (b Sec)^n == (a Sin[θ+π/2])^m (b Csc[θ+π/2])^n
      if (g.head === 'cos' && h.head === 'sec')
        return ce.function('Multiply', [
          buildMono(ce, g.coef, 'sin', argP, g.exp),
          buildMono(ce, h.coef, 'csc', argP, h.exp),
        ]);
    }
    if (g.kind === 'mono' && h.kind === 'binom' && h.head === 'cos') {
      const binomM = buildBinom(ce, h.a, h.b.neg(), 'sin', argM, h.exp); // a − b Sin[θ−π/2]
      const binomP = buildBinom(ce, h.a, h.b, 'sin', argP, h.exp); //       a + b Sin[θ+π/2]
      // (g Sin)^p (a+b Cos)^m == (g Cos[θ−π/2])^p (a−b Sin[θ−π/2])^m
      if (g.head === 'sin')
        return ce.function('Multiply', [
          buildMono(ce, g.coef, 'cos', argM, g.exp),
          binomM,
        ]);
      // (g Csc)^p (a+b Cos)^m == (g Sec[θ−π/2])^p (a−b Sin[θ−π/2])^m
      if (g.head === 'csc')
        return ce.function('Multiply', [
          buildMono(ce, g.coef, 'sec', argM, g.exp),
          binomM,
        ]);
      // (g Cot)^p (a+b Cos)^m == (-g Tan[θ−π/2])^p (a−b Sin[θ−π/2])^m
      if (g.head === 'cot')
        return ce.function('Multiply', [
          buildMono(ce, g.coef.neg(), 'tan', argM, g.exp),
          binomM,
        ]);
      // (g Tan)^p (a+b Cos)^m == (-g Cot[θ+π/2])^p (a+b Sin[θ+π/2])^m
      if (g.head === 'tan')
        return ce.function('Multiply', [
          buildMono(ce, g.coef.neg(), 'cot', argP, g.exp),
          binomP,
        ]);
    }
  }
  return null;
}

// Standalone-cosine leaf shift (the poly·cos generalization of cosBaseToSin).
// Rubi's DeactivateTrig reflects a lone linear-argument cosine onto the sine
// chapter (`cos[e+f·x] → sin[e+π/2+f·x]`, source line 6576) as a LEAF identity —
// it applies regardless of what x-dependent factors (a polynomial (c+d·x)^m, a
// reciprocal (c+d·x)^-k, …) multiply the cosine. `cosBaseToSin`/`unifyInertTrig`
// only cover the base of a `(a+b·cos)^n` power (x-free coefficient), so a
// poly·cos product (`∫(c+d·x)^m·cos`, `∫cos/(c+d·x)^k`) was NOT reflected and
// stranded — the sine-chapter reduction `∫(c+d·x)^m·sin → …+∫(c+d·x)^(m-1)·cos`
// (4.1.10 #1) bottoms out in exactly such a `poly·cos` sub-integral whose
// closing rule lives in the unbundled Cosine chapter. This full-tree leaf
// rewrite closes it. Gated to fire ONLY when cosine is the SOLE trig head: any
// other inert trig (sin/tan/cot/sec/csc) means a mixed cross-pair form where a
// blind reflection desyncs arguments or steals a mixed-rule match — left to the
// two-factor clauses in `unifyInertTrig` and the bundled mixed rules.
const NON_COS_INERT_TRIG = new Set(['sin', 'tan', 'cot', 'sec', 'csc']);
function hasNonCosInertTrig(e: Expression): boolean {
  if (NON_COS_INERT_TRIG.has(e.operator)) return true;
  return e.ops?.some(hasNonCosInertTrig) ?? false;
}
function hasLinearArgCos(e: Expression, x: string): boolean {
  if (e.operator === 'cos' && e.ops?.length === 1 && polyDegreeX(e.ops[0], x) === 1)
    return true;
  return e.ops?.some((o) => hasLinearArgCos(o, x)) ?? false;
}
function cosLeafShiftRec(
  ce: ComputeEngine,
  e: Expression,
  x: string
): Expression {
  if (
    e.operator === 'cos' &&
    e.ops?.length === 1 &&
    polyDegreeX(e.ops[0], x) === 1
  )
    return ce.function('sin', [e.ops[0].add(ce.Pi.div(2))]);
  const ops = e.ops;
  if (!ops || ops.length === 0) return e;
  const newOps = ops.map((o) => cosLeafShiftRec(ce, o, x));
  if (newOps.every((o, i) => o === ops[i])) return e;
  return ce.function(e.operator, newOps);
}

/** Rubi DeactivateTrig standalone-cosine reflection as a full-tree LEAF rewrite:
 * when cosine (with a linear argument) is the SOLE x-dependent trig head, map
 * every `cos[e+f·x] → sin[e+π/2+f·x]` so the integrand routes to the sine
 * chapter (Rubi has no Cosine chapter). Generalizes `unifyInertTrig`'s
 * base-only cos→sin to poly·cos products (`∫(c+d·x)^m·cos`, `∫cos/(c+d·x)^k`).
 * A strict no-op when any other inert trig head is present (mixed cross-pair,
 * handled by the two-factor clauses) or no linear-argument cosine appears. */
export function standaloneCosineShift(
  ce: ComputeEngine,
  e: Expression,
  x: string
): Expression {
  if (hasNonCosInertTrig(e)) return e;
  if (!hasLinearArgCos(e, x)) return e;
  return cosLeafShiftRec(ce, e, x);
}

/** UnifyInertTrigFunction[u, x] (cofunction-shift subset): rewrites a
 * standalone inert cosine power/binomial `(a+b·cos)^n` to the sine cofunction
 * `(a+b·sin[arg+π/2])^n`, and the two-factor cos/cofunction product clauses
 * (`(a cos)^m (b csc/sec)^n`, `(g sin/csc/cot/tan)^p (a+b cos)^m`) to their
 * sine-chapter forms. A no-op otherwise (incl. mixed sin·cos integrands that
 * the sine rules already handle). */
export function unifyInertTrig(
  ce: ComputeEngine,
  u: Expression,
  x: string
): Expression {
  // Rubi: UnifyInertTrigFunction[a_*u_,x] := a*UnifyInertTrigFunction[u,x] /;
  // FreeQ[a,x] — split off x-free factors, then match the two-factor product
  // clauses on the x-dependent factors. Anything else falls through to the
  // single-factor path below (which still handles a lone `coef·cos` monomial).
  if (u.operator === 'Multiply' && u.ops) {
    const xfree = u.ops.filter((o) => !o.has(x));
    const dep = u.ops.filter((o) => o.has(x));
    if (dep.length === 2) {
      const conv = unifyProductClauses(ce, dep[0], dep[1], x);
      if (conv !== null)
        return xfree.length === 0
          ? conv
          : ce.function('Multiply', [...xfree, conv]);
    }
  }

  let base = u;
  let n: Expression | null = null;
  if (u.operator === 'Power' && u.ops) {
    if (u.ops[1].has(x)) return u; // exponent must be x-free
    base = u.ops[0];
    n = u.ops[1];
  }
  const conv = cosBaseToSin(ce, base, x);
  if (conv === null) return u;
  return n === null ? conv : ce.function('Power', [conv, n]);
}

// Active trig single-node test (one of Sin/Cos/Tan/Cot/Sec/Csc), used by the
// reverse-chain and FunctionOfTrig utilities below (which run on ACTIVE heads,
// the rules pre-wrap their arguments in ActivateTrig).
function activeTrigHeadQ(e: Expression): boolean {
  return TO_INERT[e.operator] !== undefined;
}

// ---------------------------------------------------------------------------
// Reverse chain rule: EasyDQ + DerivativeDivides (4.7.5 #64–#67).
//
// DerivativeDivides[y, u, x] (IntegrationUtilityFunctions.m): if d/dx(y)
// divides u with an x-free quotient q, returns q — so ∫ u·y^m dx = q·y^(m+1)/
// (m+1) (e.g. ∫cos·sin⁴ has y=sin, u=cos, q = cos/cos = 1). Otherwise returns
// the symbol `False`. The 4.7.5 rules gate via `With[{q=DerivativeDivides[…]},
// … /; Not[FalseQ[q]]]`, so the non-applicable branch MUST return the False
// *symbol*, never RuleFail (a throw would abort the whole rule, not just this
// binding).
//
// Performance (the naive port stalled the benchmark — it ran D+Simplify on
// every wrong AC binding of every integrand): (1) `easyDQ` short-circuits any
// y that is not cheap to differentiate before any D/Simplify; (2) the quotient
// u/v is formed canonically first and only `safeSimplify`d when it still
// carries x (the common trig case `cos/cos`, `sec²/sec²` reduces in canonical
// form, so Simplify is skipped entirely).
// ---------------------------------------------------------------------------

/** Rubi EasyDQ — conservative: true iff y is cheap to differentiate wrt x.
 * Fail-closed (unknown shapes → false), which only makes DerivativeDivides
 * decline a binding; it never produces a wrong quotient. */
function easyDQ(u: Expression, x: string): boolean {
  if (!u.ops || u.ops.length === 0 || !u.has(x)) return true; // atom / x-free
  const op = u.operator;
  if (CALCULUS_FNS.has(op)) return false;
  if (op === 'Power') return !u.ops[1].has(x) && easyDQ(u.ops[0], x);
  if (op === 'Divide') return u.ops.every((o) => easyDQ(o, x));
  if (u.ops.length === 1) return easyDQ(u.ops[0], x); // Sin[v], Cos[v], Negate…
  if (op === 'Multiply') {
    const nonfree = u.ops.filter((o) => o.has(x));
    return nonfree.length <= 1 && nonfree.every((o) => easyDQ(o, x));
  }
  if (op === 'Add') return u.ops.every((o) => easyDQ(o, x));
  return false;
}

/** DerivativeDivides[y, u, x] — see block comment. Returns the x-free quotient
 * or the `False` symbol. */
function derivativeDivides(y: Expression, u: Expression, ctx: Ctx): Expression {
  const ce = ctx.ce;
  const x = ctx.x;
  const FALSE = ce.symbol('False');
  // Rubi: MatchQ[y, a_.*x /; FreeQ[a,x]] → False (degree-1 monomial, no
  // constant term: the trivial linear case handled by polynomial rules).
  const ydeg = polyDegreeX(y, x);
  if (ydeg === 1) {
    const yc = polyCoeffsX(y, x);
    if (yc !== null && yc.length === 2 && zeroQ(yc[0])) return FALSE;
  }
  // Rubi: If[PolynomialQ[y], PolynomialQ[u] && Exponent[u]==Exponent[y]-1,
  // EasyDQ[y]] — a hard gate before any differentiation.
  if (ydeg >= 0) {
    const udeg = polyDegreeX(u, x);
    if (!(udeg >= 0 && udeg === ydeg - 1)) return FALSE;
  } else if (!easyDQ(y, x)) {
    return FALSE;
  }
  const v = ce.function('D', [y, ce.symbol(x)]).evaluate();
  if (zeroQ(v)) return FALSE;
  let q = u.div(v); // canonical quotient: cos/cos → 1, sin⁴/(−sin) → −sin³
  if (!q.has(x)) return q;
  q = safeSimplify(q);
  if (!q.has(x)) return q;
  return FALSE;
}

// ---------------------------------------------------------------------------
// FunctionOfTrig[u, x] (IntegrationUtilityFunctions.m): returns the linear
// argument v such that u is a function of trig functions all sharing v
// (commensurate arguments), else the `False` symbol. It gates the universal
// tan-half substitution rule 4.7.5#83. Without it, `Not[FalseQ[FunctionOfTrig
// [u,x]]]` was vacuously true (the unimplemented head built an inert node, not
// False), so #83 fired on EVERY integrand — even pure-algebraic ones like x⁴ —
// and recursed via SubstFor to the depth cap, exhausting the driver budget
// before earlier reverse-chain rules could fire. Implemented fail-closed: a
// non-trig subterm of x (an unknown function, a bare x, a polynomial in x)
// makes the whole thing False, matching Rubi.
// ---------------------------------------------------------------------------

// false = incompatible (Rubi False); null = no trig seen yet (Rubi Null);
// Expression = the common argument found so far.
type FotState = Expression | null | false;

function fotAux(u: Expression, v: FotState, x: string): FotState {
  if (v === false) return false;
  if (!u.ops || u.ops.length === 0) {
    // atom: a bare x kills it (not a function *of* trig); else propagate v
    return u.symbol === x ? false : v;
  }
  if (activeTrigHeadQ(u) && polyDegreeX(u.ops[0], x) === 1) {
    const arg = u.ops[0];
    if (v === null) return arg;
    if (arg.isSame(v)) return v; // fast path: identical arguments
    // commensurate-argument check (Sin[x] with Sin[2x] etc.):
    // v=a+b·x, arg=c+d·x; need a·d−b·c = 0 and b/d rational.
    const vc = polyCoeffsX(v, x);
    const ac = polyCoeffsX(arg, x);
    if (vc === null || ac === null || vc.length > 2 || ac.length > 2)
      return false;
    const a = vc[0] ?? u.engine.Zero;
    const b = vc[1] ?? u.engine.Zero;
    const c = ac[0] ?? u.engine.Zero;
    const d = ac[1] ?? u.engine.Zero;
    if (!zeroQ(a.mul(d).sub(b.mul(c)))) return false;
    const bd = safeSimplify(b.div(d));
    if (!(bd.isNumberLiteral && bd.isRational === true)) return false;
    const num = bd.numerator;
    return a.div(num).add(b.div(num).mul(u.engine.symbol(x)));
  }
  if (CALCULUS_FNS.has(u.operator)) return false;
  // recurse over operands, threading the argument state
  let w: FotState = v;
  for (const op of u.ops) {
    w = fotAux(op, w, x);
    if (w === false) return false;
  }
  return w;
}

/** FunctionOfTrig[u, x]: the common linear trig argument, or the False symbol. */
function functionOfTrig(
  ce: ComputeEngine,
  u: Expression,
  x: string
): Expression {
  const r = fotAux(activateTrig(ce, u), null, x);
  return r === null || r === false ? ce.symbol('False') : r;
}

// ---------------------------------------------------------------------------
// FunctionOfExponential family (IntegrationUtilityFunctions.m): recognize when
// an integrand u is a function of a single F^v (F constant, v linear in x) and
// rewrite F^v → x, for the master exponential-substitution rule 2.3#97:
//   Int[u] = v/D[v,x] · Subst[Int[FunctionOfExponentialFunction[u]/x, x], x, v]
// Rubi threads fluid $base$/$expon$/$exponFlag$; here the state is explicit.
// Hyperbolic heads count as exponentials (Sinh[w] ≡ (E^w−E^−w)/2), so the same
// machinery serves the Chapter-6 active-hyperbolic integrands.
// ---------------------------------------------------------------------------

const HYPERBOLIC_HEADS = new Set([
  'Sinh',
  'Cosh',
  'Tanh',
  'Coth',
  'Sech',
  'Csch',
]);

/** Does u contain a hyperbolic function head anywhere in its tree? Used by the
 *  driver's Chapter-6 exponential fallback to decide whether to attempt it. */
export function containsHyperbolic(u: Expression): boolean {
  if (HYPERBOLIC_HEADS.has(u.operator)) return true;
  return (u.ops ?? []).some(containsHyperbolic);
}

type FoeState = {
  base: Expression | null; // F (the common exponential base)
  expon: Expression | null; // v (the linear exponent), reduced to primitive
  flag: boolean; // an explicit exponential (Power) occurred
};

const linX = (u: Expression, x: string): boolean => polyDegreeX(u, x) === 1;

/** Coefficient of xᵏ in a constant/linear expr (0 when absent). */
function coeffX(u: Expression, x: string, k: number): Expression {
  const c = polyCoeffsX(u, x);
  return c && c[k] !== undefined ? c[k] : u.engine.Zero;
}

/** FunctionOfExponentialTestAux: register the first exponential, or
 *  commensurate-check a later base^expon against the running state. */
function foeTestAux(
  base: Expression,
  expon: Expression,
  x: string,
  st: FoeState
): boolean {
  const ce = base.engine;
  if (st.base === null) {
    st.base = base;
    st.expon = expon;
    return true;
  }
  // tmp = Log[base]·Coeff[expon,x,1] / (Log[$base$]·Coeff[$expon$,x,1]).
  // The exponentials share a common base iff tmp is rational.
  let tmp = safeSimplify(
    base
      .ln()
      .mul(coeffX(expon, x, 1))
      .div(st.base.ln().mul(coeffX(st.expon!, x, 1)))
  );
  if (!(tmp.isNumberLiteral && tmp.isRational === true)) return false;

  // Do the constant terms share the same ratio? (skip when $expon$ has none)
  const e0 = coeffX(st.expon!, x, 0);
  let constCommensurate = false;
  if (!zeroQ(e0)) {
    const tmp0 = safeSimplify(
      base
        .ln()
        .mul(coeffX(expon, x, 0))
        .div(st.base.ln().mul(e0))
    );
    constCommensurate = tmp.isSame(tmp0);
  }

  // Base normalization for positive-integer bases (e.g. 2^x with 4^x): keep the
  // smaller base, invert tmp.
  if (
    isLiteralInteger(base) &&
    base.isPositive &&
    isLiteralInteger(st.base) &&
    st.base.isPositive &&
    base.isLess(st.base) === true
  ) {
    st.base = base;
    st.expon = expon;
    tmp = safeSimplify(ce.One.div(tmp));
  }

  const denom = tmp.denominator;
  if (!zeroQ(e0) && constCommensurate) {
    // constant terms commensurate: keep the full exponent, reduced
    st.expon = safeSimplify(st.expon!.div(denom));
  } else {
    // no/incommensurate constant: keep only the linear term, reduced
    st.expon = safeSimplify(
      coeffX(st.expon!, x, 1).mul(ce.symbol(x)).div(denom)
    );
  }
  if (tmp.isNegative === true && coeffX(st.expon!, x, 1).isNegative === true)
    st.expon = st.expon!.neg();
  return true;
}

/** FunctionOfExponentialTest: walk u, registering exponential bases/exponents.
 *  Returns true iff u is a function of a single common F^v. */
function foeTest(u: Expression, x: string, st: FoeState): boolean {
  const ce = u.engine;
  if (!u.has(x)) return true; // FreeQ[u,x]
  if (u.symbol === x || CALCULUS_FNS.has(u.operator)) return false;

  if (u.operator === 'Power' && u.ops && !u.ops[0].has(x)) {
    const exp = u.ops[1];
    if (linX(exp, x)) {
      st.flag = true;
      return foeTestAux(u.ops[0], exp, x, st);
    }
    // F^(a+b+…) → F^a · F^b · … : test each summand
    if (exp.operator === 'Add' && exp.ops) {
      st.flag = true;
      return exp.ops.every((t) =>
        foeTest(ce.function('Power', [u.ops![0], t]), x, st)
      );
    }
  }
  if (HYPERBOLIC_HEADS.has(u.operator) && u.ops && linX(u.ops[0], x))
    return foeTestAux(ce.E, u.ops[0], x, st);

  for (const op of u.ops ?? []) if (!foeTest(op, x, st)) return false;
  return true;
}

/** FunctionOfExponentialFunctionAux: u with F^v → x (the new integration
 *  variable), using the registered $base$/$expon$. */
function foeFunctionAux(u: Expression, x: string, st: FoeState): Expression {
  const ce = u.engine;
  if (!u.ops || u.ops.length === 0) return u; // atom

  if (u.operator === 'Power' && !u.ops[0].has(x)) {
    const G = u.ops[0];
    const w = u.ops[1];
    if (linX(w, x)) {
      const p = safeSimplify(
        G.ln()
          .mul(coeffX(w, x, 1))
          .div(st.base!.ln().mul(coeffX(st.expon!, x, 1)))
      );
      const xp = ce.symbol(x).pow(p);
      // G^(const of w) · x^p when $expon$ has no constant term, else x^p
      return zeroQ(coeffX(st.expon!, x, 0))
        ? ce.function('Power', [G, coeffX(w, x, 0)]).mul(xp)
        : xp;
    }
    if (w.operator === 'Add' && w.ops) {
      return w.ops
        .map((t) => foeFunctionAux(ce.function('Power', [G, t]), x, st))
        .reduce((a, b) => a.mul(b));
    }
  }

  if (HYPERBOLIC_HEADS.has(u.operator) && linX(u.ops[0], x)) {
    const w = u.ops[0];
    const p = safeSimplify(
      coeffX(w, x, 1).div(st.base!.ln().mul(coeffX(st.expon!, x, 1)))
    );
    const t = ce.symbol(x).pow(p);
    const inv = ce.One.div(t);
    const two = ce.box(2);
    switch (u.operator) {
      case 'Sinh':
        return t.sub(inv).div(two);
      case 'Cosh':
        return t.add(inv).div(two);
      case 'Tanh':
        return t.sub(inv).div(t.add(inv));
      case 'Coth':
        return t.add(inv).div(t.sub(inv));
      case 'Sech':
        return two.div(t.add(inv));
      case 'Csch':
        return two.div(t.sub(inv));
    }
  }

  return ce.function(
    u.operator,
    u.ops.map((op) => foeFunctionAux(op, x, st))
  );
}

/** FunctionOfExponentialQ[u,x] — u is a function of F^v with an explicit
 *  exponential present (not merely a hyperbolic). */
function functionOfExponentialQ(u: Expression, x: string): boolean {
  const st: FoeState = { base: null, expon: null, flag: false };
  return foeTest(u, x, st) && st.flag;
}

/** FunctionOfExponential[u,x] — the substitution exponential F^v. */
export function functionOfExponential(u: Expression, x: string): Expression {
  const st: FoeState = { base: null, expon: null, flag: false };
  foeTest(u, x, st);
  if (st.base === null) return u.engine.symbol('False');
  return u.engine.function('Power', [st.base, st.expon!]);
}

/** FunctionOfExponentialFunction[u,x] — u with F^v replaced by x. */
export function functionOfExponentialFunction(
  u: Expression,
  x: string
): Expression {
  const st: FoeState = { base: null, expon: null, flag: false };
  foeTest(u, x, st);
  if (st.base === null) return u;
  return foeFunctionAux(u, x, st);
}

/** If `u` is PURELY a function of a single exponential F^v with v linear in x
 *  (Rubi's `FunctionOfExponentialTest` returning true), return `{ v: F^v,
 *  g: u with F^v → x }` for the rule-2.3#97 substitution; otherwise null.
 *
 *  Unlike `functionOfExponential`, this REQUIRES the test to pass — so it
 *  rejects integrands with a bare-x factor (e.g. `Tanh[x]/x²`) or a non-linear
 *  hyperbolic argument (e.g. `Sech[c+d·x²]`), where the substitution would be
 *  invalid. It also drops Rubi's `$exponFlag$` gate (which demands an explicit
 *  exponential): the Chapter-6 fallback applies this to pure hyperbolics, whose
 *  bare-power reductions are not standalone corpus rules. Both v and g come from
 *  the SAME registered base/exponent, so they are consistent. */
export function functionOfExponentialSubstitution(
  u: Expression,
  x: string
): { v: Expression; g: Expression } | null {
  const st: FoeState = { base: null, expon: null, flag: false };
  if (!foeTest(u, x, st) || st.base === null || st.expon === null) return null;
  const ce = u.engine;
  return {
    v: ce.function('Power', [st.base, st.expon]),
    g: foeFunctionAux(u, x, st),
  };
}

/** True iff every Sinh/Cosh subterm of `u` has an argument that is a polynomial
 *  in x. The Chapter-6 exponential expansion is only a valid closed form when
 *  the hyperbolic arguments are polynomial (so each `∫ poly·e^(poly)` resolves
 *  via the Chapter-2 rules); a rational argument like `Sinh[(a+b·x)/(c+d·x)]`
 *  integrates to a CoshIntegral the expansion cannot produce, so the fallback
 *  must decline it. */
export function sinhCoshArgsPolynomialQ(u: Expression, x: string): boolean {
  if ((u.operator === 'Sinh' || u.operator === 'Cosh') && u.ops?.[0]?.has(x))
    if (polyDegreeX(u.ops[0], x) < 0) return false;
  return (u.ops ?? []).every((o) => sinhCoshArgsPolynomialQ(o, x));
}

// ---------------------------------------------------------------------------
// Pure-trig substitution: FunctionOfQ + SubstFor / SubstForTrig (4.7.5 #15–#34).
//
// These rules integrate `∫ u·F(c(a+b·x)) dx` where the explicit trig factor F
// supplies the differential and the rest `u` is a function of one inner trig
// (e.g. ∫cos·g(sin) dx → t=sin → ∫g(t) dt). `FunctionOfQ[t, u, x, True]` is the
// gate (u is a *pure* function of t); `SubstFor[w, t, u, x]` performs t→x.
//
// SCOPE (this slice): the pure sin/cos/tan/cot substitution targets with the
// inner trig arguments all *equal* to the substitution argument (the common
// case). The commensurate-multiple branch (Sin[2v] in terms of Sin[v] via
// TrigExpand) and the half-angle product special case are fail-closed
// (RuleFail) — the rule then falls through, never produces a wrong result.
// The substituted sub-integral is algebraic, so it relies on the driver's
// (now recursive) native rational fallback to close.
// ---------------------------------------------------------------------------

const SIN_HEADS = new Set(['Sin', 'Csc']);
const COS_HEADS = new Set(['Cos', 'Sec']);
const TAN_HEADS = new Set(['Tan', 'Cot']);

/** PureFunctionOf{Sin,Cos,Tan}Q: every trig subterm of argument `v` has a head
 * in `allowed`, and no bare `x` appears (IntegrationUtilityFunctions.m). */
function pureFunctionOfTrigQ(
  u: Expression,
  v: Expression,
  x: string,
  allowed: Set<string>
): boolean {
  if (!u.ops || u.ops.length === 0) return u.symbol !== x; // atom: not x
  if (CALCULUS_FNS.has(u.operator)) return false;
  if (activeTrigHeadQ(u) && u.ops[0].isSame(v)) return allowed.has(u.operator);
  return u.ops.every((o) => pureFunctionOfTrigQ(o, v, x, allowed));
}

/** The substitution target trig node of `v` (the rule passes `trig(arg)/d`);
 * returns the bare trig node after dropping x-free factors, or null. */
function substTrigNode(
  v: Expression,
  x: string,
  ce: ComputeEngine
): Expression | null {
  let vt = v;
  if (v.operator === 'Multiply' || v.operator === 'Divide')
    vt = selectFactors(v, x, ce, false); // NonfreeFactors[v, x]
  return activeTrigHeadQ(vt) && vt.ops ? vt : null;
}

/** FunctionOfQ[v, u, x, pure] — restricted to the pure trig-substitution
 * targets this slice handles; false (decline) otherwise. */
function functionOfQ(
  ce: ComputeEngine,
  v: Expression,
  u: Expression,
  x: string,
  pure: boolean
): boolean {
  if (!u.has(x)) return false; // FreeQ[u, x]
  if (!v.ops || v.ops.length === 0) return true; // AtomQ[v]
  if (!pure) return false; // non-pure dispatch not yet ported
  const vt = substTrigNode(v, x, ce);
  if (vt === null) return false;
  const arg = vt.ops![0];
  const au = activateTrig(ce, u);
  const head = vt.operator;
  if (SIN_HEADS.has(head)) return pureFunctionOfTrigQ(au, arg, x, SIN_HEADS);
  if (COS_HEADS.has(head)) return pureFunctionOfTrigQ(au, arg, x, COS_HEADS);
  if (TAN_HEADS.has(head)) return pureFunctionOfTrigQ(au, arg, x, TAN_HEADS);
  return false;
}

/** SubstForTrig[u, sinE, cosE, v, x] — replace every trig of argument `v` by
 * its image (Sin→sinE, Cos→cosE, Tan→sinE/cosE, …). Fail-closed on the
 * commensurate-argument (TrigExpand) branch. */
function substForTrig(
  u: Expression,
  sinE: Expression,
  cosE: Expression,
  v: Expression,
  ce: ComputeEngine
): Expression {
  if (!u.ops || u.ops.length === 0) return u;
  if (activeTrigHeadQ(u)) {
    if (!u.ops[0].isSame(v))
      throw new RuleFail('SubstForTrig: commensurate argument');
    switch (u.operator) {
      case 'Sin':
        return sinE;
      case 'Cos':
        return cosE;
      case 'Tan':
        return sinE.div(cosE);
      case 'Cot':
        return cosE.div(sinE);
      case 'Sec':
        return ce.One.div(cosE);
      case 'Csc':
        return ce.One.div(sinE);
    }
  }
  return ce.function(
    u.operator,
    u.ops.map((o) => substForTrig(o, sinE, cosE, v, ce))
  );
}

/** SubstFor[v, u, x] — u with the trig subexpression `v` replaced by `x`
 * (u is a function of v). Returns null when v isn't a handled trig target. */
function substFor3(v: Expression, u: Expression, ctx: Ctx): Expression | null {
  const ce = ctx.ce;
  const X = ce.symbol(ctx.x);
  const vt = substTrigNode(v, ctx.x, ce);
  if (vt === null) return null;
  // d ≠ 1 (a free factor on the substitution variable) is not handled here.
  if (!selectFactors(v, ctx.x, ce, true).isSame(1)) return null;
  const arg = vt.ops![0];
  const sqrt1m = ce.function('Sqrt', [ce.One.sub(X.pow(2))]); // √(1−x²)
  const sqrt1p = ce.function('Sqrt', [ce.One.add(X.pow(2))]); // √(1+x²)
  switch (vt.operator) {
    case 'Sin':
      return substForTrig(u, X, sqrt1m, arg, ce);
    case 'Cos':
      return substForTrig(u, sqrt1m, X, arg, ce);
    case 'Tan':
      return substForTrig(u, X.div(sqrt1p), ce.One.div(sqrt1p), arg, ce);
    case 'Cot':
      return substForTrig(u, ce.One.div(sqrt1p), X.div(sqrt1p), arg, ce);
    default:
      return null;
  }
}

// FreeFactors[u, x] / NonfreeFactors[u, x] (IntegrationUtilityFunctions.m):
// the product of the factors of u that are free of x (resp. not free of x).
// Rubi maps over a Product replacing the complementary factors with 1; a
// non-product is u-or-1 by FreeQ. The (a+b cos+c sin) Weierstrass rules bind
// f = FreeFactors[Tan[(d+e x)/2], x] to pull the constant out before Subst;
// without it the inert FreeFactors(…) head poisons the substituted integrand
// (the "linear" coefficient is no longer x-free) and the inner Int never closes.
function selectFactors(
  u: Expression,
  x: string,
  ce: ComputeEngine,
  free: boolean
): Expression {
  if (u.operator === 'Multiply' && u.ops) {
    const kept = u.ops.filter((f) => !f.has(x) === free);
    if (kept.length === 0) return ce.One;
    return kept.length === 1 ? kept[0] : ce.function('Multiply', kept);
  }
  if (!u.has(x)) return free ? u : ce.One;
  return free ? ce.One : u;
}

// ---------------------------------------------------------------------------
// Hyperbolic product/power reduction (Chapter 6, ExpandTrigReduce /
// ExpandTrigToExp).
//
// Rubi's `ExpandTrigReduce[u,x] = Expand[TrigReduce[u]]` uses Mathematica's
// TrigReduce to turn products/powers of Sinh/Cosh into a linear combination of
// multiple-angle hyperbolics. We instead expand the equivalent EXPONENTIAL
// form: rewrite each Sinh/Cosh/… to E^(±w) (`hyperbolicToExp`) and multiply
// out (`deepExpand`), so every resulting term is `coef·∏E^(kᵢ·argᵢ)`. The
// already-ported Chapter-2 exponential rules (incl. the incomplete-Γ / Erf
// kernels) then close each term, and the driver's `toTimesPower` normal form
// folds same-base products E^p·E^q → E^(p+q) per sub-integral. The resulting
// antiderivative is in exponential rather than hyperbolic form, but is
// mathematically identical (verified numerically). Restricted to the heads
// Rubi feeds ExpandTrigReduce — positive-integer powers of Sinh/Cosh and
// (a+b·Sinh/Cosh)^p — leaving reciprocal/fractional powers untouched.
// ---------------------------------------------------------------------------

/** TrigToExp for Sinh/Cosh: rewrite Sinh/Cosh[w] → exp form in E^(±w), with the
 *  ½ coefficient DISTRIBUTED into the two terms so a power base stays a pure Add
 *  (CE's Expand will not pull a scalar out of a power base). The argument w is
 *  kept symbolic; all other heads — including the reciprocal hyperbolics
 *  Tanh/Coth/Sech/Csch — recurse UNCHANGED. Restricting to Sinh/Cosh is
 *  deliberate: (1) Rubi only feeds Sinh/Cosh products to ExpandTrigReduce /
 *  ExpandTrigToExp; (2) the reciprocals convert to exp *quotients* whose
 *  positive-and-negative-power expansion is a hard rational-in-E^x form the
 *  driver's exponential fallback would grind on (it is the FunctionOfExponential
 *  rule's job, not this expander's) — leaving them as heads makes the fallback's
 *  `containsHyperbolic` guard skip such integrands fast. */
function hyperbolicToExp(ce: ComputeEngine, u: Expression): Expression {
  const ops = u.ops;
  if (ops?.length === 1 && (u.operator === 'Sinh' || u.operator === 'Cosh')) {
    const w = hyperbolicToExp(ce, ops[0]);
    const ew = ce.E.pow(w);
    const en = ce.E.pow(w.neg());
    const half = ce.number([1, 2]);
    // Sinh: ½E^w − ½E^−w ;  Cosh: ½E^w + ½E^−w
    return u.operator === 'Sinh'
      ? half.mul(ew).add(half.neg().mul(en))
      : half.mul(ew).add(half.mul(en));
  }
  if (!ops || ops.length === 0) return u;
  return ce.function(
    u.operator,
    ops.map((op) => hyperbolicToExp(ce, op))
  );
}

/** Collect same-base exponential factors of a product: E^p·E^q → E^(p+q). CE's
 *  canonical Multiply does not fuse symbolic-exponent powers (it would change
 *  `x²·y²`), so a raw product of `E^(±w)` factors stays unfused and bloats the
 *  expansion. Folding here keeps each distributed term a single `c·E^(k·w)`, so
 *  the canonical Add merges equal multiples and the expansion stays compact. */
function foldEPowers(ce: ComputeEngine, term: Expression): Expression {
  if (term.operator !== 'Multiply' || !term.ops) return term;
  let eExp: Expression | null = null;
  const others: Expression[] = [];
  for (const f of term.ops) {
    if (f.operator === 'Power' && f.ops && f.ops[0].symbol === 'ExponentialE')
      eExp = eExp === null ? f.ops[1] : eExp.add(f.ops[1]);
    else if (f.symbol === 'ExponentialE')
      eExp = eExp === null ? ce.One : eExp.add(ce.One);
    else others.push(f);
  }
  if (eExp === null) return term;
  const epow = ce.E.pow(eExp);
  return others.length === 0
    ? epow
    : ce.function('Multiply', [...others, epow]);
}

/** Distribute a product of factors across any Add operands → a flat sum (or a
 *  single product if no factor is a sum). Factors are taken as-is (already
 *  deep-expanded by the caller); each product term has its exponentials folded
 *  (foldEPowers) so the running expansion does not blow up. */
function distributeProduct(
  ce: ComputeEngine,
  factors: Expression[]
): Expression {
  let terms: Expression[] = [ce.One];
  for (const f of factors) {
    const fTerms = f.operator === 'Add' && f.ops ? f.ops : [f];
    const next: Expression[] = [];
    for (const t of terms)
      for (const ft of fTerms) next.push(foldEPowers(ce, t.mul(ft)));
    terms = next;
  }
  return terms.length === 1 ? terms[0] : ce.function('Add', terms);
}

/** Recursively expand products and positive-integer powers of sums into a flat
 *  sum, treating every leaf (E^…, symbols, x-powers) as opaque. Used after
 *  `hyperbolicToExp` because CE's `Expand` is shallow — it will not expand a
 *  Power(Add, n) that sits as a factor inside a Multiply. Non-integer/symbolic
 *  exponents are left as-is. */
function deepExpand(ce: ComputeEngine, e: Expression): Expression {
  const op = e.operator;
  if (op === 'Add' && e.ops)
    return ce.function(
      'Add',
      e.ops.map((t) => deepExpand(ce, t))
    );
  if (op === 'Multiply' && e.ops)
    return distributeProduct(
      ce,
      e.ops.map((t) => deepExpand(ce, t))
    );
  if (op === 'Power' && e.ops) {
    const base = deepExpand(ce, e.ops[0]);
    const n = e.ops[1];
    const ni = n.re;
    if (
      typeof ni === 'number' &&
      Number.isInteger(ni) &&
      ni >= 1 &&
      n.isSame(ni)
    ) {
      let acc = base;
      for (let i = 1; i < ni; i++) acc = distributeProduct(ce, [acc, base]);
      return acc;
    }
    return ce.function('Power', [base, n]);
  }
  return e;
}

/** ExpandTrigReduce[u,x] (2-arg) — the exponential-expansion of u (see the
 *  section comment). Returns a sum the linearity prelude integrates termwise. */
function expandTrigReduce(ce: ComputeEngine, u: Expression): Expression {
  return deepExpand(ce, hyperbolicToExp(ce, u));
}

/** Driver Chapter-6 fallback: rewrite a hyperbolic integrand to exponential
 *  form and expand it into a sum, so the bundled Chapter-2 exponential rules
 *  close each term. Used only when no Rubi rule closed the integrand — Rubi's
 *  bare `(a+b·Sinh[linear])^n` / `(c+d·x)^m·Sinh^n` recurrences live in shared
 *  machinery that is not a standalone corpus rule, so this self-contained
 *  reducer keeps those linear-argument families integrable. The antiderivative
 *  is exponential-form but numerically identical to Rubi's hyperbolic form. */
export function expandHyperbolicToExp(
  ce: ComputeEngine,
  u: Expression
): Expression {
  return deepExpand(ce, hyperbolicToExp(ce, u));
}

// ---------------------------------------------------------------------------
// Trig → exponential fallback for NONLINEAR-argument sin/cos (4.1.11 / 4.1.12).
//
// The direct analog of the Chapter-6 hyperbolic→exp fallback. Rubi's
// nonlinear-argument sine rules (4.1.12 #5/#15 `∫Sin[c+d·xⁿ] → I/2·∫E^… − …`,
// #29 the t=xⁿ substitution) route `∫xᵐ·sin(a+b·xⁿ)` to `∫xᵐ·E^(k·xⁿ)`, closed
// by the bundled Chapter-2 incomplete-Γ kernel — exactly like the hyperbolic
// `Sinh[a+b·xⁿ]` cases. CE's structural matcher does not bind those Subst /
// linear-inner-match rules (the `(e+f·x)ⁿ` base defaulting to `xⁿ` and the
// `Simplify[(m+1)/n]` exponent are Mathematica-simplifier dependent), so this
// self-contained reducer supplies the same capability: rewrite sin/cos → E^(±i·w)
// and expand, so every term is `coef·xᵏ·E^(k·xⁿ)`.
//
// Gated (`sinCosArgNonlinearExpandableQ`) to fire ONLY when a sin/cos of a
// NONLINEAR monomial argument (`c + d·xᵏ`, k≠1 — incl. k<0 for sin(a+b/x)) is
// present and EVERY x-dependent sin/cos argument is such a monomial. Linear-
// argument sin/cos is left to the sine chapter (it never reaches this fallback —
// the rules close it first); a multi-term / non-monomial argument (quadratic
// `a+b·x+c·x²`, `(e+f·x)ⁿ`) is declined, so those stay with their own rules.
// ---------------------------------------------------------------------------

/** TrigToExp for inert sin/cos: `sin[w] → (i/2)E^(−i·w) − (i/2)E^(i·w)`,
 *  `cos[w] → (1/2)E^(i·w) + (1/2)E^(−i·w)`, with the scalar DISTRIBUTED into
 *  the two terms so a power base stays a pure Add (mirrors hyperbolicToExp).
 *  Only sin/cos convert; every other head recurses unchanged. */
function trigToExp(ce: ComputeEngine, u: Expression): Expression {
  const ops = u.ops;
  if (ops?.length === 1 && (u.operator === 'sin' || u.operator === 'cos')) {
    const w = trigToExp(ce, ops[0]);
    const i = ce.I;
    const ewPos = ce.E.pow(i.mul(w)); // E^(i·w)
    const ewNeg = ce.E.pow(i.neg().mul(w)); // E^(−i·w)
    const half = ce.number([1, 2]);
    if (u.operator === 'cos') return half.mul(ewPos).add(half.mul(ewNeg));
    // sin[w] = (E^(i·w) − E^(−i·w))/(2i) = −(i/2)E^(i·w) + (i/2)E^(−i·w)
    const hi = half.mul(i);
    return hi.neg().mul(ewPos).add(hi.mul(ewNeg));
  }
  if (!ops || ops.length === 0) return u;
  return ce.function(
    u.operator,
    ops.map((op) => trigToExp(ce, op))
  );
}

/** The exponent k of a single `d·xᵏ` term (d x-free): bare `x`→1, `x^k`→k,
 *  `d·x`/`d·x^k`→1/k. Null if `t` is not one x-free-scaled power of x. */
function xPowerExponent(t: Expression, x: string): Expression | null {
  if (t.symbol === x) return t.engine.One;
  if (t.operator === 'Power' && t.ops && t.ops[0].symbol === x && !t.ops[1].has(x))
    return t.ops[1];
  if (t.operator === 'Multiply' && t.ops) {
    const dep = t.ops.filter((o) => o.has(x));
    if (dep.length !== 1) return null;
    return xPowerExponent(dep[0], x);
  }
  return null;
}

/** For a trig argument `arg`: the exponent k if `arg = c + d·xᵏ` (x-free c, one
 *  x-monomial term), else null. */
function trigArgMonomialExponent(
  arg: Expression,
  x: string
): Expression | null {
  const terms = arg.operator === 'Add' && arg.ops ? arg.ops : [arg];
  let k: Expression | null = null;
  for (const t of terms) {
    if (!t.has(x)) continue;
    const e = xPowerExponent(t, x);
    if (e === null) return null;
    if (k !== null) return null; // two x-dependent terms ⇒ not a monomial
    k = e;
  }
  return k;
}

/** Gate for `expandTrigToExp`: every x-dependent sin/cos argument in the
 *  integrand is a NONLINEAR monomial `c + d·xᵏ` (k≠1), none a concrete negative
 *  exponent, and at least one such nonlinear trig appears — the 4.1.11/4.1.12
 *  `∫xᵐ·sin(a+b·xⁿ)` family (incl. the `(c·sin³)^(1/3)` cube-root form of
 *  #328/#329). A linear (k=1) argument is ignored — the sine rules close it
 *  first, so it never reaches this fallback. The fallback's own numeric-
 *  evaluability check (`driver`) then drops any result whose special-function
 *  form CE cannot evaluate, so an over-inclusive gate here only costs a wasted
 *  expansion, never a not-evaluable. */
export function sinCosArgNonlinearExpandableQ(
  u: Expression,
  x: string
): boolean {
  let sawNonlinear = false;
  const walk = (e: Expression): boolean => {
    if ((e.operator === 'sin' || e.operator === 'cos') && e.ops?.[0]?.has(x)) {
      const k = trigArgMonomialExponent(e.ops[0], x);
      if (k === null) return false; // non-monomial x-argument ⇒ decline
      // Concrete negative exponent (`sin(a+b/x)`) ⇒ complex-Ei form; not a
      // monomial-power target the exp route handles cleanly.
      if (k.isNumberLiteral && typeof k.re === 'number' && k.re < 0)
        return false;
      if (!k.isSame(1)) sawNonlinear = true;
    }
    return (e.ops ?? []).every(walk);
  };
  return walk(u) && sawNonlinear;
}

/** True iff `F` evaluates to a finite complex number under a random assignment
 *  of all its free symbols (excluding the known constants) and `x`. The
 *  trig→exp fallback uses it to REJECT a result whose special-function form CE
 *  cannot evaluate numerically (a complex-argument `ExpIntegralEi`, a negative-
 *  order incomplete Γ): such a result is symbolically an antiderivative but
 *  unverifiable, so the fallback declines it (leaving the problem unsolved)
 *  rather than emitting an inert-verifying not-evaluable. Cheap: one sample. */
export function numericallyEvaluable(F: Expression, x: string): boolean {
  const ce = F.engine;
  const known = new Set([
    'Pi',
    'ExponentialE',
    'ImaginaryUnit',
    'GoldenRatio',
    'EulerGamma',
    'CatalanConstant',
    'True',
    'False',
    'Nothing',
  ]);
  const sub: Record<string, number> = {};
  let seed = 0.37;
  const collect = (e: Expression): void => {
    if (e.symbol && !known.has(e.symbol)) {
      if (!(e.symbol in sub)) {
        sub[e.symbol] = seed;
        seed += 0.53;
      }
    }
    (e.ops ?? []).forEach(collect);
  };
  collect(F);
  sub[x] = 1.31;
  try {
    const v = F.subs(sub).N();
    if (!v.isNumberLiteral) return false;
    const re = v.re;
    const im = v.im ?? 0;
    return (
      typeof re === 'number' &&
      Number.isFinite(re) &&
      typeof im === 'number' &&
      Number.isFinite(im)
    );
  } catch {
    return false;
  }
}

/** True if any inert sin/cos head appears (guards the fallback re-entry). */
export function containsInertSinCos(u: Expression): boolean {
  if (u.operator === 'sin' || u.operator === 'cos') return true;
  return (u.ops ?? []).some(containsInertSinCos);
}

/** Driver fallback: rewrite a nonlinear-argument trig integrand to exponential
 *  form and expand it into a sum, so the bundled Chapter-2 exponential rules
 *  (incl. the incomplete-Γ kernel) close each `coef·xᵏ·E^(k·xⁿ)` term. The
 *  antiderivative is exponential/incomplete-Γ form — mathematically identical
 *  to Rubi's (verified numerically). */
export function expandTrigToExp(
  ce: ComputeEngine,
  u: Expression
): Expression {
  return deepExpand(ce, trigToExp(ce, u));
}

/** Tidy the residual exponential artifacts CE's in-context simplify leaves in
 *  the Chapter-6 fallback results: `Ln(ExponentialE) → 1` (the Chapter-2 rules
 *  emit `Log[F]` literally, and with base F = ExponentialE that is a stray
 *  `ln(e)` in denominators) and `E^(0·…) → 1` (the exponential substitution can
 *  leave a `e^(0·x)` constant term). Both fold to 1 in isolation but CE's
 *  simplify does not always reach them in a large product/quotient. Sound,
 *  structural, cheap. */
export function foldLnExponentialE(
  ce: ComputeEngine,
  e: Expression
): Expression {
  const op = e.operator;
  if (
    (op === 'Ln' || op === 'Log') &&
    e.ops?.length === 1 &&
    e.ops[0].symbol === 'ExponentialE'
  )
    return ce.One;
  // E^(0·…) → 1 (the exponent canonicalizes to a literal 0 multiple)
  if (
    op === 'Power' &&
    e.ops?.length === 2 &&
    e.ops[0].symbol === 'ExponentialE'
  )
    if (e.ops[1].N().isSame(0)) return ce.One;
  if (!e.ops || e.ops.length === 0) return e;
  return ce.function(
    op,
    e.ops.map((o) => foldLnExponentialE(ce, o))
  );
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
    const u = build(args[0], ctx);
    const n = build(args[1], ctx);
    const r = rtExpr(u, n);
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
    const v: Expression = expand(build(args[1], ctx));
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
    const ce = ctx.ce;
    if (args.length === 3) {
      // ExpandIntegrand[u, v, x] := DistributeOverTerms[u, ExpandIntegrand[v, x], x]
      // — expand v, then multiply every resulting term by u. Used by the
      // Chapter-2 Px·Fᵛ rules (Px a polynomial, Fᵛ an exponential): the
      // polynomial expands into monomials, each multiplied by Fᵛ, so the
      // driver integrates Σ cₖ xᵏ Fᵛ term-by-term.
      const w = build(['ExpandIntegrand', args[1], args[2]], ctx);
      const z = build(args[0], ctx);
      if (w.operator === 'Add' && w.ops)
        return ce.function(
          'Add',
          w.ops.map((t) => z.mul(t))
        );
      return z.mul(w);
    }
    if (args.length !== 2) return fail('ExpandIntegrand arity');
    const u = build(args[0], ctx);
    const e = expand(u);
    if (e.operator === 'Add') return e;
    return expandPolyOverLinear(u, ctx);
  },

  // RemoveContent[u, x] — drops a constant content factor; returning u
  // unchanged is antiderivative-safe (differs by a constant)
  RemoveContent: (args, ctx) => build(args[0], ctx),

  // ActivateTrig[u] / DeactivateTrig[u, x] — rule-invoked inert↔active trig
  // bridge (127×/1× across Chapter 4). Some rule RHSs wrap their result in
  // ActivateTrig[…] to turn the inert working form back into Sin/Cos.
  ActivateTrig: (args, ctx) => activateTrig(ctx.ce, build(args[0], ctx)),
  DeactivateTrig: (args, ctx) => deactivateTrig(ctx.ce, build(args[0], ctx)),

  // DerivativeDivides[y, u, x] — reverse chain rule (4.7.5 #64–#67). The rules
  // bind it in `With[{q=…}, … /; Not[FalseQ[q]]]`, so it returns the x-free
  // quotient on success or the `False` symbol otherwise (never RuleFail).
  DerivativeDivides: (args, ctx) => {
    if (args.length < 3) return fail('DerivativeDivides arity');
    return derivativeDivides(build(args[0], ctx), build(args[1], ctx), ctx);
  },

  // FunctionOfTrig[u, x] — the common linear trig argument or the `False`
  // symbol. Gates the universal tan-half substitution rule 4.7.5#83 (and
  // FunctionOfTrigOfLinearQ); fail-closed so #83 cannot fire on non-trig
  // integrands (which previously recursed via SubstFor to the depth cap).
  FunctionOfTrig: (args, ctx) =>
    functionOfTrig(ctx.ce, build(args[0], ctx), ctx.x),

  // FunctionOfExponential[u, x] — the substitution exponential F^v; and
  // FunctionOfExponentialFunction[u, x] — u with F^v replaced by x. Drive the
  // master exponential-substitution rule 2.3#97.
  FunctionOfExponential: (args, ctx) =>
    functionOfExponential(build(args[0], ctx), ctx.x),
  FunctionOfExponentialFunction: (args, ctx) =>
    functionOfExponentialFunction(build(args[0], ctx), ctx.x),

  // SimplifyIntegrand[u, x] — Rubi's integrand simplifier; map to the rubi-safe
  // simplifier (referenced by the exponential/log rules).
  SimplifyIntegrand: (args, ctx) => safeSimplify(build(args[0], ctx)),

  // SubstFor[w, v, u, x] / SubstFor[v, u, x] — substitute the trig
  // subexpression v by x in u (times w), for the trig-substitution rules
  // 4.7.5 #15–#34. Handles the pure sin/cos/tan/cot targets with inner
  // arguments equal to v's; the commensurate-argument (TrigExpand) and
  // tan-half universal (#83) branches stay fail-closed (RuleFail → the rule
  // falls through). See substFor3/substForTrig.
  SubstFor: (args, ctx) => {
    if (args.length >= 4) {
      const w = build(args[0], ctx);
      const v = build(args[1], ctx);
      const u = activateTrig(ctx.ce, build(args[2], ctx));
      const r = substFor3(v, u, ctx);
      if (r === null) return fail('SubstFor: unhandled substitution');
      return safeSimplify(w.mul(r));
    }
    if (args.length === 3) {
      const v = build(args[0], ctx);
      const u = activateTrig(ctx.ce, build(args[1], ctx));
      const r = substFor3(v, u, ctx);
      return r === null ? fail('SubstFor: unhandled substitution') : r;
    }
    return fail('SubstFor arity');
  },

  // FreeFactors[u, x] / NonfreeFactors[u, x] — the x-free (resp. x-dependent)
  // factor product; needed by the Weierstrass tan(x/2) substitution rules.
  FreeFactors: (args, ctx) =>
    selectFactors(build(args[0], ctx), ctx.x, ctx.ce, true),
  NonfreeFactors: (args, ctx) =>
    selectFactors(build(args[0], ctx), ctx.x, ctx.ce, false),

  // ExpandTrig[u, x] := ActivateTrig[ExpandIntegrand[u, x]] — expand a
  // (polynomial-in-trig) integrand so each trig power integrates via a
  // reduction rule. The 3-arg form ExpandTrig[u, v, x] distributes
  // ActivateTrig[u] over ExpandTrig[v, x] (IntegrationUtilityFunctions.m).
  ExpandTrig: (args, ctx) => {
    const ce = ctx.ce;
    if (args.length === 3) {
      const w = activateTrig(
        ce,
        build(['ExpandIntegrand', args[1], args[2]], ctx)
      );
      const z = activateTrig(ce, build(args[0], ctx));
      if (w.operator === 'Add' && w.ops)
        return ce.function(
          'Add',
          w.ops.map((t) => z.mul(t))
        );
      return z.mul(w);
    }
    return activateTrig(ce, build(['ExpandIntegrand', args[0], args[1]], ctx));
  },

  // ExpandTrigReduce[u,x] = Expand[TrigReduce[u]] — product/power reduction of
  // hyperbolic integrands (Chapter 6). The 3-arg form ExpandTrigReduce[u,v,x]
  // reduces v then distributes the (polynomial) factor u over the result
  // (IntegrationUtilityFunctions.m). See the hyperbolicToExp section comment.
  ExpandTrigReduce: (args, ctx) => {
    const ce = ctx.ce;
    if (args.length === 3) {
      const w = expandTrigReduce(ce, build(args[1], ctx));
      const u = build(args[0], ctx);
      if (w.operator === 'Add' && w.ops)
        return ce.function(
          'Add',
          w.ops.map((t) => u.mul(t))
        );
      return u.mul(w);
    }
    return expandTrigReduce(ce, build(args[0], ctx));
  },

  // ExpandTrigToExp[u,v,x] — rewrite v to exponential form, multiply by u, and
  // expand (IntegrationUtilityFunctions.m). The 2-arg ExpandTrigToExp[u,x] is
  // ExpandTrigToExp[1,u,x]. Same exponential-expansion engine as
  // ExpandTrigReduce; the distinction (multiple-angle vs raw exp) is moot once
  // we route everything through exponentials.
  ExpandTrigToExp: (args, ctx) => {
    const ce = ctx.ce;
    const [u, v] =
      args.length === 3
        ? [build(args[0], ctx), build(args[1], ctx)]
        : [ce.One, build(args[0], ctx)];
    return deepExpand(ce, u.mul(hyperbolicToExp(ce, v)));
  },

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
  // Rubi's own abbreviations (IntegrationUtilityFunctions.m): Numer[u]/Denom[u]
  // are numerator/denominator that DISTRIBUTE over radicals
  // (Numer[(b/a)^(1/3)] = b^(1/3)). CE's .numerator/.denominator already split
  // radicals the same way, so these alias directly. The cube/sixth-root Int
  // rules (e.g. 1.1.3.1#14 ∫1/√(a+b·x³)) bind r=Numer[Rt[b/a,3]],
  // s=Denom[Rt[b/a,3]]; without these the bindings stayed inert `Numer(…)`
  // heads that poisoned the residual integrand and blocked closure.
  Numer: (args, ctx) => build(args[0], ctx).numerator,
  Denom: (args, ctx) => build(args[0], ctx).denominator,

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

  // degree accessors over the parts decompositions — failing the rule
  // when the form does not apply (Rubi would have returned False[[k]])
  BinomialDegree: (args, ctx) => {
    const p = binomialPartsX(build(args[0], ctx), ctx.x);
    return p === null ? fail('BinomialDegree: not a binomial') : p.n;
  },
  TrinomialDegree: (args, ctx) => {
    const p = trinomialPartsX(build(args[0], ctx), ctx.x);
    return p === null ? fail('TrinomialDegree: not a trinomial') : p.n;
  },
  GeneralizedBinomialDegree: (args, ctx) => {
    const p = genBinomialPartsX(build(args[0], ctx), ctx.x);
    if (p === null) return fail('GeneralizedBinomialDegree: no parts');
    return p.n.sub(p.q).evaluate();
  },
  GeneralizedTrinomialDegree: (args, ctx) => {
    const p = genTrinomialPartsX(build(args[0], ctx), ctx.x);
    if (p === null) return fail('GeneralizedTrinomialDegree: no parts');
    return p.n.sub(p.q).evaluate();
  },
  NormalizePseudoBinomial: (args, ctx) => {
    const u = build(args[0], ctx);
    const p = pseudoBinomialPartsX(u, ctx.x);
    if (p === null) return fail('NormalizePseudoBinomial: no parts');
    const X = ctx.ce.symbol(ctx.x);
    return p.a.add(p.b.mul(p.c.add(p.d.mul(X)).pow(p.n)));
  },
  If: (args, ctx) =>
    evalCondition(args[0], ctx)
      ? build(args[1], ctx)
      : args[2] !== undefined
        ? build(args[2], ctx)
        : fail('If: no else branch'),

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
      : ce.expr(['Rational', num - ip * den, den] as any).evaluate();
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
    const qx: Expression = expand(q.evaluate());
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
        g
          .subs({ [x]: root })
          .evaluate()
          .div(fact)
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
  const n = args.length >= 3 ? (realNum(build(args[2], ctx)) ?? NaN) : 1;
  if (!Number.isInteger(n)) return fail('Coefficient: non-integer degree');
  const coeffs = polyCoeffsX(u, ctx.x);
  if (coeffs === null) return fail('Coefficient: not a polynomial');
  return (coeffs[n] ?? ctx.ce.Zero).evaluate();
}

function polyDiv(args: Json[], ctx: Ctx): [Expression, Expression] {
  const q = polyDivideX(build(args[0], ctx), build(args[1], ctx), ctx.x);
  if (q === null) return fail('PolynomialQuotient: division failed');
  return q;
}

import type {
  IComputeEngine as ComputeEngine,
  Expression,
} from '../global-types.js';
import { isFunction, isNumber, isSymbol } from './type-guards.js';

/**
 * `MPoly` — a distributed, sparse **multivariate polynomial over ℤ**.
 *
 * This is the internal computational kernel underneath the public `GCD` /
 * `PolynomialGCD` operators for the multivariate case (ROADMAP B11). It is
 * deliberately engine-free — pure `bigint` arithmetic on a map from
 * exponent-vectors to coefficients — so the GCD algorithms (`multivariate-gcd.ts`)
 * can run hot without boxing overhead. Convert to/from `BoxedExpression` only at
 * the boundary, with {@link mpolyFromBoxed} / {@link mpolyToBoxed}.
 *
 * Representation:
 * - `vars` is a fixed, ordered list of variable names.
 * - `terms` maps a monomial key (the exponent vector joined by `,`) to its
 *   nonzero integer coefficient. The zero polynomial has an empty map.
 *
 * The empty `vars` list represents constants (the single key is the empty
 * string). All operations assume operands share the same `vars` list and order.
 */
export class MPoly {
  readonly vars: string[];
  readonly terms: Map<string, bigint>;

  constructor(vars: string[], terms?: Map<string, bigint>) {
    this.vars = vars;
    this.terms = terms ?? new Map();
  }

  static zero(vars: string[]): MPoly {
    return new MPoly(vars);
  }

  static constant(vars: string[], c: bigint): MPoly {
    const m = new MPoly(vars);
    if (c !== 0n) m.terms.set(MPoly.key(vars.map(() => 0)), c);
    return m;
  }

  /** Monomial key for an exponent vector. */
  static key(exp: number[]): string {
    return exp.join(',');
  }

  /** Decode a monomial key back to an exponent vector. */
  static exp(key: string): number[] {
    return key === '' ? [] : key.split(',').map(Number);
  }

  clone(): MPoly {
    return new MPoly(this.vars, new Map(this.terms));
  }

  isZero(): boolean {
    return this.terms.size === 0;
  }

  get nbTerms(): number {
    return this.terms.size;
  }

  /** Constant value if this is a constant polynomial, else `undefined`. */
  asConstant(): bigint | undefined {
    if (this.terms.size === 0) return 0n;
    if (this.terms.size === 1) {
      const k = [...this.terms.keys()][0];
      if (MPoly.exp(k).every((e) => e === 0)) return this.terms.get(k);
    }
    return undefined;
  }

  /** Add `c·x^exp` in place (collapsing to zero removes the term). */
  private accumulate(exp: number[], c: bigint): void {
    if (c === 0n) return;
    const key = MPoly.key(exp);
    const next = (this.terms.get(key) ?? 0n) + c;
    if (next === 0n) this.terms.delete(key);
    else this.terms.set(key, next);
  }

  add(o: MPoly): MPoly {
    const r = this.clone();
    for (const [k, c] of o.terms) r.accumulate(MPoly.exp(k), c);
    return r;
  }

  sub(o: MPoly): MPoly {
    const r = this.clone();
    for (const [k, c] of o.terms) r.accumulate(MPoly.exp(k), -c);
    return r;
  }

  neg(): MPoly {
    const r = new MPoly(this.vars);
    for (const [k, c] of this.terms) r.terms.set(k, -c);
    return r;
  }

  mul(o: MPoly): MPoly {
    const r = new MPoly(this.vars);
    for (const [ka, ca] of this.terms) {
      const ea = MPoly.exp(ka);
      for (const [kb, cb] of o.terms) {
        const eb = MPoly.exp(kb);
        r.accumulate(
          ea.map((x, i) => x + eb[i]),
          ca * cb
        );
      }
    }
    return r;
  }

  /** Multiply every coefficient by an integer scalar. */
  scaleInt(s: bigint): MPoly {
    if (s === 0n) return MPoly.zero(this.vars);
    const r = new MPoly(this.vars);
    for (const [k, c] of this.terms) r.terms.set(k, c * s);
    return r;
  }

  equals(o: MPoly): boolean {
    if (this.terms.size !== o.terms.size) return false;
    for (const [k, c] of this.terms) if (o.terms.get(k) !== c) return false;
    return true;
  }

  /** Largest absolute coefficient (the ∞-norm). */
  maxNorm(): bigint {
    let m = 0n;
    for (const c of this.terms.values()) {
      const a = c < 0n ? -c : c;
      if (a > m) m = a;
    }
    return m;
  }

  /** GCD of all integer coefficients (the integer content); 1 for the zero poly. */
  contentInteger(): bigint {
    let g = 0n;
    for (const c of this.terms.values()) g = igcd(g, c);
    return g === 0n ? 1n : g;
  }

  /** Divide every coefficient by `d` exactly (throws if any is not divisible). */
  divExactInteger(d: bigint): MPoly {
    const r = new MPoly(this.vars);
    for (const [k, c] of this.terms) {
      if (c % d !== 0n) throw new Error('MPoly.divExactInteger: not divisible');
      r.terms.set(k, c / d);
    }
    return r;
  }

  /** Remove the integer content (primitive part with a non-negative leading sign). */
  primitivePartInteger(): MPoly {
    if (this.isZero()) return this;
    let g = this.contentInteger();
    // Normalize sign so the lexicographically-leading coefficient is positive.
    const lead = this.leadingLex();
    if (lead && lead.c < 0n) g = -g;
    return g === 1n ? this : this.divExactInteger(g);
  }

  /** Degree in variable `i` (the largest exponent of that variable). */
  degreeIn(i: number): number {
    let d = 0;
    for (const k of this.terms.keys()) d = Math.max(d, MPoly.exp(k)[i] ?? 0);
    return d;
  }

  totalDegree(): number {
    let d = 0;
    for (const k of this.terms.keys())
      d = Math.max(
        d,
        MPoly.exp(k).reduce((a, b) => a + b, 0)
      );
    return d;
  }

  /** Leading term under the lexicographic order on exponent vectors. */
  leadingLex(): { exp: number[]; c: bigint } | undefined {
    let bestExp: number[] | undefined;
    let bestKey = '';
    for (const k of this.terms.keys()) {
      const e = MPoly.exp(k);
      if (!bestExp || lexGreater(e, bestExp)) {
        bestExp = e;
        bestKey = k;
      }
    }
    return bestExp ? { exp: bestExp, c: this.terms.get(bestKey)! } : undefined;
  }

  /**
   * Exact division `a / b` over ℤ. Returns the quotient, or `null` when `b`
   * does not divide `a` exactly. Used to verify GCD candidates.
   */
  static tryDivide(a: MPoly, b: MPoly): MPoly | null {
    if (b.isZero()) return null;
    const lb = b.leadingLex()!;
    let r = a.clone();
    const q = new MPoly(a.vars);
    let guard = 0;
    while (!r.isZero()) {
      if (++guard > 500000) return null;
      const lr = r.leadingLex()!;
      if (!lr.exp.every((x, i) => x >= lb.exp[i])) return null;
      if (lr.c % lb.c !== 0n) return null;
      const fe = lr.exp.map((x, i) => x - lb.exp[i]);
      const fc = lr.c / lb.c;
      q.accumulate(fe, fc);
      const term = new MPoly(a.vars);
      term.terms.set(MPoly.key(fe), fc);
      r = r.sub(b.mul(term));
    }
    return q;
  }

  /** Substitute `vars[i] = value`, returning a polynomial over the other vars. */
  evalVar(i: number, value: bigint): MPoly {
    const newVars = this.vars.filter((_, j) => j !== i);
    const r = new MPoly(newVars);
    for (const [k, c] of this.terms) {
      const e = MPoly.exp(k);
      r.accumulate(
        e.filter((_, j) => j !== i),
        c * value ** BigInt(e[i])
      );
    }
    return r;
  }

  /**
   * Coefficients with respect to variable `i`, as polynomials over the other
   * variables, indexed by the power of `vars[i]` (index 0 .. degreeIn(i)).
   */
  coeffsInVar(i: number): MPoly[] {
    const d = this.degreeIn(i);
    const rest = this.vars.filter((_, j) => j !== i);
    const out: MPoly[] = Array.from({ length: d + 1 }, () => new MPoly(rest));
    for (const [k, c] of this.terms) {
      const e = MPoly.exp(k);
      out[e[i]].accumulate(
        e.filter((_, j) => j !== i),
        c
      );
    }
    return out;
  }

  /**
   * Rebuild a polynomial over `fullVars` from its coefficients with respect to
   * the variable at `insertIndex` (the inverse of {@link coeffsInVar}). Each
   * `coeffs[d]` is a polynomial over `fullVars` minus that variable.
   */
  static fromVarCoeffs(
    coeffs: MPoly[],
    insertIndex: number,
    fullVars: string[]
  ): MPoly {
    const r = new MPoly(fullVars);
    for (let d = 0; d < coeffs.length; d++) {
      for (const [k, c] of coeffs[d].terms) {
        const e = MPoly.exp(k);
        const fe: number[] = [];
        let j = 0;
        for (let v = 0; v < fullVars.length; v++)
          fe.push(v === insertIndex ? d : e[j++]);
        r.accumulate(fe, c);
      }
    }
    return r;
  }

  /** Reduce every coefficient into the symmetric range (−p/2, p/2] modulo `p`. */
  modP(p: bigint): MPoly {
    const r = new MPoly(this.vars);
    const half = p / 2n;
    for (const [k, c] of this.terms) {
      let d = ((c % p) + p) % p;
      if (d > half) d -= p;
      if (d !== 0n) r.terms.set(k, d);
    }
    return r;
  }
}

/** Euclidean GCD on non-negative `bigint`s (sign-stripped). */
export function igcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
}

/** Lexicographic `a > b` on equal-length exponent vectors. */
export function lexGreater(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/**
 * Convert an expanded boxed polynomial to an {@link MPoly} over `vars`.
 *
 * Coefficients must be integers or rationals; rational coefficients are cleared
 * to integers by multiplying through by the least common multiple of the
 * denominators (the GCD is unaffected by this rational scaling — the caller
 * takes the primitive part). Returns `null` if `expr` is not a polynomial in
 * `vars` with rational coefficients.
 */
export function mpolyFromBoxed(
  ce: ComputeEngine,
  expr: Expression,
  vars: string[]
): MPoly | null {
  const e = ce.expr(['Expand', expr]).evaluate();
  const index = new Map(vars.map((v, i) => [v, i]));

  // First pass: collect (exponent, numerator, denominator) per term.
  type Term = { exp: number[]; num: bigint; den: bigint };
  const collected: Term[] = [];
  const addends = isFunction(e, 'Add') ? e.ops : [e];

  for (const t of addends) {
    const exp = vars.map(() => 0);
    let num = 1n;
    let den = 1n;
    // Walk the term's factors, flattening nested `Multiply` and unwrapping
    // `Negate` (a leading `-` expands to `Negate(...)`, not `Multiply(-1,...)`).
    const stack: Expression[] = [t];
    while (stack.length) {
      const f = stack.pop()!;
      if (isFunction(f, 'Negate')) {
        num = -num;
        stack.push(f.ops[0]);
        continue;
      }
      if (isFunction(f, 'Multiply')) {
        for (const g of f.ops) stack.push(g);
        continue;
      }
      if (isSymbol(f) && index.has(f.symbol)) {
        exp[index.get(f.symbol)!] += 1;
        continue;
      }
      if (isFunction(f, 'Power')) {
        const base = f.ops[0];
        const p = f.ops[1];
        if (isSymbol(base) && index.has(base.symbol) && p.isInteger) {
          const pe = readInt(p);
          if (pe === null || pe < 0n) return null;
          exp[index.get(base.symbol)!] += Number(pe);
          continue;
        }
        return null; // non-polynomial power
      }
      // Otherwise: must be a numeric (integer or rational) coefficient factor.
      const r = readRational(f);
      if (r === null) return null;
      num *= r.num;
      den *= r.den;
    }
    collected.push({ exp, num, den });
  }

  // Clear denominators: multiply through by lcm(denominators).
  let lcm = 1n;
  for (const t of collected) lcm = (lcm / igcd(lcm, t.den)) * t.den;

  const poly = new MPoly(vars);
  for (const t of collected) {
    const c = t.num * (lcm / t.den);
    if (c !== 0n) {
      const key = MPoly.key(t.exp);
      const next = (poly.terms.get(key) ?? 0n) + c;
      if (next === 0n) poly.terms.delete(key);
      else poly.terms.set(key, next);
    }
  }
  return poly;
}

/** Convert an {@link MPoly} back to a canonical boxed expression. */
export function mpolyToBoxed(ce: ComputeEngine, poly: MPoly): Expression {
  if (poly.isZero()) return ce.expr(0);
  const terms: Expression[] = [];
  for (const [k, c] of poly.terms) {
    const e = MPoly.exp(k);
    const factors: Expression[] = [];
    e.forEach((p, i) => {
      if (p === 1) factors.push(ce.symbol(poly.vars[i]));
      else if (p > 1)
        factors.push(ce.expr(['Power', ce.symbol(poly.vars[i]), p]));
    });
    const coeff = ce.number(c);
    if (factors.length === 0) terms.push(coeff);
    else terms.push(ce.function('Multiply', [coeff, ...factors]));
  }
  return terms.length === 1 ? terms[0] : ce.function('Add', terms);
}

/** Exact `bigint` of an integer-valued boxed number, else `null`. */
function readInt(e: Expression): bigint | null {
  if (!e.isInteger) return null;
  try {
    return BigInt(e.toString());
  } catch {
    return null;
  }
}

/**
 * Exact numerator/denominator of an integer or rational coefficient, else
 * `null`. A rational is a *number literal* (`_kind: 'number'`) with operator
 * `'Rational'`, exposing `.numerator`/`.denominator`; an inexact float
 * coefficient is rejected (not a polynomial over ℚ).
 */
function readRational(f: Expression): { num: bigint; den: bigint } | null {
  if (!isNumber(f)) return null;
  if (f.isInteger) {
    const n = readInt(f);
    return n === null ? null : { num: n, den: 1n };
  }
  const num = (f as { numerator?: Expression }).numerator;
  const den = (f as { denominator?: Expression }).denominator;
  if (num && den) {
    const n = readInt(num);
    const d = readInt(den);
    if (n !== null && d !== null && d !== 0n) return { num: n, den: d };
  }
  return null; // inexact float — not a polynomial over ℚ
}

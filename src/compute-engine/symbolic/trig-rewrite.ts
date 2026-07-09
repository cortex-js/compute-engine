import type { Expression } from '../global-types.js';

import {
  isFunction,
  isNumber,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import { asSmallInteger } from '../boxed-expression/numerics.js';
import { expand, expandAll } from '../boxed-expression/expand.js';
import { mul } from '../boxed-expression/arithmetic-mul-div.js';
import { add } from '../boxed-expression/arithmetic-add.js';

//
// This module implements three symbolic trigonometric rewrite verbs, modeled
// on the Mathematica operators of the same name:
//
// - `trigExpand`  — expand trig/hyperbolic functions of sums and integer
//                   multiples of angles (`sin(a+b) → sin a cos b + cos a sin b`,
//                   `sin(2x) → 2 sin x cos x`, ...).
// - `trigToExp`   — rewrite trig/hyperbolic functions in terms of the complex
//                   exponential, exactly (`sin x → -(i/2) e^{ix} + (i/2) e^{-ix}`).
// - `trigReduce`  — the inverse of `trigExpand`: rewrite products and integer
//                   powers of trig/hyperbolic functions as a linear combination
//                   of trig/hyperbolic of multiple angles
//                   (`sin²x → (1 - cos 2x)/2`).
//
// None of these functions call `.simplify()`, so they are safe to compose but
// are intended to be reached only from the top-level operator handlers (not
// from inside simplification rules).
//

/** Circular trig functions handled by the rewrite verbs. */
const TRIG = new Set(['Sin', 'Cos', 'Tan', 'Sec', 'Csc', 'Cot']);

/** Hyperbolic functions handled by the rewrite verbs. */
const HYP = new Set(['Sinh', 'Cosh', 'Tanh', 'Sech', 'Csch', 'Coth']);

//
// ─────────────────────────────────────────────────────────────────────────
//  TrigToExp
// ─────────────────────────────────────────────────────────────────────────
//

/**
 * Rewrite a single trig/hyperbolic function `op(u)` in terms of the complex
 * exponential. Returns `null` if `op` is not a supported function.
 *
 * The coefficients are exact (Gaussian) rationals, so the result contains no
 * floating-point literals and preserves the exactness contract.
 */
function toExp(op: string, u: Expression): Expression | null {
  const ce = u.engine;
  const I = ce.I;

  // Build `e^{exponent}` as a *structural* Power so a purely-imaginary numeric
  // exponent (e.g. `e^{i}` for `sin(1)`) is not re-expanded into `cos + i·sin`
  // by canonicalization. The exponential form is what we want to expose.
  const exp = (exponent: Expression): Expression =>
    ce.function('Power', [ce.E, exponent], { structural: true });

  if (TRIG.has(op)) {
    const eiu = exp(I.mul(u)); // e^{iu}
    const emiu = exp(I.neg().mul(u)); // e^{-iu}
    switch (op) {
      case 'Sin':
        // (e^{iu} - e^{-iu})/(2i) = -(i/2) e^{iu} + (i/2) e^{-iu}
        return ce.function('Add', [
          ce.function('Multiply', [I.div(2).neg(), eiu]),
          ce.function('Multiply', [I.div(2), emiu]),
        ]);
      case 'Cos':
        // (e^{iu} + e^{-iu})/2
        return ce.function('Multiply', [
          ce.Half,
          ce.function('Add', [eiu, emiu]),
        ]);
      case 'Tan':
        // -i (e^{iu} - e^{-iu})/(e^{iu} + e^{-iu})
        return ce.function('Multiply', [
          I.neg(),
          ce.function('Divide', [
            ce.function('Add', [eiu, emiu.neg()]),
            ce.function('Add', [eiu, emiu]),
          ]),
        ]);
      case 'Cot':
        // i (e^{iu} + e^{-iu})/(e^{iu} - e^{-iu})
        return ce.function('Multiply', [
          I,
          ce.function('Divide', [
            ce.function('Add', [eiu, emiu]),
            ce.function('Add', [eiu, emiu.neg()]),
          ]),
        ]);
      case 'Sec':
        // 2/(e^{iu} + e^{-iu})
        return ce.function('Divide', [
          ce.number(2),
          ce.function('Add', [eiu, emiu]),
        ]);
      case 'Csc':
        // 2i/(e^{iu} - e^{-iu})
        return ce.function('Divide', [
          I.mul(2),
          ce.function('Add', [eiu, emiu.neg()]),
        ]);
    }
  }

  if (HYP.has(op)) {
    const eu = exp(u); // e^{u}
    const emu = exp(u.neg()); // e^{-u}
    switch (op) {
      case 'Sinh':
        // (e^{u} - e^{-u})/2
        return ce.function('Multiply', [
          ce.Half,
          ce.function('Add', [eu, emu.neg()]),
        ]);
      case 'Cosh':
        // (e^{u} + e^{-u})/2
        return ce.function('Multiply', [
          ce.Half,
          ce.function('Add', [eu, emu]),
        ]);
      case 'Tanh':
        // (e^{u} - e^{-u})/(e^{u} + e^{-u})
        return ce.function('Divide', [
          ce.function('Add', [eu, emu.neg()]),
          ce.function('Add', [eu, emu]),
        ]);
      case 'Coth':
        // (e^{u} + e^{-u})/(e^{u} - e^{-u})
        return ce.function('Divide', [
          ce.function('Add', [eu, emu]),
          ce.function('Add', [eu, emu.neg()]),
        ]);
      case 'Sech':
        // 2/(e^{u} + e^{-u})
        return ce.function('Divide', [
          ce.number(2),
          ce.function('Add', [eu, emu]),
        ]);
      case 'Csch':
        // 2/(e^{u} - e^{-u})
        return ce.function('Divide', [
          ce.number(2),
          ce.function('Add', [eu, emu.neg()]),
        ]);
    }
  }

  return null;
}

function trigToExpRec(expr: Expression): Expression {
  if (typeof expr.operator !== 'string' || !isFunction(expr)) return expr;

  const op = expr.operator;
  const ops = expr.ops.map(trigToExpRec);

  if ((TRIG.has(op) || HYP.has(op)) && ops.length === 1) {
    const r = toExp(op, ops[0]);
    if (r) return r;
  }

  return expr.engine.function(op, ops);
}

/**
 * Rewrite every trig and hyperbolic function in `expr` in terms of the complex
 * exponential. The result is exact for exact input.
 */
export function trigToExp(expr: Expression): Expression {
  return trigToExpRec(expr.canonical);
}

//
// ─────────────────────────────────────────────────────────────────────────
//  TrigExpand
// ─────────────────────────────────────────────────────────────────────────
//

/**
 * A "unit atom" of an angle: a single angle `base`, optionally negated (`neg`).
 * An angle that is an integer multiple `n·base` is represented by `n` copies of
 * the atom (with `neg` set when `n < 0`).
 */
type Atom = { base: Expression; neg: boolean };

/**
 * Decompose the angle `arg` into a flat list of unit atoms. Sums are split,
 * rational multiples of sums are distributed (`(a+b)/2 → a/2 + b/2`), and an
 * integer multiple `n·base` becomes `|n|` copies of `base` (negated when
 * `n < 0`).
 */
function argAtoms(arg: Expression): Atom[] {
  const ce = arg.engine;
  const e = expand(arg); // distribute sums and rational-multiples-of-sums
  const terms = isFunction(e, 'Add') ? e.ops : [e];

  const atoms: Atom[] = [];
  for (const t of terms) {
    let coeff = 1;
    let base: Expression = t;

    if (isFunction(base, 'Negate')) {
      coeff = -1;
      base = base.op1;
    }

    // Extract a leading integer literal factor (e.g. `2` in `2·x·y`). A
    // non-integer numeric factor (`1/2`, `√2`) is left as part of the base so
    // that `sin(x/2)` stays a single atom.
    if (isFunction(base, 'Multiply') && isNumber(base.op1)) {
      const k = asSmallInteger(base.op1);
      if (k !== null) {
        coeff *= k;
        const rest = base.ops.slice(1);
        base = rest.length === 1 ? rest[0] : ce.function('Multiply', rest);
      }
    }

    if (coeff === 0) continue;
    const m = Math.abs(coeff);
    const neg = coeff < 0;
    for (let i = 0; i < m; i++) atoms.push({ base, neg });
  }

  return atoms;
}

/**
 * Fold the atoms into the expanded `(sin, cos)` of their sum using the angle
 * addition identities. The products are multiplied out (via `mul`/`add`).
 */
function sinCosOfAtoms(atoms: Atom[]): { S: Expression; C: Expression } {
  const ce = atoms[0].base.engine;
  let S: Expression = ce.Zero;
  let C: Expression = ce.One;
  for (const { base, neg } of atoms) {
    const sinB = ce.function('Sin', [base]);
    const s = neg ? sinB.neg() : sinB; // sin is odd
    const c = ce.function('Cos', [base]); // cos is even
    // sin(A+u) = sin A cos u + cos A sin u
    // cos(A+u) = cos A cos u - sin A sin u
    const newS = add(mul(S, c), mul(C, s));
    const newC = add(mul(C, c), mul(S, s).neg());
    S = newS;
    C = newC;
  }
  return { S, C };
}

/** Fold the atoms into the expanded `(sinh, cosh)` of their sum. */
function sinhCoshOfAtoms(atoms: Atom[]): { Sh: Expression; Ch: Expression } {
  const ce = atoms[0].base.engine;
  let Sh: Expression = ce.Zero;
  let Ch: Expression = ce.One;
  for (const { base, neg } of atoms) {
    const sinhB = ce.function('Sinh', [base]);
    const s = neg ? sinhB.neg() : sinhB; // sinh is odd
    const c = ce.function('Cosh', [base]); // cosh is even
    // sinh(A+u) = sinh A cosh u + cosh A sinh u
    // cosh(A+u) = cosh A cosh u + sinh A sinh u
    const newSh = add(mul(Sh, c), mul(Ch, s));
    const newCh = add(mul(Ch, c), mul(Sh, s));
    Sh = newSh;
    Ch = newCh;
  }
  return { Sh, Ch };
}

/** Fold the atoms into `tan` of their sum using the tangent addition law. */
function tanOfAtoms(atoms: Atom[]): Expression {
  const ce = atoms[0].base.engine;
  let T: Expression | null = null;
  for (const { base, neg } of atoms) {
    const tanB = ce.function('Tan', [base]);
    const t = neg ? tanB.neg() : tanB;
    if (T === null) {
      T = t;
      continue;
    }
    // tan(A+u) = (tan A + tan u)/(1 - tan A tan u)
    T = ce.function('Divide', [
      ce.function('Add', [T, t]),
      ce.function('Add', [ce.One, mul(T, t).neg()]),
    ]);
  }
  return T ?? ce.Zero;
}

/** Fold the atoms into `tanh` of their sum using the tangent addition law. */
function tanhOfAtoms(atoms: Atom[]): Expression {
  const ce = atoms[0].base.engine;
  let T: Expression | null = null;
  for (const { base, neg } of atoms) {
    const tanhB = ce.function('Tanh', [base]);
    const t = neg ? tanhB.neg() : tanhB;
    if (T === null) {
      T = t;
      continue;
    }
    // tanh(A+u) = (tanh A + tanh u)/(1 + tanh A tanh u)
    T = ce.function('Divide', [
      ce.function('Add', [T, t]),
      ce.function('Add', [ce.One, mul(T, t)]),
    ]);
  }
  return T ?? ce.Zero;
}

/**
 * Expand a single trig/hyperbolic function `op(arg)`. Returns `null` when there
 * is nothing to expand (the argument is a single atomic angle), so the caller
 * can leave the function unchanged.
 *
 * `sec`/`csc`/`cot` (and their hyperbolic analogs) are expanded as reciprocals
 * of the expanded `cos`/`sin` (respectively `cosh`/`sinh`) — but only when the
 * argument actually decomposes, so `sec(x)` stays `sec(x)`.
 */
function expandTrigOf(op: string, arg: Expression): Expression | null {
  const atoms = argAtoms(arg);
  if (atoms.length === 0) return null;

  // Nothing to expand: a single, non-negated, atomic angle.
  if (atoms.length === 1 && !atoms[0].neg && atoms[0].base.isSame(arg))
    return null;

  const ce = arg.engine;

  switch (op) {
    case 'Sin':
      return sinCosOfAtoms(atoms).S;
    case 'Cos':
      return sinCosOfAtoms(atoms).C;
    case 'Tan':
      return tanOfAtoms(atoms);
    case 'Sec': {
      const { C } = sinCosOfAtoms(atoms);
      return ce.function('Divide', [ce.One, C]);
    }
    case 'Csc': {
      const { S } = sinCosOfAtoms(atoms);
      return ce.function('Divide', [ce.One, S]);
    }
    case 'Cot': {
      const { S, C } = sinCosOfAtoms(atoms);
      return ce.function('Divide', [C, S]);
    }
    case 'Sinh':
      return sinhCoshOfAtoms(atoms).Sh;
    case 'Cosh':
      return sinhCoshOfAtoms(atoms).Ch;
    case 'Tanh':
      return tanhOfAtoms(atoms);
    case 'Sech': {
      const { Ch } = sinhCoshOfAtoms(atoms);
      return ce.function('Divide', [ce.One, Ch]);
    }
    case 'Csch': {
      const { Sh } = sinhCoshOfAtoms(atoms);
      return ce.function('Divide', [ce.One, Sh]);
    }
    case 'Coth': {
      const { Sh, Ch } = sinhCoshOfAtoms(atoms);
      return ce.function('Divide', [Ch, Sh]);
    }
  }

  return null;
}

function trigExpandRec(expr: Expression): Expression {
  if (typeof expr.operator !== 'string' || !isFunction(expr)) return expr;

  const op = expr.operator;

  if ((TRIG.has(op) || HYP.has(op)) && expr.ops.length === 1) {
    const arg = trigExpandRec(expr.ops[0]);
    const r = expandTrigOf(op, arg);
    if (r) return r;
    return expr.engine.function(op, [arg]);
  }

  const ce = expr.engine;
  const ops = expr.ops.map(trigExpandRec);

  // Multiply distributes over the sums produced by trig expansion (`mul` is the
  // distributing helper). Add stays flat.
  if (op === 'Multiply') return mul(...ops);
  if (op === 'Add') return add(...ops);

  // Only expand a Power when its base was rewritten into a sum by trig
  // expansion — leave a plain polynomial power like `(x+1)²` untouched.
  if (op === 'Power') {
    const base = ops[0];
    const e = asSmallInteger(ops[1]);
    if (
      !expr.ops[0].isSame(base) &&
      isFunction(base, 'Add') &&
      e !== null &&
      e >= 2
    )
      return expand(ce.function('Power', [base, ops[1]]));
    return ce.function('Power', ops);
  }

  return ce.function(op, ops);
}

/**
 * Expand trig and hyperbolic functions of sums and integer multiples of angles.
 * Non-trig structure is preserved; products generated by the expansion are
 * multiplied out.
 */
export function trigExpand(expr: Expression): Expression {
  return trigExpandRec(expr.canonical);
}

//
// ─────────────────────────────────────────────────────────────────────────
//  TrigReduce
// ─────────────────────────────────────────────────────────────────────────
//

/** True if `expr` contains a number literal with a non-zero imaginary part. */
function containsImaginary(expr: Expression): boolean {
  if (isNumber(expr)) return expr.im !== 0;
  if (isFunction(expr)) return expr.ops.some(containsImaginary);
  return false;
}

/** Flatten a (possibly nested) product into a flat list of factors. */
function collectFactors(e: Expression, out: Expression[]): void {
  if (isFunction(e, 'Multiply')) {
    for (const op of e.ops) collectFactors(op, out);
  } else if (isFunction(e, 'Negate')) {
    out.push(e.engine.NegativeOne);
    collectFactors(e.op1, out);
  } else {
    out.push(e);
  }
}

/** Heuristic: does this angle "read" as negative (so we prefer its negation)? */
function isNegativeLeaning(e: Expression): boolean {
  if (isFunction(e, 'Negate')) return true;
  if (isNumber(e)) return e.re < 0;
  if (isFunction(e, 'Multiply') && isNumber(e.op1)) return e.op1.re < 0;
  return false;
}

/**
 * Pick a deterministic representative between `phi` and `-phi`, so that a term
 * `e^{i·phi}` and its conjugate `e^{-i·phi}` map to the same bucket. Prefers a
 * representative that does not read as negative (so we get `cos(2x)`, not
 * `cos(-2x)`). Returns the chosen angle and whether the input `phi` equals it.
 */
function chooseRep(phi: Expression): { rep: Expression; positive: boolean } {
  const neg = phi.neg();
  const pn = isNegativeLeaning(phi);
  const nn = isNegativeLeaning(neg);
  if (pn && !nn) return { rep: neg, positive: false };
  if (nn && !pn) return { rep: phi, positive: true };
  // Tie-break deterministically on serialization.
  if (JSON.stringify(phi.json) <= JSON.stringify(neg.json))
    return { rep: phi, positive: true };
  return { rep: neg, positive: false };
}

/**
 * The inverse of `trigExpand`: rewrite products and integer powers of
 * trig/hyperbolic functions as a linear combination of trig/hyperbolic
 * functions of multiple angles.
 *
 * Strategy: rewrite everything in exponential form (`trigToExp`), expand the
 * result to a sum of exponential monomials, then regroup conjugate pairs of
 * exponentials back into `cos`/`sin` (imaginary exponents) or `cosh`/`sinh`
 * (real exponents) of the corresponding multiple angle.
 */
export function trigReduce(expr: Expression): Expression {
  const ce = expr.engine;

  // 1. Convert to exponentials and expand into a flat sum of monomials.
  const ex = expandAll(trigToExp(expr.canonical));
  const terms = isFunction(ex, 'Add') ? ex.ops : [ex];

  // 2. For each monomial, gather the exponential factors (summing their
  //    exponents) and the residual coefficient.
  let constant: Expression = ce.Zero;

  // Buckets keyed by the string of the representative angle. Each bucket holds
  // the accumulated coefficients of `e^{+…}` (plus) and `e^{-…}` (minus), the
  // representative angle, and whether the exponent is imaginary (trig) or real
  // (hyperbolic).
  const buckets = new Map<
    string,
    { rep: Expression; plus: Expression; minus: Expression; trig: boolean }
  >();

  for (const term of terms) {
    const factors: Expression[] = [];
    collectFactors(term, factors);
    let theta: Expression = ce.Zero; // total exponent
    const rest: Expression[] = [];
    for (const f of factors) {
      if (isFunction(f, 'Power') && isSymbol(f.op1, 'ExponentialE')) {
        theta = add(theta, f.op2);
      } else if (isSymbol(f, 'ExponentialE')) {
        theta = add(theta, ce.One);
      } else {
        rest.push(f);
      }
    }

    const R = rest.length === 0 ? ce.One : mul(...rest);

    if (theta.isSame(0)) {
      constant = add(constant, R);
      continue;
    }

    // Classify the exponent: imaginary → trig, real → hyperbolic.
    const trig = containsImaginary(theta);
    // Angle: for trig, phi = theta / i = -i·theta; for hyperbolic, phi = theta.
    const phi = trig ? mul(ce.I.neg(), theta) : theta;

    const { rep, positive } = chooseRep(phi);
    const key = (trig ? 'T:' : 'H:') + JSON.stringify(rep.json);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { rep, plus: ce.Zero, minus: ce.Zero, trig };
      buckets.set(key, bucket);
    }
    if (positive) bucket.plus = add(bucket.plus, R);
    else bucket.minus = add(bucket.minus, R);
  }

  // 3. Regroup each bucket back into cos/sin or cosh/sinh.
  const result: Expression[] = [];
  if (!constant.isSame(0)) result.push(constant);

  for (const { rep, plus, minus, trig } of buckets.values()) {
    if (trig) {
      // A e^{iφ} + B e^{-iφ} = (A+B) cos φ + i(A-B) sin φ
      const cosCoef = add(plus, minus);
      const sinCoef = mul(ce.I, add(plus, minus.neg()));
      if (!cosCoef.isSame(0))
        result.push(mul(cosCoef, ce.function('Cos', [rep])));
      if (!sinCoef.isSame(0))
        result.push(mul(sinCoef, ce.function('Sin', [rep])));
    } else {
      // A e^{u} + B e^{-u} = (A+B) cosh u + (A-B) sinh u
      const coshCoef = add(plus, minus);
      const sinhCoef = add(plus, minus.neg());
      if (!coshCoef.isSame(0))
        result.push(mul(coshCoef, ce.function('Cosh', [rep])));
      if (!sinhCoef.isSame(0))
        result.push(mul(sinhCoef, ce.function('Sinh', [rep])));
    }
  }

  if (result.length === 0) return ce.Zero;
  return add(...result);
}

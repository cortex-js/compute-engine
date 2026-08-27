import { Complex } from 'complex-esm';
import { BigDecimal } from '../../big-decimal/index.js';

import type {
  MathJsonExpression,
  MathJsonNumberObject,
} from '../../math-json.js';

import { mul, div } from './arithmetic-mul-div.js';

import { canonicalInteger, gcd, SMALL_INTEGER } from '../numerics/numeric.js';
import { primeFactors } from '../numerics/primes.js';
import type { Rational, SmallInteger } from '../numerics/types.js';
import { bigint } from '../numerics/bigint.js';

import {
  ExactNumericValueData,
  NumericValue,
  NumericValueData,
} from '../numeric-value/types.js';
import { ExactNumericValue } from '../numeric-value/exact-numeric-value.js';

import { replace } from './rules.js';
import { simplify } from './simplify.js';
import { explainExpression } from './explain.js';

import { _BoxedExpression } from './abstract-boxed-expression.js';
import { inBroadcastCell } from './broadcast-cell-widening.js';
import { hashCode } from './utils.js';
import { match } from './match.js';
import { same } from './compare.js';
import { add } from './arithmetic-add.js';
import { pow } from './arithmetic-power.js';
import { isSubtype } from '../../common/type/subtype.js';
import {
  positiveSign,
  nonNegativeSign,
  negativeSign,
  nonPositiveSign,
} from './sgn.js';
import { BoxedType } from '../../common/type/boxed-type.js';
import type { Type } from '../../common/type/types.js';
import {
  positiveRangeType,
  negativeRangeType,
} from '../../common/type/utils.js';
import type {
  BoxedRuleSet,
  BoxedSubstitution,
  CanonicalOptions,
  EvaluateOptions,
  IComputeEngine as ComputeEngine,
  Metadata,
  Rule,
  Sign,
  Substitution,
  Expression,
  PatternMatchOptions,
  ReplaceOptions,
  SimplifyOptions,
  ExplainOperation,
  ExplainOptions,
  Explanation,
  ExpressionInput,
  NumberLiteralInterface,
} from '../global-types.js';
import { isNumber, isSymbol } from './type-guards.js';

/** Is the exact rational `r` equal to the double `re`? Exact: the double is
 * decomposed into its dyadic fraction (power-of-two scaling of a double is
 * lossless, and the scaled numerator is a ≤53-bit integer), then
 * cross-multiplied in bigints. */
function ratioEqualsDouble(r: Rational, re: number): boolean {
  let num = re;
  let den = 1n;
  while (!Number.isInteger(num)) {
    num *= 2;
    den *= 2n;
  }
  return BigInt(r[0]) * den === BigInt(num) * BigInt(r[1]);
}

/** How many significant digits an enclosing literal range keeps. Two is the
 * compactness/precision trade the literal types use: `1/3` encloses as
 * `finite_rational<0.33..0.34>`, `√2` as `finite_real<1.4..1.5>`. */
const ENCLOSURE_DIGITS = 2;

/** Relative padding applied around the decimal approximation before the
 * bounds are rounded outward. It must dominate BOTH error sources at once:
 * the approximation error of `bignumRe` for an exact value (a few ulps at
 * the working precision — never below ~15 significant digits, so relative
 * error ≤ ~10⁻¹³), and the ~10⁻¹⁶ relative rounding of the final
 * nearest-double projection of each bound (see the comment at the
 * projection — this is what lets the projection skip any outward
 * correction step). Do NOT shrink the padding with higher working
 * precision: a pad below 10⁻¹⁶ reopens the projection hole, and a
 * BigDecimal-vs-double comparison cannot detect the crossing (doubles
 * compare through their shortest decimal string). The cost of the fixed
 * pad is that a value within 10⁻⁶ (relative) of a two-digit grid point
 * takes the next notch out — a one-notch-looser enclosure, still sound. */
const ENCLOSURE_PADDING = 1e-6;

/** The smallest NORMAL double, `2⁻¹⁰²²`. Below it the doubles are
 * subnormal: their spacing is the ABSOLUTE constant `5·10⁻³²⁴`, so the
 * "nearest-double projection errs by at most ~10⁻¹⁶ RELATIVE" argument the
 * enclosure relies on stops holding — near the very bottom both padded
 * bounds of `7·10⁻³²⁴` project to the same double `5·10⁻³²⁴`, an unsound
 * SINGLETON below the value. A bound that lands in the subnormal range
 * therefore forfeits the enclosure (sign-range fallback). */
const MIN_NORMAL_DOUBLE = 2.2250738585072014e-308;

/**
 * A compact CLOSED interval, on the literal's tier, that provably contains
 * the value: `finite_rational<0.33..0.34>` for `1/3`,
 * `finite_real<1.4..1.5>` for `√2`. Both bounds are rounded OUTWARD
 * (padding, then directed rounding to `ENCLOSURE_DIGITS` significant
 * digits), so the interval never claims a value the literal does not have
 * — in
 * particular `1 - 10⁻³⁰` encloses as `<0.99..1>`, which admits but does not
 * assert the artanh pole at 1.
 *
 * `undefined` when no sound compact enclosure exists as doubles — the
 * magnitude is outside the NORMAL double range (an overflow like `10⁴⁰⁰`,
 * or a subnormal underflow — see `MIN_NORMAL_DOUBLE`), or a bound lands on
 * the wrong side of zero and would lose the literal's sign fact. Callers
 * fall back to the sign-only range there.
 */
function literalEnclosureType(
  v: NumericValue,
  tier: 'finite_integer' | 'finite_rational' | 'finite_real',
  sign: 'positive' | 'negative'
): Type | undefined {
  let d = v.bignumRe;
  if (d === undefined) {
    // Defensive, currently unreachable: every NumericValue kind that can
    // reach the non-machine-exact fallback defines `bignumRe` (Exact and
    // Big values always do; a Machine value without one is always
    // machine-exact and takes the exact branch instead). If a future value
    // kind lands here, its `re` projection is still enclosed soundly — the
    // fixed padding is applied unconditionally and covers a half-ulp
    // double error.
    const re = v.re;
    if (!Number.isFinite(re) || re === 0) return undefined;
    d = new BigDecimal(re);
  }
  if (!d.isFinite() || d.isZero()) return undefined;

  const pad = d.abs().mul(ENCLOSURE_PADDING);
  const loDec = d.sub(pad).toPrecisionToward(ENCLOSURE_DIGITS, 'floor');
  const hiDec = d.add(pad).toPrecisionToward(ENCLOSURE_DIGITS, 'ceiling');

  // Project each decimal bound onto a double. `toNumber()` rounds to
  // nearest, which can land INSIDE the interval — but for a NORMAL double
  // at most ~10⁻¹⁶ relative away, while the padding keeps each decimal
  // bound at least ~10⁻⁶ (relative) clear of the value (and the directed
  // two-digit rounding only ever moves a bound further out), so the
  // projected double can never cross the value. Skipping an outward
  // ulp-step here is what keeps the bound's shortest decimal
  // representation compact: the double nearest to `9.9e29` prints as
  // `9.9e+29`, its ulp-neighbor as `9.899999999999999e+29`.
  const lower = loDec.toNumber();
  const upper = hiDec.toNumber();

  // Both bounds must be NORMAL doubles: an overflow to ±∞ has no finite
  // bound, and a subnormal projection has ABSOLUTE (not relative) rounding
  // error, which breaks the no-crossing argument above — see
  // `MIN_NORMAL_DOUBLE`.
  if (!Number.isFinite(lower) || Math.abs(lower) < MIN_NORMAL_DOUBLE)
    return undefined;
  if (!Number.isFinite(upper) || Math.abs(upper) < MIN_NORMAL_DOUBLE)
    return undefined;
  // The range replaces a `& !0` sign range, so it must keep the sign fact.
  if (sign === 'positive' ? lower <= 0 : upper >= 0) return undefined;

  return { kind: 'numeric', type: tier, lower, upper };
}

/**
 * BoxedNumber
 *
 */

export class BoxedNumber
  extends _BoxedExpression
  implements NumberLiteralInterface
{
  override readonly _kind = 'number';

  // The value of a BoxedNumber is either a small integer or a NumericValue
  protected readonly _value: SmallInteger | NumericValue;

  private _hash: number | undefined;

  /** Memo for `_literalType` (`null` = computed, not eligible). The value
   * of a literal never changes, so the memo never invalidates. */
  private _literalTypeMemo: Type | null | undefined = undefined;

  /** Memo for the public `.type` when it is the literal type: one
   * `BoxedType` per literal, so repeated reads return the SAME object —
   * the display projection (`typeToDisplayString`) keys on `BoxedType`
   * identity. Never invalidates, for the same reason `_literalTypeMemo`
   * never does. */
  private _publicTypeMemo: BoxedType | undefined = undefined;

  /**
   * By the time the constructor is called, the `value` should have been
   * screened for cases where it's a well-known value (0, NaN, +Infinity,
   * etc...) or non-normal (complex number with im = 0, rational with
   * denom = 1, etc...).
   *
   * This is done in `ce.number()`. In general, use `ce.number()` rather
   * than calling this constructor directly.
   *
   * We may store as a machine number if a Decimal is passed that is in machine
   * range
   */
  constructor(
    ce: ComputeEngine,
    value:
      | SmallInteger
      | NumericValueData
      | ExactNumericValueData
      | NumericValue,
    options?: { metadata?: Metadata }
  ) {
    super(ce, options?.metadata);
    if (value instanceof NumericValue || typeof value === 'number')
      this._value = value;
    else this._value = ce._numericValue(value);
  }

  get hash(): number {
    this._hash ??= hashCode(this._value.toString());
    // console.info('hash BoxedNumber ', this._hash);
    return this._hash;
  }

  override _unshared(): BoxedNumber {
    // Small integers and other well-known values are interned by `ce.number()`;
    // return a fresh copy so parse-time metadata does not leak onto the shared
    // instance.
    return new BoxedNumber(this.engine, this._value, {
      metadata: {
        latex: this.verbatimLatex,
        sourceOffsets: this.sourceOffsets,
      },
    });
  }

  get json(): MathJsonExpression {
    // `.json` is the lossless data-interchange serialization (see
    // doc/12-guide-numerical-evaluations.md). It emits the value exactly, with no
    // rounding to the working precision:
    //  - exact values (integers, rationals, radicals, complex) serialize to
    //    their exact MathJSON form (e.g. `(1/2)·√3` → the Multiply/Rational
    //    form via `NumericValue.toJSON()`), which re-folds to the same number
    //    literal when re-boxed — `ce.expr(x.json).isSame(x)` holds (RT-P1-1);
    //  - machine floats serialize as JSON numbers, big floats keep every stored
    //    digit, and non-finite values map to `NaN`/`PositiveInfinity`/
    //    `NegativeInfinity`.
    // (Historically this path could emit a rounded numeric approximation; the
    // P0-32/P0-33 fidelity fixes made it lossless.)

    const value = this._value;
    if (typeof value === 'number') {
      if (Number.isNaN(value)) return 'NaN';
      if (!Number.isFinite(value))
        return value > 0 ? 'PositiveInfinity' : 'NegativeInfinity';
      return value;
    }

    return value.toJSON() as MathJsonExpression;
  }

  get operator(): string {
    // Handle plain JavaScript numbers
    if (typeof this._value === 'number') {
      if (Number.isNaN(this._value)) return 'NaN';
      if (!Number.isFinite(this._value))
        return this._value > 0 ? 'PositiveInfinity' : 'NegativeInfinity';
      return Number.isInteger(this._value) ? 'Integer' : 'Real';
    }

    // Handle NumericValue objects
    if (this._value.isNaN) return 'NaN';
    if (this._value.isPositiveInfinity) return 'PositiveInfinity';
    if (this._value.isNegativeInfinity) return 'NegativeInfinity';

    // Check for complex numbers (non-zero imaginary part)
    if (this._value.im !== 0) return 'Complex';

    // Map the type property to operator string
    const type = this._value.type;
    if (type === 'integer' || type === 'finite_integer') return 'Integer';
    if (type === 'rational' || type === 'finite_rational') return 'Rational';
    if (
      type === 'real' ||
      type === 'finite_real' ||
      type === 'imaginary' ||
      type === 'finite_complex' ||
      type === 'complex'
    )
      return 'Real';
    if (type === 'non_finite_number') return 'Infinity';

    // Fallback for any other numeric type
    return 'Number';
  }

  get isPure(): boolean {
    return true;
  }

  get isCanonical(): boolean {
    return true;
  }
  set isCanonical(val: boolean) {}

  get complexity(): number {
    return 1;
  }

  /**
   *
   * Return a JavaScript number when possible (most cases); else return a
   * string representation of the number (ComplexInfinity and complex numbers
   * for example).
   *
   * When a JavaScript number is returned, it may have fewer digits than the
   * original number, but it will be a close approximation.
   *
   * @returns {number | string} The value of the number.
   */

  valueOf(): number | string {
    if (typeof this._value === 'number') return this._value;
    return this._value.N().valueOf();
  }

  get numericValue(): number | NumericValue {
    return this._value;
  }

  get isNumberLiteral(): true {
    return true;
  }

  get re(): number {
    if (typeof this._value === 'number') return this._value;
    return this._value.re;
  }

  get im(): number {
    if (typeof this._value === 'number') return 0;
    return this._value.im;
  }

  get bignumRe(): BigDecimal | undefined {
    if (typeof this._value === 'number') return undefined;
    return this._value.bignumRe;
  }

  get bignumIm(): BigDecimal | undefined {
    if (typeof this._value === 'number') return BigDecimal.ZERO;
    // Prefer the numeric value's own bignum imaginary part (exact lane):
    // the machine-float projection `.im` overflows for huge components.
    return this._value.bignumIm ?? this.engine.bignum(this._value.im);
  }

  neg(): Expression {
    const n = this._value;
    if (n === 0) return this;

    if (typeof n === 'number') return this.engine.number(-n);

    return this.engine.number(n.neg());
  }

  inv(): Expression {
    if (typeof this._value === 'number') {
      if (Math.abs(this._value) === 1) return this;
      if (!Number.isInteger(this._value))
        return this.engine.number(1 / this._value);
      return this.engine.number(
        this.engine._numericValue({ rational: [1, this._value] })
      );
    }
    if (Math.abs(this.re) === 1 && this.im === 0) return this;
    return this.engine.number(this._value.inv());
  }

  abs(): Expression {
    if (this.isPositive) return this;
    if (typeof this._value === 'number')
      return this.engine.number(-this._value);

    return this.engine.number(this._value.abs());
  }

  add(rhs: number | Expression): Expression {
    const ce = this.engine;
    if (this.isSame(0)) return ce.expr(rhs);
    if (typeof rhs === 'number') {
      // @fastpath
      if (rhs === 0) return this;
      if (typeof this._value === 'number') return ce.number(this._value + rhs);

      return ce.number(this._value.add(rhs));
    }
    if (isNumber(rhs)) {
      // @fastpath
      if (typeof this._value === 'number') {
        if (typeof rhs.numericValue === 'number')
          return ce.number(this._value + rhs.numericValue);
        return ce.number(rhs.numericValue.add(this._value));
      }

      return ce.number(this._value.add(rhs.numericValue));
    }
    return add(this, rhs.canonical);
  }

  mul(rhs: NumericValue | number | Expression): Expression {
    if (this.isSame(1)) return this.engine.expr(rhs);
    if (this.isSame(-1)) return this.engine.expr(rhs).neg();

    const ce = this.engine;

    // @fastpath
    if (typeof rhs === 'number') {
      if (rhs === 1) return this;
      if (rhs === 0 || this.isSame(0)) return this.engine.Zero;
      if (rhs === -1) return this.neg();
      return ce.number(
        typeof this._value === 'number'
          ? this._value * rhs
          : this._value.mul(rhs)
      );
    }

    if (typeof this._value === 'number' && typeof rhs === 'number')
      return ce.number(this._value * rhs);

    if (rhs instanceof NumericValue) {
      if (this.isSame(1)) return ce.number(rhs);
      if (this.isSame(-1)) return ce.number(rhs.neg());
      return ce.number(rhs.mul(this._value));
    }

    if (isNumber(rhs))
      return ce.number(ce._numericValue(this._value).mul(rhs.numericValue));

    return mul(this, rhs);
  }

  div(rhs: number | Expression): Expression {
    return div(this, rhs);
  }

  pow(exp: number | Expression): Expression {
    return pow(this, exp, { numericApproximation: false });
  }

  root(exp: number | Expression): Expression {
    if (typeof exp === 'number') {
      if (exp === 0) return this.engine.NaN;
      if (exp === 1) return this;
      if (exp === -1) return this.inv();
      if (exp === 2) return this.sqrt();
      if (this.isNegative) {
        if (exp % 2 === 1) return this.neg().root(exp).neg();
        if (exp % 2 === 0) return this.neg().root(exp);
      }
    } else {
      exp = exp.canonical;
      if (exp.isSame(0)) return this.engine.NaN;
      if (exp.isSame(1)) return this;
      if (exp.isSame(-1)) return this.inv();
      if (exp.isSame(2)) return this.sqrt();
      if (this.isNegative) {
        if (exp.isOdd) return this.neg().root(exp).neg();
        if (exp.isEven) return this.neg().root(exp);
      }
    }

    const n = typeof exp === 'number' ? exp : exp.re;

    // A negative root index denotes a reciprocal; normalize to `1/Root(a, n)`
    // rather than the nonstandard `Root(a, -n)` (#13). Placed before the
    // numeric computation below, which is defined for positive indices only.
    if (typeof n === 'number' && n < 0 && Number.isInteger(n))
      return this.engine._fn('Divide', [this.engine.One, this.root(-n)]);

    if (Number.isInteger(n)) {
      if (typeof this._value === 'number') {
        const r = this._value ** (1 / n);
        if (Number.isInteger(r)) return this.engine.number(r);
      } else {
        const r = this._value.root(n);
        if (isSubtype(r.type, 'integer')) return this.engine.number(r);
      }
    }
    return this.engine._fn('Root', [this, this.engine.expr(exp)]);
  }

  sqrt(): Expression {
    const ce = this.engine;
    // @fastpath
    if (typeof this._value === 'number') {
      const v = this._value;
      if (v === 0 || v === 1) return this;
      if (v === -1) return ce.I;

      if (Number.isInteger(v)) {
        const n = Math.abs(v);
        // Exact radical for small magnitudes (auto-reduces perfect-square
        // parts, e.g. √999999 → 3√111111).
        if (n < SMALL_INTEGER) {
          const r = ce.number(ce._numericValue({ radical: n }));
          if (v >= 0) return r;
          // Negative argument = i·√n. Fold a perfect square to an exact
          // Gaussian integer (`√-4 → 2i`); otherwise stay symbolic (`√-2`).
          // (A symbolic `i·√2` would carry a too-wide `finite_number` type and
          // break the static-type soundness contract; `.N()` still gives the
          // complex float.)
          return r.isInteger === true
            ? ce.number(
                ce._numericValue({ rational: [0, 1], imRational: [r.re, 1] })
              )
            : ce._fn('Sqrt', [this]);
        }
        // Large integer: exact only when it is a perfect square; otherwise
        // stay symbolic (never numericize an exact argument — the exactness
        // contract; `.N()` still produces the float).
        const root = Math.sqrt(n);
        if (Number.isInteger(root))
          return v < 0
            ? ce.number(
                ce._numericValue({ rational: [0, 1], imRational: [root, 1] })
              )
            : ce.number(root);
        return ce._fn('Sqrt', [this]);
      }

      // Inexact machine float: numericize (inexact in → inexact out).
      return ce.number(ce._numericValue(v).sqrt());
    }
    if (this.isSame(0) || this.isSame(1)) return this;

    // Exact NumericValue (rational / radical / complex): if the value is
    // exact but its square root is not, stay symbolic rather than numericize
    // (`√(√2)`, `√(-3/2)` → symbolic; `√(1/4)` → 1/2 stays exact).
    const r = ce.number(this._value.sqrt());
    if (this.isExact && isNumber(r) && r.isExact === false)
      return ce._fn('Sqrt', [this]);
    return r;
  }

  ln(semiBase?: number | Expression): Expression {
    const ce = this.engine;
    const base = semiBase ? ce.expr(semiBase) : undefined;

    // Mathematica returns `Log[0]` as `-∞`
    if (this.isSame(0)) return ce.NegativeInfinity;

    // log_b(1) = 0 and ln(1) = 0. (Previously this fell through to the numeric
    // path, which returned an exact 0 only by accident; the exact reduction
    // must be explicit now that the fallback stays symbolic.)
    if (this.isSame(1)) return ce.Zero;

    if (base && this.isSame(base)) return ce.One;
    if (
      (!base || isSymbol(base, 'ExponentialE')) &&
      this.symbol === 'ExponentialE'
    )
      return ce.One;

    // log_b(a) exact rational reduction: when the argument `a` and the base
    // `b` are both integer powers of a common integer base c (e.g. 2 = 2^1 and
    // 8 = 2^3), then log_b(a) = p/q is exact. Handles both orders —
    // log_2(8) = 3, log_8(2) = 1/3, log_4(8) = 3/2 — and stays symbolic when
    // the bases have different prime support (log_8(10)).
    if (base !== undefined && isNumber(base) && base.isInteger) {
      const a = this.re;
      const b = base.re;
      if (
        Number.isInteger(a) &&
        a > 1 &&
        a < Number.MAX_SAFE_INTEGER &&
        Number.isInteger(b) &&
        b > 1 &&
        b < Number.MAX_SAFE_INTEGER
      ) {
        const r = integerLogRational(a, b);
        if (r !== null) {
          const [p, q] = r;
          return q === 1
            ? ce.number(p)
            : ce.number(ce._numericValue({ rational: [p, q] }));
        }
      }
    }

    const f = this.re;
    if (Number.isInteger(f) && f > 0) {
      let [factor, root] = canonicalInteger(f, 3);
      if (factor !== 1)
        return ce.number(factor).ln(base).mul(3).add(ce.number(root).ln(base));
      [factor, root] = canonicalInteger(f, 2);
      if (factor !== 1)
        return ce.number(factor).ln(base).mul(2).add(ce.number(root).ln(base));
    }

    // No exact closed form. When BOTH the argument and the base are exact, stay
    // symbolic: `ln(2)` is an exact constant just like `√2`, so `evaluate()`
    // keeps it as `Ln(2)`/`Log(2, b)` and only `.N()` produces a float. If
    // either the argument or the base is INEXACT (a float, e.g. `log_2.5(8)`)
    // there is no exactness to preserve, so numericize — mirroring `√2.5 →
    // 1.58…`.
    // A base is "inexact" only when it is an actual float literal (e.g.
    // `log_2.5(8)`). A symbolic constant base (`π`, or any symbol/expression)
    // is exact, so `log_π(2)` stays symbolic under `evaluate()` and only
    // `.N()` numericizes — matching the argument side. Previously a symbol
    // base failed the `isNumber(base)` test and was wrongly treated as inexact.
    const baseExact =
      base === undefined ||
      isSymbol(base, 'ExponentialE') ||
      !(isNumber(base) && base.isExact === false);
    if (this.isExact && baseExact) {
      if (base === undefined || isSymbol(base, 'ExponentialE'))
        return ce._fn('Ln', [this]);
      return ce._fn('Log', [this, base]);
    }

    // Inexact argument or base: numericize. A negative real argument has a
    // complex principal logarithm (`ln x = ln|x| + iπ`); route it through the
    // complex path so `evaluate()` agrees with `.N()` (which already returns
    // the complex value) rather than returning NaN. The NumericValue lane
    // relies on the numeric-value `ln` handling the negative-real branch.
    if (typeof this._value === 'number') {
      const lnBase = base !== undefined ? Math.log(base.re) : 1;
      if (this._value < 0)
        return ce.number(ce.complex(this._value).log().div(lnBase));
      const l = Math.log(this._value);
      return ce.number(base !== undefined ? l / lnBase : l);
    }
    return ce.number(
      base !== undefined ? this._value.ln(base.re) : this._value.ln()
    );
  }

  get value(): Expression {
    return this;
  }

  get type(): BoxedType {
    // A number literal's public type IS its literal type (ruling O9,
    // second half, 2026-08-23): `ce.box(21).type` is `21`, `ce.box(0.5)
    // .type` is `0.5`, an exact rational keeps its tier through a
    // singleton range (`finite_rational<0.5..0.5>`), and a value no
    // machine number holds exactly is enclosed in a compact outward range
    // on its tier (`finite_real<1.4..1.5>` for `√2`). The literal type lives at
    // EXPRESSION positions only — every storage position widens it back
    // to its tier: an inferred declaration (`inferTypeFromValue`), a
    // solved type variable (`solveArm`), a derived function-literal
    // signature (`functionLiteralSignatureType`) and a stored handler
    // result (`widenValueTypes` in `boxed-function.ts`).
    // NaN, ±∞ and complex literals have no literal type (`_literalType`
    // is undefined there — the tier already says everything) and keep
    // the tier answer below.
    // Inside a broadcast cell the literal type is withheld and the bare tier
    // answers instead (user ruling 2026-08-27 — see
    // `broadcast-cell-widening.ts`). Returned WITHOUT touching
    // `_publicTypeMemo`: the memo must keep holding the precise O9 answer, so
    // that a read of this same literal after the drain — the caller's own
    // classification of a resolved element — is unaffected by whether the
    // interpreter happened to ask first.
    if (!inBroadcastCell(this.engine)) {
      const lit = this._literalType;
      if (lit !== undefined) {
        this._publicTypeMemo ??= new BoxedType(lit, this.engine._typeResolver);
        return this._publicTypeMemo;
      }
    }

    if (typeof this._value === 'number') {
      if (Number.isNaN(this._value)) return BoxedType.number;
      if (!Number.isFinite(this._value)) return BoxedType.non_finite_number;
      return Number.isInteger(this._value)
        ? BoxedType.finite_integer
        : BoxedType.finite_real;
    }

    return new BoxedType(this._value.type, this.engine._typeResolver);
  }

  /** The handler-visible type of this literal (ruling O9 first half,
   * 2026-08-22 — `docs/plans/2026-08-22-type-handlers-on-types.md` §4.3,
   * §6): a type that carries the literal's VALUE when a machine number
   * holds it exactly — a value type (`21`, `0.5`), or a singleton range
   * (`finite_rational<0.5..0.5>`) when the lattice's value node would lose
   * the tier (a bare numeric value is not `<: rational`) — and otherwise a
   * compact ENCLOSURE: a closed range on the literal's tier whose bounds
   * are rounded outward to two significant digits
   * (`finite_real<1.4..1.5>` for `√2`, `finite_rational<0.33..0.34>` for
   * `1/3`), or, when the magnitude is outside the double range, at least
   * the sign as a sign-carrying range (`finite_integer<0..> & !0` for
   * `10⁴⁰⁰`). `undefined` when the public type already says
   * everything (NaN, `±∞`, a complex literal).
   *
   * Read by type handlers through `handlerTypeOf()`
   * (`library/type-handlers.ts`), and since ruling O9's second half
   * (2026-08-23) also the PUBLIC `.type` of the literal — see the `type`
   * getter. Handler RESULTS are still widened back to ordinary types
   * before they are stored (`widenValueTypes`). */
  override get _literalType(): Type | undefined {
    // `undefined` = not yet computed; `null` = computed, not eligible —
    // the explicit check (not `??=`, which would treat the stored `null`
    // as missing and recompute on every read) is what makes the negative
    // result stick.
    if (this._literalTypeMemo === undefined)
      this._literalTypeMemo = this._computeLiteralType() ?? null;
    return this._literalTypeMemo ?? undefined;
  }

  private _computeLiteralType(): Type | undefined {
    const v = this._value;
    if (typeof v === 'number') {
      // Small integers are stored as machine numbers; the constructor has
      // already screened out NaN and ±∞, but keep the guard local.
      if (!Number.isFinite(v)) return undefined;
      return { kind: 'value', value: v === 0 ? 0 : v };
    }
    if (v.im !== 0 || v.isNaN) return undefined;
    if (v.isPositiveInfinity || v.isNegativeInfinity || v.isComplexInfinity)
      return undefined;
    const tier = v.type;
    if (
      tier !== 'finite_integer' &&
      tier !== 'finite_rational' &&
      tier !== 'finite_real'
    )
      return undefined;

    // Does a machine number hold this value EXACTLY? `re` alone cannot
    // answer: it is a rounding (`(1 - 10⁻³⁰).re === 1`, and a bignum
    // beyond ±2⁵³ rounds to a nearby double), and claiming a value the
    // literal does not have would let a handler classify `artanh(1-10⁻³⁰)`
    // as the pole at 1.
    const re = v.re;
    let exact = false;
    if (Number.isFinite(re)) {
      const big = v.bignumRe;
      if (big !== undefined) {
        // Decimal comparison converts the double through its decimal
        // string, so beyond ±2⁵³ a rounded double can compare "equal" to a
        // bignum it does not represent (`1e40` vs `10⁴⁰`); inside that
        // span integers are exact and floats compare by their printed
        // digits, which is the value the author wrote.
        exact = Math.abs(re) < 2 ** 53 && big.eq(re);
      } else {
        const ex = v.asExact;
        if (ex === undefined) {
          // A machine-backed non-integer float: `re` IS the stored value.
          exact = true;
        } else {
          const ev = ex as ExactNumericValue;
          exact = ev.radical === 1 && ratioEqualsDouble(ev.rational, re);
        }
      }
    }

    if (exact) {
      if (tier === 'finite_rational' && !Number.isInteger(re))
        // The lattice deliberately does not class a bare numeric value as
        // rational (`0.5 <: finite_rational` is false), so an exact
        // rational keeps its tier through a singleton range instead.
        return { kind: 'numeric', type: tier, lower: re, upper: re };
      return { kind: 'value', value: re === 0 ? 0 : re };
    }

    // No machine number holds the value (`√2`, `1/3`, a bigint beyond
    // ±2⁵³): enclose it in a compact closed range on its tier
    // (`finite_rational<0.33..0.34>`, `finite_real<1.4..1.5>`) — strictly
    // narrower than the sign range it replaces, and its bounds exclude
    // zero, so `signOfType` still reads the sign off it. When no sound
    // enclosure exists as doubles (magnitude outside the double range),
    // fall back to carrying the sign alone. The zero case cannot reach
    // here — an exact zero is machine-representable.
    const s = this.sgn;
    if (s !== 'positive' && s !== 'negative') return undefined;
    const enclosure = literalEnclosureType(v, tier, s);
    if (enclosure !== undefined) return enclosure;
    return s === 'positive' ? positiveRangeType(tier) : negativeRangeType(tier);
  }

  get sgn(): Sign | undefined {
    if (this._value === 0) return 'zero';

    let s: number | undefined;
    if (typeof this._value === 'number') s = Math.sign(this._value);
    else s = this._value.sgn();

    // If undefined, it's a complex number. Return 'unsigned'
    if (s === undefined) return 'unsigned';

    if (Number.isNaN(s)) return 'unsigned';

    // It's a real number
    if (s === 0) return 'zero';
    if (s > 0) return 'positive';
    return 'negative';
  }

  get numerator(): Expression {
    if (typeof this._value === 'number') return this;
    return this.engine.number(this._value.numerator);
  }

  get denominator(): Expression {
    if (typeof this._value === 'number') return this.engine.One;
    return this.engine.number(this._value.denominator);
  }

  get numeratorDenominator(): [Expression, Expression] {
    if (typeof this._value === 'number') return [this, this.engine.One];
    const ce = this.engine;
    return [
      ce.number(this._value.numerator),
      ce.number(this._value.denominator),
    ];
  }

  toRational(): [number, number] | null {
    if (typeof this._value === 'number') {
      if (!Number.isFinite(this._value)) return null;
      if (Number.isInteger(this._value)) return [this._value, 1];
      return null;
    }
    // NumericValue — check it's a pure rational (no radical, no imaginary)
    if (this._value.im !== 0) return null;
    const exact = this._value.asExact;
    if (!exact) return null;
    const ev = exact as ExactNumericValue;
    if (ev.radical !== 1) return null;
    const r = ev.rational;
    const num = Number(r[0]);
    const den = Number(r[1]);
    if (!Number.isFinite(num) || !Number.isFinite(den)) return null;
    return [num, den];
  }

  subs(
    sub: Substitution,
    options?: { canonical?: CanonicalOptions }
  ): Expression {
    if (this.isStructural) return this;
    // Apply the substition to the structural version of the number.
    // For example, `3/4` will be replaced by
    // ["Rational", 3, 4].subs({ "Rational": "Divide" }) -> ["Divide", 3, 4]
    return this.structural.subs(sub, options);
  }

  replace(
    rules: BoxedRuleSet | Rule | Rule[],
    options?: Partial<ReplaceOptions>
  ): Expression | null {
    // Apply the replace on the structural version of the number.
    // This will allow transformations to be applied on ["Rational", 3, 4]
    // for example.
    return replace(this.structural, rules, options).at(-1)?.value ?? null;
  }
  match(
    pattern: string | ExpressionInput,
    options?: PatternMatchOptions
  ): BoxedSubstitution | null {
    return match(this.structural, pattern, options);
  }

  /** x > 0, same as `isGreater(0)` */
  get isPositive(): boolean | undefined {
    if (typeof this._value === 'number')
      return !Number.isNaN(this._value) && this._value > 0;

    return positiveSign(this.sgn);
  }

  /** x >= 0, same as `isGreaterEqual(0)` */
  get isNonNegative(): boolean | undefined {
    if (typeof this._value === 'number')
      return !Number.isNaN(this._value) && this._value >= 0;

    return nonNegativeSign(this.sgn);
  }

  /** x < 0, same as `isLess(0)` */
  get isNegative(): boolean | undefined {
    if (typeof this._value === 'number')
      return !Number.isNaN(this._value) && this._value < 0;

    return negativeSign(this.sgn);
  }

  /** x <= 0, same as `isLessEqual(0)` */
  get isNonPositive(): boolean | undefined {
    if (typeof this._value === 'number')
      return !Number.isNaN(this._value) && this._value <= 0;

    return nonPositiveSign(this.sgn);
  }

  get isOdd(): boolean | undefined {
    if (this.isSame(1) || this.isSame(-1)) return true;
    if (this.isSame(0)) return false;

    if (!this.isFinite || !this.isInteger) return undefined;

    if (typeof this._value === 'number') return this._value % 2 !== 0;

    // Parity must come from an exact integer channel. The machine-float
    // projection `.re` rounds any magnitude past 2^53 — the double nearest
    // 9007199254740993 is the even 9007199254740992 — so reading it reported
    // the parity of the rounded double, not of the value. The `isInteger`
    // guard above means the denominator is 1 and the radical is 1, so the
    // whole value lives in the rational's numerator.
    const v = this._value;
    if (v instanceof ExactNumericValue) {
      const p = v.rational[0];
      return typeof p === 'bigint' ? p % 2n !== 0n : p % 2 !== 0;
    }

    // A bignum integer: `bignumRe` is the stored `BigDecimal` itself (unlike
    // `ExactNumericValue.bignumRe`, which re-divides at the working
    // precision), so its exact integer reading is faithful.
    const b = v.bignumRe;
    if (b !== undefined) {
      // A BigDecimal is `significand · 10^exponent` with the significand
      // normalized (no trailing zeros), so parity is read off that pair
      // without ever materializing the integer:
      //  - exponent > 0 → the value is a multiple of 10, hence even;
      //  - exponent = 0 → the value IS the significand.
      // Materializing instead (`BigInt(b.toFixed(0))`) costs a decimal string
      // as long as the value: ~20 ms and ~1 MB for a million digits, and past
      // ~5e8 digits `toFixed(0)` throws a RangeError ("Invalid string length")
      // out of this getter, which no caller expects to throw — while
      // `ce.bignum('1e600000000')` is perfectly constructible and reports
      // `isInteger`.
      if (b.exponent > 0) return false;
      if (b.exponent === 0) return b.significand % 2n !== 0n;
      // A negative exponent is not an integer in normalized form; fall back for
      // any un-normalized value that still happens to be one (`bigint` returns
      // null when it is not).
      const i = bigint(b);
      if (i !== null) return i % 2n !== 0n;
    }

    // A machine numeric value: the double IS the value, so `% 2` is exact.
    return v.re % 2 !== 0;
  }

  get isEven(): boolean | undefined {
    const odd = this.isOdd;
    return odd !== undefined ? !odd : undefined;
  }

  get isInfinity(): boolean {
    if (typeof this._value === 'number')
      return !Number.isFinite(this._value) && !Number.isNaN(this._value);

    // Complex infinity? Ask the numeric value, not the machine-float
    // projection `.im`: an exact value with a huge imaginary component
    // (e.g. (2+3i)^1000) overflows the projection to ±Infinity while
    // remaining finite.
    if (this._value.isComplexInfinity) return true;

    // Real infinity?
    return this._value.isPositiveInfinity || this._value.isNegativeInfinity;
  }

  get isNaN(): boolean {
    if (typeof this._value === 'number') return Number.isNaN(this._value);

    return this._value.isNaN;
  }

  get isFinite(): boolean {
    return this.isInfinity === false && this.isNaN === false;
  }

  get isNumber(): true {
    return true;
  }

  get isInteger(): boolean {
    if (typeof this._value === 'number') return Number.isInteger(this._value);

    return isSubtype(this._value.type, 'integer');
  }

  get isRational(): boolean {
    if (typeof this._value === 'number') return Number.isInteger(this._value);
    // Every integer is also a rational
    return isSubtype(this._value.type, 'rational');
  }

  get isReal(): boolean {
    if (typeof this._value === 'number') return true;
    // If it's 'complex', it has an imaginary part, otherwise it's real
    //    complex :> real :> rational :> integer
    return isSubtype(this._value.type, 'real');
  }

  get isExact(): boolean {
    const n = this._value;
    if (typeof n === 'number')
      return !Number.isFinite(n) || Number.isInteger(n);
    return n.isExact;
  }

  is(
    other: Expression | number | bigint | boolean | string,
    tolerance?: number
  ): boolean {
    if (this.isSame(other)) return true;

    // Primitive with explicit tolerance: direct numeric comparison
    if (tolerance !== undefined) {
      if (typeof other === 'number') {
        return (
          Math.abs(this.re - other) <= tolerance &&
          Math.abs(this.im) <= tolerance
        );
      }
      if (typeof other === 'bigint') {
        return (
          Math.abs(this.re - Number(other)) <= tolerance &&
          Math.abs(this.im) <= tolerance
        );
      }
    }

    // For primitive arguments without explicit tolerance, isSame is definitive
    if (!(other instanceof _BoxedExpression)) return false;

    // BoxedExpression: evaluate other side and compare numerically
    if (other.freeVariables.length > 0) return false;
    const nOther = other.N();
    if (!isNumber(nOther)) return false;
    const tol = tolerance ?? this.engine.tolerance;
    return (
      Math.abs(this.re - nOther.re) <= tol &&
      Math.abs(this.im - nOther.im) <= tol
    );
  }

  isSame(other: Expression | number | bigint | boolean | string): boolean {
    if (typeof other === 'number') {
      const v = this._value;
      if (typeof v === 'number') {
        // `===` treats +0 and -0 as equal (both normalize to +0 per the
        // documented negative-zero convention), unlike `Object.is`; the
        // explicit NaN check restores `NaN ~ NaN` so `isSame` stays reflexive
        // on NaN and remains an equivalence relation (#15).
        if (v === other) return true;
        return Number.isNaN(v) && Number.isNaN(other);
      }
      if (v.isNaN) return Object.is(other, NaN);
      // Delegate to the same `NumericValue` comparison as the boxed path
      // (`same()`), so the primitive and boxed overloads agree — e.g.
      // `Rational(1,2).isSame(0.5)` matches `.isSame(ce.number(0.5))` (#15).
      // The fast integer path of `NumericValue.eq(number)` is tried first so
      // hot `.isSame(0)`/`.isSame(1)` checks allocate nothing.
      if (v.eq(other)) return true;
      // The fallback below boxes `other` into a `NumericValue` (a BigDecimal
      // round-trip at default precision) purely to catch a *non-integer exact*
      // value — a rational or radical whose `eq(number)` overload
      // conservatively returns `false` even when it equals the float (e.g.
      // `Rational(1,2)` vs `0.5`). For an integer `ExactNumericValue`, and for
      // `Machine`/`BigNumericValue` (whose `eq(number)` overload is already a
      // complete, allocation-free float comparison), the check above is
      // definitive — so skip the construction. This removes the ~7
      // `isSame(0.5)`-driven BigDecimal builds per `d/dx xⁿ` iteration
      // (integer exponents repeatedly probed against `0.5` in `canonicalPower`).
      // (#15 / perf review)
      if (v instanceof ExactNumericValue && v.type !== 'finite_integer')
        return v.eq(this.engine._numericValue(other));
      return false;
    }
    if (typeof other === 'bigint') {
      if (typeof this._value === 'number') return bigint(this._value) === other;
      return this._value.eq(this.engine._numericValue(other));
    }
    if (typeof other === 'boolean' || typeof other === 'string') return false;
    return same(this, other);
  }

  get canonical(): Expression {
    return this;
  }

  get isStructural(): boolean {
    if (typeof this._value === 'number') return true;
    if (this.type.matches('rational')) return true;
    if (this._value instanceof ExactNumericValue) return false;
    return true;
  }

  get structural(): Expression {
    if (this.isStructural) return this;
    return this.engine.expr(this.json, { form: 'structural' });
  }

  toNumericValue(): [NumericValue, Expression] {
    const v = this._value;
    if (typeof v === 'number')
      return [this.engine._numericValue(v), this.engine.One];

    return [v, this.engine.One];
  }

  simplify(options?: Partial<SimplifyOptions>): Expression {
    const results = simplify(this.structural, options);

    return results.at(-1)!.value ?? this;
  }

  explain(operation?: ExplainOperation, options?: ExplainOptions): Explanation {
    // Mirror `simplify()`: it runs on the structural form
    return explainExpression(this.structural, operation, options);
  }

  evaluate(options?: Partial<EvaluateOptions>): Expression {
    if (options?.numericApproximation) return this.N();
    return this;
  }

  N(): Expression {
    const v = this._value;
    if (typeof v === 'number') return this;
    // NumericValue
    const n = v.N();
    // Often, 'evaluating' a numeric-value yields the same result, but sometimes may result in a
    // different representation: e.g. some cases of Exact -> Big
    if (v === n) return this;
    return this.engine.number(n);
  }
}

/**
 * If integers `a > 1` and `b > 1` are both integer powers of a common integer
 * base `c` (i.e. a = c^p, b = c^q), return the reduced rational `[p, q]` so
 * that `log_b(a) = p/q`. Otherwise return `null`.
 *
 * Two integers are powers of a common base iff they share the same set of
 * prime factors and their prime-exponent vectors are proportional; the ratio
 * of exponents is then p/q.
 */
function integerLogRational(a: number, b: number): [number, number] | null {
  const fa = primeFactors(a);
  const fb = primeFactors(b);
  const primesA = Object.keys(fa);
  const primesB = Object.keys(fb);
  // Both must share exactly the same set of prime factors.
  if (primesA.length !== primesB.length) return null;
  let num = 0;
  let den = 0;
  for (const p of primesA) {
    const pn = Number(p);
    const eb = fb[pn];
    if (eb === undefined) return null; // prime not a factor of `b`
    const ea = fa[pn];
    if (num === 0 && den === 0) {
      num = ea;
      den = eb;
    } else if (ea * den !== num * eb) {
      // Exponent ratios differ → not powers of a common base.
      return null;
    }
  }
  if (den === 0) return null;
  const g = gcd(num, den);
  return [num / g, den / g];
}

export function canonicalNumber(
  ce: ComputeEngine,
  value:
    | number
    | bigint
    | string
    | BigDecimal
    | Complex
    | Rational
    | NumericValue
    | MathJsonNumberObject
): number | NumericValue {
  if (value === undefined || value === null) return NaN;

  // If the value is already a NumericValue, we're done
  if (value instanceof NumericValue) return value;

  // If the value is a machine number, check if it's a small integer
  // or a non-finite value
  if (typeof value === 'number') {
    if (
      Number.isInteger(value) &&
      value >= -SMALL_INTEGER &&
      value <= SMALL_INTEGER
    )
      return value;
    if (!Number.isFinite(value)) return value;
    return ce._numericValue(value);
  }

  if (value instanceof BigDecimal) {
    const n = value.toNumber();
    // Is it a small integer?
    if (value.isInteger() && Math.abs(n) <= SMALL_INTEGER) return n;
    if (value.isNaN()) return NaN;
    if (!value.isFinite()) return n > 0 ? +Infinity : -Infinity;
    return ce._numericValue(value);
  }

  if (typeof value === 'bigint') {
    if (value >= -SMALL_INTEGER && value <= SMALL_INTEGER) return Number(value);
    return ce._numericValue(value);
  }

  // Is it a Complex?
  if (value instanceof Complex) {
    if (value.im === 0) return canonicalNumber(ce, value.re);
    if (value.isNaN()) return NaN;
    if (!value.isFinite() && value.im === 0)
      return value.re > 0 ? +Infinity : -Infinity;

    return ce._numericValue({ re: value.re, im: value.im });
  }

  if (typeof value === 'object' && 'num' in value) {
    // Technically, num.num as a number is not valid MathJSON: it should be a
    // string, but we'll allow it.
    // i.e. `{num: 1}` is the same as `{num: "1"}`
    if (typeof value.num === 'number') return canonicalNumber(ce, value.num);

    if (typeof value.num !== 'string')
      throw new Error('MathJSON `num` property should be a string of digits');
    return canonicalNumberString(ce, value.num);
  }

  if (typeof value === 'string') return canonicalNumberString(ce, value);

  //
  // It's a rational (or a `{re, im}`/`{rational}`-style object that the
  // `_numericValue()` fall-through below understands)
  //
  // Guard: an array must be a [numerator, denominator] pair of numbers or
  // bigints. Anything else (e.g. the MathJSON expression
  // `['Rational', 1, 2]`, a common mixup) used to spin forever downstream.
  if (
    Array.isArray(value) &&
    (value.length !== 2 ||
      !(typeof value[0] === 'number' || typeof value[0] === 'bigint') ||
      !(typeof value[1] === 'number' || typeof value[1] === 'bigint'))
  ) {
    throw new Error(
      `ce.number(): expected a number, bigint, string, Complex, BigDecimal, NumericValue, MathJSON number object or [numerator, denominator] pair, but got ${JSON.stringify(
        value
      )}. To box a MathJSON expression, use ce.expr() instead.`
    );
  }

  // a/0 -> NaN
  if (value[1] == 0) return NaN;
  // a/±oo
  if (typeof value[1] === 'number' && !Number.isFinite(value[1])) {
    // ±oo/±oo
    if (!Number.isFinite(value[0])) return NaN;
    return 0;
  }
  // ±oo/a  (the denominator is finite and non-zero here)
  if (typeof value[0] === 'number' && !Number.isFinite(value[0])) {
    if (Number.isNaN(value[0])) return NaN;
    // The sign of the result is the product of the numerator and
    // denominator signs.
    const positive = value[0] > 0 === value[1] > 0;
    return positive ? +Infinity : -Infinity;
  }

  return ce._numericValue(value);
}

/**
 * Convert a repeating-decimal num string component into an exact rational
 * `NumericValue`.
 *
 * The string was matched as `body(repeat)trail?` where `body` is the
 * (optionally signed) `W.F` part, `repeat` is the repetend digits, and `trail`
 * is an optional exponent suffix (`e±n`).
 *
 * For `W.F(R)` with fixed-fraction length `f` and repetend length `r`:
 *   value = sign · (WFR − WF) / (10^(f+r) − 10^f)
 * where `WFR` and `WF` are the base-10 integers formed by concatenating the
 * digit groups. A trailing `e±n` scales the result by `10^±n`.
 *
 * Returns `null` (so the caller falls back to digit expansion) when:
 * - `body` is not a `[sign]W.F` decimal,
 * - `trail` is present but not a well-formed exponent suffix,
 * - the repetend is all zeros (`(0)`), which denotes a plain terminating
 *   decimal and must box like one.
 */
function repeatingDecimalToRational(
  ce: ComputeEngine,
  body: string,
  repeat: string,
  trail: string | undefined
): NumericValue | null {
  if (body === undefined || repeat === undefined) return null;

  // Parse an optional exponent trail (e.g. `e2`, `e-3`).
  let exp = BigInt(0);
  if (trail !== undefined) {
    const em = trail.match(/^e([+-]?[0-9]+)$/);
    if (!em) return null;
    exp = BigInt(em[1]);
  }

  // Parse `body` into sign, integer digits (W) and fixed fraction digits (F).
  const bm = body.match(/^([+-]?)([0-9]*)\.([0-9]*)$/);
  if (!bm) return null;
  const sign = bm[1] === '-' ? BigInt(-1) : BigInt(1);
  const W = bm[2];
  const F = bm[3];
  const R = repeat;

  // A `(0)` repetend is a terminating decimal; let the fallback handle it so
  // it boxes identically to the plain decimal.
  if (/^0+$/.test(R)) return null;

  const f = BigInt(F.length);
  const r = BigInt(R.length);
  const WFR = BigInt(W + F + R || '0');
  const WF = BigInt(W + F || '0');
  let numerator = sign * (WFR - WF);
  let denominator = BigInt(10) ** (f + r) - BigInt(10) ** f;

  // Apply the exponent trail (scale by 10^exp).
  if (exp > BigInt(0)) numerator *= BigInt(10) ** exp;
  else if (exp < BigInt(0)) denominator *= BigInt(10) ** -exp;

  return ce._numericValue({ rational: [numerator, denominator] });
}

function canonicalNumberString(
  ce: ComputeEngine,
  s: string
): number | NumericValue {
  s = s.toLowerCase();

  // Remove trailing "n" or "d" letter (from legacy version of MathJSON spec)
  if (/[0-9][nd]$/.test(s)) s = s.slice(0, -1);

  // Remove any whitespace:
  // Tab, New Line, Vertical Tab, Form Feed, Carriage Return, Space, Non-Breaking Space
  s = s.replace(/[\u0009-\u000d\u0020\u00a0]/g, '');

  // Special case some common values to share boxed instances
  if (s === 'nan') return NaN;
  if (s === 'infinity' || s === '+infinity' || s === 'oo' || s === '+oo')
    return Number.POSITIVE_INFINITY;
  if (s === '-infinity' || s === '-oo') return Number.NEGATIVE_INFINITY;
  if (s === '0') return 0;
  if (s === '1') return 1;
  if (s === '-1') return -1;

  // Do we have repeating digits?
  if (/\([0-9]+\)/.test(s)) {
    const [_, body, repeat, trail] = s.match(/(.+)\(([0-9]+)\)(.+)?$/) ?? [];
    // A repeating decimal denotes an exact rational. Convert it exactly
    // (per the exactness contract) rather than expanding to a truncated float.
    const exact = repeatingDecimalToRational(ce, body, repeat, trail);
    if (exact !== null) return exact;
    // Fallback for degenerate/malformed forms: expand the repetend.
    // @todo we probably shouldn't be using the ce.precision since it may change later
    s =
      body +
      repeat.repeat(Math.ceil(ce.precision / repeat.length)) +
      (trail ?? '');
  }

  // Does this look like an integer?
  const n = bigint(s);
  if (n !== null) {
    if (n >= -SMALL_INTEGER && n <= SMALL_INTEGER) return Number(n);
    return ce._numericValue(n);
  }

  // A scientific form whose exponent is too large to materialize as digits
  // (integer forms make bigint() bail, see numerics/bigint.ts; decimal
  // mantissas never reach bigint() at all): it has no exact representation
  // and a BigDecimal built from it would crash on serialization ("Invalid
  // string length" through the public API). Fall back to the machine float
  // (±∞), matching the ±∞ reading of the value.
  const expMatch = s.match(/^[+-]?[0-9]+(?:\.[0-9]*)?e([0-9]+)$/);
  if (expMatch && parseInt(expMatch[1]) > 1_000_000)
    return ce._numericValue(Number(s));

  return ce._numericValue(ce.bignum(s));
}

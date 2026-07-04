import { Complex } from 'complex-esm';
import { BigDecimal } from '../../big-decimal';

import {
  checkType,
  checkTypes,
  checkNumericArgs,
} from '../boxed-expression/validate';
import { bignumPreferred } from '../boxed-expression/utils';
import { polynomialGCDMulti } from '../boxed-expression/polynomials';
import {
  asSmallInteger,
  asRational,
  asBignum,
  asBigint,
  toInteger,
} from '../boxed-expression/numerics';
import { addOrder } from '../boxed-expression/order';

import {
  apply,
  apply2,
  applyN,
  shouldNumericize,
  isExactNumber,
} from '../boxed-expression/apply';
import { flatten } from '../boxed-expression/flatten';

import {
  gamma as gammaComplex,
  gammaln as lngammaComplex,
  incompleteGammaUpperComplex,
} from '../numerics/numeric-complex';
import {
  factorial2 as bigFactorial2,
  gcd as bigGcd,
  lcm as bigLcm,
} from '../numerics/numeric-bignum';
import { factorial as bigFactorial } from '../numerics/numeric-bigint';
import {
  zetaEvenCoefficient,
  zetaNegativeInteger,
} from '../numerics/bernoulli';
import {
  gamma,
  gammaln,
  incompleteGammaUpper,
  bigGamma,
  bigGammaln,
  digamma,
  trigamma,
  polygamma,
  beta,
  zeta,
  lambertW,
  bigDigamma,
  bigTrigamma,
  bigPolygamma,
  bigBeta,
  bigZeta,
  bigLambertW,
  besselJ,
  besselY,
  besselI,
  besselK,
  airyAi,
  airyBi,
} from '../numerics/special-functions';
import { factorial2, gcd, lcm } from '../numerics/numeric';
import { rationalize } from '../numerics/rationals';
import { isPrime } from '../boxed-expression/predicates';

import {
  canonicalAdd,
  add,
  addType,
  addN,
} from '../boxed-expression/arithmetic-add';
import {
  mul,
  mulN,
  canonicalDivide,
} from '../boxed-expression/arithmetic-mul-div';
import {
  canonicalBigop,
  reduceBigOp,
  NON_ENUMERABLE_DOMAIN,
  classifyBigopDomain,
} from './utils';
import {
  canonicalPower,
  canonicalRoot,
  pow,
  root,
} from '../boxed-expression/arithmetic-power';
import { parseType } from '../../common/type/parse';
import { widen } from '../../common/type/utils';
import {
  numericTypeHandler,
  elementaryFunctionType,
  gammaPoleType,
  roundingFunctionType,
} from './type-handlers';
import {
  isQuantity,
  quantityAdd,
  quantityMultiply,
  quantityDivide,
  quantityPower,
} from './quantity-arithmetic';
import { range, rangeLast } from './collections';
import { run, runAsync, CancellationError } from '../../common/interruptible';
import type {
  Expression,
  IComputeEngine as ComputeEngine,
  SymbolDefinitions,
  Sign,
} from '../global-types';
import { isNumber, isFunction, isString } from '../boxed-expression/type-guards';
import { canonical } from '../boxed-expression/canonical-utils';
import { signFromAssumedPart } from './complex';

// When processing an arithmetic expression, the following are the core
// canonical arithmetic operations to account for:
export type CanonicalArithmeticOperators =
  | 'Add'
  | 'Negate' // Distributed over mul/div/add
  | 'Multiply'
  | 'Divide'
  | 'Power'
  | 'Sqrt'
  | 'Root'
  | 'Ln';

// Non-canonical functions: the following functions get transformed during
// canonicalization, and can be ignored as they will not occur in a canonical
// expression (they are canonicalized to an equivalent canonical form):
//
// - Complex(re, im) -> Complex number (re + i im)
// - Rational(num, den) -> Rational number (num / den)
// - Exp(x) -> Power(E, x)
// - Square(x) -> Power(x, 2)
// - Subtract(a, b) -> Add(a, Negate(b))

/*

### THEORY OF OPERATIONS:  PRECEDENCE

PEMDAS is a lie. But the ambiguity is essentially around the ÷ (or solidus /)
sign and implicit multiplication.

Some calculators will interpret 6÷2(1+2) as 6÷(2(1+2)) others as (6÷2)(1+2)

References:
- Abstract Algebra- The Basic Graduate Year by Robert B. Ash https://faculty.math.illinois.edu/~r-ash/Algebra/SolutionsChap1-5.pdf p2
- The Feynman Lectures on Physics Vol. I Ch. 6: Probability https://www.feynmanlectures.caltech.edu/I_06.html
- Basics of Mechanical Engineering by Paul D. Ronney http://ronney.usc.edu/ame101/ame101-lecturenotes.pdfp7 (page 15 of the pdf)

- Oliver Knill - Ambiguous PEMDAS https://people.math.harvard.edu/~knill/pedagogy/ambiguity/index.html
- AMS Guide for Reviewers May 2000 https://web.archive.org/web/20000815202937/http://www.ams.org/authors/guide-reviewers.html
- APS Physical Review Style and Notation Guide https://cdn.journals.aps.org/files/styleguide-pr.pdf p21

- David Linkletter: https://plus.maths.org/content/pemdas-paradox
- Sass' article:
- First year algebra: https://archive.org/details/firstyearalgebra00well/page/18/mode/2up also p85
- First course in algebra:  https://archive.org/details/firstcourseinal01toutgoog/page/n23/mode/2up (p10) also p74 (page 90 of the pdf)
- Second course in algebra: https://archive.org/details/secondcourseinal00wellrich/page/4/mode/2up also  p64
- Lennes' article, 'Relating to the Order of Operations in Algebra': https://www.jstor.org/stable/2972726

- Sharp EL-512 manual:  https://www.manualslib.com/manual/1177727/Sharp-El-512.html?page=9#manual (p14)
- TI 81 manual: https://www.manualslib.com/manual/325929/Texas-Instruments-Ti-81.html?page=34#manual (p1-8)

- AMS Guide for Reviewers May 2000 https://web.archive.org/web/20000815202937/http://www.ams.org/authors/guide-reviewers.html
- APS Physical Review Style and Notation Guide  https://cdn.journals.aps.org/files/styleguide-pr.pdf p21
- AIP style guide:  http://web.mit.edu/me-ugoffice/communication/aip_style_4thed.pdf p23 (page 26 of the pdf)
*/

/** Computes the Sign of a number */
function numberSgn(x: number | undefined): Sign | undefined {
  if (x === undefined) return undefined;
  if (isNaN(x)) return 'unsigned';
  if (x > 0) return 'positive';
  if (x < 0) return 'negative';
  return 'zero';
}

/** Given the sgn of x, returns the sgn of -x */
function oppositeSgn(x: Sign | undefined): Sign | undefined {
  if (x === 'positive') return 'negative';
  if (x === 'non-negative') return 'non-positive';
  if (x === 'negative') return 'positive';
  if (x === 'non-positive') return 'non-negative';
  return x;
}

/** Determines sgn of ln(x) */
function lnSign(x: Expression): Sign | undefined {
  if (x.isGreater(1)) return 'positive';
  if (x.isGreaterEqual(1)) return 'non-negative';
  if (x.isLessEqual(1) && x.isGreaterEqual(0)) return 'non-positive';
  if (x.isLess(1) && x.isGreaterEqual(0)) return 'negative';
  if (x.isSame(1)) return 'zero';
  if (x.isNegative || x.isReal === false) return 'unsigned';
  return undefined;
}

export const ARITHMETIC_LIBRARY: SymbolDefinitions[] = [
  {
    //
    // Functions
    //
    Abs: {
      description: 'Absolute value (magnitude) of a number.',
      wikidata: 'Q3317982', // magnitude 'Q120812 (for reals)
      broadcastable: true,
      idempotent: true,
      complexity: 1200,
      signature: '(number) -> real',
      sgn: ([x], { engine: ce }) => {
        if (x.isSame(0)) return 'zero';
        if (isNumber(x)) return 'positive';
        // Symbol with no value: assumed bounds on `abs:x` may sharpen the
        // sign, e.g. `assume(|x| > 2)` entails 'positive'
        // (docs/fungrim/FUNGRIM-PLAN-3-ASSUMPTIONS.md §5.1b)
        const assumed = signFromAssumedPart(ce, x, 'abs');
        if (assumed !== undefined) return assumed;
        return 'non-negative'; //|x^2+1| fails
      },
      evaluate: ([x], { numericApproximation }) =>
        evaluateAbs(x, numericApproximation),
    },

    Add: {
      description: 'Sum of two or more values.',
      wikidata: 'Q32043',
      associative: true,
      commutative: true,
      commutativeOrder: addOrder,
      broadcastable: true,
      idempotent: true,
      complexity: 1300,

      lazy: true,

      // Accept numbers, vectors, and matrices for element-wise addition
      signature: '(value+) -> value',
      type: addType,

      sgn: (ops) => {
        if (ops.some((x) => x.isNaN)) return 'unsigned';
        if (ops.every((x) => x.isSame(0))) return 'zero';
        if (ops.every((x) => x.isNonNegative))
          return ops.some((x) => x.isPositive) ? 'positive' : 'non-negative';
        if (ops.every((x) => x.isNonPositive))
          return ops.some((x) => x.isNegative) ? 'negative' : 'non-positive';
        return undefined;
      },

      // @fastpath: canonicalization is done in the function
      // makeNumericFunction().
      evaluate: (ops, { numericApproximation, engine }) => {
        // Check if any operand is a Quantity expression
        const evaluated = ops.map((x) => x.evaluate());
        if (evaluated.some((x) => x.operator === 'Quantity')) {
          return quantityAdd(engine!, evaluated);
        }
        // Do not evaluate in the case of numericApproximation
        // to avoid premature rounding errors.
        // For example: `\\frac{2}{3}+\\frac{12345678912345678}{987654321987654321}+\\frac{987654321987654321}{12345678912345678}`
        if (numericApproximation) return addN(...ops);
        const result = add(...evaluated);
        // D2: an inexact (float) operand has no exactness to preserve, so it
        // numericizes the whole sum even when mixed with an exact symbolic
        // constant that the numeric-literal fold above can't reach (`Pi`,
        // `ExponentialE`, …) — `Add(0.5, Pi)` → 3.64…, matching
        // `Add(0.5, Sqrt(2))` (which already folds via the numeric-literal
        // path since `Sqrt(2)` is itself a number literal). Only when the
        // sum has no free variables: `0.5 + x` must stay symbolic.
        // `isExactNumber` (not plain `isExact`) additionally protects a
        // Gaussian-integer term still carried by the inexact lane (e.g. the
        // machine `i` constant); exact complex literals (`1/2 + i`, since
        // D12-A an ExactNumericValue) are already covered by `isExact`.
        if (
          result.operator === 'Add' &&
          result.unknowns.length === 0 &&
          evaluated.some((x) => !isExactNumber(x))
        )
          return result.N();
        return result;
      },
    },

    Ceil: {
      description: 'Rounds a number up to the next largest integer',
      complexity: 1250,
      broadcastable: true,
      signature: '(number) -> integer',
      type: ([x]) => roundingFunctionType(x),
      sgn: ([x]) => {
        if (x.isLessEqual(-1)) return 'negative';
        if (x.isPositive) return 'positive';
        if (x.isNonNegative) return 'non-negative';
        if (x.isNonPositive && x.isGreater(-1)) return 'zero';
        if (x.isNonPositive) return 'non-positive';
        if (x.isReal == false && isNumber(x))
          return x.im! > 0 || x.im! <= -1 ? 'unsigned' : numberSgn(x.re); //.re and .im should be more general.
        return undefined;
      },
      evaluate: ([x]) =>
        apply(
          x,
          Math.ceil,
          (x) => x.ceil(),
          (z) => z.ceil(0)
        ),
    },

    Chop: {
      description: 'Replace tiny numeric values with zero.',
      associative: true,
      broadcastable: true,
      idempotent: true,
      complexity: 1200,

      signature: '(number) -> number',
      type: ([x]) => x.type,
      evaluate: (ops) => {
        const op = ops[0];
        const ce = op.engine;
        return apply(
          op,
          (x) => ce.chop(x),
          (x) => ce.chop(x),
          (x) => ce.complex(ce.chop(x.re), ce.chop(x.im))
        );
      },
    },

    Complex: {
      description:
        'Construct a complex number from real and imaginary parts. Converted directly to a BoxedNumber during boxing; this entry exists so `operatorInfo("Complex")` returns a signature.',
      wikidata: 'Q11567',
      complexity: 500,
      signature: '(real: number, imaginary: number) -> complex',
    },

    Divide: {
      description: 'Quotient of a numerator and one or more denominators.',
      wikidata: 'Q1226939',
      complexity: 2500,
      broadcastable: true,

      // - if numer product of numbers, or denom product of numbers,
      // i.e. √2x/2 -> 0.707x, 2/√2x -> 1.4142x
      signature: '(number, number+) -> number',
      type: ([num, den]) => {
        if (den.isSame(1)) return num.type;
        if (den.isNaN || num.isNaN) return 'number';
        // Division by zero: k/0 = ~oo, 0/0 = NaN — indeterminate.
        if (den.isSame(0)) return 'number';
        // A non-finite operand: `x/±∞ = 0`, `±∞/finite = ±∞`, but `∞/∞`,
        // `∞/i`, `i/∞` give NaN/~oo. Widen to the top type (the old
        // `non_finite_number` mis-typed `∞/i` and `∞/∞`).
        if (den.isFinite === false || num.isFinite === false) return 'number';
        if (den.isInteger && num.isInteger) return 'finite_rational';
        if (den.isReal && num.isReal) return 'finite_real';
        // Real/pure-imaginary quotients (mirrors the Multiply type handler;
        // `imaginary`-typed operands are non-zero and non-real by type —
        // `imaginary ∩ real = nothing` in the lattice, and 0 is real):
        // - i/i → real; i/r → pure imaginary; r/i → pure imaginary iff
        //   r ≠ 0 (0/i = 0, which is real, NOT `imaginary`).
        // Possibly-zero *denominators* are treated like the real/real branch
        // above (which claims `finite_real` even when `den` may be 0): only
        // a literal 0 denominator (caught earlier) yields the top type.
        {
          const isImag = (x: Expression) => x.type.matches('imaginary');
          if (isImag(num) && isImag(den)) return 'finite_real';
          if (isImag(num) && den.isReal === true) return 'imaginary';
          if (num.isReal === true && isImag(den)) {
            const s = num.sgn;
            return s === 'positive' || s === 'negative' || s === 'not-zero'
              ? 'imaginary'
              : 'finite_complex';
          }
          // A quotient of finite complex operands is a finite complex number.
          if (
            num.type.matches('finite_complex') &&
            den.type.matches('finite_complex')
          )
            return 'finite_complex';
        }
        return 'finite_number';
      },

      sgn: (ops) => {
        const [n, d] = [ops[0], ops[1]];
        if (d.isSame(0)) return 'unsigned';
        if (d.isPositive) return n.sgn;
        if (d.isNegative) return oppositeSgn(n.sgn);
        const s = d.sgn;
        if ((n.isSame(0) && s === 'not-zero') || (n.isFinite && d.isInfinity))
          return 'zero';
        if (n.sgn === 'not-zero' && s === 'not-zero') return 'not-zero';
        return undefined;
      },

      canonical: (args, { engine }) => {
        const ce = engine;
        // @fastpath: this code path is never taken, canonicalDivide is called directly
        args = checkNumericArgs(ce, args);
        let result = args[0];
        if (result === undefined) return ce.error('missing');
        if (args.length < 2) return result;

        const rest = args.slice(1);
        for (const x of rest) result = canonicalDivide(result, x);

        return result;
      },
      evaluate: ([num, den], { numericApproximation, engine }) => {
        const evalNum = num.evaluate();
        const evalDen = den.evaluate();
        if (
          evalNum.operator === 'Quantity' ||
          evalDen.operator === 'Quantity'
        ) {
          return quantityDivide(engine!, evalNum, evalDen);
        }
        const res = num.div(den);
        if (numericApproximation && res.operator !== 'Divide') return res.N();
        return res;
      },
    },

    Exp: {
      description: 'Natural exponential function: e^x.',
      wikidata: 'Q168698',
      broadcastable: true,
      complexity: 3500,

      signature: '(number) -> number',
      // Because it gets canonicalized to Power, the sgn handler is not called
      // sgn: ([x]) => {
      //   if (
      //     (x.isNumberLiteral && x.re === -Infinity) ||
      //     (x.isNegative && x.isInfinity)
      //   )
      //     return 'zero';
      //   if (x.isReal == false && x.isNumberLiteral) {
      //     let n = chop(1 - x.im! / Math.PI) + 1;
      //     return n % 1 !== 0
      //       ? 'unsigned'
      //       : n % 2 === 0
      //         ? 'positive'
      //         : 'negative';
      //   }
      //   if (x.isReal || (x.isInfinity && x.isPositive)) return 'positive';
      //   return undefined;
      // },
      // Exp(x) -> e^x
      canonical: (args, { engine }) => {
        // The canonical handler is responsible for arg validation
        args = checkNumericArgs(engine, args, 1);
        return engine.function('Power', [engine.E, ...args]);
      },
    },

    Exp2: {
      description: 'Base-2 exponential: 2^x',
      complexity: 3500,
      broadcastable: true,
      signature: '(number) -> number',
      canonical: (args, { engine }) => {
        args = checkNumericArgs(engine, args, 1);
        return engine.function('Power', [engine.number(2), ...args]);
      },
    },

    Factorial: {
      description:
        'Factorial function: the product of all positive integers less than or equal to n',
      wikidata: 'Q120976',
      broadcastable: true,
      complexity: 9000,

      // `n!` extends to `Γ(n+1)` for real/complex arguments (as the `evaluate`
      // handler computes), so the signature is the same as `Gamma`'s rather
      // than `(integer) -> integer`. This keeps ill-typed calls (`Factorial("x")`)
      // invalid while honestly typing `Factorial(1/2)` (= Γ(3/2), a real) and
      // `Factorial(i)` (complex) instead of the unsound `finite_integer`.
      signature: '(number) -> number',
      type: ([x]) => {
        // A non-negative integer factorial is a (finite) positive integer.
        if (x?.isInteger === true && x.isNonNegative === true)
          return 'finite_integer';
        // A *negative* integer is a pole of Γ(x+1): the value is `~oo`,
        // representable only by `number` (non-finite typing convention).
        if (x?.isInteger === true && x.isNegative === true) return 'number';
        // Otherwise it is Γ(x+1); type it like `Gamma`.
        return numericTypeHandler([x]);
      },

      // Assumes that the inside of the factorial is an integer
      sgn: ([x]) =>
        x.isNonNegative
          ? 'positive'
          : x.isNegative || x.isReal === false
            ? 'unsigned'
            : undefined,
      canonical: (args, { engine }) => engine._fn('Factorial', [args[0]]),
      evaluate: ([x]) => {
        const ce = x.engine;

        // If argument is symbolic (not a number literal), keep unevaluated
        if (!isNumber(x)) return undefined;

        // Is the argument a complex number?
        if (x.im !== 0 && x.im !== undefined)
          return ce.number(gammaComplex(ce.complex(x.re, x.im).add(1)));

        // The argument is real...
        if (!x.isFinite) return undefined;

        // n! = Γ(n+1). Γ has poles at the non-positive integers, so the
        // factorial of a negative integer is the (unsigned) complex infinity.
        if (x.isNegative) {
          if (x.isInteger) return ce.ComplexInfinity;
          return ce.number(gamma(1 + x.re));
        }
        // A positive *non-integer* real is `Γ(x+1)`, not the rounded-integer
        // factorial — `Factorial(2.5)` is Γ(3.5) ≈ 3.323, not `2`.
        if (!x.isInteger) return ce.number(gamma(1 + x.re));
        try {
          return ce.number(
            run(
              bigFactorial(BigInt((x.bignumRe ?? x.re).toFixed())),
              ce._timeRemaining
            )
          );
        } catch (e) {
          if (e instanceof CancellationError) throw e;
          // We can get here if the factorial is too large
          return undefined;
        }
      },
      evaluateAsync: async ([x], { signal }) => {
        const ce = x.engine;

        // If argument is symbolic (not a number literal), keep unevaluated
        if (!isNumber(x)) return undefined;

        // Is the argument a complex number?
        if (x.im !== 0 && x.im !== undefined)
          return ce.number(gammaComplex(ce.complex(x.re, x.im).add(1)));

        // The argument is real...
        if (!x.isFinite) return undefined;

        // n! = Γ(n+1). Γ has poles at the non-positive integers, so the
        // factorial of a negative integer is the (unsigned) complex infinity.
        if (x.isNegative) {
          if (x.isInteger) return ce.ComplexInfinity;
          return ce.number(gamma(1 + x.re));
        }
        // A positive non-integer real is `Γ(x+1)`, not the rounded factorial.
        if (!x.isInteger) return ce.number(gamma(1 + x.re));

        try {
          return ce.number(
            await runAsync(
              bigFactorial(BigInt((x.bignumRe ?? x.re).toFixed())),
              (ce._deadline ?? Infinity) - Date.now(),
              signal
            )
          );
        } catch (e) {
          if (e instanceof CancellationError) throw e;
          // We can get here if the factorial is too large
          return undefined;
        }
      },
    },

    Factorial2: {
      description: 'Double Factorial Function',
      complexity: 9000,
      broadcastable: true,

      signature: '(integer) -> integer',
      type: () => 'finite_integer',
      sgn: (
        [x] //Assumes that the inside of the factorial is an integer
      ) =>
        x.isNonNegative
          ? 'positive'
          : x.isNegative || x.isReal === false
            ? 'unsigned'
            : undefined,
      evaluate: (ops) => {
        // 2^{\frac{n}{2}+\frac{1}{4}(1-\cos(\pi n))}\pi^{\frac{1}{4}(\cos(\pi n)-1)}\Gamma\left(\frac{n}{2}+1\right)

        const x = ops[0];
        // The double factorial of a non-integer is an exact constant with no
        // simple closed form here, so stay symbolic rather than rounding the
        // argument to an integer (which non-strict mode would otherwise allow).
        if (x.isInteger !== true) return undefined;
        const n = toInteger(x);
        if (n === null) return undefined;
        const ce = x.engine;
        if (bignumPreferred(ce))
          return ce.number(run(bigFactorial2(ce.bignum(n)), ce._timeRemaining));

        return ce.number(factorial2(n));
      },
    },

    Floor: {
      description: 'Rounds a number down to the nearest integer.',
      wikidata: 'Q56860783',
      complexity: 1250,
      broadcastable: true,

      signature: '(number) -> integer',
      type: ([x]) => roundingFunctionType(x),
      sgn: ([x]) => {
        if (x.isNegative) return 'negative';
        if (x.isGreaterEqual(1)) return 'positive';
        if (x.isNonNegative && x.isLess(1)) return 'zero';
        if (x.isNonNegative) return 'non-negative';
        if (x.isReal == false && isNumber(x))
          return x.im! < 0 || x.im! >= 1 ? 'unsigned' : numberSgn(x.re); //.re and .im should be more general.
        return undefined;
      },
      evaluate: ([x]) =>
        apply(
          x,
          Math.floor,
          (x) => x.floor(),
          (z) => z.floor(0)
        ),
    },

    Fract: {
      description: 'Fractional part of a number: x - floor(x)',
      complexity: 1250,
      broadcastable: true,
      signature: '(number) -> number',
      type: ([x]) => numericTypeHandler([x]),
      sgn: ([x]) => {
        if (x.isNonNegative) return 'non-negative';
        return undefined;
      },
      evaluate: ([x], { numericApproximation, engine: ce }) => {
        // Exact fractional part for an exact real argument: x - floor(x),
        // computed exactly (rational arithmetic) so `Fract(1/2) → 1/2`, not
        // `0.5`. Only an inexact (float) argument numericizes.
        if (!numericApproximation && isNumber(x) && x.isExact && x.im === 0) {
          const fl = ce.function('Floor', [x]).evaluate();
          if (isNumber(fl) && fl.isExact)
            return ce.function('Subtract', [x, fl]).evaluate();
        }
        return apply(
          x,
          (x) => x - Math.floor(x),
          (x) => x.sub(x.floor()),
          (z) => z.sub(z.floor(0))
        );
      },
    },

    Gamma: {
      description:
        'Gamma function Γ(z); with two arguments, the upper incomplete gamma Γ(s, z) = ∫_z^∞ tˢ⁻¹ e⁻ᵗ dt.',
      wikidata: 'Q190573',
      complexity: 8000,
      broadcastable: true,
      signature: '(number, number?) -> number',
      // Γ(z) has poles (value `~oo`) at the non-positive integers; the
      // incomplete Γ(s, z) keeps the generic handler.
      type: (ops) =>
        ops.length === 1 ? gammaPoleType(ops[0]) : numericTypeHandler(ops),

      sgn: (ops) =>
        ops.length === 1
          ? ops[0].isPositive
            ? 'positive'
            : ops[0].isSame(0)
              ? 'zero'
              : undefined
          : undefined,
      evaluate: (ops, { numericApproximation, engine }) => {
        // Upper incomplete gamma Γ(s, z) (Mathematica/Rubi `Gamma[s, z]`).
        if (ops.length === 2) {
          const [s, z] = ops;
          // Γ(s, 0) = Γ(s): reduce so the 1-arg exact paths (incl. poles)
          // apply.
          if (isNumber(z) && z.isSame(0))
            return engine.function('Gamma', [s]).evaluate({
              numericApproximation,
            });
          return shouldNumericize(numericApproximation, s, z)
            ? applyN(
                [s, z],
                (s, z) => incompleteGammaUpper(s, z),
                undefined,
                (s, z) => incompleteGammaUpperComplex(s, z)
              )
            : undefined;
        }

        const x = ops[0];
        // Gamma has poles at the non-positive integers (0, -1, -2, ...).
        // This is exact, so return it regardless of numericApproximation.
        if (isNumber(x) && x.im === 0 && x.isInteger && x.isNonPositive)
          return engine.ComplexInfinity;
        return shouldNumericize(numericApproximation, x)
          ? apply(
              x,
              (x) => gamma(x),
              (x) => bigGamma(engine, x),
              (x) => gammaComplex(x)
            )
          : undefined;
      },
    },

    GammaLn: {
      description: 'Natural logarithm of the gamma function.',
      complexity: 8000,
      broadcastable: true,
      signature: '(number) -> number',
      type: (ops) => gammaPoleType(ops[0]),

      evaluate: (ops, { numericApproximation, engine }) =>
        shouldNumericize(numericApproximation, ops[0])
          ? apply(
              ops[0],
              (x) => gammaln(x),
              (x) => bigGammaln(engine, x),
              (x) => lngammaComplex(x)
            )
          : undefined,
    },

    // Digamma function ψ(x) = d/dx ln(Γ(x)) = Γ'(x)/Γ(x)
    // Also known as the psi function
    Digamma: {
      description:
        'Digamma function, the logarithmic derivative of the gamma function',
      wikidata: 'Q1142755',
      complexity: 8200,
      broadcastable: true,
      signature: '(number) -> number',
      type: (ops) => gammaPoleType(ops[0]),
      evaluate: ([x], { numericApproximation, engine }) =>
        shouldNumericize(numericApproximation, x)
          ? apply(x, digamma, (x) => bigDigamma(engine, x))
          : undefined,
    },

    // Trigamma function ψ₁(x) = d/dx ψ(x) = d²/dx² ln(Γ(x))
    // The derivative of the digamma function
    Trigamma: {
      description: 'Trigamma function, the derivative of the digamma function',
      wikidata: 'Q2371722',
      complexity: 8400,
      broadcastable: true,
      signature: '(number) -> number',
      type: (ops) => gammaPoleType(ops[0]),
      evaluate: ([x], { numericApproximation, engine }) =>
        shouldNumericize(numericApproximation, x)
          ? apply(x, trigamma, (x) => bigTrigamma(engine, x))
          : undefined,
    },

    // PolyGamma function ψₙ(x) = dⁿ/dxⁿ ψ(x)
    // The n-th derivative of the digamma function
    // PolyGamma(0, x) = Digamma(x), PolyGamma(1, x) = Trigamma(x)
    PolyGamma: {
      description:
        'Polygamma function, the n-th derivative of the digamma function',
      wikidata: 'Q1817679',
      complexity: 8500,
      broadcastable: true,
      signature: '(order: integer, number) -> number',
      // ψⁿ(x) has poles (value `~oo`) at the non-positive integers.
      type: ([n, x]) =>
        x?.isInteger === true && x.isNonPositive === true
          ? 'number'
          : numericTypeHandler([n, x]),
      evaluate: ([n, x], { numericApproximation, engine }) =>
        shouldNumericize(numericApproximation, n, x)
          ? apply2(
              n,
              x,
              (n, x) => polygamma(n, x),
              (n, x) => bigPolygamma(engine, n, x)
            )
          : undefined,
    },

    // Riemann zeta function ζ(s) = Σ_{n=1}^∞ 1/n^s
    // Converges for Re(s) > 1, analytically continued elsewhere
    Zeta: {
      description: 'Riemann zeta function',
      wikidata: 'Q187235',
      complexity: 8500,
      broadcastable: true,
      signature: '(number) -> number',
      // ζ(1) is the pole (value `~oo`, representable only by `number`).
      type: ([x]) => (x?.isSame(1) ? 'number' : numericTypeHandler([x])),
      evaluate: ([x], { numericApproximation, engine }) => {
        if (shouldNumericize(numericApproximation, x))
          return apply(x, zeta, (x) => bigZeta(engine, x));

        // Exact values at integer literals (via exact Bernoulli rationals):
        // - ζ(2k) = (−1)^{k+1}·B₂ₖ·(2π)^{2k}/(2·(2k)!) → rational · π^{2k}
        //   (ζ(2) = π²/6, ζ(4) = π⁴/90, ζ(6) = π⁶/945, …)
        // - ζ(0) = −1/2; ζ(1) is a pole → ComplexInfinity
        // - ζ(−n) = −Bₙ₊₁/(n+1): ζ(−1) = −1/12, ζ(−3) = 1/120, and
        //   ζ(−2k) = 0 (the trivial zeros)
        // - ζ(3), ζ(5), … have no known closed form: stay symbolic
        // Capped at |s| ≤ 100 to avoid huge factorials; beyond, stay
        // symbolic (the numeric path is unaffected).
        const n = asSmallInteger(x);
        if (n === null || !Number.isInteger(n) || Math.abs(n) > 100)
          return undefined;
        if (n === 1) return engine.ComplexInfinity;
        if (n === 0) return engine.number([-1, 2]);
        if (n < 0) {
          if (n % 2 === 0) return engine.Zero;
          return engine.number(zetaNegativeInteger(-n));
        }
        if (n % 2 === 0)
          return engine
            .number(zetaEvenCoefficient(n / 2))
            .mul(engine.Pi.pow(n));
        return undefined;
      },
    },

    // Beta function B(a,b) = Γ(a)Γ(b)/Γ(a+b) = ∫₀¹ t^(a-1)(1-t)^(b-1) dt
    Beta: {
      description: 'Euler beta function',
      wikidata: 'Q189062',
      complexity: 8200,
      broadcastable: true,
      signature: '(number, number) -> number',
      // B(a, b) has Γ-poles (value `~oo`) where a or b is a non-positive
      // integer (unless cancelled). Such an argument may be a pole → claim the
      // top type `number` per the non-finite typing convention, rather than
      // `finite_real`. (`B(−2, 2) = 1/2` is finite but `number` still admits it.)
      type: (ops) => {
        const nonposInt = (x: Expression | undefined) =>
          x?.isInteger === true && x.isNonPositive === true;
        if (nonposInt(ops[0]) || nonposInt(ops[1])) return 'number';
        return numericTypeHandler(ops);
      },
      evaluate: ([a, b], { numericApproximation, engine }) => {
        // Exact reductions and Γ-pole handling for real (im === 0) arguments.
        // The naive B(a,b) = Γ(a)Γ(b)/Γ(a+b) formula turns the Γ-pole at a
        // non-positive integer into silent overflow garbage (e.g. B(−1, 2)
        // → −2.97e49); the exact rational form below is correct on both the
        // finite (`B(−2, 2) = 1/2`) and the pole (`B(−1, 2) = ~oo`) branches.
        if (isNumber(a) && isNumber(b) && a.im === 0 && b.im === 0) {
          const ai = a.isInteger ? asSmallInteger(a) : null;
          const bi = b.isInteger ? asSmallInteger(b) : null;
          // B(a, m) = (m−1)! / (a(a+1)…(a+m−1)) — an exact rational function of
          // a valid at every a (with a pole where the denominator vanishes).
          let reduced: Expression | undefined;
          if (bi !== null && bi > 0) reduced = betaPositiveIntegerArg(engine, a, bi);
          else if (ai !== null && ai > 0)
            reduced = betaPositiveIntegerArg(engine, b, ai);
          if (reduced !== undefined)
            return numericApproximation ? reduced.N() : reduced;
          // Remaining pole cases: a or b a non-positive integer with no
          // positive-integer partner to cancel it → Γ-pole (B is infinite).
          if ((ai !== null && ai <= 0) || (bi !== null && bi <= 0))
            return engine.ComplexInfinity;
        }
        return shouldNumericize(numericApproximation, a, b)
          ? apply2(a, b, beta, (a, b) => bigBeta(engine, a, b))
          : undefined;
      },
    },

    // Lambert W function: W(x)·e^(W(x)) = x
    // Also known as the product logarithm or omega function
    LambertW: {
      description: 'Lambert W function (product logarithm)',
      wikidata: 'Q429963',
      complexity: 8300,
      broadcastable: true,
      signature: '(number) -> number',
      type: (ops) => numericTypeHandler(ops),
      evaluate: ([x], { numericApproximation, engine }) =>
        shouldNumericize(numericApproximation, x)
          ? apply(x, lambertW, (x) => bigLambertW(engine, x))
          : undefined,
    },

    // Bessel function of the first kind J_n(x)
    // Solution to Bessel's differential equation that is finite at the origin
    BesselJ: {
      description: 'Bessel function of the first kind',
      wikidata: 'Q627488',
      complexity: 8500,
      broadcastable: true,
      signature: '(order: number, number) -> number',
      type: (ops) => numericTypeHandler(ops),
      evaluate: ([n, x], { numericApproximation }) =>
        shouldNumericize(numericApproximation, n, x)
          ? apply2(n, x, besselJ)
          : undefined,
    },

    // Bessel function of the second kind Y_n(x)
    // Also known as Neumann function or Weber function
    BesselY: {
      description: 'Bessel function of the second kind (Neumann function)',
      wikidata: 'Q627488',
      complexity: 8500,
      broadcastable: true,
      signature: '(order: number, number) -> number',
      type: (ops) => numericTypeHandler(ops),
      evaluate: ([n, x], { numericApproximation }) =>
        shouldNumericize(numericApproximation, n, x)
          ? apply2(n, x, besselY)
          : undefined,
    },

    // Modified Bessel function of the first kind I_n(x)
    BesselI: {
      description: 'Modified Bessel function of the first kind',
      wikidata: 'Q627488',
      complexity: 8500,
      broadcastable: true,
      signature: '(order: number, number) -> number',
      type: (ops) => numericTypeHandler(ops),
      evaluate: ([n, x], { numericApproximation }) =>
        shouldNumericize(numericApproximation, n, x)
          ? apply2(n, x, besselI)
          : undefined,
    },

    // Modified Bessel function of the second kind K_n(x)
    // Also known as Macdonald function
    BesselK: {
      description:
        'Modified Bessel function of the second kind (Macdonald function)',
      wikidata: 'Q627488',
      complexity: 8500,
      broadcastable: true,
      signature: '(order: number, number) -> number',
      type: (ops) => numericTypeHandler(ops),
      evaluate: ([n, x], { numericApproximation }) =>
        shouldNumericize(numericApproximation, n, x)
          ? apply2(n, x, besselK)
          : undefined,
    },

    // Airy function of the first kind Ai(x)
    // Solution to Airy differential equation y'' - xy = 0
    AiryAi: {
      description: 'Airy function of the first kind',
      wikidata: 'Q403629',
      complexity: 8400,
      broadcastable: true,
      signature: '(number) -> number',
      type: (ops) => numericTypeHandler(ops),
      evaluate: ([x], { numericApproximation }) =>
        shouldNumericize(numericApproximation, x)
          ? apply(x, airyAi)
          : undefined,
    },

    // Airy function of the second kind Bi(x)
    AiryBi: {
      description: 'Airy function of the second kind',
      wikidata: 'Q403629',
      complexity: 8400,
      broadcastable: true,
      signature: '(number) -> number',
      type: (ops) => numericTypeHandler(ops),
      evaluate: ([x], { numericApproximation }) =>
        shouldNumericize(numericApproximation, x)
          ? apply(x, airyBi)
          : undefined,
    },

    Ln: {
      description: 'Natural Logarithm',
      wikidata: 'Q204037',
      complexity: 4000,
      broadcastable: true,

      signature: '(number, base: number?) -> number',
      type: (ops) => elementaryFunctionType('Ln', ops),
      sgn: ([x]) => lnSign(x),
      // @fastpath: this doesn't get called. See makeNumericFunction()
      evaluate: ([z], { numericApproximation, engine }) => {
        // Ln(a, b) = Log(a, b), so no need to check second argument
        if (!numericApproximation) return z.ln();

        return apply(
          z,
          (x) =>
            x === 0
              ? -Infinity
              : x >= 0
                ? Math.log(x)
                : engine.complex(x).log(),
          (x) =>
            x.isZero()
              ? -Infinity
              : !x.isNegative()
                ? x.ln()
                : engine.complex(x.toNumber()).log(),
          (z) => (z.isZero() ? NaN : z.log())
        );
      },
    },

    Log: {
      description: 'Log(z, b = 10) = Logarithm of base b',
      wikidata: 'Q11197',
      complexity: 4100,
      broadcastable: true,

      signature: '(number, base: number?) -> number',
      type: (ops) => elementaryFunctionType('Log', ops),

      sgn: ([x, base]) => {
        if (!base) return lnSign(x);
        if (base.isSame(1) || base.isReal == false) return 'unsigned';
        if (base.isGreater(1)) return lnSign(x);
        if (base.isLess(1)) return oppositeSgn(lnSign(x));
        return undefined;
      },
      // @fastpath: this doesn't get called. See makeNumericFunction()
      // canonical: (ce, [x, base]) => {
      //   if (!x) return ce._fn('Log', [ce.error('missing'), base]);
      //   return x.ln(base ?? 10);
      // },
      evaluate: (ops, { numericApproximation, engine }) => {
        if (!numericApproximation) return ops[0]?.ln(ops[1] ?? 10) ?? undefined;
        const ce = engine;
        if (ops[1] === undefined)
          return apply(
            ops[0],
            (x) =>
              x === 0
                ? -Infinity
                : x >= 0
                  ? Math.log10(x)
                  : ce.complex(x).log().div(Math.LN10),
            (x) =>
              x.isZero()
                ? -Infinity
                : !x.isNegative()
                  ? BigDecimal.log10(x)
                  : ce.complex(x.toNumber()).log().div(Math.LN10),
            (z) => (z.isZero() ? NaN : z.log().div(Math.LN10))
          );
        return apply2(
          ops[0],
          ops[1],
          // A negative real argument has a complex logarithm; the one-arg
          // path already falls back to `ce.complex(...).log()`, so the
          // two-arg lanes must too (otherwise `Log(-2, 10).N()` → NaN while
          // `Ln(-2).N()` → complex).
          (z, b) =>
            z < 0
              ? ce.complex(z).log().div(Math.log(b))
              : Math.log(z) / Math.log(b),
          (z, b) =>
            z.isNegative()
              ? ce.complex(z.toNumber()).log().div(Math.log(b.toNumber()))
              : z.log(b),
          (z, b) => z.log().div(typeof b === 'number' ? Math.log(b) : b.log())
        );
      },
    },

    Lb: {
      description: 'Base-2 Logarithm',
      wikidata: 'Q581168',
      complexity: 4100,
      broadcastable: true,

      signature: '(number) -> number',
      sgn: ([x]) => lnSign(x),
      canonical: ([x], { engine }) => engine._fn('Log', [x, engine.number(2)]),
    },

    Lg: {
      description: 'Base-10 Logarithm',
      wikidata: 'Q966582',
      complexity: 4100,
      broadcastable: true,
      signature: '(number) -> number',
      sgn: ([x]) => lnSign(x),
      canonical: ([x], { engine }) => engine._fn('Log', [x]),
    },

    Log10: {
      description: 'Base-10 Logarithm',
      complexity: 4100,
      broadcastable: true,
      signature: '(number) -> number',
      sgn: ([x]) => lnSign(x),
      canonical: ([x], { engine }) => engine._fn('Log', [x]),
    },

    Log2: {
      description: 'Base-2 Logarithm',
      complexity: 4100,
      broadcastable: true,
      signature: '(number) -> number',
      sgn: ([x]) => lnSign(x),
      canonical: ([x], { engine }) => engine._fn('Log', [x, engine.number(2)]),
    },

    Mod: {
      description:
        'Modulo: the remainder of the floored division of x by y. The sign of the result follows the sign of the divisor y (floored-division convention, matching most CAS). For a truncated/round-to-nearest remainder, see `Remainder`.',
      wikidata: 'Q1799665',
      complexity: 2500,
      broadcastable: true,

      signature: '(number, number) -> number',
      type: ([a, b]) => {
        if (!a || !b || a.isNaN || b.isNaN) return 'number';
        // A floored remainder is defined only for a finite real dividend and a
        // finite, non-zero real modulus. A zero/complex/infinite modulus, or an
        // infinite dividend, yields NaN (the old `widen(...)` claimed e.g.
        // `finite_rational` for `Mod(1/2, 0)` and `imaginary` for `Mod(i, i)`).
        if (b.isSame(0)) return 'number';
        if (
          a.isReal === true &&
          b.isReal === true &&
          a.isFinite === true &&
          b.isFinite === true
        ) {
          if (a.isInteger && b.isInteger) return 'finite_integer';
          if (a.isRational && b.isRational) return 'finite_rational';
          return 'finite_real';
        }
        return 'number';
      },
      sgn: (ops) => {
        const n = ops[1]; //base of Mod
        if (n === undefined || n.isReal == false) return undefined;
        if (n.isSame(0)) return 'unsigned';
        if (isNumber(ops[0]) && isNumber(n)) {
          const v = apply2(
            ops[0],
            n,
            // In JavaScript, the % is remainder, not modulo
            // so adapt it to return a modulo (floored: sign follows the
            // divisor). Both lanes must agree with the `evaluate` handler
            // below, or `.sgn` and `.evaluate()` disagree on the same
            // expression (P0-7).
            (a, b) => ((a % b) + b) % b,
            (a, b) => a.mod(b).add(b).mod(b)
          );
          return v?.sgn ?? undefined;
        }
        return undefined;
      },
      evaluate: ([a, b], { engine: ce }) => {
        // Exact-integer fast path for a non-negative dividend and a positive
        // modulus (where modulo and remainder coincide, so both `apply2` lanes
        // agree). This avoids the bignum float lane, which extracts operands
        // via `bignumRe` and rounds integers longer than `ce.precision` digits
        // (e.g. Mod(10^21+3, 10) → 0 instead of 3).
        if (a.isInteger && b.isInteger && a.isNonNegative && b.isPositive) {
          const ba = asBigint(a);
          const bb = asBigint(b);
          if (ba !== null && bb !== null && bb !== BigInt(0))
            return ce.number(ba % bb);
        }

        // Exact-rational fast path (any sign, integer or rational): compute
        // the floored modulo exactly with bigint arithmetic. This subsumes
        // the integer fast path above for negative operands (still exact,
        // unlike the bignum float lane below, which rounds `a`/`b` through
        // `bignumRe` at `ce.precision` digits) and also handles true
        // rationals exactly (e.g. `Mod(1/2, 1/3) = 1/6`, P0-16d), which the
        // float lanes below would otherwise numericize.
        if (a.isRational && b.isRational) {
          const ra = asRational(a);
          const rb = asRational(b);
          if (ra && rb) {
            const an = BigInt(ra[0]);
            const ad = BigInt(ra[1]); // > 0 by rational convention
            const bn = BigInt(rb[0]);
            const bd = BigInt(rb[1]); // > 0 by rational convention
            if (bn !== BigInt(0)) {
              // p = an/ad, q = bn/bd. floor(p/q) = floor((an·bd) / (ad·bn)).
              const num = an * bd;
              const den = ad * bn;
              let k = num / den; // bigint division truncates toward zero
              const r = num % den;
              if (r !== BigInt(0) && r < BigInt(0) !== den < BigInt(0))
                k -= BigInt(1); // truncated → floored correction
              // Mod(p, q) = p - k·q = (an·bd − k·bn·ad) / (ad·bd)
              return ce.number([an * bd - k * bn * ad, ad * bd]);
            }
          }
        }

        return apply2(
          a,
          b,
          // In JavaScript, the % is remainder, not modulo
          // so adapt it to return a modulo (floored: sign follows the
          // divisor, matching the machine lane and the fast paths above).
          (a, b) => ((a % b) + b) % b,
          (a, b) => a.mod(b).add(b).mod(b)
        );
      },
    },

    Multiply: {
      description: 'Product of two or more values.',
      wikidata: 'Q40276',
      associative: true,
      commutative: true,
      idempotent: true,
      complexity: 2100,
      broadcastable: true,

      lazy: true,
      signature: '(number*) -> number',
      type: (ops) => {
        if (ops.length === 0) return 'finite_integer'; // = 1
        if (ops.length === 1) return ops[0].type;
        if (ops.some((x) => x.isNaN)) return 'number';
        if (ops.some((x) => x.isFinite === false)) {
          // 0 · ±∞ = NaN (indeterminate).
          if (ops.some((x) => x.isSame(0))) return 'number';
          // real · ±∞ = ±∞ (a non-finite real); a non-real factor (i, complex)
          // with ∞ gives ~oo or NaN, and a *possibly-zero* factor gives NaN
          // (0 · ∞), so only claim `non_finite_number` when every operand is
          // provably real AND provably non-zero (non-finite typing
          // convention: zero-ness must be proven absent, not assumed).
          if (
            ops.every((x) => {
              if (x.isReal !== true) return false;
              const s = x.sgn;
              return s === 'positive' || s === 'negative' || s === 'not-zero';
            })
          )
            return 'non_finite_number';
          return 'number';
        }
        // From here every operand is finite (no `isFinite === false`).
        if (ops.every((x) => x.isInteger)) return 'finite_integer';
        if (ops.every((x) => x.isReal)) return 'finite_real';
        if (ops.every((x) => x.isRational)) return 'finite_rational';

        // Real × pure-imaginary products: at least one factor is typed
        // `imaginary` and every other factor is provably real. Since
        // i² = −1, the imaginary factors pair up:
        // - even count → the product is real;
        // - odd count → the product is pure imaginary *iff it is non-zero*.
        //   In the lattice `imaginary` is a *pure* imaginary number,
        //   disjoint from the real chain (`imaginary ∩ real = nothing`,
        //   see `subtype.ts` / type-lattice tests), so 0 — which is real —
        //   is NOT an `imaginary` value. We may only claim `imaginary`
        //   when every real factor is provably non-zero (`imaginary`-typed
        //   factors are non-zero by type); otherwise the sound answer is
        //   `finite_complex` (e.g. `x·i` with real x ∋ 0 may be 0, which
        //   is not `imaginary`).
        const isImaginary = (x: Expression) => x.type.matches('imaginary');
        const imaginaryCount = ops.filter(isImaginary).length;
        if (
          imaginaryCount > 0 &&
          ops.every((x) => isImaginary(x) || x.isReal === true)
        ) {
          if (imaginaryCount % 2 === 0) return 'finite_real';
          const isNonZero = (x: Expression) => {
            const s = x.sgn;
            return s === 'positive' || s === 'negative' || s === 'not-zero';
          };
          if (ops.every((x) => isImaginary(x) || isNonZero(x)))
            return 'imaginary';
          return 'finite_complex';
        }

        // A product of finite complex factors is itself a finite complex
        // number (e.g. `√2·(1+i)`): claim `finite_complex` (⊂ `complex`)
        // rather than the complex-unaware `finite_number`.
        if (ops.every((x) => x.type.matches('finite_complex')))
          return 'finite_complex';

        return 'finite_number';
      },
      // @fastpath: canonicalization is done in the function
      // makeNumericFunction().
      //
      sgn: (ops) => {
        if (ops.some((x) => x.sgn === undefined || x.isReal === false))
          return undefined;
        if (ops.some((x) => x.isSame(0)))
          return ops.every((x) => x.isFinite)
            ? 'zero'
            : ops.some((x) => x.isFinite === false)
              ? 'unsigned'
              : undefined;
        if (
          ops.some((x) => x.isFinite === false || x.isFinite === undefined) &&
          ops.some((x) => {
            const s = x.sgn;
            return s !== 'positive' && s !== 'negative' && s !== 'not-zero';
          })
        )
          return undefined;
        if (ops.every((x) => x.isPositive || x.isNegative)) {
          let sumNeg = 0;
          ops.forEach((x) => {
            if (x.isNegative) sumNeg++;
          });
          return sumNeg % 2 === 0 ? 'positive' : 'negative';
        }
        if (ops.every((x) => x.isNonPositive || x.isNonNegative)) {
          let sumNeg = 0;
          ops.forEach((x) => {
            if (x.isNonPositive) sumNeg++;
          });
          return sumNeg % 2 === 0 ? 'non-positive' : 'non-negative';
        }
        if (
          ops.every(
            (x) =>
              x.sgn === 'not-zero' ||
              x.sgn === 'positive' ||
              x.sgn === 'negative'
          )
        )
          return 'not-zero';
        return undefined;
      },
      evaluate: (ops, { numericApproximation, engine }) => {
        // Check if any operand is a Quantity expression
        const evaluated = ops.map((x) => x.evaluate());
        if (evaluated.some((x) => x.operator === 'Quantity')) {
          return quantityMultiply(engine!, evaluated);
        }
        // Use evaluate in both cases: do not introduce premature rounding errors
        if (numericApproximation) return mulN(...ops);
        const result = mul(...evaluated);
        // D2: see the matching comment in `Add` — an inexact (float) operand
        // numericizes the whole product even when mixed with an exact
        // symbolic constant (`Multiply(0.5, Pi)` → 1.57…). Only when the
        // product has no free variables: `0.5 * x` must stay symbolic.
        if (
          result.operator === 'Multiply' &&
          result.unknowns.length === 0 &&
          evaluated.some((x) => !isExactNumber(x))
        )
          return result.N();
        return result;
      },
    },

    Negate: {
      description: 'Additive Inverse',
      wikidata: 'Q715358',
      complexity: 2000,
      broadcastable: true,
      signature: '(value) -> value',
      type: ([x]) => x.type,
      sgn: ([x]) => oppositeSgn(x.sgn),
      canonical: (args, { engine }) => {
        args = checkNumericArgs(engine, args);
        if (args.length === 0) return engine.error('missing');

        return args[0].neg();
      },
      evaluate: ([x], { engine }) => {
        const evalX = x.evaluate();
        if (isQuantity(evalX)) {
          const mag = evalX.op1.re;
          if (mag !== undefined)
            return engine._fn('Quantity', [engine.number(-mag), evalX.op2]);
        }
        const neg = evalX.neg();
        // If the operand only became a collection (vector/matrix) *after*
        // evaluation — e.g. `Negate(Multiply(A, B))` — the broadcast path was
        // skipped (the raw operand wasn't yet a collection), leaving an
        // undistributed `Negate(matrix)`. A later matrix `Add`/`Subtract` would
        // then misclassify it as a scalar and broadcast it over the other
        // matrix, producing a bogus higher-rank result. Evaluating the negation
        // distributes it element-wise. (Guarded so symbolic scalars like
        // `Negate(a)` don't recurse.)
        return evalX.isIndexedCollection ? neg.evaluate() : neg;
      },
    },

    PlusMinus: {
      description: 'Plus or Minus',
      wikidata: 'Q120812',
      complexity: 1200,
      signature: '(value, value) -> tuple',
      canonical: (args, { engine: ce }) => {
        args = checkNumericArgs(ce, args, 2);
        if (args.length === 0) return ce.error('missing');
        return ce._fn('PlusMinus', [args[0], args[1].abs()]);
      },
      type: ([x, y]) => parseType(`tuple<${x.type}, ${y.type}>`),
      evaluate: ([x, y], { engine }) => engine.tuple(x.add(y.neg()), x.add(y)),
    },

    Power: {
      description: 'Exponentiation: raise a base to a power.',
      wikidata: 'Q33456',
      broadcastable: true,
      complexity: 3500,
      signature: '(number, number) -> number',
      type: ([base, exp]) => {
        if (base.isNaN || exp.isNaN) return 'number';
        // A non-finite base or exponent can produce ±∞ *or* NaN — `0^∞`,
        // `∞^0`, `1^∞`, `i^∞`, `∞^i` are all indeterminate. Only a
        // *non-negative real* base raised to a *positive finite real* exponent
        // is guaranteed non-finite (`(+∞)^2 = +∞`); everything else widens to
        // the top type (the old `non_finite_number` ignored the NaN forms).
        // `=== false` (not `!`): a symbolic operand has `isFinite ===
        // undefined`, which must not be treated as non-finite.
        if (base.isFinite === false || exp.isFinite === false) {
          if (
            base.isFinite === false &&
            base.isNonNegative === true &&
            exp.isFinite === true &&
            exp.isPositive === true
          )
            return 'non_finite_number';
          return 'number';
        }
        // `0` raised to a non-positive power is a pole: `0^0` is indeterminate
        // and `0^-k = ±∞` (P0-11: `0^(−0.5) = +∞`).
        if (base.isSame(0) && exp.isPositive !== true) return 'number';
        // `integer ^ (non-negative integer)` stays an integer; a possibly
        // *negative* integer exponent yields a (non-integer) rational
        // (P0-11: `2^-2 = 1/4`).
        if (base.isInteger && exp.isInteger)
          return exp.isNonNegative === true
            ? 'finite_integer'
            : 'finite_rational';
        if (base.isRational && exp.isInteger) return 'finite_rational';
        // A real result needs a non-negative base or an integer exponent;
        // otherwise the result may be complex (e.g. (−2)^0.5).
        if (base.isReal && exp.isReal && (base.isNonNegative || exp.isInteger))
          return 'finite_real';
        // A pure-imaginary base (non-zero by type: `imaginary ∩ real =
        // nothing` in the lattice, and 0 is real) raised to an integer power:
        // (bi)^n = bⁿ·iⁿ, so an even n is real, an odd n is pure imaginary
        // (non-zero since b ≠ 0), and an unknown-parity integer is one of the
        // two — both ⊂ `finite_complex`.
        if (base.type.matches('imaginary') && exp.isInteger === true) {
          if (exp.isEven === true) return 'finite_real';
          if (exp.isOdd === true) return 'imaginary';
          return 'finite_complex';
        }
        // A positive real base raised to a finite complex power is
        // e^(exp·ln base): finite and non-zero, hence a finite complex
        // number (e.g. `e^i`, on the unit circle).
        if (
          base.isReal === true &&
          base.isPositive === true &&
          exp.type.matches('finite_complex')
        )
          return 'finite_complex';
        return 'finite_number';
      },
      canonical: (args, { engine }) => {
        // @fastpath: See also shortcut in makeNumericFunction()
        args = checkNumericArgs(engine, args, 2);
        if (args.length !== 2) return engine._fn('Power', args);
        const [base, exp] = args;
        return canonicalPower(base, exp);
      },
      sgn: ([a, b]) => {
        //Missing some cases like (-1)^{1/3}
        const aSgn = a.sgn;
        const bSgn = b.sgn;
        if (
          a.isReal === false ||
          b.isReal === false ||
          a.isNaN ||
          b.isNaN ||
          aSgn === undefined ||
          bSgn === undefined
        )
          return undefined;

        if (a.isSame(0))
          return b.isNonPositive
            ? 'unsigned'
            : b.isPositive
              ? 'zero'
              : undefined;

        if (a.isSame(0) && b.isSame(0)) return 'unsigned';

        if (a.isNonNegative || (b.numerator.isOdd && b.denominator.isOdd))
          return a.sgn;

        if (b.numerator.isEven && b.denominator.isOdd) {
          if (a.isReal) {
            const s = a.sgn;
            return s === 'positive' || s === 'not-zero' || s === 'negative'
              ? 'positive'
              : 'non-negative';
          }
          if (a.type.matches('complex')) return 'negative';
          return !a.isSame(0) ? 'not-zero' : undefined; //already accounted for a.is(0)
        }

        if (
          b.isRational === false ||
          (b.numerator.isOdd && b.denominator.isEven && a.isNonPositive)
        )
          return 'unsigned'; //already account for a>=0

        return undefined;
      },
      // x^n
      // evaluate: (ops) => ops[0].pow(ops[1]),
      evaluate: ([x, n], { numericApproximation, engine }) => {
        const evalBase = x.evaluate();
        if (evalBase.operator === 'Quantity') {
          return quantityPower(engine!, evalBase, n.evaluate());
        }
        // D2: an inexact (float) base or exponent numericizes even under
        // plain evaluate() — `Power(2, 5.1)` → 34.29…, matching `Cos(5.1)`.
        // `isExactNumber` (not plain `isExact`) additionally protects the
        // exact power path for a Gaussian-integer base still carried by the
        // inexact lane (e.g. built from the machine `i` constant), so
        // `(1+i)^2 = 2i` — WP-2.16. Exact complex literals (since D12-A)
        // are already covered by `isExact`.
        return pow(x, n, {
          numericApproximation: shouldNumericize(numericApproximation, x, n),
        });
      },
      // Defined as RealNumbers for all power in RealNumbers when base > 0;
      // when x < 0, only defined if n is an integer
      // if x is a non-zero complex, defined as ComplexNumbers
      // Square root of a prime is irrational (AlgebraicNumbers)
      // https://proofwiki.org/wiki/Square_Root_of_Prime_is_Irrational
    },

    Rational: {
      description:
        'Construct a rational number from a numerator and denominator.',
      complexity: 2400,

      signature: '(number, integer?) -> rational',
      sgn: ([n]) => n.sgn,
      canonical: (args, { engine }) => {
        const ce = engine;
        args = flatten(args);

        if (args.length === 0) return ce._fn('Rational', [ce.error('missing')]);

        if (args.length === 1)
          return ce._fn('Rational', [checkType(ce, args[0], 'real')]);

        args = checkTypes(ce, args, ['integer', 'integer']);

        if (args.length !== 2 || !args[0].isValid || !args[1].isValid)
          return ce._fn('Rational', args);

        return args[0].div(args[1]);
      },
      evaluate: (ops, { numericApproximation, engine }) => {
        const ce = engine;
        //
        // If there is a single argument, i.e. `['Rational', 'Pi']`
        // the function evaluates to a rational expression of the argument
        //
        if (ops.length === 1) {
          const f = ops[0].N();
          if (!isNumber(f) || f.im !== 0) return undefined;
          return ce.number(rationalize(f.re));
        }

        if (numericApproximation) {
          return apply2(
            ops[0],
            ops[1],
            (a, b) => a / b,
            (a, b) => a.div(b),
            (a, b) => a.div(b)
          );
        }
        const [n, d] = [asSmallInteger(ops[0]), asSmallInteger(ops[1])];
        if (n !== null && d !== null) return ce.number([n, d]);
        return undefined;
      },
    },

    Root: {
      description: 'n-th root of a value.',
      complexity: 3200,
      broadcastable: true,

      signature: '(number, number) -> number',
      type: ([base, exp]) => {
        if (base.isNaN || exp.isNaN) return 'number';
        // Root(x, n) = x^(1/n). A non-finite base or index makes the result
        // indeterminate: Root(±∞, n) ∈ {0, ±∞, complex}, Root(x, ±∞) = x^0
        // (often 1 but 0^0/∞^0 are NaN). Widen to the top type.
        if (base.isFinite === false || exp.isFinite === false) return 'number';
        // Root(x, 0) = x^(1/0): a pole (the old `finite_integer` was wrong —
        // Root(2,0), Root(0,0), Root(−2,0) all evaluate to NaN).
        if (exp.isSame(0)) return 'number';
        if (exp.isSame(1)) return base.type;
        // Root(0, n): 0 for n>0, a pole (±∞) for n≤0, NaN for a complex index.
        if (base.isSame(0))
          return exp.isPositive === true ? 'finite_integer' : 'number';
        if (base.isReal && exp.isReal) {
          // A positive base always gives a positive real root.
          if (base.isPositive === true) return 'finite_real';
          // A negative real base: a positive index yields a finite (real or
          // complex) value; a non-positive index can numericize to NaN in the
          // current evaluate path (e.g. Root(−2,−2)), so widen to `number`.
          if (exp.isPositive === true) return 'finite_number';
          return 'number';
        }
        return 'finite_number';
      },
      sgn: ([x, n]) => {
        // Note: we can't simplify this to a power, then get the sgn of that because this may cause an infinite loop
        if (x.isReal === false || n.isReal === false) return 'unsigned';
        if (x.isSame(0)) {
          if (n.isNonPositive) {
            return 'unsigned';
          }
          if (n.isPositive) return 'zero';
        }
        if (x.isPositive === true) return 'positive';
        if (x.isNonNegative === true) return 'non-negative';
        if (n.isOdd === true || (n.numerator.isOdd && n.denominator.isOdd)) {
          return x.sgn;
        }
        if (x.isNegative && n.isOdd === false) return 'unsigned';
        return undefined;
      },
      canonical: (args, { engine }) => {
        args = checkNumericArgs(engine, args, 2);
        const [base, exp] = args;
        //note: args. are canonicalized prior.
        return canonicalRoot(base, exp);
      },
      evaluate: ([x, n], { numericApproximation, engine }) => {
        const evalX = x.evaluate();
        if (evalX.operator === 'Quantity') {
          const nVal = n.re;
          if (nVal !== undefined && nVal !== 0)
            return quantityPower(engine, evalX, engine.number(1 / nVal));
        }
        // D2: an inexact (float) radicand or index numericizes even under
        // plain evaluate() — `Root(5.1, 3)` → 1.721…; `isExactNumber`
        // protects an exact Gaussian-integer radicand (see `Power`).
        return root(x, n, {
          numericApproximation: shouldNumericize(numericApproximation, x, n),
        });
      },
    },

    Remainder: {
      description:
        'IEEE remainder: the signed remainder after dividing x by y, with the quotient rounded to the nearest integer (ties round toward +Infinity, matching JavaScript `Math.round`)',
      complexity: 2500,
      broadcastable: true,
      signature: '(number, number) -> number',
      type: ([a, b]) => widen(a.type.type, b.type.type),
      evaluate: ([a, b]) =>
        apply2(
          a,
          b,
          (a, b) => a - b * Math.round(a / b),
          // `BigDecimal.round()` rounds ties away from zero, which disagrees
          // with `Math.round`'s ties-toward-+Infinity at half-integer
          // quotients (e.g. Remainder(-5, 2): machine lane rounds -2.5 to
          // -2, bignum `.round()` would round it to -3, flipping the result
          // sign). `floor(x + 0.5)` reproduces `Math.round`'s tie-breaking
          // exactly, keeping both lanes in agreement.
          (a, b) => a.sub(b.mul(a.div(b).add(0.5).floor()))
        ),
    },

    Round: {
      description: 'Rounds a number to the nearest integer.',
      complexity: 1250,
      broadcastable: true,
      signature: '(number) -> integer',
      type: ([x]) => roundingFunctionType(x),
      sgn: ([x]) => {
        if (x.isNaN) return 'unsigned';
        if (isNumber(x))
          return x.im! >= 0.5 || x.im! <= -0.5
            ? 'unsigned'
            : numberSgn(Math.round(x.re));
        if (x.isGreaterEqual(0.5)) return 'positive';
        if (x.isLessEqual(-0.5)) return 'negative';
        if (x.isLess(0.5) && x.isGreater(-0.5)) return 'zero';
        if (x.isNonNegative) return 'non-negative';
        if (x.isNonPositive) return 'non-positive';
        return undefined;
      },
      evaluate: ([x]) =>
        apply(
          x,
          Math.round,
          (x) => x.round(),
          (x) => x.round(0)
        ),
    },

    /** Heaviside step function: H(x) = 0 for x < 0, 1/2 for x = 0, 1 for x > 0 */
    Heaviside: {
      description: 'Heaviside step function.',
      complexity: 1200,
      broadcastable: true,
      signature: '(number) -> real',
      type: () => 'finite_real',
      sgn: () => 'non-negative',
      evaluate: ([x], { engine }) => {
        if (x.isSame(0)) return engine.Half;
        if (x.isPositive) return engine.One;
        if (x.isNegative) return engine.Zero;
        return undefined;
      },
    },

    Sign: {
      description: 'Sign of a number: -1, 0, or 1.',
      complexity: 1200,
      broadcastable: true,
      signature: '(number) -> integer',
      type: () => 'finite_integer',
      sgn: ([x]) => x.sgn,
      evaluate: ([x], { engine }) => {
        if (x.isSame(0)) return engine.Zero;
        if (x.isPositive) return engine.One;
        if (x.isNegative) return engine.NegativeOne;
        return undefined;
      },
    },

    // {% def "GammaSgn" %}

    // [&quot;**GammaSgn**&quot;, _z_]{.signature}

    // {% latex "\\operatorname{sgn}(\\gamma(z))" %}

    // The gamma function can be computed as \\( \operatorname{sgn}\Gamma(x) \cdot
    // \expoentialE^{\operatorname{LogGamma}(x)} \\)
    // `["Multiply", ["GammaSgn", "x"], ["Exp", ["LogGamma", "x"]]]`.

    // This function is called `gammasgn` in SciPy.

    // **Reference**

    // - NIST: https://dlmf.nist.gov/5.2#E1

    // {% enddef %}
    //     GammaSgn: {
    //   description: 'The sign of the gamma function: -1 or +1',
    //   complexity: 7900,
    //   signature: {
    //     domain: ['FunctionOf', 'Numbers', ['Range', -1, 1]],
    //     evaluate: (ce, ops) => {
    //     },
    //   },
    //   // @todo
    // },

    Sqrt: {
      description: 'Square Root',
      wikidata: 'Q134237',
      complexity: 3000,
      broadcastable: true,

      signature: '(number) -> number',
      type: ([x]) => {
        if (x.isNaN) return 'number';
        if (x.isFinite === false) {
          // √(−∞) = i·∞ = ~oo (complex infinity), not a real ±∞ — and `~oo`
          // is representable only by `number` (non-finite typing convention).
          if (x.isNegative === true) return 'number';
          if (x.isNonNegative === true) return 'non_finite_number';
          return 'number';
        }
        if (x.isReal) return x.isNegative ? 'complex' : 'finite_real';
        return 'finite_number';
      },
      // @fastpath: canonicalization is done in the function
      // makeNumericFunction().
      // canonical: (ops, { engine: ce }) => {
      //   ops = flatten(ops);
      //   if (ops.length !== 1) return ce._fn('Sqrt', ops);
      //   return ops[0].sqrt();
      // },
      sgn: ([x]) => {
        if (x.isPositive) return 'positive';
        if (x.isNegative) return 'unsigned';
        if (x.isNonNegative) return 'non-negative';
        if (x.sgn === 'not-zero') return 'not-zero';
        return undefined;
      },
      evaluate: ([x], { numericApproximation, engine }) => {
        const evalX = x.evaluate();
        if (evalX.operator === 'Quantity')
          return quantityPower(engine, evalX, engine.number(0.5));

        if (!numericApproximation) return x.sqrt();

        const [c, rest] = x.toNumericValue();
        const cSqrt = engine.number(c.sqrt().N());
        if (rest.isSame(1)) return cSqrt;
        // √(c·rest) = √c · √rest. The square root must be applied to the
        // symbolic part too — returning `rest` un-rooted dropped the radical
        // (e.g. √(4y) → 2y instead of 2√y, and Sqrt(y).N() → y instead of √y).
        return cSqrt.mul(rest.sqrt());
      },
      // evalDomain: Square root of a prime is irrational
      // https://proofwiki.org/wiki/Square_Root_of_Prime_is_Irrational
    },

    Square: {
      description: 'Square of a number: x^2.',
      wikidata: 'Q3075175',
      complexity: 3100,
      broadcastable: true,
      signature: '(number) -> number',
      sgn: ([x]) => {
        if (x.isSame(0)) return 'zero';
        if (x.isReal) {
          const s = x.sgn;
          return s === 'not-zero' || s === 'positive' || s === 'negative'
            ? 'positive'
            : 'non-negative';
        }
        if (x.type.matches('complex')) return 'negative';
        if (x.isReal == false || x.isNaN) return 'unsigned';
        return undefined;
      },
      canonical: (args, { engine }) => {
        const ce = engine;
        args = flatten(args);
        if (args.length !== 1) return ce._fn('Square', args);
        return ce._fn('Power', [args[0], ce.number(2)]).canonical;
      },
    },

    Subtract: {
      description: 'Difference between two or more values.',
      wikidata: 'Q40754',
      complexity: 1350,
      broadcastable: true,
      // We accept from 1 to n arguments (see https://github.com/cortex-js/compute-engine/issues/171)
      // left-associative: a - b - c -> (a - b) - c
      signature: '(number+) -> number',
      canonical: (args, { engine }) => {
        args = checkNumericArgs(engine, args);
        if (args.length === 0) return engine.error('missing');
        const first = args[0];
        const rest = args.slice(1);
        return canonicalAdd(engine, [first, ...rest.map((x) => x.neg())]);
      },
    },

    Truncate: {
      description: 'Rounds a number towards zero (removes the fractional part)',
      complexity: 1250,
      broadcastable: true,
      signature: '(number) -> integer',
      type: ([x]) => roundingFunctionType(x),
      sgn: ([x]) => x.sgn,
      evaluate: ([x]) =>
        apply(
          x,
          Math.trunc,
          (x) => x.trunc(),
          (z) => new Complex(Math.trunc(z.re), Math.trunc(z.im))
        ),
    },
  },
  {
    //
    // Constants
    // Note: constants are put in a separate section because
    // some of the values (CatalanConstant) reference some function names
    // (Add...) that are defined above. This avoid circular references.
    //
    ImaginaryUnit: {
      type: 'imaginary',
      isConstant: true,
      holdUntil: 'never',
      wikidata: 'Q193796',
      value: (engine) => engine.I,
    },

    // Alias of 'ImaginaryUnit'
    i: {
      type: 'imaginary',
      isConstant: true,
      holdUntil: 'never',
      value: (engine) => engine.I,
    },

    ExponentialE: {
      type: 'finite_real',
      wikidata: 'Q82435',
      isConstant: true,
      holdUntil: 'N',

      value: (engine) =>
        engine.number(
          bignumPreferred(engine) ? BigDecimal.ONE.exp() : Math.exp(1)
        ),
    },

    e: {
      type: 'finite_real',
      isConstant: true,
      holdUntil: 'never',
      value: 'ExponentialE',
    },

    ComplexInfinity: {
      type: 'complex',
      isConstant: true,
      holdUntil: 'never',
      value: (engine) => engine.ComplexInfinity,
    },

    PositiveInfinity: {
      type: 'non_finite_number',
      isConstant: true,
      holdUntil: 'never',
      value: +Infinity,
    },

    NegativeInfinity: {
      type: 'non_finite_number',
      isConstant: true,
      holdUntil: 'never',
      value: -Infinity,
    },

    NaN: {
      type: 'number',
      isConstant: true,
      holdUntil: 'never',
      value: (engine) => engine.NaN,
    },

    ContinuationPlaceholder: {
      description:
        'This symbol indicates that some elements in a collection have been omitted, for example in a long list of numbers, or in an infinite set',
      type: 'unknown',
      isConstant: true,
    },

    MachineEpsilon: {
      /**
       * The difference between 1 and the next larger floating point number
       *
       *    2^{−52}
       *
       * See https://en.wikipedia.org/wiki/Machine_epsilon
       */
      type: 'finite_real',
      holdUntil: 'N',
      isConstant: true,
      value: { num: Number.EPSILON.toString() },
    },
    Half: {
      type: 'finite_rational',
      isConstant: true,
      holdUntil: 'never',
      value: ['Rational', 1, 2],
    },
    GoldenRatio: {
      type: 'finite_real', // Golden ratio is an algebraic number
      wikidata: 'Q41690',
      isConstant: true,
      holdUntil: 'N',
      value: ['Divide', ['Add', 1, ['Sqrt', 5]], 2],
    },
    CatalanConstant: {
      type: 'finite_real',
      wikidata: 'Q855282',
      isConstant: true,
      holdUntil: 'N',
      value: {
        // From http://www.fullbooks.com/Miscellaneous-Mathematical-Constants1.html
        num: `0.91596559417721901505460351493238411077414937428167
                  21342664981196217630197762547694793565129261151062
                  48574422619196199579035898803325859059431594737481
                  15840699533202877331946051903872747816408786590902
                  47064841521630002287276409423882599577415088163974
                  70252482011560707644883807873370489900864775113225
                  99713434074854075532307685653357680958352602193823
                  23950800720680355761048235733942319149829836189977
                  06903640418086217941101917532743149978233976105512
                  24779530324875371878665828082360570225594194818097
                  53509711315712615804242723636439850017382875977976
                  53068370092980873887495610893659771940968726844441
                  66804621624339864838916280448281506273022742073884
                  31172218272190472255870531908685735423498539498309
                  91911596738846450861515249962423704374517773723517
                  75440708538464401321748392999947572446199754961975
                  87064007474870701490937678873045869979860644874974
                  64387206238513712392736304998503539223928787979063
                  36440323547845358519277777872709060830319943013323
                  16712476158709792455479119092126201854803963934243
                  `,
      },
    },
    EulerGamma: {
      type: 'finite_real',
      wikidata: 'Q273023',
      holdUntil: 'N',
      isConstant: true,
      // γ is computed on demand to the engine's working precision via the
      // Brent–McMillan algorithm (`BigDecimal.EULER_GAMMA`). The prior
      // hardcoded ~858-digit literal capped γ-dependent results at higher
      // precision (ROADMAP B12). Machine mode uses the double value.
      value: (engine) =>
        engine.number(
          bignumPreferred(engine)
            ? BigDecimal.EULER_GAMMA
            : 0.5772156649015328606
        ),
    },
  },

  {
    PreIncrement: {
      description: 'Increment a number by one.',
      signature: '(number) -> number',
    },
    PreDecrement: {
      description: 'Decrement a number by one.',
      signature: '(number) -> number',
    },
  },

  //
  // Property predicates
  //

  {
    IsPrime: {
      description: '`IsPrime(n)` returns `True` if `n` is a prime number',
      wikidata: 'Q49008',
      complexity: 1200,
      broadcastable: true,
      signature: '(number) -> boolean',
      evaluate: ([n], { engine }) => {
        const result = isPrime(n);
        if (result === undefined) return undefined;
        return engine.symbol(result ? 'True' : 'False');
      },
    },
    IsComposite: {
      description:
        '`IsComposite(n)` returns `True` if `n` is not a prime number',
      complexity: 1200,
      broadcastable: true,
      signature: '(number) -> boolean',
      canonical: (ops, { engine }) => engine.expr(['Not', ['IsPrime', ...ops]]),
    },

    IsOdd: {
      description: '`IsOdd(n)` returns `True` if `n` is an odd number',
      complexity: 1200,
      broadcastable: true,
      signature: '(number) -> boolean',
      evaluate: (ops, { engine }) => {
        let fail = false;
        const result = ops.every((op) => {
          if (op.im !== 0) return false;

          const b = asBigint(op);
          if (b !== null) return b % BigInt(2) !== BigInt(0);

          const n = op.re;
          if (Number.isInteger(n)) return n % 2 !== 0;

          fail = true;
          return false;
        });
        if (fail) return undefined;
        return engine.symbol(result ? 'True' : 'False');
      },
    },
    IsEven: {
      description: 'Even Number',
      complexity: 1200,
      broadcastable: true,
      signature: '(number) -> boolean',
      canonical: (ops, { engine }) => engine.expr(['Not', ['IsOdd', ...ops]]),
    },
    // @todo: Divisor:
  },
  {
    GCD: {
      description: 'Greatest Common Divisor',
      complexity: 1200,
      broadcastable: false, // The function take a variable number of arguments,
      // including collections
      signature: '(any*) -> number',
      // Integer operands → a positive integer; polynomial operands → a
      // (monic) polynomial whose type and sign aren't known statically.
      type: (ops) =>
        ops.every((x) => x.isInteger) ? 'finite_integer' : 'number',
      sgn: (ops) => (ops.every((x) => x.isInteger) ? 'positive' : undefined),
      evaluate: (xs) => {
        // Integer operands take the fast numeric path. Otherwise, attempt a
        // univariate polynomial GCD (e.g. GCD(x²+3x+2, x²+4x+3) → x+1),
        // falling back to the numeric path — which folds any integer operands
        // and leaves the rest as an unevaluated GCD.
        if (!xs.every((x) => x.isInteger)) {
          const poly = polynomialGCDMulti(xs);
          if (poly !== undefined) return poly;
        }
        return evaluateGcdLcm(xs, 'GCD');
      },
    },
    LCM: {
      description: 'Least Common Multiple',
      complexity: 1200,
      broadcastable: false, // The function take a variable number of arguments,
      // including collections
      signature: '(any*) -> integer',
      type: () => 'finite_integer',
      sgn: () => 'positive',
      evaluate: (xs) => evaluateGcdLcm(xs, 'LCM'),
    },

    Numerator: {
      description: 'Numerator of an expression',
      complexity: 1200,
      broadcastable: true,

      lazy: true,
      signature: '(number) -> number | nothing',
      canonical: (ops, { engine }) => {
        // **IMPORTANT**: We want Numerator to work on non-canonical
        // expressions, so that you can determine if a user input is
        // reducible, for example.
        if (ops.length === 0) return engine.Nothing;
        const op = ops[0];
        if (
          (op.operator === 'Rational' || op.operator === 'Divide') &&
          isFunction(op)
        )
          return op.op1;
        return engine._fn('Numerator', canonical(engine, ops));
      },
      sgn: ([x]) => x.sgn,
      evaluate: (ops, { engine }) => {
        const ce = engine;
        if (ops.length === 0) return ce.Nothing;
        const op = ops[0];
        if (
          (op.operator === 'Rational' || op.operator === 'Divide') &&
          isFunction(op)
        )
          return op.op1.evaluate();
        return op.numerator;
      },
    },

    Denominator: {
      description: 'Denominator of an expression',
      complexity: 1200,
      broadcastable: true,

      lazy: true,
      signature: '(number) -> number | nothing',
      canonical: (ops, { engine }) => {
        // **IMPORTANT**: We want Denominator to work on non-canonical
        // expressions, so that you can determine if a user input is
        // reductible, for example.
        if (ops.length === 0) return engine.Nothing;
        const op = ops[0];
        if (
          (op.operator === 'Rational' || op.operator === 'Divide') &&
          isFunction(op)
        )
          return op.op2;
        const num = asRational(op);
        if (num !== undefined) return engine.number(num[1]);
        return engine._fn('Denominator', canonical(engine, ops));
      },
      sgn: () => 'positive',
      evaluate: (ops, { engine }) => {
        const ce = engine;
        if (ops.length === 0) return ce.Nothing;
        const op = ops[0];
        if (
          (op.operator === 'Rational' || op.operator === 'Divide') &&
          isFunction(op)
        )
          return op.op2.evaluate();
        return op.denominator;
      },
    },

    NumeratorDenominator: {
      description: 'Sequence of Numerator and Denominator of an expression',
      complexity: 1200,
      broadcastable: true,

      lazy: true,
      signature: '(number) -> tuple<number, number> | nothing',
      canonical: (ops, { engine }) => {
        // **IMPORTANT**: We want NumeratorDenominator to work on non-canonical
        // expressions, so that you can determine if a user input is
        // reductible, for example.
        if (ops.length === 0) return engine.Nothing;
        const op = ops[0];
        if (
          (op.operator === 'Rational' || op.operator === 'Divide') &&
          isFunction(op)
        )
          return engine.tuple(...op.ops);
        const num = asRational(op.evaluate());
        if (num !== undefined)
          return engine.tuple(engine.number(num[0]), engine.number(num[1]));
        return engine._fn(
          'NumeratorDenominator',
          ops.map((x) => x.evaluate())
        );
      },

      evaluate: (ops, { engine }) => {
        const ce = engine;
        if (ops.length === 0) return ce.Nothing;
        const op = ops[0];
        if (
          (op.operator === 'Rational' || op.operator === 'Divide') &&
          isFunction(op)
        )
          return ce.tuple(...op.ops);

        return ce.tuple(...op.numeratorDenominator);
      },
    },
  },

  //
  // Arithmetic on collections: Min, Max, Sum, Product
  //
  {
    Max: {
      description: 'Maximum of two or more numbers',
      complexity: 1200,
      broadcastable: false, // The function take a variable number of arguments,
      // including collections
      signature: '(value*) -> number | list',
      sgn: (ops) => {
        if (ops.some((x) => x.isReal == false || x.isNaN)) return 'unsigned';
        if (ops.some((x) => x.isReal == false || x.isNaN !== false))
          return undefined;
        if (ops.some((x) => x.isPositive)) return 'positive';
        if (ops.every((x) => x.isNonPositive))
          return ops.some((x) => x.isSame(0)) ? 'zero' : 'non-positive';
        if (ops.some((x) => x.isNonNegative)) return 'non-negative';
        if (ops.every((x) => x.isNegative)) return 'negative';
        if (ops.some((x) => !x.isSame(0))) return 'not-zero';
        return undefined;
      },
      evaluate: (xs, { engine }) => evaluateMinMax(engine, xs, 'Max'),
    },

    Min: {
      description: 'Minimum of two or more numbers',
      complexity: 1200,
      broadcastable: false, // The function take a variable number of arguments,
      // including collections
      signature: '(value+) -> number | list',
      sgn: (ops) => {
        if (ops.some((x) => x.isReal == false || x.isNaN)) return 'unsigned';
        if (ops.some((x) => x.isReal == false || x.isNaN !== false))
          return undefined;
        if (ops.some((x) => x.isNegative)) return 'negative';
        if (ops.every((x) => x.isNonNegative))
          return ops.some((x) => x.isSame(0)) ? 'zero' : 'non-negative';
        if (ops.some((x) => x.isNonPositive)) return 'non-positive';
        if (ops.every((x) => x.isPositive)) return 'positive';
        return undefined;
      },
      evaluate: (xs, { engine }) => evaluateMinMax(engine, xs, 'Min'),
    },

    Supremum: {
      description: 'Like Max, but defined for open sets',
      complexity: 1200,
      broadcastable: false, // The function take a variable number of arguments,
      // including collections

      signature: '(value*) -> number | list',
      evaluate: (xs, { engine }) => evaluateMinMax(engine, xs, 'Supremum'),
    },

    Infimum: {
      description: 'Like Min, but defined for open sets',
      complexity: 1200,
      broadcastable: false, // The function take a variable number of arguments,
      // including collections

      signature: '(value*) -> number | list',
      evaluate: (xs, { engine }) => evaluateMinMax(engine, xs, 'Infimum'),
    },

    Distance: {
      description: 'Euclidean distance between two points (tuples of numbers).',
      complexity: 6000,
      signature: '(tuple, tuple) -> number',
      evaluate: ([a, b], { engine: ce, numericApproximation }) => {
        if (!isFunction(a) || !isFunction(b))
          return ce.error('incompatible-type');
        if (a.operator !== 'Tuple' || b.operator !== 'Tuple')
          return ce.error('incompatible-type');
        if (a.ops!.length !== b.ops!.length || a.ops!.length === 0)
          return ce.error('incompatible-type');
        // Build √(Σ (aᵢ − bᵢ)²) as an expression and evaluate it once, so the
        // exact path is honored (`Distance((0,0),(1,1)) → √2`, not the machine
        // float) — mirroring `Hypot`. `.N()` still numericizes.
        const terms: Expression[] = [];
        for (let i = 0; i < a.ops!.length; i++) {
          const ai = a.ops![i];
          const bi = b.ops![i];
          if (
            !isNumber(ai) ||
            !isNumber(bi) ||
            ai.isFinite === false ||
            bi.isFinite === false
          )
            return ce.error('expected-value');
          terms.push(
            ce.function('Power', [
              ce.function('Subtract', [ai, bi]),
              ce.number(2),
            ])
          );
        }
        return ce
          .function('Sqrt', [ce.function('Add', terms)])
          .evaluate({ numericApproximation });
      },
    },

    Product: {
      description:
        '`Product(f, a, b)` computes the product of `f` from `a` to `b`',
      wikidata: 'Q901718',
      complexity: 1000,
      broadcastable: false,

      scoped: true,
      lazy: true,
      signature:
        '((number+) -> number, (tuple<integer>|tuple<integer, integer>)+) -> number',

      canonical: ([body, ...bounds], { scope }) =>
        canonicalBigop('Product', body, bounds, scope),

      evaluate: (ops, options) => {
        const ce = options.engine;
        // EL-4: see the matching comment in `Sum.evaluate` — an infinite
        // (capped) domain is accumulated numerically; a symbolic body over one
        // stays symbolic.
        let numeric = options.numericApproximation;
        if (!numeric) {
          const mode = classifyBigopDomain(ops[0], ops.slice(1), ce);
          if (mode === 'symbolic') return undefined;
          if (mode === 'numeric') numeric = true;
        }
        const result = run(
          reduceBigOp(
            ops[0],
            ops.slice(1),
            (acc: Expression, x) => {
              const xe = x.evaluate({ numericApproximation: numeric });
              return reducerElementError(acc, xe) ?? acc.mul(xe);
            },
            ce.One
          ),
          ce._timeRemaining
        );
        // If domain is non-enumerable, keep expression unevaluated (symbolic)
        if (result === NON_ENUMERABLE_DOMAIN) {
          return undefined; // Return undefined to keep expression symbolic
        }
        // Evaluate the accumulated result to combine numeric factors
        return result?.evaluate({ numericApproximation: numeric }) ?? ce.NaN;
      },

      evaluateAsync: async (ops, options) => {
        const ce = options.engine;
        let numeric = options.numericApproximation;
        if (!numeric) {
          const mode = classifyBigopDomain(ops[0], ops.slice(1), ce);
          if (mode === 'symbolic') return undefined;
          if (mode === 'numeric') numeric = true;
        }
        const result = await runAsync(
          reduceBigOp(
            ops[0],
            ops.slice(1),
            (acc: Expression, x) => {
              const xe = x.evaluate({ numericApproximation: numeric });
              return reducerElementError(acc, xe) ?? acc.mul(xe);
            },
            ce.One
          ),
          ce._timeRemaining,
          options.signal
        );
        // If domain is non-enumerable, keep expression unevaluated (symbolic)
        if (result === NON_ENUMERABLE_DOMAIN) {
          return undefined; // Return undefined to keep expression symbolic
        }
        return result?.evaluate({ numericApproximation: numeric }) ?? ce.NaN;
      },
    },

    Sum: {
      description:
        '`Sum(f, [a, b])` computes the sum of `f` from `a` to `b`; `Sum(L)` sums the elements of a collection `L`',
      wikidata: 'Q218005',
      complexity: 1000,
      broadcastable: false,

      scoped: true,
      lazy: true,
      signature: '(any, tuple*) -> number',

      canonical: ([body, ...bounds], { scope, engine: ce }) => {
        // Arity-1 collection-reducer form: bypass canonicalBigop, which would
        // rewrite Sum(L) as Reduce(L, 'Add', 0). Keeping the `Sum` head lets
        // dot-notation serialization (`L.total`) round-trip.
        if (bounds.length === 0) {
          const canon = body?.canonical;
          if (canon?.isCollection) return ce._fn('Sum', [canon]);
        }
        return canonicalBigop('Sum', body, bounds, scope);
      },

      evaluate: ([first, ...rest], { engine, numericApproximation }) => {
        // Arity-1 collection-reducer form: Sum(L).
        if (rest.length === 0 && first?.isCollection) {
          // Non-finite collections stay symbolic — infinite iteration would
          // hang the thread and bypass `engine._timeRemaining`.
          if (first.isFiniteCollection !== true) return undefined;
          const result = run(
            reduceCollection(first, engine.Zero, (acc, x) =>
              sumAccumulate(
                acc,
                x.evaluate({ numericApproximation }),
                numericApproximation
              )
            ),
            engine._timeRemaining
          );
          return result?.evaluate({ numericApproximation }) ?? engine.NaN;
        }

        // Big-op form: Sum(body, [i, a, b], …).
        // EL-4: an infinite (capped) domain is a truncated approximation, so
        // accumulate it numerically rather than building an intractable exact
        // rational; a symbolic body over such a domain stays symbolic.
        let numeric = numericApproximation;
        if (!numeric) {
          const mode = classifyBigopDomain(first, rest, engine);
          if (mode === 'symbolic') return undefined;
          if (mode === 'numeric') numeric = true;
        }
        const result = run(
          reduceBigOp(
            first,
            rest,
            (acc: Expression, x) =>
              sumAccumulate(
                acc,
                x.evaluate({ numericApproximation: numeric }),
                numeric
              ),
            engine.Zero
          ),
          engine._timeRemaining
        );
        // Non-enumerable domain: keep the expression symbolic.
        if (result === NON_ENUMERABLE_DOMAIN) return undefined;
        // Re-evaluate to combine numeric terms (e.g., 3x + 1 + 2 + 3 → 3x + 6).
        return (
          result?.evaluate({ numericApproximation: numeric }) ?? engine.NaN
        );
      },

      evaluateAsync: async (
        [first, ...rest],
        { engine, signal, numericApproximation }
      ) => {
        // Arity-1 collection-reducer form: Sum(L).
        if (rest.length === 0 && first?.isCollection) {
          if (first.isFiniteCollection !== true) return undefined;
          const result = await runAsync(
            reduceCollection(first, engine.Zero, (acc, x) =>
              sumAccumulate(
                acc,
                x.evaluate({ numericApproximation }),
                numericApproximation
              )
            ),
            engine._timeRemaining,
            signal
          );
          return result?.evaluate({ numericApproximation }) ?? engine.NaN;
        }

        let numeric = numericApproximation;
        if (!numeric) {
          const mode = classifyBigopDomain(first, rest, engine);
          if (mode === 'symbolic') return undefined;
          if (mode === 'numeric') numeric = true;
        }
        const result = await runAsync(
          reduceBigOp(
            first,
            rest,
            (acc: Expression, x) =>
              sumAccumulate(
                acc,
                x.evaluate({ numericApproximation: numeric }),
                numeric
              ),
            engine.Zero
          ),
          engine._timeRemaining,
          signal
        );
        if (result === NON_ENUMERABLE_DOMAIN) return undefined;
        return (
          result?.evaluate({ numericApproximation: numeric }) ?? engine.NaN
        );
      },
    },
  },
];

/**
 * Exact Beta reduction when one argument is a positive integer `m`:
 *   B(a, m) = (m−1)! / (a (a+1) … (a+m−1))
 * This is an exact rational function of `a`, valid at every `a`. It returns
 * `ComplexInfinity` at a Γ-pole (a factor of the denominator is exactly 0,
 * i.e. `a ∈ {0, −1, …, −(m−1)}`), the exact rational otherwise, or `undefined`
 * when `m` is too large to expand exactly (the numeric kernel handles those).
 */
function betaPositiveIntegerArg(
  ce: ComputeEngine,
  a: Expression,
  m: number
): Expression | undefined {
  if (m > 100) return undefined;
  let denom = ce.One;
  for (let k = 0; k < m; k++) {
    const factor = a.add(k);
    if (factor.isSame(0)) return ce.ComplexInfinity;
    denom = denom.mul(factor);
  }
  let numer = 1n;
  for (let k = 2; k < m; k++) numer *= BigInt(k);
  return ce.number(numer).div(denom);
}

/**
 * Guard for `Sum`/`Product` accumulation over a collection: an already-failed
 * accumulator propagates, and a non-numeric (string) element is rejected with
 * an `incompatible-type` error rather than silently poisoning the result
 * (`Sum([a, b])` used to fold to `NaN`). Returns the error to short-circuit
 * with, or `undefined` to accumulate normally. Keeps `Sum` and `Product`
 * consistent (both surface the same typed error on a string element).
 */
function reducerElementError(
  acc: Expression,
  term: Expression
): Expression | undefined {
  if (acc.operator === 'Error') return acc;
  if (isString(term)) return acc.engine.typeError('number', term.type);
  return undefined;
}

/** Accumulate one term of a `Sum` without the `.add()` float-folding pitfall.
 *
 * The `.add()` **method** folds two exact-but-non-combinable number literals
 * (e.g. `1 + √2`, `2 + √3`) into a machine float. For `Sum().evaluate()` we
 * want to preserve exactness, so when both operands are exact literals whose
 * sum is *not* exact we build a symbolic `Add` instead. A canonical `Add` still
 * folds combinable exact operands (integers, rationals, like radicals), so a
 * numeric sum such as `Sum(k, 1..n)` keeps the accumulator to a single literal
 * (O(1) memory) while `Sum(√k, 1..5)` stays exact (`3 + √2 + √3 + √5`).
 *
 * Under `numericApproximation` (i.e. `.N()`), folding to a float is the desired
 * behavior and no symbolic accumulation is done.
 */
function sumAccumulate(
  acc: Expression,
  term: Expression,
  numericApproximation: boolean | undefined
): Expression {
  const err = reducerElementError(acc, term);
  if (err) return err;
  const sum = acc.add(term);
  if (numericApproximation) return sum;
  // Only two exact number literals can be silently floated by `.add()`. Once
  // `acc` is a symbolic `Add`, `.add()` already keeps the result symbolic.
  if (
    isNumber(acc) &&
    acc.isExact &&
    isNumber(term) &&
    term.isExact &&
    isNumber(sum) &&
    !sum.isExact
  )
    return acc.engine.function('Add', [acc, term]);
  return sum;
}

/** Generator-based reducer over a finite collection. Yields between
 * iterations so callers can wrap it with `run`/`runAsync` for timeout
 * and cancellation. Caller is responsible for finiteness checks.
 */
function* reduceCollection(
  collection: Expression,
  init: Expression,
  combine: (acc: Expression, x: Expression) => Expression
): Generator<Expression, Expression> {
  let acc = init;
  for (const x of collection.each()) {
    acc = combine(acc, x);
    yield acc;
  }
  return acc;
}

function evaluateAbs(
  arg: Expression,
  numericApproximation?: boolean
): Expression | undefined {
  const ce = arg.engine;
  if (isNumber(arg)) {
    const num = arg.numericValue;
    if (typeof num === 'number') return ce.number(Math.abs(num));
    // Exact modulus of a Gaussian (integer) complex number:
    // |a+bi| = √(a²+b²), built exactly (`|1+i| → √2`) instead of the machine
    // hypot float. `Abs(3+4i)` already gave 5 because 25 is a perfect square;
    // this extends the exact path to every integer a, b. `.N()` numericizes.
    if (num.im !== 0) {
      const re = num.re;
      const im = num.im;
      const s = re * re + im * im;
      if (
        Number.isInteger(re) &&
        Number.isInteger(im) &&
        Number.isSafeInteger(s)
      )
        return ce
          .function('Sqrt', [ce.number(s)])
          .evaluate({ numericApproximation });
    }
    return ce.number(num.abs());
  }
  if (arg.isNonNegative) return arg;
  if (arg.isNegative) return arg.neg();
  return undefined;
}

function processMinMaxItem(
  item: Expression,
  mode: 'Min' | 'Max' | 'Supremum' | 'Infimum'
): [Expression | undefined, ReadonlyArray<Expression>] {
  const ce = item.engine;
  const upper = mode === 'Max' || mode === 'Supremum';

  // An interval is continuous
  if (isFunction(item, 'Interval')) {
    const b = upper ? item.op2 : item.op1;

    if (!b.isNumber || !isNumber(b)) return [undefined, [item]];
    return [b, []];
  }

  // A range is discrete, the last element may not be included
  if (item.operator === 'Range') {
    if (upper) {
      const r = range(item);
      const last = rangeLast(r);
      return [ce.number(Math.max(r[0], last)), []];
    } else {
      return [ce.number(range(item)[0]), []];
    }
  }

  if (isFunction(item, 'Linspace')) {
    if (item.nops === 1) item = upper ? item.op1 : ce.One;
    else if (upper) item = item.op2;
    else item = item.op1;
    return [item, []];
  }

  if (item.isCollection) {
    let result: Expression | undefined = undefined;
    const rest: Expression[] = [];
    for (const op of item.each()) {
      const [val, others] = processMinMaxItem(op, mode);
      if (val) {
        // A non-real (complex) value is unordered: keep it symbolic rather
        // than silently absorbing it in an order-dependent way.
        if (val.im !== 0) rest.push(val);
        else if (!result) result = val;
        else {
          if (
            (upper && val.isGreater(result)) ||
            (!upper && val.isLess(result))
          )
            result = val;
        }
      }
      rest.push(...others);
    }
    return [result, rest];
  }

  if (!item.isNumber || !isNumber(item)) return [undefined, [item]];
  return [item, []];
}

function evaluateMinMax(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>,
  mode: 'Min' | 'Max' | 'Supremum' | 'Infimum'
): Expression {
  const upper = mode === 'Max' || mode === 'Supremum';

  ops = flatten(ops);

  if (ops.length === 0)
    return upper ? ce.NegativeInfinity : ce.PositiveInfinity;

  let result: Expression | undefined = undefined;
  const rest: Expression[] = [];

  for (const op of ops) {
    const [val, others] = processMinMaxItem(op, mode);
    if (val) {
      // NaN absorbs: Min/Max of an indeterminate value is indeterminate.
      // (Comparisons with NaN are themselves indeterminate, so without this
      // guard a NaN operand would be silently dropped.)
      if (val.isNaN) return ce.NaN;
      // A non-real (complex) value is unordered. Ordering comparisons return
      // `undefined` for it, which previously left it silently absorbed in an
      // order-dependent way (Max(i, 2) = i but Max(2, i) = 2). Keep it symbolic
      // instead so both operand orders agree.
      if (val.im !== 0) rest.push(val);
      else if (!result) result = val;
      else {
        if ((upper && val.isGreater(result)) || (!upper && val.isLess(result)))
          result = val;
      }
    }
    rest.push(...others);
  }

  if (rest.length > 0)
    return ce.expr(result ? [mode, result, ...rest] : [mode, ...rest]);
  return result ?? (upper ? ce.NegativeInfinity : ce.PositiveInfinity);
}

function evaluateGcdLcm(
  ops: ReadonlyArray<Expression>,
  mode: 'LCM' | 'GCD'
): Expression {
  const ce = ops[0].engine;
  const fn = mode === 'LCM' ? lcm : gcd;
  const bigFn = mode === 'LCM' ? bigLcm : bigGcd;

  const rest: Expression[] = [];
  if (bignumPreferred(ce)) {
    let result: BigDecimal | null = null;
    for (const op of ops) {
      if (result === null) {
        // Seed the accumulator with the first integer operand; defer the rest.
        // GCD/LCM are non-negative, so seed with the magnitude.
        const d = asBignum(op);
        if (d !== null && d.isInteger()) result = d.abs();
        else rest.push(op);
      } else {
        const d = asBignum(op);
        if (d && d.isInteger()) result = bigFn(result, d);
        else rest.push(op);
      }
    }

    if (rest.length === 0) return result === null ? ce.One : ce.number(result);
    if (result === null) return ce._fn(mode, rest);
    return ce._fn(mode, [ce.number(result), ...rest]);
  }

  let result: number | null = null;
  for (const op of ops) {
    if (result === null) {
      // Seed the accumulator with the first integer operand; defer the rest.
      // GCD/LCM are non-negative, so seed with the magnitude.
      if (op.isInteger) result = Math.abs(op.re);
      else rest.push(op);
    } else {
      if (op.isInteger) result = fn(result, op.re);
      else rest.push(op);
    }
  }
  if (rest.length === 0) return result === null ? ce.One : ce.number(result);
  if (result === null) return ce._fn(mode, rest);
  return ce._fn(mode, [ce.number(result), ...rest]);
}

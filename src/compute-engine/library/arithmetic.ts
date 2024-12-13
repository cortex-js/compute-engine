import { Decimal } from 'decimal.js';

import type { IdentifierDefinitions, Sign } from '../public';

import {
  checkType,
  checkTypes,
  checkNumericArgs,
} from '../boxed-expression/validate';
import { IComputeEngine, BoxedExpression } from '../boxed-expression/public';
import { bignumPreferred, canonical } from '../boxed-expression/utils';
import {
  asSmallInteger,
  asRational,
  asBignum,
  asBigint,
} from '../boxed-expression/numerics';
import { addOrder } from '../boxed-expression/order';

import { apply, apply2 } from '../boxed-expression/apply';
import { flatten } from '../boxed-expression/flatten';

import {
  gamma as gammaComplex,
  gammaln as lngammaComplex,
} from '../numerics/numeric-complex';
import {
  factorial2 as bigFactorial2,
  gcd as bigGcd,
  lcm as bigLcm,
} from '../numerics/numeric-bignum';
import { factorial as bigFactorial } from '../numerics/numeric-bigint';
import {
  gamma,
  gammaln,
  bigGamma,
  bigGammaln,
} from '../numerics/special-functions';
import { factorial, factorial2, gcd, lcm } from '../numerics/numeric';
import { rationalize } from '../numerics/rationals';
import { isPrime as isPrimeMachine, isPrimeBigint } from '../numerics/primes';
import { fromDigits } from '../numerics/strings';

import { each } from '../collection-utils';

import {
  canonicalAdd,
  add,
  addType,
  addN,
} from '../boxed-expression/arithmetic-add';
import { mul, mulN } from '../boxed-expression/arithmetic-multiply';
import { canonicalDivide } from '../boxed-expression/arithmetic-divide';
import { canonicalBigop, reduceBigOp } from './utils';
import {
  canonicalPower,
  canonicalRoot,
  pow,
  root,
} from '../boxed-expression/arithmetic-power';
import { parseType } from '../../common/type/parse';
import { isSubtype } from '../../common/type/subtype';
import { range, rangeLast } from './collections';
import { typeToString } from '../../common/type/serialize';
import { run, runAsync } from '../../common/interruptible';

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
function lnSign(x: BoxedExpression): Sign | undefined {
  if (x.isGreater(1)) return 'positive';
  if (x.isGreaterEqual(1)) return 'non-negative';
  if (x.isLessEqual(1) && x.isGreaterEqual(0)) return 'non-positive';
  if (x.isLess(1) && x.isGreaterEqual(0)) return 'negative';
  if (x.is(1)) return 'zero';
  if (x.isNegative || x.isReal === false) return 'unsigned';
  return undefined;
}

export const ARITHMETIC_LIBRARY: IdentifierDefinitions[] = [
  {
    //
    // Functions
    //
    Abs: {
      wikidata: 'Q3317982', // magnitude 'Q120812 (for reals)
      threadable: true,
      idempotent: true,
      complexity: 1200,
      signature: 'number -> number',

      type: ([x]) => x.type,
      sgn: ([x]) => {
        if (x.is(0)) return 'zero';
        return x.isNumberLiteral ? 'positive' : 'non-negative';
      },
      evaluate: ([x]) => evaluateAbs(x),
    },

    Add: {
      wikidata: 'Q32043',
      associative: true,
      commutative: true,
      commutativeOrder: addOrder,
      threadable: true,
      idempotent: true,
      complexity: 1300,

      lazy: true,

      signature: '(number, ...number) -> number',
      type: addType,

      sgn: (ops) => {
        if (ops.some((x) => x.isReal === false || x.isNaN)) return 'unsigned';
        if (ops.every((x) => x.is(0))) return 'zero';
        if (ops.every((x) => x.isNonNegative))
          return ops.some((x) => x.isPositive) ? 'positive' : 'non-negative';
        if (ops.every((x) => x.isNonPositive))
          return ops.some((x) => x.isNegative) ? 'negative' : 'non-positive';
        if (ops.every((x) => x.isReal)) return 'real';
        return undefined;
      },

      // @fastpath: canonicalization is done in the function
      // makeNumericFunction().
      evaluate: (ops, { numericApproximation }) =>
        // Do not evaluate in the case of numericApproximation
        // to avoid premature rounding errors.
        // For example: `\\frac{2}{3}+\\frac{12345678912345678}{987654321987654321}+\\frac{987654321987654321}{12345678912345678}`
        numericApproximation
          ? addN(...ops)
          : add(...ops.map((x) => x.evaluate())),
    },

    Ceil: {
      description: 'Rounds a number up to the next largest integer',
      complexity: 1250,
      threadable: true,
      signature: 'real -> integer',
      sgn: ([x]) => {
        if (x.isLessEqual(-1)) return 'negative';
        if (x.isPositive) return 'positive';
        if (x.isNonNegative) return 'non-negative';
        if (x.isNonPositive && x.isGreater(-1)) return 'zero';
        if (x.isNonPositive) return 'non-positive';
        if (x.isReal == false && x.isNumberLiteral)
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
      associative: true,
      threadable: true,
      idempotent: true,
      complexity: 1200,

      signature: 'number -> number',
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

    // Complex: {
    //   // This function is converted during boxing, so unlikely to encounter
    //   wikidata: 'Q11567',
    //   complexity: 500,
    // },

    Divide: {
      wikidata: 'Q1226939',
      complexity: 2500,
      threadable: true,

      // - if numer product of numbers, or denom product of numbers,
      // i.e. √2x/2 -> 0.707x, 2/√2x -> 1.4142x
      signature: '(number, ...number) -> number',
      type: ([num, den]) => {
        if (den.is(1)) return num.type;
        if (den.isFinite === false || num.isFinite === false)
          return 'non_finite_number';
        if (den.isInteger && num.isInteger) return 'finite_rational';
        if (den.isReal && num.isReal) return 'finite_real';
        return 'finite_number';
      },

      sgn: (ops) => {
        const [n, d] = [ops[0], ops[1]];
        if (d.is(0)) return 'unsigned';
        if (d.is(0) === false && n.is(0)) return 'zero';
        if (d.isPositive) return n.sgn;
        if (d.isNegative) return oppositeSgn(n.sgn);
        if (n.is(0) || (n.isFinite && d.isInfinity)) return 'zero';
        if (!n.is(0) && !d.is(0)) return 'not-zero';
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
      evaluate: ([num, den]) => num.div(den),
    },

    Exp: {
      wikidata: 'Q168698',
      threadable: true,
      complexity: 3500,

      signature: 'number -> number',
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

    Factorial: {
      description:
        'Factorial function: the product of all positive integers less than or equal to n',
      wikidata: 'Q120976',
      threadable: true,
      complexity: 9000,

      signature: 'integer -> integer',

      // Assumes that the inside of the factorial is an integer
      sgn: ([x]) =>
        x.isNonNegative
          ? 'positive'
          : x.isNegative || x.isReal === false
            ? 'unsigned'
            : undefined,
      canonical: (args, { engine }) => {
        const x = args[0];
        // We assume that -3! is -(3!) = -6
        if (x.isNumberLiteral && x.isNegative)
          return engine._fn('Factorial', [x.neg()]).neg();
        return engine._fn('Factorial', [x]);
      },
      evaluate: ([x]) => {
        const ce = x.engine;

        // Is the argument a complex number?
        if (x.im !== 0 && x.im !== undefined)
          return ce.number(gammaComplex(ce.complex(x.re, x.im).add(1)));

        // The argument is real...
        if (!x.isFinite) return undefined;

        // Not a positive integer, use the Gamma function
        if (x.isNegative) return ce.number(gamma(1 + x.re));

        return ce.number(
          run(
            bigFactorial(BigInt((x.bignumRe ?? x.re).toFixed())),
            ce._timeRemaining
          )
        );
      },
      evaluateAsync: async ([x], { signal }) => {
        const ce = x.engine;

        // Is the argument a complex number?
        if (x.im !== 0 && x.im !== undefined)
          return ce.number(gammaComplex(ce.complex(x.re, x.im).add(1)));

        // The argument is real...
        if (!x.isFinite) return undefined;

        // Not a positive integer, use the Gamma function
        if (x.isNegative) return ce.number(gamma(1 + x.re));

        return ce.number(
          await runAsync(
            bigFactorial(BigInt((x.bignumRe ?? x.re).toFixed())),
            (ce._deadline ?? Infinity) - Date.now(),
            signal
          )
        );
      },
    },

    Factorial2: {
      description: 'Double Factorial Function',
      complexity: 9000,
      threadable: true,

      signature: 'integer -> integer',
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
        const n = asSmallInteger(x);
        if (n === null) return undefined;
        const ce = x.engine;
        if (bignumPreferred(ce))
          return ce.number(bigFactorial2(ce, ce.bignum(n)));

        return ce.number(factorial2(n));
      },
    },

    Floor: {
      wikidata: 'Q56860783',
      complexity: 1250,
      threadable: true,

      signature: 'number -> integer',
      sgn: ([x]) => {
        if (x.isNegative) return 'negative';
        if (x.isGreaterEqual(1)) return 'positive';
        if (x.isNonNegative && x.isLess(1)) return 'zero';
        if (x.isNonNegative) return 'non-negative';
        if (x.isReal == false && x.isNumberLiteral)
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

    Gamma: {
      wikidata: 'Q190573',
      complexity: 8000,
      threadable: true,
      signature: 'number -> number',

      sgn: ([x]) => (x.isPositive ? 'positive' : x.is(0) ? 'zero' : undefined),
      evaluate: ([x], { numericApproximation, engine }) =>
        numericApproximation
          ? apply(
              x,
              (x) => gamma(x),
              (x) => bigGamma(engine, x),
              (x) => gammaComplex(x)
            )
          : undefined,
    },

    GammaLn: {
      complexity: 8000,
      threadable: true,
      signature: 'number -> number',

      evaluate: (ops, { numericApproximation, engine }) =>
        numericApproximation
          ? apply(
              ops[0],
              (x) => gammaln(x),
              (x) => bigGammaln(engine, x),
              (x) => lngammaComplex(x)
            )
          : undefined,
    },

    Ln: {
      description: 'Natural Logarithm',
      wikidata: 'Q204037',
      complexity: 4000,
      threadable: true,

      signature: '(number, base: number?) -> number',
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
              : !x.isNeg()
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
      threadable: true,

      signature: '(number, base: number?) -> number',

      sgn: ([x, base]) => {
        if (!base) return lnSign(x);
        if (base.is(1) || base.isReal == false) return 'unsigned';
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
                : !x.isNeg()
                  ? Decimal.log10(x)
                  : ce.complex(x.toNumber()).log().div(Math.LN10),
            (z) => (z.isZero() ? NaN : z.log().div(Math.LN10))
          );
        return apply2(
          ops[0],
          ops[1],
          (z, b) => Math.log(z) / Math.log(b),
          (z, b) => z.log(b),
          (z, b) => z.log().div(typeof b === 'number' ? Math.log(b) : b.log())
        );
      },
    },

    Lb: {
      description: 'Base-2 Logarithm',
      wikidata: 'Q581168',
      complexity: 4100,
      threadable: true,

      signature: '(number, base: number?) -> number',
      sgn: ([x]) => lnSign(x),
      canonical: ([x], { engine }) => engine._fn('Log', [x, engine.number(2)]),
    },

    Lg: {
      description: 'Base-10 Logarithm',
      wikidata: 'Q966582',
      complexity: 4100,
      threadable: true,
      signature: 'number -> number',
      sgn: ([x]) => lnSign(x),
      canonical: ([x], { engine }) => engine._fn('Log', [x]),
    },

    Mod: {
      description: 'Modulo',
      wikidata: 'Q1799665',
      complexity: 2500,
      threadable: true,

      signature: '(number, number) -> number',
      sgn: (ops) => {
        const n = ops[1]; //base of Mod
        if (n === undefined || n.isReal == false) return undefined;
        if (n.is(0)) return 'unsigned';
        if (ops[0].isNumberLiteral && n.isNumberLiteral) {
          const v = apply2(
            ops[0],
            n,
            // In JavaScript, the % is remainder, not modulo
            // so adapt it to return a modulo
            (a, b) => ((a % b) + b) % b,
            (a, b) => a.modulo(b)
          );
          return v?.sgn ?? undefined;
        }
        return undefined;
      },
      evaluate: ([a, b]) =>
        apply2(
          a,
          b,
          // In JavaScript, the % is remainder, not modulo
          // so adapt it to return a modulo
          (a, b) => ((a % b) + b) % b,
          (a, b) => a.modulo(b)
        ),
    },

    Multiply: {
      wikidata: 'Q40276',
      associative: true,
      commutative: true,
      idempotent: true,
      complexity: 2100,
      threadable: true,

      lazy: true,
      signature: '(number, ...number) -> number',
      type: (ops) => {
        if (ops.length === 0) return 'finite_integer'; // = 1
        if (ops.length === 1) return ops[0].type;
        if (ops.some((x) => x.isFinite === false)) return 'non_finite_number';
        if (ops.every((x) => x.isInteger)) return 'finite_integer';
        if (ops.every((x) => x.isReal)) return 'finite_real';
        if (ops.every((x) => x.isRational)) return 'finite_rational';
        return 'finite_number';
      },
      // @fastpath: canonicalization is done in the function
      // makeNumericFunction().
      //
      sgn: (ops) => {
        if (ops.some((x) => x.sgn === undefined || x.isReal === false))
          return undefined;
        if (ops.some((x) => x.is(0)))
          return ops.every((x) => x.isFinite)
            ? 'zero'
            : ops.some((x) => x.isFinite === false)
              ? 'unsigned'
              : undefined;
        if (
          ops.some((x) => x.isFinite === false || x.isFinite === undefined) &&
          ops.some((x) => x.is(0) === undefined)
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
        if (ops.every((x) => !x.is(0))) return 'not-zero';
        if (ops.every((x) => x.isReal)) return 'real';
        return undefined;
      },

      evaluate: (ops, { numericApproximation }) =>
        // Use evaluate i both cases: do not introduce premature rounding errors
        numericApproximation
          ? mulN(...ops)
          : mul(...ops.map((x) => x.evaluate())),
    },

    Negate: {
      description: 'Additive Inverse',
      wikidata: 'Q715358',
      complexity: 2000,
      threadable: true,
      signature: 'number -> number',
      type: ([x]) => x.type,
      sgn: ([x]) => oppositeSgn(x.sgn),
      canonical: (args, { engine }) => {
        args = checkNumericArgs(engine, args);
        if (args.length === 0) return engine.error('missing');

        return args[0].neg();
      },
      evaluate: ([x]) => x.neg(),
    },

    PlusMinus: {
      description: 'Plus or Minus',
      wikidata: 'Q120812',
      complexity: 1200,
      involution: true,
      signature: 'value -> tuple',
      type: ([x]) =>
        parseType(`tuple(${typeToString(x.type)}, ${typeToString(x.type)})`),
      evaluate: ([x], { engine }) => engine.tuple(x.abs(), x.abs().neg()),
    },

    Power: {
      wikidata: 'Q33456',
      threadable: true,
      complexity: 3500,
      signature: '(number, number) -> number',
      type: ([base, exp]) => {
        if (!exp.isFinite) return 'non_finite_number';
        if (base.isInteger && exp.isInteger) return 'finite_integer';
        if (base.isRational && exp.isInteger) return 'finite_rational';
        if (base.isReal && exp.isReal) return 'finite_real';
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

        if (a.is(0))
          return b.isNonPositive
            ? 'unsigned'
            : b.isPositive
              ? 'zero'
              : undefined;

        if (a.is(0) && b.is(0)) return 'unsigned';

        if (a.isNonNegative || (b.numerator.isOdd && b.denominator.isOdd))
          return a.sgn;

        if (b.numerator.isEven && b.denominator.isOdd) {
          if (a.isReal) return !a.is(0) ? 'positive' : 'non-negative';
          if (a.type === 'imaginary') return 'negative';
          return !a.is(0) ? 'not-zero' : undefined; //already accounted for a.is(0)
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
      evaluate: ([x, n], { numericApproximation }) =>
        pow(x, n, { numericApproximation: numericApproximation ?? false }),
      // Defined as RealNumbers for all power in RealNumbers when base > 0;
      // when x < 0, only defined if n is an integer
      // if x is a non-zero complex, defined as ComplexNumbers
      // Square root of a prime is irrational (AlgebraicNumbers)
      // https://proofwiki.org/wiki/Square_Root_of_Prime_is_Irrational
    },

    Rational: {
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
          if (f.numericValue === null || f.im !== 0) return undefined;
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
      complexity: 3200,
      threadable: true,

      signature: '(number, number) -> number',
      type: ([base, exp]) => {
        if (base.isFinite === false || exp.isFinite === false)
          return 'non_finite_number';
        if (exp.is(0)) return 'finite_integer';
        if (exp.is(1)) return base.type;
        if (base.isReal && exp.isReal) {
          if (base.isPositive === true) return 'finite_real';
          return 'finite_number';
        }
        return 'finite_number';
      },
      sgn: ([x, n]) => {
        // Note: we can't simplify this to a power, then get the sgn of that because this may cause an infinite loop
        if (x.isReal === false || n.isReal === false) return 'unsigned';
        if (x.is(0)) return n.is(0) ? 'unsigned' : 'zero';
        if (x.isPositive === true) return 'positive';
        if (n.isOdd === true) return 'negative';
        if (n.isEven === true) return 'unsigned';
        return undefined;
      },
      canonical: (args, { engine }) => {
        args = checkNumericArgs(engine, args, 2);
        const [base, exp] = args;
        return canonicalRoot(base, exp);
      },
      evaluate: ([x, n], { numericApproximation }) =>
        root(x, n, { numericApproximation }),
    },

    Round: {
      complexity: 1250,
      threadable: true,
      signature: 'number -> integer',
      type: ([x]) => {
        if (x.isFinite === false || x.isReal === false)
          return 'non_finite_number';
        return 'finite_integer';
      },
      sgn: ([x]) => {
        if (x.isNaN) return 'unsigned';
        if (x.isNumberLiteral)
          return x.im! >= 0.5 || x.im! <= -0.5
            ? 'unsigned'
            : numberSgn(Math.round(x.re));
        if (x.isGreaterEqual(0.5)) return 'positive';
        if (x.isLessEqual(-0.5)) return 'negative';
        if (x.isLess(0.5) && x.isGreater(-0.5)) return 'zero';
        if (x.isNonNegative) return 'non-negative';
        if (x.isNonPositive) return 'non-positive';
        if (x.isReal) return 'real';
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

    Sign: {
      complexity: 1200,
      threadable: true,
      signature: 'number -> integer',
      sgn: ([x]) => x.sgn,
      evaluate: ([x], { engine }) => {
        if (x.is(0)) return engine.Zero;
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
      threadable: true,

      signature: 'number -> number',
      type: ([x]) => {
        if (x.isFinite === false) return 'non_finite_number';
        if (x.isReal) return 'finite_real';
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
        if (!x.is(0)) return 'not-zero';
        return undefined;
      },
      evaluate: ([x], { numericApproximation, engine }) => {
        if (!numericApproximation) return x.sqrt();

        const [c, rest] = x.toNumericValue();
        if (rest.is(1)) return engine.number(c.sqrt().N());
        return engine.number(c.sqrt().N()).mul(rest);
      },
      // evalDomain: Square root of a prime is irrational
      // https://proofwiki.org/wiki/Square_Root_of_Prime_is_Irrational
    },

    Square: {
      wikidata: 'Q3075175',
      complexity: 3100,
      threadable: true,
      signature: 'number -> number',
      sgn: ([x]) => {
        if (x.is(0)) return 'zero';
        if (x.isReal) return !x.is(0) ? 'positive' : 'non-negative';
        if (x.type === 'imaginary' || x.type === 'complex') return 'negative';
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
      wikidata: 'Q40754',
      complexity: 1350,
      threadable: true,
      // We accept from 1 to n arguments (see https://github.com/cortex-js/compute-engine/issues/171)
      // left-associative: a - b - c -> (a - b) - c
      signature: '(number, ...number) -> number',
      canonical: (args, { engine }) => {
        args = checkNumericArgs(engine, args);
        if (args.length === 0) return engine.error('missing');
        const first = args[0];
        const rest = args.slice(1);
        return canonicalAdd(engine, [first, ...rest.map((x) => x.neg())]);
      },
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
      type: 'finite_imaginary',
      constant: true,
      holdUntil: 'never',
      wikidata: 'Q193796',
      value: (engine) => engine.I,
    },

    i: {
      type: 'finite_imaginary',
      constant: true,
      holdUntil: 'never',
      value: (engine) => engine.I,
    },

    ExponentialE: {
      type: 'finite_real',
      wikidata: 'Q82435',
      constant: true,
      holdUntil: 'N',

      value: (engine) =>
        engine.number(
          bignumPreferred(engine) ? engine._BIGNUM_ONE.exp() : Math.exp(1)
        ),
    },

    e: {
      type: 'finite_real',
      constant: true,
      holdUntil: 'never',
      value: 'ExponentialE',
    },

    ComplexInfinity: {
      type: 'non_finite_number',
      constant: true,
      holdUntil: 'never',
      value: (engine) => engine.ComplexInfinity,
    },

    PositiveInfinity: {
      type: 'non_finite_number',
      constant: true,
      holdUntil: 'never',
      value: +Infinity,
    },

    NegativeInfinity: {
      type: 'non_finite_number',
      constant: true,
      holdUntil: 'never',
      value: -Infinity,
    },

    NaN: {
      type: 'non_finite_number',
      constant: true,
      holdUntil: 'never',
      value: (engine) => engine.NaN,
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
      constant: true,
      value: { num: Number.EPSILON.toString() },
    },
    Half: {
      type: 'finite_rational',
      constant: true,
      holdUntil: 'never',
      value: ['Rational', 1, 2],
    },
    GoldenRatio: {
      type: 'finite_real', // Golden ratio is an algebraic number
      wikidata: 'Q41690',
      constant: true,
      holdUntil: 'N',
      value: ['Divide', ['Add', 1, ['Sqrt', 5]], 2],
    },
    CatalanConstant: {
      type: 'finite_real',
      wikidata: 'Q855282',
      constant: true,
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
      // From http://www.fullbooks.com/Miscellaneous-Mathematical-Constants2.html
      type: 'finite_real',
      wikidata: 'Q273023',
      holdUntil: 'N',
      constant: true,
      value: {
        num: `0.57721566490153286060651209008240243104215933593992359880576723488486772677766
          467093694706329174674951463144724980708248096050401448654283622417399764492353
          625350033374293733773767394279259525824709491600873520394816567085323315177661
          152862119950150798479374508570574002992135478614669402960432542151905877553526
          733139925401296742051375413954911168510280798423487758720503843109399736137255
          306088933126760017247953783675927135157722610273492913940798430103417771778088
          154957066107501016191663340152278935867965497252036212879226555953669628176388
          792726801324310104765059637039473949576389065729679296010090151251959509222435
          014093498712282479497471956469763185066761290638110518241974448678363808617494
          551698927923018773910729457815543160050021828440960537724342032854783670151773
          943987003023703395183286900015581939880427074115422278197165230110735658339673`,
      },
    },
  },

  {
    PreIncrement: {
      signature: 'number -> number',
    },
    PreDecrement: {
      signature: 'number -> number',
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
      threadable: true,
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
      threadable: true,
      signature: '(number) -> boolean',
      canonical: (ops, { engine }) => engine.box(['Not', ['IsPrime', ...ops]]),
    },

    IsOdd: {
      description: '`IsOdd(n)` returns `True` if `n` is an odd number',
      complexity: 1200,
      threadable: true,
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
        return engine.symbol(result ? 'False' : 'True');
      },
    },
    isEven: {
      description: 'Odd Number',
      complexity: 1200,
      threadable: true,
      signature: '(number) -> boolean',
      canonical: (ops, { engine }) => engine.box(['Not', ['IsOdd', ...ops]]),
    },
    // @todo: Divisor:
  },
  {
    GCD: {
      description: 'Greatest Common Divisor',
      complexity: 1200,
      threadable: false, // The function take a variable number of arguments,
      // including collections
      signature: '(...any) -> integer',
      sgn: () => 'positive',
      evaluate: (xs) => evaluateGcdLcm(xs, 'GCD'),
    },
    LCM: {
      description: 'Least Common Multiple',
      complexity: 1200,
      threadable: false, // The function take a variable number of arguments,
      // including collections
      signature: '(...any) -> integer',
      sgn: () => 'positive',
      evaluate: (xs) => evaluateGcdLcm(xs, 'LCM'),
    },

    Numerator: {
      description: 'Numerator of an expression',
      complexity: 1200,
      threadable: true,

      lazy: true,
      signature: '(number) -> number | nothing',
      canonical: (ops, { engine }) => {
        // **IMPORTANT**: We want Numerator to work on non-canonical
        // expressions, so that you can determine if a user input is
        // reductible, for example.
        if (ops.length === 0) return engine.Nothing;
        const op = ops[0];
        if (op.operator === 'Rational' || op.operator === 'Divide')
          return op.op1;
        return engine._fn('Numerator', canonical(engine, ops));
      },
      sgn: ([x]) => x.sgn,
      evaluate: (ops, { engine }) => {
        const ce = engine;
        if (ops.length === 0) return ce.Nothing;
        const op = ops[0];
        if (op.operator === 'Rational' || op.operator === 'Divide')
          return op.op1.evaluate();
        return op.numerator;
      },
    },

    Denominator: {
      description: 'Denominator of an expression',
      complexity: 1200,
      threadable: true,

      lazy: true,
      signature: '(number) -> number | nothing',
      canonical: (ops, { engine }) => {
        // **IMPORTANT**: We want Denominator to work on non-canonical
        // expressions, so that you can determine if a user input is
        // reductible, for example.
        if (ops.length === 0) return engine.Nothing;
        const op = ops[0];
        if (op.operator === 'Rational' || op.operator === 'Divide')
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
        if (op.operator === 'Rational' || op.operator === 'Divide')
          return op.op2.evaluate();
        return op.denominator;
      },
    },

    NumeratorDenominator: {
      description: 'Sequence of Numerator and Denominator of an expression',
      complexity: 1200,
      threadable: true,

      lazy: true,
      signature: '(number) -> tuple<number, number> | nothing',
      canonical: (ops, { engine }) => {
        // **IMPORTANT**: We want NumeratorDenominator to work on non-canonical
        // expressions, so that you can determine if a user input is
        // reductible, for example.
        if (ops.length === 0) return engine.Nothing;
        const op = ops[0];
        if (op.operator === 'Rational' || op.operator === 'Divide')
          return engine.tuple(...op.ops!);
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
        if (op.operator === 'Rational' || op.operator === 'Divide')
          return ce.tuple(...op.ops!);

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
      threadable: false, // The function take a variable number of arguments,
      // including collections
      signature: '(...value) -> number | list',
      sgn: (ops) => {
        if (ops.some((x) => x.isReal == false || x.isNaN)) return 'unsigned';
        if (ops.some((x) => x.isReal == false || x.isNaN !== false))
          return undefined;
        if (ops.some((x) => x.isPositive)) return 'positive';
        if (ops.every((x) => x.isNonPositive))
          return ops.some((x) => x.is(0)) ? 'zero' : 'non-positive';
        if (ops.some((x) => x.isNonNegative)) return 'non-negative';
        if (ops.every((x) => x.isNegative)) return 'negative';
        if (ops.some((x) => !x.is(0))) return 'not-zero';
        return undefined;
      },
      evaluate: (xs, { engine }) => evaluateMinMax(engine, xs, 'Max'),
    },

    Min: {
      description: 'Minimum of two or more numbers',
      complexity: 1200,
      threadable: false, // The function take a variable number of arguments,
      // including collections
      signature: '(...value) -> number | list',
      sgn: (ops) => {
        if (ops.some((x) => x.isReal == false || x.isNaN)) return 'unsigned';
        if (ops.some((x) => x.isReal == false || x.isNaN !== false))
          return undefined;
        if (ops.some((x) => x.isNegative)) return 'negative';
        if (ops.every((x) => x.isNonNegative))
          return ops.some((x) => x.is(0)) ? 'zero' : 'non-negative';
        if (ops.some((x) => x.isNonPositive)) return 'non-positive';
        if (ops.every((x) => x.isPositive)) return 'positive';
        return undefined;
      },
      evaluate: (xs, { engine }) => evaluateMinMax(engine, xs, 'Min'),
    },

    Supremum: {
      description: 'Like Max, but defined for open sets',
      complexity: 1200,
      threadable: false, // The function take a variable number of arguments,
      // including collections

      signature: '(...value) -> number | list',
      evaluate: (xs, { engine }) => evaluateMinMax(engine, xs, 'Supremum'),
    },

    Infimum: {
      description: 'Like Min, but defined for open sets',
      complexity: 1200,
      threadable: false, // The function take a variable number of arguments,
      // including collections

      signature: '(...value) -> number | list',
      evaluate: (xs, { engine }) => evaluateMinMax(engine, xs, 'Infimum'),
    },

    Product: {
      description:
        '`Product(f, a, b)` computes the product of `f` from `a` to `b`',
      wikidata: 'Q901718',
      complexity: 1000,
      threadable: false,

      lazy: true,
      signature:
        '(collection|function, ...(tuple<symbol>|tuple<symbol, integer>|tuple<symbol, integer, integer>)) -> number',

      // The 'body' and 'range' need to be interpreted by canonicalMultiplication(). Don't canonicalize them yet.
      canonical: ([body, ...indexes]) =>
        canonicalBigop('Product', body, indexes),

      evaluate: (ops, options) => {
        const fn = (acc, x) => {
          x = x.evaluate(options);
          if (!x.isNumberLiteral) return null;
          return acc.mul(x.numericValue!);
        };

        const result = run(
          reduceBigOp(
            ops[0],
            ops.slice(1),
            fn,
            options.engine._numericValue(1)
          ),
          options.engine._timeRemaining
        );
        return options.engine.number(result ?? NaN);
      },

      evaluateAsync: async (ops, options) => {
        const fn = (acc, x) => {
          x = x.evaluate(options);
          if (!x.isNumberLiteral) return null;
          return acc.mul(x.numericValue!);
        };

        const result = await runAsync(
          reduceBigOp(
            ops[0],
            ops.slice(1),
            fn,
            options.engine._numericValue(1)
          ),
          options.engine._timeRemaining,
          options.signal
        );
        return options.engine.number(result ?? NaN);
      },
    },

    Sum: {
      description: '`Sum(f, a, b)` computes the sum of `f` from `a` to `b`',
      wikidata: 'Q218005',
      complexity: 1000,
      threadable: false,

      lazy: true,
      signature:
        '(collection|function, ...(tuple<symbol>|tuple<symbol, integer>|tuple<symbol, integer, integer>)) -> number',

      canonical: ([body, ...indexes]) => canonicalBigop('Sum', body, indexes),
      evaluate: (xs, { engine }) =>
        engine.number(
          run(
            reduceBigOp(
              xs[0],
              xs.slice(1),
              (acc, x) => {
                x = x.evaluate();
                if (!x.isNumberLiteral) return null;
                return acc.add(x.numericValue!);
              },
              engine._numericValue(0)
            ) ?? NaN,
            engine._timeRemaining
          )
        ),
      evaluateAsync: async (xs, { engine, signal }) =>
        engine.number(
          await runAsync(
            reduceBigOp(
              xs[0],
              xs.slice(1),
              (acc, x) => {
                x = x.evaluate();
                if (!x.isNumberLiteral) return null;
                return acc.add(x.numericValue!);
              },
              engine._numericValue(0)
            ) ?? NaN,
            engine._timeRemaining,
            signal
          )
        ),
    },
  },

  //
  // Formatting and string processing
  //
  {
    BaseForm: {
      description: '`BaseForm(expr, base=10)`',
      complexity: 9000,
      signature: '(number, (string|integer)?) -> string | nothing',
      type: ([x]) => (x === undefined ? 'nothing' : x.type),
      evaluate: ([x]) => x,
    },

    FromDigits: {
      description: `\`FromDigits(s, base=10)\` \
      return an integer representation of the string \`s\` in base \`base\`.`,
      // @todo could accept `0xcafe`, `0b01010` or `(deadbeef)_16` as string formats
      // @todo could accept "roman"... as base
      // @todo could accept optional third parameter as the (padded) length of the output

      signature: '(string, (string|integer)?) -> integer',

      evaluate: (ops, { engine }) => {
        let op1 = ops[0]?.string;
        const ce = engine;
        if (!op1) return ce.typeError('string', ops[0]?.type, ops[0]);

        op1 = op1.trim();

        if (op1.startsWith('0x')) return ce.number(parseInt(op1.slice(2), 16));

        if (op1.startsWith('0b')) return ce.number(parseInt(op1.slice(2), 2));

        const op2 = ops[1] ?? ce.Nothing;
        if (op2.symbol === 'Nothing')
          return ce.number(Number.parseInt(op1, 10));

        const base = op2.re;
        if (
          op2.type !== 'integer' ||
          !Number.isFinite(base) ||
          base < 2 ||
          base > 36
        )
          return ce.error(['unexpected-base', base.toString()], op2.toString());

        const [value, rest] = fromDigits(op1, op2.string ?? op2.symbol ?? 10);

        if (rest) return ce.error(['unexpected-digit', rest[0]], rest);

        return ce.number(value);
      },
    },

    IntegerString: {
      description: `\`IntegerString(n, base=10)\` \
      return a string representation of the integer \`n\` in base \`base\`.`,
      // @todo could accept `0xcafe`, `0b01010` or `(deadbeef)_16` as string formats
      // @todo could accept "roman"... as base
      // @todo could accept optional third parameter as the (padded) length of the output
      threadable: true,
      signature: '(integer, integer?) -> string',
      evaluate: (ops, { engine }) => {
        const ce = engine;
        const op1 = ops[0];
        if (op1.type !== 'integer')
          return ce.typeError('integer', op1.type, op1);

        const val = op1.re;
        if (!Number.isFinite(val))
          return ce.typeError('integer', op1.type, op1);

        const op2 = ops[1] ?? ce.Nothing;
        if (op2.symbol === 'Nothing') {
          if (op1.bignumRe !== undefined)
            return ce.string(op1.bignumRe.abs().toString());
          return ce.string(Math.abs(val).toString());
        }

        const base = asSmallInteger(op2);
        if (base === null) return ce.typeError('integer', op2.type, op2);

        if (base < 2 || base > 36)
          return ce.error(
            ['out-of-range', '2', '36', base.toString()],
            op2.toString()
          );

        return ce.string(Math.abs(val).toString(base));
      },
    },
  },
];

function evaluateAbs(arg: BoxedExpression): BoxedExpression | undefined {
  const ce = arg.engine;
  const num = arg.numericValue;
  if (num !== null) {
    if (typeof num === 'number') return ce.number(Math.abs(num));
    return ce.number(num.abs());
  }
  if (arg.isNonNegative) return arg;
  if (arg.isNegative) return arg.neg();
  return undefined;
}

function processMinMaxItem(
  item: BoxedExpression,
  mode: 'Min' | 'Max' | 'Supremum' | 'Infimum'
): [BoxedExpression | undefined, ReadonlyArray<BoxedExpression>] {
  const ce = item.engine;
  const upper = mode === 'Max' || mode === 'Supremum';

  // An interval is continuous
  if (item.operator === 'Interval') {
    const b = upper ? item.op2 : item.op1;

    if (!b.isNumber || b.numericValue === null) return [undefined, [item]];
    return [b, []];
  }

  // A range is discrete, the last element may not be included
  if (item.operator === 'Range') {
    const r = range(item);
    const last = rangeLast(r);
    return [ce.number(Math.max(r[0], last)), []];
  }

  if (item.operator === 'Linspace') {
    if (item.nops === 1) item = upper ? item.op1 : ce.One;
    else if (upper) item = item.op2;
    else item = item.op1;
    return [item, []];
  }

  if (item.isCollection) {
    let result: BoxedExpression | undefined = undefined;
    const rest: BoxedExpression[] = [];
    for (const op of each(item)) {
      const [val, others] = processMinMaxItem(op, mode);
      if (val) {
        if (!result) result = val;
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

  if (!item.isNumber || item.numericValue === null) return [undefined, [item]];
  return [item, []];
}

function evaluateMinMax(
  ce: IComputeEngine,
  ops: ReadonlyArray<BoxedExpression>,
  mode: 'Min' | 'Max' | 'Supremum' | 'Infimum'
): BoxedExpression {
  const upper = mode === 'Max' || mode === 'Supremum';
  if (ops.length === 0)
    return upper ? ce.NegativeInfinity : ce.PositiveInfinity;

  let result: BoxedExpression | undefined = undefined;
  const rest: BoxedExpression[] = [];

  for (const op of ops) {
    const [val, others] = processMinMaxItem(op, mode);
    if (val) {
      if (!result) result = val;
      else {
        if ((upper && val.isGreater(result)) || (!upper && val.isLess(result)))
          result = val;
      }
    }
    rest.push(...others);
  }

  if (rest.length > 0)
    return ce.box(result ? [mode, result, ...rest] : [mode, ...rest]);
  return result ?? (upper ? ce.NegativeInfinity : ce.PositiveInfinity);
}

function evaluateGcdLcm(
  ops: ReadonlyArray<BoxedExpression>,
  mode: 'LCM' | 'GCD'
): BoxedExpression {
  const ce = ops[0].engine;
  const fn = mode === 'LCM' ? lcm : gcd;
  const bigFn = mode === 'LCM' ? bigLcm : bigGcd;

  const rest: BoxedExpression[] = [];
  if (bignumPreferred(ce)) {
    let result: Decimal | null = null;
    for (const op of ops) {
      if (result === null) {
        result = asBignum(op);
        if (result === null || !result.isInteger()) rest.push(op);
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
      if (isSubtype(op.type, 'integer')) rest.push(op);
    } else {
      if (!op.isInteger) rest.push(op);
      else result = fn(result, op.re);
    }
  }
  if (rest.length === 0) return result === null ? ce.One : ce.number(result);
  if (result === null) return ce._fn(mode, rest);
  return ce._fn(mode, [ce.number(result), ...rest]);
}

export function isPrime(expr: BoxedExpression): boolean | undefined {
  if (!expr.isInteger) return undefined;
  if (expr.isNegative) return undefined;

  const value = expr.numericValue;
  if (value === null) return undefined;

  const n = asSmallInteger(expr);
  if (n !== null) return isPrimeMachine(n);
  const b = asBigint(expr);
  if (b !== null) return isPrimeBigint(b);

  return undefined;
}

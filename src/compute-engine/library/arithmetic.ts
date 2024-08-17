import { Decimal } from 'decimal.js';
import {
  gamma as gammaComplex,
  gammaln as lngammaComplex,
} from '../numerics/numeric-complex';
import {
  factorial as bigFactorial,
  factorial2 as bigFactorial2,
  gcd as bigGcd,
  lcm as bigLcm,
} from '../numerics/numeric-bignum';
import {
  gamma,
  gammaln,
  bigGamma,
  bigGammaln,
} from '../numerics/special-functions';
import { chop, factorial, factorial2, gcd, lcm } from '../numerics/numeric';
import { rationalize } from '../numerics/rationals';
import { IdentifierDefinitions } from '../public';
import { bignumPreferred } from '../boxed-expression/utils';
import { domainAdd, canonicalAdd } from './arithmetic-add';
import { mul, mulN } from './arithmetic-multiply';
import { canonicalDivide } from './arithmetic-divide';
import { apply, apply2, canonical } from '../symbolic/utils';
import {
  checkDomain,
  checkDomains,
  checkNumericArgs,
} from '../boxed-expression/validate';
import { flatten } from '../symbolic/flatten';
import { each, isCollection } from '../collection-utils';
import { IComputeEngine, BoxedExpression } from '../boxed-expression/public';
import {
  asSmallInteger,
  asRational,
  asBignum,
  asBigint,
} from '../boxed-expression/numerics';
import { add, addN } from '../boxed-expression/terms';
import { isPrime as isPrimeMachine, isPrimeBigint } from '../numerics/primes';
import { fromDigits } from '../numerics/strings';
import { addOrder } from '../boxed-expression/order';
import { canonicalBigop, reduceBigOp } from './utils';

// When considering processing an arithmetic expression, the following
// are the core canonical arithmetic operations that should be considered:
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
// expression (they are not canonicalized):
//
// - Complex -> Complex number
// - Rational -> Rational number
// - Exp -> Power(E, _)
// - Square -> Power(_, 2)
// - Subtract -> Add(_1, Negate(_2))

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
      signature: {
        domain: ['FunctionOf', 'Numbers', 'NonNegativeNumbers'],
        sgn: (ce, ops) =>
          ops[0].isZero ? 0 : ops[0].isNotZero ? 1 : undefined,
        evaluate: (ce, ops) => processAbs(ce, ops[0], 'evaluate'),
        N: (ce, ops) => processAbs(ce, ops[0], 'N'),
      },
    },

    Add: {
      wikidata: 'Q32043',
      associative: true,
      commutative: true,
      commutativeOrder: addOrder,
      threadable: true,
      idempotent: true,
      complexity: 1300,
      hold: 'all',
      signature: {
        domain: 'NumericFunctions',
        sgn: (ce, ops) => {
          if (ops.some((x) => x.sgn === undefined)) return undefined;
          if (ops.every((x) => x.sgn === 0)) return 0;
          if (
            ops.every((x) => {
              const s = x.sgn;
              return typeof s === 'number' ? s >= 0 : false;
            })
          )
            return 1;
          if (
            ops.every((x) => {
              const s = x.sgn;
              return typeof s === 'number' ? s <= 0 : false;
            })
          )
            return 1;
          const v = addN(...ops.map((x) => x.N()));
          if (v.isPositive) return 1;
          if (v.isNegative) return -1;
          if (v.isZero) return 0;
          if (v.isComplex) return NaN;
          return undefined;
        },
        result: (ce, ops) =>
          domainAdd(
            ce,
            ops.map((x) => x.domain)
          ),
        // @fastpath: canonicalization is done in the function
        // makeNumericFunction().
        evaluate: (ce, ops) => add(...ops.map((x) => x.evaluate())),
        N: (ce, ops) => addN(...ops.map((x) => x.N())),
      },
    },

    Ceil: {
      description: 'Rounds a number up to the next largest integer',
      complexity: 1250,
      threadable: true,
      signature: {
        domain: ['FunctionOf', 'Numbers', 'Integers'],
        sgn: (ce, ops) => {
          let x = ops[0];
          if (x.isLessEqual(-1)) return -1;
          if (x.isGreater(0)) return 1;
          if (x.isLess(0) && x.isGreater(-1)) return 0;
          if (x.isComplex) return x.im! < 0 && x.im! > -1 ? 0 : NaN;
          return undefined;
        },
        evaluate: (_ce, ops) =>
          apply(
            ops[0],
            Math.ceil,
            (x) => x.ceil(),
            (z) => z.ceil(0)
          ),
      },
    },

    Chop: {
      associative: true,
      threadable: true,
      idempotent: true,
      complexity: 1200,
      // sgn:(ce,ops)=>{
      //
      // },
      signature: {
        domain: ['FunctionOf', 'Numbers', 'Numbers'],
        evaluate: (ce, ops) =>
          apply(
            ops[0],
            (x) => ce.chop(x),
            (x) => ce.chop(x),
            (x) => ce.chop(x)
          ),
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

      signature: {
        params: ['Numbers'],
        restParam: 'Numbers',
        result: 'Numbers',

        sgn: (ce, ops) => {
          const [n, d] = [ops[0]?.sgn, ops[1]?.sgn];
          if (n === undefined || d === undefined) return undefined;
          if (d === 0) return NaN;
          if (n === 0) return 0;
          return n * d;
        },
        canonical: (ce, args) => {
          // @fastpath: this code path is never taken, canonicalDivide is called directly
          args = checkNumericArgs(ce, args);
          let result = args[0];
          if (result === undefined) return ce.error('missing');
          if (args.length < 2) return result;

          const rest = args.slice(1);
          for (const x of rest) result = canonicalDivide(result, x);

          return result;
        },
        evaluate: (ce, ops) => ops[0].div(ops[1]),
        N: (ce, ops) => ops[0].div(ops[1]),
      },
    },

    Exp: {
      wikidata: 'Q168698',
      threadable: true,
      complexity: 3500,
      // Exp(x) -> e^x

      signature: {
        params: ['Numbers'],
        result: 'Numbers',
        sgn: (ce, ops) => {
          let x = ops[0];
          let n = chop(1 - (x.im ?? 0) / Math.PI) + 1;
          if (x.isReal || n % 1 === 0) {
            if (x.isNegative && x.isInfinity) return 0;
            return n % 2 === 0 || x.isReal ? 1 : -1;
          }
          if (n % 1 !== 0) return NaN;

          return undefined;
        },
        canonical: (ce, args) => {
          // The canonical handler is responsible for arg validation
          args = checkNumericArgs(ce, args, 1);
          return ce.function('Power', [ce.E, ...args]);
        },
      },
    },

    Factorial: {
      description: 'Factorial Function',
      wikidata: 'Q120976',
      threadable: true,
      complexity: 9000,

      signature: {
        params: ['Numbers'],
        result: 'Numbers',
        sgn: () => 1,
        canonical: (ce, args) => {
          const x = args[0];
          if (x.numericValue !== null && x.isNegative)
            return ce._fn('Factorial', [x.neg()]).neg();
          return ce._fn('Factorial', [x]);
        },
        evaluate: (ce, ops) => {
          const x = ops[0];

          // Is the argument a complex number?
          if (x.im !== 0 && x.im !== undefined)
            return ce.number(gammaComplex(ce.complex(x.im, x.re).add(1)));

          // The argument is real...
          const n = x.re;
          if (n === undefined) return undefined;

          // Not a positive integer, use the Gamma function
          if (n < 0 || !Number.isInteger(n)) return ce.number(gamma(1 + n));

          if (!bignumPreferred(ce)) return ce.number(factorial(n));
          return ce.number(bigFactorial(ce, ce.bignum(n)));
        },
      },
    },

    Factorial2: {
      description: 'Double Factorial Function',
      complexity: 9000,
      threadable: true,

      signature: {
        params: ['Numbers'],
        result: 'Numbers',
        sgn: () => 1,
        evaluate: (ce, ops) => {
          // 2^{\frac{n}{2}+\frac{1}{4}(1-\cos(\pi n))}\pi^{\frac{1}{4}(\cos(\pi n)-1)}\Gamma\left(\frac{n}{2}+1\right)

          const n = asSmallInteger(ops[0]);
          if (n === null) return undefined;
          if (bignumPreferred(ce))
            return ce.number(bigFactorial2(ce, ce.bignum(n)));

          return ce.number(factorial2(n));
        },
      },
    },

    Floor: {
      wikidata: 'Q56860783',
      complexity: 1250,
      threadable: true,

      signature: {
        domain: ['FunctionOf', 'Numbers', 'RealNumbers'],
        sgn: (ce, ops) => {
          let x = ops[0];
          if (x.isLess(0)) return -1;
          if (x.isGreaterEqual(1)) return 1;
          if (x.isGreater(0) && x.isLess(1)) return 0;
          if (x.isComplex) return x.im! > 0 && x.im! < 1 ? 0 : NaN;
          return undefined;
        },
        evaluate: (ce, ops) =>
          apply(
            ops[0],
            Math.floor,
            (x) => x.floor(),
            (z) => z.floor(0)
          ),
      },
    },

    Gamma: {
      wikidata: 'Q190573',
      complexity: 8000,
      threadable: true,
      signature: {
        params: ['Numbers'],
        result: 'Numbers',
        sgn: (ce, ops) => {
          const s = ops[0]?.sgn;
          if (s === undefined || isNaN(s)) return undefined;
          if (s >= 0) return 1; // Gamma is positive for positive real numbers
          if (ops[0].isInteger) return NaN; // Gamma is not defined for negative integers
          return undefined;
        },
        N: (ce, ops) =>
          apply(
            ops[0],
            (x) => gamma(x),
            (x) => bigGamma(ce, x),
            (x) => gammaComplex(x)
          ),
      },
    },

    GammaLn: {
      complexity: 8000,
      threadable: true,

      signature: {
        params: ['Numbers'],
        result: 'Numbers',
        N: (ce, ops) =>
          apply(
            ops[0],
            (x) => gammaln(x),
            (x) => bigGammaln(ce, x),
            (x) => lngammaComplex(x)
          ),
      },
    },

    Ln: {
      description: 'Natural Logarithm',
      wikidata: 'Q204037',
      complexity: 4000,
      threadable: true,

      signature: {
        params: ['Numbers'],
        optParams: ['Numbers'],
        result: 'Numbers',
        sgn: (ce, ops) => {
          const s = ops[0]?.sgn;
          if (s === undefined) return undefined;
          if (s <= 0 || isNaN(s)) return NaN; // complex
          if (ops[0].isGreater(1)) return 1;
          if (ops[0].isLess(1)) return -1;
          if (ops[0].isOne) return 0;
          return undefined;
        },
        // @fastpath: this doesn't get called. See makeNumericFunction()
        canonical: (ce, ops) =>
          ops[1] ? ce.function('Log', ops) : ops[0].ln(),
        evaluate: (ce, ops) => ops[0].ln(ops[1]),
        N: (ce, ops) =>
          apply(
            ops[0],
            (x) => (x === 0 ? NaN : x >= 0 ? Math.log(x) : ce.complex(x).log()),
            (x) =>
              x.isZero()
                ? NaN
                : !x.isNeg()
                  ? x.ln()
                  : ce.complex(x.toNumber()).log(),
            (z) => (z.isZero() ? NaN : z.log())
          ),
      },
    },

    Log: {
      description: 'Log(z, b = 10) = Logarithm of base b',
      wikidata: 'Q11197',
      complexity: 4100,
      threadable: true,

      signature: {
        params: ['Numbers'],
        optParams: ['Numbers'],
        result: 'Numbers',
        sgn: (ce, ops) => {
          const s = ops[0]?.sgn;
          if (s === undefined || isNaN(s)) return undefined;
          if (s < 0) return undefined; // complex
          if (s === 0) return NaN;
          const v = ops[0].N().numericValue;
          if (v === null) return undefined;
          if (typeof v === 'number') return v > 1 ? 1 : -1;
          return v?.gt(1) ? 1 : -1;
        },
        canonical: (ce, ops) => ops[0]?.ln(ops[1] ?? 10) ?? undefined,
        evaluate: (ce, ops) => ops[0]?.ln(ops[1] ?? 10) ?? undefined,

        N: (ce, ops) => {
          if (ops[1] === undefined)
            return apply(
              ops[0],
              (x) =>
                x === 0
                  ? NaN
                  : x >= 0
                    ? Math.log10(x)
                    : ce.complex(x).log().div(Math.LN10),
              (x) =>
                x.isZero()
                  ? NaN
                  : !x.isNeg()
                    ? Decimal.log10(x)
                    : ce.complex(x.toNumber()).log().div(Math.LN10),
              (z) => (z.isZero() ? NaN : z.log().div(Math.LN10))
            );
          return apply2(
            ops[0],
            ops[1],
            (a, b) => Math.log(a) / Math.log(b),
            (a, b) => a.log(b),
            (a, b) => a.log().div(typeof b === 'number' ? Math.log(b) : b.log())
          );
        },
      },
    },

    Lb: {
      description: 'Base-2 Logarithm',
      wikidata: 'Q581168',
      complexity: 4100,
      threadable: true,

      signature: {
        params: ['Numbers'],
        result: 'Numbers',
        canonical: (ce, args) => args[0].ln(2),
        // N: (ce, ops) =>
        //   apply(
        //     ops[0],
        //     (x) => (x >= 0 ? Math.log2(x) : ce.complex(x).log().div(Math.LN2)),
        //     (x) =>
        //       x.isNeg()
        //         ? Decimal.log10(x)
        //         : ce.complex(x.toNumber()).log().div(Math.LN2),
        //     (z) => z.log().div(Math.LN2)
        //   ),
      },
    },

    Lg: {
      description: 'Base-10 Logarithm',
      wikidata: 'Q966582',
      complexity: 4100,
      threadable: true,

      signature: {
        params: ['Numbers'],
        result: 'Numbers',
        canonical: (ce, args) => ce._fn('Log', [args[0]]),
        // N: (ce, ops) =>
        //   apply(
        //     ops[0],
        //     (x) =>
        //       x >= 0 ? Math.log10(x) : ce.complex(x).log().div(Math.LN10),
        //     (x) =>
        //       !x.isNeg()
        //         ? Decimal.log10(x)
        //         : ce.complex(x.toNumber()).log().div(Math.LN10),
        //     (z) => z.log().div(Math.LN10)
        //   ),
      },
    },

    Mod: {
      description: 'Modulo',
      wikidata: 'Q1799665',
      complexity: 2500,
      threadable: true,

      signature: {
        domain: ['FunctionOf', 'Numbers', 'Numbers', 'Numbers'],
        sgn: (ce, ops) => {
          const s = ops[1]?.sgn;
          if (s === undefined || isNaN(s)) return undefined;
          if (s === 0) return NaN;
          if (ops[0].isNumberLiteral && ops[1].isNumberLiteral) {
            const v = apply2(
              ops[0],
              ops[1],
              // In JavaScript, the % is remainder, not modulo
              // so adapt it to return a modulo
              (a, b) => ((a % b) + b) % b,
              (a, b) => a.modulo(b)
            );
            return v?.sgn ?? undefined;
          }
          return undefined;
        },
        evaluate: (ce, ops) =>
          apply2(
            ops[0],
            ops[1],
            // In JavaScript, the % is remainder, not modulo
            // so adapt it to return a modulo
            (a, b) => ((a % b) + b) % b,
            (a, b) => a.modulo(b)
          ),
      },
    },

    Multiply: {
      wikidata: 'Q40276',
      associative: true,
      commutative: true,
      idempotent: true,
      complexity: 2100,
      hold: 'all',
      threadable: true,

      signature: {
        domain: 'NumericFunctions',
        // @fastpath: canonicalization is done in the function
        // makeNumericFunction().
        //
        sgn: (ce, ops) => {
          if (ops.some((x) => x.sgn === undefined)) return undefined;
          if (ops.some((x) => x.sgn === 0))
            return ops.every((x) => x.isFinite) ? 0 : NaN;
          return ops.reduce((acc, x) => acc * x.sgn!, 1);
        },
        evaluate: (ce, ops) => mul(...ops.map((x) => x.evaluate())),
        N: (ce, ops) => mulN(...ops.map((x) => x.N())),
      },
    },

    Negate: {
      description: 'Additive Inverse',
      wikidata: 'Q715358',
      complexity: 2000,
      threadable: true,

      signature: {
        params: ['Numbers'],
        result: (ce, args) => {
          if (args.length !== 1) return ce.domain('NothingDomain');
          const arg = args[0].domain;
          if (!arg?.base) return arg;
          const negDomain = {
            PositiveNumbers: 'NegativeNumbers',
            NonNegativeNumbers: 'NonPositiveNumbers',
            NonPositiveNumbers: 'NonNegativeNumbers',
            NegativeNumbers: 'PositiveNumbers',
            PositiveIntegers: 'NegativeIntegers',
            NonNegativeIntegers: 'NonPositiveIntegers',
            NonPositiveIntegers: 'NonNegativeIntegers',
            NegativeIntegers: 'PositiveIntegers',
          }[arg.base];
          if (negDomain) return ce.domain(negDomain);
          return arg;
        },
        sgn: (ce, args) => {
          const s = args[0]?.sgn;
          if (typeof s === 'number') return -s;
          return s;
        },
        canonical: (ce, args) => {
          args = checkNumericArgs(ce, args);
          if (args.length === 0) return ce.error('missing');

          return args[0].neg();
        },
        evaluate: (ce, ops) => ops[0].neg(),
        N: (ce, ops) => ops[0].neg(),
      },
    },

    PlusMinus: {
      description: 'Plus or Minus',
      wikidata: 'Q120812',
      complexity: 1200,
      involution: true,
      signature: {
        domain: ['FunctionOf', 'Values', 'Tuples'],
        evaluate: (ce, ops) => {
          if (ops.length !== 1) return undefined;
          return ce.tuple(ops[0], ops[0].neg());
        },
      },
    },

    Power: {
      wikidata: 'Q33456',
      threadable: true,
      complexity: 3500,
      signature: {
        domain: ['FunctionOf', 'Numbers', 'Numbers', 'Numbers'],
        canonical: (ce, args) => {
          // @fastpath: See also shortcut in makeNumericFunction()
          args = checkNumericArgs(ce, args, 2);
          if (args.length !== 2) return ce._fn('Power', args);
          const [base, exp] = args;
          return canonicalPower(base, exp);
        },
        sgn: (ce, ops) => {
          //Missing some cases like (-1)^{1/3}
          const [a, b] = ops;
          if (a.isComplex || b.isComplex) return undefined;
          const sA = a.sgn;
          const sB = b.sgn;
          if (sA === undefined || sB === undefined) return undefined;
          if (sA > 0) return 1;
          if (isNaN(sA) || isNaN(sB)) return NaN;
          if (sA === 0) return sB > 0 ? 0 : NaN;
          if (b.isEven === true) return 1;
          if (b.isOdd === true) return -1;
          return undefined;
        },
        evaluate: (ce, ops) => ops[0].pow(ops[1]),
        N: (ce, ops) => ops[0].pow(ops[1]),
        // Defined as RealNumbers for all power in RealNumbers when base > 0;
        // when x < 0, only defined if n is an integer
        // if x is a non-zero complex, defined as ComplexNumbers
        // Square root of a prime is irrational (AlgebraicNumbers)
        // https://proofwiki.org/wiki/Square_Root_of_Prime_is_Irrational
      },
    },

    Rational: {
      complexity: 2400,

      signature: {
        domain: [
          'FunctionOf',
          'Numbers',
          ['OptArg', 'Numbers'],
          'RationalNumbers',
        ],
        sgn: (ce, ops) => ops[0]?.sgn,
        canonical: (ce, args) => {
          args = flatten(args);

          if (args.length === 0)
            return ce._fn('Rational', [ce.error('missing')]);

          if (args.length === 1)
            return ce._fn('Rational', [
              checkDomain(ce, args[0], 'RealNumbers'),
            ]);

          args = checkDomains(ce, args, ['Integers', 'Integers']);

          if (args.length !== 2 || !args[0].isValid || !args[1].isValid)
            return ce._fn('Rational', args);

          return args[0].div(args[1]);
        },
        evaluate: (ce, ops) => {
          if (ops.length === 2) {
            const [n, d] = [asSmallInteger(ops[0]), asSmallInteger(ops[1])];
            if (n !== null && d !== null) return ce.number([n, d]);
            return undefined;
          }

          //
          // If there is a single argument, i.e. `['Rational', 'Pi']`
          // the function evaluates to a rational expression of the argument
          //
          const f = ops[0].N();
          if (f.numericValue === null) return undefined;
          if (f.im !== 0) return undefined;
          return ce.number(rationalize(f.re ?? NaN));
        },
        N: (ce, ops) => {
          if (ops.length === 1) return ops[0];

          return apply2(
            ops[0],
            ops[1],
            (a, b) => a / b,
            (a, b) => a.div(b),
            (a, b) => a.div(b)
          );
        },
      },
    },

    Root: {
      complexity: 3200,
      threadable: true,

      signature: {
        params: ['Numbers', 'Numbers'],
        result: 'Numbers',
        sgn: (ce, ops) => {
          const [a, b] = ops;
          if (a.isComplex || b.isComplex) return NaN;
          if (a.isZero) return b.isZero ? NaN : 0;
          if (a.isPositive === true) return 1;
          if (b.isOdd === true) return -1;
          if (b.isEven === true) return NaN;
          return NaN;
        },
        canonical: (ce, args) => {
          args = checkNumericArgs(ce, args, 2);
          const [base, exp] = args;
          return canonicalRoot(base, exp);
        },
        evaluate: (ce, ops) => ops[0].root(ops[1]),
        N: (ce, ops) => ops[0].root(ops[1]),
      },
    },

    Round: {
      complexity: 1250,
      threadable: true,

      signature: {
        domain: ['FunctionOf', 'Numbers', 'Numbers'],
        sgn: (ce, ops) => {
          let x = ops[0];
          if (x.isGreaterEqual(0.5)) return 1;
          if (x.isLessEqual(-0.5)) return -1;
          if (x.isGreater(-0.5) && x.isLess(0.5)) return 0;
          return undefined;
        },
        evaluate: (ce, ops) =>
          apply(
            ops[0],
            Math.round,
            (x) => x.round(),
            (x) => x.round(0)
          ),
      },
    },

    Sign: {
      complexity: 1200,
      threadable: true,

      signature: {
        domain: ['FunctionOf', 'Numbers', 'Integers'],
        sgn: (ce, ops) => ops[0]?.sgn,
        evaluate: (ce, ops) => {
          const s = ops[0].sgn;
          if (s === 0) return ce.Zero;
          if (s === 1) return ce.One;
          if (s === -1) return ce.NegativeOne;
          return undefined;
        },
        N: (ce, ops) => {
          const s = ops[0].sgn;
          if (s === 0) return ce.Zero;
          if (s === 1) return ce.One;
          if (s === -1) return ce.NegativeOne;
          return undefined;
        },
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

      signature: {
        domain: ['FunctionOf', 'Numbers', 'Numbers'],
        canonical: (ce, ops) => {
          ops = flatten(ops);
          if (ops.length !== 1) return ce._fn('Sqrt', ops);
          return ops[0].sqrt();
        },
        sgn: (ce, ops) => {
          const s = ops[0]?.sgn;
          if (s === undefined) return undefined;
          if (isNaN(s)) return NaN;
          if (s === 0) return 0;
          if (s === 1) return 1;
          if (s === -1) return NaN;
          return undefined;
        },
        evaluate: (ce, ops) => ops[0].sqrt(),
        N: (ce, ops): BoxedExpression => {
          const [c, rest] = ops[0].toNumericValue();
          if (rest.isOne) return ce.box(c.sqrt().N());
          return ce.box(c.sqrt().N()).mul(rest);
        },
        // evalDomain: Square root of a prime is irrational
        // https://proofwiki.org/wiki/Square_Root_of_Prime_is_Irrational
      },
    },

    Square: {
      wikidata: 'Q3075175',
      complexity: 3100,
      threadable: true,
      signature: {
        sgn: (ce, ops) => {
          let x = ops[0];
          if (x.isZero) return 0;
          if (x.isReal) return 1;
          if (x.isImaginary) return -1;
          if (x.isComplex) return NaN;
          return undefined;
        },
        domain: ['FunctionOf', 'Numbers', 'Numbers'],
        canonical: (ce, args) => {
          args = flatten(args);
          if (args.length !== 1) return ce._fn('Square', args);
          return ce._fn('Power', [args[0], ce.number(2)]).canonical;
        },
      },
    },

    Subtract: {
      wikidata: 'Q40754',
      complexity: 1350,
      threadable: true,

      signature: {
        params: ['Numbers'],
        restParam: 'Numbers',
        result: 'Numbers',
        canonical: (ce, args) => {
          // We accept from 1 to n arguments (see https://github.com/cortex-js/compute-engine/issues/171)
          // left-associative: a - b - c -> (a - b) - c

          args = checkNumericArgs(ce, args);
          if (args.length === 0) return ce.error('missing');
          const first = args[0];
          const rest = args.slice(1);
          return canonicalAdd(ce, [first, ...rest.map((x) => x.neg())]);
        },
      },
    },
  },
  {
    //
    // Constants
    // Note: constants are put in a separate, subsequent, dictionary because
    // some of the values (CatalanConstant) reference some function names (Add...)
    // that are defined above. This avoid circular references.
    //
    e: {
      domain: 'RealNumbers',
      constant: true,
      holdUntil: 'never',
      value: 'ExponentialE',
    },
    i: {
      domain: 'ImaginaryNumbers',
      constant: true,
      holdUntil: 'never',
      flags: { imaginary: true },
      value: 'ImaginaryUnit',
    },
    MachineEpsilon: {
      /**
       * The difference between 1 and the next larger floating point number
       *
       *    2^{−52}
       *
       * See https://en.wikipedia.org/wiki/Machine_epsilon
       */
      domain: 'RealNumbers',
      holdUntil: 'N',
      constant: true,
      flags: { real: true },
      value: { num: Number.EPSILON.toString() },
    },
    Half: {
      domain: 'RationalNumbers',
      constant: true,
      holdUntil: 'evaluate',
      value: ['Rational', 1, 2],
    },
    ImaginaryUnit: {
      domain: 'ImaginaryNumbers',
      constant: true,
      holdUntil: 'evaluate',
      wikidata: 'Q193796',
      flags: { imaginary: true },
      value: ['Complex', 0, 1],
    },
    ExponentialE: {
      domain: 'RealNumbers',
      wikidata: 'Q82435',
      constant: true,
      holdUntil: 'N',

      value: (engine) =>
        bignumPreferred(engine) ? engine._BIGNUM_ONE.exp() : Math.exp(1),
    },
    GoldenRatio: {
      domain: 'AlgebraicNumbers',
      wikidata: 'Q41690',
      constant: true,
      holdUntil: 'simplify',
      value: ['Divide', ['Add', 1, ['Sqrt', 5]], 2],
    },
    CatalanConstant: {
      domain: 'RealNumbers',

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
      domain: 'RealNumbers',
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
      signature: { domain: ['FunctionOf', 'Numbers', 'Numbers'] },
    },
    PreDecrement: {
      signature: { domain: ['FunctionOf', 'Numbers', 'Numbers'] },
    },
  },

  //
  // Property predicates
  //

  {
    IsPrime: {
      description: 'Prime Number',
      wikidata: 'Q49008',
      complexity: 1200,
      threadable: true,
      signature: {
        domain: ['FunctionOf', 'Numbers', 'Booleans'],
        evaluate: (ce, ops) => {
          const result = isPrime(ops[0]);
          if (result === undefined) return undefined;
          return ce.symbol(result ? 'True' : 'False');
        },
      },
    },
    IsComposite: {
      description: 'Composite Number',
      complexity: 1200,
      threadable: true,
      signature: {
        domain: ['FunctionOf', 'Numbers', 'Booleans'],
        canonical: (ce, ops) => ce.box(['Not', ['IsPrime', ...ops]]),
      },
    },
    IsOdd: {
      description: 'Odd Number',
      complexity: 1200,
      threadable: true,
      signature: {
        domain: ['FunctionOf', 'Numbers', 'Booleans'],
        evaluate: (ce, ops) => {
          let fail = false;
          const result = ops.every((op) => {
            if (op.im !== 0) return false;

            const b = asBigint(op);
            if (b !== null) return b % BigInt(2) !== BigInt(0);

            const n = op.re;
            if (n !== undefined && Number.isInteger(n)) return n % 2 !== 0;

            fail = true;
            return false;
          });
          if (fail) return undefined;
          return ce.symbol(result ? 'False' : 'True');
        },
      },
    },
    isEven: {
      description: 'Odd Number',
      complexity: 1200,
      threadable: true,
      signature: {
        domain: ['FunctionOf', 'Numbers', 'Booleans'],
        canonical: (ce, ops) => ce.box(['Not', ['IsOdd', ...ops]]),
      },
    },
    // @todo: Divisor:
  },
  {
    GCD: {
      description: 'Greatest Common Divisor',
      complexity: 1200,
      threadable: false, // The function take a variable number of arguments,
      // including collections
      signature: {
        domain: ['FunctionOf', ['VarArg', 'Anything'], 'Numbers'],
        sgn: (ce, ops) => 1,
        evaluate: (ce, ops) => processGcdLcm(ce, ops, 'GCD'),
      },
    },
    LCM: {
      description: 'Least Common Multiple',
      complexity: 1200,
      threadable: false, // The function take a variable number of arguments,
      // including collections
      signature: {
        domain: ['FunctionOf', ['VarArg', 'Anything'], 'Numbers'],
        sgn: (ce, ops) => 1,
        evaluate: (ce, ops) => processGcdLcm(ce, ops, 'LCM'),
      },
    },

    Numerator: {
      description: 'Numerator of an expression',
      complexity: 1200,
      threadable: true,
      hold: 'all',
      signature: {
        domain: ['FunctionOf', 'Anything', 'Numbers'],
        canonical: (ce, ops) => {
          // **IMPORTANT**: We want Numerator to work on non-canonical
          // expressions, so that you can determine if a user input is
          // reductible, for example.
          if (ops.length === 0) return ce.function('Sequence', []);
          const op = ops[0];
          if (op.operator === 'Rational' || op.operator === 'Divide')
            return op.op1;
          const num = asRational(op);
          if (num !== undefined) return ce.number(num[0]);
          return ce._fn('Numerator', canonical(ce, ops));
        },
        sgn: (ce, ops) => ops[0]?.sgn,
        evaluate: (ce, ops) => {
          if (ops.length === 0) return ce.function('Sequence', []);
          const op = ops[0];
          if (op.operator === 'Rational' || op.operator === 'Divide')
            return op.op1.evaluate();
          const num = asRational(op.evaluate());
          if (num !== undefined) return ce.number(num[0]);
          return ce._fn(
            'Numerator',
            ops.map((x) => x.evaluate())
          );
        },
      },
    },
    Denominator: {
      description: 'Denominator of an expression',
      complexity: 1200,
      threadable: true,
      hold: 'all',
      signature: {
        domain: ['FunctionOf', 'Anything', 'Numbers'],
        canonical: (ce, ops) => {
          // **IMPORTANT**: We want Denominator to work on non-canonical
          // expressions, so that you can determine if a user input is
          // reductible, for example.
          if (ops.length === 0) return ce.function('Sequence', []);
          const op = ops[0];
          if (op.operator === 'Rational' || op.operator === 'Divide')
            return op.op2;
          const num = asRational(op);
          if (num !== undefined) return ce.number(num[1]);
          return ce._fn('Denominator', canonical(ce, ops));
        },
        sgn: (ce, ops) => 1,
        evaluate: (ce, ops) => {
          if (ops.length === 0) return ce.function('Sequence', []);
          const op = ops[0];
          if (op.operator === 'Rational' || op.operator === 'Divide')
            return op.op2.evaluate();
          const num = asRational(op.evaluate());
          if (num !== undefined) return ce.number(num[1]);
          return ce._fn(
            'Denominator',
            ops.map((x) => x.evaluate())
          );
        },
      },
    },

    NumeratorDenominator: {
      description: 'Sequence of Numerator and Denominator of an expression',
      complexity: 1200,
      threadable: true,
      hold: 'all',
      signature: {
        domain: ['FunctionOf', 'Anything', 'Anything'],
        canonical: (ce, ops) => {
          // **IMPORTANT**: We want NumeratorDenominator to work on non-canonical
          // expressions, so that you can determine if a user input is
          // reductible, for example.
          if (ops.length === 0) return ce.function('Sequence', []);
          const op = ops[0];
          if (op.operator === 'Rational' || op.operator === 'Divide')
            return ce._fn('Sequence', op.ops!);
          const num = asRational(op.evaluate());
          if (num !== undefined)
            return ce._fn('Sequence', [ce.number(num[0]), ce.number(num[1])]);
          return ce._fn(
            'NumeratorDenominator',
            ops.map((x) => x.evaluate())
          );
        },
        evaluate: (ce, ops) => {
          if (ops.length === 0) return ce.function('Sequence', []);
          const op = ops[0];
          if (op.operator === 'Rational' || op.operator === 'Divide')
            return ce._fn('Sequence', op.ops!);
          const num = asRational(op);
          if (num !== undefined)
            return ce._fn('Sequence', [ce.number(num[0]), ce.number(num[1])]);
          return ce._fn('NumeratorDenominator', canonical(ce, ops));
        },
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
      signature: {
        domain: ['FunctionOf', ['VarArg', 'Values'], 'Numbers'],
        sgn: (ce, ops) => {
          if (ops.some((x) => x.sgn === undefined)) return undefined;
          if (ops.some((x) => isNaN(x.sgn!))) return NaN;
          if (ops.some((x) => x.sgn === 1)) return 1;
          if (ops.some((x) => x.sgn === 0)) return 0;
          if (ops.every((x) => x.sgn === -1)) return -1;
          return undefined;
        },
        evaluate: (ce, ops) => processMinMax(ce, ops, 'Max'),
      },
    },

    Min: {
      description: 'Minimum of two or more numbers',
      complexity: 1200,
      threadable: false, // The function take a variable number of arguments,
      // including collections
      signature: {
        domain: ['FunctionOf', ['VarArg', 'Values'], 'Numbers'],
        sgn: (ce, ops) => {
          if (ops.some((x) => x.sgn === undefined)) return undefined;
          if (ops.some((x) => isNaN(x.sgn!))) return NaN;
          if (ops.some((x) => x.sgn === -1)) return -1;
          if (ops.some((x) => x.sgn === 0)) return 0;
          if (ops.every((x) => x.sgn === 1)) return 1;
          return undefined;
        },
        evaluate: (ce, ops) => processMinMax(ce, ops, 'Min'),
      },
    },

    Supremum: {
      description: 'Like Max, but defined for open sets',
      complexity: 1200,
      threadable: false, // The function take a variable number of arguments,
      // including collections

      signature: {
        domain: ['FunctionOf', ['VarArg', 'Values'], 'Numbers'],
        evaluate: (ce, ops) => processMinMax(ce, ops, 'Supremum'),
      },
    },

    Infimum: {
      description: 'Like Min, but defined for open sets',
      complexity: 1200,
      threadable: false, // The function take a variable number of arguments,
      // including collections

      signature: {
        domain: ['FunctionOf', ['VarArg', 'Values'], 'Numbers'],
        evaluate: (ce, ops) => processMinMax(ce, ops, 'Infimum'),
      },
    },

    Product: {
      wikidata: 'Q901718',
      complexity: 1000,
      hold: 'all',
      threadable: false,
      signature: {
        domain: [
          'FunctionOf',
          'Anything',
          ['VarArg', 'Tuples'],
          // ['Tuple', 'Symbols', ['OptArg', 'Integers'], ['OptArg', 'Integers']],
          // ],
          'Numbers',
        ],
        // codomain: (ce, args) => domainAdd(ce, args),
        // The 'body' and 'range' need to be interpreted by canonicalMultiplication(). Don't canonicalize them yet.
        canonical: (ce, ops) => canonicalBigop('Product', ops[0], ops.slice(1)),
        sgn: (ce, ops) => {
          // Check if the body has a determined sign (i.e. is always positive,
          // negative or 0)
          const s = ops[0]?.sgn;
          if (s === 0) return 0;
          if (s === 1) return 1;
          if (s === -1) return -1;
          if (s !== undefined && isNaN(s)) return NaN;

          // The sign could not be determined by just looking at the body.
          // Look at each term

          let countZero = 0;
          let sign = 1;
          let countNaN = 0;
          let countInfinity = 0;
          let countUndefined = 0;

          // Go over each term, and count the signs of the terms
          let total = reduceBigOp(
            ops[0],
            ops.slice(1),
            (acc, x) => {
              if (x.isInfinity) countInfinity++;
              const s = x.sgn;
              if (s === 0) countZero++;
              else if (s === -1) sign = -sign;
              else if (typeof s === 'number' && isNaN(s)) countNaN++;
              else if (s === undefined) countUndefined++;
              return acc + 1;
            },
            0
          );
          if (countUndefined > 0) return undefined;
          if (countNaN > 0) return NaN;
          if (countZero > 0) return countInfinity > 0 ? NaN : 0;
          return sign > 0 ? 1 : -1;
        },
        evaluate: (ce, ops) => {
          const fn = (acc, x) => {
            x = x.evaluate();
            if (!x.isNumberLiteral) return null;
            return acc.mul(x.numericValue!);
          };

          const result = reduceBigOp(
            ops[0],
            ops.slice(1),
            fn,
            ce._numericValue(1)
          );
          return ce.number(result ?? NaN);
        },
        N: (ce, ops) => {
          const fn = (acc, x) => {
            x = x.N();
            if (!x.isNumberLiteral) return null;
            return acc.mul(x.numericValue!);
          };

          const result = reduceBigOp(
            ops[0],
            ops.slice(1),
            fn,
            ce._numericValue(1)
          );
          return ce.number(result ?? NaN);
        },
      },
    },

    Sum: {
      wikidata: 'Q218005',
      complexity: 1000,
      hold: 'all',
      threadable: false,
      signature: {
        domain: [
          'FunctionOf',
          ['Union', 'Collections', 'Functions'],
          ['VarArg', 'Tuples'],
          // ['Tuple', 'Symbols', ['OptArg', 'Integers'], ['OptArg', 'Integers']],
          // ],
          'Numbers',
        ],
        sgn: (ce, ops) => {
          // Check if the body has a determined sign (i.e. is always positive,
          // negative or 0)
          const s = ops[0]?.sgn;
          if (s === 0) return 0;
          if (s === 1) return 1;
          if (s === -1) return -1;
          if (s !== undefined && isNaN(s)) return NaN;

          // The sign could not be determined by just looking at the body.
          // Look at each term

          let countZero = 0;
          let countPos = 0;
          let countNeg = 0;
          let countNaN = 0;
          let countUndefined = 0;
          // Go over each term, and count the signs of the terms
          let total = reduceBigOp(
            ops[0],
            ops.slice(1),
            (acc, x) => {
              const s = x.sgn;
              if (s === 0) countZero++;
              else if (s === 1) countPos++;
              else if (s === -1) countNeg++;
              else if (typeof s === 'number' && isNaN(s)) countNaN++;
              else countUndefined++;
              return acc + 1;
            },
            0
          );
          if (countUndefined > 0) return undefined;
          if (countNaN > 0) return NaN;
          if (countZero === total) return 0;
          if (countNeg + countZero === total) return -1;
          if (countPos + countZero === total) return 1;
          return undefined;
        },
        canonical: (ce, ops) => canonicalBigop('Sum', ops[0], ops.slice(1)),
        evaluate: (ce, ops) =>
          ce.number(
            reduceBigOp(
              ops[0],
              ops.slice(1),
              (acc, x) => {
                x = x.evaluate();
                if (!x.isNumberLiteral) return null;
                return acc.add(x.numericValue!);
              },
              ce._numericValue(0)
            ) ?? NaN
          ),
        N: (ce, ops) =>
          ce.number(
            reduceBigOp(
              ops[0],
              ops.slice(1),
              (acc, x) => {
                x = x.N();
                if (!x.isNumberLiteral) return null;
                return acc.add(x.numericValue!);
              },
              ce._numericValue(0)
            ) ?? NaN
          ),
      },
    },
  },

  //
  // Formatting and string processing
  //
  {
    BaseForm: {
      description: '`BaseForm(expr, base=10)`',
      complexity: 9000,
      inert: true,
      signature: {
        domain: ['FunctionOf', 'Values', ['OptArg', 'Integers'], 'Values'],
        result: (ce, args) => {
          if (args.length !== 1) return ce.domain('NothingDomain');
          return args[0].domain;
        },
      },
    },
    FromDigits: {
      description: `\`FromDigits(s, base=10)\` \
      return an integer representation of the string \`s\` in base \`base\`.`,
      // @todo could accept `0xcafe`, `0b01010` or `(deadbeef)_16` as string formats
      // @todo could accept "roman"... as base
      // @todo could accept optional third parameter as the (padded) length of the output
      signature: {
        domain: ['FunctionOf', 'Strings', ['OptArg', 'Anything'], 'Integers'],
        evaluate: (ce, ops) => {
          let op1 = ops[0]?.string;
          if (!op1) return ce.domainError('Strings', ops[0]?.domain, ops[0]);

          op1 = op1.trim();

          if (op1.startsWith('0x'))
            return ce.number(parseInt(op1.slice(2), 16));

          if (op1.startsWith('0b')) return ce.number(parseInt(op1.slice(2), 2));

          const op2 = ops[1] ?? ce.Nothing;
          if (op2.symbol === 'Nothing')
            return ce.number(Number.parseInt(op1, 10));

          const base = op2.re ?? NaN;
          if (
            op2.type !== 'integer' ||
            !Number.isFinite(base) ||
            base < 2 ||
            base > 36
          )
            return ce.error(['unexpected-base', base], op2);

          const [value, rest] = fromDigits(op1, op2.string ?? op2.symbol ?? 10);

          if (rest)
            return ce.error(['unexpected-digit', { str: rest[0] }], {
              str: rest,
            });

          return ce.number(value);
        },
      },
    },

    IntegerString: {
      description: `\`IntegerString(n, base=10)\` \
      return a string representation of the integer \`n\` in base \`base\`.`,
      // @todo could accept `0xcafe`, `0b01010` or `(deadbeef)_16` as string formats
      // @todo could accept "roman"... as base
      // @todo could accept optional third parameter as the (padded) length of the output
      threadable: true,
      signature: {
        domain: ['FunctionOf', 'Integers', ['OptArg', 'Integers'], 'Strings'],
        evaluate: (ce, ops) => {
          const op1 = ops[0];
          if (op1.type !== 'integer')
            return ce.domainError('Integers', op1.domain, op1);

          const val = op1.re ?? NaN;
          if (!Number.isFinite(val))
            return ce.domainError('Integers', op1.domain, op1);

          const op2 = ops[1] ?? ce.Nothing;
          if (op2.symbol === 'Nothing') {
            if (op1.bignumRe !== undefined)
              return ce.string(op1.bignumRe.abs().toString());
            return ce.string(Math.abs(val).toString());
          }

          const base = asSmallInteger(op2);
          if (base === null) return ce.domainError('Integers', op2.domain, op2);

          if (base < 2 || base > 36)
            return ce.error(['out-of-range', 2, 36, base], op2);

          return ce.string(Math.abs(val).toString(base));
        },
      },
    },
  },
];

function processAbs(
  ce: IComputeEngine,
  arg: BoxedExpression,
  mode: 'simplify' | 'evaluate' | 'N'
): BoxedExpression | undefined {
  if (mode !== 'simplify') {
    const num = arg.numericValue;
    if (num !== null) {
      if (typeof num === 'number') return ce.number(Math.abs(num));
      return ce.number(num.abs());
    }
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
    if (item.nops === 1) item = upper ? item.op1 : ce.One;
    else if (!upper) {
      item = item.op1;
    } else {
      let step = 1;
      if (item.nops === 3) {
        if (item.op3.type !== 'integer') return [undefined, [item]];
        step = item.op3.re ?? 1;
        if (step === 0 || !isFinite(step)) return [undefined, [item]];
      }
      const [a, b] = [item.op1.re, item.op2.re];
      if (a === undefined || b === undefined) return [undefined, [item]];
      const steps = Math.floor((b - a) / step);
      item = ce.number(a + step * steps);
    }

    return [item, []];
  }

  if (item.operator === 'Linspace') {
    if (item.nops === 1) item = upper ? item.op1 : ce.One;
    else if (upper) item = item.op2;
    else item = item.op1;
    return [item, []];
  }

  if (isCollection(item)) {
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

function processMinMax(
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

function processGcdLcm(
  ce: IComputeEngine,
  ops: ReadonlyArray<BoxedExpression>,
  mode: 'LCM' | 'GCD'
) {
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
      if (op.type !== 'integer') rest.push(op);
    } else {
      if (!op.isInteger) rest.push(op);
      else result = fn(result, op.re!);
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

export function canonicalPower(
  a: BoxedExpression,
  b: BoxedExpression
): BoxedExpression {
  const ce = a.engine;
  a = a.canonical;
  b = b.canonical;
  const exp = b.re;
  if (exp !== undefined) {
    if (exp === 0) return ce.One;
    if (exp === 1) return a;
    if (exp === 0.5) return canonicalRoot(a, 2);
  }
  return ce._fn('Power', [a, b]);
}

export function canonicalRoot(
  a: BoxedExpression,
  b: BoxedExpression | number
): BoxedExpression {
  a = a.canonical;
  const ce = a.engine;
  let exp: number | undefined = undefined;
  if (typeof b === 'number') exp = b;
  else {
    b = b.canonical;
    if (b.isNumberLiteral && b.im === 0) exp = b.re!;
  }

  if (exp === 1) return a;
  if (exp === 2) {
    if (a.isNumberLiteral && (a.type === 'integer' || a.type === 'rational')) {
      const v = a.sqrt();
      if (typeof v.numericValue === 'number') return v;
      if (v.numericValue!.isExact) return v;
    }
    return ce._fn('Sqrt', [a]);
  }

  return ce._fn('Root', [a, typeof b === 'number' ? ce.number(b) : b]);
}

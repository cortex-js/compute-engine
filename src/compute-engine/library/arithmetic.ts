import {
  gamma as gammaComplex,
  gammaln as lngammaComplex,
} from '../numerics/numeric-complex';
import {
  factorial as bigFactorial,
  factorial2 as bigFactorial2,
  gamma as bigGamma,
  gammaln as bigLngamma,
} from '../numerics/numeric-bignum';
import {
  asFloat,
  asSmallInteger,
  factorial,
  factorial2,
  fromDigits,
  gamma,
  gammaln,
} from '../numerics/numeric';
import {
  isBigRational,
  isMachineRational,
  rationalize,
} from '../numerics/rationals';
import {
  BoxedExpression,
  IdentifierDefinitions,
  IComputeEngine,
} from '../public';
import { bignumPreferred } from '../boxed-expression/utils';
import { processNegate } from '../symbolic/negate';
import {
  simplifyAdd,
  evalAdd,
  domainAdd,
  evalSummation,
  canonicalSummation,
} from './arithmetic-add';
import {
  simplifyMultiply,
  evalMultiply,
  evalMultiplication,
  canonicalProduct,
} from './arithmetic-multiply';
import { simplifyDivide } from './arithmetic-divide';
import { processPower, processSqrt } from './arithmetic-power';
import { applyN, apply2N } from '../symbolic/utils';
import Decimal from 'decimal.js';
import Complex from 'complex.js';
import {
  checkArg,
  checkArgs,
  checkNumericArgs,
  canonical,
} from '../boxed-expression/validate';
import { flattenSequence } from '../symbolic/flatten';

// When considering processing an arithmetic expression, the following
// are the core canonical arithmetic functions that should be considered:
export type CanonicalArithmeticFunctions =
  | 'Add'
  | 'Negate' // Distributed over mul/div/add
  | 'Sqrt' // Square root of rationals are preserved as "exact" values
  | 'Multiply'
  | 'Divide'
  | 'Power'
  | 'Ln';

// Non-canonical functions: the following functions get transformed during
// canonicalization, and can be ignored as they will not occur in a canonical
// expression (they are not canonicalized):
//
// - Complex -> Complex number
// - Exp -> Power(E, _)
// - Root -> Power(_1, 1/_2)
// - Sqrt -> Power(_, 1/2) (converted if argument is *not* a rational)
// - Square -> Power(_, 2)
// - Subtract -> Add(_1, Negate(_2))
// - Rational -> Rational number

// @todo Future additions to the dictionary

// See Scala/Breeze "universal functions": https://github.com/scalanlp/breeze/wiki/Universal-Functions

// LogOnePlus: { domain: 'Numbers' },
// mod (modulo). See https://numerics.diploid.ca/floating-point-part-4.html,
// regarding 'remainder' and 'truncatingRemainder'
// Lcm
// Gcd
// Mod: modulo
// Boole
// Zeta function
// Numerator(fraction)
// Denominator(fraction)
// Random() -> random number between 0 and 1
// Random(n) -> random integer between 1 and n
// Random(n, m) -> random integer between n and m
// Hash

// # Prime Numbers:
// Prime: gives the nth prime number
// NextPrime: the smallest prime larger than `n`
// PrimeFactors
// Divisors

// # Combinatorials
// Binomial
// Fibonacci

/*

## THEORY OF OPERATIONS OF PRECEDENCE

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
        simplify: (ce, ops) => processAbs(ce, ops[0], 'simplify'),
        evaluate: (ce, ops) => processAbs(ce, ops[0], 'evaluate'),
        N: (ce, ops) => processAbs(ce, ops[0], 'N'),
      },
    },

    Add: {
      wikidata: 'Q32043',
      associative: true,
      commutative: true,
      threadable: true,
      idempotent: true,
      complexity: 1300,
      hold: 'all',
      signature: {
        domain: 'NumericFunctions',
        codomain: (ce, args) =>
          domainAdd(
            ce,
            args.map((x) => x.domain)
          ),
        // canonical: (ce, args) => canonicalAdd(ce, args), // never called: shortpath
        simplify: (ce, ops) => simplifyAdd(ce, ops),
        evaluate: (ce, ops) => evalAdd(ce, ops),
        N: (ce, ops) => evalAdd(ce, ops, 'N'),
      },
    },

    Ceil: {
      description: 'Rounds a number up to the next largest integer',
      complexity: 1250,
      signature: {
        domain: ['FunctionOf', 'Numbers', 'Integers'],
        evaluate: (_ce, ops) =>
          applyN(
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

      signature: {
        domain: ['FunctionOf', 'Numbers', 'Numbers'],
        evaluate: (ce, ops) =>
          applyN(
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
      // - if numer product of numbers, or denom product of numbers,
      // i.e. √2x/2 -> 0.707x, 2/√2x -> 1.4142x

      signature: {
        domain: ['FunctionOf', 'Numbers', 'Numbers', 'Numbers'],
        canonical: (ce, args) => {
          args = checkNumericArgs(ce, args, 2);

          const [numer, denom] = args;
          if (args.length !== 2) return ce._fn('Divide', args);
          return ce.div(numer, denom);
        },
        simplify: (ce, args) => simplifyDivide(ce, args[0], args[1]),
        evaluate: (ce, ops) =>
          apply2N(
            ops[0],
            ops[1],
            (n, d) => n / d,
            (n, d) => n.div(d),
            (n, d) => n.div(d)
          ),
      },
    },

    Exp: {
      wikidata: 'Q168698',
      threadable: true,
      complexity: 3500,
      // Exp(x) -> e^x

      signature: {
        domain: ['FunctionOf', 'Numbers', 'Numbers'],
        canonical: (ce, args) => {
          args = checkNumericArgs(ce, args, 1);
          if (args.length !== 1) return ce._fn('Power', [ce.E, ...args]);
          return ce.pow(ce.E, args[0]);
        },
      },
    },

    Factorial: {
      description: 'Factorial Function',
      wikidata: 'Q120976',
      complexity: 9000,

      signature: {
        domain: ['FunctionOf', 'Numbers', 'Numbers'],
        evaluate: (ce, ops) => {
          const n = asSmallInteger(ops[0]);
          if (n !== null && n >= 0) {
            if (!bignumPreferred(ce)) return ce.number(factorial(n));
            return ce.number(bigFactorial(ce, ce.bignum(n)));
          }
          const num = ops[0].numericValue;
          if (num !== null && num instanceof Complex)
            return ce.number(gammaComplex(num.add(1)));

          const f = asFloat(ops[0]);
          if (f !== null) return ce.number(gamma(1 + f));

          return undefined;
        },
      },
    },

    Factorial2: {
      description: 'Double Factorial Function',
      complexity: 9000,

      signature: {
        domain: ['FunctionOf', 'Numbers', 'Numbers'],
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

      signature: {
        domain: ['FunctionOf', 'Numbers', 'ExtendedRealNumbers'],
        evaluate: (ce, ops) =>
          applyN(
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

      signature: {
        domain: ['FunctionOf', 'Numbers', 'Numbers'],
        N: (ce, ops) =>
          applyN(
            ops[0],
            (x) => gamma(x),
            (x) => bigGamma(ce, x),
            (x) => gammaComplex(x)
          ),
      },
    },

    GammaLn: {
      complexity: 8000,

      signature: {
        domain: ['FunctionOf', 'Numbers', 'Numbers'],
        N: (ce, ops) =>
          applyN(
            ops[0],
            (x) => gammaln(x),
            (x) => bigLngamma(ce, x),
            (x) => lngammaComplex(x)
          ),
      },
    },

    Ln: {
      description: 'Natural Logarithm',
      wikidata: 'Q204037',
      complexity: 4000,

      signature: {
        domain: ['FunctionOf', 'Numbers', 'Numbers'],
        N: (ce, ops) =>
          applyN(
            ops[0],
            (x) => (x >= 0 ? Math.log(x) : ce.complex(x).log()),
            (x) => (!x.isNeg() ? x.ln() : ce.complex(x.toNumber()).log()),
            (z) => z.log()
          ),
      },
    },

    Log: {
      description: 'Log(z, b = 10) = Logarithm of base b',
      wikidata: 'Q11197',
      complexity: 4100,

      signature: {
        domain: ['FunctionOf', 'Numbers', ['OptArg', 'Numbers'], 'Numbers'],
        canonical: (ce, ops) => {
          if (ops.length === 1)
            return ce._fn('Log', [checkArg(ce, ops[0], 'Numbers')]);

          ops = checkNumericArgs(ce, ops, 2);
          if (ops.length !== 2) return ce._fn('Log', ops);
          const [arg, base] = ops;
          if (base.numericValue === 10) return ce._fn('Log', [arg]);
          return ce._fn('Log', [arg, base]);
        },
        N: (ce, ops) => {
          if (ops[1] === undefined)
            return applyN(
              ops[0],
              (x) =>
                x >= 0 ? Math.log10(x) : ce.complex(x).log().div(Math.LN10),
              (x) =>
                !x.isNeg()
                  ? Decimal.log10(x)
                  : ce.complex(x.toNumber()).log().div(Math.LN10),
              (z) => z.log().div(Math.LN10)
            );
          return apply2N(
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

      signature: {
        domain: ['FunctionOf', 'Numbers', 'Numbers'],

        N: (ce, ops) =>
          applyN(
            ops[0],
            (x) => (x >= 0 ? Math.log2(x) : ce.complex(x).log().div(Math.LN2)),
            (x) =>
              x.isNeg()
                ? Decimal.log10(x)
                : ce.complex(x.toNumber()).log().div(Math.LN2),
            (z) => z.log().div(Math.LN2)
          ),
      },
    },

    Lg: {
      description: 'Base-10 Logarithm',
      wikidata: 'Q966582',
      complexity: 4100,

      signature: {
        domain: ['FunctionOf', 'Numbers', 'Numbers'],
        N: (ce, ops) =>
          applyN(
            ops[0],
            (x) =>
              x >= 0 ? Math.log10(x) : ce.complex(x).log().div(Math.LN10),
            (x) =>
              !x.isNeg()
                ? Decimal.log10(x)
                : ce.complex(x.toNumber()).log().div(Math.LN10),
            (z) => z.log().div(Math.LN10)
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

      signature: {
        domain: 'NumericFunctions',
        // Never called: fastpath
        // canonical: (ce, args) => {
        //   return canonicalMultiply(ce, args);
        // },
        simplify: (ce, ops) => simplifyMultiply(ce, ops),
        evaluate: (ce, ops) => evalMultiply(ce, ops),
        N: (ce, ops) => evalMultiply(ce, ops, 'N'),
      },
    },

    Negate: {
      description: 'Additive Inverse',
      wikidata: 'Q715358',
      complexity: 2000,

      signature: {
        domain: ['FunctionOf', 'Numbers', 'Numbers'],
        codomain: (ce, args) => {
          const arg = args[0].domain;
          if (!arg.base) return arg;
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
        canonical: (ce, args) => {
          args = checkNumericArgs(ce, args);
          if (args.length !== 1) return ce._fn('Negate', args);

          return ce.neg(args[0]);
        },
        simplify: (ce, ops) => processNegate(ce, ops[0], 'simplify'),
        evaluate: (ce, ops) => processNegate(ce, ops[0], 'evaluate'),
        N: (ce, ops) => processNegate(ce, ops[0], 'N'),
        sgn: (_ce, args): -1 | 0 | 1 | undefined => {
          const s = args[0].sgn;
          if (s === undefined || s === null) return undefined;
          if (s === 0) return 0;
          if (s > 0) return -1;
          if (s < 0) return +1;
          return undefined;
        },
      },
    },

    Power: {
      wikidata: 'Q33456',
      commutative: false,
      complexity: 3500,
      signature: {
        domain: ['FunctionOf', 'Numbers', 'Numbers', 'Numbers'],
        canonical: (ce, args) => {
          args = checkNumericArgs(ce, args, 2);
          if (args.length !== 2) return ce._fn('Power', args);

          return ce.pow(args[0], args[1]);
        },
        simplify: (ce, ops) => processPower(ce, ops[0], ops[1], 'simplify'),
        evaluate: (ce, ops) => processPower(ce, ops[0], ops[1], 'evaluate'),
        N: (ce, ops) => {
          // @fastpath
          if (
            ce.numericMode === 'machine' &&
            typeof ops[0].numericValue === 'number' &&
            typeof ops[1].numericValue === 'number'
          )
            return ce.number(
              Math.pow(ops[0].numericValue, ops[1].numericValue)
            );
          return processPower(ce, ops[0], ops[1], 'N');
        },
        // Defined as RealNumbers for all power in RealNumbers when base > 0;
        // when x < 0, only defined if n is an integer
        // if x is a non-zero complex, defined as ComplexNumbers
        // Square root of a prime is irrational (AlgebraicNumbers)
        // https://proofwiki.org/wiki/Square_Root_of_Prime_is_Irrational
        // evalDomain: (ce, base: BoxedExpression, power: BoxedExpression) ;
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
        canonical: (ce, args) => {
          args = canonical(flattenSequence(args));

          if (args.length === 0)
            return ce._fn('Rational', [ce.error('missing')]);

          if (args.length === 1)
            return ce._fn('Rational', [
              checkArg(ce, args[0], 'ExtendedRealNumbers'),
            ]);

          args = checkArgs(ce, args, ['Integers', 'Integers']);

          if (args.length !== 2 || !args[0].isValid || !args[1].isValid)
            return ce._fn('Rational', args);

          return ce.div(args[0], args[1]);
        },
        simplify: (ce, ops) => {
          if (ops.length !== 2) return undefined;
          return simplifyDivide(ce, ops[0], ops[1]);
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
          const f = asFloat(ops[0].N());
          if (f === null) return undefined;
          return ce.number(rationalize(f));
        },
        N: (ce, ops) => {
          if (ops.length === 1) return ops[0];

          return apply2N(
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

      signature: {
        domain: ['FunctionOf', 'Numbers', 'Numbers', 'Numbers'],
        canonical: (ce, args) => {
          args = checkNumericArgs(ce, args, 2);

          const [base, exp] = args;
          if (args.length !== 2 || !base.isValid || !exp.isValid)
            return ce._fn('Root', args);

          return ce.pow(base, ce.inv(exp));
        },
      },
    },

    Round: {
      complexity: 1250,

      signature: {
        domain: ['FunctionOf', 'Numbers', 'Numbers'],
        evaluate: (ce, ops) =>
          applyN(
            ops[0],
            Math.round,
            (x) => x.round(),
            (x) => x.round(0)
          ),
      },
    },

    Sign: {
      complexity: 1200,

      signature: {
        domain: ['FunctionOf', 'Numbers', 'Integers'],
        simplify: (ce, ops) => {
          const s = ops[0].sgn;
          if (s === 0) return ce.Zero;
          if (s === 1) return ce.One;
          if (s === -1) return ce.NegativeOne;
          return undefined;
        },
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

      signature: {
        domain: ['FunctionOf', 'Numbers', 'Numbers'],
        canonical: (ce, args) => {
          args = canonical(flattenSequence(args));
          if (args.length !== 1) return ce._fn('Sqrt', args);
          return ce.pow(args[0], ce.Half);
        },
        simplify: (ce, ops) => processSqrt(ce, ops[0], 'simplify'),
        evaluate: (ce, ops) => processSqrt(ce, ops[0], 'evaluate'),
        N: (ce, ops) => processSqrt(ce, ops[0], 'N'),
        // evalDomain: Square root of a prime is irrational
        // https://proofwiki.org/wiki/Square_Root_of_Prime_is_Irrational
      },
    },

    Square: {
      wikidata: 'Q3075175',
      complexity: 3100,

      signature: {
        domain: ['FunctionOf', 'Numbers', 'Numbers'],
        canonical: (ce, args) => {
          args = canonical(flattenSequence(args));
          if (args.length !== 1) return ce._fn('Square', args);
          return ce.pow(args[0], ce.number(2));
        },
      },
    },

    Subtract: {
      wikidata: 'Q40754',
      complexity: 1350,

      signature: {
        domain: ['FunctionOf', 'Numbers', ['OptArg', 'Numbers'], 'Numbers'],
        canonical: (ce, args) => {
          // Not necessarily legal, but probably what was intended:
          // ['Subtract', 'x'] -> ['Negate', 'x']
          if (args.length === 1) {
            const x = checkArg(ce, args[0], 'Numbers');
            if (x.isValid) return ce.neg(x);
          }

          args = checkNumericArgs(ce, args, 2);
          const [a, b] = args;
          if (args.length !== 2 || !a.isValid || !b.isValid)
            return ce._fn('Subtract', args);
          return ce.add([a, ce.neg(b)]);
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
      domain: 'TranscendentalNumbers',
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
      domain: 'TranscendentalNumbers',
      flags: { algebraic: false, real: true },
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
      flags: { algebraic: true },
      holdUntil: 'simplify',
      value: ['Divide', ['Add', 1, ['Sqrt', 5]], 2],
    },
    CatalanConstant: {
      domain: 'RealNumbers',
      flags: { algebraic: undefined }, // Not proven irrational or transcendental

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
      flags: { algebraic: undefined }, // Not proven irrational or transcendental
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
  // Arithmetic on collections: Min, Max, Sum, Product
  //
  {
    Max: {
      description: 'Maximum of two or more numbers',
      complexity: 1200,
      signature: {
        domain: ['FunctionOf', ['VarArg', 'Values'], 'Numbers'],
        simplify: (ce, ops) => {
          if (ops.length === 0) return ce.NegativeInfinity;
          if (ops.length === 1) return ops[0];
          return ce.fn('Max', ops);
        },
        evaluate: (ce, ops) => {
          if (ops.length === 0) return ce.NegativeInfinity;

          let result: BoxedExpression | undefined = undefined;
          const rest: BoxedExpression[] = [];

          for (const op of ops) {
            if (!op.isNumber || op.numericValue === undefined) rest.push(op);
            else if (!result || op.isGreater(result)) result = op;
          }
          if (rest.length > 0)
            return ce.box(result ? ['Max', result, ...rest] : ['Max', ...rest]);
          return result ?? ce.NaN;
        },
      },
    },

    Min: {
      description: 'Minimum of two or more numbers',
      complexity: 1200,

      signature: {
        domain: ['FunctionOf', ['VarArg', 'Values'], 'Numbers'],
        simplify: (ce, ops) => {
          if (ops.length === 0) return ce.NegativeInfinity;
          if (ops.length === 1) return ops[0];
          return ce.fn('Min', ops);
        },
        evaluate: (ce, ops) => {
          if (ops.length === 0) return ce.NegativeInfinity;

          let result: BoxedExpression | undefined = undefined;
          const rest: BoxedExpression[] = [];

          for (const op of ops) {
            if (!op.isNumber || op.numericValue === undefined) rest.push(op);
            else if (!result || op.isLess(result)) result = op;
          }
          if (rest.length > 0)
            return ce.box(result ? ['Min', result, ...rest] : ['Min', ...rest]);
          return result ?? ce.NaN;
        },
      },
    },

    Product: {
      wikidata: 'Q901718',
      complexity: 1000,
      hold: 'first',
      signature: {
        domain: [
          'FunctionOf',
          'Anything',
          // [
          //   'OptArg',
          'Tuples',
          // ['Tuple', 'Symbols', ['OptArg', 'Integers'], ['OptArg', 'Integers']],
          // ],
          'Numbers',
        ],
        // codomain: (ce, args) => domainAdd(ce, args),
        // The 'body' and 'range' need to be interpreted by canonicalMultiplication(). Don't canonicalize them yet.
        canonical: (ce, ops) => canonicalProduct(ce, ops[0], ops[1]),
        simplify: (ce, ops) =>
          evalMultiplication(ce, ops[0], ops[1], 'simplify'),
        evaluate: (ce, ops) =>
          evalMultiplication(ce, ops[0], ops[1], 'evaluate'),
        N: (ce, ops) => evalMultiplication(ce, ops[0], ops[1], 'N'),
      },
    },

    Sum: {
      wikidata: 'Q218005',
      complexity: 1000,
      hold: 'all',
      signature: {
        domain: [
          'FunctionOf',
          'Anything',
          // [
          //   'OptArg',
          'Tuples',
          // ['Tuple', 'Symbols', ['OptArg', 'Integers'], ['OptArg', 'Integers']],
          // ],
          'Numbers',
        ],
        canonical: (ce, ops) => canonicalSummation(ce, ops[0], ops[1]),
        simplify: (ce, ops) => evalSummation(ce, ops[0], ops[1], 'simplify'),
        evaluate: (ce, ops) => evalSummation(ce, ops[0], ops[1], 'evaluate'),
        N: (ce, ops) => evalSummation(ce, ops[0], ops[1], 'N'),
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
        codomain: (_ce, args) => args[0].domain,
      },
    },
    FromDigits: {
      description: `\`FromDigits(s, base=10)\` \
      return an integer representation of the string \`s\` in base \`base\`.`,
      // @todo could accept `0xcafe`, `0b01010` or `(deadbeef)_16` as string formats
      // @todo could accept "roman"... as base
      // @todo could accept optional third parameter as the (padded) length of the output
      signature: {
        domain: ['FunctionOf', 'Strings', ['OptArg', 'Integers'], 'Integers'],
        evaluate: (ce, ops) => {
          const op1 = ops[0];
          if (!op1.string)
            return ce.error(
              ['incompatible-domain', 'Strings', op1.domain],
              op1
            );

          const op2 = ops[1];
          if (op2.isNothing) return ce.number(Number.parseInt(op1.string, 10));
          if (op2.numericValue === null) {
            return ce.error(['unexpected-base', op2.latex], op2);
          }
          const base = asFloat(op2)!;
          if (!Number.isInteger(base) || base < 2 || base > 36)
            return ce.error(['unexpected-base', base], op2);

          const [value, rest] = fromDigits(op1.string, base);

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
      signature: {
        domain: ['FunctionOf', 'Integers', ['OptArg', 'Integers'], 'Strings'],
        evaluate: (ce, ops) => {
          const op1 = ops[0];
          const val = asFloat(op1) ?? NaN;
          if (Number.isNaN(val) || !Number.isInteger(val)) {
            return ce.error(
              ['incompatible-domain', 'Integers', op1.domain],
              op1
            );
          }

          const op2 = ops[1];
          if (op2.isNothing) {
            const op1Num = op1.numericValue;
            if (typeof op1Num === 'number')
              return ce.string(Math.abs(op1Num).toString());
            if (op1Num instanceof Decimal)
              return ce.string(op1Num.abs().toString());
            return ce.string(
              Math.abs(Math.round(asFloat(op1) ?? NaN)).toString()
            );
          }

          if (asSmallInteger(op2) === null) {
            return ce.error(
              ['incompatible-domain', 'Integers', op2.domain],
              op2
            );
          }
          const base = asSmallInteger(op2)!;
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
      if (num instanceof Decimal) return ce.number(num.abs());
      if (num instanceof Complex) return ce.number(num.abs());
      if (isMachineRational(num))
        return ce.number(
          mode === 'N' ? Math.abs(num[0] / num[1]) : [Math.abs(num[0]), num[1]]
        );

      if (isBigRational(num)) {
        const [n, d] = num;
        return ce.number(
          mode === 'N'
            ? ce.bignum(n).div(ce.bignum(d)).abs()
            : [n > 0 ? n : -n, d]
        );
      }
    }
  }
  if (arg.isNonNegative) return arg;
  if (arg.isNegative) return ce.neg(arg);
  return undefined;
}

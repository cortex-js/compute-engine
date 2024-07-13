import Complex from 'complex.js';
import { Decimal } from 'decimal.js';
import {
  gamma as gammaComplex,
  gammaln as lngammaComplex,
} from '../numerics/numeric-complex';
import {
  factorial as bigFactorial,
  factorial2 as bigFactorial2,
  gamma as bigGamma,
  gammaln as bigLngamma,
  gcd as bigGcd,
  lcm as bigLcm,
} from '../numerics/numeric-bignum';
import {
  factorial,
  factorial2,
  fromDigits,
  gamma,
  gammaln,
  gcd,
  lcm,
} from '../numerics/numeric';
import {
  isBigRational,
  isMachineRational,
  rationalize,
} from '../numerics/rationals';
import { IdentifierDefinitions } from '../public';
import { bignumPreferred, complexAllowed } from '../boxed-expression/utils';
import {
  domainAdd,
  evalSummation,
  canonicalSummation,
  canonicalAdd,
  simplifyAdd,
} from './arithmetic-add';
import {
  simplifyMultiply,
  evalMultiply,
  evalMultiplication,
  canonicalProduct,
} from './arithmetic-multiply';
import {
  canonicalDivide,
  evalDivide,
  evalNDivide,
  simplifyDivide,
} from './arithmetic-divide';
import { processPower } from './arithmetic-power';
import { applyN, apply2N, canonical } from '../symbolic/utils';
import {
  checkDomain,
  checkDomains,
  checkNumericArgs,
} from '../boxed-expression/validate';
import { flattenOps, flattenSequence } from '../symbolic/flatten';
import { each, isCollection } from '../collection-utils';
import { BoxedNumber } from '../boxed-expression/boxed-number';
import { IComputeEngine, BoxedExpression } from '../boxed-expression/public';
import {
  asMachineInteger,
  asFloat,
  asRational,
  asBignum,
} from '../boxed-expression/numerics';
import { expandProducts } from '../symbolic/expand';

// When considering processing an arithmetic expression, the following
// are the core canonical arithmetic operations that should be considered:
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
        result: (ce, ops) =>
          domainAdd(
            ce,
            ops.map((x) => x.domain)
          ),
        // canonical: (ce, args) => canonicalAdd(ce, args), // never called: shortpath
        simplify: (ce, ops) =>
          simplifyAdd(
            ce,
            ops.map((x) => x.simplify())
          ),
        evaluate: (ce, ops) =>
          simplifyAdd(
            ce,
            ops.map((x) => x.evaluate())
          ),

        N: (ce, ops) =>
          simplifyAdd(
            ce,
            ops.map((x) => x.N())
          ),
      },
    },

    Ceil: {
      description: 'Rounds a number up to the next largest integer',
      complexity: 1250,
      threadable: true,
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
      threadable: true,
      // - if numer product of numbers, or denom product of numbers,
      // i.e. √2x/2 -> 0.707x, 2/√2x -> 1.4142x

      signature: {
        params: ['Numbers'],
        restParam: 'Numbers',
        result: 'Numbers',

        canonical: (ce, args) => {
          // @fastpath: this code path is never taken, canonicalDivide is called directly
          args = checkNumericArgs(ce, args);
          let result = args[0];
          if (!result) return ce.error('missing');
          if (args.length < 2) return result;
          const rest = args.slice(1);
          for (const x of rest) result = canonicalDivide(result, x);

          return result;
        },
        simplify: (ce, args) => simplifyDivide(ce, args[0], args[1]),
        evaluate: (ce, ops) => evalDivide(ce, ops[0], ops[1]),
        N: (ce, ops) => evalNDivide(ce, ops[0], ops[1]),
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
        canonical: (ce, args) => {
          // The canonical handler is responsible for arg validation
          args = checkNumericArgs(ce, args, 1);
          if (args.length !== 1) return ce.function('Power', [ce.E, ...args]);
          return ce.pow(ce.E, args[0]);
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
        canonical: (ce, args) => {
          const base = args[0];
          if (base instanceof BoxedNumber && base.isNegative)
            return ce._fn('Factorial', [base.neg()]).neg();
          return ce._fn('Factorial', [base]);
        },
        evaluate: (ce, ops) => {
          const n = asMachineInteger(ops[0]);
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
      threadable: true,

      signature: {
        params: ['Numbers'],
        result: 'Numbers',
        evaluate: (ce, ops) => {
          // 2^{\frac{n}{2}+\frac{1}{4}(1-\cos(\pi n))}\pi^{\frac{1}{4}(\cos(\pi n)-1)}\Gamma\left(\frac{n}{2}+1\right)

          const n = asMachineInteger(ops[0]);
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
      threadable: true,

      signature: {
        params: ['Numbers'],
        result: 'Numbers',
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
      threadable: true,

      signature: {
        params: ['Numbers'],
        result: 'Numbers',
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
      threadable: true,

      signature: {
        params: ['Numbers'],
        result: 'Numbers',
        simplify: processLn,
        evaluate: processLn,
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
      threadable: true,

      signature: {
        domain: ['FunctionOf', 'Numbers', ['OptArg', 'Numbers'], 'Numbers'],
        canonical: (ce, ops) => {
          if (ops.length === 1)
            return ce._fn('Log', [checkDomain(ce, ops[0], 'Numbers')]);

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
      threadable: true,

      signature: {
        params: ['Numbers'],
        result: 'Numbers',

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
      threadable: true,

      signature: {
        params: ['Numbers'],
        result: 'Numbers',
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

    Mod: {
      description: 'Modulo',
      wikidata: 'Q1799665',
      complexity: 2500,
      threadable: true,

      signature: {
        domain: ['FunctionOf', 'Numbers', 'Numbers', 'Numbers'],
        evaluate: (ce, ops) => {
          if (ops.length !== 2) return undefined;
          const [lhs, rhs] = ops;
          // @todo: use .numericValue instead, and handle bignum,
          // complexnumbers, rationals, etc.
          const nLhs = lhs.value;
          const nRhs = rhs.value;
          if (typeof nLhs !== 'number') return undefined;
          if (typeof nRhs !== 'number') return undefined;
          // In JavaScript, the % is remainder, not modulo
          // so adapt it to return a modulo
          return ce.number(((nLhs % nRhs) + nRhs) % nRhs);
        },
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
        // Never called: fastpath
        // canonical: (ce, args) => canonicalMultiply(ce, args)
        //
        simplify: (ce, ops) => simplifyMultiply(ce, ops),

        evaluate: (ce, ops) => {
          // @fixme: move call to expandProducts() and flattenOps() inside
          // evalMultiply (once ce.mul() has been changed to not evaluate)
          ops = ops.map((x) => x.evaluate());
          const expr = expandProducts(ce, ops);
          if (expr !== null) {
            if (expr.head !== 'Multiply') return expr.evaluate();
            ops = flattenOps(expr.ops!, 'Multiply');
          }
          return evalMultiply(ce, ops);
        },
        N: (ce, ops) => {
          ops = ops.map((x) => x.N());
          const expr = expandProducts(ce, ops);
          if (expr !== null) {
            if (expr.head !== 'Multiply') return expr.N();
            ops = flattenOps(expr.ops!, 'Multiply');
          }
          return evalMultiply(ce, ops, 'N');
        },
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
        canonical: (ce, args) => {
          args = checkNumericArgs(ce, args);
          if (args.length === 0) return ce.error('missing');

          return args[0].neg();
        },
        simplify: (ce, ops) => ops[0].neg(),
        evaluate: (ce, ops) => ops[0].neg(),
        N: (ce, ops) => ops[0].neg(),
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

    PlusMinus: {
      description: 'Plus or Minus',
      wikidata: 'Q120812',
      complexity: 1200,
      involution: true,

      signature: {
        domain: ['FunctionOf', 'Values', 'Tuples'],
        evaluate: (ce, ops) => {
          if (ops.length !== 1) return undefined;
          return ce.box(['Pair', ops[0], ops[0].neg()]);
        },
      },
    },

    Power: {
      wikidata: 'Q33456',
      commutative: false,
      threadable: true,
      complexity: 3500,
      signature: {
        domain: ['FunctionOf', 'Numbers', 'Numbers', 'Numbers'],
        canonical: (ce, args) => {
          args = checkNumericArgs(ce, args, 2);
          if (args.length !== 2) return ce._fn('Power', args);
          const [base, exp] = args;
          // If the base is a literal number and negative, treat it as a Negate
          // i.e. -2^3 -> -(2^3)
          if (base instanceof BoxedNumber && base.isNegative)
            return ce.pow(base, exp).neg();

          return ce.pow(base, exp);
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
          args = flattenSequence(canonical(args));

          if (args.length === 0)
            return ce._fn('Rational', [ce.error('missing')]);

          if (args.length === 1)
            return ce._fn('Rational', [
              checkDomain(ce, args[0], 'ExtendedRealNumbers'),
            ]);

          args = checkDomains(ce, args, ['Integers', 'Integers']);

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
            const [n, d] = [asMachineInteger(ops[0]), asMachineInteger(ops[1])];
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
      threadable: true,

      signature: {
        params: ['Numbers', 'Numbers'],
        result: 'Numbers',
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
      threadable: true,

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
      threadable: true,

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
      threadable: true,

      signature: {
        domain: ['FunctionOf', 'Numbers', 'Numbers'],
        canonical: (ce, args) => {
          args = flattenSequence(canonical(args));
          if (args.length !== 1) return ce._fn('Sqrt', args);
          return ce.pow(args[0], ce.Half);
        },
        simplify: (ce, ops) => ops[0].sqrt(),
        evaluate: (ce, ops) => ops[0].sqrt(),
        N: (ce, ops) => {
          const n = ops[0].numericValue;
          if (n === null) return ops[0].sqrt();
          return ce._fromNumericValue(ce._numericValue(n).sqrt().N());
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
        domain: ['FunctionOf', 'Numbers', 'Numbers'],
        canonical: (ce, args) => {
          args = flattenSequence(canonical(args));
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
          const first = args[0];
          if (!first) return ce.error('missing');
          const rest = args.slice(1);
          return canonicalAdd(
            ce,
            flattenOps([first, ...rest.map((x) => x.neg())], 'Add')
          );
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

  {
    GCD: {
      description: 'Greatest Common Divisor',
      complexity: 1200,
      threadable: false, // The function take a variable number of arguments,
      // including collections
      signature: {
        domain: ['FunctionOf', ['VarArg', 'Anything'], 'Numbers'],
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
          if (ops.length === 0) return ce.box(['Sequence']);
          const op = ops[0];
          if (op.head === 'Rational' || op.head === 'Divide') return op.op1;
          const num = asRational(op);
          if (num !== undefined) return ce.number(num[0]);
          return ce._fn('Numerator', canonical(ops));
        },
        evaluate: (ce, ops) => {
          if (ops.length === 0) return ce.box(['Sequence']);
          const op = ops[0];
          if (op.head === 'Rational' || op.head === 'Divide')
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
          if (ops.length === 0) return ce.box(['Sequence']);
          const op = ops[0];
          if (op.head === 'Rational' || op.head === 'Divide') return op.op2;
          const num = asRational(op);
          if (num !== undefined) return ce.number(num[1]);
          return ce._fn('Denominator', canonical(ops));
        },
        evaluate: (ce, ops) => {
          if (ops.length === 0) return ce.box(['Sequence']);
          const op = ops[0];
          if (op.head === 'Rational' || op.head === 'Divide')
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
          if (ops.length === 0) return ce.box(['Sequence']);
          const op = ops[0];
          if (op.head === 'Rational' || op.head === 'Divide')
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
          if (ops.length === 0) return ce.box(['Sequence']);
          const op = ops[0];
          if (op.head === 'Rational' || op.head === 'Divide')
            return ce._fn('Sequence', op.ops!);
          const num = asRational(op);
          if (num !== undefined)
            return ce._fn('Sequence', [ce.number(num[0]), ce.number(num[1])]);
          return ce._fn('NumeratorDenominator', canonical(ops));
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
        simplify: (ce, ops) => {
          if (ops.length === 0) return ce.NegativeInfinity;
          if (ops.length === 1) return ops[0];
          return ce.box(['Max', ...ops]);
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
        simplify: (ce, ops) => {
          if (ops.length === 0) return ce.PositiveInfinity;
          if (ops.length === 1) return ops[0];
          return ce.box(['Min', ...ops]);
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
        simplify: (ce, ops) => {
          if (ops.length === 0) return ce.NegativeInfinity;
          if (ops.length === 1) return ops[0];
          return ce.box(['Min', ...ops]);
        },
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
        simplify: (ce, ops) => {
          if (ops.length === 0) return ce.PositiveInfinity;
          if (ops.length === 1) return ops[0];
          return ce.box(['Min', ...ops]);
        },
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
          ['OptArg', 'Tuples'],
          // ['Tuple', 'Symbols', ['OptArg', 'Integers'], ['OptArg', 'Integers']],
          // ],
          'Numbers',
        ],
        // codomain: (ce, args) => domainAdd(ce, args),
        // The 'body' and 'range' need to be interpreted by canonicalMultiplication(). Don't canonicalize them yet.
        canonical: (ce, ops) => canonicalProduct(ce, ops[0], ops[1]),
        simplify: (ce, ops) => evalMultiplication(ce, ops, 'simplify'),
        evaluate: (ce, ops) => evalMultiplication(ce, ops, 'evaluate'),
        N: (ce, ops) => evalMultiplication(ce, ops, 'N'),
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
          ['OptArg', 'Tuples'],
          // ['Tuple', 'Symbols', ['OptArg', 'Integers'], ['OptArg', 'Integers']],
          // ],
          'Numbers',
        ],
        canonical: (ce, ops) => canonicalSummation(ce, ops[0], ops[1]),
        simplify: (ce, ops) => evalSummation(ce, ops, 'simplify'),
        evaluate: (ce, ops) => evalSummation(ce, ops, 'evaluate'),
        N: (ce, ops) => evalSummation(ce, ops, 'N'),
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

          const base = asFloat(op2)!;
          if (base && (!Number.isInteger(base) || base < 2 || base > 36))
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
          const val = asFloat(op1) ?? NaN;
          if (Number.isNaN(val) || !Number.isInteger(val))
            return ce.domainError('Integers', op1.domain, op1);

          const op2 = ops[1] ?? ce.Nothing;
          if (op2.symbol === 'Nothing') {
            const op1Num = op1.numericValue;
            if (typeof op1Num === 'number')
              return ce.string(Math.abs(op1Num).toString());
            if (op1Num instanceof Decimal)
              return ce.string(op1Num.abs().toString());
            return ce.string(
              Math.abs(Math.round(asFloat(op1) ?? NaN)).toString()
            );
          }

          if (asMachineInteger(op2) === null)
            return ce.domainError('Integers', op2.domain, op2);

          const base = asMachineInteger(op2)!;
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
  if (item.head === 'Interval') {
    const b = upper ? item.op2 : item.op1;

    if (!b.isNumber || b.numericValue === undefined) return [undefined, [item]];
    return [b, []];
  }

  // A range is discrete, the last element may not be included
  if (item.head === 'Range') {
    if (item.nops === 1) item = upper ? item.op1 : ce.One;
    else if (!upper) {
      item = item.op1;
    } else {
      const step = item.nops === 2 ? 1 : asFloat(item.op3);
      if (step === null || !isFinite(step)) return [undefined, [item]];
      const [a, b] = [asFloat(item.op1), asFloat(item.op2)];
      if (a === null || b === null) return [undefined, [item]];
      const steps = Math.floor((b - a) / step);
      item = ce.number(a + step * steps);
    }

    return [item, []];
  }

  if (item.head === 'Linspace') {
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

  if (!item.isNumber || item.numericValue === undefined)
    return [undefined, [item]];
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
      result = asFloat(op);
      if (result === null || !Number.isInteger(result)) rest.push(op);
    } else {
      const d = asFloat(op);
      if (d && Number.isInteger(d)) result = fn(result, d);
      else rest.push(op);
    }
  }
  if (rest.length === 0) return result === null ? ce.One : ce.number(result);
  if (result === null) return ce._fn(mode, rest);
  return ce._fn(mode, [ce.number(result), ...rest]);
}

function processLn(ce: IComputeEngine, ops: ReadonlyArray<BoxedExpression>) {
  const n = ops[0];
  if (n.isZero) return ce.NaN;
  if (n.isOne) return ce.Zero;
  if (n.isNegativeOne && complexAllowed(ce))
    return ce._fn('Multiply', [ce.Pi, ce.I]);
  if (n.symbol === 'ExponentialE') return ce.One;
  if (n.head === 'Power' && n.op1.symbol === 'ExporentialE') return n.op2;
  if (n.head === 'Power') {
    const [base, exp] = n.ops!;
    return ce.evalMul(exp, ce.box(['Ln', base]).simplify());
  }
  if (n.head === 'Multiply') {
    const [a, b] = n.ops!;
    return ce.add(ce.box(['Ln', a]).simplify(), ce.box(['Ln', b]).simplify());
  }
  if (n.head === 'Divide') {
    const [a, b] = n.ops!;
    return ce.add(
      ce.box(['Ln', a]).simplify(),
      ce.box(['Ln', b]).neg().simplify()
    );
  }
}

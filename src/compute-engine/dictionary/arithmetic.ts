import { Complex } from 'complex.js';
import {
  gamma as gammaComplex,
  lngamma as lngammaComplex,
} from '../numerics/numeric-complex';
import {
  factorial as factorialDecimal,
  gamma as gammaDecimal,
  lngamma as lngammaDecimal,
} from '../numerics/numeric-decimal';
import {
  factorial,
  factorPower,
  fromDigits,
  gamma,
  lngamma,
  rationalize,
} from '../numerics/numeric';
import { BoxedExpression, Dictionary, IComputeEngine } from '../public';
import { complexAllowed, useDecimal } from '../boxed-expression/utils';
import { canonicalNegate, processNegate } from '../symbolic/negate';
import {
  canonicalAdd,
  domainAdd,
  numEvalAdd,
  processAdd,
} from './arithmetic-add';
import {
  canonicalMultiply,
  numEvalMultiply,
  processMultiply,
} from './arithmetic-multiply';
import { canonicalDivide } from './arithmetic-divide';
import { canonicalPower, processPower } from './arithmetic-power';

// @todo Future additions to the dictionary
// Re: real part
// Im: imaginary part
// Arg: argument (phase angle in radians)
// Conjugate: complex conjugate
// complex-cartesian (constructor)
// complex-polar
// LogOnePlus: { domain: 'Number' },
// mod (modulo). See https://numerics.diploid.ca/floating-point-part-4.html,
// regarding 'remainder' and 'truncatingRemainder'
// Lcm
// Gcd
// Sum
// Product
// Numerator
// Denominator
// Rationalize: convert an approximate number to a nearby rational
// Mod: modulo
// Boole

// # Prime Numbers:
// Prime: gives the nth prime number
// NextPrime: the smallest prime larger than `n`
// PrimeFactors
// Divisors

// # Combinatorials
// Binomial
// Fibonacci

export const ARITHMETIC_DICTIONARY: Dictionary[] = [
  {
    //
    // Functions
    //
    functions: [
      {
        name: 'Abs',
        domain: ['Function', 'ExtendedRealNumber', 'ExtendedRealNumber'],
        range: [0, +Infinity],
        wikidata: 'Q3317982', // magnitude 'Q120812 (for reals)
        threadable: true,
        idempotent: true,
        complexity: 1200,
        simplify: (ce, ops) => processAbs(ce, ops[0], 'simplify'),
        evaluate: (ce, ops) => processAbs(ce, ops[0], 'evaluate'),
        N: (ce, ops) => processAbs(ce, ops[0], 'N'),
      },

      {
        name: 'Add',
        wikidata: 'Q32043',
        associative: true,
        commutative: true,
        threadable: true,
        idempotent: true,
        domain: 'NumericFunction',
        complexity: 1300,
        canonical: (ce, args) => canonicalAdd(ce, args),
        simplify: (ce, ops) => processAdd(ce, ops, 'simplify'),
        evaluate: (ce, ops) => processAdd(ce, ops, 'evaluate'),
        N: (ce, ops) => numEvalAdd(ce, ops),
      },

      {
        name: 'Ceil',
        description: 'Rounds a number up to the next largest integer',
        complexity: 1250,
        domain: 'NumericFunction',
        evaluate: (ce, ops) => {
          const op1 = ops[0];
          if (op1.decimalValue) return ce.number(op1.decimalValue.ceil());
          if (op1.complexValue) return ce.number(op1.complexValue.ceil(0));
          if (op1.asFloat !== null) return ce.number(Math.ceil(op1.asFloat));

          return undefined;
        },
      },

      {
        name: 'Chop',
        associative: true,
        threadable: true,
        idempotent: true,
        complexity: 1200,
        domain: 'NumericFunction',
        N: (ce, ops) => {
          const op1 = ops[0];
          if (op1.decimalValue) return ce.number(ce.chop(op1.decimalValue));
          if (op1.complexValue) return ce.number(ce.chop(op1.complexValue));
          if (op1.asFloat !== null) return ce.number(ce.chop(op1.asFloat));

          return undefined;
        },
      },

      {
        // This function is converted during boxing, so unlikely to encounter
        name: 'Complex',
        wikidata: 'Q11567',
        domain: 'NumericFunction',
        complexity: 500,
      },

      {
        name: 'Divide',
        wikidata: 'Q1226939',
        domain: 'NumericFunction',
        complexity: 2500,
        // - if numer product of numbers, or denom product of numbers,
        // i.e. √2x/2 -> 0.707x, 2/√2x -> 1.4142x
        canonical: (ce, args) =>
          !args[0] || !args[1]
            ? ce.symbol('Missing')
            : canonicalDivide(ce, args[0], args[1]),
      },

      {
        name: 'Exp',
        domain: 'NumericFunction',
        wikidata: 'Q168698',
        threadable: true,
        complexity: 3500,
        // Exp(x) -> e^x
        canonical: (ce, args) =>
          !args[0]
            ? ce.symbol('Missing')
            : ce.power(ce.symbol('ExponentialE'), args[0]),
      },

      {
        name: 'Erf',
        description: 'Complementary Error Function',
        domain: 'NumericFunction',
        complexity: 7500,
      },

      {
        name: 'Erfc',
        description: 'Complementary Error Function',
        domain: 'NumericFunction',
        complexity: 7500,
      },

      {
        name: 'Factorial',
        description: 'The factorial function',
        wikidata: 'Q120976',
        complexity: 9000,
        domain: 'NumericFunction',
        evaluate: (ce, ops) => {
          const n = ops[0].asSmallInteger;
          if (n !== null && n >= 0) {
            if (!useDecimal(ce)) return ce.number(factorial(n));
            return ce.number(factorialDecimal(ce, ce.decimal(n)));
          }
          if (ops[0].complexValue)
            return ce.number(gammaComplex(ops[0].complexValue.add(1)));
          else if (ops[0].asFloat !== null)
            return ce.number(gamma(1 + ops[0].asFloat));

          return undefined;
        },
      },

      {
        name: 'Floor',
        wikidata: 'Q56860783',
        domain: ['Function', 'ExtendedRealNumber', 'ExtendedRealNumber'],
        complexity: 1250,
        evaluate: (ce, ops) => {
          if (ops[0].decimalValue)
            return ce.number(ops[0].decimalValue.floor());
          if (ops[0].complexValue)
            return ce.number(ops[0].complexValue.floor(0));
          if (ops[0].asFloat !== null)
            return ce.number(Math.floor(ops[0].asFloat));
          return undefined;
        },
      },

      {
        name: 'Gamma',
        wikidata: 'Q190573',
        domain: ['Function', 'Number', 'Number'],
        complexity: 8000,
        N: (ce, ops) => {
          if (ops[0].decimalValue)
            return ce.number(gammaDecimal(ce, ops[0].decimalValue));
          // @todo: should gammaComplex() be always called if complexAllowed()?
          if (ops[0].complexValue)
            return ce.number(gammaComplex(ops[0].complexValue));
          if (ops[0].asFloat !== null) return ce.number(gamma(ops[0].asFloat));
          return undefined;
        },
      },

      {
        name: 'LogGamma',
        domain: ['Function', 'Number', 'Number'],
        complexity: 8000,
        N: (ce, ops) => {
          if (ops[0].decimalValue)
            return ce.number(lngammaDecimal(ce, ops[0].decimalValue));
          // @todo: should lngammaComplex() be always called if complexAllowed()?
          if (ops[0].complexValue)
            return ce.number(lngammaComplex(ops[0].complexValue));
          if (ops[0].asFloat !== null)
            return ce.number(lngamma(ops[0].asFloat));
          return undefined;
        },
      },

      {
        name: 'Ln',
        description: 'Natural Logarithm',
        domain: ['Function', 'Number', 'Number'],
        wikidata: 'Q204037',
        complexity: 4000,
        N: (ce, ops) => {
          if (ops[0].decimalValue) return ce.number(ops[0].decimalValue.log());
          if (ops[0].complexValue) return ce.number(ops[0].complexValue.log());
          if (ops[0].asFloat !== null)
            return ce.number(Math.log(ops[0].asFloat));
          return undefined;
        },
      },

      {
        name: 'Log',
        description: 'Log(b, z) = Logarithm of base b',
        wikidata: 'Q11197',
        domain: ['Function', 'Number', 'Number', 'Number'],
        complexity: 4100,
        N: (ce, ops) => {
          const exponent = ops[0];
          const base = ops[1];
          if (exponent.decimalValue) {
            return ce.number(
              exponent.decimalValue
                .log()
                .div(base.decimalValue ?? base.asFloat ?? NaN)
            );
          }
          if (exponent.complexValue) {
            return ce.number(
              exponent.complexValue
                .log()
                .div(base.complexValue ?? base.asFloat ?? NaN)
            );
          }
          if (exponent.asFloat !== null) {
            return ce.number(
              Math.log(exponent.asFloat) / Math.log(base.asFloat ?? NaN)
            );
          }
          return undefined;
        },
      },

      {
        name: 'Lb',
        description: 'Base-2 Logarithm',
        domain: ['Function', 'Number', 'Number'],
        wikidata: 'Q581168',
        complexity: 4100,
        N: (ce, ops) => {
          const exponent = ops[0];
          if (exponent.decimalValue)
            return ce.number(exponent.decimalValue.log().div(ce.DECIMAL_TWO));
          if (exponent.complexValue)
            return ce.number(exponent.complexValue.log().div(ce.complex(2)));

          if (exponent.asFloat !== null)
            return ce.number(Math.log2(exponent.asFloat));
          return undefined;
        },
      },

      {
        name: 'Lg',
        description: 'Base-10 Logarithm',
        domain: ['Function', 'Number', 'Number'],
        wikidata: 'Q966582',
        complexity: 4100,
        N: (ce, ops) => {
          const exponent = ops[0];
          if (exponent.decimalValue)
            return ce.number(exponent.decimalValue.log().div(ce.decimal(10)));
          if (exponent.complexValue)
            return ce.number(exponent.complexValue.log().div(ce.complex(10)));

          if (exponent.asFloat !== null)
            return ce.number(Math.log10(exponent.asFloat));

          return undefined;
        },
      },

      {
        name: 'Multiply',
        domain: 'NumericFunction',
        wikidata: 'Q40276',
        associative: true,
        commutative: true,
        idempotent: true,
        complexity: 2100,
        canonical: (ce, args) => canonicalMultiply(ce, args),
        simplify: (ce, ops) => processMultiply(ce, ops, 'simplify'),
        evaluate: (ce, ops) => processMultiply(ce, ops, 'evaluate'),
        N: (ce, ops) => numEvalMultiply(ce, ops),
      },

      {
        name: 'Negate',
        description: 'Additive Inverse',
        wikidata: 'Q715358',
        domain: ['Function', 'Number', 'Number'],
        complexity: 2000,
        canonical: (ce, args) =>
          args[0] ? canonicalNegate(args[0]) : ce.box('Missing'),
        simplify: (ce, ops) => processNegate(ce, ops[0], 'simplify'),
        evaluate: (ce, ops) => processNegate(ce, ops[0], 'evaluate'),
        N: (ce, ops) => processNegate(ce, ops[0], 'N'),
        sgn: (ce, args): -1 | 0 | 1 | undefined => {
          const arg = args[0] ?? ce.symbol('Missing');
          if (arg.isZero) return 0;
          if (arg.isPositive) return -1;
          if (arg.isNegative) return +1;
          return undefined;
        },
      },

      {
        name: 'Power',
        domain: ['Function', 'Number', 'Number', 'Number'],
        wikidata: 'Q33456',
        commutative: false,
        complexity: 3500,
        canonical: (ce, args) => {
          const op1 = args[0] ?? ce.symbol('Missing');
          const op2 = args[1] ?? ce.symbol('Missing');
          return canonicalPower(ce, op1, op2) ?? ce._fn('Power', args);
        },
        simplify: (ce, ops) => processPower(ce, ops[0], ops[1], 'simplify'),
        evaluate: (ce, ops) => processPower(ce, ops[0], ops[1], 'evaluate'),
        N: (ce, ops) => processPower(ce, ops[0], ops[1], 'N'),
        // Defined as RealNumber for all power in RealNumber when base > 0;
        // when x < 0, only defined if n is an integer
        // if x is a non-zero complex, defined as ComplexNumber
        // Square root of a prime is irrational (AlgebraicNumber)
        // https://proofwiki.org/wiki/Square_Root_of_Prime_is_Irrational
        // evalDomain: (ce, base: BoxedExpression, power: BoxedExpression) ;
      },

      {
        name: 'Rational',
        domain: [
          'Function',
          'Number',
          ['Optional', 'Number'],
          'RationalNumber',
        ],
        complexity: 2400,
        canonical: (ce, args) =>
          args.length === 2
            ? canonicalDivide(ce, args[0], args[1])
            : ce._fn('Rational', args),
        simplify: (ce, ops) => {
          if (ops.length !== 2) return undefined;
          if (ops[0].asSmallInteger !== null && ops[1].asSmallInteger !== null)
            return ce.number([ops[0].asSmallInteger, ops[1].asSmallInteger]);
          return undefined;
        },
        evaluate: (ce, ops) => {
          if (ops.length === 2) {
            if (
              ops[0].asSmallInteger !== null &&
              ops[1].asSmallInteger !== null
            )
              return ce.number([ops[0].asSmallInteger, ops[1].asSmallInteger]);
            return undefined;
          }
          const f = ops[0].asFloat;
          if (f === null) return ops[0];

          const r = rationalize(f);
          if (typeof r === 'number') return ce.number(r);
          return ce.number([r[0], r[1]]);
        },
        N: (ce, ops) => {
          if (ops.length === 2) {
            if (
              ops[0].asSmallInteger === null ||
              ops[1].asSmallInteger === null
            )
              return undefined;
            return ce.number(ops[0].asSmallInteger / ops[1].asSmallInteger);
          }

          return undefined;
        },
      },

      {
        name: 'Root',
        domain: ['Function', 'Number', 'RationalNumber', 'Number'],
        complexity: 3200,
        canonical: (ce, args) => {
          const op1 = args[0] ?? ce.symbol('Missing');
          const op2 = args[1] ?? ce.symbol('Missing');
          const exp = ce.inverse(op2);
          return canonicalPower(ce, op1, exp) ?? ce._fn('Power', [op1, exp]);
        },
        N: (ce, ops) => {
          const base = ops[0];
          const root = ops[1];
          if (base.decimalValue)
            return ce.number(
              base.decimalValue.pow(ce.DECIMAL_ONE.div(root.asFloat ?? NaN))
            );
          if (base.complexValue) {
            const complexRoot = root.complexValue
              ? Complex.ONE.div(root.complexValue)
              : ce.complex(1 / (root.asFloat ?? NaN));
            return ce.number(base.complexValue.pow(complexRoot));
          }
          if (base.asFloat !== null)
            return ce.number(Math.pow(base.asFloat, root.asFloat ?? NaN));
          return undefined;
        },
      },

      {
        name: 'Round',
        domain: ['Function', 'Number', 'Number'],
        complexity: 1250,
        N: (ce, ops) => {
          if (ops[0].decimalValue)
            return ce.number(ops[0].decimalValue.round());
          if (ops[0].complexValue)
            return ce.number(ops[0].complexValue.round(0));
          if (ops[0].asFloat !== null)
            return ce.number(Math.round(ops[0].asFloat));
          return undefined;
        },
      },

      {
        name: 'Sign',
        domain: ['Function', 'Number', 'Integer'],
        range: [-1, 1],
        complexity: 1200,
        simplify: (ce, ops) => {
          const s = ops[0].sgn;
          if (s === 0) return ce.ZERO;
          if (s === 1) return ce.ONE;
          if (s === -1) return ce.NEGATIVE_ONE;
          return undefined;
        },
        evaluate: (ce, ops) => {
          const s = ops[0].sgn;
          if (s === 0) return ce.ZERO;
          if (s === 1) return ce.ONE;
          if (s === -1) return ce.NEGATIVE_ONE;
          return undefined;
        },
        N: (ce, ops) => {
          const s = ops[0].sgn;
          if (s === 0) return ce.ZERO;
          if (s === 1) return ce.ONE;
          if (s === -1) return ce.NEGATIVE_ONE;
          return undefined;
        },
      },

      {
        name: 'SignGamma',
        description: 'The sign of the gamma function: -1 or +1',
        domain: ['Function', 'Number', 'Integer'],
        complexity: 7900,
        range: [-1, 1],
        // @todo
      },
      {
        name: 'Sqrt',
        description: 'Square Root',
        domain: ['Function', 'Number', 'Number'],
        wikidata: 'Q134237',
        complexity: 3000,
        canonical: (ce, args) =>
          args[0]
            ? canonicalPower(ce, args[0], ce.HALF) ??
              ce._fn('Power', [args[0], ce.HALF])
            : ce._fn('Power', [ce.symbol('Missing'), ce.HALF]),
        simplify: (ce, ops) => processSqrt(ce, ops[0], 'simplify'),
        evaluate: (ce, ops) => processSqrt(ce, ops[0], 'evaluate'),
        N: (ce, ops) => processSqrt(ce, ops[0], 'N'),
        // evalDomain: Square root of a prime is irrational
        // https://proofwiki.org/wiki/Square_Root_of_Prime_is_Irrational
      },

      {
        name: 'Square',
        domain: ['Function', 'Number', 'Number'],
        wikidata: 'Q3075175',
        complexity: 3100,
        canonical: (ce, args) =>
          args[0]
            ? canonicalPower(ce, args[0], ce.TWO) ??
              ce._fn('Power', [args[0], ce.TWO])
            : ce._fn('Power', [ce.symbol('Missing'), ce.TWO]),
        N: (ce, ops) => {
          if (ops[0].decimalValue)
            return ce.number(ops[0].decimalValue.mul(ops[0].decimalValue));
          if (ops[0].complexValue)
            return ce.number(ops[0].complexValue.mul(ops[0].complexValue));
          if (ops[0].asFloat !== null)
            return ce.number(ops[0].asFloat * ops[0].asFloat);
          return undefined;
        },
      },
      {
        /**
         * The `Subscript` function can take several forms:
         *
         * If `op1` is a string, the string is interpreted as a number in
         * base `op2` (2 to 36).
         *
         * If `op1` is an indexable collection, `x`:
         * - `x_*` -> `At(x, *)`
         *
         * Otherwise:
         * - `x_0` -> Symbol "x_0"
         * - `x_n` -> Symbol "x_n"
         * - `x_{\text{max}}` -> Symbol `x_max`
         * - `x_{(n+1)}` -> `At(x, n+1)`
         * - `x_{n+1}` ->  `Subscript(x, n+1)`
         */
        name: 'Subscript',
        domain: ['Function', 'Anything', 'Anything', 'Anything'],
        // The last (subscript) argument can include a delimiter that
        // needs to be interpreted. Without the hold, it would get
        // removed during canonicalization.
        hold: 'last',
        canonical: (ce, args) => {
          const op1 = args[0] ?? ce.symbol('Missing');
          const op2 = args[1] ?? ce.symbol('Missing');
          // Is it a string in a base form:
          // `"deadbeef"_{16}` `"0101010"_2?
          if (op1.string) {
            if (op2.isLiteral && op2.asSmallInteger !== null) {
              const base = op2.asSmallInteger;
              if (base > 1 && base <= 36) {
                const [value, rest] = fromDigits(op1.string, base);
                if (rest) {
                  return ce._fn('Error', [
                    ce.number(value),
                    ce.string('unexpected-digits'),
                    ce._fn('LatexForm', [ce.string(rest)]),
                  ]);
                }
                return ce.number(value);
              }
            }
          }
          // Is it a compound symbol `x_\text{max}`, `\mu_0`
          // or an indexable collection?
          if (op1.symbol) {
            // Indexable collection?
            if (op1.symbolDefinition?.at) {
              return ce._fn('At', [op1, op2]);
            }
            // Maybe a compound symbol
            let sub = op2.string ?? op2.symbol;
            if (!sub) {
              if (op2.asSmallInteger !== null)
                sub = op2.asSmallInteger.toString();
            }
            if (sub) return ce.symbol(op1.symbol + '_' + sub);
          }
          return ce._fn('Subscript', args);
        },
      },
      {
        name: 'Subtract',
        domain: ['Function', 'Number', 'Number', 'Number'],
        wikidata: 'Q40754',
        complexity: 1350,
        canonical: (ce, args) => {
          if (args.length === 0) return ce.symbol('Nothing');
          // Not necessarily legal, but probably what was intended:
          // ['Subtract', 'x'] -> ['Negate', 'x']
          if (args.length === 1) return canonicalNegate(args[0]);
          return canonicalAdd(ce, [args[0], canonicalNegate(args[1])]);
        },
        N: (ce, ops) => {
          const lhs = ops[0];
          const rhs = ops[1];

          // Prioritize complex
          if (lhs.complexValue || rhs.complexValue) {
            return ce.number(
              ce
                .complex(lhs.complexValue ?? lhs.asFloat!)
                .sub(rhs.complexValue ?? rhs.asFloat)
            );
          }
          if (lhs.decimalValue || rhs.decimalValue) {
            return ce.number(
              ce
                .decimal(lhs.decimalValue ?? lhs.asFloat ?? NaN)
                .sub(rhs.decimalValue ?? rhs.asFloat ?? NaN)
            );
          }
          if (lhs.asFloat !== null && rhs.asFloat !== null)
            return ce.number(lhs.asFloat - rhs.asFloat);
          return undefined;
        },
      },
    ],
  },
  {
    //
    // Constants
    // Note: constants are put in a separate, subsequent, dictionary because
    // some of the values (CatalanConstant) reference some function names (Add...)
    // that are defined above. This avoid circular references.
    //
    symbols: [
      {
        /**
         * The difference between 1 and the next larger floating point number
         *
         *    2^{−52}
         *
         * See https://en.wikipedia.org/wiki/Machine_epsilon
         */
        name: 'MachineEpsilon',
        domain: 'RealNumber',
        constant: true,
        real: true,
        value: { num: Number.EPSILON.toString() },
      },
      {
        name: 'Half',
        constant: true,
        hold: false,
        value: ['Rational', 1, 2],
      },
      {
        name: 'ImaginaryUnit',
        domain: 'ImaginaryNumber',
        constant: true,
        hold: true,
        wikidata: 'Q193796',
        imaginary: true,
        value: ['Complex', 0, 1],
      },
      {
        name: 'ExponentialE',
        domain: 'TranscendentalNumber',
        algebraic: false,
        wikidata: 'Q82435',
        constant: true,
        hold: true,
        real: true,
        value: (engine) =>
          useDecimal(engine) ? engine.DECIMAL_ONE.exp() : Math.exp(1),
      },
      {
        name: 'GoldenRatio',
        domain: 'AlgebraicNumber',
        wikidata: 'Q41690',
        constant: true,
        algebraic: true,
        hold: false,
        value: ['Divide', ['Add', 1, ['Sqrt', 5]], 2],
      },
      {
        name: 'CatalanConstant',
        domain: 'RealNumber',
        algebraic: undefined, // Not proven irrational or transcendental
        wikidata: 'Q855282',
        constant: true,
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
      {
        // From http://www.fullbooks.com/Miscellaneous-Mathematical-Constants2.html
        name: 'EulerGamma',
        domain: 'RealNumber',
        algebraic: undefined, // Not proven irrational or transcendental
        wikidata: 'Q273023',
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
    ],
  },
  {
    functions: [
      {
        name: 'PreIncrement',
        domain: ['Function', 'Number', 'Number'],
      },
      {
        name: 'PreDecrement',
        domain: ['Function', 'Number', 'Number'],
      },
    ],
  },
];

function processAbs(
  ce: IComputeEngine,
  op1: BoxedExpression,
  mode: 'simplify' | 'evaluate' | 'N'
): BoxedExpression | undefined {
  if (mode !== 'simplify' || op1.isLiteral) {
    if (op1.machineValue !== null) return ce.number(Math.abs(op1.machineValue));
    if (op1.decimalValue) return ce.number(op1.decimalValue.abs());
    if (op1.complexValue) return ce.number(op1.complexValue.abs());
    const [n, d] = op1.rationalValue;
    if (n === null || d === null) return undefined;
    return ce.number(mode === 'N' ? Math.abs(n / d) : [Math.abs(n), d]);
  }
  if (op1.isMissing) return undefined;
  if (op1.isNonNegative) return op1;
  if (op1.isNegative) return ce.negate(op1);
  return undefined;
}

function processSqrt(
  ce: IComputeEngine,
  base: BoxedExpression,
  mode: 'simplify' | 'evaluate' | 'N'
): BoxedExpression | undefined {
  if (base.isOne) return ce.ONE;
  if (base.isZero) return ce.ZERO;

  if (mode === 'N') {
    if (base.complexValue) return ce.number(base.complexValue.sqrt());
    if (base.isNonNegative) {
      if (base.decimalValue) return ce.number(base.decimalValue.sqrt());
      if (base.asFloat !== null) return ce.number(Math.sqrt(base.asFloat));
    } else if (complexAllowed(ce)) {
      // Need to potentially do a complex operation
      return ce.number(ce.complex(base.asFloat!).sqrt());
    } else {
      return ce.NAN;
    }
    return undefined;
  }

  if (base.asSmallInteger !== null) {
    const [factor, root] = factorPower(base.asSmallInteger, 2);
    if (root === 1) return ce.number(factor);
    if (factor !== 1)
      return this._fn('Multiply', [
        factor,
        ce._fn('Sqrt', [ce.box(root).canonical]),
      ]);
  }

  return undefined;
}

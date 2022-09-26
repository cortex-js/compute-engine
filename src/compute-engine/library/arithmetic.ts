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
import { BoxedExpression, SymbolTable, IComputeEngine } from '../public';
import { complexAllowed, preferDecimal } from '../boxed-expression/utils';
import { canonicalNegate, processNegate } from '../symbolic/negate';
import {
  canonicalAdd,
  simplifyAdd,
  evalAdd,
  domainAdd,
} from './arithmetic-add';
import {
  canonicalMultiply,
  simplifyMultiply,
  evalMultiply,
} from './arithmetic-multiply';
import { canonicalDivide, simplifyDivide } from './arithmetic-divide';
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

export const ARITHMETIC_LIBRARY: SymbolTable[] = [
  {
    //
    // Functions
    //
    functions: [
      {
        name: 'Abs',
        wikidata: 'Q3317982', // magnitude 'Q120812 (for reals)
        threadable: true,
        idempotent: true,
        complexity: 1200,
        signature: {
          domain: ['Function', 'ExtendedRealNumber', 'NonNegativeNumber'],
          simplify: (ce, ops) => processAbs(ce, ops[0], 'simplify'),
          evaluate: (ce, ops) => processAbs(ce, ops[0], 'evaluate'),
          N: (ce, ops) => processAbs(ce, ops[0], 'N'),
        },
      },

      {
        name: 'Add',
        wikidata: 'Q32043',
        associative: true,
        commutative: true,
        threadable: true,
        idempotent: true,
        complexity: 1300,
        signature: {
          domain: 'NumericFunction',
          codomain: (ce, args) => domainAdd(ce, args),
          canonical: (ce, args) => canonicalAdd(ce, args),
          simplify: (ce, ops) => simplifyAdd(ce, ops),
          evaluate: (ce, ops) => evalAdd(ce, ops),
          N: (ce, ops) => evalAdd(ce, ops, 'N'),
        },
      },

      {
        name: 'Ceil',
        description: 'Rounds a number up to the next largest integer',
        complexity: 1250,
        signature: {
          domain: ['Function', 'Number', 'Integer'],
          evaluate: (ce, ops) => {
            const op1 = ops[0];
            if (op1.decimalValue) return ce.number(op1.decimalValue.ceil());
            if (op1.complexValue) return ce.number(op1.complexValue.ceil(0));
            if (op1.asFloat !== null) return ce.number(Math.ceil(op1.asFloat));

            return undefined;
          },
        },
      },

      {
        name: 'Chop',
        associative: true,
        threadable: true,
        idempotent: true,
        complexity: 1200,

        signature: {
          domain: ['Function', 'Number', 'Number'],
          evaluate: (ce, ops) => {
            const op1 = ops[0];
            if (op1.decimalValue) return ce.number(ce.chop(op1.decimalValue));
            if (op1.complexValue) return ce.number(ce.chop(op1.complexValue));
            if (op1.asFloat !== null) return ce.number(ce.chop(op1.asFloat));

            return undefined;
          },
        },
      },

      {
        // This function is converted during boxing, so unlikely to encounter
        name: 'Complex',
        wikidata: 'Q11567',
        complexity: 500,
      },

      {
        name: 'Divide',
        wikidata: 'Q1226939',
        complexity: 2500,
        // - if numer product of numbers, or denom product of numbers,
        // i.e. √2x/2 -> 0.707x, 2/√2x -> 1.4142x

        signature: {
          domain: ['Function', 'Number', 'Number', 'Number'],
          canonical: (ce, args) => canonicalDivide(ce, args[0], args[1]),
          simplify: (ce, args) => simplifyDivide(ce, args[0], args[1]),
        },
      },

      {
        name: 'Exp',
        wikidata: 'Q168698',
        threadable: true,
        complexity: 3500,
        // Exp(x) -> e^x

        signature: {
          domain: ['Function', 'Number', 'Number'],
          canonical: (ce, args) => ce.power(ce.symbol('ExponentialE'), args[0]),
        },
      },

      {
        name: 'Erf',
        description: 'Complementary Error Function',

        complexity: 7500,
      },

      {
        name: 'Erfc',
        description: 'Complementary Error Function',

        complexity: 7500,
      },

      {
        name: 'Factorial',
        description: 'The factorial function',
        wikidata: 'Q120976',
        complexity: 9000,

        signature: {
          domain: ['Function', 'Number', 'Number'],
          evaluate: (ce, ops) => {
            const n = ops[0].asSmallInteger;
            if (n !== null && n >= 0) {
              if (!preferDecimal(ce)) return ce.number(factorial(n));
              return ce.number(factorialDecimal(ce, ce.decimal(n)));
            }
            if (ops[0].complexValue)
              return ce.number(gammaComplex(ops[0].complexValue.add(1)));
            else if (ops[0].asFloat !== null)
              return ce.number(gamma(1 + ops[0].asFloat));

            return undefined;
          },
        },
      },

      {
        name: 'Floor',
        wikidata: 'Q56860783',
        complexity: 1250,

        signature: {
          domain: ['Function', 'ExtendedRealNumber', 'ExtendedRealNumber'],
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
      },

      {
        name: 'Gamma',
        wikidata: 'Q190573',
        complexity: 8000,

        signature: {
          domain: ['Function', 'Number', 'Number', 'Number'],
          N: (ce, ops) => {
            if (ops[0].decimalValue)
              return ce.number(gammaDecimal(ce, ops[0].decimalValue));
            // @todo: should gammaComplex() be always called if complexAllowed()?
            if (ops[0].complexValue)
              return ce.number(gammaComplex(ops[0].complexValue));
            if (ops[0].asFloat !== null)
              return ce.number(gamma(ops[0].asFloat));
            return undefined;
          },
        },
      },

      {
        name: 'LogGamma',
        complexity: 8000,

        signature: {
          domain: ['Function', 'Number', 'Number', 'Number'],
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
      },

      {
        name: 'Ln',
        description: 'Natural Logarithm',
        wikidata: 'Q204037',
        complexity: 4000,

        signature: {
          domain: ['Function', 'Number', 'Number', 'Number'],
          N: (ce, ops) => {
            if (ops[0].decimalValue)
              return ce.number(ops[0].decimalValue.log());
            if (ops[0].complexValue)
              return ce.number(ops[0].complexValue.log());
            if (ops[0].asFloat !== null)
              return ce.number(Math.log(ops[0].asFloat));
            return undefined;
          },
        },
      },

      {
        name: 'Log',
        description: 'Log(z, b = 10) = Logarithm of base b',
        wikidata: 'Q11197',
        complexity: 4100,

        signature: {
          domain: ['Function', 'Number', 'Number', 'Number'],
          N: (ce, ops) => {
            const exponent = ops[0];
            const base = ops[1] ?? ce.number(10);
            if (exponent.decimalValue) {
              const decimalBase =
                base.decimalValue?.log() ??
                ce.decimal(base.asFloat ?? NaN).log();
              return ce.number(exponent.decimalValue.log().div(decimalBase));
            }
            if (exponent.complexValue) {
              const complexBase =
                base.complexValue?.log() ??
                ce.complex(base.asFloat ?? NaN).log();

              return ce.number(exponent.complexValue.log().div(complexBase));
            }
            if (exponent.asFloat !== null) {
              return ce.number(
                Math.log(exponent.asFloat) / Math.log(base.asFloat ?? NaN)
              );
            }
            return undefined;
          },
        },
      },

      {
        name: 'Lb',
        description: 'Base-2 Logarithm',
        wikidata: 'Q581168',
        complexity: 4100,

        signature: {
          domain: ['Function', 'Number', 'Number'],
          N: (ce, ops) => {
            const exponent = ops[0];
            if (exponent.decimalValue)
              return ce.number(
                exponent.decimalValue.log().div(ce._DECIMAL_TWO)
              );
            if (exponent.complexValue)
              return ce.number(exponent.complexValue.log().div(ce.complex(2)));

            if (exponent.asFloat !== null)
              return ce.number(Math.log2(exponent.asFloat));
            return undefined;
          },
        },
      },

      {
        name: 'Lg',
        description: 'Base-10 Logarithm',
        wikidata: 'Q966582',
        complexity: 4100,

        signature: {
          domain: ['Function', 'Number', 'Number'],
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
      },

      {
        name: 'Max',
        description: 'Maximum of two or more numbers',
        complexity: 1200,
        signature: {
          domain: ['Function', ['Sequence', 'Number'], 'Number'],
          simplify: (ce, ops) => {
            if (ops.length === 0) return ce._NEGATIVE_INFINITY;
            if (ops.length === 1) return ops[0];
            return ce.box(['Max', ...ops]);
          },
          evaluate: (ce, ops) => {
            if (ops.length === 0) return ce._NEGATIVE_INFINITY;

            let result: BoxedExpression | undefined = undefined;
            const rest: BoxedExpression[] = [];

            for (const op of ops) {
              if (!op.isNumber || op.value === undefined) rest.push(op);
              else if (!result || op.isGreater(result)) result = op;
            }
            if (rest.length > 0)
              return ce.box(
                result ? ['Max', result, ...rest] : ['Max', ...rest]
              );
            return result ?? ce._NAN;
          },
        },
      },

      {
        name: 'Min',
        description: 'Minimum of two or more numbers',
        complexity: 1200,

        signature: {
          domain: ['Function', ['Sequence', 'Number'], 'Number'],
          simplify: (ce, ops) => {
            if (ops.length === 0) return ce._NEGATIVE_INFINITY;
            if (ops.length === 1) return ops[0];
            return ce.box(['Min', ...ops]);
          },
          evaluate: (ce, ops) => {
            if (ops.length === 0) return ce._NEGATIVE_INFINITY;

            let result: BoxedExpression | undefined = undefined;
            const rest: BoxedExpression[] = [];

            for (const op of ops) {
              if (!op.isNumber || op.value === undefined) rest.push(op);
              else if (!result || op.isLess(result)) result = op;
            }
            if (rest.length > 0)
              return ce.box(
                result ? ['Min', result, ...rest] : ['Min', ...rest]
              );
            return result ?? ce._NAN;
          },
        },
      },

      {
        name: 'Multiply',
        wikidata: 'Q40276',
        associative: true,
        commutative: true,
        idempotent: true,
        complexity: 2100,

        signature: {
          domain: 'NumericFunction',
          canonical: (ce, args) => canonicalMultiply(ce, args),
          simplify: (ce, ops) => simplifyMultiply(ce, ops),
          evaluate: (ce, ops) => evalMultiply(ce, ops),
          N: (ce, ops) => evalMultiply(ce, ops, 'N'),
        },
      },

      {
        name: 'Negate',
        description: 'Additive Inverse',
        wikidata: 'Q715358',
        complexity: 2000,

        signature: {
          domain: ['Function', 'Number', 'Number'],
          codomain: (ce, args) => {
            if (!args[0].literal) return args[0];
            const negDomain = {
              PositiveNumber: 'NegativeNumber',
              NonNegativeNumber: 'NonPositiveNumber',
              NonPositiveNumber: 'NonNegativeNumber',
              NegativeNumber: 'PositiveNumber',
              PositiveInteger: 'NegativeInteger',
              NonNegativeInteger: 'NonPositiveInteger',
              NonPositiveInteger: 'NonNegativeInteger',
              NegativeInteger: 'PositiveInteger',
            }[args[0].literal];
            if (negDomain) return ce.domain(negDomain);
            return args[0];
          },
          canonical: (_ce, args) => canonicalNegate(args[0]),
          simplify: (ce, ops) => processNegate(ce, ops[0], 'simplify'),
          evaluate: (ce, ops) => processNegate(ce, ops[0], 'evaluate'),
          N: (ce, ops) => processNegate(ce, ops[0], 'N'),
          sgn: (_ce, args): -1 | 0 | 1 | undefined => {
            const arg = args[0];
            if (arg.isZero) return 0;
            if (arg.isPositive) return -1;
            if (arg.isNegative) return +1;
            return undefined;
          },
        },
      },

      {
        name: 'Power',
        wikidata: 'Q33456',
        commutative: false,
        complexity: 3500,
        signature: {
          domain: ['Function', 'Number', 'Number', 'Number'],
          canonical: (ce, args) => {
            return (
              canonicalPower(ce, args[0], args[1]) ?? ce._fn('Power', args)
            );
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
      },

      {
        name: 'Rational',
        complexity: 2400,

        signature: {
          domain: [
            'Function',
            'RealNumber',
            ['Maybe', 'Integer'],
            'RationalNumber',
          ],
          canonical: (ce, args) =>
            args.length === 2
              ? canonicalDivide(ce, args[0], args[1])
              : ce._fn('Rational', args),
          simplify: (ce, ops) => {
            if (ops.length !== 2) return undefined;
            return simplifyDivide(ce, ops[0], ops[1]);
          },
          evaluate: (ce, ops) => {
            if (ops.length === 2) {
              const [n, d] = [ops[0].asSmallInteger, ops[1].asSmallInteger];
              if (n !== null && d !== null) return ce.number([n, d]);
              return undefined;
            }
            // If there is a single argument, i.e. `['Rational', 'Pi']`
            // the function evaluates to a rational expression of the argument
            const f = ops[0].asFloat ?? ops[0].decimalValue?.toNumber() ?? null;
            if (f === null) return ops[0];

            const r = rationalize(f);
            if (typeof r === 'number') return ce.number(r);
            return ce.number([r[0], r[1]]);
          },
          N: (ce, ops) => {
            if (ops.length === 2) {
              const [n, d] = [ops[0].machineValue, ops[1].machineValue];
              if (n !== null && d !== null) return ce.number(n / d);
              const [dn, dd] = [
                ops[0].decimalValue ??
                  (ops[0].asFloat ? ce.decimal(ops[0].asFloat) : null),
                ops[1].decimalValue ??
                  (ops[1].asFloat ? ce.decimal(ops[1].asFloat) : null),
              ];
              if (dn !== null && dd !== null) return ce.number(dn.div(dd));
            }

            return undefined;
          },
        },
      },

      {
        name: 'Root',
        complexity: 3200,

        signature: {
          domain: ['Function', 'Number', 'RationalNumber', 'Number'],
          canonical: (ce, args) => {
            const exp = ce.inverse(args[1]);
            return (
              canonicalPower(ce, args[0], exp) ??
              ce._fn('Power', [args[0], exp])
            );
          },
          N: (ce, ops) => {
            // @todo: because the canonical form is `Power`, this code is never reached
            console.error(
              'unexpected Root.N(). should have been canonicalized'
            );
            const base = ops[0];
            const root = ops[1];
            if (base.decimalValue)
              return ce.number(
                base.decimalValue.pow(ce._DECIMAL_ONE.div(root.asFloat ?? NaN))
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
      },

      {
        name: 'Round',
        complexity: 1250,

        signature: {
          domain: ['Function', 'Number', 'Number'],
          evaluate: (ce, ops) => {
            if (ops[0].decimalValue)
              return ce.number(ops[0].decimalValue.round());
            if (ops[0].complexValue)
              return ce.number(ops[0].complexValue.round(0));
            if (ops[0].asFloat !== null)
              return ce.number(Math.round(ops[0].asFloat));
            return undefined;
          },
        },
      },

      {
        name: 'Sign',
        complexity: 1200,

        signature: {
          domain: ['Function', 'Number', ['Range', -1, 1]],
          simplify: (ce, ops) => {
            const s = ops[0].sgn;
            if (s === 0) return ce._ZERO;
            if (s === 1) return ce._ONE;
            if (s === -1) return ce._NEGATIVE_ONE;
            return undefined;
          },
          evaluate: (ce, ops) => {
            const s = ops[0].sgn;
            if (s === 0) return ce._ZERO;
            if (s === 1) return ce._ONE;
            if (s === -1) return ce._NEGATIVE_ONE;
            return undefined;
          },
          N: (ce, ops) => {
            const s = ops[0].sgn;
            if (s === 0) return ce._ZERO;
            if (s === 1) return ce._ONE;
            if (s === -1) return ce._NEGATIVE_ONE;
            return undefined;
          },
        },
      },

      {
        name: 'SignGamma',
        description: 'The sign of the gamma function: -1 or +1',
        complexity: 7900,

        // @todo
      },
      {
        name: 'Sqrt',
        description: 'Square Root',
        wikidata: 'Q134237',
        complexity: 3000,

        signature: {
          domain: ['Function', 'Number', 'Number'],
          canonical: (ce, args) =>
            canonicalPower(ce, args[0], ce._HALF) ??
            ce._fn('Power', [args[0], ce._HALF]),
          simplify: (ce, ops) => processSqrt(ce, ops[0], 'simplify'),
          evaluate: (ce, ops) => processSqrt(ce, ops[0], 'evaluate'),
          N: (ce, ops) => processSqrt(ce, ops[0], 'N'),
          // evalDomain: Square root of a prime is irrational
          // https://proofwiki.org/wiki/Square_Root_of_Prime_is_Irrational
        },
      },

      {
        name: 'Square',
        wikidata: 'Q3075175',
        complexity: 3100,

        signature: {
          domain: ['Function', 'Number', 'Number'],
          canonical: (ce, args) =>
            canonicalPower(ce, args[0], ce._TWO) ??
            ce._fn('Power', [args[0], ce._TWO]),
          evaluate: (ce, ops) => {
            console.error('unexpected evaluate: should be decanonicalized');
            if (ops[0].decimalValue)
              return ce.number(ops[0].decimalValue.mul(ops[0].decimalValue));
            if (ops[0].complexValue)
              return ce.number(ops[0].complexValue.mul(ops[0].complexValue));
            if (ops[0].asFloat !== null)
              return ce.number(ops[0].asFloat * ops[0].asFloat);
            return undefined;
          },
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

        // The last (subscript) argument can include a delimiter that
        // needs to be interpreted. Without the hold, it would get
        // removed during canonicalization.
        hold: 'last',

        // The codomain of the function needs to be determined by considering
        // the value of its arguments
        dynamic: true,

        signature: {
          domain: ['Function', 'Anything', 'Anything', 'Anything'],
          codomain: (ce, args) => {
            if (args[0].isFunction) return args[0];
            return args[0];
          },
          canonical: (ce, args) => {
            const op1 = args[0];
            const op2 = args[1];
            // Is it a string in a base form:
            // `"deadbeef"_{16}` `"0101010"_2?
            if (op1.string) {
              if (op2.isLiteral && op2.asSmallInteger !== null) {
                const base = op2.asSmallInteger;
                if (base > 1 && base <= 36) {
                  const [value, rest] = fromDigits(op1.string, base);
                  if (rest) {
                    return ce.error(
                      ['unexpected-digit', rest[0]],
                      ['Latex', ce.string(op1.string)]
                    );
                  }
                  return ce.number(value);
                }
              }
            }
            // Is it a compound symbol `x_\mathrm{max}`, `\mu_0`
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
      },
      {
        name: 'Subtract',
        wikidata: 'Q40754',
        complexity: 1350,

        signature: {
          domain: ['Function', 'Number', ['Maybe', 'Number'], 'Number'],
          canonical: (ce, args) => {
            // Not necessarily legal, but probably what was intended:
            // ['Subtract', 'x'] -> ['Negate', 'x']
            if (args.length === 1) return canonicalNegate(args[0]);
            return canonicalAdd(ce, [args[0], canonicalNegate(args[1])]);
          },
          evaluate: (ce, ops) => {
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
          preferDecimal(engine) ? engine._DECIMAL_ONE.exp() : Math.exp(1),
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
        signature: { domain: ['Function', 'Number', 'Number'] },
      },
      {
        name: 'PreDecrement',
        signature: { domain: ['Function', 'Number', 'Number'] },
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
  if (op1.isNonNegative) return op1;
  if (op1.isNegative) return ce.negate(op1);
  return undefined;
}

function processSqrt(
  ce: IComputeEngine,
  base: BoxedExpression,
  mode: 'simplify' | 'evaluate' | 'N'
): BoxedExpression | undefined {
  if (base.isOne) return ce._ONE;
  if (base.isZero) return ce._ZERO;

  if (mode !== 'simplify') {
    if (base.complexValue) return ce.number(base.complexValue.sqrt());
    if (base.isNonNegative) {
      if (base.decimalValue) return ce.number(base.decimalValue.sqrt());
      if (base.asFloat !== null) return ce.number(Math.sqrt(base.asFloat));
    } else if (complexAllowed(ce)) {
      // Need to potentially do a complex operation
      return ce.number(ce.complex(base.asFloat!).sqrt());
    } else {
      return ce._NAN;
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

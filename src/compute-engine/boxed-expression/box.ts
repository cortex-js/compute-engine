import Complex from 'complex.js';
import { Decimal } from 'decimal.js';
import {
  IComputeEngine,
  SemiBoxedExpression,
  BoxedExpression,
  Metadata,
  DomainExpression,
  CanonicalOptions,
} from './public';
import { _BoxedExpression } from './abstract-boxed-expression';
import { BoxedDictionary } from './boxed-dictionary';
import { BoxedFunction } from './boxed-function';
import { BoxedNumber } from './boxed-number';
import { BoxedString } from './boxed-string';
import { Expression, MathJsonNumber } from '../../math-json/math-json-format';
import { isValidIdentifier, missingIfEmpty } from '../../math-json/utils';
import {
  Rational,
  isBigRational,
  isMachineRational,
  isOne,
  isRational,
  neg,
} from '../numerics/rationals';
import { asBigint } from './utils';
import { bigint, bigintValue } from '../numerics/numeric-bigint';
import { isDomainLiteral } from '../library/domains';
import { BoxedTensor, expressionTensorInfo } from './boxed-tensor';
import { canonicalForm } from './canonical';
import { asFloat, asMachineInteger } from './numerics';
import { canonicalAdd } from '../library/arithmetic-add';
import { flatten } from '../symbolic/flatten';
import { shouldHold, semiCanonical, canonical } from '../symbolic/utils';
import { order } from './order';
import { adjustArguments, checkNumericArgs } from './validate';
import { canonicalMultiply } from '../library/arithmetic-multiply';
import { NumericValue } from '../numeric-value/public';
import { ExactNumericValue } from '../numeric-value/exact-numeric-value';

/**
 * ### THEORY OF OPERATIONS
 *
 *
 * 1/ The result of boxing is canonical by default.
 *
 *   This is the most common need (i.e. to evaluate an expression you need it
 *   in canonical form). Creating a boxed expression which is canonical from the
 *   start avoid going through an intermediary step with a non-canonical
 *   expression.
 *
 * 2/ When boxing (and canonicalizing), if the function is "scoped", a new
 *    scope is created before the canonicalization, so that any declaration
 *    are done within that scope. Example of scoped functions include `Block`
 *    and `Sum`.
 *
 * 3/ When implementing an `evaluate()`:
 * - if `bignumPreferred()` all operations should be done in bignum and complex,
 *    otherwise, they should all be done in machine numbers and complex.
 * - if a rational is encountered, preserve it
 * - if a `Sqrt` of a rational is encountered, preserve it
 * - if a `hold` constant is encountered, preserve it
 * - if one of the arguments is not exact, return an approximation
 *
 * EXACT
 * - 2 + 5 -> 7
 * - 2 + 5/7 -> 19/7
 * - 2 + √2 -> 2 + √2
 * - 2 + √(5/7) -> 2 + √(5/7)
 * - 5/7 + 9/11 -> 118/77
 * - 5/7 + √2 -> 5/7 + √2
 * - 10/14 + √(18/9) -> 5/7 + √2
 * - √2 + √5 -> √2 + √5
 * - √2 + √2 -> 2√2
 * - sin(2) -> sin(2)
 * - sin(pi/3) -> √3/2
 *
 * APPROXIMATE
 * - 2 + 2.1 -> 4.1
 * - 2 + √2.1 -> 3.44914
 * - 5/7 + √2.1 -> 2.16342
 * - sin(2) + √2.1 -> 2.35844
 */

/**
 * Return a boxed number representing `num`.
 *
 * Note: `boxNumber()` should only be called from `ce.number()` in order to
 * benefit from number expression caching.
 */
export function boxNumber(
  ce: IComputeEngine,
  num:
    | MathJsonNumber
    | number
    | bigint
    | string
    | Complex
    | Decimal
    | Rational
    | [Decimal, Decimal],
  options: { metadata?: Metadata; canonical: boolean }
): BoxedExpression | null {
  //
  // Bigint?
  // @fixme: handle bigint directly without going through bignum
  if (typeof num === 'bigint') num = ce.bignum(num);

  //
  // Do we have a machine number or bignum?
  //
  if (typeof num === 'number' || num instanceof Decimal)
    return new BoxedNumber(ce, num, options);

  //
  // Do we have a rational or big rational?
  //

  if (isRational(num)) {
    console.assert(num.length === 2);
    const [n, d]: [number, number] | [bigint, bigint] = num;
    if (typeof n === 'bigint' && typeof d === 'bigint') {
      if (n === d) return d === BigInt(0) ? ce.NaN : ce.One;
      if (n === BigInt(0)) return ce.Zero;
      if (d === BigInt(1)) return ce.number(n, options);
      if (d === BigInt(-1)) return ce.number(-n, options);
      if (n === BigInt(1) && d === BigInt(2)) return ce.Half;
      return new BoxedNumber(ce, num, options);
    }

    console.assert(Number.isInteger(n) && Number.isInteger(d));

    if (!isFinite(n as number) || !isFinite(d as number))
      return ce.number(n, options).div(ce.number(d, options));

    if (d === n) return d === 0 ? ce.NaN : ce.One;
    if (n === 0) return ce.Zero;
    if (d === 1) return ce.number(n, options);
    if (d === -1) return ce.number(-n, options);
    if (n === 1 && d === 2) return ce.Half;
    return new BoxedNumber(ce, num, options);
  }

  //
  // Do we have a complex number?
  //
  if (num instanceof Complex) {
    if (num.isNaN()) return ce.NaN;
    if (num.isZero()) return ce.Zero;
    if (num.isInfinite()) return ce.ComplexInfinity;
    if (ce.chop(num.im) === 0) return ce.number(num.re, options);
    return new BoxedNumber(ce, num, options);
  }

  //
  // Do we have a string of digits?
  //
  let strNum = '';
  if (typeof num === 'string') strNum = num;
  else if (typeof num === 'object' && 'num' in num) {
    // Technically, num.num as a number is not valid MathJSON: it should be a
    // string, but we'll allow it.
    if (typeof num.num === 'number') return ce.number(num.num, options);

    if (typeof num.num !== 'string')
      throw new Error('MathJSON `num` property should be a string of digits');
    strNum = num.num;
  }

  if (!strNum) return null;

  strNum = strNum.toLowerCase();

  // Remove trailing "n" or "d" letter (from legacy version of MathJSON spec)
  if (/[0-9][nd]$/.test(strNum)) strNum = strNum.slice(0, -1);

  // Remove any whitespace:
  // Tab, New Line, Vertical Tab, Form Feed, Carriage Return, Space, Non-Breaking Space
  strNum = strNum.replace(/[\u0009-\u000d\u0020\u00a0]/g, '');

  // Special case some common values to share boxed instances
  if (strNum === 'nan') return ce.NaN;
  if (strNum === 'infinity' || strNum === '+infinity')
    return ce.PositiveInfinity;
  if (strNum === '-infinity') return ce.NegativeInfinity;
  if (strNum === '0') return ce.Zero;
  if (strNum === '1') return ce.One;
  if (strNum === '-1') return ce.NegativeOne;

  // Do we have repeating digits?
  if (/\([0-9]+\)/.test(strNum)) {
    const [_, body, repeat, trail] =
      strNum.match(/(.+)\(([0-9]+)\)(.+)?$/) ?? [];
    // @todo we probably shouldn't be using the ce.precision since it may change later
    strNum =
      body +
      repeat.repeat(Math.ceil(ce.precision / repeat.length)) +
      (trail ?? '');
  }

  return boxNumber(ce, ce.bignum(strNum), options);
}

function boxHold(
  ce: IComputeEngine,
  expr: SemiBoxedExpression | null,
  options: { canonical?: CanonicalOptions }
): BoxedExpression {
  if (expr === null) return ce.error('missing');
  if (typeof expr === 'object' && expr instanceof _BoxedExpression) return expr;

  expr = missingIfEmpty(expr as Expression);

  if (typeof expr === 'string') return box(ce, expr, options);

  if (Array.isArray(expr)) {
    const boxed = expr.map((x) => boxHold(ce, x, options));
    return new BoxedFunction(ce, boxed[0], boxed.slice(1));
  }
  if (typeof expr === 'object') {
    if ('dict' in expr) return new BoxedDictionary(ce, expr.dict);
    if ('fn' in expr) return boxHold(ce, expr.fn, options);
    if ('str' in expr) return new BoxedString(ce, expr.str);
    if ('sym' in expr) return box(ce, expr.sym, options);
    if ('num' in expr) return box(ce, expr.num, options);
  }

  return box(ce, expr, options);
}

/**
 * Given a head and a set of arguments, return a boxed function expression.
 *
 * If available, preserve LaTeX and wikidata metadata in the boxed expression.
 *
 * Note that `boxFunction()` should only be called from `ce.function()`
 */

export function boxFunction(
  ce: IComputeEngine,
  head: string,
  ops: readonly SemiBoxedExpression[],
  options?: { metadata?: Metadata; canonical?: CanonicalOptions }
): BoxedExpression {
  options = options ? { ...options } : {};
  if (!('canonical' in options)) options.canonical = true;

  //
  // Hold
  //

  if (head === 'Hold') {
    return new BoxedFunction(ce, 'Hold', [boxHold(ce, ops[0], options)], {
      ...options,
      canonical: true,
    });
  }

  //
  // Error
  //
  if (head === 'Error' || head === 'ErrorCode') {
    return ce._fn(
      head,
      ops.map((x) => ce.box(x, { canonical: false })),
      options.metadata
    );
  }

  //
  // String
  //
  if (head === 'String') {
    if (ops.length === 0) return new BoxedString(ce, '', options.metadata);
    return new BoxedString(
      ce,
      ops.map((x) => asString(x) ?? '').join(''),
      options.metadata
    );
  }

  //
  // Symbol
  //
  if (head === 'Symbol' && ops.length > 0) {
    return ce.symbol(ops.map((x) => asString(x) ?? '').join(''), options);
  }

  //
  // Domain
  //
  if (head === 'Domain')
    return ce.domain(ops[0] as DomainExpression, options.metadata);

  //
  // Number
  //
  if (head === 'Number' && ops.length === 1) return box(ce, ops[0], options);

  const canonicalNumber =
    options.canonical === true ||
    options.canonical === 'Number' ||
    (Array.isArray(options.canonical) && options.canonical.includes('Number'));

  if (canonicalNumber) {
    // If we have a full canonical form or a canonical form for numbers
    // do some additional simplifications

    //
    // Rational (as Divide)
    //
    if ((head === 'Divide' || head === 'Rational') && ops.length === 2) {
      const n =
        ops[0] instanceof _BoxedExpression
          ? asBigint(ops[0])
          : bigintValue(ops[0] as Expression);
      if (n !== null) {
        const d =
          ops[1] instanceof _BoxedExpression
            ? asBigint(ops[1])
            : bigintValue(ops[1] as Expression);
        if (d !== null) return ce.number([n, d], options);
      }
      head = 'Divide';
    }

    //
    // Complex
    //
    if (head === 'Complex') {
      if (ops.length === 1) {
        // If single argument, assume it's imaginary
        // @todo: use machineValue() & symbol() instead of box()
        const op1 = box(ce, ops[0], options);
        const im = asFloat(op1);
        if (im !== null && im !== 0)
          return ce.number(ce.complex(0, im), options);
        return op1.mul(ce.I);
      }
      if (ops.length === 2) {
        const op1 = box(ce, ops[0], options);
        const op2 = box(ce, ops[1], options);
        const re = asFloat(op1);
        const im = asFloat(op2);
        if (im !== null && re !== null) {
          if (im === 0 && re === 0) return ce.Zero;
          if (im !== null && im !== 0)
            return ce.number(ce.complex(re, im), options);
          return op1;
        }
        return op1.add(op2.mul(ce.I));
      }
      throw new Error('Expected one or two arguments with Complex expression');
    }

    //
    // Negate
    //
    // Distribute over literals
    //
    if (head === 'Negate' && ops.length === 1) {
      const op1 = ops[0];
      if (typeof op1 === 'number') return ce.number(-op1, options);
      if (op1 instanceof Decimal) return ce.number(op1.neg(), options);
      const num = ce.box(op1, options).numericValue;
      if (num !== null) {
        if (typeof num === 'number') return ce.number(-num, options);
        if (num instanceof Decimal) return ce.number(num.neg(), options);
        if (num instanceof Complex) return ce.number(num.neg());
        if (isRational(num)) return ce.number(neg(num));
      }
    }
  }

  if (options.canonical === true)
    return makeCanonicalFunction(ce, head, ops, options.metadata);

  return canonicalForm(
    new BoxedFunction(
      ce,
      head,
      ops.map((x) => box(ce, x, { canonical: options.canonical })),
      { metadata: options.metadata, canonical: false }
    ),
    options.canonical ?? false
  );
}

/**
 * Notes about the boxed form:
 *
 * [1] Expression with a head of `Number`, `String`, `Symbol` and `Dictionary`
 *      are converted to the corresponding atomic expression.
 *
 * [2] Expressions with a head of `Complex` are converted to a (complex) number
 *     or a `Add`/`Multiply` expression.
 *
 *     The precedence of `Complex` (for serialization) is sometimes the
 *     precedence of `Add` (when re and im != 0), sometimes the precedence of
 *    `Multiply` (when im or re === 0). Using a number or an explicit
 *    `Add`/`Multiply` expression avoids this ambiguity.
 *
 * [3] An expression with a `Rational` head is converted to a rational number.
 *    if possible, to a `Divide` otherwise.
 *
 * [4] A `Negate` function applied to a number literal is converted to a number.
 *
 *     Note that `Negate` is only distributed over addition. In practice, having
 * `Negate` factored on multiply/divide is more useful to detect patterns.
 *
 * Note that this function should only be called from `ce.box()`
 *
 */

export function box(
  ce: IComputeEngine,
  expr:
    | null
    | undefined
    | NumericValue
    | Decimal
    | Complex
    | Rational
    | SemiBoxedExpression,
  options?: { canonical?: CanonicalOptions }
): BoxedExpression {
  if (expr === null || expr === undefined) return ce._fn('Sequence', []);

  if (expr instanceof NumericValue) return fromNumericValue(ce, expr);

  if (expr instanceof _BoxedExpression)
    return canonicalForm(expr, options?.canonical ?? true);

  options = options ? { ...options } : {};
  if (!('canonical' in options)) options.canonical = true;

  // If canonical is true, we want to canonicalize the arguments
  // If it's false or a CanonicalForm, we don't want to canonicalize the
  // arguments during create, we'll call canonicalForm to take care of it
  const canonical = options.canonical === true;

  //
  //  Box a function or a rational
  //
  if (Array.isArray(expr)) {
    // If the first element is a number, it's not a function, it's a rational
    // `[number, number]`
    if (isMachineRational(expr)) {
      if (Number.isInteger(expr[0]) && Number.isInteger(expr[1]))
        return ce.number(expr);
      // This wasn't a valid rational, turn it into a `Divide`
      return canonicalForm(
        ce.function('Divide', expr, { canonical }),
        options.canonical!
      );
    }
    if (isBigRational(expr)) return ce.number(expr);

    if (typeof expr[0] === 'string')
      return canonicalForm(
        ce.function(expr[0], expr.slice(1), { canonical }),
        options.canonical!
      );

    console.assert(Array.isArray(expr[0]));

    // It's a function with a head expression
    // Try to evaluate to something simpler
    const ops = expr.slice(1).map((x) => box(ce, x, options));
    // The head could include some unknowns, i.e. `_` which we do *not*
    // want to get declated in the current scope, so use canonical: false
    // to avoid that.
    const head = box(ce, expr[0], { canonical: false });
    return canonicalForm(new BoxedFunction(ce, head, ops), options.canonical!);
  }

  //
  // Box a number (other than a rational)
  //
  if (
    typeof expr === 'number' ||
    expr instanceof Complex ||
    expr instanceof Decimal
  )
    return ce.number(expr);

  //
  // Box a String, a Symbol or a number as a string shorthand
  //
  if (typeof expr === 'string') {
    // It's a `String` if it bracketed with apostrophes (single quotes)
    if (expr.startsWith("'") && expr.endsWith("'"))
      return new BoxedString(ce, expr.slice(1, -1));

    if (/^[+-]?[0-9]/.test(expr)) return ce.number(expr);

    if (isDomainLiteral(expr)) return ce.domain(expr);

    if (!isValidIdentifier(expr))
      return ce.error('invalid-identifier', { str: expr });
    return ce.symbol(expr, { canonical });
  }

  //
  // Box a MathJSON object literal
  //
  if (typeof expr === 'object') {
    const metadata = {
      latex: expr.latex,
      wikidata: expr.wikidata,
    };
    if ('dict' in expr)
      return canonicalForm(
        new BoxedDictionary(ce, expr.dict, { canonical: true, metadata }),
        options.canonical!
      );
    if ('fn' in expr) {
      if (typeof expr.fn[0] === 'string')
        return canonicalForm(
          ce.function(expr.fn[0], expr.fn.slice(1), { canonical }),
          options.canonical!
        );
      return canonicalForm(
        new BoxedFunction(
          ce,
          box(ce, expr.fn[0], options),
          expr.fn.slice(1).map((x) => box(ce, x, options)),
          { metadata }
        ),
        options.canonical!
      );
    }
    if ('str' in expr) return new BoxedString(ce, expr.str, metadata);
    if ('sym' in expr) return ce.symbol(expr.sym, { canonical });
    if ('num' in expr) return ce.number(expr, { canonical });
  }

  return ce.symbol('Undefined');
}

function asString(expr: SemiBoxedExpression): string | null {
  if (typeof expr === 'string') return expr;
  if (expr instanceof _BoxedExpression) {
    return expr.string ?? expr.symbol ?? expr.toString();
  }

  if (typeof expr === 'object') {
    if ('str' in expr) return expr.str;
    if (
      'fn' in expr &&
      expr.fn[0] === 'String' &&
      typeof expr.fn[1] === 'string'
    )
      // @todo: that's incorrect. That argument would be a string bracketed by quotes
      return expr.fn[1];
  }

  if (Array.isArray(expr)) {
    // @todo: that's incorrect. That argument would be a string bracketed by quotes
    if (expr[0] === 'String' && typeof expr[1] === 'string') return expr[1];
  }

  return null;
}

function makeCanonicalFunction(
  ce: IComputeEngine,
  head: string | BoxedExpression,
  ops: ReadonlyArray<SemiBoxedExpression>,
  metadata?: Metadata
): BoxedExpression {
  //
  // Is the head an expression? For example, `['InverseFunction', 'Sin']`
  //
  if (typeof head !== 'string') {
    // We need a new scope to capture any locals that might get bound
    // while evaluating the head.
    ce.pushScope();
    head = head.evaluate().symbol ?? head;
    ce.popScope();
  }

  if (typeof head === 'string') {
    const result = makeNumericFunction(ce, head, ops, metadata);
    if (result) return result;

    //
    // Do we have a vector/matrix/tensor?
    // It has to have a compatible shape: i.e. all elements on an axis have
    // the same shape.
    //
    if (head === 'List') {
      // @todo: note: we could have a special canonical form for tensors
      const boxedOps = ops.map((x) => ce.box(x));
      const { shape, dtype } = expressionTensorInfo('List', boxedOps) ?? {};

      if (dtype && shape) return new BoxedTensor(ce, { head, ops: boxedOps });

      return ce._fn(head, boxedOps);
    }

    //
    // Dictionary
    //
    if (head === 'Dictionary') {
      const dict = {};
      for (const op of ops) {
        const arg = ce.box(op);
        const head = arg.head;
        if (
          head === 'KeyValuePair' ||
          head === 'Pair' ||
          (head === 'Tuple' && arg.nops === 2)
        ) {
          const key = arg.op1;
          if (key.isValid && key.symbol !== 'Nothing') {
            const value = arg.op2;
            let k = key.symbol ?? key.string;
            if (!k && (key.numericValue !== null || key.string)) {
              const n =
                typeof key.numericValue === 'number'
                  ? key.numericValue
                  : asMachineInteger(key);
              if (n && Number.isFinite(n) && Number.isInteger(n))
                k = n.toString();
            }
            if (k) dict[k] = value;
          }
        }
      }
      return new BoxedDictionary(ce, dict, { metadata });
    }
  } else {
    if (!head.isValid)
      return new BoxedFunction(
        ce,
        head,
        ops.map((x) => ce.box(x, { canonical: false })),
        { metadata, canonical: false }
      );
  }

  //
  // Didn't match a short path, look for a definition
  //
  const def = ce.lookupFunction(head);
  if (!def) {
    // No def. This is for example `["f", 2]` where "f" is not declared.
    return new BoxedFunction(ce, head, flatten(canonical(ce, ops)), {
      metadata,
      canonical: true,
    });
  }

  const xs: BoxedExpression[] = [];

  for (let i = 0; i < ops.length; i++) {
    if (!shouldHold(def.hold, ops.length - 1, i)) {
      xs.push(ce.box(ops[i]));
    } else {
      const y = ce.box(ops[i], { canonical: false });
      if (y.head === 'ReleaseHold') xs.push(y.op1.canonical);
      else xs.push(y);
    }
  }

  const sig = def.signature;

  //
  // 3/ Apply `canonical` handler
  //
  // If present, the canonical handler is responsible for
  //  - validating the signature (domain and number of arguments)
  //  - sorting them
  //  - applying involution and idempotent to the expression
  //  - flatenning sequences
  //
  // The arguments have been put in canonical form, as per hold rules.
  //
  if (sig.canonical) {
    try {
      const result = sig.canonical(ce, xs);
      if (result) return result;
    } catch (e) {
      console.error(e?.stack ?? e.toString());
    }
    // The canonical handler gave up, return a non-canonical expression
    return new BoxedFunction(ce, head, xs, { metadata, canonical: false });
  }

  //
  // Flatten any sequence
  // f(a, Sequence(b, c), Sequence(), d) -> f(a, b, c, d)
  //
  let args: BoxedExpression[] = flatten(
    xs,
    def.associative && typeof head === 'string' ? head : undefined
  );

  const adjustedArgs = adjustArguments(
    ce,
    args,
    def.hold,
    def.threadable,
    sig.params,
    sig.optParams,
    sig.restParam
  );

  // If we have some adjusted arguments, the arguments did not
  // match the parameters of the signature. We're done.
  if (adjustedArgs) return ce._fn(head, adjustedArgs, metadata);

  //
  // 4/ Apply `idempotent` and `involution`
  //
  if (args.length === 1 && args[0].head === head) {
    // f(f(x)) -> x
    if (def.involution) return args[0].op1;

    // f(f(x)) -> f(x)
    if (def.idempotent) return ce._fn(head, xs[0].ops!, metadata);
  }

  //
  // 5/ Sort the arguments
  //
  if (args.length > 1 && def.commutative === true) args = args.sort(order);

  return ce._fn(head, args, metadata);
}

function makeNumericFunction(
  ce: IComputeEngine,
  head: string,
  semiOps: ReadonlyArray<SemiBoxedExpression>,
  metadata?: Metadata
): BoxedExpression | null {
  // @todo: is it really necessary to accept semiboxed expressions?
  let ops: ReadonlyArray<BoxedExpression> = [];
  if (head === 'Add' || head === 'Multiply')
    ops = checkNumericArgs(ce, semiCanonical(ce, semiOps), { flatten: head });
  else if (
    head === 'Negate' ||
    head === 'Square' ||
    head === 'Sqrt' ||
    head === 'Exp'
  )
    ops = checkNumericArgs(ce, semiCanonical(ce, semiOps), 1);
  else if (head === 'Ln' || head === 'Log')
    ops = checkNumericArgs(ce, semiCanonical(ce, semiOps));
  else if (head === 'Power')
    ops = checkNumericArgs(ce, semiCanonical(ce, semiOps), 2);
  else if (head === 'Divide')
    ops = checkNumericArgs(ce, semiCanonical(ce, semiOps));
  else return null;

  // If some of the arguments are not valid, we're done
  // (note: the result is canonical, but not valid)
  if (!ops.every((x) => x.isValid)) return ce._fn(head, ops, metadata);

  //
  // Short path for some functions
  // (avoid looking up a definition)
  //
  if (head === 'Add') return canonicalAdd(ce, ops);
  if (head === 'Negate') return ops[0].neg();
  if (head === 'Multiply') return canonicalMultiply(ce, ops);
  if (head === 'Divide') return ops.slice(1).reduce((a, b) => a.div(b), ops[0]);
  if (head === 'Exp') return ce.E.pow(ops[0]);
  if (head === 'Power') return ops[0].pow(ops[1]);
  if (head === 'Square') return ops[0].pow(2);
  if (head === 'Sqrt') return ops[0].sqrt();

  if (head === 'Ln' || head === 'Log') {
    if (ops[0].isOne) return ce.Zero;
    if (ops.length === 1) return ce._fn(head, ops, metadata);
    return ce._fn('Log', ops, metadata);
  }

  return null;
}

function fromNumericValue(
  ce: IComputeEngine,
  value: NumericValue
): BoxedExpression {
  if (value.isZero) return ce.Zero;
  if (value.isOne) return ce.One;
  if (value.isNegativeOne) return ce.NegativeOne;
  if (value.isNaN) return ce.NaN;
  if (value.isNegativeInfinity) return ce.NegativeInfinity;
  if (value.isPositiveInfinity) return ce.PositiveInfinity;

  if (!(value instanceof ExactNumericValue)) {
    const im = value.im;
    if (im === 0) return ce.number(value.bignumRe ?? value.re);
    if (value.re === 0) return ce.number(ce.complex(0, im));
    if (value.bignumRe) {
      return canonicalMultiply(ce, [
        ce.number(value.bignumRe),
        ce.number(ce.complex(0, im)),
      ]);
    }
    return ce.number(ce.complex(value.re, value.im));
  }

  const terms: BoxedExpression[] = [];

  let sign = 1;

  //
  // Real Part
  //
  if (value.sign !== 0) {
    // The real part is the product of a rational and radical

    if (value.radical === 1) {
      // No radical, just a rational part
      terms.push(ce.number(value.rational));
    } else {
      if (value.sign < 0) sign = -1;
      const rational = sign < 0 ? neg(value.rational) : value.rational;
      // At least a radical, maybe a rational as well.
      const radical = ce._fn('Sqrt', [ce.number(value.radical)]);
      if (isOne(rational)) terms.push(radical);
      else {
        const [n, d] = rational;
        if (d === 1) {
          if (n === 1) terms.push(radical);
          else terms.push(ce._fn('Multiply', [ce.number(n), radical]));
        } else {
          if (n === 1) terms.push(ce._fn('Divide', [radical, ce.number(d)]));
          else
            terms.push(
              ce._fn('Divide', [
                ce._fn('Multiply', [ce.number(n), radical]),
                ce.number(d),
              ])
            );
        }
      }
    }
  }

  let result: BoxedExpression;

  if (value.im === 0) {
    if (terms.length === 0) return ce.Zero;
    result = terms.length === 1 ? terms[0] : canonicalMultiply(ce, terms);
    return sign < 0 ? result.neg() : result;
  }

  //
  // Imaginary Part
  //
  if (terms.length === 0) return ce.number(ce.complex(0, value.im));

  result = terms.length === 1 ? terms[0] : canonicalMultiply(ce, terms);
  return canonicalAdd(ce, [
    sign < 0 ? result.neg() : result,
    ce.number(ce.complex(0, value.im)),
  ]);
}

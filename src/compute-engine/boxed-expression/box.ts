import { Complex } from 'complex-esm';
import { BigDecimal } from '../../big-decimal/index.js';
import type {
  ExpressionInput,
  Expression,
  CanonicalOptions,
  IComputeEngine as ComputeEngine,
  Metadata,
  Scope,
} from '../global-types.js';
import type { FormOption } from '../types-serialization.js';

import type {
  MathJsonExpression,
  ExpressionObject,
  MathJsonSymbol,
} from '../../math-json/types.js';
import {
  hasMetaData,
  machineValue,
  matchesNumber,
  matchesString,
  matchesSymbol,
  missingIfEmpty,
  stringValue,
  symbol,
} from '../../math-json/utils.js';
import { isValidSymbol, validateSymbol } from '../../math-json/symbols.js';

import { isOne, isZero } from '../numerics/rationals.js';
import { SMALL_INTEGER } from '../numerics/numeric.js';
import type { Rational } from '../numerics/types.js';
import { asBigint } from './numerics.js';
import { isInMachineRange } from '../numerics/numeric-bignum.js';

import { canonicalAdd } from './arithmetic-add.js';
import { canonicalMultiply, canonicalDivide } from './arithmetic-mul-div.js';

import { NumericValue } from '../numeric-value/types.js';
import { ExactNumericValue } from '../numeric-value/exact-numeric-value.js';
import { canonicalPower, canonicalRoot } from './arithmetic-power.js';

import { _BoxedExpression } from './abstract-boxed-expression.js';
import { BoxedFunction } from './boxed-function.js';
import { BoxedString } from './boxed-string.js';
import { BoxedTensor, expressionTensorInfo } from './boxed-tensor.js';
import { BoxedDictionary } from './boxed-dictionary.js';
import { canonicalForm } from './canonical.js';
import { sortOperands } from './order.js';
import { validateArguments, checkNumericArgs } from './validate.js';
import { isSubtype } from '../../common/type/subtype.js';
import type { Type } from '../../common/type/types.js';
import { flatten } from './flatten.js';
import { isValueDef } from './utils.js';
import { canonicalNegate } from './negate.js';
import { canonical } from './canonical-utils.js';
import { isNumber, isFunction } from './type-guards.js';
// Dynamic import to avoid circular dependency

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
 * - if `bignumPreferred()` all operations should be done in bignum,
 *    otherwise, they should all be done in machine numbers.
 * - if a rational is encountered, preserve it
 * - if a `Sqrt` of a rational is encountered, preserve it
 * - if a `hold` constant is encountered, preserve it
 * - if `numericApproximation` is false and one of the arguments is not exact,
 *  return an approximation
 * - if `numericApproximation` is true, always return an approximation
 *
 * NUMERIC APPROXIMATION = FALSE
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
 * - 2 + 2.1 -> 2 + 2.1
 *
 * NUMERIC APPROXIMATION = TRUE
 * - 2 + 2.1 -> 4.1
 * - 2 + √2.1 -> 3.44914
 * - 5/7 + √2.1 -> 2.16342
 * - sin(2) + √2.1 -> 2.35844
 */

/**
 * Translate a public `FormOption` to the internal
 * `{ canonical, structural }` representation.
 */
export function formToInternal(form?: FormOption): {
  canonical: CanonicalOptions;
  structural: boolean;
} {
  if (form === undefined || form === 'canonical')
    return { canonical: true, structural: false };
  if (form === 'raw') return { canonical: false, structural: false };
  if (form === 'structural') return { canonical: false, structural: true };
  // CanonicalForm or CanonicalForm[]
  return { canonical: form, structural: false };
}

/**
 * Resolve the internal `{ canonical, structural }` boxing form from the
 * options accepted by the public creation/parsing entry points
 * (`parse()`, `expr()`, `function()`).
 *
 * The canonical way to specify the form is the `form` option. As a
 * convenience — and to match the creation modes documented for these
 * methods — the `canonical` and `structural` boolean shortcuts are also
 * accepted. An explicit `form` takes precedence; otherwise `structural`
 * takes precedence over `canonical` (structural form is non-canonical but
 * bound).
 */
export function optionsToInternal(options?: {
  form?: FormOption;
  canonical?: CanonicalOptions;
  structural?: boolean;
}): { canonical: CanonicalOptions; structural: boolean } {
  if (!options) return { canonical: true, structural: false };
  const { form, canonical, structural } = options;
  if (form !== undefined) return formToInternal(form);
  if (structural === true) return { canonical: false, structural: true };
  if (canonical !== undefined) return { canonical, structural: false };
  return { canonical: true, structural: false };
}

function boxHold(
  ce: ComputeEngine,
  expr: ExpressionInput | null,
  options: { canonical?: CanonicalOptions }
): Expression {
  if (expr instanceof _BoxedExpression) return expr;

  expr = missingIfEmpty(expr as MathJsonExpression);

  if (typeof expr === 'string') return box(ce, expr, options);

  if (Array.isArray(expr)) {
    const [fnName, ...ops] = expr;
    return new BoxedFunction(
      ce,
      fnName,
      ops.map((x) => boxHold(ce, x, options)),
      { canonical: false }
    );
  }
  if (typeof expr === 'object') {
    if ('fn' in expr) return boxHold(ce, expr.fn, options);
    if ('str' in expr) return new BoxedString(ce, expr.str);
    if ('sym' in expr) return box(ce, expr.sym, options);
    if ('num' in expr) return box(ce, expr.num, options);
  }

  return box(ce, expr, options);
}

/**
 * Given a name and a set of arguments, return a boxed function expression.
 *
 * If available, preserve LaTeX and wikidata metadata in the boxed expression.
 *
 * Note that `boxFunction()` should only be called from `ce.function()`
 */

export function boxFunction(
  ce: ComputeEngine,
  name: MathJsonSymbol,
  ops: readonly ExpressionInput[],
  options?: {
    metadata?: Metadata;
    canonical?: CanonicalOptions;
    structural?: boolean;
    scope?: Scope;
  }
): Expression {
  options = options ? { ...options } : {};
  if (!('canonical' in options)) options.canonical = true;

  if (!isValidSymbol(name)) {
    throw new Error(
      `Unexpected operator: "${name}" is not a valid symbol: ${validateSymbol(
        name
      )}`
    );
  }

  const structural = options.structural ?? false;

  //
  // Hold
  //

  if (name === 'Hold') {
    return new BoxedFunction(ce, 'Hold', [boxHold(ce, ops[0], options)], {
      ...options,
      canonical: true,
      structural,
    });
  }

  //
  // Error
  //
  if (name === 'Error' || name === 'ErrorCode') {
    return new BoxedFunction(
      ce,
      name,
      ops.map((x) => ce.expr(x, { form: 'raw' })),
      { metadata: options?.metadata, canonical: true }
    );
  }

  //
  // Number
  //
  if (name === 'Number' && ops.length === 1) return box(ce, ops[0], options);

  const canonicalNumber = structural === false && options.canonical === true;

  // If canonical, handle cases of various expression structures being able to
  // be cast as BoxedNumbers (some cases of Negate, Rational, Divide, Complex),
  // or 'de-number' some 'borderline invalid' boxed number-like expressions
  // (!@note: this procedure is similarly repeated within the 'number'
  //  CanonicalForm, but the numberForm variant more simply applies to fully
  // BoxedExprs., and during partial canonicalization only)
  if (canonicalNumber) {
    //
    // Rational (as Divide)
    //
    if ((name === 'Divide' || name === 'Rational') && ops.length === 2) {
      const n = asBigint(ops[0]);
      if (n !== null) {
        const d = asBigint(ops[1]);
        if (d !== null) {
          // Handle division by zero: 0/0 = NaN, a/0 = ~∞
          if (d === 0n) return n === 0n ? ce.NaN : ce.ComplexInfinity;
          return ce.number([n, d], options);
        }
      }
      name = 'Divide';
    }

    //
    // Complex
    //
    if (name === 'Complex') {
      if (ops.length === 1) {
        // If single argument, assume it's imaginary
        const op1 = ops[0];
        if (op1 instanceof _BoxedExpression && op1.isNumberLiteral)
          return ce.number(ce.complex(0, op1.re), options);

        const im = machineValue(ops[0] as MathJsonExpression);
        if (im !== null && im !== 0)
          return ce.number(ce.complex(0, im), options);

        return ce.expr(op1).mul(ce.I);
      }
      if (ops.length === 2) {
        // Box the real operand so a high-precision bignum literal (e.g. a
        // 50-digit √2) is not truncated to a machine float. When the operand
        // arrives as raw MathJSON (`{ num: '1.414…' }`), reading `machineValue`
        // alone would silently discard the extra digits on re-boxing
        // (`ce.expr(z.json)`).
        const reOp =
          ops[0] instanceof _BoxedExpression
            ? ops[0]
            : box(ce, ops[0], options);
        const imOp =
          ops[1] instanceof _BoxedExpression
            ? ops[1]
            : box(ce, ops[1], options);

        // Exact components (integers, rationals, radicals) reconstruct an
        // EXACT complex value when the pair is representable (a Gaussian
        // rational, or a pure-imaginary radical). This is what makes
        // `ExactNumericValue.toJSON()` lossless: `['Complex', ['Rational',1,2], 3]`
        // re-boxes to the exact `1/2 + 3i`, not a machine float.
        {
          const reC = exactRealComponent(reOp);
          if (reC !== null) {
            const imC = exactRealComponent(imOp);
            if (imC !== null && !isZero(imC.rational)) {
              const reIsZero = isZero(reC.rational);
              if (
                (reIsZero || (reC.radical === 1 && imC.radical === 1)) &&
                imC.radical <= SMALL_INTEGER &&
                reC.radical <= SMALL_INTEGER
              )
                return ce.number(
                  ce._numericValue({
                    rational: reC.rational,
                    radical: reC.radical,
                    imRational: imC.rational,
                    imRadical: imC.radical,
                  }),
                  options
                );
            }
          }
        }

        const re = reOp.re;
        const im = imOp.re;
        if (im !== null && re !== null && !isNaN(im) && !isNaN(re)) {
          if (im === 0 && re === 0) return ce.Zero;
          if (im !== 0) {
            const bignumRe = reOp.bignumRe;
            return ce.number(
              ce._numericValue(
                bignumRe !== undefined ? { re: bignumRe, im } : { re, im }
              ),
              options
            );
          }
          return box(ce, ops[0], options);
        }
        return box(ce, ops[0], options).add(box(ce, ops[1], options).mul(ce.I));
      }
      throw new Error('Expected one or two arguments with Complex expression');
    }

    //
    // Negate
    //
    // Distribute over literals
    //
    if (name === 'Negate' && ops.length === 1) {
      const op1 = ops[0];
      if (typeof op1 === 'number') return ce.number(-op1, options);
      if (op1 instanceof BigDecimal) return ce.number(op1.neg(), options);
      const boxedop1 = ce.expr(op1, options);
      if (isNumber(boxedop1)) {
        const num = boxedop1.numericValue;
        return ce.number(typeof num === 'number' ? -num : num.neg(), options);
      }
      ops = [boxedop1];
    }
  }

  if (options.canonical === true)
    return makeCanonicalFunction(
      ce,
      name,
      ops,
      options.metadata,
      options.scope
    );

  return canonicalForm(
    new BoxedFunction(
      ce,
      name,
      ops.map((x) =>
        box(ce, x, {
          canonical: options.canonical,
          structural,
          scope: options.scope,
        })
      ),
      {
        metadata: options.metadata,
        canonical: false,
        structural,
        scope: options.scope,
      }
    ),
    options.canonical ?? false,
    options.scope
  );
}

/**
 * Notes about the boxed form:
 *
 * [1] MathJsonExpression with an operator of `Number`, `String`, `Symbol` and `Dictionary`
 *      are converted to the corresponding atomic expression.
 *
 * [2] Expressions with an operator of `Complex` are converted to a (complex) number
 *     or a `Add`/`Multiply` expression.
 *
 *     The precedence of `Complex` (for serialization) is sometimes the
 *     precedence of `Add` (when re and im != 0), sometimes the precedence of
 *    `Multiply` (when im or re === 0). Using a number or an explicit
 *    `Add`/`Multiply` expression avoids this ambiguity.
 *
 * [3] An expression with a `Rational` operator is converted to a rational
 *    number if possible, to a `Divide` otherwise.
 *
 * [4] A `Negate` function applied to a number literal is converted to a number.
 *
 *     Note that `Negate` is only distributed over addition. In practice, having
 * `Negate` factored on multiply/divide is more useful to detect patterns.
 *
 * Note that this function should only be called from `ce.expr()`
 *
 */

const inferenceTransactions = new WeakMap<
  ComputeEngine,
  { depth: number; inferredBefore: ReadonlySet<string> }
>();

export function beginInferenceTransaction(ce: ComputeEngine): () => void {
  let transaction = inferenceTransactions.get(ce);
  if (!transaction) {
    transaction = { depth: 0, inferredBefore: inferredSymbolNames(ce) };
    inferenceTransactions.set(ce, transaction);
  }
  transaction.depth += 1;
  return () => {
    transaction!.depth -= 1;
    if (transaction!.depth === 0) inferenceTransactions.delete(ce);
  };
}

export function box(
  ce: ComputeEngine,
  expr: null | undefined | NumericValue | ExpressionInput,
  options?: {
    canonical?: CanonicalOptions;
    structural?: boolean;
    scope?: Scope;
  }
): Expression {
  const endTransaction = beginInferenceTransaction(ce);
  try {
    return boxInternal(ce, expr, options);
  } finally {
    endTransaction();
  }
}

function boxInternal(
  ce: ComputeEngine,
  expr: null | undefined | NumericValue | ExpressionInput,
  options?: {
    canonical?: CanonicalOptions;
    structural?: boolean;
    scope?: Scope;
  }
): Expression {
  if (expr === null || expr === undefined) return ce.error('missing');

  if (expr instanceof NumericValue) return fromNumericValue(ce, expr);

  if (expr instanceof _BoxedExpression)
    return canonicalForm(expr, options?.canonical ?? true, options?.scope);

  options = options ? { ...options } : {};
  if (!('canonical' in options)) options.canonical = true;

  // If canonical is true, we want to canonicalize the arguments
  // If it's false or a CanonicalForm, we don't want to canonicalize the
  // arguments during create, we'll call canonicalForm to take care of it
  const canonical = options.canonical === true;

  const structural = options.structural ?? false;

  //
  //  Box a function
  //
  if (Array.isArray(expr)) {
    if (typeof expr[0] !== 'string') {
      // A function-literal head (or any boxed/array expression head) is
      // treated as an application, e.g.
      //   [["Function", body, "x"], arg] ≡ ["Apply", ["Function", body, "x"], arg]
      // This matches the explicit `Apply` form, which already beta-reduces.
      if (Array.isArray(expr[0]) || expr[0] instanceof _BoxedExpression)
        return box(ce, ['Apply', ...expr] as ExpressionInput, options);

      throw new Error(
        `The first element of an array should be a string (the function name): ${JSON.stringify(
          expr,
          undefined,
          4
        )}`
      );
    }

    return canonicalForm(
      boxFunction(ce, expr[0], expr.slice(1) as ExpressionInput[], {
        canonical,
        structural,
        scope: options?.scope,
      }),
      options?.canonical ?? true,
      options?.scope
    );
  }

  //
  // Box a number
  //
  if (
    typeof expr === 'number' ||
    expr instanceof BigDecimal ||
    expr instanceof Complex
  )
    return ce.number(expr);

  //
  // Box a boolean primitive as the True/False symbol.
  // Tensors with `dtype: 'bool'` store JS booleans directly, so `.each()`
  // and `.at()` over such a tensor need this case to yield usable
  // symbolic values. Mirrors the `boolean → True/False` mapping in
  // `jsValueToExpression`.
  //
  if (typeof expr === 'boolean') return ce.symbol(expr ? 'True' : 'False');

  //
  // Box a String, a Symbol or a number as a string shorthand
  //
  if (typeof expr === 'string') {
    // Is it a symbol?
    if (matchesSymbol(expr)) {
      const sym = symbol(expr);
      if (!sym || !isValidSymbol(sym)) return ce.error('invalid-symbol', expr);
      // Let 'partial' canonicalization fetch the canonical variant of symbols: in order that at
      // minimum, they may be substituted with associated definition values (when its def. 'holdUntil'
      // is 'never')
      // @note: alternatively, this could be signalled by a 'Symbol' CanonicalForm: but this way is
      // more predictable, & ensures substitution as per above
      const canonicalSymbol = canonical || options.canonical !== false;
      return ce.symbol(sym, { canonical: canonicalSymbol });
    }

    if (matchesNumber(expr)) return ce.number(expr);

    // Must be a string...
    console.assert(matchesString(expr));
    return new BoxedString(ce, stringValue(expr)!);
  }

  //
  // Box a MathJSON object literal
  //
  if (typeof expr === 'object') {
    // Extract metadata (latex, wikidata) from the MathJSON object if present
    const metadata = hasMetaData(expr as ExpressionObject)
      ? {
          latex: (expr as ExpressionObject & { latex?: string }).latex,
          wikidata: (expr as ExpressionObject & { wikidata?: string }).wikidata,
          sourceOffsets: (
            expr as ExpressionObject & {
              sourceOffsets?: [start: number, end: number];
            }
          ).sourceOffsets,
        }
      : undefined;

    if ('fn' in expr) {
      const [fnName, ...ops] = expr.fn;
      return canonicalForm(
        boxFunction(ce, fnName, ops, { canonical, structural, metadata }),
        options.canonical!,
        options.scope
      );
    }
    if ('str' in expr) return new BoxedString(ce, expr.str, metadata);
    if ('sym' in expr) return ce.symbol(expr.sym, { canonical, metadata });
    if ('num' in expr) return ce.number(expr, { canonical, metadata });
    if ('dict' in expr)
      return new BoxedDictionary(ce, expr.dict, { canonical });

    throw new Error(
      `Unexpected MathJSON object: ${JSON.stringify(expr, undefined, 4)}`
    );
  }

  return ce.symbol('Undefined');
}

/**
 * True when every declared parameter of a signature (required, optional and
 * variadic) is a numeric type (a subtype of `number`). Used to restrict the
 * post-canonical argument re-validation in `makeCanonicalFunction` to the
 * pure-numeric operators (`Sin`, `Factorial`, …) whose custom canonical
 * handlers historically only checked arity. A signature with no parameters, or
 * any non-numeric parameter, returns `false` so structural/higher-order
 * operators are left untouched.
 */
function allParamsNumeric(signature: Type): boolean {
  if (typeof signature === 'string') return false;
  if (signature.kind !== 'signature') return false;
  const params: Type[] = [
    ...(signature.args?.map((x) => x.type) ?? []),
    ...(signature.optArgs?.map((x) => x.type) ?? []),
    ...(signature.variadicArg ? [signature.variadicArg.type] : []),
  ];
  if (params.length === 0) return false;
  return params.every((t) => isSubtype(t, 'number'));
}

function makeCanonicalFunction(
  ce: ComputeEngine,
  name: string,
  ops: ReadonlyArray<ExpressionInput>,
  metadata: Metadata | undefined,
  scope: Scope | undefined
): Expression {
  let result = makeNumericFunction(ce, name, ops, metadata, scope);
  if (result) return result;

  //
  // Do we have a vector/matrix/tensor?
  // It has to have a compatible shape: i.e. all elements on an axis have
  // the same shape, and all elements of the same type.
  //
  if (name === 'List') {
    // We don't canonicalize it, in case it's a List (we want to detect lists of lists)
    const boxedOps = ops.map((x) => ce.expr(x, { form: 'raw' }));
    const tensorInfo = expressionTensorInfo('List', boxedOps);

    if (tensorInfo && tensorInfo.dtype) {
      return new BoxedTensor(
        ce,
        {
          ops: canonical(ce, boxedOps, scope),
          shape: tensorInfo.shape,
          dtype: tensorInfo.dtype,
        },
        { metadata }
      );
    }

    return new BoxedFunction(ce, 'List', canonical(ce, boxedOps, scope), {
      canonical: true,
    });
  }

  if (name === 'Dictionary') {
    const boxedOps = ops.map((x) => ce.expr(x, { form: 'raw' }));
    return new BoxedDictionary(ce, ce._fn('Dictionary', boxedOps), {
      canonical: true,
    });
  }

  //
  // Didn't match a short path, look for a definition
  //
  const def = ce.lookupDefinition(name);
  if (!def) {
    // No def. This is for example `["f", 2]` where "f" is not declared.
    ce.declare(name, { type: 'function', inferred: true });
    return new BoxedFunction(ce, name, flatten(semiCanonical(ce, ops)), {
      metadata,
      canonical: true,
    });
  }

  if (isValueDef(def)) {
    // The symbol is declared, but as a value.
    // We construct the function expression and will check its value
    // is a function literal when evaluating it.
    const boxedOps = flatten(semiCanonical(ce, ops));

    // If the symbol was declared with an explicit *function* signature (e.g.
    // `ce.declare('f', '(integer) -> integer')`), enforce the parameter types
    // on application in strict mode: `f(0.5)` and `f("a")` are ill-typed. The
    // value-def application path historically honored the *result* type but
    // never validated the operands. An *inferred* signature carries no user
    // constraint (and an assigned function literal validates its own params
    // when applied), so skip those.
    const valueType = def.value.type.type;
    if (
      ce.strict &&
      !def.value.inferredType &&
      typeof valueType !== 'string' &&
      valueType.kind === 'signature'
      // Complex-family parameters (`(complex) -> complex`, …) are enforced
      // like any other: under D10 (2026-07-02) `real ⊂ complex`, so
      // real/integer/rational arguments satisfy them through the normal
      // subtype path, and the arithmetic type handlers (Multiply, Divide,
      // Power, Ln) are complex-aware for real × pure-imaginary operands (a
      // pure-imaginary product such as `√2·i` types as `imaginary` ⊂
      // `complex`), which retired the last `signatureHasComplexParam` skip.
    ) {
      const invalid = validateArguments(ce, boxedOps, valueType);
      if (invalid) {
        // Only reject *closed* operands — literals and constant expressions
        // whose type is definite (`0.5`, `"a"`). An operand with free
        // variables (a bare symbol `x`, a pattern variable `_q`, or `x+1`)
        // has a provisional/broad type and may satisfy the parameter at
        // runtime, so it is not eagerly rejected; un-reject those and only
        // keep an invalid result if a closed operand actually violated the
        // signature.
        const cleaned = invalid.map((r, i) => {
          const orig = boxedOps[i];
          if (
            orig &&
            orig.isValid &&
            !r.isValid &&
            orig.freeVariables.length > 0
          )
            return orig;
          return r;
        });
        if (cleaned.some((r) => !r.isValid))
          return new BoxedFunction(ce, name, cleaned, {
            metadata,
            canonical: true,
          });
      }
    }

    return new BoxedFunction(ce, name, boxedOps, {
      metadata,
      canonical: true,
    });
  }

  const opDef = def.operator;

  // If the operator has a local scope, create it now (unless we were given one,
  // for example one might have been create to record the arguments of a
  // function, but not for a Block expression)
  scope ??= opDef.scoped
    ? {
        parent: ce.context.lexicalScope,
        bindings: new Map(),
      }
    : undefined;

  if (opDef.lazy) {
    // If we have a lazy function, we don't canonicalize the arguments
    const xs = ops.map((x) => ce.expr(x, { form: 'raw' }));
    if (opDef.canonical) {
      try {
        result = opDef.canonical(xs, { engine: ce, scope });
        if (result) return result;
      } catch (e) {
        console.error(e instanceof Error ? e.message : e);
      }
      // The canonical handler gave up, return a non-canonical expression
      result = new BoxedFunction(ce, name, xs, {
        metadata,
        canonical: false,
      });
      return result;
    }

    result = new BoxedFunction(
      ce,
      name,
      opDef.inferredSignature
        ? xs
        : (validateArguments(
            ce,
            xs,
            opDef.signature.type,
            opDef.lazy,
            opDef.broadcastable
          ) ?? xs),
      { metadata, canonical: true, scope }
    );
    return result;
  }

  // Keep a boundary around inference performed while canonicalizing these
  // operands. Signature validation may use this to retract only fresh,
  // provisional guesses; inferences from earlier expressions are never
  // eligible for repair.
  const xs = ops.map((x) => ce.expr(x));

  //
  // 3/ Apply `canonical` handler
  //
  // If present, the canonical handler is responsible for
  //  - validating the signature (domain and number of arguments)
  //  - sorting them
  //  - applying involution and idempotent to the expression
  //  - flatenning sequences
  //
  // The arguments have been put in canonical form
  //
  if (opDef.canonical) {
    try {
      const result = opDef.canonical(xs, { engine: ce, scope });
      if (result) {
        // In strict mode, validate the operands against the operator's declared
        // signature *after* the canonical handler runs. Historically a custom
        // canonical handler was the sole gate on argument validity, and most
        // only check arity — so ill-typed calls such as `Sin("hello")` or
        // `Factorial("x")` slipped through as `isValid`.
        //
        // The re-validation is deliberately narrow, gated on all of:
        //  - the handler returned an expression with the *same* operator (a
        //    handler that rewrote the head — `Rational`→`Divide`,
        //    `Sqrt`→`Power` — or folded to a number made its own decision);
        //  - that result is still valid (don't second-guess a handler that
        //    already flagged an argument);
        //  - the signature is not inferred (an inferred signature carries no
        //    constraints; inference narrows it later);
        //  - every declared parameter is numeric (subtype of `number`). This
        //    restricts the check to the pure-numeric operators the finding
        //    targets and leaves higher-order/structural operators — `Apply`
        //    (`symbol` param), `Equivalent` (`boolean`), the big-ops — alone,
        //    since their declared signatures are looser than what their
        //    handlers legitimately accept.
        //
        // The check uses `checkNumericArgs` (not the exact-typed
        // `validateArguments`) so it matches the leniency of the fast-path
        // numeric operators: unknown symbols, `number | list` unions, tensors
        // and numeric collections are all accepted (a numeric operator is
        // threadable), and only a *provably* non-numeric operand — a string,
        // a boolean — is rejected.
        if (
          ce.strict &&
          !opDef.inferredSignature &&
          isFunction(result, name) &&
          result.isValid &&
          allParamsNumeric(opDef.signature.type)
        ) {
          const checked = checkNumericArgs(ce, result.ops);
          if (checked.some((x) => !x.isValid))
            return new BoxedFunction(ce, name, checked, {
              metadata,
              canonical: true,
              scope,
            });
        }
        return result;
      }
    } catch (e) {
      console.error(e instanceof Error ? e.message : e);
    }

    // The canonical handler gave up, return a non-canonical expression
    const result = new BoxedFunction(ce, name, xs, {
      metadata,
      canonical: false,
    });

    return result;
  }

  //
  // Flatten any sequence
  // f(a, Sequence(b, c), Sequence(), d) -> f(a, b, c, d)
  //
  const args: Expression[] = flatten(xs, opDef.associative ? name : undefined);

  // Skip validation for function literals with inferred signatures.
  // These will be validated during evaluation by the lambda function,
  // which handles currying and partial application.
  const adjustedArgs = opDef.inferredSignature
    ? null
    : validateArguments(
        ce,
        args,
        opDef.signature.type,
        opDef.lazy,
        opDef.broadcastable,
        inferenceTransactions.get(ce)?.inferredBefore
      );

  // If we have some adjusted arguments, the arguments did not
  // match the parameters of the signature. We're done.
  if (adjustedArgs) {
    return new BoxedFunction(ce, name, adjustedArgs, {
      metadata,
      canonical: true,
      scope,
    });
  }

  //
  // 4/ Apply `idempotent` and `involution`
  //
  if (args.length === 1 && args[0].operator === name) {
    // f(f(x)) -> x
    if (opDef.involution && isFunction(args[0])) return args[0].op1;

    // f(f(x)) -> f(x)
    if (opDef.idempotent && isFunction(xs[0]))
      return new BoxedFunction(ce, name, xs[0].ops, {
        metadata,
        canonical: true,
        scope,
      });
  }

  //
  // 5/ Sort the operands
  //

  return new BoxedFunction(ce, name, sortOperands(name, args), {
    metadata,
    canonical: true,
    scope,
  });
}

function inferredSymbolNames(ce: ComputeEngine): ReadonlySet<string> {
  const result = new Set<string>();
  let scope: Scope | null = ce.context.lexicalScope;
  while (scope) {
    for (const [name, binding] of scope.bindings)
      if (
        isValueDef(binding) &&
        binding.value.inferredType &&
        !binding.value.type.isUnknown
      )
        result.add(name);
    scope = scope.parent;
  }
  return result;
}

function makeNumericFunction(
  ce: ComputeEngine,
  name: MathJsonSymbol,
  semiOps: ReadonlyArray<ExpressionInput>,
  metadata?: Metadata,
  scope?: Scope
): Expression | null {
  let ops: ReadonlyArray<Expression> = [];
  if (name === 'Add' || name === 'Multiply')
    ops = checkNumericArgs(ce, semiCanonical(ce, semiOps, scope), {
      flatten: name,
    });
  else if (
    name === 'Negate' ||
    name === 'Square' ||
    name === 'Sqrt' ||
    name === 'Exp'
  )
    ops = checkNumericArgs(ce, semiCanonical(ce, semiOps, scope), 1);
  else if (name === 'Ln' || name === 'Log') {
    ops = checkNumericArgs(ce, semiCanonical(ce, semiOps, scope));
    if (ops.length === 0) ops = [ce.error('missing')];
  } else if (name === 'Power' || name === 'Root')
    ops = checkNumericArgs(ce, semiCanonical(ce, semiOps, scope), 2);
  else if (name === 'Divide') {
    // Note: Divide can have more than one argument, i.e.
    // Divide(a, b, c) = a / b / c
    // But it needs at least two arguments
    ops = checkNumericArgs(ce, semiCanonical(ce, semiOps, scope));
    if (ops.length === 0) ops = [ce.error('missing'), ce.error('missing')];
    if (ops.length === 1) ops = [ops[0], ce.error('missing')];
  } else return null;

  // If some of the arguments are not valid, we're done
  // (note: the result is canonical, but not valid)
  if (!ops.every((x) => x.isValid))
    return new BoxedFunction(ce, name, ops, { metadata, canonical: true });

  //
  // Short path for some functions
  // (avoid looking up a definition)
  //
  if (name === 'Add') return canonicalAdd(ce, ops);
  if (name === 'Negate') return canonicalNegate(ops[0]);
  if (name === 'Multiply') return canonicalMultiply(ce, ops);
  if (name === 'Divide') {
    if (ops.length === 2)
      return canonicalDivide(...(ops as [Expression, Expression]));
    return ops.slice(1).reduce((a, b) => canonicalDivide(a, b), ops[0]);
  }
  if (name === 'Exp') return canonicalPower(ce.E, ops[0]);
  if (name === 'Square') return canonicalPower(ops[0], ce.number(2));
  if (name === 'Power') return canonicalPower(ops[0], ops[1]);
  if (name === 'Root') return canonicalRoot(ops[0], ops[1]);
  if (name === 'Sqrt') return canonicalRoot(ops[0], 2);

  if (name === 'Ln' || name === 'Log') {
    if (ops.length > 0) {
      // Ln(1) -> 0, Log(1) -> 0 — literal only: `.isSame(1)` follows symbol
      // value bindings, and a mutable symbol's transient value must not fold
      // into canonical structure (`Ln(x)` while `x` holds 1 stays `Ln(x)`).
      if (isNumber(ops[0]) && ops[0].isSame(1)) return ce.Zero;
      // Ln(a) -> Ln(a), Log(a) -> Log(a)
      if (ops.length === 1)
        return new BoxedFunction(ce, name, ops, { metadata, canonical: true });
    }
    // Ln(a,b) -> Log(a, b)
    return new BoxedFunction(ce, 'Log', ops, { metadata, canonical: true });
  }

  return null;
}

/**
 * The exact real component (`rational · √radical`) of a boxed expression that
 * is an exact real number literal, or `null`. Used to reconstruct exact
 * complex values when boxing `['Complex', re, im]`.
 */
function exactRealComponent(
  op: Expression
): { rational: Rational; radical: number } | null {
  if (!isNumber(op)) return null;
  const nv = op.numericValue;
  if (typeof nv === 'number') {
    if (!Number.isInteger(nv)) return null;
    return { rational: [nv, 1], radical: 1 };
  }
  if (nv.im !== 0) return null;
  const exact = nv.asExact;
  if (!(exact instanceof ExactNumericValue)) return null;
  if (exact.isNaN || exact.isPositiveInfinity || exact.isNegativeInfinity)
    return null;
  return { rational: exact.rational, radical: exact.radical };
}

function fromNumericValue(ce: ComputeEngine, value: NumericValue): Expression {
  if (value.isZero) return ce.Zero;
  if (value.isOne) return ce.One;
  if (value.isNegativeOne) return ce.NegativeOne;
  if (value.isNaN) return ce.NaN;
  if (value.isNegativeInfinity) return ce.NegativeInfinity;
  if (value.isPositiveInfinity) return ce.PositiveInfinity;

  value = value.asExact ?? value;

  // An exact complex value is best represented as a number literal directly:
  // decomposing it into `re + im·i` terms would only re-fold to the same
  // literal (via canonicalAdd), and the machine-complex imaginary emission
  // below would degrade it to an inexact float.
  if (value.im !== 0 && value instanceof ExactNumericValue)
    return ce.number(value);

  if (!value.isExact) {
    const im = value.im;
    if (im === 0) return ce.number(value.bignumRe ?? value.re);
    if (value.re === 0) return ce.number(ce.complex(0, im));
    if (value.bignumRe !== undefined && !isInMachineRange(value.bignumRe)) {
      return canonicalAdd(ce, [
        ce.number(value.bignumRe),
        ce.number(ce.complex(0, im)),
      ]);
    }
    return ce.number(ce.complex(value.re, value.im));
  }

  const terms: Expression[] = [];

  //
  // Real Part
  //
  const exactValue = value as ExactNumericValue;
  if (exactValue.sign !== 0) {
    // The real part is the product of a rational and radical

    if (exactValue.radical === 1) {
      // No radical, just a rational part
      terms.push(ce.number(exactValue.rational));
    } else {
      const rational = exactValue.rational;
      // At least a radical, maybe a rational as well.
      const radical = ce.function('Sqrt', [ce.number(exactValue.radical)]);
      if (isOne(rational)) terms.push(radical);
      else {
        const [n, d] = rational;
        if (d === 1) {
          if (n === 1) terms.push(radical);
          else terms.push(ce.function('Multiply', [ce.number(n), radical]));
        } else {
          if (n === 1)
            terms.push(ce.function('Divide', [radical, ce.number(d)]));
          else
            terms.push(
              ce.function('Divide', [
                ce.function('Multiply', [ce.number(n), radical]),
                ce.number(d),
              ])
            );
        }
      }
    }
  }

  let result: Expression;

  if (value.im === 0) {
    if (terms.length === 0) return ce.Zero;
    result = terms.length === 1 ? terms[0] : canonicalMultiply(ce, terms);
    return result;
  }

  //
  // Imaginary Part
  //
  if (terms.length === 0) return ce.number(ce.complex(0, value.im));

  result = terms.length === 1 ? terms[0] : canonicalMultiply(ce, terms);
  return canonicalAdd(ce, [result, ce.number(ce.complex(0, value.im))]);
}

export function semiCanonical(
  ce: ComputeEngine,
  xs: ReadonlyArray<ExpressionInput>,
  scope?: Scope
): ReadonlyArray<Expression> {
  // Avoid memory allocation if possible
  if (xs.every((x) => x instanceof _BoxedExpression && x.isCanonical))
    return xs as ReadonlyArray<Expression>;

  return xs.map((x) => ce.expr(x, { scope }));
}

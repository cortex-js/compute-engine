import { apply } from '../function-utils.js';
import { checkDeadline } from '../../common/interruptible.js';
import { mul } from '../boxed-expression/arithmetic-mul-div.js';
import type { Expression, ExpressionInput } from '../global-types.js';
import { add } from '../boxed-expression/arithmetic-add.js';
import {
  isNumber,
  isSymbol,
  isFunction,
  isString,
  sym,
} from '../boxed-expression/type-guards.js';
import { functionLiteralParameterName } from '../boxed-expression/function-literal.js';

/**
 * Maximum recursion depth for differentiation.
 *
 * This guards against pathological cases where differentiation rules
 * might loop indefinitely. Normal derivatives (including higher-order)
 * should never approach this limit.
 */
const MAX_DIFFERENTIATION_DEPTH = 100;

// Differentiation can blow up in WIDTH, not just depth: the product/chain
// rules square the expression size at each order, so an r-th symbolic
// derivative (e.g. of LambertW — REVIEW.md G8, Fungrim 8e8a59) can allocate
// gigabytes building one expression while staying well under the depth
// limit. Check the engine deadline periodically across recursive calls.
let differentiateCallCount = 0;

//
// ── Derivative trace ────────────────────────────────────────────────
//
// `expr.explain('D')` threads an optional trace through `differentiate()`.
// Each branch records — BEFORE recursing into sub-derivatives — the node it
// is differentiating, the id of the textbook rule applied, and the rule's
// output `template`: the formula with each unresolved sub-derivative as an
// inert `D(child, v)` placeholder. The explain layer
// (symbolic/explain-derivative.ts) replays these records in traversal
// order, replacing each placeholder in a whole-expression state — the
// standard textbook presentation.
//
// The trace is a pure observation channel: recording is guarded on the
// accumulator being present and never affects control flow or results.
//

/** One derivative rule application: differentiating `node` by rule `id`
 * produced `template` (with `D(child, v)` placeholders for the
 * sub-derivatives that the recursion resolves next). */
export type DerivativeTraceStep = {
  node: Expression;
  id: string;
  template: Expression;
};

export type DerivativeTrace = DerivativeTraceStep[];

/** The placeholder for the derivative of `child` in a rule template:
 * trivial derivatives are resolved inline (matching what the recursion
 * returns without recording a step), everything else is an inert
 * `D(child, v)` that a later trace record replaces. */
function dPlaceholder(child: Expression, v: string): Expression {
  const ce = child.engine;
  if (isSymbol(child) && child.symbol === v) return ce.One;
  if (!child.has(v)) return ce.Zero;
  return ce._fn('D', [child, ce.symbol(v)]);
}

/** Record one rule application. The template is a thunk so nothing is
 * allocated when no trace is attached. Nodes that do not depend on `v`
 * are skipped: their derivative is zero and the recursion records no
 * steps for them either. */
function recordD(
  trace: DerivativeTrace | undefined,
  node: Expression,
  v: string,
  id: string,
  template: () => Expression
): void {
  if (!trace || !node.has(v)) return;
  trace.push({ node, id, template: template() });
}

/**
 * Return a derivative result without simplification.
 *
 * ## Recursion Safety
 *
 * IMPORTANT: Do not call `.simplify()` on the result to avoid infinite recursion
 * when derivative operations are called from within simplification rules.
 *
 * The differentiation system has multiple layers of recursion protection:
 *
 * 1. **This function** - Returns expressions without calling `.simplify()`
 * 2. **D operator guard** (calculus.ts) - Returns early if result is still `D`
 * 3. **differentiate() guard** - Returns `undefined` if evaluating `D` yields `D`
 * 4. **Depth limit** - `MAX_DIFFERENTIATION_DEPTH` prevents runaway recursion
 * 5. **DERIVATIVES_TABLE check** - Uses `=== undefined` not `!h` to handle `h = 0`
 *
 * The arithmetic operations (add, mul, etc.) already produce canonical forms.
 */
function simplifyDerivative(expr: Expression): Expression {
  return expr;
}

// See also:
//
// - Table of 113 common integrals (antiderivative tables):
// https://www.physics.umd.edu/hep/drew/IntegralTable.pdf
//
// - More extensive table:
// https://www.math.stonybrook.edu/~bishop/classes/math126.F20/CRC_integrals.pdf
//

const DERIVATIVES_TABLE = {
  Sin: ['Cos', '_'],
  Cos: ['Negate', ['Sin', '_']],
  Tan: ['Power', ['Sec', '_'], 2],
  Sec: ['Multiply', ['Tan', '_'], ['Sec', '_']],
  Csc: ['Multiply', ['Negate', ['Cot', '_']], ['Csc', '_']],
  Cot: ['Negate', ['Power', ['Csc', '_'], 2]],
  Arcsin: ['Power', ['Subtract', 1, ['Power', '_', 2]], ['Negate', 'Half']],
  Arccos: [
    'Negate',
    ['Power', ['Subtract', 1, ['Power', '_', 2]], ['Negate', 'Half']],
  ],
  Arctan: ['Power', ['Add', 1, ['Power', '_', 2]], -1],
  // d/dx arcsec(x) = 1 / (|x| * sqrt(x^2 - 1)), defined on |x| >= 1
  Arcsec: [
    'Divide',
    1,
    ['Multiply', ['Abs', '_'], ['Sqrt', ['Subtract', ['Power', '_', 2], 1]]],
  ],
  // d/dx arccsc(x) = -1 / (|x| * sqrt(x^2 - 1)), defined on |x| >= 1
  Arccsc: [
    'Negate',
    [
      'Divide',
      1,
      ['Multiply', ['Abs', '_'], ['Sqrt', ['Subtract', ['Power', '_', 2], 1]]],
    ],
  ],
  Arccot: ['Negate', ['Power', ['Add', 1, ['Power', '_', 2]], -1]],
  Sinh: ['Cosh', '_'],
  Cosh: ['Sinh', '_'],
  Tanh: ['Power', ['Sech', '_'], 2],
  // d/dx sech(x) = -tanh(x)*sech(x)
  Sech: ['Negate', ['Multiply', ['Tanh', '_'], ['Sech', '_']]],
  // d/dx csch(x) = -coth(x)*csch(x)
  Csch: ['Negate', ['Multiply', ['Coth', '_'], ['Csch', '_']]],
  Coth: ['Negate', ['Power', ['Csch', '_'], 2]],
  Arsinh: ['Power', ['Add', ['Power', '_', 2], 1], ['Negate', 'Half']],
  Arcosh: ['Power', ['Subtract', ['Power', '_', 2], 1], ['Negate', 'Half']],
  Artanh: ['Power', ['Subtract', 1, ['Power', '_', 2]], -1],
  // d/dx arsech(x) = -1 / (x * sqrt(1 - x^2))
  Arsech: [
    'Negate',
    [
      'Divide',
      1,
      ['Multiply', '_', ['Sqrt', ['Subtract', 1, ['Power', '_', 2]]]],
    ],
  ],
  // d/dx arcsch(x) = -1 / (|x| * sqrt(1 + x^2))
  Arcsch: [
    'Negate',
    [
      'Divide',
      1,
      ['Multiply', ['Abs', '_'], ['Sqrt', ['Add', 1, ['Power', '_', 2]]]],
    ],
  ],
  // d/dx arcoth(x) = 1 / (1 - x^2), same formula as Artanh on |x| > 1
  Arcoth: ['Power', ['Subtract', 1, ['Power', '_', 2]], -1],
  // Exp: ['Exp', '_'],   // Gets canonicalized to Power
  Ln: ['Divide', 1, '_'],
  Log: ['Power', ['Multiply', '_', ['Ln', '10']], -1],
  Sqrt: ['Multiply', ['Power', '_', ['Negate', 'Half']], 'Half'],
  // d/dx |x| = x/|x| = sign(x) for x ≠ 0 (undefined at x = 0)
  Abs: ['Sign', '_'],
  // Step functions: derivative is 0 almost everywhere (undefined at discontinuities)
  Floor: 0,
  Ceil: 0,
  Round: 0,
  // https://proofwiki.org/wiki/Derivative_of_Error_Function
  Erf: [
    'Multiply',
    ['Divide', '2', ['Sqrt', 'Pi']],
    ['Exp', ['Negate', ['Square', '_']]],
  ],
  // https://proofwiki.org/wiki/Derivative_of_Gamma_Function
  // https://en.wikipedia.org/wiki/Gamma_function
  // d/dx Γ(x) = Γ(x)·ψ(x) where ψ is the digamma function
  Gamma: ['Multiply', ['Gamma', '_'], ['Digamma', '_']],
  // d/dx erfc(x) = -d/dx erf(x) = -2/√π * e^(-x²)
  Erfc: [
    'Negate',
    [
      'Multiply',
      ['Divide', 2, ['Sqrt', 'Pi']],
      ['Exp', ['Negate', ['Square', '_']]],
    ],
  ],
  // d/dx ln(Γ(x)) = ψ(x) (digamma function)
  GammaLn: ['Digamma', '_'],
  // d/dx ψ(x) = ψ₁(x) (trigamma function)
  // https://en.wikipedia.org/wiki/Trigamma_function
  Digamma: ['Trigamma', '_'],
  // d/dx ψ₁(x) = ψ⁽²⁾(x) — the polygamma ladder continues past Trigamma
  Trigamma: ['PolyGamma', 2, '_'],
  // d/dx W(x) = W(x)/(x·(1+W(x))) where W is the Lambert W function
  // https://en.wikipedia.org/wiki/Lambert_W_function#Derivative
  LambertW: [
    'Divide',
    ['LambertW', '_'],
    ['Multiply', '_', ['Add', 1, ['LambertW', '_']]],
  ],
  // d/dx S(x) = sin(πx²/2) where S is the Fresnel sine integral
  FresnelS: ['Sin', ['Multiply', ['Divide', 'Pi', 2], ['Square', '_']]],
  // d/dx C(x) = cos(πx²/2) where C is the Fresnel cosine integral
  FresnelC: ['Cos', ['Multiply', ['Divide', 'Pi', 2], ['Square', '_']]],
  // d/dx erfi(x) = (2/√π)·e^(x²) where erfi is the imaginary error function
  Erfi: ['Multiply', ['Divide', 2, ['Sqrt', 'Pi']], ['Exp', ['Square', '_']]],
  // d/dx Si(x) = sin(x)/x where Si is the sine integral
  SinIntegral: ['Divide', ['Sin', '_'], '_'],
  // d/dx Ci(x) = cos(x)/x where Ci is the cosine integral
  CosIntegral: ['Divide', ['Cos', '_'], '_'],
  // d/dx Shi(x) = sinh(x)/x where Shi is the hyperbolic sine integral
  SinhIntegral: ['Divide', ['Sinh', '_'], '_'],
  // d/dx Chi(x) = cosh(x)/x where Chi is the hyperbolic cosine integral
  CoshIntegral: ['Divide', ['Cosh', '_'], '_'],
  // d/dx Ei(x) = e^x/x where Ei is the exponential integral
  ExpIntegralEi: ['Divide', ['Exp', '_'], '_'],
  // d/dx li(x) = 1/ln(x) where li is the logarithmic integral
  LogIntegral: ['Divide', 1, ['Ln', '_']],
  // Note: Bessel functions (BesselJ, BesselY, BesselI, BesselK) and Airy functions
  // (AiryAi, AiryBi) have been omitted because their derivatives involve functions
  // of different orders or related derivative functions that are not in the standard
  // function set. For example, d/dx J_n(x) = (J_{n-1}(x) - J_{n+1}(x))/2.
  //
  // Similarly, Zeta, PolyGamma, and Beta derivatives are omitted because
  // they either don't have simple closed forms or involve the polygamma function
  // with varying orders.
};

/**
 * True if `sym` names a user-defined function whose body can be resolved by
 * applying the symbol to wildcards and evaluating. Two definition shapes
 * qualify: an operator definition (a bare `f(x) := …` assignment), or a value
 * definition whose value is a `Function` literal — a symbol declared with a
 * function type and then assigned, where declared-signature reconciliation
 * (engine-declarations.ts §6.3) keeps the literal as the symbol's value
 * instead of converting to an operator definition.
 */
function isUserFunction(sym: Expression): boolean {
  if (sym.operatorDefinition !== undefined) return true;
  const value = sym.valueDefinition?.value;
  return value !== undefined && isFunction(value, 'Function');
}

/**
 *
 * @param fn The function to differentiate, a function literal.
 *
 * @returns a function expression representing the derivative of `fn` with
 * respect to the variables in `degrees`.
 */
export function derivative(
  fn: Expression,
  order: number
): Expression | undefined {
  if (order === 0) return fn;
  const ce = fn.engine;
  let v = '_';
  if (isSymbol(fn) && fn.operatorDefinition) {
    // We have, e.g. fn = 'Sin"
    fn = apply(ce.symbol(fn.symbol), [ce.symbol('_')]);
  } else if (isSymbol(fn)) {
    return ce._fn('Derivative', [fn, ce.number(order)]);
  }
  if (isFunction(fn, 'Function')) {
    // We have, e.g. fn = ['Function', ['Sin', 'x'], 'x']
    v = functionLiteralParameterName(fn.ops[1]) || '_';
    fn = fn.ops[0];
  }
  const originalOrder = order;
  let result: Expression | undefined = fn;
  while (order-- > 0 && result) result = differentiate(result, v);

  // The iterated product/quotient rule squares the denominator at each step,
  // so an r-th derivative can carry x^(2^r)-scale exponents (e.g. the 75th
  // derivative of sin(x)/x ends up over x^(2^75)). Left unreduced these
  // overflow on evaluation. A single simplify at the end cancels the common
  // factors back to a linear-degree denominator (x^(2^r) -> x^(r+1)); it is
  // cheap (~30ms even at order 75) precisely because it runs once, not per
  // step. The coefficients are already exact integers, so this only collapses
  // structure, it does not change values. Only needed for order >= 2 (a single
  // derivative cannot blow up), which also leaves the common case untouched.
  if (result && originalOrder >= 2) result = result.simplify();
  return result;
}

/**
 * Read the multi-index of differentiation orders from a
 * `Derivative(f, n₁, …, n_k)` expression, padded/truncated to `arity` slots.
 *
 * Each order is the number of times `f` is differentiated with respect to the
 * argument in that position. A bare `Derivative(f)` applied to a single
 * argument denotes a first derivative. Returns `undefined` if any order is not
 * a finite integer.
 */
function derivativeOrders(
  derivativeFn: Expression,
  arity: number
): number[] | undefined {
  if (!isFunction(derivativeFn)) return undefined;
  const raw = derivativeFn.ops.slice(1);
  const orders: number[] = [];
  for (let i = 0; i < arity; i++) {
    if (i < raw.length) {
      const n = Math.floor(raw[i].N().re);
      if (Number.isNaN(n)) return undefined;
      orders.push(n);
    } else {
      // No explicit order for this slot: a bare `Derivative(f)` on a single
      // argument means a first derivative; any other missing slot is order 0.
      orders.push(raw.length === 0 && arity === 1 ? 1 : 0);
    }
  }
  return orders;
}

/**
 * Differentiate `Apply(Derivative(fn, orders), args)` with respect to `v` by
 * the multivariate chain rule, bumping the multi-index one slot at a time:
 *
 *   Σᵢ Apply(Derivative(fn, orders + eᵢ), args) · d(argsᵢ)/dv
 *
 * Slots whose argument does not depend on `v` drop out (their partial is
 * multiplied by zero). Returns `ce.Zero` when no slot depends on `v`, or
 * `undefined` if some argument's derivative cannot be determined.
 */
function differentiateApplied(
  fn: Expression,
  orders: number[],
  args: Expression[],
  v: string,
  depth: number,
  trace?: DerivativeTrace,
  node?: Expression
): Expression | undefined {
  const ce = fn.engine;

  // Record the (multivariate) chain-rule step against the original
  // expression, with each argument's derivative as a placeholder.
  if (trace && node) {
    recordD(trace, node, v, 'derivative.chain-rule', () => {
      const templateTerms: Expression[] = [];
      for (let i = 0; i < args.length; i++) {
        if (!args[i].has(v)) continue;
        const nextOrders = orders.slice();
        nextOrders[i] = (nextOrders[i] ?? 0) + 1;
        const nextDeriv = ce._fn('Derivative', [
          fn,
          ...nextOrders.map((n) => ce.number(n)),
        ]);
        templateTerms.push(
          ce.function('Multiply', [
            ce._fn('Apply', [nextDeriv, ...args]),
            dPlaceholder(args[i], v),
          ])
        );
      }
      if (templateTerms.length === 0) return ce.Zero;
      return ce.function('Add', templateTerms);
    });
  }

  const terms: Expression[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const argPrime =
      differentiate(arg, v, depth + 1, trace) ??
      ce._fn('D', [arg, ce.symbol(v)]);
    if (!argPrime.isValid) return undefined;
    if (argPrime.isSame(0)) continue;
    const nextOrders = orders.slice();
    nextOrders[i] = (nextOrders[i] ?? 0) + 1;
    const nextDeriv = ce._fn('Derivative', [
      fn,
      ...nextOrders.map((n) => ce.number(n)),
    ]);
    terms.push(ce._fn('Apply', [nextDeriv, ...args]).mul(argPrime));
  }
  if (terms.length === 0) return ce.Zero;
  return simplifyDerivative(add(...terms));
}

/**
 * Calculate the partial derivative of an expression with respect to a
 * variable, `v`.
 *
 * All expressions that do not explicitly depend on `v` are taken to have zero
 * partial derivative.
 *
 * ## Recursion Safety
 *
 * This function includes a depth limit (`MAX_DIFFERENTIATION_DEPTH`) to prevent
 * stack overflow from pathological expressions. The depth is tracked internally
 * and incremented on each recursive call. If the limit is reached, the function
 * returns `undefined` rather than continuing to recurse.
 *
 * Normal differentiation (including higher-order derivatives of complex
 * expressions) should never approach this limit. Hitting the limit indicates
 * either a bug in the differentiation rules or a maliciously constructed input.
 *
 * @param expr - The expression to differentiate
 * @param v - The variable to differentiate with respect to
 * @param depth - Internal recursion depth counter (do not pass manually)
 * @returns The derivative expression, or `undefined` if unable to differentiate
 */
export function differentiate(
  expr: Expression,
  v: string,
  depth: number = 0,
  trace?: DerivativeTrace
): Expression | undefined {
  // Guard against runaway recursion
  if (depth > MAX_DIFFERENTIATION_DEPTH) {
    console.assert(
      false,
      `Differentiation depth limit (${MAX_DIFFERENTIATION_DEPTH}) exceeded`
    );
    return undefined;
  }

  // Guard against runaway expression growth (see differentiateCallCount)
  if ((++differentiateCallCount & 0xff) === 0)
    checkDeadline(expr.engine._deadline);

  const ce = expr.engine;

  // A few easy ones...
  if (isString(expr)) return undefined;
  if (isNumber(expr)) return expr.engine.Zero;
  if (isSymbol(expr)) {
    if (expr.symbol === v) return expr.engine.One;

    // Resolve user-defined functions: e.g. f where f(x) := 2x
    if (isUserFunction(expr)) {
      const ce = expr.engine;
      const wildcard = ce.symbol('_');
      const body = ce.function(expr.symbol, [wildcard]).evaluate();
      // If the body resolved (is not just the same function call), differentiate it
      if (body.operator !== expr.symbol) {
        const bodyWithV = body.subs({ _: ce.symbol(v) });
        // The node (a bare function symbol) does not contain `v`, so record
        // this bridging step directly rather than through `recordD`.
        trace?.push({
          node: expr,
          id: 'derivative.expand-definition',
          template: dPlaceholder(bodyWithV, v),
        });
        return differentiate(bodyWithV, v, depth + 1, trace);
      }
    }

    return expr.engine.Zero;
  }
  if (!expr.operator || !isFunction(expr)) return undefined;

  // From here on, expr is narrowed to Expression & FunctionInterface
  if (expr.operator === 'Negate') {
    recordD(trace, expr, v, 'derivative.constant-multiple', () =>
      dPlaceholder(expr.op1, v).neg()
    );
    const gPrime = differentiate(expr.op1, v, depth + 1, trace);
    if (gPrime) return gPrime.neg();
    return ce._fn('D', [expr.op1, ce.symbol(v)]).neg();
  }

  // Block - just differentiate the content
  if (expr.operator === 'Block') {
    recordD(trace, expr, v, 'derivative.rewrite', () =>
      dPlaceholder(expr.op1, v)
    );
    return differentiate(expr.op1, v, depth + 1, trace);
  }

  // List (vector/matrix literal): a `List` is a container, not a function of
  // its elements, so it has no chain-rule semantics. Differentiate elementwise,
  // preserving shape (recursively for nested lists — matrices are lists of
  // lists). Only literal `List` operands broadcast this way; a symbol declared
  // as a matrix/vector has no visible elements and never reaches this branch.
  if (expr.operator === 'List') {
    const elements = expr.ops.map(
      (op) =>
        differentiate(op, v, depth + 1, trace) ??
        ce._fn('D', [op, ce.symbol(v)])
    );
    if (elements.some((e) => !e.isValid)) return undefined;
    return ce.function('List', elements);
  }

  // D - evaluate the derivative first, then differentiate the result
  if (expr.operator === 'D') {
    const evaluated = expr.evaluate();
    // Avoid infinite recursion if D doesn't simplify
    if (evaluated.operator === 'D') return undefined;
    recordD(trace, expr, v, 'derivative.rewrite', () =>
      dPlaceholder(evaluated, v)
    );
    return differentiate(evaluated, v, depth + 1, trace);
  }

  // Differentiate an already-symbolic partial derivative, applying the chain
  // rule and bumping the multi-index:
  //
  //   d/dv Apply(Derivative(f, α), g₁,…,g_k)
  //     = Σᵢ Apply(Derivative(f, α+eᵢ), g₁,…,g_k) · gᵢ'
  //
  // For a univariate f this reduces to the familiar
  //   d/dv Apply(Derivative(f, n), g) = Apply(Derivative(f, n+1), g) · g'.
  if (expr.operator === 'Apply' && isFunction(expr.op1, 'Derivative')) {
    const derivativeFn = expr.op1;
    const fn = derivativeFn.op1;
    const args = expr.ops.slice(1);
    if (!fn || args.length === 0) return undefined;

    const orders = derivativeOrders(derivativeFn, args.length);
    if (!orders) return undefined;

    return differentiateApplied(fn, orders, args, v, depth, trace, expr);
  }

  // Sum rule
  if (expr.operator === 'Add') {
    recordD(trace, expr, v, 'derivative.sum-rule', () =>
      ce.function(
        'Add',
        expr.ops.map((op) => dPlaceholder(op, v))
      )
    );
    const terms = expr.ops.map((op) => {
      const term = differentiate(op, v, depth + 1, trace);
      if (term) return term;
      if (!op.has(v)) return ce.Zero;
      return ce._fn('D', [op, ce.symbol(v)]);
    });
    if (terms.some((term) => !term.isValid)) return undefined;
    return simplifyDerivative(add(...terms));
  }

  // Product rule
  if (expr.operator === 'Multiply') {
    recordD(trace, expr, v, 'derivative.product-rule', () => {
      const terms: Expression[] = [];
      expr.ops.forEach((op, i) => {
        const ph = dPlaceholder(op, v);
        if (ph.isSame(0)) return; // constant factor: term drops
        const others = expr.ops.slice();
        others.splice(i, 1);
        terms.push(
          ph.isSame(1)
            ? ce.function('Multiply', others)
            : ce.function('Multiply', [ph, ...others])
        );
      });
      return terms.length === 0 ? ce.Zero : ce.function('Add', terms);
    });
    const terms = expr.ops.map((op, i) => {
      const otherTerms = expr.ops.slice();
      otherTerms.splice(i, 1);
      const otherProduct = mul(...otherTerms);
      const gPrime =
        differentiate(op, v, depth + 1, trace) ??
        ce._fn('D', [op, ce.symbol(v)]);
      return gPrime.mul(otherProduct);
    });
    if (terms.some((term) => term === undefined)) return undefined;
    return simplifyDerivative(add(...(terms as Expression[])));
  }

  // Root rule: Root(base, n) = base^(1/n)
  if (expr.operator === 'Root') {
    const [base, n] = expr.ops;

    // If the degree depends on v, the constant-degree power rule below is
    // invalid — it drops the ∂/∂n contribution (e.g. d/dx Root(x, x) would
    // lose the (1 - ln x) factor, and Root(2, x) = 2^(1/x) would wrongly be
    // 0). Differentiate the equivalent Power(base, 1/n) instead, whose rule
    // handles dependence in both the base and the exponent.
    if (n.has(v)) {
      const power = ce.function('Power', [base, ce.One.div(n)], {
        form: 'structural',
      });
      recordD(trace, expr, v, 'derivative.rewrite', () =>
        dPlaceholder(power, v)
      );
      return differentiate(power, v, depth + 1, trace);
    }

    if (!base.has(v)) return ce.Zero;

    // Constant degree: d/dx base^(1/n) = (1/n) * base^((1/n) - 1) * base'
    const exponent = ce.One.div(n); // 1/n
    const newExponent = exponent.sub(ce.One); // (1/n) - 1 = (1-n)/n

    // Create Power expression as structural (bound but not canonicalized) to avoid Root conversion
    const power = ce.function('Power', [base, newExponent], {
      form: 'structural',
    });

    recordD(trace, expr, v, 'derivative.power-rule', () =>
      ce.function('Multiply', [exponent, power, dPlaceholder(base, v)])
    );
    const basePrime =
      differentiate(base, v, depth + 1, trace) ??
      ce._fn('D', [base, ce.symbol(v)]);

    return simplifyDerivative(exponent.mul(power).mul(basePrime));
  }

  // Power rule
  if (expr.operator === 'Power') {
    const [base, exponent] = expr.ops;
    const baseHasV = base.has(v);
    const expHasV = exponent.has(v);

    if (!baseHasV && !expHasV) {
      // Neither depends on v - derivative is 0
      return ce.Zero;
    }

    if (baseHasV && !expHasV) {
      // Only base depends on v: d/dx f(x)^n = n * f(x)^(n-1) * f'(x)
      recordD(trace, expr, v, 'derivative.power-rule', () =>
        ce.function('Multiply', [
          exponent,
          base.pow(exponent.add(ce.NegativeOne)),
          dPlaceholder(base, v),
        ])
      );
      const fPrime =
        differentiate(base, v, depth + 1, trace) ??
        ce._fn('D', [base, ce.symbol(v)]);
      return simplifyDerivative(
        exponent.mul(base.pow(exponent.add(ce.NegativeOne))).mul(fPrime)
      );
    }

    if (!baseHasV && expHasV) {
      // Only exponent depends on v: d/dx a^g(x) = a^g(x) * ln(a) * g'(x)
      // Use ce._fn('Ln', ...) instead of base.ln() to keep ln symbolic
      // (base.ln() evaluates to a numeric value).
      recordD(trace, expr, v, 'derivative.exponential-rule', () =>
        // For base e, ln(e) = 1 — show the textbook (eᵘ)′ = eᵘ·u′
        isSymbol(base) && base.symbol === 'ExponentialE'
          ? ce.function('Multiply', [expr, dPlaceholder(exponent, v)])
          : ce.function('Multiply', [
              expr,
              ce._fn('Ln', [base]),
              dPlaceholder(exponent, v),
            ])
      );
      const gPrime =
        differentiate(exponent, v, depth + 1, trace) ??
        ce._fn('D', [exponent, ce.symbol(v)]);
      const lnBase = ce._fn('Ln', [base]);
      return simplifyDerivative(expr.mul(lnBase).mul(gPrime));
    }

    // Both depend on v: d/dx f(x)^g(x) = f(x)^g(x) * (g'(x) * ln(f(x)) + g(x) * f'(x) / f(x))
    const f = base;
    const g = exponent;
    recordD(trace, expr, v, 'derivative.general-power-rule', () =>
      ce.function('Multiply', [
        expr,
        ce.function('Add', [
          ce.function('Multiply', [dPlaceholder(g, v), ce._fn('Ln', [f])]),
          ce.function('Divide', [
            ce.function('Multiply', [g, dPlaceholder(f, v)]),
            f,
          ]),
        ]),
      ])
    );
    const fPrime =
      differentiate(f, v, depth + 1, trace) ?? ce._fn('D', [f, ce.symbol(v)]);
    const gPrime =
      differentiate(g, v, depth + 1, trace) ?? ce._fn('D', [g, ce.symbol(v)]);
    // Use ce._fn('Ln', ...) instead of f.ln() to keep ln symbolic
    // (f.ln() evaluates to a numeric value when f is a constant).
    const lnF = ce._fn('Ln', [f]);
    const term1 = gPrime.mul(lnF);
    const term2 = g.mul(fPrime).div(f);
    return simplifyDerivative(expr.mul(term1.add(term2)));
  }

  // Quotient rule
  if (expr.operator === 'Divide') {
    const [numerator, denominator] = expr.ops;
    recordD(trace, expr, v, 'derivative.quotient-rule', () =>
      ce.function('Divide', [
        ce.function('Add', [
          ce.function('Multiply', [dPlaceholder(numerator, v), denominator]),
          ce
            .function('Multiply', [dPlaceholder(denominator, v), numerator])
            .neg(),
        ]),
        denominator.pow(2),
      ])
    );
    const gPrime =
      differentiate(numerator, v, depth + 1, trace) ??
      ce._fn('D', [numerator, ce.symbol(v)]);
    const hPrime =
      differentiate(denominator, v, depth + 1, trace) ??
      ce._fn('D', [denominator, ce.symbol(v)]);
    return simplifyDerivative(
      gPrime.mul(denominator).sub(hPrime.mul(numerator)).div(denominator.pow(2))
    );
  }

  // Log(x, base) - logarithm with custom base
  // d/dx log_b(x) = 1/(x·ln(b)) when only x depends on v
  // If both x and base depend on v, use quotient rule on ln(x)/ln(base)
  if (expr.operator === 'Log' && expr.nops === 2) {
    const [x, base] = expr.ops;
    const xHasV = x.has(v);
    const baseHasV = base.has(v);

    if (!xHasV && !baseHasV) {
      // Neither depends on v - derivative is 0
      return ce.Zero;
    }

    if (xHasV && !baseHasV) {
      // Only x depends on v: d/dx log_b(x) = 1/(x·ln(b)) * x'
      recordD(trace, expr, v, 'derivative.known-derivative', () =>
        ce.function('Divide', [
          dPlaceholder(x, v),
          ce.function('Multiply', [x, ce._fn('Ln', [base])]),
        ])
      );
      const xPrime =
        differentiate(x, v, depth + 1, trace) ?? ce._fn('D', [x, ce.symbol(v)]);
      const lnBase = ce._fn('Ln', [base]);
      return simplifyDerivative(xPrime.div(x.mul(lnBase)));
    }

    // If base depends on v, convert to ln(x)/ln(base) and differentiate
    // d/dx (ln(x)/ln(base)) uses quotient rule
    const lnX = ce._fn('Ln', [x]);
    const lnBase = ce._fn('Ln', [base]);
    const rewritten = lnX.div(lnBase);
    recordD(trace, expr, v, 'derivative.rewrite', () =>
      dPlaceholder(rewritten, v)
    );
    return differentiate(rewritten, v, depth + 1, trace);
  }

  // Mod(u, c): CE's Mod is the real sawtooth ((u mod c) + c) mod c, which is
  // piecewise-*linear* in u with slope 1 (jump discontinuities where u
  // crosses a multiple of c). So d/dx Mod(u, c) = u' almost everywhere,
  // provided the modulus c does not itself depend on the differentiation
  // variable. If both operands depend on v there is no clean a.e. closed
  // form (the jump locations themselves move with v) — stay symbolic.
  if (expr.operator === 'Mod' && expr.nops === 2) {
    const [u, c] = expr.ops;
    if (c.has(v)) return undefined;
    if (!u.has(v)) return ce.Zero;
    recordD(trace, expr, v, 'derivative.known-derivative', () =>
      dPlaceholder(u, v)
    );
    const uPrime =
      differentiate(u, v, depth + 1, trace) ?? ce._fn('D', [u, ce.symbol(v)]);
    return simplifyDerivative(uPrime);
  }

  // Discrete functions: GCD, LCM
  // These are step functions with derivative 0 almost everywhere
  // (undefined at discontinuities, but we return 0 as a useful approximation)
  if (['GCD', 'LCM'].includes(expr.operator)) {
    recordD(trace, expr, v, 'derivative.zero', () => ce.Zero);
    return ce.Zero;
  }

  // PolyGamma(m, u): d/du ψ⁽ᵐ⁾(u) = ψ⁽ᵐ⁺¹⁾(u), so the derivative climbs the
  // order ladder. Only ∂/∂u is elementary; an order that depends on v has no
  // closed form — stay symbolic (inert rather than wrong).
  if (expr.operator === 'PolyGamma' && expr.nops === 2) {
    const [m, u] = expr.ops;
    if (m.has(v)) return ce._fn('D', [expr, ce.symbol(v)]);
    if (!u.has(v)) return ce.Zero;
    const next = ce._fn('PolyGamma', [ce.function('Add', [m, ce.One]), u]);
    recordD(trace, expr, v, 'derivative.known-derivative', () =>
      ce.function('Multiply', [next, dPlaceholder(u, v)])
    );
    const uPrime =
      differentiate(u, v, depth + 1, trace) ?? ce._fn('D', [u, ce.symbol(v)]);
    return simplifyDerivative(next.mul(uPrime));
  }

  // Lambert W, 2-argument form W(z, k) — the branch index k is the SECOND
  // argument. Every fixed branch satisfies the same functional equation, so
  // d/dz W(z, k) = W(z, k)/(z·(1+W(z, k))) on any branch, away from the
  // branch points (z = −1/e, and z = 0 for k ≠ 0). The branch index is a
  // discrete parameter: if k depends on v there is no derivative — stay
  // symbolic (inert rather than wrong).
  if (expr.operator === 'LambertW' && expr.nops === 2) {
    const [z, k] = expr.ops;
    if (k.has(v)) return ce._fn('D', [expr, ce.symbol(v)]);
    if (!z.has(v)) return ce.Zero;
    const w = expr; // W(z, k), branch preserved
    recordD(trace, expr, v, 'derivative.known-derivative', () =>
      ce.function('Multiply', [
        ce.function('Divide', [
          w,
          ce.function('Multiply', [z, ce.function('Add', [ce.One, w])]),
        ]),
        dPlaceholder(z, v),
      ])
    );
    const zPrime =
      differentiate(z, v, depth + 1, trace) ?? ce._fn('D', [z, ce.symbol(v)]);
    return simplifyDerivative(w.div(z.mul(w.add(ce.One))).mul(zPrime));
  }

  // Bessel function derivatives
  // BesselJ, BesselY, BesselI, BesselK have signature (order, x)
  // d/dx J_n(x) = (J_{n-1}(x) - J_{n+1}(x))/2
  // d/dx Y_n(x) = (Y_{n-1}(x) - Y_{n+1}(x))/2
  // d/dx I_n(x) = (I_{n-1}(x) + I_{n+1}(x))/2
  // d/dx K_n(x) = -(K_{n-1}(x) + K_{n+1}(x))/2
  if (
    ['BesselJ', 'BesselY', 'BesselI', 'BesselK'].includes(expr.operator) &&
    expr.nops === 2
  ) {
    const [order, x] = expr.ops;
    const xHasV = x.has(v);
    const orderHasV = order.has(v);

    if (!xHasV && !orderHasV) {
      // Neither depends on v - derivative is 0
      return ce.Zero;
    }

    const op = expr.operator;
    const terms: Expression[] = [];

    // Record the recurrence-formula step (only in the pure ∂/∂x case; an
    // order that depends on v has no elementary form and stays symbolic).
    if (xHasV && !orderHasV) {
      recordD(trace, expr, v, 'derivative.known-derivative', () => {
        const fNMinus1 = ce._fn(op, [order.sub(ce.One), x]);
        const fNPlus1 = ce._fn(op, [order.add(ce.One), x]);
        let argDeriv: Expression;
        if (op === 'BesselJ' || op === 'BesselY')
          argDeriv = fNMinus1.sub(fNPlus1).div(2);
        else if (op === 'BesselI') argDeriv = fNMinus1.add(fNPlus1).div(2);
        else argDeriv = fNMinus1.add(fNPlus1).div(2).neg();
        return ce.function('Multiply', [argDeriv, dPlaceholder(x, v)]);
      });
    }

    // ∂/∂x contribution: the standard recurrence formula, times x'.
    if (xHasV) {
      const xPrime =
        differentiate(x, v, depth + 1, trace) ?? ce._fn('D', [x, ce.symbol(v)]);
      const nMinus1 = order.sub(ce.One);
      const nPlus1 = order.add(ce.One);
      const fNMinus1 = ce._fn(op, [nMinus1, x]);
      const fNPlus1 = ce._fn(op, [nPlus1, x]);
      let argDeriv: Expression;
      if (op === 'BesselJ' || op === 'BesselY') {
        // d/dx J_n(x) = (J_{n-1}(x) - J_{n+1}(x))/2 (same for Y)
        argDeriv = fNMinus1.sub(fNPlus1).div(2);
      } else if (op === 'BesselI') {
        // d/dx I_n(x) = (I_{n-1}(x) + I_{n+1}(x))/2
        argDeriv = fNMinus1.add(fNPlus1).div(2);
      } else {
        // BesselK: d/dx K_n(x) = -(K_{n-1}(x) + K_{n+1}(x))/2
        argDeriv = fNMinus1.add(fNPlus1).div(2).neg();
      }
      terms.push(argDeriv.mul(xPrime));
    }

    // ∂/∂order contribution: the derivative with respect to the order has no
    // elementary closed form, so keep it symbolic as the multi-index
    // Apply(Derivative(op, 1, 0), order, x), times order'.
    if (orderHasV) {
      const orderPrime =
        differentiate(order, v, depth + 1, trace) ??
        ce._fn('D', [order, ce.symbol(v)]);
      const dOrder = ce._fn('Derivative', [ce.symbol(op), ce.One, ce.Zero]);
      terms.push(ce._fn('Apply', [dOrder, order, x]).mul(orderPrime));
    }

    return simplifyDerivative(add(...terms));
  }

  const h = DERIVATIVES_TABLE[
    expr.operator as keyof typeof DERIVATIVES_TABLE
  ] as ExpressionInput | undefined;
  if (h === undefined) {
    // Try resolving user-defined function calls before falling back to
    // symbolic chain rule. Apply the function to wildcards, evaluate to
    // get the body, substitute actual arguments, and differentiate.
    const opSym = ce.symbol(expr.operator);
    if (isUserFunction(opSym)) {
      const args = expr.ops;
      const wildcards =
        args.length === 1
          ? [ce.symbol('_')]
          : args.map((_, i) => ce.symbol(`_${i + 1}`));
      const body = ce.function(expr.operator, wildcards).evaluate();
      if (body.operator !== expr.operator) {
        const subsMap: Record<string, Expression> = {};
        wildcards.forEach((w, i) => {
          subsMap[sym(w)!] = args[i];
        });
        const bodyWithArgs = body.subs(subsMap);
        recordD(trace, expr, v, 'derivative.expand-definition', () =>
          dPlaceholder(bodyWithArgs, v)
        );
        return differentiate(bodyWithArgs, v, depth + 1, trace);
      }
    }

    // Unknown function of one or more arguments: keep the outer derivative
    // symbolic and apply the (multivariate) chain rule. The partial with
    // respect to each argument slot is carried as a multi-index Derivative:
    //   d/dv f(g₁,…,g_k) = Σᵢ Apply(Derivative(f, eᵢ), g₁,…,g_k) · gᵢ'
    // For a univariate f this is the usual Apply(Derivative(f, 1), g) · g'.
    const fSym = ce.symbol(expr.operator);
    const baseOrders = expr.ops.map(() => 0);
    return differentiateApplied(
      fSym,
      baseOrders,
      expr.ops.slice(),
      v,
      depth,
      trace,
      expr
    );
  }

  // Apply the chain rule:
  // d/dx f(g(x)) = f'(g(x)) * g'(x)
  if (expr.nops > 1) return ce._fn('D', [expr, ce.symbol(v)]);
  const g = expr.ops[0];
  // Substitute the argument into the derivative formula
  // We use subs() instead of apply() to avoid evaluating the expression,
  // which would convert symbolic transcendentals like ln(10) to numeric values.
  const derivFormula = ce.expr(h).subs({ _: g });
  // A bare `f(x)` is a table lookup; a composite `f(g(x))` is the chain rule.
  recordD(
    trace,
    expr,
    v,
    isSymbol(g) && g.symbol === v
      ? 'derivative.known-derivative'
      : 'derivative.chain-rule',
    () =>
      isSymbol(g) && g.symbol === v
        ? derivFormula
        : ce.function('Multiply', [derivFormula, dPlaceholder(g, v)])
  );
  const gPrime =
    differentiate(g, v, depth + 1, trace) ?? ce._fn('D', [g, ce.symbol(v)]);
  return simplifyDerivative(derivFormula.mul(gPrime));
}
